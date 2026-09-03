#!/usr/bin/env python3
"""Mine the shipped puzzle set as a labelled corpus for the knowledge base.

`puzzles/*.json` holds 788 puzzles produced and audited by the repo's own
Stockfish pipeline. Each carries a FEN, the solution line, engine evaluations and
a theme list written by `findMotifs()`. That makes it a labelled dataset of real,
verified positions — better evidence than anything constructed by hand, and it
already exists.

Two jobs:

  coverage   Which puzzle themes have concept records and which do not, weighted
             by how often they actually occur. This turns "what should I research
             next" from a guess into a measurement.

  sample     Pull candidate example positions for a concept, so a record can cite
             real engine-verified positions instead of constructed ones.

IMPORTANT: the themes were written BY findMotifs(). Comparing a findMotifs-based
detector against them would be circular and prove nothing. They are used here as
a research-priority signal and as a source of positions, not as ground truth for
validating detection.

    python3 tools/corpus.py coverage
    python3 tools/corpus.py sample --theme fork --limit 5
"""
import argparse, json, os, sys
from collections import Counter

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.dirname(HERE)
TRACKS = ("opening", "middlegame", "endgame")


def load_puzzles():
    out = []
    for t in TRACKS:
        p = os.path.join(REPO, "puzzles", f"{t}.json")
        if not os.path.exists(p):
            continue
        for rec in json.load(open(p)):
            rec["_track"] = t
            out.append(rec)
    return out


def load_concepts():
    C = {}
    for dp, _, fs in os.walk(os.path.join(HERE, "concepts")):
        for fn in sorted(fs):
            if fn.endswith(".json"):
                c = json.load(open(os.path.join(dp, fn)))
                C[c["id"]] = c
    return C


def theme_to_concept():
    """theme -> (concept_id or None, kind).

    kind is 'motif' (findMotifs), 'concept' (a real chess idea the pipeline tags),
    or 'metadata' (a property of the puzzle, which must NEVER become a concept).
    """
    m = json.load(open(os.path.join(HERE, "tools", "motif_map.json")))
    out = {k: (v.get("concept"), "motif") for k, v in m["map"].items()}
    tw = m["theme_tags_without_concepts"]
    for t, v in tw["chess_concepts_to_research"].items():
        out[t] = (v.get("concept"), "concept")
    for t in tw["puzzle_metadata_not_chess_concepts"]:
        if t != "note":
            out[t] = (None, "metadata")
    return out


def coverage(args):
    puzzles, C = load_puzzles(), load_concepts()
    t2c = theme_to_concept()
    counts = Counter()
    per_track = {t: Counter() for t in TRACKS}
    for p in puzzles:
        for th in p.get("themes", []):
            counts[th] += 1
            per_track[p["_track"]][th] += 1

    print(f"{len(puzzles)} puzzles across {len(TRACKS)} tracks\n")
    print(f"{'theme':20} {'n':>5} {'op':>4} {'mg':>4} {'eg':>4}  {'kind':9} {'concept':24} status")
    print("-" * 98)
    missing, meta = [], []
    covered = total = 0
    for th, n in counts.most_common():
        cid, kind = t2c.get(th, (None, "concept"))
        if kind == "metadata":
            status, cid_s = "not a chess concept", "-"
            meta.append((th, n))
        else:
            total += n
            c = C.get(cid) if cid else None
            cid_s = cid or "(none)"
            if c:
                status = c["status"]["stage"]; covered += n
            else:
                status = "NO RECORD"; missing.append((th, n, cid))
        print(f"{th:20} {n:5} {per_track['opening'][th]:4} {per_track['middlegame'][th]:4} "
              f"{per_track['endgame'][th]:4}  {kind:9} {cid_s:24} {status}")

    print(f"\nchess-concept theme instances covered: {covered}/{total} "
          f"({100*covered//max(total,1)}%)")
    if meta:
        print("excluded as puzzle metadata (correctly, not a gap): "
              + ", ".join(f"{t} ({n})" for t, n in meta))
    if missing:
        print("\nresearch targets, by how often they actually occur:")
        for th, n, cid in missing:
            print(f"  {n:5}  {th:20} -> {cid or 'NEEDS RESEARCH BEFORE NAMING'}")


def sample(args):
    puzzles = load_puzzles()
    hits = [p for p in puzzles if args.theme in p.get("themes", [])]
    if args.track:
        hits = [p for p in hits if p["_track"] == args.track]
    hits.sort(key=lambda p: p.get("seedRating", 0))
    if args.hardest:
        hits.reverse()
    print(f"{len(hits)} puzzles tagged {args.theme!r}"
          + (f" in {args.track}" if args.track else ""))
    for p in hits[:args.limit]:
        why = p.get("why") or {}
        first = (why.get("moves") or [{}])[0]
        print(f"\n  id     {p['id']}   track {p['_track']}   rating~{p.get('seedRating')}"
              f"   settleDepth {p.get('settleDepth')}")
        print(f"  fen    {p['fen']}")
        print(f"  line   {' '.join(p.get('moves', []))}")
        print(f"  themes {', '.join(p.get('themes', []))}")
        if first.get("text"):
            print(f"  why    {first.get('san','')}: {first['text'][:150]}")


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("coverage")
    s = sub.add_parser("sample")
    s.add_argument("--theme", required=True)
    s.add_argument("--track", choices=TRACKS)
    s.add_argument("--limit", type=int, default=5)
    s.add_argument("--hardest", action="store_true")
    a = ap.parse_args()
    {"coverage": coverage, "sample": sample}[a.cmd](a)


if __name__ == "__main__":
    main()
