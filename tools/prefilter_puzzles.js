#!/usr/bin/env node
/* Dropping what no amount of engine time could save.
 *
 * The verifier will refuse these anyway; the only question is whether it
 * spends a minute of Stockfish 18 on each one first. obvious() is board logic
 * and deterministic, so for the reasons that a *longer line* cannot change,
 * the answer is already known and the search is pure waste.
 *
 * The distinction is the whole point of this file, and getting it wrong would
 * silently shrink the corpus:
 *
 *   safe to drop here   the previous move announced the answer, the piece was
 *                       free, all the material arrived at once, it is mate in
 *                       one — all read off the first move and the one before
 *                       it, neither of which extending changes. And a one-move
 *                       line that has *already* banked its material, because
 *                       paidOff() stops the line there: it cannot grow.
 *
 *   must be searched    a one-move line that has not paid off yet. That is
 *                       exactly the puzzle the verifier is supposed to carry
 *                       on to its payoff, and pre-judging it on its current
 *                       length would throw away the ones that grow.
 *
 *   node tools/prefilter_puzzles.js            # report
 *   node tools/prefilter_puzzles.js --write    # and act on it
 */

'use strict';

const fs = require('fs');
const path = require('path');
const P = require('./page_chess.js');
const R = require('./puzzle_rules.js');

const write = process.argv.includes('--write');
// --dir lets a staging set be filtered without touching what has shipped
const dirArg = process.argv.indexOf('--dir');
const DIR = dirArg > 0 ? process.argv[dirArg + 1] : path.join(__dirname, '..', 'puzzles');

/** Could a longer line change this verdict? */
function fixableByLength(rec, why){
  if (why !== 'one move') return false;
  let st = P.stateFromFEN(rec.fen);
  const solver = st.turn;
  for (const u of rec.moves){
    const m = R.uciFind(st, u);
    if (!m) return false;
    st = P.makeMove(st, m);
  }
  // paidOff() is where a line stops, so one that has already paid off is one
  // the verifier would not extend either
  return !R.paidOff(rec.fen, st, solver);
}

let scanned = 0, kept = 0, dropped = 0;
const why = {};
for (const track of ['opening', 'middlegame', 'endgame']){
  const file = path.join(DIR, track + '.json');
  const all = JSON.parse(fs.readFileSync(file, 'utf8'));
  const survive = [];
  for (const p of all){
    scanned++;
    const bad = R.obvious(p);
    if (bad && !fixableByLength(p, bad)){
      dropped++; why[bad] = (why[bad] || 0) + 1;
      continue;
    }
    survive.push(p);
  }
  kept += survive.length;
  survive.forEach((p, i) => { p.n = i + 1; });
  if (write) fs.writeFileSync(file, JSON.stringify(survive, null, 1) + '\n');
  console.log('  ' + track.padEnd(12) + String(all.length).padStart(4) + ' -> ' +
              String(survive.length).padStart(4) + ' to search  (' +
              (all.length - survive.length) + ' cannot be saved by a longer line)');
}
console.log('\n  scanned ' + scanned + ', kept ' + kept + ' for the engine, dropped ' + dropped);
for (const [k, n] of Object.entries(why).sort((a, b) => b[1] - a[1]))
  console.log('    ' + k.padEnd(32) + String(n).padStart(4));
if (!write) console.log('\n  (report only; --write to act on it)');
