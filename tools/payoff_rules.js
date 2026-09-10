/* The payoff a normal puzzle has to reach.
 *
 * Until now a solution ran until its point had *happened* — paidOff() in
 * puzzle_rules.js, which is satisfied by a minor piece safely in hand. That
 * was already an improvement on stopping at the end of the doubt, and it is
 * not enough for the standard this file implements: a puzzle on the Puzzle
 * page must force **promotion, significant material, or checkmate**, and the
 * solution has to run far enough that the player sees it arrive.
 *
 * Three things about the shape of this rule are worth stating before the code,
 * because each of them is a decision that could reasonably have gone the other
 * way.
 *
 * **The payoff must be inside the solution, not in the follow-up.** The
 * follow-up exists so a player who has found the move is shown what it was
 * worth, and it is best play from both sides — but it is shown only if they
 * press a button, and a puzzle whose whole point lives behind a button is a
 * puzzle that ends with "trust us". "Continue the solution until the promotion
 * actually happens" is the instruction, and this file reads it literally: the
 * final position of `moves` is what is examined.
 *
 * **Forcedness is inherited, not re-derived.** Every defence in a verified
 * line has already been checked as the engine's own best try
 * (checkReplyPly()), and a line that survives that is by construction a line
 * the opponent cannot improve on. So a payoff standing on the last position of
 * a verified solution is forced against best defence, and this file does not
 * search to prove it again. What it must not do is accept a payoff on an
 * *unverified* line, which is why payoffOf() is called after the audit and the
 * verdict rather than beside them.
 *
 * **A capture is not a payoff because material moved.** Queen and rook are
 * taken as significant on their face. Knight, bishop and pawn are not, and the
 * test they have to pass instead is about the *game* rather than the exchange:
 * did this decide it. The examples that motivate the exception — the last
 * defender, a critical passed pawn, a minor piece that turns equality into a
 * won game — all share that shape, and the examples that motivate the refusal
 * — an ordinary loose pawn, a minor piece in a position that stays level, a
 * plain trade — all fail it. So the branch asks the position, not the piece.
 */

'use strict';

const P = require('./page_chess.js');
const R = require('./puzzle_rules.js');
const WP = require('./win_prob.js');

/* ------------------------------------------------------------ thresholds */

/* A queen or a rook is significant material and needs no argument. This list
   is the whole of "normally qualifies", and it is a list rather than a value
   because the rule is about which piece it was, not about centipawns: winning
   a rook for a bishop is a rook won. */
const MAJOR = ['Q', 'R'];

/* What a knight, bishop or pawn has to have done instead. Both must hold.
 *
 * A decided game at the end of the solution — the same bar the punish gate
 * uses for the position as a whole, deliberately, because "creates a clearly
 * winning position" and "is a punishment worth showing" are the same claim
 * about the same number and should not be two thresholds.
 *
 * And a real swing across the puzzle, in the percentage points the practice
 * rules are written in, so that a position which was *already* winning before
 * the opponent erred cannot lend its evaluation to a pawn grab. 25 points is
 * about +200cp from level: comfortably less than the +35 a Middle Game
 * Practice must produce, because a puzzle has also had to clear judge() to get
 * here and this is the extra thing asked of a minor-piece payoff, not the
 * whole standard. */
const MINOR_SWING_MIN = 25;

/* ------------------------------------------------------------- machinery */

/** Replay a line; the position it reaches, or null if it does not play. */
function walk(fen, moves){
  let st = P.stateFromFEN(fen);
  for (const u of moves || []){
    const m = R.uciFind(st, u);
    if (!m) return null;
    st = P.makeMove(st, m);
  }
  return st;
}

/** Which of the opponent's piece types are fewer at the end than at the start. */
function gone(startSt, endSt, them){
  const census = st => {
    const c = {};
    for (const p of st.b) if (p && p.c === them) c[p.t] = (c[p.t] || 0) + 1;
    return c;
  };
  const a = census(startSt), b = census(endSt);
  const out = [];
  for (const t of Object.keys(a)) if ((b[t] || 0) < a[t]) out.push(t);
  return out;
}

/* ------------------------------------------------------------- the rule */

/**
 * payoffOf(rec) -> { ok:true, kind, detail } | { ok:false, why }
 *
 * `rec` is the puzzle with its **final, verified** line: fen, moves, kind
 * ('punish' | 'save'), and eval {before, best, end}. Nothing here searches.
 *
 *   kind 'mate'       the opponent is mated at the end of the solution
 *   kind 'promotion'  the solver promoted a pawn inside the solution
 *   kind 'material'   significant material is off the board and in hand
 */
function payoffOf(rec){
  const st0 = P.stateFromFEN(rec.fen);
  const solver = st0.turn, them = P.other(solver);
  const end = walk(rec.fen, rec.moves);
  if (!end) return { ok: false, why: 'payoff: line does not play' };

  /* --- C. checkmate. Asked first: a mated opponent is the payoff whatever
         else the line did, and a line that ends in mate needs no material
         argument. Stalemate is not a payoff for the solver — it is a draw,
         and for a save puzzle the rescue is the position's own verdict, which
         judge() has already passed on. */
  const over = !P.legalMoves(end, end.turn).length;
  if (over && P.inCheck(end, end.turn)){
    if (end.turn === them) return { ok: true, kind: 'mate', detail: { mated: true } };
    return { ok: false, why: 'payoff: the solver is the one mated' };
  }

  /* --- A. promotion. Read off the solver's own moves rather than off the
         final board, because a promoted queen that is then traded is still a
         promotion that happened, and the player watched it happen. */
  let st = st0;
  for (let i = 0; i < rec.moves.length; i++){
    const m = R.uciFind(st, rec.moves[i]);
    if (!m) break;
    if (st.turn === solver && m.promo)
      return { ok: true, kind: 'promotion', detail: { ply: i, to: P.sqName(m.to), piece: m.promo } };
    st = P.makeMove(st, m);
  }

  /* --- B. significant material.
   *
   * `banked` is the rules' own accounting: material gained, net of anything of
   * ours the opponent can still take. A queen won by a line that leaves a rook
   * hanging has not won a queen, and using the same function the line-building
   * rule uses is what keeps the card and the gate from disagreeing. */
  const banked = R.banked(rec.fen, end, solver);
  const lost = gone(st0, end, them);
  const major = lost.filter(t => MAJOR.indexOf(t) >= 0);

  if (major.length){
    /* A major piece is off the board. It still has to be *in hand*: the same
       "won at once and gave it back" case the card audit catches. */
    if (banked < P.VAL.N)
      return { ok: false, why: 'payoff: ' + major.join('/') + ' taken but not held (' +
                              Math.round(banked) + 'cp banked)' };
    return { ok: true, kind: 'material', detail: { pieces: major, banked: Math.round(banked) } };
  }

  const minor = lost.filter(t => t === 'N' || t === 'B' || t === 'P');
  if (!minor.length)
    return { ok: false, why: 'payoff: no promotion, no mate, nothing captured' };

  /* Knight, bishop or pawn only — so the position has to carry it. */
  const e = rec.eval || {};
  const endScore = e.end === undefined ? null : e.end;
  const before = e.before === undefined ? null : e.before;
  if (endScore === null)
    return { ok: false, why: 'payoff: minor material and no end score to judge it by' };

  const swing = before === null ? null : WP.swing(before, endScore);
  if (swing === null)
    return { ok: false, why: 'payoff: minor material and no priced mistake to measure the swing' };

  /* Did it decide the game — asked before the swing is asked.
   *
   * Both questions are fair and a minor payoff has to answer both, but the
   * order decides which sentence a rejected puzzle is filed under, and the
   * useful one is the position. "Winning a minor piece in a position that
   * remains approximately equal" is the case the instruction names, and the
   * thing wrong with it is the *position*: reporting it as a swing complaint
   * would file a level ending alongside a pawn grab from a won game, which
   * are different faults needing different fixes. */
  const decided = rec.kind === 'save'
    /* A rescue's payoff is the rescue. It has already had to come from at or
       below BEFORE_SAVE and arrive at or above SAVE_MIN to be a save at all,
       so the minor capture is what delivered that rather than something extra
       being asked of it. */
    ? endScore >= R.SAVE_MIN
    : endScore >= R.PUNISH_MIN;
  if (!decided)
    return { ok: false, why: 'payoff: only ' + minor.join('/') +
                            (rec.kind === 'save' ? ' and the save does not hold ('
                                                 : ' and the game is not decided (') +
                            Math.round(endScore) + 'cp)' };

  if (!WP.atLeast(swing, MINOR_SWING_MIN))
    return { ok: false, why: 'payoff: only ' + minor.join('/') + ', worth +' +
                            swing.toFixed(1) + ' points (needs +' + MINOR_SWING_MIN + ')' };

  return { ok: true, kind: 'material',
           detail: Object.assign({ pieces: minor, banked: Math.round(banked),
                                   swing: +swing.toFixed(1) },
                                 rec.kind === 'save' ? { saved: true } : {}) };
}

/**
 * needsMore(rec) -> true when the line is *on the way* to a payoff and should
 * be extended rather than rejected.
 *
 * The difference matters for cost. A line with nothing captured and no check
 * in sight is not going to grow into a promotion, and spending the extension
 * budget on it is waste; a line that has already won a rook but left it
 * hanging, or that is giving check, or that has a pawn on the seventh, is one
 * more defence away from qualifying. The verifier asks this before deciding a
 * puzzle has failed, so that "no payoff" means "no payoff after we tried".
 */
function needsMore(rec){
  const st0 = P.stateFromFEN(rec.fen);
  const solver = st0.turn, them = P.other(solver);
  const end = walk(rec.fen, rec.moves);
  if (!end) return false;
  if (!P.legalMoves(end, end.turn).length) return false;          // over already
  if (P.inCheck(end, end.turn)) return true;                      // a check is forcing
  if (R.banked(rec.fen, end, solver) > 0) return true;            // something is in hand
  if (gone(st0, end, them).length) return true;                   // something was taken
  // a pawn one step from promoting
  for (let i = 0; i < 64; i++){
    const p = end.b[i];
    if (!p || p.c !== solver || p.t !== 'P') continue;
    const r = P.rowOf(i);
    if ((solver === P.W && r <= 1) || (solver !== P.W && r >= 6)) return true;
  }
  return false;
}

module.exports = { payoffOf, needsMore, MAJOR, MINOR_SWING_MIN, walk, gone };
