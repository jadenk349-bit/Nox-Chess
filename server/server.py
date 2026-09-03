"""Nox Chess online play — matchmaking and move relay.

Stdlib only. One port serves both the page over HTTP and the game socket at
/ws, so a browser loads http://localhost:8787/ and connects straight back to
the origin it came from.

It pairs players three ways: a quick-match queue, a list of open rooms, and a
challenge sent to one named friend. All three end in the same Game, relayed the
same way — a challenge is not a second kind of multiplayer, only a third way
into the first one. Friendships themselves are Supabase's business, not this
server's; see supabase-social.sql.

The rules live in the browser: both clients run the same move generator, so the
server's job is to pair players and to keep the two of them on one timeline. It
enforces whose turn it is and that plies arrive in order — a move from the wrong
player, or out of sequence, is refused rather than relayed. It does not judge
legality, so a hand-rolled client could still feed its opponent nonsense; the
receiving client rejects anything its own rules reject.

Run:  python3 server/server.py [--port 8787]
"""

import json
import os
import random
import socket
import sys
import threading
import time
import uuid

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import wsproto
import supabase_auth
import supabase_db
from wsproto import Framer, WSClosed, WSError

HERE = os.path.dirname(os.path.abspath(__file__))
PAGE = os.path.join(os.path.dirname(HERE), "blind-chess.html")

WHITE, BLACK = "w", "b"

lock = threading.RLock()
# (mode, minutes, inc, kind) -> the Clients waiting for that quick match, in
# the order they arrived. A list rather than the one slot it used to be, so
# that "anyone but the player I have just finished with" is a question the
# queue can actually answer — see handle_find().
lobby = {}
rooms = {}        # room id -> Room, the open rooms anyone may sit down at
lobby_subs = set()  # clients watching the room list right now
games = {}        # game id -> Game
# Signed-in players, by account id -> the connections they have open. A friend
# is challenged by who they are rather than by which socket they happen to be
# on, so this is what turns an account id into somewhere to send.
by_user = {}      # supabase user id -> set of Clients
challenges = {}   # challenge id -> Challenge, one per invitation in the air
# A rematch is asked for after the game it is about has already ended, which is
# why it cannot live on the Game: finish_game() has let go of that by then, and
# of both players with it. Like a challenge it means nothing once either side
# has gone, so it lives here beside them and dies with the session.
rematches = {}    # rematch id -> Rematch, one per request in the air
LOG = True

# A challenge nobody answers should not sit in memory for the life of the
# process. Long enough for someone to notice the box and think about it.
CHALLENGE_TTL = 180
# The same, for a rematch: nobody sits on a finished board for longer than this
# waiting to be asked again.
REMATCH_TTL = 180


def log(*a):
    if LOG:
        print("[%s]" % time.strftime("%H:%M:%S"), *a, flush=True)


class Client:
    def __init__(self, framer, addr):
        self.framer = framer
        self.addr = addr
        self.send_lock = threading.Lock()
        self.id = uuid.uuid4().hex[:8]
        self.game = None
        self.color = None
        self.queue_key = None
        self.room = None          # the room this client is hosting, if any
        # Who to hand chat to, as (client, game id). Kept apart from `game`
        # because a finished game clears that, and "good game" is said after
        # the result, not before it. The game id travels with the message so a
        # word arriving late cannot land in whatever the recipient plays next.
        self.chat_peer = None
        # The game this connection last finished, and on what terms — set by
        # finish_game(). It is what a rematch is offered on, and keeping only
        # the *last* one is what makes a request naming an older game stale.
        self.last_game = None
        self.alive = True
        # Identity, once the client says hello. A guest keeps user_id None:
        # they can still play friendly games, they just aren't anybody yet.
        self.user_id = None
        self.name = "Guest"
        self.verified = False

    def send(self, obj):
        if not self.alive:
            return
        try:
            with self.send_lock:
                self.framer.send(json.dumps(obj))
        except (OSError, WSError):
            self.alive = False

    def __repr__(self):
        return "<client %s>" % self.id


class Game:
    def __init__(self, white, black, mode, minutes, inc=0, kind="friendly"):
        self.id = uuid.uuid4().hex[:8]
        self.players = {WHITE: white, BLACK: black}
        self.mode = mode
        self.minutes = minutes
        self.inc = inc           # seconds added after each move; 0 is a plain clock
        # ranked or friendly. Kept on the game because a rematch is offered on
        # the terms of the game it follows, and "which queue this was" is one
        # of them — a ranked game must never be played again as a friendly one.
        self.kind = kind
        self.moves = []          # each: {ply, from, to, promo, san}
        self.turn = WHITE
        self.over = None
        self.started = time.time()
        # Pairing them is also what lets them talk. Both directions are set
        # here so every way of making a game — quick match and rooms alike —
        # gets chat without having to remember to wire it up.
        white.chat_peer = (black, self.id)
        black.chat_peer = (white, self.id)

    def opponent_of(self, client):
        return self.players[BLACK if client.color == WHITE else WHITE]


class Room:
    """A game someone has set up and is sitting in, waiting for anyone to join."""

    def __init__(self, host, mode, minutes, inc, color):
        self.id = uuid.uuid4().hex[:8]
        self.host = host
        self.mode = mode
        self.minutes = minutes
        self.inc = inc
        self.color = color        # the colour the host will play; joiner takes the other
        self.created = time.time()

    def public(self):
        return {
            "id": self.id,
            "mode": self.mode,
            "minutes": self.minutes,
            "inc": self.inc,
            "color": self.color,
        }


class Challenge:
    """One player asking one particular friend for a game.

    Deliberately not a database row. A challenge is only meaningful while both
    people are connected — the moment either drops there is nothing to accept —
    so it lives here beside rooms and quick match, and dies with the session.
    It is addressed to an account id, not to a connection, so it reaches every
    tab that account has open and only that account can answer it.
    """

    def __init__(self, host, to_user, mode, minutes, inc, color):
        self.id = uuid.uuid4().hex[:8]
        self.host = host          # the challenger's client
        self.to_user = to_user    # the account id of the person challenged
        self.mode = mode
        self.minutes = minutes
        self.inc = inc
        self.color = color        # the colour the challenger takes; the friend gets the other
        self.created = time.time()

    def public(self):
        return {
            "id": self.id,
            "from": self.host.user_id,
            "fromName": self.host.name,
            "mode": self.mode,
            "minutes": self.minutes,
            "inc": self.inc,
            # what the person answering will be playing, which is not what the
            # challenger picked for themselves
            "color": BLACK if self.color == WHITE else WHITE,
        }


class Rematch:
    """One player asking the opponent they have just played for another game.

    A challenge with the question already settled: who, on what terms, and at
    what clock all come from the game that has just ended, so there is nothing
    to fill in. It is addressed to the *connection* that played it rather than
    to an account id, which is the difference from a Challenge — the person on
    the other end of that finished board is one particular socket, not whoever
    is signed in somewhere.

    `game_id` is what makes it answerable. Both ends remember only the last
    game they finished, so a request naming anything else is stale by
    definition and refused rather than quietly starting a game neither player
    meant to begin.
    """

    def __init__(self, host, guest, game_id, mode, minutes, inc, kind, host_color):
        self.id = uuid.uuid4().hex[:8]
        self.host = host          # the one who asked
        self.guest = guest        # the one who has to answer
        self.game_id = game_id    # the finished game this is about
        self.mode = mode
        self.minutes = minutes
        self.inc = inc
        self.kind = kind          # ranked stays ranked; friendly stays friendly
        self.host_color = host_color   # what the asker played in that game
        self.created = time.time()

    def public(self):
        return {
            "id": self.id,
            "game": self.game_id,
            "from": self.host.name,
            "mode": self.mode,
            "minutes": self.minutes,
            "inc": self.inc,
            "kind": self.kind,
            # Colours swap, which is what a rematch means, so the seat offered
            # to whoever answers is the one the asker has just got up from.
            "color": self.host_color,
        }


def prune_rematches(now=None):
    """Drop requests nobody answered, and any whose ends have gone.

    Caller holds the lock. Unlike a challenge there is nobody left to tell:
    a request that has outlived its game is refused when it is answered, and
    the two sides are told by whichever of them presses something.
    """
    now = now or time.time()
    dead = [r for r in rematches.values()
            if now - r.created > REMATCH_TTL or not r.host.alive or not r.guest.alive]
    for r in dead:
        rematches.pop(r.id, None)
    return dead


def take_rematches_of(client):
    """Every request this client is either end of, removed. Caller holds the lock."""
    mine = [r for r in rematches.values() if r.host is client or r.guest is client]
    for r in mine:
        rematches.pop(r.id, None)
    return mine


def last_game_is(client, game_id):
    """Is that finished game still the one this client is sitting on?"""
    return bool(client.last_game) and client.last_game["id"] == game_id


def rematches_cleared_for(*seated):
    """Drop every rematch these players are an end of, and say who to tell.

    Sitting down at a new board answers any invitation still out from the last
    one: it cannot be taken up now, and whoever is looking at it should hear so
    rather than watch a box that will only lapse in three minutes' time.
    Caller holds the lock; the notices are sent by whoever called.
    """
    notices = []
    for client in seated:
        for rem in take_rematches_of(client):
            for side in (rem.host, rem.guest):
                if side not in seated:
                    notices.append((side, {"t": "rematch-gone",
                                           "game": rem.game_id, "reason": "away"}))
    return notices


def register_user(client):
    """Note where a signed-in player can be reached. Caller holds the lock."""
    if client.user_id:
        by_user.setdefault(client.user_id, set()).add(client)


def unregister_user(user_id, client):
    """Forget one connection of one account. Caller holds the lock.

    Takes the id rather than reading it off the client, because the one caller
    that matters is a second hello — where the client has already become
    somebody else and the entry to remove is filed under who they were.
    """
    peers = by_user.get(user_id)
    if peers is not None:
        peers.discard(client)
        if not peers:
            by_user.pop(user_id, None)


def prune_challenges(now=None):
    """Drop invitations nobody answered. Caller holds the lock.

    Returns the ones that went, so the caller can tell whoever is waiting —
    a challenger left staring at "waiting for…" forever is worse than one
    told the invitation lapsed.
    """
    now = now or time.time()
    dead = [c for c in challenges.values()
            if now - c.created > CHALLENGE_TTL or not c.host.alive]
    for ch in dead:
        challenges.pop(ch.id, None)
    return dead


def take_challenges_of(client, user_id=None):
    """Every invitation this client is either end of. Caller holds the lock."""
    mine = [c for c in challenges.values()
            if c.host is client or (user_id and c.to_user == user_id)]
    for ch in mine:
        challenges.pop(ch.id, None)
    return mine


def broadcast_rooms():
    """Everyone watching the list sees it the moment it changes.

    The payload is built under the lock but sent outside it — a slow socket
    must not hold up the room list for everybody else.
    """
    with lock:
        payload = {"t": "rooms", "rooms": [r.public() for r in rooms.values()]}
        watchers = list(lobby_subs)
    for client in watchers:
        client.send(payload)


def finish_game(game, reason, winner=None, exclude=None):
    """Mark a game over and tell whoever is still connected."""
    if game.over:
        return
    game.over = reason
    for client in game.players.values():
        if client is not exclude:
            client.send({"t": "over", "reason": reason, "winner": winner})
    # What a rematch of this would be. Recorded here because the Game is about
    # to be let go of, and overwritten by the next game either player finishes
    # — which is exactly what makes a request naming an older game stale.
    for color, client in game.players.items():
        client.last_game = {
            "id": game.id,
            "mode": game.mode,
            "minutes": game.minutes,
            "inc": game.inc,
            "kind": game.kind,
            "color": color,
            "opponent": game.players[BLACK if color == WHITE else WHITE],
        }
    # Let go of the players too. Without this they stay "in a game" for the life
    # of the connection, and every later host or join is refused — which only
    # shows up once something reuses the socket after a game rather than
    # reconnecting, as returning to the room list does.
    for client in game.players.values():
        if client.game is game:
            client.game = None
            client.color = None
    games.pop(game.id, None)
    log("game %s over: %s" % (game.id, reason))


# ---------------------------------------------------------------- messages

# ------------------------------------------------------------------ puzzles

# The server keeps its own copy of what each puzzle is worth. The browser sends
# which puzzle it finished, not how hard it was: a client that names its own
# difficulty can name 3000 every time. Unknown ids are refused for the same
# reason. Loaded once at startup — the files are generated offline and change
# only when somebody regenerates them.
PUZZLE_RATINGS = {}

def load_puzzles():
    for track in ("opening", "middlegame", "endgame"):
        path = os.path.join(ROOT, "puzzles", "%s.json" % track)
        try:
            with open(path, "r") as fh:
                for puzzle in json.load(fh):
                    PUZZLE_RATINGS[puzzle["id"]] = int(puzzle["seedRating"])
        except (OSError, ValueError, KeyError, TypeError):
            continue          # no puzzles installed: the mode simply has nothing to rate
    log("%d puzzles known" % len(PUZZLE_RATINGS))


# Ratings for players this server cannot store. With SUPABASE_SERVICE_KEY set
# these are a cache in front of the profiles table; without it they are the
# only copy there is, and they last as long as the process does.
puzzle_ratings = {}

# Which puzzles each account has already been rated on, so that finishing one
# is worth something once and nothing after that.
#
# Deliberately keyed by account rather than by connection. The browser opens a
# socket per result and closes it again — puzzles are otherwise an offline mode
# and there is no reason to hold a connection open through one — so a guard
# that lived on the Client object would start empty every single time and stop
# nothing at all. Guests are not tracked here: there is no identity to track,
# and nothing of theirs is stored to protect.
#
# This lasts as long as the process. A restart lets each puzzle count once
# more, which is a bounded amount of drift and the honest cost of not putting
# a row in the database for every attempt.
rated_puzzles = {}

PUZZLE_START = 1200
PUZZLE_K = 20              # one puzzle should move a rating, not decide it
PUZZLE_FLOOR, PUZZLE_CEIL = 400, 3200


def elo_after(player, puzzle, solved):
    """Ordinary Elo, one game against a puzzle that never learns."""
    expected = 1.0 / (1.0 + 10 ** ((puzzle - player) / 400.0))
    moved = player + PUZZLE_K * ((1.0 if solved else 0.0) - expected)
    return max(PUZZLE_FLOOR, min(PUZZLE_CEIL, int(round(moved))))


def puzzle_rating_of(client):
    """What this player is rated now: stored if we can store, else remembered."""
    if client.user_id in puzzle_ratings:
        return puzzle_ratings[client.user_id]
    stored = supabase_db.get_puzzle_rating(client.user_id)
    rating = stored if isinstance(stored, int) else PUZZLE_START
    puzzle_ratings[client.user_id] = rating
    return rating


def handle_puzzle_result(client, msg):
    """A finished puzzle, priced here rather than in the browser.

    Guests are answered but not remembered: their rating lives in their own
    browser, exactly as ranked play already degrades for an account-less
    player. A signed-in player's rating is this server's to keep, and the
    browser's claim about what it currently is never enters into it.
    """
    puzzle_id = msg.get("puzzleId")
    solved = bool(msg.get("solved"))
    if not isinstance(puzzle_id, str) or puzzle_id not in PUZZLE_RATINGS:
        client.send({"t": "error", "msg": "unknown puzzle"})
        return
    puzzle = PUZZLE_RATINGS[puzzle_id]

    if not client.verified:
        # nothing to store against, so price the attempt they describe and let
        # their browser keep the answer
        try:
            player = int(msg.get("playerRating", PUZZLE_START))
        except (TypeError, ValueError):
            player = PUZZLE_START
        player = max(PUZZLE_FLOOR, min(PUZZLE_CEIL, player))
        after = elo_after(player, puzzle, solved)
        client.send({"t": "puzzleRating", "rating": after,
                     "delta": after - player, "saved": False})
        return

    # Once per puzzle per account. Replaying one you have already been rated on
    # is practice, and practice does not move a rating.
    done = rated_puzzles.setdefault(client.user_id, set())
    if puzzle_id in done:
        client.send({
            "t": "puzzleRating",
            "rating": puzzle_rating_of(client),
            "delta": 0,
            "saved": supabase_db.enabled(),
        })
        return
    done.add(puzzle_id)

    before = puzzle_rating_of(client)
    after = elo_after(before, puzzle, solved)
    puzzle_ratings[client.user_id] = after
    saved = supabase_db.set_puzzle_rating(client.user_id, after)
    log("%s %s %s: %d -> %d%s" % (
        client.id, "solved" if solved else "failed", puzzle_id, before, after,
        "" if saved else " (not stored)"))
    client.send({"t": "puzzleRating", "rating": after, "delta": after - before, "saved": saved})


def clean_guest_name(raw):
    """Guests are held to the same naming rule as accounts.

    The page no longer offers guests a name box at all, so in practice this
    only sees hand-written clients — but whatever an opponent ends up reading
    on their screen should have passed the same rule either way.
    """
    return supabase_auth.clean_name(raw) or "Guest"


def clean_inc(raw):
    """The seconds added after each move, from a message we do not trust.

    It goes into the lobby key, so it has to be something hashable and small;
    anything else becomes a plain clock rather than an error.
    """
    try:
        inc = int(raw)
    except (TypeError, ValueError):
        return 0
    return min(max(inc, 0), 60)


def time_label(minutes, inc):
    """How a time control reads in the log: "3+2", or "10 min" with no increment."""
    return "%s+%s" % (minutes, inc) if inc else "%s min" % minutes


def handle_hello(client, msg):
    """Identify the player, by token if they have one.

    A valid token makes them a real account: the name comes from the token,
    not from the message, so nobody can wear a name they haven't signed in
    as. Without a token — or with a bad one — they stay a guest and may
    still play friendly games.
    """
    was = client.user_id
    token = msg.get("token")
    if token:
        try:
            claims = supabase_auth.verify(token)
        except supabase_auth.AuthError as err:
            client.user_id = None
            client.verified = False
            client.name = clean_guest_name(msg.get("name"))
            with lock:
                unregister_user(was, client)   # no longer anybody, if it ever was
            log("%s rejected token: %s" % (client.id, err))
            client.send({
                "t": "welcome",
                "verified": False,
                "name": client.name,
                "reason": str(err),
            })
            return
        client.user_id = claims["sub"]
        client.name = supabase_auth.display_name(claims)
        client.verified = True
        log("%s signed in as %s (%s)" % (client.id, client.name, client.user_id[:8]))
    else:
        client.user_id = None
        client.verified = False
        client.name = clean_guest_name(msg.get("name"))

    # A second hello on the same socket re-identifies it, so the old entry has
    # to go or a signed-out tab would still be reachable as whoever it was.
    with lock:
        unregister_user(was, client)
        register_user(client)

    client.send({
        "t": "welcome",
        "verified": client.verified,
        "name": client.name,
        "accounts": supabase_auth.enabled(),
    })


def may_play_ranked(client):
    """A rating has to belong to somebody, so ranked play needs an account.

    Only once this server can actually issue one, though: with no Supabase
    configured nobody can ever verify, and refusing everyone would just delete
    the ranked queue. Named here because there are two doors into a ranked
    game — the queue and a rematch of one — and a rule enforced at one of them
    is not a rule.
    """
    return client.verified or not supabase_auth.enabled()


def handle_find(client, msg):
    mode = msg.get("mode", "blind")
    minutes = msg.get("minutes", 10)
    inc = clean_inc(msg.get("inc"))
    # ranked and friendly are separate queues: someone who came for a ranked game
    # must never be handed a friendly one, or the distinction means nothing
    kind = msg.get("kind", "friendly")
    if kind not in ("ranked", "friendly"):
        kind = "friendly"
    if kind == "ranked" and not may_play_ranked(client):
        client.send({"t": "error", "msg": "ranked play needs a signed-in account"})
        return
    if client.game:
        client.send({"t": "error", "msg": "already in a game"})
        return
    # The increment is part of the key, not decoration: 3+2 and a flat 3 minutes
    # are different games, and pairing across them would hand somebody a clock
    # they did not ask for.
    key = (mode, minutes, inc, kind)
    with lock:
        queue = lobby.get(key, [])
        if client in queue:
            return                       # already waiting here; asking twice changes nothing
        waiting = [c for c in queue if c.alive and not c.game]
        # Whoever you have just played is the one person New Game should not
        # hand you straight back: pressing it means "find me an opponent", and
        # being given the same one a second later reads as a rematch nobody
        # agreed to. They are still better than nobody, though, so they are the
        # fallback rather than a refusal — on a quiet server the alternative is
        # two people staring at "finding an opponent" with each other in front
        # of them. A third player arriving is all it takes for this to prefer
        # the stranger, which is what it is for.
        last = client.last_game["opponent"] if client.last_game else None
        partner = next((c for c in waiting if c is not last), None)
        if partner is None and waiting:
            partner = waiting[0]
        if partner is not None:
            leave_lobby(partner)
            # colours are the server's call, so neither client can pick for itself
            pair = [partner, client]
            random.shuffle(pair)
            white, black = pair
            game = Game(white, black, mode, minutes, inc, kind)
            white.color, black.color = WHITE, BLACK
            white.game = black.game = game
            leave_lobby(white)
            leave_lobby(black)
            games[game.id] = game
            log("matched %s (w) vs %s (b) — %s %s, %s" % (white.id, black.id, kind, mode, time_label(minutes, inc)))
            for color, player in game.players.items():
                other = game.opponent_of(player)
                player.send({
                    "t": "start",
                    "game": game.id,
                    "color": color,
                    "mode": mode,
                    "minutes": minutes,
                    "inc": inc,
                    "kind": kind,
                    "opponent": other.name,
                    "opponentVerified": other.verified,
                })
            # and a rematch either of them left in the air is over
            for side, payload in rematches_cleared_for(white, black):
                side.send(payload)
        else:
            leave_lobby(client)          # never in two queues at once
            lobby.setdefault(key, []).append(client)
            client.queue_key = key
            client.send({"t": "waiting"})
            log("%s waiting — %s %s, %s" % (client.id, kind, mode, time_label(minutes, inc)))


def leave_lobby(client):
    """Take this client out of whatever queue it is in. Caller holds the lock.

    One place rather than the four that each used to reach into `lobby` and
    delete a key, because a queue that holds a list has more ways of going
    wrong than a queue that held one player: an entry left behind is somebody
    the next arrival tries to start a game with.
    """
    key = client.queue_key
    client.queue_key = None
    if not key:
        return
    waiting = lobby.get(key)
    if not waiting:
        return
    if client in waiting:
        waiting.remove(client)
    if not waiting:
        lobby.pop(key, None)


def handle_lobby(client):
    """Start watching the room list, and get it as it stands right now."""
    with lock:
        lobby_subs.add(client)
        payload = {"t": "rooms", "rooms": [r.public() for r in rooms.values()]}
    client.send(payload)


def handle_unlobby(client):
    with lock:
        lobby_subs.discard(client)


def handle_host(client, msg):
    mode = msg.get("mode", "blind")
    minutes = msg.get("minutes", 10)
    inc = clean_inc(msg.get("inc"))
    color = msg.get("color", WHITE)
    if color not in (WHITE, BLACK):
        color = WHITE
    with lock:
        if client.game:
            client.send({"t": "error", "msg": "already in a game"})
            return
        if client.room:                     # one room per host — replace the old one
            rooms.pop(client.room.id, None)
        room = Room(client, mode, minutes, inc, color)
        rooms[room.id] = room
        client.room = room
    client.send({"t": "hosting", "room": room.id})
    log("%s hosting %s — %s, %s, host plays %s"
        % (client.id, room.id, mode, time_label(minutes, inc), color))
    broadcast_rooms()


def handle_unhost(client):
    with lock:
        room = client.room
        if room:
            rooms.pop(room.id, None)
            client.room = None
    if room:
        log("%s closed room %s" % (client.id, room.id))
        broadcast_rooms()


def handle_join(client, msg):
    """Sit down at someone's room. First to arrive gets it."""
    with lock:
        room = rooms.get(msg.get("room"))
        if room is None:
            client.send({"t": "error", "msg": "that room is gone"})
            return
        if room.host is client:
            client.send({"t": "error", "msg": "that is your own room"})
            return
        if client.game or not room.host.alive:
            client.send({"t": "error", "msg": "that room is gone"})
            return
        del rooms[room.id]
        host = room.host
        host.room = None
        # the host plays the colour they asked for; the joiner takes the other
        game, outgoing = start_game_between(host, client, room.color,
                                            room.mode, room.minutes, room.inc)
    for player, payload in outgoing:
        player.send(payload)
    log("room %s filled — %s (w) vs %s (b), %s, %s"
        % (room.id, game.players[WHITE].id, game.players[BLACK].id,
           room.mode, time_label(room.minutes, room.inc)))
    broadcast_rooms()


def handle_cancel(client):
    with lock:
        leave_lobby(client)
    client.send({"t": "cancelled"})


def handle_move(client, msg):
    with lock:
        game = client.game
        if not game or game.over:
            client.send({"t": "error", "msg": "no game in progress"})
            return
        if client.color != game.turn:
            client.send({"t": "error", "msg": "not your turn", "ply": len(game.moves)})
            return
        ply = msg.get("ply")
        if ply != len(game.moves):
            client.send({"t": "error", "msg": "out of sequence", "ply": len(game.moves)})
            return
        move = {
            "ply": ply,
            "from": msg.get("from"),
            "to": msg.get("to"),
            "promo": msg.get("promo"),
            "san": msg.get("san"),
        }
        if not isinstance(move["from"], int) or not isinstance(move["to"], int) \
           or not (0 <= move["from"] < 64) or not (0 <= move["to"] < 64):
            client.send({"t": "error", "msg": "bad square"})
            return
        game.moves.append(move)
        game.turn = BLACK if game.turn == WHITE else WHITE
        opponent = game.opponent_of(client)
    out = dict(move)
    out["t"] = "move"
    opponent.send(out)


def handle_result(client, msg):
    """A client's rules said the game ended. Record it and let the other agree."""
    with lock:
        game = client.game
        if not game or game.over:
            return
        finish_game(game, msg.get("status", "game over"), msg.get("winner"), exclude=client)


def handle_resign(client):
    with lock:
        game = client.game
        if not game or game.over:
            return
        winner = BLACK if client.color == WHITE else WHITE
        finish_game(game, "resign", winner)


def handle_draw_offer(client):
    """Relayed, not decided: a draw needs the other player to agree."""
    with lock:
        game = client.game
        if not game or game.over:
            return
        opponent = game.opponent_of(client)
    opponent.send({"t": "draw-offer"})


def handle_draw_accept(client):
    with lock:
        game = client.game
        if not game or game.over:
            return
        finish_game(game, "draw", None)


def handle_draw_decline(client):
    with lock:
        game = client.game
        if not game or game.over:
            return
        opponent = game.opponent_of(client)
    opponent.send({"t": "draw-decline"})


MAX_CHAT = 300


def clean_chat(raw):
    """Whatever the players say is text and only text.

    Control characters are dropped rather than escaped — the page prints chat
    with textContent, so markup is already inert there, but a stray newline or
    escape sequence has no business in a one-line message either. Length is
    capped here as well as in the page: the page is only one of the clients
    that can reach this socket.
    """
    if not isinstance(raw, str):
        return ""
    # str.isprintable() keeps ordinary spaces and everything visible, and drops
    # newlines, tabs and the control range — a message is one line by definition.
    text = "".join(c for c in raw if c.isprintable())
    return text.strip()[:MAX_CHAT]


def handle_chat(client, msg):
    """Relayed, never read: the server has no more opinion on talk than on moves.

    It goes to `chat_peer` rather than to the current game's opponent, because a
    game that has just ended has already let go of its players and "good game"
    comes after the result.
    """
    text = clean_chat(msg.get("text"))
    if not text:
        return
    with lock:
        peer = client.chat_peer
    if not peer:
        client.send({"t": "error", "msg": "nobody to talk to"})
        return
    other, game_id = peer
    other.send({"t": "chat", "game": game_id, "text": text, "from": client.name})


# ------------------------------------------------------- challenging a friend

def start_game_between(host, guest, host_color, mode, minutes, inc, kind="friendly"):
    """Seat two named players at one board. Caller holds the lock.

    The same pairing handle_join does for a room, lifted out so a challenge
    does not grow a second copy of it. Returns what to send each of them,
    which the caller sends outside the lock.
    """
    white, black = (host, guest) if host_color == WHITE else (guest, host)
    game = Game(white, black, mode, minutes, inc, kind)
    white.color, black.color = WHITE, BLACK
    white.game = black.game = game
    games[game.id] = game
    lobby_subs.discard(host)
    lobby_subs.discard(guest)
    # neither of them is waiting anywhere else now
    for player in (host, guest):
        leave_lobby(player)
    # Whatever either of them still had out from an earlier board is answered
    # by this one. It rides back with the start payloads because the caller
    # already sends those outside the lock, one at a time.
    return game, [(player, {
        "t": "start",
        "game": game.id,
        "color": color,
        "mode": mode,
        "minutes": minutes,
        "inc": inc,
        "kind": kind,
        "opponent": game.opponent_of(player).name,
        "opponentVerified": game.opponent_of(player).verified,
    }) for color, player in game.players.items()] + rematches_cleared_for(host, guest)


def handle_challenge(client, msg):
    """Ask one particular friend for a game.

    Addressed by account id, which is why it needs an account on both ends:
    a guest is nobody in particular, so there is nobody in particular to
    challenge and nobody in particular who may answer.
    """
    if not client.verified:
        client.send({"t": "error", "msg": "challenging a friend needs a signed-in account"})
        return
    target = msg.get("to")
    if not isinstance(target, str) or not target or target == client.user_id:
        client.send({"t": "error", "msg": "no such player"})
        return
    mode = msg.get("mode", "blind")
    minutes = msg.get("minutes", 10)
    inc = clean_inc(msg.get("inc"))
    color = msg.get("color", WHITE)
    if color not in (WHITE, BLACK):
        color = WHITE

    with lock:
        if client.game:
            client.send({"t": "error", "msg": "already in a game"})
            return
        lapsed = prune_challenges()
        # one invitation out at a time: a second replaces the first rather
        # than leaving the friend with two boxes to answer
        withdrawn = [c for c in challenges.values() if c.host is client]
        for ch in withdrawn:
            challenges.pop(ch.id, None)
        peers = [c for c in by_user.get(target, ()) if c.alive]
        free = [c for c in peers if not c.game]
        if not peers:
            client.send({"t": "challenge-away"})
            return
        if not free:
            client.send({"t": "challenge-busy"})
            return
        ch = Challenge(client, target, mode, minutes, inc, color)
        challenges[ch.id] = ch
        invite = dict(ch.public(), t="challenged")
        gone = [(c.id, list(by_user.get(c.to_user, ()))) for c in withdrawn]
        stale = [(c.host, c.id) for c in lapsed]
    for cid, peers_of in gone:
        for c in peers_of:
            c.send({"t": "challenge-gone", "id": cid})
    for host, cid in stale:
        host.send({"t": "challenge-lapsed", "id": cid})
    client.send({"t": "challenge-sent", "id": ch.id, "to": target})
    for c in free:
        c.send(invite)
    log("%s challenged %s — %s, %s" % (client.id, target[:8], mode, time_label(minutes, inc)))


def handle_challenge_accept(client, msg):
    """Take up a friend's invitation. Both of them end up in one ordinary game."""
    with lock:
        prune_challenges()
        ch = challenges.get(msg.get("id"))
        if ch is None:
            client.send({"t": "error", "msg": "that challenge is gone"})
            return
        # The one check the whole design rests on: a challenge belongs to the
        # account it was addressed to, so nobody else can answer it — not
        # another player, and not a second connection guessing at ids.
        if not client.verified or client.user_id != ch.to_user:
            client.send({"t": "error", "msg": "that challenge is not yours"})
            return
        del challenges[ch.id]
        host = ch.host
        if client.game or host.game or not host.alive:
            # Too late — one of them started something else in the meantime.
            # The challenger is still looking at "waiting for…", so they are
            # told as well; only the one who left needs no telling.
            client.send({"t": "error", "msg": "that challenge is gone"})
            if host.alive and not host.game:
                host.send({"t": "challenge-lapsed", "id": ch.id})
            return
        game, outgoing = start_game_between(host, client, ch.color,
                                            ch.mode, ch.minutes, ch.inc)
        # Anything else either of them had in the air is moot now.
        dropped = take_challenges_of(host, host.user_id) + \
                  take_challenges_of(client, client.user_id)
        # the accepting player's other tabs still have the box open
        others = [c for c in by_user.get(client.user_id, ()) if c is not client]
        notices = [(c, ch.id) for c in others]
        for d in dropped:
            notices += [(c, d.id) for c in by_user.get(d.to_user, ())]
            if d.host is not host and d.host is not client:
                notices.append((d.host, d.id))
    for player, payload in outgoing:
        player.send(payload)
    for c, cid in notices:
        c.send({"t": "challenge-gone", "id": cid})
    log("challenge %s taken up — %s (w) vs %s (b), %s, %s"
        % (ch.id, game.players[WHITE].id, game.players[BLACK].id,
           ch.mode, time_label(ch.minutes, ch.inc)))


def handle_challenge_decline(client, msg):
    with lock:
        ch = challenges.get(msg.get("id"))
        if ch is None:
            return
        if not client.verified or client.user_id != ch.to_user:
            client.send({"t": "error", "msg": "that challenge is not yours"})
            return
        del challenges[ch.id]
        host = ch.host
        others = [c for c in by_user.get(client.user_id, ()) if c is not client]
    host.send({"t": "challenge-declined", "id": ch.id, "by": client.name})
    for c in others:                       # their own other tabs, still asking
        c.send({"t": "challenge-gone", "id": ch.id})


def handle_challenge_cancel(client, msg):
    """The challenger thought better of it."""
    with lock:
        ch = challenges.get(msg.get("id"))
        if ch is None or ch.host is not client:
            return
        del challenges[ch.id]
        peers = list(by_user.get(ch.to_user, ()))
    for c in peers:
        c.send({"t": "challenge-gone", "id": ch.id})


# ------------------------------------------------------- playing again

def handle_rematch(client, msg):
    """Ask the opponent you have just played for another game on the same terms.

    Validated here rather than taken on trust: the browser may say "rematch",
    but only the game that has actually just ended between these two
    connections can be played again, and only while neither has started
    anything else. A hand-rolled client naming another game id, or pressing
    this in the middle of a game, gets a refusal and nothing else.
    """
    crossed = None
    invite = None
    guest = None
    with lock:
        prune_rematches()
        last = client.last_game
        if not last:
            client.send({"t": "error", "msg": "there is no game to play again"})
            return
        game_id = msg.get("game") or last["id"]
        if game_id != last["id"]:
            client.send({"t": "rematch-gone", "game": game_id, "reason": "stale"})
            return
        if client.game:
            client.send({"t": "error", "msg": "already in a game"})
            return
        # A ranked rematch is a ranked game, so it answers to the same rule the
        # ranked queue does. Both of them were verified when the game they are
        # playing again started, so this only bites if one has since signed out
        # on this socket — but it is the difference between the rule holding
        # and the rule holding at one of the two ways in.
        if last["kind"] == "ranked" and not may_play_ranked(client):
            client.send({"t": "error", "msg": "ranked play needs a signed-in account"})
            return
        other = last["opponent"]
        if not other.alive or other.game or not last_game_is(other, game_id):
            # They have left, or moved on to something else. Either way there
            # is nobody sitting on the other side of that board any more.
            client.send({"t": "rematch-gone", "game": game_id, "reason": "away"})
            return

        # Both pressed at nearly the same moment. The request that got here
        # first stands and this press answers it, rather than leaving two
        # invitations crossing in the air with neither one ever accepted.
        theirs = next((r for r in rematches.values()
                       if r.host is other and r.guest is client and r.game_id == game_id), None)
        if theirs is not None:
            crossed = theirs.id
        else:
            # Pressed twice, or a duplicate of the same message arrived. The
            # invitation already out is the answer to both: sending a second
            # would leave the opponent with two boxes to answer.
            mine = next((r for r in rematches.values()
                         if r.host is client and r.game_id == game_id), None)
            if mine is not None:
                client.send({"t": "rematch-sent", "id": mine.id, "game": game_id})
                return
            rem = Rematch(client, other, game_id, last["mode"], last["minutes"],
                          last["inc"], last["kind"], last["color"])
            rematches[rem.id] = rem
            invite = dict(rem.public(), t="rematch-request")
            guest = other
    if crossed is not None:
        handle_rematch_accept(client, {"id": crossed})
        return
    client.send({"t": "rematch-sent", "id": invite["id"], "game": game_id})
    guest.send(invite)
    log("%s asked %s for a rematch of %s" % (client.id, guest.id, game_id))


def handle_rematch_accept(client, msg):
    """Say yes, and the two of them sit straight back down — colours swapped."""
    with lock:
        prune_rematches()
        rem = rematches.get(msg.get("id"))
        if rem is None:
            client.send({"t": "error", "msg": "that rematch is gone"})
            return
        # Only the player it was put to may answer it.
        if rem.guest is not client:
            client.send({"t": "error", "msg": "that rematch is not yours"})
            return
        if rem.kind == "ranked" and not (may_play_ranked(client) and may_play_ranked(rem.host)):
            client.send({"t": "error", "msg": "ranked play needs a signed-in account"})
            return
        del rematches[rem.id]
        host = rem.host
        # Everything that still has to be true a moment later: neither has
        # started anything else, both are still connected, and both still have
        # that game as the last one they played.
        if client.game or host.game or not host.alive \
           or not last_game_is(host, rem.game_id) or not last_game_is(client, rem.game_id):
            client.send({"t": "rematch-gone", "game": rem.game_id, "reason": "away"})
            if host.alive and not host.game:
                host.send({"t": "rematch-gone", "game": rem.game_id, "reason": "away"})
            return
        # A rematch swaps the seats: whoever had White gets Black. The asker
        # takes the colour they did not have, and the answerer takes the one
        # the invitation already told them they would.
        host_color = BLACK if rem.host_color == WHITE else WHITE
        game, outgoing = start_game_between(host, client, host_color,
                                            rem.mode, rem.minutes, rem.inc, rem.kind)
        # start_game_between() has already dropped anything else either of
        # them had out, and put the notices in `outgoing` with the starts.
    for player, payload in outgoing:
        player.send(payload)
    log("rematch of %s taken up — %s (w) vs %s (b), %s %s, %s"
        % (rem.game_id, game.players[WHITE].id, game.players[BLACK].id,
           rem.kind, rem.mode, time_label(rem.minutes, rem.inc)))


def handle_rematch_decline(client, msg):
    with lock:
        rem = rematches.get(msg.get("id"))
        if rem is None:
            return
        if rem.guest is not client:
            client.send({"t": "error", "msg": "that rematch is not yours"})
            return
        del rematches[rem.id]
        host, game_id = rem.host, rem.game_id
    host.send({"t": "rematch-declined", "game": game_id, "by": client.name})


def handle_rematch_cancel(client, msg):
    """The asker thought better of it, or walked away from the finished board."""
    with lock:
        rem = rematches.get(msg.get("id"))
        if rem is None or rem.host is not client:
            return
        del rematches[rem.id]
        guest, game_id = rem.guest, rem.game_id
    guest.send({"t": "rematch-gone", "game": game_id, "reason": "withdrawn"})


def handle_message(client, raw):
    try:
        msg = json.loads(raw)
    except ValueError:
        client.send({"t": "error", "msg": "bad json"})
        return
    kind = msg.get("t")
    if kind == "hello":
        handle_hello(client, msg)
    elif kind == "find":
        handle_find(client, msg)
    elif kind == "lobby":
        handle_lobby(client)
    elif kind == "unlobby":
        handle_unlobby(client)
    elif kind == "host":
        handle_host(client, msg)
    elif kind == "unhost":
        handle_unhost(client)
    elif kind == "join":
        handle_join(client, msg)
    elif kind == "cancel":
        handle_cancel(client)
    elif kind == "move":
        handle_move(client, msg)
    elif kind == "result":
        handle_result(client, msg)
    elif kind == "resign":
        handle_resign(client)
    elif kind == "draw-offer":
        handle_draw_offer(client)
    elif kind == "draw-accept":
        handle_draw_accept(client)
    elif kind == "draw-decline":
        handle_draw_decline(client)
    elif kind == "chat":
        handle_chat(client, msg)
    elif kind == "challenge":
        handle_challenge(client, msg)
    elif kind == "challenge-accept":
        handle_challenge_accept(client, msg)
    elif kind == "challenge-decline":
        handle_challenge_decline(client, msg)
    elif kind == "challenge-cancel":
        handle_challenge_cancel(client, msg)
    elif kind == "rematch":
        handle_rematch(client, msg)
    elif kind == "rematch-accept":
        handle_rematch_accept(client, msg)
    elif kind == "rematch-decline":
        handle_rematch_decline(client, msg)
    elif kind == "rematch-cancel":
        handle_rematch_cancel(client, msg)
    elif kind == "puzzleResult":
        handle_puzzle_result(client, msg)
    elif kind == "ping":
        client.send({"t": "pong"})
    else:
        client.send({"t": "error", "msg": "unknown message %r" % (kind,)})


def drop_client(client):
    client.alive = False
    dropped_room = False
    with lock:
        leave_lobby(client)
        lobby_subs.discard(client)
        unregister_user(client.user_id, client)
        # A challenge is only worth anything while both ends are connected.
        # This client's own invitations go; invitations aimed at this account
        # go too, but only once its last connection has gone — another tab is
        # still somewhere the box can be answered.
        mine = [c for c in challenges.values() if c.host is client]
        if client.user_id and client.user_id not in by_user:
            mine += [c for c in challenges.values() if c.to_user == client.user_id]
        for ch in mine:
            challenges.pop(ch.id, None)
        told = []
        for ch in mine:
            if ch.host is client:
                told += [(c, {"t": "challenge-gone", "id": ch.id})
                         for c in by_user.get(ch.to_user, ())]
            else:
                told.append((ch.host, {"t": "challenge-away", "id": ch.id}))
        # A rematch has exactly two ends and this is one of them, so whichever
        # of the two is left is told the box in front of them is worth nothing.
        for rem in take_rematches_of(client):
            other = rem.guest if rem.host is client else rem.host
            told.append((other, {"t": "rematch-gone", "game": rem.game_id, "reason": "left"}))
        if client.room:                  # a host who vanishes takes their room with them
            rooms.pop(client.room.id, None)
            client.room = None
            dropped_room = True
        game = client.game
        if game and not game.over:
            winner = BLACK if client.color == WHITE else WHITE
            finish_game(game, "left", winner, exclude=client)
        client.game = None
        # the other side keeps its own reference until it disconnects too, but
        # sending to a dead socket is a no-op, so nothing piles up
        client.chat_peer = None
        # Nothing left to play again, and this is what releases the reference
        # each of a finished game's two clients holds to the other.
        client.last_game = None
    for other, payload in told:
        other.send(payload)
    log("%s disconnected" % client.id)
    if dropped_room:
        broadcast_rooms()


# ------------------------------------------------------------------- http

# An explicit allowlist rather than a static directory: there is no path to
# traverse if no part of the request ever reaches the filesystem. The wasm MIME
# type is not decoration — browsers refuse to stream-compile without it.
ROOT = os.path.dirname(HERE)
STATIC_FILES = {
    "/engine/stockfish.wasm.js": ("engine/stockfish.wasm.js", "text/javascript; charset=utf-8"),
    "/engine/stockfish.wasm":    ("engine/stockfish.wasm",    "application/wasm"),
    "/assets/nox-logo.png":      ("assets/nox-logo.png",      "image/png"),
    # the seven rank badges the ranked screen shows, one per tier
    "/assets/tier-bronze.png":      ("assets/tier-bronze.png",      "image/png"),
    "/assets/tier-silver.png":      ("assets/tier-silver.png",      "image/png"),
    "/assets/tier-gold.png":        ("assets/tier-gold.png",        "image/png"),
    "/assets/tier-platinum.png":    ("assets/tier-platinum.png",    "image/png"),
    "/assets/tier-diamond.png":     ("assets/tier-diamond.png",     "image/png"),
    "/assets/tier-master.png":      ("assets/tier-master.png",      "image/png"),
    "/assets/tier-grandmaster.png": ("assets/tier-grandmaster.png", "image/png"),
    # The three puzzle ladders, generated by tools/generate_puzzles.js out of
    # this game's own self-play. Regenerating renumbers them, so bump the ?v=
    # on these three in the page or a week of cache will serve the old ladder.
    "/puzzles/opening.json":     ("puzzles/opening.json",     "application/json; charset=utf-8"),
    "/puzzles/middlegame.json":  ("puzzles/middlegame.json",  "application/json; charset=utf-8"),
    "/puzzles/endgame.json":     ("puzzles/endgame.json",     "application/json; charset=utf-8"),
    # The Education System, which Study Board calls to name what a position is
    # about. The three library files are the SAME files education/tools/run_tests.py
    # runs its 973 assertions over — the page evaluates them rather than carrying a
    # copy, so what a player is told and what the tests check cannot drift apart.
    # The bundle is the 137 concept records and the warnings index as one file,
    # written by education/tools/build_bundle.js because a browser cannot walk a
    # directory. All four are fetched only when Study Board is opened.
    #
    # Regenerating the bundle needs EDU_VERSION bumped in the page, for the same
    # reason the puzzle ladders do: a week of cache will otherwise serve the old
    # corpus. Note what is NOT here — concepts/, state/ and education/tools/ are
    # research and build-time material and have no business on a socket.
    "/education/lib/features.js": ("education/lib/features.js", "text/javascript; charset=utf-8"),
    "/education/lib/matchers.js": ("education/lib/matchers.js", "text/javascript; charset=utf-8"),
    "/education/lib/analyze.js":  ("education/lib/analyze.js",  "text/javascript; charset=utf-8"),
    "/education/dist/education-bundle.json":
        ("education/dist/education-bundle.json", "application/json; charset=utf-8"),
}


def serve_static_file(sock, path):
    name, ctype = STATIC_FILES[path]
    try:
        with open(os.path.join(ROOT, name), "rb") as fh:
            body = fh.read()
    except OSError:
        sock.sendall(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n")
        return
    head = (
        "HTTP/1.1 200 OK\r\n"
        "Content-Type: %s\r\n"
        "Content-Length: %d\r\n"
        # A week is fine because every reference carries ?v= — bump that when a
        # file changes, or browsers will serve the old one for days.
        "Cache-Control: public, max-age=604800\r\n"
        "\r\n" % (ctype, len(body))
    )
    sock.sendall(head.encode() + body)


def serve_http(sock, request_line):
    try:
        method, path, _ = request_line.split(" ", 2)
    except ValueError:
        sock.sendall(b"HTTP/1.1 400 Bad Request\r\n\r\n")
        return
    if method != "GET":
        sock.sendall(b"HTTP/1.1 405 Method Not Allowed\r\n\r\n")
        return
    path = path.split("?", 1)[0]
    if path in ("/", "/index.html", "/blind-chess.html"):
        try:
            with open(PAGE, "rb") as fh:
                body = fh.read()
        except OSError:
            sock.sendall(b"HTTP/1.1 404 Not Found\r\n\r\n")
            return
        head = (
            "HTTP/1.1 200 OK\r\n"
            "Content-Type: text/html; charset=utf-8\r\n"
            "Content-Length: %d\r\n"
            "Cache-Control: no-store\r\n"
            "\r\n" % len(body)
        )
        sock.sendall(head.encode() + body)
    elif path in STATIC_FILES:
        serve_static_file(sock, path)
    elif path == "/health":
        with lock:
            body = json.dumps({
                "ok": True,
                # players waiting, not queues with somebody in them — the
                # queue holds a list per time control now
                "waiting": sum(len(q) for q in lobby.values()),
                "games": len(games),
            }).encode()
        sock.sendall(
            b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: "
            + str(len(body)).encode() + b"\r\n\r\n" + body
        )
    else:
        sock.sendall(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n")


# ------------------------------------------------------------ connections

def handle_connection(sock, addr):
    client = None
    try:
        raw = wsproto.read_http_head(sock)
        request_line, headers, rest = wsproto.parse_http_head(raw)

        # A proxy may fold the upgrade into a list ("keep-alive, Upgrade") and may
        # send it in any case, so match loosely on Upgrade alone and never require
        # an exact Connection header — that is what breaks servers behind proxies.
        upgrade = headers.get("upgrade", "").lower().strip()
        if upgrade != "websocket":
            serve_http(sock, request_line)
            return

        try:
            path = request_line.split(" ", 2)[1].split("?", 1)[0]
        except IndexError:
            path = ""
        if path.rstrip("/") not in ("/ws", ""):
            sock.sendall(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n")
            return

        version = headers.get("sec-websocket-version", "").strip()
        if version and version != "13":
            sock.sendall(
                b"HTTP/1.1 426 Upgrade Required\r\n"
                b"Sec-WebSocket-Version: 13\r\n"
                b"Content-Length: 0\r\n\r\n"
            )
            return

        key = headers.get("sec-websocket-key")
        if not key:
            sock.sendall(b"HTTP/1.1 400 Bad Request\r\n\r\n")
            return
        resp = (
            "HTTP/1.1 101 Switching Protocols\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            "Sec-WebSocket-Accept: %s\r\n"
            "\r\n" % wsproto.accept_key(key)
        )
        sock.sendall(resp.encode())
        client = Client(Framer(sock, mask_out=False, leftover=rest), addr)
        log("%s connected from %s" % (client.id, addr[0]))
        while True:
            raw_msg = client.framer.read_message()
            handle_message(client, raw_msg)
    except (WSClosed, ConnectionResetError, BrokenPipeError):
        pass
    except WSError as exc:
        log("protocol error: %s" % exc)
    except OSError:
        pass
    finally:
        if client:
            drop_client(client)
        try:
            sock.close()
        except OSError:
            pass


def main():
    load_puzzles()
    # $PORT is what most hosts inject; --port wins when it is given explicitly
    port = int(os.environ.get("PORT") or 8787)
    if "--port" in sys.argv:
        port = int(sys.argv[sys.argv.index("--port") + 1])
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    # 0.0.0.0, not 127.0.0.1: the process must be reachable from outside its
    # container or the proxy in front of it can never connect.
    server.bind(("0.0.0.0", port))
    server.listen(64)
    log("Nox Chess listening on 0.0.0.0:%d — page and socket share this port "
        "(socket at /ws). TLS, if any, is the proxy's job." % port)
    try:
        while True:
            sock, addr = server.accept()
            # a half-open connection through a proxy should not pin a thread forever
            try:
                sock.setsockopt(socket.SOL_SOCKET, socket.SO_KEEPALIVE, 1)
                sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
            except OSError:
                pass
            threading.Thread(target=handle_connection, args=(sock, addr), daemon=True).start()
    except KeyboardInterrupt:
        log("shutting down")
    finally:
        server.close()


if __name__ == "__main__":
    main()
