"""The league over the wire: what the home page is actually pushed.

test_league.py runs the league in one process against a stub engine. This
runs it the way it is deployed — a server, a real Stockfish, a socket — and
asks the two questions only that can answer: does {t:"live"} get four games
back and every move after, and do the moves it is pushed replay as legal
chess. It also reads /live.json and /health, which are the same numbers by
the other door.

Run the server first, playing quickly. Without a service key the league reads
the real leaderboard accounts with the page's public key and keeps results in
memory; NOX_LEAGUE_FIXTURE=<file> reads profile rows from a JSON file instead,
for a run with no network. A ladder with no AI accounts on it yet (the
migration not run) has no game, and this reports that rather than failing:

    NOX_LEAGUE_FAST=1 python3 server/server.py
    python3 server/test_league_socket.py

Point it elsewhere with WS_TEST_HOST / PORT, as test_two_clients.py does.
"""

import json
import os
import socket
import sys
import time
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from wsproto import client_handshake, WSClosed

try:
    import chess
except ImportError:
    print("python-chess is not installed; pip install -r requirements.txt")
    sys.exit(1)

HOST = os.environ.get("WS_TEST_HOST", "127.0.0.1")
PORT = int(os.environ.get("PORT", "8787"))

passed = 0
failed = 0


def check(label, got, want):
    global passed, failed
    if got == want:
        passed += 1
        print("  \033[32mPASS\033[0m %s  ->  %r" % (label, got))
    else:
        failed += 1
        print("  \033[31mFAIL\033[0m %s\n        got  %r\n        want %r" % (label, got, want))


def http_json(path):
    with urllib.request.urlopen("http://%s:%d%s" % (HOST, PORT, path), timeout=5) as resp:
        return json.loads(resp.read())


class Watcher:
    def __init__(self):
        self.sock = socket.create_connection((HOST, PORT), timeout=10)
        self.framer = client_handshake(self.sock, "%s:%d" % (HOST, PORT), "/ws")
        self.framer.send(json.dumps({"t": "live"}))

    def read(self, timeout=10):
        self.sock.settimeout(timeout)
        try:
            return json.loads(self.framer.read_message())
        except (socket.timeout, WSClosed):
            return None

    def close(self):
        try:
            self.framer.send(json.dumps({"t": "unlive"}))
        except Exception:                       # noqa: BLE001
            pass
        self.sock.close()


def replays(snapshot):
    """Every move in the snapshot is legal from the start, and lands on its FEN."""
    board = chess.Board()
    try:
        for u in snapshot["moves"].split():
            board.push_uci(u)
    except ValueError:
        return False
    return board.fen() == snapshot["fen"] and \
        (board.turn == chess.WHITE) == (snapshot["turn"] == "w")


def main():
    health = http_json("/health")
    if not health.get("league"):
        print("the server is not running the league (NOX_LEAGUE=memory to test without a key)")
        sys.exit(1)
    print("\n\033[1mBy HTTP\033[0m")
    check("/health names the engine", bool(health["league"].get("engine")), True)
    live = http_json("/live.json")
    check("/live.json is the snapshot", live.get("t"), "live-games")
    check("...one entry per vision", [g["mode"] for g in live["games"]], ["sighted", "total", "blind", "fog"])

    print("\n\033[1mBy socket\033[0m")
    w = Watcher()
    first = w.read()
    check("{t:'live'} answers at once", first and first.get("t"), "live-games")
    check("...with four games", len(first["games"]), 4)
    check("...stamped with the server's clock", isinstance(first.get("at"), int), True)
    started = {g["mode"]: g for g in first["games"]}
    # give the league a moment to have every board going
    deadline = time.time() + 20
    latest = first
    while time.time() < deadline and not all(g["status"] in ("live", "finished") for g in latest["games"]):
        msg = w.read(5)
        if msg and msg.get("t") == "live-games":
            latest = msg
    playing = [g["mode"] for g in latest["games"] if g["status"] in ("live", "finished")]
    check("at least one ladder has a game", len(playing) >= 1, True)
    for g in latest["games"]:
        if g["status"] == "waiting":
            print("  \033[33mSKIP\033[0m %s has nobody on its ladder here" % g["mode"])
            continue
        for side in ("white", "black"):
            name = g[side]["name"].lower()
            check("%s %s is shown as a plain player name" % (g["mode"], side),
                  any(w in name for w in ("bot", "stockfish", "cpu", "engine", " ai", "ai-", "ai_")), False)
        check("%s names two different players" % g["mode"], g["white"]["id"] != g["black"]["id"], True)
        check("%s ratings are within a hundred" % g["mode"],
              abs(g["white"]["rating"] - g["black"]["rating"]) <= 100, True)
        check("%s moves replay to its FEN" % g["mode"], replays(g), True)
        check("%s clocks are thirty minutes or less" % g["mode"],
              0 <= g["whiteMs"] <= 1800000 and 0 <= g["blackMs"] <= 1800000, True)

    # watch moves arrive: plies only ever go up, and every snapshot replays
    plies = {g["mode"]: g.get("ply", 0) for g in latest["games"]}
    ids = {g["mode"]: g.get("id") for g in latest["games"]}
    grew = {m: False for m in playing}
    monotonic = True
    legal = True
    finished = False
    deadline = time.time() + 25
    while time.time() < deadline:
        msg = w.read(5)
        if not msg or msg.get("t") != "live-games":
            continue
        for g in msg["games"]:
            if g["status"] == "waiting":
                continue
            if g["status"] == "finished":
                finished = True
            if g["mode"] not in grew:
                grew[g["mode"]] = False
            if g.get("id") == ids[g["mode"]]:
                if g["ply"] < plies[g["mode"]]:
                    monotonic = False
                if g["ply"] > plies[g["mode"]]:
                    grew[g["mode"]] = True
                plies[g["mode"]] = g["ply"]
            else:
                ids[g["mode"]] = g.get("id")
                plies[g["mode"]] = g.get("ply", 0)
            if not replays(g):
                legal = False
        if all(grew.values()) and finished:
            break
    check("moves were pushed for every ladder with a game", all(grew.values()), True)
    check("plies only ever go up within a game", monotonic, True)
    check("every pushed position replays as legal chess", legal, True)
    check("a game finished while watching (FAST mode)", finished, True)
    w.close()

    # a second watcher gets the same picture, and unlive stops the pushes
    w2 = Watcher()
    again = w2.read()
    check("a second watcher is answered too", again and again.get("t"), "live-games")
    w2.framer.send(json.dumps({"t": "unlive"}))
    time.sleep(1.5)
    # drain anything that was in flight, then expect silence
    quiet = True
    w2.sock.settimeout(2)
    t0 = time.time()
    while time.time() - t0 < 2.5:
        msg = w2.read(1)
        if msg is None:
            break
        if time.time() - t0 > 1.0:
            quiet = False
    check("unlive stops the pushes", quiet, True)
    w2.sock.close()

    print("\n\033[1m%d passed, %d failed\033[0m\n" % (passed, failed))
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
