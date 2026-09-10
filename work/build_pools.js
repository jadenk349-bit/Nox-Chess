#!/usr/bin/env node
/* Stage 6: one verified corpus, five non-overlapping pools.
 *
 * Survivors come from two places — the re-verified old corpus and the newly
 * mined one — and both have been through the identical standard, so this is a
 * union rather than an update and neither side takes precedence. Everything
 * about how the deal works, and why it is a deal rather than a hash or a
 * filter, is in tools/pool_assign.js. */
'use strict';
const fs = require('fs');
const path = require('path');
const V = require('../tools/verify_puzzles.js');
const POOL = require('../tools/pool_assign.js');
const PAY = require('../tools/payoff_rules.js');
const R = require('../tools/puzzle_rules.js');

const TRACKS = ['opening', 'middlegame', 'endgame'];
const SOURCES = ['work/stage1', 'work/gen'];

console.log('=== STAGE 6 — building the five pools ===\n');

const all = [];
for (const dir of SOURCES){
  for (const t of TRACKS){
    const file = path.join(dir, t + '.json');
    /* ONLY the checkpoint log, never the json beside it.
     *
     * The log is a record of *verification results*; the json in a source
     * directory is whatever was staged there to be verified. In work/stage1
     * those are the untouched originals, and an earlier version of this file
     * fell back to reading them whenever a track had no checkpoint yet — so a
     * run stopped before the endgame track began contributed 265 puzzles that
     * no engine had looked at, 98 of which cleared the payoff gate on their
     * stored evidence and would have shipped unverified. A track with no
     * results contributes nothing. That is the only safe reading, and the
     * difference is invisible in the totals unless you know to look. */
    const done = V.loadProgress(file);
    let n = 0;
    for (const r of done.values()) if (r.puzzle){ all.push(r.puzzle); n++; }
    console.log('  ' + (dir + '/' + t).padEnd(26) + String(n).padStart(5) + ' verified' +
                (done.size ? '' : '   (no results yet — contributes nothing)'));
  }
}
console.log('  ' + 'total collected'.padEnd(26) + String(all.length).padStart(5));

/* A last gate before anything ships. Everything here has already passed the
   payoff rule inside the verifier; asking again costs nothing (no engine) and
   catches a record that reached this file by some other route. */
const good = [], rejected = [];
for (const p of all){
  const r = PAY.payoffOf(p);
  if (r.ok) good.push(p); else rejected.push({ id: p.id, why: r.why });
}
if (rejected.length){
  console.log('\n  refused at the final gate: ' + rejected.length);
  for (const r of rejected.slice(0, 10)) console.log('    ' + r.id + '  ' + r.why);
}

/* ---- the best 500, and 38 held in reserve ----
 *
 * Five pools of exactly 100 needs 500 of the 538, so 38 have to stand down.
 * *Which* 38 is a real decision and there are two candidate orderings already
 * in the project, which mean opposite things:
 *
 *   difficulty()   the ladder rank key. Cutting the bottom of it would drop
 *                  the 38 *easiest* puzzles — and every pool is walked in
 *                  order, easiest rung first, so that removes each ladder's
 *                  on-ramp. Easy is not the same as bad.
 *
 *   how far clear  how decisively a puzzle cleared the standard it had to
 *   of the bar     meet. That is a quality ordering rather than a difficulty
 *                  one, and it is what "strongest" should mean here.
 *
 * So the cut is made on quality and the difficulty spread is left intact.
 * Quality is the *minimum* of the two margins the standard actually measures,
 * because a puzzle is only as good as its weakest qualifying axis: a huge gap
 * over the runner-up means little if the opponent's mistake was barely worth
 * 200cp, and vice versa. Both margins are clamped, so one puzzle with a mate
 * score of +11000 cannot outrank fifty sound ones on arithmetic alone.
 *
 * Nothing here is a chess standard. Every one of the 538 has already passed
 * every gate; this only decides which of them are on the shelf today. The 38
 * are written out whole, keep their ids, and can be promoted later. */
const QUALITY_CAP = 800;           // margin above the bar past which more stops counting
const clamp = v => Math.max(0, Math.min(QUALITY_CAP, v));
function quality(p){
  const e = p.eval || {};
  if (e.best === null || e.best === undefined) return 0;
  const gap = (e.alt === null || e.alt === undefined) ? 0 : e.best - e.alt;
  const mistake = (e.before === null || e.before === undefined) ? 0 : e.best - e.before;
  return Math.min(clamp(gap - R.GAP_MIN), clamp(mistake - R.MISTAKE_MIN));
}

const ACTIVE = 500;
const byQuality = good.slice().sort((a, b) =>
  quality(b) - quality(a) ||
  // ties (both clamped at the ceiling) broken by the raw margins, then by id
  ((b.eval.best - b.eval.alt) + (b.eval.best - b.eval.before)) -
  ((a.eval.best - a.eval.alt) + (a.eval.best - a.eval.before)) ||
  (a.id < b.id ? -1 : 1));
const active = byQuality.slice(0, ACTIVE);
const reserve = byQuality.slice(ACTIVE);
console.log('\n  ranked by how far clear of the standard each puzzle cleared:');
console.log('    active  ' + active.length + '  quality ' +
            quality(active[active.length - 1]) + '..' + quality(active[0]));
if (reserve.length)
  console.log('    reserve ' + reserve.length + '  quality ' +
              quality(reserve[reserve.length - 1]) + '..' + quality(reserve[0]));

const { pools, dropped } = POOL.assign(active);
console.log('\n  deduplicated away: ' + dropped.length);
const byWhy = {};
for (const d of dropped) byWhy[d.why.split('(')[0].trim()] = (byWhy[d.why.split('(')[0].trim()] || 0) + 1;
for (const [k, v] of Object.entries(byWhy)) console.log('    ' + String(v).padStart(4) + '  ' + k);

const problems = POOL.check(pools);
if (problems.length){
  console.log('\n  *** INTEGRITY FAILURES ***');
  problems.slice(0, 20).forEach(s => console.log('    ' + s));
  process.exit(1);
}
console.log('\n  integrity: no duplicate id, no duplicate position, pools even, numbering contiguous');

fs.mkdirSync('puzzles/modes', { recursive: true });
console.log('\n  final pools:');
let tot = 0;
for (const k of POOL.KEYS){
  fs.writeFileSync('puzzles/modes/' + k + '.json', JSON.stringify(pools[k], null, 1));
  console.log('    ' + k.padEnd(11) + String(pools[k].length).padStart(4));
  tot += pools[k].length;
}
console.log('    ' + 'TOTAL'.padEnd(11) + String(tot).padStart(4));
/* The reserve, kept whole and kept out of every pool. Not served — it is not
   in server.py's allowlist — so it cannot reach a player by accident, and a
   later run can promote from it without re-verifying anything. */
fs.writeFileSync('puzzles/modes/reserve.json', JSON.stringify(
  reserve.map(p => Object.assign({}, p, { mode: 'reserve' })), null, 1));
console.log('    reserve    ' + String(reserve.length).padStart(4) + '  (held, not served)');

fs.writeFileSync('work/pools-summary.json', JSON.stringify(
  { counts: Object.fromEntries(POOL.KEYS.map(k => [k, pools[k].length])),
    total: tot, reserve: reserve.length, collected: all.length,
    deduped: dropped.length, refusedAtGate: rejected.length }, null, 1));
