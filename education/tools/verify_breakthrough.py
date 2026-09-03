#!/usr/bin/env python3
"""Prove or disprove every pawn-breakthrough claim, against the tablebase.

`pawn-breakthrough` makes a narrow, checkable claim and says so in its own
matcher note: *accepting the offer loses*. Not that the position is won - a
declined offer is a different question and is not claimed - so the thing to
check is the position after the offered move and after each pawn capture of it.
A pawn ending with seven men or fewer is inside Syzygy, so that check is a
PROOF rather than an engine opinion, and where the tablebase disagrees the
matcher is wrong.

This is the other half of tools/pawn_endings.js, and it exists because
state/COMPLETION.md carried the gap for several sessions: none of the 788
shipped positions is a pawn ending, so this detector had never been run against
anything at all and its 0.0% firing rate said nothing about its accuracy.

    node tools/pawn_endings.js --n 1500 --json state/pawn_endings.json
    python3 tools/verify_breakthrough.py --in state/pawn_endings.json [--limit 40]
"""
import argparse, json, os, subprocess, sys, time

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(HERE, "tools"))
import tablebase  # noqa: E402


def node_eval(js):
    r = subprocess.run(["node", "-e", js], capture_output=True, text=True, cwd=HERE)
    if r.returncode != 0:
        raise RuntimeError(r.stderr.strip()[:400])
    return json.loads(r.stdout)


def replies(fen, uci, side):
    """The position after `uci`, and every PAWN CAPTURE of the pawn it moved.

    The turn is set to the claiming side first, because Layer 3 answers the
    breakthrough question for BOTH colours and a claim for the side not to move
    is a claim about a move that is not legal in the position as it stands. That
    mismatch was itself a bug once - pawnBreakthrough() read the opponent's moves
    as its own - so the verifier flips the turn the same way the fixed matcher
    does rather than quietly skipping those rows.
    """
    js = ("const P=require('./../tools/page_chess.js');"
          "const fen=%s, uci=%s, side=%s;"
          "const st0=P.stateFromFEN(fen);"
          "const st=P.cloneState(st0); st.turn=side; st.ep=null;"
          "const mv=P.legalMoves(st).find(m=>P.uciOf(m)===uci);"
          "if(!mv){console.log(JSON.stringify({err:'no such move'}));process.exit(0)}"
          "const nx=P.makeMove(st,mv);"
          "const caps=P.legalMoves(nx).filter(x=>x.to===mv.to&&nx.b[x.from]&&nx.b[x.from].t==='P')"
          "  .map(x=>({uci:P.uciOf(x),fen:P.fenOf(P.makeMove(nx,x))}));"
          "console.log(JSON.stringify({after:P.fenOf(nx),caps}));"
          % (json.dumps(fen), json.dumps(uci), json.dumps(side)))
    return node_eval(js)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="src", default="state/pawn_endings.json")
    ap.add_argument("--limit", type=int, default=40)
    ap.add_argument("--json", dest="out")
    a = ap.parse_args()

    data = json.load(open(os.path.join(HERE, a.src), encoding="utf-8"))
    cases = [b for b in data["breakthroughs"] if b["men"] <= 7 and b.get("claim")]
    cases = cases[: a.limit]
    print(f"\nBREAKTHROUGH VERIFICATION — {len(cases)} tablebase-provable claims "
          f"of {len(data['breakthroughs'])} total\n")

    proved = disproved = unknown = 0
    rows = []
    for b in cases:
        fen, side, claim = b["fen"], b["side"], b["claim"]
        try:
            r = replies(fen, claim["first"], side)
        except Exception as e:
            print(f"  ?? {fen}  ({e})"); unknown += 1; continue
        if r.get("err") or not r.get("caps"):
            print(f"  ?? {fen}  no capture of the offer"); unknown += 1; continue
        verdicts = []
        for c in r["caps"]:
            time.sleep(0.35)          # the API is a courtesy; do not hammer it
            try:
                t = tablebase.lookup(c["fen"])
            except Exception as e:
                verdicts.append(("unknown", str(e)[:60])); continue
            # WDL is from the side to move in the queried position, which after
            # the capture is the OFFERING side. A win for them is the claim.
            verdicts.append((t.get("wdl"), t.get("dtz")))
        good = [v for v in verdicts if v[0] in ("win", "cursed-win")]
        bad = [v for v in verdicts if v[0] in ("draw", "loss", "blessed-loss")]
        unk = [v for v in verdicts if v[0] not in ("win", "cursed-win", "draw", "loss", "blessed-loss")]
        if unk and not bad:
            verdict = "unknown"; unknown += 1
        elif bad:
            verdict = "DISPROVED"; disproved += 1
        else:
            verdict = "proved"; proved += 1
        rows.append({"fen": fen, "side": side, "offer": claim["first"],
                     "captures": [c["uci"] for c in r["caps"]],
                     "wdl": [v[0] for v in verdicts], "verdict": verdict})
        tag = {"proved": "ok  ", "DISPROVED": "FAIL", "unknown": "??  "}[verdict]
        print(f"  {tag} {fen}")
        print(f"       offer {claim['first']}, captures {[c['uci'] for c in r['caps']]} "
              f"-> {[v[0] for v in verdicts]}")

    n = len(cases) or 1
    print(f"\n  PROVED {proved}/{n}   DISPROVED {disproved}/{n}   unknown {unknown}/{n}")
    print("  A DISPROVED row is a false positive with a proof attached, which is the "
          "strongest kind\n  of evidence this project can obtain about a detector.\n")
    if a.out:
        json.dump({"source": a.src, "proved": proved, "disproved": disproved,
                   "unknown": unknown, "rows": rows},
                  open(os.path.join(HERE, a.out), "w"), indent=2)
        print(f"  wrote {a.out}\n")
    return 1 if disproved else 0


if __name__ == "__main__":
    sys.exit(main())
