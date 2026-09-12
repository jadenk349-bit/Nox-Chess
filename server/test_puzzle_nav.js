#!/usr/bin/env node
/* The two menus, asserted against the page's own markup.
 *
 * Navigation is the one part of this revision with no engine behind it and no
 * data to check it against — the Puzzle menu is right or wrong by inspection,
 * and inspection is what stops happening once the feature works. So it is
 * asserted here: two doors on the Puzzle menu — Puzzle, which opens the setup
 * page that asks for the vision, and Puzzle Rush, which starts on the press —
 * none of them a phase, the phases moved to Practice, and nothing left
 * pointing at a button that no longer exists. (The menu was five vision doors
 * for one revision; the setup page replaced them, and this file was written
 * against the five and left saying so.)
 *
 * Reads blind-chess.html as text, like test_ws_url.js, because what is being
 * checked *is* the source: a handler wired to a removed id is a runtime error
 * on page load, and a test that stubbed the DOM would not see it.
 *
 *   node server/test_puzzle_nav.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'blind-chess.html'), 'utf8');

let passed = 0, failed = 0;
function check(label, got, want){
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok){ passed++; console.log('  PASS  ' + label + '  ->  ' + JSON.stringify(got)); }
  else { failed++; console.log('  FAIL  ' + label +
        '\n        got  ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want)); }
}
const head = s => console.log('\n' + s + '\n');

/** The buttons inside one nav menu, as [id, label] pairs. */
function menuOf(navId){
  const at = SRC.indexOf('id="' + navId + '"');
  if (at < 0) return null;
  const open = SRC.indexOf('<div class="menu">', at);
  const close = SRC.indexOf('</div>', open);
  const block = SRC.slice(open, close);
  const out = [];
  const re = /<button class="menu-btn" id="([A-Za-z0-9]+)">([^<]+)<\/button>/g;
  let m;
  while ((m = re.exec(block))) out.push([m[1], m[2].trim()]);
  return out;
}

head('The Puzzle menu is two doors and nothing else');

const puzzle = menuOf('navPuzzle');
check('Puzzle, and Puzzle Rush',
      puzzle.map(p => p[1]), ['Puzzle', 'Puzzle Rush']);
check('and their ids are the ones the handlers use',
      puzzle.map(p => p[0]), ['navPuzzleGo', 'navRush']);
check('exactly two doors', puzzle.length, 2);
check('no vision is named on the menu',
      puzzle.some(p => /Sighted|Board|Blindfold|Fog/.test(p[1])), false);

head('Puzzle asks the vision on a setup page; Rush asks nothing');

check('the Puzzle door opens the setup page',
      /getElementById\('navPuzzleGo'\)\.onclick = \(\) => GUEST\(\) \? toSignUp\(\) : enterPuzzleSetup\(\);/.test(SRC), true);
check('the Rush door starts a run on the press',
      /getElementById\('navRush'\)\s+= \(\) => GUEST\(\) \? toSignUp\(\) : rushStart\(\);/.test(SRC.replace(/\.onclick/g, '')), true);
/* The home page's Puzzle shortcut is a button and not a menu: hovering it
   opens nothing, and pressing it presses the header's Puzzle door, so it can
   never go somewhere the header does not. The menu is the header's alone. */
const homeAt = SRC.indexOf('id="homePuzzle"');
const homeTag = SRC.slice(SRC.lastIndexOf('<', homeAt), SRC.indexOf('>', homeAt) + 1);
check('the home shortcut is a plain button', /^<button class="home-shortcut" id="homePuzzle">$/.test(homeTag), true);
check('and opens no menu', /aria-haspopup/.test(homeTag), false);
check('and no home button is a copy of a door', SRC.indexOf('"homePuzzleGo"') < 0 && SRC.indexOf('"homeRush"') < 0, true);
check('it presses the header\'s Puzzle door',
      /getElementById\('homePuzzle'\)\.onclick = \(\) => document\.getElementById\('navPuzzleGo'\)\.click\(\);/.test(SRC), true);
check('the setup page starts the puzzle from the vision it was given',
      /function startPuzzleFromSetup\(/.test(SRC) && /function pzModeForVision\(/.test(SRC), true);

head('Phase is no longer a way to play');

for (const gone of ['navOpening', 'navMiddle', 'navEnd'])
  check(gone + ' is gone from the whole page', SRC.indexOf('"' + gone + '"') < 0 &&
        SRC.indexOf("'" + gone + "'") < 0, true);
check('no Puzzle-menu entry mentions a phase',
      puzzle.some(p => /Opening|Middle Game|End Game/.test(p[1])), false);

head('Every door is locked behind an account, and every locked id exists');

const locked = (SRC.match(/const LOCKED_IDS = \[([\s\S]*?)\];/) || [])[1] || '';
for (const id of ['navPuzzle', 'navPuzzleGo', 'navRush', 'homePuzzle'])
  check(id + ' is in LOCKED_IDS', locked.indexOf("'" + id + "'") >= 0, true);
for (const m of locked.match(/'([A-Za-z0-9]+)'/g) || []){
  const id = m.slice(1, -1);
  check(id + ' is a real element', SRC.indexOf('id="' + id + '"') >= 0, true);
}

head('Every handler points at a button that exists');

const wired = SRC.match(/document\.getElementById\('(nav[A-Za-z0-9]+)'\)\.onclick/g) || [];
for (const w of wired){
  const id = w.match(/'(nav[A-Za-z0-9]+)'/)[1];
  check(id + ' has markup', SRC.indexOf('id="' + id + '"') >= 0, true);
}

head('Lesson still leads to Practice, and Practice keeps the blind drills');

const lesson = menuOf('navHowTo') || [];
check('the Lesson menu still offers How to Play',
      SRC.indexOf('id="navHowTo"') >= 0, true);
check('and Practice', SRC.indexOf('id="navPractice"') >= 0, true);
check('the eleven blindfold drills are untouched',
      (SRC.match(/const PR_MODES = \[([\s\S]*?)\n\];/) || ['',''])[1]
        .match(/key:'/g).length, 11);

head('...and gains the two board-practice categories on the same page');

check('the Practice page has a second card rail',
      SRC.indexOf('id="prBoardCards"') >= 0, true);
const cats = (SRC.match(/const PC_CATS = \[([\s\S]*?)\n\];/) || ['',''])[1];
check('Opening Practices', /key:'opening'/.test(cats), true);
check('Middle Game Practices', /key:'middlegame'/.test(cats), true);
check('exactly two categories', (cats.match(/key:'/g) || []).length, 2);
check('and they are not in PR_MODES, so the drill ladder is unaffected',
      /key:'opening'/.test((SRC.match(/const PR_MODES = \[([\s\S]*?)\n\];/) || ['',''])[1]), false);

head('The five pools map onto the page\'s own vision modes');

const modes = (SRC.match(/const PZ_MODES = \[([\s\S]*?)\n\];/) || ['',''])[1];
for (const [key, vision] of [['sighted', 'sighted'], ['board', 'blind'],
                             ['blindfold', 'total'], ['fog', 'fog']])
  check(key + ' shows the board as ' + vision,
        new RegExp("key:'" + key + "'[^}]*vision:'" + vision + "'").test(modes), true);
check('Puzzle Rush takes no vision of its own — its gameplay is unchanged',
      /key:'rush'[^}]*vision:null/.test(modes), true);

head('Practices and puzzles bust their caches separately');

check('practices carry their own version', /const PC_VERSION = \d+;/.test(SRC), true);
check('and the practice fetch uses it',
      /practices\/' \+ key \+ '\.json\?v=' \+ PC_VERSION/.test(SRC), true);
check('while the pools use the puzzle version',
      /puzzles\/modes\/' \+ key \+ '\.json\?v=' \+ PZ_VERSION/.test(SRC), true);

console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
process.exit(failed ? 1 : 0);
