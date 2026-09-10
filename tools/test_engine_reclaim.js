#!/usr/bin/env node
/* What happens to the engine when a search is abandoned.
 *
 *   node tools/test_engine_reclaim.js        # no Stockfish, no network
 *
 * tools/test_search_budget.js already covers the half of --searchBudget that
 * faces the CALLER: a timed-out search yields null, and null yields no
 * candidate. This suite covers the half that faces the ENGINE, and it exists
 * because that half was missing and cost a production run five and a half
 * hours.
 *
 * What happened: mining 15,491 positions abandoned 130 searches on the
 * ceiling. Each one cleared `pending`, sent `stop`, and handed the engine back
 * to the pool. 129 engines stopped. One did not — and a Stockfish that is
 * still searching will not accept the `position` and `go` for the next
 * question, so that pool slot waited on an answer that could never come.
 * Eight engines sat at exactly 0.0% CPU while the ninth burned 100%, and
 * Pool.map()'s Promise.all never resolved: one search wedged the whole cycle,
 * one game short of the end.
 *
 * The engine here is tools/test_stop_ignoring_engine.js — a real child process
 * speaking real UCI over a real pipe, driven by the real NativeEngine. It has
 * to be, because the failure IS an engine that does not do what it is told,
 * and a stub that resolves null on cue is precisely the behaviour whose
 * absence caused the bug.
 */

'use strict';

const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..');

// short grace, so the suite runs in seconds rather than minutes; the code path
// under test is identical either way
process.env.NOX_SF_STOP_GRACE_MS = '250';

const { NativeEngine, Pool } = require('./sf.js');

const FAKE = path.join(__dirname, 'test_stop_ignoring_engine.js');

let passed = 0, failed = 0;
function check(label, got, want){
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok){ passed++; console.log('  PASS  ' + label + '  ->  ' + JSON.stringify(got)); }
  else { failed++; console.log('  FAIL  ' + label + '\n        got  ' + JSON.stringify(got) +
                              '\n        want ' + JSON.stringify(want)); }
}
const say = s => console.log(s);

/** A NativeEngine driving the fake, with the given searches set to wedge. */
function fake(wedgeOn){
  const env = Object.assign({}, process.env);
  if (wedgeOn) env.FAKE_WEDGE_ON = wedgeOn;
  else delete env.FAKE_WEDGE_ON;
  const saved = process.env.FAKE_WEDGE_ON;
  if (wedgeOn) process.env.FAKE_WEDGE_ON = wedgeOn; else delete process.env.FAKE_WEDGE_ON;
  const e = new NativeEngine({ bin: FAKE });
  if (saved === undefined) delete process.env.FAKE_WEDGE_ON;
  else process.env.FAKE_WEDGE_ON = saved;
  return e;
}

async function main(){

  say('\n1. The fake really does ignore stop — otherwise nothing below means anything\n');
  {
    const e = fake('1');
    await e.ready;                       // booted, so nothing below races startup
    check('it is the fake that is answering', e.id.indexOf('FakeFish'), 0);

    const t0 = Date.now();
    // no ceiling at all: this is the OLD behaviour, and it must hang
    const asking = e.ask({ depth: 20 });
    const raced = await Promise.race([
      asking.then(() => 'answered'),
      new Promise(r => setTimeout(() => r('still searching'), 400))
    ]);
    check('an uncapped ask against a wedging engine never returns', raced, 'still searching');
    check('...which is a hang, not a slow answer', Date.now() - t0 >= 400, true);

    /* And while it is wedged it still answers isready — the reason reclaim()
       cannot use readyok to decide whether a search has ended, and the reason
       the bestmove acknowledgement is the probe instead. */
    const readyok = await Promise.race([
      new Promise(resolve => { e._ready = () => resolve('readyok'); e.send('isready'); }),
      new Promise(r => setTimeout(() => r('silent'), 400))
    ]);
    check('...yet readyok comes back mid-search, so it proves nothing', readyok, 'readyok');
    e.quit();
  }

  say('\n2. A wedged engine is killed and replaced, and the slot comes back\n');
  {
    const e = fake('1');
    const t0 = Date.now();
    const r = await e.ask({ depth: 20, timeoutMs: 150 });
    const took = Date.now() - t0;
    check('the caller is answered', r, null);
    check('...with null, never a partial or best-so-far', r === null, true);
    check('the timeout was counted', e.timeouts, 1);
    check('the engine did not acknowledge, so it was replaced', e.restarts, 1);
    check('...bounded by the ceiling plus the grace plus a boot',
          took < 150 + 250 + 4000, true);
    // and the replacement is a working engine
    const again = await e.ask({ depth: 12, timeoutMs: 2000 });
    check('the SAME engine object answers the next question', !!(again && again.best), true);
    check('...with a real move', again && again.best, 'e2e4');
    check('and needed no second replacement to do it', e.restarts, 1);
    e.quit();
  }

  say('\n3. An engine that DOES stop is kept, not thrown away\n');
  {
    const e = fake(null);
    // a search that answers in 30ms, given a 5ms ceiling: it times out, but the
    // engine honours the stop, so there is nothing to replace
    const r = await e.ask({ depth: 20, timeoutMs: 5 });
    check('the caller still gets null', r, null);
    check('the timeout was counted', e.timeouts, 1);
    check('but the process was NOT killed — a stop that works costs nothing',
          e.restarts, 0);
    const again = await e.ask({ depth: 12, timeoutMs: 2000 });
    check('and it goes on answering', again && again.best, 'e2e4');
    e.quit();
  }

  say('\n4. One wedged engine does not block the pool — the actual production failure\n');
  {
    /* Three engines, nine questions, and the fourth question wedges whichever
       engine draws it. Before the fix this returned nothing at all: Pool.map's
       Promise.all waited on a worker loop that could not advance. */
    const saved = process.env.FAKE_WEDGE_ON;
    process.env.FAKE_WEDGE_ON = '2';        // each engine wedges its 2nd search
    const pool = new Pool(3, { native: true, bin: FAKE });
    if (saved === undefined) delete process.env.FAKE_WEDGE_ON;
    else process.env.FAKE_WEDGE_ON = saved;

    const items = Array.from({ length: 9 }, (_, i) => i);
    const t0 = Date.now();
    const out = await Promise.race([
      pool.map(items, (item, engine) => engine.ask({ depth: 12, timeoutMs: 150 })),
      new Promise(r => setTimeout(() => r('BLOCKED'), 20000))
    ]);
    const took = Date.now() - t0;

    check('the whole cycle completed rather than hanging', out !== 'BLOCKED', true);
    check('every question was answered one way or the other',
          Array.isArray(out) && out.length, 9);
    check('three searches timed out — one per engine, its second',
          Array.isArray(out) ? out.filter(x => x === null).length : -1, 3);
    check('the other six got real answers',
          Array.isArray(out) ? out.filter(x => x && x.best === 'e2e4').length : -1, 6);
    check('every engine that wedged was replaced',
          pool.engines.map(e => e.restarts), [1, 1, 1]);
    check('slots are preserved across a replacement, so a paired pool still lines up',
          pool.engines.map(e => e.slot), [0, 1, 2]);
    check('...and it took seconds, not for ever', took < 20000, true);
    pool.quit();
  }

  say('\n5. A timed-out search can never become a candidate\n');
  {
    /* The caller-facing half, restated here because the engine-facing fix must
       not have quietly changed it. Every judging search in the generator drops
       its candidate on a null, and none of them can see anything else. */
    const src = fs.readFileSync(path.join(ROOT, 'tools/generate_puzzles.js'), 'utf8');
    check('a timed-out scan nominates nothing',
          /if \(!scan\)\{ note\('~search'\); continue; \}/.test(src), true);
    check('a timed-out confirm drops the candidate',
          /if \(!deep\)\{ note\('~search'\); continue; \}/.test(src), true);
    check('a timed-out "before" drops it too',
          /if \(!was\)\{ note\('~search'\); continue; \}/.test(src), true);
    check('a timed-out defence abandons the line',   /if \(!reply\) return null;/.test(src), true);
    check('as does a timed-out continuation',        /if \(!look\) return null;/.test(src), true);
    check('and an abandoned line yields no record',
          /if \(!built\)\{ note\('~search'\); continue; \}/.test(src), true);

    const sf = fs.readFileSync(path.join(ROOT, 'tools/sf.js'), 'utf8');
    const code = sf.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

    /* reclaim() must be incapable of inventing a search result. Read its body
       by matching braces rather than by a lazy regex, which would run on past
       the end of the function and answer about the whole file. */
    const bodyOf = (src, sig) => {
      const at = src.indexOf(sig);
      if (at < 0) return '';
      let i = src.indexOf('{', at), depth = 0;
      for (let j = i; j < src.length; j++){
        if (src[j] === '{') depth++;
        else if (src[j] === '}' && --depth === 0) return src.slice(i, j + 1);
      }
      return '';
    };
    const reclaim = bodyOf(code, 'async reclaim()');
    check('reclaim() was found', reclaim.length > 0, true);
    for (const forbidden of ['job', 'lines', '.cp', 'best', 'settleDepth'])
      check("...and cannot fabricate an answer: no '" + forbidden + "' in it",
            reclaim.indexOf(forbidden) >= 0, false);
    check('...it answers a boolean about the SLOT, nothing about the search',
          /return freed;/.test(reclaim), true);
    check('the timeout still answers null and nothing else',
          /await this\.reclaim\(\);\s*resolve\(null\);/.test(code), true);
    check('and no shallower re-ask was introduced anywhere',
          /(depth - |depth \/ 2|shallow|bestSoFar|partial)/i.test(code), false);
  }

  say('\n6. The verifier is untouched — it passes no ceiling and never will\n');
  {
    const v = fs.readFileSync(path.join(ROOT, 'tools/verify_puzzles.js'), 'utf8');
    check('the verifier asks for no timeoutMs', /timeoutMs/.test(v), false);
    const D = v.match(/const DEFAULTS = \{([\s\S]*?)\n\};/)[1];
    const get = k => (D.match(new RegExp('^\\s*' + k + ':\\s*([^,\\n]+)', 'm')) || [])[1];
    for (const [k, want] of [['sweep', '18'], ['multipv', '5'], ['depth', '22'],
                             ['replyDepth', '22'], ['deepDepth', '26'],
                             ['verdictDepth', '24'], ['followDepth', '20'],
                             ['payoff', 'true'], ['budget', '2700']])
      check('  ' + k + ' is still ' + want, get(k).trim(), want);
    /* abandon()/release() are the verifier's own budget and are a different
       mechanism from reclaim(): that one is per PUZZLE and rejects it, this one
       is per SEARCH and frees an engine. Neither may grow into the other. */
    check('the verifier still abandons per puzzle, not per search',
          /abandon\(\)/.test(fs.readFileSync(path.join(ROOT, 'tools/sf.js'), 'utf8')), true);
  }

  say('\n' + passed + ' passed, ' + failed + ' failed\n');
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
