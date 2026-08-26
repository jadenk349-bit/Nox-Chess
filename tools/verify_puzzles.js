#!/usr/bin/env node
/* Marking the puzzles' own homework — and writing the follow-up.
 *
 * tools/generate_puzzles.js decides what a puzzle is, mining a track at depth
 * 12/16 while it is playing hundreds of games. This tool goes back over a
 * finished file, one puzzle at a time and at a deeper setting, and asks whether
 * every claim in it is still true:
 *
 *   - each of the solver's moves is still the engine's best move there;
 *   - each of the defence's moves is still the engine's best defence, because
 *     a line answered by a blunder proves nothing about the moves after it.
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
 * Whatever fails is not deleted, it is rebuilt: the line is cut at the ply the
 * engine will not sign, the engine's own move is put there, and it is extended
 * by the same rules the generator used — best defence, ask again, stop when the
 * position is no longer sharp. A track is a hundred rungs and has to stay a
 * hundred rungs. Repairing changes the line, so the id (a hash of the position
 * and the line) and the seed rating are recomputed with it.
 *
 * What the tool will not do is rewrite a correct solution for being *dull* —
 * still the best move, no longer 150cp clear of the runner-up at this depth.
 * Sharpness is how the generator chose the position; it is not a claim the file
 * makes to the player, and a run that rewrote it would be undone by the next
 * run at the next depth. Dull puzzles are counted and reported instead.
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
 *   node tools/verify_puzzles.js --track opening                 # report only
 *   node tools/verify_puzzles.js --track middlegame --write      # repair in place
 *   node tools/verify_puzzles.js --track opening --followup 6 --write
 */

'use strict';

const fs = require('fs');
const path = require('path');

const P = require('./page_chess.js');
const { Pool } = require('./sf.js');
const G = require('./generate_puzzles.js');

const DEFAULTS = {
  track: 'middlegame',
  jobs: Math.max(1, Math.min(12, require('os').cpus().length - 2)),
  dir: path.join(__dirname, '..', 'puzzles'),
  file: '',           // an explicit file, when it is not dir/track.json
  // Deeper than the generator on purpose. Re-asking at the depth that wrote
  // the file would mostly re-read it back; the point is a second opinion.
  sweep: 20,          // the cheap pass over every ply, which only nominates
  multipv: 5,         // how wide the sweep looks
  depth: 18,          // the head-to-head on anything the sweep nominated
  replyDepth: 18,     // the defence
  deepDepth: 26,      // the verdict: the only thing allowed to call a move wrong
  followDepth: 16,    // the follow-up, where nothing is being decided any more
  gap: 150,           // centipawns the best move must beat the second best by
  maxPlies: 7,        // solution length cap, always odd: a puzzle ends on your move
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
  write: false,       // nothing is written unless it is asked for
  dry: false,         // the same thing said the other way round
  limit: 0,           // 0 = the whole track; a number checks the first n, for a smoke test
  report: ''
};

// --followup is the same knob as --follow, because both halves of this tool
// were written under their own name before they were one tool.
const ALIASES = { followup: 'follow', followUp: 'follow' };

const MATE_SCORE = G.MATE_SCORE || 10000;
const uciFind = G.uciFind;

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
const scoreOf = l => G.lineScore(l);

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
    fen, moves, multipv: 1, depth: depth || cfg.depth, fresh: true
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
    fen, moves: prefix, multipv: cfg.multipv, depth, fresh: true
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
    loss: best - got,
    gap: second ? best - scoreOf(second) : null,
    sharp: !!G.candidateFrom(res, cfg.gap),
    // a position already won without finding anything is a different complaint
    // from a narrow gap, and only the second says the answer is ambiguous
    won: !!second && scoreOf(second) >= G.ALREADY_WON,
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
    fen, moves: prefix, multipv: 2, depth: depth || cfg.depth, fresh: true
  });
  const lines = (res.lines || []).filter(Boolean);
  const top = lines[0], second = lines[1];
  if (!top || !top.best) return { ok: false, why: 'no-answer', best: null };
  const gap = second ? scoreOf(top) - scoreOf(second) : null;
  const sharp = !!G.candidateFrom(res, cfg.gap);
  const won = !!second && scoreOf(second) >= G.ALREADY_WON;
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
    fen, moves: prefix, multipv: 1, depth: depth || cfg.replyDepth, fresh: true
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
  const two = await engine.ask({ fen, moves, multipv: 2, depth: cfg.depth, fresh: true });
  const cand = G.candidateFrom(two, cfg.gap);
  const top = (two.lines || [])[0];
  let pick = cand ? cand.best : (top && top.best);
  if (!pick) return null;
  const one = await engine.ask({ fen, moves, multipv: 1, depth: cfg.depth, fresh: true });
  const alt = one.best || ((one.lines || [])[0] || {}).best;
  if (alt && alt !== pick){
    const by = await betterBy(engine, fen, moves, pick, alt, cfg);
    if (by !== null && by > cfg.tie) pick = alt;
  }
  return { best: pick, sharp: !!cand };
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

  for (;;){
    if (gameOver(st)) break;                                   // mate delivered
    if (G.materialSwing(fen, st) >= G.CLEAR_WIN) break;        // a clear material win
    if (moves.length + 2 > cfg.maxPlies) break;
    const reply = await engine.ask({ fen, moves, depth: cfg.replyDepth, fresh: true });
    if (!reply.best) break;
    const rm = uciFind(st, reply.best);
    if (!rm) break;
    const next = P.makeMove(st, rm);
    if (gameOver(next)) break;                                 // the defence walked into mate
    const look = await pickSolver(engine, fen, moves.concat([reply.best]), cfg);
    if (!look || !look.sharp) break;                           // no longer one strong move
    const pm = uciFind(next, look.best);
    if (!pm) break;
    moves.push(reply.best, look.best);
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
      fen, moves: moves.concat(line), depth: cfg.followDepth, fresh: true
    });
    if (!res.best) break;
    const m = uciFind(st, res.best);
    if (!m) break;
    line.push(res.best);
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
      fen, moves: moves.concat(line), depth: cfg.followDepth, fresh: true
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
  const at = await engine.ask({ fen, multipv: 1, depth: cfg.followDepth, fresh: true });
  const head = (at.lines || [])[0] || at;
  if (head.mate !== null && head.mate !== undefined) out.startMate = head.mate;
  else if (head.cp !== null && head.cp !== undefined) out.startCp = head.cp;
  return out;
}

/* ------------------------------------------------------------ one puzzle */

/* Every ply of one solution, swept cheaply and then, where the sweep and the
   file disagree at all, judged slowly. Returns the first ply the engine will
   not sign, or -1 when it signs all of them. */
async function audit(engine, p, cfg){
  const fen = p.fen;
  const solver = P.stateFromFEN(fen).turn;
  const notes = [];
  let st = P.stateFromFEN(fen);

  for (let i = 0; i < p.moves.length; i++){
    if (!st || gameOver(st)) return { at: i, why: 'line-over', notes };
    const played = p.moves[i];
    if (!uciFind(st, played)) return { at: i, why: 'illegal', notes };
    const prefix = p.moves.slice(0, i);
    const mine = st.turn === solver;
    const where = (mine ? 'solution' : 'defence') + ' ply ' + i + ': ';

    // 1. the sweep, which only nominates: nothing below this line trusts it
    const quick = await rank(engine, fen, prefix, played, cfg.sweep, cfg);
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
        at: i, top: r.best, notes,
        why: where + 'file plays ' + played + ', engine plays ' + (r.best || '?') +
             ' (' + r.why + (r.by === null || r.by === undefined ? ''
                                                                 : ', ' + Math.round(r.by) + 'cp worse') + ')'
      };
    st = P.makeMove(st, uciFind(st, played));
  }
  return { at: -1, why: '', notes };
}

async function verifyOne(p, engine, cfg){
  const note = { n: p.n, id: p.id, repaired: false, soft: false, notes: [] };
  const fen = p.fen;
  const st0 = P.stateFromFEN(fen);

  const found = await audit(engine, p, cfg);
  note.notes = found.notes;

  let moves = p.moves;
  if (found.at >= 0){
    // Rebuild from the last position that held up. The engine's own move goes
    // in where the file's was, and extendFrom() keeps going for as long as the
    // position is still a puzzle.
    const rebuilt = await extendFrom(engine, fen, p.moves.slice(0, found.at), cfg, found.top);
    if (!rebuilt || !rebuilt.moves.length || rebuilt.moves.length % 2 === 0){
      note.failed = found.why || 'no-line';
      return { puzzle: p, note };
    }
    moves = rebuilt.moves;
    note.repaired = true;
    note.soft = rebuilt.soft;
    note.why = found.why;
    note.wasBad = { ply: found.at, played: p.moves[found.at], engine: found.top || null };
    note.was = p.moves.slice();
  }

  const out = Object.assign({}, p, { moves });
  if (note.repaired){
    // The id is a hash of the position and its line, so a repaired puzzle is a
    // different puzzle and says so; progress is stored by id, and somebody who
    // solved the broken line has not solved this one.
    out.id = G.puzzleId(G.bucketFor(st0.full), fen, moves);
    out.themes = G.themesFor(fen, moves);
    // The rating is what the ladder is sorted by and what the Elo update
    // scores against, and it was measured on the old first move. seedRating()
    // is the generator's own cold start, exported rather than copied so that a
    // repaired rung is priced exactly the way the ladder was.
    if (moves[0] !== p.moves[0]){
      out.seedRating = await G.seedRating(engine, fen, moves[0]);
      note.seedRating = out.seedRating;
    }
  }
  if (cfg.follow > 0){
    out.follow = await followUp(engine, fen, out.moves, cfg);
    // an older run of this tool stored the line on its own, under its own name;
    // leaving it beside a freshly measured one would be two answers to the same
    // question, and the page would read the newer one and never say so
    delete out.followUp;
    note.follow = out.follow ? out.follow.moves.length : 0;
  }
  return { puzzle: out, note };
}

/* ------------------------------------------------------------------ main */

function parseArgs(argv){
  const cfg = Object.assign({}, DEFAULTS);
  for (let i = 0; i < argv.length; i++){
    const a = argv[i];
    if (!a.startsWith('--')) continue;
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

async function main(){
  const cfg = parseArgs(process.argv.slice(2));
  const file = cfg.file || path.join(cfg.dir, cfg.track + '.json');
  const all = JSON.parse(fs.readFileSync(file, 'utf8'));
  const list = cfg.limit ? all.slice(0, cfg.limit) : all;
  console.log(cfg.track + ': ' + list.length + ' puzzles, sweep ' + cfg.sweep +
              ', verdict ' + cfg.deepDepth + ', ' + cfg.jobs + ' engines' +
              (cfg.write ? '' : ' (report only; --write to repair in place)'));

  const pool = new Pool(cfg.jobs);
  const started = Date.now();
  let done = 0;
  const results = await pool.map(list, async (p, engine) => {
    const r = await verifyOne(p, engine, cfg);
    done++;
    const mark = r.note.failed ? 'x' : r.note.repaired ? (r.note.soft ? 's' : 'r') : '.';
    process.stdout.write(mark + (done % 50 ? '' : ' ' + done + '\n'));
    return r;
  });
  pool.quit();
  process.stdout.write('\n');

  const repaired = results.filter(r => r.note.repaired);
  const failed = results.filter(r => r.note.failed);
  const soft = repaired.filter(r => r.note.soft);
  console.log('checked ' + results.length + ' in ' +
              Math.round((Date.now() - started) / 1000) + 's');
  console.log('  held up : ' + (results.length - repaired.length - failed.length));
  console.log('  repaired: ' + repaired.length + ' (' + soft.length + ' no longer sharp)');
  console.log('  failed  : ' + failed.length);
  // reported, never rewritten: see the header
  const dull = results.filter(r => (r.note.notes || []).some(n => /:dull/.test(n)));
  console.log('  dull    : ' + dull.length + ' (still the best move, no longer 150cp clear)');
  if (dull.length) console.log('    ' + dull.map(r => '#' + r.note.n).join(' '));
  for (const r of results)
    for (const n of r.note.notes || []) console.log('  #' + r.note.n + ' note   ' + n);
  for (const r of repaired)
    console.log('  #' + r.note.n + ' WRONG  ' + r.note.why +
                '\n         was [' + r.note.was.join(' ') + ']' +
                '\n         now [' + r.puzzle.moves.join(' ') + ']');
  for (const r of failed) console.log('  #' + r.note.n + ' FAILED ' + r.note.failed);

  if (cfg.report)
    fs.writeFileSync(cfg.report, JSON.stringify(results.map(r => r.note), null, 1) + '\n');
  if (cfg.write){
    /* Written back in place, rung for rung. A repaired puzzle is a different
       puzzle — new line, new motifs, new id — but it is the same rung of the
       same ladder, because a track is a hundred and thinning it is not a
       repair. */
    const out = all.slice();
    results.forEach((r, i) => { out[i] = r.puzzle; });
    fs.writeFileSync(file, JSON.stringify(out, null, 1) + '\n');
    console.log('wrote ' + file);
    noteInReadme(cfg, results);
  }
}

/* What was checked, and when, written where the set describes itself.
 *
 * The section is delimited and rewritten in place, one entry per track, so
 * running the tool twice does not leave two accounts of the same track. A
 * regeneration overwrites the whole README and takes this with it, which is
 * the right outcome: a new set has not been checked. */
function noteInReadme(cfg, results){
  const readme = path.join(cfg.dir, 'README.md');
  let text;
  try { text = fs.readFileSync(readme, 'utf8'); } catch (e){ return; }

  const repaired = results.filter(r => r.note.repaired);
  const dull = results.filter(r => (r.note.notes || []).some(n => /:dull/.test(n)));
  const withFollow = results.filter(r => r.puzzle.follow && r.puzzle.follow.moves.length);
  const row = '| `' + cfg.track + '` | ' + new Date().toISOString().slice(0, 10) + ' | ' +
    cfg.deepDepth + ' | ' + results.length + ' | ' + repaired.length + ' | ' +
    dull.length + ' | ' + withFollow.length + ' |';

  const head = '<!-- verified: begin -->';
  const foot = '<!-- verified: end -->';
  const preamble = [
    head, '',
    '## Checked against the engine', '',
    'Written by `tools/verify_puzzles.js`, which replays every move of every',
    'puzzle in a track and rebuilds any line the engine no longer agrees with.',
    'The row is the **last run**, not a history: *repaired* counts what that run',
    'rewrote, and a second run over a file already checked rewrites nothing — see',
    'the git history for what changed. *Depth* is the verdict depth, the only one',
    'allowed to call a move wrong. *Dull* puzzles are still the best move but',
    'no longer beat the runner-up by 150cp at that depth, which is reported and',
    'left alone. *Follow-up* counts the puzzles carrying a continuation for the',
    'Show Follow Up button — a line that ends in mate has none.', '',
    '| Track | Checked | Depth | Puzzles | Repaired | Dull | Follow-up |',
    '|---|---|---|---|---|---|---|'
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
  walk, rank, audit, extendFrom, followUp, scoreAfter, scoreOf,
  checkSolverPly, checkReplyPly, parseArgs, DEFAULTS
};

if (require.main === module) main().catch(err => { console.error(err); process.exit(1); });
