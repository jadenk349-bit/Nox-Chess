'use strict';
/* Candidates for AMBIGUOUS examples, which is the rung this base is thinnest on.
 *
 * tools/prospect.js promises three kinds of candidate in its own header —
 * positive, near-miss and ambiguous — and produces two. The third was never
 * written, which is the same shape of defect as an `implements` string claiming
 * what the code does not do, so it is written here rather than left as a comment
 * over there. This tool does the ambiguous arm and nothing else.
 *
 * WHAT AMBIGUOUS MEANS HERE, and it is deliberately narrow. It is not "the
 * concept might be present". The concept IS present — this asks the base's own
 * Layer 4 rather than a re-derivation, so a candidate is by construction a
 * position the system would report. What makes it ambiguous is that the
 * position argues back, in one of three ways a machine can check:
 *
 *   BOTH SIDES   the concept fires for White and for Black at once, so
 *                reporting it tells a reader nothing about who stands better.
 *   AGAINST      it fires for the side that is DOWN material, so the feature
 *                the concept names is present on the side losing the argument.
 *                ONE CAVEAT, and it is the same polarity trap state/TRAPS.md
 *                warns about: this ground assumes the concept names an ASSET.
 *                For a concept naming a LIABILITY - `loose-piece`,
 *                `backward-pawn`, `bad-bishop` - firing for the side that is
 *                losing is the concept working, not an ambiguity, and a
 *                candidate of that kind was looked at and thrown away rather
 *                than written up. Read the record before writing the example.
 *   WORTHLESS    it fires in a quiet position — no check, no winning capture —
 *                where nothing tactical is deciding, and the engine is then
 *                asked whether the feature is worth anything at all.
 *
 * The first two are decided here. The third needs an engine and this tool does
 * not run one: it nominates, and tools/sf_analyse.py settles it, exactly as the
 * generator/verifier split works in the puzzle tools. A candidate is a question,
 * not an example, and nothing here writes to a record.
 *
 *     node tools/mine_ambiguous.js [--concept id] [--limit N] [--json out]
 */
const fs = require('fs');
const path = require('path');
const API = require('../lib/analyze.js');
const F = require('../lib/features.js');

const ROOT = path.join(__dirname, '..');
const PUZZLES = path.join(ROOT, '..', 'puzzles');
const argv = process.argv.slice(2);
const only = argv.includes('--concept') ? argv[argv.indexOf('--concept') + 1] : null;
const LIMIT = argv.includes('--limit') ? Number(argv[argv.indexOf('--limit') + 1]) : 3;
const jsonOut = argv.includes('--json') ? argv[argv.indexOf('--json') + 1] : null;
const withMoves = argv.includes('--moves');
const MOVE_TRIES = argv.includes('--tries') ? Number(argv[argv.indexOf('--tries') + 1]) : 10;

function corpus() {
  const seen = new Set(), out = [];
  for (const track of ['opening', 'middlegame', 'endgame']) {
    const f = path.join(PUZZLES, `${track}.json`);
    if (!fs.existsSync(f)) continue;
    for (const p of JSON.parse(fs.readFileSync(f, 'utf8'))) {
      for (const [fen, kind] of [[p.fen, 'puzzle'], [p.prev && p.prev.fen, 'prev']]) {
        if (!fen || seen.has(fen)) continue;
        seen.add(fen);
        out.push({ fen, track, kind, id: p.id,
                   solution: kind === 'puzzle' ? (p.moves || p.line || [])[0] || null : null });
      }
    }
  }
  return out;
}

const found = {};
let scanned = 0;
for (const pos of corpus()) {
  let r, f;
  try { r = API.analyzeWithEducation({ fen: pos.fen }); f = F.features(pos.fen); }
  catch (e) { continue; }
  scanned++;
  const quiet = f.quietness && f.quietness.quiet;
  // Material, in the page's own values, so "down material" means the same thing
  // here as it does everywhere else in this base.
  const V = { P: 100, N: 320, B: 330, R: 500, Q: 900 };
  const mat = c => ['P', 'N', 'B', 'R', 'Q']
    .reduce((n, t) => n + (f.material[c].counts[t] || 0) * V[t], 0);
  const edge = mat('w') - mat('b');
  for (const c of r.concepts_all || []) {
    if (only && c.id !== only) continue;
    const subj = c.subjects || [];
    let reason = null;
    if (subj.length === 2) reason = 'both-sides';
    else if (subj.length === 1 && Math.abs(edge) >= 200 &&
             ((subj[0] === 'w' && edge <= -200) || (subj[0] === 'b' && edge >= 200)))
      reason = 'against-the-material';
    else if (subj.length === 1 && quiet) reason = 'quiet-needs-engine';
    if (!reason) continue;
    (found[c.id] = found[c.id] || []).push({
      fen: pos.fen, id: pos.id, track: pos.track, kind: pos.kind,
      concept: c.id, confidence: c.confidence, subjects: subj,
      reason, material_edge_cp: edge, quiet: !!quiet,
    });
  }
}

// The fourth ground, and the only one that supplies a MOVE. Everything above
// asks about a position; a move-based matcher never speaks to a question like
// that, which is why twelve concepts reported NONE before this existed.
if (withMoves) {
  const F2 = require('../lib/features.js');
  const P = F2.page;
  for (const pos of corpus()) {
    if (!pos.solution) continue;
    let st, moves;
    try { st = P.stateFromFEN(pos.fen); moves = P.legalMoves(st); } catch (e) { continue; }
    const others = moves.filter(m => P.uciOf(m) !== pos.solution).slice(0, MOVE_TRIES);
    for (const m of others) {
      const uci = P.uciOf(m);
      let r;
      try { r = API.analyzeWithEducation({ fen: pos.fen, move: uci }); } catch (e) { continue; }
      for (const c of r.concepts_all || []) {
        if (only && c.id !== only) continue;
        if (c.detected_by !== 'move' && c.detected_by !== 'findMotifs') continue;
        const have = (found[c.id] || []).filter(x => x.reason === 'not-the-move');
        if (have.length >= LIMIT) continue;
        (found[c.id] = found[c.id] || []).push({
          fen: pos.fen, id: pos.id, track: pos.track, kind: 'puzzle',
          concept: c.id, confidence: c.confidence, subjects: c.subjects || [],
          reason: 'not-the-move', move: uci, solution: pos.solution,
          material_edge_cp: 0, quiet: false,
        });
      }
    }
  }
}

// Rank: a candidate the tool can settle by itself beats one that needs an engine.
const RANK = { 'both-sides': 0, 'against-the-material': 1, 'not-the-move': 2, 'quiet-needs-engine': 3 };
const out = {};
for (const k of Object.keys(found).sort()) {
  found[k].sort((a, b) => RANK[a.reason] - RANK[b.reason] ||
                          Math.abs(b.material_edge_cp) - Math.abs(a.material_edge_cp));
  out[k] = found[k].slice(0, LIMIT);
}

console.log(`\nAMBIGUOUS CANDIDATES — ${scanned} positions scanned, ` +
            `${Object.keys(out).length} concepts with at least one\n`);
for (const k of Object.keys(out)) {
  console.log(`  ${k}`);
  for (const c of out[k])
    console.log(`    [${c.reason}] ${c.subjects.join('+')} conf=${c.confidence} ` +
                (c.move ? `move=${c.move} (solution ${c.solution}) ` :
                          `mat=${c.material_edge_cp > 0 ? '+' : ''}${c.material_edge_cp} `) +
                `${c.quiet ? 'quiet ' : ''} ${c.fen}`);
}
console.log(`\n  A candidate is a QUESTION, not an example. "quiet-needs-engine" is a ` +
            `nomination only:\n  nothing here has asked whether the feature is worth ` +
            `anything, and this tool never writes to a record.\n`);
if (jsonOut) {
  fs.writeFileSync(path.join(ROOT, jsonOut), JSON.stringify(out, null, 2));
  console.log(`  wrote ${jsonOut}\n`);
}
