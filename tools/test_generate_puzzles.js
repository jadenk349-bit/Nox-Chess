/* The generator's own judgement, tested without an engine.
 *
 * generate_puzzles.js is mostly decisions: is this position a puzzle, is it
 * worth showing, how hard is it, which hundred make the ladder. Those are pure
 * functions of what the engine said, so they can be checked against canned
 * answers — which is the only way to check them at all, since Stockfish seeds
 * its Skill Level randomness from the clock and a real run never repeats
 * exactly.
 *
 *   node tools/test_generate_puzzles.js
 */

'use strict';

const P = require('./page_chess.js');
const R = require('./puzzle_rules.js');
const G = require('./generate_puzzles.js');

let passed = 0, failed = 0;
function check(label, got, want){
  if (got === want){ passed++; console.log('  PASS  ' + label + '  ->  ' + got); }
  else { failed++; console.log('  FAIL  ' + label + '\n        got  ' + got + '\n        want ' + want); }
}

// what an engine answer looks like, cut down to what the decisions read
const lines = (...ls) => ({ lines: ls.map(l => Object.assign({ cp:null, mate:null, best:'a1a2', pv:[] }, l)) });

console.log('\nDoes the sweep nominate it?\n');

// sharpEnough() only ever nominates: it is allowed to be generous and must not
// be strict, because what it throws away nothing downstream ever sees
check('a wide gap between the two lines is',
      !!G.sharpEnough(lines({ cp:300, best:'e2e4' }, { cp:0 })), true);
check('and it names the move to look at',
      G.sharpEnough(lines({ cp:300, best:'e2e4' }, { cp:0 })).best, 'e2e4');
check('a narrow one is not',
      G.sharpEnough(lines({ cp:100, best:'e2e4' }, { cp:0 })), null);
check('the sweep is deliberately looser than the standard',
      !!G.sharpEnough(lines({ cp:130, best:'e2e4' }, { cp:0 })), true);
check('one legal move is not a puzzle',
      G.sharpEnough(lines({ cp:900, best:'e2e4' })), null);
check('a mate the runner-up does not have is',
      !!G.sharpEnough(lines({ mate:2, best:'e2e4' }, { cp:0 })), true);
check('a mate both lines have is not',
      G.sharpEnough(lines({ mate:2, best:'e2e4' }, { mate:6 })), null);
check('a missing score is not',
      G.sharpEnough(lines({ best:'e2e4' }, { cp:0 })), null);

console.log('\nA faster mate outranks a slower one\n');

check('mate in one beats mate in five',
      R.lineScore({ mate:1 }) > R.lineScore({ mate:5 }), true);
check('being mated is worse than any evaluation',
      R.lineScore({ mate:-2 }) < R.lineScore({ cp:-2000 }), true);
check('a plain evaluation is itself', R.lineScore({ cp:-35 }), -35);
check('a score is flipped when the opponent is at the root',
      R.asSolver({ cp:120 }, false), -120);
check('and a mate flips with it',
      R.asSolver({ mate:3 }, false) < -R.MATE_SCORE + 200, true);

console.log('\nIs it a turning point?\n');

// Type A: level, they blunder, one move wins
check('level, they blunder, one move wins',
      R.judge({ before: 10, best: 620, alt: 40 }).kind, 'punish');
// Type B: losing, they blunder, one move holds
check('losing, they blunder, one move holds',
      R.judge({ before: -700, best: -20, alt: -800 }).kind, 'save');

check('two moves that are just as good is not a puzzle',
      R.judge({ before: 10, best: 620, alt: 500 }).why, 'ambiguous');
check('nor is a sharp position nobody went wrong in',
      R.judge({ before: 500, best: 620, alt: 100 }).why, 'no mistake');
check('nor one that was already winning',
      R.judge({ before: 900, best: 1600, alt: 300 }).why, 'already better');
check('nor one where the alternative also wins',
      R.judge({ before: 100, best: 900, alt: 600 }).why, 'wins anyway');
check('nor one where the best move wins nothing',
      R.judge({ before: -100, best: 200, alt: -100 }).why, 'no advantage won');
// the single rule that removes most of the old middlegame track
check('the best move in a lost position is not a save',
      R.judge({ before: -3000, best: -2500, alt: -3200 }).why, 'still lost');
check('and a save needs something to be saved from',
      R.judge({ before: -400, best: 100, alt: -150 }).why, 'nothing to save');
check('two ways to force mate is two answers',
      R.judge({ before: 0, best: R.MATE_SCORE - 2, alt: R.MATE_SCORE - 9 }).why, 'two mates');
check('a mate the runner-up does not have is one answer',
      R.judge({ before: 0, best: R.MATE_SCORE - 2, alt: 100 }).ok, true);
check('a record that cannot say what came before is judged on the rest',
      R.judge({ best: 620, alt: 40 }).ok, true);
check('...and its mistake is unknown rather than zero',
      R.judge({ best: 620, alt: 40 }).mistake, null);

console.log('\nCan the second search be skipped?\n');

/* mayPass() must never turn away something judge() would have taken: it runs
   before the expensive half of mining, and what it drops nothing else sees. */
check('a punishment survives the short cut', R.mayPass(620, 40), null);
check('so does a rescue',                    R.mayPass(-20, -800), null);
check('two equal moves do not',              R.mayPass(620, 500), 'ambiguous');
check('nor does a position that wins anyway', R.mayPass(900, 600), 'wins anyway');
check('nor one whose best move is still lost', R.mayPass(-400, -900), 'no advantage won');
check('nor one that neither wins nor saves',  R.mayPass(300, 0), 'neither');

// the property that matters: whatever mayPass() lets past, some `before` makes
// a puzzle of, and whatever it stops, no `before` does
var lets = 0, stops = 0, wrong = 0;
for (var a1 = -1200; a1 <= 1200; a1 += 60)
  for (var a2 = -1200; a2 <= 1200; a2 += 60){
    var open = R.mayPass(a1, a2) === null, any = false;
    for (var v = -1500; v <= 1200; v += 30)
      if (R.judge({ before: v, best: a1, alt: a2 }).ok){ any = true; break; }
    if (open) lets++; else stops++;
    if (any && !open) wrong++;         // stopped something judge() would take
  }
check('the short cut never drops a puzzle judge() would keep', wrong, 0);
check('and it does stop most of them', stops > lets, true);

console.log('\nWould a human have to think about it?\n');

/* The gate the evaluation numbers cannot supply. Built on a real position: a
   white rook on d1, a black rook on d5 that Black has just moved there. */
const hangFen2 = '4k3/8/8/3r4/8/8/8/3RK3 w - - 0 1';
const prevFen2 = '4k3/8/8/8/3r4/8/8/3RK3 b - - 0 1';   // ...Rd4-d5??
const rec = (over) => Object.assign({
  fen: hangFen2, prev: { fen: prevFen2, move: 'd4d5' },
  moves: ['d1d5'], themes: ['hangingPiece']
}, over || {});

check('taking the piece they just moved there is not a puzzle',
      R.obvious(rec()), 'takes the piece that just moved');
check('nor is it when the line runs on and the material is already in hand',
      R.obvious(rec({ moves: ['d1d5','e8e7','d5d7'] })), 'takes the piece that just moved');
check('but a sacrifice is worth finding whatever it takes',
      R.obvious(rec({ moves: ['d1d5','e8e7','d5d7'], themes: ['sacrifice'] })), null);
check('and so is a discovery',
      R.obvious(rec({ moves: ['d1d5','e8e7','d5d7'], themes: ['discoveredAttack'] })), null);
check('a rescue is not "an idea" — every save carries that tag',
      R.obvious(rec({ themes: ['hangingPiece','defensiveResource'] })),
      'takes the piece that just moved');

// length: one move is not a calculation unless the move is a quiet one
const quietRec = {
  fen: '4k3/8/8/8/8/8/8/R3K1N1 w - - 0 1', moves: ['g1f3'], themes: ['fork']
};
check('a one-move quiet answer is still worth finding', R.obvious(quietRec), null);
check('a one-move capture is not',
      R.obvious({ fen: hangFen2, moves: ['d1d5'], themes: ['fork'] }), 'free piece');

console.log('\nIs there still something to find further down the line?\n');

check('a clear best move keeps the line going', R.stillSharp(400, 100), true);
check('two equal moves end it',                 R.stillSharp(400, 300), false);
check('and so does a second way to mate',
      R.stillSharp(R.MATE_SCORE - 2, R.MATE_SCORE - 8), false);

console.log('\nIs it worth showing?\n');

// Bxd5 after ...cxd5 is a recapture: forced, not found
const recapFen = 'rnbqkb1r/pp2pppp/5n2/3p4/3P4/2N2N2/PP2PPPP/R1BQKB1R w KQkq - 0 5';
const recapSt = P.stateFromFEN(recapFen);
const took = { to: 27, cap: { t:'P' } };                    // something captured on d5
const takeBack = P.legalMoves(recapSt, recapSt.turn).find(m => P.uciOf(m) === 'c3d5');
check('a recapture on the same square is not',
      R.trivial(recapSt, takeBack, took, ['fork'], 1), 'recapture');
check('the same move after a quiet move is',
      R.trivial(recapSt, takeBack, { to: 40 }, ['fork'], 1), null);
check('a move with a motif is',
      R.trivial(recapSt, takeBack, null, ['pin'], 1), null);

// a knight shuffle that captures nothing, checks nothing and forks nothing
const quietFen = '4k3/8/8/8/8/8/8/4K1N1 w - - 0 1';
const quietSt = P.stateFromFEN(quietFen);
const shuffle = P.legalMoves(quietSt, quietSt.turn).find(m => P.uciOf(m) === 'g1f3');
check('a quiet move with nothing to say is not',
      R.trivial(quietSt, shuffle, null, [], 1), 'nothing to say');

// taking a free rook with check is, motif or no motif
const freeFen = 'r3k3/8/8/3N4/8/8/8/4K3 w - - 0 1';
const freeSt = P.stateFromFEN(freeFen);
const grab = P.legalMoves(freeSt, freeSt.turn).find(m => P.uciOf(m) === 'd5c7');
check('a check is', R.trivial(freeSt, grab, null, [], 1), null);

// ...but simply lifting an undefended piece off the board, in one move, with
// nothing to say about it, is the puzzle rule 8 refuses
const hangFen = '4k3/8/8/3r4/8/8/8/3RK3 w - - 0 1';
const hangSt = P.stateFromFEN(hangFen);
const take = P.legalMoves(hangSt, hangSt.turn).find(m => P.uciOf(m) === 'd1d5');
check('and taking a free piece on its own is not',
      R.trivial(hangSt, take, null, [], 1), 'free piece');
check('but the same capture inside a longer line is',
      R.trivial(hangSt, take, null, [], 3), null);

console.log('\nWhich hundred, and in what order\n');

const easy = { fen: freeFen, moves:['d5c7'], seedRating: 800,  settleDepth: 2 };
const hard = { fen: freeFen, moves:['d5c7'], seedRating: 2000, settleDepth: 12 };
check('a stronger solver being needed makes it harder',
      G.difficulty(hard) > G.difficulty(easy), true);
const deep = { fen: freeFen, moves:['d5c7'], seedRating: 800, settleDepth: 14 };
check('so does a search that takes longer to settle',
      G.difficulty(deep) > G.difficulty(easy), true);
const long = { fen: freeFen, moves:['d5c7','e8d8','c7a8'], seedRating: 800, settleDepth: 2 };
check('and so does a longer line', G.difficulty(long) > G.difficulty(easy), true);

// the ladder spans the pool rather than skimming one end of it
const pool = [];
for (let i = 0; i < 250; i++) pool.push({ id: 'p' + String(i).padStart(3, '0'), rank: i * 7 });
const ladder = G.ladder(pool, 100);
check('a ladder is exactly the size asked for', ladder.length, 100);
check('it starts at the bottom of the pool', ladder[0].rank, pool[0].rank);
check('and ends at the top',                  ladder[99].rank, pool[249].rank);
check('never going backwards',
      ladder.every((p, i) => i === 0 || p.rank >= ladder[i-1].rank), true);
check('and never repeating one',
      new Set(ladder.map(p => p.id)).size, 100);
check('a pool too small for a ladder is kept whole',
      G.ladder(pool.slice(0, 40), 100).length, 40);

console.log('\nWhere in the game it came from\n');

// by what is on the board, not by the move number
const at = f => G.bucketFor(P.stateFromFEN(f));
check('everything still at home is an opening',
      at('rnbqkb1r/pppp1ppp/5n2/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3'), 'opening');
check('developed and fully manned is a middlegame',
      at('r2q1rk1/pp2bppp/2n1bn2/2pp4/3P4/2N1PN2/PPQ1BPPP/R1B2RK1 w - - 4 11'), 'middlegame');
check('an early queen trade with nothing developed is still an opening',
      at('rnb1kb1r/pppp1ppp/5n2/8/8/5N2/PPPP1PPP/RNB1KB1R w KQkq - 0 9'), 'opening');
check('queens off but the pieces out is a middlegame',
      at('r4rk1/pp2bppp/2n1bn2/2pp4/3P4/2N1PN2/PP2BPPP/R1B2RK1 w - - 4 13'), 'middlegame');
check('rooks and pawns is an endgame however early',
      at('4k3/pppr1ppp/8/8/8/8/PPPR1PPP/4K3 w - - 0 9'), 'endgame');
check('and a long game with everything still on is not one',
      at('r2q1rk1/pp2bppp/2n1bn2/2pp4/3P4/2N1PN2/PPQ1BPPP/R1B2RK1 w - - 4 41'), 'middlegame');
check('queens alone is an endgame',
      at('4k3/pppp1ppp/8/8/8/8/PPPP1PPP/3QK3 w - - 0 20'), 'endgame');

console.log('\nNames that do not move\n');

const id1 = G.puzzleId('opening', freeFen, ['d5c7']);
check('an id is stable for the same puzzle', G.puzzleId('opening', freeFen, ['d5c7']), id1);
check('and different for a different solution',
      G.puzzleId('opening', freeFen, ['d5c7','e8d8','c7a8']) !== id1, true);
check('it carries its track', id1.slice(0, 3), 'op-');

console.log('\nThemes come from the page, not from here\n');

// the nine findMotifs() names, run over the solution by the same function the
// coach card uses; the rest are what a whole puzzle carries and a move does not
const themes = G.themesFor({ fen: freeFen, moves: ['d5c7', 'e8d8', 'c7a8'] });
check('a knight check on two pieces is a fork', themes.indexOf('fork') >= 0, true);
check('a three-ply solution is marked as one', themes.indexOf('longGame') >= 0, true);
check('a rescue says so',
      G.themesFor({ fen: freeFen, moves: ['d5c7'], kind: 'save' })
        .indexOf('defensiveResource') >= 0, true);
check('a forced mate that the line does not reach is a threat',
      G.themesFor({ fen: freeFen, moves: ['d5c7'],
                    eval: { end: R.MATE_SCORE - 4 } }).indexOf('mateThreat') >= 0, true);
check('a quiet shuffle with nothing else to it is a positional one',
      G.themesFor({ fen: '4k3/8/8/8/8/8/8/4K1N1 w - - 0 1', moves: ['g1f3'] })
        .join(), 'positionalTactic');

console.log('\nThe same seed plays the same games\n');

const a = G.mulberry32(42), b = G.mulberry32(42), c = G.mulberry32(43);
const rollA = [a(), a(), a()], rollB = [b(), b(), b()], rollC = [c(), c(), c()];
check('two runs of one seed agree', rollA.join() === rollB.join(), true);
check('a different seed does not',  rollA.join() === rollC.join(), false);
check('and it stays inside zero and one',
      rollA.every(n => n >= 0 && n < 1), true);

console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
process.exit(failed ? 1 : 0);
