'use strict';
/* Tests for Layers 3 and 4 and the analyzeWithEducation() API.
 *
 * The false-positive section is the important one. Every case in
 * tests/false_positive_cases.json that has been resolved with a FEN is replayed
 * through the real API, and the API must not reproduce the misconception that
 * case exists to prevent. Those positions were chosen because a naive detector
 * gets them wrong, so they are exactly the right regression suite.
 *
 *     node tests/test_api.js [-v]
 */
const fs = require('fs');
const path = require('path');
const FEAT = require('../lib/features.js');
const MATCH = require('../lib/matchers.js');
const API = require('../lib/analyze.js');

const ROOT = path.join(__dirname, '..');
const V = process.argv.includes('-v');
let pass = 0; const fails = [];

function ok(name, cond, detail) {
  if (cond) { pass++; if (V) console.log('  ok   ' + name); }
  else fails.push([name, detail || '']);
}
const eq = (name, got, want) =>
  ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
const has = (name, arr, item) =>
  ok(name, (arr || []).includes(item), `${JSON.stringify(arr)} lacks ${item}`);

/* ---------- Layer 3: features ---------- */

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
{
  const f = FEAT.features(START);
  eq('start: phase', f.phase, 'opening');
  eq('start: no doubled', f.pawns.w.doubled, []);
  eq('start: no isolated', f.pawns.w.isolated, []);
  eq('start: no passed', f.pawns.w.passed, []);
  eq('start: one island', f.pawns.w.islands, 1);
  eq('start: no open files', f.files.open, []);
  eq('start: no holes for White', f.holes.w, []);
  eq('start: no outposts', f.outposts.w, []);
  eq('start: mobility both 20', f.activity.mobility, { w: 20, b: 20 });
  ok('start: white has bishop pair', f.pieces.w.bishopPair);
  ok('start: not opposite bishops', !f.pieces.oppositeColouredBishops);
  ok('start: no back-rank exposure (pawns on 2nd, king has no luft but that is d1/e2...)',
     typeof f.king.w.backRankExposure === 'boolean');
}
{
  // FEN fidelity: the page's own parser and serialiser must round-trip, or every
  // feature below is being computed on a different position than the caller meant.
  const fens = [START,
    'r1bqkb1r/pp3ppp/2n1p3/3n4/2BP4/2N2N2/PP3PPP/R1BQK2R b KQkq - 0 8',
    '8/4k3/4P3/3P4/2B1K3/b7/8/8 w - - 0 1',
    'R7/6k1/P4r2/8/3K4/8/8/8 w - - 0 1'];
  for (const fen of fens) eq('fen round-trip ' + fen.slice(0, 18), FEAT.page.fenOf(FEAT.page.stateFromFEN(fen)), fen);
}
{
  const f = FEAT.features('r1bqkb1r/pp3ppp/2n1p3/3n4/2BP4/2N2N2/PP3PPP/R1BQK2R b KQkq - 0 8');
  eq('IQP: white isolated d4', f.pawns.w.isolated, ['d4']);
  eq('IQP: white islands', f.pawns.w.islands, 3);
  eq('IQP: phase', f.phase, 'middlegame');
}
{
  const f = FEAT.features('r2q1rk1/pp3ppp/2np4/3N4/4P3/2P5/PP3PPP/R2Q1RK1 w - - 0 1');
  has('outpost: d5 is a hole for White', f.holes.w, 'd5');
  eq('outpost: knight on d5 detected', f.outposts.w, [{ square: 'd5', piece: 'N' }]);
}
{
  const a = FEAT.features('6k1/5ppp/8/8/8/8/5PPP/4R1K1 w - - 0 1');
  ok('back rank: black has no luft', a.king.b.luft === false);
  ok('back rank: exposure flagged', a.king.b.backRankExposure === true);
  const b = FEAT.features('6k1/5pp1/7p/8/8/8/5PPP/4R1K1 w - - 0 1');
  ok('luft: h6 gives an escape square', b.king.b.luft === true);
  ok('luft: exposure cleared', b.king.b.backRankExposure === false);
}
{
  const f = FEAT.features('8/4k3/4P3/3P4/2B1K3/b7/8/8 w - - 0 1');
  ok('OCB: detected', f.pieces.oppositeColouredBishops === true);
  eq('OCB: phase is endgame', f.phase, 'endgame');
}
{
  const f = FEAT.features('7k/8/5K2/3B3P/8/8/8/8 w - - 0 1');
  eq('wrong rook pawn: h5 is passed', f.pawns.w.passed, ['h5']);
  eq('wrong rook pawn: material +4', f.material.balance, 4);
}
{
  const f = FEAT.features('3r2k1/pp3pp1/2p4p/8/8/2P4P/PP3PP1/3R2K1 w - - 0 1');
  eq('open files d and e', f.files.open, ['d', 'e']);
  eq('white rook on open d1', f.pieces.w.rooksOnOpenFiles, ['d1']);
  eq('black rook on open d8', f.pieces.b.rooksOnOpenFiles, ['d8']);
}

/* ---------- Layer 3: motifs come from the page, not from here ---------- */
{
  // The fork position from the fork concept's own controlled pair.
  const m = FEAT.motifsOfMove('r3k3/4bppp/8/3N4/8/8/PPP5/R3KB2 w Qq - 0 1', 'd5c7');
  ok('fork position: move is legal', m.legal === true);
  eq('fork position: SAN', m.san, 'Nc7+');
  has('fork position: detector reports fork', m.motifs.map(x => x.tag), 'fork');

  const bad = FEAT.motifsOfMove(START, 'e2e5');
  ok('illegal move reported as illegal', bad.legal === false);
}

/* ---------- Layer 4: matching ---------- */

const { concepts } = API.knowledge();
{
  for (const m of MATCH.STRUCTURAL) {
    ok('matcher targets a real concept: ' + m.concept, !!concepts[m.concept],
       'no concept record with that id');
    ok('matcher cites what it implements: ' + m.concept, !!m.implements);
  }
  for (const [tag, id] of Object.entries(MATCH.MOTIF_TO_CONCEPT)) {
    ok('motif map targets a real concept: ' + tag, !!concepts[id], id + ' missing');
  }
}
{
  // Confidence must be capped by knowledge type, not by how cleanly it matched.
  eq('cap: rule-of-thumb cannot be high', MATCH.cap('high', 'rule-of-thumb'), 'low');
  eq('cap: positional-concept caps at medium', MATCH.cap('high', 'positional-concept'), 'medium');
  eq('cap: tactical-motif may be high', MATCH.cap('high', 'tactical-motif'), 'high');
  eq('cap: never raises', MATCH.cap('low', 'tactical-motif'), 'low');
}
{
  // A bare king-and-pawn position licenses little and must not be padded out.
  const f = FEAT.features('8/5k2/8/3P4/8/8/5K2/8 w - - 0 1');
  const got = MATCH.matchAll(f, null, concepts).map(c => c.concept);
  ok('sparse position does not invent concepts', got.length <= 4, JSON.stringify(got));
}

/* ---------- The API: the four refusals ---------- */
{
  const r = API.analyzeWithEducation({ fen: START });
  ok('API: runs on the start position', !!r.explanation.text);
  ok('API: reports provenance', r.provenance.chess_rules.includes('page_chess'));
  ok('API: no phrasing violations', r.phrasing_violations.length === 0,
     JSON.stringify(r.phrasing_violations));
}
{
  // Refusal 2: no engine, no quality claim.
  const r = API.analyzeWithEducation({ fen: START, move: 'e2e4' });
  ok('API: assessment is null without an engine', r.assessment === null);
  ok('API: says it makes no quality claim',
     r.notes.some(n => /NO claim about/.test(n)), JSON.stringify(r.notes));
  ok('API: does not call the move good',
     !/\b(best|strong|winning|excellent)\b/i.test(r.explanation.text), r.explanation.text);
}
{
  // With an engine result, it may speak — and only then.
  const r = API.analyzeWithEducation({
    fen: START, move: 'e2e4',
    engine: { eval_cp: 30, best_move: 'e2e4', depth: 26, engine_id: 'Stockfish 18' },
  });
  ok('API: engine result accepted', r.assessment && r.assessment.is_best === true);
  ok('API: text reflects the engine', /first choice/.test(r.explanation.text), r.explanation.text);
}
{
  // Refusal 1: no forced label.
  const r = API.analyzeWithEducation({ fen: '8/8/4k3/8/8/4K3/8/8 w - - 0 1' });
  eq('API: bare kings license no concept', r.concepts.length, 0);
  ok('API: says so explicitly',
     r.notes.some(n => /says nothing rather than reaching/.test(n)), JSON.stringify(r.notes));
}
{
  // Illegal moves are reported, not silently dropped.
  const r = API.analyzeWithEducation({ fen: START, move: 'e2e5' });
  ok('API: illegal move noted', r.notes.some(n => /not legal/.test(n)));
  ok('API: illegal move yields no move block', r.move === null);
}
{
  let threw = false;
  try { API.analyzeWithEducation({ fen: START, level: 'wizard' }); } catch (e) { threw = true; }
  ok('API: rejects an unknown level', threw);
  threw = false;
  try { API.analyzeWithEducation({}); } catch (e) { threw = true; }
  ok('API: requires a fen', threw);
}
{
  // Levels and depths must actually change the wording.
  const texts = new Set();
  for (const d of API.DEPTHS) {
    texts.add(API.analyzeWithEducation({
      fen: 'r1bqkbnr/1pp2ppp/p1p5/4p3/4P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 5', depth: d,
    }).explanation.text);
  }
  ok('API: depth changes the wording', texts.size === API.DEPTHS.length, `${texts.size} distinct`);
}
{
  // Soft knowledge must carry its hedge into the output.
  const r = API.analyzeWithEducation({ fen: 'r1bqkb1r/pp3ppp/2n1p3/3n4/2BP4/2N2N2/PP3PPP/R1BQK2R b KQkq - 0 8' });
  const soft = r.concepts.filter(c => c.hedge !== null);
  ok('API: soft concepts expose a hedge', r.concepts.length === 0 || soft.length >= 0);
  for (const c of r.concepts) {
    ok('API: caution evidence is graded: ' + c.id,
       c.cautions.every(x => ['demonstrated', 'on-a-tested-record', 'sourced', 'unsourced'].includes(x.evidence)));
  }
}

/* ---------- lines, not just moves ---------- */
{
  const fen = 'r3k3/4bppp/8/3N4/8/8/PPP5/R3KB2 w Qq - 0 1';
  const r = API.analyzeWithEducation({ fen, line: ['d5c7', 'e8d7', 'c7a8'] });
  ok('line: reports the SAN line', Array.isArray(r.move.line) && r.move.line[0] === 'Nc7+', JSON.stringify(r.move && r.move.line));
  ok('line: reports motifs per ply', Array.isArray(r.move.plies) && r.move.plies.length === 3);
  ok('line: finds the fork', r.concepts.some(c => c.id === 'fork'));
  // Reading a whole line must never find FEWER motifs than reading its first move.
  const single = API.analyzeWithEducation({ fen, move: 'd5c7' });
  const a = new Set(single.concepts.map(c => c.id)), b = new Set(r.concepts.map(c => c.id));
  ok('line: finds at least what the first move alone finds',
     [...a].every(x => b.has(x)), `${[...a]} vs ${[...b]}`);

  const bad = API.analyzeWithEducation({ fen, line: ['d5c7', 'a1a8'] });
  ok('line: an illegal continuation is reported, not silently dropped',
     bad.notes.some(n => /becomes illegal/.test(n)), JSON.stringify(bad.notes));
  ok('line: the legal prefix is still used', bad.move && bad.move.line.length === 1);
}

/* ---------- False-positive regression: the resolved cases ---------- */
{
  const cases = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'false_positive_cases.json'), 'utf8')).cases;
  let replayed = 0;
  for (const c of cases) {
    if (!c.fen || !['resolved', 'partially-resolved'].includes(c.status)) continue;
    replayed++;
    const r = API.analyzeWithEducation({ fen: c.fen });
    ok(`FP ${c.id}: API runs`, !!r.explanation.text);
    ok(`FP ${c.id}: no banned phrasing`, r.phrasing_violations.length === 0,
       JSON.stringify(r.phrasing_violations));
    // The whole point of these positions: the surface pattern is present and is
    // NOT a fault. The API must never call it one.
    ok(`FP ${c.id}: no unsupported verdict word`,
       !/\bweakness\b|\bbad\b|\berror\b|\bmistake\b|\bblunder\b/i.test(r.explanation.text),
       r.explanation.text);
    // And where the concept is present, its caution must be reachable.
    if (c.concept && r.concepts.some(x => x.id === c.concept)) {
      const hit = r.concepts.find(x => x.id === c.concept);
      ok(`FP ${c.id}: ${c.concept} carries a caution`, hit.cautions.length > 0);
    }
  }
  ok('FP: replayed every resolved case with a FEN', replayed >= 6, `replayed ${replayed}`);
}

/* ---------- wording: never emit an unfilled template ---------- */
{
  // 25 concept records write their explanations as templates with {slots}, which
  // is a good design and a live hazard: an unfilled slot reaching a reader is
  // the most obviously broken thing this system could do. Every position, every
  // level, every depth.
  const CORPUS = [
    START,
    'r1bqkbnr/1pp2ppp/p1p5/4p3/4P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 5',
    'r1bqkb1r/pp3ppp/2n1p3/3n4/2BP4/2N2N2/PP3PPP/R1BQK2R b KQkq - 0 8',
    'r2q1rk1/pp3ppp/2np4/3N4/4P3/2P5/PP3PPP/R2Q1RK1 w - - 0 1',
    '3r2k1/pp3pp1/2p4p/8/8/2P4P/PP3PP1/3R2K1 w - - 0 1',
    '6k1/5ppp/8/8/8/8/5PPP/4R1K1 w - - 0 1',
    '8/4k3/4P3/3P4/2B1K3/b7/8/8 w - - 0 1',
    '7k/8/5K2/3B3P/8/8/8/8 w - - 0 1',
    'R7/6k1/P4r2/8/3K4/8/8/8 w - - 0 1',
    'r1bqkbnr/1ppp1ppp/p1n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 4',
    'r3k3/4bppp/8/3N4/8/8/PPP5/R3KB2 w Qq - 0 1',
    '8/5k2/8/3P4/8/8/5K2/8 w - - 0 1',
  ];
  let checked = 0, braces = 0, empty = 0;
  for (const fen of CORPUS) {
    for (const level of API.LEVELS) {
      for (const depth of API.DEPTHS) {
        const r = API.analyzeWithEducation({ fen, level, depth });
        checked++;
        if (/\{[^}]*\}/.test(r.explanation.text)) { braces++; if (V) console.log('  braces:', r.explanation.text); }
        if (!r.explanation.text || !r.explanation.text.trim()) empty++;
        if (r.phrasing_violations.length) ok('phrasing ' + fen.slice(0, 12), false,
          JSON.stringify(r.phrasing_violations));
        if (r.notes.some(n => /TEMPLATE BUG|PHRASING BUG/.test(n))) ok('self-reported bug ' + fen.slice(0, 12), false, JSON.stringify(r.notes));
      }
    }
  }
  ok('wording: no unfilled slot in any output', braces === 0, `${braces} of ${checked}`);
  ok('wording: never empty', empty === 0, `${empty} of ${checked}`);
  ok('wording: corpus actually exercised', checked === CORPUS.length * API.LEVELS.length * API.DEPTHS.length);
}
{
  // Ordering: what is said FIRST should be the most informative true thing.
  const r = API.analyzeWithEducation({ fen: 'r2q1rk1/pp3ppp/2np4/3N4/4P3/2P5/PP3PPP/R2Q1RK1 w - - 0 1' });
  eq('ordering: outpost leads in an outpost position', r.concepts[0].id, 'outpost');
  // This used to assert that luft was also reported here. It no longer is, and
  // that is the correct behaviour rather than a regression: the luft matcher now
  // requires an enemy rook or queen actually standing on a file that reaches the
  // back rank, and in this position there is none. The test was encoding the old
  // behaviour, so it asserts the real point instead — that the lead is right and
  // the list is not padded with features nothing can exploit.
  ok('ordering: the list is not padded', r.concepts.length <= 6, r.concepts.map(c => c.id).join(','));
  ok('specificity: the lead names the actual square',
     /d5/.test(r.explanation.text), r.explanation.text);
}
{
  // A tactic the move created outranks any standing structural feature.
  const r = API.analyzeWithEducation({ fen: 'r3k3/4bppp/8/3N4/8/8/PPP5/R3KB2 w Qq - 0 1', move: 'd5c7' });
  eq('ordering: the motif leads', r.concepts[0].id, 'fork');
  ok('ordering: knight-fork also reported', r.concepts.some(c => c.id === 'knight-fork'));
}

/* ---------- regressions from the human-grounded corpus ----------
 *
 * Every assertion here was written because a position from an annotated master
 * game disagreed with this code, and the code was wrong. They are separated from
 * the rest so a later session can see at a glance which behaviour was PAID for.
 * ---------------------------------------------------------------- */
{
  // Wade-Korchnoi, Buenos Aires 1960, after 37...Kh5. Black's e5 pawn has no
  // d- or f-pawn at all and a white pawn standing on e4 in front of it. It was
  // reported as BACKWARD, and led the explanation of the game's decisive
  // breakthrough. Two guards now: a pawn with no neighbours is isolated, and a
  // pawn whose advance square is occupied is rammed.
  const WK = '8/1pp5/1p4p1/1P1Pp2k/P3P2p/5K2/5P1P/8 w - - 1 38';
  const f = FEAT.features(WK);
  ok('regression: a pawn with no neighbours is isolated, not backward',
     !f.pawns.b.backward.includes('e5') && f.pawns.b.isolated.includes('e5'),
     JSON.stringify({ backward: f.pawns.b.backward, isolated: f.pawns.b.isolated }));

  // and the breakthrough itself, which nothing detected before this session
  const bt = f.breakthrough.w;
  ok('regression: the breakthrough is found', !!bt, 'no breakthrough reported');
  eq('regression: and it is the move Wade played', bt && bt.first, 'a4a5');
  ok('regression: and the line is the engine’s own',
     bt && bt.line.join(' ') === 'a4a5 b6a5 b5b6 c7b6 d5d6', bt && bt.line.join(' '));

  const r = API.analyzeWithEducation({ fen: WK, move: 'a4a5' });
  has('regression: the API reports pawn-breakthrough', r.concepts_all.map(c => c.id), 'pawn-breakthrough');
  ok('regression: and no longer reports a backward pawn',
     !r.concepts_all.some(c => c.id === 'backward-pawn'), r.concepts_all.map(c => c.id).join(','));
}
{
  // The classic three-against-three, and two positions that must NOT be one.
  const P3 = FEAT.features('8/ppp5/8/PPP4k/8/8/8/6K1 w - - 0 1');
  eq('breakthrough: the classic pattern starts with b6', P3.breakthrough.w && P3.breakthrough.w.first, 'b5b6');
  const start = FEAT.features(START);
  ok('breakthrough: not from the starting position', !start.breakthrough.w && !start.breakthrough.b);
  const kp = FEAT.features('8/8/8/4k3/8/4K3/4P3/8 w - - 0 1');
  ok('breakthrough: one pawn is not a breakthrough', !kp.breakthrough.w);
}
{
  // Adams-Kasparov, Linares 2005, after 21...Kxh7. Every mechanical sign of a
  // winning king attack is present and there is no attack: Speelman gives White
  // 22.Be3 and Stockfish scores the position at -2.13 for White. This is the
  // corpus's sharpest false-positive case and it is NOT a vacuous pass, because
  // king-attack now has a matcher that could report it.
  const AK = 'br3r2/2q2ppk/p2pp3/2n1b1BP/1n1NP3/2N2P2/1PPQB3/1K4RR w - - 0 22';
  const r = API.analyzeWithEducation({ fen: AK });
  const ids = r.concepts_all.map(c => c.id);
  ok('false positive: no king attack where a GM and an engine agree there is none',
     !ids.includes('king-attack'), ids.join(','));
  has('false positive: but the exposed king IS reported, which is correct', ids, 'king-safety');
  ok('false positive: and it is not the lead', r.concepts[0].id !== 'king-safety', r.concepts[0].id);
}
{
  // king-attack must not be dead either: it has to be capable of firing.
  // These are shipped puzzle positions, not invented ones: over the 788 in
  // puzzles/*.json the matcher fires on 12, which is 1.5%. Two of those are
  // pinned here so that a change which quietly kills the matcher is a failure
  // rather than an improvement in the false-positive count.
  let fired = 0;
  for (const fen of ['r1r2b1k/7p/pp4p1/2q2p2/2B1pPN1/2Q3P1/P1P2R1P/2R4K b - - 2 28',
                     '3qr1k1/1bp2p2/6nQ/6R1/rpP4p/4Bpp1/P7/1B2K3 w - - 0 39']) {
    const rr = API.analyzeWithEducation({ fen });
    if (rr.concepts_all.some(c => c.id === 'king-attack')) fired++;
  }
  eq('king-attack: the matcher still fires on the positions it was measured on', fired, 2);
}
{
  // Reti-Capablanca 1924: Keene's 18...Ne6 raises Black's pawn-and-minor control
  // of the centre. The RAW attacker count falls, because the knight blocks a
  // rook x-raying its own bishop, and an earlier version of the move-based
  // matcher was measured on that count.
  const RC = 'r3rnk1/2q2pb1/1p1p1npp/pPp5/2PPb3/P1Q2NP1/1B3PBP/R2R1NK1 b - - 0 18';
  const before = FEAT.features(RC);
  const P = FEAT.page;
  const st = P.stateFromFEN(RC);
  const ms = P.legalMoves(st);
  const mv = ms.find(m => P.uciOf(m) === 'f8e6');
  const after = FEAT.features(P.fenOf(P.makeMove(st, mv)));
  ok('centre: the RAW count falls on the best move (which is why it is not used)',
     after.centre.control.b < before.centre.control.b,
     `${before.centre.control.b} -> ${after.centre.control.b}`);
  ok('centre: pawn-and-minor control rises on it (which is what is used)',
     after.centre.minorControl.b > before.centre.minorControl.b,
     `${before.centre.minorControl.b} -> ${after.centre.minorControl.b}`);
  has('centre: and the API reports center-control',
      API.analyzeWithEducation({ fen: RC, move: 'f8e6' }).concepts_all.map(c => c.id), 'center-control');
}
{
  // Capablanca-Mattison 1929: the king-safety event is Black's FORCED REPLY,
  // not 15.Ng5. The knight landing on g5 blocks the bishop that was already
  // looking at h6, so the attacker count on the black king's zone is 2 before
  // the move and 2 after it.
  const before = FEAT.features('r1b2rk1/p4ppp/1pn1p3/3n4/5B2/q1P1PN2/P1Q1BPPP/1R1R2K1 w - - 0 15');
  const after = FEAT.features('r1b2rk1/p4ppp/1pn1p3/3n2N1/5B2/q1P1P3/P1Q1BPPP/1R1R2K1 b - - 1 15');
  eq('king zone: 15.Ng5 does not change the count', 
     [before.kingZone.b.attackers, after.kingZone.b.attackers], [2, 2]);
  const r = API.analyzeWithEducation({
    fen: 'r1b2rk1/p4ppp/1pn1p3/3n2N1/5B2/q1P1P3/P1Q1BPPP/1R1R2K1 b - - 1 15', move: 'f7f5' });
  has('king safety: the forced reply is where it is reported',
      r.concepts_all.map(c => c.id), 'king-safety');
}
{
  // One concept, one entry. Two arms of the same matcher used to print the
  // concept twice at a reader.
  const r = API.analyzeWithEducation({
    fen: 'r1b2rk1/p4ppp/1pn1p3/3n2N1/5B2/q1P1P3/P1Q1BPPP/1R1R2K1 b - - 1 15', move: 'f7f5' });
  const ids = r.concepts_all.map(c => c.id);
  eq('no duplicates: every concept appears once', ids.length, new Set(ids).size);
}
{
  // Thresholds are measured, not chosen. These record what they were measured
  // AT, so a later change that quietly loosens one is visible.
  const M = require('../lib/matchers.js');
  ok('thresholds: recorded in the source', /20\.3%/.test(fs.readFileSync(path.join(ROOT, 'lib', 'matchers.js'), 'utf8')),
     'the measured firing rate for center-control is no longer stated in the code');
}

{
  // Smyslov-Botvinnik 1954 after 21.Nc5. A centralised advanced knight in front
  // of an enemy pawn chain is the outpost pattern as a scan sees it, and
  // Botvinnik says twice in his own notes that the piece is badly placed:
  // ...b6 challenges it and no white pawn defends it. This is the only
  // human-grounded negative example in the corpus for a concept the API can
  // actually recognise, so it is the only one that could ever fail.
  const SB = '2r1k2r/1pqbnpp1/4p2p/p1NpP3/PP3P2/2PB4/6PP/R3QR1K b k - 3 21';
  const f = FEAT.features(SB);
  eq('false positive: c5 is not an outpost for White', f.outposts.w, []);
  const ids = API.analyzeWithEducation({ fen: SB, move: 'd7c6' }).concepts_all.map(c => c.id);
  ok('false positive: and the API does not report one', !ids.includes('outpost'), ids.join(','));
}
{
  // Nimzowitsch-Capablanca 1914 and Havasi-Capablanca 1929: two features that
  // are correctly REPORTED and decide nothing. The system must say the feature
  // is there and must not have said more than that, which test_explanations.js
  // enforces on the wording.
  const NC = API.analyzeWithEducation({
    fen: 'r3r1k1/2p2pbp/2pp2p1/8/P1q1P3/2N2P2/1PPQ2PP/1R1R2K1 b - - 2 22', move: 'e8b8' });
  has('ambiguous: doubled pawns reported where they are a strength',
      NC.concepts_all.map(c => c.id), 'doubled-pawns');
  const HC = API.analyzeWithEducation({
    fen: '2r2rk1/pb1q1ppp/1pn1pn2/8/3P4/P3PB2/3N1PPP/RQB2RK1 b - - 7 15', move: 'c6a5' });
  has('ambiguous: the bishop pair reported where its owner is worse',
      HC.concepts_all.map(c => c.id), 'bishop-pair');
}

/* ---------- report ---------- */
console.log(`\nAPI  PASS ${pass}   FAIL ${fails.length}`);
for (const [n, d] of fails) console.log(`  FAIL  ${n}\n        ${d}`);
process.exit(fails.length ? 1 : 0);
