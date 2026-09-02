/* Playing a whole ranked fallback game, without a browser and without an engine.
 *
 * test_ai_fallback.js checks the pieces the bot decides with. This one runs the
 * flow: applyMove, aiTurn, checkEnd and finish — the page's own functions, read
 * out of blind-chess.html — against a stub DOM and a stand-in engine, until a
 * real game reaches a real ending. What it is really watching for is the two
 * promises the brief makes and neither of which has a screen to check them on:
 * that every move the bot plays is one the position allows, and that no move it
 * plays is a blunder it chose in order to lose.
 *
 * The stand-in engine is two plies of material, which is enough to produce a
 * game and enough to hang a piece if the bot were minded to. The delays are
 * flattened by shadowing setTimeout, and the coin is seeded, so a run is a
 * second long and the same every time.
 *
 *   node server/test_ai_game.js
 */

var PAGE = 'blind-chess.html';

function slurp(path){
  if (typeof readFile === 'function') return readFile(path);
  return require('fs').readFileSync(path, 'utf8');
}
function say(s){ (typeof print === 'function' ? print : console.log)(s); }

var SRC = slurp(PAGE);
function grab(re, what){
  var m = SRC.match(re);
  if (!m){ say('FAIL  could not find ' + what); throw new Error(what + ' not found'); }
  return m[0];
}
function fn(n){
  return grab(new RegExp('\\n(?:async )?function ' + n + '\\s*\\([\\s\\S]*?\\n\\}'), 'function ' + n);
}
function decl(n){
  var block = SRC.match(new RegExp('\\n(?:const|let) ' + n + '\\s*=\\s*[\\{\\[][\\s\\S]*?\\n[\\}\\]];'));
  if (block) return block[0];
  // an arrow whose body is a block closes at column zero, like the rest
  var arrow = SRC.match(new RegExp('\\n(?:const|let) ' + n + '\\s*=[^\\n]*=>\\s*\\{[\\s\\S]*?\\n\\};'));
  if (arrow) return arrow[0];
  return grab(new RegExp('\\n(?:const|let) ' + n + '\\b[^\\n]*?;'), n);
}

/* ---- the stub half ---- */

// The pauses in front of a bot's move are there so it does not answer like a
// machine, and a test that sat through them would take a quarter of an hour.
// Shadowing the timer keeps every path through the real code and drops only
// the waiting. Anything that needs the real one asks for it by name.
var realTimeout = globalThis.setTimeout;
function setTimeout(fn, ms){ return realTimeout(fn, 0); }
function sleep(ms){ return new Promise(function(r){ realTimeout(r, ms); }); }

// A seeded coin, so "it varies" does not mean "it differs between runs here".
var seed = 20240917;
Math.random = function(){
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};

function fakeEl(tag){
  var self = {
    tag: tag || 'div', textContent: '', innerHTML: '', className: '',
    disabled: false, style: {}, dataset: {}, kids: [],
    classList: {
      add: function(){}, remove: function(){}, toggle: function(){},
      contains: function(){ return false; }
    },
    querySelector: function(sel){
      for (var i = 0; i < self.kids.length; i++)
        if ('.' + self.kids[i].className === sel) return self.kids[i];
      return null;
    },
    querySelectorAll: function(){ return []; },
    addEventListener: function(){}, scrollIntoView: function(){},
    appendChild: function(k){ self.kids.push(k); return k; },
    closest: function(){ return null; }
  };
  return self;
}
var elements = {};
var document = {
  getElementById: function(id){ return elements[id] || (elements[id] = fakeEl()); },
  querySelector: function(){ return null; },
  querySelectorAll: function(){ return []; },
  createElement: fakeEl, createElementNS: fakeEl
};

var sent = [];                      // everything the page tried to put on the wire
function netSend(o){ sent.push(o); }
var rendered = 0, logged = [];
function render(){ rendered++; }
function renderStatus(){}
function logLine(t){ logged.push(t); }
function announce(){}
function soundFor(){}
function beep(){}
function stopClock(){}
function startClock(){}
function focusLocalInput(){}
function reviewClose(){}
function resetLog(){}
function scheduleEngine(){}         // the ladder's turn; not this game's
var pieceEls = new Map();
var account = null;
var REV = { on: false };
var sqEls = [];
for (var i = 0; i < 64; i++) sqEls.push(fakeEl());

/* ---- the real half ---- */

var DECLS = ['VAL','FILES','rowOf','colOf','SQNAME','uciOf','sqName','onBoard','other',
             'idCounter','mk','DIR_N','DIR_B','DIR_R','DIR_K','PIECE_WORD',
             'G','NET','el','BLINDISH','BOT_NAME','LOCAL','ONLINE','HOSTING','CHAL',
             'CHALLENGE_TTL','CHALLENGING','BOT','PUZZLE','AI_MATCH','humanTurn','viewer',
             'CAN_PEEK','AI_POOL','AI_BAND','AI_SLACK','scheduleAI','W'];
var FNS = ['startBoard','newState','cloneState','posKey','slide','step','addPawn',
           'pseudoMoves','isAttacked','kingSq','inCheck','makeMove','legalMoves','toSAN',
           'seatName','layoutBoardBars','pickFrom','bestMove','applyMove','checkEnd',
           'insufficient','resultTitle','finish','aiPhase','winChance','lineScore',
           'aiSearch','aiChoose','aiPick','aiTurn'];

var bundle = [grab(/\nconst W = 'w', B = 'b';/, "const W/B")];
for (var d = 0; d < DECLS.length; d++) if (DECLS[d] !== 'W') bundle.push(decl(DECLS[d]));
for (var f = 0; f < FNS.length; f++) bundle.push(fn(FNS[f]));
eval(bundle.join('\n').replace(/(^|\n)(?:const|let) /g, '$1var '));

var passed = 0, failed = 0;
function check(label, got, want){
  if (got === want){ passed++; say('  PASS  ' + label + '  ->  ' + got); }
  else { failed++; say('  FAIL  ' + label + '\n        got  ' + got + '\n        want ' + want); }
}

/* ---- the stand-in engine ---- */

var CP = { P:100, N:320, B:330, R:500, Q:900, K:0 };
function material(st, side){
  var sum = 0;
  for (var i = 0; i < 64; i++){
    var p = st.b[i];
    if (p) sum += (p.c === side ? 1 : -1) * CP[p.t];
  }
  return sum;
}
// what a move is worth once the other side has had its best swing back
function scoreMove(st, m, side){
  var after = makeMove(st, m);
  var reply = legalMoves(after, after.turn), worst = 0;
  for (var i = 0; i < reply.length; i++){
    var v = material(makeMove(after, reply[i]), side) - material(after, side);
    if (v < worst) worst = v;
  }
  if (!reply.length) return inCheck(after, after.turn) ? 90000 : 0;   // mate, or stalemate
  return material(after, side) + worst;
}
function rank(st){
  var side = st.turn, out = [];
  var legal = legalMoves(st, side);
  for (var i = 0; i < legal.length; i++)
    out.push({ m: legal[i], best: uciOf(legal[i]), cp: scoreMove(st, legal[i], side),
               mate: null, pv: [uciOf(legal[i])] });
  out.sort(function(a, b){ return b.cp - a.cp; });
  return out;
}
var asked = [];
function engineAsk(moves, opt){
  asked.push({ moves: moves.slice(), opt: opt });
  var lines = rank(G.st).slice(0, opt.multipv || 1);
  return Promise.resolve({
    best: lines[0] && lines[0].best, cp: lines[0] ? lines[0].cp : 0, mate: null,
    pv: lines[0] && lines[0].pv, second: lines[1] || null, lines: lines
  });
}

/* Every call aiChoose was asked to make, kept so the game can be judged after
   it rather than a move at a time. The real one still does the choosing. */
var realChoose = aiChoose, choices = [];
aiChoose = function(cands, band, slack, rnd){
  var out = realChoose(cands, band, slack, rnd);
  choices.push({ cands: cands, band: band, slack: slack, out: out });
  return out;
};

/* ---- a game ---- */

function newBoard(){
  G.st = newState();
  G.sans = []; G.uci = []; G.caps = { w:[], b:[] }; G.reps = {};
  G.over = null; G.sel = -1; G.lastMove = null; G.thinking = false;
  G.clock = { w: 600000, b: 600000 };
  G.token++;
}
function seatAgainstBot(){
  G.opponent = 'online';
  G.matchKind = 'ranked';
  G.mode = 'sighted';
  G.human = W;
  G.started = true;
  G.inc = 0;
  G.minutes = 10;
  NET.state = 'playing';
  NET.gameId = 'test';
  NET.reported = false;
  NET.opponent = 'goutham111';
  NET.ai = { name: 'goutham111', elo: 1221 };
  newBoard();
}
async function until(pred, tries){
  for (var i = 0; i < (tries || 4000); i++){
    if (pred()) return true;
    await sleep(1);
  }
  return false;
}

async function main(){

say('\nSitting down against one\n');

seatAgainstBot();
check('the page knows it is a bot game', AI_MATCH(), true);
check('and that it is still an online one', ONLINE(), true);
check('the bot is not the ladder', BOT(), false);
check('the opponent is named on the board', seatName(B), 'goutham111');

// neither strip wears a tag: the bot is named like any opponent, on purpose
layoutBoardBars();
function tagOn(barId){
  var name = elements[barId].querySelector('.bar-name');
  if (!name) return '';
  for (var i = 0; i < name.kids.length; i++)
    if (name.kids[i].className === 'bot') return name.kids[i].textContent;
  return '';
}
check('the opponent\'s strip does not say what it is', tagOn('barTop'), '');
check('and neither does the player\'s', tagOn('barBottom'), '');

say('\nPlaying one out\n');

var illegal = 0, unanswered = 0, botMoves = 0;
var ply = 0;
while (!G.over && ply < 220){
  // The player's move. Not simply the stand-in's first line: two greedy
  // material engines find the same short mate every time, and a twenty-ply
  // game is not much of a test of anything. Anything within half a pawn of
  // the best will do, which is a player rather than a script.
  var mineSet = rank(G.st).filter(function(x, i, all){ return all[0].cp - x.cp <= 50; });
  if (!mineSet.length) break;
  var mine = mineSet[(Math.random() * mineSet.length) | 0];
  applyMove(mine.m);
  ply++;
  if (G.over) break;
  // ...and the bot's, played by the page's own turn, on the page's own timer
  var allowed = legalMoves(G.st, G.st.turn).map(uciOf);
  var was = G.sans.length;
  var answered = await until(function(){ return G.over || G.sans.length > was; });
  if (!answered){ unanswered++; break; }
  if (G.over) break;
  botMoves++;
  if (allowed.indexOf(G.uci[G.uci.length - 1]) < 0) illegal++;
  ply++;
}

check('the bot answered every move', unanswered, 0);
check('and answered a good few', botMoves >= 10, true);
check('every move it played was one the position allowed', illegal, 0);
check('the game reached an ending', !!G.over, true);
say('  ..    ' + G.sans.length + ' plies, ending: ' + (G.over && G.over.text));
check('the ending is one of the rules\', not a stall',
      /Checkmate|Stalemate|Draw|wins/.test(G.over.text), true);

say('\nWhat it never did\n');

// The one thing a bot steering towards a target must not do is buy the target
// with a piece. Every choice it made is re-checked against the candidates it
// was choosing between, which is where a thrown game would show.
var outsideSlack = 0, softWhenBehind = 0, notFirstLine = 0;
for (var c = 0; c < choices.length; c++){
  var set = choices[c], top = -Infinity, bottomOfBand = set.band[0];
  for (var i = 0; i < set.cands.length; i++) top = Math.max(top, set.cands[i].score);
  if (top - set.out.score > set.slack) outsideSlack++;
  // the candidates arrive best first, so declining the first one is the
  // variability the brief asks for — and it is not the same question as
  // declining the top *score*, which several moves usually share
  if (set.out !== set.cands[0]) notFirstLine++;
  // behind the band with nothing to steer towards, it must take the best move
  var anyInReach = set.cands.some(function(x){ return x.win >= bottomOfBand; });
  if (!anyInReach && set.out.score < top) softWhenBehind++;
}
say('  ..    ' + choices.length + ' choices made, ' + notFirstLine +
    ' of them not the engine\'s first line');
check('it never played outside the slack', outsideSlack, 0);
check('it never gave ground while it was behind', softWhenBehind, 0);
check('but it did decline the engine\'s own pick sometimes', notFirstLine > 0, true);

say('\nWhat it never sent\n');

var moveMsgs = sent.filter(function(m){ return m.t === 'move'; });
var results  = sent.filter(function(m){ return m.t === 'result'; });
check('not one move went over the socket', moveMsgs.length, 0);
check('but the result did', results.length, 1);
check('and it said how it ended', results[0].status, G.over.text);
check('every search it ran was about the position it was in',
      asked.every(function(a){ return typeof a.moves.length === 'number'; }), true);
check('and none of them was allowed to come from the cache',
      asked.every(function(a){ return a.opt.nocache === true; }), true);
check('nor to think for longer than the clock could stand',
      asked.every(function(a){ return a.opt.movetime <= 700 && a.opt.movetime >= 80; }), true);

say('\nThe guards on its turn\n');

// a reply from a game that has been abandoned must not wake up in the next one
seatAgainstBot();
applyMove(rank(G.st)[0].m);          // white moves; it is the bot's turn now
var before = G.sans.length;
G.token++;                            // ...and that game is over, whatever it was
await sleep(30);
check('a reply from an abandoned game plays nothing', G.sans.length, before);

seatAgainstBot();
applyMove(rank(G.st)[0].m);
G.over = { text: 'stopped' };
await sleep(30);
check('a finished game plays nothing', G.sans.length, 1);

seatAgainstBot();
before = G.sans.length;
aiTurn(G.token);                      // it is the player's move, not the bot's
await sleep(30);
check('it never moves for the player', G.sans.length, before);

seatAgainstBot();
NET.ai = null;                        // a game against a person, now
applyMove(rank(G.st)[0].m);
await sleep(30);
check('and it does not play in somebody else\'s game', G.sans.length, 1);
check('whose moves do go over the socket',
      sent.filter(function(m){ return m.t === 'move'; }).length, 1);

say('\n' + passed + ' passed, ' + failed + ' failed\n');
if (typeof process !== 'undefined' && process.exit) process.exit(failed ? 1 : 0);
}

main();
