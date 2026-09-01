# Completion assessment

Measured against the ten criteria in the final-phase brief. Regenerate with
`python3 tools/depth_report.py`, `python3 tools/validation_ladder.py` and
`python3 tools/corpus_check.py`.

**Verdict: NOT substantially complete.** Six criteria met, two partial, two not.
The blocker has narrowed again and has changed shape twice. It is no longer
depth of evidence in general; it is NEGATIVE and AMBIGUOUS evidence in
particular — and within that, the sharpest cases turn out not to be about
*detection* at all. Two of the newest corpus entries are recorded FAILURES where
everything the system reports is true and the fault is in the weight and the
ranking. Nothing here should be read as saying the system is nearly finished.

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | All major areas have meaningful depth | **NOT MET** | 2 areas `full`, 13 `substantial`, 70 `partial`. Mean concept completeness 0.71 (was 0.70). |
| 2 | Important concepts have strong recognition criteria | **PARTIAL** | 53 of the 83 concepts whose own record permits a detector have one, up from 32. But *having* a matcher is not the standard: `state/TRAPS.md` measures every matcher against the false-positive traps its record states, and **34 of 108 traps have never been written about either way**. Eight defects have been found by reading that list; the rest of it is the honest size of what is unchecked. |
| 3 | Positional concepts tested outside the tactical corpus | **MET** | 38 human-annotated positions from 25 master games, 1908–2005, spanning a century and seven countries; plus 13 replay-verified games and a 350-position quiet sub-corpus. No longer one tournament. |
| 4 | Major concepts have positive and negative testing | **NOT MET** | 55% of applicable concepts lack a positive example, 77% a negative one, 81% an ambiguous one. This is the blocker, and it is the one that does not yield to mining. |
| 5 | False positives aggressively tested | **MET** | Seven annotated negative examples, six of them live rather than vacuous, plus 27 resolved cases replayed as assertions. The system declines to report an outpost on a square a world champion twice calls unsafe; declines a king attack in a position with every mechanical sign of one; and declines the hole on d5 in Unzicker–Fischer 1962 and Shirov–Kramnik 2000, which Markos built as traps for exactly the reading a mechanical detector performs — "a keyhole with no fitting key", "a no man's land: neither side can make any use of it". One negative is recorded as **vacuous** because nothing could ever have reported it, which is printed rather than counted as a pass. Eight matchers have been tightened against conditions their own records state and had never implemented. |
| 6 | API works across tactical and positional positions | **MET** | 788-position mass test: 0 crashes, 0 template leaks, 0 banned phrasings, 100% licensed a concept. 374-assertion behaviour audit over 22 position types. Firing rates are now measured on **three** denominators (`tools/firing_rates.js`, plain / `--quiet` / `--corpus`), because they disagree and the disagreement is a finding. |
| 7 | Explanation quality is high | **PARTIAL** | 3574 assertions pass; no dictionary definitions, meta-remarks, feature dumps, inert features or duplicated concepts. The `level` parameter now reaches a reader — it never had — and the wording varies by level on 99.3% of the 788 shipped positions. Several sentences now carry the *other half* of what their record says rather than the bare feature: a passer says whether it can advance, a doubled pair says what compensates it, opposite bishops stop being "drawish" while the queens are on. Still correct and plain rather than good. |
| 8 | Evidence levels correctly represented | **MET** | Four-tier grading; confidence ceilings by knowledge type, enforced and audited; and the ladder and the corpus checker now both distinguish "not achieved" from "cannot be achieved", derived from the records. |
| 9 | No unresolved high-severity audit findings | **MET** | 0 high across twelve audits. 4 low, each an honest access-caveat flag. |
| 10 | Remaining limitations documented, not hidden | **MET** | This file, `state/TRAPS.md`, `tool_limitations` (14 entries), `failed_research_attempts` (9), per-concept `limitations`, and **two recorded failures kept failing on purpose** rather than engineered around. |

## Current state

137 concepts · 202 sources · **111 engine-validated positions + 22 tablebase** ·
**38 human-annotated corpus positions from 25 master games** · 32 replay-verified
master games · 661 tests + 397 API + 374 audit + 3574 explanation assertions.

Ladder: researched 137, human-grounded 29, engine-verified 54, negative-tested
32, ambiguity-tested 24, api-validated 53 of the 83 whose record allows it,
explanation-validated 105. Every rung its record allows: **11 of 137.**

## What moved this session

| | before | after |
|---|---|---|
| human-grounded corpus positions | 6 | 38 |
| corpus games | 2 | 25 |
| corpus roles | 5 positive, 1 ambiguous, 0 negative | 18 positive, 13 ambiguous, 7 negative |
| concepts with human grounding (twice-corrected measure) | 5 | 29 |
| concepts with a Layer 4 matcher | 32 | 36 |
| validated positions | 82 | 111 |
| API false negatives on the corpus | 3 of 6 detectable | 1 of 38, recorded on purpose |
| rank of the annotated concept | not measured | mean **2.2**, top-three on 11 of 12 |
| confidence overclaims | not measured | 1 of 38, recorded on purpose |
| matchers implementing their record's *traps* | not measured | 74 of 108 traps cited, 34 unread |
| matchers firing on more than half of all positions | 5 | 1 (`passed-pawn`, deliberately) |

## A number that got worse on purpose, twice

The ladder's HUMAN-GROUNDED rung said 39 of 137 and its own definition said "an
annotated master position, not a mined one". The implementation accepted any
position carrying a named game, so 22 of those 39 were grounded only on
positions this system found by running its own Layer 4 over master games — real
positions whose own records already said they "cannot by itself validate the
matcher that found it". Requiring an `attributed_by` took it to 23.

Checked a second time, it was still counting corpus **membership** — and the
corpus's `annotator` field is prose, so an entry reading "unattributed training
page" counted exactly like Nimzowitsch annotating his own game. `attributed_by`
is now the field there too: 29 → 26. Three of the losses were then recovered
honestly, by finding named annotators for Fischer–Spassky 1972 game 6 rather
than by relaxing the rule. It reads **29**.

The same thing happened to the trap audit within an hour of its being written:
adding a second file to search took "unread" from 75 to 10 at a stroke, which is
what a metric flattering itself looks like. The test was changed from keyword
overlap to **quotation**, and it reads 34.

## Two error classes that were never measured

Reporting a concept and burying it were scored the same until this session. The
corpus now measures **rank**: for a positive entry the annotated concept is what
a human said the position is about, so where it sits in the reported list is a
number. It was **4.9**, and on six of twelve positive entries the concept sat
outside the six the API returns by default — reported, and invisible. After
reordering PRIORITY by measured firing rate, confining the low-confidence rule
to the lead alone, and then fixing the *recognition* of the one concept the
ordering could not accommodate, it is **2.2**, and the concept is in the top three on 11 of 12.

**Confidence** is measured too: the system may say less than the annotator and
never more. 1 of 38 overclaims, and it is left standing: Ftacnik–Roiz 2009,
where White really does hold the two bishops, Markos writes "please note how
idle White's bishops are", and Stockfish scores the position at −2.66 for him.
Nothing the system says there is false; only the weight is wrong. That is the
first entry in this corpus scored on weighting rather than on detection.

## What is still missing, precisely

1. **Negative examples: 101 of 132 applicable concepts. Ambiguous: 74 of 94.**
   This is the single largest gap and it does not yield to mining — a search of
   37 quiet master-game positions for cases where a concept's feature is present
   and its holder is worse produced five hits. Negative evidence has to be hunted
   one concept at a time, in annotations, where an author says *this looks like X
   and is not*. Two were found this session and both were worth the search: one
   of them is now the sharpest false-positive test in the repository.
2. **A negative example is worth nothing without a detector that could fail it.**
   The first two new negatives passed vacuously. Writing the `king-attack`
   matcher turned one into a real test. The `initiative` negative remains vacuous
   and always will, because the concept cannot have a detector — which is itself
   worth knowing and is now printed rather than counted as a pass.
3. **30 concepts whose records permit a detector still have none**, and about half of those are vocabulary rather than position features. They can be
   explained when a caller names them and cannot be recognised. One more was
   written and thrown away: `strong-square`, exactly to its record's two stated
   preconditions, fires on 80.1% of the 788 shipped positions and is a third
   name for a fact already reported twice.
4. **The 788 shipped positions cannot validate everything.** Zero of them is a
   pawn ending, so `pawnBreakthrough()` fires on none and the corpus offers no
   evidence at all about its false-positive rate. A pawn-ending corpus is needed.
5. **Layer 5 is plain.** It states what is true, avoids the failure modes it used
   to have, and does not read like a good teacher.
6. **`king-centralisation-with-danger` remains partially resolved.** The phase
   test is material-based and can call a queens-on position an endgame.
7. **34 of 108 stated traps have never been read against their matcher.**
   `state/TRAPS.md` is the list. Eight defects have come out of the 74 that have
   been read, at a rate that has not yet fallen, so the honest expectation is
   that more are in the remaining 34.
8. **The sharpest failures are no longer about detection.** Two corpus entries
   are recorded failures in which every reported concept is *true*: Réti–
   Capablanca 1924, where the annotation is about one piece and the measure is
   army-level, and Ftacnik–Roiz 2009, where a grandmaster's whole point is that
   the bishop pair is worth nothing and this base can only say that it exists.
   Neither yields to a guard, and inventing one would be fitting a rule to a
   case.

## The pattern, still holding

Every fault found in this phase was found by RUNNING the system against something
it had not been built on — or by asking what a metric was actually counting:

- Six of seven blog-printed move orders reached an illegal move.
- A pawn with no neighbours at all was reported as a **backward pawn**, and led
  the explanation of the corpus's most famous breakthrough.
- The corpus checker scored **negative examples backwards** — a bug that was
  invisible while every entry was positive and live the moment one was not.
- And when that was fixed, both negatives **passed for the wrong reason**.
- Raw attacker counts made the best move in Réti–Capablanca read as a **loss** of
  central control.
- The ladder's **human-grounded rung counted this system's own mining** as human
  grounding, and read 39 where the honest number was 17 — and then, checked a
  second time, was still counting corpus *membership*, where one entry's
  annotation reads "unattributed training page". 29 → **26**. Twice asked, twice
  lower.
- A concept's own recorded **exception lived in the record and in none of the
  wording a reader sees**: this base said "opposite bishops are drawish in
  endgames" about an ending Stockfish scores at −5.06.
- Three corpus entries listed a **true** concept as one the annotator rejected,
  manufacturing false positives out of correct output. The fix is always to the
  entry.
- The API's **`level` parameter had never done anything**. Four texts on each of
  137 records, written for four readers, unreachable because `by_depth` was
  tried first and every record has all three. Found by asking why one position
  printed the same sentence at all four levels.

- **Eight matchers implemented a record's bare precondition and ignored the
  conditions written underneath it.** `two-weaknesses` 72.5% → 38.6%,
  `weak-square` 68.9% → 40.5%, `open-file` 55.7% → 35.5%, `space` 53.3% → 34.6%,
  `piece-activity` 44.4% → 33.9%, `material-imbalance` 42.1% → 35.5%,
  `rook-on-the-seventh` 12.8% → 10.7%, and `bishop-pair`, whose answer was to
  qualify rather than to refuse. Reading the record against the matcher is now a
  tool and a checked-in list.
- **A rarity ranking was read off the wrong denominator.** `luft` measures 4.8%
  on the shipped puzzles and 48.6% on annotated master positions, and was the
  most frequent *lead* in the corpus — a piece of terminology at the head of
  explanations of Réti and Capablanca.
- **`material-imbalance` contradicted the piece values its own record leads
  with**, calling a knight-for-bishop swap an imbalance where Kaufman puts both
  at 3.5.

Not one was found by reading the code for its own sake. **Add positions, not
prose; read each record against its matcher; and check what the checker is
actually measuring** — three of this session's findings were metrics flattering
themselves, and every one of them went down when asked twice.
