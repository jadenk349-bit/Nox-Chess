/* Running a practice drill, without a browser.
 *
 * test_practice.js checks what the drills invent — that the positions are
 * positions and the answers are true of them. This one runs the screen: the
 * functions the page calls when somebody presses Start, presses Ready, clicks
 * a square, types a move. The DOM is a stub thin enough to fit in this file
 * and real enough that a square really carries classes and a piece really
 * moves, because a typo in an element name is exactly the kind of thing that
 * only shows up when the screen is opened.
 *
 * The clock is a stub too, and on purpose: a study countdown and an animated
 * reveal both run on setTimeout, and a suite that waited for them in real time
 * would take a minute to say nothing. Driving the clock by hand also lets it
 * check the thing that actually matters about those timers — that walking off
 * the page stops every one of them.
 *
 * The whole PRACTICE section is read out of blind-chess.html as one block, so
 * this runs the page's code and not a copy of it.
 *
 *   node server/test_practice_flow.js
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
function balanced(s){
  var depth = 0, quote = null;
  for (var i = 0; i < s.length; i++){
    var c = s[i];
    if (quote){ if (c === '\\') i++; else if (c === quote) quote = null; continue; }
    if (c === "'" || c === '"' || c === '`'){ quote = c; continue; }
    if (c === '{' || c === '[' || c === '(') depth++;
    if (c === '}' || c === ']' || c === ')') depth--;
  }
  return depth === 0;
}
var decl = function(n){
  var line = SRC.match(new RegExp('\\n(?:const|let) ' + n + '\\b[^\\n]*;'));
  if (line && balanced(line[0])) return line[0];
  var block = SRC.match(new RegExp('\\n(?:const|let) ' + n + '\\s*=\\s*[\\{\\[][\\s\\S]*?\\n[\\}\\]];'));
  if (block) return block[0];
  return grab(new RegExp('\\n(?:const|let) ' + n + '\\b[^\\n]*?;'), n);
};

/* ============================================================
   The stub half
   ============================================================ */

/* ---- a clock that only moves when this file moves it ----
   Two independent clocks live in this suite: `clockNow` paces setTimeout, so
   ticking it is how a study countdown or an auto-advance is made to fire.
   `prNowFake` is the session clock a drill's budget is measured against —
   left alone it never moves, so a session stays fresh across any number of
   ticks, and a test ends one on purpose by assigning it forward past
   PR.startedAt + PR.budgetMs (prNow() is reassigned to read it below, once
   the PRACTICE section has been evaluated). */
var clockNow = 0, timerId = 0, pending = [];
var prNowFake = 0;
// prTouchDay reads `new Date()` for the calendar date, not just the clock, so
// the stub has to still be a real Date underneath — a constructor that
// explicitly returns an object hands `new` that object instead of `this`.
// globalThis.Date is read rather than plain `Date`, because a same-named
// function declaration below is hoisted ahead of everything in this scope
// and would otherwise shadow itself.
var RealDate = globalThis.Date;
function Date(ms){ return new RealDate(ms === undefined ? clockNow : ms); }
Date.now = function(){ return clockNow; };
function setTimeout(fn, ms){
  var id = ++timerId;
  pending.push({ id: id, at: clockNow + (ms || 0), fn: fn });
  return id;
}
function clearTimeout(id){
  pending = pending.filter(function(t){ return t.id !== id; });
}
/** Run every timer due in the next `ms`, in the order they come due. */
function tick(ms){
  var end = clockNow + ms, guard = 0;
  for (;;){
    var due = pending.filter(function(t){ return t.at <= end; })
                     .sort(function(a, b){ return a.at - b.at; });
    if (!due.length || ++guard > 500) break;
    var t = due[0];
    pending = pending.filter(function(x){ return x.id !== t.id; });
    clockNow = Math.max(clockNow, t.at);
    t.fn();
  }
  clockNow = end;
}

/* ---- a DOM with real classes, real datasets and real children ---- */
function El(tag){
  this.tag = tag || 'div';
  this.children = [];
  this.style = {};
  this.dataset = {};
  this.value = '';
  this.textContent = '';
  this.disabled = false;
  this.onclick = null;
  this.parent = null;
  this._html = '';
  this._classes = {};
  this._on = {};
  var self = this;
  this.classList = {
    add: function(){ for (var i = 0; i < arguments.length; i++) self._classes[arguments[i]] = 1; },
    remove: function(){ for (var i = 0; i < arguments.length; i++) delete self._classes[arguments[i]]; },
    toggle: function(c, on){
      if (on === undefined) on = !self._classes[c];
      if (on) self._classes[c] = 1; else delete self._classes[c];
      return !!on;
    },
    contains: function(c){ return !!self._classes[c]; }
  };
}
Object.defineProperty(El.prototype, 'className', {
  get: function(){ return Object.keys(this._classes).join(' '); },
  set: function(v){
    this._classes = {};
    var self = this;
    String(v).split(/\s+/).forEach(function(c){ if (c) self._classes[c] = 1; });
  }
});
Object.defineProperty(El.prototype, 'innerHTML', {
  get: function(){ return this._html; },
  set: function(v){
    this._html = String(v);
    this.children = [];
    // enough parsing for `<span></span>`, which is how a piece gets its glyph
    var m = /^<([a-z]+)/i.exec(this._html);
    if (m){ var kid = new El(m[1]); kid.parent = this; this.children.push(kid); }
  }
});
Object.defineProperty(El.prototype, 'firstChild', {
  get: function(){ return this.children[0] || null; }
});
El.prototype.appendChild = function(kid){ kid.parent = this; this.children.push(kid); return kid; };
El.prototype.remove = function(){
  if (!this.parent) return;
  var at = this.parent.children.indexOf(this);
  if (at >= 0) this.parent.children.splice(at, 1);
  this.parent = null;
};
El.prototype.addEventListener = function(name, fn){ (this._on[name] = this._on[name] || []).push(fn); };
El.prototype.fire = function(name, ev){
  (this._on[name] || []).forEach(function(f){ f(ev || { preventDefault: function(){} }); });
};
El.prototype.focus = function(){};
El.prototype.select = function(){};
El.prototype.scrollIntoView = function(){};
El.prototype.querySelector = function(){ return null; };
El.prototype.querySelectorAll = function(){ return []; };

var byId = {};
var bySelector = {};
var document = {
  getElementById: function(id){ return byId[id] || (byId[id] = new El('div')); },
  createElement: function(tag){ return new El(tag); },
  querySelector: function(){ return null; },
  querySelectorAll: function(sel){ return bySelector[sel] || []; }
};
// the three session-length buttons, which the practice code wires up by selector
bySelector['#prSetLen button'] = [2, 5, 10].map(function(n){
  var b = new El('button');
  b.dataset.min = String(n);
  return b;
});

var storage = {};
var localStorage = {
  getItem: function(k){ return Object.prototype.hasOwnProperty.call(storage, k) ? storage[k] : null; },
  setItem: function(k, v){ storage[k] = String(v); },
  removeItem: function(k){ delete storage[k]; }
};

var account = null;
var beeps = 0, screens = [], botTrips = 0, visionsPicked = [];
function beep(){ beeps++; }
function showScreen(n){ screens.push(n); }
// The course is the other side of the section boundary, and Back to Lessons
// presses its front door — the same lsnEnter() LESSON → How to Play presses.
// Stubbed as the screen it shows, so the assertion below reads like the rest.
function lsnEnter(){ screens.push('lessons'); }
function navSync(){}                       // the history layer lives outside the section
function goBot(){ botTrips++; }
function selectMode(m){ visionsPicked.push(m); }
// prSuggestFirstBlindGame lives in the SCREENS section, outside the PRACTICE
// block this suite lifts — it picks the bot's rung and clock through that
// screen's own setters, which this harness has none of, so it is stubbed
// exactly as goBot and selectMode are: the two handoffs it rides along with
// are what this suite checks, not what it itself does to the DOM.
function prSuggestFirstBlindGame(){}
// lsnDone() lives in the LESSONS section, outside the block this suite lifts;
// prStartLevel asks it by name (guarded by typeof, since a page with no
// LESSONS section loaded — this one — must not throw), so it is faked here.
var lsnDoneStub = [];
function lsnDone(){ return lsnDoneStub; }

/* ---- the real half ---- */
var DECLS = ['VAL','FILES','rowOf','colOf','SQNAME','uciOf','sqName','sqIndex','onBoard','other',
             'idCounter','mk','DIR_N','DIR_B','DIR_R','DIR_K','PST','nodes','PIECE_NAME',
             'GLYPH','pieceHTML','OPENING_BOOK','OPENING_LINES','W',
             // prPuzzlePool names it in the URL it fetches — never reached
             // here, since this harness has no fetch at all, but the section
             // is lifted whole and a name it reads has to be in scope
             'PZ_VERSION'];
// Note: this suite lifts the whole PRACTICE section as one block below, so
// PR_VERSION, PR_V1_KEYS, PR_SEEN_MAX, prBlankMode, prUpgradeV1, prSeen,
// prSeenHas, prSeenPush, prSeenKey, prToday and prTouchDay all come along
// with it rather than needing their own DECLS/FNS entries.
var FNS = ['startBoard','newState','cloneState','fenOf','stateFromFEN',
           'slide','step','addPawn','pseudoMoves','isAttacked','kingSq','inCheck',
           'makeMove','legalMoves','toSAN','attackersOf','defendersOf','see',
           'mirror','evaluate','orderMoves','scoreMove','quiesce','negamax','bestMove',
           'parseMoveIn','bookMove','moveFromSAN','openingPosition','rebuildDiff','quadrantOf','lineBetween','linesThrough','knightRoute','sliderReaches'];
var bundle = [grab(/\nconst W = 'w', B = 'b';/, "const W/B")];
// a multi-line string rather than an object, so neither shape of decl() fits it
bundle.push(grab(/\nconst BISHOP_SVG =\n[\s\S]*?';\n/, 'BISHOP_SVG'));
for (var d = 0; d < DECLS.length; d++) if (DECLS[d] !== 'W') bundle.push(decl(DECLS[d]));
for (var f = 0; f < FNS.length; f++) bundle.push(fn(FNS[f]));
// the whole PRACTICE section, top level and all — this is the screen itself
bundle.push(grab(/\n\/\* =+\n   PRACTICE — the drills behind LESSON[\s\S]*?\n(?=\/\* =+\n   SCREENS)/,
                 'the PRACTICE section'));
eval(bundle.join('\n').replace(/(^|\n)(?:const|let) /g, '$1var '));
// prNow() is Date.now() in the page; here it reads the fake clock above, so a
// test ends a session by moving prNowFake past PR.startedAt + PR.budgetMs
// rather than by ticking the setTimeout clock, which paces timers and nothing
// else.
prNow = function(){ return prNowFake; };

/* ============================================================
   The scoreboard
   ============================================================ */
var passed = 0, failed = 0;
function head(t){ say('\n' + t + '\n'); }
function ok(what, got, want){
  var good = arguments.length < 3 ? !!got : (got === want);
  if (good){ passed++; say('  PASS  ' + what + '  ->  ' + got); }
  else { failed++; say('  FAIL  ' + what + '  ->  got ' + got + ', wanted ' + want); }
}

/* ---- driving the screen the way a player does ---- */
function clickSquare(i){
  var d = prSqEls[PR.flipped ? 63 - i : i];
  prSquaresEl.fire('click', { target: { closest: function(){ return d; } } });
}
function ctlButton(label){
  for (var k = 0; k < prCtlEl.children.length; k++)
    if (prCtlEl.children[k].textContent === label) return prCtlEl.children[k];
  return null;
}
function pressCtl(label){
  var b = ctlButton(label);
  if (!b) throw new Error('no control button called ' + label);
  b.onclick();
  return b;
}
function ansButton(html){
  for (var k = 0; k < prAnsEl.children.length; k++)
    if (prAnsEl.children[k].innerHTML === html) return prAnsEl.children[k];
  return null;
}
/** The text box in the answer row, or null — which is also how a test asks
    whether a move can be given at all, since a checkpoint and a recovery both
    take the row away and a peek does not. */
function answerBox(){
  var input = null;
  for (var k = 0; k < prAnsEl.children.length; k++)
    if (prAnsEl.children[k].tag === 'input') input = prAnsEl.children[k];
  return input;
}
function typeAnswer(text){
  var input = answerBox();
  if (!input) throw new Error('no answer box on screen');
  input.value = text;
  prAnsEl.fire('submit');
  return input;
}
function marked(sq, cls){ return prSqEls[PR.flipped ? 63 - sq : sq].classList.contains(cls); }
/** How many men of one colour a board carries — what a vision that draws one
    side and hides the other is asserted against. */
function menOf(b, c){ var n = 0; for (var i = 0; i < 64; i++) if (b[i] && b[i].c === c) n++; return n; }
/** Run every timer that is pending right now, once, oldest first — and do not
    move the clock on past them, which is what `tick` is for. A timer one of
    these starts (Progressive Blindfold's reply schedules nothing, but a
    checkpoint will) waits for the next call rather than running inside this
    one, so a test can step a game a move at a time. */
function fireTimers(){
  var due = pending.slice().sort(function(a, b){ return a.at - b.at; });
  pending = [];
  due.forEach(function(t){ clockNow = Math.max(clockNow, t.at); t.fn(); });
}
/** `min` is the session's length in minutes, matching the setup box's own
    buttons — omitted, it keeps whatever the box was last set to. Sessions are
    time-boxed now, so this no longer names a question count; ending one on
    purpose is `finishSession()`, below. */
function startDrill(key, level, min){
  storageOwner();
  var mode = null;
  for (var k = 0; k < PR_MODES.length; k++) if (PR_MODES[k].key === key) mode = PR_MODES[k];
  prOpenSetup(mode);
  prSetLevel = level;
  if (min) prSetCount = min;
  byId.prSetGo.onclick();
}
/** Spend the whole of a session's budget and let the next judged answer end
    it — the fake session clock (prNowFake) only moves when a test moves it,
    so this is how a test reaches Practice Complete on purpose. */
function finishSession(){
  prNowFake = PR.startedAt + PR.budgetMs + 1000;
}
function storageOwner(){ /* guest throughout; kept as a seam for readability */ }

/* Press Ready and run the study clock out, if this drill has one. */
function pastStudy(){
  if (ctlButton('Ready')) pressCtl('Ready');
  tick(200);
}

/* The right answer to whatever is on screen. */
function answerRight(){
  var q = PR.q;
  if (q.kind === 'square'){ answerSquareRight(q); return; }
  if (q.kind === 'piece'){
    Array.from(q.targets).forEach(clickSquare);
    ansButton('Done').onclick();
    // askCaps puts a second Done in the way, asking which of the (now every)
    // named square is a capture — click the ones that really are, then Done.
    if (q.askCaps){
      Array.from(q.caps).forEach(function(sq){ ansButton(sqName(sq)).onclick(); });
      ansButton('Done').onclick();
    }
    return;
  }
  if (q.kind === 'tracker'){
    // a tracker question is not on screen until the read-out has been sat
    // through, so answering one means pressing Ready and driving the clock
    if (ctlButton('Ready')) pressCtl('Ready');
    trackerRun(q);
    answerAskRight(q.ask);
    return;
  }
  answerAskRight(q.ask);
}
/* Square Trainer's `ask` is a plain string, not one of the {t:...} objects
   answerAskRight reads — five kinds, five ways to give the right answer. */
function answerSquareRight(q){
  if (q.ask === 'find'){ clickSquare(q.sq); return; }
  if (q.ask === 'name'){ typeAnswer(sqName(q.sq)); return; }
  if (q.ask === 'colour'){ ansButton(q.dark ? 'Dark' : 'Light').onclick(); return; }
  if (q.ask === 'neighbour'){ typeAnswer(sqName(q.answer)); return; }
  if (q.ask === 'quadrant'){ ansButton(PR_QUADRANT_NAME[q.answer]).onclick(); return; }
  throw new Error('unknown square question ' + q.ask);
}
/** A Square Trainer question at `level` for which `pred` is true — used where
    the exercise itself, not just the level's difficulty, has to be forced:
    a `neighbour` or `quadrant` question needs `dir`/`answer` derived from the
    square that was drawn, which only prMakeSquare itself does, and a level
    whose `flipped` is a coin flip needs to land heads before a test can rely
    on it. The odds of any predicate here failing every one of five hundred
    draws are astronomically small, so this waits for a match rather than
    building one by hand — deterministic in outcome without duplicating
    prMakeSquare's own logic a second time, badly, just for the tests. */
function forceSquare(level, pred){
  for (var t = 0; t < 500; t++){
    var q = prMakeSquare(prRecipe('square', level));
    if (pred(q)) return q;
  }
  throw new Error('could not force a level ' + level + ' question matching the predicate');
}
/** Put a chosen question on screen the way prNextQuestion() does, minus the
    prMake() call this is standing in for. prNextQuestion is what ordinarily
    clears PR.answered, PR.click, the answer row and every mark before a
    fresh prPresent() — call prPresent() directly without doing the same and
    the *previous* question's buttons are still sitting in prAnsEl, so
    ansButton() can match one of them instead of the one this question just
    built. That is exactly the kind of thing a coin flip turns into an
    occasional, unreproducible failure. */
function presentForced(q){
  PR.answered = false;
  PR.click = null;
  PR.onSubmit = null;
  prAnsClear();
  prCtl([]);
  prMarksClear();
  PR.q = q;
  prPresent();
}
function answerAskRight(ask){
  if (ask.t === 'where'){ clickSquare(ask.sq); return; }
  if (ask.t === 'occupied'){ ansButton(ask.yes ? 'Yes' : 'No').onclick(); return; }
  if (ask.t === 'count'){ ansButton(String(ask.n)).onclick(); return; }
  if (ask.t === 'what'){
    // the buttons are twelve glyphs then "Empty square", in the order the page builds them
    if (!ask.type){ ansButton('Empty square').onclick(); return; }
    var order = ['K','Q','R','B','N','P'];
    var at = (ask.colour === 'w' ? 0 : 6) + order.indexOf(ask.type);
    prAnsEl.children[at].onclick();
    return;
  }
  if (ask.t === 'rebuild'){
    // one glyph, then one square, per man named — the same palette order
    // PR_PALETTE builds ([W,B] x K,Q,R,B,N,P) — then Done judges the lot.
    var order = ['K','Q','R','B','N','P'];
    for (var k = 0; k < ask.want.length; k++){
      var w = ask.want[k];
      var at = (w.colour === 'w' ? 0 : 6) + order.indexOf(w.type);
      prAnsEl.children[at].onclick();
      clickSquare(w.sq);
    }
    pressCtl('Done');
    return;
  }
  throw new Error('unknown question type ' + ask.t);
}
/** A guaranteed-wrong answer to a `what` ask — used where a test needs to
    force a miss rather than assert one, which every ask this drill puts up
    is: "Empty square" is never the truth when a man is named, and the
    White king is never the truth when the square is bare (Branches, whose
    `ask` and `rootAsk` are both prAskShow's own `what`). */
function answerAskWrong(ask){
  if (ask.t !== 'what') throw new Error('no wrong-answer form for ask type ' + ask.t);
  if (ask.type){ ansButton('Empty square').onclick(); return; }
  prAnsEl.children[0].onclick();
}
/* ---- Progressive Blindfold's checkpoints ----
   A checkpoint is not one of the session's questions, so it is not answered
   through answerAskRight above: it writes its own buttons and keeps its own
   tally. `pb.check` is the ask itself, stored by pbCheckpoint exactly so a
   test can hold one or miss one on purpose rather than guessing at a glyph
   and hoping. Four shapes, since the checkpoint adds `last` and its own
   whole-side `count` to the two prAskFine hands back. */
function pbAnswerRight(ask){
  if (ask.t === 'where'){ clickSquare(ask.sq); return; }
  if (ask.t === 'count'){ ansButton(String(ask.n)).onclick(); return; }
  if (ask.t === 'last'){ ansButton(ask.truth).onclick(); return; }
  if (!ask.type){ ansButton('Empty square').onclick(); return; }
  var order = ['K','Q','R','B','N','P'];
  prAnsEl.children[(ask.colour === 'w' ? 0 : 6) + order.indexOf(ask.type)].onclick();
}
/** An answer that cannot be right — or null when the ask has none to give (a
    `last` question in a position with one legal move offers one button, and it
    is the truth). Returned as a thunk rather than pressed, so a test can ask
    whether this deal is one it can miss on before it commits to it. */
function pbWrongAnswer(ask){
  if (ask.t === 'where') return function(){ clickSquare(elsewhere(ask.sq)); };
  if (ask.t === 'count') return function(){ ansButton(String(ask.n === 0 ? 1 : 0)).onclick(); };
  if (ask.t === 'last'){
    for (var k = 0; k < prAnsEl.children.length; k++){
      var b = prAnsEl.children[k];
      if (b.innerHTML !== ask.truth) return (function(btn){ return function(){ btn.onclick(); }; })(b);
    }
    return null;
  }
  // a `what` ask: the twelve glyphs are [W,B] x K,Q,R,B,N,P, so any glyph of
  // the other colour is wrong — and White's king is wrong when the truth is
  // that the square is empty
  var at = ask.colour === W ? 6 : 0;
  return function(){ prAnsEl.children[at].onclick(); };
}
/** A square that is definitely not the answer. */
function elsewhere(not){
  for (var i = 0; i < 64; i++) if (i !== not) return i;
  return 0;
}
/** A Hold the Position question at `level` for which `pred` is true — the
    mode a level draws is a coin flip among the ladder's own list (`modes`),
    and which of Fine's kinds a `question` asks is a shuffle on top of that,
    so a test that needs a particular shape (a `where` to click, a `change`
    to catch) waits for one rather than reaching into prMakeHold's own dice.
    Mirrors forceSquare above for the same reason. */
function forceHold(level, pred){
  for (var t = 0; t < 500; t++){
    var q = prMakeHold(prRecipe('hold', level));
    if (q && pred(q)) return q;
  }
  throw new Error('could not force a level ' + level + ' hold question matching the predicate');
}

/* ============================================================
   1 — the dashboard
   ============================================================ */
head('The dashboard');

(function(){
  storage = {};
  prShowDash();
  ok('the drill list opens', byId.prRun.style.display, 'none');
  ok('and the dashboard is what is showing', byId.prDash.style.display, '');
  ok('six groups on the dashboard', byId.prCards.children.length, 6);
  ok('with nothing to report yet', byId.prFigAcc.textContent, '—');
  ok('no answers yet', byId.prFigAsked.textContent, 0);
  ok('no streak yet', byId.prFigDays.textContent, 0);

  // every drill's Start button always works — a tag is a hint about where
  // to spend the next few minutes, never a lock (the old five-rung ladder
  // that used to hold the mini challenge back is long gone)
  var groups = byId.prCards.children;
  var board = groups[0];
  ok('the first group is named', board.children[0].textContent, 'The Board');
  var boardCards = board.children[1].children;
  var square = boardCards[0];
  ok('the square drill names itself', square.children[0].innerHTML, 'Square Trainer');
  ok('and opens on level one', square.children[3].innerHTML, 'Level 1 · ' + PR_SQUARE_LEVELS[0].cap);
  var squareFoot = square.children[2];
  ok('nothing is ahead of the first group', squareFoot.children.length, 1);
  // Start and Quick (Task 24) sit together in one actions strip, which is
  // the foot's only child once there is no tag ahead of it.
  var squareActions = squareFoot.children[0];
  ok('and its button starts it', squareActions.children[0].textContent, 'Start');
  ok('with Quick beside it for a two-minute go', squareActions.children[1].textContent, 'Quick');

  var play = groups[groups.length - 1];
  ok('the last group is Blindfold Play', play.children[0].textContent, 'Blindfold Play');
  ok('and it holds one card', play.children[1].children.length, 1);
  var progressive = play.children[1].children[0];
  var progFoot = progressive.children[2];
  ok('it is tagged as ahead of where the player stands', progFoot.children.length, 2);
  ok('the tag says so', progFoot.children[0].textContent, 'Ahead of you');
  ok('and Start still works even this far out', progFoot.children[1].children[0].textContent, 'Start');
})();

(function(){
  // Quick is the express lane: no setup box, straight into the drill at
  // wherever prStartLevel already says it should open, on a two-minute clock.
  storage = {};
  prShowDash();
  var square = byId.prCards.children[0].children[1].children[0];
  var quick = square.children[2].children[0].children[1];
  ok('the Quick button is labelled', quick.textContent, 'Quick');
  quick.onclick();
  ok('it starts the drill directly, with no setup box', byId.prSetOverlay.classList.contains('show'), false);
  ok('a run is in progress', PR.view, 'run');
  ok('on the mode Quick was pressed for', PR.mode.key, 'square');
  ok('at the level prStartLevel names', PR.level, prStartLevel('square'));
  ok('on a two-minute clock', PR.budgetMs, 120000);
})();

head('Readiness');

(function(){
  storage = {};
  ok('a fresh player is not automatic yet', prAutomatic(prLoad()), false);
  var st = prLoad(); st.modes.square.level = 6; st.modes.square.stats.lat = [900, 1000, 1100]; prSave(st);
  ok('the Board group is automatic', prAutomatic(prLoad()), true);
  var r = prReadiness(prLoad());
  ok('six groups on the readiness line', r.groups.length, 6);
  ok('no milestone yet', r.milestone, null);
  // Board is automatic, so the walk moves straight into Piece Vision — Attack
  // Vision's own ladder is one rung longer than Piece Vision's, so at level 1
  // apiece it is the weaker fraction and the one recommended
  ok('the walk moves on to the next group once Board is automatic', r.next && r.next.key, 'attack');
  prShowDash();
  ok('cards are grouped', byId.prCards.children.length, 6);
  ok('and Board no longer reads Ahead of you for the next group',
     byId.prCards.children[1].children[1].children[0].children[2].children.length, 1);
})();

(function(){
  /* The multi-hop case prGroupOpen exists for. Square Trainer and Lines &
     Routes are untouched — Board has cleared nothing, automatic or
     otherwise — but Piece Vision has moved well off level 1. Reading only
     the group immediately before Holding (i.e. Piece Vision) would call
     Holding open, since Piece Vision's own drills are past level 2; asking
     every earlier group, as prGroupOpen now does, still finds Board
     unopened two hops back and keeps Holding marked Ahead of you. */
  storage = {};
  var st = prLoad();
  st.modes.piece.level = 5; st.modes.attack.level = 5;
  prSave(st);
  prShowDash();
  var holding = byId.prCards.children[2];
  ok('the third group is Holding', holding.children[0].textContent, 'Holding');
  var holdFoot = holding.children[1].children[0].children[2];
  ok('it still reads Ahead of you two groups past the group that never opened',
     holdFoot.children[0].textContent, 'Ahead of you');
})();

(function(){
  // the mean of a group's own levels, each read as a fraction of its own
  // ladder rather than the raw rung, so a two-rung drill and a twelve-rung
  // one contribute the same way to the group they share
  storage = {};
  var st = prLoad();
  st.modes.square.level = 4;   // 4 of PR_SQUARE_LEVELS.length
  st.modes.lines.level = 2;    // 2 of PR_LINES_LEVELS.length
  prSave(st);
  var want = (4 / PR_SQUARE_LEVELS.length + 2 / PR_LINES_LEVELS.length) / 2;
  ok('a group\'s level is the mean of its modes\' own fractions',
     Math.abs(prGroupLevel(prLoad(), PR_GROUPS[0]) - want) < 1e-9, true);
})();

(function(){
  // the three gates a whole blindfold game actually asks for at once
  storage = {};
  var st = prLoad();
  st.modes.tracker.level = 9; st.modes.hold.level = 7; st.modes.calc.level = 5;
  st.modes.progressive.stats.pb = { 5: { pass: true } };
  prSave(st);
  ok('the milestone fires once all three gates and the pass are met',
     prReadiness(prLoad()).milestone, 'first blind game');

  st.modes.progressive.stats.pb[5].pass = false;
  prSave(st);
  ok('and not while the fifth Progressive level is still unheld',
     prReadiness(prLoad()).milestone, null);
})();

/* ============================================================
   2 — the square trainer, start to finish
   The dashboard flow at level 1 answers whatever comes up — find or name —
   rather than steering toward one, so it does not care which the level's
   own coin flip drew; everything that has to prove a *particular* kind of
   question is forced with prMakeSquare + prRecipe directly (PR.q set, then
   prPresent()), the way this suite drives every other question that a coin
   flip would otherwise make an occasional, flaky failure of.
   ============================================================ */
head('Square Trainer');

(function(){
  storage = {};
  startDrill('square', 1, 5);
  ok('the drill screen is up', byId.prRun.style.display, '');
  ok('and the dashboard is put away', byId.prDash.style.display, 'none');
  ok('the panel names the skill', byId.prSkill.textContent, 'Squares');
  ok('the board is shown', byId.prFrame.style.display, '');
  ok('the level line reads back', byId.prStatQCap.textContent, 'Level 1');
  ok('the orientation is spelled out', /White's view/.test(byId.prOrient.textContent), true);

  for (var asked = 1; asked <= 5; asked++){
    answerRight();
    ok('answer ' + asked + ' was marked right', /right/.test(byId.prSay.className), true);
    tick(1000);                       // a right answer moves on by itself
  }

  finishSession();
  answerRight();
  ok('once the budget is spent, the button says Finish', ctlButton('Finish') !== null, true);
  tick(1000);                         // a right answer still moves on by itself
  ok('and the session finished', byId.prDoneOverlay.classList.contains('show'), true);
  ok('with the title it promises', byId.prDoneTitle.textContent, 'Practice Complete');
  ok('accuracy on the result card', /6 \/ 6/.test(byId.prDoneRows.children[0].innerHTML), true);
  ok('best streak too', /<b>6<\/b>/.test(byId.prDoneRows.children[1].innerHTML), true);
  ok('and the skill it practised', /Squares/.test(byId.prDoneRows.children[2].innerHTML), true);
  ok('the dashboard behind it shows what was answered', byId.prFigAsked.textContent, 6);
  ok('and 100% accuracy', byId.prFigAcc.textContent, '100%');
  ok('and a day of it counted toward the streak', byId.prFigDays.textContent, 1);
})();

(function(){
  // find: a wrong click, then the right one
  storage = {};
  startDrill('square', 1, 5);
  var q = forceSquare(1, function(q){ return q.ask === 'find'; });
  presentForced(q);
  var wrong = elsewhere(q.sq);
  clickSquare(wrong);
  ok('clicking the wrong square is marked wrong', /wrong/.test(byId.prSay.className), true);
  ok('and the right one is shown in green', marked(q.sq, 'pr-right'), true);
  ok('the wrong one in red', marked(wrong, 'pr-wrong'), true);
  ok('the answer names the square that was wanted',
     byId.prSay.innerHTML.indexOf(sqName(q.sq)) >= 0, true);
  ok('a wrong answer waits to be read rather than moving on', ctlButton('Next') !== null, true);
  ok('and the streak went back to nothing', PR.streak, 0);
  pressCtl('Next');

  q = forceSquare(1, function(q){ return q.ask === 'find'; });
  presentForced(q);
  clickSquare(q.sq);
  ok('and clicking the right one is marked right', /right/.test(byId.prSay.className), true);
  tick(1000);

  // name: a wrong name, then the right one — Square Trainer's presenter marks
  // the true square in green either way rather than refusing malformed input,
  // unlike the coordinate console the old drill borrowed this exercise from
  q = forceSquare(1, function(q){ return q.ask === 'name'; });
  presentForced(q);
  typeAnswer('zz');
  ok('a wrong name is marked wrong', /wrong/.test(byId.prSay.className), true);
  ok('and the right square is shown in green regardless', marked(q.sq, 'pr-right'), true);
  pressCtl('Next');

  q = forceSquare(1, function(q){ return q.ask === 'name'; });
  presentForced(q);
  typeAnswer(sqName(q.sq));
  ok('the right name is accepted', /right/.test(byId.prSay.className), true);
  tick(1000);
  prShowDash();
})();

(function(){
  // level 2: labels come off, and the two exercises still both work
  storage = {};
  startDrill('square', 2);
  ok('the middle setting drops the coordinate labels',
     prSqEls[56].innerHTML === '' && prSqEls[0].innerHTML === '', true);
  answerRight();
  tick(1000);
  ok('an answer at level 2 still lands right', PR.i > 0 && PR.right === PR.i, true);
  prShowDash();
})();

(function(){
  // colour: forced, right then wrong — this is the exercise Square Colour
  // used to own on its own dashboard card
  storage = {};
  startDrill('square', 3);
  var q = prMakeSquare(prRecipe('square', 3));
  q.ask = 'colour';
  presentForced(q);
  ansButton(q.dark ? 'Dark' : 'Light').onclick();
  ok('a colour answer is marked right', /right/.test(byId.prSay.className), true);
  tick(1000);

  q = prMakeSquare(prRecipe('square', 3));
  q.ask = 'colour';
  presentForced(q);
  ansButton(q.dark ? 'Light' : 'Dark').onclick();
  ok('the wrong colour is marked wrong', /wrong/.test(byId.prSay.className), true);
  ok('and the explanation names the square', byId.prSay.innerHTML.indexOf(sqName(q.sq)) >= 0, true);
  pressCtl('Next');
  prShowDash();
})();

(function(){
  // level 4: a flash — the board is up, then taken away, then the question
  // is answered from memory
  storage = {};
  startDrill('square', 4);
  var q = forceSquare(4, function(q){ return q.ask === 'name'; });
  presentForced(q);
  ok('the board is up during the flash', byId.prFrame.style.display, '');
  tick(1000);
  ok('and taken away once the flash ends', byId.prFrame.style.display, 'none');
  typeAnswer(sqName(q.sq));
  ok('the right name is still accepted after the flash', /right/.test(byId.prSay.className), true);
  tick(1000);

  q = forceSquare(4, function(q){ return q.ask === 'colour'; });
  presentForced(q);
  ansButton(q.dark ? 'Dark' : 'Light').onclick();
  ok('a colour answer during the flash is marked right', /right/.test(byId.prSay.className), true);
  tick(1000);
  prShowDash();
})();

(function(){
  // level 5: no board at all — colour, neighbours and quadrants from the
  // name alone
  storage = {};
  startDrill('square', 5);
  ok('there is no board at this level', byId.prFrame.style.display, 'none');

  var q = forceSquare(5, function(q){ return q.ask === 'neighbour'; });
  presentForced(q);
  typeAnswer(sqName(elsewhere(q.answer)));
  ok('a wrong neighbour is marked wrong', /wrong/.test(byId.prSay.className), true);
  ok('and the explanation names the square that really is', byId.prSay.innerHTML.indexOf(sqName(q.answer)) >= 0, true);
  pressCtl('Next');

  q = forceSquare(5, function(q){ return q.ask === 'neighbour'; });
  presentForced(q);
  typeAnswer(sqName(q.answer));
  ok('the right neighbour is accepted', /right/.test(byId.prSay.className), true);
  tick(1000);

  q = forceSquare(5, function(q){ return q.ask === 'quadrant'; });
  presentForced(q);
  ansButton(PR_QUADRANT_NAME[q.answer]).onclick();
  ok('a quadrant answer is marked right', /right/.test(byId.prSay.className), true);
  tick(1000);
  prShowDash();
})();

(function(){
  // level 6: from Black's chair, sometimes
  storage = {};
  startDrill('square', 6);
  var q = forceSquare(6, function(q){ return q.ask === 'find' && q.flipped; });
  presentForced(q);
  ok("the board turns round for Black's chair", /Black's view/.test(byId.prOrient.textContent), true);
  clickSquare(q.sq);
  ok('a find answer still lands on the right square once flipped', /right/.test(byId.prSay.className), true);
  tick(1000);
  prShowDash();
})();

(function(){
  // level 7: no board, three seconds — running out of the clock is a wrong
  // answer, the same as any other
  storage = {};
  startDrill('square', 7);
  presentForced(prMakeSquare(prRecipe('square', 7)));
  ok('a level 7 question is timed', PR.q.timed, 3000);
  tick(3000);
  ok('running out of time is judged wrong', /wrong/.test(byId.prSay.className), true);
  prShowDash();
})();

/* ============================================================
   2b — Lines & Routes: one deterministic pass through `between` at the
   easiest level, which only ever asks it (PR_LINES_LEVELS[0].kinds has one
   entry) with the board on. test_practice.js already re-derives all four
   question kinds against the geometry helpers themselves; what the presenter
   still has to prove on its own is that clicking `q.picks` together and
   pressing Done turns into the same judgement the generator's `answer`
   claims.
   ============================================================ */
head('Lines & Routes');

(function(){
  storage = {};
  startDrill('lines', 1, 5);
  var q = PR.q;
  ok('the easiest level always asks between', q.ask, 'between');
  ok('and shows the board', byId.prFrame.style.display, '');
  q.answer.forEach(clickSquare);
  ansButton('Done').onclick();
  ok('every square on the line, clicked and Done, is marked right', /right/.test(byId.prSay.className), true);
  ok('the endpoints are shown as the ends of the line', marked(q.a, 'pr-from') && marked(q.b, 'pr-from'), true);
  ok('and the line itself in green', q.answer.every(function(s){ return marked(s, 'pr-right'); }), true);
  tick(1000);
  prShowDash();
})();

/* ============================================================
   3 — a session is time-boxed
   ============================================================ */
head('A session is time-boxed');

(function(){
  // Hold the Position never auto-advances, so ending it on purpose has to go
  // through the button rather than a brisk drill's own timer.
  storage = {};
  startDrill('hold', 1, 2);
  ok('the clock starts full', prTimeLeft(), PR.budgetMs);
  pastStudy();
  answerAskRight(PR.q.ask);
  ok('with time left, the button says Next', ctlButton('Next') !== null, true);
  pressCtl('Next');
  finishSession();
  pastStudy();
  answerAskRight(PR.q.ask);
  ok('once the budget is spent, the button says Finish', ctlButton('Finish') !== null, true);
  pressCtl('Finish');
  ok('and the session ends', byId.prDoneOverlay.classList.contains('show'), true);
  prShowDash();
})();

/* ============================================================
   4 — piece vision: one deterministic pass through the easiest level, which
   asks about a single simple piece on an otherwise empty board — no flash,
   no notation, no captures apart. test_practice.js already re-derives every
   level's targets and captures against legalMoves() itself; what the
   presenter still has to prove on its own is that clicking board squares
   together and pressing Done turns into the same judgement q.targets
   claims, the way Lines & Routes' own presenter test does.
   ============================================================ */
head('Piece Vision');

(function(){
  storage = {};
  startDrill('piece', 1, 5);
  var q = prMakePiece(prRecipe('piece', 1));
  presentForced(q);
  ok('the piece is named with its square', byId.prQ.innerHTML.indexOf(sqName(q.from)) >= 0, true);
  ok('and the square it stands on is marked', marked(q.from, 'pr-from'), true);
  ok('the men are showing — this is geometry, not blindfold',
     byId.prBoard.classList.contains('blind'), false);

  var targets = Array.from(q.targets);
  clickSquare(targets[0]);
  ok('a square can be picked', marked(targets[0], 'pr-pick'), true);
  clickSquare(targets[0]);
  ok('and unpicked', marked(targets[0], 'pr-pick'), false);

  // one right, one wrong, one missed
  clickSquare(targets[0]);
  var stray = -1;
  for (var i = 0; i < 64; i++) if (!q.targets.has(i) && i !== q.from) { stray = i; break; }
  clickSquare(stray);
  ansButton('Done').onclick();
  ok('a partly-right answer is wrong', /wrong/.test(byId.prSay.className), true);
  ok('the square that was right is green', marked(targets[0], 'pr-right'), true);
  ok('the one that was not is red', marked(stray, 'pr-wrong'), true);
  if (targets.length > 1) ok('and the missed ones are ringed', marked(targets[1], 'pr-miss'), true);
  ok('the full answer is spelled out',
     byId.prSay.innerHTML.indexOf(sqName(targets[targets.length - 1])) >= 0, true);
  pressCtl('Next');

  var q2 = prMakePiece(prRecipe('piece', 1));
  presentForced(q2);
  Array.from(q2.targets).forEach(clickSquare);
  ansButton('Done').onclick();
  ok('every square, and only those, is right', /right/.test(byId.prSay.className), true);
  ok('and it says how many there were',
     byId.prSay.innerHTML.indexOf('All ' + q2.targets.size) >= 0, true);
  tick(1000);
  prShowDash();
})();

/* ============================================================
   4b — attack vision: one deterministic pass through the easiest level,
   which only ever asks 'attacks' — Yes or No, board up, nothing in the way
   yet. test_practice.js already re-derives every question kind against an
   independent reading of the position; what the presenter still has to
   prove on its own is that pressing the right Yes/No button turns into the
   judgement q.answer claims.
   ============================================================ */
head('Attack Vision');

(function(){
  storage = {};
  startDrill('attack', 1, 5);
  var q = prMakeAttack(prRecipe('attack', 1));
  presentForced(q);
  ok('level 1 only ever asks attacks', q.ask, 'attacks');
  ok('the piece is named with its square', byId.prQ.innerHTML.indexOf(sqName(q.from)) >= 0, true);
  ok('the target square is named too', byId.prQ.innerHTML.indexOf(sqName(q.target)) >= 0, true);
  ok('and its own square is marked', marked(q.from, 'pr-from'), true);
  ok('the men are showing — this is geometry, not blindfold',
     byId.prBoard.classList.contains('blind'), false);

  ansButton(q.answer ? 'Yes' : 'No').onclick();
  ok('the right button is judged right', /right/.test(byId.prSay.className), true);
  tick(1000);
  prShowDash();
})();

/* `attackers` grades one side only, and level 4 puts the target beside the
   enemy king — which always attacks its own neighbours, so a question that
   did not say whose attackers it wanted would mark a player wrong for
   correctly noticing the king. This checks the fix directly: the question
   names a side, and the target square (which cannot attack itself) is
   refused by the click handler exactly as `attacked` already refuses the
   piece's own square. */
(function(){
  storage = {};
  startDrill('attack', 4, 5);
  var q = prMakeAttack(prRecipe('attack', 4));
  presentForced(q);
  ok('level 4 only ever asks attackers', q.ask, 'attackers');
  ok('the question names the asking side', /White|Black/.test(byId.prQ.innerHTML), true);
  var before = q.picks.size;
  clickSquare(q.target);
  ok('clicking the target itself picks nothing', q.picks.size, before);
  tick(1000);
  prShowDash();
})();

/* ============================================================
   5 — move tracker
   The read-out is paced by prTimer, so every one of these drives the fake
   clock rather than waiting: a move lands, 1100ms later the next one does,
   and the question comes a beat after the last. Level 1 is the deterministic
   one — one piece, two plies, one ask kind (`where`) — so it can be walked
   end to end; the levels that carry checkpoints are driven through the
   helper below, which answers each checkpoint as it comes up.
   ============================================================ */
head('Move Tracker');

/** A tracker question at `level` for which `pred` is true. Which of the
    level's `asks` a question draws is a coin flip, and so is whether the
    piece asked about ever stood on a square a test wants to click, so a
    test that needs a particular shape waits for one — forceSquare and
    forceHold above exist for exactly the same reason. */
function forceTracker(level, pred){
  for (var t = 0; t < 500; t++){
    var q = prMakeTracker(prRecipe('tracker', level));
    if (q && pred(q)) return q;
  }
  throw new Error('could not force a level ' + level + ' tracker question matching the predicate');
}
/** Tick the read-out along, answering every checkpoint right as it appears,
    until the final question is on screen. `from` is which checkpoint comes
    next, for a test that has already answered one by hand. Returns how many
    this call answered. A checkpoint is told from the question by its own
    prefix, which the page writes for exactly that reason. */
function trackerRun(q, from){
  var at = from || 0, answered = 0, guard = 0;
  while (guard++ < 120){
    if (/^Checkpoint/.test(byId.prQ.innerHTML)){
      answerAskRight(q.checks[at].ask);
      at++; answered++;
    } else if (byId.prQ.innerHTML === q.ask.text) return answered;
    tick(1200);
  }
  throw new Error('the read-out never reached the question');
}

(function(){
  storage = {};
  startDrill('tracker', 1, 5);
  var q = forceTracker(1, function(q){ return q.end !== q.path[0].from; });
  presentForced(q);
  ok('the drill opens with the men in view', byId.prBoard.classList.contains('blind'), false);
  ok('and names one of them on its square',
     byId.prQ.innerHTML.indexOf(sqName(q.path[0].from)) >= 0, true);
  ok('nothing is asked before Ready', PR.click, null);
  ok('the moves are not read out yet', byId.prSeq.innerHTML, '');

  pressCtl('Ready');
  ok('Ready takes the men away', byId.prBoard.classList.contains('blind'), true);
  ok('the first move is read out at once', byId.prSeq.innerHTML.indexOf(q.path[0].full) >= 0, true);
  ok('in from-to form at this level', q.recipe.fromTo, true);
  ok('and the second is not there yet', byId.prSeq.innerHTML.indexOf(q.path[1].full) >= 0, false);
  ok('with the square it left lit', marked(q.path[0].from, 'pr-from'), true);

  tick(1200);
  ok('the second move follows on the clock', byId.prSeq.innerHTML.indexOf(q.path[1].full) >= 0, true);
  ok('and nothing is asked while it is still being read', PR.click, null);
  tick(1200);
  ok('then the question arrives', PR.click !== null, true);
  ok('asking where the piece stands now', /Where is/.test(byId.prQ.innerHTML), true);

  clickSquare(q.end);
  ok('the right square is judged right', /right/.test(byId.prSay.className), true);
  ok('and offers to walk the moves back', ctlButton('Walk it back') !== null, true);

  pressCtl('Walk it back');
  tick(420);
  ok('the walk brings the men back', byId.prBoard.classList.contains('blind'), false);
  tick(780 * 3);
  ok('and finishes on the square the piece reached', marked(q.end, 'pr-right'), true);
  ok('saying so', byId.prSub.innerHTML.indexOf(sqName(q.end)) >= 0, true);
  prShowDash();
})();

/* A wrong click is typed, not just counted: the piece's own earlier square
   is losing the thread at a particular ply, and the walk-back stops there
   rather than playing on past the moment it went wrong. */
(function(){
  storage = {};
  startDrill('tracker', 1, 5);
  var q = forceTracker(1, function(q){ return q.end !== q.path[0].from; });
  presentForced(q);
  pressCtl('Ready');
  tick(3000);
  clickSquare(q.path[0].from);
  ok('the square the piece started on is wrong', /wrong/.test(byId.prSay.className), true);
  ok('and is read as losing the thread at ply one', PR.q.lostAt, 1);
  ok('which is what the record keeps', prLoad().modes.tracker.stats.errs.lost, 1);

  pressCtl('Walk it back');
  tick(420 + 780 * 4);
  ok('the walk back stops at the ply it was lost',
     byId.prSub.innerHTML.indexOf('lost it') >= 0, true);
  ok('and names the move', byId.prSub.innerHTML.indexOf(q.path[0].san) >= 0, true);
  prShowDash();
})();

/* Level 7 is the first with checkpoints: the read-out stops twice on the way
   through, asks a question about the position as it then stands, and scores
   none of it. */
(function(){
  storage = {};
  startDrill('tracker', 7, 5);
  var q = forceTracker(7, function(q){ return q.checks.length === 2; });
  presentForced(q);
  ok('eight plies carry two checkpoints', q.checks.length, 2);
  ok('the first is three plies in', q.checks[0].ply, 3);

  pressCtl('Ready');
  tick(1100 * 3);
  ok('the read-out stops for a checkpoint', /^Checkpoint/.test(byId.prQ.innerHTML), true);
  ok('and asks its own question', byId.prQ.innerHTML.indexOf(q.checks[0].ask.text) >= 0, true);
  ok('saying it is not scored', /Nothing here is scored/.test(byId.prSub.innerHTML), true);
  ok('the men are still away', byId.prBoard.classList.contains('blind'), true);

  answerAskRight(q.checks[0].ask);
  ok('a checkpoint answer is not counted', PR.i, 0);
  ok('and nothing is on the record', prLoad().modes.tracker.asked, 0);
  tick(800);
  ok('the read-out picks up again', /^Move/.test(byId.prSub.innerHTML), true);

  var chks = trackerRun(q, 1);
  ok('the second checkpoint was asked too', chks, 1);
  ok('and the question waited for the end of the walk', byId.prQ.innerHTML, q.ask.text);
  answerAskRight(q.ask);
  ok('which is the answer that counts', PR.i, 1);
  ok('and is judged right', /right/.test(byId.prSay.className), true);
  prShowDash();
})();

/* A missed checkpoint costs nothing on the record and shows the position
   instead — the point of stopping is to be put back on the walk, not to be
   marked down for having fallen off it. */
(function(){
  storage = {};
  startDrill('tracker', 7, 5);
  var q = forceTracker(7, function(q){
    return q.checks.length === 2 && q.checks[0].ask.t === 'where';
  });
  presentForced(q);
  pressCtl('Ready');
  tick(1100 * 3);
  clickSquare(elsewhere(q.checks[0].ask.sq));
  ok('a missed checkpoint is said to be missed', /wrong/.test(byId.prSay.className), true);
  ok('and still costs nothing', PR.i, 0);
  ok('the men come back so the walk can be picked up', byId.prBoard.classList.contains('blind'), false);
  ok('and the drift is counted on the question', PR.q.drift, 1);
  tick(1600);
  ok('then they go away again', byId.prBoard.classList.contains('blind'), true);
  ok('and the read-out carries on', /^Move/.test(byId.prSub.innerHTML), true);
  prShowDash();
})();

/* The late levels hand the whole line over at once — by then it is fourteen
   plies and reading it is no longer the easy half. */
(function(){
  storage = {};
  startDrill('tracker', 10, 5);
  var q = forceTracker(10, function(){ return true; });
  presentForced(q);
  ok('a whole-list level opens from the start position', /start position/.test(byId.prQ.innerHTML), true);
  pressCtl('Ready');
  ok('every move is read out at once', byId.prSeq.innerHTML.indexOf(q.path[q.path.length - 1].san) >= 0, true);
  ok('in notation, not from-to', !q.recipe.fromTo, true);
  ok('and the question is asked straight away', byId.prQ.innerHTML, q.ask.text);
  prShowDash();
})();

/* ============================================================
   5b — after the move: a level 1 question, forced to ask only `vacated` so
   it can be driven end to end with one click rather than a dispatch table
   for all five ask kinds. test_practice.js already re-derives every claim a
   generated question makes about its move; what the presenter still has to
   prove on its own is that the move is stated before anything is asked, and
   that clicking the square the moved man left is judged right. Level 1
   carries no study phase, so the men are up throughout; the move is still
   animated (`q.notation` is unset at level 1), which is what the tick below
   is waiting out.
   ============================================================ */
head('After the Move');

(function(){
  storage = {};
  startDrill('after', 1, 5);
  var q = null;
  for (var t = 0; t < 20 && !q; t++) q = prMakeAfter(prRecipe('after', 1));
  if (!q) throw new Error('could not generate a level 1 After the Move question');
  q.asks = ['vacated'];
  presentForced(q);
  ok('the position is on the board, not hidden, at level 1', byId.prBoard.classList.contains('blind'), false);
  ok('the move is stated first, nothing to click yet', PR.click, null);
  tick(1300);
  ok('and once it has been shown, the question is answerable', PR.click !== null, true);

  clickSquare(q.facts.vacated);
  ok('the vacated square is judged right', /right/.test(byId.prSay.className), true);
  prShowDash();
})();

/* ============================================================
   5c — Forcing Lines: a level 1 question, forced to ask only `material` so
   the deterministic pass can press one button rather than driving all four
   ask kinds. test_practice.js already re-derives every claim a generated
   question makes about its exchange (the line replays, the material and the
   occupant are true of the position it reaches); what the presenter still
   has to prove on its own is that the position is studied before the line
   ever appears, that the men go dark once it does — even at level 1, which
   carries no `hidden` of its own — and that pressing the right material
   button is judged right only once the exchange has replayed on the board.
   A short pass through each of the other three ask kinds, and through the
   notation-only and timed-study levels, covers the wiring the generator
   test cannot: it never drives a button.
   ============================================================ */
head('Forcing Lines');

/** A Forcing Lines question at `level` for which `pred` is true — mirrors
    forceHold/forceTracker above for the same reason: which asks a level
    draws, and whether a particular ask kind is even on offer, is decided by
    the recipe's own dice. */
function forceForcing(level, pred){
  for (var t = 0; t < 200; t++){
    var q = prMakeForcing(prRecipe('forcing', level));
    if (q && pred(q)) return q;
  }
  throw new Error('could not force a level ' + level + ' forcing question matching the predicate');
}

(function(){
  storage = {};
  startDrill('forcing', 1, 5);
  var q = forceForcing(1, function(){ return true; });
  q.asks = ['material'];
  presentForced(q);
  ok('the position is on the board to study', byId.prFrame.style.display, '');
  ok('the men are up during study', byId.prBoard.classList.contains('blind'), false);
  ok('nothing is asked before Ready', PR.click, null);
  ok('the line is not read out yet', byId.prSeq.innerHTML, '');

  pressCtl('Ready');
  ok('Ready takes the men away, even at level 1', byId.prBoard.classList.contains('blind'), true);
  ok('and reads the whole line out at once', byId.prSeq.innerHTML.indexOf(q.line[0].san) >= 0, true);
  ok('every ply of it', byId.prSeq.innerHTML.indexOf(q.line[q.line.length - 1].san) >= 0, true);
  ok('the question is answerable now', PR.click === null && ansButton(prForcingMaterialLabel(q.delta)) !== null, true);

  ansButton(prForcingMaterialLabel(q.delta)).onclick();
  ok('the verdict waits for the exchange to replay', PR.answered, false);
  tick(700 * (q.line.length + 2));
  ok('and once it has, the right button is judged right', /right/.test(byId.prSay.className), true);
  ok('naming what each side carried off', /for.*:/.test(byId.prSay.innerHTML), true);
  prShowDash();
})();

(function(){
  // the mirror-image button — the same magnitude naming the other side — is
  // always on offer and is always wrong; the fourth button is a coin flip
  // between truth+100 and truth-100 so it is not a fixed target to click on
  storage = {};
  startDrill('forcing', 1, 5);
  var q = forceForcing(1, function(q){ return q.delta !== 0; });
  q.asks = ['material'];
  presentForced(q);
  pressCtl('Ready');
  ansButton(prForcingMaterialLabel(-q.delta)).onclick();
  tick(700 * (q.line.length + 2));
  ok('the mirror-image answer is judged wrong', /wrong/.test(byId.prSay.className), true);
  prShowDash();
})();

(function(){
  // a second press of the same button, before the replay has even started —
  // prAnsClear() has already emptied prAnsEl by the time this fires, so the
  // button reference is captured first, exactly the way a stray double-click
  // event would still reach a handler the page itself has moved on from
  storage = {};
  startDrill('forcing', 1, 5);
  var q = forceForcing(1, function(){ return true; });
  q.asks = ['material'];
  presentForced(q);
  pressCtl('Ready');
  var btn = ansButton(prForcingMaterialLabel(q.delta));
  var iBefore = PR.i;
  btn.onclick();
  btn.onclick();
  ok('pressing it twice records only the first press', q.results.length, 1);
  tick(700 * (q.line.length + 2));
  ok('and the score advances once, not twice', PR.i, iBefore + 1);
  prShowDash();
})();

(function(){
  // occupant: prAskShow's own glyph palette, asked of the square the whole
  // exchange was fought over
  storage = {};
  startDrill('forcing', 1, 5);
  var q = forceForcing(1, function(){ return true; });
  q.asks = ['occupant'];
  presentForced(q);
  pressCtl('Ready');
  ok('the question names the square', byId.prQ.innerHTML.indexOf(sqName(q.sq)) >= 0, true);
  var order = ['K','Q','R','B','N','P'];
  var at = (q.occupant.c === 'w' ? 0 : 6) + order.indexOf(q.occupant.t);
  prAnsEl.children[at].onclick();
  tick(700 * (q.line.length + 2));
  ok('the right man on the right square is judged right', /right/.test(byId.prSay.className), true);
  prShowDash();
})();

(function(){
  // check: Yes or No, of the position the exchange actually reaches
  storage = {};
  startDrill('forcing', 1, 5);
  var q = forceForcing(1, function(){ return true; });
  q.asks = ['check'];
  presentForced(q);
  pressCtl('Ready');
  ansButton(q.check ? 'Yes' : 'No').onclick();
  tick(700 * (q.line.length + 2));
  ok('the right check answer is judged right', /right/.test(byId.prSay.className), true);
  prShowDash();
})();

(function(){
  // hanging: select-many, or say Nothing — forced to a question where
  // something really is hanging, so Done is worth pressing at all
  storage = {};
  startDrill('forcing', 5, 5);
  var q = forceForcing(5, function(q){ return q.hanging.length > 0; });
  q.asks = ['hanging'];
  presentForced(q);
  pressCtl('Ready');
  q.hanging.forEach(clickSquare);
  ansButton('Done').onclick();
  tick(700 * (q.line.length + 2));
  ok('every hanging square, clicked and Done, is judged right', /right/.test(byId.prSay.className), true);
  prShowDash();
})();

(function(){
  // level 6: the position from the notation alone — no board at all, not
  // even to study, and the men it names are read straight out of q.st
  storage = {};
  startDrill('forcing', 6, 5);
  var q = forceForcing(6, function(){ return true; });
  presentForced(q);
  ok('there is no board at this level', byId.prFrame.style.display, 'none');
  ok('the position is spelled out in words', byId.prQ.innerHTML.indexOf(sqName(q.sq)) >= 0, true);
  prShowDash();
})();

(function(){
  // level 3: the first level with a study clock — Ready cuts it short, and
  // running the countdown out gets there just the same. startDrill() has
  // already opened its own (unforced) level 3 question with a countdown of
  // its own running; prClearTimers() cancels that one before the forced
  // question starts a second, or the two recursive countdowns race and
  // whichever reaches zero first — not necessarily this one's — is the one
  // that fires.
  storage = {};
  startDrill('forcing', 3, 5);
  prClearTimers();
  var q = forceForcing(3, function(){ return true; });
  presentForced(q);
  ok('a countdown is running', /go dark in/.test(byId.prSub.innerHTML), true);
  tick(9000);
  ok('and reaches the line on its own, without Ready', byId.prSeq.innerHTML.indexOf(q.line[0].san) >= 0, true);
  ok('the men went dark with it', byId.prBoard.classList.contains('blind'), true);
  prShowDash();
})();

/* ============================================================
   5d — Blind Calculation: a level 1 mate in one entered the way the drill
   asks for it (two clicks on a board with nothing drawn on it), a position
   out of the puzzle set, a level 8 line answered through prAskShow's glyph
   palette, and the console-only level typed at. test_practice.js already
   re-verifies every tactic this drill invents; what the presenter has to
   prove on its own is that the position is studied before anything is asked,
   that the men are gone by the time it is, that a move entered as two
   squares is judged against the rules rather than against a string, and that
   the two ways of being wrong — a move that is not there at all, and a move
   that is there and is not the answer — are told apart and counted apart.
   ============================================================ */
head('Blind Calculation');

/** A calculation question at `level` for which `pred` is true — mirrors
    forceForcing/forceHold above: which of the level's tasks a draw produces
    (and, at the line levels, what the line ends up asking) is the recipe's
    own dice, and a deterministic pass needs one particular shape. */
function forceCalc(level, pred){
  for (var t = 0; t < 200; t++){
    var q = prMakeCalc(prRecipe('calc', level));
    if (q && pred(q)) return q;
  }
  throw new Error('could not force a level ' + level + ' calculation question matching the predicate');
}

(function(){
  storage = {};
  startDrill('calc', 1, 5);
  var q = forceCalc(1, function(q){ return q.task === 'mate1'; });
  presentForced(q);
  ok('the position is on the board to study', byId.prBoard.classList.contains('blind'), false);
  ok('and says how many men are on it', /Study this position/.test(byId.prQ.innerHTML), true);
  ok('nothing is answerable yet', PR.click, null);

  pressCtl('Ready');
  ok('Ready takes the men away', byId.prBoard.classList.contains('blind'), true);
  ok('and asks for the move', /mate in one/.test(byId.prQ.innerHTML), true);
  ok('the board takes clicks now', PR.click !== null, true);

  clickSquare(q.answer.from);
  ok('the first click is the square it comes from', marked(q.answer.from, 'pr-from'), true);
  ok('and judges nothing on its own', PR.answered, false);
  clickSquare(q.answer.to);
  ok('the verdict waits for the move to be played out', PR.answered, false);
  tick(4000);
  ok('and once it has, the right move is judged right', /right/.test(byId.prSay.className), true);
  ok('the men are back with the move on the board', byId.prBoard.classList.contains('blind'), false);
  ok('naming it', byId.prSay.innerHTML.indexOf('mate') >= 0, true);
  prShowDash();
})();

(function(){
  // clicking the same square twice takes the half-entered move back, which
  // on a board with nothing drawn on it is the only thing it could mean
  storage = {};
  startDrill('calc', 1, 5);
  var q = forceCalc(1, function(q){ return q.task === 'mate1'; });
  presentForced(q);
  pressCtl('Ready');
  clickSquare(q.answer.from);
  clickSquare(q.answer.from);
  ok('a second click on the same square takes it back', marked(q.answer.from, 'pr-from'), false);
  clickSquare(q.answer.from);
  clickSquare(q.answer.to);
  tick(4000);
  ok('and the move can then be entered as it was meant', /right/.test(byId.prSay.className), true);
  prShowDash();
})();

(function(){
  // two squares with no move between them: the picture of the board being
  // held is wrong, which prRecord counts as `square` — a different mistake
  // from a move that exists and is not the answer, counted as `other` below
  storage = {};
  startDrill('calc', 1, 5);
  var q = forceCalc(1, function(q){ return q.task === 'mate1'; });
  presentForced(q);
  pressCtl('Ready');
  var empties = [];
  for (var i = 0; i < 64; i++) if (!q.st.b[i]) empties.push(i);
  clickSquare(empties[0]);
  clickSquare(empties[1]);
  tick(4000);
  ok('a move that is not there is judged wrong', /wrong/.test(byId.prSay.className), true);
  ok('and says so', /no legal move/.test(byId.prSay.innerHTML), true);
  ok('counted as the position being wrong', prLoad().modes.calc.stats.errs.square, 1);
  ok('and the answer is given', byId.prSay.innerHTML.indexOf('The move was') >= 0, true);
  prShowDash();
})();

(function(){
  // a legal move that is not the answer: it is played out, answered by the
  // engine, and only then is the real move shown
  storage = {};
  startDrill('calc', 1, 5);
  var q = forceCalc(1, function(q){ return q.task === 'mate1'; });
  presentForced(q);
  pressCtl('Ready');
  var other = legalMoves(q.st, q.st.turn).filter(function(m){
    return !(m.from === q.answer.from && m.to === q.answer.to);
  })[0];
  clickSquare(other.from);
  clickSquare(other.to);
  tick(600);
  ok('the move the player chose is played on the board', byId.prSub.innerHTML.indexOf('You played') >= 0, true);
  tick(4000);
  ok('a legal move that is not the answer is judged wrong', /wrong/.test(byId.prSay.className), true);
  ok('and counted apart from a move that was never there', prLoad().modes.calc.stats.errs.other, 1);
  prShowDash();
})();

(function(){
  // levels 6 and 7 cannot say what the question is until the shipped puzzle
  // file has come back. The fetch itself is not something this harness can
  // drive — it has no fetch at all, and everything it asserts is synchronous
  // — but the screen a player sees while it is in the air is, and a drill
  // that quietly took clicks for a question it had not shown yet would be a
  // real bug rather than a cosmetic one.
  storage = {};
  startDrill('calc', 6, 5);
  ok('a puzzle level says it is fetching one', /Fetching a puzzle position/.test(byId.prQ.innerHTML), true);
  ok('and asks nothing until it has', PR.click, null);
  prShowDash();
})();

(function(){
  // a position out of the shipped puzzle set — the one thing this drill ever
  // asks that can be Black to move, and the reason the board is drawn from
  // the chair of whoever has to find the move rather than always White's.
  // The pool is handed in directly here: what prShowCalc does with a real one
  // is fetch it, and this harness has no fetch at all.
  storage = {};
  startDrill('calc', 7, 5);
  var q = prMakeCalc(Object.assign(prRecipe('calc', 7), {
    pool: [{ id:'t-1', fen:'3r2k1/5ppp/8/8/8/8/5PPP/6K1 b - - 0 1', moves:['d8d1'] }]
  }));
  ok('the puzzle set is where the position came from', q.task, 'puzzle');
  presentForced(q);
  ok('and the board is drawn from the chair of the side to move', PR.flipped, true);
  pressCtl('Ready');
  clickSquare(q.answer.from);
  clickSquare(q.answer.to);
  tick(4000);
  ok('the move the file gives is the right answer', /right/.test(byId.prSay.className), true);
  prShowDash();
})();

(function(){
  // level 8 is a line rather than a position: the moves are read out as
  // notation with the men gone, and the question at the end of it is
  // prAskShow's own `what` — answered with the glyph palette
  storage = {};
  startDrill('calc', 8, 5);
  var q = forceCalc(8, function(q){ return q.task === 'line' && !!q.endAsk.type; });
  presentForced(q);
  ok('the line is not read out during study', byId.prSeq.innerHTML, '');
  pressCtl('Ready');
  ok('the men go dark with Ready', byId.prBoard.classList.contains('blind'), true);
  ok('and the line is read out as notation', byId.prSeq.innerHTML.indexOf(q.pre[0]) >= 0, true);
  ok('every ply of it', byId.prSeq.innerHTML.indexOf(q.pre[q.pre.length - 1]) >= 0, true);
  ok('the question is what stands there at the end', /what stands on/.test(byId.prQ.innerHTML), true);
  ok('with a way to see the position it reaches', ctlButton('Reveal the position') !== null, true);

  answerAskRight(q.endAsk);
  ok('the right man is judged right', /right/.test(byId.prSay.className), true);
  ok('and the deepest line answered right is on the record', prLoad().modes.calc.stats.ply, q.ply);
  pressCtl('Reveal the position');
  ok('Reveal brings the end position back', byId.prBoard.classList.contains('blind'), false);
  prShowDash();
})();

(function(){
  // level 10 takes the board away altogether: the line is read as notation
  // and the move is typed in the game's own, through parseMoveIn — the same
  // reader the console in a Complete Blindfold game uses
  storage = {};
  startDrill('calc', 10, 5);
  var q = forceCalc(10, function(q){ return q.task === 'visualise' && !q.answer.promo; });
  presentForced(q);
  pressCtl('Ready');
  ok('there is no board at all at this level', byId.prFrame.style.display, 'none');
  ok('and no clicking anything', PR.click, null);
  ok('the moves are read out', byId.prSeq.innerHTML.indexOf(q.pre[0]) >= 0, true);

  typeAnswer('Qz9');
  tick(4000);
  ok('notation that is not a move is judged wrong', /wrong/.test(byId.prSay.className), true);
  ok('and counted as the position being wrong', prLoad().modes.calc.stats.errs.square, 1);
  ok('the board comes back to show what the move was', byId.prFrame.style.display, '');

  pressCtl('Next');
  var q2 = forceCalc(10, function(q){ return q.task === 'visualise' && !q.answer.promo; });
  presentForced(q2);
  pressCtl('Ready');
  typeAnswer(sqName(q2.answer.from) + sqName(q2.answer.to));
  tick(4000);
  ok('and plain squares are read as the move they name', /right/.test(byId.prSay.className), true);
  prShowDash();
})();

/* ============================================================
   5e — Branches: a level 1 question answered right the whole way through —
   every branch's own end, then the root question that follows it, clearing
   the line each time — and a second pass where the very first rewind is
   wrong, to prove the miss is recorded as `lost` rather than the ordinary
   `square` a wrong branch-end answer gets. test_practice.js already
   re-derives every branch and every rootAsk against the move generator
   itself; what the presenter still has to prove on its own is that the men
   go dark before any of it is asked, that the line is off the screen before
   the root is asked about, and that scoring really does wait for the whole
   set.
   ============================================================ */
head('Branches');

(function(){
  // A generation smoke test, under this harness's own bundle rather than
  // test_practice.js's — the two lift different slices of the page (this one
  // the whole PRACTICE section, plus a short DECLS/FNS list of what it reads
  // from outside that section), so a function Branches calls that lives
  // outside the block and is missing from that list throws here even though
  // test_practice.js, which pulls in its own copy of everything by name,
  // never notices. Level 6 is exactly that case: prMakeBranches reaches for
  // openingPosition() (CONSTANTS & HELPERS, not PRACTICE) when `r.lead` is
  // set, and it was missing from this file's FNS for a while — every level
  // is walked here so a gap like that fails loudly instead of only failing
  // silently the day somebody actually plays level 6.
  for (var lv = 1; lv <= PR_MODE.branches.levels.length; lv++){
    var q = prMake('branches', lv);
    ok('level ' + lv + ' builds a branches question', !!q && q.kind === 'branches', true);
  }
})();

(function(){
  storage = {};
  startDrill('branches', 1, 5);
  var q = null;
  for (var t = 0; t < 20 && !q; t++) q = prMakeBranches(prRecipe('branches', 1));
  if (!q) throw new Error('could not generate a level 1 Branches question');
  presentForced(q);
  ok('the root is on the board to study', byId.prBoard.classList.contains('blind'), false);
  ok('nothing is asked before Ready', PR.click, null);

  pressCtl('Ready');
  ok('Ready takes the men away before the branches start', byId.prBoard.classList.contains('blind'), true);

  q.branches.forEach(function(br){
    ok("the branch's own line is read out", byId.prSeq.innerHTML.indexOf(br.sans[0]) >= 0, true);
    ok('and it asks about its own end', byId.prQ.innerHTML.indexOf(sqName(br.ask.sq)) >= 0, true);
    answerAskRight(br.ask);
    ok('the line is cleared for the rewind', byId.prSeq.innerHTML, '');
    ok('and the question is put about the root instead', /Back at the root/.test(byId.prQ.innerHTML), true);
    answerAskRight(br.rootAsk);
  });
  ok('right on every branch and every rewind is judged right', /right/.test(byId.prSay.className), true);
  ok('with the root and the last branch to compare', /The root\./.test(byId.prSub.innerHTML), true);
  pressCtl('Compare');
  ok('Compare swaps to where the last branch actually finished', /end of the last branch/.test(byId.prSub.innerHTML), true);
  prShowDash();
})();

(function(){
  // the first rewind wrong, everything else right: the miss this scores is
  // `lost`, not the plain `square` a wrong branch-end answer gets
  storage = {};
  startDrill('branches', 1, 5);
  var q = null;
  for (var t = 0; t < 20 && !q; t++) q = prMakeBranches(prRecipe('branches', 1));
  if (!q) throw new Error('could not generate a level 1 Branches question');
  presentForced(q);
  pressCtl('Ready');

  answerAskRight(q.branches[0].ask);
  answerAskWrong(q.branches[0].rootAsk);
  for (var i = 1; i < q.branches.length; i++){
    answerAskRight(q.branches[i].ask);
    answerAskRight(q.branches[i].rootAsk);
  }
  ok('a wrong rewind is judged wrong', /wrong/.test(byId.prSay.className), true);
  ok('and counted as having lost the root, not as a wrong square', prLoad().modes.branches.stats.errs.lost, 1);
  prShowDash();
})();

/* ============================================================
   6 — hold the position: one deterministic pass through each of the three
   answer shapes. test_practice.js already re-derives every claim a generated
   question makes about its position; what the presenter still has to prove
   on its own is that Ready cuts the study short, the men actually go dark,
   and a click or a rebuild in the right place is judged right — the same
   division of labour Square Trainer's and Lines & Routes' presenter tests
   above draw.
   ============================================================ */
head('Hold the Position');

(function(){
  // level 1 only ever asks a `question`; forcing `where` is what lets the
  // answer be a single click on q.ask.sq rather than a second dispatch table
  // this suite would have to keep in step with answerAskRight's own.
  storage = {};
  startDrill('hold', 1, 5);
  var q = forceHold(1, function(q){ return q.mode === 'question' && q.ask.t === 'where'; });
  presentForced(q);
  ok('the position is on the board to study', byId.prBoard.classList.contains('blind'), false);
  ok('and it says how many men there are', /Study this position/.test(byId.prQ.innerHTML), true);
  ok('with a countdown', /go dark in/.test(byId.prSub.innerHTML), true);
  ok('nothing is asked yet', PR.click, null);

  pressCtl('Ready');
  ok('the men go dark once Ready is pressed', byId.prBoard.classList.contains('blind'), true);
  ok('and the question arrives', byId.prQ.innerHTML.length > 0, true);
  ok('with a way to see the position again', ctlButton('Reveal the position') !== null, true);
  var asked = byId.prQ.innerHTML;
  tick(9000);
  ok('a countdown that was already cut short changes nothing further', byId.prQ.innerHTML, asked);

  clickSquare(q.ask.sq);
  ok('the right answer is marked right', /right/.test(byId.prSay.className), true);
  ok('hold never rushes you on', PR.answered && ctlButton('Next') !== null, true);
  pressCtl('Reveal the position');
  ok('Reveal brings the position back', byId.prBoard.classList.contains('blind'), false);
  ok('and says it is the real one', /actually stood/.test(byId.prSub.innerHTML), true);

  pressCtl('Next');
  ok('and the next position is up to study', byId.prBoard.classList.contains('blind'), false);
  prShowDash();
})();

(function(){
  // level 3 offers `change` too — the position goes dark, one man moves
  // under cover of that, and the question is which square it left.
  storage = {};
  startDrill('hold', 3, 5);
  var q = forceHold(3, function(q){ return q.mode === 'change'; });
  presentForced(q);
  pressCtl('Ready');
  ok('the board goes dark the instant study ends', byId.prBoard.classList.contains('blind'), true);
  tick(1500);
  ok('and the changed position comes back up on its own', byId.prBoard.classList.contains('blind'), false);
  ok('asking what changed', /What changed/.test(byId.prQ.innerHTML), true);

  clickSquare(q.change.to);
  ok('the square the man moved TO is a wrong answer', /wrong/.test(byId.prSay.className), true);
  pressCtl('Next');

  var q2 = forceHold(3, function(q){ return q.mode === 'change'; });
  presentForced(q2);
  pressCtl('Ready');
  tick(1500);
  clickSquare(q2.change.from);
  ok('the square it moved FROM is the right answer', /right/.test(byId.prSay.className), true);
  prShowDash();
})();

(function(){
  // a capture leaves a trace in the feedback, whether the answer was right
  // or wrong — "and the man on <to> was taken" only when q.change.cap is set
  storage = {};
  startDrill('hold', 3, 5);
  var q = forceHold(3, function(q){ return q.mode === 'change' && q.change.cap; });
  presentForced(q);
  pressCtl('Ready');
  tick(1500);
  clickSquare(q.change.from);
  ok('a capture is named in the feedback', /was taken/.test(byId.prSay.innerHTML), true);
  prShowDash();
})();

(function(){
  // level 4 carries the hint, and offers `rebuild` — the men are cleared off
  // the board entirely and placed back one at a time, exactly as Move
  // Tracker's own rebuild level already tests prRebuildStart/Finish.
  storage = {};
  startDrill('hold', 4, 5);
  var q = forceHold(4, function(q){ return q.mode === 'rebuild'; });
  presentForced(q);
  ok('the hint line is printed for a level that carries one', /Kings first/.test(byId.prQ.innerHTML), true);
  pressCtl('Ready');
  // prRebuildStart itself un-hides the board (prMen(true)) — the men you
  // place have to be visible as you place them — so what "cleared" means
  // here is no pieces left standing, not the board gone dark.
  ok('every piece is off the board to start rebuilding', byId.prPieces.children.length, 0);
  ok('and asks to rebuild it', /Rebuild it/.test(byId.prQ.innerHTML), true);

  var order = ['K','Q','R','B','N','P'];
  for (var k = 0; k < q.want.length; k++){
    var w = q.want[k];
    var at = (w.c === 'w' ? 0 : 6) + order.indexOf(w.t);
    prAnsEl.children[at].onclick();
    clickSquare(w.sq);
  }
  pressCtl('Done');
  ok('every man placed correctly is judged right', /right/.test(byId.prSay.className), true);
  ok('and says so', /Every man where it stood/.test(byId.prSay.innerHTML), true);
  prShowDash();
})();

(function(){
  // level 6 is the first rebuild level with no hint, and its rebuild leaves
  // one man off the board on purpose — a forgotten man is named, not just
  // counted.
  storage = {};
  startDrill('hold', 6, 5);
  var q = forceHold(6, function(q){ return q.mode === 'rebuild' && q.want.length > 1; });
  presentForced(q);
  ok('no hint is printed for a level that carries none', /Kings first/.test(byId.prQ.innerHTML), false);
  pressCtl('Ready');
  var order = ['K','Q','R','B','N','P'];
  for (var k = 0; k < q.want.length - 1; k++){
    var w = q.want[k];
    var at = (w.c === 'w' ? 0 : 6) + order.indexOf(w.t);
    prAnsEl.children[at].onclick();
    clickSquare(w.sq);
  }
  pressCtl('Done');
  ok('a man left off the board is judged wrong', /wrong/.test(byId.prSay.className), true);
  ok('and named as forgotten', /Forgotten/.test(byId.prSay.innerHTML), true);
  prShowDash();
})();

/* ============================================================
   7 — Progressive Blindfold
   ============================================================ */
head('Progressive Blindfold: a game at level 1');

(function(){
  /* Deal until the first exchange cannot end the game. Three men a side is a
     small enough board that Black really can have mate in one after whatever
     White's first legal move happens to be, and every assertion below is
     about a game that is still going — so the dice are re-rolled rather than
     the moves steered, and the condition is asked of *every* reply Black has
     rather than of the one the search happened to pick, which is random. */
  var legal = null;
  for (var t = 0; t < 40; t++){
    storage = {};
    prOpen('progressive', 1, 5);
    legal = legalMoves(PR.pb.st, W)[0];
    var after = makeMove(PR.pb.st, legal), theirs = legalMoves(after, B);
    if (theirs.length && theirs.every(function(m){ return legalMoves(makeMove(after, m), W).length > 0; })) break;
  }
  ok('a game is up', PR.pb && !PR.pb.over, true);
  ok('level 1 shows only our men', prPieceEls.size, menOf(PR.pb.st.b, W));
  ok('the board is there to click on', byId.prBoard.classList.contains('blind'), false);
  ok('and the console opens with a word about what is hidden', byId.prLog.children.length, 1);
  ok('the counter counts moves, not questions', byId.prStatQCap.textContent, 'Move');
  clickSquare(legal.from); clickSquare(legal.to);
  ok('our move was played', PR.pb.played, 1);
  ok('the reply is pending', PR.pb.busy, true);
  fireTimers();
  ok('and arrives', PR.pb.st.turn, W);
  ok('both plies are in the console', byId.prLog.children.length, 3);
  // an illegal typed move is counted and refused
  typeAnswer('Ka9');
  ok('an illegal move is counted', PR.pb.illegal, 1);
  ok('and does not move anything', PR.pb.played, 1);
})();

(function(){
  storage = {};
  prOpen('progressive', 3, 5);
  ok('squares only: the board is there and the men are not',
     byId.prBoard.classList.contains('blind'), true);
  ok('and every man is painted, hidden or not', prPieceEls.size, menOf(PR.pb.st.b, W) + menOf(PR.pb.st.b, B));
  pressCtl('Reveal and stop');
  ok('the game is over', PR.pb.over, true);
  ok('the men come back', byId.prBoard.classList.contains('blind'), false);
  ok('a level given up on was not held', PR.pb.pass, false);
  ok('the result box is up', byId.prDoneOverlay.classList.contains('show'), true);
  ok('reporting the moves', /Moves played/.test(byId.prDoneRows.children[0].innerHTML), true);
  var m = prLoad().modes.progressive;
  ok('and the next session opens on the same rung', m.level, 3);
  ok('with what the game cost kept per level', m.stats.pb[3].played, 0);
  ok('a rung not held offers no blindfold game', byId.prBlindGame.style.display, 'none');
})();

(function(){
  // Deal until White's first legal move (all[0], same as below) leaves
  // Black able to reply, and every reply Black could make leaves White able
  // to move again — bestMove's own pick is not predictable from here (it
  // breaks ties with Math.random(), see pbReply), so the condition is asked
  // of every legal reply rather than of whichever one the search happens to
  // pick. Without this a rare five-a-side deal answers White's very first
  // move with checkmate or stalemate: pbMove ends the game before pbReply is
  // ever scheduled, "and answered" below reads Black's turn instead of
  // White's, and "Reveal and stop" no longer exists to press — the same
  // reasoning as the level 1 deal-until-loop above, aimed at the move after.
  var all = null;
  for (var t = 0; t < 40; t++){
    storage = {};
    prOpen('progressive', 8, 5);
    all = legalMoves(PR.pb.st, W);
    var after = makeMove(PR.pb.st, all[0]), theirs = legalMoves(after, B);
    if (theirs.length && theirs.every(function(m){ return legalMoves(makeMove(after, m), W).length > 0; })) break;
  }
  ok('console only: there is no board at all', byId.prFrame.style.display, 'none');
  ok('and the console says so', byId.prNoBoard.style.display, '');
  typeAnswer(toSAN(PR.pb.st, all[0], all));
  ok('a move typed into it is played', PR.pb.played, 1);
  fireTimers();
  ok('and answered', PR.pb.st.turn, W);
  pressCtl('Reveal and stop');
  ok('and the position is there at the end of it', byId.prFrame.style.display, '');
})();

head('Progressive Blindfold: holding a level');

(function(){
  /* Level 1 checks every third move (checkEvery:3), and three men a side can
     be mated, stalemated or left with no legal reply well inside that —
     Black's replies are the page's own search, so which of those happens is
     the dice, not the deal. A game that ends before a third of our own moves
     is played never reaches a checkpoint, and PR.pb.checks stays 0 through no
     fault of the checkpoint logic this block exists to exercise — so, exactly
     as the level-1 deal at the top of this file retries until the game is
     still going, the deal here is retried until a checkpoint actually fires. */
  var guard;
  for (var t = 0; t < 40; t++){
    storage = {};
    prOpen('progressive', 1, 5);
    guard = 0;
    while (!PR.pb.over && guard++ < 60){
      var all = legalMoves(PR.pb.st, W);
      if (!all.length) break;
      typeAnswer(toSAN(PR.pb.st, all[0], all));
      fireTimers();                            // the reply comes after a beat
      // every third move the game stops and asks; hold it, and the move box and
      // the board click come straight back
      if (!PR.pb.over && PR.pb.busy) pbAnswerRight(PR.pb.check);
    }
    if (PR.pb.checks > 0) break;               // else the game never lasted to a checkpoint — deal again
  }
  ok('the game ended', PR.pb.over, true);
  ok('and it was stopped and asked along the way', PR.pb.checks > 0, true);
  ok('every checkpoint held', PR.pb.drifts, 0);
  ok('with moves actually played', PR.pb.played > 0, true);
  ok('the board comes back at the end', byId.prBoard.classList.contains('blind'), false);
  ok('and the result box is up', byId.prDoneOverlay.classList.contains('show'), true);
  var m = prLoad().modes.progressive;
  // whichever way it went — the target held, or mate along the way — the rung
  // moves up only on a pass, and never on the staircase's three-in-a-row
  ok('the rung moves up only when the level was held', m.level, PR.pb.pass ? 2 : 1);
  ok('and what the game cost is on the record', m.stats.pb[1].played, PR.pb.played);
})();

(function(){
  /* The last rung, held. Driven rather than played: twenty moves of the full
     start position against the search is a minute of nothing this assertion
     needs, and what is being checked is prFinish's rule — the ladder stops at
     ten, and finishing it is the one result that leads off this page. */
  storage = {};
  prOpen('progressive', 10, 5);
  ok('the top rung is the game\'s own opening position',
     fenOf(PR.pb.st).split(' ')[0], fenOf(newState()).split(' ')[0]);
  PR.pb.played = PR.pb.r.target;
  pbEnd('You held it.');
  ok('it counts as held', PR.pb.pass, true);
  ok('and the ladder stops at ten', prLoad().modes.progressive.level, 10);
  storage = {};
})();

// the two handoffs into a real game (Task 21), and the "next level" button
// that meets them — checked against botTrips from a clean count, so the
// clicks above must not have spent one already
head('Progressive Blindfold: the end card');
(function(){
  storage = {};
  prOpen('progressive', 10, 5);
  PR.pb.played = PR.pb.r.target; pbEnd('done');
  ok('level 10 passed offers a real game', byId.prBlindGame.style.display, '');
  byId.prBlindGame.onclick();
  ok('which goes to the bot setup', botTrips, 1);
  ok('with Complete Blindfold chosen', visionsPicked[visionsPicked.length - 1], 'total');
  ok('and the result box closed behind it', byId.prDoneOverlay.classList.contains('show'), false);
  prOpen('progressive', 7, 5);
  PR.pb.played = PR.pb.r.target; pbEnd('done');
  ok('level 7 offers a See the Board game', byId.prBoardGame.style.display, '');
  byId.prBoardGame.onclick();
  ok('with the empty-board vision chosen', visionsPicked[visionsPicked.length - 1], 'blind');
  storage = {};
})();

head('Progressive Blindfold: checkpoints, peeks, recovery');

(function(){
  /* Level 5 is squares-only with three peeks, and stops to ask every third
     move. Three moves is what it takes to reach that first checkpoint, and a
     five-man game really can be over inside them — Black's reply is the page's
     own search on a small board — so the deal is retried until the game is
     still going when the checkpoint comes and the checkpoint has a wrong
     answer to give, exactly as the level-1 game above retries its own. Every
     assertion is then made once, about the deal that got there. */
  var pb = null, wrong = null;
  var peeksAtStart = 0, shown = null, hidden = null, peeksLeft = 0;
  for (var t = 0; t < 40; t++){
    storage = {};
    prOpen('progressive', 5, 5);
    pb = PR.pb;
    peeksAtStart = pb.peeks;
    pressCtl('Peek (3 left)');
    shown = prBoardEl.classList.contains('blind');
    fireTimers();
    hidden = prBoardEl.classList.contains('blind');
    peeksLeft = pb.peeks;
    for (var k = 0; k < 3 && !pb.over; k++){
      var m = legalMoves(pb.st, W)[0];
      clickSquare(m.from); clickSquare(m.to); fireTimers();
    }
    wrong = (!pb.over && pb.checks === 1 && pb.check) ? pbWrongAnswer(pb.check) : null;
    if (wrong) break;
  }
  ok('three peeks to start', peeksAtStart, 3);
  ok('a peek shows the men', shown, false);
  ok('and hides them again', hidden, true);
  ok('one peek spent', peeksLeft, 2);
  ok('a checkpoint is asked after three moves', pb.checks, 1);
  ok('and the game is paused while it is up', pb.busy, true);
  wrong();
  ok('a wrong checkpoint counts a drift', pb.drifts, 1);
  ok('and shows how it really stands', prBoardEl.classList.contains('blind'), false);
  fireTimers();
  ok('until the board goes again', prBoardEl.classList.contains('blind'), true);
  ok('and the game is playable once more', pb.busy, false);
  pressCtl("I've lost it");
  ok('recovery shows the move list', prSeqEl.innerHTML.length > 0, true);
  ok('and never the board', prBoardEl.classList.contains('blind') || prPieceEls.size === 0, true);
  pressCtl('Done');
  ok('a recovery is counted', pb.recoveries, 1);
  fireTimers();
  ok('and the game goes on with the men hidden again', prBoardEl.classList.contains('blind'), true);
  ok('with the move list taken down', prSeqEl.innerHTML, '');
})();

(function(){
  /* A rung with no peeks offers no peek button — the control is the allowance,
     not a label on a dead button. */
  storage = {};
  prOpen('progressive', 7, 5);
  ok('a level with no peeks offers none', ctlButton('Peek (0 left)'), null);
  ok('but the way back is always there', !!ctlButton("I've lost it"), true);
  storage = {};
  prOpen('progressive', 1, 5);
  ok('an unlimited level says so rather than counting', !!ctlButton('Peek (∞ left)'), true);
  pressCtl('Peek (∞ left)');
  fireTimers();
  ok('and spends nothing', PR.pb.peeks, Infinity);
  storage = {};
})();

(function(){
  /* A peek is a look, not a pause — and it cannot be stacked. A second press
     inside the two seconds would spend a second peek and start a second timer
     whose predecessor takes the board away early, so the button is off the row
     for as long as the look lasts, and pbPeek refuses one anyway. */
  storage = {};
  prOpen('progressive', 5, 5);
  pressCtl('Peek (3 left)');
  ok('a peek does not pause the game', PR.pb.busy, false);
  ok('and leaves the move box up — a move may be played while the men are',
     !!answerBox(), true);
  ok('the Peek button is off the row while the look is on', ctlButton('Peek (2 left)'), null);
  pbPeek();                                  // a second press, however it were reached
  ok('a second look inside the first is refused', PR.pb.peeks, 2);
  fireTimers();
  ok('one look, one peek spent', PR.pb.peeks, 2);
  ok('the men go again on the one timer', prBoardEl.classList.contains('blind'), true);
  ok('and the button is back with one fewer on it', !!ctlButton('Peek (2 left)'), true);
  storage = {};
})();

/* ============================================================
   8 — leaving, restarting, and the record
   ============================================================ */
head('Leaving a drill behind');

(function(){
  storage = {};
  PR.on = true;
  startDrill('hold', 3, 20);
  ok('a study countdown is running', pending.length > 0, true);
  prLeave();
  ok('walking away clears every timer', pending.length, 0);
  ok('and unwires the board', PR.click, null);
  ok('the drill is put away', byId.prRun.style.display, 'none');
  ok('the dashboard is back', byId.prDash.style.display, '');
  ok('and no overlay is left up', byId.prSetOverlay.classList.contains('show'), false);
  // the clock moving on now must not wake anything
  var q = PR.q;
  tick(20000);
  ok('nothing runs after the page is left', PR.q, q);
})();

(function(){
  storage = {};
  startDrill('square', 1, 10);
  answerRight(); tick(1000);
  answerRight(); tick(1000);
  ok('two answers in', PR.i, 2);
  byId.prRestart.onclick();
  ok('Restart starts the session over', PR.i, 0);
  ok('and the streak with it', PR.streak, 0);
  ok('but what was answered is still on the record', prLoad().asked, 2);
  byId.prExit.onclick();
  ok('Exit goes back to the drill list', byId.prDash.style.display, '');
})();

(function(){
  storage = {};
  startDrill('square', 1, 5);
  answerRight(); tick(1000);
  var q = PR.q;
  if (q.ask === 'find') clickSquare(elsewhere(q.sq));
  else typeAnswer(sqName(elsewhere(q.sq)));
  if (ctlButton('Next')) pressCtl('Next');
  ok('one right, one wrong', PR.right + '/' + PR.i, '1/2');
  ok('the session accuracy reads back', byId.prStatA.textContent, '50%');
  ok('and the streak is broken', byId.prStatS.textContent, 0);
  ok('the record kept the same two answers', prLoad().asked, 2);
  ok('and one of them right', prLoad().correct, 1);
  prShowDash();
  ok('a half-finished session is not a finished one', prLoad().sessions, 0);
  ok('but the accuracy shows on the dashboard', byId.prFigAcc.textContent, '50%');
})();

(function(){
  // the setup box, and what it remembers — piece, whose ladder now runs to
  // eight rungs of its own; `top` is read off it rather than hard-coded, so
  // a rung added or dropped later does not silently untest "does not run
  // past the top" below.
  storage = {};
  var mode = PR_MODE.piece;
  var top = mode.levels.length;
  prOpenSetup(mode);
  ok('the setup box opens', byId.prSetOverlay.classList.contains('show'), true);
  ok('naming the drill', byId.prSetName.textContent, mode.name);
  ok('opening on level one', byId.prSetLevelN.textContent, 1);
  ok('with its caption', byId.prSetCap.textContent, mode.levels[0].cap);
  ok('and a length to pick', byId.prSetLenField.style.display, '');

  var lenBtns = bySelector['#prSetLen button'];
  lenBtns[0].onclick();
  ok('a length button sets the minutes', prSetCount, 2);
  ok('and shows itself chosen', lenBtns[0].classList.contains('active'), true);
  lenBtns[2].onclick();
  ok('picking another one moves the highlight',
     lenBtns[2].classList.contains('active') && !lenBtns[0].classList.contains('active'), true);

  byId.prSetUp.onclick();
  byId.prSetUp.onclick();
  ok('the + button steps the level up', byId.prSetLevelN.textContent, 3);
  ok('with the caption that goes with it', byId.prSetCap.textContent, mode.levels[2].cap);
  for (var up = 0; up < top; up++) byId.prSetUp.onclick();
  ok('and does not run past the top of the ladder', byId.prSetLevelN.textContent, top);
  byId.prSetGo.onclick();
  ok('Begin closes the box', byId.prSetOverlay.classList.contains('show'), false);
  ok('and runs the level that was chosen', PR.level, top);

  // finish the session for real, so the level it settled at lands on the record
  finishSession();
  answerRight(); tick(1000);
  ok('the session finished', byId.prDoneOverlay.classList.contains('show'), true);

  prOpenSetup(mode);
  ok('and next time it opens on the level last used', byId.prSetLevelN.textContent, top);
  byId.prSetX.onclick();
  ok('the close button puts it away', byId.prSetOverlay.classList.contains('show'), false);

  byId.prSetDown.onclick();
  ok('and the − button steps it back down', byId.prSetLevelN.textContent, top - 1);

  var progressive = PR_MODE.progressive;
  prOpenSetup(progressive);
  ok('the progressive challenge asks no length — it has its own', byId.prSetLenField.style.display, 'none');
  byId.prSetX.onclick();
})();

head('Practice setup: the first-visit intro and the link back to a lesson');
(function(){
  // Move Tracker names lesson 5 (Task 25's own worked example), and a first
  // visit is `sessions === 0` on that mode's own record — nothing else about
  // the mode matters here.
  storage = {};
  var mode = PR_MODE.tracker;

  lsnDoneStub = [];
  prOpenSetup(mode);
  ok('the first visit shows what the drill is training',
     byId.prSetIntro.innerHTML.indexOf(mode.intro.what) >= 0, true);
  ok('and how the session will ask for it',
     byId.prSetIntro.innerHTML.indexOf(mode.intro.how) >= 0, true);
  ok('with a link back to the lesson that teaches it',
     byId.prSetIntro.innerHTML.indexOf('Lesson 5') >= 0, true);
  byId.prSetX.onclick();

  lsnDoneStub = [5];
  prOpenSetup(mode);
  ok('once that lesson is finished the link is gone',
     byId.prSetIntro.innerHTML.indexOf('Lesson 5') >= 0, false);
  ok('but this is still a first visit, so the intro lines stay',
     byId.prSetIntro.innerHTML.indexOf(mode.intro.what) >= 0, true);
  byId.prSetX.onclick();

  lsnDoneStub = [];
  var st = prLoad();
  st.modes.tracker.sessions = 1;
  prSave(st);
  prOpenSetup(mode);
  ok('after a session the two lines step aside for the level line\'s own caption',
     byId.prSetIntro.innerHTML.indexOf(mode.intro.what) >= 0, false);
  ok('but the lesson link stays — the lesson itself is still unfinished',
     byId.prSetIntro.innerHTML.indexOf('Lesson 5') >= 0, true);

  // The link is guarded rather than stubbed (LESSONS lives outside the
  // PRACTICE section this suite lifts), so pressing it with no lsnOpen in
  // scope must do nothing rather than throw or leave the box half-closed.
  byId.prSetLesson.onclick();
  ok('with no lsnOpen in scope, pressing it does nothing — the box stays open',
     byId.prSetOverlay.classList.contains('show'), true);
  byId.prSetX.onclick();

  lsnDoneStub = [];
})();

(function(){
  storage = {};
  var st = prBlank();
  st.sessions = 2; st.asked = 40; st.correct = 30;
  st.modes.square.sessions = 1; st.modes.piece.sessions = 1;
  prSave(st);
  prShowDash();
  ok('accuracy is reported', byId.prFigAcc.textContent, '75%');
  ok('and what was answered', byId.prFigAsked.textContent, 40);

  startDrill('square', 1, 5);
  finishSession();
  answerRight(); tick(1000);
  ok('the session finished', byId.prDoneOverlay.classList.contains('show'), true);
  byId.prToLessons.onclick();
  ok('Back to Lessons opens the course', screens[screens.length - 1], 'lessons');
  ok('and closes the box', byId.prDoneOverlay.classList.contains('show'), false);
})();

(function(){
  storage = {};
  startDrill('square', 1, 5);
  finishSession();
  answerRight(); tick(1000);
  ok('the results box offers another go', typeof byId.prAgain.onclick, 'function');
  byId.prAgain.onclick();
  ok('Practice Again starts the same drill over', PR.mode.key, 'square');
  ok('from question one', PR.i, 0);
  ok('with the box closed', byId.prDoneOverlay.classList.contains('show'), false);
  finishSession();
  answerRight(); tick(1000);
  byId.prAnother.onclick();
  ok('Choose Another goes back to the list', byId.prDash.style.display, '');
  ok('and two sessions are on the record', prLoad().sessions, 2);
})();

head('goPractice with a target');
(function(){
  storage = {};
  goPractice({ mode:'tracker', level:3 });
  ok('the screen is practice', screens[screens.length - 1], 'practice');
  ok('a run is in progress', PR.view, 'run');
  ok('at the level asked', PR.level, 3);
  prShowDash();
  // a finished lesson floors the first session of its mode only
  lsnDoneStub = [5];
  ok('the tracker floor after lesson 5 is level 3', prStartLevel('tracker'), 3);
  var st = prLoad(); st.modes.tracker.sessions = 1; st.modes.tracker.level = 1; prSave(st);
  ok('but a measured level wins once there is one', prStartLevel('tracker'), 1);
})();

head('Daily training');
(function(){
  storage = {};
  lsnDoneStub = [];
  goPractice('daily');
  ok('a daily session rotates three modes', PR.mixed && PR.mixed.length, 3);
  ok('five minutes on the clock', PR.budgetMs, 300000);
  ok('the first question belongs to the first mode', PR.q && PR.q.kind, PR.mixed[0]);
  ok('progressive is never in the mix', PR.mixed.indexOf('progressive'), -1);
})();

(function(){
  // Three questions, three modes: PR.i is the running count of answers
  // given, so poking it directly and asking prNextQuestion to draw again is
  // the whole rotation rule (PR.mixed[PR.i % PR.mixed.length]) without
  // needing to actually answer each drill's own kind of question first.
  storage = {};
  lsnDoneStub = [];
  goPractice('daily');
  var kinds = [PR.q.kind];
  PR.i = 1; prNextQuestion(); kinds.push(PR.q.kind);
  PR.i = 2; prNextQuestion(); kinds.push(PR.q.kind);
  ok('three questions in a row visit all three modes',
     kinds.slice().sort().join(','), PR.mixed.slice().sort().join(','));
  ok('in the mix\'s own order', kinds.join(','), PR.mixed.join(','));
})();

(function(){
  // The staircase (prStep) measures a mode, not a session: it steps a level
  // up on three RIGHT answers in a row and down on two WRONG ones, reading
  // the one shared pair PR.runUp/PR.runDown. A Daily Practice session swaps
  // modes every question, so those two counters have to be swapped out for
  // the mode leaving the screen and back in for the mode arriving — without
  // that, three rights spread across three different modes reads as three
  // in a row for whichever mode happened to be showing on the third one, and
  // steps ITS level up on the strength of one right answer of its own. This
  // drives prScore directly rather than through prJudge — prJudge also
  // touches prSay/beep/prCtl, none of which the staircase itself cares about
  // — and prAdvance after each score, which is what a judged answer calls
  // next and what actually walks PR.i (and so the rotation) forward.
  storage = {};
  lsnDoneStub = [];
  goPractice('daily');
  var mixed = PR.mixed.slice();
  var start = {};
  for (var k = 0; k < mixed.length; k++) start[mixed[k]] = prLoad().modes[mixed[k]].level;

  prScore(true); prAdvance();   // mixed[0]: its own first right
  prScore(true); prAdvance();   // mixed[1]: its own first right
  prScore(true); prAdvance();   // mixed[2]: its own first right
  // three rights given in a row, but never three of the SAME mode's own —
  // nothing should have stepped up
  ok('three rights spread across three modes step nothing up',
     mixed.map(function(m){ return PR.mixedLevel[m]; }).join(','),
     mixed.map(function(m){ return start[m]; }).join(','));

  prScore(true); prAdvance();   // mixed[0] again: its own second right in a row
  prScore(false); prAdvance();  // mixed[1]: wrong — breaks mixed[1]'s own run only
  prScore(false); prAdvance();  // mixed[2]: wrong — breaks mixed[2]'s own run only
  prScore(true); prAdvance();   // mixed[0]: its own THIRD right in a row — steps up

  ok('the mode with three rights of its own in a row steps up',
     PR.mixedLevel[mixed[0]], start[mixed[0]] + 1);
  ok('the mode answered wrong in between does not',
     PR.mixedLevel[mixed[1]], start[mixed[1]]);
  ok('nor the other one', PR.mixedLevel[mixed[2]], start[mixed[2]]);
})();

(function(){
  // Ending a Daily Practice session the same way any drill ends one — spend
  // the budget (finishSession) and let the next judged answer call prFinish
  // — has to write every mode that was actually played, once each, and the
  // session/day totals once for the whole session, not once per mode.
  storage = {};
  lsnDoneStub = [];
  goPractice('daily');
  var mixed = PR.mixed.slice();
  prScore(true); prAdvance();   // mixed[0]
  prScore(true); prAdvance();   // mixed[1]
  prScore(true); prAdvance();   // mixed[2] — all three modes played at least once

  finishSession();
  prScore(true); prAdvance();   // the next judged answer ends it

  var st = prLoad();
  ok('the session total is written once, not once per mode', st.sessions, 1);
  ok('every mode actually played banked its own session',
     mixed.every(function(m){ return st.modes[m].sessions === 1; }), true);
})();

head('The account\'s copy: inert where there is no account half at all');
(function(){
  /* prFinish hands every mode it wrote to prPush, which reaches for `sb` —
     a name this harness does not have, because it lifts the PRACTICE section
     on its own and the ACCOUNTS section is somebody else's block. Reading an
     undeclared name throws, so prCloud()'s typeof guard is the whole of what
     keeps a drill working on a page whose Supabase never loaded, and this is
     the only suite in the repo that can tell the difference. */
  storage = {};
  lsnDoneStub = [];
  ok('this harness really has no client', typeof sb, 'undefined');

  goPractice();                      // back to the dashboard: the block above left a mix running
  startDrill('square', 1, 5);
  answerRight(); tick(1000);
  finishSession();
  answerRight(); tick(1000);
  ok('a session still finishes', byId.prDoneOverlay.classList.contains('show'), true);
  ok('and still lands on the record', prLoad().sessions, 1);

  var threw = null;
  try { prPush('square'); prPushCourse([1]); prSync(); }
  catch (e){ threw = (e && e.message) || String(e); }
  ok('and pushing by hand throws nothing either', threw, null);
})();

/* ============================================================
   9 — the rebuild interface
   One interface for every place a position is put back — Hold the Position,
   the tracker's last level, Progressive Blindfold's recovery — driven
   directly rather than through a drill, since prRebuildStart takes its
   target and callback straight from the caller.
   ============================================================ */
head('The rebuild interface');
(function(){
  var done = null;
  prRebuildStart([{sq:sqIndex('e1'),c:W,t:'K'},{sq:sqIndex('e8'),c:B,t:'K'},{sq:sqIndex('d4'),c:W,t:'N'}],
                 { say:'Rebuild it', done:function(r){ done = r; } });
  ok('a palette of twelve men and a clear button is up', prAnsEl.children.length, 13);
  prAnsEl.children[0].onclick();               // white king
  clickSquare(sqIndex('e1'));
  prAnsEl.children[6].onclick();               // black king
  clickSquare(sqIndex('e8'));
  prAnsEl.children[1].onclick();               // white queen, wrongly
  clickSquare(sqIndex('d4'));
  pressCtl('Done');
  ok('two right', done.right.length, 2);
  ok('one wrong', done.wrong.length, 1);
  ok('one missing', done.missing.length, 1);
  ok('the missing man is marked on its square', prSqEls[sqIndex('d4')].classList.contains('pr-miss'), true);
})();

/* ============================================================
   10 — the markup the code reaches for
   The stub hands back an element for any id asked of it, which is what makes
   the flow above runnable and what makes it blind to a typo. So the ids are
   checked against the page itself.
   ============================================================ */
head('Every element the drills reach for is in the page');

(function(){
  var block = grab(/\n\/\* =+\n   PRACTICE — the drills behind LESSON[\s\S]*?\n(?=\/\* =+\n   SCREENS)/,
                   'the PRACTICE section');
  var want = {}, m, re = /getElementById\('([^']+)'\)/g;
  while ((m = re.exec(block))) want[m[1]] = 1;
  var ids = Object.keys(want).sort();
  var missing = ids.filter(function(id){ return SRC.indexOf('id="' + id + '"') < 0; });
  ok('the drills name ' + ids.length + ' elements', ids.length > 25, true);
  ok('and every one of them is in the markup', missing.join(', '), '');

  // the same for the one selector the code uses — scoped to prSetLen itself,
  // since the ranked screen's own clock buttons carry data-min too
  var lenMarkup = SRC.match(/<div class="rank-opts row" id="prSetLen">[\s\S]*?<\/div>/);
  ok('the session-length buttons exist', !!lenMarkup, true);
  ok('and carry the minutes the code reads',
     ((lenMarkup && lenMarkup[0].match(/data-min="\d+"/g)) || []).length, 3);
  // the practice screen itself, and its place in the lane every other screen keeps
  ok('there is a practice screen', /id="screen-practice"/.test(SRC), true);
  ok('and it reserves the same lane as the rest', /#screen-practice\{?[^\n]*padding-left/.test(SRC) ||
     /#screen-game, #screen-practice\{position:relative; padding-left:var\(--rail\)/.test(SRC), true);
  ok('the Practice item in the LESSON menu is no longer marked unbuilt',
     /<button class="menu-btn" id="navPractice">/.test(SRC), true);
  ok('and it is wired to the page', /navPractice'\)\.onclick = goPractice/.test(SRC), true);
})();


say('\n' + passed + ' passed, ' + failed + ' failed\n');
if (typeof process !== 'undefined' && failed) process.exit(1);
