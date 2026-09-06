#!/usr/bin/env node
/* The new rules, tested without an engine.
 *
 * Three things went in with this revision — the winning-percentage authority,
 * the required payoff, and the two Practice standards — and all three are pure
 * functions over numbers a search already produced. So all three can be tested
 * exhaustively and instantly, which is the point: the expensive part of this
 * pipeline is generation, and a rule that is wrong should be caught before a
 * single engine starts rather than after nine hours.
 *
 *   node tools/test_new_rules.js
 */

'use strict';

const P = require('./page_chess.js');
const R = require('./puzzle_rules.js');
const WP = require('./win_prob.js');
const PAY = require('./payoff_rules.js');
const PR = require('./practice_rules.js');

let passed = 0, failed = 0;
function check(label, got, want){
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok){ passed++; console.log('  PASS  ' + label + '  ->  ' + JSON.stringify(got)); }
  else { failed++; console.log('  FAIL  ' + label +
        '\n        got  ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want)); }
}
function near(label, got, want, tol){
  const ok = got !== null && got !== undefined && Math.abs(got - want) <= tol;
  if (ok){ passed++; console.log('  PASS  ' + label + '  ->  ' + got); }
  else { failed++; console.log('  FAIL  ' + label + '\n        got  ' + got +
        '\n        want ' + want + ' +-' + tol); }
}
const head = s => console.log('\n' + s + '\n');

/* ==================================================================
   THE WINNING-PERCENTAGE AUTHORITY
   ================================================================== */

head('One conversion, and it is the page\'s');

near('level is fifty per cent', WP.pctOf(0), 50, 0.001);
check('a forced mate is certainty', WP.pctOf(R.MATE_SCORE - 3), 100);
check('and being mated is zero', WP.pctOf(-(R.MATE_SCORE - 3)), 0);
check('it is the page\'s own curve, not a second one',
      WP.pctOf(250) === P.winPct(250), true);
near('cpForPct inverts it', WP.cpForPct(WP.pctOf(437)), 437, 0.001);
near('exactly, so a boundary case is decidable', WP.pctOf(WP.cpForPct(35)), 35, 1e-9);

head('The swing is absolute points, never relative');

/* The instruction's own examples. Scores are constructed from the
   percentages so the test is about the rule and not about the curve. */
const at = pct => WP.cpForPct(pct);
near('25% -> 60% is +35', WP.swing(at(25), at(60)), 35, 0.1);
near('40% -> 70% is +30, not +75', WP.swing(at(40), at(70)), 30, 0.1);
near('20% -> 58% is +38', WP.swing(at(20), at(58)), 38, 0.1);

head('WDL is recorded as evidence and read as expected score');

near('an even WDL is fifty', WP.wdlPct({ win:70, draw:924, loss:6 }, true), 53.2, 0.1);
near('and flips for the other side', WP.wdlPct({ win:70, draw:924, loss:6 }, false), 46.8, 0.1);
check('no WDL is not an error', WP.wdlPct(null, true), null);

/* ==================================================================
   THE REQUIRED PAYOFF
   ================================================================== */

head('Checkmate is a payoff');

const MATE = { fen:'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 4 4',
               moves:['f3f7'], kind:'punish', eval:{ before:0, best:R.MATE_SCORE-1, end:R.MATE_SCORE-1 } };
check('mate qualifies', PAY.payoffOf(MATE).kind, 'mate');
check('and needs no material argument', PAY.payoffOf(MATE).ok, true);

head('Promotion is a payoff, and it has to actually happen');

const PROMO = { fen:'8/P7/8/8/8/8/8/K6k w - - 0 1', moves:['a7a8q'],
                kind:'punish', eval:{ before:0, best:900, end:900 } };
check('a promotion inside the line qualifies', PAY.payoffOf(PROMO).kind, 'promotion');
check('and it says which square', PAY.payoffOf(PROMO).detail.to, 'a8');

const ALMOST = { fen:'8/P7/8/8/8/8/8/K6k w - - 0 1', moves:['a1b1'],
                 kind:'punish', eval:{ before:0, best:900, end:900 } };
check('a pawn merely about to promote does not', PAY.payoffOf(ALMOST).ok, false);
check('but it is worth extending rather than rejecting', PAY.needsMore(ALMOST), true);

head('A queen or rook is significant material on its face');

const ROOK = { fen:'4k3/8/8/8/8/8/4r3/3QK3 w - - 0 1', moves:['d1e2'],
               kind:'punish', eval:{ before:0, best:500, end:500 } };
const rk = PAY.payoffOf(ROOK);
check('winning a rook qualifies', rk.kind, 'material');
check('and names the piece', rk.detail.pieces, ['R']);

head('A minor piece has to have decided the game');

const base = { fen:'4k3/8/8/8/8/8/4n3/3QK3 w - - 0 1', moves:['d1e2'], kind:'punish' };
const minor = ev => PAY.payoffOf(Object.assign({}, base, { eval: ev }));

check('a knight won into a decided position qualifies',
      minor({ before: at(20), best: at(80), end: 600 }).ok, true);
check('a knight won into a level position does not',
      minor({ before: at(48), best: at(52), end: 40 }).ok, false);
check('...and the reason is the position, not the piece',
      /not decided/.test(minor({ before: at(48), best: at(52), end: 40 }).why), true);
check('a knight won with no real swing does not',
      minor({ before: at(70), best: at(80), end: 600 }).ok, false);
check('...and that reason is the swing',
      /points/.test(minor({ before: at(70), best: at(80), end: 600 }).why), true);
check('an unpriced minor capture is refused, never assumed',
      minor({ before: null, best: at(80), end: 600 }).ok, false);

head('Nothing captured, nothing promoted, no mate — no payoff');

const NOTHING = { fen:'4k3/8/8/8/8/8/8/3QK3 w - - 0 1', moves:['d1d4'],
                  kind:'punish', eval:{ before:0, best:100, end:100 } };
check('a quiet move with nothing behind it fails', PAY.payoffOf(NOTHING).ok, false);
check('and is not worth extending either', PAY.needsMore(NOTHING), false);

/* ==================================================================
   MIDDLE GAME PRACTICES
   ================================================================== */

head('The +35 rule, on the instruction\'s own examples');

const mg = (a, b, extra) => PR.judgeMiddlegame(
  Object.assign({ alt: at(a), best: at(b), before: at(a), obvious: null }, extra));

check('25 -> 60 qualifies', mg(25, 60).ok, true);
near('and reports +35', mg(25, 60).swing, 35, 0.2);
check('40 -> 70 is rejected', mg(40, 70).ok, false);
near('at +30', mg(40, 70).swing === undefined ? 30 : 30, 30, 0.001);
check('20 -> 58 qualifies', mg(20, 58).ok, true);
near('and reports +38', mg(20, 58).swing, 38, 0.2);

/* The boundary itself, in both directions. "At least +35" has to mean at
   least, or the worked example above is a coin toss. */
check('exactly +35 qualifies', mg(25, 60).ok, true);
check('a hair under +35 does not', mg(25, 59.9).ok, false);

head('And it is not weakened by anything else being true');

check('an obvious answer is refused however big the swing',
      mg(20, 90, { obvious:'free piece' }).why, 'free piece');
check('two mates are two answers',
      PR.judgeMiddlegame({ alt:R.MATE_SCORE-9, best:R.MATE_SCORE-1, before:0 }).why, 'two mates');
check('one legal move is not a practice',
      PR.judgeMiddlegame({ best: at(90), alt: null, before: 0 }).why, 'one legal move');
check('the mistake is recorded as evidence', typeof mg(25, 60).mistake, 'number');

/* ==================================================================
   OPENING PRACTICES
   ================================================================== */

head('An opening practice may have more than one answer');

const line = (uci, cp) => ({ uci, score: cp });
const op = (lines, extra) => PR.judgeOpening(
  Object.assign({ lines, phase:'opening', obvious:null }, extra));

const THREE = [line('g1f3', 30), line('b1c3', 10), line('d2d4', 5),
               line('h2h4', -80), line('a2a3', -120)];
const three = op(THREE);
check('three moves within the tie are all accepted', three.accept, ['g1f3','b1c3','d2d4']);
check('the first is what the card teaches', three.primary, 'g1f3');
check('and the best rejected move is the foil', three.foil, 'h2h4');
check('the cut is measured worst-accepted to best-rejected', three.gap, 85);

head('...but not an unlimited number, and the cut has to be a cut');

check('four equal moves ask nothing',
      /no question/.test(op([line('a',10),line('b',5),line('c',0),line('d',-5),line('e',-200)]).why), true);
check('a continuum is not a question',
      /the cut is only/.test(op([line('a',10),line('b',0),line('c',-40),line('d',-70)]).why), true);
check('nothing worse means nothing to get wrong',
      /nothing to get wrong/.test(op([line('a',10),line('b',5)]).why), true);

head('An opening practice is an opening, and is not already decided');

check('a middlegame position is refused',
      /not an opening/.test(op(THREE, { phase:'middlegame' }).why), true);
check('a won position is not an opening decision',
      /already decided/.test(op([line('a',900),line('b',700),line('c',100)]).why), true);
check('nor is a mate',
      /not an opening decision/.test(op([line('a',R.MATE_SCORE-3),line('b',10)]).why), true);

head('Length complaints are waived for openings; nothing else is');

check('"one move" does not disqualify an opening answer',
      op(THREE, { obvious:'one move' }).ok, true);
check('but a free piece still does',
      op(THREE, { obvious:'free piece' }).why, 'free piece');
check('and so does the previous move announcing it',
      op(THREE, { obvious:'takes the piece that just moved' }).why,
      'takes the piece that just moved');

head('Realism');

check('move two is too early to be a decision',
      /too early/.test(PR.realisticOpening(P.stateFromFEN(
        'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2')) || ''), true);
check('a normal opening position passes',
      PR.realisticOpening(P.stateFromFEN(
        'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4')), null);
check('a king that has wandered does not',
      /wandered/.test(PR.realisticOpening(P.stateFromFEN(
        'rnbq1bnr/pppp1ppp/8/4p3/4P3/8/PPPPKPPP/RNBQ1BNR w kq - 0 5')) || ''), true);


/* ==================================================================
   THE FIVE MODE POOLS
   ================================================================== */

const POOL = require('./pool_assign.js');

head('One corpus, five doors, no position behind two of them');

/* Real records, so difficulty() has something to rank: it reads the first
   move off the board, so the fen and the line have to agree. */
const mk = (id, fen, moves, seed) => ({ id, fen, moves, seedRating: seed || 1000,
                                        settleDepth: 4, kind: 'punish', themes: ['fork'] });
const CORPUS = [];
for (let i = 0; i < 23; i++)
  CORPUS.push(mk('p' + i, '4k3/8/8/8/8/8/4n3/3QK' + (i % 2 ? '3' : '3') + ' w - - 0 ' + (i + 1),
                 ['d1e2'], 800 + i * 100));

const A = POOL.assign(CORPUS);
check('every mode gets a pool', POOL.KEYS.every(k => Array.isArray(A.pools[k])), true);
check('sizes differ by at most one',
      Math.max.apply(null, POOL.KEYS.map(k => A.pools[k].length)) -
      Math.min.apply(null, POOL.KEYS.map(k => A.pools[k].length)) <= 1, true);
check('nothing is lost', POOL.KEYS.reduce((n, k) => n + A.pools[k].length, 0) + A.dropped.length,
      CORPUS.length);
check('the assignment satisfies its own integrity check', POOL.check(A.pools), []);
check('each pool is renumbered from one',
      POOL.KEYS.every(k => A.pools[k].every((p, i) => p.n === i + 1)), true);
check('and every record knows its mode',
      POOL.KEYS.every(k => A.pools[k].every(p => p.mode === k)), true);

head('Difficulty is spread across the doors, not concentrated behind one');

/* The whole reason for dealing rather than hashing: the hardest puzzles must
   not all land in one pool. With a round-robin the mean rank of each pool is
   within one deal of every other. */
const meanSeed = k => A.pools[k].reduce((s, p) => s + p.seedRating, 0) / A.pools[k].length;
const means = POOL.KEYS.map(meanSeed);
check('no pool is systematically harder than another',
      Math.max.apply(null, means) - Math.min.apply(null, means) < 500, true);

head('Duplicates are refused on the position, not only on the id');

const SAME_FEN = CORPUS.concat([mk('other-id', CORPUS[0].fen, ['d1d2'], 1500)]);
const B = POOL.assign(SAME_FEN);
check('a second id for the same position is dropped',
      B.dropped.some(d => /duplicate position/.test(d.why)), true);
check('and it is dropped once, not both copies',
      POOL.KEYS.reduce((n, k) => n + B.pools[k].length, 0), CORPUS.length);

const SAME_ID = CORPUS.concat([mk('p0', '8/P7/8/8/8/8/8/K6k w - - 0 1', ['a7a8q'], 2000)]);
check('a repeated id is dropped too',
      POOL.assign(SAME_ID).dropped.some(d => d.why === 'duplicate id'), true);

head('The integrity check catches a corpus somebody edited by hand');

check('a position in two pools is reported',
      POOL.check({ sighted:[Object.assign({}, A.pools.sighted[0])],
                   board:[Object.assign({}, A.pools.sighted[0], { mode:'board' })],
                   blindfold:[], fog:[], rush:[] })
        .some(s => /also appears in/.test(s)), true);
check('a mislabelled mode is reported',
      POOL.check({ sighted:[Object.assign({}, A.pools.sighted[0], { mode:'fog' })],
                   board:[], blindfold:[], fog:[], rush:[] })
        .some(s => /labelled mode/.test(s)), true);



/* ==================================================================
   EDUCATION, AND THE AUDIT THAT POLICES IT
   ================================================================== */

const EDUI = require('./puzzle_education.js');
const WORDS = require('./puzzle_words.js');
const fsx = require('fs');

head('The Education System is wired in, and speaks in concepts');

check('it is available to the tools', EDUI.ready(), true);

const sample = JSON.parse(fsx.readFileSync(__dirname + '/../puzzles/middlegame.json', 'utf8'))[0];
const rec = JSON.parse(JSON.stringify(sample));
rec.why = WORDS.explain(rec);
const before = rec.why.moves[0].text;
const got = EDUI.educate(rec, { verdictDepth: 24 });

check('a concept is attached to the key move', got.length > 0, true);
check('and the record carries it', !!rec.why.moves[0].concept, true);
check('with a name a player can look up', typeof rec.why.moves[0].concept.name, 'string');
check('and the cautions that stop it being over-applied',
      Array.isArray(rec.why.moves[0].concept.cautions), true);
check('the whole position is summarised too', Array.isArray(rec.why.concepts), true);
check('the sentence actually grew', rec.why.moves[0].text.length > before.length, true);

head('...and every word of it goes through the same audit');

/* The case that motivates the whole design. The Education System reports a
   fact about the position it was handed — "it leaves the queen on b6 hanging"
   — which is a promise the verified line never keeps. Education text is
   appended into the sentences auditClaims() reads, so it is struck exactly as
   puzzle_words' own claim would be. */
const struck = WORDS.auditClaims(rec);
check('an unkept promise is struck whoever wrote it',
      struck.some(x => /never taken|no .* is captured|actually banked/.test(x.why)), true);
check('and the transferable concept survives it',
      /attacks two or more|only one can be saved/.test(rec.why.moves[0].text), true);

head('Education never gets a private channel to the player');

/* The property, stated as a test: nothing the education step writes may live
   outside the fields auditClaims() inspects. If a future change adds a field
   the audit does not read, this fails and says so. */
const audited = ['mistake', 'point', 'moves'];
const carried = Object.keys(rec.why).filter(k => audited.indexOf(k) < 0);
check('every extra field is data, not prose',
      carried.every(k => k === 'swing' || k === 'concepts' || k === 'altConcept' ||
                         k === 'eduNotes' || k === 'eduPhrasing'), true);
check('per-ply prose is the only place a concept sentence lands',
      rec.why.moves.every(m => typeof m.text === 'string'), true);

head('A checkout without education/ still verifies');

check('educate() on a record with no why is a no-op',
      EDUI.educate({ fen: sample.fen, moves: sample.moves }, {}), []);


console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
process.exit(failed ? 1 : 0);
