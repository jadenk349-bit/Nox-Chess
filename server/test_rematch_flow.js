/* Rematch, and where New Game goes — without a browser.
 *
 * The Python suite proves the server's half: who may ask, who may answer, and
 * that a request tied to the wrong game never starts one. This is the other
 * half, the page's own: which message each button sends, which box each reply
 * opens, and — the part with no server in it at all — which screen New Game
 * leads to after a ranked, a friendly and an offline game.
 *
 * Like the other suites it reads the code under test out of blind-chess.html
 * by name, so renaming what it extracts breaks it on purpose.
 *
 *   node server/test_rematch_flow.js
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
var fn = function(n){
  return grab(new RegExp('\\n(?:async )?function ' + n + '\\s*\\([\\s\\S]*?\\n\\}'), 'function ' + n);
};
/* Same rule as the puzzle suite: a declaration opening a brace closes at
   column zero, and only a one-liner ends at its first semicolon. */
var decl = function(n){
  var block = SRC.match(new RegExp('\\n(?:const|let) ' + n + '\\s*=\\s*[\\{\\[][\\s\\S]*?\\n[\\}\\]];'));
  if (block) return block[0];
  return grab(new RegExp('\\n(?:const|let) ' + n + '\\b[^\\n]*?;'), n);
};
/** A one-line declaration, for names whose value fits on the line they open. */
var line = function(n){
  return grab(new RegExp('\\n(?:const|let) ' + n + '\\s*=[^\\n]*?;'), n);
};
/** A `document.getElementById('x').onclick = …` handler, however it is written. */
var handler = function(id){
  return grab(new RegExp("\\ndocument\\.getElementById\\('" + id +
                         "'\\)\\.onclick\\s*=\\s*(?:\\(\\)\\s*=>\\s*\\{[\\s\\S]*?\\n\\};|[^\\n]*?;)"),
              id + ' handler');
};

var passed = 0, failed = 0;
function check(label, ok, detail){
  if (ok){ passed++; say('  PASS  ' + label); }
  else { failed++; say('  FAIL  ' + label + (detail === undefined ? '' : '  ' + detail)); }
}

/* ---- the stub half ---- */

var STUB = [
  'var W = "w", B = "b";',
  'var CHAT_MAX = 300;',
  'var MODE_NAME = { blind:"Board Only", total:"Complete Blindfold", fog:"Fog of War", sighted:"Sighted" };',
  'var timeLabel = function(m, inc){ return inc ? m + "+" + inc : m + " min"; };',
  // what the page records, so the tests can read it back
  'var SENT = [], SCREENS = [], CALLED = [];',
  'var screenName = "game", searching = false, account = null;',
  'var G = { over:null, started:true, mode:"blind", minutes:5, inc:0, matchKind:"friendly",',
  '          human:"w", sans:[], uci:[] };',
  'function netSend(o){ SENT.push(o); }',
  'function showScreen(n){ SCREENS.push(n); screenName = n; if (n !== "game") remLeave(); }',
  'function note(n){ return function(){ CALLED.push(n); }; }',
  'var beep = note("beep"), newGame = note("newGame"), syncOptions = note("syncOptions");',
  'var resetChat = note("resetChat"), setSearching = note("setSearching");',
  'var hideWaiting = note("hideWaiting"), logLine = note("logLine");',
  'var receiveMove = note("receiveMove"), showDraw = note("showDraw");',
  'var hideDraw = note("hideDraw"), drawButton = note("drawButton"), finish = note("finish");',
  'var chatNote = note("chatNote"), chatLine = note("chatLine");',
  'var showChallenge = note("showChallenge"), hideChallenge = note("hideChallenge");',
  'var challengeRefused = note("challengeRefused"), friendWord = note("friendWord");',
  'var renderRooms = note("renderRooms"), roomNote = note("roomNote");',
  'var waitingFailed = note("waitingFailed"), enterRooms = note("enterRooms");',
  'var netClose = note("netClose"), showWaiting = function(){ CALLED.push("showWaiting"); };',
  'function ONLINE(){ return G.opponent === "online"; }',
  'function rankedAgain(){ CALLED.push("rankedAgain"); showScreen("ranked"); }',
  'function goFriendly(){ CALLED.push("goFriendly"); showScreen("rooms"); }'
].join('\n');

var DOM = [
  'function classSet(){',
  '  var have = {};',
  '  return { add:function(c){ have[c] = true; }, remove:function(c){ delete have[c]; },',
  '           toggle:function(c, on){ if (on) have[c] = true; else delete have[c]; },',
  '           contains:function(c){ return !!have[c]; } };',
  '}',
  'function fakeEl(){ return { textContent:"", innerHTML:"", className:"", disabled:false,',
  '  style:{}, dataset:{}, classList:classSet(), onclick:null,',
  '  querySelector:function(){ return null; }, querySelectorAll:function(){ return []; },',
  '  addEventListener:function(){}, appendChild:function(){}, scrollIntoView:function(){} }; }',
  'var elements = {};',
  'var document = { getElementById:function(id){ return elements[id] || (elements[id] = fakeEl()); },',
  '  querySelector:function(){ return null; }, querySelectorAll:function(){ return []; },',
  '  createElement:fakeEl };',
  'var el = { endOverlay:document.getElementById("endOverlay") };',
  'var waitOverlay = document.getElementById("waitOverlay");'
].join('\n');

var CODE = [
  decl('NET'), decl('CHAL'), decl('CHALLENGE_TTL'), decl('REM'),
  // the start branch says out loud when the opponent is the ranked fallback bot
  decl('AI_MATCH'),
  decl('rematchOverlay'),
  fn('showRematch'), fn('hideRematch'), fn('remClear'), fn('remLeave'),
  fn('rematchTerms'), fn('oppWord'), fn('askRematch'), fn('acceptRematch'),
  handler('rematchAccept'), handler('rematchDecline'),
  handler('endNew'), handler('endRematch'),
  fn('onNetMessage')
].join('\n');

/** A page with nothing having happened to it yet. */
function fresh(){
  var api = new Function(
    DOM + '\n' + STUB + '\n' + CODE + '\n' +
    'return { NET:NET, REM:REM, G:G, SENT:SENT, SCREENS:SCREENS, CALLED:CALLED,' +
    '  elements:elements, recv:onNetMessage, press:function(id){ elements[id].onclick(); },' +
    '  box:function(){ var by = document.getElementById, o = by("rematchOverlay");' +
    '    return { up:o.classList.contains("show"), mode:o.dataset.mode,' +
    '             title:by("rematchTitle").textContent, text:by("rematchText").textContent }; } };'
  )();
  // A finished online game, which is the only place any of this happens.
  api.G.opponent = 'online';
  api.G.over = { text:'Checkmate — White wins' };
  api.NET.state = 'playing';
  api.NET.gameId = 'game-one';
  api.NET.opponent = 'Robin';
  return api;
}

function lastSent(p){ return p.SENT.length ? p.SENT[p.SENT.length - 1] : null; }
function sentKinds(p){ return p.SENT.map(function(m){ return m.t; }).join(','); }

var REQUEST = { t:'rematch-request', id:'r1', game:'game-one', from:'Robin',
                mode:'fog', minutes:3, inc:2, kind:'friendly', color:'b' };

say('\nAsking for a rematch');

var p = fresh();
p.press('endRematch');
check('Rematch asks rather than starting anything',
      lastSent(p) && lastSent(p).t === 'rematch' && lastSent(p).game === 'game-one',
      JSON.stringify(lastSent(p)));
check('and says so while it waits', p.box().up && p.box().mode === 'wait', JSON.stringify(p.box()));
check('nothing else is sent', p.SENT.length === 1, sentKinds(p));
check('and the screen does not change', p.SCREENS.length === 0, p.SCREENS.join(','));

p.recv({ t:'rematch-sent', id:'mine', game:'game-one' });
p.press('endRematch');
check('pressing it again sends no second request', p.SENT.length === 1, sentKinds(p));
check('and shows the request already out', p.box().up && p.box().mode === 'wait');

p.recv({ t:'rematch-declined', game:'game-one', by:'Robin' });
check('a decline is reported', p.box().up && p.box().mode === 'info', JSON.stringify(p.box()));
check('and names who declined', /Robin/.test(p.box().text), p.box().text);
check('nothing is left pending', p.REM.pending === false && p.REM.id === null);
check('and no game was begun', p.CALLED.indexOf('newGame') === -1, p.CALLED.join(','));

p.press('rematchDecline');
check('closing the report takes nothing back', p.SENT.length === 1, sentKinds(p));
check('and the box goes', p.box().up === false);

p = fresh();
p.NET.oppGone = true;
p.press('endRematch');
check('an opponent who has left is not asked', p.SENT.length === 0, sentKinds(p));
check('and the box says why', p.box().up && p.box().mode === 'info', JSON.stringify(p.box()));

p = fresh();
p.press('endRematch');
p.recv({ t:'rematch-sent', id:'mine', game:'game-one' });
p.press('rematchDecline');
check('cancelling withdraws the request', lastSent(p).t === 'rematch-cancel' &&
      lastSent(p).id === 'mine', JSON.stringify(lastSent(p)));
check('and stops waiting on it', p.REM.pending === false);

p = fresh();
p.press('endRematch');
p.recv({ t:'rematch-sent', id:'mine', game:'game-one' });
p.recv({ t:'rematch-gone', game:'game-one', reason:'left' });
check('an opponent who disappears ends the wait',
      p.REM.pending === false && p.box().mode === 'info', JSON.stringify(p.box()));

p = fresh();
p.recv({ t:'rematch-gone', game:'game-one', reason:'away' });
check('a rematch nobody here asked about says nothing', p.box().up === false);

say('\nBeing asked for one');

p = fresh();
p.recv(REQUEST);
check('the request opens a choice', p.box().up && p.box().mode === 'ask', JSON.stringify(p.box()));
check('headed by who asked', /Robin/.test(p.box().title) && /rematch/i.test(p.box().title),
      p.box().title);
check('and describing the game on offer',
      /Fog of War/.test(p.box().text) && /3\+2/.test(p.box().text) && /Black/.test(p.box().text),
      p.box().text);
check('nothing is sent until it is answered', p.SENT.length === 0, sentKinds(p));

p.press('rematchAccept');
check('accepting answers the request it was shown',
      lastSent(p).t === 'rematch-accept' && lastSent(p).id === 'r1', JSON.stringify(lastSent(p)));
check('and waits for the server to lay the board out',
      p.box().up && p.box().mode === 'info', JSON.stringify(p.box()));
check('no game is begun on this side alone', p.CALLED.indexOf('newGame') === -1);

p = fresh();
p.recv(REQUEST);
p.press('rematchDecline');
check('declining answers it too', lastSent(p).t === 'rematch-decline' && lastSent(p).id === 'r1',
      JSON.stringify(lastSent(p)));
check('and the box goes without a game', p.box().up === false &&
      p.CALLED.indexOf('newGame') === -1);

p = fresh();
p.recv({ t:'rematch-request', id:'r9', game:'a-different-game', from:'Robin',
         mode:'blind', minutes:5, inc:0, kind:'friendly', color:'w' });
check('a request about another game is refused outright',
      lastSent(p).t === 'rematch-decline' && lastSent(p).id === 'r9', JSON.stringify(lastSent(p)));
check('and never shown', p.box().up === false);

p = fresh();
p.G.over = null;                       // a game still going on
p.recv(REQUEST);
check('nor is one refused mid-game ever shown',
      lastSent(p).t === 'rematch-decline' && p.box().up === false);

p = fresh();
p.recv(REQUEST);
p.recv(REQUEST);
check('a duplicate of the request on screen changes nothing', p.SENT.length === 0, sentKinds(p));
check('and leaves one box, not two', p.REM.incoming.id === 'r1');

p = fresh();
p.press('endRematch');                 // ours goes out first
p.recv(REQUEST);                       // and theirs crosses it
check('a crossing request is left to the server to settle',
      p.SENT.length === 1 && p.SENT[0].t === 'rematch', sentKinds(p));
check('this side goes on waiting', p.box().mode === 'wait' && p.REM.pending === true);

p = fresh();
p.recv(REQUEST);
p.press('endRematch');
check('pressing Rematch with theirs on screen accepts it',
      lastSent(p).t === 'rematch-accept' && lastSent(p).id === 'r1', JSON.stringify(lastSent(p)));
check('rather than sending a second request',
      p.SENT.filter(function(m){ return m.t === 'rematch'; }).length === 0, sentKinds(p));

say('\nLeaving the finished board');

p = fresh();
p.press('endRematch');
p.recv({ t:'rematch-sent', id:'mine', game:'game-one' });
p.press('endNew');
check('walking away withdraws the request',
      p.SENT.some(function(m){ return m.t === 'rematch-cancel' && m.id === 'mine'; }), sentKinds(p));

p = fresh();
p.recv(REQUEST);
p.press('endNew');
check('and refuses one that was waiting for an answer',
      p.SENT.some(function(m){ return m.t === 'rematch-decline' && m.id === 'r1'; }), sentKinds(p));
check('nothing is left in the air either way',
      p.REM.pending === false && p.REM.incoming === null && p.REM.id === null);

say('\nThe game that arrives');

p = fresh();
p.press('endRematch');
p.recv({ t:'rematch-sent', id:'mine', game:'game-one' });
p.NET.reported = true;                 // the game just finished was reported
p.recv({ t:'start', game:'game-two', color:'b', mode:'fog', minutes:3, inc:2,
         kind:'ranked', opponent:'Robin' });
check('the box goes when the game does', p.box().up === false);
check('and nothing is left asking',
      p.REM.pending === false && p.REM.game === null && p.REM.incoming === null);
check('the new game can report its own result', p.NET.reported === false);
check('and it is the kind of game the server says it is', p.G.matchKind === 'ranked');
check('colours come from the server', p.G.human === 'b');
check('nothing of the last game is carried over',
      p.NET.gameId === 'game-two' && p.NET.oppGone === false &&
      p.CALLED.indexOf('newGame') !== -1, p.CALLED.join(','));

say('\nWhere New Game goes');

p = fresh();
p.G.matchKind = 'ranked';
p.press('endNew');
check('after a ranked game, back to the ranked page',
      p.CALLED.indexOf('rankedAgain') !== -1 && p.SCREENS.indexOf('ranked') !== -1,
      p.SCREENS.join(','));

p = fresh();
p.G.matchKind = 'friendly';
p.press('endNew');
check('after a friendly game, to the friendly match page',
      p.CALLED.indexOf('goFriendly') !== -1 && p.SCREENS.indexOf('rooms') !== -1,
      p.SCREENS.join(','));
check('and never to the page that used to ask who you are playing',
      p.SCREENS.indexOf('opponent') === -1, p.SCREENS.join(','));

p = fresh();
p.G.opponent = 'bot';
p.press('endNew');
check('offline it still leads to the setup form', p.SCREENS.join(',') === 'setup',
      p.SCREENS.join(','));
check('and the socket is given up', p.CALLED.indexOf('netClose') !== -1);

p = fresh();
p.G.opponent = 'bot';
p.press('endRematch');
check('against the engine Rematch plays straight on',
      p.CALLED.indexOf('newGame') !== -1 && p.SENT.length === 0, sentKinds(p));

say('\nBack into the ranked queue on the same terms');

/* The ranked half has no socket in it at all: New Game restores the settings
   the last ranked game was played on and presses Start Game itself. */
var ranked = new Function(
  DOM + '\n' +
  'var SCREENS = [], STARTED = 0, screenName = "game";\n' +
  'var G = { mode:"blind", minutes:99, inc:9, started:true, over:{}, sans:["e4"] };\n' +
  'var MODE_NAME = { blind:"Board Only", fog:"Fog of War" };\n' +
  'var timeLabel = function(m, i){ return i ? m + "+" + i : m + " min"; };\n' +
  'var RANK_MODE_NAME = { blind:"Only Board", fog:"Fog of War" };\n' +
  'var NET = { state:"playing", gameId:"the-last-one", opponent:"Robin", oppGone:true };\n' +
  'var CLEARED = 0; function newGame(){ CLEARED++; G.sans = []; }\n' +
  'var buttons = { rankModes:[], rankTimes:[] };\n' +
  'function mk(list, data){ var e = fakeEl(); e.dataset = data; buttons[list].push(e); return e; }\n' +
  'mk("rankModes", { mode:"blind" }); mk("rankModes", { mode:"fog" });\n' +
  'mk("rankTimes", { min:"10", inc:"0" }); mk("rankTimes", { min:"3", inc:"2" });\n' +
  'document.querySelectorAll = function(sel){\n' +
  '  if (sel.indexOf("#rankModes") === 0) return buttons.rankModes;\n' +
  '  if (sel.indexOf("#rankTimes") === 0) return buttons.rankTimes;\n' +
  '  return []; };\n' +
  'function drawRankPick(){}\n' +
  'function startRanked(){ STARTED++; }\n' +
  'function showScreen(n){ SCREENS.push(n); screenName = n;\n' +
  '  if (n === "ranked" && rankResume) applyRankSettings(rankResume);\n' +
  '  if (n !== "ranked" && n !== "game") rankResume = null; }\n' +
  line('RANK') + '\n' + line('rankReady') + '\n' + line('rankResume') + '\n' +
  line('rankedLast') + '\n' + line('RANK_AGAIN_PAUSE') + '\n' +
  fn('applyRankSettings') + '\n' + fn('rankedAgain') + '\n' +
  'return { RANK:RANK, buttons:buttons, SCREENS:SCREENS, G:G, NET:NET, pause:RANK_AGAIN_PAUSE,' +
  '  cleared:function(){ return CLEARED; },' +
  '  started:function(){ return STARTED; }, resume:function(){ return rankResume; },' +
  '  note:function(){ return document.getElementById("rankNote").textContent; },' +
  '  remember:function(s){ rankedLast = s; },' +
  '  go:rankedAgain, screen:showScreen };'
)();

/* The settings the last ranked game actually started on. G holds something
   else entirely here, which is the point: the vision buttons beside the board
   write to G, so reading it when the button is pressed can re-queue for a game
   that was never played. */
ranked.remember({ mode:'fog', minutes:3, inc:2 });
ranked.go();
check('New Game lands back on the ranked page',
      ranked.SCREENS.join(',') === 'ranked', ranked.SCREENS.join(','));
check('with the settings the last ranked game used',
      ranked.RANK.mode === 'fog' && ranked.RANK.minutes === 3 && ranked.RANK.inc === 2,
      JSON.stringify(ranked.RANK));
check('shown as chosen on the form',
      ranked.buttons.rankModes[1].classList.contains('active') &&
      ranked.buttons.rankTimes[1].classList.contains('active'));
check('and nothing else lit up',
      !ranked.buttons.rankModes[0].classList.contains('active') &&
      !ranked.buttons.rankTimes[0].classList.contains('active'));
check('the settings come from the game that started, not from live state',
      ranked.RANK.minutes !== 99, JSON.stringify(ranked.RANK));
check('the finished game is let go of',
      ranked.G.started === false && ranked.G.over === null &&
      ranked.G.sans.length === 0 && ranked.cleared() === 1);
/* New Game is not Rematch: nothing that identifies the last opponent may
   survive into the queue this is about to join. */
check('and so is everything that named the last opponent',
      ranked.NET.gameId === null && ranked.NET.opponent === '' &&
      ranked.NET.oppGone === false && ranked.NET.state !== 'playing',
      JSON.stringify(ranked.NET));
check('and the page names the game it is about to look for',
      /Fog of War/.test(ranked.note()) && /3\+2/.test(ranked.note()), ranked.note());
check('matchmaking has not begun before the page is even shown',
      ranked.started() === 0);
/* The search happens on this page now — the Start Game button sweeps — so
   there is nothing to see the page *before*. The pause is only long enough for
   the restored settings to be up when the button starts moving. */
check('and it begins a moment later rather than after a wait',
      ranked.pause > 0 && ranked.pause <= 600, '' + ranked.pause);

setTimeout(function(){
  check('and then joins the queue on its own', ranked.started() === 1);

  // Calling the search off comes back here, and must not have to be answered again
  ranked.screen('ranked');
  check('the settings survive giving the search up',
        ranked.RANK.mode === 'fog' && ranked.RANK.minutes === 3, JSON.stringify(ranked.RANK));
  // going anywhere else is choosing something different
  ranked.screen('home');
  ranked.screen('ranked');
  check('but going home forgets them', ranked.resume() === null);

  say('\n' + passed + ' passed, ' + failed + ' failed\n');
  if (typeof process !== 'undefined') process.exit(failed ? 1 : 0);
}, ranked.pause + 300);

say('\nThe searching state is actually painted');

/* The gap that let a broken button through once already: every check above
   asks what the script does, and none of them asks what the stylesheet says.
   A class landing on an element proves nothing if a rule with more weight is
   painting over it, so the cascade is read here the way a browser would.  */
var STYLE = grab(/<style>[\s\S]*?<\/style>/, 'the stylesheet');
var CSS = STYLE.replace(/\/\*[\s\S]*?\*\//g, '');

/** Every rule for one selector, with what encloses it and what it declares. */
function rulesFor(needle){
  var out = [], re = /([^{}]+)\{([^{}]*)\}/g, m;
  while ((m = re.exec(CSS))){
    if (m[1].indexOf(needle) !== -1){
      var before = CSS.slice(0, m.index);
      var opened = (before.match(/\{/g) || []).length - (before.match(/\}/g) || []).length;
      out.push({ sel:m[1].trim().replace(/\s+/g, ' '), body:m[2], nested:opened > 0,
                 media:opened > 0 ? (before.match(/@media[^{]*\{(?![\s\S]*@media)/) || [''])[0].trim() : '' });
    }
  }
  return out;
}

var hunt = rulesFor('#btnRankStart.searching');
var plain = hunt.filter(function(r){ return !r.nested && r.sel.indexOf(':hover') === -1; });
check('the ranked Start Game button has a searching rule of its own', plain.length === 1,
      '(' + hunt.length + ' rules, ' + plain.length + ' unconditional)');
var body = plain.length ? plain[0].body : '';
check('and it is at the top level, not inside a media query',
      plain.length === 1 && !plain[0].nested);
check('it animates', /animation\s*:\s*[a-z]/i.test(body), body.slice(0, 60));
check('with keyframes that exist',
      /@keyframes\s+rankhunt/.test(CSS) &&
      CSS.indexOf((body.match(/animation\s*:\s*([a-z-]+)/i) || [])[1]) !== -1);
/* The `background` shorthand resets background-size and background-position to
   auto. A rule that animates background-position and sets its size through the
   shorthand is one stray declaration away from sitting perfectly still. */
check('and sets its background in longhands, never the shorthand',
      /background-image\s*:/.test(body) && /background-size\s*:/.test(body) &&
      !/(^|;)\s*background\s*:/.test(body), body.slice(0, 80));
check('it outranks the rules that also paint this button',
      /#btnRankStart/.test(plain.length ? plain[0].sel : ''), plain.length ? plain[0].sel : '');

/* Whatever happens to ranked, the host form's own sweep is not ours to touch. */
var friendly = rulesFor('.start-btn.searching');
check('the friendly host button keeps its own sweep', friendly.length >= 1);
check('and no ranked selector was bolted onto it',
      !friendly.some(function(r){ return /rank-start/.test(r.sel); }),
      friendly.map(function(r){ return r.sel; }).join(' | '));

/* The centred box is for failures and challenges. It must not be raised by the
   ranked search, including by the server's own reply to joining the queue. */
var waitingArm = grab(/case 'waiting':[\s\S]*?break;/, "the 'waiting' message arm");
check('the queued reply cannot raise the centred box over a sweeping button',
      /!searching/.test(waitingArm), waitingArm.replace(/\s+/g, ' ').slice(0, 90));
check('and startRanked never opens it',
      !/showWaiting/.test(fn('startRanked')));
check('nor does the ranked New Game path', !/showWaiting/.test(fn('rankedAgain')));

say('\nThe page that no longer exists');

check('no screen is called screen-opponent', SRC.indexOf('screen-opponent') === -1);
check('nothing navigates to it', SRC.indexOf("showScreen('opponent')") === -1);
check('and its grid is gone with it', SRC.indexOf('oppGrid') === -1);

say('\nLeaving the game screen is what withdraws a rematch');
check('showScreen calls remLeave on the way out',
      /if \(name !== 'game'\) remLeave\(\);/.test(fn('showScreen')));
check('and restores the ranked settings New Game came back with',
      /if \(rankResume\) applyRankSettings\(rankResume\);/.test(fn('showScreen')));
// the count is printed once the ranked page's own timer has run
