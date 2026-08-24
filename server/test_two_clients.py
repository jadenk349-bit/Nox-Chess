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
    n1 = s1.expect("start"); n2 = s2.expect("start")
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
    check("the list starts empty for a new watcher", watcher.expect("rooms")["rooms"] == [])

    host.send(t="lobby")
    host.expect("rooms")
    host.send(t="host", mode="fog", minutes=15, color="b")
    check("the host is told its room exists", "room" in host.expect("hosting"))

    seen = watcher.expect("rooms")["rooms"]
    check("everyone watching sees the new room", len(seen) == 1, "(%s)" % seen)
    check("the room carries its settings",
          seen and seen[0]["mode"] == "fog" and seen[0]["minutes"] == 15
          and seen[0]["inc"] == 0 and seen[0]["color"] == "b", "(%s)" % seen)
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

    host2 = TestClient("HOST2")
    host2.send(t="host", mode="sighted", minutes=3, color="w")
    host2.expect("hosting")
    watcher.expect("rooms")
    host2.send(t="unhost")
    check("cancelling a room removes it for everyone",
          watcher.expect("rooms")["rooms"] == [])

    for client in (a, b, d, e, f, g, h, i, j, k, p1, p2, p3, p4, c1, c2, c3,
                   host, watcher, joiner, late, host2):
        if client is not None:               # ranked and challenge clients may have been skipped
            client.close()

    print("\n\033[1m%d passed, %d failed\033[0m\n" % (passed, failed))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
