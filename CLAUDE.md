# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Nox Chess (directory name still "Blind Chess"): a blindfold-chess web game. The
entire client — styles, markup, chess rules, UI, bot, online client, review
screen, practice drills, the lesson course — is one file, `blind-chess.html`. The
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
node server/test_challenge_flow.js       # a friend challenge with two seats set differently — the page's half, no server
SUPABASE_JWT_SECRET=x PORT=8797 node server/test_challenge_e2e.js   # ...and two whole pages on real sockets — REQUIRES a server started with the same secret
node server/test_review.js               # unit tests for the review's chess reasoning
node server/test_study_education.js      # Study Board's concept card, and how it fails
node server/test_puzzle_flow.js          # plays a shipped puzzle against a stub DOM
node server/test_practice.js             # what the practice drills invent, re-checked
node server/test_practice_flow.js        # and running one, against a stub DOM + clock
node server/test_lessons.js              # walks the whole ten-lesson course (~3 min)
node server/test_leaderboard.js          # the home page's four ladders, against a scripted account client
node server/test_drag.js                 # dragging a man to a square, on the three visions that draw a board
node server/test_ai_fallback.js          # what the ranked fallback bot decides
node server/test_ai_game.js              # and playing a whole game against it, stub DOM
python3 server/test_ai_match.py          # seating one: the queue, the race; no server needed
python3 server/test_house_rooms.py       # the friendly page's seven standing rooms; no server needed
python3 server/test_names.py             # one name per player, guests included; no server needed
python3 server/test_system_profiles.py   # the 21 leaderboard profiles: refused everywhere; no server needed
python3 server/test_puzzle_rating.py     # the puzzle Elo handler; no server needed
python3 server/test_image_files.py       # every allowlisted file is COPYed into the image; no server needed
python3 server/test_visions.py           # the three vision ratings: what the migration seeds, what the server writes; no server needed
node tools/test_generate_puzzles.js      # the generator's own decisions, no engine
node tools/test_new_rules.js             # the payoff and education rules the corpus was re-cut by
node tools/test_practice_scheduling.js   # what a board Practice has to clear to ship
node tools/test_verify_resume.js         # the verifier picking up a run where it stopped
python3 tools/check_supabase_puzzles.py  # RLS and column grants, against the real project
python3 tools/check_supabase_visions.py  # the four ladders and their grants, against the real project
python3 tools/check_supabase_practice.py # RLS and grants on practice_progress, against the real project
python3 server/test_league.py           # the AI league: pairing, ratings, endings, restart, boot; no server, stub engine
python3 server/test_league_boot.py      # the production startup path: runs server/server.py itself, needs a Stockfish
node server/test_live_games.js            # the home page's live cards — what each vision may show
node server/test_spectate_flow.js         # a card to the full-screen spectator page and back, scripted socket
NOX_LEAGUE_FAST=1 python3 server/server.py    # ...and, against that server (real accounts, results in memory):
python3 server/test_league_socket.py      # real games, real engine, over the socket — REQUIRES that server

node education/tools/build_bundle.js            # rebuild the corpus the browser reads
node education/tools/build_bundle.js --check    # ...and fail if it is stale
python3 education/tools/run_tests.py            # the knowledge base's own suite (~974)

node tools/generate_puzzles.js --games 1600 --poolsOut /tmp/pools.json   # mine (slow: ~75 min)
node tools/generate_puzzles.js --poolsIn /tmp/pools.json    # re-cut the ladders only (instant)
node tools/generate_puzzles.js --only endgame --games 3000 --gameLength 200   # hunt one scarce track
node tools/verify_puzzles.js --track opening               # audit a shipped ladder (slow), touching nothing
node tools/verify_puzzles.js --track middlegame --write    # ...and repair, drop, explain and extend it in place
node tools/verify_puzzles.js --track endgame --followup 6 --write   # ...with a longer follow-up
node tools/verify_puzzles.js --track endgame --resort --write       # ...and re-rank the ladder with it
node tools/merge_pools.js                # one pool out of two mining runs, deduped on the fen
node tools/generate_practices.js --kind opening     # mine the board Practices (slow)
node tools/diagnose_practices.js                    # ...and count every stage that refused one

docker build -t nox-chess . && docker run --rm -p 8787:8787 nox-chess
```

The JS suites read the code under test out of `blind-chess.html` by name, so
renaming or reformatting what they extract breaks them on purpose.
`test_practice.js` names what it lifts in `DECLS` and `FNS`, so every level
ladder, generator and store function it checks has to keep the name it has.
`test_practice_flow.js` goes further and lifts the whole PRACTICE section out
between its banner comments — everything from `PRACTICE — the drills behind
LESSON → Practice` down to the `SCREENS` banner, Progressive Blindfold
included — so it runs the screen's own code rather than a copy. Moving either
banner moves the suite with it, and a new top-level name in Practice has to be
inside that block to be reachable at all.
`test_lessons.js` boots the whole page too, and drives the course the way a
player does — presses the buttons, clicks the squares, types into the console.
It answers every task by brute force rather than by being told the answer (a
step's own `truth` is never read; see the lessons below), so a lesson step that
cannot be finished fails there; and it asks the page's own move generator
whether every fixed position in the course is legal. It takes a little under
three minutes because the lessons play their sequences at reading speed and it
waits for them, which is the point.
`test_rematch_e2e.js` is the exception and the reason the others can stay
narrow: it boots the *whole* page script twice under a dumb DOM shim, gives
each copy its own real WebSocket to the server, and presses the real buttons —
the only thing in the repo that can catch the page and the server disagreeing
about a message neither one of them is wrong about on its own.
The shim and the page boot live in `server/page_harness.js`, which
`test_challenge_e2e.js` shares: it runs the same two-page arrangement for a
friend challenge, which needs a signed-in account on both ends, so it mints
HS256 tokens with the harness's `mintToken()` from `SUPABASE_JWT_SECRET` —
the same secret `test_two_clients.py` uses — and skips, saying so, without
one. Locally that means starting a server with any `SUPABASE_JWT_SECRET` at
all (no `SUPABASE_URL` needed): accounts switch on, HS256 tokens verify, and
the challenge sections of both suites run instead of being skipped.

`test_two_clients.py` has no test-case selection flag; it runs the whole
sequence (matchmaking, turn order, a full game, resign/draw, rooms, rematch,
the ranked fallback bot) and exits non-zero on failure. Point it at another
host with `WS_TEST_HOST=… PORT=…`, which `test_rematch_e2e.js` reads as well.
Both leave players parked in the lobby while they run, so each pairing asks for
a clock no other test asks for; reusing one is how a test ends up matched with
the wrong stranger — and, on a ranked clock, how a test ends up matched with a
bot. It really does sit out the fallback's five seconds, several times over —
`NOX_AI_WAIT`, set on the server *and* on the harness, shortens a local run,
and is not a knob anybody is meant to turn in production.

Environment: `PORT` (default 8787), `SUPABASE_URL` (enables token
verification), `SUPABASE_JWT_SECRET` (only for legacy HS256 projects; also what
`test_two_clients.py` uses to mint test tokens — without it the tests play as
guests), `SUPABASE_SERVICE_KEY` (lets the server persist `puzzle_rating`, settle a rated
game through `record_rated_game()` and read a
player's `display_name` off their profile row; without it ratings live in
memory for the life of the process and names come from the token). That last one
takes either a modern `sb_secret_…` key or a legacy `service_role` JWT —
`supabase_db.py` tells them apart by shape, because only the JWT may go in the
`Authorization` header, and it refuses a publishable/anon key by name. With neither Supabase variable set, accounts are simply off and
everything else still works. The AI league adds `NOX_LEAGUE`
(`on`/`off`/`memory`), `NOX_STOCKFISH`, `NOX_LEAGUE_GAMES_PER_MODE`,
`NOX_LEAGUE_ENGINES`, `NOX_LEAGUE_FIXTURE` and `NOX_LEAGUE_FAST`, all optional — see "The AI
league" below.

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
reference in the page carries `?v=N`; bump it when a file changes. Four of the
entries are the Education System — see below — and they are the only part of
`education/` that is served or copied into the image.

An allowlist has one failure mode with no error anywhere in it: an entry whose
file the **Dockerfile never copies**. That is not a build error (the Dockerfile
does not know what the server serves), not a server error (`serve_static_file`
answers a clean 404 on `OSError`), and not a page error either — it is a feature
quietly reporting itself as missing, in its own words, to whoever opens it. Both
board Practices shipped that way and said "Not installed yet" for a whole deploy
while working perfectly from a checkout, because `practices/` had no `COPY`.
`server/test_image_files.py` is the guard: it reads `STATIC_FILES` and the
Dockerfile's `COPY` lines and fails when they disagree. Add an entry to the
allowlist, add the file to the image.

**Server state** is module-level dicts guarded by one `RLock`: `lobby` (quick
match, keyed by `(mode, minutes, inc, kind)` — ranked and friendly are separate
queues, and 3+2 is a different game from a flat 3 minutes), `rooms` (hosted
games anyone may join), `lobby_subs` (clients watching the room list), `games`,
`by_user` (signed-in account id → its open connections) and `challenges`.
Payloads are built under the lock and sent outside it. One thread per
connection.

**Five ways in, one Game.** Quick match, rooms, friend challenges, a rematch of
a game that has just ended and the ranked fallback bot all end in
`start_game_between()` and then the same relay — a challenge is not a second
multiplayer system, and neither is a rematch, and neither is the bot. A
challenge is addressed to an *account id*, not a socket, which is what lets it
reach every tab that account has open and what lets the server refuse an answer
from anyone else (`handle_challenge_accept`). It is
deliberately not a database row: it means nothing once either side disconnects,
so it lives in memory and dies with the session.

**A friend challenge deals each seat its own vision and its own clock, and
the terms belong to the player, not to the colour.** The challenge form —
the Play Bot panel aimed at a friend — asks the Vision and Time questions
twice while `CHALLENGING()`: `syncOptions()` puts `.split` on `#secVision`
and `#secTime`, which is what shows the friend's column (`.who-col.friend`,
buttons carrying `data-opp-mode` / `data-opp-time`) beside the challenger's
own, the one every other game has always had. The challenger's picks go to
`G.mode`/`G.minutes` as for any game; the friend's go to `CHAL.mode` /
`CHAL.minutes` (`pickFriendMode()`, `pickFriendTime()`) and never to `G`,
because the preview board is the challenger's own and is drawn through their
vision. Both halves have to be answered before Challenge lights
(`optionsAnswered()`, `unanswered()`).

On the wire there is one vocabulary and every payload is written from its
*reader's* chair, exactly as `color` already was: `mode` and `minutes` are
what you play, `opponentMode` and `opponentMinutes` what the far side does.
The page sends `challenge` that way; the server (`clean_mode()`,
`clean_minutes()`, `seat_terms()`) turns it round for the friend's
`challenged` box, and `start_game_between()` writes each `start` the same
way, so `G.mode = msg.mode` on every page is that player's own seat whichever
colour it was given — the vision needs nothing else, since `render()` has
always drawn from `G.mode`. The far side's pair lands in `G.theirMode` /
`G.theirMinutes`, which are only ever *said* (the setup chip, a line in the
log, the boxes) and seed the other clock: `startingClocks()` is the one
place the two starting times are keyed by seat, gated on `ONLINE() &&
G.started` so the preview board and every game that is not a challenge seed
one number as before, and `resetChoices()` clears both so a finished
challenge's far side cannot leak into the next board. A `challenge` naming
only `mode`/`minutes`, or naming terms the server does not recognise, deals
the challenger's own to both seats — the one shared game every challenge
used to be — and quick match, rooms, the fallback bot and the league are
untouched: they hand `start_game_between()` no `guest_terms` and get both
seats alike. `Game.terms` is the per-colour record; `game.mode`/`minutes`
stay the headline pair the lobby key and the log lines read. `finish_game()`
writes each player's *own* terms into `last_game` and the other's beside them
as `opponentTerms`, so a rematch keeps each with its player while the
colours swap (`Rematch.guest_terms`, and the bot branch passes them too). No
database or Supabase change is involved: a challenge was never a row and
still is not. `test_challenge_flow.js`, the challenge section of
`test_two_clients.py` and `test_challenge_e2e.js` cover the four
combinations, the swap, the rematch and the fallbacks.

**A rematch is another invitation, not another kind of game.** Rematch
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

The two do not share a *rule* — `.start-btn.searching` is written against a
class this button does not carry — but they now deliberately share the *effect*:
a dark plate with the palette's gold running across it. An earlier version kept
the ranked plate gold and moved gold bands over it, reasoning that the one lit
thing on a black page must not go out. In the browser that reads as nothing at
all: gold light on a gold ground has no contrast to carry the movement, so a
button mid-search looked like the same gold button sitting still and the state
the whole design rests on was invisible. The dark ground is what makes the light
legible. The one difference from Start Play is that the band **repeats** rather
than crossing once — a single band leaves the plate flat dark for the back half
of every cycle, which beside a board is fine and here is the stopped-button
worry all over again, so two bands are kept in flight and one is always
crossing. Two things about how it is written are load-bearing: the selector
carries the **id**, because `button.primary` and `.rank-start.dim` both paint
this same element, and the background is set in **longhands**, because the
`background` shorthand resets `background-size` and `background-position` to
`auto` — one shorthand winning the cascade leaves the gradient sitting perfectly
still, which looks exactly like an animation that is not running. `.rank-start`
itself names **no** `transition`, for the same reason Start Play's rule does not:
both plates ease on the base `button` list, and an override there that left
`transform` and `filter` out made this one button snap on hover and press where
every other button on the site eases. `test_rematch_flow.js` reads the stylesheet and asserts both, since
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

**A ranked queue with nobody in it seats a bot, after five seconds and not
before.** `handle_find` arms `arm_ai_fallback()` when a *ranked* search finds
nobody; `ai_fallback()` fires on a timer thread, takes the same lock the pairing
takes, looks at `lobby` again, and only builds a `BotClient` if this player is
still standing in that queue with nobody live beside them. That re-check is the
whole of the race protection and it is exact rather than hopeful: `lobby[key]`
is every player waiting on these terms, so being alone in it *is* the proof
that no compatible opponent exists. (It is asked of a list rather than of a
single waiter because the queue holds one — see the quick-match queue above —
and `handle_find` pairs an arrival with whoever is already there, so a second
live waiter is a moment rather than a state.) A real player therefore wins
every photo finish, and two people who could have met can never each be handed
a bot instead.

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
no rating a bot game could inflate. The one thing that may move any of the four
rating columns is `record_rated_game()` — see the four ladders below — and the
AI league is the one caller.

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

**A rematch of a bot game is granted rather than put.** The two features meet in
`handle_rematch()`, and a question addressed to a `BotClient` is a box that
would sit unanswered until it lapsed at `REMATCH_TTL` — there is nobody there
to press Accept. So an opponent with `is_ai` set skips the invitation entirely:
the same name at the same rating, the same terms, colours swapped, straight
into `start_game_between()` like every other way into a Game. The rating is the
one that game was played at rather than a fresh `player_rating_of()`, because
it is the same opponent again and because that call may go to the network,
which nothing holding the lock may do.

**The friendly page always has seven rooms on it, and the house hosts them.**
A room used to exist only while a person sat in it, so on a small server the
list was "Nobody is hosting yet" for almost everybody. `HOUSE_ROOMS` in
`server.py` is seven rooms the house keeps open at all times — two Complete
Blindfold, two See the Board (`blind`), two Fog of War and one Sighted — each
hosted by a `BotClient` under a name that reads like anybody's, at a fixed
rating, on its own clock. They are the ranked fallback wearing a room instead
of a queue, and deliberately nothing more: `seed_house_rooms()` puts a
`Room` whose host is a bot into `rooms` at startup, `handle_join()` seats the
joiner through `start_game_between()` with the same `ai` block the fallback's
`start` carries, and the page plays the bot's moves exactly as it does for
the fallback — `AI_MATCH()` is true of both, and `G.matchKind` is what tells
them apart where the page says anything about it. A joined room is re-seated
under the same lock that emptied it (`house_room()`: a fresh `BotClient`, the
same name and rating, the colour drawn again), so the list is seven long at
every instant and never drains; `room_list()` puts the seven first in slot
order, then everybody else's rooms, so the list does not reshuffle when
somebody sits down. A rematch of one is granted on the spot by the branch
`handle_rematch()` already had for the fallback, a draw offered to one is
accepted through `ai_accept_draw()`, and a move sent to the server for one is
dropped as it always was. None of it touches ranked play: a house bot is never
in `lobby`, `handle_find()` never sees one, `may_play_ranked()` is not asked,
and no rating is written for anybody.

The card does not know. Every room on the list — the house's and a person's —
is sent as `{id, mode, minutes, inc, color, name, rating}` and drawn by
`renderRooms()` as a vision, a name, a rating, a clock line and a Join Room
button; `handle_host()` reads a person's rating with `player_rating_of()`
before it takes the lock, so their card looks exactly like the house's.
Nothing on the wire or on the page says which rooms are the house's, on
purpose, and the brief's rule that nothing beside a name may hint at who is
behind it is enforced by `test_two_clients.py` and the driver checks rather
than by a flag the page could read. Two things the page does differently
from a ranked fallback game, both because the card presented this host as
anybody: the "Nobody was queueing, so … a Nox bot … took the board" line is
written only for a ranked game, and the chat panel stays up. The names are
held in `names` for the life of the process so no guest can wear one, and
`test_system_profiles.py` checks they share nothing with `AI_NAMES` or the
system profiles. `test_house_rooms.py` walks the rest without a server, and
the "Hosted rooms" section of `test_two_clients.py` tells the house's rooms
apart from its own by name — the list itself will not say.

**The twenty-one system profiles are accounts with no seat, and the fallback
bot is a seat with no account.** `supabase-system-profiles.sql` — the fourth
hand-run file, after setup and social — puts Arvenko, LeoFromPrague and
nineteen others into `profiles` at fixed ratings, flagged `is_bot`. They are
rows and nothing more: the leaderboard, the Social search and a friend request
all find them through the same table and the same queries as anybody, and the
page does not select the flag, let alone special-case it — a list that knew
about them would be a list that could lie about the order. They are *not* the
ranked fallback: `AI_NAMES` are names that live for one game and are never
rows, and `test_system_profiles.py` checks the two lists share nothing.
`supabase-migrate-visions.sql` adds twenty more on identical terms, for the
fixture names on the three vision ladders that had no account — forty-one
system profiles in all once both files have run, and `bot_ids()` reads the
flag rather than counting.

`profiles.id` is a foreign key to `auth.users`, and that relationship is kept
rather than relaxed: each profile gets an `auth.users` row with a fixed
UUIDv5 id, an address on `.invalid`, no password, a ban to the year 3000, and
`is_bot` in `app_metadata` — the half of the metadata a user cannot write. The
signup trigger then makes the profile and the file upserts it, so running the
file again re-asserts the same twenty-one rows and creates nothing twice. Three
triggers make the rest structural: a system profile's name, rating and flag
survive any UPDATE (a bulk `set rating = 100` still runs for everybody and
leaves them alone), a `friendships` row may never contain one by any door
including `accept_friend_request()`, and one may never send a request. A
request *to* one is allowed on purpose, so the Social page behaves as it does
for anybody; it simply sits unanswered.

On the server the exclusion is three checks deep, none of which is "they are
offline". `handle_hello()` refuses the token — `supabase_db.bot_ids()` reads
the flagged ids once every `BOT_IDS_TTL`, outside the lock, and the token's
own `app_metadata` is a second answer that needs no database — leaving the
connection a guest with `Client.is_bot` set. `may_play_ranked()` then refuses
that flag by name (even on a server with accounts off, where every guest may),
`handle_find()` refuses it at the door and again when choosing a partner, and
`ai_fallback()`'s second-waiter check ignores it. `is_ai` and `is_bot` are two
flags on purpose: one says the fallback is sitting here, the other says this
token is a system profile, and nothing is ever both.

**Four ladders, four columns, one door.** Each vision has a rating column of
its own on `profiles`: `rating` is the Sighted ladder and has been since
`supabase-setup.sql`; `complete_blindfold_rating`, `board_only_rating` and
`fog_of_war_rating` arrive with `supabase-migrate-visions.sql` — the fifth
hand-run file, after the system profiles — shaped exactly like `rating`
(`integer not null default 100`) and closed to the browser exactly like it:
the file restates the column grant the setup file wrote, and
`tools/check_supabase_visions.py` proves it against the real project.
`supabase-migrate-practice.sql` is the next hand-run file after them, adding
the `practice_progress` table and nothing else, proved against the real
project by `tools/check_supabase_practice.py`. The keys that name them are `G.mode`'s — `LB_VISIONS` in the page and
`VISION_COLUMNS` in `server/supabase_db.py` are the same table twice, and the
`CASE` inside `record_rated_game()` is it a third time; `test_visions.py` and
`test_leaderboard.js` hold the three to each other, because a rating moved
under one name and read under another is a ladder that lies.

The home page reads all four straight out of `profiles`, one query per column
(`loadLadder`), highest first, ties by name, top twenty. Four queries rather
than one on purpose: a select naming a column that does not exist fails the
whole request, so on a project that has not run the visions file the Sighted
ladder stays up and each of the other three says which file it is waiting for
(`ladderError`, on Postgres's `42703`) instead of pretending to have loaded.
Every other error is printed as itself. The fixture the page used to carry
for those three ladders (`LB_BOARDS`) is gone: the migration seeds the same
sixty places — same names, same numbers, the fog table's second Kasper21
dropped in favour of the higher standing, as the page already did — so the
first ladders drawn from the database are the ladders that were drawn before
it. Forty of the sixty places belong to twenty of the system profiles; the
other twenty names had no account, and the file creates them as system
profiles on the same terms as the twenty-one, announcing each with a NOTICE.
Each place is written once, recorded in `rating_seeds`, so running the file
again never puts a ladder that has started to move back to the fixture.

The only thing that moves any of the four is `record_rated_game()`, a
security-definer function that `service_role` alone may execute:
`supabase_db.record_rated_game()` hands it a game id, the vision, both
accounts and the result, and it moves that vision's column and no other — four
to the winner, four from the loser, nothing on a draw — reading both rows under
a lock rather than trusting the caller, and recording the game in
`rated_games` keyed by that id, so the same game settled twice moves nothing
the second time and answers `applied = false`. It stands the system-profile
guard down for its own transaction, because a rated game is the thing those
rows were made to play. A ranked game between two people is still unrated, and the fallback bot has
no row to rate; the AI league below is the one caller, through
`league_finish()`.

**The AI league plays the strongest bot accounts against each other around
the clock, and it is the one place the server plays chess.** `server/league.py`
(`LEAGUE` in `server.py`, built by `league.build()` at startup) runs four
ladders — Sighted, Complete Blindfold, Board Only and Fog of War — each with
its own pool, its own games and its own rating column — the four of the
visions file above, `rating`, `complete_blindfold_rating`,
`board_only_rating` and `fog_of_war_rating`, read by `RATING_COL`, which *is*
`supabase_db.VISION_COLUMNS` rather than a copy. `supabase-migrate-league.sql`
owns no rating and seeds no player: it adds the league's memory (the two
tables and three functions below) and refuses to run before the visions file. The pool is the leaderboard itself:
`top()` ranks a ladder exactly as the home page does (rating descending, then
name) and takes twenty, and `eligible()` keeps the `is_bot` accounts among
them — re-read every minute and after every result, so an account that falls
to twenty-first is out of the next pairing (never out of a game in progress)
and one that climbs to twentieth is in. Nothing is invented to fill a board:
no name, no account, no rating, and the account id in a game row is the
profile's own. A human in the top twenty holds a place on it and is never
seated: `is_bot` is the whole test, and nothing in `lobby`, `rooms` or
`challenges` can reach a league game. The page shows these accounts as it
shows anybody — name and rating — and nothing on it says which are bots.

Everything downstream of the browser's absence is a real dependency rather
than stdlib: `python-chess` (requirements.txt) referees — legality, mate,
stalemate, repetition, the fifty-move rule, insufficient material, SAN and
PGN — and a native Stockfish on PATH (the Dockerfile installs Debian's;
`NOX_STOCKFISH` overrides) chooses the moves over UCI. One engine process
(`EnginePool`, `NOX_LEAGUE_ENGINES`) serves every game, because the games are
paced by their own pauses and a move costs the engine a few hundred
milliseconds. Strength follows the ladder: `engine_elo_for()` maps a
leaderboard rating onto `UCI_LimitStrength`/`UCI_Elo` between 2500 and 3000
(2000 → 2500, 2300 → 2650, 2600 → 2800, 2800 → 2920), clamped to whatever
range the installed build reports, with `movetime_for()` giving the stronger
seat a little more search. The pauses a viewer sees are `think_seconds()`,
not the search: log-normal around a base that rises into the middlegame,
stretched by the number of legal moves, cut when the reply is forced or the
game decided, one move in twenty a long think, and shortened by a short
clock. Clocks are thirty minutes a side, kept as "what each side had left
after its last move, and when that was", so nothing writes a row per second.
Games end by the rules (`outcome_of()`), on time, by resignation (a side that
has judged itself lost by 900cp or more on four moves running, past move
twenty) or by agreement (ten level evaluations past move forty with nothing
captured or pushed), and in no other way — there is no draw offer, because
there is nobody to offer one to.

Matchmaking (`pick_pair()`) shuffles the eligible players, seats the first
who has anybody within a hundred points, prefers an opponent neither has met
in their last three games (`RECENT_MEMORY`, seeded from the last forty
finished rows at startup), draws at random from whatever that leaves, and
gives white to whoever had black last. A player has one seat per vision:
`league_seats` in the database has `(mode, player_id)` as its primary key and
`league_start()` inserts the game and both seats in one transaction, so the
second game to try to seat somebody fails rather than doubling them.
`NOX_LEAGUE_GAMES_PER_MODE` (default 1) is how many run at once per ladder;
the home page features the live game with the highest combined rating
(`featured()`), or, for `RESULT_PAUSE` seconds after it ends, the finished one.

**Every game is a row, and every write to it is guarded.** A move is a PATCH
whose filter names the owner and requires the row's `ply` to be behind the
move (`SupabaseStore.write_move()`), so two servers — Render starting the
new instance before stopping the old — cannot both play ply 41: the second
to try changes nothing, re-reads the row, and lets go of the game.
`league_finish()` is a Postgres function guarded on `status = 'live'`: it
records the result, hands the game by id to `record_rated_game()` — the one
door, which moves that vision's column by four each way, nothing on a draw,
and stands the system-profile guard down for its own transaction — and frees
the seats; once, whatever asks twice, so nobody is ever paid eight, and the
league adds nothing to the rating rule. Ownership is a lease (`owner`, `lease_until`,
`LEASE_SECONDS`) renewed by every write; on startup `recover()` claims every
live row whose lease is lapsed or released, replays its moves (a row that
does not replay is abandoned with `league_abandon()` and no rating change),
finishes it properly if the rules already call it over, and otherwise sits
back down with the clocks as they were written — the time the process was
away is not charged, since the bots did not spend it. SIGTERM releases the
leases so the next instance adopts at once. Rows another live process owns
are counted (`foreign`) and not duplicated. A database that stops answering
pauses the games rather than forking them: a move that cannot be written is
not played, and a finish that cannot be written is retried.

The page watches on a socket of its own — `{t:"live"}`, answered and then
pushed `{t:"live-games"}` on every move, `{t:"unlive"}` to stop — opened by
`liveOpen()` on the home page and closed by `liveLeave()` on the way off it,
and never NET's, which is a player's connection and goes up and down with
rooms and games. `/live.json` is the same snapshot by HTTP and `/health`
carries the league's counts. The four cards (`liveCardHTML()`) are the
game's own board a fourth time — same art, same glyphs, same `.fog` — and
show only what the vision allows: Sighted every man and the last move, Board
Only the squares and no men, Fog of War the side to move's men with every
other square fogged (`visibleSet()`'s rule from the chair of whoever is
thinking), and Complete Blindfold no board at all, the console instead.
Clocks count down client-side from the snapshot on the server's own
timestamp (`liveRemaining()`), and a result re-reads all four ladders
(`loadBoard()`, now four queries of `profiles`, one per column; the old
`LB_BOARDS` fixture is gone). `NOX_LEAGUE=off` turns the league off.

**A live card opens that game, by id, on the game screen — full screen, view
only.** The SPECTATING section of the script (`SPEC`, `specOpen()`) is the
whole of it, and it is deliberately not a second game page: `G.opponent`
becomes `'spectate'` — a fourth kind of opponent, so `LOCAL()`, `BOT()` and
`ONLINE()` are all false and nothing that lets a move be entered can be
reached — and the ordinary game screen draws the game exactly as a game of
that vision is drawn: the same board and glyphs, the same strips (with the
rating directly after the name, then the colour), the same clocks, the
console for Complete Blindfold, `visibleSet()`'s fog from the chair of
whoever is to move (`G.human` follows the snapshot's turn). Nothing a
player's screen does not have: no move history, and no row of recent moves
under the board either — a version had one, the last four, and it went out
with the replay below. The things a player has — Resign,
Offer Draw, Peek, the move box, the chat — are absent rather than disabled
(`body.spectating` in the CSS, `specStatus()` in the script), the board takes
no pointer, the square handler and `canConcede()` refuse, and `checkEnd()`
and `flagFall()` are not asked: the result is whatever the server says
(`specFinish()`), because a game may end on time, by resignation or by
agreement and only the server can see those. Moves are replayed through
`applyMove(m, true)`, so notation, captures, sounds and the console are the
game's own; a snapshot that is not a continuation rebuilds from the start.

**A viewer arrives at the game as it stands.** The league plays around the
clock, so almost everybody opens a card mid-game, and the board shows the
position at that moment — the same position the card showed — with the
clocks running. A version of this screen replayed the whole game first,
from move one at a viewing pace of about twenty seconds, with the clocks
standing still and FROM THE START at the foot of the screen; it was taken
out because it is not what a live card promises. The card is a picture of
the game now, and pressing it opens that picture larger, not a recording of
how it came about. So the moves a snapshot carries that the board has not
shown are applied at once by `specCatchUp()` — through `applyMove()`, so the
notation, the captures and the console are the game's own, but with the
sound off and every piece element dropped before the final `render()`,
because `render()` slides a piece it already has and forty silent moves
would otherwise end in every man on the board sliding from where it stood
at move one, the replay over again in a fifth of a second. One move arriving
on a board that is already caught up is the game happening and is played at
once, with its sound. A finished game opened by its link shows its final
position and its result box together. Fog of War is seen from the chair of
whoever is to move, as the card shows it.

There is no Back button of its own: the logo is the way home, as on any
game screen, and so are Back to Home on the result box, escape and the
browser's back. Only a live card is a button, and it carries `data-id`: a waiting card has
nothing behind it and a finished one is a result being read, so neither
opens. The page watches on a socket of its own — `{t:"watch", id}`, answered
and pushed as `{t:"watch-game"}` on every change to *that* game and no other,
`{t:"unwatch"}` to stop — and the server's `handle_watch()` gives the
connection nothing: no seat, no colour, no `client.game`, so a move, a
resignation, a result or a draw offer from it meets the same refusal every
seatless socket meets, and a league game is not a `Game` in `games` for
anything to reach anyway. `League.watch()`/`unwatch()`/`snapshot_of()`
answer by id from the live matches, then from `finished_by_id` (the last
forty this process ended), then from the store (`store.game()`,
`snapshot_from_row()`), so a refresh on a finished game shows how it ended;
`next_live_id()` is what "Watch Next Live Game" offers once the ladder's next
game exists, and it is never entered without a press. The address is
`/spectate/<id>`: the server serves the page for it (`SPECTATE_PATH`) and
looks nothing up, `specBoot()` reads it back, and the `<base>` written at the
top of `<head>` is why every relative asset still resolves under it. The
end-of-game box is borrowed — New Game reads Back to Home, Rematch reads
Watch Next Live Game, Study Board is hidden — and `specButtons(false)` puts it
back. `showScreen()` calls `specStop()` on the way to any other screen, which
closes the socket and hands `G` back as it was; the game goes on on the
server whether or not anybody is watching, and a second watcher is only a
second socket. `test_spectate_flow.js` drives the whole thing under the DOM
shim against a scripted socket; `test_league_socket.py` does the server's
half for real, including everything a spectator might send. Without a
service key (or with `NOX_LEAGUE=memory`) it still reads the real accounts,
with the publishable key the page ships (`public_profiles()`), and plays them
with the results kept in memory — the same degradation puzzle ratings have —
so a laptop shows the real names and a production box without the key does
not quietly invent any; `NOX_LEAGUE_FIXTURE` reads profile rows from a JSON
file instead, for a test with no network. `NOX_LEAGUE_FAST` shortens every
pause for the tests.

**The league starts itself, and keeps trying.** `start_league()` in
`server.py` is called once from `main()` before the port is bound, and
`league.build()` answers None for `NOX_LEAGUE=off` and nothing else. Every
other precondition — python-chess, the database, its schema, the engine, an
AI account to seat — is checked by `League.boot()` on the league's own thread,
in that order, by `prepare()`, and a miss is a *state* (`STATES`: starting,
running, database unavailable, migration missing, stockfish unavailable,
python-chess unavailable, no eligible players, crashed, off) rather than an
exit: logged with the full reason when it changes, retried at a doubling
interval up to a minute (`BOOT_RETRY_MIN`/`MAX`), what was found kept across
attempts. It used to be decided once, synchronously, in `build()`, and that is
how production ran for weeks without a league: Debian's `stockfish` package
installs to `/usr/games`, which is not on PATH in `python:3.12-slim`, so
`Popen(["stockfish"])` failed at boot, `build()` returned None, and nothing
ever asked again. `find_stockfish()` now looks — `NOX_STOCKFISH` if set (and
only that), else PATH, else `STOCKFISH_CANDIDATES`, `/usr/games/stockfish`
first — and logs where it found the engine; the Dockerfile also puts
`/usr/games` on PATH and refuses to build an image whose engine does not
answer `uci`. `SupabaseStore.verify_schema()` asks for the four rating
columns, `is_bot`, the three tables and the four functions by name before the
first game, and names the file that adds whatever is missing. `/health`
carries the state, its public sentence, the store kind, the engine's path,
the attempt count and, per ladder, playing / waiting / error with the reason
(`pairing_report()` and `explain_pairing()` — "20 leaderboard rows, 19 bots in
the top 20, 17 free, 11 valid pairings", or "no valid pairing within 100
Elo"); the socket payload carries `off`, `state` and `note` while not running,
and the cards print the note. Nothing public quotes an error body or a path
but the engine's. `tick()` isolates each board and each ladder: an exception
in one is logged against its vision (`mode_failed()`) and the other three
carry on; only the database being away is everybody's problem. `start()` is
idempotent and `start_league()` refuses a second league. Every log line is
prefixed `[AI League]`. `test_league_boot.py` runs the real entrypoint as a
subprocess — with the engine on PATH, with PATH stripped, with `NOX_STOCKFISH`
pointing at nothing, and with `NOX_LEAGUE=off` — and reads `/health`,
`/live.json` and the log.

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

**Two doors on the menu, four pools behind them, and a setup page in between.**
The Puzzle menu in the header is **Puzzle** and **Puzzle Rush**, and no vision
is named on it. Puzzle opens a setup page that asks which vision; Rush brings
its own clock and pool and asks nothing, so it still starts on the press. The
home page's Puzzle shortcut is a button and not a menu: hovering it opens
nothing, and pressing it presses the header's Puzzle door (`navPuzzleGo`), so
it inherits that door's gate and goes nowhere the header does not. It used to
carry the same two-item popup, so the mouse arriving on a shortcut was met
with a question; `test_puzzle_nav.js` now asserts it carries none.

**Practice makes the same bargain one table along, and the course rides in it.**
`public.practice_progress` (`supabase-migrate-practice.sql`, hand-run, safe to
re-run) is one row per `(user_id, mode)` — level, best, asked, correct,
sessions and a `stats` jsonb — and the browser writes it itself under RLS,
exactly as it writes `puzzle_progress`: what a player's visualisation is worth
is not a rating anybody compares, so there is nothing here the *server* has to
be the one to write. The policy is owner-only both ways, and the grant is
select/insert/update with **no DELETE**, so a delete is refused by the grant
rather than the policy — the same shape `puzzle_progress` has. A
`practice_touch` trigger stamps `updated_at` and overwrites `user_id` with
`auth.uid()` on every insert and update, so a row cannot be filed under
somebody else even by a client that tries. `prRowOf()` clamps every number to
what the column checks allow, because a row the database refuses is a console
warning and a level quietly not saved; `lastAt` rides inside `stats` rather
than earning a column, since nothing compares it. `prPush()` reads the mode
back out of the local store rather than taking it as an argument, so there is
one answer to what a mode stands at and it is the one on disk. `prSync()`, called
from `setAccount()` right after `pzSync()`, reads the account's rows, merges
them with this browser's cache *and* with whatever was practised as a guest,
writes the result back locally, pushes what the account did not have, and then
removes the guest copy — otherwise the next account to sign in on a shared
machine would adopt it too. `prMerge()` is the rule: the higher level wins
(nobody is sent back down a ladder by signing in on a browser that has not
heard about it) and the tallies come *whole* from whichever side has answered
more, because adding two histories together would count a session twice. The
finished lessons are one more row under the reserved mode name `course`
(`PR_COURSE`, `prPushCourse()`), unioned the same way, whose numbers mean
nothing and whose `stats.done` is the payload. All of it is fire and forget:
until the migration has been run there is no table at all, which is a console
warning rather than a broken drill, and guests keep the whole record locally.
`tools/check_supabase_practice.py` proves the RLS and the grants against the
real project.

There are still five pools and `PZ_MODES` is still the table: a `key`, the name
a player reads, and the `vision` `G.mode` takes while the puzzle is up, which is
the only place the two vocabularies meet. `enterPuzzleMode()` is still the whole
of entering one — it writes `PZ.pool` and `PZ.vision` and hands the list to
`pzOpen()`. What changed is only who calls it: `pzModeForVision()` reads the
table backwards, so the vision the player picks *is* the pool that opens, and
`startPuzzleFromSetup()` is the one line between them. The menu used to name all
four because a door was a pool and a vision at once; it still is, but a menu is
a list of places to go and "Sighted Puzzle" and "Fog of War Puzzle" are one
place seen two ways.

**The setup page is the Play Bot panel, not a screen of its own.** `PZ.setup` is
the whole of it: a puzzle that has not started yet, on `screen-game` with
`#gameSetup` up. `enterPuzzleSetup()` mirrors `enterGameSetup()`, and every
difference lives in `syncOptions()` behind that flag — the button reads **Start
Puzzle**, `#secTime` is hidden (a puzzle is untimed, and the one that is not
never comes through here), and `#gameSetup`/`#gamePuzzle` each say which of the
two puzzle states they mean, because `PUZZLE()` is already true while `PZ.on` is
still false. Opponent and colour need no rule at all: `BOT()` and `CHALLENGING()`
are both false for a puzzle, so the two rules Play Bot already had hide them.
`unanswered()` asks for the vision and nothing else, so Start Puzzle nudges
`#secVision` exactly as Start Play nudges `#secOpponent`. A second copy of that
panel would have been two designs to keep in step, which is why there is not
one. The flag is cleared by `pzOpen()`, by `enterGameSetup()` and by
`showScreen()` on the way anywhere else — `pzClose()` cannot do it, because it
returns early while `PZ.on` is false.

Its address is bare `#puzzle`; `#puzzle/<pool>` is still a ladder already open
and `#puzzle/rush` still a run, and all three round-trip.

It used to be two questions. Opening, Middle Game and End Game sorted puzzles by
the part of the game they came from — a fact about the chess, not a way to play
— and a screen of its own (`screen-pzvision`) then asked which vision to see
them through. Both are gone: phase decides nothing, and "Blindfold Puzzle" has
already answered the vision question, so there is nothing left for a chooser to
ask. Opening and middlegame *training* moved to Lesson → Practice, where the
standard can be educational instead of tactical. The guest lock stays on the
menu, so a guest is sent to the account page rather than into a door that would
have nothing to record.

The pools are **non-overlapping by construction**: `tools/pool_assign.js` deals
one verified corpus out across the five by round-robin over the generator's own
difficulty ranking — so every pool is a mixed sample of the whole set, evenly
spread from easiest to hardest, and a position is behind exactly one door.
Dealing by a hash of the id would be one line and would give one pool the three
hardest puzzles in the set; each pool is walked in order as its own ladder, so a
pool that is randomly hard is a door that is randomly shut. Five files of a
hundred in `puzzles/modes/`, plus `reserve.json`. `pzFetchMode()` reads them,
and falls back to dealing the three legacy phase files the same way when a pool
file is absent — a bridge, not a second source of truth, and the real files win
because they are looked for first. `enterTrack()` is still there for those three
files and for `test_puzzle_flow.js`; nothing on the page reaches it.

**The visions are the game's own, not a second visibility system.**
`PZ_VISION_NAME`'s keys are `G.mode`'s — `total` (Complete Blindfold, no board,
moves typed), `blind` (See the Board, sixty-four empty squares, clicked), `fog`
(Fog of War, your men drawn and theirs not) and `sighted` (nothing hidden) — so
the whole of "board hidden / pieces hidden / their pieces hidden" is
`G.mode = PZ.vision` and nothing else. `render()` already knew how to draw each
of those, in one place. `PZ_VISIONS` is deliberately only the three that *hide*
something and is not the same list as those keys: Sighted is a door with a name
to print and nothing for a list of hidden visions to say about it.

`pzOpen()` is the one place `PZ.vision` reaches the board, which is why every
door writes to `PZ` and never to `G` — `G.mode` set before `pzOpen()` is
overwritten a line later, and that is exactly how four of the five doors once
came to open a sighted board. Rush is the door that is only a pool
(`PZ_MODES` gives it no vision), so `rushStart()` names `sighted` itself rather
than inheriting whatever the last puzzle was.

**Two board Practices, on the Practice page, walked by the puzzle player.**
`PC_CATS` — Opening Practices and Middle Game Practices, 101 each in
`practices/*.json` — are positions with an engine-verified answer, and
deliberately their own table rather than two more entries in `PR_MODES`: the
seven drills share one level ladder and one accuracy store, and solving a
middlegame must not move a blindfold level. `enterPracticeCat()` hands the list
to `PZ`, so a practice is walked with the same board, the same `puzzleStep()`
and the same explanation card as a puzzle; `PZ.practice` is what the card reads
to know it should not promise a payoff. The standard lives in the file — an
opening move has to be objectively strong, and every middlegame is worth at
least **thirty-five percentage points** of winning chances against the best
defence Stockfish can find. They carry no `seedRating`, because there is no rung
for them to sit on, and so **a Practice never moves the puzzle rating**:
`pzElo()` priced against `undefined` is `NaN`, and that `NaN` reached
`nox.puzzles.rating` and the server. `PC_VERSION` is their own `?v=`, separate
from `PZ_VERSION`, because the two sets are written by different tools on
different runs.

**Which door a puzzle came through is said three ways.** `pzScope()` is the key
its progress is stored under (`mode:fog`, `practice:middlegame`, or an old
phase track); `pzScopeName()` is the name on the chip and the card; `pzRoute()`
is the token the address bar carries (`#puzzle/fog`, `#puzzle/practice-opening`).
The first two are storage and may never change spelling; the third is a URL, so
it carries no colons and no key that means two things — "opening" is a phase
ladder *and* a Practice category, and only the prefix tells them apart. Anything
reading `PZ.track` directly is a bug: it is null for four of the five pools and
for both Practices.

Hiding is *rendering*, and never anything else: `G.st` is a complete position in
every vision, which is what lets the written lists, the legality of a move, the
forced reply, castling, promotion and en passant be identical in all three.
There is no second board with the opponent taken out of it.

Two things a puzzle does **not** inherit from the game with that mode. It does
not inherit fog of the *squares* — in a game, fog darkens every square you have
nobody standing on, which is a rule about what you can see of the board, and
here the board is granted and it is the opponent who is hidden; a darkened board
would also be the second vision over again. And it does not inherit peeking:
three peeks are a concession to a game you cannot restart, and a puzzle has
Retry, so `pzOpen()` sets `G.peeksLeft = 0`.

`pzFinish()` is the one place the vision is lifted (`G.revealed = true`), on the
same terms as the card, the swing and the themes: it waits until there is
nothing left to give away, and it is also what hands Study Alternatives a board
it can be played on. A run is the exception and does not stop to open anything —
`rushEnd()` does, because by then the run is over.

**Nothing may leak through a highlight, and two of them had to be narrowed.**
The last-move highlight already required `sighted`, a peek or a reveal, so it is
absent from all three visions on its own. The check ring did not: it lights
whichever king is in check, which during the forced reply is *theirs*, and a
ring around the opponent's king is the most valuable square on a hidden board.
`render()` therefore lights it only for the solver's own king while a puzzle is
unrevealed. Check is still *said* — `CHECK` beside the side-to-move line — with
no attacker, no arrow and no path, in words or on the board.

**The written position is generated, never stored.** `pzPieceList()` reads
`G.st` on every render, both sides, in every vision: in Complete Blindfold it is
the position, in See the Board and Fog of War it is the half the board is
refusing to draw, and in Sighted it is what is already on the board said
again. A list checked into `puzzles/*.json` would be a second copy that has to be
kept in step with the first, and would be wrong the moment anything moved — as
it is, a capture, a promotion and an en passant are right without any of the
three being mentioned. Kings first and pawns last, and a pawn is named by its
square alone, because "Pa2" is not how anybody says it and the letters are what
the eye is scanning for. Captured men are simply not on the board, so there is
no separate record of them: the list says what is there, not what happened.

**Two panels stand beside a fog puzzle and they answer different questions.**
The written position says where every man *stands*, and it is granted in every
vision, both sides, Fog of War included. A version of it printed **Hidden** for
the opponent's row, reasoning that a written list of the men the board is hiding
gives back exactly what the fog is keeping. It does — and that is what the panel
is for. The fog is a rule about the *board*; holding a position you have been
told while looking at squares that will not confirm it is the exercise, and a
panel showing half a position is not a harder version of it but a poorer one,
with nothing left to visualise. That shipped and was reverted.

The notations panel is the other question — what *happened* — and there the
opponent's replies are withheld, because a reply spelled out as "Rxb7" is a move
the solver never saw played. `pzHidesReplies()` is that rule, in one place, and
`pzRenderNotes()` is the only caller: the fen's side to move is the solver, so
the odd plies are theirs, masked with a `?`. It stands down the moment
`pzFinish()` sets `G.revealed`, which is also when the card, the swing, the
themes, Show Follow Up and Study Alternatives arrive. The name is the whole of
the distinction — anything reading it from `pzRenderPieces()` has confused the
two panels, and `test_puzzle_flow.js` asserts that neither drifts into the
other's job.

**The notations panel is walked from what was played, never from the file.**
`pzSanLine()` replays `G.uci` from the puzzle's own fen. Reading `puzzle.moves`
would print the answer before it had been found, and would also be wrong about
every other way this board moves — a revealed solution, a follow-up and a
defence tried in Study Alternatives all land in `G.uci` and only one of the
three is in `puzzle.moves`. `G.sans` is deliberately left alone: filling it in
would start the game's clock (`clockRunning()` waits on exactly that) and make
`gameInProgress()` true of a puzzle. The numbering is the game's, off the fen's
fullmove, so a black-to-move puzzle opens on an ellipsis.

**Complete Blindfold is the only vision with a move console, and it shares
`parseMove()` with the game's.** SAN, plain coordinates, castling, promotion,
the forgiven casing and the ambiguity message are one implementation; a puzzle
that accepted a different dialect of notation from the game would be teaching
the wrong one. Nothing compares strings to the solution — `parseMove()` hands
back one of the legal moves or an error, and `puzzleStep()` is what then decides
whether it was the move. That split is why the page can tell "not legal here"
from "legal, and not the answer", which it must: one of the two means the
player's picture of the board is wrong, and only the rules can say which. An
illegal attempt is reported in words on the board visions too, where the flash
on an empty square says nothing, and it is not counted against the attempt —
`PZ.wrong` is for a move that existed and was not the answer.

**"One objectively best move" is only half the standard.** The other half is
`obvious()`, and it exists because a corpus built on the numbers alone fills up
with one puzzle: the opponent puts a rook where it can be taken, the evaluation
swings six hundred centipawns, exactly one move is best, and the answer is
"take the rook". Every engine gate passes it and nobody learns anything. So a
puzzle is also refused when the move before it *announces* the answer (a
capture of the piece that just moved, or of one it just left loose), when all
the material is in hand after one move, or when there is nothing left to
calculate. Each is waived by a real idea — but only ideas that are properties
of *the move*: a first version of that waiver let 703 of 888 puzzles through
because it counted `defensiveResource`, which is the *kind* label stamped on
every rescue, as a tactic. Captures and checks are welcome; obvious ones are
not.

**A solution runs to its payoff, not to the end of the doubt.** `buildLine()`
used to stop the moment there was no longer exactly one strong move, which is
reliably a move or two before anything happens — so the player found the
combination and the card had to promise a rook still standing on the board.
`paidOff()` is the new stopping rule: the material actually in hand (net of
anything of ours still hanging), or mate. Past the first move the bar for
"a move they still have to find" drops from `GAP_MIN` to `GAP_CONTINUE`,
because the turning point is settled at ply 0 and re-arguing it every ply is
what stopped every line early.

**The card may not promise what the line does not deliver.** A card once said
"it leaves the rook on b7 hanging — it can simply be taken" while the verified
follow-up never took it; both halves were produced honestly and the reader drew
a false conclusion from their being next to each other. `auditClaims()` in
`tools/puzzle_words.js` re-reads every sentence against the board the line
actually reaches and strikes anything it cannot justify — a hedged false
sentence is still a false sentence. Explanations are therefore written *last*,
after the moves, the score and the follow-up are locked.

**What makes a position a puzzle lives in one file, `tools/puzzle_rules.js`.**
The first version of this generator had one criterion — "one strong move", the
best beating the second best by 150cp — and the corpus it produced is the
argument against it: 57 of the hundred middlegame puzzles had the solver at
worse than −700 before they began and still worse than −700 after the
"solution", and another 18 had them already winning by more than +700. Every
one of those is a position with exactly one best move in it and nothing at
stake in finding it. A puzzle is not "the engine's choice here is clear". A
puzzle is a **turning point**, and `judge()` measures three numbers, all from
the solver's side: what the position was worth *before the opponent's last
move* (`B`), what it is worth if the solver finds the move (`A1`), and what it
is worth if they play the second best (`A2`). `A1 − B` is the mistake, `A1 − A2`
is whether finding it matters, and the three together say whether this is a
punishment (level beforehand, winning after) or a rescue (worse beforehand,
level after) or neither. The generator asks it while mining and the verifier
asks it again deeper over what shipped — one rule, two callers, because a
corpus checked against a second standard is a corpus with no standard.

`B` is the number the old generator never had, and getting it needs the
position *before* the opponent moved, which is why every record now carries
`prev`. It is also why every measuring search sets **`objective: true`** in
`tools/sf.js`. This build applies `Contempt 24` from the point of view of
whoever is to move at the root, so `B` and `A1` are read with opposite sides at
the root: left on, `1.e4` from the starting position measures as a 64cp
blunder, and the mistake the whole standard rests on is an artefact of the
setting. Playing searches — the bot ladder, `seedRating()`'s imitation of a
rung — deliberately keep the default, because there the engine is a player and
contempt is what a player should have.

**Opening, middlegame and endgame are decided by the position, not the move
number.** `bucketFor()` used to be `fullmove <= 12` and `<= 30`, which files a
queenless rook ending reached on move nine under "opening" and a fully manned
Sicilian on move 32 under "endgame". It now reads material for the endgame test
and pawn count plus undeveloped pieces for the opening one.

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

A wrong *move* is **repaired**: the line is cut at the offending ply, the
engine's move goes in, and it is extended by the generator's own rule.
Repairing changes the line, so the id (a hash of position and line) and the
seed rating are recomputed with it.

A position that is no longer a **turning point** is **dropped**, which is the
other half and the new one. There is a right move to put in place of a wrong
one; there is nothing that would make a position worth showing that is not.
`verdict()` re-measures `B`, `A1` and `A2` at depth 22 — deep enough to be a
real second opinion on the generator's 16, cheap enough to spend three searches
on every record — and a record that fails, or that cannot be checked because it
carries no `prev`, leaves the track. The ladder then closes over the hole and
renumbers, so a track is however many puzzles cleared the standard rather than
a fixed hundred with the failures papered over. Ids are untouched, so nobody
loses a solve — only their place in the numbering, exactly as after a
regeneration. A correct solution that is no longer *sharp* is
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

**The card at the end of a puzzle is written by the tool, not by the page.**
`describeBest()` cannot say what the *opponent* did wrong — the mistake happened
before the position and the move it is handed — so a card built out of it can
explain the solution perfectly and never tell the player what to look for next
time. `tools/puzzle_words.js` writes the explanation where the engine is, and
`verify_puzzles.js` checks it into the file as `why`: the mistake, a sentence
for every ply (including why the runner-up is not the answer, and how forced
each defence was), and where it all arrives. `pzExplain()` only spells it out.
Nothing is searched at the board, which is the same bargain the follow-up made.

**The swing is drawn as well as said.** The card's own sentence ("the
position was losing before it and is level after it") cannot be compared to
the last puzzle's, so `pzSwingHTML()` prints the same two readings as a chance
of winning: `eval.before` — what the position was worth *before the opponent
went wrong* — and `eval.best`, what it is worth once the move has been found,
both already in the file, both from the solver's side, and both through
`winPct()`, the same curve the review judges every move with. The pair is the
point: the evaluation of the position the player is looking at *is* the
evaluation after the best move, so a strip drawn either side of the solution
alone would show one number twice. Mates are shown as certainty and nothing
else is allowed to reach 0% or 100%, because a position that is merely winning
is not a game already over. It appears only once the puzzle is finished, for
the same reason the themes do — "you are on 8% and heading for 58%" says the
move is a rescue, which is most of the answer.

The discipline in that file is worth keeping: every sentence is read off a
position or off a number a search already produced, and where nothing can be
justified the card says less instead. It is very easy to write a confident
sentence about a deflection that is not on the board, and a set that does it
once is a set nobody can trust the rest of. The same reasoning is why
`themesOf()` refuses to claim deflection, decoy, overloading, interference or
double attack at all — every cheap test for them fires where they are not true,
and a wrong label is worse than a missing one, because the label is the thing
the player is learning to see.

**Study Alternatives is the one thing on the puzzle screen that needs an
engine, and it is deliberately the last.** Solving asks nothing: the file
carries its own explanation and its own follow-up, and `test_puzzle_flow.js`
still asserts that solving, finishing and the follow-up never reach for one.
The worker boots only when somebody presses the button — because what it
analyses is a position *the player invented*, and no amount of precomputation
can have that in the file. The board rewinds to the opponent's first defensive
turn, any legal move for them is accepted, and the engine answers on that exact
position. `engineAsk()` grew a `fen` option for it, since a puzzle has no game
in front of it to describe as a move list from the start.

The case that matters most is the honest one: if the defence the player tries
is genuinely better than the one on file, it says so, and says that this makes
the *puzzle* faulty. A stored defence that is not best defence is a broken
puzzle, and inventing a refutation for it would hide exactly the bug the
verifier is supposed to catch.

**Practice is not a second puzzle ladder.** Puzzles ask what the best move is,
with the board in front of you the whole time. Practice (`PR`,
`screen-practice`, reached from LESSON → Practice) asks whether the board is
there at all: name a square, trace a line, see where a knight reaches, follow
moves you never see, say what one move changed, count a capturing sequence
out, find the move in a position you are holding, and finally play a whole
small game with nothing drawn. Eleven modes (`PR_MODES`, keyed `square`,
`lines`, `piece`, `attack`, `tracker`, `after`, `forcing`, `calc`, `branches`,
`hold`, `progressive`), each with a ladder of levels that change the exercise
rather than a label on it.

**The curriculum is `PR_GROUPS`, and it is read rather than described.** The
eleven fall into six groups in the order they are climbed — The Board
(`square`, `lines`), Piece Vision (`piece`, `attack`), Holding (`hold`,
`tracker`), Updating (`after`, `forcing`), Calculation (`calc`, `branches`)
and Blindfold Play (`progressive`) — and that array is the curriculum itself,
not a set of headings the dashboard happens to use: `prGroupOpen(st, gi)`
walks it and answers whether a group can be worked on at all, and both the
dashboard's cards and `prRecommendNext()` go through that one function, so
neither can disagree with the other about the same group. A group is open only
once *every* group before it has cleared its own floor, not merely the one
immediately before it — an earlier version asked only the immediate
predecessor, which let a group two hops past an unopened one read as open. The
Board group's floor is not a rung but `prAutomatic()`: Square Trainer at level
5 or better with a median latency under 1500ms, since naming a square is a
skill to outgrow rather than one to keep training, and once it is automatic
nothing downstream sends anybody back to it. Each mode also names the `lesson`
it grows out of, which is the other half of the contract with the course
below.

**A level is a recipe, and the session is what settles it.** Every mode has
its own `*_LEVELS` array — `PR_SQUARE_LEVELS`, `PR_TRACKER_LEVELS`,
`PR_CALC_LEVELS` and the rest, declared ahead of `PR_MODES` because it reads
them by reference — and a level is not a difficulty label but the concrete
variables the generator reads: which question kinds this rung may ask, how
many men, how long the position stays up, whether the board is shown at all,
whether the move arrives as notation. `prRecipe(key, level)` is the one place
a level is clamped to its mode's ladder and handed back with its caption, and
it is the same call the setup box makes and the staircase makes mid-session,
so a level nobody has can never be named. The staircase is `prStep()`:
`PR_STEP_UP` (3) right in a row steps up, `PR_STEP_DOWN` (2) wrong in a row
steps down, and the level a session settles on is what the mode is worth —
not the accuracy, which at an easy rung says nothing about how hard anybody
was pushed. Progressive Blindfold is the one mode the staircase does not
settle; see below.

**A session is boxed by a clock, and the question in front of you is always
finished.** `PR_MINUTES` is the three lengths a session may run (2, 5, 10; the
setup box opens on 5), `PR.budgetMs` is what was chosen, and `prTimeLeft()` is
read off `prNow()` — a function rather than `Date.now()` inline precisely so a
test can drive a session's ending by hand. The clock is only ever consulted
between questions (`prAdvance`), so running out never snatches a half-answered
question away; the button under the answer reads Finish rather than Next when
there is no time left. Daily Practice (`prDaily` → `goPractice('daily')` →
`prStartDaily()`) is five minutes across *three* drills rather than one: the
recommender picks the first, then `prRecommendFrom()` picks each of the next
two out of whatever it has not already taken, and `PR.mixed` is the rotation
`prNextQuestion()` reads one mode per question. Progressive Blindfold is never
one of the three — a whole game is not a question a rotation can hand off
mid-answer. A mixed session banks two things per mode rather than one:
`PR.mixedLevel` holds each mode's own place on its own staircase and
`PR.mixedRun` each mode's own run of rights and wrongs, because `prStep()`
reads one pair of counters and a right answer in A, then B, then C would
otherwise read as three in a row and step C's level up on the strength of one
of its own questions.

**Nothing is asked twice in a hundred questions.** Every generated question
carries a `sig` — its position's FEN placement, plus whatever else makes it
this question rather than that one — and `prMake()` draws up to six times,
taking the first signature that is not in the last hundred (`prSeen`,
`PR_SEEN_MAX`, kept per owner exactly as the store is). A drill that sets no
`sig` is not ruled out by anything, and a mode that starts stamping its
exercises gets the "not this week" treatment for free. Blind Calculation's
puzzle levels are the one question built after the screen is already up — the
file behind a shipped puzzle has to be fetched — so they get `prCalcDraw()`,
which is `prMake()`'s own shape over the pool once it lands, rather than being
the only questions in Practice that can repeat.

**What is measured is what a wrong answer was wrong *about*.** `prRecord()`
writes one answer as it happens (a reload mid-drill keeps what was actually
answered; only the session count waits for the end), and per mode it keeps
more than a tally: `errs` by kind — `PR_ERRS` is `square`, `ghost`, `lost`
and `other`, because a square named one file over, a man that was captured and
is still being counted (the tracker's own `ghost`, and in a spot-the-change
question the square the man moved *to*) and a thread lost at ply k are three
different failures, and a player — or a later drill picking on their weak spot
— needs to tell them apart; anything a caller does not name lands in `other`
rather than being refused, since it is still one wrong answer. `lv`,
asked-and-correct per rung, so accuracy can be read at the
level it was earned at; `lat`, the last twenty latencies, read back through
`prMedianLat()` as a median so one phone call does not drag the figure the
player sees; and `ply`, the deepest line a mode with a `q.ply` (tracker,
forcing, calc) has been answered right on, moved by a correct answer only,
since a wrong one proves nothing about how far anybody got. The record lives
under `nox.practice.<account id | guest>` (`PR_STORE`, `prKey()`), stamped with
whose it is the way the puzzle cache is — for a guest it is the whole of it,
and for everybody else it is the cache in front of `practice_progress` above.
`PR_VERSION` is 2,
and version 1's single five-rung ladder (Beginner … Advanced) is gone — a
player who has drilled coordinates for a fortnight and never touched tracking
was never well described by one number. A version-1 save is read forward
through `PR_V1_KEYS` rather than thrown away: two of the seven old drills
merged into Square Trainer and one became the tracker's opening levels, so
nothing anybody answered is lost. There is still deliberately **no Elo**:
ranked and puzzle ratings are untouched by all of it.

**The dashboard says where you stand and what to do next, and never locks a
door.** `prReadiness(st)` is the shape it reads: a fraction per group
(`prGroupLevel`, the mean of each mode's level over its own ladder length,
since an eleven-rung ladder and a two-rung one do not otherwise compare), a
milestone once tracker ≥ 9, hold ≥ 7, calc ≥ 5 and Progressive Blindfold's
level 5 have all been held at once, and the one next thing to try.
`prRecommendNext()` is that rule and it is deliberately small: the bridge
first if its own three gates are open (tracker ≥ 5, attack ≥ 4, forcing ≥ 2)
or lesson 10 is finished, since nobody should have to max out half the
curriculum before trying a whole small game; otherwise walk `PR_GROUPS` in
order and stop at the frontier — the first group that is open while the one
after it is not — and inside it recommend whichever drill is furthest *behind*
on its own ladder (`prRecommendFrom()`: the lowest ladder fraction, then the
oldest `lastAt`, then `PR_MODES`' own order, which is not always the order a
group names its modes in). A drill drops out of that pool once it is 60% up
its own rungs, which is the same bar the Solid tag reads; the group's own
floor test (level 2) is deliberately coarser, because it decides whether we
have moved on to the *next* group rather than which drill inside this one
still needs work. Falling off the end of that walk is not "nothing to
recommend": a player really can clear every group's floor while nothing is
solid and the bridge's gates are unmet, which is exactly who this exists for,
so the fallback is the weakest mode across the whole curriculum, and only when
every one of those is solid too does the bridge become the answer on its own
terms. All of it is *soft*: a
card carries a tag — Recommended now, Ahead of you, Solid — and Start always
works. A tag is a hint about where to spend the next few minutes, never a
lock, and `prGroupOpen()` is asked for the tag and for the recommendation by
the same call so the two can never say different things. Beside Start on every
card is Quick, the express lane: two minutes at `prStartLevel(key)` with no
setup box in between.

**`goPractice(target)` is the whole of the way in.** `target` is nothing (a
plain visit), `{mode, level, minutes}` to drop straight into a drill — the
history route, the Quick button, the course's own handoff — or `'daily'`.
`prOpen()` is what a target names: it starts a session with no setup box,
because the two questions `prOpenSetup()` asks are for somebody choosing where
to begin and not for somebody arriving already having chosen. Where a mode's
*first* session opens is `prStartLevel()`: a mode with a session on file opens
where its staircase left it, and one with none opens at the floor its lesson
earned (`PR_FLOORS`, a `{lesson, level}` per mode) or at 1. A floor is a
starting line and never a ceiling — understanding a thing once is not being
able to do it, and the staircase takes over from the first answer.
`showScreen()` calls `prLeave()` on the way to any other screen, which is what
stops a study countdown, a square click wired to a question nobody can see, or
an engine reply from running on over another page.

**Progressive Blindfold is a Practice mode and nothing else.** Same board,
same store, same door — `PR_PB_LEVELS` is its ladder and `progressive` its
key. It is the only one that is a whole *game*: ten rungs that take the board
away a step at a time — your men shown and theirs hidden (`vis:'mine'`), then
the squares with nobody on them (`'squares'`), then no board at all
(`'console'`) — which is the game's own `fog`, `blind` and `total` said in
Practice's own words, and rendering is the whole of the difference
(`pbMask`/`pbPaint`) exactly as it is in a game: the position is complete
throughout. `men` is men a side (`men:0` is the full start position), `peeks`
the level's allowance, `checkEvery` how often it stops to ask, and `target`
the moves that have to be held. It is also the one mode the staircase does not
settle: a rung is held or it is not — `pbEnd()` decides, on the target, at
most one drift and no move that was not there — and `prFinish()` opens the
next session one rung higher only on a pass, keeping what the game cost
(`stats.pb`, per level: moves played, checkpoints held, peeks, recoveries,
drifts) rather than folding it into an accuracy figure a whole game is not
described by.

Three things hold a game up short of that ending, and none of them is a second
question the session scores. Every few moves `pbCheckpoint()` stops and asks
one thing about the position as it now stands — Fine's own order through
`prAskFine()` (where a king is, what stands beside it), how many men a side
has, or what the last move was — with the "last move" decoys drawn from
`pb.prevSt`, the position that move was played *from*, so they are moves that
really were available and never anything a book suggested. A miss is a drift
and the true board is shown for two seconds, because catching the drift is the
point and playing on from a picture that has already gone wrong is not a
question anybody can answer. `pbPeek()` is the same two seconds bought
deliberately out of the rung's own allowance — a level with none left offers
no Peek button rather than a dead one, and neither does one whose look is
already running: `pb.peeking` is what stops a second press spending a second
peek and starting a second timer whose predecessor would take the board away
early. A peek is a *look* and not a pause: `pb.busy` is left alone and a move
may be played while the men are up. And `pbRecover()` ("I've lost it") shows
the *score* and never the board, and hands the position back through
`prRebuildStart()` to be put together from the moves — which is what
Koltanowski did and what every guide to the game says to do instead of
guessing. It is counted (`pb.recoveries`) and costs the level nothing: a
player who stops and works the position out again is doing the thing this
drill teaches. A checkpoint and a recovery *pause* the game: both set
`pb.busy` and borrow the answer row, so the move box comes down with
`PR.onSubmit` and nothing can be typed or clicked into a game that is standing
still, and `pbRestoreInput()` hands the box, the instruction line
(`pbHowTo()`, never the checkpoint's own "Click its square") and the board
click back afterwards.

**The bridge ends somewhere other than itself.** Progressive Blindfold is the
one drill whose result card points off the page, because that is what the
ladder is for: `#prNextLevel` (a held rung with more ahead of it) goes
straight back in one higher with no setup box — a level just earned is not a
question to ask again — and carries no length over from the session that has
just ended, because a Progressive Blindfold session is a rung rather than a
timed drill (`prOpenSetup` hides the length field for it and `pbEnd` is what
finishes a game), so the handler simply passes the mode's own default;
`#prBoardGame` appears from level
7 and `#prBlindGame` once level 10 has been held, and both open the bot setup
that already exists (`goBot()` + `selectMode('blind'|'total')`) rather than a
second matchmaker. `prSuggestFirstBlindGame()` answers the rest of the form
through `pickBotLevel(1000)` and `pickBotTime(30)` — the same setters the
setup's own buttons call, so the guest ceiling and `syncOptions()` are not
bypassed. Neither number is derived from anything the drill measured: 1000 is
a mid-ladder rung chosen as a first blindfold opponent that punishes a dropped
piece without out-calculating a beginner (the top rung an account buys is
3200), and the slowest clock the setup offers — thirty minutes — is chosen
because every practitioner guide agrees a first blind game should be
unhurried. Every other mode's result card shows none of the three, since none
of them ends anywhere but back on the dashboard.

**Nothing in Practice reimplements a rule.** Positions come out of
`prPosition()` and are thrown back unless the rules accept them — two kings,
not touching, no pawn on a promotion rank, neither side already in check, no
castling rights nobody earned. Movement answers are `legalMoves()`. Tracking
walks and blindfold sequences are *played*, with `makeMove()`, and named with
`toSAN()` — never assembled out of notation strings. Late levels of several
modes take their positions from real games rather than a hat
(`prGamePosition`, cut down by `prCluster`), because a random heap is not
training material past small counts. Progressive Blindfold reads what the
player typed with `parseMoveIn()` and answers with the small JS search already
in this file. `parseMove()` is a one-line wrapper over `parseMoveIn(G.st, …)`:
one notation reader, three pages. A generator that cannot produce a valid
exercise retries, then asks again at the easiest setting, and only then gives
up — it never puts a broken one on screen.

The practice board is the game's board markup built a second time (`#prBoard`,
`prSqEls`, `prPaint`) — same `.sq`, same `.piece`, same `.blind` that hides the
men. The CSS is shared; only the element is not, because handing one board back
and forth between two screens is how the two would come to disagree about what
is on it. Rebuilding a position is one interface for all three places that ask
for one (Hold the Position, the tracker's last level, Progressive Blindfold's
recovery): `prRebuildStart()`, judged by `rebuildDiff()`, which is shared with
the course.

**The lessons are the game with one thing taken away.** `screen-lessons` (the
LESSONS section of the script, `LSN`, reached from LESSON → How to Play Blind
Chess) is a ten-lesson course, and it is deliberately made of the game rather
than about it: the same square and piece classes, the same four visions,
`legalMoves()` refereeing every answer, and `parseMoveIn()` reading what is
typed into its console — so anything the console accepts in a lesson it accepts
in a game. `lsnRender()` is `render()` with `G` swapped for `LSN`, and it exists
only because `render()` reads `G` and a lesson is not a game. One function took
a parameter to make that possible — `visibleSet(s, me)` — and it still answers
the game with no arguments at all.

The ten are Know, Don't See; Lines and the Knight; Reading a Move; Reach and
Attack; Holding a Small Position; Updating: Where, and What Changed; Captures
and Counting; Check Yourself, and Get It Back; Calculating Short Lines; and
Playing Without the Pieces. Every one of them opens on something to do: an
introduction that is only an introduction has been taken out of each, and the
lessons that were *about* the game rather than made of it went with them.

**A lesson teaches once; the drill is where the second half happens.** Every
`LESSONS` entry carries a `train` block — a `mode` key, a `level` and the
sentence the card shows — and `lsnHandoffStep(L)` is the last step of all ten:
what to train now, and one button that opens it through
`goPractice({ mode, level })`. It is a step rather than a line at the foot of
the last exercise because the handoff is the point of the course, and
`lsnMark()` is called in its `setup()` rather than by `lsnNext()` at the end,
so a learner who reads the card and walks off to Practice keeps the tick:
reaching the card is finishing the lesson. `train` and `PR_FLOORS` are **two
tables asking different questions**, and collapsing them is the easy mistake:
`train` says where *this lesson* sends you next, and `PR_FLOORS` says, per
mode, which finished lesson raises the floor of that mode's *first* session
and to what rung. They disagree on purpose — lesson 8 hands to `tracker` level
7, where the checkpoint questions live, while `PR_FLOORS.tracker` is still
`{lesson:5, level:3}`, because a lesson may come back to a mode further up its
ladder without moving where a newcomer starts — and `PR_FLOORS` names modes
(`attack`, `hold`, `branches`) no `train` block hands to at all, since a lesson
that teaches two of them can only hand off to one.

**The course is built out of Practice's own generators, never a copy of
them.** A lesson's exercises are made fresh each time — `lsnStepColour` and
`lsnStepQuadrant` from `prMakeSquare()` at a named recipe, `lsnStepBetween` and
`lsnStepKnight` from `prMakeLines()`, `lsnStepAttackYesNo` and
`lsnStepHanging` from `prMakeAttack()`, `lsnStepCluster` and `lsnStepRebuild`
from `prMakeHold()`'s `question` and `rebuild` modes, `lsnStepChange` from its
`change` mode, `lsnStepAfter` from `prMakeAfter()`, `lsnStepCaptureSeq`,
`lsnStepCheckThree` and `lsnStepRecover` from `prMakeTracker()`,
`lsnStepExchange` from `prMakeForcing()`, `lsnStepMate1` and
`lsnStepLineThenRoot` from `prMakeCalc()` and `prMakeBranches()`, and
`lsnStepMiniGame` from `prMakeProgressive(prRecipe('progressive', 1))` — so the
course cannot be learnt by heart, and a lesson and the drill it hands off to
cannot come to disagree about what the exercise is. `wantQ()` is the shared
retry around a generator that can fail an unlucky draw; a generator that
cannot produce one after two hundred tries throws rather than putting half a
question on screen. `lsnStepDemo()` is the other kind of step: it lights
squares, says something and waits for Continue, `gate:false` on purpose,
because a demonstration is read rather than solved and gating one is only a
click standing between the player and the thing being shown. What is fixed is
fixed for a reason — the ten notation forms have to show ten particular
shapes, `LSN_TEN_FEN` is the one position lesson 10's three vision demos share
— and `server/test_lessons.js` asks the page's own move generator whether every
fixed position in the course is legal.

**The player decides when the men go out, everywhere they go out.** A step that
takes the board away waits on a button — I'm Ready before a held position,
Hide the Board before a sequence — and never hides anything on a timer, because
a countdown tests reading speed rather than visualisation. The **Position**
card (`lsnPositionHTML()`) is the position said in words, in Fine's own order
— the king, what stands beside it, the pawns, then the rest — read off `LSN.st`
rather than written out beside a FEN, so a position that changes cannot end up
described as the one it used to be. It goes down with the board on I'm Ready,
since left up it is simply the answer key, and it is built again from the
position as it then stands when a step concedes.

**Lesson 10 is the game's own visions, previewed.** Three demos on
`LSN_TEN_FEN` — See the Board, Fog of War (named as what it is: a game vision,
not a step on this path) and Complete Blindfold — and then one small game.
That game is Progressive Blindfold's own first rung played once
(`lsnStepMiniGame`): three men a side, four moves, the learner's men shown and
the opponent's hidden, which is `LSN.mode = 'mine'` — Fog of War's men-only
mask with the square fog left off, the picture `pbMask(board, W)` gives
Practice, previewed on the lesson board rather than reimplemented there. Moves
go through `lsnAskMove(null, …)`, where any legal move is right rather than one
fixed answer, and the page replies at `pbReply()`'s own cadence. One checkpoint
interrupts after the second move — lesson 8's habit asked for real — and a
wrong square costs nothing.

**One gauge, and no second list of lessons.** The stage carries a labelled
progress line with a dot per lesson — done, current, ahead — and the dots are
also the way back into a finished one, on the same `lsnReach()` rule the ladder
uses. The old card of lesson links beside the board is gone: two maps of the
same course is one too many, and the one that was off the bottom of a phone was
the one nobody could see. The board took the room it freed.

Every transient thing a step owns is cleared by `lsnResetStep()`, which is the
only door into a step. That is what stops a half-played sequence running on over
the next lesson, and `showScreen()` calls `lsnLeave()` beside `prLeave()` on the
way to anywhere else. Nothing on the screen can collect a second listener: the
board has one delegated click handler installed at load, and every button strip
is rebuilt from nothing each time it is drawn. One trap worth remembering —
`.mark` already belongs to the review's move badges and is absolutely
positioned, so a lesson class has to be `.lsn-`something even when the plain
name looks free.

**The walk is the test, and it is answered by brute force.**
`server/test_lessons.js` boots the whole page and drives the course the way a
player does — presses the buttons, clicks the squares, types into the console —
and it is never told an answer. Every step factory tags itself with a `solve`
naming the *shape* of its question (`choices`, `select`, `typed`, `cluster`,
`rebuild`, `multi`, `changed`, `hanging`, `recover`, `move`, `square`, `none`),
and the harness's `solveStep()` dispatches on that tag to a strategy that works
the answer out from what is on the page: reading the two endpoints out of the
question's own sentence and asking `lineBetween()`, reading the Position card
the same way a player reads it, pressing choices until one is right. A step's
own `truth` field is for the page and is never read there — a solver that read
the answer off the step would stop being able to catch a factory that cannot
actually be solved. The check on the tags is containment rather than equality
(every tag the page writes has a strategy), because `lsnStepAfter` picks its
tag with a ternary and so carries tags (`attacks`, `loose`) that never appear
as literal text in the file. The walk also counts itself — every step it
passed against every step the ten lessons said they had — so a step that was
silently never reached fails even when nothing else complains. A new step kind
therefore needs a `solve` tag and a strategy in that harness, plus its own name
— and any Practice generator it borrows — in the list the harness lifts out of
the page, the same way `test_practice.js` names everything it extracts in
`DECLS`/`FNS`.

**The course and Practice are two pages, and every crossing between them goes
through the other page's own front door.** They cover related ground — a coordinate step in lesson 1 and Square
Trainer both ask you to name a square — and that is the point: the course
*teaches* the skill once, in order, and Practice is where it is *drilled*
afterwards, with levels and statistics the course has no business keeping. So
the course has no practice mode of its own; it hands off, and it hands off
through `goPractice(target)`, the same function LESSON → Practice calls — the
lesson's own handoff card, and the three buttons on the finished course's done
face: `#lsnGoTrain` (`goPractice()`), `#lsnGoProgressive`
(`goPractice({ mode:'progressive', level:1 })`) and `#lsnGoPlay`, which is
`lsnOpenVisionPick()` — `goBot()` plus `lsnNoteFirstGame()`, a line under the
Vision panel advising Board Only first and Complete Blindfold once Progressive
Blindfold's last level is behind you. It advises and chooses nothing, because
which vision to take is the one thing the end of the course must not decide on
somebody's behalf. The note is written there and nowhere else, and cleared by
`lsnFirstNoteClear()` from `resetChoices()`, which every route to the setup
panel passes through — so it lives exactly as long as the unanswered vision
question it is about and cannot stand over a friend challenge later. Back the
other way there is exactly one link into a *particular lesson*: a Practice
card's setup box carries "How this works: Lesson N" (`prDrawIntro`, reading
`m.lesson`) whenever that lesson is not in `lsnDone()` — first visit or not,
because the question it answers is "has this player been taught the concept",
and somebody three drills past the lesson that introduced this one is exactly
who it is for. Back to Lessons on a finished session's result box
(`#prToLessons`) is not a second one: it presses `lsnEnter()`, the course's own
front door, the same function LESSON → How to Play Blind Chess presses — a
button whose label names a page has to open that page, and the end of a
session is the moment somebody is deciding what to learn next rather than a
moment to be dropped on the home screen. The
two-line intro beside it (`m.intro`) is shown only on a mode's first visit,
since the level caption says the rest once there is a session to measure.
There is one Practice screen, one `goPractice()`, and no third set of drills
anywhere.

**Lesson progress is local first, and kept apart from Practice's levels.**
`nox.lessons.<owner>.howto` in `localStorage`, keyed by owner exactly as the
puzzle ladder and `nox.practice.<owner>` are, so two accounts sharing a browser
cannot read each other's. The two records are separate on purpose: finishing a
lesson is something you did once and it stays done, while a practice level is
something you currently are and can fall. There is still no lessons table and
there is not going to be one for ten booleans — a signed-in player's copy rides
in `practice_progress` under the reserved mode name `course`, whose `stats` are
the finished lessons, and `lsnPush()` is where it goes (`prPushCourse()`, asked
for by `typeof` because that is the other side of a section boundary). The
record is a *version*: the course was seven lessons, then five, and is now ten,
so a stored record is read forward through as many maps as it needs on the way
in (`lsnNormalise`, `LSN_V1_TO_V2` then `LSN_V2_TO_V3`) and written back at v3
so the translation happens once. `LSN_V2_TO_V3` is `{1:1, 2:3, 3:4, 4:5}` and
deliberately drops old lesson 5, the first blindfold challenge: a lesson kept
is a lesson whose new form asks no more than its old one did, and new 10 asks
for a whole game with the men hidden, which is not something the old lesson 5
had anybody do. Ticking it would open the ladder on a lesson they have never
seen.

**Study Board and Puzzles are separate features that share one library.**
Study Board (`REV`, the review screen) explains *the game the player just
finished*: it is reached only from the end-of-game overlay, replays `G.uci`,
and never reads a puzzle file. Puzzles (`PZ`) are the five pools in
`puzzles/modes/*.json` — and the two board Practices in `practices/*.json`, and
the three legacy phase ladders `puzzles/*.json` behind them — each walked in
order, one rung unlocked by the last. What they share is
the explaining — `findMotifs()`, `see()`, and `describeBest()` as the fallback
card for a track written before `why` existed — which is why a puzzle tagged
`fork` is explained with the word fork. Keep the dependency one-way: `PZ` may
call the review's pure helpers, the review must never learn what a puzzle is.

**Study Board names concepts with the Education System, and runs its actual
code.** `judgeMove()` says whether a move was good; it cannot say what the
position is *about*, and its own comment admits it — "this is not chess
understanding, and it only ever claims what it can see". `education/` is that
missing half, and `THE EDUCATION LAYER` in the page is the wiring: `eduLoad()`
fetches `education/lib/{features,matchers,analyze}.js` and evaluates them
through a small CommonJS shim, and `eduChess()` hands them the page's own chess
under the names `tools/page_chess.js` uses. **It is the mirror image of that
file** — `page_chess.js` lifts the page's chess into Node so the tests can run
it; this lifts the tested library into the page so a player gets the same
answer. The page carries no copy, and `server/test_study_education.js` asserts
the two agree byte for byte on the same position.

The corpus cannot be walked from a browser, so `education/tools/build_bundle.js`
flattens the 137 records and the warnings index into
`education/dist/education-bundle.json` and `setKnowledge()` hands it back.
**Nothing is trimmed on purpose**: a bundle carrying a subset would silently
change what matches, and `education/tests/test_bundle.js` is what would license
a trim — it asserts the bundle is fresh and that analysing through it is
byte-identical to analysing through the filesystem. Regenerating means bumping
`EDU_VERSION`, exactly as regenerating a puzzle ladder means bumping
`PZ_VERSION`.

The division of labour is the whole point and runs both ways: **Stockfish
decides whether a move works and is never asked to name an idea; the knowledge
base names the idea and is never asked whether the move works.** The API
enforces its own half — with no engine result it refuses to assess the move, and
it will not reach for the nearest label when nothing matches. `#conceptCard`
shows that refusal rather than hiding it, because "nothing here matches a
researched concept" is a true answer and a guess dressed as a concept is not.
Do not add a fallback.

`eduAnalyse()` is called from `reviewRender()` **above** the four `quiet()`
returns, because all four are about the engine — it cannot run, it is starting,
the game is over, the search has not answered — and none of them is a reason to
stop naming what is on the board. The whole feature is additive: a failed fetch
leaves `EDU.ready` false, `#conceptCard` hidden, and Study Board exactly what it
was. That path is the default in the test suites, whose `fetch` stub answers 404
to everything.

**Puzzle Rush borrows the game's clock.** `tickClock()` and `renderClocks()`
each grow one branch for `RUSH.on`; there is no second timer. `rushClock()` puts
that clock in the *top* strip itself rather than letting `layoutBoardBars()`
file it by seat — a puzzle has no seats, and a clock that changes ends whenever a
black-to-move puzzle comes up looks like a clock that has been reset. A run never
records ladder progress and never moves the rating — it reads the rating to
choose where to start and nothing else. It is the fifth door on the same menu
as the four ladders, and it is dealt from **its own pool** — `pzFetchMode('rush')`,
the loader all five doors share. It used to flatten the three legacy phase files
instead, which is the whole corpus, so every position in a run was also behind
one of the four ladders and "non-overlapping" stopped at the door. `rushQueue()`
takes that pool as a list, sorts it easiest first and rotates it to the player's
own rating, wrapping rather than stopping. Rush is also the one door that is
only a pool: `PZ_MODES` gives it no vision, so `rushStart()` names `sighted`
itself rather than inheriting whatever the last puzzle happened to be, and Run
Again keeps it.

**`tools/` is offline, and reads the page rather than copying it.**
`tools/page_chess.js` cuts the named declarations out of `blind-chess.html` and
evaluates them in Node, so the puzzle generator tags positions with the same
code the browser explains them with. `tools/sf.js` drives the vendored engine
in a forked process (Node needs `delete global.fetch` and a cwd of `engine/`,
both explained there). Renaming anything in that file's DECLS/FNS lists breaks
the tools loudly, which is the trade for having one implementation.

**Three engines, and which one answers matters.** `engine/` is the vendored
pre-NNUE WASM Stockfish: one thread, 16MB of hash, and it is what the *browser*
runs. The bot ladder in `LEVELS` was tuned against it, so anything imitating a
rung — `seedRating()`, and the self-play games the generator mines — must keep
asking it, because a difficulty measured against an engine the player never
meets is a difficulty for nobody. The **judge** is the native `stockfish` on
PATH (Stockfish 18, NNUE, as many threads and as much hash as it is given):
nothing about whether a puzzle is *correct* should be decided by a build chosen
for fitting in a web page. `tools/sf.js` has both behind one `ask()`, and
`Pool(n, {native:true})` picks. Callers that need the browser's engine ask for
it by name — see the two pools in `main()` in both tools.

**Two engines in the page.** `blind-chess.html` contains a small negamax/alpha-beta search
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

**A verified player's name comes from their profile row, or failing that the
token, never from the message** — otherwise signing in would be a way to wear
someone else's name. `clean_name()` (3–25 chars, `[A-Za-z0-9 _-]`, at least
one letter) is applied server-side even to token metadata, because that
metadata is writable through Supabase's own API. Guest names go through the
same rule.

**One name per player, across the whole server, guests included.** A name is
what the other player reads across the board, and two boards that both say
"Alex" are two boards lying to somebody — so there is one namespace for
accounts and guests together, and it is enforced in three places that each
cover what the others cannot. `supabase-migrate-usernames.sql` (run once, by
hand, like the other SQL files) puts a case-insensitive unique index on
`profiles.display_name` and adds `username_available()`, which the username
screen asks as you type and again on Continue; the screen now writes the
profile row *before* the token, because the row is the copy that can say no,
and reads a unique violation as "that name is taken". The server keeps
`names`, a registry of every name in use on it, claimed under the lock in
`handle_hello()` by `claim_name()` and released by `drop_client()` or the next
hello — an account holds its name across every tab, a guest for one socket.
With a service key the server reads the name off the profile row
(`supabase_db.get_display_name()`), since the token's `game_name` is metadata
the account can write for itself and so cannot be the authority on a name that
has to be nobody else's. A guest whose offered name is taken — or who offers
none, or a name that fails the rule — is minted a fresh `Guest-#####` and told
in the `welcome`, which the page adopts as its guest name; first come, first
served, except that an account's name is the account's, and a guest found
wearing one is renamed and sent a second `welcome`. An account whose name a
different account already holds — which only two profiles that agree on a name
can bring about, and the index exists to prevent — plays under its placeholder
(`player_` + eight characters of its id) until the other signs off, because
there is no fair way to choose between two accounts and there is between an
account and a guest. `test_names.py` walks all of it without a server.

**`supabase-social.sql`** is the second hand-run file, after
`supabase-setup.sql` (and `supabase-system-profiles.sql` the fourth, after
both — see the system profiles above). Friendships are **one row per pair**, stored sorted
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
grants — the puzzles and visions files each restate them for exactly that
reason.

## Working in blind-chess.html

Navigate by the `/* ==== TITLE ==== */` banners in the script — THE SKY,
CONSTANTS & HELPERS, MOVE GENERATION, ENGINE, GAME / UI STATE, CLOCK, SOUND,
COMPLETE BLINDFOLD, PLAYING MOVES, ONLINE PLAY, RESIGNING…, THE ENGINE, THE
REVIEW, THE EDUCATION LAYER, THE PUZZLES, STUDY ALTERNATIVES, THE LESSONS,
CONTROLS, PRACTICE, SCREENS, HISTORY, ACCOUNTS, THE LIVE LEAGUE, SPECTATING,
SOCIAL.

The two biggest of those carry sub-banners, and one suite is anchored to where
a section starts and stops. THE LESSONS runs through THE LESSON BOARD, THE
STAGE, THE GENERATORS, THE TEN LESSONS and four banners named for the lessons
whose step factories sit under them (THE STEP KINDS LESSONS 1–3 ARE BUILT OUT
OF, and the three that lessons 4 and 5, 6 and 7, and 8 and 9 add). Those
headings used to be named after the tasks that built them — THE FIVE for a
course that is ten lessons long, TASK 30a/31/32/33 for batches of step kinds,
THE SIX DRILLS for eleven — and each now says what it holds, so the heading
can be read instead of counted past. PRACTICE runs from its own banner through
THE ELEVEN DRILLS — generation, RUNNING A DRILL, PROGRESSIVE
BLINDFOLD, A SESSION, START TO FINISH and THE DASHBOARD, and ends where
SCREENS begins: `test_practice_flow.js` lifts exactly that span, so anything
Practice needs at top level has to live inside it.

Screens are `<section class="screen" id="screen-NAME">` toggled by
`showScreen(name)`; `screenName` is the current one and several handlers branch
on it.

**Every page is a browser history entry, and `showScreen()` is where it is
written.** The page is one document, and for a long time that meant Chrome's
Back button knew nothing about it: from three pages deep in Nox it went to
whatever site came before. The HISTORY section fixes that with the smallest
thing that fits — no router, no URLs on the server (`STATIC_FILES` is an
allowlist, and a path like `/ranked` would 404 on refresh), just
`history.pushState` with a hash naming the page (`#ranked`, `#friendly`,
`#lessons/3`, `#lessons/done`, `#practice/tracker`, `#puzzle` (the setup page),
`#puzzle/fog`, `#puzzle/practice-opening`, `#play/bot`,
`#game/ranked`) and a `popstate` handler. A drill's entry is the
mode's own key with the level and the length riding in the state beside it, so
`navApply()` re-enters it through `goPractice()` and then `prOpen(key, level,
minutes)` — the same door the Quick button and the course's handoff use. The one address that is a path
rather than a hash is the spectator page, `/spectate/<id>`, because the
server serves the page for it; `navPath()` writes it and puts `/` back on
the way off. The rule is
*describe, compare, push*: `navSync()` reads the page the globals say we are
on (`navDescribe()`) and pushes only when that differs from the entry we are
standing in, so a re-render, a rematch, or the next puzzle in a ladder only
refreshes the entry and never duplicates it. `showScreen()` calls it last;
so do the three view switches that are pages in their own right — a lesson
(`lsnShow`/`lsnHub`/`lsnFinish`), a drill running (`prBegin`/`prShowDash`)
and a league game being watched (`specOpen`/`specLeave`, the SPECTATING
section, which pushes nothing itself). A step within a lesson
is not a page: it refreshes the entry, so a refresh comes back to the step and
Back does not walk every step twice. `showScreen(name, 'replace')` is for
redirects — the username gate and "signing in finishes the login page" — so
that Back is not a way past them.

Arriving from history (`navApply()`) goes through the functions the buttons
call — `goSocial()`, `enterRooms()`, `goPractice()`, `lsnEnter()` — because
most screens need more than showing, and it first does what the screen's own
Back button would have done on the way out (`leaveRooms()`, `stopHosting()`,
`netClose()`). While that runs, `navRestoring` makes every `showScreen()`
replace instead of push and mutes `beep()`, which is what makes a loop
impossible. The one page that cannot be re-entered is a game somebody else
started — the server's pairing starts a ranked, friendly or challenged game,
and Back cannot ask it to again — so a dead game entry is stepped over on the
way back (`history.go(-1)` once more) and, forwards, replaced by the page
where that kind of game is arranged, the rule New Game already follows. A bot
or local game's entry *is* the setup beside the board, and a puzzle's re-opens
the ladder where it stands. A game in progress is protected exactly as the
wordmark protects it: Back opens the leave box, the history is put back
(`history.go` the other way, held in `NAV.pending`), and Confirm finishes the
refused step rather than going home. `gameLive()` is the wordmark's test,
shared. Pages a guest is sent to sign up for are gated on arrival too
(`navGated()`), and at boot such a route waits for the account to be known
(`navSettled`, after `initAuth()`); `navBoot()` leaves the URL untouched on
purpose, because Supabase reads its own token out of the hash after Google.
None of the test harnesses has a `history`, and under them the whole layer is
inert (`NAV.hist` null) — `test_practice_flow.js` stubs `navSync` because it
lifts the PRACTICE section on its own. A puzzle's address is the door it came
through, written by `pzRoute()` and read back by `navApply()` through
`PZ_MODE`, `PC_CAT` and `PZ_TRACKS` in that order — see "Five doors" above.
There is only one account cluster (`#headRight`), and `showScreen()`
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
inline. The first three are also the three puzzle visions, under different
names on the cards; `PZ.vision` is written straight into `G.mode` by
`pzOpen()`, so anything added to `render()` for one of them is added to a
puzzle with it. `AI_MATCH()` is an ONLINE() game with a bot on the far side: it
is not `BOT()`, which is the Play Bot ladder and a different screen entirely.

**The social page** (`screen-social`, the SOCIAL section of the script) is two
things that only meet on screen: friends and friend requests are Supabase rows
the browser reads and writes directly, kept fresh by a realtime subscription
with a slow poll behind it as a fallback; challenges are messages on the game
socket. The challenge *form* is the Play Bot page — the same `#gameSetup`
panel beside the same board, with `CHALLENGING()` hiding the bot ladder,
renaming Start Play to Challenge, and `NET.opponent` naming the friend on the
strip above the board. `CHAL` holds the invitation in flight from either end.

The rating under a name on that page is the leaderboard's, not the row's.
`profiles.rating` is the Sighted column and only that, so a search for one of
the system profiles seeded onto the three vision ladders used to print "100
Elo" under a name the leaderboard had just shown at 2673. `socialElo()` asks
`ladderStanding()` first — which of the four ladders the home page has drawn
this id on, answered for the one they stand highest on, the higher rating
breaking a tie — and prints that number, naming the ladder unless it is the
Sighted one; only somebody on no ladder is shown their own `rating`. It reads
the rows already loaded rather than querying again, so the two pages cannot
disagree about who is on the board, and `goSocial()` asks for any ladder
still missing and redraws when it lands. `test_leaderboard.js` covers it.

**A man is moved by clicking twice or by dragging, and the two are one rule.**
The click handler on `#squares` was the only way to move on a drawn board;
the drag beside it (the `clicks, and drags` section, `DRAG`) is pointer
events — the press on the board, the travel and the drop on the document —
and it goes through the same two functions the click does: `boardOpen()`
says whether the board takes a move at all, `tryMove(from, to)` says whether
from→to is one, flashes the square and, in a puzzle, says why not. A press
that travels under `DRAG_SLOP` is left to the click that follows it, so
click-to-move is untouched; a press that travels further selects the square
exactly as a first click does (ring, and in Sighted the hints) and the drop
is the second. The browser's own click after a drop would select the landing
square, so it is swallowed on a flag that lasts one tick (`DRAG.swallow`) —
one tick because a cancelled drag has no click coming and a flag that waited
for one would eat the next real click. Two things about how it is written
matter. There is **no pointer capture**: a captured pointer's click is
retargeted to the capturing element, and the click handler, looking for the
square under it, found the whole board instead — click-to-move stopped
working the moment a drag had been made, which the shim could not show and
headless Chrome did. And only a man that is *drawn* is picked up and drawn
moving — the viewer's own, on a board that shows them — because a hidden
man sliding to its square would be a peek; the drag of any other square still
selects it and the drop is still judged, so See the Board drags exactly as it
clicks, with nothing to see. `renderPieces()` leaves the man in the hand
where the pointer has it, since a render mid-drag (the selection ring) would
otherwise slide it home. `.squares` gives up `touch-action`, which is what
lets a finger drag on a phone instead of scrolling the page.
`test_drag.js` drives the pointer events under the DOM shim.

There is deliberately no undo, no take-back, and no move history during play.
Don't reintroduce them.

## Code style

Comments in this codebase explain *why*, often at length, and several encode
decisions that are easy to undo by accident (the guest-name rule, the
`?v=` cache-busting, `finish_game()` clearing `client.game`, `maybeSingle` over
`single`). Match that register rather than trimming to terse one-liners, and
when you change one of those decisions, update the comment that argues for it.
