# Trap audit

Every false-positive trap a concept record states, against the matcher that
is supposed to implement it. Regenerate with `node tools/trap_audit.js
--markdown state/TRAPS.md`.

This is a READING LIST, not a verdict. "cited" means the trap has been
written about somewhere it would be enforced or excused — in the matcher, or
in a record limitation saying it cannot be built. "unread" means nobody has
written down whether it is implemented, which is true whether or not it
happens to be. The tool cannot decide whether a trap is *correctly*
implemented; that is a reading, and doing it is the work. What it can do is
stop the list being rediscovered from scratch each time — and every one of
the defects listed in the tool's header was unread before it was looked at.

**83 of 108 cited. 25 unread.**

## doubled-pawns

- [cited] REGISTERED FALSE POSITIVE: doubled pawns are not automatically weak. Detecting them is trivial; concluding weakness from the detection is wrong often enough to be a real hazard.
- [cited] The compensation is usually invisible to a structure check — the bishop pair and the opened file are elsewhere on the board.
- [cited] Doubled CENTRAL pawns are frequently an asset, controlling four squares between them.
## isolated-queen-pawn

- [cited] REGISTERED FALSE POSITIVE: an isolated pawn is not automatically a weakness. In the middlegame it is frequently the source of the better side's whole game.
- [**unread**] The structure is trivially detectable and says almost nothing on its own — the material left on the board decides the evaluation more than the structure does.
- [**unread**] Reporting it as a weakness while its owner has the initiative inverts the position.
- [cited] An isolated queen's pawn is not a weakness on sight. In the standard position measured here the side with the isolani is slightly better (+0.14).
## passed-pawn

- [cited] REGISTERED FALSE POSITIVE: a passed pawn is not automatically an advantage. A permanently blockaded passer that must be defended is a liability, and the blockading square is an excellent one for the defender.
- [cited] Detecting a passer is trivial and fires constantly in endgames. Reporting one is only informative alongside whether it can actually advance.
- [cited] A passer created from doubled pawns is often born weak.
## backward-pawn

- [cited] A pawn that is merely behind its neighbours but CAN advance safely is not backward in the operative sense.
- [cited] A backward pawn on a closed file that nothing can attack is a description, not a weakness.
- [layer 3] Reporting the pawn and not the square in front of it usually misses the more important half.
- [layer 3] A pawn with no friendly pawn on either adjacent file is ISOLATED, not backward, and reporting both names for one pawn promises the reader a hole in front of it that the isolated case does not create.
- [cited] A pawn whose advance square is occupied by an enemy pawn is RAMMED. It cannot advance, but not for the reason the concept is about, and the square in front of it is not a hole - an enemy pawn is standing on it.
## open-file

- [cited] REGISTERED FALSE POSITIVE: a file with no pawns is not automatically useful. Without an entry square, a rook on it accomplishes nothing.
- [cited] Detecting 'no pawns on this file' is trivial and fires constantly. The reportable fact is the file PLUS a usable entry square.
- [cited] Contested files where all rooks come off leave neither side with anything.
- [**unread**] An open file is not an advantage on its own. In a proven test position with a rook of each colour on the open d-file, the evaluation is +0.02 - the file belongs to nobody.
## semi-open-file

- [cited] A semi-open file is a fact about pawns; whether it produces pressure depends on whether the target is fixed and whether you can attack it more times than it can be defended.
- [cited] Both sides can have semi-open files, usually on opposite wings, and each will be attacking on their own. Reporting only one side's is half the position.
## outpost

- [layer 3] A knight on d5 is not an outpost merely because it is on d5. If ...c6 or ...e6 is available, the knight is visiting.
- [layer 3] A pawn-protected advanced square whose occupant can simply be exchanged is not an outpost in any useful sense — Romanovsky's condition fails.
- [cited] A safe square that the piece does nothing from. Safety is a precondition, not the benefit.
- [**unread**] In the engine test above, the archetypal 'outpost' move was second-best. Being a genuine outpost does not make occupying it the best move.
- [layer 3] A centralised advanced knight is not an outpost. If an enemy pawn can still challenge the square, the piece is visiting. The detector in lib/features.js checks this and correctly refuses in the recorded counterexample.
## weak-square

- [noted] Every pawn move creates squares no pawn can guard, so the raw feature fires everywhere. Usability is what makes it reportable.
- [layer 3] A fianchetto leaves permanent weak squares on the long diagonal that the bishop covers perfectly well. The square is weak; the position is not.
- [layer 3] A weak square only a queen can occupy is usually not a weakness, since cheaper pieces evict her.
## bishop-pair

- [cited] Detecting two bishops is trivial and says nothing about whether they are worth anything. In a locked position the pair can be worth less than a well-placed knight.
- [noted] Half a pawn is an AVERAGE over many games and can be arbitrarily wrong in one position.
- [cited] A bishop pair where one bishop is shut in by its own pawns is not really a pair.
## hanging-pawns

- [layer 3] Hanging pawns are not automatically weak. The structure is dynamic, and the same pair that loses one game wins the next depending on where the pieces are.
- [**unread**] Do not assess them as an isolated pawn. They defend the squares in front of one another and the pair advancing is a genuine threat.
- [noted] The detector finds the STRUCTURE. Whether it is an asset needs the piece placement, which the detector does not read.
## two-weaknesses

- [cited] Two weaknesses that the defending king stands between are not two weaknesses in the operative sense. Measured on the Lasker-Capablanca ending, moving the kings to d3/d6 costs the attacker over half the advantage.
- [cited] Any position has several imperfections. Calling any two of them 'two weaknesses' is the commonest misuse — they must require DIFFERENT defensive resources and be far enough apart that the defence cannot cover both.
- [noted] The principle describes a method of conversion, not an evaluation. A position with two weaknesses is not thereby winning, and Kotov-Pachman shows the gap: the moves annotators mark necessary and inaccurate differ by 0.05 pawns.
- [cited] Against opposite-coloured bishops or a reachable fortress, the count of weaknesses is simply not the operative variable.
- [**unread**] A pawn that is structurally weak can be the position's KEY DEFENSIVE ASSET, and no pawn-skeleton test tells the two apart. Shirov-Kramnik, Linares 2000, move 20: this base lists Black's f4 among the weaknesses White should play against, and Jan Markos calls the same pawn, together with b4, the cage that 'guards all the roads to d5'. Both readings follow from the skeleton and only one is true of the position.
## bad-bishop

- [cited] REGISTERED FALSE POSITIVE: a bishop behind its own pawns is not automatically bad in the sense that matters. Suba's active bad bishop is the counterexample, and it is common, not exotic.
- [cited] Counting pawns on the bishop's colour is mechanical and will fire on pieces that are performing well. Mobility and role must be checked too.
- [cited] A bad bishop that is the sole guardian of a weak colour complex is a load-bearing defender, not a liability.
## opposite-coloured-bishops

- [cited] The drawish reputation is an ENDGAME fact. In the middlegame with heavy pieces on, opposite-coloured bishops favour the attacker, because the bishop operates where the defender's cannot answer. Announcing 'opposite bishops, drawn' with queens on the board is the standard error.
- [**unread**] Detecting the material is trivial; whether a blockade is achievable is not.
- [**unread**] Two extra pawns are often not enough — but three files of separation often are. The count of pawns is the wrong variable; their separation and the blockade are the right ones.
## rook-on-the-seventh

- [cited] REGISTERED FALSE POSITIVE: a rook arriving on the seventh is not automatically important. With the pawns advanced and the king free, it attacks nothing and confines nobody.
- [layer 3] Two rooks on the seventh do NOT generally mate a king whose eighth rank is defended. Explaining them as a mating attack is usually wrong.
- [cited] Detecting 'rook on rank 7' is trivial and fires often; the reportable facts are what it attacks and whether the king is trapped.
- [cited] A rook reaching the seventh is not decisive by itself. With an empty seventh rank and an enemy king that has luft, a tested position evaluates level at -0.04.
## luft

- [noted] Making luft is not automatically prudent. The same move is a hook against an opponent who can storm, and this is the standard error.
- [cited] Luft is unnecessary when the back rank is adequately defended or when no heavy pieces remain.
## material-imbalance

- [cited] REGISTERED FALSE POSITIVE: the 1/3/3/5/9 count is not an evaluation. Being 'ahead on material' by that scale says very little once the material is of different kinds.
- [**unread**] Detecting the imbalance is mechanical and trivial; saying who it favours is not, and depends on open files, king safety and how much else remains.
- [noted] Statistical values are averages. They tell you what to expect across many games, not what is true in this one.
- [cited] MEASURED 2026-09-02: a knight against a bishop is not an imbalance by this record's own preferred numbers - Kaufman puts a knight and an UNPAIRED bishop at the same 3.5 - and the matcher fired on every such swap, 42.1% of the 788 shipped positions. It is a third name for a fact `bishop-pair` and `bad-bishop` already report. The exception is the pair itself, which Kaufman does separate (7.5 against 7.0), so two bishops against two knights is still reported. 42.1% -> 35.5%.
## space

- [cited] Counting controlled squares is mechanical and over-reports. Space with no entry point wins nothing.
- [cited] Advanced pawns are not automatically a space advantage — they may simply be weak and fixed.
- [noted] The cramped side's standard remedy is exchanging, so a space advantage that cannot prevent trades is temporary.
## piece-activity

- [cited] Counting available squares is not measuring activity. A piece with many moves that bear on nothing is not active.
- [**unread**] Active pieces do not guarantee compensation. The Halloween Gambit position in this base has genuinely active pieces and evaluates 1.75 worse.
- [**unread**] Activity is generally a temporary advantage and must be converted; reporting it as though it were permanent overstates it.
## pawn-breakthrough

- [cited] A pawn sacrifice that creates a passer is not a breakthrough unless the passer actually cannot be stopped. The rule of the square decides this and is cheap to check.
- [layer 3] The pattern is highly recognisable and therefore easy to play on autopilot in a position that is one rank short of it working.
## king-safety

- [cited] REGISTERED FALSE POSITIVE: an exposed king is not automatically losing. With the attacking pieces traded off, an exposed king is often simply an active one — and in the endgame that is the goal.
- [**unread**] Castling does not establish safety and failing to castle does not establish danger. A closed centre changes both.
- [cited] Counting attacking pieces linearly overstates one or two and understates four. The relationship is S-shaped, and it is not worth reporting an attack below three attackers.
- [cited] A pawn move near the king is not automatically a weakening — h3 in a quiet position is useful luft; the same move against a queenside-castled opponent is a hook.
- [cited] An exposed king is not a losing king. In a proven drawn ending both kings stand in the open with no pawn shelter, and centralising them is correct - see the recorded counterexample.
## king-attack

- [cited] Two checks is not an attack. The repository's `kingAttack` tag fires on checks >= 2 or mate, which is a proxy for puzzle classification and NOT a definition of the concept.
- [**unread**] An exposed king is not automatically under attack — with the attacking pieces traded off, an exposed king is often just an active one. This is a registered false-positive case.
- [cited] Advancing pawns at a king is not an attack unless pieces can follow into the lines that open.
## center-control

- [cited] Counting pawns on central squares measures occupation, not control. A fianchettoed bishop controls e4 without standing anywhere near it.
- [**unread**] A big pawn centre is not automatically an advantage. Whether it is an asset or a target is a question of timing and support, and that cannot be read off the structure.
- [layer 3] Central pieces are only strong while they cannot be kicked; a piece on a central square a pawn can attack is visiting.
- [layer 3] A rook or queen whose line to a central square runs through one of its own men counts as an attacker and should not be read as a piece fighting for the square. The move-based arm measures pawns and minors for this reason.
## blockade

- [layer 3] A piece standing in front of a pawn is not necessarily blockading it usefully. The test is whether the piece keeps its powers there — a queen on a blockading square is doing a knight's chore.
- [noted] A blockade becomes a weakness when it ties down a piece needed elsewhere, which is the standard cost and is easy to omit.
- [cited] A pawn stopped by an enemy PAWN is a ram, not a blockade, and no piece is being spent.
## battery

- [cited] Two line pieces on one line are only a battery if the line ARRIVES somewhere. Stacked behind their own pawns they combine nothing, and the bare geometry fires on nearly half of all positions.
## check

- [**unread**] A check being available is not a reason to play it. Proven case: Ra7+ draws and Rg8+ loses in the same position.
## wrong-rook-pawn

- [cited] Being in front of the pawn is NOT enough, unlike king-and-pawn endings. The defending king must reach the corner or the square beside it — Mednis gives a position where the same setup wins with White to move and draws with Black to move.
- [**unread**] A second pawn on a different file usually changes the verdict entirely.
- [cited] The bishop's colour relative to the CORNER is what matters, not its current square.
## opposition

- [cited] Kings facing each other is trivially detectable and means nothing outside endgames where king penetration decides.
- [**unread**] Taking the opposition is not always correct. In some positions the king should ignore it and head for a key square directly — this is Averbakh's corrective and it is the standard error.
- [**unread**] A spare pawn tempo makes the opposition irrelevant, since it can simply be handed back.
## loose-piece

- [cited] Being loose is not being bad. Reporting every undefended piece would flag most positions and teach nothing.
- [cited] It only matters when a forcing move can reach it. A loose rook in a locked position is not a weakness.
## king-activation

- [**unread**] The single most important trap is rook endings, on the testimony of the principle's own advocate: Shereshevsky found centralisation there to be not merely untimely but sometimes simply wrong, and warns against automatic centralising moves.
- [**unread**] A king moving towards the centre is not automatically doing the right thing; the move still has to survive checks. His example has 1...Ke5? losing to 2.Rd5+ while the retreat 1...Kc5! draws.
- [**unread**] Centralisation with queens still on is a different matter entirely and this concept does not apply.
- [cited] Never recommend centralising a king while the opponent has a queen, whatever the piece count says. The phase test in lib/features.js is material-based and can call a queens-on position an endgame.
## pawn-break

- [layer 3] Any pawn advance into contact is mechanically a break; whether it is a good one depends on who is placed to use the lines it opens, which the detector cannot see.
- [**unread**] A break is not a pawn-breakthrough. This base keeps them separate: the breakthrough sacrifices to force a passer, the break challenges a structure.
- [**unread**] The break's value is often as an unplayed THREAT, and a position where it is available but not played may be the concept working correctly.
## restraint

- [cited] Restraint is not the same as passivity. It reduces the opponent's options; a passive move merely fails to increase yours.
- [noted] Like prophylaxis, it is easy to assert after the fact about any quiet move. Name the advance being prevented.
## sacrifice

- [cited] A capture the engine happens to like is not a sacrifice. The repo's own definition is the right one: material that CAN be taken and is offered anyway, measured by SEE.
- [cited] An even trade is not a sacrifice.
- [cited] Calling a blunder a sacrifice. The difference is whether the compensation is real and nameable — annotators decide between '!' and '?' on exactly that.
- [noted] Spielmann's distinction is invisible to a material test. A forced mating sacrifice and a speculative one give up the same material and are different things; 'risk is the hallmark of the real sacrifice', and risk is not a property of the position, it is a property of what could be calculated from it.
## exchange-sacrifice

- [cited] THE MAIN ONE: a rook given up inside a forced mating line is a mating sacrifice, not a positional exchange sacrifice, even though the material given is identical. The engine test on puzzle mi-bb512d9713 in this record is exactly that case — tagged exchangeSacrifice, actually mate in 2.
- [noted] Detecting 'rook for minor piece' is mechanical; deciding it was POSITIONAL requires that no forced return exists, which the material test cannot see.
- [**unread**] In an open position with files for the rooks, the same trade can simply be bad.
## worst-placed-piece

- [**unread**] The rule's precondition is the load-bearing part and is usually dropped in quotation. Anderssen says 'unless you can derive immediate advantage by an attack' and Makogonov says 'in positions where no other important matters need to be considered'. Without those, it is not the rule they stated.
- [cited] Improving pieces while the opponent builds an initiative produces individually reasonable moves and a collectively lost position. This is the commonest way the rule is misapplied.
- [cited] Identifying the worst piece is a judgement, not a measurement. This system has no reliable detector for it and must not claim one.
