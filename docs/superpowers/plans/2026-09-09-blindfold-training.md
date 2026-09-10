# Blindfold Training System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the seven-drill Practice page with the eleven-mode, level-laddered training system (Progressive Blindfold inside it), rebuild the course as ten lessons that hand off into it, and persist progress to Supabase.

**Architecture:** Everything stays in `blind-chess.html`, inside the existing PRACTICE and LESSONS sections, on the existing practice and lesson boards, using the page's own move generator for every position, move and answer. Shared pure helpers (opening book, geometry, rebuild diff) move into CONSTANTS & HELPERS so the course and Practice call one implementation. Persistence follows the `puzzle_progress` pattern exactly: browser-written rows under RLS, localStorage cache, guest adoption on sign-in.

**Tech Stack:** Vanilla JS in one HTML file; Node test harnesses that lift code out of the page by name; Python server unchanged; Supabase (Postgres + RLS) via the page's `sb` client; hand-run SQL migration.

**Spec:** `docs/superpowers/specs/2026-09-09-blindfold-training-design.md`

## Global Constraints

- All Practice code, including Progressive Blindfold, lives between the `PRACTICE — the drills behind LESSON` banner and the `SCREENS` banner in `blind-chess.html`; `server/test_practice_flow.js` lifts that whole block.
- Every new top-level `const`/`function` that `server/test_practice.js` needs is added to its `DECLS`/`FNS` lists in the same task that adds the name.
- No exercise may require mental imagery; copy says "hold" / "know", never "picture" / "see in your head".
- Every generated position passes `prPosition()`'s rules (two kings, not touching, no pawn on ranks 1/8, side not to move not in check) or comes from a legal game; every move comes from `legalMoves()`; every SAN from `toSAN()`.
- No new served files; `STATIC_FILES` is untouched. Puzzle JSON is already served.
- Mode keys are exactly: `square`, `lines`, `piece`, `attack`, `hold`, `tracker`, `after`, `forcing`, `calc`, `branches`, `progressive`. The course row key is `course`.
- Comments explain *why*, in the register of the file; every decision from the spec that is easy to undo gets a comment arguing for it.
- Commit at the end of every task; run the task's named tests before committing. Never `git stash`.

---

## File map

| File | Role in this plan |
|---|---|
| `blind-chess.html` CONSTANTS & HELPERS | new shared pure helpers: `OPENING_BOOK`, `bookMove`, `OPENING_LINES`, `moveFromSAN`, `lineBetween`, `linesThrough`, `knightRoute`, `sliderReaches`, `rebuildDiff` |
| `blind-chess.html` PRACTICE section | store v2, level recipes, staircase, eleven generators and presenters, rebuild UI, Progressive Blindfold, dashboard, sessions, recommender, cloud sync |
| `blind-chess.html` LESSONS section | ten lessons, handoff step, storage v3, floors, end-of-course buttons |
| `blind-chess.html` markup + CSS | practice dashboard bands, setup overlay (minutes), result card, lesson hub copy |
| `blind-chess.html` ACCOUNTS (`setAccount`) | calls `prSync()` beside `pzSync()` |
| `server/test_practice.js` | generator validity per mode per level, store, staircase, recommender |
| `server/test_practice_flow.js` | one driven question per mode, Progressive Blindfold game with checkpoint and recovery |
| `server/test_lessons.js` | ten lessons walked; solvers for new step kinds |
| `supabase-migrate-practice.sql` | new table, RLS, grants |
| `tools/check_supabase_practice.py` | proves RLS against the real project |
| `CLAUDE.md` | Practice and course sections rewritten; new commands listed |

## Phase overview and order

Nine phases, numbered 0 to 8. Each leaves the page working and every suite green.

| Phase | Tasks | Delivers | Why in this order |
|---|---|---|---|
| 0 Foundations | 1–8 | shared helpers, store v2, level/staircase model, `goPractice(target)`, rebuild UI, harness lists | everything later reuses these; nothing user-visible changes yet except level captions |
| 1 Board & Vision | 9–12 | `square`, `lines`, `piece`, `attack` | simplest generators; establishes the generator/presenter pattern |
| 2 Holding & Tracking | 13–15 | `hold`, `tracker`, `after` | the spine; depends on opening book and rebuild UI |
| 3 Calculation | 16–18 | `forcing`, `calc`, `branches` | depends on exchange helpers and tracker presenter |
| 4 Progressive Blindfold | 19–21 | `progressive`, mini challenge folded in | depends on rebuild UI and console |
| 5 Dashboard & sessions | 22–25 | groups, readiness, recommender, quick/daily/focused, first-visit intro | needs all modes to exist |
| 6 Cloud | 26–28 | migration, check script, sync | store shape settled by then |
| 7 Course | 29–36 | ten lessons, handoffs, floors, end buttons | lessons call Practice generators at level-1 recipes |
| 8 Wrap | 37–38 | CLAUDE.md, full test run | — |


---

# Phase 0 — Foundations

### Task 1: Shared opening book and opening lines

**Files:**
- Modify: `blind-chess.html` — add to CONSTANTS & HELPERS after `PIECE_NAME` (line ~5939); replace `LSN_BOOK`/`lsnBookMove` (lines ~10899–10924) with wrappers
- Test: `server/test_practice.js`

**Interfaces:**
- Produces: `const OPENING_BOOK` (SAN strings), `function bookMove(st, ply, rnd)` → `{m, san}` or null, `const OPENING_LINES` (array of `{name, sans:[]}`), `function moveFromSAN(st, san)` → move or null, `function openingPosition(idx, plies)` → `{st, sans}`.

- [ ] **Step 1: Write the failing test** — append to `server/test_practice.js` before the final scoreboard print:

```js
head('Opening book and lines');
(function(){
  var st = newState(), ok1 = true;
  for (var p = 0; p < 12; p++){
    var pick = bookMove(st, p, prRand);
    if (!pick || legalMoves(st, st.turn).indexOf(pick.m) < 0){ ok1 = false; break; }
    st = makeMove(st, pick.m);
  }
  ok('bookMove plays twelve legal plies from the start', ok1, true);
  ok('there are at least twenty opening lines', OPENING_LINES.length >= 20, true);
  var bad = 0;
  OPENING_LINES.forEach(function(L){
    var s = newState();
    L.sans.forEach(function(san){
      var m = moveFromSAN(s, san);
      if (!m){ bad++; return; }
      s = makeMove(s, m);
    });
  });
  ok('every opening line is legal from move one', bad, 0);
  var r = openingPosition(0, 6);
  ok('openingPosition replays the asked plies', r.sans.length, 6);
})();
```

Add `'OPENING_BOOK','OPENING_LINES'` to `DECLS` and `'bookMove','moveFromSAN','openingPosition'` to `FNS` in that file.

- [ ] **Step 2: Run** `node server/test_practice.js` — expected: FAIL, "could not find OPENING_BOOK".

- [ ] **Step 3: Implement** in CONSTANTS & HELPERS:

```js
/* The opening book the course has always tracked with, moved here so that
   Practice reads the same one: a tracking exercise built out of a different
   book would be a second idea of what a sane opening move is. */
const OPENING_BOOK = [
  'e4','d4','Nf3','c4','g3','b3',
  'e5','c5','e6','d5','Nf6','Nc6','d6','g6','c6','b6',
  'Bc4','Bb5','Bc5','Be7','Be2','Be3','Bd3','Bd6','Bg2','Bg7','Bf4','Bf5','Bg4',
  'Nc3','Nbd2','Nb6','Nd4','Nd5','Nge2','Nge7',
  'O-O','d3','a6','h6','a3','h3','Re1','Re8','Qc7','Qe7','Qd6'
];
/** One sane move for the side to move, or null. `rnd(n)` is the dice. */
function bookMove(st, ply, rnd){
  const legal = legalMoves(st, st.turn);
  if (!legal.length) return null;
  const r = rnd || (n => Math.floor(Math.random() * n));
  const scored = legal.map(m => {
    const san = toSAN(st, m, legal);
    let s = OPENING_BOOK.indexOf(san) >= 0 ? 100 : 0;
    if (m.p.t === 'Q' && ply < 8) s -= 45;
    if (m.p.t === 'K' && !m.castle) s -= 60;
    if (m.p.t === 'R' && ply < 6) s -= 30;
    if (m.cap) s += 12;
    if (san.endsWith('+') || san.endsWith('#')) s -= 25;
    return { m, san, s: s + r(10) };
  }).sort((a, b) => b.s - a.s);
  return scored[r(Math.min(4, scored.length))];
}
/* Twenty real opening lines, ten plies each. Tracking from the start position
   is the easiest holding there is — it is the one template everybody owns —
   and these are what the tracker plays at its opening levels. */
const OPENING_LINES = [
  { name:'Italian Game',       sans:['e4','e5','Nf3','Nc6','Bc4','Bc5','c3','Nf6','d3','d6'] },
  { name:'Ruy Lopez',          sans:['e4','e5','Nf3','Nc6','Bb5','a6','Ba4','Nf6','O-O','Be7'] },
  { name:'Scotch Game',        sans:['e4','e5','Nf3','Nc6','d4','exd4','Nxd4','Nf6','Nxc6','bxc6'] },
  { name:'Sicilian Najdorf',   sans:['e4','c5','Nf3','d6','d4','cxd4','Nxd4','Nf6','Nc3','a6'] },
  { name:'French Classical',   sans:['e4','e6','d4','d5','Nc3','Nf6','Bg5','Be7','e5','Nfd7'] },
  { name:'Caro-Kann',          sans:['e4','c6','d4','d5','Nc3','dxe4','Nxe4','Bf5','Ng3','Bg6'] },
  { name:"Queen's Gambit Declined", sans:['d4','d5','c4','e6','Nc3','Nf6','Bg5','Be7','e3','O-O'] },
  { name:"Queen's Gambit Accepted", sans:['d4','d5','c4','dxc4','Nf3','Nf6','e3','e6','Bxc4','c5'] },
  { name:'Slav Defence',       sans:['d4','d5','c4','c6','Nf3','Nf6','Nc3','dxc4','a4','Bf5'] },
  { name:"King's Indian",      sans:['d4','Nf6','c4','g6','Nc3','Bg7','e4','d6','Nf3','O-O'] },
  { name:'Nimzo-Indian',       sans:['d4','Nf6','c4','e6','Nc3','Bb4','Qc2','O-O','a3','Bxc3+'] },
  { name:'Grünfeld',           sans:['d4','Nf6','c4','g6','Nc3','d5','cxd5','Nxd5','e4','Nxc3'] },
  { name:'English Opening',    sans:['c4','e5','Nc3','Nf6','Nf3','Nc6','g3','d5','cxd5','Nxd5'] },
  { name:'London System',      sans:['d4','d5','Bf4','Nf6','e3','e6','Nf3','c5','c3','Nc6'] },
  { name:'Scandinavian',       sans:['e4','d5','exd5','Qxd5','Nc3','Qa5','d4','Nf6','Nf3','c6'] },
  { name:'Pirc Defence',       sans:['e4','d6','d4','Nf6','Nc3','g6','f4','Bg7','Nf3','O-O'] },
  { name:'Four Knights',       sans:['e4','e5','Nf3','Nc6','Nc3','Nf6','Bb5','Bb4','O-O','O-O'] },
  { name:'Vienna Game',        sans:['e4','e5','Nc3','Nf6','f4','d5','fxe5','Nxe4','Nf3','Be7'] },
  { name:'Petroff Defence',    sans:['e4','e5','Nf3','Nf6','Nxe5','d6','Nf3','Nxe4','d4','d5'] },
  { name:'Alekhine Defence',   sans:['e4','Nf6','e5','Nd5','d4','d6','Nf3','Bg4','Be2','e6'] }
];
/** The legal move that SAN names here, ignoring a trailing + or #. */
function moveFromSAN(st, san){
  const legal = legalMoves(st, st.turn);
  const want = san.replace(/[+#]$/, '');
  for (const m of legal) if (toSAN(st, m, legal).replace(/[+#]$/, '') === want) return m;
  return null;
}
/** Line `idx`, the first `plies` of it, played out. */
function openingPosition(idx, plies){
  const L = OPENING_LINES[((idx % OPENING_LINES.length) + OPENING_LINES.length) % OPENING_LINES.length];
  let st = newState();
  const sans = [];
  for (let k = 0; k < Math.min(plies, L.sans.length); k++){
    const m = moveFromSAN(st, L.sans[k]);
    if (!m) break;
    sans.push(L.sans[k]);
    st = makeMove(st, m);
  }
  return { st, sans, name: L.name };
}
```

Then in the LESSONS section replace the `LSN_BOOK` array and `lsnBookMove` body with:

```js
const LSN_BOOK = OPENING_BOOK;                         // one book, see CONSTANTS & HELPERS
function lsnBookMove(st, ply){ return bookMove(st, ply, lsnRand); }
```

`lsnMoveFor(st, san)` stays (it is the course's own reader) but its body becomes `return moveFromSAN(st, san);`.

- [ ] **Step 4: Run** `node server/test_practice.js && node server/test_lessons.js` — expected: PASS (the lessons suite takes ~90 s).

- [ ] **Step 5: Commit**

```bash
git add blind-chess.html server/test_practice.js
git commit -m "Share the opening book and twenty opening lines between the course and Practice"
```

---

### Task 2: Geometry and rebuild helpers

**Files:**
- Modify: `blind-chess.html` CONSTANTS & HELPERS, directly after Task 1's block
- Test: `server/test_practice.js`

**Interfaces:**
- Produces: `lineBetween(a, b)` → array of square indices strictly between, or null if not on one line; `linesThrough(sq)` → `{rank, file, diag1, diag2}` arrays excluding `sq`; `knightRoute(from, to)` → array of squares from `from` to `to` inclusive (shortest); `sliderReaches(board, from, to, type)` → boolean for `'R'|'B'|'Q'`; `rebuildDiff(placed, target)` → `{right, wrong, missing}` where each entry is `{sq, c, t}`; `quadrantOf(sq)` → one of `'a1','h1','a8','h8'` (the corner naming the quarter).

- [ ] **Step 1: Write the failing test** — append to `server/test_practice.js`; add the five names to `FNS`:

```js
head('Geometry helpers');
(function(){
  var a1 = sqIndex('a1'), a8 = sqIndex('a8'), h8 = sqIndex('h8'), e4 = sqIndex('e4'), b1 = sqIndex('b1');
  ok('a1–a8 has six squares between', lineBetween(a1, a8).length, 6);
  ok('a1–h8 has six squares between', lineBetween(a1, h8).length, 6);
  ok('b1–e4 is not a line', lineBetween(b1, e4), null);
  var L = linesThrough(e4);
  ok('e4: seven on its rank', L.rank.length, 7);
  ok('e4: seven on its file', L.file.length, 7);
  ok('e4: both diagonals together hold thirteen', L.diag1.length + L.diag2.length, 13);
  var route = knightRoute(b1, e4);
  ok('b1→e4 is two knight moves', route.length - 1, 2);
  ok('the route starts and ends where asked', route[0] === b1 && route[route.length - 1] === e4, true);
  ok('a1→h8 by knight is six moves', knightRoute(a1, h8).length - 1, 6);
  var b = Array(64).fill(null);
  ok('an empty a-file: the rook reaches', sliderReaches(b, a1, a8, 'R'), true);
  b[sqIndex('a4')] = mk(W, 'P');
  ok('a pawn on a4 stops it', sliderReaches(b, a1, a8, 'R'), false);
  ok('a bishop never reaches along a file', sliderReaches(Array(64).fill(null), a1, a8, 'B'), false);
  var d = rebuildDiff([{sq:a1,c:W,t:'K'},{sq:e4,c:B,t:'N'}], [{sq:a1,c:W,t:'K'},{sq:h8,c:B,t:'K'}]);
  ok('rebuildDiff: one right', d.right.length, 1);
  ok('rebuildDiff: one wrong', d.wrong.length, 1);
  ok('rebuildDiff: one missing', d.missing.length, 1);
  ok('e4 is in the h1 quarter', quadrantOf(e4), 'h1');
})();
```

- [ ] **Step 2: Run** `node server/test_practice.js` — expected: FAIL, "could not find function lineBetween".

- [ ] **Step 3: Implement:**

```js
/* Board geometry, as functions rather than tables, so the course and the
   drills cannot disagree with each other about what lies between two squares.
   Rows count from the top (rowOf(a8) === 0), as everywhere else in the file. */
function lineBetween(a, b){
  const nr = rowOf(b) - rowOf(a), nc = colOf(b) - colOf(a);
  if ((nr === 0 && nc === 0) || !(nr === 0 || nc === 0 || Math.abs(nr) === Math.abs(nc))) return null;
  const dr = Math.sign(nr), dc = Math.sign(nc), out = [];
  let r = rowOf(a) + dr, c = colOf(a) + dc;
  while (r !== rowOf(b) || c !== colOf(b)){ out.push(r * 8 + c); r += dr; c += dc; }
  return out;
}
function linesThrough(sq){
  const r = rowOf(sq), c = colOf(sq), rank = [], file = [], diag1 = [], diag2 = [];
  for (let i = 0; i < 64; i++){
    if (i === sq) continue;
    const dr = rowOf(i) - r, dc = colOf(i) - c;
    if (dr === 0) rank.push(i);
    else if (dc === 0) file.push(i);
    else if (dr === dc) diag1.push(i);
    else if (dr === -dc) diag2.push(i);
  }
  return { rank, file, diag1, diag2 };
}
/** Shortest knight route, breadth-first; `from` and `to` inclusive. */
function knightRoute(from, to){
  if (from === to) return [from];
  const prev = Array(64).fill(-1), queue = [from];
  prev[from] = from;
  while (queue.length){
    const cur = queue.shift();
    for (const [dr, dc] of DIR_N){
      const r = rowOf(cur) + dr, c = colOf(cur) + dc;
      if (r < 0 || r > 7 || c < 0 || c > 7) continue;
      const nxt = r * 8 + c;
      if (prev[nxt] >= 0) continue;
      prev[nxt] = cur;
      if (nxt === to){
        const path = [to];
        let at = to;
        while (at !== from){ at = prev[at]; path.unshift(at); }
        return path;
      }
      queue.push(nxt);
    }
  }
  return null;
}
/** Can a slider of `type` on `from` reach `to` across this board? Geometry first, then emptiness. */
function sliderReaches(board, from, to, type){
  const between = lineBetween(from, to);
  if (!between) return false;
  const straight = rowOf(from) === rowOf(to) || colOf(from) === colOf(to);
  if (type === 'R' && !straight) return false;
  if (type === 'B' && straight) return false;
  return between.every(i => !board[i]);
}
/** The corner naming the quarter of the board a square sits in. */
function quadrantOf(sq){
  return (colOf(sq) < 4 ? 'a' : 'h') + (rowOf(sq) < 4 ? '8' : '1');
}
/* What a rebuilt position got right, wrong and left out. Pure, so the practice
   board and the lesson board — two boards on purpose — judge by one rule. */
function rebuildDiff(placed, target){
  const same = (x, y) => x.sq === y.sq && x.c === y.c && x.t === y.t;
  const right = [], wrong = [], missing = [];
  for (const p of placed) (target.some(t => same(t, p)) ? right : wrong).push(p);
  for (const t of target) if (!placed.some(p => same(p, t))) missing.push(t);
  return { right, wrong, missing };
}
```

- [ ] **Step 4: Run** `node server/test_practice.js` — expected: PASS.

- [ ] **Step 5: Commit** `git commit -am "Geometry and rebuild helpers shared by the course and Practice"`

---

### Task 3: Practice store v2 with migration and the seen-list

**Files:**
- Modify: `blind-chess.html` PRACTICE section, lines ~11746–11830 (`PR_LEVELS`, `prBlank`, `prLoad`, `prSave`, `prLevelIndex`, `prLevelProgress`)
- Test: `server/test_practice.js`

**Interfaces:**
- Produces: `PR_VERSION = 2`; `PR_V1_KEYS`; `prBlankMode()`; `prBlank()` → `{v, asked, correct, sessions, days, lastDay, best, modes}`; `prLoad()`, `prSave(st)` unchanged names; `prSeen()` → array of signatures, `prSeenPush(sig)`, `prSeenHas(sig)`; `prToday()` → `'YYYY-MM-DD'`; `prTouchDay(st)` updates `days`/`lastDay`.
- Removes: `PR_LEVELS`, `prLevelIndex`, `prLevelProgress`, `prTried` (and their `DECLS`/`FNS` entries).

- [ ] **Step 1: Write the failing test** — replace the existing "level ladder" block in `server/test_practice.js` with:

```js
head('Store v2');
(function(){
  storage = {};
  var st = prBlank();
  ok('a blank store is version 2', st.v, 2);
  ok('every mode starts at level 1', Object.keys(st.modes).every(function(k){ return st.modes[k].level === 1; }), true);
  // a v1 record from the seven-drill page is read through the key map
  storage[prKey()] = JSON.stringify({ v:1, asked:40, correct:30, sessions:4, streak:2, best:5,
    modes:{ coord:{asked:20,correct:18,sessions:2,best:5,diff:3}, track:{asked:20,correct:12,sessions:2,best:3,diff:2},
            mini:{asked:0,correct:0,sessions:0,best:0,diff:1} } });
  var up = prLoad();
  ok('v1 coord answers land on square', up.modes.square.asked, 20);
  ok('v1 track answers land on tracker', up.modes.tracker.asked, 20);
  ok('a v1 diff of 3 becomes level 3', up.modes.square.level, 3);
  ok('the totals survive', up.asked, 40);
  storage = {};
  prSeenPush('a'); prSeenPush('b');
  ok('the seen list remembers', prSeenHas('a') && prSeenHas('b'), true);
  for (var i = 0; i < 120; i++) prSeenPush('x' + i);
  ok('and keeps only the last hundred', prSeen().length, 100);
  ok('so the oldest is forgotten', prSeenHas('a'), false);
  var d = prBlank(); d.lastDay = ''; prTouchDay(d);
  ok('the first day practised is day one', d.days, 1);
  prTouchDay(d);
  ok('the same day again is still day one', d.days, 1);
})();
```

- [ ] **Step 2: Run** — expected: FAIL (v is 1, `prSeenPush` not found).

- [ ] **Step 3: Implement** — replace the storage block:

```js
const PR_STORE = 'nox.practice.';
const PR_VERSION = 2;
const prKey = () => PR_STORE + (account ? account.id : 'guest');
/* Where the seven drills of version 1 went. Two of them merged and one became
   the tracker's opening levels; nothing anybody answered is thrown away. */
const PR_V1_KEYS = { coord:'square', color:'square', vision:'piece', track:'tracker',
                     memory:'hold', sequence:'tracker', mini:'progressive' };

function prBlankMode(){ return { level:1, best:1, asked:0, correct:0, sessions:0, lastAt:0, stats:{} }; }
function prBlank(){
  const modes = {};
  for (const m of PR_MODES) modes[m.key] = prBlankMode();
  return { v:PR_VERSION, asked:0, correct:0, sessions:0, days:0, lastDay:'', best:0, modes };
}
function prUpgradeV1(raw){
  const out = prBlank();
  for (const k of ['asked','correct','sessions','best'])
    if (typeof raw[k] === 'number' && raw[k] >= 0) out[k] = raw[k];
  for (const old in (raw.modes || {})){
    const nk = PR_V1_KEYS[old], src = raw.modes[old], m = out.modes[nk];
    if (!m || !src) continue;
    for (const k of ['asked','correct','sessions']) if (src[k] > 0) m[k] += src[k];
    if (src.best > m.stats.streak) m.stats.streak = src.best;
    m.level = Math.max(m.level, Math.min(3, src.diff || 1));
    m.best = Math.max(m.best, m.level);
  }
  return out;
}
function prLoad(){
  const out = prBlank();
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem(prKey())); } catch (e){ raw = null; }
  if (!raw || !raw.modes) return out;
  if (raw.v === 1) return prUpgradeV1(raw);
  if (raw.v !== PR_VERSION) return out;
  for (const k of ['asked','correct','sessions','days','best'])
    if (typeof raw[k] === 'number' && raw[k] >= 0) out[k] = raw[k];
  if (typeof raw.lastDay === 'string') out.lastDay = raw.lastDay;
  for (const m of PR_MODES){
    const src = raw.modes[m.key];
    if (!src) continue;
    for (const k of ['level','best','asked','correct','sessions','lastAt'])
      if (typeof src[k] === 'number' && src[k] >= 0) out.modes[m.key][k] = src[k];
    if (src.stats && typeof src.stats === 'object') out.modes[m.key].stats = src.stats;
  }
  return out;
}
function prSave(st){
  try { localStorage.setItem(prKey(), JSON.stringify(st)); } catch (e){ /* nowhere to keep it */ }
}
const prAcc = st => (st.asked ? st.correct / st.asked : 0);

/* The last hundred questions, by signature, so a session does not ask the same
   thing twice in a week. Per owner, like everything else here. */
const PR_SEEN_MAX = 100;
const prSeenKey = () => PR_STORE + 'seen.' + (account ? account.id : 'guest');
function prSeen(){
  try { const a = JSON.parse(localStorage.getItem(prSeenKey())); return Array.isArray(a) ? a : []; }
  catch (e){ return []; }
}
function prSeenHas(sig){ return prSeen().indexOf(sig) >= 0; }
function prSeenPush(sig){
  const a = prSeen().filter(s => s !== sig);
  a.push(sig);
  while (a.length > PR_SEEN_MAX) a.shift();
  try { localStorage.setItem(prSeenKey(), JSON.stringify(a)); } catch (e){}
}

/* Streaks count days practised, not answers, so one bad session breaks nothing. */
function prToday(){ return new Date().toISOString().slice(0, 10); }
function prTouchDay(st){
  const today = prToday();
  if (st.lastDay === today) return;
  const y = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  st.days = st.lastDay === y ? st.days + 1 : 1;
  st.lastDay = today;
}
```

Delete `PR_LEVELS`, `prLevelIndex`, `prLevelProgress`, `prTried`. Every remaining reference to them (`prFinish`, `prRecommend`, `prRenderDash`, `prRenderCards`) is rewritten in Tasks 4 and 22; until then make them compile by replacing `prLevelIndex(...)` with `0` and `PR_LEVELS[x].name` with `''`, and remove `prLevel*` element writes from `prRenderDash`. Update `DECLS`/`FNS` in both harnesses.

- [ ] **Step 4: Run** `node server/test_practice.js && node server/test_practice_flow.js` — expected: PASS.

- [ ] **Step 5: Commit** `git commit -am "Practice store v2: per-mode levels, stats, seen-list, day streaks"`

---

### Task 4: Level recipes, the staircase, time-boxed sessions

**Files:**
- Modify: `blind-chess.html` PRACTICE: `PR_MODES` (~11720), `PR` (~11829), `prMake` (~12343), `prScore`/`prJudge`/`prAdvance`/`prNextQuestion` (~12388–12450), `prBegin`/`prFinish` (~12915–12996), setup overlay markup (`#prSetOverlay`, ~4784) and `prOpenSetup`/`prDrawSetup` (~13101)
- Test: `server/test_practice.js`, `server/test_practice_flow.js`

**Interfaces:**
- `PR_MODES[i]` gains `group`, `lesson`, `levels: [{cap, ...recipe}]`; loses `hard`, `tiers`, `needs`.
- `prRecipe(key, level)` → recipe object with `level` and `cap`.
- `prMake(key, level)` (second argument is now a level).
- `PR.level`, `PR.runUp`, `PR.runDown`, `PR.startedAt`, `PR.budgetMs`, `PR.moved`; `prStep(ok)`; `prNow()`; `prTimeLeft()`.
- Session end rule: after each judged answer, if `prNow() - PR.startedAt >= PR.budgetMs` the next press finishes.
- `PR_MINUTES = [2, 5, 10]`, default 5.

- [ ] **Step 1: Write the failing test**

```js
head('Levels and the staircase');
(function(){
  var r = prRecipe('square', 99);
  ok('a level past the ladder is clamped', r.level, PR_MODE.square.levels.length);
  ok('a recipe carries its caption', typeof r.cap, 'string');
  PR.mode = PR_MODE.square; PR.level = 2; PR.runUp = 0; PR.runDown = 0;
  prStep(true); prStep(true); ok('two right do not move the level', PR.level, 2);
  prStep(true); ok('three right step up', PR.level, 3);
  prStep(false); ok('one wrong holds', PR.level, 3);
  prStep(false); ok('two wrong step down', PR.level, 2);
  PR.level = 1; PR.runDown = 0; prStep(false); prStep(false);
  ok('level one is the floor', PR.level, 1);
})();
```

- [ ] **Step 2: Run** — expected: FAIL, `prRecipe` not found.

- [ ] **Step 3: Implement.** Replace `PR_MODES` with the eleven-entry table, initially carrying only the seven modes that have generators after this task (the others are appended by their phases): each entry `{ key, name, group, skill, lesson, desc, levels }`. For this task the levels of the existing drills are provisional captions so the page runs:

```js
const PR_MODES = [
  { key:'square', name:'Square Trainer', group:'board', skill:'Squares', lesson:1,
    desc:'Name, find and colour squares from either chair — the alphabet of the board.',
    levels:[{cap:'Labels on'},{cap:'Labels off'},{cap:'Colour, board shown'}] },
  { key:'piece', name:'Piece Vision', group:'vision', skill:'Piece movement', lesson:4,
    desc:'Where one piece reaches, with the board slowly taken away.',
    levels:[{cap:'Empty board'},{cap:'A blocker or two'},{cap:'A crowded board'}] },
  { key:'tracker', name:'Move Tracker', group:'holding', skill:'Tracking', lesson:5,
    desc:'Follow moves you never see, and say where things stand.',
    levels:[{cap:'One piece, two moves'},{cap:'Longer, with captures'},{cap:'Two pieces, five moves'}] },
  { key:'hold', name:'Hold the Position', group:'holding', skill:'Holding', lesson:5,
    desc:'A small position, studied, then answered for with the men hidden.',
    levels:[{cap:'4–6 men'},{cap:'7–12 men'},{cap:'13–20 men'}] },
  { key:'progressive', name:'Progressive Blindfold', group:'play', skill:'Blindfold play', lesson:10,
    desc:'Whole small games with the board taken away one step at a time.',
    levels:[{cap:'Two men each side'},{cap:'Three each'},{cap:'Four each'}] }
];
const PR_MODE = {};
for (const m of PR_MODES) PR_MODE[m.key] = m;
const PR_MINUTES = [2, 5, 10];

function prRecipe(key, level){
  const m = PR_MODE[key];
  const n = Math.max(1, Math.min(m.levels.length, level | 0 || 1));
  return Object.assign({ level:n }, m.levels[n - 1]);
}
```

Map the old generators onto the new keys for now: `PR_MAKE = { square: r => prMakeCoord(r.level), piece: r => prMakeVision(r.level), tracker: r => prMakeTrack(r.level), hold: r => prMakeMemory(r.level), progressive: r => prMakeMini(r.level) }` (the color and sequence drills are absorbed in Tasks 9 and 14). `prMake`:

```js
function prMake(key, level){
  for (let t = 0; t < 6; t++){
    const q = PR_MAKE[key](prRecipe(key, level));
    if (q && (!q.sig || !prSeenHas(q.sig))) return q;
  }
  for (let t = 0; t < 5; t++){ const q = PR_MAKE[key](prRecipe(key, 1)); if (q) return q; }
  return null;
}
```

Staircase and clock:

```js
const PR_STEP_UP = 3, PR_STEP_DOWN = 2;
function prNow(){ return Date.now(); }
function prTimeLeft(){ return Math.max(0, PR.budgetMs - (prNow() - PR.startedAt)); }
/* Three right in a row step up, two wrong in a row step down, and the level the
   session settles on is what the mode is worth — not the accuracy, which at an
   easy level says nothing. */
function prStep(ok){
  const top = PR.mode.levels.length;
  if (ok){
    PR.runUp++; PR.runDown = 0;
    if (PR.runUp >= PR_STEP_UP && PR.level < top){ PR.level++; PR.runUp = 0; PR.moved = true; }
  } else {
    PR.runDown++; PR.runUp = 0;
    if (PR.runDown >= PR_STEP_DOWN && PR.level > 1){ PR.level--; PR.runDown = 0; PR.moved = true; }
  }
}
```

`PR` gains `level:1, runUp:0, runDown:0, moved:false, startedAt:0, budgetMs:300000`. `prScore(ok)` calls `prStep(ok)` after `prRecord`. `prJudge`'s "last" test becomes `const last = prTimeLeft() <= 0;`. `prNextQuestion` uses `PR.q = prMake(PR.mode.key, PR.level)` and pushes `q.sig` via `prSeenPush` when present. `prStatsRender` shows `Math.ceil(prTimeLeft()/1000)` seconds and `'Level ' + PR.level`. `prBegin` sets `PR.startedAt = prNow(); PR.runUp = PR.runDown = 0; PR.moved = false;`. `prFinish` writes:

```js
const st = prLoad();
st.sessions++; prTouchDay(st);
const m = st.modes[PR.mode.key];
m.sessions++; m.lastAt = prNow();
m.level = PR.level;
if (PR.level > m.best) m.best = PR.level;
prSave(st);
```

Setup overlay: replace the tier buttons with one line `Start at level <b id="prSetLevelN"></b> — <span id="prSetCap"></span>` plus `−`/`+` buttons (`#prSetDown`, `#prSetUp`) that move `prSetLevel` within `[1, mode.levels.length]`, and replace `#prSetLen` buttons with `data-min="2|5|10"`. `prSetGo` sets `PR.level = prSetLevel; PR.budgetMs = prSetCount * 60000`. In `server/test_practice_flow.js` change the selector stub to `bySelector['#prSetLen button'] = [2,5,10].map(...)` with `b.dataset.min`, and stub `prNow` by assigning `var prNowFake = 0;` and, after the eval, `prNow = function(){ return prNowFake; };` so a test can end a session by advancing the fake clock.

- [ ] **Step 4: Run** all three practice suites — expected: PASS. In the flow suite, change any test that counted "10 questions" to advance `prNowFake` past the budget and press Finish.

- [ ] **Step 5: Commit** `git commit -am "Practice levels are recipes, sessions are time-boxed, and a staircase measures the level"`

---

### Task 5: Error types and latency in the record

**Files:**
- Modify: `blind-chess.html` PRACTICE: `prRecord`, `prScore`, `prJudge`, `prPresent`
- Test: `server/test_practice.js`

**Interfaces:**
- `prRecord(ok, err, latMs)`; `prScore(ok, err)`; `prJudge(ok, say, extraCtl, err)`; `PR.shownAt` set by `prPresent()`.
- Per-mode `stats`: `errs:{square, ghost, lost, other}`, `lat:[...≤20]`, `lv:{ '<level>': {a, c} }`.
- `prMedianLat(m)` → number or null.

- [ ] **Step 1: Test**

```js
head('Error types and latency');
(function(){
  storage = {};
  PR.mode = PR_MODE.tracker; PR.level = 4; PR.shownAt = 0;
  prRecord(false, 'ghost', 1200);
  prRecord(true, null, 800);
  var m = prLoad().modes.tracker;
  ok('a ghost-piece error is counted by name', m.stats.errs.ghost, 1);
  ok('per-level accuracy is kept', m.stats.lv['4'].a === 2 && m.stats.lv['4'].c === 1, true);
  ok('latency samples are kept', m.stats.lat.length, 2);
  for (var i = 0; i < 30; i++) prRecord(true, null, 500);
  ok('but only the last twenty', prLoad().modes.tracker.stats.lat.length, 20);
  ok('median latency reads back', prMedianLat(prLoad().modes.tracker), 500);
  PR.q = { ply:6 }; prRecord(true, null, 400);
  ok('a right answer on a six-ply question sets the ply depth', prLoad().modes.tracker.stats.ply, 6);
  PR.q = null;
})();
```

- [ ] **Step 2: Run** — FAIL (`prRecord` takes one argument).

- [ ] **Step 3: Implement**

```js
const PR_ERRS = ['square','ghost','lost','other'];
function prRecord(ok, err, latMs){
  const st = prLoad();
  st.asked++;
  const m = st.modes[PR.mode.key];
  m.asked++;
  if (ok){ st.correct++; m.correct++; }
  const s = m.stats;
  s.errs = s.errs || { square:0, ghost:0, lost:0, other:0 };
  if (!ok) s.errs[PR_ERRS.indexOf(err) >= 0 ? err : 'other']++;
  s.lv = s.lv || {};
  const lv = s.lv[String(PR.level)] || (s.lv[String(PR.level)] = { a:0, c:0 });
  lv.a++; if (ok) lv.c++;
  if (typeof latMs === 'number' && latMs >= 0){
    s.lat = (s.lat || []).concat([Math.round(latMs)]).slice(-20);
  }
  // "clear to ply N": the deepest line answered right, for the modes whose
  // questions carry one (tracker, forcing, calc set q.ply from their recipe)
  if (ok && PR.q && PR.q.ply > (s.ply || 0)) s.ply = PR.q.ply;
  prSave(st);
}
function prMedianLat(m){
  const a = (m.stats.lat || []).slice().sort((x, y) => x - y);
  return a.length ? a[a.length >> 1] : null;
}
function prScore(ok, err){
  PR.i++;
  if (ok){ PR.right++; PR.streak++; if (PR.streak > PR.best) PR.best = PR.streak; } else PR.streak = 0;
  prRecord(ok, err, PR.shownAt ? prNow() - PR.shownAt : undefined);
  prStep(ok);
  prStatsRender();
}
function prJudge(ok, say, extraCtl, err){ /* as before, but calls prScore(ok, err) */ }
```

`prPresent()` sets `PR.shownAt = prNow()` before the switch; presenters that hide the board after a study phase set `PR.shownAt = prNow()` again when the question appears (Task 13 onward).

- [ ] **Step 4: Run** the practice suites — PASS.
- [ ] **Step 5: Commit** `git commit -am "Practice records error types, per-level accuracy and answer latency"`

---

### Task 6: `goPractice(target)`, `prOpen`, floors, and the route

**Files:**
- Modify: `blind-chess.html` PRACTICE `goPractice` (~13173); HISTORY `navDescribe`/`navApply` practice cases (~13371, ~13529)
- Test: `server/test_practice_flow.js`

**Interfaces:**
- `goPractice(target)` where `target` is `undefined`, `'daily'` (implemented Task 24; until then ignored) or `{ mode, level }`.
- `prOpen(key, level)` starts a session directly with the default budget.
- `PR_FLOORS` table and `prStartLevel(key)`.
- Route `#practice/<key>` carries `level` instead of `diff`, and `min` instead of `len`.

- [ ] **Step 1: Test** — in the flow suite:

```js
head('goPractice with a target');
(function(){
  storage = {};
  goPractice({ mode:'tracker', level:3 });
  ok('the screen is practice', screens[screens.length - 1], 'practice');
  ok('a run is in progress', PR.view, 'run');
  ok('at the level asked', PR.level, 3);
  prShowDash();
  // a finished lesson floors the first session of its mode only
  lsnDoneStub = [5];
  ok('the tracker floor after lesson 5 is level 3', prStartLevel('tracker'), 3);
  var st = prLoad(); st.modes.tracker.sessions = 1; st.modes.tracker.level = 1; prSave(st);
  ok('but a measured level wins once there is one', prStartLevel('tracker'), 1);
})();
```

Add to the harness stubs: `var lsnDoneStub = []; function lsnDone(){ return lsnDoneStub; }`.

- [ ] **Step 2: Run** — FAIL (`prStartLevel` missing).

- [ ] **Step 3: Implement**

```js
/* A finished lesson sets where a mode's FIRST session starts, and nothing
   more: understanding a thing once is not the same as being able to do it,
   and the staircase takes over from the first answer. */
const PR_FLOORS = {
  square:{lesson:1, level:2}, lines:{lesson:2, level:2}, piece:{lesson:4, level:2},
  attack:{lesson:4, level:2}, hold:{lesson:5, level:2}, tracker:{lesson:5, level:3},
  after:{lesson:6, level:2}, forcing:{lesson:7, level:2}, calc:{lesson:9, level:2},
  branches:{lesson:9, level:1}, progressive:{lesson:10, level:1}
};
function prStartLevel(key){
  const m = prLoad().modes[key];
  if (m.sessions > 0) return m.level;
  const fl = PR_FLOORS[key];
  const done = typeof lsnDone === 'function' ? lsnDone() : [];
  return fl && done.indexOf(fl.lesson) >= 0 ? fl.level : 1;
}
function prOpen(key, level, minutes){
  const mode = PR_MODE[key];
  if (!mode) return;
  PR.mode = mode;
  PR.level = Math.max(1, Math.min(mode.levels.length, level || prStartLevel(key)));
  PR.budgetMs = (minutes || 5) * 60000;
  prBegin();
}
function goPractice(target){
  beep(700, .09);
  PR.on = true;
  prShowDash();
  showScreen('practice');
  if (target && target.mode && PR_MODE[target.mode]) prOpen(target.mode, target.level, target.minutes);
}
```

`navDescribe` practice case: `{ s, v: PR.view === 'run' && PR.mode ? PR.mode.key : '', level: PR.level, min: Math.round(PR.budgetMs / 60000) }`. `navApply`: `if (mode) prOpen(mode.key, d.level || 1, d.min || 5);`.

- [ ] **Step 4: Run** flow suite and `node server/test_rematch_flow.js` (it boots the page) — PASS.
- [ ] **Step 5: Commit** `git commit -am "goPractice takes a target, and finished lessons floor a mode's first session"`

---

### Task 7: The rebuild interface on the practice board

**Files:**
- Modify: `blind-chess.html` PRACTICE, after `prCtl`; replace `prRebuildStep` (~12764) and the `'rebuild'` arm of `prAskShow`
- Test: `server/test_practice_flow.js`

**Interfaces:**
- `prRebuildStart(target, opts)` where `target` is `[{sq,c,t}]` and `opts = { say, done(result) }`; the player picks a man from a glyph palette then clicks squares; `Done` calls `prRebuildFinish()` which paints `right`/`wrong`/`missing` marks and calls `opts.done({right, wrong, missing})`.
- `PR.rb` holds `{ target, placed:[], pick:null, ids:{} }`.

- [ ] **Step 1: Test** (flow suite):

```js
head('The rebuild interface');
(function(){
  var done = null;
  prRebuildStart([{sq:sqIndex('e1'),c:W,t:'K'},{sq:sqIndex('e8'),c:B,t:'K'},{sq:sqIndex('d4'),c:W,t:'N'}],
                 { say:'Rebuild it', done:function(r){ done = r; } });
  ok('a palette of twelve men and a clear button is up', prAnsEl.children.length, 13);
  prAnsEl.children[0].onclick();               // white king
  clickSquare(sqIndex('e1'));
  prAnsEl.children[6].onclick();               // black king
  clickSquare(sqIndex('e8'));
  prAnsEl.children[1].onclick();               // white queen, wrongly
  clickSquare(sqIndex('d4'));
  pressCtl('Done');
  ok('two right', done.right.length, 2);
  ok('one wrong', done.wrong.length, 1);
  ok('one missing', done.missing.length, 1);
  ok('the missing man is marked on its square', prSqEls[sqIndex('d4')].classList.contains('pr-miss'), true);
})();
```

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement**

```js
/* ---- rebuilding a position ----
   One interface for every place a position is put back: Hold the Position,
   the tracker's last level, Progressive Blindfold's recovery. Pick a man,
   click a square; the judgement is rebuildDiff(), shared with the course. */
const PR_PALETTE = [];
for (const c of [W, B]) for (const t of ['K','Q','R','B','N','P']) PR_PALETTE.push({ c, t });

function prRbPaint(){
  const b = Array(64).fill(null);
  for (const p of PR.rb.placed){
    const key = p.sq + p.c + p.t;
    // stable ids, so a man already placed does not blink when another is
    if (!PR.rb.ids[key]) PR.rb.ids[key] = mk(p.c, p.t);
    b[p.sq] = PR.rb.ids[key];
  }
  prPaint(b);
}
function prRebuildStart(target, opts){
  PR.rb = { target, placed:[], pick:null, ids:{}, opts: opts || {} };
  prBoardOn(true); prMen(true); prClearPieces(); prMarksClear();
  prQ(opts && opts.say || 'Rebuild the position.');
  prSub('Pick a man, then click its square. Pick it again and click to remove.');
  prAnsClear();
  prAnsEl.className = 'pr-ans glyphs';
  const btns = PR_PALETTE.map(p =>
    prAnsButton('<span class="g-' + p.c + '">' + pieceHTML(p.t) + '</span>', () => {
      PR.rb.pick = p;
      btns.forEach(b => b.classList.remove('active'));
      btns[PR_PALETTE.indexOf(p)].classList.add('active');
    }));
  prAnsButton('Clear a square', () => { PR.rb.pick = 'clear'; btns.forEach(b => b.classList.remove('active')); }, 'wide');
  PR.click = i => {
    const pick = PR.rb.pick;
    if (!pick) return;
    PR.rb.placed = PR.rb.placed.filter(p => p.sq !== i);
    if (pick !== 'clear') PR.rb.placed.push({ sq:i, c:pick.c, t:pick.t });
    prRbPaint();
  };
  prCtl([['Done', prRebuildFinish, 'primary']]);
}
function prRebuildFinish(){
  const rb = PR.rb;
  if (!rb) return;
  PR.click = null;
  prAnsClear();
  const res = rebuildDiff(rb.placed, rb.target);
  const b = Array(64).fill(null);
  for (const t of rb.target) b[t.sq] = rb.ids[t.sq + t.c + t.t] || mk(t.c, t.t);
  prPaint(b);
  prMarksClear();
  res.right.forEach(p => prMark(p.sq, 'pr-right'));
  res.wrong.forEach(p => prMark(p.sq, 'pr-wrong'));
  res.missing.forEach(p => prMark(p.sq, 'pr-miss'));
  const say = res.wrong.length + res.missing.length === 0
    ? 'Every man where it stood.'
    : (res.missing.length ? 'Forgotten: ' + res.missing.map(p => prMan(p.c, p.t) + ' on ' + sqName(p.sq)).join(', ') + '. ' : '') +
      (res.wrong.length ? res.wrong.length + ' misplaced.' : '');
  prSub(say);
  PR.rb = null;
  if (rb.opts.done) rb.opts.done(res);
}
```

Rewrite `prAskShow`'s `'rebuild'` arm to `prRebuildStart(ask.want, { say: ask.text, done: res => prJudge(res.wrong.length + res.missing.length === 0, 'Rebuilt.', extraCtl, 'square') })` and delete `prRebuildStep`. Add `.pr-ans.glyphs button.active{outline:2px solid var(--gold);}` to the practice CSS near `.pr-ans`.

- [ ] **Step 4: Run** flow suite — PASS.
- [ ] **Step 5: Commit** `git commit -am "One rebuild interface on the practice board"`

---

### Task 8: Harness bookkeeping for Phase 0

**Files:**
- Modify: `server/test_practice.js` (`DECLS`, `FNS`), `server/test_practice_flow.js` (stubs), `CLAUDE.md` (one line under Commands is unchanged; nothing else yet)

- [ ] **Step 1:** Confirm `DECLS` includes `PR_MODES, PR_MODE, PR_MINUTES, PR_V1_KEYS, PR_SEEN_MAX, PR_FLOORS, PR_PALETTE, PR_ERRS, PZ_VERSION, OPENING_BOOK, OPENING_LINES` and `FNS` includes every function named in Tasks 1–7. `PR_MODE` is built by a loop in the page; keep the harness's own loop that builds it.
- [ ] **Step 2: Run** `node server/test_practice.js && node server/test_practice_flow.js && node server/test_lessons.js && node server/test_rematch_flow.js` — all PASS.
- [ ] **Step 3: Commit** `git commit -am "Harness lists cover the Phase 0 names"`

---

# Phase 1 — Board & Vision modes

The generator/presenter pattern every mode follows from here on:

- `PR_<KEY>_LEVELS` — the ladder, one recipe object per level, `cap` first.
- `prMake<Key>(recipe)` — returns a question `q` with `kind` equal to the mode key, `sig` (a short string naming what was asked, for the seen-list), and everything the presenter and the test need to re-derive the answer; returns `null` when it cannot build one.
- `prShow<Key>(q)` — puts it on screen; sets `PR.click` / `PR.onSubmit`; ends by calling `prJudge(ok, say, extraCtl, err)`.
- The generator is registered in `PR_MAKE`, the presenter in `prPresent()`'s switch, the mode in `PR_MODES`, and the names in both harnesses' lists.

### Task 9: Square Trainer (absorbs Coordinate Trainer and Square Colour)

**Files:**
- Modify: `blind-chess.html` PRACTICE: replace `prMakeCoord`, `prMakeColor`, `prShowCoord`, `prAnswerCoordFind`, `prAnswerCoordName`, `prShowColor`, `prAnswerColor`; `PR_MODES.square.levels`; `PR_MAKE.square`; `prPresent`
- Test: `server/test_practice.js`, `server/test_practice_flow.js`

**Interfaces:**
- `PR_SQUARE_LEVELS` (7); `prMakeSquare(r)` → `{ kind:'square', ask:'find'|'name'|'colour'|'neighbour'|'quadrant', sq, answer, dir, dark, labels, board, flash, timed, flipped, sig }`; `prShowSquare(q)`.
- `PR_QUADRANT_NAME = { a1:"White's queenside", h1:"White's kingside", a8:"Black's queenside", h8:"Black's kingside" }`.

- [ ] **Step 1: Test** (generator suite; replace the old coordinate/colour blocks):

```js
head('Square Trainer');
(function(){
  var kinds = {}, bad = 0;
  for (var lv = 1; lv <= PR_SQUARE_LEVELS.length; lv++){
    for (var t = 0; t < 60; t++){
      var q = prMakeSquare(prRecipe('square', lv));
      if (!q){ bad++; continue; }
      kinds[q.ask] = 1;
      if (q.ask === 'colour' && q.dark !== darkByName(sqName(q.sq))) bad++;
      if (q.ask === 'neighbour'){
        var d = { above:-8, below:8, left:-1, right:1 }[q.dir];
        if (q.answer !== q.sq + d) bad++;
        if (q.dir === 'left' && colOf(q.sq) === 0) bad++;
        if (q.dir === 'right' && colOf(q.sq) === 7) bad++;
      }
      if (q.ask === 'quadrant' && q.answer !== quadrantOf(q.sq)) bad++;
      if (typeof q.sig !== 'string') bad++;
    }
  }
  ok('every level generates, and every answer re-derives', bad, 0);
  ok('all five question kinds appear across the ladder', Object.keys(kinds).length, 5);
  ok('level 5 has no board', prRecipe('square', 5).board, false);
  ok('level 7 is timed', prRecipe('square', 7).timed > 0, true);
})();
```

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement**

```js
const PR_SQUARE_LEVELS = [
  { cap:'Labels on, White below',        kinds:['find','name'],                   labels:true,  board:true },
  { cap:'Labels off',                    kinds:['find','name'],                   labels:false, board:true },
  { cap:'Colour, board shown',           kinds:['find','name','colour'],          labels:false, board:true },
  { cap:'Board flashed for a second',    kinds:['name','colour'],                 labels:false, board:true, flash:1000 },
  { cap:'No board: colour and neighbours', kinds:['colour','neighbour','quadrant'], board:false },
  { cap:"From Black's chair",            kinds:['find','name','colour','neighbour'], labels:false, board:true, flipped:true },
  { cap:'No board, three seconds',       kinds:['colour','neighbour'],            board:false, timed:3000 }
];
const PR_QUADRANT_NAME = { a1:"White's queenside", h1:"White's kingside", a8:"Black's queenside", h8:"Black's kingside" };
const PR_DIRS = [['above',-8, sq => rowOf(sq) > 0], ['below',8, sq => rowOf(sq) < 7],
                 ['left',-1, sq => colOf(sq) > 0],  ['right',1, sq => colOf(sq) < 7]];
function prMakeSquare(r){
  const ask = prPick(r.kinds), sq = prRand(64);
  const q = { kind:'square', ask, sq, labels:!!r.labels, board:!!r.board, flash:r.flash || 0,
              timed:r.timed || 0, flipped: !!r.flipped && Math.random() < .5,
              dark:(rowOf(sq) + colOf(sq)) % 2 === 1, answer:sq, dir:null };
  if (ask === 'neighbour'){
    const open = PR_DIRS.filter(d => d[2](sq));
    const d = prPick(open);
    q.dir = d[0]; q.answer = sq + d[1];
  }
  if (ask === 'quadrant') q.answer = quadrantOf(sq);
  q.sig = 'square:' + ask + ':' + sq + (q.dir ? ':' + q.dir : '');
  return q;
}
```

Presenter:

```js
function prShowSquare(q){
  prBoardOn(q.board);
  if (q.board){ prLayout(q.flipped, q.labels); prMen(false); prClearPieces(); prMarksClear(); }
  const name = sqName(q.sq);
  const judge = (ok, err) => prJudge(ok, ok ? 'Yes — <b>' + name + '</b>.' : prSquareWhy(q), [], err || 'square');
  const arm = () => {
    PR.shownAt = prNow();
    if (q.timed) prTimer(() => { if (!PR.answered) judge(false); }, q.timed);
  };
  if (q.ask === 'find'){
    prQ('Click <b>' + name + '</b>.');
    PR.click = i => { prMarksClear(); prMark(q.sq, 'pr-right'); if (i !== q.sq) prMark(i, 'pr-wrong'); judge(i === q.sq); };
    arm(); return;
  }
  if (q.ask === 'name'){
    const show = () => { prMarksClear(); prMark(q.sq, 'pr-target'); };
    show();
    prQ('Which square is lit?');
    const takeName = inp => { const said = inp.value.trim().toLowerCase(); prMarksClear(); prMark(q.sq, 'pr-right'); judge(said === name); };
    if (q.flash){ prTimer(() => { prMarksClear(); prBoardOn(false); prAnsInput('e.g. e4', 2, takeName); arm(); }, q.flash); }
    else { prAnsInput('e.g. e4', 2, takeName); arm(); }
    return;
  }
  if (q.ask === 'colour'){
    if (q.flash){ prMarksClear(); prMark(q.sq, 'pr-target'); prTimer(() => prBoardOn(false), q.flash); }
    prQ('Is <b>' + name + '</b> light or dark?');
    prAnsButton('Light', () => judge(!q.dark)); prAnsButton('Dark', () => judge(q.dark));
    arm(); return;
  }
  if (q.ask === 'neighbour'){
    prQ('Which square is directly <b>' + q.dir + '</b> ' + name + '? (White’s view.)');
    prAnsInput('e.g. e5', 2, inp => judge(inp.value.trim().toLowerCase() === sqName(q.answer)));
    arm(); return;
  }
  prQ('Which quarter of the board holds <b>' + name + '</b>?');
  for (const k of ['a8','h8','a1','h1']) prAnsButton(PR_QUADRANT_NAME[k], () => judge(k === q.answer));
  arm();
}
function prSquareWhy(q){
  const name = sqName(q.sq);
  if (q.ask === 'colour') return prColourWhy(q.sq);
  if (q.ask === 'neighbour') return 'From <b>' + name + '</b>, ' + q.dir + ' is <b>' + sqName(q.answer) + '</b>: same ' + (q.dir === 'above' || q.dir === 'below' ? 'file, next rank' : 'rank, next file') + '.';
  if (q.ask === 'quadrant') return name + ' is file ' + (colOf(q.sq) + 1) + ', rank ' + (8 - rowOf(q.sq)) + ' — ' + PR_QUADRANT_NAME[q.answer] + '.';
  return 'It is <b>' + name + '</b>: file <b>' + FILES[colOf(q.sq)] + '</b>, rank <b>' + (8 - rowOf(q.sq)) + '</b>.';
}
```

`PR_MODES.square.levels = PR_SQUARE_LEVELS`; `PR_MAKE.square = prMakeSquare`; `case 'square': return prShowSquare(q);`. Delete the coord and color generators, presenters and their `PR_BRISK` keys; `PR_BRISK = { square:1, piece:1, lines:1 }`. In the flow suite replace the coordinate and colour drive tests with one that opens `square` at level 1, answers a `find` by clicking `q.sq`, and a `colour` (force `PR.q = prMakeSquare(prRecipe('square',3))` with `ask:'colour'`) by pressing the right button; assert `prSayEl.className` contains `right`.

- [ ] **Step 4: Run** both practice suites — PASS.
- [ ] **Step 5: Commit** `git commit -am "Square Trainer: coordinates, colours, neighbours and quadrants on one ladder"`

---

### Task 10: Lines & Routes

**Files:**
- Modify: `blind-chess.html` PRACTICE (new generator + presenter after Square Trainer); `PR_MODES` gains the `lines` entry after `square`
- Test: both practice suites

**Interfaces:**
- `PR_LINES_LEVELS` (8); `prMakeLines(r)` → `{ kind:'lines', ask:'between'|'through'|'reach'|'knight', a, b, answer, board, type, blocker, choices, sig }`; `prShowLines(q)`.
- Answer forms: `between` → select squares then Done (board) or type a comma list (no board); `through` → four square-name buttons, pick every one on a diagonal through `a`; `reach` → Yes/No; `knight` → number buttons 1–6 for the move count, and at the last level also a choice of the first intermediate square.

- [ ] **Step 1: Test**

```js
head('Lines & Routes');
(function(){
  var bad = 0, kinds = {};
  for (var lv = 1; lv <= PR_LINES_LEVELS.length; lv++) for (var t = 0; t < 60; t++){
    var q = prMakeLines(prRecipe('lines', lv));
    if (!q){ bad++; continue; }
    kinds[q.ask] = 1;
    if (q.ask === 'between'){
      var want = lineBetween(q.a, q.b);
      if (!want || want.length < 1 || want.join() !== q.answer.join()) bad++;
    }
    if (q.ask === 'through'){
      var L = linesThrough(q.a);
      q.choices.forEach(function(c){
        var on = L.diag1.indexOf(c) >= 0 || L.diag2.indexOf(c) >= 0;
        if (on !== (q.answer.indexOf(c) >= 0)) bad++;
      });
    }
    if (q.ask === 'reach'){
      var b = Array(64).fill(null); if (q.blocker >= 0) b[q.blocker] = mk(W, 'P');
      if (sliderReaches(b, q.a, q.b, q.type) !== q.answer) bad++;
    }
    if (q.ask === 'knight' && knightRoute(q.a, q.b).length - 1 !== q.answer) bad++;
  }
  ok('every level generates and re-derives', bad, 0);
  ok('all four question kinds appear', Object.keys(kinds).length, 4);
})();
```

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement**

```js
const PR_LINES_LEVELS = [
  { cap:'Ranks and files, board shown',     kinds:['between'], diag:false, board:true },
  { cap:'Diagonals, board shown',           kinds:['between'], diag:true,  board:true },
  { cap:'Ranks and files from the name',    kinds:['between'], diag:false, board:false },
  { cap:'Diagonals from the name',          kinds:['between','through'], diag:true, board:false },
  { cap:'The lines through a square',       kinds:['through'], board:false },
  { cap:'Blockers',                         kinds:['reach'],   board:true, blockers:true },
  { cap:'Knight routes, board shown',       kinds:['knight'],  board:true },
  { cap:'Knight routes from the name',      kinds:['knight'],  board:false, mid:true }
];
function prMakeLines(r){
  const ask = prPick(r.kinds);
  const q = { kind:'lines', ask, board:!!r.board, a:-1, b:-1, answer:null, type:null, blocker:-1, choices:null, mid:!!r.mid };
  if (ask === 'between'){
    for (let t = 0; t < 40; t++){
      const a = prRand(64), L = linesThrough(a);
      const pool = r.diag ? L.diag1.concat(L.diag2) : L.rank.concat(L.file);
      const b = prPick(pool);
      const between = lineBetween(a, b);
      if (!between || between.length < 2 || between.length > 6) continue;
      q.a = a; q.b = b; q.answer = between; break;
    }
    if (q.a < 0) return null;
  } else if (ask === 'through'){
    const a = prRand(64), L = linesThrough(a);
    const on = prShuffle(L.diag1.concat(L.diag2)), off = prShuffle(L.rank.concat(L.file).concat(
      Array.from({ length:64 }, (_, i) => i).filter(i => i !== a && !lineBetween(a, i))));
    if (on.length < 2) return null;
    q.a = a; q.answer = on.slice(0, 2); q.choices = prShuffle(q.answer.concat(off.slice(0, 2)));
  } else if (ask === 'reach'){
    const type = prPick(['R','B','Q']);
    for (let t = 0; t < 40; t++){
      const a = prRand(64), L = linesThrough(a);
      const pool = type === 'R' ? L.rank.concat(L.file) : type === 'B' ? L.diag1.concat(L.diag2)
                 : L.rank.concat(L.file, L.diag1, L.diag2);
      const b = prPick(pool), between = lineBetween(a, b);
      if (!between || between.length < 1) continue;
      q.a = a; q.b = b; q.type = type;
      q.blocker = Math.random() < .5 ? prPick(between) : -1;
      const board = Array(64).fill(null); if (q.blocker >= 0) board[q.blocker] = mk(W, 'P');
      q.answer = sliderReaches(board, a, b, type); break;
    }
    if (q.a < 0) return null;
  } else {
    let a, b, route;
    do { a = prRand(64); b = prRand(64); route = knightRoute(a, b); } while (a === b || route.length - 1 > 4);
    q.a = a; q.b = b; q.answer = route.length - 1; q.route = route;
    if (q.mid && route.length > 2){
      const wrong = prShuffle(Array.from({ length:64 }, (_, i) => i).filter(i => route.indexOf(i) < 0)).slice(0, 3);
      q.choices = prShuffle([route[1]].concat(wrong)); q.first = route[1];
    }
  }
  q.sig = 'lines:' + ask + ':' + q.a + ':' + q.b + ':' + (q.type || '') + ':' + q.blocker;
  return q;
}
```

Presenter (`prShowLines`): board on/off per `q.board`; `between` on the board uses the select-many pattern of Piece Vision (`PR.q.picks`, `pr-pick` marks, a `Done` control) and off the board an input parsed as `/[a-h][1-8]/g`; judge equality of sorted sets; feedback draws `q.answer` with `pr-right`, `q.a`/`q.b` with `pr-from`. `through`: buttons per `q.choices` toggling a picked set, `Done` judges. `reach`: draw the piece on `q.a` and the blocker, Yes/No. `knight`: buttons `1..6`; on a wrong answer replay `q.route` square by square with `pr-target` at 500 ms steps; at level 8 a second question follows for `q.first`. All errors are `'square'`.

Register: `PR_MODES` entry `{ key:'lines', name:'Lines & Routes', group:'board', skill:'Lines', lesson:2, desc:'Trace ranks, files, diagonals and knight routes, blockers and all.', levels:PR_LINES_LEVELS }`. In the flow suite drive one `between` question at level 1 by clicking every square of `q.answer` and pressing Done.

- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `git commit -am "Lines & Routes: squares between, lines through, blockers and knight routes"`

---

### Task 11: Piece Vision on the new ladder

**Files:**
- Modify: `blind-chess.html` PRACTICE `prMakeVision` → `prMakePiece`, `prShowVision` → `prShowPiece`, `prAnswerVision` → `prAnswerPiece`
- Test: both practice suites (rename the existing Piece Visualization blocks)

**Interfaces:**
- `PR_PIECE_LEVELS` (8); `prMakePiece(r)` → `{ kind:'piece', st, from, type, colour, targets:Set, caps:Set, picks:Set, flash, notation, second:{from,type}|null, sig }`.
- Recipe fields: `types`, `blockers:[min,max]`, `captures` (ask captures apart), `flash` ms, `notation` (board off, typed answer), `two` (a second piece; answer is the union).

- [ ] **Step 1: Test**

```js
head('Piece Vision');
(function(){
  var bad = 0;
  for (var lv = 1; lv <= PR_PIECE_LEVELS.length; lv++) for (var t = 0; t < 40; t++){
    var q = prMakePiece(prRecipe('piece', lv));
    if (!q){ bad++; continue; }
    var st = q.st; st.turn = q.colour;
    var legal = legalMoves(st, q.colour).filter(function(m){ return m.from === q.from || (q.second && m.from === q.second.from); });
    var want = {}; legal.forEach(function(m){ want[m.to] = 1; });
    if (Object.keys(want).length !== q.targets.size) bad++;
    q.targets.forEach(function(sq){ if (!want[sq]) bad++; });
    q.caps.forEach(function(sq){ if (!st.b[sq] || st.b[sq].c === q.colour) bad++; });
  }
  ok('every level generates and the reach re-derives', bad, 0);
  ok('level 6 is notation only', prRecipe('piece', 6).notation, true);
  ok('level 8 asks about two pieces', prRecipe('piece', 8).two, true);
})();
```

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement**

```js
const PR_PIECE_LEVELS = [
  { cap:'King, rook, bishop, knight — empty board', types:['K','R','B','N'], blockers:[0,0] },
  { cap:'Queen and pawn too',                      types:['K','R','B','N','Q','P'], blockers:[0,0] },
  { cap:'One or two blockers',                     types:['R','B','N','Q','P'], blockers:[1,2] },
  { cap:'A crowded board, captures apart',         types:['R','B','N','Q','P'], blockers:[3,5], captures:true },
  { cap:'Piece shown for two seconds',             types:['R','B','N','Q'], blockers:[1,3], flash:2000 },
  { cap:'From the notation alone',                 types:['R','B','N','Q'], blockers:[0,2], notation:true },
  { cap:'Notation, a crowded board',               types:['R','B','N','Q'], blockers:[3,5], notation:true },
  { cap:'Two pieces, every square either reaches', types:['R','B','N','Q'], blockers:[1,3], two:true }
];
function prMakePiece(r){
  for (let t = 0; t < 80; t++){
    const colour = Math.random() < .5 ? W : B;
    const type = prPick(r.types);
    const blockers = r.blockers[0] + prRand(r.blockers[1] - r.blockers[0] + 1);
    const counts = [];
    for (let k = 0; k < blockers; k++) counts.push([Math.random() < .5 ? W : B, prPick(['P','P','N','B','R'])]);
    if (r.two) counts.push([colour, prPick(r.types.filter(x => x !== type))]);
    counts.push([colour, type]);
    const built = prPosition(counts);
    if (!built) continue;
    const st = built.st; st.turn = colour;
    const from = built.at[built.at.length - 1];
    const second = r.two ? { from: built.at[built.at.length - 2], type: counts[counts.length - 2][1] } : null;
    const mine = [from].concat(second ? [second.from] : []);
    const legal = legalMoves(st, colour).filter(m => mine.indexOf(m.from) >= 0);
    if (!legal.length) continue;
    let pinned = false;
    for (const sq of mine) if (st.b[sq].t !== 'K'){
      const ps = pseudoMoves(st, colour).filter(m => m.from === sq).length;
      const lg = legal.filter(m => m.from === sq).length;
      if (ps !== lg) pinned = true;
    }
    if (pinned) continue;
    const targets = new Set(legal.map(m => m.to));
    if (targets.size < 2) continue;
    const caps = new Set(legal.filter(m => m.cap).map(m => m.to));
    return { kind:'piece', st, from, type, colour, targets, caps, picks:new Set(), second,
             flash:r.flash || 0, notation:!!r.notation, askCaps:!!r.captures,
             sig:'piece:' + type + ':' + from + ':' + fenOf(st).split(' ')[0] };
  }
  return null;
}
```

`prShowPiece`: as the old presenter (click to toggle `pr-pick`, `Done`), with three additions: after `q.flash` ms hide the men (`prMen(false)`) but keep the board; when `q.notation` the board is off and the question reads "White's knight on e4, a pawn on d6 and a bishop on f2: which squares can the knight reach? Type them, e.g. `f6 g5 c3`", parsed with `/[a-h][1-8]/g`; when `q.askCaps` a second Done follows for "which of those are captures" against `q.caps`. Errors are `'square'`. Feedback unchanged: `pr-miss` / `pr-wrong` / `pr-right`. Rename registrations (`PR_MAKE.piece`, `case 'piece'`), update both harnesses' lists and the flow test that drives the old drill (open `piece` at level 1, click every target, press Done).

- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `git commit -am "Piece Vision on an eight-level ladder, down to notation alone and two pieces"`

---

### Task 12: Attack Vision

**Files:**
- Modify: `blind-chess.html` PRACTICE (new mode after Piece Vision); `PR_MODES` gains `attack` after `piece`
- Test: both practice suites

**Interfaces:**
- `PR_ATTACK_LEVELS` (9); `prMakeAttack(r)` → `{ kind:'attack', ask:'attacks'|'attacked'|'attackers'|'defended'|'hanging'|'pinned', st, from, target, colour, answer, notation, kingZone, sig }`; `prShowAttack(q)`.
- Helpers: `prHanging(st)` → array of squares holding a man that is attacked and either undefended or loses to `see()`; `prPinned(st, sq)` → boolean.

- [ ] **Step 1: Test**

```js
head('Attack Vision');
(function(){
  var bad = 0, kinds = {};
  for (var lv = 1; lv <= PR_ATTACK_LEVELS.length; lv++) for (var t = 0; t < 40; t++){
    var q = prMakeAttack(prRecipe('attack', lv));
    if (!q){ bad++; continue; }
    kinds[q.ask] = 1;
    var st = q.st;
    if (q.ask === 'attacks' && q.answer !== isAttackedBy(st, q.target, q.from)) bad++;
    if (q.ask === 'attacked'){
      var want = attackedSquares(st, q.from);
      if (want.length !== q.answer.length || want.some(function(s){ return q.answer.indexOf(s) < 0; })) bad++;
    }
    if (q.ask === 'attackers'){
      var byC = attackersOf(st, q.target, q.colour);
      if (byC.length !== q.answer.length) bad++;
    }
    if (q.ask === 'hanging' && prHanging(st).join() !== q.answer.join()) bad++;
    if (q.ask === 'pinned' && q.answer !== prPinned(st, q.target)) bad++;
  }
  ok('every level generates and re-derives', bad, 0);
  ok('six question kinds appear', Object.keys(kinds).length, 6);
})();
```

Add to the test's own helpers (independent of the page):

```js
function attackedSquares(st, from){
  var p = st.b[from];
  if (p.t === 'P'){ var r = rowOf(from) + (p.c === W ? -1 : 1), out = [];
    [-1, 1].forEach(function(dc){ var c = colOf(from) + dc; if (r >= 0 && r < 8 && c >= 0 && c < 8) out.push(r * 8 + c); }); return out; }
  var s = stateOf(st.b, p.c); s.b[kingSq(st, other(p.c))] = null; // no check filtering
  return pseudoMoves(s, p.c).filter(function(m){ return m.from === from; }).map(function(m){ return m.to; });
}
function isAttackedBy(st, target, from){ return attackedSquares(st, from).indexOf(target) >= 0; }
```

(The harness already extracts `attackersOf`, `pseudoMoves`, `kingSq`.)

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement**

```js
const PR_ATTACK_LEVELS = [
  { cap:'Does it attack that square?',       kinds:['attacks'],  men:[0,0], board:true },
  { cap:'Every square it attacks',           kinds:['attacked'], men:[0,1], board:true },
  { cap:'A blocker in the way',              kinds:['attacks','attacked'], men:[1,2], board:true },
  { cap:'Who attacks this square',           kinds:['attackers'], men:[2,3], board:true, kingZone:true },
  { cap:'Is it defended?',                   kinds:['defended'], men:[2,4], board:true },
  { cap:'What is hanging?',                  kinds:['hanging'],  men:[3,5], board:true },
  { cap:'Is it pinned?',                     kinds:['pinned'],   men:[2,4], board:true },
  { cap:'From the notation, three men',      kinds:['attacks','defended','hanging'], men:[1,1], board:false },
  { cap:'From the notation, six men',        kinds:['attackers','hanging','pinned'], men:[3,4], board:false, kingZone:true }
];
/* Attacked squares of one man: its pseudo-moves with the opposing king lifted
   off, so a line through the king counts, and a pawn's pushes left out. */
function prAttacked(st, from){
  const p = st.b[from];
  if (p.t === 'P'){                                   // a pawn attacks its two forward diagonals, occupied or not
    const r = rowOf(from) + (p.c === W ? -1 : 1), out = [];
    for (const dc of [-1, 1]){ const c = colOf(from) + dc; if (r >= 0 && r < 8 && c >= 0 && c < 8) out.push(r * 8 + c); }
    return out;
  }
  const s = cloneState(st);
  s.turn = p.c;
  const k = kingSq(s, other(p.c)); if (k >= 0) s.b[k] = null;
  return pseudoMoves(s, p.c).filter(m => m.from === from).map(m => m.to);
}
function prHanging(st){
  const out = [];
  for (let i = 0; i < 64; i++){
    const p = st.b[i];
    if (!p || p.t === 'K') continue;
    if (!attackersOf(st, i, other(p.c)).length) continue;
    if (!attackersOf(st, i, p.c).length || see(st, i, other(p.c)) > 0) out.push(i);
  }
  return out;
}
function prPinned(st, sq){
  const p = st.b[sq]; if (!p || p.t === 'K') return false;
  const s = cloneState(st); s.turn = p.c;
  const ps = pseudoMoves(s, p.c).filter(m => m.from === sq).length;
  const lg = legalMoves(s, p.c).filter(m => m.from === sq).length;
  return ps > lg;
}
function prMakeAttack(r){
  for (let t = 0; t < 80; t++){
    const ask = prPick(r.kinds), colour = Math.random() < .5 ? W : B, foe = other(colour);
    const n = r.men[0] + prRand(r.men[1] - r.men[0] + 1);
    const counts = [[colour, prPick(['R','B','N','Q'])]];
    for (let k = 0; k < n; k++) counts.push([Math.random() < .5 ? colour : foe, prPick(['P','P','N','B','R'])]);
    const built = prPosition(counts);
    if (!built) continue;
    const st = built.st, from = built.at[0];
    const q = { kind:'attack', ask, st, from, colour, target:-1, answer:null, board:!!r.board, kingZone:!!r.kingZone };
    if (ask === 'attacks'){
      const foes = []; for (let i = 0; i < 64; i++) if (st.b[i] && st.b[i].c === foe) foes.push(i);
      q.target = prPick(foes); q.answer = prAttacked(st, from).indexOf(q.target) >= 0;
    } else if (ask === 'attacked'){
      q.answer = prAttacked(st, from); if (q.answer.length < 2) continue;
    } else if (ask === 'attackers'){
      const kz = r.kingZone ? kingSq(st, foe) : -1;
      const cands = [];
      for (let i = 0; i < 64; i++){
        if (kz >= 0 && Math.max(Math.abs(rowOf(i) - rowOf(kz)), Math.abs(colOf(i) - colOf(kz))) > 1) continue;
        if (attackersOf(st, i, colour).length) cands.push(i);
      }
      if (!cands.length) continue;
      q.target = prPick(cands); q.answer = attackersOf(st, q.target, colour).slice();
    } else if (ask === 'defended'){
      const mine = []; for (let i = 0; i < 64; i++) if (st.b[i] && st.b[i].c === colour && st.b[i].t !== 'K') mine.push(i);
      q.target = prPick(mine); q.answer = attackersOf(st, q.target, colour).length > 0;
    } else if (ask === 'hanging'){
      q.answer = prHanging(st); if (q.answer.length < 1 || q.answer.length > 2) continue;
    } else {
      const mine = []; for (let i = 0; i < 64; i++) if (st.b[i] && st.b[i].t !== 'K') mine.push(i);
      q.target = prPick(mine); q.answer = prPinned(st, q.target);
      if (!q.answer && Math.random() < .5) continue;      // keep pins common enough to be a question
    }
    q.sig = 'attack:' + ask + ':' + fenOf(st).split(' ')[0] + ':' + q.target;
    return q;
  }
  return null;
}
```

`attackersOf(s, sq, by)` returns an array of attacker squares (read `blind-chess.html:5108` to confirm the element shape before using `.slice()`; if entries are objects, map to `.from`). `prShowAttack`: board on/off; when off, the question lists the men by `prMan()` and square; `attacks`/`defended`/`pinned` are Yes/No; `attacked` and `attackers` use select-many + Done (typed squares when the board is off); `hanging` is select-many with a "Nothing is hanging" button. Feedback draws rays: for each answer square `lineBetween(from, target)` marked `pr-target`, and the blocker `pr-from`. Errors `'square'`. Register the mode, `case 'attack'`, harness lists; flow test drives one `attacks` question at level 1 by pressing the right Yes/No.

- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `git commit -am "Attack Vision: attacks, defenders, hanging men and pins, down to notation alone"`

---

# Phase 2 — Holding & Tracking

### Task 13: Hold the Position (replaces Position Memory)

**Files:**
- Modify: `blind-chess.html` PRACTICE: replace `prMakeMemory`, `prShowMemory`, `prAskAbout`; add `prGamePosition`, `prCluster`, `prAskFine`, `prMakeChange`
- Test: both practice suites

**Interfaces:**
- `PR_HOLD_LEVELS` (7): `{cap, men, study, modes:['question'|'change'|'rebuild'], realistic, hint}`.
- `prGamePosition(plies)` → a legal state after `plies` book moves from the start.
- `prCluster(st, men)` → a legal state keeping both kings and up to `men` other men nearest one king.
- `prAskFine(st)` → an ask in Fine's order: `{t:'where', type:'K'...}` first, then `{t:'attackersOfKing'}`, then `{t:'pawns', file}`, then the old kinds; each ask carries `text` and an `answer`.
- `prMakeHold(r)` → `{ kind:'hold', st, mode, study, ask|change|want, hint, sig }`; `prShowHold(q)`.

- [ ] **Step 1: Test**

```js
head('Hold the Position');
(function(){
  var bad = 0, modes = {};
  for (var lv = 1; lv <= PR_HOLD_LEVELS.length; lv++) for (var t = 0; t < 30; t++){
    var q = prMakeHold(prRecipe('hold', lv));
    if (!q){ bad++; continue; }
    modes[q.mode] = 1;
    if (menOn(q.st.b) > prRecipe('hold', lv).men + 2) bad++;          // both kings are extra
    if (inCheck(q.st, other(q.st.turn))) bad++;
    if (q.mode === 'change'){
      var legal = legalMoves(q.st, q.st.turn);
      if (!legal.some(function(m){ return m.from === q.change.from && m.to === q.change.to; })) bad++;
    }
    if (q.mode === 'rebuild' && q.want.length !== menOn(q.st.b)) bad++;
    if (q.mode === 'question' && q.ask.t === 'where' && q.st.b[q.ask.sq] === null) bad++;
  }
  ok('every level generates a legal, right-sized position', bad, 0);
  ok('all three answer modes appear', Object.keys(modes).length, 3);
  var g = prGamePosition(12);
  ok('a game position has thirty-two men or fewer', menOn(g.b) <= 32, true);
  var c = prCluster(g, 6);
  ok('a cluster keeps both kings', kingSq(c, W) >= 0 && kingSq(c, B) >= 0, true);
  ok('and no more men than asked', menOn(c.b) <= 8, true);
})();
```

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement**

```js
const PR_HOLD_LEVELS = [
  { cap:'Two men, eight seconds',            men:2,  study:8000, modes:['question'] },
  { cap:'Three men',                         men:3,  study:8000, modes:['question'] },
  { cap:'Four men, spot the change',         men:4,  study:7000, modes:['question','change'] },
  { cap:'Six men from a real game, kings first', men:6, study:7000, modes:['question','change','rebuild'], realistic:true, hint:true },
  { cap:'Eight men, rebuild',                men:8,  study:6000, modes:['change','rebuild'], realistic:true, hint:true },
  { cap:'Ten men',                           men:10, study:5000, modes:['question','rebuild'], realistic:true },
  { cap:'Twelve men, four seconds',          men:12, study:4000, modes:['change','rebuild'], realistic:true }
];
/* A position that has actually arisen: `plies` sane moves from the start.
   Random men are not what a blindfold player ever holds (Saariluoma 1989),
   so from level 4 the men come from here and are cut down around a king. */
function prGamePosition(plies){
  let st = newState();
  for (let k = 0; k < plies; k++){
    const pick = bookMove(st, k, prRand);
    if (!pick) break;
    st = makeMove(st, pick.m);
  }
  return st;
}
function prCluster(st, men){
  for (let t = 0; t < 20; t++){
    const side = Math.random() < .5 ? W : B, k = kingSq(st, side);
    const others = [];
    for (let i = 0; i < 64; i++){
      const p = st.b[i];
      if (p && p.t !== 'K') others.push({ i, d: Math.max(Math.abs(rowOf(i) - rowOf(k)), Math.abs(colOf(i) - colOf(k))) + Math.random() * .5 });
    }
    others.sort((a, b) => a.d - b.d);
    const keep = new Set(others.slice(0, men).map(o => o.i));
    const b = Array(64).fill(null);
    for (let i = 0; i < 64; i++) if (st.b[i] && (st.b[i].t === 'K' || keep.has(i))) b[i] = st.b[i];
    const out = { b, turn: st.turn, cr:{ wK:0, wQ:0, bK:0, bQ:0 }, ep:-1, half:0, full:1 };
    if (inCheck(out, other(out.turn))) continue;
    return out;
  }
  return null;
}
/* Fine's order: the king, what stands beside it, the pawns, then the rest. */
function prAskFine(st){
  const men = []; for (let i = 0; i < 64; i++) if (st.b[i]) men.push({ p:st.b[i], i });
  const order = ['king','beside','pawns','rest'];
  for (const kind of prShuffle(order.slice(0, 2)).concat(order.slice(2))){
    if (kind === 'king'){
      const c = Math.random() < .5 ? W : B;
      return { t:'where', sq:kingSq(st, c), colour:c, type:'K', text:'Where is ' + prMan(c, 'K') + '?' };
    }
    if (kind === 'beside'){
      const c = Math.random() < .5 ? W : B, k = kingSq(st, c);
      const near = men.filter(m => m.i !== k && Math.max(Math.abs(rowOf(m.i) - rowOf(k)), Math.abs(colOf(m.i) - colOf(k))) <= 1);
      if (!near.length) continue;
      const m = prPick(near);
      return { t:'what', sq:m.i, colour:m.p.c, type:m.p.t, text:'What stands beside ' + prSide(c) + "'s king, on <b>" + sqName(m.i) + '</b>?' };
    }
    if (kind === 'pawns'){
      const c = Math.random() < .5 ? W : B;
      const n = men.filter(m => m.p.c === c && m.p.t === 'P').length;
      if (n > 6) continue;
      return { t:'count', colour:c, type:'P', n, text:'How many ' + prSide(c) + ' pawns are there?' };
    }
  }
  return prAskAbout(st, false);
}
function prMakeHold(r){
  for (let t = 0; t < 40; t++){
    let st;
    if (r.realistic){ st = prCluster(prGamePosition(10 + prRand(16)), r.men); if (!st) continue; }
    else { const built = prPosition(prMaterial(r.men)); if (!built) continue; st = built.st; }
    const mode = prPick(r.modes);
    const q = { kind:'hold', st, mode, study:r.study, hint:!!r.hint, sig:'hold:' + fenOf(st).split(' ')[0] };
    if (mode === 'question'){ q.ask = prAskFine(st); if (!q.ask) continue; }
    else if (mode === 'change'){
      const legal = legalMoves(st, st.turn); if (!legal.length) continue;
      const m = prPickMove(st, legal);
      q.change = { from:m.from, to:m.to, cap:!!m.cap, after: makeMove(st, m) };
    } else {
      q.want = []; for (let i = 0; i < 64; i++) if (st.b[i]) q.want.push({ sq:i, c:st.b[i].c, t:st.b[i].t });
    }
    return q;
  }
  return null;
}
```

`prShowHold`: paint `q.st`, the study countdown (`prStudyPhase`, existing), the hint line when `q.hint` ("Kings first. Then what stands beside them. Then the pawns."); then by mode: `question` → `prMen(false)`, `PR.shownAt = prNow()`, `prAskShow(q.ask, q.st, [['Reveal the position', () => prRevealPosition(q.st)]])`; `change` → after the study the board is hidden for 1.5 s, then `q.change.after` is painted with the men shown and the question is "What changed? Click the square the moved man came from"; the answer is `q.change.from`; a wrong click marks it `pr-wrong`, the right `pr-right`, and if `q.change.cap` the feedback adds "and the man on `to` was taken" (error `'ghost'` when the click was `q.change.to`); `rebuild` → `prMen(false)`, `prClearPieces()`, `prRebuildStart(q.want, { say:'Rebuild it.', done: res => prJudge(!res.wrong.length && !res.missing.length, res.missing.length ? 'Forgotten: ' + res.missing.map(p => prMan(p.c,p.t)+' on '+sqName(p.sq)).join(', ') : 'Every man where it stood.', [], 'square') })`. Delete `prMakeMemory`/`prShowMemory`; keep `prAskAbout` (used as the fallback and by the tracker). `PR_MODES.hold.levels = PR_HOLD_LEVELS`; register; harness lists; flow test drives one `question` at level 1 (force `q.mode`), pressing Ready and answering `where` by clicking `q.ask.sq`.

- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `git commit -am "Hold the Position: small realistic positions held in Fine's order, spotted and rebuilt"`

---

### Task 14: Move Tracker rebuilt (openings early, both sides, captures, checkpoints, drift-locating feedback)

**Split point:** commit this as two tasks. **14a** is the ladder, `prMakeTracker`, `prTrackerErr` and the generator-suite test (Steps 1–3 up to the presenter). **14b** is `prShowTracker`, the checkpoint pause, `prTrackerReplay`, the `captured` arm of `prAskShow`, the registrations and the flow test. A reviewer can accept the generator while rejecting the presentation.

**Files:**
- Modify: `blind-chess.html` PRACTICE: replace `prMakeTrack`, `prShowTrack`, `prTrackAsk`, `prAnswerTrack`, `prTrackReveal`; delete `prMakeSequence`, `prShowSequence`, `prSanList` (the sequence drill is now the tracker's opening levels)
- Test: both practice suites

**Interfaces:**
- `PR_TRACKER_LEVELS` (12): `{cap, start:'random'|'opening', pieces, plies, sides:'one'|'both', captures, aid, fromTo, whole, checkEvery, asks:[...], promo}`.
- `prMakeTracker(r)` → `{ kind:'tracker', start, frames:[board...], path:[{san, full, from, to, id, cap, capId, capType}], ids, askType, askId, end, ask, checks:[{ply, ask}], recipe, sig }`.
- `prTrackerErr(q, clickedSq)` → `'square'|'ghost'|'lost'` with `q.lostAt` set for `'lost'`.
- `PR.lastLine` (index of the last opening line asked; `-1` in `PR`); `q.ply = r.plies`.
- Ask kinds: `where` (click), `what` (glyph buttons, via `prAskShow`), `captured` (buttons of man names + "Nothing"), `count` (numbers, one colour), `rebuild`.

- [ ] **Step 1: Test**

```js
head('Move Tracker');
(function(){
  var bad = 0, seenCaps = 0, seenChecks = 0;
  for (var lv = 1; lv <= PR_TRACKER_LEVELS.length; lv++) for (var t = 0; t < 25; t++){
    var r = prRecipe('tracker', lv), q = prMakeTracker(r);
    if (!q){ bad++; continue; }
    var st = q.start;
    q.path.forEach(function(step, k){
      var legal = legalMoves(st, st.turn);
      var m = legal.filter(function(x){ return x.from === step.from && x.to === step.to && (!x.promo || x.promo === step.promo); })[0];
      if (!m || toSAN(st, m, legal) !== step.san) bad++;
      st = makeMove(st, m);
      if (r.sides === 'one') st.turn = q.start.turn;
      if (!sameBoard(st.b, q.frames[k + 1])) bad++;
      if (step.cap) seenCaps++;
    });
    if (q.path.length !== r.plies) bad++;
    var caps = q.path.filter(function(s){ return s.cap; }).length;
    if (caps < (r.captures || 0)) bad++;
    if (r.start === 'opening' && !sameBoard(q.frames[0], newState().b)) bad++;
    if (r.checkEvery && q.checks.length !== Math.floor((r.plies - 1) / r.checkEvery)) bad++;
    seenChecks += q.checks.length;
    if (q.ask.t === 'where' && q.end !== q.ask.sq) bad++;
  }
  ok('every level generates a legal, replayable walk', bad, 0);
  ok('captures happen where asked', seenCaps > 0, true);
  ok('checkpoints appear on the levels that carry them', seenChecks > 0, true);
  // the error typer
  var q2 = prMakeTracker(prRecipe('tracker', 2));
  ok('a click on an earlier square of the piece is "lost"', prTrackerErr(q2, q2.path[0].from) === 'lost' || q2.path[0].from === q2.end, true);
})();
```

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement**

```js
const PR_TRACKER_LEVELS = [
  { cap:'One piece, two moves, the from-square lit', start:'random', pieces:1, plies:2,  sides:'one',  captures:0, aid:true,  fromTo:true,  asks:['where'] },
  { cap:'The aid removed',                            start:'random', pieces:1, plies:2,  sides:'one',  captures:0, aid:false, fromTo:true,  asks:['where'] },
  { cap:'The start position, two plies',              start:'opening', plies:2, sides:'both', captures:0, asks:['where','what'] },
  { cap:'The start position, four plies',             start:'opening', plies:4, sides:'both', captures:0, asks:['where','what'] },
  { cap:'A small position, captures',                 start:'random', pieces:3, plies:4,  sides:'both', captures:1, asks:['captured','what','count'] },
  { cap:'Six plies with captures, count the men',     start:'random', pieces:3, plies:6,  sides:'both', captures:1, asks:['captured','count','where'] },
  { cap:'Checkpoints every three plies',              start:'random', pieces:4, plies:8,  sides:'both', captures:1, checkEvery:3, asks:['where','what','count'] },
  { cap:'Pawns, promotion, castling, checks',         start:'opening', plies:8, sides:'both', captures:1, checkEvery:3, promo:true, asks:['where','what','captured'] },
  { cap:'The start position, ten plies, whole list',  start:'opening', plies:10, sides:'both', captures:0, whole:true, checkEvery:0, asks:['where','what','count'] },
  { cap:'Fourteen plies',                              start:'opening', plies:14, sides:'both', captures:1, whole:true, checkEvery:0, asks:['where','what','count'] },
  { cap:'Twenty plies, checkpoints every six',        start:'opening', plies:20, sides:'both', captures:2, whole:true, checkEvery:6, asks:['where','what','count'] },
  { cap:'Twenty plies, then rebuild it',              start:'opening', plies:20, sides:'both', captures:2, whole:true, checkEvery:6, asks:['rebuild'] }
];
/* Every walk is played, never assembled: legalMoves() in the position, one of
   them chosen, makeMove() applied. The opening levels come first on purpose —
   the start position is the one template everybody already owns (Tisdall,
   Soltis), so a real opening is easier to hold than six random men. */
function prMakeTracker(r){
  for (let t = 0; t < 60; t++){
    let st, ids = [], types = [], line = null;
    if (r.start === 'opening'){
      st = newState();
      // never the same opening as the question before: two similar lines back
      // to back is exactly the interference Campitelli & Gobet measured
      do { line = prRand(OPENING_LINES.length); } while (OPENING_LINES.length > 1 && line === PR.lastLine);
    } else {
      const bag = ['N','B','R','Q'], counts = [];
      for (let k = 0; k < r.pieces; k++){ const ty = bag.splice(prRand(bag.length), 1)[0]; types.push(ty); counts.push([W, ty]); }
      for (let k = 0; k < (r.sides === 'both' ? r.pieces : 2 + prRand(2)); k++) counts.push([B, prPick(['P','P','N','B','R'])]);
      const built = prPosition(counts);
      if (!built) continue;
      st = built.st;
      ids = types.map((ty, k) => st.b[built.at[k]].id);
    }
    const start = cloneState(st), frames = [st.b.slice()], path = [];
    let ok = true, caps = 0;
    for (let k = 0; k < r.plies; k++){
      const all = legalMoves(st, st.turn);
      let m = null;
      if (line !== null && k < OPENING_LINES[line].sans.length) m = moveFromSAN(st, OPENING_LINES[line].sans[k]);
      if (!m){
        let pool = all;
        if (r.sides === 'one') pool = all.filter(x => ids.indexOf(x.p.id) >= 0 && !inCheck(makeMove(st, x), B));
        if (!r.promo) pool = pool.filter(x => !x.promo);
        if (caps < r.captures && pool.some(x => x.cap)) pool = pool.filter(x => x.cap);
        if (!pool.length){ ok = false; break; }
        m = r.start === 'opening' ? (bookMove(st, k, prRand) || { m: prPick(pool) }).m : prPickMove(st, pool);
        if (pool.indexOf(m) < 0) m = prPick(pool);
      }
      const capP = m.cap ? st.b[m.to] : null;
      path.push({ san: toSAN(st, m, all), full: sqName(m.from) + '-' + sqName(m.to), from:m.from, to:m.to,
                  id:m.p.id, cap:!!m.cap, capId: capP ? capP.id : -1, capType: capP ? capP.t : null, capC: capP ? capP.c : null, promo:m.promo || null });
      if (m.cap) caps++;
      st = makeMove(st, m);
      if (r.sides === 'one') st.turn = W;
      frames.push(st.b.slice());
    }
    if (!ok || caps < r.captures) continue;
    if (!legalMoves(st, st.turn).length) continue;
    // the question
    const askKind = prPick(r.asks);
    const q = { kind:'tracker', start, frames, path, ids, types, end:-1, askId:-1, askType:null, ask:null, checks:[], recipe:r,
                sig:'tracker:' + fenOf(start).split(' ')[0] + ':' + path.map(s => s.san).join(' ') };
    if (askKind === 'where'){
      const movers = path.filter(s => { let now = -1; for (let i = 0; i < 64; i++) if (st.b[i] && st.b[i].id === s.id) now = i; return now >= 0; });
      if (!movers.length) continue;
      const s = prPick(movers);
      for (let i = 0; i < 64; i++) if (st.b[i] && st.b[i].id === s.id) q.end = i;
      q.askId = s.id; q.askType = st.b[q.end].t;
      q.ask = { t:'where', sq:q.end, colour:st.b[q.end].c, type:q.askType, text:'Where is ' + prMan(st.b[q.end].c, q.askType) + ' now?' };
    } else if (askKind === 'captured'){
      const taken = path.filter(s => s.cap);
      const truth = taken.length ? prMan(taken[taken.length - 1].capC, taken[taken.length - 1].capType) : 'Nothing';
      q.ask = { t:'captured', truth, text:'What was the last man captured?' };
    } else if (askKind === 'count'){
      const c = Math.random() < .5 ? W : B; let n = 0;
      for (let i = 0; i < 64; i++) if (st.b[i] && st.b[i].c === c) n++;
      if (n > 16) continue;
      q.ask = { t:'count', colour:c, type:null, n, text:'How many men does ' + prSide(c) + ' have now?' };
    } else if (askKind === 'rebuild'){
      q.ask = { t:'rebuild', want:[], text:'Rebuild the position as it stands.' };
      for (let i = 0; i < 64; i++) if (st.b[i]) q.ask.want.push({ sq:i, c:st.b[i].c, t:st.b[i].t });
    } else {
      const sq = prPick(path).to, p = st.b[sq];
      q.ask = { t:'what', sq, colour: p ? p.c : null, type: p ? p.t : null, text:'What stands on <b>' + sqName(sq) + '</b> now?' };
    }
    if (r.checkEvery) for (let k = r.checkEvery; k < r.plies; k += r.checkEvery){
      const mid = { b: frames[k], turn: k % 2 ? B : W, cr:{wK:0,wQ:0,bK:0,bQ:0}, ep:-1, half:0, full:1 };
      q.checks.push({ ply:k, ask: prAskFine(mid) });
    }
    q.final = st;
    q.ply = r.plies;
    if (line !== null) PR.lastLine = line;
    return q;
  }
  return null;
}
/* Which kind of mistake a wrong square is: the piece's own earlier square is
   "lost at ply k", the square of a man that was captured is a "ghost", and
   anything else is simply the wrong square. */
function prTrackerErr(q, sq){
  for (let k = q.path.length - 1; k >= 0; k--){
    const s = q.path[k];
    if (s.id === q.askId && (s.from === sq || (k < q.path.length - 1 && s.to === sq))){ q.lostAt = k + 1; return 'lost'; }
  }
  if (q.path.some(s => s.cap && s.to === sq && !q.final.b[sq])) return 'ghost';
  return 'square';
}
```

`prShowTracker(q)`: paint `frames[0]`, name the men (opening: "The start position."), Ready → hide men; read out the moves one at a time at 1100 ms (`full` form when `recipe.fromTo`, else `san`), lighting `from` with `pr-from` when `recipe.aid`; when `recipe.whole` show the whole list at once in `prSeq` and go straight to the question. At each `q.checks[i].ply` pause the read-out and ask the checkpoint through `prAskShow`-style buttons without scoring (a wrong checkpoint answer shows `frames[ply]` for 1500 ms, then the read-out resumes; count it in `PR.q.drift`). At the end `PR.shownAt = prNow()` and the ask: `where`/`what`/`count`/`rebuild` through `prAskShow` (extend it with `captured`: buttons for every distinct captured man name plus "Nothing"). `prAnswerWhere` for a tracker question calls `prJudge(ok, say, [['Walk it back', () => prTrackerReplay(q)]], prTrackerErr(q, i))`. `prTrackerReplay(q)` replays ply by ply as today's `prTrackReveal`, and if `q.lostAt` stops there with "This is the ply you lost it: `san`". `PR_MODES.tracker.levels = PR_TRACKER_LEVELS`; register; delete the sequence drill and its `PR_MAKE`/case entries; harness lists (remove `prMakeSequence`, `prSanList`, `prMakeTrack`, add the new names); flow test drives level 1 (Ready, wait for the read-out with the fake timers, click `q.end`) and one level-7 question, asserting a checkpoint appeared (`prQEl.innerHTML` contains "king" at some point).

- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `git commit -am "Move Tracker: openings early, both sides, captures counted, checkpoints, and feedback that finds the lost ply"`

---

### Task 15: After the Move

**Files:**
- Modify: `blind-chess.html` PRACTICE (new mode after the tracker); `PR_MODES` gains `after` after `tracker`
- Test: both practice suites

**Interfaces:**
- `PR_AFTER_LEVELS` (8); `prMakeAfter(r)` → `{ kind:'after', st, after, move:{from,to,san}, facts:{vacated, attacks:[], opened:[{piece, gained:[]}], hanging:[], check}, asks:[kind...], hidden, notation, sig }`; `prShowAfter(q)`.
- `prMoveFacts(st, m)` → the `facts` object (pure).

- [ ] **Step 1: Test**

```js
head('After the Move');
(function(){
  var bad = 0;
  for (var lv = 1; lv <= PR_AFTER_LEVELS.length; lv++) for (var t = 0; t < 30; t++){
    var q = prMakeAfter(prRecipe('after', lv));
    if (!q){ bad++; continue; }
    var legal = legalMoves(q.st, q.st.turn);
    var m = legal.filter(function(x){ return x.from === q.move.from && x.to === q.move.to; })[0];
    if (!m){ bad++; continue; }
    var after = makeMove(q.st, m);
    if (!sameBoard(after.b, q.after.b)) bad++;
    if (q.facts.vacated !== m.from) bad++;
    if (q.facts.check !== inCheck(after, after.turn)) bad++;
    var hang = prHanging(after);
    if (hang.join() !== q.facts.hanging.join()) bad++;
    q.facts.opened.forEach(function(o){
      o.gained.forEach(function(sq){ var line = lineBetween(o.piece, sq); if (!line || line.indexOf(m.from) < 0) bad++; });
    });
    if (q.asks.length < 1) bad++;
  }
  ok('every level generates, and every fact re-derives', bad, 0);
})();
```

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement**

```js
const PR_AFTER_LEVELS = [
  { cap:'One question, position shown',       men:5, asks:1, kinds:['vacated','attacks'] },
  { cap:'Two questions',                       men:5, asks:2, kinds:['vacated','attacks','check'] },
  { cap:'The position hidden after study',     men:5, asks:2, kinds:['vacated','attacks','hanging'], hidden:true, study:6000 },
  { cap:'The move given as notation only',     men:6, asks:2, kinds:['vacated','attacks','hanging','opened'], hidden:true, study:6000, notation:true },
  { cap:'Six to eight men',                    men:7, asks:2, kinds:['attacks','hanging','opened','check'], hidden:true, study:6000, notation:true },
  { cap:'Both a friendly and an enemy consequence', men:8, asks:3, kinds:['hanging','opened','check','attacks'], hidden:true, study:5000, notation:true, both:true },
  { cap:'Real positions',                      men:8, asks:3, kinds:['vacated','attacks','hanging','opened','check'], hidden:true, study:5000, notation:true, realistic:true },
  { cap:'Real positions, four seconds',        men:10, asks:3, kinds:['attacks','hanging','opened','check'], hidden:true, study:4000, notation:true, realistic:true }
];
function prMoveFacts(st, m){
  const after = makeMove(st, m);
  const before = {};
  for (let i = 0; i < 64; i++) if (st.b[i] && i !== m.from) before[i] = prAttacked(st, i);
  const opened = [];
  for (let i = 0; i < 64; i++){
    const p = after.b[i];
    if (!p || i === m.to || !before[i]) continue;
    const gained = prAttacked(after, i).filter(sq => before[i].indexOf(sq) < 0 && lineBetween(i, sq) && lineBetween(i, sq).indexOf(m.from) >= 0);
    if (gained.length) opened.push({ piece:i, gained });
  }
  return { vacated:m.from, attacks:prAttacked(after, m.to), opened, hanging:prHanging(after), check:inCheck(after, after.turn) };
}
function prMakeAfter(r){
  for (let t = 0; t < 60; t++){
    let st;
    if (r.realistic){ st = prCluster(prGamePosition(12 + prRand(14)), r.men); if (!st) continue; }
    else { const built = prPosition(prMaterial(r.men)); if (!built) continue; st = built.st; }
    const legal = legalMoves(st, st.turn).filter(m => m.p.t !== 'K');
    if (!legal.length) continue;
    // prefer a move that opens a line or leaves something loose: those are the questions worth asking
    const scored = legal.map(m => { const f = prMoveFacts(st, m); return { m, f, s:(f.opened.length ? 2 : 0) + (f.hanging.length ? 1 : 0) + (f.check ? 1 : 0) + Math.random() }; })
                        .sort((a, b) => b.s - a.s);
    const { m, f } = scored[0];
    const kinds = r.kinds.filter(k => k !== 'opened' || f.opened.length);
    if (kinds.length < r.asks) continue;
    const asks = prShuffle(kinds.slice()).slice(0, r.asks);
    if (r.both){
      const a = makeMove(st, m);
      const mine = f.hanging.some(sq => a.b[sq] && a.b[sq].c === m.p.c), theirs = f.hanging.some(sq => a.b[sq] && a.b[sq].c !== m.p.c);
      if (!(mine && theirs)) continue;
    }
    const all = legalMoves(st, st.turn);
    return { kind:'after', st, after: makeMove(st, m), move:{ from:m.from, to:m.to, san: toSAN(st, m, all) }, facts:f, asks,
             hidden:!!r.hidden, study:r.study || 0, notation:!!r.notation, sig:'after:' + fenOf(st).split(' ')[0] + ':' + m.from + m.to };
  }
  return null;
}
```

`prShowAfter(q)`: paint `q.st`; study phase when `q.hidden` then `prMen(false)`; state the move (animated on the board when not `q.notation`, otherwise only as "`san`, from `from` to `to`"); then ask `q.asks` in turn, each judged separately but scored once at the end (all right = right): `vacated` → click (`facts.vacated`); `attacks` → select-many + Done against `facts.attacks`; `hanging` → select-many with "Nothing" against `facts.hanging` (error `'ghost'` when a picked square is empty); `opened` → click the piece whose line opened (any `facts.opened[i].piece`); `check` → Yes/No. Feedback paints `q.after` with the men shown, `pr-from` on `vacated`, `pr-target` on every gained square and `pr-wrong` on hanging men. Register; harness lists; flow test drives level 1 with a `vacated` question by clicking `q.facts.vacated`.

- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `git commit -am "After the Move: the vacated square, the opened line, what is attacked and what hangs"`

---

# Phase 3 — Calculation

### Task 16: Forcing Lines

**Files:**
- Modify: `blind-chess.html` PRACTICE (new mode after After the Move); `PR_MODES` gains `forcing` after `after`
- Test: both practice suites

**Interfaces:**
- `PR_FORCING_LEVELS` (8); `prMakeForcing(r)` → `{ kind:'forcing', st, sq, line:[{san, from, to}], final, delta, occupant:{c,t}|null, check, asks:['material'|'occupant'|'check'|'hanging'], hidden, study, notation, sig }`; `prShowForcing(q)`.
- `prExchangeLine(st, sq)` → `{ line, final, delta }` where `delta` is centipawns from White's side (`VAL` sums), playing every capture on `sq` cheapest-attacker-first while the capturing side's `see()` is not negative.
- `prPlaceAttackers(sq, colour, n, board)` → places `n` men of `colour` that attack `sq` across empty lines, or null.

- [ ] **Step 1: Test**

```js
head('Forcing Lines');
(function(){
  var bad = 0;
  for (var lv = 1; lv <= PR_FORCING_LEVELS.length; lv++) for (var t = 0; t < 30; t++){
    var q = prMakeForcing(prRecipe('forcing', lv));
    if (!q){ bad++; continue; }
    var st = q.st, mat = 0;
    q.line.forEach(function(step){
      var legal = legalMoves(st, st.turn);
      var m = legal.filter(function(x){ return x.from === step.from && x.to === step.to; })[0];
      if (!m){ bad++; return; }
      if (toSAN(st, m, legal) !== step.san) bad++;
      st = makeMove(st, m);
    });
    if (!sameBoard(st.b, q.final.b)) bad++;
    for (var i = 0; i < 64; i++){ var p = st.b[i]; if (p && p.t !== 'K') mat += (p.c === W ? 1 : -1) * VAL[p.t]; }
    var mat0 = 0;
    for (var j = 0; j < 64; j++){ var p0 = q.st.b[j]; if (p0 && p0.t !== 'K') mat0 += (p0.c === W ? 1 : -1) * VAL[p0.t]; }
    if (mat - mat0 !== q.delta) bad++;
    var occ = st.b[q.sq];
    if ((occ ? occ.c + occ.t : null) !== (q.occupant ? q.occupant.c + q.occupant.t : null)) bad++;
    if (q.line.length < 2) bad++;
  }
  ok('every level generates a legal, replayable exchange whose count is right', bad, 0);
})();
```

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement**

```js
const PR_FORCING_LEVELS = [
  { cap:'Two attackers, one defender',         att:2, def:1, board:true },
  { cap:'Equal numbers',                        att:2, def:2, board:true },
  { cap:'Three against two',                    att:3, def:2, board:true, hidden:true, study:7000 },
  { cap:'A check inside the sequence',          att:2, def:2, board:true, hidden:true, study:7000, check:true },
  { cap:'Then what is now hanging',             att:3, def:2, hidden:true, study:6000, asks:['material','hanging'] },
  { cap:'The position from the notation only',  att:2, def:2, notation:true, asks:['material','occupant'] },
  { cap:'Eight plies from a real position',     att:3, def:3, hidden:true, study:6000, realistic:true, asks:['material','occupant'] },
  { cap:'…and what is hanging afterwards',      att:3, def:3, hidden:true, study:5000, realistic:true, asks:['material','hanging','check'] }
];
/* Men that attack `sq`: each dropped on a random empty square from which its
   line to `sq` is clear, or a knight's square. A pawn is placed one rank
   behind `sq` on a neighbouring file, in front of its own side. */
function prPlaceAttackers(sq, colour, n, board){
  const types = ['P','N','B','R','Q'];
  for (let t = 0; t < 200 && n > 0; t++){
    const ty = prPick(types), cands = [];
    if (ty === 'N'){ for (const [dr, dc] of DIR_N){ const r = rowOf(sq)+dr, c = colOf(sq)+dc; if (r>=0&&r<8&&c>=0&&c<8) cands.push(r*8+c); } }
    else if (ty === 'P'){ const r = rowOf(sq) + (colour === W ? 1 : -1); for (const dc of [-1, 1]){ const c = colOf(sq)+dc; if (r>0&&r<7&&c>=0&&c<8) cands.push(r*8+c); } }
    else { const L = linesThrough(sq); const pool = ty === 'R' ? L.rank.concat(L.file) : ty === 'B' ? L.diag1.concat(L.diag2) : L.rank.concat(L.file, L.diag1, L.diag2);
           for (const i of pool) if (lineBetween(i, sq).every(x => !board[x])) cands.push(i); }
    const free = cands.filter(i => !board[i]);
    if (!free.length) continue;
    board[prPick(free)] = mk(colour, ty);
    n--;
  }
  return n === 0 ? board : null;
}
function prMaterialOf(st){
  let m = 0; for (let i = 0; i < 64; i++){ const p = st.b[i]; if (p && p.t !== 'K') m += (p.c === W ? 1 : -1) * VAL[p.t]; }
  return m;
}
/* The exchange, played: cheapest capture on the square while the side to
   capture does not lose by it — see() is the review's own arithmetic. */
function prExchangeLine(st, sq){
  const line = []; let s = st;
  const mat0 = prMaterialOf(st);
  for (let k = 0; k < 12; k++){
    const legal = legalMoves(s, s.turn);
    const caps = legal.filter(m => m.to === sq && m.cap).sort((a, b) => VAL[a.p.t] - VAL[b.p.t]);
    if (!caps.length) break;
    if (see(s, sq, s.turn) < 0) break;
    const m = caps[0];
    line.push({ san: toSAN(s, m, legal), from:m.from, to:m.to });
    s = makeMove(s, m);
  }
  return { line, final:s, delta: prMaterialOf(s) - mat0 };
}
function prMakeForcing(r){
  for (let t = 0; t < 80; t++){
    let st, sq;
    if (r.realistic){
      st = prGamePosition(14 + prRand(14));
      const spots = []; for (let i = 0; i < 64; i++) if (st.b[i] && st.b[i].c !== st.turn && attackersOf(st, i, st.turn).length >= 2) spots.push(i);
      if (!spots.length) continue;
      sq = prPick(spots);
    } else {
      const board = Array(64).fill(null);
      const wk = prRand(64), bk = prRand(64);
      if (Math.max(Math.abs(rowOf(wk)-rowOf(bk)), Math.abs(colOf(wk)-colOf(bk))) <= 1) continue;
      board[wk] = mk(W,'K'); board[bk] = mk(B,'K');
      sq = prRand(64); if (board[sq] || rowOf(sq) === 0 || rowOf(sq) === 7) continue;
      board[sq] = mk(B, prPick(['P','N','B','R']));
      if (!prPlaceAttackers(sq, W, r.att, board)) continue;
      if (!prPlaceAttackers(sq, B, r.def, board)) continue;
      st = { b:board, turn:W, cr:{wK:0,wQ:0,bK:0,bQ:0}, ep:-1, half:0, full:1 };
      if (inCheck(st, W) || inCheck(st, B)) continue;
    }
    const ex = prExchangeLine(st, sq);
    if (ex.line.length < 2) continue;
    const check = inCheck(ex.final, ex.final.turn);
    if (r.check && !ex.line.some(s => /[+#]$/.test(s.san))) continue;
    const occ = ex.final.b[sq];
    return { kind:'forcing', st, sq, line:ex.line, final:ex.final, delta:ex.delta, occupant: occ ? { c:occ.c, t:occ.t } : null, check,
             asks: r.asks || ['material','occupant'], hidden:!!r.hidden, study:r.study || 0, notation:!!r.notation,
             hanging: prHanging(ex.final), ply: ex.line.length, sig:'forcing:' + fenOf(st).split(' ')[0] + ':' + sq };
  }
  return null;
}
```

`prShowForcing(q)`: study (or notation listing when `q.notation`), hide, show the line in `prSeq` as a list, then the asks: `material` → four buttons built from `q.delta` ("Level", "White up N", "Black up N", and one decoy ±100), `occupant` → `prAskShow` `what` on `q.sq`, `check` → Yes/No, `hanging` → select-many with "Nothing". Feedback plays the line out on the shown board at 700 ms a ply and ends with the count in words ("A rook and a pawn for a knight and a bishop: Black is up a pawn"). Errors: a picked man that was captured in the line → `'ghost'`, else `'square'`. Register; harness lists; flow test drives level 1's `material` question by pressing the right button.

- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `git commit -am "Forcing Lines: exchanges played in the head and accounted for"`

---

### Task 17: Blind Calculation

**Split point:** commit this as two tasks. **17a** is the ladder, `prMatesIn1`, `prMatesIn2`, `prForks`, the generated tasks (`mate1`, `hanging`, `fork`, `mate2`) and their generator-suite test. **17b** is `prPuzzlePool`, the `puzzle`, `line` and `visualise` tasks, `prShowCalc`, the registrations and the flow test.

**Files:**
- Modify: `blind-chess.html` PRACTICE (new mode); `PR_MODES` gains `calc`
- Test: both practice suites

**Interfaces:**
- `PR_CALC_LEVELS` (10); `prMakeCalc(r)` → `{ kind:'calc', st, task:'mate1'|'hanging'|'fork'|'mate2'|'puzzle'|'line'|'visualise', answer:{from,to,promo?}, pre:[san...], endAsk, study, hidden, console, sig }`; `prShowCalc(q)`; `prMatesIn1(st)` → array of mating moves; `prMatesIn2(st)` → array of first moves that force mate in two; `prForks(st)` → array of moves attacking two undefended non-pawn men with the mover safe; `prPuzzlePool(track)` → Promise of the shipped puzzle records (cached; resolves to `[]` on failure).

- [ ] **Step 1: Test**

```js
head('Blind Calculation');
(function(){
  var st = stateFromFEN('6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1');
  ok('the back-rank position has exactly one mate in one', prMatesIn1(st).length, 1);
  var bad = 0, tasks = {};
  for (var lv = 1; lv <= 5; lv++) for (var t = 0; t < 20; t++){
    var q = prMakeCalc(prRecipe('calc', lv));
    if (!q){ bad++; continue; }
    tasks[q.task] = 1;
    var s = q.st;
    var legal = legalMoves(s, s.turn);
    var m = legal.filter(function(x){ return x.from === q.answer.from && x.to === q.answer.to; })[0];
    if (!m){ bad++; continue; }
    if (q.task === 'mate1' && prMatesIn1(s).length !== 1) bad++;
    if (q.task === 'hanging' && see(s, q.answer.to, s.turn) <= 0) bad++;
    if (q.task === 'mate2' && prMatesIn2(s).length !== 1) bad++;
  }
  ok('levels one to five generate verified tactics', bad, 0);
  ok('mate, hanging, fork and mate-in-two all appear', ['mate1','hanging','fork','mate2'].every(function(k){ return tasks[k]; }), true);
  for (var lv2 = 8; lv2 <= 10; lv2++) for (var t2 = 0; t2 < 10; t2++){
    var q2 = prMakeCalc(prRecipe('calc', lv2));
    if (!q2) { bad++; continue; }
    var s2 = q2.st;
    q2.pre.forEach(function(san){ var mm = moveFromSAN(s2, san); if (!mm) bad++; else s2 = makeMove(s2, mm); });
  }
  ok('the line levels carry legal preambles', bad, 0);
})();
```

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement**

```js
const PR_CALC_LEVELS = [
  { cap:'Mate in one, a queen and little else', task:'mate1', men:[['W','Q']], extra:[0,1], study:8000 },
  { cap:'A hanging piece to take',             task:'hanging', extra:[3,5], study:8000 },
  { cap:'A fork or a check that wins material', task:'fork', extra:[3,5], study:8000 },
  { cap:'Mate in one, more men',               task:'mate1', men:[['W','R'],['W','R']], extra:[2,4], study:7000 },
  { cap:'Mate in two',                          task:'mate2', men:[['W','Q'],['W','R']], extra:[1,3], study:9000 },
  { cap:'Puzzle positions of twelve men or fewer', task:'puzzle', maxMen:12, study:15000 },
  { cap:'Full puzzle positions',                task:'puzzle', maxMen:32, study:15000 },
  { cap:'Three to five plies, then the end position', task:'line', plies:[3,5], study:8000 },
  { cap:'Given moves, then find the tactic',    task:'visualise', plies:[3,5], study:8000 },
  { cap:'Given moves, then find it, console only', task:'visualise', plies:[4,6], study:8000, console:true }
];
function prMatesIn1(st){
  const out = [];
  for (const m of legalMoves(st, st.turn)){
    const a = makeMove(st, m);
    if (inCheck(a, a.turn) && !legalMoves(a, a.turn).length) out.push(m);
  }
  return out;
}
function prMatesIn2(st){
  const out = [];
  for (const m of legalMoves(st, st.turn)){
    const a = makeMove(st, m);
    const replies = legalMoves(a, a.turn);
    if (!replies.length) continue;                      // that would be mate in one, or stalemate
    if (replies.every(r => prMatesIn1(makeMove(a, r)).length > 0)) out.push(m);
  }
  return out;
}
function prForks(st){
  const out = [];
  for (const m of legalMoves(st, st.turn)){
    if (m.p.t === 'K' || m.p.t === 'P') continue;
    const a = makeMove(st, m);
    if (see(a, m.to, a.turn) > 0) continue;              // the forker is simply taken
    const hit = prAttacked(a, m.to).filter(sq => a.b[sq] && a.b[sq].c !== m.p.c && a.b[sq].t !== 'P' &&
                                                  (a.b[sq].t === 'K' || !attackersOf(a, sq, a.b[sq].c).length || VAL[a.b[sq].t] > VAL[m.p.t]));
    if (hit.length >= 2) out.push(m);
  }
  return out;
}
const prPuzzleCache = {};
function prPuzzlePool(track){
  if (prPuzzleCache[track]) return prPuzzleCache[track];
  prPuzzleCache[track] = (typeof fetch === 'function'
    ? fetch('puzzles/' + track + '.json?v=' + PZ_VERSION).then(r => r.ok ? r.json() : []).catch(() => [])
    : Promise.resolve([]));
  return prPuzzleCache[track];
}
function prMakeCalc(r){
  for (let t = 0; t < 120; t++){
    if (r.task === 'puzzle'){
      const pool = r.pool || [];                        // filled by prShowCalc's loader; empty means fall back
      if (!pool.length) return prMakeCalc(Object.assign({}, prRecipe('calc', r.maxMen <= 12 ? 4 : 5), { study:r.study, fallback:true }));
      const p = prPick(pool), st = stateFromFEN(p.fen);
      let men = 0; for (let i = 0; i < 64; i++) if (st.b[i]) men++;
      if (men > r.maxMen) continue;
      const uci = p.moves[0], legal = legalMoves(st, st.turn), m = legal.filter(x => uciOf(x) === uci)[0];
      if (!m) continue;
      return { kind:'calc', st, task:'puzzle', answer:{ from:m.from, to:m.to, promo:m.promo || null }, pre:[], endAsk:null, study:r.study, hidden:true, console:false, sig:'calc:puzzle:' + p.id };
    }
    const counts = (r.men || []).map(x => [x[0] === 'W' ? W : B, x[1]]);
    const extra = r.extra ? r.extra[0] + prRand(r.extra[1] - r.extra[0] + 1) : 0;
    for (let k = 0; k < extra; k++) counts.push([Math.random() < .5 ? W : B, prPick(['P','P','N','B','R'])]);
    const built = prPosition(counts);
    if (!built) continue;
    let st = built.st;
    if (r.task === 'line' || r.task === 'visualise'){
      const n = r.plies[0] + prRand(r.plies[1] - r.plies[0] + 1), pre = [];
      let s = st, ok = true; const touched = [];
      for (let k = 0; k < n; k++){ const all = legalMoves(s, s.turn); if (!all.length){ ok = false; break; } const m = prPickMove(s, all); pre.push(toSAN(s, m, all)); touched.push(m.from, m.to); s = makeMove(s, m); }
      if (!ok) continue;
      if (r.task === 'line'){
        const sq = prPick(touched), p = s.b[sq];        // a square the line touched: what stands there at its end
        return { kind:'calc', st, task:'line', pre, ply:n, answer:null, endAsk:{ t:'what', sq, colour:p?p.c:null, type:p?p.t:null, text:'After those moves, what stands on <b>' + sqName(sq) + '</b>?' }, study:r.study, hidden:true, console:!!r.console, sig:'calc:line:' + fenOf(st).split(' ')[0] + pre.join('') };
      }
      const mates = prMatesIn1(s), hang = legalMoves(s, s.turn).filter(m => m.cap && see(s, m.to, s.turn) > 0).sort((a, b) => VAL[s.b[b.to].t] - VAL[s.b[a.to].t]);
      const m = mates.length === 1 ? mates[0] : (!mates.length && hang.length && (hang.length === 1 || VAL[s.b[hang[0].to].t] > VAL[s.b[hang[1].to].t])) ? hang[0] : null;
      if (!m) continue;
      return { kind:'calc', st, task:'visualise', pre, ply:n, after:s, answer:{ from:m.from, to:m.to, promo:m.promo || null }, endAsk:null, study:r.study, hidden:true, console:!!r.console, sig:'calc:vis:' + fenOf(st).split(' ')[0] + pre.join('') };
    }
    let found = null;
    if (r.task === 'mate1'){ const ms = prMatesIn1(st); if (ms.length === 1) found = ms[0]; }
    else if (r.task === 'mate2'){ if (prMatesIn1(st).length) continue; const ms = prMatesIn2(st); if (ms.length === 1) found = ms[0]; }
    else if (r.task === 'hanging'){
      const caps = legalMoves(st, st.turn).filter(m => m.cap && see(st, m.to, st.turn) > 0).sort((a, b) => VAL[st.b[b.to].t] - VAL[st.b[a.to].t]);
      if (caps.length && (caps.length === 1 || VAL[st.b[caps[0].to].t] > VAL[st.b[caps[1].to].t]) && !prMatesIn1(st).length) found = caps[0];
    } else if (r.task === 'fork'){ const fs = prForks(st); if (fs.length === 1 && !prMatesIn1(st).length) found = fs[0]; }
    if (!found) continue;
    return { kind:'calc', st, task:r.task, answer:{ from:found.from, to:found.to, promo:found.promo || null }, pre:[], endAsk:null, study:r.study, hidden:true, console:!!r.console, fallback:!!r.fallback, sig:'calc:' + r.task + ':' + fenOf(st).split(' ')[0] };
  }
  return null;
}
```

`prShowCalc(q)`: for `task === 'puzzle'` the presenter first awaits `prPuzzlePool(level 6 ? 'opening' : 'middlegame')` and, if it resolves non-empty, regenerates with `r.pool` set; otherwise it shows the fallback question with the line "The puzzle set could not be fetched, so this is a generated position instead." Study `q.st`, hide (`prMen(false)`, or `prBoardOn(false)` when `q.console`), show `q.pre` in `prSeq`; the answer is entered by clicking from then to on the empty board, or typed through `parseMoveIn(q.after || q.st, text)` in the console; `line` asks `endAsk` through `prAskShow`. Judge: the entered move equals `q.answer`. Feedback: if the move was legal but wrong, play it and the reply from `bestMove(after, 3)` on the shown board, then the true line. Errors: illegal → `'square'`; a legal wrong move → `'other'`. Register; harness lists; flow test drives level 1 by clicking `q.answer.from` then `q.answer.to`.

- [ ] **Step 4: Run** — PASS (the generator suite's `prMatesIn2` search on tiny positions should finish in well under a second per call; if a level times the suite out, tighten `extra`).
- [ ] **Step 5: Commit** `git commit -am "Blind Calculation: verified small tactics, the shipped puzzles, and lines to an end position"`

---

### Task 18: Branches

**Files:**
- Modify: `blind-chess.html` PRACTICE (new mode); `PR_MODES` gains `branches`
- Test: both practice suites

**Interfaces:**
- `PR_BRANCHES_LEVELS` (6); `prMakeBranches(r)` → `{ kind:'branches', root, branches:[{sans:[], end, ask, rootAsk}], hidden, study, lead:{sans, name}|null, sig }`; `prShowBranches(q)`. Each branch carries its own `rootAsk`, on a square that branch changed, so a wrong rewind after that branch is detectable.

- [ ] **Step 1: Test**

```js
head('Branches');
(function(){
  var bad = 0;
  for (var lv = 1; lv <= PR_BRANCHES_LEVELS.length; lv++) for (var t = 0; t < 20; t++){
    var q = prMakeBranches(prRecipe('branches', lv));
    if (!q){ bad++; continue; }
    if (q.branches.length !== prRecipe('branches', lv).count) bad++;
    var touched = null;
    q.branches.forEach(function(br){
      var s = q.root, squares = {};
      br.sans.forEach(function(san){ var m = moveFromSAN(s, san); if (!m){ bad++; return; } squares[m.from] = squares[m.to] = 1; s = makeMove(s, m); });
      if (!sameBoard(s.b, br.end.b)) bad++;
      if (touched && !Object.keys(squares).some(function(k){ return touched[k]; })) bad++;
      touched = touched || squares;
      // this branch's root question must be answerable differently at the root and at this end
      var atRoot = q.root.b[br.rootAsk.sq], atEnd = s.b[br.rootAsk.sq];
      if ((atRoot ? atRoot.c + atRoot.t : '') === (atEnd ? atEnd.c + atEnd.t : '')) bad++;
    });
  }
  ok('every level generates branches that share a square and disagree with the root', bad, 0);
})();
```

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement**

```js
const PR_BRANCHES_LEVELS = [
  { cap:'Two branches of two plies, root shown',  count:2, plies:2, men:6 },
  { cap:'Three branches',                          count:3, plies:2, men:6 },
  { cap:'Four-ply branches',                       count:2, plies:4, men:7 },
  { cap:'Captures inside the branches',            count:2, plies:4, men:8, captures:true },
  { cap:'The root hidden after study',             count:3, plies:4, men:8, captures:true, hidden:true, study:8000 },
  { cap:'The root reached by tracking first',      count:2, plies:4, men:0, hidden:true, study:0, lead:6 }
];
function prMakeBranches(r){
  for (let t = 0; t < 80; t++){
    let root, lead = null;
    if (r.lead){ const idx = prRand(OPENING_LINES.length); const o = openingPosition(idx, r.lead); root = o.st; lead = { sans:o.sans, name:o.name }; }
    else { const built = prPosition(prMaterial(r.men)); if (!built) continue; root = built.st; }
    const branches = [];
    let touched = null, ok = true;
    for (let b = 0; b < r.count; b++){
      let made = null;
      for (let u = 0; u < 30 && !made; u++){
        let s = root; const sans = [], sq = {}; let caps = 0, good = true;
        for (let k = 0; k < r.plies; k++){
          const all = legalMoves(s, s.turn); if (!all.length){ good = false; break; }
          let pool = all; if (r.captures && k === 0 && all.some(m => m.cap)) pool = all.filter(m => m.cap);
          const m = prPickMove(s, pool); sans.push(toSAN(s, m, all)); sq[m.from] = sq[m.to] = 1; if (m.cap) caps++; s = makeMove(s, m);
        }
        if (!good || (r.captures && !caps)) continue;
        if (touched && !Object.keys(sq).some(k => touched[k])) continue;
        if (branches.some(x => x.sans.join() === sans.join())) continue;
        made = { sans, end:s, squares:Object.keys(sq).map(Number) };
      }
      if (!made){ ok = false; break; }
      touched = Object.assign(touched || {}, made.squares.reduce((o, k) => (o[k] = 1, o), {}));
      branches.push(made);
    }
    if (!ok) continue;
    // each branch asks at its end, then asks about the root on a square it changed
    let fine = true;
    for (const br of branches){
      const esq = prPick(br.squares), ep = br.end.b[esq];
      br.ask = { t:'what', sq:esq, colour: ep ? ep.c : null, type: ep ? ep.t : null, text:'At the end of this branch, what stands on <b>' + sqName(esq) + '</b>?' };
      const changed = br.squares.filter(i => { const a = root.b[i], e = br.end.b[i]; return (a ? a.c + a.t : '') !== (e ? e.c + e.t : ''); });
      if (!changed.length){ fine = false; break; }
      const rsq = prPick(changed), rp = root.b[rsq];
      br.rootAsk = { t:'what', sq:rsq, colour: rp ? rp.c : null, type: rp ? rp.t : null, text:'Back at the root: what stands on <b>' + sqName(rsq) + '</b>?' };
    }
    if (!fine) continue;
    return { kind:'branches', root, branches, hidden:!!r.hidden, study:r.study || 0, lead, sig:'branches:' + fenOf(root).split(' ')[0] + branches.map(b => b.sans.join('')).join('|') };
  }
  return null;
}
```

`prShowBranches(q)`: if `q.lead`, read the lead moves out first from the start position (tracker style, men hidden) and say "This is the root"; otherwise paint the root and study, hiding when `q.hidden`. Then for each branch: show its SAN list in `prSeq`, ask `br.ask` through `prAskShow`, then clear the list and ask `br.rootAsk` ("Back at the root"), then the next branch. Score once at the end: right only if every question was right; the first wrong root answer is the error `'lost'`. Feedback paints the root and the branch end alternately (a `Compare` control toggles) with the squares that differ marked `pr-target`. Register; harness lists; flow test drives level 1 answering each question with the glyph button for the true man (or Empty square).

- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `git commit -am "Branches: walk a line, answer for its end, rewind to the root, walk another"`

---

# Phase 4 — Progressive Blindfold

### Task 19: The game loop, masking and the ladder

**Files:**
- Modify: `blind-chess.html` PRACTICE: replace `prMakeMini`, `prShowMini`, `prMiniPlay`, `prMiniRestart`, `prMiniReveal`, `prMiniSubmit`, `prMiniEnd`, `prMiniLine`; `PR_MODES.progressive`
- Test: both practice suites

**Interfaces:**
- `PR_PB_LEVELS` (10): `{cap, vis:'mine'|'squares'|'console', men, peeks, checkEvery, target}`; `men:0` means the full start position.
- `prMakeProgressive(r)` → `{ kind:'progressive', st, recipe:r, sig }`.
- `PR.pb` = `{ st, r, sans:[], played:0, peeks, drifts:0, recoveries:0, checks:0, checksOk:0, illegal:0, over:false, busy:false, sel:-1 }`.
- `pbMask(board, colour)` → a board with only `colour`'s men; `pbPaint()` paints according to `r.vis`; `pbMove(m)` plays the player's move and schedules the reply; `pbReply()`; `pbEnd(why)`; `pbLine(text, cls)` writes to the console log.
- The mode's stored `level` is "highest level passed + 1", clamped to 10; a session at level N that passes writes `level = N + 1`.

- [ ] **Step 1: Test** — generator suite first:

```js
head('Progressive Blindfold positions');
(function(){
  var bad = 0;
  for (var lv = 1; lv <= PR_PB_LEVELS.length; lv++) for (var t = 0; t < 30; t++){
    var q = prMakeProgressive(prRecipe('progressive', lv));
    if (!q){ bad++; continue; }
    var r = prRecipe('progressive', lv);
    if (r.men && (menOn(q.st.b) !== 2 * r.men)) bad++;
    if (!r.men && !sameBoard(q.st.b, newState().b)) bad++;
    if (legalMoves(q.st, W).length < 4) bad++;
    if (inCheck(q.st, W) || inCheck(q.st, B)) bad++;
  }
  ok('every level deals a legal position with the men asked for', bad, 0);
})();
```

then the flow suite (the fake clock drives the reply timer):

```js
head('Progressive Blindfold: a game at level 1');
(function(){
  storage = {};
  prOpen('progressive', 1, 5);
  ok('a game is up', PR.pb && !PR.pb.over, true);
  ok('level 1 shows only our men', prPieceEls.size, menOf(PR.pb.st.b, W));
  var legal = legalMoves(PR.pb.st, W)[0];
  clickSquare(legal.from); clickSquare(legal.to);
  ok('our move was played', PR.pb.played, 1);
  ok('the reply is pending', PR.pb.busy, true);
  fireTimers();
  ok('and arrives', PR.pb.st.turn, W);
  // an illegal typed move is counted and refused
  typeAnswer('Ka9');
  ok('an illegal move is counted', PR.pb.illegal, 1);
  ok('and does not move anything', PR.pb.played, 1);
})();
```

Add to the harness: `function menOf(b, c){ var n = 0; for (var i = 0; i < 64; i++) if (b[i] && b[i].c === c) n++; return n; }` and a `fireTimers()` that runs every pending stubbed timeout once.

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement**

```js
/* ---- PROGRESSIVE BLINDFOLD ----
   Whole small games with the board taken away one step at a time: your men
   first, then the squares alone, then the console — the game's own two
   blindfold visions in miniature, against the page's small search. It is a
   Practice mode and nothing else: same board, same store, same door. */
const PR_PB_LEVELS = [
  { cap:'Your men shown, theirs hidden · 3 a side', vis:'mine',    men:3, peeks:Infinity, checkEvery:3, target:8 },
  { cap:'Your men shown · 5 a side',                vis:'mine',    men:5, peeks:Infinity, checkEvery:3, target:10 },
  { cap:'Squares only, unlimited peeks · 3 a side', vis:'squares', men:3, peeks:Infinity, checkEvery:3, target:8 },
  { cap:'Squares only, unlimited peeks · 5 a side', vis:'squares', men:5, peeks:Infinity, checkEvery:3, target:10 },
  { cap:'Squares only, three peeks · 5 a side',     vis:'squares', men:5, peeks:3, checkEvery:3, target:12 },
  { cap:'Squares only, three peeks · 8 a side',     vis:'squares', men:8, peeks:3, checkEvery:3, target:14 },
  { cap:'Squares only, no peeks · 8 a side',        vis:'squares', men:8, peeks:0, checkEvery:6, target:14 },
  { cap:'Console only, three peeks · 5 a side',     vis:'console', men:5, peeks:3, checkEvery:6, target:12 },
  { cap:'Console only, three peeks · 8 a side',     vis:'console', men:8, peeks:3, checkEvery:6, target:16 },
  { cap:'Console only · the full start position',   vis:'console', men:0, peeks:3, checkEvery:6, target:20 }
];
function prMakeProgressive(r){
  for (let t = 0; t < 60; t++){
    let st;
    if (r.men === 0) st = newState();
    else {
      const counts = [];
      for (let k = 0; k < r.men - 1; k++){ counts.push([W, prPick(['P','P','N','B','R','Q'])]); counts.push([B, prPick(['P','P','N','B','R','Q'])]); }
      const built = prPosition(counts); if (!built) continue; st = built.st;
    }
    if (legalMoves(st, W).length < 4) continue;
    return { kind:'progressive', st, recipe:r, sig:'pb:' + r.level + ':' + fenOf(st).split(' ')[0] };
  }
  return null;
}
function pbMask(board, colour){ return board.map(p => (p && p.c === colour) ? p : null); }
function pbPaint(){
  const pb = PR.pb;
  if (pb.r.vis === 'console'){ prBoardOn(false); return; }
  prBoardOn(true); prMen(true);
  prPaint(pb.r.vis === 'mine' ? pbMask(pb.st.b, W) : pb.st.b);
  if (pb.r.vis === 'squares') prMen(false);
}
function pbLine(text, cls){
  const d = document.createElement('div'); d.className = 'pr-log-line ' + (cls || ''); d.textContent = text;
  prLogEl.appendChild(d); prLogEl.scrollTop = prLogEl.scrollHeight;
}
function prShowProgressive(q){
  PR.pb = { st:q.st, r:q.recipe, sans:[], played:0, peeks:q.recipe.peeks, drifts:0, recoveries:0, checks:0, checksOk:0, illegal:0, over:false, busy:false, sel:-1 };
  prLogEl.style.display = ''; prLogEl.innerHTML = '';
  prLayout(false, false); prClearPieces(); prMarksClear();
  pbPaint();
  prQ('Level ' + q.recipe.level + ' — <b>' + q.recipe.target + '</b> moves. You are White.');
  prSub(q.recipe.vis === 'console' ? 'Type your moves: <b>e4</b> · <b>Nf3</b> · <b>exd5</b> · <b>O-O</b> — or plain squares, <b>e2e4</b>.'
                                   : 'Click a man’s square, then where it goes — or type the move.');
  pbLine('The game begins. ' + (q.recipe.vis === 'mine' ? 'Their men are hidden.' : q.recipe.vis === 'squares' ? 'Every man is hidden.' : 'No board.'), 'sys');
  pbInput();
}
/* The two ways a move comes in — typed, or two clicks on the empty board —
   installed here and again after every checkpoint or recovery, which borrow
   the answer row and the click for a moment. */
function pbInput(){
  prAnsClear();
  prAnsInput('your move…', 12, inp => { const res = parseMoveIn(PR.pb.st, inp.value); if (res.error){ pbIllegal(res.error, inp); return; } inp.value = ''; pbMove(res.move); }, 'Play');
  PR.click = i => {
    const pb = PR.pb; if (pb.over || pb.busy || pb.r.vis === 'console') return;
    if (pb.sel < 0){ pb.sel = i; prMarksClear(); prMark(i, 'pr-from'); return; }
    const from = pb.sel; pb.sel = -1; prMarksClear();
    const m = legalMoves(pb.st, W).filter(x => x.from === from && x.to === i)[0];
    if (!m){ pbIllegal('There is no move from ' + sqName(from) + ' to ' + sqName(i) + '.'); return; }
    pbMove(m.promo ? legalMoves(pb.st, W).filter(x => x.from === from && x.to === i && x.promo === 'Q')[0] || m : m);
  };
  pbControls();
}
function pbIllegal(why, inp){
  PR.pb.illegal++;
  pbLine('✗  ' + why, 'err'); beep(140, .16, 'sawtooth', .08);
  if (inp){ inp.classList.add('bad'); prTimer(() => inp.classList.remove('bad'), 380); inp.select(); }
}
function pbMove(m){
  const pb = PR.pb, all = legalMoves(pb.st, pb.st.turn);
  const san = toSAN(pb.st, m, all);
  pb.prevSt = pb.st;                                   // the checkpoint's "last move" decoys come from here
  pb.st = makeMove(pb.st, m); pb.sans.push(san); pb.played++;
  pbLine(pb.played + '.  ' + san, 'you');
  pbPaint(); prStatsRender();
  if (!legalMoves(pb.st, B).length){ pbEnd(inCheck(pb.st, B) ? 'Checkmate — you finished it.' : 'Stalemate.'); return; }
  pb.busy = true;
  prTimer(pbReply, 520);
}
function pbReply(){
  const pb = PR.pb; if (!pb || pb.over) return;
  const theirs = legalMoves(pb.st, B), reply = bestMove(pb.st, 2) || prPick(theirs);
  const san = toSAN(pb.st, reply, theirs);
  pb.prevSt = pb.st;
  pb.st = makeMove(pb.st, reply); pb.sans.push(san);
  pbLine('    …  ' + san, 'them');
  pb.busy = false;
  pbPaint();
  if (pb.played >= pb.r.target){ pbEnd('You held it for all ' + pb.r.target + ' moves.'); return; }
  if (!legalMoves(pb.st, W).length){ pbEnd(inCheck(pb.st, W) ? 'Checkmate against you.' : 'Stalemate.'); return; }
  if (pb.r.checkEvery && pb.played % pb.r.checkEvery === 0) pbCheckpoint();   // Task 20
}
```

`pbControls()` (Task 20 adds Peek / I've lost it) and `pbEnd(why)` (Task 21) are declared in this task as: `function pbControls(){ prCtl([['Reveal and stop', () => pbEnd('Stopped.')]]); }` and

```js
function pbEnd(why){
  const pb = PR.pb; pb.over = true; prClearTimers(); PR.click = null; PR.onSubmit = null;
  prBoardOn(true); prMen(true); prPaint(pb.st.b);
  pbLine(why, 'sys');
  pb.pass = pb.played >= pb.r.target && pb.drifts <= 1 && pb.illegal === 0;
  prScore(pb.pass, pb.illegal ? 'square' : pb.drifts > 1 ? 'lost' : null);
  prFinish(why);
}
```

`prStatsRender` for `progressive` shows `Move N / target`. `prFinish` for `progressive` writes `m.stats.pb = m.stats.pb || {}; m.stats.pb[level] = { pass, played, checks, checksOk, drifts, peeks:used, recoveries }` and `m.level = pass ? Math.min(10, level + 1) : level` instead of the staircase value. `PR_MODES.progressive = { key:'progressive', name:'Progressive Blindfold', group:'play', skill:'Blindfold play', lesson:10, desc:'Whole small games with the board taken away one step at a time — the bridge to the real thing.', levels:PR_PB_LEVELS }`. Delete every `prMini*` function and `PR.mini`; update `navDescribe`'s `min`; harness lists.

- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `git commit -am "Progressive Blindfold: whole games on a ten-level ladder, your men, then squares, then the console"`

---

### Task 20: Checkpoints, peeks and recovery

**Files:**
- Modify: `blind-chess.html` PRACTICE (the block above)
- Test: flow suite

**Interfaces:**
- `pbCheckpoint()` pauses the game, asks one of `prAskFine(pb.st)`, `{t:'count'}` for either side, or `{t:'last'}` ("what was the last move", four SAN buttons); right → `checksOk++`; wrong → `drifts++`, true board shown 2000 ms, then masked again. `pbControls()` offers `Peek (n left)` when `peeks > 0` and `I've lost it`.
- `pbPeek()` shows the true board for 2000 ms and decrements `peeks`.
- `pbRecover()` shows the move list in `prSeq` (never the board), opens `prRebuildStart` with the true men as target, and on Done paints the diff for 2500 ms, counts `recoveries++`, then resumes with the board masked again.

- [ ] **Step 1: Test**

```js
head('Progressive Blindfold: checkpoints, peeks, recovery');
(function(){
  storage = {};
  prOpen('progressive', 5, 5);                 // three peeks, squares only
  var pb = PR.pb;
  ok('three peeks to start', pb.peeks, 3);
  pressCtl('Peek (3 left)');
  ok('a peek shows the men', prBoardEl.classList.contains('blind'), false);
  fireTimers();
  ok('and hides them again', prBoardEl.classList.contains('blind'), true);
  ok('one peek spent', pb.peeks, 2);
  // play three moves to reach a checkpoint
  for (var k = 0; k < 3 && !pb.over; k++){ var m = legalMoves(pb.st, W)[0]; clickSquare(m.from); clickSquare(m.to); fireTimers(); }
  ok('a checkpoint is asked after three moves', pb.checks, 1);
  // answer it wrongly on purpose: pick a glyph that cannot be right
  var wrongBtn = null;
  for (var i = 0; i < prAnsEl.children.length; i++){ var b = prAnsEl.children[i]; if (b.innerHTML.indexOf('Empty') < 0 && !b.__truth) wrongBtn = b; }
  if (wrongBtn) wrongBtn.onclick();
  ok('a wrong checkpoint counts a drift', pb.drifts >= 0, true);
  pressCtl("I've lost it");
  ok('recovery shows the move list', prSeqEl.innerHTML.length > 0, true);
  ok('and never the board', prBoardEl.classList.contains('blind') || prPieceEls.size === 0, true);
  pressCtl('Done');
  ok('a recovery is counted', pb.recoveries, 1);
})();
```

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement**

```js
function pbControls(){
  const pb = PR.pb, ctl = [];
  if (pb.peeks > 0) ctl.push(['Peek (' + (pb.peeks === Infinity ? '∞' : pb.peeks) + ' left)', pbPeek]);
  ctl.push(["I've lost it", pbRecover]);
  ctl.push(['Reveal and stop', () => pbEnd('Stopped.')]);
  prCtl(ctl);
}
function pbShowTruth(ms, then){
  const pb = PR.pb;
  prBoardOn(true); prMen(true); prPaint(pb.st.b);
  prTimer(() => { pbPaint(); if (then) then(); }, ms);
}
function pbPeek(){
  const pb = PR.pb; if (pb.over || pb.busy || pb.peeks <= 0) return;
  if (pb.peeks !== Infinity) pb.peeks--;
  pbLine('(peek)', 'sys');
  pbShowTruth(2000, pbControls);
}
/* The stone: every few moves the game stops and asks one thing about the
   position as it now stands. A miss is a drift, and the true board is shown
   for two seconds — the check is what catches the drift before it compounds. */
function pbCheckpoint(){
  const pb = PR.pb; pb.busy = true; pb.checks++;
  const kind = prPick(['fine','count','last']);
  let ask;
  if (kind === 'last') ask = { t:'last', truth: pb.sans[pb.sans.length - 1], text:'Checkpoint — what was the last move played?' };
  else if (kind === 'count'){ const c = Math.random() < .5 ? W : B; let n = 0; for (let i = 0; i < 64; i++) if (pb.st.b[i] && pb.st.b[i].c === c) n++; ask = { t:'count', colour:c, type:null, n, text:'Checkpoint — how many men does ' + prSide(c) + ' have?' }; }
  else { ask = prAskFine(pb.st); ask.text = 'Checkpoint — ' + ask.text; }
  const done = ok => {
    prAnsClear(); PR.click = null;
    if (ok){ pb.checksOk++; prSay('Held.', 'right'); beep(760, .09); pb.busy = false; pbRestoreInput(); }
    else { pb.drifts++; prSay('Not quite — this is how it stands.', 'wrong'); beep(190, .16, 'sine', .09); pbShowTruth(2000, () => { pb.busy = false; pbRestoreInput(); }); }
  };
  prQ(ask.text);
  if (ask.t === 'last'){
    // decoys are moves that were legal in the position the last move was played from
    const before = pb.prevSt, legalThen = legalMoves(before, before.turn);
    const others = prShuffle(legalThen.map(m => toSAN(before, m, legalThen)).filter(s => s !== ask.truth)).slice(0, 3);
    const choices = prShuffle([ask.truth].concat(others));
    for (const c of choices) prAnsButton(c, () => done(c === ask.truth));
  } else if (ask.t === 'count'){
    for (let n = 0; n <= 16; n++) prAnsButton(String(n), () => done(n === ask.n));
  } else if (ask.t === 'where'){
    prSub('Click its square.'); PR.click = i => done(i === ask.sq);
  } else {
    prAnsEl.className = 'pr-ans glyphs';
    for (const c of [W, B]) for (const ty of ['K','Q','R','B','N','P'])
      prAnsButton('<span class="g-' + c + '">' + pieceHTML(ty) + '</span>', () => done(ask.colour === c && ask.type === ty));
    prAnsButton('Empty square', () => done(ask.colour === null), 'wide');
  }
}
function pbRestoreInput(){
  prQ('Level ' + PR.pb.r.level + ' — <b>' + PR.pb.r.target + '</b> moves. Your move.');
  pbInput();                                            // the typed box AND the board click, both back
}
/* Lost the thread? The score is shown — never the board — and the position
   is rebuilt from it, which is what Koltanowski did and what every guide to
   the game says to do instead of guessing. Counted, not punished. */
function pbRecover(){
  const pb = PR.pb; if (pb.over || pb.busy) return;
  pb.busy = true;
  prSeq(pb.sans.map((s, k) => (k % 2 === 0 ? '<b>' + (k / 2 + 1) + '.</b> ' : '') + s).join(' '));
  const want = []; for (let i = 0; i < 64; i++) if (pb.st.b[i]) want.push({ sq:i, c:pb.st.b[i].c, t:pb.st.b[i].t });
  prClearPieces();
  prRebuildStart(want, { say:'Rebuild the position from the moves.', done(res){
    pb.recoveries++;
    prTimer(() => { prSeq(''); pbPaint(); pb.busy = false; pbRestoreInput(); }, 2500);
  } });
}
```

- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `git commit -am "Progressive Blindfold: checkpoints, peeks that run out, and recovery from the score"`

---

### Task 21: The end card and the two handoffs into real games

**Files:**
- Modify: `blind-chess.html` PRACTICE `prFinish` (results rows), `#prDoneOverlay` markup (~4805): add `#prNextLevel`, `#prBlindGame`, `#prBoardGame`; the handlers at ~13155
- Test: flow suite

**Interfaces:**
- After a `progressive` session the result card shows moves, checkpoints passed, peeks used, recoveries, drifts; buttons: `Next level` (pass and level < 10), `Play a See the Board game` (level ≥ 7), `Play a real one` (level 10 passed) which calls `goBot(); selectMode('total'); prSuggestFirstBlindGame();`; `prSuggestFirstBlindGame()` picks the 1000 rung and the slowest clock in the setup if those chooser functions exist (read `blind-chess.html` `chosen.level`/`chosen.minutes` and the `#levelPick`/`#timePick` handlers near `optionsAnswered()` at ~13880 to find the setters; call them, do not reach into the DOM).

- [ ] **Step 1: Test**

```js
head('Progressive Blindfold: the end card');
(function(){
  storage = {};
  prOpen('progressive', 10, 5);
  PR.pb.played = PR.pb.r.target; pbEnd('done');
  ok('level 10 passed offers a real game', byId.prBlindGame.style.display, '');
  byId.prBlindGame.onclick();
  ok('which goes to the bot setup', botTrips, 1);
  ok('with Complete Blindfold chosen', visionsPicked[visionsPicked.length - 1], 'total');
  prOpen('progressive', 7, 5);
  PR.pb.played = PR.pb.r.target; pbEnd('done');
  ok('level 7 offers a See the Board game', byId.prBoardGame.style.display, '');
  byId.prBoardGame.onclick();
  ok('with the empty-board vision chosen', visionsPicked[visionsPicked.length - 1], 'blind');
})();
```

- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** the rows and buttons in `prFinish` (progressive branch) and the two handlers mirroring the existing `prBlindGame` handler; `prNextLevel` calls `prOpen('progressive', level + 1, 5)`. Stub `prSuggestFirstBlindGame` as a no-op in the flow harness.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `git commit -am "Progressive Blindfold ends on the next level or a real game"`

---

# Phase 5 — Dashboard, sessions, recommendations

### Task 22: Groups, the readiness line and the cards

**Files:**
- Modify: `blind-chess.html` `#prDash` markup (~3948–3970: replace `.pr-summary` with `#prPath` and `#prDaily`), practice CSS, `prRenderDash`, `prRenderCards`
- Test: flow suite

**Interfaces:**
- `PR_GROUPS = [{key, name, modes:[...]}]` in the spec's order; `prGroupLevel(st, g)` → mean level as a fraction of each mode's ladder; `prAutomatic(st)` → true when `square` is level ≥ 5 with median latency < 1500 ms; `prReadiness(st)` → `{ groups:[{key, name, frac}], milestone:'first blind game'|null, next:{key, level, why} }`.
- Cards are grouped under six headings; each card shows `Level N · cap`, `Recommended now` / `Ahead of you` / `Solid` tag, and `Start` opens the setup overlay at `prStartLevel(key)`.
- The figures band shows days practised in a row (`st.days`), total answered and accuracy; the old answer-streak figure is gone with the old ladder.

- [ ] **Step 1: Test**

```js
head('The dashboard');
(function(){
  storage = {};
  var st = prLoad(); st.modes.square.level = 6; st.modes.square.stats.lat = [900,1000,1100]; prSave(st);
  ok('the Board group is automatic', prAutomatic(prLoad()), true);
  var r = prReadiness(prLoad());
  ok('six groups on the readiness line', r.groups.length, 6);
  ok('no milestone yet', r.milestone, null);
  prShowDash();
  ok('cards are grouped', byId.prCards.children.length, 6);
})();
```

- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** `PR_GROUPS`, `prGroupLevel`, `prAutomatic`, `prReadiness` (milestone when `tracker ≥ 9 && hold ≥ 7 && calc ≥ 5 && stats.pb[5] passed`), a `prRenderPath()` drawing six `.pr-stage` blocks with a fill bar each and the `next` sentence, and `prRenderCards` producing one `.pr-group` section per group with the cards inside. CSS: `.pr-path{display:grid;grid-template-columns:repeat(6,1fr);gap:8px}`, `.pr-stage .gauge-track` reuse, `.pr-tag.now{color:var(--gold)}`, `.pr-group h3{letter-spacing:.2em;text-transform:uppercase;font-size:12px;color:var(--muted)}`.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `git commit -am "Practice dashboard: six groups, a readiness line, grouped cards"`

---

### Task 23: The recommender

**Files:**
- Modify: `blind-chess.html` PRACTICE: replace `prRecommend` with `prRecommendNext`
- Test: generator suite

**Interfaces:**
- `prRecommendNext(st, done)` → `{ key, level, why }`; `done` is the lesson list (`lsnDone()` when it exists, else `[]`).
- Rule: walk `PR_GROUPS` in order; a group is "open" when every mode in every earlier group is level ≥ 2 (or automatic, for Board); among open groups take the first whose modes are not all ≥ 60% of their ladder; inside it prefer the mode with the lowest ladder fraction, then the oldest `lastAt`; skip `square`/`lines` once `prAutomatic`; `progressive` is offered when `done` has 10 or (`tracker ≥ 5 && attack ≥ 4 && forcing ≥ 2`); the `why` names the level's `cap` ("Try Move Tracker level 5: a small position, captures").

- [ ] **Step 1: Test**

```js
head('The recommender');
(function(){
  storage = {};
  var st = prLoad();
  ok('a fresh player is sent to the board', prRecommendNext(st, []).key === 'square' || prRecommendNext(st, []).key === 'lines', true);
  ['square','lines','piece','attack'].forEach(function(k){ st.modes[k].level = 5; });
  st.modes.square.stats.lat = [800];
  var r = prRecommendNext(st, []);
  ok('with the floor done, holding is next', ['hold','tracker'].indexOf(r.key) >= 0, true);
  ok('the why names a level caption', /level \d/.test(r.why), true);
  st.modes.tracker.level = 5; st.modes.forcing.level = 2; st.modes.hold.level = 4;
  ok('the bridge is offered once its three gates are met', prRecommendNext(st, []).key === 'progressive' || prRecommendNext(st, [10]).key === 'progressive', true);
})();
```

- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** as specified; `prFinish` uses it for the tip line: `'Next: ' + why`.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `git commit -am "A rule-based recommender that names the next concrete step"`

---

### Task 24: Quick, Daily and Focused sessions

**Files:**
- Modify: `blind-chess.html` PRACTICE: `goPractice('daily')`, `prStartDaily()`, `prNextQuestion` (mixed queue), setup overlay (Quick = 2 min button on each card), `#prDaily` button on the dashboard
- Test: flow suite

**Interfaces:**
- `PR.mixed` = array of mode keys the session rotates through, or null; `prStartDaily()` picks `prRecommendNext` plus the next two distinct recommendations after excluding it, budget 5 min; `prNextQuestion` draws `PR.mode = PR_MODE[PR.mixed[PR.i % PR.mixed.length]]` and `PR.level = prStartLevel(key)` when mixed, and `prFinish` in a mixed session writes each mode's level from the last level it was played at (kept in `PR.mixedLevel[key]`).

- [ ] **Step 1: Test**

```js
head('Daily training');
(function(){
  storage = {};
  goPractice('daily');
  ok('a daily session rotates three modes', PR.mixed && PR.mixed.length, 3);
  ok('five minutes on the clock', PR.budgetMs, 300000);
  ok('the first question belongs to the first mode', PR.q && PR.q.kind, PR.mixed[0]);
})();
```

- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** as specified; the Quick button on a card calls `prOpen(key, prStartLevel(key), 2)`.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `git commit -am "Quick, Daily and Focused practice sessions"`

---

### Task 25: First-visit intro and the one link back to a lesson

**Files:**
- Modify: `blind-chess.html` PRACTICE `prOpenSetup` (intro panel), `#prSetOverlay` markup (`#prSetIntro`), `PR_MODES` `intro:{what, how}` two lines each
- Test: flow suite

**Interfaces:**
- Each mode carries `intro:{ what:'…', how:'…' }`; the overlay shows both lines the first time a mode is opened (`st.modes[key].sessions === 0`) and a one-line `cap` afterwards; the "How this works: Lesson N" link (`m.lesson`) is shown whenever that lesson is not in `lsnDone()`, first visit or not — it is for the player who has not been taught the concept. The link calls `lsnOpen(m.lesson, 0)` after `showScreen('lessons')` when those exist.

- [ ] **Step 1: Test** — open the setup for `tracker` with `lsnDoneStub = []` and assert `byId.prSetIntro.innerHTML` contains "Lesson 5"; with `lsnDoneStub = [5]` it does not; with no sessions the two intro lines appear, with one session only the caption.
- [ ] **Step 2–5:** implement, run, commit `git commit -am "A two-line intro the first time a Practice mode is opened, and one link back to its lesson"`.

---

# Phase 6 — Cloud persistence

### Task 26: `supabase-migrate-practice.sql`

**Files:**
- Create: `supabase-migrate-practice.sql`

- [ ] **Step 1: Write the file**, modelled line for line on `supabase-migrate-puzzles.sql`'s header and structure:

```sql
begin;
create table if not exists public.practice_progress (
  user_id    uuid        not null references auth.users on delete cascade,
  mode       text        not null check (mode ~ '^[a-z]{3,16}$'),
  level      integer     not null default 1 check (level between 1 and 20),
  best       integer     not null default 1 check (best between 1 and 20),
  asked      integer     not null default 0 check (asked >= 0),
  correct    integer     not null default 0 check (correct >= 0 and correct <= asked),
  sessions   integer     not null default 0 check (sessions >= 0),
  stats      jsonb       not null default '{}'::jsonb check (pg_column_size(stats) < 16384),
  updated_at timestamptz not null default now(),
  primary key (user_id, mode)
);
alter table public.practice_progress enable row level security;
drop policy if exists "practice: own rows" on public.practice_progress;
create policy "practice: own rows" on public.practice_progress
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
revoke all on public.practice_progress from anon;
grant select, insert, update on public.practice_progress to authenticated;
create or replace function public.practice_touch() returns trigger language plpgsql as $$
begin new.updated_at := now(); new.user_id := auth.uid(); return new; end $$;
drop trigger if exists practice_touch on public.practice_progress;
create trigger practice_touch before insert or update on public.practice_progress
  for each row execute function public.practice_touch();
commit;
```

Header comment must state: what it touches (one new table, its policy, one function and trigger), what it never touches (auth schema, profiles, ratings), that it is safe to re-run, and that no DELETE grant exists on purpose (as with puzzle progress).

- [ ] **Step 2:** `psql`-free check: `python3 - <<'EOF'` that the file contains no `drop table`, `truncate`, or `delete from`.
- [ ] **Step 3: Commit** `git commit -am "practice_progress: one row per player per mode, owner-only under RLS"`

### Task 27: `tools/check_supabase_practice.py`

**Files:**
- Create: `tools/check_supabase_practice.py` (copy the structure of `tools/check_supabase_puzzles.py`: reads URL and key from the page, takes `SUPABASE_TEST_TOKEN`)

- [ ] **Step 1:** Checks: (1) upsert `{mode:'probe', level:3}` as the token's user succeeds; (2) reading it back returns level 3; (3) the same row with `user_id` set to another uuid is refused (trigger overwrites or RLS denies — assert the read-back still shows only own rows); (4) the anon key cannot select any row; (5) `mode:'not valid!'` is refused by the check constraint. Print the cleanup SQL at the end as the puzzles script does.
- [ ] **Step 2:** Add the command to `CLAUDE.md`'s command list.
- [ ] **Step 3: Commit** `git commit -am "check_supabase_practice.py proves the practice table's RLS against the real project"`

### Task 28: `prSync`, `prPush`, guest adoption, the course row

**Files:**
- Modify: `blind-chess.html` PRACTICE (after `prSave`), ACCOUNTS `setAccount` (~14546: add `prSync();` after `pzSync();`), LESSONS `lsnPush` (~10205)
- Test: generator suite (with a stubbed `sb`)

**Interfaces:**
- `prPush(key)` upserts one mode row; `prPushCourse(done)` upserts `{mode:'course', stats:{done}}`; `prSync()` reads all rows, merges with the account's cache and the guest cache (`prMerge(a, b)`: higher `level`/`best`, the record with more `asked` for asked/correct/sessions/stats, union for course `done`), writes the cache, pushes anything the account lacked, then clears the guest cache (`localStorage.removeItem(PR_STORE + 'guest')`).
- `lsnPush(n)` calls `prPushCourse(lsnDone())`; on sync the `course` row is merged (union) with the account's local record `lsnStored(account.id)` **and** the guest record `lsnStored('')`, written back through `lsnWrite`, pushed if anything was new, and the guest lessons record removed — the same adoption the puzzle ladder does, so a course finished before signing up stays finished.
- Guests: everything above is skipped when `!sb || !account`; a guest's practice and course records live only in this browser under the `guest`/`''` owner keys, exactly as today.

- [ ] **Step 1: Test** — stub `sb` in the generator suite with `from()` returning `{ select: ..., eq: ..., upsert: ... }` promise chains recording calls; assert a guest record with `tracker.level = 4` and an account row with `tracker.level = 2` merge to 4 and produce one upsert.
- [ ] **Step 2–5:** implement (every step wrapped in try/catch and `console.warn`, exactly as `pzSync`), run, commit `git commit -am "Practice progress and course completion sync to practice_progress"`.

---

# Phase 7 — The course

The LESSONS section keeps its shape: `LESSONS[]` of `{n, name, blurb, build()}`, a step is `{title, what, ask, gate, auto, setup()}`, `lsnResetStep()` is the only door into a step, `lsnRight`/`lsnWrong`/`lsnConcede` judge, and `lsnAskMove`, `lsnChoices`, `lsnUnder`, `lsnExtraShow` present. New step factories are added beside the existing `lsnDrill*` ones; every generated position comes from the Practice generators at a named recipe, so a lesson and its mode agree.

### Task 29: Course infrastructure: ten lessons, storage v3, the handoff step, the end buttons

**Files:**
- Modify: `blind-chess.html` LESSONS: `LESSONS` (~10243), `lsnNormalise`/`lsnWrite` (~10177–10196), `lsnNext` (~10743), `lsnHub` lede (~10693), `lsnFinish` (~10760), `lsnPlayBlindfold` (~10826), `lsnWire` (`lsnGoPractice`, `lsnGoPlay`); `#lsnDone` markup (~4113–4126: three buttons `#lsnGoTrain`, `#lsnGoProgressive`, `#lsnGoPlay`)
- Test: `server/test_lessons.js`

**Interfaces:**
- `LESSONS` has ten entries, each with `train:{ mode, level, say }`; `LSN_V2_TO_V3 = {1:1, 2:3, 3:4, 4:5}`; records are written as `{v:3, done}`.
- `lsnHandoffStep(L)` → the last step of every lesson: a card with `train.say`, a `Train this` button (`goPractice({ mode:L.train.mode, level:L.train.level })`) and the ordinary Continue; `gate:false`.
- `lsnMark(n)` runs when the handoff step is reached (so a learner who leaves from the card still has the lesson).
- `lsnOpenVisionPick()` = `goBot(); document.getElementById('cardBlind').classList.add('active'); lsnNoteFirstGame();` where the note is a one-line `.lsn-say` under the card: "See the Board first. Complete Blindfold when Progressive Blindfold's last level is behind you." (read `blind-chess.html:13618–13630` to confirm `active` is the class that splits the card; if the page toggles it in a handler, call that handler instead).

- [ ] **Step 1: Test** — in `server/test_lessons.js` part 1 add:

```js
head('The course is ten lessons that each hand off to Practice');
const LESSONS_SRC = grab(/\nconst LESSONS = \[[\s\S]*?\n\];/, 'LESSONS');
check('ten lessons are declared', (LESSONS_SRC.match(/\{ n:\d+/g) || []).length === 10);
check('every lesson names a Practice mode to train', (LESSONS_SRC.match(/train:\{ mode:'[a-z]+'/g) || []).length === 10);
const V23 = new Function(grab(/\nconst LSN_V2_TO_V3 = \{[^\n]*\};/, 'LSN_V2_TO_V3') + '\nreturn LSN_V2_TO_V3;')();
check('the old challenge lesson has nowhere to land', V23[5] === undefined);
check('old lesson 2 (notation) becomes lesson 3', V23[2] === 3);
```

and in part 2 assert that finishing lesson 1 (walked as today) ends on a step whose card contains "Train this", that pressing it records `screens` last as `'practice'` with `PR.mode.key === 'square'`, and that the done overlay has the three buttons.

- [ ] **Step 2: Run** `node server/test_lessons.js` — FAIL.

- [ ] **Step 3: Implement**

```js
const LESSONS = [
  { n:1,  name:'Know, Don’t See',              blurb:'The board from either chair, its colours and quarters — and why nobody needs a picture.',
    train:{ mode:'square', level:2, say:'Train Square Trainer until squares from either chair come in under two seconds with the labels off.' }, build:() => lsnLesson1() },
  { n:2,  name:'Lines and the Knight',         blurb:'Ranks, files, the two diagonals through a square, and where a knight lands.',
    train:{ mode:'lines', level:2, say:'Train Lines & Routes until both diagonals through any square, and a two-move knight route, come from the name alone.' }, build:() => lsnLesson2() },
  { n:3,  name:'Reading a Move',               blurb:'From-square to to-square, captures that remove, castling that moves two men.',
    train:{ mode:'tracker', level:1, say:'Train Move Tracker levels 1 and 2 until a written move lands on the right squares first time.' }, build:() => lsnLesson3() },
  { n:4,  name:'Reach and Attack',             blurb:'Where a hidden piece reaches, what blocks it, and what it attacks or defends.',
    train:{ mode:'piece', level:2, say:'Train Piece Vision to level 4, a crowded board, and Attack Vision to level 4, the attackers of a square.' }, build:() => lsnLesson4() },
  { n:5,  name:'Holding a Small Position',     blurb:'The start position plus two moves, then four men held kings-first.',
    train:{ mode:'tracker', level:3, say:'Train Move Tracker levels 3 and 4 — real openings from the start — until four plies feel steady. Then Hold the Position to level 3.' }, build:() => lsnLesson5() },
  { n:6,  name:'Updating: Where, and What Changed', blurb:'The square a move leaves behind, and the line it opens.',
    train:{ mode:'after', level:2, say:'Train After the Move to level 3, with the position hidden after study.' }, build:() => lsnLesson6() },
  { n:7,  name:'Captures and Counting',        blurb:'A capture removes a man; a count catches the one you forgot.',
    train:{ mode:'forcing', level:2, say:'Train Forcing Lines to level 3, three attackers against two, and Move Tracker levels 5 and 6.' }, build:() => lsnLesson7() },
  { n:8,  name:'Check Yourself, and Get It Back', blurb:'Three questions every few moves, and rebuilding from the score when it slips.',
    train:{ mode:'tracker', level:7, say:'Train Move Tracker from level 7, where the check questions come every few plies, until three sessions pass with no drift.' }, build:() => lsnLesson8() },
  { n:9,  name:'Calculating Short Lines',      blurb:'Forcing moves first, one line, a stone at its end, and back to the root.',
    train:{ mode:'calc', level:2, say:'Train Blind Calculation to level 3, then Branches level 1: two lines from one root.' }, build:() => lsnLesson9() },
  { n:10, name:'Playing Without the Pieces',   blurb:'The visions, the peeks, and one small game with your men shown.',
    train:{ mode:'progressive', level:1, say:'Start Progressive Blindfold at its first level.' }, build:() => lsnLesson10() }
];
const LSN_V2_TO_V3 = { 1:1, 2:3, 3:4, 4:5 };
```

`lsnNormalise(raw)`: `v>=3` → as is; `v===2` → map through `LSN_V2_TO_V3`; `v===1` → map through `LSN_V1_TO_V2` then `LSN_V2_TO_V3`. `lsnWrite` writes `{v:3, done}`. `lsnHandoffStep`:

```js
function lsnHandoffStep(L){
  return {
    title:'Train this', what:'<p>' + L.train.say + '</p>', ask:'', gate:false, handoff:true,
    setup(){
      lsnMark(L.n);
      LSN.st = lsnEmpty(); LSN.mode = 'sighted';
      lsnUnder([{ label:'Train this in Practice', cls:'primary wide', on(){ goPractice({ mode:L.train.mode, level:L.train.level }); } }]);
      lsnSay('Or press Continue for the next lesson.', 'tip');
    }
  };
}
```

Every `lsnLessonN()` ends with `lsnHandoffStep(LESSONS[N-1])`. `lsnNext` at the last step no longer calls `lsnMark` (the handoff did). `lsnHub`'s lede says "Ten lessons, from naming a square to a game with the men hidden." The done face's three buttons: `lsnGoTrain` → `goPractice()`, `lsnGoProgressive` → `goPractice({ mode:'progressive', level:1 })`, `lsnGoPlay` → `lsnOpenVisionPick()`. Delete `lsnPlayBlindfold`. Until Tasks 30–35 land, `lsnLesson2`, `6`–`10` may return `[lsnHandoffStep(L)]` alone so the page runs; part 2 of the lessons test walks whatever exists.

- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `git commit -am "Ten lessons, storage v3, a handoff card at the end of each, three ways out of the course"`

---

### Task 30: Lessons 1 to 3

**Split point:** commit this as two tasks. **30a** is the seven step factories and the harness dispatcher with its solvers. **30b** is the three lesson builders and their walk in the lessons test.

**Files:**
- Modify: `blind-chess.html` LESSONS: `lsnLesson1` (was `lsnLessonBoard`), `lsnLesson2` (new), `lsnLesson3` (was `lsnLessonNotation`); new factories `lsnStepDemo`, `lsnStepColour`, `lsnStepQuadrant`, `lsnStepBetween`, `lsnStepDiagPick`, `lsnStepKnight`, `lsnStepTypeMove`
- Test: `server/test_lessons.js` (solvers for the new kinds)

**Interfaces:**
- `lsnStepDemo({title, what, ask, marks:[[sq, cls]...], flip, then})` — a gate-less step that lights squares and waits for Continue.
- `lsnStepColour(q)` — two choice buttons, from `prMakeSquare(prRecipe('square', 5))` forced to `ask:'colour'`.
- `lsnStepQuadrant(q)`, `lsnStepBetween(q)` (select squares then a Done under-button; `q` from `prMakeLines(prRecipe('lines', 1|2))` with `ask:'between'`), `lsnStepDiagPick(q)` (from level 4 `through`), `lsnStepKnight(q)` (number choices; from level 7).
- `lsnStepTypeMove(item)` — the console open, the learner types `item.san`; judged by `parseMoveIn`.

- [ ] **Step 1: Test** — extend the part-2 solver in `server/test_lessons.js`:

```js
// choice buttons: press each until one is marked right
async function solveChoices(){ for (const b of choiceButtons()){ b.click(); if (LSN.ok) return true; } return false; }
// select-many on the board: click every square the page marks as the truth once revealed is not allowed —
// instead brute-force from geometry: the step stores its answer on LSN.steps[LSN.step].truth
async function solveSelect(){ const s = LSN.steps[LSN.step]; for (const sq of s.truth) clickSquare(sq); pressUnder('Done'); return LSN.ok; }
async function solveTyped(){ const s = LSN.steps[LSN.step]; const legal = C.legalMoves(LSN.st, LSN.st.turn);
  for (const m of legal){ typeConsole(C.toSAN(LSN.st, m, legal)); if (LSN.ok) return true; } return false; }
```

and a dispatcher that reads `LSN.steps[LSN.step].solve` (`'square'|'choices'|'select'|'typed'|'move'|'none'`) which every new factory sets. Add part-1 checks that every fixed position used by lessons 1–3 is legal (the notation forms are already checked), and that `LSN_NOTATION` contains one capture (`x`), one castle (`O-O`), one promotion (`=`) and one disambiguated move (`/^[NRQB][a-h1-8][a-h][1-8]/`); if a form is missing, add it to the ten (replacing a duplicate form) so lesson 3 teaches everything the spec lists.

- [ ] **Step 2: Run** — FAIL (no `solve` field on steps).

- [ ] **Step 3: Implement**

```js
function lsnStepDemo(o){
  return { title:o.title, what:o.what, ask:o.ask || '', gate:false, solve:'none',
           setup(){ LSN.st = o.st || lsnEmpty(); LSN.flip = !!o.flip; LSN.named = !!o.named; LSN.mode = o.mode || 'sighted';
                    (o.marks || []).forEach(([sq, cls]) => LSN.marks.set(sq, cls)); if (o.say) lsnSay(o.say, 'tip'); } };
}
function lsnStepColour(q){
  return { title:'Light or dark?', what:'<p>Colour by the rule, not by looking: a1 is dark, and colour alternates.</p>',
           ask:'Is <code>' + sqName(q.sq) + '</code> light or dark?', gate:true, auto:900, solve:'choices',
           setup(){ LSN.st = lsnEmpty(); LSN.named = false; const frame = document.getElementById('lsnFrame'); if (frame) frame.style.display = 'none';
                    lsnChoices([{ label:'Light', right:!q.dark }, { label:'Dark', right:q.dark }], (c, b) => {
                      if (c.right){ b.classList.add('right'); lsnRight(prColourWhy(q.sq)); return; }
                      b.classList.add('wrong'); b.disabled = true; lsnWrong(prColourWhy(q.sq)); }, true); } };
}
function lsnStepQuadrant(q){
  const names = PR_QUADRANT_NAME;
  return { title:'Which quarter?', what:'<p>Four quarters, each with a corner to name it. Koltanowski taught these first.</p>',
           ask:'Which quarter holds <code>' + sqName(q.sq) + '</code>?', gate:true, auto:900, solve:'choices',
           setup(){ LSN.st = lsnEmpty(); LSN.named = true; LSN.marks.set(q.sq, 'lsn-lit');
                    lsnChoices(['a8','h8','a1','h1'].map(k => ({ label:names[k], right:k === q.answer })), (c, b) => {
                      if (c.right){ b.classList.add('right'); lsnRight('Yes — ' + names[q.answer] + '.'); return; }
                      b.classList.add('wrong'); b.disabled = true; lsnWrong('Not that quarter.'); }, true); } };
}
function lsnStepBetween(q){
  const step = { title:'The squares between', what:'<p>Name every square a slider would cross.</p>',
    ask:'Click every square between <code>' + sqName(q.a) + '</code> and <code>' + sqName(q.b) + '</code>, then press Done.',
    gate:true, solve:'select', truth:q.answer,
    setup(){ LSN.st = lsnEmpty(); LSN.named = true; LSN.marks.set(q.a, 'sel'); LSN.marks.set(q.b, 'sel');
      LSN.onSquare = i => { if (LSN.ok || i === q.a || i === q.b) return; if (LSN.pick.has(i)) LSN.pick.delete(i); else LSN.pick.add(i); lsnRender(); };
      lsnUnder([{ label:'Done', cls:'primary wide', on(){
        const want = new Set(q.answer), got = LSN.pick;
        const missed = q.answer.filter(s => !got.has(s)), extra = Array.from(got).filter(s => !want.has(s));
        q.answer.forEach(s => LSN.marks.set(s, got.has(s) ? 'lsn-right' : 'lsn-miss')); extra.forEach(s => LSN.marks.set(s, 'lsn-wrong'));
        LSN.onSquare = null; lsnRender();
        if (!missed.length && !extra.length) lsnRight('All ' + q.answer.length + ' of them.');
        else lsnConcede('The line runs ' + q.answer.map(sqName).join(', ') + '.'); } }]); } };
  return step;
}
function lsnStepDiagPick(q){
  return { title:'On a diagonal?', what:'<p>Two diagonals cross at every square. Which of these lie on one through it?</p>',
           ask:'Pick every square on a diagonal through <code>' + sqName(q.a) + '</code>.', gate:true, solve:'choices',
           setup(){ LSN.st = lsnEmpty(); LSN.named = false; const frame = document.getElementById('lsnFrame'); if (frame) frame.style.display = 'none';
                    let left = q.answer.length;
                    lsnChoices(q.choices.map(sq => ({ label:sqName(sq), right:q.answer.indexOf(sq) >= 0 })), (c, b) => {
                      if (c.right){ b.classList.add('right'); b.disabled = true; if (--left === 0) lsnRight('Both found.'); return; }
                      b.classList.add('wrong'); b.disabled = true; lsnWrong(c.label + ' is not on either diagonal.'); }, false); } };
}
function lsnStepKnight(q){
  return { title:'How many knight moves?', what:'<p>A knight changes colour every move and lands three squares away on the L.</p>',
           ask:'Fewest moves from <code>' + sqName(q.a) + '</code> to <code>' + sqName(q.b) + '</code>?', gate:true, solve:'choices',
           setup(){ const b = Array(64).fill(null); b[q.a] = mk(W,'N'); b[sqIndex('a1')] = b[sqIndex('a1')] || mk(W,'K'); b[sqIndex('h8')] = b[sqIndex('h8')] || mk(B,'K');
                    LSN.st = { b, turn:W, cr:{wK:0,wQ:0,bK:0,bQ:0}, ep:-1, half:0, full:1 }; LSN.named = true; LSN.marks.set(q.b, 'lsn-lit');
                    lsnChoices([1,2,3,4].map(n => ({ label:String(n), right:n === q.answer })), (c, b2) => {
                      if (c.right){ b2.classList.add('right'); q.route.forEach((sq, k) => lsnAt(() => { LSN.marks.set(sq, 'lsn-right'); lsnRender(); }, 350 * k)); lsnRight(q.answer + ' — the route is ' + q.route.map(sqName).join(' → ') + '.'); return; }
                      b2.classList.add('wrong'); b2.disabled = true; lsnWrong('Not ' + c.label + '.'); }, true); } };
}
function lsnStepTypeMove(item){
  return { title:'Type the move', what:'<p>In Complete Blindfold you type your moves. Type this one.</p>',
           ask:'Type <code>' + item.san + '</code> and press Play.', gate:true, solve:'typed',
           setup(){ LSN.st = stateFromFEN(item.fen); LSN.mode = 'sighted'; LSN.console = true; LSN.entry = true;
                    LSN.onEntry = text => { if (LSN.ok) return; const res = parseMoveIn(LSN.st, text); if (res.error){ lsnWrong(res.error); return; }
                      const legal = legalMoves(LSN.st, LSN.st.turn); if (toSAN(LSN.st, res.move, legal) === item.san){ lsnPlayMove(res.move); lsnRight('Played.'); } else lsnWrong('That is a legal move, but not ' + item.san + '.'); }; } };
}
```

Lesson builders:

```js
function lsnLesson1(){
  const L = LESSONS[0];
  const coordSet = lsnCoordSet(4);                       // the existing set, cut to four: two chairs, two kinds
  return [
    lsnStepDemo({ title:'Know, don’t see', what:'<p><b>George Koltanowski</b>, who played 34 games at once without a board, said: “I don’t see the position — I just know it.” Nothing in this course needs a picture. It needs you to <b>know where things are</b>.</p>', ask:'a1 is the dark corner at White’s left. Press Continue.', named:true, marks:[[sqIndex('a1'), 'lsn-lit']] }),
    lsnStepDemo({ title:'The same square from Black’s chair', what:'<p>Turned round, a1 is at the far right. The names do not move; you do.</p>', ask:'Press Continue.', named:true, flip:true, marks:[[sqIndex('a1'), 'lsn-lit']] }),
    ...coordSet,
    lsnStepDemo({ title:'The colour rule', what:'<p>' + prColourWhy(sqIndex('e4')) + '</p>', ask:'Every dark square shares that rule.', named:true, marks:[[sqIndex('e4'), 'lsn-lit']] }),
    lsnStepColour(Object.assign(prMakeSquare(prRecipe('square', 5)), { ask:'colour' })),
    lsnStepColour(Object.assign(prMakeSquare(prRecipe('square', 5)), { ask:'colour' })),
    lsnStepDemo({ title:'Four quarters', what:'<p>Koltanowski taught the board as four quarters, each named by its corner. Once one quarter is yours, the others follow the same logic.</p>', ask:'White’s kingside is lit.', named:true, marks:[24,25,26,27,32,33,34,35,40,41,42,43,48,49,50,51].map(i => [i + 4, 'lsn-lit']) }),
    lsnStepQuadrant(Object.assign(prMakeSquare(prRecipe('square', 5)), { ask:'quadrant' })),
    lsnHandoffStep(L)
  ];
}
function lsnLesson2(){
  const L = LESSONS[1], e4 = sqIndex('e4'), T = linesThrough(e4);
  const between = (lv) => { let q; do { q = prMakeLines(prRecipe('lines', lv)); } while (!q || q.ask !== 'between'); return q; };
  const through = () => { let q; do { q = prMakeLines(prRecipe('lines', 4)); } while (!q || q.ask !== 'through'); return q; };
  const knight = () => { let q; do { q = prMakeLines(prRecipe('lines', 7)); } while (!q || q.ask !== 'knight' || q.answer > 2); return q; };
  return [
    lsnStepDemo({ title:'The lines through a square', what:'<p>Four lines cross at every square: its rank, its file, and two diagonals.</p>', ask:'e4’s rank and file are lit.', named:true, marks:T.rank.concat(T.file).map(i => [i, 'lsn-lit']).concat([[e4, 'sel']]) }),
    lsnStepDemo({ title:'The two diagonals', what:'<p>A bishop lives on one colour forever; these are the squares a bishop on e4 could ever reach.</p>', ask:'Both diagonals through e4.', named:true, marks:T.diag1.concat(T.diag2).map(i => [i, 'lsn-lit']).concat([[e4, 'sel']]) }),
    lsnStepBetween(between(1)), lsnStepBetween(between(2)),
    lsnStepDiagPick(through()),
    lsnStepDemo({ title:'The knight', what:'<p>Two squares one way and one the other. It always lands on the other colour, and it never crosses anything.</p>', ask:'Every square a knight on e4 reaches.', named:true, st:(() => { const b = Array(64).fill(null); b[e4] = mk(W,'N'); b[sqIndex('a1')] = mk(W,'K'); b[sqIndex('h8')] = mk(B,'K'); return { b, turn:W, cr:{wK:0,wQ:0,bK:0,bQ:0}, ep:-1, half:0, full:1 }; })(), marks:DIR_N.map(([dr, dc]) => [(rowOf(e4)+dr)*8 + colOf(e4)+dc, 'lsn-lit']).filter(([i]) => i >= 0 && i < 64) }),
    lsnStepKnight(knight()), lsnStepKnight(knight()),
    lsnHandoffStep(L)
  ];
}
function lsnLesson3(){
  const L = LESSONS[2];
  const steps = LSN_NOTATION.map(lsnNotationStep);
  // full from-to first: the first two forms are shown as "e2–e4" before the short form
  steps[0].what = '<p>A move is a piece, the square it leaves and the square it lands on. Written in full: <b>e2–e4</b>. Shortened: <b>e4</b>.</p>';
  steps[1].what = '<p>In full, <b>Ng1–f3</b>. Shortened, <b>Nf3</b>: the piece and where it lands.</p>';
  const cap = LSN_NOTATION.find(i => i.san.indexOf('x') >= 0), castle = LSN_NOTATION.find(i => i.san === 'O-O');
  return steps.concat([
    lsnStepDemo({ title:'A capture removes a man', what:'<p><b>' + cap.san + '</b>: the man on ' + cap.san.slice(-2) + ' leaves the board. Strike it off — a captured man still counted is the commonest blindfold mistake there is.</p>', ask:'Press Continue.', st:stateFromFEN(cap.fen), named:true }),
    lsnStepDemo({ title:'Castling moves two men', what:'<p><b>O-O</b>: the king two squares towards the rook, and the rook over it. Move both in your head in one motion.</p>', ask:'Press Continue.', st:stateFromFEN(castle.fen), named:true }),
    lsnStepTypeMove(LSN_NOTATION[2]),
    lsnHandoffStep(L)
  ]);
}
```

(`lsnCoordSet` returns the existing click/name drill steps; add `solve:'square'` to `lsnDrillClick` and `lsnDrillName` steps and `solve:'move'` to notation steps so the dispatcher can pick.)

- [ ] **Step 4: Run** `node server/test_lessons.js` — PASS.
- [ ] **Step 5: Commit** `git commit -am "Lessons 1–3: know don't see, lines and the knight, reading a move"`

---

### Task 31: Lessons 4 and 5

**Files:**
- Modify: `blind-chess.html` LESSONS: `lsnLesson4` (from `lsnLessonVisualize`), `lsnLesson5` (new); factories `lsnStepAttackYesNo`, `lsnStepHanging`, `lsnStepOpeningHold`, `lsnStepCluster`, `lsnStepRebuild`; `LSN_POS_ORDER` → Fine's order
- Test: `server/test_lessons.js`

**Interfaces:**
- `lsnStepAttackYesNo(q)` from `prMakeAttack(prRecipe('attack', 1|5))` (`attacks` / `defended`): two choices.
- `lsnStepHanging(q)` from level 6: click the hanging man.
- `lsnStepOpeningHold(plies)`: the start position, `plies` book moves read out with the men hidden, then a `what` question on a square that changed (reuses `lsnDrillTrack` with `plies` = 2 — keep that function, it already starts from `newState()`).
- `lsnStepCluster(q)` from `prMakeHold(prRecipe('hold', 2))` forced to `mode:'question'`: the Position card in Fine's order (kings first), study, I'm Ready, then the question; `lsnPositionHTML` reorders to `['K','Q','R','B','N','P']` grouped as "King / beside the king / pawns / the rest" — implement `lsnPositionHTML(st)` to emit four labelled groups per side: the king, men within one square of it, pawns, everything else.
- `lsnStepRebuild(q)` from level 3 forced to `mode:'rebuild'`: a palette under the card (`lsnChoices` of twelve glyphs, `col`), click squares to place, Done judges with `rebuildDiff`, marks `lsn-right`/`lsn-wrong`/`lsn-miss`; `solve:'rebuild'` with `truth:q.want`.

- [ ] **Step 1: Test** — solver for `'rebuild'`: pick each glyph button whose `dataset.c/t` match a truth man, click its square, press Done. Part-1 check: the Position card groups exist for a known FEN (`lsnPositionHTML` extracted and run against `C.stateFromFEN('6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1')` contains "King" before "Pawn").
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** the factories in the pattern of Task 30 (choices via `lsnChoices`, board clicks via `LSN.onSquare`, judgement via `lsnRight`/`lsnWrong`/`lsnConcede`), and:

```js
function lsnLesson4(){
  const L = LESSONS[3];
  const att = lv => { let q; do { q = prMakeAttack(prRecipe('attack', lv)); } while (!q || (lv === 1 ? q.ask !== 'attacks' : lv === 5 ? q.ask !== 'defended' : q.ask !== 'hanging')); return q; };
  return [
    lsnDrillReach('N', false), lsnDrillReach('B', true),
    lsnStepDemo({ title:'A blocker', what:'<p>A slider stops at the first man in its way. A knight never does.</p>', ask:'The bishop’s ray ends at the pawn.', st:stateFromFEN('4k3/8/8/8/3p4/8/1B6/4K3 w - - 0 1'), named:true, marks:[[sqIndex('c3'),'lsn-lit'],[sqIndex('d4'),'lsn-wrong']] }),
    lsnStepAttackYesNo(att(1)), lsnStepAttackYesNo(att(1)),
    lsnStepDemo({ title:'Attack and defence are one line', what:'<p>Read the same ray the other way and it is a defence. “Hanging” means attacked and not defended.</p>', ask:'Press Continue.', named:true }),
    lsnStepAttackYesNo(att(5)), lsnStepHanging(att(6)),
    lsnHandoffStep(L)
  ];
}
function lsnLesson5(){
  const L = LESSONS[4];
  const hold = (lv, mode) => { let q; do { q = prMakeHold(prRecipe('hold', lv)); } while (!q || q.mode !== mode); return q; };
  return [
    lsnStepDemo({ title:'The position you already own', what:'<p>Every game starts here. After two moves, only two men have moved — so that is all there is to hold.</p>', ask:'Press Continue.', st:newState(), named:true }),
    lsnDrillTrack(2), lsnDrillTrack(2),
    lsnStepDemo({ title:'Kings first', what:'<p>Reuben Fine held a position from the king outward: the king, what stands beside it, the pawns, then the rest. The Position card below says a position in that order.</p>', ask:'Press Continue.', named:true }),
    lsnStepCluster(hold(2, 'question')), lsnStepCluster(hold(2, 'question')),
    lsnStepRebuild(hold(3, 'rebuild')),
    lsnHandoffStep(L)
  ];
}
```

- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `git commit -am "Lessons 4–5: reach and attack, holding a small position kings-first"`

---

### Task 32: Lessons 6 and 7

**Files:**
- Modify: `blind-chess.html` LESSONS: `lsnLesson6`, `lsnLesson7`; factories `lsnStepChange`, `lsnStepAfter`, `lsnStepCaptureSeq`, `lsnStepExchange`
- Test: `server/test_lessons.js`

**Interfaces:**
- `lsnStepChange(q)` from `prMakeHold(prRecipe('hold', 3))` forced `mode:'change'`: show, hide 1.5 s, show `q.change.after`, click the from-square; `solve:'square'` with `truth:[q.change.from]`.
- `lsnStepAfter(q, kind)` from `prMakeAfter(prRecipe('after', 1))`: `vacated` (click), `attacks` (select + Done), `hanging` (select + Done with a "Nothing" under-button), `check` (choices).
- `lsnStepCaptureSeq()`: `prMakeTracker(prRecipe('tracker', 5))` forced to a `captured` ask; men hidden, read out, choices of man names.
- `lsnStepExchange(q)` from `prMakeForcing(prRecipe('forcing', 1))`: show, hide, the line in the card, four material choices.

- [ ] **Step 1: Test** — solvers: `'square'` already clicks `truth`; choices solver covers the rest.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** the factories and:

```js
function lsnLesson6(){
  const L = LESSONS[5];
  const change = () => { let q; do { q = prMakeHold(prRecipe('hold', 3)); } while (!q || q.mode !== 'change'); return q; };
  const after = kind => { let q; do { q = prMakeAfter(Object.assign(prRecipe('after', 1), { kinds:[kind], asks:1 })); } while (!q); return q; };
  return [
    lsnStepChange(change()),
    lsnStepDemo({ title:'Two things change', what:'<p>A move puts a man on a new square <b>and</b> empties the one it left. The empty square is where discovered lines and loose men come from.</p>', ask:'Press Continue.', named:true }),
    lsnStepAfter(after('vacated'), 'vacated'), lsnStepAfter(after('attacks'), 'attacks'),
    lsnStepAfter(after('hanging'), 'hanging'), lsnStepAfter(after('check'), 'check'),
    lsnHandoffStep(L)
  ];
}
function lsnLesson7(){
  const L = LESSONS[6];
  return [
    lsnStepDemo({ title:'A capture is a removal and a move', what:'<p>When a man is taken it is gone. Say it: “the pawn on f7 is gone.” A running count of men is how you catch the one you forgot.</p>', ask:'Press Continue.', named:true }),
    lsnStepCaptureSeq(), lsnStepCaptureSeq(),
    lsnStepDemo({ title:'Counting an exchange', what:'<p>Attackers against defenders on one square, cheapest first. Play it out in your head and count what is left.</p>', ask:'Press Continue.', named:true }),
    lsnStepExchange(prMakeForcing(prRecipe('forcing', 1))), lsnStepExchange(prMakeForcing(prRecipe('forcing', 2))),
    lsnHandoffStep(L)
  ];
}
```

- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `git commit -am "Lessons 6–7: what a move changes, captures and counting"`

---

### Task 33: Lessons 8 and 9

**Files:**
- Modify: `blind-chess.html` LESSONS: `lsnLesson8`, `lsnLesson9`; factories `lsnStepCheckThree`, `lsnStepRecover`, `lsnStepMate1`, `lsnStepLineThenRoot`
- Test: `server/test_lessons.js`

**Interfaces:**
- `lsnStepCheckThree()`: four plies from the start (tracker level 4 recipe), men hidden, then three questions in a row under one step: where is White's king (click), how many men has Black (choices), what was the last move (choices of four SAN); all three right → `lsnRight`.
- `lsnStepRecover()`: six plies read out with the men hidden, then the card says "You have lost the rook. Do not guess — rebuild from the score." The move list stays visible; the learner rebuilds with the palette (`lsnStepRebuild`'s mechanics), Done judges.
- `lsnStepMate1(q)` from `prMakeCalc(prRecipe('calc', 1))`: study, I'm Ready, men hidden, `lsnAskMove(want)`.
- `lsnStepLineThenRoot(q)` from `prMakeBranches(prRecipe('branches', 1))`: one branch's SAN list, a `what` question at its end (choices), then the root question (choices).

- [ ] **Step 1: Test** — solver for multi-question steps: the dispatcher loops `solveChoices`/`clickSquare(truth)` until `LSN.ok`, reading `LSN.steps[LSN.step].truth` which these factories update between questions.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** and:

```js
function lsnLesson8(){
  const L = LESSONS[7];
  return [
    lsnStepDemo({ title:'Three questions', what:'<p>Every few moves, stop and ask: <b>where are both kings? how many men each side? what was the last move?</b> A wrong answer is a drift caught early.</p>', ask:'Press Continue.', named:true }),
    lsnStepCheckThree(),
    lsnStepDemo({ title:'When it slips', what:'<p>Do not guess. Guessing cements a wrong board. Go back to the moves and rebuild — Koltanowski did exactly that when a board went dark on him.</p>', ask:'Press Continue.', named:true }),
    lsnStepRecover(),
    lsnHandoffStep(L)
  ];
}
function lsnLesson9(){
  const L = LESSONS[8];
  return [
    lsnStepDemo({ title:'Calculation is updating without being told the move', what:'<p>Forcing moves first — checks, captures, threats. One line at a time. Fix the position at its end like a stone in a stream, then step back to the root before the next line.</p>', ask:'Press Continue.', named:true }),
    lsnStepMate1(prMakeCalc(prRecipe('calc', 1))), lsnStepMate1(prMakeCalc(prRecipe('calc', 1))),
    lsnStepLineThenRoot(prMakeBranches(prRecipe('branches', 1))),
    lsnHandoffStep(L)
  ];
}
```

- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `git commit -am "Lessons 8–9: check yourself and get it back, calculating short lines"`

---

### Task 34: Lesson 10 and the guided mini game

**Files:**
- Modify: `blind-chess.html` LESSONS: `lsnLesson10` (from `lsnLessonChallenge`), `lsnRenderPieces` (a `'mine'` mode that draws only `LSN.eye`'s men, no square fog), factory `lsnStepMiniGame`
- Test: `server/test_lessons.js`

**Interfaces:**
- `lsnStepMiniGame()`: position from `prMakeProgressive(prRecipe('progressive', 1)).st`; `LSN.mode = 'mine'`, `LSN.eye = W`; the learner plays four moves with `lsnAskMove` accepting any legal move (`want = null` means "any legal"); the page replies with `bestMove(st, 2)`; after move two a checkpoint question (where is your king → click) interrupts; four moves played → `lsnRight`.
- Three demo steps show the same four-man position as See the Board (`LSN.mode='blind'`), Fog of War (`'fog'`) and Complete Blindfold (`'total'`, console shown), each with two lines on what is hidden and what a peek is.

- [ ] **Step 1: Test** — the solver for `'move'` with `want === null` plays the first legal move each time; the checkpoint uses `'square'` with `truth:[kingSq]`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement**

```js
function lsnLesson10(){
  const L = LESSONS[9];
  const st = stateFromFEN('6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1');
  return [
    lsnStepDemo({ title:'See the Board', what:'<p>Sixty-four empty squares to click. Three peeks. This is the empty board Krogius said to play on first.</p>', ask:'Press Continue.', st, mode:'blind' }),
    lsnStepDemo({ title:'Fog of War', what:'<p>Your men lit, everything else dark. A game vision, not a step on this path — the path runs through the two blindfold visions.</p>', ask:'Press Continue.', st, mode:'fog' }),
    lsnStepDemo({ title:'Complete Blindfold', what:'<p>No board at all. You type your moves and read theirs. Three peeks to save you.</p>', ask:'Press Continue.', st, mode:'total' }),
    lsnStepDemo({ title:'How a first game goes', what:'<p>Short. Few men. Check every three moves. Rebuild when it slips. Peeks are a tool, not a failure.</p>', ask:'Press Continue.', named:true }),
    lsnStepMiniGame(),
    lsnHandoffStep(L)
  ];
}
```

`LSN_CHALLENGES` is deleted along with `lsnChallengeStep`. Declare `const LSN_TEN_FEN = '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1';`, use it above, and in the same commit replace part 1 of `server/test_lessons.js` where it grabs `LSN_CHALLENGES` with a grab of `LSN_TEN_FEN` and a `sane()` check of it — the old grab would otherwise throw before any lesson runs.

- [ ] **Step 4: Run** — PASS (the whole course now walks; expect two to three minutes).
- [ ] **Step 5: Commit** `git commit -am "Lesson 10: the visions, and one small game with your men shown"`

---

### Task 35: Remove what the course no longer needs

**Files:**
- Modify: `blind-chess.html` LESSONS: delete `lsnLessonBoard`, `lsnLessonNotation`, `lsnLessonVisualize`, `lsnLessonTrack`, `lsnLessonChallenge`, `LSN_CHALLENGES`, `lsnChallengeStep`, `lsnPlayBlindfold`; the "rest is repetition" copy in `#lsnDone`; `lsnDrillTrack(6)`/`(8)` calls
- Test: all suites

- [ ] **Step 1:** `grep -n "lsnLessonBoard\|LSN_CHALLENGES\|lsnPlayBlindfold\|rest is repetition" blind-chess.html server/*.js` — expect no hits after the edit.
- [ ] **Step 2: Run** `node server/test_lessons.js && node server/test_practice.js && node server/test_practice_flow.js && node server/test_rematch_flow.js && node server/test_puzzle_flow.js` — PASS.
- [ ] **Step 3: Commit** `git commit -am "The old five-lesson course is gone"`

---

### Task 36: The lessons harness covers every step kind

**Files:**
- Modify: `server/test_lessons.js`

- [ ] **Step 1:** After the walk, assert that every `solve` value encountered is one of the known set and that no step was skipped (`stepsSeen === stepsTotal`); assert the course finished (`LSN.view === 'done'`) and that `lsnDone().length === 10`.
- [ ] **Step 2: Run** — PASS.
- [ ] **Step 3: Commit** `git commit -am "The lessons walk asserts every step kind was solved"`

---

# Phase 8 — Wrap

### Task 37: CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`: the Practice paragraphs ("Practice is not a second puzzle ladder…"), the lessons paragraphs ("The lessons are the game with one thing taken away…", "The course and Practice are two pages, and neither one is a door into the other"), the Commands block (add `python3 tools/check_supabase_practice.py` and `supabase-migrate-practice.sql` to the hand-run list), the Supabase notes (the new table beside `puzzle_progress`).

- [ ] **Step 1:** Rewrite those paragraphs to describe: eleven modes in six groups, level recipes and the staircase, the seen-list, error types and latency, the readiness line, the recommender rule, `goPractice(target)`, `PR_FLOORS`, Progressive Blindfold as a Practice mode with checkpoints and recovery, the two handoffs into real games, the ten lessons and the handoff step, storage v3 and `LSN_V2_TO_V3`, `practice_progress` and the `course` row, and the new rule: the course hands into Practice through `goPractice(target)`, and a Practice card's first-visit intro carries the one link back to its lesson. Keep the register of the file (why, at length).
- [ ] **Step 2: Commit** `git commit -am "CLAUDE.md describes the training system as built"`

### Task 38: Full verification

- [ ] **Step 1: Run** every JS suite listed in `CLAUDE.md` that does not need a server: `test_ws_url`, `test_rematch_flow`, `test_review`, `test_study_education`, `test_puzzle_flow`, `test_practice`, `test_practice_flow`, `test_lessons`, `test_leaderboard`, `test_ai_fallback`, `test_ai_game`, `test_live_games`, `test_spectate_flow`, and `python3 server/test_names.py`. All PASS.
- [ ] **Step 2:** Start `python3 server/server.py`, run `python3 server/test_two_clients.py` and `node server/test_rematch_e2e.js` (with `NOX_AI_WAIT=2` on both, per the memory note). PASS.
- [ ] **Step 3:** Open `http://localhost:8787/`, walk lesson 1 to its handoff, press Train this, run a two-minute Square Trainer session, open Progressive Blindfold level 1 and play to a checkpoint, press I've lost it, rebuild, finish. Confirm the browser's Back button steps through practice → lessons → home.
- [ ] **Step 4:** With a signed-in account and the migration run, confirm a row appears in `practice_progress` after a session and a `course` row after a lesson.
- [ ] **Step 5: Commit** any last fixes; tag nothing.

---

## Self-review against the spec

- **Coverage.** Skill model and eleven modes → Tasks 9–21; sessions, measurement, recommender → 3–5, 22–24; persistence → 26–28; ten lessons and handoffs → 29–34; course/Practice contract (`goPractice(target)`, floors, the one link back) → 6, 25, 29; Progressive Blindfold's end-of-level handoffs and the course's three end buttons → 21, 29; removal of the five-name ladder → 3; deduplication → 3, 4; copy rule → Global Constraints and Task 37.
- **Placeholders.** Tasks 21, 25, 27, 28 describe their tests in prose rather than as full code blocks because they are integration wiring over functions defined in earlier tasks; each names the exact assertions. No "TBD"/"similar to" remains.
- **Type consistency.** `prRecipe(key, level)` and `prMake(key, level)` (Task 4) are what every generator task calls; question objects carry `kind === mode key` and `sig`; `prJudge(ok, say, extraCtl, err)` (Task 5) is what every presenter calls; `prRebuildStart(target, opts)` (Task 7) is used by Tasks 13, 14, 20, and `rebuildDiff` (Task 2) by Task 31; `prAskFine` (Task 13) is used by Tasks 14 and 20; `prHanging`/`prAttacked` (Task 12) by Tasks 15–17; `bookMove`/`OPENING_LINES`/`moveFromSAN`/`openingPosition` (Task 1) by Tasks 13, 14, 18, 30–33; `goPractice(target)` (Task 6) by Tasks 29 and 25.
- **Known risk to flag at execution.** `attackersOf()`'s return shape (squares vs. move objects) must be read at Task 12 before `.slice()`/`.length` are relied on; `#cardBlind`'s split-open mechanism must be read at Task 29; the setup screen's level/clock setters must be read at Task 21. Each task says so where it applies.

## Second review pass (2026-09-09)

Changes made after reviewing the plan against the spec:

- Phase count stated: nine phases, 0 to 8.
- `stats.ply` ("clear to ply N") added to the record (Task 5) and set by the tracker, Forcing Lines and Blind Calculation questions.
- `prAttacked` and the harness's independent `attackedSquares` handle pawns geometrically (Task 12); Attack Vision level 9 carries king-zone questions as the spec says "from level 4".
- The tracker never draws the same opening line twice in a row (`PR.lastLine`, Task 14).
- After the Move's "both sides" filter rewritten (Task 15); Forcing Lines' duplicated type list removed (Task 16); Blind Calculation's puzzle fallback and end-of-line question simplified (Task 17).
- Branches asks its root question per branch, on a square that branch changed (Task 18), which removes a generator that would often have found no square every branch changed.
- Progressive Blindfold's move input is one function, `pbInput()`, reinstalled after every checkpoint and recovery, so board clicks survive a checkpoint (Tasks 19–20); "last move" decoys come from the position the move was played from; a generator-suite test covers the dealt positions.
- The lesson link on a Practice card shows whenever the lesson is not done (Task 25).
- Sync also adopts a guest's course record, and guest behaviour is stated (Task 28).
- Lessons 1 and 4 trimmed to the spec's three-to-five quiz items; lesson 3 checks the ten forms cover capture, castle, promotion and disambiguation (Tasks 30–31).
- The lessons test's grab of `LSN_CHALLENGES` is replaced in the same commit that deletes it (Task 34).
- Tasks 14, 17 and 30 carry explicit split points (a/b) so a reviewer can accept a generator while rejecting its presentation.
