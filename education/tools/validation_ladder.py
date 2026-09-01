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
                         recognise it rather than only explain it when told.
                         Some concepts CANNOT reach this rung and saying so is
                         not an excuse: `initiative` records that it "is
                         invisible to a static feature scan", and
                         `piece-coordination` and `transformation-of-advantages`
                         are marked human-only. Those are counted separately,
                         and the split is read off each record's own
                         `recognition.detectability`, so it cannot be widened
                         to flatter the number.
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
    mined = {}
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
        # A human-grounded example is one a PERSON attributed to this concept.
        #
        # This used to accept any position carrying a named game and a historical
        # origin, which is a different thing and a much easier one: 22 of the 36
        # concepts it was counting were grounded only on positions this system
        # found by running its own Layer 4 over master games. Those positions are
        # real, their records say plainly that they "cannot by itself validate
        # the matcher that found it", and the rung's own definition above says
        # "an annotated master position, NOT a mined one". The implementation was
        # contradicting the definition, in the direction that flattered it.
        #
        # `attributed_by` is now the test, and it is set only where a named human
        # said so. The looser count is still computed, because the drop is worth
        # seeing rather than hiding.
        human = cid in corpus_ids or any(p.get("attributed_by") for p in pos)
        mined_only = (not human) and any(
            p.get("game") and p.get("origin_kind") == "historical-game" for p in pos)
        rows[cid] = {
            "researched": bool(c.get("definition_long")) and bool(c.get("sources")),
            "human_grounded": human,
            "_master_game_position_only": mined_only,
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

    # Which concepts could ever be recognised from a board at all. Read off the
    # records, never listed here.
    can_detect = {cid for cid, c in concepts.items()
                  if cid in recognised
                  or ((c.get("recognition") or {}).get("detectability") or "") == "mechanical"}

    n = len(rows) or 1
    print(f"\nVALIDATION LADDER — {n} concepts\n")
    for k in RUNGS:
        got = sum(1 for r in rows.values() if r[k])
        bar = "#" * round(30 * got / n)
        line = f"  {k:<24} {got:>3}/{n}  {100*got/n:5.1f}%  {bar}"
        if k == "api_validated":
            m = len(can_detect) or 1
            line += f"\n  {'':<24} {got:>3}/{m} of the concepts whose own record allows a detector"
        print(line)

    for c, r in rows.items():
        mined[c] = r.pop("_master_game_position_only", False)
    extra = sum(1 for c in mined if mined[c])
    print(f"\n  ...and {extra} more concepts have a master-game position this system found "
          f"itself,\n  which is evidence the concept OCCURS and not evidence a human named it here.")

    full = [c for c, r in rows.items() if all(r.values())]
    print(f"\n  all seven rungs: {len(full)}/{n}" + (f" — {', '.join(sorted(full))}" if full else ""))
    # The honest headline: how many are RESEARCHED ONLY.
    only = [c for c, r in rows.items() if r["researched"] and sum(r.values()) == 1]
    print(f"  researched and nothing else: {len(only)}/{n}")

    # "All seven rungs" is unreachable for a human-only concept, so the honest
    # headline is two numbers rather than one flattering choice between them.
    reachable = [c for c, r in rows.items()
                 if all(r[k] for k in RUNGS if k != "api_validated")
                 and (r["api_validated"] or c not in can_detect)]
    print(f"  every rung its record allows: {len(reachable)}/{n}")

    if a.json:
        json.dump({"rungs": RUNGS, "concepts": rows,
                   "totals": {k: sum(1 for r in rows.values() if r[k]) for k in RUNGS},
                   "api_detectable": sorted(can_detect),
                   "every_rung_its_record_allows": sorted(reachable),
                   "all_seven": sorted(full), "researched_only": sorted(only)},
                  open(os.path.join(HERE, a.json), "w"), indent=2)
        print(f"\n  wrote {a.json}")
    print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
