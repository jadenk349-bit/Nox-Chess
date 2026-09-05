"""The 24/7 ranked AI league: the strongest bot accounts, playing each other.

Four ladders — Sighted, Complete Blindfold, Board Only and Fog of War — each
with its own rating column, its own pool, its own games and its own place on
the home page. The players are the leaderboard's own accounts: the top twenty
of each ladder, read from profiles and re-read as the ratings move, of whom
the ones flagged `is_bot` are seated. Nothing is invented — no name, no
account, no rating — and nothing here touches human matchmaking: the games
are arranged here and only here, and a person can neither join one nor be
handed one. Stockfish is the hand that moves the pieces for an account, not
a player of its own.

This is the one place in the server that plays chess. Everywhere else the
rules live in the browser, and the server relays; but a game nobody is
watching has no browser to think in, so the league drives a native Stockfish
over UCI and referees with python-chess. Both are real dependencies rather
than stdlib — the first is a binary on PATH (the Dockerfile installs it), the
second a pure-Python package in requirements.txt — and both are optional in
the sense that a server without them still serves the site and simply has no
league, which it says once at startup.

The shape of it:

    League.run()  — one thread, ticking four times a second
      ├─ recover()      the live rows in the database, on startup
      ├─ arrange(mode)  a new game whenever a pool has fewer than it should
      ├─ play_move()    whichever games are due, through the engine
      └─ finish()       the result, the ratings, the record — once

    Store         — what is remembered: SupabaseStore over PostgREST, or
                    MemoryStore for tests and a laptop with no key
    EnginePool    — a handful of Stockfish processes shared by every game

Every game is a row from the moment it is arranged, and every move is a
compare-and-set on that row: written only by the process that owns the game,
and only if the row is behind the move being written. Two servers — a deploy
overlapping the instance it replaces — therefore cannot both play ply 41; the
second to try sees no row change and lets go. A lease says who owns a game,
and a lapsed lease is how the survivor adopts the other's games.

Finishing goes through one database function (league_finish) that is guarded
on the game still being live, and the ratings themselves move through
record_rated_game() from supabase-migrate-visions.sql — the one door through
which any of the four ratings moves, for the league as for anything else:
four points in the column of the vision that was played, exactly once,
whatever asks twice.
"""

import datetime
import json
import math
import os
import random
import re
import shutil
import subprocess
import sys
import threading
import time
import traceback
import urllib.error
import urllib.request
import uuid

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import supabase_db

try:
    import chess
    import chess.pgn
except ImportError:                          # pragma: no cover - the server says so at startup
    chess = None

MODES = ("sighted", "total", "blind", "fog")
MODE_NAME = {
    "sighted": "Sighted",
    "total": "Complete Blindfold",
    "blind": "Board Only",
    "fog": "Fog of War",
}
# The column each vision's rating lives in: supabase_db.VISION_COLUMNS, and
# not a copy of it. `rating` is the Sighted ladder the site has always had;
# the other three arrived with supabase-migrate-visions.sql, and the CASE in
# record_rated_game() there is the same table in SQL. One table, three
# readers, and test_visions.py holds them to each other — a rating moved
# under one name and read under another is a ladder that lies.
RATING_COL = supabase_db.VISION_COLUMNS

# The pool is the leaderboard: the top twenty of a ladder, exactly as the home
# page ranks it (rating descending, then name), of whom the AI accounts play.
# Twenty because the page shows twenty (LB_TOP in blind-chess.html); a player
# who drops to twenty-first is no longer in the pool for the next game, and
# one who climbs to twentieth is.
TOP_N = 20
MAX_GAP = 100            # widest rating difference two opponents may have
POINTS = 4               # what a win is worth, and a loss costs; a draw moves nothing
MINUTES = 30             # each side's clock
CLOCK_MS = MINUTES * 60 * 1000
RECENT_MEMORY = 3        # opponents remembered per player per vision, to avoid repeats
LEASE_SECONDS = 90       # how long a game stays another process's after its last write
ADOPT_EVERY = 30.0       # how often to look for games whose owner has gone quiet
PLAYERS_EVERY = 60.0     # how often the ladders are re-read, so a move in or out of the top twenty counts
START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"

# The bots' own Elo is the leaderboard's; the engine's is what it is asked to
# play at, and the two are related by this curve — a 2000 leaderboard player
# plays like a 2500 engine, 2800 like 2920, and nobody is asked for more than
# the ceiling. Piecewise linear between the anchors, flat beyond them.
STRENGTH_ANCHORS = [(2000, 2500), (2300, 2650), (2600, 2800), (2800, 2920), (3000, 3000)]
STRENGTH_MIN, STRENGTH_MAX = 2500, 3000

# The environment, read once. NOX_LEAGUE is "on" (the default), "off", or
# "memory". With a service key the league writes every game and rating to
# Supabase; without one — or with "memory" — it still reads the real
# leaderboard accounts, using the same publishable key the page ships, and
# plays them with results kept in this process, exactly as puzzle ratings
# degrade without a key. NOX_LEAGUE_FIXTURE names a JSON file of profile rows
# to read instead, for a test with no network. NOX_LEAGUE_FAST shortens every
# pause to something a test can sit through.
FAST = bool(os.environ.get("NOX_LEAGUE_FAST"))
GAMES_PER_MODE = max(1, int(os.environ.get("NOX_LEAGUE_GAMES_PER_MODE") or 1))
ENGINES = max(1, int(os.environ.get("NOX_LEAGUE_ENGINES") or 1))
# NOX_STOCKFISH is a path or a command name, and it is an instruction rather
# than a hint: set, it is the one binary tried. Unset, find_stockfish() looks
# — see it and STOCKFISH_CANDIDATES below.
STOCKFISH = (os.environ.get("NOX_STOCKFISH") or "").strip()
FIXTURE = os.environ.get("NOX_LEAGUE_FIXTURE") or ""
PAGE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "blind-chess.html")
RESULT_PAUSE = 1.0 if FAST else 12.0      # a finished game is shown for this long before the next
# How long the league waits between attempts to get itself ready — a database
# that is not answering, a migration that has not been run yet, an engine
# that is not there. Doubling from the first to the second, so a project that
# is a minute from being ready is picked up in a minute and one that is never
# ready asks once a minute rather than once a second.
BOOT_RETRY_MIN = 0.2 if FAST else 5.0
BOOT_RETRY_MAX = 1.0 if FAST else 60.0
# A ladder that cannot be paired says why in the log when the reason changes,
# and again this often while it stays the same, so a quiet server is not a
# silent one and a noisy one is not a wall of the same line.
WHY_REPEAT = 5.0 if FAST else 600.0

# Where a Stockfish binary is when it is not on PATH. The first entry is the
# one that matters in production: Debian's `stockfish` package — the one the
# Dockerfile installs — puts the executable in /usr/games, and /usr/games is
# not on PATH in the python:3.12-slim image the server runs in. A server that
# asked only for "stockfish" therefore found nothing in the very container
# that had just installed it, and ran without the league while the home page
# said so. The Dockerfile now adds /usr/games to PATH as well, but the league
# does not depend on that: it looks here, and says where it found the engine.
STOCKFISH_CANDIDATES = (
    "/usr/games/stockfish",
    "/usr/local/bin/stockfish",
    "/usr/bin/stockfish",
    "/usr/local/games/stockfish",
    "/opt/homebrew/bin/stockfish",
    "/snap/bin/stockfish",
)

LOG = True


def log(*a):
    if LOG:
        print("[%s] [AI League]" % time.strftime("%H:%M:%S"), *a, flush=True)


def _runnable(path):
    return bool(path) and os.path.isfile(path) and os.access(path, os.X_OK)


def find_stockfish(setting=None, candidates=STOCKFISH_CANDIDATES, which=shutil.which, path_env=None):
    """(path to run, how it was found) — or (None, why not), in words for the log.

    NOX_STOCKFISH, when set, is the one thing tried: a path is checked as a
    file, a bare name is looked up on PATH, and neither falls through to the
    list, because an operator who named a binary wants that binary or an
    error. Unset, `stockfish` on PATH wins, and then each of
    STOCKFISH_CANDIDATES in turn. The reason for a miss names PATH and every
    location looked at, since "no engine" on its own is what left the last
    outage undiagnosed.
    """
    setting = STOCKFISH if setting is None else setting
    path_env = os.environ.get("PATH", "") if path_env is None else path_env
    if setting:
        if os.sep in setting:
            if _runnable(setting):
                return setting, "NOX_STOCKFISH"
            return None, "NOX_STOCKFISH=%r is not an executable file" % setting
        found = which(setting)
        if found:
            return found, "NOX_STOCKFISH=%r, on PATH" % setting
        return None, "NOX_STOCKFISH=%r is not on PATH (%s)" % (setting, path_env)
    found = which("stockfish")
    if found:
        return found, "on PATH"
    for candidate in candidates:
        if _runnable(candidate):
            return candidate, "not on PATH, found by looking"
    return None, ("no `stockfish` on PATH (%s) and none at %s — install stockfish, or set "
                  "NOX_STOCKFISH to the binary" % (path_env, ", ".join(candidates)))


def now_ms():
    return int(time.time() * 1000)


def iso(ts):
    """A moment as PostgREST writes and reads it: UTC, with a Z."""
    return datetime.datetime.fromtimestamp(ts, datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


_FRAC = re.compile(r"\.(\d{1,6})")


def from_iso(text):
    """Back the other way, tolerant of the fraction PostgREST felt like sending."""
    if not text:
        return 0.0
    t = text.strip().replace("Z", "+00:00")
    m = _FRAC.search(t)
    if m:                                     # 3.9's fromisoformat wants exactly six digits
        t = t[:m.start()] + "." + m.group(1).ljust(6, "0") + t[m.end():]
    try:
        return datetime.datetime.fromisoformat(t).timestamp()
    except ValueError:
        return 0.0


def engine_elo_for(rating):
    """What the engine is asked to play at, for a bot rated this on the ladder."""
    pts = STRENGTH_ANCHORS
    if rating <= pts[0][0]:
        return pts[0][1]
    for (r0, e0), (r1, e1) in zip(pts, pts[1:]):
        if rating <= r1:
            return int(round(e0 + (e1 - e0) * (rating - r0) / float(r1 - r0)))
    return pts[-1][1]


def movetime_for(elo):
    """Milliseconds of actual search per move: a little more the stronger the seat.

    The engine's search is the cheap part and stays cheap — the pauses a
    viewer sees are think_seconds(), not this. A whole game costs a few
    seconds of CPU, which is what lets four of them share one process.
    """
    if FAST:
        return 15
    frac = (elo - STRENGTH_MIN) / float(STRENGTH_MAX - STRENGTH_MIN)
    return int(120 + max(0.0, min(1.0, frac)) * 280)


def think_seconds(board, ply, score_cp, remaining_ms, rng):
    """How long the mover appears to think before the move is played.

    Not a fixed pause. The base rises out of the opening into the middlegame
    and eases in the endgame; it stretches with the number of legal moves, is
    cut when the reply is forced (in check) or the game is decided (a big
    score either way), and is then spread by a log-normal draw so that no two
    moves take the same time. One move in twenty is a long think. Everything
    is clamped, and a short clock shortens it all: a side under two minutes
    plays at a pace it can afford.
    """
    if FAST:
        return rng.uniform(0.05, 0.15)
    if ply < 16:
        base = 2.2
    elif ply < 70:
        base = 7.0
    else:
        base = 4.5
    n = board.legal_moves.count()
    factor = 0.7 + min(n, 45) / 45.0 * 0.9
    if board.is_check():
        factor *= 0.75
    elif any(board.is_capture(m) for m in board.legal_moves):
        factor *= 1.12
    if score_cp is not None and abs(score_cp) > 300:
        factor *= 0.7
    t = base * factor * math.exp(rng.gauss(0.0, 0.45))
    if rng.random() < 0.05:
        t *= 2.4
    t = max(1.2, min(28.0, t))
    if remaining_ms < 120000:
        t = min(t, max(0.6, remaining_ms / 1000.0 / 60.0))
    return t


class EngineDead(Exception):
    pass


class Engine:
    """One Stockfish process on UCI, asked one question at a time."""

    def __init__(self, path):
        self.path = path
        self.lock = threading.Lock()
        self.proc = None
        self.name = ""
        self.elo_min, self.elo_max = 1320, 3190
        self.limit_strength = False
        self.spawn()

    def spawn(self):
        self.proc = subprocess.Popen(
            [self.path], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL, text=True, bufsize=1)
        self._send("uci")
        while True:
            line = self._readline()
            if line.startswith("id name"):
                self.name = line[8:].strip()
            elif line.startswith("option name UCI_Elo"):
                m = re.search(r"min (\d+) max (\d+)", line)
                if m:
                    self.elo_min, self.elo_max = int(m.group(1)), int(m.group(2))
            elif line.startswith("option name UCI_LimitStrength"):
                self.limit_strength = True
            elif line.strip() == "uciok":
                break
        self._send("setoption name Threads value 1")
        self._send("setoption name Hash value 16")
        self._send("isready")
        self._wait("readyok")

    def _send(self, line):
        try:
            self.proc.stdin.write(line + "\n")
            self.proc.stdin.flush()
        except (OSError, ValueError):
            raise EngineDead(line)

    def _readline(self):
        line = self.proc.stdout.readline()
        if not line:
            raise EngineDead("eof")
        return line.rstrip("\n")

    def _wait(self, token):
        while True:
            if self._readline().strip() == token:
                return

    def close(self):
        try:
            self._send("quit")
        except EngineDead:
            pass
        try:
            self.proc.kill()
        except OSError:
            pass

    def strength(self, elo):
        """Ask the engine to play at this Elo, within what this build offers."""
        if not self.limit_strength:
            return
        elo = max(self.elo_min, min(self.elo_max, int(elo)))
        self._send("setoption name UCI_LimitStrength value true")
        self._send("setoption name UCI_Elo value %d" % elo)

    def bestmove(self, moves, elo, movetime):
        """(uci, score in centipawns from the mover's side, mate-in) for this position.

        The position is given as the whole game from the start, which is what
        lets the engine see repetitions. The score is the last one reported
        before the move, from the side to move, with a mate folded into a large
        number so callers can compare it like any other.
        """
        with self.lock:
            try:
                self.strength(elo)
                self._send("position startpos" + (" moves " + " ".join(moves) if moves else ""))
                self._send("go movetime %d" % movetime)
                score, mate = None, None
                while True:
                    line = self._readline()
                    if line.startswith("info") and " score " in line:
                        m = re.search(r" score (cp|mate) (-?\d+)", line)
                        if m:
                            if m.group(1) == "cp":
                                score, mate = int(m.group(2)), None
                            else:
                                mate = int(m.group(2))
                                score = 10000 - abs(mate) if mate > 0 else -10000 + abs(mate)
                    elif line.startswith("bestmove"):
                        parts = line.split()
                        move = parts[1] if len(parts) > 1 else "(none)"
                        return move, score, mate
            except EngineDead:
                # the process went; whoever asked gets a fresh one next time
                try:
                    self.proc.kill()
                except OSError:
                    pass
                self.spawn()
                raise


class EnginePool:
    """A few engines, handed out one at a time. Games are paced by their own
    pauses, so a single process comfortably serves all four ladders; the count
    is a knob for a busier box, not a requirement."""

    def __init__(self, count, path):
        self.path = path
        self.engines = [Engine(path) for _ in range(max(1, count))]
        self.free = list(self.engines)
        self.cv = threading.Condition()

    @property
    def name(self):
        return self.engines[0].name if self.engines else ""

    def ask(self, moves, elo, movetime):
        with self.cv:
            while not self.free:
                self.cv.wait()
            eng = self.free.pop()
        try:
            return eng.bestmove(moves, elo, movetime)
        finally:
            with self.cv:
                self.free.append(eng)
                self.cv.notify()

    def close(self):
        for eng in self.engines:
            eng.close()


# ------------------------------------------------------------------ the store

class SeatTaken(Exception):
    """A player is already at a board in this vision."""


class StoreUnavailable(Exception):
    """The database could not be reached, or refused the request.

    `code` is the HTTP status when there was one (a 401 is a refused key,
    which is worth a different sentence from a timeout), and None otherwise.
    """

    def __init__(self, message, code=None):
        super().__init__(message)
        self.code = code


class MigrationMissing(StoreUnavailable):
    """The database answered, and what it answered is that a table, a column
    or a function the league needs is not there: one of the SQL files has
    not been run. Its own class because the fix is different — nothing about
    waiting will help, and the log should name the file."""


# What the league needs of the database, by name, and the hand-run file each
# comes from. verify_schema() asks for every one of these before the first
# game is arranged, so a project that has run one migration and not the other
# is told which, rather than failing on the first insert with a code.
VISIONS_FILE = "supabase-migrate-visions.sql"
LEAGUE_FILE = "supabase-migrate-league.sql"
PROFILES_FILE = "supabase-system-profiles.sql"
REQUIRED_COLUMNS = (
    ("id", "supabase-setup.sql"), ("display_name", "supabase-setup.sql"),
    ("is_bot", PROFILES_FILE), ("rating", "supabase-setup.sql"),
    ("complete_blindfold_rating", VISIONS_FILE), ("board_only_rating", VISIONS_FILE),
    ("fog_of_war_rating", VISIONS_FILE),
)
REQUIRED_TABLES = (("league_games", "id", LEAGUE_FILE), ("league_seats", "player_id", LEAGUE_FILE),
                   ("rated_games", "id", VISIONS_FILE))
REQUIRED_FUNCTIONS = (("league_start", LEAGUE_FILE), ("league_finish", LEAGUE_FILE),
                      ("league_abandon", LEAGUE_FILE), ("record_rated_game", VISIONS_FILE))


def players_from_rows(rows):
    """Profile rows as PostgREST returns them -> what the league keeps of them.

    Every row, human or not, because the pool is the top twenty of a ladder
    and a person standing in it takes a place on it. A rating column a project
    does not have yet (the migration not run) simply reads as unrated.
    """
    out = []
    for r in rows or []:
        if not isinstance(r, dict) or not r.get("id"):
            continue
        ratings = {}
        for mode in MODES:
            value = r.get(RATING_COL[mode])
            ratings[mode] = value if isinstance(value, int) else None
        out.append({"id": r["id"], "name": r.get("display_name") or ("player_" + r["id"][:8]),
                    "is_bot": bool(r.get("is_bot")), "ratings": ratings})
    return out


class MemoryStore:
    """Everything the league remembers, in dictionaries, for the life of the
    process. The tests run against this, and so does a server with no service
    key — seeded, in that case, with the real leaderboard accounts, so what is
    played and shown is the same players at the same ratings; only the results
    are forgotten when the process ends."""

    def __init__(self):
        self.profiles = {}      # id -> {id, name, is_bot, ratings: {mode: int|None}}
        self.games = {}         # id -> row (the same keys the table has)
        self.seats = {}         # (mode, player id) -> game id
        self.lock = threading.RLock()

    def add_player(self, name, ratings, is_bot=True, pid=None):
        pid = pid or str(uuid.uuid4())
        with self.lock:
            self.profiles[pid] = {"id": pid, "name": name, "is_bot": is_bot,
                                  "ratings": {m: ratings.get(m) for m in MODES}}
        return pid

    def seed_rows(self, rows):
        """The real accounts, as read from profiles. Nothing is renamed."""
        with self.lock:
            for p in players_from_rows(rows):
                self.profiles[p["id"]] = p
        return len(self.profiles)

    def players(self):
        with self.lock:
            return [dict(id=p["id"], name=p["name"], is_bot=p["is_bot"], ratings=dict(p["ratings"]))
                    for p in self.profiles.values()]

    def live_games(self):
        with self.lock:
            return [dict(g) for g in self.games.values() if g["status"] == "live"]

    def recent_finished(self, mode, limit=40):
        with self.lock:
            rows = [g for g in self.games.values() if g["status"] == "finished" and g["mode"] == mode]
        rows.sort(key=lambda g: g["finished_at"] or "", reverse=True)
        return [dict(g) for g in rows[:limit]]

    def start_game(self, mode, white, black, fen, ms, owner):
        with self.lock:
            if white["id"] == black["id"]:
                raise SeatTaken(white["id"])
            for p in (white, black):
                if (mode, p["id"]) in self.seats:
                    raise SeatTaken(p["id"])
            gid = str(uuid.uuid4())
            now = iso(time.time())
            self.games[gid] = {
                "id": gid, "mode": mode, "white_id": white["id"], "black_id": black["id"],
                "white_name": white["name"], "black_name": black["name"],
                "white_elo_before": white["rating"], "black_elo_before": black["rating"],
                "white_elo_after": None, "black_elo_after": None,
                "status": "live", "result": None, "winner_id": None, "termination": None,
                "moves": "", "sans": "", "fen": fen, "ply": 0,
                "white_ms": ms, "black_ms": ms, "last_move_at": now, "started_at": now,
                "finished_at": None, "pgn": None, "owner": owner,
                "lease_until": iso(time.time() + LEASE_SECONDS),
            }
            self.seats[(mode, white["id"])] = gid
            self.seats[(mode, black["id"])] = gid
            return gid

    def claim(self, game_id, owner):
        with self.lock:
            g = self.games.get(game_id)
            if not g or g["status"] != "live":
                return None
            lapsed = not g["owner"] or g["owner"] == owner or from_iso(g["lease_until"]) < time.time()
            if not lapsed:
                return None
            g["owner"] = owner
            g["lease_until"] = iso(time.time() + LEASE_SECONDS)
            return dict(g)

    def write_move(self, game_id, owner, ply, fields):
        with self.lock:
            g = self.games.get(game_id)
            if not g or g["status"] != "live" or g["owner"] != owner:
                return False
            if g["ply"] >= ply:
                return g["ply"] == ply
            g.update(fields)
            g["ply"] = ply
            g["lease_until"] = iso(time.time() + LEASE_SECONDS)
            return True

    def finish(self, game_id, result, winner_id, termination, moves, sans, fen, ply, pgn, wms, bms):
        with self.lock:
            g = self.games.get(game_id)
            if not g or g["status"] != "live":
                return None
            col = g["mode"]
            w, b = self.profiles[g["white_id"]], self.profiles[g["black_id"]]
            w_before = w["ratings"][col] if w["ratings"][col] is not None else g["white_elo_before"]
            b_before = b["ratings"][col] if b["ratings"][col] is not None else g["black_elo_before"]
            wd = bd = 0
            if result == "1-0":
                wd, bd = POINTS, -POINTS
            elif result == "0-1":
                wd, bd = -POINTS, POINTS
            w["ratings"][col] = w_before + wd
            b["ratings"][col] = b_before + bd
            g.update({
                "status": "finished", "result": result, "winner_id": winner_id,
                "termination": termination, "moves": moves, "sans": sans, "fen": fen,
                "ply": ply, "pgn": pgn, "white_ms": wms, "black_ms": bms,
                "finished_at": iso(time.time()), "owner": None, "lease_until": None,
                "white_elo_before": w_before, "black_elo_before": b_before,
                "white_elo_after": w_before + wd, "black_elo_after": b_before + bd,
            })
            self.seats.pop((g["mode"], g["white_id"]), None)
            self.seats.pop((g["mode"], g["black_id"]), None)
            return {"white_id": g["white_id"], "black_id": g["black_id"],
                    "white_before": w_before, "black_before": b_before,
                    "white_after": w_before + wd, "black_after": b_before + bd}

    def abandon(self, game_id, reason):
        with self.lock:
            g = self.games.get(game_id)
            if not g or g["status"] != "live":
                return False
            g.update({"status": "abandoned", "termination": reason,
                      "finished_at": iso(time.time()), "owner": None, "lease_until": None})
            self.seats.pop((g["mode"], g["white_id"]), None)
            self.seats.pop((g["mode"], g["black_id"]), None)
            return True

    def release(self, owner):
        with self.lock:
            for g in self.games.values():
                if g["status"] == "live" and g["owner"] == owner:
                    g["owner"] = None
                    g["lease_until"] = None


class SupabaseStore:
    """The same operations over PostgREST, with the service key.

    Reads are plain selects; the three writes that must be atomic are the
    functions in supabase-migrate-league.sql. A move is a PATCH with the
    owner and the ply in the filter, so it is a compare-and-set whether or
    not anybody else is writing.
    """

    def __init__(self):
        if not supabase_db.enabled():
            raise StoreUnavailable("no SUPABASE_SERVICE_KEY")

    @staticmethod
    def _call(method, path, body=None, prefer=None):
        try:
            return supabase_db.request(method, path, body, prefer)
        except urllib.error.HTTPError as err:
            text = supabase_db.error_body(err)
            if err.code in (404, 400) and ("PGRST205" in text or "PGRST202" in text or "42703" in text
                                            or "42P01" in text or "42883" in text):
                # PGRST205: no such table. PGRST202 / 42883: no such function.
                # 42703: no such column. 42P01: no such relation. Every one of
                # them is a migration that has not been run.
                raise MigrationMissing("%s %s: the database has no such table, column or function "
                                       "(%s, then %s): %s" % (method, path, VISIONS_FILE, LEAGUE_FILE, text),
                                       err.code)
            if err.code == 409 or "23505" in text:
                raise SeatTaken(text)
            if err.code in (401, 403):
                raise StoreUnavailable("%s %s: %s — the database refused the server's key (is "
                                       "SUPABASE_SERVICE_KEY a secret key for this project?): %s"
                                       % (method, path, err.code, text), err.code)
            raise StoreUnavailable("%s %s: %s %s" % (method, path, err.code, text), err.code)
        except (urllib.error.URLError, OSError, ValueError) as err:
            raise StoreUnavailable("%s %s: %s" % (method, path, err))

    def verify_schema(self):
        """Every table, column and function the league will touch, by name.

        Raises MigrationMissing naming what is absent and the file that adds
        it, StoreUnavailable when the database cannot be asked, and returns
        a one-line summary otherwise. Columns and tables are asked for with a
        select that names them and returns at most one row; the functions
        are read off the OpenAPI document PostgREST serves at the root of the
        API, which lists every RPC the role can call — and if that document
        cannot be read, or is not one, the functions are taken on trust and
        the log says so, because a project that hides its schema is not a
        project that has not run the migration.
        """
        # a column at a time would be seven requests; one select finds the
        # first missing one, which is the one to name
        try:
            self._call("GET", "/profiles?select=%s&limit=1" % ",".join(c for c, _ in REQUIRED_COLUMNS))
        except MigrationMissing as err:
            missing = [(c, f) for c, f in REQUIRED_COLUMNS if ("column profiles.%s" % c) in str(err)
                       or ("'%s'" % c) in str(err)]
            if missing:
                raise MigrationMissing("profiles has no column %r — run %s" % missing[0], err.code)
            raise MigrationMissing("profiles is missing one of %s — run %s and %s: %s"
                                   % (", ".join(c for c, _ in REQUIRED_COLUMNS), PROFILES_FILE,
                                      VISIONS_FILE, err), err.code)
        for table, col, source in REQUIRED_TABLES:
            try:
                self._call("GET", "/%s?select=%s&limit=1" % (table, col))
            except MigrationMissing as err:
                raise MigrationMissing("no table %r — run %s (%s)" % (table, source, err), err.code)
        checked = "%d columns, %d tables" % (len(REQUIRED_COLUMNS), len(REQUIRED_TABLES))
        spec = None
        try:
            spec = self._call("GET", "/")
        except StoreUnavailable:
            spec = None
        paths = spec.get("paths") if isinstance(spec, dict) else None
        if not isinstance(paths, dict):
            log("the API's OpenAPI document could not be read; taking the four functions on trust")
            return checked + ", functions unverified"
        for fn, source in REQUIRED_FUNCTIONS:
            if ("/rpc/" + fn) not in paths:
                raise MigrationMissing("no function %s() — run %s" % (fn, source))
        return checked + ", %d functions" % len(REQUIRED_FUNCTIONS)

    def players(self):
        # select=* rather than a column list, so a project that has not run
        # the migration answers with what it has instead of an error: the
        # three new ladders then read as empty, which is the truth.
        return players_from_rows(self._call("GET", "/profiles?select=*") or [])

    def live_games(self):
        return self._call("GET", "/league_games?select=*&status=eq.live") or []

    def recent_finished(self, mode, limit=40):
        return self._call("GET", "/league_games?select=mode,white_id,black_id,finished_at"
                                 "&status=eq.finished&mode=eq.%s&order=finished_at.desc&limit=%d"
                          % (mode, limit)) or []

    def start_game(self, mode, white, black, fen, ms, owner):
        gid = self._call("POST", "/rpc/league_start", {
            "p_mode": mode, "p_white": white["id"], "p_black": black["id"],
            "p_white_name": white["name"], "p_black_name": black["name"],
            "p_white_elo": white["rating"], "p_black_elo": black["rating"],
            "p_fen": fen, "p_ms": ms, "p_owner": owner, "p_lease_seconds": LEASE_SECONDS,
        })
        if not isinstance(gid, str):
            raise StoreUnavailable("league_start returned %r" % (gid,))
        return gid

    def claim(self, game_id, owner):
        rows = self._call(
            "PATCH",
            "/league_games?id=eq.%s&status=eq.live&or=(owner.is.null,owner.eq.%s,lease_until.lt.%s)"
            % (game_id, owner, iso(time.time())),
            {"owner": owner, "lease_until": iso(time.time() + LEASE_SECONDS)},
            prefer="return=representation")
        return rows[0] if rows else None

    def write_move(self, game_id, owner, ply, fields):
        body = dict(fields)
        body["ply"] = ply
        body["lease_until"] = iso(time.time() + LEASE_SECONDS)
        rows = self._call(
            "PATCH",
            "/league_games?id=eq.%s&owner=eq.%s&status=eq.live&ply=lt.%d" % (game_id, owner, ply),
            body, prefer="return=representation")
        if rows:
            return True
        # Nothing matched: either the row is already at this ply (a retry after
        # an uncertain write) or somebody else owns it now. Ask which.
        again = self._call("GET", "/league_games?select=owner,ply,status&id=eq.%s" % game_id) or []
        return bool(again) and again[0].get("owner") == owner and again[0].get("ply") == ply \
            and again[0].get("status") == "live"

    def finish(self, game_id, result, winner_id, termination, moves, sans, fen, ply, pgn, wms, bms):
        rows = self._call("POST", "/rpc/league_finish", {
            "p_game": game_id, "p_result": result, "p_winner": winner_id,
            "p_termination": termination, "p_moves": moves, "p_sans": sans, "p_fen": fen,
            "p_ply": ply, "p_pgn": pgn, "p_white_ms": wms, "p_black_ms": bms, "p_points": POINTS,
        })
        return rows[0] if rows else None

    def abandon(self, game_id, reason):
        return bool(self._call("POST", "/rpc/league_abandon", {"p_game": game_id, "p_reason": reason}))

    def release(self, owner):
        self._call("PATCH", "/league_games?owner=eq.%s&status=eq.live" % owner,
                   {"owner": None, "lease_until": None})


# ------------------------------------------------------------------- a game

class Match:
    """One live game, as this process is playing it."""

    def __init__(self, gid, mode, white, black, board, moves, sans, white_ms, black_ms,
                 last_move_at, started_at):
        self.id = gid
        self.mode = mode
        self.white = white            # {id, name, rating}
        self.black = black
        self.board = board
        self.moves = moves            # uci
        self.sans = sans
        self.white_ms = white_ms      # what each side had left after its last move
        self.black_ms = black_ms
        self.last_move_at = last_move_at
        self.started_at = started_at
        self.due = 0.0                # when the next move is to be played
        self.status = "live"
        self.result = None
        self.winner = None            # "w", "b" or None
        self.termination = None
        self.finished_at = None
        self.evals = []               # cp from the mover's side, one per ply played here
        self.pending_finish = None    # (args) waiting on a store that would not answer
        self.retry_at = 0.0

    @property
    def ply(self):
        return len(self.moves)

    def turn(self):
        return "w" if self.board.turn == chess.WHITE else "b"

    def side(self, color):
        return self.white if color == "w" else self.black

    def remaining(self, color, now):
        base = self.white_ms if color == "w" else self.black_ms
        if self.status != "live" or color != self.turn():
            return max(0, base)
        return max(0, int(base - (now - self.last_move_at) * 1000))

    def snapshot(self, now):
        return {
            "id": self.id,
            "mode": self.mode,
            "modeName": MODE_NAME[self.mode],
            "white": dict(self.white),
            "black": dict(self.black),
            "fen": self.board.fen(),
            "moves": " ".join(self.moves),
            "sans": list(self.sans),
            "ply": self.ply,
            "turn": self.turn(),
            "lastMove": self.moves[-1] if self.moves else None,
            "whiteMs": self.remaining("w", now),
            "blackMs": self.remaining("b", now),
            "lastMoveAt": int(self.last_move_at * 1000),
            "startedAt": int(self.started_at * 1000),
            "status": self.status,
            "result": self.result,
            "winner": self.winner,
            "termination": self.termination,
            "finishedAt": int(self.finished_at * 1000) if self.finished_at else None,
            "check": bool(self.board.is_check()),
        }


def pgn_of(match):
    """The game as a PGN, with the headers a reader would want."""
    game = chess.pgn.Game.from_board(match.board)
    game.headers["Event"] = "Nox Chess AI League — " + MODE_NAME[match.mode]
    game.headers["Site"] = "Nox Chess"
    game.headers["Date"] = time.strftime("%Y.%m.%d", time.gmtime(match.started_at))
    game.headers["Round"] = "-"
    game.headers["White"] = match.white["name"]
    game.headers["Black"] = match.black["name"]
    game.headers["WhiteElo"] = str(match.white["rating"])
    game.headers["BlackElo"] = str(match.black["rating"])
    game.headers["Result"] = match.result or "*"
    game.headers["TimeControl"] = str(MINUTES * 60)
    if match.termination:
        game.headers["Termination"] = match.termination
    return str(game)


def outcome_of(board):
    """(result, winner colour, termination) if the rules say the game is over.

    python-chess claims a draw for us where a player could: threefold and the
    fifty-move rule count, as they would in a game with an arbiter.
    """
    out = board.outcome(claim_draw=True)
    if out is None:
        return None
    term = out.termination.name.lower().replace("_", " ")
    names = {
        "checkmate": "checkmate", "stalemate": "stalemate",
        "insufficient material": "insufficient material",
        "seventyfive moves": "seventy-five-move rule", "fivefold repetition": "fivefold repetition",
        "fifty moves": "fifty-move rule", "threefold repetition": "threefold repetition",
    }
    term = names.get(term, term)
    if out.winner is None:
        return "1/2-1/2", None, term
    return ("1-0", "w", term) if out.winner == chess.WHITE else ("0-1", "b", term)


# ----------------------------------------------------------------- the league

# What the league is doing, in one word or three, for /health and the log.
# "running" is the only state in which games are arranged; every other one
# names the thing that is stopping it, and all but "crashed" and "off" are
# retried from — see League.boot().
STATES = ("starting", "running", "database unavailable", "migration missing",
          "stockfish unavailable", "python-chess unavailable", "no eligible players",
          "crashed", "off")
# The sentence the home page prints for each, under the four cards. Public,
# so it says what is wrong and never how — no paths, no error bodies, no key.
PUBLIC_NOTE = {
    "starting": "The AI league is starting…",
    "running": "",
    "database unavailable": "The AI league is waiting for its database.",
    "migration missing": "The AI league's database migration has not been run yet.",
    "stockfish unavailable": "The server has no chess engine, so the AI league cannot run.",
    "python-chess unavailable": "The server is missing a package the AI league needs.",
    "no eligible players": "No AI accounts are on any ladder yet, so there is nobody to seat.",
    "crashed": "The AI league has stopped and the server needs a restart.",
    "off": "The server is not running the AI league right now.",
}


def off_payload():
    """What the socket and /live.json answer on a server with no league at all."""
    return {"t": "live-games", "at": now_ms(), "games": [], "off": True,
            "state": "off", "note": PUBLIC_NOTE["off"]}


class NotReady(Exception):
    """One thing the league still needs before it can run: which STATE that
    is, and the reason in full for the log. `terminal` marks the ones no
    amount of waiting will mend."""

    def __init__(self, state, reason, terminal=False):
        super().__init__(reason)
        self.state = state
        self.reason = reason
        self.terminal = terminal


class League:
    def __init__(self, store=None, engines=None, games_per_mode=GAMES_PER_MODE, rng=None, setting="on"):
        # Both may be None: then boot() finds them, and keeps trying until it
        # has. The tests hand both in and drive tick() by hand.
        self.store = store
        self.engines = engines
        self.setting = setting
        self.store_kind = "memory" if isinstance(store, MemoryStore) else ("supabase" if store else None)
        self.engine_path = getattr(engines, "path", None)
        self.games_per_mode = games_per_mode
        self.rng = rng or random.Random()
        self.owner = uuid.uuid4().hex[:12]
        self.lock = threading.RLock()
        self.state = "starting"
        self.reason = ""                            # the full reason, for the log and nowhere public
        self.state_since = time.time()
        self.attempts = 0                           # boot attempts so far
        self.mode_status = {m: {"status": "idle", "why": "", "at": 0.0, "said": 0.0} for m in MODES}
        self.counts = {}                            # mode -> how many AI accounts are rated on it
        self.matches = {}                           # game id -> Match, the ones this process plays
        self.foreign = {}                           # game id -> row, live elsewhere
        self.last_finished = {}                     # mode -> snapshot of the last game to end
        self.players = {m: [] for m in MODES}       # mode -> [{id, name, rating}], the pool
        self.players_at = 0.0
        self.adopted_at = 0.0
        self.recent = {m: {} for m in MODES}        # mode -> player id -> [opponent ids]
        self.last_color = {m: {} for m in MODES}    # mode -> player id -> colour last played
        self.next_fill = {m: 0.0 for m in MODES}    # mode -> when a new game may be arranged
        self.listeners = set()
        self.running = False
        self.thread = None
        self.store_down_since = None
        self.stats = {"moves": 0, "games": 0, "finished": 0, "errors": 0}

    # ---- lifecycle

    def start(self):
        """Once per process. A second call is a mistake and does nothing."""
        if self.thread is not None and self.thread.is_alive():
            return
        self.running = True
        self.thread = threading.Thread(target=self.run, name="ai-league", daemon=True)
        self.thread.start()

    def stop(self):
        self.running = False
        if self.store is not None:
            try:
                self.store.release(self.owner)
            except (StoreUnavailable, SeatTaken):
                pass
        close = getattr(self.engines, "close", None)
        if close:
            try:
                close()
            except Exception:                   # noqa: BLE001 - going down anyway
                pass

    def set_state(self, state, reason=""):
        """Move to a state, say so once, and tell the page.

        The page is told because the four cards carry the sentence for the
        state, and a league that came up a minute after the page did should
        replace "starting" with the games without a reload.
        """
        assert state in STATES, state
        with self.lock:
            changed = state != self.state or (reason and reason != self.reason)
            self.state = state
            self.reason = reason or ""
            if changed:
                self.state_since = time.time()
        if changed and state != "running":
            log("%s%s" % (state, (": " + reason) if reason else ""))
        if changed:
            self.publish()

    def run(self):
        try:
            if not self.boot():
                return
            try:
                self.recover()
            except StoreUnavailable as err:
                self.store_trouble(err)
            log("ready: %d ladders, %d game%s each; engine %s at %s"
                % (len(MODES), self.games_per_mode, "" if self.games_per_mode == 1 else "s",
                   getattr(self.engines, "name", "?") or "?", self.engine_path or "?"))
            if self.store_down_since is None:
                # a database that failed recover() flips this to running from
                # tick(), the moment it answers
                self.set_state("running")
                log("running")
            while self.running:
                try:
                    self.tick(time.time())
                except StoreUnavailable as err:
                    self.store_trouble(err)
                except Exception:               # noqa: BLE001 - the loop must survive one bad tick
                    self.stats["errors"] += 1
                    log("tick failed — carrying on:\n" + traceback.format_exc().rstrip())
                time.sleep(0.05 if FAST else 0.25)
        except Exception:                       # noqa: BLE001 - the thread must not die silently
            self.set_state("crashed", traceback.format_exc().rstrip().splitlines()[-1])
            log("the league thread has died:\n" + traceback.format_exc().rstrip())

    def boot(self):
        """Get everything the league needs, however long that takes.

        Each pass of prepare() checks what is still missing — the database,
        the migration, the engine, an AI account to seat — and keeps what it
        found, so an engine found on the first pass is not respawned on the
        tenth. A miss is a state, said once when it changes and again every
        few attempts, and then a wait that lengthens from BOOT_RETRY_MIN to
        BOOT_RETRY_MAX. Nothing here is decided once for the life of the
        process: a migration run after the deploy, or a database that was
        asleep for the first minute, is picked up on the next pass. Returns
        True when ready, False when stopped while waiting or when the miss
        is one that waiting cannot mend.
        """
        delay = BOOT_RETRY_MIN
        while self.running:
            self.attempts += 1
            try:
                self.prepare()
                return True
            except NotReady as err:
                self.set_state(err.state, err.reason)
                if err.terminal:
                    log("the league cannot run in this process; it will not be retried")
                    return False
            except Exception:                   # noqa: BLE001 - a bug in prepare() is not a reason to die
                self.stats["errors"] += 1
                self.set_state("starting", "unexpected error while starting: "
                               + traceback.format_exc().rstrip().splitlines()[-1])
                log(traceback.format_exc().rstrip())
            if self.attempts == 1 or self.attempts % 10 == 0:
                log("not ready (attempt %d): %s — trying again in %.0fs" % (self.attempts, self.reason, delay))
            waited = 0.0
            while self.running and waited < delay:
                time.sleep(0.05 if FAST else 0.25)
                waited += 0.05 if FAST else 0.25
            delay = min(BOOT_RETRY_MAX, delay * 2)
        return False

    def prepare(self):
        """One pass at readiness, in the order the pieces depend on each other.

        The rules, then the database, then its schema, then the engine, then
        somebody to seat. Each raises NotReady naming its state; what is
        found stays found.
        """
        if chess is None:
            raise NotReady("python-chess unavailable",
                           "the `chess` package is not installed (pip install -r requirements.txt)",
                           terminal=True)
        if self.store is None:
            if self.setting != "memory" and supabase_db.enabled():
                store = SupabaseStore()
                try:
                    checked = store.verify_schema()
                except MigrationMissing as err:
                    raise NotReady("migration missing", str(err))
                except StoreUnavailable as err:
                    raise NotReady("database unavailable", str(err))
                self.store, self.store_kind = store, "supabase"
                log("database: Supabase with the service key; schema verified (%s)" % checked)
            else:
                if supabase_db.enabled():
                    log("database: NOX_LEAGUE=memory — the real accounts, results kept in this process")
                else:
                    log("database: no SUPABASE_SERVICE_KEY — the real accounts read with the "
                        "publishable key, results kept in this process and lost on restart")
                try:
                    self.store = memory_store()
                except (StoreUnavailable, OSError, ValueError) as err:
                    raise NotReady("database unavailable", str(err))
                self.store_kind = "memory"
        if self.engines is None:
            path, how = find_stockfish()
            if not path:
                raise NotReady("stockfish unavailable", how)
            try:
                self.engines = EnginePool(ENGINES, path)
            except (OSError, EngineDead) as err:
                raise NotReady("stockfish unavailable", "%s would not start (%s): %r" % (path, how, err))
            self.engine_path = path
            log("engine: %s at %s (%s), %d process%s"
                % (self.engines.name or "unnamed", path, how, ENGINES, "" if ENGINES == 1 else "es"))
        try:
            players = self.store.players()
        except MigrationMissing as err:
            raise NotReady("migration missing", str(err))
        except StoreUnavailable as err:
            raise NotReady("database unavailable", str(err))
        counts = {m: sum(1 for p in players if p["is_bot"] and isinstance(p["ratings"].get(m), int))
                  for m in MODES}
        self.counts = counts
        log("players: %d profile rows, %d AI accounts; rated AI accounts per ladder: %s"
            % (len(players), sum(1 for p in players if p["is_bot"]),
               ", ".join("%s %d" % (MODE_NAME[m], counts[m]) for m in MODES)))
        if not any(counts.values()):
            raise NotReady("no eligible players",
                           "no AI account has a rating on any ladder — have %s and %s been run?"
                           % (PROFILES_FILE, VISIONS_FILE))

    def store_trouble(self, err):
        if self.store_down_since is None:
            self.store_down_since = time.time()
            log("database unavailable — games pause until it answers: %s" % err)
        if self.state == "running":
            self.set_state("migration missing" if isinstance(err, MigrationMissing) else "database unavailable",
                           str(err))

    # ---- the pool

    def refresh_players(self, now):
        rows = self.store.players()
        pools = {m: [] for m in MODES}
        for r in rows:
            for mode in MODES:
                rating = r["ratings"].get(mode)
                if isinstance(rating, int):
                    pools[mode].append({"id": r["id"], "name": r["name"], "rating": rating,
                                        "is_bot": bool(r.get("is_bot"))})
        with self.lock:
            self.players = pools
            self.players_at = now
            for match in self.matches.values():
                # a rating cannot move while its owner is at a board, but the
                # name can be re-read cheaply
                for side in (match.white, match.black):
                    for p in pools[match.mode]:
                        if p["id"] == side["id"]:
                            side["name"] = p["name"]

    def top(self, mode):
        """The ladder as the home page shows it: TOP_N by rating, ties by name."""
        ranked = sorted(self.players[mode], key=lambda p: (-p["rating"], p["name"].lower(), p["id"]))
        return ranked[:TOP_N]

    def eligible(self, mode):
        """Who may be seated in this vision right now.

        The top twenty of the ladder, humans included in the count — a person
        standing in the top twenty holds that place, and is never seated — of
        whom the AI accounts not already at a board in this vision. Nobody
        outside the twenty, whatever their rating, and nobody invented.
        """
        busy = set()
        for m in self.matches.values():
            if m.mode == mode:
                busy.update((m.white["id"], m.black["id"]))
        for row in self.foreign.values():
            if row.get("mode") == mode:
                busy.update((row.get("white_id"), row.get("black_id")))
        return [p for p in self.top(mode) if p["is_bot"] and p["id"] not in busy]

    def pick_pair(self, mode):
        """Two opponents within MAX_GAP of each other, chosen at random.

        The pool is shuffled and the first player who has anybody within a
        hundred points is seated; among their valid opponents, one neither has
        met in their last few games is preferred, and one is drawn at random
        from whichever set that leaves. Colours favour whoever had black last.
        Returns (white, black) or None when nobody can be paired.
        """
        pool = self.eligible(mode)
        self.rng.shuffle(pool)
        for a in pool:
            cands = [b for b in pool if b["id"] != a["id"] and abs(a["rating"] - b["rating"]) <= MAX_GAP]
            if not cands:
                continue
            recent_a = self.recent[mode].get(a["id"], [])
            fresh = [b for b in cands
                     if b["id"] not in recent_a and a["id"] not in self.recent[mode].get(b["id"], [])]
            b = self.rng.choice(fresh or cands)
            last = self.last_color[mode]
            owed = [p for p in (a, b) if last.get(p["id"]) == "b"]
            if len(owed) == 1:
                white = owed[0]
            else:
                white = self.rng.choice((a, b))
            black = b if white is a else a
            seat = lambda p: {"id": p["id"], "name": p["name"], "rating": p["rating"]}
            return seat(white), seat(black)
        return None

    def pairing_report(self, mode):
        """The numbers behind a pairing, for the log: how many rows the ladder
        has, how many of the top twenty are AI accounts, how many of those
        are free, and how many pairs among the free are within MAX_GAP."""
        top = self.top(mode)
        bots = [p for p in top if p["is_bot"]]
        free = self.eligible(mode)
        pairs = 0
        for i, a in enumerate(free):
            for b in free[i + 1:]:
                if abs(a["rating"] - b["rating"]) <= MAX_GAP:
                    pairs += 1
        return {"rows": len(self.players[mode]), "top": len(top), "bots": len(bots),
                "free": len(free), "pairings": pairs}

    def explain_pairing(self, mode, report):
        """Why this ladder has no game right now, as one log line."""
        name = MODE_NAME[mode]
        if not report["rows"]:
            return "%s: nobody has a rating on this ladder (has %s been run?)" % (name, VISIONS_FILE)
        if not report["bots"]:
            return ("%s: no AI accounts in the top %d (%d leaderboard rows) — nothing to seat"
                    % (name, TOP_N, report["rows"]))
        if report["bots"] < 2:
            return ("%s: only one AI account in the top %d (%d leaderboard rows) — nobody for it to play"
                    % (name, TOP_N, report["rows"]))
        if report["free"] < 2:
            return ("%s: %d leaderboard rows, %d bots in the top %d, %d free — the rest are at a board"
                    % (name, report["rows"], report["bots"], TOP_N, report["free"]))
        return ("%s: no valid pairing within %d Elo (%d leaderboard rows, %d bots in the top %d, %d free)"
                % (name, MAX_GAP, report["rows"], report["bots"], TOP_N, report["free"]))

    def note_mode(self, mode, status, why, now):
        """Record what a ladder is doing, and log it when it changes — or
        again after WHY_REPEAT, so a ladder stuck for an hour is still in
        the last hour of the log."""
        with self.lock:
            st = self.mode_status[mode]
            changed = st["status"] != status or st["why"] != why
            st["status"], st["why"], st["at"] = status, why, now
            say = why and (changed or now - st["said"] >= WHY_REPEAT)
            if say:
                st["said"] = now
        if say:
            log(why)

    def note_pairing(self, mode, white, black):
        for me, them, color in ((white, black, "w"), (black, white, "b")):
            seen = self.recent[mode].setdefault(me["id"], [])
            seen.append(them["id"])
            del seen[:-RECENT_MEMORY]
            self.last_color[mode][me["id"]] = color

    # ---- games

    def live_in(self, mode):
        n = sum(1 for m in self.matches.values() if m.mode == mode)
        n += sum(1 for r in self.foreign.values() if r.get("mode") == mode)
        return n

    def arrange(self, mode, now):
        report = self.pairing_report(mode)
        pair = self.pick_pair(mode)
        if pair is None:
            self.note_mode(mode, "waiting", self.explain_pairing(mode, report), now)
            self.next_fill[mode] = now + (2.0 if FAST else 30.0)
            return None
        white, black = pair
        try:
            gid = self.store.start_game(mode, white, black, START_FEN, CLOCK_MS, self.owner)
        except SeatTaken as err:
            # Somebody else's game seats one of them: see what is live and try
            # again next tick rather than guessing.
            self.note_mode(mode, "waiting", "%s: seat taken (%s) — re-reading live games"
                           % (MODE_NAME[mode], err), now)
            self.adopted_at = 0.0
            self.next_fill[mode] = now + 2.0
            return None
        match = Match(gid, mode, white, black, chess.Board(), [], [], CLOCK_MS, CLOCK_MS, now, now)
        match.due = now + think_seconds(match.board, 0, None, CLOCK_MS, self.rng)
        with self.lock:
            self.matches[gid] = match
            self.note_pairing(mode, white, black)
            self.stats["games"] += 1
        log("%s: %d leaderboard rows, %d bots in the top %d, %d free, %d valid pairings"
            % (MODE_NAME[mode], report["rows"], report["bots"], TOP_N, report["free"], report["pairings"]))
        log("%s match created:\n  %s (%d) vs %s (%d)"
            % (MODE_NAME[mode], white["name"], white["rating"], black["name"], black["rating"]))
        self.note_mode(mode, "playing", "", now)
        self.publish()
        return match

    def recover(self):
        """Sit back down at every live row this process can own. Startup only."""
        rows = self.store.live_games()
        log("%d live game%s in the database" % (len(rows), "" if len(rows) == 1 else "s"))
        self.refresh_players(time.time())
        for mode in MODES:
            for row in self.store.recent_finished(mode):
                for me, them in ((row["white_id"], row["black_id"]), (row["black_id"], row["white_id"])):
                    seen = self.recent[mode].setdefault(me, [])
                    if len(seen) < RECENT_MEMORY:
                        seen.append(them)
        self.adopt_rows(rows, time.time())

    def adopt_rows(self, rows, now):
        foreign = {}
        for row in rows:
            gid = row["id"]
            if gid in self.matches:
                continue
            lease = from_iso(row.get("lease_until"))
            if row.get("owner") and row["owner"] != self.owner and lease >= now:
                foreign[gid] = row
                continue
            claimed = self.store.claim(gid, self.owner)
            if not claimed:
                foreign[gid] = row
                continue
            self.resume(claimed, now)
        with self.lock:
            self.foreign = foreign
            self.adopted_at = now

    def resume(self, row, now):
        """A row is a game only if its moves replay. If they do and the rules say
        it is over, it is finished properly; otherwise play carries on from the
        clocks as they were written, with the time the process was away
        uncharged — the bots did not spend it."""
        mode = row["mode"]
        board = chess.Board()
        moves = row.get("moves", "").split()
        sans = row.get("sans", "").split()
        try:
            for u in moves:
                board.push_uci(u)
        except (ValueError, AssertionError):
            log("%s game %s: moves do not replay — abandoned" % (MODE_NAME[mode], row["id"][:8]))
            self.store.abandon(row["id"], "corrupt record")
            return None
        if len(sans) != len(moves):
            # regenerate the written moves rather than trust a half-written list
            b2 = chess.Board()
            sans = []
            for u in moves:
                mv = chess.Move.from_uci(u)
                sans.append(b2.san(mv))
                b2.push(mv)
        white = {"id": row["white_id"], "name": row["white_name"],
                 "rating": self.rating_of(mode, row["white_id"], row["white_elo_before"])}
        black = {"id": row["black_id"], "name": row["black_name"],
                 "rating": self.rating_of(mode, row["black_id"], row["black_elo_before"])}
        match = Match(row["id"], mode, white, black, board, moves, sans,
                      int(row["white_ms"]), int(row["black_ms"]), now,
                      from_iso(row.get("started_at")) or now)
        with self.lock:
            self.matches[match.id] = match
            self.note_pairing(mode, white, black)
        log("%s match resumed at ply %d:\n  %s (%d) vs %s (%d)"
            % (MODE_NAME[mode], match.ply, white["name"], white["rating"], black["name"], black["rating"]))
        ended = outcome_of(board)
        if ended:
            self.finish(match, *ended, now=now)
        else:
            match.due = now + think_seconds(board, match.ply, None, match.remaining(match.turn(), now), self.rng)
        return match

    def rating_of(self, mode, pid, fallback):
        for p in self.players[mode]:
            if p["id"] == pid:
                return p["rating"]
        return fallback

    def tick(self, now):
        if now - self.players_at > PLAYERS_EVERY:
            self.refresh_players(now)
        if now - self.adopted_at > ADOPT_EVERY:
            self.adopt_rows(self.store.live_games(), now)
        if self.store_down_since is not None:
            log("database is answering again after %.0fs" % (now - self.store_down_since))
            self.store_down_since = None
            if self.state != "running":
                self.set_state("running")
        # One ladder's trouble is one ladder's: a game that raises, or a pool
        # that cannot be arranged, is logged against its vision and the loop
        # goes on to the next. Only the database being away is everybody's
        # problem, and that one is still raised through to run().
        for match in list(self.matches.values()):
            try:
                if match.pending_finish and now >= match.retry_at:
                    self.finish(match, *match.pending_finish, now=now)
                elif match.status == "live" and now >= match.due:
                    self.play_move(match, now)
            except StoreUnavailable:
                raise
            except Exception:               # noqa: BLE001 - one board, not the league
                self.mode_failed(match.mode, "game %s" % match.id[:8], now)
                match.due = now + (0.5 if FAST else 5.0)
        for mode in MODES:
            if self.live_in(mode) < self.games_per_mode and now >= self.next_fill[mode]:
                try:
                    self.arrange(mode, now)
                except StoreUnavailable:
                    raise
                except Exception:           # noqa: BLE001 - one ladder, not the league
                    self.mode_failed(mode, "arranging a game", now)
                    self.next_fill[mode] = now + (2.0 if FAST else 30.0)

    def mode_failed(self, mode, doing, now):
        self.stats["errors"] += 1
        text = traceback.format_exc().rstrip()
        self.note_mode(mode, "error", "%s: error while %s — %s"
                       % (MODE_NAME[mode], doing, text.splitlines()[-1]), now)
        log("%s: error while %s; the other ladders carry on:\n%s" % (MODE_NAME[mode], doing, text))

    def play_move(self, match, now):
        color = match.turn()
        mover = match.side(color)
        left = match.remaining(color, now)
        if left <= 0:
            other = "b" if color == "w" else "w"
            other_color = chess.BLACK if color == "w" else chess.WHITE
            if match.board.has_insufficient_material(other_color):
                self.finish(match, "1/2-1/2", None, "timeout", now=now)
            else:
                self.finish(match, "1-0" if other == "w" else "0-1", other, "timeout", now=now)
            return
        elo = engine_elo_for(mover["rating"])
        try:
            uci, score, mate = self.engines.ask(match.moves, elo, movetime_for(elo))
        except EngineDead:
            log("engine died mid-move; retrying in a moment")
            match.due = now + 2.0
            return
        if uci == "(none)":
            ended = outcome_of(match.board)
            if ended:
                self.finish(match, *ended, now=now)
            return
        try:
            move = chess.Move.from_uci(uci)
            if move not in match.board.legal_moves:
                raise ValueError(uci)
        except ValueError:
            log("engine offered %s, which is not legal here — asking again" % uci)
            match.due = now + 1.0
            return
        san = match.board.san(move)
        spent = int((now - match.last_move_at) * 1000)
        fields = {
            "moves": " ".join(match.moves + [uci]),
            "sans": " ".join(match.sans + [san]),
            "fen": None,                       # filled below, once the move is on the board
            "white_ms": match.white_ms - (spent if color == "w" else 0),
            "black_ms": match.black_ms - (spent if color == "b" else 0),
            "last_move_at": iso(now),
        }
        board_after = match.board.copy()
        board_after.push(move)
        fields["fen"] = board_after.fen()
        try:
            ok = self.store.write_move(match.id, self.owner, match.ply + 1, fields)
        except StoreUnavailable as err:
            self.store_trouble(err)
            match.due = now + (0.5 if FAST else 5.0)
            return
        if not ok:
            log("%s game %s is being played by another server now — letting go"
                % (MODE_NAME[match.mode], match.id[:8]))
            with self.lock:
                self.matches.pop(match.id, None)
                self.adopted_at = 0.0
            self.publish()
            return
        match.board.push(move)
        match.moves.append(uci)
        match.sans.append(san)
        match.white_ms, match.black_ms = fields["white_ms"], fields["black_ms"]
        match.last_move_at = now
        match.evals.append((color, score))
        self.stats["moves"] += 1
        log("Move: %s %s%s" % (mover["name"], san, " (%s)" % uci if san != uci else ""))
        ended = outcome_of(match.board)
        if ended:
            self.finish(match, *ended, now=now)
        else:
            concede = self.concession(match)
            if concede:
                self.finish(match, *concede, now=now)
            else:
                nxt = match.turn()
                match.due = now + think_seconds(match.board, match.ply, score,
                                                match.remaining(nxt, now), self.rng)
        self.publish()

    def concession(self, match):
        """Resignation and agreed draws, the way engines actually end games.

        Stockfish will play a lost position to mate and a dead-drawn one to the
        fifty-move rule, and a viewer would rather not sit through either. So a
        side that has judged itself lost — nine hundred centipawns or worse, or
        mated by force — on each of its last four moves resigns, and a game past
        move forty in which the last ten evaluations were all level and nothing
        has been captured or pushed for as long is agreed drawn. Both are read
        off scores the engine already reported; neither costs a search.
        """
        evals = match.evals
        if match.ply >= 40 and len(evals) >= 8:
            last = evals[-1]
            mine = [cp for c, cp in evals[-8:] if c == last[0]]
            if len(mine) >= 4 and all(cp is not None and cp <= -900 for cp in mine[-4:]):
                loser = last[0]
                winner = "b" if loser == "w" else "w"
                return ("1-0" if winner == "w" else "0-1"), winner, "resignation"
        if match.ply >= 80 and len(evals) >= 10 and match.board.halfmove_clock >= 10:
            if all(cp is not None and abs(cp) <= 12 for _, cp in evals[-10:]):
                return "1/2-1/2", None, "draw by agreement"
        return None

    def finish(self, match, result, winner, termination, now=None):
        now = now or time.time()
        match.status = "finishing"
        match.result, match.winner, match.termination = result, winner, termination
        winner_id = match.side(winner)["id"] if winner else None
        try:
            done = self.store.finish(
                match.id, result, winner_id, termination, " ".join(match.moves),
                " ".join(match.sans), match.board.fen(), match.ply, pgn_of(match),
                match.white_ms, match.black_ms)
        except StoreUnavailable as err:
            self.store_trouble(err)
            match.pending_finish = (result, winner, termination)
            match.retry_at = now + (0.5 if FAST else 5.0)
            return
        match.pending_finish = None
        match.status = "finished"
        match.finished_at = now
        if done is None:
            log("%s game %s was already settled elsewhere — no rating change here"
                % (MODE_NAME[match.mode], match.id[:8]))
        else:
            match.white["rating"] = done["white_after"]
            match.black["rating"] = done["black_after"]
            self.stats["finished"] += 1
            w, b = match.white, match.black
            if winner == "w":
                log("Result: %s defeated %s (%s, %s)" % (w["name"], b["name"], MODE_NAME[match.mode], termination))
            elif winner == "b":
                log("Result: %s defeated %s (%s, %s)" % (b["name"], w["name"], MODE_NAME[match.mode], termination))
            else:
                log("Result: %s and %s drew (%s, %s)" % (w["name"], b["name"], MODE_NAME[match.mode], termination))
            log("Rating:\n  %s %d → %d\n  %s %d → %d"
                % (w["name"], done["white_before"], done["white_after"],
                   b["name"], done["black_before"], done["black_after"]))
            with self.lock:
                for p in self.players[match.mode]:
                    if p["id"] == w["id"]:
                        p["rating"] = done["white_after"]
                    elif p["id"] == b["id"]:
                        p["rating"] = done["black_after"]
        with self.lock:
            self.last_finished[match.mode] = match.snapshot(now)
            self.matches.pop(match.id, None)
            self.next_fill[match.mode] = max(self.next_fill[match.mode], now + RESULT_PAUSE)
        self.publish()

    # ---- what the page sees

    def featured(self, now=None):
        """One game per vision: the live one with the strongest pair, or, while
        the next is being arranged, the one that has just ended."""
        now = now or time.time()
        out = []
        with self.lock:
            for mode in MODES:
                live = [m for m in self.matches.values() if m.mode == mode and m.status != "finished"]
                if live:
                    best = max(live, key=lambda m: m.white["rating"] + m.black["rating"])
                    out.append(best.snapshot(now))
                elif mode in self.last_finished:
                    out.append(self.last_finished[mode])
                else:
                    out.append({"mode": mode, "modeName": MODE_NAME[mode], "status": "waiting"})
        return out

    def payload(self):
        """The socket's snapshot. `off` and `note` appear only while the
        league is not running, and say what is wrong in public terms."""
        now = time.time()
        out = {"t": "live-games", "at": int(now * 1000), "games": self.featured(now), "state": self.state}
        if self.state != "running":
            out["off"] = True
            out["note"] = self.public_note()
        return out

    def public_note(self):
        return PUBLIC_NOTE.get(self.state, PUBLIC_NOTE["off"])

    def subscribe(self, client):
        with self.lock:
            self.listeners.add(client)
        client.send(self.payload())

    def unsubscribe(self, client):
        with self.lock:
            self.listeners.discard(client)

    def publish(self):
        payload = self.payload()
        with self.lock:
            watchers = list(self.listeners)
        for client in watchers:
            if getattr(client, "alive", True):
                client.send(payload)
            else:
                self.unsubscribe(client)

    def health(self):
        """For /health: the state and, per ladder, what it is doing and why.

        Public, like the endpoint: the state's public sentence, never the
        full reason (which may quote an error body), no path but the
        engine's, and no key. The full reason is in the log.
        """
        with self.lock:
            modes = {}
            for m in MODES:
                st = self.mode_status[m]
                live = sum(1 for x in self.matches.values() if x.mode == m)
                status = "playing" if live else (st["status"] if st["status"] != "idle" else
                                                 ("waiting" if self.state == "running" else "idle"))
                modes[m] = {"name": MODE_NAME[m], "live": live, "status": status,
                            "why": st["why"] if status != "playing" else "",
                            "rated": self.counts.get(m)}
            return {
                "state": self.state,
                "note": self.public_note(),
                "since": iso(self.state_since),
                "attempts": self.attempts,
                "store": self.store_kind,
                "live": len(self.matches),
                "elsewhere": len(self.foreign),
                "moves": self.stats["moves"],
                "finished": self.stats["finished"],
                "errors": self.stats["errors"],
                "engine": getattr(self.engines, "name", "") or "",
                "enginePath": self.engine_path,
                "owner": self.owner,
                "modes": modes,
            }


# ------------------------------------------------------------------ boot

def page_constant(name):
    """A string constant off the top of blind-chess.html, e.g. the publishable key.

    The page ships its Supabase URL and publishable key in the clear — they
    are safe to publish, and every visitor already has them — so a server
    with no service key can read the public leaderboard with exactly the
    rights a signed-out visitor has, without a setting of its own.
    """
    try:
        with open(PAGE, "r", encoding="utf-8") as fh:
            head = fh.read(400000)
    except OSError:
        return ""
    m = re.search(r"const %s\s*=\s*'([^']*)'" % re.escape(name), head)
    return m.group(1) if m else ""


def public_profiles():
    """Every profile row, read as a visitor would. Raises StoreUnavailable."""
    url = (os.environ.get("SUPABASE_URL") or page_constant("SUPABASE_URL")).rstrip("/")
    key = os.environ.get("SUPABASE_ANON_KEY") or page_constant("SUPABASE_ANON_KEY")
    if not url or not key:
        raise StoreUnavailable("no Supabase URL and publishable key to read the leaderboard with")
    req = urllib.request.Request(url + "/rest/v1/profiles?select=*", method="GET")
    req.add_header("apikey", key)
    req.add_header("Accept", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read())
    except (urllib.error.URLError, OSError, ValueError) as err:
        raise StoreUnavailable("could not read profiles: %s" % err)


def memory_store():
    """The real accounts, kept in this process: a fixture file if one is named,
    the public leaderboard otherwise."""
    store = MemoryStore()
    if FIXTURE:
        with open(FIXTURE, "r", encoding="utf-8") as fh:
            rows = json.load(fh)
        log("players read from %s" % FIXTURE)
    else:
        rows = public_profiles()
        log("players read from the public leaderboard; results are NOT stored "
            "(set SUPABASE_SERVICE_KEY to keep them)")
    store.seed_rows(rows)
    return store


def build(setting=None):
    """The league the server should run, or None only when it is switched off.

    NOX_LEAGUE=off is the one thing that turns it off. Everything else —
    with a service key the league runs against Supabase and every game and
    rating is written back; without one, or with NOX_LEAGUE=memory, on the
    same accounts read with the page's publishable key, results kept in
    memory — is decided by League.boot() on its own thread, once start() is
    called, and decided again as often as it has to be. This used to check
    the database, the engine and the players here, once, and answer None on
    the first miss; a server that booted a minute before its migration was
    run, or with its engine a directory off PATH, then had no league until
    somebody redeployed it, and the log line saying why had scrolled off.
    Now a miss is a state on /health and a sentence under the cards, the
    reason is logged when it changes, and the next attempt is never more
    than a minute away. Either way the players are the leaderboard's:
    nothing is ever made up to fill a board.
    """
    setting = (setting if setting is not None else os.environ.get("NOX_LEAGUE") or "on").strip().lower()
    if setting == "off":
        log("off (NOX_LEAGUE=off)")
        return None
    log("starting: %s; %d game%s per ladder; %d-minute clocks%s"
        % ("Supabase" if (setting != "memory" and supabase_db.enabled()) else "memory store",
           GAMES_PER_MODE, "" if GAMES_PER_MODE == 1 else "s", MINUTES, " (FAST)" if FAST else ""))
    return League(setting=setting)
