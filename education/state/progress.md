# Education System — Progress Log

Newest entry first. `state/research-state.json` is the machine-readable version;
this file is the narrative, and records reasoning that does not fit in JSON.

---

## Session 8 — grounding seven concepts, and four bugs that came with them (2026-09-01)

The brief was narrow and right: the blocker is validation DEPTH, not research,
and seven named concepts had no human grounding at all — initiative, king safety,
centre control, static-vs-dynamic, piece coordination, transformation of
advantages, and the pawn breakthrough.

All seven now have it. The corpus went from 6 positions and 2 games to 18
positions and 9 games, 1908 to 2005, with roles that mean something: 13 positive,
3 ambiguous, 2 negative.

### The method mattered more than the count

Annotations first, positions second. For each concept the work was: find a
reputable human source that NAMES the concept for a specific move; take the game
score from a database rather than from the annotating page; replay it end to end
through `blind-chess.html`'s own move generator; and only then ask Stockfish.

That order is not fussiness. **Six of seven "full move order" listings printed by
one otherwise useful annotation blog failed to replay**, reaching an illegal move
somewhere between move 24 and move 36. Its prose is citable and its move lists
are not, and that is now in `tool_limitations` because it is the second time a
printed score has failed in this project.

The engine was asked to verify, never to name. It agreed on the move seven times
— including Keene's 18...Ne6 in Réti–Capablanca, which it puts 0.39 clear while
the move Capablanca actually played is outside its top three, and Wade's 38.a5 at
+9.17 with a principal variation identical to the line this base's own new
detector produces — and it disagreed three times. **All three disagreements were
kept.** Botvinnik says the initiative passes to Black at 20...Qc7 and the engine
still gives White half a pawn; that gap is the whole distinction between holding
the initiative and standing better, and an engine-filtered corpus would have
deleted it.

### Everything that broke, broke under the new positions

**A pawn with no neighbours was called backward.** Wade–Korchnoi 1960 has a black
pawn on e5 with no d- or f-pawn at all and a white pawn on e4 in front of it, and
Layer 3 reported it as a backward pawn — so the system's explanation of the most
famous breakthrough in the corpus led with "Black's pawn on e5 cannot advance".
Two causes: the "is it behind its neighbours" test returns false both when the
neighbours are all advanced and when there are none, and the advance square was
never checked for occupancy. A pawn with no neighbours is isolated; a pawn
blocked by an enemy pawn is rammed. Fixed at the detector, with a regression test
and two new false-positive traps on the record.

**The corpus checker scored negative examples backwards.** It had one rule — is
the annotated concept the API's lead — which scores a NEGATIVE example as a
success exactly when the system has failed it. The bug was invisible while every
entry was positive and went live the moment one was not. Three roles, three
standards now.

**And then both negative examples passed for the wrong reason.** They passed
because neither concept had a matcher: nothing could have reported them. A
negative example for an undetectable concept is not evidence of anything, and the
checker now prints "vacuous — nothing could have reported it" instead of a tick.
Writing a `king-attack` matcher turned one of them into a real test, which it
passes: in Adams–Kasparov 2005 after 21...Kxh7 every mechanical sign of a winning
attack is present — opposite-side castling, the pawn storm arrived, the shield
gone, two rooks on the files at the king — and the API declines, because exactly
one piece bears on that king's zone and White is the one being mated.

**Raw attacker counts misread the centre.** On Réti–Capablanca, 18...Ne6 makes
Black's raw attacker count on the four central squares FALL from 7 to 6, because
the arriving knight blocks a rook x-raying through its own bishop. Control is now
measured on pawns and minor pieces for the move-based arm. It still cannot tell
Ne6 from the game's N6d7, and that is written on the concept record rather than
tuned away — bending a measure until it separates two particular moves is how a
detector stops meaning anything.

### What was built

- Layer 3: `centralSquareControl()`, `kingZoneAttackers()`, `pawnBreakthrough()`.
  The last runs the rule of the square as a proof, and therefore restricts itself
  to pure pawn endings and says so.
- Layer 4: `center-control`, `king-safety`, `king-attack`, `pawn-breakthrough`,
  each implementing its record's stated conditions, including the thresholds the
  records give in words ("it is not worth reporting an attack below three
  attackers").
- Every threshold was MEASURED over the 788 shipped positions before it was
  chosen, and the measurement is in the source: centre 20.3%, king-attack 1.5%,
  king-safety by attacker count 1.1% of king-sides, by bare shield 12.4%,
  move-based centre 7.1%, shield damage 2.6%, breakthrough 0.0%.
- Concept deduplication in `matchAll()`, after two arms of one matcher printed
  `center-control` twice in a row at a reader.

### Two disagreements with the shipped puzzle generator, measured

The generator tags 86 positions `pawnBreakthrough` and **zero of them is a pawn
ending**; it tags 134 `kingAttack` and this base reports 12. Both gaps are the
concepts' own registered false-positive traps made numeric — the generator's
tests are `checks >= 2 or mated` and "a pawn push that creates a passer or hangs
itself", which are puzzle classifications and not definitions. Neither number
should move. The corollary is uncomfortable and worth keeping: **the 788 shipped
positions cannot validate a pawn-ending detector at all**, and will silently
report no false positives forever.

### A second pass, on concepts whose detectors had never met a human "no"

The list that matters is not "concepts without a counterexample" but "concepts
with a DETECTOR and without a counterexample" — everywhere else a negative
example passes because nothing could have reported it. Four more entries, from
games this session had already verified or could verify cheaply:

- **outpost, negative.** Smyslov–Botvinnik 1954 after 21.Nc5. A centralised
  advanced knight in front of an enemy pawn chain, and Botvinnik says twice in
  his own notes that it is badly placed: ...b6 challenges c5 and no white pawn
  defends it. The detector agrees and reports nothing. This is the corpus's
  first human-grounded negative for a concept the API can actually recognise.
- **doubled-pawns, ambiguous.** Nimzowitsch–Capablanca, St Petersburg 1914 —
  the game the literature uses to teach that doubled pawns need not be a
  weakness. Black has them and is +1.07, and the engine's best move is the one
  that presses the file they opened.
- **bishop-pair, ambiguous.** Havasi–Capablanca 1929: White holds the pair and
  the engine's first choice for Black, at +0.40, is 15...Na5 — the move that
  trades it off.
- **piece-activity, ambiguous.** Réti–Capablanca after 27...Qe5, the same
  position as the initiative counterexample and a gentler claim about it. The
  most active piece on the board belongs to the side that is two pawns worse.

Both new ambiguous cases are features the system reports and should report. The
wording already refuses to go further — "doubled pawns are a price, not a
verdict" — and that refusal is now tested against positions where going further
would be wrong.

### Where it stands

137 concepts, 190 sources, 98 validated positions, 22 corpus positions from 11
master games, 648 tests plus 250 API, 376 audit and 3276 explanation assertions,
all green, twelve audits clean. Against the corpus: 0 false negatives on concepts
that can be detected, 0 false positives, 3 of 3 negatives correct — two of them
non-vacuously. On the corrected human-grounding
measure — see below — four concepts clear every rung their own record allows.

### And then the ladder turned out to be flattering itself

The HUMAN-GROUNDED rung read 39 of 137, and its own definition in the same file
said "an annotated master position, NOT a mined one". The implementation
accepted any position carrying a named game and a historical origin, so 22 of
those 39 were grounded only on positions this system had found by running its
own Layer 4 over master games — positions whose own notes already said, in as
many words, that one of them "cannot by itself validate the matcher that found
it". The record was honest and the metric reading it was not.

Fixed by adding an `attributed_by` field to the position schema, set only where
a named human attributed the concept to that position, and the rung fell from 39
to 17. All 17 come from the annotated corpus; the same measure would have read 5
before this session. The looser count is still printed underneath the ladder,
because a drop that large should be legible rather than silent.

### Four more concepts through every rung their record allows

With the measure fixed, the cheapest real progress is a single annotated
position for a concept that already has everything else. Four of them:

- **king-activation** and **passed-pawn**, both from Capablanca–Tartakower 1924
  and both from one sentence of Chernev's: 35.Kg3, "Le roi s'amuse! The King is
  headed for f6, a square from which he can assist the White Rook in threats of
  mate, and also help the passed pawn take those last three steps." The move
  gives away two pawns with check, and Stockfish puts it **2.49 ahead** of
  anything else — the largest margin in this corpus.
- **rook-on-the-seventh**, Capablanca–Rubinstein 1928, 23.Re7, with the
  annotator saying what it is worth against a named alternative.
- **bad-bishop**, Rubinstein–Salwe 1908, the archetype: four of six pawns on the
  bishop's own colour in a structure the winner spent the game fixing.

The last of those produced a finding worth more than the rung. Traced ply by
ply, this base reports the e6 bishop as bad for exactly **ten plies** of a game
its annotator calls it bad throughout — and stops while the bishop's pawn share
is still *rising*, from 0.67 to 0.83. The cause is the `scope > 3` guard, which
exists to keep Suba's active bad bishop off the list and is what stopped this
base calling Nimzowitsch's blockading bishop bad. The guard is right and the
concept is momentary in a way its own record says it should not be. Recorded and
pinned at both ends by a test rather than loosened: raising the threshold would
restore two false positives to remove one false negative.

### Two more, and one grounding refused

**opposite-coloured-bishops** and **gambit** now have human grounding, and the
first of them cost more than it gave. Capablanca–Thomas, Hastings 1929 is an
opposite-coloured-bishop ending that Stockfish scores at **−5.06** with White a
single pawn up, because there are passers coming on two wings and one bishop
cannot blockade both. Asked about it, this base said *"Opposite bishops are
drawish in endgames"*. The record's own second exception — "three files of
separation between passed pawns usually wins" — was in its `exceptions` list and
in its master-level wording, and in none of the beginner, intermediate,
advanced, short or normal wordings, nor in the lesson line, which is what a
reader actually sees. All six now carry the condition, and the test written for
it does not forbid the word "draw", which would be the wrong lesson: it requires
the condition to travel with the claim.

**gambit** came from Botvinnik naming one in a world championship game, with its
author, its publication and its first practical test: "6.b4 A well-known pawn
sacrifice, recommended by Alekhine in the book of the New York international
tournament of 1924."

And one grounding was refused. A FIDE Master's lesson titled *The Backward Pawn
on the Semi-Open File* calls White's c3 pawn backward in Marshall–Tarrasch 1905
and explains it as "the b2 and d4 pawns sit on adjacent files blocking its
advance" — after a capture in which the b2 pawn *became* the c3 pawn, with c4
empty and attacked by nothing. This base's detector reports no backward pawn at
any ply of that sequence and is right by the definition its own record takes
from Wikipedia. Logged in `failed_research_attempts` and not added:
`backward-pawn` still has no human grounding, and it is better without one than
with a wrong one.

### The `level` parameter had never done anything

This one came out of a corpus position and is the largest user-facing fix of the
session. Letelier–Fischer, Leipzig 1960 is the game the literature uses to teach
that a pawn centre can be a target; this base measures White's central control
at seven attacks to two and Stockfish calls the position level. Checking how the
system worded that, at four reading levels, produced **one string four times**.

`analyzeWithEducation` accepts `level: beginner | intermediate | advanced |
master`. The README documents it. Every concept record carries four texts
written for those four readers — that is most of what the ladder's
EXPLANATION-VALIDATED rung measures. And `wordFor()` tried `by_depth[depth]`
first; every record carries all three by_depth texts; so the `by_level` branch
was **unreachable**. 137 records × 4 texts, written and never read by anybody,
for the whole life of the API.

`tests/test_explanations.js` had a comment saying *"Depth must actually change
the wording, and level must be able to"* — with an assertion under the first
half and nothing under the second.

Fixed by separating the two axes, which are different questions: depth is how
much to say and `compose()` already implements it structurally; level is who is
being told, and it now feeds the teaching half rather than the observation,
because the observation has to name the square and the level texts are general.
Two things came with it:

- `teachingSentence()` now prefers a sentence long enough to teach something.
  The advanced wording for `outpost` opens "Outpost in the modern sense." and
  the master wording with "Note which sense is meant." — both cleared the old
  twelve-character bar, and both were the whole of what an advanced reader got.
- A false-positive test banned the WORD "weakness" rather than the claim, and
  failed the new wording *"ask what the exchange bought before calling them a
  weakness"* — which is the opposite of the fault it guards. It now fails a
  sentence only when it asserts a verdict with no hedging cue.

Measured after: the wording varies by level on **99.3%** of the 788 shipped
positions, and beginner no longer gets a sentence about Nimzowitsch.

### Ranking and confidence, measured for the first time

Reporting a concept and burying it were scored the same. The corpus now
measures **rank** — for a positive entry the annotated concept is what a human
said the position is ABOUT — and the answer was **mean 4.9**, with six of twelve
sitting outside the six entries the API returns by default. Reported, and
invisible.

Two causes. The PRIORITY list called itself informativeness and had never been
checked against one: two-weaknesses fires on 72.5% of the 788 shipped positions,
weak-square 68.9%, open-file 55.7%, space 53.3% — and all four ranked ahead of
king-attack at 1.5%, backward-pawn at 1.9% and luft at 4.8%. And the comparator
took a rule its own comment states about the *headline* — a low-confidence claim
must never lead — and applied it to the whole list, so every hedged claim sank
below every confident one. Mean rank 4.9 → **2.6**, top-3 5 → 8, nothing outside
the six, and endgames keep their point.

### The hardest negative so far, and it needed an API change to write down

Nimzowitsch–Salwe, Karlsbad 1911, annotated by Nimzowitsch himself. His
dark-squared bishop on d4 **passes** this base's structural test for a bad
bishop — four of its own six pawns on its colour, a share of 0.67 against the
0.60 required — and it is the piece the whole game is built around, the
blockader he calls "a stout fellow". Only the scope guard stops the error, and
this base called that bishop bad before the guard existed.

Writing the claim down was impossible until now, because it is *per side*:
Black's bishop on d7 in the same game is bad in every sense and is correctly
reported five moves later. The API's `concepts_all` carried no `subjects`, so a
caller was told "bad bishop" and not whose. Fixed in the API, in the checker and
in the corpus schema, and a whole class of negative example became writable.

### Four more detectors, and one written, measured and thrown away

Forty-seven concepts have records naming a mechanical detector and no matcher.
Five of the best-grounded were built, each measured over the 788 shipped
positions before being accepted and each tested against the game its concept is
usually taught from — which is what caught the first one.

**`blockade` implemented half its own precondition.** The record says "an enemy
passed OR ADVANCING pawn"; the first version used Layer 3's existing
`blockadedPassers`, which is the passed half, and it did not fire on
Nimzowitsch–Salwe 1911 — the game the concept is named after, where the pawn
being blockaded is a backward e-pawn and Nimzowitsch's own note is that its
"immobility is now greater than ever". It now asks for an enemy pawn with no
pawn of its own ahead of it on the file, stopped by one of our **pieces**,
because a pawn stopped by a pawn is a ram and nothing is being spent. 27.3%.

**`battery` fired on 43% because it arrived nowhere.** Two rooks stacked behind
their own pawns satisfy the bare geometry and combine nothing. Requiring the
line to reach an enemy man or the enemy half: 24.4%.

**`sacrifice`** uses the page's own SEE-based `sacrificeSize()`, which is the
detector its record names — 28.9% with a move supplied, which is what a corpus
of tactical puzzles should look like. **`exchange-sacrifice`** requires the rook
to be winnable where it lands *by a minor piece*, and fires on 1.0% — including
Petrosian's 25...Re6, the game it is taught from.

And **`strong-square` was refused.** Written exactly to its record's two stated
preconditions it fires on **80.1%** of the 788 positions — the `semi-open-file`
failure this project has already made once — and it is a third name for a fact
already reported twice, since `weak-square` is the same square from the
defender's side and `outpost` is the same square with a piece on it. The
record's own note says an outpost and a strong point are really the same thing.
Removed rather than shipped, with the measurement on the record and a test that
keeps it unimplemented.

### The rules layer, which this system could never speak

Seven concepts — check, stalemate, insufficient material, the fifty-move rule,
en passant, promotion, castling — have records naming detectors that already
existed, and no matcher. A system built to explain chess could not say "this is
stalemate" or "the fifty-move count is at 92", which is the one class of claim
it can make with certainty. Two guards keep them from being noise: `castling` is
reported for the **move** rather than for the rights, which almost every opening
position has, and `en-passant` only when the capture is actually available,
because a FEN carries the target square whether or not any pawn can use it.

**And three test suites turned out to be asserting a missing detector as a
virtue.** `test_api.js`, `api_audit.js` and `test_explanations.js` all
demonstrated the "no forced label" refusal on **bare kings**, requiring that the
position license nothing at all. But bare kings is exactly where the most
certain statement in chess is available — neither side can force mate — and
saying nothing there is a gap, not a refusal. Adding `insufficient-material`
broke all three, which is the correct outcome. The refusal is a real principle
and is now demonstrated where it really applies: two kings and two blocked
e-pawns, a legal position in which no researched concept fits.

### Six more, and a record whose two traps had to be read together

`wrong-rook-pawn`, `opposition`, `loose-piece`, `discovered-check`,
`smothered-mate`, `seventy-five-move-rule`. Detectors 32 → 53 across the
session, of the 83 concepts whose records permit one.

The interesting one was `loose-piece`, whose record carries two warnings two
sentences apart: that "reporting every undefended piece would flag most
positions and teach nothing", and that "it only matters when a **forcing** move
can reach it". Written to the preconditions plus the obvious guard — is there a
move after which this piece can be won — it fired on **66.8%** of the 788
tactical positions and **40.6%** of the annotated master corpus, because
"undefended and attackable" describes most pieces. That is the first trap,
arrived at by ignoring the second. Requiring the move to be a check or a capture
brings it to 34.9% and 34.4%, and the agreement between two unrelated corpora is
the sign that it is now measuring the position rather than the corpus.

### Negatives aimed at the broadest detectors

The three newest detectors — `blockade`, `sacrifice`, `loose-piece` — had no
human grounding and no negative example at all, while firing on a quarter to a
third of positions. Hunting annotations that would break them found two bugs and
a missing piece of research.

**A false positive in a pure queen ending.** Lisitsin–Capablanca 1935 at move
52, and this base called White's queen a **loose piece**. The guard asked for a
forcing move after which static exchange evaluation says the piece is won, and
52...Qd2+ is a check that also attacks b2 — so SEE reported a queen won, while
White simply answers the check with Qxd2 and Black has won nothing. *The forcing
move has to survive being forcing.* Every queen in a queen ending is undefended
and attackable by the other one, which is the record's own first trap. 34.9% →
9.1%, and 34.4% → **0%** on the annotated corpus.

**Three of four preconditions written and never built.** `two-weaknesses` fired
on **72.5%** of positions with one of its four stated conditions implemented.
The corpus exposed it sideways: the concept had been ranked *last* to stop it
leading everywhere, and that pushed the one corpus entry whose annotated concept
IS two-weaknesses to rank 8, outside the six the API returns. The fix belonged
in the recognition, not the order — the heavy piece that can switch wings, the
defending king not standing between the targets, and a comparison of the two
sides' weakness counts. **38.6%**, and the textbook entry back at rank 1.

And one precondition that **cannot be counted**: "the attacker has no weakness of
comparable value" looks measurable and is not. Requiring strictly fewer weak
pawns removed Rubinstein–Salwe 1908 from its own concept, because after 9.Nxc6
bxc6 White's b2 and e2 count the same as Black's a7 and c6 — one pair a fixed
target complex on half-open files, the other two pawns on their original squares
on move nine. Loosened, and the remainder written down as unmeasurable rather
than approximated.

**And a piece of standard research that was simply missing.** Spielmann's
sham/real classification — "sham sacrifices involve losses of material only for
a definable amount of time … Properly speaking, there is no sacrifice, only an
advantageous business deal" — was nowhere in the base. It is now on the
`sacrifice` record, sourced to the book, with the consequence stated: an SEE test
detects that material was *offered* and cannot tell sham from real, because that
turns on whether the consequences could be calculated. Capablanca's 24.Qg8+
against Mattison is mate in two, and therefore sham by Spielmann and a queen
sacrifice by Chernev. Recorded as ambiguous; this base adjudicates neither.

### The same defect three times, and it is a class

`two-weaknesses` fired on 72.5% with one of its four preconditions built.
`loose-piece` fired on 34.9% because the *second* of its two traps was ignored.
`open-file` fires on 55.7% with its **registered** false positive — "without an
entry square, a rook on it accomplishes nothing" — never implemented at all, and
its third trap, that a contested file leaves neither side anything, likewise.
Building both takes it to **35.5%**.

`piece-activity` counted **legal moves**, which is word for word what its
record's first trap forbids — "counting available squares is not measuring
activity. A piece with many moves that bear on nothing is not active." It now
counts active moves, threshold unchanged: 44.4% → **33.9%**.

`weak-square` fired on **68.9%** and implemented exactly one line of its
record — the precondition. Three conditions written underneath it were not
built: the fianchetto trap ("a fianchetto leaves permanent weak squares on the
long diagonal that the bishop covers perfectly well"), `indicators_against`'s
"it is on the edge, or deep in the opponent's own half", and the definition's
own words, "a square in **one's own camp**". 68.9% → **40.5%**.

The fianchetto guard is the interesting one, because the naive form of it
deletes the classic outpost too: Nd5 met by ...Nxd5 exd5 is an even trade on the
square, exactly like Bh6 met by Bxh6 Qxh6. The difference is the **pawn**
recapture, which keeps the square where a piece recapture leaves it to nobody —
and pawn support is what the record's own `indicators_for` names. Both cases are
pinned by tests.

`space` counted controlled squares and stopped — the one thing its record warns
about in the same breath: *"counting controlled squares is mechanical and
over-reports. Space with no entry point wins nothing."* An entry square is now
required: 53.3% → **34.6%**. Layer 3's new `entrySquares()` is deliberately
wider than `reachableHoles()`, because the classic way to cash a space advantage
is a rook arriving on the seventh down a file nobody can contest — an entry
square, and not an outpost.

With that, **no matcher fires on more than half** of the 788 shipped positions
except `passed-pawn`, which is kept high on purpose.

Six matchers, one shape: the record's bare *precondition* was implemented and
the *traps* written underneath it were not, and in every case the traps were the
part that carried the chess. The next audit should read every matcher against
its record's traps rather than its preconditions — that is where the conditions
actually live in this knowledge base.

### And one failure kept failing on purpose

Fixing `piece-activity` broke a corpus entry, and the break was the useful part.
Keene's note on Réti–Capablanca 1924 is that Capablanca "is doing his utmost
with his strongest piece" — and the entry had been *passing* because
piece-activity was reported for **White**, whose army really is the more active,
while the annotation is about **Black's queen**. Naming the side made that
visible, and the entry now fails.

It is left failing. An army-level measure cannot state a single-piece claim; the
concept that fits is `queen-activity`, which has no matcher; and the limitation
is written on both records. Loosening the measure, or dropping the side, would
have made the number better and the record worse.

That is the third metric this project has caught telling it what it wanted to
hear — after the mass test's "99.7% positional coverage" and the corpus
checker's scoring of negative examples — and all three were found the same way:
by asking what the number would have to mean.

`state/COMPLETION.md` still says **not substantially complete**, and the blocker
has changed shape rather than shrunk: it is negative and ambiguous evidence, 77%
and 83% missing, and it does not yield to mining. It has to be hunted one concept
at a time, in annotations, where an author says *this looks like X and is not*.
Two were found this session and one of them is now the sharpest false-positive
test in the repository, so the search is worth its cost.

Five of this session's seven target concepts will never reach the API-validated
rung, by their own records — the initiative is invisible to a static scan, and
coordination and transformation are human-only. Both the ladder and the corpus
checker now derive that distinction from the records and print it, so that
"cannot be achieved" is never quietly counted as "not achieved" and never quietly
counted as a pass.

---


## Session 6 — the depth phase, and what running it found (2026-09-01)

The brief for this session was that 85 covered areas is not a finished system.
It was right, and `tools/depth_report.py` was built to say how far off: scoring
every concept against fifteen things a finished record should carry gave ONE area
full, nine substantial, seventy-five partial, and a mean of 0.61.

The gaps were entirely evidence rather than research — master games missing on
99% of board-level concepts, examples on 84%, engine validation on 88%, against
definitions missing on 2%. Strong on text, thin on positions.

### What was built

- `tools/depth_report.py` — the checklist audit, and `state/COVERAGE.md` from it.
- `tools/mine_positions.js` — finds real positions exhibiting a concept, and the
  harder thing: NEAR-MISSES where the surface pattern is present and the
  condition is absent, which is what false-positive testing needs.
- `tools/replay_game.js` — derives verified FENs by replaying a game through the
  page's own move generator.
- `tools/api_audit.js` — API behaviour across 22 position types.
- `tests/test_explanations.js` — 3384 assertions on whether explanations are
  USELESS, which the API suite does not test.

### Everything that broke, broke under test

Not one fault this session was found by reading the code.

**The mass test's headline metric was worthless.** It reported 99.7% positional
coverage and I nearly recorded it as success. Underneath, `semi-open-file` fired
on 83% of positions and `open-file` on 61%. Three matchers tightened against
their own concept records, and the metric changed to the LEAD concept, which is
what a reader actually sees: 63.5% motif, 36.4% positional.

**The API printed `{targets}` at a reader.** 25 records write templated
explanations; nothing was filling them.

**Master games broke three matchers in one sitting.** Nimzowitsch–Salwe called
his blockading bishop bad. Capablanca–Tartakower called a rim knight on a5 an
outpost and a rook-ending pawn an isolated queen's pawn. All three fixed at the
matcher, each grounded in the concept's own record.

**Ordering let a low-confidence claim lead.** The system's headline on
Nimzowitsch's most famous positional game was that his best piece was bad.

**24 detectors did not exist.** Rewriting the audit's check against real source
files instead of a whitelist exposed `isCheckmate`, `lineAlignment`,
`backRankEscape` and twenty-one others naming nothing.

**A reputable game score failed to replay** at Black's 24th move. Only the
verified prefix was used, and the failure is logged.

### Where it stands

135 concepts, 172 sources, 53 validated positions, 1008 indexed warnings, 576
tests plus 365 API-audit and 3384 explanation assertions. All eleven audits clean.

`state/COMPLETION.md` assesses this against the brief's ten criteria: five met,
three partial, two not. **Not substantially complete**, and the blocker is one
thing — 129 board-level concepts against 53 validated positions.

The corollary for whoever continues is in that file: add positions, not prose.

---

## Session 5 — the system becomes usable (2026-09-01)

The knowledge base became a system this session: Layers 3 and 4 exist, the API
exists and is tested, and all 85 taxonomy areas have coverage.

### What was built

- **Layer 3** (`lib/features.js`) — observable board features, on the page's own
  move generator via `tools/page_chess.js`, so there is still one implementation
  of the rules. Tactical detection stays `findMotifs()`.
- **Layer 4** (`lib/matchers.js`) — every matcher names in an `implements` field
  the concept record whose recognition block it implements.
- **The API** (`lib/analyze.js`) with four enforced refusals, 149 tests.
- **Retrieval** (`tools/find.py`) and **mass testing** (`tools/mass_test.js`).
- **Evidence grading** in the warnings index: demonstrated / on-a-tested-record /
  sourced / unsourced.

### Three things the work caught in itself

**24 fictitious detectors.** Rewriting `audit.py` to verify detector names
against the actual source files instead of a hardcoded whitelist immediately
exposed 24 concepts naming functions that do not exist anywhere in the
repository. The whitelist had been rubber-stamping them for the whole project.
All repointed at real code or marked "not yet written".

**A metric worth nothing.** The first mass-test run reported 99.7% positional
coverage and I nearly recorded it as success. It counted any positional concept
anywhere in a list of six, while underneath it `semi-open-file` fired on 83% of
positions and `open-file` on 61%. Three matchers were tightened against their own
concept records, and the metric was changed to the lead concept — what the reader
actually sees. The honest figure is 63.5% motif lead (the same detector the
shipped layer uses) and 36.4% positional lead, which is the part this project
adds.

**Template placeholders reaching a reader.** 25 concept records write their
explanations with `{slots}`. The first working API output shipped the literal
text "this piece hits {targets} simultaneously". Slot filling plus a hard guard
now make that impossible, and it was found by running the thing rather than by
reasoning about it.

### Coverage

85 of 85 areas, 134 concepts, 166 sources. Coverage here is breadth: 12 areas are
"fully covered" by the coverage model, and two records (mixed-piece-endgames,
queen-endgames) say outright that they are orientation rather than theory.

False-positive suite: 10 of 12 resolved, 1 partial, 1 pending with a written
reason. Every resolved case is replayed through the real API as a regression
test.

### Still open

- No quiet-position corpus. Mass testing runs on tactical puzzles because that is
  what this repository has, and the positional half most needs judging on quiet
  middlegames.
- Layer 5 wording is deliberately plain and could be much better.
- The two remaining false-positive cases.
- `positions/` is still an empty directory; validated positions live inline on
  the concepts.

---

## Session 4 — openings, blindfold, endgame core, and the warnings index (2026-09-01)

Grew the base from 86 concepts / 44 areas to 112 concepts / 63 of 85 areas, with
500 tests passing and the validator and audit clean throughout. Ten commits.

### What was covered

- **The opening domain**, which had zero coverage: opening principles, opening
  theory concepts (transposition, novelty, tabiya, repertoire), gambit principles.
- **The blindfold domain** — the one area unique to this product — from the
  peer-reviewed cognitive-science literature rather than chess instruction.
- **Calculation and candidate moves**, with the Kotov/Nunn/Dvoretsky dispute kept.
- **The endgame core**: endgame principles, king activation, rook endgames.
- **The positional core**: evaluation, planning, piece activity, worst-placed
  piece, transformation of advantages, piece coordination.
- **Defence and forcing moves.**
- **Two meta-records** over the base's own accumulated content.

### The methodological finding of this session

Openings are one of the few areas where a controlled comparison is EASY, and the
reason is structural: the candidate moves are all legal moves in ONE position, so
`searchmoves` evaluates them inside a single search with only the move varying.
This is the same technique that failed three times on outposts and twice more on
king activity in this session — and it works here for precisely the reason it
fails there. Positional concepts that live in *configurations* do not isolate;
concepts that live in *move choice* do.

That gave a measured compensation spectrum:

| position | quiet best | the gambit | cost |
|---|---|---|---|
| after 3...Bc5 | 4.c3 +0.28 | 4.b4 (Evans) 0.00 | 0.28 |
| after 1.e4 e5 | 2.Nf3 +0.30 | 2.f4 (King's) −0.61 | 0.91 |
| after 3...Nf6 | 4.d4 +0.08 | 4.Nxe5 (Halloween) −1.67 | 1.75 |

Compensation is real, measurable, and can be complete — the Evans is a pawn down
and evaluates level, so what it surrenders is the opening edge, not the pawn.

### Where the work contradicted itself, and was corrected

The early-queen concept asserted that the Scandinavian shows the rule "simply
does not bite". Tested, it bites: White is +0.76 there against +0.30 after
1...e5, so Black concedes ~0.46 by exactly the mechanism the rule names. The
concept was corrected, the position filed as an ambiguous example whose verdict
note says what was claimed and what was found, and an audit note records that the
claim was asserted before it was tested.

The audit separately caught this session overclaiming an `originated-by`
attribution of planning to Steinitz — an inference of ours, not a claim in any
source. Downgraded to `later-associated-with` with the inference stated.

### False-positive suite: 0 → 6 resolved, 1 partial, 5 still pending

Three by tablebase (a check that draws and a check that loses in ONE position;
the wrong-rook-pawn draw a bishop and pawn up), three by controlled engine
comparison (a piece moved twice being the best move by 0.34; the isolani side
being better; doubled pawns costing the *inflicting* side 0.34).

### The generalisation worth keeping

Collecting 826 warnings into `state/warnings_index.json` made the shape visible:
**a chess misconception is almost always a true statement with its condition
removed.** Every case this session fits it — doubled pawns, the piece moved
twice, the rook behind the passed pawn, improve your worst piece, checks are
forcing so checks are strong.

### Known gaps, stated rather than papered over

- The warnings index does not distinguish proofs from opinions.
- 22 taxonomy areas still have zero concepts; 5 false-positive cases pending.
- Layers 3 and 4 (positional feature detection, concept matching) are not built,
  and neither is the reusable `analyze_with_education()` API.
- Two controlled-pair designs for king activity failed and are recorded as
  failures; king activation rests on a resistance measurement (dtm 35 vs 15),
  not on a win/draw split.

---

## Session 1 — scaffolding, methodology, pilot concept

### Codebase inspection (done before any design)

- The client is one file, `blind-chess.html` (~4.8k lines), navigated by
  `/* ==== TITLE ==== */` banners. 17 script sections.
- **Study Board** is not a separate feature: it is the post-game review
  (`REV`, `reviewGoto`, `reviewRender`), reached by the `endClose` button.
- **LESSON** and **PUZZLE** exist in the header nav but every entry carries the
  `soon` class. They are stubs — nothing to preserve, nothing to break.
- **Existing explanation system**, the thing this project extends:
  - `judgeMove(loss, playedWasBest, gap)` -> `??` / `?` / `!!` / `!`, purely from
    centipawn loss plus the MultiPV gap.
  - `describeBest(st, m, res, lossByPlayer)` -> up to three observable facts
    (mate, check, capture, promotion, castling, escaping an attack, leaving the
    back rank, taking central space), else the fallback *"No single tactic — it
    is simply the soundest of the options."*
  - Its own comment: *"This is not chess understanding, and it only ever claims
    what it can see."* That is an accurate self-assessment and names the gap.
- **Engine integration**: `SF` object, one lazily-started worker running the
  vendored single-threaded `engine/stockfish.wasm` (Stockfish 10), spoken to in
  UCI via `engineAsk(moves, opt)`. Results are cached on a key that includes
  strength settings. Review asks at `{skill:20, multipv:2}`, 500 ms per position.
  Notably it must never `setoption name Threads` — the comment records that doing
  so wedges the build.
- **No FEN anywhere in the codebase.** State is `{b, turn, cr, ep, half, full}`
  with `b` a 64-array of `{c,t,id}`, index 0 = a8. The client only ever sends
  `position startpos moves ...`.

  This is a real prerequisite. Every stored example position, every puzzle, every
  textbook position is a FEN. A FEN reader/writer that round-trips against the
  existing state shape has to exist before the runtime half of this system can
  work. It is purely additive and changes no existing behaviour. **Not yet
  written** — deliberately deferred until the knowledge base justifies it.

### Decisions taken

- **Storage: one JSON file per concept**, under `concepts/<category>/`.
  Chosen over a single large file so git diffs stay readable and two sessions
  can work without merge conflicts. A committed `education-bundle.json` will be
  compiled from them, so the app still has no build step.
- **Tools are standard-library only.** `requirements.txt` has exactly one
  dependency (PyJWT) and the Dockerfile is proud of it. `sf_analyse.py` speaks
  raw UCI over a pipe; `validate_kb.py` hand-rolls the schema checks rather than
  pulling in `jsonschema`. `python-chess` is optional, for SAN in tool output.
- **Research uses a native Stockfish 18, not `engine/stockfish.wasm`.** The
  vendored build is GPL, checksum-verified, single-threaded Stockfish 10, and
  exists to be served to browsers. Research must not touch it, and a 2018 engine
  is the wrong instrument for adjudicating theory anyway.
- **20 domains / 85 areas**, mapped one-to-one against the 85 numbered items in
  the project brief so scope coverage stays auditable (`brief_items` in
  `taxonomy.json`). All 85 are accounted for; item 85 is the escape hatch for
  categories discovered later.

### Tooling built and verified

- `tools/sf_analyse.py` — probed `Stockfish 18`, 12 cores available.
  One real bug found and fixed during verification: piping every UCI command at
  once and closing stdin makes Stockfish read `quit` mid-search and exit before
  printing a single `info` line, so it silently returned a bestmove with no
  evaluation. It now streams and waits for `bestmove`. Worth remembering — the
  broken version *looked* like it worked.
- `tools/validate_kb.py` — schema, enums, id uniqueness, referential integrity
  across concepts/sources/coverage. Currently clean.

### Pilot concept: principle of two weaknesses

Researched and engine-validated ahead of the scaffolding, and used to prove the
schema end to end. Findings that shaped the methodology:

1. **The received attribution is half wrong, and only the primary text showed
   it.** Every secondary source says Nimzowitsch formulated the principle in
   *My System* (1925). The full text shows the idea is there — Ch. 5/VI
   "Manoeuvring", §2(b) is literally headed *"Two pawn weaknesses, in this case
   c3 and h3"* — but he calls it *manoeuvring* or *tacking*, never "the principle
   of two weaknesses". That name comes from the Soviet line
   (Belavenets -> Dvoretsky -> Shereshevsky). Both halves of the received claim
   are half-right. This is why `origin.certainty` exists as a field.

2. **Controlled pairs are the strongest validation available.** Two positions
   differing only in the presence of a distant second target: mate in 23 versus
   a dead draw. Reproducible from the FENs by anyone.

3. **Respected sources overstate.** Shereshevsky: a position "would be drawn"
   with the kings placed differently — engine says +0.75, not 0.00. Mechanism
   confirmed and large; absolute claim not supported.

4. **Annotators' punctuation is not an evaluation.** Dvoretsky and British Chess
   News mark 42...h5 as necessary and 42...Kf6 as an inaccuracy in
   Kotov-Pachman. At depth 32 the gap is **0.05 pawns**. The second weakness
   created *practical* difficulty, not objective loss — Pachman held for another
   thirteen moves and lost to a later error. A concept can be practically
   decisive and objectively near-irrelevant at the same time, and the record has
   to be able to say so.

5. **Disagreements get adjudicated, not flattened.** Capablanca called 43...Nb4
   a trap; Myers said Black wins anyway. Engine: Capablanca's concrete line is
   0.00 so the trap is real, Myers is right that Black can deviate and win, and
   *neither* noticed 43...Nb4 is 1.2 pawns better than the move actually played.
   All three recorded.

Side benefit: a FEN hand-decoded from Dvoretsky's diagram font was verified by
replaying the entire published continuation through move 55 — it is legal
throughout, which independently confirms the transcription.

### Phase 5 results — tactics controlled pairs

Three pairs built, each differing in exactly one variable.

| Concept | Positive | Negative (one variable changed) | Swing |
|---|---|---|---|
| Fork | Nc7+ **+7.39**, best, +2.21 clear | bishop guards c7: same move **+0.57**, ranked last | **6.82** |
| Back-rank mate | Re8 **mate in 1** | h7-h6 luft: same move **mate in 30**, not best | #1 -> #30 |
| Pin | d4-d5 **+7.26**, +1.57 clear | king castled, no pin: d4-d5 **+5.40**, still best, +0.28 clear | 1.86 |

The pin result is the important one and is now written into METHODOLOGY.md as a governing rule:
the same move was the engine's first choice with and without the pin, so best-move agreement
cannot be used to decide that a concept applies. The usable signal is the margin over the
runner-up, plus the paired delta.

The fork pair is the cleanest false-match demonstration in the base so far: identical geometry,
6.82 pawns apart, decided solely by whether one defender covers the landing square. Any fork
detector that stops at geometry will produce exactly this error.

Housekeeping: a depth-34 analysis of the Kotov-Pachman move-55 rook ending failed to converge in
16 minutes and was starving a parallel run of CPU; it was killed and recorded as an open question
on the two-weaknesses concept rather than dropped. Lesson: cap simplified endings at depth 28-30,
or install Syzygy tablebases.

## Session 3 — Phase 0 redone against the merged tree

`agent-4` was 44 commits behind `main` when Phase 0 was first performed. It has been
brought up to date and the inspection redone. Full record in `INTEGRATION.md`.

### Corrections

| First pass said | Actually |
|---|---|
| No FEN in the codebase; a reader/writer is a prerequisite | `fenOf()` / `stateFromFEN()` at `blind-chess.html:3913`/`:3929`, round-trip tested. **Do not write a second one.** |
| LESSON and PUZZLE are `soon` stubs | Both shipped, with their own suites, plus Practice and 788 verified puzzles |
| `judgeMove` = centipawn loss -> 4 verdicts | Win-percentage based, six verdicts, SEE-based sacrifice detection |
| Layers 3 and 5 are greenfield | `findMotifs()` covers the tactical half of 3; `tools/puzzle_words.js` covers 5 for puzzles |

### The convergence worth recording

`findMotifs()` already applies the guards this project derived independently from
engine testing — a fork is reported only when the target is outranked or
undefended, material already loose before the move is not counted, and a pin that
already existed is skipped. And the generator's README refuses to claim
deflection, decoy, overloading, interference and double attack because "every
cheap test for them fires where it is not true" — exactly the five this knowledge
base had classified `detectability: heuristic` from the sources. Two independent
routes to the same line.

That reframes the project. The tactical single-move case is already solved here to
a high standard. What is missing is the knowledge behind the tags, everything
positional (the codebase has no vocabulary for it at all), extra registers, and
retrieval.

### Corpus testing

`tools/corpus.py` mines the 788 shipped puzzles as a labelled dataset. It measures
which themes have concept records, weighted by how often they occur, which turns
research prioritisation from a guess into a measurement: **78% of chess-concept
theme instances are covered**.

It also caught a mistake before it was made. `longGame` (591 puzzles) and
`defensiveResource` (490) look like the two biggest gaps, but reading
`puzzle_rules.js` shows `longGame` means "the line is at least three moves" and
`defensiveResource` means "this puzzle is a rescue rather than a punish". They are
properties of the PUZZLE, not chess ideas, and giving them concept records would
have been inventing terminology to fit a pipeline tag. They are now classified
`metadata` and excluded from the coverage denominator. `positionalTactic` is
similar — the generator's label for "a quiet move with no motif tag" — and is
marked NEEDS RESEARCH BEFORE NAMING rather than given a concept called
"positional tactic", which is not a recognised term.

### Concepts added

`hanging-piece`, `loose-piece`, `lpdo`, `weak-square` — chosen because
`hangingPiece` is the single most common theme in the corpus (598 of 788) and had
no record. The four are deliberately typed differently to show the classification
doing real work on one subject: hanging and loose are `terminology`, LPDO is a
`rule-of-thumb` carrying mandatory hedging, weak-square is a `positional-concept`.

LPDO is also a clean attribution case: two sources say "probably coined by Mike
Cook", popularised by Nunn. The hedge is theirs and is kept, confidence is
`medium`, and `misconceptions` records that writing "Nunn coined LPDO" would be
wrong.

## Session 4 — corpus-driven research

Worked the priority order the corpus produced rather than by taste. Ten concepts
added: sacrifice, positional-sacrifice, exchange-sacrifice, perpetual-check,
king-attack, backward-pawn, open-file, greek-gift, passed-pawn,
pawn-breakthrough, rook-on-the-seventh, bad-bishop, doubled-pawns,
isolated-queen-pawn.

### Findings worth keeping

**The first `contradicts` verdict.** Puzzle mi-bb512d9713 is tagged
`exchangeSacrifice` by the repository's own pipeline. Stockfish says Re1+ is mate
in two. So the material pattern fires correctly — rook for bishop — but this is a
MATING sacrifice, sham in Spielmann's sense, not a positional exchange sacrifice.
Recorded as `contradicts` on the exchange-sacrifice record, because it proves the
corpus tags cannot be used as ground truth for the positional concept.

**Perpetual check is not a rule**, and this is the clearest rules misconception
found so far. FIDE's Laws do not mention it; a perpetual forces a repetition and
the repetition is what draws. Shogi and xiangqi forbid it outright, which shows
its status is a choice rather than a necessity. Engine-verified on a real corpus
position: Qa8+ evaluates 0.00 with the repeating cycle in the PV, while every
alternative is mate against — Ne6+ is mate in 13, Qg3 mate in 3.

**Two unverified famous quotations recorded as unverified.** Nimzowitsch's
"a passed pawn is a criminal which should be kept under lock and key" is
attributed but was NOT located in the primary text during this research. A
Capablanca line about taking doubled pawns for the seventh rank is prefaced
"Legend has it" by its own source. Both are flagged rather than repeated, and
`passed-pawn` carries history confidence `low` because of it.

**The Greek gift's NAME has two incompatible origins** in circulation — Greco the
player, and the Trojan horse — and neither was verified. Recorded as an open
question. Vukovic's four CONDITIONS, by contrast, are secure and precise enough
to be near-mechanical recognition criteria.

### Epistemic typing doing real work

Four concepts on one subject, typed three different ways: `hanging-piece` and
`loose-piece` are terminology, `lpdo` is a rule-of-thumb with mandatory hedging,
`weak-square` is a positional concept. Similarly `perpetual-check` is terminology
rather than an official rule, and `pawn-breakthrough` is a tactical motif rather
than a strategic principle because its correctness is settled by calculation.

### Engine budget — a lesson learned twice

A Greek Gift pair at depth 28 MultiPV 4 and a breakthrough pair at depth 34, run
concurrently, failed to converge in twelve minutes. Two compounding errors:
MultiPV suppresses pruning so it costs far more than single-PV at the same depth,
and `sf_analyse.py` defaults to `cpu_count-2` threads so two concurrent jobs
requested 20 threads on 12 cores. Both recorded in `tool_limitations`, and
`sf_analyse.py` now takes `--threads`. Run engine jobs sequentially.

## Session 5 — first quality audit, and a corrected textbook

### The audit (brief Phase 39)

`tools/audit.py` is new and looks for what is wrong but LEGAL — the class of
problem `validate_kb.py` and `run_tests.py` cannot see. First run over 59
concepts found **16 issues, 6 of them high**, and all six were real:

- Four attributions (`backward-pawn`, `bad-bishop`, `doubled-pawns`,
  `isolated-queen-pawn`) asserted `originated-by` or `named-by` at history
  confidence `low` with no hedge in the attribution note itself. The caveat sat
  in a field a reader might not reach. Hedge now travels with the claim.
- `fork` listed "double attack (by a single piece)" as an alias — which is the
  canonical name of the separate `double-attack` record. The record's own
  metadata contradicted the distinction its prose draws. Alias removed,
  `broader: double-attack` added instead.
- `pawn-breakthrough` claimed `source_confidence: high` with no source rated
  high. Downgraded.

The six low findings were reviewed and **accepted rather than fixed**, with
reasons recorded: four concepts promoted while relying on a source with an
access caveat (the promotions rest on engine evidence, and the caveat is exactly
why none is promoted to `ready`), and two short records that are simple rules
quoted from the Laws, where padding would add words rather than knowledge.

### Tablebase corrects a teaching source

`tools/tablebase.py` now reports EVERY legal move with its exact verdict, which
turns out to be far more informative than a single evaluation.

Run over the standard textbook triangulation position — White Kd5 with pawns b5
and c5, Black Kd7 with a pawn on b7 — it says:

```
b6    win in 22      Kc4/Kd4/Ke4  win in 48
Ke5   win in 46      c6+          DRAW
```

The instructional line gives 1.Ke5! as the winning move. It wins, but it is the
slowest of five winning moves, and the direct 1.b6 is more than twice as fast.
Only 1.c6+ throws the win away. So the position genuinely teaches "do not push
the pawn" and does NOT establish that triangulation was necessary. Recorded as
an `ambiguous` example on the concept, because it supports the technique's
existence while contradicting the necessity the source implies.

### Pawn breakthrough completed

Both halves of the controlled pair are now settled, and the swing is the largest
in the base. Identical material and structure, White's trio one rank apart:

```
pawns on the 5th:  1.b6!  +64.85  (both alternatives LOSE: -10.25, -81.15)
pawns on the 4th:  1.b5   -5.86   and not best; the quiet 1.a5 at -0.46 is
```

Over 70 pawns of difference produced by one rank of space. The sources' claim
that "move all pawns one row and the breakthrough does not work at all anymore"
is confirmed exactly.

### Concepts added

`king-safety`, `opening-development`, `triangulation`, `corresponding-squares`,
`key-square`. The first two close three registered false-positive cases, and
`opening-development` is deliberately typed `rule-of-thumb` with mandatory
hedging — the five conventional opening rules are teaching scaffolding, and the
brief's own example (moving a piece twice) is recorded as a trap rather than a
criticism.

King safety is worth noting as the one concept where engine practice is public
enough to borrow as a specification: Stockfish's king zone, its attack-unit
weights (minor 2, rook 3, queen 5), and the S-shaped scoring table are all
documented, and the practical consequence — an attack is not worth evaluating
below three attackers — is better guidance than anything in the prose sources.

## Session 6 — orphaned waiters, and a rule of thumb proven wrong

### The two background shells could never finish

Both were `until grep -q DONE_...` waiters polling `gg.out` and `bt.out`. Those
files end in a **BrokenPipeError traceback**: when the over-deep runs were killed
last session, `sf_analyse.py` raised on writing `quit` to a dead engine, which
escaped and killed the wrapping script BEFORE it echoed its sentinel. Nothing
could ever write what the waiters were watching for.

Nothing was pending. The results had been obtained by reruns and incorporated;
every number in `greek-gift` and `pawn-breakthrough` was re-checked against the
raw output of `both.out` and `bt2.out` and matches exactly. No corrections were
needed to the research.

Two fixes recorded:
- `sf_analyse.py` now tolerates a dead pipe and raises a clear RuntimeError
  naming the problem, instead of a stray BrokenPipeError that kills its caller.
- Recorded in `tool_limitations`: a background script must write its sentinel
  UNCONDITIONALLY — `trap 'echo DONE_X' EXIT`, not a bare echo at the bottom.

### The most valuable result in the base so far

The Vancura position gives a **proven refutation of a famous rule of thumb**.
Tarrasch's rule — the rook belongs behind the passed pawn — is recorded in
`passed-pawn` as a reliable heuristic. In the Vancura configuration it loses by
force. Two positions, identical material and identical kings, differing only in
which square the defending rook stands on:

```
R7/6k1/P4r2/8/3K4/8/8/8 w   rook BESIDE the pawn (f6)   PROVEN DRAW
R7/6k1/P7/8/3K4/8/8/r7  w   rook BEHIND the pawn (a1)   PROVEN LOSS in 63
```

That is not an argument about the rule, it is a counterexample to it. The
exception is now linked from `passed-pawn`, which previously stated Tarrasch's
rule without qualification, and both concepts carry the cross-reference.

### A documented misattribution

The Lucena position is not Lucena's. It does not appear in his 1497 book; the
earliest preserved discussion is Salvio's *Il Puttino* (1634), who credits
Scipione Genovino; and the error is traced to Constantin Schwede's sixth edition
of the *Handbuch des Schachspiels* (1880). The name is universal and should keep
being used — but it is terminology, not evidence of authorship, and the record
says so.

Philidor's attribution, by contrast, is sound (1777) — with the nuance that his
own claim that the third-rank defence was the ONLY drawing method was disproved
by Karstedt in 1897.

### Concepts added

`lucena-position`, `philidor-position`, `vancura-position` — three named
theoretical positions, all tablebase-proven. The Lucena's tablebase best move is
Rd1+, exactly the textbook first move of the bridge.

### Next

Complete the pilot concept record, then work the taxonomy in dependency order:
`rules-terminology` and `board-geometry` first (they are prerequisites for the
recognition criteria of everything else), then `tactics`, then the positional
domains.


## `weak-square` gets its first human grounding, and it is a refusal

Both new corpus positions come from one article by Jan Markos (GM), who built
them as traps for exactly the reading a mechanical detector performs: *"a
keyhole is useless when you don't have a key that fits into it."*

**Unzicker–Fischer, Varna 1962**, after 20.c3. d5 is a permanent hole in Black's
camp, Layer 3 sees it, and Markos's pupils are meant to say White is better for
it. Stockfish, from the side to move, says **+0.39 for Black**. The system is
silent — and the entry records *which* guard does the work (the one-move
reachability rule, not this session's new ones), because a pass for a cruder
reason than the human's is a pass and not a proof.

**Shirov–Kramnik, Linares 2000**, after 20.Qh5, names no side at all: *"d5 is a
no man's land. Neither side can make any use of it."* Stockfish scores it 0.00
and plays Kramnik's 20...d5 as its own first choice.

The second position also produced a disagreement worth keeping. Markos calls
Black's b4 and f4 the cage that "guards all the roads to d5"; this base's
`two-weaknesses` matcher lists **f4** among the weaknesses White should play
against. Both readings follow from the pawn skeleton and only one is true of the
position. It is written on the record as a trap rather than engineered away —
dropping f4 would not change the claim, which also names f7 and d6, and putting
a concept into `rejected_as_wrong` on an annotator's behalf is how three earlier
entries in this file manufactured false positives.

### And the same check, made twice, lowering the same number twice

`human_grounded` was fixed once when it turned out to be counting this system's
own mining (39 → 17). It was still counting corpus **membership** — and the
corpus's `annotator` field is prose, so one entry reading "unattributed training
page" counted exactly like Nimzowitsch annotating his own game. `attributed_by`
is now the field, backfilled across all 37 entries; four name no person. 29 →
**26**, and `hanging-pawns`, `pawn-break` and `restraint` lose the rung until a
named annotator is found for Fischer–Spassky 1972 game 6.
