'use strict';
/* How often each Layer 4 matcher fires, over the 788 shipped puzzle positions.
 *
 * This is the check on INFORMATIVENESS, and it is separate from correctness on
 * purpose. A matcher can be right about every position it fires on and still be
 * useless: `strong-square`, written exactly to its record's two preconditions,
 * fired on 80.1% of these positions and was thrown away for it. A concept true
 * of three quarters of all positions cannot be the most informative thing about
 * any of them.
 *
 * It exists because the same measurement kept being made by hand during the
 * trap-driven audit - reading each record's `false_positive_traps`, checking
 * whether the matcher implements them, and measuring the difference. Four
 * matchers have now been found implementing a record's bare precondition and
 * ignoring the traps written underneath it, so the measurement is a tool.
 *
 * It reads `concepts_all` rather than `concepts`, because the API returns six
 * and a matcher firing on 70% of positions can sit invisibly behind that cut
 * while still being wrong 70% of the time. `leads` is the separate question of
 * how often it is what the position is said to be ABOUT.
 *
 *     node tools/firing_rates.js [--limit N] [--concept id] [--json out.json]
 */
const fs = require('fs');
const path = require('path');
const API = require('../lib/analyze.js');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const limit = args.includes('--limit') ? Number(args[args.indexOf('--limit') + 1]) : Infinity;
const only = args.includes('--concept') ? args[args.indexOf('--concept') + 1] : null;
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;
// The 788 are TACTICAL puzzles: every one of them has a forcing solution by
// construction. So a matcher that requires a quiet position scores near zero
// here for a reason that says nothing about the matcher, and --quiet restricts
// the measurement to the positions where a positional claim can be isolated at
// all. Any rate quoted for a quietness-gated matcher must say which set it is on.
const quietOnly = args.includes('--quiet');
// ...and the corpus of ANNOTATED MASTER POSITIONS, which is small (37) and is
// the only set here where a human has said what the position is about. The
// three denominators disagree, and where they disagree the puzzle corpus is
// usually the misleading one: `luft` measures 4.8% on the 788 and fires on
// half the annotated positions, because puzzles are late-game positions whose
// kings have often already moved and master middlegames are full of castled
// kings behind three unmoved pawns. A rarity ranking read off the wrong
// denominator puts a piece of terminology at the head of the explanation.
const corpusOnly = args.includes('--corpus');

const fens = [];
if (corpusOnly) {
  const cp = path.join(ROOT, 'corpus', 'annotated_positions.json');
  for (const p of JSON.parse(fs.readFileSync(cp, 'utf8')).positions) {
    if (p.fen) fens.push({ fen: p.fen, uci: p.move_uci || null });
  }
}
for (const track of corpusOnly ? [] : ['opening', 'middlegame', 'endgame']) {
  const file = path.join(ROOT, '..', 'puzzles', `${track}.json`);
  if (!fs.existsSync(file)) continue;
  for (const p of JSON.parse(fs.readFileSync(file, 'utf8'))) {
    if (p && p.fen) fens.push({ fen: p.fen, uci: (p.moves || [])[0] });
  }
}
const use = fens.slice(0, limit);

const count = new Map();
const lead = new Map();
let bad = 0, skipped = 0, kept = 0;
for (const { fen, uci } of use) {
  let r;
  try { r = API.analyzeWithEducation(uci ? { fen, move: uci } : { fen }); }
  catch (e) { bad++; continue; }
  if (quietOnly && !(r.features.quietness || {}).quiet) { skipped++; continue; }
  kept++;
  const seen = new Set();
  r.concepts_all.forEach((h, i) => {
    if (seen.has(h.id)) return;
    seen.add(h.id);
    count.set(h.id, (count.get(h.id) || 0) + 1);
    if (i === 0) lead.set(h.id, (lead.get(h.id) || 0) + 1);
  });
}

const n = (quietOnly ? kept : use.length) || 1;
const rows = [...count.entries()].sort((a, b) => b[1] - a[1])
  .filter(([c]) => !only || c === only);
console.log(`\nFIRING RATES — ${quietOnly ? kept + ' QUIET positions of ' + use.length : use.length + (corpusOnly ? ' ANNOTATED MASTER positions' : ' positions')}` + (bad ? `  (${bad} unreadable)` : '') + '\n');
console.log('  concept                        fires    rate    leads');
for (const [c, k] of rows) {
  const flag = k / n > 0.5 ? '  <- true of most positions' : '';
  console.log(`  ${c.padEnd(30)} ${String(k).padStart(4)}  ${(100 * k / n).toFixed(1).padStart(6)}%  ${String(lead.get(c) || 0).padStart(6)}${flag}`);
}
if (jsonOut) {
  const out = {};
  for (const [c, k] of rows) out[c] = { fires: k, rate: +(100 * k / n).toFixed(1), leads: lead.get(c) || 0 };
  fs.writeFileSync(path.join(ROOT, jsonOut), JSON.stringify({ positions: use.length, rates: out }, null, 2));
  console.log(`\n  wrote ${jsonOut}`);
}
console.log();
