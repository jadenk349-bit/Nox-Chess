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
const G = require('./generate_puzzles.js');

let passed = 0, failed = 0;
function check(label, got, want){
  if (got === want){ passed++; console.log('  PASS  ' + label + '  ->  ' + got); }
  else { failed++; console.log('  FAIL  ' + label + '\n        got  ' + got + '\n        want ' + want); }
}

// what an engine answer looks like, cut down to what the decisions read
const lines = (...ls) => ({ lines: ls.map(l => Object.assign({ cp:null, mate:null, best:'a1a2', pv:[] }, l)) });

console.log('\nIs this position a puzzle?\n');

check('a wide gap between the two lines is',
      !!G.candidateFrom(lines({ cp:300, best:'e2e4' }, { cp:0 })), true);
check('and it names the move to find',
      G.candidateFrom(lines({ cp:300, best:'e2e4' }, { cp:0 })).best, 'e2e4');
check('a narrow one is not',
      G.candidateFrom(lines({ cp:120, best:'e2e4' }, { cp:0 })), null);
check('exactly the threshold is',
      !!G.candidateFrom(lines({ cp:150, best:'e2e4' }, { cp:0 })), true);
check('one legal move is not a puzzle',
      G.candidateFrom(lines({ cp:900, best:'e2e4' })), null);
check('a mate the runner-up does not have is',
      !!G.candidateFrom(lines({ mate:2, best:'e2e4' }, { cp:0 })), true);
check('and it says how long the mate is',
      G.candidateFrom(lines({ mate:2, best:'e2e4' }, { cp:0 })).mate, 2);
// two ways to mate in the same number is not "one strong move"
check('a mate both lines have is not',
      G.candidateFrom(lines({ mate:2, best:'e2e4' }, { mate:2 })), null);
check('unless the other way is much slower',
      !!G.candidateFrom(lines({ mate:2, best:'e2e4' }, { mate:6 })), true);
// finding the only good move hardly matters when everything wins
check('a position already won is not a puzzle',
      G.candidateFrom(lines({ cp:1400, best:'e2e4' }, { cp:900 })), null);
check('but a mate in a won position still is',
      !!G.candidateFrom(lines({ mate:1, best:'e2e4' }, { cp:900 })), true);
check('a missing score is not a puzzle',
      G.candidateFrom(lines({ best:'e2e4' }, { cp:0 })), null);

console.log('\nA faster mate outranks a slower one\n');

check('mate in one beats mate in five',
      G.lineScore({ mate:1 }) > G.lineScore({ mate:5 }), true);
check('being mated is worse than any evaluation',
      G.lineScore({ mate:-2 }) < G.lineScore({ cp:-2000 }), true);
check('a plain evaluation is itself', G.lineScore({ cp:-35 }), -35);

console.log('\nIs it worth showing?\n');

// Bxd5 after ...cxd5 is a recapture: forced, not found
const recapFen = 'rnbqkb1r/pp2pppp/5n2/3p4/3P4/2N2N2/PP2PPPP/R1BQKB1R w KQkq - 0 5';
const recapSt = P.stateFromFEN(recapFen);
const took = { to: 27, cap: { t:'P' } };                    // something captured on d5
const takeBack = P.legalMoves(recapSt, recapSt.turn).find(m => P.uciOf(m) === 'c3d5');
check('a recapture on the same square is not', G.worthShowing(recapSt, takeBack, took, ['fork']), false);
check('the same move after a quiet move is',  G.worthShowing(recapSt, takeBack, { to: 40 }, ['fork']), true);
check('a move with a motif is',               G.worthShowing(recapSt, takeBack, null, ['pin']), true);

// a knight fork that captures nothing, checks nothing and forks nothing
const quietFen = '4k3/8/8/8/8/8/8/4K1N1 w - - 0 1';
const quietSt = P.stateFromFEN(quietFen);
const shuffle = P.legalMoves(quietSt, quietSt.turn).find(m => P.uciOf(m) === 'g1f3');
check('a quiet move with nothing to say is not', G.worthShowing(quietSt, shuffle, null, []), false);

// but taking a free rook is, motif or no motif
const freeFen = 'r3k3/8/8/3N4/8/8/8/4K3 w - - 0 1';
const freeSt = P.stateFromFEN(freeFen);
const grab = P.legalMoves(freeSt, freeSt.turn).find(m => P.uciOf(m) === 'd5c7');
check('a check is', G.worthShowing(freeSt, grab, null, []), true);

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

check('move 1 is an opening puzzle',    G.bucketFor(1), 'opening');
check('move 12 still is',               G.bucketFor(12), 'opening');
check('move 13 is a middlegame one',    G.bucketFor(13), 'middlegame');
check('move 30 still is',               G.bucketFor(30), 'middlegame');
check('move 31 is an endgame one',      G.bucketFor(31), 'endgame');

console.log('\nNames that do not move\n');

const id1 = G.puzzleId('opening', freeFen, ['d5c7']);
check('an id is stable for the same puzzle', G.puzzleId('opening', freeFen, ['d5c7']), id1);
check('and different for a different solution',
      G.puzzleId('opening', freeFen, ['d5c7','e8d8','c7a8']) !== id1, true);
check('it carries its track', id1.slice(0, 3), 'op-');

console.log('\nThemes come from the page, not from here\n');

// the same function the coach card uses, run over the solution
const themes = G.themesFor(freeFen, ['d5c7', 'e8d8', 'c7a8']);
check('a knight check on two pieces is a fork', themes.indexOf('fork') >= 0, true);
check('a three-ply solution is marked as one', themes.indexOf('longGame') >= 0, true);
check('a quiet position has no themes',
      G.themesFor('4k3/8/8/8/8/8/8/4K1N1 w - - 0 1', ['g1f3']).length, 0);

console.log('\nThe same seed plays the same games\n');

const a = G.mulberry32(42), b = G.mulberry32(42), c = G.mulberry32(43);
const rollA = [a(), a(), a()], rollB = [b(), b(), b()], rollC = [c(), c(), c()];
check('two runs of one seed agree', rollA.join() === rollB.join(), true);
check('a different seed does not',  rollA.join() === rollC.join(), false);
check('and it stays inside zero and one',
      rollA.every(n => n >= 0 && n < 1), true);

console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
process.exit(failed ? 1 : 0);
