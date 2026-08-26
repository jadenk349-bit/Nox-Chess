/* Two whole copies of blind-chess.html, on real sockets, against the real
 * server. Nothing is stubbed but the browser.
 *
 * The other suites each take one side. test_two_clients.py proves the server's
 * half of the rematch — who may ask, who may answer, that a request tied to
 * the wrong game never starts one. test_rematch_flow.js proves the page's half
 * against scripted replies. Neither can catch the two halves disagreeing, and
 * a rematch is nothing but the two halves agreeing: this runs the real page
 * script, in two independent copies, over two real WebSockets, and presses the
 * real buttons.
 *
 * The DOM shim below is deliberately dumb — every element answers to
 * everything and remembers only what it is asked to. It is not pretending to
 * be a browser; it is holding the page up long enough for the game logic,
 * which is the part with the bugs in it, to run for real.
 *
 * REQUIRES a running server, like test_two_clients.py:
 *
 *   python3 server/server.py &
 *   node server/test_rematch_e2e.js
 *
 * Point it elsewhere with WS_TEST_HOST / PORT.
 */
const fs = require('fs');
const PAGE = require('path').join(__dirname, '..', 'blind-chess.html');
const SRC = fs.readFileSync(PAGE, 'utf8');
const HTML = SRC.split('<script>')[0];
const BODY = SRC.match(/<script>\n"use strict";([\s\S]*?)<\/script>/)[1];
const IDS = [...HTML.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
const HOST = process.env.WS_TEST_HOST || '127.0.0.1';
const PORT = process.env.PORT || '8787';

let passed = 0, failed = 0;
const check = (label, ok, detail) => {
  if (ok){ passed++; console.log('  PASS  ' + label); }
  else { failed++; console.log('  FAIL  ' + label + (detail === undefined ? '' : '  ' + detail)); }
};

function classSet(){
  const have = new Set();
  return { add:c=>have.add(c), remove:c=>have.delete(c),
           toggle:(c,on)=>{ if (on===undefined) have.has(c)?have.delete(c):have.add(c); else on?have.add(c):have.delete(c); },
           contains:c=>have.has(c) };
}
function mk(tag){
  const e = {
    tagName:(tag||'div').toUpperCase(), textContent:'', innerHTML:'', value:'', className:'',
    disabled:false, checked:false, style:{}, dataset:{}, children:[], parentElement:null,
    offsetWidth:100, onclick:null, onsubmit:null, classList:classSet(),
    appendChild(c){ this.children.push(c); c.parentElement = this; return c; },
    removeChild(c){ return c; }, remove(){}, setAttribute(){}, getAttribute(){ return null; },
    addEventListener(){}, removeEventListener(){}, focus(){}, blur(){}, click(){ this.onclick && this.onclick(); },
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
  return {
    getElementById: id => pool[id] || (pool[id] = mk()),
    querySelector: qs, querySelectorAll: () => [], createElement: mk, createElementNS: mk,
    addEventListener(){}, removeEventListener(){}, body: mk(), documentElement: mk(), head: mk()
  };
}

const AudioCtx = function(){
  return { createOscillator:()=>({ connect(){}, start(){}, stop(){}, frequency:{ setValueAtTime(){} }, type:'' }),
           createGain:()=>({ connect(){}, gain:{ setValueAtTime(){}, exponentialRampToValueAtTime(){}, linearRampToValueAtTime(){} } }),
           destination:{}, currentTime:0, resume:()=>Promise.resolve(), state:'running' }; };

/** One whole page, with its own DOM and its own socket. */
function makePage(){
  const doc = makeDoc();
  const loc = { protocol:'http:', host:HOST + ':' + PORT, href:'http://' + HOST + ':' + PORT + '/', hash:'', search:'' };
  const store = {};
  const storage = { getItem:k => (k in store ? store[k] : null),
                    setItem:(k,v)=>{ store[k] = String(v); }, removeItem:k => { delete store[k]; } };
  const win = { addEventListener(){}, removeEventListener(){}, scrollTo(){},
                matchMedia:()=>({ matches:false, addEventListener(){}, addListener(){} }),
                innerWidth:1200, innerHeight:900, devicePixelRatio:1, location:loc, localStorage:storage };
  let out = null;
  const src = '"use strict";' + BODY.replace(/await import\([^)]*\)/g, 'await Promise.reject(new Error("no cdn"))') +
    '\n__expose({ G, NET, REM, RANK, el, netConnect, netSend, showScreen, rematchTerms,' +
    ' startRanked, applyRankSettings, rankReady, netClose, hostGame,' +
    ' screen:()=>screenName, resume:()=>rankResume });';
  new Function('document','window','location','localStorage','WebSocket','AudioContext',
               'webkitAudioContext','fetch','Image','requestAnimationFrame','cancelAnimationFrame',
               'getComputedStyle','navigator','console','__expose', src)(
    doc, win, loc, storage, WebSocket, AudioCtx, AudioCtx,
    () => Promise.resolve({ ok:false, status:404, json:()=>Promise.resolve(null), text:()=>Promise.resolve('') }),
    mk, cb => setTimeout(()=>cb(Date.now()), 16), clearTimeout,
    () => ({ getPropertyValue: () => '' }), { userAgent:'node' },
    { log(){}, warn(){}, error(){} }, o => { out = o; });
  out.doc = doc;
  out.press = id => doc.getElementById(id).onclick();
  out.up = id => doc.getElementById(id).classList.contains('show');
  out.text = id => doc.getElementById(id).textContent;
  return out;
}

const wait = ms => new Promise(r => setTimeout(r, ms));
/** Wait for something to become true, or give up. */
async function until(cond, ms = 4000){
  const stop = Date.now() + ms;
  while (Date.now() < stop){ if (cond()) return true; await wait(25); }
  return false;
}

/** Two pages, matched into one friendly game and played to a finish. */
async function seated(mode = 'sighted', minutes = 5, inc = 0, kind = 'friendly'){
  const a = makePage(), b = makePage();
  for (const p of [a, b]){
    p.G.opponent = 'online'; p.G.matchKind = kind;
    p.G.mode = mode; p.G.minutes = minutes; p.G.inc = inc;
  }
  a.netConnect(() => a.netSend({ t:'find', mode, minutes, inc, kind }));
  await until(() => a.NET.state === 'waiting' || a.NET.sock);
  await wait(200);
  b.netConnect(() => b.netSend({ t:'find', mode, minutes, inc, kind }));
  const paired = await until(() => a.NET.gameId && b.NET.gameId && a.NET.gameId === b.NET.gameId);
  if (!paired) throw new Error('the two pages were never matched');
  return [a, b];
}

/* A ranked pair, arranged the way the ranked page arranges one: the two
   answers the settings box takes, and then its Start Game. Nothing about the
   game is set by hand, which is the point — the ranked screen's own entry is
   the code path New Game has to come back into. */
async function ranked(mode = 'fog', minutes = 3, inc = 2){
  const a = makePage(), b = makePage();
  for (const p of [a, b]){ p.RANK.mode = mode; p.RANK.minutes = minutes; p.RANK.inc = inc; }
  a.startRanked();
  await wait(250);
  b.startRanked();
  const paired = await until(() => a.NET.gameId && b.NET.gameId && a.NET.gameId === b.NET.gameId);
  if (!paired) throw new Error('the two ranked pages were never matched');
  return [a, b];
}

async function finished(a, b){
  a.netSend({ t:'resign' });
  const done = await until(() => a.G.over && b.G.over);
  if (!done) throw new Error('the game never ended');
  return done;
}

async function main(){
  try {
    await new Promise((ok, no) => {
      const probe = require('net').createConnection({ host:HOST, port:+PORT }, () => { probe.end(); ok(); });
      probe.on('error', no);
      probe.setTimeout(2000, () => { probe.destroy(); no(new Error('timed out')); });
    });
  } catch (e){
    console.log('No server on ' + HOST + ':' + PORT +
                ' — start it with: python3 server/server.py');
    process.exit(1);
  }

  console.log('\nA whole friendly game, and a rematch of it');
  let [a, b] = await seated('sighted', 40);
  const first = a.NET.gameId;
  const aWas = a.G.human, bWas = b.G.human;
  check('two pages are matched into one game', a.NET.gameId === b.NET.gameId, a.NET.gameId);
  check('and take opposite colours', aWas !== bWas, aWas + '/' + bWas);
  check('both are on the game screen', a.screen() === 'game' && b.screen() === 'game');

  await finished(a, b);
  check('the end-of-game box opens on both sides', a.up('endOverlay') && b.up('endOverlay'));
  check('and offers a rematch', a.doc.getElementById('endRematch').style.display !== 'none');

  a.press('endRematch');
  check('pressing it does not start a game', a.NET.gameId === first && a.screen() === 'game');
  check('it says it is waiting', a.up('rematchOverlay') &&
        a.doc.getElementById('rematchOverlay').dataset.mode === 'wait');
  const asked = await until(() => b.up('rematchOverlay'));
  check('and the opponent is asked', asked);
  check('by name, on their screen', /requested a rematch/.test(b.text('rematchTitle')),
        b.text('rematchTitle'));
  check('with Accept and Decline in front of them',
        b.doc.getElementById('rematchAccept').style.display !== 'none' &&
        b.text('rematchDecline') === '✕ Decline', b.text('rematchDecline'));

  console.log('\nDeclining');
  b.press('rematchDecline');
  const told = await until(() => a.doc.getElementById('rematchOverlay').dataset.mode === 'info');
  check('the asker is told', told && /rather not play again/.test(a.text('rematchText')),
        a.text('rematchText'));
  check('no game starts', a.NET.gameId === first && b.NET.gameId === first);
  check('and both are still on the finished game',
        a.screen() === 'game' && b.screen() === 'game' && a.G.over && b.G.over);
  check('the opponent is back to the post-game box, with nothing in front of it',
        !b.up('rematchOverlay') && b.up('endOverlay'));

  console.log('\nAccepting');
  a.press('endRematch');
  await until(() => b.up('rematchOverlay'));
  b.press('rematchAccept');
  const restarted = await until(() => a.NET.gameId !== first && b.NET.gameId !== first);
  check('a new game starts for both', restarted && a.NET.gameId === b.NET.gameId,
        a.NET.gameId + ' / ' + b.NET.gameId);
  check('and it is a different game', a.NET.gameId !== first);
  check('colours swap', a.G.human !== aWas && b.G.human !== bWas,
        aWas + '->' + a.G.human + ', ' + bWas + '->' + b.G.human);
  check('the settings are the ones just played on',
        a.G.mode === 'sighted' && a.G.minutes === 40 && a.G.matchKind === 'friendly');
  check('the board is reset', a.G.sans.length === 0 && a.G.uci.length === 0 && a.G.over === null);
  check('the clocks are back to full', a.G.clock.w === 40 * 60000 && a.G.clock.b === 40 * 60000);
  check('every box is down', !a.up('endOverlay') && !a.up('rematchOverlay') &&
        !b.up('endOverlay') && !b.up('rematchOverlay'));
  check('and the game is playable again', a.G.started && b.G.started &&
        a.screen() === 'game' && b.screen() === 'game');

  console.log('\nThe result of the rematch is still reported');
  await finished(b, a);
  check('resigning the rematch ends it for both', !!a.G.over && !!b.G.over);
  a.netClose && a.netClose();

  console.log('\nBoth press Rematch at the same moment');
  let [c, d] = await seated('fog', 41);
  const before = c.NET.gameId;
  await finished(c, d);
  c.press('endRematch');
  d.press('endRematch');
  const one = await until(() => c.NET.gameId !== before && d.NET.gameId !== before);
  check('exactly one game comes of it', one && c.NET.gameId === d.NET.gameId,
        c.NET.gameId + ' / ' + d.NET.gameId);
  check('and neither is left with a box up',
        !c.up('rematchOverlay') && !d.up('rematchOverlay'));

  console.log('\nAn opponent who leaves');
  let [e, f] = await seated('blind', 42);
  await finished(e, f);
  e.press('endRematch');
  await until(() => f.up('rematchOverlay'));
  f.NET.sock.close();
  const gone = await until(() => e.doc.getElementById('rematchOverlay').dataset.mode === 'info', 6000);
  check('the asker is told there is nobody left', gone && /no longer there/.test(e.text('rematchText')),
        e.text('rematchText'));
  check('and no game was started', !!e.G.over);

  console.log('\nNew Game, after a friendly game');
  let [g, h] = await seated('blind', 43);
  await finished(g, h);
  g.press('endNew');
  check('goes to the friendly match page', g.screen() === 'rooms', g.screen());
  check('and not to the page that used to ask who you are playing',
        g.screen() !== 'opponent');

  console.log('\nRanked, arranged by the ranked page itself');
  let [r1, r2] = await ranked('fog', 3, 2);
  const rFirst = r1.NET.gameId;
  const r1Was = r1.G.human, r2Was = r2.G.human;
  check('the ranked page seats both players', r1.NET.gameId === r2.NET.gameId);
  check('and the game knows it is ranked',
        r1.G.matchKind === 'ranked' && r2.G.matchKind === 'ranked');
  check('on the settings the page was told', r1.G.mode === 'fog' && r1.G.minutes === 3 && r1.G.inc === 2);

  await finished(r1, r2);
  check('the end-of-game box offers a ranked rematch',
        r1.up('endOverlay') && r1.doc.getElementById('endRematch').style.display !== 'none');

  console.log('\nRanked rematch — declined');
  r1.press('endRematch');
  check('nothing starts on pressing it', r1.NET.gameId === rFirst);
  const rAsked = await until(() => r2.up('rematchOverlay'));
  check('the opponent is asked', rAsked && /requested a rematch/.test(r2.text('rematchTitle')),
        r2.text('rematchTitle'));
  check('and told it is a ranked game they would be agreeing to',
        /Ranked/.test(r2.text('rematchText')), r2.text('rematchText'));
  r2.press('rematchDecline');
  const toldNo = await until(() => r1.doc.getElementById('rematchOverlay').dataset.mode === 'info');
  check('the asker is told it was declined', toldNo && /rather not play again/.test(r1.text('rematchText')),
        r1.text('rematchText'));
  check('no game begins', r1.NET.gameId === rFirst && r2.NET.gameId === rFirst);
  check('and both stay on the finished ranked game',
        r1.screen() === 'game' && r2.screen() === 'game' && !!r1.G.over && !!r2.G.over);

  console.log('\nRanked rematch — accepted');
  r1.press('endRematch');
  await until(() => r2.up('rematchOverlay'));
  r2.press('rematchAccept');
  const rAgain = await until(() => r1.NET.gameId !== rFirst && r2.NET.gameId !== rFirst);
  check('both enter one new game', rAgain && r1.NET.gameId === r2.NET.gameId,
        r1.NET.gameId + ' / ' + r2.NET.gameId);
  check('and it is still ranked',
        r1.G.matchKind === 'ranked' && r2.G.matchKind === 'ranked');
  check('on the ranked settings just played on',
        r1.G.mode === 'fog' && r1.G.minutes === 3 && r1.G.inc === 2);
  check('colours swap', r1.G.human !== r1Was && r2.G.human !== r2Was,
        r1Was + '->' + r1.G.human + ', ' + r2Was + '->' + r2.G.human);
  check('the board is empty again', r1.G.sans.length === 0 && r1.G.uci.length === 0);
  check('the clocks are reset', r1.G.clock.w === 3 * 60000 && r1.G.clock.b === 3 * 60000);
  check('game-over state is cleared', r1.G.over === null && r2.G.over === null);
  check('every box is down', !r1.up('endOverlay') && !r1.up('rematchOverlay') &&
        !r2.up('endOverlay') && !r2.up('rematchOverlay'));
  check('and the result of the rematch can still be reported',
        r1.NET.reported === false && r2.NET.reported === false);
  await finished(r1, r2);
  check('which it is', !!r1.G.over && !!r2.G.over);

  console.log('\nRanked New Game');
  r1.press('endNew');
  check('lands on the ranked page, not in a game', r1.screen() === 'ranked', r1.screen());
  check('with the settings that game was played on',
        r1.RANK.mode === 'fog' && r1.RANK.minutes === 3 && r1.RANK.inc === 2,
        JSON.stringify(r1.RANK));
  check('and the settings button says so rather than asking again',
        /Fog of War/.test(r1.text('btnRankPick')) && /3\+2/.test(r1.text('btnRankPick')),
        r1.text('btnRankPick'));
  check('the page names the game it is about to look for',
        /Fog of War/.test(r1.text('rankNote')) && /3\+2/.test(r1.text('rankNote')),
        r1.text('rankNote'));
  check('no game has been created with the last opponent',
        r1.NET.gameId === null && r1.screen() === 'ranked',
        'game=' + r1.NET.gameId + ' net=' + r1.NET.state);
  check('nothing of the finished game came along',
        r1.G.over === null && r1.G.started === false && r1.G.sans.length === 0 &&
        r1.NET.state !== 'playing' && r1.NET.oppGone === false,
        'net=' + r1.NET.state);
  check('the page is still there a moment later, to be read',
        r1.screen() === 'ranked');

  const queued = await until(() => r1.NET.state === 'waiting', 3000);
  check('then matchmaking begins by itself, with no second press', queued, r1.NET.state);
  check('without leaving the ranked page to do it', r1.screen() === 'ranked', r1.screen());
  check('and with no centred box thrown over it', !r1.up('waitOverlay'));
  check('the Start Game button is the indicator',
        r1.doc.getElementById('btnRankStart').classList.contains('searching') &&
        r1.text('btnRankStart') === 'Finding an Opponent', r1.text('btnRankStart'));

  // a stranger on the same time control is who the queue should hand over
  const r3 = makePage();
  r3.RANK.mode = 'fog'; r3.RANK.minutes = 3; r3.RANK.inc = 2;
  r3.startRanked();
  const met = await until(() => r1.NET.gameId && r3.NET.gameId && r1.NET.gameId === r3.NET.gameId, 5000);
  check('the automatic search is matched normally', met, r1.NET.gameId + ' / ' + r3.NET.gameId);
  check('with the stranger rather than the opponent just played',
        met && r2.NET.gameId !== r1.NET.gameId, 'r2=' + r2.NET.gameId);
  check('and the new ranked game is ranked, on the same settings',
        r1.G.matchKind === 'ranked' && r1.G.mode === 'fog' && r1.G.minutes === 3 && r1.G.inc === 2);
  check('with no trace of the last one',
        r1.G.sans.length === 0 && r1.G.over === null && r1.NET.reported === false &&
        r1.REM.pending === false && r1.REM.incoming === null);

  console.log('\nThe search is a state of the button that starts it');
  const m1 = makePage();
  m1.showScreen('ranked');              // where Start Game is pressed from
  m1.applyRankSettings({ mode:'sighted', minutes:45, inc:0 });
  m1.startRanked();
  check('pressing Start Game stays on the ranked page', m1.screen() === 'ranked', m1.screen());
  check('and opens no box at all',
        !m1.up('waitOverlay') && !m1.up('rematchOverlay') && !m1.up('endOverlay'));
  check('the button sweeps instead',
        m1.doc.getElementById('btnRankStart').classList.contains('searching'));
  check('says what it is doing', m1.text('btnRankStart') === 'Finding an Opponent',
        m1.text('btnRankStart'));
  check('and is not dim while it does it',
        !m1.doc.getElementById('btnRankStart').classList.contains('dim'));
  check('the settings cannot be changed out from under the queue',
        m1.doc.getElementById('screen-ranked').classList.contains('searching'));
  const mQueued = await until(() => m1.NET.state === 'waiting');
  check('the server has it queued', mQueued, m1.NET.state);
  // the server says {t:"waiting"} at that point, and it must not raise a box
  await wait(300);
  check('the server saying so does not raise one either', !m1.up('waitOverlay'));

  m1.press('btnRankStart');
  check('pressing it again gives the search up',
        !m1.doc.getElementById('btnRankStart').classList.contains('searching') &&
        m1.text('btnRankStart') === 'Start Game', m1.text('btnRankStart'));
  check('and leaves the player on the page with the settings still answered',
        m1.screen() === 'ranked' && m1.RANK.minutes === 45, JSON.stringify(m1.RANK));
  const nobody = makePage();
  nobody.showScreen('ranked');
  nobody.applyRankSettings({ mode:'sighted', minutes:45, inc:0 });
  nobody.startRanked();
  await wait(600);
  check('a cancelled search really has left the queue',
        !nobody.NET.gameId, 'game=' + nobody.NET.gameId);
  nobody.press('btnRankStart');

  console.log('\nFriendly is untouched by any of it');
  let [f1, f2] = await seated('blind', 44);
  await finished(f1, f2);
  f1.press('endRematch');
  await until(() => f2.up('rematchOverlay'));
  check('a friendly rematch still says nothing about ranking',
        !/Ranked/.test(f2.text('rematchText')), f2.text('rematchText'));
  f2.press('rematchAccept');
  check('and still starts a friendly game',
        await until(() => f1.G.matchKind === 'friendly' && f1.NET.gameId === f2.NET.gameId));
  await finished(f1, f2);
  f1.press('endNew');
  check('friendly New Game still goes to the room list', f1.screen() === 'rooms', f1.screen());

  const h1 = makePage();
  h1.G.opponent = 'online'; h1.G.hosting = true;
  h1.G.mode = 'blind'; h1.G.minutes = 46; h1.G.inc = 0;
  h1.hostGame();
  await until(() => h1.NET.myRoom);
  check('hosting a friendly room still sweeps its own Start Play button',
        h1.doc.getElementById('btnStart').classList.contains('searching') &&
        h1.text('btnStart') === 'Finding an Opponent', h1.text('btnStart'));
  check('and still shows the note under it that explains it',
        h1.doc.getElementById('matchNote').style.display === 'block');
  check('without a centred box', !h1.up('waitOverlay'));
  // Take the room back off the list before leaving. The suites share a server,
  // and a room outliving this run is one the next run's watcher can see.
  h1.netSend({ t:'unhost' });
  await wait(200);

  console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
  await wait(200);            // let the server see the sockets go
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.log('\nERROR: ' + e.message); console.log(e.stack); process.exit(1); });
