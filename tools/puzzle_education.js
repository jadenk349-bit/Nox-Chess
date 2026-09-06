/* Teaching the puzzle card to speak in chess concepts.
 *
 * puzzle_words.js says what happened: it captures, it checks, the next best
 * move only leaves you slightly better. That is true and it is not education —
 * a player who reads it learns this position and nothing transferable. The
 * Education System knows what the position is *about*: that this is a fork,
 * what a fork is, and the two ways a fork fails. This file is the join.
 *
 * Three rules govern the join, and all three exist because the failure mode
 * here is so easy and so bad.
 *
 * **The line is locked before a word is written.** analyzeWithEducation() is
 * called on the final, verified moves — never on a candidate, never before the
 * payoff extension. An explanation written against a line that later changes
 * is a lie with a plausible provenance, which is worse than an obvious one.
 *
 * **Everything it says goes through auditClaims().** The Education System is
 * careful, but it is careful about *the position it was handed*, and its
 * sentences are written without knowledge of what the rest of the line does.
 * It will say "it leaves the queen on b6 hanging — it can simply be taken",
 * which is a true statement about that position and a false promise if the
 * verified continuation never takes it. That is precisely the bug auditClaims
 * was built for, so education text is appended into the same `why.moves[].text`
 * the audit already reads rather than into a field of its own. One audit, one
 * standard, and no way for a concept sentence to slip past it.
 *
 * **It may decline.** The API refuses to invent a label when nothing fits, and
 * a move with no concept attached simply keeps the sentence puzzle_words wrote.
 * A card that says less is the intended outcome, not a degraded one.
 */

'use strict';

const P = require('./page_chess.js');
const R = require('./puzzle_rules.js');
const WP = require('./win_prob.js');

let EDU = null;
try { EDU = require('../education/lib/analyze.js'); }
catch (e){ EDU = null; }          // a checkout without education/ still verifies

/** Is the Education System available to be asked? */
const ready = () => !!(EDU && typeof EDU.analyzeWithEducation === 'function');

/* How much of a concept record to carry into the file. The whole record is
   several kilobytes and the page has the bundle already; what the card needs
   is the name to show, the wording to read, and the cautions — which are the
   part a player actually learns from, because they are what stops a pattern
   being over-applied. */
function slim(c){
  return {
    id: c.id,
    name: c.name,
    why: c.detector_text || null,
    wording: c.wording || null,
    cautions: (c.cautions || []).map(x => x.text).slice(0, 2),
    confidence: c.confidence || null
  };
}

/**
 * educate(rec, cfg) -> rec, with `why.concepts` and richer per-ply sentences.
 *
 * `rec` must be the locked record: final moves, final eval, final follow-up.
 * Returns the list of concept ids attached, for the run's report.
 */
function educate(rec, cfg){
  if (!ready() || !rec || !rec.why) return [];
  cfg = cfg || {};
  const st0 = P.stateFromFEN(rec.fen);
  const solver = st0.turn;
  const attached = [];
  const seen = new Set();

  const ask = (fen, move, cp) => {
    try {
      return EDU.analyzeWithEducation({
        fen, move,
        // the engine result the card is allowed to lean on, and it is the one
        // the verifier already measured rather than a fresh opinion
        engine: cp === null || cp === undefined ? undefined
              : { eval_cp: Math.round(cp), best_move: move, depth: cfg.verdictDepth || 24 },
        level: cfg.level || 'intermediate',
        depth: cfg.eduDepth || 'normal'
      });
    } catch (e){ return null; }
  };

  /* Every one of the solver's moves. The defence's moves are deliberately not
     analysed for concepts: the Education System would happily name what the
     *opponent's* move is about, and a card that teaches the player the idea
     behind the move they did not play is a card about the wrong game. What the
     defence gets is the sentence defenceSentence() already wrote — that it was
     the toughest try, and how alone it was. */
  let st = st0;
  const cp = (rec.eval || {}).best;
  for (let i = 0; i < rec.moves.length; i++){
    const m = R.uciFind(st, rec.moves[i]);
    if (!m) break;
    const ours = st.turn === solver;
    if (ours && rec.why.moves && rec.why.moves[i]){
      const r = ask(P.fenOf(st), rec.moves[i], i === 0 ? cp : null);
      const ex = r && r.explanation && r.explanation.text;
      /* The wording, not the whole sentence. The API's `text` opens by
         restating the move ("c5 is the engine's first choice"), which the card
         has already said one line above, and closes with observations
         puzzle_words has already made. What is new is the *concept*: its name
         and the sentence that generalises it. */
      const cs = (r && r.concepts || []).filter(c => c.wording && !seen.has(c.id));
      if (cs.length){
        const c = cs[0];
        seen.add(c.id);
        attached.push(c.id);
        rec.why.moves[i].text = (rec.why.moves[i].text || '') + ' ' + c.wording;
        rec.why.moves[i].concept = slim(c);
      } else if (ex && !rec.why.moves[i].text){
        rec.why.moves[i].text = ex;
      }
    }
    st = P.makeMove(st, m);
  }

  /* And the move that was not the answer.
   *
   * "For an important incorrect alternative, explain WHY it is worse." The
   * honest version of that is two facts already in hand — what the runner-up
   * is about, from the Education System, and what it is worth, from the
   * verdict search — placed next to each other. Anything more would be a
   * claim about a line nobody verified, because the runner-up's continuation
   * was never searched past the one comparison that rejected it. */
  const alt = rec.alt;
  if (alt && alt.uci && rec.why.moves && rec.why.moves[0]){
    const r = ask(rec.fen, alt.uci, alt.score);
    const c = (r && r.concepts || []).find(x => x.wording);
    if (c){
      const pct = WP.pctOf(alt.score);
      rec.why.altConcept = Object.assign(slim(c), {
        pct: pct === null ? null : +pct.toFixed(1)
      });
    }
  }

  /* What the position as a whole is about, which is what the player is meant
     to carry away. Read off the puzzle's own starting position rather than off
     any one move, so it survives the line being extended. */
  const whole = ask(rec.fen, rec.moves[0], cp);
  if (whole){
    rec.why.concepts = (whole.concepts || []).filter(c => c.wording).slice(0, 3).map(slim);
    // anything the system itself refused to claim, kept so a reader can see
    // that the silence was deliberate
    if (whole.notes && whole.notes.length) rec.why.eduNotes = whole.notes.slice(0, 3);
    if (whole.phrasing_violations && whole.phrasing_violations.length)
      rec.why.eduPhrasing = whole.phrasing_violations.slice(0, 3);
  }
  return attached;
}

module.exports = { educate, ready, slim };
