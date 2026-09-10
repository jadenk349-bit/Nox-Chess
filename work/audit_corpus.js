#!/usr/bin/env node
/* A programmatic pass over exactly what is about to ship. Every claim the
   approved standard makes about a shipped record, asked of every record. */
'use strict';
const fs = require('fs');
const P = require('../tools/page_chess.js');
const R = require('../tools/puzzle_rules.js');
const PAY = require('../tools/payoff_rules.js');
const POOL = require('../tools/pool_assign.js');

let bad = 0;
const pools = {};
for (const k of POOL.KEYS){
  try { pools[k] = JSON.parse(fs.readFileSync('puzzles/modes/' + k + '.json', 'utf8')); }
  catch (e){ pools[k] = []; }
}
const problems = POOL.check(pools);
problems.forEach(s => { console.log('  POOL  ' + s); bad++; });

for (const k of POOL.KEYS) for (const p of pools[k]){
  const tag = k + '/' + p.id + ': ';
  let st;
  try { st = P.stateFromFEN(p.fen); } catch (e){ console.log('  ' + tag + 'unparseable fen'); bad++; continue; }
  if (!p.moves || !p.moves.length){ console.log('  ' + tag + 'no line'); bad++; continue; }
  if (p.moves.length % 2 === 0){ console.log('  ' + tag + 'line does not end on the solver'); bad++; }
  let s = st, legal = true;
  for (const u of p.moves){
    const m = R.uciFind(s, u);
    if (!m){ legal = false; break; }
    s = P.makeMove(s, m);
  }
  if (!legal){ console.log('  ' + tag + 'illegal line'); bad++; continue; }
  const pay = PAY.payoffOf(p);
  if (!pay.ok){ console.log('  ' + tag + pay.why); bad++; }
  if (!p.why){ console.log('  ' + tag + 'no explanation'); bad++; }
  if (!p.themes || !p.themes.length){ console.log('  ' + tag + 'no theme'); bad++; }
  if (!p.eval){ console.log('  ' + tag + 'no evaluation evidence'); bad++; }
  if (!p.prev){ console.log('  ' + tag + 'no prior position'); bad++; }
}

for (const kind of ['opening', 'middlegame']){
  let list = [];
  try { list = JSON.parse(fs.readFileSync('practices/' + kind + '.json', 'utf8')); } catch (e){}
  const ids = new Set();
  for (const p of list){
    const tag = 'practice/' + kind + '/' + p.id + ': ';
    if (ids.has(p.id)){ console.log('  ' + tag + 'duplicate id'); bad++; }
    ids.add(p.id);
    let st;
    try { st = P.stateFromFEN(p.fen); } catch (e){ console.log('  ' + tag + 'bad fen'); bad++; continue; }
    let s = st, ok = true;
    for (const u of p.moves || []){
      const m = R.uciFind(s, u);
      if (!m){ ok = false; break; }
      s = P.makeMove(s, m);
    }
    if (!ok){ console.log('  ' + tag + 'illegal line'); bad++; }
    if (kind === 'middlegame' && !(p.swing >= 35)){
      console.log('  ' + tag + 'swing ' + p.swing + ' is under +35'); bad++; }
    if (kind === 'opening' && !(p.accept && p.accept.length)){
      console.log('  ' + tag + 'no accepted move set'); bad++; }
    if (!p.why){ console.log('  ' + tag + 'no explanation'); bad++; }
  }
  console.log('  practices/' + kind + ': ' + list.length + ' audited');
}
console.log(bad ? '\n  *** ' + bad + ' AUDIT PROBLEMS ***' : '\n  audit clean: every shipped record satisfies every gate');
process.exit(bad ? 1 : 0);
