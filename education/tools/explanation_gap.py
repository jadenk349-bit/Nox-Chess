#!/usr/bin/env python3
"""Measure what the shipped explanations can and cannot say.

`tools/puzzle_words.js` writes the `why` card on every shipped puzzle, and it is
deliberately disciplined: it never writes a sentence it cannot justify from a
position or a number. That discipline has a measurable consequence — where no
motif is present, the card falls back to comparing evaluations and says nothing
about chess.

This quantifies that. It is the clearest evidence of what the Education System is
actually for, and it is a measurement rather than an assertion.

    python3 tools/explanation_gap.py
"""
import json, os, re
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.dirname(HERE)

# vocabulary findMotifs() and describeBest() can actually produce
MOTIF_WORDS = ["fork", "pinned", "skewer", "hanging", "checkmate", "check",
               "discover", "double check", "back rank", "trapped", "promot",
               "castling", "out of attack"]
# wording that means "I have nothing to say about this move"
FALLBACK_PAT = re.compile(
    r"only leaves|no single tactic|simply the soundest|is the only legal move|forced", re.I)


def main():
    tracks = ("opening", "middlegame", "endgame")
    total = 0
    with_motif = 0
    fallback_only = 0
    by_theme = defaultdict(lambda: [0, 0])
    examples = []

    for t in tracks:
        path = os.path.join(REPO, "puzzles", f"{t}.json")
        if not os.path.exists(path):
            continue
        for p in json.load(open(path)):
            why = p.get("why") or {}
            moves = why.get("moves") or []
            solver = [m for m in moves if m.get("by") == "you"]
            if not solver:
                continue
            text = " ".join(m.get("text", "") for m in solver)
            total += 1
            has = any(w in text.lower() for w in MOTIF_WORDS)
            only_fb = (not has) and bool(FALLBACK_PAT.search(text))
            with_motif += has
            fallback_only += only_fb
            for th in p.get("themes", []):
                by_theme[th][0] += 1
                by_theme[th][1] += has
            if only_fb and len(examples) < 4:
                examples.append((p["id"], t, ", ".join(p.get("themes", [])), text[:150]))

    print(f"{total} puzzles with a solver explanation\n")
    print(f"  name a motif in chess vocabulary : {with_motif:4}  ({100*with_motif//max(total,1)}%)")
    print(f"  fall back to comparing numbers   : {fallback_only:4}  ({100*fallback_only//max(total,1)}%)")
    print()
    print(f"{'theme':22} {'n':>5} {'named':>6} {'%':>5}")
    print("-" * 42)
    for th, (n, named) in sorted(by_theme.items(), key=lambda kv: -kv[1][0]):
        print(f"{th:22} {n:5} {named:6} {100*named//max(n,1):4}%")
    if examples:
        print("\nexamples where the card has no chess content to offer:")
        for pid, track, themes, text in examples:
            print(f"\n  {pid} ({track})  themes: {themes}")
            print(f"    \"{text}\"")


if __name__ == "__main__":
    main()
