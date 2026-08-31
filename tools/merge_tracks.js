#!/usr/bin/env node
/* Folding newly verified puzzles into the set that already shipped.
 *
 * Both sides have been through the same depth-24 verification, so neither is
 * provisional and neither takes precedence — this is a union, not an update.
 * What it has to get right is three things:
 *
 *   duplicates   by id *and* by position. The id is a hash of the fen and the
 *                line, so two runs that found the same position and extended
 *                it differently produce two ids and one puzzle; dropping only
 *                on id would offer the player the same position twice.
 *   order        a ladder promises puzzle 1 is easier than puzzle n, and a
 *                merged file is in no order at all until it is re-ranked by
 *                the generator's own difficulty key.
 *   numbering    contiguous from 1, because the page walks the list by index
 *                and unlocks each rung with the one before it.
 *
 * Ids are never rewritten, so nobody loses a solve; only rungs move, exactly
 * as after a regeneration. Pure — no engine, no searching.
 *
 *   node tools/merge_tracks.js <incoming-dir> [--write]
 */

'use strict';

const fs = require('fs');
const path = require('path');
const G = require('./generate_puzzles.js');

const SHIPPED = path.join(__dirname, '..', 'puzzles');
const incoming = process.argv[2];
const write = process.argv.includes('--write');
if (!incoming){ console.error('usage: merge_tracks.js <incoming-dir> [--write]'); process.exit(2); }

const read = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e){ return []; } };

for (const track of ['opening', 'middlegame', 'endgame']){
  const kept = read(path.join(SHIPPED, track + '.json'));
  const fresh = read(path.join(incoming, track + '.json'));
  const byId = new Set(kept.map(p => p.id));
  const byFen = new Set(kept.map(p => p.fen));
  const added = [];
  let dupId = 0, dupFen = 0;
  for (const p of fresh){
    if (byId.has(p.id)){ dupId++; continue; }
    if (byFen.has(p.fen)){ dupFen++; continue; }
    byId.add(p.id); byFen.add(p.fen);
    added.push(p);
  }
  const all = kept.concat(added);
  // the generator's own key, so a merged ladder is ordered the way it was built
  const rank = new Map(all.map(p => [p, G.difficulty(p)]));
  all.sort((a, b) => rank.get(a) - rank.get(b) || String(a.id).localeCompare(String(b.id)));
  all.forEach((p, i) => { p.n = i + 1; });

  console.log('  ' + track.padEnd(12) + String(kept.length).padStart(4) + ' kept + ' +
              String(added.length).padStart(4) + ' new = ' + String(all.length).padStart(4) +
              (dupId + dupFen ? '   (' + dupId + ' repeat ids, ' + dupFen + ' repeat positions dropped)' : ''));
  if (write) fs.writeFileSync(path.join(SHIPPED, track + '.json'), JSON.stringify(all, null, 1) + '\n');
}
if (!write) console.log('\n  (report only; --write to act on it)');
