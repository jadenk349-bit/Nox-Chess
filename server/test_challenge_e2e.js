/* A friend challenge that deals the two seats different terms, on two whole
 * copies of blind-chess.html over real sockets against the real server.
 *
 * test_two_clients.py proves the server turns a challenge round correctly —
 * what each `start` says, and to whom. test_challenge_flow.js proves the
 * page's half against scripted replies: what the form sends and how the two
 * clocks are seeded. This is the two halves agreeing, which is the whole of
 * the feature: Jaden sets Complete Blindfold on three minutes for himself
 * and Sighted on ten for Alex, Alex presses Accept, and on *both* screens
 * Jaden is on the console with 3:00 and Alex is on a full board with 10:00,
 * whichever colour each was given.
 *
 * Every combination the brief names is played, plus the same one with the
 * players swapped — the check that settings follow the person and not the
 * colour — and a rematch of one, which must keep each player's terms while
 * swapping the seats. A challenge needs a signed-in account on both ends,
 * so this wants a server with SUPABASE_JWT_SECRET set, and the same secret
 * here (see page_harness.mintToken); without one it says so and skips.
 *
 *   SUPABASE_JWT_SECRET=x PORT=8797 python3 server/server.py &
 *   SUPABASE_JWT_SECRET=x PORT=8797 node server/test_challenge_e2e.js
 */
const { makePage, until, wait, probe, counter, mintToken, signIn } = require('./page_harness');
const { check, summary } = counter();

const NAME = { total:'Complete Blindfold', blind:'Board Only', fog:'Fog of War', sighted:'Sighted' };
const other = c => (c === 'w' ? 'b' : 'w');
const MIN = 60000;
let seq = 0;

/** Two signed-in pages, the second listening on the social page for a challenge. */
async function pair(){
  const n = ++seq;
  const a = makePage(), b = makePage();
  const aId = signIn(a, 'J' + n, 'Jaden' + n);
  const bId = signIn(b, 'A' + n, 'Alex' + n);
  b.socialConnect();
  const listening = await until(() => b.NET.state === 'social' && b.NET.verified);
  if (!listening) throw new Error('the friend never came online');
  return { a, b, aId, bId, aName:'Jaden' + n, bName:'Alex' + n };
}

/* The challenger fills the form the way a player does — the vision and time
   buttons for their own seat, the two for the friend's, a colour — and
   presses Challenge; the friend gets the box and presses Accept. Answers
   with both pages seated in one game. */
async function challenge(from, to, toId, toName, me, friend, side){
  from.challengeFriend({ id: toId, name: toName });
  check('the challenge form splits the vision and time panels',
        from.doc.getElementById('secVision').classList.contains('split') &&
        from.doc.getElementById('secTime').classList.contains('split'));
  from.selectMode(me.mode); from.pickBotTime(me.minutes);
  from.G.human = side; from.chosen.side = true;
  check('Challenge waits for the friend\'s two answers',
        from.unanswered().includes('secVision') && from.unanswered().includes('secTime'),
        from.unanswered().join(','));
  from.pickFriendMode(friend.mode); from.pickFriendTime(friend.minutes);
  check('and is ready once they are given', from.unanswered().length === 0, from.unanswered().join(','));
  from.press('btnStartGame');
  const asked = await until(() => to.up('chalOverlay'));
  check('the friend is asked', asked);
  if (!asked) throw new Error('no challenge box');
  const text = to.text('chalText');
  check('and the box says what each of them would play',
        text.includes('You play ' + (side === 'w' ? 'Black' : 'White')) &&
        text.includes(NAME[friend.mode] + ' · ' + friend.minutes + ' min') &&
        (me.mode === friend.mode && me.minutes === friend.minutes
          || text.includes('plays ' + NAME[me.mode] + ' · ' + me.minutes + ' min')),
        text);
  to.press('chalAccept');
  const seated = await until(() => from.NET.gameId && from.NET.gameId === to.NET.gameId && from.G.started && to.G.started);
  check('accepting seats both at one board', seated, from.NET.gameId + ' / ' + to.NET.gameId);
  if (!seated) throw new Error('never seated');
}

/* What has to be true on both screens once they are seated: each page draws
   through its own vision, each page's two clocks start on the two numbers,
   and the two pages agree about which colour has which clock. */
function seatedRight(label, from, to, me, friend, side){
  check(label + ': the challenger plays the vision they chose for themselves',
        from.G.mode === me.mode, from.G.mode);
  check(label + ': the friend plays the vision chosen for them',
        to.G.mode === friend.mode, to.G.mode);
  check(label + ': the challenger keeps the colour they chose',
        from.G.human === side && to.G.human === other(side), from.G.human + '/' + to.G.human);
  check(label + ': each page knows what the other side is on',
        from.G.theirMode === friend.mode && from.G.theirMinutes === friend.minutes &&
        to.G.theirMode === me.mode && to.G.theirMinutes === me.minutes,
        from.G.theirMode + ' ' + from.G.theirMinutes + ' / ' + to.G.theirMode + ' ' + to.G.theirMinutes);
  const fc = from.G.clock, tc = to.G.clock;
  check(label + ': the challenger\'s clock starts on their own minutes',
        fc[side] === me.minutes * MIN, JSON.stringify(fc));
  check(label + ': and the friend\'s on theirs',
        fc[other(side)] === friend.minutes * MIN, JSON.stringify(fc));
  check(label + ': the friend\'s page seats the same two clocks the same way',
        tc.w === fc.w && tc.b === fc.b, JSON.stringify(tc));
  check(label + ': both start with the board set and nothing over',
        from.G.over === null && to.G.over === null && from.G.uci.length === 0 && to.G.uci.length === 0);
}

async function finished(a, b){
  a.netSend({ t:'resign' });
  const done = await until(() => a.G.over && b.G.over);
  if (!done) throw new Error('the game never ended');
}

const COMBOS = [
  { label:'TEST 1', me:{ mode:'sighted', minutes:10 }, friend:{ mode:'sighted', minutes:10 }, side:'w' },
  { label:'TEST 2', me:{ mode:'total',   minutes:3 },  friend:{ mode:'sighted', minutes:10 }, side:'w' },
  { label:'TEST 3', me:{ mode:'fog',     minutes:5 },  friend:{ mode:'blind',   minutes:15 }, side:'b' },
  { label:'TEST 4', me:{ mode:'blind',   minutes:1 },  friend:{ mode:'total',   minutes:30 }, side:'w' },
];

async function main(){
  await probe();
  if (!mintToken('probe')){
    console.log('\nSKIP  a friend challenge needs signed-in accounts on both ends —\n' +
                '      set SUPABASE_JWT_SECRET on the server and on this test\n');
    process.exit(0);
  }

  for (const c of COMBOS){
    console.log('\n' + c.label + ' — me ' + NAME[c.me.mode] + ' / ' + c.me.minutes + ' min, friend ' +
                NAME[c.friend.mode] + ' / ' + c.friend.minutes + ' min, challenger takes ' +
                (c.side === 'w' ? 'White' : 'Black'));
    const { a, b, bId, bName } = await pair();
    await challenge(a, b, bId, bName, c.me, c.friend, c.side);
    seatedRight(c.label, a, b, c.me, c.friend, c.side);
    await finished(a, b);
    a.netClose(); b.netClose();
    await wait(100);
  }

  console.log('\nTEST 5 — the same game with the players swapped');
  {
    const { a, b, aId, aName } = await pair();
    // Alex is the challenger now, on TEST 2's terms turned round: Alex takes
    // Complete Blindfold on three minutes, gives Jaden Sighted on ten, and
    // takes Black. Nothing may come out reversed.
    a.socialConnect();
    await until(() => a.NET.state === 'social' && a.NET.verified);
    const me = { mode:'total', minutes:3 }, friend = { mode:'sighted', minutes:10 };
    await challenge(b, a, aId, aName, me, friend, 'b');
    seatedRight('TEST 5', b, a, me, friend, 'b');
    check('TEST 5: the challenger is on Black and still on their own console',
          b.G.human === 'b' && b.G.mode === 'total' && b.G.clock.b === 3 * MIN && b.G.clock.w === 10 * MIN,
          JSON.stringify(b.G.clock));
    check('TEST 5: the friend is on White with the full board and ten minutes',
          a.G.human === 'w' && a.G.mode === 'sighted' && a.G.clock.w === 10 * MIN && a.G.clock.b === 3 * MIN,
          JSON.stringify(a.G.clock));

    console.log('\nThe clocks run as they always did');
    const white = a, black = b;
    check('nothing ticks before the first move', await (async () => {
      const w0 = white.G.clock.w; await wait(350); return white.G.clock.w === w0; })());
    white.tryMove(52, 36);                       // e2–e4, on White's own board
    const relayed = await until(() => black.G.uci.length === 1);
    check('a move made on one page reaches the other', relayed);
    const bBefore = black.G.clock.b, wAfter = white.G.clock.w;
    await wait(450);
    check('and Black\'s clock — the three-minute one — is the one running',
          black.G.clock.b < bBefore && black.G.clock.b < 3 * MIN,
          bBefore + ' -> ' + black.G.clock.b);
    check('while White\'s stands still', white.G.clock.w === wAfter, wAfter + ' -> ' + white.G.clock.w);
    check('both pages agree which clock is running',
          white.G.clock.b < 3 * MIN && Math.abs(white.G.clock.b - black.G.clock.b) < 400,
          white.G.clock.b + ' / ' + black.G.clock.b);
    black.tryMove(12, 28);                       // e7–e5
    await until(() => white.G.uci.length === 2);
    const wB = white.G.clock.w;
    await wait(450);
    check('and it switches back with the turn', white.G.clock.w < wB, wB + ' -> ' + white.G.clock.w);

    console.log('\nA draw, and then a rematch that keeps each player\'s terms');
    white.press('btnDraw');
    const offered = await until(() => black.up('drawOverlay'));
    check('a draw offer reaches the other side', offered);
    black.press('drawAccept');
    const drawn = await until(() => white.G.over && black.G.over);
    check('and accepting it ends the game for both', drawn);
    check('as a draw', /draw/i.test((white.G.over && white.G.over.text) || ''), white.G.over && white.G.over.text);

    const first = a.NET.gameId;
    b.press('endRematch');
    const askedAgain = await until(() => a.up('rematchOverlay'));
    check('the rematch reaches the other player', askedAgain);
    check('and its box names both seats — theirs first, then the asker\'s',
          /Sighted · 10 min; .*plays Complete Blindfold · 3 min/.test(a.text('rematchText')) &&
          /you play Black/.test(a.text('rematchText')), a.text('rematchText'));
    a.press('rematchAccept');
    const again = await until(() => a.NET.gameId !== first && a.NET.gameId === b.NET.gameId && a.G.started);
    check('a new game starts for both', again);
    check('the colours swap', a.G.human === 'b' && b.G.human === 'w', a.G.human + '/' + b.G.human);
    check('the visions do not', a.G.mode === 'sighted' && b.G.mode === 'total', a.G.mode + '/' + b.G.mode);
    check('nor the clocks — each follows its player into the other seat',
          a.G.clock.b === 10 * MIN && a.G.clock.w === 3 * MIN &&
          b.G.clock.b === 10 * MIN && b.G.clock.w === 3 * MIN,
          JSON.stringify(a.G.clock) + ' / ' + JSON.stringify(b.G.clock));
    check('and each still knows the far side\'s terms',
          a.G.theirMode === 'total' && a.G.theirMinutes === 3 &&
          b.G.theirMode === 'sighted' && b.G.theirMinutes === 10);

    console.log('\nResigning, and a player who drops');
    b.press('btnResign');
    b.press('resignConfirm');
    const resigned = await until(() => a.G.over && b.G.over);
    check('resigning ends the asymmetric game for both', resigned);
    a.netClose(); b.netClose();
  }

  {
    const { a, b, bId, bName } = await pair();
    await challenge(a, b, bId, bName, { mode:'fog', minutes:5 }, { mode:'blind', minutes:15 }, 'w');
    b.NET.sock.close();                          // the friend's tab goes
    const left = await until(() => a.G.over, 6000);
    check('a player who disconnects loses the game, as in any online game',
          left && /left/i.test((a.G.over && a.G.over.text) || ''), a.G.over && a.G.over.text);
    a.netClose();
  }

  const failed = summary();
  await wait(200);
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.log('\nERROR: ' + e.message); console.log(e.stack); process.exit(1); });
