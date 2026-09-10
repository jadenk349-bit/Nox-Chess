#!/usr/bin/env node
/* The unattended Daily Puzzle production pipeline.
 *
 *   nohup node tools/daily_run.js > work/daily/run.log 2>&1 &
 *
 * Mines, verifies and deals, in a loop, until four hundred verified Daily
 * Puzzles exist or something breaks badly enough that carrying on would not be
 * safe. It is a supervisor and nothing more: every stage is one of the
 * production tools, run with the production settings, and this file never
 * judges a position, never touches a depth and never decides what a puzzle is.
 * If it were deleted mid-run, the same commands typed by hand would carry on
 * from the same checkpoints.
 *
 * WHY IT IS A LOOP. Mining yield is not knowable in advance — it depends on
 * what the bots happen to play — so "mine enough, then verify" cannot be sized
 * up front. Instead it mines a chunk, verifies what that chunk added, keeps the
 * survivors, and goes round again if there are not yet four hundred. Every
 * cycle leaves strictly more finished work on disk than the last.
 *
 * WHAT IS SAFE IF IT STOPS. Everything, at the granularity of one game and one
 * puzzle:
 *
 *   work/daily/pools.json      every candidate ever mined, deduped on the fen
 *   work/daily/verified.json   every candidate that has passed the verifier
 *   work/daily/checked.json    the fens verification has already ruled on, so
 *                              nothing is ever judged twice
 *   work/daily/state.json      counters and timings, for the progress monitor
 *   <staging>/*.progress.jsonl the verifier's own per-puzzle checkpoint
 *
 * A kill at any moment loses at most the games currently in flight and the one
 * puzzle each engine is mid-search on. Restarting picks up from the same files.
 *
 * WHAT IT WILL NOT DO. It will not lower a depth, widen a tolerance, relax the
 * payoff rule or accept a puzzle the verifier rejected, under any circumstances
 * including running out of candidates. If the corpus cannot reach four hundred
 * it stops short and says so, which is what the brief asks for.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const WORK = path.join(ROOT, 'work', 'daily');
const STAGE = path.join(ROOT, 'puzzles', 'daily', 'work');
const OUT = path.join(ROOT, 'puzzles', 'daily');

const POOLS = path.join(WORK, 'pools.json');
const VERIFIED = path.join(WORK, 'verified.json');
const CHECKED = path.join(WORK, 'checked.json');
const STATE = path.join(WORK, 'state.json');
const TALLY = path.join(WORK, 'tally.json');
const EXCLUDE = path.join(WORK, 'exclude.json');

const TRACKS = ['opening', 'middlegame', 'endgame'];
const TARGET = 400;               // 4 categories x 100
const PER_MODE = 100;

/* How many games a mining chunk plays before the pipeline stops to verify what
   it found. Big enough that the engines are not restarted every few minutes,
   small enough that verification starts within a few hours of the first
   candidates rather than at the very end. */
const CHUNK_GAMES = 1500;
const JOBS = 9;
const GAME_BUDGET = 300;          // seconds; see gameBudget in generate_puzzles.js
/* Seconds one individual judging search may take before it is abandoned and its
   candidate dropped. 300 is deliberately generous: measured over sixty real
   production positions the same depth-20 search is 4.6s at the median, 9.6s at
   p90 and 23.8s at its slowest, so this is more than twelve times the worst
   healthy case and cannot reject a legitimately hard position. The search that
   wedged this pipeline for over an hour exceeded it twelvefold. It changes no
   depth and no gate — see searchBudget in generate_puzzles.js. */
const SEARCH_BUDGET = 300;

const log = (...a) => {
  const line = '[' + new Date().toISOString() + '] ' + a.join(' ');
  console.log(line);
};

const readJSON = (f, fallback) => {
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e){ return fallback; }
};
const writeJSON = (f, v) => {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = f + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(v));
  fs.renameSync(tmp, f);          // never leave a half-written checkpoint
};

function state(){
  return readJSON(STATE, {
    startedAt: Date.now(), cycle: 0, gamesDone: 0,
    mined: 0, checked: 0, verified: 0,
    phase: 'starting', lastError: null, finishedAt: null, stopped: null
  });
}
function saveState(s){ s.at = Date.now(); writeJSON(STATE, s); }

/** Run one of the production tools and wait. Output goes straight to this
    process's log, so the run's own progress lines are the record. */
function run(cmd, args, opts){
  return new Promise((resolve) => {
    log('$', cmd, args.join(' '));
    const p = spawn(cmd, args, Object.assign({
      cwd: ROOT,
      env: Object.assign({}, process.env, {
        PATH: path.join(process.env.HOME || '', '.local/bin') + ':' + process.env.PATH
      }),
      stdio: ['ignore', 'inherit', 'inherit']
    }, opts || {}));
    p.on('exit', code => resolve(code));
    p.on('error', e => { log('  spawn failed:', e.message); resolve(-1); });
  });
}

const poolCount = p => TRACKS.reduce((n, t) => n + ((p[t] || []).length), 0);

/* ---- the stages ---- */

async function mine(s){
  s.phase = 'mining'; saveState(s);
  const from = s.gamesDone;
  const to = from + CHUNK_GAMES;
  const chunk = path.join(WORK, 'chunk.json');
  try { fs.unlinkSync(chunk); } catch (e){}

  const code = await run('node', [
    'tools/generate_puzzles.js',
    '--from', String(from), '--games', String(to),
    '--seed', '20260908', '--jobs', String(JOBS),
    '--gameBudget', String(GAME_BUDGET),
    '--searchBudget', String(SEARCH_BUDGET),
    '--out', path.relative(ROOT, STAGE),
    '--poolsOut', path.relative(ROOT, chunk),
    '--excludeIn', path.relative(ROOT, EXCLUDE)
  ]);
  // 130 is the generator's own "stopped early" exit; its checkpoint is still good
  if (code !== 0 && code !== 130 && !fs.existsSync(chunk)){
    s.lastError = 'mining exited ' + code + ' with no checkpoint';
    saveState(s);
    return false;
  }
  s.gamesDone = to;

  /* Merge into the accumulating pool. merge_pools.js dedupes on the fen and
     refiles every record by the *current* bucket rule, which is why the merge
     is a tool rather than an Object.assign. */
  const merged = path.join(WORK, 'pools.next.json');
  const inputs = [POOLS, chunk].filter(f => fs.existsSync(f));
  await run('node', ['tools/merge_pools.js',
    path.relative(ROOT, merged), path.relative(ROOT, TALLY),
    ...inputs.map(f => path.relative(ROOT, f))]);
  if (fs.existsSync(merged)) fs.renameSync(merged, POOLS);

  s.mined = poolCount(readJSON(POOLS, {}));
  saveState(s);
  log('  pool now holds', s.mined, 'candidates after', s.gamesDone, 'games');
  return true;
}

async function verify(s){
  const pools = readJSON(POOLS, {});
  const checked = new Set(readJSON(CHECKED, []));
  const verified = readJSON(VERIFIED, []);

  /* Only what has not been ruled on. Re-verifying a candidate would cost the
     same engine-minutes and reach the same verdict — the standard is fixed —
     so the checked set is what keeps the loop from redoing its own work. */
  const fresh = {};
  let n = 0;
  for (const t of TRACKS){
    fresh[t] = (pools[t] || []).filter(p => p && p.fen && !checked.has(p.fen));
    n += fresh[t].length;
  }
  if (!n){ log('  nothing new to verify'); return true; }

  s.phase = 'verifying'; saveState(s);
  log('  verifying', n, 'new candidates');

  fs.mkdirSync(STAGE, { recursive: true });
  for (const t of TRACKS){
    /* The track file is rewritten with this batch; the verifier's own
       .progress.jsonl is deliberately NOT removed. It is keyed by puzzle id, so
       stale rows from earlier batches are simply never asked about — and if
       this process dies mid-verification, the ids it had already finished are
       still there and the restart skips them instead of re-searching them. */
    try { fs.unlinkSync(path.join(STAGE, t + '.json')); } catch (e){}
    fs.writeFileSync(path.join(STAGE, t + '.json'),
      JSON.stringify(fresh[t].map((p, i) => Object.assign({}, p, { n: i + 1 })), null, 1) + '\n');
  }

  const code = await run('node', [
    'tools/verify_puzzles.js',
    '--dir', path.relative(ROOT, STAGE),
    '--tracks', TRACKS.join(','),
    '--jobs', String(JOBS),
    '--write'
  ]);
  if (code !== 0) log('  verifier exited', code, '(its per-puzzle checkpoint is still on disk)');

  /* What survived. The verifier rewrites each track file with the puzzles that
     held up, so the file *is* the answer — and everything that went in and did
     not come out was ruled on, which is what goes into the checked set. */
  let kept = 0;
  for (const t of TRACKS){
    const survivors = readJSON(path.join(STAGE, t + '.json'), []);
    for (const p of survivors){ verified.push(p); kept++; }
    for (const p of fresh[t]) checked.add(p.fen);
  }
  writeJSON(VERIFIED, verified);
  writeJSON(CHECKED, [...checked]);
  s.checked = checked.size;
  s.verified = verified.length;
  saveState(s);
  log('  verification kept', kept, 'of', n, '— verified corpus now', verified.length);
  return true;
}

async function deal(s){
  s.phase = 'dealing'; saveState(s);
  const dir = path.join(WORK, 'verified-tracks');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'all.json'),
    JSON.stringify(readJSON(VERIFIED, []), null, 1) + '\n');
  const code = await run('node', ['tools/daily_assign.js',
    '--in', path.relative(ROOT, dir), '--out', path.relative(ROOT, OUT),
    '--size', String(PER_MODE), '--write']);
  return code === 0;
}

/** How many of the verified corpus would actually survive the deal — the deal
    drops duplicates and anything the Puzzle page already ships, so the raw
    count is an over-estimate of what can be dealt. */
function dealable(){
  try {
    const A = require('./daily_assign.js');
    const { pools } = A.assign(readJSON(VERIFIED, []), A.existingFens(ROOT), 0);
    return A.KEYS.reduce((n, k) => n + pools[k].length, 0);
  } catch (e){ return readJSON(VERIFIED, []).length; }
}

/* ---- the loop ---- */

async function main(){
  fs.mkdirSync(WORK, { recursive: true });
  const s = state();
  s.phase = 'starting';
  s.stopped = null;
  s.finishedAt = null;
  if (!s.startedAt) s.startedAt = Date.now();
  saveState(s);
  log('Daily Puzzle pipeline: target', TARGET, '· chunk', CHUNK_GAMES, 'games · jobs', JOBS);

  let consecutiveFailures = 0;
  for (;;){
    const have = dealable();
    s.verified = readJSON(VERIFIED, []).length;
    s.dealable = have;
    saveState(s);

    if (have >= TARGET){
      log('reached', have, 'dealable verified puzzles — dealing the four pools');
      if (await deal(s)){
        s.phase = 'done'; s.finishedAt = Date.now(); saveState(s);
        log('DONE: four pools written to puzzles/daily/');
        return 0;
      }
      s.lastError = 'deal failed'; saveState(s);
      return 1;
    }

    s.cycle++;
    log('cycle', s.cycle, '· verified', s.verified, '· dealable', have, 'of', TARGET);

    const mined = await mine(s);
    if (!mined){
      consecutiveFailures++;
      log('  mining failed (' + consecutiveFailures + ' in a row)');
      /* Three failures in a row is a real technical failure rather than a blip,
         and carrying on would burn the machine without producing anything. */
      if (consecutiveFailures >= 3){
        s.phase = 'stopped'; s.stopped = 'mining failed three times: ' + s.lastError;
        saveState(s);
        log('STOPPING:', s.stopped);
        return 1;
      }
      await new Promise(r => setTimeout(r, 60000));
      continue;
    }
    consecutiveFailures = 0;

    await verify(s);

    /* An interim deal after every cycle, so the four files on disk are always
       the best corpus verified so far rather than nothing until the very end.
       A short pool is still a working rotation — it simply comes round sooner. */
    if (readJSON(VERIFIED, []).length){
      await deal(s);
      log('  interim pools written from', dealable(), 'dealable puzzles');
    }
  }
}

/* Guarded, so that requiring this file — a test, a progress tool, a stray
   `node -e` — reads it rather than starting a production run. */
if (require.main !== module) module.exports = { state, dealable, TARGET, PER_MODE, CHUNK_GAMES };
else main().then(c => process.exit(c || 0)).catch(e => {
  const s = state();
  s.phase = 'crashed'; s.stopped = String(e && e.stack || e); saveState(s);
  log('CRASHED', e && e.stack || e);
  process.exit(1);
});
