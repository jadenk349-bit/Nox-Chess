#!/usr/bin/env node
/* Opening and Middle Game Practices — mined and verified in one pass.
 *
 * A Practice is not a puzzle and this is not a second copy of the puzzle
 * pipeline. What it shares is everything that would be a liability in two
 * copies: the self-play (G.playGame, the same rungs), the engine pool
 * (sf.js, the same native Stockfish 18), the phase test (G.bucketFor), the
 * explanation writer (puzzle_words), the checkpoint and the shared queue
 * (verify_puzzles' own loadProgress/saveProgress/withBudget). What differs is
 * the standard, and that lives in tools/practice_rules.js where both kinds can
 * be read side by side.
 *
 * Why one tool rather than a generator and a verifier, when puzzles have two:
 * a puzzle is mined cheaply at depth 14 out of tens of thousands of positions
 * and then re-judged deeply, and the split exists because the cheap pass is
 * what makes the deep pass affordable. A Practice has no cheap pass worth
 * having — judgeOpening() needs a wide MultiPV search and judgeMiddlegame()
 * needs two scored continuations, and both are the full-depth searches anyway.
 * Splitting would mean paying for them twice.
 *
 * The order is Stage 5's order and it is not negotiable: the engine decides
 * the line, the line is locked, and only then is anything written about it.
 *
 *   node tools/generate_practices.js --kind opening --games 400
 *   node tools/generate_practices.js --kind middlegame --games 1200 --want 100
 */

'use strict';

const fs = require('fs');
const path = require('path');

const P = require('./page_chess.js');
const R = require('./puzzle_rules.js');
const PR = require('./practice_rules.js');
const WP = require('./win_prob.js');
const WORDS = require('./puzzle_words.js');
const EDU = require('./puzzle_education.js');
const G = require('./generate_puzzles.js');
const V = require('./verify_puzzles.js');
const BOOK = require('./opening_book.js');
const { Pool } = require('./sf.js');

const DEFAULTS = {
  kind: 'opening',                 // opening | middlegame
  games: 400,
  want: 100,                       // stop once this many have been verified
  jobs: Math.max(1, Math.min(12, require('os').cpus().length - 2)),
  seed: 1,
  out: path.join(__dirname, '..', 'practices'),
  threads: 1,
  hash: 512,
  /* The same depths the Puzzle verifier judges at. A Practice is a weaker
     *claim* than a puzzle — it need not win anything — and that is a matter of
     which thresholds apply, never of how hard the engine looked. Reading a
     practice at a shallower depth than a puzzle would mean the set with the
     softer standard also had the softer evidence. */
  depth: 22,                       // the working depth: best move, best defence
  verdictDepth: 24,                // what the move and its rival are worth
  deepDepth: 26,                   // the tie-break, when the two disagree
  wide: 6,                         // MultiPV for the opening's field of moves
  /* Which rungs play. The established mix, and the same one the puzzle run
     uses: strong enough that a mistake is one a person could make, weak enough
     that mistakes happen at all. */
  rungs: '1600,1600,2000,2000,2000',
  spread: 0,
  gameLength: 120,
  perGame: 3,
  /* ---- what actually stalled the first Stage 5b run ----
   *
   * `perGame` caps how many practices one game may *contribute*, and it only
   * counts successes. Under a gate as strict as +35 points almost nothing
   * succeeds, so the cap never engaged and every game was examined
   * exhaustively: a 57-ply game holds ~40 middlegame positions, each costing
   * six searches at depth 22/24/26, so one game demanded ~240 deep searches —
   * forty minutes or more. Ten engines chewed through four games in five hours
   * and produced nothing. The engines were busy the whole time; the work was
   * simply hopeless.
   *
   * Two knobs fix it, and neither touches the standard:
   *
   *   perGameTries  how many positions a single game may be *asked about* at
   *                 all. A hard ceiling on cost per game, so no one game can
   *                 consume the run. Positions are taken with a stride across
   *                 the middlegame rather than from the front, or every sample
   *                 would come from the same phase of every game.
   *
   *   nomDepth /    a cheap nominating pass, exactly the architecture
   *   nomGap        generate_puzzles.js already uses (scan 14, confirm 20).
   *                 One shallow two-line search rejects a position for ~0.3s
   *                 instead of ~60s. It may only ever *nominate*: it is
   *                 allowed to be generous and forward something that later
   *                 fails, and it must never be the thing that decides.
   *
   * +35 points needs roughly a 380cp swing even where the curve is steepest,
   * so a 150cp bar at depth 14 is far on the generous side of necessary. */
  perGameTries: 20,
  nomDepth: 14,
  nomGap: 150,
  /* An opening practice comes out of the first stretch of a real game, so the
     book is on for that kind and off for the other — a middlegame does not
     care how the players got there, and random openings keep the corpus from
     being four openings deep. */
  book: null,                      // null = decided by kind
  budget: 0,                       // no time-based rejection, ever
  write: false,
  limit: 0
};

/* ------------------------------------------------------------- machinery */

/* Its own argument parser, and the reason is small but real: the other two
   tools each close over their own DEFAULTS, so neither parseArgs can be handed
   a third table. Three lines of duplication beats exporting a fourth thing
   from a file that already exports enough. `--no-x` and bare flags behave as
   they do everywhere else here. */
function parseArgs(argv){
  const cfg = Object.assign({}, DEFAULTS);
  for (let i = 0; i < argv.length; i++){
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    if (a.startsWith('--no-')){
      const off = a.slice(5);
      if (typeof cfg[off] !== 'boolean') throw new Error('unknown option ' + a);
      cfg[off] = false;
      continue;
    }
    const k = a.slice(2);
    if (!(k in cfg)) throw new Error('unknown option --' + k);
    if (typeof cfg[k] === 'boolean') cfg[k] = true;
    else if (typeof cfg[k] === 'number' || cfg[k] === null) cfg[k] = +argv[++i];
    else cfg[k] = argv[++i];
  }
  return cfg;
}

const clean = engine => ({ ask: o => engine.ask(Object.assign({ fresh: true }, o)) });
const bestOf = res => ((res.lines || [])[0] || {}).best || res.best || null;

/** A stable id for a practice: the kind, the position, and the move taught. */
function practiceId(kind, fen, move){
  const h = require('crypto').createHash('sha1')
    .update(kind + '|' + fen + '|' + move).digest('hex').slice(0, 10);
  return (kind === 'opening' ? 'op' : 'mp') + '-' + h;
}

/** Ranked lines from one search, as practice_rules wants them. */
function ranked(res){
  return (res.lines || []).filter(Boolean)
    .map(l => ({ uci: l.best, score: R.lineScore(l) }))
    .filter(l => l.uci && l.score !== null);
}

/* ------------------------------------------------------ opening practices */

/**
 * One opening position, judged.
 *
 * A wide search gives the field; judgeOpening() decides whether the field is
 * shaped like a question. Then the answer is confirmed the way every solver
 * move in this project is confirmed — MultiPV 1 says what the engine actually
 * plays, and where that disagrees with the ranking the deeper look breaks the
 * tie — and the opponent's reply is its own best defence.
 */
async function tryOpening(engine, fen, prev, cfg){
  const st = P.stateFromFEN(fen);
  if (G.bucketFor(st) !== 'opening') return { why: 'not an opening position' };
  const real = PR.realisticOpening(st);
  if (real) return { why: real };

  const wide = await engine.ask({ fen, multipv: cfg.wide, depth: cfg.verdictDepth,
                                  fresh: true, objective: true });
  const lines = ranked(wide);
  if (lines.length < 2) return { why: 'one legal move' };

  /* The human half. obvious() wants a record, and the record it is given is
     the one-move line this position would ship as — which is exactly what is
     being asked about. Its two length complaints are waived for openings
     inside judgeOpening(); everything else it can say still counts. */
  const draft = { fen, moves: [lines[0].uci], prev,
                  themes: G.themesFor({ fen, moves: [lines[0].uci], prev, kind: 'punish' }) };
  const verdict = PR.judgeOpening({ lines, phase: 'opening', obvious: R.obvious(draft) });
  if (!verdict.ok) return { why: verdict.why };

  /* Depth stability. The ranking came from a MultiPV search; what the engine
     *plays* is a MultiPV 1 question, and the two are allowed to differ. If
     they do, the primary answer is whichever survives the deeper look — and
     if the deeper look prefers something outside the accepted set, the set was
     wrong and the position is dropped rather than re-cut. */
  const one = await engine.ask({ fen, multipv: 1, depth: cfg.verdictDepth,
                                 fresh: true, objective: true });
  const plays = one.best || bestOf(one);
  if (plays && verdict.accept.indexOf(plays) < 0){
    const deep = await engine.ask({ fen, multipv: 2, depth: cfg.deepDepth,
                                    fresh: true, objective: true });
    const settled = bestOf(deep);
    if (settled && verdict.accept.indexOf(settled) < 0)
      return { why: 'unstable: depth ' + cfg.deepDepth + ' plays ' + settled +
                    ', outside the accepted set' };
  }
  const primary = (plays && verdict.accept.indexOf(plays) >= 0) ? plays : verdict.primary;

  /* The opponent's best defence, which is what the card explains last. Two
     lines wide for the same reason every reply in this project is: a
     single-line search can decline to mention a better one. */
  const reply = await engine.ask({ fen, moves: [primary], multipv: 2, depth: cfg.depth,
                                   fresh: true, objective: true });
  const defence = bestOf(reply);
  if (!defence) return { why: 'no reply' };

  return {
    ok: true,
    rec: {
      kind: 'opening',
      fen, prev,
      moves: [primary, defence],       // the answer, and their best answer to it
      accept: verdict.accept,
      foil: verdict.foil,
      band: verdict.band,
      gap: verdict.gap,
      pct: verdict.pct,
      wdl: wide.wdl || null,
      settleDepth: wide.settleDepth,
      id: practiceId('opening', fen, primary)
    }
  };
}

/* --------------------------------------------------- middlegame practices */

/**
 * One middlegame position, judged against the +35 rule.
 *
 * Both candidate moves are *played* and the position each leads to is scored
 * under the opponent's best defence — never read off a MultiPV ranking, for
 * the reason betterBy() gives in the verifier: asking for two lines changes
 * the pruning, so the move a two-line search names first is not always the
 * move a one-line search plays.
 */
async function tryMiddlegame(engine, fen, prev, cfg){
  const st = P.stateFromFEN(fen);
  const solver = st.turn;
  if (G.bucketFor(st) !== 'middlegame') return { why: 'not a middlegame position' };

  /* The cheap pass. It nominates and never decides — see nomGap above. A
     position whose two best moves are within 150cp of each other at depth 14
     is not going to produce a 35-point swing at depth 24 under best defence,
     and finding that out here costs a fraction of a second instead of a
     minute. Everything it forwards is judged again, in full, below. */
  if (cfg.nomGap > 0){
    const nom = await engine.ask({ fen, multipv: 2, depth: cfg.nomDepth,
                                   fresh: true, objective: true });
    const nl = ranked(nom);
    if (nl.length < 2) return { why: 'one legal move' };
    if (nl[0].score - nl[1].score < cfg.nomGap)
      return { why: 'nominator: gap under ' + cfg.nomGap + 'cp at depth ' + cfg.nomDepth };
  }

  const wide = await engine.ask({ fen, multipv: 3, depth: cfg.depth,
                                  fresh: true, objective: true });
  const lines = ranked(wide);
  if (lines.length < 2) return { why: 'one legal move' };
  const best = lines[0].uci;
  const rival = (lines.find(l => l.uci !== best) || {}).uci;
  if (!rival) return { why: 'one legal move' };

  /* Each move, then the best defence to it, then the score of what is left —
     which is what "must hold under the opponent's best defence" means. */
  /* Score a candidate move under the opponent's best reply, from the SOLVER's
     side. The perspective is the whole of this function and it was wrong.
   *
   * verify_puzzles' scoreAfter() negates what the engine reports, because it
   * is always handed a puzzle line — odd length, ending on the solver's move,
   * so the opponent is to move afterwards and negation is what turns the
   * search's answer into the solver's. A practice line is [move, defence]:
   * **even**, so the solver is to move again and the search already speaks for
   * them. Negating it a second time handed back the opponent's view of every
   * position, which is why every measured swing came out at or below zero and
   * a +35 gate could never be met by anything. The diagnostic caught it as
   * `swings: min -93 median -17 max 0` — a best move can never score worse
   * than the runner-up, so a non-positive spread is a sign error and not a
   * scarcity of good positions.
   *
   * So the score is read directly rather than through scoreAfter(), and the
   * parity that makes that correct is asserted rather than assumed. */
  const after = async uci => {
    const rep = await engine.ask({ fen, moves: [uci], multipv: 2, depth: cfg.depth,
                                   fresh: true, objective: true });
    const def = bestOf(rep);
    const line = def ? [uci, def] : [uci];
    const end = V.walk(fen, line);
    if (!end) return { line, defence: def, score: null };
    if (!P.legalMoves(end, end.turn).length)
      return { line, defence: def,
               score: P.inCheck(end, end.turn)
                 ? (end.turn === solver ? -R.MATE_SCORE : R.MATE_SCORE) : 0 };
    const res = await engine.ask({ fen, moves: line, multipv: 1, depth: cfg.verdictDepth,
                                   fresh: true, objective: true });
    const raw = R.lineScore((res.lines || [])[0] || res);
    // whoever is to move at the end of the line is who the search speaks for
    const s = raw === null ? null : (end.turn === solver ? raw : -raw);
    return { line, defence: def, score: s };
  };
  const A = await after(best);
  const B = await after(rival);
  if (A.score === null || B.score === null) return { why: 'unscored' };

  const beforeScore = prev && prev.fen
    ? R.asSolver((await engine.ask({ fen: prev.fen, depth: cfg.verdictDepth,
                                     fresh: true, objective: true })).lines[0], false)
    : null;

  const draft = { fen, moves: A.line, prev, kind: 'punish' };
  draft.themes = G.themesFor(draft);
  /* obvious()'s two *length* complaints do not apply to a practice, for the
     same reason they are waived for an opening: a practice line is the move
     and the best reply to it — two plies by construction — so "one move" fires
     on every single one of them. The diagnostic measured it rejecting 62% of
     everything that reached the test, on a rule about puzzle length rather
     than about whether a human has to think. Every other thing obvious() can
     say still counts: a practice whose answer is "take the piece they just
     hung" is as worthless as a puzzle's. */
  const easy = R.obvious(draft);
  const verdict = PR.judgeMiddlegame({ best: A.score, alt: B.score, before: beforeScore,
                                       obvious: PR.OPEN_EXEMPT.indexOf(easy) >= 0 ? null : easy });
  if (!verdict.ok) return { why: verdict.why };

  /* Depth stability, the same tie-break the puzzles get: if the deeper look
     prefers the rival, the move being taught is not the move. */
  const deep = await engine.ask({ fen, multipv: 1, depth: cfg.deepDepth,
                                  fresh: true, objective: true });
  const settled = deep.best || bestOf(deep);
  if (settled && settled !== best)
    return { why: 'unstable: depth ' + cfg.deepDepth + ' plays ' + settled };

  return {
    ok: true,
    rec: {
      kind: 'middlegame',
      fen, prev,
      moves: A.line,
      alt: { uci: rival, score: B.score },
      swing: verdict.swing,
      mistake: verdict.mistake,
      pct: verdict.pct,
      wdl: wide.wdl || null,
      settleDepth: wide.settleDepth,
      id: practiceId('middlegame', fen, best)
    }
  };
}

/* ------------------------------------------------------------------ main */

async function main(){
  const cfg = parseArgs(process.argv.slice(2));
  if (cfg.book === null) cfg.book = cfg.kind === 'opening' ? 1 : 0;
  const isOpening = cfg.kind === 'opening';
  const outFile = path.join(cfg.out, cfg.kind + '.json');
  fs.mkdirSync(cfg.out, { recursive: true });

  /* Durable checkpointing, by practice id.
   *
   * Every practice that clears the standard is appended to
   * <out>/<kind>.json.progress.jsonl the instant it is verified — the same
   * mechanism verify_puzzles.js uses, reused rather than reimplemented. A run
   * killed at any moment keeps everything it had finished, and a restart loads
   * those ids and refuses to bank them a second time. Ids are a hash of the
   * kind, the position and the move taught, so the same position found again
   * in a later game is recognised as already done rather than duplicated. */
  const done = V.loadProgress(outFile);
  const already = new Set();
  const kept = [];
  for (const r of done.values()) if (r.puzzle){ already.add(r.puzzle.id); kept.push(r.puzzle); }
  console.log(cfg.kind + ' practices: want ' + cfg.want + ', from ' + cfg.games + ' games' +
              (already.size ? '  (' + already.size + ' already verified, resuming)' : ''));

  const judge = new Pool(cfg.jobs, { native: true, threads: cfg.threads,
                                     hash: cfg.hash, wdl: true });
  const rungs = new Pool(cfg.jobs);
  await judge.engines[0].ready;
  console.log('  judge: ' + (judge.engines[0].id || '?') + '  ·  ' + cfg.jobs +
              ' engines  ·  work ' + cfg.depth + ', verdict ' + cfg.verdictDepth +
              ', tie-break ' + cfg.deepDepth + (isOpening ? ', field ' + cfg.wide : ''));
  console.log('  rungs: ' + cfg.rungs + '  ·  book ' + cfg.book +
              '  ·  no time-based rejection');

  for (const sig of ['SIGINT', 'SIGTERM'])
    process.on(sig, () => { judge.quit(); rungs.quit(); process.exit(130); });

  const tally = {};
  const seen = new Set();
  let played = 0, judged = 0;
  const ladder = cfg.rungs.split(',').map(Number);

  /* ---- read-only progress, written to disk ----
   *
   * The first Stage 5b run printed nothing for eleven hours because this
   * generator only wrote on success, and a run that never succeeds writes
   * nothing at all. Two status reports could not answer "how many games have
   * you done" for that reason. So the funnel is counted and flushed to a small
   * JSON file on a timer: a monitor can read it at any moment without touching
   * the run, and a stall is visible in the counters rather than inferred from
   * CPU time. It is never read back — purely an instrument. */
  const F = { games: 0, positions: 0, nominated: 0, reached35: 0,
              qualified: 0, errors: 0, started: Date.now() };
  const progressFile = path.join(cfg.out, cfg.kind + '.progress.json');
  const flush = () => {
    const secs = (Date.now() - F.started) / 1000;
    try {
      fs.writeFileSync(progressFile, JSON.stringify(Object.assign({}, F, {
        want: cfg.want, maxGames: cfg.games, elapsedSec: Math.round(secs),
        gamesPerHour: secs > 0 ? +(F.games / (secs / 3600)).toFixed(0) : 0,
        qualifyRate: F.reached35 ? +(F.qualified / F.reached35 * 100).toFixed(1) : 0,
        updated: new Date().toISOString()
      }), null, 1));
    } catch (e){ /* an instrument must never break the run */ }
  };
  const beat = setInterval(flush, 15000);
  if (beat.unref) beat.unref();
  flush();

  await judge.map(Array.from({ length: cfg.games }, (_, i) => i), async (n, engine) => {
    if (kept.length >= cfg.want) return;
    const rnd = G.mulberry32(cfg.seed * 1000003 + n);
    const a = rnd() * ladder.length | 0;
    const b = Math.max(0, Math.min(ladder.length - 1,
      a + (rnd() * (2 * cfg.spread + 1) | 0) - cfg.spread));
    const levels = [P.levelFor(ladder[a]), P.levelFor(ladder[b])];
    const game = await G.playGame(rungs.engines[engine.slot], levels, rnd, cfg);
    played++; F.games++;

    /* Which plies to look at. An opening practice wants the early game and a
       middlegame practice wants the rest, and asking the phase test first is
       what keeps a run from paying to judge positions of the wrong kind. */
    /* Which plies this game is allowed to cost.
     *
     * Collect the positions of the right phase first, then take at most
     * perGameTries of them with an even stride. Striding matters: the first
     * ten middlegame positions of every game are all the same part of every
     * game, and a corpus sampled that way is a corpus about move 20. */
    const of = [];
    for (let i = game.openPlies; i < game.states.length - 1; i++){
      const b = G.bucketFor(game.states[i]);
      if (isOpening ? b === 'opening' : b === 'middlegame') of.push(i);
    }
    const stride = Math.max(1, Math.ceil(of.length / cfg.perGameTries));
    const picks = of.filter((_, k) => k % stride === 0).slice(0, cfg.perGameTries);

    let took = 0;
    for (const i of picks){
      if (took >= cfg.perGame) break;
      if (kept.length >= cfg.want) break;
      const st = game.states[i];
      const fen = P.fenOf(st);
      if (seen.has(fen)) continue;
      seen.add(fen);
      const prev = i > 0
        ? { fen: P.fenOf(game.states[i - 1]), move: game.uci[i - 1] } : null;

      judged++; F.positions++;
      let r;
      try {
        r = isOpening ? await tryOpening(engine, fen, prev, cfg)
                      : await tryMiddlegame(engine, fen, prev, cfg);
      } catch (e){ r = { why: 'error: ' + e.message }; }
      if (!r.ok){
        const why = r.why.replace(/\([^)]*\)/, '').trim();
        tally[why] = (tally[why] || 0) + 1;
        if (!/^nominator/.test(why)) F.nominated++;
        if (/points \(needs|two mates|swing/.test(why)) F.reached35++;
        continue;
      }
      F.nominated++; F.reached35++;

      /* Stage 5: the line is locked, and only now is anything written about
         it. explain() reads the record; auditClaims() then re-reads every
         sentence against the board the line actually reaches and strikes what
         it cannot justify. */
      r.rec.themes = G.themesFor(r.rec);
      r.rec.eval = { before: null, best: null, alt: null, end: null };
      if (!isOpening){
        r.rec.eval.alt = r.rec.alt.score;
        r.rec.eval.best = WP.cpForPct(r.rec.pct.best);
      }
      /* Words, then concepts, then the audit — the puzzle order exactly.
         The line is locked by this point: the move, the best defence and the
         scores are all decided, so nothing written here can describe a line
         that later changes. Education text lands inside the same per-ply
         sentences auditClaims() reads, so a concept sentence promising
         material the line never wins is struck like any other. */
      r.rec.why = WORDS.explain(r.rec);
      r.rec.concepts = EDU.educate(r.rec, cfg);
      r.rec.struck = WORDS.auditClaims(r.rec);
      /* Already banked by an earlier run, or by an earlier game in this one.
         Nothing is lost and nothing is counted twice. */
      if (already.has(r.rec.id)){ tally['already verified'] = (tally['already verified'] || 0) + 1; continue; }
      already.add(r.rec.id);
      kept.push(r.rec);
      took++;
      // on disk before the next candidate is even started
      V.saveProgress(outFile, r.rec.id, { puzzle: r.rec, note: { id: r.rec.id } });
      F.qualified = kept.length; flush();
      process.stdout.write('.' + (kept.length % 50 ? '' : ' ' + kept.length + '\n'));
    }
  });

  clearInterval(beat); F.qualified = kept.length; flush();
  judge.quit(); rungs.quit();
  process.stdout.write('\n');
  console.log('played ' + played + ' games  ·  judged ' + judged +
              ' positions  ·  kept ' + kept.length);
  console.log('\nwhy the rest were refused:');
  for (const [k, v] of Object.entries(tally).sort((a, b) => b[1] - a[1]).slice(0, 20))
    console.log('  ' + String(v).padStart(5) + '  ' + k);

  /* Order, then number. Practices are a ladder like everything else: the
     easiest first, and for an opening that is the widest cut (most obviously
     one move) while for a middlegame it is the biggest swing. */
  kept.sort((a, b) => isOpening ? b.gap - a.gap : b.swing - a.swing);
  kept.forEach((p, i) => { p.n = i + 1; });

  if (cfg.write){
    fs.writeFileSync(outFile, JSON.stringify(kept, null, 1));
    console.log('\nwrote ' + kept.length + ' to ' + outFile);
  } else {
    console.log('\n(report only; --write to save)');
  }
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });

module.exports = { tryOpening, tryMiddlegame, practiceId, ranked, DEFAULTS };
