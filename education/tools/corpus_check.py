#!/usr/bin/env python3
"""Validate the human-grounded corpus, and stress-test the API against it.

Two jobs, deliberately in one tool, because they answer one question: does the
system agree with what a human expert actually said about a position?

VALIDATION  every entry must carry its provenance - source, game, FEN, move,
            the human annotation, the concept, the engine verification, a
            confidence, and the alternates that were considered and rejected.
            A missing field is a finding, not a default.

STRESS TEST every entry is run through analyzeWithEducation and scored:

  PRIMARY HIT     the annotated concept is the API's lead
  SECONDARY HIT   it is present but not the lead
  FALSE NEGATIVE  the annotated concept is absent entirely
  FALSE POSITIVE  a concept the annotator explicitly considered AND REJECTED is
                  reported - which is a much sharper test than "reported
                  something extra", because the human named those alternatives
                  and said no

    python3 tools/corpus_check.py [-v]
"""
import json, os, subprocess, sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REQUIRED = ["id", "concept", "concept_role", "game", "source", "fen", "move",
            "human_annotation", "explanation", "engine", "confidence",
            "rejected_as_wrong", "fen_verified"]
ENGINE_REQUIRED = ["engine_id", "best_move", "agrees"]


def load():
    p = os.path.join(HERE, "corpus", "annotated_positions.json")
    return json.load(open(p, encoding="utf-8"))


def api(fen, move=None):
    """Ask the real API, through node, exactly as a caller would."""
    js = ("const A=require('%s/lib/analyze.js');"
          "const o={fen:process.argv[1]};if(process.argv[2])o.move=process.argv[2];"
          "const r=A.analyzeWithEducation(o);"
          "console.log(JSON.stringify({c:(r.concepts_all||r.concepts).map(x=>({id:x.id,conf:x.confidence})),"
          "t:r.explanation.text,v:r.phrasing_violations,n:r.notes}));") % HERE
    out = subprocess.run(["node", "-e", js, fen, move or ""], capture_output=True, text=True, cwd=HERE)
    if out.returncode != 0:
        return None
    return json.loads(out.stdout)


def main():
    v = "-v" in sys.argv
    d = load()
    pos = d["positions"]
    src = json.load(open(os.path.join(HERE, "sources", "sources.json"), encoding="utf-8"))["sources"]
    concepts = {}
    for root, _, files in os.walk(os.path.join(HERE, "concepts")):
        for fn in files:
            if fn.endswith(".json"):
                c = json.load(open(os.path.join(root, fn), encoding="utf-8"))
                concepts[c["id"]] = c

    problems = []
    for p in pos:
        for k in REQUIRED:
            if not p.get(k):
                problems.append(f"{p.get('id','?')}: missing {k}")
        if p.get("concept") and p["concept"] not in concepts:
            problems.append(f"{p['id']}: concept {p['concept']} is not in the knowledge base")
        if p.get("source") and p["source"] not in src:
            problems.append(f"{p['id']}: source {p['source']} is not registered")
        if p.get("concept_role") not in d["concept_roles"]:
            problems.append(f"{p.get('id','?')}: bad concept_role")
        for k in ENGINE_REQUIRED:
            if not (p.get("engine") or {}).get(k):
                problems.append(f"{p.get('id','?')}: engine.{k} missing")

    print(f"\nCORPUS — {len(pos)} human-grounded positions")
    if problems:
        print(f"  {len(problems)} provenance problem(s):")
        for x in problems[:12]:
            print("    " + x)
    else:
        print("  provenance complete on every entry")

    tally = {"primary": 0, "secondary": 0, "false_negative": 0, "false_positive": 0,
             "phrasing": 0, "api_error": 0}
    rows = []
    for p in pos:
        # Look at the position the move REACHES as well as the one it was played
        # from. A move-based concept - two weaknesses, improving the worst piece -
        # describes what the move achieves, and asking only about the position
        # before it scored 3/3 false negatives on annotated ground truth.
        r = api(p["fen"], p.get("move_uci"))
        rAfter = api(p["fen_after"]) if p.get("fen_after") else None
        # Some concepts exist only after a forced reply; asking earlier asks
        # before the concept exists.
        rReal = api(p["fen_concept_realised"]) if p.get("fen_concept_realised") else None
        if r is None:
            tally["api_error"] += 1
            rows.append((p["id"], "API ERROR", "", ""))
            continue
        ids = [c["id"] for c in r["c"]]
        idsAfter = [c["id"] for c in (rAfter or {}).get("c", [])]
        idsReal = [c["id"] for c in (rReal or {}).get("c", [])]
        idsAfter = idsAfter + [i for i in idsReal if i not in idsAfter]
        want = p["concept"]
        seen = ids + [i for i in idsAfter if i not in ids]
        leadAfter = (idsReal[0] if idsReal else None) or (idsAfter[0] if idsAfter else None)
        if (ids and ids[0] == want) or leadAfter == want:
            verdict = "PRIMARY"; tally["primary"] += 1
        elif want in seen:
            verdict = "secondary"; tally["secondary"] += 1
        else:
            verdict = "FALSE NEGATIVE"; tally["false_negative"] += 1
        # Only a concept the annotator considered and REJECTED AS WRONG counts
        # against the system. Concepts that are also true but secondary are
        # supposed to be reported, and an earlier version of this check scored
        # them as false positives — which would have penalised correct output.
        rejected = [a for a in (p.get("rejected_as_wrong") or []) if a in seen]
        if rejected:
            tally["false_positive"] += 1
        if r["v"]:
            tally["phrasing"] += 1
        rows.append((p["id"], verdict, ",".join(ids[:3]) + " | after: " + ",".join(idsAfter[:3]),
                     ",".join(rejected)))

    n = len(pos) or 1
    print(f"\nAPI AGAINST THE CORPUS")
    print(f"  annotated concept is the LEAD        {tally['primary']}/{n}")
    print(f"  present but not the lead             {tally['secondary']}/{n}")
    print(f"  FALSE NEGATIVE (absent entirely)     {tally['false_negative']}/{n}")
    print(f"  reported a REJECTED alternate        {tally['false_positive']}/{n}")
    print(f"  phrasing violations                  {tally['phrasing']}/{n}")
    if tally["api_error"]:
        print(f"  API errors                           {tally['api_error']}/{n}")
    print()
    for pid, verdict, got, rej in rows:
        mark = "ok  " if verdict == "PRIMARY" else ("~   " if verdict == "secondary" else "MISS")
        print(f"  {mark} {pid}")
        print(f"       {verdict}; API said: {got or '(nothing)'}")
        if rej:
            print(f"       reported rejected alternate(s): {rej}")
    print()
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
