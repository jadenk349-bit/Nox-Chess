#!/usr/bin/env node
/* Two mining runs, one pool.
 *
 * Endgames are several times rarer than middlegames — a game has to survive
 * into one — so the practical way to fill three tracks is two runs: a general
 * one, and a second with --only endgame and longer games hunting the scarce
 * track. They are separate processes with separate `seen` sets, so the same
 * position can come out of both, and the ladder cut has to be made from one
 * pool or the spacing is done twice over half the range each time.
 *
 * Deduplicates on the fen, not the id: the id is a hash of the position *and
 * the line*, so two runs that found the same position and extended it by one
 * ply differently would keep both and offer the player the same puzzle twice.
 *
 *   node tools/merge_pools.js out.json tally.json a/pools.json b/pools.json …
 *
 * The tally is written beside it for --tallyIn, summed across the runs, with
 * the game counts read out of each run's log if one sits next to its pool.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const P = require('./page_chess.js');
const G = require('./generate_puzzles.js');

const [outFile, tallyFile, ...inputs] = process.argv.slice(2);
if (!outFile || !tallyFile || !inputs.length){
  console.error('usage: merge_pools.js <out.json> <tally.json> <pools.json…>');
  process.exit(2);
}

const pools = { opening: [], middlegame: [], endgame: [] };
const tally = {};
const seen = new Set();
let played = 0, dupes = 0, refiled = 0;

for (const file of inputs){
  const got = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const track of Object.keys(pools))
    for (const p of got[track] || []){
      if (seen.has(p.fen)){ dupes++; continue; }
      seen.add(p.fen);
      /* Filed by the *current* rule, not by the key it was stored under. Pools
         accumulate across runs, and bucketFor() has changed once already —
         from the move number to what is actually on the board. A merge that
         trusted the stored track would carry every record mined before that
         into the ladder its old rule chose, which is exactly the misfiling the
         new rule exists to stop. */
      const st = P.stateFromFEN(p.fen);
      const where = G.bucketFor(st);
      if (where !== track) refiled++;
      p.bucket = where;
      pools[where].push(p);
    }
  /* The run's own account of what it refused, out of the log it wrote beside
     its pool. Parsed rather than stored because the pool file is written after
     every batch and the tally is only printed when the run ends — a run that
     was stopped early has a pool and no tally, and that is not a reason to
     refuse to merge it. */
  const log = path.join(path.dirname(file), 'log.txt');
  let text = '';
  try { text = fs.readFileSync(log, 'utf8'); } catch (e){ /* no log kept */ }
  for (const m of text.matchAll(/^ {4}([a-z][a-z:() ]*?) +(\d+) +[\d.]+%$/gm))
    tally[m[1].trim()] = (tally[m[1].trim()] || 0) + (+m[2]);
  const games = text.match(/(\d+) games/g);
  if (games) played += +games[games.length - 1].split(' ')[0];
}

tally.__played = played;
fs.writeFileSync(outFile, JSON.stringify(pools));
fs.writeFileSync(tallyFile, JSON.stringify(tally, null, 1));
console.log('merged %d files: %s', inputs.length,
  Object.entries(pools).map(([k, v]) => k + ' ' + v.length).join(', '));
console.log('  %d duplicate positions dropped, %d refiled by the current rule, %d games played',
  dupes, refiled, played);
