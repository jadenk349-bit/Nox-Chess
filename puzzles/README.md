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

Those are the numbers generation produced, kept as the record of it. The
endgame track has since been re-checked and its numbers have moved; see
**The endgame pass**.

Each track is an ordered ladder: `n` 1 to 100, puzzle 1 the easiest and
puzzle 100 the hardest. The player walks it in order, one unlocked by the last.

`endgame.json` has since been through `tools/verify_puzzles.js` (see
**Re-checking a shipped set**, below); `opening.json` and `middlegame.json`
have not, which is why only the endgame track carries `followUp`.

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

## Re-checking a shipped set

Generation looks at a position once, at depth 16, on an engine that has just
been answering questions about other positions. That is enough to *find* a
puzzle and not always enough to be sure of it, so a set can be re-checked
afterwards:

```bash
node tools/verify_puzzles.js --track endgame           # report only
node tools/verify_puzzles.js --track endgame --write   # and save the fixes
```

Every ply of every solution is asked again at depth 22, on a table emptied
first (`fresh` in `tools/sf.js`) — without that the same position at the same
depth answers differently depending on what the engine looked at before it, and
a verdict that depends on which engine of the pool drew the puzzle is not a
verdict. A player's move has to be the engine's best; so does the defence's,
because a reply that is not the toughest one makes everything after it a
refutation of nothing. When a stored move is not the engine's, the two are
played and scored separately rather than read off one MultiPV ranking: a
shipped puzzle should only be overruled by two numbers arrived at the same way.

Every search in the pass asks for two lines, not one. A single-line search
prunes against the best move it already has, and in one position in this set it
answers Nxb7 at +15 and never mentions that Rxb7 is +63 — which MultiPV 2 finds
at the same depth. That is the fault this tool exists to correct, so it must
not be the way the tool searches; `buildLine()`'s defence and every follow-up
move are asked for two lines wide for that reason.

A ply that fails is corrected by keeping the prefix the engine already agreed
with and rebuilding the tail with the generator's own `buildLine()`. Themes are
then re-derived by `findMotifs()` and the seed rating re-measured against the
bot ladder, because both of them described the old line — and the track is
re-ranked and renumbered by the generator's own `difficulty()`, because a
seven-move line that only worked while the defence blundered is not as hard as
it was once the defence is fixed. **Ids are left alone**, so nobody loses a
solve; only the rung numbering moves, exactly as it does after a regeneration.

### `followUp`

The same pass writes each puzzle a follow-up: up to six more plies of best play
from where the solution stops, or fewer when the line ends in mate. Each of
those moves is a separate depth-20 search of the position it is played in,
never a tail read off one search's principal variation, so every move shown is
one the engine would actually have played there. The page walks them out behind
the **Show Follow Up** button once the puzzle is over. A puzzle that ends in
mate has no follow-up and no button.

### The endgame pass

| | |
|---|---|
| Verified | 2026-08-26 |
| Track | `endgame` |
| Depth | 22, follow-up 20 (six plies) |
| Solutions agreed with | 73 of 100 |
| Solutions corrected | 27 |
| Follow-ups written | 96; the other 4 end in mate |

Of the 27, most were the *defence* rather than the player: the reply the
generator spliced in was not the toughest one, and once it is, there is
nothing left to find. That is why the track is shorter than it was — 57
one-move puzzles against 50, and 7 seven-move ones against 13 — and why its
median seed rating fell from 2000 to 1600. A seven-move line that only ran
because the defence kept blundering was never a seven-move puzzle.

Two things the pass reports and does not act on. Thirty-three positions no
longer clear the generator's 150cp "one strong move" margin at depth 22, three
of them by nothing at all: the stored move is still the engine's, but a second
move now ties it, and a player who finds that one is told they are wrong. The
board matches on the stored move exactly, so closing that would mean teaching
`puzzleStep()` about alternatives, which is a change to the feature and not to
the file. And the ladder is not monotonic in `seedRating` — it never was:
`difficulty()` ranks on four things and the seed rating is only the first.

## Regenerating

```bash
node tools/generate_puzzles.js --jobs 12 --seed 21
```

Then bump the `?v=` on the three JSON files in `blind-chess.html`, because
`server/server.py` serves them with a week of cache. Regenerating renumbers
the ladders; progress is stored per puzzle id, so a player keeps whatever they
have already solved and loses only their place in the numbering.
