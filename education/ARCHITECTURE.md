# Education System — Architecture

## What this is

An internal knowledge and explanation layer for Nox Chess. It is **not** a screen,
a route, or a menu item. Nothing in it renders. Other features call into it and
get back a structured, verified explanation of a position or a move.

The intended callers are the Study Board (the existing post-game review), the
Puzzle screens, and the Lesson screens — the last two are `soon` stubs in
`blind-chess.html` today.

## Why it exists

`blind-chess.html` already explains moves, in two functions:

- `judgeMove(loss, playedWasBest, gap)` — four verdicts (`??`, `?`, `!!`, `!`)
  derived purely from centipawn loss and the MultiPV gap.
- `describeBest(st, m, res, lossByPlayer)` — up to three observable facts about
  the move: it checkmates, it checks, it captures, it promotes, it castles, it
  steps out of an attack, it develops off the back rank, it takes central space.
  Failing all of those, it says *"No single tactic — it is simply the soundest of
  the options."*

That code is honest about its limits; its own comment reads *"This is not chess
understanding, and it only ever claims what it can see."* The gap it names is
exactly the gap this system fills: it can see that a rook moved to the seventh
rank, but it has no idea that this is a named concept, what conditions make the
concept apply, when the concept is a rule versus a habit, or what the exceptions
are.

The Education System supplies that missing half. It never replaces the engine —
Stockfish still decides what is good. It supplies the vocabulary, the conditions
under which a piece of vocabulary is warranted, and the honesty about which
claims are theorems and which are rules of thumb.

## Hard separation of roles

This is the load-bearing design rule and everything else follows from it.

| Question | Answered by | Never answered by |
|---|---|---|
| What is this concept called? | researched sources | Stockfish |
| Who first formulated it, and where? | primary/historical sources | Stockfish |
| Is it a rule, a theorem, or a habit? | sources + our classification | Stockfish |
| Is this move actually good here? | Stockfish | sources |
| Does the concept actually apply here? | board-feature detection, then both | either alone |

Stockfish must never be used to name a concept. Research must never be used to
assert that a move works. A concept is only attached to a position when the
board features that define it are present **and** the engine agrees about the
move — matching on one alone is a false match, and false matches are recorded as
such (see `state/coverage.json`).

## Storage model

Plain files in the repository. No database, no build step, no package manager —
matching the rest of the project.

```
education/
  README.md              orientation for a human or a fresh Claude session
  ARCHITECTURE.md        this file
  METHODOLOGY.md         how research and validation are actually conducted
  TAXONOMY.md            human-readable scope, with per-area status
  taxonomy.json          machine-readable category tree
  concepts/<category>/<id>.json     one file per concept
  positions/<id>/*.json             engine-validated example positions
  sources/sources.json              source registry with confidence ratings
  state/research-state.json         checkpoint: done / in progress / not started
  state/coverage.json               per-concept coverage matrix
  state/progress.md                 human-readable running log
  research/                         raw research notes, per session
  tools/                            schema, validator, engine harness, bundler
  education-bundle.json             compiled single-file KB for the client
```

**One file per concept** is deliberate. It keeps git diffs readable, lets two
sessions work without merge conflicts, and makes an audit of any single claim a
one-file read. The client would not want 500 fetches, so `tools/build_bundle.py`
compiles them into one checked-in `education-bundle.json`. The bundle is a build
artifact that is committed, so the app still has no build step.

## The missing primitive: FEN

`blind-chess.html` has no FEN reader or writer. Its state is
`{b, turn, cr, ep, half, full}` where `b` is a 64-array of `{c,t,id}` with index
0 = a8, and it only ever talks to Stockfish as `position startpos moves …`.

That is fine for reviewing a game played from the start. It cannot express a
puzzle, a textbook position, or a stored example, all of which this system is
made of. So a FEN reader/writer is a prerequisite, and it must round-trip
against the existing state shape rather than replace it.

This is additive. Nothing existing changes behaviour.

## Runtime pipeline

```
position (+ optional played move)
  -> Stockfish            best move, eval, MultiPV alternatives, eval delta
  -> feature detection    observable board facts, no interpretation
  -> concept candidates   features -> concepts whose preconditions match
  -> verification         re-check each candidate's own indicators_against
  -> ranking              by explanatory importance, not by count
  -> explanation          concise + optional deeper, with epistemic hedging
```

Two rules govern the output:

1. **Do not force a name onto every move.** If nothing matches, the honest
   answer is calculation — the existing `describeBest` fallback wording is the
   right register and should survive.
2. **Rank, do not enumerate.** Several concepts often apply. Report the ones
   that explain the move, in order, not everything that technically matched.

## Epistemic typing

Every concept carries an `epistemic_type`, because the system must not present a
heuristic as a law:

| Code | Meaning |
|---|---|
| A | Official rule of chess |
| B | Proven/theoretical result (tablebase or proof) |
| C | Named theoretical position |
| D | Tactical motif |
| E | Strategic principle |
| F | Rule of thumb |
| G | Historical teaching principle |
| H | Practical guideline |
| I | Terminology / pattern name |
| J | Other |

A `D` may be stated flatly. An `F` must be hedged and must carry its exceptions.
The distinction is enforced in the explanation templates, not left to prose.

## Non-goals

- No UI, no screens, no user-facing "Education" section.
- No changes to Study Board, Puzzles, or Lessons until the knowledge base is
  built and validated.
- No neural training. "Self-play" here means generating positions to test the
  knowledge base against, nothing more.
