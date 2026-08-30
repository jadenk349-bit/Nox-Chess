#!/usr/bin/env node
/* The checkpoint, the resume and the budget — tested without an engine.
 *
 * These three exist because a five-hour verification held everything in memory
 * and wrote once at the end, so one pathological puzzle cost three hundred
 * finished results. The behaviour that matters is not "it usually works": it
 * is that a run killed at any instant leaves what it had on disk, that
 * resuming asks the engine only about what is missing, and that a puzzle which
 * runs out of budget is *rejected* — never accepted, never quietly shallowed.
 *
 *   node tools/test_verify_resume.js
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const V = require('./verify_puzzles.js');

let passed = 0, failed = 0;
function check(label, got, want){
  if (got === want){ passed++; console.log('  PASS  ' + label + '  ->  ' + got); }
  else { failed++; console.log('  FAIL  ' + label + '\n        got  ' + got + '\n        want ' + want); }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nox-resume-'));
const file = path.join(tmp, 'middlegame.json');
const puzzles = [
  { n:1, id:'mi-aaa', fen:'x', moves:['a'] },
  { n:2, id:'mi-bbb', fen:'y', moves:['b'] },
  { n:3, id:'mi-ccc', fen:'z', moves:['c'] }
];
fs.writeFileSync(file, JSON.stringify(puzzles));

console.log('\nNothing on disk yet\n');
check('a track with no progress starts empty', V.loadProgress(file).size, 0);
check('so everything is pending', V.pending(puzzles, V.loadProgress(file)).length, 3);

console.log('\nOne puzzle finishes\n');
V.saveProgress(file, 'mi-aaa', { puzzle: puzzles[0], note: { n:1, id:'mi-aaa' } });
let done = V.loadProgress(file);
check('it is on disk immediately', done.size, 1);
check('and it is the one that finished', done.has('mi-aaa'), true);
check('the other two are still pending', V.pending(puzzles, done).length, 2);
check('and the pending list does not include it',
      V.pending(puzzles, done).some(p => p.id === 'mi-aaa'), false);

console.log('\nA rejected puzzle is remembered too\n');
V.saveProgress(file, 'mi-bbb', { puzzle: null, note: { n:2, id:'mi-bbb', dropped:'ambiguous' } });
done = V.loadProgress(file);
check('a rejection is a result, not a gap', done.size, 2);
check('and it is not re-verified', V.pending(puzzles, done).length, 1);
check('its verdict survives the round trip', done.get('mi-bbb').note.dropped, 'ambiguous');
check('and it carries no puzzle', done.get('mi-bbb').puzzle, null);

console.log('\nThe result itself comes back whole\n');
check('the stored puzzle is the puzzle', done.get('mi-aaa').puzzle.id, 'mi-aaa');
check('with its line intact', done.get('mi-aaa').puzzle.moves.join(), 'a');

console.log('\nA run killed mid-write loses only that line\n');
fs.appendFileSync(V.progressFile(file), '{"id":"mi-ccc","puzzle":{"id":"mi-c');  // ragged
done = V.loadProgress(file);
check('the half-written line is skipped', done.size, 2);
check('the two whole ones survive', done.has('mi-aaa') && done.has('mi-bbb'), true);
check('and the ragged puzzle is simply pending again',
      V.pending(puzzles, done).map(p => p.id).join(), 'mi-ccc');

console.log('\nThe budget rejects; it never accepts\n');

// a fake engine: records whether it was told to stop, and never blocks anything
const fake = () => ({ stopped:false, freed:false,
                      abandon(){ this.stopped = true; }, release(){ this.freed = true; } });

(async () => {
  let e = fake();
  const quick = await V.withBudget(() => Promise.resolve({ puzzle:{id:'ok'}, note:{} }), 5, e);
  check('a puzzle inside its budget comes back', quick.puzzle.id, 'ok');
  check('and the engine is released', e.freed, true);
  check('without having been abandoned', e.stopped, false);

  e = fake();
  const slow = await V.withBudget(() => new Promise(r => setTimeout(r, 5000)), 0.05, e);
  check('a puzzle over its budget returns nothing', slow, null);
  check('the engine was abandoned mid-search', e.stopped, true);
  check('and then released for the next puzzle', e.freed, true);

  e = fake();
  const threw = await V.withBudget(() => Promise.reject(new Error('boom')), 5, e);
  check('a verification that throws also returns nothing', threw, null);

  // the property the whole rule rests on
  check('no budget outcome can ever produce an accepted puzzle',
        [slow, threw].every(r => r === null), true);

  e = fake();
  const off = await V.withBudget(() => Promise.resolve({ puzzle:{id:'z'}, note:{} }), 0, e);
  check('budget 0 disables the rule entirely', off.puzzle.id, 'z');

  fs.rmSync(tmp, { recursive:true, force:true });
  console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
  process.exit(failed ? 1 : 0);
})();
