#!/usr/bin/env node
/* Where a game starts, when it is meant to look like chess.
 *
 * The generator's own opening is four to six plies picked at random, weighted
 * towards moves that "look like chess". That is enough to stop the corpus
 * being four openings deep, and it is not enough for an *Opening* puzzle: the
 * standard asks that the opponent's mistake be one a person might plausibly
 * make, and a mistake made on move nine of a position nobody has ever played
 * fails that before the engine is even consulted. It also fails the quieter
 * half of the same requirement — a player learns an opening mistake by
 * recognising the structure it happened in.
 *
 * So these are mainlines. Ordinary ones, deliberately: no traps, no gambits
 * chosen for their tactics, nothing picked because it tends to blow up. The
 * point is to hand the bots a normal position and let them go wrong on their
 * own, because a mistake that was engineered is not evidence of anything.
 *
 * Written in the notation people read, and converted through the page's own
 * move generator at load time — so a typo is a crash here rather than a
 * position in the corpus that no opening ever reached.
 *
 * Not an import. These are the first few moves of the openings any book lists;
 * no game, no puzzle and no analysis has been taken from anywhere.
 */

'use strict';

const P = require('./page_chess.js');

const LINES = {
  'Ruy Lopez, Closed':      'e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 d6 c3 O-O',
  'Ruy Lopez, Open':        'e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Nxe4 d4 b5 Bb3 d5',
  'Ruy Lopez, Berlin':      'e4 e5 Nf3 Nc6 Bb5 Nf6 O-O Nxe4 d4 Nd6 Bxc6 dxc6 dxe5 Nf5',
  'Ruy Lopez, Exchange':    'e4 e5 Nf3 Nc6 Bb5 a6 Bxc6 dxc6 O-O f6 d4 exd4',
  'Italian, Giuoco Pianissimo': 'e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d3 d6 O-O O-O',
  'Italian, Two Knights':   'e4 e5 Nf3 Nc6 Bc4 Nf6 d3 Bc5 c3 d6 O-O a6',
  'Scotch':                 'e4 e5 Nf3 Nc6 d4 exd4 Nxd4 Bc5 Be3 Qf6 c3 Nge7',
  'Four Knights':           'e4 e5 Nf3 Nc6 Nc3 Nf6 Bb5 Bb4 O-O O-O d3 d6',
  'Petroff':                'e4 e5 Nf3 Nf6 Nxe5 d6 Nf3 Nxe4 d4 d5 Bd3 Be7',
  'Vienna':                 'e4 e5 Nc3 Nf6 Bc4 Nc6 d3 Bb4 Nge2 d5',
  'Sicilian, Najdorf':      'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 Be2 e5',
  'Sicilian, Dragon':       'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 g6 Be3 Bg7',
  'Sicilian, Sveshnikov':   'e4 c5 Nf3 Nc6 d4 cxd4 Nxd4 Nf6 Nc3 e5 Ndb5 d6',
  'Sicilian, Taimanov':     'e4 c5 Nf3 e6 d4 cxd4 Nxd4 Nc6 Nc3 Qc7 Be3 a6',
  'Sicilian, Closed':       'e4 c5 Nc3 Nc6 g3 g6 Bg2 Bg7 d3 d6 Be3 e6',
  'Sicilian, Moscow':       'e4 c5 Nf3 d6 Bb5+ Bd7 Bxd7+ Qxd7 O-O Nc6 c3 Nf6',
  'French, Winawer':        'e4 e6 d4 d5 Nc3 Bb4 e5 c5 a3 Bxc3+ bxc3 Ne7',
  'French, Tarrasch':       'e4 e6 d4 d5 Nd2 Nf6 e5 Nfd7 Bd3 c5 c3 Nc6',
  'French, Advance':        'e4 e6 d4 d5 e5 c5 c3 Nc6 Nf3 Qb6 Be2 Nge7',
  'French, Exchange':       'e4 e6 d4 d5 exd5 exd5 Nf3 Nf6 Bd3 Bd6 O-O O-O',
  'Caro-Kann, Classical':   'e4 c6 d4 d5 Nc3 dxe4 Nxe4 Bf5 Ng3 Bg6 h4 h6',
  'Caro-Kann, Advance':     'e4 c6 d4 d5 e5 Bf5 Nf3 e6 Be2 c5 Be3 Nd7',
  'Caro-Kann, Panov':       'e4 c6 d4 d5 exd5 cxd5 c4 Nf6 Nc3 e6 Nf3 Be7',
  'Scandinavian':           'e4 d5 exd5 Qxd5 Nc3 Qa5 d4 Nf6 Nf3 c6 Bc4 Bf5',
  'Pirc':                   'e4 d6 d4 Nf6 Nc3 g6 Nf3 Bg7 Be2 O-O O-O c6',
  'QGD, Orthodox':          'd4 d5 c4 e6 Nc3 Nf6 Bg5 Be7 e3 O-O Nf3 h6',
  'QGD, Exchange':          'd4 d5 c4 e6 Nc3 Nf6 cxd5 exd5 Bg5 c6 e3 Be7',
  'QGD, Bf4':               'd4 d5 c4 e6 Nf3 Nf6 Nc3 Be7 Bf4 O-O e3 c5',
  'Queen’s Gambit Accepted': 'd4 d5 c4 dxc4 Nf3 Nf6 e3 e6 Bxc4 c5 O-O a6',
  'Slav':                   'd4 d5 c4 c6 Nf3 Nf6 Nc3 dxc4 a4 Bf5 e3 e6',
  'Semi-Slav':              'd4 d5 c4 c6 Nc3 Nf6 e3 e6 Nf3 Nbd7 Bd3 dxc4',
  'Nimzo-Indian, Rubinstein': 'd4 Nf6 c4 e6 Nc3 Bb4 e3 O-O Bd3 d5 Nf3 c5',
  'Nimzo-Indian, Classical':  'd4 Nf6 c4 e6 Nc3 Bb4 Qc2 O-O a3 Bxc3+ Qxc3 b6',
  'Queen’s Indian':    'd4 Nf6 c4 e6 Nf3 b6 g3 Bb7 Bg2 Be7 O-O O-O',
  'King’s Indian, Classical': 'd4 Nf6 c4 g6 Nc3 Bg7 e4 d6 Nf3 O-O Be2 e5',
  'King’s Indian, Sämisch': 'd4 Nf6 c4 g6 Nc3 Bg7 e4 d6 f3 O-O Be3 e5',
  'Grünfeld':          'd4 Nf6 c4 g6 Nc3 d5 cxd5 Nxd5 e4 Nxc3 bxc3 Bg7',
  'Catalan':                'd4 Nf6 c4 e6 g3 d5 Bg2 Be7 Nf3 O-O O-O dxc4',
  'London, d5':             'd4 d5 Bf4 Nf6 e3 e6 Nf3 Bd6 Bg3 O-O Bd3 c5',
  'London, KID setup':      'd4 Nf6 Bf4 g6 e3 Bg7 Nf3 O-O Be2 d6 h3 c5',
  'English, Reversed Sicilian': 'c4 e5 Nc3 Nf6 Nf3 Nc6 g3 d5 cxd5 Nxd5',
  'English, Symmetrical':   'c4 c5 Nf3 Nf6 Nc3 Nc6 g3 g6 Bg2 Bg7 O-O O-O'
};

/* One move in notation, resolved against the position.
 *
 * Not a string comparison against toSAN(). Books disambiguate more than they
 * strictly have to — Nge2 where the other knight happens to be pinned, so the
 * page correctly writes Ne2 — and a matcher that demands the two spellings
 * agree rejects perfectly ordinary book moves. So the word is taken apart and
 * matched on what it actually constrains: which piece, where to, and whichever
 * of file or rank it bothered to specify. Ambiguity that survives that is a
 * genuine error and says so. */
function matchSAN(st, all, word){
  const w = word.replace(/[+#!?]/g, '');
  if (w === 'O-O' || w === 'O-O-O'){
    const side = w === 'O-O' ? 6 : 2;                    // king's file after castling
    return all.find(m => m.p.t === 'K' && Math.abs(P.colOf(m.to) - P.colOf(m.from)) === 2 &&
                         P.colOf(m.to) === side);
  }
  const promo = (w.match(/=([QRBN])$/) || [])[1] || null;
  const body = w.replace(/=([QRBN])$/, '');
  const dest = body.slice(-2);
  let to = -1;
  for (let i = 0; i < 64; i++) if (P.sqName(i) === dest){ to = i; break; }
  if (to < 0) return null;
  const head = body.slice(0, -2);
  const piece = /^[KQRBN]/.test(head) ? head[0] : 'P';
  const hint = (/^[KQRBN]/.test(head) ? head.slice(1) : head).replace('x', '');
  const cands = all.filter(m =>
    m.to === to && m.p.t === piece &&
    (promo ? m.promo === promo : !m.promo) &&
    (!hint || hint.split('').every(c =>
      /[a-h]/.test(c) ? P.FILES[P.colOf(m.from)] === c : String(8 - P.rowOf(m.from)) === c)));
  return cands.length === 1 ? cands[0] : null;
}

/** A whole line to uci, through the page's own generator, or throw saying where. */
function convert(name, san){
  let st = P.newState();
  const out = [];
  for (const word of san.trim().split(/\s+/)){
    const all = P.legalMoves(st, st.turn);
    const m = matchSAN(st, all, word);
    if (!m) throw new Error('opening_book: "' + name + '" — cannot play ' + word +
                            ' after ' + (out.length ? out.join(' ') : 'the first move'));
    out.push(P.uciOf(m));
    st = P.makeMove(st, m);
  }
  return out;
}

const BOOK = Object.entries(LINES).map(([name, san]) => ({ name, moves: convert(name, san) }));

/* A line, cut somewhere sensible.
 *
 * Not always the whole thing: stopping at a random point between six plies and
 * the end is what stops every Ruy Lopez game in the corpus starting from the
 * same position, and every cut is still a real position from a real opening.
 * Six is the floor because below it the opening has not committed to anything
 * and the position is no more recognisable than a random one. */
function bookLine(rnd){
  const line = BOOK[(rnd() * BOOK.length) | 0];
  const most = line.moves.length;
  const take = 6 + ((rnd() * (most - 5)) | 0);
  return { name: line.name, moves: line.moves.slice(0, Math.min(take, most)) };
}

module.exports = { BOOK, LINES, bookLine, convert, matchSAN };

if (require.main === module){
  console.log(BOOK.length + ' lines, all legal:');
  let min = 99, max = 0;
  for (const l of BOOK){
    min = Math.min(min, l.moves.length); max = Math.max(max, l.moves.length);
  }
  console.log('  plies ' + min + '-' + max);
  for (const l of BOOK) console.log('  ' + l.name.padEnd(30) + l.moves.length + '  ' + l.moves.join(' '));
}
