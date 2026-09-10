// sloppy on purpose: the eval below has to leave its definitions in this scope
/* Study Board's reasoning, lifted out of blind-chess.html by name.
 *
 * What the page does with the engine's numbers is pure — judgeMove() turns
 * two readings into a mark, studyWinFor() into a chance, studyThreats() into
 * arrows, studyReasons() and studyExplain() into words, studyPack() into a
 * link — so all of it can be checked here without a browser, a worker or a
 * server. The engine itself is not run: the readings are written by hand,
 * which is the point, since the questions are about what the page CONCLUDES
 * from a reading and not about what Stockfish says.
 *
 * The extraction is the one test_review.js and tools/page_chess.js use, and
 * carries the same warning: renaming anything in DECLS or FNS breaks this
 * suite on purpose.
 *
 *   node server/test_study.js         # needs no server
 */
const fs = require('fs');
const path = require('path');
const PAGE = path.join(__dirname, '..', 'blind-chess.html');
const SRC = fs.readFileSync(PAGE, 'utf8');

function grab(re, what){
  const m = SRC.match(re);
  if (!m) throw new Error(what + ' not found in blind-chess.html');
  return m[0];
}
const fn = name => grab(new RegExp('\\n(?:async )?function ' + name + '\\s*\\([\\s\\S]*?\\n\\}'), 'function ' + name + '()');
const decl = name => {
  const block = SRC.match(new RegExp('\\n(?:const|let) ' + name + '\\s*=\\s*[\\{\\[][\\s\\S]*?\\n[\\}\\]];'));
  return block ? block[0] : grab(new RegExp('\\n(?:const|let) ' + name + '\\b[^\\n]*?;'), name);
};

const DECLS = ['VAL','FILES','rowOf','colOf','SQNAME','uciOf','sqName','onBoard','other',
               'idCounter','mk','DIR_N','DIR_B','DIR_R','DIR_K','PIECE_WORD','VERDICT',
               'STUDY_VERSION','SIDE_WORD','wordCount','capFirst'];
const FNS = ['startBoard','newState','cloneState','fenOf','stateFromFEN','slide','step','addPawn',
             'pseudoMoves','isAttacked','kingSq','inCheck','makeMove','legalMoves','toSAN',
             'attackersOf','defendersOf','see','sliderLines','betweenSq','findMotifs',
             'winPct','sacrificeSize','sacrificeDeficit','sfScore','judgeMove','pvLine','materialFor','materialWord',
             'describeBest',
             'studyKey','studyWinFor','studyMate','pvWalk','bestSee','lineGain','studyThreats',
             'studyRec','studyBuild','forkWords','motifShort','pieceSurvives','isPassed','studyReasons','studyOutcome',
             'studyExplain','studyPack','studyUnpack','studyB64','studyUnB64','studyEncode','studyDecode'];

let bundle = [grab(/\nconst W = 'w', B = 'b';/, "const W/B")];
for (const d of DECLS) bundle.push(decl(d));
for (const f of FNS) bundle.push(fn(f));
// `const` inside a sloppy eval stays inside it; `var` does not
eval(bundle.join('\n').replace(/(^|\n)(?:const|let) /g, '$1var '));

let passed = 0, failed = 0;
function check(label, got, want){
  if (got === want){ passed++; console.log('  PASS  ' + label + '  ->  ' + got); }
  else { failed++; console.log('  FAIL  ' + label + '\n        got  ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want)); }
}
function ok(label, cond, detail){
  if (cond){ passed++; console.log('  PASS  ' + label); }
  else { failed++; console.log('  FAIL  ' + label + (detail !== undefined ? '\n        ' + String(detail).slice(0, 300) : '')); }
}

/* ---- helpers: a move by UCI, a reading by hand ---- */
const at = n => (n.charCodeAt(0) - 97) + (8 - +n[1]) * 8;
function mv(st, uci){
  const all = legalMoves(st, st.turn);
  const m = all.find(x => uciOf(x) === uci);
  if (!m) throw new Error(uci + ' is not legal in ' + fenOf(st));
  return m;
}
const R = (cp, best, second, secondCp, pv) => ({
  cp: cp === undefined ? null : cp, mate: null, best: best || null, pv: pv || (best ? [best] : null),
  second: second ? { cp: secondCp === undefined ? null : secondCp, mate: null, best: second, pv: [second] } : null
});
const M = (n, best, pv) => ({ cp: null, mate: n, best: best || null, pv: pv || (best ? [best] : null), second: null });
// a game as records, from a start position, a move list and hand-written readings
function game(fen, ucis, evals){
  const st0 = fen ? stateFromFEN(fen) : newState();
  const g = { uci: ucis, sans: [], white: 'White', black: 'Black', mode: 'sighted', result: '', human: W };
  // studyBuild starts from the initial position; for a fen we replay by hand
  const recs = [];
  let s = st0;
  for (let i = 0; i < ucis.length; i++){
    const all = legalMoves(s, s.turn);
    const m = mv(s, ucis[i]);
    const rec = studyRec(g, i, s, all, m, evals[i] || null, evals[i + 1] || null);
    recs.push(rec);
    s = rec.post;
  }
  return recs;
}

/* ============================================================
   1 · the seven marks
   ============================================================ */
console.log('\nThe marks\n');
{
  const keys = Object.keys(VERDICT);
  check('seven marks, no more', keys.join(','), 'brilliant,great,best,good,inaccuracy,mistake,blunder');
  check('best is a star', VERDICT.best.sym, '★');
  check('good is a thumbs-up', VERDICT.good.sym, '👍');
  check('inaccuracy is ?', VERDICT.inaccuracy.sym, '?');
  check('mistake is a cross', VERDICT.mistake.sym, '✕');
  check('blunder is ??', VERDICT.blunder.sym, '??');
  ok('every mark knows its own key', keys.every(k => VERDICT[k].key === k));
}

// an ordinary opening position: 1.e4 e5 2.Nf3 Nc6 3.Bb5 a6, White to move
const START = newState();
{
  const st = START;
  const e4 = mv(st, 'e2e4');
  // the engine liked e4 and the reply keeps it level: best
  check('the first choice is best', judgeMove(st, e4, R(30, 'e2e4', 'd2d4', 25), R(-28), true, 5).key, 'best');
  // a different move the deeper search rates just as well is best too
  check('an equal alternative is best', judgeMove(st, mv(st, 'd2d4'), R(30, 'e2e4', 'd2d4', 25), R(-30), false, 5).key, 'best');
  // small losses, in win%: 3.7 points is good, 8 is an inaccuracy, 15 a mistake, 30 a blunder
  const lossOf = cpAfter => winPct(30) - winPct(cpAfter);
  const judge = cpAfter => judgeMove(st, mv(st, 'a2a3'), R(30, 'e2e4', 'd2d4', 25), R(-cpAfter), false, 5).key;
  ok('a 3-point drop is good (' + lossOf(-15).toFixed(1) + ')', lossOf(-15) < 5 && judge(-15) === 'good');
  ok('an 8-point drop is an inaccuracy (' + lossOf(-60).toFixed(1) + ')', lossOf(-60) >= 5 && lossOf(-60) < 10 && judge(-60) === 'inaccuracy');
  ok('a 15-point drop is a mistake (' + lossOf(-140).toFixed(1) + ')', lossOf(-140) >= 10 && lossOf(-140) < 20 && judge(-140) === 'mistake');
  ok('a 30-point drop is a blunder (' + lossOf(-320).toFixed(1) + ')', lossOf(-320) >= 20 && judge(-320) === 'blunder');
  // a pawn dropped while a queen up is nothing; the same pawn from level is real
  check('a pawn while a queen up is still good', judgeMove(st, mv(st, 'a2a3'), R(900, 'e2e4'), R(-800), false, 5).key, 'good');
  check('a pawn from level is an inaccuracy or worse', judgeMove(st, mv(st, 'a2a3'), R(0, 'e2e4'), R(100), false, 5).key !== 'good', true);
}
{
  // mates: kept, slowed, lost, walked into, delivered
  const st = START;
  const m = mv(st, 'e2e4');
  check('keeping a mate is best', judgeMove(st, m, M(3, 'e2e4'), M(-2), true, null).key, 'best');
  check('a mate two moves slower is good', judgeMove(st, m, M(3, 'e2e4'), M(-4), false, null).key, 'good');
  check('a mate much slower is an inaccuracy', judgeMove(st, m, M(3, 'e2e4'), M(-7), false, null).key, 'inaccuracy');
  check('losing a mate but still winning is a mistake', judgeMove(st, m, M(3, 'e2e4'), R(-500), false, null).key, 'mistake');
  check('losing a mate into a level game is a blunder', judgeMove(st, m, M(3, 'e2e4'), R(10), false, null).key, 'blunder');
  check('walking into a mate is a blunder', judgeMove(st, m, R(50, 'd2d4'), M(4), false, null).key, 'blunder');
  check('being mated already, the slowest defence is best', judgeMove(st, m, M(-3, 'e2e4'), M(3), true, null).key, 'best');
  check('delivering mate (mate 0 after) is best', judgeMove(st, m, R(900, 'd2d4'), M(0), false, null).key, 'best');
  check('escaping an announced mate is best', judgeMove(st, m, M(-3, 'd2d4'), R(200), false, null).key, 'best');
}
{
  /* Brilliant is a sacrifice the engine confirms. The Greek gift: after
     1.e4 e5 2.Nf3 Nc6 3.Bc4 Bc5 4.O-O Nf6 5.d3 O-O 6.Bg5 d6 7.Nc3 Bg4 8.Nd5 Nd4
     the sacrifice Bxf7+?! is not it; use a cleaner board — a bishop that can
     be taken on h7, with the engine calling it best and clearly ahead. */
  const fen = 'r1bq1rk1/pppn1ppp/3bpn2/3p4/2PP4/2NBPN2/PP3PPP/R2QK2R w KQ - 0 8';
  const st = stateFromFEN(fen);
  const bxh7 = mv(st, 'd3h7');
  ok('the bishop on h7 can be taken', sacrificeSize(st, bxh7, makeMove(st, bxh7)) >= 200, sacrificeSize(st, bxh7, makeMove(st, bxh7)));
  // the sacrifice is measured after the engine's reply: Kxh7 takes it
  const taken = R(-190, 'g8h7', null, null, ['g8h7', 'f3g5']);
  check('once Kxh7 is played White is a piece for a pawn down', sacrificeDeficit(st, bxh7, taken), 230);
  check('and not down at all if the engine declines it', sacrificeDeficit(st, bxh7, R(-190, 'g8h8')), -100);
  check('a sacrifice the engine rates best and ahead is brilliant',
        judgeMove(st, bxh7, R(180, 'd3h7', 'e1g1', 40), taken, true, 140).key, 'brilliant');
  check('the same sacrifice while a queen up is only best',
        judgeMove(st, bxh7, R(950, 'd3h7', 'e1g1', 900), Object.assign({}, taken, { cp: -940 }), true, 50).key, 'best');
  check('a sacrifice that comes out level is best, not brilliant',
        judgeMove(st, bxh7, R(20, 'd3h7', 'e1g1', 10), Object.assign({}, taken, { cp: -20 }), true, 10).key, 'best');
  check('a sacrifice that does not hold is not brilliant',
        judgeMove(st, bxh7, R(20, 'e1g1', 'd3h7', -300), Object.assign({}, taken, { cp: 320 }), false, 320).key !== 'brilliant', true);
  // a fork that drops a knight elsewhere but wins a rook is not a sacrifice
  const forkSt = stateFromFEN('4k3/8/8/3n4/1n6/2N5/2P5/R3K3 b - - 0 1');
  const nxc2 = mv(forkSt, 'b4c2');
  ok('sacrificeSize alone calls the fork a sacrifice', sacrificeSize(forkSt, nxc2, makeMove(forkSt, nxc2)) >= 200);
  check('but after Kd1 Black is not down', sacrificeDeficit(forkSt, nxc2, R(-100, 'e1d1')) <= 0, true);
  check('so it is best, not brilliant', judgeMove(forkSt, nxc2, R(200, 'b4c2', 'd5c3', 0), R(-200, 'e1d1'), true, 200).key, 'best');
  // a queen that takes a knight and is taken back has not been sacrificed
  const xSt = stateFromFEN('3qk3/8/8/6N1/5P2/8/8/4K2Q w - - 0 1');
  const qh5 = mv(xSt, 'h1h5');
  // and a capture the mover would recapture at a loss is not settled by it
  const trapSt = stateFromFEN('r1bq1b1r/ppp3pp/4k3/3np3/2B5/P1N2Q2/1PnP1PPP/R1BK3R b - - 1 10');
  check('a knight that takes a rook and loses its partner is not a sacrifice', sacrificeDeficit(trapSt, mv(trapSt, 'c2a1'), R(28, 'c3d5')) <= 0, true);
  ok('Qxg5 fxg5 is an exchange, not a sacrifice', sacrificeDeficit(xSt, qh5, R(-300, 'd8g5')) <= 0, sacrificeDeficit(xSt, qh5, R(-300, 'd8g5')));
  // a capture the exchange already justifies is never "great", however far the runner-up falls
  const freeSt = stateFromFEN('4k2r/8/8/8/8/8/8/4K2R w K - 0 1');
  const rxa1 = mv(freeSt, 'h1h8');
  check('taking a hanging rook is best, not great', judgeMove(freeSt, rxa1, R(500, 'h1h8', 'e1f1', -400), R(-500, 'e8d7'), true, 900).key, 'best');
  // great: the runner-up costs real winning chances and the piece is safe
  const quiet = mv(st, 'e1g1');
  check('the only move that holds is great', judgeMove(st, quiet, R(20, 'e1g1', 'a2a3', -250), R(-20, 'e8g8'), true, 270).key, 'great');
  check('a first choice with a close runner-up is merely best', judgeMove(st, quiet, R(20, 'e1g1', 'a2a3', 0), R(-20), true, 20).key, 'best');
}

/* ============================================================
   2 · winning chances, from the mover's chair
   ============================================================ */
console.log('\nWinning chances\n');
{
  check('level is 50', studyWinFor(R(0), false), 50);
  check('+100 is above 50', studyWinFor(R(100), false) > 50, true);
  check('a reading from the other chair is flipped', studyWinFor(R(100), true) < 50, true);
  check('the flip is symmetric', studyWinFor(R(100), true), 100 - studyWinFor(R(100), false));
  check('nothing short of mate reaches 100', studyWinFor(R(5000), false), 99);
  check('nor 0', studyWinFor(R(-5000), false), 1);
  check('a mate for the mover is 100', studyWinFor(M(3), false), 100);
  check('a mate against the mover is 0', studyWinFor(M(-3), false), 0);
  check('the opponent being mated after the move is 100', studyWinFor(M(-4), true), 100);
  check('and the mover being mated after it is 0', studyWinFor(M(4), true), 0);
  check('mate 0 after the move is a mate delivered', studyWinFor(M(0), true), 100);
  check('mate 0 before the move is a mover already mated', studyWinFor(M(0), false), 0);
  check('no reading is null', studyWinFor(null, false), null);
  check('a mate distance flips with the chair', studyMate(M(3), true), -3);
  check('and mate 0 stays 0', studyMate(M(0), true), 0);
}

/* ============================================================
   3 · records: before, after, delta, best, reply
   ============================================================ */
console.log('\nRecords\n');
{
  // 1.e4 e5 2.Qh5 Nc6 3.Bc4 Nf6?? 4.Qxf7# — scholar's mate, and every reading by hand
  const ucis = ['e2e4','e7e5','d1h5','b8c6','f1c4','g8f6','h5f7'];
  const evals = [
    R(30, 'e2e4', 'd2d4', 25, ['e2e4','e7e5','g1f3']),
    R(-25, 'e7e5', 'c7c5', -30, ['e7e5','g1f3']),
    R(20, 'g1f3', 'd1h5', -20, ['g1f3','b8c6']),
    R(30, 'b8c6', 'g8f6', 0, ['b8c6','f1c4','g7g6']),
    R(-20, 'f1c4', 'b1c3', -30, ['f1c4','g7g6','h5f3']),
    R(20, 'g7g6', 'g8f6', -20000 + 20000 - 1, ['g7g6','h5f3']),   // Black to move: g6 holds, Nf6 loses
    M(1, 'h5f7', ['h5f7']),
    M(0)
  ];
  evals[5].second = { cp: null, mate: -1, best: 'g8f6', pv: ['g8f6','h5f7'] };
  const g = { uci: ucis, sans: [], white: 'A', black: 'B', mode: 'sighted', result: 'Checkmate', human: W };
  const recs = studyBuild(g, evals);
  check('one record per move', recs.length, 7);
  check('the first record is White\'s', recs[0].side, W);
  check('and names its move', recs[0].san, 'e4');
  check('with the position before it', recs[0].fenBefore, fenOf(newState()));
  check('and after it', recs[0].fenAfter, fenOf(makeMove(newState(), mv(newState(), 'e2e4'))));
  check('e4 was the first choice', recs[0].playedWasBest, true);
  check('and is marked best', recs[0].verdict.key, 'best');
  check('its winning chances are read from White\'s chair', recs[0].winBefore, studyWinFor(evals[0], false));
  check('and after, flipped from Black\'s', recs[0].winAfter, studyWinFor(evals[1], true));
  check('the delta is the difference', recs[0].delta, recs[0].winAfter - recs[0].winBefore);
  check('the engine\'s reply is named in SAN', recs[0].reply.san, 'e5');
  check('the engine\'s line is replayed in SAN', recs[0].pv.sans.join(' '), 'e4 e5 Nf3');
  check('Qh5 was not the first choice', recs[2].playedWasBest, false);
  check('and the best move is named', recs[2].best.san, 'Nf3');
  check('Nf6 walks into mate: a blunder', recs[5].verdict.key, 'blunder');
  check('with 0% after it', recs[5].winAfter, 0);
  check('Qxf7# is best', recs[6].verdict.key, 'best');
  check('and 100% after it', recs[6].winAfter, 100);
  ok('the mating move threatens nothing more', recs[6].threats.length === 0 && recs[6].vulns.length === 0);
  // the reasons on the blunder
  const why = studyReasons(recs[5], null);
  ok('the blunder says it allows the mate', why.some(r => /Allows a forced mate in 1|Allows mate in one/.test(r)), why.join(' | '));
  ok('and every reason is ten words or fewer', why.every(r => wordCount(r) <= 10), why.join(' | '));
  const whyMate = studyReasons(recs[6], null);
  ok('the mating move says so', whyMate[0] === 'Delivers checkmate', whyMate.join(' | '));
  // the explanation on the blunder does not contradict the line
  const ex = studyExplain(recs[5], null);
  ok('the explanation has its sections', ex.length >= 4 && ex.every(s => s.h && s.p.length), ex.map(s => s.h).join(' | '));
  ok('it names the reply', ex.some(s => s.p.some(p => /Qxf7#/.test(p))), JSON.stringify(ex));
  ok('and it never says "you played … best was"', !ex.some(s => s.p.some(p => /best was/i.test(p))));
}

/* ============================================================
   4 · arrows: threats made, weaknesses opened, and nothing else
   ============================================================ */
console.log('\nArrows\n');
{
  // a knight fork of king and rook: Nc7+ from a knight on b5, White to move
  const st = stateFromFEN('r3k3/8/8/1N6/8/8/8/4K3 w - - 0 1');
  const m = mv(st, 'b5c7');
  const after = makeMove(st, m);
  const tv = studyThreats(st, m, after, R(-500, 'e8d8', null, null, ['e8d8','c7a8']));
  ok('the fork draws an arrow to the rook', tv.threats.some(t => t.kind === 'threat' && t.to === at('a8') && t.from === at('c7')), JSON.stringify(tv));
  ok('and none to the king, which is check and not a threat', !tv.threats.some(t => t.to === at('e8')));
  check('no weakness was opened', tv.vulns.length, 0);
  const g = { uci:['b5c7'], sans:[], white:'W', black:'B', mode:'sighted', result:'', human:W };
  const rec = studyRec(g, 0, st, legalMoves(st, st.turn), m, R(500, 'b5c7'), R(-500, 'e8d8', null, null, ['e8d8','c7a8']));
  const why = studyReasons(rec, null);
  ok('the reason says what it wins', why.some(r => /Wins a rook/.test(r)), why.join(' | '));
}
{
  // hanging a piece: a rook stepping onto a square the bishop covers
  const st = stateFromFEN('4k3/2b5/8/8/8/8/8/R3K3 w - - 0 1');
  const m = mv(st, 'a1a5');
  const after = makeMove(st, m);
  const tv = studyThreats(st, m, after, R(500, 'c7a5'));
  ok('the hanging rook draws an arrow from the bishop', tv.vulns.some(t => t.from === at('c7') && t.to === at('a5')), JSON.stringify(tv));
  ok('and the engine taking it is recorded', tv.vulns[0].taken === true);
  check('nothing is threatened in return', tv.threats.length, 0);
}
{
  // a quiet move with nothing in it: no arrow at all
  const st = START;
  const m = mv(st, 'g1f3');
  const after = makeMove(st, m);
  const tv = studyThreats(st, m, after, R(-20, 'e7e5'));
  check('Nf3 from the start draws nothing', tv.threats.length + tv.vulns.length, 0);
  // a pawn attacked that the engine ignores is not an arrow either
  const st2 = stateFromFEN('4k3/8/8/3p4/8/8/8/4KB2 w - - 0 1');
  const m2 = mv(st2, 'f1g2');
  const tv2 = studyThreats(st2, m2, makeMove(st2, m2), R(0, 'e8d7'));
  check('a pawn the engine does not bother with is no arrow', tv2.threats.length, 0);
  const tv3 = studyThreats(st2, m2, makeMove(st2, m2), R(0, 'd5d4'));
  check('but the same pawn is one when the reply is about it', tv3.threats.length, 1);
}
{
  // mate in one threatened: the queen and bishop battery on the diagonal, Black to move
  const st = stateFromFEN('r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 0 1');
  const m = mv(st, 'f3f7');   // Qxf7# itself
  const after = makeMove(st, m);
  const tv = studyThreats(st, m, after, M(0));
  check('a delivered mate draws nothing', tv.threats.length + tv.vulns.length, 0);
  // and one move earlier, Qf3 threatens it
  const st0 = stateFromFEN('r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/8/PPPP1PPP/RNBQK1NR w KQkq - 0 1');
  const m0 = mv(st0, 'd1f3');
  const tv0 = studyThreats(st0, m0, makeMove(st0, m0), R(200, 'g8h6'));
  ok('the threat of mate is an arrow to the king', tv0.threats.some(t => t.kind === 'mate' && t.to === at('e8') && t.san === 'Qxf7#'), JSON.stringify(tv0));
  // and allowing one is an arrow the other way
  const stB = stateFromFEN('r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR b KQkq - 0 1');
  const mB = mv(stB, 'a7a6');
  const tvB = studyThreats(stB, mB, makeMove(stB, mB), M(1, 'f3f7'));
  ok('allowing mate in one is an arrow to our king', tvB.vulns.some(t => t.kind === 'mateIn1' && t.to === at('e8')), JSON.stringify(tvB));
  check('three arrows at most', Math.max(tvB.threats.length + tvB.vulns.length, 0) <= 3, true);
}

/* ============================================================
   5 · words: ten or fewer, and honest about material
   ============================================================ */
console.log('\nWords\n');
{
  // every reason on a whole made-up game stays under ten words
  const ucis = ['e2e4','e7e5','g1f3','b8c6','f1c4','f8c5','c2c3','g8f6','d2d4','e5d4','c3d4','c5b4','b1c3','f6e4','e1g1','b4c3','d4d5','c3f6','f1e1','e8g8','d5c6','e4c3'];
  const evals = [];
  for (let i = 0; i <= ucis.length; i++) evals.push(R((i % 3) * 40 - 30, ucis[i] || null, i + 1 < ucis.length ? ucis[i + 1] : null, -50, ucis.slice(i, i + 4)));
  const g = { uci: ucis, sans: [], white: 'A', black: 'B', mode: 'blind', result: '', human: W };
  const recs = studyBuild(g, evals);
  check('the whole game replays', recs.length, ucis.length);
  let long = [];
  for (const r of recs) for (const s of studyReasons(r, null)) if (wordCount(s) > 10) long.push(s);
  check('no reason runs past ten words', long.join(' | '), '');
  ok('every move has at least one reason', recs.every(r => studyReasons(r, null).length >= 1));
  ok('no reason is the vague kind', !recs.some(r => studyReasons(r, null).some(s => /^(Very strong move|Good positional move)/i.test(s))));
  // the explanation never claims a win the line does not deliver
  for (const r of recs){
    const ex = studyExplain(r, null);
    const txt = ex.map(s => s.p.join(' ')).join(' ');
    if (/comes out .* up/.test(txt)){
      const line = r.replyPv || r.pv;
      ok('a material claim at move ' + (r.ply + 1) + ' is backed by a line', !!line && lineGain(r.st, line, r.side) >= 90, txt);
    }
  }
  // the Education System's words, when it has ten of them
  const rec = recs[0];
  const edu = { concepts: [{ confidence: 'high', because: ['the pawn takes a central square'] }] };
  ok('a short concept reason is quoted, capitalised', studyReasons(rec, edu).indexOf('The pawn takes a central square') >= 0, studyReasons(rec, edu).join(' | '));
  const eduLong = { concepts: [{ confidence: 'high', because: ['this sentence is far too long to be one of the short reasons on the panel'] }] };
  ok('and a long one is left out', !studyReasons(rec, eduLong).some(s => /far too long/.test(s)));
  const eduLow = { concepts: [{ confidence: 'low', because: ['a doubtful idea'] }] };
  ok('and a low-confidence one is left out', !studyReasons(rec, eduLow).some(s => /doubtful/.test(s)));
}
{
  // a line cut off mid-exchange does not count the piece about to be recaptured
  const st = stateFromFEN('4k3/8/8/3r4/8/8/8/R3K3 w - - 0 1');
  const line = pvWalk(st, ['a1d1']);      // the rook attacks the rook; the line stops there
  ok('material at the end of an unresolved line is settled first', lineGain(st, line, W) === 0, lineGain(st, line, W));
  const take = pvWalk(st, ['a1a8']);      // nothing hanging at the end
  ok('and a line that wins nothing says so', lineGain(st, take, W) === 0);
}

/* ============================================================
   6 · the link and the cache: pack, encode, decode, rebuild
   ============================================================ */
console.log('\nThe link\n');
(async () => {
  const ucis = ['e2e4','e7e5','g1f3','b8c6'];
  const evals = [R(30,'e2e4','d2d4',25,['e2e4','e7e5']), R(-25,'e7e5','c7c5',-30,['e7e5','g1f3']),
                 M(3,'g1f3',['g1f3','b8c6']), R(20,'b8c6','g8f6',0,['b8c6','f1b5']), M(0)];
  const g = { uci: ucis, sans: [], white: 'Alex', black: 'Wraith 1300', mode: 'fog', result: 'Checkmate', human: B };
  const packed = studyPack(g, evals);
  check('the pack carries its version', packed.v, STUDY_VERSION);
  check('a mate is packed as m3', packed.e[2][0], 'm3');
  check('and mate 0 as m0', packed.e[4][0], 'm0');
  check('a score as its number', packed.e[0][0], 30);
  const back = studyUnpack(packed);
  check('the moves come back', back.game.uci.join(' '), ucis.join(' '));
  check('and the names', back.game.white + '/' + back.game.black, 'Alex/Wraith 1300');
  check('and the chair', back.game.human, B);
  check('a mate comes back as a mate', back.evals[2].mate, 3);
  check('with no centipawns beside it', back.evals[2].cp, null);
  check('a score comes back as a score', back.evals[0].cp, 30);
  check('the runner-up survives', back.evals[0].second.best, 'd2d4');
  check('with its score', back.evals[0].second.cp, 25);
  check('and the line', back.evals[0].pv.join(' '), 'e2e4 e7e5');
  check('the lines array is rebuilt for the concept card', back.evals[0].lines.length, 2);
  // the records rebuilt from the unpacked readings are the records built from the originals
  const strip = recs => recs.map(r => [r.san, r.verdict && r.verdict.key, r.winBefore, r.winAfter, r.delta,
                                       r.best && r.best.san, r.threats.length, r.vulns.length, studyReasons(r, null).join('|')]);
  check('the shared study is the same study', JSON.stringify(strip(studyBuild(back.game, back.evals))),
        JSON.stringify(strip(studyBuild(g, evals))));
  // the key is a function of the moves alone
  check('the key is stable', studyKey(ucis), studyKey(ucis.slice()));
  check('and different for a different game', studyKey(ucis) !== studyKey(ucis.slice(0, 3)), true);
  // base64url, both ways
  const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255, 62, 63]);
  const b64 = studyB64(bytes);
  ok('base64url uses no + / or =', !/[+/=]/.test(b64), b64);
  check('and round-trips', Array.from(studyUnB64(b64)).join(','), Array.from(bytes).join(','));
  // the whole link, deflated
  const enc = await studyEncode(packed);
  ok('the payload is deflated where the platform can', enc[0] === 'z', enc[0]);
  ok('and safe in a hash', /^[A-Za-z0-9_-]+$/.test(enc), enc.slice(0, 40));
  const dec = await studyDecode(enc);
  check('and decodes to the same pack', JSON.stringify(dec), JSON.stringify(packed));
  // the plain form, for a browser without CompressionStream
  const plain = 'j' + studyB64(new TextEncoder().encode(JSON.stringify(packed)));
  check('the plain form decodes too', JSON.stringify(await studyDecode(plain)), JSON.stringify(packed));
  let threw = false;
  try { await studyDecode('xabc'); } catch (e){ threw = true; }
  ok('an unknown form is refused', threw);
  // a long game is still a link
  const longU = [], longE = [];
  let s = newState();
  for (let i = 0; i < 120; i++){
    const all = legalMoves(s, s.turn);
    if (!all.length) break;
    const m = all[i % all.length];
    longU.push(uciOf(m));
    longE.push(R(i, uciOf(m), uciOf(all[(i + 1) % all.length]), i - 20, [uciOf(m), uciOf(all[(i + 1) % all.length])]));
    s = makeMove(s, m);
  }
  longE.push(R(0));
  const big = await studyEncode(studyPack({ uci: longU, sans: [], white: 'W', black: 'B', mode: 'sighted', result: '', human: W }, longE));
  ok('a ' + longU.length + '-ply game is ' + big.length + ' characters', big.length < 6000, big.length);

  /* ---- the page: the button, the panel, the route ---- */
  console.log('\nThe page\n');
  ok('the end button is the gauge', /id="endClose"[^>]*data-state="idle"/.test(SRC));
  ok('and carries its fill', /class="end-study-fill"/.test(SRC));
  ok('the fill is the CSS variable the button sets', /\.end-study-fill\{[^}]*width:var\(--p/.test(SRC.replace(/\n\s*/g, '')));
  ok('the button asks for analysis first and the board second', /STUDY\.state === 'ready'[\s\S]{0,80}enterReview\(\);\s*else studyStart\(\);/.test(SRC));
  ok('nothing opens the board when the pass finishes', !/enterReview/.test(fn('studyFinish')));
  ok('progress is positions answered over positions asked', /STUDY\.done \/ STUDY\.total/.test(fn('studyButton')));
  ok('and a step only counts once the engine has answered', /then\(res => \{[\s\S]*STUDY\.done = i \+ 1/.test(fn('studyStep')));
  ok('a failed pass is a retry, not a dead button', /'failed'/.test(fn('studyFail')) && /Press to try again/.test(fn('studyButton')));
  ok('the finished game primes the button', /studyPrime\(\);/.test(fn('finish')));
  ok('the pass is cancelled by a new game', /studyCancel\(\)/.test(fn('newGame')));
  ok('the review shades the move\'s squares through G.lastMove', /G\.lastMove = REV\.ply > 0 \? REV\.moves\[REV\.ply - 1\]/.test(fn('reviewGoto')));
  ok('the board draws no move arrow', !/a-played|a-best/.test(SRC));
  ok('only threat and weakness arrows', /a-threat/.test(fn('drawReviewOverlay')) && /a-vuln/.test(fn('drawReviewOverlay')));
  ok('MOVE and BEST are cells, not a sentence', /id="stMove"/.test(SRC) && /id="stBest"/.test(SRC));
  ok('and the old sentence is gone', !/best was/.test(SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')) || !/best was <b>/.test(SRC));
  ok('the panel has winning chances before and after', /id="stWinBefore"/.test(SRC) && /id="stWinAfter"/.test(SRC) && /id="stWinDelta"/.test(SRC));
  ok('an Explain button', /id="stExplain"/.test(SRC));
  ok('← and →', /id="stBack"[^>]*>←</.test(SRC) && /id="stFwd"[^>]*>→</.test(SRC));
  ok('and Share', /id="stShare"/.test(SRC));
  ok('the keyboard steps the review', /if \(REV\.on\)\{[\s\S]{0,200}arrowleft[\s\S]{0,200}arrowright/.test(SRC));
  ok('captured, draw, resign and the chips are hidden in the review',
     /#screen-game\.reviewing #gameChips[^{]*#gamePlay[^{]*\.board-bar[^{]*\{display:none !important;\}/.test(SRC.replace(/\n\s*/g, '')));
  ok('the share route is in the hash table', /case 'study':\s*return \{ s:'game', v:'study', data: tail \}/.test(SRC));
  ok('and a shared study is read-only: nothing on the page can extend it', /if \(ply === 0 \|\| !STUDY\.recs \|\| STUDY\.shared\) return;/.test(fn('reviewAnalyse')));
  ok('the study screen never loads its own engine for a shared game', !/engineStart/.test(fn('studyOpenShared')) && !/engineStart/.test(fn('enterReview')));
  ok('the cache is keyed off the moves', /STUDY_STORE \+ key/.test(fn('studyStore')) && /uci\.join/.test(fn('studyLoad')));
  ok('and returning to a game reads it before asking the engine', /studyLoad\(STUDY\.key, game\.uci\)/.test(fn('studyStart')) && /studyLoad/.test(fn('studyPrime')));

  console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
  process.exit(failed ? 1 : 0);
})();
