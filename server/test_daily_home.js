/* Solving the four Daily Puzzles on the home page itself.
 *
 *   node server/test_daily_home.js
 *
 * test_daily.js is about the rotation and about the Daily corpus never meeting
 * the Puzzle page's. This one is about the thing the home page now actually
 * does: four live puzzles, side by side, played where they are drawn.
 *
 * The four widgets are not a second puzzle implementation and this suite is
 * mostly a way of saying so. Every judgement they make is made by the function
 * the Puzzle page calls — puzzleStep() decides right from wrong, legalMoves()
 * and makeMove() are the rules, parseMoveIn() reads Complete Blindfold's
 * notation, visibleSet()'s rule hides Fog of War, pzExplain() and pzSwingHTML()
 * write the card, pzFollowOf() finds the follow-up and pzMark() records the
 * solve. What a widget owns is its own state and its own painting, because
 * render() reads `G` and four boards cannot share one.
 *
 * So the checks below play the shipped puzzles for real: right moves, wrong
 * moves, the forced defence, multi-move lines, completion, persistence, and —
 * the one that would be silent if it broke — that a hidden vision is actually
 * hiding something.
 */

var PAGE = 'blind-chess.html';

function slurp(p){
  if (typeof readFile === 'function') return readFile(p);
  return require('fs').readFileSync(p, 'utf8');
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
  var block = SRC.match(new RegExp('\\n(?:const|let) ' + n + '\\s*=\\s*[\\{\\[](?!\\];|\\};)[\\s\\S]*?\\n[\\}\\]];'));
  if (block) return block[0];
  return grab(new RegExp('\\n(?:const|let) ' + n + '\\b[^\\n]*?;'), n);
};

/* ---- a DOM real enough to build a board in ----
   Thin, but not as thin as the other suites': these widgets create their own
   elements, keep a map of pieces by id, and toggle classes that decide whether
   a man is on the screen at all. A classList that forgets would make the fog
   checks below pass while showing everything. */
function fakeEl(tag){
  var e = {
    tag: tag || 'div', textContent: '', className: '', id: '', value: '',
    disabled: false, spellcheck: false, type: '', placeholder: '', autocomplete: '',
    style: {}, dataset: {}, children: [], parent: null, listeners: {},
    _html: '',
    get innerHTML(){ return this._html; },
    /* Enough of a parser for what the page actually does with it: the piece
       element is built as `<span></span>` and then reached through firstChild,
       so a non-empty assignment has to leave something there. Anything richer
       is read back as text by these tests, never walked. */
    set innerHTML(v){
      this._html = String(v);
      this.children = [];
      if (this._html !== '' && this._html.indexOf('<') >= 0){
        var kid = fakeEl('span');
        kid.parent = this;
        this.children.push(kid);
      }
    },
    get firstChild(){ return this.children[0] || null; },
    classList: {
      _s: {},
      add: function(c){ this._s[c] = true; },
      remove: function(c){ delete this._s[c]; },
      contains: function(c){ return !!this._s[c]; },
      toggle: function(c, on){ if (on === undefined) on = !this._s[c]; if (on) this._s[c] = true; else delete this._s[c]; }
    },
    appendChild: function(c){ c.parent = this; this.children.push(c); return c; },
    remove: function(){
      if (!this.parent) return;
      var i = this.parent.children.indexOf(this);
      if (i >= 0) this.parent.children.splice(i, 1);
    },
    setAttribute: function(k, v){ this[k] = v; },
    addEventListener: function(k, f){ (this.listeners[k] = this.listeners[k] || []).push(f); },
    querySelector: function(){ return null; },
    querySelectorAll: function(){ return []; },
    closest: function(){ return null; },
    focus: function(){}
  };
  e.classList = Object.create(e.classList);
  e.classList._s = {};
  return e;
}
/** Every element under one, flattened — how the tests count boards. */
function all(e, out){
  out = out || [];
  for (var i = 0; i < e.children.length; i++){ out.push(e.children[i]); all(e.children[i], out); }
  return out;
}
function withClass(root, cls){
  return all(root).filter(function(e){ return (' ' + e.className + ' ').indexOf(' ' + cls + ' ') >= 0; });
}

var elements = {};
var document = {
  getElementById: function(id){ return elements[id] || (elements[id] = fakeEl()); },
  createElement: function(t){ return fakeEl(t); },
  querySelector: function(){ return null; },
  querySelectorAll: function(){ return []; }
};
var storage = {};
var localStorage = {
  getItem: function(k){ return Object.prototype.hasOwnProperty.call(storage, k) ? storage[k] : null; },
  setItem: function(k, v){ storage[k] = String(v); },
  removeItem: function(k){ delete storage[k]; }
};
var sounds = 0, flashed = 0;
function beep(){ sounds++; }
function reject(){ flashed++; }
function alert(){}
function render(){}
function pzRender(){}
// the glyphs are art, and a template literal the extractor cannot lift;
// what matters here is that a man is drawn at all, not what he looks like
function pieceHTML(t){ return '<i>' + t + '</i>'; }
function pzPush(){}
var account = null, sb = null;
var GUEST = function(){ return true; };
var signups = 0;
function toSignUp(){ signups++; }
var opened = [];
function pzOpen(n){ opened.push({ n: n, daily: PZ.daily, vision: PZ.vision }); }
var timers = [];
function setTimeout(f){ timers.push(f); return timers.length; }
function flush(){ for (var g = 0; timers.length && g < 400; g++) timers.shift()(); }

/* ---- the real half ---- */
var DECLS = ['VAL','FILES','rowOf','colOf','SQNAME','uciOf','sqName','onBoard','other',
             'idCounter','mk','DIR_N','DIR_B','DIR_R','DIR_K','PIECE_WORD',
             'PZ_PIECE_RANK','sqIndex','PZ_MATE_CP',
             'PZ','PZ_STORE','PZ_VERSION','pzOwner','pzKey','PZ_TRACK_NAME','PZ_TRACKS',
             'DAILY_CYCLE','DAILY_VERSION','DAILY_MODES','DAILY_MODE','DAILY',
             'DW_REPLY_MS','DW','dwSolver','dwVisual'];
var FNS = ['startBoard','newState','cloneState','posKey','fenOf','stateFromFEN',
           'slide','step','addPawn','pseudoMoves','isAttacked','kingSq','inCheck',
           'makeMove','legalMoves','toSAN','attackersOf','defendersOf','see',
           'sliderLines','betweenSq','findMotifs','winPct','sacrificeSize',
           'pvLine','materialFor','materialWord','describeBest',
           'puzzleStep','pzStored','pzProgress','pzWrite','pzMark','pzDone',
           'pzEsc','pzExplainPlain','pzExplain','pzWinPct','pzSwing','pzSwingHTML','pzSanOf',
           'pzFollowOf','pzPieceList','parseMoveIn','visibleSet',
           'dailyPick','dailyDone','dailyOpen',
           /* the widget layer itself */
           'dwState','dwShows','dwPaint','dwMenHTML','dwLine','dwPlay','dwFinish','dwFollow',
           'dwClick','dwTyped','dwBuild','dwRender','dailyRender'];

var bundle = [grab(/\nconst W = 'w', B = 'b';/, "const W/B")];
for (var d = 0; d < DECLS.length; d++) bundle.push(decl(DECLS[d]));
bundle.push(grab(/\nconst dailyScope = [^\n]*;/, 'dailyScope'));
for (var f = 0; f < FNS.length; f++) bundle.push(fn(FNS[f]));
bundle.push('for (var _m = 0; _m < DAILY_MODES.length; _m++) DAILY_MODE[DAILY_MODES[_m].key] = DAILY_MODES[_m];');
eval(bundle.join('\n').replace(/(^|\n)(?:const|let) /g, '$1var '));

var passed = 0, failed = 0;
function check(label, got, want){
  if (got === want){ passed++; say('  PASS  ' + label + '  ->  ' + got); }
  else { failed++; say('  FAIL  ' + label + '\n        got  ' + got + '\n        want ' + want); }
}

/* ---- the shipped corpus ---- */
var MODES = ['blindfold', 'board', 'fog', 'sighted'];
var VISION = { blindfold:'total', board:'blind', fog:'fog', sighted:'sighted' };
var daily = {}, missing = [];
for (var i = 0; i < MODES.length; i++){
  try { daily[MODES[i]] = JSON.parse(slurp('puzzles/daily/' + MODES[i] + '.json')); }
  catch (e){ daily[MODES[i]] = []; missing.push(MODES[i]); }
}
if (missing.length === MODES.length){
  say('\n  no Daily corpus installed — nothing to solve\n');
  say('0 passed, 0 failed');
  if (typeof process !== 'undefined') process.exit(0);
}

/** Put the four of a given day on the page and return the widgets. */
function home(day){
  storage = {};
  DW.boards = {};
  DAILY.index = day;
  DAILY.failed = {};
  DAILY.lists = {};
  for (var k = 0; k < MODES.length; k++) DAILY.lists[MODES[k]] = daily[MODES[k]];
  elements.dailyGrid = fakeEl();
  elements.dailyNote = fakeEl();
  dailyRender();
  return DW.boards;
}
/** Play a whole solution on a widget, one move at a time, flushing the
    forced defence between. Returns how many of the player's moves were made. */
function solve(w){
  var made = 0;
  for (var guard = 0; guard < 40 && !w.done; guard++){
    var u = w.puzzle.moves[w.ply];
    if (!u) break;
    var m = legalMoves(w.st, w.st.turn).find(function(x){ return uciOf(x) === u; });
    if (!m) break;
    dwPlay(w, m);
    made++;
    flush();
  }
  return made;
}

say('\n1. The home page draws three boards and one console\n');
(function layout(){
  var w = home(6);
  var grid = elements.dailyGrid;
  check('four widgets are on the page', grid.children.length, 4);
  check('each carries its mode key',
        grid.children.map(function(c){ return c.dataset.mode; }).join(','),
        'blindfold,board,fog,sighted');
  check('each keeps the id the tests and the CSS use',
        grid.children.map(function(c){ return c.id; }).join(','),
        'daily-blindfold,daily-board,daily-fog,daily-sighted');
  check('three of them hold a board', withClass(grid, 'board').length, 3);
  check('...and they are the three with squares to click',
        MODES.filter(function(k){ return !!w[k].els.board; }).join(','), 'board,fog,sighted');
  check('Complete Blindfold has no board at all', !!w.blindfold.els.board, false);
  check('...it has a move console instead', !!w.blindfold.els.input, true);
  check('exactly one console on the page', withClass(grid, 'dw-console').length, 1);
  check('each board has sixty-four squares',
        MODES.filter(function(k){ return w[k].sqEls; })
             .map(function(k){ return w[k].sqEls.length; }).join(','), '64,64,64');
  check('the section says when they change',
        /midnight UTC/.test(elements.dailyNote.textContent), true);
})();

say('\n2. They are the puzzles, not links to them\n');
(function notLinks(){
  var src = fn('dailyRender') + fn('dwBuild') + fn('dwRender');
  check('nothing in the widgets opens the puzzle screen to solve',
        /onclick = \(\) => GUEST\(\) \? toSignUp\(\) : dailyOpen/.test(src), false);
  check('a widget is a div, not a button', elements.dailyGrid.children[0].tag, 'div');
  var w = home(6);
  opened = [];
  dwClick(w.sighted, 0);
  dwClick(w.sighted, 1);
  check('clicking squares never opens another screen', opened.length, 0);
  check('...and never sends a guest to sign up', signups, 0);
  /* Study Alternatives is the one deliberate exception, and only once the
     puzzle is over: it boots an engine and hands the board back to be played
     on, which needs the full screen. */
  check('Study Alternatives is the one thing that opens the big view',
        /dailyOpen\(w\.key\)/.test(fn('dwRender')), true);
})();

say('\n3-6. Every vision can be solved where it is drawn\n');
(function solving(){
  var w = home(6);
  MODES.forEach(function(k){
    var b = w[k];
    if (!b) return;
    check(b.name + ': the vision is the one the table names', b.vision, VISION[k]);
    var made = solve(b);
    check(b.name + ': solved on the home page', b.done, true);
    check(b.name + ': every move of the line was played', b.uci.length >= b.puzzle.moves.length, true);
    check(b.name + ': the player made ' + made + ' move(s), the defence the rest',
          made === Math.ceil(b.puzzle.moves.length / 2), true);
    check(b.name + ': no wrong turn on the way', b.wrong, false);
  });
  // and Complete Blindfold specifically through its console, in notation
  var c = home(11).blindfold;
  var first = c.puzzle.moves[0];
  var st = stateFromFEN(c.puzzle.fen);
  var legal = legalMoves(st, st.turn);
  var m = legal.find(function(x){ return uciOf(x) === first; });
  c.els.input.value = toSAN(st, m, legal);
  dwTyped(c);
  flush();
  check('the console takes standard notation', c.uci[0], first);
  check('...and clears the box', c.els.input.value, '');
  // plain coordinates too, the game's other dialect
  var c2 = home(12).blindfold;
  c2.els.input.value = c2.puzzle.moves[0];
  dwTyped(c2);
  flush();
  check('and plain coordinates', c2.uci[0], c2.puzzle.moves[0]);
})();

say('\n7. Wrong moves are told from illegal ones\n');
(function wrong(){
  var w = home(6).sighted;
  var right = w.puzzle.moves[0];
  var other = legalMoves(w.st, w.st.turn)
    .map(function(m){ return uciOf(m); }).filter(function(u){ return u !== right; })[0];
  check('there is another legal move to try', !!other, true);
  var before = w.st;
  var m = legalMoves(w.st, w.st.turn).find(function(x){ return uciOf(x) === other; });
  var flashes = flashed;
  dwPlay(w, m);
  check('a legal-but-wrong move is refused', w.done, false);
  check('...the board does not move', w.st === before, true);
  check('...it is recorded as a wrong turn', w.wrong, true);
  check('...it says so in words', /Not the best move/.test(w.say.text), true);
  check('...and flashes the square it was going to', flashed > flashes, true);
  check('the right move still works afterwards', solve(w) > 0 && w.done, true);
  check('...but the solve is no longer clean', w.wrong, true);

  // illegal is a different answer, and only the rules can tell them apart
  var c = home(6).blindfold;
  c.els.input.value = 'Qz9';
  dwTyped(c);
  check('an illegal entry is refused as illegal', c.done, false);
  check('...and says something different from "not the best move"',
        /Not the best move/.test(c.say.text), false);
  check('...and is not counted against the attempt', c.wrong, false);
})();

say('\n8-9. The defence is verified, and long lines continue\n');
(function defence(){
  var w = home(6);
  var multi = MODES.map(function(k){ return w[k]; })
                   .filter(function(b){ return b && b.puzzle.moves.length >= 3; })[0];
  check('there is a multi-move puzzle among today\'s four', !!multi, true);
  if (!multi) return;
  var moves = multi.puzzle.moves;
  var m = legalMoves(multi.st, multi.st.turn).find(function(x){ return uciOf(x) === moves[0]; });
  dwPlay(multi, m);
  check('the opponent has not replied yet — it is played on a beat', multi.uci.length, 1);
  check('...and the widget is busy while it waits', multi.busy, true);
  flush();
  check('the verified defence is the one played', multi.uci[1], moves[1]);
  check('...and it is the file\'s move, not any legal reply', multi.uci[1] === moves[1], true);
  check('the solver is on move again', multi.st.turn, dwSolver(multi));
  check('not finished yet', multi.done, false);
  solve(multi);
  check('the whole line continues to the end', multi.uci.slice(0, moves.length).join(' '), moves.join(' '));
  check('...and then it is solved', multi.done, true);
})();

say('\n10-11. Completion is recorded, per mode and per day\n');
(function persist(){
  var w = home(6);
  solve(w.sighted);
  check('the solve is recorded', dailyDone('sighted', w.sighted.puzzle), true);
  check('...under the Daily scope for that mode', !!storage[pzKey(dailyScope('sighted'))], true);
  check('solving one mode does not mark another',
        dailyDone('fog', w.fog.puzzle) || dailyDone('board', w.board.puzzle) ||
        dailyDone('blindfold', w.blindfold.puzzle), false);
  check('...and marks nothing on the Puzzle page',
        pzDone('mode:sighted').has(w.sighted.puzzle.id), false);

  // a refresh: the store survives, the widgets are rebuilt from it
  DW.boards = {};
  elements.dailyGrid = fakeEl();
  dailyRender();
  var again = DW.boards;
  check('after a refresh the solved one comes back solved', again.sighted.done, true);
  check('...and says so', /Solved today/.test(again.sighted.say.text), true);
  check('...while the others are still to be played', again.fog.done, false);

  // tomorrow is a different record, so nothing carries over
  var t = home(7);
  check('tomorrow is a different puzzle', t.sighted.puzzle.id === w.sighted.puzzle.id, false);
})();

say('\n5b. Fog of War hides what it is supposed to\n');
(function fog(){
  var w = home(6);
  var b = w.fog;
  var me = dwSolver(b);
  var mine = 0, theirs = 0, shownTheirs = 0;
  for (var i = 0; i < 64; i++){
    var p = b.st.b[i];
    if (!p) continue;
    if (p.c === me){ mine++; if (dwShows(b, i)) {} }
    else { theirs++; if (dwShows(b, i)) shownTheirs++; }
  }
  check('the opponent has men on the board', theirs > 0, true);
  check('...and not one of them is drawn', shownTheirs, 0);
  check('every one of the solver\'s own men is drawn',
        [0,1,2,3,4,5,6,7,8].every(function(){ return true; }) &&
        b.st.b.filter(function(p, i){ return p && p.c === me && dwShows(b, i); }).length, mine);
  // Board Only hides both sides; Sighted hides nothing
  check('Board Only shows no man at all',
        b.st.b.filter(function(p, i){ return p && dwShows(w.board, i); }).length, 0);
  check('Sighted shows every man',
        w.sighted.st.b.filter(function(p, i){ return p && dwShows(w.sighted, i); }).length,
        w.sighted.st.b.filter(function(p){ return !!p; }).length);
  check('Complete Blindfold draws nothing, because it has no board', !!w.blindfold.els.board, false);
  /* The written position is the other panel and answers a different question:
     it says where every man stands, both sides, in every vision — that is what
     Fog of War is for, holding a position the board will not confirm. */
  check('the written position names both sides even under fog',
        /White/.test(dwMenHTML(b)) && /Black/.test(dwMenHTML(b)), true);
  // and once it is solved there is nothing left to hide
  solve(b);
  check('solving lifts the fog', b.revealed, true);
  check('...and now the opponent is drawn',
        b.st.b.filter(function(p, i){ return p && p.c !== me && dwShows(b, i); }).length > 0, true);
})();

say('\nThe files arrive one at a time, and the grid is rebuilt each time\n');
(function arriving(){
  /* Four fetches land separately, so the grid's membership changes three times
     on the way in and dwBuild() runs again for the widgets already there. The
     piece elements are cached by piece id; carried across a rebuild they stay
     parented to the container that was thrown away, dwPaint() finds them in the
     map and never appends them to the new one, and the board comes up empty
     while every other check still passes. That shipped for about ten minutes
     and was caught in a browser, not here — so here it is. */
  storage = {};
  DW.boards = {};
  DAILY.index = 6;
  DAILY.failed = {};
  DAILY.lists = {};
  elements.dailyGrid = fakeEl();
  dailyRender();
  check('nothing is playable before the files arrive', Object.keys(DW.boards).length, 0);
  check('...and the section says it is loading',
        /Loading/.test(elements.dailyGrid.children[0].innerHTML), true);

  var seen = [];
  MODES.forEach(function(k){
    DAILY.lists[k] = daily[k];
    seen.push(k);
    dailyRender();
    // every widget built so far must have its men in the container that is
    // actually on the page now
    seen.forEach(function(j){
      var w = DW.boards[j];
      if (!w || !w.els.pieces) return;
      var drawn = 0;
      for (var i = 0; i < 64; i++) if (w.st.b[i] && dwShows(w, i)) drawn++;
      check('after ' + seen.length + ' file(s), ' + w.name + ' has its men on the live board',
            w.els.pieces.children.length, drawn);
    });
  });
  check('all four end up playable', Object.keys(DW.boards).length, 4);
  check('and the piece cache is emptied on every rebuild',
        /w\.pieceEls = new Map\(\);/.test(fn('dwBuild')), true);
})();

say('\n12. The rotation is untouched\n');
(function rotation(){
  check('the cycle is still a hundred', DAILY_CYCLE, 100);
  var a = home(6), b2 = home(6);
  check('the same day gives the same four',
        MODES.map(function(k){ return a[k].puzzle.id; }).join(',') ===
        MODES.map(function(k){ return b2[k].puzzle.id; }).join(','), true);
  var t = home(7);
  check('the next day advances exactly one rung in every mode',
        MODES.every(function(k){
          return daily[k].indexOf(t[k].puzzle) - daily[k].indexOf(a[k].puzzle) === 1;
        }), true);
  var d101 = home(101), d1 = home(1);
  check('day 101 comes back to day 1',
        MODES.map(function(k){ return d101[k].puzzle.id; }).join(',') ===
        MODES.map(function(k){ return d1[k].puzzle.id; }).join(','), true);
  check('the picker is the same one the Puzzle screen uses',
        dailyPick(daily.fog, 6).id, daily.fog[6].id);
})();

say('\n13. The four files are untouched\n');
(function corpus(){
  var ids = {}, fens = {}, total = 0;
  MODES.forEach(function(k){
    check(k + ' still ships a hundred', daily[k].length, 100);
    daily[k].forEach(function(p){ ids[p.id] = 1; fens[p.fen] = 1; total++; });
  });
  check('four hundred in all', total, 400);
  check('every id is its own', Object.keys(ids).length, 400);
  check('every position is its own', Object.keys(fens).length, 400);
  // nothing in the widget layer writes a puzzle file or edits a record
  var layer = fn('dwPlay') + fn('dwFinish') + fn('dwFollow') + fn('dwRender') + fn('dailyRender');
  check('the widgets never write to a puzzle record',
        /\.moves\s*=|\.fen\s*=|\.why\s*=|\.follow\s*=/.test(layer), false);
})();

say('\n14. The Puzzle page is not disturbed\n');
(function puzzlePage(){
  check('pzPlay is still the Puzzle screen\'s own path',
        /function pzPlay\(m\)\{[\s\S]*?puzzleStep\(PZ\.puzzle\.moves, PZ\.ply/.test(SRC.replace(/\n/g, '')), true);
  check('the widgets ask the same referee',
        /puzzleStep\(w\.puzzle\.moves, w\.ply, uciOf\(m\)\)/.test(fn('dwPlay')), true);
  check('...and there is only one of it', (SRC.match(/\nfunction puzzleStep\(/g) || []).length, 1);
  check('only one makeMove, one legalMoves, one parseMoveIn',
        (SRC.match(/\nfunction makeMove\(/g) || []).length +
        (SRC.match(/\nfunction legalMoves\(/g) || []).length +
        (SRC.match(/\nfunction parseMoveIn\(/g) || []).length, 3);
  check('the widgets record through pzMark, not a store of their own',
        /pzMark\(dailyScope\(w\.key\), w\.puzzle\.id, clean\)/.test(fn('dwFinish')), true);
  check('the card is pzExplain\'s, not a second one',
        /pzExplain\(w\.puzzle\)/.test(fn('dwRender')), true);
  check('the follow-up is pzFollowOf\'s', /pzFollowOf\(w\.puzzle\)/.test(fn('dwFollow')), true);
  // dailyOpen still works, for Study Alternatives and for a direct link
  opened = [];
  PZ.list = null;
  var w = home(6);
  check('dailyOpen still puts one puzzle on the Puzzle screen',
        /PZ\.list = \[p\]/.test(fn('dailyOpen')), true);
})();

say('\nThe result controls, once there is nothing left to give away\n');
(function result(){
  var w = home(6);
  var b = w.sighted;
  check('nothing is offered before it is solved', b.els.acts.children.length, 0);
  check('...and no explanation is shown', b.els.why.children.length, 0);
  solve(b);
  var labels = b.els.acts.children.map(function(c){ return c.textContent; });
  check('Study Alternatives is offered once solved', labels.indexOf('Study Alternatives') >= 0, true);
  var f = pzFollowOf(b.puzzle);
  if (f && f.moves && f.moves.length){
    check('Show Follow Up is offered', labels.indexOf('Show Follow Up') >= 0, true);
    var before = b.uci.length;
    dwFollow(b);
    flush();
    check('...and it plays the verified follow-up', b.uci.length > before, true);
    check('...to the end of the stored line', b.uci.length, before + f.moves.length);
    check('...and is offered only once', b.els.acts.children
          .map(function(c){ return c.textContent; }).indexOf('Show Follow Up'), -1);
  } else {
    check('a mating line offers no follow-up', labels.indexOf('Show Follow Up'), -1);
  }
  check('the explanation card is there', b.els.why.children.length, 1);
  check('...and carries the Education System\'s own words',
        b.els.why.children[0].children[1].innerHTML.length > 0, true);
})();

say('\n' + passed + ' passed, ' + failed + ' failed\n');
if (typeof process !== 'undefined') process.exit(failed ? 1 : 0);
