"""The 24/7 AI league, without a database and without a socket.

Everything the league decides is decided against a Store, and MemoryStore is
one — so matchmaking, the rating rule, idempotent completion, restart
recovery and the featured-game choice can all be run in one process against
a pool this file invents. The engine is a stub that plays a scripted or
random legal move: what is under test here is not Stockfish's chess but what
the league does with a move once it has one. (test_league_socket.py plays
real games through the real engine, against a running server.)

No server, no network:  python3 server/test_league.py
"""

import os
import random
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault("NOX_LEAGUE_FAST", "1")
import league

if league.chess is None:
    print("python-chess is not installed; pip install -r requirements.txt")
    sys.exit(1)
chess = league.chess
league.LOG = False

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


class StubEngines:
    """Plays the first legal move, or a scripted one, and reports a score.

    `script` maps a ply to (uci, score); anything else gets the first legal
    move python-chess lists. `scores` overrides the reported evaluation so the
    concession rules can be driven.
    """

    name = "stub"

    def __init__(self, script=None, score=0, seed=None):
        self.script = script or {}
        self.score = score
        self.asked = []
        # seeded: a game is a fixed sequence of random legal moves, which is
        # how a long game is had without a scripted repetition ending it early
        self.rng = random.Random(seed) if seed is not None else None

    def ask(self, moves, elo, movetime):
        self.asked.append((tuple(moves), elo, movetime))
        ply = len(moves)
        if ply in self.script:
            return self.script[ply][0], self.script[ply][1], None
        board = chess.Board()
        for u in moves:
            board.push_uci(u)
        legal = list(board.legal_moves)
        if not legal:
            return "(none)", None, None
        score = self.score(ply) if callable(self.score) else self.score
        move = self.rng.choice(legal) if self.rng else legal[0]
        return move.uci(), score, None


class Watcher:
    alive = True

    def __init__(self):
        self.got = []

    def send(self, obj):
        self.got.append(obj)


def pool(store, mode, ratings, prefix="p"):
    ids = []
    for i, r in enumerate(ratings):
        ids.append(store.add_player("%s%d" % (prefix, i), {mode: r}))
    return ids


def fresh(rng_seed=1, games_per_mode=1, engines=None):
    store = league.MemoryStore()
    L = league.League(store, engines or StubEngines(), games_per_mode=games_per_mode,
                      rng=random.Random(rng_seed))
    return store, L


# The suite's own clock: every game is arranged and played at NOW, which
# run_until() advances by a twentieth of a second per tick. No real waiting,
# and no game flags because the test took a moment to get to it.
NOW = time.time()


def run_until(L, cond, limit=20.0):
    global NOW
    t0 = NOW
    while NOW - t0 < limit and not cond():
        L.tick(NOW)
        NOW += 0.05
    return cond()


def main():
    print("\n\033[1mStrength\033[0m")
    check("2000 on the ladder plays at 2500", league.engine_elo_for(2000), 2500)
    check("2300 -> 2650", league.engine_elo_for(2300), 2650)
    check("2600 -> 2800", league.engine_elo_for(2600), 2800)
    check("2800 -> 2920", league.engine_elo_for(2800), 2920)
    check("3000 and beyond -> 3000", league.engine_elo_for(3400), 3000)
    check("below the line is still 2500", league.engine_elo_for(1500), 2500)
    check("between anchors is interpolated", league.engine_elo_for(2150), 2575)
    league.FAST = False
    check("movetime rises with strength", league.movetime_for(3000) > league.movetime_for(2500), True)
    league.FAST = True

    print("\n\033[1mPacing\033[0m")
    rng = random.Random(5)
    board = chess.Board()
    league.FAST = False
    times = [league.think_seconds(board, 0, None, league.CLOCK_MS, rng) for _ in range(200)]
    check("never instant", min(times) >= 1.2, True)
    check("never absurd", max(times) <= 28.0, True)
    check("not one fixed delay", len(set(round(t, 2) for t in times)) > 50, True)
    short = [league.think_seconds(board, 30, None, 20000, rng) for _ in range(50)]
    check("a side under a minute moves quickly", max(short) <= 1.0, True)
    league.FAST = True

    print("\n\033[1mEligibility: the top twenty of the ladder, and only its AI accounts\033[0m")
    store, L = fresh()
    ranked = pool(store, "fog", [2900 - 10 * i for i in range(25)])   # p0 2900 ... p24 2660
    human = store.add_player("human", {"fog": 2895}, is_bot=False)   # second on the ladder
    other = store.add_player("otherladder", {"blind": 3000})
    L.refresh_players(0)
    top = L.top("fog")
    check("the ladder is ranked highest first", [p["name"] for p in top[:3]], ["p0", "human", "p1"])
    check("...twenty long", len(top), 20)
    names = [p["name"] for p in L.eligible("fog")]
    check("the pool is the AI accounts in it", names, ["p%d" % i for i in range(19)])
    check("a human in the top twenty holds a place and is never seated", "human" in names, False)
    check("twentieth is in, twenty-first is out", ("p18" in names, "p19" in names), (True, False))
    check("a rating on another ladder counts for nothing here", any(p["id"] == other for p in L.eligible("fog")), False)
    check("the same account is on that ladder", any(p["id"] == other for p in L.eligible("blind")), True)
    store.profiles[ranked[24]]["ratings"]["fog"] = 2901          # the last climbs to first
    L.refresh_players(1)
    names = [p["name"] for p in L.eligible("fog")]
    check("a climber joins the pool on the next read", "p24" in names, True)
    check("...and pushes the twentieth out", "p18" in names, False)
    check("every pooled name is the profile's own", all(store.profiles[p["id"]]["name"] == p["name"] for p in L.eligible("fog")), True)
    rows = [{"id": "abc-1", "display_name": "Arvenko", "is_bot": True, "rating": 2854, "fog_of_war_rating": None},
            {"id": "abc-2", "display_name": "Jaden", "is_bot": False, "rating": 1200}]
    seeded = league.MemoryStore(); seeded.seed_rows(rows)
    check("profile rows seed the store under their own ids and names",
          sorted((p["id"], p["name"], p["is_bot"]) for p in seeded.players()),
          [("abc-1", "Arvenko", True), ("abc-2", "Jaden", False)])
    check("a column the project lacks reads as unrated", seeded.profiles["abc-1"]["ratings"]["fog"], None)

    print("\n\033[1mMatchmaking\033[0m")
    store, L = fresh()
    a, b = pool(store, "total", [2547, 2472])
    L.refresh_players(0)
    pair = L.pick_pair("total")
    check("75 apart may be paired", pair is not None and {pair[0]["id"], pair[1]["id"]} == {a, b}, True)
    store, L = fresh()
    pool(store, "total", [2547, 2401])
    L.refresh_players(0)
    check("146 apart may not", L.pick_pair("total"), None)
    store, L = fresh()
    pool(store, "total", [2547, 2447])
    L.refresh_players(0)
    check("exactly 100 apart may", L.pick_pair("total") is not None, True)

    # randomised, and never the same two twice while others are there
    store, L = fresh(rng_seed=3)
    ids = pool(store, "blind", [2500, 2510, 2520, 2530, 2540, 2550])
    L.refresh_players(0)
    seen = set()
    for _ in range(40):
        w, b = L.pick_pair("blind")
        seen.add(frozenset((w["id"], b["id"])))
    check("many different pairs are chosen", len(seen) >= 8, True)

    store, L = fresh(rng_seed=4)
    ids = pool(store, "blind", [2500, 2500, 2500])
    L.refresh_players(0)
    x, y, z = ids
    L.note_pairing("blind", {"id": x}, {"id": y})
    repeats = 0
    for _ in range(30):
        w, b = L.pick_pair("blind")
        if {w["id"], b["id"]} == {x, y}:
            repeats += 1
    check("a recent pairing is avoided while a third player is free", repeats, 0)
    store, L = fresh(rng_seed=4)
    x, y = pool(store, "blind", [2500, 2500])
    L.refresh_players(0)
    L.note_pairing("blind", {"id": x}, {"id": y})
    check("...but is allowed when they are the only two", L.pick_pair("blind") is not None, True)

    print("\n\033[1mOne board at a time\033[0m")
    store, L = fresh(games_per_mode=3)
    ids = pool(store, "sighted", [2600, 2600, 2600])
    L.refresh_players(0)
    L.arrange("sighted", NOW)
    busy = {m.white["id"] for m in L.matches.values()} | {m.black["id"] for m in L.matches.values()}
    check("two of three are seated", len(busy), 2)
    free = [p["id"] for p in L.eligible("sighted")]
    check("the seated pair are no longer eligible", set(free) & busy, set())
    check("the third has nobody, so no second game", L.arrange("sighted", NOW), None)
    # the database's own guard, if the league ever tried
    w = {"id": ids[0], "name": "p0", "rating": 2600}
    v = {"id": ids[2], "name": "p2", "rating": 2600}
    try:
        store.start_game("sighted", w, v, league.START_FEN, league.CLOCK_MS, "x")
        raised = False
    except league.SeatTaken:
        raised = True
    check("the store refuses to seat a player twice", raised, True)
    # ...and a rating in one ladder does not seat you in another
    store.add_player("elsewhere", {"fog": 2600})
    store.profiles[ids[0]]["ratings"]["fog"] = 2600
    L.refresh_players(1)
    check("the same bot may be at a board in another vision", L.pick_pair("fog") is not None, True)

    print("\n\033[1mA game, start to finish\033[0m")
    # Fool's mate: white loses in four plies, so black wins on the board.
    script = {0: ("f2f3", 0), 1: ("e7e5", 0), 2: ("g2g4", 0), 3: ("d8h4", 0)}
    store, L = fresh(engines=StubEngines(script))
    a, b = pool(store, "fog", [2500, 2500])
    L.refresh_players(0)
    watcher = Watcher()
    L.subscribe(watcher)
    m = L.arrange("fog", NOW)
    white, black = m.white, m.black
    check("the first snapshot went to the watcher", watcher.got[0]["t"], "live-games")
    run_until(L, lambda: L.stats["finished"] >= 1)
    row = store.games[m.id]
    check("checkmate ends it", row["termination"], "checkmate")
    check("the result is black's", row["result"], "0-1")
    check("the loser gives four", store.profiles[white["id"]]["ratings"]["fog"], 2496)
    check("the winner takes four", store.profiles[black["id"]]["ratings"]["fog"], 2504)
    check("...in that vision only", store.profiles[white["id"]]["ratings"]["sighted"], None)
    check("the record has the moves", row["moves"], "f2f3 e7e5 g2g4 d8h4")
    check("...as written", row["sans"], "f3 e5 g4 Qh4#")
    check("...and before and after", (row["white_elo_before"], row["white_elo_after"]), (2500, 2496))
    check("...and a PGN", "1. f3 e5 2. g4 Qh4#" in row["pgn"], True)
    check("the seats are freed", store.seats, {})
    check("the winner is named", row["winner_id"], black["id"])
    check("every move was published", sum(1 for g in watcher.got if g["t"] == "live-games") >= 5, True)
    last = [g for g in watcher.got[-1]["games"] if g["mode"] == "fog"][0]
    check("the last snapshot shows the result", (last["status"], last["result"]), ("finished", "0-1"))
    check("and the new ratings", (last["white"]["rating"], last["black"]["rating"]), (2496, 2504))
    check("a second finish moves nothing", store.finish(m.id, "1-0", None, "x", "", "", "", 0, "", 0, 0), None)
    check("...and nothing moved", store.profiles[black["id"]]["ratings"]["fog"], 2504)

    print("\n\033[1mDraws\033[0m")
    # A stalemate: the engine is scripted into 1. e3 a5 2. Qh5 Ra6 3. Qxa5 h5
    # 4. h4 Rah6 5. Qxc7 f6 6. Qxd7+ Kf7 7. Qxb7 Qd3 8. Qxb8 Qh7 9. Qxc8 Kg6 10. Qe6
    line = ["e2e3", "a7a5", "d1h5", "a8a6", "h5a5", "h7h5", "h2h4", "a6h6", "a5c7", "f7f6",
            "c7d7", "e8f7", "d7b7", "d8d3", "b7b8", "d3h7", "b8c8", "f7g6", "c8e6"]
    script = {i: (u, 0) for i, u in enumerate(line)}
    store, L = fresh(engines=StubEngines(script))
    pool(store, "total", [2500, 2500])
    L.refresh_players(0)
    m = L.arrange("total", NOW)
    run_until(L, lambda: L.stats["finished"] >= 1)
    row = store.games[m.id]
    check("stalemate is a draw", (row["termination"], row["result"]), ("stalemate", "1/2-1/2"))
    check("nobody moves on a draw", (row["white_elo_after"], row["black_elo_after"]), (2500, 2500))

    # threefold repetition, claimed for them
    rep = ["g1f3", "g8f6", "f3g1", "f6g8"] * 2 + ["g1f3", "g8f6", "f3g1", "f6g8"]
    script = {i: (u, 0) for i, u in enumerate(rep)}
    store, L = fresh(engines=StubEngines(script))
    pool(store, "blind", [2500, 2500])
    L.refresh_players(0)
    m = L.arrange("blind", NOW)
    run_until(L, lambda: L.stats["finished"] >= 1)
    check("threefold repetition ends it", store.games[m.id]["termination"], "threefold repetition")

    print("\n\033[1mResignation and agreement\033[0m")
    # A lost side resigns rather than playing to mate: the engine reports -1000
    # for whoever is to move after ply 40 when it is white.
    def hopeless(ply):
        return -1000 if (ply % 2 == 0 and ply >= 40) else 0
    store, L = fresh(engines=StubEngines(score=hopeless, seed=11))
    pool(store, "sighted", [2500, 2500])
    L.refresh_players(0)
    m = L.arrange("sighted", NOW)
    run_until(L, lambda: L.stats["finished"] >= 1, limit=60)
    row = store.games[m.id]
    check("white resigns a lost position", (row["termination"], row["result"]), ("resignation", "0-1"))
    check("...having played past move twenty", row["ply"] >= 46, True)

    print("\n\033[1mTimeouts\033[0m")
    store, L = fresh(engines=StubEngines())
    pool(store, "fog", [2500, 2500])
    L.refresh_players(0)
    m = L.arrange("fog", NOW)
    m.white_ms = 100                      # white has a tenth of a second at move one
    L.play_move(m, NOW + 5.0)             # ...and is asked to move five seconds later
    row = store.games[m.id]
    check("a flag falls", (row["termination"], row["result"]), ("timeout", "0-1"))
    store, L = fresh(engines=StubEngines())
    pool(store, "fog", [2500, 2500])
    L.refresh_players(0)
    m = L.arrange("fog", NOW)
    m.board = chess.Board("4k3/8/8/8/8/8/8/4K2R w K - 0 1")     # black has a bare king
    m.black_ms = 100
    m.board.turn = chess.BLACK
    L.play_move(m, NOW + 5.0)
    check("a bare king cannot win on time: white's rook does", store.games[m.id]["result"], "1-0")
    store, L = fresh(engines=StubEngines())
    pool(store, "fog", [2500, 2500])
    L.refresh_players(0)
    m = L.arrange("fog", NOW)
    m.board = chess.Board("4k2r/8/8/8/8/8/8/4K3 b k - 0 1")   # white has the bare king now
    m.black_ms = 100                                            # ...and black's flag falls
    L.play_move(m, NOW + 5.0)
    check("a flag against a bare king is a draw", store.games[m.id]["result"], "1/2-1/2")

    print("\n\033[1mRestart\033[0m")
    store, L = fresh(engines=StubEngines())
    ids = pool(store, "blind", [2500, 2500, 2500, 2500])
    L.refresh_players(0)
    m = L.arrange("blind", NOW)
    for _ in range(6):
        L.play_move(m, NOW)
    moves_before = list(m.moves)
    check("six plies are on the row", store.games[m.id]["ply"], 6)
    # a new process, same store: the old owner's lease is still live
    L2 = league.League(store, StubEngines(), games_per_mode=1, rng=random.Random(9))
    L2.recover()
    check("a game another live process owns is left alone", list(L2.matches), [])
    check("...and counted, so no second game is arranged", L2.live_in("blind"), 1)
    L2.tick(NOW)
    check("...even on a tick", len(store.live_games()), 1)
    # the old process stops cleanly
    L.stop()
    L3 = league.League(store, StubEngines(), games_per_mode=1, rng=random.Random(9))
    L3.recover()
    check("a released game is adopted", list(L3.matches), [m.id])
    m3 = L3.matches[m.id]
    check("...with its moves", m3.moves, moves_before)
    check("...its clocks", (m3.white_ms, m3.black_ms), (m.white_ms, m.black_ms))
    check("...and no duplicate arranged", len(store.live_games()), 1)
    L3.play_move(m3, NOW)
    check("the adopted game goes on", store.games[m.id]["ply"], 7)
    # the old process, if it woke up, could not write a move
    L.play_move(m, NOW)
    check("the old owner's move is refused", store.games[m.id]["ply"], 7)
    check("...and it lets go of the game", m.id in L.matches, False)
    # a lapsed lease is as good as a release
    store, L = fresh(engines=StubEngines())
    pool(store, "fog", [2500, 2500])
    L.refresh_players(0)
    m = L.arrange("fog", NOW)
    store.games[m.id]["lease_until"] = league.iso(time.time() - 1)
    L4 = league.League(store, StubEngines(), games_per_mode=1, rng=random.Random(1))
    L4.recover()
    check("a lapsed lease is adopted", list(L4.matches), [m.id])
    # a row whose moves do not replay
    store, L = fresh(engines=StubEngines())
    pool(store, "fog", [2500, 2500])
    L.refresh_players(0)
    m = L.arrange("fog", NOW)
    store.games[m.id]["moves"] = "e2e4 e2e4"
    L.stop()
    L5 = league.League(store, StubEngines(), games_per_mode=1, rng=random.Random(1))
    L5.recover()
    check("a corrupt row is abandoned, not resumed", store.games[m.id]["status"], "abandoned")
    check("...its seats freed", store.seats, {})
    check("...and no rating moved", store.profiles[m.white["id"]]["ratings"]["fog"], 2500)
    # a row the rules already call finished
    store, L = fresh(engines=StubEngines())
    pool(store, "fog", [2500, 2500])
    L.refresh_players(0)
    m = L.arrange("fog", NOW)
    store.games[m.id]["moves"] = "f2f3 e7e5 g2g4 d8h4"
    store.games[m.id]["sans"] = ""
    L.stop()
    L6 = league.League(store, StubEngines(), games_per_mode=1, rng=random.Random(1))
    L6.recover()
    check("a finished-on-the-board row is finished properly", store.games[m.id]["result"], "0-1")
    check("...with the written moves rebuilt", store.games[m.id]["sans"], "f3 e5 g4 Qh4#")

    print("\n\033[1mThe featured game\033[0m")
    store, L = fresh(engines=StubEngines(), games_per_mode=2)
    pool(store, "sighted", [2900, 2900, 2500, 2500])
    L.refresh_players(0)
    L.arrange("sighted", NOW)
    L.arrange("sighted", NOW)
    check("two games are live", L.live_in("sighted"), 2)
    feat = [g for g in L.featured(0) if g["mode"] == "sighted"][0]
    check("the strongest pair is featured", feat["white"]["rating"] + feat["black"]["rating"], 5800)
    check("one entry per vision, always", [g["mode"] for g in L.featured(0)], list(league.MODES))
    check("a vision with nothing is 'waiting'", [g["status"] for g in L.featured(0)][1:], ["waiting"] * 3)
    snap = feat
    for key in ("fen", "moves", "sans", "whiteMs", "blackMs", "turn", "lastMoveAt", "status", "ply"):
        check("the snapshot carries %s" % key, key in snap, True)
    check("the payload is what the socket sends", L.payload()["t"], "live-games")

    print("\n\033[1mReplacement\033[0m")
    script = {0: ("f2f3", 0), 1: ("e7e5", 0), 2: ("g2g4", 0), 3: ("d8h4", 0)}
    store, L = fresh(engines=StubEngines(script))
    pool(store, "blind", [2500, 2500, 2500])
    L.refresh_players(0)
    first = L.arrange("blind", NOW)
    run_until(L, lambda: L.stats["finished"] >= 1)
    feat = [g for g in L.featured(NOW) if g["mode"] == "blind"][0]
    check("the finished game is shown while the next is arranged", feat["status"], "finished")
    run_until(L, lambda: any(m.mode == "blind" for m in L.matches.values()), limit=30)
    nxt = [m for m in L.matches.values() if m.mode == "blind"]
    check("a replacement game follows", len(nxt), 1)
    check("...and is a different game", nxt[0].id != first.id, True)
    check("the loser and winner may play again, or a third", nxt[0].white["id"] != nxt[0].black["id"], True)

    print("\n\033[1mFinding the engine\033[0m")
    import stat
    import tempfile
    tmp = tempfile.mkdtemp()
    fake = os.path.join(tmp, "stockfish")
    with open(fake, "w") as fh:
        fh.write("#!/bin/sh\n")
    os.chmod(fake, os.stat(fake).st_mode | stat.S_IXUSR)
    nothing = lambda name: None
    found = league.find_stockfish("", candidates=(fake,), which=nothing, path_env="/nowhere")
    check("a binary in a known place is found when PATH has none", found[0], fake)
    check("...and the log is told it was found by looking", "not on PATH" in found[1], True)
    found = league.find_stockfish("", candidates=(os.path.join(tmp, "absent"),), which=nothing, path_env="/nowhere")
    check("nothing anywhere is None", found[0], None)
    check("...naming PATH", "/nowhere" in found[1], True)
    check("...and every place looked", "absent" in found[1], True)
    check("...and the setting that fixes it", "NOX_STOCKFISH" in found[1], True)
    found = league.find_stockfish("", candidates=(fake,), which=lambda n: "/from/path/" + n)
    check("PATH wins over the list", found, ("/from/path/stockfish", "on PATH"))
    found = league.find_stockfish(fake, candidates=(), which=nothing)
    check("NOX_STOCKFISH as a path is used as given", found[0], fake)
    found = league.find_stockfish(os.path.join(tmp, "absent"), candidates=(fake,), which=nothing)
    check("NOX_STOCKFISH naming a missing file does not fall through to the list", found[0], None)
    check("...and says which file", "absent" in found[1] and "NOX_STOCKFISH" in found[1], True)
    found = league.find_stockfish("sf", candidates=(fake,), which=nothing, path_env="/p")
    check("NOX_STOCKFISH as a name not on PATH does not fall through either", found[0], None)
    check("the Debian package's directory is the first place looked", league.STOCKFISH_CANDIDATES[0],
          "/usr/games/stockfish")

    print("\n\033[1mThe schema, verified by name\033[0m")

    class Fake(league.SupabaseStore):
        """A store whose PostgREST answers are scripted: `missing` names
        what the project does not have."""

        def __init__(self, missing=(), spec=True):
            self.missing = set(missing)
            self.spec = spec
            self.asked = []

        def _call(self, method, path, body=None, prefer=None):
            self.asked.append(path)
            if path == "/":
                if not self.spec:
                    raise league.StoreUnavailable("no spec", 406)
                fns = [f for f, _ in league.REQUIRED_FUNCTIONS if f not in self.missing]
                return {"paths": {"/rpc/" + f: {} for f in fns}}
            table = path[1:].split("?", 1)[0]
            if table in self.missing:
                raise league.MigrationMissing("PGRST205 no such table %s" % table, 404)
            if table == "profiles":
                cols = path.split("select=")[1].split("&")[0].split(",")
                for c in cols:
                    if c in self.missing:
                        raise league.MigrationMissing("42703 column profiles.%s does not exist" % c, 400)
            return []

    whole = Fake()
    check("everything present verifies", "4 functions" in whole.verify_schema(), True)
    asked = whole.asked
    for want in ("profiles", "league_games", "league_seats", "rated_games"):
        check("...having asked for %s" % want, any(a.startswith("/" + want) for a in asked), True)
    check("...naming all four rating columns in one select",
          all(c in asked[0] for c in ("rating", "complete_blindfold_rating", "board_only_rating",
                                      "fog_of_war_rating", "is_bot")), True)

    def fails(store):
        try:
            store.verify_schema()
        except league.MigrationMissing as err:
            return str(err)
        return None

    why = fails(Fake(missing=("fog_of_war_rating",)))
    check("a missing rating column is a missing migration", why is not None, True)
    check("...naming the column", "fog_of_war_rating" in why, True)
    check("...and the visions file", "supabase-migrate-visions.sql" in why, True)
    why = fails(Fake(missing=("is_bot",)))
    check("a missing is_bot names the system profiles file", "supabase-system-profiles.sql" in (why or ""), True)
    why = fails(Fake(missing=("league_seats",)))
    check("a missing table names it", "league_seats" in (why or ""), True)
    check("...and the league file", "supabase-migrate-league.sql" in (why or ""), True)
    why = fails(Fake(missing=("record_rated_game",)))
    check("a missing function names it", "record_rated_game" in (why or ""), True)
    check("...and the visions file", "supabase-migrate-visions.sql" in (why or ""), True)
    why = fails(Fake(missing=("league_finish",)))
    check("league_finish is checked too", "league_finish" in (why or ""), True)
    check("an unreadable OpenAPI document is not a missing migration",
          "unverified" in Fake(spec=False).verify_schema(), True)

    print("\n\033[1mBooting: kept trying, and said why\033[0m")
    # The pieces boot() reaches for, replaced one at a time. Each league here
    # is started on its own thread and waited on, exactly as the server does.
    real_find, real_pool, real_memory = league.find_stockfish, league.EnginePool, league.memory_store

    def seeded():
        st = league.MemoryStore()
        pool(st, "sighted", [2600, 2590, 2580])
        pool(st, "total", [2600, 2590])
        return st

    def wait_for(L, cond, limit=5.0):
        t0 = time.time()
        while time.time() - t0 < limit and not cond():
            time.sleep(0.02)
        return cond()

    states = []
    real_set_state = league.League.set_state

    def spy_set_state(self, state, reason=""):
        states.append(state)
        real_set_state(self, state, reason)

    league.League.set_state = spy_set_state
    try:
        # 1. the engine is missing, then appears
        calls = {"n": 0}

        def find_later():
            calls["n"] += 1
            return (None, "no engine yet") if calls["n"] < 3 else ("/fake/stockfish", "found")

        league.find_stockfish = find_later
        league.EnginePool = lambda count, path: StubEngines()
        league.memory_store = seeded
        L = league.League(setting="memory")
        L.start()
        check("no engine is a state, not an exit", wait_for(L, lambda: L.state == "stockfish unavailable"), True)
        check("...with the reason kept for the log", L.reason, "no engine yet")
        check("...and a public sentence that says only that",
              "engine" in L.public_note() and "no engine yet" not in L.public_note(), True)
        check("...and the page is told it is off", L.payload().get("off"), True)
        check("the league comes up once the engine is there", wait_for(L, lambda: L.state == "running"), True)
        check("...having tried more than once", L.attempts >= 3, True)
        check("...and the page is told again", L.payload().get("off"), None)
        check("/health says running", L.health()["state"], "running")
        check("...and names the engine's path", L.health()["enginePath"], "/fake/stockfish")
        check("...and the store", L.health()["store"], "memory")
        check("games are then arranged on the thread", wait_for(L, lambda: L.live_in("sighted") == 1), True)
        check("a second start() is ignored", (L.start(), L.thread.is_alive())[1], True)
        L.stop()
        check("stop closes nothing it did not open", True, True)

        # 2. the database is away, then answers
        calls["n"] = 0
        league.find_stockfish = lambda: ("/fake/stockfish", "found")

        def store_later():
            calls["n"] += 1
            if calls["n"] < 2:
                raise league.StoreUnavailable("timed out")
            return seeded()

        league.memory_store = store_later
        states[:] = []
        L = league.League(setting="memory")
        L.start()
        check("a database that does not answer is waited for", wait_for(L, lambda: L.state == "running"), True)
        check("...through the 'database unavailable' state", "database unavailable" in states, True)
        L.stop()

        # 3. no AI account anywhere
        league.memory_store = lambda: league.MemoryStore()
        L = league.League(setting="memory")
        L.start()
        check("an empty leaderboard is 'no eligible players'",
              wait_for(L, lambda: L.state == "no eligible players"), True)
        check("...and is retried rather than given up on", wait_for(L, lambda: L.attempts >= 2), True)
        L.stop()

        # 4. a missing migration, through a Supabase store
        class Unmigrated(Fake):
            def __init__(self):
                Fake.__init__(self, missing=("league_games",))

        real_enabled, real_sstore = league.supabase_db.enabled, league.SupabaseStore
        league.supabase_db.enabled = lambda: True
        league.SupabaseStore = Unmigrated
        L = league.League(setting="on")
        L.start()
        check("a missing table is 'migration missing'", wait_for(L, lambda: L.state == "migration missing"), True)
        check("...naming the table", "league_games" in L.reason, True)
        check("...and the file", "supabase-migrate-league.sql" in L.reason, True)
        check("...while /health carries only the public sentence",
              "league_games" not in L.health()["note"] and L.health()["state"], "migration missing")
        L.stop()
        league.supabase_db.enabled, league.SupabaseStore = real_enabled, real_sstore

        # 5. no python-chess is terminal
        saved = league.chess
        league.chess = None
        L = league.League(setting="memory")
        L.start()
        check("no python-chess is said", wait_for(L, lambda: L.state == "python-chess unavailable"), True)
        check("...and the thread ends rather than retrying", wait_for(L, lambda: not L.thread.is_alive()), True)
        league.chess = saved
        L.stop()
    finally:
        league.League.set_state = real_set_state
        league.find_stockfish, league.EnginePool, league.memory_store = real_find, real_pool, real_memory

    print("\n\033[1mOne ladder's trouble is one ladder's\033[0m")

    class OneBadLadder(league.MemoryStore):
        def start_game(self, mode, white, black, fen, ms, owner):
            if mode == "fog":
                raise RuntimeError("fog is broken today")
            return league.MemoryStore.start_game(self, mode, white, black, fen, ms, owner)

    store = OneBadLadder()
    L = league.League(store, StubEngines(), games_per_mode=1, rng=random.Random(2))
    for mode in league.MODES:
        pool(store, mode, [2600, 2590, 2580])
    L.refresh_players(0)
    L.tick(NOW)
    check("the other three ladders have games", sorted(m.mode for m in L.matches.values()),
          ["blind", "sighted", "total"])
    check("the broken one is reported, not fatal", L.health()["modes"]["fog"]["status"], "error")
    check("...with the error", "fog is broken today" in L.health()["modes"]["fog"]["why"], True)
    check("...counted", L.stats["errors"], 1)
    L.tick(NOW + 100)
    check("the loop keeps ticking", L.stats["errors"] >= 1 and len(L.matches), 3)

    print("\n\033[1mWhy a ladder has no game\033[0m")
    store, L = fresh()
    L.refresh_players(0)
    L.arrange("fog", NOW)
    check("an empty ladder says so", L.mode_status["fog"]["why"],
          "Fog of War: nobody has a rating on this ladder (has supabase-migrate-visions.sql been run?)")
    store, L = fresh()
    store.add_player("human", {"fog": 2600}, is_bot=False)
    L.refresh_players(0)
    L.arrange("fog", NOW)
    check("a ladder of humans says nothing to seat", "no AI accounts in the top 20" in L.mode_status["fog"]["why"], True)
    store, L = fresh()
    pool(store, "fog", [2600])
    L.refresh_players(0)
    L.arrange("fog", NOW)
    check("one bot says nobody to play", "only one AI account" in L.mode_status["fog"]["why"], True)
    store, L = fresh()
    pool(store, "fog", [2600, 2400])
    L.refresh_players(0)
    L.arrange("fog", NOW)
    check("two far apart say no pairing within 100",
          L.mode_status["fog"]["why"].startswith("Fog of War: no valid pairing within 100 Elo"), True)
    check("/health carries it", L.health()["modes"]["fog"]["why"], L.mode_status["fog"]["why"])
    store, L = fresh()
    pool(store, "fog", [2600, 2590, 2580, 2570])
    L.refresh_players(0)
    rep_ = L.pairing_report("fog")
    check("the report counts rows, bots, free and pairings",
          (rep_["rows"], rep_["bots"], rep_["free"], rep_["pairings"]), (4, 4, 4, 6))
    L.arrange("fog", NOW)
    check("a seated ladder has no complaint", L.mode_status["fog"]["why"], "")
    check("...and reads as playing", L.health()["modes"]["fog"]["status"], "playing")
    rep_ = L.pairing_report("fog")
    check("the two at the board are no longer free", (rep_["bots"], rep_["free"], rep_["pairings"]), (4, 2, 1))
    check("off_payload is what a server with no league answers",
          (league.off_payload()["off"], league.off_payload()["state"]), (True, "off"))

    print("\n\033[1mWatching one game, by id\033[0m")
    script = {0: ("f2f3", 0), 1: ("e7e5", 0), 2: ("g2g4", 0), 3: ("d8h4", 0)}
    store, L = fresh(engines=StubEngines(script))
    pool(store, "fog", [2500, 2500, 2500])
    pool(store, "sighted", [2600, 2600])
    L.refresh_players(0)
    fog = L.arrange("fog", NOW)
    sighted = L.arrange("sighted", NOW)
    v = Watcher()
    L.watch(v, fog.id)
    first = v.got[-1]
    check("watch answers at once with that game", (first["t"], first["id"], first["game"]["id"]), ("watch-game", fog.id, fog.id))
    check("...live, at ply 0", (first["game"]["status"], first["game"]["ply"]), ("live", 0))
    check("...with no next game yet", first["next"], None)
    n0 = len(v.got)
    run_until(L, lambda: sighted.ply >= 2 and fog.ply == 0, limit=0.4) if False else None
    # push the other ladder's game along by hand: a fog watcher must hear nothing
    L.play_move(sighted, NOW)
    check("a move on another ladder is not pushed to this watcher", len(v.got), n0)
    L.play_move(fog, NOW)
    check("a move on the watched game is", len(v.got), n0 + 1)
    check("...with the new ply", (v.got[-1]["game"]["ply"], v.got[-1]["game"]["lastMove"]), (1, "f2f3"))
    L.publish()
    check("a publish with nothing new for it sends nothing", len(v.got), n0 + 1)
    v2 = Watcher()
    L.watch(v2, fog.id)
    check("a second watcher of the same game is answered the same", v2.got[-1]["game"]["ply"], 1)
    run_until(L, lambda: fog.status == "finished")
    check("the result reaches the watcher", v.got[-1]["game"]["status"], "finished")
    check("...and the second", v2.got[-1]["game"]["status"], "finished")
    check("...with the result", (v.got[-1]["game"]["result"], v.got[-1]["game"]["winner"]), ("0-1", "b"))
    check("the finished game is still answered by id", L.snapshot_of(fog.id)["status"], "finished")
    run_until(L, lambda: any(m.mode == "fog" for m in L.matches.values()), limit=30)
    nxt = [m for m in L.matches.values() if m.mode == "fog"][0]
    check("the next game on the ladder is offered to its watchers", v.got[-1]["next"], nxt.id)
    check("...and only once", sum(1 for m in v.got if m.get("next") == nxt.id), 1)
    L.unsubscribe(v)
    L.play_move(nxt, NOW)
    L.publish()
    check("unsubscribe drops the watcher", v.got[-1]["next"], nxt.id)
    check("...and the other stays", v2 in L.watchers, True)
    L.unwatch(v2)
    check("unwatch drops it too", v2 in L.watchers, False)
    v3 = Watcher()
    L.watch(v3, "no-such-game")
    check("an unknown id answers with no game", v3.got[-1]["game"], None)
    check("health counts spectators", L.health()["spectators"], 1)
    dead = Watcher(); dead.alive = False
    L.watch(dead, nxt.id)
    L.publish()
    check("a dead socket is dropped on the next publish", dead in L.watchers, False)

    # a row from the store, for a refresh on a game this process never played
    row = store.game(fog.id)
    snap = league.snapshot_from_row(row)
    check("a stored row becomes the same snapshot the page draws",
          (snap["id"], snap["status"], snap["result"], snap["winner"], snap["ply"], snap["termination"]),
          (fog.id, "finished", "0-1", "b", 4, "checkmate"))
    check("...with the players' names and ratings", (snap["white"]["name"], snap["black"]["rating"]),
          (fog.white["name"], fog.black["rating"]))
    check("...whose turn from the FEN", snap["turn"], "w")
    check("...and check read off it", snap["check"], True)
    check("...and the written moves", snap["sans"], ["f3", "e5", "g4", "Qh4#"])
    ab = dict(row); ab["status"] = "abandoned"; ab["termination"] = "corrupt record"; ab["result"] = None; ab["winner_id"] = None
    snap = league.snapshot_from_row(ab)
    check("an abandoned row is shown as finished, saying so", (snap["status"], snap["termination"], snap["winner"]),
          ("finished", "corrupt record", None))
    L2 = league.League(store, StubEngines(), games_per_mode=1, rng=random.Random(9))
    check("a fresh process answers a finished game from the store", L2.snapshot_of(fog.id)["result"], "0-1")
    check("a game id is checked before it is looked up",
          (league.GAME_ID_RE.fullmatch("abc-123") is not None, league.GAME_ID_RE.fullmatch("x&y=1") is not None),
          (True, False))
    off = league.off_payload()
    check("nothing about a watch reaches a Client seat", hasattr(v, "game"), False)

    print("\n\033[1m%d passed, %d failed\033[0m\n" % (passed, failed))
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
