# Phase 0 — the Nox Chess codebase, and where the Education System fits

Re-done against the current tree after `agent-4` was brought up to date with
`main`. The first pass was performed on a branch 44 commits behind and reached
two wrong conclusions; both are corrected below and marked.

## What is actually here

`blind-chess.html` is now **12,788 lines** (it was 4,819 on the stale branch),
with 24 banner sections. The Python server is still matchmaking and a move relay.
There is a Node toolchain in `tools/` that did not exist on the old branch.

| System | Where | State |
|---|---|---|
| Study Board (post-game review) | `THE REVIEW`, `blind-chess.html:6170` | real, tested by `server/test_review.js` |
| Puzzles | `THE PUZZLES`, `:6823` + `puzzles/*.json` | **788 Stockfish-verified puzzles**, three ladders |
| Study Alternatives | `:7448` | engine answers any defence the solver tries |
| Lessons | `THE LESSONS`, `:8026` | five-lesson course, tested end-to-end |
| Practice | `PRACTICE`, `:9566` | six drills + mini blindfold challenge |
| Social | `:12132` | friends, requests, challenges |
| Puzzle generation | `tools/generate_puzzles.js` | mines self-play, tags, rates, ranks |
| Puzzle verification | `tools/verify_puzzles.js` | audits and repairs shipped ladders |
| Explanation writer | `tools/puzzle_words.js` | writes the `why` card, with an audit pass |
| Motif detection | `findMotifs()`, `:6489` | nine tags, SEE-checked |
| Offline engine | `tools/sf.js` | WASM `Engine`, `NativeEngine`, `Pool` |
| Page chess in Node | `tools/page_chess.js` | lifts the page's own functions out |

## Corrections to the first Phase 0

**CORRECTED — "there is no FEN anywhere in the codebase."** False now.
`fenOf(s)` and `stateFromFEN(fen)` live in CONSTANTS & HELPERS at
`blind-chess.html:3913` and `:3929`, and `engineAsk` takes an optional `fen` so a
puzzle position can be asked about directly. The comment there says it plainly:
"FEN is how a position travels."

Consequence: the FEN reader/writer the old architecture listed as a prerequisite
**must not be written**. It exists, it is round-trip tested by
`server/test_lessons.js`, and a second implementation would be a bug farm.

**CORRECTED — "LESSON and PUZZLE are `soon` stubs, nothing to preserve."** False.
Both are substantial shipped features with their own test suites
(`test_puzzle_flow.js`, `test_lessons.js`, `test_practice.js`,
`test_practice_flow.js`). The Education System must integrate with them, not
replace them.

**CORRECTED — the description of the existing explanation system.** `judgeMove`
and `describeBest` still exist but have both evolved. `judgeMove` now takes the
position and both engine readings, works in **win percentage** rather than raw
centipawns, distinguishes six verdicts (best / good / great / brilliant /
mistake / blunder), and detects a sacrifice by static exchange evaluation
(`sacrificeSize`) rather than by trusting that the engine liked it. It is much
closer to real move judgement than the version I described.

## The overlap, stated honestly

Two of the five layers in `ARCHITECTURE.md` already exist in this codebase, and
they were built to the same standard this project set for itself.

**Layer 3 (position understanding) exists as `findMotifs()`.** It emits nine
tags — `mate`, `hangingPiece`, `fork`, `pin`, `skewer`, `discoveredAttack`,
`doubleCheck`, `backRank`, `trappedPiece` — and it already applies the guards
this project derived independently through engine testing:

- a fork is only reported when the target is outranked by the forking piece or
  is undefended, which is the exact condition the fork controlled pair produced;
- material already loose *before* the move is not counted as the move's doing;
- a pin that was already on the board is skipped, because it is not the reason
  to play anything;
- exchanges are resolved with SEE rather than assumed.

**Layer 5 (explanation) exists as `tools/puzzle_words.js`**, with an
`auditClaims()` pass over what it wrote. Its header states the discipline:
"Nothing here guesses: a sentence that cannot be justified from a position or a
number is not written, and the card is shorter instead."

**And the two projects independently reached the same refusal.** The puzzle
generator's README:

> Deflection, decoy, overloading, interference and double attack are
> deliberately **not** claimed — each is an assertion about *why* a piece cannot
> do its job, every cheap test for them fires where it is not true, and a puzzle
> labelled with a tactic that is not there is worse than one labelled with a tag
> fewer.

Those are exactly the five concepts this knowledge base had already classified
`detectability: heuristic` on research grounds, arrived at from the sources
rather than from the code. Two independent routes to the same line is the
strongest evidence so far that the line is in the right place.

## So what is the Education System actually for

Not a second motif detector. Not a second explanation writer. The existing ones
are good, and the honest reading of this codebase is that the *tactical, single-move*
case is already solved to a high standard.

What is missing, and what this system supplies:

1. **Knowledge behind the tags.** `findMotifs()` knows a fork when it sees one.
   It does not know what a fork is called in other languages, who named it, that
   an absolute fork admits no zwischenzug while a relative one does, or what the
   exceptions are. Nine tags have no definitions, no history, no epistemic type
   and no exceptions attached to them anywhere in the repo.

2. **Everything positional.** `findMotifs()` is entirely tactical. There is no
   vocabulary in this codebase for outposts, weak squares, pawn structure, the
   principle of two weaknesses, king safety, or planning — and `positionalTactic`
   is a single catch-all theme covering 25 puzzles across the three ladders.
   This is the largest gap and the biggest reason the project exists.

3. **Safe-claiming criteria for the five refused motifs.** The refusal is correct
   *as a default*. Researched preconditions plus `indicators_against` are what
   could eventually make a narrow, high-confidence claim safe — with the burden
   of proof on the criteria, not on the wish to say more.

4. **Level and depth.** The `why` cards are written at one register. The
   knowledge base carries beginner/intermediate/advanced/master and
   short/normal/deep, which is what lets the same position be explained
   differently to different players.

5. **Retrieval.** Choosing which few concepts are relevant to a position, ranked
   by explanatory importance, rather than loading everything.

## Integration points, concretely

| Education System | Consumes / extends | How |
|---|---|---|
| concept records for the 9 motif tags | `findMotifs()` tags | tag string is the concept `id`; the detector stays the authority on *whether*, the record supplies *what it means* |
| positional concepts | nothing yet | the genuinely new surface |
| `explanations.by_level` / `by_depth` | `puzzle_words.js` register | additional registers, not a replacement |
| example positions | `puzzles/*.json` | 788 verified FENs with themes and engine numbers already attached |
| engine numbers | `tools/sf.js` `NativeEngine` | see the duplication note below |
| board features | `tools/page_chess.js` | the page's own `attackersOf`, `see`, `sliderLines`, `betweenSq` are reusable from Node |

### Naming alignment

`findMotifs()` tags are camelCase; concept ids are kebab-case. The mapping is
mechanical and is recorded in `tools/motif_map.json` so neither side has to
change: `discoveredAttack` → `discovered-attack`, `doubleCheck` → `double-check`,
`backRank` → `back-rank-mate`, `hangingPiece` → (no concept yet),
`trappedPiece` → `trapped-piece`.

### A known duplication

`education/tools/sf_analyse.py` and `tools/sf.js` both drive native Stockfish 18.
The duplication is deliberate but should be understood:

- the education tooling is Python and standard-library only, matching
  `validate_kb.py` / `run_tests.py` / `sync_state.py`;
- `tools/sf.js` is Node and is wired into the puzzle pipeline, where it also
  parses info lines with *the page's own* `readInfoLine()` so that "a puzzle is
  chosen by the same numbers the review screen reads."

That last point is a real discipline and my Python parser is a third
implementation of it. Mitigation: `sf_analyse.py` now records `engine_id` and
full settings on every stored result, and `settleDepth` — `tools/sf.js`'s measure
of the shallowest depth from which the search never changed its mind — is worth
adopting as a confidence signal, since it is better than raw depth for saying how
firm a number is.

## What must not be touched

- `engine/` — vendored GPL Stockfish, checksum-verified.
- `puzzles/*.json` — generated and verified by their own tooling.
- The JS suites read code out of `blind-chess.html` **by name**; renaming
  `findMotifs`, `fenOf`, `stateFromFEN`, `wsURLFrom` or moving the PRACTICE
  banner breaks them on purpose.
