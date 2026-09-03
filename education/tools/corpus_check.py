#!/usr/bin/env python3
"""Validate the human-grounded corpus, and stress-test the API against it.

Two jobs, deliberately in one tool, because they answer one question: does the
system agree with what a human expert actually said about a position?

VALIDATION  every entry must carry its provenance - source, game, FEN, move,
            the human annotation, the concept, the engine verification, a
            confidence, and the alternates that were considered and rejected.
            A missing field is a finding, not a default.

STRESS TEST every entry is run through analyzeWithEducation and scored AGAINST
            ITS ROLE, because a corpus of positive examples only ever measures
            false negatives. The three roles are scored by three different
            standards and conflating them is how a negative example gets
            recorded as a success:

  positive   PRIMARY        the annotated concept is the API's lead
             secondary      it is present but not the lead
             FALSE NEGATIVE it is absent entirely

  ambiguous  present        the concept is reported at all. The annotator said
                            it contributes without deciding, so leading with it
                            is not counted as an error - but it IS counted, and
                            printed, because a system that always leads with a
                            contributing factor is overstating.
             FALSE NEGATIVE absent entirely

  negative   correct        the concept is ABSENT for the SIDE the entry names
                            (`side`: "w" or "b"), or absent entirely when it
                            names none. The side matters and the sharpest cases
                            need it: Nimzowitsch's blockading bishop on d4 must
                            not be called bad in a position where BLACK's bishop
                            on d7 correctly is, and until `subjects` was carried
                            through to the API's concepts_all that claim could
                            not be written down at all. That is the whole point of a
                            negative example: the board superficially resembles
                            the concept and the system must not say so.
             FALSE POSITIVE it is reported. Leading with it is worse and is
                            reported separately.

  and for every role, reporting a concept the annotator explicitly considered
  AND REJECTED is a FALSE POSITIVE - a much sharper test than "reported
  something extra", because the human named those alternatives and said no.

RANKING    reporting a concept and burying it are different outcomes and were
           scored the same. For a POSITIVE entry the annotated concept is what a
           human said the position is about, so its RANK in the reported list is
           a measurement: rank 1 is the lead, rank 5 is a footnote under four
           other things. The mean rank is printed, and every entry's rank is
           printed beside it, so a change that quietly buries a concept shows up.

CONFIDENCE the annotator's own confidence is recorded per entry. The system may
           say less than the human and may not say more: reporting HIGH where a
           careful annotator wrote `medium` is a confidence error, and it is
           counted separately from being wrong about the concept.

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
          "console.log(JSON.stringify({c:(r.concepts_all||r.concepts).map(x=>({id:x.id,conf:x.confidence,side:x.subjects||[]})),"
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

    import re as _re
    _src = ""
    for rel in ("lib/matchers.js",):
        fp = os.path.join(HERE, rel)
        if os.path.exists(fp):
            _src += open(fp, encoding="utf-8").read()
    recognised = set(_re.findall(r"concept:\s*'([a-z0-9-]+)'", _src))
    mm = os.path.join(HERE, "tools", "motif_map.json")
    if os.path.exists(mm):
        for _v in json.load(open(mm, encoding="utf-8")).get("map", {}).values():
            if _v.get("concept"):
                recognised.add(_v["concept"])

    # A concept whose own record says it cannot be detected from a board is not
    # a bug when it is not detected. `initiative` says so in as many words - "the
    # initiative is invisible to a static feature scan, so it cannot be detected
    # from the board alone" - and `piece-coordination` and
    # `transformation-of-advantages` are both marked human-only. Counting those
    # as failures is as misleading as counting them as passes, so they are
    # counted separately, and the split is DERIVED from the concept records
    # rather than listed here, so it cannot be widened to flatter a number.
    def detectable(cid):
        c = concepts.get(cid) or {}
        det = ((c.get("recognition") or {}).get("detectability") or "")
        return cid in recognised or det == "mechanical"

    def fn_key(cid):
        return "false_negative" if detectable(cid) else "undetectable"

    def fn_verdict(cid):
        return ("FALSE NEGATIVE" if detectable(cid)
                else "absent - the concept's own record says it cannot have a detector")

    problems = []
    for p in pos:
        for k in REQUIRED:
            # An EMPTY rejected_as_wrong is a statement, not an omission: it says
            # the annotator considered the alternates and none of them would be
            # wrong here. That is the right answer for an entry scored on
            # CONFIDENCE rather than on presence, where everything the system
            # says is true and only the weight is wrong - and treating it as a
            # missing field would push the author towards inventing a rejection,
            # which is exactly how three entries in this file once manufactured
            # false positives out of correct output.
            if k == "rejected_as_wrong":
                if k not in p:
                    problems.append(f"{p.get('id','?')}: missing {k}")
                continue
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
             "phrasing": 0, "api_error": 0, "undetectable": 0, "overconfident": 0,
             "neg_correct": 0, "neg_leaked": 0, "neg_vacuous": 0, "amb_present": 0, "amb_led": 0}
    rows = []
    ranks = []
    for p in pos:
        # Look at the position the move REACHES as well as the one it was played
        # from. A move-based concept - two weaknesses, improving the worst piece -
        # describes what the move achieves, and asking only about the position
        # before it scored 3/3 false negatives on annotated ground truth.
        r = api(p["fen"], p.get("move_uci"))
        # The forced reply is often where the concept actually happens, and it is
        # a MOVE, not a position. Capablanca-Mattison 1929 is the case: the
        # annotation says 15.Ng5 forces ...f5 and permanently weakens the shield,
        # and 15.Ng5 itself changes nothing measurable about the black king's
        # zone - the knight landing on g5 blocks the bishop that was already
        # looking at h6. Asking about the position after the reply, with no move,
        # asks about the wreckage and not about the moment it was done.
        rAfter = api(p["fen_after"], p.get("move_after_uci")) if p.get("fen_after") else None
        # Some concepts exist only after a forced reply; asking earlier asks
        # before the concept exists.
        rReal = api(p["fen_concept_realised"]) if p.get("fen_concept_realised") else None
        if r is None:
            tally["api_error"] += 1
            rows.append((p["id"], "API ERROR", "", "", None, None, None, False))
            continue
        # When an entry names a side, a concept reported about the OTHER side is
        # not the concept this entry is talking about.
        want_side = p.get("side")

        def keep(cs):
            if not want_side:
                return [c["id"] for c in cs]
            return [c["id"] for c in cs
                    if c["id"] != p["concept"] or want_side in (c.get("side") or [])]

        ids = keep(r["c"])
        idsAfter = keep((rAfter or {}).get("c", []))
        idsReal = keep((rReal or {}).get("c", []))
        idsAfter = idsAfter + [i for i in idsReal if i not in idsAfter]
        want = p["concept"]
        seen = ids + [i for i in idsAfter if i not in ids]
        leadAfter = (idsReal[0] if idsReal else None) or (idsAfter[0] if idsAfter else None)
        leads = (ids and ids[0] == want) or leadAfter == want
        role = p.get("concept_role")
        # Three roles, three standards. An earlier version had one - "is the
        # annotated concept the lead" - which scores a NEGATIVE example as a
        # success precisely when the system has failed it.
        if role == "negative":
            if want in seen:
                verdict = "FALSE POSITIVE (led)" if leads else "FALSE POSITIVE"
                tally["false_positive"] += 1
                tally["neg_leaked"] += 1
            elif not detectable(want):
                # Not a win. A negative example for a concept nothing can detect
                # passes because nothing could ever have reported it, and
                # counting that as evidence that false positives are controlled
                # would be counting the absence of a detector as a virtue.
                verdict = "vacuous - nothing could have reported it"
                tally["neg_vacuous"] += 1
            else:
                verdict = "correct (absent)"; tally["neg_correct"] += 1
        elif role == "ambiguous":
            if want in seen:
                verdict = "present" + (" (led)" if leads else "")
                tally["amb_present"] += 1
                if leads:
                    tally["amb_led"] += 1
            else:
                verdict = fn_verdict(want); tally[fn_key(want)] += 1
        else:
            if leads:
                verdict = "PRIMARY"; tally["primary"] += 1
            elif want in seen:
                verdict = "secondary"; tally["secondary"] += 1
            else:
                verdict = fn_verdict(want); tally[fn_key(want)] += 1
        # Only a concept the annotator considered and REJECTED AS WRONG counts
        # against the system. Concepts that are also true but secondary are
        # supposed to be reported, and an earlier version of this check scored
        # them as false positives — which would have penalised correct output.
        # For a negative entry the concept itself belongs in rejected_as_wrong -
        # that is what "should not be labelled this way" means - so it must not
        # be counted twice.
        already = {want} if role == "negative" else set()
        rejected = [a for a in (p.get("rejected_as_wrong") or []) if a in seen]
        if [a for a in rejected if a not in already]:
            tally["false_positive"] += 1
        if r["v"]:
            tally["phrasing"] += 1
        # RANK of the annotated concept, wherever it was actually reported. 1 is
        # the lead. `None` when it was not reported at all.
        rank = None
        for lst in (ids, idsAfter, idsReal):
            if want in lst:
                r_ = lst.index(want) + 1
                rank = r_ if rank is None else min(rank, r_)
        if rank is not None and role == "positive":
            ranks.append(rank)

        # CONFIDENCE: the system may say less than the human, never more.
        ORDER = {"low": 0, "medium": 1, "high": 2}
        said = next((c["conf"] for c in r["c"] if c["id"] == want), None)
        if said is None:
            said = next((c["conf"] for c in (rAfter or {}).get("c", []) if c["id"] == want), None)
        human = p.get("confidence")
        overclaim = (said is not None and human in ORDER and said in ORDER
                     and ORDER[said] > ORDER[human])
        if overclaim:
            tally["overconfident"] += 1

        rows.append((p["id"], verdict, ",".join(ids[:3]) + " | after: " + ",".join(idsAfter[:3]),
                     ",".join(rejected), rank, said, human, overclaim))

    n = len(pos) or 1
    roles = {r: sum(1 for x in pos if x.get("concept_role") == r)
             for r in ("positive", "ambiguous", "negative")}
    npos = roles["positive"] or 1
    print(f"\nAPI AGAINST THE CORPUS   "
          f"({roles['positive']} positive, {roles['ambiguous']} ambiguous, "
          f"{roles['negative']} negative)")
    print(f"  positive: concept is the LEAD        {tally['primary']}/{npos}")
    print(f"  positive: present but not the lead   {tally['secondary']}/{npos}")
    print(f"  FALSE NEGATIVE (absent, and detectable)  {tally['false_negative']}/{n}")
    print(f"  absent by design (no detector allowed)   {tally['undetectable']}/{n}")
    print(f"  negative: correctly NOT reported     {tally['neg_correct']}/{roles['negative'] or 1}")
    print(f"  negative: vacuous (no detector exists) {tally['neg_vacuous']}/{roles['negative'] or 1}")
    print(f"  negative: reported anyway            {tally['neg_leaked']}/{roles['negative'] or 1}")
    print(f"  ambiguous: reported                  {tally['amb_present']}/{roles['ambiguous'] or 1}"
          f"   (of which led: {tally['amb_led']})")
    print(f"  FALSE POSITIVE (rejected alternate)  {tally['false_positive']}/{n}")
    print(f"  phrasing violations                  {tally['phrasing']}/{n}")
    if ranks:
        best = sum(1 for x in ranks if x == 1)
        top3 = sum(1 for x in ranks if x <= 3)
        print(f"  RANK of the annotated concept        mean {sum(ranks)/len(ranks):.1f} over "
              f"{len(ranks)} positives; lead {best}, top-3 {top3}")
    print(f"  CONFIDENCE overclaimed vs the human  {tally['overconfident']}/{n}")
    if tally["api_error"]:
        print(f"  API errors                           {tally['api_error']}/{n}")
    print()
    GOOD = ("PRIMARY", "correct (absent)", "present", "present (led)")
    BYDESIGN = ("absent - the concept's own record says it cannot have a detector",
                "vacuous - nothing could have reported it")
    SOFT = ("secondary",)
    for pid, verdict, got, rej, rank, said, human, overclaim in rows:
        mark = ("ok  " if verdict in GOOD else "n/a " if verdict in BYDESIGN
                else "~   " if verdict in SOFT else "MISS")
        where = f" [rank {rank}]" if rank else ""
        print(f"  {mark} {pid}{where}")
        print(f"       {verdict}; API said: {got or '(nothing)'}")
        if overclaim:
            print(f"       CONFIDENCE: says {said} where the annotator wrote {human}")
        if rej:
            print(f"       reported rejected alternate(s): {rej}")
    print()
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
