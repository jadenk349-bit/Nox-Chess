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
const R = require('./puzzle_rules.js');
const WORDS = require('./puzzle_words.js');
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
  // The bar itself lives in tools/puzzle_rules.js, because the verifier holds
  // the shipped set to the same one and two copies of a threshold is two
  // standards. This is only how optimistic the *cheap* sweep is allowed to be:
  // it nominates, it never decides, so it may be wrong in the generous
  // direction and must not be wrong in the other.
  nominate: 0.6,
  maxPlies: 7,          // solution length cap, always odd: a puzzle ends on your move
  beforeDepth: 16,      // the position the opponent moved from, to price the mistake
  perGame: 4,           // one game should not fill the set with its own middlegame
  gameLength: 120,
  // Curation is cheap and generation is not, so the pool the ladders were
  // chosen from can be kept and re-cut. --poolsIn skips the engine entirely.
  poolsOut: '',
  poolsIn: '',
  /* Hunt one track only. Endgames are several times rarer than middlegames —
     a game has to survive into one — and a general run that plays until the
     middlegame pool is full has spent almost all of its searches on positions
     it already had enough of. With --only the bucket test happens before the
     sweep, so a run looking for endgames does not pay to look at anything
     else, and --gameLength can be raised to give the games time to reach one. */
  only: '',
  /* How far apart the two rungs of a self-play game may be drawn. The rungs
     used to be picked independently, which means a third of the games were
     800 against 2400 — decided in the opening, and over as a contest long
     before either side reached an endgame worth asking about. A mismatch also
     makes for a worse *puzzle*: the losing side's blunders happen in positions
     they were already lost in, and "already lost" is most of what judge()
     turns away. Adjacent rungs would keep the whole ladder in the corpus and
     keep the games games — but they also make every game cost more, because
     neither side is the cheap one, and the yield-per-minute of doing it has
     not been measured. So the default is the old free-for-all and the knob is
     here for when somebody wants to find out. */
  spread: 5,
  /* The refusal tally is the honest half of the README — a threshold is only
     arguable next to the count of what it turned away — and it lives in the
     process that did the judging. When a set is cut from pools that two runs
     produced (a general one, and a second hunting whichever track was scarce),
     the tallies have to be merged and handed back in with them. */
  tallyIn: ''
};

// Rungs to draw self-play from. The very weak ones produce noise rather than
// mistakes, and the very strong ones produce no mistakes at all; the middle of
// the ladder is where a game goes wrong in ways worth showing.
const PLAY_RUNGS = [800, 1000, 1300, 1600, 2000, 2400];
// A solver that finds a clear extra rook (or a queen) can stop being tested.
const CLEAR_WIN = 450;
// Nothing on the ladder found it. Not "impossible" — just past what this
// proxy can measure, and the first thing real attempts will correct.
const UNSOLVED_SEED = 2800;

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

/* Does this position deserve an engine's real attention?
 *
 * This used to be the whole test — "one strong move", best beats second by
 * 150cp — and a set built on it is the set this rewrite exists to replace. It
 * is now what it should always have been: a *nominator*. It is cheap, it runs
 * at depth 12 over every position of every game, and the only thing it is
 * allowed to conclude is that a position is worth two more searches. Whether
 * it is a puzzle is judge()'s answer, in tools/puzzle_rules.js, and it needs
 * numbers this sweep does not have — chiefly what the position was worth
 * before the opponent moved.
 *
 * It may be generous, and it must not be strict: a position this throws away
 * is a position nothing else in the pipeline will ever see. Hence `frac`.
 */
function sharpEnough(res, frac){
  frac = frac === undefined ? DEFAULTS.nominate : frac;
  const lines = (res && res.lines) || [];
  const top = lines[0], second = lines[1];
  if (!top || !top.best) return null;
  if (!second || !second.best) return null;      // one legal move is not a puzzle
  const a = R.lineScore(top), b = R.lineScore(second);
  if (a === null || b === null) return null;
  // a mate the runner-up does not have is always worth a second look; two
  // mates is two answers, and judge() will say so, so it is dropped here too
  if (R.isMate(a) && a > 0) return R.isMate(b) && b > 0 ? null : { best: top.best, a, b };
  if (a - b < R.GAP_MIN * frac) return null;
  return { best: top.best, a, b };
}

/* Where in the game this position sits, for the three menu entries.
 *
 * By what is on the board, not by the move number. The move number was the old
 * rule — 12 and 30 — and it is wrong in both directions often enough to matter:
 * a queen trade on move 9 leaves an endgame that the ladder files under
 * "opening", and a Sicilian with all sixteen pieces still on at move 32 is not
 * an endgame however long it took to get there. What the three tracks promise
 * the player is three kinds of *position*, and a puzzle in the wrong one
 * teaches the right idea under the wrong heading.
 *
 * Endgame is asked first and answered on material, because it is the one of the
 * three with a real definition: few enough pieces that the king is a fighting
 * piece and pawns decide it. Two clauses rather than one, since a queen changes
 * what "few" means — a queen and a knight each is still a middlegame's worth of
 * danger on a board that counts as light.
 *
 * Opening is a position that still has opening work in it: most of the pawns
 * still there, and pieces still standing where they started. The move-number
 * cap stays as a backstop for the game that shuffles for forty moves without
 * developing, which is not an opening in any useful sense by then.
 */
const HOME_MINORS = {
  w: { 57:'N', 62:'N', 58:'B', 61:'B' },      // b1 g1 c1 f1
  b: { 1:'N', 6:'N', 2:'B', 5:'B' }           // b8 g8 c8 f8
};

function bucketFor(st){
  let npm = 0, pawns = 0, queens = 0, home = 0;
  for (let i = 0; i < 64; i++){
    const p = st.b[i];
    if (!p) continue;
    if (p.t === 'K') continue;
    if (p.t === 'P'){ pawns++; continue; }
    npm += P.VAL[p.t];
    if (p.t === 'Q') queens++;
    const want = HOME_MINORS[p.c] && HOME_MINORS[p.c][i];
    if (want === p.t) home++;
  }
  // a rook and a minor each, or a queen and a minor each: king-and-pawn
  // territory either way
  if (queens ? npm <= 2200 : npm <= 3000) return 'endgame';
  if (st.full <= 18 && pawns >= 12 && home >= 3) return 'opening';
  return 'middlegame';
}

/** Stable across runs, so regenerating does not renumber everything. */
function puzzleId(bucket, fen, moves){
  const h = crypto.createHash('sha1').update(fen + '|' + moves.join(' ')).digest('hex');
  return bucket.slice(0, 2) + '-' + h.slice(0, 10);
}

/* The themes are not this tool's opinion. findMotifs() is the function behind
   the Study Board coach card, and it names the nine patterns it names; the
   rest of the labels a *puzzle* carries — what kind of answer it is, what it
   costs, the two that are about the move before — are added by themesOf() in
   tools/puzzle_rules.js so that the verifier derives exactly the same set. */
function themesFor(rec){
  return R.themesOf(rec);
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
  return { states, moves, uci, openPlies };
}

/* Extend a candidate into a real solution: the player's move, the engine's
   own best defence, then ask again. It ends on the player's move — always an
   odd number of plies — and stops when there is nothing left to find.

   Two things it now records as it goes, because the card at the end of the
   puzzle says them and nothing else is in a position to know them. For every
   defence: how many legal moves there were and how far the best one beat the
   next, which is the difference between "forced" and "the toughest try". And
   for every position it stops in: the score, so the explanation can say where
   the line arrives without a second pass over the whole track.

   `first` is normally the one move the position was chosen for, but it also
   takes a whole line: tools/verify_puzzles.js re-checks a shipped ladder move
   by move and, when it has to correct one, hands back the part of the line it
   has already agreed with so only the tail is rebuilt. Either way the prefix
   ends on the player's move, which is what the loop below assumes. */
async function buildLine(engine, startFen, first, cfg){
  const moves = Array.isArray(first) ? first.slice() : [first];
  const replies = {};
  let st = P.stateFromFEN(startFen);
  for (const u of moves) st = P.makeMove(st, uciFind(st, u));
  for (;;){
    const legal = P.legalMoves(st, st.turn);
    if (!legal.length) break;                          // mate delivered, or stalemate
    if (materialSwing(startFen, st) >= CLEAR_WIN) break; // a clear material win
    if (moves.length + 2 > cfg.maxPlies) break;
    // two lines wide, always. A single-line search prunes against the best move
    // it already has and can decline to mention a better one — which is the
    // exact fault the verifier exists to correct, so it must not be the way
    // anything here searches.
    const reply = await engine.ask({
      fen: startFen, moves, multipv: 2, depth: cfg.replyDepth, objective: true
    });
    const rl = (reply.lines || []);
    const best = (rl[0] && rl[0].best) || reply.best;
    if (!best) break;
    const rm = uciFind(st, best);
    if (!rm) break;
    const next = P.makeMove(st, rm);
    // the defence had to walk into mate or stalemate: the line is over and the
    // reply is not part of it, because a puzzle ends on the solver's move
    if (!P.legalMoves(next, next.turn).length) break;
    const look = await engine.ask({
      fen: startFen, moves: moves.concat([best]), multipv: 2,
      depth: cfg.confirmDepth, objective: true
    });
    const ll = (look.lines || []);
    const a = R.lineScore(ll[0]), b = R.lineScore(ll[1]);
    // still exactly one move to find? The turning point was established at the
    // head of the line and is not re-argued here — rule 6 is only "keep going
    // while there is something to find", and rule 8 is the cap above.
    if (!R.stillSharp(a, b)) break;
    const pm = uciFind(next, ll[0].best);
    if (!pm) break;
    // from the defender's side, how much worse the second-best defence was —
    // the difference between "forced" and "the toughest try" on the card
    replies[moves.length] = {
      legal: legal.length,
      clear: (rl[0] && rl[1]) ? R.lineScore(rl[0]) - R.lineScore(rl[1]) : null
    };
    moves.push(best, ll[0].best);
    st = P.makeMove(next, pm);
  }
  // every push above adds a defence and a solver move together, and the prefix
  // came in odd, so the line ends on the solver's move by construction
  return { moves, replies };
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

/* Sweep one finished game for turning points.
 *
 * Three questions per position and they are asked in cost order, because the
 * first one is asked of every ply of every game and the last two are asked of
 * almost none.
 *
 *   sweep    depth 12, two lines. Nominates. Never decides.
 *   confirm  depth 16, three lines. What the best move is worth, and what the
 *            second best is worth — the head-to-head the whole standard rests
 *            on.
 *   before   depth 16, the position the opponent moved *from*. This is the
 *            question the old generator never asked, and the reason its set
 *            was full of positions that were already lost or already won: it
 *            is the only one whose answer can say whether anybody blundered.
 *
 * The `before` search is deliberately last even though it is conceptually
 * first. It costs the same as the confirm and would be wasted on the ninety
 * per cent of nominations that fail the head-to-head anyway.
 *
 * One thing that is refused before any engine is asked: a position inside the
 * random opening the game was seeded with. Those moves are weighted noise, not
 * play, and a puzzle whose premise is "your opponent blundered" should not be
 * built on a move nobody chose.
 */
async function minePuzzles(engine, game, cfg, seen, wanted, tally){
  const note = why => { if (tally) tally[why] = (tally[why] || 0) + 1; };
  const hits = [];
  /* The mistake has to be a move a bot chose. The first four to six plies are
     weighted noise — they are there so the corpus is not four openings deep,
     not because they are play — and a puzzle whose premise is "your opponent
     blundered" should not be built on a move nobody decided. Position i was
     reached by move i−1, so i−1 >= openPlies is the whole condition. */
  const from = Math.max(1, game.openPlies + 1);
  for (let i = from; i < game.states.length; i++){
    const st = game.states[i];
    if (!P.legalMoves(st, st.turn).length) continue;
    // a track with its pool already full is not worth an engine call: once the
    // middlegame is done, every search left goes looking for endgames
    if (!wanted(bucketFor(st))) continue;
    const fen = P.fenOf(st);
    if (seen.has(fen)) continue;

    const scan = await engine.ask({
      fen, multipv: 2, depth: cfg.scanDepth, objective: true
    });
    if (!sharpEnough(scan, cfg.nominate)) continue;

    // three lines, not two: the gap that matters is best against second, and a
    // third is what says whether the second was itself alone
    const deep = await engine.ask({
      fen, multipv: 3, depth: cfg.confirmDepth, objective: true
    });
    const lines = (deep.lines || []).filter(Boolean);
    if (lines.length < 2){ note('one legal move'); continue; }
    const best = R.lineScore(lines[0]), alt = R.lineScore(lines[1]);
    // Everything the two numbers already in hand can settle, settled before
    // the second search is spent: mayPass() knows the thresholds judge() will
    // apply and says when no value of `before` could possibly clear them.
    const doomed = R.mayPass(best, alt);
    if (doomed){ note(doomed); continue; }

    // and what it was worth before they moved. The search speaks for the side
    // to move, which here is the opponent, so it is flipped on the way in.
    const prevFen = P.fenOf(game.states[i - 1]);
    const was = await engine.ask({
      fen: prevFen, depth: cfg.beforeDepth, objective: true
    });
    const before = R.asSolver((was.lines || [])[0] || was, false);

    const v = R.judge({ before, best, alt });
    if (!v.ok){ note(v.why); continue; }
    hits.push({
      i, st, fen, v,
      first: lines[0].best,
      alt: { uci: lines[1].best, score: alt },
      score: { before, best, alt },
      prev: { fen: prevFen, move: game.uci[i - 1] },
      settleDepth: deep.settleDepth
    });
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
    const first = uciFind(h.st, h.first);
    if (!first) continue;
    const built = await buildLine(engine, h.fen, h.first, cfg);
    const rec = {
      fen: h.fen,
      moves: built.moves,
      replies: built.replies,
      kind: h.v.kind,
      prev: h.prev,
      alt: h.alt,
      eval: { before: h.score.before, best: h.score.best, alt: h.score.alt, end: null }
    };
    rec.themes = themesFor(rec);
    const dull = R.trivial(h.st, first, game.moves[h.i - 1], rec.themes, rec.moves.length);
    if (dull){ note(dull); continue; }
    seen.add(h.fen);
    lastPly = h.i;
    rec.bucket = bucketFor(h.st);
    rec.id = puzzleId(rec.bucket, rec.fen, rec.moves);
    rec.mistake = h.v.mistake;
    rec.gap = h.v.gap;
    rec.settleDepth = h.settleDepth;
    rec.seedRating = await seedRating(engine, rec.fen, rec.moves[0]);
    note('kept');
    note('kept:' + rec.bucket);
    found.push(rec);
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
    const carried = cfg.tallyIn ? JSON.parse(fs.readFileSync(cfg.tallyIn, 'utf8')) : null;
    console.log('re-cutting ladders from %s, no engine needed', cfg.poolsIn);
    return finish(cfg, pools, started, (carried && carried.__played) || 0, carried);
  }
  const pool = new Pool(cfg.jobs);
  /* A forked child outlives the parent that forked it on Unix, so a run stopped
     with Ctrl-C or a kill leaves a dozen Stockfish processes behind chewing
     through the machine — and the next person to go looking for them reaches
     for a pattern kill, which is how somebody else's run dies too. Stopping
     this one has to stop its own engines and nothing else's. */
  for (const sig of ['SIGINT', 'SIGTERM'])
    process.on(sig, () => { pool.quit(); process.exit(130); });
  const seen = new Set();
  // Why candidates were refused, counted. A run that looks at a hundred
  // thousand positions and keeps two hundred is only legible as a tally, and
  // the tally is how a threshold in puzzle_rules.js gets argued about: if
  // "no mistake" is nine tenths of it, the sweep is nominating sharp positions
  // rather than turning points and the nominator is what needs changing.
  const tally = {};
  // which tracks this run is for at all, and which of those still have room
  const hunting = b => !cfg.only || b === cfg.only;
  const wanted = b => hunting(b) && (!need || pools[b].length < need);
  // with a flat --games count there is no quota to fill, so nothing is ever full
  const full = () => need > 0 &&
    Object.keys(pools).filter(hunting).every(b => pools[b].length >= need);
  let played = 0;

  const cap = cfg.games || cfg.maxGames;
  while (played < cap && !full()){
    const batch = [];
    for (let k = 0; k < cfg.jobs && played + k < cap; k++) batch.push(played + k);
    await pool.map(batch, async (n, engine) => {
      const rnd = mulberry32(cfg.seed * 1000003 + n);
      const a = rnd() * PLAY_RUNGS.length | 0;
      const b = Math.max(0, Math.min(PLAY_RUNGS.length - 1,
        a + (rnd() * (2 * cfg.spread + 1) | 0) - cfg.spread));
      const rungs = [P.levelFor(PLAY_RUNGS[a]), P.levelFor(PLAY_RUNGS[b])];
      const game = await playGame(engine, rungs, rnd, cfg);
      for (const p of await minePuzzles(engine, game, cfg, seen, wanted, tally)) pools[p.bucket].push(p);
    });
    played += batch.length;
    /* Checkpoint after every batch, not at the end. A full run is over an hour
       and a scarce track can be several; a tool that only writes when it is
       finished is a tool nobody can stop, and "let it run, we cannot afford to
       lose it" is how a run nobody wanted keeps going. With the pool on disk,
       killing the run costs one batch and --poolsIn cuts the ladders from what
       it did find. */
    if (cfg.poolsOut) fs.writeFileSync(cfg.poolsOut, JSON.stringify(pools));
    process.stdout.write('\r  ' + played + ' games  ·  ' +
      Object.entries(pools).map(([b, l]) => b.slice(0, 3) + ' ' + l.length).join('  ·  ') + '   ');
  }
  pool.quit();
  console.log('');
  const total = Object.values(tally).reduce((a, b) => a + b, 0);
  console.log('  candidates judged: ' + total);
  for (const [why, n] of Object.entries(tally).sort((a, b) => b[1] - a[1]))
    console.log('    ' + why.padEnd(18) + String(n).padStart(6) + '   ' +
                (100 * n / (total || 1)).toFixed(1) + '%');
  return finish(cfg, pools, started, played, tally);
}

function finish(cfg, pools, started, played, tally){
  fs.mkdirSync(cfg.out, { recursive: true });
  if (cfg.poolsOut){
    fs.writeFileSync(cfg.poolsOut, JSON.stringify(pools));
    console.log('  pool kept in %s', cfg.poolsOut);
  }
  const tracks = {};
  for (const [name, list] of Object.entries(pools)){
    for (const p of list) p.rank = difficulty(p);
    /* What a record carries, and why more of it than the page needs.
       `fen`, `moves`, `themes` and `seedRating` are the puzzle. `prev`, `eval`,
       `alt` and `replies` are the *evidence* — the position the mistake was
       made from, what the three moves were worth, and how forced each defence
       was. They are in the file rather than in a log because they are what the
       explanation is written from and what a re-verification checks against:
       a claim that somebody blundered should be re-readable from the record
       that makes it, without replaying the game it came out of. */
    const track = ladder(list, cfg.track).map((p, i) => ({
      n: i + 1,
      id: p.id,
      fen: p.fen,
      moves: p.moves,
      themes: p.themes,
      seedRating: p.seedRating,
      settleDepth: p.settleDepth,
      kind: p.kind,
      prev: p.prev,
      alt: p.alt,
      eval: p.eval,
      replies: p.replies
    }));
    tracks[name] = track;
    fs.writeFileSync(path.join(cfg.out, name + '.json'), JSON.stringify(track, null, 1) + '\n');
    const seeds = track.map(p => p.seedRating);
    console.log('  %s.json  %d puzzles  ·  chosen from %d  ·  seed %d\u2192%d',
                name, track.length, list.length, seeds[0] || 0, seeds[seeds.length - 1] || 0);
  }
  writeReadme(cfg, tracks, pools, started, played, tally);
  console.log('done in %s min', ((Date.now() - started) / 60000).toFixed(1));
}

function writeReadme(cfg, tracks, pools, started, played, tally){
  const all = [].concat(tracks.opening, tracks.middlegame, tracks.endgame);
  const themes = {};
  for (const p of all) for (const t of p.themes) themes[t] = (themes[t] || 0) + 1;
  const rows = Object.entries(themes).sort((a, b) => b[1] - a[1])
    .map(([t, n]) => '| `' + t + '` | ' + n + ' |').join('\n');
  const band = name => {
    const t = tracks[name], s = t.map(p => p.seedRating);
    const punish = t.filter(p => p.kind === 'punish').length;
    return '| ' + name + ' | ' + t.length + ' | ' + pools[name].length + ' | ' +
           punish + ' | ' + (t.length - punish) + ' | ' +
           (s[0] || 0) + ' | ' + (s[Math.floor(s.length / 2)] || 0) + ' | ' + (s[s.length - 1] || 0) + ' |';
  };
  // why candidates were refused, which is the honest picture of the standard:
  // a threshold is only arguable next to the count of what it turned away
  const judged = Object.entries(tally || {})
    .filter(([k]) => k !== 'kept' && k.indexOf('kept:') !== 0 && k.indexOf('__') !== 0)
    .sort((a, b) => b[1] - a[1]);
  const total = judged.reduce((a, b) => a + b[1], 0) + ((tally && tally.kept) || 0);
  const refusals = judged
    .map(([w, n]) => '| `' + w + '` | ' + n + ' | ' + (100 * n / (total || 1)).toFixed(1) + '% |')
    .join('\n');

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
| Positions judged | ${total} |
| Random seed | \`${cfg.seed}\` |

| Track | Mined | Chosen from | Punish | Save | Easiest | Median | Hardest |
|---|---|---|---|---|---|---|---|
${band('opening')}
${band('middlegame')}
${band('endgame')}

**Mined**, not shipped. This table is the record of the run that found these
positions, judged at depth ${cfg.confirmDepth}; \`tools/verify_puzzles.js\` then takes the same
verdict again at depth 22 from outside, and drops what no longer clears it.
What actually shipped, and how much the second opinion removed, is the
*Checked against the engine* table at the bottom of this file.

A track is however many positions cleared the standard, not a fixed hundred.
That is deliberate and it is the whole difference between this set and the one
before it: padding a ladder to a round number means keeping puzzles that did
not earn their place, and one bad puzzle costs more than ten missing ones,
because it teaches a player to look for something that is not there.

Each track is still an ordered ladder — \`n\` 1 to however many, puzzle 1 the
easiest and the last one the hardest, walked in order, one unlocked by the last.

## What makes a position a puzzle

Bot against bot, rungs drawn from \`LEVELS\` in the page (${PLAY_RUNGS.join(', ')}
Elo), because games between equal and perfect engines contain no mistakes and
therefore no puzzles. The first 4–6 plies of each game are random, weighted
towards moves that look like chess, so the set is not four openings deep — and
nothing from inside that stretch is ever a puzzle, since a position is only
offered when the move that created it was one a bot chose.

The rule itself is \`judge()\` in \`tools/puzzle_rules.js\`, and it is the only
copy of it: the generator asks it while mining and the verifier asks it again,
deeper, over what shipped. Three numbers, all from the **solver's** point of
view — the side to move in the puzzle's position:

| | |
|---|---|
| \`B\` | what the position was worth **before the opponent's last move** |
| \`A1\` | what it is worth now, if the solver finds the move |
| \`A2\` | what it is worth now, if the solver plays the second-best move |

and three questions:

- **\`A1 − B\` — the mistake.** At least ${R.MISTAKE_MIN}cp. The opponent has to have
  thrown something away, or the position is merely sharp and always was, and
  the card would be saying "they blundered" about a move that did not.
- **\`A1 − A2\` — the point.** At least ${R.GAP_MIN}cp, measured by playing both moves
  and scoring what they lead to rather than by reading two numbers off one
  MultiPV list. Below it, the player who finds the other move is told they are
  wrong about a move that was just as good.
- **\`B\`, \`A1\`, \`A2\` — the stakes.** Which decides what kind of puzzle it is:

**Punish** — \`B\` no better than +${R.BEFORE_MAX} (level, or only slightly for the
solver), \`A1\` at least +${R.PUNISH_MIN}, and \`A2\` no better than +${R.PUNISH_ALT_MAX}. Something
was there to be won, finding it is what wins it, and it was not already won.

**Save** — \`B\` at or below ${R.BEFORE_SAVE} (the solver was worse, often lost), \`A2\`
at or below ${R.SAVE_ALT_MAX} (there is something to be saved from), and \`A1\` at least
${R.SAVE_MIN}: the move has to hold the balance or better. "The best move in a lost
position" is not a save, and refusing it is the single criterion that removes
most of what the previous set called a middlegame puzzle.

Two moves that both force mate are refused as well, however different the move
counts: the board accepts one of them, and a player who finds the other is
told they are wrong.

That is a strict rule and this is what it turned away.

| Refused because | Positions | |
|---|---|---|
${refusals}

Something can pass all of that and still not be worth showing. A recapture on
the square just captured on is forced rather than found; a piece lifted off the
board in one move with no pattern behind it teaches looking for undefended
pieces, which players do anyway; a move with only one legal square is not a
decision. Those are \`trivial()\`, beside the rule.

## Opening, middlegame, endgame

By what is on the board, not by the move number. Endgame is asked first,
because it is the one of the three with a real definition — few enough pieces
that the king is a fighting piece — and it is answered on material, with a
queen still on counting for more than what is left beside it. Opening is a
position with opening work still in it: most of the pawns there, pieces still
standing where they started. Everything else is a middlegame. A queen trade on
move nine leaves an endgame however early it is, and a game that shuffles to
move forty with all sixteen pieces on has not reached one.

## What the card says at the end

Every puzzle carries a \`why\`, written by \`tools/puzzle_words.js\` beside the
moves: what the opponent's move gave away, a sentence for each ply — including
why the runner-up move is not the answer and how forced each defence was — and
where the whole thing arrives. It is in the file because the puzzle screen has
no engine in it, deliberately, and \`server/test_puzzle_flow.js\` asserts that it
never grows one.

None of it is guessed. Every sentence is read off a position or off a number a
search already produced, and where nothing can be justified the card is shorter
instead — the discipline being that a confident sentence about a deflection
that is not on the board is worse than no sentence at all.

A freshly generated file has no \`why\` and no \`follow\`; both are written by
\`tools/verify_puzzles.js\`, which is also the only thing that measures them at
the verdict depth.

### Themes

| Theme | Puzzles |
|---|---|
${rows}

The first nine of those names are \`findMotifs()\`'s, the same function behind the
Study Board coach card, so a puzzle tagged \`fork\` is explained with the word
fork. The rest are what a whole puzzle carries and a single move does not: what
kind of answer it was, what it cost, and the two that are about the move before
it. Deflection, decoy, overloading, interference and double attack are
deliberately **not** claimed — each is an assertion about *why* a piece cannot
do its job, every cheap test for them fires where it is not true, and a puzzle
labelled with a tactic that is not there is worse than one labelled with a tag
fewer.

## The order of a ladder

The survivors are ranked, and the ladder is spaced **evenly in difficulty**
between the easiest thing found and the hardest — not the hardest of them, not
the first of them, and not every third puzzle in the pool. That last one is the
obvious method and the wrong one: self-play turns up far more easy tactics than
hard ones, so spacing by position spends the first quarter of a track on
puzzles that are all exactly as easy as each other. The rank key is

\`\`\`
seedRating + 40·settleDepth + 60·(plies−1) + 120·(quiet move) + 150·(sacrifice)
\`\`\`

\`seedRating\` leads because it is the only measurement of a player-like solver:
the puzzle's first move is replayed against every rung of the ladder — chance
switched off, best of three, because Skill Level scrambles the engine's own
choice on purpose — and the lowest rung that finds it twice names the rating
(${UNSOLVED_SEED} when none does). It has ten possible values and many more puzzles to
order, so the rest of the key breaks its ties with what actually makes a move
hard to see: the depth the search had to reach before it stopped changing its
mind, the number of moves in the line, whether the move captures or checks
anything at all, and whether it gives material away first.

It is a rank key, not an Elo. What the player is shown is \`seedRating\`, and
what corrects it is real attempts, through the Elo update in
\`server/server.py\`.

Analysis is bounded by depth rather than by time, so the puzzle *criteria* do
not depend on how fast the machine is — and every search that measures a
position rather than playing one is made with contempt switched off. That last
one is not a detail: this build applies contempt from the point of view of
whoever is to move at the root, so \`B\` and \`A1\` are read from opposite sides
and the same position comes out ~50cp better after any move than before it.
Left on, every move in every game looks like a blunder by exactly that much,
and the mistake this whole standard is built on is an artefact.

Regeneration is still not bit-for-bit reproducible: Stockfish seeds its Skill
Level randomness from the clock, so the self-play games and the seed ratings
both wander a little between runs even at the same \`--seed\`.

## Regenerating

\`\`\`bash
node tools/generate_puzzles.js --games 1600 --jobs ${cfg.jobs} --seed ${cfg.seed}
\`\`\`

Then check each track, which is where the verdict is taken at depth, the
explanations are written and the follow-ups are searched:

\`\`\`bash
node tools/verify_puzzles.js --track middlegame --write --resort
\`\`\`

Then bump the \`?v=\` on the three JSON files in \`blind-chess.html\`, because
\`server/server.py\` serves them with a week of cache. Regenerating renumbers
the ladders; progress is stored per puzzle id, so a player keeps whatever they
have already solved and loses only their place in the numbering.
`);
}

module.exports = {
  mulberry32, sharpEnough, bucketFor, puzzleId, themesFor,
  openingWeight, weightedPick, materialSwing, parseArgs, difficulty, ladder,
  // what tools/verify_puzzles.js reuses rather than re-derives: a corrected
  // line has to be built the way the shipped ones were, and a corrected puzzle
  // re-rated by the same ladder replay
  uciFind, buildLine, seedRating,
  PLAY_RUNGS, CLEAR_WIN, UNSOLVED_SEED, DEFAULTS
};

if (require.main === module) main().catch(err => { console.error(err); process.exit(1); });
