#!/usr/bin/env node
/* A Stockfish that does not always stop when it is told to.
 *
 *   FAKE_WEDGE_ON=1 node tools/test_stop_ignoring_engine.js
 *
 * Stands in for the real engine in tools/test_engine_reclaim.js. It speaks
 * enough UCI to be driven by NativeEngine, and its one interesting property is
 * that a search named in FAKE_WEDGE_ON (a comma-separated list of 1-based `go`
 * numbers) never answers and IGNORES `stop` — which is exactly what a real
 * Stockfish did in production for five and a half hours, and the thing no
 * stubbed-out promise can reproduce, because a stub that politely resolves null
 * on timeout is the behaviour that was missing.
 *
 * It answers `isready` with `readyok` even mid-search, as the UCI spec requires
 * and as real engines do. That is deliberate: it is why readyok cannot be used
 * to tell whether a search has ended, and the test would pass spuriously
 * against a fake that got this wrong.
 */

'use strict';

const wedgeOn = new Set((process.env.FAKE_WEDGE_ON || '')
  .split(',').map(s => parseInt(s, 10)).filter(n => n > 0));

let goes = 0;
let searching = false;
let wedged = false;
let timer = null;

const say = s => process.stdout.write(s + '\n');

function answer(){
  timer = null;
  if (!searching) return;
  searching = false;
  wedged = false;
  say('info depth 12 seldepth 14 multipv 1 score cp 34 nodes 1000 pv e2e4 e7e5');
  say('bestmove e2e4 ponder e7e5');
}

let buf = '';
process.stdin.on('data', d => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) >= 0){
    const line = buf.slice(0, i).replace(/\r$/, '').trim();
    buf = buf.slice(i + 1);
    handle(line);
  }
});

function handle(line){
  if (line === 'uci'){
    say('id name FakeFish 1 (stop-ignoring)');
    say('id author the regression suite');
    for (const [n, t] of [['Threads', 'spin'], ['Hash', 'spin'], ['MultiPV', 'spin'],
                          ['Skill Level', 'spin'], ['Contempt', 'spin'],
                          ['UCI_ShowWDL', 'check']])
      say('option name ' + n + ' type ' + t + ' default 1');
    say('uciok');
    return;
  }
  // answered even while searching, per the spec — see the header
  if (line === 'isready'){ say('readyok'); return; }
  if (line.startsWith('go')){
    goes++;
    searching = true;
    wedged = wedgeOn.has(goes);
    if (wedged) return;                       // never answers, ignores stop
    timer = setTimeout(answer, 30);
    return;
  }
  if (line === 'stop'){
    if (wedged) return;                       // the whole point of this file
    if (timer){ clearTimeout(timer); timer = null; }
    answer();
    return;
  }
  if (line === 'quit'){ process.exit(0); }
}
