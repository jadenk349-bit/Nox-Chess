'use strict';
/* Does this controlled pair actually discriminate?
 *
 * A counterexample is only worth writing down if the base treats the two halves
 * differently, and hand-built pairs get that wrong often: in one afternoon a
 * rook-pawn Lucena with the defending king too far away turned out to be a win,
 * a trebuchet built from memory was a draw both ways, two Philidor "refutations"
 * simply hung a rook, and three constructed FENs put a king in check by accident.
 * The tablebase caught the first three and this catches the rest.
 *
 * Input is a JSON array of candidates on stdin or in a file:
 *
 *   [{"id":"pin","yes":{"fen":"...","move":"a1d1"},"no":{"fen":"...","move":"a1d1"}}]
 *
 * `yes` must report the concept and `no` must not. Both must be legal, and a
 * move given must be legal in its own position. Anything else is printed and
 * nothing is written: this tool never edits a record.
 *
 *     node tools/pair_check.js candidates.json
 */
const fs = require('fs');
const path = require('path');
const FEAT = require('../lib/features.js');
const API = require('../lib/analyze.js');

const file = process.argv[2];
const cands = JSON.parse(file ? fs.readFileSync(file, 'utf8') : fs.readFileSync(0, 'utf8'));

const has = (side, id) => {
  if (!side) return null;
  let r;
  try { r = API.analyzeWithEducation(side.move ? { fen: side.fen, move: side.move } : { fen: side.fen }); }
  catch (e) { return 'ERR ' + e.message; }
  return r.concepts_all.some(c => c.id === id && (!side.side || (c.subjects || []).includes(side.side)));
};
const legal = side => {
  if (!side) return true;
  try { FEAT.page.stateFromFEN(side.fen); } catch (e) { return 'bad FEN: ' + e.message; }
  if (side.move) {
    const m = FEAT.motifsOfMove(side.fen, side.move);
    if (!m.legal) return 'illegal move ' + side.move;
  }
  return true;
};

let good = 0, bad = 0;
for (const c of cands) {
  const ly = legal(c.yes), ln = legal(c.no);
  const y = ly === true ? has(c.yes, c.id) : ly;
  const n = ln === true ? has(c.no, c.id) : ln;
  const ok = y === true && n === false;
  if (ok) good++; else bad++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${c.id.padEnd(24)} yes=${String(y).padEnd(6)} no=${String(n)}`);
  if (!ok) {
    if (c.yes) console.log(`         yes: ${c.yes.fen}${c.yes.move ? '  ' + c.yes.move : ''}`);
    if (c.no) console.log(`         no : ${c.no.fen}${c.no.move ? '  ' + c.no.move : ''}`);
  }
}
console.log(`\n  ${good} discriminating, ${bad} not\n`);
process.exit(bad ? 1 : 0);
