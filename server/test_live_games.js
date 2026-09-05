/* The home page's live-game cards — what each vision is allowed to show.
 *
 * The server chooses and plays the games (test_league.py); this is the page's
 * half: a snapshot arrives and a card is drawn from it, and the card must not
 * reveal what the vision hides. Sighted shows every man; Board Only shows
 * none; Fog of War shows only the side to move's; Complete Blindfold shows no
 * board at all. The clocks count down from the snapshot for the side to move
 * and stand still for the other.
 *
 * Like the other JS suites, the code under test is read out of
 * blind-chess.html by name rather than copied here, so renaming what it
 * extracts breaks it on purpose.
 *
 *   node server/test_live_games.js
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
  if (!m){ say('FAIL  could not find ' + what + ' in ' + PAGE); throw new Error(what + ' not found'); }
  return m[0];
}
function fn(name){
  return grab(new RegExp('\\nfunction ' + name + '\\s*\\([\\s\\S]*?\\n\\}'), 'function ' + name + '()');
}
function decl(name){
  var block = SRC.match(new RegExp('\\n(?:const|let) ' + name + '\\s*=\\s*[\\{\\[][\\s\\S]*?\\n[\\}\\]];'));
  if (block) return block[0];
  return grab(new RegExp('\\n(?:const|let) ' + name + '\\b[^\\n]*?;'), name);
}

var BUNDLE = [
  decl('FILES'), grab(/\nconst W = 'w', B = 'b';/, 'W and B'), decl('mk'), decl('sqIndex'),
  fn('stateFromFEN'), fn('fmtClock'),
  grab(/\nconst LIVE_NAME = \{[^\n]*\};/, 'LIVE_NAME'),
  fn('liveRemaining'), fn('liveStatusText'), fn('liveEsc'), fn('liveBoardHTML'),
  fn('liveMovesHTML'), fn('liveConsoleHTML'), fn('liveSeatHTML'), fn('liveCardHTML')
];
// idCounter is declared beside mk(); a glyph is a marker here, not the art
var PRE = 'var idCounter = 1; var GLYPH = {}; var BISHOP_SVG = "";' +
          'var pieceHTML = function(t){ return "<i class=\\"glyph-" + t + "\\"></i>"; };' +
          'var LIVE = { at: 0, skew: 0 };';
var page = new Function(PRE + BUNDLE.join('\n') +
  '\nreturn { liveBoardHTML:liveBoardHTML, liveMovesHTML:liveMovesHTML, liveConsoleHTML:liveConsoleHTML,' +
  ' liveSeatHTML:liveSeatHTML, liveCardHTML:liveCardHTML, liveRemaining:liveRemaining,' +
  ' liveStatusText:liveStatusText, liveEsc:liveEsc, LIVE:LIVE };')();

var passed = 0, failed = 0;
function check(label, got, want){
  var ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok){ passed++; say('  PASS  ' + label + '  ->  ' + JSON.stringify(got)); }
  else { failed++; say('  FAIL  ' + label + '\n        got  ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want)); }
}
function count(html, re){ return (html.match(re) || []).length; }

// a middlegame, black to move, with a white knight having just landed on e5
var FEN = 'r1bq1rk1/pp2bppp/2n1pn2/3pN3/2PP4/2N1P3/PP3PPP/R2QKB1R b KQ - 1 8';
var SNAP = {
  id: 'g1', mode: 'sighted', modeName: 'Sighted',
  white: { id: 'w', name: 'Kasper21', rating: 2809 },
  black: { id: 'b', name: 'Velmor', rating: 2742 },
  fen: FEN, moves: '', sans: ['d4', 'd5', 'c4', 'e6', 'Nc3', 'Nf6', 'Nf3', 'Be7', 'e3', 'O-O', 'Bd3', 'Nc6', 'O-O', 'Bd6', 'Ne5'],
  ply: 15, turn: 'b', lastMove: 'f3e5', whiteMs: 1500000, blackMs: 1200000,
  lastMoveAt: 0, startedAt: 0, status: 'live', result: null, winner: null, termination: null, check: false
};

say('\nWhat each vision shows');
var sighted = page.liveBoardHTML(FEN, 'sighted', 'f3e5', false);
check('sighted draws sixty-four squares', count(sighted, /class="lsq/g), 64);
check('...and every man on the board', count(sighted, /class="lpc/g), 30);
check('...white ones as white', count(sighted, /g-w/g), 15);
check('...and lights the last move', count(sighted, /lsq last/g), 2);
check('...with nothing fogged', count(sighted, /lsq hidden/g), 0);

var blind = page.liveBoardHTML(FEN, 'blind', 'f3e5', false);
check('board only draws the squares', count(blind, /class="lsq/g), 64);
check('...and not one man', count(blind, /class="lpc/g), 0);
check('...and does not light the last move either', count(blind, /lsq last/g), 0);

var fog = page.liveBoardHTML(FEN, 'fog', 'f3e5', false);
check('fog of war draws the squares', count(fog, /class="lsq/g), 64);
check('...only the side to move\'s men (black here)', count(fog, /class="lpc/g), 15);
check('...none of them white', count(fog, /g-w/g), 0);
check('...and fogs every other square', count(fog, /lsq hidden/g), 64 - 15);
check('...without lighting the last move', count(fog, /lsq last/g), 0);
var fogW = page.liveBoardHTML(FEN.replace(' b ', ' w '), 'fog', null, false);
check('...and the other side\'s when it is their move', count(fogW, /g-b/g), 0);

var CHECK_FEN = 'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3';
check('a check rings the king that is in it, sighted', count(page.liveBoardHTML(CHECK_FEN, 'sighted', 'd8h4', true), /lsq check/g), 1);
check('...and in fog, where that king is the viewer\'s own', count(page.liveBoardHTML(CHECK_FEN, 'fog', 'd8h4', true), /lsq check/g), 1);
check('...but never on the bare board', count(page.liveBoardHTML(CHECK_FEN, 'blind', 'd8h4', true), /lsq check/g), 0);

say('\nComplete Blindfold');
var console_ = page.liveConsoleHTML(SNAP.sans, false);
check('shows no board', count(console_, /live-board/g), 0);
check('...and the moves, numbered', /8\.<\/span><span class="lm cur-move">Ne5/.test(console_), true);
check('...the last one lit and no other', count(console_, /cur-move/g), 1);
var card = page.liveCardHTML(Object.assign({}, SNAP, { mode: 'total' }), false);
check('the card has the console and no squares', [count(card, /live-console/g) > 0, count(card, /class="lsq/g)], [true, 0]);

say('\nThe moves');
check('nothing yet', page.liveMovesHTML([], 3), '<span class="empty">No moves yet.</span>');
check('the tail is what fits', count(page.liveMovesHTML(SNAP.sans, 3), /class="ln"/g), 3);
check('a lone white move is the current one', count(page.liveMovesHTML(['e4'], 3), /cur-move/g), 1);
check('names and moves are escaped', page.liveEsc('<b>&"'), '&lt;b&gt;&amp;&quot;');

say('\nThe card');
page.LIVE.at = Date.now(); page.LIVE.skew = 0;   // the snapshot is fresh, so no clock is low
card = page.liveCardHTML(SNAP, false);
check('names both players', [/Kasper21/.test(card), /Velmor/.test(card)], [true, true]);
check('...and both ratings', [/2809/.test(card), /2742/.test(card)], [true, true]);
check('says LIVE', /live-pill">Live/.test(card), true);
check('lights the seat to move', /live-seat b turn/.test(card), true);
check('...and only that one', count(card, /live-seat [wb] turn/g), 1);
check('names the mode', /Sighted/.test(card), true);
check('says whose move it is', page.liveStatusText(SNAP), 'Black to move');
check('...and says check', page.liveStatusText(Object.assign({}, SNAP, { check: true })), 'Black to move · Check');
check('a result reads as one', page.liveStatusText(Object.assign({}, SNAP, { status: 'finished', result: '1-0', termination: 'checkmate' })), '1-0 · Checkmate');
check('an empty vision says so', page.liveStatusText({ mode: 'fog', status: 'waiting' }), 'Arranging the next game…');
var over = page.liveCardHTML(Object.assign({}, SNAP, { status: 'finished', result: '1-0', termination: 'resignation' }), false);
check('a finished card wears Final rather than LIVE', [/live-pill">Final/.test(over), /live-pill">Live/.test(over)], [true, false]);
check('...and lights nobody', count(over, /live-seat [wb] turn/g), 0);
check('a spectator card has no buttons', count(page.liveCardHTML(SNAP, true), /<button/g), 0);

say('\nThe clocks');
page.LIVE.at = 100000; page.LIVE.skew = 0;
check('the side to move counts down from the snapshot', page.liveRemaining(SNAP, 'b', 100000 + 5000), 1195000);
check('the other side stands still', page.liveRemaining(SNAP, 'w', 100000 + 5000), 1500000);
check('a finished game stops both', page.liveRemaining(Object.assign({}, SNAP, { status: 'finished' }), 'b', 100000 + 5000), 1200000);
check('never below zero', page.liveRemaining(SNAP, 'b', 100000 + 9999999), 0);
page.LIVE.skew = -3000;                       // our clock runs three seconds ahead of the server's
check('counted on the server\'s clock', page.liveRemaining(SNAP, 'b', 100000 + 5000), 1198000);
check('a low clock is marked', /live-seat b turn low/.test(page.liveCardHTML(Object.assign({}, SNAP, { blackMs: 30000 }), false)), true);

say('\nWiring');
check('the home page opens the watch', /if \(name === 'home'\) liveOpen\(\); else liveLeave\(\);/.test(SRC), true);
check('...on its own socket, not NET\'s', /sock\.send\(JSON\.stringify\(\{ t:'live' \}\)\)/.test(SRC), true);
check('...and closes it on the way out', /t:'unlive'/.test(SRC), true);
check('a result re-reads the ladders', /liveBoardsTimer = setTimeout\(loadBoard/.test(SRC), true);
check('the ladders are four queries of profiles', count(SRC, /(complete_blindfold|board_only|fog_of_war)_rating'/g) >= 3, true);
check('the old fixture is gone', /LB_BOARDS/.test(SRC), false);
check('the four cards stand in the home body', /<div class="live-stack" id="liveStack"/.test(SRC), true);

say('\n' + passed + ' passed, ' + failed + ' failed\n');
if (failed) throw new Error(failed + ' failing');
