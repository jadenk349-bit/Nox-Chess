#!/usr/bin/env node
/* Stage 2: what survived, and what is still needed.
 *
 * Reads the checkpoint logs rather than the rewritten files, because a run
 * that was stopped and resumed has its full record in the progress log and
 * only its finished tracks in the json. */
'use strict';
const fs = require('fs');
const V = require('../tools/verify_puzzles.js');

const TRACKS = ['opening', 'middlegame', 'endgame'];
const TARGET_PER_POOL = 100, POOLS = 5;

let kept = 0, dropped = 0;
const why = {};
console.log('=== STAGE 2 — deficit calculation ===\n');
console.log('existing corpus, re-verified against the complete new standard:\n');
for (const t of TRACKS){
  const file = 'work/stage1/' + t + '.json';
  let all = [];
  try { all = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e){}
  const done = V.loadProgress(file);
  let k = 0, d = 0;
  for (const r of done.values()){
    if (r.puzzle) k++;
    else {
      d++;
      const w = ((r.note || {}).dropped || 'unknown').split('(')[0].trim();
      why[w] = (why[w] || 0) + 1;
    }
  }
  kept += k; dropped += d;
  console.log('  ' + t.padEnd(11) + ' scanned ' + String(done.size).padStart(4) +
              '   kept ' + String(k).padStart(4) + '   discarded ' + String(d).padStart(4));
}
console.log('  ' + ''.padEnd(11) + ' scanned ' + String(kept + dropped).padStart(4) +
            '   kept ' + String(kept).padStart(4) + '   discarded ' + String(dropped).padStart(4));

console.log('\nwhy they were discarded:');
for (const [k, v] of Object.entries(why).sort((a, b) => b[1] - a[1]))
  console.log('  ' + String(v).padStart(5) + '  ' + k);

const target = TARGET_PER_POOL * POOLS;
const deficit = Math.max(0, target - kept);
console.log('\ntarget ' + target + ' (' + TARGET_PER_POOL + ' x ' + POOLS + ' pools)');
console.log('survivors ' + kept + '  ->  deficit ' + deficit);

/* How many games that deficit is worth mining for.
 *
 * The yield to use is the one this run just measured rather than the one
 * predicted beforehand: survivors / 788 is the fraction of an *already
 * verified* corpus that clears the new bar, and the old corpus itself came
 * out of 6245 games. Multiplying the two gives shipped-per-game under the
 * full standard, which is the only number that matters here. A floor keeps a
 * pessimistic measurement from asking for an absurd run; a ceiling keeps an
 * optimistic one from under-mining. */
const OLD_GAMES = 6245, OLD_CORPUS = 788;
const survivalRate = (kept + dropped) ? kept / (kept + dropped) : 0.25;
const perGame = (OLD_CORPUS / OLD_GAMES) * survivalRate;
let games = deficit > 0 ? Math.ceil(deficit / Math.max(perGame, 0.005)) : 0;
games = Math.max(2000, Math.min(20000, games));
console.log('\nmeasured survival of a verified corpus: ' + (survivalRate * 100).toFixed(1) + '%');
console.log('implied shipped-per-game:              ' + perGame.toFixed(4));
console.log('games to mine for the deficit:         ' + games + '  (clamped to 2000..20000)');
fs.writeFileSync('work/games.txt', String(games));
fs.writeFileSync('work/deficit.json', JSON.stringify(
  { kept, dropped, why, target, deficit, survivalRate, perGame, games }, null, 1));
