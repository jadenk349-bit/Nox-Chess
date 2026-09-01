# Completion assessment

Measured against the ten criteria in the final-phase brief. Regenerate with
`python3 tools/depth_report.py`, `python3 tools/validation_ladder.py` and
`python3 tools/corpus_check.py`.

**Verdict: NOT substantially complete.** Six criteria met, two partial, two not.
The blocker has narrowed again and has changed shape: it is no longer depth of
evidence in general, it is NEGATIVE and AMBIGUOUS evidence in particular.

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | All major areas have meaningful depth | **NOT MET** | 2 areas `full`, 13 `substantial`, 70 `partial`. Mean concept completeness 0.71 (was 0.70). |
| 2 | Important concepts have strong recognition criteria | **PARTIAL** | 36 concepts have an implemented Layer 4 matcher naming the record it implements — 36 of the 83 whose own record permits one. The other 54 permitted ones have written criteria and no detector. |
| 3 | Positional concepts tested outside the tactical corpus | **MET** | 18 human-annotated positions from 9 master games, 1908–2005, spanning a century and seven countries; plus 13 replay-verified games and a 350-position quiet sub-corpus. No longer one tournament. |
| 4 | Major concepts have positive and negative testing | **NOT MET** | 55% of applicable concepts lack a positive example, 77% a negative one, 83% an ambiguous one. This is the blocker, and it is the one that does not yield to mining. |
| 5 | False positives aggressively tested | **MET** | 27 resolved cases replayed as regression assertions, plus two annotated negative examples. One of those is a real test — the API declines to report a king attack in a position with every mechanical sign of one — and the other is recorded as **vacuous**, because nothing could have reported it. |
| 6 | API works across tactical and positional positions | **MET** | 788-position mass test: 0 crashes, 0 template leaks, 0 banned phrasings, 100% licensed a concept. 376-assertion behaviour audit over 22 position types. |
| 7 | Explanation quality is high | **PARTIAL** | 3272 assertions pass; no dictionary definitions, meta-remarks, feature dumps, inert features or duplicated concepts. Correct and plain rather than good. |
| 8 | Evidence levels correctly represented | **MET** | Four-tier grading; confidence ceilings by knowledge type, enforced and audited; and the ladder and the corpus checker now both distinguish "not achieved" from "cannot be achieved", derived from the records. |
| 9 | No unresolved high-severity audit findings | **MET** | 0 high across twelve audits. 4 low, each an honest access-caveat flag. |
| 10 | Remaining limitations documented, not hidden | **MET** | This file, `tool_limitations` (14 entries), `failed_research_attempts` (9), per-concept `limitations`, and a measured note on every disagreement with the puzzle generator. |

## Current state

137 concepts · 188 sources · **94 engine-validated positions + 22 tablebase** ·
**18 human-annotated corpus positions from 9 master games** · 20 replay-verified
master games · 644 tests + 246 API + 376 audit + 3276 explanation assertions.

## What moved this session

| | before | after |
|---|---|---|
| human-grounded corpus positions | 6 | 18 |
| corpus games | 2 | 9 |
| corpus roles | 5 positive, 1 ambiguous, 0 negative | 13 positive, 3 ambiguous, 2 negative |
| concepts with human grounding | 31 | 39 |
| concepts with a Layer 4 matcher | 32 | 36 |
| validated positions | 82 | 94 |
| API false negatives on the corpus | 3 of 6 detectable | 0 of 18 |

## What is still missing, precisely

1. **Negative examples: 102 of 132 applicable concepts. Ambiguous: 78 of 94.**
   This is the single largest gap and it does not yield to mining — a search of
   37 quiet master-game positions for cases where a concept's feature is present
   and its holder is worse produced five hits. Negative evidence has to be hunted
   one concept at a time, in annotations, where an author says *this looks like X
   and is not*. Two were found this session and both were worth the search: one
   of them is now the sharpest false-positive test in the repository.
2. **A negative example is worth nothing without a detector that could fail it.**
   Both new negatives initially passed vacuously. Writing the `king-attack`
   matcher turned one into a real test. The `initiative` negative remains vacuous
   and always will, because the concept cannot have a detector — which is itself
   worth knowing and is now printed rather than counted as a pass.
3. **54 concepts whose records permit a detector still have none.** They can be
   explained when a caller names them and cannot be recognised.
4. **The 788 shipped positions cannot validate everything.** Zero of them is a
   pawn ending, so `pawnBreakthrough()` fires on none and the corpus offers no
   evidence at all about its false-positive rate. A pawn-ending corpus is needed.
5. **Layer 5 is plain.** It states what is true, avoids the failure modes it used
   to have, and does not read like a good teacher.
6. **`king-centralisation-with-danger` remains partially resolved.** The phase
   test is material-based and can call a queens-on position an endgame.

## The pattern, still holding

Every fault found in this phase was found by RUNNING the system against something
it had not been built on, and this session added four:

- Six of seven blog-printed move orders reached an illegal move.
- A pawn with no neighbours at all was reported as a **backward pawn**, and led
  the explanation of the corpus's most famous breakthrough.
- The corpus checker scored **negative examples backwards** — a bug that was
  invisible while every entry was positive and live the moment one was not.
- And when that was fixed, both negatives **passed for the wrong reason**.
- Raw attacker counts made the best move in Réti–Capablanca read as a **loss** of
  central control.

Not one was found by reading the code. **Add positions, not prose** — and then
check what the checker is actually measuring.
