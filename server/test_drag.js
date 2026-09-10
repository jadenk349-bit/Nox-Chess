/* Dragging a man to a square, on the three visions that draw a board.
 *
 * The whole page script runs under the dumb DOM shim test_spectate_flow.js
 * uses, and the test presses the squares the way a pointer does —
 * pointerdown, pointermove, pointerup — on a local game, so no socket and
 * no engine are involved. What is being checked is that a drag and a click
 * are the same move judged by the same rule: a press that never travels is
 * left to the click; a drag that lands on a legal square plays the move;
 * one that lands on an illegal square is refused exactly as a second click
 * would be, and the man goes back; letting go off the board or on the
 * square it came from plays nothing; the browser's own click after a drop
 * does not select the landing square; a hidden man is never picked up and
 * drawn moving; and nothing is dragged on a board that is not open.
 *
 * No server, no network:  node server/test_drag.js
 */
const fs = require('fs');
const PAGE = require('path').join(__dirname, '..', 'blind-chess.html');
const SRC = fs.readFileSync(PAGE, 'utf8');
const HTML = SRC.split('<script>')[0];
const BODY = SRC.match(/<script>\n"use strict";([\s\S]*?)<\/script>/)[1];
const IDS = [...HTML.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);

let passed = 0, failed = 0;
const check = (label, ok, detail) => {
  if (ok){ passed++; console.log('  PASS  ' + label); }
  else { failed++; console.log('  FAIL  ' + label + (detail === undefined ? '' : '  ' + JSON.stringify(detail))); }
};

function classSet(){
  const have = new Set();
  return { add:c=>have.add(c), remove:c=>have.delete(c),
           toggle:(c,on)=>{ if (on===undefined) have.has(c)?have.delete(c):have.add(c); else on?have.add(c):have.delete(c); },
           contains:c=>have.has(c), list:()=>[...have] };
}
/* The board answers getBoundingClientRect() with a 400px square at the
   origin, so a square is 50px and a pointer at (x, y) is on visual column
   x/50, row y/50. */
const BOARD = 400, SQ = BOARD / 8;
function mk(tag){
  const e = {
    tagName:(tag||'div').toUpperCase(), textContent:'', innerHTML:'', value:'', className:'',
    disabled:false, checked:false, style:{}, dataset:{}, children:[], parentElement:null,
    offsetWidth:100, onclick:null, onsubmit:null, classList:classSet(), listeners:{},
    appendChild(c){ this.children.push(c); c.parentElement = this; return c; },
    removeChild(c){ return c; }, remove(){}, setAttribute(){}, getAttribute(){ return null; },
    addEventListener(k, f){ (this.listeners[k] = this.listeners[k] || []).push(f); }, removeEventListener(){},
    focus(){}, blur(){}, click(){ this.onclick && this.onclick(); },
    scrollIntoView(){}, getBoundingClientRect(){ return {top:0,left:0,width:BOARD,height:BOARD}; },
    querySelectorAll(){ return []; }, closest(){ return null; },
    getContext(){ return new Proxy({}, { get:(t,k)=> k in t ? t[k]
        : (/create(Radial|Linear)Gradient/.test(k) ? () => ({ addColorStop(){} })
          : k === 'measureText' ? () => ({ width:10 }) : () => undefined),
      set:(t,k,v)=>{ t[k]=v; return true; } }); }
  };
  Object.defineProperty(e, 'firstChild', {
    get(){ return this.children.length ? this.children[0] : (this.children[0] = mk('span')); } });
  e.querySelector = sel => e.__qs || (e.__qs = mk());
  return e;
}
function makeDoc(){
  const pool = {}, seen = {};
  for (const id of IDS) pool[id] = mk();
  const qs = sel => seen[sel] || (seen[sel] = mk());
  const body = mk(); body.classList = classSet();
  const listeners = {};
  return {
    getElementById: id => pool[id] || (pool[id] = mk()),
    querySelector: qs, querySelectorAll: () => [], createElement: mk, createElementNS: mk,
    listeners, addEventListener(k, f){ (listeners[k] = listeners[k] || []).push(f); }, removeEventListener(){},
    body, documentElement: mk(), head: mk()
  };
}
const AudioCtx = function(){
  return { createOscillator:()=>({ connect(){}, start(){}, stop(){}, frequency:{ setValueAtTime(){} }, type:'' }),
           createGain:()=>({ connect(){}, gain:{ setValueAtTime(){}, exponentialRampToValueAtTime(){}, linearRampToValueAtTime(){} } }),
           destination:{}, currentTime:0, resume:()=>Promise.resolve(), state:'running' }; };
class FakeSocket { constructor(){ this.readyState = 0; } send(){} close(){} }
FakeSocket.OPEN = 1;

function makePage(){
  const doc = makeDoc();
  const loc = { protocol:'http:', host:'127.0.0.1:8787', href:'http://127.0.0.1:8787/', pathname:'/', hash:'', search:'' };
  const history = { state:null, pushState(st, _t, p){ this.state = st; }, replaceState(st){ this.state = st; } };
  const store = {};
  const storage = { getItem:k => (k in store ? store[k] : null), setItem:(k,v)=>{ store[k] = String(v); }, removeItem:k => { delete store[k]; } };
  const win = { addEventListener(){}, removeEventListener(){}, scrollTo(){},
                matchMedia:()=>({ matches:false, addEventListener(){}, addListener(){} }),
                innerWidth:1200, innerHeight:900, devicePixelRatio:1, location:loc, localStorage:storage, history };
  let out = null;
  const src = '"use strict";' + BODY.replace(/await import\([^)]*\)/g, 'await Promise.reject(new Error("no cdn"))') +
    '\n__expose({ G, DRAG, el, sqEls, pieceEls, picked, sqIndex, visualIndex, legalMoves, render, selectMode, startGame, goLocal, pickBotTime, showScreen });';
  new Function('document','window','location','localStorage','WebSocket','AudioContext',
               'webkitAudioContext','fetch','Image','requestAnimationFrame','cancelAnimationFrame',
               'getComputedStyle','navigator','console','history','__expose', src)(
    doc, win, loc, storage, FakeSocket, AudioCtx, AudioCtx,
    () => Promise.resolve({ ok:false, status:404, json:()=>Promise.resolve(null), text:()=>Promise.resolve('') }),
    mk, cb => setTimeout(()=>cb(Date.now()), 16), clearTimeout,
    () => ({ getPropertyValue: () => '' }), { userAgent:'node' },
    { log(){}, warn(){}, error(){} }, history, o => { out = o; });
  out.doc = doc;
  const squares = doc.getElementById('squares');
  /* The press and the click are the board's; the travel and the drop are
     the document's, so a pointer off the board is still followed. */
  const fire = (kind, ev) => ((kind === 'pointerdown' || kind === 'click' ? squares : doc).listeners[kind] || []).forEach(f => f(ev));
  /* The centre of a square, in the shim's pixels. */
  out.at = sq => { const v = out.visualIndex(out.sqIndex(sq)); return { x: (v & 7) * SQ + SQ / 2, y: (v >> 3) * SQ + SQ / 2 }; };
  const ev = (sq, x, y) => ({ button:0, isPrimary:true, pointerId:1, clientX:x, clientY:y,
                              target:{ closest: () => (sq ? out.sqEls[out.visualIndex(out.sqIndex(sq))] : null) } });
  out.down = sq => { const p = out.at(sq); fire('pointerdown', ev(sq, p.x, p.y)); };
  out.move = (x, y) => fire('pointermove', ev(null, x, y));
  out.up = (x, y) => fire('pointerup', ev(null, x, y));
  out.cancel = () => fire('pointercancel', ev(null, 0, 0));
  out.click = sq => fire('click', ev(sq, 0, 0));
  /* A whole drag: press on `from`, travel, let go on `to` (or off the board
     when `to` is null), followed by the click a browser fires after it. */
  out.drag = (from, to) => {
    out.down(from);
    const a = out.at(from); out.move(a.x + 2, a.y + 1);         // under the slop: still a click
    const b = to ? out.at(to) : { x: -30, y: -30 };
    out.move(a.x + 20, a.y + 20); out.move(b.x, b.y);
    out.up(b.x, b.y);
    out.click(to);
  };
  out.pieceAt = sq => { const p = out.G.st.b[out.sqIndex(sq)]; return p && p.t; };
  out.pieceEl = sq => { const p = out.G.st.b[out.sqIndex(sq)]; return p && out.pieceEls.get(p.id); };
  out.local = mode => { out.goLocal(); out.selectMode(mode); out.pickBotTime(10); out.startGame(); };
  return out;
}
const wait = ms => new Promise(r => setTimeout(r, ms));

async function main(){
  console.log('\nA sighted game');
  let p = makePage();
  await wait(10);
  p.local('sighted');
  check('the game is up, white to move', p.G.started && p.G.st.turn === 'w' && p.G.mode === 'sighted');
  const listeners = p.doc.getElementById('squares').listeners;
  check('the squares take the press and the click', ['pointerdown','click'].every(k => listeners[k] && listeners[k].length === 1), Object.keys(listeners));
  check('...and the document the travel and the drop, so a pointer off the board is still followed', ['pointermove','pointerup','pointercancel'].every(k => p.doc.listeners[k] && p.doc.listeners[k].length === 1), Object.keys(p.doc.listeners));
  check('...with no pointer capture, whose click would be retargeted away from the square', !/setPointerCapture/.test(SRC));

  p.down('e2');
  check('a press picks up the man on the square', p.DRAG.from === p.sqIndex('e2') && p.DRAG.el === p.pieceEl('e2'));
  check('...and selects nothing yet', p.G.sel === -1 && !p.DRAG.moved);
  const a = p.at('e2');
  p.move(a.x + 2, a.y + 2);
  check('a couple of pixels is not a drag', !p.DRAG.moved && p.G.sel === -1);
  p.up(a.x + 2, a.y + 2);
  check('...so letting go plays nothing and leaves the click to decide', p.pieceAt('e2') === 'P' && p.G.sel === -1 && !p.DRAG.swallow);
  p.click('e2');
  check('...and the click selects the square, as it always did', p.G.sel === p.sqIndex('e2'));
  p.click('e2');
  check('...and a second click clears it', p.G.sel === -1);

  p.down('e2');
  p.move(a.x + 20, a.y + 20);
  check('travelling past the slop makes it a drag', p.DRAG.moved);
  check('...which selects the square, the way the first click does', p.G.sel === p.sqIndex('e2'));
  check('...the man in the hand, marked as such', p.pieceEl('e2').classList.contains('dragging') && p.doc.getElementById('squares').classList.contains('dragging'));
  check('...following the pointer in pixels, centred on it', p.pieceEl('e2').style.transform === 'translate(' + (a.x + 20 - SQ / 2) + 'px, ' + (a.y + 20 - SQ / 2) + 'px)', p.pieceEl('e2').style.transform);
  const held = p.pieceEl('e2');
  p.render();
  check('a render mid-drag leaves the man where the pointer has it', held.style.transform.indexOf('px') > 0, held.style.transform);
  const b = p.at('e4');
  p.move(b.x, b.y); p.up(b.x, b.y);
  check('dropping it on a legal square plays the move', p.pieceAt('e4') === 'P' && !p.pieceAt('e2') && p.G.uci[0] === 'e2e4', p.G.uci);
  check('...the man handed back to the board: no longer in the hand, on its square in percent', !held.classList.contains('dragging') && p.DRAG.el === null && /%/.test(held.style.transform), held.style.transform);
  check('...and it is black\'s move', p.G.st.turn === 'b' && p.G.sel === -1);
  check('the click that follows a drop is swallowed', p.DRAG.swallow);
  p.click('e4');
  check('...so the landing square is not selected by it', p.G.sel === -1);
  await wait(5);
  check('...and the flag is down by the next tick', !p.DRAG.swallow);
  p.click('e7');
  check('...leaving a real click free to select', p.G.sel === p.sqIndex('e7'));
  p.G.sel = -1;

  p.drag('e7', 'e4');
  check('a drop on an illegal square plays nothing', p.pieceAt('e7') === 'P' && p.G.uci.length === 1, { at: p.pieceAt('e7'), uci: p.G.uci, turn: p.G.st.turn });
  check('...and clears the selection, as a refused click does', p.G.sel === -1 && p.DRAG.el === null);
  check('...the man back on its own square', /%/.test(p.pieceEl('e7').style.transform), p.pieceEl('e7').style.transform);

  p.drag('e7', 'e7');
  check('a drop back where it was picked up plays nothing and leaves it selected', p.G.uci.length === 1 && p.G.sel === p.sqIndex('e7'));
  p.click('e7'); p.G.sel = -1;

  p.drag('e7', null);
  check('letting go off the board plays nothing and selects nothing', p.G.uci.length === 1 && p.G.sel === -1);

  p.down('e7'); const c = p.at('e7'); p.move(c.x + 30, c.y + 30);
  p.cancel();
  check('a cancelled drag puts the man back and plays nothing', p.G.uci.length === 1 && p.DRAG.from === -1 && !p.pieceEl('e7').classList.contains('dragging'));
  await wait(5);
  p.click('e7');
  check('...and swallows no later click', p.G.sel === p.sqIndex('e7'));
  p.G.sel = -1;

  p.drag('d2', 'd4');
  check('a drag of the side not to move is refused by the rules', p.G.uci.length === 1 && p.G.st.turn === 'b');
  check('...and its man was never picked up', true);

  p.drag('e7', 'e5');
  check('black moves by dragging as well', p.G.uci[1] === 'e7e5' && p.G.st.turn === 'w');

  console.log('\nSee the Board and Fog of War');
  p = makePage(); await wait(10);
  p.local('blind');
  p.down('e2');
  check('on a hidden board nothing is picked up to draw', p.DRAG.from === p.sqIndex('e2') && p.DRAG.el === null);
  const d = p.at('e2'), e4 = p.at('e4');
  p.move(d.x + 20, d.y + 20);
  check('...but the drag still selects the square', p.G.sel === p.sqIndex('e2'));
  p.move(e4.x, e4.y); p.up(e4.x, e4.y); p.click('e4');
  check('...and the drop still plays the move', p.G.uci[0] === 'e2e4');
  p.drag('d7', 'd5');
  check('...for either side', p.G.uci[1] === 'd7d5');
  p.drag('h8', 'h5');
  check('an empty or wrong square is refused, revealing nothing', p.G.uci.length === 2 && p.G.sel === -1);

  p = makePage(); await wait(10);
  p.local('fog');
  p.down('e2');
  check('in fog your own man is picked up', p.DRAG.el === p.pieceEl('e2'));
  p.cancel();
  p.drag('e2', 'e4');
  check('...and dragged', p.G.uci[0] === 'e2e4');
  p.down('e7');
  check('...black\'s man, now black looks, is picked up too — the hot seat turns the board', p.DRAG.el === p.pieceEl('e7'));
  p.cancel();
  p.drag('e7', 'e5');
  p.down('e2');
  check('an empty square carries nothing', p.DRAG.el === null);
  p.cancel();

  console.log('\nA board that is not open');
  p = makePage(); await wait(10);
  p.goLocal(); p.selectMode("sighted"); p.pickBotTime(10);
  p.down('e2');
  check('before Start Play a press picks nothing up', p.DRAG.from === -1);
  p.startGame();
  p.G.over = true;
  p.down('e2');
  check('nor after the game', p.DRAG.from === -1);
  p.G.over = false; p.G.thinking = true;
  p.down('e2');
  check('nor while the engine thinks', p.DRAG.from === -1);
  p.G.thinking = false; p.G.peeking = true;
  p.down('e2');
  check('nor during a peek', p.DRAG.from === -1);
  p.G.peeking = false;
  p.down('e2'); p.move(30, 30);
  p.G.over = true;
  const f = p.at('e4'); p.up(f.x, f.y);
  check('a game that ends mid-drag plays nothing at the drop', p.G.uci.length === 0 && p.G.sel === -1 && p.DRAG.el === null);

  console.log('\nThe stylesheet');
  check('the squares give up scrolling to the drag', /\.squares\{[^}]*touch-action:none/.test(SRC));
  check('a dragged man has no easing and sits over the rest', /\.piece\.dragging\{[^}]*transition:none[^}]*z-index/.test(SRC));

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
