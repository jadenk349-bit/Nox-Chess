/* Re-checking a shipped ladder against the engine, and writing the follow-up.
 *
 * generate_puzzles.js chooses puzzles while it plays; this asks the opposite
 * question of a set that already exists — is every move in the file still the
 * move Stockfish would play, when Stockfish is allowed to look deeper than the
 * generator did? A puzzle whose "solution" is only the second best move is
 * worse than no puzzle: the player finds the better move, the board refuses
 * it, and the thing that was supposed to teach has taught the wrong lesson.
 *
 * Two passes over each puzzle, on one engine so the questions stay in order:
 *
 *   1. audit  — walk the stored line, and at every ply ask the engine what it
 *               would play. The player's moves have to be the engine's best,
 *               and so do the defence's: a reply that is not the toughest one
 *               makes the rest of the line a refutation of nothing. When the
 *               stored move is not the engine's, the two are then played and
 *               scored separately rather than read off one ranking, because a
 *               shipped puzzle should only be overruled by two numbers that
 *               were arrived at the same way.
 *   2. fix    — when a ply disagrees, keep the prefix the engine has already
 *               agreed with and rebuild the tail with the generator's own
 *               buildLine(), so a corrected puzzle is built exactly the way
 *               the shipped ones were. Themes are then re-derived by
 *               findMotifs() and the seed rating re-measured against the bot
 *               ladder, because both described the old line.
 *
 * Then the follow-up: the engine's own best play for both sides from where the
 * solution stops, a handful of plies, each one asked for in its own position
 * rather than read off one search's principal variation. That distinction is
 * the whole point — a pv is one search's intention, and what the page shows
 * the player after they solve a puzzle should be a sequence of moves that were
 * each, separately, the best move on the board.
 *
 *   node tools/verify_puzzles.js --track endgame          # report only
 *   node tools/verify_puzzles.js --track endgame --write  # and save the fixes
 *
 * Depth, never movetime, for the same reason the generator uses it: the
 * verdict must not depend on how fast the machine is. And every search here is
 * a `fresh` one — see sf.js — because a pool engine that has already answered
 * forty questions answers the forty-first differently, and a verdict that
 * depends on which engine drew the puzzle is not a verdict.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const P = require('./page_chess.js');
const G = require('./generate_puzzles.js');
const { Pool } = require('./sf.js');

const DEFAULTS = {
  track: 'endgame',
  // deeper than the generator's confirmDepth of 16 on purpose: the point of a
  // second pass is to be a second opinion, and an opinion at the same depth is
  // the same opinion
  depth: 22,
  followDepth: 20,
  follow: 6,            // plies of follow-up: three moves each, enough to show why
  maxPlies: 7,          // as the generator: a solution ends on the player's move
  gap: 150,
  jobs: Math.max(1, Math.min(12, require('os').cpus().length - 2)),
  write: false,
  reseed: true,         // re-measure seedRating for puzzles whose line changed
  resort: true,         // and put the ladder back in difficulty order afterwards
  out: path.join(__dirname, '..', 'puzzles')
};

/* A move that is a whole mate move slower is not the same answer, so mates are
   spaced far enough apart on this scale to fail the tolerance below. Ordinary
   scores stay in centipawns, where they mean what they always meant. */
const MATE = 10000;
const MATE_PLY = 50;
/* How much worse than the engine's own move a stored move may be and still
   count as an answer. Two moves within half a pawn of each other are the same
   idea; the generator only ever chose moves that beat the runner-up by 150. */
const TOL = 50;

function scoreOf(l){
  if (!l) return null;
  if (l.mate !== null && l.mate !== undefined)
    return l.mate > 0 ? MATE - MATE_PLY * Math.abs(l.mate)
                      : -MATE + MATE_PLY * Math.abs(l.mate);
  return (l.cp === null || l.cp === undefined) ? null : l.cp;
}

const uciFind = G.uciFind;

/* What the position after a move is worth to the side that played it.
   Reading the two moves off one MultiPV ranking is not good enough to condemn
   a shipped puzzle: MultiPV ranks the lines it happened to search, and the
   runner-up gets a narrower window than the leader. So each move is played and
   its own position searched, on its own clean table and to the same depth, and
   the answer negated. Two numbers produced the same way can be subtracted. */
async function scoreAfter(engine, fen, moves, cfg){
  let st = P.stateFromFEN(fen);
  for (const u of moves){
    const m = uciFind(st, u);
    if (!m) return null;                          // an illegal stored move scores nothing
    st = P.makeMove(st, m);
  }
  if (!P.legalMoves(st, st.turn).length)
    return P.inCheck(st, st.turn) ? MATE - MATE_PLY : 0;   // mate delivered, or stalemate
  const res = await engine.ask({ fen, moves, depth: cfg.depth, fresh: true });
  const s = scoreOf(res);
  return s === null ? null : -s;                  // res is from the other side's view
}

/* ---- pass one: does the file still agree with the engine? ---- */

/** Walk the stored line. Returns the first ply the engine will not stand behind. */
async function audit(engine, p, cfg){
  const plies = [];
  let settle = null;
  let bad = -1;
  for (let i = 0; i < p.moves.length; i++){
    const prefix = p.moves.slice(0, i);
    const res = await engine.ask({ fen: p.fen, moves: prefix, multipv: 2, depth: cfg.depth, fresh: true });
    // the shallowest depth the search never changed its mind after, kept from
    // the puzzle's own position because that is what difficulty() ranks on and
    // the shipped file does not carry it
    if (i === 0) settle = res.settleDepth;
    const best = ((res.lines || [])[0] || {}).best || res.best;
    const stored = p.moves[i];
    let loss = 0, ok = true;
    if (stored !== best){
      const a = await scoreAfter(engine, p.fen, prefix.concat([best]), cfg);
      const b = await scoreAfter(engine, p.fen, prefix.concat([stored]), cfg);
      loss = (a === null || b === null) ? null : a - b;
      ok = loss !== null && loss <= TOL;
    }
    plies.push({ i, stored, best, loss, ok, gap: gapOf(res) });
    if (!ok){ bad = i; break; }
  }
  return { plies, bad, settle };
}

/** How far the best line is ahead of the runner-up — "only one strong move". */
function gapOf(res){
  const a = scoreOf((res.lines || [])[0]), b = scoreOf((res.lines || [])[1]);
  return (a === null || b === null) ? null : a - b;
}

/* ---- pass two: the follow-up ---- */

/* Best play from where the solution stops, one search per move. Each move is
   the engine's answer to the position actually on the board, which is what
   lets the page say the line was verified rather than merely predicted — and
   two lines wide, for the reason given over clean() below: a single-line
   search can prune away a move far better than the one it answers with, and a
   follow-up is shown to the player as the move that was there to be played. */
async function followUp(engine, fen, moves, cfg){
  const out = [];
  let st = P.stateFromFEN(fen);
  for (const u of moves.concat()) {
    const m = uciFind(st, u);
    if (!m) return [];
    st = P.makeMove(st, m);
  }
  for (let i = 0; i < cfg.follow; i++){
    if (!P.legalMoves(st, st.turn).length) break;      // mate or stalemate: nothing follows
    const res = await engine.ask({
      fen, moves: moves.concat(out), multipv: 2, depth: cfg.followDepth, fresh: true
    });
    // bestmove is the engine's own pick and at Skill 20 that is line one, but
    // read the line rather than trust that: a follow-up move that is not the
    // top line is the exact thing this width was added to stop
    const best = ((res.lines || [])[0] || {}).best || res.best;
    const m = best && uciFind(st, best);
    if (!m) break;
    out.push(best);
    st = P.makeMove(st, m);
  }
  return out;
}

/* ---- one puzzle, start to finish ---- */

/* buildLine() and seedRating() belong to the generator and ask the engine
   their own questions; wrapped like this they ask them on a clean table too,
   so a corrected line is as reproducible as the verdict that asked for it.

   And with two lines rather than one, which is not a detail. buildLine() picks
   the defence with a plain single-line search, and a single-line search prunes
   against the best move it has: in one position in this set it answers Nxb7 at
   +15 and never reports that Rxb7 is +63, which MultiPV 2 finds at the same
   depth in the same time. A defence chosen that way is exactly the fault this
   tool exists to correct. Anything that asks for a MultiPV of its own keeps
   it — seedRating() is imitating a weak rung and its width is the point. */
const clean = engine => ({
  ask: o => engine.ask(Object.assign({ multipv: 2, fresh: true }, o))
});

async function checkOne(p, engine, cfg){
  const before = p.moves.slice();
  const rep = { n: p.n, id: p.id, fen: p.fen, before, after: before, changed: false, notes: [] };

  const a = await audit(engine, p, cfg);
  rep.plies = a.plies;
  rep.settle = a.settle;
  if (a.plies[0] && a.plies[0].gap !== null && a.plies[0].gap < cfg.gap)
    rep.notes.push('no longer one strong move at depth ' + cfg.depth + ' (gap ' + a.plies[0].gap + ')');

  if (a.bad >= 0){
    const b = a.plies[a.bad];
    rep.notes.push('ply ' + (a.bad + 1) + ': ' + b.stored + ' is ' +
                   (b.loss === null ? 'not playable' : b.loss + 'cp worse than ' + b.best));
    // keep what the engine already agreed with. A player's move is replaced by
    // the engine's; a defensive move is simply dropped, because buildLine()
    // picks the toughest defence itself and everything after it depended on
    // the reply it is about to change.
    const prefix = a.bad % 2 === 0 ? before.slice(0, a.bad).concat([b.best])
                                   : before.slice(0, a.bad);
    const fixed = await G.buildLine(clean(engine), p.fen, prefix, {
      replyDepth: cfg.depth, confirmDepth: cfg.depth, gap: cfg.gap, maxPlies: cfg.maxPlies
    });
    if (fixed.length && fixed.length % 2 === 1 && fixed.join(' ') !== before.join(' ')){
      p.moves = fixed;
      rep.after = fixed;
      rep.changed = true;
    } else if (!fixed.length || fixed.length % 2 === 0){
      rep.notes.push('could not rebuild a line; left as it was');
    }
  }

  if (rep.changed){
    // all three of these described the old line and would otherwise go on
    // doing so — the themes name motifs of a move that may no longer be
    // played, and the rating and the rank measure how hard that move was
    p.themes = G.themesFor(p.fen, p.moves);
    if (p.moves[0] !== before[0]){
      const re = await engine.ask({ fen: p.fen, multipv: 2, depth: cfg.depth, fresh: true });
      rep.settle = re.settleDepth;
    }
    if (cfg.reseed) p.seedRating = await G.seedRating(clean(engine), p.fen, p.moves[0]);
  }
  p.followUp = await followUp(engine, p.fen, p.moves, cfg);
  rep.follow = p.followUp;
  return rep;
}

/* ---- reporting ---- */

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

function parseArgs(argv){
  const cfg = Object.assign({}, DEFAULTS);
  for (let i = 2; i < argv.length; i++){
    const a = argv[i];
    if (a === '--write'){ cfg.write = true; continue; }
    if (a === '--no-reseed'){ cfg.reseed = false; continue; }
    if (a === '--no-resort'){ cfg.resort = false; continue; }
    const key = a.replace(/^--/, '');
    if (!(key in cfg)) throw new Error('unknown option ' + a);
    const v = argv[++i];
    cfg[key] = typeof cfg[key] === 'number' ? +v : v;
  }
  return cfg;
}

async function main(){
  const cfg = parseArgs(process.argv);
  const file = path.join(cfg.out, cfg.track + '.json');
  const list = JSON.parse(fs.readFileSync(file, 'utf8'));
  console.log('verifying ' + list.length + ' ' + cfg.track + ' puzzles at depth ' + cfg.depth +
              ', follow-up ' + cfg.follow + ' plies at depth ' + cfg.followDepth +
              ' (' + cfg.jobs + ' engines)\n');

  const pool = new Pool(cfg.jobs);
  let done = 0;
  const reports = await pool.map(list, async (p, engine) => {
    const rep = await checkOne(p, engine, cfg);
    done++;
    process.stderr.write('\r  ' + done + '/' + list.length + '   ');
    return rep;
  });
  pool.quit();
  process.stderr.write('\r                    \r');

  const changed = reports.filter(r => r.changed);
  for (const r of reports){
    if (!r.changed && !r.notes.length) continue;
    console.log('#' + r.n + '  ' + r.id);
    console.log('   ' + r.fen);
    for (const note of r.notes) console.log('   ! ' + note);
    if (r.changed){
      console.log('   was  ' + lineSan(r.fen, r.before) + '   [' + r.before.join(' ') + ']');
      console.log('   now  ' + lineSan(r.fen, r.after)  + '   [' + r.after.join(' ') + ']');
    }
    console.log('');
  }

  /* A ladder is a promise that puzzle 1 is easier than puzzle 100, and a
     corrected puzzle is not as hard as the one it replaced — a seven-move line
     that only worked because the defence blundered collapses to one move once
     the defence is fixed. So the whole track is re-ranked by the generator's
     own difficulty key and renumbered. Rungs move; nobody's progress does,
     because progress is stored per puzzle id and every id is untouched. */
  let moved = 0;
  if (cfg.resort){
    const rank = new Map(reports.map(r => [r.id, r.settle]));
    for (const p of list) p.rank = G.difficulty(Object.assign({ settleDepth: rank.get(p.id) }, p));
    const was = new Map(list.map(p => [p.id, p.n]));
    list.sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id));
    list.forEach((p, i) => { p.n = i + 1; delete p.rank; });
    moved = list.filter(p => was.get(p.id) !== p.n).length;
    console.log(moved + ' of ' + list.length + ' rungs renumbered to keep the ladder in difficulty order');
  }

  const noFollow = reports.filter(r => !r.follow.length).length;
  console.log(list.length + ' checked  ·  ' + changed.length + ' corrected  ·  ' +
              (reports.length - changed.length) + ' already best play');
  console.log('follow-up written for ' + (list.length - noFollow) + ', ' + noFollow +
              (cfg.follow ? ' end in mate or stalemate with nothing to follow'
                          : ' left alone, since none were asked for'));

  if (cfg.write){
    fs.writeFileSync(file, JSON.stringify(list, null, 1) + '\n');
    console.log('\nwrote ' + file);
  } else {
    console.log('\n(dry run — pass --write to save)');
  }
}

module.exports = { scoreOf, gapOf, audit, followUp, checkOne, parseArgs, TOL, DEFAULTS };

if (require.main === module) main().catch(err => { console.error(err); process.exit(1); });
