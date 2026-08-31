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
    value: '', scrollTop: 0, scrollHeight: 0, focus: function(){},
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
/* Study Alternatives is the only puzzle path that reaches for an engine, so the
   suite carries a stand-in for it: canned answers, and a record of what it was
   asked, which is how the test checks that the question was put about the
   player's own position rather than about the book line. */
var engineAsked = [];
var engineReply = {};          // fen|moves -> canned result
function engineAsk(moves, opt){
  opt = opt || {};
  var key = (opt.fen || '') + '|' + moves.join(' ');
  engineAsked.push({ key: key, fen: opt.fen, moves: moves.slice(), depth: opt.depth });
  return Promise.resolve(engineReply[key] || engineReply['*'] || null);
}
// signed out, and no Supabase client: the guest path, which is the one that
// works with nothing configured. The account path is exercised by
// test_two_clients.py, where there is a server to answer.
var account = null;
var sb = null;
var ONLINE_AVAILABLE = false;

/* ---- the real half ---- */

var DECLS = ['PZ_STUDY_DEPTH','PZ_STUDY_PAUSE','PZ_STUDY_SLACK',
             'VAL','FILES','rowOf','colOf','SQNAME','uciOf','sqName','onBoard','other',
             'idCounter','mk','DIR_N','DIR_B','DIR_R','DIR_K','PIECE_WORD',
             'G','PZ','PZ_TRACK_NAME','PZ_TRACKS','PZ_STORE','PZ_VERSION','PZ_REPLY_MS',
             'PZ_START_RATING','PZ_K','PZ_RATING_STORE','PZ_MATE_CP','pzOwner','pzKey',
             'RUSH','RUSH_MS','RUSH_LIVES','RUSH_GAP_MS','W',
             'PZ_VISIONS','PZ_VISION_NAME','PZ_MENU_NAME','PZ_PIECE_RANK','sqIndex',
             'pzPick'];
var FNS = ['startBoard','newState','cloneState','posKey','fenOf','stateFromFEN',
           'slide','step','addPawn','pseudoMoves','isAttacked','kingSq','inCheck',
           'makeMove','legalMoves','toSAN','attackersOf','defendersOf','see',
           'sliderLines','betweenSq','findMotifs','winPct','sacrificeSize',
           'pvLine','materialFor','materialWord','describeBest',
           'puzzleStep','pzStored','pzProgress','pzWrite','pzMark','pzPush','pzDone',
           'pzNextRung','pzUnlocked','pzElo','pzGuestRating','pzRating','pzReport',
           'pzSendResult','pzSync','rushQueue','rushStrike','rushEnd','rushAdvance','rushRender',
           'pzOpen','pzClose','pzPlay','pzFinish','pzEsc','pzExplainPlain','pzExplain','pzSolutionSan',
           'pzWinPct','pzSwing','pzSwingHTML',
           'pzFollowOf','pzHasFollowUp','pzAfterSolution','pzFollowSay','pzShowFollowUp',
           'pzStudyOn','pzBranchPly','pzStudyReset','pzStudyStart','pzStudyStop',
           'pzReplaySolved','pzStudySay','pzStudyPlay','pzStudyWorth','walkFrom','pzSanOf',
           'pzRetry','pzRender','pzRenderGrid','visualIndex',
           /* the three visions, and the page they put on the screen: the written
              position, the notation walked from what was actually played, the
              info card and the typed console Complete Blindfold moves through */
           'pzPieceList','pzRenderPieces','pzSanLine','pzRenderNotes','pzRenderInfo',
           'pzRenderStage','pzRenderLive','parseMove','pzSubmitTyped',
           'goPuzzleVision','pzChooseVision','pzShowSolution'];

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
  var numbered = true, replayable = true, follows = true, followed = 0;
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
       but one that is there has to carry on from exactly where the solution
       stopped, and st is standing on that square. A line that does not replay
       is a button that stops halfway through its own explanation.

       Two shapes, because the three ladders were checked by different runs of
       tools/verify_puzzles.js: `follow` is the line together with the score it
       arrives at, `followUp` is the line on its own. The page reads both
       through pzFollowOf(), so both are checked here. */
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
  /* A ladder is however many positions cleared the standard, not a round
     number. This used to assert exactly a hundred, which was true of the set
     the old generator cut to a fixed size and is the opposite of what the
     current one promises: padding a track to a target means keeping puzzles
     that did not earn a place. So the assertion is that there *is* a ladder,
     and the count is reported rather than demanded. */
  check(TRACKS[k] + ': a ladder with rungs in it', list.length > 0, true);
  say('  ..    ' + list.length + ' rungs');
  check(TRACKS[k] + ': every solution replays from its fen', replayable, true);
  check(TRACKS[k] + ': ordered easiest first',
        list[0].seedRating <= list[list.length-1].seedRating, true);
  if (followed){
    check(TRACKS[k] + ': every follow-up plays on from the solution', follows, true);
    say('  ..    ' + followed + ' of ' + list.length + ' carry a follow-up');
  } else {
    say('  ..    ' + TRACKS[k] + ' has no follow-ups yet, skipping');
  }
  var ids = {}, unique = true;
  for (var u = 0; u < list.length; u++){
    if (ids[list[u].id]) unique = false;
    ids[list[u].id] = true;
  }
  check(TRACKS[k] + ': no two puzzles share an id', unique, true);
}
check('the three files hold puzzles at all', total > 0, true);

say('\nSolving one, click by click\n');

/* Once per track, and on the longest puzzle each of them has, so the forced
   reply is exercised. Every track is walked rather than one of them, because
   the three ladders were generated and corrected by separate runs and the
   thing most likely to be wrong with any of them is wrong in only one. */
function solveFlow(track){
  var list = sets[track], long = null;
  for (var q = 0; q < list.length; q++)
    if (!long || list[q].moves.length > long.p.moves.length) long = { n: q + 1, p: list[q] };
  if (!long){ say('  ..    ' + track + ' is empty, skipping'); return; }
  var at = track + ': ';

  PZ.mode = 'ladder';
  PZ.track = track;
  PZ.list = list;
  pzOpen(long.n);
  check(at + 'the board is the puzzle position', fenOf(G.st), long.p.fen);
  check(at + 'the solver is on move',            G.human, PZ.side);
  check(at + 'the board faces the solver',       G.flipped, PZ.side === 'b');
  check(at + 'the screen it opens is the board', screens[screens.length-1], 'game');
  check(at + 'and nothing is solved yet',        PZ.done, false);

  // a wrong move must not move anything
  var before = fenOf(G.st);
  var wrong = null, legal = legalMoves(G.st, G.st.turn);
  for (var w = 0; w < legal.length; w++)
    if (uciOf(legal[w]) !== long.p.moves[0]) { wrong = legal[w]; break; }
  var flashesBefore = flashed;
  pzPlay(wrong);
  check(at + 'a wrong move leaves the position alone', fenOf(G.st), before);
  check(at + 'and says so on the board',               flashed, flashesBefore + 1);
  check(at + 'and does not advance the line',          PZ.ply, 0);
  check(at + 'and is remembered against the attempt',  PZ.wrong, true);

  // the right one does advance
  pzPlay(moveFor(long.p.moves[0]));
  check(at + 'the right move is accepted', PZ.ply >= 1, true);
  check(at + 'and the board has moved on', fenOf(G.st) !== before, true);
  if (long.p.moves.length > 1){
    check(at + 'a multi-move puzzle waits for the defence', PZ.busy, true);
    // the reply is on a timer in the page; play it here the way the timer would
    var rm = moveFor(long.p.moves[1]);
    check(at + 'and the forced reply is legal', !!rm, true);
    G.st = makeMove(G.st, rm);
    PZ.busy = false;
    for (var sp = 2; sp < long.p.moves.length; sp += 2){
      pzPlay(moveFor(long.p.moves[sp]));
      if (PZ.busy && long.p.moves[sp+1]){
        G.st = makeMove(G.st, moveFor(long.p.moves[sp+1]));
        PZ.busy = false;
      }
    }
  }
  check(at + 'the puzzle finishes', PZ.done, true);
  check(at + 'but not as a clean solve, after that wrong move',
        pzProgress(track).solved.indexOf(long.p.id) >= 0, false);
  check(at + 'though it is recorded as seen',
        pzProgress(track).seen.indexOf(long.p.id) >= 0, true);
  check(at + 'so the next rung is open',
        pzUnlocked(PZ.list, pzDone(track), long.n + 1), true);

  /* ---- and a clean solve, on a one-move puzzle of the same track ---- */
  var one = null;
  for (var c = 0; c < list.length && !one; c++)
    if (list[c].moves.length === 1 && list[c].id !== long.p.id) one = { n: c + 1, p: list[c] };
  if (!one){ say('  ..    no second one-move puzzle in ' + track + ', skipping'); return; }

  pzOpen(one.n);
  pzPlay(moveFor(one.p.moves[0]));
  check(at + 'one right move finishes it', PZ.done, true);
  check(at + 'with no mistakes against it', PZ.wrong, false);
  check(at + 'and it counts as solved',
        pzProgress(track).solved.indexOf(one.p.id) >= 0, true);
  check(at + 'the card explains the move', pzExplain(one.p).length > 10, true);
  check(at + 'and the solution reads as notation', pzSolutionSan(one.p).length > 1, true);
  // pzRender writes the whole card; running it is the point
  pzRender();
  check(at + 'the card names the track and rung',
        elements.pzTitle.textContent, PZ_TRACK_NAME[track] + ' · Puzzle ' + one.n);
  check(at + 'the ladder is drawn', elements.pzGrid.innerHTML.indexOf('pz-lv') >= 0, true);
  check(at + 'and counts what has been solved',
        elements.pzProgress.textContent,
        pzProgress(track).solved.length + ' / ' + PZ.list.length);
  check(at + 'Next is offered', elements.pzNext.disabled, false);
}
for (var stk = 0; stk < TRACKS.length; stk++) solveFlow(TRACKS[stk]);

/* ---------------------------------------------------------------------
   The card at the end: the mistake, the line, the point.
   --------------------------------------------------------------------- */
say('\nWhat the finished card says\n');

(function explainCard(){
  // a record shaped the way tools/verify_puzzles.js writes one
  var rich = {
    fen: '4k3/8/8/8/8/8/8/R3K2R w KQ - 0 20',
    moves: ['a1a8'],
    themes: ['backRank'],
    seedRating: 1200,
    why: {
      mistake: 'Black played Ke8. It walks the king onto the back rank.',
      swing: 'The position was level before it and is winning after it.',
      moves: [{ san: 'Ra8+', uci: 'a1a8', by: 'you', text: 'It comes with check.' }],
      point: 'White comes out a rook up.'
    }
  };
  var html = pzExplain(rich);
  check('the card leads with the mistake', html.indexOf('walks the king') >= 0, true);
  check('it names the move in notation',   html.indexOf('<b>Ra8+</b>') >= 0, true);
  check('it marks whose move each one is', html.indexOf('class="you"') >= 0, true);
  check('and it ends on the point',        html.indexOf('a rook up') >= 0, true);

  // a defence is marked as theirs, so the card can colour the two apart
  rich.why.moves.push({ san: 'Kd7', uci: 'e8d7', by: 'them', text: 'Forced.' });
  check('the defence is marked as theirs',
        pzExplain(rich).indexOf('class="them"') >= 0, true);

  // whatever the tool wrote, the card is markup and treats it as text
  rich.why.mistake = 'Black played <script>Ke8</script>.';
  check('and nothing it is handed becomes markup',
        pzExplain(rich).indexOf('<script>') >= 0, false);

  // a track from before any of this still gets the old paragraph
  var plain = { fen: rich.fen, moves: rich.moves, themes: rich.themes, seedRating: 1200 };
  var old = pzExplain(plain);
  check('a file with no explanation falls back to one sentence',
        old.indexOf('pz-why-plain') >= 0, true);
  check('and the fallback still says something', old.length > 30, true);
})();

/* ---------------------------------------------------------------------
   The swing: what the mistake cost and the move won, as a chance of winning.
   --------------------------------------------------------------------- */
say('\nThe winning-chance strip\n');

(function swingStrip(){
  check('a level position is an even chance', pzWinPct(0), 50);
  check('a forced mate is certainty',         pzWinPct(9999), 100);
  check('and being mated is the other end',   pzWinPct(-9999), 0);
  /* Winning is not the same as won: the curve reads +20 pawns as 100% and a
     card that prints it has told the player the game was already over. */
  check('a merely winning position stops short of certainty', pzWinPct(2000) < 100, true);
  check('and a merely lost one stops short of zero',          pzWinPct(-2000) > 0, true);
  check('the two ends mirror each other', pzWinPct(300) + pzWinPct(-300), 100);
  check('a file with no score reads as nothing', pzWinPct(undefined), null);

  // the two readings are the ones the generator measured, in the order the
  // card puts them: before the opponent's move, and after the solver's
  var rec = {
    fen: '4k3/8/8/8/8/8/8/R3K2R w KQ - 0 20',
    prev: { fen: '4k2r/8/8/8/8/8/8/R3K2R b KQk - 0 19', move: 'h8h7' },
    moves: ['a1a8'],
    eval: { before: 0, best: 500, alt: -100, end: 500 }
  };
  var sw = pzSwing(rec);
  check('the swing is read off the file', sw.before, pzWinPct(0));
  check('and so is what it became',       sw.after,  pzWinPct(500));
  check('the difference is the two of them', sw.delta, sw.after - sw.before);

  var html = pzSwingHTML(rec);
  check('the strip says whose chance it is', html.indexOf('for White') >= 0, true);
  check('it names the move that went wrong', html.indexOf('Before Rh7') >= 0, true);
  check('and the move that answered it',     html.indexOf('After Ra8+') >= 0, true);
  check('it prints the chance before',       html.indexOf('>' + sw.before + '%<') >= 0, true);
  check('and the chance after',              html.indexOf('>' + sw.after + '%<') >= 0, true);
  check('and the gain between them',         html.indexOf('+' + sw.delta + '</b>') >= 0, true);

  // a track from before the scores were written has nothing to draw
  var bare = { fen: rec.fen, prev: rec.prev, moves: rec.moves };
  check('a file with no scores draws no strip', pzSwingHTML(bare), '');

  /* And every puzzle that ships has one, with a real difference in it — a
     turning point whose two readings round to the same percentage is a
     puzzle whose premise the card cannot show. */
  var missing = 0, flat = 0, least = 100;
  for (var t = 0; t < TRACKS.length; t++){
    var list = sets[TRACKS[t]];
    for (var i = 0; i < list.length; i++){
      var s2 = pzSwing(list[i]);
      if (!s2){ missing++; continue; }
      if (s2.delta < 5) flat++;
      if (s2.delta < least) least = s2.delta;
    }
  }
  check('every shipped puzzle carries the two readings', missing, 0);
  check('and every one of them is a visible swing',      flat, 0);
  say('  ..    the smallest swing in the set is +' + least + ' points');
})();

/* It is a hint until it is over, exactly as the themes are: a player told at
   the start that they are on 8% and heading for 58% has been told the move is
   a rescue. */
(function swingWaits(){
  var track = null, pick = null;
  for (var t = 0; t < TRACKS.length && !pick; t++){
    var list = sets[TRACKS[t]];
    for (var i = 0; i < list.length && !pick; i++)
      if (list[i].moves.length === 1 && list[i].eval) pick = { n: i + 1, p: list[i] };
    if (pick) track = TRACKS[t];
  }
  if (!pick){ say('  ..    no one-move puzzle with scores, skipping'); return; }

  PZ.mode = 'ladder';
  PZ.track = track;
  PZ.list = sets[track];
  pzOpen(pick.n);
  pzRender();
  check('the strip is hidden while the puzzle is open', elements.pzEval.style.display, 'none');
  check('and says nothing at all',                      elements.pzEval.innerHTML, '');

  pzPlay(moveFor(pick.p.moves[0]));
  pzRender();
  check('solving it shows the strip',      elements.pzEval.style.display, '');
  check('with a percentage on it',         elements.pzEval.innerHTML.indexOf('%') >= 0, true);
  check('drawn as two bars, not one',
        elements.pzEval.innerHTML.indexOf('pz-eval-row after') >= 0, true);

  // and a run has no room for it
  RUSH.on = true;
  PZ.mode = 'rush';
  PZ.puzzle = pick.p;
  rushRender();
  check('a rush does not stop to draw it', elements.pzEval.style.display, 'none');
  RUSH.on = false;
  PZ.mode = 'ladder';
})();

say('\nShow Follow Up, one track at a time\n');

/* The button is on the card only where the file has a line to show, it is dead
   until the puzzle is over, and when it is pressed the board has to actually
   move. Every track goes through the same walk, because the three ladders were
   checked by different runs of tools/verify_puzzles.js and store the line in
   two different shapes: `follow`, which is the line together with the score it
   arrives at and the one it started from, and `followUp`, which is the line on
   its own. pzFollowOf() is the only thing in the page that knows there are
   two, and a per-track pass is what proves it — a track quietly reading back
   as "no follow-up" would otherwise pass every check in this file.

   The line comes out of the file; no engine is loaded on this screen. What is
   tested here is the gate on it, the playing of it and the sentence it writes,
   not the chess, which tools/verify_puzzles.js is responsible for. */
function followUpFlow(track){
  var list = sets[track], pick = null;
  for (var i = 0; i < list.length && !pick; i++)
    if (list[i].moves.length === 1 && pzHasFollowUp(list[i]))
      pick = { n: i + 1, p: list[i] };
  if (!pick){
    say('  ..    no one-move puzzle with a follow-up in ' + track + ', skipping');
    return;
  }
  var at = track + ': ';
  var f = pzFollowOf(pick.p);

  PZ.mode = 'ladder';
  PZ.track = track;
  PZ.list = list;
  pzOpen(pick.n);
  timers = [];
  pzRender();
  check(at + 'a puzzle with a follow-up says so', pzHasFollowUp(pick.p), true);
  check(at + 'the card offers it at all',         elements.pzFollow.style.display, '');
  check(at + 'but it cannot be pressed before the puzzle is solved',
        elements.pzFollow.disabled, true);
  check(at + 'and Show Solution is what there is to press', elements.pzShow.disabled, false);

  // it will not run early either: it gives the whole thing away
  var fenBefore = fenOf(G.st);
  pzShowFollowUp();
  check(at + 'pressing it early does nothing', PZ.followed, false);
  check(at + 'and the board has not moved',    fenOf(G.st), fenBefore);

  // solve it, walking any forced reply the way the page's timer would
  pzPlay(moveFor(pick.p.moves[0]));
  for (var fs = 1; fs < pick.p.moves.length; fs++){
    if (PZ.busy){ G.st = makeMove(G.st, moveFor(pick.p.moves[fs])); PZ.busy = false; }
    else pzPlay(moveFor(pick.p.moves[fs]));
  }
  check(at + 'the puzzle is solved', PZ.done, true);

  pzRender();
  check(at + 'solving it offers the follow-up',  elements.pzFollow.disabled, false);
  check(at + 'and it is labelled Show Follow Up', elements.pzFollow.textContent, 'Show Follow Up');
  check(at + 'Show Solution is spent',            elements.pzShow.disabled, true);
  check(at + 'and nothing is said before it is pressed',
        elements.pzFollowSay.textContent, '');

  var atSolve = fenOf(G.st), playedBefore = G.uci.length;
  timers = [];
  pzShowFollowUp();
  check(at + 'pressing it takes the board over', PZ.busy, true);
  check(at + 'and takes the offer',              PZ.followed, true);
  pzRender();
  check(at + 'so it cannot be pressed twice', elements.pzFollow.disabled, true);
  flushTimers();                                  // the page plays it on a timer
  check(at + 'the follow-up is played out', fenOf(G.st) !== atSolve, true);
  check(at + 'every move of it landed',     G.uci.length - playedBefore, f.moves.length);
  check(at + 'and the board is handed back', PZ.busy, false);

  pzRender();
  var said = pzFollowSay(pick.p);
  check(at + 'the card explains what it led to', said.length > 20, true);
  check(at + 'and names the moves it played',    said.indexOf('Best play continues'), 0);
  check(at + 'the card carries it',              elements.pzFollowSay.textContent, said);
  check(at + 'it reads as notation, not as squares',
        /[a-h][1-8][a-h][1-8]/.test(said), false);
  // where the file carried a score, the sentence says how the line ends
  if (pick.p.follow)
    check(at + 'with the score the file carried behind it',
          /up\.|down\.|Mate in|already lost|calls/.test(said), true);
  check(at + 'a puzzle with no follow-up says nothing',
        pzFollowSay({ fen: pick.p.fen, moves: pick.p.moves }), '');

  // and Puzzle Rush is not the place for any of it
  RUSH.on = true; RUSH.over = null; RUSH.solved = 0; RUSH.strikes = 0;
  PZ.mode = 'rush';
  rushRender();
  check(at + 'a rush hides the follow-up entirely', elements.pzFollow.style.display, 'none');
  RUSH.on = false; PZ.mode = 'ladder'; PZ.track = track;

  // retrying puts the position, and the button, back
  pzRetry();
  timers = [];
  pzRender();
  check(at + 'retrying clears the follow-up', PZ.followed, false);
  check(at + 'and puts the position back',    fenOf(G.st), pick.p.fen);
}
for (var ftk = 0; ftk < TRACKS.length; ftk++) followUpFlow(TRACKS[ftk]);
PZ.on = false;

check('a puzzle with no line at all offers nothing', pzHasFollowUp({ moves:['e2e4'] }), false);

/* A solution that ends in mate has nothing to follow, and the button is absent
   rather than present and dead — which is the one case that cannot be found by
   looking for a follow-up, since what it looks like is not having one. */
var mated = null;
for (var mt = 0; mt < TRACKS.length && !mated; mt++)
  for (var mq = 0; mq < sets[TRACKS[mt]].length && !mated; mq++)
    if (!pzHasFollowUp(sets[TRACKS[mt]][mq]))
      mated = { track: TRACKS[mt], n: mq + 1, p: sets[TRACKS[mt]][mq] };
if (mated){
  PZ.mode = 'ladder';
  PZ.track = mated.track;
  PZ.list = sets[mated.track];
  pzOpen(mated.n);
  PZ.done = true;
  pzRender();
  check('a puzzle with nothing to follow offers no button',
        elements.pzFollow.style.display, 'none');
  check('and says nothing about one', pzFollowSay(mated.p), '');
  PZ.on = false;
} else {
  say('  ..    every shipped puzzle carries a follow-up, nothing to skip');
}

/* ---------------------------------------------------------------------
   Choosing a category and choosing a vision are two decisions, and the
   puzzle needs both. The home page makes the first and the vision screen
   makes the second, so what is checked here is that neither of them loses
   the other's answer.
   --------------------------------------------------------------------- */
say('\nCategory first, then vision\n');

(function picking(){
  goPuzzleVision('middlegame');
  check('a category opens the vision screen', screens[screens.length-1], 'pzvision');
  /* the wording of the home page's own menu, not the track's name: this line
     is quoting the button that was pressed back to the person who pressed it */
  check('which names the category chosen', elements.pzvCategory.textContent, 'Middle Game');
  check('and remembers it', pzPick.track, 'middlegame');
  check('as a ladder, not a run', pzPick.rush, false);

  goPuzzleVision('rush');
  check('Puzzle Rush comes through the same door', screens[screens.length-1], 'pzvision');
  check('and is named as itself', elements.pzvCategory.textContent, 'Puzzle Rush');
  check('with no ladder behind it', pzPick.track, null);
  check('but marked as a run', pzPick.rush, true);

  // a card press with nothing behind it still records the vision, which is the
  // half of the answer this screen owns
  pzPick.rush = false;
  pzPick.track = null;
  pzChooseVision('blind');
  check('the card pressed is the vision kept', PZ.vision, 'blind');
  pzChooseVision('nonsense');
  check('and one that is not a vision is refused', PZ.vision, 'blind');
})();

/* ---------------------------------------------------------------------
   The three visions. The rule they all answer to is that only the *drawing*
   changes: the position behind them is always whole, which is what lets the
   written lists, the legality of a move and the forced reply be the same in
   all three.
   --------------------------------------------------------------------- */
say('\nThe three visions\n');

(function visions(){
  check('there are three', PZ_VISIONS.length, 3);
  check('and each is one of the page’s own vision modes, so render() needs no map',
        PZ_VISIONS.join(','), 'total,blind,fog');
  check('Complete Blindfold is the one with no board', PZ_VISION_NAME.total, 'Complete Blindfold');
  check('See the Board is the empty one',             PZ_VISION_NAME.blind, 'See the Board');
  check('and Fog of War is the one that draws you',   PZ_VISION_NAME.fog,   'Fog of War');

  var track = null, one = null;
  for (var t = 0; t < TRACKS.length && !one; t++){
    var list = sets[TRACKS[t]];
    for (var i = 0; i < list.length && !one; i++)
      if (list[i].moves.length === 1) one = { n: i + 1, p: list[i] };
    if (one) track = TRACKS[t];
  }
  if (!one){ say('  ..    no one-move puzzle anywhere, skipping'); return; }

  PZ.mode = 'ladder';
  PZ.track = track;
  PZ.list = sets[track];

  for (var v = 0; v < PZ_VISIONS.length; v++){
    var vis = PZ_VISIONS[v], at = PZ_VISION_NAME[vis] + ': ';
    PZ.vision = vis;
    pzOpen(one.n);
    check(at + 'the board is drawn in the vision that was chosen', G.mode, vis);
    check(at + 'and nothing is given away while it is unsolved', G.revealed, false);
    check(at + 'there are no peeks to spend on it',               G.peeksLeft, 0);
    /* The rule the whole feature rests on: hiding is rendering, so the position
       is complete in every vision. Both sides are on the board and both sides
       have legal moves, whatever the player can see of them. */
    check(at + 'the position behind it is whole',
          pzPieceList(G.st, W).length > 0 && pzPieceList(G.st, B).length > 0, true);
    check(at + 'and the rules still run on all of it',
          legalMoves(G.st, G.st.turn).length > 0, true);

    pzRender();
    check(at + 'the written position is on the page', elements.pzPieces.style.display, '');
    check(at + 'the blindfold stage stands where the board would be',
          elements.pzStage.style.display, vis === 'total' ? 'flex' : 'none');
    check(at + 'and the typed console is the only way in without one',
          elements.pzConsole.style.display, vis === 'total' ? '' : 'none');

    // and solving it opens the position, in every vision
    pzPlay(moveFor(one.p.moves[0]));
    check(at + 'the puzzle is solved',              PZ.done, true);
    check(at + 'and finishing it opens the board',  G.revealed, true);
    pzRender();
    check(at + 'so the stage comes down',   elements.pzStage.style.display, 'none');
    check(at + 'and the console with it',   elements.pzConsole.style.display, 'none');
  }
  PZ.vision = 'fog';
})();

/* ---------------------------------------------------------------------
   The written position: the one thing on the puzzle page that is in all three
   visions, because in the first it IS the position and in the other two it is
   the half the board is refusing to draw.
   --------------------------------------------------------------------- */
say('\nThe written position\n');

(function written(){
  var st = stateFromFEN('r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 6 5');
  check('kings first, then queens, rooks, bishops, knights, pawns last',
        pzPieceList(st, W),
        'Ke1, Qd1, Ra1, Rh1, Bc1, Bc4, Nb1, Nf3, a2, b2, c2, d2, e4, f2, g2, h2');
  check('and the same, read for the other side',
        pzPieceList(st, B),
        'Ke8, Qd8, Ra8, Rh8, Bc5, Bc8, Nc6, Nf6, a7, b7, c7, d7, e5, f7, g7, h7');
  check('a pawn is named by its square and nothing else',
        /Pa2|Pe4/.test(pzPieceList(st, W)), false);
  check('two of a kind are simply both listed',
        pzPieceList(st, W).indexOf('Ra1, Rh1') >= 0, true);

  /* It is read off the board rather than stored, which is the whole of why a
     capture, a promotion and an en passant need no mention here. */
  var all = legalMoves(st, st.turn), take = null;
  for (var i = 0; i < all.length; i++) if (uciOf(all[i]) === 'c4f7') take = all[i];
  var after = makeMove(st, take);
  check('a captured man leaves the list',
        pzPieceList(after, B).indexOf('f7') >= 0, false);
  check('the piece that took it is listed on the square it took',
        pzPieceList(after, W).indexOf('Bf7') >= 0, true);
  check('and it is listed under its own colour only',
        pzPieceList(after, B).indexOf('Bf7') >= 0, false);

  var promo = stateFromFEN('8/P6k/8/8/8/8/8/K7 w - - 0 40');
  var pall = legalMoves(promo, promo.turn), q = null;
  for (var j = 0; j < pall.length; j++) if (uciOf(pall[j]) === 'a7a8q') q = pall[j];
  check('a promoted pawn is listed as what it became',
        pzPieceList(makeMove(promo, q), W), 'Ka1, Qa8');

  // and an emptied side says so rather than printing nothing
  PZ.vision = 'blind';
  PZ.mode = 'ladder';
  PZ.track = TRACKS[0];
  PZ.list = sets[TRACKS[0]];
  if (PZ.list.length){
    pzOpen(1);
    pzRenderPieces();
    check('the page carries both lists',
          elements.pzPcW.textContent.length > 2 && elements.pzPcB.textContent.length > 2, true);
    check('and they are the position on the board',
          elements.pzPcW.textContent, pzPieceList(stateFromFEN(PZ.list[0].fen), W));
  }
})();

/* ---------------------------------------------------------------------
   Notations: what has happened, and only that.
   --------------------------------------------------------------------- */
say('\nThe notations panel\n');

(function notations(){
  var track = null, many = null;
  for (var t = 0; t < TRACKS.length && !many; t++){
    var list = sets[TRACKS[t]];
    for (var i = 0; i < list.length && !many; i++)
      if (list[i].moves.length >= 3) many = { n: i + 1, p: list[i] };
    if (many) track = TRACKS[t];
  }
  if (!many){ say('  ..    no multi-move puzzle, skipping'); return; }

  PZ.mode = 'ladder';
  PZ.track = track;
  PZ.list = sets[track];
  PZ.vision = 'fog';
  pzOpen(many.n);
  pzRender();
  check('an unstarted puzzle has nothing to list',
        elements.pzMoves.innerHTML.indexOf('No moves yet') >= 0, true);

  var cells = function(){ return (elements.pzMoves.innerHTML.match(/class="m"/g) || []).length; };

  pzPlay(moveFor(many.p.moves[0]));
  pzRender();
  check('the move that was played is listed', cells(), 1);
  check('and it is listed in notation, not in squares',
        /[a-h][1-8][a-h][1-8]/.test(elements.pzMoves.innerHTML), false);
  check('the solution ahead of it is not', cells() < many.p.moves.length, true);

  // the forced reply, played the way the page's timer plays it
  G.st = makeMove(G.st, moveFor(many.p.moves[1]));
  G.uci.push(many.p.moves[1]);
  PZ.busy = false;
  pzRender();
  check('the defence joins it once it has happened', cells(), 2);

  /* The numbering is the game's, not the puzzle's: a middlegame position is
     move twenty-something, and a puzzle that opens on Black's move opens on an
     ellipsis rather than pretending White has not moved. */
  var st0 = stateFromFEN(many.p.fen);
  check('it is numbered from where the game had got to',
        elements.pzMoves.innerHTML.indexOf('>' + st0.full + '.<') >= 0, true);
  if (st0.turn === 'b')
    check('and a black-to-move puzzle opens on an ellipsis',
          elements.pzMoves.innerHTML.indexOf('…') >= 0, true);

  // it is walked from what was played, so it survives a retry
  pzRetry();
  pzRender();
  check('retrying empties it', elements.pzMoves.innerHTML.indexOf('No moves yet') >= 0, true);
  check('and the written position goes back with it',
        elements.pzPcW.textContent, pzPieceList(stateFromFEN(many.p.fen), W));

  // and a revealed solution fills it in, because those moves happened too
  timers = [];
  pzShowSolution();
  flushTimers();
  pzRender();
  check('a revealed solution is listed as well', cells(), many.p.moves.length);
})();

/* ---------------------------------------------------------------------
   The blindfold move console. Nothing here compares strings to the solution:
   parseMove() hands back one of the legal moves or an error, and puzzleStep()
   is what then decides whether it was the move.
   --------------------------------------------------------------------- */
say('\nThe blindfold move console\n');

(function typing(){
  var track = null, one = null;
  for (var t = 0; t < TRACKS.length && !one; t++){
    var list = sets[TRACKS[t]];
    for (var i = 0; i < list.length && !one; i++)
      if (list[i].moves.length === 1) one = { n: i + 1, p: list[i] };
    if (one) track = TRACKS[t];
  }
  if (!one){ say('  ..    no one-move puzzle, skipping'); return; }

  PZ.mode = 'ladder';
  PZ.track = track;
  PZ.list = sets[track];
  PZ.vision = 'total';
  pzOpen(one.n);

  var start = fenOf(G.st);
  var all = legalMoves(G.st, G.st.turn), right = moveFor(one.p.moves[0]);
  var rightSan = toSAN(G.st, right, all), wrong = null;
  for (var w = 0; w < all.length; w++) if (uciOf(all[w]) !== one.p.moves[0]) wrong = all[w];
  var wrongSan = wrong ? toSAN(G.st, wrong, all) : null;

  elements.pzMoveInput.value = 'Qz9';
  pzSubmitTyped();
  check('notation that is not a move moves nothing', fenOf(G.st), start);
  check('and the console says why',   /not a legal move/.test(PZ.typed.text), true);
  check('and the line does not advance', PZ.ply, 0);
  check('nor is it counted as a wrong answer', PZ.wrong, false);

  if (wrongSan){
    elements.pzMoveInput.value = wrongSan;
    pzSubmitTyped();
    check('a legal move that is not the answer moves nothing either', fenOf(G.st), start);
    /* And it is told apart from the one above: one of the two means the
       player's picture of the board is wrong, which is the thing this mode is
       for, and only the engine's own rules can say which. */
    check('but it is a different answer', PZ.typed.text, 'Not the best move. Try again.');
    check('and it does count against the attempt', PZ.wrong, true);
  }

  elements.pzMoveInput.value = rightSan;
  pzSubmitTyped();
  check('the move itself, typed in notation, is accepted', PZ.done, true);
  check('the board moved on', fenOf(G.st) !== start, true);
  check('and the console has nothing left to say', PZ.typed, null);
  check('the notation panel has it', elements.pzMoves.innerHTML.indexOf(rightSan) >= 0, true);

  // the same move as plain squares, which is the other dialect parseMove takes
  pzOpen(one.n);
  elements.pzMoveInput.value = one.p.moves[0];
  pzSubmitTyped();
  check('plain coordinates are accepted too', PZ.done, true);

  // and the console is not a way round the other two visions
  pzOpen(one.n);
  PZ.vision = 'blind';
  elements.pzMoveInput.value = rightSan;
  pzSubmitTyped();
  check('a board vision does not take typed moves', PZ.ply, 0);
  PZ.vision = 'fog';
})();

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
// counted rather than measured by length: real endgame puzzles have been
// solved further up this file, and they are in the same list
var twice = 0, solvedIds = pzProgress('endgame').solved;
for (var si = 0; si < solvedIds.length; si++) if (solvedIds[si] === 'en-test-1') twice++;
check('marking the same one twice does not double it', twice, 1);

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

  /* The one direction that is allowed: puzzles borrowing the review's words.
     The finished card is now the explanation checked into the file by
     tools/puzzle_words.js — which is what lets it say what the *opponent* did
     wrong, something describeBest() cannot know, since the mistake happened
     before the position it is handed. describeBest() is what a track written
     before any of that falls back to, and that fallback is still the review
     lending the puzzles its words. */
  check('the puzzle card prefers the explanation checked into the file',
        /\.why\b/.test(fn('pzExplain')), true);
  check('and falls back on the review’s own explainer',
        /describeBest\(/.test(fn('pzExplainPlain')), true);
  /* Solving a puzzle still asks no engine — the file carries the explanation
     and the follow-up, and that is what keeps the puzzle screen able to run
     with the worker never booted. Study Alternatives is the deliberate
     exception and the only one: it cannot be precomputed, because the position
     it analyses is one the player invents. So the assertion is about solving,
     and the exception is asserted too rather than left as a gap. */
  check('solving asks no engine of its own',
        /engineAsk|SF\./.test(fn('pzExplain') + fn('pzExplainPlain') +
                              fn('pzOpen') + fn('pzFinish') + fn('pzShowFollowUp')), false);
  check('and pzPlay only reaches one by handing over to study mode',
        /engineAsk|SF\./.test(fn('pzPlay')), false);
  check('while Study Alternatives does ask, on the position the player made',
        /engineAsk\(/.test(fn('pzStudyPlay')), true);

  // entering a puzzle must put any open review away, or both would own G.st
  check('opening a puzzle closes the review', /reviewClose\(/.test(fn('pzOpen')), true);
}

separationTests();

/* ---------------------------------------------------------------------
   Study Alternatives: the board goes back, and the engine answers.
   --------------------------------------------------------------------- */
say('\nStudy Alternatives\n');

async function studyTests(){
  // a three-ply puzzle from the shipped opening track, so the line is real
  /* A puzzle to study needs more than a multi-move line: it needs the opponent
     to have had a *choice* at the branch point. A key move that leaves one
     legal reply has nothing to explore, which the feature now says out loud —
     so the fixture has to be one where there is something to try. */
  var list = null, pick = null, track = null, single = null;
  for (var t = 0; t < TRACKS.length; t++){
    var cand = sets[TRACKS[t]];
    for (var i = 0; i < cand.length; i++){
      if (cand[i].moves.length < 3) continue;
      var st0 = stateFromFEN(cand[i].fen);
      var key = legalMoves(st0, st0.turn).find(function(x){ return uciOf(x) === cand[i].moves[0]; });
      if (!key) continue;
      var after = makeMove(st0, key);
      var replies = legalMoves(after, after.turn).length;
      if (replies < 2){ if (!single) single = cand[i]; continue; }
      if (!pick){ pick = { n: i + 1, p: cand[i] }; list = cand; track = TRACKS[t]; }
    }
  }
  if (!pick){ say('  ..    no multi-move puzzle to study, skipping'); return; }

  PZ.mode = 'ladder'; PZ.track = track; PZ.list = list;
  pzOpen(pick.n);
  // solve it the short way: the state a finished puzzle leaves the board in is
  // the whole solution played out, which is what study mode has to restore
  PZ.done = true; PZ.busy = false;
  var solvedSt = stateFromFEN(pick.p.fen);
  for (var q = 0; q < pick.p.moves.length; q++){
    var qm = legalMoves(solvedSt, solvedSt.turn).find(function(x){ return uciOf(x) === pick.p.moves[q]; });
    solvedSt = makeMove(solvedSt, qm);
  }
  var solved = fenOf(solvedSt);

  check('the button is offered on a finished multi-move puzzle', pick.p.moves.length >= 2, true);
  pzStudyStart();
  check('study mode is on', pzStudyOn(), true);

  // a key move with only one legal reply has nothing to study, and says so
  if (single){
    pzStudyStop();
    PZ.list = sets[single.id.slice(0,2) === 'op' ? 'opening'
             : single.id.slice(0,2) === 'mi' ? 'middlegame' : 'endgame'];
    var idx = PZ.list.indexOf(single) + 1;
    pzOpen(idx); PZ.done = true; PZ.busy = false;
    pzStudyStart();
    check('a forced-reply puzzle refuses to open study mode', pzStudyOn(), false);
    check('and explains why', /one legal reply/.test(elements.pzStudySay.innerHTML), true);
    // back to the real fixture
    PZ.mode = 'ladder'; PZ.track = track; PZ.list = list;
    pzOpen(pick.n); PZ.done = true; PZ.busy = false;
    pzStudyStart();
  }

  // the board is back at the opponent's first defensive turn
  var st = stateFromFEN(pick.p.fen);
  var m0 = legalMoves(st, st.turn).find(function(x){ return uciOf(x) === pick.p.moves[0]; });
  var wantFen = fenOf(makeMove(st, m0));
  check('the board rewinds to just after the key move', fenOf(G.st), wantFen);
  check('and it is the opponent to move', G.st.turn !== PZ.side, true);

  // try a defence that is not the one on file
  var theirs = legalMoves(G.st, G.st.turn);
  var alt = null;
  for (var k = 0; k < theirs.length; k++)
    if (uciOf(theirs[k]) !== pick.p.moves[1]) { alt = theirs[k]; break; }
  check('there is another legal defence to try', !!alt, true);

  engineAsked = [];
  engineReply['*'] = { cp: 900, mate: null, best: null, pv: [] };
  await pzStudyPlay(alt);
  check('the engine was asked about the player’s own position',
        engineAsked.length > 0 && engineAsked[0].fen === pick.p.fen, true);
  check('and the question included the move they just tried',
        engineAsked[0].moves[engineAsked[0].moves.length - 1], uciOf(alt));

  /* The three things it can conclude, and the third is the one that matters:
     a defence that is genuinely better than the one on file is a fault in the
     *puzzle*, and saying so is the whole reason this is not a canned list of
     refutations. */
  var said = function(){ return elements.pzStudySay.innerHTML || ''; };

  // 1. the try is refuted
  pzStudyReset();
  engineReply = { '*': { cp: 900, mate: null, best: null, pv: [] } };
  await pzStudyPlay(alt);
  check('a losing try is called a failure', /does not save the position/.test(said()), true);
  check('and it is not called a success',   /holds better/.test(said()), false);

  // 2. the try is the book defence
  pzStudyReset();
  var bookMove = legalMoves(G.st, G.st.turn).find(function(x){ return uciOf(x) === pick.p.moves[1]; });
  engineReply = { '*': { cp: 500, mate: null, best: null, pv: [] } };
  await pzStudyPlay(bookMove);
  check('playing the puzzle’s own defence is recognised',
        /that is the defence the puzzle plays/.test(said()), true);

  // 3. the try is better than the book line — the puzzle is at fault
  pzStudyReset();
  var keyTry  = pick.p.fen + '|' + pick.p.moves[0] + ' ' + uciOf(alt);
  var keyBook = pick.p.fen + '|' + pick.p.moves[0] + ' ' + pick.p.moves[1];
  engineReply = {};
  engineReply[keyTry]  = { cp: -200, mate: null, best: null, pv: [] };
  engineReply[keyBook] = { cp: 600, mate: null, best: null, pv: [] };
  await pzStudyPlay(alt);
  check('a defence that really holds is not called a failure',
        /does not save the position/.test(said()), false);
  check('and it is reported as a fault in the puzzle',
        /faulty/.test(said()), true);

  engineReply = { '*': { cp: 900, mate: null, best: null, pv: [] } };

  // leaving study mode restores the solved position
  pzStudyStop();
  check('study mode is off again', pzStudyOn(), false);
  check('and the board is back where the puzzle ended', fenOf(G.st), solved);

  // solving is untouched by any of it
  pzOpen(pick.n);
  check('opening a puzzle clears study mode', PZ.study, null);
}


/* Study Alternatives is the one suite here that has to wait for a promise —
   it is the one feature that asks an engine — so it runs at the end, where its
   pending answers cannot interleave with the synchronous suites that share PZ. */
studyTests().then(accountTests).then(function(){
  say('\n' + passed + ' passed, ' + failed + ' failed\n');
  if (typeof process !== 'undefined' && process.exit) process.exit(failed ? 1 : 0);
}, function(err){
  say('\nFAIL  the account tests threw: ' + (err && err.message));
  say('\n' + passed + ' passed, ' + (failed + 1) + ' failed\n');
  if (typeof process !== 'undefined' && process.exit) process.exit(1);
});
