/* Cutting the verified Daily corpus into four pools of a hundred.
 *
 * The same job tools/pool_assign.js does for the Puzzle page, and deliberately
 * the same *rule*, because the reasoning that file works through applies here
 * unchanged: sort the whole corpus by the generator's own difficulty key and
 * deal the sorted list out like cards, so every pool gets an even spread from
 * easiest to hardest rather than one pool getting the three hardest positions
 * in the set. It is a separate file only because the four keys differ and
 * because pool_assign() deals five ways and always will — Puzzle Rush is a
 * door there and is not one here.
 *
 * What this adds that pool_assign() does not is the second exclusion. The
 * Puzzle page's pools only had to avoid each other; these have to avoid each
 * other *and* everything the Puzzle page already ships, because a Daily Puzzle
 * is meant to be an additional position. The generator was told the same thing
 * (--excludeIn) so that no engine time is spent on one, but mining is not the
 * only way a duplicate can arrive — two runs merged, a corpus re-verified —
 * so it is checked again here, where it is cheap and final.
 *
 *   node tools/daily_assign.js --in puzzles/daily/work --out puzzles/daily
 *   node tools/daily_assign.js --in ... --out ... --size 100 --write
 *
 * Nothing is written without --write.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const G = require('./generate_puzzles.js');

/* The four doors. `vision` is the page's own G.mode value, so this table is the
   only place the two vocabularies meet — the same arrangement PZ_MODES has, and
   DAILY_MODES in blind-chess.html is this table again on the browser's side.
   server/test_daily.py holds the two to each other. */
const MODES = [
  { key: 'blindfold', name: 'Complete Blindfold', vision: 'total'   },
  { key: 'board',     name: 'Board Only',         vision: 'blind'   },
  { key: 'fog',       name: 'Fog of War',         vision: 'fog'     },
  { key: 'sighted',   name: 'Sighted',            vision: 'sighted' }
];
const KEYS = MODES.map(m => m.key);

/* Every position the Puzzle page and the Practices already ship. Read from the
   files rather than passed in, so this cannot be run against a stale list. */
function existingFens(root){
  const out = new Set();
  const dirs = [
    ['puzzles', f => /\.json$/.test(f)],
    ['puzzles/modes', f => /\.json$/.test(f)],
    ['practices', f => /^(opening|middlegame)\.json$/.test(f)]
  ];
  for (const [rel, keep] of dirs){
    const dir = path.join(root, rel);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)){
      if (!keep(f)) continue;
      let list;
      try { list = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); }
      catch (e){ continue; }
      if (Array.isArray(list)) for (const p of list) if (p && p.fen) out.add(p.fen);
    }
  }
  return out;
}

/** Deal a verified corpus into the four pools.
 *
 *  `already` is the set of positions that must not appear — the Puzzle page's.
 *  Everything refused is returned with a reason rather than dropped silently:
 *  a corpus that came back smaller than it went in should be able to say why.
 */
function assign(puzzles, already, size){
  const dropped = [];
  const cap = size || 0;

  // rank first: both the duplicate rule and the deal depend on this order
  const ranked = puzzles.slice().sort((a, b) => G.difficulty(a) - G.difficulty(b));

  const byId = new Set();
  const byFen = new Map();
  const keep = [];
  for (const p of ranked){
    if (!p || !p.id || !p.fen){ dropped.push({ id: (p && p.id) || '?', why: 'no id or fen' }); continue; }
    if (byId.has(p.id)){ dropped.push({ id: p.id, why: 'duplicate id' }); continue; }
    /* Two ids, one position: an id is a hash of the fen *and* the line, so two
       runs that found the same position and extended it differently make two
       ids and one position. The easier-ranked line already went in. */
    if (byFen.has(p.fen)){
      dropped.push({ id: p.id, why: 'duplicate position (already have ' + byFen.get(p.fen) + ')' });
      continue;
    }
    if (already && already.has(p.fen)){
      dropped.push({ id: p.id, why: 'position already on the Puzzle page' });
      continue;
    }
    byId.add(p.id);
    byFen.set(p.fen, p.id);
    keep.push(p);
  }

  /* Deal round-robin over the difficulty ranking, then take the first `size`
     of each. Taking the head of each pool rather than the head of the corpus is
     what keeps the four ladders comparable: each one is an even sample of the
     whole range, and trimming them all at the same rung trims the same amount
     of difficulty from each. */
  const pools = {};
  for (const k of KEYS) pools[k] = [];
  keep.forEach((p, i) => {
    const key = KEYS[i % KEYS.length];
    pools[key].push(Object.assign({}, p, { mode: key }));
  });
  const short = [];
  for (const k of KEYS){
    if (cap && pools[k].length > cap) pools[k] = pools[k].slice(0, cap);
    if (cap && pools[k].length < cap) short.push({ key: k, have: pools[k].length, want: cap });
    pools[k].forEach((p, i) => { p.n = i + 1; });
  }

  return { pools, dropped, short, kept: keep.length };
}

/** Re-ask, of the written result, everything the deal was supposed to promise. */
function check(pools, already){
  const problems = [];
  const ids = new Map(), fens = new Map();
  for (const k of KEYS){
    const list = pools[k] || [];
    list.forEach((p, i) => {
      if (p.n !== i + 1) problems.push(k + ' rung ' + (i + 1) + ' is numbered ' + p.n);
      if (ids.has(p.id)) problems.push('id ' + p.id + ' in both ' + ids.get(p.id) + ' and ' + k);
      else ids.set(p.id, k);
      if (fens.has(p.fen)) problems.push('position of ' + p.id + ' also in ' + fens.get(p.fen));
      else fens.set(p.fen, k);
      if (already && already.has(p.fen)) problems.push(p.id + ' is a position the Puzzle page ships');
      if (!p.moves || !p.moves.length) problems.push(p.id + ' has no solution');
      if (p.moves && p.moves.length % 2 === 0) problems.push(p.id + ' does not end on the solver\'s move');
    });
  }
  return problems;
}

function parseArgs(argv){
  const cfg = { in: '', out: '', size: 100, write: false, root: path.join(__dirname, '..') };
  for (let i = 0; i < argv.length; i++){
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const k = a.slice(2);
    if (k === 'write'){ cfg.write = true; continue; }
    if (!(k in cfg)) throw new Error('unknown option --' + k);
    cfg[k] = typeof cfg[k] === 'number' ? +argv[++i] : argv[++i];
  }
  return cfg;
}

function main(){
  const cfg = parseArgs(process.argv.slice(2));
  if (!cfg.in) throw new Error('--in <dir of verified track files> is required');
  const outDir = cfg.out || path.join(cfg.root, 'puzzles', 'daily');

  const corpus = [];
  for (const f of fs.readdirSync(cfg.in)){
    if (!/\.json$/.test(f) || /progress/.test(f)) continue;
    const list = JSON.parse(fs.readFileSync(path.join(cfg.in, f), 'utf8'));
    if (Array.isArray(list)) for (const p of list) corpus.push(p);
  }
  console.log('  read %d verified puzzles from %s', corpus.length, cfg.in);

  const already = existingFens(cfg.root);
  console.log('  %d positions already on the Puzzle page, excluded', already.size);

  const { pools, dropped, short, kept } = assign(corpus, already, cfg.size);
  console.log('  %d survived deduplication', kept);
  const why = {};
  for (const d of dropped) why[d.why] = (why[d.why] || 0) + 1;
  for (const [w, n] of Object.entries(why)) console.log('    %-46s %d', w, n);

  for (const k of KEYS) console.log('  %-10s %3d', k, pools[k].length);
  for (const s of short) console.log('  SHORT: %s has %d of %d', s.key, s.have, s.want);

  const problems = check(pools, already);
  if (problems.length){
    console.log('\n  INTEGRITY PROBLEMS:');
    for (const p of problems.slice(0, 20)) console.log('    ' + p);
    process.exitCode = 1;
    return;
  }
  console.log('  integrity: no duplicate id, no duplicate position, none on the Puzzle page');

  if (!cfg.write){ console.log('\n  nothing written (pass --write)'); return; }
  fs.mkdirSync(outDir, { recursive: true });
  for (const k of KEYS){
    fs.writeFileSync(path.join(outDir, k + '.json'), JSON.stringify(pools[k], null, 1) + '\n');
    console.log('  wrote %s/%s.json  %d', outDir, k, pools[k].length);
  }
}

if (require.main === module) main();

module.exports = { MODES, KEYS, assign, check, existingFens };
