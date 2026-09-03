'use strict';
/* The browser's corpus is the same corpus, and this is what says so.
 *
 * Study Board cannot walk a directory, so education/tools/build_bundle.js
 * flattens the 137 concept records and the warnings index into one file and
 * the page hands it back through setKnowledge(). Everything downstream then
 * runs unchanged — which is a claim, and an untested claim of exactly the kind
 * this project does not accept.
 *
 * So: the same positions are analysed twice, once against the filesystem and
 * once against the committed bundle, and the two results are compared as
 * BYTES. Not "the same concepts" and not "the same headline" — a caution
 * dropped because a field was missing would pass either of those and would
 * change what a player is told.
 *
 * This is also the test that would LICENSE a smaller bundle. The bundle ships
 * whole today because whole is correct by construction; a trimmed one is only
 * safe if this suite still passes over it, and trimming without this running
 * would be guessing at which fields the matchers read.
 *
 *     node education/tests/test_bundle.js
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const BUNDLE = path.join(ROOT, 'dist', 'education-bundle.json');

let pass = 0, fail = 0;
function ok(name, cond, detail){
  if (cond) { pass++; return; }
  fail++;
  console.log('  FAIL  ' + name + (detail ? '\n        ' + String(detail).slice(0, 300) : ''));
}
function eq(name, got, want){ ok(name, got === want, 'got ' + got + ' want ' + want); }

console.log('');

/* ---- 1. it exists and is not stale ------------------------------------- */
ok('bundle exists', fs.existsSync(BUNDLE), BUNDLE);
if (!fs.existsSync(BUNDLE)) { console.log('\nBUNDLE  PASS ' + pass + '   FAIL ' + (fail + 1) + '\n'); process.exit(1); }

let stale = null;
try {
  execFileSync('node', [path.join(ROOT, 'tools', 'build_bundle.js'), '--check'], { stdio: 'pipe' });
} catch (e) {
  stale = (e.stderr || e.stdout || '').toString().trim();
}
ok('bundle is not stale', stale === null, stale);

const bundle = JSON.parse(fs.readFileSync(BUNDLE, 'utf8'));

/* ---- 2. it is the corpus, not a summary of it -------------------------- */
const onDisk = {};
const cdir = path.join(ROOT, 'concepts');
for (const d of fs.readdirSync(cdir)) {
  const sub = path.join(cdir, d);
  if (!fs.statSync(sub).isDirectory()) continue;
  for (const fn of fs.readdirSync(sub)) {
    if (!fn.endsWith('.json')) continue;
    const c = JSON.parse(fs.readFileSync(path.join(sub, fn), 'utf8'));
    onDisk[c.id] = c;
  }
}
eq('every concept is in the bundle', Object.keys(bundle.concepts).length, Object.keys(onDisk).length);

// Field for field, not id for id. A bundle with every concept in it and half
// the fields missing would pass a count.
let differing = [];
for (const id of Object.keys(onDisk)) {
  if (JSON.stringify(bundle.concepts[id]) !== JSON.stringify(onDisk[id])) differing.push(id);
}
eq('every record is byte-identical to its file', differing.length, 0);
if (differing.length) console.log('        ' + differing.slice(0, 5).join(', '));

const wi = path.join(ROOT, 'state', 'warnings_index.json');
if (fs.existsSync(wi)) {
  const w = JSON.parse(fs.readFileSync(wi, 'utf8'));
  eq('the warnings index came too', (bundle.warnings.entries || []).length, (w.entries || []).length);
} else {
  ok('the warnings index came too', true);
}

/* ---- 3. the same answers, from either source --------------------------- */
const API = require('../lib/analyze.js');

// Positions chosen to exercise the parts of a record the bundle could damage:
// a tactic (recognition + detector text), a positional claim (explanations and
// slots), a rule (knowledge_type ceiling), an endgame (tablebase-fact wording),
// and a position with nothing in it (the refusal path, which has no concept to
// read a field from and so is the one case a broken bundle would still pass).
const CASES = [
  { fen: 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 4 3', move: 'g8f6' },
  { fen: '2r2rk1/pb1q1ppp/1pn1pn2/8/3P4/P3PB2/3N1PPP/RQB2RK1 b - - 7 15', move: 'c6a5' },
  { fen: '8/8/4k3/8/4K3/8/4P3/8 w - - 0 1', move: null },
  { fen: '8/8/3Kp3/4Pk2/8/8/8/8 w - - 0 1', move: null },
  { fen: '8/8/8/4k3/8/8/4K3/8 w - - 0 1', move: null },
  { fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', move: 'e2e4' },
];
// With an engine result and without, because the engine half is a separate
// branch and the refusal it guards is the one the page depends on most.
const ENGINES = [null, { eval_cp: 34, best_move: 'e2e4', depth: 26, engine_id: 'test' }];

function run(cases){
  const out = [];
  for (const c of cases) {
    for (const e of ENGINES) {
      for (const level of ['beginner', 'intermediate', 'advanced', 'master']) {
        out.push(JSON.stringify(API.analyzeWithEducation({
          fen: c.fen, move: c.move, engine: e, level, depth: 'normal',
        })));
      }
    }
  }
  return out;
}

// Filesystem first, while the cache is still empty.
const fromDisk = run(CASES);
API.setKnowledge({ concepts: bundle.concepts, warnings: bundle.warnings });
const fromBundle = run(CASES);

let mismatch = -1;
for (let i = 0; i < fromDisk.length; i++) {
  if (fromDisk[i] !== fromBundle[i]) { mismatch = i; break; }
}
eq('every analysis is byte-identical from the bundle', mismatch, -1);
if (mismatch >= 0) {
  const a = fromDisk[mismatch], b = fromBundle[mismatch];
  let at = 0;
  while (at < a.length && a[at] === b[at]) at++;
  console.log('        case ' + mismatch + ' diverges at ' + at + ':\n        ' +
              a.slice(Math.max(0, at - 60), at + 60) + '\n        ' +
              b.slice(Math.max(0, at - 60), at + 60));
}
eq('and there were analyses to compare', fromDisk.length, CASES.length * ENGINES.length * 4);

/* ---- 4. the seam itself ------------------------------------------------ */
// setKnowledge(null) must fall back to the filesystem rather than to an empty
// corpus, or a browser that failed halfway would silently report that nothing
// in chess matches anything.
API.setKnowledge(null);
const back = API.analyzeWithEducation({ fen: CASES[0].fen, move: CASES[0].move });
eq('setKnowledge(null) restores the filesystem corpus', back.provenance.concepts_available,
   Object.keys(onDisk).length);

console.log('\nBUNDLE  PASS ' + pass + '   FAIL ' + fail + '\n');
process.exit(fail ? 1 : 0);
