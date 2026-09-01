# Completion assessment

Measured against the ten criteria in the final-phase brief. Regenerate the
numbers with `python3 tools/depth_report.py` and `python3 tools/run_tests.py`.

**Verdict: NOT substantially complete.** Five criteria met, three partially met,
two not met. The blocker is a single thing — depth of *evidence*, not depth of
research.

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | All major areas have meaningful depth | **NOT MET** | 2 areas `full`, 11 `substantial`, 72 `partial`. Mean concept completeness 0.66. |
| 2 | Important concepts have strong recognition criteria | **PARTIAL** | 18 concepts have an implemented Layer 4 matcher naming the record it implements. The rest have written criteria and no detector. |
| 3 | Positional concepts tested outside the tactical corpus | **PARTIAL** | 3 master games verified by replay, covering 8 concepts. Real, and narrow. |
| 4 | Major concepts have positive and negative testing | **NOT MET** | 78% of applicable concepts lack a positive example, 81% a negative one. |
| 5 | False positives aggressively tested | **MET** | 15 resolved cases, 2 partial, 0 pending. Testing against master games found 4 real faults. |
| 6 | API works across tactical and positional positions | **MET** | 365-assertion audit over 22 position types; 788-position mass test with 0 crashes, 0 template leaks, 0 banned phrasings. |
| 7 | Explanation quality is high | **PARTIAL** | 3384 assertions pass. Dictionary definitions, meta-remarks and feature dumps are gone. The prose is correct and plain rather than good. |
| 8 | Evidence levels correctly represented | **MET** | Four-tier grading in the warnings index; confidence ceilings by knowledge type, enforced and audited. |
| 9 | No unresolved high-severity audit findings | **MET** | 0 high across all eleven audits. 4 low, each an honest access-caveat flag on a source with a stated access problem. |
| 10 | Remaining limitations documented, not hidden | **MET** | This file, `tool_limitations`, `failed_research_attempts`, and per-concept `limitations`. |

## What is actually finished

- **Breadth.** All 85 taxonomy areas carry researched concepts. 135 concepts,
  172 sources, 1008 indexed warnings.
- **The system.** Layers 3, 4 and 5 exist, and the API's four refusals are
  enforced and tested rather than documented. Terminology invariance under an
  engine result is verified: the same position with no engine, a normal engine
  result and an absurd one (-30.00) produces byte-identical concept lists.
- **Honesty machinery.** Evidence tiers, confidence ceilings, name-status,
  attribution relations with confidences, competing claims recorded side by
  side, and an audit that verifies detector claims against real source files.

## What is not

**The evidence gap is the whole of it.** 129 board-level concepts; 53 validated
positions. Reaching high completeness needs several hundred more, each requiring
a judgement about whether the concept explains anything in that position — which
is the one step that cannot be automated, because automating it would be exactly
the "label the engine's move with a principle" failure this project exists to
avoid.

Specific, named gaps:

1. **No quiet-position corpus.** Mass testing runs on 788 tactical puzzles
   because that is what this repository has. The positional half most needs
   judging on quiet middlegames.
2. **Master games are three.** Verified by replay, which is the right method, and
   three games is not a corpus. Each new one is manual research plus a replay.
3. **Most concepts have no detector.** 18 of 135 are matched mechanically. The
   rest can be explained when named by a caller but not recognised.
4. **Layer 5 is plain.** It states what is true and does not read like a good
   teacher. That is a deliberate floor, not a ceiling.
5. **`king-centralisation-with-danger` is only partially resolved.** The matcher's
   phase test is material-based and can call a queens-on position an endgame; the
   fix belongs in Layer 4 and has not been made.
6. **Historical research is English-language and largely second-hand.** Several
   primary texts were read through summaries, and every such source note says so.

## The pattern worth carrying forward

Every fault this phase found was found by *running* the system against something
it had not been built on, never by reading it:

- The first mass test reported 99.7% positional coverage, which was a metric
  worth nothing — three matchers were firing on nearly every position.
- The first API output printed the literal text `{targets}` at a reader.
- Testing against Nimzowitsch–Salwe called his blockading bishop bad, and against
  Capablanca–Tartakower called a rim knight an outpost and a rook-ending pawn an
  isolated queen's pawn.
- Rewriting the audit's detector check against real source files exposed 24
  concepts naming functions that do not exist.
- A game score from a reputable lecture page failed to replay at move 24.

The corollary for whoever continues: add positions, not prose.
