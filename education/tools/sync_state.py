#!/usr/bin/env python3
"""Recompute state/research-state.json counters and seed state/coverage.json rows.

Derives everything it can from the concept files themselves, so the trackers
cannot drift from the knowledge base. Coverage boxes it cannot infer are left
alone if already set, and seeded false if the row is new.

    python3 tools/sync_state.py
"""
import datetime, json, os

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BOXES = ["researched_definition", "verified_terminology", "multiple_sources",
         "examples", "counterexamples", "recognition_criteria",
         "engine_validation", "tested_positive", "tested_negative",
         "tested_ambiguous", "explanation_template"]


def load(p):
    with open(os.path.join(HERE, p)) as f:
        return json.load(f)


def save(p, d):
    with open(os.path.join(HERE, p), "w") as f:
        json.dump(d, f, indent=2, ensure_ascii=False)


def main():
    today = datetime.date.today().isoformat()
    concepts = {}
    for dirpath, _, files in os.walk(os.path.join(HERE, "concepts")):
        for fn in files:
            if fn.endswith(".json"):
                with open(os.path.join(dirpath, fn)) as f:
                    c = json.load(f)
                concepts[c["id"]] = c

    cov = load("state/coverage.json")
    state = load("state/research-state.json")

    positions = matches = false_matches = ambiguous = 0

    for cid, c in concepts.items():
        ex, cex = c.get("examples", []), c.get("counterexamples", [])
        engines = [p.get("engine") for p in ex + cex if p.get("engine")]
        positions += len(engines)
        for e in engines:
            v = e.get("verdict")
            matches += v == "supports"
            false_matches += v == "contradicts"
            ambiguous += v == "ambiguous"

        rec = c.get("recognition") or {}
        row = cov["concepts"].get(cid, {"boxes": {b: False for b in BOXES},
                                        "engine_testable": True,
                                        "engine_testable_note": ""})
        row.setdefault("boxes", {b: False for b in BOXES})
        b = row["boxes"]
        # inferable from the record itself
        b["researched_definition"] = bool(c.get("definition_long"))
        b["multiple_sources"] = len(c.get("sources", [])) >= 2
        b["examples"] = len(ex) > 0
        b["counterexamples"] = len(cex) > 0
        b["recognition_criteria"] = bool(rec.get("indicators_for")) and bool(rec.get("indicators_against"))
        b["explanation_template"] = bool((c.get("explanation_templates") or {}).get("intermediate"))
        b["engine_validation"] = len(engines) > 0
        b["tested_positive"] = any(e.get("verdict") == "supports" for e in engines)
        b["tested_negative"] = any(
            (p.get("engine") or {}).get("verdict") in ("supports", "contradicts") for p in cex)
        b["tested_ambiguous"] = any(e.get("verdict") == "ambiguous" for e in engines)
        b.setdefault("verified_terminology", False)
        row["stage"] = (c.get("status") or {}).get("stage")
        row["category"] = c.get("category")
        cov["concepts"][cid] = row

        area = state["areas"].get(c.get("category"))
        if area is not None and cid not in area["concepts"]:
            area["concepts"].append(cid)
            area["last_touched"] = today

    stages = [(c.get("status") or {}).get("stage") for c in concepts.values()]
    state["counters"].update({
        "concepts_total": len(concepts),
        "concepts_stub": stages.count("stub"),
        "concepts_researched": stages.count("researched"),
        "concepts_validated": stages.count("validated"),
        "concepts_needs_review": stages.count("needs-review"),
        "sources_reviewed": len(load("sources/sources.json")["sources"]),
        "positions_tested": positions,
        "matches_validated": matches,
        "false_matches": false_matches,
        "ambiguous_matches": ambiguous,
    })
    state["last_session"] = today
    state["engine"]["id"] = state["engine"]["id"] or "Stockfish 18"

    save("state/coverage.json", cov)
    save("state/research-state.json", state)

    done = sum(1 for r in cov["concepts"].values()
               if all(r["boxes"][k] for k in BOXES if r.get("engine_testable", True)
                      or not k.startswith("tested") and k != "engine_validation"))
    print(f"concepts {len(concepts)}  positions {positions}  "
          f"supports {matches}  contradicts {false_matches}  ambiguous {ambiguous}")
    print(f"coverage rows: {len(cov['concepts'])}  fully-boxed: {done}")


if __name__ == "__main__":
    main()
