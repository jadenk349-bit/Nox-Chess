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
| Generated | 2026-08-27 |
| Self-play games | 6245 |
| Positions judged | 65624 |
| Random seed | `1` |

| Track | Mined | Chosen from | Punish | Save | Easiest | Median | Hardest |
|---|---|---|---|---|---|---|---|
| opening | 255 | 255 | 187 | 68 | 100 | 500 | 3200 |
| middlegame | 600 | 694 | 229 | 371 | 100 | 500 | 3200 |
| endgame | 228 | 228 | 76 | 152 | 100 | 100 | 3000 |

**Mined**, not shipped. This table is the record of the run that found these
positions, judged at depth 16; `tools/verify_puzzles.js` then takes the same
verdict again at depth 22 from outside, and drops what no longer clears it.
What actually shipped, and how much the second opinion removed, is the
*Checked against the engine* table at the bottom of this file.

A track is however many positions cleared the standard, not a fixed hundred.
That is deliberate and it is the whole difference between this set and the one
before it: padding a ladder to a round number means keeping puzzles that did
not earn their place, and one bad puzzle costs more than ten missing ones,
because it teaches a player to look for something that is not there.

Each track is still an ordered ladder — `n` 1 to however many, puzzle 1 the
easiest and the last one the hardest, walked in order, one unlocked by the last.

## What makes a position a puzzle

Bot against bot, rungs drawn from `LEVELS` in the page (800, 1000, 1300, 1600, 2000, 2400
Elo), because games between equal and perfect engines contain no mistakes and
therefore no puzzles. The first 4–6 plies of each game are random, weighted
towards moves that look like chess, so the set is not four openings deep — and
nothing from inside that stretch is ever a puzzle, since a position is only
offered when the move that created it was one a bot chose.

The rule itself is `judge()` in `tools/puzzle_rules.js`, and it is the only
copy of it: the generator asks it while mining and the verifier asks it again,
deeper, over what shipped. Three numbers, all from the **solver's** point of
view — the side to move in the puzzle's position:

| | |
|---|---|
| `B` | what the position was worth **before the opponent's last move** |
| `A1` | what it is worth now, if the solver finds the move |
| `A2` | what it is worth now, if the solver plays the second-best move |

and three questions:

- **`A1 − B` — the mistake.** At least 200cp. The opponent has to have
  thrown something away, or the position is merely sharp and always was, and
  the card would be saying "they blundered" about a move that did not.
- **`A1 − A2` — the point.** At least 200cp, measured by playing both moves
  and scoring what they lead to rather than by reading two numbers off one
  MultiPV list. Below it, the player who finds the other move is told they are
  wrong about a move that was just as good.
- **`B`, `A1`, `A2` — the stakes.** Which decides what kind of puzzle it is:

**Punish** — `B` no better than +150 (level, or only slightly for the
solver), `A1` at least +400, and `A2` no better than +250. Something
was there to be won, finding it is what wins it, and it was not already won.

**Save** — `B` at or below -250 (the solver was worse, often lost), `A2`
at or below -250 (there is something to be saved from), and `A1` at least
-80: the move has to hold the balance or better. "The best move in a lost
position" is not a save, and refusing it is the single criterion that removes
most of what the previous set called a middlegame puzzle.

Two moves that both force mate are refused as well, however different the move
counts: the board accepts one of them, and a player who finds the other is
told they are wrong.

That is a strict rule and this is what it turned away.

| Refused because | Positions | |
|---|---|---|
| `ambiguous` | 25246 | 38.5% |
| `wins anyway` | 16737 | 25.5% |
| `no advantage won` | 12914 | 19.7% |
| `two mates` | 3598 | 5.5% |
| `no mistake` | 2857 | 4.4% |
| `neither` | 2178 | 3.3% |
| `already better` | 515 | 0.8% |
| `nothing to save` | 230 | 0.4% |
| `recapture` | 121 | 0.2% |
| `still lost` | 84 | 0.1% |
| `free piece` | 63 | 0.1% |
| `nothing to say` | 10 | 0.0% |

Something can pass all of that and still not be worth showing. A recapture on
the square just captured on is forced rather than found; a piece lifted off the
board in one move with no pattern behind it teaches looking for undefended
pieces, which players do anyway; a move with only one legal square is not a
decision. Those are `trivial()`, beside the rule.

## Opening, middlegame, endgame

By what is on the board, not by the move number. Endgame is asked first,
because it is the one of the three with a real definition — few enough pieces
that the king is a fighting piece — and it is answered on material, with a
queen still on counting for more than what is left beside it. Opening is a
position with opening work still in it: most of the pawns there, pieces still
standing where they started. Everything else is a middlegame. A queen trade on
move nine leaves an endgame however early it is, and a game that shuffles to
move forty with all sixteen pieces on has not reached one.

## What the card says at the end

Every puzzle carries a `why`, written by `tools/puzzle_words.js` beside the
moves: what the opponent's move gave away, a sentence for each ply — including
why the runner-up move is not the answer and how forced each defence was — and
where the whole thing arrives. It is in the file because the puzzle screen has
no engine in it, deliberately, and `server/test_puzzle_flow.js` asserts that it
never grows one.

None of it is guessed. Every sentence is read off a position or off a number a
search already produced, and where nothing can be justified the card is shorter
instead — the discipline being that a confident sentence about a deflection
that is not on the board is worse than no sentence at all.

A freshly generated file has no `why` and no `follow`; both are written by
`tools/verify_puzzles.js`, which is also the only thing that measures them at
the verdict depth.

### Themes

| Theme | Puzzles |
|---|---|
| `defensiveResource` | 591 |
| `hangingPiece` | 450 |
| `longGame` | 345 |
| `pin` | 225 |
| `discoveredAttack` | 201 |
| `fork` | 190 |
| `trappedPiece` | 180 |
| `skewer` | 148 |
| `removalOfDefender` | 127 |
| `sacrifice` | 87 |
| `kingAttack` | 75 |
| `pawnBreakthrough` | 64 |
| `zwischenzug` | 36 |
| `positionalTactic` | 26 |
| `mate` | 13 |
| `promotion` | 12 |
| `exchangeSacrifice` | 3 |
| `backRank` | 1 |

The first nine of those names are `findMotifs()`'s, the same function behind the
Study Board coach card, so a puzzle tagged `fork` is explained with the word
fork. The rest are what a whole puzzle carries and a single move does not: what
kind of answer it was, what it cost, and the two that are about the move before
it. Deflection, decoy, overloading, interference and double attack are
deliberately **not** claimed — each is an assertion about *why* a piece cannot
do its job, every cheap test for them fires where it is not true, and a puzzle
labelled with a tactic that is not there is worse than one labelled with a tag
fewer.

## The order of a ladder

The survivors are ranked, and the ladder is spaced **evenly in difficulty**
between the easiest thing found and the hardest — not the hardest of them, not
the first of them, and not every third puzzle in the pool. That last one is the
obvious method and the wrong one: self-play turns up far more easy tactics than
hard ones, so spacing by position spends the first quarter of a track on
puzzles that are all exactly as easy as each other. The rank key is

```
seedRating + 40·settleDepth + 60·(plies−1) + 120·(quiet move) + 150·(sacrifice)
```

`seedRating` leads because it is the only measurement of a player-like solver:
the puzzle's first move is replayed against every rung of the ladder — chance
switched off, best of three, because Skill Level scrambles the engine's own
choice on purpose — and the lowest rung that finds it twice names the rating
(2800 when none does). It has ten possible values and many more puzzles to
order, so the rest of the key breaks its ties with what actually makes a move
hard to see: the depth the search had to reach before it stopped changing its
mind, the number of moves in the line, whether the move captures or checks
anything at all, and whether it gives material away first.

It is a rank key, not an Elo. What the player is shown is `seedRating`, and
what corrects it is real attempts, through the Elo update in
`server/server.py`.

Analysis is bounded by depth rather than by time, so the puzzle *criteria* do
not depend on how fast the machine is — and every search that measures a
position rather than playing one is made with contempt switched off. That last
one is not a detail: this build applies contempt from the point of view of
whoever is to move at the root, so `B` and `A1` are read from opposite sides
and the same position comes out ~50cp better after any move than before it.
Left on, every move in every game looks like a blunder by exactly that much,
and the mistake this whole standard is built on is an artefact.

Regeneration is still not bit-for-bit reproducible: Stockfish seeds its Skill
Level randomness from the clock, so the self-play games and the seed ratings
both wander a little between runs even at the same `--seed`.

## Regenerating

```bash
node tools/generate_puzzles.js --games 1600 --jobs 12 --seed 1
```

Then check each track, which is where the verdict is taken at depth, the
explanations are written and the follow-ups are searched:

```bash
node tools/verify_puzzles.js --track middlegame --write --resort
```

Then bump the `?v=` on the three JSON files in `blind-chess.html`, because
`server/server.py` serves them with a week of cache. Regenerating renumbers
the ladders; progress is stored per puzzle id, so a player keeps whatever they
have already solved and loses only their place in the numbering.

<!-- verified: begin -->

## Checked against the engine

Written by `tools/verify_puzzles.js`, which replays every move of every
puzzle in a track, rebuilds any line the engine no longer agrees with, and
then asks of the whole thing the question a per-ply check cannot: is this
still a turning point? The row is the **last run**, not a history — see the
git history for what changed. *Depth* is the verdict depth. *Repaired*
counts lines rewritten because a move was not the engine's. *Dropped*
counts puzzles removed because the position was not one worth showing —
nobody had blundered, the solver was already winning, the solver was lost
either way, or two moves were equally good. *Dull* puzzles are still the
best move but no longer clear of the runner-up at the sweep depth, which is
reported and left alone. *Follow-up* counts the puzzles carrying a
continuation for the Show Follow Up button — a line that ends in mate has
none.

| Track | Checked | Depth | Puzzles | Repaired | Dropped | Dull | Follow-up |
|---|---|---|---|---|---|---|---|
| `endgame` | 2026-08-27 | 24 | 104 | 0 | 28 | 9 | 103 |
| `middlegame` | 2026-08-27 | 24 | 191 | 1 | 162 | 31 | 187 |
| `opening` | 2026-08-27 | 24 | 41 | 1 | 93 | 7 | 41 |

<!-- verified: end -->
