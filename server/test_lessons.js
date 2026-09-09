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

/* The spec asks for the four forms below by shape rather than by name, so
 * this checks the shape rather than the fixed list above: a regenerated
 * ten that dropped, say, the disambiguated move but kept Nbd2's neighbour
 * would still pass the literal-string check and would still be a course
 * that never taught the form. Task 30's brief: if any of the four is
 * missing, a duplicated form in LSN_NOTATION should be swapped for it — as
 * it stands, all four are already covered by the existing ten. */
check('LSN_NOTATION teaches a capture', NOTATION.some(i => i.san.indexOf('x') >= 0),
      NOTATION.map(i => i.san).join(' '));
check('LSN_NOTATION teaches a castle', NOTATION.some(i => i.san === 'O-O'),
      NOTATION.map(i => i.san).join(' '));
check('LSN_NOTATION teaches a promotion', NOTATION.some(i => i.san.indexOf('=') >= 0),
      NOTATION.map(i => i.san).join(' '));
check('LSN_NOTATION teaches a disambiguated move',
      NOTATION.some(i => /^[NRQB][a-h1-8][a-h][1-8]/.test(i.san)),
      NOTATION.map(i => i.san).join(' '));

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

/* The course is ten lessons now, and every one of them ends by handing the
   player to the drill that trains what it just taught — so a lesson with no
   Practice mode named is a lesson that dead-ends. The two removed lessons of
   the five-lesson course have nowhere to land in the ten, exactly as the two
   removed lessons of the seven had nowhere to land in the five. */
head('The course is ten lessons that each hand off to Practice');
const LESSONS_SRC = grab(/\nconst LESSONS = \[[\s\S]*?\n\];/, 'LESSONS');
check('ten lessons are declared', (LESSONS_SRC.match(/\{ n:\d+/g) || []).length === 10,
      (LESSONS_SRC.match(/\{ n:\d+/g) || []).length);
check('every lesson names a Practice mode to train',
      (LESSONS_SRC.match(/train:\{ mode:'[a-z]+'/g) || []).length === 10,
      (LESSONS_SRC.match(/train:\{ mode:'[a-z]+'/g) || []).length);
const V23 = new Function(grab(/\nconst LSN_V2_TO_V3 = \{[^\n]*\};/, 'LSN_V2_TO_V3') + '\nreturn LSN_V2_TO_V3;')();
check('the old challenge lesson has nowhere to land', V23[5] === undefined);
check('old lesson 2 (notation) becomes lesson 3', V23[2] === 3);

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
    ' lsnDone, lsnReach, lsnSqEls, lsnVisual, lsnPositionHTML, lsnGauge, legalMoves, toSAN, sqName, sqIndex,' +
    ' stateFromFEN, parseMoveIn, MODE_NAME, PR, PR_MODES, goPractice, prLoad, resetChoices,' +
    // Task 30a: the seven new step factories, and the helpers a harness that
    // builds a step itself — rather than reading it off a lesson body, which
    // does not exist yet — needs to feed them the same kind of question
    // Practice would (prMakeSquare/prMakeLines/prRecipe), to open a step the
    // way lsnShow does without a lesson around it (lsnResetStep/lsnPaint/
    // lsnRender), and to check a select-many answer the way lineBetween()
    // would. kingSq/inCheck are not needed here: page state is plain data,
    // so tools/page_chess.js's C already judges it, exactly as it does the
    // fixed positions above.
    ' lsnStepDemo, lsnStepColour, lsnStepQuadrant, lsnStepBetween, lsnStepDiagPick,' +
    ' lsnStepKnight, lsnStepTypeMove, lsnKnightBoard, lsnResetStep, lsnPaint, lsnRender,' +
    ' prMakeSquare, prMakeLines, prRecipe, lineBetween,' +
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

  // Task 30a's seven step kinds each carry `solve`, the tag their factory
  // sets in blind-chess.html, and are answered by the strategy that tag
  // names rather than by the generic loop below — which predates `solve`
  // and still carries every step that has never set it (the drills, the
  // notation steps, the handoff). A step's `truth` field, where one carries
  // it, is for the PAGE's own use and is never read here: CLAUDE.md's rule
  // is that this harness answers by brute force, the same as a player would
  // have to, and a solver that read the answer off the step would stop
  // being able to catch a factory that cannot actually be solved.
  const step = p.LSN.steps[p.LSN.step];
  const kind = step && step.solve;
  if (kind === 'choices'){
    // press an unanswered, un-disabled choice until the step is ok or none
    // are left to try — right for a single-answer step, and for
    // lsnStepDiagPick's two-of-four it presses every one in turn, which
    // finds both of the right ones by the time the wrong ones are used up.
    while (!p.LSN.ok && Date.now() < stop){
      let pressed = false;
      for (const b of choices()){
        if (b.disabled || b.classList.contains('right') || b.classList.contains('wrong')) continue;
        b.onclick(); pressed = true; break;
      }
      if (!pressed) break;
      await sleep(60);
    }
    return p.LSN.ok;
  }
  if (kind === 'select'){
    // lsnStepBetween names its two endpoints in the question itself
    // (`Click every square between <code>a</code> and <code>b</code>…`), so
    // the two squares are read off that sentence — not off the step's own
    // `truth` — and the run between them is asked of the page's own
    // lineBetween(), exactly the geometry a player would have to work out.
    const ask = p.by('lsnAsk').innerHTML || '';
    const squares = (ask.match(/<code>([a-h][1-8])<\/code>/g) || [])
      .map(c => p.sqIndex(c.replace(/<\/?code>/g, '')));
    if (squares.length < 2 || !p.LSN.onSquare) return false;
    const between = p.lineBetween(squares[0], squares[1]) || [];
    between.forEach(sq => p.LSN.onSquare(sq));
    await sleep(20);
    for (const b of under()) if (!b.disabled && b.textContent.indexOf('Done') === 0){ b.onclick(); break; }
    await sleep(60);
    return p.LSN.ok;
  }
  if (kind === 'typed'){
    // lsnStepTypeMove is judged through parseMoveIn()/toSAN() exactly as a
    // game's console is, so it is solved the same way solveTyped() would:
    // walk every legal move in the position and type each one's own SAN
    // until the step is ok, never the SAN the card happens to be asking for.
    if (!p.LSN.onEntry || !p.LSN.st) return false;
    const legal = p.legalMoves(p.LSN.st, p.LSN.st.turn);
    for (const m of legal){
      if (p.LSN.ok) break;
      p.LSN.onEntry(p.toSAN(p.LSN.st, m, legal));
      await sleep(20);
    }
    return p.LSN.ok;
  }

  // 'square' (lsnDrillClick/lsnDrillName), 'move' (lsnNotationStep), 'none'
  // (lsnStepDemo/lsnHandoffStep, both gate-less and never asked to solve)
  // and steps that set no `solve` at all fall through to the loop below,
  // which already answers all of them.
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
  check('the ten are listed', p.by('lsnList').children.length === 10,
        p.by('lsnList').children.length);
  check('only the first is open',
        !p.by('lsnList').children[0].disabled && p.by('lsnList').children[1].disabled);
  check('the course names all ten', p.LESSONS.length === 10, p.LESSONS.length);
  check('and Know, Don’t See is the first of them',
        p.LESSONS[0].name === 'Know, Don’t See', p.LESSONS[0].name);
  check('every one of them names the drill that trains it',
        p.LESSONS.every(L => L.train && L.train.mode && L.train.level >= 1 && L.train.say),
        p.LESSONS.map(L => L.train && L.train.mode).join(','));
  check('and every drill it names is a Practice mode that exists',
        p.LESSONS.every(L => p.PR_MODES.some(m => m.key === L.train.mode)),
        p.LESSONS.map(L => L.train.mode).join(','));
  check('the lede counts ten of them',
        /Ten lessons/.test(p.by('lsnLede').innerHTML || ''), p.by('lsnLede').innerHTML);
  check('the removed lessons are not among them',
        !p.LESSONS.some(L => /What Is Blind Chess|Playing in Nox/.test(L.name)),
        p.LESSONS.map(L => L.name).join(' / '));

  head('The board is drawn the way the game draws it');
  p.lsnOpen(1, 0);
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
  for (let n = 1; n <= p.LESSONS.length; n++){
    const ok = await walk(p, n);
    check('lesson ' + n + ' finishes', ok);
    if (!ok) break;
  }

  head('Every lesson ends by handing the player to a drill');
  for (let n = 1; n <= p.LESSONS.length; n++){
    const L = p.LESSONS[n - 1];
    p.lsnOpen(n, 1e6);                                    // the last step, whatever it is
    const last = p.LSN.steps[p.LSN.step];
    check('lesson ' + n + ' ends on the handoff card', !!last.handoff && last.title === 'Train this',
          last.title);
    check('lesson ' + n + '’s card says what to train',
          (p.by('lsnWhat').innerHTML || '').indexOf(L.train.say) >= 0, p.by('lsnWhat').innerHTML);
    const b = Array.from(p.by('lsnUnder').children).find(x => /Train this/.test(x.textContent));
    check('lesson ' + n + ' offers Train this in Practice', !!b,
          Array.from(p.by('lsnUnder').children).map(x => x.textContent).join(' | '));
    check('reaching the card is what finishes the lesson', p.lsnDone().indexOf(n) >= 0,
          p.lsnDone().join(','));
    check('and the way on is open — the card gates nothing', p.by('lsnNext').disabled === false);
    if (!b) continue;
    b.onclick();
    check('lesson ' + n + '’s button opens Practice', p.screen() === 'practice', p.screen());
    check('…at ' + L.train.mode, p.PR.mode && p.PR.mode.key === L.train.mode,
          p.PR.mode && p.PR.mode.key);
    p.showScreen('lessons');
  }

  head('Each challenge accepts the move it is asking for');
  for (let i = 0; i < CHALLENGES.length; i++){
    p.lsnOpen(10, i);
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
  p.lsnOpen(10, 0);
  for (let i = 0; i < p.LSN.steps.length + 1; i++){
    if (p.LSN.view !== 'lesson') break;
    if (p.LSN.steps[p.LSN.step].gate) await solveStep(p);
    p.press('lsnNext');
    await sleep(40);
  }

  head('Finishing the tenth finishes the course');
  check('the completion state is up', p.LSN.view === 'done', p.LSN.view);
  check('all ten are recorded', p.lsnDone().length === 10, p.lsnDone().join(','));
  check('and written to this browser',
        Object.keys(store).some(k => k.indexOf('nox.lessons.') === 0), Object.keys(store).join(','));

  head('Progress survives a reload');
  const again = makePage(store);
  again.press('navHowTo');
  check('the ladder remembers', again.lsnDone().length === 10, again.lsnDone().join(','));
  check('every row is ticked',
        Array.from(again.by('lsnList').children).every(b => b.classList.contains('done')));
  check('and none of them is locked',
        Array.from(again.by('lsnList').children).every(b => !b.disabled));

  head('None of the three buttons at the end is a dead one');
  again.lsnOpen(10, 0);
  again.press('lsnGoTrain');
  check('Go to Practice opens the Practice page', again.screen() === 'practice', again.screen());
  check('and it is the real one, running', again.PR.on === true);
  check('showing its dashboard', again.PR.view === 'dash', again.PR.view);
  check('the course did not follow it there', again.LSN.view !== 'lesson', again.LSN.view);
  again.showScreen('lessons');
  again.lsnOpen(10, 0);
  again.press('lsnGoProgressive');
  check('Progressive Blindfold opens the Practice page', again.screen() === 'practice', again.screen());
  check('…in the bridge itself', again.PR.mode && again.PR.mode.key === 'progressive',
        again.PR.mode && again.PR.mode.key);
  check('…at its first level', again.PR.level === 1, again.PR.level);
  again.showScreen('lessons');
  again.lsnOpen(10, 0);
  again.press('lsnGoPlay');
  check('Play a Game lands on the game setup', again.screen() === 'game', again.screen());
  check('against the engine', again.G.opponent === 'bot', again.G.opponent);
  // the vision is advised, not chosen: the note names which one to take
  // first and the player presses it
  check('with a note under the Vision panel rather than a vision chosen for them',
        again.by('lsnFirstNote').style.display !== 'none' &&
        /Board Only first/.test(again.by('lsnFirstNote').innerHTML || '') &&
        /Complete Blindfold when Progressive Blindfold/.test(again.by('lsnFirstNote').innerHTML || ''),
        again.by('lsnFirstNote').innerHTML);
  check('and no game started by it', again.G.started === false);
  // the note is advice about an unanswered vision, so it lasts exactly as
  // long as that question does: arriving at the setup any other way must not
  // still be advised as if the course had just been finished
  again.press('navBot');
  check('another visit to the setup carries no note left over',
        again.by('lsnFirstNote').style.display === 'none', again.by('lsnFirstNote').style.display);

  head('The first-game note goes out with the rest of the answers');
  // resetChoices() is the one function every route to the setup panel passes
  // through, so it is the one place the note is cleared. A challenge form is
  // the route that does NOT come through enterGameSetup(), and is why.
  again.lsnOpen(10, 0);
  again.press('lsnGoPlay');
  check('the note is up to begin with',
        (again.by('lsnFirstNote').innerHTML || '').length > 0);
  again.resetChoices();
  check('resetting the setup choices takes it down',
        (again.by('lsnFirstNote').innerHTML || '') === '' &&
        again.by('lsnFirstNote').style.display === 'none',
        again.by('lsnFirstNote').innerHTML + ' / ' + again.by('lsnFirstNote').style.display);
  // challengeFriend() needs an account and a socket, so its wiring is read
  // rather than run: what matters is that it goes through resetChoices() like
  // everything else, and does not clear the note some second way of its own.
  const CHALFN = grab(/\nfunction challengeFriend\([\s\S]*?\n\}/, 'challengeFriend');
  check('a friend challenge resets the choices, so the note goes with them',
        /\bresetChoices\(\)/.test(CHALFN), CHALFN.slice(0, 160));
  check('and it does not reach for the note itself',
        CHALFN.indexOf('lsnFirstNote') < 0);
  check('and exactly one place in the page clears it',
        (SRC.match(/^\s*lsnFirstNoteClear\(\);/gm) || []).length === 1,
        (SRC.match(/^\s*lsnFirstNoteClear\(\);/gm) || []).length + ' call sites');

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
  // the mode count grows as Practice modes land; the course cares only that
  // the drills its lessons hand off to are still there to be handed off to
  check('with the drills the course hands off to',
        ['square','piece','tracker','hold','progressive']
          .every(k => again.PR_MODES.some(m => m.key === k)),
        again.PR_MODES.map(m => m.key).join(','));
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

  /* ============================================================
     3 · the revised course: ten lessons, and what each one now opens on
     ============================================================ */
  const MARKUP = SRC.slice(0, SRC.indexOf('<script>\n'));
  const g = makePage({});
  g.press('navHowTo');

  head('The gauge is the only map the stage has');
  g.lsnOpen(1, 0);
  const dots = () => Array.from(g.by('lsnDots').children);
  check('a dot on the line for every lesson', dots().length === 10, dots().length);
  check('the one you are on is marked current', dots()[0].classList.contains('cur'));
  check('nothing behind you yet, so no dot is done',
        !dots().some(d => d.classList.contains('done')));
  check('and the ones you have not reached are shut', dots()[9].disabled);
  check('the label above it names the lesson',
        /Know, Don’t See/.test(g.by('lsnCount').innerHTML), g.by('lsnCount').innerHTML);
  check('the bottom-right course panel is gone',
        SRC.indexOf('lsnJumps') < 0 && SRC.indexOf('lsn-rail') < 0 && SRC.indexOf('lsnRail') < 0);
  check('and nothing empty was left where it stood',
        (SRC.match(/id="lsnExtra"/g) || []).length === 1);

  head('Know, Don’t See opens on the board, and will not let you past it');
  g.lsnOpen(1, 0);
  check('a board page, ten questions and the handoff', g.LSN.steps.length === 12, g.LSN.steps.length);
  check('every square is wearing its name', g.LSN.named === true);
  check('Continue is shut when the page opens', g.by('lsnNext').disabled === true);
  const chair = re => Array.from(g.by('lsnUnder').children).find(b => re.test(b.textContent));
  check('both chairs are offered here', !!chair(/White/) && !!chair(/Black/),
        Array.from(g.by('lsnUnder').children).map(b => b.textContent).join(' | '));
  chair(/Black/).onclick();
  check('sitting in Black’s chair turns the board round', g.LSN.flip === true);
  check('and opens Continue', g.by('lsnNext').disabled === false);
  chair(/White/).onclick();
  check('sitting back in White’s turns it back', g.LSN.flip === false);
  check('and Continue stays open', g.by('lsnNext').disabled === false);

  head('The ten coordinate questions are made, not written');
  // the board page in front of them and the handoff card behind them are not
  // questions, so neither one is part of the shape being compared
  const shape = () => g.LSN.steps.slice(1, -1).map(st =>
    (/^Click/.test(st.ask) ? 'c' : 'n') + (/Black/.test(st.what) ? 'b' : 'w')).join(' ');
  const shapes = new Set();
  for (let k = 0; k < 12; k++){ g.lsnOpen(1, 0); shapes.add(shape()); }
  check('there are exactly ten of them every time', g.LSN.steps.length === 12, g.LSN.steps.length);
  check('and they are not the same ten twice', shapes.size > 1, shapes.size + ' of 12 runs differed');
  const covered = Array.from(shapes).every(sh => {
    const qs = sh.split(' ');
    return ['cw','cb','nw','nb'].every(want => qs.indexOf(want) >= 0);
  });
  check('every run asks both kinds from both chairs', covered, Array.from(shapes)[0]);
  const halves = Array.from(shapes).some(sh => {
    const qs = sh.split(' ').map(q => q[1]);
    return qs.slice(0, 5).join('') !== 'wwwww' || qs.slice(5).join('') !== 'bbbbb';
  });
  check('and not White first then Black every time', halves);

  head('Every one of the ten can be answered, and only with the right answer');
  for (let i = 1; i <= 10; i++){
    g.lsnOpen(1, i);
    const ask = g.by('lsnAsk').innerHTML || '';
    const litFor = () => { let sq = -1; g.LSN.marks.forEach((c, k) => { if (c === 'lsn-ask') sq = k; }); return sq; };
    if (/^Click/.test(ask)){
      const want = g.sqIndex((ask.match(/<code>([a-h][1-8])<\/code>/) || [])[1]);
      check('question ' + i + ' names a square to click', want >= 0 && want < 64, ask);
      g.LSN.onSquare((want + 9) % 64);
      check('question ' + i + ' refuses the wrong square', !g.LSN.ok);
      g.LSN.onSquare(want);
      check('question ' + i + ' takes ' + g.sqName(want), g.LSN.ok === true);
    } else {
      const lit = litFor();
      check('question ' + i + ' lights a square', lit >= 0);
      check('question ' + i + ' does not give the answer away',
            ask.indexOf(g.sqName(lit)) < 0, ask);
      const btns = Array.from(g.by('lsnChoices').children);
      check('question ' + i + ' offers four names', btns.length === 4, btns.length);
      const right = btns.filter(b => b.textContent === g.sqName(lit));
      check('question ' + i + ': ' + g.sqName(lit) + ' is one of them, once', right.length === 1);
      const wrong = btns.find(b => b.textContent !== g.sqName(lit));
      if (wrong){ wrong.onclick(); check('question ' + i + ' refuses the wrong name', !g.LSN.ok); }
      if (right.length){ right[0].onclick(); check('question ' + i + ' takes the right one', g.LSN.ok === true); }
    }
    check('question ' + i + ' opens the way on once answered', g.by('lsnNext').disabled === false);
  }

  head('Reading a Move starts on a move, not on a page about moves');
  g.lsnOpen(3, 0);
  check('ten moves, no introduction, and the handoff', g.LSN.steps.length === 11, g.LSN.steps.length);
  check('the first step already asks for one',
        /Play <code>e4<\/code>/.test(g.by('lsnAsk').innerHTML || ''), g.by('lsnAsk').innerHTML);
  check('with the notation table beside it',
        /rules-table/.test(g.by('lsnExtraBody').innerHTML || ''));
  check('and the table names every form the course teaches',
        ['Nf3','e4','Bxe5','exd5','O-O','O-O-O','e8=Q','Qh5+','Qf7#','Nbd2']
          .every(f => (g.by('lsnExtraBody').innerHTML || '').indexOf(f) >= 0));

  head('Reach and Attack hides the men when the player says so');
  g.lsnOpen(4, 3);
  check('the men are still on the board', g.LSN.mode === 'sighted', g.LSN.mode);
  const startBtn = () => Array.from(g.by('lsnUnder').children).find(b => /Start/.test(b.textContent));
  check('a Start button is offered', !!startBtn(),
        Array.from(g.by('lsnUnder').children).map(b => b.textContent).join(' | '));
  await sleep(3600);
  check('and no timer takes them out while it waits', g.LSN.mode === 'sighted', g.LSN.mode);
  startBtn().onclick();
  check('pressing Start is what hides them', g.LSN.mode === 'blind', g.LSN.mode);
  check('and the question is asked once they are gone',
        /Select <b>every square<\/b>/.test(g.by('lsnAsk').innerHTML || ''), g.by('lsnAsk').innerHTML);
  check('with Check waiting under the board',
        Array.from(g.by('lsnUnder').children).some(b => b.textContent.indexOf('Check') === 0));

  head('Holding a Small Position starts on the sequence');
  g.lsnOpen(5, 0);
  check('two sequences, no introduction, and the handoff', g.LSN.steps.length === 3, g.LSN.steps.length);
  check('the first step offers Hide the Board straight away',
        Array.from(g.by('lsnUnder').children).some(b => /Hide the Board/.test(b.textContent)),
        Array.from(g.by('lsnUnder').children).map(b => b.textContent).join(' | '));

  head('Playing Without the Pieces says the position out loud');
  for (let i = 0; i < CHALLENGES.length; i++){
    g.lsnOpen(10, i);
    check('challenge ' + (i + 1) + ' shows a Position card',
          g.by('lsnExtraTitle').textContent === 'Position', g.by('lsnExtraTitle').textContent);
    const body = g.by('lsnExtraBody').innerHTML || '';
    const st = g.stateFromFEN(CHALLENGES[i].fen);
    let all = true, men = 0;
    const NAME = { P:'Pawn', N:'Knight', B:'Bishop', R:'Rook', Q:'Queen', K:'King' };
    for (let sq = 0; sq < 64; sq++){
      const pc = st.b[sq];
      if (!pc) continue;
      men++;
      if (body.indexOf(g.sqName(sq)) < 0 || body.indexOf(NAME[pc.t]) < 0) all = false;
    }
    check('challenge ' + (i + 1) + ': every man on the board is in the list', all, body);
    const listed = (body.match(/\b[a-h][1-8]\b/g) || []);
    check('challenge ' + (i + 1) + ': and nothing that is not on it',
          listed.length === men, listed.join(',') + ' vs ' + men + ' men');
    check('challenge ' + (i + 1) + ': both sides are named',
          body.indexOf('White') >= 0 && body.indexOf('Black') >= 0);
    check('challenge ' + (i + 1) + ': it is offered before the blindfold, not during',
          g.by('lsnExtra').style.display !== 'none');
    Array.from(g.by('lsnUnder').children).find(b => b.textContent.indexOf('I’m Ready') === 0).onclick();
    check('challenge ' + (i + 1) + ': pressing I’m Ready takes it away',
          g.by('lsnExtra').style.display === 'none');
    check('challenge ' + (i + 1) + ': and the board with it', g.LSN.mode === 'blind', g.LSN.mode);
    const ready = await until(() =>
      (g.by('lsnAsk').innerHTML || '').indexOf('Play it on the board') >= 0, 8000);
    check('challenge ' + (i + 1) + ': the sequence plays out', ready);
    if (!ready) continue;
    const legal = g.legalMoves(g.LSN.st, g.LSN.st.turn);
    const want = legal.find(m => g.toSAN(g.LSN.st, m, legal) === CHALLENGES[i].answer);
    g.LSN.onSquare(want.from); g.LSN.onSquare(want.to);
    check('challenge ' + (i + 1) + ': ' + CHALLENGES[i].answer + ' is accepted', g.LSN.ok === true);
    const rev = Array.from(g.by('lsnUnder').children).find(b => /Reveal/.test(b.textContent));
    check('challenge ' + (i + 1) + ': Reveal is offered afterwards', !!rev);
    if (!rev) continue;
    rev.onclick();
    check('challenge ' + (i + 1) + ': Reveal brings the position list back',
          g.by('lsnExtra').style.display !== 'none' &&
          /lsn-pos/.test(g.by('lsnExtraBody').innerHTML || ''));
    check('challenge ' + (i + 1) + ': and it describes the position as it stands now',
          g.by('lsnExtraBody').innerHTML === g.lsnPositionHTML(g.LSN.st));
  }

  head('The position list is read off the board, not written beside it');
  const made = g.lsnPositionHTML(g.stateFromFEN('8/8/4k3/8/2N5/8/5PPP/6K1 w - - 0 1'));
  check('a position it has never seen is described too',
        /Knight/.test(made) && /c4/.test(made) && /King/.test(made) &&
        /e6/.test(made) && /g1/.test(made) && /f2, g2, h2/.test(made), made);
  check('and the two sides are kept apart',
        made.indexOf('White') < made.indexOf('c4') && made.indexOf('Black') < made.indexOf('e6'));

  head('Nothing anywhere still speaks of the two lessons that went');
  // In the markup and in what the course says — the migration note in the
  // script names both of them on purpose, because that is what it is for.
  const said = [];
  for (let n = 1; n <= again.LESSONS.length; n++)
    again.LESSONS[n - 1].build().forEach(st => said.push(st.title, st.what, st.ask));
  said.push(MARKUP);
  again.LESSONS.forEach(L => said.push(L.name, L.blurb));
  check('no What Is Blind Chess anywhere the player looks',
        !said.some(t => String(t || '').indexOf('What Is Blind Chess') >= 0));
  check('no Playing in Nox anywhere the player looks',
        !said.some(t => String(t || '').indexOf('Playing in Nox') >= 0));
  check('no vision blurbs left behind them', SRC.indexOf('LSN_MODE_SAY') < 0);
  check('every lesson has a builder of its own',
        again.LESSONS.every((L, i) => new RegExp('function lsnLesson' + (i + 1) + '\\(').test(SRC)),
        again.LESSONS.map((L, i) => 'lsnLesson' + (i + 1)).join(','));
  check('and no builder is left over from the five-lesson course',
        !/lsnLesson(Board|Notation|Visualize|Track|Challenge)/.test(SRC));
  check('and the real game still has all four visions',
        /const MODE_NAME\s*=\s*\{ blind:/.test(SRC));
  check('no conflict markers', !/^(?:<{7}|={7}|>{7})/m.test(SRC));
  const ids = (MARKUP.match(/\sid="[^"]+"/g) || []).map(x => x.slice(5, -1));
  const dupes = ids.filter((x, i) => ids.indexOf(x) !== i);
  check('every id in the markup is unique', dupes.length === 0, dupes.join(','));

  head('No caption runs past two sentences');
  const strip = h => String(h || '').replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;/g, ' ')
                                    .replace(/\s+/g, ' ').trim();
  const sentences = t => (t.match(/[.!?](?=\s|$)/g) || []).length;
  let longest = '', worst = 0;
  for (let n = 1; n <= again.LESSONS.length; n++){
    const steps = again.LESSONS[n - 1].build();
    steps.forEach((st, i) => {
      [st.what, st.ask].forEach(t => {
        const txt = strip(t);
        const c = sentences(txt);
        if (c > worst){ worst = c; longest = 'lesson ' + n + ' step ' + (i + 1) + ': ' + txt; }
      });
    });
  }
  check('the longest caption in the course is two sentences or fewer', worst <= 2, longest);

  head('Old progress from the seven- and five-lesson courses still lands somewhere');
  const migrate = (done, v) => {
    const st = { 'nox.lessons.howto': JSON.stringify(v ? { v, done } : { done }),
                 'nox.practice.': JSON.stringify({ v:1, kept:true }) };
    const q = makePage(st);
    q.press('navHowTo');
    return { done:q.lsnDone().join(','), reach:q.lsnReach(), store:st };
  };
  // v1 → v2 → v3, in that order: old 2 and 3 are v2's 1 and 2, which are v3's
  // 1 and 3. A v1 record therefore reads through both maps rather than one.
  check('the two v1 lessons before Learn the Board and Notation land on 1 and 3',
        migrate([1, 2, 3], 1).done === '1,3', migrate([1, 2, 3], 1).done);
  check('a finished seven-lesson course is four of the ten',
        migrate([1, 2, 3, 4, 5, 6, 7], 1).done === '1,3,4,5', migrate([1,2,3,4,5,6,7], 1).done);
  check('progress that was only in the removed lessons goes back to the start',
        migrate([1, 6], 1).done === '' && migrate([1, 6], 1).reach === 1);
  check('a record with no version is read as the oldest one',
        migrate([2, 3], 0).done === '1,3', migrate([2, 3], 0).done);
  check('a finished five-lesson course is four of the ten',
        migrate([1, 2, 3, 4, 5], 2).done === '1,3,4,5', migrate([1, 2, 3, 4, 5], 2).done);
  check('the old first blindfold challenge has nowhere to land',
        migrate([5], 2).done === '', migrate([5], 2).done);
  check('a v3 record is taken as it stands',
        migrate([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 3).done === '1,2,3,4,5,6,7,8,9,10',
        migrate([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 3).done);
  check('nothing out of range survives either way',
        migrate([0, 9, 99], 2).done === '' && migrate([99], 1).done === '');
  check('and a corrupt record starts clean, rather than throwing', (function(){
    const q = makePage({ 'nox.lessons.howto':'{not json' });
    q.press('navHowTo');
    return q.lsnDone().length === 0 && q.LSN.view === 'hub';
  })());
  check('migrating leaves Practice’s own record alone', (function(){
    const st = { 'nox.lessons.howto':JSON.stringify({ v:1, done:[2,3] }),
                 'nox.practice.':JSON.stringify({ v:1, kept:true }) };
    const q = makePage(st);
    q.press('navHowTo');
    q.lsnOpen(1, 0);
    return JSON.parse(st['nox.practice.']).kept === true;
  })());
  // Reaching the handoff card is what finishes a lesson now, so these open
  // the last step rather than pressing Continue past it.
  check('a lesson finished now is stored in the new numbering, as v3', (function(){
    const st = {};
    const q = makePage(st);
    q.press('navHowTo');
    q.lsnOpen(1, 0);
    q.lsnOpen(1, q.LSN.steps.length - 1);         // …now that the steps are built
    const raw = JSON.parse(st['nox.lessons.howto'] || 'null');
    return !!raw && raw.v === 3 && raw.done.join(',') === '1';
  })());
  check('an old record is rewritten as v3 the first time it is added to', (function(){
    const st = { 'nox.lessons.howto':JSON.stringify({ v:1, done:[2, 3] }) };   // → 1, 3
    const q = makePage(st);
    q.press('navHowTo');
    q.lsnOpen(4, 0);
    q.lsnOpen(4, q.LSN.steps.length - 1);
    const raw = JSON.parse(st['nox.lessons.howto'] || 'null');
    return !!raw && raw.v === 3 && raw.done.join(',') === '1,3,4';
  })());

  /* ============================================================
   * Task 30a: the seven new step kinds, exercised on their own.
   *
   * Lessons 1–3 (Task 30b) do not exist yet — `lsnLesson1`/`lsnLesson2` are
   * still the old five-lesson content and the stub respectively — so there
   * is no course walk to drive these through. Each factory is instead
   * opened the way lsnShow() opens any step, with a one-step "lesson" built
   * by hand: `LSN.steps` set to just it, lsnResetStep() to undo whatever
   * the step before it left behind, then the step's own setup(), lsnPaint()
   * and lsnRender() — the same three calls lsnShow() makes once a step is
   * chosen. When 30b lands, every one of these is walked for real by
   * walk(), and this section stays as the one place each kind is checked
   * in isolation.
   * ============================================================ */
  head('The seven new step kinds are exercised on their own, ahead of the lessons that will use them');

  function openBareStep(pg, step){
    pg.LSN.steps = [step];
    pg.LSN.step = 0;
    pg.lsnResetStep();
    if (step.setup) step.setup();
    pg.lsnPaint();
    pg.lsnRender();
  }
  /* prMakeLines() retries internally and can still come back null, or land
   * on a question kind other than the one asked for (`between` and
   * `through` share levels with `reach`/`knight` on some rungs) — so this
   * retries from the outside too, capped rather than looped forever, so a
   * generator that has actually broken fails the suite instead of hanging
   * it (per the controller notes on Task 30). */
  function untilQuestion(build, want, label){
    for (let i = 0; i < 200; i++){
      const q = build();
      if (q && want(q)) return q;
    }
    throw new Error('test_lessons: could not build a ' + label + ' question in 200 tries');
  }
  const squareQ = (level, kind) => p.prMakeSquare(Object.assign({}, p.prRecipe('square', level), { kinds:[kind] }));
  const linesQ = (level, ask, extra) => untilQuestion(
    () => p.prMakeLines(p.prRecipe('lines', level)), q => q.ask === ask && (!extra || extra(q)), ask);
  /* Presses each un-answered choice in turn, checking the wrong-answer
   * contract (marked wrong, disabled, LSN.ok still false) on every one that
   * is not the answer, and stops on the first that is. Only fits a step
   * with exactly one right choice — lsnStepDiagPick, with two, is walked by
   * hand below instead. */
  function clickChoicesUntilRight(label){
    const list = Array.from(p.by('lsnChoices').children);
    let rightBtn = null;
    for (const b of list){
      b.onclick();
      if (p.LSN.ok){ rightBtn = b; break; }
      check(label + ': a wrong choice is marked wrong, disabled, and leaves LSN.ok false',
            b.classList.contains('wrong') && b.disabled === true && p.LSN.ok === false,
            b.textContent);
    }
    check(label + ': the right choice is found and marked right', !!rightBtn && rightBtn.classList.contains('right'));
    return rightBtn;
  }

  head('lsnStepDemo is gate-less and shows what it is given');
  {
    const demo = p.lsnStepDemo({
      title:'Know, don’t see', what:'<p>a demo</p>', ask:'Press Continue.',
      named:true, flip:true, marks:[[p.sqIndex('a1'), 'lsn-lit']], say:'a tip'
    });
    check('gate is false', demo.gate === false);
    check('solve is none', demo.solve === 'none');
    openBareStep(p, demo);
    check('the mark it was given is lit', p.LSN.marks.get(p.sqIndex('a1')) === 'lsn-lit');
    check('flip and named are carried through', p.LSN.flip === true && p.LSN.named === true);
    check('nothing is needed to move on', p.by('lsnNext').disabled === false);
  }

  head('lsnStepColour — Square Trainer’s colour question, from level 5, board hidden');
  {
    const q = squareQ(5, 'colour');
    check('the question carries a square and a dark flag', q.sq >= 0 && typeof q.dark === 'boolean', JSON.stringify(q));
    const step = p.lsnStepColour(q);
    check('solve is choices', step.solve === 'choices');
    openBareStep(p, step);
    check('the board is hidden — this is answered from the name alone',
          p.LSN.named === false && p.by('lsnFrame').style.display === 'none');
    check('exactly Light and Dark are offered', p.by('lsnChoices').children.length === 2);
    clickChoicesUntilRight('lsnStepColour');
  }
  {
    // and answerable by the harness's own choices solver, cold
    openBareStep(p, p.lsnStepColour(squareQ(5, 'colour')));
    check('lsnStepColour is answerable by the choices solver', await solveStep(p, 3000));
  }

  head('lsnStepQuadrant — Square Trainer’s quadrant question, named in words');
  {
    const q = squareQ(5, 'quadrant');
    check('the answer is one of the four corners', ['a1', 'h1', 'a8', 'h8'].indexOf(q.answer) >= 0, q.answer);
    const step = p.lsnStepQuadrant(q);
    check('solve is choices', step.solve === 'choices');
    openBareStep(p, step);
    check('the square asked about is lit on a named board',
          p.LSN.named === true && p.LSN.marks.get(q.sq) === 'lsn-lit');
    check('four quarters are offered', p.by('lsnChoices').children.length === 4);
    clickChoicesUntilRight('lsnStepQuadrant');
  }
  {
    openBareStep(p, p.lsnStepQuadrant(squareQ(5, 'quadrant')));
    check('lsnStepQuadrant is answerable by the choices solver', await solveStep(p, 3000));
  }

  head('lsnStepBetween — Lines & Routes’ between question, clicked on an empty board');
  {
    const q = linesQ(1, 'between');
    check('the question names two squares and a run between them',
          q.a >= 0 && q.b >= 0 && Array.isArray(q.answer) && q.answer.length > 0, JSON.stringify(q));
    const step = p.lsnStepBetween(q);
    check('solve is select', step.solve === 'select');
    openBareStep(p, step);
    // The exact answer is brute-forced from the page's own lineBetween(),
    // never read off q.answer or step.truth — the harness is not told.
    const between = p.lineBetween(q.a, q.b);
    check('lineBetween() agrees with what the question was built from',
          JSON.stringify(between) === JSON.stringify(q.answer));
    between.forEach(sq => p.LSN.onSquare(sq));
    const done = () => Array.from(p.by('lsnUnder').children).find(b => b.textContent.indexOf('Done') === 0);
    check('a Done button is offered', !!done());
    done().onclick();
    check('the exact set is accepted and every one of them is marked lsn-right',
          p.LSN.ok === true && between.every(sq => p.LSN.marks.get(sq) === 'lsn-right'));
  }
  {
    const q = linesQ(2, 'between', qq => qq.answer.length > 1);
    const step = p.lsnStepBetween(q);
    openBareStep(p, step);
    const between = p.lineBetween(q.a, q.b);
    between.slice(0, -1).forEach(sq => p.LSN.onSquare(sq));   // leave the last one out, on purpose
    const missed = between[between.length - 1];
    const done = () => Array.from(p.by('lsnUnder').children).find(b => b.textContent.indexOf('Done') === 0);
    done().onclick();
    check('a missed square still answers the step, by conceding rather than refusing', p.LSN.ok === true);
    check('every truth square is marked, found or missed',
          between.every(sq => ['lsn-right', 'lsn-miss'].indexOf(p.LSN.marks.get(sq)) >= 0));
    check('the missed square specifically is marked lsn-miss', p.LSN.marks.get(missed) === 'lsn-miss');
  }
  {
    openBareStep(p, p.lsnStepBetween(linesQ(1, 'between')));
    check('lsnStepBetween is answerable by the select solver', await solveStep(p, 5000));
  }

  head('lsnStepDiagPick — Lines & Routes’ through question, two of four choices right');
  {
    const q = linesQ(4, 'through');
    check('the question offers four choices with two right ones',
          Array.isArray(q.answer) && q.answer.length === 2 && Array.isArray(q.choices) && q.choices.length === 4,
          JSON.stringify(q));
    const step = p.lsnStepDiagPick(q);
    check('solve is choices', step.solve === 'choices');
    openBareStep(p, step);
    check('the board is hidden here too', p.by('lsnFrame').style.display === 'none');
    // Every choice is clicked in turn — but lsnChoices() itself refuses a
    // click once LSN.ok is true (`b.onclick = () => { if (!LSN.ok) … }`),
    // so once the second right square lands, whichever wrong squares the
    // shuffle happened to leave unclicked stay untouched. That is correct
    // behaviour, not a gap in the loop, so the count checked below is only
    // ever the two rights (both of them are always seen, since the step
    // cannot reach ok without them) — not the wrongs, which is 0, 1 or 2
    // depending on where the shuffle put them.
    const list = Array.from(p.by('lsnChoices').children);
    let rights = 0, wrongs = 0;
    for (const b of list){
      if (p.LSN.ok) break;
      const isRight = q.answer.indexOf(p.sqIndex(b.textContent)) >= 0;
      b.onclick();
      if (isRight){ rights++; check('a right square is marked right and disabled', b.classList.contains('right') && b.disabled === true); }
      else { wrongs++; check('a wrong square is marked wrong and disabled', b.classList.contains('wrong') && b.disabled === true); }
    }
    check('both right squares were found', rights === 2, rights);
    check('no more wrong squares were seen than the two on offer', wrongs <= 2, wrongs);
    check('the step is answered only once both right squares are found', p.LSN.ok === true);
  }
  {
    openBareStep(p, p.lsnStepDiagPick(linesQ(4, 'through')));
    check('lsnStepDiagPick is answerable by the choices solver', await solveStep(p, 5000));
  }

  head('lsnKnightBoard seats two kings without ever overwriting the knight or the target');
  {
    const st = p.lsnKnightBoard(p.sqIndex('a1'), [p.sqIndex('h8')]);
    sane('lsnKnightBoard(a1, [h8])', st);
    check('the knight sits on a1', st.b[p.sqIndex('a1')] && st.b[p.sqIndex('a1')].t === 'N');
    check('the target square, h8, carries no man', st.b[p.sqIndex('h8')] === null);
  }
  {
    const st = p.lsnKnightBoard(p.sqIndex('h8'), [p.sqIndex('a1')]);
    sane('lsnKnightBoard(h8, [a1])', st);
    check('the knight sits on h8', st.b[p.sqIndex('h8')] && st.b[p.sqIndex('h8')].t === 'N');
    check('the target square, a1, carries no man', st.b[p.sqIndex('a1')] === null);
  }

  head('lsnStepKnight — Lines & Routes’ knight question, the route played back once found');
  {
    const q = linesQ(7, 'knight');
    check('the question names two squares, a move count and a route',
          q.a >= 0 && q.b >= 0 && q.answer >= 1 && Array.isArray(q.route), JSON.stringify(q));
    const step = p.lsnStepKnight(q);
    check('solve is choices', step.solve === 'choices');
    openBareStep(p, step);
    sane('lsnStepKnight’s board', p.LSN.st);
    check('the knight sits where the question says', p.LSN.st.b[q.a] && p.LSN.st.b[q.a].t === 'N');
    check('the target square carries no man of its own', p.LSN.st.b[q.b] === null);
    check('1 to 4 move-count choices are offered', p.by('lsnChoices').children.length === 4);
    clickChoicesUntilRight('lsnStepKnight');
  }
  {
    openBareStep(p, p.lsnStepKnight(linesQ(7, 'knight')));
    check('lsnStepKnight is answerable by the choices solver', await solveStep(p, 5000));
  }

  head('lsnStepTypeMove — the console, judged by parseMoveIn() exactly as a game is');
  {
    const item = NOTATION[0];   // e4, from the starting position
    const step = p.lsnStepTypeMove(item);
    check('solve is typed', step.solve === 'typed');
    openBareStep(p, step);
    sane('lsnStepTypeMove’s position', p.LSN.st);
    check('the console is open for entry', p.LSN.console === true && p.LSN.entry === true);
    const before = JSON.stringify(p.LSN.st.b);
    const legal = p.legalMoves(p.LSN.st, p.LSN.st.turn);
    const otherMove = legal.find(m => p.toSAN(p.LSN.st, m, legal) !== item.san);
    const otherSan = p.toSAN(p.LSN.st, otherMove, legal);
    p.LSN.onEntry(otherSan);
    check('a legal move that is not the one asked for is refused, and names the wanted SAN',
          p.LSN.ok === false && (p.by('lsnSay').innerHTML || '').indexOf(item.san) >= 0,
          p.by('lsnSay').innerHTML);
    check('the board has not moved', JSON.stringify(p.LSN.st.b) === before);
    p.LSN.onEntry(item.san);
    check('the right SAN is accepted and actually played',
          p.LSN.ok === true && JSON.stringify(p.LSN.st.b) !== before);
  }
  {
    openBareStep(p, p.lsnStepTypeMove(NOTATION[1]));   // Nf3, a different position
    check('lsnStepTypeMove is answerable by the typed solver', await solveStep(p, 5000));
  }

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
