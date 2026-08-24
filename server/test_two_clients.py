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
        self.sock = socket.create_connection((HOST, PORT), timeout=5)
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
    n1 = s1.expect("start"); n2 = s2.expect("start")
    check("a finished player can join again", n1["game"] == n2["game"])
    check("and it is a different game from the one before",
          n1["game"] != st1["game"], "(%s vs %s)" % (n1["game"], st1["game"]))

    for c in (r1, r2, d1, d2, s1, s2):
        c.close()

    print("\n\033[1mHosted rooms\033[0m")
    host = TestClient("HOST")
    watcher = TestClient("WATCH")
    joiner = TestClient("JOIN")

    watcher.send(t="lobby")
    check("the list starts empty for a new watcher", watcher.expect("rooms")["rooms"] == [])

    host.send(t="lobby")
    host.expect("rooms")
    host.send(t="host", mode="fog", minutes=15, color="b")
    check("the host is told its room exists", "room" in host.expect("hosting"))

    seen = watcher.expect("rooms")["rooms"]
    check("everyone watching sees the new room", len(seen) == 1, "(%s)" % seen)
    check("the room carries its settings",
          seen and seen[0]["mode"] == "fog" and seen[0]["minutes"] == 15
          and seen[0]["color"] == "b", "(%s)" % seen)
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
    check("the filled room leaves the list", watcher.expect("rooms")["rooms"] == [])

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
    check("the room appears for watchers", len(watcher.expect("rooms")["rooms"]) == 1)
    ghost.close()
    check("a dropped host takes its room off the list",
          watcher.expect("rooms", timeout=5)["rooms"] == [])

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
          watcher.expect("rooms")["rooms"] == [])

    for client in (a, b, d, e, f, g, h, i, j, k,
                   host, watcher, joiner, late, host2):
        if client is not None:               # ranked clients may have been skipped
            client.close()

    print("\n\033[1m%d passed, %d failed\033[0m\n" % (passed, failed))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
