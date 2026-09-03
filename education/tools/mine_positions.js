'use strict';
/* Mine real positions exhibiting each positional concept.
 *
 * The depth audit showed the base's weakness precisely: strong on research,
 * thin on evidence. 84% of board-level concepts had no positive example and 85%
 * no negative one. Constructing hundreds of FENs by hand would be slow and
 * error-prone, so this mines them instead.
 *
 * The corpus is every position in puzzles/*.json PLUS every `prev` position -
 * roughly 1500 real positions. A caveat worth stating up front: these were
 * SELECTED as tactical puzzles. The positions themselves are ordinary game
 * positions and the puzzle-ness is a property of the move, not the board, so
 * they are legitimate positional examples - but they over-represent sharp
 * positions and that is recorded with every record mined from them.
 *
 * For each concept this looks for two things:
 *   POSITIVE  the feature present and unambiguous
 *   NEAR-MISS the surface pattern present and the concept's CONDITION absent -
 *             which is what a false-positive test needs and what is hardest to
 *             construct by hand
 *
 *     node tools/mine_positions.js [--concept outpost] [--limit 3] [--json out]
 */
const fs = require('fs');
const path = require('path');
const F = require('../lib/features.js');

const ROOT = path.join(__dirname, '..');
const PUZZLES = path.join(ROOT, '..', 'puzzles');

const argv = process.argv.slice(2);
const only = argv.includes('--concept') ? argv[argv.indexOf('--concept') + 1] : null;
const perConcept = argv.includes('--limit') ? Number(argv[argv.indexOf('--limit') + 1]) : 3;
const jsonOut = argv.includes('--json') ? argv[argv.indexOf('--json') + 1] : null;

function corpus() {
  const seen = new Set(), out = [];
  for (const track of ['opening', 'middlegame', 'endgame']) {
    const f = path.join(PUZZLES, `${track}.json`);
    if (!fs.existsSync(f)) continue;
    for (const p of JSON.parse(fs.readFileSync(f, 'utf8'))) {
      for (const [fen, kind] of [[p.fen, 'puzzle'], [p.prev && p.prev.fen, 'prev']]) {
        if (!fen || seen.has(fen)) continue;
        seen.add(fen);
        out.push({ fen, track, kind, id: p.id });
      }
    }
  }
  return out;
}

/* A finder returns null, or {side, why, quality} where higher quality is a
 * cleaner instance. Quality exists so the mined example is a good teaching
 * position rather than merely the first hit. */
const FIND = {
  outpost: {
    positive(f) {
      for (const c of ['w', 'b']) {
        const o = (f.outposts[c] || []).filter(x => x.piece === 'N');
        if (!o.length) continue;
        const sq = o[0].square, rank = Number(sq[1]);
        const advanced = c === 'w' ? rank >= 5 : rank <= 4;
        if (!advanced) continue;
        return { side: c, why: `${c === 'w' ? 'White' : 'Black'} knight on ${sq}, on a hole and pawn-defended`,
                 quality: (f.material.counts ? 0 : 0) + rank, detail: { square: sq } };
      }
      return null;
    },
    // the near-miss: a knight on a central advanced square that is NOT a hole
    nearMiss(f, st) {
      for (const c of ['w', 'b']) {
        const holes = new Set(f.holes[c] || []);
        for (const n of knightsOf(st, c)) {
          const rank = Number(n[1]), file = n[0];
          const advanced = c === 'w' ? rank >= 5 : rank <= 4;
          const central = 'cdef'.includes(file);
          if (advanced && central && !holes.has(n)) {
            return { side: c, why: `${c === 'w' ? 'White' : 'Black'} knight on ${n} looks like an outpost and is not one — an enemy pawn can still challenge the square`,
                     quality: 5, detail: { square: n } };
          }
        }
      }
      return null;
    },
  },
  'doubled-pawns': {
    positive(f) {
      for (const c of ['w', 'b'])
        if (f.pawns[c].doubled.length && f.pawns[c].islands >= 3)
          return { side: c, why: `${c === 'w' ? 'White' : 'Black'} has doubled pawns and ${f.pawns[c].islands} pawn islands`, quality: f.pawns[c].islands };
      return null;
    },
    nearMiss(f) {
      // doubled pawns held by the side that ALSO has the bishop pair: the
      // compensation the concept's record names
      for (const c of ['w', 'b'])
        if (f.pawns[c].doubled.length && f.pieces[c].bishopPair && !f.pieces[other(c)].bishopPair)
          return { side: c, why: `${c === 'w' ? 'White' : 'Black'} has doubled pawns AND the bishop pair — the compensation the concept names`, quality: 6 };
      return null;
    },
  },
  'isolated-queen-pawn': {
    positive(f) {
      for (const c of ['w', 'b']) {
        const d = f.pawns[c].isolated.filter(s => s[0] === 'd');
        if (d.length && f.phase !== 'endgame')
          return { side: c, why: `${c === 'w' ? 'White' : 'Black'} holds an isolated d-pawn in a middlegame`, quality: 5 };
      }
      return null;
    },
    nearMiss(f) {
      for (const c of ['w', 'b']) {
        const d = f.pawns[c].isolated.filter(s => s[0] === 'd');
        if (d.length && f.phase === 'endgame')
          return { side: c, why: `an isolated d-pawn in an ENDGAME, where the dynamic compensation the concept relies on has gone`, quality: 6 };
      }
      return null;
    },
  },
  'passed-pawn': {
    positive(f) {
      for (const c of ['w', 'b']) {
        const adv = f.pawns[c].passed.filter(s => {
          const r = Number(s[1]); return c === 'w' ? r >= 5 : r <= 4;
        });
        if (adv.length) return { side: c, why: `${c === 'w' ? 'White' : 'Black'} has an advanced passed pawn on ${adv.join(', ')}`, quality: adv.length + 3 };
      }
      return null;
    },
    nearMiss(f) {
      // a passed rook pawn with an opposite-coloured bishop, or a passer in a
      // position the other side is winning anyway
      for (const c of ['w', 'b'])
        if (f.pawns[c].passed.some(s => s[0] === 'a' || s[0] === 'h') && f.pieces.oppositeColouredBishops)
          return { side: c, why: `a passed rook pawn with opposite-coloured bishops — the classic case where a passer wins nothing`, quality: 8 };
      return null;
    },
  },
  'bishop-pair': {
    positive(f) {
      for (const c of ['w', 'b'])
        if (f.pieces[c].bishopPair && !f.pieces[other(c)].bishopPair && f.files.open.length >= 1)
          return { side: c, why: `${c === 'w' ? 'White' : 'Black'} has the bishop pair with at least one open file`, quality: 4 + f.files.open.length };
      return null;
    },
    nearMiss(f) {
      for (const c of ['w', 'b'])
        if (f.pieces[c].bishopPair && !f.pieces[other(c)].bishopPair &&
            !f.files.open.length && f.pawns.w.count + f.pawns.b.count >= 12)
          return { side: c, why: `the bishop pair in a closed position with no open file and pawns still on — where the pair is worth least`, quality: 7 };
      return null;
    },
  },
  'opposite-coloured-bishops': {
    positive(f) {
      if (f.pieces.oppositeColouredBishops && f.phase === 'endgame')
        return { side: 'w', why: 'opposite-coloured bishops in an endgame, the drawish case', quality: 6 };
      return null;
    },
    nearMiss(f) {
      if (f.pieces.oppositeColouredBishops && f.phase !== 'endgame' &&
          (f.material.counts || true) && (f.material.w.counts.Q || f.material.b.counts.Q))
        return { side: 'w', why: 'opposite-coloured bishops WITH queens on — the attacking case, not the drawish one', quality: 8 };
      return null;
    },
  },
  'rook-on-the-seventh': {
    positive(f) {
      for (const c of ['w', 'b']) {
        const r = f.pieces[c].rooksOnSeventh;
        if (!r.length) continue;
        const targets = f.pawns[other(c)].files.length;
        const seventhRank = c === 'w' ? '7' : '2';
        const pawnsThere = (f.pawns[other(c)].doubled.concat([])).length;
        if (r.length >= 2) return { side: c, why: `${c === 'w' ? 'White' : 'Black'} has doubled rooks on the seventh`, quality: 9 };
        if (targets >= 4) return { side: c, why: `${c === 'w' ? 'White' : 'Black'} has a rook on the seventh with ${targets} enemy pawn files to work on`, quality: 4 + targets };
      }
      return null;
    },
    nearMiss(f) {
      for (const c of ['w', 'b']) {
        const r = f.pieces[c].rooksOnSeventh;
        if (r.length && f.king[other(c)] && f.king[other(c)].luft && f.phase === 'endgame')
          return { side: c, why: `a rook on the seventh where the enemy king already has luft and the ending is simplified`, quality: 6 };
      }
      return null;
    },
  },
  'backward-pawn': {
    positive(f) {
      for (const c of ['w', 'b']) {
        const b = f.pawns[c].backward;
        if (!b.length) continue;
        const semi = f.files.semiOpenFor[other(c)] || [];
        const onSemi = b.filter(s => semi.includes(s[0]));
        if (onSemi.length)
          return { side: c, why: `${c === 'w' ? 'White' : 'Black'} has a backward pawn on ${onSemi.join(', ')}, on a file the opponent's rooks can use`, quality: 8 };
      }
      return null;
    },
    nearMiss(f) {
      for (const c of ['w', 'b']) {
        const b = f.pawns[c].backward;
        const semi = f.files.semiOpenFor[other(c)] || [];
        if (b.length && !b.some(s => semi.includes(s[0])))
          return { side: c, why: `a backward pawn on a CLOSED file, where it cannot be attacked by rooks`, quality: 6 };
      }
      return null;
    },
  },
  luft: {
    positive(f) {
      for (const c of ['w', 'b'])
        if (f.king[c] && f.king[c].backRankExposure && f.material[other(c)].counts.R >= 1)
          return { side: c, why: `${c === 'w' ? 'White' : 'Black'} king has no escape square with enemy rooks on`, quality: 5 };
      return null;
    },
    nearMiss(f) {
      for (const c of ['w', 'b'])
        if (f.king[c] && f.king[c].onHomeRank && !f.king[c].luft &&
            f.material[other(c)].counts.R === 0 && f.material[other(c)].counts.Q === 0)
          return { side: c, why: `no escape square and nothing that could exploit it — the pattern without the danger`, quality: 7 };
      return null;
    },
  },
  space: {
    positive(f) {
      const d = f.activity.pawnSpace.w - f.activity.pawnSpace.b;
      if (Math.abs(d) >= 4)
        return { side: d > 0 ? 'w' : 'b', why: `a clear space advantage (${f.activity.pawnSpace.w} against ${f.activity.pawnSpace.b} squares)`, quality: Math.abs(d) };
      return null;
    },
    nearMiss(f) {
      const d = f.activity.pawnSpace.w - f.activity.pawnSpace.b;
      const c = d > 0 ? 'w' : 'b';
      if (Math.abs(d) >= 3 && f.activity.mobility[c] != null && f.activity.mobility[other(c)] != null &&
          f.activity.mobility[c] < f.activity.mobility[other(c)])
        return { side: c, why: `more space but FEWER available moves — space that is not translating into activity`, quality: 8 };
      return null;
    },
  },
  'king-activation': {
    positive(f) {
      if (f.phase !== 'endgame') return null;
      for (const c of ['w', 'b']) {
        const k = f.king[c];
        if (!k) continue;
        const r = Number(k.square[1]);
        const central = 'cdef'.includes(k.square[0]) && r >= 3 && r <= 6;
        if (central) return { side: c, why: `${c === 'w' ? 'White' : 'Black'} king centralised on ${k.square} in an endgame`, quality: 6 };
      }
      return null;
    },
    nearMiss(f) {
      // an endgame with queens still on, where centralising is dangerous
      if (f.phase === 'endgame' && (f.material.w.counts.Q || f.material.b.counts.Q))
        for (const c of ['w', 'b']) {
          const k = f.king[c];
          if (k && !k.onHomeRank && f.material[other(c)].counts.Q)
            return { side: c, why: `a king off its back rank while the opponent still has a queen — where centralisation is a liability`, quality: 9 };
        }
      return null;
    },
  },
};

function other(c) { return c === 'w' ? 'b' : 'w'; }
function knightsOf(st, colour) {
  const out = [];
  for (let i = 0; i < 64; i++) {
    const p = st.b[i];
    if (p && p.c === colour && p.t === 'N') out.push(F.nameOf(i));
  }
  return out;
}

const positions = corpus();
const results = {};
const targets = only ? [only] : Object.keys(FIND);
for (const t of targets) results[t] = { positive: [], nearMiss: [] };

let scanned = 0, failed = 0;
for (const p of positions) {
  let f, st;
  try { f = F.features(p.fen); st = F.page.stateFromFEN(p.fen); } catch (e) { failed++; continue; }
  scanned++;
  for (const t of targets) {
    const finder = FIND[t];
    if (!finder) continue;
    for (const kind of ['positive', 'nearMiss']) {
      if (!finder[kind]) continue;
      let hit = null;
      try { hit = finder[kind](f, st); } catch (e) { hit = null; }
      if (hit) results[t][kind].push({ ...p, ...hit });
    }
  }
}

for (const t of targets) {
  for (const kind of ['positive', 'nearMiss']) {
    results[t][kind].sort((a, b) => (b.quality || 0) - (a.quality || 0));
    results[t][kind] = results[t][kind].slice(0, perConcept);
  }
}

console.log(`\nscanned ${scanned} real positions (${failed} unparsable)\n`);
for (const t of targets) {
  const r = results[t];
  console.log(`${t}`);
  for (const kind of ['positive', 'nearMiss']) {
    if (!r[kind].length) { console.log(`   ${kind.padEnd(9)} — none found`); continue; }
    for (const h of r[kind]) {
      console.log(`   ${kind.padEnd(9)} ${h.fen}`);
      console.log(`             ${h.why}  [${h.track}/${h.kind} ${h.id}]`);
    }
  }
  console.log();
}
if (jsonOut) { fs.writeFileSync(jsonOut, JSON.stringify(results, null, 2)); console.log(`wrote ${jsonOut}`); }
