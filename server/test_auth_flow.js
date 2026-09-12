/* The four doors into an account, without a browser and without Supabase.
 *
 * Google, Apple, Facebook and an email address with a password all end in
 * the same Supabase user, and the page's half of that — which call each
 * button makes, what each form refuses before asking, what a failure is
 * allowed to say, where a confirmation link and a reset link land — is what
 * this suite drives. It boots the whole page script under a dumb DOM shim,
 * as test_rematch_e2e.js does, hands it a scripted stand-in for the Supabase
 * client in place of the CDN import, and presses the real buttons.
 *
 * What it holds the page to:
 *   · Google's call is the one it has always been: provider google, the
 *     page's own address as redirectTo, prompt=select_account
 *   · Apple and Facebook make the same call with their own names, and a
 *     provider the project has not switched on is refused on the page with
 *     a sentence rather than sent to a bare Supabase error
 *   · the email forms judge the address, the length and the match before
 *     asking; a wrong password says one safe sentence; the password never
 *     reaches the console
 *   · sign-up sends the confirmation link back to this page, and an address
 *     that already has an account gets the same panel
 *   · a reset link opens the New Password screen before the username step
 *     and before the home page, and a link that did not work is explained on
 *     the log-in page
 *   · a returning Google user with a username lands on the home page with
 *     nothing written to profiles; a new account by any door — Apple with no
 *     name at all — is sent to choose a username
 *   · the markup carries the six buttons, the divider and the two links the
 *     design asks for, and the source carries no secret
 *
 *   node server/test_auth_flow.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'blind-chess.html'), 'utf8');
const BODY = HTML.slice(HTML.lastIndexOf('<script>') + 8, HTML.lastIndexOf('</script>'));
const IDS = [...HTML.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);

let passed = 0, failed = 0;
const check = (label, ok, detail) => {
  if (ok){ passed++; console.log('  PASS  ' + label); }
  else { failed++; console.log('  FAIL  ' + label + (detail === undefined ? '' : '  ' + detail)); }
};
const tick = () => new Promise(r => setTimeout(r, 0));
async function settle(n){ for (let i = 0; i < (n || 8); i++) await tick(); }

/* ---- the DOM shim ---- */
function classSet(){
  const have = new Set();
  return { add:c=>have.add(c), remove:c=>have.delete(c),
           toggle:(c,on)=>{ if (on===undefined) have.has(c)?have.delete(c):have.add(c); else on?have.add(c):have.delete(c); },
           contains:c=>have.has(c) };
}
function mk(tag){
  const listeners = {};
  const e = {
    tagName:(tag||'div').toUpperCase(), textContent:'', innerHTML:'', value:'', className:'',
    disabled:false, checked:false, hidden:false, style:{}, dataset:{}, children:[], parentElement:null,
    offsetWidth:100, onclick:null, onsubmit:null, classList:classSet(),
    appendChild(c){ this.children.push(c); c.parentElement = this; return c; },
    removeChild(c){ return c; }, remove(){}, setAttribute(){}, getAttribute(){ return null; },
    removeAttribute(){},
    addEventListener(type, fn){ (listeners[type] = listeners[type] || []).push(fn); },
    removeEventListener(){}, focus(){}, blur(){}, click(){ this.onclick && this.onclick(); },
    // a submit, the way the page receives one
    async submit(){ for (const fn of listeners.submit || []) await fn({ preventDefault(){} }); },
    scrollIntoView(){}, getBoundingClientRect(){ return {top:0,left:0,width:100,height:100}; },
    querySelectorAll(){ return []; }, closest(){ return null; },
    getContext(){ return new Proxy({}, { get:(t,k)=> k in t ? t[k]
        : (/create(Radial|Linear)Gradient/.test(k) ? () => ({ addColorStop(){} })
          : k === 'measureText' ? () => ({ width:10 }) : () => undefined),
      set:(t,k,v)=>{ t[k]=v; return true; } }); }
  };
  Object.defineProperty(e, 'firstChild', {
    get(){ return this.children.length ? this.children[0] : (this.children[0] = mk('span')); } });
  e.querySelector = () => e.__qs || (e.__qs = mk());
  return e;
}
function makeDoc(){
  const pool = {}, seen = {};
  for (const id of IDS) pool[id] = mk();
  return {
    getElementById: id => pool[id] || (pool[id] = mk()),
    querySelector: sel => seen[sel] || (seen[sel] = mk()),
    querySelectorAll: () => [], createElement: mk, createElementNS: mk,
    addEventListener(){}, removeEventListener(){}, body: mk(), documentElement: mk(), head: mk()
  };
}
const AudioCtx = function(){
  return { createOscillator:()=>({ connect(){}, start(){}, stop(){}, frequency:{ setValueAtTime(){} }, type:'' }),
           createGain:()=>({ connect(){}, gain:{ setValueAtTime(){}, exponentialRampToValueAtTime(){}, linearRampToValueAtTime(){} } }),
           destination:{}, currentTime:0, resume:()=>Promise.resolve(), state:'running' }; };
// a socket that never opens: nothing here needs the game server
function FakeSocket(){ this.readyState = 0; }
FakeSocket.OPEN = 1; FakeSocket.CONNECTING = 0;
FakeSocket.prototype.send = function(){}; FakeSocket.prototype.close = function(){};

/* ---- the scripted client ----
   Every table query answers "nothing, no error" through one chain; the auth
   half records each call and answers from the script it was given. */
function tableChain(){
  const p = Promise.resolve({ data: null, error: null, count: 0 });
  const chain = new Proxy({}, { get: (_, k) => {
    if (k === 'then') return p.then.bind(p);
    if (k === 'catch') return p.catch.bind(p);
    if (k === 'finally') return p.finally.bind(p);
    return () => chain;
  }});
  return chain;
}
function fakeClient(script){
  const calls = [];
  let listener = null;
  const auth = {
    getSession: async () => ({ data: { session: script.session || null }, error: null }),
    onAuthStateChange: fn => { listener = fn; return { data: { subscription: { unsubscribe(){} } } }; },
    signInWithOAuth: async o => { calls.push(['signInWithOAuth', o]); return { data: {}, error: null }; },
    signInWithPassword: async o => { calls.push(['signInWithPassword', o]); return script.password ? script.password(o) : { data: {}, error: null }; },
    signUp: async o => { calls.push(['signUp', o]); return script.signUp ? script.signUp(o) : { data: { user: { id: 'new', identities: [{}] }, session: null }, error: null }; },
    resend: async o => { calls.push(['resend', o]); return { data: {}, error: null }; },
    resetPasswordForEmail: async (email, o) => { calls.push(['resetPasswordForEmail', { email, ...o }]); return script.reset ? script.reset(email) : { data: {}, error: null }; },
    updateUser: async o => { calls.push(['updateUser', o]); return script.update ? script.update(o) : { data: {}, error: null }; },
    signOut: async () => { calls.push(['signOut']); return { error: null }; }
  };
  const tables = [];
  const client = {
    auth, calls, tables,
    from: t => { tables.push(t); return tableChain(); },
    rpc: () => tableChain(),
    channel: () => ({ on(){ return this; }, subscribe(){ return this; } }),
    removeChannel(){},
    fire: (evt, session) => listener && listener(evt, session)
  };
  return client;
}

/** One whole page, with its own DOM, client and address. */
function makePage(opts){
  opts = opts || {};
  const doc = makeDoc();
  const href = opts.href || 'http://localhost:8787/';
  const loc = { protocol: href.split(':')[0] + ':', host: 'localhost:8787', href: href + (opts.hash || ''),
                hash: opts.hash || '', search: '', pathname: '/' };
  const store = {};
  const storage = { getItem:k => (k in store ? store[k] : null),
                    setItem:(k,v)=>{ store[k] = String(v); }, removeItem:k => { delete store[k]; } };
  const win = { addEventListener(){}, removeEventListener(){}, scrollTo(){},
                matchMedia:()=>({ matches:false, addEventListener(){}, addListener(){} }),
                innerWidth:1200, innerHeight:900, devicePixelRatio:1, location:loc, localStorage:storage };
  const client = fakeClient(opts.script || {});
  const logged = [];
  const con = { log:(...a)=>logged.push(a.join(' ')), warn:(...a)=>logged.push(a.join(' ')), error:(...a)=>logged.push(a.join(' ')) };
  const settings = opts.settings === undefined ? null : opts.settings;
  const fetched = [];
  const fetch = url => {
    fetched.push(url);
    if (/\/auth\/v1\/settings$/.test(url) && settings)
      return Promise.resolve({ ok:true, status:200, json:()=>Promise.resolve(settings) });
    return Promise.resolve({ ok:false, status:404, json:()=>Promise.resolve(null), text:()=>Promise.resolve('') });
  };
  let out = null;
  const src = '"use strict";' + BODY.replace(/await import\([^)]*\)/g, 'await __import()') +
    '\n__expose({ G, NET, showScreen, AUTH, authReturnURL, emailProblem, passwordProblem, authErrorText,' +
    ' screen:()=>screenName, account:()=>account });';
  new Function('document','window','location','localStorage','WebSocket','AudioContext',
               'webkitAudioContext','fetch','Image','requestAnimationFrame','cancelAnimationFrame',
               'getComputedStyle','navigator','console','__expose','__import', src)(
    doc, win, loc, storage, FakeSocket, AudioCtx, AudioCtx, fetch,
    mk, cb => setTimeout(()=>cb(Date.now()), 16), clearTimeout,
    () => ({ getPropertyValue: () => '' }), { userAgent:'node' },
    con, o => { out = o; }, () => Promise.resolve({ createClient: () => client }));
  out.doc = doc; out.client = client; out.logged = logged; out.fetched = fetched;
  out.by = id => doc.getElementById(id);
  out.press = id => doc.getElementById(id).onclick();
  out.type = (id, v) => { doc.getElementById(id).value = v; };
  out.note = id => doc.getElementById(id).textContent;
  out.calls = name => client.calls.filter(c => c[0] === name).map(c => c[1]);
  return out;
}

const RETURN = 'http://localhost:8787/';
function session(meta, extra){
  return { access_token: 'tok', user: Object.assign({ id: 'user-1', email: 'alex@example.com',
           user_metadata: meta || {}, app_metadata: { provider: 'google' } }, extra || {}) };
}

async function main(){
  console.log('\nThe markup');
  {
    const btn = id => new RegExp('id="' + id + '"').test(HTML);
    check('six provider buttons, three on each page',
          ['btnSignUpGoogle','btnSignUpApple','btnSignUpFacebook','btnLogInGoogle','btnLogInApple','btnLogInFacebook'].every(btn));
    check('each pair is labelled Continue with …',
          (HTML.match(/Continue with Google/g) || []).length === 2 &&
          (HTML.match(/Continue with Apple/g) || []).length === 2 &&
          (HTML.match(/Continue with Facebook/g) || []).length === 2);
    check('the OR divider stands between the providers and the address', /class="auth-or"[^>]*><span><\/span><b>OR<\/b>/.test(HTML));
    check('the log-in page carries email, password and Log In', btn('liEmail') && btn('liPassword') && /id="btnLogInEmail"[^>]*>Log In</.test(HTML));
    check('and the two links beneath', /Don't have an account\? Sign Up/.test(HTML) && /Forgot password\?/.test(HTML));
    check('sign-up asks for the password twice', btn('suEmail') && btn('suPassword') && btn('suConfirm'));
    check('forgot and new-password screens exist', /id="screen-forgot"/.test(HTML) && /id="screen-reset"/.test(HTML));
    check('passwords are typed into password fields with the right autocomplete',
          /id="liPassword" type="password"[\s\S]{0,80}autocomplete="current-password"/.test(HTML) &&
          /id="suPassword" type="password"[\s\S]{0,80}autocomplete="new-password"/.test(HTML));
    check('one signInWithOAuth call site, so there is one Google door',
          (BODY.match(/signInWithOAuth\(/g) || []).length === 1);
    check('the page carries the publishable key and no secret',
          /SUPABASE_ANON_KEY\s*=\s*'sb_publishable_/.test(BODY) &&
          !/client_secret|AuthKey_|BEGIN PRIVATE KEY|service_role|sb_secret_/i.test(HTML));
    check('no password is ever logged', !/console\.(log|warn|error)\([^)]*password/i.test(BODY));
  }

  console.log('\nThe three providers');
  {
    const p = makePage({ settings: { external: { google: true, apple: true, facebook: true, email: true } } });
    await settle();
    check('a visitor with no session lands on the home page', p.screen() === 'home', p.screen());
    check('the return address is the page with nothing after it', p.authReturnURL() === RETURN, p.authReturnURL());
    p.press('btnLogIn');
    check('Log In opens the log-in page', p.screen() === 'login');
    p.press('btnLogInGoogle'); await settle();
    let g = p.calls('signInWithOAuth');
    check('Google: provider google, this page as redirectTo, prompt=select_account',
          g.length === 1 && g[0].provider === 'google' && g[0].options.redirectTo === RETURN &&
          g[0].options.queryParams && g[0].options.queryParams.prompt === 'select_account', JSON.stringify(g));
    check('Google never asks the settings first: it is the door that already works', p.fetched.every(u => !/settings/.test(u)));
    p.press('btnLogInApple'); await settle();
    p.press('btnLogInFacebook'); await settle();
    g = p.calls('signInWithOAuth');
    check('Apple and Facebook make the same call under their own names, same redirectTo, no prompt',
          g.length === 3 && g[1].provider === 'apple' && g[2].provider === 'facebook' &&
          g.slice(1).every(o => o.options.redirectTo === RETURN && !o.options.queryParams), JSON.stringify(g));
    check('the project settings were asked once, with the publishable key',
          p.fetched.filter(u => /auth\/v1\/settings$/.test(u)).length === 1);
    p.press('btnToSignUp');
    check('the sign-up page offers the same three', p.screen() === 'signup');
    p.press('btnSignUpApple'); await settle();
    check('and they press the same door', p.calls('signInWithOAuth').length === 4 && p.calls('signInWithOAuth')[3].provider === 'apple');
  }
  {
    const p = makePage({ settings: { external: { google: true, apple: false, facebook: false, email: true } } });
    await settle();
    p.press('btnLogIn');
    p.press('btnLogInApple'); await settle();
    check('a provider the project has not switched on is refused on the page',
          p.calls('signInWithOAuth').length === 0 && /Apple sign-in is not switched on/.test(p.note('liNote')), p.note('liNote'));
    p.press('btnLogInFacebook'); await settle();
    check('…each by name', p.calls('signInWithOAuth').length === 0 && /Facebook sign-in is not switched on/.test(p.note('liNote')));
    p.press('btnLogInGoogle'); await settle();
    check('while Google goes through regardless', p.calls('signInWithOAuth').length === 1);
  }
  {
    const p = makePage({ href: 'https://nox-chess.onrender.com/', settings: null });
    await settle();
    p.press('btnLogIn'); p.press('btnLogInFacebook'); await settle();
    check('with the settings unreachable the provider is tried and answers for itself',
          p.calls('signInWithOAuth').length === 1 && p.calls('signInWithOAuth')[0].options.redirectTo === 'https://nox-chess.onrender.com/');
  }

  console.log('\nLogging in with a password');
  {
    const p = makePage({ script: {
      password: o => o.password === 'correct-horse'
        ? { data: { session: session({}) }, error: null }
        : { data: {}, error: { message: 'Invalid login credentials' } }
    }});
    await settle();
    p.press('btnLogIn');
    p.by('btnLogInEmail').textContent = 'Log In';   // the shim reads no markup
    await p.by('logInForm').submit();
    check('empty: asked for the address before anything is sent', p.note('liNote') === 'Enter your email address.' && p.calls('signInWithPassword').length === 0);
    p.type('liEmail', 'not-an-address'); p.type('liPassword', 'whatever');
    await p.by('logInForm').submit();
    check('a malformed address is refused on the page', /not look like an email/.test(p.note('liNote')) && p.calls('signInWithPassword').length === 0);
    p.type('liEmail', 'alex@example.com'); p.type('liPassword', '');
    await p.by('logInForm').submit();
    check('a missing password is asked for', p.note('liNote') === 'Enter your password.' && p.calls('signInWithPassword').length === 0);
    p.type('liPassword', 'wrong-one');
    await p.by('logInForm').submit();
    check('a wrong password is sent and answered with one safe sentence',
          p.calls('signInWithPassword').length === 1 && p.note('liNote') === 'That email and password do not match.', p.note('liNote'));
    check('the sentence does not say whether the address has an account', !/no account|not found|does not exist/i.test(p.note('liNote')));
    check('the password reached nothing but the client', !p.logged.some(l => /wrong-one/.test(l)));
    check('the button is back', !p.by('btnLogInEmail').disabled && p.by('btnLogInEmail').textContent === 'Log In');
    p.type('liPassword', 'correct-horse');
    await p.by('logInForm').submit();
    const c = p.calls('signInWithPassword');
    check('the right one goes to signInWithPassword with the address as typed',
          c.length === 2 && c[1].email === 'alex@example.com' && c[1].password === 'correct-horse');
    check('and the field is emptied once it has gone', p.by('liPassword').value === '');
    p.client.fire('SIGNED_IN', session({})); await settle();
    check('a session with no username goes to choose one', p.screen() === 'name', p.screen());
    check('the account is the Supabase user, whatever the door', p.account() && p.account().id === 'user-1');
  }
  {
    // what the project answers today: a code beside the message
    const p = makePage({ script: { password: () => ({ data: {}, error: { message: 'Invalid login credentials', code: 'invalid_credentials', status: 400 } }) } });
    await settle();
    p.press('btnLogIn'); p.type('liEmail', 'alex@example.com'); p.type('liPassword', 'anything-8');
    await p.by('logInForm').submit();
    check("the project's real invalid_credentials answer maps to the same sentence", p.note('liNote') === 'That email and password do not match.', p.note('liNote'));
  }
  {
    const p = makePage({ script: { update: () => ({ data: {}, error: { message: 'New password should be different from the old password.', code: 'same_password' } }) },
                         hash: '#access_token=abc&type=recovery' });
    p.client.auth.getSession = async () => ({ data: { session: session({ game_name: 'Alex' }) }, error: null });
    await settle();
    p.type('rpPassword', 'same-as-before'); p.type('rpConfirm', 'same-as-before');
    await p.by('resetForm').submit();
    check('a password the project refuses is quoted and the form stays', /should be different/.test(p.note('rpNote')) && !p.by('resetForm').hidden, p.note('rpNote'));
  }
  {
    const p = makePage({ script: { password: () => ({ data: {}, error: { message: 'Email not confirmed' } }) } });
    await settle();
    p.press('btnLogIn'); p.type('liEmail', 'alex@example.com'); p.type('liPassword', 'anything-8');
    await p.by('logInForm').submit();
    check('an unconfirmed address is told to open its link', /Confirm your email first/.test(p.note('liNote')), p.note('liNote'));
  }

  console.log('\nSigning up with a password');
  {
    const p = makePage();
    await settle();
    p.press('btnSignUp');
    check('Sign Up opens the sign-up page with the form up', p.screen() === 'signup' && !p.by('signUpForm').hidden && p.by('suSent').hidden);
    p.type('suEmail', 'new@example.com'); p.type('suPassword', 'short'); p.type('suConfirm', 'short');
    await p.by('signUpForm').submit();
    check('a short password is refused before anything is sent', /at least 8/.test(p.note('suNote')) && p.calls('signUp').length === 0, p.note('suNote'));
    p.type('suPassword', 'long-enough-1'); p.type('suConfirm', 'long-enough-2');
    await p.by('signUpForm').submit();
    check('a mismatch is refused before anything is sent', /do not match/.test(p.note('suNote')) && p.calls('signUp').length === 0);
    p.type('suEmail', ''); p.type('suConfirm', 'long-enough-1');
    await p.by('signUpForm').submit();
    check('and so is a missing address', p.note('suNote') === 'Enter your email address.' && p.calls('signUp').length === 0);
    p.type('suEmail', 'new@example.com');
    await p.by('signUpForm').submit();
    const c = p.calls('signUp');
    check('a good form goes to signUp with the address, the password and this page as emailRedirectTo',
          c.length === 1 && c[0].email === 'new@example.com' && c[0].password === 'long-enough-1' &&
          c[0].options.emailRedirectTo === RETURN, JSON.stringify(c));
    check('the form gives way to Check Your Email, naming the address',
          p.by('signUpForm').hidden && !p.by('suSent').hidden && p.by('suSentText').querySelector('b').textContent === 'new@example.com');
    check('the password fields are emptied', p.by('suPassword').value === '' && p.by('suConfirm').value === '');
    check('nobody was signed in: the link is what does that', p.account() === null && p.screen() === 'signup');
    p.press('btnSignUpResend'); await settle();
    const r = p.calls('resend');
    check('Send again resends the sign-up link to the same address',
          r.length === 1 && r[0].type === 'signup' && r[0].email === 'new@example.com' && r[0].options.emailRedirectTo === RETURN);
    p.press('btnToLogIn'); p.press('btnToSignUp');
    check('coming back to the page starts it over', !p.by('signUpForm').hidden && p.by('suSent').hidden);
  }
  {
    const p = makePage({ script: { signUp: () => ({ data: { user: { id: 'x', identities: [], email: '' }, session: null }, error: null }) } });
    await settle();
    p.press('btnSignUp');
    p.type('suEmail', 'alex@example.com'); p.type('suPassword', 'long-enough-1'); p.type('suConfirm', 'long-enough-1');
    await p.by('signUpForm').submit();
    check('an address that already has an account gets the very same panel',
          p.by('signUpForm').hidden && !p.by('suSent').hidden && /If .* is new to Nox Chess/.test(p.by('suSentText').innerHTML));
    check('which also says what to do if it is not', /Log in instead, or reset your password/.test(HTML));
  }
  {
    const p = makePage({ script: { signUp: () => ({ data: { user: { id: 'x', identities: [{}] }, session: session({}) }, error: null }) } });
    await settle();
    p.press('btnSignUp');
    p.type('suEmail', 'new@example.com'); p.type('suPassword', 'long-enough-1'); p.type('suConfirm', 'long-enough-1');
    await p.by('signUpForm').submit();
    p.client.fire('SIGNED_IN', session({})); await settle();
    check('with confirmation off the session arrives at once and the username is asked', p.screen() === 'name');
  }
  {
    const p = makePage({ script: { signUp: () => ({ data: {}, error: { message: 'Password should be at least 10 characters.' } }) } });
    await settle();
    p.press('btnSignUp');
    p.type('suEmail', 'new@example.com'); p.type('suPassword', 'long-enough-1'); p.type('suConfirm', 'long-enough-1');
    await p.by('signUpForm').submit();
    check("the project's own password rule is quoted", p.note('suNote') === 'Password should be at least 10 characters.', p.note('suNote'));
  }

  console.log('\nForgot password');
  {
    const p = makePage();
    await settle();
    p.press('btnLogIn'); p.press('btnForgot');
    check('Forgot password? opens its page', p.screen() === 'forgot');
    await p.by('forgotForm').submit();
    check('the address is asked for first', p.note('fpNote') === 'Enter your email address.' && p.calls('resetPasswordForEmail').length === 0);
    p.type('fpEmail', 'alex@example.com');
    await p.by('forgotForm').submit();
    const c = p.calls('resetPasswordForEmail');
    check('then resetPasswordForEmail is asked, with this page as redirectTo',
          c.length === 1 && c[0].email === 'alex@example.com' && c[0].redirectTo === RETURN, JSON.stringify(c));
    check('and the answer says the same thing whether or not there is an account',
          /If an account exists for that address/.test(p.note('fpNote')), p.note('fpNote'));
    p.press('btnForgotBack');
    check('Back to Log In', p.screen() === 'login');
  }
  {
    const p = makePage({ script: { reset: () => ({ data: {}, error: { message: 'For security purposes, you can only request this once every 60 seconds' } }) } });
    await settle();
    p.press('btnLogIn'); p.press('btnForgot'); p.type('fpEmail', 'alex@example.com');
    await p.by('forgotForm').submit();
    check('a refusal worth acting on is said', p.note('fpNote').length > 0 && p.by('fpNote').className.indexOf('bad') !== -1, p.note('fpNote'));
  }

  console.log('\nThe reset link');
  {
    const p = makePage({ hash: '#access_token=abc&refresh_token=def&type=recovery', script: { session: session({}) } });
    await settle();
    check('the address said recovery, and the page read it before the client could', p.AUTH.recovery === true);
    check('signed in by the link, the player is held on New Password — before the username', p.screen() === 'reset', p.screen());
    p.type('rpPassword', 'fresh-password'); p.type('rpConfirm', 'different');
    await p.by('resetForm').submit();
    check('a mismatch is refused', /do not match/.test(p.note('rpNote')) && p.calls('updateUser').length === 0);
    p.type('rpConfirm', 'fresh-password');
    await p.by('resetForm').submit(); await settle();
    const c = p.calls('updateUser');
    check('a match goes to updateUser with the password and nothing else', c.length === 1 && Object.keys(c[0]).join() === 'password' && c[0].password === 'fresh-password');
    check('and the player is told, in place of the form, that it worked',
          p.screen() === 'reset' && p.by('resetForm').hidden && !p.by('rpDone').hidden && p.by('btnResetSkip').hidden && p.AUTH.recovery === false, p.screen());
    check('the fields are emptied', p.by('rpPassword').value === '' && p.by('rpConfirm').value === '');
    p.press('btnResetDone');
    check('then the ordinary rules take over: this account still has no username', p.screen() === 'name' && p.AUTH.recovery === false, p.screen());
    check('and the page is put back for next time', !p.by('resetForm').hidden && p.by('rpDone').hidden && !p.by('btnResetSkip').hidden);
    check('the password reached nothing but the client', !p.logged.some(l => /fresh-password/.test(l)));
  }
  {
    const p = makePage({ hash: '#access_token=abc&type=recovery', script: { session: session({ game_name: 'Alex' }) } });
    await settle();
    check('a named account is held on New Password too', p.screen() === 'reset');
    p.press('btnResetSkip');
    check('and may keep the old one, landing on the home page', p.screen() === 'home' && p.AUTH.recovery === false);
  }
  {
    const p = makePage({ script: { session: session({ game_name: 'Alex' }) } });
    await settle();
    p.client.fire('PASSWORD_RECOVERY', session({ game_name: 'Alex' })); await settle();
    check("the client's own PASSWORD_RECOVERY event opens the same screen", p.screen() === 'reset');
  }
  {
    const p = makePage({ hash: '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired' });
    await settle();
    check('a link that did not work is explained on the log-in page',
          p.screen() === 'login' && /expired or was already used/.test(p.note('liNote')), p.screen() + ' ' + p.note('liNote'));
    check('and nobody is signed in', p.account() === null);
  }

  console.log('\nWho comes back');
  {
    const p = makePage({ script: { session: session({ game_name: 'Alex', full_name: 'Alex Example', avatar_url: 'x' }) } });
    await settle();
    check('a returning Google user with a username lands on the home page', p.screen() === 'home' && p.account().name === 'Alex');
    check('profiles is read, never written, on the way in',
          p.client.tables.indexOf('profiles') !== -1 && p.calls('updateUser').length === 0);
    check('the page never presses signOut, updateUser or signInWithOAuth on its own', p.client.calls.length === 0);
    p.press('btnLogOut'); await settle();
    check('Log out asks the client', p.calls('signOut').length === 1);
    p.client.fire('SIGNED_OUT', null); await settle();
    check('and the account is gone, back on the home page', p.account() === null && p.screen() === 'home');
    p.press('btnLogIn');
    p.client.fire('SIGNED_IN', session({ game_name: 'Alex' })); await settle();
    check('logging in again from the log-in page finishes it', p.screen() === 'home' && p.account().name === 'Alex');
  }
  {
    const apple = session({}, { email: 'k9z2@privaterelay.appleid.com', app_metadata: { provider: 'apple', providers: ['apple'] } });
    const p = makePage({ script: { session: apple } });
    await settle();
    check('an Apple user with no name at all is sent to choose a username',
          p.screen() === 'name' && p.account().gameName === '', p.screen());
    check('nothing about the account depends on Apple having sent a name', p.account().id === 'user-1' && typeof p.account().name === 'string' && p.account().name.length > 0);
  }
  {
    const fb = session({ game_name: 'Robin', full_name: 'Robin F' }, { app_metadata: { provider: 'facebook', providers: ['facebook'] } });
    const p = makePage({ script: { session: fb } });
    await settle();
    check('a Facebook user is nobody special: same fields, same home page', p.screen() === 'home' && p.account().name === 'Robin');
  }

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
