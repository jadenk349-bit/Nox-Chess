'use strict';
/* Turn verified master games into concept examples.
 *
 * A replayed game is not one position, it is a hundred. This walks every
 * position in a game, keeps the QUIET ones — where the side to move has no check
 * and no winning capture, so the next move must be chosen on positional grounds
 * — and reports which concepts Layer 4 licenses there.
 *
 * It prioritises concepts that currently have NO example, because that is the
 * gap the depth audit says dominates everything else.
 *
 * Every game must replay legally through the page's own move generator or it is
 * not used. That check has already rejected one score from a reputable source.
 *
 *     node tools/harvest_games.js --games <file> [--need-only] [--json out]
 */
const fs = require('fs');
const path = require('path');
const { replay } = require('./replay_game.js');
const F = require('../lib/features.js');
const API = require('../lib/analyze.js');

const argv = process.argv.slice(2);
const gamesFile = argv.includes('--games') ? argv[argv.indexOf('--games') + 1] : null;
const needOnly = argv.includes('--need-only');
const jsonOut = argv.includes('--json') ? argv[argv.indexOf('--json') + 1] : null;
if (!gamesFile) { console.error('usage: --games <module exporting an array>'); process.exit(2); }

const games = require(path.resolve(gamesFile));
const { concepts: KB } = API.knowledge();

/* Which concepts have no example position at all? */
const lacking = new Set();
for (const [id, c] of Object.entries(KB)) {
  const pos = (c.examples || []).concat(c.counterexamples || [], c.ambiguous_examples || []);
  if (!pos.length) lacking.add(id);
}
console.log(`${lacking.size} of ${Object.keys(KB).length} concepts currently have NO example position.\n`);

const out = {};
let totalPositions = 0, quietPositions = 0, badGames = 0;

for (const g of games) {
  let marks;
  try {
    // Ask for every move number so replay hands back the whole game.
    const at = Array.from({ length: 140 }, (_, i) => `${i + 1}`).join(',');
    marks = replay(g.pgn, at).marks;
  } catch (e) {
    console.log(`SKIPPED ${g.id}: ${e.message.slice(0, 90)}`);
    badGames++; continue;
  }
  let kept = 0;
  for (const m of marks) {
    totalPositions++;
    let f;
    try { f = F.features(m.fen); } catch (e) { continue; }
    if (!f.quietness.quiet) continue;
    quietPositions++;
    let r;
    try { r = API.analyzeWithEducation({ fen: m.fen }); } catch (e) { continue; }
    for (const c of r.concepts) {
      if (needOnly && !lacking.has(c.id)) continue;
      // Prefer a confident match in a quiet position, later in the game where
      // the structure has actually been decided by play rather than by theory.
      const score = (c.confidence === 'high' ? 3 : c.confidence === 'medium' ? 2 : 1)
                    + Math.min(m.ply / 20, 3);
      (out[c.id] = out[c.id] || []).push({
        game: `${g.white}-${g.black}, ${g.event}`, gameId: g.id,
        ply: m.ply, after: m.after, fen: m.fen,
        because: c.because[0], confidence: c.confidence, score,
        // Which side the feature belongs to. If the engine then says that side
        // is WORSE, the position is a negative example: the feature is present
        // and is not helping, which is the hardest kind of evidence to find and
        // the kind this base has least of.
        subjects: c.subjects || [],
        sideToMove: f.sideToMove,
        alsoHere: r.concepts.filter(x => x.id !== c.id).map(x => x.id),
      });
      kept++;
    }
  }
  console.log(`${g.id.padEnd(30)} ${marks.length} positions, ${kept} concept hits`);
}

for (const k of Object.keys(out)) {
  out[k].sort((a, b) => b.score - a.score);
  out[k] = out[k].slice(0, 3);
}

console.log(`\n${totalPositions} positions walked, ${quietPositions} quiet, ${badGames} games rejected\n`);
const rows = Object.entries(out).sort((a, b) => b[1].length - a[1].length);
for (const [cid, hits] of rows) {
  console.log(`${cid}${lacking.has(cid) ? '  << had no example' : ''}`);
  for (const h of hits.slice(0, 2)) {
    console.log(`   ply ${String(h.ply).padStart(3)} after ${h.after.padEnd(7)} [${h.confidence}] ${h.game}`);
    console.log(`       ${h.fen}`);
    console.log(`       ${h.because}`);
  }
}
if (jsonOut) { fs.writeFileSync(jsonOut, JSON.stringify(out, null, 2)); console.log(`\nwrote ${jsonOut}`); }
