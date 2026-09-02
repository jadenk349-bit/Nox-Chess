# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Nox Chess (directory name still "Blind Chess"): a blindfold-chess web game. The
entire client — styles, markup, chess rules, UI, bot, online client, review
screen, practice drills — is one file, `blind-chess.html` (~7.9k lines). The
Python server in `server/` is matchmaking and a move relay, nothing more. There is no build step
and no package manager on either side.

## Commands

```bash
python3 server/server.py [--port 8787]   # serves the page AND the game socket on one port
# then open http://localhost:8787/

python3 server/test_two_clients.py       # integration tests — REQUIRES a running server
node server/test_ws_url.js               # unit tests for wsURLFrom(); no server needed
node server/test_review.js               # unit tests for the review's chess reasoning
node server/test_puzzle_flow.js          # plays a shipped puzzle against a stub DOM
node server/test_practice.js             # what the practice drills invent, re-checked
node server/test_practice_flow.js        # and running one, against a stub DOM + clock
node server/test_ai_fallback.js          # what the ranked fallback bot decides
node server/test_ai_game.js              # and playing a whole game against it, stub DOM
python3 server/test_ai_match.py          # seating one: the queue, the race; no server needed
python3 server/test_puzzle_rating.py     # the puzzle Elo handler; no server needed
node tools/test_generate_puzzles.js      # the generator's own decisions, no engine
python3 tools/check_supabase_puzzles.py  # RLS and column grants, against the real project

node tools/generate_puzzles.js --poolsOut /tmp/pools.json   # regenerate (slow: ~12 min)
node tools/generate_puzzles.js --poolsIn /tmp/pools.json    # re-cut the ladders only (instant)
node tools/verify_puzzles.js --track endgame                # re-check one shipped ladder
node tools/verify_puzzles.js --track endgame --write        # …and save the corrections

docker build -t nox-chess . && docker run --rm -p 8787:8787 nox-chess
```

All eight JS suites read the code under test out of `blind-chess.html` by name,
so renaming or reformatting what they extract breaks them on purpose.
`test_practice_flow.js` goes further and lifts the whole PRACTICE section out
between its banner comments, so it runs the screen's own code rather than a
copy — moving that banner moves the suite with it.

`test_two_clients.py` has no test-case selection flag; it runs the whole
sequence (matchmaking, turn order, a full game, resign/draw, rooms, the ranked
fallback bot) and exits non-zero on failure. Point it at another host with
`WS_TEST_HOST=… PORT=…`. It really does sit out the fallback's five seconds,
several times over — `NOX_AI_WAIT`, set on the server *and* on the harness,
shortens a local run, and is not a knob anybody is meant to turn in production.

Environment: `PORT` (default 8787), `SUPABASE_URL` (enables token
verification), `SUPABASE_JWT_SECRET` (only for legacy HS256 projects; also what
`test_two_clients.py` uses to mint test tokens — without it the tests play as
guests), `SUPABASE_SERVICE_KEY` (lets the server persist `puzzle_rating`;
without it ratings live in memory for the life of the process). That last one
takes either a modern `sb_secret_…` key or a legacy `service_role` JWT —
`supabase_db.py` tells them apart by shape, because only the JWT may go in the
`Authorization` header, and it refuses a publishable/anon key by name. With neither Supabase variable set, accounts are simply off and
everything else still works.

## Architecture

**The rules live in the browser, on purpose.** Both online clients run the same
move generator in `blind-chess.html`. The server never validates chess: it
enforces only whose turn it is and that `ply` arrives in sequence, then relays.
A client rejects anything its own rules reject. Game end is *reported* by a
client (`{t:"result"}`) and the server records the first word on the matter.

**One port, two protocols.** `server/server.py` accepts a TCP connection and
looks at the `Upgrade` header: `websocket` → the game socket at `/ws`,
otherwise plain HTTP. The client derives the socket URL from `location` alone
(`wsURLFrom`), so nothing is hard-coded — `test_ws_url.js` enforces that by
extracting the function out of the HTML with a regex. Renaming or reformatting
`wsURLFrom` breaks that test.

**`server/wsproto.py`** is a hand-rolled RFC 6455 handshake + framer shared by
the server and the test harness, because the stdlib has no WebSocket support.

**Static files are an explicit allowlist** (`STATIC_FILES` in `server.py`) —
there is no directory serving and no path to traverse. Adding an asset means
adding an entry there with its MIME type (`application/wasm` is required for
the engine, not optional). Allowlisted assets are cached for a week, so every
reference in the page carries `?v=N`; bump it when a file changes.

**Server state** is module-level dicts guarded by one `RLock`: `lobby` (quick
match, keyed by `(mode, minutes, inc, kind)` — ranked and friendly are separate
queues, and 3+2 is a different game from a flat 3 minutes), `rooms` (hosted
games anyone may join), `lobby_subs` (clients watching the room list), `games`,
`by_user` (signed-in account id → its open connections) and `challenges`.
Payloads are built under the lock and sent outside it. One thread per
connection.

**Four ways in, one Game.** Quick match, rooms, friend challenges and the
ranked fallback bot all end in `start_game_between()` and then the same relay —
a challenge is not a second multiplayer system, and neither is the bot. A challenge is addressed to an *account id*, not a socket,
which is what lets it reach every tab that account has open and what lets the
server refuse an answer from anyone else (`handle_challenge_accept`). It is
deliberately not a database row: it means nothing once either side disconnects,
so it lives in memory and dies with the session.

**A ranked queue with nobody in it seats a bot, after five seconds and not
before.** `handle_find` arms `arm_ai_fallback()` when a *ranked* search finds
nobody; `ai_fallback()` fires on a timer thread, takes the same lock the pairing
takes, looks at `lobby` again, and only builds a `BotClient` if this player is
still the one waiting there. That re-check is the whole of the race protection
and it is exact rather than hopeful: `lobby` holds one waiter per key, so still
being that waiter *is* the proof that no compatible opponent exists. A real
player therefore wins every photo finish, and two people who could have met can
never each be handed a bot instead.

A `BotClient` is a Client whose `send()` does nothing. It exists so that
everything downstream of pairing — `Game`, `opponent_of`, `finish_game`,
`drop_client` — works unchanged, and it is never registered under an account,
never put in `lobby` or `rooms`, and never challenged, which is what stops two
of them meeting or a real player reaching one by any route but the timeout. The
name comes from `AI_NAMES`, avoiding whatever that player's last few opponents
were called; the rating is `ai_elo_for()` — the player's own Elo plus a
hundredth of it plus nine — worked out per game, because these names are not
accounts and store nothing. Ranked play does not write `profiles.rating` for
anybody yet, real opponent or bot, so there is no double-counting to avoid and
no rating a bot game could inflate.

The bot plays in the *browser*, because that is where the chess is: there is no
move generator in the server and never has been. `start` carries an `ai` block,
the page's `AI_MATCH()` reads it and nothing else may set it, and `aiPick()`
chooses the move. What it steers by is not a rung off `LEVELS` but the position:
several candidates a ply, each score turned into a win chance, and the one
nearest the phase's band (`AI_BAND`) played — near-even early, easing later —
subject to `AI_SLACK`, which is what stops a target from ever being bought with
a piece. Behind the band it simply plays its best move, because steering *down*
onto a target is throwing the game. Moves are not relayed (`handle_move` drops
them for an AI game and the page does not send them), a draw offered to it is
accepted by the server through the ordinary `over` message, and resignation,
checkmate, the clock and disconnection all run through the paths they already
ran through.

**The rating only persists with `SUPABASE_SERVICE_KEY`.** The browser is not
allowed to write `puzzle_rating`, so the server is the only thing that can, and
it needs the service-role key to do it. Without one it still rates every
attempt — in memory, for the life of the process — and tells the client
`saved: false`. `supabase_db.set_puzzle_rating()` reads the row back rather
than trusting the status code, because PostgREST answers 204 to an UPDATE that
row-level security filtered to nothing, and a publishable key pasted into that
variable would otherwise report every rating as saved and store none.

**A shipped ladder can be re-checked, and it is not the generator that does
it.** `tools/verify_puzzles.js` asks every ply of every solution again, deeper
than generation did and — crucially — with the transposition table emptied
first: one engine answering many unrelated questions answers them differently
depending on the order they arrive in, which is fine while *choosing* puzzles
and useless while *judging* them (`fresh` in `tools/sf.js` exists for this and
nothing else). Corrections reuse the generator's `buildLine()`, `themesFor()`,
`seedRating()` and `difficulty()` rather than growing second versions, which is
why those four are exported. Puzzle *ids* survive a correction so nobody loses
a solve; rung numbers do not, exactly as after a regeneration. The same pass
writes `followUp` — see below.

**The follow-up is engine-verified, not a principal variation.** A solution
ends where the finding ends, which leaves the player a rook up and no idea what
for, so each puzzle carries a few more plies behind the Show Follow Up button.
Every one of those plies is its own search of its own position; a pv would be
one search's intention, and cheaper, and would not be true of the board it is
shown on. The page (`pzFollowUp`, `pzFollowLine`) only replays them, and reads
the outcome from the solver's side — `pvLine()` cannot be used directly there
because a follow-up opens on the *opponent's* move and its "you" would name the
wrong player.

**Two kinds of puzzle state, owned by two different parties.** Which puzzles a
player has finished is personal state, so the browser writes
`public.puzzle_progress` itself under RLS and `localStorage` is only a cache —
rows are keyed by puzzle *id*, not by rung, so regenerating the ladders costs a
player their place in the numbering and not their progress. What their solving
is *worth* is `profiles.puzzle_rating`, which the browser may read and never
write, exactly as `rating` and `tier` already work; `server/supabase_db.py`
writes it with the service key, and without one the server keeps ratings in
memory. Guests get neither and keep both locally. Run
`supabase-migrate-puzzles.sql` once, by hand, like `supabase-setup.sql`.

**Practice is not a second puzzle ladder.** Puzzles ask what the best move is,
with the board in front of you the whole time. Practice (`PR`,
`screen-practice`, reached from LESSON → Practice) asks whether the board is
there at all: name a square, colour it, see where a knight reaches, follow a
piece through moves you never see, answer for a position with the men hidden.
Six drills and a Mini Blindfold Challenge, each with three settings that change
the exercise rather than a label on it. There is deliberately **no Elo**: what a
player's visualisation is worth is a level they climb (Beginner → Visualizer →
Tracker → Blindfold Ready → Advanced), earned by sessions finished, by accuracy
and by how many different drills have been tried — so nobody climbs it by
grinding one. Ranked and puzzle ratings are untouched by all of it.

Nothing in it reimplements a rule. Positions come out of `prPosition()` and are
thrown back unless the rules accept them — two kings, not touching, no pawn on a
promotion rank, neither side already in check, no castling rights nobody earned.
Movement answers are `legalMoves()`. Tracking walks and blindfold sequences are
*played*, with `makeMove()`, and named with `toSAN()` — never assembled out of
notation strings. The mini challenge reads what the player typed with
`parseMoveIn()` and answers with the small JS search already in this file.
`parseMove()` is now a one-line wrapper over `parseMoveIn(G.st, …)`: one
notation reader, two pages. A generator that cannot produce a valid exercise
retries, then asks again at the easiest setting, and only then gives up — it
never puts a broken one on screen.

The practice board is the game's board markup built a second time (`#prBoard`,
`prSqEls`, `prPaint`) — same `.sq`, same `.piece`, same `.blind` that hides the
men. The CSS is shared; only the element is not, because handing one board back
and forth between two screens is how the two would come to disagree about what
is on it. Progress is `localStorage` only
(`nox.practice.<account id | guest>`), stamped with whose it is the way the
puzzle cache is, and shaped so a `practice_progress` table could take it later
without changing what the page writes. Every answer is written as it happens, so
a refresh keeps what was answered; only the session count waits for the session
to end. `showScreen()` calls `prLeave()` on the way out, which is what stops a
study countdown running over another page. `goPractice()` is the only way in, on
purpose: the How to Play page, when there is one, should finish by calling it
rather than growing a second entrance.

**Study Board and Puzzles are separate features that share one library.**
Study Board (`REV`, the review screen) explains *the game the player just
finished*: it is reached only from the end-of-game overlay, replays `G.uci`,
and never reads a puzzle file. Puzzles (`PZ`) are three ladders of a hundred
positions in `puzzles/*.json`, walked in order, one unlocked by the last. What
they share is the explaining — `findMotifs()`, `see()`, `describeBest()` — which
is why a puzzle tagged `fork` is explained with the word fork. Keep the
dependency one-way: `PZ` may call the review's pure helpers, the review must
never learn what a puzzle is.

**Puzzle Rush borrows the game's clock.** `tickClock()` and `renderClocks()`
each grow one branch for `RUSH.on`; there is no second timer. A run never
records ladder progress and never moves the rating — it reads the rating to
choose where to start and nothing else.

**`tools/` is offline, and reads the page rather than copying it.**
`tools/page_chess.js` cuts the named declarations out of `blind-chess.html` and
evaluates them in Node, so the puzzle generator tags positions with the same
code the browser explains them with. `tools/sf.js` drives the vendored engine
in a forked process (Node needs `delete global.fetch` and a cwd of `engine/`,
both explained there). Renaming anything in that file's DECLS/FNS lists breaks
the tools loudly, which is the trade for having one implementation.

**Two engines.** `blind-chess.html` contains a small negamax/alpha-beta search
(`bestMove`) *and* drives the vendored Stockfish WASM worker over UCI (`SF`,
`engineAsk`). The bot ladder (`LEVELS`) is Stockfish plus deliberate
degradation — `pool`/`slop`/`wild` make weak rungs, since this build has Skill
Level but no `UCI_Elo`. The JS search is the fallback when WebAssembly is
unavailable (each rung's `js:` field is its depth). The review screen uses
Stockfish only, and loads it lazily.

**`engine/` is vendored GPL-3.0 Stockfish** — not our code. Read
`engine/README.md` before touching it; it explains why the single-threaded
build was chosen and flags an unresolved licensing question about paid
features.

**Accounts are optional everywhere.** The browser signs in with Google through
Supabase (`@supabase/supabase-js` imported from esm.sh at runtime; keys are
inlined near the top of the script and are safe to publish). It hands the
access token to the server on `{t:"hello"}`; `server/supabase_auth.py` verifies
ES256 against the project's JWKS. A failed or absent token means guest, not
rejection — guests play friendly games. Ranked play requires a verified account
*only when* the server is actually able to verify anyone.

**A verified player's name comes from the token, never from the message** —
otherwise signing in would be a way to wear someone else's name. `clean_name()`
(3–25 chars, `[A-Za-z0-9 _-]`, at least one letter) is applied server-side even
to token metadata, because that metadata is writable through Supabase's own
API. Guest names go through the same rule.

**`supabase-social.sql`** is the second hand-run file, after
`supabase-setup.sql`. Friendships are **one row per pair**, stored sorted
(`user_low < user_high`, enforced by a check constraint): the primary key is
then also the "already friends" guard, reading it from either side is the same
query, and removing it is one delete both players see. There is no insert
policy on `friendships` at all — `accept_friend_request()` is a security-definer
function and the only door in, because accepting is two writes and the browser
must not be trusted to do only the first. Requests are deleted when answered;
there is no status column. Both tables need `replica identity full` or realtime
DELETEs never reach anybody — that is most of the feature, since accepting,
declining and unfriending are all deletes.

**`supabase-setup.sql`** is run once by hand in the Supabase SQL editor. The
load-bearing part is at the bottom: RLS alone would let a signed-in user set
their own `rating`, so column-level grants restrict the browser to writing
`display_name` and `avatar_url`. `tier` is a generated column, and
`subscription` is server-owned. Keep any new server-owned column outside those
grants.

## Working in blind-chess.html

Navigate by the `/* ==== TITLE ==== */` banners in the script — THE SKY,
CONSTANTS & HELPERS, MOVE GENERATION, ENGINE, GAME / UI STATE, CLOCK, SOUND,
COMPLETE BLINDFOLD, PLAYING MOVES, ONLINE PLAY, RESIGNING…, THE ENGINE, THE
REVIEW, THE PUZZLES, PRACTICE, CONTROLS, SCREENS, ACCOUNTS, SOCIAL.

Screens are `<section class="screen" id="screen-NAME">` toggled by
`showScreen(name)`; `screenName` is the current one and several handlers branch
on it. There is only one account cluster (`#headRight`), and `showScreen()`
moves it into whichever screen's header offers a `.head-mount` — home and
social both do, so it sits in the same place on each. Don't duplicate it.

Global game state is `G` (mode, opponent, colours, clocks, `G.uci` — the move
list the review and the bot replay from). `G.token` is incremented on every new
game; async engine callbacks capture it and bail if it changed, which is what
stops a reply from an abandoned game landing in the next one.

Ranked play is a queue, not a room: the ranked screen (`screen-ranked`) shows
the badge the rating has earned and sends `{t:"find", kind:"ranked"}`. Five
seconds of that finding nobody and the server seats a bot instead — same
`start`, same sweep on the Start Game plate, same transition into the game, with
an `ai` block naming it and nothing on the board bar to say it is one. Nothing
about the search UI changes, and nothing on this side decides that it happened. Friendly
play still goes through the room list. The rating ladder is written out twice —
`TIERS` in the page picks the badge, and the generated `tier` column in
`supabase-setup.sql` names it in the database — so a threshold has to move in
both or they will disagree. Badge art is `assets/tier-<tier>.png`, one file per
rung, and only the one on screen is fetched.

Vision modes: `blind` (board, no pieces), `total` (pure notation, typed moves),
`fog`, `sighted`. Prefer the helpers — `BLINDISH()`, `CAN_PEEK()`, `LOCAL()`,
`ONLINE()`, `BOT()`, `AI_MATCH()` — over comparing `G.mode`/`G.opponent`
inline. `AI_MATCH()` is an ONLINE() game with a bot on the far side: it is not
`BOT()`, which is the Play Bot ladder and a different screen entirely.

**The social page** (`screen-social`, the SOCIAL section of the script) is two
things that only meet on screen: friends and friend requests are Supabase rows
the browser reads and writes directly, kept fresh by a realtime subscription
with a slow poll behind it as a fallback; challenges are messages on the game
socket. The challenge *form* is the Play Bot page — the same `#gameSetup`
panel beside the same board, with `CHALLENGING()` hiding the bot ladder,
renaming Start Play to Challenge, and `NET.opponent` naming the friend on the
strip above the board. `CHAL` holds the invitation in flight from either end.

There is deliberately no undo, no take-back, and no move history during play.
Don't reintroduce them.

## Code style

Comments in this codebase explain *why*, often at length, and several encode
decisions that are easy to undo by accident (the guest-name rule, the
`?v=` cache-busting, `finish_game()` clearing `client.game`, `maybeSingle` over
`single`). Match that register rather than trimming to terse one-liners, and
when you change one of those decisions, update the comment that argues for it.
