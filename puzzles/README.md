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

## Regenerating

```bash
node tools/generate_puzzles.js --jobs 12 --seed 21
```

Then bump the `?v=` on the three JSON files in `blind-chess.html`, because
`server/server.py` serves them with a week of cache. Regenerating renumbers
the ladders; progress is stored per puzzle id, so a player keeps whatever they
have already solved and loses only their place in the numbering.
