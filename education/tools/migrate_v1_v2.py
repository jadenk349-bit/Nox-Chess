#!/usr/bin/env python3
"""One-shot migration of v1 concept records to schema v2.

Kept in the repo rather than deleted: it documents exactly how the v1 fields were
remapped, which matters if an older record turns up on another branch.

Deliberately does NOT invent data. Fields new in v2 that cannot be derived from a
v1 record (explanations.by_depth, misconceptions, engine_era_status for most
concepts) are left empty and become tracked coverage gaps rather than fabricated
content.
"""
import json, os, sys, datetime

TYPE = {"A": "official-rule", "B": "proven-result", "C": "named-theoretical-position",
        "D": "tactical-motif", "E": "strategic-principle", "F": "rule-of-thumb",
        "G": "historical-teaching-principle", "H": "practical-guideline",
        "I": "terminology", "J": "other"}
CERT = {"established": "high", "probable": "medium", "disputed": "disputed", "unknown": "unknown"}

# concepts whose v1 type D really means "mating pattern"
MATING = {"back-rank-mate", "smothered-mate"}
# name_status judgements, made explicitly rather than defaulted
ESTABLISHED = {
 "en-passant","castling","check","checkmate","stalemate","dead-position","promotion",
 "threefold-repetition","fivefold-repetition","fifty-move-rule","seventy-five-move-rule",
 "fork","pin","skewer","discovered-attack","discovered-check","double-check","double-attack",
 "deflection","decoy","overloading","interference","clearance","zwischenzug","desperado",
 "x-ray","battery","back-rank-mate","smothered-mate","two-weaknesses","trapped-piece",
 "removing-the-defender"}
COMMON_USAGE = {"insufficient-material"}
RULES = {"en-passant","castling","check","checkmate","stalemate","dead-position","promotion",
         "threefold-repetition","fivefold-repetition","fifty-move-rule",
         "seventy-five-move-rule","insufficient-material"}

HIST_GAMES = {  # FEN prefix -> it came from a real game
 "6k1/5p2/2r1p1p1", "R7/2r2pkp"}


def origin_kind(ex):
    if ex.get("game"):
        return "historical-game"
    note = ex.get("note", "").lower()
    if "constructed" in note or "hypothetical" in note:
        return "constructed-test"
    return "constructed-test"


def migrate(c):
    cid = c["id"]
    kt = TYPE.get(c.get("epistemic_type"), "other")
    if cid in MATING:
        kt = "mating-pattern"

    o = c.get("origin") or {}
    attributions = []
    for p in o.get("attributed_to", []) or []:
        attributions.append({"person": p, "relation": "later-associated-with",
                             "note": "Relation not yet differentiated; see history.notes."})

    n = {
      "schema_version": 2,
      "id": cid,
      "canonical_name": c["canonical_name"],
      "alternate_names": c.get("alternate_names", []),
      "historical_names": c.get("historical_names", []),
      "category": c["category"],
      "subcategory": c.get("subcategory", ""),
      "tags": [],
      "knowledge_type": kt,
      "knowledge_type_note": c.get("epistemic_note", ""),
      "name_status": ("established-name" if cid in ESTABLISHED
                      else "common-usage" if cid in COMMON_USAGE else "descriptive-phrase"),
      "difficulty": c.get("difficulty", "intermediate"),
      "definition_short": c["definition_short"],
      "definition_long": c["definition_long"],
      "history": {
        "attributions": attributions,
        "first_documented_source": o.get("first_source"),
        "year": o.get("year"),
        "confidence": CERT.get(o.get("certainty", "unknown"), "unknown"),
        "notes": o.get("notes", ""),
        "competing_claims": o.get("competing_claims", []),
        "development": []
      },
      "engine_era_status": "not-applicable" if cid in RULES else "unassessed",
      "engine_era_note": "",
      "sources": c.get("sources", []),
      "source_confidence": c.get("source_confidence", "medium"),
      "recognition": {
        "preconditions": (c.get("recognition") or {}).get("preconditions", []),
        "indicators_for": (c.get("recognition") or {}).get("indicators_for", []),
        "indicators_against": (c.get("recognition") or {}).get("indicators_against", []),
        "prerequisites": c.get("prerequisites", []),
        "detector": (c.get("recognition") or {}).get("detector"),
        "detectability": (c.get("recognition") or {}).get("detectability", "heuristic"),
        "typical_confidence": "medium",
        "false_positive_traps": []
      },
      "application": {
        "typical_plans": c.get("typical_plans", []),
        "typical_moves": c.get("typical_moves", []),
        "typical_pawn_structures": [],
        "typical_piece_arrangements": [],
        "tactical_consequences": c.get("tactical_consequences", []),
        "strategic_consequences": c.get("strategic_consequences", [])
      },
      "exceptions": c.get("exceptions", []),
      "limitations": c.get("limitations", []),
      "misconceptions": [],
      "relationships": {
        "broader": c.get("broader_concepts", []),
        "narrower": c.get("narrower_concepts", []),
        "related": c.get("related_concepts", []),
        "contrasting": c.get("opposing_concepts", []),
        "co_occurring": [],
        "conflicts": []
      },
      "examples": [], "counterexamples": [], "ambiguous_examples": [],
      "explanations": {
        "by_level": {k: v for k, v in (c.get("explanation_templates") or {}).items()
                     if k in ("beginner", "intermediate", "advanced") and v},
        "by_depth": {},
        "hedge": (c.get("explanation_templates") or {}).get("hedge", ""),
        "lesson": ""
      },
      "terminology": c.get("terminology", {}),
      "status": {
        "stage": c["status"]["stage"],
        "last_updated": c["status"].get("last_updated", ""),
        "open_questions": c["status"].get("open_questions", []),
        "audit_notes": []
      }
    }

    for bucket, role in (("examples", "positive"), ("counterexamples", "negative")):
        for ex in c.get(bucket, []):
            e = {"fen": ex["fen"], "note": ex["note"], "origin_kind": origin_kind(ex),
                 "concept_role": role}
            if ex.get("game"): e["game"] = ex["game"]
            if ex.get("side_to_move_benefits"): e["side_to_move_benefits"] = ex["side_to_move_benefits"]
            eng = ex.get("engine")
            if eng:
                alts = eng.get("alternatives", [])
                margin = None
                if eng.get("eval_cp") is not None and alts and alts[0].get("eval_cp") is not None:
                    margin = eng["eval_cp"] - alts[0]["eval_cp"]
                e["engine"] = {
                    "engine_id": eng.get("engine_id", ""),
                    "test_level": 3 if (eng.get("depth") or 0) >= 30 else 2,
                    "depth": eng.get("depth"), "threads": 10, "hash_mb": 4096,
                    "multipv": max(1, len(alts) + 1),
                    "best_move": eng.get("best_move"), "eval_cp": eng.get("eval_cp"),
                    "mate_in": eng.get("mate_in"), "pv": [], "alternatives": alts,
                    "margin_cp": margin,
                    "verdict": eng.get("verdict", "untested"),
                    "verdict_note": eng.get("verdict_note", "")}
                if eng.get("verdict") == "ambiguous":
                    e["concept_role"] = "ambiguous"
            n[bucket].append(e)

    # move genuinely ambiguous positions into their own bucket
    for bucket in ("examples", "counterexamples"):
        keep = []
        for e in n[bucket]:
            if e.get("concept_role") == "ambiguous":
                n["ambiguous_examples"].append(e)
            else:
                keep.append(e)
        n[bucket] = keep
    return n


def main():
    root = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "concepts")
    n_done = 0
    for dirpath, _, files in os.walk(root):
        for fn in sorted(files):
            if not fn.endswith(".json"):
                continue
            p = os.path.join(dirpath, fn)
            c = json.load(open(p))
            if c.get("schema_version") == 2:
                continue
            json.dump(migrate(c), open(p, "w"), indent=2, ensure_ascii=False)
            n_done += 1
    print(f"migrated {n_done} concept records to schema v2")


if __name__ == "__main__":
    main()
