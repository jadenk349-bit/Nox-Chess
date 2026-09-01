'use strict';
/* ============================================================================
 * LAYER 3 — POSITION UNDERSTANDING
 *
 * Observable board features, and nothing else. This file may say "the d4 pawn
 * has no friendly pawn on an adjacent file". It may NOT say "d4 is weak" — that
 * is Layer 4's job, and only after the concept records say what licenses the
 * word. The separation is the whole design: see ARCHITECTURE.md.
 *
 * Everything about how chess works is imported from the page via
 * ../../tools/page_chess.js, so there is ONE move generator in this repository
 * and this file cannot drift from it. Renaming anything in that file's DECLS or
 * FNS lists breaks this loudly, which is the trade for not having a second
 * implementation of the rules.
 *
 * Board representation, taken from the page: st.b is a flat 64 array indexed
 * row*8+col with row 0 = rank 8 and col 0 = file a. A piece is {c,t,id} with
 * c in {w,b} and t in {P,N,B,R,Q,K}. White pawns move toward row 0.
 * ========================================================================== */

const P = require('../../tools/page_chess.js');

const FILES = 'abcdefgh';
const idx = (r, c) => r * 8 + c;
const rowOf = i => i >> 3;
const colOf = i => i & 7;
const nameOf = i => FILES[colOf(i)] + (8 - rowOf(i));
const onBoard = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8;
// a1 is dark. With row 0 = rank 8, (row+col) even is a LIGHT square.
const isLight = i => ((rowOf(i) + colOf(i)) % 2) === 0;

const VALUE = { P: 1, N: 3, B: 3, R: 5, Q: 9, K: 0 };

function pieces(st, colour, type) {
  const out = [];
  for (let i = 0; i < 64; i++) {
    const p = st.b[i];
    if (p && p.c === colour && (!type || p.t === type)) out.push(i);
  }
  return out;
}

/* -- material ------------------------------------------------------------- */

function material(st) {
  const side = c => {
    const counts = { P: 0, N: 0, B: 0, R: 0, Q: 0 };
    let points = 0;
    for (const i of pieces(st, c)) {
      const t = st.b[i].t;
      if (t === 'K') continue;
      counts[t]++; points += VALUE[t];
    }
    return { counts, points };
  };
  const w = side('w'), b = side('b');
  return { w, b, balance: w.points - b.points };
}

/* -- pawn structure ------------------------------------------------------- */

function pawnFiles(st, colour) {
  const byFile = Array.from({ length: 8 }, () => []);
  for (const i of pieces(st, colour, 'P')) byFile[colOf(i)].push(i);
  return byFile;
}

function pawnStructure(st, colour) {
  const me = pawnFiles(st, colour);
  const them = pawnFiles(st, colour === 'w' ? 'b' : 'w');
  // A pawn is WEAK when no friendly pawn can defend it AND the opponent can
  // actually attack it — which needs the file to be open on their side. Without
  // that second half the test called every pawn on its home rank undefendable,
  // which is literally true (no friendly pawn can stand on rank 1) and says
  // nothing: the starting position is not eight weaknesses.
  const forward = colour === 'w' ? -1 : 1;   // direction of travel in rows

  const doubled = [], isolated = [], passed = [], backward = [], blockadedPassers = [];
  // A pawn no friendly pawn can EVER defend: nothing on an adjacent file at or
  // behind its rank. This is the general definition of a weak pawn and it catches
  // what isolated/backward miss — c6 in Rubinstein-Salwe 1908, which is defended
  // by no pawn and never can be, while d5 beside it is defended by c6 itself.
  const undefendable = [];

  for (let f = 0; f < 8; f++) {
    if (me[f].length > 1) for (const i of me[f]) doubled.push(nameOf(i));
    const hasNeighbour = (f > 0 && me[f - 1].length) || (f < 7 && me[f + 1].length);
    if (me[f].length && !hasNeighbour) for (const i of me[f]) isolated.push(nameOf(i));
  }

  for (let f = 0; f < 8; f++) {
    for (const i of me[f]) {
      const r = rowOf(i);
      // passed: no enemy pawn ahead on this file or either adjacent file
      let blocked = false;
      for (let df = -1; df <= 1 && !blocked; df++) {
        const g = f + df;
        if (g < 0 || g > 7) continue;
        for (const j of them[g]) {
          const ahead = forward === -1 ? rowOf(j) < r : rowOf(j) > r;
          if (ahead) { blocked = true; break; }
        }
      }
      // can any friendly pawn ever defend this one?
      {
        let canBeDefended = false;
        for (const dc of [-1, 1]) {
          const g = f + dc;
          if (g < 0 || g > 7) continue;
          for (const j of me[g]) {
            const rj = rowOf(j);
            // STRICTLY behind. A pawn on an adjacent file at the SAME rank cannot
            // defend its neighbour — pawns capture diagonally forward — and an
            // earlier version counted it, which made c5 and d5 look mutually
            // defended. Those two pawns are the definition of HANGING pawns, and
            // the bug hid them: tested against Fischer-Spassky 1972 game 6, where
            // the annotation says outright "we've reached a position with hanging
            // pawns" and this base's detector reported nothing weak at all.
            if (forward === -1 ? rj > r : rj < r) canBeDefended = true;
          }
        }
        // ...and the opponent must have no pawn on the file, or a rook can never
        // get at it.
        if (!canBeDefended && them[f].length === 0) undefendable.push(nameOf(i));
      }
      if (!blocked) {
        // Is it blockaded? An enemy PIECE standing directly in front of a passer
        // is what the concept's own record calls the difference between an asset
        // and a liability: "a permanently blockaded passer ties down your pieces
        // rather than theirs".
        const ar = r + forward;
        const front = onBoard(ar, f) ? st.b[idx(ar, f)] : null;
        passed.push(nameOf(i));
        if (front && front.c !== colour) blockadedPassers.push(nameOf(i));
      }

      // backward: every friendly neighbour pawn is further advanced, AND the
      // square in front is controlled by an enemy pawn. Both halves matter —
      // a pawn merely lagging behind is not backward if it can advance freely.
      //
      // Two guards, and both were put here by a position rather than by reading
      // the code. Wade-Korchnoi 1960 (the corpus's pawn-breakthrough entry) has
      // a black pawn on e5 with no d- or f-pawn at all and a white pawn on e4 in
      // front of it, and this reported it as backward:
      //
      //   * A pawn with NO friendly pawn on either adjacent file is ISOLATED,
      //     not backward. `hasNeighbourBehindOrLevel` returns false in that case
      //     as well as in the real one, and the record's definition — "behind all
      //     pawns of the same colour on the adjacent files" — presupposes that
      //     such pawns exist. Reporting both names for one pawn told the reader
      //     about a hole in front of it that the isolated case does not create.
      //   * A pawn whose advance square is OCCUPIED by an enemy pawn is rammed.
      //     It cannot advance, but not for the reason the concept is about, and
      //     the square in front of it is not a hole — an enemy pawn is standing
      //     on it. The record's second consequence ("the square DIRECTLY IN FRONT
      //     of it is a hole ... that is exactly the outpost condition") is simply
      //     false of a rammed pawn.
      let hasNeighbour = false;
      for (const df of [-1, 1]) {
        const g = f + df;
        if (g >= 0 && g <= 7 && me[g].length) hasNeighbour = true;
      }
      let lagging = hasNeighbour && hasNeighbourBehindOrLevel(me, f, r, forward) === false;
      if (lagging) {
        const ar = r + forward, ac = f;
        if (onBoard(ar, ac) && !st.b[idx(ar, ac)]) {
          let contested = false;
          for (const dc of [-1, 1]) {
            const sr = ar - forward, sc = ac + dc;      // where an enemy pawn would stand
            if (!onBoard(sr, sc)) continue;
            const q = st.b[idx(sr, sc)];
            if (q && q.t === 'P' && q.c !== colour) contested = true;
          }
          if (contested) backward.push(nameOf(i));
        }
      }
    }
  }

  const occupied = [];
  for (let f = 0; f < 8; f++) if (me[f].length) occupied.push(f);
  let islands = 0;
  for (let k = 0; k < occupied.length; k++) {
    if (k === 0 || occupied[k] !== occupied[k - 1] + 1) islands++;
  }

  // Where the pawns actually stand, and which of them cannot move. The space
  // record's second trap - "advanced pawns are not automatically a space
  // advantage, they may simply be weak and fixed" - needs both halves of the
  // word "fixed", and neither was observable from this function before.
  const squares = [], blocked = [];
  for (let f = 0; f < 8; f++) {
    for (const i of me[f]) {
      squares.push(nameOf(i));
      const ahead = idx(rowOf(i) + forward, f);
      if (onBoard(rowOf(i) + forward, f) && st.b[ahead]) blocked.push(nameOf(i));
    }
  }

  return {
    count: occupied.reduce((n, f) => n + me[f].length, 0),
    doubled, isolated, passed, backward, blockadedPassers, undefendable, islands,
    squares, blocked,
    files: occupied.map(f => FILES[f]),
  };
}

// True if some friendly pawn on an adjacent file is level with or behind this one.
function hasNeighbourBehindOrLevel(me, f, r, forward) {
  for (const df of [-1, 1]) {
    const g = f + df;
    if (g < 0 || g > 7) continue;
    for (const j of me[g]) {
      const rj = j >> 3;
      if (forward === -1 ? rj >= r : rj <= r) return true;
    }
  }
  return false;
}

/* -- files ---------------------------------------------------------------- */

function fileState(st) {
  const w = pawnFiles(st, 'w'), b = pawnFiles(st, 'b');
  const open = [], semiOpenFor = { w: [], b: [] };
  for (let f = 0; f < 8; f++) {
    if (!w[f].length && !b[f].length) open.push(FILES[f]);
    else if (!w[f].length) semiOpenFor.w.push(FILES[f]);
    else if (!b[f].length) semiOpenFor.b.push(FILES[f]);
  }
  return { open, semiOpenFor };
}

/* -- holes and outposts --------------------------------------------------- */

/* A hole FOR `colour` is a square in the opponent's territory that no enemy pawn
 * can ever attack, because the pawns that could have done so have gone past it.
 * This is the geometric half only. Whether occupying it is good is not decided
 * here, and the outpost concept's own record carries the engine evidence that
 * occupying one is frequently NOT the best move. */
function holesFor(st, colour) {
  const enemy = colour === 'w' ? 'b' : 'w';
  const them = pawnFiles(st, enemy);
  const out = [];
  // Ranks 4-6 for White, 5-3 for Black. Deeper than that is not an outpost zone
  // but the back of the enemy camp, and an earlier version of this function
  // happily reported a7-h7 as holes for White in the starting structure —
  // technically true (a black pawn on b7 attacks a6, not a7) and useless.
  const rows = colour === 'w' ? [2, 3, 4] : [3, 4, 5];
  for (const r of rows) {
    for (let c = 0; c < 8; c++) {
      // A square with a pawn standing on it is not a hole in it.
      const here = st.b[idx(r, c)];
      if (here && here.t === 'P') continue;
      let attackable = false;
      for (const dc of [-1, 1]) {
        const g = c + dc;
        if (g < 0 || g > 7) continue;
        for (const j of them[g]) {
          const rj = rowOf(j);
          // enemy pawn must reach the rank just "behind" the square to attack it
          const need = colour === 'w' ? r - 1 : r + 1;
          const canStillGetThere = colour === 'w' ? rj <= need : rj >= need;
          if (canStillGetThere) { attackable = true; break; }
        }
        if (attackable) break;
      }
      if (!attackable) out.push(nameOf(idx(r, c)));
    }
  }
  return out;
}

/* An outpost, geometrically: a knight or bishop standing on a hole and defended
 * by one of its own pawns. */
function outposts(st, colour) {
  const holes = new Set(holesFor(st, colour));
  const forward = colour === 'w' ? -1 : 1;
  const out = [];
  for (const i of pieces(st, colour)) {
    const p = st.b[i];
    if (p.t !== 'N' && p.t !== 'B') continue;
    if (!holes.has(nameOf(i))) continue;
    let pawnDefended = false;
    for (const dc of [-1, 1]) {
      const r = rowOf(i) - forward, c = colOf(i) + dc;   // where a defending pawn stands
      if (!onBoard(r, c)) continue;
      const q = st.b[idx(r, c)];
      if (q && q.t === 'P' && q.c === colour) pawnDefended = true;
    }
    if (pawnDefended) out.push({ square: nameOf(i), piece: p.t });
  }
  return out;
}

/* How much each non-pawn piece can actually do, so a caller can ask which piece
 * is doing least. The worst-placed-piece concept is about exactly that
 * comparison and had no detector, which the human-grounded corpus exposed on
 * Rubinstein-Salwe 1908 move 20 - an annotated instance the system could not
 * see at all. */
function pieceScopes(st, colour) {
  const probe = P.cloneState(st);
  probe.turn = colour;
  probe.ep = null;
  let moves = [];
  try { moves = P.legalMoves(probe); } catch (e) { return []; }
  const byFrom = new Map();
  for (const m of moves) byFrom.set(m.from, (byFrom.get(m.from) || 0) + 1);
  const out = [];
  for (let i = 0; i < 64; i++) {
    const pc = st.b[i];
    if (!pc || pc.c !== colour || pc.t === 'P' || pc.t === 'K') continue;
    out.push({ square: nameOf(i), type: pc.t, moves: byFrom.get(i) || 0 });
  }
  out.sort((a, b) => a.moves - b.moves);
  return out;
}

/* Squares the enemy's pieces can move to WITHOUT being met by a pawn. This is
 * the right measure for restriction, and the wrong one was tried first: after
 * Fischer's 30.h4 in the 1972 game 6, annotated "restricting the knight on h7
 * even further", the black knight's legal-move count is UNCHANGED. h4 does not
 * take g5 away, it makes g5 unsafe. Counting legal moves misses that entirely;
 * counting safe destinations catches it. */
function safeSquaresFor(st, colour) {
  const enemy = colour === 'w' ? 'b' : 'w';
  const forwardE = enemy === 'w' ? -1 : 1;
  const pawnAttacked = new Set();
  for (const i of pieces(st, enemy, 'P')) {
    for (const dc of [-1, 1]) {
      const r = rowOf(i) + forwardE, c = colOf(i) + dc;
      if (onBoard(r, c)) pawnAttacked.add(idx(r, c));
    }
  }
  const probe = P.cloneState(st);
  probe.turn = colour;
  probe.ep = null;
  let moves = [];
  try { moves = P.legalMoves(probe); } catch (e) { return 0; }
  let n = 0;
  for (const m of moves) {
    const pc = st.b[m.from];
    if (!pc || pc.t === 'P' || pc.t === 'K') continue;
    if (!pawnAttacked.has(m.to)) n++;
  }
  return n;
}

/* Weak pawns, and whether they are SEPARATED. The two-weaknesses record says a
 * single weakness can usually be held and a second one on the far side of the
 * board cannot, so the file distance between them is the concept, not the count. */
function weakPawnSpread(structure) {
  const weak = [...new Set(structure.isolated.concat(structure.backward, structure.doubled,
                                                     structure.undefendable))];
  if (weak.length < 2) return { weak, spread: 0, separated: false };
  const files = weak.map(sq => sq.charCodeAt(0) - 97);
  const spread = Math.max(...files) - Math.min(...files);
  // Threshold calibrated against the canonical example rather than guessed. The
  // first version demanded 3 files apart, on the record's wording "a second on
  // the far side of the board" — and Rubinstein-Salwe 1908, which IS the textbook
  // two-weaknesses game, has its targets on a and c, two files apart and both on
  // the queenside. Rubinstein did not attack on opposite wings; he attacked c6,
  // then made a second target on a6. The real condition is two targets that one
  // defensive unit cannot cover, and adjacent files fail that only because one
  // pawn can guard both.
  return { weak, spread, separated: spread >= 2 };
}

/* Is this a QUIET position? The corpus this base has is 788 tactical puzzles,
 * chosen for having one forcing answer, and a positional concept cannot be
 * isolated in a position that a tactic decides. Quietness is therefore the
 * filter that turns a tactical corpus into a partly usable positional one.
 *
 * The test is deliberately strict: the side to move has no check available and
 * no capture that wins material by static exchange evaluation. A position where
 * every capture loses material and no check exists is one where the next move
 * has to be chosen on positional grounds, which is exactly the case this system
 * most needs to be tested on and least often sees. */
function quietness(st) {
    const moves = P.legalMoves(st);
    let checks = 0, goodCaptures = 0, captures = 0;
    for (const m of moves) {
      const target = st.b[m.to];
      if (target) {
        captures++;
        let v = 0;
        try { v = P.see(st, m); } catch (e) { v = target ? 1 : 0; }
        if (v > 0) goodCaptures++;
      }
      let after;
      try { after = P.makeMove(st, m); } catch (e) { continue; }
      if (P.inCheck(after, after.turn)) checks++;
    }
    return {
      legalMoves: moves.length, checksAvailable: checks,
      capturesAvailable: captures, winningCapturesAvailable: goodCaptures,
      inCheck: P.inCheck(st, st.turn),
      // Quiet: nothing forcing is on offer for the side to move.
      quiet: !P.inCheck(st, st.turn) && checks === 0 && goodCaptures === 0,
    };
}

/* Own pawns standing on the same colour as each bishop. This is the observable
 * half of the good/bad bishop distinction and nothing more: a bishop hemmed in
 * by its own pawns is the SHAPE of a bad bishop, and whether it is actually bad
 * depends on whether those pawns can move and on what the bishop is doing
 * instead — which is Layer 4's problem and, mostly, a human's. */
function bishopPawnColours(st, colour) {
  const own = pieces(st, colour, 'P');
  const lights = own.filter(isLight).length;
  const darks = own.length - lights;
  // How far the bishop can actually see. The concept's own record insists that
  // "bad" is structural and "passive" is functional and that the two are not the
  // same thing - Suba's active bad bishop is a structurally bad bishop outside
  // its own chain doing real work. Scope is what separates them, so it is
  // measured rather than assumed from the pawn count.
  const scopeOf = i => {
    let n = 0;
    for (const [dr, dc] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
      let r = rowOf(i) + dr, c = colOf(i) + dc;
      while (onBoard(r, c)) {
        const q = st.b[idx(r, c)];
        if (q) { if (q.c !== colour) n++; break; }
        n++; r += dr; c += dc;
      }
    }
    return n;
  };
  return pieces(st, colour, 'B').map(i => {
    const light = isLight(i);
    const sameColour = light ? lights : darks;
    // Blocked: a pawn of ours directly in front of the bishop's own diagonal
    // exits is the sharper test, but "how many of our pawns share its colour"
    // is what the literature actually uses.
    return {
      square: nameOf(i),
      colour: light ? 'light' : 'dark',
      ownPawnsOnItsColour: sameColour,
      ownPawnsTotal: own.length,
      share: own.length ? sameColour / own.length : 0,
      scope: scopeOf(i),
    };
  });
}

/* Holes a minor piece could occupy next move. A hole nobody can use is a fact
 * about the pawns; a hole a knight reaches in one is a plan. */
function reachableHoles(st, colour) {
  const holes = new Set(holesFor(st, colour));
  if (!holes.size) return [];
  const probe = P.cloneState(st);
  probe.turn = colour;
  probe.ep = null;
  let moves;
  try { moves = P.legalMoves(probe); } catch (e) { return []; }
  const out = new Set();
  for (const m of moves) {
    const piece = probe.b[m.from];
    if (!piece || (piece.t !== 'N' && piece.t !== 'B')) continue;
    const sq = nameOf(m.to);
    if (!holes.has(sq)) continue;
    // ...and can STAY there. The weak-square record's second false-positive
    // trap is a fianchetto: "a fianchetto leaves permanent weak squares on the
    // long diagonal that the bishop covers perfectly well. The square is weak;
    // the position is not." h6 and f6 in a Dragon are holes by every structural
    // test - no black pawn can ever attack either - and a white piece put on
    // one is taken by the bishop on g7.
    //
    // So the piece must survive arriving. Losing material there disqualifies
    // the square outright. An EVEN trade disqualifies it too, but only when no
    // pawn of ours attacks it - and that exception is the whole difference
    // between the trap and the classic case. A knight to d5 met by ...Nxd5 exd5
    // is an even trade and is the point of the whole opening: the pawn recapture
    // keeps the square. Bxh6 met by Qxh6 is an even trade that leaves the square
    // to nobody. Pawn support is also what this record's own `indicators_for`
    // names - "an enemy piece can reach the square and be SUPPORTED there".
    //
    // The attacker count is tested separately because see() answers 0 both for
    // an even trade and for a square nothing attacks at all, and reading those
    // two as the same thing would throw away exactly the safe squares this is
    // looking for.
    const enemy = colour === 'w' ? 'b' : 'w';
    const nx = P.makeMove(probe, m);
    const fwd = colour === 'w' ? -1 : 1;          // a pawn of ours standing behind it
    const heldByPawn = [-1, 1].some(dc => {
      const r = rowOf(m.to) - fwd, c = colOf(m.to) + dc;
      if (!onBoard(r, c)) return false;
      const q = nx.b[idx(r, c)];
      return !!q && q.t === 'P' && q.c === colour;
    });
    if (P.attackersOf(nx, m.to, enemy).length) {
      const s = P.see(nx, m.to, enemy);
      if (s > 0) continue;
      if (s === 0 && !heldByPawn) continue;
    }
    out.add(sq);
  }
  return [...out];
}

/* -- pieces --------------------------------------------------------------- */

function pieceFeatures(st) {
  const f = fileState(st);
  const openSet = new Set(f.open);
  const side = colour => {
    const bishops = pieces(st, colour, 'B');
    const rooks = pieces(st, colour, 'R');
    const semi = new Set(f.semiOpenFor[colour]);
    const seventh = colour === 'w' ? 1 : 6;      // rank 7 for White, rank 2 for Black
    return {
      bishopPair: bishops.length >= 2 && bishops.some(isLight) && bishops.some(i => !isLight(i)),
      bishopSquares: bishops.map(i => ({ square: nameOf(i), colour: isLight(i) ? 'light' : 'dark' })),
      bishops: bishopPawnColours(st, colour),
      rooksOnOpenFiles: rooks.filter(i => openSet.has(FILES[colOf(i)])).map(nameOf),
      rooksOnSemiOpenFiles: rooks.filter(i => semi.has(FILES[colOf(i)])).map(nameOf),
      rooksOnSeventh: rooks.filter(i => rowOf(i) === seventh).map(nameOf),
    };
  };
  const w = side('w'), b = side('b');
  const wB = pieces(st, 'w', 'B'), bB = pieces(st, 'b', 'B');
  const oppositeColouredBishops =
    wB.length === 1 && bB.length === 1 && isLight(wB[0]) !== isLight(bB[0]);
  return { w, b, oppositeColouredBishops };
}

/* -- king ----------------------------------------------------------------- */

function kingFeatures(st, colour) {
  const k = pieces(st, colour, 'K')[0];
  if (k === undefined) return null;
  const r = rowOf(k), c = colOf(k);
  const homeRow = colour === 'w' ? 7 : 0;
  const forward = colour === 'w' ? -1 : 1;

  // pawn shield: friendly pawns on the three files in front of the king
  let shield = 0;
  const shieldSquares = [];
  for (let dc = -1; dc <= 1; dc++) {
    const cc = c + dc;
    if (cc < 0 || cc > 7) continue;
    for (let step = 1; step <= 2; step++) {
      const rr = r + forward * step;
      if (!onBoard(rr, cc)) break;
      const q = st.b[idx(rr, cc)];
      if (q && q.t === 'P' && q.c === colour) { shield++; shieldSquares.push(nameOf(idx(rr, cc))); break; }
    }
  }

  // luft: an escape square off the back rank that is empty
  let luft = false;
  if (r === homeRow) {
    for (let dc = -1; dc <= 1; dc++) {
      const rr = r + forward, cc = c + dc;
      if (!onBoard(rr, cc)) continue;
      if (!st.b[idx(rr, cc)]) { luft = true; break; }
    }
  } else luft = true;

  const enemy = colour === 'w' ? 'b' : 'w';
  const heavy = pieces(st, enemy, 'R').length + pieces(st, enemy, 'Q').length;

  return {
    square: nameOf(k),
    onHomeRank: r === homeRow,
    // null in every case where it does not apply, rather than false on one
    // branch and null on another, which read as two different answers.
    castledSide: r === homeRow ? (c >= 6 ? 'king' : c <= 2 ? 'queen' : null) : null,
    pawnShield: shield, pawnShieldSquares: shieldSquares,
    luft,
    // Observable precondition only. Whether a back-rank mate EXISTS is
    // findMotifs()'s call, not this file's.
    backRankExposure: r === homeRow && !luft && heavy > 0,
    inCheck: P.inCheck(st, colour),
  };
}

/* -- activity and phase --------------------------------------------------- */

function mobility(st, colour) {
  if (st.turn === colour) return P.legalMoves(st).length;
  const flipped = P.cloneState(st);
  flipped.turn = colour;
  flipped.ep = null;     // an en-passant right belongs to the other side's move
  try { return P.legalMoves(flipped).length; } catch (e) { return null; }
}

/* ACTIVE moves, as opposed to legal ones.
 *
 * The piece-activity record's first false-positive trap says it in one line:
 * "Counting available squares is not measuring activity. A piece with many
 * moves that bear on nothing is not active." The matcher counted legal moves,
 * which is the thing the trap forbids, and fired on 44.4% of the 788 shipped
 * positions. A move counts here only if it does something: it captures, it
 * crosses into the opponent's half, or it attacks an enemy man from where it
 * lands. King moves are excluded - a king shuffling is not activity.
 *
 * Measured on the same 788 positions, an eight-move gap in ACTIVE moves fires
 * on 33.9%. The threshold is unchanged; what changed is what is counted. */
function activeMoves(st, colour) {
  const probe = P.cloneState(st);
  probe.turn = colour;
  probe.ep = null;
  let ms;
  try { ms = P.legalMoves(probe); } catch (e) { return null; }
  let n = 0;
  for (const m of ms) {
    const pc = probe.b[m.from];
    if (!pc || pc.t === 'K') continue;
    if (m.cap) { n++; continue; }
    const row = m.to >> 3;
    if (colour === 'w' ? row <= 3 : row >= 4) { n++; continue; }
    const nx = P.makeMove(probe, m);
    for (let i = 0; i < 64; i++) {
      const q = nx.b[i];
      if (!q || q.c === colour) continue;
      if (P.attackersOf(nx, i, colour).indexOf(m.to) >= 0) { n++; break; }
    }
  }
  return n;
}

/* Space: squares in the opponent's half attacked by our pawns. Deliberately the
 * narrow pawn-only definition, because it is the one that is observable without
 * judgement; piece "space" is a different and vaguer claim. */
function pawnSpace(st, colour) {
  const forward = colour === 'w' ? -1 : 1;
  const half = colour === 'w' ? [0, 1, 2, 3] : [4, 5, 6, 7];
  const set = new Set();
  for (const i of pieces(st, colour, 'P')) {
    for (const dc of [-1, 1]) {
      const r = rowOf(i) + forward, c = colOf(i) + dc;
      if (onBoard(r, c) && half.includes(r)) set.add(nameOf(idx(r, c)));
    }
  }
  return set.size;
}

/* Entry squares: where a space advantage is actually spent.
 *
 * The space record's first false-positive trap is "counting controlled squares
 * is mechanical and over-reports. Space with no entry point wins nothing", and
 * its indicators_for says "an entry square exists or can be created". This is
 * that test. A square counts when it is in the opponent's half, no pawn of
 * theirs can ever attack it, one of our pieces can move there next move, and
 * the piece is not lost for going.
 *
 * It is deliberately wider than reachableHoles(): that answers a question about
 * OUTPOSTS - a minor piece on one of three ranks - and the classic way to cash
 * in a space advantage is a rook arriving on the seventh down a file nobody can
 * contest, which is an entry square and is not an outpost.
 */
function entrySquares(st, colour) {
  const enemy = colour === 'w' ? 'b' : 'w';
  const them = pawnFiles(st, enemy);
  const probe = P.cloneState(st);
  probe.turn = colour;
  probe.ep = null;
  let moves;
  try { moves = P.legalMoves(probe); } catch (e) { return []; }
  const out = new Set();
  for (const m of moves) {
    const pc = probe.b[m.from];
    if (!pc || pc.t === 'P' || pc.t === 'K') continue;
    const r = rowOf(m.to), c = colOf(m.to);
    const inTheirHalf = colour === 'w' ? r <= 3 : r >= 4;
    if (!inTheirHalf) continue;
    if (out.has(nameOf(m.to))) continue;
    let attackable = false;
    for (const dc of [-1, 1]) {
      const g = c + dc;
      if (g < 0 || g > 7) continue;
      for (const j of them[g]) {
        const need = colour === 'w' ? r - 1 : r + 1;
        if (colour === 'w' ? rowOf(j) <= need : rowOf(j) >= need) { attackable = true; break; }
      }
      if (attackable) break;
    }
    if (attackable) continue;
    const nx = P.makeMove(probe, m);
    if (P.attackersOf(nx, m.to, enemy).length && P.see(nx, m.to, enemy) >= 0) continue;
    out.add(nameOf(m.to));
  }
  return [...out];
}

/* Phase, by material rather than move number — the same reasoning as
 * bucketFor() in tools/puzzle_rules.js, which was changed away from move counts
 * because a queenless rook ending reached on move nine is not an opening. */
function phaseOf(st) {
  const m = material(st);
  const heavy = m.w.counts.Q + m.b.counts.Q;
  const minors = m.w.counts.N + m.w.counts.B + m.b.counts.N + m.b.counts.B;
  const rooks = m.w.counts.R + m.b.counts.R;
  const nonPawn = m.w.points - m.w.counts.P + m.b.points - m.b.counts.P;
  if (nonPawn <= 16 && heavy === 0) return 'endgame';
  if (nonPawn <= 10) return 'endgame';
  const developed = ['w', 'b'].every(c => {
    const back = c === 'w' ? 7 : 0;
    let home = 0;
    for (const i of pieces(st, c)) {
      const p = st.b[i];
      if ((p.t === 'N' || p.t === 'B') && rowOf(i) === back) home++;
    }
    return home <= 2;
  });
  const pawnCount = m.w.counts.P + m.b.counts.P;
  if (!developed && pawnCount >= 14) return 'opening';
  return 'middlegame';
}

/* -- the whole picture ---------------------------------------------------- */

/* -- the centre, the king's zone, and the breakthrough ---------------------
 *
 * Three detectors written against three concept records that each named a
 * detector that did not exist. They are here rather than in Layer 4 because
 * they are observations: how many attackers bear on a square, how many pieces
 * bear on a king's zone, whether a pawn sacrifice forces through a passer the
 * enemy king cannot catch. What any of that is WORTH is the matcher's problem
 * and, mostly, nobody's.
 * ---------------------------------------------------------------------- */

const CENTRE = ['d4', 'e4', 'd5', 'e5'];
const BIG_CENTRE = ['c3', 'd3', 'e3', 'f3', 'c4', 'd4', 'e4', 'f4',
                    'c5', 'd5', 'e5', 'f5', 'c6', 'd6', 'e6', 'f6'];
const sqIndex = name => (8 - Number(name[1])) * 8 + (name.charCodeAt(0) - 97);

/* Central control, counted as ATTACKERS and not as pawns standing on squares.
 *
 * The concept record's first false-positive trap is the entire reason this is
 * written this way: "Counting pawns on central squares measures occupation, not
 * control. A fianchettoed bishop controls e4 without standing anywhere near
 * it." So control is attackersOf() — the page's own function, so there is one
 * implementation of what attacks what — and occupation is reported as a
 * separate number that a caller may not confuse with it.
 *
 * The record's third trap ("central pieces are only strong while they cannot be
 * kicked; a piece on a central square a pawn can attack is visiting") is why
 * each occupier is marked with whether an enemy PAWN can attack its square in
 * one move. */
function centralSquareControl(st) {
  const out = { squares: {}, control: { w: 0, b: 0 }, minorControl: { w: 0, b: 0 },
                occupied: { w: [], b: [] },
                visiting: { w: [], b: [] }, pawnsOn: { w: 0, b: 0 } };
  const minorOnly = (list) => list.filter(a => {
    const q = st.b[a];
    return q && (q.t === 'P' || q.t === 'N' || q.t === 'B');
  }).length;
  for (const name of CENTRE) {
    const i = sqIndex(name);
    const wa = P.attackersOf(st, i, 'w'), ba = P.attackersOf(st, i, 'b');
    const w = wa.length, b = ba.length;
    out.squares[name] = { w, b, wMinor: minorOnly(wa), bMinor: minorOnly(ba) };
    out.control.w += w;
    out.control.b += b;
    // Control by PAWNS AND MINOR PIECES, kept separately, and it is not a
    // refinement for its own sake. Reti-Capablanca 1924 is the position that
    // forced it: after 18...Ne6 - the move Keene names as the one 'fighting
    // more directly for control of the centre', and the move Stockfish puts
    // 0.39 clear of anything else - Black's RAW attacker count on the four
    // central squares FALLS from 7 to 6, because the knight arriving on e6
    // blocks a rook that was x-raying through its own bishop on e4. Counting a
    // rook's line through its own man as control makes the best move in the
    // game look like a retreat. Counted by pawns and minors, the same move
    // reads +1, and 18...N6d7 - the move actually played, which no source and
    // no engine likes - reads -1.
    out.minorControl.w += minorOnly(wa);
    out.minorControl.b += minorOnly(ba);
    const p = st.b[i];
    if (p) {
      out.occupied[p.c].push(name);
      if (p.t === 'P') out.pawnsOn[p.c]++;
      // can an enemy pawn attack this square within one pawn move?
      const enemy = p.c === 'w' ? 'b' : 'w';
      if (pawnCanHit(st, i, enemy)) out.visiting[p.c].push(name);
    }
  }
  // How many of the four each side attacks MORE than the other. This is the
  // number the matcher uses, because a side that out-attacks the opponent on
  // three of the four central squares has said something; a side that piles six
  // attackers onto one square has not.
  out.squaresLed = { w: 0, b: 0 };
  for (const name of CENTRE) {
    const s = out.squares[name];
    if (s.w > s.b) out.squaresLed.w++;
    else if (s.b > s.w) out.squaresLed.b++;
  }
  return out;
}

/* Can a pawn of `colour` attack square `i` after one legal pawn move? Used only
 * to mark a central occupier as "visiting". Deliberately geometric — it asks
 * where a pawn would have to stand and whether one can get there in one move —
 * because the alternative is generating every legal move for a question about
 * two squares. */
function pawnCanHit(st, i, colour) {
  const r = rowOf(i), c = colOf(i);
  const forward = colour === 'w' ? -1 : 1;
  for (const dc of [-1, 1]) {
    const sr = r - forward, sc = c + dc;          // where the pawn must stand
    if (!onBoard(sr, sc)) continue;
    const here = st.b[idx(sr, sc)];
    if (here && here.t === 'P' && here.c === colour) return true;   // already there
    if (here) continue;                            // square blocked, no pawn can arrive
    for (const step of [1, 2]) {
      const fr = sr - forward * step;
      if (!onBoard(fr, sc)) break;
      const q = st.b[idx(fr, sc)];
      if (!q) continue;
      if (q.t === 'P' && q.c === colour) {
        if (step === 1) return true;
        // a double step is only legal from the pawn's own second rank, and only
        // if the square it jumps over is empty
        const home = colour === 'w' ? 6 : 1;
        if (fr === home && !st.b[idx(sr - forward, sc)]) return true;
      }
      break;                                       // first piece on the file settles it
    }
  }
  return false;
}

/* The king's zone, and how many pieces bear on it.
 *
 * The concept record names this detector and points at Stockfish's scheme as a
 * usable specification, so the zone is the king's square and its neighbours,
 * plus the three squares two ranks ahead when the king is on its own back rank
 * — which is what makes a castled king's zone cover the squares an attack
 * actually arrives through.
 *
 * The record also says, in as many words, that this number must not be read
 * linearly and that "it is not worth reporting an attack below three
 * attackers". That threshold is applied in Layer 4, not here: this function
 * reports what is on the board. */
function kingZoneAttackers(st, colour) {
  const k = pieces(st, colour, 'K')[0];
  if (k === undefined) return null;
  const enemy = colour === 'w' ? 'b' : 'w';
  const r = rowOf(k), c = colOf(k);
  const forward = colour === 'w' ? -1 : 1;
  const homeRow = colour === 'w' ? 7 : 0;
  const zone = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const rr = r + dr, cc = c + dc;
      if (onBoard(rr, cc)) zone.push(idx(rr, cc));
    }
  }
  if (r === homeRow) {
    for (let dc = -1; dc <= 1; dc++) {
      const rr = r + forward * 2, cc = c + dc;
      if (onBoard(rr, cc)) zone.push(idx(rr, cc));
    }
  }
  // DISTINCT pieces, not attacks. A rook that sees four zone squares is one
  // attacker; counting squares turns one rook into an assault.
  const att = new Set(), def = new Set();
  for (const sq of zone) {
    for (const a of P.attackersOf(st, sq, enemy)) {
      const p = st.b[a];
      if (p && p.t !== 'P' && p.t !== 'K') att.add(a);
    }
    for (const a of P.attackersOf(st, sq, colour)) {
      const p = st.b[a];
      if (p && p.t !== 'K') def.add(a);
    }
  }
  // Files and diagonals arriving at the king matter more than a raw count, and
  // an open file in front of a castled king is the classic one.
  const kf = fileState(st);
  const fileName = 'abcdefgh'[c];
  const enemyPawnsOnFile = pieces(st, enemy, 'P')
    .filter(i => colOf(i) === c).length;
  const ownPawnsOnFile = pieces(st, colour, 'P')
    .filter(i => colOf(i) === c).length;
  return {
    square: nameOf(k),
    zone: zone.map(nameOf),
    attackers: att.size,
    attackerSquares: [...att].map(nameOf),
    defenders: def.size,
    enemyHasQueen: pieces(st, enemy, 'Q').length > 0,
    fileOpenOnKing: ownPawnsOnFile === 0 && enemyPawnsOnFile === 0,
    fileSemiOpenOnKing: ownPawnsOnFile === 0 && enemyPawnsOnFile > 0,
    kingFile: fileName,
    openFiles: kf.open,
  };
}

/* The pawn breakthrough, and the one place it can be PROVED.
 *
 * The concept record's canonical pattern is three pawns against three, and its
 * false-positive trap is the honest one: "a pawn sacrifice that creates a passer
 * is not a breakthrough unless the passer actually cannot be stopped. The rule
 * of the square decides this and is cheap to check."
 *
 * The rule of the square is a proof only when nothing but kings and pawns is
 * left, so that is the scope, stated rather than hidden: this returns null the
 * moment a piece is on the board. In a middlegame the same pattern may be a
 * breakthrough and this base cannot show that it is, so it says nothing, which
 * is the same bargain every other detector here makes.
 *
 * Inside that scope it is a small forced search: our pawn moves only, every
 * legal reply for the defender, at most five plies, and success is a passed pawn
 * whose promotion square the defending king cannot reach in time and which
 * arrives before any enemy passer. At least one pawn must be given up, or it is
 * not a breakthrough — just a pawn being pushed. */
function pawnBreakthrough(st, colour) {
  for (let i = 0; i < 64; i++) {
    const p = st.b[i];
    if (p && p.t !== 'K' && p.t !== 'P') return null;
  }
  const mine = () => pieces(st, colour, 'P').length;
  if (mine() < 2) return null;
  const startCount = mine();
  const countP = s => pieces(s, colour, 'P').length;

  let moves;
  try { moves = P.legalMoves(st); } catch (e) { return null; }
  for (const m of moves) {
    const pc = st.b[m.from];
    if (!pc || pc.t !== 'P' || m.cap) continue;         // an ADVANCE, not a capture
    const after = P.makeMove(st, m);
    // The offer has to be an offer: an enemy pawn must be able to take it.
    const takers = capturesOf(after, m.to);
    if (!takers.length) continue;
    const line = accepted(after, 4, [P.uciOf(m)]);
    if (line) {
      return {
        first: P.uciOf(m), line, plies: line.length,
        offers: takers.length,
        note: 'every pawn capture of the offer loses the race; a declined offer is a different question and is not claimed here',
      };
    }
  }
  return null;

  /* Enemy pawn captures of the pawn now standing on `sq`. Two of them is the
   * lever geometry the concept record calls for - "a pawn advance creates two
   * levers simultaneously" - but one is enough for the sacrifice to be an
   * offer, and the record's canonical pattern is proved by the race, not by the
   * count. */
  function capturesOf(s, sq) {
    let ms;
    try { ms = P.legalMoves(s); } catch (e) { return []; }
    return ms.filter(x => x.to === sq && s.b[x.from] && s.b[x.from].t === 'P');
  }

  /* The defender has taken, or is about to. Only CAPTURES of our pawns are
   * searched on their side, and that limit is the honest boundary of the claim:
   * this proves that accepting loses, not that declining does. A defender who
   * declines is answering a different question and the matcher says so. */
  function accepted(s, plies, line) {
    if (plies <= 0) return null;
    if (s.turn === colour) {
      // our turn: any pawn move, and success is an uncatchable passer once a
      // pawn has actually been given up
      let ms;
      try { ms = P.legalMoves(s); } catch (e) { return null; }
      for (const x of ms) {
        const pc2 = s.b[x.from];
        if (!pc2 || pc2.t !== 'P') continue;
        const nx = P.makeMove(s, x);
        const l = line.concat(P.uciOf(x));
        if (countP(nx) < startCount && winsTheRace(nx, colour)) return l;
        const deeper = accepted(nx, plies - 1, l);
        if (deeper) return deeper;
      }
      return null;
    }
    // their turn: every capture of one of our pawns must lose
    let ms;
    try { ms = P.legalMoves(s); } catch (e) { return null; }
    const caps = ms.filter(x => {
      const from = s.b[x.from], to = s.b[x.to];
      return from && from.t === 'P' && to && to.c === colour;
    });
    if (!caps.length) return null;                 // nothing was accepted here
    let best = null;
    for (const x of caps) {
      const nx = P.makeMove(s, x);
      if (countP(nx) < startCount && winsTheRace(nx, colour)) { best = best || line; continue; }
      const deeper = accepted(nx, plies - 1, line.concat(P.uciOf(x)));
      if (!deeper) return null;                    // one accepted capture holds
      best = deeper;
    }
    return best;
  }
}

/* Rule of the square, applied to both sides. Returns true only when `colour`
 * has a passer the defending king provably cannot catch AND no enemy pawn
 * promotes at least as fast. Conservative on purpose: an unclear race is not a
 * breakthrough as far as this base is concerned. */
function winsTheRace(st, colour) {
  const enemy = colour === 'w' ? 'b' : 'w';
  const mine = pawnStructure(st, colour), theirs = pawnStructure(st, enemy);
  if (!mine.passed.length) return false;
  const ek = pieces(st, enemy, 'K')[0], ok = pieces(st, colour, 'K')[0];
  if (ek === undefined || ok === undefined) return false;
  const dist = (a, b) => Math.max(Math.abs(rowOf(a) - rowOf(b)), Math.abs(colOf(a) - colOf(b)));

  const promoRow = colour === 'w' ? 0 : 7;
  let ours = Infinity;
  for (const name of mine.passed) {
    const i = sqIndex(name);
    let steps = Math.abs(rowOf(i) - promoRow);
    // the pawn's path must be clear of every man, ours included
    let clear = true;
    const step = colour === 'w' ? -1 : 1;
    for (let rr = rowOf(i) + step; rr !== promoRow + step; rr += step) {
      if (st.b[idx(rr, colOf(i))]) { clear = false; break; }
    }
    if (!clear) continue;
    const queenSq = idx(promoRow, colOf(i));
    // the defender is a tempo down if it is our move
    const theirTempo = st.turn === enemy ? 0 : 1;
    if (dist(ek, queenSq) - theirTempo <= steps) continue;    // catchable
    ours = Math.min(ours, steps);
  }
  if (ours === Infinity) return false;

  const theirPromoRow = enemy === 'w' ? 0 : 7;
  for (const name of theirs.passed) {
    const i = sqIndex(name);
    const steps = Math.abs(rowOf(i) - theirPromoRow);
    const queenSq = idx(theirPromoRow, colOf(i));
    const ourTempo = st.turn === colour ? 0 : 1;
    if (dist(ok, queenSq) - ourTempo <= steps) continue;      // we catch it
    if (steps <= ours) return false;                          // they are not slower
  }
  return true;
}

function features(fen) {
  const st = P.stateFromFEN(fen);
  const other = st.turn === 'w' ? 'b' : 'w';
  return {
    fen,
    sideToMove: st.turn,
    phase: phaseOf(st),
    material: material(st),
    pawns: { w: pawnStructure(st, 'w'), b: pawnStructure(st, 'b') },
    files: fileState(st),
    holes: { w: holesFor(st, 'w'), b: holesFor(st, 'b') },
    reachableHoles: { w: reachableHoles(st, 'w'), b: reachableHoles(st, 'b') },
    outposts: { w: outposts(st, 'w'), b: outposts(st, 'b') },
    pieces: pieceFeatures(st),
    king: { w: kingFeatures(st, 'w'), b: kingFeatures(st, 'b') },
    quietness: quietness(st),
    scopes: { w: pieceScopes(st, 'w'), b: pieceScopes(st, 'b') },
    safeSquares: { w: safeSquaresFor(st, 'w'), b: safeSquaresFor(st, 'b') },
    weakSpread: { w: weakPawnSpread(pawnStructure(st, 'w')),
                  b: weakPawnSpread(pawnStructure(st, 'b')) },
    centre: centralSquareControl(st),
    kingZone: { w: kingZoneAttackers(st, 'w'), b: kingZoneAttackers(st, 'b') },
    breakthrough: { w: pawnBreakthrough(st, 'w'), b: pawnBreakthrough(st, 'b') },
    activity: {
      mobility: { w: mobility(st, 'w'), b: mobility(st, 'b') },
      active: { w: activeMoves(st, 'w'), b: activeMoves(st, 'b') },
      pawnSpace: { w: pawnSpace(st, 'w'), b: pawnSpace(st, 'b') },
      entry: { w: entrySquares(st, 'w'), b: entrySquares(st, 'b') },
    },
  };
}

/* Tactical features of a MOVE, delegated entirely to the page's own detector.
 * This system does not re-implement motif detection and does not second-guess
 * it: findMotifs() already applies the guards this project would have had to
 * derive, and having two detectors would mean having two answers. */
function motifsOfMove(fen, uci) {
  const before = P.stateFromFEN(fen);
  const all = P.legalMoves(before);
  const mv = all.find(m => P.uciOf(m) === uci);
  if (!mv) return { legal: false, motifs: [], san: null };
  const after = P.makeMove(before, mv);
  return {
    legal: true,
    // toSAN needs the full legal-move list to disambiguate (Nbd2 vs Nfd2).
    san: P.toSAN(before, mv, all),
    // What actually moved, read off the board rather than parsed back out of
    // the SAN. A matcher that wants "was this a pawn move" should not have to
    // re-derive it from a string that spells a pawn move by leaving the letter out.
    movedType: (before.b[mv.from] || {}).t || null,
    movedFrom: nameOf(mv.from), movedTo: nameOf(mv.to),
    // the move itself, so a matcher that needs to replay it does not have to
    // reconstruct it from the SAN it was just given
    uci,
    // Kept in the page's own {tag, text} shape; matchers read .tag. Normalising
    // to bare strings here would throw away the detector's own sentence, which
    // is worth having for comparison even though this system words its own.
    motifs: P.findMotifs(before, mv, after, before.turn) || [],
    fenAfter: P.fenOf(after),
  };
}

/* Motifs across a whole LINE, not just its first move.
 *
 * Measured on the shipped corpus: checking only the first move agrees with the
 * puzzle generator's independent tagging on 77% of positions; checking the whole
 * solution agrees on 96.5%. The gap was never a detection failure - it was a
 * scope mismatch, since a combination's fork often arrives on move three. A
 * caller explaining a combination needs the whole line. */
function motifsOfLine(fen, uciMoves) {
  const out = { legal: true, plies: [], motifs: [], sanLine: [] };
  let st;
  try { st = P.stateFromFEN(fen); } catch (e) { return { legal: false, plies: [], motifs: [], sanLine: [] }; }
  const seen = new Set();
  for (let i = 0; i < (uciMoves || []).length; i++) {
    const all = P.legalMoves(st);
    const mv = all.find(m => P.uciOf(m) === uciMoves[i]);
    if (!mv) { out.legal = false; out.illegalAt = i; break; }
    const san = P.toSAN(st, mv, all);
    const after = P.makeMove(st, mv);
    const motifs = P.findMotifs(st, mv, after, st.turn) || [];
    out.sanLine.push(san);
    out.plies.push({ ply: i + 1, uci: uciMoves[i], san, byWhom: st.turn, motifs });
    for (const m of motifs) {
      const key = m && m.tag;
      if (key && !seen.has(key)) {
        seen.add(key);
        out.motifs.push({ ...m, ply: i + 1, san });
      }
    }
    st = after;
  }
  out.fenAfter = P.fenOf(st);
  return out;
}

module.exports = {
  features, motifsOfMove, motifsOfLine, phaseOf, material, pawnStructure, fileState,
  holesFor, reachableHoles, outposts, pieceFeatures, kingFeatures, mobility, pawnSpace,
  bishopPawnColours, quietness, pieceScopes, weakPawnSpread, safeSquaresFor, activeMoves,
  entrySquares,
  centralSquareControl, kingZoneAttackers, pawnBreakthrough, winsTheRace,
  nameOf, isLight, page: P,
};
