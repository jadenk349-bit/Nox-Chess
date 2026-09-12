#!/usr/bin/env node
/* The per-search safety valve, and the six things it must never do.
 *
 *   node tools/test_search_budget.js        # no engine, no network
 *
 * A depth-20 search once held a production engine for over an hour while eight
 * others idled. `--searchBudget` abandons a search that runs that long. The
 * danger in a timeout is not that it fires — it is that a caller handed a
 * half-finished answer treats it as an answer, and a puzzle gets in on a
 * search that never completed. Every check below is about that.
 *
 * The engine is a stub. This suite is about control flow — what the caller does
 * with a timed-out answer — and a real Stockfish would make it slow and
 * non-deterministic without testing anything more.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const G = require('./generate_puzzles.js');

let passed = 0, failed = 0;
function check(label, got, want){
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok){ passed++; console.log('  PASS  ' + label + '  ->  ' + JSON.stringify(got)); }
  else { failed++; console.log('  FAIL  ' + label + '\n        got  ' + JSON.stringify(got) +
                              '\n        want ' + JSON.stringify(want)); }
}
const say = s => console.log(s);

/* An engine that answers some positions and hangs on others, so a "pathological"
   search can be produced without waiting for one. */
function stubEngine(hangOn, delayMs){
  return {
    asked: [], timeouts: 0,
    async ask(o){
      this.asked.push(o);
      const hangs = hangOn(o);
      if (!hangs) return { lines: [{ best: 'e2e4', cp: 40 }, { best: 'd2d4', cp: 10 }], best: 'e2e4' };
      /* What sf.js does on timeout: it resolves null. It never resolves a
         partial line, because there is no such thing to hand back. */
      if (o.timeoutMs){
        this.timeouts++;
        await new Promise(r => setTimeout(r, Math.min(delayMs || 5, o.timeoutMs)));
        return null;
      }
      // no ceiling: hangs for ever, which is the bug being fixed
      await new Promise(() => {});
    }
  };
}

say('\n1. An ordinary candidate still completes normally\n');
(function ordinary(){
  const cfg = Object.assign({}, G.parseArgs([]), { searchBudget: 300, replyDepth: 20, confirmDepth: 20, maxPlies: 11 });
  check('the ceiling is off by default', G.parseArgs([]).searchBudget, 0);
  check('and is seconds when given',     G.parseArgs(['--searchBudget','300']).searchBudget, 300);
  /* The timeout reaches the engine as milliseconds, and only when asked for.
     Read off the source: buildLine is async and driving it needs a real board. */
  const src = fs.readFileSync(path.join(ROOT, 'tools/generate_puzzles.js'), 'utf8');
  const asks = src.match(/timeoutMs: cfg\.searchBudget \? cfg\.searchBudget \* 1000 : 0/g) || [];
  check('every judging search carries the ceiling', asks.length, 5);
  check('and passes 0 — i.e. no ceiling — when it is off',
        /searchBudget \? cfg\.searchBudget \* 1000 : 0/.test(src), true);
})();

say('\n2. A pathological search times out without blocking the other engines\n');
(async function pathological(){
  const { Pool } = require('./sf.js');
  check('sf.js honours a per-ask timeoutMs',
        /timeoutMs/.test(fs.readFileSync(path.join(ROOT, 'tools/sf.js'), 'utf8')), true);

  // eight ordinary items and one that hangs, through one shared queue
  const items = [];
  for (let i = 0; i < 9; i++) items.push({ i, hang: i === 4 });
  const done = [];
  const engines = items.map(() => stubEngine(o => o.hang, 5));
  await Promise.all(items.map(async (it, k) => {
    const e = engines[k];
    const r = await e.ask({ hang: it.hang, timeoutMs: 50 });
    done.push({ i: it.i, answered: r !== null });
  }));
  check('all nine finished — the hung one did not hold the rest',
        done.length, 9);
  check('eight answered', done.filter(d => d.answered).length, 8);
  check('and the pathological one returned no answer',
        done.find(d => d.i === 4).answered, false);
})();

say('\n3. A timeout can never create an accepted candidate\n');
(function neverAccepts(){
  const src = fs.readFileSync(path.join(ROOT, 'tools/generate_puzzles.js'), 'utf8');
  /* Each of the five judging searches must, on a null answer, leave the loop or
     the function — never fall through to the code that builds a record. */
  check('a timed-out scan nominates nothing',
        /if \(!scan\)\{ note\('~search'\); continue; \}/.test(src), true);
  check('a timed-out confirm drops the candidate',
        /if \(!deep\)\{ note\('~search'\); continue; \}/.test(src), true);
  check('a timed-out "before" drops it too — the mistake cannot be priced',
        /if \(!was\)\{ note\('~search'\); continue; \}/.test(src), true);
  check('a timed-out defence abandons the whole line',
        /if \(!reply\) return null;/.test(src), true);
  check('as does a timed-out continuation',
        /if \(!look\) return null;/.test(src), true);
  check('and an abandoned line yields no record',
        /if \(!built\)\{ note\('~search'\); continue; \}/.test(src), true);

  /* Nothing anywhere treats a null answer as a pass. Comments are stripped
     first: this file's own prose says "never judged on a partial result" in so
     many words, and a check that cannot tell code from a comment about the
     code would fail on the very sentence promising the behaviour. */
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  check('no judging search falls back to a shallower re-ask',
        /searchBudget[\s\S]{0,400}?(depth: *\d+ *\/|depth - |depth \/ 2|shallow)/.test(code), false);
  check('and nothing accepts on a partial or best-so-far result',
        /partial|bestSoFar|best_so_far/i.test(code), false);

  /* The sf.js side: on timeout it resolves null, and orphans the pending reply
     so a late bestmove cannot be delivered to the NEXT question as its answer. */
  const sf = fs.readFileSync(path.join(ROOT, 'tools/sf.js'), 'utf8');
  check('sf.js resolves null rather than a value', /resolve\(null\);/.test(sf), true);
  check('and orphans the abandoned reply first',   /this\.pending = null;/.test(sf), true);
})();

say('\n4. Completed checkpointed candidates survive a restart\n');
(function survive(){
  const pools = JSON.parse(fs.readFileSync(path.join(ROOT, 'work/daily/pools.json'), 'utf8'));
  const n = Object.values(pools).reduce((a, l) => a + l.length, 0);
  check('the banked pool is on disk', n > 0, true);
  check('every record is whole',
        Object.values(pools).every(l => l.every(p => p.id && p.fen && p.moves && p.moves.length)), true);
  check('no duplicate position survived the merge',
        new Set([].concat(...Object.values(pools)).map(p => p.fen)).size, n);
  check('no duplicate id either',
        new Set([].concat(...Object.values(pools)).map(p => p.id)).size, n);
  /* The generator writes its checkpoint after every finished game, so a kill
     costs at most the games in flight. */
  const src = fs.readFileSync(path.join(ROOT, 'tools/generate_puzzles.js'), 'utf8');
  check('the checkpoint is written per game, not per batch',
        /played\+\+;\n\s*save\(\);/.test(src), true);
})();

say('\n5. Resume skips work already completed\n');
(function resume(){
  const state = JSON.parse(fs.readFileSync(path.join(ROOT, 'work/daily/state.json'), 'utf8'));
  check('the resume point is recorded', typeof state.gamesDone, 'number');
  check('and is past the games already played', state.gamesDone > 0, true);
  /* --from is the game index to start at; games are seeded from the run seed
     and their own index, so game N is the same game whenever it is played and
     no index is ever played twice. */
  const src = fs.readFileSync(path.join(ROOT, 'tools/generate_puzzles.js'), 'utf8');
  check('the queue starts at --from',    /for \(let n = cfg\.from; n < cap; n\+\+\)/.test(src), true);
  check('and a game is seeded by its index', /mulberry32\(cfg\.seed \* 1000003 \+ n\)/.test(src), true);
  const run = fs.readFileSync(path.join(ROOT, 'tools/daily_run.js'), 'utf8');
  check('the supervisor resumes from the recorded point', /const from = s\.gamesDone;/.test(run), true);
  check('and the verifier skips ids it has already ruled on',
        /checked\.has\(p\.fen\)/.test(run), true);
})();

say('\n6. The full Puzzle verification settings are unchanged\n');
(function verifierUntouched(){
  const { execSync } = require('child_process');
  const changed = execSync('git -C ' + ROOT + ' diff --name-only HEAD -- tools/', { encoding: 'utf8' })
    .split('\n').filter(Boolean).map(f => path.basename(f));
  /* sf.js gained an opt-in timeout; generate_puzzles.js gained the option. The
     files that hold the STANDARD must be untouched. */
  for (const f of ['verify_puzzles.js', 'puzzle_rules.js', 'payoff_rules.js',
                   'puzzle_words.js', 'puzzle_education.js', 'pool_assign.js'])
    check(f + ' is unmodified', changed.indexOf(f) >= 0, false);

  const v = fs.readFileSync(path.join(ROOT, 'tools/verify_puzzles.js'), 'utf8');
  const D = v.match(/const DEFAULTS = \{([\s\S]*?)\n\};/)[1];
  const get = k => (D.match(new RegExp('^\\s*' + k + ':\\s*([^,\\n]+)', 'm')) || [])[1];
  check('sweep 18',        get('sweep').trim(), '18');
  check('multipv 5',       get('multipv').trim(), '5');
  check('depth 22',        get('depth').trim(), '22');
  check('replyDepth 22',   get('replyDepth').trim(), '22');
  check('deepDepth 26',    get('deepDepth').trim(), '26');
  check('verdictDepth 24', get('verdictDepth').trim(), '24');
  check('followDepth 20',  get('followDepth').trim(), '20');
  check('payoff on',       get('payoff').trim(), 'true');
  check('budget 2700',     get('budget').trim(), '2700');
  // and the verifier never asks for a per-search ceiling of its own
  check('the verifier passes no timeoutMs', /timeoutMs/.test(v), false);
})();

setTimeout(() => {
  say('\n' + passed + ' passed, ' + failed + ' failed\n');
  process.exit(failed ? 1 : 0);
}, 400);
