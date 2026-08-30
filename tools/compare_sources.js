#!/usr/bin/env node
/* Which bots produce puzzles worth showing?
 *
 * Raw puzzle count is the wrong question and answering it is how the corpus
 * filled up with hanging rooks. A weak rung blunders constantly and almost
 * every blunder it makes is the kind obvious() throws away; a strong rung
 * blunders rarely and, when it does, the refutation is something a player has
 * to find. So the comparison has to be about the *shape* of what each source
 * produces, not the volume.
 *
 * Reads the tally out of each run's log and the lines out of its pool.
 *
 *   node tools/compare_sources.js <label>=<dir> [<label>=<dir> …]
 */

'use strict';
const fs = require('fs');
const path = require('path');

// what a rejection says about the source that produced it
const CRUDE = ['takes the piece that just moved', 'takes what the last move hung',
               'free piece', 'won at once'];              // the mistake was a giveaway
const SHALLOW = ['one move', 'mate in one'];              // nothing left to calculate
const THIN  = ['no advantage won', 'nothing to save', 'still lost', 'neither',
               'wins anyway', 'already better', 'no mistake'];   // not worth showing
const VAGUE = ['ambiguous', 'two mates'];                 // more than one right answer

const rows = [];
for (const arg of process.argv.slice(2)){
  const [label, dir] = arg.split('=');
  let log = '';
  try { log = fs.readFileSync(path.join(dir, 'log.txt'), 'utf8'); } catch (e){ continue; }
  const tally = {};
  for (const m of log.matchAll(/^ {4}([~a-z][a-z:()~ ]*?) +(\d+) +[\d.]+%$/gm))
    tally[m[1].trim()] = +m[2];
  // the funnel lines are printed like any other, but they are stages not reasons
  for (const m of log.matchAll(/^ {4}(~[a-z ]+) +(\d+)/gm)) tally[m[1].trim()] = +m[2];
  const games = (log.match(/(\d+) games/g) || []).pop();
  const played = games ? +games.split(' ')[0] : 0;

  let pool = { opening:[], middlegame:[], endgame:[] };
  try { pool = JSON.parse(fs.readFileSync(path.join(dir, 'pools.json'), 'utf8')); } catch (e){}
  const all = [].concat(pool.opening, pool.middlegame, pool.endgame);
  const sum = k => (tally[k] || 0);
  const many = list => list.reduce((n, k) => n + sum(k), 0);

  const examined = sum('~examined') || 1;
  const judged = Object.entries(tally)
    .filter(([k]) => k[0] !== '~' && k !== 'kept' && k.indexOf('kept:') !== 0)
    .reduce((n, [, v]) => n + v, 0) + sum('kept');

  rows.push({
    label, played,
    kept: all.length,
    per100: played ? (100 * all.length / played) : 0,
    plausible: 100 * all.length / examined,
    crude: 100 * many(CRUDE) / examined,
    shallow: 100 * many(SHALLOW) / examined,
    thin: 100 * many(THIN) / (judged || 1),
    vague: 100 * many(VAGUE) / (judged || 1),
    depth: all.length ? all.reduce((n, p) => n + p.moves.length, 0) / all.length : 0,
    ope: pool.opening.length, mid: pool.middlegame.length, end: pool.endgame.length
  });
}

const f = (n, d) => n.toFixed(d === undefined ? 1 : d);
console.log('');
console.log('source           games  kept  /100g  plausible  crude  shallow   thin  ambig  depth   O/M/E');
console.log('--------------------------------------------------------------------------------------------');
for (const r of rows)
  console.log(r.label.padEnd(16) +
    String(r.played).padStart(5) + String(r.kept).padStart(6) +
    f(r.per100, 2).padStart(7) + (f(r.plausible) + '%').padStart(11) +
    (f(r.crude) + '%').padStart(7) + (f(r.shallow) + '%').padStart(9) +
    (f(r.thin) + '%').padStart(7) + (f(r.vague) + '%').padStart(7) +
    f(r.depth, 1).padStart(7) + ('  ' + r.ope + '/' + r.mid + '/' + r.end).padStart(9));
console.log('');
console.log('  plausible = kept as a share of turning points examined (the mistake was not a giveaway');
console.log('              and there was something to calculate)');
console.log('  crude     = of those, rejected because the previous move handed the answer over');
console.log('  shallow   = rejected because nothing was left to calculate');
console.log('  thin/ambig= of everything judged: no real benefit / more than one right answer');
console.log('  depth     = mean plies in the accepted solutions');
