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
node server/test_rematch_e2e.js          # two whole pages on real sockets — REQUIRES a running server
node server/test_ws_url.js               # unit tests for wsURLFrom(); no server needed
node server/test_rematch_flow.js         # the page's rematch and New Game wiring, against scripted replies
node server/test_review.js               # unit tests for the review's chess reasoning
node server/test_puzzle_flow.js          # plays a shipped puzzle against a stub DOM
node server/test_practice.js             # what the practice drills invent, re-checked
node server/test_practice_flow.js        # and running one, against a stub DOM + clock
python3 server/test_puzzle_rating.py     # the puzzle Elo handler; no server needed
node tools/test_generate_puzzles.js      # the generator's own decisions, no engine
python3 tools/check_supabase_puzzles.py  # RLS and column grants, against the real project

node tools/generate_puzzles.js --poolsOut /tmp/pools.json   # regenerate (slow: ~12 min)
node tools/generate_puzzles.js --poolsIn /tmp/pools.json    # re-cut the ladders only (instant)
node tools/verify_puzzles.js --track opening               # audit a shipped ladder (slow), touching nothing
node tools/verify_puzzles.js --track middlegame --write    # ...and repair it in place, follow-ups included
node tools/verify_puzzles.js --track endgame --followup 6 --write   # ...with a longer follow-up
node tools/verify_puzzles.js --track endgame --resort --write       # ...and re-rank the ladder with it

docker build -t nox-chess . && docker run --rm -p 8787:8787 nox-chess
```

The JS suites read the code under test out of `blind-chess.html` by name, so
renaming or reformatting what they extract breaks them on purpose.
`test_practice_flow.js` goes further and lifts the whole PRACTICE section out
between its banner comments, so it runs the screen's own code rather than a
copy — moving that banner moves the suite with it.
`test_rematch_e2e.js` is the exception and the reason the others can stay
narrow: it boots the *whole* page script twice under a dumb DOM shim, gives
each copy its own real WebSocket to the server, and presses the real buttons —
the only thing in the repo that can catch the page and the server disagreeing
about a message neither one of them is wrong about on its own.

`test_two_clients.py` has no test-case selection flag; it runs the whole
sequence (matchmaking, turn order, a full game, resign/draw, rooms, rematch)
and exits non-zero on failure. Point it at another host with
`WS_TEST_HOST=… PORT=…`, which `test_rematch_e2e.js` reads as well. Both leave
players parked in the lobby while they run, so each pairing asks for a clock
no other test asks for; reusing one is how a test ends up matched with the
wrong stranger.

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

**Three ways in, one Game.** Quick match, rooms and friend challenges all end
in `start_game_between()` and then the same relay — a challenge is not a second
multiplayer system. A challenge is addressed to an *account id*, not a socket,
which is what lets it reach every tab that account has open and what lets the
server refuse an answer from anyone else (`handle_challenge_accept`). It is
deliberately not a database row: it means nothing once either side disconnects,
so it lives in memory and dies with the session.

**A rematch is a fourth invitation, not a fourth way to start a game.** Rematch
used to walk away from the finished game and open the room list, which is not a
rematch at all — it never involved the same opponent. It is now a question put
to them: `{t:"rematch"}` from the page, `rematch-request` to the other side, and
`rematch-accept` / `rematch-decline` back. Accepting lands in
`start_game_between()` like everything else, so there is one Game and one relay,
with the colours swapped.

What makes a request answerable is the *finished* game it names. `Game` is let
go of by `finish_game()`, so each client keeps a `last_game` — the terms, the
seat it had, and who the opponent was — and only the last one. A request naming
anything else is stale by definition and refused. That single rule is what
handles the awkward cases: pressing twice sends one invitation, both pressing at
once is settled into one game by the server (the second press answers the first
request), sitting down at another board answers whatever was left in the air,
and a disconnection tells whichever end is still there. `REM` on the page is the
mirror of that, and one box in three states — asking, waiting, reporting —
opened *over* the end-of-game box so that neither player ever leaves the
post-game screen by answering.

**New Game leads back to where that kind of game is arranged.** A ranked game
goes to the ranked page with the settings it was played on already filled in and
the queue joined automatically (`rankResume`, consumed by `showScreen`); a
friendly or challenged one goes to the friendly match page, which is the room
list; an offline one to the setup form. The old Choose Opponent screen was
reachable from nothing but the online branch of that one button, so it is gone
and `picked.opponent` with it.

**Looking for an opponent is a state of the button that started it, on both
screens.** The setup form has always worked this way — `.start-btn.searching`
sweeps a band of light across Start Play with `@keyframes matchsweep` while the
room is on the list — and the ranked page now does the same rather than being
sent to the board behind a centred "Finding an Opponent" modal.

The two do **not** share a rule, and the reason is worth keeping. Start Play
says "working" by going dark with one band of light crossing it, which reads
correctly beside a board. The ranked Start Game is the only lit thing on an
otherwise black page, and a button that goes out reads as one that has stopped,
not one that is busy — so `#btnRankStart.searching` keeps its gold and moves the
gold instead (`@keyframes rankhunt`). Two things about how it is written are
load-bearing: the selector carries the **id**, because `button.primary` and
`.rank-start.dim` both paint this same element, and the background is set in
**longhands**, because the `background` shorthand resets `background-size` and
`background-position` to `auto` — one shorthand winning the cascade leaves the
gradient sitting perfectly still, which looks exactly like an animation that is
not running. `test_rematch_flow.js` reads the stylesheet and asserts both, since
every other check in the repo asks what the script does and none of them asks
what actually gets painted. `setSearching()` drives both; `drawRankPick()` owns what the
ranked button looks like and is told rather than reached into. Pressing the
button again calls the search off, escape does the same, and walking off the
ranked page cancels the queue — all of which the modal used to make impossible.
The modal is still there for *failures* (`waitingFailed`), because a refusal is
news rather than progress, and for challenges. One catch worth keeping in mind:
the server answers `find` with `{t:"waiting"}`, and that arm opens the modal
when nothing else has spoken — a sweeping button counts as having spoken, which
is why it checks `searching`.

The ranked half of New Game is the fiddly one, because it is the only New Game
that starts a search rather than showing a list, and it must not be mistaken for
Rematch. Three things keep it honest. The settings come from `rankedLast`,
written when the server's `start` arrives, not read off `G` when the button is
pressed — `G.mode` is live, the vision buttons beside the board write to it, and
a player poking at those on a finished board would otherwise re-queue for a game
they never played. `rankedAgain()` then drops everything that named the last
game — result, board, `NET.gameId`, `NET.opponent`, `NET.state` — keeping only
the socket, which the queue is about to want. And the ranked page is left up
long enough to be read (`RANK_AGAIN_PAUSE`) with a line saying what is about to
happen — the search then runs on that page, so there is nothing to see it
before, and the pause is only long enough for the restored settings to be up
when the button starts moving.

**The quick-match queue holds a list, so it can avoid handing you back the
player you just finished with.** `lobby[key]` was one waiting Client; it is a
list in arrival order now, and `handle_find()` prefers a waiting player who is
not `last_game["opponent"]`. They are the fallback rather than a refusal — on a
quiet server the alternative is two people staring at "finding an opponent" with
each other in front of them — but one stranger on the same time control is
enough to be preferred. `leave_lobby()` is the single way out of a queue, since a
list has more ways to strand an entry than one slot did, and a stale entry is
somebody the next arrival tries to start a game with.

**Ranked play answers to the same rule at both doors.** `may_play_ranked()` is
the rule — verified, or a server that cannot verify anyone — and both
`handle_find()` and the rematch handlers ask it. A rule enforced at one of two
ways in is not a rule.

**The rating only persists with `SUPABASE_SERVICE_KEY`.** The browser is not
allowed to write `puzzle_rating`, so the server is the only thing that can, and
it needs the service-role key to do it. Without one it still rates every
attempt — in memory, for the life of the process — and tells the client
`saved: false`. `supabase_db.set_puzzle_rating()` reads the row back rather
than trusting the status code, because PostgREST answers 204 to an UPDATE that
row-level security filtered to nothing, and a publishable key pasted into that
variable would otherwise report every rating as saved and store none.

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

**A shipped ladder is audited by a different tool than the one that grew it.**
`generate_puzzles.js` judges a position once, at `confirmDepth`, and splices its
own best defence in before judging the next one — so every ply of a solution
was chosen by a search that had only just arrived at it.
`tools/verify_puzzles.js` asks again from outside, both colours, and where it
disagrees the file is wrong: the player is being told to play a move the engine
does not play, and `puzzleStep()` will accept nothing else. One tool for all
three tracks — an opening, a middlegame and an endgame puzzle are the same
record and the same claim is being checked about each, so a second verifier per
track would only be a second place for the rules to drift.

Every search it makes empties the transposition table first: one engine
answering many unrelated questions answers them differently depending on the
order they arrive in, which is fine while *choosing* puzzles and useless while
*judging* them (`fresh` in `tools/sf.js` exists for this and nothing else, and
waits for `readyok` because `ucinewgame` is only honoured once the engine acts
on it). The searches that *build* rather than judge — the defence a rebuilt
line is extended with, and every follow-up move — ask for two lines and read
the ranking, because a single-line search prunes against the best move it
already has and can decline to mention a better one. Corrections reuse the
generator's `buildLine()`, `themesFor()`, `seedRating()` and `difficulty()`
rather than growing second versions, which is why those four are exported.

Three passes, and the order is the whole design. A cheap **sweep** ranks every
ply and only ever nominates; a **head-to-head** at the working depth plays both
moves and scores the positions they lead to, never reading the order of a
MultiPV list, whose top move is not always the move a MultiPV 1 search plays;
and the **verdict**, the same comparison deeper, is the only thing allowed to
call a move wrong. That split is not fussiness: a single pass at depth 22 called
six of the hundred opening puzzles wrong and depth 26 sided with the file on
five of them, so a sweep that decides is a sweep that rewrites good puzzles.

A disagreement is **repaired, not deleted** — the line is cut at the offending
ply, the engine's move goes in, and it is extended by the generator's own rule —
because a track is a hundred rungs and has to stay a hundred rungs. Repairing
changes the line, so the id (a hash of position and line) and the seed rating
are recomputed with it. A correct solution that is no longer *sharp* is
reported, not rewritten: sharpness is a generation criterion, not a claim the
file makes to the player, and rewriting it would only be undone by the next run
at the next depth. Nothing is written at all without `--write`.

Puzzle *ids* survive a correction, so nobody loses a solve. Rung numbers are
left alone too, unless `--resort` is asked for: that re-ranks the whole track by
the generator's own `difficulty()` and renumbers it, which is right after a pass
that shortened a lot of lines (the endgame one did) and wrong as a default,
because a file that comes back reordered hides what actually changed in a diff
of a hundred moved records.

**The follow-up is the payoff, and it is precomputed.** A solution is extended
only while there is still exactly one strong move to find, which stops it a
move or two before the rook actually falls off the board — so a player who has
just found the move is holding a position whose point has not happened yet. The
follow-up is best play from both sides from there, chosen by
`verify_puzzles.js`, and `pzShowFollowUp()` plays it out at the same cadence as
the forced replies. Every one of those plies is its own search of its own
position; a pv would be one search's intention, and cheaper, and would not be
true of the board it is shown on. It is precomputed on purpose: `pzExplain()`
asks no engine, and `test_puzzle_flow.js` asserts that the puzzle screen never
loads one.

**Two shapes of the same thing, because the three ladders were checked by
different runs.** The middlegame carries `follow` — the line, the score it
arrives at, the material it wins, and the score the puzzle *started* at — and
the opening and endgame carry `followUp`, the line on its own. `pzFollowOf()`
reads either, and is the only place in the page that knows there are two;
everything else asks it. `follow.startCp` is what lets the card tell a move that wins from
a move that is merely the best of a lost position — both are right answers, and
only one of them is "you come out a rook up" — so a line stored without a score
says what it won and stops there. Re-verifying a track with `--write` writes the
richer shape and drops the older one, which is why nothing may read `followUp`
directly. `pzFollowSay()` is what writes the card's sentence — `pvLine()` cannot,
because it speaks for whoever is to move at the head of a line and a follow-up
opens on the *opponent's* move, so its "you" would name the wrong player. It
counts the material from the *puzzle's* first position rather than from where
the solution stopped: the question is what the move the
player found was worth, and half of it is usually already won by the time the
solution runs out. A track from before any of this has neither field, and the
button is absent rather than present and dead.

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
the badge the rating has earned and sends `{t:"find", kind:"ranked"}`. Friendly
play still goes through the room list. The rating ladder is written out twice —
`TIERS` in the page picks the badge, and the generated `tier` column in
`supabase-setup.sql` names it in the database — so a threshold has to move in
both or they will disagree. Badge art is `assets/tier-<tier>.png`, one file per
rung, and only the one on screen is fetched.

Vision modes: `blind` (board, no pieces), `total` (pure notation, typed moves),
`fog`, `sighted`. Prefer the helpers — `BLINDISH()`, `CAN_PEEK()`, `LOCAL()`,
`ONLINE()`, `BOT()` — over comparing `G.mode`/`G.opponent` inline.

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
