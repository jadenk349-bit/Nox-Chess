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

    print("\n\033[1m%d passed, %d failed\033[0m\n" % (passed, failed))
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
