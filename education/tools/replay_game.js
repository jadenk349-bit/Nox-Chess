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
    .replace(/\b(1-0|0-1|1\/2-1\/2|\*)\s*$/g, ' ')   // result, before number stripping
    .replace(/\b\d+\s*\.(\.\.)?/g, ' ')             // "12." and "12..."
    .replace(/(^|\s)\d+(?=\s)/g, ' ')                // bare "12", as some older sources print
    .split(/\s+/).filter(Boolean)
    // Lowercase castling and the 0-0 form both appear in older game scores.
    .map(t => /^(0-0-0|o-o-o)$/i.test(t) ? 'O-O-O' : /^(0-0|o-o)$/i.test(t) ? 'O-O' : t);
}

function replay(pgn, wanted) {
  const want = new Set((wanted || '').split(',').map(s => s.trim()).filter(Boolean));
  let st = P.stateFromFEN('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  const out = [];
  const list = tokens(pgn);
  for (let i = 0; i < list.length; i++) {
    const san = list[i].replace(/[!?]+$/, '');
    const legal = P.legalMoves(st);
    const norm = t => t.replace(/[!?+#]+$/, '');
    let match = legal.filter(m => norm(P.toSAN(st, m, legal)) === norm(san));
    if (match.length !== 1) {
      // Older sources print captures without the 'x' - "6 cd", "13 Bf5" - which
      // is unambiguous over a board and not valid SAN. Retry ignoring capture
      // markers and check digits. Still requires EXACTLY one legal move to
      // match, so a genuinely ambiguous token is caught rather than guessed.
      const strip = t => norm(t).replace(/x/g, '');
      const loose = legal.filter(m => strip(P.toSAN(st, m, legal)) === strip(san));
      if (loose.length === 1) match = loose;
      // Older scores also write a pawn capture as two file letters - "cd" for
      // cxd5, "ef" for exf4 - giving the origin and destination FILES with the
      // rank left implicit. Match any legal pawn capture between those files.
      if (match.length !== 1 && /^[a-h][a-h]$/.test(norm(san))) {
        const [from, to] = norm(san).split('');
        const pawnCaps = legal.filter(m => {
          const t = P.toSAN(st, m, legal);
          return t.startsWith(from + 'x' + to);
        });
        if (pawnCaps.length === 1) match = pawnCaps;
      }
    }
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
