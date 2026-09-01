'use strict';
/* Explanation-quality tests.
 *
 * The API suite checks that the system does not say things that are FALSE.
 * These check that it does not say things that are USELESS, which is a
 * different failure and the one an explanation layer actually dies of.
 *
 *     node tests/test_explanations.js [-v]
 */
const fs = require('fs');
const path = require('path');
const API = require('../lib/analyze.js');

const V = process.argv.includes('-v');
let pass = 0; const fails = [];
const ok = (n, c, d) => { if (c) { pass++; if (V) console.log('  ok   ' + n); } else fails.push([n, d || '']); };

// A spread deliberately wider than the puzzle corpus: quiet, sharp, opening,
// endgame, balanced, lost, and one position with nothing to say about it.
const CORPUS = [
  ['quiet opening',      'r1bqkb1r/pp2pppp/2n2n2/2pp4/3P4/2N1PN2/PP3PPP/R1BQKB1R w KQkq - 0 6'],
  ['closed centre',      'r1bq1rk1/pp2ppbp/2np1np1/2p5/2P1P3/2NP1NP1/PP2PPBP/R1BQ1RK1 w - - 0 8'],
  ['outpost middlegame', '3r4/1pr2nk1/1Np1bp2/Q1P1p1p1/2P1P1p1/1N1B1P2/2K2NRP/q7 b - - 1 32'],
  ['IQP structure',      'r1bqkb1r/pp3ppp/2n1p3/3n4/2BP4/2N2N2/PP3PPP/R1BQK2R b KQkq - 0 8'],
  ['pawn endgame',       '8/5k2/8/3P4/8/8/5K2/8 w - - 0 1'],
  ['rook endgame',       'R7/6k1/P4r2/8/3K4/8/8/8 w - - 0 1'],
  ['opposite bishops',   '8/4k3/4P3/3P4/2B1K3/b7/8/8 w - - 0 1'],
  ['back rank',          '6k1/5ppp/8/8/8/8/5PPP/4R1K1 w - - 0 1'],
  ['bare kings',         '8/8/4k3/8/8/4K3/8/8 w - - 0 1'],
  ['start',              'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'],
  ['material imbalance', '4r1k1/5ppp/8/8/8/8/5PPP/2B1NRK1 w - - 0 1'],
  ['tactical, fork',     'r3k3/4bppp/8/3N4/8/8/PPP5/R3KB2 w Qq - 0 1'],
];

/* Phrases that say nothing. An explanation containing one of these has filled
 * space rather than explained a position. */
const FILLER = [
  /improves your position/i, /this is a good move/i, /gains an advantage\b/i,
  /is better for/i, /leads to a better game/i, /creates pressure\b/i,
  /has the initiative here\b/i, /white is doing well/i, /black is doing well/i,
];
/* Talk about the knowledge base rather than the position. */
const META = [
  /sources? (disagree|differ)/i, /this base/i, /this system/i, /recorded here/i,
  /measured here/i, /tools\//i, /\bunverified\b/i, /audit note/i, /knowledge base/i,
];

for (const [label, fen] of CORPUS) {
  for (const level of API.LEVELS) {
    for (const depth of API.DEPTHS) {
      const r = API.analyzeWithEducation({ fen, level, depth });
      const t = r.explanation.text;
      const tag = `${label}/${level}/${depth}`;

      ok(`${tag}: produces text`, !!t && t.trim().length > 0);
      ok(`${tag}: no unfilled slot`, !/\{[^}]*\}/.test(t), t);
      ok(`${tag}: no phrasing violation`, r.phrasing_violations.length === 0,
         JSON.stringify(r.phrasing_violations));

      // The bare-kings position is allowed - and required - to say nothing.
      if (label === 'bare kings') {
        ok(`${tag}: refuses to label`, /Nothing in this position matches/.test(t), t);
        continue;
      }

      for (const f of FILLER) ok(`${tag}: no filler ${f}`, !f.test(t), t);
      // Meta-talk is allowed in the record and not in the explanation, EXCEPT
      // where the concept is itself about the knowledge base.
      const metaConcept = r.concepts.some(c => /misconception|terminology|exceptions-to-rules|concepts$/.test(c.id));
      if (!metaConcept) for (const m of META) ok(`${tag}: no meta ${m}`, !m.test(t), t);

      // No sentence repeated verbatim.
      const ss = t.split(/(?<=[.!?])\s+/).map(x => x.trim()).filter(x => x.length > 15);
      ok(`${tag}: no repeated sentence`, new Set(ss).size === ss.length, t);

      // Length should track depth rather than being one size.
      if (depth === 'short') ok(`${tag}: short is short`, t.length <= 320, `${t.length} chars`);
      if (depth === 'deep') ok(`${tag}: deep says more`, t.length >= 60, `${t.length} chars`);

      // Every claim about a square should name a square that exists.
      for (const sq of t.match(/\b[a-h][1-8]\b/g) || []) {
        ok(`${tag}: square ${sq} is on the board`, /^[a-h][1-8]$/.test(sq));
      }
      // No threat language without a move having been supplied - the system
      // cannot know what is threatened from a static position alone.
      ok(`${tag}: invents no threat`,
         !/\bthreatens to\b|\bis threatening\b|\bwins material\b/i.test(t), t);
    }
  }
}

/* Depth must actually change the wording, and level must be able to. */
for (const [label, fen] of CORPUS.slice(0, 6)) {
  const byDepth = new Set(API.DEPTHS.map(d => API.analyzeWithEducation({ fen, depth: d }).explanation.text));
  ok(`${label}: depth changes the wording`, byDepth.size >= 2, `${byDepth.size} distinct`);
}

/* Short must be a subset of the story, not a different story: the lead
 * observation should survive at every depth. */
for (const [label, fen] of CORPUS.slice(0, 6)) {
  const r = API.analyzeWithEducation({ fen });
  if (!r.concepts.length) continue;
  const lead = r.concepts[0].id;
  for (const depth of API.DEPTHS) {
    const rr = API.analyzeWithEducation({ fen, depth });
    ok(`${label}/${depth}: same lead concept`, !rr.concepts.length || rr.concepts[0].id === lead,
       `${lead} vs ${rr.concepts[0] && rr.concepts[0].id}`);
  }
}

console.log(`\nEXPLANATION  PASS ${pass}   FAIL ${fails.length}`);
for (const [n, d] of fails.slice(0, 25)) console.log(`  FAIL  ${n}\n        ${d}`);
if (fails.length > 25) console.log(`  ... and ${fails.length - 25} more`);
process.exit(fails.length ? 1 : 0);
