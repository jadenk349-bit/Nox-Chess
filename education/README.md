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

## Reading order for a new session

1. `ARCHITECTURE.md` — the design, and the hard separation between what research
   decides and what the engine decides.
2. `METHODOLOGY.md` — how research and validation are actually conducted.
3. `state/research-state.json` — what is done, in progress, and untouched.
4. `TAXONOMY.md` / `taxonomy.json` — the full scope and its status.

`state/research-state.json` is the resume point. It is written so that a fresh
Claude Code session, on a different machine, can continue without re-deriving
anything.

## Layout

```
concepts/<category>/<id>.json   one concept per file; git-diffable, merge-friendly
positions/<id>/                 engine-validated example positions
sources/sources.json            every source, with a confidence rating
state/research-state.json       resume checkpoint and counters
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
python3 education/tools/validate_kb.py            # check the whole base
python3 education/tools/validate_kb.py --strict   # also fail on warnings
python3 education/tools/sf_analyse.py --probe
python3 education/tools/sf_analyse.py --fen "<FEN>" --depth 30 --multipv 3
```

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

## Status

Scaffolding complete; deep research beginning. See `state/progress.md`.
