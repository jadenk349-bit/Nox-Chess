/* What makes a position a puzzle.
 *
 * This file is the standard, and it is the only copy of it. The generator asks
 * it while mining and the verifier asks it again, deeper, over what shipped —
 * two tools, one rule, because a corpus checked against a second opinion is a
 * corpus with two standards and no way to tell which one a given puzzle met.
 *
 * The rule the first version of this generator used was "one strong move": the
 * best move beats the second best by 150cp. That is a necessary condition and
 * it is nowhere near a sufficient one, and the set it produced says so — 57 of
 * the hundred middlegame puzzles had the solver at worse than −700 before they
 * started and still worse than −700 after the "solution", and another 18 had
 * them already winning by more than +700. Both are positions where exactly one
 * move is best and finding it changes nothing that a player would recognise as
 * winning or losing a game. A puzzle is not "the engine's move here is clear".
 * A puzzle is **a turning point**: the opponent has just thrown something away,
 * and there is one move that collects it.
 *
 * So three things are measured, all of them from the *solver's* point of view
 * (the side to move in the puzzle's fen), and all of them in the same units:
 *
 *   B    what the position was worth before the opponent's last move
 *   A1   what it is worth now, if the solver finds the move
 *   A2   what it is worth now, if the solver plays the second-best move
 *
 * and three things are asked of them:
 *
 *   A1 − B    the mistake.  The opponent's move has to have cost something,
 *             or the position is merely sharp and was always going to be.
 *   A1 − A2   the point.  Finding it has to matter, which is the old rule at a
 *             higher bar.
 *   B, A1, A2 the stakes.  Where the position started and where it ends decide
 *             whether this is a punishment, a rescue, or neither.
 *
 * Everything below is those three questions with the thresholds written down
 * and argued for. Nothing here searches; the caller brings the numbers.
 */

'use strict';

const P = require('./page_chess.js');

/* A mate is not a centipawn count, and comparing one to the other needs them
   on one axis. Faster mates beat slower ones, and every mate beats every
   score, which is what these two numbers arrange. */
const MATE_SCORE = 10000;

/* ------------------------------------------------------------ thresholds
 *
 * Numbers, and why each one is where it is. They are all in centipawns, from
 * the solver's side, and they are all judgement calls — but they are judgement
 * calls in one place rather than scattered through two tools.
 */

// The opponent's move must have cost this much. Under it the position was
// already this sharp and the "mistake" is the engine noticing something that
// was there before — a puzzle whose premise is false, because the explanation
// will say "they blundered" about a move that did not.
const MISTAKE_MIN = 200;

// The solution must beat the runner-up by this much. The old generator used
// 150 and the verifier then reported a third of each track as no longer
// clearing even that at depth: 200 measured head-to-head at the verdict depth
// is the bar this set is actually held to. Below it the player who finds the
// second move is told they are wrong about a move that was just as good.
const GAP_MIN = 200;

// Above this the solver was already better before the opponent erred, so
// whatever follows is conversion rather than a turning point. "Approximately
// equal or only slightly favorable", and 150 is where this file's own
// vocabulary stops saying "slightly better" and starts saying "clearly" — the
// threshold and the word the card uses for it should not disagree, or the
// explanation ends up admitting that the player was already winning.
const BEFORE_MAX = 150;

// At or below this the solver was worse enough that the puzzle is a rescue
// rather than a punishment, and the other set of thresholds applies.
const BEFORE_SAVE = -250;

// A punishment has to arrive somewhere worth arriving. This build has no
// UCI_ShowWDL, so there is no win percentage to quote; +400 with best play is
// where this engine's evaluation stops meaning "better" and starts meaning
// "winning".
const PUNISH_MIN = 400;

// ...and the move that is not found has to arrive somewhere clearly worse. If
// the second-best move also keeps a winning position then every reasonable
// move wins and the puzzle is asking for the neatest way to do something that
// was going to happen anyway.
const PUNISH_ALT_MAX = 250;

// A rescue has to actually rescue. Holding a draw counts; being 80cp worse
// counts; "the best of a lost position" does not, and that is the single
// criterion that removes most of the old middlegame track.
const SAVE_MIN = -80;

// ...and there has to be something to be rescued *from*: the move not found
// has to lose. Without this a level position with one accurate move in it
// reads as a heroic save.
const SAVE_ALT_MAX = -250;

// Two moves that both force mate are two right answers, however different the
// move counts. The board accepts one of them, so the position is ambiguous in
// the only sense that matters to the player sitting in front of it.
const MATE_IS_AMBIGUOUS = true;

/* ------------------------------------------------------------- one axis */

/** One number for a ranked line, mates included, from the searcher's side. */
function lineScore(l){
  if (!l) return null;
  if (l.mate !== null && l.mate !== undefined)
    return l.mate > 0 ? MATE_SCORE - Math.abs(l.mate) : -MATE_SCORE + Math.abs(l.mate);
  return (l.cp === null || l.cp === undefined) ? null : l.cp;
}

/** True when a score is a forced mate for whoever the score speaks for. */
const isMate = v => v !== null && Math.abs(v) > MATE_SCORE - 200;

/* A search always speaks for the side to move. Everything in this file speaks
   for the solver, so a reading taken with the opponent at the root is flipped
   on the way in — and mate scores flip with it, which is why this goes through
   the single axis above rather than negating cp and forgetting mate. */
function asSolver(l, solverToMove){
  const v = lineScore(l);
  return v === null ? null : (solverToMove ? v : -v);
}

/* ------------------------------------------------------------- the rule */

/**
 * judge({before, best, alt}) — the three numbers in, a verdict out.
 *
 *   before  B, or null when it is not known (a record from before this tool)
 *   best    A1
 *   alt     A2
 *
 * Returns { ok:true, kind:'punish'|'save', mistake, gap } or
 *         { ok:false, why:'<short reason>' }.
 *
 * The reasons are short strings on purpose: they are counted and printed, and
 * a run that rejects nine hundred candidates is only readable as a tally.
 */
function judge(n){
  const B = n.before === undefined ? null : n.before;
  const A1 = n.best, A2 = n.alt;

  if (A1 === null || A1 === undefined) return { ok:false, why:'no score' };
  if (A2 === null || A2 === undefined) return { ok:false, why:'one legal move' };

  // Two mates is two answers. Checked before the gap, because on the single
  // axis a mate in 3 and a mate in 9 are six points apart and would otherwise
  // read as the least ambiguous position ever measured.
  if (MATE_IS_AMBIGUOUS && isMate(A1) && A1 > 0 && isMate(A2) && A2 > 0)
    return { ok:false, why:'two mates' };

  const gap = A1 - A2;
  if (gap < GAP_MIN) return { ok:false, why:'ambiguous' };

  const mistake = B === null ? null : A1 - B;
  if (mistake !== null && mistake < MISTAKE_MIN) return { ok:false, why:'no mistake' };

  // Which of the two puzzles this is decided by where the solver stood before
  // the opponent went wrong, not by where they stand now: a position that is
  // winning *because* of the blunder is a punishment, not a rescue.
  const save = B !== null && B <= BEFORE_SAVE;

  if (save){
    if (A1 < SAVE_MIN)      return { ok:false, why:'still lost' };
    if (A2 > SAVE_ALT_MAX)  return { ok:false, why:'nothing to save' };
    return { ok:true, kind:'save', mistake, gap };
  }

  if (B !== null && B > BEFORE_MAX) return { ok:false, why:'already better' };
  if (A2 > PUNISH_ALT_MAX)          return { ok:false, why:'wins anyway' };
  if (A1 < PUNISH_MIN)              return { ok:false, why:'no advantage won' };
  return { ok:true, kind:'punish', mistake, gap };
}

/**
 * mayPass(best, alt) — could *any* value of `before` let this through?
 *
 * The `before` search is the expensive half of mining: it is a second search of
 * a second position, and it is the only question whose answer needs one. Most
 * candidates cannot pass whatever it comes back with, and this says which,
 * from the two numbers already in hand.
 *
 *   A2 > PUNISH_ALT_MAX   the move not found still wins, so it is not a
 *                         punishment; and it is far from losing, so there is
 *                         nothing to rescue either.
 *   A1 < SAVE_MIN         the move found does not even hold the balance, so it
 *                         is no rescue; and it is nowhere near winning, so it
 *                         punishes nothing.
 *   A1 < PUNISH_MIN and A2 > SAVE_ALT_MAX
 *                         between the two: not enough won for a punishment,
 *                         and nothing lost to be saved from.
 *
 * Returns a reason string, or null when the position is still in play. Keeping
 * it beside judge() rather than in the generator is the point — these are the
 * same thresholds, and a short-circuit that drifts from the rule it is meant to
 * anticipate silently narrows the corpus.
 */
function mayPass(best, alt){
  if (best === null || best === undefined) return 'no score';
  if (alt === null || alt === undefined) return 'one legal move';
  if (isMate(best) && best > 0 && isMate(alt) && alt > 0) return 'two mates';
  if (best - alt < GAP_MIN) return 'ambiguous';
  if (alt > PUNISH_ALT_MAX) return 'wins anyway';
  if (best < SAVE_MIN) return 'no advantage won';
  if (best < PUNISH_MIN && alt > SAVE_ALT_MAX) return 'neither';
  return null;
}

/* Whether a line is still worth continuing past this ply — the same "one
   clearly superior move" test, without the turning-point half of it, because
   the turning point was established at the head of the line and is not
   re-established by every move in it. Rule 6: keep going while there is still
   something to find, stop when there is not. */
function stillSharp(a1, a2){
  if (a1 === null || a2 === null) return false;
  if (isMate(a1) && a1 > 0 && isMate(a2) && a2 > 0) return false;
  return a1 - a2 >= GAP_MIN;
}

/* ------------------------------------------------------- worth showing
 *
 * A position can be a turning point and still be a bad puzzle, because the
 * move that collects it is one nobody has to find. These are the shapes of
 * that, from rule 8, each of them read off the board rather than guessed at.
 */

/** The move the puzzle asks for, resolved against its position. */
const uciFind = (st, u) => P.legalMoves(st, st.turn).find(x => P.uciOf(x) === u) || null;

/**
 * trivial(st, first, prev, themes, plies) -> reason string, or null.
 *
 * `prev` is the opponent's move that created the position, as a move object,
 * or null when it is not known.
 */
function trivial(st, first, prev, themes, plies){
  const solver = st.turn;
  const after = P.makeMove(st, first);
  const checks = P.inCheck(after, P.other(solver));
  const motif = themes.some(t => t !== 'longGame');

  // Taking back on the square just taken on. Forced rather than found, and the
  // explanation would have to say "you recaptured".
  if (prev && prev.cap && first.cap && prev.to === first.to) return 'recapture';

  // The only square. A piece under attack with one legal destination is not a
  // decision, whatever the engine thinks of it.
  if (!first.cap && !checks){
    const mine = P.legalMoves(st, solver).filter(m => m.from === first.from);
    if (mine.length === 1 && P.isAttacked(st, first.from, P.other(solver)) &&
        !motif) return 'only square';
  }

  // Free material with nothing else to it. A one-move puzzle whose move takes
  // an undefended piece, gives no check and leaves no pattern behind teaches
  // the player to look for undefended pieces, which they were doing anyway.
  if (plies === 1 && first.cap && !checks && !motif &&
      !P.defendersOf(st, first.to, P.other(solver)).length) return 'free piece';

  // And the general case the old generator already refused: a move findMotifs()
  // has nothing to say about, that checks nothing and wins nothing, would reach
  // the player with a card that explains nothing.
  if (!motif && !checks && !(first.cap && P.see(st, first.to, solver) > 0))
    return 'nothing to say';

  return null;
}


/* --------------------------------------------------------------- themes
 *
 * findMotifs() names nine patterns and it is the only thing allowed to name
 * those nine, here as in the review and in the Study Board card — a puzzle
 * tagged `fork` has to be a puzzle the coach explains with the word fork.
 *
 * What follows adds the tags a *puzzle* has and a single move does not: what
 * kind of answer it is (a rescue, a perpetual), what it costs (a sacrifice),
 * and the two shapes that are about the move before rather than the move
 * itself (a zwischenzug, a defender removed).
 *
 * Deliberately not detected: deflection, decoy, overloading, interference and
 * double attack. Each of them is a claim about *why* a piece cannot do its job,
 * and every cheap test for them fires on positions where it is not true. A
 * puzzle labelled with a tactic that is not on the board is worse than a puzzle
 * labelled with one fewer, because the label is the thing the player is meant
 * to be learning to see. They stay unclaimed until there is a test worth
 * trusting.
 */
function themesOf(rec){
  const tags = [];
  const put = t => { if (t && tags.indexOf(t) < 0) tags.push(t); };
  const st0 = P.stateFromFEN(rec.fen);
  const solver = st0.turn;
  const them = P.other(solver);
  let st = st0, checks = 0, mated = false, stalemate = false;

  for (let i = 0; i < rec.moves.length; i++){
    const m = uciFind(st, rec.moves[i]);
    if (!m) break;
    const after = P.makeMove(st, m);
    const ours = st.turn === solver;
    if (ours){
      for (const motif of P.findMotifs(st, m, after, solver)) put(motif.tag);
      /* A capture that simply wins material. findMotifs() will not call the
         piece you just took "hanging" — its rule is about what is left loose
         *after* a move, and it deliberately refuses to lead with a pawn when
         the move took a queen. That is right for a coach card explaining one
         move in a game, and wrong for a puzzle whose entire answer is "they
         left it there, take it": fifty of these shipped with no theme at all
         until this went in. The exchange is read with the same see() the coach
         uses, so the word means what it means everywhere else. */
      if (m.cap && P.see(st, m.to, solver) > 0) put('hangingPiece');
      if (P.inCheck(after, them)) checks++;
      // net of what the move took: handing a bishop over to win a queen is not
      // a sacrifice, and sacrificeSize() only counts what is left hanging
      if (P.sacrificeSize(st, m, after) - (m.cap ? P.VAL[m.cap.t] : 0) >= 200){
        put('sacrifice');
        // a rook handed to a minor piece is the one sacrifice with its own name
        if (m.p.t === 'R'){
          const takers = P.attackersOf(after, m.to, them)
            .map(sq => after.b[sq]).filter(Boolean);
          if (takers.some(p => p.t === 'N' || p.t === 'B')) put('exchangeSacrifice');
        }
      }
      if (m.promo) put('promotion');
    }
    if (!P.legalMoves(after, after.turn).length)
      (P.inCheck(after, after.turn) ? (mated = true) : (stalemate = true));
    st = after;
  }

  /* What kind of answer it was. `kind` comes from judge(), so this is the one
     tag that is not read off the board — it is read off the numbers that let
     the puzzle in, which is the same thing said in a different place. */
  if (rec.kind === 'save'){
    put('defensiveResource');
    if (stalemate) put('stalemateResource');
    const end = rec.eval && rec.eval.end;
    if (checks >= 2 && typeof end === 'number' && Math.abs(end) < 60) put('perpetual');
  }

  // mate on the board is findMotifs'; mate still being forced is ours
  const end = rec.eval && rec.eval.end;
  if (!mated && isMate(end) && end > 0) put('mateThreat');
  if (checks >= 2 || mated) put('kingAttack');

  /* The two that are about the move before. A zwischenzug is only a
     zwischenzug if there was something to interpose it *into*: the opponent
     just captured, taking back is available and good, and the solution does
     something else first. */
  if (rec.prev && rec.prev.fen && rec.prev.move){
    const bst = P.stateFromFEN(rec.prev.fen);
    const pm = uciFind(bst, rec.prev.move);
    const first = uciFind(st0, rec.moves[0]);
    if (pm && first && pm.cap && P.see(st0, pm.to, solver) > 0 && first.to !== pm.to){
      const after = P.makeMove(st0, first);
      if (P.inCheck(after, them) || first.cap) put('zwischenzug');
    }
    /* And a defender is removed when the piece the solution captures was the
       reason some *other* square was safe. Both halves are checked, because
       "captured a piece that happened to be defending something" is true of
       most captures and says nothing. */
    if (first && first.cap){
      const after = P.makeMove(st0, first);
      for (let i = 0; i < 64; i++){
        if (i === first.to) continue;
        const p = after.b[i];
        if (!p || p.c !== them) continue;
        if (P.see(st0, i, solver) > 0) continue;
        if (P.see(after, i, solver) <= 0) continue;
        if (P.defendersOf(st0, i, them).indexOf(first.to) < 0) continue;
        put('removalOfDefender');
        break;
      }
    }
  }

  /* A pawn that breaks through: pushed rather than traded, and either given
     away or making a passer. */
  const first = uciFind(st0, rec.moves[0]);
  if (first && first.p.t === 'P' && !first.cap){
    const after = P.makeMove(st0, first);
    if (P.see(after, first.to, them) > 0 || passed(after, first.to, solver))
      put('pawnBreakthrough');
  }

  // a quiet move with nothing else to say for it is a positional one, which is
  // a real answer and not a missing label
  if (first && !first.cap && !tags.some(t => t !== 'longGame')){
    const after = P.makeMove(st0, first);
    if (!P.inCheck(after, them)) put('positionalTactic');
  }

  if (rec.moves.length >= 3 && tags.indexOf('mate') < 0) put('longGame');

  /* Nothing may ship unlabelled. Every rule above is a claim about the board
     and any of them may honestly decline, but a puzzle with no theme at all
     tells the player nothing about what they were meant to see — and the
     themes are half of what the card is for. The net catches the shapes that
     fall through every specific test: a check that is not a mate, an attack,
     or any of the named patterns, and otherwise a move that is simply the
     right one. Both are true of the position rather than invented for it. */
  if (!tags.length && first){
    const after = P.makeMove(st0, first);
    put(P.inCheck(after, them) ? 'kingAttack' : 'positionalTactic');
  }
  return tags;
}

/** Nothing of theirs left on this file or the two beside it, ahead of it. */
function passed(st, sq, color){
  const dir = color === P.W ? -1 : 1;
  const c0 = P.colOf(sq);
  for (let r = P.rowOf(sq) + dir; r >= 0 && r <= 7; r += dir)
    for (let dc = -1; dc <= 1; dc++){
      const c = c0 + dc;
      if (!P.onBoard(r, c)) continue;
      const p = st.b[r*8+c];
      if (p && p.t === 'P' && p.c !== color) return false;
    }
  return true;
}

module.exports = {
  MATE_SCORE, MISTAKE_MIN, GAP_MIN, BEFORE_MAX, BEFORE_SAVE,
  PUNISH_MIN, PUNISH_ALT_MAX, SAVE_MIN, SAVE_ALT_MAX,
  lineScore, isMate, asSolver, judge, mayPass, stillSharp, trivial, uciFind,
  themesOf, passed
};
