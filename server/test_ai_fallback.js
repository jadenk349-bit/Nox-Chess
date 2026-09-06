/* Tests for what the ranked fallback opponent decides — the phase it thinks
 * the game is in, the chance it reads off a score, and which of the engine's
 * candidate moves it ends up playing.
 *
 * Like the other JS suites, the code under test is read out of blind-chess.html
 * by name rather than copied here, so this cannot quietly drift from what
 * ships. Renaming or reformatting anything in DECLS or FNS breaks it, which is
 * the point: none of this has a screen to look at, and a bot that has stopped
 * steering plays exactly as convincingly as one that has not.
 *
 *   node server/test_ai_fallback.js
 */

var PAGE = 'blind-chess.html';

function slurp(path){
  if (typeof readFile === 'function') return readFile(path);          // jsc
  return require('fs').readFileSync(path, 'utf8');                    // node
}
function say(s){ (typeof print === 'function' ? print : console.log)(s); }

var SRC = slurp(PAGE);

function grab(re, what){
  var m = SRC.match(re);
  if (!m){
    say('FAIL  could not find ' + what + ' in ' + PAGE);
    throw new Error(what + ' not found');
  }
  return m[0];
}
function fn(name){
  return grab(new RegExp('\\nfunction ' + name + '\\s*\\([\\s\\S]*?\\n\\}'), 'function ' + name + '()');
}
function decl(name){
  var block = SRC.match(new RegExp('\\n(?:const|let) ' + name + '\\s*=\\s*[\\{\\[][\\s\\S]*?\\n[\\}\\]];'));
  if (block) return block[0];
  return grab(new RegExp('\\n(?:const|let) ' + name + '\\b[^\\n]*?;'), name);
}

var DECLS = ['AI_POOL', 'AI_BAND', 'AI_SLACK'];
var FNS   = ['aiPhase', 'winChance', 'lineScore', 'aiSearch', 'aiChoose'];

var BUNDLE = [];
DECLS.forEach(function(n){ BUNDLE.push(decl(n)); });
FNS.forEach(function(n){ BUNDLE.push(fn(n)); });

/* The page's own state, which aiPhase reads and nothing else here does. A
   stub rather than the real one: what is being tested is the reading. */
var G = { sans: [], st: { b: [] }, clock: { w: 600000, b: 600000 }, human: 'w' };

eval(BUNDLE.join('\n').replace(/(^|\n)(?:const|let) /g, '$1var '));

var passed = 0, failed = 0;
function check(label, got, want){
  if (got === want){ passed++; say('  PASS  ' + label + '  ->  ' + got); }
  else { failed++; say('  FAIL  ' + label + '\n        got  ' + got + '\n        want ' + want); }
}
function near(label, got, want, tol){
  if (Math.abs(got - want) <= tol){ passed++; say('  PASS  ' + label + '  ->  ' + got.toFixed(4)); }
  else { failed++; say('  FAIL  ' + label + '\n        got  ' + got + '\n        want ' + want + ' +-' + tol); }
}

/* ---- scaffolding ---- */

// a board carrying `officers` pieces that are neither kings nor pawns
function boardWith(officers){
  var b = [];
  for (var i = 0; i < 64; i++) b.push(null);
  b[4]  = { c:'b', t:'K' };
  b[60] = { c:'w', t:'K' };
  for (var k = 0; k < officers; k++) b[16 + k] = { c: k % 2 ? 'b' : 'w', t:'R' };
  return b;
}
function phaseAt(ply, officers){
  G.sans = new Array(ply);
  G.st = { b: boardWith(officers) };
  return aiPhase();
}
// a candidate as aiPick() builds one: the move, what the position is worth
// after it, and the chance of winning from there
function cand(name, cp){
  return { m: name, score: cp, win: winChance(cp, null) };
}
// a rigged coin, so a choice among equals is a fact rather than a sometimes
function fixed(v){ return function(){ return v; }; }

say('\nWhich part of the game it thinks it is in\n');

check('a fresh board is the opening',      phaseAt(4,  14), 'early');
check('and still is at move eleven',       phaseAt(22, 12), 'early');
check('twenty-four plies in is the middle', phaseAt(24, 12), 'middle');
check('sixty plies in is the endgame',      phaseAt(60, 10), 'late');
// the men on the board overrule the clock: an early massacre is an endgame
check('a stripped board is late whatever the ply', phaseAt(10, 3), 'late');
check('a half-traded board is the middlegame',     phaseAt(10, 8), 'middle');
check('one officer each is still late',            phaseAt(2,  2), 'late');

say('\nWhat a score is worth as a chance of winning\n');

check('a level position is even money', winChance(0, null), 0.5);
near('a pawn up is about 59%',   winChance(100, null),  0.5910, 0.001);
near('a pawn down is about 41%', winChance(-100, null), 0.4090, 0.001);
check('mate for us is certainty',   winChance(null, 3), 1);
check('mate against us is nothing', winChance(null, -3), 0);
// a missing score is not a losing one — it is a shrug, and must read as one
check('a score that never arrived is even money', winChance(null, null), 0.5);
check('the curve rises', winChance(300, null) > winChance(100, null), true);

say('\nMate scores, made comparable with the rest\n');

check('mate in one beats mate in three', lineScore({mate:1}) > lineScore({mate:3}), true);
check('being mated in one is worse than in three',
      lineScore({mate:-1}) < lineScore({mate:-3}), true);
check('any mate beats any material',    lineScore({mate:9}) > lineScore({cp:2000}), true);
check('being mated is worse than any loss',
      lineScore({mate:-9}) < lineScore({cp:-2000}), true);
check('a plain score is itself',        lineScore({cp:-45, mate:null}), -45);

say('\nHow hard it thinks\n');

var early = aiSearch(1221, 'early', 600000);
var late  = aiSearch(1221, 'late',  600000);
check('a higher rating thinks longer',
      aiSearch(2400, 'early', 600000).movetime > aiSearch(400, 'early', 600000).movetime, true);
check('and plays at a higher skill',
      aiSearch(2400, 'early', 600000).skill > aiSearch(400, 'early', 600000).skill, true);
check('it eases off as the game goes on',   late.movetime < early.movetime, true);
check('on both dials at once',              late.skill    < early.skill, true);
check('skill never goes under zero',        aiSearch(100, 'late', 600000).skill >= 0, true);
check('nor over twenty',                    aiSearch(4000, 'early', 600000).skill <= 20, true);
check('it asks for several candidates',     early.multipv, AI_POOL);
check('and never reuses an answer',         early.nocache, true);
// the fallback opponent's clock is the game's clock, and it can flag
check('short of time it thinks less',
      aiSearch(2400, 'early', 15000).movetime < aiSearch(2400, 'early', 600000).movetime, true);
check('but always thinks a little',         aiSearch(2400, 'early', 1).movetime >= 80, true);
check('and never for most of a second',     aiSearch(4000, 'early', 600000).movetime <= 700, true);

say('\nChoosing between the engine\'s candidates\n');

var BAND  = AI_BAND.early;    // 40% to 55%
var SLACK = AI_SLACK.early;

// dead level, a pawn up, and two pawns up: the band wants the level one
var evenish = [cand('best', 200), cand('mid', 60), cand('level', 0)];
check('it steers down into the band',
      aiChoose(evenish, BAND, 400, fixed(0)).m, 'level');

// everything on offer is losing, so the band is out of reach below — and the
// answer to that is the best move on the board, never a worse one
var losing = [cand('best', -300), cand('worse', -420), cand('worst', -900)];
check('losing, it plays the best it has',
      aiChoose(losing, BAND, 900, fixed(0)).m, 'best');
check('and does not pick the softest',
      aiChoose(losing, BAND, 900, fixed(0.99)).m, 'best');

// winning far too easily, but the only quieter moves are blunders: the slack
// is what stops the band buying a percentage with a hanging queen
var trap = [cand('best', 500), cand('gift', -600)];
check('it will not blunder to give ground',
      aiChoose(trap, BAND, SLACK, fixed(0.99)).m, 'best');
check('a candidate outside the slack is never played',
      aiChoose(trap, BAND, SLACK, fixed(0)).m, 'best');

// Two moves both inside the band: either is fine, and which one is a coin.
// The third is a piece down, so the slack has already thrown it out — what is
// varied is which reasonable move gets played, never whether to play one.
var pair = [cand('a', 0), cand('b', -20), cand('out', -500)];
check('inside the band it varies',   aiChoose(pair, BAND, SLACK, fixed(0)).m,    'a');
check('...and can take the other',   aiChoose(pair, BAND, SLACK, fixed(0.99)).m, 'b');
// and a position it is simply winning is a position it goes on winning: no
// move within the slack reaches the band, so the best one is played
var winning = [cand('best', 900), cand('slower', 840)];
check('a won game is not handed back',
      aiChoose(winning, BAND, SLACK, fixed(0)).m === 'best' ||
      aiChoose(winning, BAND, SLACK, fixed(0)).m === 'slower', true);
check('and never by a move outside the slack',
      aiChoose([cand('best', 900), cand('gift', -100)], BAND, SLACK, fixed(0.99)).m, 'best');

// mate is available and the band would rather it were not: taking it is still
// the best move, and giving up a mate to stay level is not on the table
var mateAvailable = [
  { m:'mate', score: lineScore({mate:2}), win: winChance(null, 2) },
  { m:'quiet', score: 10, win: winChance(10, null) }
];
check('a mate in hand is not thrown away',
      aiChoose(mateAvailable, BAND, SLACK, fixed(0.99)).m, 'mate');

check('nothing on offer is nothing chosen', aiChoose([], BAND, SLACK, fixed(0)), null);
check('one candidate is that candidate',
      aiChoose([cand('only', 999)], BAND, SLACK, fixed(0)).m, 'only');

say('\nThe bands themselves\n');

check('the opening is the closest fight',
      AI_BAND.early[0] > AI_BAND.middle[0] && AI_BAND.early[1] > AI_BAND.middle[1], true);
check('and the middlegame closer than the ending',
      AI_BAND.middle[0] > AI_BAND.late[0] && AI_BAND.middle[1] > AI_BAND.late[1], true);
check('the brief\'s opening band, exactly',  AI_BAND.early.join('-'),  '0.4-0.55');
check('the brief\'s middlegame band, exactly', AI_BAND.middle.join('-'), '0.2-0.4');
check('every band is a band',
      [AI_BAND.early, AI_BAND.middle, AI_BAND.late]
        .every(function(b){ return b[0] < b[1] && b[0] >= 0 && b[1] <= 1; }), true);
// more rope later, because a slack ending is where a game is really given away
check('the slack widens as the game goes on',
      AI_SLACK.early < AI_SLACK.middle && AI_SLACK.middle < AI_SLACK.late, true);
check('but never past a rook',  AI_SLACK.late < 500, true);

say('\nWhat the page is allowed to decide for itself\n');

// The server says whether the opponent is a bot. If the page could say it too,
// a client could claim it after a loss — so there is exactly one assignment of
// NET.ai that is not a clearing one, and it reads the server's message.
var sets = SRC.match(/NET\.ai\s*=\s*/g) || [];
var fromServer = SRC.match(/NET\.ai\s*=\s*\(msg\.ai/g) || [];
var cleared = SRC.match(/NET\.ai\s*=\s*null/g) || [];
check('NET.ai is only ever set from the server\'s own message',
      sets.length, fromServer.length + cleared.length);
check('and it is set from one, once', fromServer.length, 1);
// against the fallback there is nobody across the socket, so nothing is sent
check('a move against the bot is not relayed to anybody',
      /ONLINE\(\) && !AI_MATCH\(\) && !fromNet/.test(SRC), true);
check('and the bot takes its turn when it is its turn',
      /AI_MATCH\(\) && G\.st\.turn !== G\.human\) scheduleAI\(\)/.test(SRC), true);
// the rating on the tag is the server's number, not one worked out here
check('the page never computes the bot\'s rating',
      /\/\s*100\s*\+\s*9/.test(SRC), false);

say('\n' + passed + ' passed, ' + failed + ' failed\n');

if (typeof process !== 'undefined' && process.exit) process.exit(failed ? 1 : 0);
