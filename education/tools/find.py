#!/usr/bin/env python3
"""Search the knowledge base.

134 concepts, 166 sources and nearly a thousand recorded warnings are not usable
by reading the directory. This is the retrieval layer over them, for a person at
a terminal or a session picking the work back up.

    python3 tools/find.py outpost                  # concepts matching a term
    python3 tools/find.py "passed pawn" --full     # the whole record for the best match
    python3 tools/find.py --category endgame-principles
    python3 tools/find.py --type rule-of-thumb --evidence tablebase
    python3 tools/find.py --warnings "doubled"     # what must NOT be said about this
    python3 tools/find.py --disputed               # every unsettled attribution
    python3 tools/find.py --untested               # concepts with no engine or tablebase evidence
    python3 tools/find.py --source winter          # what a source is used for

Matching is deliberately dumb - substring and field scoring, no stemming and no
index. At this scale that is fast enough and has no failure modes of its own.
"""
import argparse, json, os, sys, glob

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def load():
    concepts = {}
    for f in sorted(glob.glob(os.path.join(HERE, "concepts", "*", "*.json"))):
        c = json.load(open(f, encoding="utf-8"))
        c["_path"] = os.path.relpath(f, HERE)
        concepts[c["id"]] = c
    sources = json.load(open(os.path.join(HERE, "sources", "sources.json"), encoding="utf-8"))["sources"]
    wpath = os.path.join(HERE, "state", "warnings_index.json")
    warnings = json.load(open(wpath, encoding="utf-8")) if os.path.exists(wpath) else {"entries": []}
    return concepts, sources, warnings


def evidence_of(c):
    pos = c.get("examples", []) + c.get("counterexamples", []) + c.get("ambiguous_examples", [])
    if any(p.get("tablebase") for p in pos):
        return "tablebase"
    if any(p.get("engine") for p in pos):
        return "engine"
    return "sources-only"


def score(c, term):
    """Where a term appears matters: an id match is worth more than a mention
    buried in a definition, or the base's longest records would win everything."""
    t = term.lower()
    s = 0
    if t == c["id"].lower():
        s += 100
    if t in c["id"].lower():
        s += 40
    if t in (c.get("canonical_name") or "").lower():
        s += 30
    for a in c.get("alternate_names", []) + c.get("historical_names", []):
        if t in a.lower():
            s += 20
    if t in (c.get("definition_short") or "").lower():
        s += 10
    if t in (c.get("category") or "").lower():
        s += 8
    for tag in c.get("tags", []):
        if t in tag.lower():
            s += 5
    if t in json.dumps(c).lower():
        s += 1
    return s


def brief(c):
    ev = evidence_of(c)
    mark = {"tablebase": "proven", "engine": "tested", "sources-only": "sourced"}[ev]
    return (f"{c['id']:<28} [{c['knowledge_type']:<28}] {mark:<7} "
            f"{c['category']}\n      {c.get('definition_short','')}")


def full(c):
    out = [f"# {c['canonical_name']}  ({c['id']})",
           f"category      {c['category']}   difficulty {c['difficulty']}",
           f"type          {c['knowledge_type']}   name_status {c.get('name_status')}",
           f"evidence      {evidence_of(c)}   source_confidence {c.get('source_confidence')}",
           f"engine era    {c.get('engine_era_status')}",
           f"stage         {c['status']['stage']}   path {c['_path']}",
           "", c.get("definition_long") or c.get("definition_short") or ""]
    for label, key in (("EXCEPTIONS", "exceptions"), ("MISCONCEPTIONS", "misconceptions"),
                       ("LIMITATIONS", "limitations")):
        if c.get(key):
            out.append(f"\n{label}")
            out += [f"  - {x}" for x in c[key]]
    traps = (c.get("recognition") or {}).get("false_positive_traps") or []
    if traps:
        out.append("\nFALSE-POSITIVE TRAPS")
        out += [f"  ! {x}" for x in traps]
    conf = (c.get("relationships") or {}).get("conflicts") or []
    if conf:
        out.append("\nCONFLICTS")
        for x in conf:
            out.append(f"  vs {x.get('concept')}: {x.get('resolution')}")
    if c.get("sources"):
        out.append("\nSOURCES  " + ", ".join(c["sources"]))
    return "\n".join(out)


def main():
    ap = argparse.ArgumentParser(add_help=True)
    ap.add_argument("term", nargs="?", help="free text to search for")
    ap.add_argument("--full", action="store_true", help="print the whole best-matching record")
    ap.add_argument("--category"); ap.add_argument("--type", dest="ktype")
    ap.add_argument("--evidence", choices=["tablebase", "engine", "sources-only"])
    ap.add_argument("--warnings", metavar="TERM", help="what must NOT be said about this")
    ap.add_argument("--disputed", action="store_true", help="unsettled attributions")
    ap.add_argument("--untested", action="store_true", help="no engine or tablebase evidence")
    ap.add_argument("--source", metavar="TERM", help="what a source is used for")
    ap.add_argument("--limit", type=int, default=12)
    a = ap.parse_args()

    C, S, W = load()

    if a.source:
        hits = {k: v for k, v in S.items() if a.source.lower() in (k + json.dumps(v)).lower()}
        for k, v in list(hits.items())[:a.limit]:
            users = [c["id"] for c in C.values() if k in c.get("sources", [])]
            print(f"\n{k}\n  {v.get('title')}  ({v.get('author')}, {v.get('year')})")
            print(f"  kind {v.get('kind')}   confidence {v.get('confidence')}")
            if v.get("note"):
                print(f"  note: {v['note']}")
            print(f"  used by {len(users)} concept(s): {', '.join(users[:10])}")
        if not hits:
            print("no source matches")
        return 0

    if a.warnings:
        t = a.warnings.lower()
        rank = {"demonstrated": 0, "on-a-tested-record": 1, "sourced": 2, "unsourced": 3}
        hits = [e for e in W.get("entries", [])
                if t in e["text"].lower() or t in e["concept"].lower()]
        hits.sort(key=lambda e: rank.get(e.get("evidence_tier"), 9))
        print(f"{len(hits)} warning(s) matching {a.warnings!r}, best-evidenced first\n")
        for e in hits[:a.limit]:
            print(f"[{e.get('evidence_tier','?'):<18}] {e['concept']} ({e['kind']})\n      {e['text']}")
        return 0

    if a.disputed:
        for c in C.values():
            h = c.get("history") or {}
            if h.get("confidence") == "disputed" or h.get("competing_claims"):
                print(f"\n{c['id']}  ({h.get('confidence')})")
                for cc in h.get("competing_claims", []):
                    print(f"  · {cc.get('claim')}   [{cc.get('source')}]")
                    if cc.get("note"):
                        print(f"      {cc['note']}")
        return 0

    pool = list(C.values())
    if a.category:
        pool = [c for c in pool if a.category.lower() in c["category"].lower()]
    if a.ktype:
        pool = [c for c in pool if a.ktype.lower() in c["knowledge_type"].lower()]
    if a.evidence:
        pool = [c for c in pool if evidence_of(c) == a.evidence]
    if a.untested:
        pool = [c for c in pool if evidence_of(c) == "sources-only"]

    if a.term:
        scored = [(score(c, a.term), c) for c in pool]
        scored = sorted([x for x in scored if x[0] > 0], key=lambda x: -x[0])
        pool = [c for _, c in scored]

    if not pool:
        print("nothing matches")
        return 1
    if a.full:
        print(full(pool[0]))
        if len(pool) > 1:
            print("\n(also matched: " + ", ".join(c["id"] for c in pool[1:6]) + ")")
        return 0
    print(f"{len(pool)} match(es)\n")
    for c in pool[:a.limit]:
        print(brief(c))
    if len(pool) > a.limit:
        print(f"\n... and {len(pool) - a.limit} more")
    return 0


if __name__ == "__main__":
    sys.exit(main())
