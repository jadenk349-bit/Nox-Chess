'use strict';
/* Concept prospector: find candidate example positions for MANY concepts at once.
 *
 * tools/mine_positions.js proved the approach on a dozen concepts. This widens
 * it, and adds the thing that was missing: a QUIETNESS preference. The corpus is
 * 788 tactical puzzles plus their preceding positions, and a positional concept
 * cannot be isolated in a position a tactic decides — so for positional concepts
 * this prefers the 22% of positions where the side to move has no check and no
 * winning capture available.
 *
 * Three kinds of candidate are sought, and the last two are the valuable ones:
 *   POSITIVE   the feature present, cleanly, ideally in a quiet position
 *   NEAR-MISS  the surface pattern present and the concept's CONDITION absent
 *   AMBIGUOUS  the feature present in a position where something else decides
 *
 *     node tools/prospect.js [--concept X] [--limit N] [--json out] [--summary]
 */
const fs = require('fs');
const path = require('path');
const F = require('../lib/features.js');
const P = F.page;

const ROOT = path.join(__dirname, '..');
const PUZZLES = path.join(ROOT, '..', 'puzzles');
const argv = process.argv.slice(2);
const only = argv.includes('--concept') ? argv[argv.indexOf('--concept') + 1] : null;
const LIMIT = argv.includes('--limit') ? Number(argv[argv.indexOf('--limit') + 1]) : 2;
const jsonOut = argv.includes('--json') ? argv[argv.indexOf('--json') + 1] : null;
const summary = argv.includes('--summary');

const other = c => (c === 'w' ? 'b' : 'w');
const S = (c) => (c === 'w' ? 'White' : 'Black');
const pawns = (f, c) => f.material[c].counts.P;
const heavy = f => ['w', 'b'].reduce((n, c) => n + f.material[c].counts.R + f.material[c].counts.Q, 0);

/* Each rule: quiet=true means a quiet position is strongly preferred. */
const RULES = {
  /* ---- structural, quiet strongly preferred ---- */
  'open-file': { quiet: true,
    positive: f => { const occ = ['w','b'].flatMap(c => f.pieces[c].rooksOnOpenFiles.map(r => ({c,r})));
      if (!f.files.open.length || !occ.length) return null;
      return { why: `the ${f.files.open.join(' and ')}-file is open with ${S(occ[0].c)}'s rook on ${occ[0].r}`, q: 4 + occ.length }; },
    nearMiss: f => { if (!f.files.open.length || heavy(f) === 0) return null;
      const anyOn = ['w','b'].some(c => f.pieces[c].rooksOnOpenFiles.length);
      if (anyOn) return null;
      return { why: `an open ${f.files.open[0]}-file that neither side has occupied — the file exists and nobody is using it`, q: 5 }; } },

  'semi-open-file': { quiet: true,
    positive: f => { for (const c of ['w','b']) { const r = f.pieces[c].rooksOnSemiOpenFiles;
        if (r.length >= 2) return { why: `${S(c)} has doubled rooks on a semi-open file (${r.join(', ')})`, q: 9 };
        if (r.length) return { why: `${S(c)}'s rook on ${r[0]} stands on a semi-open file`, q: 5 }; } return null; },
    nearMiss: f => { for (const c of ['w','b'])
        if (f.files.semiOpenFor[c].length >= 2 && !f.pieces[c].rooksOnSemiOpenFiles.length)
          return { why: `${S(c)} has ${f.files.semiOpenFor[c].length} semi-open files and no rook on any of them`, q: 6 }; return null; } },

  outpost: { quiet: true,
    positive: (f) => { for (const c of ['w','b']) {
        const o = f.outposts[c].filter(x => x.piece === 'N' && x.square[0] !== 'a' && x.square[0] !== 'h');
        if (o.length) { const r = Number(o[0].square[1]);
          const adv = c === 'w' ? r >= 5 : r <= 4;
          if (adv) return { why: `${S(c)}'s knight on ${o[0].square} sits on a hole, defended by a pawn`, q: 6 + r }; } }
      return null; },
    nearMiss: (f, st) => { for (const c of ['w','b']) { const holes = new Set(f.holes[c]);
        for (let i = 0; i < 64; i++) { const p = st.b[i];
          if (!p || p.c !== c || p.t !== 'N') continue;
          const sq = F.nameOf(i), r = Number(sq[1]);
          const adv = c === 'w' ? r >= 5 : r <= 4;
          if (adv && 'cdef'.includes(sq[0]) && !holes.has(sq))
            return { why: `${S(c)}'s knight on ${sq} is advanced and central and is NOT on a hole — a pawn can still challenge it`, q: 7 }; } }
      return null; } },

  'weak-square': { quiet: true,
    positive: f => { for (const c of ['w','b']) { if (pawns(f, other(c)) < 4) continue;
        const usable = (f.reachableHoles[c] || []).filter(sq => 'cdef'.includes(sq[0]));
        if (usable.length) return { why: `${S(c)} can place a minor piece on ${usable.slice(0,3).join(', ')}, where no enemy pawn can attack it`, q: 4 + usable.length }; } return null; },
    nearMiss: f => { for (const c of ['w','b'])
        if (pawns(f, other(c)) >= 5 && f.holes[c].length === 0)
          return { why: `an intact enemy pawn structure with no holes at all — the feature is genuinely absent`, q: 5 }; return null; } },

  'bad-bishop': { quiet: true,
    positive: f => { for (const c of ['w','b']) for (const b of (f.pieces[c].bishops || []))
        if (b.ownPawnsOnItsColour >= 4 && b.share >= 0.6 && b.scope <= 3)
          return { why: `${S(c)}'s bishop on ${b.square} has ${b.ownPawnsOnItsColour} of its own ${b.ownPawnsTotal} pawns on its colour and sees ${b.scope} squares`, q: 8 }; return null; },
    nearMiss: f => { for (const c of ['w','b']) for (const b of (f.pieces[c].bishops || []))
        if (b.ownPawnsOnItsColour >= 4 && b.share >= 0.6 && b.scope >= 9)
          return { why: `${S(c)}'s bishop on ${b.square} is structurally bad (${b.ownPawnsOnItsColour}/${b.ownPawnsTotal} pawns on its colour) and sees ${b.scope} squares — Suba's active bad bishop`, q: 9 }; return null; } },

  'bishop-pair': { quiet: true,
    positive: f => { for (const c of ['w','b'])
        if (f.pieces[c].bishopPair && !f.pieces[other(c)].bishopPair && f.files.open.length >= 1)
          return { why: `${S(c)} holds the bishop pair in a position with an open file`, q: 4 + f.files.open.length }; return null; },
    nearMiss: f => { for (const c of ['w','b'])
        if (f.pieces[c].bishopPair && !f.pieces[other(c)].bishopPair &&
            !f.files.open.length && pawns(f,'w') + pawns(f,'b') >= 12)
          return { why: `the bishop pair in a closed position with no open file — where it is worth least`, q: 8 }; return null; } },

  'doubled-pawns': { quiet: true,
    positive: f => { for (const c of ['w','b'])
        if (f.pawns[c].doubled.length && f.pawns[c].islands >= 3 && !f.pieces[c].bishopPair)
          return { why: `${S(c)} has doubled pawns on ${f.pawns[c].doubled.join(', ')} and ${f.pawns[c].islands} islands, without the bishop pair as compensation`, q: 4 + f.pawns[c].islands }; return null; },
    nearMiss: f => { for (const c of ['w','b'])
        if (f.pawns[c].doubled.length && f.pieces[c].bishopPair && !f.pieces[other(c)].bishopPair)
          return { why: `${S(c)} has doubled pawns AND the bishop pair — the compensation the concept names`, q: 8 }; return null; } },

  'isolated-queen-pawn': { quiet: true,
    positive: f => { const minors = ['w','b'].reduce((n,c)=>n+f.material[c].counts.N+f.material[c].counts.B+f.material[c].counts.Q,0);
      if (!minors) return null;
      for (const c of ['w','b']) { const d = f.pawns[c].isolated.filter(s => s[0] === 'd');
        if (d.length && f.phase === 'middlegame') return { why: `${S(c)} holds an isolated d-pawn in a middlegame with pieces on`, q: 7 }; } return null; },
    nearMiss: f => { for (const c of ['w','b']) { const d = f.pawns[c].isolated.filter(s => s[0] === 'd');
        if (d.length && f.phase === 'endgame') return { why: `an isolated d-pawn in an ENDGAME — the dynamic compensation is gone and only the weakness is left`, q: 7 }; } return null; } },

  'backward-pawn': { quiet: true,
    positive: f => { for (const c of ['w','b']) { const b = f.pawns[c].backward;
        const semi = f.files.semiOpenFor[other(c)] || [];
        const on = b.filter(s => semi.includes(s[0]));
        if (on.length) return { why: `${S(c)}'s backward pawn on ${on.join(', ')} stands on a file the opponent's rooks can use`, q: 8 }; } return null; },
    nearMiss: f => { for (const c of ['w','b']) { const b = f.pawns[c].backward;
        const semi = f.files.semiOpenFor[other(c)] || [];
        if (b.length && !b.some(s => semi.includes(s[0]))) return { why: `a backward pawn on a CLOSED file, where no rook can attack it`, q: 7 }; } return null; } },

  'passed-pawn': { quiet: true,
    positive: f => { for (const c of ['w','b']) { const adv = f.pawns[c].passed.filter(s => { const r = Number(s[1]); return c === 'w' ? r >= 5 : r <= 4; });
        if (adv.length) return { why: `${S(c)} has an advanced passed pawn on ${adv.join(', ')}`, q: 4 + adv.length }; } return null; },
    nearMiss: f => { for (const c of ['w','b'])
        if (f.pawns[c].passed.some(s => s[0] === 'a' || s[0] === 'h') && f.pieces.oppositeColouredBishops)
          return { why: `a passed rook pawn with opposite-coloured bishops — a passer that wins nothing`, q: 9 }; return null; } },

  'opposite-coloured-bishops': { quiet: true,
    positive: f => f.pieces.oppositeColouredBishops && f.phase === 'endgame' && heavy(f) === 0
      ? { why: 'opposite-coloured bishops in a simplified endgame — the drawish case', q: 8 } : null,
    nearMiss: f => f.pieces.oppositeColouredBishops && heavy(f) >= 2
      ? { why: 'opposite-coloured bishops with heavy pieces still on — the ATTACKING case, not the drawish one', q: 9 } : null },

  'rook-on-the-seventh': { quiet: true,
    positive: f => { for (const c of ['w','b']) { const r = f.pieces[c].rooksOnSeventh;
        if (r.length >= 2) return { why: `${S(c)} has doubled rooks on the seventh (${r.join(', ')})`, q: 10 };
        if (r.length && pawns(f, other(c)) >= 4) return { why: `${S(c)}'s rook on ${r[0]} with ${pawns(f, other(c))} enemy pawns still on their starting rank area`, q: 6 }; } return null; },
    nearMiss: f => { for (const c of ['w','b']) { const r = f.pieces[c].rooksOnSeventh;
        if (r.length && pawns(f, other(c)) <= 2 && f.king[other(c)] && f.king[other(c)].luft)
          return { why: `a rook on the seventh with almost nothing on it and an enemy king that already has luft`, q: 8 }; } return null; } },

  luft: { quiet: true,
    positive: f => { for (const c of ['w','b'])
        if (f.king[c] && f.king[c].backRankExposure && f.material[other(c)].counts.R + f.material[other(c)].counts.Q >= 2)
          return { why: `${S(c)}'s king has no escape square and the opponent has two or more heavy pieces`, q: 7 }; return null; },
    nearMiss: f => { for (const c of ['w','b'])
        if (f.king[c] && f.king[c].onHomeRank && !f.king[c].luft &&
            f.material[other(c)].counts.R === 0 && f.material[other(c)].counts.Q === 0)
          return { why: `no escape square and no heavy piece left to exploit it — the pattern without the danger`, q: 8 }; return null; } },

  space: { quiet: true,
    positive: f => { const d = f.activity.pawnSpace.w - f.activity.pawnSpace.b;
      if (Math.abs(d) >= 5 && pawns(f,'w') + pawns(f,'b') >= 10)
        return { why: `a clear space advantage (${f.activity.pawnSpace.w} squares against ${f.activity.pawnSpace.b})`, q: Math.abs(d) }; return null; },
    nearMiss: f => { const d = f.activity.pawnSpace.w - f.activity.pawnSpace.b; const c = d > 0 ? 'w' : 'b';
      if (Math.abs(d) >= 3 && f.activity.mobility[c] != null && f.activity.mobility[other(c)] != null
          && f.activity.mobility[c] < f.activity.mobility[other(c)] - 4)
        return { why: `more space and FEWER available moves — space that has become a cramp`, q: 9 }; return null; } },

  'king-activation': { quiet: true,
    positive: f => { if (f.phase !== 'endgame' || heavy(f) > 2) return null;
      for (const c of ['w','b']) { const k = f.king[c]; if (!k) continue;
        const r = Number(k.square[1]);
        if ('cdef'.includes(k.square[0]) && r >= 3 && r <= 6)
          return { why: `${S(c)}'s king stands centralised on ${k.square} in a simplified ending`, q: 7 }; } return null; },
    nearMiss: f => { if (f.phase !== 'endgame') return null;
      for (const c of ['w','b']) { const k = f.king[c];
        if (k && !k.onHomeRank && f.material[other(c)].counts.Q >= 1)
          return { why: `a king off its back rank while the opponent still has a QUEEN — where centralisation is a liability`, q: 10 }; } return null; } },

  'material-imbalance': { quiet: true,
    positive: f => { const w = f.material.w.counts, b = f.material.b.counts;
      if ((w.R !== b.R) && (w.N + w.B !== b.N + b.B))
        return { why: `unbalanced material — ${w.R}R ${w.B}B ${w.N}N against ${b.R}R ${b.B}B ${b.N}N`, q: 7 }; return null; },
    nearMiss: null },

  'piece-activity': { quiet: true,
    positive: f => { const w = f.activity.mobility.w, b = f.activity.mobility.b;
      if (w == null || b == null) return null;
      if (Math.abs(w - b) >= 14) return { why: `a large mobility gap — ${Math.max(w,b)} legal moves against ${Math.min(w,b)}`, q: Math.abs(w - b) / 2 }; return null; },
    nearMiss: null },
};

/* ---- corpus ---- */
function corpus() {
  const seen = new Set(), out = [];
  for (const track of ['opening', 'middlegame', 'endgame']) {
    const f = path.join(PUZZLES, `${track}.json`);
    if (!fs.existsSync(f)) continue;
    for (const p of JSON.parse(fs.readFileSync(f, 'utf8'))) {
      for (const [fen, kind] of [[p.fen, 'puzzle'], [p.prev && p.prev.fen, 'prev']]) {
        if (!fen || seen.has(fen)) continue;
        seen.add(fen);
        out.push({ fen, track, kind, id: p.id, solution: (p.moves || [])[0] || null });
      }
    }
  }
  return out;
}

const positions = corpus();
const targets = only ? [only] : Object.keys(RULES);
const found = {};
for (const t of targets) found[t] = { positive: [], nearMiss: [] };

let scanned = 0, quiet = 0;
for (const pos of positions) {
  let f, st;
  try { f = F.features(pos.fen); st = P.stateFromFEN(pos.fen); } catch (e) { continue; }
  scanned++;
  const isQuiet = f.quietness.quiet;
  if (isQuiet) quiet++;
  for (const t of targets) {
    const rule = RULES[t];
    if (!rule) continue;
    for (const kind of ['positive', 'nearMiss']) {
      if (!rule[kind]) continue;
      let hit = null;
      try { hit = rule[kind](f, st); } catch (e) { hit = null; }
      if (!hit) continue;
      // Quiet positions score far higher for concepts that want them, so the
      // best candidate is a quiet one whenever any quiet one exists.
      const q = (hit.q || 1) + (rule.quiet && isQuiet ? 100 : 0);
      found[t][kind].push({ ...pos, why: hit.why, quality: q, quiet: isQuiet });
    }
  }
}

for (const t of targets)
  for (const kind of ['positive', 'nearMiss']) {
    found[t][kind].sort((a, b) => b.quality - a.quality);
    found[t][kind] = found[t][kind].slice(0, LIMIT);
  }

console.log(`\nscanned ${scanned} positions, ${quiet} of them quiet (${(100*quiet/scanned).toFixed(1)}%)\n`);
let totQ = 0, tot = 0;
for (const t of targets) {
  const r = found[t];
  const bits = [];
  for (const kind of ['positive', 'nearMiss']) {
    for (const h of r[kind]) { tot++; if (h.quiet) totQ++; }
    bits.push(`${kind} ${r[kind].length}${r[kind].some(h=>h.quiet)?' (quiet)':''}`);
  }
  console.log(`  ${t.padEnd(28)} ${bits.join('  ')}`);
  if (!summary) for (const kind of ['positive', 'nearMiss'])
    for (const h of r[kind])
      console.log(`      ${kind.padEnd(9)} ${h.quiet ? 'QUIET ' : '      '}${h.fen}\n                  ${h.why}`);
}
console.log(`\ncandidates ${tot}, of which quiet ${totQ}`);
if (jsonOut) { fs.writeFileSync(jsonOut, JSON.stringify(found, null, 2)); console.log(`wrote ${jsonOut}`); }
