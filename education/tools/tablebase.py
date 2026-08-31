#!/usr/bin/env python3
"""Tablebase lookup for the Education System.

Uses the public Lichess tablebase API (7-piece Syzygy). Chosen over a local
Syzygy install because 3-4-5 tables alone are ~1 GB of binary that would have to
be gitignored and re-fetched on every machine, while the API covers 7 pieces and
returns exactly what we store: WDL, DTZ, DTM.

Only FENs are sent. Nothing about the user or the repository leaves the machine.

Where a position is within reach of tablebases, its result is a PROVEN FACT and
outranks any engine evaluation. Record it as knowledge_type 'tablebase-fact' and
stop searching.

    python3 tools/tablebase.py --fen "8/8/3k1pp1/8/P2K4/5PP1/8/8 b - - 0 1"
    python3 tools/tablebase.py --fen "..." --json
"""
import argparse, json, sys, time, urllib.parse, urllib.request, urllib.error

API = "https://tablebase.lichess.ovh/standard"
UA = "nox-chess-education-system/1.0 (research tooling)"
MAX_PIECES = 7

CATEGORY_TO_WDL = {
    "win": "win", "cursed-win": "cursed-win", "draw": "draw",
    "blessed-loss": "blessed-loss", "loss": "loss",
    "maybe-win": "unknown", "maybe-loss": "unknown", "unknown": "unknown",
}


def piece_count(fen):
    board = fen.split()[0]
    return sum(1 for ch in board if ch.isalpha())


def lookup(fen, retries=3, pause=1.5):
    n = piece_count(fen)
    if n > MAX_PIECES:
        return {"fen": fen, "pieces": n, "wdl": "unknown",
                "note": f"{n} pieces — beyond the 7-piece tables; use engine analysis instead."}
    url = API + "?" + urllib.parse.urlencode({"fen": fen})
    last = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=30) as r:
                d = json.load(r)
            break
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
            last = e
            if attempt == retries - 1:
                return {"fen": fen, "pieces": n, "wdl": "unknown",
                        "note": f"lookup failed: {e}"}
            time.sleep(pause * (attempt + 1))
    cat = d.get("category", "unknown")
    out = {
        "source": "Lichess tablebase (Syzygy, 7-piece)",
        "fen": fen, "pieces": n,
        "wdl": CATEGORY_TO_WDL.get(cat, "unknown"),
        "category": cat,
        "dtz": d.get("dtz"), "dtm": d.get("dtm"),
        "checkmate": d.get("checkmate"), "stalemate": d.get("stalemate"),
        "note": "",
    }
    best = (d.get("moves") or [None])[0]
    if best:
        out["best_move"] = best.get("uci")
        out["best_move_san"] = best.get("san")
        out["best_move_category"] = best.get("category")
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--fen", required=True)
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()
    r = lookup(a.fen)
    if a.json:
        print(json.dumps(r, indent=2)); return
    print(f"FEN     {r['fen']}")
    print(f"pieces  {r['pieces']}")
    print(f"result  {r['wdl']}   (api category: {r.get('category')})")
    print(f"dtz     {r.get('dtz')}    dtm {r.get('dtm')}")
    if r.get("best_move_san"):
        print(f"best    {r['best_move_san']}  ({r.get('best_move_category')})")
    if r.get("note"):
        print(f"note    {r['note']}")


if __name__ == "__main__":
    main()
