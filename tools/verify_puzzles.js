#!/usr/bin/env node
/* Marking the puzzles' own homework — and writing the follow-up.
 *
 * tools/generate_puzzles.js finds candidates, judging them at depth 12/16 while
 * it is playing thousands of games. This tool goes back over a finished file,
 * one puzzle at a time and at a deeper setting, and asks whether every claim in
 * it is still true:
 *
 *   - each of the solver's moves is still the engine's best move there;
 *   - each of the defence's moves is still the engine's best defence, because
 *     a line answered by a blunder proves nothing about the moves after it;
 *   - and the position is still a **turning point** at all — which is a
 *     different question from any of the above, and the one a set can pass
 *     every ply of and still fail. See verdict(), and the standard it asks,
 *     which is judge() in tools/puzzle_rules.js and lives there precisely so
 *     that this tool and the generator cannot come to hold two of them.
 *
 * Both colours, because a puzzle whose opponent walks into it teaches a tactic
 * that is not there. And where the deep look disagrees with the file, the file
 * is wrong: the player is being told to play a move the engine does not play,
 * and puzzleStep() in the page will accept nothing else.
 *
 * Three passes, not one, and the order matters:
 *
 *   1. a cheap **sweep** ranks every ply. It only ever *nominates* — a single
 *      pass at depth 22 called six of the hundred opening puzzles wrong and a
 *      look at depth 26 sided with the file on five of the six, so a sweep that
 *      decides is a sweep that rewrites good puzzles.
 *   2. a **head-to-head** at the working depth: the move on file and the move
 *      the engine prefers are each played, and the positions they lead to are
 *      scored. The obvious test — is this the first line of a MultiPV 2 search
 *      — asks about the search rather than about the move, and asking for two
 *      lines changes the pruning enough that the answer is not stable.
 *   3. the **verdict**, the same comparison four ply deeper, and the only thing
 *      allowed to call a move wrong. Nothing is rewritten on one search.
 *
 * A wrong *move* is not deleted, it is rebuilt: the line is cut at the ply the
 * engine will not sign, the engine's own move is put there, and it is extended
 * by the same rules the generator used — best defence, ask again, stop when the
 * position is no longer sharp. Repairing changes the line, so the id (a hash of
 * the position and the line) and the seed rating are recomputed with it.
 *
 * A position that is no longer a turning point *is* deleted, and that is the
 * asymmetry worth understanding. There is a right move to put in place of a
 * wrong one. There is nothing that would make a position worth showing that is
 * not one — rebuilding the line would only produce a correct solution to a
 * position that still should not be in the file. So the track loses a rung and
 * closes over the hole. It is however many puzzles cleared the standard, not a
 * fixed hundred with the failures papered over; ids are untouched, so nobody
 * loses a solve, only their place in the numbering.
 *
 * What the tool will not do is rewrite a correct solution for being *dull* —
 * still the best move, no longer clear of the runner-up at the sweep depth.
 * Sharpness is how the generator chose the position; it is not a claim the file
 * makes to the player, and a run that rewrote it would be undone by the next
 * run at the next depth. Dull puzzles are counted and reported instead.
 *
 * Every puzzle that survives gets an **explanation** — what the opponent's move
 * gave away, a sentence per ply, and where it arrives — written by
 * tools/puzzle_words.js into `why`. It is written here rather than in the page
 * for the same reason the follow-up is: the puzzle screen has no engine in it
 * and is not going to grow one. It is rewritten on every run rather than only
 * on repair, because it is derived from the record and a re-verified track
 * should come back consistent with the tool that checked it.
 *
 * Then every puzzle — repaired or not — gets a **follow-up**: a few more plies
 * of best play from both sides past the end of the solution, each one an engine
 * answer at full depth, with the evaluation that line arrives at and the one it
 * started from. That is what the "Show Follow Up" button plays out on the
 * board: the puzzle proves the move is forced, the follow-up shows what it was
 * forced *for*. It is precomputed here rather than searched in the browser,
 * because a puzzle screen with a Stockfish worker in it is a second engine in a
 * feature that was built around not having one.
 *
 * Nothing is written unless it is asked for.
 *
 *   node tools/verify_puzzles.js --track opening                  # report only
 *   node tools/verify_puzzles.js --track middlegame --write       # repair in place
 *   node tools/verify_puzzles.js --track endgame --followup 6 --write
 *   node tools/verify_puzzles.js --track endgame --resort --write # ...and re-rank
 *   node tools/verify_puzzles.js --track opening --limit 5        # a smoke test
 *
 * One tool for all three ladders. The tracks differ only in which file is read:
 * an opening puzzle, a middlegame puzzle and an endgame puzzle are the same
 * record — fen, moves, themes, seedRating, and the evidence behind them: `prev`,
 * the position the mistake was made from, `eval`, what the three moves were
 * worth, and `alt`, the move that was not the answer — and the same claim is
 * being checked about each of them, so a second verifier per track would only
 * be a second place for the rules to drift.
 *
 * Every search here is a `fresh` and an `objective` one — see sf.js. Fresh
 * because a pool engine that has already answered forty questions answers the
 * forty-first differently. Objective because this build applies contempt from
 * the point of view of whoever is to move at the root, and the verdict compares
 * a position measured with the opponent at the root against the same position
 * measured with the solver at it: left on, every move ever played looks about
 * 50cp worse than it was, and the mistake the standard is built on is the
 * setting rather than the move. The one exception is clean(), which wraps the
 * generator's seedRating() — that is imitating a rung of the bot ladder, and a
 * bot is a player, and a player should have contempt.
 *
 * The rest of what fresh buys: A pool engine that has
 * already answered forty questions answers the forty-first differently, and a
 * verdict that depends on which engine of the pool happened to draw the puzzle
 * is not a verdict. Depth, never movetime, for the same reason the generator
 * uses it: the answer must not depend on how fast the machine is.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const P = require('./page_chess.js');
const R = require('./puzzle_rules.js');
const WORDS = require('./puzzle_words.js');
const { Pool } = require('./sf.js');
const G = require('./generate_puzzles.js');

const DEFAULTS = {
  track: 'middlegame',
  jobs: Math.max(1, Math.min(12, require('os').cpus().length - 2)),
  dir: path.join(__dirname, '..', 'puzzles'),
  file: '',           // an explicit file, when it is not dir/track.json
  /* Deeper than the generator on purpose. Re-asking at the depth that wrote
     the file would mostly read it back; the point is a second opinion — and
     from a second *engine*: the judge is the native Stockfish 18 on PATH, NNUE
     and all, while engine/ is the pre-NNUE build the browser runs. These
     numbers are for the former, which is both much stronger and about twenty
     times faster at a given depth, so they are deeper than the old set and
     still cheaper to reach. */
  sweep: 18,          // the cheap pass over every ply, which only nominates
  multipv: 5,         // how wide the sweep looks
  depth: 22,          // the head-to-head on anything the sweep nominated
  replyDepth: 22,     // the defence
  deepDepth: 26,      // the tie-break: the only thing allowed to call a move wrong
  threads: 1,         // per engine; jobs x threads should fit the machine
  hash: 512,          // MB per engine
  /* The whole-puzzle verdict — is this still a turning point at all — is a
     different question from "is this ply the engine's move", and it is asked
     of every puzzle rather than of the few plies the sweep disliked. So it
     gets its own depth: deep enough to be a real second opinion on the
     generator's 16, shallow enough to afford three searches on every record. */
  verdictDepth: 24,
  followDepth: 20,    // the follow-up, where nothing is being decided any more
  /* Lines run to their payoff now rather than to the end of the doubt, so the
     cap has to leave room for one: a combination that wins a rook on move four
     needs nine plies to show it. Still odd — a puzzle ends on your move. */
  maxPlies: 11,
  // How far the puzzle's own move may fall short of the sweep's before the
  // slow searches are spent on it. Not zero: two roads to the same won ending
  // are both "the answer" and the file is allowed to have picked either.
  tol: 50,
  // The defence is held to a looser standard than the solve. It only has to be
  // a real try; the solver's move has to be the move.
  defTol: 100,
  // Two moves within a few centipawns of each other are the same move as far
  // as this tool is concerned: rewriting a solution because the engine now
  // prefers the other way of winning the same piece would churn the file
  // without making any of it more true.
  tie: 15,
  // A defence that is not the engine's first choice but loses by the same
  // amount is not a wrong defence — Stockfish is picking between two ways of
  // being lost. Only a defence that is actually better than the one on file
  // rewrites the line.
  replySlack: 25,
  follow: 6,          // plies of best play past the end of the solution; --followup
  // A corrected puzzle was priced on the move it no longer plays, so its seed
  // rating is re-measured. --no-reseed skips the slow ladder replay when a run
  // is only after the follow-ups.
  reseed: true,
  /* A ladder promises that puzzle 1 is easier than puzzle 100, and a corrected
     puzzle is rarely as hard as the one it replaced. --resort re-ranks the
     whole track by the generator's own difficulty key and renumbers it; rungs
     move, nobody's progress does, because progress is stored per puzzle id and
     every id survives. It is off by default because a run is normally read as
     "what changed", and a file that comes back reordered hides that in a diff
     of a hundred moved records. It is refused on a partial run (--limit),
     which could only sort the part it looked at. */
  resort: false,
  write: false,       // nothing is written unless it is asked for
  dry: false,         // the same thing said the other way round
  limit: 0,           // 0 = the whole track; a number checks the first n, for a smoke test
  report: '',
  /* Every puzzle's result, written the moment it is finished.
   *
   * The verifier used to hold a whole track in memory and write once, at the
   * end. Five hours into a run that meant five hours of work with nothing on
   * disk, and one pathological puzzle held 314 finished results hostage until
   * it returned. A stage that long has no business being all-or-nothing.
   * Results are appended to <file>.progress.jsonl as they land, and a restart
   * skips the ids already there. */
  progress: true,
  /* The per-puzzle budget, in seconds. A puzzle that exceeds it is *rejected*
     as pathological — never accepted, never verified at a lower depth. The
     search is abandoned rather than weakened, so nothing ships that has not
     met the full standard. 0 turns it off. */
  budget: 2700,
  /* Verify several tracks from one queue. One track at a time means the tail
     of a track leaves every engine idle while the next track waits; sharing a
     queue lets them carry on. Comma separated, e.g. middlegame,endgame. */
  tracks: ''
};

// --followup is the same knob as --follow, because both halves of this tool
// were written under their own name before they were one tool.
const ALIASES = { followup: 'follow', followUp: 'follow', out: 'dir' };

const MATE_SCORE = R.MATE_SCORE;
const uciFind = G.uciFind;

/* Two lines wide, for the searches that *build* rather than judge.
 *
 * A single-line search prunes against the best move it has found so far, and
 * it is allowed to throw away a move it has decided cannot beat that one: in
 * one position of the endgame set it answers Nxb7 at +15 and never mentions
 * that Rxb7 is +63, which MultiPV 2 finds at the same depth in the same time.
 * A defence or a follow-up move chosen that way writes exactly the fault this
 * tool exists to correct, so both are asked for two lines wide and read off
 * the ranking with bestOf().
 *
 * Judging is the opposite case and deliberately asks for one line — see
 * checkReplyPly — because there the question is what the engine *plays*, and
 * asking for two lines changes the pruning enough that the answer moves.
 *
 * clean() is for the generator's own helpers, which ask their own questions
 * (seedRating() is imitating a weak rung, and its MultiPV is the point) and
 * only need the table emptied first. */
const clean = engine => ({
  ask: o => engine.ask(Object.assign({ fresh: true }, o))
});

/** The move a search actually names, read off the ranking rather than off
    bestmove — at Skill 20 they agree, and when they do not the ranking is the
    one a player would be shown. */
const bestOf = res => ((res.lines || [])[0] || {}).best || res.best || null;

/* ---------------------------------------------------------------- helpers */

/** The position a line has reached, or null if the line does not play. */
function walk(fen, moves){
  let st = P.stateFromFEN(fen);
  for (const u of moves){
    const m = uciFind(st, u);
    if (!m) return null;
    st = P.makeMove(st, m);
  }
  return st;
}

/** One score for a line, from the side to move's point of view. */
const scoreOf = l => R.lineScore(l);

/** Is the line over — mate, stalemate, or nothing left to take? */
const gameOver = st => !P.legalMoves(st, st.turn).length;

/* What a position is worth to the side that has just moved into it.
 *
 * Scores come back from Stockfish for the side to move, so the sign flips
 * every ply; this is the one place that flip happens, and everything above it
 * can compare two moves by the same rule — bigger is better for the player
 * who played them. A finished game is a result rather than a score. */
async function scoreAfter(engine, fen, moves, cfg, depth){
  const st = walk(fen, moves);
  if (!st) return null;
  if (gameOver(st)) return P.inCheck(st, st.turn) ? MATE_SCORE : 0;   // mate, or stalemate
  const res = await engine.ask({
    fen, moves, multipv: 1, depth: depth || cfg.depth, fresh: true, objective: true
  });
  const l = (res.lines || [])[0] || res;
  const v = scoreOf(l);
  return v === null ? null : -v;
}

/* One ply, ranked cheaply — the sweep.
 *
 * The comparison happens *inside* one search: the file's move is looked for
 * among the MultiPV lines and its score is read off there, so the two numbers
 * being subtracted came out of the same tree at the same depth. Only when the
 * move is not ranked at all does it fall back to a search of its own, and then
 * with a lot of room for the noise that costs.
 *
 * This is also where dullness is noticed, since the same search already has
 * the runner-up in hand: still the best move, no longer clear of the field. */
async function rank(engine, fen, prefix, played, depth, cfg){
  const res = await engine.ask({
    fen, moves: prefix, multipv: cfg.multipv, depth, fresh: true, objective: true
  });
  const lines = (res.lines || []).filter(Boolean);
  const top = lines[0], second = lines[1];
  if (!top || !top.best) return null;
  const mine = lines.find(l => l.best === played);
  const best = scoreOf(top);
  let got = mine ? scoreOf(mine) : null;
  let ranked = !!mine;
  if (got === null){
    got = await scoreAfter(engine, fen, prefix.concat([played]), cfg, depth);
    ranked = false;
  }
  if (best === null || got === null) return null;
  return {
    top: top.best, best, got, ranked,
    // the shallowest depth this search never changed its mind after, which is
    // what difficulty() ranks a rung on and what the shipped file does not carry
    settle: res.settleDepth,
    loss: best - got,
    gap: second ? best - scoreOf(second) : null,
    sharp: R.stillSharp(best, second ? scoreOf(second) : null),
    // a position already won without finding anything is a different complaint
    // from a narrow gap, and only the second says the answer is ambiguous
    won: !!second && scoreOf(second) >= R.PUNISH_ALT_MAX,
    // A mate that is found and a mate that is missed are not a few centipawns
    // apart, but the arithmetic says they are when the missed one still wins a
    // rook. Asked separately: if the engine mates, the file has to.
    mateMissed: top.mate > 0 && got < MATE_SCORE - 100
  };
}

/* Two moves, compared by playing each of them and asking what is left.
 *
 * The obvious test — is the move the first line of a MultiPV 2 search — is not
 * the same question, and answering it that way is what made an earlier pass of
 * this tool "repair" lines into exactly what they already were: asking for two
 * lines changes the pruning, so the move an engine names first with MultiPV 2
 * is not always the move it plays with MultiPV 1. Playing both and scoring the
 * results asks about the moves rather than about the search. */
async function betterBy(engine, fen, prefix, played, rival, cfg, depth){
  const mine = await scoreAfter(engine, fen, prefix.concat(played), cfg, depth);
  const theirs = await scoreAfter(engine, fen, prefix.concat(rival), cfg, depth);
  if (mine === null || theirs === null) return null;
  return theirs - mine;                       // how much better the rival is
}

/* Whether a puzzle's move at ply `i` still holds up, and what the engine
   would have played instead.

   The test is "is this the move", not "is this still a hard puzzle". A
   solution that is as good as anything else is a correct solution even if a
   deeper search has since narrowed the gap to the runner-up — sharpness is
   what made the position worth choosing, and it is reported, but it is not
   grounds for rewriting a line that is right. */
async function checkSolverPly(engine, fen, prefix, played, cfg, depth){
  const res = await engine.ask({
    fen, moves: prefix, multipv: 2, depth: depth || cfg.depth, fresh: true, objective: true
  });
  const lines = (res.lines || []).filter(Boolean);
  const top = lines[0], second = lines[1];
  if (!top || !top.best) return { ok: false, why: 'no-answer', best: null };
  const gap = second ? scoreOf(top) - scoreOf(second) : null;
  const sharp = R.stillSharp(scoreOf(top), second ? scoreOf(second) : null);
  const won = !!second && scoreOf(second) >= R.PUNISH_ALT_MAX;
  if (top.best === played) return { ok: true, best: played, gap, sharp, won };
  const by = await betterBy(engine, fen, prefix, played, top.best, cfg, depth);
  if (by !== null && by <= cfg.tie)
    return { ok: true, best: played, tie: true, gap, sharp, won, by };
  return { ok: false, why: 'not-best', best: top.best, gap, sharp, won, by };
}

/* The defence. One line is asked for, exactly as the generator asked, and a
   reply that is not the first choice is compared with the one that is: two
   ways of being lost are not a wrong defence, and rewriting the line for one
   of them would change the puzzle without improving it. */
async function checkReplyPly(engine, fen, prefix, played, cfg, depth){
  const res = await engine.ask({
    fen, moves: prefix, multipv: 1, depth: depth || cfg.replyDepth, fresh: true, objective: true
  });
  const best = res.best || ((res.lines || [])[0] || {}).best;
  if (!best) return { ok: true, best: played };                  // nothing to say
  if (best === played) return { ok: true, best };
  const by = await betterBy(engine, fen, prefix, played, best, cfg, depth);
  if (by !== null && by <= cfg.replySlack)
    return { ok: true, best: played, alt: best, by };
  return { ok: false, why: 'weak-defence', best, by };
}

/* The solver's move in a position being rebuilt, by the same test that judges
   an existing one: the MultiPV 2 search says whether the position is still a
   puzzle and names its answer, the MultiPV 1 search says what the engine
   actually plays, and where the two differ the better of the pair is kept.
   Reconciling them here is what makes a repaired line survive being checked. */
async function pickSolver(engine, fen, moves, cfg){
  const two = await engine.ask({ fen, moves, multipv: 2, depth: cfg.depth, fresh: true, objective: true });
  const lines2 = (two.lines || []).filter(Boolean);
  const top = lines2[0];
  const a = scoreOf(top), b = lines2[1] ? scoreOf(lines2[1]) : null;
  const cand = R.stillSharp(a, b);
  const choosing = R.stillChoosing(a, b);
  let pick = top && top.best;
  if (!pick) return null;
  const one = await engine.ask({ fen, moves, multipv: 1, depth: cfg.depth, fresh: true, objective: true });
  const alt = one.best || ((one.lines || [])[0] || {}).best;
  if (alt && alt !== pick){
    const by = await betterBy(engine, fen, moves, pick, alt, cfg);
    if (by !== null && by > cfg.tie) pick = alt;
  }
  return { best: pick, sharp: cand, choosing };
}

/* Re-derive a solution from a prefix that has already been checked. The rules
   are the generator's buildLine(): the player's move, the engine's own best
   defence, then ask again — while the position stays a puzzle, stopping at a
   clear material win, at mate, or at the length cap.

   Whose turn it is at the end of the prefix is the parity of its length, since
   a solution starts and ends on the solver's move. An even prefix is cut at a
   solver's move that did not hold up, and `first` — the move that overruled it,
   taken from the verdict search rather than asked for again at some other
   depth — goes in its place. An odd prefix is cut at a defence that did not
   hold up, and there is nothing to splice: the loop's first act is to ask for
   the best defence, which is the same question with the same answer. That line
   may well stop at once, leaving the puzzle a move shorter and ending, as it
   must, on the solver's move.

   `soft` says the first move is no longer a "one strong move" answer at all:
   the line is then simply best play, which is a correct solution to a position
   that is no longer much of a puzzle. */
async function extendFrom(engine, fen, prefix, cfg, first){
  const moves = prefix.slice();
  let st = walk(fen, moves);
  if (!st) return null;
  let soft = false;

  if (moves.length % 2 === 0){                                 // the solver is to move
    let pick = first;
    if (!pick){
      const chosen = await pickSolver(engine, fen, moves, cfg);
      if (!chosen) return null;
      pick = chosen.best;
      soft = !chosen.sharp;
    }
    const m = uciFind(st, pick);
    if (!m) return null;
    moves.push(pick);
    st = P.makeMove(st, m);
  }

  const solver = P.stateFromFEN(fen).turn;
  for (;;){
    if (gameOver(st)) break;                                   // mate delivered
    // to the payoff, not to the end of the doubt — see paidOff() in the rules
    if (R.paidOff(fen, st, solver)) break;
    if (moves.length + 2 > cfg.maxPlies) break;
    // two lines wide, not one — see bestOf() above: the defence a rebuilt line is
    // extended with has to be the toughest one there is, and a single-line
    // search may never mention it
    const reply = await engine.ask({ fen, moves, multipv: 2, depth: cfg.replyDepth, fresh: true, objective: true });
    const defence = bestOf(reply);
    if (!defence) break;
    const rm = uciFind(st, defence);
    if (!rm) break;
    const next = P.makeMove(st, rm);
    if (gameOver(next)) break;                                 // the defence walked into mate
    const look = await pickSolver(engine, fen, moves.concat([defence]), cfg);
    if (!look || !look.choosing) break;                        // nothing left to choose
    const pm = uciFind(next, look.best);
    if (!pm) break;
    moves.push(defence, look.best);
    st = P.makeMove(next, pm);
  }
  return { moves, soft };
}

/* The follow-up: what happens next, if both sides keep playing well.
 *
 * A puzzle stops the moment the answer is no longer in doubt, which is exactly
 * where a player is left asking "so what?". Every move here is the engine's
 * own at full depth — asked one at a time, so each is answered in the position
 * it is actually played in, and not read off somebody else's principal
 * variation — and the evaluation carried back is the one the line arrives at,
 * from the solver's side. */
async function followUp(engine, fen, moves, cfg){
  const line = [];
  const solver = P.stateFromFEN(fen).turn;
  let st = walk(fen, moves);
  if (!st) return null;

  for (let i = 0; i < cfg.follow; i++){
    if (gameOver(st)) break;
    const res = await engine.ask({
      fen, moves: moves.concat(line), multipv: 2, depth: cfg.followDepth, fresh: true, objective: true
    });
    const best = bestOf(res);
    if (!best) break;
    const m = uciFind(st, best);
    if (!m) break;
    line.push(best);
    st = P.makeMove(st, m);
  }

  // Where that leaves the solver. Read from the final position rather than
  // carried along the line, because the sign flips every ply and a search
  // always speaks for the side to move.
  const out = { moves: line };
  if (gameOver(st)){
    // a finished game has a result, not a score: mate for whoever just moved,
    // or a draw
    if (P.inCheck(st, st.turn)) out.mate = 0;
    else out.cp = 0;
  } else {
    const end = await engine.ask({
      fen, moves: moves.concat(line), depth: cfg.followDepth, fresh: true, objective: true
    });
    const l = (end.lines || [])[0] || end;
    const sign = st.turn === solver ? 1 : -1;
    if (l.mate !== null && l.mate !== undefined) out.mate = l.mate * sign;
    else if (l.cp !== null && l.cp !== undefined) out.cp = l.cp * sign;
  }
  // and what it has won on the board since the puzzle began, which is what the
  // card turns into "a rook up"
  out.swing = G.materialSwing(fen, st);

  /* What the position was worth before any of it was played. Without this the
     card cannot tell the two kinds of good move apart: one that wins, and one
     that is the best of a lost position. Both are the right answer, and a
     player who has just found the second deserves to be told which it was.
     The solver is the side to move here, so the score needs no flip. */
  const at = await engine.ask({ fen, multipv: 1, depth: cfg.followDepth, fresh: true, objective: true });
  const head = (at.lines || [])[0] || at;
  if (head.mate !== null && head.mate !== undefined) out.startMate = head.mate;
  else if (head.cp !== null && head.cp !== undefined) out.startCp = head.cp;
  return out;
}

/* Is it still a turning point?
 *
 * The per-ply audit above asks "is this the engine's move", which is rule 7,
 * and a set can pass all of it and still be the set this rewrite replaced —
 * every move correct, and nothing at stake in any of them. This is the other
 * half: the same three numbers judge() was given while mining, measured again
 * deeper and from outside.
 *
 *   before  the position the opponent moved *from*, flipped to the solver's
 *           side. Without it there is no way to say anybody blundered, so a
 *           record that does not carry `prev` cannot be checked and is
 *           dropped rather than waved through — an unverifiable claim is not
 *           a weaker claim, it is not a claim.
 *   best    the move the file plays, scored by playing it.
 *   alt     the best of everything else, named by a wide search and then
 *           scored the same way. Named and scored separately for the reason
 *           betterBy() exists: the top line of a MultiPV list is not always
 *           the move a narrower search plays, and the two numbers being
 *           subtracted have to have come from the same kind of question.
 *
 * This is also, without needing a fourth pass, the test for an *unstable*
 * position — one whose best move keeps changing as the search deepens. audit()
 * has already settled the line against depth 18 and, where those disagreed,
 * depth 26. If a search at 22 then prefers something else, `alt` is the move it
 * prefers and scores higher than the one on file, the gap comes out negative,
 * and judge() calls it ambiguous. A position that cannot hold an answer across
 * three depths is dropped, which is the right outcome and not a coincidence:
 * "there is one clearly superior move" and "the engine keeps changing its mind"
 * are the same claim, tested from opposite sides.
 */
async function verdict(engine, p, cfg){
  const d = cfg.verdictDepth;
  const fen = p.fen, moves = p.moves;

  if (!p.prev || !p.prev.fen || !p.prev.move) return { ok: false, why: 'unpriced' };
  // the position before it, which speaks for the opponent and is flipped here
  const was = await engine.ask({ fen: p.prev.fen, depth: d, fresh: true, objective: true });
  const before = R.asSolver((was.lines || [])[0] || was, false);

  // what else there was. Three lines, so that "the second best" is a move and
  // not the first thing a two-line search happened to keep.
  const wide = await engine.ask({ fen, multipv: 3, depth: cfg.depth, fresh: true, objective: true });
  const lines = (wide.lines || []).filter(Boolean);
  const rival = (lines.find(l => l.best && l.best !== moves[0]) || {}).best;
  if (!rival) return { ok: false, why: 'one legal move' };

  const best = await scoreAfter(engine, fen, [moves[0]], cfg, d);
  const alt  = await scoreAfter(engine, fen, [rival], cfg, d);
  const v = R.judge({ before, best, alt });
  return Object.assign({}, v, {
    score: { before, best, alt, end: null },
    alt: { uci: rival, score: alt },
    settle: wide.settleDepth
  });
}

/* ------------------------------------------------------------ one puzzle */

/* ------------------------------------------------------------ one puzzle */

/* Every ply of one solution, swept cheaply and then, where the sweep and the
   file disagree at all, judged slowly. Returns the first ply the engine will
   not sign, or -1 when it signs all of them. */
async function audit(engine, p, cfg){
  const fen = p.fen;
  const solver = P.stateFromFEN(fen).turn;
  const notes = [];
  let st = P.stateFromFEN(fen);
  // measured on the puzzle's own position, and only there: it describes how
  // hard the *first* move is to see, which is what the ladder is ordered by
  let settle = null;

  for (let i = 0; i < p.moves.length; i++){
    if (!st || gameOver(st)) return { at: i, why: 'line-over', notes, settle };
    const played = p.moves[i];
    if (!uciFind(st, played)) return { at: i, why: 'illegal', notes, settle };
    const prefix = p.moves.slice(0, i);
    const mine = st.turn === solver;
    const where = (mine ? 'solution' : 'defence') + ' ply ' + i + ': ';

    // 1. the sweep, which only nominates: nothing below this line trusts it
    const quick = await rank(engine, fen, prefix, played, cfg.sweep, cfg);
    if (i === 0 && quick) settle = quick.settle;
    if (mine && quick && quick.top === played && !quick.sharp)
      // still the move, no longer the only move: worth knowing when the set is
      // next regenerated, not worth rewriting a correct solution over
      notes.push('ply' + i + ':dull' +
                 (quick.won ? '(won)' : '(gap=' + (quick.gap === null ? '?' : Math.round(quick.gap)) + ')'));
    const close = quick &&
      quick.loss < (mine ? cfg.tol : cfg.defTol) * (quick.ranked ? 1 : 3) &&
      !quick.mateMissed;
    if (!quick || quick.top === played || close){
      if (quick && quick.top !== played)
        notes.push(where + played + ' is not ' + quick.top +
                   ' but only by ' + Math.round(quick.loss) + 'cp');
      st = P.makeMove(st, uciFind(st, played));
      continue;
    }

    // 2. the head-to-head, and 3. the same comparison deeper. Nothing is
    // rewritten on one search: a move the first pass disliked is asked again
    // at the verdict depth, and only a verdict that survives that is allowed
    // to change the file — otherwise the tool would spend its time rewriting
    // lines that the next run would rewrite back.
    const ask = mine ? checkSolverPly : checkReplyPly;
    let r = await ask(engine, fen, prefix, played, cfg);
    if (!r.ok){
      const second = await ask(engine, fen, prefix, played, cfg, cfg.deepDepth);
      if (second.ok) notes.push(where + played + ' is best at depth ' + cfg.deepDepth +
                                ' and not at depth ' + cfg.depth);
      r = second;
    }
    if (r.ok && r.tie) notes.push('ply' + i + ':tie');
    if (!r.ok)
      return {
        at: i, top: r.best, notes, settle,
        why: where + 'file plays ' + played + ', engine plays ' + (r.best || '?') +
             ' (' + r.why + (r.by === null || r.by === undefined ? ''
                                                                 : ', ' + Math.round(r.by) + 'cp worse') + ')'
      };
    st = P.makeMove(st, uciFind(st, played));
  }
  return { at: -1, why: '', notes, settle };
}

async function verifyOne(p, engine, cfg, rung){
  const note = { n: p.n, id: p.id, repaired: false, soft: false, notes: [] };
  const fen = p.fen;
  const st0 = P.stateFromFEN(fen);

  const found = await audit(engine, p, cfg);
  note.notes = found.notes;
  note.settle = found.settle;

  let moves = p.moves;
  if (found.at >= 0){
    // Rebuild from the last position that held up. The engine's own move goes
    // in where the file's was, and extendFrom() keeps going for as long as the
    // position is still a puzzle.
    const rebuilt = await extendFrom(engine, fen, p.moves.slice(0, found.at), cfg, found.top);
    if (!rebuilt || !rebuilt.moves.length || rebuilt.moves.length % 2 === 0){
      // nothing to put in place of the move the engine will not sign, so there
      // is no puzzle here — it leaves the track rather than shipping wrong
      note.failed = found.why || 'no-line';
      note.dropped = 'unrepairable';
      return { puzzle: null, note };
    }
    moves = rebuilt.moves;
    // the stored notes about how forced each defence was describe the line
    // that has just been replaced, ply for ply; keeping them would put the old
    // line's sentences under the new line's moves
    note.repaired = true;
    note.soft = rebuilt.soft;
    note.why = found.why;
    note.wasBad = { ply: found.at, played: p.moves[found.at], engine: found.top || null };
    note.was = p.moves.slice();
  }

  /* A line can be right at every ply and still stop before its point. The
     audit only rebuilds what it disagrees with, so without this a correct
     one-move puzzle stays a correct one-move puzzle and is then dropped for
     having nothing to calculate — when what it needed was to be *continued*.
     Extending is the same machinery a repair uses: best defence, ask again,
     stop at the payoff. */
  if (found.at < 0){
    const end = walk(fen, moves);
    if (end && !R.paidOff(fen, end, st0.turn) && moves.length + 2 <= cfg.maxPlies){
      const grown = await extendFrom(engine, fen, moves, cfg);
      if (grown && grown.moves.length > moves.length && grown.moves.length % 2 === 1){
        note.grew = { from: moves.length, to: grown.moves.length };
        moves = grown.moves;
        delete p.replies;              // the notes describe the shorter line
      }
    }
  }

  const out = Object.assign({}, p, { moves });
  if (note.repaired || note.grew) delete out.replies;

  /* And then the question the per-ply audit cannot ask: is any of this worth
     showing? A solution can be correct at every ply and still be the best move
     in a position that was already lost, or already won, or that nobody went
     wrong in. judge() decides, on numbers measured here rather than the ones
     the generator wrote, and a puzzle it refuses is dropped from the track.

     Dropped, not repaired. A wrong *move* has a right move to put in its
     place; a position that is not a turning point has nothing that would make
     it one, and rebuilding the line would only produce a correct solution to a
     position that still should not be in the file. */
  const v = await verdict(engine, out, cfg);
  if (!v.ok){
    note.dropped = v.why;
    return { puzzle: null, note };
  }
  out.kind = v.kind;
  out.alt = v.alt;
  out.eval = v.score;
  note.kind = v.kind;
  note.gap = Math.round(v.gap);
  note.mistake = v.mistake === null ? null : Math.round(v.mistake);
  if (!note.repaired && v.settle) note.settle = v.settle;

  if (note.repaired){
    // The id is a hash of the position and its line, so a repaired puzzle is a
    // different puzzle and says so; progress is stored by id, and somebody who
    // solved the broken line has not solved this one.
    out.id = G.puzzleId(G.bucketFor(st0), fen, moves);
    // The rating is what the ladder is sorted by and what the Elo update
    // scores against, and it was measured on the old first move. seedRating()
    // is the generator's own cold start, exported rather than copied so that a
    // repaired rung is priced exactly the way the ladder was.
    if (cfg.reseed && moves[0] !== p.moves[0]){
      out.seedRating = await G.seedRating(clean(rung || engine), fen, moves[0]);
      note.seedRating = out.seedRating;
      // the first move changed, so how hard it is to see changed with it
      const re = await engine.ask({ fen, multipv: 2, depth: cfg.depth, fresh: true, objective: true });
      note.settle = re.settleDepth;
    }
  }
  // where the solution itself leaves the board, which is what the card's last
  // sentence is about and what the follow-up is the answer to
  out.eval.end = await scoreAfter(engine, fen, out.moves, cfg, cfg.followDepth);

  if (cfg.follow > 0){
    out.follow = await followUp(engine, fen, out.moves, cfg);
    // an older run of this tool stored the line on its own, under its own name;
    // leaving it beside a freshly measured one would be two answers to the same
    // question, and the page would read the newer one and never say so
    delete out.followUp;
    note.follow = out.follow ? out.follow.moves.length : 0;
    /* The card asks "was this a win or the best of a bad job", and answers it
       from the score the puzzle started at. That is the same number the verdict
       just measured, at a greater depth than the follow-up runs at, so it is
       handed over rather than searched for again — two searches for one fact is
       two chances for the card to contradict itself. */
    if (out.follow){
      if (R.isMate(out.eval.best))
        out.follow.startMate = Math.sign(out.eval.best) * (R.MATE_SCORE - Math.abs(out.eval.best));
      else out.follow.startCp = out.eval.best;
    }
  }

  /* Themes and words, always — not only when the line was repaired. Both are
     derived from the record, both changed shape in this rewrite, and a track
     that is re-verified should come back consistent with the tool that did it
     rather than half in the old vocabulary. */
  out.themes = G.themesFor(out);

  /* The human half of the standard, asked last because it needs the final
     line and the final themes: a solution that was repaired may be a move
     shorter than the one that came in, and a puzzle that is now over in one
     move is exactly the shape this rejects. Costs no search — it reads the
     board — so it is asked of every record on every run. */
  const easy = R.obvious(out);
  if (easy){
    note.dropped = easy;
    return { puzzle: null, note };
  }

  /* Words last, and only once the line is locked. Everything the card says is
     derived from the final moves, the final score and the final follow-up —
     writing it any earlier is how a card ends up describing the line it was
     going to have. Then every promise in it is checked against the board the
     line actually reaches, and anything that cannot be justified is struck. */
  out.why = WORDS.explain(out);
  note.struck = WORDS.auditClaims(out);
  return { puzzle: out, note };
}

/* ------------------------------------------------------------------ main */

/** A line in the notation a person reads, for the report. UCI is what the file
    stores and what puzzleStep() compares against, so both are printed: one to
    understand the change, one to grep for it. */
function lineSan(fen, moves){
  let st = P.stateFromFEN(fen);
  const out = [];
  for (const u of moves){
    const all = P.legalMoves(st, st.turn);
    const m = all.find(x => P.uciOf(x) === u);
    if (!m) break;
    out.push(P.toSAN(st, m, all));
    st = P.makeMove(st, m);
  }
  return out.join(' ');
}

/* Put the ladder back in difficulty order.
 *
 * A track promises that puzzle 1 is easier than puzzle 100, and a corrected
 * puzzle is rarely as hard as the one it replaced: a seven-move line that only
 * worked because the defence blundered collapses to one move once the defence
 * is fixed. The key is the generator's own difficulty(), so a re-ranked track
 * is ranked the way it was built — with the settle depth measured by the sweep,
 * which is the one ingredient a shipped file does not carry.
 *
 * Rungs move; nobody's progress does. Progress is stored per puzzle id, and an
 * id only changes when the line it hashes did. Returns how many rungs moved. */
function resort(puzzles, settleOf){
  const was = new Map(puzzles.map(p => [p, p.n]));
  const key = new Map(puzzles.map(p =>
    [p, G.difficulty(Object.assign({}, p, { settleDepth: settleOf(p) }))]));
  puzzles.sort((a, b) => key.get(a) - key.get(b) || String(a.id).localeCompare(String(b.id)));
  let moved = 0;
  puzzles.forEach((p, i) => { if (was.get(p) !== i + 1) moved++; p.n = i + 1; });
  return moved;
}

function parseArgs(argv){
  const cfg = Object.assign({}, DEFAULTS);
  for (let i = 0; i < argv.length; i++){
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    // --no-reseed / --no-resort turn off the two things that are switched on
    // by being named, which a bare --flag has no way of saying
    if (a.startsWith('--no-')){
      const off = ALIASES[a.slice(5)] || a.slice(5);
      if (typeof cfg[off] !== 'boolean') throw new Error('unknown option ' + a);
      cfg[off] = false;
      continue;
    }
    const k = ALIASES[a.slice(2)] || a.slice(2);
    if (!(k in cfg)) throw new Error('unknown option --' + k);
    if (typeof cfg[k] === 'boolean') cfg[k] = true;
    else if (typeof cfg[k] === 'number') cfg[k] = +argv[++i];
    else cfg[k] = argv[++i];
  }
  // --dry is the older way of saying "report only", which is now the default;
  // it stays because the docs and the shell history are full of it.
  if (cfg.dry) cfg.write = false;
  return cfg;
}


/* ------------------------------------------------- durable per-puzzle results
 *
 * One line of JSON per finished puzzle, appended the moment it lands. That is
 * the whole mechanism, and it is deliberately the dullest possible one: an
 * append to a text file is atomic enough for whole lines, needs no schema, and
 * a half-written last line is simply skipped on the way back in.
 *
 * It exists because a five-hour stage that keeps everything in memory and
 * writes once at the end is a stage where a single slow puzzle can cost the
 * other three hundred. Resuming reads the file, keeps the results it finds and
 * asks the engine only about what is missing.
 */
const progressFile = file => file + '.progress.jsonl';

/** What has already been verified, by puzzle id. */
function loadProgress(file){
  const out = new Map();
  let text = '';
  try { text = fs.readFileSync(progressFile(file), 'utf8'); } catch (e){ return out; }
  for (const line of text.split('\n')){
    if (!line.trim()) continue;
    let rec = null;
    // a run killed mid-write leaves one ragged line; it is not an error, it is
    // simply the puzzle that did not finish
    try { rec = JSON.parse(line); } catch (e){ continue; }
    if (rec && rec.id) out.set(rec.id, rec);
  }
  return out;
}

/** Record one finished puzzle. Synchronous on purpose: the point is that it is
    on disk before the next search begins. */
function saveProgress(file, id, r){
  fs.appendFileSync(progressFile(file),
    JSON.stringify({ id, puzzle: r.puzzle, note: r.note }) + '\n');
}

/** Which of these still need the engine. */
const pending = (list, done) => list.filter(p => !done.has(p.id));

/* A puzzle may not run away with the machine.
 *
 * The budget is a *rejection* rule and nothing else: a puzzle that exceeds it
 * is dropped as pathological. It is never accepted on a partial check, and the
 * search is never shortened or shallowed to fit — the engine is abandoned
 * mid-search and the puzzle leaves the track. Anything that ships has met the
 * full standard at the full depth. */
async function withBudget(fn, seconds, engine){
  if (!seconds) return fn();
  let timer = null;
  const bell = new Promise(resolve => {
    timer = setTimeout(() => { engine.abandon(); resolve('timeout'); }, seconds * 1000);
  });
  try {
    const r = await Promise.race([fn().catch(e => ({ __err: e })), bell]);
    if (r === 'timeout' || (r && r.__err)) return null;
    return r;
  } finally {
    clearTimeout(timer);
    engine.release();
  }
}

async function main(){
  const cfg = parseArgs(process.argv.slice(2));
  /* One queue, however many tracks. Verifying a track at a time means the tail
     of one leaves every engine idle while the next waits its turn; sharing the
     queue lets them carry on. Each track still keeps its own file, its own
     progress log and its own report. */
  const names = (cfg.tracks ? cfg.tracks.split(',') : [cfg.track]).map(s => s.trim());
  const books = names.map(name => {
    const f = (cfg.file && names.length === 1) ? cfg.file : path.join(cfg.dir, name + '.json');
    const all = JSON.parse(fs.readFileSync(f, 'utf8'));
    return { name, file: f, all: cfg.limit ? all.slice(0, cfg.limit) : all };
  });
  for (const b of books){
    b.done = cfg.progress ? loadProgress(b.file) : new Map();
    b.todo = pending(b.all, b.done);
    console.log(b.name + ': ' + b.all.length + ' puzzles' +
                (b.done.size ? '  (' + b.done.size + ' already verified, resuming)' : '') +
                (cfg.write ? '' : '  (report only; --write to repair in place)'));
  }
  const queue = [];
  for (const b of books) for (const p of b.todo) queue.push({ b, p });

  /* Two pools. The native one judges; the WASM one is only ever asked to
     imitate a rung of the bot ladder for seedRating(), because a difficulty
     rating measured against an engine the player never meets is a rating of
     nobody. They are paired by engine slot so a worker always uses its own. */
  const pool = new Pool(cfg.jobs, {
    native: true, threads: cfg.threads, hash: cfg.hash, wdl: true
  });
  const rungs = new Pool(cfg.jobs);
  await pool.engines[0].ready;
  console.log('  judge: ' + (pool.engines[0].id || 'unknown') +
              '  ·  ' + cfg.jobs + ' engines x ' + cfg.threads + ' threads x ' + cfg.hash + 'MB' +
              '  ·  sweep ' + cfg.sweep + ', work ' + cfg.depth +
              ', verdict ' + cfg.verdictDepth + ', tie-break ' + cfg.deepDepth +
              ', follow-up ' + cfg.followDepth);
  if (cfg.budget)
    console.log('  budget: ' + Math.round(cfg.budget / 60) + ' min per puzzle — over that it is ' +
                'rejected as pathological, never accepted');
  const started = Date.now();
  let done = 0;
  await pool.map(queue, async (item, engine) => {
    const r = await withBudget(
      () => verifyOne(item.p, engine, cfg, rungs.engines[engine.slot]),
      cfg.budget, engine);
    /* A puzzle that ran out of budget, or whose verification threw, is dropped.
       It is never accepted: nothing reaches the file without having been
       checked all the way through at the full depth. */
    const out = r || { puzzle: null, note: { n: item.p.n, id: item.p.id,
                                             dropped: 'verification timeout', notes: [] } };
    done++;
    if (cfg.progress) saveProgress(item.b.file, item.p.id, out);
    item.b.done.set(item.p.id, out);
    const mark = out.note.dropped ? 'd' : out.note.failed ? 'x'
               : out.note.repaired ? (out.note.soft ? 's' : 'r') : '.';
    process.stdout.write(mark + (done % 50 ? '' : ' ' + done + '\n'));
  });
  pool.quit();
  rungs.quit();
  process.stdout.write('\n');

  /* Report and write, one track at a time. The queue was shared; the files
     are not, and neither are the ladders — each track is ordered and numbered
     on its own. Results come from the progress map, so a resumed run reports
     on everything it has, not only on what this process happened to do. */
  console.log('checked ' + done + ' in ' + Math.round((Date.now() - started) / 1000) + 's' +
              (done < queue.length ? '  (' + (queue.length - done) + ' not reached)' : ''));

  for (const b of books){
    const results = b.all.map(p => b.done.get(p.id)).filter(Boolean);
    const kept = results.filter(r => r.puzzle);
    const dropped = results.filter(r => r.note.dropped);
    const repaired = kept.filter(r => r.note.repaired);
    const failed = results.filter(r => r.note.failed);
    const soft = repaired.filter(r => r.note.soft);
    console.log('');
    console.log('=== ' + b.name + ': ' + results.length + ' of ' + b.all.length + ' ===');
    console.log('  held up : ' + (kept.length - repaired.length));
    console.log('  repaired: ' + repaired.length + ' (' + soft.length + ' no longer sharp)');
    console.log('  dropped : ' + dropped.length);
    console.log('  failed  : ' + failed.length);
    if (dropped.length){
      const why = {};
      for (const r of dropped) why[r.note.dropped] = (why[r.note.dropped] || 0) + 1;
      for (const [w, n] of Object.entries(why).sort((a, b) => b[1] - a[1]))
        console.log('    ' + w.padEnd(22) + String(n).padStart(4) + '   ' +
                    dropped.filter(r => r.note.dropped === w).map(r => '#' + r.note.n).join(' '));
    }
    const grew = kept.filter(r => r.note.grew);
    if (grew.length){
      const plies = grew.reduce((n, r) => n + (r.note.grew.to - r.note.grew.from), 0);
      console.log('  extended: ' + grew.length + ' lines carried on to their payoff (+' +
                  plies + ' plies in all)');
    }
    const struck = kept.reduce((n, r) => n + ((r.note.struck || []).length), 0);
    if (struck){
      console.log('  claims struck from explanations: ' + struck);
      const why = {};
      for (const r of kept) for (const c of r.note.struck || []) why[c.why] = (why[c.why] || 0) + 1;
      for (const [k, n] of Object.entries(why).sort((a, b) => b[1] - a[1]))
        console.log('    ' + String(n).padStart(4) + '  ' + k);
    }
    const punish = kept.filter(r => r.note.kind === 'punish').length;
    console.log('  kinds   : ' + punish + ' punish, ' + (kept.length - punish) + ' save');
    const dull = kept.filter(r => (r.note.notes || []).some(n => /:dull/.test(n)));
    console.log('  dull    : ' + dull.length + ' (still the best move, no longer ' +
                R.GAP_MIN + 'cp clear at the sweep depth)');
    for (const r of repaired)
      console.log('  #' + r.note.n + ' WRONG  ' + r.note.why +
                  '\n         was ' + lineSan(r.puzzle.fen, r.note.was) +
                  '\n         now ' + lineSan(r.puzzle.fen, r.puzzle.moves));
    for (const r of failed) console.log('  #' + r.note.n + ' FAILED ' + r.note.failed);

    if (cfg.report)
      fs.writeFileSync(cfg.report.replace('{track}', b.name),
                       JSON.stringify(results.map(r => r.note), null, 1) + '\n');

    if (cfg.write){
      /* A repaired puzzle is a different puzzle — new line, new motifs, new id
         — but the same rung of the same ladder. A *dropped* one leaves a hole
         and the ladder closes over it: a track is however many puzzles cleared
         the standard. Ids are untouched, so nobody loses a solve; only their
         place in the numbering moves. Written only when every puzzle in the
         track has an answer, so an interrupted run leaves the file alone and
         its progress log carries what it did. */
      if (results.length < b.all.length){
        console.log('  not written: ' + (b.all.length - results.length) +
                    ' puzzles still unverified (progress is on disk; re-run to resume)');
        continue;
      }
      let out = results.map(r => r.puzzle).filter(Boolean);
      if (out.length !== b.all.length)
        console.log('  ' + (b.all.length - out.length) + ' rungs removed; the track is now ' +
                    out.length + ' long');
      if (cfg.resort && !cfg.limit){
        const settle = new Map(results.filter(r => r.puzzle).map(r => [r.puzzle, r.note.settle]));
        const moved = resort(out, p => settle.get(p));
        console.log('  ' + moved + ' of ' + out.length + ' rungs renumbered to keep the ladder' +
                    ' in difficulty order (ids, and so progress, are untouched)');
      } else {
        out.forEach((p, i) => { p.n = i + 1; });
      }
      fs.writeFileSync(b.file, JSON.stringify(out, null, 1) + '\n');
      console.log('  wrote ' + b.file);
      noteInReadme(Object.assign({}, cfg, { track: b.name, file: b.file }), results);
    }
  }
}

/* What was checked, and when, written where the set describes itself.
 *
 * The section is delimited and rewritten in place, one entry per track, so
 * running the tool twice does not leave two accounts of the same track. A
 * regeneration overwrites the whole README and takes this with it, which is
 * the right outcome: a new set has not been checked. */
function noteInReadme(cfg, results){
  // beside the file that was checked, which is not cfg.dir when --file names
  // one somewhere else: a smoke test on a copy in /tmp should not rewrite the
  // record of what shipped
  const readme = path.join(cfg.file ? path.dirname(cfg.file) : cfg.dir, 'README.md');
  let text;
  try { text = fs.readFileSync(readme, 'utf8'); } catch (e){ return; }

  const kept = results.filter(r => r.puzzle);
  const repaired = kept.filter(r => r.note.repaired);
  const dropped = results.filter(r => r.note.dropped);
  const dull = kept.filter(r => (r.note.notes || []).some(n => /:dull/.test(n)));
  const withFollow = kept.filter(r => r.puzzle.follow && r.puzzle.follow.moves.length);
  const row = '| `' + cfg.track + '` | ' + new Date().toISOString().slice(0, 10) + ' | ' +
    cfg.verdictDepth + ' | ' + kept.length + ' | ' + repaired.length + ' | ' +
    dropped.length + ' | ' + dull.length + ' | ' + withFollow.length + ' |';

  const head = '<!-- verified: begin -->';
  const foot = '<!-- verified: end -->';
  const preamble = [
    head, '',
    '## Checked against the engine', '',
    'Written by `tools/verify_puzzles.js`, which replays every move of every',
    'puzzle in a track, rebuilds any line the engine no longer agrees with, and',
    'then asks of the whole thing the question a per-ply check cannot: is this',
    'still a turning point? The row is the **last run**, not a history — see the',
    'git history for what changed. *Depth* is the verdict depth. *Repaired*',
    'counts lines rewritten because a move was not the engine\'s. *Dropped*',
    'counts puzzles removed because the position was not one worth showing —',
    'nobody had blundered, the solver was already winning, the solver was lost',
    'either way, or two moves were equally good. *Dull* puzzles are still the',
    'best move but no longer clear of the runner-up at the sweep depth, which is',
    'reported and left alone. *Follow-up* counts the puzzles carrying a',
    'continuation for the Show Follow Up button — a line that ends in mate has',
    'none.', '',
    '| Track | Checked | Depth | Puzzles | Repaired | Dropped | Dull | Follow-up |',
    '|---|---|---|---|---|---|---|---|'
  ].join('\n');

  const at = text.indexOf(head), end = text.indexOf(foot);
  let rows = [];
  if (at >= 0 && end > at){
    rows = text.slice(at, end).split('\n')
               .filter(l => /^\| `/.test(l) && l.indexOf('| `' + cfg.track + '` |') !== 0);
    text = text.slice(0, at).replace(/\s+$/, '\n') + text.slice(end + foot.length);
  }
  rows.push(row);
  rows.sort();
  fs.writeFileSync(readme, text.replace(/\s*$/, '\n\n') +
                   preamble + '\n' + rows.join('\n') + '\n\n' + foot + '\n');
  console.log('noted in ' + readme);
}

module.exports = {
  walk, rank, audit, extendFrom, followUp, scoreAfter, scoreOf, bestOf, lineSan,
  loadProgress, saveProgress, pending, progressFile, withBudget,
  checkSolverPly, checkReplyPly, resort, parseArgs, DEFAULTS
};

if (require.main === module) main().catch(err => { console.error(err); process.exit(1); });
