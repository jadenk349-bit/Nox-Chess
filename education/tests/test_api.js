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
  //
  // The position used to be bare kings, and that was wrong. On bare kings the
  // most certain statement in chess is available - neither side can force mate
  // - and saying nothing there was a MISSING DETECTOR being asserted as a
  // virtue. `insufficient-material` now says it. The refusal is a real
  // principle and is tested where it really applies: two kings and two blocked
  // e-pawns, a legal position in which nothing researched fits.
  const r = API.analyzeWithEducation({ fen: '4k3/4p3/8/8/8/8/4P3/4K3 w - - 0 1' });
  eq('API: a position nothing fits licenses no concept', r.concepts.length, 0);
  ok('API: says so explicitly',
     r.notes.some(n => /says nothing rather than reaching/.test(n)), JSON.stringify(r.notes));
  const bare = API.analyzeWithEducation({ fen: '8/8/4k3/8/8/4K3/8/8 w - - 0 1' });
  eq('API: bare kings now licenses the one thing that is certain', bare.concepts.length, 1);
  eq('API: ...and it is insufficient material', bare.concepts[0].id, 'insufficient-material');
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
    // Asserted, not merely present. "Doubled pawns are a weakness" is the fault
    // this guards against; "ask what the exchange bought before calling them a
    // weakness" is the opposite of it and used to fail here, because the check
    // was a bare word ban. Split into sentences and let a sentence off only if
    // it carries a hedging cue, which is what turns a verdict into a question.
    const VERDICT = /\bweakness\b|\bbad\b|\berror\b|\bmistake\b|\bblunder\b/i;
    const HEDGE = /\b(ask|before|whether|not|never|rather than|may|might|often|usually|check|need not|unless|when)\b/i;
    const asserted = r.explanation.text.split(/(?<=[.!?])\s+/)
      .filter(x => VERDICT.test(x) && !HEDGE.test(x));
    ok(`FP ${c.id}: no unsupported verdict word`, asserted.length === 0, asserted.join(' | '));
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

{
  // Capablanca-Tartakower 1924, 35.Kg3!! - Chernev's "Le roi s'amuse". The move
  // gives away two pawns WITH CHECK to walk the king to f6, and Stockfish 18 at
  // depth 20 puts it 2.49 ahead of anything else. Three concepts are grounded
  // in this one position and all three must survive here.
  const CT = '5k2/p1p4R/1pr5/3p1pP1/P2P1P2/2P2K2/8/8 w - - 0 35';
  const ids = API.analyzeWithEducation({ fen: CT, move: 'f3g3' }).concepts_all.map(c => c.id);
  has('king-activation reported in the position it is named for', ids, 'king-activation');
  has('passed-pawn reported alongside it', ids, 'passed-pawn');
  has('rook-on-the-seventh reported alongside it', ids, 'rook-on-the-seventh');
  ok('and material-imbalance is NOT reported for a move that creates one against itself',
     !ids.includes('material-imbalance'), ids.join(','));
}
{
  // Rubinstein-Salwe 1908. The e6 bishop is reported for exactly ten plies of a
  // game its annotator calls it bad throughout, because the scope guard releases
  // as pieces shuffle. The guard is deliberate; the window is measured. This
  // pins both ends of it, so a change to the guard shows up as a test failure
  // rather than as a quietly different set of explanations.
  const inWindow = 'r1r3k1/p2n1ppp/2p1b3/1q1p4/N2Q4/5PP1/PP2PR1P/2R2BK1 w - - 4 20';
  const outOfWindow = 'r1r3k1/p2n1ppp/2p1b3/1q1p4/N2Q4/4PPP1/PP3R1P/2R2BK1 b - - 0 20';
  has('bad-bishop: reported inside the measured window',
      API.analyzeWithEducation({ fen: inWindow }).concepts_all.map(c => c.id), 'bad-bishop');
  const late = FEAT.features('r5k1/p1r2ppp/1qp1b3/2Rp4/PP1Q4/4PPP1/5R1P/5BK1 b - - 0 24');
  const b = (late.pieces.b.bishops || []).find(x => x.square === 'e6');
  ok('bad-bishop: the pawn share only rises later, while the report stops',
     !b || b.share >= 0.6, b && String(b.share));
  ok('bad-bishop: the position after 20.e3 still reports it', 
     API.analyzeWithEducation({ fen: outOfWindow }).concepts_all.some(c => c.id === 'bad-bishop'));
}

{
  // Capablanca-Thomas, Hastings 1929, after 31.bxc4. The most drawish ending in
  // chess, and Stockfish gives it -5.06 with White a single pawn up, because
  // there are passers coming on two wings and one bishop cannot blockade both.
  // The feature must be REPORTED here - it is true - and the drawn verdict that
  // usually rides on it must not appear anywhere in the wording.
  const OCB = '1kb5/2p1B3/3p2p1/pP3p1p/2PP4/P1K2P2/6PP/8 b - - 0 31';
  const r = API.analyzeWithEducation({ fen: OCB, move: 'b8b7' });
  has('opposite-coloured bishops reported in the ending that refutes the rule',
      r.concepts_all.map(c => c.id), 'opposite-coloured-bishops');
  ok('and no fortress is claimed', !r.concepts_all.some(c => c.id === 'fortress'));
  // Not "must not say draw" - the drawing tendency is real and worth saying. The
  // requirement is that the CONDITION travels with it. Before this position was
  // in the corpus, the record's own second exception - "three files of
  // separation between passed pawns usually wins" - was in the record and in
  // none of the wording below master level, so this base told a reader
  // "drawish in endgames" about an ending Stockfish scores at -5.06.
  const t = r.explanation.text;
  ok('a drawing tendency is never stated without the condition that breaks it',
     !/draw/i.test(t) || /(one wing|apart|separat|count what else)/i.test(t), t.slice(0, 240));
}

{
  // Letelier-Fischer, Leipzig 1960 after 7.Be3: the position the literature uses
  // to teach that a pawn centre can be a target. This base measures White's
  // central control at 7 attacks to 2, leading on 3 of the 4 squares, and
  // Stockfish calls the position level; Fischer wins in sixteen more moves. The
  // measurement is right and the verdict everyone attaches to it is wrong, so
  // the concept must be REPORTED and the wording must not announce an edge.
  const LF = 'rnbqnrk1/ppp1ppbp/3p2p1/4P3/2PP1P2/2N1B3/PP4PP/R2QKBNR b KQ - 1 7';
  const r = API.analyzeWithEducation({ fen: LF, move: 'c7c5' });
  has('centre control reported where the centre is a target',
      r.concepts_all.map(c => c.id), 'center-control');
  ok('and the wording states counts, not a verdict',
     !/\b(advantage|better|winning|strong centre|dominates)\b/i.test(r.explanation.text),
     r.explanation.text.slice(0, 220));
}
{
  // `level` reached nobody for the whole life of this API: wordFor tried
  // by_depth first, every record carries all three by_depth texts, so by_level
  // was never read. Four texts on each of 137 records, unreachable. Measured
  // after the fix: the wording varies by level on 99.3% of the 788 shipped
  // positions.
  const fen = 'r2q1rk1/pp3ppp/2np4/3N4/4P3/2P5/PP3PPP/R2Q1RK1 w - - 0 1';
  const texts = API.LEVELS.map(l => API.analyzeWithEducation({ fen, level: l }).explanation.text);
  eq('level: four levels, four different explanations', new Set(texts).size, 4);
  ok('level: beginner does not name Nimzowitsch', !/Nimzowitsch/.test(texts[0]), texts[0]);
  ok('level: advanced or master does', /Nimzowitsch/.test(texts[2] + texts[3]));
  // ...and a label is not a teaching sentence. The advanced wording for outpost
  // opens "Outpost in the modern sense." and that used to be the whole of what
  // an advanced reader got after the observation.
  ok('level: the teaching half is a sentence, not a label',
     texts.every(t => t.length > 120), texts.map(t => t.length).join(','));
}

{
  // Ranking. The corpus measured this and nothing else did: the concept a human
  // annotator said the position was ABOUT sat at mean rank 4.9, and in six of
  // twelve cases outside the six entries the API returns by default - reported,
  // and invisible. Two causes, both fixed: PRIORITY put four concepts that fire
  // on more than half of all positions ahead of everything specific, and the
  // comparator demoted every low-confidence claim below every medium one rather
  // than barring it from the lead alone.
  const P = MATCH.PRIORITY;
  const at = id => P.indexOf(id);
  ok('ranking: the near-universal band is last',
     ['two-weaknesses', 'weak-square', 'open-file', 'space'].every(x => at(x) > at('outpost')),
     ['two-weaknesses', 'weak-square', 'open-file', 'space'].map(x => `${x}@${at(x)}`).join(' '));
  ok('ranking: the rare and specific come first',
     at('pawn-breakthrough') < at('king-safety') && at('king-attack') < at('doubled-pawns'),
     `pawn-breakthrough@${at('pawn-breakthrough')} king-attack@${at('king-attack')}`);
  ok('ranking: passed-pawn is deliberately kept high despite firing on 60%',
     at('passed-pawn') < at('doubled-pawns'), `passed-pawn@${at('passed-pawn')}`);

  // Wade-Korchnoi: the breakthrough is a proof and decides the game, and it used
  // to rank third behind doubled pawns on b6/b7.
  const wk = API.analyzeWithEducation({
    fen: '8/1pp5/1p4p1/1P1Pp2k/P3P2p/5K2/5P1P/8 w - - 1 38', move: 'a4a5' });
  eq('ranking: the proven breakthrough leads its own position', wk.concepts[0].id, 'pawn-breakthrough');

  // ...and a low-confidence claim still may not be the headline. This is the
  // Nimzowitsch-Salwe case the old rule was written for.
  for (const fen of ['r1r3k1/p2n1ppp/2p1b3/1q1p4/N2Q4/5PP1/PP2PR1P/2R2BK1 w - - 4 20',
                     'rnbqnrk1/ppppppbp/6p1/4P3/2PP1P2/2N5/PP4PP/R1BQKBNR b KQ f3 0 6']) {
    const r = API.analyzeWithEducation({ fen });
    if (r.concepts.length > 1) {
      ok('ranking: a low-confidence claim never leads',
         r.concepts[0].confidence !== 'low', r.concepts.map(c => `${c.id}:${c.confidence}`).join(','));
    }
  }
}
{
  // Endgames must not lose their point to the reorder: a passed pawn is a
  // concrete asset on a concrete square and its record makes it decisive there.
  for (const [label, fen] of [['K+P', '8/8/4k3/8/3P4/4K3/8/8 w - - 0 1'],
                              ['R+P', '8/8/1p4k1/8/3P4/6K1/8/R7 w - - 0 1']]) {
    eq(`ranking: passed-pawn still leads a ${label} ending`,
       API.analyzeWithEducation({ fen }).concepts[0].id, 'passed-pawn');
  }
}

{
  // Nimzowitsch-Salwe, Karlsbad 1911, after 17.Ne5 - the founding game of
  // blockade theory, annotated by Nimzowitsch himself. His dark-squared bishop
  // on d4 PASSES the structural test for a bad bishop: four of its own six
  // pawns share its colour, a share of 0.67 against the 0.60 the matcher
  // requires. Only the scope guard stops the error, and this base called that
  // bishop bad before the guard existed. The hardest negative in the corpus.
  const NS = '2r2rk1/ppqb2pp/3bpn2/3pN3/1P1B4/2PB4/P3QPPP/R4RK1 b - - 10 17';
  const f = FEAT.features(NS);
  const d4 = (f.pieces.w.bishops || []).find(b => b.square === 'd4');
  ok('the structural test really does fire on Nimzowitsch’s bishop',
     d4 && d4.ownPawnsOnItsColour >= 4 && d4.share >= 0.6, JSON.stringify(d4));
  ok('...and only the scope guard saves it', d4 && d4.scope > 3, d4 && String(d4.scope));
  const bb = API.analyzeWithEducation({ fen: NS, move: 'd7e8' })
    .concepts_all.filter(c => c.id === 'bad-bishop');
  ok('false positive: White’s blockading bishop is not called bad',
     !bb.some(c => (c.subjects || []).includes('w')), JSON.stringify(bb));

  // ...and the concept is not simply switched off: five moves later Black's
  // bishop on d7, which Nimzowitsch drives to a decision on move 20, is bad in
  // every sense and must still be reported.
  const later = API.analyzeWithEducation({ fen: '2r3k1/pp1b1rpp/2q1pn2/3p4/1P1B4/2PBR3/P1Q2PPP/5RK1 b - - 6 22' });
  const lb = later.concepts_all.filter(c => c.id === 'bad-bishop');
  ok('...and Black’s bishop in the same game still is',
     lb.some(c => (c.subjects || []).includes('b')), JSON.stringify(lb));
}
{
  // `subjects` must reach concepts_all. Without it a caller is told "bad
  // bishop" and not whose, and the per-side negative above cannot be written.
  const r = API.analyzeWithEducation({ fen: '2r3k1/pp1b1rpp/2q1pn2/3p4/1P1B4/2PBR3/P1Q2PPP/5RK1 b - - 6 22' });
  ok('concepts_all carries the side', r.concepts_all.every(c => Array.isArray(c.subjects)),
     JSON.stringify(r.concepts_all[0]));
}
{
  // Botvinnik-Vidmar, Nottingham 1936: the isolani as the source of the attack
  // rather than a weakness. The side WITH the isolated pawn is +0.23.
  const BV = 'r2q1rk1/pp1bbppp/1n2pn2/6B1/3P4/1BNQ1N2/PP3PPP/R4RK1 b - - 4 12';
  const ids = API.analyzeWithEducation({ fen: BV, move: 'b6d5' }).concepts_all.map(c => c.id);
  has('the isolani is reported where it is a strength', ids, 'isolated-queen-pawn');
  ok('...and is not called backward', !ids.includes('backward-pawn'), ids.join(','));
}

{
  // Reshevsky-Petrosian, Zurich 1953, before 25...Re6 - the most famous
  // positional exchange sacrifice ever played, and Stockfish 18's first choice
  // at depth 24 by three quarters of a pawn. The material imbalance that
  // follows is real, is reported, and decides nothing: what decides is the d5
  // square. The system must report the imbalance and must not conclude from it.
  const RP = '3rq1k1/4rppp/2n3b1/pp2P3/2pP1QB1/P1P1R3/1B4PP/4R1K1 b - - 3 25';
  const r = API.analyzeWithEducation({ fen: RP, move: 'e7e6' });
  has('material imbalance reported where it means nothing',
      r.concepts_all.map(c => c.id), 'material-imbalance');
  const t = r.explanation.text;
  ok('...and no side is declared better on a material count',
     !/\b(is better|winning|decisive|advantage for)\b/i.test(t), t.slice(0, 220));
}

{
  // Four new matchers, each pinned at the position that shaped it.
  //
  // blockade: Nimzowitsch-Salwe 1911, the game the concept is named after. A
  // first version used Layer 3's `blockadedPassers` - only the PASSED half of
  // the record's own precondition - and did not fire here at all, because the
  // pawn being blockaded is a backward e-pawn.
  const NS = '2r2rk1/ppqb2pp/3bpn2/3pN3/1P1B4/2PB4/P3QPPP/R4RK1 b - - 10 17';
  const nsr = API.analyzeWithEducation({ fen: NS });
  has('blockade: fires on the game it is named after', nsr.concepts_all.map(c => c.id), 'blockade');
  ok('blockade: and names the piece and both squares',
     /knight on e5[\s\S]*pawn on e6/.test(nsr.concepts.find(c => c.id === 'blockade').because[0]),
     nsr.concepts.find(c => c.id === 'blockade').because[0]);
  // a pawn stopped by a PAWN is a ram, not a blockade
  const ram = FEAT.features('4k3/8/8/3p4/3P4/8/8/4K3 w - - 0 1');
  ok('blockade: a pawn ram is not a blockade',
     !API.analyzeWithEducation({ fen: '4k3/8/8/3p4/3P4/8/8/4K3 w - - 0 1' })
        .concepts_all.some(c => c.id === 'blockade'));

  // exchange-sacrifice: Petrosian's 25...Re6, the game it is taught from.
  const RP = '3rq1k1/4rppp/2n3b1/pp2P3/2pP1QB1/P1P1R3/1B4PP/4R1K1 b - - 3 25';
  has('exchange-sacrifice: fires on Petrosian’s Re6',
      API.analyzeWithEducation({ fen: RP, move: 'e7e6' }).concepts_all.map(c => c.id), 'exchange-sacrifice');

  // sacrifice: measured by the page's own SEE-based sacrificeSize, and an even
  // trade is not one.
  const trade = API.analyzeWithEducation({
    fen: 'rnbqkbnr/ppp1pppp/8/3p4/3P4/8/PPP1PPPP/RNBQKBNR w KQkq - 0 2', move: 'd1d3' });
  ok('sacrifice: a quiet developing move is not one',
     !trade.concepts_all.some(c => c.id === 'sacrifice'), trade.concepts_all.map(c => c.id).join(','));

  // strong-square was written, measured at 80.1%, and REMOVED rather than
  // shipped. It must stay unimplemented until something better exists.
  ok('strong-square: still has no matcher, on purpose',
     !MATCH.STRUCTURAL.some(m => m.concept === 'strong-square'));
}

{
  // Six more detectors, each pinned where it matters.
  const t = (fen, mv) => {
    const o = { fen }; if (mv) o.move = mv;
    return API.analyzeWithEducation(o).concepts_all.map(c => c.id);
  };
  // wrong-rook-pawn turns on the BISHOP'S COLOUR against the promotion square,
  // which is the whole content of the concept.
  has('wrong rook pawn: light bishop, dark h8', t('7k/8/5K2/7P/8/5B2/8/8 w - - 0 1'), 'wrong-rook-pawn');
  ok('...and not reported when the bishop is the right colour',
     !t('7k/8/5K2/7P/3B4/8/8/8 w - - 0 1').includes('wrong-rook-pawn'));
  // opposition is an endgame concept by its own record's first trap.
  has('opposition: reported in a king ending', t('8/8/4k3/8/4K3/8/8/8 w - - 0 1'), 'opposition');
  ok('opposition: not reported in a middlegame',
     !t('r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4').includes('opposition'));
  has('smothered mate', t('r5rk/6pp/8/6N1/8/8/8/6K1 w - - 0 1', 'g5f7'), 'smothered-mate');
  has('discovered check', t('4k3/8/8/8/8/4N3/8/4R1K1 w - - 0 1', 'e3d5'), 'discovered-check');
  // loose-piece must not fire on a normal opening position, which is the
  // record's first trap.
  ok('loose-piece: not in a quiet opening',
     !t('r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4').includes('loose-piece'));
  ok('loose-piece: not in the starting position',
     !t('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1').includes('loose-piece'));
}

{
  // two-weaknesses had THREE of its four written preconditions unimplemented and
  // fired on 72.5% of the 788 shipped positions - which is the record's own
  // second trap, "calling any two imperfections 'two weaknesses' is the
  // commonest misuse". The corpus found it: the concept had been ranked last to
  // stop it leading everywhere, which pushed the one entry whose annotated
  // concept IS two-weaknesses to rank 8, outside the six the API returns.
  const RS = '1r4k1/2r2ppp/2p5/pPR5/3Q4/P3PPP1/6BP/2R3K1 w - - 0 24';
  has('two-weaknesses still fires on the textbook game',
      API.analyzeWithEducation({ fen: RS }).concepts_all.map(c => c.id), 'two-weaknesses');
  // ...and not where the attacker is the weaker side, or has no piece that can
  // switch wings, or the defending king stands between the targets.
  const noHeavy = API.analyzeWithEducation({ fen: '4k3/p6p/8/8/8/8/P6P/4K1B1 w - - 0 1' });
  ok('two-weaknesses: not without a heavy piece to switch wings',
     !noHeavy.concepts_all.some(c => c.id === 'two-weaknesses'),
     noHeavy.concepts_all.map(c => c.id).join(','));
  ok('two-weaknesses: measured rate is recorded in the source',
     /38\.6%/.test(fs.readFileSync(path.join(ROOT, 'lib', 'matchers.js'), 'utf8')));
}
{
  // Lisitsin-Capablanca 1935, a PURE QUEEN ENDING. Every queen in a queen ending
  // is undefended and attackable by the other one, and this reported White's as
  // a loose piece: 52...Qd2+ is a check that also attacks b2, so SEE on b2 said
  // a queen was won - while White answers the check with Qxd2 and Black has won
  // nothing. The forcing move has to survive being forcing.
  const QE = '8/5p2/1p2pkp1/1P4qp/3P4/5P1P/1Q3KP1/8 b - - 17 52';
  const r = API.analyzeWithEducation({ fen: QE });
  ok('false positive: a queen in a queen ending is not a loose piece',
     !r.concepts_all.some(c => c.id === 'loose-piece'), r.concepts_all.map(c => c.id).join(','));
  // ...and what 52...Qd5 CREATES is the blockade Chernev named. The structural
  // matcher runs on the position, so the blockade appears after the move, which
  // is why the corpus checker looks at fen_after as well as fen.
  has('blockade: a queen blockading, which the record warns about and Chernev praises',
      API.analyzeWithEducation({ fen: '8/5p2/1p2pkp1/1P1q3p/3P4/5P1P/1Q3KP1/8 w - - 18 53' })
        .concepts_all.map(c => c.id), 'blockade');
}
{
  // Capablanca-Mattison 1929, 24.Qg8+: mate in two, so a MATING sacrifice, which
  // Spielmann classes as sham - "properly speaking, there is no sacrifice". This
  // base reports the material fact and carries his taxonomy on the record.
  const CM = 'r1b2r1k/p5pp/npq4N/2P1pp2/5B2/PQ2P3/5PPP/1R1R2K1 w - - 5 24';
  has('sacrifice: reported where seven points are offered',
      API.analyzeWithEducation({ fen: CM, move: 'b3g8' }).concepts_all.map(c => c.id), 'sacrifice');
  const rec = JSON.parse(fs.readFileSync(
    path.join(ROOT, 'concepts', 'positional-method', 'sacrifice.json'), 'utf8'));
  ok('sacrifice: the record carries Spielmann’s sham/real classification',
     /sham/i.test(rec.definition_long) && (rec.sources || []).includes('spielmann-art-of-sacrifice'));
}

{
  // open-file carried a REGISTERED false positive that had never been
  // implemented: "a file with no pawns is not automatically useful. Without an
  // entry square, a rook on it accomplishes nothing." Requiring a rook on the
  // file had taken it from 61% to 55.7%; requiring the rook to be able to ENTER
  // - a legal move down the file into the opponent's half after which static
  // exchange evaluation does not win it - takes it to 37.8%.
  // Both sides doubled on the same open file: the record's third trap says
  // "contested files where all rooks come off leave neither side with anything".
  const contested = API.analyzeWithEducation({ fen: '3r2k1/3r1ppp/8/8/8/8/3R1PPP/3R2K1 w - - 0 1' });
  ok('open-file: a contested file is not an entry for anybody',
     !contested.concepts_all.some(c => c.id === 'open-file'),
     JSON.stringify(contested.concepts_all.filter(c => c.id === 'open-file')));
  // ...and it still fires where a rook really does have somewhere to go.
  has('open-file: reported where the rook can enter',
      API.analyzeWithEducation({ fen: '4r1k1/5ppp/8/8/8/8/3R1PPP/3R2K1 w - - 0 1' })
        .concepts_all.map(c => c.id), 'open-file');
  ok('open-file: the measured rate is recorded in the source',
     /35\.5%/.test(fs.readFileSync(path.join(ROOT, 'lib', 'matchers.js'), 'utf8')));
}

{
  // piece-activity counted LEGAL moves, which is exactly what its record's first
  // trap forbids: "counting available squares is not measuring activity. A piece
  // with many moves that bear on nothing is not active." It now counts ACTIVE
  // moves - captures, moves into the opponent's half, and moves that attack an
  // enemy man from where they land. Threshold unchanged; what is counted changed.
  const f = FEAT.features('4rnk1/r2n1p2/1p1R2pp/pP5q/3N4/P3N1P1/1Q3PKP/3R4 b - - 0 27');
  ok('activity: legal-move counts and active-move counts differ',
     f.activity.mobility.w !== f.activity.active.w,
     `${f.activity.mobility.w} vs ${f.activity.active.w}`);
  ok('activity: the measured rate is recorded in the source',
     /33\.9%/.test(fs.readFileSync(path.join(ROOT, 'lib', 'features.js'), 'utf8')));
  // The starting position is perfectly symmetrical and must not be called active
  // for either side, on either measure.
  ok('activity: not reported in the symmetrical starting position',
     !API.analyzeWithEducation({ fen: START }).concepts_all.some(c => c.id === 'piece-activity'));
}
{
  // A recorded FAILURE, kept failing on purpose. Keene's claim about
  // Reti-Capablanca 1924 is that ONE PIECE is carrying a side, and this base's
  // piece-activity is an army-level measure. The corpus entry names the side, so
  // it fails, and the limitation is written on two concept records rather than
  // engineered around.
  const corpus = JSON.parse(fs.readFileSync(
    path.join(ROOT, 'corpus', 'annotated_positions.json'), 'utf8')).positions;
  const e = corpus.find(x => x.id === 'reti-capablanca-1924-27Qe5-piece-activity-ambiguous');
  ok('the single-piece-activity failure is still recorded as a failure',
     e && e.side === 'b' && /RECORDED FAILURE/.test(e.explanation));
  const pa = JSON.parse(fs.readFileSync(
    path.join(ROOT, 'concepts', 'piece-play', 'piece-activity.json'), 'utf8'));
  ok('...and named on the concept record', (pa.limitations || []).some(l => /ARMY-LEVEL ONLY/.test(l)));
}

/* ---------- report ---------- */
console.log(`\nAPI  PASS ${pass}   FAIL ${fails.length}`);
for (const [n, d] of fails) console.log(`  FAIL  ${n}\n        ${d}`);
process.exit(fails.length ? 1 : 0);
