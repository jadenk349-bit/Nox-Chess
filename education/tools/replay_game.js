'use strict';
/* Replay a game's moves and emit verified FENs.
 *
 * The depth audit found master_game missing on 128 of 129 board-level concepts,
 * and mining cannot fix it: this repository's puzzle corpus is engine self-play,
 * so a position taken from it is real but is not a master game and must not be
 * labelled as one.
 *
 * Writing FENs from memory is not an option either. Two positions constructed by
 * hand earlier in this project were wrong - one hung a piece, one had unbalanced
 * material - and both looked plausible.
 *
 * So this takes a move list from a source, plays it through the PAGE'S OWN move
 * generator, and emits the FEN at whichever plies are asked for. A move that
 * does not parse is a move list that is wrong, and the tool says so and stops
 * rather than guessing. SAN is matched by generating every legal move and
 * comparing the page's own toSAN output, so there is no second SAN parser here
 * to disagree with the first.
 *
 *     node tools/replay_game.js --moves "1. d4 f5 2. Nf3 ..." --at 34b,30w
 */
const P = require('../../tools/page_chess.js');

function tokens(pgn) {
  return String(pgn)
    .replace(/\{[^}]*\}/g, ' ')          // comments
    .replace(/\([^)]*\)/g, ' ')          // variations
    .replace(/\$\d+/g, ' ')              // NAGs
    .replace(/\b\d+\s*\.(\.\.)?/g, ' ')  // move numbers
    .replace(/\b(1-0|0-1|1\/2-1\/2|\*)\b/g, ' ')
    .split(/\s+/).filter(Boolean);
}

function replay(pgn, wanted) {
  const want = new Set((wanted || '').split(',').map(s => s.trim()).filter(Boolean));
  let st = P.stateFromFEN('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  const out = [];
  const list = tokens(pgn);
  for (let i = 0; i < list.length; i++) {
    const san = list[i].replace(/[!?]+$/, '');
    const legal = P.legalMoves(st);
    const match = legal.filter(m => P.toSAN(st, m, legal).replace(/[!?]+$/, '') === san);
    if (match.length !== 1) {
      const alt = legal.map(m => P.toSAN(st, m, legal));
      throw new Error(`move ${i + 1} (${san}) ${match.length ? 'is ambiguous' : 'is not legal'} ` +
                      `after ${i} plies. Legal here: ${alt.slice(0, 14).join(' ')}...`);
    }
    const mover = st.turn;
    st = P.makeMove(st, match[0]);
    const moveNo = Math.floor(i / 2) + 1;
    const key = `${moveNo}${mover}`;
    if (want.has(key) || want.has(String(moveNo))) {
      out.push({ ply: i + 1, key, after: san, fen: P.fenOf(st) });
    }
  }
  return { plies: list.length, marks: out, final: P.fenOf(st) };
}

module.exports = { replay, tokens };

if (require.main === module) {
  const a = process.argv.slice(2);
  const pgn = a[a.indexOf('--moves') + 1];
  const at = a.includes('--at') ? a[a.indexOf('--at') + 1] : '';
  if (!pgn) { console.error('usage: --moves "<pgn>" [--at 34b,30w]'); process.exit(2); }
  const r = replay(pgn, at);
  console.log(`replayed ${r.plies} plies OK`);
  for (const m of r.marks) console.log(`  after ${m.key} (${m.after})\n    ${m.fen}`);
  console.log(`  final\n    ${r.final}`);
}
