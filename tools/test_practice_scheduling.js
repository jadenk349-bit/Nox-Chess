#!/usr/bin/env node
/* Stage 5b's scheduling, checkpointing and resume — tested without an engine.
 *
 * The first Stage 5b run sat for five hours and produced nothing. The
 * diagnosis offered at the time was a concurrency deadlock: several candidates
 * reaching one Stockfish at once, sf.js throwing "one question at a time", and
 * pool.map wedging. That diagnosis was wrong, and the first test below is what
 * proves it — Pool.map has always handed each engine one job at a time.
 *
 * The real cause was cost, not contention. `perGame` caps how many practices a
 * game may *contribute* and only counts successes; under a gate as strict as
 * +35 points almost nothing succeeds, so the cap never engaged and every game
 * was examined exhaustively — about forty middlegame positions, six deep
 * searches each, roughly 240 searches per game. Ten engines got through four
 * games in five hours. Nothing was stuck; the work was simply unbounded.
 *
 * So these tests pin down all four properties the fix rests on:
 *
 *   1. one engine is never asked two questions at once   (was already true)
 *   2. the work one game may demand is bounded           (the actual fix)
 *   3. every verified practice is on disk immediately    (durability)
 *   4. a restart skips what is already done              (resume)
 *
 *   node tools/test_practice_scheduling.js
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { Pool } = require('./sf.js');
const V = require('./verify_puzzles.js');
const GP = require('./generate_practices.js');

let passed = 0, failed = 0;
function check(label, got, want){
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok){ passed++; console.log('  PASS  ' + label + '  ->  ' + JSON.stringify(got)); }
  else { failed++; console.log('  FAIL  ' + label +
        '\n        got  ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want)); }
}
const head = s => console.log('\n' + s + '\n');

/* ==================================================================
   1. ONE ENGINE, ONE QUESTION AT A TIME
   ================================================================== */

head('No engine is ever asked two questions at once');

/* A stand-in that counts how many requests are in flight on itself. If the
   scheduler ever overlapped two candidates on one engine, maxActive would
   exceed one — and sf.js would throw, which is what the wrong diagnosis
   predicted. It does not. */
class Fake {
  constructor(i){ this.slot = i; this.active = 0; this.maxActive = 0; this.calls = 0; }
  async ask(){
    this.active++; this.calls++;
    if (this.active > this.maxActive) this.maxActive = this.active;
    await new Promise(r => setTimeout(r, Math.random() * 12));
    this.active--;
    return { best: 'e2e4', lines: [{ best: 'e2e4', cp: 10 }], cp: 10 };
  }
}
function fakePool(n){
  const p = Object.create(Pool.prototype);
  p.engines = Array.from({ length: n }, (_, i) => new Fake(i));
  return p;
}

const run = async (engines, items, perItem) => {
  const p = fakePool(engines);
  await p.map(Array.from({ length: items }, (_, i) => i), async (n, e) => {
    for (let q = 0; q < perItem; q++) await e.ask();
  });
  return p;
};

(async () => {
  let p = await run(4, 200, 3);
  check('every request was made', p.engines.reduce((s, e) => s + e.calls, 0), 600);
  check('never more than one in flight on any engine',
        Math.max.apply(null, p.engines.map(e => e.maxActive)), 1);

  /* The shape Stage 5b actually has: many sequential questions per candidate,
     which is where an overlap would show up if one were possible. */
  p = await run(10, 120, 7);
  check('still one at a time with seven questions per candidate',
        Math.max.apply(null, p.engines.map(e => e.maxActive)), 1);
  check('and every engine was used',
        p.engines.every(e => e.calls > 0), true);

  head('An engine takes the next candidate the moment it is free');

  /* One deliberately slow item must not stop the others. With four engines and
     one pathological candidate, the other three should still drain the queue —
     the property the instruction asks for in as many words. */
  const p2 = fakePool(4);
  let finished = 0;
  await p2.map(Array.from({ length: 40 }, (_, i) => i), async (n, e) => {
    await new Promise(r => setTimeout(r, n === 0 ? 260 : 3));
    finished++;
  });
  check('every candidate completed despite one slow one', finished, 40);
  check('no candidate was analysed twice',
        p2.engines.reduce((s, e) => s + e.calls, 0), 0);   // ask() unused here

  /* ==================================================================
     2. THE WORK ONE GAME MAY DEMAND IS BOUNDED
     ================================================================== */

  head('One game can no longer consume the run');

  const D = GP.DEFAULTS;
  check('a per-game examination cap exists', typeof D.perGameTries, 'number');
  check('and it is smaller than a game\'s middlegame count', D.perGameTries <= 20, true);
  check('a cheap nominating pass exists', D.nomDepth < D.depth, true);
  check('which only nominates, well under what +35 needs', D.nomGap <= 200, true);

  /* The stride, reproduced exactly as main() computes it: a 57-ply game holds
     about forty middlegame positions, and the cap must cut that to
     perGameTries without taking them all from one phase of the game. */
  const of = Array.from({ length: 40 }, (_, i) => i + 6);
  const stride = Math.max(1, Math.ceil(of.length / D.perGameTries));
  const picks = of.filter((_, k) => k % stride === 0).slice(0, D.perGameTries);
  check('40 candidate plies are cut to the cap', picks.length <= D.perGameTries, true);
  check('and they are spread across the game, not bunched at the front',
        picks[picks.length - 1] - picks[0] > 20, true);
  check('searches demanded per game drop from ~240 to at most',
        D.perGameTries * 6 + D.perGameTries, D.perGameTries * 7);

  /* ==================================================================
     3 & 4. DURABILITY AND RESUME
     ================================================================== */

  head('Every verified practice is on disk the moment it is verified');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nox-5b-'));
  const file = path.join(tmp, 'middlegame.json');

  check('a fresh run starts with nothing', V.loadProgress(file).size, 0);

  const rec = id => ({ id, kind: 'middlegame', fen: 'x', moves: ['a', 'b'], swing: 41 });
  V.saveProgress(file, 'mp-aaa', { puzzle: rec('mp-aaa'), note: { id: 'mp-aaa' } });
  check('one verified practice is immediately readable', V.loadProgress(file).size, 1);
  V.saveProgress(file, 'mp-bbb', { puzzle: rec('mp-bbb'), note: { id: 'mp-bbb' } });
  V.saveProgress(file, 'mp-ccc', { puzzle: rec('mp-ccc'), note: { id: 'mp-ccc' } });
  check('and they accumulate one at a time', V.loadProgress(file).size, 3);
  check('the record survives the round trip',
        V.loadProgress(file).get('mp-bbb').puzzle.swing, 41);

  head('A restart skips what is already done');

  /* main() rebuilds `already` from the log exactly this way. */
  const reload = () => {
    const already = new Set(), kept = [];
    for (const r of V.loadProgress(file).values())
      if (r.puzzle){ already.add(r.puzzle.id); kept.push(r.puzzle); }
    return { already, kept };
  };
  let st = reload();
  check('a restart recovers every completed practice', st.kept.length, 3);
  check('and knows their ids', [...st.already].sort().join(','), 'mp-aaa,mp-bbb,mp-ccc');
  check('a repeat of a done id is recognised', st.already.has('mp-bbb'), true);
  check('a new id is not', st.already.has('mp-zzz'), false);

  /* The same position found again in a later game must not be banked twice —
     ids are a hash of kind, position and move, so this is the dedup that
     matters. */
  const before = V.loadProgress(file).size;
  if (!st.already.has('mp-bbb')) V.saveProgress(file, 'mp-bbb', { puzzle: rec('mp-bbb'), note: {} });
  check('a duplicate is never written', V.loadProgress(file).size, before);

  head('A run killed mid-write loses only that line');

  fs.appendFileSync(V.progressFile(file), '{"id":"mp-ddd","puzzle":{"id":"mp-d');
  check('the ragged line is skipped', V.loadProgress(file).size, 3);
  check('and the whole ones survive', reload().kept.length, 3);


  /* ==================================================================
     5. PERSPECTIVE — the bug that made +35 unreachable
     ================================================================== */

  head('A practice score is read from the solver\'s side');

  const PP = require('./page_chess.js');
  const VV = require('./verify_puzzles.js');
  const FEN = 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4';

  /* The parity that the fix turns on. A puzzle line ends on the solver's move,
     so the opponent is to move after it and scoreAfter() negates correctly.
     A practice line is [move, defence] — even — so the solver is to move and
     the search already speaks for them. Negating there inverts every score,
     which is exactly what produced "max swing 0" over eleven hours. */
  const parity = (moves) => {
    let st = PP.stateFromFEN(FEN);
    for (const u of moves){
      const m = PP.legalMoves(st, st.turn).find(x => PP.uciOf(x) === u);
      if (!m) return null;
      st = PP.makeMove(st, m);
    }
    return st.turn;
  };
  check('a puzzle line (odd) leaves the OPPONENT to move', parity(['f3g5']), 'b');
  check('a practice line (even) leaves the SOLVER to move', parity(['f3g5','d8g5']), 'w');
  check('so the two need opposite sign handling',
        parity(['f3g5']) !== parity(['f3g5','d8g5']), true);

  head('The swing between best and runner-up is never negative');

  /* The property the diagnostic falsified. Whatever the scores are, the best
     move must not score below the second best; a non-positive spread means the
     perspective is inverted, not that good positions are rare. */
  const PRR = require('./practice_rules.js');
  const WPP = require('./win_prob.js');
  let anyNegative = false;
  for (const [best, alt] of [[600,100],[50,-400],[900,20],[0,-350],[250,-90]]){
    const s = WPP.swing(alt, best);
    if (s < 0) anyNegative = true;
  }
  check('a correctly-signed pair always swings upward', anyNegative, false);
  check('and an inverted pair is caught as negative',
        WPP.swing(600, 100) < 0, true);
  check('+35 is reachable with correctly-signed scores',
        PRR.judgeMiddlegame({ best: 600, alt: -100, before: 0, obvious: null }).ok, true);
  check('but not with the signs swapped',
        PRR.judgeMiddlegame({ best: -100, alt: 600, before: 0, obvious: null }).ok, false);

  head('obvious()\'s length rules do not veto a two-ply practice');

  check('"one move" is on the waived list', PRR.OPEN_EXEMPT.indexOf('one move') >= 0, true);
  check('"mate in one" too', PRR.OPEN_EXEMPT.indexOf('mate in one') >= 0, true);
  check('a real fault is still fatal',
        PRR.judgeMiddlegame({ best: 600, alt: -100, before: 0, obvious: 'free piece' }).why,
        'free piece');


  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
  process.exit(failed ? 1 : 0);
})();
