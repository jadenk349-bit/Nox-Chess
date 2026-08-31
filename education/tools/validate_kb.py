#!/usr/bin/env python3
"""Integrity checker for the Education System knowledge base (schema v2).

Standard library only, matching the project's near-stdlib Python. Enforces the
parts of tools/schema.json that catch real mistakes: required fields, enums, id
shape and uniqueness, referential integrity between concepts/sources/coverage,
and the rules the brief makes non-negotiable —

  * a rule-of-thumb / historical-teaching-principle / practical-guideline MUST
    carry hedging wording, so a habit is never stated as a law;
  * a constructed position must be labelled constructed, never as a game;
  * 'validated' or 'ready' requires engine evidence, not reading;
  * a concept whose name_status is descriptive-phrase must not be presented as
    established terminology.

    python3 tools/validate_kb.py [--strict]
"""
import argparse, json, os, re, sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ID_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")

REQUIRED = ["id", "canonical_name", "category", "knowledge_type",
            "definition_short", "definition_long", "sources",
            "source_confidence", "status"]
HEDGE_REQUIRED = {"rule-of-thumb", "historical-teaching-principle", "practical-guideline"}
NEEDS_ENGINE = {"validated", "ready"}
CONSTRUCTED = {"constructed-test", "study-composition"}


def load(rel):
    with open(os.path.join(HERE, rel)) as f:
        return json.load(f)


def enums(schema):
    """Pull every enum out of the schema so the checker cannot drift from it."""
    found = {}
    def walk(node, path):
        if isinstance(node, dict):
            if "enum" in node:
                found[path] = set(node["enum"])
            for k, v in node.items():
                walk(v, f"{path}.{k}" if path else k)
        elif isinstance(node, list):
            for v in node:
                walk(v, path)
    walk(schema, "")
    return found


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--strict", action="store_true")
    args = ap.parse_args()
    errors, warnings = [], []

    schema = load("tools/schema.json")
    allowed = set(schema["properties"])
    E = enums(schema)

    def enum_of(suffix):
        for k, v in E.items():
            if k.endswith(suffix):
                return v
        return None

    KNOWLEDGE = enum_of("knowledge_type")
    STAGE = enum_of("status.properties.stage")
    NAMEST = enum_of("name_status")
    DIFF = enum_of("difficulty")
    HISTCONF = enum_of("history.properties.confidence")
    ORIGINKIND = enum_of("origin_kind")
    VERDICT = enum_of("verdict")
    WDL = enum_of("wdl")
    ERA = enum_of("engine_era_status")
    DETECT = enum_of("detectability")
    RELATION = enum_of("relation")

    taxonomy = load("taxonomy.json")
    areas = {a["id"] for d in taxonomy["domains"] for a in d["areas"]}
    sources = load("sources/sources.json")["sources"]

    concepts, paths = {}, {}
    for dirpath, _, files in os.walk(os.path.join(HERE, "concepts")):
        for fn in sorted(files):
            if not fn.endswith(".json"):
                continue
            p = os.path.join(dirpath, fn)
            rel = os.path.relpath(p, HERE)
            try:
                c = load(rel)
            except json.JSONDecodeError as e:
                errors.append(f"{rel}: invalid JSON — {e}")
                continue

            cid = c.get("id")
            if not cid or not ID_RE.match(cid or ""):
                errors.append(f"{rel}: missing or non-kebab id")
                continue
            if cid in concepts:
                errors.append(f"{rel}: duplicate id {cid!r} (also {paths[cid]})")
            if fn != cid + ".json":
                warnings.append(f"{rel}: filename should be {cid}.json")
            concepts[cid], paths[cid] = c, rel

            if c.get("schema_version") != 2:
                errors.append(f"{rel}: schema_version must be 2")
            for f in REQUIRED:
                if f not in c:
                    errors.append(f"{rel}: missing required field {f!r}")
            for f in c:
                if f not in allowed:
                    errors.append(f"{rel}: unknown field {f!r}")

            kt = c.get("knowledge_type")
            if KNOWLEDGE and kt not in KNOWLEDGE:
                errors.append(f"{rel}: bad knowledge_type {kt!r}")
            if NAMEST and c.get("name_status") and c["name_status"] not in NAMEST:
                errors.append(f"{rel}: bad name_status")
            if DIFF and c.get("difficulty") and c["difficulty"] not in DIFF:
                errors.append(f"{rel}: bad difficulty")
            if ERA and c.get("engine_era_status") and c["engine_era_status"] not in ERA:
                errors.append(f"{rel}: bad engine_era_status")

            st = c.get("status") or {}
            stage = st.get("stage")
            if STAGE and stage not in STAGE:
                errors.append(f"{rel}: bad status.stage {stage!r}")

            if c.get("category") not in areas:
                errors.append(f"{rel}: category {c.get('category')!r} not in taxonomy.json")

            for sid in c.get("sources", []):
                if sid not in sources:
                    errors.append(f"{rel}: source id {sid!r} not in sources/sources.json")
            if c.get("source_confidence") == "high" and len(c.get("sources", [])) < 2:
                warnings.append(f"{rel}: source_confidence 'high' with fewer than 2 sources")

            h = c.get("history") or {}
            if HISTCONF and h.get("confidence") and h["confidence"] not in HISTCONF:
                errors.append(f"{rel}: bad history.confidence")
            for a in h.get("attributions", []):
                if RELATION and a.get("relation") not in RELATION:
                    errors.append(f"{rel}: bad attribution relation {a.get('relation')!r}")

            rec = c.get("recognition") or {}
            if DETECT and rec.get("detectability") and rec["detectability"] not in DETECT:
                errors.append(f"{rel}: bad recognition.detectability")

            # --- the rules the brief makes non-negotiable ---
            hedge = ((c.get("explanations") or {}).get("hedge") or "").strip()
            if kt in HEDGE_REQUIRED and not hedge:
                errors.append(f"{rel}: knowledge_type {kt!r} REQUIRES explanations.hedge "
                              f"— a guideline must not read as a law")
            if kt in HEDGE_REQUIRED and not c.get("exceptions"):
                warnings.append(f"{rel}: {kt!r} with no exceptions recorded")
            if c.get("name_status") == "descriptive-phrase" and stage in NEEDS_ENGINE:
                warnings.append(f"{rel}: descriptive-phrase promoted to {stage!r} — "
                                f"confirm sources support it as a recognised name")

            engine_seen = False
            for bucket in ("examples", "counterexamples", "ambiguous_examples"):
                for i, ex in enumerate(c.get(bucket, [])):
                    w = f"{rel}: {bucket}[{i}]"
                    fen = ex.get("fen", "")
                    if fen.count("/") != 7 or len(fen.split()) < 2:
                        errors.append(f"{w}: FEN does not look well-formed")
                    if ORIGINKIND and ex.get("origin_kind") not in ORIGINKIND:
                        errors.append(f"{w}: bad or missing origin_kind")
                    if ex.get("origin_kind") in CONSTRUCTED and ex.get("game"):
                        errors.append(f"{w}: constructed position must not carry a `game` field")
                    if ex.get("origin_kind") == "historical-game" and not ex.get("game"):
                        warnings.append(f"{w}: historical-game with no game citation")
                    eng = ex.get("engine")
                    if eng:
                        engine_seen = True
                        if VERDICT and eng.get("verdict") not in VERDICT:
                            errors.append(f"{w}: bad engine.verdict")
                        if eng.get("test_level") not in (1, 2, 3, 4):
                            errors.append(f"{w}: engine.test_level must be 1-4")
                    tb = ex.get("tablebase")
                    if tb and WDL and tb.get("wdl") not in WDL:
                        errors.append(f"{w}: bad tablebase.wdl")

            if stage in NEEDS_ENGINE and not engine_seen:
                rowid = cid
                cov = load("state/coverage.json")["concepts"].get(rowid, {})
                if cov.get("engine_testable", True):
                    errors.append(f"{rel}: stage {stage!r} but no engine-tested position "
                                  f"(mark engine_testable:false in coverage if not applicable)")

    for cid, c in concepts.items():
        rel = c.get("relationships") or {}
        for field in ("broader", "narrower", "related", "contrasting", "co_occurring"):
            for ref in rel.get(field, []):
                if ref not in concepts:
                    warnings.append(f"{paths[cid]}: relationships.{field} -> {ref!r} does not exist yet")
        for cf in rel.get("conflicts", []):
            if cf.get("concept") not in concepts:
                warnings.append(f"{paths[cid]}: conflicts -> {cf.get('concept')!r} does not exist yet")
        for ref in (c.get("recognition") or {}).get("prerequisites", []):
            if ref not in concepts:
                warnings.append(f"{paths[cid]}: prerequisite {ref!r} does not exist yet")

    cov = load("state/coverage.json")["concepts"]
    for cid in concepts:
        if cid not in cov:
            warnings.append(f"{paths[cid]}: no row in state/coverage.json")
    for cid in cov:
        if cid not in concepts:
            errors.append(f"state/coverage.json: row for unknown concept {cid!r}")

    print(f"concepts {len(concepts)} | sources {len(sources)} | areas {len(areas)} "
          f"| errors {len(errors)} | warnings {len(warnings)}")
    for e in errors:
        print("  ERROR   " + e)
    for w in warnings:
        print("  warning " + w)
    if errors or (args.strict and warnings):
        sys.exit(1)


if __name__ == "__main__":
    main()
