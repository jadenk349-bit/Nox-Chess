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

var DECLS = ['AI_POOL', 'AI_BAND', 'AI_SLACK', 'AI_STYLES', 'AI_STYLE_NAMES',
             'AI_WALK_MAX', 'AI_WALK_PER_PLY', 'AI_TOOK_CP', 'AI_FORM_CP', 'AI'];
var FNS   = ['aiPhase', 'winChance', 'lineScore', 'aiSearch', 'aiChoose',
             'aiReset', 'aiForm', 'aiNoteHuman', 'aiBandFor', 'aiSlackFor', 'aiPoolFor', 'aiNoMate'];

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

/* Mate: THE RULE HERE IS THE REVERSE OF WHAT IT WAS.
 *
 * This block used to read "a mate in hand is not thrown away", on the
 * reasoning that giving up a mate to stay level was not on the table. It is
 * now, and deliberately: everything else in this file exists so that the
 * player wins a game worth winning, and a mate delivered by the opponent ends
 * that game the other way.
 *
 * It also could not be left to the band. `lineScore` puts mate at a hundred
 * thousand, so the slack filter throws away every ordinary move as "too far
 * from the best" and the mating move is the only one still standing — the
 * band never gets a say. The refusal has to come before the slack. */
var mateAvailable = [
  { m:'mate', score: lineScore({mate:2}), win: winChance(null, 2) },
  { m:'quiet', score: 10, win: winChance(10, null) }
];
check('a mate on the board is not played',
      aiChoose(mateAvailable, BAND, SLACK, fixed(0.99)).m, 'quiet');
check('...and not at any point of the game',
      [AI_BAND.early, AI_BAND.middle, AI_BAND.late].every(function(b){
        return aiChoose(mateAvailable, b, AI_SLACK.late, fixed(0)).m === 'quiet';
      }), true);
// ...but refusing to move is not a chess move. A position where everything
// mates is a position the player has already lost.
check('unless every move mates',
      aiChoose([{ m:'only', score: lineScore({mate:1}), win: 1 }], BAND, SLACK, fixed(0)).m,
      'only');
check('and a longer mate is no better',
      aiChoose([{ m:'m1', score: lineScore({mate:1}), win: 1 },
                { m:'m5', score: lineScore({mate:5}), win: 1 },
                { m:'quiet', score: -20, win: winChance(-20, null) }],
               BAND, SLACK, fixed(0.99)).m, 'quiet');
// The other direction is untouched: being mated is still to be avoided, and
// the best defence is still the move it plays.
check('it still defends against being mated',
      aiChoose([{ m:'mated', score: lineScore({mate:-2}), win: 0 },
                { m:'holds', score: -700, win: winChance(-700, null) }],
               BAND, 900, fixed(0.99)).m, 'holds');

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

say('\nThe match controller\n');

/* A fixed coin, so a test about what the controller decides is not a test
   about which random number it drew. */
function seeded(list){ var i = 0; return function(){ return list[i++ % list.length]; }; }

// ---- a new game is a new opponent ----
aiReset(fixed(0));
var first = { style: AI.style, handover: AI.handover };
aiReset(fixed(0.99));
check('a different game draws a different style', AI.style !== first.style, true);
check('...and a different handover ply', AI.handover !== first.handover, true);
var plies = {};
for (var i = 0; i < 200; i++){ aiReset(seeded([i / 200])); plies[AI.handover] = 1; }
check('the handover lands all over the twenties and thirties',
      Object.keys(plies).length >= 15, true);
check('but never in the opening', Object.keys(plies).every(function(p){ return +p >= 18; }), true);
check('every style is a real one',
      AI_STYLE_NAMES.every(function(n){ return !!AI_STYLES[n]; }), true);

// ---- it forgets the last game ----
aiReset(fixed(0));
AI.loss = [400, 400]; AI.opened = 9; AI.took = 3; AI.watch = 2; AI.cool = 5; AI.last = 123;
aiReset(fixed(0.5));
check('the last player\'s form does not carry over', AI.loss.length, 0);
check('nor the chances already offered',  AI.opened + AI.took + AI.watch + AI.cool, 0);
check('nor what it last thought the board was worth', AI.last, null);
check('nor how far ahead it thought it was', AI.seen, null);

// ---- reading the player ----
aiReset(fixed(0));
check('nothing seen is nobody judged', aiForm(), 0);
aiReset(fixed(0)); AI.last = 0;
aiNoteHuman(0);                       // gave nothing away
check('a flawless move reads as flawless', aiForm(), 1);
aiReset(fixed(0)); AI.last = 0;
aiNoteHuman(AI_FORM_CP);              // dropped a pawn's worth
check('an average move reads as average', aiForm(), 0);
aiReset(fixed(0)); AI.last = 0;
aiNoteHuman(400);
check('falling apart reads as falling apart', aiForm(), -1);
aiReset(fixed(0)); AI.last = 0;
for (var j = 0; j < 30; j++){ aiNoteHuman(50); AI.last = 50 * (j + 1); }
check('it only remembers the recent past', AI.loss.length <= 12, true);

// ---- did they take the chance ----
aiReset(fixed(0));
AI.last = 0; AI.opened = 1; AI.watch = 4;
aiNoteHuman(-120);                    // the player gained: they found it
check('a chance taken is counted', AI.took, 1);
check('...and the watch stops', AI.watch, 0);
check('...and nothing is owed', AI.cool, 0);

aiReset(fixed(0));
AI.last = 0; AI.opened = 1; AI.watch = 2;
aiNoteHuman(0); AI.last = 0; aiNoteHuman(0);
check('a chance missed is not counted', AI.took, 0);
check('and the watch runs out', AI.watch, 0);
check('and honest chess is owed for it', AI.cool > 0, true);

// The whole point of the cool-off: the answer to a missed chance is a stretch
// of real play, not a bigger giveaway.
aiReset(fixed(0));
var normal = aiBandFor('middle', 30, 0);
AI.cool = 6;
var owing = aiBandFor('middle', 30, 0);
check('while it owes honest chess it plays harder', owing[0] > normal[0], true);

// ---- the band moves for the right reasons ----
aiReset(fixed(0)); AI.handover = 20;
var atHandover = aiBandFor('middle', 20, 0);
var wellPast   = aiBandFor('middle', 60, 0);
check('the target walks down after the handover', wellPast[0] < atHandover[0], true);
check('but only so far',
      atHandover[0] - aiBandFor('middle', 400, 0)[0] <= AI_WALK_MAX + 1e-9, true);
check('and not before it', aiBandFor('middle', 10, 0)[0], atHandover[0]);

aiReset(fixed(0));
check('a player who is finding everything gets a stronger opponent',
      aiBandFor('middle', 10, 1)[0] > aiBandFor('middle', 10, -1)[0], true);
check('and one who is struggling gets an easier one',
      aiBandFor('middle', 10, -1)[0] < aiBandFor('middle', 10, 0)[0], true);

check('a band is always a band',
      [['early',0,0],['middle',40,1],['late',120,-1],['late',400,1]].every(function(c){
        aiReset(fixed(0.3));
        var b = aiBandFor(c[0], c[1], c[2]);
        return b[0] < b[1] && b[0] >= 0 && b[1] <= 1;
      }), true);

// ---- and the slack ----
aiReset(fixed(0));
check('well ahead it is allowed to give more ground',
      aiSlackFor('middle', 0.9) > aiSlackFor('middle', 0.5), true);
check('but never past a rook',
      [0.5, 0.7, 0.8, 0.99].every(function(w){
        return AI_STYLE_NAMES.every(function(n){
          aiReset(fixed(0)); AI.style = n;
          return aiSlackFor('late', w) < 500;
        });
      }), true);
check('and never so little that it cannot choose',
      aiSlackFor('early', 0.1) >= 60, true);

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
