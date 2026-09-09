/* The practice drills, without a browser.
 *
 * Practice is the one part of the page that MAKES chess rather than reading
 * it: it invents positions, movement questions, tracking walks and the
 * questions asked about them. Everything it invents is claimed to be legal,
 * and a claim like that is worth exactly what checks it. So this suite generates
 * hundreds of exercises and re-derives every answer from the move generator
 * itself — the position is rebuilt, the walk is replayed, the notation is read
 * back with the page's own reader, and the answer the drill would have marked
 * correct has to survive all of it.
 *
 * It also covers the parts a player would notice going wrong: square colour
 * (against an independent rule, not the page's), the accounting behind
 * accuracy and streaks, the level ladder, and that difficulty genuinely
 * changes the exercise rather than the label on it.
 *
 * The code under test is read out of blind-chess.html by name, like the other
 * suites — renaming or reformatting what it extracts breaks this on purpose.
 *
 *   node server/test_practice.js
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
/* A declaration is taken as one line when one line closes it, and only then as
   a block. The other suites try the block first, which is fine for the objects
   they want and wrong for a one-line object like PIECE_NAME: a lazy scan for a
   brace at column zero runs on past the declaration and swallows whatever
   function comes next. Counting the brackets is what tells the two apart. */
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

/* ---- the stub half ---- */
var storage = {};
var localStorage = {
  getItem: function(k){ return Object.prototype.hasOwnProperty.call(storage, k) ? storage[k] : null; },
  setItem: function(k, v){ storage[k] = String(v); },
  removeItem: function(k){ delete storage[k]; }
};
var account = null;                    // the guest path, which needs nothing configured
var sb = null;                         // no Supabase client either, until section 15 fakes one
function prStatsRender(){}             // pixels; this suite is about the state behind them
function prRenderDash(){}              // pixels again: prSync redraws the dashboard when it is up
/* lsnNormalise() clamps a stored lesson number to the length of the course,
   and the course itself cannot be lifted into this harness — every entry in
   LESSONS carries a build() that reaches half the page. Only `.length` is
   read, so that is all this is, and it is generous on purpose: nothing here
   is testing which lesson numbers exist, only that the record travels. */
var LESSONS = { length: 20 };

/* ---- the real half ---- */
var DECLS = ['VAL','FILES','rowOf','colOf','SQNAME','uciOf','sqName','sqIndex','onBoard','other',
             'idCounter','mk','DIR_N','DIR_B','DIR_R','DIR_K','PST','nodes','PIECE_NAME',
             'OPENING_BOOK','OPENING_LINES',
             'PR_SQUARE_LEVELS','PR_QUADRANT_NAME','PR_DIRS','PR_LINES_LEVELS','PR_PIECE_LEVELS',
             'PR_ATTACK_LEVELS','PR_HOLD_LEVELS','PR_TRACKER_LEVELS','PR_AFTER_LEVELS','PR_FORCING_LEVELS',
             'PR_CALC_LEVELS','PR_BRANCHES_LEVELS','PR_PB_LEVELS',
             'PR_MODES','PR_GROUPS','PR_MINUTES','PR_STORE','PR_VERSION','PR_V1_KEYS','PR_SEEN_MAX',
             'prKey','prAcc','prSeenKey',
             'PR','PR_STEP_UP','PR_STEP_DOWN','prRand','prPick','prSide','prMan','PR_MAKE','W',
             'PR_ERRS','PR_FLOORS','PR_AUTO_LEVEL','PR_PALETTE','PZ_VERSION','prPuzzleCache',
             // the course record prSync() adopts along with the practice one
             // both version maps, not only the first: lsnNormalise() reads a
             // stored record forward through whichever of them it needs, so a
             // harness carrying one of the two throws on the very records the
             // maps exist for
             'pzOwner','LSN_STORE','LSN_COURSE','LSN_V1_TO_V2','LSN_V2_TO_V3','lsnKey','PR_COURSE'];
var FNS = ['startBoard','newState','cloneState','fenOf','stateFromFEN',
           'slide','step','addPawn','pseudoMoves','isAttacked','kingSq','inCheck',
           'makeMove','legalMoves','toSAN','attackersOf','defendersOf','see',
           'mirror','evaluate','orderMoves','scoreMove','quiesce','negamax','bestMove',
           // prMaterialOf() is the game's own materialFor() under a practice
           // name, so the game's own has to come along with it
           'materialFor',
           'parseMoveIn','bookMove','moveFromSAN','openingPosition',
           'lineBetween','linesThrough','knightRoute','sliderReaches','rebuildDiff','quadrantOf',
           'prBlankMode','prBlank','prUpgradeV1','prLoad','prSave',
           'prSeen','prSeenHas','prSeenPush','prToday','prTouchDay',
           'prShuffle','prPosition','prMaterial','prColourWhy',
           'prMakeSquare','prMakeLines','prMakePiece',
           'prAttacked','prHanging','prPinned','prMakeAttack',
           'prMakeTracker','prTrackerErr',
           'prMoveFacts','prMakeAfter',
           'prPlaceAttackers','prMaterialOf','prExchangeLine','prMakeForcing',
           'prMatesIn1','prMatesIn2','prForks','prCalcHanging','prPuzzlePool','prCalcTrack','prMakeCalc','prCalcDraw',
           'prPickMove','prAskAbout','prMakeProgressive','prMakeBranches','prRecipe','prMake',
           'prGamePosition','prCluster','prAskFine','prMakeHold',
           'prRecord','prScore','prStep','prNow','prTimeLeft','prMedianLat',
           'prAutomatic','prGroupOpen','prRecommendFrom','prRecommendNext',
           'prStartLevel','prOpen','prRebuildStart','prRebuildFinish','prRbPaint','goPractice',
           'prCloud','prRowOf','prRecOf','prPush','prPushCourse','prMerge','prNotable','prSameRow','prSync',
           // the lessons record, read and written by prSync — the real ones,
           // since all three are small and none of them touches the course
           'lsnNormalise','lsnStored','lsnWrite'];

var bundle = [grab(/\nconst W = 'w', B = 'b';/, "const W/B")];
// one line, so the block-shaped fn() above does not match it
bundle.push(grab(/\nfunction lsnDone\(\)[^\n]*/, 'function lsnDone'));
for (var d = 0; d < DECLS.length; d++) if (DECLS[d] !== 'W') bundle.push(decl(DECLS[d]));
for (var f = 0; f < FNS.length; f++) bundle.push(fn(FNS[f]));
// PR_MODE is filled by a loop rather than written out, and prRecipe/prRecommendNext read it
bundle.push('\nvar PR_MODE = {};\nfor (var _m of PR_MODES) PR_MODE[_m.key] = _m;');
eval(bundle.join('\n').replace(/(^|\n)(?:const|let) /g, '$1var '));

/* ---- the scoreboard ---- */
var passed = 0, failed = 0;
function head(t){ say('\n' + t + '\n'); }
function ok(what, got, want){
  var good = arguments.length < 3 ? !!got : (got === want);
  if (good){ passed++; say('  PASS  ' + what + '  ->  ' + got); }
  else { failed++; say('  FAIL  ' + what + '  ->  got ' + got + ', wanted ' + want); }
}

/* An honest second opinion about square colour: a1 is dark, and the colour
   alternates. Nothing here is borrowed from the page. */
function darkByName(name){
  return ('abcdefgh'.indexOf(name[0]) + (+name[1])) % 2 === 1;
}
/* A position rebuilt from a bare board, the way the drills hand them around. */
function stateOf(board, turn){
  return { b: board.slice(), turn: turn || W, cr:{wK:0,wQ:0,bK:0,bQ:0}, ep:-1, half:0, full:1 };
}
function menOn(board){
  var n = 0;
  for (var i = 0; i < 64; i++) if (board[i]) n++;
  return n;
}
function sameBoard(a, b){
  for (var i = 0; i < 64; i++){
    var x = a[i], y = b[i];
    if (!x !== !y) return false;
    if (x && (x.id !== y.id || x.t !== y.t || x.c !== y.c)) return false;
  }
  return true;
}

/* A second opinion on attack squares, deliberately not the page's own
   prAttacked — a drill and its check that agree by construction prove
   nothing. Sliders and jumpers alike are read off pseudoMoves() with the
   opposing king lifted out of the way, which is what lets a line through
   the king still count; a pawn's two forward diagonals are named directly,
   since pseudoMoves() also carries its pushes and this is about capture
   squares alone. */
function attackedSquares(st, from){
  var p = st.b[from];
  if (p.t === 'P'){ var r = rowOf(from) + (p.c === W ? -1 : 1), out = [];
    [-1, 1].forEach(function(dc){ var c = colOf(from) + dc; if (r >= 0 && r < 8 && c >= 0 && c < 8) out.push(r * 8 + c); }); return out; }
  var s = stateOf(st.b, p.c); s.b[kingSq(st, other(p.c))] = null; // no check filtering
  return pseudoMoves(s, p.c).filter(function(m){ return m.from === from; }).map(function(m){ return m.to; });
}
function isAttackedBy(st, target, from){ return attackedSquares(st, from).indexOf(target) >= 0; }

/* ============================================================
   1 — square names and square colours
   ============================================================ */
head('Coordinates and colours');

(function(){
  var bad = 0;
  for (var i = 0; i < 64; i++){
    var name = sqName(i);
    if (!/^[a-h][1-8]$/.test(name)) bad++;
    // the drill's rule and the independent one must agree on every square
    if (((rowOf(i) + colOf(i)) % 2 === 1) !== darkByName(name)) bad++;
  }
  ok('all 64 square names are well formed and correctly coloured', bad, 0);
  ok('a1 is dark',  darkByName('a1'), true);
  ok('h1 is light', darkByName('h1'), false);
  ok('a8 is light', darkByName('a8'), false);
  ok('h8 is dark',  darkByName('h8'), true);
  ok('e4 is light', darkByName('e4'), false);
  ok('f6 is dark',  darkByName('f6'), true);
  ok('c6 is light', darkByName('c6'), false);
})();

(function(){
  // prColourWhy still explains a square's colour on its own — it is what
  // prSquareWhy reaches for when a Square Trainer colour question is missed —
  // and is worth checking independently of any question that calls it.
  var why = prColourWhy(sqIndexOf('f6'));
  ok('the explanation names the square and its colour', /f6 is dark/.test(why), true);
  ok('and the explanation for a light one says light', /e4 is light/.test(prColourWhy(sqIndexOf('e4'))), true);
})();
function sqIndexOf(name){ return (8 - (+name[1])) * 8 + 'abcdefgh'.indexOf(name[0]); }

/* ============================================================
   1b — Square Trainer: coordinates, colours, neighbours and quadrants,
   one ladder rather than the two drills (Coordinate Trainer, Square Colour)
   it replaces. Every level generates, every answer re-derives from the
   board's own geometry, and no level skips the kinds its caption promises.
   ============================================================ */
head('Square Trainer');
(function(){
  var kinds = {}, bad = 0;
  for (var lv = 1; lv <= PR_SQUARE_LEVELS.length; lv++){
    for (var t = 0; t < 60; t++){
      var q = prMakeSquare(prRecipe('square', lv));
      if (!q){ bad++; continue; }
      kinds[q.ask] = 1;
      if (q.ask === 'colour' && q.dark !== darkByName(sqName(q.sq))) bad++;
      if (q.ask === 'neighbour'){
        var d = { above:-8, below:8, left:-1, right:1 }[q.dir];
        if (q.answer !== q.sq + d) bad++;
        if (q.dir === 'left' && colOf(q.sq) === 0) bad++;
        if (q.dir === 'right' && colOf(q.sq) === 7) bad++;
      }
      if (q.ask === 'quadrant' && q.answer !== quadrantOf(q.sq)) bad++;
      if (typeof q.sig !== 'string') bad++;
    }
  }
  ok('every level generates, and every answer re-derives', bad, 0);
  ok('all five question kinds appear across the ladder', Object.keys(kinds).length, 5);
  ok('level 5 has no board', prRecipe('square', 5).board, false);
  ok('level 7 is timed', prRecipe('square', 7).timed > 0, true);
})();

/* ============================================================
   1c — Lines & Routes: squares between two others, the lines through a
   square, whether a slider reaches past a blocker, and knight routes — four
   question kinds re-derived from the geometry helpers themselves rather than
   from anything the generator claims about them.
   ============================================================ */
head('Lines & Routes');
(function(){
  var bad = 0, kinds = {};
  for (var lv = 1; lv <= PR_LINES_LEVELS.length; lv++) for (var t = 0; t < 60; t++){
    var q = prMakeLines(prRecipe('lines', lv));
    if (!q){ bad++; continue; }
    kinds[q.ask] = 1;
    if (q.ask === 'between'){
      var want = lineBetween(q.a, q.b);
      if (!want || want.length < 1 || want.join() !== q.answer.join()) bad++;
    }
    if (q.ask === 'through'){
      var L = linesThrough(q.a);
      q.choices.forEach(function(c){
        var on = L.diag1.indexOf(c) >= 0 || L.diag2.indexOf(c) >= 0;
        if (on !== (q.answer.indexOf(c) >= 0)) bad++;
      });
    }
    if (q.ask === 'reach'){
      var b = Array(64).fill(null); if (q.blocker >= 0) b[q.blocker] = mk(W, 'P');
      if (sliderReaches(b, q.a, q.b, q.type) !== q.answer) bad++;
    }
    if (q.ask === 'knight' && knightRoute(q.a, q.b).length - 1 !== q.answer) bad++;
  }
  ok('every level generates and re-derives', bad, 0);
  ok('all four question kinds appear', Object.keys(kinds).length, 4);

  // The rung captioned "Blockers" is the only one that sets `blockers`, and it
  // has to mean it: a `reach` question with a clear line is the question the
  // level before it already asked. (This used to be a coin flip inside
  // prMakeLines, so the level shipped without a blocker half the time.)
  var lv6 = 0, clear = 0;
  for (var t2 = 0; t2 < 200; t2++){
    var q6 = prMakeLines(prRecipe('lines', 6));
    if (!q6) continue;
    lv6++;
    if (q6.ask !== 'reach' || q6.blocker < 0) clear++;
  }
  ok('level 6 deals a question at all', lv6 > 0, true);
  ok('and every one of them puts something in the way', clear, 0);
})();

/* ============================================================
   2 — every generated position is a position
   ============================================================ */
head('Generated positions are legal');

(function(){
  var bad = { none:0, kings:0, adjacent:0, pawn:0, check:0, rights:0 };
  for (var t = 0; t < 400; t++){
    var built = prPosition(prMaterial(2 + (t % 18)));
    if (!built){ bad.none++; continue; }
    var st = built.st;
    if (kingSq(st, W) < 0 || kingSq(st, 'b') < 0) bad.kings++;
    var wk = kingSq(st, W), bk = kingSq(st, 'b');
    if (Math.abs(rowOf(wk) - rowOf(bk)) <= 1 && Math.abs(colOf(wk) - colOf(bk)) <= 1) bad.adjacent++;
    for (var i = 0; i < 64; i++){
      var p = st.b[i];
      if (p && p.t === 'P' && (rowOf(i) === 0 || rowOf(i) === 7)) bad.pawn++;
    }
    if (inCheck(st, W) || inCheck(st, 'b')) bad.check++;
    if (st.cr.wK || st.cr.wQ || st.cr.bK || st.cr.bQ) bad.rights++;
  }
  ok('every request produced a position', bad.none, 0);
  ok('both kings are always on the board', bad.kings, 0);
  ok('and never touching', bad.adjacent, 0);
  ok('no pawn ever stands on a promotion rank', bad.pawn, 0);
  ok('neither side is ever already in check', bad.check, 0);
  ok('and nobody carries castling rights they never earned', bad.rights, 0);
})();

(function(){
  var queens = 0, worst = 0;
  for (var t = 0; t < 300; t++){
    var mats = prMaterial(16), w = 0, b = 0;
    for (var k = 0; k < mats.length; k++){
      if (mats[k][1] !== 'Q') continue;
      queens++;
      if (mats[k][0] === W) w++; else b++;
    }
    worst = Math.max(worst, w, b);
  }
  ok('material generation puts at most one queen a side', worst <= 1, true);
  ok('and it does put queens out sometimes', queens > 0, true);
})();

/* ============================================================
   3 — piece vision: the answer is the move generator's, on both a board
   and out of the notation, for one piece and for two
   ============================================================ */
head('Piece Vision');
(function(){
  var bad = 0;
  for (var lv = 1; lv <= PR_PIECE_LEVELS.length; lv++) for (var t = 0; t < 40; t++){
    var q = prMakePiece(prRecipe('piece', lv));
    if (!q){ bad++; continue; }
    var st = q.st; st.turn = q.colour;
    var legal = legalMoves(st, q.colour).filter(function(m){ return m.from === q.from || (q.second && m.from === q.second.from); });
    var want = {}; legal.forEach(function(m){ want[m.to] = 1; });
    if (Object.keys(want).length !== q.targets.size) bad++;
    q.targets.forEach(function(sq){ if (!want[sq]) bad++; });
    q.caps.forEach(function(sq){ if (!st.b[sq] || st.b[sq].c === q.colour) bad++; });
  }
  ok('every level generates and the reach re-derives', bad, 0);
  ok('level 6 is notation only', prRecipe('piece', 6).notation, true);
  ok('level 8 asks about two pieces', prRecipe('piece', 8).two, true);
})();

/* ============================================================
   3b — attack vision: every kind of question re-derives against an
   independent reading of the position, not the page's own prAttacked —
   attackedSquares() and isAttackedBy() above are a second implementation on
   purpose, so a drill and its check cannot agree just because they share a
   bug
   ============================================================ */
head('Attack Vision');
(function(){
  var bad = 0, kinds = {}, mixedSide = 0;
  for (var lv = 1; lv <= PR_ATTACK_LEVELS.length; lv++) for (var t = 0; t < 40; t++){
    var q = prMakeAttack(prRecipe('attack', lv));
    if (!q){ bad++; continue; }
    kinds[q.ask] = 1;
    var st = q.st;
    if (q.ask === 'attacks' && q.answer !== isAttackedBy(st, q.target, q.from)) bad++;
    if (q.ask === 'attacked'){
      var want = attackedSquares(st, q.from);
      if (want.length !== q.answer.length || want.some(function(s){ return q.answer.indexOf(s) < 0; })) bad++;
    }
    if (q.ask === 'attackers'){
      var byC = attackersOf(st, q.target, q.colour);
      if (byC.length !== q.answer.length) bad++;
      // one-sided by construction (attackersOf is asked with q.colour), and
      // this is the regression guard for it: a kingZone target sits beside
      // the enemy king, which always attacks its own neighbours, so a bug
      // that let the other side's men into q.answer would surface exactly
      // there and nowhere else.
      q.answer.forEach(function(sq){ if (st.b[sq] && st.b[sq].c !== q.colour) mixedSide++; });
    }
    if (q.ask === 'hanging' && prHanging(st).join() !== q.answer.join()) bad++;
    if (q.ask === 'pinned' && q.answer !== prPinned(st, q.target)) bad++;
  }
  ok('every level generates and re-derives', bad, 0);
  ok('six question kinds appear', Object.keys(kinds).length, 6);
  ok('attackers answers hold only the asking side', mixedSide, 0);
})();

/* ============================================================
   4 — Move Tracker: every level of the ladder generates a walk that
   replays, ply for ply, out of the move generator itself — and the
   question asked at the end of it is true of the position it reaches.
   The old Piece Tracking and Blindfold Sequence drills are these levels
   now; nothing they proved is untested, it is proved here instead.
   ============================================================ */
head('Move Tracker');
(function(){
  var bad = 0, seenCaps = 0, seenChecks = 0;
  for (var lv = 1; lv <= PR_TRACKER_LEVELS.length; lv++) for (var t = 0; t < 25; t++){
    var r = prRecipe('tracker', lv), q = prMakeTracker(r);
    if (!q){ bad++; continue; }
    var st = q.start;
    q.path.forEach(function(step, k){
      var legal = legalMoves(st, st.turn);
      var m = legal.filter(function(x){ return x.from === step.from && x.to === step.to && (!x.promo || x.promo === step.promo); })[0];
      if (!m || toSAN(st, m, legal) !== step.san) bad++;
      st = makeMove(st, m);
      if (r.sides === 'one') st.turn = q.start.turn;
      if (!sameBoard(st.b, q.frames[k + 1])) bad++;
      if (step.cap) seenCaps++;
    });
    if (q.path.length !== r.plies) bad++;
    var caps = q.path.filter(function(s){ return s.cap; }).length;
    if (caps < (r.captures || 0)) bad++;
    // sameBoard() also compares piece id, which is right for tracking one
    // piece through a walk (the frames share the actual piece objects) and
    // wrong here: q.frames[0] and this newState() are two unrelated calls, so
    // their ids can never agree even when both are the starting position.
    // Reading back only the placement field of a FEN is what "this is the
    // opening position" actually means.
    if (r.start === 'opening' && fenOf(stateOf(q.frames[0])).split(' ')[0] !== fenOf(newState()).split(' ')[0]) bad++;
    if (r.checkEvery && q.checks.length !== Math.floor((r.plies - 1) / r.checkEvery)) bad++;
    seenChecks += q.checks.length;
    if (q.ask.t === 'where' && q.end !== q.ask.sq) bad++;
  }
  ok('every level generates a legal, replayable walk', bad, 0);
  ok('captures happen where asked', seenCaps > 0, true);
  ok('checkpoints appear on the levels that carry them', seenChecks > 0, true);
  // the error typer
  var q2 = prMakeTracker(prRecipe('tracker', 2));
  ok('a click on an earlier square of the piece is "lost"', prTrackerErr(q2, q2.path[0].from) === 'lost' || q2.path[0].from === q2.end, true);
})();

/* ============================================================
   5 — what a Move Tracker walk is asked about is true of it. The block
   above proves the walk replays; this one re-derives the answer from the
   position the replay reaches, for every kind of question the ladder can
   draw. It is what the old Blindfold Sequence suite proved about its own
   lines, asked of the levels that replaced it.
   ============================================================ */
head('Move Tracker questions are true of the position the walk reaches');

(function(){
  var bad = 0, kinds = {}, i, p;
  for (var lv = 1; lv <= PR_TRACKER_LEVELS.length; lv++) for (var t = 0; t < 12; t++){
    var q = prMakeTracker(prRecipe('tracker', lv));
    if (!q){ bad++; continue; }
    kinds[q.ask.t] = (kinds[q.ask.t] || 0) + 1;

    // replay the walk from the position it started in, keeping the captures
    // this suite saw for itself rather than the ones the record claims
    var st = cloneState(q.start), taken = [];
    for (var k = 0; k < q.path.length; k++){
      var legal = legalMoves(st, st.turn);
      var m = legal.filter(function(x){ return x.from === q.path[k].from && x.to === q.path[k].to; })[0];
      if (!m){ bad++; break; }
      if (st.b[m.to]) taken.push(prMan(st.b[m.to].c, st.b[m.to].t));
      st = makeMove(st, m);
      if (q.recipe.sides === 'one') st.turn = q.start.turn;
    }

    if (q.ask.t === 'where'){
      p = st.b[q.ask.sq];
      if (!p || p.id !== q.askId) bad++;                 // named by identity, not by shape
    } else if (q.ask.t === 'what'){
      p = st.b[q.ask.sq];
      if (p ? (p.c !== q.ask.colour || p.t !== q.ask.type)
            : (q.ask.colour !== null || q.ask.type !== null)) bad++;
    } else if (q.ask.t === 'count'){
      var n = 0;
      for (i = 0; i < 64; i++) if (st.b[i] && st.b[i].c === q.ask.colour) n++;
      if (n !== q.ask.n) bad++;
    } else if (q.ask.t === 'captured'){
      if ((taken.length ? taken[taken.length - 1] : 'Nothing') !== q.ask.truth) bad++;
    } else if (q.ask.t === 'rebuild'){
      if (q.ask.want.length !== menOn(st.b)) bad++;
      q.ask.want.forEach(function(w){
        var on = st.b[w.sq];
        if (!on || on.c !== w.c || on.t !== w.t) bad++;
      });
    } else bad++;                                        // a kind nothing here can check
  }
  ok('every question is true of the position the walk reaches', bad, 0);
  ok('and all five kinds of question come up', Object.keys(kinds).sort().join(','),
     'captured,count,rebuild,what,where');
})();

/* ============================================================
   5b — After the Move: every level generates a move worth asking about, and
   every fact prMoveFacts hands back re-derives from the position it claims
   to describe — the square vacated, the squares now attacked from the new
   square, whether the mover is in check, what is left hanging, and (for
   every piece the record says had a line opened onto a square) that the
   line between that piece and the square really does run through the
   square the mover just left.
   ============================================================ */
head('After the Move');
(function(){
  var bad = 0;
  for (var lv = 1; lv <= PR_AFTER_LEVELS.length; lv++) for (var t = 0; t < 30; t++){
    var q = prMakeAfter(prRecipe('after', lv));
    if (!q){ bad++; continue; }
    var legal = legalMoves(q.st, q.st.turn);
    var m = legal.filter(function(x){ return x.from === q.move.from && x.to === q.move.to; })[0];
    if (!m){ bad++; continue; }
    var after = makeMove(q.st, m);
    if (!sameBoard(after.b, q.after.b)) bad++;
    if (q.facts.vacated !== m.from) bad++;
    if (q.facts.check !== inCheck(after, after.turn)) bad++;
    var hang = prHanging(after);
    if (hang.join() !== q.facts.hanging.join()) bad++;
    q.facts.opened.forEach(function(o){
      o.gained.forEach(function(sq){ var line = lineBetween(o.piece, sq); if (!line || line.indexOf(m.from) < 0) bad++; });
    });
    if (q.asks.length < 1) bad++;
  }
  ok('every level generates, and every fact re-derives', bad, 0);
})();

/* ============================================================
   5c — Forcing Lines: every level generates a capturing sequence that
   replays, ply for ply, out of the move generator itself — the exchange
   prExchangeLine claims is the exchange legalMoves()/toSAN() actually play,
   the material it says the exchange nets is the material the board actually
   holds afterward, and the square it names is left holding exactly what the
   line leaves there.
   ============================================================ */
head('Forcing Lines');
(function(){
  var bad = 0;
  for (var lv = 1; lv <= PR_FORCING_LEVELS.length; lv++) for (var t = 0; t < 30; t++){
    var q = prMakeForcing(prRecipe('forcing', lv));
    if (!q){ bad++; continue; }
    var st = q.st, mat = 0;
    q.line.forEach(function(step){
      var legal = legalMoves(st, st.turn);
      var m = legal.filter(function(x){ return x.from === step.from && x.to === step.to; })[0];
      if (!m){ bad++; return; }
      if (toSAN(st, m, legal) !== step.san) bad++;
      st = makeMove(st, m);
    });
    if (!sameBoard(st.b, q.final.b)) bad++;
    for (var i = 0; i < 64; i++){ var p = st.b[i]; if (p && p.t !== 'K') mat += (p.c === W ? 1 : -1) * VAL[p.t]; }
    var mat0 = 0;
    for (var j = 0; j < 64; j++){ var p0 = q.st.b[j]; if (p0 && p0.t !== 'K') mat0 += (p0.c === W ? 1 : -1) * VAL[p0.t]; }
    if (mat - mat0 !== q.delta) bad++;
    var occ = st.b[q.sq];
    if ((occ ? occ.c + occ.t : null) !== (q.occupant ? q.occupant.c + q.occupant.t : null)) bad++;
    if (q.line.length < 2) bad++;
  }
  ok('every level generates a legal, replayable exchange whose count is right', bad, 0);
})();

/* ============================================================
   Blind Calculation: mate in one, mate in two, a hanging piece and a
   fork, each re-verified by enumeration rather than trusted from generation
   — a mate-in-one claim is checked by asking prMatesIn1 again on the position
   handed back, not by remembering what the generator thought while building
   it. The two uniqueness checks are the ones a drill that judges the *move*
   cannot do without: a hanging piece is only one answer if no other capture
   is worth as much (by see(), not by the value of the man standing there —
   taking a defended rook with a queen is worth less than taking a loose
   knight), and a fork is only one answer if prForks finds exactly one.
   Levels 8 to 10 are lines rather than positions, so what is checked of them
   is that the preamble actually plays from the position handed back and that
   whatever the question then claims — a man on a square, a move to find — is
   true of the position it arrives at.
   ============================================================ */
head('Blind Calculation');
(function(){
  var st = stateFromFEN('6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1');
  ok('the back-rank position has exactly one mate in one', prMatesIn1(st).length, 1);
  var bad = 0, tasks = {};
  for (var lv = 1; lv <= 5; lv++) for (var t = 0; t < 20; t++){
    var q = prMakeCalc(prRecipe('calc', lv));
    if (!q){ bad++; continue; }
    tasks[q.task] = 1;
    var s = q.st;
    var legal = legalMoves(s, s.turn);
    var m = legal.filter(function(x){ return x.from === q.answer.from && x.to === q.answer.to; })[0];
    if (!m){ bad++; continue; }
    if (q.task === 'mate1' && prMatesIn1(s).length !== 1) bad++;
    if (q.task === 'mate2' && prMatesIn2(s).length !== 1) bad++;
    if (q.task === 'hanging'){
      var net = see(s, q.answer.to, s.turn);
      if (net <= 0) bad++;
      var rivals = legal.filter(function(x){
        return x.cap && !(x.from === q.answer.from && x.to === q.answer.to);
      });
      if (!rivals.every(function(x){ return see(s, x.to, s.turn) < net; })) bad++;
    }
    if (q.task === 'fork' && prForks(s).length !== 1) bad++;
  }
  ok('levels one to five generate verified tactics', bad, 0);
  ok('mate, hanging, fork and mate-in-two all appear', ['mate1','hanging','fork','mate2'].every(function(k){ return tasks[k]; }), true);

  var lies = 0;
  for (var lv2 = 8; lv2 <= 10; lv2++) for (var t2 = 0; t2 < 10; t2++){
    var q2 = prMakeCalc(prRecipe('calc', lv2));
    if (!q2){ bad++; continue; }
    var s2 = q2.st;
    q2.pre.forEach(function(san){ var mm = moveFromSAN(s2, san); if (!mm) bad++; else s2 = makeMove(s2, mm); });
    // and the question asked at the end of that line is true of where it ends
    if (q2.task === 'line'){
      var p = s2.b[q2.endAsk.sq];
      if ((p ? p.c + p.t : null) !== (q2.endAsk.type ? q2.endAsk.colour + q2.endAsk.type : null)) lies++;
    } else {
      // the tactic is re-derived from the position the *notation* reaches,
      // not from the one the generator was holding — a line whose written
      // form plays out somewhere else is exactly the bug worth catching, and
      // it would show up here as an answer that is no longer the answer
      var end = legalMoves(s2, s2.turn).filter(function(x){
        return x.from === q2.answer.from && x.to === q2.answer.to;
      })[0];
      var mates = prMatesIn1(s2);
      var want = mates.length === 1 ? mates[0] : (mates.length ? null : prCalcHanging(s2));
      if (!end || !want || want.from !== q2.answer.from || want.to !== q2.answer.to) lies++;
    }
  }
  ok('the line levels carry legal preambles', bad, 0);
  ok('and the question at the end of one is true of the position it reaches', lies, 0);

  /* The two puzzle levels. With the shipped ladder in hand the position and
     the move are the file's own, matched through the page's own uciOf rather
     than trusted as a string; without it — a fetch that failed, and every
     test harness here, which has no fetch at all — the level falls back to a
     built position of its own kind and says so, which is what the presenter
     puts on screen. */
  var pool = [{ id:'t-1', fen:'6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1', moves:['d1d8'] }];
  var pz = prMakeCalc(Object.assign(prRecipe('calc', 7), { pool: pool }));
  ok('a puzzle level plays a position out of the shipped set', pz && pz.task, 'puzzle');
  ok('and its answer is the move the file gives', uciOf({ from: pz.answer.from, to: pz.answer.to, promo: pz.answer.promo }), 'd1d8');
  ok('named by the puzzle, so nobody is asked the same one twice', pz.sig, 'calc:puzzle:t-1');
  var fb = prMakeCalc(prRecipe('calc', 6));
  ok('a puzzle level with no puzzles falls back to a built position', fb.fallback, true);
  ok('of the kind that level is worth', ['mate1','hanging','fork','mate2'].indexOf(fb.task) >= 0, true);
  ok('the ladder a level reads is decided by the men it asks for', prCalcTrack(prRecipe('calc', 6)), 'endgame');
  ok('the full positions coming from the middlegame set', prCalcTrack(prRecipe('calc', 7)), 'middlegame');
  ok('and a track is fetched once and remembered', prPuzzlePool('endgame'), prPuzzlePool('endgame'));

  /* A puzzle level's question is built after the screen is already up, so it
     never passes through prMake and its don't-ask-this-again retry.
     prCalcDraw is that retry, and this is the only thing worth asserting
     about it: with one of two puzzles already asked, the other one is what
     comes back, every time. */
  var seenPool = pool.concat([{ id:'t-2', fen:'3r2k1/5ppp/8/8/8/8/5PPP/6K1 b - - 0 1', moves:['d8d1'] }]);
  storage = {};                      // the week's seen-list starts empty, whatever ran before
  prSeenPush('calc:puzzle:t-1');
  /* The draw from the pool is prPick's, and prCalcDraw only gets six tries at
     it: with a pool of two, six coin flips all landing on the seen puzzle is
     a one-in-sixty-four outcome, and six of these calls in a row made this
     block fail about one run in twelve (measured: 171 of 2000). So the pick
     is made round-robin for the length of the block — what is under test is
     the "don't ask a seen one again" retry, not the dice, and a test that
     asserts an exact count of six has to be handed a deterministic draw or it
     is asserting the coin. Everything else in the suite keeps the real one. */
  var realPick = prPick, pickAt = 0;
  prPick = function(a){ return a === seenPool ? a[pickAt++ % a.length] : realPick(a); };
  var again = 0, fresh = 0;
  for (var d = 0; d < 6; d++){
    var drawn = prCalcDraw(prRecipe('calc', 7), seenPool);
    if (drawn.sig === 'calc:puzzle:t-1') again++;
    if (drawn.sig === 'calc:puzzle:t-2') fresh++;
  }
  ok('a puzzle asked this week is not asked again while another is free', again, 0);
  ok('the one that has not been asked is what comes back', fresh, 6);
  // ...and with both of them seen it still asks something rather than nothing
  prSeenPush('calc:puzzle:t-2');
  ok('a pool with nothing fresh in it still hands back a question',
     prCalcDraw(prRecipe('calc', 7), seenPool).task, 'puzzle');
  prPick = realPick;
  storage = {};
})();

/* ============================================================
   Branches: every branch replays out of the move generator itself, back to
   back from the shared root rather than from wherever the branch before it
   stopped — `s` restarts at `q.root` for each one below, exactly as
   prMakeBranches restarts it. Two things beyond plain replay are checked of
   the set as a whole: that every branch after the first actually shares a
   square with the first one (`touched`, fixed the moment the first branch
   is read and never grown after — the same anchor prMakeBranches itself
   measures every later branch against), since a branch that touches
   nothing the first branch touched could never be confused with it, and
   that every branch's own `rootAsk` sits on a square that branch left
   different from the root — the whole reason a wrong rewind is even
   detectable — checked by comparing what actually stands there once the
   branch has been replayed against what stood there in the root itself.
   ============================================================ */
head('Branches');
(function(){
  var bad = 0;
  for (var lv = 1; lv <= PR_BRANCHES_LEVELS.length; lv++) for (var t = 0; t < 20; t++){
    var q = prMakeBranches(prRecipe('branches', lv));
    if (!q){ bad++; continue; }
    if (q.branches.length !== prRecipe('branches', lv).count) bad++;
    var touched = null;
    q.branches.forEach(function(br){
      var s = q.root, squares = {};
      br.sans.forEach(function(san){ var m = moveFromSAN(s, san); if (!m){ bad++; return; } squares[m.from] = squares[m.to] = 1; s = makeMove(s, m); });
      if (!sameBoard(s.b, br.end.b)) bad++;
      if (touched && !Object.keys(squares).some(function(k){ return touched[k]; })) bad++;
      touched = touched || squares;
      // this branch's root question must be answerable differently at the root and at this end
      var atRoot = q.root.b[br.rootAsk.sq], atEnd = s.b[br.rootAsk.sq];
      if ((atRoot ? atRoot.c + atRoot.t : '') === (atEnd ? atEnd.c + atEnd.t : '')) bad++;
    });
  }
  ok('every level generates branches that share a square and disagree with the root', bad, 0);
})();

/* ============================================================
   6 — Hold the Position: every level generates a legal, right-sized
   position, in one of its three answer modes, and every claim the
   question makes about that position is true of it.
   ============================================================ */
head('Hold the Position');

(function(){
  var bad = 0, modes = {};
  for (var lv = 1; lv <= PR_HOLD_LEVELS.length; lv++) for (var t = 0; t < 30; t++){
    var q = prMakeHold(prRecipe('hold', lv));
    if (!q){ bad++; continue; }
    modes[q.mode] = 1;
    if (menOn(q.st.b) > prRecipe('hold', lv).men + 2) bad++;          // both kings are extra
    if (inCheck(q.st, other(q.st.turn))) bad++;
    if (q.mode === 'change'){
      var legal = legalMoves(q.st, q.st.turn);
      if (!legal.some(function(m){ return m.from === q.change.from && m.to === q.change.to; })) bad++;
    }
    if (q.mode === 'rebuild' && q.want.length !== menOn(q.st.b)) bad++;
    if (q.mode === 'question' && q.ask.t === 'where' && q.st.b[q.ask.sq] === null) bad++;
  }
  ok('every level generates a legal, right-sized position', bad, 0);
  ok('all three answer modes appear', Object.keys(modes).length, 3);
  var g = prGamePosition(12);
  ok('a game position has thirty-two men or fewer', menOn(g.b) <= 32, true);
  var c = prCluster(g, 6);
  ok('a cluster keeps both kings', kingSq(c, W) >= 0 && kingSq(c, B) >= 0, true);
  ok('and no more men than asked', menOn(c.b) <= 8, true);
})();

/* ============================================================
   7 — Progressive Blindfold is a game, played by the page's own engine
   ============================================================ */
head('Progressive Blindfold positions');

(function(){
  var bad = 0;
  for (var lv = 1; lv <= PR_PB_LEVELS.length; lv++) for (var t = 0; t < 30; t++){
    var q = prMakeProgressive(prRecipe('progressive', lv));
    if (!q){ bad++; continue; }
    var r = prRecipe('progressive', lv);
    if (r.men && (menOn(q.st.b) !== 2 * r.men)) bad++;
    /* The top level deals the game's own opening position, and the check is
       made on the FEN's placement field rather than with sameBoard(): that
       compares piece *ids*, and two newState() calls never share any — every
       man is minted fresh by mk(). What is being asserted is that the men
       stand where the start position puts them, which is exactly what the
       placement field says and nothing more. */
    if (!r.men && fenOf(q.st).split(' ')[0] !== fenOf(newState()).split(' ')[0]) bad++;
    if (legalMoves(q.st, W).length < 4) bad++;
    if (inCheck(q.st, W) || inCheck(q.st, B)) bad++;
  }
  ok('every level deals a legal position with the men asked for', bad, 0);
})();

(function(){
  var caps = {};
  for (var lv = 1; lv <= PR_PB_LEVELS.length; lv++){
    var r = prRecipe('progressive', lv);
    caps[r.vis] = 1;
    if (!(r.target > 0)) caps.badTarget = 1;
  }
  ok('the ladder walks the three visions in turn',
     ['mine','squares','console'].every(function(v){ return caps[v]; }), true);
  ok('and every rung runs to a target', caps.badTarget, undefined);
  ok('the ladder is ten rungs', PR_PB_LEVELS.length, 10);
  ok('and a level above the top is clamped to it', prRecipe('progressive', 99).level, 10);
})();

(function(){
  /* A dealt rung stamps its position so the same one is not handed out twice
     in a week; the top rung is the game's own opening and cannot, because
     prMake's retry gives up on the level and falls back to the level ONE
     recipe — which is a different exercise entirely, and would be dealt under
     level ten's name. */
  storage = {};
  var one = prMake('progressive', 1);
  ok('a dealt rung names the position it dealt', /^pb:1:/.test(one.sig), true);
  var top = prMake('progressive', 10);
  ok('the opening rung names nothing', top.sig, null);
  if (top.sig) prSeenPush(top.sig);            // what prNextQuestion does with one
  ok('and so can be asked again in the same week', prMake('progressive', 10).recipe.level, 10);
  storage = {};
})();

(function(){
  /* Play several out the way the page does: the player's move read back out of
     notation, the reply from the small search already in this file. The player
     here takes whatever move comes first, which is bad chess and sometimes
     walks into mate in two — so the check is that every ply was legal and that
     a short game ended for a reason the rules gave, not that it ran long. */
  var illegal = 0, unread = 0, cutShort = 0, games = 0, total = 0;
  for (var g = 0; g < 6; g++){
    var q = prMakeProgressive(prRecipe('progressive', 1 + (g % 3)));
    if (!q) continue;
    games++;
    var st = q.st, plies = 0, ended = false;
    for (var k = 0; k < 10; k++){
      var mine = legalMoves(st, st.turn);
      if (!mine.length){ ended = true; break; }
      var res = parseMoveIn(st, toSAN(st, mine[0], mine));
      if (res.error){ unread++; break; }
      st = makeMove(st, res.move);
      plies++;
      var theirs = legalMoves(st, st.turn);
      if (!theirs.length){ ended = true; break; }
      var reply = bestMove(st, 2);
      var found = false;
      for (var j = 0; j < theirs.length; j++)
        if (theirs[j].from === reply.from && theirs[j].to === reply.to &&
            theirs[j].promo === reply.promo) found = true;
      if (!found){ illegal++; break; }
      st = makeMove(st, reply);
      plies++;
    }
    total += plies;
    if (plies < 4 && !ended) cutShort++;
  }
  ok('six games were played out', games, 6);
  ok('every move the player typed read back as notation', unread, 0);
  ok('and every reply the engine gave was legal', illegal, 0);
  ok('a short game only ever ended because the rules ended it', cutShort, 0);
  ok('and the six between them went a fair way', total > 20, true);
})();

/* ============================================================
   8 — retries and fallbacks: nothing broken reaches the screen
   ============================================================ */
head('Generation never hands back something broken');

(function(){
  // every key PR_MODES names, walked over its own ladder rather than a bare
  // 1-3 borrowed from the modes that had one first — Square Trainer alone
  // runs to level 7, and a fixed range would never reach it.
  var keys = PR_MODES.map(function(m){ return m.key; });
  var missing = 0, wrongKind = 0, total = 0;
  // `kind` is the question's own shape, and every drill now answers to its
  // mode's own key — Progressive Blindfold was the last exemption here, back
  // when it handed out the old mini challenge's `kind:'mini'`.
  for (var k = 0; k < keys.length; k++){
    var key = keys[k], top = PR_MODE[key].levels.length;
    for (var level = 1; level <= top; level++){
      for (var t = 0; t < 8; t++){
        total++;
        var q = prMake(key, level);
        if (!q){ missing++; continue; }
        if (q.kind !== key) wrongKind++;
      }
    }
  }
  ok('every drill at every level produced an exercise', missing, 0);
  ok('and every one carries its own mode\'s kind', wrongKind, 0);
  ok('and there were plenty of them', total > 180, true);
})();

/* ============================================================
   9 — the record: accuracy, streaks, sessions, and whose they are
   ============================================================ */
head('What is remembered, and for whom');

(function(){
  storage = {};
  var blank = prLoad();
  ok('a browser that has never practised starts at nothing', blank.asked + blank.correct + blank.sessions, 0);
  ok('and knows about every drill', PR_MODES.every(function(m){ return !!blank.modes[m.key]; }), true);

  PR.mode = PR_MODES[0];
  prRecord(true); prRecord(true); prRecord(false); prRecord(true);
  var st = prLoad();
  ok('four answers were counted', st.asked, 4);
  ok('three of them right', st.correct, 3);
  // the running answer-streak is not part of what v2's store keeps between
  // reloads (prLoad's whitelist has no `streak`) — only `asked`/`correct`/
  // `best` survive a reload, which is what the rest of this block checks
  ok('the drill keeps its own tally', st.modes.square.asked, 4);
  ok('and the other drills are untouched', st.modes.hold.asked, 0);

  // and it survives being read back — which is what a refresh does
  ok('accuracy reads back the same after a reload',
     Math.round(prAcc(prLoad()) * 100), 75);
})();

(function(){
  storage = {};
  storage[PR_STORE + 'guest'] = 'not json at all {{{';
  ok('a corrupt record starts clean rather than throwing', prLoad().asked, 0);
  storage[PR_STORE + 'guest'] = JSON.stringify({ v: 99, asked: 500, modes: {} });
  ok('and so does one from a version this page does not speak', prLoad().asked, 0);
  // a record missing a drill added later is merged, not thrown away
  storage[PR_STORE + 'guest'] = JSON.stringify({ v: PR_VERSION, asked: 9, correct: 6, modes: { square: { asked: 9, correct: 6 } } });
  var merged = prLoad();
  ok('an older record keeps what it knew', merged.correct, 6);
  ok('and gains the drills it had never heard of', merged.modes.progressive.asked, 0);
})();

(function(){
  storage = {};
  PR.mode = PR_MODES[0];
  prRecord(true);
  var asGuest = prLoad().asked;
  account = { id: 'abc-123' };
  var asAccount = prLoad().asked;
  prRecord(true); prRecord(true);
  var mine = prLoad().asked;
  account = null;
  ok('a guest and an account do not share a record', asGuest === 1 && asAccount === 0, true);
  ok('the account keeps its own', mine, 2);
  ok('and the guest still has theirs', prLoad().asked, 1);
})();

/* ============================================================
   10 — Store v2
   ============================================================ */
head('Store v2');
(function(){
  storage = {};
  var st = prBlank();
  ok('a blank store is version 2', st.v, 2);
  ok('every mode starts at level 1', Object.keys(st.modes).every(function(k){ return st.modes[k].level === 1; }), true);
  // a v1 record from the seven-drill page is read through the key map
  storage[prKey()] = JSON.stringify({ v:1, asked:40, correct:30, sessions:4, streak:2, best:5,
    modes:{ coord:{asked:20,correct:18,sessions:2,best:5,diff:3}, track:{asked:20,correct:12,sessions:2,best:3,diff:2},
            mini:{asked:0,correct:0,sessions:0,best:0,diff:1} } });
  var up = prLoad();
  ok('v1 coord answers land on square', up.modes.square.asked, 20);
  ok('v1 track answers land on tracker', up.modes.tracker.asked, 20);
  ok('a v1 diff of 3 becomes level 3', up.modes.square.level, 3);
  ok('a v1 record\'s best streak survives the merge into stats', up.modes.square.stats.streak, 5);
  ok('the totals survive', up.asked, 40);
  storage = {};
  prSeenPush('a'); prSeenPush('b');
  ok('the seen list remembers', prSeenHas('a') && prSeenHas('b'), true);
  for (var i = 0; i < 120; i++) prSeenPush('x' + i);
  ok('and keeps only the last hundred', prSeen().length, 100);
  ok('so the oldest is forgotten', prSeenHas('a'), false);
  var d = prBlank(); d.lastDay = ''; prTouchDay(d);
  ok('the first day practised is day one', d.days, 1);
  prTouchDay(d);
  ok('the same day again is still day one', d.days, 1);
})();

head('The recommender');
(function(){
  storage = {};
  var st = prLoad();
  ok('a fresh player is sent to the board', prRecommendNext(st, []).key === 'square' || prRecommendNext(st, []).key === 'lines', true);
  ['square','lines','piece','attack'].forEach(function(k){ st.modes[k].level = 5; });
  st.modes.square.stats.lat = [800];
  var r = prRecommendNext(st, []);
  ok('with the floor done, holding is next', ['hold','tracker'].indexOf(r.key) >= 0, true);
  ok('the why names a level caption', /level \d/.test(r.why), true);
  st.modes.tracker.level = 5; st.modes.forcing.level = 2; st.modes.hold.level = 4;
  ok('the bridge is offered once its three gates are met', prRecommendNext(st, []).key === 'progressive' || prRecommendNext(st, [10]).key === 'progressive', true);
})();

(function(){
  // every group's own ≥2 floor can clear — Board via prAutomatic, everyone
  // else at level 2 — while nothing is anywhere near 60% and the bridge's
  // own three gates are still unmet; the walk that finds nothing to stop
  // at must still answer rather than say nothing, because this is a state
  // a player reaches by following the recommender itself
  storage = {};
  var st = prLoad();
  st.modes.square.level = 5; st.modes.square.stats.lat = [800];
  // tracker and attack land at level 2 here too, well short of the bridge's
  // own gates (tracker ≥5, attack ≥4)
  PR_MODES.forEach(function(m){ if (m.key !== 'square' && m.key !== 'progressive') st.modes[m.key].level = 2; });
  var r = prRecommendNext(st, []);
  ok('every floor cleared still names something', r !== null, true);
  ok('and it is not a Board drill', r && r.key !== 'square' && r.key !== 'lines', true);
})();

(function(){
  // once every drill is at least 60% up its own ladder the bridge itself
  // is the answer, rather than the walk having nothing left to recommend
  storage = {};
  var st = prLoad();
  PR_MODES.forEach(function(m){ st.modes[m.key].level = m.levels.length; });
  st.modes.square.stats.lat = [800];
  ok('an all-maxed store points at the bridge', prRecommendNext(st, []).key, 'progressive');
})();

/* ============================================================
   11 — levels and the staircase
   ============================================================ */
head('Levels and the staircase');

(function(){
  var r = prRecipe('square', 99);
  ok('a level past the ladder is clamped', r.level, PR_MODE.square.levels.length);
  ok('a recipe carries its caption', typeof r.cap, 'string');
  PR.mode = PR_MODE.square; PR.level = 2; PR.runUp = 0; PR.runDown = 0;
  prStep(true); prStep(true); ok('two right do not move the level', PR.level, 2);
  prStep(true); ok('three right step up', PR.level, 3);
  prStep(false); ok('one wrong holds', PR.level, 3);
  prStep(false); ok('two wrong step down', PR.level, 2);
  PR.level = 1; PR.runDown = 0; prStep(false); prStep(false);
  ok('level one is the floor', PR.level, 1);
})();

/* ============================================================
   12 — the shared opening book and opening lines
   ============================================================ */
head('Opening book and lines');
(function(){
  var st = newState(), ok1 = true;
  for (var p = 0; p < 12; p++){
    var pick = bookMove(st, p, prRand);
    // legalMoves() hands back a fresh array of move objects on every call, so a
    // reference check against a second, separately-computed array never matches
    // even a genuinely legal move; from/to/promo is what actually names a move.
    var isLegal = pick && legalMoves(st, st.turn).some(function(m){
      return m.from === pick.m.from && m.to === pick.m.to && (m.promo || '') === (pick.m.promo || '');
    });
    if (!isLegal){ ok1 = false; break; }
    st = makeMove(st, pick.m);
  }
  ok('bookMove plays twelve legal plies from the start', ok1, true);
  ok('there are at least twenty opening lines', OPENING_LINES.length >= 20, true);
  var bad = 0;
  OPENING_LINES.forEach(function(L){
    var s = newState();
    L.sans.forEach(function(san){
      var m = moveFromSAN(s, san);
      if (!m){ bad++; return; }
      s = makeMove(s, m);
    });
  });
  ok('every opening line is legal from move one', bad, 0);
  var r = openingPosition(0, 6);
  ok('openingPosition replays the asked plies', r.sans.length, 6);
})();

head('Geometry helpers');
(function(){
  var a1 = sqIndex('a1'), a8 = sqIndex('a8'), h8 = sqIndex('h8'), e4 = sqIndex('e4'), b1 = sqIndex('b1');
  ok('a1–a8 has six squares between', lineBetween(a1, a8).length, 6);
  ok('a1–h8 has six squares between', lineBetween(a1, h8).length, 6);
  // b1 and e4 are not the counter-example they look like: b1-c2-d3-e4 is a real
  // diagonal, so a1 and e4 (sharing no rank, file, or diagonal) stand in instead.
  ok('a1–e4 is not a line', lineBetween(a1, e4), null);
  var L = linesThrough(e4);
  ok('e4: seven on its rank', L.rank.length, 7);
  ok('e4: seven on its file', L.file.length, 7);
  ok('e4: both diagonals together hold thirteen', L.diag1.length + L.diag2.length, 13);
  var route = knightRoute(b1, e4);
  ok('b1→e4 is two knight moves', route.length - 1, 2);
  ok('the route starts and ends where asked', route[0] === b1 && route[route.length - 1] === e4, true);
  ok('a1→h8 by knight is six moves', knightRoute(a1, h8).length - 1, 6);
  var b = Array(64).fill(null);
  ok('an empty a-file: the rook reaches', sliderReaches(b, a1, a8, 'R'), true);
  b[sqIndex('a4')] = mk(W, 'P');
  ok('a pawn on a4 stops it', sliderReaches(b, a1, a8, 'R'), false);
  ok('a bishop never reaches along a file', sliderReaches(Array(64).fill(null), a1, a8, 'B'), false);
  var d = rebuildDiff([{sq:a1,c:W,t:'K'},{sq:e4,c:B,t:'N'}], [{sq:a1,c:W,t:'K'},{sq:h8,c:B,t:'K'}]);
  ok('rebuildDiff: one right', d.right.length, 1);
  ok('rebuildDiff: one wrong', d.wrong.length, 1);
  ok('rebuildDiff: one missing', d.missing.length, 1);
  ok('e4 is in the h1 quarter', quadrantOf(e4), 'h1');
})();

/* ============================================================
   13 — error types and latency in the record
   ============================================================ */
head('Error types and latency');
(function(){
  storage = {};
  PR.mode = PR_MODE.tracker; PR.level = 4; PR.shownAt = 0;
  prRecord(false, 'ghost', 1200);
  prRecord(true, null, 800);
  var m = prLoad().modes.tracker;
  ok('a ghost-piece error is counted by name', m.stats.errs.ghost, 1);
  ok('per-level accuracy is kept', m.stats.lv['4'].a === 2 && m.stats.lv['4'].c === 1, true);
  ok('latency samples are kept', m.stats.lat.length, 2);
  for (var i = 0; i < 30; i++) prRecord(true, null, 500);
  ok('but only the last twenty', prLoad().modes.tracker.stats.lat.length, 20);
  ok('median latency reads back', prMedianLat(prLoad().modes.tracker), 500);
  PR.q = { ply:6 }; prRecord(true, null, 400);
  ok('a right answer on a six-ply question sets the ply depth', prLoad().modes.tracker.stats.ply, 6);
  PR.q = null;
})();

/* ============================================================
   14 — every mode names the lesson that teaches it, and the floors agree
   ============================================================ */
head('Lesson numbers: PR_MODES and PR_FLOORS never disagree');
(function(){
  // The design's own table (docs/superpowers/specs/2026-09-09-blindfold-
  // training-design.md, section 6): pinned here rather than read back off
  // PR_MODES, so a stray edit to one entry is caught rather than silently
  // matching itself.
  var LESSON_OF = {
    square:1, lines:2, piece:4, attack:4, hold:5, tracker:5,
    after:6, forcing:7, calc:9, branches:9, progressive:10
  };
  var wrong = [];
  for (var key in LESSON_OF)
    if (PR_MODE[key].lesson !== LESSON_OF[key])
      wrong.push(key + ': PR_MODES has ' + PR_MODE[key].lesson + ', wanted ' + LESSON_OF[key]);
  ok('every PR_MODES entry names the lesson the design table gives it',
     wrong.join('; '), '');

  // PR_FLOORS floors a mode's first session on the strength of a lesson
  // being finished; PR_MODES' own `lesson` field is what the setup box's
  // link names. Two numbers for the same fact is how they drift apart, so
  // this holds them to each other directly rather than to the table a
  // second time.
  var disagree = [];
  for (var fkey in PR_FLOORS)
    if (PR_FLOORS[fkey].lesson !== PR_MODE[fkey].lesson)
      disagree.push(fkey + ': PR_FLOORS names lesson ' + PR_FLOORS[fkey].lesson +
                     ', PR_MODES names ' + PR_MODE[fkey].lesson);
  ok('every PR_FLOORS entry agrees with its mode\'s own lesson field', disagree.join('; '), '');
})();

/* ============================================================
   15 — the account's copy: merging, pushing, adopting a guest
   ============================================================
   The one asynchronous section, and the only one with a Supabase client at
   all: `sb` is a fake whose from() answers a scripted set of rows and records
   every upsert. What is being checked is the bargain the puzzle ladder
   already makes — practising as a guest and then signing up keeps the
   practice, on both records, and the guest's copy stops being the guest's. */
head('Sync: a guest record adopted by the account that signs in over it');
var syncTest = (async function(){
  storage = {};
  var upserts = [], selected = null;
  // what the account already had: tracker practised a lot, at a lower level
  var rows = [{ mode:'tracker', level:2, best:2, asked:30, correct:20, sessions:3, stats:{ ply:2 } }];
  sb = {
    from: function(table){
      return {
        select: function(cols){
          return { eq: function(col, val){
            selected = { table:table, cols:cols, col:col, val:val };
            return Promise.resolve({ data: rows, error: null });
          } };
        },
        upsert: function(row, opts){
          upserts.push({ table:table, row:row, opts:opts });
          return Promise.resolve({ error: null });
        }
      };
    }
  };
  account = { id:'u1' };

  // what this browser did before anybody signed in: tracker taken to level 4,
  // one lesson finished, and a handful of questions it should not ask again.
  // The lesson record is written at v2 on purpose — the five-lesson course's
  // own numbering, which is what a browser that has not been opened since
  // still holds. prSync() reads it through lsnStored(), so the migration
  // (LSN_V2_TO_V3: old 2, Chess Notation, is new 3, Reading a Move) has to
  // run on the sign-in path as well as on the lessons screen, and the number
  // that reaches the account and the cloud row has to be the new one.
  var guest = prBlank();
  guest.modes.tracker = { level:4, best:4, asked:8, correct:7, sessions:1, lastAt:5, stats:{ streak:3 } };
  storage[PR_STORE + 'guest'] = JSON.stringify(guest);
  storage[PR_STORE + 'seen.guest'] = JSON.stringify(['sig']);
  storage[lsnKey('')] = JSON.stringify({ v:2, done:[2] });

  await prSync();

  ok('the account is what was asked for', selected && selected.table + ':' + selected.val,
     'practice_progress:u1');

  var st = prLoad();                       // account is set, so this is the account's own key
  ok('the higher level wins, whichever side it came from', st.modes.tracker.level, 4);
  ok('and it is the best level too', st.modes.tracker.best, 4);
  ok('the busier record keeps its tally', st.modes.tracker.asked, 30);
  ok('...and its stats', JSON.stringify(st.modes.tracker.stats.ply), '2');

  var tracker = upserts.filter(function(u){ return u.row.mode === 'tracker'; });
  ok('the merged mode is pushed back, once', tracker.length, 1);
  ok('at the level the merge settled on', tracker.length && tracker[0].row.level, 4);
  ok('under the account it belongs to', tracker.length && tracker[0].row.user_id, 'u1');
  ok('keyed on the row it replaces', tracker.length && tracker[0].opts.onConflict, 'user_id,mode');
  var untouched = upserts.filter(function(u){ return u.row.mode === 'square'; });
  ok('a mode nobody has practised writes no row', untouched.length, 0);

  ok('the course the guest finished is now the account\'s, at its new number',
     JSON.stringify(lsnStored('u1')), '[3]');
  var course = upserts.filter(function(u){ return u.row.mode === 'course'; });
  ok('and is pushed as the reserved course row', course.length, 1);
  ok('with the lessons in its stats', course.length && JSON.stringify(course[0].row.stats.done), '[3]');

  ok('the guest practice record is claimed and gone',
     storage[PR_STORE + 'guest'] === undefined, true);
  ok('so is the guest question list', storage[PR_STORE + 'seen.guest'] === undefined, true);
  ok('so is the guest course record', storage[lsnKey('')] === undefined, true);

  // and a guest signs nothing anywhere: no client, no account, no writes
  upserts.length = 0;
  account = null; sb = null;
  prPush('tracker'); prPushCourse([1]);
  await prSync();
  ok('a guest pushes nothing', upserts.length, 0);
})();

function report(){
  say('\n' + passed + ' passed, ' + failed + ' failed\n');
  if (typeof process !== 'undefined' && failed) process.exit(1);
}
syncTest.then(report, function(err){
  failed++;
  say('  FAIL  the sync section threw  ->  ' + (err && err.stack || err));
  report();
});
