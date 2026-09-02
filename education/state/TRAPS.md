# Trap audit

Every false-positive trap AND every indicator-against a concept record states,
read against the matcher that is supposed to implement it. Regenerate with `node tools/trap_audit.js
--markdown state/TRAPS.md`.

This is a READING LIST, not a verdict. "cited" means the trap has been
written about somewhere it would be enforced or excused — in the matcher, or
in a record limitation saying it cannot be built. "unread" means nobody has
written down whether it is implemented, which is true whether or not it
happens to be. The tool cannot decide whether a trap is *correctly*
implemented; that is a reading, and doing it is the work. What it can do is
stop the list being rediscovered from scratch each time — and every one of
the defects listed in the tool's header was unread before it was looked at.

**Of 246 stated conditions (traps and indicators-against): 98 enforced in the matcher, 20 in Layer 3, 55 argued on the record to be unbuildable or already honoured elsewhere, 73 unread.**

ONE CAVEAT ABOUT `indicators_against`, and it is not a technicality. For a
concept naming an ASSET — an open file, an outpost, a passed pawn — they are
reasons NOT to report it, which is how this list reads them. For a concept
naming a SCALE or a liability — `king-safety`, `isolated-queen-pawn` — they
are the conditions under which the thing is BAD, which is to say the
conditions the matcher fires on. Building those as guards would invert the
concept. Read the record before building the row.

"Noted on the record" is an argument, not a guard. A single "all cited"
headline would read as "all traps implemented", which would be the same
self-flattery this tool caught in its own first version — it scored keyword
overlap, reported 75 unread, and then credited 40 traps at a stroke when a
shared file was added to the search. The test is quotation for that reason.

## doubled-pawns

- [cited] REGISTERED FALSE POSITIVE: doubled pawns are not automatically weak. Detecting them is trivial; concluding weakness from the detection is wrong often enough to be a real hazard.
- [cited] The compensation is usually invisible to a structure check — the bishop pair and the opened file are elsewhere on the board.
- [cited] Doubled CENTRAL pawns are frequently an asset, controlling four squares between them.
- [cited] *(indicator against)* The doubling opened a file that is actually being used
- [cited] *(indicator against)* The bishop pair was obtained in the exchange
- [cited] *(indicator against)* They increase control of central squares
- [**unread**] *(indicator against)* They create an outpost the opponent cannot contest
- [**unread**] *(indicator against)* They shield the king rather than exposing it
## isolated-queen-pawn

- [cited] REGISTERED FALSE POSITIVE: an isolated pawn is not automatically a weakness. In the middlegame it is frequently the source of the better side's whole game.
- [noted] The structure is trivially detectable and says almost nothing on its own — the material left on the board decides the evaluation more than the structure does.
- [noted] Reporting it as a weakness while its owner has the initiative inverts the position.
- [cited] An isolated queen's pawn is not a weakness on sight. In the standard position measured here the side with the isolani is slightly better (+0.14).
- [noted] *(indicator against)* Pieces are still on and the IQP side has the initiative
- [noted] *(indicator against)* The c- and e-files are giving the rooks real work
- [noted] *(indicator against)* Knights are established on the outposts beside the pawn
- [noted] *(indicator against)* Attacking chances against f7 are live
- [noted] *(indicator against)* The pawn can advance at a chosen moment to liquidate favourably
## passed-pawn

- [cited] REGISTERED FALSE POSITIVE: a passed pawn is not automatically an advantage. A permanently blockaded passer that must be defended is a liability, and the blockading square is an excellent one for the defender.
- [cited] Detecting a passer is trivial and fires constantly in endgames. Reporting one is only informative alongside whether it can actually advance.
- [cited] A passer created from doubled pawns is often born weak.
- [noted] *(indicator against)* It is securely blockaded by a piece that cannot be dislodged, especially a knight
- [noted] *(indicator against)* Defending it ties down more of the owner's pieces than of the opponent's
- [cited] *(indicator against)* It stands on a square where it is easily attacked
- [noted] *(indicator against)* It was created by a pawn trade that also fixed it as a target
- [noted] *(indicator against)* The position has no second front, so the blockader is never distracted
## backward-pawn

- [cited] A pawn that is merely behind its neighbours but CAN advance safely is not backward in the operative sense.
- [cited] A backward pawn on a closed file that nothing can attack is a description, not a weakness.
- [layer 3] Reporting the pawn and not the square in front of it usually misses the more important half.
- [layer 3] A pawn with no friendly pawn on either adjacent file is ISOLATED, not backward, and reporting both names for one pawn promises the reader a hole in front of it that the isolated case does not create.
- [cited] A pawn whose advance square is occupied by an enemy pawn is RAMMED. It cannot advance, but not for the reason the concept is about, and the square in front of it is not a hole - an enemy pawn is standing on it.
- [**unread**] *(indicator against)* It can advance at a moment of its choosing, so the defect is temporary
- [**unread**] *(indicator against)* No enemy rook can reach the file
- [**unread**] *(indicator against)* It is compensated by space or by the activity its structure enables
- [layer 3] *(indicator against)* The square in front is covered by a piece the opponent cannot dislodge
## open-file

- [cited] REGISTERED FALSE POSITIVE: a file with no pawns is not automatically useful. Without an entry square, a rook on it accomplishes nothing.
- [cited] Detecting 'no pawns on this file' is trivial and fires constantly. The reportable fact is the file PLUS a usable entry square.
- [cited] Contested files where all rooks come off leave neither side with anything.
- [noted] An open file is not an advantage on its own. In a proven test position with a rook of each colour on the open d-file, the evaluation is +0.02 - the file belongs to nobody.
- [cited] *(indicator against)* Every entry square on the file is defended — the rook stares and does nothing
- [cited] *(indicator against)* The opponent can contest the file and trade all the rooks off
- [cited] *(indicator against)* The file can be closed by a pawn advance
- [**unread**] *(indicator against)* Occupying it costs a tempo the position cannot spare
## semi-open-file

- [cited] A semi-open file is a fact about pawns; whether it produces pressure depends on whether the target is fixed and whether you can attack it more times than it can be defended.
- [cited] Both sides can have semi-open files, usually on opposite wings, and each will be attacking on their own. Reporting only one side's is half the position.
- [cited] *(indicator against)* The pawn can simply advance
- [layer 3] *(indicator against)* Another enemy pawn can defend it
- [cited] *(indicator against)* The file has no entry square beyond the pawn
## outpost

- [layer 3] A knight on d5 is not an outpost merely because it is on d5. If ...c6 or ...e6 is available, the knight is visiting.
- [layer 3] A pawn-protected advanced square whose occupant can simply be exchanged is not an outpost in any useful sense — Romanovsky's condition fails.
- [cited] A safe square that the piece does nothing from. Safety is a precondition, not the benefit.
- [noted] In the engine test above, the archetypal 'outpost' move was second-best. Being a genuine outpost does not make occupying it the best move.
- [layer 3] A centralised advanced knight is not an outpost. If an enemy pawn can still challenge the square, the piece is visiting. The detector in lib/features.js checks this and correctly refuses in the recorded counterexample.
- [layer 3] *(indicator against)* An enemy pawn can still advance to challenge the square, and doing so costs the defender nothing
- [**unread**] *(indicator against)* The occupant can be traded off by a knight or a same-coloured bishop with no compensation
- [cited] *(indicator against)* The square is on the a/b/g/h files and the intended occupant is a knight — Nimzowitsch assigns flank outposts to rooks
- [**unread**] *(indicator against)* The piece on the square attacks nothing and restricts nothing; it is safe but idle
- [**unread**] *(indicator against)* Occupying costs a tempo the position cannot spare, or walks into a concrete tactic
## weak-square

- [noted] Every pawn move creates squares no pawn can guard, so the raw feature fires everywhere. Usability is what makes it reportable.
- [layer 3] A fianchetto leaves permanent weak squares on the long diagonal that the bishop covers perfectly well. The square is weak; the position is not.
- [layer 3] A weak square only a queen can occupy is usually not a weakness, since cheaper pieces evict her.
- [noted] *(indicator against)* A friendly pawn can still advance to cover it
- [noted] *(indicator against)* A piece covers it durably and cannot be exchanged
- [layer 3] *(indicator against)* The square is unreachable, or reaching it achieves nothing
- [cited] *(indicator against)* It is on the edge or deep in the opponent's own half
## bishop-pair

- [cited] Detecting two bishops is trivial and says nothing about whether they are worth anything. In a locked position the pair can be worth less than a well-placed knight.
- [noted] Half a pawn is an AVERAGE over many games and can be arbitrarily wrong in one position.
- [cited] A bishop pair where one bishop is shut in by its own pawns is not really a pair.
- [cited] *(indicator against)* A locked pawn structure with no way to open it
- [cited] *(indicator against)* The opponent has a knight on a secure outpost
- [cited] *(indicator against)* One of the bishops is shut in by its own pawns
- [**unread**] *(indicator against)* The opponent can force the trade of one bishop
## hanging-pawns

- [layer 3] Hanging pawns are not automatically weak. The structure is dynamic, and the same pair that loses one game wins the next depending on where the pieces are.
- [noted] Do not assess them as an isolated pawn. They defend the squares in front of one another and the pair advancing is a genuine threat.
- [noted] The detector finds the STRUCTURE. Whether it is an asset needs the piece placement, which the detector does not read.
- [cited] *(indicator against)* A friendly pawn still stands on a flanking file — then it is a chain, not a hanging pair
- [noted] *(indicator against)* One of the two has already advanced, which usually ends the structure
## two-weaknesses

- [cited] Two weaknesses that the defending king stands between are not two weaknesses in the operative sense. Measured on the Lasker-Capablanca ending, moving the kings to d3/d6 costs the attacker over half the advantage.
- [cited] Any position has several imperfections. Calling any two of them 'two weaknesses' is the commonest misuse — they must require DIFFERENT defensive resources and be far enough apart that the defence cannot cover both.
- [noted] The principle describes a method of conversion, not an evaluation. A position with two weaknesses is not thereby winning, and Kotov-Pachman shows the gap: the moves annotators mark necessary and inaccurate differ by 0.05 pawns.
- [cited] Against opposite-coloured bishops or a reachable fortress, the count of weaknesses is simply not the operative variable.
- [noted] A pawn that is structurally weak can be the position's KEY DEFENSIVE ASSET, and no pawn-skeleton test tells the two apart. Shirov-Kramnik, Linares 2000, move 20: this base lists Black's f4 among the weaknesses White should play against, and Jan Markos calls the same pawn, together with b4, the cage that 'guards all the roads to d5'. Both readings follow from the skeleton and only one is true of the position.
- [**unread**] *(indicator against)* The two targets are within two files of each other, so one defending king covers both
- [**unread**] *(indicator against)* Opposite-coloured bishops with no breakthrough square - the defending bishop holds one colour complex regardless of how many targets exist
- [**unread**] *(indicator against)* The defender can reach a known fortress
- [noted] *(indicator against)* Opening the second front concedes counterplay, a passed pawn, or an open line towards the attacker's own king
- [cited] *(indicator against)* The first weakness can be liquidated by a pawn break or a favourable exchange
- [**unread**] *(indicator against)* The defending king already stands between the two targets
## bad-bishop

- [cited] REGISTERED FALSE POSITIVE: a bishop behind its own pawns is not automatically bad in the sense that matters. Suba's active bad bishop is the counterexample, and it is common, not exotic.
- [cited] Counting pawns on the bishop's colour is mechanical and will fire on pieces that are performing well. Mobility and role must be checked too.
- [cited] A bad bishop that is the sole guardian of a weak colour complex is a load-bearing defender, not a liability.
- [noted] *(indicator against)* THE SUBA CASE: the bishop is outside the pawn chain and active, however bad it looks structurally
- [noted] *(indicator against)* A pawn break is available that shifts the blocking pawns off its colour
- [noted] *(indicator against)* It is the only defender of a colour complex — a bad bishop with a job is not a bad piece
- [noted] *(indicator against)* The structure is fluid and about to change
- [noted] *(indicator against)* It can be traded for the opponent's good bishop
## opposite-coloured-bishops

- [cited] The drawish reputation is an ENDGAME fact. In the middlegame with heavy pieces on, opposite-coloured bishops favour the attacker, because the bishop operates where the defender's cannot answer. Announcing 'opposite bishops, drawn' with queens on the board is the standard error.
- [noted] Detecting the material is trivial; whether a blockade is achievable is not.
- [cited] Two extra pawns are often not enough — but three files of separation often are. The count of pawns is the wrong variable; their separation and the blockade are the right ones.
- [**unread**] *(indicator against)* Queens or rooks remain — winning chances rise sharply, and in the middlegame the bishops are an ATTACKING asset
- [**unread**] *(indicator against)* The extra pawns are separated by three files or more
- [**unread**] *(indicator against)* The defender cannot establish a blockade on their bishop's colour
- [**unread**] *(indicator against)* The attacker's king can penetrate on the colour the defending bishop cannot cover
## rook-on-the-seventh

- [cited] REGISTERED FALSE POSITIVE: a rook arriving on the seventh is not automatically important. With the pawns advanced and the king free, it attacks nothing and confines nobody.
- [cited] Two rooks on the seventh do NOT generally mate a king whose eighth rank is defended. Explaining them as a mating attack is usually wrong.
- [cited] Detecting 'rook on rank 7' is trivial and fires often; the reportable facts are what it attacks and whether the king is trapped.
- [cited] A rook reaching the seventh is not decisive by itself. With an empty seventh rank and an enemy king that has luft, a tested position evaluates level at -0.04.
- [**unread**] *(indicator against)* The enemy king has escaped to the sixth rank or beyond
- [**unread**] *(indicator against)* The pawns on the seventh have already advanced, so there is nothing to attack
- [cited] *(indicator against)* The rook can be challenged and traded off, or driven away with gain
- [**unread**] *(indicator against)* The eighth rank is defended, so the mating dimension of a second rook is absent
- [**unread**] *(indicator against)* Reaching the seventh costs a tempo the position cannot spare
## luft

- [noted] Making luft is not automatically prudent. The same move is a hook against an opponent who can storm, and this is the standard error.
- [cited] Luft is unnecessary when the back rank is adequately defended or when no heavy pieces remain.
- [**unread**] *(indicator against)* The opponent has castled on the other wing and can throw pawns forward
- [**unread**] *(indicator against)* The advanced pawn becomes a hook for a specific break
- [**unread**] *(indicator against)* The tempo is needed elsewhere in a sharp position
## material-imbalance

- [cited] REGISTERED FALSE POSITIVE: the 1/3/3/5/9 count is not an evaluation. Being 'ahead on material' by that scale says very little once the material is of different kinds.
- [cited] Detecting the imbalance is mechanical and trivial; saying who it favours is not, and depends on open files, king safety and how much else remains.
- [noted] Statistical values are averages. They tell you what to expect across many games, not what is true in this one.
- [cited] MEASURED 2026-09-02: a knight against a bishop is not an imbalance by this record's own preferred numbers - Kaufman puts a knight and an UNPAIRED bishop at the same 3.5 - and the matcher fired on every such swap, 42.1% of the 788 shipped positions. It is a third name for a fact `bishop-pair` and `bad-bishop` already report. The exception is the pair itself, which Kaufman does separate (7.5 against 7.0), so two bishops against two knights is still reported. 42.1% -> 35.5%.
- [noted] *(indicator against)* Material is symmetrical in kind, in which case simple counting applies
- [noted] *(indicator against)* The imbalance is temporary and about to be liquidated
## space

- [cited] Counting controlled squares is mechanical and over-reports. Space with no entry point wins nothing.
- [cited] Advanced pawns are not automatically a space advantage — they may simply be weak and fixed.
- [noted] The cramped side's standard remedy is exchanging, so a space advantage that cannot prevent trades is temporary.
- [cited] *(indicator against)* No entry point exists, so the territory buys nothing
- [cited] *(indicator against)* The advanced pawns are fixed targets rather than a front
- [**unread**] *(indicator against)* The cramped side can liquidate with exchanges
- [**unread**] *(indicator against)* The space was gained by overextension the opponent can undermine
## piece-activity

- [cited] Counting available squares is not measuring activity. A piece with many moves that bear on nothing is not active.
- [noted] Active pieces do not guarantee compensation. The Halloween Gambit position in this base has genuinely active pieces and evaluates 1.75 worse.
- [noted] Activity is generally a temporary advantage and must be converted; reporting it as though it were permanent overstates it.
- [cited] *(indicator against)* A piece tied to defending something
- [layer 3] *(indicator against)* A bishop shut in by its own pawns
- [noted] *(indicator against)* A piece with moves available that accomplish nothing
## pawn-breakthrough

- [cited] A pawn sacrifice that creates a passer is not a breakthrough unless the passer actually cannot be stopped. The rule of the square decides this and is cheap to check.
- [layer 3] The pattern is highly recognisable and therefore easy to play on autopilot in a position that is one rank short of it working.
- [cited] *(indicator against)* The defending king is close enough to catch the runner — check the rule of the square first
- [**unread**] *(indicator against)* The attacking pawns are too far back; the same structure one rank earlier usually fails outright
- [**unread**] *(indicator against)* The defender can decline the capture and hold
- [**unread**] *(indicator against)* The attacker's own king is needed elsewhere and cannot support
## king-safety

- [cited] REGISTERED FALSE POSITIVE: an exposed king is not automatically losing. With the attacking pieces traded off, an exposed king is often simply an active one — and in the endgame that is the goal.
- [noted] Castling does not establish safety and failing to castle does not establish danger. A closed centre changes both.
- [cited] Counting attacking pieces linearly overstates one or two and understates four. The relationship is S-shaped, and it is not worth reporting an attack below three attackers.
- [cited] A pawn move near the king is not automatically a weakening — h3 in a quiet position is useful luft; the same move against a queenside-castled opponent is a hook.
- [cited] An exposed king is not a losing king. In a proven drawn ending both kings stand in the open with no pawn shelter, and centralising them is correct - see the recorded counterexample.
- [cited] *(indicator against)* Three or more attackers can reach the king zone
- [cited] *(indicator against)* Shield pawns advanced or missing, especially with an open file beside the king
- [**unread**] *(indicator against)* A hook the opponent can attack to open a line
- [**unread**] *(indicator against)* King uncastled with the centre open or opening
- [**unread**] *(indicator against)* Key defender exchangeable — the fianchettoed bishop, or the f6 knight
- [cited] *(indicator against)* No escape square, so back-rank tactics are live
## king-attack

- [cited] Two checks is not an attack. The repository's `kingAttack` tag fires on checks >= 2 or mate, which is a proxy for puzzle classification and NOT a definition of the concept.
- [cited] An exposed king is not automatically under attack — with the attacking pieces traded off, an exposed king is often just an active one. This is a registered false-positive case.
- [cited] Advancing pawns at a king is not an attack unless pieces can follow into the lines that open.
- [**unread**] *(indicator against)* The centre is open or can be opened by the defender
- [**unread**] *(indicator against)* Development is unfinished; a missing rook is often the exact tempo the attack lacks
- [**unread**] *(indicator against)* The defender can trade queens, which usually ends the attack
- [**unread**] *(indicator against)* The attacker has no way to bring a third piece to the sector
- [**unread**] *(indicator against)* The king's shelter is intact and there is no sacrifice that breaks it
## center-control

- [cited] Counting pawns on central squares measures occupation, not control. A fianchettoed bishop controls e4 without standing anywhere near it.
- [noted] A big pawn centre is not automatically an advantage. Whether it is an asset or a target is a question of timing and support, and that cannot be read off the structure.
- [layer 3] Central pieces are only strong while they cannot be kicked; a piece on a central square a pawn can attack is visiting.
- [layer 3] A rook or queen whose line to a central square runs through one of its own men counts as an attacker and should not be read as a piece fighting for the square. The move-based arm measures pawns and minors for this reason.
- [noted] *(indicator against)* A pawn centre that cannot advance and cannot be defended — a target, not an asset
- [noted] *(indicator against)* Central occupation achieved at the cost of development
- [noted] *(indicator against)* Central squares occupied by pieces that can be evicted with a pawn move
## blockade

- [layer 3] A piece standing in front of a pawn is not necessarily blockading it usefully. The test is whether the piece keeps its powers there — a queen on a blockading square is doing a knight's chore.
- [noted] A blockade becomes a weakness when it ties down a piece needed elsewhere, which is the standard cost and is easy to omit.
- [cited] A pawn stopped by an enemy PAWN is a ram, not a blockade, and no piece is being spent.
- [cited] *(indicator against)* The blockader is a queen or rook, which is expensive and evictable
- [noted] *(indicator against)* The blockading piece is needed elsewhere
- [noted] *(indicator against)* The pawn can be supported and the blockade broken by an advance of its neighbours
## battery

- [cited] Two line pieces on one line are only a battery if the line ARRIVES somewhere. Stacked behind their own pawns they combine nothing, and the bare geometry fires on nearly half of all positions.
- [**unread**] *(indicator against)* The line is blocked further along and cannot be opened
- [cited] *(indicator against)* The rear piece is more valuable and becomes a target itself
## check

- [cited] A check being available is not a reason to play it. Proven case: Ra7+ draws and Rg8+ loses in the same position.
## insufficient-material

- [**unread**] *(indicator against)* Any pawn, rook or queen on the board
## fifty-move-rule

- [**unread**] *(indicator against)* Any capture or pawn move in that span resets the counter
## en-passant

- [**unread**] *(indicator against)* Any other move has intervened since the two-square advance
## wrong-rook-pawn

- [cited] Being in front of the pawn is NOT enough, unlike king-and-pawn endings. The defending king must reach the corner or the square beside it — Mednis gives a position where the same setup wins with White to move and draws with Black to move.
- [noted] A second pawn on a different file usually changes the verdict entirely.
- [cited] The bishop's colour relative to the CORNER is what matters, not its current square.
- [**unread**] *(indicator against)* The bishop DOES control the promotion square — an ordinary win
- [layer 3] *(indicator against)* The defending king cannot reach the corner in time
- [noted] *(indicator against)* A second pawn on another file exists, which usually wins
- [cited] *(indicator against)* The pawn is not a rook pawn at all
## opposition

- [cited] Kings facing each other is trivially detectable and means nothing outside endgames where king penetration decides.
- [noted] Taking the opposition is not always correct. In some positions the king should ignore it and head for a key square directly — this is Averbakh's corrective and it is the standard error.
- [cited] A spare pawn tempo makes the opposition irrelevant, since it can simply be handed back.
- [cited] *(indicator against)* A spare pawn tempo exists, so the opposition can be handed back
- [**unread**] *(indicator against)* The position is decided by a race rather than by penetration
- [**unread**] *(indicator against)* Taking the opposition does not lead to any key square — Averbakh's point
- [**unread**] *(indicator against)* Enough material remains that king movement is not the deciding factor
## loose-piece

- [cited] Being loose is not being bad. Reporting every undefended piece would flag most positions and teach nothing.
- [cited] It only matters when a forcing move can reach it. A loose rook in a locked position is not a weakness.
- [**unread**] *(indicator against)* The piece is on a square nothing can reach
- [**unread**] *(indicator against)* It can be defended or moved in one tempo the opponent cannot deny
- [cited] *(indicator against)* Defending it would cost more than the risk — a loose piece is a risk, not an error
## seventy-five-move-rule

- [**unread**] *(indicator against)* The final move delivers checkmate — mate takes precedence
## king-activation

- [cited] The single most important trap is rook endings, on the testimony of the principle's own advocate: Shereshevsky found centralisation there to be not merely untimely but sometimes simply wrong, and warns against automatic centralising moves.
- [cited] A king moving towards the centre is not automatically doing the right thing; the move still has to survive checks. His example has 1...Ke5? losing to 2.Rd5+ while the retreat 1...Kc5! draws.
- [noted] Centralisation with queens still on is a different matter entirely and this concept does not apply.
- [cited] Never recommend centralising a king while the opponent has a queen, whatever the piece count says. The phase test in lib/features.js is material-based and can call a queens-on position an endgame.
- [**unread**] *(indicator against)* Queens or many pieces remain and the king can be attacked
- [**unread**] *(indicator against)* A rook ending with concrete defensive resources, where the king may be needed at home
- [**unread**] *(indicator against)* The centralising move loses time in a race
- [**unread**] *(indicator against)* The king would step into a check that gains the opponent a tempo
## pawn-break

- [layer 3] Any pawn advance into contact is mechanically a break; whether it is a good one depends on who is placed to use the lines it opens, which the detector cannot see.
- [cited] A break is not a pawn-breakthrough. This base keeps them separate: the breakthrough sacrifices to force a passer, the break challenges a structure.
- [cited] The break's value is often as an unplayed THREAT, and a position where it is available but not played may be the concept working correctly.
- [**unread**] *(indicator against)* The opponent is better developed and will use the opened lines first
- [**unread**] *(indicator against)* The break opens a line towards your own king
- [**unread**] *(indicator against)* Nothing of yours is placed to use what opens
## restraint

- [cited] Restraint is not the same as passivity. It reduces the opponent's options; a passive move merely fails to increase yours.
- [noted] Like prophylaxis, it is easy to assert after the fact about any quiet move. Name the advance being prevented.
- [**unread**] *(indicator against)* The advance being restrained was not something the opponent wanted anyway
- [**unread**] *(indicator against)* Restraining costs more than permitting
- [**unread**] *(indicator against)* The position demands speed
## castling

- [**unread**] *(indicator against)* King or that rook has moved at any earlier point
- [**unread**] *(indicator against)* King is currently in check
- [**unread**] *(indicator against)* The crossed or destination square is attacked
## discovered-check

- [**unread**] *(indicator against)* The check is easily blocked or the checking piece captured
- [**unread**] *(indicator against)* The moving piece has no useful destination
## smothered-mate

- [**unread**] *(indicator against)* A flight square is empty or can be vacated
- [**unread**] *(indicator against)* The knight's square is defended
## sacrifice

- [cited] A capture the engine happens to like is not a sacrifice. The repo's own definition is the right one: material that CAN be taken and is offered anyway, measured by SEE.
- [cited] An even trade is not a sacrifice.
- [cited] Calling a blunder a sacrifice. The difference is whether the compensation is real and nameable — annotators decide between '!' and '?' on exactly that.
- [noted] Spielmann's distinction is invisible to a material test. A forced mating sacrifice and a speculative one give up the same material and are different things; 'risk is the hallmark of the real sacrifice', and risk is not a property of the position, it is a property of what could be calculated from it.
- [cited] *(indicator against)* Material is given up with nothing nameable in return — that is a blunder, not a sacrifice
- [layer 3] *(indicator against)* The 'sacrifice' can be declined at no cost, and the offering side is then simply worse
- [noted] *(indicator against)* The compensation described is not actually present on the board
## exchange-sacrifice

- [cited] THE MAIN ONE: a rook given up inside a forced mating line is a mating sacrifice, not a positional exchange sacrifice, even though the material given is identical. The engine test on puzzle mi-bb512d9713 in this record is exactly that case — tagged exchangeSacrifice, actually mate in 2.
- [noted] Detecting 'rook for minor piece' is mechanical; deciding it was POSITIONAL requires that no forced return exists, which the material test cannot see.
- [noted] In an open position with files for the rooks, the same trade can simply be bad.
- [**unread**] *(indicator against)* Open files exist for the rooks, so a rook is worth more than the table says
- [**unread**] *(indicator against)* The compensation is an attack that can be defused, rather than a static asset
- [**unread**] *(indicator against)* The opponent can return the exchange to liquidate favourably
- [**unread**] *(indicator against)* The position is simplifying and no asset survives
## worst-placed-piece

- [noted] The rule's precondition is the load-bearing part and is usually dropped in quotation. Anderssen says 'unless you can derive immediate advantage by an attack' and Makogonov says 'in positions where no other important matters need to be considered'. Without those, it is not the rule they stated.
- [cited] Improving pieces while the opponent builds an initiative produces individually reasonable moves and a collectively lost position. This is the commonest way the rule is misapplied.
- [cited] Identifying the worst piece is a judgement, not a measurement. This system has no reliable detector for it and must not claim one.
- [**unread**] *(indicator against)* The opponent has a concrete threat that must be met
- [**unread**] *(indicator against)* A forcing line is available that decides matters
- [**unread**] *(indicator against)* The opponent is building an initiative that a quiet move would concede
