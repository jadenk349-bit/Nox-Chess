/* Tests for the review's chess reasoning — the win% verdict model, the static
 * exchange evaluation, and the motif detector behind the coach card.
 *
 * Like test_ws_url.js, the code under test is read out of blind-chess.html
 * rather than copied here, so these tests cannot quietly drift from what
 * actually ships. The extraction is by name: renaming or reformatting anything
 * listed in DECLS or FNS below breaks this suite, which is the point — it is
 * the only thing standing between the page and a silent regression in the part
 * of it that has no UI to look at.
 *
 * Runs under any JS engine with a file reader:
 *   node   server/test_review.js
 *   jsc    server/test_review.js
 */

var PAGE = 'blind-chess.html';

function slurp(path){
  if (typeof readFile === 'function') return readFile(path);          // jsc
  return require('fs').readFileSync(path, 'utf8');                    // node
}
function say(s){ (typeof print === 'function' ? print : console.log)(s); }

var SRC = slurp(PAGE);

/* Top-level declarations in the page all start at column zero and close at
   column zero, so a lazy match from the name to the first unindented brace is
   the whole extractor. */
function grab(re, what){
  var m = SRC.match(re);
  if (!m){
    say('FAIL  could not find ' + what + ' in ' + PAGE);
    throw new Error(what + ' not found');
  }
  return m[0];
}
function fn(name){
  return grab(new RegExp('\\nfunction ' + name + '\\s*\\([\\s\\S]*?\\n\\}'), 'function ' + name + '()');
}
function decl(name){
  return grab(new RegExp('\\n(?:const|let) ' + name + '\\b[\\s\\S]*?;'), name);
}

var DECLS = ['VAL','FILES','rowOf','colOf','SQNAME','uciOf','sqName','onBoard','other',
             'idCounter','mk','DIR_N','DIR_B','DIR_R','DIR_K','PIECE_WORD'];
var FNS   = ['startBoard','newState','cloneState','slide','step','addPawn','pseudoMoves',
             'isAttacked','kingSq','inCheck','makeMove','legalMoves','toSAN',
             'attackersOf','defendersOf','see','sliderLines','betweenSq','findMotifs',
             'winPct','sacrificeSize','pvLine','materialFor','materialWord'];

var BUNDLE = [grab(/\nconst W = 'w', B = 'b';/, "const W/B")];
DECLS.forEach(function(n){ BUNDLE.push(decl(n)); });
FNS.forEach(function(n){ BUNDLE.push(fn(n)); });

// `const` inside a sloppy eval stays inside it; `var` does not, and these
// definitions have to be visible to the checks below
eval(BUNDLE.join('\n').replace(/(^|\n)(?:const|let) /g, '$1var '));

var passed = 0, failed = 0;
function check(label, got, want){
  if (got === want){ passed++; say('  PASS  ' + label + '  ->  ' + got); }
  else { failed++; say('  FAIL  ' + label + '\n        got  ' + got + '\n        want ' + want); }
}
function near(label, got, want, tol){
  if (Math.abs(got - want) <= tol){ passed++; say('  PASS  ' + label + '  ->  ' + got.toFixed(4)); }
  else { failed++; say('  FAIL  ' + label + '\n        got  ' + got + '\n        want ' + want + ' +-' + tol); }
}

/* ---- test-only scaffolding: the page has no FEN reader, because the page has
   no use for one — it always plays from the start. ---- */
function fromFEN(fen){
  var parts = fen.trim().split(/\s+/);
  var b = [];
  for (var i=0;i<64;i++) b.push(null);
  var rows = parts[0].split('/');
  for (var r=0;r<8;r++){
    var c = 0;
    for (var k=0;k<rows[r].length;k++){
      var ch = rows[r].charAt(k);
      if (ch >= '1' && ch <= '8'){ c += +ch; continue; }
      b[r*8+c] = mk(ch === ch.toUpperCase() ? 'w' : 'b', ch.toUpperCase());
      c++;
    }
  }
  var rights = parts[2] || '-';
  var ep = -1;
  if (parts[3] && parts[3] !== '-')
    ep = (8 - +parts[3].charAt(1)) * 8 + 'abcdefgh'.indexOf(parts[3].charAt(0));
  return {
    b: b,
    turn: parts[1] === 'b' ? 'b' : 'w',
    cr: { wK: rights.indexOf('K') >= 0 ? 1 : 0, wQ: rights.indexOf('Q') >= 0 ? 1 : 0,
          bK: rights.indexOf('k') >= 0 ? 1 : 0, bQ: rights.indexOf('q') >= 0 ? 1 : 0 },
    ep: ep, half: 0, full: 1
  };
}
function sq(name){ return (8 - +name.charAt(1)) * 8 + 'abcdefgh'.indexOf(name.charAt(0)); }
function moveOf(st, uci){
  var all = legalMoves(st, st.turn);
  for (var i=0;i<all.length;i++) if (uciOf(all[i]) === uci) return all[i];
  throw new Error('no legal move ' + uci + ' in the test position');
}
function tagsFor(fen, uci){
  var st = fromFEN(fen), m = moveOf(st, uci);
  return findMotifs(st, m, makeMove(st, m), st.turn).map(function(x){ return x.tag; });
}

say('\nWin percentage, and what a move throws away\n');

// the curve is symmetric about a level position, and a level position is even money
check('an even position is 50%', winPct(0), 50);
near('+1.00 is 59.10%',  winPct(100),  59.1026, 0.0005);
near('-1.00 is 40.90%',  winPct(-100), 40.8974, 0.0005);
near('+3.00 is 75.11%',  winPct(300),  75.1126, 0.0005);
near('+10.00 is 97.54%', winPct(1000), 97.5447, 0.0005);
near('the curve is symmetric', winPct(250) + winPct(-250), 100, 1e-9);

// loss = winPct(before) - winPct(after), both from the mover's point of view
near('dropping +1.00 to level costs 9.1 points', winPct(100) - winPct(0), 9.1026, 0.0005);
near('level to -1.00 costs the same',            winPct(0) - winPct(-100), 9.1026, 0.0005);
near('+3.00 to level is a 25-point blunder',     winPct(300) - winPct(0), 25.1126, 0.0005);
// the same 100cp costs less where it matters less: that is the whole point of
// the curve over a flat centipawn threshold
check('a pawn hurts less when already winning',
      (winPct(200) - winPct(100)) < (winPct(100) - winPct(0)), true);

say('\nStatic exchange evaluation\n');

// a pawn takes an undefended pawn and keeps it
check('pawn takes a loose pawn',
      see(fromFEN('4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1'), sq('d5'), 'w'), 100);

// the same pawn, guarded: a knight that takes it is a knight down a pawn
check('knight takes a pawn a pawn defends',
      see(fromFEN('4k3/8/2p5/3p4/8/2N5/8/4K3 w - - 0 1'), sq('d5'), 'w'), -220);

// and a queen has even less business there
check('queen takes a pawn a pawn defends',
      see(fromFEN('4k3/8/2p5/3p4/8/8/8/3QK3 w - - 0 1'), sq('d5'), 'w'), -800);

// with the guard gone the same capture is simply a pawn
check('queen takes the same pawn once it is loose',
      see(fromFEN('4k3/8/8/3p4/8/8/8/3QK3 w - - 0 1'), sq('d5'), 'w'), 100);

// two attackers against one defender wins the pawn, so long as the cheap one
// goes first: exd5 cxd5 Nxd5 is a pawn, Nxd5 cxd5 is not
check('two attackers beat one defender',
      see(fromFEN('4k3/8/2p5/3p4/4P3/2N5/8/4K3 w - - 0 1'), sq('d5'), 'w'), 100);

// but two attackers that are both dear enough still lose the exchange: the
// sequence is played out to the end rather than stopped at the first loss
check('a knight and a queen against a guarded pawn still lose',
      see(fromFEN('4k3/8/2p5/3p4/8/2N5/8/3QK3 w - - 0 1'), sq('d5'), 'w'), -120);

// a king cannot be taken, and the exchange on its square is not a thing to ask
check('the king is not material',
      see(fromFEN('4k3/8/8/8/8/8/8/R3K3 w - - 0 1'), sq('e8'), 'w'), 0);

// nothing to take is nothing gained, whichever way it is asked
check('an empty square is worth nothing',
      see(fromFEN('4k3/8/8/8/8/8/8/4K3 w - - 0 1'), sq('d5'), 'w'), 0);
check('you cannot capture your own piece',
      see(fromFEN('4k3/8/8/3P4/8/8/8/4K3 w - - 0 1'), sq('d5'), 'w'), 0);

say('\nMotifs\n');

// Nc7+ hits the king and the rook in the corner at once
var fork = tagsFor('r3k3/8/8/3N4/8/8/8/4K3 w - - 0 1', 'd5c7');
check('a knight check forking the rook is a fork', fork.indexOf('fork') >= 0, true);

// Bg5 pins the knight to the king down the g5-d8 diagonal; the pawn on g7
// guards f6, so the knight is not merely hanging
var pin = tagsFor('3k4/6p1/5n2/8/8/8/8/2B1K3 w - - 0 1', 'c1g5');
check('bishop against knight-and-king is a pin', pin.indexOf('pin') >= 0, true);
check('and the knight is not called hanging',    pin.indexOf('hangingPiece') >= 0, false);

// Rd1 does not check anything, but Rd8 next move is mate and the pawns are why
var back = tagsFor('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1', 'a1d1');
check('a rook lining up behind a wall of pawns is a back-rank threat',
      back.indexOf('backRank') >= 0, true);

// Rxa8 is mate on the back rank, and mate outranks everything else said about it
var mate = tagsFor('r5k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1', 'a1a8');
check('mate is found', mate.indexOf('mate') >= 0, true);
check('and mate is said first', mate[0], 'mate');

// Rh8+ hits the king first and the rook behind it second: that is a skewer,
// and the same geometry the other way round is the pin above
var skewer = tagsFor('r3k3/8/8/8/8/8/8/4K2R w - - 0 1', 'h1h8');
check('king in front, rook behind is a skewer', skewer.indexOf('skewer') >= 0, true);

// the knight checks from c7 and opens the e-file behind it at the same time
var dbl = tagsFor('4k3/8/4N3/8/8/8/8/4RK2 w - - 0 1', 'e6c7');
check('two checks at once are called double check', dbl.indexOf('doubleCheck') >= 0, true);
check('and not a plain discovery',                  dbl.indexOf('discoveredAttack') >= 0, false);

// the bishop steps off the d-file and the rook behind it is looking at the queen
var disc = tagsFor('3qk3/8/8/8/8/3B4/8/3RK3 w - - 0 1', 'd3f5');
check('a slider that was blocked by its own piece is a discovery',
      disc.indexOf('discoveredAttack') >= 0, true);

// a5 takes the last square off a knight that is already in the corner
var trap = tagsFor('n3k3/1P6/1P6/8/P7/8/8/4K3 w - - 0 1', 'a4a5');
check('a piece with no safe square is trapped', trap.indexOf('trappedPiece') >= 0, true);

// the first move of a game is not a tactic
check('a quiet opening move has no motif',
      JSON.stringify(tagsFor('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 'e2e4')),
      '[]');

say('\nThe engine line, read back\n');

// pvLine speaks through the page's own SAN, and says what the line comes to
var st = fromFEN('4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1');
var line = pvLine(st, ['e4d5', 'e8d7']);
check('the line is in notation', line.sans.join(' '), 'exd5 Kd7');
check('and it knows it won a pawn', line.outcome, 'you are a pawn up');
check('one move is not a line', pvLine(st, ['e4d5']), null);
check('and neither is nothing', pvLine(st, null), null);

check('material is named by size', materialWord(500), 'a rook');
check('a piece is a piece', materialWord(320), 'a piece');

say('\n' + passed + ' passed, ' + failed + ' failed\n');

if (typeof process !== 'undefined' && process.exit) process.exit(failed ? 1 : 0);
