# Generated puzzles

**Nothing here was imported.** These positions came out of this game playing
itself, were chosen by the vendored Stockfish in `engine/`, and were tagged by
`findMotifs()` — the same function that writes the Study Board coach card in
`blind-chess.html`. No Lichess, chess.com or other puzzle set was used, in
whole or in part. Same provenance convention as `engine/README.md`, for the
opposite reason: that directory is somebody else's code, and this one is
nobody's but ours.

These files are the **Puzzles** feature only. Study Board analyses the game the
player just finished and never reads them.

## This set

| | |
|---|---|
| Generated | 2026-08-24 |
| Self-play games | 432 |
| Random seed | `21` |

| Track | Puzzles | Chosen from | Easiest | Median | Hardest |
|---|---|---|---|---|---|
| opening | 100 | 301 | 100 | 1600 | 2800 |
| middlegame | 100 | 313 | 100 | 1600 | 3000 |
| endgame | 100 | 300 | 100 | 2000 | 3200 |

Each track is an ordered ladder: `n` 1 to 100, puzzle 1 the easiest and
puzzle 100 the hardest. The player walks it in order, one unlocked by the last.

| Track | Audited | Repaired | `followUp` |
|---|---|---|---|
| opening | 2026-08-26, sweep 20 / verdict 28 | 1 of 100 (`n` 19: the defence was 241cp short of best, and the true best defence leaves nothing to find, so the line is one move now) | 6 plies, all 100 |
| middlegame | — | — | — |
| endgame | — | — | — |

### Themes

| Theme | Puzzles |
|---|---|
| `hangingPiece` | 165 |
| `longGame` | 145 |
| `pin` | 85 |
| `discoveredAttack` | 62 |
| `fork` | 57 |
| `trappedPiece` | 55 |
| `skewer` | 44 |
| `mate` | 7 |

## How they were made

Bot against bot, rungs drawn from `LEVELS` in the page (800, 1000, 1300, 1600, 2000, 2400
Elo), because games between equal and perfect engines contain no mistakes and
therefore no puzzles. The first 4–6 plies of each game are random, weighted
towards moves that look like chess, so the set is not four openings deep. Games
are played until every track has a pool of 300 candidates to choose from,
rather than to a fixed count: endgames are several times rarer than
middlegames, and a fixed count starves one to overshoot the other.

After every move the position is swept at depth 12 and, if it looks
sharp, examined at depth 16 with two lines. A position is a puzzle when
the best move beats the second best by 150cp or more, or forces a mate the
runner-up does not — "only one strong move", the same MultiPV gap the review
screen uses to tell a Great move from a merely best one. The solution is then
extended by splicing in the engine's own best defence and asking again, until
the position is no longer that sharp, a clear material win is reached, or mate.

A candidate still has to be worth showing. A recapture on the square just
captured on is forced rather than found, and a move that `findMotifs()` has
nothing to say about, which gives no check and wins no material, would reach
the player with an explanation that explains nothing. Both are dropped.

## How the hundred are chosen

The survivors are ranked, and the ladder is a hundred rungs **evenly spaced in
difficulty** between the easiest thing found and the hardest — not the hardest
hundred, not the first hundred, and not every third puzzle in the pool. That
last one is the obvious method and the wrong one: self-play turns up far more
easy tactics than hard ones, so spacing by position spends the first quarter of
a track on puzzles that are all exactly as easy as each other. The rank key is

```
seedRating + 40·settleDepth + 60·(plies−1) + 120·(quiet move) + 150·(sacrifice)
```

`seedRating` leads because it is the only measurement of a player-like solver:
the puzzle's first move is replayed against every rung of the ladder — chance
switched off, best of three, because Skill Level scrambles the engine's own
choice on purpose — and the lowest rung that finds it twice names the rating
(2800 when none does). It has ten possible values and a hundred puzzles to
order, so the rest of the key breaks its ties with what actually makes a move
hard to see: the depth the search had to reach before it stopped changing its
mind, the number of moves in the line, whether the move captures or checks
anything at all, and whether it gives material away first.

It is a rank key, not an Elo. What the player is shown is `seedRating`, and
what corrects it is real attempts, through the Elo update in
`server/server.py`.

Analysis is bounded by depth rather than by time, so the puzzle *criteria* do
not depend on how fast the machine is. Regeneration is still not bit-for-bit
reproducible: Stockfish seeds its Skill Level randomness from the clock, so the
self-play games and the seed ratings both wander a little between runs even at
the same `--seed`.

## Auditing what shipped

The generator judges a position once, at `confirmDepth`, splices its own best
defence in and judges the next one — so every ply of a solution was chosen by a
search that had only just arrived at it. `tools/verify_puzzles.js` asks again
from outside, at a depth the generator cannot afford over a whole corpus, and
where the two disagree the file is wrong: the player is being told to play a
move the engine does not play, and the referee in the page accepts nothing
else. Both colours are audited, because a puzzle whose defence walks into the
tactic teaches a tactic that is not there.

Two depths, because one alone is either too slow to run over a hundred puzzles
or too shallow to be trusted with them. The sweep at depth 20 only notices that
the engine would play something else; the verdict at depth 28 is the only thing
allowed to call a move wrong. The split is what the tool is for: run as one
pass at depth 22 it called six of the hundred opening puzzles wrong, and a look
at depth 26 sided with the file on five of the six.

A disagreement is repaired rather than deleted. The line is cut at the offending
ply, the engine's own move goes in, and it is extended by the generator's rule —
best defence, ask again, stop when there is no longer one strong move. A track
is a hundred rungs and has to stay a hundred rungs, so a puzzle keeps its place
in the ladder; what it does not keep is its `id`, which is the hash of the fen
and the moves and therefore changes with them.

```bash
node tools/verify_puzzles.js --track opening                        # report
node tools/verify_puzzles.js --track opening --followup 6 --write   # repair
```

## The follow-up: `follow`, or `followUp`

Optional, and only on tracks that have been through the audit. A solution is
extended only while there is still exactly one strong move to find, which
usually stops it a move or two before the material actually changes hands — so
a player who has just found the move is holding a position whose point has not
happened yet. The follow-up is best play from *both* sides from there, so what
it shows is the best the defence has rather than a line that only works if the
opponent helps. Show Follow Up on the puzzle card plays it out.

Two shapes, because the two ladders were checked by different runs of the tool.
`follow` is an object — the line, the score it arrives at (`cp` or `mate`), the
material it wins (`swing`), and the score the puzzle started at (`startCp` /
`startMate`, which is what lets the card tell a move that wins from a move that
is merely the best of a lost position). `followUp` is the older shape: the line
on its own, with nothing said about where it ends. The page reads either,
through `pzFollowOf()`; a track re-verified with `--write` comes back carrying
`follow` and loses `followUp`, so nothing should read that field directly.

It lives in the file rather than being searched for in the browser because the
puzzle screen has no engine in it, deliberately, and `test_puzzle_flow.js`
asserts that it never grows one.

## Regenerating

```bash
node tools/generate_puzzles.js --jobs 12 --seed 21
```

Then bump the `?v=` on the three JSON files in `blind-chess.html`, because
`server/server.py` serves them with a week of cache. Regenerating renumbers
the ladders; progress is stored per puzzle id, so a player keeps whatever they
have already solved and loses only their place in the numbering.

<!-- verified: begin -->

## Checked against the engine

Written by `tools/verify_puzzles.js`, which replays every move of every
puzzle in a track and rebuilds any line the engine no longer agrees with.
The row is the **last run**, not a history: *repaired* counts what that run
rewrote, and a second run over a file already checked rewrites nothing — see
the git history for what changed. *Dull* puzzles are still the best move but
no longer beat the runner-up by 150cp at this depth, which is reported and
left alone. *Follow-up* counts the puzzles carrying a continuation for the
Show Follow-up button — a line that ends in mate has none.

| Track | Checked | Depth | Puzzles | Repaired | Dull | Follow-up |
|---|---|---|---|---|---|---|
| `middlegame` | 2026-08-26 | 18 | 100 | 0 | 36 | 97 |

<!-- verified: end -->
