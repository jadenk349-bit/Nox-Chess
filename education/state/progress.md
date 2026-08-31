# Education System — Progress Log

Newest entry first. `state/research-state.json` is the machine-readable version;
this file is the narrative, and records reasoning that does not fit in JSON.

---

## Session 1 — scaffolding, methodology, pilot concept

### Codebase inspection (done before any design)

- The client is one file, `blind-chess.html` (~4.8k lines), navigated by
  `/* ==== TITLE ==== */` banners. 17 script sections.
- **Study Board** is not a separate feature: it is the post-game review
  (`REV`, `reviewGoto`, `reviewRender`), reached by the `endClose` button.
- **LESSON** and **PUZZLE** exist in the header nav but every entry carries the
  `soon` class. They are stubs — nothing to preserve, nothing to break.
- **Existing explanation system**, the thing this project extends:
  - `judgeMove(loss, playedWasBest, gap)` -> `??` / `?` / `!!` / `!`, purely from
    centipawn loss plus the MultiPV gap.
  - `describeBest(st, m, res, lossByPlayer)` -> up to three observable facts
    (mate, check, capture, promotion, castling, escaping an attack, leaving the
    back rank, taking central space), else the fallback *"No single tactic — it
    is simply the soundest of the options."*
  - Its own comment: *"This is not chess understanding, and it only ever claims
    what it can see."* That is an accurate self-assessment and names the gap.
- **Engine integration**: `SF` object, one lazily-started worker running the
  vendored single-threaded `engine/stockfish.wasm` (Stockfish 10), spoken to in
  UCI via `engineAsk(moves, opt)`. Results are cached on a key that includes
  strength settings. Review asks at `{skill:20, multipv:2}`, 500 ms per position.
  Notably it must never `setoption name Threads` — the comment records that doing
  so wedges the build.
- **No FEN anywhere in the codebase.** State is `{b, turn, cr, ep, half, full}`
  with `b` a 64-array of `{c,t,id}`, index 0 = a8. The client only ever sends
  `position startpos moves ...`.

  This is a real prerequisite. Every stored example position, every puzzle, every
  textbook position is a FEN. A FEN reader/writer that round-trips against the
  existing state shape has to exist before the runtime half of this system can
  work. It is purely additive and changes no existing behaviour. **Not yet
  written** — deliberately deferred until the knowledge base justifies it.

### Decisions taken

- **Storage: one JSON file per concept**, under `concepts/<category>/`.
  Chosen over a single large file so git diffs stay readable and two sessions
  can work without merge conflicts. A committed `education-bundle.json` will be
  compiled from them, so the app still has no build step.
- **Tools are standard-library only.** `requirements.txt` has exactly one
  dependency (PyJWT) and the Dockerfile is proud of it. `sf_analyse.py` speaks
  raw UCI over a pipe; `validate_kb.py` hand-rolls the schema checks rather than
  pulling in `jsonschema`. `python-chess` is optional, for SAN in tool output.
- **Research uses a native Stockfish 18, not `engine/stockfish.wasm`.** The
  vendored build is GPL, checksum-verified, single-threaded Stockfish 10, and
  exists to be served to browsers. Research must not touch it, and a 2018 engine
  is the wrong instrument for adjudicating theory anyway.
- **20 domains / 85 areas**, mapped one-to-one against the 85 numbered items in
  the project brief so scope coverage stays auditable (`brief_items` in
  `taxonomy.json`). All 85 are accounted for; item 85 is the escape hatch for
  categories discovered later.

### Tooling built and verified

- `tools/sf_analyse.py` — probed `Stockfish 18`, 12 cores available.
  One real bug found and fixed during verification: piping every UCI command at
  once and closing stdin makes Stockfish read `quit` mid-search and exit before
  printing a single `info` line, so it silently returned a bestmove with no
  evaluation. It now streams and waits for `bestmove`. Worth remembering — the
  broken version *looked* like it worked.
- `tools/validate_kb.py` — schema, enums, id uniqueness, referential integrity
  across concepts/sources/coverage. Currently clean.

### Pilot concept: principle of two weaknesses

Researched and engine-validated ahead of the scaffolding, and used to prove the
schema end to end. Findings that shaped the methodology:

1. **The received attribution is half wrong, and only the primary text showed
   it.** Every secondary source says Nimzowitsch formulated the principle in
   *My System* (1925). The full text shows the idea is there — Ch. 5/VI
   "Manoeuvring", §2(b) is literally headed *"Two pawn weaknesses, in this case
   c3 and h3"* — but he calls it *manoeuvring* or *tacking*, never "the principle
   of two weaknesses". That name comes from the Soviet line
   (Belavenets -> Dvoretsky -> Shereshevsky). Both halves of the received claim
   are half-right. This is why `origin.certainty` exists as a field.

2. **Controlled pairs are the strongest validation available.** Two positions
   differing only in the presence of a distant second target: mate in 23 versus
   a dead draw. Reproducible from the FENs by anyone.

3. **Respected sources overstate.** Shereshevsky: a position "would be drawn"
   with the kings placed differently — engine says +0.75, not 0.00. Mechanism
   confirmed and large; absolute claim not supported.

4. **Annotators' punctuation is not an evaluation.** Dvoretsky and British Chess
   News mark 42...h5 as necessary and 42...Kf6 as an inaccuracy in
   Kotov-Pachman. At depth 32 the gap is **0.05 pawns**. The second weakness
   created *practical* difficulty, not objective loss — Pachman held for another
   thirteen moves and lost to a later error. A concept can be practically
   decisive and objectively near-irrelevant at the same time, and the record has
   to be able to say so.

5. **Disagreements get adjudicated, not flattened.** Capablanca called 43...Nb4
   a trap; Myers said Black wins anyway. Engine: Capablanca's concrete line is
   0.00 so the trap is real, Myers is right that Black can deviate and win, and
   *neither* noticed 43...Nb4 is 1.2 pawns better than the move actually played.
   All three recorded.

Side benefit: a FEN hand-decoded from Dvoretsky's diagram font was verified by
replaying the entire published continuation through move 55 — it is legal
throughout, which independently confirms the transcription.

### Phase 5 results — tactics controlled pairs

Three pairs built, each differing in exactly one variable.

| Concept | Positive | Negative (one variable changed) | Swing |
|---|---|---|---|
| Fork | Nc7+ **+7.39**, best, +2.21 clear | bishop guards c7: same move **+0.57**, ranked last | **6.82** |
| Back-rank mate | Re8 **mate in 1** | h7-h6 luft: same move **mate in 30**, not best | #1 -> #30 |
| Pin | d4-d5 **+7.26**, +1.57 clear | king castled, no pin: d4-d5 **+5.40**, still best, +0.28 clear | 1.86 |

The pin result is the important one and is now written into METHODOLOGY.md as a governing rule:
the same move was the engine's first choice with and without the pin, so best-move agreement
cannot be used to decide that a concept applies. The usable signal is the margin over the
runner-up, plus the paired delta.

The fork pair is the cleanest false-match demonstration in the base so far: identical geometry,
6.82 pawns apart, decided solely by whether one defender covers the landing square. Any fork
detector that stops at geometry will produce exactly this error.

Housekeeping: a depth-34 analysis of the Kotov-Pachman move-55 rook ending failed to converge in
16 minutes and was starving a parallel run of CPU; it was killed and recorded as an open question
on the two-weaknesses concept rather than dropped. Lesson: cap simplified endings at depth 28-30,
or install Syzygy tablebases.

## Session 3 — Phase 0 redone against the merged tree

`agent-4` was 44 commits behind `main` when Phase 0 was first performed. It has been
brought up to date and the inspection redone. Full record in `INTEGRATION.md`.

### Corrections

| First pass said | Actually |
|---|---|
| No FEN in the codebase; a reader/writer is a prerequisite | `fenOf()` / `stateFromFEN()` at `blind-chess.html:3913`/`:3929`, round-trip tested. **Do not write a second one.** |
| LESSON and PUZZLE are `soon` stubs | Both shipped, with their own suites, plus Practice and 788 verified puzzles |
| `judgeMove` = centipawn loss -> 4 verdicts | Win-percentage based, six verdicts, SEE-based sacrifice detection |
| Layers 3 and 5 are greenfield | `findMotifs()` covers the tactical half of 3; `tools/puzzle_words.js` covers 5 for puzzles |

### The convergence worth recording

`findMotifs()` already applies the guards this project derived independently from
engine testing — a fork is reported only when the target is outranked or
undefended, material already loose before the move is not counted, and a pin that
already existed is skipped. And the generator's README refuses to claim
deflection, decoy, overloading, interference and double attack because "every
cheap test for them fires where it is not true" — exactly the five this knowledge
base had classified `detectability: heuristic` from the sources. Two independent
routes to the same line.

That reframes the project. The tactical single-move case is already solved here to
a high standard. What is missing is the knowledge behind the tags, everything
positional (the codebase has no vocabulary for it at all), extra registers, and
retrieval.

### Corpus testing

`tools/corpus.py` mines the 788 shipped puzzles as a labelled dataset. It measures
which themes have concept records, weighted by how often they occur, which turns
research prioritisation from a guess into a measurement: **78% of chess-concept
theme instances are covered**.

It also caught a mistake before it was made. `longGame` (591 puzzles) and
`defensiveResource` (490) look like the two biggest gaps, but reading
`puzzle_rules.js` shows `longGame` means "the line is at least three moves" and
`defensiveResource` means "this puzzle is a rescue rather than a punish". They are
properties of the PUZZLE, not chess ideas, and giving them concept records would
have been inventing terminology to fit a pipeline tag. They are now classified
`metadata` and excluded from the coverage denominator. `positionalTactic` is
similar — the generator's label for "a quiet move with no motif tag" — and is
marked NEEDS RESEARCH BEFORE NAMING rather than given a concept called
"positional tactic", which is not a recognised term.

### Concepts added

`hanging-piece`, `loose-piece`, `lpdo`, `weak-square` — chosen because
`hangingPiece` is the single most common theme in the corpus (598 of 788) and had
no record. The four are deliberately typed differently to show the classification
doing real work on one subject: hanging and loose are `terminology`, LPDO is a
`rule-of-thumb` carrying mandatory hedging, weak-square is a `positional-concept`.

LPDO is also a clean attribution case: two sources say "probably coined by Mike
Cook", popularised by Nunn. The hedge is theirs and is kept, confidence is
`medium`, and `misconceptions` records that writing "Nunn coined LPDO" would be
wrong.

## Session 4 — corpus-driven research

Worked the priority order the corpus produced rather than by taste. Ten concepts
added: sacrifice, positional-sacrifice, exchange-sacrifice, perpetual-check,
king-attack, backward-pawn, open-file, greek-gift, passed-pawn,
pawn-breakthrough, rook-on-the-seventh, bad-bishop, doubled-pawns,
isolated-queen-pawn.

### Findings worth keeping

**The first `contradicts` verdict.** Puzzle mi-bb512d9713 is tagged
`exchangeSacrifice` by the repository's own pipeline. Stockfish says Re1+ is mate
in two. So the material pattern fires correctly — rook for bishop — but this is a
MATING sacrifice, sham in Spielmann's sense, not a positional exchange sacrifice.
Recorded as `contradicts` on the exchange-sacrifice record, because it proves the
corpus tags cannot be used as ground truth for the positional concept.

**Perpetual check is not a rule**, and this is the clearest rules misconception
found so far. FIDE's Laws do not mention it; a perpetual forces a repetition and
the repetition is what draws. Shogi and xiangqi forbid it outright, which shows
its status is a choice rather than a necessity. Engine-verified on a real corpus
position: Qa8+ evaluates 0.00 with the repeating cycle in the PV, while every
alternative is mate against — Ne6+ is mate in 13, Qg3 mate in 3.

**Two unverified famous quotations recorded as unverified.** Nimzowitsch's
"a passed pawn is a criminal which should be kept under lock and key" is
attributed but was NOT located in the primary text during this research. A
Capablanca line about taking doubled pawns for the seventh rank is prefaced
"Legend has it" by its own source. Both are flagged rather than repeated, and
`passed-pawn` carries history confidence `low` because of it.

**The Greek gift's NAME has two incompatible origins** in circulation — Greco the
player, and the Trojan horse — and neither was verified. Recorded as an open
question. Vukovic's four CONDITIONS, by contrast, are secure and precise enough
to be near-mechanical recognition criteria.

### Epistemic typing doing real work

Four concepts on one subject, typed three different ways: `hanging-piece` and
`loose-piece` are terminology, `lpdo` is a rule-of-thumb with mandatory hedging,
`weak-square` is a positional concept. Similarly `perpetual-check` is terminology
rather than an official rule, and `pawn-breakthrough` is a tactical motif rather
than a strategic principle because its correctness is settled by calculation.

### Engine budget — a lesson learned twice

A Greek Gift pair at depth 28 MultiPV 4 and a breakthrough pair at depth 34, run
concurrently, failed to converge in twelve minutes. Two compounding errors:
MultiPV suppresses pruning so it costs far more than single-PV at the same depth,
and `sf_analyse.py` defaults to `cpu_count-2` threads so two concurrent jobs
requested 20 threads on 12 cores. Both recorded in `tool_limitations`, and
`sf_analyse.py` now takes `--threads`. Run engine jobs sequentially.

## Session 5 — first quality audit, and a corrected textbook

### The audit (brief Phase 39)

`tools/audit.py` is new and looks for what is wrong but LEGAL — the class of
problem `validate_kb.py` and `run_tests.py` cannot see. First run over 59
concepts found **16 issues, 6 of them high**, and all six were real:

- Four attributions (`backward-pawn`, `bad-bishop`, `doubled-pawns`,
  `isolated-queen-pawn`) asserted `originated-by` or `named-by` at history
  confidence `low` with no hedge in the attribution note itself. The caveat sat
  in a field a reader might not reach. Hedge now travels with the claim.
- `fork` listed "double attack (by a single piece)" as an alias — which is the
  canonical name of the separate `double-attack` record. The record's own
  metadata contradicted the distinction its prose draws. Alias removed,
  `broader: double-attack` added instead.
- `pawn-breakthrough` claimed `source_confidence: high` with no source rated
  high. Downgraded.

The six low findings were reviewed and **accepted rather than fixed**, with
reasons recorded: four concepts promoted while relying on a source with an
access caveat (the promotions rest on engine evidence, and the caveat is exactly
why none is promoted to `ready`), and two short records that are simple rules
quoted from the Laws, where padding would add words rather than knowledge.

### Tablebase corrects a teaching source

`tools/tablebase.py` now reports EVERY legal move with its exact verdict, which
turns out to be far more informative than a single evaluation.

Run over the standard textbook triangulation position — White Kd5 with pawns b5
and c5, Black Kd7 with a pawn on b7 — it says:

```
b6    win in 22      Kc4/Kd4/Ke4  win in 48
Ke5   win in 46      c6+          DRAW
```

The instructional line gives 1.Ke5! as the winning move. It wins, but it is the
slowest of five winning moves, and the direct 1.b6 is more than twice as fast.
Only 1.c6+ throws the win away. So the position genuinely teaches "do not push
the pawn" and does NOT establish that triangulation was necessary. Recorded as
an `ambiguous` example on the concept, because it supports the technique's
existence while contradicting the necessity the source implies.

### Pawn breakthrough completed

Both halves of the controlled pair are now settled, and the swing is the largest
in the base. Identical material and structure, White's trio one rank apart:

```
pawns on the 5th:  1.b6!  +64.85  (both alternatives LOSE: -10.25, -81.15)
pawns on the 4th:  1.b5   -5.86   and not best; the quiet 1.a5 at -0.46 is
```

Over 70 pawns of difference produced by one rank of space. The sources' claim
that "move all pawns one row and the breakthrough does not work at all anymore"
is confirmed exactly.

### Concepts added

`king-safety`, `opening-development`, `triangulation`, `corresponding-squares`,
`key-square`. The first two close three registered false-positive cases, and
`opening-development` is deliberately typed `rule-of-thumb` with mandatory
hedging — the five conventional opening rules are teaching scaffolding, and the
brief's own example (moving a piece twice) is recorded as a trap rather than a
criticism.

King safety is worth noting as the one concept where engine practice is public
enough to borrow as a specification: Stockfish's king zone, its attack-unit
weights (minor 2, rook 3, queen 5), and the S-shaped scoring table are all
documented, and the practical consequence — an attack is not worth evaluating
below three attackers — is better guidance than anything in the prose sources.

## Session 6 — orphaned waiters, and a rule of thumb proven wrong

### The two background shells could never finish

Both were `until grep -q DONE_...` waiters polling `gg.out` and `bt.out`. Those
files end in a **BrokenPipeError traceback**: when the over-deep runs were killed
last session, `sf_analyse.py` raised on writing `quit` to a dead engine, which
escaped and killed the wrapping script BEFORE it echoed its sentinel. Nothing
could ever write what the waiters were watching for.

Nothing was pending. The results had been obtained by reruns and incorporated;
every number in `greek-gift` and `pawn-breakthrough` was re-checked against the
raw output of `both.out` and `bt2.out` and matches exactly. No corrections were
needed to the research.

Two fixes recorded:
- `sf_analyse.py` now tolerates a dead pipe and raises a clear RuntimeError
  naming the problem, instead of a stray BrokenPipeError that kills its caller.
- Recorded in `tool_limitations`: a background script must write its sentinel
  UNCONDITIONALLY — `trap 'echo DONE_X' EXIT`, not a bare echo at the bottom.

### The most valuable result in the base so far

The Vancura position gives a **proven refutation of a famous rule of thumb**.
Tarrasch's rule — the rook belongs behind the passed pawn — is recorded in
`passed-pawn` as a reliable heuristic. In the Vancura configuration it loses by
force. Two positions, identical material and identical kings, differing only in
which square the defending rook stands on:

```
R7/6k1/P4r2/8/3K4/8/8/8 w   rook BESIDE the pawn (f6)   PROVEN DRAW
R7/6k1/P7/8/3K4/8/8/r7  w   rook BEHIND the pawn (a1)   PROVEN LOSS in 63
```

That is not an argument about the rule, it is a counterexample to it. The
exception is now linked from `passed-pawn`, which previously stated Tarrasch's
rule without qualification, and both concepts carry the cross-reference.

### A documented misattribution

The Lucena position is not Lucena's. It does not appear in his 1497 book; the
earliest preserved discussion is Salvio's *Il Puttino* (1634), who credits
Scipione Genovino; and the error is traced to Constantin Schwede's sixth edition
of the *Handbuch des Schachspiels* (1880). The name is universal and should keep
being used — but it is terminology, not evidence of authorship, and the record
says so.

Philidor's attribution, by contrast, is sound (1777) — with the nuance that his
own claim that the third-rank defence was the ONLY drawing method was disproved
by Karstedt in 1897.

### Concepts added

`lucena-position`, `philidor-position`, `vancura-position` — three named
theoretical positions, all tablebase-proven. The Lucena's tablebase best move is
Rd1+, exactly the textbook first move of the bridge.

### Next

Complete the pilot concept record, then work the taxonomy in dependency order:
`rules-terminology` and `board-geometry` first (they are prerequisites for the
recognition criteria of everything else), then `tactics`, then the positional
domains.
