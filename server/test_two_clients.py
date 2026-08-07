"""Two WebSocket clients play a full game against each other through the server.

Each simulated client keeps its own timeline, built only from what it actually
knows: the moves it sent and the relays it received. If the server syncs state
correctly the two timelines are identical at every ply, and identical to the
game we meant to play.

Run the server first, then:  python3 server/test_two_clients.py
"""

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

    for client in (a, b, d, e, f):
        client.close()

    print("\n\033[1m%d passed, %d failed\033[0m\n" % (passed, failed))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
