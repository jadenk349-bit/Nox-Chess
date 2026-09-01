# The Education System

An internal chess knowledge and explanation layer for Nox Chess.

It is **not** a screen. There is no "Education" page, menu, or route, and nothing
here renders anything. It is a researched, source-cited, engine-validated body of
chess knowledge plus the machinery to apply it to a position — so that other
features can explain a move in real chess terms instead of restating an
evaluation.

Intended callers: the Study Board (the existing post-game review), and the
Puzzle and Lesson screens, which are `soon` stubs in `blind-chess.html` today.

## Why it exists

`blind-chess.html` already explains moves. `judgeMove()` turns centipawn loss
into one of four verdicts, and `describeBest()` assembles up to three observable
facts — it captures, it checks, it promotes, it steps out of an attack. When none
of those fit it says, honestly, *"No single tactic — it is simply the soundest of
the options."*

That code is not wrong; it is just working without vocabulary. It can see a rook
arrive on the seventh rank but has no way to know that this is a named idea, what
makes the idea apply here rather than merely describe the move, or whether the
idea is a law or a habit with known exceptions. This system supplies that.

## Using it

```js
const { analyzeWithEducation } = require('./education/lib/analyze.js');

const r = analyzeWithEducation({
  fen:   '<position>',
  move:  'd5c7',                 // optional, UCI
  engine: { eval_cp: 739, best_move: 'd5c7', depth: 26 },   // optional
  level: 'intermediate',         // beginner | intermediate | advanced | master
  depth: 'normal',               // short | normal | deep
});

r.explanation.text   // the sentence
r.concepts           // what the position licenses, with confidence and cautions
r.notes              // anything the system is refusing to claim, and why
```

It refuses four things on purpose, and the refusals are the reason to use it
rather than a caveat on it: it will not invent a label when nothing fits, will
not assess a move without an engine result, will not emit a phrase a concept's
own record bans, and will not print an unfilled template. See ARCHITECTURE.md.

There is a CLI for a quick look: `node lib/analyze.js "<fen>" [uci] --deep`.

## Finding things

```bash
python3 tools/find.py "rook behind"          # search concepts
python3 tools/find.py outpost --full         # the whole record
python3 tools/find.py --warnings doubled     # what must NOT be said about this
python3 tools/find.py --disputed             # every unsettled attribution
python3 tools/find.py --untested             # concepts with no engine or tablebase evidence
python3 tools/find.py --source winter        # what a source is used for
```

## Checking it still holds together

```bash
python3 tools/run_tests.py     # everything, including the JS API suite
python3 tools/validate_kb.py   # schema and referential integrity
python3 tools/audit.py         # quality findings
python3 tools/build_index.py   # rebuild the warnings index (tests fail if stale)
node    tools/mass_test.js     # run the API over all 788 shipped puzzle positions
```

## Reading order for a new session

1. `ARCHITECTURE.md` — the design, the hard separation between what research
   decides and what the engine decides, and the four refusals the API enforces.
2. `METHODOLOGY.md` — how research and validation are actually conducted.
3. `state/research-state.json` — what is done, in progress, and untouched,
   including `failed_research_attempts` and `tool_limitations`, which are worth
   reading before repeating something that did not work.
4. `state/progress.md` — the narrative log, newest first.
5. `TAXONOMY.md` / `taxonomy.json` — the full scope and its status.

`state/research-state.json` is the resume point. It is written so that a fresh
Claude Code session, on a different machine, can continue without re-deriving
anything.

## Layout

```
concepts/<category>/<id>.json   one concept per file; git-diffable, merge-friendly
lib/features.js                 Layer 3: observable board features (no interpretation)
lib/matchers.js                 Layer 4: which concepts the features license
lib/analyze.js                  the API, and Layer 5 wording
sources/sources.json            every source, with a confidence rating
state/research-state.json       resume checkpoint and counters
state/warnings_index.json       GENERATED: every recorded warning, evidence-graded
tests/test_api.js               the API suite, incl. false-positive regressions
state/coverage.json             per-concept coverage matrix
state/progress.md               human-readable running log
research/                       raw research notes, per session
tools/schema.json               the concept record schema
tools/validate_kb.py            schema + referential integrity checker
tools/sf_analyse.py             Stockfish harness (stdlib only)
education-bundle.json           compiled KB for the client (a committed artifact)
```

## Tools

```bash
python3 education/tools/validate_kb.py            # schema + referential integrity
python3 education/tools/run_tests.py              # educational-soundness tests
python3 education/tools/sync_state.py             # recompute coverage and counters
python3 education/tools/sf_analyse.py --probe
python3 education/tools/sf_analyse.py --fen "<FEN>" --depth 30 --multipv 3
python3 education/tools/tablebase.py --fen "<FEN>"   # <=7 pieces: proof, not evaluation
```

Run `validate_kb.py` and `run_tests.py` before and after any change to the base.
`validate_kb.py` enforces the schema; `run_tests.py` enforces the things that make
the knowledge educationally sound — that a guideline carries hedging wording, that a
constructed position is never dressed up as a game, that nothing reaches `ready`
without engine or tablebase evidence, and that every registered false-positive case
is answered before the concept it constrains is promoted.

`sf_analyse.py` is standard-library only, in keeping with the rest of the
project's Python, and finds Stockfish via `$STOCKFISH` or `PATH`. It does **not**
use `engine/stockfish.wasm` — that is the vendored GPL build the browser loads,
it is checksum-verified in `engine/CHECKSUMS.txt`, and research must not touch
it. Research uses a native Stockfish, which is both far stronger and irrelevant
to what ships.

`python-chess` is optional and used only to render SAN in tool output. Nothing in
the knowledge base depends on it.

## Ground rules

- **Research names concepts. The engine validates moves.** Never the reverse.
  A Stockfish evaluation is never turned into chess terminology, and a concept
  is never asserted to apply because the engine liked the move.
- **Heuristics are labelled as heuristics.** Every concept carries an
  `epistemic_type`; rules of thumb carry mandatory hedging wording and their
  exceptions are a required field.
- **Uncertainty is stored, not resolved.** Where sources disagree about an
  origin, the record says `disputed` and keeps the competing claims.
- **Do not force a name onto every move.** Sometimes the true explanation is
  calculation. The system must be able to say so.
- **Tablebase beats engine beats author.** Under eight pieces the tablebase is
  proof and ends the question. An author's assertion is strong evidence about what
  an idea IS and weak evidence about whether a move works.
- **Positional concepts are held to a different standard than tactical ones.**
  Controlled pairs isolate a fork cleanly and cannot isolate an outpost at all; see
  METHODOLOGY.md. Positional concepts therefore stay at `researched` on evidence
  that would promote a tactical motif, and that is deliberate, not an oversight.

## Status

See `state/research-state.json` for the machine-readable checkpoint and
`state/progress.md` for the narrative log. That checkpoint also records what did
NOT work: `failed_research_attempts` and `tool_limitations` exist so a later
session does not repeat a dead end. Read them before designing a new test.
