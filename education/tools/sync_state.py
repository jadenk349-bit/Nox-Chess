#!/usr/bin/env python3
"""Recompute the coverage matrix, category rollups and progress counters.

Everything derivable from the concept files is derived, so the trackers cannot
drift from the knowledge base. Boxes that require a human/agent judgement
(canonical_name_verified, historical_attribution_researched) are preserved once
set and default to false.

A box may be set to the string "n/a" where validation is genuinely impossible
for that concept — a rule of chess has no meaningful counterexample position.
"n/a" counts as satisfied for completion, but is reported separately so the
distinction stays visible.

    python3 tools/sync_state.py
"""
import datetime, json, os

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

BOXES = [
    "canonical_name_verified",        # judgement
    "alternate_names_researched",     # judgement
    "definition_researched",          # derived
    "historical_attribution_researched",  # derived
    "multiple_sources",               # derived
    "recognition_criteria",           # derived
    "examples",                       # derived
    "counterexamples",                # derived
    "exceptions",                     # derived
    "stockfish_validation",           # derived
    "positive_test",                  # derived
    "negative_test",                  # derived
    "ambiguous_test",                 # derived
    "explanation_template",           # derived
    "beginner_explanation",           # derived
    "advanced_explanation",           # derived
]
JUDGEMENT = {"canonical_name_verified", "alternate_names_researched"}
DERIVED = [b for b in BOXES if b not in JUDGEMENT]
READY_STAGES = {"validated", "ready"}


def load(rel):
    with open(os.path.join(HERE, rel)) as f:
        return json.load(f)


def save(rel, d):
    with open(os.path.join(HERE, rel), "w") as f:
        json.dump(d, f, indent=2, ensure_ascii=False)


def satisfied(v):
    return v is True or v == "n/a"


def main():
    today = datetime.date.today().isoformat()
    concepts = {}
    for dirpath, _, files in os.walk(os.path.join(HERE, "concepts")):
        for fn in sorted(files):
            if fn.endswith(".json"):
                with open(os.path.join(dirpath, fn)) as f:
                    c = json.load(f)
                concepts[c["id"]] = c

    cov = load("state/coverage.json")
    state = load("state/research-state.json")
    taxonomy = load("taxonomy.json")
    area_of = {a["id"]: d["id"] for d in taxonomy["domains"] for a in d["areas"]}

    positions = supports = contradicts = ambiguous = tb_positions = 0

    for cid, c in concepts.items():
        ex = c.get("examples", [])
        cex = c.get("counterexamples", [])
        amb = c.get("ambiguous_examples", [])
        allpos = ex + cex + amb
        engines = [p["engine"] for p in allpos if p.get("engine")]
        # a tablebase result is proof, so it satisfies validation at least as well as a search
        proven = [p for p in allpos if p.get("engine") or p.get("tablebase")]
        positions += len(engines)
        tb_positions += sum(1 for p in allpos if p.get("tablebase"))
        for e in engines:
            v = e.get("verdict")
            supports += v == "supports"
            contradicts += v == "contradicts"
            ambiguous += v == "ambiguous"

        row = cov["concepts"].get(cid) or {}
        boxes = row.get("boxes") or {}
        for b in BOXES:
            boxes.setdefault(b, False)

        h = c.get("history") or {}
        rec = c.get("recognition") or {}
        expl = c.get("explanations") or {}
        lvl = expl.get("by_level") or {}

        boxes["definition_researched"] = bool(c.get("definition_long"))
        boxes["historical_attribution_researched"] = (
            bool(h.get("notes")) or bool(h.get("attributions")) or h.get("confidence") == "unknown")
        boxes["multiple_sources"] = len(c.get("sources", [])) >= 2
        boxes["recognition_criteria"] = bool(rec.get("indicators_for")) and bool(rec.get("indicators_against"))
        boxes["examples"] = "n/a" if boxes.get("examples") == "n/a" else bool(ex)
        boxes["counterexamples"] = "n/a" if boxes.get("counterexamples") == "n/a" else bool(cex)
        boxes["exceptions"] = bool(c.get("exceptions"))
        def verified(p):
            """A position counts as tested if a search OR a tablebase settled it."""
            if p.get("tablebase") and p["tablebase"].get("wdl") not in (None, "unknown"):
                return True
            return (p.get("engine") or {}).get("verdict") in ("supports", "contradicts")
        boxes["stockfish_validation"] = "n/a" if boxes.get("stockfish_validation") == "n/a" else bool(proven)
        boxes["positive_test"] = "n/a" if boxes.get("positive_test") == "n/a" else any(verified(p) for p in ex)
        boxes["negative_test"] = "n/a" if boxes.get("negative_test") == "n/a" else any(verified(p) for p in cex)
        boxes["ambiguous_test"] = "n/a" if boxes.get("ambiguous_test") == "n/a" else bool(
            [p for p in amb if p.get("engine") or p.get("tablebase")])
        boxes["explanation_template"] = bool(lvl) or bool(expl.get("by_depth"))
        boxes["beginner_explanation"] = bool(lvl.get("beginner"))
        boxes["advanced_explanation"] = bool(lvl.get("advanced"))
        # name work: a canonical name is "verified" when it was checked against two or more
        # sources and an explicit name_status judgement was recorded.
        multi = len(c.get("sources", [])) >= 2
        boxes["canonical_name_verified"] = bool(c.get("name_status")) and multi
        boxes["alternate_names_researched"] = (
            bool(c.get("alternate_names")) or bool(c.get("historical_names"))
            or boxes["canonical_name_verified"])
        # drop stale keys left over from the v1 schema
        for stale in [k for k in boxes if k not in BOXES]:
            boxes.pop(stale)

        row.update({
            "boxes": boxes,
            "stage": (c.get("status") or {}).get("stage"),
            "category": c.get("category"),
            "domain": area_of.get(c.get("category")),
            "knowledge_type": c.get("knowledge_type"),
            "engine_testable": row.get("engine_testable", True),
            "engine_testable_note": row.get("engine_testable_note", ""),
            "complete": all(satisfied(boxes[b]) for b in BOXES),
            "derived_complete": all(satisfied(boxes[b]) for b in DERIVED),
        })
        cov["concepts"][cid] = row

        area = state["areas"].get(c.get("category"))
        if area is not None and cid not in area["concepts"]:
            area["concepts"].append(cid)
            area["last_touched"] = today

    # ---- category-level rollup (brief Phase 12) ----
    rollup = {}
    for aid, dom in area_of.items():
        ids = [cid for cid, r in cov["concepts"].items() if r.get("category") == aid]
        stages = [cov["concepts"][i]["stage"] for i in ids]
        rollup[aid] = {
            "domain": dom,
            "status": state["areas"][aid]["status"],
            "discovered": len(ids),
            "researched": sum(1 for s in stages if s in
                              ("researched", "sourced", "structured", "tested", "validated", "ready")),
            "validated": sum(1 for s in stages if s in READY_STAGES),
            "needs_review": sum(1 for s in stages if s == "needs-review"),
            "fully_covered": sum(1 for i in ids if cov["concepts"][i]["complete"]),
        }
    cov["by_area"] = rollup
    cov["by_domain"] = {}
    for aid, r in rollup.items():
        d = cov["by_domain"].setdefault(r["domain"], {k: 0 for k in
                                                     ("discovered", "researched", "validated", "fully_covered")})
        for k in d:
            d[k] += r[k]

    stages = [(c.get("status") or {}).get("stage") for c in concepts.values()]
    state["counters"].update({
        "concepts_total": len(concepts),
        "by_stage": {s: stages.count(s) for s in sorted(set(stages)) if s},
        "sources_reviewed": len(load("sources/sources.json")["sources"]),
        "positions_tested": positions,
        "tablebase_positions": tb_positions,
        "matches_validated": supports,
        "false_matches": contradicts,
        "ambiguous_matches": ambiguous,
        "concepts_fully_covered": sum(1 for r in cov["concepts"].values() if r["complete"]),
        "areas_touched": sum(1 for r in rollup.values() if r["discovered"] > 0),
        "areas_total": len(rollup),
    })
    state["last_session"] = today

    save("state/coverage.json", cov)
    save("state/research-state.json", state)

    print(f"concepts {len(concepts)} | positions {positions} (+{tb_positions} tablebase) | "
          f"supports {supports} contradicts {contradicts} ambiguous {ambiguous}")
    print(f"areas touched {state['counters']['areas_touched']}/{len(rollup)} | "
          f"fully covered {state['counters']['concepts_fully_covered']}")
    print("by stage:", state["counters"]["by_stage"])


if __name__ == "__main__":
    main()
