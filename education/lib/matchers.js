'use strict';
/* ============================================================================
 * LAYER 4 — CONCEPT MATCHING
 *
 * Which concepts the detected features actually LICENSE. This layer was
 * deliberately not built until the research existed, because writing recognition
 * rules first and then hunting for sources to justify them is the exact failure
 * mode the project is built to avoid (ARCHITECTURE.md). Every matcher below
 * therefore cites the concept record it implements, and implements only what
 * that record's `recognition` block already says.
 *
 * Three rules govern this file:
 *
 *   1. A matcher reports FEATURES PRESENT, never quality. "There are doubled
 *      pawns on c6 and c7" is in scope. "Black's structure is bad" is not, and
 *      is provably wrong in that very position.
 *   2. Nothing is forced. A position with no matching concept returns an empty
 *      list, and the API says so rather than reaching for the nearest label.
 *   3. Confidence is capped by knowledge type. A rule of thumb cannot produce a
 *      high-confidence claim however cleanly its features match, because the
 *      features were never what was uncertain about it.
 * ========================================================================== */

const MOTIF_TO_CONCEPT = {
  mate: 'checkmate', fork: 'fork', pin: 'pin', skewer: 'skewer',
  discoveredAttack: 'discovered-attack', doubleCheck: 'double-check',
  backRank: 'back-rank-mate', trappedPiece: 'trapped-piece',
  hangingPiece: 'hanging-piece',
};

// Confidence ceilings by knowledge type. The point is epistemic, not cosmetic:
// detecting an isolated pawn perfectly tells you nothing about whether the
// rule-of-thumb attached to isolated pawns applies here.
const CEILING = {
  'official-rule': 'high', 'proven-result': 'high', 'tablebase-fact': 'high',
  'tactical-motif': 'high', 'mating-pattern': 'high', 'terminology': 'high',
  'named-theoretical-position': 'high',
  'positional-concept': 'medium', 'strategic-principle': 'medium',
  'rule-of-thumb': 'low', 'practical-guideline': 'low',
  'historical-teaching-principle': 'low', 'other': 'low',
};
const ORDER = { low: 0, medium: 1, high: 2 };
/* Two ceilings, and the record's own is the one that was being ignored.
 *
 * CEILING is by knowledge_type and has been enforced since the API was written.
 * But every record also carries `typical_confidence`, which the schema defines
 * as "how confidently this concept can normally be asserted once its
 * preconditions hold" - a per-concept ceiling, more specific than its type - and
 * nothing was reading it. Measured over the 788 shipped positions, twelve
 * concepts were REPORTED above their own record's figure.
 *
 * A matcher may say less than its record. It may not say more. That is the same
 * rule the corpus already applies to this system against a human annotator, and
 * there was no reason for the records to be held to a looser one.
 */
const cap = (want, kt, typical) => {
  const byType = CEILING[kt] || 'medium';
  let c = byType;
  if (typical && typical in ORDER && ORDER[typical] < ORDER[c]) c = typical;
  return ORDER[want] < ORDER[c] ? want : c;
};

const FEAT = require('./features.js');
const DIRS = {
  R: [[1, 0], [-1, 0], [0, 1], [0, -1]],
  B: [[1, 1], [1, -1], [-1, 1], [-1, -1]],
  Q: [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]],
};
const sqIdx = name => (8 - Number(name[1])) * 8 + (name.charCodeAt(0) - 97);

const other = c => (c === 'w' ? 'b' : 'w');
const side = (f, c) => (c === 'w' ? 'White' : 'Black');

/* Some concepts presuppose a context that the bare feature test does not check,
 * and without these guards they fire on almost-empty boards: every file is
 * "open" when there are no pawns, and every square is a "hole" when there is no
 * pawn structure to make holes in. These are preconditions the concept records
 * already imply, made explicit — not thresholds tuned to taste. */
// Long lists read as noise and hide the point. Twelve holes is a fact about the
// pawn structure, not twelve separate observations worth reading.
function brief(list, max = 4) {
  if (list.length <= max) return list.join(', ');
  return list.slice(0, max).join(', ') + ` and ${list.length - max} more`;
}
const pawnCount = (f, c) => f.material[c].counts.P;
const totalPawns = f => pawnCount(f, 'w') + pawnCount(f, 'b');
const heavyCount = (f, c) => f.material[c].counts.R + f.material[c].counts.Q;
const totalHeavy = f => heavyCount(f, 'w') + heavyCount(f, 'b');
const totalPieces = f =>
  ['w', 'b'].reduce((n, c) => n + f.material[c].counts.N + f.material[c].counts.B +
                              f.material[c].counts.R + f.material[c].counts.Q, 0);

/* -------------------------------------------------------------------------
 * Structural matchers. Each returns null, or {confidence, because:[...]}.
 * `because` is a list of OBSERVATIONS, phrased so they remain true regardless
 * of what the position is worth.
 * ---------------------------------------------------------------------- */

/* Confidence says how sure we are; it does not say how much the reader learns.
 * "White's king has no escape square" and "White has a knight on an unassailable
 * d5" can both be certain, and one of them is the more useful thing to say
 * first. This is that ordering, most informative first. */
const PRIORITY = [
  // Tactics first, in order of how decisively they explain what just happened.
  // A move that forks and also leaves something hanging is a fork; reporting
  // the hanging piece first describes the incidental and buries the point.
  // The rules first, when they apply at all: stalemate and insufficient material
  // END the game, and check restricts every legal move. These are facts, not
  // judgements, and nothing informative can outrank them.
  'stalemate', 'insufficient-material', 'checkmate', 'smothered-mate', 'check',
  'discovered-check', 'promotion', 'en-passant', 'fifty-move-rule',
  'seventy-five-move-rule', 'wrong-rook-pawn',
  'double-check', 'fork', 'knight-fork', 'pin', 'skewer',
  'discovered-attack', 'back-rank-mate', 'trapped-piece', 'hanging-piece',
  'castling',

  // Then structural features, most informative first — and MEASURED, because
  // "most informative" was a judgement nobody had checked. Firing rates over
  // the 788 shipped positions with the solution move supplied, 2026-09-01:
  //
  //   two-weaknesses 72.5%   weak-square 68.9%   passed-pawn 60.4%
  //   open-file 55.7%        space 53.3%         piece-activity 44.4%
  //   material-imbalance 42.1%  semi-open-file 39.5%  doubled-pawns 34.6%
  //   center-control 26.0%   king-safety 23.5%   bishop-pair 22.6%
  //   isolated-queen-pawn 17.6%  outpost 15.5%   king-activation 15.5%
  //   rook-on-the-seventh 12.8%  restraint 12.7%  bad-bishop 12.4%
  //   opposite-coloured-bishops 10.2%  worst-placed-piece 8.4%
  //   hanging-pawns 7.2%     pawn-break 4.9%     luft 4.8%
  //   backward-pawn 1.9%     king-attack 1.5%    pawn-breakthrough 0.0%
  //
  // A concept true of three quarters of all positions cannot be the most
  // informative thing about any of them, and four of the five that led this
  // list were in that band. The corpus measured the cost: the concept a human
  // annotator said the position was ABOUT sat at mean rank 4.9, and in six of
  // twelve cases outside the six the API returns by default — reported, and
  // invisible.
  //
  // Rarity is the check on the ordering, not the definition of it. Two are
  // deliberately kept ahead of where their rate alone would put them:
  //   passed-pawn, because it names a concrete asset on a concrete square and
  //     its record makes it decisive in the endgame — 60% here is an artefact
  //     of a corpus that is one third endgames, not of the concept saying
  //     little; and
  //   pawn-breakthrough, whose 0.0% is not rarity but scope: it only runs in
  //     pure pawn endings, of which the 788 contain none. That claim has since
  //     been tested by generating pawn endings and checking the claims against
  //     Syzygy — it fires on 6.1% of random ones and is right 22 times in 24,
  //     which is why it is no longer described here or anywhere else as a
  //     PROOF, and why it now reports at medium rather than high.
  //   ...and, measured the same way when they were added: exchange-sacrifice
  //   1.3%, sacrifice 14.5%, battery 24.4%, blockade 27.3%.
  'pawn-breakthrough', 'exchange-sacrifice', 'king-attack', 'outpost',
  'rook-on-the-seventh', 'passed-pawn', 'isolated-queen-pawn', 'backward-pawn',
  'hanging-pawns', 'opposite-coloured-bishops', 'bishop-pair',
  'pawn-break', 'restraint', 'worst-placed-piece', 'bad-bishop', 'sacrifice',
  'king-safety', 'battery', 'center-control', 'blockade',
  'opposition', 'king-activation', 'loose-piece', 'doubled-pawns',

  // ...and the band that is true of most positions, last, because being true
  // here is not news.
  //
  // Re-sorted 2026-09 after four matchers were tightened against conditions
  // their own records state and had never implemented: open-file 55.7% ->
  // 35.5% once a usable entry square is required, two-weaknesses 72.5% -> 38.6%
  // once three of its four preconditions are built, piece-activity 44.4% ->
  // 33.9% once it counts active moves rather than legal ones, and weak-square
  // 68.9% -> 40.5% once the piece has to be able to STAY on the square and the
  // square has to be in the other camp. Each moved up to where the measurement
  // now puts it, and `space` 53.3% -> 34.6% once an entry square is required.
  // Nothing is left above half except `passed-pawn`, which is kept where it is
  // for the reason given above.
  //
  // Re-measure with `node tools/firing_rates.js`, which exists because this
  // measurement kept being made by hand.
  'material-imbalance', 'weak-square', 'semi-open-file', 'two-weaknesses',
  'open-file', 'space', 'piece-activity',

  // ...and `luft` last of all, which is the third denominator's doing.
  //
  // It measures 4.8% on the 788 and was ranked with the rare, specific concepts
  // for it. Measured on the 37 ANNOTATED MASTER positions - the only set here
  // where a human has said what each position is about - it fires on 48.6% and
  // is the most frequent LEAD in the file. The two numbers are both correct and
  // the puzzle one is the misleading one: puzzles are late-game positions whose
  // kings have often already moved, and master middlegames are full of castled
  // kings behind three unmoved pawns. A rarity ranking read off the wrong
  // denominator put a piece of TERMINOLOGY - which is its knowledge_type - at
  // the head of the explanation of positions Réti and Capablanca were playing.
  //
  // Its recognition is not the problem and is not touched: the matcher already
  // requires an enemy rook standing on a file that reaches the rank, which is
  // more than the record asks. Being true is not the same as being the most
  // informative thing to say. Measure all three with tools/firing_rates.js,
  // plain, --quiet and --corpus.
  'luft',
];
const priorityOf = id => {
  const i = PRIORITY.indexOf(id);
  return i === -1 ? PRIORITY.length : i;
};

/* Can the defender drive this piece away with tempo?
 *
 * `rook-on-the-seventh` states it in its indicators_against - "the rook can be
 * challenged and traded off, or driven away with gain" - and in its
 * indicators_for as "the rook cannot be evicted with tempo". A move counts when
 * it attacks the piece and the attacker survives being there; a king walking up
 * to it does not, and neither does simply capturing it, which is a different
 * fact about the position.
 */
function drivenAwayWithTempo(st, colour, square) {
  const P = FEAT.page;
  const them = other(colour);
  const i = (8 - Number(square[1])) * 8 + (square.charCodeAt(0) - 97);
  const probe = P.cloneState(st);
  probe.turn = them;
  probe.ep = null;
  let ms;
  try { ms = P.legalMoves(probe); } catch (e) { return false; }
  return ms.some(m => {
    const pc = probe.b[m.from];
    if (!pc || pc.t === 'K') return false;
    if (m.to === i) return false;                       // a capture, not an eviction
    let nx;
    try { nx = P.makeMove(probe, m); } catch (e) { return false; }
    if (P.attackersOf(nx, i, them).indexOf(m.to) < 0) return false;
    return P.see(nx, m.to, colour) <= 0;                // ...and the attacker survives
  });
}

/* "Shut in by its own pawns", in ONE place.
 *
 * `bad-bishop` decides this and `bishop-pair` needs the same answer - its
 * record's third false-positive trap is "a bishop pair where one bishop is shut
 * in by its own pawns is not really a pair", which is the bad-bishop condition
 * word for word. Two thresholds for one idea would drift, and the calibration
 * behind these numbers is not free: the scope test exists because of Suba's
 * active bad bishop and was measured against Nimzowitsch-Salwe 1911.
 */
/* Can this pawn simply step out of the way and survive?
 *
 * Two records need the same answer. `semi-open-file`: "whether it produces
 * pressure depends on whether the TARGET IS FIXED". `two-weaknesses`: "the first
 * weakness can be liquidated by a pawn break", and its definition_long insists
 * the weakness be "fixed so it cannot be advanced, exchanged or otherwise
 * repaired". A pawn that can advance safely is not a target, it is a pawn that
 * is about to leave.
 */
function canAdvanceSafely(f, colour, square) {
  const P = FEAT.page;
  let st;
  try { st = P.stateFromFEN(f.fen); } catch (e) { return false; }
  const i = (8 - Number(square[1])) * 8 + (square.charCodeAt(0) - 97);
  const probe = P.cloneState(st);
  probe.turn = colour;
  probe.ep = null;
  let ms;
  try { ms = P.legalMoves(probe); } catch (e) { return false; }
  return ms.some(m => {
    if (m.from !== i) return false;
    const pc = probe.b[m.from];
    if (!pc || pc.t !== 'P') return false;
    let nx;
    try { nx = P.makeMove(probe, m); } catch (e) { return false; }
    return P.see(nx, m.to, colour === 'w' ? 'b' : 'w') <= 0;
  });
}

function shutInByItsOwnPawns(b) {
  return b.ownPawnsOnItsColour >= 4 && b.share >= 0.60 && b.scope <= 3;
}

const STRUCTURAL = [
  {
    concept: 'doubled-pawns',
    implements: ("recognition.preconditions: two or more pawns of one colour on a file - and the " +
                 "record's three traps, which are all about not drawing the obvious conclusion: " +
                 "\"doubled pawns are not automatically weak\", \"the compensation is usually " +
                 "invisible to a structure check - the bishop pair and the opened file are elsewhere " +
                 "on the board\", and \"doubled CENTRAL pawns are frequently an asset, controlling " +
                 "four squares between them\"."),
    run(f) {
      const hits = [];
      for (const c of ['w', 'b']) if (f.pawns[c].doubled.length) hits.push({ c, sq: f.pawns[c].doubled });
      if (!hits.length) return null;
      return {
        confidence: 'high',
        because: hits.map(h => {
          let line = `${side(f, h.c)} has doubled pawns on ${h.sq.join(', ')}`;
          // Both of the compensations the record names are visible from here,
          // and the reason to say them is that a bare structure report invites
          // exactly the conclusion the record's first trap forbids. The
          // indicators_against name the same three things: "they increase
          // control of central squares", "the bishop pair was obtained in the
          // exchange", and "the doubling opened a file that is actually being
          // used".
          const central = h.sq.filter(sq => sq[0] === 'd' || sq[0] === 'e');
          if (central.length >= 2) line += ' — central, and a central pair controls four squares between them';
          if (f.pieces[h.c].bishopPair && !f.pieces[other(h.c)].bishopPair) {
            line += '; the compensation is off the pawn structure — they hold the bishop pair';
          }
          const semi = f.files.semiOpenFor[h.c] || [];
          const near = semi.filter(fl => h.sq.some(sq => Math.abs(fl.charCodeAt(0) - sq.charCodeAt(0)) === 1));
          if (near.length) line += `; and the ${brief(near)} file beside them is half-open for them`;
          // The last two compensations the record names, and both are readable
          // off the board: "they create an OUTPOST the opponent cannot contest"
          // and "they SHIELD THE KING rather than exposing it". A structure
          // report that lists neither invites the conclusion the first trap
          // forbids.
          const P2 = FEAT.page;
          let st2 = null;
          try { st2 = P2.stateFromFEN(f.fen); } catch (e) { st2 = null; }
          if (st2) {
            const fwd = h.c === 'w' ? -1 : 1;
            const holes = new Set(f.holes[h.c] || []);
            const guarded = [];
            for (const sq of h.sq) {
              const col = sq.charCodeAt(0) - 97, row = 8 - Number(sq[1]);
              for (const dc of [-1, 1]) {
                const r = row + fwd, cc = col + dc;
                if (r < 0 || r > 7 || cc < 0 || cc > 7) continue;
                const name = 'abcdefgh'[cc] + (8 - r);
                if (holes.has(name)) guarded.push(name);
              }
            }
            if (guarded.length) {
              line += `; they hold ${brief([...new Set(guarded)])}, which no enemy pawn can contest`;
            }
            const k = f.king[h.c];
            if (k && k.square) {
              const kf = k.square.charCodeAt(0), kr = Number(k.square[1]);
              const shields = h.sq.filter(sq => Math.abs(sq.charCodeAt(0) - kf) <= 1 &&
                                                (h.c === 'w' ? Number(sq[1]) > kr : Number(sq[1]) < kr));
              if (shields.length >= 2) {
                line += `; and ${brief(shields)} stand in front of their own king — here they shield it ` +
                        `rather than expose it`;
              }
            }
          }
          return line;
        }),
        slots: { file: hits[0].sq[0][0], square: hits[0].sq.join(', ') },
        subjects: hits.map(h => h.c),
      };
    },
  },
  {
    concept: 'isolated-queen-pawn',
    implements: "recognition: an isolated pawn specifically on the d-file",
    run(f) {
      // The isolated queen's pawn is a structure with pieces around it. A lone
      // d-pawn in a pawn ending is not an IQP, it is a passed pawn - and a lone
      // d-pawn in a ROOK ending is not one either, which is what this reported
      // in Capablanca-Tartakower 1924. The named structure needs a minor piece
      // or a queen on the board; with only rooks it is just an isolated pawn.
      const minorsOrQueens = ['w', 'b'].reduce((n, c) =>
        n + f.material[c].counts.N + f.material[c].counts.B + f.material[c].counts.Q, 0);
      if (minorsOrQueens === 0) return null;
      const hits = [];
      for (const c of ['w', 'b']) {
        if (pawnCount(f, c) < 2) continue;
        const d = f.pawns[c].isolated.filter(s => s[0] === 'd');
        if (d.length) hits.push({ c, sq: d });
      }
      if (!hits.length) return null;
      // The sentence deliberately reports the STRUCTURE and not a verdict, and
      // the wording layer supplies the record's two-sided reading. That is this
      // record's registered false positive: "an isolated pawn is not
      // automatically a weakness. In the middlegame it is frequently the source
      // of the better side's whole game", and again, measured: "an isolated
      // queen's pawn is not a weakness on sight. In the standard position
      // measured here the side with the isolani is slightly better (+0.14)."
      // Nothing here may say "weak"; test_explanations.js enforces that.
      return {
        confidence: 'high',
        because: hits.map(h => `${side(f, h.c)} has an isolated pawn on ${h.sq.join(', ')} with no friendly pawn on the c- or e-file`),
        slots: { square: hits[0].sq.join(', '), squares: 'c5 and e5' },
        subjects: hits.map(h => h.c),
      };
    },
  },
  {
    concept: 'passed-pawn',
    implements: ("recognition.preconditions: no enemy pawn ahead on its file or either adjacent file " +
                 "- plus the record's first two traps, which ask for information rather than for " +
                 "silence: whether it can actually advance, and whether it was born of a doubled pair."),
    run(f) {
      const hits = [];
      for (const c of ['w', 'b']) {
        // Blockaded passers are excluded, on the concept's own authority: its
        // record says a permanently blockaded passer is a liability rather than
        // an asset. Tested against Reshevsky-Petrosian 1953, this matcher led
        // with "White has a passed pawn on d4" in the position of Petrosian's
        // famous exchange sacrifice — true, blockaded, and beside the point.
        const blocked = new Set(f.pawns[c].blockadedPassers || []);
        const live = f.pawns[c].passed.filter(sq => !blocked.has(sq));
        if (live.length) hits.push({ c, sq: live });
      }
      if (!hits.length) return null;
      // "Detecting a passer is trivial and fires constantly in endgames.
      // Reporting one is only informative alongside whether it can actually
      // advance." That is the record's first trap, and note what it asks for:
      // not that the concept be suppressed - a passer that cannot move today is
      // still a passer, and this is the most-reported concept in the base at
      // 60.4% for a reason - but that the sentence carry the other half. So the
      // push is tried, and whether it survives is said out loud.
      const P = FEAT.page;
      const st = P.stateFromFEN(f.fen);
      const canAdvance = (c, sq) => {
        const probe = P.cloneState(st); probe.turn = c; probe.ep = null;
        let ms; try { ms = P.legalMoves(probe); } catch (e) { return null; }
        const from = (8 - Number(sq[1])) * 8 + (sq.charCodeAt(0) - 97);
        const push = ms.find(m => m.from === from && (m.to & 7) === (from & 7));
        if (!push) return false;
        const nx = P.makeMove(probe, push);
        return P.see(nx, push.to, other(c)) <= 0;
      };
      // "A passer created from doubled pawns is often born weak" - the second
      // trap, and a fact this base can read straight off the structure.
      const doubled = c => new Set(f.pawns[c].doubled || []);
      // "It stands on a square where it is easily attacked" - the record's third
      // indicator_against, and the third thing this sentence can carry rather
      // than suppress. A passer under more fire than it has defence is a target
      // being called an asset, which is the shape of every complaint in this
      // record.
      const underFire = (c, sq) => {
        const i = (8 - Number(sq[1])) * 8 + (sq.charCodeAt(0) - 97);
        try {
          return P.attackersOf(st, i, other(c)).length > P.attackersOf(st, i, c).length;
        } catch (e) { return false; }
      };
      return {
        confidence: 'high',
        because: hits.map(h => {
          const moving = h.sq.filter(sq => canAdvance(h.c, sq));
          const born = h.sq.filter(sq => doubled(h.c).has(sq));
          let line = `${side(f, h.c)} has a passed pawn on ${brief(h.sq)}`;
          if (!moving.length) line += ', which cannot advance without being taken';
          else if (moving.length < h.sq.length) line += `, of which ${brief(moving)} can safely advance`;
          const hot = h.sq.filter(sq => underFire(h.c, sq));
          if (hot.length) {
            line += `; ${brief(hot)} ${hot.length === 1 ? 'is' : 'are'} attacked more times than defended, ` +
                    `which is a target rather than an asset`;
          }
          if (born.length) {
            line += born.length === 1
              ? `; the one on ${born[0]} is half of a doubled pair, which is how a passer is born weak`
              : `; ${brief(born)} are doubled, which is how a passer is born weak`;
          }
          return line;
        }),
        slots: { square: hits[0].sq[0] },
        subjects: hits.map(h => h.c),
      };
    },
  },
  {
    concept: 'backward-pawn',
    implements: ("recognition: lagging behind its neighbours with its advance square controlled by " +
                 "an enemy pawn - and the record's second trap, which had never been built: \"a " +
                 "backward pawn on a closed file that nothing can attack is a description, not a " +
                 "weakness.\" The file must be half-open for the opponent - and, for the same " +
                 "reason one step further, \"No enemy rook can reach the file\": the opponent " +
                 "must actually own a rook or a queen."),
    run(f) {
      const hits = [];
      for (const c of ['w', 'b']) {
        // The first trap - "a pawn that is merely behind its neighbours but CAN
        // advance safely is not backward in the operative sense" - is Layer 3's,
        // and is built there: the advance square has to be controlled by an
        // enemy pawn, which is what makes advancing unsafe by definition.
        //
        // The second is this. A backward pawn nobody can get at is a shape, not
        // a target: the opponent needs the file to bring a rook down. 10 of the
        // 15 backward pawns on the 788 shipped positions stand on a file that is
        // half-open for the opponent; the other five are descriptions.
        // ...and the sharper form of the same condition, which the record states
        // as an indicator_against and which the half-open test does not cover:
        // "No enemy rook can reach the file". A half-open file says the file is
        // AVAILABLE; it says nothing about whether the opponent owns anything
        // that wants it. In a pure minor-piece ending a backward pawn on a
        // half-open file is a description again, for the same reason it is one
        // on a closed file - nothing can get at it.
        //
        // The record's first indicator_against, "It can advance at a moment of
        // its choosing, so the defect is temporary", is the same condition as
        // its first trap and is enforced in Layer 3: the advance square has to
        // be controlled by an enemy pawn, so a pawn that can advance at a moment
        // of its choosing is not in the backward set at all.
        if (f.material[other(c)].counts.R + f.material[other(c)].counts.Q === 0) continue;
        const semi = new Set(f.files.semiOpenFor[other(c)] || []);
        const real = f.pawns[c].backward.filter(sq => semi.has(sq[0]));
        if (real.length) hits.push({ c, sq: real });
      }
      if (!hits.length) return null;
      return {
        confidence: 'medium',
        because: hits.map(h => `${side(f, h.c)}'s pawn on ${h.sq.join(', ')} cannot advance without being met by an enemy pawn, and no friendly pawn can support it from behind`),
        slots: { square: hits[0].sq[0] },
        subjects: hits.map(h => h.c),
      };
    },
  },
  {
    concept: 'open-file',
    implements: ("recognition.preconditions: a file with no pawns of either colour, plus the " +
                 "record's registered false positive and three of its indicators_against - a usable " +
                 "entry square (\"every entry square on the file is defended, the rook stares and " +
                 "does nothing\"), no enemy heavy piece contesting it (\"the opponent can contest " +
                 "the file and trade all the rooks off\"), and the file not shuttable (\"the file " +
                 "can be closed by a pawn advance\")."),
    run(f) {
      // The concept's own record says a file with no entry point does nothing,
      // and mass testing over 788 positions showed this firing on 61% of them -
      // a label that common carries almost no information. Require a rook or
      // queen actually standing on the file, which is what makes it this side's
      // file rather than a fact about the pawns.
      if (!f.files.open.length || totalHeavy(f) === 0) return null;
      // ...and the record's REGISTERED false positive, which had never been
      // implemented: "a file with no pawns is not automatically useful. Without
      // an entry square, a rook on it accomplishes nothing." The same record
      // says it again as a trap: "detecting 'no pawns on this file' is trivial
      // and fires constantly. The reportable fact is the file PLUS a usable
      // entry square." Requiring a rook on
      // the file took this from 61% to 55.7%; requiring the rook to be able to
      // ENTER - a legal move down the file into the opponent's half after which
      // static exchange evaluation does not win it - takes it to 35.5%, and it
      // is the difference between a fact about the pawns and a plan.
      const P = FEAT.page;
      const st = P.stateFromFEN(f.fen);
      const cols = new Set(f.files.open.map(x => x.charCodeAt(0) - 97));
      const entries = [];
      for (const c of ['w', 'b']) {
        if (!f.pieces[c].rooksOnOpenFiles.length) continue;
        let moves;
        if (st.turn === c) {
          try { moves = P.legalMoves(st); } catch (e) { continue; }
        } else {
          const flipped = P.cloneState(st);
          flipped.turn = c; flipped.ep = null;
          try { moves = P.legalMoves(flipped); } catch (e) { continue; }
        }
        const base = st.turn === c ? st : (() => { const q = P.cloneState(st); q.turn = c; q.ep = null; return q; })();
        const hit = moves.find(m => {
          const pc = base.b[m.from];
          if (!pc || pc.t !== 'R' || pc.c !== c) return false;
          if (!cols.has(m.from & 7) || (m.to & 7) !== (m.from & 7)) return false;
          const row = m.to >> 3;
          if (!(c === 'w' ? row <= 3 : row >= 4)) return false;
          const nx = P.makeMove(base, m);
          if (P.see(nx, m.to, other(c)) > 0) return false;
          // ...and the record's third trap: "contested files where all rooks
          // come off leave neither side with anything". An entry that is simply
          // met by the enemy rook on the same file is a trade, not an entry, and
          // a first version reported BOTH sides as having one on a file where
          // each had doubled rooks facing the other.
          for (let rr = 0; rr < 8; rr++) {
            const q = base.b[rr * 8 + (m.to & 7)];
            if (q && q.c === other(c) && (q.t === 'R' || q.t === 'Q')) return false;
          }
          // ...and the last of the record's indicators_against that a static
          // scan can answer: "the file can be closed by a pawn advance." A file
          // the defender shuts with one safe pawn move is not a file, it is a
          // file until they get a move. Measured: this costs 0.1 points of the
          // firing rate, 35.5% -> 35.4%, because a file is open precisely when
          // both pawns have left it and a pawn arriving from an adjacent file is
          // rare. Built and near-inert, and saying so is the honest report.
          const col = m.to & 7;
          const them = other(c);
          const shut = P.cloneState(base);
          shut.turn = them; shut.ep = null;
          let theirs;
          try { theirs = P.legalMoves(shut); } catch (e) { theirs = []; }
          const closable = theirs.some(x => {
            const q = shut.b[x.from];
            if (!q || q.t !== 'P' || q.c !== them) return false;
            if ((x.to & 7) !== col) return false;
            let nx2; try { nx2 = P.makeMove(shut, x); } catch (e) { return false; }
            return P.see(nx2, x.to, c) <= 0;
          });
          if (closable) return false;
          return true;
        });
        if (hit) entries.push({ c, from: FEAT.nameOf(hit.from), to: FEAT.nameOf(hit.to) });
      }
      if (!entries.length) return null;
      const e0 = entries[0];
      return {
        confidence: 'high',
        because: entries.map(e => `${side(f, e.c)}'s rook on ${e.from} stands on an open file with a square to ` +
                                  `enter on: ${e.to}, where nothing wins it`),
        slots: { file: e0.from[0], square: e0.to },
        subjects: entries.map(e => e.c),
      };
    },
  },
  {
    concept: 'semi-open-file',
    implements: ("recognition.preconditions: a file carrying an enemy pawn and none of your own - " +
                 "AND the whole of the record's first trap, which this used to quote and not build: " +
                 "\"whether it produces pressure depends on whether the target is FIXED and whether " +
                 "you can attack it MORE TIMES THAN IT CAN BE DEFENDED.\" Both halves are answerable " +
                 "and neither was asked."),
    run(f) {
      if (totalHeavy(f) === 0) return null;      // same reason as open-file
      const hits = [];
      for (const c of ['w', 'b']) {
        const files = f.files.semiOpenFor[c];
        if (!files.length) continue;
        const rooks = f.pieces[c].rooksOnSemiOpenFiles;
        hits.push({ c, files, rooks });
      }
      if (!hits.length) return null;
      // Firing on 83% of tested positions before any guard. Nearly every
      // position has a semi-open file somewhere; what is worth reporting is one
      // a rook is actually using, and then only when it is doing something.
      //
      // The record states the whole test and this matcher used to quote it and
      // build none of it: "a semi-open file is a fact about pawns; whether it
      // produces pressure depends on whether the TARGET IS FIXED and whether you
      // can ATTACK IT MORE TIMES THAN IT CAN BE DEFENDED." A comment here used to
      // say a rook on the file was "the half a static scan can answer", which was
      // a claim nobody had checked: both halves are answerable, and neither was
      // asked. Its indicators_against say the same thing twice more - "the pawn
      // can simply advance" and "the file has no entry square beyond the pawn".
      //
      // FIXED: the enemy pawn on the file has no safe advance. A pawn that can
      // step out of the way is not a target, it is a pawn that is about to leave.
      // OUTNUMBERED: we attack it at least as many times as they defend it.
      // Attacking it fewer times than it is defended is a rook staring at a wall,
      // which is the record's "the rook stares and does nothing".
      //
      // ...and BOTH sides, which is the record's second trap: "both sides can
      // have semi-open files, usually on opposite wings, and each will be
      // attacking on their own. Reporting only one side's is half the position."
      const P = FEAT.page;
      const st = P.stateFromFEN(f.fen);
      const targetOf = (c, file) => {
        const col = file.charCodeAt(0) - 97;
        for (let r = 0; r < 8; r++) {
          const i = r * 8 + col, q = st.b[i];
          if (q && q.t === 'P' && q.c === other(c)) return i;
        }
        return -1;
      };
      // "The pawn can simply advance" - and what that has to MEAN on a file is
      // narrower than it looks, because a pawn that advances is still on the
      // same file. Nimzowitsch-Capablanca 1914 is the position that settled it:
      // the annotators name "play on the open b-file" and say the b2 pawn falls
      // six moves later, and a first version of this test dropped the b-file
      // because b2-b3 is a perfectly safe move. It is - and the pawn is still
      // on b3, still on the file, still outnumbered. So the escape is not the
      // advance; the escape is arriving somewhere it is no longer attacked more
      // often than it is defended.
      const outnumbered = (s, c, i) => {
        try {
          const a = P.attackersOf(s, i, c).length, d = P.attackersOf(s, i, other(c)).length;
          return a > 0 && a >= d;
        } catch (e) { return false; }
      };
      const canStepAway = (c, i) => {
        const them = other(c);
        const probe = P.cloneState(st); probe.turn = them; probe.ep = null;
        let ms; try { ms = P.legalMoves(probe); } catch (e) { return true; }
        return ms.some(m => {
          if (m.from !== i) return false;
          const pc = probe.b[m.from];
          if (!pc || pc.t !== 'P') return false;
          let nx; try { nx = P.makeMove(probe, m); } catch (e) { return false; }
          if (P.see(nx, m.to, c) > 0) return false;      // it does not survive leaving
          return !outnumbered(nx, c, m.to);              // ...and it is no longer outnumbered
        });
      };
      const withRook = [];
      for (const h of hits) {
        if (!h.rooks.length) continue;
        const useful = h.files.filter(fl => {
          const i = targetOf(h.c, fl);
          if (i < 0) return false;
          if (!h.rooks.some(sq => sq[0] === fl)) return false;   // a rook on THIS file
          if (canStepAway(h.c, i)) return false;                 // not a fixed target
          return outnumbered(st, h.c, i);
        });
        if (useful.length) withRook.push({ ...h, useful });
      }
      if (!withRook.length) return null;
      const lead = withRook[0];
      return {
        confidence: 'high',
        // The record's condition is strictly "attack it MORE TIMES THAN IT CAN
        // BE DEFENDED", and that is the condition for WINNING the pawn. At
        // parity the pawn is not falling and the file is not nothing either: the
        // defender is committed to it. Reporting only the strict case measures
        // 8.6% and loses the b-file in Nimzowitsch-Capablanca 1914, which is the
        // file the annotators name and where "six moves later the pawn on b2
        // falls". So both are reported and the sentence says which. Seventh time
        // in three sessions that saying more beat firing less.
        because: withRook.map(h => {
          const fl = h.useful[0];
          const i = targetOf(h.c, fl);
          let a = 0, d = 0;
          try {
            a = P.attackersOf(st, i, h.c).length;
            d = P.attackersOf(st, i, other(h.c)).length;
          } catch (e) { /* ignore */ }
          return `${side(f, h.c)} has a rook on ${h.rooks.filter(sq => h.useful.includes(sq[0])).join(' and ')}, ` +
                 `bearing down the semi-open ${fl}-file on ${FEAT.nameOf(i)}, which cannot step out of the way` +
                 (a > d
                   ? `, and is attacked ${a} times against ${d} defending it`
                   : `, and is defended exactly as many times as it is attacked — the pawn is not falling ` +
                     `yet, but the defence is committed to it`);
        }),
        slots: { file: lead.useful[0] },
        subjects: withRook.map(h => h.c),
      };
    },
  },
  {
    concept: 'outpost',
    implements: ("recognition: a minor piece on a square no enemy pawn can attack, defended by a " +
                 "friendly pawn - and doing something from there, which is the record's second " +
                 "trap: \"a safe square that the piece does nothing from. Safety is a precondition, " +
                 "not the benefit.\""),
    run(f) {
      const P = FEAT.page;
      const st = P.stateFromFEN(f.fen);
      const hits = [];
      for (const c of ['w', 'b']) {
        // An outpost is about influence over the opponent's position, so a
        // knight on the a- or h-file does not qualify however unassailable it
        // is. Tested against Capablanca-Tartakower 1924, this reported Black's
        // a5 knight - the worst piece on the board and the one Capablanca was
        // happy to see there - as an outpost.
        //
        // ...and it must be DOING something there. "A safe square that the piece
        // does nothing from. Safety is a precondition, not the benefit" is the
        // record's second trap, and the same record says it again as an
        // indicator_against - "the piece on the square attacks nothing and
        // restricts nothing; it is safe but idle". It had never been built: the
        // piece has to bear on an enemy man or on squares inside the enemy camp,
        // or the report is about a square rather than about a plan.
        //
        // The record's second indicator_against widens the rim test to the b-
        // and g-files as well, and only for knights: "the square is on the
        // a/b/g/h files and the intended occupant is a knight - Nimzowitsch
        // assigns flank outposts to rooks." A knight on the rim is proverbially
        // dim; a rook on a flank outpost is a file being used. 15.4% -> 11.9%
        // of the 788 shipped positions, which is more than it looks: a
        // pawn-defended knight on b5 or g5 in the enemy half is not rare in a
        // corpus of tactical puzzles, and every one of those was being called an
        // outpost by a base whose own record assigns the square to a rook.
        const RIM = 'abgh';
        const o = f.outposts[c].filter(x => x.square[0] !== 'a' && x.square[0] !== 'h')
                               .filter(x => !(x.piece === 'N' && RIM.includes(x.square[0])))
                               .filter(x => FEAT.bearsFrom(st, c, (8 - Number(x.square[1])) * 8 + (x.square.charCodeAt(0) - 97)));
        if (o.length) hits.push({ c, o });
      }
      if (!hits.length) return null;
      // "The occupant can be TRADED OFF by a knight or a same-coloured bishop
      // with no compensation" - the record's first indicator_against. A piece
      // that cannot be driven off but can be swapped off is holding the square
      // on loan, and that is worth saying rather than hiding: the square is
      // still a hole afterwards, but the piece is gone.
      const tradeable = (c, x) => {
        const i = sqIdx(x.square);
        let atk;
        try { atk = FEAT.page.attackersOf(st, i, other(c)); } catch (e) { return false; }
        return atk.some(j => {
          const q = st.b[j];
          if (!q) return false;
          if (q.t === 'N') return true;
          return q.t === 'B' && FEAT.isLight(j) === FEAT.isLight(i);
        });
      };
      return {
        confidence: 'high',
        because: hits.map(h => {
          const swap = h.o.filter(x => tradeable(h.c, x));
          return `${side(f, h.c)}'s ${h.o.map(x => `${x.piece === 'N' ? 'knight' : 'bishop'} on ${x.square}`).join(' and ')} ` +
                 `cannot be driven off by a pawn, is defended by one, and bears on the position behind it` +
                 (swap.length
                   ? ` — though it can be traded off on ${brief(swap.map(x => x.square))}, and the square is ` +
                     `held on loan until it is`
                   : '');
        }),
        slots: { square: hits[0].o[0].square,
                 piece: hits[0].o[0].piece === 'N' ? 'knight' : 'bishop' },
        subjects: hits.map(h => h.c),
      };
    },
  },
  {
    concept: 'weak-square',
    implements: ("recognition: a square in the opponent's camp that no pawn of theirs can ever " +
                 "attack, that a minor piece can reach and survive on, and that is neither on " +
                 "the edge nor in our own half — false_positive_traps 1 and 2, indicators_against 3 and 4"),
    run(f) {
      const hits = [];
      // A hole is a hole in something, and a hole nothing can use is not worth
      // mentioning - the strong-square record says a strong square is worth
      // nothing if nothing valuable can reach it. Before this guard the matcher
      // fired on 57% of 788 tested positions, which is a label carrying almost
      // no information. Report a hole a minor piece can actually move to: that
      // is a plan rather than a fact about the pawn structure. Squares already
      // occupied are left to the outpost matcher, which says more about them.
      //
      // Together with the survival test in reachableHoles(): 68.9% -> 40.5%.
      //
      // The record's `indicators_against` names two more, and this used to
      // implement neither: "it is on the edge, or deep in the opponent's own
      // half". A hole on a3 is a square, not a weakness, and a square in one's
      // OWN half is not what the definition is about at all - "a square in one's
      // own camp that can no longer be controlled by a pawn". holesFor() spans
      // three ranks because `outpost` legitimately wants the middle one; the
      // weak-square CLAIM does not, so the narrowing is here rather than in
      // Layer 3, where it would silently change what an outpost is.
      for (const c of ['w', 'b']) {
        if (pawnCount(f, other(c)) < 3) continue;
        const taken = new Set((f.outposts[c] || []).map(o => o.square));
        const usable = (f.reachableHoles[c] || []).filter(sq => {
          if (taken.has(sq)) return false;
          if (sq[0] === 'a' || sq[0] === 'h') return false;
          const rank = +sq[1];
          return c === 'w' ? rank >= 5 : rank <= 4;
        });
        if (usable.length) hits.push({ c, sq: usable });
      }
      if (!hits.length) return null;
      return {
        confidence: 'medium',
        because: hits.map(h => `${side(f, h.c)} can put a minor piece on ${brief(h.sq)}, where no enemy pawn can attack it`),
        slots: { square: hits[0].sq[0] },
        subjects: hits.map(h => h.c),
      };
    },
  },
  {
    concept: 'bishop-pair',
    implements: ("recognition.preconditions: two bishops of opposite square colours, opponent has " +
                 "fewer - AND the record's third false-positive trap, which the earlier version " +
                 "ignored: 'a bishop pair where one bishop is shut in by its own pawns is not really " +
                 "a pair'. Decided by the same test `bad-bishop` uses, so there is one definition. " +
                 "Plus the other two indicators_against - 'a locked pawn structure with no way to " +
                 "open it' and 'the opponent has a knight on a secure outpost' - which downgrade " +
                 "rather than suppress, for the same reason: the pair is a fact."),
    run(f) {
      for (const c of ['w', 'b']) {
        if (f.pieces[c].bishopPair && !f.pieces[other(c)].bishopPair) {
          // Two bishops are trivial to count and the count says nothing about
          // whether they are worth anything - the record's first trap. The one
          // condition it states mechanically is the third, and it is this.
          // What the API says about a pair is advice premised on it being an
          // asset ("open the position to use it, and avoid trading either one"),
          // and that advice is actively wrong for a pair with a buried bishop.
          //
          // It DOWNGRADES rather than suppresses, and the direction matters. A
          // first version refused the pair outright when one bishop was buried,
          // and that produced a false negative on this corpus's own annotated
          // bishop-pair position - Havasi-Capablanca 1929, where White's c1
          // bishop shares its colour with five of its six pawns and sees one
          // square, and the annotation is precisely that Capablanca showed the
          // pair to be overrated. The pair is a FACT and the fact is high
          // confidence; whether it is worth anything is the conditional part.
          // Letting bad-bishop veto it would also be letting a test whose own
          // record says "the conclusion it invites is frequently wrong", and
          // which reports at LOW confidence for that reason, overrule a
          // certainty. So the pair is still reported, at low confidence, and the
          // sentence says which bishop is buried instead of advising the reader
          // to keep them both.
          // The record's other two indicators_against, and they are refutations
          // of the pair rather than of the fact: "a locked pawn structure with
          // no way to open it" and "the opponent has a knight on a secure
          // outpost". Both are answerable and neither was asked. They are
          // handled the same way the buried bishop is - the pair is still a
          // fact, so it is reported, at low confidence, with the reason named.
          // Measured: 5 of the 178 positions where a pair exists are locked, 14
          // have an enemy knight on an outpost, 18 have one or the other.
          const st = FEAT.page.stateFromFEN(f.fen);
          const locked = FEAT.lockedFor(st, c);
          const knight = (f.outposts[other(c)] || []).some(x => x.piece === 'N');
          const buried = (f.pieces[c].bishops || []).filter(shutInByItsOwnPawns);
          if (!buried.length && (locked || knight)) {
            return {
              confidence: 'low',
              because: [`${side(f, c)} has both bishops and ${side(f, other(c))} does not — but ` +
                        (locked
                          ? 'the pawns are locked nose to nose with no break available, which is the ' +
                            'structure the pair is worth least in'
                          : `${side(f, other(c))} has a knight on an outpost, which is the piece the pair ` +
                            'is least able to do anything about')],
              subjects: [c],
            };
          }
          if (buried.length) {
            return {
              confidence: 'low',
              because: [`${side(f, c)} has both bishops, but the one on ${buried[0].square} shares its ` +
                        `colour with ${buried[0].ownPawnsOnItsColour} of its own ${buried[0].ownPawnsTotal} ` +
                        `pawns and sees ${buried[0].scope === 1 ? 'one square' : buried[0].scope + ' squares'} ` +
                        `— a pair with a bishop shut in by its own pawns is not really a pair`],
              subjects: [c],
            };
          }
          return {
            confidence: 'high',
            because: [`${side(f, c)} has both bishops and ${side(f, other(c))} does not`],
            subjects: [c],
          };
        }
      }
      return null;
    },
  },
  {
    concept: 'hanging-pawns',
    implements: ("recognition.preconditions: two friendly pawns abreast on adjacent files, no " +
                 "friendly pawn on either flanking file, both files half-open for the opponent"),
    run(f) {
      for (const c of ['w', 'b']) {
        const weak = f.pawns[c].undefendable || [];
        for (const a of weak) {
          for (const b of weak) {
            if (a >= b) continue;
            const sameRank = a[1] === b[1];
            const adjacent = Math.abs(a.charCodeAt(0) - b.charCodeAt(0)) === 1;
            // ...and NO FRIENDLY PAWN ON EITHER FLANKING FILE. The `implements`
            // string above has claimed this since the matcher was written and
            // the code never tested it, which is the second `implements` string
            // found overstating today. The record says it as an
            // indicator_against - "a friendly pawn still stands on a flanking
            // file: then it is a chain, not a hanging pair" - and it is the
            // difference between the structure and a phalanx of three. b5-c5-d5
            // was being reported as hanging pawns on c5 and d5.
            const files = f.pawns[c].files || [];
            const left = String.fromCharCode(Math.min(a.charCodeAt(0), b.charCodeAt(0)) - 1);
            const right = String.fromCharCode(Math.max(a.charCodeAt(0), b.charCodeAt(0)) + 1);
            const flanked = files.includes(left) || files.includes(right);
            if (sameRank && adjacent && !flanked) {
              return {
                confidence: 'medium',
                because: [`${side(f, c)} has hanging pawns on ${a} and ${b} — abreast, on half-open ` +
                          `files, and no pawn can defend either`],
                slots: { square: a },
                subjects: [c],
              };
            }
          }
        }
      }
      return null;
    },
  },
  {
    concept: 'two-weaknesses',
    implements: ("definition: one weakness can usually be held; a second on the FAR SIDE of the " +
                 "board stretches a finite defence past breaking. The file distance between the " +
                 "weaknesses is therefore the concept, not their number"),
    run(f) {
      // Three of this record's four preconditions were written down and never
      // implemented, and the matcher fired on 72.5% of the 788 shipped
      // positions - which is the record's OWN second trap, "any position has
      // several imperfections; calling any two of them 'two weaknesses' is the
      // commonest misuse". Found by the corpus: the one entry whose annotated
      // concept is two-weaknesses had been pushed to rank 8, outside the six the
      // API returns, because the concept had to be ranked last to stop it
      // leading everywhere. The fix belongs in the recognition, not the order.
      //
      //   the attacker "has no weakness of comparable value"  -> 42.8%
      //   "a piece that can change wings faster than the defender can follow
      //    (rook or queen)"                                   -> 68.1%
      //   and the first trap, that weaknesses "the defending king stands
      //    between" are not two weaknesses in the operative sense -> 41.5%
      //
      // Together, in the form below: 38.6%, and it still fires on
      // Rubinstein-Salwe 1908, which is the textbook game and this base's own
      // corpus entry. A stricter reading of the first condition reaches 21.3%
      // and loses that game, which is how the loosening below was chosen.
      for (const c of ['w', 'b']) {
        const s = f.weakSpread[other(c)];
        if (!s || !s.separated || s.weak.length < 2) continue;
        // "The attacker has no weakness of comparable value" is a precondition
        // this base can only approximate, and the approximation had to be
        // loosened once it was tested. Requiring the attacker to have STRICTLY
        // fewer weak pawns removed Rubinstein-Salwe 1908 - the textbook game and
        // this corpus's own entry - because after 9.Nxc6 bxc6 White's b2 and e2
        // count the same as Black's a7 and c6, and they are not comparable in
        // any sense a human would recognise: one pair is a fixed target complex
        // on half-open files, the other is two pawns on their original squares
        // on move nine. A count cannot tell those apart. So the test is only
        // that the attacker is not MORE weak than the defender, and the rest of
        // the precondition is recorded as a limitation rather than pretended.
        // "Against opposite-coloured bishops or a reachable fortress, the count
        // of weaknesses is simply not the operative variable" - the record's
        // fourth trap. This base can answer the first half: with one bishop each
        // on opposite colours the defender holds a whole colour complex whatever
        // the count says, and the concept's own definition_long makes the same
        // point about the defending king covering both targets.
        if (f.pieces.oppositeColouredBishops) continue;
        const mine = f.weakSpread[c] || { weak: [] };
        if (mine.weak.length > s.weak.length) continue;
        if (f.material[c].counts.R + f.material[c].counts.Q === 0) continue;
        // Three of this record's indicators_against are already enforced above
        // and are quoted here so the reading list can see them: "the two targets
        // are within two files of each other, so one defending king covers both"
        // is the spread test, deliberately calibrated to two rather than three
        // and argued on the record; "the defending king already stands between
        // the two targets" is the king-file check; and "opposite-coloured
        // bishops with no breakthrough square - the defending bishop holds one
        // colour complex regardless of how many targets exist" is the refusal
        // added a day earlier.
        //
        // "The first weakness can be LIQUIDATED by a pawn break or a favourable
        // exchange" - an indicator_against, and the buildable half is the pawn
        // break: a weak pawn that can simply advance out of the attack is not
        // yet a fixed target, and the record's definition_long insists the first
        // weakness be "fixed so it cannot be advanced, exchanged or otherwise
        // repaired". The same test `semi-open-file` uses, for the same reason.
        //
        // It is SAID, not enforced, and two measurements decided that. Requiring
        // both weaknesses to be fixed scores 23.1% and deletes Rubinstein-Salwe
        // 1908; requiring one scores 29.4% and deletes it as well. At the moment
        // the annotator marks - 9.Nxc6 bxc6, where the weaknesses are CREATED -
        // both a7 and c6 can still advance, and Rubinstein's entire game is
        // about preventing ...c5. The annotation marks the creation; the record's
        // method describes what is done afterwards. A matcher that fires only
        // once the fixing is done cannot report the game the concept is named
        // for, so the sentence names what still has to be fixed instead. Sixth
        // time in two sessions that saying more beat firing less.
        const loose = s.weak.filter(sq => canAdvanceSafely(f, other(c), sq));
        const files = s.weak.map(x => x.charCodeAt(0) - 97);
        const kf = ((f.king[other(c)] || {}).square || 'e1').charCodeAt(0) - 97;
        if (kf > Math.min(...files) && kf < Math.max(...files)) continue;
        return {
          confidence: 'medium',
          because: [`${side(f, other(c))} has weaknesses on ${brief(s.weak, 4)} — ${s.spread} files ` +
                    `apart, with the king on neither side of both, and ${side(f, c)} has a heavy piece ` +
                    `that can switch wings faster than the defence can follow` +
                    (loose.length
                      ? `. ${brief(loose)} can still advance, so the first job is to fix ${loose.length === 1 ? 'it' : 'them'} — ` +
                        `the method needs a target that cannot be repaired`
                      : '')],
          slots: { square: s.weak[0] },
          subjects: [c],
        };
      }
      return null;
    },
  },
  {
    concept: 'bad-bishop',
    implements: "definition: a bishop's scope is decided by where its OWN pawns sit; " +
                "the record insists badness is STRUCTURAL and passivity FUNCTIONAL, so this " +
                "reports the structure and requires low scope before saying anything stronger",
    run(f) {
      if (totalPawns(f) < 8) return null;          // structure has to exist to be bad
      // A bishop still on its starting square is UNDEVELOPED, not bad. It was
      // reported as bad on the Ruy Lopez false-positive position, where Black's
      // c8 bishop simply has not moved yet and its own d7 pawn is in the way.
      // Badness is a claim about the pawn structure having condemned a piece,
      // which cannot be said of a piece that has not tried to go anywhere.
      // ...but only in the opening. The ARCHETYPE of a bad bishop is the French
      // light-squared bishop buried on c8 behind d5, e6 and f7, which is a home
      // square, so excluding home squares outright would refuse the one position
      // the concept is named after. Phase separates the two: on move four the
      // bishop has not moved yet, and on move twenty-four it has been buried.
      const HOME = { w: ['c1', 'f1'], b: ['c8', 'f8'] };
      for (const c of ['w', 'b']) {
        for (const b of (f.pieces[c].bishops || [])) {
          if (f.phase === 'opening' && HOME[c].includes(b.square)) continue;
          // "Counting pawns on the bishop's colour is mechanical and will fire
          // on pieces that are performing well. Mobility and role must be
          // checked too" - the record's first trap, and Suba's active bad bishop
          // is its registered case: structurally bad, outside the chain, and a
          // fine piece. Mobility is the half a scan can check, so a bishop that
          // can see is not reported. Role is not checkable and the record's
          // second trap says why - "a bad bishop that is the sole guardian of a
          // weak colour complex is a load-bearing defender, not a liability" -
          // which is why this reports at LOW confidence and never at high.
          if (!shutInByItsOwnPawns(b)) continue;
          return {
            // The record states its own recognition confidence as LOW, saying
            // that "the structural test is mechanical and the conclusion it
            // invites is frequently wrong". Honour that rather than the
            // cleanliness of the feature match: tested against Nimzowitsch-Salwe
            // 1911, this fired on White's d4 bishop, which is the blockading
            // piece the whole game is built around.
            confidence: 'low',
            because: [`${side(f, c)}'s bishop on ${b.square} shares its colour with ${b.ownPawnsOnItsColour} of its own ${b.ownPawnsTotal} pawns, and sees ` +
                    (b.scope === 1 ? 'only one square' : `only ${b.scope} squares`)],
            slots: { square: b.square, piece: 'bishop' },
            subjects: [c],
          };
        }
      }
      return null;
    },
  },
  {
    concept: 'opposite-coloured-bishops',
    implements: ("recognition.preconditions: exactly one bishop each, on opposite colours - and the " +
                 "record's first trap, which the earlier version ignored: \"the drawish reputation " +
                 "is an ENDGAME fact. In the middlegame with heavy pieces on, opposite-coloured " +
                 "bishops favour the attacker, because the bishop on the attacking colour has no " +
                 "counterpart.\" The phase decides which half is said."),
    run(f) {
      if (!f.pieces.oppositeColouredBishops) return null;
      const heavy = ['w', 'b'].reduce((n, c) => n + f.material[c].counts.R + f.material[c].counts.Q, 0);
      const line = 'each side has one bishop and they travel on opposite square colours, so neither ' +
                   'can attack or defend the other’s squares';
      // Saying "drawish" here with queens and rooks on the board is the error
      // the record names, and it is the commonest thing anyone says about this
      // material. The endgame reputation is not transferable to a middlegame.
      // Two of this record's indicators_against are answered by the two clauses
      // below: "queens or rooks remain - winning chances rise sharply, and in
      // the middlegame the bishops are an ATTACKING asset" is the heavy-piece
      // caveat, and "the extra pawns are separated by three files or more" is
      // the separation clause. The other two - whether a blockade can be
      // established, and whether the attacking king can penetrate on the colour
      // the defending bishop cannot cover - are judgements about a position that
      // does not exist yet.
      //
      // "Two extra pawns are often not enough — but THREE FILES OF SEPARATION
      // often are. The count of pawns is the wrong variable; their separation
      // and the blockade are." The record says the count is wrong and then this
      // base reported nothing at all about either variable. Separation is
      // measurable; the blockade is not, and is left alone.
      const ahead = f.material.w.counts.P > f.material.b.counts.P ? 'w'
                  : f.material.b.counts.P > f.material.w.counts.P ? 'b' : null;
      let spread = null;
      if (ahead) {
        const files = (f.pawns[ahead].files || []).map(x => x.charCodeAt(0));
        if (files.length >= 2) spread = Math.max(...files) - Math.min(...files);
      }
      const tail = f.phase !== 'endgame' && heavy > 0
        ? ' — and with heavy pieces still on this is not the drawish ending it is famous for: the ' +
          'bishop on the attacking colour has no counterpart, which favours whoever is attacking'
        : spread !== null && spread >= 3
          ? `. ${side(f, ahead)} is a pawn up with the pawns ${spread} files apart, and separation rather ` +
            `than the count is what decides these endings`
          : spread !== null
            ? `. ${side(f, ahead)} is a pawn up, but the pawns are only ${spread} file` +
              `${spread === 1 ? '' : 's'} apart — one bishop covers that, and the count is the wrong variable`
            : '';
      return {
        confidence: 'high',
        because: [line + tail],
        subjects: ['w', 'b'],
      };
    },
  },
  {
    concept: 'rook-on-the-seventh',
    implements: ("recognition.preconditions: a rook on the opponent's second rank - AND the record's " +
                 "third trap, which the earlier version ignored: \"detecting 'rook on rank 7' is " +
                 "trivial and fires often; the reportable facts are what it attacks and whether the " +
                 "king is trapped.\" One of those two must be true. The sentence also carries the " +
                 "record's central distinction in Nimzowitsch's own words - the ABSOLUTE seventh with " +
                 "the king confined against the RELATIVE seventh with it out - and Naroditsky's " +
                 "correction that two rooks on the rank almost never mate when the eighth is defended."),
    run(f) {
      const P = FEAT.page;
      const st = P.stateFromFEN(f.fen);
      const hits = [];
      for (const c of ['w', 'b']) {
        const rooks = f.pieces[c].rooksOnSeventh;
        if (!rooks.length) continue;
        // "A rook reaching the seventh is not decisive by itself. With an empty
        // seventh rank and an enemy king that has luft, a tested position
        // evaluates level" - the record's fourth trap, measured on its own
        // registered position. So the rook has to be doing one of the two things
        // the record names: attacking something on that rank, or holding the
        // enemy king on its back rank.
        const rank = c === 'w' ? 1 : 6;                 // row index of the seventh
        const targets = [];
        for (let col = 0; col < 8; col++) {
          const i = rank * 8 + col;
          const q = st.b[i];
          if (q && q.c === other(c) && q.t !== 'K') targets.push(FEAT.nameOf(i));
        }
        const k = f.king[other(c)];
        const confined = !!k && k.onHomeRank;
        if (!targets.length && !confined) continue;
        // NOT EVICTABILITY, and the attempt is recorded because it is the
        // interesting part. The record's indicators_against say "the rook can be
        // challenged and traded off, or DRIVEN AWAY WITH GAIN", and its
        // indicators_for say "the rook cannot be evicted with tempo". Neither is
        // built, and a one-ply test for them was written, measured and thrown
        // away: it fixed Karpov-Polgar 2001 and broke Capablanca-Rubinstein
        // 1928, which is this corpus's own annotated instance of the concept.
        // In Capablanca's position ...Rd7 challenges the rook and ...Ng6 attacks
        // it with a lesser piece, and the concept is right there anyway; in
        // Karpov's, the eviction takes four preparatory king moves and no
        // one-ply test can see it. The failure is a corpus entry rather than a
        // guard fitted to one position.
        // ...and, when there are TWO rooks on the rank, whether the eighth is
        // defended. The record quotes Naroditsky on exactly this: "with the
        // eighth rank defended by a rook or queen, two rooks on the seventh can
        // ALMOST NEVER checkmate by themselves. Their power is mobility and
        // restriction, not mate." The pigs-on-the-seventh picture is the most
        // over-taught image in the concept and this base was drawing it without
        // the condition that makes it wrong.
        const back = c === 'w' ? 0 : 7;
        let eighthHeld = false;
        for (let col = 0; col < 8; col++) {
          const q = st.b[back * 8 + col];
          if (q && q.c === other(c) && (q.t === 'R' || q.t === 'Q')) { eighthHeld = true; break; }
        }
        hits.push({ c, r: rooks, targets, confined, eighthHeld });
      }
      if (!hits.length) return null;
      return {
        confidence: 'high',
        because: hits.map(h => {
          // Three of this record's indicators_against are answered right here.
          // "The enemy king has escaped to the sixth rank or beyond" is the
          // relative-seventh clause; "the pawns on the seventh have already
          // advanced, so there is nothing to attack" is why a rook with no
          // targets and no confinement is not reported at all; and "the eighth
          // rank is defended, so the mating dimension of a second rook is
          // absent" is the pigs clause below.
          //
          // The record's central distinction, in Nimzowitsch's own vocabulary:
          // the seventh is held ABSOLUTELY when the enemy king is confined to
          // the eighth behind the rook, and only RELATIVELY when it has slipped
          // out. "If the king slips out, you are buying a good rook, not a
          // winning one, and should pay less." The matcher had the fact and the
          // sentence did not use the word.
          const what = h.targets.length
            ? `attacking ${brief(h.targets, 3)}` +
              (h.confined ? ', with the king held on its back rank — the ABSOLUTE seventh'
                          : ' — but the king has slipped out, so this is the RELATIVE seventh: a good rook, not a winning one')
            : 'holding the enemy king on its back rank — the ABSOLUTE seventh';
          const pigs = h.r.length >= 2 && h.eighthHeld
            ? '. Two rooks on the rank, but the eighth is defended by a heavy piece — they can almost ' +
              'never mate by themselves from there; their power is restriction, not mate'
            : '';
          return `${side(f, h.c)} has a rook on ${h.r.join(' and ')}, ${what}${pigs}`;
        }),
        slots: { square: hits[0].r[0] },
        subjects: hits.map(h => h.c),
      };
    },
  },
  {
    concept: 'luft',
    implements: "recognition: king on its home rank with no empty escape square, and enemy heavy pieces present",
    run(f) {
      const hits = [];
      for (const c of ['w', 'b']) {
        if (!f.king[c] || !f.king[c].backRankExposure) continue;
        // A king with no escape square is only in danger if a heavy piece can
        // actually GET to the back rank. Tested against Nimzowitsch-Salwe 1911,
        // this led with White's back-rank exposure in the position his own notes
        // are about — with no open or semi-open file for Black to use. The
        // concept's record already says the pattern is only dangerous when a
        // rook or queen can reach the rank.
        // This is also the buildable half of the record's second trap, "luft is
        // unnecessary when the back rank is adequately defended or when no heavy
        // pieces remain": no heavy pieces on a usable file, nothing to fear. The
        // other half is not mechanical and says so on the record.
        //
        // Not merely that a route exists, but that a heavy piece is ON one. An
        // earlier version counted open and semi-open files and still fired on
        // Nimzowitsch-Salwe, where Black had two semi-open files and no rook on
        // either. The threat has to be reachable by something, not conceivable.
        const enemy = other(c);
        const usable = new Set(f.files.open.concat(f.files.semiOpenFor[enemy] || []));
        const onFile = f.pieces[enemy].rooksOnOpenFiles.concat(
                       f.pieces[enemy].rooksOnSemiOpenFiles).length;
        if (!usable.size || !onFile) continue;
        hits.push(c);
      }
      if (!hits.length) return null;
      return {
        confidence: 'high',
        // Say the condition that was actually tested. "still has a rook or
        // queen" is weaker than the guard above, which requires a rook standing
        // on a file that reaches the rank - and a sentence looser than its own
        // test teaches the looser rule.
        // "The opponent has castled on the other wing and can throw pawns
        // forward" - the record's first indicator_against, and the concrete
        // half of the caveat the wording already carries in general terms. When
        // the kings are on opposite wings the pawn move that makes air is also
        // a hook, and that is the standard error this record names.
        because: hits.map(c => {
          const mine = f.king[c] && f.king[c].square, theirs = f.king[other(c)] && f.king[other(c)].square;
          const wing = sq => (sq && sq[0] <= 'c' ? 'q' : sq && sq[0] >= 'f' ? 'k' : null);
          const opposite = mine && theirs && wing(mine) && wing(theirs) && wing(mine) !== wing(theirs);
          return `${side(f, c)}'s king is on its back rank with no escape square, and ` +
                 `${side(f, other(c))} has a rook on a file that reaches it` +
                 (opposite
                   ? ` — but the kings are on opposite wings, so the pawn move that makes air here is ` +
                     `also a hook for the pawns coming at it`
                   : '');
        }),
        subjects: hits,
      };
    },
  },
  {
    concept: 'material-imbalance',
    implements: "definition: the sides hold different KINDS of material, not different amounts",
    run(f) {
      // The record defines an imbalance as the sides holding different kinds of
      // material - "the 1/3/3/5/9 scale stops applying". An earlier version of
      // this matcher fired on any one-point difference, so an ordinary extra
      // pawn was explained with a lecture about qualitative imbalance. A pawn up
      // is a material ADVANTAGE; a rook against two minors is an imbalance.
      const w = f.material.w.counts, b = f.material.b.counts;
      const diffs = [];
      for (const t of ['N', 'B', 'R', 'Q']) if (w[t] !== b[t]) diffs.push(t);
      if (!diffs.length) return null;
      // A single missing minor with everything else equal is being a piece up,
      // not an imbalance. Require either two differing piece types, or a
      // rook/queen traded against minors.
      const minorsW = w.N + w.B, minorsB = b.N + b.B;
      const heavyW = w.R + w.Q, heavyB = b.R + b.Q;
      const qualitative = diffs.length >= 2 ||
                          (heavyW !== heavyB && minorsW !== minorsB);
      if (!qualitative) return null;
      // ...and a KNIGHT against a BISHOP, with the same number of minors on
      // each side, is not the imbalance this record is about. The record leads
      // with Kaufman's values and they are explicit: "knight 3.5, unpaired
      // bishop 3.5" - the same number. The case where the two genuinely differ
      // is the bishop PAIR at 7.5 against two separate bishops at 7.0, which is
      // `bishop-pair`, has its own matcher, and says more. Reporting an
      // imbalance here is a third name for a fact already reported once, which
      // is the objection that got `strong-square` thrown away.
      //
      // The exception is the pair itself, and it had to be put back: a first
      // version of this guard refused two bishops against two knights, which is
      // the most discussed minor-piece imbalance there is and one Kaufman's own
      // numbers separate (7.5 against 7.0). So the swap is only dismissed when
      // NEITHER side gains the pair by it. 42.1% -> 35.5%.
      const pairW = !!f.pieces.w.bishopPair, pairB = !!f.pieces.b.bishopPair;
      const onlyMinorSwap = diffs.every(t => t === 'N' || t === 'B')
                            && minorsW === minorsB && pairW === pairB;
      if (onlyMinorSwap) return null;
      const d = f.material.balance;
      const describe = c => {
        const m = c === 'w' ? w : b;
        return `${m.Q ? m.Q + 'Q ' : ''}${m.R ? m.R + 'R ' : ''}${m.B ? m.B + 'B ' : ''}${m.N ? m.N + 'N ' : ''}${m.P}P`.trim();
      };
      // BOTH sides, always. `subjects` names who a concept is about, and an
      // imbalance is about the position rather than about a side: the record's
      // second trap says "detecting the imbalance is mechanical and trivial;
      // saying who it FAVOURS is not, and depends on open files, king safety and
      // how much else remains." Naming the side ahead on the 1/3/3/5/9 count was
      // saying who it favours by the very scale the record's first trap says
      // stops applying once the material is of different kinds.
      return {
        confidence: 'high',
        because: [`the material is unbalanced — White has ${describe('w')} against Black's ${describe('b')}` +
                  (d === 0 ? ', level on points' : `, ${Math.abs(d)} point${Math.abs(d) === 1 ? '' : 's'} to ${d > 0 ? 'White' : 'Black'} on a scale that stops applying here`)],
        subjects: ['w', 'b'],
      };
    },
  },
  {
    concept: 'space',
    implements: ("recognition.preconditions AND the record's first false-positive trap, which the " +
                 "earlier version ignored: 'counting controlled squares is mechanical and over-reports. " +
                 "Space with no entry point wins nothing.' An entry square is required."),
    run(f) {
      const w = f.activity.pawnSpace.w, b = f.activity.pawnSpace.b;
      if (totalPawns(f) < 6 || Math.abs(w - b) < 2) return null;
      const c = w > b ? 'w' : 'b';
      // Space with no entry point wins nothing - the record says so in those
      // words, and again in its indicators_against as "no entry point exists,
      // so the territory buys nothing". This matcher counted squares and
      // stopped. Layer 3's entrySquares() answers the other half.
      const entry = (f.activity.entry || {})[c] || [];
      if (!entry.length) return null;
      // Trap 2, which the indicators_against say again as "the advanced pawns
      // are fixed targets rather than a front": "advanced pawns are not
      // automatically a space advantage - they
      // may simply be weak and fixed." The pawns that CREATE the space are the
      // ones whose attacks land in the other half, which is rank 4 and beyond
      // for White; if every one of them is a pawn no pawn can defend and it
      // cannot advance, the territory is a set of targets. Measured: this
      // refuses 1 of 274 positions on the shipped corpus, because a side with a
      // real space advantage rarely has EVERY space-creating pawn weak. It is
      // built anyway - a condition the record states and the matcher ignores is
      // how the other four went wrong - and the rate is recorded rather than
      // talked up.
      const weak = new Set(f.pawns[c].undefendable || []);
      const advanced = (f.pawns[c].squares || []).filter(sq =>
        c === 'w' ? +sq[1] >= 4 : +sq[1] <= 5);
      if (advanced.length && advanced.every(sq => weak.has(sq) && f.pawns[c].blocked.includes(sq))) {
        return null;
      }
      return {
        confidence: 'medium',
        because: [`${side(f, c)}'s pawns control ${Math.max(w, b)} squares in the opponent's half against ` +
                  `${Math.min(w, b)}, and a piece can enter on ${brief(entry)}`],
        slots: { square: entry[0] },
        subjects: [c],
      };
    },
  },
  {
    concept: 'piece-activity',
    implements: ("recognition.indicators_for, and the record's own first false-positive trap, which the " +
                 "earlier version contradicted: 'counting available squares is not measuring activity. A " +
                 "piece with many moves that bear on nothing is not active.' Counted over ACTIVE moves - " +
                 "captures, moves into the opponent's half, and moves that attack an enemy man from where " +
                 "they land - rather than legal ones. And the record's first indicator_against, 'a piece " +
                 "TIED TO DEFENDING SOMETHING', which excludes a move that leaves a man it was guarding " +
                 "hanging: the piece has the move, it does not have the freedom."),
    run(f) {
      const w = f.activity.active.w, b = f.activity.active.b;
      if (w == null || b == null) return null;
      const gap = Math.abs(w - b);
      if (gap < 8) return null;                 // small gaps are noise, not activity
      const c = w > b ? 'w' : 'b';
      return {
        confidence: 'low',
        because: [`${side(f, c)} has ${Math.max(w, b)} moves that do something — a capture, a step into the ` +
                  `opponent's half, or an attack from where the piece lands — against ${Math.min(w, b)}`],
        subjects: [c],
      };
    },
  },
  {
    concept: 'pawn-breakthrough',
    implements: ("recognition.preconditions + the record's own false-positive trap: a pawn sacrifice " +
                 "that creates a passer is not a breakthrough unless the passer cannot be stopped, and " +
                 "the rule of the square is what this base has to decide it with. Layer 3's " +
                 "pawnBreakthrough() runs the race. MEASURED against Syzygy on 24 tablebase-decidable " +
                 "pawn endings: 22 right, 2 wrong. It is an indication, not a proof, and the " +
                 "confidence and the wording say so."),
    run(f) {
      const hits = [];
      for (const c of ['w', 'b']) if (f.breakthrough && f.breakthrough[c]) hits.push(c);
      if (!hits.length) return null;
      const c = hits[0];
      const bt = f.breakthrough[c];
      const sq = bt.first.slice(2, 4);
      return {
        // MEDIUM, and it used to be high on the grounds that "in the pure pawn
        // ending this detector restricts itself to, the rule of the square is a
        // PROOF". It is not. Generating pawn endings - which the 788 shipped
        // positions contain none of - and checking the claims against Syzygy
        // gives 22 right of 24 at the margin finally chosen, and the two
        // failures are the method's limit rather than bugs: a pawn that is not
        // PASSED can still queen after an exchange, and the arithmetic of a
        // multi-pawn race is not decidable by the rule of the square. Two real
        // bugs were found on the way and both are fixed.
        confidence: 'medium',
        because: [
          `${side(f, c)} can play a pawn to ${sq}, and by the rule of the square every pawn capture of ` +
          `it loses the race: ${bt.line.join(' ')}. In a multi-pawn ending that is an indication rather ` +
          `than a proof — checked against tablebases, this reading is right about nine times in ten`,
          bt.offers > 1
            ? `The advance creates ${bt.offers} pawn captures at once, which is the lever geometry the pattern needs`
            : `The advance offers itself to a pawn capture, and every capture loses`,
        ],
        slots: { square: sq, line: bt.line.join(' ') },
        subjects: [c],
      };
    },
  },
  {
    concept: 'king-safety',
    implements: ("recognition: pawn shield, open lines at the king, and the count of attackers against " +
                 "defenders. TWO ARMS, and this string used to name only the first. The COUNT arm needs " +
                 "three or more attackers, because the record states that 'counting attacking pieces " +
                 "linearly overstates one or two' and that it 'is not worth reporting an attack below " +
                 "three attackers'. The SHIELD arm needs none of them: a king with no shield pawn at " +
                 "all, in its own half, with a line pointing at it, is reported at an attacker count of " +
                 "one - Adams-Kasparov 2005 is the position that put it there, and a string claiming " +
                 "'ONLY at three or more' described a matcher this is not."),
    run(f) {
      const hits = [];
      for (const c of ['w', 'b']) {
        const z = f.kingZone && f.kingZone[c];
        const k = f.king[c];
        if (!z || !k) continue;
        // The record's threshold, its queen condition, and its registered false
        // positive, in that order. The last is the important one: "an exposed
        // king is not automatically losing. With the attacking pieces traded
        // off, an exposed king is often simply an active one - and in the
        // endgame that is the goal." So this says nothing in an endgame.
        if (f.phase === 'endgame') continue;
        if (!z.enemyHasQueen) continue;
        // Two ways in, and the record puts them in this order: "is the king
        // castled; is the pawn shield intact; how many enemy pieces can reach
        // the king's zone against how many defenders; do open files or
        // diagonals point at it".
        //
        // A NOTE ON THIS RECORD'S indicators_against, because the field means
        // something different here from what it means elsewhere. For a concept
        // naming an ASSET - an open file, an outpost, a passed pawn - the
        // indicators_against are reasons not to report it, and the trap audit
        // reads them that way. `king-safety` names a SCALE, so its
        // indicators_against are the conditions under which the king is UNSAFE,
        // which is to say the conditions this matcher fires on: "three or more
        // attackers can reach the king zone" is the count arm below, "shield
        // pawns advanced or missing" is the bare-shield arm, and "no escape
        // square, so back-rank tactics are live" is what `luft` reports. They
        // are built; they are not false-positive guards, and building them as
        // guards would invert the concept.
        const byCount = z.attackers >= 3 && z.attackers > z.defenders;
        // A king with NO shield pawn at all, still on its own half, with the
        // enemy queen on and a line pointing at it. Adams-Kasparov 2005 after
        // 21...Kxh7 is the position that put this arm here: the black king has
        // nothing in front of it and the attacker count is ONE, so a rule built
        // only on attacker counts says nothing about the most striking fact on
        // the board.
        const ownHalf = c === 'w' ? Number(k.square[1]) <= 3 : Number(k.square[1]) >= 6;
        const byShield = k.pawnShield === 0 && ownHalf &&
                         (z.fileOpenOnKing || z.fileSemiOpenOnKing || z.attackers >= 2);
        if (!byCount && !byShield) continue;
        hits.push({ c, z, k, why: byCount ? 'count' : 'shield' });
      }
      if (!hits.length) return null;
      return {
        // Low, and capped again by the record's knowledge type. This is the
        // concept whose own record calls the count S-shaped and unreliable; a
        // clean feature match is not a reason to sound sure.
        confidence: 'low',
        because: hits.map(h =>
          (h.why === 'shield'
            ? `${side(f, h.c)}'s king on ${h.k.square} has no pawn in front of it at all`
            : `${side(f, h.c)}'s king on ${h.k.square} has ${h.z.attackers} enemy pieces bearing on its zone ` +
              `against ${h.z.defenders} defenders, with ${h.k.pawnShield} of the three shield pawns still in place`) +
          (h.z.fileOpenOnKing ? `, and the ${h.z.kingFile}-file is open on it`
            : h.z.fileSemiOpenOnKing ? `, on a file with no pawn of its own` : '')),
        slots: { square: hits[0].k.square, count: String(hits[0].z.attackers) },
        subjects: hits.map(h => h.c),
      };
    },
  },
  {
    concept: 'king-attack',
    implements: ("recognition.preconditions, all three, plus the record's own three false-positive " +
                 "traps. Vukovic's rule is that an attack must be EARNED: local superiority in the " +
                 "king's sector, the attacker's own king safe enough, and the centre not available " +
                 "to the defender for a counter-blow."),
    run(f) {
      if (f.phase === 'endgame') return null;
      for (const a of ['w', 'b']) {
        const d = other(a);
        const zd = f.kingZone && f.kingZone[d], za = f.kingZone && f.kingZone[a];
        const kd = f.king[d];
        if (!zd || !za || !kd) continue;
        if (f.material[a].counts.Q === 0) continue;
        // 1. Local superiority. Three, for the reason the king-safety record
        //    gives and this one repeats: "two checks is not an attack", and a
        //    linear count "overstates one or two". Pieces, not pawns - the third
        //    trap here is "advancing pawns at a king is not an attack unless
        //    pieces can follow into the lines that open".
        if (zd.attackers < 3 || zd.attackers <= zd.defenders) continue;
        //    This is also the registered false positive: "an exposed king is not
        //    automatically under attack - with the attacking pieces traded off,
        //    an exposed king is often just an active one." Three attackers
        //    outnumbering the defenders is what separates the two.
        // 2. "The attacker's own king is safe, or safe enough for the time the
        //    operation needs." Adams-Kasparov 2005 is the registered case where
        //    every other sign of an attack is present and this one is not.
        if (za.attackers >= 3 && za.attackers > za.defenders) continue;
        // 3. "The centre is closed or under control, so a counter-blow there is
        //    not available." Not a mood: the attacker must not be behind on the
        //    central squares.
        if (f.centre && f.centre.control[a] < f.centre.control[d]) continue;
        const because = [
          `${side(f, a)} has ${zd.attackers} pieces bearing on ${side(f, d)}'s king zone against ` +
          `${zd.defenders} defenders, with ${kd.pawnShield} of three shield pawns in front of the king on ${kd.square}`,
          `and ${side(f, a)}'s own king has ${za.attackers} pieces on its zone against ${za.defenders}, ` +
          `so the operation is not a race being lost`,
        ];
        if (zd.fileOpenOnKing) because.push(`the ${zd.kingFile}-file is open on the defending king`);
        return {
          // The record's own typical_confidence, and it is right: everything
          // above is a precondition for an attack, not a demonstration of one.
          confidence: 'low',
          because,
          slots: { square: kd.square, count: String(zd.attackers) },
          subjects: [a],
        };
      }
      return null;
    },
  },
  {
    concept: 'center-control',
    implements: ("recognition + the record's first false-positive trap. Control is measured as ATTACKERS " +
                 "of d4/e4/d5/e5 via the page's own attackersOf(), never as pawns standing on them: " +
                 "'counting pawns on central squares measures occupation, not control'."),
    run(f) {
      const ct = f.centre;
      if (!ct) return null;
      // Two guards against the thing that ruined semi-open-file: a feature that
      // is true of most positions says nothing by being true here. A side must
      // out-attack the other on at least three of the four squares AND by a
      // clear total, or this stays quiet.
      // Two arms, and the thresholds were measured rather than chosen: over the
      // 788 shipped positions the pair fires on 20.3%, which is what a real
      // feature of a fifth of positions should look like. `semi-open-file` once
      // fired on 83% and was reported as coverage.
      const led = ct.squaresLed, tot = ct.control;
      let c = null;
      for (const side_ of ['w', 'b']) {
        const o_ = other(side_);
        const clearLead = led[side_] >= 3 && led[side_] > led[o_] && tot[side_] - tot[o_] >= 3;
        // ...or the opponent leads on nothing at all, which is a different and
        // equally real shape: one side attacks every central square more.
        const shutOut = led[side_] >= 2 && led[o_] === 0 && tot[side_] - tot[o_] >= 4;
        if (clearLead || shutOut) { c = side_; break; }
      }
      if (!c) return null;
      const o = other(c);
      const because = [
        `${side(f, c)} has ${tot[c]} attacks on the four central squares against ${tot[o]}, ` +
        `and out-attacks ${side(f, o)} on ${led[c]} of them`,
      ];
      // The record's other two traps, said out loud when they apply.
      if (ct.occupied[o].length && !ct.occupied[c].length) {
        because.push(`${side(f, o)} occupies ${brief(ct.occupied[o])} and ${side(f, c)} occupies nothing there ` +
                     `- occupation and control are different things and this position separates them`);
      }
      if (ct.visiting[c].length) {
        because.push(`${side(f, c)}'s man on ${brief(ct.visiting[c])} can be attacked by a pawn, so it is visiting rather than posted`);
      }
      return {
        confidence: 'medium',
        because,
        slots: { square: Object.keys(ct.squares).filter(k => ct.squares[k][c] > ct.squares[k][o]).join(', ') },
        subjects: [c],
      };
    },
  },
  {
    concept: 'blockade',
    implements: ("recognition.preconditions verbatim: an enemy passed OR ADVANCING pawn, and a friendly " +
                 "piece on the square directly in front of it."),
    run(f) {
      // A first version used Layer 3's `blockadedPassers`, which is only the
      // PASSED half, and it did not fire on Nimzowitsch-Salwe 1911 - the game
      // the concept is named after, where the pawn being blockaded is a
      // backward e-pawn rather than a passer, and Nimzowitsch's own note is
      // that its "immobility is now greater than ever".
      //
      // So: an enemy pawn on a file no pawn of ours occupies ahead of it - it
      // is stopped by a PIECE or not at all - with one of our pieces standing
      // on the square in front. A pawn stopped by a pawn is a ram, not a
      // blockade, and the record's whole point is that a piece is spending
      // itself to do this.
      const P = FEAT.page;
      const st = P.stateFromFEN(f.fen);
      const hits = [];
      for (const c of ['w', 'b']) {
        const enemy = other(c);
        const forward = enemy === 'w' ? -1 : 1;
        for (let i = 0; i < 64; i++) {
          const p = st.b[i];
          if (!p || p.c !== enemy || p.t !== 'P') continue;
          const r = i >> 3, col = i & 7;
          const fr = r + forward;
          if (fr < 0 || fr > 7) continue;
          const front = st.b[fr * 8 + col];
          if (!front || front.c !== c || front.t === 'P') continue;   // a pawn in front is a ram
          // ...and nothing of OURS further up the file, or the pawn was never going anywhere
          let clearAhead = true;
          for (let rr = fr + forward; rr >= 0 && rr < 8; rr += forward) {
            const q = st.b[rr * 8 + col];
            if (q && q.t === 'P') { clearAhead = false; break; }
          }
          if (!clearAhead) continue;
          hits.push({ c, sq: FEAT.nameOf(i), by: front.t, on: FEAT.nameOf(fr * 8 + col) });
        }
      }
      if (!hits.length) return null;
      const h = hits[0];
      const word = { N: 'knight', B: 'bishop', R: 'rook', Q: 'queen', K: 'king' }[h.by];
      // "The blockader is a queen or rook, which is expensive and evictable" -
      // the record's first indicator_against, and the only one of its three a
      // static scan can answer. It is SAID rather than used to suppress, and
      // that was decided by a position: Lisitsin-Capablanca 1935 is a queen
      // ending where Chernev praises exactly the queen blockade this warns
      // about, and it is this corpus's annotated instance of the concept.
      // Refusing heavy blockaders takes the rate 27.3% -> 20.3% and deletes it.
      // Fifth time in two sessions that saying more beat firing less.
      const heavy = h.by === 'R' || h.by === 'Q';
      return {
        confidence: 'high',
        because: [`${side(f, h.c)}'s ${word} on ${h.on} stands directly in front of ${side(f, other(h.c))}'s ` +
                  `pawn on ${h.sq}, which has nothing of its own to advance behind and cannot pass it` +
                  (heavy ? ` — though a ${word} is an expensive blockader and can usually be chased ` +
                           `off by something cheaper` : '')],
        slots: { square: h.on, piece: word },
        subjects: [...new Set(hits.map(x => x.c))],
      };
    },
  },
  {
    concept: 'battery',
    implements: ("recognition.preconditions: two or more friendly line pieces sharing a file, rank or " +
                 "diagonal with nothing between them. Restricted to batteries that POINT somewhere - the " +
                 "record's definition is about combining force, and two rooks stacked behind their own " +
                 "pawns combine nothing."),
    run(f) {
      const P = FEAT.page;
      const st = P.stateFromFEN(f.fen);
      const hits = [];
      for (const c of ['w', 'b']) {
        for (let i = 0; i < 64; i++) {
          const a = st.b[i];
          if (!a || a.c !== c || (a.t !== 'R' && a.t !== 'Q' && a.t !== 'B')) continue;
          for (const [dr, dc] of DIRS[a.t]) {
            let r = (i >> 3) + dr, cc = (i & 7) + dc, steps = 0;
            while (r >= 0 && r < 8 && cc >= 0 && cc < 8) {
              const j = r * 8 + cc, q = st.b[j];
              if (q) {
                const compatible = a.t === 'B' || q.t === 'B'
                  ? (dr !== 0 && dc !== 0) : (dr === 0 || dc === 0);
                if (q.c === c && (q.t === 'R' || q.t === 'Q' || q.t === 'B') && compatible) {
                  // ...and the line must continue past the pair into empty space,
                  // or there is nothing for the combined force to reach.
                  // ...and the line must ARRIVE somewhere. Two rooks stacked
                  // behind their own pawns combine nothing, and a first version
                  // that asked only for one empty square beyond the pair fired
                  // on 43% of the 788 shipped positions. The line has to reach
                  // an enemy man, or run into the enemy half. That is also the
                  // record's first indicator_against - "the line is blocked
                  // further along and cannot be opened" - said from the other
                  // side: a line that arrives nowhere is a line that is blocked.
                  let rr = r + dr, ccc = cc + dc, room = 0, target = null;
                  while (rr >= 0 && rr < 8 && ccc >= 0 && ccc < 8) {
                    const q2 = st.b[rr * 8 + ccc];
                    if (q2) { target = q2.c === other(c) ? FEAT.nameOf(rr * 8 + ccc) : null; break; }
                    room++;
                    if ((c === 'w' && rr <= 3) || (c === 'b' && rr >= 4)) target = target || 'the enemy half';
                    rr += dr; ccc += dc;
                  }
                  // `a` is where the scan started and `q` is the piece further
                  // along the direction it is walking, so the line continues
                  // PAST q to the target: q is the front piece and a is the
                  // rear. Getting that round the wrong way told a reader the
                  // queen was in front when the rook was.
                  if (target) hits.push({ c, a: FEAT.nameOf(i), b: FEAT.nameOf(j), target,
                                          front: q.t, rear: a.t });
                }
                break;
              }
              steps++; r += dr; cc += dc;
            }
          }
        }
      }
      if (!hits.length) return null;
      const h = hits[0];
      // "The REAR PIECE IS MORE VALUABLE and becomes a target itself" - the
      // record's second indicator_against, and the commonest way a battery is
      // built the wrong way round. A queen in front of a rook is not a battery
      // aimed at the enemy, it is a queen that has to move first every time the
      // line is touched. Said rather than suppressed: the geometry is there
      // either way, and which piece is in front is exactly what a learner needs
      // told.
      const VAL = { B: 3, R: 5, Q: 9 };
      const wrongOrder = (VAL[h.front] || 0) > (VAL[h.rear] || 0);
      const name = t => ({ B: 'bishop', R: 'rook', Q: 'queen' }[t] || 'piece');
      return {
        confidence: 'medium',
        because: [`${side(f, h.c)} has two long-range pieces stacked on one line, on ${h.a} and ${h.b}, ` +
                  `and the line runs on to ${h.target}` +
                  (wrongOrder
                    ? ` — but the ${name(h.front)} is in front of the ${name(h.rear)}, which is the ` +
                      `expensive way round: the front piece has to move first every time the line is touched`
                    : '')],
        slots: { square: h.a },
        subjects: [...new Set(hits.map(x => x.c))],
      };
    },
  },
  /* ---- the rules layer -------------------------------------------------
   * Seven concepts whose records name a mechanical detector that already
   * exists. They are here because a system that explains chess and cannot say
   * "this is stalemate" or "the fifty-move count is at 88" is missing the one
   * class of claim it could make with certainty. Each is an OFFICIAL RULE, so
   * the confidence ceiling is high and the claim is a fact rather than a
   * judgement - and each is guarded against the thing that would make it noise:
   * `castling` is reported for the MOVE, not for the rights, which almost every
   * opening position has.
   * -------------------------------------------------------------------- */
  {
    concept: 'check',
    implements: ("recognition.preconditions: a king stands on a square attacked by an enemy piece. " +
                 "Detector: inCheck. The record's trap is about a different claim from the one made " +
                 "here: \"a check being AVAILABLE is not a reason to play it. Proven case: Ra7+ " +
                 "draws and Rg8+ loses in the same position.\" This reports a king that IS in check, " +
                 "which is a fact about the position and not a recommendation, and nothing in this " +
                 "base ever suggests giving one."),
    run(f) {
      for (const c of ['w', 'b']) {
        if (f.king[c] && f.king[c].inCheck) {
          return {
            confidence: 'high',
            because: [`${side(f, c)}'s king on ${f.king[c].square} is in check, so the only legal moves are ` +
                      `the ones that answer it`],
            slots: { square: f.king[c].square },
            subjects: [c],
          };
        }
      }
      return null;
    },
  },
  {
    concept: 'checkmate',
    implements: ("recognition.preconditions verbatim: the side to move is in check and has no legal " +
                 "move. This arm did not exist. `checkmate` was reachable only through the MOVE - the " +
                 "page's findMotifs tags the mating move - so the base could say 'this position is " +
                 "stalemate' about a board and could not say 'this position is checkmate' about the " +
                 "same board with the queen one square over. Found by building a controlled pair of " +
                 "counterexamples for `stalemate`, where the negative side of the pair is a mate and " +
                 "the base reported only `check`."),
    run(f) {
      const P = FEAT.page;
      const st = P.stateFromFEN(f.fen);
      let moves;
      try { moves = P.legalMoves(st); } catch (e) { return null; }
      if (moves.length) return null;
      if (!P.inCheck(st, st.turn)) return null;              // that is stalemate
      return {
        confidence: 'high',
        because: [`${side(f, st.turn)} is to move, is in check, and has no legal move: the game is over`],
        slots: {},
        subjects: [other(st.turn)],
      };
    },
  },
  {
    concept: 'stalemate',
    implements: "recognition.preconditions verbatim: the side to move has zero legal moves and is not in check.",
    run(f) {
      const P = FEAT.page;
      const st = P.stateFromFEN(f.fen);
      let moves;
      try { moves = P.legalMoves(st); } catch (e) { return null; }
      if (moves.length) return null;
      if (P.inCheck(st, st.turn)) return null;               // that is checkmate
      return {
        confidence: 'high',
        because: [`${side(f, st.turn)} is to move, is not in check, and has no legal move: the game is drawn`],
        slots: {},
        subjects: [st.turn],
      };
    },
  },
  {
    concept: 'insufficient-material',
    implements: ("recognition.preconditions: only kings, or a king and a single minor piece, remain for the " +
                 "side in question. Reported only when NEITHER side can mate, which is the position that is " +
                 "drawn rather than merely hard to win. The record's indicator_against - 'any pawn, rook or " +
                 "queen on the board' - is the negation of that precondition and cannot arise: such a " +
                 "position never reaches the report."),
    run(f) {
      const bare = c => {
        const m = f.material[c].counts;
        if (m.P || m.R || m.Q) return false;
        return m.N + m.B <= 1;
      };
      if (!bare('w') || !bare('b')) return null;
      return {
        confidence: 'high',
        because: ['Neither side has enough material left to force mate, so the game is drawn however it is played'],
        slots: {},
        subjects: ['w', 'b'],
      };
    },
  },
  {
    concept: 'fifty-move-rule',
    implements: ("recognition.preconditions: 100 ply with no capture and no pawn move. Reported from the " +
                 "halfmove clock once it is close enough to matter, because a count of 4 is not news. The " +
                 "record's indicator_against - 'any capture or pawn move in that span resets the counter' - " +
                 "is what the halfmove clock IS, so there is nothing separate to test."),
    run(f) {
      const P = FEAT.page;
      const st = P.stateFromFEN(f.fen);
      const half = Number(String(f.fen).split(' ')[4] || 0);
      if (!(half >= 80)) return null;
      return {
        confidence: 'high',
        because: [`${half} ply have passed with no capture and no pawn move; at 100 either side may claim a draw`],
        slots: { count: String(half) },
        subjects: ['w', 'b'],
      };
    },
  },
  {
    concept: 'en-passant',
    implements: ("recognition.preconditions: the previous move was an enemy pawn advancing two squares and a " +
                 "friendly pawn stands beside it. Reported only when the capture is actually AVAILABLE - a " +
                 "FEN carries an en-passant target square whether or not anything can use it. The record's " +
                 "indicator_against - 'any other move has intervened since the two-square advance' - is " +
                 "encoded in that target square: a FEN that carries one is a FEN in which nothing has."),
    run(f) {
      const P = FEAT.page;
      const st = P.stateFromFEN(f.fen);
      const ep = String(f.fen).split(' ')[3];
      if (!ep || ep === '-') return null;
      let moves;
      try { moves = P.legalMoves(st); } catch (e) { return null; }
      const has = moves.some(m => {
        const p = st.b[m.from];
        return p && p.t === 'P' && FEAT.nameOf(m.to) === ep && !st.b[m.to];
      });
      if (!has) return null;
      return {
        confidence: 'high',
        because: [`${side(f, st.turn)} can capture en passant on ${ep}, and only on this move`],
        slots: { square: ep },
        subjects: [st.turn],
      };
    },
  },
  {
    concept: 'wrong-rook-pawn',
    implements: ("recognition.preconditions verbatim: the attacker has a bishop and a rook pawn, and the " +
                 "pawn's promotion square is NOT of the bishop's colour - which makes the record's " +
                 "indicator_against, 'the bishop DOES control the promotion square, an ordinary win', the " +
                 "negation of the precondition rather than a separate test. The record's own first trap - that " +
                 "the defending king must REACH the corner, and that being in front of the pawn is not " +
                 "enough - is a fact about the defence, not about the material, so it travels as a caution."),
    run(f) {
      for (const c of ['w', 'b']) {
        const me = f.material[c].counts, them = f.material[other(c)].counts;
        if (me.B !== 1 || me.N || me.R || me.Q) continue;
        if (me.P !== 1) continue;
        if (them.P || them.N || them.B || them.R || them.Q) continue;   // a bare king, or the verdict changes
        const pawn = (f.pawns[c].passed.concat(f.pawns[c].isolated))[0]
          || Object.keys(f.pawns[c]).length && null;
        // find the pawn square directly
        const P = FEAT.page;
        const st = P.stateFromFEN(f.fen);
        let sq = null;
        for (let i = 0; i < 64; i++) { const q = st.b[i]; if (q && q.c === c && q.t === 'P') sq = i; }
        if (sq === null) continue;
        const file = 'abcdefgh'[sq & 7];
        if (file !== 'a' && file !== 'h') continue;
        const promo = (c === 'w' ? 0 : 7) * 8 + (sq & 7);
        let bishop = null;
        for (let i = 0; i < 64; i++) { const q = st.b[i]; if (q && q.c === c && q.t === 'B') bishop = i; }
        if (bishop === null) continue;
        if (FEAT.isLight(promo) === FEAT.isLight(bishop)) continue;      // the RIGHT rook pawn; nothing to say
        return {
          confidence: 'high',
          because: [`${side(f, c)} has a bishop and a rook pawn on the ${file}-file, and the promotion square ` +
                    `${FEAT.nameOf(promo)} is the colour the bishop can never reach — the extra material is ` +
                    `worth nothing if the defending king reaches the corner`],
          slots: { square: FEAT.nameOf(promo), file },
          subjects: [c],
        };
      }
      return null;
    },
  },
  {
    concept: 'opposition',
    implements: ("recognition.preconditions: both kings on the same rank or file with exactly one square " +
                 "between them. The record's first trap is why this is confined to endgames - 'kings facing " +
                 "each other is trivially detectable and means nothing outside endgames where king " +
                 "penetration decides' - and its third is why the wording names the spare-tempo escape."),
    run(f) {
      if (f.phase !== 'endgame') return null;
      const P = FEAT.page;
      const st = P.stateFromFEN(f.fen);
      const wk = f.king.w && f.king.w.square, bk = f.king.b && f.king.b.square;
      if (!wk || !bk) return null;
      const fw = wk.charCodeAt(0), rw = Number(wk[1]), fb = bk.charCodeAt(0), rb = Number(bk[1]);
      const sameFile = fw === fb && Math.abs(rw - rb) === 2;
      const sameRank = rw === rb && Math.abs(fw - fb) === 2;
      if (!sameFile && !sameRank) return null;
      // The side NOT to move has it.
      const holder = other(st.turn);
      // "A spare pawn tempo makes the opposition irrelevant, since it can simply
      // be handed back" - the record's third trap, which the wording claimed to
      // name and did not. A pawn push that keeps the position and loses nothing
      // is exactly such a tempo, and having one is the commonest reason a king
      // that "has the opposition" has nothing.
      const spare = c => {
        const probe = P.cloneState(st); probe.turn = c; probe.ep = null;
        let ms; try { ms = P.legalMoves(probe); } catch (e) { return false; }
        return ms.some(m => {
          const pc = probe.b[m.from];
          if (!pc || pc.t !== 'P' || m.cap) return false;
          const nx = P.makeMove(probe, m);
          return P.see(nx, m.to, other(c)) <= 0;
        });
      };
      const tempo = spare(st.turn);
      return {
        confidence: tempo ? 'low' : 'high',
        because: [`The kings stand on ${wk} and ${bk} with one square between them, so ${side(f, holder)} ` +
                  `has the opposition — ${side(f, st.turn)} has to give way first` +
                  (tempo ? `, except that ${side(f, st.turn)} has a spare pawn tempo and can hand it straight back`
                         : '')],
        slots: { square: holder === 'w' ? wk : bk },
        subjects: [holder],
      };
    },
  },
  {
    concept: 'loose-piece',
    implements: ("recognition.preconditions: a piece has no friendly defender and is not currently attacked. " +
                 "The record's own second trap is the reason for the guard: 'it only matters when a forcing " +
                 "move can reach it. A loose rook in a locked position is not a weakness.' The record's " +
                 "indicators_against say the same twice more - 'the piece is on a square nothing can " +
                 "reach' is that guard exactly, and 'it can be defended or moved in one tempo the " +
                 "opponent cannot deny' is why the forcing move must SURVIVE being forcing. So a loose piece " +
                 "is reported only when an enemy move can attack it."),
    run(f) {
      const P = FEAT.page;
      const st = P.stateFromFEN(f.fen);
      const mover = st.turn;
      let moves;
      try { moves = P.legalMoves(st); } catch (e) { return null; }
      const hits = [];
      const them = other(mover);
      for (let i = 0; i < 64; i++) {
        const q = st.b[i];
        if (!q || q.c !== them || q.t === 'P' || q.t === 'K') continue;
        if (P.defendersOf(st, i, them).length) continue;           // defended
        if (P.attackersOf(st, i, mover).length) continue;          // already attacked; a different concept
        // ...and a FORCING move can reach it. The record's second trap is the
        // whole guard: "it only matters when a forcing move can reach it. A
        // loose rook in a locked position is not a weakness." A first version
        // asked only whether SOME move attacked the piece and fired on 66.8% of
        // the 788 shipped positions - which is the record's FIRST trap,
        // "reporting every undefended piece would flag most positions and teach
        // nothing", arrived at by ignoring the second. So: a move after which
        // the piece can actually be WON, by static exchange evaluation.
        // FORCING is the operative word, and it has to be tested as such. A
        // version that asked only "is there a move after which this can be won"
        // fired on 66.8% of the 788 tactical positions and 40.6% of the quiet
        // master positions in this base's own corpus, because "undefended and
        // attackable" is a description of most pieces. The move must be one the
        // opponent has to answer - a check or a capture - and it must leave the
        // loose piece winnable. That is a fork or a discovery in the making,
        // which is what the concept is a warning about.
        const winnable = moves.some(m => {
          if (m.to === i) return false;                 // taking it is not "loose", it is hanging
          const nx = P.makeMove(st, m);
          if (!nx.b[i]) return false;
          const forcing = !!m.cap || P.inCheck(nx, them);
          if (!forcing) return false;
          // ...and the forcing move must survive being forcing. Found on
          // Lisitsin-Capablanca 1935, move 52, a pure QUEEN ending: this
          // reported White's queen on b2 as a loose piece because 52...Qd2+ is
          // a check that also attacks it and static exchange evaluation on b2
          // then says Black wins a queen - while White simply answers the check
          // with Qxd2 and Black has won nothing. Every queen in a queen ending
          // is undefended and attackable by the other one, which is the record's
          // first trap exactly: "reporting every undefended piece would flag
          // most positions and teach nothing".
          if (P.see(nx, m.to, them) > 0) return false;
          if (!P.attackersOf(nx, i, mover).length) return false;
          return P.see(nx, i, mover) > 0;
        });
        if (winnable) hits.push(FEAT.nameOf(i));
      }
      if (!hits.length) return null;
      return {
        confidence: 'medium',
        because: [`${side(f, them)} has an undefended piece on ${brief(hits)} that is not attacked yet, and ` +
                  `${side(f, mover)} has a move that attacks it`],
        slots: { square: hits[0] },
        subjects: [them],
      };
    },
  },
  {
    concept: 'seventy-five-move-rule',
    implements: ("recognition.preconditions: 150 ply with no capture and no pawn move. The record's " +
                 "indicator_against - 'the final move delivers checkmate, mate takes precedence' - is " +
                 "handled by the ordering rather than here: `checkmate` sits near the head of PRIORITY " +
                 "and this concept in the band below it, so a mating position leads with the mate."),
    run(f) {
      const half = Number(String(f.fen).split(' ')[4] || 0);
      if (!(half >= 130)) return null;
      return {
        confidence: 'high',
        because: [`${half} ply have passed with no capture and no pawn move; at 150 the game is drawn ` +
                  `automatically, with no claim needed`],
        slots: { count: String(half) },
        subjects: ['w', 'b'],
      };
    },
  },
  {
    concept: 'king-activation',
    implements: "recognition.preconditions: an endgame, with a king off its back rank",
    run(f) {
      // With no pawns there is nothing for an active king to attack or escort,
      // and the concept's whole content is about what the king does once there.
      //
      // The phase test also answers the first indicator_against - "queens or many
      // pieces remain and the king can be attacked" - because phaseOf() requires
      // no queens and a small non-pawn count. The second, "a rook ending with
      // concrete defensive resources, where the king may be needed at home", is
      // the warning the sentence carries below. The last two are about a MOVE -
      // losing time in a race, stepping into a check that gains a tempo - and
      // this arm reports a POSITION.
      //
      // The phase test also carries the record's strongest instruction, which is
      // worth stating so it is not lost in a refactor: "never recommend
      // centralising a king while the opponent has a queen, whatever the piece
      // count says." phaseOf() returns 'endgame' only with NO queens on the
      // board, so requiring the endgame is what enforces it here.
      if (f.phase !== 'endgame' || totalPawns(f) === 0) return null;
      const hits = [];
      for (const c of ['w', 'b']) if (f.king[c] && !f.king[c].onHomeRank) hits.push(c);
      if (!hits.length) return null;
      // "The single most important trap is ROOK ENDINGS, on the testimony of the
      // principle's own advocate: Shereshevsky found centralisation there to be
      // not merely untimely but sometimes simply wrong, and warns against
      // automatic centralising moves." His own example is 1...Ke5? losing to
      // 2.Rd5+ while the retreat 1...Kc5! draws - which is the second trap, that
      // the move still has to survive checks, and no static scan can run that.
      //
      // A rook ending therefore gets the WARNING, not a lower confidence. Both
      // stronger answers were tried and both are wrong. Refusing the concept
      // deletes Capablanca-Tartakower 1924, which is the single most famous king
      // march in a rook ending in the literature and this corpus's own annotated
      // instance; and downgrading to low confidence says "we are not sure the
      // king is off its back rank", which is not the doubt Shereshevsky is
      // expressing. He warns against centralising AUTOMATICALLY, so the sentence
      // carries the warning and the confidence stays. Third time today that
      // saying more has been the right answer to a trap where firing less was
      // the tempting one. 33 of the 122 positions this fires on are rook
      // endings.
      const rooks = f.material.w.counts.R + f.material.b.counts.R;
      const minors = f.material.w.counts.N + f.material.w.counts.B +
                     f.material.b.counts.N + f.material.b.counts.B;
      const rookEnding = rooks > 0 && minors === 0;
      return {
        confidence: 'medium',
        because: hits.map(c => `${side(f, c)}'s king has come off its back rank to ${f.king[c].square}, ` +
                 (rookEnding
                   ? 'which is where it belongs in most endgames — but this is a ROOK ending, where ' +
                     'the advocate of the principle warns against centralising automatically, and ' +
                     'where the move has to survive checks first'
                   : 'which is where it belongs in an endgame')),
        subjects: hits,
      };
    },
  },
];

/* -------------------------------------------------------------------------
 * Move matchers. The tactical half of Layer 3 is findMotifs() in the page and
 * it stays the authority: this does not re-derive motifs, it translates the
 * tags into concept ids using tools/motif_map.json's mapping.
 * ---------------------------------------------------------------------- */

/* The two guards above, kept out of the loop because each is a small piece of
 * chess rather than a piece of plumbing.
 *
 * Both fail OPEN. If the position cannot be rebuilt, or the detector's sentence
 * is not in the shape this reads, the motif is reported: findMotifs() is the
 * authority on motifs and a guard that cannot run has no standing to overrule
 * it. The one thing that must not happen is a silent guard that suppresses a
 * real fork because a regex missed.
 */
// sqIdx() at the top of this file assumes a well-formed name; these two guards
// read squares out of a detector sentence and out of moveInfo, so they check.
const sqIdxSafe = n => (/^[a-h][1-8]$/.test(n || '') ? sqIdx(n) : -1);

function motifGuard(tag, m, moveInfo) {
  if (tag !== 'fork' && tag !== 'pin' && tag !== 'skewer' &&
      tag !== 'trappedPiece' && tag !== 'discoveredAttack') return false;
  const P = FEAT.page;
  let after;
  try { after = P.stateFromFEN(moveInfo.fenAfter); } catch (e) { return false; }
  if (!after) return false;
  const them = after.turn;                       // the side about to reply

  if (tag === 'fork' || tag === 'skewer') {
    // "The forking piece can simply be captured." The forker is the piece that
    // just moved; a fork revealed by a DISCOVERY is delivered by a piece that
    // did not move, and this guard correctly says nothing about those.
    //
    // `skewer` states the same thing about its own geometry and one step
    // narrower - "The front unit can capture the skewering piece" - and this
    // test is one step wider, because it asks whether ANY capture of the
    // skewering piece is profitable. That is deliberate and it is worth saying
    // plainly: on 1r4k1/8/8/1q6/8/8/8/R5K1 w, Rb1 was reported as a skewer at
    // HIGH confidence and the queen simply takes the rook. Every position the
    // record's narrower wording covers is covered here; the extra ground is
    // positions where somebody ELSE eats the skewering piece, which is not a
    // skewer either.
    const sq = moveInfo.movedTo;
    if (!sq) return false;
    const idx = sqIdxSafe(sq);
    if (idx < 0) return false;
    const pc = after.b[idx];
    if (!pc || pc.c === them) return false;      // not our piece standing there
    return P.see(after, idx, them) > 0;          // taken, at a profit, and the fork is over
  }

  if (tag === 'trappedPiece') {
    // "It has a desperado capture that recovers the material" - this record's
    // second indicator_against. The detector's sentence is "every square it can
    // reach loses it", and on 8 of the 788 shipped puzzles a square it can reach
    // takes something big enough to pay for it. A rook that is lost is trapped;
    // a rook that is lost after eating a rook is a trade.
    const mm = ((m && m.text) || '').match(/on ([a-h][1-8])/);
    if (!mm) return false;
    const i = sqIdxSafe(mm[1]);
    if (i < 0 || !after.b[i]) return false;
    let ms;
    try { ms = P.legalMoves(after); } catch (e) { return false; }
    return ms.filter(x => x.from === i && x.cap).some(x => {
      let nx;
      try { nx = P.makeMove(after, x); } catch (e) { return false; }
      const won = P.VAL[x.cap.t] || 0;
      const lost = Math.max(0, P.see(nx, x.to, nx.turn));
      return won - lost >= 0;                  // it recovers what it is worth
    });
  }

  if (tag === 'discoveredAttack') {
    // "The revealed 'attack' hits something defended and not worth taking" -
    // this record's second indicator_against, and it was true of 33 of the 788
    // shipped puzzles: a rook revealed onto a defended pawn scores SEE -400 and
    // was reported as a discovered attack at HIGH confidence.
    //
    // A revealed CHECK is never guarded. The detector says "now checks the king"
    // for those and the regex below does not match them, which is deliberate:
    // a check is worth something whatever SEE says about the square.
    const mm = ((m && m.text) || '').match(/now attacks the \w+ on ([a-h][1-8])/);
    if (!mm) return false;
    const i = sqIdxSafe(mm[1]);
    if (i < 0) return false;
    const victim = after.b[i];
    if (!victim) return false;
    const taker = victim.c === 'w' ? 'b' : 'w';
    return P.see(after, i, taker) <= 0;        // defended, and not worth taking
  }

  // "The pinned piece can capture the pinner." The pinned square comes from the
  // detector's own sentence rather than from a second geometry pass, because
  // re-deriving the pin here is how two implementations of one motif start to
  // disagree. The sentence is the page's: "The rook on f8 is pinned to the king
  // behind it and cannot step aside."
  const text = (m && m.text) || '';
  const mm = text.match(/on ([a-h][1-8]) is pinned/);
  if (!mm) return false;
  const pinnedIdx = sqIdxSafe(mm[1]);
  const pinnerIdx = sqIdxSafe(moveInfo.movedTo || '');
  if (pinnedIdx < 0 || pinnerIdx < 0) return false;
  let moves;
  try { moves = P.legalMoves(after); } catch (e) { return false; }
  const takes = moves.some(x => x.from === pinnedIdx && x.to === pinnerIdx && x.cap);
  if (!takes) return false;
  // Capturing the pinner has to be worth doing. A pinned knight that can take a
  // defended queen is not pinned; one that can take a defended pawn still is.
  return P.see(after, pinnerIdx, them) >= 0;
}

function matchMotifs(motifs, moveInfo) {
  const out = [];
  // findMotifs() yields {tag, text} records, not bare strings. The text is the
  // page's own sentence for the motif; we take the tag and let the concept
  // record supply the wording, so the two explanations cannot drift apart.
  for (const m of motifs || []) {
    const tag = (m && typeof m === 'object') ? m.tag : m;
    const id = MOTIF_TO_CONCEPT[tag];
    if (!id) continue;
    // The records' own indicators_against, which a motif tag arrives without.
    // findMotifs() reports the GEOMETRY and is right to - a pawn on c5 does
    // attack b6 and d6, a rook on f8 is on the eighth rank in front of its
    // king. Whether the geometry MEANS anything is the concept record's
    // question, and both of these records answer it in writing:
    //
    //   fork  "The forking piece can simply be captured"
    //   pin   "The pinned piece can capture the pinner"
    //
    // Neither was built. On 4k3/8/1p1p4/8/2P5/8/8/4K3 w, c4-c5 was reported as
    // a fork at HIGH confidence; Syzygy says the move loses - 5 pieces, Black
    // wins, and the tablebase's own reply is dxc5. On 4rrk1/8/8/8/8/8/8/4RRK1 w,
    // Rxe8 was reported as a pin at HIGH confidence, and the pinned rook takes
    // the pinner. Prefer no concept match over a false concept match.
    const skip = motifGuard(tag, m, moveInfo);
    if (skip) continue;
    // findMotifs writes its own sentence about the position — "The knight on c7
    // forks the rook on a8 and the king on e8." — which is specific and already
    // audited by the page's own standards. Prefer it over anything generic this
    // file could compose, and fall back only if the detector gave no text.
    out.push({
      concept: id, source: 'findMotifs',
      confidence: 'high',
      because: [m && m.text ? String(m.text).replace(/\s*$/, '').replace(/\.$/, '')
                            : `the detector reports ${tag} for ${moveInfo.san || 'this move'}`],
      detector_text: (m && m.text) || null,
      subjects: [],
    });
    // A fork delivered by a knight is also the narrower named concept. The
    // detector does not distinguish them, and the record for knight-fork exists
    // precisely because the knight's geometry behaves differently.
    if (tag === 'fork' && moveInfo.san && /^N/.test(moveInfo.san)) {
      out.push({
        concept: 'knight-fork', source: 'findMotifs+piece',
        confidence: 'high',
        because: [`the fork is delivered by a knight (${moveInfo.san}), which cannot be blocked or attacked back except by another knight`],
        subjects: [],
      });
    }
  }
  return out;
}

/* Concepts that are properties of a MOVE rather than of a position. The
 * human-grounded corpus exposed the need for these: worst-placed-piece is a
 * claim about what a move achieves, and asking only about the board it was
 * played from missed an annotated instance entirely. */
const MOVE_BASED = [
  {
    concept: 'pawn-break',
    implements: ("recognition.preconditions: a pawn advances into contact with an enemy pawn. " +
                 "The record's second trap is a statement about this base rather than about a " +
                 "position - \"a break is not a pawn-breakthrough. This base keeps them separate: " +
                 "the breakthrough sacrifices to force a passer, the break challenges a structure\" " +
                 "- and it is kept: they are two concept records with two matchers, and " +
                 "pawn-breakthrough runs the rule of the square while this one only asks for " +
                 "contact. The third trap, that a break's value is often as an unplayed THREAT, " +
                 "is why this arm is MOVE-based and reports nothing about a break merely available. " +
                 "Plus the one indicator_against a static test can reach: \"The break opens a line " +
                 "towards your own king\"."),
    run(before, after, moveInfo) {
      const san = moveInfo.san || '';
      if (!/^[a-h]/.test(san)) return null;              // a pawn move
      const dest = (san.match(/([a-h][1-8])/g) || []).pop();
      if (!dest) return null;
      // CONTACT is the definition: after the move, the advanced pawn either
      // attacks an enemy pawn or can be taken by one. An earlier version
      // compared "captures available" before and after, which compares two
      // DIFFERENT sides to move and is meaningless.
      const file = dest.charCodeAt(0) - 97, rank = Number(dest[1]);
      const mover = before.sideToMove;
      const fwd = mover === 'w' ? 1 : -1;
      // Read the board straight from the FEN of the position after the move.
      const rows = (after.fen || '').split(' ')[0].split('/');
      const at = (f, r) => {
        if (f < 0 || f > 7 || r < 1 || r > 8) return null;
        const row = rows[8 - r];
        if (!row) return null;
        let i = 0;
        for (const ch of row) {
          if (/\d/.test(ch)) i += Number(ch);
          else { if (i === f) return ch; i++; }
        }
        return null;
      };
      const enemyPawnChar = mover === 'w' ? 'p' : 'P';
      let contact = false;
      for (const df of [-1, 1]) {
        if (at(file + df, rank + fwd) === enemyPawnChar) contact = true;   // we attack it
        if (at(file + df, rank - fwd) === enemyPawnChar) contact = true;   // it attacks us
      }
      if (!contact) return null;
      // "The break opens a line towards your own king" - the record's second
      // indicator_against, and the one of the three that a static test can
      // reach. The other two ask who is better placed to use the lines, which
      // is the same judgement the record's first trap says the detector cannot
      // make.
      //
      // What is tested is narrow and worth stating exactly: whether the file
      // the pawn LEFT, or the file it arrived on, is the mover's own king's
      // file or one next to it, and is open or half-open for the OPPONENT after
      // the move and was not before. That covers the case the phrase is usually
      // about - a break in front of your own king that hands the enemy rooks a
      // road - and does not cover diagonals, which need the enemy bishop's
      // square and a blocker scan that this arm has no board object to do.
      const kf = ((before.king[mover] || {}).square || '')[0];
      if (kf) {
        const leftFile = String.fromCharCode(97 + file - 0);
        const files = new Set([leftFile, dest[0]]);
        const near = [...files].some(x => Math.abs(x.charCodeAt(0) - kf.charCodeAt(0)) <= 1);
        const openFor = g => new Set((g.files.open || [])
          .concat(g.files.semiOpenFor[other(mover)] || []));
        const wasOpen = openFor(before), nowOpen = openFor(after);
        if (near && [...files].some(x => nowOpen.has(x) && !wasOpen.has(x))) return null;
      }
      return {
        confidence: 'low',
        because: [`${san} advances a pawn into contact with an enemy pawn, so the structure must ` +
                  `change — the opponent has to take, be taken, or leave the tension standing`],
        slots: {},
        subjects: [mover],
      };
    },
  },
  {
    concept: 'restraint',
    implements: ("the record's distinction from prophylaxis — restraint reduces the opponent's " +
                 "GENERAL mobility rather than preventing a specific plan. Measured as a quiet move " +
                 "that lowers the count of SAFE DESTINATIONS for the opponent's pieces. Not 'total " +
                 "piece scope', which this string used to say and the code never did: a restraining " +
                 "pawn move usually does not remove a square from the enemy's move list, it makes " +
                 "the square unusable, and Fischer's 30.h4 is the position that settled it."),
    run(before, after, moveInfo) {
      const san = moveInfo.san || '';
      if (/[x+#]/.test(san)) return null;              // not a capture, not a check
      const enemy = other(before.sideToMove);
      // SAFE destinations, not legal moves. A restraining pawn move usually does
      // not remove a square from the enemy's move list; it makes the square
      // unusable. Fischer's 30.h4 is the case that settled this.
      const b = before.safeSquares[enemy], a = after.safeSquares[enemy];
      if (b == null || a == null || b - a < 1) return null;
      return {
        confidence: 'low',
        because: [`${san} takes ${b - a} safe square${b - a === 1 ? '' : 's'} away from ` +
                  `${side(before, enemy)}'s pieces without attacking anything — they can still go ` +
                  `there, and a pawn now meets them if they do`],
        slots: {},
        subjects: [before.sideToMove],
      };
    },
  },
  {
    concept: 'king-safety',
    implements: ("recognition: 'THE PAWN SHIELD is the part players damage themselves. Pawns in front of " +
                 "a castled king are strongest unmoved.' A move that advances one of your own shield pawns " +
                 "while the enemy queen is on is that damage, done and not undoable."),
    run(before, after, moveInfo) {
      // Capablanca-Mattison 1929 is why this arm exists and why it is on the
      // REPLY rather than on 15.Ng5. The annotation's claim is that Ng5 'forces
      // Black to play ...f5, permanently weakening the kingside pawn cover' -
      // and 15.Ng5 itself changes the attacker count on Black's king zone not
      // at all, because the knight landing on g5 blocks the bishop that was
      // already looking at h6. The king-safety event is the forced reply.
      const mover = before.sideToMove;
      const pc = moveInfo.movedType;
      if (pc && pc !== 'P') return null;
      const kb = before.king[mover], ka = after.king[mover];
      const zb = before.kingZone && before.kingZone[mover];
      if (!kb || !ka || !zb) return null;
      if (before.phase === 'endgame') return null;
      if (!kb.castledSide) return null;
      if (!zb.enemyHasQueen) return null;
      if (ka.pawnShield >= kb.pawnShield) return null;
      return {
        confidence: 'low',
        because: [`${moveInfo.san || 'the move'} takes a pawn out of ${side(before, mover)}'s own king shield, ` +
                  `leaving ${ka.pawnShield} of three in front of the king on ${kb.square} with the enemy queen still on. ` +
                  `A pawn cannot go back.`],
        slots: { square: kb.square, count: String(ka.pawnShield) },
        subjects: [mover],
      };
    },
  },
  {
    concept: 'center-control',
    implements: ("the record's distinction between occupation and control, applied to a MOVE: a quiet " +
                 "move that raises the mover's attack count on d4/e4/d5/e5 is fighting for the centre " +
                 "whether or not it stands anywhere near it."),
    run(before, after, moveInfo) {
      // Keene on Reti-Capablanca, New York 1924: 18...Ne6 was the move
      // 'fighting more directly for control of the centre', and 18...N6d7 was
      // not. Nothing static separates those two - the centre is 6-7 either way.
      // What separates them is what the move does to the count, which is why
      // this arm exists at all.
      const san = moveInfo.san || '';
      if (/[x+#]/.test(san)) return null;              // a capture or check is doing something else
      const mover = before.sideToMove;
      const b = before.centre, a = after.centre;
      if (!b || !a) return null;
      // Measured on PAWNS AND MINOR PIECES, for the reason recorded at
      // centralSquareControl() in Layer 3: the raw count makes a knight arriving
      // to hit d4 look like a loss when it happens to block a rook's x-ray
      // through its own bishop.
      const gain = a.minorControl[mover] - b.minorControl[mover];
      if (gain < 1) return null;
      if (a.squaresLed[mover] < b.squaresLed[mover]) return null;
      const key = mover === 'w' ? 'wMinor' : 'bMinor';
      const grew = Object.keys(b.squares).filter(k => a.squares[k][key] > b.squares[k][key]);
      if (!grew.length) return null;
      return {
        confidence: 'low',
        because: [`${san || 'the move'} adds ${gain} to what ${side(before, mover)}'s pawns and minor pieces ` +
                  `attack in the centre, on ${brief(grew)}, without occupying anything there`],
        slots: { square: grew.join(', ') },
        subjects: [mover],
      };
    },
  },
  {
    concept: 'king-safety',
    implements: ("recognition: the count of enemy pieces that can reach the king's zone, and the pawn " +
                 "shield. Reported for a MOVE when the move itself raises that count - which is the " +
                 "observable half of what an attacking move does."),
    run(before, after, moveInfo) {
      const mover = before.sideToMove;
      const them = other(mover);
      const zb = before.kingZone && before.kingZone[them];
      const za = after.kingZone && after.kingZone[them];
      const kb = before.king[them];
      if (!zb || !za || !kb) return null;
      if (before.phase === 'endgame') return null;      // the record's registered false positive
      if (!kb.castledSide) return null;
      if (!za.enemyHasQueen) return null;
      if (za.attackers < 2 || za.attackers <= zb.attackers) return null;
      return {
        confidence: 'low',
        because: [`${moveInfo.san || 'the move'} brings a ${za.attackers}${zb.attackers ? 'th' : 'nd'} piece to bear on ` +
                  `${side(before, them)}'s king zone, up from ${zb.attackers}, against ${za.defenders} defenders ` +
                  `and ${kb.pawnShield} of three shield pawns`],
        slots: { square: kb.square, count: String(za.attackers) },
        subjects: [them],
      };
    },
  },
  {
    concept: 'promotion',
    implements: "recognition.preconditions: a pawn moving to the eighth rank for White or the first for Black.",
    run(before, after, moveInfo) {
      if (moveInfo.movedType !== 'P') return null;
      const r = Number(String(moveInfo.movedTo || '')[1]);
      if (r !== 8 && r !== 1) return null;
      return {
        confidence: 'high',
        because: [`${moveInfo.san || 'the move'} promotes the pawn on ${moveInfo.movedTo}`],
        slots: { square: moveInfo.movedTo },
        subjects: [before.sideToMove],
      };
    },
  },
  {
    concept: 'castling',
    implements: ("recognition.preconditions. Reported for the MOVE and not for the rights: almost every " +
                 "opening position has castling rights, and a concept true of almost every position is not " +
                 "news. A king moving two squares is."),
    run(before, after, moveInfo) {
      if (moveInfo.movedType !== 'K') return null;
      const fileOf = sq => (sq || '').charCodeAt(0);
      if (Math.abs(fileOf(moveInfo.movedTo) - fileOf(moveInfo.movedFrom)) !== 2) return null;
      const side_ = fileOf(moveInfo.movedTo) > fileOf(moveInfo.movedFrom) ? 'kingside' : 'queenside';
      return {
        confidence: 'high',
        because: [`${moveInfo.san || 'the move'} castles ${side_}, moving the king to safety and bringing ` +
                  `the rook towards the centre in one move`],
        slots: { square: moveInfo.movedTo },
        subjects: [before.sideToMove],
      };
    },
  },
  {
    concept: 'discovered-check',
    implements: ("recognition.preconditions: a friendly line piece aimed at the enemy king through exactly " +
                 "one friendly blocker, and the blocker moves off the line. Detected as findMotifs' own " +
                 "discoveredAttack where the revealed attack is on the KING, which is what makes the moving " +
                 "piece free to do anything."),
    run(before, after, moveInfo) {
      const tags = (moveInfo.motifs || []).map(m => m.tag);
      if (tags.includes('doubleCheck')) return null;      // that record says more
      if (!tags.includes('discoveredAttack')) return null;
      const text = (moveInfo.motifs.find(m => m.tag === 'discoveredAttack') || {}).text || '';
      if (!/checks the king/.test(text)) return null;
      return {
        confidence: 'high',
        because: [`${moveInfo.san || 'the move'} uncovers a check, so the piece that moved is free to go ` +
                  `anywhere it likes — the reply has to answer the check`],
        slots: { square: moveInfo.movedTo || '' },
        subjects: [before.sideToMove],
      };
    },
  },
  {
    concept: 'smothered-mate',
    implements: ("recognition.preconditions: the enemy king's flight squares are all occupied by its own " +
                 "pieces, and a knight gives the check. Reported only on an actual mate, because the " +
                 "pattern without the mate is a king that happens to be surrounded."),
    run(before, after, moveInfo) {
      if (moveInfo.movedType !== 'N') return null;
      const tags = (moveInfo.motifs || []).map(m => m.tag);
      if (!tags.includes('mate')) return null;
      const P = FEAT.page;
      const st = P.stateFromFEN(moveInfo.fenAfter);
      const them = st.turn;
      const k = P.kingSq(st, them);
      if (k < 0) return null;
      const r = k >> 3, c = k & 7;
      let flight = 0, blocked = 0;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const rr = r + dr, cc = c + dc;
        if (rr < 0 || rr > 7 || cc < 0 || cc > 7) continue;
        flight++;
        const q = st.b[rr * 8 + cc];
        if (q && q.c === them) blocked++;
      }
      if (!flight || blocked !== flight) return null;
      return {
        confidence: 'high',
        because: [`${moveInfo.san || 'the move'} is mate by a knight against a king whose every flight ` +
                  `square is occupied by its own men`],
        slots: { square: moveInfo.movedTo || '' },
        subjects: [before.sideToMove],
      };
    },
  },
  {
    concept: 'sacrifice',
    implements: ("recognition.preconditions verbatim, and using the detector the record names: the page's " +
                 "own sacrificeSize(), which is SEE-based. 'A capture the engine happens to like is not a " +
                 "sacrifice. The repo's own definition is the right one: material that CAN be taken and is " +
                 "offered anyway.' Plus the first indicator_against - 'material is given up with nothing " +
                 "nameable in return - that is a blunder, not a sacrifice' - tested two plies deep: if " +
                 "the offer is accepted, the offering side must have a check or a winning capture."),
    run(before, after, moveInfo) {
      const P = FEAT.page;
      const st = P.stateFromFEN(before.fen);
      const all = P.legalMoves(st);
      const mv = all.find(m => P.uciOf(m) === moveInfo.uci);
      if (!mv) return null;
      // NET, not gross, and the difference is a false positive this matcher
      // made for as long as it existed. The page's sacrificeSize() answers "how
      // much can the opponent take on that square now", which is the right
      // question for Bxh7+ and the wrong one for RxR: on 4rrk1/8/8/8/8/8/8/4RRK1
      // it returns 500 for Rxe8, because a rook can indeed be taken there - and
      // says nothing about the rook this move just won. This record's second
      // trap is "An even trade is not a sacrifice", the line below claimed to be
      // implementing it, and it was not: the trade came through as a 500-point
      // sacrifice at medium confidence. Subtracting what the move captured is
      // the whole of the fix, and it leaves the Greek-gift shape alone - Bxh7+
      // nets 330 minus a pawn, which is still a sacrifice.
      const size = P.sacrificeSize(st, mv, P.makeMove(st, mv)) -
                   (mv.cap ? (P.VAL[mv.cap.t] || 0) : 0);
      if (size < 100) return null;                  // an even trade is not a sacrifice
      // "Material is given up with NOTHING NAMEABLE IN RETURN - that is a
      // blunder, not a sacrifice" - the record's first indicator_against, and
      // the only half of it a static scan can reach: if the offer is accepted,
      // does the offering side then have anything forcing? A check or a capture
      // that wins material is nameable; nothing at all is a blunder as far as
      // this base can see, and calling it a sacrifice teaches a reader to admire
      // a lost piece.
      //
      // Two plies, and no further. The record's own caution stays attached
      // either way, because whether the compensation is SUFFICIENT is the
      // difference between '!' and '?' and no material test sees it.
      const followsUp = (() => {
        const nx = P.makeMove(st, mv);
        let theirs;
        try { theirs = P.legalMoves(nx); } catch (e) { return true; }
        const grabs = theirs.filter(x => x.to === mv.to && x.cap);
        if (!grabs.length) return true;             // not accepted here, not our question
        return grabs.some(g => {
          let after2;
          try { after2 = P.makeMove(nx, g); } catch (e) { return true; }
          let ours;
          try { ours = P.legalMoves(after2); } catch (e) { return true; }
          return ours.some(o => {
            let nx3;
            try { nx3 = P.makeMove(after2, o); } catch (e) { return false; }
            if (P.inCheck(nx3, nx3.turn)) return true;
            if (!o.cap) return false;
            try { return P.see(after2, o.to, after2.turn) > 0; } catch (e) { return false; }
          });
        });
      })();
      if (!followsUp) return null;
      return {
        // The record's own typical confidence is high and the measurement is
        // exact, but what is NOT established is that the compensation is real -
        // which is the difference between '!' and '?' and is why the caution
        // travels with it.
        confidence: 'medium',
        because: [`${moveInfo.san || 'the move'} leaves ${(size / 100).toFixed(0)} point` +
                  `${size >= 200 ? 's' : ''} of material there to be taken, and offers it anyway`],
        slots: { count: String(Math.round(size / 100)) },
        subjects: [before.sideToMove],
      };
    },
  },
  {
    concept: 'exchange-sacrifice',
    implements: ("recognition.preconditions: a rook is given for a knight or bishop. The record's MAIN " +
                 "false-positive trap is that a rook given inside a forced mating line is a mating " +
                 "sacrifice with identical material, and no material test can see the difference - so the " +
                 "caution travels with the claim and the confidence stays at the record's medium."),
    run(before, after, moveInfo) {
      if (moveInfo.movedType !== 'R') return null;
      const P = FEAT.page;
      const st = P.stateFromFEN(before.fen);
      const all = P.legalMoves(st);
      const mv = all.find(m => P.uciOf(m) === moveInfo.uci);
      if (!mv) return null;
      const nx = P.makeMove(st, mv);
      const them = other(before.sideToMove);
      // The rook must actually be winnable where it stands, and by a MINOR
      // piece or a pawn - a rook taken by a rook is a trade, not this.
      const gain = P.see(nx, mv.to, them);
      if (gain <= 0) return null;
      const cheapest = P.attackersOf(nx, mv.to, them)
        .map(a => nx.b[a] && nx.b[a].t).filter(Boolean)
        .sort((a, b) => ({ P: 1, N: 3, B: 3, R: 5, Q: 9, K: 99 }[a] - { P: 1, N: 3, B: 3, R: 5, Q: 9, K: 99 }[b]))[0];
      if (cheapest !== 'N' && cheapest !== 'B') return null;
      return {
        confidence: 'medium',
        because: [`${moveInfo.san || 'the move'} puts a rook where a ${cheapest === 'N' ? 'knight' : 'bishop'} ` +
                  `wins it, giving up about a pawn and a half of material for whatever the square is worth`],
        slots: { square: moveInfo.movedTo || '' },
        subjects: [before.sideToMove],
      };
    },
  },
  {
    concept: 'worst-placed-piece',
    implements: ("the record's condition — when nothing urgent is happening, the right move is the " +
                 "one that improves the piece doing least. Measured as an increase in the MINIMUM " +
                 "piece scope across the side's own pieces, plus the record's second trap: " +
                 "\"improving pieces while the opponent builds an initiative produces individually " +
                 "reasonable moves and a collectively lost position.\" " +
                 "Note what is NOT claimed. The record says 'identifying the worst piece is a " +
                 "judgement, not a measurement. This system has no reliable detector for it and " +
                 "must not claim one', and this does not claim one: it says that THIS MOVE raised " +
                 "the scope of the least active piece, which is a measurement about a move, and it " +
                 "says it at low confidence. It never says which piece is worst."),
    run(before, after, moveInfo) {
      // The record's precondition is that nothing more urgent is happening, and
      // that is a property of the MOVE rather than of the whole position. An
      // earlier version demanded a quiet position and so missed Rubinstein's
      // 20.e3 — which improves the worst pieces AND gains a tempo, exactly as
      // its annotator says. A move that captures or checks is doing something
      // else; a quiet move in a position with no check against you is not.
      if (before.quietness.inCheck) return null;
      const san = moveInfo.san || '';
      if (/[x+#]/.test(san)) return null;
      const mover = before.sideToMove;
      const b = before.scopes[mover], a = after.scopes[mover];
      if (!b || !b.length || !a || !a.length) return null;
      const worstBefore = b[0], worstAfter = a[0];
      if (worstAfter.moves <= worstBefore.moves) return null;
      // and the total must not have fallen: a move that frees one piece by
      // burying two has not improved anything.
      const sum = xs => xs.reduce((n, x) => n + x.moves, 0);
      if (sum(a) < sum(b)) return null;
      // ...and the opponent must not be handed anything by it. "Improving pieces
      // while the opponent builds an initiative produces individually reasonable
      // moves and a collectively lost position. This is the commonest way the
      // rule is misapplied" - the record's second trap, and the half of it a
      // static test can answer is whether the position AFTER the move hands the
      // opponent MATERIAL. A quiet move that does is not an instance of the
      // rule; it is the mistake the rule is famous for.
      //
      // Only winning captures, and the bound was set by a position rather than
      // guessed. Including "a check is available" as well took this from 8.4% to
      // 1.6% and lost Rubinstein-Salwe 1908 move 20 - the corpus's own annotated
      // instance of the concept, and the position the comment above already
      // says an earlier over-strict version missed. A check being available is
      // not an initiative; a hanging piece is.
      const q = after.quietness;
      if (q && q.winningCapturesAvailable > 0) return null;
      // ...and the other half of the same trap, which the material test cannot
      // see at all: MATE. "The opponent has a concrete threat that must be met"
      // is this record's first indicator_against, and the sharpest concrete
      // threat there is leaves no material on the floor to detect. On
      // 4r1k1/5ppp/8/8/8/8/5PPP/N5K1 w the knight on a1 is beyond argument the
      // worst-placed piece on the board, Nb3 improves it, no capture is hanging
      // - and Black plays Re1 mate. This was reported as an instance of the
      // rule; it is the textbook illustration of misapplying it.
      //
      // Mate in ONE and no further. Whether a threat two moves out "must be
      // met" is a judgement, and this record's third trap is that identifying
      // the worst piece is a judgement this system must not claim to make; a
      // mate the move generator can enumerate is not a judgement.
      const mateInOne = (() => {
        const P = FEAT.page;
        let st;
        try { st = P.stateFromFEN(after.fen); } catch (e) { return false; }
        let ms;
        try { ms = P.legalMoves(st); } catch (e) { return false; }
        return ms.some(x => {
          let nx;
          try { nx = P.makeMove(st, x); } catch (e) { return false; }
          try { return P.inCheck(nx, nx.turn) && P.legalMoves(nx).length === 0; }
          catch (e) { return false; }
        });
      })();
      if (mateInOne) return null;
      return {
        confidence: 'low',
        because: [`${moveInfo.san || 'the move'} raises the scope of ${side(before, mover)}'s least ` +
                  `active piece from ${worstBefore.moves} squares (the ${worstBefore.type === 'N' ? 'knight' :
                    worstBefore.type === 'B' ? 'bishop' : worstBefore.type === 'R' ? 'rook' : 'queen'} on ` +
                  `${worstBefore.square}) to ${worstAfter.moves}, in a position where nothing is forcing`],
        slots: {},
        subjects: [mover],
      };
    },
  },
];

function matchAll(features, moveInfo, concepts, featuresAfter) {
  let found = [];
  for (const m of STRUCTURAL) {
    let r = null;
    try { r = m.run(features); } catch (e) { r = null; }
    if (!r) continue;
    const rec = concepts[m.concept];
    if (!rec) continue;                        // never invent a concept id
    found.push({
      concept: m.concept, source: 'features', implements: m.implements,
      confidence: cap(r.confidence, rec.knowledge_type, (rec.recognition || {}).typical_confidence),
      raw_confidence: r.confidence,
      because: r.because, subjects: r.subjects || [], slots: r.slots || {},
    });
  }
  if (moveInfo && moveInfo.legal && featuresAfter) {
    for (const m of MOVE_BASED) {
      let r = null;
      try { r = m.run(features, featuresAfter, moveInfo); } catch (e) { r = null; }
      if (!r) continue;
      const rec = concepts[m.concept];
      if (!rec) continue;
      found.push({ concept: m.concept, source: 'move', implements: m.implements,
                   confidence: cap(r.confidence, rec.knowledge_type, (rec.recognition || {}).typical_confidence),
                   raw_confidence: r.confidence, because: r.because,
                   subjects: r.subjects || [], slots: r.slots || {} });
    }
  }
  if (moveInfo && moveInfo.legal) {
    for (const m of matchMotifs(moveInfo.motifs, moveInfo)) {
      const rec = concepts[m.concept];
      if (!rec) continue;
      found.push({ ...m, slots: m.slots || {}, implements: 'tools/motif_map.json',
                   confidence: cap(m.confidence, rec.knowledge_type, (rec.recognition || {}).typical_confidence),
                   raw_confidence: m.confidence });
    }
  }
  // One concept, one entry. Two arms of the same matcher - a structural one and
  // a move-based one - can both fire, and until this was here the API printed
  // `center-control` twice in a row at a reader. Merge rather than drop: the two
  // arms are saying different true things about the same concept, and the
  // reasons are what the explanation is built from.
  const byConcept = new Map();
  for (const item of found) {
    const prev = byConcept.get(item.concept);
    if (!prev) { byConcept.set(item.concept, item); continue; }
    const rank0 = { high: 0, medium: 1, low: 2 };
    const keep = rank0[item.confidence] < rank0[prev.confidence] ? item : prev;
    const drop = keep === item ? prev : item;
    keep.because = keep.because.concat(drop.because.filter(x => !keep.because.includes(x)));
    keep.slots = Object.assign({}, drop.slots, keep.slots);
    keep.subjects = [...new Set(keep.subjects.concat(drop.subjects))];
    keep.source = keep.source === drop.source ? keep.source : 'features+move';
    byConcept.set(item.concept, keep);
  }
  found = [...byConcept.values()];

  // Most specific first, then by confidence, so a caller taking the head of the
  // list gets the sharpest true statement rather than the broadest one.
  // Tactics the move actually created come first — they are what just happened.
  // Then informativeness, then confidence.
  //
  // Ordering by confidence before informativeness looks more rigorous and reads
  // worse, because the two measure different things. Confidence here is capped
  // by knowledge type, so a `terminology` record such as luft scores high — we
  // are certain the term applies — while an outpost, mechanically detected and
  // far more useful to point at, is capped to medium as a positional-concept.
  // Sorting on that put "the king has no escape square" ahead of "there is an
  // unassailable knight on d5" in a position that is about the knight. What to
  // SAY FIRST is a question about informativeness; confidence is still reported
  // on every entry and still caps what may be claimed.
  const rank = { high: 0, medium: 1, low: 2 };
  const isMotif = x => (x.source || '').startsWith('findMotifs') ? 0 : 1;
  // A low-confidence claim must never be the headline, however informative the
  // concept would be if it were true. Tested against Nimzowitsch-Salwe 1911,
  // ordering by informativeness alone led with "White's bishop on d4 is bad" -
  // about the blockading piece the entire game is built around, and reported at
  // low confidence because the record says the structural test is unreliable.
  // Informativeness decides between claims we are equally sure of; it does not
  // promote one we are not sure of at all.
  found.sort((a, b) => isMotif(a) - isMotif(b) ||
                       priorityOf(a.concept) - priorityOf(b.concept) ||
                       rank[a.confidence] - rank[b.confidence]);

  // A low-confidence claim must never be the HEADLINE, and until now it was
  // also barred from everything else: the comparator demoted every low-
  // confidence entry below every medium one, so a concept firing on 1.5% of
  // positions sat behind six that fire on more than half. That is what put the
  // human-attributed concept at rank 7, 8 and 10 on six of twelve corpus
  // positions - reported, and outside the six the API returns by default.
  //
  // The rule the comment was reaching for applies to ONE position in the list,
  // so it is applied to one: if the head is low-confidence and anything else is
  // not, that one leads instead. Everything below the lead is ordered by
  // informativeness, which is where a hedged claim about a rare feature belongs.
  if (found.length > 1 && found[0].confidence === 'low') {
    const i = found.findIndex(x => x.confidence !== 'low');
    if (i > 0) found.unshift(found.splice(i, 1)[0]);
  }
  return found;
}

module.exports = { matchAll, matchMotifs, motifGuard, STRUCTURAL, MOVE_BASED, MOTIF_TO_CONCEPT, CEILING, cap, PRIORITY };
