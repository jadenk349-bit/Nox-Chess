/* Playing a puzzle, without a browser.
 *
 * test_review.js checks the pure pieces — refereeing, the ladder, the
 * explanation. This one runs the actual flow: the functions the page calls
 * when somebody clicks a square, against the puzzles that actually ship in
 * puzzles/. The DOM is a stub thin enough to fit in this file and real enough
 * that pzRender() runs for real, because a typo in an element name is exactly
 * the kind of thing that only shows up when the screen is opened.
 *
 * The code under test is read out of blind-chess.html, like the other suites.
 *
 *   node server/test_puzzle_flow.js
 *   jsc  server/test_puzzle_flow.js
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
/* A declaration that opens a brace or a bracket closes at column zero; only a
   one-liner ends at its first semicolon. Telling them apart matters: G's own
   comments contain semicolons, and a lazy match to the first one cuts the
   object in half. */
var decl = function(n){
  var block = SRC.match(new RegExp('\\n(?:const|let) ' + n + '\\s*=\\s*[\\{\\[][\\s\\S]*?\\n[\\}\\]];'));
  if (block) return block[0];
  return grab(new RegExp('\\n(?:const|let) ' + n + '\\b[^\\n]*?;'), n);
};

/* ---- the stub half: everything the puzzle code leans on that is not itself ---- */

var storage = {};
var localStorage = {
  getItem: function(k){ return Object.prototype.hasOwnProperty.call(storage, k) ? storage[k] : null; },
  setItem: function(k, v){ storage[k] = String(v); },
  removeItem: function(k){ delete storage[k]; }
};
function fakeEl(){
  return {
    textContent: '', innerHTML: '', className: '', disabled: false, style: {},
    dataset: {}, classList: {
      add: function(){}, remove: function(){}, toggle: function(){}, contains: function(){ return false; }
    },
    querySelector: function(){ return null; },
    querySelectorAll: function(){ return []; },
    addEventListener: function(){},
    scrollIntoView: function(){},
    appendChild: function(){}, closest: function(){ return null; }
  };
}
var elements = {};
var document = {
  getElementById: function(id){ return elements[id] || (elements[id] = fakeEl()); },
  querySelector: function(){ return null; },
  querySelectorAll: function(){ return []; },
  createElement: fakeEl, createElementNS: fakeEl
};

// the page's own machinery, replaced by counters: this suite is about the
// puzzle state, not about pixels
var rendered = 0, screens = [], flashed = 0, sounds = 0;
function render(){ rendered++; }
function showScreen(n){ screens.push(n); }
function reject(){ flashed++; }
function beep(){ sounds++; }
function syncOptions(){}
function fmtClock(){ return '3:00'; }
function layoutBoardBars(){}
function rushClock(){}
function reviewClose(){}
function announce(){}
var sqEls = [];
for (var i = 0; i < 64; i++) sqEls.push(fakeEl());
/* The page walks the follow-up out on a timer so it reads as the game
   continuing. Here it is a queue the test drains by hand: node's own
   setTimeout would make the suite wait for real seconds, and jsc has no
   timers at all. */
var timers = [];
function setTimeout(fn){ timers.push(fn); return timers.length; }
function flushTimers(){
  for (var guard = 0; timers.length && guard < 200; guard++) timers.shift()();
}
var REV = { on:false };
// signed out, and no Supabase client: the guest path, which is the one that
// works with nothing configured. The account path is exercised by
// test_two_clients.py, where there is a server to answer.
var account = null;
var sb = null;
var ONLINE_AVAILABLE = false;

/* ---- the real half ---- */

var DECLS = ['VAL','FILES','rowOf','colOf','SQNAME','uciOf','sqName','onBoard','other',
             'idCounter','mk','DIR_N','DIR_B','DIR_R','DIR_K','PIECE_WORD',
             'G','PZ','PZ_TRACK_NAME','PZ_TRACKS','PZ_STORE','PZ_VERSION','PZ_REPLY_MS',
             'PZ_START_RATING','PZ_K','PZ_RATING_STORE','pzOwner','pzKey',
             'RUSH','RUSH_MS','RUSH_LIVES','RUSH_GAP_MS','W'];
var FNS = ['startBoard','newState','cloneState','posKey','fenOf','stateFromFEN',
           'slide','step','addPawn','pseudoMoves','isAttacked','kingSq','inCheck',
           'makeMove','legalMoves','toSAN','attackersOf','defendersOf','see',
           'sliderLines','betweenSq','findMotifs','winPct','sacrificeSize',
           'pvLine','materialFor','materialWord','describeBest',
           'puzzleStep','pzStored','pzProgress','pzWrite','pzMark','pzPush','pzDone',
           'pzNextRung','pzUnlocked','pzElo','pzGuestRating','pzRating','pzReport',
           'pzSendResult','pzSync','rushQueue','rushStrike','rushEnd','rushAdvance','rushRender',
           'pzOpen','pzClose','pzPlay','pzFinish','pzExplain','pzSolutionSan',
           'pzFollowOf','pzHasFollowUp','pzAfterSolution','pzFollowSay','pzShowFollowUp',
           'pzRetry','pzRender','pzRenderGrid','visualIndex'];

var bundle = [grab(/\nconst W = 'w', B = 'b';/, "const W/B")];
for (var d = 0; d < DECLS.length; d++) if (DECLS[d] !== 'W') bundle.push(decl(DECLS[d]));
for (var f = 0; f < FNS.length; f++) bundle.push(fn(FNS[f]));
// PZ_THEME_NAME is called by pzRender
bundle.push(decl('PZ_THEME_WORDS'));
bundle.push(fn('PZ_THEME_NAME'));
eval(bundle.join('\n').replace(/(^|\n)(?:const|let) /g, '$1var '));

var passed = 0, failed = 0;
function check(label, got, want){
  if (got === want){ passed++; say('  PASS  ' + label + '  ->  ' + got); }
  else { failed++; say('  FAIL  ' + label + '\n        got  ' + got + '\n        want ' + want); }
}
function moveFor(uci){
  var all = legalMoves(G.st, G.st.turn);
  for (var i = 0; i < all.length; i++) if (uciOf(all[i]) === uci) return all[i];
  return null;
}

/* ---- the puzzles that actually ship ---- */

var TRACKS = ['opening', 'middlegame', 'endgame'];
var sets = {};
for (var t = 0; t < TRACKS.length; t++){
  try { sets[TRACKS[t]] = JSON.parse(slurp('puzzles/' + TRACKS[t] + '.json')); }
  catch (e){ sets[TRACKS[t]] = []; }
}

say('\nThe shipped ladders\n');

var total = 0;
for (var k = 0; k < TRACKS.length; k++){
  var list = sets[TRACKS[k]];
  total += list.length;
  if (!list.length){ say('  ..    ' + TRACKS[k] + ' is empty, skipping'); continue; }
  var numbered = true, replayable = true, ordered = true;
  var follows = true, followed = 0;
  for (var n = 0; n < list.length; n++){
    if (list[n].n !== n + 1) numbered = false;
    // every solution has to be playable from its own fen, or the puzzle is a trap
    var st = stateFromFEN(list[n].fen);
    for (var mi = 0; mi < list[n].moves.length; mi++){
      var all = legalMoves(st, st.turn), found = null;
      for (var a = 0; a < all.length; a++) if (uciOf(all[a]) === list[n].moves[mi]) found = all[a];
      if (!found){ replayable = false; break; }
      st = makeMove(st, found);
    }
    // and a puzzle always ends on the solver's move
    if (list[n].moves.length % 2 === 0) replayable = false;
    /* A follow-up is optional — a track checked before they existed has none —
       but one that is there has to carry on from where the solution stopped,
       and st is standing on exactly that square. A line that does not play is
       a button that stops halfway through its own explanation.

       Two shapes, because the two ladders were checked by different runs of
       tools/verify_puzzles.js: `follow` is the line together with the score it
       arrives at, `followUp` is the line on its own. The page reads both, so
       both are checked here. */
    var f = list[n].follow ||
            (list[n].followUp && list[n].followUp.length ? { moves: list[n].followUp } : null);
    if (f){
      followed++;
      if (!f.moves || f.moves.length > 8) follows = false;
      for (var fi = 0; fi < (f.moves || []).length; fi++){
        var fall = legalMoves(st, st.turn), fm = null;
        for (var fa = 0; fa < fall.length; fa++) if (uciOf(fall[fa]) === f.moves[fi]) fm = fall[fa];
        if (!fm){ follows = false; break; }
        st = makeMove(st, fm);
      }
      // where the file carried a score, it says how the line ends
      if (list[n].follow && typeof f.cp !== 'number' && typeof f.mate !== 'number') follows = false;
    }
  }
  check(TRACKS[k] + ': numbered 1..n', numbered, true);
  check(TRACKS[k] + ': every solution replays from its fen', replayable, true);
  check(TRACKS[k] + ': ordered easiest first',
        list[0].seedRating <= list[list.length-1].seedRating, true);
  if (followed)
    check(TRACKS[k] + ': every follow-up plays on from the solution', follows, true);
  else
    say('  ..    ' + TRACKS[k] + ' has no follow-ups yet, skipping');
  var ids = {}, unique = true;
  for (var u = 0; u < list.length; u++){
    if (ids[list[u].id]) unique = false;
    ids[list[u].id] = true;
  }
  check(TRACKS[k] + ': no two puzzles share an id', unique, true);
}
check('the three files hold puzzles at all', total > 0, true);

say('\nSolving one, click by click\n');

// the longest puzzle in the set, so the forced reply is exercised
var long = null;
for (var b = 0; b < TRACKS.length; b++)
  for (var q = 0; q < sets[TRACKS[b]].length; q++)
    if (!long || sets[TRACKS[b]][q].moves.length > long.p.moves.length)
      long = { track: TRACKS[b], n: q + 1, p: sets[TRACKS[b]][q] };

PZ.track = long.track;
PZ.list = sets[long.track];
pzOpen(long.n);
check('the board is the puzzle position', fenOf(G.st), long.p.fen);
check('the solver is on move',            G.human, PZ.side);
check('the board faces the solver',       G.flipped, PZ.side === 'b');
check('the screen it opens is the board', screens[screens.length-1], 'game');
check('and nothing is solved yet',        PZ.done, false);

// a wrong move must not move anything
var before = fenOf(G.st);
var wrong = null, legal = legalMoves(G.st, G.st.turn);
for (var w = 0; w < legal.length; w++) if (uciOf(legal[w]) !== long.p.moves[0]) { wrong = legal[w]; break; }
var flashesBefore = flashed;
pzPlay(wrong);
check('a wrong move leaves the position alone', fenOf(G.st), before);
check('and says so on the board',               flashed, flashesBefore + 1);
check('and does not advance the line',          PZ.ply, 0);
check('and is remembered against the attempt',  PZ.wrong, true);

// the right one does advance
pzPlay(moveFor(long.p.moves[0]));
check('the right move is accepted', PZ.ply >= 1, true);
check('and the board has moved on', fenOf(G.st) !== before, true);
if (long.p.moves.length > 1){
  check('a multi-move puzzle waits for the defence', PZ.busy, true);
  // the reply is on a timer in the page; play it here the way the timer would
  var rm = moveFor(long.p.moves[1]);
  check('and the forced reply is legal', !!rm, true);
  G.st = makeMove(G.st, rm);
  PZ.busy = false;
  for (var s = 2; s < long.p.moves.length; s += 2){
    pzPlay(moveFor(long.p.moves[s]));
    if (PZ.busy && long.p.moves[s+1]){
      G.st = makeMove(G.st, moveFor(long.p.moves[s+1]));
      PZ.busy = false;
    }
  }
}
check('the puzzle finishes', PZ.done, true);
check('but not as a clean solve, after that wrong move',
      pzProgress(long.track).solved.indexOf(long.p.id) >= 0, false);
check('though it is recorded as seen',
      pzProgress(long.track).seen.indexOf(long.p.id) >= 0, true);
check('so the next rung is open', pzUnlocked(PZ.list, pzDone(long.track), long.n + 1), true);

say('\nA clean solve, on a one-move puzzle\n');

var one = null;
for (var c = 0; c < sets[long.track].length; c++)
  if (sets[long.track][c].moves.length === 1 && sets[long.track][c].id !== long.p.id)
    { one = { n: c + 1, p: sets[long.track][c] }; break; }

if (one){
  pzOpen(one.n);
  pzPlay(moveFor(one.p.moves[0]));
  check('one right move finishes it', PZ.done, true);
  check('with no mistakes against it', PZ.wrong, false);
  check('and it counts as solved',
        pzProgress(long.track).solved.indexOf(one.p.id) >= 0, true);
  check('the card explains the move', pzExplain(one.p).length > 10, true);
  check('and the solution reads as notation', pzSolutionSan(one.p).length > 1, true);
  // pzRender writes the whole card; running it is the point
  pzRender();
  check('the card names the track and rung',
        elements.pzTitle.textContent, PZ_TRACK_NAME[long.track] + ' · Puzzle ' + one.n);
  check('the ladder is drawn', elements.pzGrid.innerHTML.indexOf('pz-lv') >= 0, true);
  check('and counts what has been solved',
        elements.pzProgress.textContent, pzProgress(long.track).solved.length + ' / ' + PZ.list.length);
  check('Next is offered', elements.pzNext.disabled, false);
} else {
  say('  ..    no second one-move puzzle in this set, skipping');
}

say('\nShow Follow Up: a line stored with its score\n');

/* The button is on the card only where the file has a line to show, it is dead
   until the puzzle is over, and when it is pressed the board has to actually
   move. This half takes a puzzle whose follow-up is stored as `follow` — the
   line together with the score it arrives at, which is how the middlegame
   ladder was checked. */
var withFollow = null;
for (var wf = 0; wf < TRACKS.length; wf++)
  for (var wq = 0; wq < sets[TRACKS[wf]].length && !withFollow; wq++){
    var cand = sets[TRACKS[wf]][wq];
    if (cand.moves.length === 1 && cand.follow && cand.follow.moves.length)
      withFollow = { track: TRACKS[wf], n: wq + 1, p: cand };
  }

if (withFollow){
  PZ.track = withFollow.track;
  PZ.list = sets[withFollow.track];
  pzOpen(withFollow.n);
  timers = [];
  pzRender();
  check('the card offers a follow-up at all', elements.pzFollow.style.display, '');
  check('but it cannot be pressed before it is solved',
        elements.pzFollow.disabled, true);
  check('and Show Solution is what there is to press', elements.pzShow.disabled, false);

  pzPlay(moveFor(withFollow.p.moves[0]));
  pzRender();
  check('solving it offers the follow-up', elements.pzFollow.disabled, false);
  check('and Show Solution is spent', elements.pzShow.disabled, true);
  check('the card explains why the move was good before it is pressed',
        elements.pzFollowSay.textContent.indexOf('Best play continues') >= 0, false);

  var atSolve = fenOf(G.st);
  timers = [];
  pzShowFollowUp();
  check('pressing it takes the board over', PZ.busy, true);
  flushTimers();
  check('the follow-up is played out',   fenOf(G.st) !== atSolve, true);
  check('and the board is handed back',  PZ.busy, false);
  check('it only plays once',            PZ.followed, true);
  pzRender();
  check('the button will not fire twice', elements.pzFollow.disabled, true);
  check('and the card now says what came of it',
        elements.pzFollowSay.textContent.indexOf('Best play continues') >= 0, true);
  check('with the score the file carried behind the sentence',
        /up\.|down\.|Mate in|already lost|calls/.test(elements.pzFollowSay.textContent), true);
  check('the follow-up reads as notation, not as squares',
        /[a-h][1-8][a-h][1-8]/.test(pzFollowSay(withFollow.p)), false);

  // retrying puts the position, and the button, back
  pzRetry();
  timers = [];
  pzRender();
  check('retrying clears the follow-up',   PZ.followed, false);
  check('and puts the position back',      fenOf(G.st), withFollow.p.fen);

  // a puzzle whose line ends in mate has nothing to follow up
  var mated = null;
  for (var mt = 0; mt < TRACKS.length && !mated; mt++)
    for (var mq = 0; mq < sets[TRACKS[mt]].length && !mated; mq++)
      if (sets[TRACKS[mt]][mq].follow && !sets[TRACKS[mt]][mq].follow.moves.length)
        mated = { track: TRACKS[mt], n: mq + 1, p: sets[TRACKS[mt]][mq] };
  if (mated){
    PZ.track = mated.track;
    PZ.list = sets[mated.track];
    pzOpen(mated.n);
    PZ.done = true;
    pzRender();
    check('a puzzle that ends in mate offers no follow-up',
          elements.pzFollow.style.display, 'none');
    check('and says nothing about one', pzFollowSay(mated.p), '');
  }
} else {
  say('  ..    no one-move puzzle with a follow-up in this set, skipping');
}

say('\nShow Follow Up: a line stored on its own\n');

/* Which is a different question from what the move was, and is asked after the
   puzzle is over. The line comes out of the file — no engine is loaded on this
   screen — so what is tested here is the gate on it and the sentence it
   writes, not the chess, which tools/verify_puzzles.js is responsible for. */
var withFollowUp = null;
for (var fu = 0; fu < TRACKS.length; fu++)
  for (var fp = 0; fp < sets[TRACKS[fu]].length; fp++)
    if (!withFollowUp && sets[TRACKS[fu]][fp].followUp && sets[TRACKS[fu]][fp].followUp.length)
      withFollowUp = { track: TRACKS[fu], n: fp + 1, p: sets[TRACKS[fu]][fp] };

if (withFollowUp){
  PZ.mode = 'ladder';
  PZ.track = withFollowUp.track;
  PZ.list = sets[withFollowUp.track];
  pzOpen(withFollowUp.n);
  timers = [];

  check('a puzzle with a follow-up says so', pzHasFollowUp(withFollowUp.p), true);
  check('and one without does not',          pzHasFollowUp({ moves:['e2e4'] }), false);

  // it is not on offer until the puzzle is over: it gives the whole thing away
  var fenBefore = fenOf(G.st);
  pzShowFollowUp();
  check('it will not run before the puzzle is solved', PZ.followed, false);
  check('and the board has not moved',                 fenOf(G.st), fenBefore);

  // solve it, walking any forced reply the way the page's timer would
  pzPlay(moveFor(withFollowUp.p.moves[0]));
  for (var fs = 1; fs < withFollowUp.p.moves.length; fs++){
    if (PZ.busy){ G.st = makeMove(G.st, moveFor(withFollowUp.p.moves[fs])); PZ.busy = false; }
    else pzPlay(moveFor(withFollowUp.p.moves[fs]));
  }
  check('the puzzle is solved', PZ.done, true);

  pzRender();
  check('the button is offered once it is', elements.pzFollow.disabled, false);
  check('and it is labelled Show Follow Up', elements.pzFollow.textContent, 'Show Follow Up');
  check('with nothing said yet',            elements.pzFollowSay.textContent, '');

  timers = [];
  pzShowFollowUp();
  check('pressing it takes the offer',   PZ.followed, true);
  check('and the board is busy playing', PZ.busy, true);
  pzRender();
  check('so it cannot be pressed twice', elements.pzFollow.disabled, true);
  G.token++;                                  // strand the page's timer; we walk it here

  // walk the line by hand, exactly as the timer would
  for (var fw = 0; fw < withFollowUp.p.followUp.length; fw++){
    var fm = moveFor(withFollowUp.p.followUp[fw]);
    check('follow-up move ' + (fw + 1) + ' is legal where it lands', !!fm, true);
    G.st = makeMove(G.st, fm);
  }
  PZ.busy = false;
  pzRender();

  var said = pzFollowSay(withFollowUp.p);
  check('the card explains what it led to', said.length > 20, true);
  check('and names the moves it played',    said.indexOf('Best play continues') === 0, true);
  check('the card carries it', elements.pzFollowSay.textContent, said);
  check('a puzzle with no follow-up says nothing',
        pzFollowSay({ fen: withFollowUp.p.fen, moves: withFollowUp.p.moves }), '');

  // and Puzzle Rush is not the place for it
  RUSH.on = true; RUSH.over = null; RUSH.solved = 0; RUSH.strikes = 0;
  PZ.mode = 'rush';
  rushRender();
  check('a rush hides the follow-up entirely', elements.pzFollow.style.display, 'none');
  RUSH.on = false; PZ.mode = 'ladder'; PZ.track = withFollowUp.track;

  // a retry starts the whole thing over, follow-up included
  pzOpen(withFollowUp.n);
  check('and re-opening the puzzle takes it back', PZ.followed, false);
  PZ.on = false;
} else {
  say('  ..    no puzzle in this set carries a follow-up, skipping');
}

say('\nRating, for a player with nowhere to store one\n');

// the guest path: the browser prices its own attempts and remembers the answer.
// The puzzles above have already moved it, which is itself the point — clear it
// to say what a new player starts at.
delete storage[PZ_RATING_STORE];
check('a guest starts at the opening rating', pzRating(), PZ_START_RATING);
check('beating a harder puzzle is worth more than beating an easier one',
      pzElo(1200, 1600, true) - 1200 > pzElo(1200, 800, true) - 1200, true);
check('failing an easy one costs more than failing a hard one',
      pzElo(1200, 800, false) < pzElo(1200, 1600, false), true);
check('an even match moves by half of K, either way',
      pzElo(1200, 1200, true) - 1200, 10);
check('and the other way',   1200 - pzElo(1200, 1200, false), 10);
check('ratings do not run away below the floor', pzElo(400, 3200, false) >= 400, true);
check('nor above the ceiling',                   pzElo(3200, 400, true) <= 3200, true);

// and it is remembered between puzzles
var was = pzRating();
var moved = pzReport({ id:'x', seedRating:1400 }, true);
check('a solve moves a guest rating up', moved > 0, true);
check('and the browser keeps it',        pzRating(), was + moved);
// finishing a puzzle at all is what moved it, back when the puzzles above ran
check('which is how the earlier solves moved it too', was !== PZ_START_RATING, false);

say('\nPuzzle Rush\n');

// the queue is every track at once, easiest first, opened at the player's rating
var everything = { opening: sets.opening, middlegame: sets.middlegame, endgame: sets.endgame };
var q = rushQueue(everything, 1200);
var ordered = true;
for (var r = 1; r < q.length; r++) if (q[r].seedRating < q[r-1].seedRating) { ordered = false; break; }
check('a run draws on all three tracks',
      q.length, sets.opening.length + sets.middlegame.length + sets.endgame.length);
check('and starts near the player rating', q[0].seedRating >= 1000 || q[0].seedRating === q[q.length-1].seedRating, true);
// it wraps once, so it is sorted from the entry point rather than from the bottom
check('it is not simply the whole set in order', ordered, false);
var easyStart = rushQueue(everything, 0);
var easyOrdered = true;
for (var e = 1; e < easyStart.length; e++)
  if (easyStart[e].seedRating < easyStart[e-1].seedRating) { easyOrdered = false; break; }
check('from the bottom it is plain increasing order', easyOrdered, true);
check('an empty library makes an empty run', rushQueue({}, 1200).length, 0);

// three wrong moves end it
RUSH.on = true; RUSH.over = null; RUSH.strikes = 0;
rushStrike();
check('one wrong move is not the end', RUSH.over, null);
rushStrike();
check('two are not either',            RUSH.over, null);
rushStrike();
check('three are',                     RUSH.over, 'three wrong');
check('and the strikes are counted',   RUSH.strikes, RUSH_LIVES);
RUSH.on = false; RUSH.over = null; RUSH.strikes = 0;

say('\nProgress is kept per track\n');

pzMark('endgame', 'en-test-1', true);
check('a solve in one track is stored there',
      pzProgress('endgame').solved.indexOf('en-test-1') >= 0, true);
check('and not in another', pzProgress('opening').solved.indexOf('en-test-1') >= 0, false);
pzMark('endgame', 'en-test-1', true);
check('marking the same one twice does not double it',
      pzProgress('endgame').solved.length, 1);

// and it is kept per account, so signing out does not show somebody else's
// ladder — and playing on as a guest cannot write over theirs
check('a guest and an account use different keys',
      pzKey('endgame', '') === pzKey('endgame', 'user-1'), false);
account = { id:'user-1', puzzleRating:1200 };
check("an account starts without the guest's progress",
      pzProgress('endgame').solved.length, 0);
pzMark('endgame', 'en-test-2', true);
check('and keeps its own', pzProgress('endgame').solved.indexOf('en-test-2') >= 0, true);
account = null;
check("the guest's own progress is still there",
      pzProgress('endgame').solved.indexOf('en-test-1') >= 0, true);
check("and it did not pick up the account's",
      pzProgress('endgame').solved.indexOf('en-test-2') >= 0, false);

/* ---------------------------------------------------------------------
   The account half: progress on the server side of the wire.

   A stand-in for Supabase, with the two rules the real one is given by
   supabase-migrate-puzzles.sql: a row is only ever handed to the account it
   belongs to (the RLS policy), and a solve is never written back down to a
   reveal (the keep_puzzle_solved trigger). Testing against that rather than
   against a bare array is the point — if the client ever asks for somebody
   else's rows, or tries to undo a solve, it fails here.
   --------------------------------------------------------------------- */
function fakeSupabase(){
  const rows = [];
  const stats = { selects: 0, upserts: 0, rowsWritten: 0 };
  const key = r => r.user_id + '|' + r.puzzle_id;
  function put(row){
    stats.rowsWritten++;
    const had = rows.find(r => key(r) === key(row));
    if (!had){ rows.push({ user_id:row.user_id, track:row.track, puzzle_id:row.puzzle_id, solved:!!row.solved }); return; }
    // the trigger: a replay may finish a puzzle again, never unsolve it
    had.solved = had.solved || !!row.solved;
    had.track = row.track;
  }
  return {
    rows, stats,
    from(table){
      if (table !== 'puzzle_progress') throw new Error('unexpected table: ' + table);
      return {
        select(){
          return {
            eq(column, value){
              stats.selects++;
              // RLS: nothing that is not yours comes back, whatever you ask for
              const mine = rows.filter(r => r[column] === value)
                               .map(r => ({ track:r.track, puzzle_id:r.puzzle_id, solved:r.solved }));
              return Promise.resolve({ data: mine, error: null });
            }
          };
        },
        upsert(payload){
          stats.upserts++;
          (Array.isArray(payload) ? payload : [payload]).forEach(put);
          return Promise.resolve({ data: null, error: null });
        }
      };
    }
  };
}

const signIn = id => { account = { id, puzzleRating: PZ_START_RATING }; };
const signOut = () => { account = null; };
const wipeBrowser = () => { for (const k of Object.keys(storage)) delete storage[k]; };
const solvedIn = track => pzProgress(track).solved.slice().sort().join(',');

async function accountTests(){
  say('\nSigning in carries the browser’s progress up\n');

  sb = fakeSupabase();
  signOut();
  wipeBrowser();

  // solved as a guest, before there is any account to put them against
  pzMark('opening', 'op-guest-1', true);
  pzMark('opening', 'op-guest-2', true);
  check('a guest writes nothing to the account', sb.stats.upserts, 0);

  signIn('user-A');
  check('and the account starts out knowing nothing of them', solvedIn('opening'), '');
  await pzSync();
  check('signing in adopts what was solved as a guest', solvedIn('opening'), 'op-guest-1,op-guest-2');
  check('and sends it up',  sb.rows.filter(r => r.user_id === 'user-A').length, 2);
  check('under the right track', sb.rows.every(r => r.track === 'opening'), true);

  // and it stops being unclaimed, or the next person to sign in on this
  // browser would inherit somebody else's puzzles
  check('the guest cache is emptied once it has been claimed',
        pzStored('opening', ''), null);
  signIn('user-Z');
  await pzSync();
  check('so a second account on the same browser inherits nothing',
        solvedIn('opening'), '');
  signIn('user-A');
  await pzSync();
  check('while the account that claimed them still has them',
        solvedIn('opening'), 'op-guest-1,op-guest-2');

  say('\nSolving while signed in saves to the account\n');

  const before = sb.stats.upserts;
  pzMark('opening', 'op-live-1', true);
  await Promise.resolve();                       // pzPush is fire-and-forget
  check('a solve is pushed as it happens', sb.stats.upserts > before, true);
  check('and lands as solved',
        !!sb.rows.find(r => r.user_id === 'user-A' && r.puzzle_id === 'op-live-1' && r.solved), true);

  say('\nIt comes back after the browser forgets everything\n');

  wipeBrowser();                                 // cleared site data, or another device
  check('the browser has nothing left', solvedIn('opening'), '');
  await pzSync();
  check('the account restores every solve', solvedIn('opening'),
        'op-guest-1,op-guest-2,op-live-1');

  say('\nOne account cannot see or touch another’s\n');

  signIn('user-B');
  await pzSync();
  check('a second account sees none of the first’s', solvedIn('opening'), '');
  pzMark('opening', 'op-b-1', true);
  await Promise.resolve();
  check('and its own solve is its own',
        sb.rows.filter(r => r.user_id === 'user-B').length, 1);
  check('the first account’s rows are untouched',
        sb.rows.filter(r => r.user_id === 'user-A').length, 3);

  signIn('user-A');
  wipeBrowser();
  await pzSync();
  check('and the first account still has exactly its own', solvedIn('opening'),
        'op-guest-1,op-guest-2,op-live-1');
  check('with nothing of the second’s', pzProgress('opening').solved.indexOf('op-b-1'), -1);

  say('\nThe three tracks stay apart\n');

  pzMark('middlegame', 'mi-1', true);
  pzMark('endgame', 'en-1', true);
  await Promise.resolve();
  check('opening is unchanged by a middlegame solve', solvedIn('opening'),
        'op-guest-1,op-guest-2,op-live-1');
  check('middlegame has only its own', solvedIn('middlegame'), 'mi-1');
  check('endgame has only its own',    solvedIn('endgame'), 'en-1');
  wipeBrowser();
  await pzSync();
  check('and they come back apart', solvedIn('middlegame') + ' / ' + solvedIn('endgame'),
        'mi-1 / en-1');
  check('each row carries its track',
        sb.rows.filter(r => r.user_id === 'user-A' && r.track === 'endgame').length, 1);

  say('\nA reveal never overwrites a solve\n');

  pzMark('endgame', 'en-1', false);               // finished again, this time by revealing
  await Promise.resolve();
  const row = sb.rows.find(r => r.user_id === 'user-A' && r.puzzle_id === 'en-1');
  check('the stored row is still a solve', row.solved, true);
  check('and the client did not even ask',
        pzProgress('endgame').solved.indexOf('en-1') >= 0, true);

  say('\nSigning out leaves the account’s progress alone\n');

  signOut();
  check('a signed-out browser shows no account progress', solvedIn('opening'), '');
  pzMark('opening', 'op-guest-3', true);
  await Promise.resolve();
  check('and a guest solve is not written to any account',
        sb.rows.filter(r => r.puzzle_id === 'op-guest-3').length, 0);
  signIn('user-A');
  await pzSync();
  check('the account is intact when it comes back',
        pzProgress('opening').solved.indexOf('op-live-1') >= 0, true);

  say('\nPuzzle Rush leaves the ladder alone\n');

  wipeBrowser();
  await pzSync();
  const ladderBefore = solvedIn('opening') + '|' + solvedIn('middlegame') + '|' + solvedIn('endgame');
  const wroteBefore = sb.stats.rowsWritten;

  RUSH.on = true; RUSH.over = null; RUSH.solved = 0; RUSH.strikes = 0; RUSH.best = 0;
  RUSH.queue = sets.opening.slice(0, 3);
  PZ.mode = 'rush';
  PZ.track = null;
  PZ.list = RUSH.queue;
  pzOpen(1);
  const rushPuzzle = PZ.puzzle;
  pzPlay(moveFor(rushPuzzle.moves[0]));
  if (PZ.busy && rushPuzzle.moves[1]){          // walk any forced reply by hand
    G.st = makeMove(G.st, moveFor(rushPuzzle.moves[1]));
    PZ.busy = false;
    for (let i = 2; i < rushPuzzle.moves.length; i += 2){
      pzPlay(moveFor(rushPuzzle.moves[i]));
      if (PZ.busy && rushPuzzle.moves[i+1]){
        G.st = makeMove(G.st, moveFor(rushPuzzle.moves[i+1]));
        PZ.busy = false;
      }
    }
  }
  check('the rush counted the solve', RUSH.solved, 1);
  check('the ladder did not move', solvedIn('opening') + '|' + solvedIn('middlegame') + '|' + solvedIn('endgame'), ladderBefore);
  check('and nothing was written to the account', sb.stats.rowsWritten, wroteBefore);
  check('nor was the rating touched', account.puzzleRating, PZ_START_RATING);
  RUSH.on = false; PZ.mode = 'ladder'; PZ.on = false;

  sb = null;
  signOut();
  wipeBrowser();
}

/* ---------------------------------------------------------------------
   Study Board is not this feature, and must not learn to be.
   --------------------------------------------------------------------- */
function separationTests(){
  say('\nStudy Board keeps out of the puzzles\n');

  const review = ['reviewBuild', 'enterReview', 'reviewGoto', 'reviewAnalyse', 'reviewRender']
    .map(fn).join('\n');
  check('the review never mentions a puzzle', /\bPZ\b|\bRUSH\b|puzzles\//.test(review), false);
  check('it replays the game that was played', /G\.uci/.test(fn('reviewBuild')), true);
  check('and refuses to open without one', /G\.sans\.length/.test(fn('enterReview')), true);

  // the one direction that is allowed: puzzles borrowing the review's words
  check('the puzzle card uses the review’s own explainer',
        /describeBest\(/.test(fn('pzExplain')), true);
  check('and asks no engine of its own',
        /engineAsk|SF\./.test(fn('pzExplain') + fn('pzOpen') + fn('pzPlay')), false);

  // entering a puzzle must put any open review away, or both would own G.st
  check('opening a puzzle closes the review', /reviewClose\(/.test(fn('pzOpen')), true);
}

separationTests();

accountTests().then(function(){
  say('\n' + passed + ' passed, ' + failed + ' failed\n');
  if (typeof process !== 'undefined' && process.exit) process.exit(failed ? 1 : 0);
}, function(err){
  say('\nFAIL  the account tests threw: ' + (err && err.message));
  say('\n' + passed + ' passed, ' + (failed + 1) + ' failed\n');
  if (typeof process !== 'undefined' && process.exit) process.exit(1);
});
