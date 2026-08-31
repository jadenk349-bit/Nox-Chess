/* The page's own chess, on the command line.
 *
 * blind-chess.html is the whole client, and everything it knows about chess —
 * move generation, static exchange evaluation, the motif detector behind the
 * Study Board coach, the bot ladder — lives inside its one <script>. The
 * puzzle generator needs all of it, and a second implementation in Node would
 * be a second opinion: a puzzle tagged "fork" by the tool and a coach card
 * that never says "forks" would both look right in isolation.
 *
 * So nothing is copied. The named declarations below are cut out of the page
 * and evaluated here, and the tool imports them like any other module. The
 * cost of that bargain is stated plainly: renaming or reformatting any name
 * in DECLS or FNS breaks this file, on purpose and loudly.
 *
 * server/test_review.js does the same trick with its own small extractor,
 * because it has to run under jsc as well, where require() does not exist.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const PAGE = path.join(__dirname, '..', 'blind-chess.html');
const SRC = fs.readFileSync(PAGE, 'utf8');

function grab(re, what){
  const m = SRC.match(re);
  if (!m) throw new Error('page_chess: could not find ' + what + ' in blind-chess.html');
  return m[0];
}
// top-level declarations start at column zero and close at column zero, so a
// lazy match to the first unindented brace is the whole extractor
const fn = name =>
  grab(new RegExp('\\n(?:async )?function ' + name + '\\s*\\([\\s\\S]*?\\n\\}'), 'function ' + name + '()');
// A declaration that opens a brace or a bracket closes at column zero; only a
// one-liner ends at its first semicolon — and a comment inside one of these
// declarations may carry a semicolon of its own.
const decl = name => {
  const block = SRC.match(new RegExp('\\n(?:const|let) ' + name + '\\s*=\\s*[\\{\\[][\\s\\S]*?\\n[\\}\\]];'));
  return block ? block[0] : grab(new RegExp('\\n(?:const|let) ' + name + '\\b[^\\n]*?;'), name);
};

const DECLS = [
  'VAL', 'FILES', 'rowOf', 'colOf', 'SQNAME', 'uciOf', 'sqName', 'onBoard', 'other',
  'idCounter', 'mk', 'DIR_N', 'DIR_B', 'DIR_R', 'DIR_K', 'PIECE_WORD', 'VERDICT',
  'LEVELS', 'levelFor', 'PST'
];
const FNS = [
  // the board itself
  'startBoard', 'newState', 'cloneState', 'posKey', 'fenOf', 'stateFromFEN',
  'slide', 'step', 'addPawn', 'pseudoMoves', 'isAttacked', 'kingSq', 'inCheck',
  'makeMove', 'legalMoves', 'toSAN', 'mirror', 'evaluate',
  // the teaching engine the Study Board review is built on
  'attackersOf', 'defendersOf', 'see', 'sliderLines', 'betweenSq', 'findMotifs',
  'winPct', 'sacrificeSize', 'sfScore', 'judgeMove', 'describeBest',
  'pvLine', 'materialFor', 'materialWord',
  // what the engine says, and what a rung does with it
  'readInfoLine', 'botShortcut', 'botChoice'
];

const NAMES = DECLS.concat(FNS);
const bundle = [grab(/\nconst W = 'w', B = 'b';/, "const W/B")]
  .concat(DECLS.map(decl), FNS.map(fn))
  .join('\n')
  // `const` inside the function body below would be fine, but `var` keeps the
  // extracted page code identical in behaviour to the page's own top level
  .replace(/(^|\n)(?:const|let) /g, '$1var ');

// eslint-disable-next-line no-new-func
module.exports = new Function(bundle + '\nreturn {W:W, B:B, ' + NAMES.join(', ') + '};')();
module.exports.PAGE = PAGE;
