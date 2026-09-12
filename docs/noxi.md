# Noxi

Noxi is the official Nox Chess assistant. The first integration uses the existing `assets/characters/nox-guide-explaining-v1.png`, unchanged. No generated replacement or external dialogue service is involved.

## Reusable dialogue

The NOXI section in `blind-chess.html` owns `noxiDialogue(host, options)`. Options are `message` or `sequence`, `layout` (`intro` or the default compact row), `actionLabel`, and `onAction`. It returns the root, message and action elements plus `setMessage(text)` for later updates. The renderer only handles presentation and sequence navigation; chess and account logic live in separate functions. Text uses `textContent`.

## Study Board

`reviewRender()` calls `noxiStudy()` for the selected move and refreshes it when engine analysis arrives. `noxiStudyText()` consumes the played move, before/after positions, the existing `findMotifs()` results, and the existing classification code. It maps known motif tags to short conversational descriptions, with factual move descriptions as fallback. Classification can add a qualitative caution without changing any chess calculation.

Noxi does not consume motif prose, engine variations, `describeBest()`, educational free text, numerical scores, or verdict labels. Those sources can legitimately contain suggestions or evaluations, so they cannot leak into the controlled dialogue. The original engine and education details remain in separate expandable sections; classification badges and review arrows are unchanged. The character remains in normal document flow at narrow widths.

## First-name introduction

The existing username submit handler saves `noxi_intro: pending` alongside `game_name` through `sb.auth.updateUser()` only when the account has no chosen username and no previous Noxi state. A named account with no Noxi metadata is never enrolled retroactively. `setAccount()` reads this state from Supabase `user_metadata`.

On the homepage, a pending named account sees the three specified messages. Showing or skipping the introduction records `seen`; Start Learning records `completed`, closes the dialog, and calls the existing `lsnEnter()` entry point (`#lessons`, How to Play Blind Chess).

The browser also stores `nox.noxi.intro.<account-id>` in localStorage, with an in-memory fallback if storage is unavailable. This suppresses repeated renders and reloads when the account write fails. Supabase writes are serialized and recheck account identity before sending. If Supabase is unreachable, suppression is only guaranteed on that device until account persistence succeeds; cross-device persistence requires a successful account write. The dialog traps keyboard focus, makes the homepage inert, and supports Escape and Skip introduction.

No database migration or manual Supabase configuration is required. User metadata is already used by the username flow; no profile column, grant, or policy changes are needed. The server allowlists the PNG; the existing Docker `COPY assets/` includes it.

## Verification

- `node server/test_noxi.js`: whole-page harness, real username submit, all intro steps, existing lesson navigation, reload and skip suppression, rejected usernames, failed/deferred persistence, identity changes, played-move dialogue, and retained classifications.
- Existing review, Study Board education, lessons, rematch flow, leaderboard, and image-file suites.
- Browser verification with simulated accounts (no real-account writes), real Stockfish Study Board analysis, desktop and 390px layouts, focus trapping, returning-home behavior, and loaded character images.
- Actual server HTTP response compared byte-for-byte with the existing PNG.

Implementation is local; deployment is a separate action.
