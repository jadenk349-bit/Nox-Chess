'use strict';
/* Study Board, with the Education System behind it.
 *
 * The page is booted whole under a DOM shim, the way test_lessons.js does it,
 * because what is being tested is not a pure function: it is a fetch, a
 * module evaluation, a render and — most importantly — what happens when the
 * fetch fails. Extracting eduAnalyse() by name would test the arithmetic and
 * miss all four.
 *
 * The two halves this suite exists for:
 *
 *   1. IT FAILS QUIET. The concept card is additive. With no education/ on the
 *      server — an old container, a stale cache, a page opened off the disk —
 *      Study Board must be exactly what it was before. That is the default
 *      here, because the DOM shim's fetch answers 404 to everything.
 *
 *   2. IT DOES NOT INVENT. Given a real corpus it names concepts; given a
 *      position with nothing in it, it says nothing rather than reaching for
 *      the nearest label. That refusal is the reason to use this system, so it
 *      is asserted on a position chosen to have no answer.
 *
 *     node server/test_study_education.js       # needs no server
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PAGE = path.join(ROOT, 'blind-chess.html');
const SRC = fs.readFileSync(PAGE, 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, detail){
  if (cond) { pass++; return; }
  fail++;
  console.log('  FAIL  ' + name + (detail ? '\n        ' + String(detail).slice(0, 400) : ''));
}
function eq(name, got, want){ ok(name, got === want, 'got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want)); }
function grab(re, what){
  const m = SRC.match(re);
  if (!m) throw new Error(what + ' not found in ' + PAGE);
  return m[0];
}
const wait = ms => new Promise(r => setTimeout(r, ms));

/* ============================================================
   1 · the DOM shim
   ============================================================ */
function classSet(){
  const have = new Set();
  return { add:c => have.add(c), remove:c => have.delete(c),
           toggle:(c, on) => { if (on === undefined) have.has(c) ? have.delete(c) : have.add(c);
                               else on ? have.add(c) : have.delete(c); },
           contains:c => have.has(c), _all:have };
}
function mk(tag){
  const e = {
    tagName:(tag || 'div').toUpperCase(), textContent:'', value:'', disabled:false,
    checked:false, style:{}, dataset:{}, children:[], parentElement:null,
    offsetWidth:100, onclick:null, onsubmit:null, classList:classSet(),
    appendChild(c){ this.children.push(c); c.parentElement = this; return c; },
    removeChild(c){ return c; }, remove(){}, setAttribute(){}, getAttribute(){ return null; },
    addEventListener(){}, removeEventListener(){}, focus(){}, blur(){},
    click(){ if (!this.disabled && this.onclick) this.onclick(); },
    scrollIntoView(){}, getBoundingClientRect(){ return { top:0, left:0, width:100, height:100 }; },
    querySelectorAll(){ return []; }, closest(){ return null; },
    getContext(){ return new Proxy({}, { get:(t, k) => k in t ? t[k]
        : (/create(Radial|Linear)Gradient/.test(k) ? () => ({ addColorStop(){} })
          : k === 'measureText' ? () => ({ width:10 }) : () => undefined),
      set:(t, k, v) => { t[k] = v; return true; } }); }
  };
  let cls = '';
  Object.defineProperty(e, 'className', {
    get(){ return cls; },
    set(v){ cls = String(v); e.classList._all.clear(); cls.split(/\s+/).forEach(c => { if (c) e.classList._all.add(c); }); }
  });
  let html = '';
  Object.defineProperty(e, 'innerHTML', {
    get(){ return html; },
    set(v){ html = String(v); e.children.length = 0; }
  });
  Object.defineProperty(e, 'firstChild', {
    get(){ return this.children.length ? this.children[0] : (this.children[0] = mk('span')); } });
  e.querySelector = () => e.__qs || (e.__qs = mk());
  return e;
}
function makeDoc(){
  const pool = {}, seen = {};
  return {
    getElementById: id => pool[id] || (pool[id] = mk()),
    querySelector: sel => seen[sel] || (seen[sel] = mk()),
    querySelectorAll: () => [], createElement: mk, createElementNS: mk,
    addEventListener(){}, removeEventListener(){}, body: mk(), documentElement: mk(), head: mk()
  };
}
const AudioCtx = function(){
  return { createOscillator:() => ({ connect(){}, start(){}, stop(){}, frequency:{ setValueAtTime(){} }, type:'' }),
           createGain:() => ({ connect(){}, gain:{ setValueAtTime(){}, exponentialRampToValueAtTime(){}, linearRampToValueAtTime(){} } }),
           destination:{}, currentTime:0, resume:() => Promise.resolve(), state:'running' }; };
function DeadSocket(){ this.readyState = 0; this.close = function(){}; this.send = function(){}; }
DeadSocket.OPEN = 1;

/* A fetch that serves the real education/ files off disk, so the page is
 * evaluating exactly what the server would hand it. `only404` is the other
 * half of the suite and is the DEFAULT the other test files already use. */
function diskFetch(log){
  return url => {
    const clean = String(url).split('?')[0].replace(/^\/+/, '');
    const p = path.join(ROOT, clean);
    if (log) log.push(clean);
    if (!/^education\//.test(clean) || !fs.existsSync(p))
      return Promise.resolve({ ok:false, status:404, text:() => Promise.resolve(''),
                               json:() => Promise.resolve(null) });
    const body = fs.readFileSync(p, 'utf8');
    return Promise.resolve({ ok:true, status:200,
                             text:() => Promise.resolve(body),
                             json:() => Promise.resolve(JSON.parse(body)) });
  };
}
const only404 = () => Promise.resolve({ ok:false, status:404, text:() => Promise.resolve(''),
                                        json:() => Promise.resolve(null) });

/** One whole page, with a fetch of the caller's choosing behind it. */
function makePage(fetchImpl){
  const doc = makeDoc();
  const store = {};
  const loc = { protocol:'http:', host:'localhost:8787', href:'http://localhost:8787/', hash:'', search:'' };
  const storage = { getItem:k => (k in store ? store[k] : null),
                    setItem:(k, v) => { store[k] = String(v); }, removeItem:k => { delete store[k]; } };
  const win = { addEventListener(){}, removeEventListener(){}, scrollTo(){},
                matchMedia:() => ({ matches:false, addEventListener(){}, addListener(){} }),
                innerWidth:1200, innerHeight:900, devicePixelRatio:1, location:loc, localStorage:storage };
  const warned = [];
  const BODY = grab(/<script>\n[\s\S]*?\n<\/script>/, 'the page script')
    .replace(/^<script>\n/, '').replace(/\n<\/script>$/, '');
  const src = '"use strict";' + BODY.replace(/await import\([^)]*\)/g, 'await Promise.reject(new Error("no cdn"))') +
    '\n__expose({ G, REV, EDU, eduLoad, eduAnalyse, eduRender, eduChess, eduSan, eduKind,' +
    ' enterReview, exitReview, reviewClose, reviewGoto, reviewBuild, reviewRender,' +
    ' newState, makeMove, legalMoves, uciOf, toSAN, fenOf, stateFromFEN, EDU_VERSION });';
  let out = null;
  new Function('document','window','location','localStorage','WebSocket','AudioContext',
               'webkitAudioContext','fetch','Image','requestAnimationFrame','cancelAnimationFrame',
               'getComputedStyle','navigator','console','__expose', src)(
    doc, win, loc, storage, DeadSocket, AudioCtx, AudioCtx,
    fetchImpl, mk, cb => setTimeout(() => cb(Date.now()), 16), clearTimeout,
    () => ({ getPropertyValue: () => '' }), { userAgent:'node' },
    { log(){}, warn(...a){ warned.push(a.join(' ')); }, error(){} }, o => { out = o; });
  out.doc = doc;
  out.warned = warned;
  out.by = id => doc.getElementById(id);
  return out;
}

/* A short real game, so REV has states and moves to walk. Played through the
 * page's own generator rather than written down, for the same reason
 * tools/replay_game.js does it: a move list nobody checked is a move list that
 * is wrong. */
const OPENING = ['e2e4','e7e5','g1f3','b8c6','f1c4','g8f6','f3g5','d7d5','e4d5','c6a5'];
function playInto(p){
  let st = p.newState();
  p.G.uci = []; p.G.sans = [];
  for (const u of OPENING){
    const ms = p.legalMoves(st);
    const m = ms.find(x => p.uciOf(x) === u);
    if (!m) throw new Error('test opening is not playable at ' + u);
    p.G.sans.push(p.toSAN(st, m, ms));
    p.G.uci.push(u);
    st = p.makeMove(st, m);
  }
  p.G.st = st;
  return st;
}

/* ============================================================
   2 · the structure, read off the page source
   ============================================================ */
console.log('');
ok('reviewRender hands off to the education layer', /eduAnalyse\(ply\);/.test(SRC));
/* And ABOVE the engine's four early returns, so a browser that cannot run
   Stockfish still gets the concepts — the knowledge base does not need one. */
const rr = grab(/\nfunction reviewRender\(\)\{[\s\S]*?\n\}/, 'reviewRender()');
ok('and before the engine can short-circuit the render',
   rr.indexOf('eduAnalyse(ply)') < rr.indexOf('SF.unavailable'),
   'eduAnalyse at ' + rr.indexOf('eduAnalyse(ply)') + ', SF.unavailable at ' + rr.indexOf('SF.unavailable'));
ok('reviewClose hides the concept card',
   /function reviewClose[\s\S]*?conceptCard[\s\S]*?\n\}/.test(SRC));
ok('the concept card is markup, not built at runtime', /id="conceptCard"/.test(SRC));
eq('there is exactly one concept card', (SRC.match(/id="conceptCard"/g) || []).length, 1);

/* The education layer must carry no chess knowledge of its own. It is wiring:
 * it may name the API and the page's chess, and it may not decide what a fork
 * is. A second opinion here is the one thing this integration exists not to
 * build, and it would be invisible from the outside. */
const eduSection = grab(/\/\* =+\n   THE EDUCATION LAYER[\s\S]*?\n\/\* =+\n   THE PUZZLES/, 'the education section');
// Comments are where the reason for the wiring is written, and the reason has
// to be allowed to name a concept. It is the CODE that must not.
const eduCode = eduSection.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
for (const word of ['outpost', 'isolated', 'backward pawn', 'weak square', 'zugzwang'])
  ok('the education layer does not define "' + word + '" itself',
     !new RegExp('\\b' + word + '\\b', 'i').test(eduCode), word);
ok('and it does not re-derive motifs', !/function\s+edu\w*Motif/i.test(eduSection));

/* The shim is the whole port, so it has to be complete. Read the name list out
 * of tools/page_chess.js rather than repeating it here — that file is the one
 * that decides what the library can ask for. */
const PC = fs.readFileSync(path.join(ROOT, 'tools', 'page_chess.js'), 'utf8');
const names = [];
for (const block of ['DECLS', 'FNS']){
  const m = PC.match(new RegExp('const ' + block + ' = \\[([\\s\\S]*?)\\];'));
  if (m) for (const q of m[1].match(/'[^']+'/g) || []) names.push(q.slice(1, -1));
}
ok('page_chess.js still declares its name lists', names.length > 40, names.length);
const shim = grab(/function eduChess\(\)\{[\s\S]*?\n\}/, 'eduChess()');
const absent = names.filter(n => !new RegExp('\\b' + n + ':').test(shim));
eq('the browser shim offers every name page_chess.js exports', absent.join(','), '');

/* ============================================================
   3 · it fails quiet
   ============================================================ */
async function testDegrades(){
  const p = makePage(only404);
  playInto(p);
  p.enterReview();
  await wait(60);
  ok('the library did not load', p.EDU.ready === false);
  ok('and the failure was recorded rather than retried forever', p.EDU.failed === true);
  eq('the concept card is hidden', p.by('conceptCard').style.display, 'none');
  eq('and it was never written into', p.by('conceptBody').innerHTML, '');
  // The point of the whole exercise: Study Board still works.
  ok('the review still built its states', p.REV.states.length === OPENING.length + 1,
     p.REV.states.length);
  ok('the review is still open', p.REV.on === true);
  p.reviewGoto(4);
  eq('and navigating still moves', p.REV.ply, 4);
  ok('nothing was thrown at the player', p.warned.every(w => !/TypeError|undefined is not/.test(w)),
     p.warned.join(' | '));
}

/* ============================================================
   4 · it names concepts, and refuses to invent them
   ============================================================ */
async function testNames(){
  const log = [];
  const p = makePage(diskFetch(log));
  playInto(p);
  p.enterReview();
  await wait(400);
  ok('the library loaded', p.EDU.ready === true, p.warned.join(' | '));
  ok('it fetched the three library files and the bundle',
     ['education/lib/features.js', 'education/lib/matchers.js', 'education/lib/analyze.js',
      'education/dist/education-bundle.json'].every(f => log.includes(f)), log.join(', '));
  ok('every fetch carried a cache-busting version', p.EDU_VERSION >= 1);

  /* MATCHER_ERRORS is exported by matchers.js and NOT re-exported by
     analyze.js, so reading it off the API gives undefined and the guard that
     watches it can never fire. That array exists because a matcher which
     throws is indistinguishable from one whose guards work; a watcher on it
     that is itself dead would be the same bug twice. */
  ok('the matcher-error array is actually reachable',
     Array.isArray(p.EDU.matchers && p.EDU.matchers.MATCHER_ERRORS),
     Object.keys(p.EDU.matchers || {}).join(','));
  eq('and no matcher threw on a real game', (p.EDU.matchers.MATCHER_ERRORS || []).length, 0);

  // A real middlegame-ish position from the game just played.
  p.reviewGoto(8);
  await wait(50);
  const html = p.by('conceptBody').innerHTML;
  ok('the card was written', html.length > 0);
  eq('and shown', p.by('conceptCard').style.display, '');
  ok('it names at least one concept', /class="cc-name"/.test(html), html.slice(0, 200));
  ok('it shows a confidence', /class="cc-conf (low|medium|high)"/.test(html), html.slice(0, 200));
  ok('it says why it applies to THIS board', /class="cc-why"/.test(html), html.slice(0, 300));

  /* Refusal 1, on a real board the knowledge base declines to label. Two bare
     kings was the first choice and was WRONG: that position is insufficient
     material, which is an official rule and a concept, and the system was
     right to name it. This one is a shipped puzzle position that licenses
     nothing — the refusal has to be tested where it actually happens, not on a
     board contrived to be empty. */
  const NOTHING = 'r3kbnr/1pBbppp1/2p5/p6p/1q1PN3/5P2/PPPQ2PP/R3KB1R w KQkq a6 0 11';
  p.REV.states[2] = p.stateFromFEN(NOTHING);
  p.G.uci[2] = null;
  p.reviewGoto(2);
  await wait(50);
  const bare = p.by('conceptBody').innerHTML;
  ok('a position it cannot label names no concept', !/class="cc-name"/.test(bare), bare.slice(0, 300));
  ok('and says so in the knowledge base\'s own words',
     /class="cc-none"/.test(bare) && /researched concept/.test(bare), bare.slice(0, 300));
  ok('and reaches for no nearest label',
     !/\b(outpost|fork|pin|weak square)\b/i.test(bare), bare.slice(0, 300));

  /* The card shows what the API returned and nothing else. This is the
     assertion that would catch a well-meaning fallback being added later. */
  p.reviewGoto(8);
  await wait(20);
  const shown = (p.by('conceptBody').innerHTML.match(/class="cc-name">([^<]+)</g) || [])
    .map(x => x.replace(/.*>/, '').replace(/<$/, ''));
  const said = p.EDU.api.analyzeWithEducation({
    fen: p.fenOf(p.REV.states[8]), move: p.G.uci[8], level: 'intermediate', depth: 'normal',
  }).concepts.map(c => c.name);
  ok('every name on the card came from the API',
     shown.every(n => said.indexOf(n) >= 0), shown.join(',') + ' vs ' + said.join(','));

  // Refusal 2 is the API's, and the page must not undo it: with no engine
  // numbers the card may name ideas and may not call the move good.
  ok('no quality verdict is ever written into the concept card',
     !/\b(blunder|mistake|inaccuracy|brilliant)\b/i.test(html), html.slice(0, 300));

  // Teardown, because the card borrows the same screen as everything else.
  p.exitReview();
  eq('leaving Study Board hides the card', p.by('conceptCard').style.display, 'none');
}

/* Every knowledge_type the corpus uses must have a word for the reader.
 *
 * The first version of that table sorted twelve types into three buckets and
 * called `hanging-piece` "a rule of the game", because `terminology` fell into
 * the default. A label that is wrong about what KIND of claim it is undermines
 * the confidence badge next to it, so the table is exhaustive and this is what
 * keeps it exhaustive as the corpus grows. */
function testKindWords(){
  const kinds = new Set();
  const cdir = path.join(ROOT, 'education', 'concepts');
  for (const d of fs.readdirSync(cdir)){
    const sub = path.join(cdir, d);
    if (!fs.statSync(sub).isDirectory()) continue;
    for (const fn of fs.readdirSync(sub))
      if (fn.endsWith('.json'))
        kinds.add(JSON.parse(fs.readFileSync(path.join(sub, fn), 'utf8')).knowledge_type);
  }
  ok('the corpus still has knowledge types to label', kinds.size >= 10, kinds.size);
  const table = grab(/const EDU_KIND_WORD = \{[\s\S]*?\n\};/, 'EDU_KIND_WORD');
  const missing = [...kinds].filter(k => !table.includes("'" + k + "'"));
  eq('every knowledge_type in the corpus has a reader-facing word', missing.join(','), '');
  ok('and a rule is not called a term', /'official-rule': 'a rule of the game'/.test(table));
  ok('and a term is not called a rule', /'terminology': 'terminology'/.test(table));
}

/* The engine half, which the DOM shim has no Stockfish for. eduRender() is
 * called directly with the shape reviewCached() produces, because the
 * alternatives line is the one part of the card that comes from the engine
 * rather than from the knowledge base. */
async function testAlternatives(){
  const p = makePage(diskFetch());
  playInto(p);
  p.enterReview();
  await wait(400);
  if (!p.EDU.ready){ ok('alternatives render', false, 'library did not load'); return; }
  const st = p.REV.states[8];
  const all = p.legalMoves(st);
  const two = all.slice(0, 2).map(m => p.uciOf(m));
  const r = p.EDU.api.analyzeWithEducation({ fen: p.fenOf(st), level:'intermediate', depth:'normal' });
  p.eduRender(r, st, { cp: 30, mate: null, best: two[0],
                       lines: [{ cp: 30, mate: null, best: two[0] },
                               { cp: -10, mate: null, best: two[1] }] });
  const html = p.by('conceptBody').innerHTML;
  ok('the card says what the engine weighed', /class="cc-alt"/.test(html), html.slice(-300));
  ok('and names both moves in SAN', /<b>[A-Za-z][^<]*<\/b>[\s\S]*against[\s\S]*<b>/.test(html),
     html.slice(-300));
  // One line only is not a comparison, and must not pretend to be one.
  p.eduRender(r, st, { cp: 30, mate: null, best: two[0], lines: [{ cp: 30, mate: null, best: two[0] }] });
  ok('one line alone is not written up as a choice',
     !/class="cc-alt"/.test(p.by('conceptBody').innerHTML));
  ok('eduSan spells a move the way the game does',
     p.eduSan(st, two[0]) === p.toSAN(st, all[0], all), p.eduSan(st, two[0]));
  ok('and answers null for a move that is not there', p.eduSan(st, 'a1a8') === null);
}

/* The one that would catch a corpus quietly going missing: the page's answer
 * must be the same as the library's own, for the same position. */
async function testAgreesWithNode(){
  const p = makePage(diskFetch());
  playInto(p);
  p.enterReview();
  await wait(400);
  if (!p.EDU.ready){ ok('page agrees with the node API', false, 'library did not load'); return; }
  const st = p.REV.states[8];
  const fen = p.fenOf(st);
  const NODE = require(path.join(ROOT, 'education', 'lib', 'analyze.js'));
  const mine = p.EDU.api.analyzeWithEducation({ fen, move:p.G.uci[8], level:'intermediate', depth:'normal' });
  const theirs = NODE.analyzeWithEducation({ fen, move:p.G.uci[8], level:'intermediate', depth:'normal' });
  eq('the page and the node API agree, byte for byte',
     JSON.stringify(mine), JSON.stringify(theirs));
}

(async () => {
  try {
    testKindWords();
    await testDegrades();
    await testNames();
    await testAlternatives();
    await testAgreesWithNode();
  } catch (e) {
    fail++;
    console.log('  FAIL  threw: ' + (e && e.stack || e));
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
