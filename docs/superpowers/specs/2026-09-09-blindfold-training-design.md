# Blindfold Training System — Design

Approved in brainstorming on 2026-09-09. This is the design the implementation
plan argues from. It covers three things that form one path:

    How to Play Blind Chess (course)  →  Practice (eleven modes)
                                       →  Progressive Blindfold (a Practice mode)
                                       →  a real blindfold game

The course teaches a concept once. Practice trains it with generated ladders.
Progressive Blindfold lives inside Practice and is the bridge to the game's own
two blindfold visions. Nothing here touches ranked, puzzle or league ratings.

## 1. Research findings the design rests on

Strong (several independent studies, or unanimous champion testimony):

- A held position is relational knowledge, not a picture (Binet 1894; Fine
  1965; Hearst & Knott 2009 ch. 10; Koltanowski). Copy must say "hold" and
  "know"; no exercise may require imagery to succeed.
- Chunks are anchored to absolute squares (Saariluoma 1994; Waters & Gobet
  2008) and come from real chess: masters recall game positions ~90%, random
  ~60%, four random ~10% (Saariluoma 1989). Coordinates are a floor; random
  positions are not training material past small counts.
- Flash-memorising an unfamiliar position transfers weakly: masters replace
  ~68% of 26 men after a minute (Gobet & Simon 2000).
- Recall is organised by function: king first, then attackers and defenders
  of the king, then structure (Saariluoma & Kalakoski 1998; Fine 1965).
- Legal move sequences are tracked by rule: masters held positions almost
  perfectly after 15 dictated moves of real *and* random-legal games, <20% for
  illegal ones (Saariluoma 1991). The start position is the easiest anchor
  (Tisdall; Soltis).
- Diagonals and knights are the costly geometry (Church & Church 1977;
  Milojkovic 1982; Gruber 1991; Waters & Gobet 2008).
- Grandmasters blunder no more blind than in rapid play (Chabris & Hearst
  2003); the ceiling is calculation.

Moderate (one pilot study, or consistent coaching literature):

- Blindfold-tactics training transfers (Marchesich & Tamburini 2023, n=27
  with control). Stepping stones (Tisdall 1997). Empty board before console
  (Krogius, Soviet method). Geometry first (Koltanowski, Kavutskiy).
  Verbal from-to notation as a scaffold (Krogius). Captures ("ghost pieces")
  and piece counts as the beginner failure and fix (practitioner consensus).

Design judgment, consistent with the above but untested: Branches as its own
mode, Forcing Lines as its own mode, every level ladder, the staircase
parameters, checkpoint frequencies.

## 2. Skill model

| Group | Modes | Depends on |
|---|---|---|
| Board | Square Trainer, Lines & Routes | — (a floor; exit on automaticity) |
| Vision | Piece Vision, Attack Vision | Board |
| Holding | Hold the Position, Move Tracker | Vision |
| Updating | After the Move, Forcing Lines | Vision, Holding |
| Calculation | Blind Calculation, Branches | Updating |
| Play | Progressive Blindfold | everything; soft |

## 3. The eleven Practice modes

Every mode has a level ladder. A level is a recipe of concrete variables, and
the level number is what the player sees ("Move Tracker · level 4 · two pieces,
four moves"). Difficulty inside a session is a staircase: three right in a row
steps up, two wrong in a row steps down; the level a session settles on is the
mode's measured level. Accuracy is kept per level as a secondary figure.

Mode keys (stable identifiers, used by storage, routes and tests):
`square`, `lines`, `piece`, `attack`, `hold`, `tracker`, `after`, `forcing`,
`calc`, `branches`, `progressive`.

### square — Square Trainer (Board)
Name, find and colour squares; neighbours; quadrants; from either chair.
Levels 1–7: labels on / labels off / colour with board / board flashed 1 s /
no board, colour and neighbour from the name / Black's chair / timed 3 s.
Extra measure: median response latency of the last 20 answers; "automatic" =
under 1500 ms at level ≥ 5. Once automatic the recommender stops suggesting it.

### lines — Lines & Routes (Board)
Squares between two squares on a rank, file or diagonal; both diagonals
through a square; can a slider reach with a blocker; fewest knight moves and
the route. Levels 1–8: straight lines with board / diagonals with board /
straight from the name / diagonals from the name / lines through a square /
blockers / knight routes with board / knight routes from the name.

### piece — Piece Vision (Vision)
Where one piece reaches. Levels 1–8: K R B N on an empty board / Q and P /
one or two blockers / crowded, captures answered separately / piece shown 2 s
then hidden / notation only, squares typed / two pieces, union of reach.
Pinned pieces are thrown back (as today). Feedback: missed and wrong squares
in two colours, then the true set.

### attack — Attack Vision (Vision)
Levels 1–9: does X attack Y / attacked squares as clicks / one blocker /
attackers of a square, 3–4 men / defenders / hanging piece / pins / notation
only 3 men / notation only 6 men. King-zone questions ("what attacks the
square beside the king") appear from level 4. Feedback draws the rays.

### hold — Hold the Position (Holding)
Small realistic positions, encoded by structure. Men 2→3→4→6→8→10→12, study
time 8 s→4 s. Three answer modes by level: question (where/what/count),
spot-the-change (show, hide, one move, show again: what changed), rebuild.
From level 4 positions are clusters cut from opening-derived game positions
(both kings plus men near one king), never random. Recall prompts follow
Fine's order: kings, what touches the kings, pawns, the rest. Levels 4–5
carry a "kings first, then pawns" hint; later levels do not. No level above
12 men. Feedback for rebuild: right / misplaced / forgotten overlays.

### tracker — Move Tracker (Holding; the spine)
Levels 1–12:
1 one piece, two moves, from-square lit as an aid, moves shown one at a time
2 the aid removed
3 start position, real opening, both sides, 2 plies
4 start position, 4 plies
5 small position, both sides, captures, "what was taken", material count
6 6 plies with captures, count
7 checkpoints every 3 plies (kings, count, last move), 8 plies
8 pawns, promotion, castling, checks
9 start position, 10 plies, list shown whole
10 14 plies
11 20 plies, checkpoints every 6
12 20 plies ending in a full rebuild
Early levels show one move at a time at reading pace; from level 9 the whole
list. Full from-to notation at levels 1–2, SAN after. Consecutive questions
never come from similar opening lines. Feedback replays ply by ply and stops
at the first ply where the player's answer became impossible, naming the
error type: wrong square, ghost piece (a captured man still counted), or lost
at ply k.

### after — After the Move (Updating)
Given a position and one move: which square emptied, what the piece now
attacks, what line opened through the vacated square, is anything now
hanging, is it check. Levels 1–8: one question, position shown / two
questions / position hidden after study / move as notation only / 6–8 men /
both a friendly and an enemy consequence. Feedback: board before and after,
opened line drawn.

### forcing — Forcing Lines (Updating; new)
A shown-then-hidden position and a forcing sequence; answer the material
balance, who stands on the contested square, whether it is check. Levels 1–8:
two attackers one defender on one square / equal counts / more men / checks
inside / two squares / notation-only position / 8-ply lines from opening-
derived positions / "and what is now hanging". Generated exactly with the
page's exchange arithmetic and move generator.

### calc — Blind Calculation (Calculation)
Levels 1–10: mate in one, K+Q and little else / hanging piece / fork or check
winning material / mate in one, more men / mate in two / shipped puzzle
positions of ≤12 men, studied 15 s then hidden / full puzzle positions /
3–5 ply lines with an end-state question / "given moves, then find the
tactic". Levels 1–5 are generated and verified by enumeration with the page's
own move generator and search; 6–7 reuse the verified puzzle files; if the
files cannot be fetched those levels fall back to generated positions and say
so. Feedback: the line played, and the refutation of a legal wrong move.

### branches — Branches (Calculation; new)
A root, a branch of n plies, a question at its end, then "back to the root:
what is on X", then a second branch. Levels 1–6: two branches of 2 plies,
root shown / three branches / 4-ply branches / captures inside / root hidden
after study / root reached by tracking first. Branches deliberately touch the
same squares. Feedback: root and branch end side by side, disagreeing squares
marked.

### progressive — Progressive Blindfold (Play)
Whole mini games on the practice board against the page's own search
(`bestMove`, depth 2), a single ladder:

| Level | Visibility | Material |
|---|---|---|
| 1 | Your men shown, theirs hidden, no square fog | 3 a side |
| 2 | Same | 5 a side |
| 3 | Squares only, unlimited peeks | 3 a side |
| 4 | Same | 5 a side |
| 5 | Squares only, three peeks | 5 a side |
| 6 | Same | 8 a side |
| 7 | Squares only, no peeks | 8 a side |
| 8 | Console only, three peeks | 5 a side |
| 9 | Console only, three peeks | 8 a side |
| 10 | Console only, three peeks | full start position |

Checkpoints every 3 full moves at levels 1–6 and every 6 at 7–10: one of
"where is your king", "where is theirs", "how many men each side", "what was
the last move", "what stands on X". Right continues; wrong shows the true
board for 2 s, counts a drift, continues. Recovery: an "I've lost it" button
shows the move list (never the board) and opens the rebuild interface; the
player places the men, sees what was wrong, plays on; counted as a recovery.
Peeks show the board for 2 s. A level passes at its move target (or game end)
with ≤1 drift and no illegal move. The end card shows moves, checkpoints,
peeks, recoveries, and the next level. Passing level 10 offers "Play a real
one", which opens the existing bot setup with Complete Blindfold (`total`)
selected, the bot rung defaulting to 1000, the slowest clock offered. From
level 7 the end card also offers a See the Board (`blind`) game. The mode is
always openable and starts at level 1; the recommender first suggests it when
lesson 10 is done or Move Tracker ≥ 5, Attack Vision ≥ 4 and Forcing Lines
≥ 2. The current Mini Blindfold Challenge folds into this mode.

## 4. Sessions, measurement, recommendation

- Session shapes: Quick (2 min, one mode at your level), Daily (5 min mixing
  three modes the recommender picks), Focused (one mode; 2, 5 or 10 min).
  Streaks count days practised. Questions are deduplicated against the last
  100 question signatures per owner.
- Per mode: `level`, `best`, `asked`, `correct`, `sessions`, `lastAt`,
  `stats` (latency samples for Board; clear-to-ply depth for tracker,
  forcing, calc; error counts by type; Progressive Blindfold's per-level
  results).
- Group score = mean of its modes' levels. Readiness line: six groups with
  milestones; "first real blind game" suggested at tracker ≥ 9, hold ≥ 7,
  calc ≥ 5, progressive level 5 passed.
- Recommender (a rule): among modes whose prerequisites (group order) are met,
  prefer the one furthest behind the path, then the longest unpractised, then
  the next stage; phrased as a concrete next step, never a weakness. Board
  modes drop out once automatic. Course completion supplies the floor for a
  mode's *first* session and the "Lesson N explains this" line; it never
  raises a measured level.
- The global five-name ladder (Beginner…Advanced) is removed.

## 5. Persistence

`practice_progress` table, one row per (user, mode): `level int`, `best int`,
`asked int`, `correct int`, `sessions int`, `stats jsonb`, `updated_at`.
Row-level security: owner reads and writes their own rows; nothing else reads
it. The course's completion is a row under the reserved mode key `course`
with `stats = {"done":[1,3,…]}`. localStorage is the cache and the whole
store for guests; sign-in merges the guest record into the account (higher
level wins; asked/correct take the larger record; course done is a union) and
clears the guest copy, exactly as puzzle progress does. Migration file:
`supabase-migrate-practice.sql`, hand-run, safe to re-run;
`tools/check_supabase_practice.py` proves RLS against the real project.

## 6. The course: How to Play Blind Chess, ten lessons

Each lesson: a two-line idea, a demonstration on the lesson board, a guided
example, three to five generated quiz items, a plain gate, and a handoff card
naming one Practice mode, a level and a target sentence. No levels, no
statistics, no repetition in the course. Only fixed content is the ten
notation forms, a few small positions and the opening lines; the lessons test
checks every fixed position is legal and every task finishable.

| # | Lesson | Teaches | Handoff |
|---|---|---|---|
| 1 | Know, Don't See | orientation from both chairs, colour rule, quadrants, "you need to know, not see" (Koltanowski quote) | square, level 2: "until squares come in under two seconds with the labels off" |
| 2 | Lines and the Knight | rank/file/diagonals through a square, bishop colour, knight geometry and routes | lines, level 2: "until both diagonals through any square and a two-move knight route come from the name" |
| 3 | Reading a Move | from-to notation first, then SAN; captures remove; castling moves two men; disambiguation; one typed move | tracker, level 1: "levels 1 and 2 until a written move lands first time" |
| 4 | Reach and Attack | reach with men hidden; blockers; attack = defence read the other way; hanging | piece level 2 and attack level 2: "Piece Vision to level 4, Attack Vision to level 4" |
| 5 | Holding a Small Position | start position + 2 plies; a 4-man cluster in Fine's order; the Position card | tracker level 3, hold level 2: "Tracker 3–4 until four plies from the start feel steady; Hold to level 3" |
| 6 | Updating | vacated square, opened line, new attacks, now-hanging; first item is spot-the-change | after, level 2: "After the Move to level 3" |
| 7 | Captures and Counting | capture = removal + move; running count; exchange counting on one square | forcing level 2, tracker level 5: "Forcing Lines to level 3; Tracker 5–6" |
| 8 | Check Yourself, and Get It Back | the three-question check; rebuild from the move list, never guess | tracker level 7: "Tracker 7 and up until three sessions with no drift" |
| 9 | Calculating Short Lines | forcing moves first, one line, a stone at its end, back to the root | calc level 2, branches level 1: "Calculation to level 3, then Branches level 1" |
| 10 | Playing Without the Pieces | the visions, the peek economy, how a first blind game goes; one guided mini game (your men shown, 3 a side, one checkpoint) | progressive, level 1 |

Old five-lesson record maps into the new numbering as {1→1, 2→3, 3→4, 4→5};
the old challenge lesson (5) has no equivalent and is dropped. Lesson 10 ends
on three buttons: Continue training (Practice at the recommender's target),
Start Progressive Blindfold (Practice, `progressive`, level 1), Play a
blindfold game (the existing Choose Your Vision screen with the BLINDFOLD
card split open and a note recommending See the Board first). The current
button that preselects Complete Blindfold is replaced.

Retained from today: the coordinate set from both chairs, the ten notation
forms, the reach drill with men hidden, the tracking generator, the Position
card (reordered to Fine's order), the dot gauge, generated-not-written, the
legality checks in the test. Removed: random-position tracking as course
content, the eight-ply sequence, "the rest is repetition".

## 7. Course ↔ Practice contract

- `goPractice(target)` is the one door into Practice; `target` is
  `{ mode, level }`, `'daily'`, or nothing.
- A finished lesson sets a floor for the linked mode's *first* session only
  (`PR_FLOORS`), never a measured level.
- A Practice card's first-visit intro carries one link, "How this works:
  Lesson N" (`m.lesson`), the only door from Practice into the course. The
  CLAUDE.md sentence that says neither page is a door into the other is
  updated to this rule.
- Course completion is understanding once; Practice level is skill now.

## 8. Constraints from the codebase that shape the plan

- `server/test_practice_flow.js` lifts the whole PRACTICE section between its
  banner and the SCREENS banner; all Practice code, including Progressive
  Blindfold, must stay inside that section, and every new top-level name it
  needs must be extractable.
- `server/test_practice.js` extracts declarations and functions by name
  (`DECLS`/`FNS`); renamed or added generators must be added to those lists.
- `server/test_lessons.js` boots the whole page and brute-forces every step;
  every new step kind needs a solver in the harness.
- Two boards exist on purpose (practice board, lesson board). The rebuild
  *diff* is one pure function shared by both; each screen keeps its own
  board and click handling.
- The existing opening book (`LSN_BOOK`, `lsnBookMove`) moves to the shared
  helpers as `OPENING_BOOK` / `bookMove` so Practice and the course use one.
- Static assets are an allowlist; no new served files are needed (opening
  lines are data in the page). The puzzle JSON files are already served.
- The vision picker is opened through the existing `goBot()` + setup screen;
  splitting the BLINDFOLD card open uses the existing `#cardBlind` active
  class.
