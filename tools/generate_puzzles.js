#!/usr/bin/env node
/* Puzzles, grown at home.
 *
 * Every puzzle this game serves comes out of a game this game played against
 * itself. Nothing is imported from Lichess, chess.com or any other set — not
 * for licensing reasons alone, but because a puzzle mined from our own bot
 * ladder is a position our own players actually reach, and its explanation is
 * written by the same code that explains their own games.
 *
 * The shape of it, which is the shape chess.com describes for its own mining:
 *
 *   1. play bot against bot, pairing rungs from LEVELS so the games contain
 *      human-shaped mistakes — perfect play produces no puzzles at all;
 *   2. after every move, ask a full-strength engine for two lines. When the
 *      best is far enough clear of the second best, there is exactly one
 *      strong move, and that is what a puzzle is;
 *   3. extend: play the engine's own best defence, ask again, and keep going
 *      while the position stays that sharp — stopping at a clear material win
 *      or at mate;
 *   4. tag it by running the Study Board's own findMotifs() over the solution;
 *   5. seed a rating by replaying the first move against every rung of the
 *      ladder and taking the lowest one that finds it.
 *
 * Step 5 is a proxy and nothing more. chess.com seeds from billions of solve
 * attempts; this seeds from what a 1300-rated bot can see. The live ratings in
 * server.py are what correct it once real players start attempting them.
 *
 * The chess is not implemented here. Every board function is pulled out of
 * blind-chess.html by tools/page_chess.js, so this tool and the coach card in
 * the browser cannot disagree about what a fork is.
 *
 *   node tools/generate_puzzles.js --games 40 --jobs 8 --seed 7
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const P = require('./page_chess.js');
const { Pool } = require('./sf.js');

/* ---------------------------------------------------------------- knobs */

const DEFAULTS = {
  // A track is 100 puzzles, and the pool they are chosen from wants to be
  // several times that or the "ramp" is just everything that was found, in
  // order. Games are played until every track has its pool — endgames are far
  // rarer than middlegames, so a fixed game count overshoots one and starves
  // the other.
  track: 100,
  pool: 3,
  maxGames: 1200,
  games: 0,             // 0 = play until the pools are full; a number caps it flat
  jobs: Math.max(1, Math.min(12, require('os').cpus().length - 2)),
  seed: 1,
  out: path.join(__dirname, '..', 'puzzles'),
  // depth, never movetime: a search bounded by depth answers the same on a
  // laptop and on a server, which is the only way a generated set is reproducible
  scanDepth: 12,        // cheap sweep over every position
  confirmDepth: 16,     // and a real look at the few that survive it
  replyDepth: 16,       // the defence spliced in between the player's moves
  gap: 150,             // centipawns the best move must beat the second best by
  maxPlies: 7,          // solution length cap, always odd: a puzzle ends on your move
  perGame: 4,           // one game should not fill the set with its own middlegame
  gameLength: 120,
  // Curation is cheap and generation is not, so the pool the ladders were
  // chosen from can be kept and re-cut. --poolsIn skips the engine entirely.
  poolsOut: '',
  poolsIn: ''
};

// Rungs to draw self-play from. The very weak ones produce noise rather than
// mistakes, and the very strong ones produce no mistakes at all; the middle of
// the ladder is where a game goes wrong in ways worth showing.
const PLAY_RUNGS = [800, 1000, 1300, 1600, 2000, 2400];
// Positions already won by this much are not puzzles: finding the one strong
// move hardly matters when everything wins. Same threshold the review uses to
// refuse to call a sacrifice brilliant in a position that was already over.
const ALREADY_WON = 700;
// A solver that finds a clear extra rook (or a queen) can stop being tested.
const CLEAR_WIN = 450;
// Nothing on the ladder found it. Not "impossible" — just past what this
// proxy can measure, and the first thing real attempts will correct.
const UNSOLVED_SEED = 2800;
const MATE_SCORE = 10000;

/* ------------------------------------------------------- pure machinery */

/** Small seeded PRNG: same seed, same games, on any machine. */
function mulberry32(a){
  return function(){
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/** One score for a ranked line, with a faster mate beating a slower one. */
function lineScore(l){
  if (!l) return null;
  if (l.mate !== null && l.mate !== undefined)
    return l.mate > 0 ? MATE_SCORE - Math.abs(l.mate) : -MATE_SCORE + Math.abs(l.mate);
  return (l.cp === null || l.cp === undefined) ? null : l.cp;
}

/* Is this position a puzzle? Only if there is one strong move — the same
   MultiPV gap the review uses to tell a Great move from a merely best one.
   A mate counts on its own, unless the runner-up mates too and nearly as
   fast, because then there is nothing single about the answer. */
function candidateFrom(res, gapMin, alreadyWon){
  gapMin = gapMin === undefined ? DEFAULTS.gap : gapMin;
  alreadyWon = alreadyWon === undefined ? ALREADY_WON : alreadyWon;
  const lines = (res && res.lines) || [];
  const top = lines[0], second = lines[1];
  if (!top || !top.best) return null;
  if (!second || !second.best) return null;      // one legal move is not a puzzle
  const a = lineScore(top), b = lineScore(second);
  if (a === null || b === null) return null;
  const topMates = top.mate > 0, secondMates = second.mate > 0;
  if (topMates){
    if (secondMates && Math.abs(second.mate) - Math.abs(top.mate) < 2) return null;
    return { best: top.best, gap: a - b, mate: Math.abs(top.mate), score: a, pv: top.pv || [] };
  }
  if (secondMates) return null;                  // cannot happen; not worth trusting
  if (b >= alreadyWon) return null;              // already winning without finding anything
  if (a - b < gapMin) return null;
  return { best: top.best, gap: a - b, mate: null, score: a, pv: top.pv || [] };
}

/** Where in the game this position sits, for the three menu entries. */
function bucketFor(fullmove){
  if (fullmove <= 12) return 'opening';
  if (fullmove <= 30) return 'middlegame';
  return 'endgame';
}

/** Stable across runs, so regenerating does not renumber everything. */
function puzzleId(bucket, fen, moves){
  const h = crypto.createHash('sha1').update(fen + '|' + moves.join(' ')).digest('hex');
  return bucket.slice(0, 2) + '-' + h.slice(0, 10);
}

/* The themes are not this tool's opinion. findMotifs() is the function behind
   the Study Board coach card, run here over the solver's own moves, so a
   puzzle tagged "fork" is a puzzle whose explanation will say "forks". */
function themesFor(fen, moves){
  const tags = [];
  let st = P.stateFromFEN(fen);
  const solver = st.turn;
  for (let i = 0; i < moves.length; i++){
    const m = P.legalMoves(st, st.turn).find(x => P.uciOf(x) === moves[i]);
    if (!m) break;
    const after = P.makeMove(st, m);
    if (st.turn === solver)
      for (const motif of P.findMotifs(st, m, after, solver))
        if (tags.indexOf(motif.tag) < 0) tags.push(motif.tag);
    st = after;
  }
  if (moves.length >= 3 && tags.indexOf('mate') < 0) tags.push('longGame');
  return tags;
}

/* Openings, spread out. Without this every puzzle in the set comes from the
   four openings the ladder likes; with it the corpus wanders. The weights are
   only a shove towards moves that look like chess, not an opening book. */
function openingWeight(st, m){
  const to = m.to, home = m.p.c === P.W ? 6 : 1;
  const centreFile = Math.abs(3.5 - P.colOf(to)) <= 1.5;
  if (m.p.t === 'P'){
    if (P.rowOf(m.from) === home && Math.abs(3.5 - P.colOf(to)) <= 0.5) return m.dbl ? 8 : 4;
    return centreFile ? 3 : 1;
  }
  if (m.p.t === 'N') return centreFile ? 6 : 2;
  if (m.p.t === 'B') return 3;
  if (m.cap) return 4;
  return 1;                     // rooks, queen and king have nothing to do yet
}
function weightedPick(list, weigh, rnd){
  const w = list.map(weigh);
  let total = 0;
  for (const x of w) total += x;
  let r = rnd() * total;
  for (let i = 0; i < list.length; i++){ r -= w[i]; if (r <= 0) return list[i]; }
  return list[list.length - 1];
}

/** How much material the solver has won since the puzzle began. */
function materialSwing(startFen, st){
  const start = P.stateFromFEN(startFen);
  return P.materialFor(st, start.turn) - P.materialFor(start, start.turn);
}

/* ------------------------------------------------------- engine-driven */

const uciFind = (st, u) => P.legalMoves(st, st.turn).find(x => P.uciOf(x) === u) || null;

/** One bot-vs-bot game, returning every position it passed through. */
async function playGame(engine, rungs, rnd, cfg){
  let st = P.newState();
  const states = [st], moves = [], uci = [], reps = {};
  const openPlies = 4 + Math.floor(rnd() * 3);          // 4-6, per the brief
  for (let ply = 0; ply < cfg.gameLength; ply++){
    const legal = P.legalMoves(st, st.turn);
    if (!legal.length) break;                            // mate or stalemate
    if (st.half >= 100) break;                           // the fifty-move rule
    let m;
    if (ply < openPlies){
      m = weightedPick(legal, x => openingWeight(st, x), rnd);
    } else {
      const lvl = rungs[st.turn === P.W ? 0 : 1];
      m = P.botShortcut(legal, lvl, rnd);
      if (!m){
        const res = await engine.ask({
          moves: uci, skill: lvl.skill, multipv: lvl.pool,
          depth: lvl.depth, movetime: lvl.movetime
        });
        m = P.botChoice(legal, lvl, res, rnd) || legal[rnd() * legal.length | 0];
      }
    }
    uci.push(P.uciOf(m));
    moves.push(m);
    st = P.makeMove(st, m);
    states.push(st);
    const key = P.posKey(st);
    reps[key] = (reps[key] || 0) + 1;
    if (reps[key] >= 3) break;                           // threefold; nothing more to learn
  }
  return { states, moves, uci };
}

/* Extend a candidate into a real solution: the player's move, the engine's
   own best defence, then ask again. It ends on the player's move — always an
   odd number of plies — and stops when there is nothing left to find. */
async function buildLine(engine, startFen, first, cfg){
  const moves = [first];
  let st = P.stateFromFEN(startFen);
  st = P.makeMove(st, uciFind(st, first));
  for (;;){
    if (!P.legalMoves(st, st.turn).length) break;        // mate delivered, or stalemate
    if (materialSwing(startFen, st) >= CLEAR_WIN) break; // a clear material win
    if (moves.length + 2 > cfg.maxPlies) break;
    const reply = await engine.ask({ fen: startFen, moves, depth: cfg.replyDepth });
    if (!reply.best) break;
    const rm = uciFind(st, reply.best);
    if (!rm) break;
    const next = P.makeMove(st, rm);
    if (!P.legalMoves(next, next.turn).length) break;    // the defence had to walk into mate
    const look = await engine.ask({
      fen: startFen, moves: moves.concat([reply.best]), multipv: 2, depth: cfg.confirmDepth
    });
    const cand = candidateFrom(look, cfg.gap);
    if (!cand) break;                                    // no longer one strong move
    const pm = uciFind(next, cand.best);
    if (!pm) break;
    moves.push(reply.best, cand.best);
    st = P.makeMove(next, pm);
  }
  return moves;
}

/* The cold start. Every rung of the ladder is asked the puzzle's first move,
   from the weakest up, and the first one that finds it names the rating.

   Two deliberate choices. The rungs run with chance switched off — rnd() === 1
   fires neither the wild branch nor the sloppy one — because the question is
   what a rung can see, not what it happened to do. And each rung is asked
   three times and has to find it twice: below Skill 20 Stockfish scrambles its
   own choice on purpose, so a single sample says as much about luck as about
   difficulty. */
const SEED_TRIES = 3, SEED_NEEDED = 2;

async function seedRating(engine, fen, first){
  const st = P.stateFromFEN(fen);
  const legal = P.legalMoves(st, st.turn);
  const never = () => 1;
  for (const lvl of P.LEVELS){
    const quick = P.botShortcut(legal, lvl, never);
    if (quick) return P.uciOf(quick) === first ? lvl.elo : UNSOLVED_SEED;
    let hits = 0;
    for (let t = 0; t < SEED_TRIES; t++){
      const res = await engine.ask({
        fen, skill: lvl.skill, multipv: lvl.pool, depth: lvl.depth, movetime: lvl.movetime
      });
      const m = P.botChoice(legal, lvl, res, never);
      if (m && P.uciOf(m) === first) hits++;
      if (hits >= SEED_NEEDED) return lvl.elo;
      if (hits + (SEED_TRIES - t - 1) < SEED_NEEDED) break;    // cannot reach two
    }
  }
  return UNSOLVED_SEED;
}

/* A position can pass the "one strong move" test and still not be a puzzle.
   Recaptures are forced rather than found — nobody learns from taking back on
   the square just taken on — and a move with nothing to say about it teaches
   nothing either. The gate is the teaching engine's own opinion: if
   findMotifs() sees no pattern, the move gives no check and wins no material,
   the coach card would have nothing to explain, so it is not a puzzle. */
function worthShowing(st, first, prev, themes){
  if (prev && prev.cap && first.cap && prev.to === first.to) return false;   // a recapture
  // longGame is this tool's own note about length, not something findMotifs
  // saw on the board, so it cannot be the reason a puzzle is worth showing
  if (themes.some(t => t !== 'longGame')) return true;
  const after = P.makeMove(st, first);
  if (P.inCheck(after, after.turn)) return true;
  return !!first.cap && P.see(st, first.to, st.turn) > 0;   // or simply free material
}

/* Sweep one finished game for positions worth asking about.
   Two passes: the whole game is swept cheaply first, and only then are a few
   of the survivors worked up into puzzles. Taking the first four candidates
   instead would fill the set with one game's opening — the stride spreads the
   choice across the game, and anything rejected is backfilled from the rest. */
async function minePuzzles(engine, game, cfg, seen, wanted){
  const hits = [];
  for (let i = 1; i < game.states.length; i++){
    const st = game.states[i];
    if (!P.legalMoves(st, st.turn).length) continue;
    // a track with its pool already full is not worth an engine call: once the
    // middlegame is done, every search left goes looking for endgames
    if (!wanted(bucketFor(st.full))) continue;
    const fen = P.fenOf(st);
    if (seen.has(fen)) continue;
    const scan = await engine.ask({ fen, multipv: 2, depth: cfg.scanDepth });
    // the cheap sweep is allowed to be optimistic; the deep look decides
    if (!candidateFrom(scan, cfg.gap * 0.7)) continue;
    const deep = await engine.ask({ fen, multipv: 2, depth: cfg.confirmDepth });
    const cand = candidateFrom(deep, cfg.gap);
    if (cand) hits.push({ i, st, fen, cand, settleDepth: deep.settleDepth });
  }

  const stride = Math.max(1, Math.floor(hits.length / cfg.perGame));
  const order = [];
  for (let k = 0; k < hits.length; k += stride) order.push(hits[k]);
  for (const h of hits) if (order.indexOf(h) < 0) order.push(h);   // backfill

  const found = [];
  let lastPly = -99;
  for (const h of order){
    if (found.length >= cfg.perGame) break;
    if (Math.abs(h.i - lastPly) < 4) continue;      // not the same moment twice
    if (seen.has(h.fen)) continue;
    const first = uciFind(h.st, h.cand.best);
    if (!first) continue;
    const moves = await buildLine(engine, h.fen, h.cand.best, cfg);
    const themes = themesFor(h.fen, moves);
    if (!worthShowing(h.st, first, game.moves[h.i - 1], themes)) continue;
    seen.add(h.fen);
    lastPly = h.i;
    const bucket = bucketFor(h.st.full);
    found.push({
      id: puzzleId(bucket, h.fen, moves),
      fen: h.fen,
      moves,
      themes,
      seedRating: await seedRating(engine, h.fen, moves[0]),
      settleDepth: h.settleDepth,
      bucket
    });
  }
  return found;
}

/* --------------------------------------------------------- the ladder */

/* How hard a puzzle is to *find*, which is not the same as how good the move
   is. seedRating leads because it is the only measurement of a player-like
   solver, but it has ten possible values and a hundred puzzles to order, so
   the rest of the key breaks its ties with things that genuinely make a move
   harder to see:

   settleDepth  a move a shallow search already likes is a move you spot;
   plies        every extra move in the line is another thing to see coming;
   quiet        a move that captures nothing and checks nothing hides;
   sacrifice    giving material away reads as wrong until you see why.

   It is a rank key and nothing else. What the player is shown is seedRating,
   corrected over time by real attempts. */
function difficulty(p){
  const st = P.stateFromFEN(p.fen);
  const first = P.legalMoves(st, st.turn).find(m => P.uciOf(m) === p.moves[0]);
  if (!first) return p.seedRating;
  const after = P.makeMove(st, first);
  const quiet = !first.cap && !P.inCheck(after, after.turn);
  const sac = P.sacrificeSize(st, first, after) >= 200;
  return p.seedRating
       + 40 * (p.settleDepth || 1)
       + 60 * (p.moves.length - 1)
       + (quiet ? 120 : 0)
       + (sac ? 150 : 0);
}

/* Pick the track out of the pool: a hundred rungs evenly spaced *in
   difficulty*, from the easiest thing found to the hardest.

   Not evenly spaced in the pool, which is the obvious thing and the wrong one.
   Self-play produces far more easy tactics than hard ones — a third of any
   pool is material hanging where the weakest rung on the ladder can see it —
   so taking every third puzzle by position spends the first quarter of the
   track on puzzles that are all exactly as easy as each other. Walking the
   difficulty range instead and taking the nearest unused puzzle to each step
   thins the crowd at the bottom and fills the middle, which is what "puzzle 1
   is much easier than puzzle 100" actually asks for. */
function ladder(pool, size){
  const sorted = pool.slice().sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id));
  if (sorted.length <= size) return sorted;
  const lo = sorted[0].rank, hi = sorted[sorted.length - 1].rank;
  const taken = new Set();
  for (let i = 0; i < size; i++){
    const want = lo + (hi - lo) * (i / (size - 1));
    let pick = -1, closest = Infinity;
    for (let j = 0; j < sorted.length; j++){
      if (taken.has(j)) continue;
      const d = Math.abs(sorted[j].rank - want);
      if (d < closest){ closest = d; pick = j; }
    }
    taken.add(pick);
  }
  return Array.from(taken).sort((a, b) => a - b).map(j => sorted[j]);
}

/* ------------------------------------------------------------------ cli */

function parseArgs(argv){
  const cfg = Object.assign({}, DEFAULTS);
  for (let i = 0; i < argv.length; i += 2){
    const k = argv[i].replace(/^--/, '');
    if (!(k in cfg)) throw new Error('unknown option ' + argv[i]);
    cfg[k] = (typeof DEFAULTS[k] === 'string') ? argv[i+1] : +argv[i+1];
  }
  return cfg;
}

async function main(){
  const cfg = parseArgs(process.argv.slice(2));
  const started = new Date();
  const need = cfg.games ? 0 : cfg.track * cfg.pool;
  console.log(cfg.games
    ? 'generating from ' + cfg.games + ' self-play games on ' + cfg.jobs + ' engines'
    : 'playing until every track holds ' + need + ' candidates, on ' + cfg.jobs + ' engines');

  const pools = { opening: [], middlegame: [], endgame: [] };
  if (cfg.poolsIn){
    Object.assign(pools, JSON.parse(fs.readFileSync(cfg.poolsIn, 'utf8')));
    console.log('re-cutting ladders from %s, no engine needed', cfg.poolsIn);
    return finish(cfg, pools, started, 0);
  }
  const pool = new Pool(cfg.jobs);
  const seen = new Set();
  const wanted = b => !need || pools[b].length < need;
  // with a flat --games count there is no quota to fill, so nothing is ever full
  const full = () => need > 0 && Object.keys(pools).every(b => !wanted(b));
  let played = 0;

  const cap = cfg.games || cfg.maxGames;
  while (played < cap && !full()){
    const batch = [];
    for (let k = 0; k < cfg.jobs && played + k < cap; k++) batch.push(played + k);
    await pool.map(batch, async (n, engine) => {
      const rnd = mulberry32(cfg.seed * 1000003 + n);
      const rungs = [
        P.levelFor(PLAY_RUNGS[rnd() * PLAY_RUNGS.length | 0]),
        P.levelFor(PLAY_RUNGS[rnd() * PLAY_RUNGS.length | 0])
      ];
      const game = await playGame(engine, rungs, rnd, cfg);
      for (const p of await minePuzzles(engine, game, cfg, seen, wanted)) pools[p.bucket].push(p);
    });
    played += batch.length;
    process.stdout.write('\r  ' + played + ' games  ·  ' +
      Object.entries(pools).map(([b, l]) => b.slice(0, 3) + ' ' + l.length).join('  ·  ') + '   ');
  }
  pool.quit();
  console.log('');
  return finish(cfg, pools, started, played);
}

function finish(cfg, pools, started, played){
  fs.mkdirSync(cfg.out, { recursive: true });
  if (cfg.poolsOut){
    fs.writeFileSync(cfg.poolsOut, JSON.stringify(pools));
    console.log('  pool kept in %s', cfg.poolsOut);
  }
  const tracks = {};
  for (const [name, list] of Object.entries(pools)){
    for (const p of list) p.rank = difficulty(p);
    const track = ladder(list, cfg.track).map((p, i) => ({
      n: i + 1,
      id: p.id,
      fen: p.fen,
      moves: p.moves,
      themes: p.themes,
      seedRating: p.seedRating
    }));
    tracks[name] = track;
    fs.writeFileSync(path.join(cfg.out, name + '.json'), JSON.stringify(track, null, 1) + '\n');
    const seeds = track.map(p => p.seedRating);
    console.log('  %s.json  %d puzzles  ·  chosen from %d  ·  seed %d\u2192%d',
                name, track.length, list.length, seeds[0] || 0, seeds[seeds.length - 1] || 0);
  }
  writeReadme(cfg, tracks, pools, started, played);
  console.log('done in %s min', ((Date.now() - started) / 60000).toFixed(1));
}

function writeReadme(cfg, tracks, pools, started, played){
  const all = [].concat(tracks.opening, tracks.middlegame, tracks.endgame);
  const themes = {};
  for (const p of all) for (const t of p.themes) themes[t] = (themes[t] || 0) + 1;
  const rows = Object.entries(themes).sort((a, b) => b[1] - a[1])
    .map(([t, n]) => '| `' + t + '` | ' + n + ' |').join('\n');
  const band = name => {
    const t = tracks[name], s = t.map(p => p.seedRating);
    return '| ' + name + ' | ' + t.length + ' | ' + pools[name].length + ' | ' +
           (s[0] || 0) + ' | ' + (s[Math.floor(s.length / 2)] || 0) + ' | ' + (s[s.length - 1] || 0) + ' |';
  };

  fs.writeFileSync(path.join(cfg.out, 'README.md'),
`# Generated puzzles

**Nothing here was imported.** These positions came out of this game playing
itself, were chosen by the vendored Stockfish in \`engine/\`, and were tagged by
\`findMotifs()\` — the same function that writes the Study Board coach card in
\`blind-chess.html\`. No Lichess, chess.com or other puzzle set was used, in
whole or in part. Same provenance convention as \`engine/README.md\`, for the
opposite reason: that directory is somebody else's code, and this one is
nobody's but ours.

These files are the **Puzzles** feature only. Study Board analyses the game the
player just finished and never reads them.

## This set

| | |
|---|---|
| Generated | ${started.toISOString().slice(0, 10)} |
| Self-play games | ${played} |
| Random seed | \`${cfg.seed}\` |

| Track | Puzzles | Chosen from | Easiest | Median | Hardest |
|---|---|---|---|---|---|
${band('opening')}
${band('middlegame')}
${band('endgame')}

Each track is an ordered ladder: \`n\` 1 to ${cfg.track}, puzzle 1 the easiest and
puzzle ${cfg.track} the hardest. The player walks it in order, one unlocked by the last.

### Themes

| Theme | Puzzles |
|---|---|
${rows}

## How they were made

Bot against bot, rungs drawn from \`LEVELS\` in the page (${PLAY_RUNGS.join(', ')}
Elo), because games between equal and perfect engines contain no mistakes and
therefore no puzzles. The first 4–6 plies of each game are random, weighted
towards moves that look like chess, so the set is not four openings deep. Games
are played until every track has a pool of ${cfg.track * cfg.pool} candidates to choose from,
rather than to a fixed count: endgames are several times rarer than
middlegames, and a fixed count starves one to overshoot the other.

After every move the position is swept at depth ${cfg.scanDepth} and, if it looks
sharp, examined at depth ${cfg.confirmDepth} with two lines. A position is a puzzle when
the best move beats the second best by ${cfg.gap}cp or more, or forces a mate the
runner-up does not — "only one strong move", the same MultiPV gap the review
screen uses to tell a Great move from a merely best one. The solution is then
extended by splicing in the engine's own best defence and asking again, until
the position is no longer that sharp, a clear material win is reached, or mate.

A candidate still has to be worth showing. A recapture on the square just
captured on is forced rather than found, and a move that \`findMotifs()\` has
nothing to say about, which gives no check and wins no material, would reach
the player with an explanation that explains nothing. Both are dropped.

## How the hundred are chosen

The survivors are ranked, and the ladder is a hundred rungs **evenly spaced in
difficulty** between the easiest thing found and the hardest — not the hardest
hundred, not the first hundred, and not every third puzzle in the pool. That
last one is the obvious method and the wrong one: self-play turns up far more
easy tactics than hard ones, so spacing by position spends the first quarter of
a track on puzzles that are all exactly as easy as each other. The rank key is

\`\`\`
seedRating + 40·settleDepth + 60·(plies−1) + 120·(quiet move) + 150·(sacrifice)
\`\`\`

\`seedRating\` leads because it is the only measurement of a player-like solver:
the puzzle's first move is replayed against every rung of the ladder — chance
switched off, best of three, because Skill Level scrambles the engine's own
choice on purpose — and the lowest rung that finds it twice names the rating
(${UNSOLVED_SEED} when none does). It has ten possible values and a hundred puzzles to
order, so the rest of the key breaks its ties with what actually makes a move
hard to see: the depth the search had to reach before it stopped changing its
mind, the number of moves in the line, whether the move captures or checks
anything at all, and whether it gives material away first.

It is a rank key, not an Elo. What the player is shown is \`seedRating\`, and
what corrects it is real attempts, through the Elo update in
\`server/server.py\`.

Analysis is bounded by depth rather than by time, so the puzzle *criteria* do
not depend on how fast the machine is. Regeneration is still not bit-for-bit
reproducible: Stockfish seeds its Skill Level randomness from the clock, so the
self-play games and the seed ratings both wander a little between runs even at
the same \`--seed\`.

## Regenerating

\`\`\`bash
node tools/generate_puzzles.js --jobs ${cfg.jobs} --seed ${cfg.seed}
\`\`\`

Then check the new set and write its follow-ups, one track at a time:

\`\`\`bash
node tools/verify_puzzles.js --track middlegame
\`\`\`

A freshly generated file has been checked by the search that made it and by
nothing else, and carries no \`follow\` field, so the Show Follow-up button stays
hidden until it has been.

Then bump the \`?v=\` on the three JSON files in \`blind-chess.html\`, because
\`server/server.py\` serves them with a week of cache. Regenerating renumbers
the ladders; progress is stored per puzzle id, so a player keeps whatever they
have already solved and loses only their place in the numbering.
`);
}

module.exports = {
  mulberry32, lineScore, candidateFrom, bucketFor, puzzleId, themesFor, worthShowing,
  openingWeight, weightedPick, materialSwing, parseArgs, difficulty, ladder,
  // tools/verify_puzzles.js re-derives lines and re-seeds ratings for the
  // puzzles it repairs, and has to do both exactly the way they were made
  uciFind, buildLine, seedRating,
  PLAY_RUNGS, ALREADY_WON, CLEAR_WIN, UNSOLVED_SEED, MATE_SCORE, DEFAULTS
};

if (require.main === module) main().catch(err => { console.error(err); process.exit(1); });
