/* Cutting one verified corpus into five non-overlapping mode pools.
 *
 * The Puzzle page is now five doors — Sighted, Only Board, Blindfold, Fog of
 * War, Puzzle Rush — and a position belongs to exactly one of them. That is a
 * stronger requirement than it looks, and the obvious implementations all get
 * it wrong in the same way, so the reasoning is here rather than inline.
 *
 * **Why not filter by phase.** The old page had three doors and they *were*
 * the phases: opening, middlegame, endgame. The five new doors are vision
 * modes, and a vision mode says nothing about the chess — the instruction is
 * explicit that a puzzle's phase must not decide which mode it lands in. So
 * every pool has to be a mixed sample of the whole corpus.
 *
 * **Why not a hash of the id.** Stable, non-overlapping, one line — and it
 * distributes difficulty randomly, so one pool gets the three hardest puzzles
 * in the set and another gets none of them. Each pool is walked in order as
 * its own ladder, rung unlocking rung, so a pool that is randomly hard is a
 * door that is randomly shut.
 *
 * **Round-robin over the difficulty ranking** is what this does instead. Sort
 * the whole corpus by the generator's own difficulty() key, then deal the
 * sorted list out like cards: 1st to Sighted, 2nd to Only Board, 3rd to
 * Blindfold, 4th to Fog, 5th to Rush, 6th to Sighted again. Every pool then
 * gets an even spread from easiest to hardest, the pools differ in size by at
 * most one, and each is a genuine ladder in its own right after renumbering.
 * It is also completely deterministic, which matters when the corpus is
 * regenerated: the same input gives the same five pools.
 *
 * **Duplicate positions, not just duplicate ids.** An id is a hash of the fen
 * *and the line*, so two runs that found the same position and extended it
 * differently produce two ids and one position. Dealing those into two
 * different pools would offer the same position twice under two doors, which
 * is the exact thing "non-overlapping" is meant to prevent. So dedup happens
 * before the deal, on the fen, and the survivor is the one the difficulty key
 * ranks first — an arbitrary but stable choice.
 */

'use strict';

const G = require('./generate_puzzles.js');

/* The five doors. `vision` is the page's own G.mode value, so this table is
   the only place the two vocabularies meet — the modes are named for players
   ("Blindfold") and the page's vision modes are named for what they hide
   ("total"). `rush` has no vision of its own: Puzzle Rush keeps whatever
   presentation it already had, and only its source pool changes. */
const MODES = [
  { key: 'sighted',   name: 'Sighted Puzzle',     vision: 'sighted' },
  { key: 'board',     name: 'Only Board Puzzle',  vision: 'blind' },
  { key: 'blindfold', name: 'Blindfold Puzzle',   vision: 'total' },
  { key: 'fog',       name: 'Fog of War Puzzle',  vision: 'fog' },
  { key: 'rush',      name: 'Puzzle Rush',        vision: null }
];

const KEYS = MODES.map(m => m.key);

/**
 * assign(puzzles) -> { pools: {key: [puzzle]}, dropped: [{id, why}], order }
 *
 * Pure. No engine, no files. Every returned puzzle carries `mode` and a fresh
 * contiguous `n` within its pool, and ids are never rewritten — so a player
 * keeps every solve and loses only their place in a numbering, exactly as
 * after any regeneration.
 */
function assign(puzzles){
  const dropped = [];

  /* Rank first, because both of the things below depend on the order: which
     duplicate survives, and how the deal spreads difficulty. */
  const ranked = puzzles.slice().sort((a, b) => G.difficulty(a) - G.difficulty(b));

  const byId = new Set();
  const byFen = new Map();
  const keep = [];
  for (const p of ranked){
    if (!p || !p.id || !p.fen){ dropped.push({ id: (p && p.id) || '?', why: 'no id or fen' }); continue; }
    if (byId.has(p.id)){ dropped.push({ id: p.id, why: 'duplicate id' }); continue; }
    /* Two ids, one position. The easier-ranked line already went in, so this
       one is the duplicate whatever its id says. */
    if (byFen.has(p.fen)){
      dropped.push({ id: p.id, why: 'duplicate position (already have ' + byFen.get(p.fen) + ')' });
      continue;
    }
    byId.add(p.id);
    byFen.set(p.fen, p.id);
    keep.push(p);
  }

  const pools = {};
  for (const k of KEYS) pools[k] = [];
  keep.forEach((p, i) => {
    const key = KEYS[i % KEYS.length];
    pools[key].push(Object.assign({}, p, { mode: key }));
  });
  // renumber each pool as its own ladder, easiest first
  for (const k of KEYS) pools[k].forEach((p, i) => { p.n = i + 1; });

  return { pools, dropped, order: keep.map(p => p.id) };
}

/**
 * check(pools) -> [problem strings]
 *
 * The assertion the shipped files have to satisfy, kept beside the thing that
 * builds them so a hand-edited corpus is caught too. Called by the tests and
 * by the verifier before it writes.
 */
function check(pools){
  const bad = [];
  const seenId = new Map(), seenFen = new Map();
  for (const k of KEYS){
    const list = pools[k] || [];
    list.forEach((p, i) => {
      if (p.mode !== k) bad.push(k + '[' + i + '] ' + p.id + ' is labelled mode ' + p.mode);
      if (p.n !== i + 1) bad.push(k + '[' + i + '] ' + p.id + ' has n=' + p.n + ', expected ' + (i + 1));
      if (seenId.has(p.id)) bad.push('id ' + p.id + ' is in both ' + seenId.get(p.id) + ' and ' + k);
      else seenId.set(p.id, k);
      if (seenFen.has(p.fen)) bad.push('position of ' + p.id + ' also appears in ' + seenFen.get(p.fen));
      else seenFen.set(p.fen, k);
    });
  }
  /* Even distribution. The deal cannot produce a spread wider than one, so a
     wider one means somebody wrote these files by hand or filtered them after
     the fact — worth saying out loud rather than silently tolerating. */
  const sizes = KEYS.map(k => (pools[k] || []).length);
  if (Math.max.apply(null, sizes) - Math.min.apply(null, sizes) > 1)
    bad.push('pools are uneven: ' + KEYS.map((k, i) => k + '=' + sizes[i]).join(' '));
  return bad;
}

module.exports = { MODES, KEYS, assign, check };
