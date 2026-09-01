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
const cap = (want, kt) => {
  const c = CEILING[kt] || 'medium';
  return ORDER[want] < ORDER[c] ? want : c;
};

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
  'checkmate', 'double-check', 'fork', 'knight-fork', 'pin', 'skewer',
  'discovered-attack', 'back-rank-mate', 'trapped-piece', 'hanging-piece',
  // then structural features, most informative first
  'outpost', 'rook-on-the-seventh', 'passed-pawn', 'isolated-queen-pawn',
  'backward-pawn', 'doubled-pawns', 'opposite-coloured-bishops', 'bishop-pair',
  'bad-bishop', 'luft', 'semi-open-file', 'open-file', 'weak-square', 'material-imbalance',
  'king-activation',
  'space', 'piece-activity',
];
const priorityOf = id => {
  const i = PRIORITY.indexOf(id);
  return i === -1 ? PRIORITY.length : i;
};

const STRUCTURAL = [
  {
    concept: 'doubled-pawns',
    implements: "recognition.preconditions: two or more pawns of one colour on a file",
    run(f) {
      const hits = [];
      for (const c of ['w', 'b']) if (f.pawns[c].doubled.length) hits.push({ c, sq: f.pawns[c].doubled });
      if (!hits.length) return null;
      return {
        confidence: 'high',
        because: hits.map(h => `${side(f, h.c)} has doubled pawns on ${h.sq.join(', ')}`),
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
      // d-pawn in a pawn ending is not an IQP, it is a passed pawn.
      if (totalPieces(f) === 0) return null;
      const hits = [];
      for (const c of ['w', 'b']) {
        if (pawnCount(f, c) < 2) continue;
        const d = f.pawns[c].isolated.filter(s => s[0] === 'd');
        if (d.length) hits.push({ c, sq: d });
      }
      if (!hits.length) return null;
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
    implements: "recognition.preconditions: no enemy pawn ahead on its file or either adjacent file",
    run(f) {
      const hits = [];
      for (const c of ['w', 'b']) if (f.pawns[c].passed.length) hits.push({ c, sq: f.pawns[c].passed });
      if (!hits.length) return null;
      return {
        confidence: 'high',
        because: hits.map(h => `${side(f, h.c)} has a passed pawn on ${brief(h.sq)}`),
        slots: { square: hits[0].sq[0] },
        subjects: hits.map(h => h.c),
      };
    },
  },
  {
    concept: 'backward-pawn',
    implements: "recognition: lagging behind its neighbours with its advance square controlled by an enemy pawn",
    run(f) {
      const hits = [];
      for (const c of ['w', 'b']) if (f.pawns[c].backward.length) hits.push({ c, sq: f.pawns[c].backward });
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
    implements: "recognition.preconditions: a file with no pawns of either colour",
    run(f) {
      // The concept's own record says a file with no entry point does nothing,
      // and mass testing over 788 positions showed this firing on 61% of them -
      // a label that common carries almost no information. Require a rook or
      // queen actually standing on the file, which is what makes it this side's
      // file rather than a fact about the pawns.
      if (!f.files.open.length || totalHeavy(f) === 0) return null;
      const occupied = [];
      for (const c of ['w', 'b']) for (const r of f.pieces[c].rooksOnOpenFiles) occupied.push(`${side(f, c)}'s rook on ${r}`);
      if (!occupied.length) return null;
      const because = [`the ${f.files.open.join('- and ')}-file${f.files.open.length > 1 ? 's are' : ' is'} open, and ${occupied.join(' and ')} stand${occupied.length > 1 ? '' : 's'} on it`];
      return { confidence: 'high', because,
               slots: { file: f.files.open[0] }, subjects: ['w', 'b'] };
    },
  },
  {
    concept: 'semi-open-file',
    implements: "recognition.preconditions: a file carrying an enemy pawn and none of your own",
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
      // Firing on 83% of tested positions before this guard. Nearly every
      // position has a semi-open file somewhere; what is worth reporting is one
      // a rook is actually using.
      const withRook = hits.filter(h => h.rooks.length);
      if (!withRook.length) return null;
      const lead = withRook[0];
      return {
        confidence: 'high',
        because: withRook.map(h => `${side(f, h.c)} has a rook on ${h.rooks.join(' and ')}, on a semi-open file`),
        slots: { file: lead.files[0] },
        subjects: withRook.map(h => h.c),
      };
    },
  },
  {
    concept: 'outpost',
    implements: "recognition: a minor piece on a square no enemy pawn can attack, defended by a friendly pawn",
    run(f) {
      const hits = [];
      for (const c of ['w', 'b']) if (f.outposts[c].length) hits.push({ c, o: f.outposts[c] });
      if (!hits.length) return null;
      return {
        confidence: 'high',
        because: hits.map(h => `${side(f, h.c)}'s ${h.o.map(x => `${x.piece === 'N' ? 'knight' : 'bishop'} on ${x.square}`).join(' and ')} cannot be driven off by a pawn and is defended by one`),
        slots: { square: hits[0].o[0].square,
                 piece: hits[0].o[0].piece === 'N' ? 'knight' : 'bishop' },
        subjects: hits.map(h => h.c),
      };
    },
  },
  {
    concept: 'weak-square',
    implements: "recognition: a square in one camp that no pawn of that colour can ever attack",
    run(f) {
      const hits = [];
      // A hole is a hole in something, and a hole nothing can use is not worth
      // mentioning - the strong-square record says a strong square is worth
      // nothing if nothing valuable can reach it. Before this guard the matcher
      // fired on 57% of 788 tested positions, which is a label carrying almost
      // no information. Report a hole a minor piece can actually move to: that
      // is a plan rather than a fact about the pawn structure. Squares already
      // occupied are left to the outpost matcher, which says more about them.
      for (const c of ['w', 'b']) {
        if (pawnCount(f, other(c)) < 3) continue;
        const taken = new Set((f.outposts[c] || []).map(o => o.square));
        const usable = (f.reachableHoles[c] || []).filter(sq => !taken.has(sq));
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
    implements: "recognition.preconditions: two bishops of opposite square colours, opponent has fewer",
    run(f) {
      for (const c of ['w', 'b']) {
        if (f.pieces[c].bishopPair && !f.pieces[other(c)].bishopPair) {
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
      const HOME = { w: ['c1', 'f1'], b: ['c8', 'f8'] };
      for (const c of ['w', 'b']) {
        for (const b of (f.pieces[c].bishops || [])) {
          if (HOME[c].includes(b.square)) continue;
          if (b.ownPawnsOnItsColour < 4 || b.share < 0.55) continue;
          // Suba's active bad bishop is the registered false positive on this
          // record: structurally bad, outside the chain, and a fine piece. Scope
          // is what tells them apart, so a bishop that can see is not reported.
          if (b.scope >= 7) continue;
          return {
            confidence: 'medium',
            because: [`${side(f, c)}'s bishop on ${b.square} shares its colour with ${b.ownPawnsOnItsColour} of its own ${b.ownPawnsTotal} pawns, and sees only ${b.scope} squares`],
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
    implements: "recognition.preconditions: exactly one bishop each, on opposite colours",
    run(f) {
      if (!f.pieces.oppositeColouredBishops) return null;
      return {
        confidence: 'high',
        because: ['each side has one bishop and they travel on opposite square colours, so neither can attack or defend the other’s squares'],
        subjects: ['w', 'b'],
      };
    },
  },
  {
    concept: 'rook-on-the-seventh',
    implements: "recognition.preconditions: a rook on the opponent's second rank",
    run(f) {
      const hits = [];
      for (const c of ['w', 'b']) if (f.pieces[c].rooksOnSeventh.length) hits.push({ c, r: f.pieces[c].rooksOnSeventh });
      if (!hits.length) return null;
      return {
        confidence: 'high',
        because: hits.map(h => `${side(f, h.c)} has a rook on ${h.r.join(' and ')}, on the rank the enemy pawns start on`),
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
      for (const c of ['w', 'b']) if (f.king[c] && f.king[c].backRankExposure) hits.push(c);
      if (!hits.length) return null;
      return {
        confidence: 'high',
        because: hits.map(c => `${side(f, c)}'s king is on its back rank with no escape square, and ${side(f, other(c))} still has a rook or queen`),
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
      const d = f.material.balance;
      const describe = c => {
        const m = c === 'w' ? w : b;
        return `${m.Q ? m.Q + 'Q ' : ''}${m.R ? m.R + 'R ' : ''}${m.B ? m.B + 'B ' : ''}${m.N ? m.N + 'N ' : ''}${m.P}P`.trim();
      };
      return {
        confidence: 'high',
        because: [`the material is unbalanced — White has ${describe('w')} against Black's ${describe('b')}` +
                  (d === 0 ? ', level on points' : `, ${Math.abs(d)} point${Math.abs(d) === 1 ? '' : 's'} to ${d > 0 ? 'White' : 'Black'}`)],
        subjects: d > 0 ? ['w'] : d < 0 ? ['b'] : ['w', 'b'],
      };
    },
  },
  {
    concept: 'space',
    implements: "recognition: one side's pawns control more squares in the opponent's half",
    run(f) {
      const w = f.activity.pawnSpace.w, b = f.activity.pawnSpace.b;
      if (totalPawns(f) < 6 || Math.abs(w - b) < 2) return null;
      const c = w > b ? 'w' : 'b';
      return {
        confidence: 'medium',
        because: [`${side(f, c)}'s pawns control ${Math.max(w, b)} squares in the opponent's half against ${Math.min(w, b)}`],
        subjects: [c],
      };
    },
  },
  {
    concept: 'piece-activity',
    implements: "recognition.indicators_for: a difference in what the pieces can do",
    run(f) {
      const w = f.activity.mobility.w, b = f.activity.mobility.b;
      if (w == null || b == null) return null;
      const gap = Math.abs(w - b);
      if (gap < 8) return null;                 // small gaps are noise, not activity
      const c = w > b ? 'w' : 'b';
      return {
        confidence: 'low',
        because: [`${side(f, c)} has ${Math.max(w, b)} legal moves against ${Math.min(w, b)}`],
        subjects: [c],
      };
    },
  },
  {
    concept: 'king-activation',
    implements: "recognition.preconditions: an endgame, with a king off its back rank",
    run(f) {
      // With no pawns there is nothing for an active king to attack or escort,
      // and the concept's whole content is about what the king does once there.
      if (f.phase !== 'endgame' || totalPawns(f) === 0) return null;
      const hits = [];
      for (const c of ['w', 'b']) if (f.king[c] && !f.king[c].onHomeRank) hits.push(c);
      if (!hits.length) return null;
      return {
        confidence: 'medium',
        because: hits.map(c => `${side(f, c)}'s king has come off its back rank to ${f.king[c].square}, which is where it belongs in an endgame`),
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

function matchMotifs(motifs, moveInfo) {
  const out = [];
  // findMotifs() yields {tag, text} records, not bare strings. The text is the
  // page's own sentence for the motif; we take the tag and let the concept
  // record supply the wording, so the two explanations cannot drift apart.
  for (const m of motifs || []) {
    const tag = (m && typeof m === 'object') ? m.tag : m;
    const id = MOTIF_TO_CONCEPT[tag];
    if (!id) continue;
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

function matchAll(features, moveInfo, concepts) {
  const found = [];
  for (const m of STRUCTURAL) {
    let r = null;
    try { r = m.run(features); } catch (e) { r = null; }
    if (!r) continue;
    const rec = concepts[m.concept];
    if (!rec) continue;                        // never invent a concept id
    found.push({
      concept: m.concept, source: 'features', implements: m.implements,
      confidence: cap(r.confidence, rec.knowledge_type),
      raw_confidence: r.confidence,
      because: r.because, subjects: r.subjects || [], slots: r.slots || {},
    });
  }
  if (moveInfo && moveInfo.legal) {
    for (const m of matchMotifs(moveInfo.motifs, moveInfo)) {
      const rec = concepts[m.concept];
      if (!rec) continue;
      found.push({ ...m, slots: m.slots || {}, implements: 'tools/motif_map.json',
                   confidence: cap(m.confidence, rec.knowledge_type),
                   raw_confidence: m.confidence });
    }
  }
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
  found.sort((a, b) => isMotif(a) - isMotif(b) ||
                       priorityOf(a.concept) - priorityOf(b.concept) ||
                       rank[a.confidence] - rank[b.confidence]);
  return found;
}

module.exports = { matchAll, matchMotifs, STRUCTURAL, MOTIF_TO_CONCEPT, CEILING, cap, PRIORITY };
