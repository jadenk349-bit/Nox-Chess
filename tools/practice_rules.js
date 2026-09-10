/* What makes a position a Practice, as opposed to a Puzzle.
 *
 * Practices live under Lesson -> Practice and they are a different exercise
 * from the Puzzle page, so they answer to a different standard. Both standards
 * are here, and they share this file for the same reason judge() has only one
 * home: two files holding two copies of a threshold is two standards with no
 * way to say which one a given record met.
 *
 * Nothing here searches. The caller brings the numbers.
 *
 * ======================================================================
 * THE +35 RULE, AND WHAT IT CAN POSSIBLY MEAN
 * ======================================================================
 *
 * A Middle Game Practice has to raise the player's winning percentage by at
 * least 35 absolute points — "25% -> 60% qualifies". Implementing that needs a
 * decision the instruction does not make, and the obvious reading is
 * arithmetically impossible, so it is worth being explicit about.
 *
 * The impossible reading is "the position before the move, and the position
 * after it". A search reports what a position is worth *with best play*, so
 * the value of a position and the value of that position after its own best
 * move are the same number by construction. Measured that way every practice
 * in the world swings zero, and the gate would reject all of them.
 *
 * There are two readings that mean something:
 *
 *   (a) what finding it is worth.  before = the position after the *second
 *       best* move; after = the position after the best move. Both under the
 *       opponent's best defence. This is "play the natural move and you are at
 *       25%, find this one and you are at 60%" — the cost of not finding it.
 *
 *   (b) what the opponent threw away.  before = the position before their last
 *       move; after = the position after the solution. This is judge()'s
 *       `mistake`, in percentage points instead of centipawns.
 *
 * (a) is the gate, because a Practice asks the player to *find a move* and (a)
 * is the value of finding it. It is also the reading that makes "25% -> 60%"
 * a sentence about the player's choice rather than about the opponent's.
 * (b) is measured and recorded on every record anyway, so the other reading
 * can be applied later without re-running an engine, and so that a reviewer
 * can see both.
 *
 * Both are computed through win_prob.js, which is the single authority — see
 * the long note in that file about why the page's winPct() is authoritative
 * and Stockfish's own WDL is only evidence.
 *
 * ======================================================================
 * OPENING PRACTICES, AND WHY THEY MAY HAVE MORE THAN ONE ANSWER
 * ======================================================================
 *
 * An Opening Practice is not a tactic and must not be forced to look like one.
 * The move has to be objectively strong; it does not have to win anything, and
 * demanding a 200cp gap from the runner-up — the Puzzle rule — would delete
 * essentially every real opening position, because good opening moves come in
 * clusters. Three sound developing moves in a Ruy Lopez are three sound
 * developing moves, and a system that marks two of them wrong is teaching a
 * falsehood about chess.
 *
 * So an Opening Practice carries a **set** of accepted moves — every move
 * within OPEN_TIE of the best — and the page accepts any of them, while the
 * teaching is written about the primary one. That is an extension of
 * puzzleStep()'s single-answer rule rather than a relaxation of it: the
 * position still has one *idea*, and the record still has to prove that the
 * moves outside the set are meaningfully worse, or there was no question to
 * ask. Two gates enforce that:
 *
 *   the set stays small          OPEN_ACCEPT_MAX. If six moves are equal the
 *                                position is not asking anything.
 *   and it is separated          OPEN_GAP_MIN between the worst accepted move
 *                                and the best rejected one. Without this the
 *                                cut between "right" and "wrong" falls in the
 *                                middle of a continuum and the player is being
 *                                graded on rounding.
 */

'use strict';

const P = require('./page_chess.js');
const R = require('./puzzle_rules.js');
const WP = require('./win_prob.js');

/* ------------------------------------------------- middle game practices */

/* The rule, in the units it was written in. Absolute percentage points from
   the second-best move to the best one, both under best defence. About +400cp
   from level through the page's curve, which is deliberately in the same
   territory as PUNISH_MIN: a Practice that moves the win chance by a third of
   the scale is a Practice about something that decided the game. */
const MG_SWING_MIN = 35;

/* Two moves that both force mate are two right answers, exactly as in
   judge(). Reused rather than restated. */
const bothMate = (a, b) => R.isMate(a) && a > 0 && R.isMate(b) && b > 0;

/**
 * judgeMiddlegame({best, alt, before, obvious}) -> verdict
 *
 *   best     the position after the best move, under best defence, solver's side
 *   alt      the same after the second-best move
 *   before   the position before the opponent's last move (optional, evidence)
 *   obvious  the reason R.obvious() gave, or null
 *
 * Returns { ok:true, swing, mistake } or { ok:false, why }.
 */
function judgeMiddlegame(n){
  const best = n.best, alt = n.alt;
  if (best === null || best === undefined) return { ok:false, why:'no score' };
  if (alt === null || alt === undefined) return { ok:false, why:'one legal move' };
  if (bothMate(best, alt)) return { ok:false, why:'two mates' };

  /* The human half, and it applies here for the same reason it applies to a
     puzzle: a hanging queen produces a +35 swing and teaches nothing. An
     Opening Practice is excused this (see below) because its answer is
     allowed to be a quiet one-move idea; a Middle Game Practice claiming a
     third of the win scale is claiming a tactic, and a tactic nobody has to
     calculate is not a Practice. */
  if (n.obvious) return { ok:false, why:n.obvious };

  const swing = WP.swing(alt, best);
  if (swing === null) return { ok:false, why:'unpriced' };
  if (!WP.atLeast(swing, MG_SWING_MIN))
    return { ok:false, why:'swing +' + swing.toFixed(1) + ' points (needs +' + MG_SWING_MIN + ')' };

  return {
    ok: true,
    swing: +swing.toFixed(1),
    // evidence, never a gate: reading (b) above
    mistake: n.before === null || n.before === undefined
      ? null : +(WP.swing(n.before, best) || 0).toFixed(1),
    pct: { alt: +WP.pctOf(alt).toFixed(1), best: +WP.pctOf(best).toFixed(1) }
  };
}

/* ----------------------------------------------------- opening practices */

/* Within this of the best move, a move is *an* answer and the board must take
   it. 30cp is under a third of a pawn: close enough that calling one of them
   wrong would be a claim the engine does not support. */
const OPEN_TIE = 30;

/* More accepted answers than this and the position is not asking a question.
   Three is the most a single teachable idea survives — a fourth means the
   position is simply comfortable and any sensible move keeps it that way. */
const OPEN_ACCEPT_MAX = 3;

/* And the cut has to be a cut: this much between the worst accepted move and
   the best rejected one. Twice OPEN_TIE, so that a move just outside the set
   is clearly outside it rather than a rounding away from inside. */
const OPEN_GAP_MIN = 60;

/* An opening position should not already be decided. A practice about how to
   handle a position the player is winning by a rook is not an opening
   practice, and a position where they are lost teaches resignation. */
const OPEN_BAND = 250;

/* The reasons R.obvious() gives that do not apply to an Opening Practice.
   Both are length complaints — an opening answer is *meant* to be one quiet
   move, and paying off in material is exactly what it is not for. Every other
   reason obvious() can give still applies: an opening practice whose answer is
   "take the piece they just hung" is as worthless as a puzzle's. */
const OPEN_EXEMPT = ['one move', 'mate in one'];

/**
 * judgeOpening({lines, phase, before}) -> verdict
 *
 *   lines   ranked [{uci, score}] from one wide search of the practice
 *           position, solver to move, best first
 *   phase   bucketFor()'s answer, which must be 'opening'
 *   obvious the reason R.obvious() gave, or null
 *
 * Returns { ok:true, accept:[uci], primary, gap, band } or { ok:false, why }.
 */
function judgeOpening(n){
  const lines = (n.lines || []).filter(l => l && l.uci && l.score !== null &&
                                            l.score !== undefined);
  if (n.phase !== 'opening') return { ok:false, why:'not an opening position (' + n.phase + ')' };
  if (lines.length < 2) return { ok:false, why:'one legal move' };

  if (n.obvious && OPEN_EXEMPT.indexOf(n.obvious) < 0) return { ok:false, why:n.obvious };

  const top = lines[0].score;
  if (R.isMate(top)) return { ok:false, why:'a mate is not an opening decision' };
  if (Math.abs(top) > OPEN_BAND)
    return { ok:false, why:'already decided (' + Math.round(top) + 'cp)' };

  const accept = lines.filter(l => top - l.score <= OPEN_TIE);
  const rejected = lines.filter(l => top - l.score > OPEN_TIE);
  if (accept.length > OPEN_ACCEPT_MAX)
    return { ok:false, why:'no question: ' + accept.length + ' moves within ' + OPEN_TIE + 'cp' };
  if (!rejected.length)
    return { ok:false, why:'nothing to get wrong: the search saw no worse move' };

  /* The separation. `lines` came back ranked, so the worst accepted move is
     the last of the set and the best rejected one is the first outside it. */
  const worstOk = accept[accept.length - 1].score;
  const bestBad = rejected[0].score;
  const gap = worstOk - bestBad;
  if (gap < OPEN_GAP_MIN)
    return { ok:false, why:'the cut is only ' + Math.round(gap) + 'cp (needs ' + OPEN_GAP_MIN + ')' };

  return {
    ok: true,
    primary: accept[0].uci,
    accept: accept.map(l => l.uci),
    // the natural move that is worse, which is what the card has to explain
    foil: rejected[0].uci,
    gap: Math.round(gap),
    band: Math.round(top),
    pct: { best: +WP.pctOf(top).toFixed(1), foil: +WP.pctOf(bestBad).toFixed(1) }
  };
}

/* ---------------------------------------------------------------- shared */

/**
 * A Practice's own realism test, beyond bucketFor().
 *
 * The generator plays real openings and mines from them, so a position's
 * pedigree is normally sound. This catches the two shapes that survive that
 * and still should not be shown: a position reached so early that nothing has
 * been decided (there is no decision to teach on move two), and one where a
 * side has already lost the right to castle without having castled, which is
 * usually the fingerprint of a bot having been shoved around rather than a
 * game anybody played.
 */
function realisticOpening(st){
  if (st.full < 4) return 'too early to be a decision';
  const bothCanStill = side => {
    const k = P.kingSq(st, side);
    if (k < 0) return false;
    const home = side === P.W ? 60 : 4;
    return k === home || k === home - 2 || k === home + 2;
  };
  if (!bothCanStill(P.W) || !bothCanStill(P.B)) return 'a king has wandered';
  return null;
}

module.exports = {
  MG_SWING_MIN, OPEN_TIE, OPEN_ACCEPT_MAX, OPEN_GAP_MIN, OPEN_BAND, OPEN_EXEMPT,
  judgeMiddlegame, judgeOpening, realisticOpening
};
