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
  const forward = colour === 'w' ? -1 : 1;   // direction of travel in rows

  const doubled = [], isolated = [], passed = [], backward = [];

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
      if (!blocked) passed.push(nameOf(i));

      // backward: every friendly neighbour pawn is further advanced, AND the
      // square in front is controlled by an enemy pawn. Both halves matter —
      // a pawn merely lagging behind is not backward if it can advance freely.
      let lagging = hasNeighbourBehindOrLevel(me, f, r, forward) === false;
      if (lagging) {
        const ar = r + forward, ac = f;
        if (onBoard(ar, ac)) {
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

  return {
    count: occupied.reduce((n, f) => n + me[f].length, 0),
    doubled, isolated, passed, backward, islands,
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
    if (holes.has(sq)) out.add(sq);
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
    activity: {
      mobility: { w: mobility(st, 'w'), b: mobility(st, 'b') },
      pawnSpace: { w: pawnSpace(st, 'w'), b: pawnSpace(st, 'b') },
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
  bishopPawnColours, quietness,
  nameOf, isLight, page: P,
};
