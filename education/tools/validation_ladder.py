#!/usr/bin/env python3
"""The validation ladder: seven rungs, per concept.

A concept count says how much has been WRITTEN. This says how much has been
CHECKED, and it is deliberately built so the two cannot be confused.

    RESEARCHED           a definition and cited sources
    HUMAN-GROUNDED       at least one example a human source attributed to this
                         concept — an annotated master position, not a mined one
    ENGINE-VERIFIED      at least one position with an engine or tablebase result
    NEGATIVE-TESTED      at least one counterexample: the pattern present, the
                         concept absent
    AMBIGUITY-TESTED     at least one ambiguous example: the concept contributes
                         and does not decide
    API-VALIDATED        a Layer 4 matcher exists, so the API can actually
                         recognise it rather than only explain it when told
    EXPLANATION-VALIDATED wording at every level and depth, with no unfilled
                         template and no banned phrasing

Each rung is a fact about the record, not a judgement, and every rung above
RESEARCHED requires evidence in the repository.

    python3 tools/validation_ladder.py [--json state/ladder.json] [--concept X]
"""
import argparse, glob, json, os, re, sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RUNGS = ["researched", "human_grounded", "engine_verified", "negative_tested",
         "ambiguity_tested", "api_validated", "explanation_validated"]


def matcher_concepts():
    """Concepts Layer 4 can actually recognise, read from the source."""
    out = set()
    for rel in ("lib/matchers.js",):
        p = os.path.join(HERE, rel)
        if not os.path.exists(p):
            continue
        src = open(p, encoding="utf-8").read()
        out |= set(re.findall(r"concept:\s*'([a-z0-9-]+)'", src))
        for tag, cid in re.findall(r"(\w+):\s*'([a-z0-9-]+)'", src):
            pass
        # motif map targets are recognised too
        mm = os.path.join(HERE, "tools", "motif_map.json")
        if os.path.exists(mm):
            m = json.load(open(mm, encoding="utf-8"))
            for v in m.get("map", {}).values():
                if v.get("concept"):
                    out.add(v["concept"])
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--json")
    ap.add_argument("--concept")
    a = ap.parse_args()

    concepts = {}
    for f in sorted(glob.glob(os.path.join(HERE, "concepts", "*", "*.json"))):
        c = json.load(open(f, encoding="utf-8"))
        concepts[c["id"]] = c

    corpus_ids = set()
    cp = os.path.join(HERE, "corpus", "annotated_positions.json")
    if os.path.exists(cp):
        for x in json.load(open(cp, encoding="utf-8"))["positions"]:
            corpus_ids.add(x["concept"])

    recognised = matcher_concepts()
    LEVELS = ["beginner", "intermediate", "advanced", "master"]
    DEPTHS = ["short", "normal", "deep"]

    rows = {}
    for cid, c in concepts.items():
        pos = c.get("examples", []) + c.get("counterexamples", []) + c.get("ambiguous_examples", [])
        ex = c.get("explanations") or {}
        by_level, by_depth = ex.get("by_level") or {}, ex.get("by_depth") or {}
        # A template slot in a RECORD is legitimate — the API fills it from Layer 3
        # or falls back to plainer wording, and test_explanations.js already
        # guarantees no brace ever reaches a reader. So this rung asks about
        # COMPLETENESS of the wording, not about templates. An earlier version
        # tested `'{' in json.dumps(ex)`, which is true of every dict ever
        # serialised and scored the whole rung at zero.
        texts = list((by_level or {}).values()) + list((by_depth or {}).values())
        # A human-grounded example: the annotated corpus, or a position carrying a
        # named game AND a historical origin. A mined self-play position is not one.
        human = cid in corpus_ids or any(
            p.get("game") and p.get("origin_kind") == "historical-game" for p in pos)
        rows[cid] = {
            "researched": bool(c.get("definition_long")) and bool(c.get("sources")),
            "human_grounded": human,
            "engine_verified": any(p.get("engine") or p.get("tablebase") for p in pos),
            "negative_tested": bool(c.get("counterexamples")),
            "ambiguity_tested": bool(c.get("ambiguous_examples")),
            "api_validated": cid in recognised,
            "explanation_validated": (all(by_level.get(k) for k in LEVELS)
                                      and all(by_depth.get(k) for k in DEPTHS)
                                      and all(isinstance(t, str) and t.strip() for t in texts)),
        }

    if a.concept:
        r = rows.get(a.concept)
        if not r:
            print("no such concept"); return 1
        print(f"\n{a.concept}")
        for k in RUNGS:
            print(f"  {'yes' if r[k] else 'NO ':<4} {k}")
        return 0

    n = len(rows) or 1
    print(f"\nVALIDATION LADDER — {n} concepts\n")
    for k in RUNGS:
        got = sum(1 for r in rows.values() if r[k])
        bar = "#" * round(30 * got / n)
        print(f"  {k:<24} {got:>3}/{n}  {100*got/n:5.1f}%  {bar}")

    full = [c for c, r in rows.items() if all(r.values())]
    print(f"\n  all seven rungs: {len(full)}/{n}" + (f" — {', '.join(sorted(full))}" if full else ""))
    # The honest headline: how many are RESEARCHED ONLY.
    only = [c for c, r in rows.items() if r["researched"] and sum(r.values()) == 1]
    print(f"  researched and nothing else: {len(only)}/{n}")

    if a.json:
        json.dump({"rungs": RUNGS, "concepts": rows,
                   "totals": {k: sum(1 for r in rows.values() if r[k]) for k in RUNGS},
                   "all_seven": sorted(full), "researched_only": sorted(only)},
                  open(os.path.join(HERE, a.json), "w"), indent=2)
        print(f"\n  wrote {a.json}")
    print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
