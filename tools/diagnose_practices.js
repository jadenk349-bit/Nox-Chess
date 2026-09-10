#!/usr/bin/env node
/* Why does Stage 5b produce nothing?
 *
 * Eleven hours, ten engines at full load, zero Middle Game Practices. The
 * generator prints only on success, so a run that never succeeds prints
 * nothing and there is no way to tell a broken funnel from an empty one.
 * This tool is the missing instrument: it runs the *same* code paths against
 * the *same* source of positions and counts every stage of the funnel, so the
 * failure can be located rather than guessed at.
 *
 * It changes nothing. It is a measurement, and it is bounded — a few dozen
 * games, minutes not hours.
 *
 * The control is the part that matters. Alongside the mined positions it runs
 * the identical +35 test over the **already verified middlegame puzzle
 * corpus**, where we know from the shipped data that 54% of records clear the
 * bar. If the mined stream fails and the known-good corpus also fails, the
 * fault is in the test; if the known-good corpus passes and the mined stream
 * does not, the fault is upstream in selection or nomination.
 *
 *   node tools/diagnose_practices.js --games 30 --jobs 8
 */

'use strict';

const fs = require('fs');
const P = require('./page_chess.js');
const R = require('./puzzle_rules.js');
const PR = require('./practice_rules.js');
const WP = require('./win_prob.js');
const G = require('./generate_puzzles.js');
const V = require('./verify_puzzles.js');
const GP = require('./generate_practices.js');
const { Pool } = require('./sf.js');

const cfg = Object.assign({}, GP.DEFAULTS, {
  kind: 'middlegame', games: 30, jobs: 8, book: 0, seed: 4242
});
for (let i = 2; i < process.argv.length; i += 2){
  const k = process.argv[i].replace(/^--/, '');
  if (k in cfg) cfg[k] = typeof cfg[k] === 'string' ? process.argv[i+1] : +process.argv[i+1];
}

const F = {                       // the funnel
  games: 0, plies: 0, midPositions: 0, sampled: 0,
  nomAsked: 0, nomPassed: 0, nomRejected: 0,
  wideAsked: 0, oneLegal: 0, twoMates: 0, obviousRejected: 0,
  reached35: 0, passed35: 0, unstable: 0, unscored: 0,
  swings: [], nomGaps: [], qualified: 0, errors: 0
};

const bestOf = res => ((res.lines || [])[0] || {}).best || res.best || null;
const ranked = res => (res.lines || []).filter(Boolean)
  .map(l => ({ uci: l.best, score: R.lineScore(l) }))
  .filter(l => l.uci && l.score !== null);

/* One position, walked through the same gates generate_practices uses, with a
   counter at every step. Deliberately a copy rather than a call: the point is
   to see *inside* tryMiddlegame(), and a function that returns one reason
   string cannot show where within itself it stopped. Every threshold is read
   from the same modules, so nothing here can drift from the real rule. */
async function funnel(engine, fen, prev){
  const st = P.stateFromFEN(fen);
  if (G.bucketFor(st) !== 'middlegame') return;
  F.sampled++;

  F.nomAsked++;
  const nom = await engine.ask({ fen, multipv: 2, depth: cfg.nomDepth, fresh: true, objective: true });
  const nl = ranked(nom);
  if (nl.length < 2){ F.oneLegal++; return; }
  const nomGap = nl[0].score - nl[1].score;
  F.nomGaps.push(nomGap);
  if (nomGap < cfg.nomGap){ F.nomRejected++; return; }
  F.nomPassed++;

  F.wideAsked++;
  const wide = await engine.ask({ fen, multipv: 3, depth: cfg.depth, fresh: true, objective: true });
  const lines = ranked(wide);
  if (lines.length < 2){ F.oneLegal++; return; }
  const best = lines[0].uci;
  const rival = (lines.find(l => l.uci !== best) || {}).uci;
  if (!rival){ F.oneLegal++; return; }

  const solver = st.turn;
  const after = async uci => {
    const rep = await engine.ask({ fen, moves: [uci], multipv: 2, depth: cfg.depth, fresh: true, objective: true });
    const def = bestOf(rep);
    const line = def ? [uci, def] : [uci];
    const end = V.walk(fen, line);
    if (!end) return { line, score: null };
    if (!P.legalMoves(end, end.turn).length)
      return { line, score: P.inCheck(end, end.turn) ? (end.turn===solver ? -R.MATE_SCORE : R.MATE_SCORE) : 0 };
    const res = await engine.ask({ fen, moves: line, multipv: 1, depth: cfg.verdictDepth, fresh: true, objective: true });
    const raw = R.lineScore((res.lines||[])[0] || res);
    return { line, score: raw === null ? null : (end.turn === solver ? raw : -raw) };
  };
  const A = await after(best), B = await after(rival);
  if (A.score === null || B.score === null){ F.unscored++; return; }

  const draft = { fen, moves: A.line, prev, kind: 'punish' };
  draft.themes = G.themesFor(draft);
  const easy = R.obvious(draft);

  /* The +35 test, reached at last. Counted before the verdict so that
     "how many got this far" and "how many passed" are separate numbers —
     the whole question is which of the two is zero. */
  F.reached35++;
  const swing = WP.swing(B.score, A.score);
  if (swing !== null) F.swings.push(swing);
  const v = PR.judgeMiddlegame({ best: A.score, alt: B.score, before: null,
                                obvious: PR.OPEN_EXEMPT.indexOf(easy) >= 0 ? null : easy });
  if (v.ok){ F.passed35++; }
  else if (v.why === 'two mates') F.twoMates++;
  else if (easy && v.why === easy) F.obviousRejected++;

  if (!v.ok) return;
  const deep = await engine.ask({ fen, multipv: 1, depth: cfg.deepDepth, fresh: true, objective: true });
  const settled = deep.best || bestOf(deep);
  if (settled && settled !== best){ F.unstable++; return; }
  F.qualified++;
}

/* The control: the identical +35 comparison over records we already know are
   turning points, using the numbers the verifier measured. No engine. */
function control(){
  let n = 0, pass = 0; const sw = [];
  for (const t of ['work/gen/middlegame.json', 'work/stage1/middlegame.json']){
    let list = [];
    try { list = JSON.parse(fs.readFileSync(t, 'utf8')); } catch (e){ continue; }
    for (const p of list){
      const e = p.eval || {};
      if (e.best === null || e.best === undefined || e.alt === null || e.alt === undefined) continue;
      n++;
      const s = WP.swing(e.alt, e.best);
      sw.push(s);
      if (PR.judgeMiddlegame({ best: e.best, alt: e.alt, before: e.before, obvious: null }).ok) pass++;
    }
  }
  sw.sort((a, b) => a - b);
  return { n, pass, median: sw.length ? sw[sw.length >> 1] : null };
}

const pct = (a, b) => b ? (a * 100 / b).toFixed(1) + '%' : '—';
const stats = a => {
  if (!a.length) return 'none';
  const s = a.slice().sort((x, y) => x - y);
  return 'min ' + s[0].toFixed(0) + '  median ' + s[s.length >> 1].toFixed(0) +
         '  p90 ' + s[Math.floor(s.length * .9)].toFixed(0) + '  max ' + s[s.length - 1].toFixed(0);
};

async function main(){
  const t0 = Date.now();
  console.log('=== MIDDLE GAME PRACTICE FUNNEL DIAGNOSTIC ===');
  console.log('games ' + cfg.games + '  jobs ' + cfg.jobs + '  perGameTries ' + cfg.perGameTries +
              '  nomDepth ' + cfg.nomDepth + '  nomGap ' + cfg.nomGap +
              '  depth ' + cfg.depth + '  verdict ' + cfg.verdictDepth + '\n');

  const c = control();
  console.log('CONTROL — the same +35 test over the already-verified corpus (no engine):');
  console.log('  records with both scores : ' + c.n);
  console.log('  passing judgeMiddlegame  : ' + c.pass + '  (' + pct(c.pass, c.n) + ')');
  console.log('  median alt->best swing   : +' + (c.median === null ? '?' : c.median.toFixed(1)) + ' points\n');

  const judge = new Pool(cfg.jobs, { native: true, threads: 1, hash: 512, wdl: true });
  const rungs = new Pool(cfg.jobs);
  await judge.engines[0].ready;
  const ladder = cfg.rungs.split(',').map(Number);

  await judge.map(Array.from({ length: cfg.games }, (_, i) => i), async (n, engine) => {
    const rnd = G.mulberry32(cfg.seed * 1000003 + n);
    const a = rnd() * ladder.length | 0;
    const levels = [P.levelFor(ladder[a]), P.levelFor(ladder[a])];
    const game = await G.playGame(rungs.engines[engine.slot], levels, rnd, cfg);
    F.games++; F.plies += game.states.length;

    const of = [];
    for (let i = game.openPlies; i < game.states.length - 1; i++)
      if (G.bucketFor(game.states[i]) === 'middlegame') of.push(i);
    F.midPositions += of.length;
    const stride = Math.max(1, Math.ceil(of.length / cfg.perGameTries));
    const picks = of.filter((_, k) => k % stride === 0).slice(0, cfg.perGameTries);

    for (const i of picks){
      const prev = i > 0 ? { fen: P.fenOf(game.states[i-1]), move: game.uci[i-1] } : null;
      try { await funnel(engine, P.fenOf(game.states[i]), prev); }
      catch (e){ F.errors++; }
    }
  });
  judge.quit(); rungs.quit();

  const secs = (Date.now() - t0) / 1000;
  console.log('MINED FUNNEL:');
  const row = (label, v, of) => console.log('  ' + label.padEnd(38) + String(v).padStart(6) +
                                            (of === undefined ? '' : '   ' + pct(v, of)));
  row('games completed', F.games);
  row('plies played', F.plies);
  row('middlegame positions in those games', F.midPositions);
  row('positions sampled (perGameTries cap)', F.sampled, F.midPositions);
  row('asked the cheap nominator', F.nomAsked);
  row('  rejected by nominator', F.nomRejected, F.nomAsked);
  row('  passed nominator', F.nomPassed, F.nomAsked);
  row('reached the full judge', F.wideAsked, F.nomPassed);
  row('  one legal move', F.oneLegal);
  row('  unscored', F.unscored);
  row('REACHED the +35 test', F.reached35, F.nomPassed);
  row('  passed +35', F.passed35, F.reached35);
  row('  rejected: two mates', F.twoMates, F.reached35);
  row('  rejected: obvious()', F.obviousRejected, F.reached35);
  row('rejected by depth stability', F.unstable);
  row('FINAL QUALIFIERS', F.qualified);
  row('errors', F.errors);
  console.log('\n  nominator gaps seen (cp) : ' + stats(F.nomGaps));
  console.log('  swings at the +35 test   : ' + stats(F.swings) + '   (need +35)');
  console.log('\n  wall ' + secs.toFixed(0) + 's   ' + (F.games / (secs / 3600)).toFixed(0) +
              ' games/hour   ' + (F.sampled / Math.max(secs, 1)).toFixed(2) + ' positions/sec');
  fs.writeFileSync('work/diagnostic.json', JSON.stringify({ cfg, control: c, funnel: F, secs }, null, 1));
  console.log('\n  written to work/diagnostic.json');
}

main().catch(e => { console.error(e); process.exit(1); });
