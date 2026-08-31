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


## The five layers

The brief specifies five layers that must not be mixed. They are kept separate in
both the data and the tooling.

| Layer | What it owns | Where it lives | Must never |
|---|---|---|---|
| 1. Research knowledge | What humans call ideas, what they mean, where they came from | `concepts/`, `sources/` | assert that a move works |
| 2. Engine validation | Whether a move actually works | `tools/sf_analyse.py`, `tools/tablebase.py`, the `engine`/`tablebase` blocks on positions | name a concept |
| 3. Position understanding | Observable board features — structure, files, squares, material, activity | detectors, named in `recognition.detector`; **not yet built** | interpret |
| 4. Concept matching | Which concepts the detected features actually license | **not yet built** | match on engine agreement |
| 5. Explanation generation | Wording, level, depth, hedging | `explanations` on each concept | claim anything not true in this position |

Layer 3 and 4 do not exist yet, deliberately. They are the part that must be built
*on* researched criteria, and the criteria are what the research phase produces.
Building them first would mean inventing recognition rules and then looking for
sources to justify them, which is the failure mode this whole design exists to
avoid.

## Knowledge types

Every concept declares what KIND of knowledge it is. The brief's Phase 5 letters
map onto the stored values as follows; the stored values are words rather than
letters because a JSON diff should be readable without a key.

| Brief | Stored `knowledge_type` |
|---|---|
| A official chess rule | `official-rule` |
| B proven theoretical fact | `proven-result` |
| C tablebase fact | `tablebase-fact` |
| D named theoretical position | `named-theoretical-position` |
| E tactical motif | `tactical-motif` |
| — (Phase 4 list) | `mating-pattern` |
| F strategic principle | `strategic-principle` |
| G positional concept | `positional-concept` |
| H rule of thumb | `rule-of-thumb` |
| I historical teaching principle | `historical-teaching-principle` |
| J practical guideline | `practical-guideline` |
| K terminology | `terminology` |
| — | `other` |

`rule-of-thumb`, `historical-teaching-principle` and `practical-guideline` carry a
**mandatory** `explanations.hedge`. `tools/validate_kb.py` fails the build without
it, so a guideline cannot be phrased as a law by accident.

## Concept lifecycle

```
discovered -> researched -> sourced -> structured -> tested -> validated -> ready
```

Only `ready` may be treated as production-ready. `validated` and `ready` both
require engine or tablebase evidence unless the coverage row marks the concept
`engine_testable: false` with a reason — `tools/validate_kb.py` enforces this.

## Evidence hierarchy

When two kinds of evidence disagree, the order is fixed:

1. **Tablebase** — for positions of seven pieces or fewer this is proof, not
   opinion, and it ends the question. Recorded as `knowledge_type: tablebase-fact`.
2. **Engine at adequate depth** — strong evidence about a specific position.
3. **A titled author's assertion** — evidence about what the idea IS, and only
   weak evidence about whether a given move works.

The pilot concept shows all three interacting: Shereshevsky asserts a position
"would be drawn"; the engine says +0.75; and the constructed pair beneath it is
settled outright by tablebase. Each is recorded at its own strength.

## Engine test levels

| Level | Use |
|---|---|
| 1 | smoke test — position is legal, move is legal, nothing is obviously wrong |
| 2 | normal validation — depth ~26-28, the default |
| 3 | deep validation — depth 30+, or MultiPV comparison of close alternatives |
| 4 | critical — disputed claims, historical adjudication, foundational concepts |

Levels are stored per position so results are reproducible, alongside threads,
hash and MultiPV.

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

## Non-goals

- No UI, no screens, no user-facing "Education" section.
- No changes to Study Board, Puzzles, or Lessons until the knowledge base is
  built and validated.
- No neural training. "Self-play" here means generating positions to test the
  knowledge base against, nothing more.
