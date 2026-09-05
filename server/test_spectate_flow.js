/* Spectating a league game on the game screen, from the home page's card to
 * the way back, against a scripted socket.
 *
 * The whole page script runs under the dumb DOM shim test_rematch_e2e.js
 * uses, but the socket is a stand-in the test drives: it records what the
 * page sends and hands back whatever {t:'watch-game'} snapshot the test
 * wants next. What is being checked is the page's half of the brief — that
 * a live card carries the game's id and a waiting one does not; that opening
 * one lands on the game screen as a spectator, in that game's vision, with
 * the players named as the leaderboard names them; that moves and clocks
 * follow the snapshots without a reload; that nothing a player could do is
 * possible; that the result is shown when the server says so, with the way
 * home and, once there is one, the next game; that leaving puts the board
 * back; and that /spectate/<id> boots straight into the same game.
 *
 * No server, no network:  node server/test_spectate_flow.js
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
function mk(tag){
  const e = {
    tagName:(tag||'div').toUpperCase(), textContent:'', innerHTML:'', value:'', className:'',
    disabled:false, checked:false, style:{}, dataset:{}, children:[], parentElement:null,
    offsetWidth:100, onclick:null, onsubmit:null, classList:classSet(), listeners:{},
    appendChild(c){ this.children.push(c); c.parentElement = this; return c; },
    removeChild(c){ return c; }, remove(){}, setAttribute(){}, getAttribute(){ return null; },
    addEventListener(k, f){ (this.listeners[k] = this.listeners[k] || []).push(f); }, removeEventListener(){},
    focus(){}, blur(){}, click(){ this.onclick && this.onclick(); },
    scrollIntoView(){}, getBoundingClientRect(){ return {top:0,left:0,width:100,height:100}; },
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
  return {
    getElementById: id => pool[id] || (pool[id] = mk()),
    querySelector: qs, querySelectorAll: () => [], createElement: mk, createElementNS: mk,
    addEventListener(){}, removeEventListener(){}, body, documentElement: mk(), head: mk()
  };
}
const AudioCtx = function(){
  return { createOscillator:()=>({ connect(){}, start(){}, stop(){}, frequency:{ setValueAtTime(){} }, type:'' }),
           createGain:()=>({ connect(){}, gain:{ setValueAtTime(){}, exponentialRampToValueAtTime(){}, linearRampToValueAtTime(){} } }),
           destination:{}, currentTime:0, resume:()=>Promise.resolve(), state:'running' }; };

/* The scripted socket: every socket the page opens is recorded here, and the
   test answers them. readyState 1 is OPEN. */
const sockets = [];
class FakeSocket {
  constructor(url){
    this.url = url; this.readyState = 0; this.sent = []; this.closed = false;
    sockets.push(this);
    setTimeout(() => { this.readyState = 1; this.onopen && this.onopen(); }, 0);
  }
  send(text){ this.sent.push(JSON.parse(text)); }
  close(){ this.closed = true; this.readyState = 3; }
  push(obj){ this.onmessage && this.onmessage({ data: JSON.stringify(obj) }); }
  asked(){ return this.sent.map(m => m.t); }
}
FakeSocket.OPEN = 1;

/** One whole page, with its own DOM, opened at `path`. */
function makePage(path){
  const doc = makeDoc();
  const loc = { protocol:'http:', host:'127.0.0.1:8787', href:'http://127.0.0.1:8787' + (path || '/'),
                pathname: path || '/', hash:'', search:'' };
  const history = { state:null, pushed:[], pushState(st, _t, p){ this.state = st; loc.pathname = p; this.pushed.push(p); },
                    replaceState(st, _t, p){ this.state = st; loc.pathname = p; } };
  const store = {};
  const storage = { getItem:k => (k in store ? store[k] : null),
                    setItem:(k,v)=>{ store[k] = String(v); }, removeItem:k => { delete store[k]; } };
  const winListeners = {};
  const win = { addEventListener(k, f){ (winListeners[k] = winListeners[k] || []).push(f); }, removeEventListener(){}, scrollTo(){},
                matchMedia:()=>({ matches:false, addEventListener(){}, addListener(){} }),
                innerWidth:1200, innerHeight:900, devicePixelRatio:1, location:loc, localStorage:storage, history };
  let out = null;
  const src = '"use strict";' + BODY.replace(/await import\([^)]*\)/g, 'await Promise.reject(new Error("no cdn"))') +
    '\n__expose({ G, SPEC, LIVE, el, picked, showScreen, liveUpdate, specOpen, specLeave, specUpdate, seatName, canConcede,' +
    ' SPECTATING, liveCardHTML, sqIndex, legalMoves, screen:()=>screenName, board:document.getElementById("board"),' +
    ' liveGrid:document.getElementById("liveGrid") });';
  new Function('document','window','location','localStorage','WebSocket','AudioContext',
               'webkitAudioContext','fetch','Image','requestAnimationFrame','cancelAnimationFrame',
               'getComputedStyle','navigator','console','history','__expose', src)(
    doc, win, loc, storage, FakeSocket, AudioCtx, AudioCtx,
    () => Promise.resolve({ ok:false, status:404, json:()=>Promise.resolve(null), text:()=>Promise.resolve('') }),
    mk, cb => setTimeout(()=>cb(Date.now()), 16), clearTimeout,
    () => ({ getPropertyValue: () => '' }), { userAgent:'node' },
    { log(){}, warn(){}, error(){} }, history, o => { out = o; });
  out.doc = doc; out.loc = loc; out.history = history; out.win = winListeners;
  out.press = id => doc.getElementById(id).onclick();
  out.up = id => doc.getElementById(id).classList.contains('show');
  out.text = id => doc.getElementById(id).textContent;
  out.bodyHas = c => doc.body.classList.contains(c);
  return out;
}
const wait = ms => new Promise(r => setTimeout(r, ms));

/* The row of recent moves between the strips, as the page last wrote it. */
const recent = p => [...p.doc.getElementById('specMoves').innerHTML.matchAll(/<div class="m( cur)?">([^<]+)<\/div>/g)]
  .map(m => ({ san: m[2], lit: !!m[1] }));
/* The name strip above or below the board, under the stub: layoutBoardBars()
   appends the rating and the colour tag to it on every render and the stub
   keeps them all, so the last two children are the latest render's. */
const strip = (p, barId) => {
  const kids = p.doc.getElementById(barId).querySelector('.bar-name').children;
  const last = kids.slice(-2);
  return { name: p.doc.getElementById(barId).querySelector('.bar-name').textContent,
           order: last.map(k => k.className).join(','), elo: last[0] && String(last[0].textContent) };
};

/* ---- a game, as the server would describe it ---- */
const NAMES = { w: { id:'u-white', name:'Arvenko', rating:2854 }, b: { id:'u-black', name:'LeoFromPrague', rating:2801 } };
function snap(id, mode, moves, opts){
  opts = opts || {};
  const list = moves ? moves.split(' ') : [];
  return Object.assign({
    id, mode, modeName: mode, white: NAMES.w, black: NAMES.b,
    fen: opts.fen || 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    moves: list.join(' '), sans: opts.sans || [], ply: list.length, turn: list.length % 2 ? 'b' : 'w',
    lastMove: list[list.length - 1] || null, whiteMs: 1700000, blackMs: 1650000,
    lastMoveAt: Date.now(), startedAt: Date.now() - 100000, status: 'live', result: null, winner: null,
    termination: null, finishedAt: null, check: false
  }, opts);
}
const watchMsg = (g, next) => ({ t:'watch-game', id: g.id, at: Date.now(), game: g, next: next || null });

async function main(){
  console.log('\nThe cards');
  const p = makePage('/');
  await wait(10);
  const home = sockets[sockets.length - 1];            // the home page's live socket
  const g1 = snap('game-sighted-1', 'sighted', 'e2e4 e7e5', { sans:['e4','e5'] });
  p.liveUpdate({ t:'live-games', at: Date.now(), games: [g1, { mode:'total', status:'waiting' },
                 snap('game-blind-1', 'blind', ''), snap('game-fog-1', 'fog', 'd2d4', { sans:['d4'], turn:'b' })] });
  const html = p.liveGrid.innerHTML;
  check('a live card carries the game id', html.indexOf('data-id="game-sighted-1"') >= 0);
  check('...and is a button', /data-id="game-sighted-1"[^>]*role="button"/.test(html));
  const waiting = p.liveCardHTML({ mode:'total', status:'waiting' }, false);
  check('a waiting card carries no id', waiting.indexOf('data-id') < 0);
  check('...and is not a button', waiting.indexOf('role="button"') < 0 && waiting.indexOf('tabindex') < 0);
  const over = p.liveCardHTML(snap('game-x', 'fog', '', { status:'finished', result:'1-0', winner:'w', termination:'checkmate' }), false);
  check('a finished card is not a button either', over.indexOf('role="button"') < 0);
  check('the card names the players as the leaderboard does', html.indexOf('Arvenko') >= 0 && html.indexOf('LeoFromPrague') >= 0);
  check('...with nothing beside the names', !/bot|stockfish|cpu|engine/i.test(html.replace(/live-mode|live-card|live-seat|live-status/g, '')));

  console.log('\nOpening one');
  p.specOpen('game-sighted-1', true, 'sighted');
  await wait(10);
  const sock = sockets[sockets.length - 1];
  check('opening a card lands on the game screen', p.screen() === 'game');
  check('...as a spectator', p.SPECTATING() && p.SPEC.on && p.SPEC.id === 'game-sighted-1');
  check('...and the page says so', p.bodyHas('spectating'));
  check('...full screen: the home page is not shown', p.screen() !== 'home');
  check('...at /spectate/<id>', p.loc.pathname === '/spectate/game-sighted-1' && p.history.pushed[0] === '/spectate/game-sighted-1');
  check('...on a socket of its own, asking for that game by id', sock !== home && sock.sent[0].t === 'watch' && sock.sent[0].id === 'game-sighted-1', sock.sent);
  check('...and nothing else — no hello, no find, no join', sock.asked().join(',') === 'watch', sock.asked());
  sock.push(watchMsg(g1));
  check('the snapshot puts the moves on the board', p.G.uci.join(' ') === 'e2e4 e7e5' && p.G.sans.join(' ') === 'e4 e5', p.G.sans);
  check('...in the game\'s vision', p.G.mode === 'sighted');
  check('white below, as a viewer reads a board', p.G.flipped === false);
  check('the strips name the players', p.seatName('w') === 'Arvenko' && p.seatName('b') === 'LeoFromPrague');
  check('white\'s rating stands directly after white\'s name, before the colour', strip(p, 'barBottom').order === 'elo,sub' && strip(p, 'barBottom').elo === '2854', strip(p, 'barBottom'));
  check('black\'s rating stands directly after black\'s name', strip(p, 'barTop').order === 'elo,sub' && strip(p, 'barTop').elo === '2801', strip(p, 'barTop'));
  check('...each the ladder\'s figure from the snapshot, nothing invented', p.SPEC.game.white.rating === 2854 && p.SPEC.game.black.rating === 2801);
  check('the row between the strips shows the moves so far, oldest first', recent(p).map(m => m.san).join(' ') === 'e4 e5', recent(p));
  check('...with the newest lit', recent(p).map(m => m.lit).join(',') === 'false,true');
  check('the chips say what this is', p.text('setupChip').indexOf('Spectating') === 0 && p.text('visionChip') === 'Sighted', p.text('setupChip'));
  check('the clocks come from the snapshot', p.G.clock.w <= 1700000 && p.G.clock.w > 1690000 && p.G.clock.b === 1650000, p.G.clock);
  check('the setup form is not shown', p.doc.getElementById('gameSetup').style.display === 'none');

  console.log('\nLive updates');
  const g2 = snap('game-sighted-1', 'sighted', 'e2e4 e7e5 g1f3', { sans:['e4','e5','Nf3'], whiteMs:1690000 });
  sock.push(watchMsg(g2));
  check('a move arrives without a reload', p.G.uci.length === 3 && p.G.sans[2] === 'Nf3');
  check('...and the board is at that position', p.G.st.b[p.sqIndex('f3')] && p.G.st.b[p.sqIndex('f3')].t === 'N');
  check('...and the clocks with it', p.G.clock.b <= 1650000 && p.G.clock.w <= 1690000);
  check('the side to move is black', p.G.st.turn === 'b');
  check('the row follows the move, without a reload', recent(p).map(m => m.san).join(' ') === 'e4 e5 Nf3', recent(p));
  check('...three moves shown as three, nothing standing in for a fourth', recent(p).length === 3 && p.doc.getElementById('specMoves').innerHTML.indexOf('-') < 0);
  const g3 = snap('game-sighted-1', 'sighted', 'e2e4 e7e5 g1f3 b8c6 f1c4', { sans:['e4','e5','Nf3','Nc6','Bc4'] });
  sock.push(watchMsg(g3));
  check('two moves at once are both applied, in order', p.G.uci.join(' ') === g3.moves);
  check('the row keeps only the last four, in order, the oldest gone', recent(p).map(m => m.san).join(' ') === 'e5 Nf3 Nc6 Bc4', recent(p));
  check('...the newest lit and no other', recent(p).map(m => m.lit).join(',') === 'false,false,false,true');
  check('...in the game\'s own notation', p.G.sans.slice(-4).join(' ') === recent(p).map(m => m.san).join(' '));
  sock.push(watchMsg(g2));
  check('a snapshot that is not a continuation rebuilds the position', p.G.uci.join(' ') === g2.moves);
  check('...and the row with it', recent(p).map(m => m.san).join(' ') === 'e4 e5 Nf3', recent(p));

  console.log('\nView only');
  p.G.sel = -1;
  const sqClick = p.doc.getElementById('squares').listeners.click[0];
  const fake = { target: { closest: () => ({ dataset: { sq: String(p.sqIndex('e4')) } }) } };
  sqClick(fake);
  check('a click on the board selects nothing', p.G.sel === -1);
  check('resign and draw are not possible', p.canConcede() === false);
  check('the move box is off', p.el.moveInput.disabled === true);
  check('nothing the page has sent is a game action', sock.asked().every(t => t === 'watch'), sock.asked());
  const before = p.G.uci.length;
  p.G.clock[p.G.st.turn] = 0;
  check('a flag at zero declares nothing', p.G.over === null);

  console.log('\nThe end');
  const fin = snap('game-sighted-1', 'sighted', 'e2e4 e7e5 g1f3', { sans:['e4','e5','Nf3'], status:'finished', result:'1-0', winner:'w', termination:'resignation' });
  sock.push(watchMsg(fin));
  check('the result box is up', p.up('endOverlay'));
  check('...saying who won', p.text('endTitle') === 'White Wins', p.text('endTitle'));
  check('...and how', p.text('endText') === 'Black resigned.', p.text('endText'));
  check('...with the way home', p.text('endNew') === 'Back to Home');
  check('...and no next game yet', p.doc.getElementById('endRematch').style.display === 'none');
  check('...and no Study Board', p.doc.getElementById('endClose').style.display === 'none');
  check('the board is revealed', p.G.over && p.G.revealed);
  sock.push(watchMsg(fin, 'game-sighted-2'));
  check('the next game, once there is one, is offered', p.doc.getElementById('endRematch').style.display === '' && p.text('endRematch') === 'Watch Next Live Game');
  check('...and not entered on its own', p.SPEC.id === 'game-sighted-1');
  p.press('endRematch');
  await wait(10);
  const sock2 = sockets[sockets.length - 1];
  check('pressing it watches the next game by id', p.SPEC.id === 'game-sighted-2' && sock2.sent[0].id === 'game-sighted-2');
  check('...the old socket let go, with an unwatch', sock.closed && sock.sent[sock.sent.length - 1].t === 'unwatch');
  check('...on the same screen', p.screen() === 'game' && p.SPECTATING());
  const t1 = snap('game-sighted-2', 'total', 'd2d4', { sans:['d4'] });
  sock2.push(watchMsg(t1));

  console.log('\nEach vision');
  check('Complete Blindfold shows the console and no board', p.G.mode === 'total' && p.el.console.classList.contains('show') && p.el.boardFrame.style.display === 'none');
  check('...with the players named in it', p.el.log.children.some(c => /Arvenko \(2854\)/.test(c.textContent)), p.el.log.children.map(c => c.textContent));
  check('...and the move written there', p.el.log.children.some(c => /d4/.test(c.textContent)));
  check('...and in the row between the strips: one move, shown as one', recent(p).map(m => m.san).join(' ') === 'd4' && recent(p).length === 1, recent(p));
  const pf = makePage('/'); await wait(5); pf.specOpen('game-fog-1', true, 'fog'); await wait(5);
  sockets[sockets.length - 1].push(watchMsg(snap('game-fog-1', 'fog', 'd2d4', { sans:['d4'] })));
  check('Fog of War is drawn as fog', pf.G.mode === 'fog' && pf.board.classList.contains('fog'));
  check('...from the chair of the side to move', pf.G.human === 'b' && pf.G.st.turn === 'b');
  check('...and its row shows the move', recent(pf).map(m => m.san).join(' ') === 'd4', recent(pf));
  const pb = makePage('/'); await wait(5); pb.specOpen('game-blind-1', true, 'blind'); await wait(5);
  sockets[sockets.length - 1].push(watchMsg(snap('game-blind-1', 'blind', '')));
  check('Board Only hides the men', pb.G.mode === 'blind' && pb.board.classList.contains('blind') && !pb.board.classList.contains('fog'));
  check('...and before the first move its row is empty — no placeholder', recent(pb).length === 0 && pb.doc.getElementById('specMoves').innerHTML === '', pb.doc.getElementById('specMoves').innerHTML);
  sockets[sockets.length - 1].push(watchMsg(snap('game-blind-1', 'blind', 'e2e4', { sans:['e4'] })));
  check('...and after it, that move', recent(pb).map(m => m.san).join(' ') === 'e4', recent(pb));
  check('the row is there for a spectator only', /body\.spectating #specMoves\{display:grid;\}/.test(SRC) && /#specMoves\{\s*display:none;/.test(SRC));
  check('...four columns on one row, no wrapping', /#specMoves\{[^}]*grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/.test(SRC));
  check('...that the board pays for in height', /body\.spectating \.game-layout\{--board-max:min\(100%, calc\(100vh - var\(--chrome\) - 45px\)\);\}/.test(SRC));
  check('Sighted shows everything', !p.board.classList.contains('blind') || p.G.mode !== 'sighted');

  console.log('\nBack');
  const savedMinutes = pb.G.minutes;
  pb.press('btnMenu');
  check('the logo returns to the home page', pb.screen() === 'home');
  check('...no longer spectating', !pb.SPEC.on && !pb.SPECTATING() && !pb.bodyHas('spectating'));
  check('...at /', pb.loc.pathname === '/');
  check('...with the socket closed and an unwatch sent, nothing more', (() => { const s = sockets.find(x => x.sent[0] && x.sent[0].id === 'game-blind-1'); return s.closed && s.sent.map(m=>m.t).join(',') === 'watch,unwatch'; })());
  check('...and the board handed back to the player', pb.G.opponent === 'bot' && pb.G.started === false && pb.G.uci.length === 0);
  check('...with the end box put back as it was', pb.text('endNew') === 'New Game' && pb.text('endRematch') === 'Rematch');
  check('...without asking', !pf.up('leaveOverlay'));
  pf.press('btnMenu');
  check('there is no separate Back button', pf.doc.getElementById('specBack').onclick === null);
  p.press('endNew');
  check('leaving from the result box\'s Back to Home works too', p.screen() === 'home' && !p.up('endOverlay'));

  console.log('\nA direct link, and a refresh');
  const pr = makePage('/spectate/game-fog-1');
  await wait(10);
  const rs = sockets[sockets.length - 1];
  check('/spectate/<id> boots into that game', pr.screen() === 'game' && pr.SPEC.id === 'game-fog-1' && rs.sent[0].id === 'game-fog-1');
  check('...without touching the history', pr.history.pushed.length === 0);
  rs.push(watchMsg(snap('game-fog-1', 'fog', 'd2d4 d7d5 c2c4', { sans:['d4','d5','c4'], status:'finished', result:'1/2-1/2', termination:'draw by agreement' })));
  check('a link to a finished game shows how it ended', pr.up('endOverlay') && pr.text('endTitle') === 'Draw' && pr.text('endText') === 'Drawn by agreement.');
  check('...with the final position on the board', pr.G.uci.length === 3 && pr.G.revealed);
  const pm = makePage('/spectate/gone');
  await wait(10);
  sockets[sockets.length - 1].push({ t:'watch-game', id:'gone', at: Date.now(), game: null, next: null });
  check('a game the server has no record of says so', pm.up('endOverlay') && pm.text('endTitle') === 'Game Not Found');
  const po = makePage('/spectate/x1');
  await wait(10);
  sockets[sockets.length - 1].push({ t:'watch-game', id:'x1', at: Date.now(), game: null, next: null, off: true, note: 'The server has no chess engine, so the AI league cannot run.' });
  check('...and a server not running the league says that', pm.up('endOverlay') && po.text('endTitle') === 'Not Running' && /engine/.test(po.text('endText')));
  // popstate: the browser's back from a spectator page
  const pp = makePage('/'); await wait(5); pp.specOpen('game-sighted-1', true, 'sighted'); await wait(5);
  pp.loc.pathname = '/';
  for (const f of pp.win.popstate) f();
  check('the browser\'s back leaves the game', pp.screen() === 'home' && !pp.SPEC.on);

  console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
  process.exit(failed ? 1 : 0);
}
main().catch(e => { console.log('FAIL ' + (e.stack || e)); process.exit(1); });
