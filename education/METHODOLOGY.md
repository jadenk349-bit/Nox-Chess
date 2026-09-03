# Education System — Research & Validation Methodology

This file is the standing procedure. A later session should be able to follow it
without re-deriving how the work is done.

## 1. Two tools, two different jobs

**Exa** — semantic search. Used to *discover*: obscure concepts, historical
terminology, primary texts, the name of an idea we can describe but cannot name,
and further authoritative sources. Exa's `web_fetch_exa` reads a page once we
know we want it.

**Tavily** — independent confirmation and bulk retrieval. `tvly search` for a
second, unrelated result set; `tvly extract` for clean page text; `tvly crawl`
for a documentation-shaped resource; `tvly research` for a cited multi-source
report on a hard sub-question.

They are run as *independent* passes, not as a chain. When both converge on a
claim, that is evidence. When they diverge, that divergence is recorded rather
than resolved by preferring whichever is more convenient.

Concretely, on the pilot concept the two disagreed usefully: Exa surfaced the
publisher PDFs and the Soviet transmission chain, Tavily surfaced the editorial
interview that settled what Nimzowitsch actually called the idea.

## 2. Source confidence

| Confidence | What qualifies |
|---|---|
| high | Primary text; official governing-body rule; a book by a titled player or recognised trainer; a publisher's own excerpt |
| medium | Named-author article on an established site; encyclopedia; a page that carries and cites primary annotations |
| low | Unsourced blog, forum post, anonymous or AI-written page, trade-press analogy piece |

Low-confidence sources are **recorded, not discarded**. Knowing that a false
attribution is circulating is itself useful, and it stops a later session from
"rediscovering" it as new evidence.

A concept may not be marked `source_confidence: high` on one source, however
authoritative — `validate_kb.py` warns on that.

## 3. Getting to a primary text

Secondary sources repeat each other. Where a claim is historical — who
formulated a concept, what they called it, what they actually wrote — the
procedure is to reach the primary text and read the passage.

The pilot concept shows why. Every secondary source said "Nimzowitsch formulated
the principle of two weaknesses in *My System* (1925)". Fetching the full text
showed the concept is genuinely there but under a different name entirely
("manoeuvring", "tacking"), and that the phrase *principle of two weaknesses*
comes from a different, later tradition. Both halves of the received claim were
half-right, and only the primary text could show which half.

When the primary text cannot be reached, `origin.certainty` says `probable`,
`disputed` or `unknown`, and `origin.notes` records what was checked.

## 4. Engine validation

Stockfish answers exactly one question: **does this move actually work in this
position?** It is never asked what a concept is called, and its evaluations are
never converted into human terminology.

Procedure for a concept that can be position-tested:

1. Collect real examples from the sources, with citation.
2. Construct additional examples where a *controlled* comparison is possible —
   the same position with and without the feature the concept names. This is the
   strongest available evidence, because it isolates the concept from everything
   else on the board.
3. Analyse at a depth appropriate to the material (28+ for middlegames, 34+ for
   simplified endings).
4. Record eval, best move, and the ranked alternatives — not just the verdict.
5. Test where the principle *fails*, not only where it works.
6. Set `engine.verdict` to `supports`, `contradicts`, `ambiguous`, or `untested`,
   with a note saying what the numbers actually showed.

**A move being best is not evidence that a concept applies.** The board features
the concept names must be present, and the reason the move is best must be the
reason the concept gives. A move that happens to be best for an unrelated
tactical reason is a false match and is logged as one.

### Best-move agreement is NOT evidence that a concept applies

This was established experimentally, and it is the single most important constraint on how the
runtime may attach concepts to moves.

A controlled pair was built for the pin: `r3k2r/ppp2ppp/2n5/1B6/3P4/2N5/PPP2PPP/R3K2R w KQkq`
(Bb5 pins Nc6 absolutely against Ke8) against the identical position with the black king castled
to g8, so no pin exists. `python-chess` `is_pinned` confirms True and False respectively — the
positions differ in exactly one variable.

```
pin present:  d4-d5  +7.26   best, 1.57 clear of the runner-up
pin absent:   d4-d5  +5.40   STILL BEST, but only 0.28 clear
```

The move d4-d5 is the engine's first choice **in both positions**. A system that tested "did the
engine pick this move?" would report a pin in the position that has none. What actually changed
was the *margin over the alternatives* (1.57 vs 0.28) and the eval delta between the paired
positions (1.86).

Three rules follow:

1. Never infer a concept from engine agreement. The board features that define the concept must
   be independently detected, and for the pin that means checking the alignment and the king
   square, not the evaluation.
2. Where a numeric signal is wanted, use the **margin over the next-best move**, not the rank of
   the move. A move that is best by 0.28 is not being driven by a named idea.
3. Where possible, verify with a controlled pair rather than a single position. A single position
   cannot distinguish "the concept caused this" from "this was best anyway".

Contrast the fork, where the same test gives an unambiguous answer: with the forking square
unguarded Nc7+ is +7.39 and best; with a bishop guarding it, the identical move is +0.57 and
ranked last — a 6.82 swing on one defender. And the back rank, where a single tempo of luft
(h7-h6) converts mate in 1 into mate in 30. Some concepts separate cleanly under this test and
some do not, and which is which has to be measured rather than assumed.

### The controlled-pair technique

The most reliable validation found so far. Build two positions differing only in
the feature under test. Pilot example:

```
8/8/3k1pp1/8/P2K4/5PP1/8/8 b    with a distant second target  -> mate in 23
8/8/3k1pp1/8/3K4/5PP1/8/8  b    identical but for that pawn   -> 0.00, dead draw
```

Same kings, same kingside structure, same side to move. That is the principle of
two weaknesses demonstrated rather than asserted, and it is reproducible by
anyone with the FEN.

## 5. Recording disagreement

Where authorities disagree, the record keeps the disagreement and, where an
engine can settle it, says who was right about what.

Pilot example: Capablanca annotated 43...Nb4 as a trap Black must avoid; Hugh
Myers argued Black wins anyway. Stockfish 18 shows Capablanca's concrete line is
a dead draw (0.00) — so the trap is real — while Myers is right that Black can
deviate and win, and that neither annotator noticed 43...Nb4 is objectively
*stronger* than the move played. All three findings are recorded. None is
flattened into a verdict.

## 6. Heuristic vs law

Every concept gets an `epistemic_type` (see ARCHITECTURE.md). The distinction is
enforced in wording, not left to the explanation writer's judgement: types F, G
and H carry a mandatory `explanation_templates.hedge`, and their exceptions are a
required part of the record rather than an optional extra.

Where a respected source states a heuristic as an absolute and the engine
disagrees, both are recorded. Pilot example: Shereshevsky wrote that a certain
position "would be drawn" with the kings placed differently; the engine puts it
at +0.75 rather than 0.00. His *mechanism* is confirmed and large — it costs the
attacker over half the advantage — but the absolute claim is not. The concept
stores the mechanism as sound and the absolute as overstated.

## 7. Iterative discovery

When a source names a concept not yet in the base:

1. Append it to `state/research-state.json` -> `discovered_concepts_unresearched`.
2. Search the name on its own, then its alternate and historical names.
3. Establish origin where possible.
4. Find examples, then counterexamples.
5. Determine how modern theory regards it — some classical rules are now
   considered wrong, and that is part of the record, not a reason to omit it.
6. Work out how it could be recognised from a position, and whether that
   recognition is `mechanical`, `heuristic`, or `human-only`.

Different names are not assumed to be different concepts; merging is recorded in
`alternate_names` with the source that attests each.

## 8. Definition of done

A concept is `validated` only when its `state/coverage.json` row has every
applicable box ticked, including at least one engine-tested positive example and
one negative or exception case. Concepts that cannot be engine-tested (most of
`rules-terminology`, `history-schools`, `blindfold`) are marked
`engine_testable: false` with a reason, and are exempt from those rows only.

Reading about a concept is never sufficient to call it validated.
