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
// Lesson 10 no longer carries three challenge lines — it carries one shared
// position for its three vision demos (LSN_TEN_FEN) and a mini game built
// fresh every time from Practice's own prMakeProgressive(). The FEN is the
// only fixed position left to check here; the mini game's own position is
// generated, not stored, and is checked where it is built instead (below,
// against the whole page).
const TEN_FEN = new Function(
  grab(/\nconst LSN_TEN_FEN = '[^\n]*';/, 'LSN_TEN_FEN') + "\nreturn LSN_TEN_FEN;")();

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

head('Lesson 10’s shared demo position is a real, sane one');
{
  const st = C.stateFromFEN(TEN_FEN);
  check("LSN_TEN_FEN survives a round trip", C.fenOf(st) === TEN_FEN, C.fenOf(st));
  sane('LSN_TEN_FEN', st);
  check('LSN_TEN_FEN is reduced material, not a whole game',
        st.b.filter(Boolean).length <= 12, st.b.filter(Boolean).length + ' men');
}

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
    // builds a step itself — rather than reading it off a lesson body — needs
    // to feed them the same kind of question Practice would
    // (prMakeSquare/prMakeLines/prRecipe), to open a step the way lsnShow
    // does without a lesson around it (lsnResetStep/lsnPaint/lsnRender), and
    // to check an answer the way the page itself would (lineBetween() for a
    // select-many, quadrantOf()/knightRoute()/linesThrough() for the demo
    // boards in Task 30b's lsnLesson1/lsnLesson2 that light a square's
    // quarter, a knight's reach, or a rank/file/diagonal without asking a
    // question about it). kingSq/inCheck are not needed here: page state is
    // plain data, so tools/page_chess.js's C already judges it, exactly as
    // it does the fixed positions above.
    ' lsnStepDemo, lsnStepColour, lsnStepQuadrant, lsnStepBetween, lsnStepDiagPick,' +
    ' lsnStepKnight, lsnStepTypeMove, lsnKnightBoard, lsnResetStep, lsnPaint, lsnRender,' +
    ' prMakeSquare, prMakeLines, prRecipe, lineBetween, quadrantOf, knightRoute, linesThrough,' +
    // Task 31: the five step kinds lessons 4 and 5 add, and the two more
    // Practice generators they are built from (prMakeAttack, prMakeHold) —
    // same reasoning as Task 30a's list above, plus rebuildDiff() and
    // PR_PALETTE, which the rebuild solver needs to judge and to find a
    // palette button by the man it places rather than by reading the step's
    // own `truth`.
    ' lsnStepAttackYesNo, lsnStepHanging, lsnStepCluster, lsnStepRebuild,' +
    ' prMakeAttack, prMakeHold, rebuildDiff, PR_PALETTE,' +
    // Task 32: the four step kinds lessons 6 and 7 add, and the three more
    // Practice generators they are built from (prMakeAfter, prMakeTracker,
    // prMakeForcing) — same reasoning as Task 30a's and Task 31's lists
    // above. prAttacked/prHanging/prMan are what the harness's own solvers
    // for `attacks` and `loose` (see solveStep below) ask the page itself
    // for the true answer, rather than reading it off the step; prRecipe is
    // already exposed, wantQ is not needed outside the page since the
    // harness builds its own capped retries the same way test_practice.js's
    // suite already does.
    ' lsnStepChange, lsnStepAfter, lsnStepCaptureSeq, lsnStepExchange,' +
    ' prMakeAfter, prMakeTracker, prMakeForcing, prAttacked, prHanging, prMan,' +
    ' prForcingMaterialLabel, prForcingLineHTML,' +
    // Task 33: the four step kinds lessons 8 and 9 add, and the two more
    // Practice generators they are built from (prMakeCalc, prMakeBranches) —
    // same reasoning as every banner above. kingSq is what the harness's own
    // 'multi' solver (see solveStep below) asks independently for the true
    // king square, rather than reading it off the step; newState/makeMove
    // are what the 'recover' solver replays lsnStepRecover's own move list
    // through, exactly as a learner rebuilding from the score would.
    ' lsnStepCheckThree, lsnStepRecover, lsnStepMate1, lsnStepLineThenRoot, lsnRebuildUI,' +
    ' prMakeCalc, prMakeBranches, kingSq, newState, makeMove,' +
    // Task 34: lesson 10's own mini game. lsnStepMiniGame() builds its own
    // position from prMakeProgressive() every time it is called and there is
    // no way to hand it one — legalMoves/kingSq above are what the harness
    // already asks the page for the true answer with, and lsnPieceEls is
    // what the 'mine' render check below reads to tell a man's own colour
    // and whether it is currently drawn hidden. prMakeProgressive, prRecipe
    // (already exposed) and bestMove are what the review's fix for the
    // isolated mini-game test deals a position with independently — a fast,
    // pure pre-check of the same drive the real step plays (learner plays
    // legal[0], the page replies with bestMove(st, 2)), used to keep only a
    // deal that is expected to reach the checkpoint, or to hunt one that
    // is expected to end before it — before ever spending a real step's own
    // real timers confirming which one it actually is.
    ' lsnStepMiniGame, lsnPieceEls, prMakeProgressive, bestMove,' +
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
    //
    // Task 32 added shapes this loop has to survive rather than give up on:
    // lsnStepCaptureSeq opens on an under button ("Hide the Board") before any
    // choices exist at all, its own choices then do not appear until its walk
    // has finished playing several seconds later, and lsnStepExchange's right
    // pick does not turn LSN.ok true until the whole exchange has replayed on
    // the board afterwards — so "nothing pressable right now" is answered by
    // trying the way in (`pressUnder()`, the same button the generic loop
    // below presses) and then by waiting and looking again, never by
    // breaking; only the caller's own budget (`stop`) ends the loop when a
    // step is genuinely unsolvable.
    while (!p.LSN.ok && Date.now() < stop){
      let pressed = false;
      for (const b of choices()){
        if (b.disabled || b.classList.contains('right') || b.classList.contains('wrong')) continue;
        b.onclick(); pressed = true; break;
      }
      if (!pressed) pressed = pressUnder();
      await sleep(pressed ? 60 : 150);
    }
    return p.LSN.ok;
  }
  if (kind === 'changed'){
    // lsnStepChange and lsnStepAfter's `vacated` question both ask for one
    // square, clicked on a board that is not empty — the fallback loop's own
    // "empty board, click everything" branch below only fires when the board
    // truly has nothing on it, which is wrong here (the square being asked
    // about is the one empty square on an otherwise full board), and 'square'
    // is already spoken for (lsnDrillClick's own click-a-named-square drill,
    // Task 30) — so this is its own tag as well as its own strategy: this is
    // its own brute force: every square, in turn, through LSN.onSquare,
    // until the step is ok. Both factories install `onSquare` after a timed
    // reveal rather than in setup(), so this waits for it to exist before
    // it starts clicking, the same patience the 'choices' branch above needs
    // for the same reason.
    while (!p.LSN.ok && Date.now() < stop){
      if (!p.LSN.onSquare){ await sleep(60); continue; }
      for (let i = 0; i < 64 && !p.LSN.ok && Date.now() < stop; i++){
        p.LSN.onSquare(i);
        await sleep(3);
      }
    }
    return p.LSN.ok;
  }
  if (kind === 'attacks'){
    // lsnStepAfter's `attacks` question: every square the man that just
    // moved now reaches from its new square, picked and then Done. The true
    // set is never read off the step — it is asked of the page's own
    // prAttacked(), on the position and square the page itself is showing
    // (`p.LSN.st`, already the after-move position by the time `onSquare` is
    // installed, and `p.LSN.last.to`, the square the page's own last-move
    // record says the man landed on) — exactly the fact `prMoveFacts()`
    // itself would compute, asked independently rather than trusted.
    while (!p.LSN.onSquare && Date.now() < stop) await sleep(60);
    if (!p.LSN.onSquare || !p.LSN.last) return false;
    const want = p.prAttacked(p.LSN.st, p.LSN.last.to);
    while (!p.LSN.ok && Date.now() < stop){
      p.LSN.pick = new Set();
      want.forEach(sq => p.LSN.onSquare(sq));
      await sleep(20);
      for (const b of under()) if (!b.disabled && b.textContent.indexOf('Done') === 0){ b.onclick(); break; }
      await sleep(60);
    }
    return p.LSN.ok;
  }
  if (kind === 'loose'){
    // lsnStepAfter's `hanging` question, asked the same way Attack Vision's
    // own hanging question already is (see the 'hanging' branch below) but
    // with a Done-and-Nothing pair rather than a click that judges itself —
    // the true set is prHanging() of the page's own current position, never
    // the step's own facts.
    while (!p.LSN.onSquare && Date.now() < stop) await sleep(60);
    if (!p.LSN.onSquare) return false;
    const want = p.prHanging(p.LSN.st);
    while (!p.LSN.ok && Date.now() < stop){
      p.LSN.pick = new Set();
      want.forEach(sq => p.LSN.onSquare(sq));
      await sleep(20);
      const label = want.length ? 'Done' : 'Nothing';
      for (const b of under()) if (!b.disabled && b.textContent.indexOf(label) === 0){ b.onclick(); break; }
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
  if (kind === 'hanging'){
    // lsnStepHanging judges one click at a time and never ends the step on a
    // wrong one, so every square is tried in turn until the one or two right
    // ones have both landed — the same brute force a blindfold player has no
    // shortcut around either.
    for (let i = 0; i < 64 && !p.LSN.ok && Date.now() < stop; i++){
      if (p.LSN.onSquare) p.LSN.onSquare(i);
      await sleep(3);
    }
    return p.LSN.ok;
  }
  if (kind === 'cluster'){
    // I'm Ready first — the study card and the board go together, and
    // pressUnder() is what a player presses too. What is left afterwards is
    // either a square to click (a 'where' question) or a row of choices
    // ('what', 'count', 'occupied'), never both, so which branch runs is
    // read off the step itself rather than off q.ask.t, which this harness
    // is not told.
    while (!p.LSN.onSquare && !choices().length && Date.now() < stop){
      if (!pressUnder()) break;
      await sleep(20);
    }
    if (p.LSN.onSquare){
      for (let i = 0; i < 64 && !p.LSN.ok && Date.now() < stop; i++){ p.LSN.onSquare(i); await sleep(3); }
    } else {
      while (!p.LSN.ok && Date.now() < stop){
        let pressed = false;
        for (const b of choices()){
          if (b.disabled || b.classList.contains('right') || b.classList.contains('wrong')) continue;
          b.onclick(); pressed = true; break;
        }
        if (!pressed) break;
        await sleep(30);
      }
    }
    return p.LSN.ok;
  }
  if (kind === 'rebuild'){
    // The Position card the step showed before I'm Ready is on the page —
    // the same information a player has — and is read here, never the
    // step's own `truth`: CLAUDE.md's rule is that this harness answers by
    // brute force, and reading the card is exactly what a player does too.
    const men = readPositionCard(p.by('lsnExtraBody').innerHTML || '', p.sqIndex);
    if (!pressUnder()) return false;                     // "I'm Ready"
    await sleep(30);
    const byType = {};
    men.forEach(m => { const k = m.c + m.t; (byType[k] = byType[k] || []).push(m.sq); });
    for (const k in byType){
      const c = k[0], t = k.slice(1);
      const btn = Array.from(choices()).find(b => b.dataset.c === c && b.dataset.t === t);
      if (!btn || !p.LSN.onSquare) return false;
      btn.onclick();
      byType[k].forEach(sq => p.LSN.onSquare(sq));
    }
    await sleep(20);
    const done = Array.from(under()).find(b => !b.disabled && b.textContent.indexOf('Done') === 0);
    if (!done) return false;
    done.onclick();
    await sleep(30);
    return p.LSN.ok;
  }
  if (kind === 'multi'){
    // lsnStepCheckThree and lsnStepLineThenRoot are each one step with
    // several questions inside it, and lsnStepMiniGame (Task 34) is a third:
    // all three swap `LSN.onSquare` between two different jobs as they go —
    // a single click judged on its own (a king or count question, and
    // lsnStepMiniGame's own checkpoint) and a select-then-target pair naming
    // a move (lsnStepMiniGame's own moves) — never both at once, and nothing
    // out here says which is currently live. Both are tried every pass a
    // full board is showing: every legal (from, to) pair off the page's own
    // legalMoves() first, exactly as the generic move solver further below
    // already tries them, which is what a select-then-target step needs and
    // costs a single-click judge nothing (an extra click before or after the
    // real one only cancels a selection nothing was using) — and then every
    // square on its own, which is what a single-click judge needs and a
    // move that already landed is unbothered by, since lsnStepMiniGame takes
    // its own `onSquare` away while it is not the learner's turn to click
    // anything. An initial under button ("Hide the Board", "I'm Ready") is
    // pressed on the way in, the same patience the 'choices' branch above
    // already has for one.
    while (!p.LSN.ok && Date.now() < stop){
      if (p.LSN.onSquare){
        const before = p.LSN.st;
        if (before && before.b.some(Boolean)){
          for (const m of p.legalMoves(before, before.turn)){
            if (p.LSN.ok || !p.LSN.onSquare || p.LSN.st !== before) break;
            p.LSN.onSquare(m.from);
            if (p.LSN.ok || !p.LSN.onSquare || p.LSN.st !== before) break;
            p.LSN.onSquare(m.to);
          }
        }
        // the `&& p.LSN.onSquare` guard matters here: a right click can
        // swap the question — and null this out — mid-loop, and the next
        // iteration must not then call null(i).
        for (let i = 0; i < 64 && !p.LSN.ok && Date.now() < stop && p.LSN.onSquare; i++){
          p.LSN.onSquare(i);
          await sleep(3);
        }
        continue;
      }
      let pressed = false;
      for (const b of choices()){
        if (b.disabled || b.classList.contains('right') || b.classList.contains('wrong')) continue;
        b.onclick(); pressed = true; break;
      }
      if (!pressed) pressed = pressUnder();
      await sleep(pressed ? 60 : 150);
    }
    return p.LSN.ok;
  }
  if (kind === 'recover'){
    // lsnStepRecover carries no Position card at all — only the move list
    // it played, which stays up rather than going down with the board — so
    // there is nothing here for readPositionCard() to read. The honest
    // brute force is the one a learner is actually told to do: replay the
    // SANs the card shows through the page's own newState()/parseMoveIn()/
    // makeMove() to arrive at the position, then place it exactly as the
    // 'rebuild' branch above does. readMovesCard() reads the same markup
    // lsnMovesHTML() renders LSN.sans into, never LSN.sans itself.
    if (!pressUnder()) return false;                     // "Hide the Board"
    const ready = await until(() => p.by('lsnChoices').children.length > 0, stop - Date.now());
    if (!ready) return false;
    const sans = readMovesCard(p.by('lsnExtraBody').innerHTML || '');
    if (!sans.length) return false;
    let st = p.newState();
    for (const san of sans){
      const res = p.parseMoveIn(st, san);
      if (!res.move) return false;
      st = p.makeMove(st, res.move);
    }
    for (let i = 0; i < 64; i++){
      const man = st.b[i];
      if (!man) continue;
      const btn = Array.from(choices()).find(b => b.dataset.c === man.c && b.dataset.t === man.t);
      if (!btn || !p.LSN.onSquare) return false;
      btn.onclick();
      p.LSN.onSquare(i);
    }
    await sleep(20);
    const done = Array.from(under()).find(b => !b.disabled && b.textContent.indexOf('Done') === 0);
    if (!done) return false;
    done.onclick();
    await sleep(30);
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
/** The Position card, read the way a player reads it — lsnPositionHTML()'s
 * own markup, walked back into a man-per-square list rather than assumed:
 * "King" and "Pawns" rows carry no letter (the row's own name already says
 * the type), "Beside the King" and "The Rest" always do, which is what a
 * card built from a random Hold the Position draw is trusted to keep true
 * of every man in those two rows, mixed types or not — see the note over
 * lsnPositionHTML() itself. */
function readPositionCard(html, sqIndex){
  const men = [];
  const blocks = html.split('<div class="lsn-subcap">').slice(1);
  for (const block of blocks){
    const c = block.slice(0, block.indexOf('<')) === 'White' ? 'w' : 'b';
    const rows = block.match(/<span class="man">([^<]*)<\/span><span class="sqs">([^<]*)<\/span>/g) || [];
    for (const raw of rows){
      const m = raw.match(/<span class="man">([^<]*)<\/span><span class="sqs">([^<]*)<\/span>/);
      const label = m[1], entries = m[2].split(',').map(s => s.trim()).filter(Boolean);
      entries.forEach(entry => {
        if (label === 'King') men.push({ sq:sqIndex(entry), c, t:'K' });
        else if (label === 'Pawns') men.push({ sq:sqIndex(entry), c, t:'P' });
        else men.push({ sq:sqIndex(entry.slice(1)), c, t:entry[0] });
      });
    }
  }
  return men;
}
/** The Moves card, read the way lsnMovesHTML() actually renders it: every
 * `<div class="m…">SAN</div>` in order, with the empty half of an unfinished
 * pair (`<div></div>`) simply carrying no text and dropped rather than
 * matched. Used by the 'recover' solver in place of readPositionCard() —
 * lsnStepRecover shows the score, never the position. */
function readMovesCard(html){
  return (html.match(/<div class="m[^"]*">([^<]*)<\/div>/g) || [])
    .map(s => s.replace(/<[^>]+>/g, ''))
    .filter(Boolean);
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

  head('Lesson 10’s own six steps: the three visions shown, how a game goes, one small game, then the handoff');
  {
    const kinds = ['blind', 'fog', 'total'];
    const titles = ['See the Board', 'Fog of War', 'Complete Blindfold'];
    for (let i = 0; i < 3; i++){
      p.lsnOpen(10, i);
      check('lesson 10 step ' + (i + 1) + ' is the ' + titles[i] + ' demo',
            p.by('lsnTitle').textContent === titles[i], p.by('lsnTitle').textContent);
      check('lesson 10 step ' + (i + 1) + ' shows it in ' + kinds[i] + ' vision',
            p.LSN.mode === kinds[i], p.LSN.mode);
      check('lesson 10 step ' + (i + 1) + ' asks nothing — Continue is already open',
            p.LSN.steps[i].gate === false && p.by('lsnNext').disabled === false);
      // See the Board and Fog of War both keep the board frame up — only
      // Complete Blindfold, the one demo that is actually of the console,
      // takes it away and shows the console in its place (the fix for the
      // review's first finding: lsnStepDemo() left LSN.console false, so
      // this demo showed neither board nor console).
      if (kinds[i] === 'total'){
        check('the Complete Blindfold demo hides the board frame',
              p.by('lsnFrame').style.display === 'none', p.by('lsnFrame').style.display);
        check('and shows the console in its place',
              p.by('lsnConsole').classList.contains('show'));
      } else {
        check('the ' + titles[i] + ' demo keeps the board frame up',
              p.by('lsnFrame').style.display !== 'none', p.by('lsnFrame').style.display);
      }
    }
    p.lsnOpen(10, 3);
    check('lesson 10 step 4 is how a first game goes',
          p.by('lsnTitle').textContent === 'How a first game goes', p.by('lsnTitle').textContent);
    check('and it is gate-less too, same as the three demos before it', p.LSN.steps[3].gate === false);
    p.lsnOpen(10, 4);
    check('lesson 10 step 5 is the mini game', p.by('lsnTitle').textContent === 'One small game',
          p.by('lsnTitle').textContent);
    check('the mini game gates the way on', p.LSN.steps[4].gate === true);
    check('the mini game is answered by the multi solver', p.LSN.steps[4].solve === 'multi');
    p.lsnOpen(10, 5);
    check('lesson 10 step 6 is the handoff', !!p.LSN.steps[5].handoff, p.by('lsnTitle').textContent);
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

  head('Know, Don’t See opens on Koltanowski’s line, not on a chair to sit at');
  g.lsnOpen(1, 0);
  // Two demos (the line itself, then the same square from Black’s chair),
  // four coordinate questions, the colour rule stated and asked twice, the
  // four quarters named and asked once, and the handoff.
  check('twelve steps: two demos, four coordinate questions, the colour rule ' +
        'and two colour questions, the four quarters and one quadrant question, and the handoff',
        g.LSN.steps.length === 12, g.LSN.steps.length);
  check('it opens already lit — a demo gates nothing, Continue is open from the start',
        g.by('lsnNext').disabled === false);
  check('a1 is lit, not asked for', g.LSN.marks.get(g.sqIndex('a1')) === 'lsn-lit');
  check('and Koltanowski is quoted, not paraphrased away',
        /Koltanowski/.test(g.by('lsnWhat').innerHTML || ''), g.by('lsnWhat').innerHTML);
  g.lsnOpen(1, 1);
  check('the second step turns the board round, to show the same square from the other chair',
        g.LSN.flip === true);
  check('a1 is still lit there', g.LSN.marks.get(g.sqIndex('a1')) === 'lsn-lit');
  check('and it still gates nothing', g.by('lsnNext').disabled === false);

  head('The four coordinate questions are made, not written, and both chairs and both kinds still turn up');
  // Steps 0–1 are the two demos above and step 11 is the handoff, so the
  // four coordinate questions are exactly steps 2–5 — lsnCoordSet(4) draws
  // nothing but its four guaranteed combinations when asked for exactly
  // four, so the "both kinds, both chairs" guarantee is proven on every run
  // rather than merely likely, the same intent the old ten-question version
  // of this lesson checked over a wider field.
  const coordShape = () => g.LSN.steps.slice(2, 6).map(st =>
    (/^Click/.test(st.ask) ? 'c' : 'n') + (/Black/.test(st.what) ? 'b' : 'w')).join(' ');
  const coordShapes = new Set();
  for (let k = 0; k < 12; k++){ g.lsnOpen(1, 0); coordShapes.add(coordShape()); }
  check('twelve steps every time', g.LSN.steps.length === 12, g.LSN.steps.length);
  check('and the four are not drawn in the same order every time',
        coordShapes.size > 1, coordShapes.size + ' of 12 runs differed');
  const coordCovered = Array.from(coordShapes).every(sh => {
    const qs = sh.split(' ');
    return ['cw', 'cb', 'nw', 'nb'].every(want => qs.indexOf(want) >= 0);
  });
  check('every run asks both kinds from both chairs', coordCovered, Array.from(coordShapes).join(' | '));
  const coordNotFixed = Array.from(coordShapes).some(sh => sh.split(' ')[0][1] === 'b');
  check('and White is not fixed to come first every time', coordNotFixed, Array.from(coordShapes).join(' | '));

  head('Every one of the four coordinate questions can be answered, and only with the right answer');
  for (let idx = 2; idx <= 5; idx++){
    g.lsnOpen(1, idx);
    const n = idx - 1;
    const ask = g.by('lsnAsk').innerHTML || '';
    const litFor = () => { let sq = -1; g.LSN.marks.forEach((c, k) => { if (c === 'lsn-ask') sq = k; }); return sq; };
    if (/^Click/.test(ask)){
      const want = g.sqIndex((ask.match(/<code>([a-h][1-8])<\/code>/) || [])[1]);
      check('question ' + n + ' names a square to click', want >= 0 && want < 64, ask);
      g.LSN.onSquare((want + 9) % 64);
      check('question ' + n + ' refuses the wrong square', !g.LSN.ok);
      g.LSN.onSquare(want);
      check('question ' + n + ' takes ' + g.sqName(want), g.LSN.ok === true);
    } else {
      const lit = litFor();
      check('question ' + n + ' lights a square', lit >= 0);
      check('question ' + n + ' does not give the answer away',
            ask.indexOf(g.sqName(lit)) < 0, ask);
      const btns = Array.from(g.by('lsnChoices').children);
      check('question ' + n + ' offers four names', btns.length === 4, btns.length);
      const right = btns.filter(b => b.textContent === g.sqName(lit));
      check('question ' + n + ': ' + g.sqName(lit) + ' is one of them, once', right.length === 1);
      const wrong = btns.find(b => b.textContent !== g.sqName(lit));
      if (wrong){ wrong.onclick(); check('question ' + n + ' refuses the wrong name', !g.LSN.ok); }
      if (right.length){ right[0].onclick(); check('question ' + n + ' takes the right one', g.LSN.ok === true); }
    }
    check('question ' + n + ' opens the way on once answered', g.by('lsnNext').disabled === false);
  }

  head('The colour rule is stated once, then asked twice, board hidden');
  g.lsnOpen(1, 6);
  check('the demo lights e4', g.LSN.marks.get(g.sqIndex('e4')) === 'lsn-lit');
  check('and states the rule by parity, not just the answer',
        /file|rank/.test(g.by('lsnWhat').innerHTML || ''), g.by('lsnWhat').innerHTML);
  const colourSteps = g.LSN.steps.filter(st => st.title === 'Light or dark?');
  check('exactly two colour questions follow the coordinate questions and the rule',
        colourSteps.length === 2, colourSteps.length);
  check('both are the choices kind', colourSteps.every(st => st.solve === 'choices'));
  g.lsnOpen(1, 7);
  check('a colour question hides the board — this is answered from the name alone',
        g.LSN.named === false && g.by('lsnFrame').style.display === 'none');
  check('offering exactly Light and Dark', g.by('lsnChoices').children.length === 2,
        Array.from(g.by('lsnChoices').children).map(b => b.textContent).join(','));

  head('The four quarters are named, then asked once');
  g.lsnOpen(1, 9);
  check('the demo lights every square of White’s kingside and no other quarter',
        Array.from({ length:64 }, (_, i) => i).every(i =>
          (g.quadrantOf(i) === 'h1') === (g.LSN.marks.get(i) === 'lsn-lit')));
  check('and names it in words, not by compass point',
        /kingside/.test(g.by('lsnAsk').innerHTML || ''), g.by('lsnAsk').innerHTML);
  const quadrantSteps = g.LSN.steps.filter(st => st.title === 'Which quarter?');
  check('exactly one quadrant question follows', quadrantSteps.length === 1, quadrantSteps.length);
  g.lsnOpen(1, 10);
  check('the quadrant question offers all four corners', g.by('lsnChoices').children.length === 4,
        Array.from(g.by('lsnChoices').children).map(b => b.textContent).join(','));
  check('lesson 1 ends on the handoff', !!g.LSN.steps[11].handoff);

  head('Lines and the Knight opens on e4’s own geometry, then asks about it');
  g.lsnOpen(2, 0);
  // Two demos (rank/file, then both diagonals), two between questions, one
  // through question, a knight demo, then two knight questions, and the
  // handoff.
  check('nine steps: two demos, two between questions, one diagonal pick, a ' +
        'knight demo, two knight questions, and the handoff',
        g.LSN.steps.length === 9, g.LSN.steps.length);
  {
    // linesThrough() is the page's own geometry — the same function the
    // between/through/knight questions below are built from — so this checks
    // the demo against the rule the questions are about to test, not a
    // second reading of what a rank and file are.
    const e4 = g.sqIndex('e4'), T = g.linesThrough(e4);
    const want = new Set(T.rank.concat(T.file));
    const lit = new Set();
    g.LSN.marks.forEach((c, k) => { if (c === 'lsn-lit') lit.add(k); });
    check('the first demo lights exactly e4’s rank and file, e4 itself marked selected',
          lit.size === want.size && Array.from(want).every(sq => lit.has(sq)) && g.LSN.marks.get(e4) === 'sel',
          lit.size + ' lit vs ' + want.size + ' wanted');
  }
  g.lsnOpen(2, 1);
  {
    const e4 = g.sqIndex('e4'), T = g.linesThrough(e4);
    const want = new Set(T.diag1.concat(T.diag2));
    const lit = new Set();
    g.LSN.marks.forEach((c, k) => { if (c === 'lsn-lit') lit.add(k); });
    check('the second demo lights exactly both diagonals through e4',
          lit.size === want.size && Array.from(want).every(sq => lit.has(sq)),
          lit.size + ' lit vs ' + want.size + ' wanted');
  }

  head('Two between questions, one diagonal pick, and two knight questions with a two-move-or-fewer route');
  g.lsnOpen(2, 2);
  check('a between question, selected on an empty board', g.LSN.steps[2].solve === 'select');
  g.lsnOpen(2, 3);
  check('and a second one', g.LSN.steps[3].solve === 'select');
  const betweenSteps = g.LSN.steps.filter(st => st.solve === 'select');
  check('exactly two between questions', betweenSteps.length === 2, betweenSteps.length);
  g.lsnOpen(2, 4);
  check('one diagonal-pick question, board hidden',
        g.LSN.steps[4].title === 'On a diagonal?' && g.by('lsnFrame').style.display === 'none');
  const diagSteps = g.LSN.steps.filter(st => st.title === 'On a diagonal?');
  check('and only one', diagSteps.length === 1, diagSteps.length);
  g.lsnOpen(2, 5);
  {
    const e4 = g.sqIndex('e4');
    check('the knight sits on e4', g.LSN.st.b[e4] && g.LSN.st.b[e4].t === 'N');
    sane('lsnLesson2’s knight demo', g.LSN.st);
    // Every square one knight move away is lit, and only those — checked
    // against the page’s own knightRoute(), the same function the two knight
    // questions below are answered against, rather than a hand-rolled L-shape
    // test of our own.
    const lit = new Set();
    g.LSN.marks.forEach((c, k) => { if (c === 'lsn-lit') lit.add(k); });
    const want = new Set(Array.from({ length:64 }, (_, i) => i)
      .filter(i => i !== e4 && g.knightRoute(e4, i).length - 1 === 1));
    check('the demo lights every square a knight on e4 reaches, and no other',
          lit.size === want.size && Array.from(want).every(sq => lit.has(sq)),
          lit.size + ' lit vs ' + want.size + ' wanted');
  }
  const knightSteps = g.LSN.steps.filter(st => st.title === 'How many knight moves?');
  check('exactly two knight questions', knightSteps.length === 2, knightSteps.length);
  [6, 7].forEach(idx => {
    g.lsnOpen(2, idx);
    const ask = g.by('lsnAsk').innerHTML || '';
    const names = (ask.match(/<code>([a-h][1-8])<\/code>/g) || []).map(c => c.replace(/<\/?code>/g, ''));
    check('knight question names two squares', names.length === 2, ask);
    if (names.length === 2){
      // The lesson’s own knight() helper is trusted to have capped the route
      // at two moves or fewer before this step was ever built — checked here
      // against the page’s own knightRoute(), not a second BFS of our own,
      // exactly as the between solver checks against the page’s lineBetween().
      const route = g.knightRoute(g.sqIndex(names[0]), g.sqIndex(names[1]));
      check('and the route between them really is two moves or fewer',
            Array.isArray(route) && route.length - 1 <= 2, route && (route.length - 1));
    }
  });
  check('lesson 2 ends on the handoff', !!g.LSN.steps[8].handoff);

  head('Reading a Move starts on a move, not on a page about moves');
  g.lsnOpen(3, 0);
  check('ten notations, a capture demo, a castling demo, one typed move, and the handoff',
        g.LSN.steps.length === 14, g.LSN.steps.length);
  check('the first step already asks for one',
        /Play <code>e4<\/code>/.test(g.by('lsnAsk').innerHTML || ''), g.by('lsnAsk').innerHTML);
  check('with the notation table beside it',
        /rules-table/.test(g.by('lsnExtraBody').innerHTML || ''));
  check('and the table names every form the course teaches',
        ['Nf3','e4','Bxe5','exd5','O-O','O-O-O','e8=Q','Qh5+','Qf7#','Nbd2']
          .every(f => (g.by('lsnExtraBody').innerHTML || '').indexOf(f) >= 0));
  check('the first step is shown in full, e2–e4, before the short form',
        /e2.?e4/.test(g.by('lsnWhat').innerHTML || ''), g.by('lsnWhat').innerHTML);
  g.lsnOpen(3, 1);
  check('the second is shown in full too, Ng1–f3',
        /Ng1.?f3/.test(g.by('lsnWhat').innerHTML || ''), g.by('lsnWhat').innerHTML);

  head('A capture demo whose own board really has a capture on it, then castling, then one typed move');
  const capItem = NOTATION.find(i => i.san.indexOf('x') >= 0);
  const castleItem = NOTATION.find(i => i.san === 'O-O');
  g.lsnOpen(3, 10);
  {
    // 30a already asserts LSN_NOTATION carries a capture; this asserts the
    // demo built from it is shown on a position where that capture is
    // actually legal, not merely on a FEN copied from elsewhere.
    const { sans } = sansOf(C.stateFromFEN(capItem.fen));
    check(capItem.san + ' really is legal on the capture demo’s own position', sans.indexOf(capItem.san) >= 0, sans.join(' '));
  }
  check('the demo names the square that empties', (g.by('lsnWhat').innerHTML || '').indexOf(capItem.san.slice(-2)) >= 0,
        g.by('lsnWhat').innerHTML);
  check('a demo gates nothing', g.by('lsnNext').disabled === false);
  g.lsnOpen(3, 11);
  {
    const { sans } = sansOf(C.stateFromFEN(castleItem.fen));
    check('O-O really is legal on the castling demo’s own position', sans.indexOf('O-O') >= 0, sans.join(' '));
  }
  g.lsnOpen(3, 12);
  check('the last exercise opens the console for typing', g.LSN.console === true && g.LSN.entry === true);
  check('and is judged the typed way', g.LSN.steps[12].solve === 'typed');
  g.lsnOpen(3, 13);
  check('lesson 3 ends on the handoff', !!g.LSN.steps[13].handoff);

  head('Reach and Attack: the reach drills, a blocker, then Attack Vision’s own three questions');
  g.lsnOpen(4, 0);
  check('nine steps: two reach drills, a blocker demo, two attacks yes/no, the ' +
        'attack-and-defence demo, one defended yes/no, one hanging click, and the handoff',
        g.LSN.steps.length === 9, g.LSN.steps.length);
  check('the first reach drill keeps the men in plain sight', g.LSN.mode === 'sighted', g.LSN.mode);
  g.lsnOpen(4, 1);
  {
    const startBtn = () => Array.from(g.by('lsnUnder').children).find(b => /Start/.test(b.textContent));
    check('the second reach drill studies first', !!startBtn(),
          Array.from(g.by('lsnUnder').children).map(b => b.textContent).join(' | '));
    check('and does not hide the men on its own', g.LSN.mode === 'sighted', g.LSN.mode);
    startBtn().onclick();
    check('pressing Start is what hides them', g.LSN.mode === 'blind', g.LSN.mode);
  }
  g.lsnOpen(4, 2);
  {
    sane('lsnLesson4’s blocker demo', g.LSN.st);
    check('the blocker demo shows a slider stopped at the first man in its way',
          g.LSN.marks.get(g.sqIndex('c3')) === 'lsn-lit' && g.LSN.marks.get(g.sqIndex('d4')) === 'lsn-wrong');
    check('a demo gates nothing', g.by('lsnNext').disabled === false);
  }
  [3, 4].forEach(idx => {
    g.lsnOpen(4, idx);
    check('step ' + (idx + 1) + ' is an attacks yes/no', g.LSN.steps[idx].title === 'Does it attack that square?');
    check('step ' + (idx + 1) + ' offers exactly Yes and No',
          Array.from(g.by('lsnChoices').children).map(b => b.textContent).join(',') === 'Yes,No');
  });
  check('exactly two attacks questions', g.LSN.steps.filter(s => s.title === 'Does it attack that square?').length === 2);
  g.lsnOpen(4, 5);
  check('the fifth step reads the same line the other way, as a demo — it gates nothing',
        g.LSN.steps[5].title === 'Attack and defence are one line' && g.by('lsnNext').disabled === false);
  g.lsnOpen(4, 6);
  check('one defended yes/no follows', g.LSN.steps[6].title === 'Is it defended?');
  check('and only one', g.LSN.steps.filter(s => s.title === 'Is it defended?').length === 1);
  g.lsnOpen(4, 7);
  check('the last question is the hanging click', g.LSN.steps[7].title === 'What is hanging?');
  check('judged the hanging way', g.LSN.steps[7].solve === 'hanging');
  g.lsnOpen(4, 8);
  check('lesson 4 ends on the handoff', !!g.LSN.steps[8].handoff);

  head('Holding a Small Position opens on the position you already own');
  g.lsnOpen(5, 0);
  check('eight steps: the start-position demo, two tracked sequences, the kings-first ' +
        'demo, two cluster questions, one rebuild, and the handoff',
        g.LSN.steps.length === 8, g.LSN.steps.length);
  check('it really is the game’s own start position',
        C.fenOf(g.LSN.st) === 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', C.fenOf(g.LSN.st));
  g.lsnOpen(5, 1);
  check('the first tracked sequence offers Hide the Board straight away',
        Array.from(g.by('lsnUnder').children).some(b => /Hide the Board/.test(b.textContent)),
        Array.from(g.by('lsnUnder').children).map(b => b.textContent).join(' | '));
  g.lsnOpen(5, 3);
  check('the kings-first demo names Fine’s own order and gates nothing',
        /king/i.test(g.by('lsnWhat').innerHTML || '') && g.by('lsnNext').disabled === false,
        g.by('lsnWhat').innerHTML);
  [4, 5].forEach(idx => {
    g.lsnOpen(5, idx);
    check('cluster question ' + (idx - 3) + ' shows the Position card before anything is asked',
          g.by('lsnExtraTitle').textContent === 'Position' && /King/.test(g.by('lsnExtraBody').innerHTML || ''),
          g.by('lsnExtraBody').innerHTML);
    check('cluster question ' + (idx - 3) + ' offers I’m Ready',
          Array.from(g.by('lsnUnder').children).some(b => b.textContent.indexOf('I’m Ready') === 0));
    check('judged the cluster way', g.LSN.steps[idx].solve === 'cluster');
  });
  g.lsnOpen(5, 6);
  check('the rebuild step also opens on the Position card',
        g.by('lsnExtraTitle').textContent === 'Position' && /King/.test(g.by('lsnExtraBody').innerHTML || ''));
  check('judged the rebuild way', g.LSN.steps[6].solve === 'rebuild');
  g.lsnOpen(5, 7);
  check('lesson 5 ends on the handoff', !!g.LSN.steps[7].handoff);

  head('What a Move Leaves Behind: the change step, a demo, then After the Move’s four questions in order');
  g.lsnOpen(6, 0);
  check('seven steps: the change step, a demo, four after-the-move questions, and the handoff',
        g.LSN.steps.length === 7, g.LSN.steps.length);
  check('step 1 is the change step, judged the changed way',
        g.LSN.steps[0].title === 'What changed?' && g.LSN.steps[0].solve === 'changed',
        g.LSN.steps[0].title + ' / ' + g.LSN.steps[0].solve);
  g.lsnOpen(6, 1);
  check('step 2 is the two-things-change demo, and gates nothing',
        g.LSN.steps[1].title === 'Two things change' && g.LSN.steps[1].solve === 'none' &&
        g.by('lsnNext').disabled === false,
        g.LSN.steps[1].title);
  const afterTitles = g.LSN.steps.slice(2, 6).map(st => st.title);
  check('steps 3–6 are all After the Move questions',
        afterTitles.every(t => t === 'What did that move change?'), afterTitles.join(' | '));
  const afterSolves = g.LSN.steps.slice(2, 6).map(st => st.solve);
  check('and in the brief’s own kind order — vacated, attacks, hanging, check',
        afterSolves.join(',') === 'changed,attacks,loose,choices', afterSolves.join(','));
  g.lsnOpen(6, 6);
  check('lesson 6 ends on the handoff', !!g.LSN.steps[6].handoff);

  head('Captures and Counting: a demo, two capture walks, a demo, then two exchanges');
  g.lsnOpen(7, 0);
  check('seven steps: a demo, two capture-sequence steps, a demo, two exchange steps, and the handoff',
        g.LSN.steps.length === 7, g.LSN.steps.length);
  check('step 1 is the capture-is-a-removal demo, and gates nothing',
        g.LSN.steps[0].title === 'A capture is a removal and a move' && g.LSN.steps[0].solve === 'none' &&
        g.by('lsnNext').disabled === false,
        g.LSN.steps[0].title);
  const captureTitles = g.LSN.steps.slice(1, 3).map(st => st.title);
  const captureSolves = g.LSN.steps.slice(1, 3).map(st => st.solve);
  check('steps 2–3 are both capture-sequence steps',
        captureTitles.every(t => t === 'Track the captures') && captureSolves.every(s => s === 'choices'),
        captureTitles.join(' | '));
  g.lsnOpen(7, 3);
  check('step 4 is the counting-an-exchange demo, and gates nothing',
        g.LSN.steps[3].title === 'Counting an exchange' && g.LSN.steps[3].solve === 'none' &&
        g.by('lsnNext').disabled === false,
        g.LSN.steps[3].title);
  const exchangeTitles = g.LSN.steps.slice(4, 6).map(st => st.title);
  const exchangeSolves = g.LSN.steps.slice(4, 6).map(st => st.solve);
  check('steps 5–6 are both exchange steps',
        exchangeTitles.every(t => t === 'Count the exchange') && exchangeSolves.every(s => s === 'choices'),
        exchangeTitles.join(' | '));
  // lsnStepExchange does not expose the level its question was built at (`q`
  // is closed over, not stored on the step), so the two are told apart the
  // way the brief allows when that is so: by what the level actually built —
  // 2 kings, the man already on the fought-over square, and `att`+`def` more
  // — level 1 (att:2, def:1) seats 6 men in all, level 2 (att:2, def:2)
  // seats 7, so the level really did change between the two calls rather
  // than the same question being asked twice.
  g.lsnOpen(7, 4);
  const exchangeMen4 = g.LSN.st.b.filter(Boolean).length;
  g.lsnOpen(7, 5);
  const exchangeMen5 = g.LSN.st.b.filter(Boolean).length;
  check('the first exchange is built at level 1 (6 men: 2 kings, the occupant, 2 attackers, 1 defender)',
        exchangeMen4 === 6, exchangeMen4);
  check('the second is built at level 2, one defender more (7 men)',
        exchangeMen5 === 7, exchangeMen5);
  g.lsnOpen(7, 6);
  check('lesson 7 ends on the handoff', !!g.LSN.steps[6].handoff);

  head('Playing Without the Pieces shows the same position in all three visions, and one small game with it shown');
  {
    const shared = g.stateFromFEN(TEN_FEN);
    const kinds = ['blind', 'fog', 'total'];
    for (let i = 0; i < 3; i++){
      g.lsnOpen(10, i);
      check('demo ' + (i + 1) + ' shows LSN_TEN_FEN’s own position',
            C.fenOf(g.LSN.st) === C.fenOf(shared), C.fenOf(g.LSN.st));
      check('demo ' + (i + 1) + ' is in ' + kinds[i] + ' vision', g.LSN.mode === kinds[i], g.LSN.mode);
    }
  }
  {
    // The mini game: 'mine' vision, the learner's own men shown and the
    // opponent's hidden, no square darkened — read straight off the DOM the
    // way a player's screen actually looks, never off LSN.st directly, since
    // that would prove nothing about what render() actually painted.
    g.lsnOpen(10, 4);
    check('the mini game opens in mine vision, White’s own eye',
          g.LSN.mode === 'mine' && g.LSN.eye === 'w', g.LSN.mode + ' / ' + g.LSN.eye);
    check('no square carries hidden — mine has no square fog',
          g.lsnSqEls.every(d => !d.classList.contains('hidden')));
    let sawW = 0, sawB = 0;
    for (let i = 0; i < 64; i++){
      const man = g.LSN.st.b[i];
      if (!man) continue;
      const e = g.lsnPieceEls.get(man.id);
      if (!e) continue;
      if (man.c === 'w'){ sawW++; check('a white man is drawn, not hidden', !e.classList.contains('hidden')); }
      else { sawB++; check('a black man is drawn hidden', e.classList.contains('hidden')); }
    }
    check('there really were men of both colours to check', sawW > 0 && sawB > 0, sawW + '/' + sawB);
  }
  {
    // An illegal (from, to) pair is refused without ending the step, and any
    // legal move — not one fixed answer — is accepted: lsnAskMove(null, …)'s
    // own contract, exercised here rather than trusted from the source.
    g.lsnOpen(10, 4);
    const before = g.LSN.st;
    const legal = g.legalMoves(g.LSN.st, g.LSN.st.turn);
    // Not just any square the mover's piece cannot reach — one that also is
    // not another of the mover's own men, or the click would reselect
    // rather than refuse (the ordinary sighted-style rule 'mine' already
    // follows — see lsnAskMove()'s own note), and this would then prove
    // nothing about a refusal.
    let illegalTo = -1;
    for (let i = 0; i < 64 && illegalTo < 0; i++){
      if (i === legal[0].from) continue;
      const occ = g.LSN.st.b[i];
      if (occ && occ.c === g.LSN.st.turn) continue;
      if (!legal.some(m => m.from === legal[0].from && m.to === i)) illegalTo = i;
    }
    g.LSN.onSquare(legal[0].from);
    g.LSN.onSquare(illegalTo);
    check('an illegal pair is refused and does not end the step',
          g.LSN.ok === false && g.LSN.st === before, g.LSN.ok);
    g.LSN.onSquare(legal[0].from);
    g.LSN.onSquare(legal[0].to);
    check('a legal move — any legal move — is accepted', g.LSN.st !== before);
    g.lsnResetStep();          // that move armed a reply timer — take it with the step, not with it firing later
  }

  head('The position list is read off the board, not written beside it, in Fine’s own order');
  {
    // A pawn shield: every pawn beside the king is claimed by "Beside the
    // King" rather than "Pawns" — computed here against the same king-
    // distance rule lsnPositionHTML() uses, not assumed from the FEN's own
    // shape, and the knight far from the king is what is left for "The
    // Rest".
    const st = g.stateFromFEN('8/8/4k3/8/2N5/8/5PPP/6K1 w - - 0 1');
    const made = g.lsnPositionHTML(st);
    const g1 = g.sqIndex('g1'), within1 = (a, b) =>
      Math.max(Math.abs(C.rowOf(a) - C.rowOf(b)), Math.abs(C.colOf(a) - C.colOf(b))) <= 1;
    const besideG1 = ['f2', 'g2', 'h2'].filter(s => within1(g.sqIndex(s), g1));
    check('every pawn actually beside g1 is computed, not assumed', besideG1.length === 3, besideG1.join(','));
    check('King is named before Beside the King',
          made.indexOf('King') >= 0 && made.indexOf('King') < made.indexOf('Beside the King'), made);
    check('the beside-the-king group lists exactly the pawns computed above',
          /Beside the King<\/span><span class="sqs">Pf2, Pg2, Ph2<\/span>/.test(made), made);
    check('the far knight falls to The Rest, lettered since that group can mix types',
          /The Rest<\/span><span class="sqs">Nc4<\/span>/.test(made), made);
    check('and the two sides are kept apart',
          made.indexOf('White') < made.indexOf('c4') && made.indexOf('Black') < made.indexOf('e6'), made);
  }
  {
    // A pawn nowhere near the king: this is what proves the "Pawns" group
    // itself, in order after "Beside the King" and before "The Rest" —
    // FEN2 above never exercises it, because its pawns are all claimed by
    // the beside group first.
    const st = g.stateFromFEN('4k3/8/8/8/8/8/P7/6K1 w - - 0 1');
    const made = g.lsnPositionHTML(st);
    check('a lone pawn far from the king gets its own Pawns row, unlettered',
          /Pawns<\/span><span class="sqs">a2<\/span>/.test(made), made);
    check('in Fine’s order: King, then Pawns, with no Beside the King row here',
          made.indexOf('King') < made.indexOf('Pawns') && made.indexOf('Beside the King') < 0, made);
  }

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
   * `walk()` (above, in "Every lesson can be walked end to end") and the
   * lesson-shape sections above this one already drive every one of these
   * seven factories for real, through `lsnLesson1()`/`lsnLesson2()`/
   * `lsnLesson3()` (Task 30b). This section stays anyway, as the one place
   * each kind is checked in isolation, on a question built straight from
   * Practice's own generators rather than whatever a lesson happened to
   * draw: `walk()` proves a lesson finishes, this proves what each kind of
   * step does with a right answer, a wrong one, and the edges between (a
   * missed square, a legal-but-different move, two of four choices right).
   * Each factory is opened the way lsnShow() opens any step, with a
   * one-step "lesson" built by hand: `LSN.steps` set to just it,
   * lsnResetStep() to undo whatever the step before it left behind, then
   * the step's own setup(), lsnPaint() and lsnRender() — the same three
   * calls lsnShow() makes once a step is chosen.
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

  /* ============================================================
   * Task 31: the five step kinds lessons 4 and 5 add, exercised on their
   * own — the same reason Task 30a's section above exists: `walk()` already
   * proves each one finishes a real lesson, this proves what each does with
   * a right answer, a wrong one, and the edges the walk never has reason to
   * hit (a click on a man that is not hanging, a rebuild one man short).
   * ============================================================ */
  head('The five new step kinds for lessons 4 and 5 are exercised on their own');

  const attackQ = (level, ask) => untilQuestion(
    () => p.prMakeAttack(p.prRecipe('attack', level)), q => q.ask === ask, ask);
  const holdQ = (level, modes, mode) => untilQuestion(
    () => p.prMakeHold(Object.assign({}, p.prRecipe('hold', level), { modes })),
    q => q.mode === mode, 'a Hold the Position ' + mode);

  head('lsnStepAttackYesNo — attacks and defended, read as the same line either way');
  {
    const q = attackQ(1, 'attacks');
    check('the question carries a piece, a target and a boolean answer',
          q.from >= 0 && q.target >= 0 && typeof q.answer === 'boolean', JSON.stringify(q));
    const step = p.lsnStepAttackYesNo(q);
    check('solve is choices', step.solve === 'choices');
    openBareStep(p, step);
    check('the attacking piece is lit, not the target', p.LSN.marks.get(q.from) === 'lsn-lit');
    check('exactly Yes and No are offered',
          Array.from(p.by('lsnChoices').children).map(b => b.textContent).join(',') === 'Yes,No');
    clickChoicesUntilRight('lsnStepAttackYesNo (attacks)');
  }
  {
    const q = attackQ(5, 'defended');
    const step = p.lsnStepAttackYesNo(q);
    openBareStep(p, step);
    check('a defended question lights the target rather than the piece asked about',
          p.LSN.marks.get(q.target) === 'lsn-lit');
    clickChoicesUntilRight('lsnStepAttackYesNo (defended)');
  }
  {
    openBareStep(p, p.lsnStepAttackYesNo(attackQ(1, 'attacks')));
    check('lsnStepAttackYesNo is answerable by the choices solver', await solveStep(p, 3000));
  }

  head('lsnStepHanging — click one or two men, and a wrong click never ends the step');
  {
    const q = attackQ(6, 'hanging');
    check('the question names one or two hanging men',
          Array.isArray(q.answer) && q.answer.length >= 1 && q.answer.length <= 2, JSON.stringify(q));
    const step = p.lsnStepHanging(q);
    check('solve is hanging', step.solve === 'hanging');
    openBareStep(p, step);
    let notHanging = -1;
    for (let i = 0; i < 64; i++) if (q.answer.indexOf(i) < 0){ notHanging = i; break; }
    p.LSN.onSquare(notHanging);
    check('a square that is not hanging is refused without ending the step',
          p.LSN.ok === false && p.LSN.marks.get(notHanging) !== 'lsn-right');
    q.answer.forEach(sq => p.LSN.onSquare(sq));
    check('every hanging man is marked right, and the step ends once they all are found',
          p.LSN.ok === true && q.answer.every(sq => p.LSN.marks.get(sq) === 'lsn-right'));
  }
  {
    openBareStep(p, p.lsnStepHanging(attackQ(6, 'hanging')));
    check('lsnStepHanging is answerable by the hanging solver', await solveStep(p, 5000));
  }

  head('lsnStepCluster — Hold the Position’s question mode, Fine’s own order, whatever shape it asks in');
  {
    const q = holdQ(2, ['question'], 'question');
    check('the question carries a position and one of Fine’s own asks', q.mode === 'question' && !!q.ask, JSON.stringify(q.ask));
    const step = p.lsnStepCluster(q);
    check('solve is cluster', step.solve === 'cluster');
    openBareStep(p, step);
    check('the Position card is up, in Fine’s order, before anything is asked',
          p.by('lsnExtraTitle').textContent === 'Position' && /King/.test(p.by('lsnExtraBody').innerHTML || ''),
          p.by('lsnExtraBody').innerHTML);
    const ready = Array.from(p.by('lsnUnder').children).find(b => b.textContent.indexOf('I’m Ready') === 0);
    check('I’m Ready is offered', !!ready);
    ready.onclick();
    check('the card and the board go dark together',
          p.by('lsnExtra').style.display === 'none' && p.LSN.mode === 'blind');
    check('the question itself is now on the card', (p.by('lsnAsk').innerHTML || '') === q.ask.text,
          p.by('lsnAsk').innerHTML);
  }
  // Every one of the four shapes prAskFine()/prAskAbout() can hand back —
  // 'where', 'what', 'count', 'occupied' — has to be answerable, and which
  // one turns up on a given draw is chance, so this runs enough draws to
  // give the shuffle a real chance at each of them rather than asking for
  // just one.
  for (let i = 0; i < 14; i++){
    const q = holdQ(2, ['question'], 'question');
    openBareStep(p, p.lsnStepCluster(q));
    const ok = await solveStep(p, 4000);
    check('lsnStepCluster (' + q.ask.t + ') is answerable by the cluster solver', ok, q.ask.text);
  }

  head('lsnStepRebuild — Hold the Position’s rebuild mode, judged with rebuildDiff()');
  {
    const q = holdQ(3, ['rebuild'], 'rebuild');
    check('the question carries a target list of at least two men', Array.isArray(q.want) && q.want.length >= 2, JSON.stringify(q.want));
    const step = p.lsnStepRebuild(q);
    check('solve is rebuild', step.solve === 'rebuild');
    openBareStep(p, step);
    check('the Position card is up before I’m Ready',
          p.by('lsnExtraTitle').textContent === 'Position' && /King/.test(p.by('lsnExtraBody').innerHTML || ''));
    const ready = Array.from(p.by('lsnUnder').children).find(b => b.textContent.indexOf('I’m Ready') === 0);
    ready.onclick();
    check('the card comes down and a twelve-glyph palette goes up, plus Clear a square',
          p.by('lsnExtra').style.display === 'none' && p.by('lsnChoices').children.length === 13);
    // every man but the last one — left out on purpose
    q.want.slice(0, -1).forEach(m => {
      const btn = Array.from(p.by('lsnChoices').children).find(b => b.dataset.c === m.c && b.dataset.t === m.t);
      btn.onclick();
      p.LSN.onSquare(m.sq);
    });
    const done = Array.from(p.by('lsnUnder').children).find(b => b.textContent.indexOf('Done') === 0);
    done.onclick();
    check('one man short concedes rather than passing', p.LSN.ok === true);
    const missing = q.want[q.want.length - 1];
    check('the missing man is marked lsn-miss', p.LSN.marks.get(missing.sq) === 'lsn-miss');
  }
  {
    const q = holdQ(3, ['rebuild'], 'rebuild');
    openBareStep(p, p.lsnStepRebuild(q));
    Array.from(p.by('lsnUnder').children).find(b => b.textContent.indexOf('I’m Ready') === 0).onclick();
    q.want.forEach(m => {
      const btn = Array.from(p.by('lsnChoices').children).find(b => b.dataset.c === m.c && b.dataset.t === m.t);
      btn.onclick();
      p.LSN.onSquare(m.sq);
    });
    Array.from(p.by('lsnUnder').children).find(b => b.textContent.indexOf('Done') === 0).onclick();
    check('every man placed exactly is accepted outright, and every mark is lsn-right',
          p.LSN.ok === true && p.LSN.marks.size === q.want.length &&
          Array.from(p.LSN.marks.values()).every(c => c === 'lsn-right'));
  }
  {
    openBareStep(p, p.lsnStepRebuild(holdQ(3, ['rebuild'], 'rebuild')));
    check('lsnStepRebuild is answerable by the rebuild solver', await solveStep(p, 8000));
  }

  /* ============================================================
   * Task 32: the four step kinds lessons 6 and 7 add, exercised on their
   * own — the same reason Task 30a's and Task 31's sections above exist:
   * walk() already proves each one finishes a real lesson, this proves what
   * each does with a right answer, a wrong one, and the edges the walk never
   * has reason to hit (a wrong from-square, an extra square picked alongside
   * the right ones, a wrong material reading, a wrong captured-man choice).
   * ============================================================ */
  head('The four new step kinds for lessons 6 and 7 are exercised on their own');

  const changeQ = () => untilQuestion(
    () => p.prMakeHold(p.prRecipe('hold', 3)), q => q.mode === 'change', 'a Hold the Position change');
  const afterQ = kind => untilQuestion(
    () => p.prMakeAfter(Object.assign({}, p.prRecipe('after', 1), { kinds:[kind], asks:1 })),
    q => !!q, 'an After the Move ' + kind + ' question');

  head('lsnStepChange — Hold the Position’s change mode, and a wrong square never ends the step');
  {
    const q = changeQ();
    check('the question carries a move and the position it leaves behind',
          q.change && q.change.from >= 0 && q.change.to >= 0 && !!q.change.after, JSON.stringify(q.change));
    const step = p.lsnStepChange(q);
    check('solve is changed', step.solve === 'changed');
    openBareStep(p, step);
    check('the position is shown sighted before anything is hidden',
          p.LSN.st === q.st && p.LSN.mode === 'sighted' && p.LSN.named === true);
    const revealed = await until(() => !!p.LSN.onSquare, 3000);
    check('the after-position comes up and the question is asked', revealed);
    check('the board switched to the position with the move already played', p.LSN.st === q.change.after);
    check('no last-move highlight gives the vacated square away', p.LSN.last === null);
    let wrongSq = -1;
    for (let i = 0; i < 64; i++) if (i !== q.change.from){ wrongSq = i; break; }
    p.LSN.onSquare(wrongSq);
    check('a wrong square is refused without ending the step',
          p.LSN.ok === false && p.LSN.marks.get(wrongSq) !== 'lsn-right');
    p.LSN.onSquare(q.change.from);
    check('the right square is accepted and marked right',
          p.LSN.ok === true && p.LSN.marks.get(q.change.from) === 'lsn-right');
  }
  {
    openBareStep(p, p.lsnStepChange(changeQ()));
    check('lsnStepChange is answerable by the changed solver', await solveStep(p, 5000));
  }

  head('lsnStepAfter — After the Move’s four questions, judged the way Attack Vision already judges them');
  {
    const q = afterQ('vacated');
    check('the question names the move and what it left behind', !!q.move && !!q.facts, JSON.stringify(q.move));
    const step = p.lsnStepAfter(q, 'vacated');
    check('solve is changed', step.solve === 'changed');
    openBareStep(p, step);
    const asked = await until(() => !!p.LSN.onSquare, 4000);
    check('the move is stated and then the question is asked', asked, p.by('lsnAsk').innerHTML);
    check('the board has moved on to the after-position', p.LSN.st === q.after);
    check('no last-move highlight gives the vacated square away here either', p.LSN.last === null);
    let wrongSq = -1;
    for (let i = 0; i < 64; i++) if (i !== q.move.from){ wrongSq = i; break; }
    p.LSN.onSquare(wrongSq);
    check('a wrong square is refused without ending the step', p.LSN.ok === false);
    p.LSN.onSquare(q.move.from);
    check('the vacated square is accepted', p.LSN.ok === true);
  }
  {
    const q = afterQ('attacks');
    const step = p.lsnStepAfter(q, 'attacks');
    check('solve is attacks', step.solve === 'attacks');
    openBareStep(p, step);
    await until(() => !!p.LSN.onSquare, 4000);
    check('the last-move square is lit here, for the harness (and the player) to read',
          !!p.LSN.last && p.LSN.last.to === q.move.to);
    check('prAttacked() of the after-position agrees with q.facts.attacks',
          JSON.stringify(p.prAttacked(q.after, q.move.to).slice().sort()) ===
          JSON.stringify(q.facts.attacks.slice().sort()));
    let extra = -1;
    for (let i = 0; i < 64; i++) if (q.facts.attacks.indexOf(i) < 0){ extra = i; break; }
    q.facts.attacks.forEach(sq => p.LSN.onSquare(sq));
    if (extra >= 0) p.LSN.onSquare(extra);
    let doneBtn = Array.from(p.by('lsnUnder').children).find(b => b.textContent.indexOf('Done') === 0);
    doneBtn.onclick();
    check('an extra square picked alongside the right ones is refused, and the step stays open',
          p.LSN.ok === false);
    q.facts.attacks.forEach(sq => p.LSN.onSquare(sq));
    doneBtn = Array.from(p.by('lsnUnder').children).find(b => b.textContent.indexOf('Done') === 0);
    doneBtn.onclick();
    check('the exact set is then accepted', p.LSN.ok === true);
  }
  {
    openBareStep(p, p.lsnStepAfter(afterQ('attacks'), 'attacks'));
    check('lsnStepAfter (attacks) is answerable by the attacks solver', await solveStep(p, 6000));
  }
  {
    const q = afterQ('hanging');
    const step = p.lsnStepAfter(q, 'hanging');
    check('solve is loose', step.solve === 'loose');
    openBareStep(p, step);
    await until(() => !!p.LSN.onSquare, 4000);
    check('prHanging() of the after-position agrees with q.facts.hanging',
          JSON.stringify(p.prHanging(q.after).slice().sort()) === JSON.stringify(q.facts.hanging.slice().sort()));
    const nothingBtn = () => Array.from(p.by('lsnUnder').children).find(b => b.textContent.indexOf('Nothing') === 0);
    if (q.facts.hanging.length){
      nothingBtn().onclick();
      check('claiming nothing is hanging when something is refuses without ending the step', p.LSN.ok === false);
      q.facts.hanging.forEach(sq => p.LSN.onSquare(sq));
      const doneBtn = Array.from(p.by('lsnUnder').children).find(b => b.textContent.indexOf('Done') === 0);
      doneBtn.onclick();
      check('the exact hanging squares are then accepted', p.LSN.ok === true);
    } else {
      nothingBtn().onclick();
      check('nothing hanging is accepted by saying so', p.LSN.ok === true);
    }
  }
  {
    openBareStep(p, p.lsnStepAfter(afterQ('hanging'), 'hanging'));
    check('lsnStepAfter (hanging) is answerable by the loose solver', await solveStep(p, 6000));
  }
  {
    const q = afterQ('check');
    const step = p.lsnStepAfter(q, 'check');
    check('solve is choices', step.solve === 'choices');
    openBareStep(p, step);
    await until(() => p.by('lsnChoices').children.length > 0, 4000);
    check('Yes and No are offered',
          Array.from(p.by('lsnChoices').children).map(b => b.textContent).join(',') === 'Yes,No');
    clickChoicesUntilRight('lsnStepAfter (check)');
  }
  {
    openBareStep(p, p.lsnStepAfter(afterQ('check'), 'check'));
    check('lsnStepAfter (check) is answerable by the choices solver', await solveStep(p, 6000));
  }

  head('lsnStepCaptureSeq — Move Tracker’s captured question, the walk played and then asked');
  {
    const step = p.lsnStepCaptureSeq();
    check('solve is choices', step.solve === 'choices');
    openBareStep(p, step);
    const hide = Array.from(p.by('lsnUnder').children).find(b => b.textContent.indexOf('Hide the Board') === 0);
    check('Hide the Board is offered on the starting position', !!hide && p.LSN.mode === 'sighted');
    hide.onclick();
    check('the board goes dark for the walk', p.LSN.mode === 'blind');
    const asked = await until(() => p.by('lsnChoices').children.length > 0, 8000);
    check('the walk finishes and the question is asked', asked, p.by('lsnAsk').innerHTML);
    const list = Array.from(p.by('lsnChoices').children);
    check('Nothing is one of the choices, alongside every man that actually came off',
          list.some(b => b.textContent === 'Nothing'));
    clickChoicesUntilRight('lsnStepCaptureSeq');
  }
  {
    openBareStep(p, p.lsnStepCaptureSeq());
    check('lsnStepCaptureSeq is answerable by the choices solver', await solveStep(p, 12000));
  }

  head('lsnStepExchange — Forcing Lines’ material question, the exchange replayed once it is found');
  {
    const q = p.prMakeForcing(p.prRecipe('forcing', 1));
    check('the question carries a line of at least two plies and a material delta',
          Array.isArray(q.line) && q.line.length >= 2 && typeof q.delta === 'number', JSON.stringify(q.line));
    const step = p.lsnStepExchange(q);
    check('solve is choices', step.solve === 'choices');
    openBareStep(p, step);
    const shown = await until(() => p.by('lsnChoices').children.length > 0, 3000);
    check('the exchange is laid out as notation once the position is hidden', shown && p.LSN.mode === 'blind');
    check('the card shows the line', (p.by('lsnExtraBody').innerHTML || '').indexOf(q.line[0].san) >= 0);
    const list = Array.from(p.by('lsnChoices').children);
    let rightBtn = null;
    for (const b of list){
      b.onclick();
      if (b.classList.contains('right')){ rightBtn = b; break; }
      check('a wrong material reading is marked wrong, disabled, and leaves the step open',
            b.classList.contains('wrong') && b.disabled === true && p.LSN.ok === false);
    }
    check('the right reading is found', !!rightBtn);
    check('but the step does not end the instant it is picked — the exchange has not played yet',
          p.LSN.ok === false);
    const finished = await until(() => p.LSN.ok === true, q.line.length * 900 + 2000);
    check('the whole exchange plays out and only then does the step end', finished);
    check('the board actually reflects the final position', JSON.stringify(p.LSN.st.b) === JSON.stringify(q.final.b));
  }
  {
    openBareStep(p, p.lsnStepExchange(p.prMakeForcing(p.prRecipe('forcing', 2))));
    check('lsnStepExchange is answerable by the choices solver', await solveStep(p, 15000));
  }

  /* ============================================================
   * Task 33: the four step kinds lessons 8 and 9 add, exercised on their
   * own — the same reason Tasks 30a's, 31's and 32's own sections above
   * exist: walk() already proves each one finishes a real lesson, this
   * proves what each does with a right answer, a wrong one, and the edges
   * the walk never has reason to hit (a wrong king square, a wrong count, a
   * wrong last move, a non-mating move, a wrong rebuild).
   * ============================================================ */
  head('The four new step kinds for lessons 8 and 9 are exercised on their own');

  head('lsnStepCheckThree — three questions under one step, none of them ending it early but the last');
  {
    const step = p.lsnStepCheckThree();
    check('solve is multi', step.solve === 'multi');
    openBareStep(p, step);
    const hide = Array.from(p.by('lsnUnder').children).find(b => b.textContent.indexOf('Hide the Board') === 0);
    check('Hide the Board is offered on the starting position', !!hide && p.LSN.mode === 'sighted');
    hide.onclick();
    check('the board goes dark for the walk', p.LSN.mode === 'blind');
    const asked = await until(() => !!p.LSN.onSquare, 10000);
    check('the walk finishes and the king question is asked first', asked, p.by('lsnAsk').innerHTML);
    const truth = p.kingSq(p.LSN.st, 'w');
    check('White does still have a king to ask about', truth >= 0);
    let wrongSq = -1;
    for (let i = 0; i < 64; i++) if (i !== truth){ wrongSq = i; break; }
    p.LSN.onSquare(wrongSq);
    check('a wrong king square is refused without ending the step',
          p.LSN.ok === false && p.LSN.marks.get(wrongSq) !== 'lsn-right');
    p.LSN.onSquare(truth);
    check('the right square is marked right and moves on to a count question, rather than ending the step',
          p.LSN.ok === false && p.LSN.marks.get(truth) === 'lsn-right' && p.by('lsnChoices').children.length > 0,
          p.by('lsnAsk').innerHTML);
    {
      const list = Array.from(p.by('lsnChoices').children);
      let rightBtn = null;
      for (const b of list){
        b.onclick();
        if (b.classList.contains('right')){ rightBtn = b; break; }
        check('a wrong count is marked wrong and leaves the step open',
              b.classList.contains('wrong') && p.LSN.ok === false);
      }
      check('the count question is found', !!rightBtn);
    }
    check('the step is still open — the last-move question is still to come, with fresh choices',
          p.LSN.ok === false && p.by('lsnChoices').children.length > 0, p.by('lsnAsk').innerHTML);
    {
      const list = Array.from(p.by('lsnChoices').children);
      let rightBtn = null;
      for (const b of list){
        b.onclick();
        if (p.LSN.ok){ rightBtn = b; break; }
        check('a wrong last-move choice is marked wrong and leaves the step open', b.classList.contains('wrong'));
      }
      check('the third right answer, and only the third, finishes the step', p.LSN.ok === true && !!rightBtn);
    }
  }
  {
    openBareStep(p, p.lsnStepCheckThree());
    check('lsnStepCheckThree is answerable by the multi solver', await solveStep(p, 15000));
  }

  head('lsnStepRecover — six plies read hidden, then rebuilt from the score alone, never a Position card');
  {
    const step = p.lsnStepRecover();
    check('solve is recover', step.solve === 'recover');
    openBareStep(p, step);
    const hide = Array.from(p.by('lsnUnder').children).find(b => b.textContent.indexOf('Hide the Board') === 0);
    check('Hide the Board is offered on the starting position', !!hide && p.LSN.mode === 'sighted');
    hide.onclick();
    const ready = await until(() => p.by('lsnChoices').children.length > 0, 12000);
    check('the walk finishes and the rebuild palette comes up', ready, p.by('lsnAsk').innerHTML);
    check('the card says not to guess, and to rebuild from the score',
          (p.by('lsnAsk').innerHTML || '').indexOf('Do not guess') >= 0, p.by('lsnAsk').innerHTML);
    check('the move list stays up rather than going down with the board',
          p.by('lsnExtraTitle').textContent === 'The Moves' && p.by('lsnExtra').style.display !== 'none');
    // Read the card's own SANs exactly as the 'recover' solver does, and
    // replay them independently here to prove the target it rebuilds
    // against really is the walk's own end position — never the step's own
    // internal target read directly.
    const sans = readMovesCard(p.by('lsnExtraBody').innerHTML || '');
    check('the card lists six plies', sans.length === 6, sans.join(' '));
    let st = p.newState();
    sans.forEach(san => { const res = p.parseMoveIn(st, san); st = p.makeMove(st, res.move); });
    for (let i = 0; i < 64; i++){
      const man = st.b[i];
      if (!man) continue;
      const btn = Array.from(p.by('lsnChoices').children).find(b => b.dataset.c === man.c && b.dataset.t === man.t);
      btn.onclick();
      p.LSN.onSquare(i);
    }
    Array.from(p.by('lsnUnder').children).find(b => b.textContent.indexOf('Done') === 0).onclick();
    check('the end position, rebuilt from the score alone, is accepted outright', p.LSN.ok === true);
  }
  {
    // one man short concedes rather than passing, the same contract
    // lsnStepRebuild's own rebuild already keeps.
    const step = p.lsnStepRecover();
    openBareStep(p, step);
    Array.from(p.by('lsnUnder').children).find(b => b.textContent.indexOf('Hide the Board') === 0).onclick();
    await until(() => p.by('lsnChoices').children.length > 0, 12000);
    const sans = readMovesCard(p.by('lsnExtraBody').innerHTML || '');
    let st = p.newState();
    sans.forEach(san => { const res = p.parseMoveIn(st, san); st = p.makeMove(st, res.move); });
    const men = [];
    for (let i = 0; i < 64; i++) if (st.b[i]) men.push({ sq:i, c:st.b[i].c, t:st.b[i].t });
    men.slice(0, -1).forEach(m => {
      const btn = Array.from(p.by('lsnChoices').children).find(b => b.dataset.c === m.c && b.dataset.t === m.t);
      btn.onclick();
      p.LSN.onSquare(m.sq);
    });
    Array.from(p.by('lsnUnder').children).find(b => b.textContent.indexOf('Done') === 0).onclick();
    check('one man short concedes rather than passing', p.LSN.ok === true);
    const missing = men[men.length - 1];
    check('the missing man is marked lsn-miss', p.LSN.marks.get(missing.sq) === 'lsn-miss');
  }
  {
    openBareStep(p, p.lsnStepRecover());
    check('lsnStepRecover is answerable by the recover solver', await solveStep(p, 15000));
  }

  head('lsnStepMate1 — Blind Calculation’s mate-in-one, found with the men gone, judged by lsnAskMove()');
  {
    const q = p.prMakeCalc(p.prRecipe('calc', 1));
    check('the question carries a position and a mating move', !!q && !!q.st && !!q.answer, JSON.stringify(q && q.answer));
    const step = p.lsnStepMate1(q);
    check('solve is move', step.solve === 'move');
    openBareStep(p, step);
    check('the position is shown sighted first', p.LSN.st === q.st && p.LSN.mode === 'sighted');
    const ready = Array.from(p.by('lsnUnder').children).find(b => b.textContent.indexOf('I’m Ready') === 0);
    check('I’m Ready is offered', !!ready);
    ready.onclick();
    check('the men go dark with it', p.LSN.mode === 'blind');
    const legal = p.legalMoves(q.st, q.st.turn);
    const want = legal.find(m => m.from === q.answer.from && m.to === q.answer.to &&
                                  (m.promo || null) === (q.answer.promo || null));
    check('the answer is a legal move in the position', !!want, JSON.stringify(q.answer));
    const other = legal.find(m => !(m.from === want.from && m.to === want.to));
    check('there is a non-mating legal move to try first', !!other);
    p.LSN.onSquare(other.from);
    p.LSN.onSquare(other.to);
    check('a move that is not mate says only that — never what is — and does not end the step',
          p.LSN.ok === false && (p.by('lsnSay').innerHTML || '').indexOf('Not mate') >= 0,
          p.by('lsnSay').innerHTML);
    p.LSN.onSquare(want.from);
    p.LSN.onSquare(want.to);
    check('the mate is accepted', p.LSN.ok === true);
  }
  {
    openBareStep(p, p.lsnStepMate1(p.prMakeCalc(p.prRecipe('calc', 1))));
    check('lsnStepMate1 is answerable by the move solver', await solveStep(p, 8000));
  }

  head('lsnStepLineThenRoot — one branch walked to its end, then the root asked for again');
  {
    const q = p.prMakeBranches(p.prRecipe('branches', 1));
    check('the question carries a branch with its own end question and root question',
          !!q && Array.isArray(q.branches) && q.branches.length >= 1 &&
          !!q.branches[0].ask && !!q.branches[0].rootAsk, JSON.stringify(q && q.branches && q.branches[0]));
    const br = q.branches[0];
    const step = p.lsnStepLineThenRoot(q);
    check('solve is multi', step.solve === 'multi');
    openBareStep(p, step);
    check('the root is shown, men in plain sight — level 1 shows it', p.LSN.st === q.root && p.LSN.mode === 'sighted');
    const ready = Array.from(p.by('lsnUnder').children).find(b => b.textContent.indexOf('I’m Ready') === 0);
    check('I’m Ready is offered', !!ready);
    ready.onclick();
    check('the men go dark for the line', p.LSN.mode === 'blind');
    const asked = await until(() => p.by('lsnChoices').children.length > 0, 8000);
    check('the line plays and the branch’s own end question is asked', asked, p.by('lsnAsk').innerHTML);
    check('it is exactly the question the branch carries',
          (p.by('lsnAsk').innerHTML || '') === br.ask.text, p.by('lsnAsk').innerHTML);
    {
      const list = Array.from(p.by('lsnChoices').children);
      let rightBtn = null;
      for (const b of list){
        b.onclick();
        if (b.classList.contains('right')){ rightBtn = b; break; }
        check('a wrong end-of-branch choice is marked wrong and leaves the step open',
              b.classList.contains('wrong') && p.LSN.ok === false);
      }
      check('the branch’s end is found', !!rightBtn);
    }
    check('the step is not over — the root question is still to come', p.LSN.ok === false);
    const asked2 = await until(() => (p.by('lsnAsk').innerHTML || '') === br.rootAsk.text, 2000);
    check('the line is let go and the root question takes its place', asked2, p.by('lsnAsk').innerHTML);
    {
      const list = Array.from(p.by('lsnChoices').children);
      let rightBtn = null;
      for (const b of list){
        b.onclick();
        if (p.LSN.ok){ rightBtn = b; break; }
        check('a wrong root choice is marked wrong and leaves the step open', b.classList.contains('wrong'));
      }
      check('the root is found too, and only now does the step end', p.LSN.ok === true && !!rightBtn);
    }
  }
  {
    openBareStep(p, p.lsnStepLineThenRoot(p.prMakeBranches(p.prRecipe('branches', 1))));
    check('lsnStepLineThenRoot is answerable by the multi solver', await solveStep(p, 8000));
  }

  /* ============================================================
   * Task 34: lesson 10's own mini game, exercised on its own — the same
   * reason every banner above has its own section. walk() and the per-lesson
   * checks earlier already prove the whole course, including this step,
   * finishes; this proves what the step does move by move: any legal move
   * accepted rather than one fixed answer, a reply that waits on its own
   * timer rather than landing mid-click, the checkpoint's wrong answer that
   * costs nothing, and the fourth move that ends it.
   *
   * Review fix: `prMakeProgressive()` is unseeded, and the page's own
   * `bestMove()` is not deterministic (it scores with `Math.random()` mixed
   * in and breaks ties at random too), so an unscreened deal can have the
   * page's own reply mate or stalemate the learner before the checkpoint
   * ever comes up — the first run of this section did exactly that, and the
   * hand-written wrong-square click below crashed the whole suite rather
   * than failing one check. `simulateMiniGameDrive()` is a fast, pure
   * pre-check of the very same drive the real step plays — the learner
   * plays legal[0] (the same first legal move the generic solver's own
   * move-branch would try first), the page replies with `bestMove(st, 2)` —
   * so a deal can be screened for a shape without ever touching the DOM or
   * a real timer. It is a filter, not a promise: `bestMove()`'s own
   * randomness means a screened deal can still play out differently for
   * real, which is why the checkpoint section below still guards the
   * wrong-square click rather than assuming it is there, and why the
   * early-finish section confirms every candidate for real before counting
   * it found.
   * ============================================================ */
  function simulateMiniGameDrive(st){
    for (let mv = 0; mv < 2; mv++){
      const legal = p.legalMoves(st, st.turn);
      if (!legal.length) return 'the learner’s own move ' + (mv + 1);
      st = p.makeMove(st, legal[0]);
      const theirs = p.legalMoves(st, st.turn);
      if (!theirs.length) return 'the page’s reply to move ' + (mv + 1);
      st = p.makeMove(st, p.bestMove(st, 2) || theirs[0]);
    }
    return null;                                            // both rounds completed — the checkpoint is reached
  }

  head('lsnStepMiniGame — Progressive Blindfold’s own first rung, played once with a checkpoint in the middle');
  {
    // Dealt through a capped retry that keeps only a deal the simulation
    // above expects to reach the checkpoint — an unscreened deal ending
    // before it is exercised on its own, deliberately, in the section after
    // this one, rather than crashing this one by surprise.
    let dealt = null;
    for (let t = 0; t < 60 && !dealt; t++){
      const q = p.prMakeProgressive(p.prRecipe('progressive', 1));
      if (q && !simulateMiniGameDrive(q.st)) dealt = q;
    }
    check('a deal that reaches the checkpoint is found within 60 tries', !!dealt);
    // a bare `return` here would abort the whole suite (this section sits
    // directly inside the top-level async run()), not just this block
    if (dealt){
      const step = p.lsnStepMiniGame();
      check('solve is multi', step.solve === 'multi');
      openBareStep(p, step);
      p.LSN.st = dealt.st;              // the pre-screened deal, not the step's own fresh internal draw
      check('the position is three a side, mine vision, White’s own eye',
            p.LSN.st.b.filter(Boolean).length === 6 && p.LSN.mode === 'mine' && p.LSN.eye === 'w',
            p.LSN.st.b.filter(Boolean).length + ' men, ' + p.LSN.mode + ' / ' + p.LSN.eye);
      check('the learner is asked to move first', !!p.LSN.onSquare &&
            (p.by('lsnAsk').innerHTML || '').indexOf('Click a man') >= 0, p.by('lsnAsk').innerHTML);

      const awaitTurn = () => until(() =>
        !!p.LSN.onSquare && (p.by('lsnAsk').innerHTML || '').indexOf('Click a man') >= 0, 5000);
      const awaitCheckpoint = () => until(() =>
        p.LSN.ok || (p.by('lsnAsk').innerHTML || '').indexOf('Checkpoint') >= 0, 5000);

      // Move 1 — any legal move is right, the first one legalMoves() offers,
      // never a fixed answer read off the step.
      let legal = p.legalMoves(p.LSN.st, p.LSN.st.turn);
      let before = p.LSN.st;
      p.LSN.onSquare(legal[0].from);
      p.LSN.onSquare(legal[0].to);
      check('move 1 is accepted and the step is not over', p.LSN.st !== before && p.LSN.ok === false);
      check('the reply waits on its own timer rather than landing mid-click', p.LSN.onSquare === null);
      check('the second move is asked for once the reply lands', await awaitTurn());

      // Move 2, then the checkpoint — lesson 8's own habit, asked for real.
      legal = p.legalMoves(p.LSN.st, p.LSN.st.turn);
      before = p.LSN.st;
      p.LSN.onSquare(legal[0].from);
      p.LSN.onSquare(legal[0].to);
      check('move 2 is accepted', p.LSN.st !== before && p.LSN.ok === false);
      const atCheckpoint = await awaitCheckpoint();
      check('the checkpoint interrupts after the second move', atCheckpoint && !p.LSN.ok, p.by('lsnAsk').innerHTML);

      // Guarded rather than assumed: the pre-screen above is a filter, not a
      // guarantee, so a missing handler here — the deal ending early despite
      // it — is a failed check rather than a crash that takes the rest of
      // the suite down with it (the review's second finding).
      if (atCheckpoint && p.LSN.onSquare){
        const truth = p.kingSq(p.LSN.st, 'w');
        check('White does still have a king to ask about', truth >= 0);
        let wrongSq = -1;
        for (let i = 0; i < 64; i++) if (i !== truth){ wrongSq = i; break; }
        p.LSN.onSquare(wrongSq);
        check('a wrong king square is refused without ending the step', p.LSN.ok === false);
        p.LSN.onSquare(truth);
        check('the right square is accepted and the game resumes', await awaitTurn());
      } else {
        check('the checkpoint’s own click handler was there to click a wrong square against', false,
              'the deal ended before the checkpoint despite the pre-screen — see the section below');
      }

      // Moves 3 and 4 finish the step — two more legal moves, the page
      // replying to each, and the fourth ends it. Skipped if the checkpoint
      // above never actually resumed the game.
      for (let n = 0; n < 2 && !p.LSN.ok && p.LSN.onSquare; n++){
        legal = p.legalMoves(p.LSN.st, p.LSN.st.turn);
        before = p.LSN.st;
        p.LSN.onSquare(legal[0].from);
        p.LSN.onSquare(legal[0].to);
        if (p.LSN.ok) break;
        await until(() => p.LSN.st !== before && (p.LSN.onSquare || p.LSN.ok), 5000);
      }
      check('four moves finish the step', p.LSN.ok === true);
    }
  }
  {
    openBareStep(p, p.lsnStepMiniGame());
    check('lsnStepMiniGame is answerable by the multi solver, cold', await solveStep(p, 20000));
  }

  /* The review's second finding, the other half of the same bug: an
   * unscreened deal can end in mate or stalemate before the checkpoint ever
   * comes up, and the step has to finish there rather than leave a dead
   * handler behind. Hunted rather than constructed — prMakeProgressive()
   * takes no seed and there is no other way to ask it for exactly this
   * shape — and capped, because most deals reach the checkpoint and do not
   * end early: a genuine absence within the cap is recorded as a skip, not
   * a failure, since it says nothing wrong happened, only that this run's
   * draws did not turn one up. Every candidate the fast simulation flags is
   * still confirmed for real, exactly as the section above does, since the
   * simulation is a filter and not a promise. */
  head('lsnStepMiniGame — the early-finish branch: mate or stalemate before the checkpoint ends the step there');
  {
    let confirmed = null, realTries = 0;
    for (let t = 0; t < 300 && !confirmed && realTries < 20; t++){
      const q = p.prMakeProgressive(p.prRecipe('progressive', 1));
      if (!q) continue;
      const endedAt = simulateMiniGameDrive(q.st);
      if (!endedAt) continue;                     // this deal reaches the checkpoint — not this section's target

      realTries++;
      const step = p.lsnStepMiniGame();
      openBareStep(p, step);
      p.LSN.st = q.st;
      for (let mv = 0; mv < 2 && !p.LSN.ok && p.LSN.onSquare; mv++){
        const legal = p.legalMoves(p.LSN.st, p.LSN.st.turn);
        if (!legal.length) break;
        const before = p.LSN.st;
        p.LSN.onSquare(legal[0].from);
        p.LSN.onSquare(legal[0].to);
        if (p.LSN.ok) break;
        await until(() => p.LSN.st !== before && (p.LSN.onSquare || p.LSN.ok), 3000);
      }
      if (p.LSN.ok){
        check('a deal ending before the checkpoint (' + endedAt + ') finishes the step, never reaching one', true);
        confirmed = endedAt;
      }
    }
    if (!confirmed)
      check('SKIPPED — no deal ending before the checkpoint was confirmed within the cap this run', true);
  }

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
