'use strict';
/* Mass position testing for the Education System.
 *
 * The API is only as good as its behaviour on positions nobody chose for it, so
 * this runs it over every shipped puzzle - 788 real positions with a known best
 * move and an independently assigned set of theme tags.
 *
 * It measures four things:
 *
 *   ROBUSTNESS   crashes, unfilled templates, banned phrasings. Any of these is
 *                a bug, and the count must be zero.
 *   SILENCE      how often the system licenses no concept. This is not a failure
 *                mode - refusing to label is the design - but a system that is
 *                silent on most positions is not useful either, so the rate is
 *                reported rather than optimised.
 *   AGREEMENT    where the puzzle generator independently tagged a motif, does
 *                this system report the same one? Two labelling systems built
 *                from different evidence on the same positions is the closest
 *                thing to external validation available here.
 *   THE GAP      tools/explanation_gap.py measured the shipped explanation layer
 *                naming a motif on 65% of puzzles but managing 4% on positional
 *                ones. This re-measures that with Layer 3 in place, which is the
 *                only honest way to say whether the project closed the gap it
 *                was started to close.
 *
 *     node tools/mass_test.js [--limit N] [--json out.json]
 */
const fs = require('fs');
const path = require('path');
const API = require('../lib/analyze.js');

const ROOT = path.join(__dirname, '..');
const PUZZLES = path.join(ROOT, '..', 'puzzles');

const args = process.argv.slice(2);
const limit = args.includes('--limit') ? Number(args[args.indexOf('--limit') + 1]) : Infinity;
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;

// The generator's theme tags that name a chess motif this system also knows.
// Taken from tools/motif_map.json's classification; puzzle-metadata tags such as
// longGame and defensiveResource are deliberately excluded, since they describe
// the puzzle rather than the chess.
const THEME_TO_CONCEPT = {
  fork: 'fork', pin: 'pin', skewer: 'skewer', discoveredAttack: 'discovered-attack',
  doubleCheck: 'double-check', backRank: 'back-rank-mate', trappedPiece: 'trapped-piece',
  hangingPiece: 'hanging-piece', mate: 'checkmate', promotion: 'promotion',
  zwischenzug: 'zwischenzug', perpetual: 'perpetual-check',
  exchangeSacrifice: 'exchange-sacrifice', sacrifice: 'sacrifice',
  pawnBreakthrough: 'pawn-breakthrough', kingAttack: 'king-attack',
  removalOfDefender: 'removing-the-defender',
};
const POSITIONAL = new Set([
  'outpost', 'weak-square', 'strong-square', 'doubled-pawns', 'isolated-queen-pawn',
  'backward-pawn', 'passed-pawn', 'open-file', 'semi-open-file', 'bishop-pair',
  'opposite-coloured-bishops', 'rook-on-the-seventh', 'space', 'piece-activity',
  'king-activation', 'luft', 'material-imbalance',
]);

const R = {
  positions: 0, crashed: 0, templateLeaks: 0, phrasingViolations: 0,
  silent: 0, withConcept: 0, withMotif: 0, withPositional: 0,
  conceptCounts: {}, leadCounts: {}, byTrack: {}, silentExamples: [], crashes: [],
  leadPositional: 0, leadMotif: 0,
  agreement: { comparable: 0, agreed: 0, missed: {}, extra: {} },
  positionalTactic: { total: 0, withPositional: 0 },
};

function bump(o, k) { o[k] = (o[k] || 0) + 1; }

for (const track of ['opening', 'middlegame', 'endgame']) {
  const file = path.join(PUZZLES, `${track}.json`);
  if (!fs.existsSync(file)) continue;
  const list = JSON.parse(fs.readFileSync(file, 'utf8'));
  const t = R.byTrack[track] = { positions: 0, silent: 0, motif: 0, positional: 0 };

  for (const p of list) {
    if (R.positions >= limit) break;
    R.positions++; t.positions++;
    let r;
    try {
      r = API.analyzeWithEducation({ fen: p.fen, move: (p.moves || [])[0] || null });
    } catch (e) {
      R.crashed++; R.crashes.push({ id: p.id, fen: p.fen, error: String(e.message || e) });
      continue;
    }
    if (/\{[^}]*\}/.test(r.explanation.text)) R.templateLeaks++;
    R.phrasingViolations += r.phrasing_violations.length;

    const ids = r.concepts.map(c => c.id);
    if (!ids.length) {
      R.silent++; t.silent++;
      if (R.silentExamples.length < 5) R.silentExamples.push({ id: p.id, fen: p.fen });
    } else R.withConcept++;
    for (const id of ids) bump(R.conceptCounts, id);
    if (ids.length) {
      // The lead concept is what the explanation actually says. "Some positional
      // concept appears somewhere in a list of six" is a much weaker claim and
      // was near 100% before this was measured separately.
      bump(R.leadCounts, ids[0]);
      if (POSITIONAL.has(ids[0])) R.leadPositional++;
      if ((r.concepts[0].detected_by || '').startsWith('findMotifs')) R.leadMotif++;
    }

    const motifs = r.concepts.filter(c => (c.detected_by || '').startsWith('findMotifs'));
    if (motifs.length) { R.withMotif++; t.motif++; }
    const pos = ids.filter(id => POSITIONAL.has(id));
    if (pos.length) { R.withPositional++; t.positional++; }

    // Agreement with the generator's own tags, restricted to motifs both systems
    // claim to detect. A tag the generator assigned by a crude proxy (kingAttack
    // is "two or more checks") is still counted, and disagreement there is
    // informative rather than a failure.
    const theirs = new Set((p.themes || []).map(x => THEME_TO_CONCEPT[x]).filter(Boolean));
    const oursMotif = new Set(motifs.map(c => c.id));
    if (theirs.size) {
      R.agreement.comparable++;
      let any = false;
      for (const c of theirs) {
        if (oursMotif.has(c)) any = true; else bump(R.agreement.missed, c);
      }
      for (const c of oursMotif) if (!theirs.has(c)) bump(R.agreement.extra, c);
      if (any) R.agreement.agreed++;
    }
    if ((p.themes || []).includes('positionalTactic')) {
      R.positionalTactic.total++;
      if (pos.length) R.positionalTactic.withPositional++;
    }
  }
}

const pct = (a, b) => (b ? (100 * a / b).toFixed(1) + '%' : 'n/a');
console.log(`\nMASS POSITION TEST — ${R.positions} shipped puzzle positions\n`);
console.log('ROBUSTNESS');
console.log(`  crashes                 ${R.crashed}`);
console.log(`  unfilled templates      ${R.templateLeaks}`);
console.log(`  banned phrasings        ${R.phrasingViolations}`);
console.log('\nCOVERAGE');
console.log(`  licensed a concept      ${R.withConcept} (${pct(R.withConcept, R.positions)})`);
console.log(`  said nothing            ${R.silent} (${pct(R.silent, R.positions)})`);
console.log(`  named a tactical motif  ${R.withMotif} (${pct(R.withMotif, R.positions)})`);
console.log(`  named a positional one  ${R.withPositional} (${pct(R.withPositional, R.positions)})`);
console.log('\nBY TRACK');
for (const [k, v] of Object.entries(R.byTrack)) {
  console.log(`  ${k.padEnd(11)} n=${String(v.positions).padStart(3)}  motif ${pct(v.motif, v.positions).padStart(6)}  positional ${pct(v.positional, v.positions).padStart(6)}  silent ${pct(v.silent, v.positions).padStart(6)}`);
}
console.log('\nAGREEMENT WITH THE PUZZLE GENERATOR (independent tagging, same positions)');
console.log(`  positions with a comparable tag   ${R.agreement.comparable}`);
console.log(`  at least one motif agreed         ${R.agreement.agreed} (${pct(R.agreement.agreed, R.agreement.comparable)})`);
const top = o => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 6)
  .map(([k, v]) => `${k} ${v}`).join(', ') || '(none)';
console.log(`  tags they had that we did not     ${top(R.agreement.missed)}`);
console.log(`  motifs we had that they did not   ${top(R.agreement.extra)}`);
console.log('\nTHE GAP THIS PROJECT WAS STARTED TO CLOSE');
console.log(`  puzzles tagged positionalTactic   ${R.positionalTactic.total}`);
console.log(`  ...now given a positional concept ${R.positionalTactic.withPositional} (${pct(R.positionalTactic.withPositional, R.positionalTactic.total)})`);
console.log('  (tools/explanation_gap.py measured the shipped card layer at 4% on these)');
console.log('\nWHAT THE EXPLANATION ACTUALLY LEADS WITH');
console.log(`  lead is a tactical motif          ${R.leadMotif} (${pct(R.leadMotif, R.positions)})`);
console.log(`  lead is a positional concept      ${R.leadPositional} (${pct(R.leadPositional, R.positions)})`);
for (const [k, v] of Object.entries(R.leadCounts).sort((a, b) => b[1] - a[1]).slice(0, 10)) {
  console.log(`    ${k.padEnd(24)} ${String(v).padStart(4)}  ${pct(v, R.positions)}`);
}
console.log('\nMOST-REPORTED CONCEPTS (anywhere in the list)');
for (const [k, v] of Object.entries(R.conceptCounts).sort((a, b) => b[1] - a[1]).slice(0, 14)) {
  console.log(`  ${k.padEnd(26)} ${String(v).padStart(4)}  ${pct(v, R.positions)}`);
}
if (R.crashes.length) {
  console.log('\nCRASHES');
  for (const c of R.crashes.slice(0, 5)) console.log(`  ${c.id}: ${c.error}`);
}
if (jsonOut) { fs.writeFileSync(jsonOut, JSON.stringify(R, null, 2)); console.log(`\nwrote ${jsonOut}`); }
console.log();
process.exit(R.crashed || R.templateLeaks || R.phrasingViolations ? 1 : 0);
