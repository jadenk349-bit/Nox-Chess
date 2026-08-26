#!/usr/bin/env node
/* Auditing a shipped ladder, move by move, against the engine.
 *
 * generate_puzzles.js decides what a puzzle is; this asks, afterwards and at a
 * deeper setting, whether the answer written in the file is still the answer.
 * The two questions are different. The generator judges a position once, at
 * confirmDepth, and then splices its own best defence in and judges again — so
 * every ply of a shipped solution was chosen by a search that had only just
 * arrived at it. A slow look from outside can disagree, and where it does the
 * file is wrong: the player is being told to play a move the engine does not
 * play, and the referee in the page will accept nothing else.
 *
 * Both colours are audited, for the same reason. The solver's move has to be
 * the move; the defence spliced between the solver's moves has to be the best
 * defence, because a puzzle whose opponent walks into it teaches a tactic that
 * is not there.
 *
 * What it does about a disagreement is rebuild rather than delete. The line is
 * cut at the first ply the engine will not sign, the engine's own move is put
 * there, and the line is extended exactly the way the generator extends one —
 * best defence, ask again, stop when the position is no longer sharp. A track
 * is a hundred rungs and has to stay a hundred rungs, so a puzzle is repaired
 * in place and keeps its rung.
 *
 *   node tools/verify_puzzles.js --track opening               # report only
 *   node tools/verify_puzzles.js --track opening --write       # repair in place
 *   node tools/verify_puzzles.js --track opening --followup 6 --write
 */

'use strict';

const fs = require('fs');
const path = require('path');

const P = require('./page_chess.js');
const { Pool } = require('./sf.js');
const G = require('./generate_puzzles.js');

const DEFAULTS = {
  track: 'opening',
  // Two depths, because one is either too slow to run over a whole track or
  // too shallow to be believed. The sweep is cheap and only has to notice that
  // the engine would play something else; the verdict is slow and is the only
  // thing allowed to call a move wrong. A single pass at depth 22 called six
  // of these hundred wrong and a look at depth 26 agreed with the file on five
  // of the six — a sweep that decides is a sweep that rewrites good puzzles.
  sweep: 20,
  verdict: 28,
  // The repair searches, deeper than the generator's confirmDepth of 16 but
  // not as deep as a verdict: it is asked once per ply of a rebuilt line.
  depth: 24,
  multipv: 5,
  jobs: Math.max(1, Math.min(12, require('os').cpus().length - 2)),
  // How far the puzzle's own move may fall short of the engine's before the
  // line is cut. Not zero: two roads to the same won ending are both "the
  // answer" and the file is allowed to have picked either.
  tol: 50,
  // The defence is held to a looser standard than the solve. It only has to be
  // a real try; the solver's move has to be the move.
  defTol: 100,
  maxPlies: 7,
  gap: 150,
  followup: 0,          // plies of engine-best continuation to store, 0 = none
  write: false,
  file: ''
};

const MATE = 10000;
const uciFind = (st, u) => P.legalMoves(st, st.turn).find(x => P.uciOf(x) === u) || null;
const lineScore = G.lineScore;

/** The position a prefix of a solution leads to. */
function after(fen, moves){
  let st = P.stateFromFEN(fen);
  for (const u of moves){
    const m = uciFind(st, u);
    if (!m) return null;
    st = P.makeMove(st, m);
  }
  return st;
}

/* What the engine thinks of a move it did not pick, when the move is so far
   down the list that MultiPV never ranked it. Asked as a fresh search of the
   position the move leads to and then negated. Second best, and only used as a
   fallback: a score from one search held up against a score from another is
   worth about half a pawn of noise, which is most of what this tool is trying
   to measure. */
async function scoreOf(engine, fen, moves, depth){
  const res = await engine.ask({ fen, moves, depth });
  const s = lineScore(res.lines[0] || res);
  if (s === null || s === undefined){
    // no legal move: the side to move is mated or stalemated
    const st = after(fen, moves);
    if (!st) return null;
    return P.inCheck(st, st.turn) ? -MATE : 0;
  }
  return -s;                       // that search spoke for the other side
}

/* One ply, ranked. The comparison that matters happens *inside* one search:
   the file's move is looked for among the MultiPV lines and its score is read
   off there, so the two numbers being subtracted came out of the same tree at
   the same depth. Only when the move is not ranked at all does it fall back to
   a search of its own, and then with a lot of room for the noise that costs. */
async function rank(engine, p, i, depth, cfg){
  const prefix = p.moves.slice(0, i);
  const res = await engine.ask({ fen: p.fen, moves: prefix, multipv: cfg.multipv, depth });
  const top = res.lines[0];
  if (!top || !top.best) return null;
  const mine = res.lines.find(l => l && l.best === p.moves[i]);
  const best = lineScore(top);
  let got = mine ? lineScore(mine) : null;
  let ranked = !!mine;
  if (got === null){
    got = await scoreOf(engine, p.fen, prefix.concat([p.moves[i]]), depth);
    ranked = false;
  }
  if (best === null || got === null) return null;
  return {
    top: top.best, best, got, ranked,
    loss: best - got,
    // A mate that is found and a mate that is missed are not a few centipawns
    // apart, but the arithmetic says they are when the missed one still wins a
    // rook. Asked separately: if the engine mates, the file has to.
    mateMissed: top.mate > 0 && got < MATE - 100
  };
}

/* Every ply of one solution, swept cheaply and then, where the sweep and the
   file disagree at all, judged slowly. Returns the index of the first ply the
   engine will not sign, or -1 when it signs all of them. */
async function audit(engine, p, cfg){
  const notes = [];
  for (let i = 0; i < p.moves.length; i++){
    const st = after(p.fen, p.moves.slice(0, i));
    if (!st || !uciFind(st, p.moves[i]))
      return { at: i, why: 'illegal move ' + p.moves[i], notes };

    const quick = await rank(engine, p, i, cfg.sweep, cfg);
    if (!quick || quick.top === p.moves[i]) continue;   // the engine plays it too

    const solver = i % 2 === 0;
    // the sweep only nominates; nothing below this line trusts it
    const slow = await rank(engine, p, i, cfg.verdict, cfg);
    if (!slow) continue;
    const where = (solver ? 'solution' : 'defence') + ' ply ' + i + ': ';
    if (slow.top === p.moves[i]){
      notes.push(where + p.moves[i] + ' is best at depth ' + cfg.verdict +
                 ' and not at depth ' + cfg.sweep);
      continue;
    }
    const tol = (solver ? cfg.tol : cfg.defTol) * (slow.ranked ? 1 : 3);
    if (slow.loss < tol && !slow.mateMissed){
      notes.push(where + p.moves[i] + ' is not ' + slow.top +
                 ' but only by ' + Math.round(slow.loss) + 'cp');
      continue;
    }
    return {
      at: i,
      top: slow.top,
      why: where + 'file plays ' + p.moves[i] + ', engine plays ' + slow.top +
           (slow.mateMissed ? ' (mate in ' + cfg.verdict + ' missed)'
                            : ' (' + Math.round(slow.loss) + 'cp worse)'),
      notes
    };
  }
  return { at: -1, why: '', notes };
}

/* ---- repair ----
   buildLine() from the generator, kept here rather than imported because that
   one is not exported and because this one starts from a line already in
   progress rather than from a single move. Same rules: the engine's own best
   defence goes in, the position is asked again, and the line stops when there
   is no longer exactly one strong move, when the material is decided, or at
   mate. It always ends on the solver's move. */
async function extend(engine, fen, moves, cfg){
  let st = after(fen, moves);
  for (;;){
    if (!st || !P.legalMoves(st, st.turn).length) break;
    if (G.materialSwing(fen, st) >= G.CLEAR_WIN) break;
    if (moves.length + 2 > cfg.maxPlies) break;
    const reply = await engine.ask({ fen, moves, depth: cfg.depth });
    if (!reply.best) break;
    const rm = uciFind(st, reply.best);
    if (!rm) break;
    const next = P.makeMove(st, rm);
    if (!P.legalMoves(next, next.turn).length) break;
    const look = await engine.ask({
      fen, moves: moves.concat([reply.best]), multipv: 2, depth: cfg.depth
    });
    const cand = G.candidateFrom(look, cfg.gap);
    if (!cand) break;
    const pm = uciFind(next, cand.best);
    if (!pm) break;
    moves = moves.concat([reply.best, cand.best]);
    st = P.makeMove(next, pm);
  }
  return moves;
}

/** Cut at the ply the engine would not sign, put its move there, carry on. */
async function repair(engine, p, at, top, cfg){
  if (at % 2 === 1){
    /* A defence the engine will not play. Its own goes in, and the line is
       extended from there — which may well stop at once, leaving the puzzle
       one move shorter and ending, as it must, on the solver's move. The new
       reply is not spliced in by hand: extend() asks for the best defence as
       its first act, which is the same question with the same answer. */
    return extend(engine, p.fen, p.moves.slice(0, at), cfg);
  }
  // the move that overruled the file is the move that replaces it, taken from
  // the verdict search rather than asked for again at some other depth
  const prefix = p.moves.slice(0, at);
  const st = after(p.fen, prefix);
  if (!top || !st || !uciFind(st, top)) return null;
  return extend(engine, p.fen, prefix.concat([top]), cfg);
}

/* ---- the follow-up ----
   Why the move was good, played out rather than asserted. The solution ends
   where the position stops being sharp, which is exactly where a player who
   has just found the move still cannot see what they have won — the rook is
   not on the board yet, the mate is three moves off. This is both sides at
   full strength from there, so what it shows is the best the defence has, not
   a line that only works if the opponent helps. */
async function followUp(engine, fen, moves, plies, cfg){
  const out = [];
  let line = moves.slice();
  let st = after(fen, line);
  for (let i = 0; i < plies; i++){
    if (!st || !P.legalMoves(st, st.turn).length) break;
    const res = await engine.ask({ fen, moves: line, depth: cfg.depth });
    if (!res.best || !uciFind(st, res.best)) break;
    out.push(res.best);
    line = line.concat([res.best]);
    st = P.makeMove(st, uciFind(st, res.best));
  }
  return out;
}

/* ------------------------------------------------------------------ main */

function parseArgs(argv, defs){
  const cfg = Object.assign({}, defs);
  for (let i = 0; i < argv.length; i++){
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const k = a.slice(2);
    if (!(k in cfg)) throw new Error('unknown option --' + k);
    if (typeof cfg[k] === 'boolean') cfg[k] = true;
    else if (typeof cfg[k] === 'number') cfg[k] = +argv[++i];
    else cfg[k] = argv[++i];
  }
  return cfg;
}

async function main(){
  const cfg = parseArgs(process.argv.slice(2), DEFAULTS);
  const file = cfg.file || path.join(__dirname, '..', 'puzzles', cfg.track + '.json');
  const list = JSON.parse(fs.readFileSync(file, 'utf8'));
  const pool = new Pool(cfg.jobs);
  const t0 = Date.now();
  let done = 0;

  const results = await pool.map(list, async (p, engine) => {
    const found = await audit(engine, p, cfg);
    const out = { n: p.n, id: p.id, notes: found.notes, why: found.why, at: found.at };
    if (found.at >= 0){
      const fixed = await repair(engine, p, found.at, found.top, cfg);
      if (fixed && fixed.length && fixed.length % 2 === 1) out.moves = fixed;
      else out.failed = true;
    }
    const moves = out.moves || p.moves;
    if (cfg.followup) out.followUp = await followUp(engine, p.fen, moves, cfg.followup, cfg);
    done++;
    process.stderr.write('\r' + done + '/' + list.length + '   ');
    return out;
  });
  process.stderr.write('\n');

  const bad = results.filter(r => r.at >= 0);
  for (const r of results){
    for (const note of r.notes) console.log('#' + r.n + ' note   ' + note);
  }
  for (const r of bad){
    console.log('#' + r.n + ' WRONG  ' + r.why);
    if (r.failed) console.log('        could not rebuild');
    else console.log('        was ' + JSON.stringify(list[r.n - 1].moves) +
                     '\n        now ' + JSON.stringify(r.moves));
  }
  console.log('\n' + bad.length + ' of ' + list.length + ' rebuilt, ' +
              Math.round((Date.now() - t0) / 1000) + 's');

  if (!cfg.write){ pool.quit(); return; }

  /* Written back in place, rung for rung. A repaired puzzle is a different
     puzzle — new line, new motifs, new id, since the id is the hash of the fen
     and the moves — but it is the same rung of the same ladder, because a
     track is a hundred and thinning it is not a repair. seedRating is only
     re-measured when the first move changed: it is a measurement of that move
     and nothing else. */
  const changed = results.filter(r => r.moves);
  await pool.map(changed, async (r, engine) => {
    const p = list[r.n - 1];
    p.moves = r.moves;
    p.themes = G.themesFor(p.fen, p.moves);
    p.id = G.puzzleId(cfg.track, p.fen, p.moves);
    if (r.at === 0) p.seedRating = await seedRating(engine, p.fen, p.moves[0]);
  });
  if (cfg.followup) for (const r of results) list[r.n - 1].followUp = r.followUp || [];
  fs.writeFileSync(file, JSON.stringify(list, null, 1) + '\n');
  console.log('wrote ' + file);
  pool.quit();
}

/* The generator's own cold start, which it does not export: every rung of the
   ladder is asked the first move, weakest first, and the first rung to find it
   twice out of three names the rating. */
const SEED_TRIES = 3, SEED_NEEDED = 2;
async function seedRating(engine, fen, first){
  const st = P.stateFromFEN(fen);
  const legal = P.legalMoves(st, st.turn);
  const never = () => 1;
  for (const lvl of P.LEVELS){
    const quick = P.botShortcut(legal, lvl, never);
    if (quick) return P.uciOf(quick) === first ? lvl.elo : G.UNSOLVED_SEED;
    let hits = 0;
    for (let t = 0; t < SEED_TRIES; t++){
      const res = await engine.ask({
        fen, skill: lvl.skill, multipv: lvl.pool, depth: lvl.depth, movetime: lvl.movetime
      });
      const m = P.botChoice(legal, lvl, res, never);
      if (m && P.uciOf(m) === first) hits++;
      if (hits >= SEED_NEEDED) return lvl.elo;
      if (hits + (SEED_TRIES - t - 1) < SEED_NEEDED) break;
    }
  }
  return G.UNSOLVED_SEED;
}

module.exports = { audit, extend, repair, followUp, scoreOf, DEFAULTS };

if (require.main === module) main().catch(err => { console.error(err); process.exit(1); });
