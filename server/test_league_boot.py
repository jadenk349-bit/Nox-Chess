"""The production startup path: does the league start itself?

Not the league's functions — test_league.py has those — but the thing that
was actually broken in production: a server that booted, served the site,
and never started the league because one precondition failed once at
startup and nothing tried again or said why anywhere anybody looked. So
this runs the server the way the Dockerfile does (`python3 server/server.py`,
$PORT, nothing else), against a fixture of profile rows and the results kept
in memory, and asks the server itself — /health, /live.json, its log — three
questions:

  1. with an engine on PATH, does the league reach "running" on its own and
     seat a game on every one of the four ladders?
  2. with PATH stripped of it — the container's exact failure — does it find
     the engine by looking, and say where?
  3. with NOX_STOCKFISH pointing at nothing, does /health say "stockfish
     unavailable", does the page get a sentence, and does the log say which
     setting to fix — with the server still serving the site?

Needs a Stockfish somewhere on this machine (on PATH, or at one of the places
league.py looks); question 2 is skipped when it is only on PATH. No network.

    python3 server/test_league_boot.py
"""

import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import uuid

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import league

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


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def fixture_file():
    """Twenty-one AI accounts, rated on all four ladders, and one human at the
    top of one of them — the shape the real leaderboard has."""
    rows = []
    for i in range(21):
        rows.append({
            "id": str(uuid.uuid5(uuid.NAMESPACE_URL, "nox-boot-test-%d" % i)),
            "display_name": "Fixture%02d" % i,
            "is_bot": True,
            "rating": 2900 - 12 * i,
            "complete_blindfold_rating": 2700 - 9 * i,
            "board_only_rating": 2600 - 15 * i,
            "fog_of_war_rating": 2500 - 20 * i,
        })
    rows.append({"id": str(uuid.uuid5(uuid.NAMESPACE_URL, "nox-boot-test-human")),
                 "display_name": "A Person", "is_bot": False, "rating": 2950,
                 "complete_blindfold_rating": 100, "board_only_rating": 100, "fog_of_war_rating": 100})
    path = os.path.join(tempfile.mkdtemp(), "profiles.json")
    with open(path, "w") as fh:
        json.dump(rows, fh)
    return path


class Server:
    """The real entrypoint, as a subprocess, with its log captured."""

    def __init__(self, env):
        self.port = free_port()
        full = {k: v for k, v in os.environ.items() if not k.startswith("SUPABASE_") and not k.startswith("NOX_")}
        full.update(env)
        full["PORT"] = str(self.port)
        full["PYTHONUNBUFFERED"] = "1"
        self.proc = subprocess.Popen(
            [sys.executable, os.path.join(HERE, "server.py")], env=full,
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, cwd=os.path.dirname(HERE))
        self.lines = []
        import threading
        self.reader = threading.Thread(target=self._read, daemon=True)
        self.reader.start()

    def _read(self):
        for line in self.proc.stdout:
            self.lines.append(line.rstrip("\n"))

    def log(self):
        return "\n".join(self.lines)

    def get(self, path):
        with urllib.request.urlopen("http://127.0.0.1:%d%s" % (self.port, path), timeout=5) as resp:
            return json.loads(resp.read())

    def wait_http(self, limit=15):
        t0 = time.time()
        while time.time() - t0 < limit:
            try:
                return self.get("/health")
            except (urllib.error.URLError, OSError, ValueError):
                time.sleep(0.1)
        return None

    def wait_state(self, want, limit=20):
        t0 = time.time()
        last = None
        while time.time() - t0 < limit:
            try:
                last = self.get("/health").get("league") or {}
                if last.get("state") == want:
                    return last
            except (urllib.error.URLError, OSError, ValueError):
                pass
            time.sleep(0.1)
        return last

    def wait_live(self, limit=30):
        t0 = time.time()
        last = None
        while time.time() - t0 < limit:
            last = self.get("/live.json")
            if all(g.get("status") in ("live", "finished") for g in last.get("games", [])) and last.get("games"):
                return last
            time.sleep(0.2)
        return last

    def stop(self):
        self.proc.terminate()
        try:
            self.proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.proc.kill()


def main():
    fixture = fixture_file()
    base = {"NOX_LEAGUE": "memory", "NOX_LEAGUE_FIXTURE": fixture, "NOX_LEAGUE_FAST": "1"}
    engine, how = league.find_stockfish()
    if not engine:
        print("no Stockfish on this machine (%s); nothing to boot against" % how)
        sys.exit(1)

    print("\n\033[1m1. The server, started as the Dockerfile starts it, starts the league\033[0m")
    srv = Server(base)
    try:
        health = srv.wait_http()
        check("the site is up", bool(health and health.get("ok")), True)
        lg = srv.wait_state("running")
        check("the league reaches 'running' on its own", lg.get("state"), "running")
        check("...with the engine named", bool(lg.get("engine")), True)
        check("...and its path", lg.get("enginePath"), engine)
        check("...and the store", lg.get("store"), "memory")
        live = srv.wait_live()
        check("/live.json has all four ladders", [g["mode"] for g in live["games"]], list(league.MODES))
        check("...each with a game going", [g["status"] in ("live", "finished") for g in live["games"]],
              [True] * 4)
        check("...not off", live.get("off"), None)
        for g in live["games"]:
            check("%s seats two fixture accounts, within a hundred" % g["mode"],
                  g["white"]["name"].startswith("Fixture") and g["black"]["name"].startswith("Fixture")
                  and abs(g["white"]["rating"] - g["black"]["rating"]) <= 100, True)
        check("the human at the top of Sighted is never seated",
              any("A Person" in (g["white"]["name"], g["black"]["name"]) for g in live["games"]), False)
        lg = srv.get("/health")["league"]
        check("/health shows every ladder playing", [lg["modes"][m]["status"] for m in league.MODES],
              ["playing"] * 4)
        check("...and the count of rated AI accounts per ladder", [lg["modes"][m]["rated"] for m in league.MODES],
              [21] * 4)
        time.sleep(0.5)
        text = srv.log()
        check("the log says where the engine was found", "[AI League] engine:" in text and engine in text, True)
        check("...and that it is running", "[AI League] running" in text, True)
        check("...and the pairing numbers for each ladder",
              all(("[AI League] %s: " % league.MODE_NAME[m]) in text and "valid pairings" in text
                  for m in league.MODES), True)
        check("...and a match created on each",
              all(("%s match created" % league.MODE_NAME[m]) in text for m in league.MODES), True)
        check("nothing in the log is a traceback", "Traceback" in text, False)
        srv.stop()
        check("SIGTERM hands the games on", "handing the league's games on" in srv.log(), True)
    finally:
        srv.stop()

    print("\n\033[1m2. Installed but not on PATH — the container's failure\033[0m")
    on_path = shutil.which("stockfish")
    elsewhere = [c for c in league.STOCKFISH_CANDIDATES if league._runnable(c)]
    if not elsewhere:
        print("  \033[33mSKIP\033[0m Stockfish here is only on PATH (%s); nothing to find by looking" % on_path)
    else:
        env = dict(base)
        env["PATH"] = os.path.dirname(sys.executable)      # python, and nothing else
        srv = Server(env)
        try:
            srv.wait_http()
            lg = srv.wait_state("running")
            check("the league runs anyway", lg.get("state"), "running")
            check("...having found the engine by looking", lg.get("enginePath"), elsewhere[0])
            time.sleep(0.3)
            check("...and saying so", "not on PATH, found by looking" in srv.log(), True)
        finally:
            srv.stop()

    print("\n\033[1m3. No engine at all: said, on /health, on the page and in the log\033[0m")
    env = dict(base)
    env["NOX_STOCKFISH"] = "/nowhere/stockfish"
    srv = Server(env)
    try:
        health = srv.wait_http()
        check("the site is still served", bool(health and health.get("ok")), True)
        lg = srv.wait_state("stockfish unavailable")
        check("/health says 'stockfish unavailable'", lg.get("state"), "stockfish unavailable")
        check("...and keeps counting attempts", lg.get("attempts", 0) >= 1, True)
        check("...without the path in the public sentence", "/nowhere" in lg.get("note", ""), False)
        live = srv.get("/live.json")
        check("/live.json is off", live.get("off"), True)
        check("...with the engine sentence for the page", live.get("note"), league.PUBLIC_NOTE["stockfish unavailable"])
        check("...and still one entry per ladder", [g["mode"] for g in live["games"]], list(league.MODES))
        time.sleep(0.5)
        text = srv.log()
        check("the log names the setting", "NOX_STOCKFISH='/nowhere/stockfish'" in text, True)
        check("...and says it will try again", "trying again in" in text, True)
        deadline = time.time() + 3
        while time.time() < deadline and srv.get("/health")["league"].get("attempts", 0) < 3:
            time.sleep(0.1)
        check("...and does", srv.get("/health")["league"].get("attempts", 0) >= 3, True)
    finally:
        srv.stop()

    print("\n\033[1m4. NOX_LEAGUE=off is the one way to have no league\033[0m")
    srv = Server({"NOX_LEAGUE": "off"})
    try:
        srv.wait_http()
        check("/health says off", srv.get("/health")["league"].get("state"), "off")
        check("/live.json says off, with the old sentence", srv.get("/live.json").get("note"),
              "The server is not running the AI league right now.")
    finally:
        srv.stop()

    print("\n\033[1m%d passed, %d failed\033[0m\n" % (passed, failed))
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
