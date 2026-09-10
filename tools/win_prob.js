/* Winning percentage, from one place only.
 *
 * The Middle Game Practice standard is written in percentage points — a move
 * has to be worth at least +35 of them — and a rule stated in those units is
 * only as trustworthy as the conversion behind it. This file is that
 * conversion, and it is deliberately the only one the tools are allowed to
 * use, because the project already contained two candidates and they do not
 * agree.
 *
 *   winPct(cp)   the page's own logistic, in blind-chess.html, shared with the
 *                tools through page_chess.js and already the basis of
 *                judgeMove()'s accuracy figures. Symmetric, 50% at equality,
 *                and flat enough that a small edge stays a small number.
 *
 *   UCI_ShowWDL  Stockfish 18's own win/draw/loss, in permille, for the side
 *                to move. Requested by both tools (`wdl: true`) since the
 *                native judge went in, parsed in sf.js, and — until this file
 *                — consumed by nothing: no shipped puzzle carries a wdl field.
 *
 * It is tempting to prefer the engine's own number, and it is wrong. WDL is
 * calibrated on Stockfish's results against *itself* at that depth, and an
 * engine at +180 beats itself essentially always, so WDL reads a modest edge
 * as a decided game. Measured on positions out of the shipped corpus at depth
 * 20, read as expected score:
 *
 *      cp     WDL      winPct     gap
 *      13    50.3       51.2      0.9
 *      91    68.5       58.3     10.2
 *     130    88.7       61.7     26.9
 *     180    99.8       66.0     33.8
 *     315   100.0       76.1     23.9
 *
 * They agree at equality and part company everywhere else. Which one is
 * authoritative therefore decides how strict "+35 points" is, and the two
 * answers are not close:
 *
 *   under WDL      a move from level to +180 is already worth +49 points, so
 *                  the gate would admit ordinary positional gains — the exact
 *                  opposite of what it was written for.
 *   under winPct   +35 points from level needs about +471cp, a swing in the
 *                  same territory as PUNISH_MIN. A move has to genuinely
 *                  decide something.
 *
 * So winPct() is the authority: it is the conversion the project already had,
 * it is human-calibrated rather than self-play-calibrated, and "the player's
 * winning percentage" is a claim made to a person. It is also the stricter
 * reading, which is the tie-breaker this project uses.
 *
 * WDL is still recorded on every practice and puzzle that passes, because it
 * is free — the engine is already asked for it — and because a disagreement
 * between the two is worth being able to see later. It is evidence. It is not
 * the gate.
 */

'use strict';

const P = require('./page_chess.js');
const R = require('./puzzle_rules.js');

/* A mate is certainty, and the logistic cannot represent it: +-10000 goes in
   and 100 comes out either way, which is right, but a mate in twelve and a
   mate in one are then the same number as each other and as +9000. That is
   fine for this rule — a forced mate is a won game however long it takes —
   and it is stated here rather than left to the curve's asymptote so that
   nobody later reads 100.0 and wonders whether it was clipped. */
const MATE_PCT = 100;

/** Winning percentage for whoever the score speaks for. Takes a score on
    puzzle_rules' single axis (mates as +-(MATE_SCORE - plies)), not a raw cp. */
function pctOf(score){
  if (score === null || score === undefined) return null;
  if (R.isMate(score)) return score > 0 ? MATE_PCT : 0;
  return P.winPct(score);
}

/** The same, for a ranked line straight out of sf.js, read from the solver's
    side. `solverToMove` is false when the search had the opponent at the root. */
function pctOfLine(line, solverToMove){
  return pctOf(R.asSolver(line, solverToMove));
}

/* Expected score from a WDL triple, in percentage points, for whoever the
   search spoke for. Recorded as evidence; never compared against a threshold.
   Read as expected score rather than as pure win probability because pure win
   probability is ~5% at equality, which is not a scale any of this project's
   prose is written in. */
function wdlPct(wdl, solverToMove){
  if (!wdl) return null;
  const mine = (wdl.win + wdl.draw / 2) / 10;
  return solverToMove === false ? 100 - mine : mine;
}

/**
 * swing(before, after) — the thing the +35 rule measures.
 *
 * Both arguments are scores on the single axis, from the solver's side. The
 * answer is in absolute percentage points, which is the whole reason this
 * function exists rather than a subtraction at each call site: the rule was
 * written to be misread as a relative increase, and 25 -> 60 has to come out
 * as 35 rather than as 140.
 */
function swing(before, after){
  const a = pctOf(before), b = pctOf(after);
  if (a === null || b === null) return null;
  return b - a;
}

/** The cp a percentage corresponds to, for reporting a threshold in the units
    the rest of the rules are written in. Inverse of the page's logistic.
 *
 * Deliberately **not** rounded. It is the mathematical inverse, and rounding
 * it here costs about 0.05 percentage points on the way back — which is
 * invisible everywhere except on a threshold's exact boundary, and the +35
 * rule has an exact boundary that the instruction's own example sits on
 * (25% -> 60% must qualify). A gate that rejects its own worked example
 * because a helper rounded is a gate nobody can reason about. Callers that
 * want a tidy number for a report should round at the point of printing. */
function cpForPct(pct){
  if (pct >= MATE_PCT) return R.MATE_SCORE;
  if (pct <= 0) return -R.MATE_SCORE;
  const y = (pct - 50) / 50;                       // -1 .. 1
  const t = (y + 1) / 2;                           // 0 .. 1
  return -Math.log(1 / t - 1) / 0.00368208;
}

/* Comparing a swing against a threshold needs a hair of slack, and the reason
   is arithmetic rather than chess. 25% -> 60% is exactly +35 and must qualify
   — the instruction says so in as many words — but the logistic and its
   inverse are floating point, so that subtraction comes back as
   34.99999999999999 and a bare `< 35` throws the worked example out. These
   thresholds are judgement calls to one decimal place at the very best;
   precision below a billionth of a percentage point is not a chess opinion,
   it is representation error. `atLeast` is the only way this project compares
   a percentage swing to a bar. */
const EPS = 1e-9;
const atLeast = (value, bar) => value >= bar - EPS;

module.exports = { pctOf, pctOfLine, wdlPct, swing, cpForPct, atLeast, MATE_PCT, EPS };
