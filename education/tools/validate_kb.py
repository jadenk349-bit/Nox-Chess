#!/usr/bin/env python3
"""Integrity checker for the Education System knowledge base.

Standard library only — no jsonschema dependency, matching the project's
near-stdlib Python. It enforces the parts of tools/schema.json that actually
catch mistakes: required fields, enums, id shape and uniqueness, and above all
referential integrity, since concepts point at each other and at sources by id
and a typo there is silent.

    python3 tools/validate_kb.py            # check everything
    python3 tools/validate_kb.py --strict   # also fail on warnings
"""
import argparse, json, os, re, sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ID_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")

EPISTEMIC = set("ABCDEFGHIJ")
DIFFICULTY = {"beginner", "intermediate", "advanced", "master"}
STAGE = {"stub", "researched", "validated", "needs-review"}
CONFIDENCE = {"high", "medium", "low"}
DETECTABILITY = {"mechanical", "heuristic", "human-only"}
VERDICT = {"supports", "contradicts", "ambiguous", "untested"}
CERTAINTY = {"established", "probable", "disputed", "unknown"}

REQUIRED = ["id", "canonical_name", "category", "epistemic_type",
            "definition_short", "definition_long", "sources",
            "source_confidence", "status"]


def load_json(path):
    with open(path) as f:
        return json.load(f)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--strict", action="store_true")
    args = ap.parse_args()

    errors, warnings = [], []

    schema_path = os.path.join(HERE, "tools", "schema.json")
    allowed = set(load_json(schema_path)["properties"])

    taxonomy = load_json(os.path.join(HERE, "taxonomy.json"))
    areas = {a["id"] for d in taxonomy["domains"] for a in d["areas"]}
    domains = {d["id"] for d in taxonomy["domains"]}

    sources = load_json(os.path.join(HERE, "sources", "sources.json"))["sources"]

    concepts, paths = {}, {}
    root = os.path.join(HERE, "concepts")
    for dirpath, _, files in os.walk(root):
        for fn in sorted(files):
            if not fn.endswith(".json"):
                continue
            p = os.path.join(dirpath, fn)
            rel = os.path.relpath(p, HERE)
            try:
                c = load_json(p)
            except json.JSONDecodeError as e:
                errors.append(f"{rel}: invalid JSON — {e}")
                continue

            cid = c.get("id")
            if not cid:
                errors.append(f"{rel}: no id")
                continue
            if not ID_RE.match(cid):
                errors.append(f"{rel}: id {cid!r} is not kebab-case")
            if cid in concepts:
                errors.append(f"{rel}: duplicate id {cid!r} (also {paths[cid]})")
            if fn != cid + ".json":
                warnings.append(f"{rel}: filename should be {cid}.json")
            concepts[cid] = c
            paths[cid] = rel

            for f in REQUIRED:
                if f not in c:
                    errors.append(f"{rel}: missing required field {f!r}")
            for f in c:
                if f not in allowed:
                    errors.append(f"{rel}: unknown field {f!r}")

            if c.get("epistemic_type") not in EPISTEMIC:
                errors.append(f"{rel}: bad epistemic_type {c.get('epistemic_type')!r}")
            if "difficulty" in c and c["difficulty"] not in DIFFICULTY:
                errors.append(f"{rel}: bad difficulty {c['difficulty']!r}")
            if c.get("source_confidence") not in CONFIDENCE:
                errors.append(f"{rel}: bad source_confidence {c.get('source_confidence')!r}")

            st = c.get("status") or {}
            if st.get("stage") not in STAGE:
                errors.append(f"{rel}: bad status.stage {st.get('stage')!r}")

            cat = c.get("category")
            if cat and cat not in areas and cat not in domains:
                errors.append(f"{rel}: category {cat!r} is not in taxonomy.json")

            for sid in c.get("sources", []):
                if sid not in sources:
                    errors.append(f"{rel}: source id {sid!r} not in sources/sources.json")

            if c.get("source_confidence") == "high" and len(c.get("sources", [])) < 2:
                warnings.append(f"{rel}: source_confidence 'high' with fewer than 2 sources")

            rec = c.get("recognition") or {}
            if rec.get("detectability") and rec["detectability"] not in DETECTABILITY:
                errors.append(f"{rel}: bad recognition.detectability")

            org = c.get("origin") or {}
            if org.get("certainty") and org["certainty"] not in CERTAINTY:
                errors.append(f"{rel}: bad origin.certainty")

            for bucket in ("examples", "counterexamples"):
                for i, ex in enumerate(c.get(bucket, [])):
                    where = f"{rel}: {bucket}[{i}]"
                    fen = ex.get("fen", "")
                    if fen.count("/") != 7 or len(fen.split()) < 2:
                        errors.append(f"{where}: FEN does not look well-formed")
                    eng = ex.get("engine")
                    if eng and eng.get("verdict") not in VERDICT:
                        errors.append(f"{where}: bad engine.verdict")
                    if st.get("stage") == "validated" and not eng:
                        errors.append(f"{where}: concept is 'validated' but this position has no engine block")

    # cross-references resolve
    for cid, c in concepts.items():
        for field in ("related_concepts", "broader_concepts",
                      "narrower_concepts", "opposing_concepts", "prerequisites"):
            for ref in c.get(field, []):
                if ref not in concepts:
                    warnings.append(f"{paths[cid]}: {field} -> {ref!r} does not exist yet")

    # coverage rows exist for every concept
    cov = load_json(os.path.join(HERE, "state", "coverage.json"))["concepts"]
    for cid in concepts:
        if cid not in cov:
            warnings.append(f"{paths[cid]}: no row in state/coverage.json")
    for cid in cov:
        if cid not in concepts:
            errors.append(f"state/coverage.json: row for unknown concept {cid!r}")

    print(f"concepts: {len(concepts)}   sources: {len(sources)}   "
          f"areas: {len(areas)}   errors: {len(errors)}   warnings: {len(warnings)}")
    for e in errors:
        print("  ERROR   " + e)
    for w in warnings:
        print("  warning " + w)

    if errors or (args.strict and warnings):
        sys.exit(1)


if __name__ == "__main__":
    main()
