/* The practice drills, without a browser.
 *
 * Practice is the one part of the page that MAKES chess rather than reading
 * it: it invents positions, movement questions, tracking walks and blindfold
 * sequences on the spot. Everything it invents is claimed to be legal, and a
 * claim like that is worth exactly what checks it. So this suite generates
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
function prStatsRender(){}             // pixels; this suite is about the state behind them

/* ---- the real half ---- */
var DECLS = ['VAL','FILES','rowOf','colOf','SQNAME','uciOf','sqName','onBoard','other',
             'idCounter','mk','DIR_N','DIR_B','DIR_R','DIR_K','PST','nodes','PIECE_NAME',
             'PR_MODES','PR_LEVELS','PR_STORE','PR_VERSION','prKey','prAcc','prTried',
             'PR','prRand','prPick','prSide','prMan','PR_MAKE','W'];
var FNS = ['startBoard','newState','cloneState','fenOf','stateFromFEN',
           'slide','step','addPawn','pseudoMoves','isAttacked','kingSq','inCheck',
           'makeMove','legalMoves','toSAN','attackersOf','defendersOf','see',
           'mirror','evaluate','orderMoves','scoreMove','quiesce','negamax','bestMove',
           'parseMoveIn',
           'prBlank','prLoad','prSave','prLevelIndex','prLevelProgress',
           'prShuffle','prPosition','prMaterial','prColourWhy',
           'prMakeCoord','prMakeColor','prMakeVision','prMakeTrack','prMakeMemory',
           'prPickMove','prAskAbout','prMakeSequence','prMakeMini','prMake',
           'prRecord','prScore','prRecommend'];

var bundle = [grab(/\nconst W = 'w', B = 'b';/, "const W/B")];
for (var d = 0; d < DECLS.length; d++) if (DECLS[d] !== 'W') bundle.push(decl(DECLS[d]));
for (var f = 0; f < FNS.length; f++) bundle.push(fn(FNS[f]));
// PR_MODE is filled by a loop rather than written out, and prRecommend reads it
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
  var seen = {}, wrong = 0;
  for (var t = 0; t < 4000; t++){
    var q = prMakeColor(1 + (t % 3));
    seen[q.sq] = 1;
    if (q.dark !== darkByName(sqName(q.sq))) wrong++;
  }
  ok('Square Colour never disagrees with the rule', wrong, 0);
  ok('and it reaches every square of the board', Object.keys(seen).length, 64);
  var why = prColourWhy(sqIndexOf('f6'));
  ok('the explanation names the square and its colour', /f6 is dark/.test(why), true);
  ok('and the explanation for a light one says light', /e4 is light/.test(prColourWhy(sqIndexOf('e4'))), true);
})();
function sqIndexOf(name){ return (8 - (+name[1])) * 8 + 'abcdefgh'.indexOf(name[0]); }

(function(){
  var labelled = 0, flipped = 0, easyFlipped = 0;
  for (var t = 0; t < 600; t++){
    if (prMakeCoord(1).labels) labelled++;
    if (prMakeCoord(1).flipped) easyFlipped++;
    if (prMakeCoord(3).flipped) flipped++;
  }
  ok('the easiest coordinate drill always labels the board', labelled, 600);
  ok('and never turns it round', easyFlipped, 0);
  ok('the hardest one does, sometimes', flipped > 100 && flipped < 500, true);
  ok('and it never labels the board', prMakeCoord(3).labels, false);
  ok('the middle setting drops the labels and keeps White below',
     prMakeCoord(2).labels === false && prMakeCoord(2).flipped === false, true);
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
   3 — piece visualization: the answer is the move generator's
   ============================================================ */
head('Piece Visualization asks legal questions');

(function(){
  var checked = 0, mismatch = 0, tooFew = 0, wrongPiece = 0, sizes = { 1:[], 3:[] };
  for (var diff = 1; diff <= 3; diff++){
    for (var t = 0; t < 90; t++){
      var q = prMakeVision(diff);
      if (!q){ continue; }
      checked++;
      var piece = q.st.b[q.from];
      if (!piece || piece.t !== q.type || piece.c !== q.colour) wrongPiece++;
      // the drill's answer, re-derived from the rules rather than trusted
      var legal = legalMoves(q.st, q.colour).filter(function(m){ return m.from === q.from; });
      var truth = {};
      for (var k = 0; k < legal.length; k++) truth[legal[k].to] = 1;
      var mine = Array.from(q.targets).sort(function(a,b){ return a-b; }).join(',');
      var theirs = Object.keys(truth).map(Number).sort(function(a,b){ return a-b; }).join(',');
      if (mine !== theirs) mismatch++;
      if (q.targets.size < 2) tooFew++;
      // a target must be empty or hold an enemy — never one of its own men
      for (var sq of q.targets){
        var on = q.st.b[sq];
        if (on && on.c === q.colour) mismatch++;
      }
      if (diff === 1 || diff === 3) sizes[diff].push(menOn(q.st.b));
    }
  }
  ok('every exercise built', checked, 270);
  ok('the named piece really stands on the named square', wrongPiece, 0);
  ok('the answer set is exactly what legalMoves() says', mismatch, 0);
  ok('and it is never a piece with nowhere to go', tooFew, 0);
  var easy = sizes[1].reduce(function(a,b){ return a+b; }, 0) / sizes[1].length;
  var hard = sizes[3].reduce(function(a,b){ return a+b; }, 0) / sizes[3].length;
  ok('the easiest setting is an empty board — two kings and the piece', easy, 3);
  ok('the hardest one is genuinely crowded', hard > 6, true);
})();

(function(){
  var kinds = {};
  for (var t = 0; t < 400; t++){
    var q = prMakeVision(3);
    if (q) kinds[q.type] = (kinds[q.type] || 0) + 1;
  }
  ok('rook, bishop, queen, knight and king all come up',
     ['R','B','Q','N','K'].every(function(k){ return kinds[k] > 0; }), true);
  ok('and pawns do too, in the harder settings', kinds.P > 0, true);
  var easyKinds = {};
  for (var t2 = 0; t2 < 200; t2++){
    var e = prMakeVision(1);
    if (e) easyKinds[e.type] = 1;
  }
  ok('the easiest setting sticks to the four simple shapes',
     Object.keys(easyKinds).sort().join(''), 'BKNR');
})();

/* ============================================================
   4 — piece tracking: the walk replays, move for move
   ============================================================ */
head('Piece Tracking walks are legal and land where they say');

(function(){
  var built = 0, illegal = 0, sanWrong = 0, frameWrong = 0, endWrong = 0, checkGiven = 0;
  var lens = { 1:[], 2:[], 3:[] }, pieces = { 1:[], 3:[] };
  for (var diff = 1; diff <= 3; diff++){
    for (var t = 0; t < 60; t++){
      var q = prMakeTrack(diff);
      if (!q) continue;
      built++;
      lens[diff].push(q.path.length);
      if (diff === 1 || diff === 3) pieces[diff].push(q.ids.length);

      // replay it: every step has to be a move the rules offer in the
      // position it is played in, and has to reproduce the frame after it
      var st = stateOf(q.frames[0], W);
      for (var k = 0; k < q.path.length; k++){
        var all = legalMoves(st, W);
        var move = null;
        for (var j = 0; j < all.length; j++)
          if (all[j].from === q.path[k].from && all[j].to === q.path[k].to) move = all[j];
        if (!move){ illegal++; break; }
        if (toSAN(st, move, all) !== q.path[k].san) sanWrong++;
        st = makeMove(st, move);
        st.turn = W;                                     // one side moves; the other is frozen
        if (inCheck(st, 'b')) checkGiven++;              // a frozen side cannot be left in check
        if (!sameBoard(st.b, q.frames[k + 1])) frameWrong++;
      }
      var landed = -1;
      for (var i = 0; i < 64; i++){ var p = st.b[i]; if (p && p.id === q.askId) landed = i; }
      if (landed !== q.end) endWrong++;
    }
  }
  ok('every walk built', built, 180);
  ok('every move in every walk is legal where it is played', illegal, 0);
  ok('and the notation shown is the notation of that move', sanWrong, 0);
  ok('each frame is the position after its move', frameWrong, 0);
  ok('the frozen side is never left in check', checkGiven, 0);
  ok('the answer really is where the piece ends', endWrong, 0);

  ok('the easiest setting is two moves', lens[1].every(function(n){ return n === 2; }), true);
  ok('the middle one is three or four', lens[2].every(function(n){ return n >= 3 && n <= 4; }), true);
  ok('the hardest is five', lens[3].every(function(n){ return n === 5; }), true);
  ok('one piece to follow at first', pieces[1].every(function(n){ return n === 1; }), true);
  ok('and two at the end', pieces[3].every(function(n){ return n === 2; }), true);
})();

(function(){
  var same = 0, moved = 0;
  for (var t = 0; t < 120; t++){
    var q = prMakeTrack(3);
    if (!q) continue;
    if (q.types[0] === q.types[1]) same++;              // two of a shape makes the question ambiguous
    var did = false;
    for (var k = 0; k < q.path.length; k++) if (q.path[k].id === q.askId) did = true;
    if (did) moved++;
  }
  ok('two tracked pieces are never the same shape', same, 0);
  ok('and the one asked about always moved', moved > 100, true);
})();

/* ============================================================
   5 — position memory: the question is true of the position
   ============================================================ */
head('Position Memory questions match the position');

(function(){
  var bands = { 1:[], 2:[], 3:[] }, wrong = 0, built = 0, kinds = {};
  for (var diff = 1; diff <= 3; diff++){
    for (var t = 0; t < 70; t++){
      var q = prMakeMemory(diff);
      if (!q) continue;
      built++;
      bands[diff].push(menOn(q.st.b));
      kinds[q.ask.t] = (kinds[q.ask.t] || 0) + 1;
      if (!askIsTrue(q.ask, q.st)) wrong++;
    }
  }
  ok('every position built', built, 210);
  ok('every answer is true of the position it was asked about', wrong, 0);
  ok('beginners get four to six men',
     bands[1].every(function(n){ return n >= 4 && n <= 6; }), true);
  ok('the middle setting seven to twelve',
     bands[2].every(function(n){ return n >= 7 && n <= 12; }), true);
  ok('the hardest thirteen to twenty',
     bands[3].every(function(n){ return n >= 13 && n <= 20; }), true);
  ok('all four question types come up',
     ['where','what','count','occupied'].every(function(k){ return kinds[k] > 0; }), true);
  ok('and none of them is a rebuild — that is the sequence drill',
     kinds.rebuild === undefined, true);
})();

/* Re-derive the answer to a question straight from the board. */
function askIsTrue(ask, st){
  var men = [], i, p;
  for (i = 0; i < 64; i++){ p = st.b[i]; if (p) men.push({ p:p, i:i }); }
  if (ask.t === 'where'){
    var here = st.b[ask.sq];
    if (!here || here.c !== ask.colour || here.t !== ask.type) return false;
    // and it has to be the only one of its kind, or the question is ambiguous
    return men.filter(function(m){ return m.p.c === ask.colour && m.p.t === ask.type; }).length === 1;
  }
  if (ask.t === 'what'){
    var on = st.b[ask.sq];
    return on ? (on.c === ask.colour && on.t === ask.type) : (ask.colour === null && ask.type === null);
  }
  if (ask.t === 'count'){
    return men.filter(function(m){ return m.p.c === ask.colour && m.p.t === ask.type; }).length === ask.n;
  }
  if (ask.t === 'occupied') return (!!st.b[ask.sq]) === ask.yes;
  if (ask.t === 'rebuild'){
    return ask.want.every(function(w){
      var on = st.b[w.sq];
      return on && on.c === w.colour && on.t === w.type &&
             men.filter(function(m){ return m.p.c === w.colour && m.p.t === w.type; }).length === 1;
    });
  }
  return false;
}

/* ============================================================
   6 — blindfold sequence: the notation replays to the position asked about
   ============================================================ */
head('Blindfold Sequence lines are real lines');

(function(){
  var built = 0, unreadable = 0, wrongEnd = 0, wrongAnswer = 0, endedOnMate = 0;
  var plies = { 1:[], 2:[], 3:[] }, kinds = {};
  for (var diff = 1; diff <= 3; diff++){
    for (var t = 0; t < 45; t++){
      var q = prMakeSequence(diff);
      if (!q) continue;
      built++;
      plies[diff].push(q.sans.length);
      kinds[q.ask.t] = (kinds[q.ask.t] || 0) + 1;

      // read the moves back with the page's own reader, in the position they
      // were written for — a line that will not parse is a line nobody could play
      var st = cloneState(q.start);
      var broke = false;
      for (var k = 0; k < q.sans.length; k++){
        var res = parseMoveIn(st, q.sans[k]);
        if (res.error){ unreadable++; broke = true; break; }
        st = makeMove(st, res.move);
      }
      if (broke) continue;
      if (fenOf(st) !== fenOf(q.end)) wrongEnd++;
      if (!legalMoves(st, st.turn).length) endedOnMate++;
      if (!askIsTrue(q.ask, q.end)) wrongAnswer++;
    }
  }
  ok('every sequence built', built, 135);
  ok('every move reads back as notation', unreadable, 0);
  ok('and playing them reaches exactly the position asked about', wrongEnd, 0);
  ok('no line ends on mate or stalemate', endedOnMate, 0);
  ok('and every answer is true of the position the line makes', wrongAnswer, 0);
  ok('two plies at the easiest setting', plies[1].every(function(n){ return n === 2; }), true);
  ok('four in the middle', plies[2].every(function(n){ return n === 4; }), true);
  ok('six or eight at the hardest', plies[3].every(function(n){ return n === 6 || n === 8; }), true);
  ok('the hardest setting asks for a rebuild sometimes', kinds.rebuild > 0, true);
})();

(function(){
  var fromStart = 0, fromNowhere = 0;
  for (var t = 0; t < 80; t++){
    var q = prMakeSequence(3);
    if (!q) continue;
    if (q.fromStart) fromStart++; else fromNowhere++;
  }
  ok('the hardest setting opens from the usual position sometimes', fromStart > 5, true);
  ok('and from a position of its own the rest of the time', fromNowhere > 5, true);
  var easy = prMakeSequence(1);
  ok('the easiest one always starts from the usual position', easy.fromStart, true);
})();

/* ============================================================
   7 — the mini challenge is a game, played by the page's own engine
   ============================================================ */
head('Mini Blindfold Challenge');

(function(){
  var built = 0, band = { 1:[], 2:[], 3:[] }, stuck = 0, targets = {};
  for (var diff = 1; diff <= 3; diff++){
    for (var t = 0; t < 25; t++){
      var q = prMakeMini(diff);
      if (!q) continue;
      built++;
      band[diff].push(menOn(q.start.b));
      targets[q.target] = 1;
      if (legalMoves(q.start, W).length < 4) stuck++;
    }
  }
  ok('every challenge built', built, 75);
  ok('White always has moves to make', stuck, 0);
  ok('two men a side at the easiest setting', band[1].every(function(n){ return n === 6; }), true);
  ok('three a side in the middle', band[2].every(function(n){ return n === 8; }), true);
  ok('four a side at the hardest', band[3].every(function(n){ return n === 10; }), true);
  ok('and the three run to different lengths',
     Object.keys(targets).sort().join(','), '4,6,8');
})();

(function(){
  /* Play several out the way the page does: the player's move read back out of
     notation, the reply from the small search already in this file. The player
     here takes whatever move comes first, which is bad chess and sometimes
     walks into mate in two — so the check is that every ply was legal and that
     a short game ended for a reason the rules gave, not that it ran long. */
  var illegal = 0, unread = 0, cutShort = 0, games = 0, total = 0;
  for (var g = 0; g < 6; g++){
    var q = prMakeMini(1 + (g % 3));
    if (!q) continue;
    games++;
    var st = q.start, plies = 0, ended = false;
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
  ok('six challenges were played out', games, 6);
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
  var keys = ['coord','color','vision','track','memory','sequence','mini'];
  var missing = 0, total = 0;
  for (var k = 0; k < keys.length; k++){
    for (var diff = 1; diff <= 3; diff++){
      for (var t = 0; t < 12; t++){
        total++;
        if (!prMake(keys[k], diff)) missing++;
      }
    }
  }
  ok('every drill at every setting produced an exercise', missing, 0);
  ok('and there were plenty of them', total, 252);
})();

/* ============================================================
   9 — the record: accuracy, streaks, sessions, and whose they are
   ============================================================ */
head('What is remembered, and for whom');

(function(){
  storage = {};
  var blank = prLoad();
  ok('a browser that has never practised starts at nothing', blank.asked + blank.correct + blank.sessions, 0);
  ok('and knows about every drill', Object.keys(blank.modes).length, PR_MODES.length);

  PR.mode = PR_MODES[0];
  prRecord(true); prRecord(true); prRecord(false); prRecord(true);
  var st = prLoad();
  ok('four answers were counted', st.asked, 4);
  ok('three of them right', st.correct, 3);
  ok('the streak restarted after the wrong one', st.streak, 1);
  ok('and the best streak is remembered', st.best, 2);
  ok('the drill keeps its own tally', st.modes.coord.asked, 4);
  ok('and the other drills are untouched', st.modes.memory.asked, 0);

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
  storage[PR_STORE + 'guest'] = JSON.stringify({ v: PR_VERSION, asked: 9, correct: 6, modes: { coord: { asked: 9, correct: 6 } } });
  var merged = prLoad();
  ok('an older record keeps what it knew', merged.correct, 6);
  ok('and gains the drills it had never heard of', merged.modes.mini.asked, 0);
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
   10 — the ladder
   ============================================================ */
head('The practice level');

(function(){
  function record(sessions, asked, correct, modes){
    var st = prBlank();
    st.sessions = sessions; st.asked = asked; st.correct = correct;
    for (var k = 0; k < modes; k++) st.modes[PR_MODES[k].key].sessions = 1;
    return st;
  }
  ok('nothing done is Beginner', prLevelIndex(prBlank()), 0);
  ok('three sessions over 55% across two drills is Visualizer',
     prLevelIndex(record(3, 30, 20, 2)), 1);
  ok('sessions alone do not carry you', prLevelIndex(record(9, 30, 12, 3)), 0);
  ok('nor does accuracy on one drill', prLevelIndex(record(9, 30, 30, 1)), 0);
  ok('eight sessions, 62%, three drills is Tracker', prLevelIndex(record(8, 100, 70, 3)), 2);
  ok('fifteen, 70%, four is Blindfold Ready', prLevelIndex(record(15, 100, 72, 4)), 3);
  ok('twenty-four, 76%, five is Advanced', prLevelIndex(record(24, 200, 160, 5)), 4);

  ok('a fresh record is nowhere along the first rung', prLevelProgress(prBlank(), 0), 0);
  var half = record(2, 20, 13, 2);
  var p = prLevelProgress(half, 0);
  ok('part way is between the two', p > 0 && p < 1, true);
  ok('the top of the ladder is full', prLevelProgress(record(40, 400, 380, 7), 4), 1);
})();

(function(){
  storage = {};
  PR.mode = PR_MODES[0];
  var rec = prRecommend(0.4);
  ok('a bad session is told to do the same drill again', rec.key, 'coord');
  // a good session with untried drills points at the next untried one
  var st = prBlank();
  st.modes.coord.sessions = 1;
  prSave(st);
  var next = prRecommend(0.9);
  ok('a good one points somewhere new', next.key, 'color');
  // everything tried: the weakest drill is the one recommended
  st = prBlank();
  for (var k = 0; k < PR_MODES.length; k++){
    st.modes[PR_MODES[k].key].sessions = 1;
    st.modes[PR_MODES[k].key].asked = 10;
    st.modes[PR_MODES[k].key].correct = 9;
  }
  st.modes.track.correct = 4;
  st.sessions = 30; st.asked = 300; st.correct = 250;
  prSave(st);
  ok('with everything tried, the weakest one is next', prRecommend(0.9).key, 'track');
  storage = {};
  account = null;
})();

/* ============================================================
   11 — the mini challenge is locked until it is earned
   ============================================================ */
head('What is open, and when');

(function(){
  var mini = null;
  for (var k = 0; k < PR_MODES.length; k++) if (PR_MODES[k].key === 'mini') mini = PR_MODES[k];
  ok('the mini challenge is the one drill with a gate', mini.needs, 2);
  ok('and the gate is the Tracker rung', PR_LEVELS[mini.needs].name, 'Tracker');
  var open = 0;
  for (var j = 0; j < PR_MODES.length; j++) if (PR_MODES[j].needs === undefined) open++;
  ok('the other six are open from the start', open, 6);
  ok('every drill offers three genuinely different settings',
     PR_MODES.every(function(m){ return m.tiers.length === 3; }), true);
})();

say('\n' + passed + ' passed, ' + failed + ' failed\n');
if (typeof process !== 'undefined' && failed) process.exit(1);
