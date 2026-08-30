/* Saying why, in a sentence a player can use again.
 *
 * The card at the end of a puzzle used to be describeBest(): the first motif
 * findMotifs() saw, plus the line, plus what it came to. That is the right card
 * for the Study Board, where the player has just played the move themselves and
 * wants to know what they missed. It is not enough for a puzzle, because a
 * puzzle has a premise the review does not — *somebody just went wrong* — and a
 * card that never mentions the mistake leaves the player able to solve the
 * position without ever learning what to look for the next time.
 *
 * So the explanation is written here, once, by the tool that has the engine in
 * front of it, and checked into the file beside the moves. Four things get
 * said, in the order they happened:
 *
 *   mistake   what the opponent's last move gave away
 *   moves     one line per ply — the key move and why it beats the runner-up,
 *             each defence and why it is the toughest, each continuation
 *   point     where the whole thing arrives
 *
 * Everything is read off the board or out of a search the caller already made.
 * Nothing here guesses: a sentence that cannot be justified from a position or
 * a number is not written, and the card is shorter instead. That is the whole
 * discipline of this file — it is very easy to write a confident sentence about
 * a deflection that is not on the board, and a puzzle set that does it once is
 * a puzzle set nobody can trust the rest of.
 */

'use strict';

const P = require('./page_chess.js');
const R = require('./puzzle_rules.js');

/* ------------------------------------------------------------- numbers */

/* Evaluations, in the words a player uses. There is no UCI_ShowWDL in this
   build, so there is no honest win percentage to quote and the bands have to
   carry the meaning instead. They are deliberately coarse: the difference
   between +410 and +460 is not something a sentence should pretend to know. */
function cpWord(v){
  if (v === null || v === undefined) return null;
  if (R.isMate(v)) return v > 0 ? 'forced mate' : 'a forced loss';
  if (v >= 900) return 'completely winning';
  if (v >= 400) return 'winning';
  if (v >= 150) return 'clearly better';
  if (v >= 60)  return 'slightly better';
  if (v > -60)  return 'level';
  if (v > -150) return 'slightly worse';
  if (v > -400) return 'clearly worse';
  if (v > -900) return 'losing';
  return 'completely lost';
}

const sideWord = c => (c === P.W ? 'White' : 'Black');
const theirWord = c => (c === P.W ? 'Black' : 'White');
const pieceWord = t => P.PIECE_WORD[t];

/** SAN for a uci move in a position, and the position after it. */
function step(st, uci){
  const all = P.legalMoves(st, st.turn);
  const m = all.find(x => P.uciOf(x) === uci);
  if (!m) return null;
  return { m, san: P.toSAN(st, m, all), next: P.makeMove(st, m) };
}

/** Every move of a line in notation, or as far as it will replay. */
function sansOf(st, moves){
  const out = [];
  let s = st;
  for (const u of moves){
    const t = step(s, u);
    if (!t) break;
    out.push(t.san);
    s = t.next;
  }
  return out;
}

/* --------------------------------------------------- what went wrong
 *
 * The opponent's move, and what it cost — read by comparing the two positions
 * either side of it rather than by asking the engine what it would rather have
 * played. "You should have played Nf6" tells the player nothing they can use;
 * "the knight was the only thing guarding h7" tells them what to look at.
 *
 * The candidates are tried in order of how much they explain, and the first
 * one that is actually on the board is the one that gets said. If none of them
 * is, the eval sentence goes out on its own — which is honest, and rarer than
 * it sounds.
 */
function whatWentWrong(before, prev, after, solver, keyMove){
  const them = P.other(solver);
  const moved = after.b[prev.to];
  const from = P.sqName(prev.from), to = P.sqName(prev.to);

  /* Taking something and leaving the piece there. The refutation of a capture
     is often not the recapture — the in-between move is — so this is said
     before anything about guards, and it is said without claiming what the
     answer is: the key move's own sentence names the recapture and says what
     it is worth, which is where that belongs. */
  if (prev.cap && keyMove && keyMove.to !== prev.to && P.see(after, prev.to, solver) > 0)
    return 'It takes on ' + to + ' and leaves the ' + pieceWord(prev.p.t) +
           ' there to be recaptured.';

  /* The guard that walked away. The strongest thing to be able to say, and the
     one a player can generalise from: did the square the solution lands on stop
     being defended when this piece left? Not asked when the piece moved *onto*
     that square — it did not abandon f2 by going to f2, and the loose-piece
     branch below has the right words for that. */
  if (keyMove && prev.to !== keyMove.to){
    const t = keyMove.to;
    const guardedBefore = P.defendersOf(before, t, them).indexOf(prev.from) >= 0 ||
                          P.attackersOf(before, t, them).indexOf(prev.from) >= 0;
    const guardedAfter = P.attackersOf(after, t, them).length;
    if (guardedBefore && !guardedAfter)
      return 'Moving the ' + pieceWord(prev.p.t) + ' from ' + from + ' took the last guard off ' +
             P.sqName(t) + '.';
    if (guardedBefore && P.attackersOf(before, t, them).length > guardedAfter)
      return 'The ' + pieceWord(prev.p.t) + ' on ' + from + ' was covering ' + P.sqName(t) +
             ', and ' + to + ' is not.';
  }

  /* Walked into it. The queen that steps to g6 is not attacked on g6 until the
     rook comes to g1, so this is asked of the position *after* the answer —
     which is where the mistake becomes visible, and is exactly why it was not
     visible when it was played. */
  if (keyMove){
    const hit = P.makeMove(after, keyMove);
    const p2 = hit.b[prev.to];
    if (p2 && p2.c === them && P.see(hit, prev.to, solver) > 0 &&
        P.attackersOf(hit, prev.to, solver).indexOf(keyMove.to) >= 0)
      return 'It moves the ' + pieceWord(p2.t) + ' to ' + to +
             ', which does not turn out to be a safe square.';
  }

  /* The square it stepped off. When the solution's move lands exactly where
     the opponent's piece was standing, what the move gave away was the square
     rather than anything on the board — the hardest kind of mistake to see
     afterwards, and the one a loose pawn somewhere else would otherwise get
     the credit for. */
  if (keyMove && keyMove.to === prev.from)
    return 'Moving the ' + pieceWord(prev.p.t) + ' off ' + from + ' hands that square over.';

  /* Something left where it can be taken — either the piece that just moved,
     or one it was looking after. Only what this move changed: a piece that was
     already loose is not the reason the move was bad. */
  let loose = null;
  for (let i = 0; i < 64; i++){
    const p = after.b[i];
    if (!p || p.c !== them || p.t === 'K') continue;
    if (P.see(before, i, solver) > 0) continue;
    const win = P.see(after, i, solver);
    if (win > 0 && (!loose || win > loose.win)) loose = { sq:i, p, win };
  }
  if (loose){
    if (loose.sq === prev.to)
      return 'It puts the ' + pieceWord(loose.p.t) + ' on ' + to + ' where it can simply be taken.';
    return 'It leaves the ' + pieceWord(loose.p.t) + ' on ' + P.sqName(loose.sq) + ' undefended.';
  }

  /* The king's air. A pawn move in front of a castled king, or any move that
     lets another attacker onto the squares around it. Only worth saying when
     the king did not itself move, since a king that walked somewhere worse is
     a different sentence and one of the branches above has usually said it. */
  const k = P.kingSq(after, them);
  if (k >= 0 && P.kingSq(before, them) === k){
    const ring = st => {
      let n = 0;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++){
        const r = P.rowOf(k) + dr, c = P.colOf(k) + dc;
        if (P.onBoard(r, c)) n += P.attackersOf(st, r*8+c, solver).length;
      }
      return n;
    };
    if (ring(after) > ring(before))
      return 'It opens lines towards the king on ' + P.sqName(k) + '.';
  }

  return null;
}

/* --------------------------------------------------------- the key move
 *
 * findMotifs() is what names the tactic, here as in the review and as in the
 * generator's themes, so a puzzle tagged "fork" is explained with the word
 * fork. What is added on top of it is the half a puzzle needs and a review does
 * not: why the move that looks right is not the move.
 */
function keySentence(st, m, after, solver, alt){
  const bits = [];
  const them = P.other(solver);
  const mated = !P.legalMoves(after, after.turn).length && P.inCheck(after, after.turn);

  if (mated) bits.push('It is checkmate.');
  else {
    const motif = P.findMotifs(st, m, after, solver).find(x => x.tag !== 'mate');
    if (motif) bits.push(motif.text);
    if (P.inCheck(after, them)) bits.push('It comes with check, so the reply is not a free move.');
    // net of the capture: a bishop handed over for a queen is not a sacrifice
    const sac = P.sacrificeSize(st, m, after) - (m.cap ? P.VAL[m.cap.t] : 0);
    if (sac >= 200)
      bits.push('It gives up ' + P.materialWord(sac) + ' first, which is why it is easy to reject.');
    else if (m.cap) bits.push('It wins the ' + pieceWord(m.cap.t) + '.');
    if (m.promo) bits.push('The pawn becomes a ' + pieceWord(m.promo) + '.');
  }

  /* And the runner-up, by name. This is the sentence that makes the puzzle a
     puzzle rather than a quiz: there was a second move, it was reasonable, and
     it is not good enough. */
  if (alt && alt.san){
    const w = cpWord(alt.score);
    if (w) bits.push('The next best move, ' + alt.san + ', only leaves ' +
                     sideWord(solver) + ' ' + w + '.');
  }
  return bits.slice(0, 3).join(' ');
}

/* ---------------------------------------------------------- the defence
 *
 * Rule 5, said out loud on the card. A solution that works because the
 * opponent helps is not a solution, so the file records that this reply was
 * the engine's own — and, where the search said so, that there was nothing
 * else. `forced` is the count of legal replies; `clear` is how far the best
 * one beat the next, from the defender's side.
 */
function defenceSentence(st, m, after, solver, info){
  const them = P.other(solver);
  // how many answers there were is a fact about the board, so it is counted
  // here rather than trusted from the file: a repaired line's stored notes
  // describe the line it replaced
  if (P.legalMoves(st, them).length === 1)
    return 'Forced — it is the only legal move.';
  const bits = [];
  if (P.inCheck(st, them)) bits.push('The king is in check and has to answer it.');
  if (m.cap) bits.push('It takes the ' + pieceWord(m.cap.t) + ' back.');
  /* How alone this defence was, from the *defender's* side. Said without
     claiming the defender is lost: half of this set is a rescue, where the
     opponent is holding a position they were winning a move ago, and "the rest
     lose too" would be false of exactly those. */
  if (info && info.clear !== null && info.clear !== undefined && info.clear >= 200)
    bits.push('Everything else is clearly worse for them.');
  else bits.push('It is the toughest try — nothing else does better.');
  return bits.slice(0, 2).join(' ');
}

/* ------------------------------------------------------- and the point */

/* What the solver's pieces would still lose if the line stopped here. A
   solution that ends by taking a queen with a bishop has won a queen on the
   board and is about to give the bishop back, and "you come out a queen up" is
   then a sentence the follow-up immediately contradicts. */
function hanging(st, solver){
  let worst = 0;
  const them = P.other(solver);
  for (let i = 0; i < 64; i++){
    const p = st.b[i];
    if (!p || p.c !== solver || p.t === 'K') continue;
    const cost = P.see(st, i, them);
    if (cost > worst) worst = cost;
  }
  return worst;
}

function pointSentence(startSt, endSt, solver, endScore, follow){
  const bits = [];
  const gain = P.materialFor(endSt, solver) - P.materialFor(startSt, solver) -
               (endSt.turn === solver ? 0 : hanging(endSt, solver));
  const mated = !P.legalMoves(endSt, endSt.turn).length && P.inCheck(endSt, endSt.turn);

  if (mated) return endSt.turn === solver ? 'That is mate against you.' : 'That is checkmate.';
  if (R.isMate(endScore) && endScore > 0) return 'Mate is forced from here.';

  const w = cpWord(endScore);
  const me = sideWord(solver);
  const won = gain >= 90 ? me + ' comes out ' + P.materialWord(gain) + ' up'
            : gain <= -90 ? me + ' is ' + P.materialWord(-gain) + ' down on material'
            : null;

  /* Material and evaluation can disagree, and when they do the disagreement is
     the interesting part: a piece up and only slightly better means the
     opponent has something for it, which is worth a player noticing rather than
     being told twice in two sentences that contradict each other. */
  if (!won) return w ? 'The engine calls the position ' + w + ' for ' + me + '.' : '';
  if (!w) return won + '.';
  const agrees = (gain >= 90 && endScore >= 400) || (gain <= -90 && endScore <= -400);
  return agrees ? won + ', and the engine calls the position ' + w + '.'
                : won + ', though the engine calls the position only ' + w + '.';
}

/* ------------------------------------------------------------ assembled
 *
 * explain(rec) -> { mistake, moves:[…], point }
 *
 * `rec` is the puzzle as the tool has it: fen, moves, the position and move
 * before it, the runner-up, the per-reply search notes, and the score the line
 * arrives at. Everything optional is genuinely optional — a record without a
 * previous position simply gets no mistake sentence.
 */
function explain(rec){
  const st0 = P.stateFromFEN(rec.fen);
  const solver = st0.turn;
  const out = { moves: [] };

  const first = step(st0, rec.moves[0]);
  if (!first) return out;

  /* the mistake */
  if (rec.prev && rec.prev.fen && rec.prev.move){
    const bst = P.stateFromFEN(rec.prev.fen);
    const pm = step(bst, rec.prev.move);
    if (pm){
      /* Two sentences, and the move is named in exactly one of them. What went
         wrong is the sentence worth reading — the numbers only say how much —
         so when the board can be made to explain itself the eval line drops to
         a second line under it, and when it cannot, the eval line is promoted
         and carries the naming instead. Saying "White played Rxd7" twice is
         what the obvious arrangement does. */
      const said = theirWord(solver) + ' played ' + pm.san + '.';
      const e = rec.eval || {};
      const swing = (e.before !== null && e.before !== undefined &&
                     e.best !== null && e.best !== undefined)
        ? 'The position was ' + cpWord(e.before) + ' for ' + sideWord(solver) +
          ' before it and is ' + cpWord(e.best) + ' after it, with best play.'
        : null;
      const why = whatWentWrong(bst, pm.m, st0, solver, first.m);
      out.mistake = why ? said + ' ' + why : (swing ? said + ' ' + swing : said);
      out.swing = why ? swing : null;
    }
  }

  /* every ply */
  let st = st0;
  for (let i = 0; i < rec.moves.length; i++){
    const t = step(st, rec.moves[i]);
    if (!t) break;
    const ours = (i % 2) === 0;
    const info = (rec.replies && rec.replies[i]) || null;
    let text;
    if (ours && i === 0){
      const alt = rec.alt && rec.alt.uci ? {
        san: (step(st0, rec.alt.uci) || {}).san,
        score: rec.alt.score
      } : null;
      text = keySentence(st, t.m, t.next, solver, alt);
    } else if (ours){
      text = keySentence(st, t.m, t.next, solver, null);
    } else {
      text = defenceSentence(st, t.m, t.next, solver, info);
    }
    out.moves.push({ san: t.san, uci: rec.moves[i], by: ours ? 'you' : 'them', text });
    st = t.next;
  }

  /* and where it arrives */
  out.point = pointSentence(st0, st, solver,
                            rec.eval ? rec.eval.end : null,
                            rec.follow);
  return out;
}

/* ------------------------------------------------- does the card tell the truth?
 *
 * A card said "it leaves the rook on b7 hanging — it can simply be taken", and
 * the verified follow-up never took it. Both halves were produced honestly:
 * findMotifs() reported a fact about the position after the move, and the
 * follow-up reported best play, and best play had better things to do. The
 * card put them next to each other and the reader drew the obvious conclusion,
 * which was false.
 *
 * That is the whole class of bug this guards. A sentence about a *threat* is
 * fine; a sentence a reader will take as a *promise* has to be kept, and the
 * only thing entitled to make promises is the position the line actually
 * reaches. So every claim the card makes about winning material is checked
 * against the board at the end of the solution and, where there is one, the
 * end of the follow-up — and a claim that does not survive is removed rather
 * than softened, because a hedged false sentence is still a false sentence.
 *
 * Returns the list of claims it had to strike, so a run can report them.
 */

const PIECE_OF = { pawn:'P', knight:'N', bishop:'B', rook:'R', queen:'Q' };

/** Where the line — solution, and the follow-up if there is one — arrives. */
function finalPosition(rec){
  let st = P.stateFromFEN(rec.fen);
  const walk = list => {
    for (const u of list || []){
      const t = step(st, u);
      if (!t) return false;
      st = t.next;
    }
    return true;
  };
  if (!walk(rec.moves)) return null;
  const solutionEnd = st;
  walk((rec.follow || {}).moves);
  return { solutionEnd, end: st };
}

/**
 * auditClaims(rec) -> [{ where, claim, why }]
 *
 * `rec.why` is edited in place: anything that cannot be justified is cut.
 */
function auditClaims(rec){
  const struck = [];
  const w = rec.why;
  if (!w) return struck;
  const pos = finalPosition(rec);
  if (!pos) return struck;
  const start = P.stateFromFEN(rec.fen);
  const solver = start.turn;
  const them = P.other(solver);

  // what the whole line actually won, counted where it ends and net of
  // anything of ours still hanging there
  const won = R.banked(rec.fen, pos.end, solver);
  const mated = !P.legalMoves(pos.end, pos.end.turn).length &&
                P.inCheck(pos.end, pos.end.turn) && pos.end.turn === them;
  // and which of their pieces are actually gone by the end
  const before = {}, after = {};
  for (const b of P.stateFromFEN(rec.fen).b) if (b && b.c === them) before[b.t] = (before[b.t] || 0) + 1;
  for (const b of pos.end.b) if (b && b.c === them) after[b.t] = (after[b.t] || 0) + 1;
  const captured = t => (before[t] || 0) > (after[t] || 0);

  const cut = (bucket, i, text, why) => {
    struck.push({ where: bucket + (i === undefined ? '' : '[' + i + ']'), claim: text, why });
  };

  /* Sentence by sentence. Each test is "would a reader take this as a promise,
     and was it kept" — never "does the wording look risky". */
  const check = (text, bucket, i) => {
    if (!text) return text;
    const keep = [];
    for (const sentence of text.split(/(?<=\.)\s+/)){
      const low = sentence.toLowerCase();
      let bad = null;

      // "it leaves the rook on b7 hanging — it can simply be taken"
      const hang = low.match(/leaves the (pawn|knight|bishop|rook|queen) on ([a-h][1-8]) hanging/);
      if (hang && !captured(PIECE_OF[hang[1]]) && !mated)
        bad = 'the ' + hang[1] + ' on ' + hang[2] + ' is never taken in the line';

      // "it wins the rook"
      const wins = low.match(/wins the (pawn|knight|bishop|rook|queen)/);
      if (!bad && wins && !captured(PIECE_OF[wins[1]]) && !mated)
        bad = 'no ' + wins[1] + ' is captured in the line';

      // "you come out a rook up"
      const up = low.match(/comes out (a queen|a rook|a piece|the exchange|a pawn) up/);
      if (!bad && up){
        const need = { 'a queen':850, 'a rook':450, 'a piece':280, 'the exchange':150, 'a pawn':90 }[up[1]];
        if (won < need) bad = 'only ' + Math.round(won) + 'cp is actually banked';
      }

      // "mate is forced from here" / "that is checkmate"
      if (!bad && /checkmate|mate is forced|forces mate/.test(low) && !mated &&
          !(typeof (rec.follow || {}).mate === 'number' && rec.follow.mate > 0))
        bad = 'no mate is reached or forced in the verified line';

      // "the <piece> on x is trapped — every square it can reach loses it"
      const trap = low.match(/the (pawn|knight|bishop|rook|queen) on ([a-h][1-8]) is trapped/);
      if (!bad && trap && !captured(PIECE_OF[trap[1]]) && !mated)
        bad = 'the trapped ' + trap[1] + ' survives the line';

      if (bad) cut(bucket, i, sentence, bad);
      else keep.push(sentence);
    }
    return keep.join(' ');
  };

  w.mistake = check(w.mistake, 'mistake');
  w.point   = check(w.point, 'point');
  if (Array.isArray(w.moves))
    w.moves.forEach((m, i) => { m.text = check(m.text, 'moves', i); });

  /* A move left with nothing to say is worse than one with a modest sentence,
     so anything stripped bare falls back to the plainly true thing. */
  if (Array.isArray(w.moves)){
    let st = P.stateFromFEN(rec.fen);
    for (let i = 0; i < w.moves.length; i++){
      const t = step(st, w.moves[i].uci);
      if (!t) break;
      if (!w.moves[i].text){
        const ours = st.turn === solver;
        w.moves[i].text = P.inCheck(t.next, P.other(st.turn)) ? 'It gives check.'
          : ours ? 'It is the move the engine plays here.'
                 : 'The engine’s own defence.';
      }
      st = t.next;
    }
  }
  if (!w.point) w.point = pointSentence(P.stateFromFEN(rec.fen), pos.solutionEnd, solver,
                                        (rec.eval || {}).end, rec.follow) || '';
  return struck;
}

module.exports = { explain, auditClaims, finalPosition, cpWord, whatWentWrong, keySentence, defenceSentence,
                   pointSentence, sansOf, step };
