#!/usr/bin/env python3
"""Depth audit: what each concept actually HAS, not merely that it exists.

Breadth is easy to measure and easy to fake. This scores every concept against
the fifteen things a genuinely finished record should carry, marks N/A honestly
where a test cannot apply, and rolls the result up to a depth rating per
taxonomy area.

An area is not "covered" because one concept sits in it. The ratings are:

    full          >= 3 concepts, mean completeness >= 0.75, no concept < 0.5
    substantial   >= 2 concepts, mean >= 0.60
    partial       >= 1 concept,  mean >= 0.45
    weak          anything else that has a concept
    empty         no concepts

    python3 tools/depth_report.py             # summary + weakest areas
    python3 tools/depth_report.py --areas     # every area
    python3 tools/depth_report.py --concepts  # every concept's checklist
    python3 tools/depth_report.py --json state/depth.json
"""
import argparse, glob, json, os, sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Types where an exception is not a meaningful demand: a rule of chess has no
# exceptions and a proven result has none either.
NO_EXCEPTIONS_NEEDED = {"official-rule", "proven-result", "tablebase-fact"}
# A rule of chess is not illustrated by a master game, is not ambiguous, and does
# not need an engine to confirm it. Demanding those of en-passant and the
# fifty-move rule measured nothing except how many rules the base contains.
# Terminology records are the same: "notation" has no instructive game.
# NOTE: this exclusion was added AFTER the first depth run, which reported
# master_game missing on 128 of 129 concepts. The honest comparison is that the
# earlier figure counted 30-odd records that could never have had one.
NOT_ILLUSTRATED_BY_GAMES = {"official-rule", "proven-result", "tablebase-fact", "terminology"}
# Types that describe vocabulary or meta-practice rather than board situations,
# so board-level tests do not apply to them.
NON_BOARD = {"terminology"}
ENDGAME_HINT = ("endgame", "tablebase", "opposition", "zugzwang", "pawn-ending")


def load():
    out = {}
    for f in sorted(glob.glob(os.path.join(HERE, "concepts", "*", "*.json"))):
        c = json.load(open(f, encoding="utf-8"))
        c["_path"] = os.path.relpath(f, HERE)
        out[c["id"]] = c
    return out


def positions(c):
    return c.get("examples", []) + c.get("counterexamples", []) + c.get("ambiguous_examples", [])


def is_endgame_concept(c):
    blob = (c.get("category", "") + " " + " ".join(c.get("tags", []))).lower()
    if any(h in blob for h in ENDGAME_HINT):
        return True
    return any(p.get("tablebase") for p in positions(c))


def board_level(c):
    """Can this concept meaningfully carry board evidence at all?"""
    if c.get("knowledge_type") in NON_BOARD:
        # A few terminology records are still about the board (check, promotion).
        return (c.get("recognition") or {}).get("detectability") == "mechanical"
    if c.get("recognition", {}).get("detectability") == "not-applicable":
        return False
    # Meta records about the base itself are not board concepts.
    return "meta" not in (c.get("subcategory") or "").lower()


def checklist(c, fp_concepts):
    """Each entry is True (has it), False (missing), or None (N/A)."""
    kt = c.get("knowledge_type")
    ex = c.get("explanations") or {}
    rec = c.get("recognition") or {}
    hist = c.get("history") or {}
    pos = positions(c)
    board = board_level(c)

    src = c.get("sources") or []
    return {
        "definition": len(c.get("definition_long") or "") > 400,
        "terminology": bool(c.get("name_status")) and c.get("name_status") != "unknown",
        "provenance": len(src) >= 2 or (len(src) == 1 and c.get("source_confidence") == "high"),
        "attribution": (None if hist.get("confidence") in (None, "unknown") and not hist.get("attributions")
                        else bool(hist.get("attributions")) or hist.get("confidence") in ("disputed", "low", "medium", "high")),
        "recognition": bool(rec.get("preconditions") or rec.get("indicators_for")),
        "exceptions": (None if c.get("knowledge_type") in NO_EXCEPTIONS_NEEDED
                       else bool(c.get("exceptions"))),
        "positive_example": (bool(c.get("examples")) if board else None),
        "negative_example": (bool(c.get("counterexamples")) if board else None),
        "ambiguous_example": (bool(c.get("ambiguous_examples"))
                              if board and kt not in NOT_ILLUSTRATED_BY_GAMES else None),
        "engine_validation": (any(p.get("engine") for p in pos)
                              if board and kt != "official-rule" else None),
        "tablebase_validation": (any(p.get("tablebase") for p in pos)
                                 if board and is_endgame_concept(c) else None),
        "master_game": (any(p.get("origin_kind") == "historical-game" for p in pos)
                        if board and kt not in NOT_ILLUSTRATED_BY_GAMES else None),
        "false_positive_test": bool(rec.get("false_positive_traps")) and c["id"] in fp_concepts
                               if board else bool(rec.get("false_positive_traps")),
        "beginner_explanation": bool((ex.get("by_level") or {}).get("beginner")),
        "advanced_explanation": bool((ex.get("by_level") or {}).get("advanced")),
        "explanation_template": bool(ex.get("by_depth")),
    }


def completeness(cl):
    vals = [v for v in cl.values() if v is not None]
    return sum(1 for v in vals if v) / len(vals) if vals else 0.0


def rate(concepts_in_area):
    if not concepts_in_area:
        return "empty", 0.0
    scores = [completeness(c["_check"]) for c in concepts_in_area]
    mean = sum(scores) / len(scores)
    n = len(concepts_in_area)
    if n >= 3 and mean >= 0.75 and min(scores) >= 0.5:
        return "full", mean
    if n >= 2 and mean >= 0.60:
        return "substantial", mean
    if mean >= 0.45:
        return "partial", mean
    return "weak", mean


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--areas", action="store_true")
    ap.add_argument("--concepts", action="store_true")
    ap.add_argument("--json")
    ap.add_argument("--markdown", help="write a readable coverage report")
    ap.add_argument("--area", help="detail for one area")
    a = ap.parse_args()

    C = load()
    tax = json.load(open(os.path.join(HERE, "taxonomy.json"), encoding="utf-8"))
    area_domain = {ar["id"]: d["id"] for d in tax["domains"] for ar in d["areas"]}

    fp = json.load(open(os.path.join(HERE, "tests", "false_positive_cases.json"), encoding="utf-8"))
    fp_concepts = {c.get("concept") for c in fp["cases"]}

    for c in C.values():
        c["_check"] = checklist(c, fp_concepts)
        c["_score"] = completeness(c["_check"])

    by_area = {aid: [] for aid in area_domain}
    for c in C.values():
        by_area.setdefault(c["category"], []).append(c)

    ratings = {}
    for aid in area_domain:
        r, m = rate(by_area.get(aid, []))
        ratings[aid] = {"rating": r, "mean_completeness": round(m, 3),
                        "concepts": sorted(x["id"] for x in by_area.get(aid, [])),
                        "domain": area_domain[aid]}

    order = ["full", "substantial", "partial", "weak", "empty"]
    tally = {}
    for v in ratings.values():
        tally[v["rating"]] = tally.get(v["rating"], 0) + 1

    if a.json:
        gaps = {k: sum(1 for c in C.values() if c["_check"].get(k) is False)
                for k in next(iter(C.values()))["_check"]}
        json.dump({"areas": ratings, "tally": tally,
                   "concepts": {k: {"score": round(v["_score"], 3), "check": v["_check"]}
                                for k, v in C.items()},
                   "missing_by_item": gaps},
                  open(os.path.join(HERE, a.json), "w"), indent=2)
        print(f"wrote {a.json}")

    if a.markdown:
        keys = list(next(iter(C.values()))["_check"])
        SHORT = {"definition": "def", "terminology": "term", "provenance": "src",
                 "attribution": "attr", "recognition": "recog", "exceptions": "exc",
                 "positive_example": "pos", "negative_example": "neg",
                 "ambiguous_example": "amb", "engine_validation": "eng",
                 "tablebase_validation": "tb", "master_game": "game",
                 "false_positive_test": "fp", "beginner_explanation": "beg",
                 "advanced_explanation": "adv", "explanation_template": "tmpl"}
        L = ["# Concept coverage report", "",
             "GENERATED by `tools/depth_report.py --markdown`. Do not edit by hand.", "",
             "`x` has it · `-` missing · `.` not applicable to this concept", "",
             "Columns: " + ", ".join(f"**{SHORT[k]}** {k.replace('_',' ')}" for k in keys), "",
             f"Mean completeness **{sum(c['_score'] for c in C.values())/len(C):.2f}** "
             f"across {len(C)} concepts.", ""]
        for k in order:
            if tally.get(k):
                L.append(f"- **{k}**: {tally[k]} areas")
        L += ["", "## Areas", "",
              "| rating | mean | area | concepts |", "|---|---|---|---|"]
        for aid, v in sorted(ratings.items(),
                             key=lambda x: (order.index(x[1]["rating"]), -x[1]["mean_completeness"])):
            L.append(f"| {v['rating']} | {v['mean_completeness']:.2f} | `{aid}` | {len(v['concepts'])} |")
        L += ["", "## Concepts", "",
              "| concept | score | " + " | ".join(SHORT[k] for k in keys) + " |",
              "|---|---|" + "---|" * len(keys)]
        for cid, c in sorted(C.items(), key=lambda x: -x[1]["_score"]):
            cells = "".join(
                f" {'x' if c['_check'][k] else ('.' if c['_check'][k] is None else '-')} |"
                for k in keys)
            L.append(f"| `{cid}` | {c['_score']:.2f} |" + cells)
        open(os.path.join(HERE, a.markdown), "w").write("\n".join(L) + "\n")
        print(f"wrote {a.markdown}")

    print(f"\nDEPTH REPORT — {len(C)} concepts across {len(ratings)} areas\n")
    for k in order:
        if tally.get(k):
            print(f"  {k:<13} {tally[k]:>3} areas")
    mean_all = sum(c["_score"] for c in C.values()) / len(C)
    print(f"\n  mean concept completeness  {mean_all:.2f}")

    print("\nMISSING MOST OFTEN (of concepts where the item applies)")
    keys = list(next(iter(C.values()))["_check"])
    rows = []
    for k in keys:
        applicable = [c for c in C.values() if c["_check"][k] is not None]
        missing = [c for c in applicable if not c["_check"][k]]
        if applicable:
            rows.append((len(missing), len(applicable), k))
    for miss, app, k in sorted(rows, reverse=True)[:16]:
        if miss:
            print(f"  {k:<24} {miss:>4} of {app:<4} ({100*miss/app:.0f}%)")

    if a.area:
        print(f"\n=== {a.area} ===")
        for c in sorted(by_area.get(a.area, []), key=lambda x: -x["_score"]):
            print(f"\n  {c['id']}  {c['_score']:.2f}")
            for k, v in c["_check"].items():
                print(f"     {'ok ' if v else ('n/a' if v is None else 'MISS')}  {k}")
        return 0

    if a.areas:
        print("\nEVERY AREA")
        for aid, v in sorted(ratings.items(), key=lambda x: (order.index(x[1]["rating"]), -x[1]["mean_completeness"])):
            print(f"  {v['rating']:<12} {v['mean_completeness']:.2f}  {aid:<28} "
                  f"n={len(v['concepts'])}  {v['domain']}")
    else:
        print("\nWEAKEST AREAS")
        weak = [(aid, v) for aid, v in ratings.items() if v["rating"] in ("weak", "partial", "empty")]
        for aid, v in sorted(weak, key=lambda x: x[1]["mean_completeness"]):
            print(f"  {v['rating']:<12} {v['mean_completeness']:.2f}  {aid:<28} n={len(v['concepts'])}")

    if a.concepts:
        print("\nWEAKEST CONCEPTS")
        for c in sorted(C.values(), key=lambda x: x["_score"])[:25]:
            miss = [k for k, v in c["_check"].items() if v is False]
            print(f"  {c['_score']:.2f}  {c['id']:<28} missing: {', '.join(miss[:6])}")
    print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
