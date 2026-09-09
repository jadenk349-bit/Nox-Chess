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
function navSync(){}                       // the history layer lives outside the section
function goBot(){ botTrips++; }
function selectMode(m){ visionsPicked.push(m); }
// lsnDone() lives in the LESSONS section, outside the block this suite lifts;
// prStartLevel asks it by name (guarded by typeof, since a page with no
// LESSONS section loaded — this one — must not throw), so it is faked here.
var lsnDoneStub = [];
function lsnDone(){ return lsnDoneStub; }

/* ---- the real half ---- */
var DECLS = ['VAL','FILES','rowOf','colOf','SQNAME','uciOf','sqName','sqIndex','onBoard','other',
             'idCounter','mk','DIR_N','DIR_B','DIR_R','DIR_K','PST','nodes','PIECE_NAME',
             'GLYPH','pieceHTML','OPENING_BOOK','W'];
// Note: this suite lifts the whole PRACTICE section as one block below, so
// PR_VERSION, PR_V1_KEYS, PR_SEEN_MAX, prBlankMode, prUpgradeV1, prSeen,
// prSeenHas, prSeenPush, prSeenKey, prToday and prTouchDay all come along
// with it rather than needing their own DECLS/FNS entries.
var FNS = ['startBoard','newState','cloneState','fenOf','stateFromFEN',
           'slide','step','addPawn','pseudoMoves','isAttacked','kingSq','inCheck',
           'makeMove','legalMoves','toSAN','attackersOf','defendersOf','see',
           'mirror','evaluate','orderMoves','scoreMove','quiesce','negamax','bestMove',
           'parseMoveIn','bookMove','rebuildDiff','quadrantOf','lineBetween','linesThrough','knightRoute','sliderReaches'];
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
function typeAnswer(text){
  var input = null;
  for (var k = 0; k < prAnsEl.children.length; k++)
    if (prAnsEl.children[k].tag === 'input') input = prAnsEl.children[k];
  if (!input) throw new Error('no answer box on screen');
  input.value = text;
  prAnsEl.fire('submit');
  return input;
}
function marked(sq, cls){ return prSqEls[PR.flipped ? 63 - sq : sq].classList.contains(cls); }
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
  if (q.kind === 'track'){ clickSquare(q.end); return; }
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
  ok('every drill has a card', byId.prCards.children.length, PR_MODES.length);
  ok('with nothing to report yet', byId.prFigAcc.textContent, '—');
  ok('no sessions', byId.prFigSessions.textContent, 0);

  // there is no gate on any drill now — the old five-rung ladder that used to
  // hold the mini challenge back is gone, and nothing in the new PR_MODES
  // shape replaces it (Task 22 rebuilds this dashboard)
  var cards = byId.prCards.children;
  var progressive = cards[cards.length - 1];
  ok('the progressive challenge is open too', progressive.classList.contains('locked'), false);
  var first = cards[0];
  ok('the square drill is open', first.classList.contains('locked'), false);
  ok('and its button starts it', first.children[2].children[0].textContent, 'Start');
  ok('and says it has not been tried', first.children[3].innerHTML, 'Not tried yet');
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
  ok('the dashboard behind it has the session', byId.prFigSessions.textContent, 1);
  ok('and 100% accuracy', byId.prFigAcc.textContent, '100%');
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
   ============================================================ */
head('Move Tracker');

(function(){
  storage = {};
  startDrill('tracker', 1, 5);
  var q = PR.q;
  ok('the drill opens with the men in view', byId.prBoard.classList.contains('blind'), false);
  ok('and the piece named on its square', byId.prQ.innerHTML.indexOf(sqName(q.startAt[0])) >= 0, true);
  ok('nothing is asked before Ready', PR.click, null);
  ok('the moves are not shown yet', byId.prSeq.innerHTML, '');

  pressCtl('Ready');
  ok('Ready takes the men away', byId.prBoard.classList.contains('blind'), true);
  ok('and puts the moves up', byId.prSeq.innerHTML.indexOf(q.path[0].san) >= 0, true);
  ok('both of them', byId.prSeq.innerHTML.indexOf(q.path[1].san) >= 0, true);
  ok('now a square can be clicked', PR.click !== null, true);

  var wrong = elsewhere(q.end);
  clickSquare(wrong);
  ok('the wrong square is marked wrong', /wrong/.test(byId.prSay.className), true);
  ok('and the right one shown', marked(q.end, 'pr-right'), true);
  ok('with a way to see the path', ctlButton('Reveal the path') !== null, true);

  pressCtl('Reveal the path');
  tick(400);
  ok('the reveal brings the men back', byId.prBoard.classList.contains('blind'), false);
  tick(2500);
  ok('and walks to the square the piece finished on', marked(q.end, 'pr-right'), true);
  ok('saying so', byId.prSub.innerHTML.indexOf(sqName(q.end)) >= 0, true);

  pressCtl('Next');
  var q2 = PR.q;
  pressCtl('Ready');
  clickSquare(q2.end);
  ok('the right square is marked right', /right/.test(byId.prSay.className), true);
  prShowDash();
})();

(function(){
  storage = {};
  startDrill('tracker', 3, 5);
  var q = PR.q;
  ok('the hardest setting follows two pieces', q.ids.length, 2);
  ok('over five moves', q.path.length, 5);
  ok('and the question names which one',
     byId.prQ.innerHTML.indexOf(PIECE_NAME[q.askType]) >= 0 ||
     (pressCtl('Ready'), byId.prQ.innerHTML.indexOf(PIECE_NAME[q.askType]) >= 0), true);
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
   7 — blindfold sequence
   No PR_MODES entry, no way in from the dashboard, until Task 14 gives it one
   — the generator stays proven directly, the way Square Colour's did before
   Square Trainer's ladder absorbed it.
   ============================================================ */
head('Blindfold Sequence (generator only — no PR_MODES entry until Task 14)');

(function(){
  var q = prMakeSequence(1);
  ok('the easiest setting is still buildable directly', !!q, true);
  ok('and opens from the usual position', q.fromStart, true);
})();

/* ============================================================
   8 — the progressive blindfold challenge
   ============================================================ */
head('Progressive Blindfold Challenge');

(function(){
  storage = {};
  startDrill('progressive', 1, 0);
  ok('the challenge sets its own length', PR.len, PR.q.target);
  ok('the position is there to learn', byId.prBoard.classList.contains('blind'), false);
  ok('and it says you are White', /you have White/.test(byId.prQ.innerHTML), true);
  ok('no log until it begins', byId.prLog.style.display, 'none');

  pressCtl('Ready');
  ok('Ready darkens the board', byId.prBoard.classList.contains('blind'), true);
  ok('the log opens', byId.prLog.style.display, '');
  ok('with a word about what happens now', byId.prLog.children.length, 1);
  ok('Reveal Position is offered', ctlButton('Reveal Position') !== null, true);
  ok('and a Restart that means this position again', ctlButton('Restart Position') !== null, true);
  ok('the counter counts moves, not questions', byId.prStatQCap.textContent, 'Move');

  typeAnswer('Qz9');
  ok('a move that is not there is refused', byId.prLog.children.length, 2);
  ok('and counted, because that is the failure being measured', PR.i, 1);
  ok('but nothing was played', PR.played, 0);

  // play it out with legal moves until the run ends
  var guard = 0;
  while (!PR.mini.over && guard++ < 40){
    var all = legalMoves(PR.mini.st, PR.mini.st.turn);
    if (!all.length) break;
    typeAnswer(toSAN(PR.mini.st, all[0], all));
    tick(1000);                              // the reply comes after a beat
  }
  ok('the run ended', PR.mini.over, true);
  ok('with moves actually played', PR.played > 0, true);
  ok('the board comes back at the end', byId.prBoard.classList.contains('blind'), false);
  ok('and the result box is up', byId.prDoneOverlay.classList.contains('show'), true);
  ok('reporting the moves', /Moves played/.test(byId.prDoneRows.children[0].innerHTML), true);

  if (PR.played >= PR.len){
    ok('finishing it offers a blindfold game', byId.prBlindGame.style.display, '');
    byId.prBlindGame.onclick();
    ok('which goes to the setup that already exists', botTrips, 1);
    ok('with complete blindfold chosen', visionsPicked[visionsPicked.length - 1], 'total');
    ok('and the result box closed behind it', byId.prDoneOverlay.classList.contains('show'), false);
  } else {
    ok('a run that ended early does not offer the game', byId.prBlindGame.style.display, 'none');
  }
  storage = {};
})();

(function(){
  storage = {};
  var st = prBlank();
  st.sessions = 10; st.asked = 100; st.correct = 80;
  for (var k = 0; k < 4; k++) st.modes[PR_MODES[k].key].sessions = 2;
  prSave(st);
  startDrill('progressive', 1, 0);
  pressCtl('Ready');
  pressCtl('Reveal Position');
  ok('Reveal shows the position', byId.prBoard.classList.contains('blind'), false);
  tick(3000);
  ok('and it goes dark again on its own', byId.prBoard.classList.contains('blind'), true);
  var before = PR.q;
  typeAnswer(toSAN(PR.mini.st, legalMoves(PR.mini.st, 'w')[0], legalMoves(PR.mini.st, 'w')));
  tick(1000);
  ok('a move was played', PR.played, 1);
  pressCtl('Restart Position');
  ok('Restart Position replays the same position', PR.q, before);
  ok('from the top', PR.played, 0);
  ok('with the log cleared', byId.prLog.children.length, 0);
  ok('and the board there to learn again', byId.prBoard.classList.contains('blind'), false);
  storage = {};
})();

/* ============================================================
   9 — leaving, restarting, and the record
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

(function(){
  storage = {};
  var st = prBlank();
  st.sessions = 2; st.asked = 40; st.correct = 30;
  st.modes.square.sessions = 1; st.modes.piece.sessions = 1;
  prSave(st);
  prShowDash();
  ok('accuracy is reported', byId.prFigAcc.textContent, '75%');
  ok('and the sessions', byId.prFigSessions.textContent, 2);

  startDrill('square', 1, 5);
  finishSession();
  answerRight(); tick(1000);
  ok('the session finished', byId.prDoneOverlay.classList.contains('show'), true);
  byId.prToLessons.onclick();
  ok('Back to Lessons leads home', screens[screens.length - 1], 'home');
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

/* ============================================================
   10 — the rebuild interface
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
   11 — the markup the code reaches for
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
