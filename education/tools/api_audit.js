'use strict';
/* API behaviour audit across a deliberately diverse position set.
 *
 * The mass test asks how often the API says something. This asks whether what it
 * says holds together, across position types the puzzle corpus does not contain.
 *
 * The sharpest check here is TERMINOLOGY INVARIANCE. This system's founding rule
 * is that research names concepts and the engine validates moves, and neither
 * does the other's job. That is testable rather than aspirational: running the
 * same position with and without an engine result must produce the SAME concept
 * list. If an evaluation can change which ideas get named, the separation has
 * failed no matter what the documentation says.
 *
 *     node tools/api_audit.js [-v]
 */
const API = require('../lib/analyze.js');
const MATCH = require('../lib/matchers.js');

const V = process.argv.includes('-v');
let pass = 0; const fails = [];
const ok = (n, c, d) => { if (c) { pass++; if (V) console.log('  ok  ' + n); } else fails.push([n, d || '']); };

/* Every category the brief names, with the kind labelled so a failure says what
 * KIND of position broke it. */
const SET = [
  ['opening',        'start',              'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'],
  ['opening',        'ruy after 3...a6',   'r1bqkbnr/1ppp1ppp/p1n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 4'],
  ['opening',        'closed catalan-ish', 'r1bq1rk1/pp2ppbp/2np1np1/2p5/2P1P3/2NP1NP1/PP2PPBP/R1BQ1RK1 w - - 0 8'],
  ['quiet middlegame','nimzowitsch blockade','2r2rk1/ppqb2pp/3bpn2/3pN3/1P1B4/2PB4/P3QPPP/R4RK1 b - - 10 17'],
  ['quiet middlegame','IQP structure',     'r1bqkb1r/pp3ppp/2n1p3/3n4/2BP4/2N2N2/PP3PPP/R1BQK2R b KQkq - 0 8'],
  ['quiet middlegame','symmetric rooks',   '3rk3/ppp1ppp1/8/8/8/8/PPP1PPP1/3RK3 w - - 0 1'],
  ['tactical',       'knight fork',        'r3k3/4bppp/8/3N4/8/8/PPP5/R3KB2 w Qq - 0 1'],
  ['tactical',       'back rank mate',     '6k1/5ppp/8/8/8/8/5PPP/4R1K1 w - - 0 1'],
  ['endgame',        'capablanca king walk','5k2/p1p4R/1pr5/3p1pP1/P2P1P2/2P2K2/8/8 w - - 0 35'],
  ['endgame',        'philidor',           '8/8/8/4k3/4p3/R7/1r6/4K3 w - - 0 1'],
  ['endgame',        'vancura',            'R7/6k1/P4r2/8/3K4/8/8/8 w - - 0 1'],
  ['endgame',        'opposite bishops',   '8/4k3/4P3/3P4/2B1K3/b7/8/8 w - - 0 1'],
  ['winning',        'mate in one',        '7k/1R5p/5K2/8/8/8/8/8 w - - 0 1'],
  ['winning',        'wrong rook pawn win','7k/8/5K2/7P/3B4/8/8/8 w - - 0 1'],
  ['losing',         'a piece down',       'r1bqkb1r/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 0 4'],
  ['equal',          'bare kings',         '8/8/4k3/8/8/4K3/8/8 w - - 0 1'],
  ['equal',          'symmetric pawns',    '8/5k2/8/8/8/8/5K2/8 w - - 0 1'],
  ['imbalance',      'rook vs two minors', '4r1k1/5ppp/8/8/8/8/5PPP/2B1NRK1 w - - 0 1'],
  ['imbalance',      'bishop vs knight',   '5k2/p1p4R/1p3rp1/n2p4/P2P1P2/2PB2P1/6K1/8 b - - 3 30'],
  ['defensive',      'exposed kings drawn','8/8/3k1pp1/8/3K4/5PP1/8/8 b - - 0 1'],
  ['attacking',      'greek gift shape',   'r1bq1rk1/pppn1ppp/4pn2/3p4/1bPP4/2NBPN2/PP3PPP/R1BQK2R w KQ - 0 8'],
  ['no principle',   'random-ish sparse',  '8/2k5/8/8/8/5N2/2K5/8 w - - 0 1'],
];

for (const [kind, label, fen] of SET) {
  const tag = `${kind}/${label}`;
  let base;
  try { base = API.analyzeWithEducation({ fen }); }
  catch (e) { ok(`${tag}: runs`, false, String(e.message || e)); continue; }
  ok(`${tag}: runs`, true);

  // ---- terminology invariance: the engine must not change WHICH ideas are named
  const withEngine = API.analyzeWithEducation({
    fen, engine: { eval_cp: 640, best_move: 'a1a2', depth: 26, engine_id: 'Stockfish 18' },
  });
  ok(`${tag}: engine does not change the concepts`,
     JSON.stringify(base.concepts.map(c => c.id)) === JSON.stringify(withEngine.concepts.map(c => c.id)),
     `${base.concepts.map(c => c.id)} vs ${withEngine.concepts.map(c => c.id)}`);
  ok(`${tag}: engine does not change confidence`,
     JSON.stringify(base.concepts.map(c => c.confidence)) === JSON.stringify(withEngine.concepts.map(c => c.confidence)));

  // A wildly wrong engine number must not invent or suppress terminology either.
  const absurd = API.analyzeWithEducation({
    fen, engine: { eval_cp: -3000, best_move: 'a1a2', depth: 26, engine_id: 'Stockfish 18' },
  });
  ok(`${tag}: an extreme evaluation invents no concept`,
     JSON.stringify(absurd.concepts.map(c => c.id)) === JSON.stringify(base.concepts.map(c => c.id)));

  // ---- ranking: low confidence must never lead, and motifs lead when present
  if (base.concepts.length > 1) {
    ok(`${tag}: low confidence does not lead`,
       !(base.concepts[0].confidence === 'low' && base.concepts.some(c => c.confidence !== 'low')),
       base.concepts.map(c => `${c.id}[${c.confidence}]`).join(', '));
  }
  const motifIdx = base.concepts.findIndex(c => (c.detected_by || '').startsWith('findMotifs'));
  if (motifIdx > 0) {
    ok(`${tag}: a detected motif leads`, false,
       `motif at index ${motifIdx}: ${base.concepts.map(c => c.id).join(', ')}`);
  } else ok(`${tag}: motif ordering`, true);

  // ---- every reported concept must exist and carry its own caveats
  const { concepts: KB } = API.knowledge();
  for (const c of base.concepts) {
    ok(`${tag}: ${c.id} is a real record`, !!KB[c.id]);
    ok(`${tag}: ${c.id} states why`, Array.isArray(c.because) && c.because.length > 0);
    ok(`${tag}: ${c.id} confidence is capped by type`,
       MATCH.cap(c.raw_confidence || c.confidence, c.knowledge_type) === c.confidence,
       `${c.raw_confidence} -> ${c.confidence} for ${c.knowledge_type}`);
  }

  // ---- conflicting principles: if two concepts that declare a conflict both
  // fire, the record must supply the resolution rather than leaving it open.
  const ids = new Set(base.concepts.map(c => c.id));
  for (const c of base.concepts) {
    for (const cf of ((KB[c.id].relationships || {}).conflicts || [])) {
      if (ids.has(cf.concept)) {
        ok(`${tag}: conflict ${c.id} vs ${cf.concept} has a written resolution`,
           !!(cf.resolution && cf.resolution.length > 40), JSON.stringify(cf));
      }
    }
  }

  // ---- the refusals
  ok(`${tag}: no phrasing violation`, base.phrasing_violations.length === 0,
     JSON.stringify(base.phrasing_violations));
  ok(`${tag}: no unfilled slot`, !/\{[^}]*\}/.test(base.explanation.text), base.explanation.text);
  ok(`${tag}: notes a missing engine when given a move`,
     API.analyzeWithEducation({ fen, move: 'a1a2' }).notes.some(n => /NO claim|not legal/.test(n)));
}

/* Concepts must not be reported where their own preconditions are impossible.
 *
 * This used to assert that BARE KINGS licenses nothing, which was the wrong
 * position for the claim: on bare kings the most certain statement in chess is
 * available, and saying nothing there was a missing detector being tested as a
 * virtue. Two kings and two blocked e-pawns is the honest case - a legal
 * position in which no researched concept applies. */
{
  const r = API.analyzeWithEducation({ fen: '4k3/4p3/8/8/8/8/4P3/4K3 w - - 0 1' });
  ok('nothing applies: nothing licensed', r.concepts.length === 0, r.concepts.map(c => c.id).join(','));

  const bare = API.analyzeWithEducation({ fen: '8/8/4k3/8/8/4K3/8/8 w - - 0 1' });
  ok('bare kings: exactly one concept, and it is the true one',
     bare.concepts.length === 1 && bare.concepts[0].id === 'insufficient-material',
     bare.concepts.map(c => c.id).join(','));
}

console.log(`\nAPI AUDIT  PASS ${pass}   FAIL ${fails.length}`);
for (const [n, d] of fails.slice(0, 20)) console.log(`  FAIL  ${n}\n        ${d}`);
if (fails.length > 20) console.log(`  ... and ${fails.length - 20} more`);
process.exit(fails.length ? 1 : 0);
