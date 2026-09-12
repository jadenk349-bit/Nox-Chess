#!/usr/bin/env node
/* Where the Daily Puzzle production run has got to.
 *
 *   node tools/daily_progress.js
 *   node tools/daily_progress.js --json
 *
 * Read-only, and that is the whole point: it opens the same checkpoint files
 * the run writes and never signals, never locks, never truncates. Asking it a
 * question costs the run nothing, so it can be asked as often as anybody likes
 * while a twelve-hour pipeline is in flight.
 *
 * It reads four things, in the order the pipeline produces them:
 *
 *   work/daily/mine.log        what the generator has printed — games finished
 *   work/daily/pools.json      the generator's checkpoint — candidates mined
 *   <work>/*.json.progress.jsonl   the verifier's per-puzzle results
 *   puzzles/daily/*.json       the finished pools, once they are dealt
 *
 * Nothing here infers a stage that has not started: a missing file is reported
 * as "not started" rather than as zero, because those are different facts and
 * only one of them is a reason to worry.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const WORK = path.join(ROOT, 'work', 'daily');
const STAGE = path.join(ROOT, 'puzzles', 'daily', 'work');
const OUT = path.join(ROOT, 'puzzles', 'daily');
const MODES = ['blindfold', 'board', 'fog', 'sighted'];
const TRACKS = ['opening', 'middlegame', 'endgame'];

const exists = p => { try { return fs.statSync(p); } catch (e){ return null; } };
const ago = ms => {
  const s = Math.round(ms / 1000);
  if (s < 90) return s + 's';
  if (s < 5400) return (s / 60).toFixed(1) + ' min';
  return (s / 3600).toFixed(1) + ' h';
};

/* ---- the mining stage ---- */
function mining(){
  const log = path.join(WORK, 'mine.log');
  const pools = path.join(WORK, 'pools.json');
  const st = exists(log), ps = exists(pools);
  if (!st && !ps) return { stage: 'mine', state: 'not started' };

  const out = { stage: 'mine', state: 'running' };
  if (st){
    out.startedAt = st.birthtimeMs || st.ctimeMs;
    out.elapsedMs = Date.now() - out.startedAt;
    /* The generator rewrites one line with \r, so the last carriage return
       carries the current count. Only the tail is read: the log grows for
       hours and none of the rest of it is the answer. */
    const size = st.size;
    const from = Math.max(0, size - 65536);
    const fd = fs.openSync(log, 'r');
    const buf = Buffer.alloc(size - from);
    fs.readSync(fd, buf, 0, buf.length, from);
    fs.closeSync(fd);
    const text = buf.toString('utf8');
    const bits = text.split(/[\r\n]/).filter(x => /\d+ games/.test(x));
    const last = bits[bits.length - 1] || '';
    const m = last.match(/(\d+)\s+games/);
    if (m) out.games = +m[1];
    out.line = last.trim();
    // the refusal tally, if the run has printed one (it does at the end)
    const tally = text.match(/^\s{2,}(\w[\w ]*?)\s+(\d+)\s+\d+\.\d%$/gm);
    if (tally) out.refusals = tally.map(t => t.trim());
    out.logIdleMs = Date.now() - st.mtimeMs;
  }
  if (ps){
    const p = JSON.parse(fs.readFileSync(pools, 'utf8'));
    out.candidates = {};
    let total = 0;
    for (const k of TRACKS){ out.candidates[k] = (p[k] || []).length; total += out.candidates[k]; }
    out.candidatesTotal = total;
    out.checkpointAgeMs = Date.now() - ps.mtimeMs;
  }
  if (out.games && out.elapsedMs) out.gamesPerMin = +(out.games / (out.elapsedMs / 60000)).toFixed(1);
  return out;
}

/* ---- the verification stage ---- */
function verifying(){
  const out = { stage: 'verify', state: 'not started', accepted: 0, rejected: 0, why: {}, perTrack: {} };
  let any = false;
  for (const t of TRACKS){
    const f = path.join(STAGE, t + '.json.progress.jsonl');
    const st = exists(f);
    if (!st) continue;
    any = true;
    out.state = 'running';
    const rows = fs.readFileSync(f, 'utf8').split('\n').filter(Boolean);
    let ok = 0, no = 0;
    for (const line of rows){
      let r;
      try { r = JSON.parse(line); } catch (e){ continue; }
      /* The verifier records a verdict per puzzle. A record it keeps is one
         that cleared the whole standard; anything else carries the reason it
         did not, which is the half worth reading. */
      if (r.drop || r.dropped || r.verdict === 'drop' || r.kept === false){
        no++;
        const why = r.why || r.reason || r.verdict || 'dropped';
        out.why[why] = (out.why[why] || 0) + 1;
      } else { ok++; }
    }
    out.perTrack[t] = { checked: rows.length, kept: ok, dropped: no };
    out.accepted += ok;
    out.rejected += no;
    out.lastWriteMs = Math.min(out.lastWriteMs === undefined ? Infinity : out.lastWriteMs,
                               Date.now() - st.mtimeMs);
  }
  if (!any) return out;
  // and what has actually been written back to the track files
  for (const t of TRACKS){
    const f = path.join(STAGE, t + '.json');
    const st = exists(f);
    if (!st) continue;
    try { out.perTrack[t] = Object.assign(out.perTrack[t] || {},
      { inFile: JSON.parse(fs.readFileSync(f, 'utf8')).length }); } catch (e){}
  }
  return out;
}

/* ---- the supervisor's own counters, and what they project to ----
 *
 * The ETA is recomputed from measured yield every time this is asked, never
 * from an estimate made when the run started. Three numbers do it, and all
 * three come from work the run has actually finished: candidates per game,
 * the share of candidates verification keeps, and games per minute. Early on
 * they are noisy — a handful of candidates is a handful — so the confidence
 * is reported alongside rather than hidden.
 */
function projection(){
  const st = (function(){ try {
    return JSON.parse(fs.readFileSync(path.join(WORK, 'state.json'), 'utf8'));
  } catch (e){ return null; } })();
  if (!st) return null;

  const out = { phase: st.phase, cycle: st.cycle, games: st.gamesDone,
                mined: st.mined, checked: st.checked, verified: st.verified,
                dealable: st.dealable, stopped: st.stopped, lastError: st.lastError,
                startedAt: st.startedAt, finishedAt: st.finishedAt };
  out.elapsedMs = Date.now() - (st.startedAt || Date.now());

  const m = mining();
  const games = st.gamesDone || m.games || 0;
  const mined = m.candidatesTotal !== undefined ? m.candidatesTotal : (st.mined || 0);
  const perGame = games ? mined / games : 0;
  const survival = st.checked ? (st.verified || 0) / st.checked : 0;
  const rate = m.gamesPerMin || null;

  out.candidatesPerGame = +perGame.toFixed(4);
  out.verificationSurvival = st.checked ? +(survival * 100).toFixed(1) : null;
  out.gamesPerMin = rate;

  const have = st.dealable || 0;
  const need = 400 - have;
  if (need <= 0){ out.remaining = 0; out.eta = 'complete'; return out; }
  /* Until verification has ruled on anything there is no survival rate to use,
     so the smoke sample's third is the stand-in and is labelled as such. */
  const surv = st.checked >= 20 ? survival : (1 / 3);
  out.usingSurvival = st.checked >= 20 ? 'measured' : 'assumed 33% until 20 are checked';
  if (perGame > 0 && surv > 0 && rate){
    const candsNeeded = need / surv;
    const gamesNeeded = candsNeeded / perGame;
    out.candidatesStillNeeded = Math.round(candsNeeded);
    out.gamesStillNeeded = Math.round(gamesNeeded);
    out.miningHours = +(gamesNeeded / rate / 60).toFixed(1);
    // verification runs between chunks; ~41s per candidate spread over the engines
    out.verifyHours = +(candsNeeded * 41 / 9 / 3600).toFixed(1);
    out.etaHours = +(out.miningHours + out.verifyHours).toFixed(1);
    out.etaAt = new Date(Date.now() + out.etaHours * 3600000).toISOString();
    out.confidence = mined < 30 ? 'rough — fewer than 30 candidates measured'
                   : mined < 150 ? 'indicative'
                   : 'good';
  } else out.eta = 'not measurable yet';
  return out;
}

/* ---- the finished pools ---- */
function dealt(){
  const out = { stage: 'deal', state: 'not started', pools: {}, total: 0 };
  for (const k of MODES){
    const f = path.join(OUT, k + '.json');
    if (!exists(f)) continue;
    out.state = 'done';
    const list = JSON.parse(fs.readFileSync(f, 'utf8'));
    out.pools[k] = list.length;
    out.total += list.length;
  }
  return out;
}

/* ---- what the machine is actually doing ---- */
function engines(){
  try {
    const ps = execSync('ps -eo pcpu,comm', { encoding: 'utf8' }).split('\n');
    const sf = ps.filter(l => /stockfish/i.test(l));
    const busy = sf.filter(l => parseFloat(l.trim().split(/\s+/)[0]) > 20).length;
    const gen = execSync('pgrep -fl "generate_puzzles|verify_puzzles" || true', { encoding: 'utf8' })
      .split('\n').filter(Boolean);
    return { stockfish: sf.length, busy, running: gen.map(l => l.split(/\s+/).slice(1).join(' ').slice(0, 60)) };
  } catch (e){ return { stockfish: null, busy: null, running: [] }; }
}

function report(){
  return { at: new Date().toISOString(), run: projection(),
           mine: mining(), verify: verifying(), deal: dealt(), engines: engines() };
}

function human(r){
  const L = [];
  L.push('Daily Puzzle production  ·  ' + r.at);
  L.push('');
  const p = r.run;
  if (p){
    L.push('PIPELINE               ' + p.phase + (p.cycle ? '  (cycle ' + p.cycle + ')' : ''));
    if (p.stopped) L.push('  STOPPED              ' + p.stopped);
    if (p.lastError) L.push('  last error           ' + p.lastError);
    L.push('  verified so far      ' + (p.verified || 0) +
           '   dealable ' + (p.dealable || 0) + ' of 400');
    L.push('  elapsed              ' + ago(p.elapsedMs));
    if (p.candidatesPerGame) L.push('  yield                ' + p.candidatesPerGame + ' candidates/game');
    if (p.verificationSurvival !== null && p.verificationSurvival !== undefined)
      L.push('  verification keeps   ' + p.verificationSurvival + '%   (' + p.verified + ' of ' + p.checked + ')');
    if (p.etaHours !== undefined){
      L.push('  still needed         ~' + p.candidatesStillNeeded + ' candidates from ~' +
             p.gamesStillNeeded + ' games');
      L.push('  ETA                  ' + p.etaHours + ' h  (' + p.miningHours + ' h mining + ' +
             p.verifyHours + ' h verifying)');
      L.push('                       ' + p.etaAt);
      L.push('  confidence           ' + p.confidence + ' · survival ' + p.usingSurvival);
    } else if (p.eta) L.push('  ETA                  ' + p.eta);
    L.push('');
  }

  const m = r.mine;
  L.push('MINING                 ' + m.state);
  if (m.state !== 'not started'){
    if (m.games !== undefined) L.push('  games finished       ' + m.games);
    if (m.gamesPerMin) L.push('  rate                 ' + m.gamesPerMin + ' games/min');
    if (m.elapsedMs) L.push('  elapsed              ' + ago(m.elapsedMs));
    if (m.candidatesTotal !== undefined){
      L.push('  candidates mined     ' + m.candidatesTotal + '   ' +
             TRACKS.map(t => t.slice(0, 3) + ' ' + m.candidates[t]).join('  ·  '));
    }
    if (m.checkpointAgeMs !== undefined) L.push('  checkpoint written   ' + ago(m.checkpointAgeMs) + ' ago');
    if (m.logIdleMs !== undefined)
      L.push('  log last moved       ' + ago(m.logIdleMs) + ' ago' +
             (m.logIdleMs > 900000 ? '   <-- LOOKS STALLED' : ''));
    if (m.refusals) { L.push('  refused because:'); for (const t of m.refusals) L.push('    ' + t); }
  }
  L.push('');

  const v = r.verify;
  L.push('VERIFYING              ' + v.state);
  if (v.state !== 'not started'){
    L.push('  accepted             ' + v.accepted);
    L.push('  rejected             ' + v.rejected);
    for (const [t, s] of Object.entries(v.perTrack))
      L.push('    ' + t.padEnd(18) + 'checked ' + s.checked + '  kept ' + s.kept +
             '  dropped ' + s.dropped + (s.inFile !== undefined ? '  ·  in file ' + s.inFile : ''));
    const why = Object.entries(v.why).sort((a, b) => b[1] - a[1]);
    if (why.length){ L.push('  rejection reasons:'); for (const [w, n] of why.slice(0, 10)) L.push('    ' + String(n).padStart(5) + '  ' + w); }
    if (v.lastWriteMs !== undefined && isFinite(v.lastWriteMs))
      L.push('  last result written  ' + ago(v.lastWriteMs) + ' ago' +
             (v.lastWriteMs > 3000000 ? '   <-- LOOKS STALLED' : ''));
  }
  L.push('');

  const d = r.deal;
  L.push('DEALT INTO POOLS       ' + d.state);
  if (d.state !== 'not started'){
    for (const k of MODES) L.push('  ' + k.padEnd(20) + (d.pools[k] === undefined ? '-' : d.pools[k]));
    L.push('  ' + 'total'.padEnd(20) + d.total + ' of 400');
  }
  L.push('');

  L.push('ENGINES');
  L.push('  stockfish processes  ' + r.engines.stockfish + '   busy ' + r.engines.busy);
  for (const p of r.engines.running) L.push('  running              ' + p);
  return L.join('\n');
}

if (require.main === module){
  const r = report();
  console.log(process.argv.includes('--json') ? JSON.stringify(r, null, 1) : human(r));
}

module.exports = { report, mining, verifying, dealt };
