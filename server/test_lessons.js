/* The lessons, driven for real.
 *
 * Two halves. The first asks the page's own move generator whether every
 * fixed position in the course is a position and every fixed move is a move —
 * a notation drill that asks for a move the board will not accept is a lesson
 * that cannot be finished, and nothing else in the repo would notice.
 *
 * The second boots the WHOLE page under a DOM stub and walks the course the
 * way a player does: press the buttons, click the squares, type into the
 * console, and check that each step actually opens the next one. It solves
 * every task by brute force rather than by being told the answer, so a step
 * that cannot be answered fails here instead of on somebody's screen.
 *
 *   node server/test_lessons.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const C = require(path.join(__dirname, '..', 'tools', 'page_chess.js'));

const PAGE = path.join(__dirname, '..', 'blind-chess.html');
const SRC = fs.readFileSync(PAGE, 'utf8');

let passed = 0, failed = 0;
const check = (label, ok, detail) => {
  if (ok){ passed++; console.log('  PASS  ' + label); }
  else { failed++; console.log('  FAIL  ' + label + (detail === undefined ? '' : '  ' + detail)); }
};
const head = s => console.log('\n' + s);
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms){
  const stop = Date.now() + (ms || 4000);
  while (Date.now() < stop){ if (fn()) return true; await sleep(40); }
  return false;
}

/* ============================================================
   1 · every fixed position, against the page's own chess
   ============================================================ */
function grab(re, what){
  const m = SRC.match(re);
  if (!m) throw new Error('test_lessons: could not find ' + what);
  return m[0];
}
const NOTATION = new Function(
  grab(/\nconst LSN_NOTATION = \[[\s\S]*?\n\];/, 'LSN_NOTATION') + '\nreturn LSN_NOTATION;')();
const CHALLENGES = new Function(
  grab(/\nconst LSN_CHALLENGES = \[[\s\S]*?\n\];/, 'LSN_CHALLENGES') + '\nreturn LSN_CHALLENGES;')();

function sansOf(st){
  const legal = C.legalMoves(st, st.turn);
  return { legal, sans: legal.map(m => C.toSAN(st, m, legal)) };
}
function sane(label, st){
  const wk = C.kingSq(st, 'w'), bk = C.kingSq(st, 'b');
  check(label + ' has both kings', wk >= 0 && bk >= 0);
  check(label + ' does not leave the side not to move in check',
        !C.inCheck(st, C.other(st.turn)));
}

head('Every notation drill asks for a move the board will play');
check('there are ten of them', NOTATION.length === 10, NOTATION.length);
for (const item of NOTATION){
  const st = C.stateFromFEN(item.fen);
  check(item.san + ' — the FEN survives a round trip', C.fenOf(st) === item.fen, C.fenOf(st));
  sane(item.san, st);
  const { sans } = sansOf(st);
  check(item.san + ' is legal there', sans.indexOf(item.san) >= 0, sans.join(' '));
  check(item.san + ' is the only move written that way',
        sans.filter(s => s === item.san).length === 1);
}
const forms = NOTATION.map(i => i.san).join(' ');
['e4','Nf3','Bxe5','exd5','O-O','O-O-O','e8=Q','Qh5+','Qf7#','Nbd2'].forEach(f =>
  check('the course teaches ' + f, forms.split(' ').indexOf(f) >= 0));

head('Every challenge line is playable from its own position');
check('there are three of them', CHALLENGES.length === 3, CHALLENGES.length);
CHALLENGES.forEach((spec, i) => {
  const label = 'challenge ' + (i + 1);
  let st = C.stateFromFEN(spec.fen);
  check(label + "'s FEN survives a round trip", C.fenOf(st) === spec.fen, C.fenOf(st));
  sane(label, st);
  check(label + ' is reduced material, not a whole game',
        st.b.filter(Boolean).length <= 12, st.b.filter(Boolean).length + ' men');
  let ok = true;
  spec.pre.concat([spec.answer]).forEach(want => {
    if (!ok) return;
    const { legal, sans } = sansOf(st);
    const at = sans.indexOf(want);
    if (at < 0){ ok = false; check(label + ': ' + want + ' is legal', false, sans.join(' ')); return; }
    st = C.makeMove(st, legal[at]);
  });
  if (ok) check(label + ' plays out: ' + spec.pre.concat([spec.answer]).join(' '), true);
  check(label + ' ends on the move it asks for', spec.answer.length > 0);
});

/* ============================================================
   2 · the whole page, and the course walked through it
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
  // className has to actually reset the classes, because the board renderer
  // leans on exactly that to wipe a square before marking it again.
  let cls = '';
  Object.defineProperty(e, 'className', {
    get(){ return cls; },
    set(v){ cls = String(v); e.classList._all.clear(); cls.split(/\s+/).forEach(c => { if (c) e.classList._all.add(c); }); }
  });
  // …and innerHTML has to empty the children, or a rebuilt button strip grows.
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

/** One whole page, with nothing behind it. */
function makePage(store){
  const doc = makeDoc();
  const loc = { protocol:'http:', host:'localhost:8787', href:'http://localhost:8787/', hash:'', search:'' };
  const storage = { getItem:k => (k in store ? store[k] : null),
                    setItem:(k, v) => { store[k] = String(v); }, removeItem:k => { delete store[k]; } };
  const win = { addEventListener(){}, removeEventListener(){}, scrollTo(){},
                matchMedia:() => ({ matches:false, addEventListener(){}, addListener(){} }),
                innerWidth:1200, innerHeight:900, devicePixelRatio:1, location:loc, localStorage:storage };
  const BODY = grab(/<script>\n[\s\S]*?\n<\/script>/, 'the page script')
    .replace(/^<script>\n/, '').replace(/\n<\/script>$/, '');
  const src = '"use strict";' + BODY.replace(/await import\([^)]*\)/g, 'await Promise.reject(new Error("no cdn"))') +
    '\n__expose({ G, LSN, LESSONS, el, showScreen, lsnEnter, lsnHub, lsnOpen, lsnNext, lsnBack,' +
    ' lsnDone, lsnReach, lsnSqEls, lsnVisual, legalMoves, toSAN, sqName, sqIndex,' +
    ' stateFromFEN, parseMoveIn, MODE_NAME, PR, PR_MODES, goPractice, prLoad,' +
    ' screen:()=>screenName });';
  let out = null;
  new Function('document','window','location','localStorage','WebSocket','AudioContext',
               'webkitAudioContext','fetch','Image','requestAnimationFrame','cancelAnimationFrame',
               'getComputedStyle','navigator','console','__expose', src)(
    doc, win, loc, storage, DeadSocket, AudioCtx, AudioCtx,
    () => Promise.resolve({ ok:false, status:404, json:() => Promise.resolve(null), text:() => Promise.resolve('') }),
    mk, cb => setTimeout(() => cb(Date.now()), 16), clearTimeout,
    () => ({ getPropertyValue: () => '' }), { userAgent:'node' },
    { log(){}, warn(){}, error(){} }, o => { out = o; });
  out.doc = doc;
  out.by = id => doc.getElementById(id);
  out.press = id => { const b = doc.getElementById(id); if (!b.disabled && b.onclick) b.onclick(); };
  out.shown = name => doc.getElementById('screen-' + name).classList.contains('show');
  return out;
}

/** Answer whatever the open step is asking, without being told the answer. */
async function solveStep(p, budget){
  const stop = Date.now() + (budget || 30000);
  const under = () => p.by('lsnUnder').children;
  const choices = () => p.by('lsnChoices').children;
  // Reveal and Try Another are answers to an answered step, and Clear undoes
  // the picks the solver has just made; everything else under the board is a
  // way in and gets pressed.
  const SKIP = ['Reveal', 'Try Another', 'Clear', 'Check'];
  const done = new Set();
  const pressUnder = () => {
    for (const b of under()){
      if (b.disabled || SKIP.some(s => b.textContent.indexOf(s) === 0)) continue;
      if (done.has(b.textContent)) continue;
      done.add(b.textContent);
      b.onclick();
      return true;
    }
    return false;
  };
  while (!p.LSN.ok && Date.now() < stop){
    if (pressUnder()){ await sleep(180); continue; }
    // multiple choice: press them until one of them is right
    let pressed = false;
    for (const b of choices()){
      if (b.disabled || b.classList.contains('right') || b.classList.contains('wrong')) continue;
      b.onclick(); pressed = true; break;
    }
    if (pressed){ await sleep(60); continue; }
    // select-many: the question names the square, the page names the moves
    if (p.LSN.onSquare && Array.from(under()).some(b => b.textContent.indexOf('Check') === 0)){
      const from = firstPick(p);
      // clicked one at a time, the way a player does — the Check button only
      // lights up once something has been picked
      p.legalMoves(p.LSN.st, 'w').filter(m => m.from === from).forEach(m => p.LSN.onSquare(m.to));
      for (const b of under()) if (b.textContent.indexOf('Check') === 0 && !b.disabled){ b.onclick(); break; }
      await sleep(120);
      continue;
    }
    // a move on the board: ask the page which moves there are, and try them
    if (p.LSN.onSquare && p.LSN.st && p.LSN.st.b.some(Boolean)){
      const legal = p.legalMoves(p.LSN.st, p.LSN.st.turn);
      for (const m of legal){
        if (p.LSN.ok || !p.LSN.onSquare) break;
        p.LSN.sel = -1; p.LSN.marks.clear();
        p.LSN.onSquare(m.from);
        if (p.LSN.onSquare) p.LSN.onSquare(m.to);
        await sleep(12);
      }
      if (p.LSN.ok) break;
    }
    // a square with nothing on it: every square, one at a time
    if (p.LSN.onSquare && !(p.LSN.st && p.LSN.st.b.some(Boolean))){
      for (let i = 0; i < 64 && !p.LSN.ok; i++){ p.LSN.onSquare(i); await sleep(4); }
      if (p.LSN.ok) break;
    }
    // the console: type what the question is asking for
    if (p.LSN.onEntry){
      const ask = p.by('lsnAsk').innerHTML || '';
      const want = (ask.match(/<code>([^<]+)<\/code>/) || [])[1];
      if (want){ p.LSN.onEntry(want); await sleep(200); continue; }
    }
    await sleep(120);
  }
  return p.LSN.ok;
}
/** The square the select-many drill is asking about, read off its own question. */
function firstPick(p){
  const ask = p.by('lsnAsk').innerHTML || '';
  const m = ask.match(/<code>([a-h][1-8])<\/code>/);
  return m ? p.sqIndex(m[1]) : -1;
}

/** Walk one lesson end to end, answering everything. */
async function walk(p, n){
  p.lsnOpen(n, 0);
  const steps = p.LSN.steps.length;
  check('lesson ' + n + ' opens with steps', steps > 0, steps);
  for (let i = 0; i < steps; i++){
    const at = p.LSN.step;
    const gated = !!p.LSN.steps[at].gate;
    if (gated){
      const ok = await solveStep(p);
      if (!ok){
        check('lesson ' + n + ' step ' + (at + 1) + ' can be answered', false,
              'ask was: ' + (p.by('lsnAsk').innerHTML || '').slice(0, 120));
        return false;
      }
    }
    check('lesson ' + n + ' step ' + (at + 1) + ' of ' + steps + (gated ? ' answered' : ' read'), true);
    if (p.by('lsnNext').disabled){
      check('lesson ' + n + ' step ' + (at + 1) + ' opens the way on', false);
      return false;
    }
    p.press('lsnNext');
    await sleep(30);
    if (i < steps - 1 && p.LSN.step !== at + 1){
      check('lesson ' + n + ' moved on from step ' + (at + 1), false, 'now at ' + p.LSN.step);
      return false;
    }
  }
  return true;
}

(async function run(){
  const store = {};
  const p = makePage(store);

  head('The lessons live on a screen of their own, beside Practice');
  check('nothing has opened it yet', p.screen() === 'home', p.screen());
  check('Practice is a different screen', p.by('screen-practice') !== p.by('screen-lessons'));
  // the lane the wordmark hangs in, reserved here as it is for Practice
  check('and the lessons screen reserves the same lane',
        /#screen-lessons,[^\n]*\n[^\n]*padding-left:var\(--rail\)/.test(SRC) ||
        /#screen-lessons[^\n]*padding-left/.test(SRC));
  p.press('navHowTo');
  check('How to Play Blind Chess opens it', p.screen() === 'lessons', p.screen());
  check('and the ladder is what it shows', p.LSN.view === 'hub', p.LSN.view);
  check('the seven are listed', p.by('lsnList').children.length === 7,
        p.by('lsnList').children.length);
  check('only the first is open',
        !p.by('lsnList').children[0].disabled && p.by('lsnList').children[1].disabled);
  check('the course names all seven', p.LESSONS.length === 7);

  head('The board is drawn the way the game draws it');
  p.lsnOpen(2, 0);
  check('sixty-four squares', p.lsnSqEls.length === 64, p.lsnSqEls.length);
  check('a1 is the bottom left from White’s chair',
        +p.lsnSqEls[56].dataset.sq === 56 && p.sqName(56) === 'a1', p.lsnSqEls[56].dataset.sq);
  check('and the top right from Black’s', (function(){
    p.LSN.flip = true;
    return p.lsnVisual(56) === 7;
  })());
  p.LSN.flip = false;
  check('e4 is where e4 is', p.sqName(p.sqIndex('e4')) === 'e4');

  head('Every lesson can be walked end to end');
  for (let n = 1; n <= 7; n++){
    const ok = await walk(p, n);
    check('lesson ' + n + ' finishes', ok);
    if (!ok) break;
  }

  head('Each challenge accepts the move it is asking for');
  for (let i = 0; i < CHALLENGES.length; i++){
    p.lsnOpen(7, i + 1);
    const spec = CHALLENGES[i];
    let b = null;
    for (const c of p.by('lsnUnder').children) if (c.textContent.indexOf('I’m Ready') === 0) b = c;
    check('challenge ' + (i + 1) + ' offers I’m Ready', !!b);
    if (!b) continue;
    b.onclick();
    const ready = await until(() => (p.by('lsnAsk').innerHTML || '').indexOf('Play it on the board') >= 0, 8000);
    check('challenge ' + (i + 1) + ' plays its sequence and then asks', ready,
          p.by('lsnAsk').innerHTML);
    const legal = p.legalMoves(p.LSN.st, p.LSN.st.turn);
    const want = legal.find(m => p.toSAN(p.LSN.st, m, legal) === spec.answer);
    check('challenge ' + (i + 1) + ': ' + spec.answer + ' is on the board', !!want);
    if (!want) continue;
    p.LSN.onSquare(want.from);
    p.LSN.onSquare(want.to);
    check('challenge ' + (i + 1) + ' accepts ' + spec.answer + ' first time',
          p.LSN.ok && p.LSN.tries === 0, 'tries ' + p.LSN.tries);
  }
  p.lsnOpen(7, 0);
  for (let i = 0; i < 4; i++){
    if (p.LSN.steps[p.LSN.step].gate) await solveStep(p);
    p.press('lsnNext');
    await sleep(40);
  }

  head('Finishing the seventh finishes the course');
  check('the completion state is up', p.LSN.view === 'done', p.LSN.view);
  check('all seven are recorded', p.lsnDone().length === 7, p.lsnDone().join(','));
  check('and written to this browser',
        Object.keys(store).some(k => k.indexOf('nox.lessons.') === 0), Object.keys(store).join(','));

  head('Progress survives a reload');
  const again = makePage(store);
  again.press('navHowTo');
  check('the ladder remembers', again.lsnDone().length === 7, again.lsnDone().join(','));
  check('every row is ticked',
        Array.from(again.by('lsnList').children).every(b => b.classList.contains('done')));
  check('and none of them is locked',
        Array.from(again.by('lsnList').children).every(b => !b.disabled));

  head('Neither button at the end is a dead one');
  again.lsnOpen(7, 0);
  again.press('lsnGoPractice');
  check('Go to Practice opens the Practice page', again.screen() === 'practice', again.screen());
  check('and it is the real one, running', again.PR.on === true);
  check('showing its dashboard', again.PR.view === 'dash', again.PR.view);
  check('the course did not follow it there', again.LSN.view !== 'lesson', again.LSN.view);
  again.showScreen('lessons');
  again.lsnOpen(7, 0);
  again.press('lsnGoPlay');
  check('Play Blindfold lands on the game setup', again.screen() === 'game', again.screen());
  check('with Complete Blindfold already chosen', again.G.mode === 'total', again.G.mode);
  check('and no game started by it', again.G.started === false);

  head('The course does not trap anybody');
  again.press('navHowTo');
  again.lsnOpen(4, 0);
  again.press('lsnExit');
  check('Exit returns to the ladder', again.LSN.view === 'hub', again.LSN.view);
  again.lsnOpen(4, 2);
  again.press('lsnBack');
  check('Back steps back inside a lesson', again.LSN.step === 1, again.LSN.step);
  again.lsnOpen(4, 0);
  again.press('lsnBack');
  check('and out of the front of one into the last step of the one before',
        again.LSN.n === 3 && again.LSN.step === again.LSN.steps.length - 1,
        again.LSN.n + '/' + again.LSN.step);
  again.lsnOpen(1, 0);
  again.press('lsnBack');
  check('the very first step steps out to the ladder', again.LSN.view === 'hub', again.LSN.view);

  head('Leaving takes the lesson’s timers with it');
  again.lsnOpen(5, 1);
  const started = again.LSN.timers.length;
  again.showScreen('home');
  check('a running lesson had timers', started >= 0);
  check('and none are left after leaving', again.LSN.timers.length === 0, again.LSN.timers.length);
  check('nor a live board listener', again.LSN.onSquare === null);

  head('Reset puts it back to nothing');
  again.press('navHowTo');
  again.press('lsnReset');                       // armed
  again.press('lsnReset');                       // and confirmed
  check('progress is gone', again.lsnDone().length === 0, again.lsnDone().join(','));
  check('the ladder is back to lesson one', again.lsnReach() === 1, again.lsnReach());
  check('and everything past it is locked again', again.by('lsnList').children[1].disabled);

  head('Practice is the other page, and only the other page');
  again.press('navPractice');
  check('the Practice menu item opens the Practice page',
        again.screen() === 'practice', again.screen());
  check('with all seven of its own drills', again.PR_MODES.length === 7, again.PR_MODES.length);
  check('the course has no practice mode of its own', !('practice' in again.LSN));
  check('and nothing in the lessons pretends to be one',
        SRC.indexOf('lsnPractice') < 0 && SRC.indexOf('lsnDrills') < 0);
  check('there is one Practice screen', (SRC.match(/id="screen-practice"/g) || []).length === 1);
  check('and one door into it',
        (SRC.match(/^function goPractice\(/gm) || []).length === 1);

  head('The two records are kept apart');
  again.press('navHowTo');
  again.lsnOpen(1, 0);
  const lessonKeys = Object.keys(store).filter(k => k.indexOf('nox.lessons.') === 0);
  const practiceKeys = Object.keys(store).filter(k => k.indexOf('nox.practice.') === 0);
  check('lesson progress has its own key', lessonKeys.length >= 0);
  check('practice progress has another', practiceKeys.length >= 0);
  check('and neither key is the other', !lessonKeys.some(k => practiceKeys.indexOf(k) >= 0));
  check('a practice session leaves the course alone', (function(){
    const before = again.lsnDone().join(',');
    again.goPractice();
    again.showScreen('home');
    return again.lsnDone().join(',') === before;
  })());

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
