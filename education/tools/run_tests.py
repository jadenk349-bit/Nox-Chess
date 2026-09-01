#!/usr/bin/env python3
"""Quality tests for the Education System knowledge base.

Schema and referential integrity live in validate_kb.py; this file tests the
things that make the knowledge EDUCATIONALLY sound rather than merely well-formed.

    python3 tools/run_tests.py
    python3 tools/run_tests.py -v
"""
import json, os, subprocess, sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FAILS, PASSES, SKIPS = [], [], []


def load(rel):
    with open(os.path.join(HERE, rel)) as f:
        return json.load(f)


def concepts():
    out = {}
    for dp, _, fs in os.walk(os.path.join(HERE, "concepts")):
        for fn in sorted(fs):
            if fn.endswith(".json"):
                with open(os.path.join(dp, fn)) as f:
                    c = json.load(f)
                out[c["id"]] = c
    return out


def check(name, ok, detail="", skip=False):
    if skip:
        SKIPS.append((name, detail))
    elif ok:
        PASSES.append(name)
    else:
        FAILS.append((name, detail))


def main():
    verbose = "-v" in sys.argv
    C = concepts()
    cov = load("state/coverage.json")
    fp = load("tests/false_positive_cases.json")
    READY = {"validated", "ready"}

    # 1. schema + integrity must be clean
    r = subprocess.run([sys.executable, os.path.join(HERE, "tools", "validate_kb.py")],
                       capture_output=True, text=True)
    check("schema_and_integrity", r.returncode == 0,
          (r.stdout or "").strip().splitlines()[-1] if r.stdout else "validate_kb.py failed")

    # 2. a guideline must never read as a law
    for cid, c in C.items():
        if c["knowledge_type"] in {"rule-of-thumb", "historical-teaching-principle",
                                   "practical-guideline"}:
            check(f"hedged::{cid}", bool((c.get("explanations") or {}).get("hedge")),
                  "guideline with no hedge wording")

    # 3. anything treated as production-ready needs exceptions and engine evidence
    for cid, c in C.items():
        if c["status"]["stage"] in READY:
            check(f"ready_has_exceptions::{cid}",
                  bool(c.get("exceptions")) or c["knowledge_type"] == "official-rule",
                  "promoted without recorded exceptions")
            pos = c.get("examples", []) + c.get("counterexamples", []) + c.get("ambiguous_examples", [])
            row = cov["concepts"].get(cid, {})
            if row.get("engine_testable", True):
                check(f"ready_has_engine::{cid}",
                      any(p.get("engine") or p.get("tablebase") for p in pos),
                      "promoted with no engine or tablebase evidence")

    # 3b. the warnings index must be current, or an explanation layer reading it
    # would be working from a stale picture of what it must not say
    r = subprocess.run([sys.executable, os.path.join(HERE, "tools", "build_index.py"), "--check"],
                       capture_output=True, text=True)
    check("warnings_index_current", r.returncode == 0,
          (r.stdout or "").strip().splitlines()[-1] if r.stdout else "build_index.py --check failed")

    # 3c. Layers 3 and 4 and the reusable API have their own suite, in JS because
    # they run on the page's own move generator. Fold its result in here so one
    # command still tells you whether the whole system is sound.
    api = subprocess.run(["node", os.path.join(HERE, "tests", "test_api.js")],
                         capture_output=True, text=True)
    line = [l for l in (api.stdout or "").splitlines() if l.startswith("API  PASS")]
    check("api_suite", api.returncode == 0,
          (line[0] if line else (api.stderr or "node/test_api.js failed").strip().splitlines()[-1]))
    if verbose and line:
        print("   " + line[0])

    # 3d. Explanation quality: not whether the system says something false, but
    # whether it says something useless, which is the other way an explanation
    # layer fails.
    exp = subprocess.run(["node", os.path.join(HERE, "tests", "test_explanations.js")],
                         capture_output=True, text=True)
    eline = [l for l in (exp.stdout or "").splitlines() if l.startswith("EXPLANATION  PASS")]
    check("explanation_quality", exp.returncode == 0,
          (eline[0] if eline else (exp.stderr or "test_explanations.js failed").strip().splitlines()[-1]))
    if verbose and eline:
        print("   " + eline[0])

    # 3e. API behaviour across position types the puzzle corpus does not contain,
    # including terminology invariance under an engine result.
    aud = subprocess.run(["node", os.path.join(HERE, "tools", "api_audit.js")],
                         capture_output=True, text=True)
    aline = [l for l in (aud.stdout or "").splitlines() if l.startswith("API AUDIT  PASS")]
    check("api_behaviour_audit", aud.returncode == 0,
          (aline[0] if aline else (aud.stderr or "api_audit.js failed").strip().splitlines()[-1]))
    if verbose and aline:
        print("   " + aline[0])

    # 4. constructed positions must be labelled, never dressed as history
    for cid, c in C.items():
        for b in ("examples", "counterexamples", "ambiguous_examples"):
            for i, p in enumerate(c.get(b, [])):
                if p.get("origin_kind") in {"constructed-test", "study-composition"}:
                    check(f"constructed_labelled::{cid}[{b}{i}]", "game" not in p,
                          "constructed position carries a game citation")
                if p.get("origin_kind") == "historical-game":
                    check(f"historical_cited::{cid}[{b}{i}]", bool(p.get("game")),
                          "historical position with no game citation")

    # 5. a controlled pair must actually point at its partner, and the partner must exist
    fens = {p["fen"] for c in C.values()
            for b in ("examples", "counterexamples", "ambiguous_examples")
            for p in c.get(b, [])}
    for cid, c in C.items():
        for b in ("examples", "counterexamples", "ambiguous_examples"):
            for p in c.get(b, []):
                partner = p.get("controlled_pair_with")
                if partner:
                    check(f"pair_resolves::{cid}", partner in fens,
                          f"controlled_pair_with points at a FEN not in the base")

    # 6. tablebase results outrank engine evaluation and must not contradict it
    for cid, c in C.items():
        for b in ("examples", "counterexamples", "ambiguous_examples"):
            for p in c.get(b, []):
                tb, eng = p.get("tablebase"), p.get("engine")
                if tb and eng and tb.get("wdl") == "draw":
                    cp, mate = eng.get("eval_cp"), eng.get("mate_in")
                    contradicts = mate is not None or (cp is not None and abs(cp) > 150)
                    check(f"tb_vs_engine::{cid}", not contradicts,
                          f"tablebase says draw but engine block records cp={cp} mate={mate}")

    # 7. Phase 30 — every false-positive case must be answered before its concept is 'ready'
    for case in fp["cases"]:
        cid = case["concept"]
        c = C.get(cid)
        if c is None:
            check(f"false_positive::{case['id']}", True,
                  f"concept '{cid}' not yet researched", skip=True)
            continue
        if c["status"]["stage"] not in READY:
            check(f"false_positive::{case['id']}", True,
                  f"concept '{cid}' not yet promoted", skip=True)
            continue
        has_neg = any(p.get("engine") or p.get("tablebase")
                      for p in c.get("counterexamples", []) + c.get("ambiguous_examples", []))
        check(f"false_positive::{case['id']}", has_neg,
              f"'{cid}' is {c['status']['stage']} but has no tested counterexample "
              f"covering: {case['surface_pattern']}")

    # 8. explanations must not be empty at the levels the coverage row claims
    for cid, row in cov["concepts"].items():
        b = row["boxes"]
        c = C[cid]
        lvl = (c.get("explanations") or {}).get("by_level") or {}
        if b.get("beginner_explanation") is True:
            check(f"beginner_text::{cid}", bool(lvl.get("beginner", "").strip()), "empty text")

    # 9. no concept may claim high source confidence on a single source
    for cid, c in C.items():
        check(f"source_confidence::{cid}",
              not (c["source_confidence"] == "high" and len(c["sources"]) < 2),
              "high confidence on one source")

    # 10. aliases must not collide with another concept's canonical id (dedup guard)
    canon = {c["canonical_name"].lower(): cid for cid, c in C.items()}
    for cid, c in C.items():
        for a in c.get("alternate_names", []):
            other = canon.get(a.lower())
            check(f"alias_no_collision::{cid}", other in (None, cid),
                  f"alias '{a}' is another concept's canonical name ({other})")

    print(f"PASS {len(PASSES)}   FAIL {len(FAILS)}   SKIP {len(SKIPS)}")
    for n, d in FAILS:
        print(f"  FAIL  {n}: {d}")
    if verbose:
        for n, d in SKIPS:
            print(f"  skip  {n}: {d}")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
