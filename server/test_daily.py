#!/usr/bin/env python3
"""The day the Daily Puzzles rotate on, and the corpus they rotate through.

    python3 server/test_daily.py        # no server needed

Two questions, and they are asked here rather than in server/test_daily.js
because both of them are about files the browser suite cannot read: the
server's own day arithmetic, and whether the three places that carry the cycle
length still agree.

The rotation is the feature's whole promise — the same four positions for
everybody, all day, changing once at midnight UTC — and it rests on one number
computed in one place. A cycle of 100 in the page and 90 in the server would
give half the players yesterday's puzzle for ten days out of every hundred, and
nothing would look broken while it happened.
"""

import json
import os
import re
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

BOLD, GREEN, RED = "\033[1m", "\033[32m", "\033[31m"
OFF = "\033[0m"

passed = failed = 0


def check(label, got, want):
    global passed, failed
    if got == want:
        passed += 1
        print("  %sPASS%s %s  ->  %s" % (GREEN, OFF, label, got))
    else:
        failed += 1
        print("  %sFAIL%s %s\n        got  %r\n        want %r" % (RED, OFF, label, got, want))


def read(rel):
    with open(os.path.join(ROOT, rel), encoding="utf-8") as fh:
        return fh.read()


def main():
    server = read("server/server.py")
    page = read("blind-chess.html")

    print("\n%sOne cycle length, three files%s\n" % (BOLD, OFF))
    m = re.search(r"^DAILY_CYCLE = (\d+)", server, re.M)
    check("the server names a cycle", bool(m), True)
    server_cycle = int(m.group(1)) if m else 0
    p = re.search(r"^const DAILY_CYCLE = (\d+);", page, re.M)
    check("and so does the page", bool(p), True)
    page_cycle = int(p.group(1)) if p else 0
    check("they are the same number", (server_cycle, page_cycle), (100, 100))

    print("\n%sThe day is UTC days since the epoch%s\n" % (BOLD, OFF))
    # The arithmetic the endpoint does, done here against known instants. It is
    # deliberately not imported: server.py opens sockets and starts a league at
    # import time, and this is a statement about a formula, not about a process.
    day_of = lambda t: int(t // 86400)
    check("the epoch is day 0", day_of(0.0), 0)
    check("the first day ends one second before 86400", day_of(86399.0), 0)
    check("...and the next second is day 1", day_of(86400.0), 1)
    # 2026-09-08T00:00:00Z
    known = 1788912000.0
    check("a known midnight is a whole day", day_of(known) * 86400.0, known)
    check("noon that day is still that day", day_of(known + 43200), day_of(known))
    check("and one second before midnight is the day before",
          day_of(known + 86399) == day_of(known) and day_of(known + 86400) == day_of(known) + 1, True)

    print("\n%sThe rotation never leaves the corpus%s\n" % (BOLD, OFF))
    idx = lambda d: d % server_cycle
    check("day 0 takes rung 0", idx(0), 0)
    check("day 99 takes the last", idx(99), server_cycle - 1)
    check("day 100 comes round", idx(100), 0)
    check("day 101 is day 1's", idx(101), idx(1))
    # every day for four cycles lands inside the file and moves by exactly one
    steps = {(idx(d + 1) - idx(d)) % server_cycle for d in range(4 * server_cycle)}
    check("every day advances exactly one rung", steps, {1})
    check("and never leaves the file",
          all(0 <= idx(d) < server_cycle for d in range(10000)), True)

    print("\n%sThe endpoint says what the page reads%s\n" % (BOLD, OFF))
    check("the server serves /daily.json", '"/daily.json"' in server, True)
    for field in ("day", "index", "cycle", "nextUtc"):
        check("...and answers with %s" % field, '"%s"' % field in server, True)
    # the whole route, not a fixed window: the comment above the response is
    # longer than the response, and a window that clipped it would pass by
    # accident on a file that had lost the header
    route = server.split('elif path == "/daily.json":')[1].split("elif path ==")[0]
    check("it is never cached", "Cache-Control: no-store" in route, True)
    check("the page asks for it", "fetch('daily.json')" in page, True)

    print("\n%sThe four files, and what they may not contain%s\n" % (BOLD, OFF))
    modes = ["blindfold", "board", "fog", "sighted"]
    daily, missing = {}, []
    for k in modes:
        f = os.path.join(ROOT, "puzzles", "daily", "%s.json" % k)
        if not os.path.exists(f):
            missing.append(k)
            continue
        with open(f, encoding="utf-8") as fh:
            daily[k] = json.load(fh)

    if len(missing) == len(modes):
        print("  ..    no Daily corpus installed yet, skipping")
    else:
        ids, fens = {}, {}
        for k in modes:
            lst = daily.get(k, [])
            check("%s ships a hundred" % k, len(lst), 100)
            check("...numbered 1..n", [r["n"] for r in lst], list(range(1, len(lst) + 1)))
            for r in lst:
                ids.setdefault(r["id"], k)
                fens.setdefault(r["fen"], k)
        total = sum(len(daily.get(k, [])) for k in modes)
        check("four hundred in all", total, 400)
        check("every id is its own", len(ids), total)
        check("every position is its own", len(fens), total)

        # and none of them is a position the Puzzle page already ships
        theirs = set()
        for rel in ("puzzles/opening.json", "puzzles/middlegame.json", "puzzles/endgame.json",
                    "puzzles/modes/sighted.json", "puzzles/modes/board.json",
                    "puzzles/modes/blindfold.json", "puzzles/modes/fog.json",
                    "puzzles/modes/rush.json", "puzzles/modes/reserve.json",
                    "practices/opening.json", "practices/middlegame.json"):
            f = os.path.join(ROOT, rel)
            if not os.path.exists(f):
                continue
            with open(f, encoding="utf-8") as fh:
                for r in json.load(fh):
                    if isinstance(r, dict) and r.get("fen"):
                        theirs.add(r["fen"])
        check("no Daily position is on the Puzzle page", len(set(fens) & theirs), 0)

    print("\n%sThe Puzzle page cannot reach the Daily corpus%s\n" % (BOLD, OFF))
    # the allowlist serves them, and from a directory of their own
    served = re.findall(r'"(/puzzles/daily/\w+\.json)"', server)
    check("all four are served", len(served), 4)
    check("...from puzzles/daily/", all(s.startswith("/puzzles/daily/") for s in served), True)
    # and the Puzzle page's own loaders name the other two directories only
    for name in ("pzFetch", "pzFetchMode", "pcFetch"):
        body = re.search(r"function %s\(.*?\n\}" % name, page, re.S)
        check("%s() never reads puzzles/daily/" % name,
              "puzzles/daily" in (body.group(0) if body else ""), False)
    # nor does the interim bridge that deals the legacy files five ways
    body = re.search(r"function pzLegacyPools\(.*?\n\}", page, re.S)
    check("the legacy bridge never reads it either",
          "daily" in (body.group(0) if body else ""), False)

    print("\n%s%d passed, %d failed%s\n" % (BOLD, passed, failed, OFF))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
