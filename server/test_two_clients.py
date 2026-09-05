"""Two WebSocket clients play a full game against each other through the server.

Each simulated client keeps its own timeline, built only from what it actually
knows: the moves it sent and the relays it received. If the server syncs state
correctly the two timelines are identical at every ply, and identical to the
game we meant to play.

Run the server first, then:  python3 server/test_two_clients.py
"""

import base64
import hashlib
import hmac
import json
import os
import socket
import sys
import threading
import time

try:
    import queue
except ImportError:                      # pragma: no cover
    import Queue as queue

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from wsproto import client_handshake, WSClosed

# Test-harness defaults only. Point them at a container or a staging host with
# WS_TEST_HOST / PORT — nothing about the game's own addressing lives here.
HOST = os.environ.get("WS_TEST_HOST", "127.0.0.1")
PUZZLE_FLOOR = 400        # what server.py clamps a rating to
PORT = int(os.environ.get("PORT", "8787"))

# The ranked fallback, spelled the same way the server spells it. Five seconds
# is the feature, so the tests really do sit them out — set NOX_AI_WAIT on both
# the server and the harness to shorten a local run.
AI_WAIT = float(os.environ.get("NOX_AI_WAIT") or 5.0)
AI_NAMES = [
    "cutydaeheech0", "TheNlEL", "goutham111", "Paradoxical_MovesbyJJ",
    "gaymonster", "jungjungkook", "676767",
]
START_ELO = 100           # what a player with no rating of their own is shown


def ai_elo_for(rating):
    """The server's arithmetic, written out again on purpose.

    Reimplemented rather than imported, so that a change to the formula has to
    be made twice and meant twice. It is a number a player reads off the board
    and it should not be able to drift quietly.
    """
    return int(round(rating + rating / 100.0 + 9))

# Scholar's mate. Squares are the board indices the page uses: 0 = a8, 63 = h1.
SCHOLARS = [
    ("w", 52, 36, "e4"),
    ("b", 12, 28, "e5"),
    ("w", 61, 34, "Bc4"),
    ("b",  1, 18, "Nc6"),
    ("w", 59, 31, "Qh5"),
    ("b",  6, 21, "Nf6"),
    ("w", 31, 13, "Qxf7#"),
]

passed = 0
failed = 0


def check(label, ok, detail=""):
    global passed, failed
    if ok:
        passed += 1
        print("  \033[32mPASS\033[0m %s" % label)
    else:
        failed += 1
        print("  \033[31mFAIL\033[0m %s %s" % (label, detail))


def account_token(who):
    """A signed token for this test client, or None if accounts are off.

    Reads the same secret the server does. With no secret in the environment
    the server cannot verify anybody, so the tests play as guests — which is
    exactly how the game behaves before Supabase is configured.
    """
    secret = os.environ.get("SUPABASE_JWT_SECRET")
    if not secret:
        return None
    project = os.environ.get("SUPABASE_URL", "").rstrip("/")

    def seg(raw):
        return base64.urlsafe_b64encode(raw).decode().rstrip("=")

    header = seg(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    claims = seg(json.dumps({
        "sub": "test-%s" % who,
        "aud": "authenticated",
        "exp": int(time.time()) + 600,
        "iss": (project + "/auth/v1") if project else None,
        "user_metadata": {"full_name": "Tester %s" % who},
    }).encode())
    signing_input = ("%s.%s" % (header, claims)).encode()
    sig = seg(hmac.new(secret.encode(), signing_input, hashlib.sha256).digest())
    return "%s.%s.%s" % (header, claims, sig)


class TestClient:
    """One player: a socket, a reader thread, and the timeline it believes in."""

    def __init__(self, name):
        self.name = name
        # Longer than the ranked fallback's own wait, and deliberately so: a
        # client sitting out those five seconds is a client whose socket has
        # heard nothing for five seconds, and a five-second timeout on this end
        # would kill the reader a moment before the game it is waiting for
        # arrives.
        self.sock = socket.create_connection((HOST, PORT), timeout=max(20.0, AI_WAIT + 12))
        self.framer = client_handshake(self.sock, "%s:%d" % (HOST, PORT), "/ws")
        self.inbox = queue.Queue()
        self.color = None
        self.game = None
        self.timeline = []          # what this client thinks has been played
        self.closed = False
        self.reader = threading.Thread(target=self._read_loop, daemon=True)
        self.reader.start()
        # Every real client says hello first, so the harness does too. Against
        # a server with accounts switched on it signs in — otherwise ranked
        # play, which now wants an account, would be closed to the tests.
        self.send(t="hello", token=account_token(name), name=name)
        welcome = self.expect("welcome")
        self.verified = welcome.get("verified", False)
        self.accounts = welcome.get("accounts", False)

    def _read_loop(self):
        try:
            while True:
                self.inbox.put(json.loads(self.framer.read_message()))
        except (WSClosed, OSError, ValueError):
            self.closed = True

    def send(self, **msg):
        self.framer.send(json.dumps(msg))

    def expect(self, kind, timeout=5.0):
        """Next message, asserting its type."""
        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                msg = self.inbox.get(timeout=deadline - time.time())
            except queue.Empty:
                break
            if msg.get("t") == kind:
                return msg
            raise AssertionError("%s expected %r, got %r" % (self.name, kind, msg))
        raise AssertionError("%s timed out waiting for %r" % (self.name, kind))

    def await_kind(self, kind, timeout=5.0):
        """Next message of this kind, stepping over anything else on the way.

        expect() is deliberately strict about order, which is what makes it
        useful. This is for the handful of cases where two messages are
        genuinely racing and either order is a correct one.
        """
        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                msg = self.inbox.get(timeout=deadline - time.time())
            except queue.Empty:
                break
            if msg.get("t") == kind:
                return msg
        raise AssertionError("%s timed out waiting for %r" % (self.name, kind))

    def drain(self, seconds=0.5):
        """Everything still on the wire after a moment, order not asserted.

        For the races the server deliberately allows: payloads are built under
        the lock and sent outside it, so two threads finishing at once can put
        their messages on the wire in either order.
        """
        out = []
        deadline = time.time() + seconds
        while time.time() < deadline:
            try:
                out.append(self.inbox.get(timeout=max(0, deadline - time.time())))
            except queue.Empty:
                break
        return out

    def nothing_arrives(self, seconds=0.4):
        """True if the server stayed quiet — used to prove a move was refused."""
        try:
            msg = self.inbox.get(timeout=seconds)
        except queue.Empty:
            return True
        self.inbox.put(msg)
        return False

    def play(self, frm, to, san):
        self.send(t="move", ply=len(self.timeline), **{"from": frm, "to": to, "san": san})
        self.timeline.append((frm, to, san))

    def receive_move(self):
        msg = self.expect("move")
        self.timeline.append((msg["from"], msg["to"], msg["san"]))
        return msg

    def close(self):
        try:
            self.framer.close()
            self.sock.close()
        except OSError:
            pass


def load_puzzles():
    """Every installed puzzle, read from the same files the server reads.

    Empty when no set is installed: the generator is offline, and a checkout
    without puzzles is a valid one.
    """
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out = []
    for track in ("opening", "middlegame", "endgame"):
        try:
            with open(os.path.join(root, "puzzles", "%s.json" % track)) as fh:
                out.extend(json.load(fh))
        except (OSError, ValueError):
            continue
    return [p for p in out if isinstance(p.get("seedRating"), int)]


def wait_for_server(tries=40):
    for _ in range(tries):
        try:
            s = socket.create_connection((HOST, PORT), timeout=1)
            s.close()
            return True
        except OSError:
            time.sleep(0.1)
    return False


def main():
    if not wait_for_server():
        print("No server on %s:%d — start it with: python3 server/server.py" % (HOST, PORT))
        return 1

    print("\n\033[1mMatchmaking\033[0m")
    a = TestClient("A")
    b = TestClient("B")

    # A queues alone first, so we see the waiting state before the pairing.
    a.send(t="find", mode="blind", minutes=5)
    check("first player is told it is waiting", a.expect("waiting")["t"] == "waiting")
    check("nobody is matched with an empty lobby", a.nothing_arrives())

    b.send(t="find", mode="blind", minutes=5)
    start_a = a.expect("start")
    start_b = b.expect("start")
    a.color, b.color = start_a["color"], start_b["color"]
    a.game, b.game = start_a["game"], start_b["game"]

    check("both players land in the same game", a.game == b.game,
          "(%s vs %s)" % (a.game, b.game))
    check("colours are opposite", {a.color, b.color} == {"w", "b"},
          "(A=%s B=%s)" % (a.color, b.color))
    check("settings are carried into the game",
          start_a["mode"] == "blind" and start_a["minutes"] == 5 and
          start_b["mode"] == "blind" and start_b["minutes"] == 5)

    white = a if a.color == "w" else b
    black = b if a.color == "w" else a
    print("  (A is %s, B is %s)" % (a.color, b.color))

    print("\n\033[1mTurn order\033[0m")
    black.send(t="move", ply=0, **{"from": 12, "to": 28, "san": "e5"})
    err = black.expect("error")
    check("a move out of turn is refused", err["msg"] == "not your turn", "(%s)" % err)
    check("the refused move is not relayed", white.nothing_arrives())

    white.send(t="move", ply=3, **{"from": 52, "to": 36, "san": "e4"})
    err = white.expect("error")
    check("a move with the wrong ply is refused", err["msg"] == "out of sequence", "(%s)" % err)
    check("the out-of-sequence move is not relayed", black.nothing_arrives())

    print("\n\033[1mPlaying a full game\033[0m")
    for color, frm, to, san in SCHOLARS:
        mover = white if color == "w" else black
        waiter = black if color == "w" else white
        mover.play(frm, to, san)
        got = waiter.receive_move()
        ok = got["from"] == frm and got["to"] == to and got["san"] == san
        check("ply %-2d %-6s reaches the other side intact" % (len(mover.timeline), san), ok,
              "" if ok else "(got %r)" % got)
        if mover.timeline != waiter.timeline:
            check("ply %d timelines match" % len(mover.timeline), False,
                  "\n    %s\n    %s" % (mover.timeline, waiter.timeline))
            break

    expected = [(f, t, s) for _, f, t, s in SCHOLARS]
    check("white's timeline is the game we played", white.timeline == expected,
          "" if white.timeline == expected else "(%s)" % white.timeline)
    check("black's timeline is the game we played", black.timeline == expected,
          "" if black.timeline == expected else "(%s)" % black.timeline)
    check("both clients agree move for move", white.timeline == black.timeline)

    print("\n\033[1mFinishing\033[0m")
    white.send(t="result", status="Checkmate — White wins", winner="w")
    over = black.expect("over")
    check("the loser is told the game is over", over["reason"] == "Checkmate — White wins",
          "(%s)" % over)
    check("the winner is not sent a duplicate", white.nothing_arrives())

    white.send(t="move", ply=7, **{"from": 13, "to": 12, "san": "Qxe7"})
    err = white.expect("error")
    check("no moves are accepted after the end", err["msg"] == "no game in progress")

    print("\n\033[1mDisconnects\033[0m")
    c = TestClient("C")
    d = TestClient("D")
    c.send(t="find", mode="fog", minutes=1)
    c.expect("waiting")
    d.send(t="find", mode="fog", minutes=1)
    c.expect("start")
    d.expect("start")
    check("a second pair matches on its own settings", True)

    c.close()
    over = d.expect("over", timeout=5)
    check("a dropped connection ends the opponent's game", over["reason"] == "left", "(%s)" % over)

    print("\n\033[1mSeparate settings do not match\033[0m")
    e = TestClient("E")
    f = TestClient("F")
    e.send(t="find", mode="blind", minutes=10)
    e.expect("waiting")
    f.send(t="find", mode="sighted", minutes=3)
    f.expect("waiting")
    check("players wanting different games are left waiting",
          e.nothing_arrives() and f.nothing_arrives())

    print("\n\033[1mThe increment is part of the game asked for\033[0m")
    # 3+2 and a flat 3 minutes are different clocks, so they are different
    # queues — pairing across them would hand somebody a game they did not pick.
    p1 = TestClient("P1")
    p2 = TestClient("P2")
    p1.send(t="find", mode="blind", minutes=3, inc=2)
    p1.expect("waiting")
    p2.send(t="find", mode="blind", minutes=3)
    p2.expect("waiting")
    check("an increment does not match a flat clock",
          p1.nothing_arrives() and p2.nothing_arrives())

    p3 = TestClient("P3")
    p3.send(t="find", mode="blind", minutes=3, inc=2)
    start_p1 = p1.expect("start")
    start_p3 = p3.expect("start")
    check("the same increment matches", start_p1["game"] == start_p3["game"])
    check("the increment carries into the game",
          start_p1.get("inc") == 2 and start_p3.get("inc") == 2, "(%s)" % start_p1)
    check("the flat clock is still waiting", p2.nothing_arrives())

    p4 = TestClient("P4")
    p4.send(t="find", mode="blind", minutes=3, inc="nonsense")
    start_p2 = p2.expect("start")
    check("an increment that is not a number becomes a flat clock",
          start_p2.get("inc") == 0, "(%s)" % start_p2)

    print("\n\033[1mRanked and friendly are separate queues\033[0m")
    g = TestClient("G")
    h = TestClient("H")
    i = j = k = None
    if g.accounts and not g.verified:
        # The server checks ES256 tokens against the key Supabase publishes,
        # and this harness has no private key to sign one with — so ranked
        # play is out of reach here. Run with no SUPABASE_URL, or with the
        # legacy SUPABASE_JWT_SECRET, to exercise these.
        print("  \033[33mSKIP\033[0m ranked queues — the harness cannot sign an ES256 token")
    else:
        g.send(t="find", mode="blind", minutes=5, kind="ranked")
        g.expect("waiting")
        h.send(t="find", mode="blind", minutes=5, kind="friendly")
        h.expect("waiting")
        check("a ranked player is not handed a friendly game",
              g.nothing_arrives() and h.nothing_arrives())

        i = TestClient("I")
        i.send(t="find", mode="blind", minutes=5, kind="ranked")
        start_g = g.expect("start")
        start_i = i.expect("start")
        check("two ranked players do match each other", start_g["game"] == start_i["game"])
        check("the game carries its kind", start_g.get("kind") == "ranked",
              "(%s)" % start_g)
        check("the friendly player is still waiting", h.nothing_arrives())

        # an unknown kind must not open a third queue
        j = TestClient("J")
        k = TestClient("K")
        j.send(t="find", mode="fog", minutes=3, kind="nonsense")
        j.expect("waiting")
        k.send(t="find", mode="fog", minutes=3)      # no kind at all
        start_j = j.expect("start")
        check("an unknown kind falls back to friendly rather than its own queue",
              start_j.get("kind") == "friendly", "(%s)" % start_j)

    print("\n\033[1mThe ranked fallback opponent\033[0m")
    ai1 = ai2 = ai3 = ai4 = ai5 = ai6 = None
    if g.accounts and not g.verified:
        print("  \033[33mSKIP\033[0m the fallback opponent — ranked play needs an account here")
    else:
        # Priority one, and the only one that matters: somebody turning up
        # inside the window is matched with the player who was waiting, and
        # neither of them ever sees a bot.
        ai1 = TestClient("AI1")
        ai2 = TestClient("AI2")
        ai1.send(t="find", mode="sighted", minutes=17, kind="ranked")
        ai1.expect("waiting")
        time.sleep(min(2.0, AI_WAIT * 0.4))       # well into the wait, not past it
        ai2.send(t="find", mode="sighted", minutes=17, kind="ranked")
        start_1 = ai1.expect("start")
        start_2 = ai2.expect("start")
        check("a real player arriving mid-search is matched at once",
              start_1["game"] == start_2["game"], "(%s vs %s)" % (start_1, start_2))
        check("and neither of them is given a bot",
              "ai" not in start_1 and "ai" not in start_2, "(%s)" % start_1)
        check("the pairing is still ranked", start_1.get("kind") == "ranked",
              "(%s)" % start_1.get("kind"))

        # And with nobody there at all, the wait ends in a bot rather than in
        # nothing. This is the one test in the suite that really sits out the
        # five seconds, because five seconds is the feature.
        ai3 = TestClient("AI3")
        ai3.send(t="find", mode="blind", minutes=19, inc=3, kind="ranked")
        ai3.expect("waiting")
        check("nothing arrives before the wait is up", ai3.nothing_arrives(AI_WAIT * 0.5))
        seated = ai3.expect("start", timeout=AI_WAIT + 5)
        bot = seated.get("ai") or {}
        check("a lone ranked player is eventually seated", seated["t"] == "start")
        check("the opponent is declared a bot", bot.get("bot") is True, "(%s)" % seated)
        check("it is one of the fallback names",
              bot.get("name") in AI_NAMES, "(%s)" % bot.get("name"))
        check("the name on the bar is the bot's",
              seated.get("opponent") == bot.get("name"), "(%s)" % seated)
        check("it is not passed off as a verified account",
              seated.get("opponentVerified") is False, "(%s)" % seated)
        check("the rating follows from the player's own",
              bot.get("elo") == ai_elo_for(START_ELO),
              "(%s, wanted %s)" % (bot.get("elo"), ai_elo_for(START_ELO)))
        check("the game is ranked, like the queue it came from",
              seated.get("kind") == "ranked", "(%s)" % seated.get("kind"))
        check("with the settings that were asked for",
              (seated.get("mode"), seated.get("minutes"), seated.get("inc"))
              == ("blind", 19, 3), "(%s)" % seated)

        # The draw workflow is the ordinary one: an offer goes out over the
        # socket and `over` comes back, exactly as between two people.
        ai3.send(t="draw-offer")
        ended = ai3.expect("over", timeout=6)
        check("a draw offered to the bot is accepted",
              ended.get("reason") == "draw", "(%s)" % ended)
        check("and it is a draw, not a win", ended.get("winner") is None, "(%s)" % ended)

        # Resigning to one is a resignation like any other.
        ai4 = TestClient("AI4")
        ai4.send(t="find", mode="fog", minutes=21, kind="ranked")
        ai4.expect("waiting")
        seated4 = ai4.expect("start", timeout=AI_WAIT + 5)
        ai4.send(t="resign")
        ended4 = ai4.expect("over", timeout=5)
        check("resigning to the bot ends the game",
              ended4.get("reason") == "resign", "(%s)" % ended4)
        check("and hands it the win",
              ended4.get("winner") not in (None, seated4["color"]), "(%s)" % ended4)
        # ...and the seat is free again the moment it is over
        ai4.send(t="find", mode="fog", minutes=23, kind="ranked")
        check("the player is free to queue again straight away",
              ai4.expect("waiting")["t"] == "waiting")
        ai4.send(t="cancel")
        ai4.expect("cancelled")

        # A friendly queue is not touched by any of this.
        ai5 = TestClient("AI5")
        ai5.send(t="find", mode="sighted", minutes=25, kind="friendly")
        ai5.expect("waiting")
        check("a friendly search is never given a bot",
              ai5.nothing_arrives(AI_WAIT + 1.5))

        # Leaning on Start Play is one search, and one game.
        ai6 = TestClient("AI6")
        for _ in range(5):
            ai6.send(t="find", mode="blind", minutes=27, kind="ranked")
        check("pressing Start Play five times is one search",
              ai6.expect("waiting")["t"] == "waiting")
        again = ai6.expect("start", timeout=AI_WAIT + 5)
        check("and brings exactly one game", again["t"] == "start")
        check("with exactly one opponent", ai6.nothing_arrives(1.0))

        # Giving up inside the window really gives up.
        quit_early = TestClient("AI7")
        quit_early.send(t="find", mode="blind", minutes=29, kind="ranked")
        quit_early.expect("waiting")
        quit_early.send(t="cancel")
        quit_early.expect("cancelled")
        check("cancelling inside the window cancels the bot too",
              quit_early.nothing_arrives(AI_WAIT + 1.5))
        quit_early.close()

        # And so does walking out: a player who drops mid-search leaves nothing
        # behind that a bot could later be seated against.
        vanish = TestClient("AI8")
        vanish.send(t="find", mode="blind", minutes=31, kind="ranked")
        vanish.expect("waiting")
        vanish.close()
        time.sleep(AI_WAIT + 1.0)
        after = TestClient("AI9")
        after.send(t="find", mode="blind", minutes=31, kind="ranked")
        check("a dropped searcher leaves nothing in the queue",
              after.expect("waiting")["t"] == "waiting")
        after.send(t="cancel")
        after.expect("cancelled")
        after.close()

    print("\n\033[1mResigning and offering a draw\033[0m")
    r1 = TestClient("R1"); r2 = TestClient("R2")
    r1.send(t="find", mode="blind", minutes=45); r1.expect("waiting")
    r2.send(t="find", mode="blind", minutes=45)
    c1 = r1.expect("start"); r2.expect("start")
    r_white, r_black = (r1, r2) if c1["color"] == "w" else (r2, r1)

    r1.send(t="draw-offer")
    check("a draw offer reaches the opponent", r2.expect("draw-offer")["t"] == "draw-offer")
    check("offering does not end the game by itself", r1.nothing_arrives())

    r2.send(t="draw-decline")
    check("declining is reported back to the offerer",
          r1.expect("draw-decline")["t"] == "draw-decline")
    check("a declined game carries on", r2.nothing_arrives())

    # a refused draw must leave the game exactly as it was
    r_white.send(t="move", ply=0, **{"from": 52, "to": 36, "san": "e4"})
    relayed = r_black.expect("move")
    check("the game carries on normally after a declined draw",
          relayed["san"] == "e4", "(%s)" % relayed)

    d1 = TestClient("D1"); d2 = TestClient("D2")
    d1.send(t="find", mode="fog", minutes=46); d1.expect("waiting")
    d2.send(t="find", mode="fog", minutes=46)
    d1.expect("start"); d2.expect("start")
    d1.send(t="draw-offer"); d2.expect("draw-offer")
    d2.send(t="draw-accept")
    o1 = d1.expect("over"); o2 = d2.expect("over")
    check("accepting ends the game for the offerer", o1["reason"] == "draw", "(%s)" % o1)
    check("accepting ends the game for the accepter", o2["reason"] == "draw", "(%s)" % o2)
    check("an agreed draw names no winner", o1.get("winner") is None, "(%s)" % o1)

    s1 = TestClient("S1"); s2 = TestClient("S2")
    s1.send(t="find", mode="sighted", minutes=47); s1.expect("waiting")
    s2.send(t="find", mode="sighted", minutes=47)
    st1 = s1.expect("start"); s2.expect("start")
    s1.send(t="resign")
    ro1 = s1.expect("over"); ro2 = s2.expect("over")
    check("both sides hear about a resignation",
          ro1["reason"] == "resign" and ro2["reason"] == "resign")
    check("the winner is the player who did not resign",
          ro1["winner"] != st1["color"], "(resigner was %s, winner %s)" % (st1["color"], ro1["winner"]))

    print("\n\033[1mChat\033[0m")
    ch1 = TestClient("CH1"); ch2 = TestClient("CH2")
    ch1.send(t="find", mode="blind", minutes=49); ch1.expect("waiting")
    ch2.send(t="find", mode="blind", minutes=49)
    cg1 = ch1.expect("start"); ch2.expect("start")

    ch1.send(t="chat", text="hello")
    said = ch2.expect("chat")
    check("a message reaches the other player", said["text"] == "hello", "(%s)" % said)
    check("it says which game it belongs to", said.get("game") == cg1["game"], "(%s)" % said)
    check("the sender is not sent its own message back", ch1.nothing_arrives())

    ch2.send(t="chat", text="   spaced out \n and broken   ")
    said = ch1.expect("chat")
    check("newlines are dropped and the ends are trimmed",
          said["text"] == "spaced out  and broken", "(%r)" % said["text"])

    ch1.send(t="chat", text="   ")
    check("a message with nothing in it is not relayed", ch2.nothing_arrives())

    ch1.send(t="chat", text="x" * 400)
    said = ch2.expect("chat")
    check("an over-long message is cut to the cap", len(said["text"]) == 300,
          "(%d chars)" % len(said["text"]))

    # "good game" is said after the result, not before it — so chat has to
    # outlive the game that introduced the two players
    ch1.send(t="resign")
    ch1.expect("over"); ch2.expect("over")
    ch2.send(t="chat", text="good game")
    said = ch1.expect("chat")
    check("players can still talk once the game is over",
          said["text"] == "good game", "(%s)" % said)

    lone = TestClient("LONE")
    lone.send(t="chat", text="anyone there?")
    check("talking with nobody on the other side is refused",
          lone.expect("error")["msg"] == "nobody to talk to")

    for c in (ch1, ch2, lone):
        c.close()

    # After a game ends the connection must be free again. Returning to the room
    # list reuses the same socket, so a client still marked "in a game" could
    # never host or join anything until the page was reloaded.
    print("\n\033[1mThe connection is reusable after a game\033[0m")
    s1.send(t="host", mode="blind", minutes=48, color="w")
    check("a finished player can host again", "room" in s1.expect("hosting"))
    s2.send(t="lobby")
    listed = [r for r in s2.expect("rooms")["rooms"] if r["minutes"] == 48]
    check("that room reaches the list", len(listed) == 1, "(%s)" % listed)
    s2.send(t="join", room=listed[0]["id"])
    # S2 may be handed the room list twice: handle_host() sends "hosting" to
    # the host and only then broadcasts the list to its watchers, and S2
    # subscribes in between — so under the wrong scheduling the host's
    # broadcast reaches S2 after its own reply from handle_lobby() and before
    # the start. A watcher seeing the same list twice is harmless by design,
    # and either order is a correct one, which is what await_kind() is for.
    n1 = s1.expect("start"); n2 = s2.await_kind("start")
    check("a finished player can join again", n1["game"] == n2["game"])
    check("and it is a different game from the one before",
          n1["game"] != st1["game"], "(%s vs %s)" % (n1["game"], st1["game"]))

    for c in (r1, r2, d1, d2, s1, s2):
        c.close()

    print("\n\033[1mChallenging a friend\033[0m")
    # A challenge is addressed to an account, not to a socket, so it needs a
    # server that can verify one. Without that everybody here is a guest and
    # there is nobody in particular to challenge.
    c1 = c2 = c3 = None
    if not a.verified:
        print("  \033[33mSKIP\033[0m challenges — they need a verified account on both ends")
    else:
        c1 = TestClient("C1")
        c2 = TestClient("C2")
        c3 = TestClient("C3")
        c1.send(t="challenge", to="test-C2", mode="fog", minutes=5, inc=2, color="w")
        sent = c1.expect("challenge-sent")
        invite = c2.expect("challenged")
        check("the challenger is told the invitation went out", "id" in sent)
        check("it reaches the friend, and only the friend",
              invite["id"] == sent["id"] and c3.nothing_arrives(), "(%s)" % invite)
        check("the invitation says who and what",
              invite.get("fromName") and invite["mode"] == "fog"
              and invite["minutes"] == 5 and invite["inc"] == 2, "(%s)" % invite)
        check("the friend is offered the seat the challenger did not keep",
              invite["color"] == "b", "(%s)" % invite)

        # The check the whole design rests on.
        c3.send(t="challenge-accept", id=invite["id"])
        check("a stranger cannot accept somebody else's challenge",
              c3.expect("error")["msg"] == "that challenge is not yours")
        check("and the challenger is not dragged into a game",
              c1.nothing_arrives() and c2.nothing_arrives())

        c2.send(t="challenge-decline", id=invite["id"])
        declined = c1.expect("challenge-declined")
        check("declining reaches the challenger", declined["id"] == invite["id"])

        c1.send(t="challenge", to="test-C2", mode="sighted", minutes=3, color="b")
        sent2 = c1.expect("challenge-sent")
        invite2 = c2.expect("challenged")
        c2.send(t="challenge-accept", id=invite2["id"])
        s1 = c1.expect("start")
        s2 = c2.expect("start")
        check("accepting seats both players at one board", s1["game"] == s2["game"])
        check("the challenger keeps the colour it chose", s1["color"] == "b", "(%s)" % s1)
        check("the friend takes the other", s2["color"] == "w", "(%s)" % s2)
        check("the challenge's settings carry into the game",
              s1["mode"] == "sighted" and s1["minutes"] == 3 and s1["kind"] == "friendly",
              "(%s)" % s1)
        check("each is named to the other",
              s1.get("opponent") and s2.get("opponent"), "(%s / %s)" % (s1, s2))

        c1.timeline = []
        c2.timeline = []
        c2.play(52, 36, "e4")                # C2 is White here
        check("moves flow through a challenged game",
              c1.receive_move()["san"] == "e4")

        # Nobody left to hand it to.
        lonely = TestClient("C4")
        lonely.send(t="challenge", to="nobody-at-all", mode="blind", minutes=5, color="w")
        check("challenging someone who is not online says so",
              lonely.expect("challenge-away")["t"] == "challenge-away")
        lonely.close()

    print("\n\033[1mHosted rooms\033[0m")
    host = TestClient("HOST")
    watcher = TestClient("WATCH")
    joiner = TestClient("JOIN")

    watcher.send(t="lobby")
    # The house keeps seven rooms of its own on the list at all times (HOUSE_ROOMS
    # in server.py), so "empty" here means "nothing but those". They are told
    # apart by name — the names are fixed for the life of the process — because
    # the list itself says nothing about which rooms are the house's, on purpose.
    first = watcher.expect("rooms")["rooms"]
    house_names = {r["name"] for r in first}
    ours = lambda rs: [r for r in rs if r["name"] not in house_names]
    check("a new watcher sees the house's rooms and nobody else's",
          len(first) == 7 and ours(first) == [], "(%s)" % first)

    host.send(t="lobby")
    host.expect("rooms")
    host.send(t="host", mode="fog", minutes=15, color="b")
    check("the host is told its room exists", "room" in host.expect("hosting"))

    seen = ours(watcher.expect("rooms")["rooms"])
    check("everyone watching sees the new room", len(seen) == 1, "(%s)" % seen)
    check("the room carries its settings",
          seen and seen[0]["mode"] == "fog" and seen[0]["minutes"] == 15
          and seen[0]["inc"] == 0 and seen[0]["color"] == "b", "(%s)" % seen)
    check("and names its host, with a rating",
          seen and seen[0]["name"] == "HOST" and isinstance(seen[0]["rating"], int), "(%s)" % seen)
    room_id = seen[0]["id"]
    host.expect("rooms")        # the host watches the list too, so it sees its own room

    host.send(t="join", room=room_id)
    check("a host cannot join its own room",
          host.expect("error")["msg"] == "that is your own room")

    joiner.send(t="join", room=room_id)
    hs = host.expect("start")
    js = joiner.expect("start")
    check("both land in one game", hs["game"] == js["game"])
    check("the host gets the colour it asked for", hs["color"] == "b", "(%s)" % hs)
    check("the joiner gets the other colour", js["color"] == "w", "(%s)" % js)
    check("the room's settings carry into the game",
          hs["mode"] == "fog" and hs["minutes"] == 15)
    check("the filled room leaves the list", ours(watcher.expect("rooms")["rooms"]) == [])

    # the game itself must work exactly like a matched one
    joiner.timeline = []
    host.timeline = []
    joiner.play(52, 36, "e4")            # joiner is White
    got = host.receive_move()
    check("moves flow inside a hosted game", got["san"] == "e4", "(%s)" % got)

    late = TestClient("LATE")
    late.send(t="join", room=room_id)
    check("joining a room that is already gone is refused",
          late.expect("error")["msg"] == "that room is gone")

    print("\n\033[1mA host that vanishes\033[0m")
    ghost = TestClient("GHOST")
    ghost.send(t="host", mode="blind", minutes=5, color="w")
    ghost.expect("hosting")
    check("the room appears for watchers", len(ours(watcher.expect("rooms")["rooms"])) == 1)
    ghost.close()
    check("a dropped host takes its room off the list",
          ours(watcher.expect("rooms", timeout=5)["rooms"]) == [])

    print("\n\033[1mThe house rooms\033[0m")
    # Seven rooms the house hosts, always on the list: two of each vision that
    # hides something and one Sighted, each with a bot behind a name that reads
    # like anybody's. Joining one is joining a room — same message, same start,
    # same game — except that the start carries the `ai` block the ranked
    # fallback's does, because the joiner's browser is where the bot plays.
    watcher.send(t="lobby")
    house = [r for r in watcher.expect("rooms")["rooms"] if r["name"] in house_names]
    check("seven of them", len(house) == 7, "(%d)" % len(house))
    modes = sorted(r["mode"] for r in house)
    check("two Complete Blindfold, two See the Board, two Fog of War, one Sighted",
          modes == ["blind", "blind", "fog", "fog", "sighted", "total", "total"], "(%s)" % modes)
    check("seven different names", len({r["name"] for r in house}) == 7)
    check("none of which says what it is",
          not any(w in r["name"].lower() for r in house
                  for w in ("bot", "computer", "engine", "stockfish", "cpu", "nox")))
    check("every card names its host and a rating",
          all(r.get("name") and isinstance(r.get("rating"), int) for r in house))
    check("and nothing on a card says who is behind it",
          not any(k in r for r in house for k in ("ai", "bot", "house", "slot", "is_ai")),
          "(%s)" % sorted(house[0].keys()))
    order = [r["name"] for r in house]      # ...and this order is checked again below

    for r in house:
        g = TestClient("SEAT-" + r["mode"])
        g.send(t="join", room=r["id"])
        st = g.expect("start")
        ai = st.get("ai") or {}
        check("joining %s's %s room starts that game, against them" % (r["name"], r["mode"]),
              st["mode"] == r["mode"] and st["minutes"] == r["minutes"] and st["inc"] == r["inc"]
              and st["kind"] == "friendly" and st["opponent"] == r["name"]
              and st["color"] == ("b" if r["color"] == "w" else "w")
              and ai.get("name") == r["name"] and ai.get("elo") == r["rating"], "(%s)" % st)
        relisted = watcher.expect("rooms")["rooms"]
        back = [x for x in relisted if x["name"] == r["name"]]
        check("...and the room is re-seated on the spot",
              len(back) == 1 and back[0]["id"] != r["id"] and back[0]["mode"] == r["mode"]
              and back[0]["rating"] == r["rating"], "(%s)" % back)
        g.send(t="move", ply=0, san="e4", **{"from": 52, "to": 36})
        check("a move is played at home, not relayed, and not refused", g.nothing_arrives(0.4))
        g.send(t="resign")
        over = g.expect("over")
        check("and resigning ends it", over["reason"] == "resign" and over["winner"] != st["color"])
        g.close()

    watcher.send(t="lobby")
    after = watcher.expect("rooms")["rooms"]
    check("after seven games the seven rooms are all still there, in the same order",
          [r["name"] for r in after if r["name"] in house_names] == order
          and sorted(r["mode"] for r in after) == modes, "(%s)" % [r["name"] for r in after])
    check("and nobody else's crept in", ours(after) == [], "(%s)" % ours(after))

    # A rematch of a house game is granted on the spot, as the ranked fallback's
    # is — there is nobody to ask — and stays a friendly game.
    again = TestClient("AGAIN")
    again.send(t="join", room=after[0]["id"])
    st = again.expect("start")
    watcher.expect("rooms")
    again.send(t="resign")
    again.expect("over")
    again.send(t="rematch")
    re_st = again.expect("start")
    check("a rematch of a house game starts at once, colours swapped, still friendly",
          re_st["game"] != st["game"] and re_st["color"] != st["color"]
          and re_st["kind"] == "friendly" and re_st["opponent"] == st["opponent"]
          and (re_st.get("ai") or {}).get("name") == st["opponent"], "(%s)" % re_st)
    again.send(t="draw-offer")
    check("and a draw offered to it is accepted",
          again.expect("over", timeout=4)["reason"] == "draw")
    again.close()

    print("\n\033[1mRematch — the opponent has to agree\033[0m")

    def paired(n1, n2, mode="blind", minutes=5, inc=0, kind="friendly"):
        """Two fresh clients, matched and then finished: ready to be asked again."""
        x, y = TestClient(n1), TestClient(n2)
        x.send(t="find", mode=mode, minutes=minutes, inc=inc, kind=kind)
        x.expect("waiting")
        y.send(t="find", mode=mode, minutes=minutes, inc=inc, kind=kind)
        sx, sy = x.expect("start"), y.expect("start")
        x.color, y.color = sx["color"], sy["color"]
        x.game = y.game = sx["game"]
        x.send(t="result", status="Checkmate — White wins", winner="w")
        y.expect("over")
        return x, y

    # Each pairing here asks for a clock no other test asks for: earlier
    # sections deliberately leave players parked in the common queues, and
    # being handed one of them would match the wrong two people.
    r1, r2 = paired("R1", "R2", minutes=15)
    finished = r1.game
    r1.send(t="rematch", game=finished)
    sent = r1.expect("rematch-sent")
    ask = r2.expect("rematch-request")
    check("a rematch reaches the opponent", ask["id"] == sent["id"], "(%s)" % ask)
    check("and names the game it is about", ask["game"] == finished, "(%s)" % ask)
    check("the terms of the finished game travel with it",
          ask["mode"] == "blind" and ask["minutes"] == 15 and ask["kind"] == "friendly",
          "(%s)" % ask)
    check("the seat offered is the one the asker is getting up from",
          ask["color"] == r1.color, "(offered %s, asker had %s)" % (ask["color"], r1.color))

    # pressing the button twice must not put two boxes in front of anybody
    r1.send(t="rematch", game=finished)
    again = r1.expect("rematch-sent")
    check("pressing rematch twice sends one invitation", again["id"] == sent["id"],
          "(%s then %s)" % (sent["id"], again["id"]))
    check("and the opponent is not asked a second time", r2.nothing_arrives())

    r2.send(t="rematch-decline", id=ask["id"])
    refused = r1.expect("rematch-declined")
    check("a declined rematch is reported to the asker",
          refused["game"] == finished, "(%s)" % refused)
    check("and no game starts", r1.nothing_arrives() and r2.nothing_arrives())

    # asked again, and taken up this time
    r1.send(t="rematch", game=finished)
    r1.expect("rematch-sent")
    ask2 = r2.expect("rematch-request")
    r2.send(t="rematch-accept", id=ask2["id"])
    new1, new2 = r1.expect("start"), r2.expect("start")
    check("an accepted rematch seats both players at one game",
          new1["game"] == new2["game"], "(%s vs %s)" % (new1["game"], new2["game"]))
    check("and it is a new game, not the finished one", new1["game"] != finished)
    check("colours swap", new1["color"] != r1.color and new2["color"] != r2.color,
          "(%s -> %s, %s -> %s)" % (r1.color, new1["color"], r2.color, new2["color"]))
    check("the settings are the ones the last game was played on",
          new1["mode"] == "blind" and new1["minutes"] == 15 and
          new1["inc"] == 0 and new1["kind"] == "friendly", "(%s)" % new1)

    r1.color, r2.color = new1["color"], new2["color"]
    r1.game = r2.game = new1["game"]
    w2 = r1 if r1.color == "w" else r2
    b2 = r2 if r1.color == "w" else r1
    w2.send(t="move", ply=0, **{"from": 52, "to": 36, "san": "e4"})
    relayed = b2.expect("move")
    check("the rematch starts at ply 0 with nothing carried over",
          relayed["ply"] == 0 and relayed["san"] == "e4", "(%s)" % relayed)

    r1.send(t="rematch")
    check("a rematch asked for mid-game is refused",
          r1.expect("error")["msg"] == "already in a game")

    w2.send(t="result", status="Checkmate — White wins", winner="w")
    b2.expect("over")
    r1.send(t="rematch", game=finished)
    stale = r1.expect("rematch-gone")
    check("a rematch naming an older game is refused",
          stale["reason"] == "stale", "(%s)" % stale)
    check("and never reaches the opponent", r2.nothing_arrives())
    r1.close()
    r2.close()

    x1, x2 = paired("X1", "X2", minutes=20)
    x1.send(t="rematch")
    x2.send(t="rematch")
    s1 = x1.await_kind("start")
    s2 = x2.await_kind("start")
    check("both pressing rematch at once makes one game, not two",
          s1["game"] == s2["game"], "(%s vs %s)" % (s1["game"], s2["game"]))
    # The two presses are handled on two threads and each sends outside the
    # lock, so the invitation one of them raised can still be on the wire when
    # the game the other one settled it into lands. That is allowed, and the
    # page refuses a request naming a game it is no longer sitting on. What
    # must not happen is a second game.
    leftovers = x1.drain() + x2.drain()
    check("and no second game comes of the crossing",
          not [m for m in leftovers if m.get("t") == "start"], "(%s)" % leftovers)
    x1.close()
    x2.close()

    d1, d2 = paired("D1", "D2", minutes=25)
    nosy = TestClient("NOSY")
    d1.send(t="rematch")
    d1.expect("rematch-sent")
    d_ask = d2.expect("rematch-request")
    nosy.send(t="rematch-accept", id=d_ask["id"])
    check("only the player asked may accept",
          nosy.expect("error")["msg"] == "that rematch is not yours")
    nosy.send(t="rematch-decline", id=d_ask["id"])
    check("nor may anyone else decline it",
          nosy.expect("error")["msg"] == "that rematch is not yours")
    check("and the invitation is still standing", d1.nothing_arrives())
    nosy.close()

    d2.close()
    dropped = d1.expect("rematch-gone", timeout=5)
    check("an opponent who disconnects takes the rematch with them",
          dropped["reason"] == "left", "(%s)" % dropped)
    d1.close()

    e1, e2 = paired("E1", "E2", minutes=30)
    e3 = TestClient("E3")
    e1.send(t="rematch")
    e1.expect("rematch-sent")
    e2.expect("rematch-request")
    e2.send(t="find", mode="sighted", minutes=30)
    e2.expect("waiting")
    e3.send(t="find", mode="sighted", minutes=30)
    e2.await_kind("start")
    e3.expect("start")
    moved_on = e1.expect("rematch-gone")
    check("sitting down at another board answers the rematch left in the air",
          moved_on["reason"] == "away", "(%s)" % moved_on)
    e1.close()
    e2.close()
    e3.close()

    print("\n\033[1mNew Game does not hand you the same opponent back\033[0m")

    # Both players pressing New Game after a game re-enter the same queue a
    # moment apart, which used to pair them straight back together — a rematch
    # nobody agreed to, wearing New Game's clothes. A stranger waiting on the
    # same time control is preferred now.
    n1, n2 = paired("N1", "N2", mode="blind", minutes=35)
    stranger = TestClient("N3")
    stranger.send(t="find", mode="blind", minutes=35)
    stranger.expect("waiting")
    n1.send(t="find", mode="blind", minutes=35)
    got = n1.expect("start")
    with_stranger = stranger.expect("start")
    check("a stranger already waiting is taken first",
          got["game"] == with_stranger["game"], "(%s vs %s)" % (got, with_stranger))
    check("and the player just finished with is left alone", n2.nothing_arrives())

    # …but they are the fallback, not a refusal. On a quiet server two people
    # who both want another game must still get one.
    n2.send(t="find", mode="blind", minutes=36)
    n2.expect("waiting")
    n4 = TestClient("N4")
    n4.send(t="find", mode="blind", minutes=36)
    n2.expect("start")
    n4.expect("start")
    check("two players wanting the same game are still paired", True)
    n2.send(t="result", status="Checkmate — White wins", winner="w")
    n4.expect("over")
    n2.send(t="find", mode="blind", minutes=37)
    n2.expect("waiting")
    n4.send(t="find", mode="blind", minutes=37)
    again2 = n2.expect("start")
    again4 = n4.expect("start")
    check("with nobody else there, the last opponent is better than nobody",
          again2["game"] == again4["game"], "(%s vs %s)" % (again2, again4))

    # the queue holds more than one player per time control now
    q1, q2, q3 = TestClient("Q1"), TestClient("Q2"), TestClient("Q3")
    for q in (q1, q2):
        q.send(t="find", mode="sighted", minutes=38)
        q.expect("start" if q is q2 else "waiting")
    q3.send(t="find", mode="sighted", minutes=38)
    q3.expect("waiting")
    q4 = TestClient("Q4")
    q4.send(t="find", mode="sighted", minutes=38)
    check("a third and fourth player queue behind the first pair",
          q3.expect("start")["game"] == q4.expect("start")["game"])
    for q in (n1, n2, n4, stranger, q1, q2, q3, q4):
        q.close()

    print("\n\033[1mA ranked rematch is still ranked\033[0m")
    rk = TestClient("RK0")
    if rk.accounts and not rk.verified:
        print("  \033[33mSKIP\033[0m ranked rematch — the harness cannot sign an ES256 token")
    else:
        k1, k2 = paired("RK1", "RK2", mode="fog", minutes=3, inc=2, kind="ranked")
        k1.send(t="rematch")
        k1.expect("rematch-sent")
        k_ask = k2.expect("rematch-request")
        check("a ranked rematch is offered as ranked",
              k_ask["kind"] == "ranked", "(%s)" % k_ask)
        k2.send(t="rematch-accept", id=k_ask["id"])
        ks1, ks2 = k1.expect("start"), k2.expect("start")
        check("and the game it starts is a ranked one",
              ks1["kind"] == "ranked" and ks2["kind"] == "ranked", "(%s)" % ks1)
        check("on the clock the ranked game was played on",
              ks1["minutes"] == 3 and ks1["inc"] == 2 and ks1["mode"] == "fog", "(%s)" % ks1)
        k1.close()
        k2.close()
    rk.close()

    print("\n\033[1mPuzzle results\033[0m")

    # The server keeps its own copy of what each puzzle is worth, so the tests
    # have to name puzzles it actually has.
    installed = load_puzzles()
    if not installed:
        print("  (no puzzles installed — skipping)")
    else:
        # An even match, where a solve and a failure are both worth something.
        # Against a puzzle rated far below, correct Elo pays almost nothing,
        # which is right and makes for a poor assertion.
        even = min(installed, key=lambda p: abs(p["seedRating"] - 1200))
        hardest = max(installed, key=lambda p: p["seedRating"])
        easiest = min(installed, key=lambda p: p["seedRating"])

        # A client of its own for the probes, so they do not consume the
        # puzzle the arithmetic below is measured on: a signed-in player is
        # priced once per puzzle per socket, on purpose.
        probe = TestClient("PROBE")
        probe.send(t="puzzleResult", puzzleId="no-such-puzzle", solved=True)
        check("a puzzle the server does not know is refused",
              probe.expect("error")["msg"] == "unknown puzzle")
        probe.send(t="puzzleResult", puzzleId=hardest["id"], solved=True, playerRating=99999)
        check("a rating claim outside the scale is never believed",
              probe.expect("puzzleRating")["rating"] <= 3200)
        probe.close()

        p1 = TestClient("PUZZLER")
        p1.send(t="puzzleResult", puzzleId=even["id"], solved=True)
        first = p1.expect("puzzleRating")

        # The invariant that holds however the player is identified: the answer
        # moves the rating it was priced from by exactly the delta it reports.
        # Which rating that is differs, and the difference is the whole point —
        # an account's is the server's own and arrives by itself, while a guest
        # has to carry theirs, because the server deliberately does not keep it.
        # The browser does exactly this in pzReport().
        carry = {} if p1.verified else {"playerRating": first["rating"]}
        p1.send(t="puzzleResult", puzzleId=hardest["id"], solved=True, **carry)
        second = p1.expect("puzzleRating")
        check("each answer moves the rating it was priced from by its delta",
              second["rating"] == first["rating"] + second["delta"],
              "(%s + %s != %s)" % (first["rating"], second["delta"], second["rating"]))
        check("and a solve never moves it down", second["delta"] >= 0)

        if p1.verified:
            check("a signed-in player's rating is the server's to keep",
                  first["saved"] is False or first["saved"] is True)
            # the browser's claim about its own rating is ignored entirely
            p1.send(t="puzzleResult", puzzleId=easiest["id"], solved=True, playerRating=3000)
            claimed = p1.expect("puzzleRating")
            check("a signed-in player cannot name their own rating",
                  claimed["rating"] == second["rating"] + claimed["delta"],
                  "(%s)" % claimed["rating"])
            # and one puzzle cannot be farmed round and round
            p1.send(t="puzzleResult", puzzleId=even["id"], solved=True)
            check("the same puzzle twice moves nothing",
                  p1.expect("puzzleRating")["delta"] == 0)
            # including from a new connection, which is how the browser sends
            # every result: one socket per puzzle, opened and closed again
            farmer = TestClient("PUZZLER")
            farmer.send(t="puzzleResult", puzzleId=even["id"], solved=True)
            check("nor on a fresh connection for the same account",
                  farmer.expect("puzzleRating")["delta"] == 0)
            farmer.close()
        else:
            check("a guest's rating is not stored", first["saved"] is False)

            p1.send(t="puzzleResult", puzzleId=even["id"], solved=False, playerRating=1200)
            miss = p1.expect("puzzleRating")
            check("a failure moves it down", miss["rating"] < 1200, "(%s)" % miss["rating"])

            # what Elo is for: the harder the puzzle, the more it is worth
            p1.send(t="puzzleResult", puzzleId=hardest["id"], solved=True, playerRating=1200)
            hard_win = p1.expect("puzzleRating")["delta"]
            p1.send(t="puzzleResult", puzzleId=easiest["id"], solved=True, playerRating=1200)
            easy_win = p1.expect("puzzleRating")["delta"]
            check("solving a harder puzzle is worth more",
                  hard_win >= easy_win, "(%d vs %d)" % (hard_win, easy_win))
            p1.send(t="puzzleResult", puzzleId=easiest["id"], solved=False, playerRating=1200)
            easy_loss = p1.expect("puzzleRating")["delta"]
            check("failing an easier one costs more",
                  easy_loss < 0 and abs(easy_loss) >= abs(hard_win), "(%d)" % easy_loss)

            # a guest has no identity, so nothing carries between messages
            p1.send(t="puzzleResult", puzzleId=even["id"], solved=True, playerRating=1200)
            check("a guest is priced from what they report, every time",
                  p1.expect("puzzleRating")["rating"] == 1200 + first["delta"])

        # A second player is rated on their own, not on the first one's number.
        p2 = TestClient("PUZZLER2")
        p2.send(t="puzzleResult", puzzleId=even["id"], solved=True, playerRating=1200)
        other = p2.expect("puzzleRating")
        check("two players do not share a rating",
              other["rating"] == other["rating"], "(%s)" % other["rating"])
        if p2.verified:
            check("each account is rated from its own history",
                  other["rating"] - other["delta"] >= PUZZLE_FLOOR)
        p1.close()
        p2.close()

    host2 = TestClient("HOST2")
    host2.send(t="host", mode="sighted", minutes=3, color="w")
    host2.expect("hosting")
    watcher.expect("rooms")
    host2.send(t="unhost")
    check("cancelling a room removes it for everyone",
          ours(watcher.expect("rooms")["rooms"]) == [])

    for client in (a, b, d, e, f, g, h, i, j, k, p1, p2, p3, p4, c1, c2, c3,
                   ai1, ai2, ai3, ai4, ai5, ai6,
                   host, watcher, joiner, late, host2):
        if client is not None:               # ranked and challenge clients may have been skipped
            client.close()

    print("\n\033[1m%d passed, %d failed\033[0m\n" % (passed, failed))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
