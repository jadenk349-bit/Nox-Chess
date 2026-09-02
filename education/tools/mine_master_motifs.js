'use strict';
/* Hunt named motifs in real master games, so a record's master-game rung can be
 * filled with a position somebody actually played.
 *
 * Eighteen concepts still say NO MASTER-GAME POSITION, and the reason each of
 * them gives is the same one: this base's own scan can only nominate what its
 * API reports, so a concept with no detector - `clearance`, `interference`,
 * `x-ray` - has nothing to nominate. That is a limit of the SCAN, not of the
 * games. The geometry of each of these motifs is decidable whether or not Layer
 * 4 reports it, and a PGN is a list of positions.
 *
 * Every game is replayed through the page's own move generator, exactly as
 * `tools/replay_game.js` does and for the same reason: a move list that does not
 * parse is a move list that is wrong, and this stops rather than guessing. A
 * game that fails to replay is counted and skipped, never patched.
 *
 * What comes out is CANDIDATES. Every one still has to be read and put to the
 * engine before it goes on a record - the corpus already contains one position
 * where the mechanical reading and the annotator's reading disagree, and the
 * annotator was right.
 *
 *     node tools/mine_master_motifs.js --pgn <dir-or-file> [--motif smotheredMate]
 *                                      [--limit 400] [--json out.json]
 */
const fs = require('fs');
const path = require('path');
const P = require('../../tools/page_chess.js');

const argv = process.argv.slice(2);
const arg = (n, d) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d);
const src = arg('--pgn', null);
const only = arg('--motif', null);
const limit = Number(arg('--limit', 400));
const jsonOut = arg('--json', null);
if (!src) { console.error('usage: --pgn <dir|file> [--motif id] [--limit N] [--json out]'); process.exit(2); }

const FILES = 'abcdefgh';
const nameOf = i => FILES[i & 7] + (8 - (i >> 3));
const rowOf = i => i >> 3, colOf = i => i & 7;
const other = c => (c === 'w' ? 'b' : 'w');

function canTravel(t, a, b) {
  const rank = rowOf(a) === rowOf(b), file = colOf(a) === colOf(b);
  const diag = Math.abs(rowOf(a) - rowOf(b)) === Math.abs(colOf(a) - colOf(b));
  if (t === 'R') return rank || file;
  if (t === 'B') return diag;
  if (t === 'Q') return rank || file || diag;
  return false;
}
function between(a, b) {
  const out = [];
  const dr = Math.sign(rowOf(b) - rowOf(a)), dc = Math.sign(colOf(b) - colOf(a));
  let r = rowOf(a) + dr, c = colOf(a) + dc;
  while (r !== rowOf(b) || c !== colOf(b)) {
    if (r < 0 || r > 7 || c < 0 || c > 7) return null;
    out.push(r * 8 + c); r += dr; c += dc;
  }
  return out;
}

/* The motif tests. Each answers a question about ONE move in ONE position, and
 * each is the geometry the concept record describes rather than a paraphrase of
 * it. `after` is the position the move reaches; `them` is the side to reply. */
const TESTS = {
  // "The enemy king's flight squares are all occupied by its own pieces, and a
  // knight gives the check." Reported only on an actual mate, exactly as the
  // matcher in lib/matchers.js does.
  smotheredMate(st, mv, after) {
    if ((st.b[mv.from] || {}).t !== 'N') return null;
    const them = after.turn;
    if (!P.inCheck(after, them) || P.legalMoves(after).length) return null;
    const k = P.kingSq(after, them);
    let flight = 0, own = 0;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      const r = (k >> 3) + dr, c = (k & 7) + dc;
      if (r < 0 || r > 7 || c < 0 || c > 7) continue;
      flight++;
      const q = after.b[r * 8 + c];
      if (q && q.c === them) own++;
    }
    return flight && own === flight ? { note: 'every flight square blocked by its own men' } : null;
  },

  // Bxh7+ / Bxh2+ against a castled king with the knight ready to follow. The
  // record's pattern, not a guess: bishop takes the h-pawn, it is check, and
  // the bishop can be captured - a sacrifice rather than a blunder.
  greekGift(st, mv, after) {
    const pc = st.b[mv.from];
    if (!pc || pc.t !== 'B' || !mv.cap || mv.cap.t !== 'P') return null;
    const to = nameOf(mv.to);
    if (pc.c === 'w' ? to !== 'h7' : to !== 'h2') return null;
    if (!P.inCheck(after, after.turn)) return null;
    if (P.see(after, mv.to, after.turn) <= 0) return null;   // it must really be a sacrifice
    return { note: 'bishop takes on ' + to + ' with check and can be captured' };
  },

  // A knight attacking two men it outranks or that nobody guards. The page's
  // own fork test, restricted to knights.
  knightFork(st, mv, after) {
    const pc = st.b[mv.from];
    if (!pc || pc.t !== 'N') return null;
    const them = after.turn;
    const hit = [];
    for (let i = 0; i < 64; i++) {
      const q = after.b[i];
      if (!q || q.c !== them) continue;
      if (!P.attackersOf(after, i, pc.c).includes(mv.to)) continue;
      if ((P.VAL[q.t] || 0) > P.VAL.N || !P.defendersOf(after, i, them).length) hit.push(nameOf(i));
    }
    if (hit.length < 2) return null;
    if (P.see(after, mv.to, them) > 0) return null;          // a forking piece that just falls
    return { note: 'knight on ' + nameOf(mv.to) + ' hits ' + hit.join(' and ') };
  },

  // AN X-RAY DEFENCE: one of our line pieces DEFENDS one of our own men through
  // an enemy man standing between them. That is the form of the motif that is
  // neither a pin nor a skewer, and the first version of this test got it
  // exactly backwards - it looked for an enemy man behind an enemy man, worth
  // less than the one in front, and that IS a skewer. (A pin is small in front
  // and big behind; a skewer is big in front and small behind. The test
  // excluded the pin and then went looking for the skewer.) It reported
  // Kramnik-Yakovich 17.Bb5 as an x-ray, where the bishop hits the queen on d7
  // with the rook on e8 behind it, which is a skewer and has its own record and
  // its own detector in the page.
  //
  // The defensive form has no such confusion: the piece at the far end is OURS,
  // so no exchange on the near square wins it - our line piece is still looking
  // through when the enemy man moves or is taken.
  xRay(st, mv, after) {
    const pc = after.b[mv.to];
    if (!pc || !'RBQ'.includes(pc.t)) return null;
    const us = pc.c, them = after.turn;
    for (let i = 0; i < 64; i++) {
      const back = after.b[i];
      if (!back || back.c !== us || i === mv.to || back.t === 'K') continue;
      if (!canTravel(pc.t, mv.to, i)) continue;
      const btw = between(mv.to, i);
      if (!btw || btw.length === 0) continue;
      const men = btw.filter(x => after.b[x]);
      if (men.length !== 1) continue;
      const mid = after.b[men[0]];
      if (mid.c !== them) continue;                          // through one of THEIRS
      if ((P.VAL[back.t] || 0) < P.VAL.N) continue;          // defending a pawn is not news
      // ...and the defence must MATTER: the man behind is attacked, and this is
      // what is holding it up.
      if (!P.attackersOf(after, i, them).length) continue;
      return { note: pc.t + ' on ' + nameOf(mv.to) + ' defends ' + nameOf(i) +
                     ' through the enemy ' + mid.t + ' on ' + nameOf(men[0]) };
    }
    return null;
  },

  // A DESPERADO: a piece of ours that is already DOOMED takes something on the
  // way out.
  //
  // EVERYTHING RESTS ON THE FIRST WORD, and the record says so in those words:
  // "a piece that can be saved by moving, or by a counter-threat, is not doomed,
  // and the desperado is then simply a blunder". The first version of this test
  // asked only whether the piece could be captured at a profit where it stood,
  // which is "attacked", not "doomed" - and it nominated Moldobaev-Kramnik
  // 19...Qxd1, where the queen is attacked and has two safe squares. Taking the
  // queen happens to be best there by a pawn, and writing it up as a desperado
  // would have taught the definition wrong on the strength of a good move.
  //
  // So doomed is tested the way `trapped-piece` is: every square it can reach
  // loses it. The capture it makes on the way out is then the whole of what it
  // gets, which is the concept.
  desperado(st, mv, after) {
    const pc = st.b[mv.from];
    if (!pc || !mv.cap || pc.t === 'P' || pc.t === 'K') return null;
    if (P.see(st, mv.from, other(pc.c)) <= 0) return null;   // not even attacked
    if (P.see(after, mv.to, after.turn) <= 0) return null;   // and it dies where it lands
    // ...and there was nowhere to go. Every legal move of that piece, including
    // other captures, must leave it winnable.
    let ms;
    try { ms = P.legalMoves(st); } catch (e) { return null; }
    const escapes = ms.filter(x => x.from === mv.from).filter(x => {
      let nx;
      try { nx = P.makeMove(st, x); } catch (e) { return false; }
      return P.see(nx, x.to, other(pc.c)) <= 0;
    });
    if (escapes.length) return null;
    return { note: pc.t + ' on ' + nameOf(mv.from) + ' had no square that saves it and took ' +
                   mv.cap.t + ' on ' + nameOf(mv.to) };
  },

  // INTERFERENCE: our piece lands, uncaptured and en prise, strictly between an
  // enemy line piece and a man it was defending, and the man becomes winnable.
  interference(st, mv, after) {
    if (mv.cap) return null;
    const us = st.turn, them = other(us);
    if (P.see(after, mv.to, them) <= 0) return null;
    for (let x = 0; x < 64; x++) {
      const q = st.b[x];
      if (!q || q.c !== them || !'RBQ'.includes(q.t)) continue;
      for (let s = 0; s < 64; s++) {
        const t2 = st.b[s];
        if (!t2 || t2.c !== them || s === x || t2.t === 'K') continue;
        if (!canTravel(q.t, x, s)) continue;
        const btw = between(x, s);
        if (!btw || !btw.length || btw.some(i => st.b[i]) || !btw.includes(mv.to)) continue;
        const b0 = P.cloneState(st), a0 = P.cloneState(after);
        b0.turn = us; b0.ep = -1; a0.turn = us; a0.ep = -1;
        if (P.see(a0, s, us) > 0 && P.see(b0, s, us) <= 0) {
          return { note: nameOf(mv.to) + ' cuts the ' + q.t + ' on ' + nameOf(x) +
                         ' off from ' + nameOf(s) };
        }
      }
    }
    return null;
  },

  // CLEARANCE, in the record's own words: "the moving piece going somewhere
  // pointless or losing itself - the value is entirely in the vacated square".
  // So it must be lost where it lands, it must not be a check (that is a
  // discovery and has its own record), and the line it opens must be worth
  // opening.
  clearance(st, mv, after) {
    if (mv.cap) return null;
    const us = st.turn, them = other(us);
    if (P.see(after, mv.to, them) <= 0) return null;
    if (P.inCheck(after, them)) return null;
    for (let x = 0; x < 64; x++) {
      const q = after.b[x];
      if (!q || q.c !== us || !'RBQ'.includes(q.t) || x === mv.to) continue;
      for (let s = 0; s < 64; s++) {
        const t2 = after.b[s];
        if (!t2 || t2.c !== them) continue;
        if (!canTravel(q.t, x, s)) continue;
        const btw = between(x, s);
        if (!btw || btw.some(i => after.b[i]) || !btw.includes(mv.from)) continue;
        const before0 = between(x, s);
        if (!before0.some(i => st.b[i])) continue;           // the line was already open
        const a0 = P.cloneState(after); a0.turn = us; a0.ep = -1;
        if (t2.t !== 'K' && P.see(a0, s, us) <= 0) continue;
        return { note: 'vacating ' + nameOf(mv.from) + ' opens the ' + q.t + ' on ' +
                       nameOf(x) + ' onto ' + nameOf(s) };
      }
    }
    return null;
  },
};

function games(text) {
  const out = [];
  let tags = {}, moves = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const t = line.match(/^\[(\w+)\s+"(.*)"\]$/);
    if (t) {
      if (moves.length) { out.push({ tags, moves: moves.join(' ') }); tags = {}; moves = []; }
      tags[t[1]] = t[2];
    } else if (line) moves.push(line);
  }
  if (moves.length) out.push({ tags, moves: moves.join(' ') });
  return out;
}

function sanMoves(pgn) {
  return String(pgn)
    .replace(/\{[^}]*\}/g, ' ').replace(/\([^)]*\)/g, ' ').replace(/\$\d+/g, ' ')
    .replace(/\b(1-0|0-1|1\/2-1\/2|\*)/g, ' ')
    .replace(/\b\d+\s*\.(\.\.)?/g, ' ')
    .split(/\s+/).filter(Boolean);
}

const files = fs.statSync(src).isDirectory()
  ? fs.readdirSync(src).filter(f => f.endsWith('.pgn')).map(f => path.join(src, f))
  : [src];

const found = {};
// A PER-FILE CAP, and the first version did not have one. It filled each
// motif's quota from whichever file came first alphabetically, so every
// candidate for every motif came out of Alekhine.pgn and the other twenty-one
// collections might as well not have been there. A sample that is really one
// player's games is not a sample of master play.
const perFile = Math.max(1, Math.ceil(limit / files.length));
let nGames = 0, nBad = 0, nPly = 0;
for (const file of files) {
  const fileCount = {};
  const text = fs.readFileSync(file, 'utf8');
  for (const g of games(text)) {
    const sans = sanMoves(g.moves);
    if (sans.length < 10) continue;
    let st;
    try { st = P.stateFromFEN('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'); }
    catch (e) { break; }
    let ok = true;
    const positions = [];
    for (const san of sans) {
      let ms;
      try { ms = P.legalMoves(st); } catch (e) { ok = false; break; }
      const mv = ms.find(m => P.toSAN(st, m, ms) === san);
      if (!mv) { ok = false; break; }
      positions.push({ fen: P.fenOf(st), st, mv, san });
      st = P.makeMove(st, mv);
    }
    if (!ok) { nBad++; continue; }
    nGames++;
    for (const p of positions) {
      nPly++;
      const after = P.makeMove(p.st, p.mv);
      for (const [id, test] of Object.entries(TESTS)) {
        if (only && id !== only) continue;
        if ((found[id] || []).length >= limit) continue;
        if ((fileCount[id] || 0) >= perFile) continue;
        let r = null;
        try { r = test(p.st, p.mv, after); } catch (e) { r = null; }
        if (!r) continue;
        fileCount[id] = (fileCount[id] || 0) + 1;
        (found[id] = found[id] || []).push({
          motif: id, fen: p.fen, san: p.san, uci: P.uciOf(p.mv), note: r.note,
          game: `${g.tags.White || '?'}-${g.tags.Black || '?'}, ${g.tags.Event || '?'} ${(g.tags.Date || '').slice(0, 4)}`,
          file: path.basename(file),
        });
      }
    }
  }
}
console.log(`\n${nGames} games replayed (${nBad} rejected as unplayable), ${nPly} positions\n`);
for (const [id, list] of Object.entries(found)) {
  console.log(`  ${id.padEnd(16)} ${String(list.length).padStart(4)}`);
}
if (jsonOut) { fs.writeFileSync(jsonOut, JSON.stringify(found, null, 1)); console.log(`\nwrote ${jsonOut}`); }
else for (const [id, list] of Object.entries(found)) {
  console.log(`\n== ${id}`);
  for (const x of list.slice(0, 5)) console.log('  ', JSON.stringify(x));
}
