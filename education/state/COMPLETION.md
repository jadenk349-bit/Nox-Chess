# Completion assessment

Measured against the ten criteria in the final-phase brief. Regenerate with
`python3 tools/depth_report.py`, `python3 tools/validation_ladder.py` and
`python3 tools/corpus_check.py`.

**Verdict: NOT substantially complete.** Six criteria met, two partial, two not.
The gap is now a single quantity with a name: **ambiguous examples**, 35 of the
94 concepts that can carry one. Positive examples are at 23% missing and
negative at 33%, both roughly halved since the last assessment; the ambiguous
leg has moved least because it is the one that cannot be mined. An ambiguous
example is a position where the concept is genuinely present and what to
conclude from it is unclear, and forty of the fifty-four remaining belong to
concepts with no matcher at all, so no tool can nominate one — each has to be
built and settled by hand.
The blocker has narrowed again and has changed shape twice. It is no longer
depth of evidence in general; it is NEGATIVE and AMBIGUOUS evidence in
particular — and within that, the sharpest cases turn out not to be about
*detection* at all. THREE corpus entries are recorded FAILURES kept failing on purpose, and in two
of them everything the system reports is true — the fault is in the weight and
the ranking. Nothing here should be read as saying the system is nearly
finished.

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | All major areas have meaningful depth | **NOT MET** | 5 areas `full`, 11 `substantial`, 69 `partial`. Mean concept completeness 0.85 (was 0.71). **The rating is partly measuring the taxonomy rather than the depth, and that is now printed rather than argued about**: 69 of the 85 areas contain exactly ONE concept, and the rule needs two for `substantial` and three for `full`, so those 69 cannot rise however complete the record is — `two-weaknesses` scores 1.00 and is rated the same word as an area scoring 0.45. `rate_solo()` in `tools/depth_report.py` rates a one-concept area by its one concept at a HIGHER bar (0.85 for `full` against 0.75 for a mean of three) and gives 30 full, 41 substantial, 14 partial. **This criterion is judged on the original rule and stays NOT MET.** The second reading exists so the artefact is visible, not so it can be spent. |
| 2 | Important concepts have strong recognition criteria | **PARTIAL** | 53 of the 83 concepts whose own record permits a detector have one, up from 32. But *having* a matcher is not the standard: `state/TRAPS.md` measures every matcher against every condition its record states — `false_positive_traps` **and** `indicators_against`, which is where half of them live and which the list did not read at all until a position exposed it. **275 conditions: 142 enforced in the matcher, 19 in Layer 3, 75 argued on a record, 39 unread.** The denominator grew by 29 and the unread count by 27 in the same pass, and that is the finding: the nine MOTIF concepts — `fork`, `pin`, `skewer`, `trapped-piece`, `discovered-attack`, `back-rank-mate`, `double-check`, `checkmate`, `hanging-piece` — were absent from this list entirely, because they arrive as tags from `findMotifs()` and have no entry in either matcher table. Every condition their records state was counted nowhere. Two of them were live false positives at HIGH confidence. The audit has a THIRD blind spot beyond the two already named, and it is the page: `findMotifs()` lives in `blind-chess.html` and the audit reads only `lib/matchers.js` and `lib/features.js`, so eight conditions honoured inside that function read as unread. Reading it directly settled all eight — four of `hanging-piece`'s by two lines of SEE, `fork`'s target test, `pin`'s pin-versus-skewer branch — and three whole records (`castling`, `smothered-mate`, `back-rank-mate`) turn out to state conditions that are UNREACHABLE rather than unguarded, because the detector only speaks when the move generator says mate. Twenty-eight defects have now come out of the reading, including two in Layer 3 that had been true of every measurement in the project, and four `implements` strings that claimed something the code does not do. |
| 3 | Positional concepts tested outside the tactical corpus | **MET** | 42 human-annotated positions from 28 master games, 1908–2005, spanning a century and seven countries; plus 13 replay-verified games and a quiet sub-corpus that is 98 positions rather than the 350 once claimed — `quietness()` had never tested the half of its own definition about winning captures. No longer one tournament. |
| 4 | Major concepts have positive and negative testing | **NOT MET** | 23% of applicable concepts lack a positive example, 33% a negative one, 37% an ambiguous one. **The ambiguous leg is the whole of the gap.** The ambiguous half is the blocker on its own, and `tools/mine_ambiguous.js` now exists to attack it — it writes the arm `tools/prospect.js` promised in its own header and never implemented, which was the same shape of defect as an `implements` string claiming what the code does not do. It nominates on three machine-checkable grounds (the concept fires for BOTH sides; it fires for the side that is DOWN material; it fires in a quiet position) and settles nothing: a candidate is a question, and the engine answers it. The negative half moved because the 20 registered false-positive cases written this session were promoted onto the records themselves, with the engine or tablebase evidence that settled each one — a concept's negative evidence belongs on the concept, not only in a test file. This is the blocker. The rules layer is now done properly — seven concepts carry **controlled pairs**, the same position with one thing changed, both halves in the base and every pair settled by Syzygy rather than argued — and building them exposed that `checkmate` could not be recognised in a position at all. The endgame-theory concepts are done the same way, including the strictest pair there is — the same board with only the side to move changed, which serves `zugzwang`, `key-square` and `opposition` at once. The positional concepts are the remainder and they do not yield to mining. |
| 5 | False positives aggressively tested | **MET** | Ten annotated negative examples, eight of them live rather than vacuous and **one failing on purpose**, plus 92 resolved cases replayed as assertions and one left OPEN on purpose, 64 of them written this pass and five of those found in the shipped corpus rather than constructed — and they are now replayed WITH their move, which twenty of them have and none of them used to get — an even rook trade reported as a 500-point sacrifice, a pawn 'fork' the tablebase says loses, and a pin the pinned rook dissolves by capture. The system declines to report an outpost on a square a world champion twice calls unsafe; declines a king attack in a position with every mechanical sign of one; and declines the hole on d5 in Unzicker–Fischer 1962 and Shirov–Kramnik 2000, which Markos built as traps for exactly the reading a mechanical detector performs — "a keyhole with no fitting key", "a no man's land: neither side can make any use of it". One negative is recorded as **vacuous** because nothing could ever have reported it, which is printed rather than counted as a pass. Sixteen matchers have been tightened or corrected against conditions their own records state, and one negative — Anand–Leko 2009 — grades its own evidence down in writing, because there the raw feature is absent too and nothing had to be refused. |
| 6 | API works across tactical and positional positions | **MET** | 788-position mass test: 0 crashes, 0 template leaks, 0 banned phrasings, 100% licensed a concept. 374-assertion behaviour audit over 22 position types. Firing rates are now measured on **three** denominators (`tools/firing_rates.js`, plain / `--quiet` / `--corpus`), because they disagree and the disagreement is a finding. |
| 7 | Explanation quality is high | **PARTIAL** | 3570 assertions pass; no dictionary definitions, meta-remarks, feature dumps, inert features or duplicated concepts. The `level` parameter now reaches a reader — it never had — and the wording varies by level on 99.3% of the 788 shipped positions. **Nine sentences now carry the *other half* of what their record says** rather than the bare feature, because nine times a guard was written, measured, found to delete a canonical position, and replaced by a clause: a passer says whether it can advance and whether it is itself under fire; a doubled pair says what compensates it, which outpost it holds and which king it shields; opposite bishops stop being "drawish" while the queens are on and name pawn *separation* as the deciding variable; a rook on the seventh says whether it is the ABSOLUTE or the RELATIVE one; a battery says when it is built the expensive way round. Still correct and plain rather than good, but no longer bare. |
| 8 | Evidence levels correctly represented | **MET** | Four-tier grading; **two** confidence ceilings enforced — by knowledge type and by each record's own `typical_confidence`, which nothing was reading until twelve concepts were found reporting above their own record; and the ladder and the corpus checker both distinguish "not achieved" from "cannot be achieved", derived from the records. |
| 9 | No unresolved high-severity audit findings | **MET** | 0 high across twelve audits. 4 low, each an honest access-caveat flag. The three size findings raised last pass are gone because the records were written, not because the threshold moved — `desperado` gained a position found by scanning the shipped corpus, and `clearance` and `decoy` gained the account of why theirs could not be built. The two size findings raised last pass are gone because the records were filled in rather than because the threshold moved: `strong-square` gained a controlled pair whose negative half the engine answers by playing e3-e4, and `queen-activity` gained the Keene annotation its own limitations had already named. |
| 10 | Remaining limitations documented, not hidden | **MET** | This file, `state/TRAPS.md`, `tool_limitations` (14 entries), `failed_research_attempts` (9), per-concept `limitations`, and **three recorded failures kept failing on purpose** rather than engineered around — plus a negative that grades its own evidence down in writing. |

## Current state

137 concepts · 205 sources · **212 engine-validated positions + 60 tablebase-proven, of 343 in the base** ·
**42 human-annotated corpus positions from 28 master games** · 32 replay-verified
master games · 877 tests + 741 API + 374 audit + 3570 explanation assertions.

Ladder: researched 137, human-grounded 43, engine-verified 101, negative-tested
71, ambiguity-tested 41, api-validated 53 of the 83 whose record allows it,
explanation-validated 105. Every rung its record allows: **26 of 137.**

## What moved this session

| | before | after |
|---|---|---|
| human-grounded corpus positions | 6 | 42 |
| corpus games | 2 | 28 |
| corpus roles | 5 positive, 1 ambiguous, 0 negative | 19 positive, 13 ambiguous, 10 negative |
| concepts with human grounding (twice-corrected measure) | 5 | 43 |
| concepts with a Layer 4 matcher | 32 | 36 |
| positions carrying an engine reading | 82 | 212 |
| positions carrying a tablebase PROOF | 22 | 60 |
| API false negatives on the corpus | 3 of 6 detectable | 1 of 38, recorded on purpose |
| rank of the annotated concept | not measured | mean **2.3**, top-three on 11 of 13 |
| confidence overclaims | not measured | 1 of 38, recorded on purpose |
| matchers implementing their record's *traps* | not measured | 236 of 275 stated conditions read, 39 unread |
| registered false-positive cases | 29 | 92 resolved + 1 open on purpose |
| concepts with a positive example | 68 of 132 | 101 of 132 |
| concepts with a negative example | 56 of 132 | 88 of 132 |
| concepts with an ambiguous example | 20 of 94 | 59 of 94 |
| mean concept completeness | 0.70 | **0.85** |
| matchers firing on more than half of all positions | 5 | 1 (`passed-pawn`, deliberately) |

## What the last stretch was actually made of

Every number above moved because of one activity: reading each record's stated
conditions against the code that is supposed to honour them, and then either
building the condition, arguing on the record that it cannot be built, or
saying it in the sentence. Nine more defects came out of it after the
twenty-eight already recorded:

1. **`fork`, `pin` and `skewer` reported at HIGH confidence on geometry their
   own records refuse.** A pawn "fork" the tablebase says loses; a "pin" the
   pinned rook dissolves by capture; a "skewer" the front unit eats. All three
   conditions were written on the records and none was built.
2. **`sacrifice` called an even rook trade a 500-point sacrifice.** The page's
   `sacrificeSize()` answers "how much can the opponent take on that square",
   which is right for Bxh7+ and wrong for RxR because it says nothing about the
   rook the move just won. 26.5% → 16.6%.
3. **`insufficient-material` was widened past its own definition** — it reported
   on knight against knight and on bishops of opposite colours, neither of which
   is in the convention the record's own definition_long names.
4. **`trapped-piece` and `discovered-attack` were wrong on shipped puzzles**, 8
   and 33 of the 788 respectively, found by scanning rather than by inventing a
   position. One of them is refuted by its own puzzle's solution line.
5. **`worst-placed-piece` recommended a move that allows mate in one.**
6. **`back-rank-mate` told the reader a defended back rank was undefended** —
   one wording level asserting flat what the detector said conditionally.
7. **A limitation written earlier the same day was wrong**, attributing
   `back-rank-mate`'s guards to the `mate` tag's test rather than to the
   separate `backRank` block. The conclusion held; the argument did not.
8. **Nineteen duplicate positions** accumulated because a promotion script
   checked `move` where the records store `move_uci`. The suite count fell by
   fifteen when they were removed.
9. **`tempo`'s record claimed a registered false-positive case that did not
   exist.** There is a test for that now.

Two tools grew an arm they had promised and never had: `tools/mine_ambiguous.js`
writes the ambiguous prospector `tools/prospect.js` describes in its own header,
and it then had to learn to supply a MOVE, because twelve concepts only speak
when given one and had been reporting NONE.

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

**False positives are measured against the corpus, and there is one.**
Karpov–Polgar 2001 is the first entry whose concept is not merely reported but
*leads*: Black's rook on the absolute seventh, in a position Stockfish scores at
+0.83 for the defender, whose king it is supposedly trapping. The condition that
would refuse it is on the record and is not decidable at one ply, and building it
costs the corpus's own positive instance of the same concept. Kept failing.

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
4. **CLOSED, and it cost the concept its strongest claim.** Zero of the 788 is a
   pawn ending, so `pawnBreakthrough()` had never been run against anything.
   `tools/pawn_endings.js` now generates them and `tools/verify_breakthrough.py`
   checks each claim against Syzygy, where a seven-man pawn ending is *decided*.
   Two real bugs fell out — a breakthrough claimed for the side not to move, and
   a rule of the square applied to three enemy passers and one king — and one
   thing that is not a bug: the rule of the square is **not a proof** in a
   multi-pawn ending. 22 of 24 tablebase-decidable claims are right, the detector
   reports at medium instead of high, and nothing calls it a proof any more.
5. **Layer 5 is plain.** It states what is true, avoids the failure modes it used
   to have, and does not read like a good teacher.
6. **`king-centralisation-with-danger` remains partially resolved.** The phase
   test is material-based and can call a queens-on position an endgame.
7. **123 of 246 stated conditions have never been read against their matcher.**
   `state/TRAPS.md` reached "0 unread" and then turned out to be reading half
   the list: it looked only at `false_positive_traps`, and half the conditions
   in this knowledge base live in `indicators_against`. Counting both, 74 are
   enforced in the matcher, 20 in Layer 3, 29 argued on a record, **47
   unread**. Twenty-five defects have come out of the reading so far, including one
   in Layer 3 that had been true of every measurement in the project.
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
