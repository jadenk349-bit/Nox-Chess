# Completion assessment

Measured against the ten criteria in the final-phase brief. Regenerate with
`python3 tools/depth_report.py` and `python3 tools/run_tests.py`.

**Verdict: NOT substantially complete.** Six criteria met, two partial, two not.
The blocker has not changed and has narrowed: depth of *evidence* per concept.

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | All major areas have meaningful depth | **NOT MET** | 2 areas `full`, 12 `substantial`, 71 `partial`. Mean concept completeness 0.70 (was 0.61). |
| 2 | Important concepts have strong recognition criteria | **PARTIAL** | 18 concepts have an implemented Layer 4 matcher naming the record it implements. The other 117 have written criteria and no detector. |
| 3 | Positional concepts tested outside the tactical corpus | **MET, narrowly** | 13 master games verified by replay; a 350-position quiet sub-corpus identified mechanically; 194 quiet master-game positions harvested. Narrow in range: most games are from one tournament, Zurich 1953. |
| 4 | Major concepts have positive and negative testing | **NOT MET** | 58% of applicable concepts lack a positive example, 78% a negative one. |
| 5 | False positives aggressively tested | **MET** | 27 resolved cases, 2 partial, 0 pending, replayed as 213 regression assertions. Master games exposed 5 real matcher faults this session. |
| 6 | API works across tactical and positional positions | **MET** | 356-assertion behaviour audit over 22 position types; 788-position mass test with 0 crashes, 0 template leaks, 0 banned phrasings. |
| 7 | Explanation quality is high | **PARTIAL** | 3272 assertions pass; dictionary definitions, meta-remarks, feature dumps and inert features are gone. Correct and plain rather than good. |
| 8 | Evidence levels correctly represented | **MET** | Four-tier grading; confidence ceilings by knowledge type, enforced and audited. |
| 9 | No unresolved high-severity audit findings | **MET** | 0 high across eleven audits. 4 low, each an honest access-caveat flag. |
| 10 | Remaining limitations documented, not hidden | **MET** | This file, `tool_limitations`, `failed_research_attempts`, per-concept `limitations`, and a method note on every harvested example. |

## Current state

135 concepts · 175 sources · **82 engine-validated positions + 22 tablebase** ·
13 verified master games · 1008 indexed warnings · 624 tests + 213 API + 356
audit + 3272 explanation assertions.

## What moved this session

| | before | after |
|---|---|---|
| validated positions | 53 | 82 |
| master games | 3 | 13 |
| mean concept completeness | 0.61 | 0.70 |
| mass-test motif detection | 63.5% | 83.5% |
| agreement with the puzzle generator | 71.1% | 89.0% |
| concepts with no example at all | 90 | 77 |

## What is still missing, precisely

1. **Negative examples: 102 of 130 applicable concepts.** This is now the single
   largest gap and it does not yield to mining. A search of 37 quiet master-game
   positions for cases where a concept's feature is present and its HOLDER is
   worse produced five hits. In master play a feature is usually held by the side
   it helps, so negative evidence has to be constructed or hunted, one concept at
   a time.
2. **Positive examples: 76 of 130.** Most of the remainder are concepts Layer 4
   cannot detect — prophylaxis, planning, transformation of advantages, the
   schools — where an example needs a human judgement and a citation, not a scan.
3. **117 of 135 concepts have no detector.** They can be explained when a caller
   names them and cannot be recognised.
4. **The master-game corpus is narrow.** Thirteen games, most from one tournament
   and one player's era. Broad enough to have broken five matchers; not broad
   enough to be called a corpus.
5. **Layer 5 is plain.** It states what is true, avoids the failure modes it used
   to have, and does not read like a good teacher.
6. **`king-centralisation-with-danger` remains partially resolved.** The phase
   test is material-based and can call a queens-on position an endgame; the fix
   belongs in Layer 4 and has not been made.

## The pattern, still holding

Every fault found in this phase was found by RUNNING the system against something
it had not been built on:

- The mass test's 99.7% "positional coverage" was a metric worth nothing.
- The first API output printed the literal text `{targets}` at a reader.
- Nimzowitsch–Salwe called his blockading bishop bad, then called his own
  position's back rank exposed with no enemy piece able to reach it.
- Reshevsky–Petrosian led with a passed pawn in the position of the most famous
  positional exchange sacrifice ever played.
- Capablanca–Tartakower called a rim knight an outpost.
- The audit's detector check, rewritten to read real source files, found 24
  concepts naming functions that do not exist.
- A game score from a reputable lecture page failed to replay at move 24.

Not one of them was found by reading the code. **Add positions, not prose.**
