#!/usr/bin/env python3
"""Periodic quality audit of the knowledge base (brief Phase 39).

validate_kb.py checks that records are well-formed. run_tests.py checks that they
are educationally sound. This looks for the things that are wrong but legal —
claims resting on weak sources, aliases that may be duplicate concepts, missing
exceptions on concepts that certainly have them, attributions stated more firmly
than their evidence, and concepts that have drifted out of proportion.

It reports; it does not fix. Every finding needs a human or agent judgement.

    python3 tools/audit.py
    python3 tools/audit.py --area pawn-structures
"""
import argparse, json, os, re
from collections import defaultdict

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FINDINGS = []


def load(rel):
    with open(os.path.join(HERE, rel)) as f:
        return json.load(f)


def concepts():
    out = {}
    for dp, _, fs in os.walk(os.path.join(HERE, "concepts")):
        for fn in sorted(fs):
            if fn.endswith(".json"):
                c = json.load(open(os.path.join(dp, fn)))
                out[c["id"]] = c
    return out


def finding(sev, cid, kind, msg):
    FINDINGS.append((sev, cid, kind, msg))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--area")
    a = ap.parse_args()

    C = concepts()
    SRC = load("sources/sources.json")["sources"]
    if a.area:
        C = {k: v for k, v in C.items() if v.get("category") == a.area}

    # ---- 1. source strength versus claimed confidence ----
    for cid, c in C.items():
        srcs = [SRC.get(s, {}) for s in c.get("sources", [])]
        strong = [s for s in srcs if s.get("confidence") == "high"]
        weak = [s for s in srcs if s.get("confidence") == "low"]
        if c.get("source_confidence") == "high" and not strong:
            finding("HIGH", cid, "source-strength",
                    "source_confidence 'high' but no source is rated high")
        if srcs and len(weak) == len(srcs):
            finding("HIGH", cid, "source-strength",
                    f"every source is low-confidence ({len(weak)}); claims here rest on nothing solid")
        if c.get("source_confidence") == "high" and len(strong) == 1 and len(srcs) < 3:
            finding("LOW", cid, "source-strength",
                    "high confidence resting on a single strong source")

    # ---- 2. access caveats: a source we have not actually read ----
    for cid, c in C.items():
        for sid in c.get("sources", []):
            note = (SRC.get(sid, {}).get("note") or "").upper()
            if "ACCESS CAVEAT" in note and c.get("status", {}).get("stage") in ("validated", "ready"):
                finding("LOW", cid, "unread-source",
                        f"promoted to {c['status']['stage']} while relying on {sid}, which carries an access caveat")

    # ---- 3. attribution stated more firmly than the evidence ----
    for cid, c in C.items():
        h = c.get("history") or {}
        conf = h.get("confidence")
        for att in h.get("attributions", []):
            rel, person = att.get("relation"), att.get("person")
            if rel in ("originated-by", "named-by") and conf in ("low", "unknown"):
                note = (att.get("note") or "").lower()
                hedged = any(w in note for w in
                             ("alleged", "not verified", "unverified", "conventional",
                              "caveat", "not been", "second-hand", "recorded because"))
                if not hedged:
                    finding("HIGH", cid, "attribution",
                            f"{rel} -> {person} with history confidence '{conf}' and no hedge in the note")

    # ---- 4. concepts that certainly have exceptions but record none ----
    for cid, c in C.items():
        kt = c.get("knowledge_type")
        if kt in ("strategic-principle", "positional-concept", "rule-of-thumb",
                  "historical-teaching-principle", "practical-guideline"):
            if not c.get("exceptions"):
                finding("HIGH", cid, "no-exceptions",
                        f"{kt} with no exceptions recorded — almost certainly incomplete")
            if not (c.get("recognition") or {}).get("false_positive_traps"):
                finding("LOW", cid, "no-fp-traps", f"{kt} with no false_positive_traps recorded")

    # ---- 5. possible duplicates: an alias that is another concept's canonical name or id ----
    canon = {c["canonical_name"].lower(): cid for cid, c in C.items()}
    for cid, c in C.items():
        for alias in c.get("alternate_names", []) + c.get("historical_names", []):
            a_l = alias.lower().split("(")[0].strip()
            other = canon.get(a_l)
            if other and other != cid:
                finding("HIGH", cid, "possible-duplicate",
                        f"alias '{alias}' is the canonical name of '{other}' — are these one concept?")
            slug = re.sub(r"[^a-z0-9]+", "-", a_l).strip("-")
            if slug in C and slug != cid:
                finding("LOW", cid, "possible-duplicate",
                        f"alias '{alias}' matches concept id '{slug}'")

    # ---- 6. proportion: records far shorter or longer than their neighbours ----
    sizes = {cid: len(json.dumps(c)) for cid, c in C.items()}
    if sizes:
        vals = sorted(sizes.values())
        med = vals[len(vals) // 2]
        for cid, n in sizes.items():
            stage = C[cid].get("status", {}).get("stage")
            if n < med * 0.45 and stage not in ("discovered", "stub"):
                finding("LOW", cid, "proportion",
                        f"record is {n} bytes against a median of {med} — likely under-researched")

    # ---- 7. detector claims that no code backs ----
    for cid, c in C.items():
        det = (c.get("recognition") or {}).get("detector")
        if det and "not yet written" not in det and c["recognition"].get("detectability") == "mechanical":
            if not any(k in det for k in ("findMotifs", "puzzle_rules", "tablebase", "posKey",
                                          "halfmoveClock", "inCheck", "isCheckmate", "isStalemate",
                                          "epTarget", "castlingRights", "promotionAvailable",
                                          "sacrificeSize", "lineAlignment", "attacksAfterMove",
                                          "checkersAfterMove", "defenderCount", "safeSquareCount",
                                          "threatsAfterMove", "kingFlightSquares", "backRankEscape",
                                          "rankOccupancy", "kingDistance", "fileOccupancy",
                                          "pawnAttackableSquares", "pawnStructure", "pawnsOnBishopColour",
                                          "kingZoneAttackers")):
                finding("LOW", cid, "detector", f"detector '{det}' names nothing recognisable")

    # ---- 8. an explanation that promises a level the record does not carry ----
    for cid, c in C.items():
        lvl = (c.get("explanations") or {}).get("by_level") or {}
        dep = (c.get("explanations") or {}).get("by_depth") or {}
        if lvl and not dep and c.get("status", {}).get("stage") in ("validated", "ready"):
            finding("LOW", cid, "explanations",
                    "promoted without by_depth explanations (short/normal/deep)")

    order = {"HIGH": 0, "LOW": 1}
    FINDINGS.sort(key=lambda f: (order[f[0]], f[2], f[1]))
    high = sum(1 for f in FINDINGS if f[0] == "HIGH")
    print(f"audited {len(C)} concepts | {len(FINDINGS)} findings ({high} high, {len(FINDINGS)-high} low)\n")
    bykind = defaultdict(list)
    for sev, cid, kind, msg in FINDINGS:
        bykind[(sev, kind)].append((cid, msg))
    for (sev, kind), items in sorted(bykind.items(), key=lambda kv: (order[kv[0][0]], kv[0][1])):
        print(f"[{sev}] {kind}  ({len(items)})")
        for cid, msg in items:
            print(f"    {cid:26} {msg}")
        print()


if __name__ == "__main__":
    main()
