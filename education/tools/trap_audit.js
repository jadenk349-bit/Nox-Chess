'use strict';
/* Every matcher, against the FALSE-POSITIVE TRAPS its own record states.
 *
 * This is the audit that has found more real defects in this project than any
 * other single activity. The shape repeats: a record states a precondition and
 * then, underneath it, the conditions under which the precondition is not
 * enough - and the matcher implements the first line and none of the rest.
 * Seven have been found and fixed this way:
 *
 *   two-weaknesses   72.5% -> 38.6%   three of four preconditions unbuilt
 *   open-file        55.7% -> 35.5%   a registered false positive never built
 *   weak-square      68.9% -> 40.5%   the fianchetto trap, the rim, our own half
 *   piece-activity   44.4% -> 33.9%   counted legal moves, which the trap forbids
 *   space            53.3% -> 34.6%   "space with no entry point wins nothing"
 *   material-imbal.  42.1% -> 35.5%   contradicted the record's own piece values
 *   bishop-pair      wording          "a pair with a buried bishop is not a pair"
 *   loose-piece      66.8% ->  9.1%   the forcing move must survive being forcing
 *
 * The tool cannot decide whether a trap is implemented - that is a reading, and
 * doing it is the work. What it can do is stop the LIST from being rediscovered
 * from scratch each time, and make the number of unread traps a number.
 *
 * A trap counts as ADDRESSED when the matcher's `implements` string or its body
 * cites it, or when the record carries a limitation saying it cannot be built.
 * Both of those are things this project already does deliberately; neither can
 * be produced by accident.
 *
 *     node tools/trap_audit.js [--concept id] [--unread] [--markdown out.md]
 */
const fs = require('fs');
const path = require('path');
const MATCH = require('../lib/matchers.js');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const only = args.includes('--concept') ? args[args.indexOf('--concept') + 1] : null;
const openOnly = args.includes('--unread') || args.includes('--open');
const mdOut = args.includes('--markdown') ? args[args.indexOf('--markdown') + 1] : null;

const recs = {};
for (const dir of fs.readdirSync(path.join(ROOT, 'concepts'))) {
  const d = path.join(ROOT, 'concepts', dir);
  if (!fs.statSync(d).isDirectory()) continue;
  for (const f of fs.readdirSync(d)) {
    if (!f.endsWith('.json')) continue;
    const c = JSON.parse(fs.readFileSync(path.join(d, f), 'utf8'));
    recs[c.id] = c;
  }
}

// Words distinctive enough that finding one in the matcher is evidence the trap
// was read, and common enough to appear in a comment written about it. Stop
// words are stripped so "the" does not match everything.
const STOP = new Set(('a an and are as at be by can do does for from has have in is it its no not of on ' +
  'one only or that the their them there they this to two was what when which will with you your ' +
  'if but so than then more most less least any all every each other than very much such').split(' '));
const keywords = t => [...new Set(String(t).toLowerCase().match(/[a-z][a-z-]{3,}/g) || [])]
  .filter(w => !STOP.has(w));

// A concept may have more than one matcher (king-safety has three arms), so the
// evidence for a trap is all of them together, and each trap is listed once.
const bodies = {};
for (const m of MATCH.STRUCTURAL.concat(MATCH.MOVE_BASED)) {
  bodies[m.concept] = (bodies[m.concept] || '') + '\n' +
                      String(m.implements || '') + '\n' + String(m.run);
}

const rows = [];
const done = new Set();
for (const m of MATCH.STRUCTURAL.concat(MATCH.MOVE_BASED)) {
  if (only && m.concept !== only) continue;
  const rec = recs[m.concept];
  if (!rec) continue;
  const traps = ((rec.recognition || {}).false_positive_traps) || [];
  if (!traps.length) continue;
  if (done.has(m.concept)) continue;
  done.add(m.concept);
  const text = bodies[m.concept].toLowerCase();
  const limits = JSON.stringify(rec.limitations || []).toLowerCase();
  for (const trap of traps) {
    const ks = keywords(trap);
    // A trap is addressed when a good share of its distinctive words appear in
    // the matcher, or when the record says in its limitations that it cannot be
    // built. Both are deliberate acts; neither happens by accident.
    const hitM = ks.filter(w => text.includes(w)).length / (ks.length || 1);
    const hitL = ks.filter(w => limits.includes(w)).length / (ks.length || 1);
    // This is a reading list, not a verdict. "cited" means the trap has been
    // written about somewhere it would be enforced or excused; "unread" means
    // nobody has written down whether it is implemented, which is true whether
    // or not it happens to be. Every one of the seven defects listed above was
    // in the second group before it was looked at.
    const verdict = hitM >= 0.4 ? 'in the matcher'
                  : hitL >= 0.4 ? 'recorded as unbuildable'
                  : 'unread';
    rows.push({ concept: m.concept, trap, verdict, hitM, hitL });
  }
}

const open = rows.filter(r => r.verdict === 'unread');
const show = openOnly ? open : rows;
let last = null;
console.log(`\nTRAP AUDIT — ${rows.length} stated traps across ${new Set(rows.map(r => r.concept)).size} matchers\n`);
for (const r of show) {
  if (r.concept !== last) { console.log(`  ${r.concept}`); last = r.concept; }
  const tag = r.verdict === 'unread' ? 'UNREAD' : r.verdict === 'in the matcher' ? 'cited ' : 'noted ';
  console.log(`    [${tag}] ${r.trap.replace(/\s+/g, ' ').slice(0, 150)}${r.trap.length > 150 ? '…' : ''}`);
}
console.log(`\n  cited ${rows.length - open.length}/${rows.length}   UNREAD ${open.length}` +
            `   (${new Set(open.map(r => r.concept)).size} matchers)\n`);

if (mdOut) {
  const lines = ['# Trap audit', '',
    'Every false-positive trap a concept record states, against the matcher that',
    'is supposed to implement it. Regenerate with `node tools/trap_audit.js',
    '--markdown state/TRAPS.md`.', '',
    'This is a READING LIST, not a verdict. "cited" means the trap has been',
    'written about somewhere it would be enforced or excused — in the matcher, or',
    'in a record limitation saying it cannot be built. "unread" means nobody has',
    'written down whether it is implemented, which is true whether or not it',
    'happens to be. The tool cannot decide whether a trap is *correctly*',
    'implemented; that is a reading, and doing it is the work. What it can do is',
    'stop the list being rediscovered from scratch each time — and every one of',
    'the defects listed in the tool\'s header was unread before it was looked at.', '',
    `**${rows.length - open.length} of ${rows.length} cited. ${open.length} unread.**`, ''];
  let cur = null;
  for (const r of rows) {
    if (r.concept !== cur) { lines.push(`## ${r.concept}`, ''); cur = r.concept; }
    const tag = r.verdict === 'unread' ? '**unread**' : r.verdict === 'in the matcher' ? 'cited' : 'noted';
    lines.push(`- [${tag}] ${r.trap.replace(/\s+/g, ' ')}`);
  }
  lines.push('');
  fs.writeFileSync(path.join(ROOT, mdOut), lines.join('\n'));
  console.log(`  wrote ${mdOut}\n`);
}
