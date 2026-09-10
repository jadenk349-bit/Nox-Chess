/* The Daily Puzzle: four a day, the same four for everybody, gone tomorrow.
 *
 *   node server/test_daily.js
 *
 * The code under test is read out of blind-chess.html by name, like the other
 * page suites, so renaming or reformatting what it extracts breaks this on
 * purpose. What it is mostly about is the two promises that are easy to make
 * and hard to keep:
 *
 *   the rotation is a function of the day and of nothing else, so a refresh,
 *   a second browser or a server restart cannot move it; and
 *
 *   the Daily corpus and the Puzzle page's corpus never meet — not in the
 *   files, not through a shared loader, and not through the progress store.
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
  var block = SRC.match(new RegExp('\\n(?:const|let) ' + n + '\\s*=\\s*[\\{\\[][\\s\\S]*?\\n[\\}\\]];'));
  if (block) return block[0];
  return grab(new RegExp('\\n(?:const|let) ' + n + '\\b[^\\n]*?;'), n);
};

/* ---- the stub half ---- */
var storage = {};
var localStorage = {
  getItem: function(k){ return Object.prototype.hasOwnProperty.call(storage, k) ? storage[k] : null; },
  setItem: function(k, v){ storage[k] = String(v); },
  removeItem: function(k){ delete storage[k]; }
};
function fakeEl(){
  var e = {
    textContent: '', innerHTML: '', className: '', id: '', disabled: false, style: {},
    dataset: {}, children: [],
    classList: { add: function(){}, remove: function(){}, toggle: function(){}, contains: function(){ return false; } },
    appendChild: function(c){ this.children.push(c); return c; },
    setAttribute: function(k, v){ this[k] = v; },
    querySelector: function(){ return null; },
    querySelectorAll: function(){ return []; }
  };
  return e;
}
var elements = {};
var document = {
  getElementById: function(id){ return elements[id] || (elements[id] = fakeEl()); },
  createElement: fakeEl,
  querySelector: function(){ return null; },
  querySelectorAll: function(){ return []; }
};
function beep(){}
function alert(){}
function toSignUp(){ signups++; }
var signups = 0;
var GUEST = function(){ return guest; };
var guest = false;
var opened = [];
function pzOpen(n){ opened.push({ n: n, puzzle: PZ.list[n - 1], vision: PZ.vision, daily: PZ.daily }); }
var account = null;
// signed out and no Supabase client: pzMark() pushes to the cloud only when
// both are there, so the guest path is the one this suite walks
var sb = null;
function pzPush(){}

/* the puzzle-progress half these share, lifted rather than re-implemented:
   the point of several checks below is that the Daily store is the same store
   the ladders use, filed under a different key */
var DECLS = ['PZ_STORE', 'PZ_VERSION', 'DAILY_CYCLE', 'DAILY_VERSION', 'DAILY_MODES', 'DAILY_MODE', 'DAILY',
             'PZ_TRACK_NAME', 'PZ_TRACKS'];
var FNS = ['pzStored', 'pzProgress', 'pzWrite', 'pzMark', 'pzDone',
           'dailyDay', 'dailyFetch', 'dailyPick', 'dailyDone', 'dailyRender', 'dailyOpen', 'dailyEnter'];
// pzOwner and pzKey are one-line arrows, not function declarations
var ARROWS = ['pzOwner', 'pzKey'];

var bundle = [];
for (var d = 0; d < DECLS.length; d++) bundle.push(decl(DECLS[d]));
bundle.push(grab(/\nconst dailyScope = [^\n]*;/, 'dailyScope'));
for (var a = 0; a < ARROWS.length; a++) bundle.push(decl(ARROWS[a]));
bundle.push(grab(/\nconst PZ = \{[\s\S]*?\n\};/, 'PZ'));
for (var f = 0; f < FNS.length; f++) bundle.push(fn(FNS[f]));
bundle.push('for (var _m = 0; _m < DAILY_MODES.length; _m++) DAILY_MODE[DAILY_MODES[_m].key] = DAILY_MODES[_m];');
eval(bundle.join('\n').replace(/(^|\n)(?:const|let) /g, '$1var '));

var passed = 0, failed = 0;
function check(label, got, want){
  if (got === want){ passed++; say('  PASS  ' + label + '  ->  ' + got); }
  else { failed++; say('  FAIL  ' + label + '\n        got  ' + got + '\n        want ' + want); }
}

/* ---- the shipped corpora ---- */
var MODES = ['blindfold', 'board', 'fog', 'sighted'];
var daily = {}, dailyMissing = [];
for (var i = 0; i < MODES.length; i++){
  try { daily[MODES[i]] = JSON.parse(slurp('puzzles/daily/' + MODES[i] + '.json')); }
  catch (e){ daily[MODES[i]] = []; dailyMissing.push(MODES[i]); }
}
var regular = [];
var REGULAR_FILES = ['puzzles/opening.json', 'puzzles/middlegame.json', 'puzzles/endgame.json',
                     'puzzles/modes/sighted.json', 'puzzles/modes/board.json', 'puzzles/modes/blindfold.json',
                     'puzzles/modes/fog.json', 'puzzles/modes/rush.json', 'puzzles/modes/reserve.json',
                     'practices/opening.json', 'practices/middlegame.json'];
for (var r = 0; r < REGULAR_FILES.length; r++){
  try { JSON.parse(slurp(REGULAR_FILES[r])).forEach(function(p){ regular.push(p); }); } catch (e){}
}

say('\nThe four doors, and the vision behind each\n');
(function table(){
  check('there are four', DAILY_MODES.length, 4);
  check('and they are these four', DAILY_MODES.map(function(m){ return m.key; }).join(','),
        'blindfold,board,fog,sighted');
  check('Complete Blindfold is the vision with no board', DAILY_MODE.blindfold.vision, 'total');
  check('Board Only is the empty board',                  DAILY_MODE.board.vision, 'blind');
  check('Fog of War draws your own men',                  DAILY_MODE.fog.vision, 'fog');
  check('Sighted hides nothing',                          DAILY_MODE.sighted.vision, 'sighted');
  /* Every vision has to be one of G.mode's, because a Daily Puzzle is opened
     through pzOpen() like any other and pzOpen sets G.mode = PZ.vision. */
  var visions = DAILY_MODES.map(function(m){ return m.vision; }).sort().join(',');
  check('and every one is a vision the game already draws', visions, 'blind,fog,sighted,total');
  check('Puzzle Rush is not one of them',
        DAILY_MODES.some(function(m){ return m.key === 'rush'; }), false);
})();

say('\nThe corpus: four hundred, all different, none of them the Puzzle page\'s\n');
(function corpus(){
  if (dailyMissing.length === MODES.length){
    say('  ..    no Daily corpus installed yet, skipping the integrity checks');
    return;
  }
  var ids = {}, fens = {}, dupId = 0, dupFen = 0, sizes = [];
  for (var i = 0; i < MODES.length; i++){
    var list = daily[MODES[i]];
    sizes.push(list.length);
    for (var j = 0; j < list.length; j++){
      if (ids[list[j].id]) dupId++; else ids[list[j].id] = MODES[i];
      if (fens[list[j].fen]) dupFen++; else fens[list[j].fen] = MODES[i];
    }
  }
  check('four files ship', MODES.length - dailyMissing.length, 4);
  check('each of a hundred', sizes.join(','), '100,100,100,100');
  check('no Daily puzzle is behind two doors', dupId, 0);
  check('and no Daily position is either',     dupFen, 0);

  /* The rule the whole feature rests on: these are *additional* puzzles. A
     position the Puzzle page already ships would mean meeting today's Daily
     again three weeks later as a rung of Fog of War. */
  var clash = 0, clashId = 0;
  for (var k = 0; k < regular.length; k++){
    if (fens[regular[k].fen]) clash++;
    if (ids[regular[k].id]) clashId++;
  }
  check('no Daily position is on the Puzzle page or in a Practice', clash, 0);
  check('and no Daily id is either', clashId, 0);

  // every record is a real puzzle, not a stub
  var whole = 0, oddPly = 0;
  for (var m = 0; m < MODES.length; m++)
    daily[MODES[m]].forEach(function(p){
      if (p.fen && p.moves && p.moves.length && p.id && p.seedRating != null) whole++;
      if (p.moves && p.moves.length % 2 === 1) oddPly++;
    });
  var total = sizes.reduce(function(a, b){ return a + b; }, 0);
  check('every record carries a position, a line and a rung', whole, total);
  check('and every solution ends on the solver\'s move',      oddPly, total);
})();

say('\nThe rotation: the same day is the same puzzle\n');
(function rotation(){
  var list = [];
  for (var i = 0; i < 100; i++) list.push({ id: 'p' + i, n: i + 1 });

  check('day 0 is the first', dailyPick(list, 0).id, 'p0');
  check('day 1 is the second', dailyPick(list, 1).id, 'p1');
  check('day 99 is the hundredth', dailyPick(list, 99).id, 'p99');
  // and it comes round rather than running out
  check('day 100 is the first again', dailyPick(list, 100).id, 'p0');
  check('day 101 is the second again', dailyPick(list, 101).id, 'p1');
  check('day 250 is day 50\'s', dailyPick(list, 250).id, dailyPick(list, 50).id);

  /* Asking twice is asking the same question: there is no clock, no random
     and no state in dailyPick(), which is what makes a refresh safe. */
  var a = dailyPick(list, 42), b = dailyPick(list, 42), c = dailyPick(list, 42);
  check('asking three times gives the same puzzle', a === b && b === c, true);
  check('and it is a pure function of the index',
        /Math\.random|Date\.now|new Date/.test(fn('dailyPick')), false);

  // one day forward is exactly one position forward, in every mode
  var moved = 0, jumped = 0;
  for (var day = 0; day < 250; day++){
    var here = dailyPick(list, day), next = dailyPick(list, day + 1);
    var step = (next.n - here.n + 100) % 100;
    if (step === 1) moved++; else jumped++;
  }
  check('every day advances exactly one rung', moved, 250);
  check('and never skips',                     jumped, 0);

  // a category that shipped short still rotates cleanly
  var short = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  check('a short category wraps on its own length', dailyPick(short, 7).id, 'b');
  check('an empty one has nothing to offer',        dailyPick([], 3), null);
  check('and neither does a missing one',           dailyPick(null, 3), null);

  check('the cycle is a hundred days', DAILY_CYCLE, 100);
})();

say('\nThe day comes from the server, and survives everything a client does\n');
(function day(){
  check('the page asks the server for it', /fetch\('daily\.json'\)/.test(fn('dailyDay')), true);
  /* The fallback is the browser's own UTC arithmetic — the same answer for
     anybody whose clock is right. It exists so the cards work offline, not so
     that the client decides. */
  check('and falls back to UTC days when it cannot',
        /Date\.now\(\) \/ 86400000/.test(fn('dailyDay')), true);
  check('the fallback is UTC, not local time',
        /getFullYear|getMonth|getDate\(\)/.test(fn('dailyDay')), false);
  check('and it is asked once, not on every render',
        /DAILY\.asked/.test(fn('dailyDay')), true);
})();

say('\nToday\'s solve is today\'s, and touches nothing else\n');
(function progress(){
  storage = {};
  check('a Daily solve is filed under its own scope', dailyScope('fog'), 'daily:fog');
  check('which is not a pool\'s',      dailyScope('fog') === 'mode:fog', false);
  check('nor a Practice\'s',           dailyScope('fog') === 'practice:fog', false);
  check('nor a phase ladder\'s',       dailyScope('opening') === 'opening', false);

  var today = { id: 'day-7-fog' }, tomorrow = { id: 'day-8-fog' };
  check('nothing is solved to begin with', dailyDone('fog', today), false);
  pzMark(dailyScope('fog'), today.id, true);
  check('solving today marks today',       dailyDone('fog', today), true);
  /* The 24-hour reset, and it needs no clock: tomorrow is a different record,
     so tomorrow's card is not marked by today's solve. Nothing has to be
     cleared at midnight, which means nothing can fail to be. */
  check('and tomorrow is untouched by it',  dailyDone('fog', tomorrow), false);
  check('as is the same day in another vision', dailyDone('sighted', today), false);

  // and the Puzzle page's ladders are somewhere else entirely
  pzMark('mode:fog', 'pool-1', true);
  check('a pool solve does not mark a Daily', dailyDone('fog', { id: 'pool-1' }), false);
  check('and a Daily solve is not in the pool\'s progress',
        pzDone('mode:fog').has(today.id), false);
  check('the two are separate keys in the store',
        Object.keys(storage).filter(function(k){ return /daily/.test(k); }).length > 0, true);
})();

say('\nOpening one\n');
(function opening(){
  check('the Puzzle page never loads a Daily file',
        /puzzles\/daily/.test(fn('pzFetch') + fn('pzFetchMode')), false);
  check('and the Daily loader never reads a pool',
        /puzzles\/modes|pzFetchMode/.test(fn('dailyFetch')), false);
  check('the Daily loader reads its own directory',
        /puzzles\/daily\//.test(fn('dailyFetch')), true);
  check('with a cache key of its own',
        /DAILY_VERSION/.test(fn('dailyFetch')) && !/PZ_VERSION/.test(fn('dailyFetch')), true);

  var open = fn('dailyOpen');
  check('opening one clears every other kind of ladder',
        /PZ\.pool = null/.test(open) && /PZ\.track = null/.test(open) &&
        /PZ\.practice = null/.test(open), true);
  check('names the category',            /PZ\.daily = key/.test(open), true);
  check('takes the vision from the table', /PZ\.vision = m\.vision/.test(open), true);
  /* One a day means one on the board: a list of the whole hundred would give
     the rung grid a hundred rungs and Next Puzzle somewhere to go. */
  check('and puts exactly today\'s puzzle on the board', /PZ\.list = \[p\]/.test(open), true);
  check('a guest is sent to sign up rather than into it',
        /GUEST\(\) \? toSignUp\(\)/.test(fn('dailyRender')), true);
})();

say('\nThe cards\n');
(function cards(){
  DAILY.index = 3;
  DAILY.lists = {};
  for (var i = 0; i < MODES.length; i++)
    DAILY.lists[MODES[i]] = [{ id: MODES[i] + '-0', seedRating: 700 }, { id: MODES[i] + '-1' },
                             { id: MODES[i] + '-2' }, { id: MODES[i] + '-3', seedRating: 1500 }];
  DAILY.failed = {};
  storage = {};
  elements.dailyGrid = fakeEl();
  dailyRender();
  var grid = elements.dailyGrid;
  check('four cards are drawn', grid.children.length, 4);
  check('each is named for its mode',
        grid.children.map(function(c){ return c.children[0].textContent; }).join(','),
        'Complete Blindfold,Board Only,Fog of War,Sighted');
  check('each carries its key', grid.children.map(function(c){ return c.dataset.mode; }).join(','),
        'blindfold,board,fog,sighted');
  check('and each is a button with an id the tests can find',
        grid.children.map(function(c){ return c.id; }).join(','),
        'daily-blindfold,daily-board,daily-fog,daily-sighted');
  /* The card may say how hard it is — that is a fact about the position — and
     may not say anything about the answer. */
  check('a card shows the difficulty', /Difficulty 1500/.test(grid.children[0].children[1].textContent), true);
  check('and never a theme or a move',
        /mate|fork|pin|[a-h][1-8][a-h][1-8]/i.test(grid.innerHTML + grid.children.map(function(c){
          return c.children.map(function(x){ return x.textContent; }).join(' '); }).join(' ')), false);

  // solved today: the card says so
  pzMark(dailyScope('fog'), 'fog-3', true);
  elements.dailyGrid = fakeEl();
  dailyRender();
  check('a solved card says so',
        elements.dailyGrid.children[2].children[1].textContent, 'Solved today');
  check('and the others do not',
        elements.dailyGrid.children[0].children[1].textContent === 'Solved today', false);

  // a missing file is a normal state and says so rather than throwing
  DAILY.failed = { board: true };
  elements.dailyGrid = fakeEl();
  dailyRender();
  check('an absent file says it is not installed',
        elements.dailyGrid.children[1].children[1].textContent, 'Not installed yet');
  check('and that card cannot be pressed', elements.dailyGrid.children[1].disabled, true);
})();

say('\nThe page still says the Daily section is there\n');
(function markup(){
  check('the home page carries the section', /id="dailyStack"/.test(SRC), true);
  check('with a grid for the four cards',    /id="dailyGrid"/.test(SRC), true);
  check('and a heading',                     /id="dailyTitle">Daily Puzzle</.test(SRC), true);
  check('the home page fills it on the way in', /if \(name === 'home'\) dailyEnter\(\);/.test(SRC), true);
  check('the server serves the four files',
        (slurp('server/server.py').match(/"\/puzzles\/daily\/\w+\.json"/g) || []).length, 4);
  /* The Puzzle page's own loaders are allowlisted separately, and the daily
     directory is not among them — checked here as well as in the page,
     because this is the thing that must not be true by accident. */
  check('and the Puzzle page\'s own files are still served',
        /"\/puzzles\/modes\/sighted\.json"/.test(slurp('server/server.py')), true);
})();

say('\n' + passed + ' passed, ' + failed + ' failed\n');
if (typeof process !== 'undefined' && failed) process.exit(1);
