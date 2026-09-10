# Study Board redesign — design

Date: 2026-09-10. Branch: agent-6.

## What changes

Study Board becomes a post-game analysis tool: the whole game is analysed
*before* the screen opens, every move is classified from the engine's numbers,
the board shades the move's two squares and draws arrows only for meaningful
threats, and the right-hand panel carries move / best / reasons / winning
chances / Explain. A study can be shared as a read-only link.

## What is reused

- The board, `render()`, `.sq.last` (from/to shading), `#arrows`, `#marks`.
- `SF` / `engineAsk()` — the one Stockfish worker; `readInfoLine`, `SF.cache`.
- `judgeMove()`, `winPct()`, `sacrificeSize()`, `see()`, `findMotifs()`,
  `pvLine()`, `describeBest()` — the review's pure chess reasoning.
- `eduAnalyse()` / `#conceptCard` — the Education System, now inside Explain.
- `REV` (states, moves, ply) and the names `enterReview`, `exitReview`,
  `reviewClose`, `reviewGoto`, `reviewBuild`, `reviewAnalyse`, `reviewRender`,
  which three test suites lift by name.
- The HISTORY layer's hash router for the share route.
- `localStorage` for the cache, keyed the way the puzzle cache is.

## 1. Analysis before entry (`THE STUDY` section)

`STUDY = { key, game, evals, recs, state, done, total, token, shared }`.

Pressing Study Board (`#endClose`) calls `studyStart()`:
1. `game = { uci, sans, white, black, mode, result, human }` read off `G`.
2. `key = studyKey(uci)` (a string hash of the move list).
3. Cache hit (`nox.study.<key>`) → decode, `state = 'ready'` at once.
4. Otherwise `state = 'analysing'`; positions 0..N are asked one at a time
   (`engineAsk(uci.slice(0,i), REVIEW_ASK)`, `REVIEW_ASK = {skill:20, multipv:2,
   objective:true}` at `SF_MOVETIME`; terminal positions are answered by the
   rules, since the engine is silent on them), `done/total` drives the button. A null answer (no
   WebAssembly, worker error) → `state = 'failed'`; the button offers Retry.
5. All answered → `studyBuild()` → cache → `state = 'ready'`, button reads
   START ANALYSIS. Nothing navigates by itself.
6. Pressing START ANALYSIS → `enterReview()`.

`newGame()` and leaving the game screen bump `STUDY.token`; a stale
completion is dropped.

The button: `.end-study[data-state=idle|analysing|ready|failed]`, a fill
element whose width is `--p` (transition .35s), title + sub-line.

## 2. Records — `studyBuild(game, evals)`

Pure. For ply i: `{ ply, side, san, uci, from, to, fenBefore, fenAfter,
before, after, best:{uci,san}, second:{uci,san,cp,mate}, pv:[san], replyPv,
winBefore, winAfter, delta, verdict, threats:[], vulns:[] }`.
`before = evals[i]`, `after = evals[i+1]` (both from the side to move in
their own position). Winning chances are from the mover's side:
`studyWinFor(res, flip)`; mate → 100/0, otherwise clamped to 1..99.
Reasons and the long explanation are written at render time from the record
plus the Education result, so both are always derived — nothing is stored
that a function of the record can give.

## 3. Classification — `judgeMove()` reworked, `VERDICT` = 7

`!!` brilliant, `!` great, `★` best, `👍` good, `?` inaccuracy, `✕` mistake,
`??` blunder. `excellent` is gone (merged into good).

- Mates as before (kept / slower / lost / walked into).
- `loss = winPct(cpBefore) − winPct(cpAfter)`, mover's side.
- best: engine's first choice, or `loss < 1` (the deeper after-search rates
  it at least as well).
- brilliant: best, and a sacrifice the engine confirms — `sacrificeDeficit`
  (the mover ≥ 200 down once the engine's reply is made and the recapture on
  that square settled), position not already crushing (`cpBefore < 700`),
  and clearly ahead after best defence (`cpAfter ≥ 50`).
- great: best, the runner-up drops ≥ 10 win%, the landing square is not
  hanging, and the move is not a capture SEE already justifies.
- good `< 5`, inaccuracy `< 10`, mistake `< 20`, blunder otherwise.

## 4. Threats and vulnerabilities — `studyThreats(st, m, after, replyRes)`

Threat (mover's piece → their piece): `see(after, sq, mover) > 0` and not
already winnable before the move; kept if it is worth ≥ 300 or the engine's
reply touches that square or the attacker. Mate-in-one threat (null move)
→ arrow from the mating piece to the king. Promotion threat → pawn to its
promotion square. Vulnerability (their piece → mover's piece): `see(after,
sq, them) > 0` and not before; kept if ≥ 300 or the engine's reply captures
it. Mate-in-one allowed → arrow to the mover's king. At most three arrows,
mates first, then by value. No arrow otherwise.

## 5. Panel (`#studyPanel`, replaces the side column while `.reviewing`)

Count line; verdict plate (symbol + SAN + name); MOVE / BEST cells joined by
an in-panel arrow; reasons (≤ 10 words each, `studyReasons()`, max 4);
Winning chances before → after with delta and a two-tone bar; EXPLAIN toggle
opening `studyExplain()` (idea, engine line, threats, opponent's reply, why
the alternative is weaker, concept card, lesson); ← → Share Done.

Hidden in `.reviewing`: `#gameChips`, `#gameSetup`, `#gamePlay`, both
`.board-bar`s, `#console`, the old `#reviewBar` (deleted) and `#coachCard`
(deleted). Wide: board | panel (existing grid). Narrow: stacked (existing
`max-width:900px` rule).

## 6. Share — `#study/<payload>`

`studyEncode(game, evals)` → `'z' + base64url(deflate-raw(JSON))`, or
`'j' + base64url(JSON)` where CompressionStream is missing. The JSON is
`{v:1,u:[uci],w,b,m,r,h,e:[[score,best,second,secondScore,pv]]}`; a score is
an integer cp or `'m±n'`. `studyDecode()` reverses it. The recipient's page
rebuilds every record from that with the same pure functions, so
classification, chances, reasons and explanations are identical, nothing is
stored on any server, no account is involved, and the page cannot change the
sender's analysis. `navParse('study/…')` → `{s:'game', v:'study', data}` →
`studyOpenShared()`: `G.opponent = 'study'` (BOT/LOCAL/ONLINE all false, like
`'puzzle'`), sighted, finished, then `enterReview()`. Share button: Web Share
when present, else clipboard → LINK COPIED for two seconds.

## 7. Tests

- `server/test_study.js` (node, no server): verdict bands and the sacrifice
  rule, win% from the mover's side incl. mates, threat/vulnerability arrows
  on set positions (fork, hanging piece, no-threat), every reason ≤ 10 words,
  encode/decode roundtrip, cache key stability.
- `server/test_study_education.js` and `server/test_puzzle_flow.js` keep
  passing (names kept; `#conceptCard` exactly once; `eduAnalyse` above the
  engine checks in `reviewRender`).
- Browser: headless Chrome over CDP, real games through `finish()`, the button
  filling, START ANALYSIS, navigation, arrows, share link opened in a fresh
  tab.
