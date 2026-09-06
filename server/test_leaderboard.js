/* The home page's four ladders, against a scripted account client.
 *
 * Every other suite asks what the game does; this one asks what the
 * leaderboard reads, because the four panels are the only thing on the home
 * page that talks to the database, and the one way they can be wrong that
 * nobody would notice is by reading the right names off the wrong column.
 * So it lifts the ladder code out of blind-chess.html by name — renaming
 * what it extracts breaks it on purpose — hands it a stand-in for the
 * Supabase client that records every query, and checks:
 *
 *   · four reads, one per vision, each ordering by its own column
 *   · a row's rating is read off that column and never off `rating`
 *   · a column that does not exist names the migration file, and only for
 *     the panel that is missing it — the Sighted ladder stays up
 *   · every other error is shown as itself, not tidied away
 *   · the fixture is gone, and the three files that name the columns —
 *     the page, server/supabase_db.py and supabase-migrate-visions.sql —
 *     name the same three
 *
 *   node server/test_leaderboard.js
 */

var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..');
var PAGE = path.join(ROOT, 'blind-chess.html');

function say(s){ console.log(s); }

var SRC = fs.readFileSync(PAGE, 'utf8');
function grab(re, what){
  var m = SRC.match(re);
  if (!m){ say('FAIL  could not find ' + what); throw new Error(what + ' not found'); }
  return m[0];
}
var fn = function(n){
  return grab(new RegExp('\\n(?:async )?function ' + n + '\\s*\\([\\s\\S]*?\\n\\}'), 'function ' + n);
};
var decl = function(n){
  var block = SRC.match(new RegExp('\\n(?:const|let) ' + n + '\\s*=\\s*[\\{\\[][\\s\\S]*?\\n[\\}\\]];'));
  if (block) return block[0];
  return grab(new RegExp('\\n(?:const|let) ' + n + '\\b[^\\n]*?;'), n);
};
var line = function(n){
  return grab(new RegExp('\\n(?:const|let) ' + n + '\\s*=[^\\n]*?;'), n);
};

var passed = 0, failed = 0;
function check(label, ok, detail){
  if (ok){ passed++; say('  PASS  ' + label); }
  else { failed++; say('  FAIL  ' + label + (detail ? '\n        ' + detail : '')); }
}
function same(a, b){ return JSON.stringify(a) === JSON.stringify(b); }

/* ---- the stub half ---- */

var DOM = [
  'var elements = {};',
  // innerHTML = "" is how the page empties a list, so the stand-in forgets its children with it
  'function fakeEl(id){ return { id:id, textContent:"", children:[],',
  '  set innerHTML(v){ if (v === "") this.children = []; }, get innerHTML(){ return ""; },',
  '  appendChild:function(c){ this.children.push(c); } }; }',
  'var document = { getElementById:function(id){',
  '  return elements[id] || (elements[id] = fakeEl(id)); } };',
  // what the page's row builders are stood in for: a row remembers who and where
  'function boardRow(person, place){ return { person:person, place:place }; }',
  'function emptyNote(text, bad){ return { note:text, bad:!!bad }; }',
  'var sb = null, authSettled = false;'
].join('\n');

var CODE = [
  line('LB_TOP'), decl('LB_VISIONS'), decl('LB'),
  fn('loadBoard'), fn('loadLadder'), fn('ratedPerson'), fn('ladderError'),
  fn('renderLadder'), fn('renderBoard'), fn('fillBoard')
].join('\n');

/** A page with nothing having happened to it yet. */
function fresh(){
  return new Function(
    DOM + '\n' + CODE + '\n' +
    'return { LB:LB, LB_VISIONS:LB_VISIONS, LB_TOP:LB_TOP, elements:elements,' +
    '  load:loadBoard, loadOne:loadLadder, redraw:renderBoard,' +
    '  setSb:function(x){ sb = x; }, settle:function(){ authSettled = true; },' +
    '  panel:function(key){ var e = elements[LB_VISIONS[key].list];' +
    '    var last = e.children[e.children.length - 1];' +
    '    return { innerHTML:e.innerHTML, children:e.children, last:last }; },' +
    '  cap:function(key){ var c = LB_VISIONS[key].cap; return c ? elements[c].textContent : null; } };'
  )();
}

/** A stand-in for the Supabase client: records each query, answers by column. */
function fakeSb(answer){
  var calls = [];
  return {
    calls: calls,
    from: function(table){
      var q = { table: table, select: null, orders: [], limit: null };
      calls.push(q);
      var chain = {
        select: function(s){ q.select = s; return chain; },
        order: function(col, opts){
          q.orders.push([col, opts && opts.ascending === false ? 'desc' : 'asc']);
          return chain;
        },
        limit: function(n){ q.limit = n; return Promise.resolve(answer(q)); }
      };
      return chain;
    }
  };
}
function columnOf(q){ return q.select.split(',').pop().trim(); }

/* One row per profile, every column present, the numbers all different so a
   panel reading the wrong one is caught. Sorted by nothing: the database
   sorts, and the page must draw in the order it is given. */
var ROWS = [
  { id: 'k', display_name: 'Kasper21', rating: 2809, complete_blindfold_rating: 2455,
    board_only_rating: 2631, fog_of_war_rating: 2673 },
  { id: 'v', display_name: 'Velmor',   rating: 2742, complete_blindfold_rating: 2474,
    board_only_rating: 2762, fog_of_war_rating: 2523 },
  { id: 'j', display_name: 'Jaden',    rating: 1200, complete_blindfold_rating: 100,
    board_only_rating: 100,  fog_of_war_rating: 100 }
];
function sortedBy(col){
  return ROWS.slice().sort(function(a, b){
    return b[col] - a[col] || a.display_name.localeCompare(b.display_name);
  });
}
function everything(q){ return { data: sortedBy(columnOf(q)), error: null }; }

function tick(){ return new Promise(function(r){ setTimeout(r, 0); }); }

async function main(){
  say('\nThe four reads');
  {
    var page = fresh(), sb = fakeSb(everything);
    page.setSb(sb); page.settle();
    page.load();
    await tick();
    var cols = Object.keys(page.LB_VISIONS).map(function(k){ return page.LB_VISIONS[k].column; });
    check('four visions, four columns', cols.length === 4 && new Set(cols).size === 4, cols.join(','));
    check('the Sighted ladder is still profiles.rating', page.LB_VISIONS.sighted.column === 'rating');
    check('the other three are the migration\'s columns',
          same([page.LB_VISIONS.total.column, page.LB_VISIONS.blind.column, page.LB_VISIONS.fog.column],
               ['complete_blindfold_rating', 'board_only_rating', 'fog_of_war_rating']));
    check('one query per vision, all on profiles',
          sb.calls.length === 4 && sb.calls.every(function(q){ return q.table === 'profiles'; }));
    check('each query asks for its own column and nothing else numeric',
          same(sb.calls.map(columnOf).sort(), cols.slice().sort()),
          sb.calls.map(function(q){ return q.select; }).join(' | '));
    check('each query orders by its own column, highest first, then by name',
          sb.calls.every(function(q){
            return same(q.orders, [[columnOf(q), 'desc'], ['display_name', 'asc']]);
          }), JSON.stringify(sb.calls.map(function(q){ return q.orders; })));
    check('each query stops at the top twenty',
          sb.calls.every(function(q){ return q.limit === 20; }) && page.LB_TOP === 20);

    var drawn = {};
    Object.keys(page.LB_VISIONS).forEach(function(k){
      drawn[k] = page.panel(k).children.map(function(r){ return r.person.name + ':' + r.person.rating; });
    });
    check('the Sighted panel reads rating',
          same(drawn.sighted, ['Kasper21:2809', 'Velmor:2742', 'Jaden:1200']), drawn.sighted.join(' '));
    check('the Complete Blindfold panel reads complete_blindfold_rating',
          same(drawn.total, ['Velmor:2474', 'Kasper21:2455', 'Jaden:100']), drawn.total.join(' '));
    check('the Board Only panel reads board_only_rating',
          same(drawn.blind, ['Velmor:2762', 'Kasper21:2631', 'Jaden:100']), drawn.blind.join(' '));
    check('the Fog of War panel reads fog_of_war_rating',
          same(drawn.fog, ['Kasper21:2673', 'Velmor:2523', 'Jaden:100']), drawn.fog.join(' '));
    check('the same player stands at four different numbers',
          new Set([drawn.sighted[0], drawn.total[1], drawn.blind[1], drawn.fog[0]]).size === 4);
    check('places are the order the rows arrived in, from one',
          same(page.panel('fog').children.map(function(r){ return r.place; }), [1, 2, 3]));
    check('rows keep their ids, so one of them can be marked as yours',
          page.panel('fog').children[0].person.id === 'k');
    check('the vision captions count their rows; the Sighted caption is the markup\'s',
          page.cap('total') === '3 players' && page.cap('fog') === '3 players' && page.cap('sighted') === null,
          [page.cap('total'), page.cap('sighted')].join(' / '));
  }

  say('\nA column that does not exist');
  {
    var page2 = fresh();
    var sb2 = fakeSb(function(q){
      if (columnOf(q) === 'rating') return everything(q);
      return { data: null, error: { code: '42703',
               message: 'column profiles.' + columnOf(q) + ' does not exist' } };
    });
    page2.setSb(sb2); page2.settle();
    page2.load();
    await tick();
    var want = 'This ladder needs supabase-migrate-visions.sql to be run.';
    ['total', 'blind', 'fog'].forEach(function(k){
      var last = page2.panel(k).last;
      check(k + ' says which file it is waiting for',
            last && last.note === want && last.bad === true, last && last.note);
      check(k + ' does not pretend to have loaded',
            page2.LB[k].rows === null && page2.cap(k) === '');
    });
    check('the Sighted ladder is up regardless',
          page2.panel('sighted').children.length === 3 && !page2.LB.sighted.error);
    check('the message is the column code, not a guess at the text',
          page2.LB.total.error === want);
  }

  say('\nEvery other error is shown as itself');
  {
    var page3 = fresh();
    page3.setSb(fakeSb(function(q){
      if (columnOf(q) === 'fog_of_war_rating') return { data: null, error: { code: 'PGRST301', message: 'JWT expired' } };
      return everything(q);
    }));
    page3.settle();
    page3.load();
    await tick();
    check('a real database error is printed, not hidden',
          page3.LB.fog.error === 'Could not load the leaderboard — JWT expired', page3.LB.fog.error);
    check('and the panel shows it as an error', page3.panel('fog').last.bad === true);
    check('the other three are untouched by it',
          ['sighted', 'total', 'blind'].every(function(k){ return page3.panel(k).children.length === 3; }));
  }

  say('\nNo client');
  {
    var page4 = fresh();
    page4.load();
    ['sighted', 'fog'].forEach(function(k){
      check(k + ' says nothing while the client is still being imported',
            page4.LB[k].error === '' && page4.panel(k).last.note === 'Loading the ladder…');
    });
    page4.settle();
    page4.load();
    check('and says so once it is known there will be no client',
          page4.LB.total.error === 'The leaderboard needs the account server, and it is not reachable right now.'
          && page4.panel('total').last.bad === true);
  }

  say('\nAn empty ladder, and a late answer');
  {
    var page5 = fresh();
    page5.setSb(fakeSb(function(){ return { data: [], error: null }; }));
    page5.settle();
    page5.load();
    await tick();
    check('an empty ladder is said to be empty, not broken',
          page5.panel('blind').last.note === 'Nobody is rated on this ladder yet.' && !page5.panel('blind').last.bad
          && page5.cap('blind') === '0 players');

    var page6 = fresh(), release;
    var first = new Promise(function(r){ release = r; });
    var n = 0;
    page6.setSb({ from: function(){
      var q = {};
      var chain = { select: function(){ return chain; }, order: function(){ return chain; },
                    limit: function(){ return (++n === 1) ? first : Promise.resolve({ data: [ROWS[2]], error: null }); } };
      return chain;
    } });
    page6.settle();
    page6.loadOne('fog');               // the slow one
    page6.loadOne('fog');               // the one that answers first
    await tick();
    release({ data: [ROWS[0], ROWS[1]], error: null });
    await tick();
    check('an answer to an earlier read never lands over a later one',
          same(page6.panel('fog').children.map(function(r){ return r.person.name; }), ['Jaden']),
          JSON.stringify(page6.panel('fog').children.map(function(r){ return r.person.name; })));
  }

  say('\nSigning in redraws what is up and nothing else');
  {
    var page7 = fresh();
    page7.setSb(fakeSb(function(q){
      if (columnOf(q) === 'board_only_rating') return { data: null, error: { code: '42703', message: 'column profiles.board_only_rating does not exist' } };
      return everything(q);
    }));
    page7.settle();
    page7.load();
    await tick();
    page7.redraw();
    check('a ladder with rows is drawn again', page7.panel('fog').children.length === 3);
    check('a ladder in error still says so',
          page7.panel('blind').last.note === 'This ladder needs supabase-migrate-visions.sql to be run.');
  }

  say('\nOne set of columns, three files');
  {
    check('the fixture is gone from the page',
          SRC.indexOf('LB_BOARDS') === -1 && SRC.indexOf('renderStaticBoards') === -1);
    var py = fs.readFileSync(path.join(ROOT, 'server', 'supabase_db.py'), 'utf8');
    var pyMap = {};
    var block = py.match(/VISION_COLUMNS = \{[\s\S]*?\n\}/);
    check('supabase_db.py names its columns', !!block);
    (block ? block[0] : '').replace(/"(\w+)":\s*"(\w+)"/g, function(_, k, v){ pyMap[k] = v; return ''; });
    var page8 = fresh(), pageMap = {};
    Object.keys(page8.LB_VISIONS).forEach(function(k){ pageMap[k] = page8.LB_VISIONS[k].column; });
    check('the page and the server agree on every vision\'s column', same(pageMap, pyMap),
          JSON.stringify(pageMap) + ' vs ' + JSON.stringify(pyMap));
    var sql = fs.readFileSync(path.join(ROOT, 'supabase-migrate-visions.sql'), 'utf8');
    ['total', 'blind', 'fog'].forEach(function(k){
      var col = pageMap[k];
      check('the migration adds ' + col + ' shaped like rating',
            sql.indexOf('add column if not exists ' + col + ' integer not null default 100') !== -1);
      check('and record_rated_game moves ' + col + ' for \'' + k + '\'',
            new RegExp("when '" + k + "'\\s+then '" + col + "'").test(sql));
    });
    check('and moves rating for a Sighted game', /when 'sighted' then 'rating'/.test(sql));
  }

  say('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
}

main().catch(function(err){ say('FAIL  ' + (err.stack || err)); process.exit(1); });
