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

/* ---- a clock that only moves when this file moves it ---- */
var clockNow = 0, timerId = 0, pending = [];
var Date = { now: function(){ return clockNow; } };
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
bySelector['#prSetLen button'] = [5, 10, 20].map(function(n){
  var b = new El('button');
  b.dataset.len = String(n);
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
function goBot(){ botTrips++; }
function selectMode(m){ visionsPicked.push(m); }

/* ---- the real half ---- */
var DECLS = ['VAL','FILES','rowOf','colOf','SQNAME','uciOf','sqName','onBoard','other',
             'idCounter','mk','DIR_N','DIR_B','DIR_R','DIR_K','PST','nodes','PIECE_NAME',
             'GLYPH','pieceHTML','W'];
var FNS = ['startBoard','newState','cloneState','fenOf','stateFromFEN',
           'slide','step','addPawn','pseudoMoves','isAttacked','kingSq','inCheck',
           'makeMove','legalMoves','toSAN','attackersOf','defendersOf','see',
           'mirror','evaluate','orderMoves','scoreMove','quiesce','negamax','bestMove',
           'parseMoveIn'];
var bundle = [grab(/\nconst W = 'w', B = 'b';/, "const W/B")];
// a multi-line string rather than an object, so neither shape of decl() fits it
bundle.push(grab(/\nconst BISHOP_SVG =\n[\s\S]*?';\n/, 'BISHOP_SVG'));
for (var d = 0; d < DECLS.length; d++) if (DECLS[d] !== 'W') bundle.push(decl(DECLS[d]));
for (var f = 0; f < FNS.length; f++) bundle.push(fn(FNS[f]));
// the whole PRACTICE section, top level and all — this is the screen itself
bundle.push(grab(/\n\/\* =+\n   PRACTICE — the drills behind LESSON[\s\S]*?\n(?=\/\* =+\n   SCREENS)/,
                 'the PRACTICE section'));
eval(bundle.join('\n').replace(/(^|\n)(?:const|let) /g, '$1var '));

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
function startDrill(key, diff, len){
  storageOwner();
  var mode = null;
  for (var k = 0; k < PR_MODES.length; k++) if (PR_MODES[k].key === key) mode = PR_MODES[k];
  prOpenSetup(mode);
  prSetLevel = diff;
  if (len) prSetCount = len;
  byId.prSetGo.onclick();
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
  if (q.kind === 'coord'){
    if (q.findIt) clickSquare(q.sq); else typeAnswer(sqName(q.sq));
    return;
  }
  if (q.kind === 'color'){ ansButton(q.dark ? 'Dark' : 'Light').onclick(); return; }
  if (q.kind === 'vision'){
    Array.from(q.targets).forEach(clickSquare);
    ansButton('Check').onclick();
    return;
  }
  if (q.kind === 'track'){ clickSquare(q.end); return; }
  answerAskRight(q.ask);
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
    for (var k = 0; k < ask.want.length; k++) clickSquare(ask.want[k].sq);
    return;
  }
  throw new Error('unknown question type ' + ask.t);
}
/** A square that is definitely not the answer. */
function elsewhere(not){
  for (var i = 0; i < 64; i++) if (i !== not) return i;
  return 0;
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
  ok('a fresh player is a Beginner', byId.prLevel.textContent, 'Beginner');
  ok('with nothing to report yet', byId.prFigAcc.textContent, '—');
  ok('no sessions', byId.prFigSessions.textContent, 0);
  ok('and the level bar is empty', byId.prLevelFill.style.width, '0%');
  ok('the next rung is named', byId.prLevelNext.textContent, 'Visualizer');

  var cards = byId.prCards.children;
  var mini = cards[cards.length - 1];
  ok('the mini challenge is locked at Beginner', mini.classList.contains('locked'), true);
  var miniGo = mini.children[2].children[1];
  ok('its button says so', miniGo.textContent, 'Locked');
  ok('and does nothing', miniGo.onclick, null);
  var first = cards[0];
  ok('the coordinate drill is open', first.classList.contains('locked'), false);
  ok('and its button starts it', first.children[2].children[1].textContent, 'Start');
  ok('each card carries a difficulty indicator', /class="on"/.test(first.children[2].children[0].innerHTML), true);
  ok('and says it has not been tried', first.children[3].innerHTML, 'Not tried yet');
})();

/* ============================================================
   2 — the coordinate trainer, start to finish
   ============================================================ */
head('Coordinate Trainer');

(function(){
  storage = {};
  startDrill('coord', 1, 5);
  ok('the drill screen is up', byId.prRun.style.display, '');
  ok('and the dashboard is put away', byId.prDash.style.display, 'none');
  ok('the panel names the skill', byId.prSkill.textContent, 'Coordinates');
  ok('the board is shown', byId.prFrame.style.display, '');
  ok('and the session counter starts at one of five', byId.prStatQ.textContent, '1 / 5');
  ok('the orientation is spelled out', /White's view/.test(byId.prOrient.textContent), true);

  var asked = 0, both = {};
  while (PR.i < 5){
    both[PR.q.findIt ? 'find' : 'name'] = 1;
    asked++;
    answerRight();
    ok('answer ' + asked + ' was marked right', /right/.test(byId.prSay.className), true);
    tick(1000);                       // a right answer moves on by itself
  }
  ok('five questions were asked', asked, 5);
  ok('and the session finished', byId.prDoneOverlay.classList.contains('show'), true);
  ok('with the title it promises', byId.prDoneTitle.textContent, 'Practice Complete');
  ok('accuracy on the result card', /5 \/ 5/.test(byId.prDoneRows.children[0].innerHTML), true);
  ok('best streak too', /<b>5<\/b>/.test(byId.prDoneRows.children[1].innerHTML), true);
  ok('and the skill it practised', /Coordinates/.test(byId.prDoneRows.children[2].innerHTML), true);
  ok('the dashboard behind it has the session', byId.prFigSessions.textContent, 1);
  ok('and 100% accuracy', byId.prFigAcc.textContent, '100%');
})();

(function(){
  // both exercise types, and a wrong answer in each
  storage = {};
  startDrill('coord', 2, 20);
  ok('the middle setting drops the coordinate labels',
     prSqEls[56].innerHTML === '' && prSqEls[0].innerHTML === '', true);

  var sawFind = false, sawName = false;
  for (var k = 0; k < 12 && !(sawFind && sawName); k++){
    var q = PR.q;
    if (q.findIt && !sawFind){
      sawFind = true;
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
    } else if (!q.findIt && !sawName){
      sawName = true;
      var input = typeAnswer('zz');
      ok('nonsense in the box is refused, not counted', PR.i, PR.i);
      ok('and it says what a square looks like', /told/.test(byId.prSay.className), true);
      typeAnswer(sqName(q.sq));
      ok('the right name is accepted', /right/.test(byId.prSay.className), true);
      tick(1000);
    } else {
      answerRight();
      tick(1000);
      if (ctlButton('Next')) pressCtl('Next');
    }
  }
  ok('both exercise types came up', sawFind && sawName, true);
  prShowDash();
})();

(function(){
  storage = {};
  startDrill('coord', 3, 20);
  var flipped = 0;
  for (var k = 0; k < 40; k++){
    if (PR.q.flipped) flipped++;
    answerRight();
    tick(1000);
    if (PR.i >= PR.len) break;
    if (ctlButton('Next')) pressCtl('Next');
  }
  ok('the hardest setting turns the board round sometimes', flipped > 0, true);
  prShowDash();
})();

/* ============================================================
   3 — square colour
   ============================================================ */
head('Square Colour');

(function(){
  storage = {};
  startDrill('color', 3, 5);
  ok('the hardest setting takes the board away', byId.prFrame.style.display, 'none');
  ok('and the note in its place is shown', byId.prNoBoard.style.display, '');
  ok('the orientation line goes with it', byId.prOrient.style.display, 'none');
  var q = PR.q;
  ansButton(q.dark ? 'Light' : 'Dark').onclick();
  ok('a wrong colour is marked wrong', /wrong/.test(byId.prSay.className), true);
  ok('and the board comes back to show it', byId.prFrame.style.display, '');
  ok('with the square marked', marked(q.sq, 'pr-wrong'), true);
  ok('and the rule explained', /parity/.test(byId.prSay.innerHTML), true);
  pressCtl('Next');
  ok('the next question hides the board again', byId.prFrame.style.display, 'none');
  var q2 = PR.q;
  ansButton(q2.dark ? 'Dark' : 'Light').onclick();
  ok('the right colour is marked right', /right/.test(byId.prSay.className), true);
  ok('and the square is shown in green', marked(q2.sq, 'pr-right'), true);
  prShowDash();
})();

(function(){
  storage = {};
  startDrill('color', 1, 5);
  ok('the easiest setting shows the board', byId.prFrame.style.display, '');
  ok('and labels it', prSqEls[56].innerHTML.indexOf('coord') >= 0, true);
  prShowDash();
})();

/* ============================================================
   4 — piece visualization
   ============================================================ */
head('Piece Visualization');

(function(){
  storage = {};
  startDrill('vision', 2, 5);
  var q = PR.q;
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
  ansButton('Check').onclick();
  ok('a partly-right answer is wrong', /wrong/.test(byId.prSay.className), true);
  ok('the square that was right is green', marked(targets[0], 'pr-right'), true);
  ok('the one that was not is red', marked(stray, 'pr-wrong'), true);
  if (targets.length > 1) ok('and the missed ones are ringed', marked(targets[1], 'pr-miss'), true);
  ok('the full answer is spelled out',
     byId.prSay.innerHTML.indexOf(sqName(targets[targets.length - 1])) >= 0, true);
  pressCtl('Next');

  var q2 = PR.q;
  Array.from(q2.targets).forEach(clickSquare);
  ansButton('Check').onclick();
  ok('every square, and only those, is right', /right/.test(byId.prSay.className), true);
  ok('and it says how many there were',
     byId.prSay.innerHTML.indexOf('All ' + q2.targets.size) >= 0, true);
  prShowDash();
})();

/* ============================================================
   5 — piece tracking
   ============================================================ */
head('Piece Tracking');

(function(){
  storage = {};
  startDrill('track', 1, 5);
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
  startDrill('track', 3, 5);
  var q = PR.q;
  ok('the hardest setting follows two pieces', q.ids.length, 2);
  ok('over five moves', q.path.length, 5);
  ok('and the question names which one',
     byId.prQ.innerHTML.indexOf(PIECE_NAME[q.askType]) >= 0 ||
     (pressCtl('Ready'), byId.prQ.innerHTML.indexOf(PIECE_NAME[q.askType]) >= 0), true);
  prShowDash();
})();

/* ============================================================
   6 — position memory
   ============================================================ */
head('Position Memory');

(function(){
  storage = {};
  startDrill('memory', 1, 5);
  var q = PR.q;
  ok('the position is on the board to study', byId.prBoard.classList.contains('blind'), false);
  ok('and it says how many men there are', /Study this position/.test(byId.prQ.innerHTML), true);
  ok('with a countdown', /go dark in/.test(byId.prSub.innerHTML), true);
  ok('nothing is asked yet', PR.click, null);

  tick(7200);                                        // let the study time run out
  ok('the men go dark when it does', byId.prBoard.classList.contains('blind'), true);
  ok('and the question arrives', byId.prQ.innerHTML.length > 0, true);
  ok('with a way to see the position again', ctlButton('Reveal the position') !== null, true);

  answerAskRight(q.ask);
  ok('the right answer is marked right', /right/.test(byId.prSay.className), true);
  ok('memory never rushes you on', PR.answered && ctlButton('Next') !== null, true);
  pressCtl('Reveal the position');
  ok('Reveal brings the position back', byId.prBoard.classList.contains('blind'), false);
  ok('and says it is the real one', /actually stood/.test(byId.prSub.innerHTML), true);

  pressCtl('Next');
  ok('and the next position is up to study', byId.prBoard.classList.contains('blind'), false);
  prShowDash();
})();

(function(){
  // Ready cuts the study short, and cannot fire the question twice
  storage = {};
  startDrill('memory', 2, 5);
  pressCtl('Ready');
  ok('Ready ends the study early', byId.prBoard.classList.contains('blind'), true);
  var asked = byId.prQ.innerHTML;
  tick(9000);
  ok('and the countdown that was still running changes nothing', byId.prQ.innerHTML, asked);
  prShowDash();
})();

/* ============================================================
   7 — blindfold sequence
   ============================================================ */
head('Blindfold Sequence');

(function(){
  storage = {};
  startDrill('sequence', 1, 5);
  var q = PR.q;
  ok('the easiest one opens from the usual position', /usual starting position/.test(byId.prQ.innerHTML), true);
  ok('with the men in view', byId.prBoard.classList.contains('blind'), false);
  pressCtl('Ready');
  ok('Ready hides them', byId.prBoard.classList.contains('blind'), true);
  ok('and the moves appear in notation', byId.prSeq.innerHTML.indexOf(q.sans[0]) >= 0, true);
  ok('numbered', /<b>1\.<\/b>/.test(byId.prSeq.innerHTML), true);
  ok('both plies', byId.prSeq.innerHTML.indexOf(q.sans[1]) >= 0, true);
  answerAskRight(q.ask);
  ok('the answer is judged', PR.answered, true);
  ok('and the position can be revealed', ctlButton('Reveal the position') !== null, true);
  pressCtl('Reveal the position');
  ok('which shows it', byId.prBoard.classList.contains('blind'), false);
  prShowDash();
})();

(function(){
  // the hardest setting, including a rebuild when one comes up
  storage = {};
  var rebuilt = false;
  for (var t = 0; t < 25 && !rebuilt; t++){
    startDrill('sequence', 3, 20);
    if (PR.q.ask.t !== 'rebuild'){ prShowDash(); continue; }
    rebuilt = true;
    var q = PR.q;
    ok('six plies or more at the hardest setting', q.sans.length >= 6, true);
    pressCtl('Ready');
    ok('a rebuild names the first man to place', /Place/.test(byId.prQ.innerHTML), true);
    ok('and says how many there are', /1 of 3/.test(byId.prQ.innerHTML), true);
    clickSquare(q.ask.want[0].sq);
    ok('placing one moves to the next', /2 of 3/.test(byId.prQ.innerHTML), true);
    ok('and nothing is judged yet', PR.answered, false);
    clickSquare(q.ask.want[1].sq);
    clickSquare(q.ask.want[2].sq);
    ok('the third finishes it', PR.answered, true);
    ok('all three right is right', /right/.test(byId.prSay.className), true);
    ok('and it lists what stood where', /on <b>/.test(byId.prSay.innerHTML), true);
  }
  ok('a rebuild question came up at the hardest setting', rebuilt, true);
  prShowDash();
})();

/* ============================================================
   8 — the mini blindfold challenge
   ============================================================ */
head('Mini Blindfold Challenge');

(function(){
  storage = {};
  // earn it first: the card is locked below Tracker
  var st = prBlank();
  st.sessions = 10; st.asked = 100; st.correct = 80;
  for (var k = 0; k < 4; k++) st.modes[PR_MODES[k].key].sessions = 2;
  prSave(st);
  prShowDash();
  var cards = byId.prCards.children;
  var mini = cards[cards.length - 1];
  ok('at Tracker the mini challenge unlocks', mini.classList.contains('locked'), false);
  ok('and its button starts it', mini.children[2].children[1].textContent, 'Start');

  startDrill('mini', 1, 0);
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
  startDrill('mini', 1, 0);
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
  startDrill('memory', 3, 20);
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
  startDrill('coord', 1, 10);
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
  startDrill('coord', 1, 5);
  answerRight(); tick(1000);
  var q = PR.q;
  clickSquare(q.findIt ? elsewhere(q.sq) : q.sq);
  if (!q.findIt) typeAnswer('a1' === sqName(q.sq) ? 'h8' : 'a1');
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
  // the setup box, and what it remembers
  storage = {};
  var mode = PR_MODES[0];
  prOpenSetup(mode);
  ok('the setup box opens', byId.prSetOverlay.classList.contains('show'), true);
  ok('naming the drill', byId.prSetName.textContent, mode.name);
  ok('with three settings to choose from', byId.prSetDiff.children.length, 3);
  ok('each spelling out what changes', /Easy — /.test(byId.prSetDiff.children[0].textContent), true);
  ok('and a length to pick', byId.prSetLenField.style.display, '');
  byId.prSetDiff.children[2].onclick();
  ok('the hardest one lights up', byId.prSetDiff.children[2].classList.contains('active'), true);
  byId.prSetGo.onclick();
  ok('Begin closes the box', byId.prSetOverlay.classList.contains('show'), false);
  ok('and runs the setting that was chosen', PR.diff, 3);
  while (PR.i < PR.len){ answerRight(); tick(1000); if (ctlButton('Next')) pressCtl('Next'); }
  prShowDash();
  prOpenSetup(mode);
  ok('and next time it opens on the setting last used',
     byId.prSetDiff.children[2].classList.contains('active'), true);
  byId.prSetX.onclick();
  ok('the close button puts it away', byId.prSetOverlay.classList.contains('show'), false);

  var mini = PR_MODES[PR_MODES.length - 1];
  prOpenSetup(mini);
  ok('the mini challenge asks no length — it has its own', byId.prSetLenField.style.display, 'none');
  byId.prSetX.onclick();
})();

(function(){
  storage = {};
  var st = prBlank();
  st.sessions = 2; st.asked = 40; st.correct = 30;
  st.modes.coord.sessions = 1; st.modes.color.sessions = 1;
  prSave(st);
  prShowDash();
  ok('a part-finished ladder shows a part-filled bar',
     byId.prLevelFill.style.width !== '0%' && byId.prLevelFill.style.width !== '100%', true);
  ok('accuracy is reported', byId.prFigAcc.textContent, '75%');
  ok('and the sessions', byId.prFigSessions.textContent, 2);

  // one more session takes it over the Visualizer line
  startDrill('coord', 1, 5);
  while (PR.i < PR.len){ answerRight(); tick(1000); }
  ok('the level moved up', byId.prLevel.textContent, 'Visualizer');
  ok('and the box said so', /Visualizer/.test(byId.prDoneTip.innerHTML), true);
  byId.prToLessons.onclick();
  ok('Back to Lessons leads home', screens[screens.length - 1], 'home');
  ok('and closes the box', byId.prDoneOverlay.classList.contains('show'), false);
})();

(function(){
  storage = {};
  startDrill('coord', 1, 5);
  while (PR.i < PR.len){ answerRight(); tick(1000); }
  ok('the results box offers another go', typeof byId.prAgain.onclick, 'function');
  byId.prAgain.onclick();
  ok('Practice Again starts the same drill over', PR.mode.key, 'coord');
  ok('from question one', PR.i, 0);
  ok('with the box closed', byId.prDoneOverlay.classList.contains('show'), false);
  while (PR.i < PR.len){ answerRight(); tick(1000); }
  byId.prAnother.onclick();
  ok('Choose Another goes back to the list', byId.prDash.style.display, '');
  ok('and two sessions are on the record', prLoad().sessions, 2);
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

  // the same for the one selector the code uses
  ok('the session-length buttons exist', /id="prSetLen"/.test(SRC), true);
  ok('and carry the lengths the code reads',
     (SRC.match(/data-len="\d+"/g) || []).length, 3);
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
