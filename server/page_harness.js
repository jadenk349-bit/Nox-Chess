/* A whole copy of blind-chess.html, held up by a dumb DOM shim, on a real
 * socket to a real server. This is the harness test_rematch_e2e.js was
 * written around, lifted out so test_challenge_e2e.js can boot the same page
 * the same way instead of carrying a second copy of the shim — two shims is
 * two ways for a test to be holding the page up differently from the other.
 *
 * The shim is deliberately dumb — every element answers to everything and
 * remembers only what it is asked to. It is not pretending to be a browser;
 * it is holding the page up long enough for the game logic, which is the
 * part with the bugs in it, to run for real.
 *
 * REQUIRES a running server, pointed at with WS_TEST_HOST / PORT. A test
 * that needs signed-in accounts on both ends (a friend challenge is one)
 * mints HS256 tokens with mintToken(), which reads the same
 * SUPABASE_JWT_SECRET the server does — set on the server *and* on the
 * test, as test_two_clients.py does — and, with no secret, answers null so
 * the page plays as a guest and such a test can say it is skipping.
 */
const fs = require('fs');
const crypto = require('crypto');
const PAGE = require('path').join(__dirname, '..', 'blind-chess.html');
const SRC = fs.readFileSync(PAGE, 'utf8');
const HTML = SRC.split('<script>')[0];
const BODY = SRC.match(/<script>\n"use strict";([\s\S]*?)<\/script>/)[1];
const IDS = [...HTML.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
const HOST = process.env.WS_TEST_HOST || '127.0.0.1';
const PORT = process.env.PORT || '8787';

/** PASS/FAIL counters, one set per suite. */
function counter(){
  let passed = 0, failed = 0;
  const check = (label, ok, detail) => {
    if (ok){ passed++; console.log('  PASS  ' + label); }
    else { failed++; console.log('  FAIL  ' + label + (detail === undefined ? '' : '  ' + detail)); }
  };
  /** Prints the tally and returns how many failed. */
  const summary = () => { console.log('\n' + passed + ' passed, ' + failed + ' failed\n'); return failed; };
  return { check, summary };
}

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
    removeAttribute(){}, hasAttribute(){ return false; }, contains(){ return false; },
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
  // Everything a test reaches into, by the page's own names. `fakeAuth` is
  // the one thing that is not a name the page has: a test standing in for
  // Supabase has to be able to hand the page a session (whose access_token
  // goes out on `hello`) and an account, and both are `let`s in the page's
  // own scope, so the setter has to be written there.
  const src = '"use strict";' + BODY.replace(/await import\([^)]*\)/g, 'await Promise.reject(new Error("no cdn"))') +
    '\n__expose({ G, NET, REM, RANK, CHAL, chosen, picked, el, netConnect, netSend, showScreen, rematchTerms,' +
    ' startRanked, applyRankSettings, rankReady, netClose, hostGame, socialConnect, challengeFriend,' +
    ' selectMode, pickBotTime, pickFriendMode, pickFriendTime, startGame, unanswered, tryMove,' +
    ' screen:()=>screenName, resume:()=>rankResume,' +
    ' fakeAuth:(session, acc)=>{ authSession = session; account = acc; } });';
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

/* A signed HS256 token for a test account, the shape test_two_clients.py
   mints: the same secret, the same claims, so the server reads it the same
   way. `who` becomes the account id `test-<who>` and the name `Tester <who>`
   — or the name given, since a challenge is read by name on the other
   player's screen. Null with no secret, which is the page playing as a
   guest. */
function mintToken(who, name){
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!secret) return null;
  const project = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const seg = raw => Buffer.from(raw).toString('base64url');
  const header = seg(JSON.stringify({ alg:'HS256', typ:'JWT' }));
  const claims = seg(JSON.stringify({
    sub: 'test-' + who, aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 600,
    iss: project ? project + '/auth/v1' : null,
    user_metadata: { full_name: name || ('Tester ' + who) }
  }));
  const sig = seg(crypto.createHmac('sha256', secret).update(header + '.' + claims).digest());
  return header + '.' + claims + '.' + sig;
}

/** Sign a page in as a test account, the way setAccount() would have. */
function signIn(page, who, name){
  const token = mintToken(who, name);
  const id = 'test-' + who;
  page.fakeAuth(token ? { access_token: token, user: { id, user_metadata: { full_name: name } } } : null,
                { id, gameName: name, name, avatar: '', rating: 100, tier: 'bronze', puzzleRating: 100 });
  page.G.playerName = name;
  return id;
}

const wait = ms => new Promise(r => setTimeout(r, ms));
/** Wait for something to become true, or give up. */
async function until(cond, ms = 4000){
  const stop = Date.now() + ms;
  while (Date.now() < stop){ if (cond()) return true; await wait(25); }
  return false;
}

/** Is there a server to talk to? Says how to start one and exits if not. */
async function probe(){
  try {
    await new Promise((ok, no) => {
      const p = require('net').createConnection({ host:HOST, port:+PORT }, () => { p.end(); ok(); });
      p.on('error', no);
      p.setTimeout(2000, () => { p.destroy(); no(new Error('timed out')); });
    });
  } catch (e){
    console.log('No server on ' + HOST + ':' + PORT +
                ' — start it with: python3 server/server.py');
    process.exit(1);
  }
}

module.exports = { makePage, until, wait, HOST, PORT, probe, counter, mintToken, signIn };
