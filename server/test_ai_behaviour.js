/* Many games against the undercover opponent, and what has to be true of all
 * of them.
 *
 * test_ai_fallback.js checks the pieces in isolation and test_ai_game.js plays
 * one game through. Neither can answer the questions the brief actually asks,
 * because every one of them is about a DISTRIBUTION: does the player win, do
 * the games differ from each other, does the opponent stop pressing when it is
 * winning, does it keep resisting when it is losing, and does it ever mate
 * somebody. One game cannot say. A hundred can.
 *
 * Three players are simulated, and the difference between them is the whole
 * point of the adaptation: a strong one takes the engine's own move, an
 * average one takes something reasonable, a weak one often takes something
 * bad. What is asserted is not that the opponent plays well or badly but that
 * the SHAPE of the game is right against each of them.
 *
 * The stand-in engine is two plies of material, as in test_ai_game.js — enough
 * to produce a game, and enough to hang a piece if the bot were minded to.
 *
 *   node server/test_ai_behaviour.js
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
             'CHALLENGE_TTL','CHALLENGING','BOT','SPECTATING','PUZZLE','AI_MATCH','humanTurn','viewer',
             'CAN_PEEK','AI_POOL','AI_BAND','AI_SLACK','scheduleAI','W',
             'AI_STYLES','AI_STYLE_NAMES','AI_WALK_MAX','AI_WALK_PER_PLY',
             'AI_TOOK_CP','AI_FORM_CP','AI_REP_NUDGE','AI'];
var FNS = ['startBoard','newState','cloneState','posKey','slide','step','addPawn',
           'pseudoMoves','isAttacked','kingSq','inCheck','makeMove','legalMoves','toSAN',
           'myName','seatName','layoutBoardBars','pickFrom','bestMove','applyMove','checkEnd',
           'insufficient','resultTitle','finish','aiPhase','winChance','lineScore',
           'aiSearch','aiChoose','aiPick','aiTurn',
           'aiReset','aiForm','aiNoteHuman','aiBandFor','aiSlackFor','aiPoolFor','aiNoMate'];

var bundle = [grab(/\nconst W = 'w', B = 'b';/, "const W/B")];
for (var d = 0; d < DECLS.length; d++) if (DECLS[d] !== 'W') bundle.push(decl(DECLS[d]));
for (var f = 0; f < FNS.length; f++) bundle.push(fn(FNS[f]));
eval(bundle.join('\n').replace(/(^|\n)(?:const|let) /g, '$1var '));
var passed = 0, failed = 0;
function check(label, got, want){
  if (got === want){ passed++; say('  PASS  ' + label + '  ->  ' + got); }
  else { failed++; say('  FAIL  ' + label + '\n        got  ' + got + '\n        want ' + want); }
}

/* ---- the stand-in engine: two plies of material ---- */

var CP = { P:100, N:320, B:330, R:500, Q:900, K:0 };
function material(st, side){
  var sum = 0;
  for (var i = 0; i < 64; i++){
    var p = st.b[i];
    if (p) sum += (p.c === side ? 1 : -1) * CP[p.t];
  }
  return sum;
}
function scoreMove(st, m, side){
  var after = makeMove(st, m);
  var reply = legalMoves(after, after.turn), worst = 0;
  for (var i = 0; i < reply.length; i++){
    var v = material(makeMove(after, reply[i]), side) - material(after, side);
    if (v < worst) worst = v;
  }
  if (!reply.length) return inCheck(after, after.turn) ? 90000 : 0;
  return material(after, side) + worst;
}
function rank(st){
  var side = st.turn, out = [], legal = legalMoves(st, side);
  for (var i = 0; i < legal.length; i++)
    out.push({ m: legal[i], best: uciOf(legal[i]), cp: scoreMove(st, legal[i], side),
               mate: null, pv: [uciOf(legal[i])] });
  out.sort(function(a, b){ return b.cp - a.cp; });
  return out;
}
function engineAsk(moves, opt){
  var lines = rank(G.st).slice(0, opt.multipv || 1);
  return Promise.resolve({
    best: lines[0] && lines[0].best, cp: lines[0] ? lines[0].cp : 0, mate: null,
    pv: lines[0] && lines[0].pv, second: lines[1] || null, lines: lines
  });
}

/* Every choice, so a game can be judged after it rather than a move at a time. */
var realChoose = aiChoose, choices = [];
/* apply(), not four named parameters. A wrapper that lists the arguments it
   knows about silently drops the ones it does not, and a new option added to
   aiChoose then does nothing at all in here while doing something in the page
   — which is a test that reports success for a feature it has disabled. */
aiChoose = function(){
  var cands = arguments[0], band = arguments[1], slack = arguments[2];
  var out = realChoose.apply(null, arguments);
  choices.push({ cands: cands, band: band, slack: slack, floor: arguments[4], out: out,
                 // the top aiChoose actually steers by: it drops mate scores
                 // before it looks, so a top that counts them is not its top
                 top: Math.max.apply(null, cands.filter(function(c){ return c.score < 90000; })
                        .concat(cands).map(function(c){ return c.score; })) });
  return out;
};

/* ---- players ----
   The three are not "good at chess" and "bad at chess" so much as three
   different distributions over the same ranked list, which is exactly what the
   controller is trying to read. */
/* A PERSON DOES NOT REPLAY THE SAME MOVE IN THE SAME POSITION FOREVER, and a
   simulated player that does will shuffle to a threefold every time the game
   goes quiet. The first version of this file took list[0] unconditionally and
   produced 17 repetitions in 33 games against the strong player and 0 against
   the weak one — a difference that says everything about which side was doing
   the repeating. Measuring the opponent against a player who is a pure
   function measures the function.
   
   So each of the three declines a move that walks back into a position already
   on the board, when something comparable is available. That is the one human
   habit they need for this to be a measurement of the bot. */
function notStale(list, take){
  for (var i = 0; i < list.length && i < 6; i++){
    var m = take(list, i);
    if (!m) continue;
    var after = makeMove(G.st, m);
    if ((G.reps[posKey(after)] || 0) === 0) return m;
  }
  return take(list, 0);
}

var PLAYERS = {
  strong:  function(list){ return notStale(list, function(l, i){ return l[i] && l[i].m; }); },
  average: function(list){
    return notStale(list, function(l, i){
      return l[Math.min(l.length - 1, i + ((Math.random() * 3) | 0))].m; });
  },
  weak:    function(list){
    /* A weak player is not a random-move generator, and simulating one as
       though they were is how a test concludes the opponent is too strong when
       it is the player who is not a person. The distinguishing thing about a
       weak HUMAN is that they still take what is put in front of them — a
       hanging piece, an obvious trade — and go wrong in the quiet moves. So:
       always take a clearly winning capture, otherwise often choose badly. */
    if (list.length && list[0].cp - (list[1] ? list[1].cp : 0) >= 200) return list[0].m;
    if (Math.random() < 0.35) return list[(Math.random() * list.length) | 0].m;
    return notStale(list, function(l, i){
      return l[Math.min(l.length - 1, i + ((Math.random() * 5) | 0))].m; });
  }
};

function newBoard(){
  G.st = newState();
  G.sans = []; G.uci = []; G.caps = { w:[], b:[] }; G.reps = {};
  G.over = null; G.sel = -1; G.lastMove = null; G.thinking = false;
  G.clock = { w: 600000, b: 600000 };
  G.token++;
}
function seat(){
  G.opponent = 'online'; G.matchKind = 'ranked'; G.mode = 'sighted';
  G.human = W; G.started = true; G.inc = 0; G.minutes = 10;
  NET.state = 'playing'; NET.gameId = 'x'; NET.reported = false;
  NET.opponent = 'goutham111';
  NET.ai = { name: 'goutham111', elo: 1221 };
  newBoard();
  aiReset();                       // what newGame() does for a real match
}
async function until(pred, tries){
  for (var i = 0; i < (tries || 4000); i++){ if (pred()) return true; await sleep(1); }
  return false;
}

/* One whole game. Returns what happened, not whether it was good. */
async function playGame(kind){
  seat();
  choices.length = 0;
  var style = AI.style, handover = AI.handover;
  var evals = [];                  // material from the player's side, per bot turn
  var forced = 0, declinable = 0;  // mate with no alternative, and with one
  var repTurns = [];               // what was on offer, repetition-wise, each bot turn
  var guard = 0;
  /* No clock runs in here — tickClock() is not started — so a game that would
     have ended on time instead runs until this cap. Three hundred plies is a
     hundred and fifty moves, past the length of nearly any real game, so a
     game still going at the end of it is one that was never going to finish
     rather than one this cut short. */
  while (!G.over && G.sans.length < 300 && ++guard < 600){
    if (G.st.turn === G.human){
      var list = rank(G.st);
      if (!list.length) break;
      applyMove(PLAYERS[kind](list));
    } else {
      /* Was mate forced on this turn — every legal move mating — or merely
         available? The promise is that the opponent never CHOOSES a mate; a
         position where it has nothing else to play is one the player has
         already lost, and refusing to move is not a chess move. Asked with the
         page's own generator, before the bot is given the turn. */
      var all = legalMoves(G.st, G.st.turn), mating = 0;
      for (var q = 0; q < all.length; q++){
        var nx = makeMove(G.st, all[q]);
        if (!legalMoves(nx, nx.turn).length && inCheck(nx, nx.turn)) mating++;
      }
      if (mating && mating === all.length) forced++;
      if (mating && mating < all.length) declinable++;
      /* DIAGNOSTIC: was a repetition chosen, or merely arrived at? For every
         bot turn, how many of its legal moves reach a position already seen,
         and how many do not. If it repeats while fresh moves were available,
         that is a choice; if every move repeats, it is the position. */
      var fresh = 0, repeats = 0;
      for (var q2 = 0; q2 < all.length; q2++){
        var nx2 = makeMove(G.st, all[q2]);
        if ((G.reps[posKey(nx2)] || 0) >= 1) repeats++; else fresh++;
      }
      repTurns.push({ fresh: fresh, repeats: repeats, ply: G.sans.length });
      var before = G.sans.length;
      aiTurn(G.token);
      if (!await until(function(){ return G.sans.length > before || G.over; }, 3000)) break;
    }
    evals.push(material(G.st, G.human));
  }
  return { over: G.over, plies: G.sans.length, evals: evals,
           style: style, handover: handover, forced: forced, declinable: declinable,
           repTurns: repTurns,
           choices: choices.slice(), took: AI.took, opened: AI.opened };
}

/* ---- the runs ---- */

(async function(){

say('\nA hundred games, and what is true of all of them\n');

var games = [];
var kinds = ['strong', 'average', 'weak'];
for (var g = 0; g < 99; g++) games.push(await playGame(kinds[g % 3]));

var byKind = { strong: [], average: [], weak: [] };
for (var i = 0; i < games.length; i++) byKind[kinds[i % 3]].push(games[i]);

// 1. THE PRIMARY GOAL. The player is not mated by the opponent, ever.
var mated = games.filter(function(r){
  return r.over && /Checkmate/.test(r.over.text || '') && !/White wins/.test(r.over.text || '');
}).length;
/* The promise is that it never CHOOSES one. A position where every legal move
   mates is a position the player has already lost, and there is no move to
   play instead — so those are counted separately rather than excused. */
var declinable = 0, forced = 0;
for (var i = 0; i < games.length; i++){ declinable += games[i].declinable; forced += games[i].forced; }
var chose = games.filter(function(r){
  return r.forced === 0 && r.over && /Checkmate/.test(r.over.text || '')
         && !/White wins/.test(r.over.text || '');
}).length;
check('the opponent never chooses a checkmate', chose, 0);
check('mates were on the board for it to decline', declinable > 0, true);
say('  ..    ' + declinable + ' declinable mates, ' + forced + ' turns with no alternative, '
    + mated + ' games ended in one');

// 2. It never plays a move it was not allowed to play.
var outsideSlack = 0, softWhenBehind = 0, declined = 0;
for (var i = 0; i < games.length; i++)
  for (var c = 0; c < games[i].choices.length; c++){
    var ch = games[i].choices[c];
    if (!ch.out) continue;
    /* Outside the slack is allowed in exactly one case and it is not a
       loophole: a move whose own position is still worth at least the floor.
       That is the opponent declining a gift rather than playing a bad move,
       and the floor is a win chance, so it can never admit a losing one. */
    if (ch.top - ch.out.score > ch.slack){
      if (ch.floor !== undefined && ch.out.win >= ch.floor) declined++;
      else outsideSlack++;
    }
    // behind the band, the best move is the only acceptable answer
    var best = ch.cands.filter(function(x){ return x.score === ch.top; })[0];
    if (best && best.win < ch.band[0] && ch.out.score < ch.top) softWhenBehind++;
  }
check('never a move outside the slack it was given', outsideSlack, 0);
check('though it did decline things it was offered', declined > 0, true);
check('and never into a position it was not still happy with',
      games.every(function(r){
        return r.choices.every(function(ch){
          return !ch.out || ch.floor === undefined ||
                 ch.top - ch.out.score <= ch.slack || ch.out.win >= ch.floor;
        });
      }), true);
check('never a soft move while it was behind', softWhenBehind, 0);

// 3. Games differ from each other.
var styles = {}, handovers = {}, lengths = {};
for (var i = 0; i < games.length; i++){
  styles[games[i].style] = 1;
  handovers[games[i].handover] = 1;
  lengths[games[i].plies] = 1;
}
check('the opponent is not the same opponent twice', Object.keys(styles).length >= 3, true);
check('and does not turn the corner on the same move',
      Object.keys(handovers).length >= 8, true);
check('and the games are not the same length',
      Object.keys(lengths).length >= 8, true);

// 4. It does not run away with the game.
//    Measured from the player's side: how far ahead the BOT ever got.
var ran = 0, deep = 0;
for (var i = 0; i < games.length; i++){
  var worst = Math.min.apply(null, games[i].evals.concat([0]));
  if (worst <= -500) ran++;        // the player a rook down at some point
  if (worst <= -1500) deep++;      // ...and past any reasonable recovery
}
say('  ..    the player went a rook down in ' + ran + ' games, hopelessly down in ' + deep);
/* It is allowed to be better — a game it never leads is not competitive — but
   it must not run away with one. The hard line is the second number. */
check('it never runs away with a game', deep, 0);

// 5. It does not collapse either: the player has to actually play.
var instant = games.filter(function(r){ return r.plies < 12; }).length;
check('and it does not fold in the opening', instant, 0);

say('\nAdapting to who is on the other side\n');

function meanBandLow(list){
  var sum = 0, n = 0;
  for (var i = 0; i < list.length; i++)
    for (var c = 0; c < list[i].choices.length; c++){ sum += list[i].choices[c].band[0]; n++; }
  return n ? sum / n : 0;
}
var vsStrong = meanBandLow(byKind.strong), vsWeak = meanBandLow(byKind.weak);
check('a stronger player meets a stronger opponent', vsStrong > vsWeak, true);
say('  ..    band floor vs strong ' + vsStrong.toFixed(3) + ', vs weak ' + vsWeak.toFixed(3));

// The weak player must still be given a game they can win, not a rout either way.
var weakWon = byKind.weak.filter(function(r){
  return r.over && /White wins|Checkmate — White/.test(r.over.text || '');
}).length;
function wins(list){
  return list.filter(function(r){ return r.over && /White wins/.test(r.over.text || ''); }).length;
}
for (var k = 0; k < kinds.length; k++)
  say('  ..    ' + kinds[k] + ': player won ' + wins(byKind[kinds[k]]) +
      ' of ' + byKind[kinds[k]].length);
var outcomes = {};
for (var i = 0; i < games.length; i++){
  var t = (games[i].over && games[i].over.text) || 'unfinished';
  outcomes[t] = (outcomes[t] || 0) + 1;
}
say('  ..    outcomes: ' + Object.keys(outcomes).map(function(k){
  return k + ' x' + outcomes[k]; }).join(', '));
/* THE PRIMARY GOAL, stated as the thing that can actually be checked: the
   opponent does not win. Not "the player wins every game" — a draw is a real
   result and a game truncated by this harness at two hundred plies is not a
   result at all — but the opponent never takes the point. */
var botWon = games.filter(function(r){
  return r.over && /Black wins/.test(r.over.text || ''); }).length;
check('the opponent never wins', botWon, 0);
var decided = games.filter(function(r){ return !!r.over; }).length;
check('and the player wins most of the games that finish',
      wins(games) >= Math.round(decided * 0.6), true);
check('every kind of player beats it sometimes',
      kinds.every(function(k){ return wins(byKind[k]) > 0; }), true);

/* DIAGNOSTIC: what a choice actually costs, and what was on offer to choose
   from. If the spread among the candidates is small then no band can bleed an
   advantage, and the limit is the engine rather than the policy. */
var cost = [], spread = [], aheadTurns = 0;
for (var i = 0; i < byKind.weak.length; i++)
  for (var c = 0; c < byKind.weak[i].choices.length; c++){
    var ch = byKind.weak[i].choices[c];
    if (!ch.out) continue;
    var lo = Math.min.apply(null, ch.cands.map(function(x){ return x.score; }));
    if (ch.out.win > 0.8) aheadTurns++;
    cost.push(ch.top - ch.out.score);
    spread.push(ch.top - lo);
  }
function mean(a){ var s = 0; for (var i = 0; i < a.length; i++) s += a[i]; return a.length ? s / a.length : 0; }
say('  ..    vs weak: ' + cost.length + ' choices, mean cost ' + mean(cost).toFixed(0) +
    'cp, mean spread on offer ' + mean(spread).toFixed(0) + 'cp, ' + aheadTurns + ' turns while winning');

/* DIAGNOSTIC: the repetitions. */
var repGames = games.filter(function(r){ return r.over && /repetition/.test(r.over.text || ''); });
var choseRep = 0, hadToRep = 0, botAheadAtRep = 0;
for (var i = 0; i < repGames.length; i++){
  var tail = repGames[i].repTurns.slice(-6);
  for (var t = 0; t < tail.length; t++){
    if (tail[t].fresh > 0) choseRep++; else hadToRep++;
  }
  var last = repGames[i].evals[repGames[i].evals.length - 1];
  if (last !== undefined && last < 0) botAheadAtRep++;
}
say('  ..    ' + repGames.length + ' repetition games; over their last six bot turns, '
    + choseRep + ' had a non-repeating move available and ' + hadToRep + ' did not');
say('  ..    the bot was materially ahead in ' + botAheadAtRep + ' of them');
/* A shuffle is the least human-looking way for a game to end, and it used to be
   how a quarter of them ended. Most of that was the harness — see notStale() —
   but not all: on 154 of the 156 bot turns leading into one, a move that did
   not repeat was available and was not played. Both halves are fixed and this
   is what keeps them fixed. */
check('games rarely end by shuffling',
      repGames.length <= Math.round(games.length * 0.12), true);
check('and never because it had nothing else to play', hadToRep <= 2, true);
for (var k = 0; k < kinds.length; k++){
  var kr = byKind[kinds[k]].filter(function(r){
    return r.over && /repetition/.test(r.over.text || ''); }).length;
  var ku = byKind[kinds[k]].filter(function(r){ return !r.over; }).length;
  say('  ..    ' + kinds[k] + ': ' + kr + ' repetitions, ' + ku + ' unfinished, of '
      + byKind[kinds[k]].length);
}

say('\nChances, and what happens when they are missed\n');

var offered = 0, taken = 0, cooled = 0;
for (var i = 0; i < games.length; i++){ offered += games[i].opened; taken += games[i].took; }
check('chances were left on the board', offered > 0, true);
say('  ..    ' + offered + ' offered, ' + taken + ' taken');

/* The cool-off, directly: a chance nobody takes must be followed by a harder
   band, not a bigger giveaway. Driven through the controller rather than a
   game, because what is being tested is the rule and not the chess. */
aiReset(function(){ return 0; });
var before = aiBandFor('middle', 30, 0);
AI.opened = 1; AI.watch = 1; AI.last = 0;
aiNoteHuman(0);                                  // the chance goes by unused
check('a missed chance owes honest chess', AI.cool > 0, true);
var after = aiBandFor('middle', 30, 0);
check('and the opponent plays harder for a while', after[0] > before[0], true);
var owed = AI.cool, ticks = 0;
while (AI.cool > 0 && ticks < 50){ AI.last = 0; aiNoteHuman(0); ticks++; }
check('but not forever', ticks <= owed + 1, true);

say('\n' + passed + ' passed, ' + failed + ' failed\n');
if (typeof process !== 'undefined' && process.exit) process.exit(failed ? 1 : 0);

})();
