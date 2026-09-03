'use strict';
/* A pawn-ending corpus, because the shipped one has none.
 *
 * state/COMPLETION.md has carried this gap for several sessions: "zero of the
 * 788 shipped positions is a pawn ending, so pawnBreakthrough() fires on none
 * and the corpus offers no evidence at all about its false-positive rate." A
 * detector nothing has ever been run against is not a validated detector, and a
 * 0.0% firing rate is not evidence of anything.
 *
 * So this generates pawn endings - kings and pawns only - through the page's own
 * move generator, keeps the legal ones, and runs the API over them. Every
 * position is a real board rather than a hand-written FEN: two of those were
 * wrong earlier in this project and both looked plausible.
 *
 * What makes this worth doing rather than merely possible is that a pawn ending
 * with seven men or fewer is inside the Syzygy tablebases, so the claim
 * `pawn-breakthrough` makes can be PROVED rather than estimated. The claim is
 * precise and narrow: accepting the offer loses. Not that the position is won -
 * the matcher's own note says a declined offer is a different question - so the
 * test is the position after the offer and after a capture of it, which the
 * tablebase answers outright.
 *
 *     node tools/pawn_endings.js [--n 400] [--seed 7] [--json out.json]
 *
 * The --json output is the input to tools/verify_breakthrough.py, which does the
 * tablebase half over the network.
 */
const fs = require('fs');
const path = require('path');
const FEAT = require('../lib/features.js');
const API = require('../lib/analyze.js');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const N = args.includes('--n') ? Number(args[args.indexOf('--n') + 1]) : 400;
const SEED = args.includes('--seed') ? Number(args[args.indexOf('--seed') + 1]) : 7;
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;

// Deterministic, so the corpus is the same on every machine and a change in the
// numbers is a change in the SYSTEM rather than in the dice.
let s = SEED >>> 0;
const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
const pick = xs => xs[Math.floor(rnd() * xs.length)];

const FILES = 'abcdefgh';
const P = FEAT.page;

function randomPawnEnding() {
  // 2-4 pawns a side. Fewer is a tablebase drill rather than a structure; more
  // stops being an ENDING and starts being a position with the pieces missing.
  const nw = 2 + Math.floor(rnd() * 3), nb = 2 + Math.floor(rnd() * 3);
  const board = {};
  const free = [];
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) free.push(r * 8 + c);
  const place = (sq, ch) => { board[sq] = ch; };
  const take = list => {
    for (let tries = 0; tries < 60; tries++) {
      const i = pick(list);
      if (board[i] === undefined) return i;
    }
    return -1;
  };
  // Pawns never on rank 1 or 8.
  const pawnSquares = free.filter(i => (i >> 3) > 0 && (i >> 3) < 7);
  for (let k = 0; k < nw; k++) { const i = take(pawnSquares); if (i < 0) return null; place(i, 'P'); }
  for (let k = 0; k < nb; k++) { const i = take(pawnSquares); if (i < 0) return null; place(i, 'p'); }
  const wk = take(free); if (wk < 0) return null; place(wk, 'K');
  const bk = take(free); if (bk < 0) return null; place(bk, 'k');
  // Kings may not touch.
  const dr = Math.abs((wk >> 3) - (bk >> 3)), dc = Math.abs((wk & 7) - (bk & 7));
  if (dr <= 1 && dc <= 1) return null;

  let fen = '';
  for (let r = 0; r < 8; r++) {
    let run = 0;
    for (let c = 0; c < 8; c++) {
      const ch = board[r * 8 + c];
      if (ch === undefined) { run++; continue; }
      if (run) { fen += run; run = 0; }
      fen += ch;
    }
    if (run) fen += run;
    if (r < 7) fen += '/';
  }
  const turn = rnd() < 0.5 ? 'w' : 'b';
  return `${fen} ${turn} - - 0 1`;
}

const positions = [];
let tried = 0;
while (positions.length < N && tried < N * 200) {
  tried++;
  const fen = randomPawnEnding();
  if (!fen) continue;
  let st;
  try { st = P.stateFromFEN(fen); } catch (e) { continue; }
  // The side NOT to move must not be in check: that is not a position, it is a
  // board with an illegal move already played on it.
  try { if (P.inCheck(st, st.turn === 'w' ? 'b' : 'w')) continue; } catch (e) { continue; }
  let moves;
  try { moves = P.legalMoves(st); } catch (e) { continue; }
  if (!moves.length) continue;            // stalemate or mate: a drill, not a study
  positions.push(fen);
}

const counts = new Map();
const leads = new Map();
const breaks = [];
let crashed = 0, silent = 0, templates = 0;
for (const fen of positions) {
  let r;
  try { r = API.analyzeWithEducation({ fen }); } catch (e) { crashed++; continue; }
  if (/\{[a-z_]+\}/.test(r.explanation.text)) templates++;
  if (!r.concepts_all.length) silent++;
  r.concepts_all.forEach((c, i) => {
    counts.set(c.id, (counts.get(c.id) || 0) + 1);
    if (i === 0) leads.set(c.id, (leads.get(c.id) || 0) + 1);
  });
  const bt = r.concepts_all.find(c => c.id === 'pawn-breakthrough');
  if (bt) {
    const f = FEAT.features(fen);
    const side = bt.subjects[0];
    breaks.push({ fen, side, claim: (f.breakthrough || {})[side] || null,
                  men: fen.split(' ')[0].replace(/[^A-Za-z]/g, '').length });
  }
}

const n = positions.length || 1;
console.log(`\nPAWN ENDINGS — ${positions.length} generated (seed ${SEED}), ${tried} boards tried\n`);
console.log(`  crashes                 ${crashed}`);
console.log(`  unfilled templates      ${templates}`);
console.log(`  licensed no concept     ${silent}  (${(100 * silent / n).toFixed(1)}%)`);
console.log(`  pawn-breakthrough fired ${breaks.length}  (${(100 * breaks.length / n).toFixed(1)}%)`);
console.log(`  ...of which 7 men or fewer, so tablebase-provable: ` +
            `${breaks.filter(b => b.men <= 7).length}\n`);
console.log('  CONCEPTS REPORTED');
for (const [c, k] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`    ${c.padEnd(24)} ${String(k).padStart(4)}  ${(100 * k / n).toFixed(1).padStart(5)}%` +
              `   leads ${leads.get(c) || 0}`);
}
console.log();

if (jsonOut) {
  fs.writeFileSync(path.join(ROOT, jsonOut), JSON.stringify({
    seed: SEED, generated: positions.length, tried,
    crashes: crashed, templates, silent,
    breakthroughs: breaks,
    concepts: Object.fromEntries([...counts.entries()].map(([c, k]) =>
      [c, { fires: k, rate: +(100 * k / n).toFixed(1), leads: leads.get(c) || 0 }])),
    positions,
  }, null, 2));
  console.log(`  wrote ${jsonOut}\n`);
}
