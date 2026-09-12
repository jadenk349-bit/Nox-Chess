/* A friend challenge with two seats set differently — the page's half, with
 * no server.
 *
 * test_two_clients.py proves the server turns the four settings round for
 * each player. This is what the page does on its own: what the challenge
 * form insists on before Challenge lights up, what it puts on the wire, how
 * the two starting clocks are seeded from what `start` says, and how the
 * two boxes — the invitation and a rematch — word two seats. The rule the
 * whole thing rests on is that the settings belong to the *player* and go
 * to whichever colour they are given, so every check here is asked twice:
 * with the player on White, and with them on Black.
 *
 * Like the other suites it reads the code under test out of blind-chess.html
 * by name, so renaming what it extracts breaks it on purpose.
 *
 *   node server/test_challenge_flow.js
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
var decl = function(n){
  var block = SRC.match(new RegExp('\\n(?:const|let) ' + n + '\\s*=\\s*[\\{\\[][\\s\\S]*?\\n[\\}\\]];'));
  if (block) return block[0];
  return grab(new RegExp('\\n(?:const|let) ' + n + '\\b[^\\n]*?;'), n);
};
/** A one-line declaration, for names whose value fits on the line they open. */
var line = function(n){
  return grab(new RegExp('\\n(?:const|let) ' + n + '\\s*=[^\\n]*?;'), n);
};
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

var DOM = [
  'function classSet(){',
  '  var have = {};',
  '  return { add:function(c){ have[c] = true; }, remove:function(c){ delete have[c]; },',
  '           toggle:function(c, on){ if (on) have[c] = true; else delete have[c]; },',
  '           contains:function(c){ return !!have[c]; } };',
  '}',
  'function fakeEl(){ return { textContent:"", style:{}, dataset:{}, classList:classSet(), onclick:null,',
  '  scrollIntoView:function(){}, offsetWidth:1 }; }',
  'var elements = {};',
  'var document = { getElementById:function(id){ return elements[id] || (elements[id] = fakeEl()); },',
  '  querySelectorAll:function(){ return []; } };',
  'var chalOverlay = document.getElementById("chalOverlay");'
].join('\n');

var STUB = [
  'var W = "w", B = "b";',
  'var MODE_NAME = { blind:"Board Only", total:"Complete Blindfold", fog:"Fog of War", sighted:"Sighted" };',
  'var timeLabel = function(m, inc){ return inc ? m + "+" + inc : m + " min"; };',
  'var SENT = [], CALLED = [];',
  'var screenName = "game", account = { id:"me", name:"Jaden" };',
  'var PZ = { setup:false }, NET = { state:"idle" };',
  'var G = { mode:"blind", minutes:10, inc:0, human:"w", opponent:"online", started:false,',
  '          matchKind:"friendly", hosting:false, theirMode:null, theirMinutes:null };',
  'function netSend(o){ SENT.push(o); }',
  'function netConnect(ready){ CALLED.push("netConnect"); ready(); }',
  'function note(n){ return function(){ CALLED.push(n); }; }',
  'var beep = note("beep"), showWaiting = note("showWaiting"), logLine = note("logLine");',
  'var hideChallenge = note("hideChallenge"), challengeRefused = note("challengeRefused");',
  'var lsnFirstNoteClear = note("lsnFirstNoteClear"), syncOptions = note("syncOptions");',
  'var render = note("render");',
  // the real one is three minutes long; nothing here waits on it
  'var setTimeout = function(){ return 0; }, clearTimeout = function(){};',
  'function LOCAL(){ return G.opponent === "local"; }',
  'function ONLINE(){ return G.opponent === "online"; }',
  'function BOT(){ return G.opponent === "bot"; }',
  'function HOSTING(){ return ONLINE() && G.hosting; }'
].join('\n');

var CODE = [
  decl('CHAL'), decl('CHALLENGE_TTL'), decl('CHALLENGING'),
  line('picked'), decl('chosen'), line('flagged'),
  fn('startingClocks'), fn('seatTermsText'),
  fn('resetChoices'), fn('pickFriendMode'), fn('pickFriendTime'),
  fn('optionsAnswered'), fn('unanswered'),
  fn('sendChallenge'), fn('showChallenge'),
  handler('chalAccept')
].join('\n');

function fresh(){
  return new Function(
    DOM + '\n' + STUB + '\n' + CODE + '\n' +
    'return { G:G, CHAL:CHAL, chosen:chosen, picked:picked, SENT:SENT, CALLED:CALLED, elements:elements,' +
    '  startingClocks:startingClocks, seatTermsText:seatTermsText, resetChoices:resetChoices,' +
    '  pickFriendMode:pickFriendMode, pickFriendTime:pickFriendTime, unanswered:unanswered,' +
    '  optionsAnswered:optionsAnswered, sendChallenge:sendChallenge, showChallenge:showChallenge,' +
    '  press:function(id){ elements[id].onclick(); } };'
  )();
}
function lastSent(p){ return p.SENT.length ? p.SENT[p.SENT.length - 1] : null; }
var MIN = 60000;

/* ---- the two clocks ---- */

say('\nHow the two clocks are seeded');
var p = fresh();
p.G.opponent = 'bot'; p.G.minutes = 10; p.G.started = true; p.G.theirMinutes = 15;
check('a bot game gives both sides the one number, whatever theirMinutes says',
      JSON.stringify(p.startingClocks()) === JSON.stringify({ w:10*MIN, b:10*MIN }), JSON.stringify(p.startingClocks()));
p.G.opponent = 'local';
check('so does the hot seat', JSON.stringify(p.startingClocks()) === JSON.stringify({ w:10*MIN, b:10*MIN }));
p.G.opponent = 'online'; p.G.theirMinutes = null;
check('and an online game whose start named no other clock',
      JSON.stringify(p.startingClocks()) === JSON.stringify({ w:10*MIN, b:10*MIN }));
p.G.theirMinutes = 3; p.G.started = false;
check('the preview board beside a form is not yet a game and seeds one number',
      JSON.stringify(p.startingClocks()) === JSON.stringify({ w:10*MIN, b:10*MIN }));
p.G.started = true; p.G.human = 'w';
check('once started, ours goes on our colour and theirs on the other — White',
      JSON.stringify(p.startingClocks()) === JSON.stringify({ w:10*MIN, b:3*MIN }), JSON.stringify(p.startingClocks()));
p.G.human = 'b';
check('...and the same two numbers swap seats when we are Black',
      JSON.stringify(p.startingClocks()) === JSON.stringify({ w:3*MIN, b:10*MIN }), JSON.stringify(p.startingClocks()));
p.G.human = 'r';
check('an unsettled colour cannot seat two clocks and falls back to one',
      JSON.stringify(p.startingClocks()) === JSON.stringify({ w:10*MIN, b:10*MIN }));
p.G.human = 'w'; p.G.theirMinutes = 10;
check('equal minutes come out equal', JSON.stringify(p.startingClocks()) === JSON.stringify({ w:10*MIN, b:10*MIN }));

/* ---- the words ---- */

say('\nTwo seats in one line');
p = fresh();
check('one seat when both are the same',
      p.seatTermsText({ mode:'fog', minutes:5, inc:0, opponentMode:'fog', opponentMinutes:5 }, 'Alex') === 'Fog of War · 5 min');
check('and when the far side is not named at all',
      p.seatTermsText({ mode:'fog', minutes:5, inc:0 }, 'Alex') === 'Fog of War · 5 min');
check('both when they differ, ours first',
      p.seatTermsText({ mode:'sighted', minutes:10, inc:0, opponentMode:'total', opponentMinutes:3 }, 'Alex')
        === 'Sighted · 10 min; Alex plays Complete Blindfold · 3 min',
      p.seatTermsText({ mode:'sighted', minutes:10, inc:0, opponentMode:'total', opponentMinutes:3 }, 'Alex'));
check('a clock alone is a difference',
      p.seatTermsText({ mode:'blind', minutes:1, inc:0, opponentMode:'blind', opponentMinutes:30 }, 'Alex')
        === 'Board Only · 1 min; Alex plays Board Only · 30 min');
check('the increment is the game\'s and is said of both',
      p.seatTermsText({ mode:'blind', minutes:3, inc:2, opponentMode:'fog', opponentMinutes:5 }, 'Alex')
        === 'Board Only · 3+2; Alex plays Fog of War · 5+2');

say('\nThe invitation box');
p = fresh();
p.showChallenge({ id:'c1', fromName:'Jaden', mode:'sighted', minutes:15, inc:0, color:'b',
                  opponentMode:'total', opponentMinutes:5 });
check('is up', p.elements.chalOverlay.classList.contains('show'));
check('names the challenger', p.elements.chalTitle.textContent === 'Jaden challenged you', p.elements.chalTitle.textContent);
check('and says what you would play, and what they would',
      p.elements.chalText.textContent === 'You play Black — Sighted · 15 min; Jaden plays Complete Blindfold · 5 min.',
      p.elements.chalText.textContent);
p.showChallenge({ id:'c2', fromName:'Jaden', mode:'fog', minutes:5, inc:0, color:'w' });
check('an old-shape invitation with one set of terms still reads as one',
      p.elements.chalText.textContent === 'You play White — Fog of War · 5 min.', p.elements.chalText.textContent);
p.press('chalAccept');
check('Accept answers by id', lastSent(p).t === 'challenge-accept' && lastSent(p).id === 'c2', JSON.stringify(lastSent(p)));
check('and the game about to arrive is a friendly online one',
      p.G.opponent === 'online' && p.G.matchKind === 'friendly' && p.CHAL.to === null);

/* ---- the form ---- */

say('\nWhat the form insists on');
p = fresh();
p.CHAL.to = { id:'alex', name:'Alex' };
p.resetChoices();
check('a fresh challenge form has no friend\'s answers',
      p.CHAL.mode === null && p.CHAL.minutes === null && !p.chosen.oppMode && !p.chosen.oppMinutes);
check('and nothing carried over from the last game\'s far side',
      p.G.theirMode === null && p.G.theirMinutes === null);
check('every panel is unanswered', p.unanswered().join(',') === 'secYouPlay,secVision,secTime', p.unanswered().join(','));
p.picked.mode = true; p.chosen.minutes = true; p.chosen.side = true;
check('our own three answers are not enough for a challenge',
      p.unanswered().join(',') === 'secVision,secTime' && !p.optionsAnswered(), p.unanswered().join(','));
p.pickFriendMode('sighted');
check('the friend\'s vision clears the vision panel', p.unanswered().join(',') === 'secTime' && p.CHAL.mode === 'sighted');
check('and writes CHAL, never G', p.G.mode === 'blind');
p.pickFriendTime(15);
check('the friend\'s clock clears the last one', p.unanswered().length === 0 && p.optionsAnswered() && p.CHAL.minutes === 15);
check('and leaves ours alone', p.G.minutes === 10);
p.CHAL.to = null;
check('the same three answers are enough for anything that is not a challenge',
      p.unanswered().length === 0 && p.optionsAnswered());

say('\nWhat Challenge sends');
p = fresh();
p.CHAL.to = { id:'alex', name:'Alex' };
p.G.mode = 'total'; p.G.minutes = 3; p.G.inc = 0; p.G.human = 'w';
p.pickFriendMode('sighted'); p.pickFriendTime(10);
p.sendChallenge();
var m = lastSent(p);
check('a challenge goes out', m && m.t === 'challenge' && m.to === 'alex', JSON.stringify(m));
check('with our seat under the plain names', m.mode === 'total' && m.minutes === 3 && m.color === 'w');
check('and the friend\'s as the opponent\'s', m.opponentMode === 'sighted' && m.opponentMinutes === 10, JSON.stringify(m));
check('it is marked pending and the board waits', p.CHAL.pending && p.CALLED.indexOf('showWaiting') !== -1);
p = fresh();
p.CHAL.to = { id:'alex', name:'Alex' };
p.G.mode = 'fog'; p.G.minutes = 5; p.G.human = 'b';
p.sendChallenge();
m = lastSent(p);
check('with no friend\'s answers it sends our own for both — the one shared game a challenge used to be',
      m.opponentMode === 'fog' && m.opponentMinutes === 5 && m.color === 'b', JSON.stringify(m));
p = fresh();
p.CHAL.to = { id:'alex', name:'Alex' };
p.G.human = 'r';
p.sendChallenge();
m = lastSent(p);
check('"either colour" is settled before it is offered', m.color === 'w' || m.color === 'b', m.color);

say('\n' + passed + ' passed, ' + failed + ' failed\n');
if (typeof process !== 'undefined') process.exit(failed ? 1 : 0);
