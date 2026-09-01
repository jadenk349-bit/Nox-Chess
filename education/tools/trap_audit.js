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

// Half the guards live in Layer 3, not in the matcher: the fianchetto trap for
// `weak-square` is enforced in reachableHoles() and quoted in a comment there.
// Searching only lib/matchers.js therefore reports work that has been done as
// unread, which is the one way this list can mislead in the direction that
// wastes time. features.js is a shared file, so it counts at a higher bar.
const LAYER3_RAW = fs.readFileSync(path.join(__dirname, '..', 'lib', 'features.js'), 'utf8');

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

// What counts as evidence that a trap has been read.
//
// The first version scored keyword OVERLAP, and it was wrong in both directions
// at once: it missed guards that live in Layer 3 rather than in the matcher, and
// when Layer 3 was added at a keyword threshold it credited 40 traps at a
// stroke, which is the shape of a metric flattering itself. A shared 1000-line
// file will contain half of any sentence's words by accident.
//
// So the test is QUOTATION. This project's habit, everywhere, is to quote the
// condition it is implementing in the comment beside it — the seven fixes found
// by this method all read that way. A four-word run from the trap appearing in
// the code is something someone did on purpose; a bag of words is not.
const norm = t => String(t).toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
const shingles = (t, n = 4) => {
  const w = norm(t).split(' ');
  const out = [];
  for (let i = 0; i + n <= w.length; i++) out.push(w.slice(i, i + n).join(' '));
  return out;
};
const quoted = (trap, hay) => shingles(trap).some(sh => hay.includes(sh));

const L3 = norm(LAYER3_RAW);

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
  const text = norm(bodies[m.concept]);
  const limits = norm(JSON.stringify(rec.limitations || []));
  for (const trap of traps) {

    const hitM = quoted(trap, text), hitL = quoted(trap, limits), hit3 = quoted(trap, L3);
    // This is a reading list, not a verdict. "cited" means the trap has been
    // written about somewhere it would be enforced or excused; "unread" means
    // nobody has written down whether it is implemented, which is true whether
    // or not it happens to be. Every one of the seven defects listed above was
    // in the second group before it was looked at.
    const verdict = hitM ? 'in the matcher'
                  : hit3 ? 'in Layer 3'
                  : hitL ? 'recorded as unbuildable'
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
  const tag = r.verdict === 'unread' ? 'UNREAD'
            : r.verdict === 'in the matcher' ? 'cited '
            : r.verdict === 'in Layer 3' ? 'layer3' : 'noted ';
  console.log(`    [${tag}] ${r.trap.replace(/\s+/g, ' ').slice(0, 150)}${r.trap.length > 150 ? '…' : ''}`);
}
// THREE numbers, not one, and the reason is the reason for everything else in
// this project. "Noted" means somebody argued on the record that a trap cannot
// be built or is already honoured elsewhere - which is honest work and is not
// the same as a guard in the code. A single "108/108 cited" headline would read
// as "all traps implemented", and that would be the same self-flattery this tool
// caught in its own first version.
const byVerdict = v => rows.filter(r => r.verdict === v).length;
console.log(`\n  in the matcher ${byVerdict('in the matcher')}   in Layer 3 ${byVerdict('in Layer 3')}` +
            `   noted on the record ${byVerdict('recorded as unbuildable')}   UNREAD ${open.length}` +
            (open.length ? `   (${new Set(open.map(r => r.concept)).size} matchers)` : '') + '\n' +
            `  ...of ${rows.length} stated traps. "Noted" is an argument, not a guard.\n`);

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
    `**Of ${rows.length} stated traps: ${byVerdict('in the matcher')} enforced in the matcher, ` +
    `${byVerdict('in Layer 3')} in Layer 3, ${byVerdict('recorded as unbuildable')} argued on the ` +
    `record to be unbuildable or already honoured elsewhere, ${open.length} unread.**`, '',
    '"Noted on the record" is an argument, not a guard. A single "all cited"',
    'headline would read as "all traps implemented", which would be the same',
    'self-flattery this tool caught in its own first version — it scored keyword',
    'overlap, reported 75 unread, and then credited 40 traps at a stroke when a',
    'shared file was added to the search. The test is quotation for that reason.', ''];
  let cur = null;
  for (const r of rows) {
    if (r.concept !== cur) { lines.push(`## ${r.concept}`, ''); cur = r.concept; }
    const tag = r.verdict === 'unread' ? '**unread**'
              : r.verdict === 'in the matcher' ? 'cited'
              : r.verdict === 'in Layer 3' ? 'layer 3' : 'noted';
    lines.push(`- [${tag}] ${r.trap.replace(/\s+/g, ' ')}`);
  }
  lines.push('');
  fs.writeFileSync(path.join(ROOT, mdOut), lines.join('\n'));
  console.log(`  wrote ${mdOut}\n`);
}
