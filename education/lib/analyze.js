'use strict';
/* ============================================================================
 * THE REUSABLE API — analyzeWithEducation()
 *
 * The single entry point other features are meant to call. Everything below is
 * assembly: Layer 3 (lib/features.js) observes, Layer 4 (lib/matchers.js)
 * decides what is licensed, and this file words it and refuses to say things it
 * cannot support.
 *
 * Four refusals are built in, and they are the point of the file:
 *
 *   1. NO FORCED LABEL. If nothing matches, the result says nothing matched.
 *      There is no nearest-concept fallback, because the fallback would be
 *      wrong exactly when the position is unusual — which is when a reader
 *      most needs the truth.
 *   2. NO QUALITY CLAIM WITHOUT AN ENGINE. This system names ideas; Stockfish
 *      decides whether a move works. Without an engine result the API reports
 *      what is on the board and explicitly records that the move was not
 *      assessed.
 *   3. NO BANNED PHRASING. Every concept carries terminology.avoid, and the
 *      generated text is checked against the avoid lists of the concepts it
 *      used. A hit is a bug, and is returned rather than hidden.
 *   4. NO UNHEDGED RULE OF THUMB. Soft knowledge types carry their hedge into
 *      the output, because the whole failure mode this project exists to
 *      prevent is a heuristic read as a law.
 * ========================================================================== */

const fs = require('fs');
const path = require('path');
const FEAT = require('./features.js');
const MATCH = require('./matchers.js');

const ROOT = path.join(__dirname, '..');

let _cache = null;
function knowledge() {
  if (_cache) return _cache;
  const concepts = {};
  const cdir = path.join(ROOT, 'concepts');
  for (const d of fs.readdirSync(cdir)) {
    const sub = path.join(cdir, d);
    if (!fs.statSync(sub).isDirectory()) continue;
    for (const fn of fs.readdirSync(sub)) {
      if (!fn.endsWith('.json')) continue;
      const c = JSON.parse(fs.readFileSync(path.join(sub, fn), 'utf8'));
      concepts[c.id] = c;
    }
  }
  let warnings = { entries: [] };
  const wp = path.join(ROOT, 'state', 'warnings_index.json');
  if (fs.existsSync(wp)) warnings = JSON.parse(fs.readFileSync(wp, 'utf8'));
  _cache = { concepts, warnings };
  return _cache;
}

const LEVELS = ['beginner', 'intermediate', 'advanced', 'master'];
const DEPTHS = ['short', 'normal', 'deep'];

/* Several concept records deliberately write their explanation as a TEMPLATE —
 * "A fork. Because it hits {targets} at once..." — so that a caller can fill in
 * what is true of the position rather than speaking in generalities. That is a
 * good design and a trap: an unfilled slot must never reach a reader. So slots
 * are filled from what Layer 3 actually observed, and any wording still holding
 * a slot afterwards is discarded in favour of something plainer. The API would
 * rather say less than print braces at somebody. */
const SLOT = /\{[^}]*\}/;

function fill(text, slots) {
  if (!text) return null;
  let out = text.replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g,
    (m, k) => (slots && slots[k] != null ? String(slots[k]) : m));
  return out;
}

// Whether the emitted wording is specific to this position is not something to
// infer after the fact. Two earlier attempts got it wrong: asking whether the
// record's PREFERRED wording had slots was wrong because wordFor may fall back
// to a plain sentence, and substring-matching the slot values was wrong because
// a file slot is a single letter that occurs in almost any sentence. So wordFor
// reports what it did.

function wordFor(rec, level, depth, slots) {
  const ex = rec.explanations || {};
  // The OBSERVATION wants the slot-filled, depth-appropriate text: it is the
  // sentence that names the actual square. `level` is answered separately by
  // levelWording() below, because the two axes are different questions - depth
  // is how much to say, level is who is being told - and collapsing them into
  // one lookup is what left `level` dead for the whole life of this API.
  const candidates = [
    depth && (ex.by_depth || {})[depth],
    level && (ex.by_level || {})[level],
    (ex.by_depth || {}).normal,
    (ex.by_level || {}).intermediate,
    rec.definition_short,
  ];
  for (const raw of candidates) {
    if (!raw) continue;
    const filled = fill(raw, slots);
    if (SLOT.test(filled)) continue;          // a slot we could not fill
    return { text: filled, specific: SLOT.test(raw) };
  }
  return { text: null, specific: false };     // nothing this record offers is usable
}

/* The wording written FOR THIS READER, which is a different question from how
 * much to say. Every record carries four of these and until this existed not
 * one of them could reach anybody: `wordFor` tried by_depth first, every record
 * has all three by_depth texts, so by_level was never reached. The API accepts
 * `level`, the README documents it, tests/test_explanations.js says in a comment
 * that "level must be able to" change the wording - and asking for master and
 * for beginner returned the same sentence, on every position, for as long as
 * the API has existed.
 *
 * It feeds the TEACHING half of the explanation rather than the observation,
 * because the observation must name the square and these texts are general. */
function levelWording(rec, level, slots) {
  const byLevel = ((rec.explanations || {}).by_level) || {};
  const raw = level && byLevel[level];
  if (!raw) return null;
  const filled = fill(raw, slots);
  return SLOT.test(filled) ? null : filled;
}

/* Warnings that belong with a concept, strongest evidence first — so a caller
 * showing only one caveat shows the one that is actually demonstrated. */
function cautionsFor(id, warnings) {
  const rank = { demonstrated: 0, 'on-a-tested-record': 1, sourced: 2, unsourced: 3 };
  return (warnings.entries || [])
    .filter(e => e.concept === id && (e.kind === 'false_positive_trap' || e.kind === 'exception'))
    .sort((a, b) => rank[a.evidence_tier] - rank[b.evidence_tier])
    .map(e => ({ kind: e.kind, text: e.text, evidence: e.evidence_tier }));
}

const SOFT = new Set(['rule-of-thumb', 'practical-guideline', 'strategic-principle',
                      'historical-teaching-principle', 'positional-concept']);

/* Refusal 3, enforced rather than intended. */
function auditPhrasing(text, used, concepts) {
  const hits = [];
  const low = text.toLowerCase();
  for (const id of used) {
    for (const bad of ((concepts[id] || {}).terminology || {}).avoid || []) {
      // Only flag bare phrases; a banned phrase is banned as an assertion, and
      // multi-clause entries are guidance to the writer rather than substrings.
      const b = bad.toLowerCase().trim();
      if (b.length >= 6 && b.split(' ').length <= 6 && low.includes(b)) {
        hits.push({ concept: id, phrase: bad });
      }
    }
  }
  return hits;
}

function analyzeWithEducation(opts) {
  const { fen, move = null, line = null, engine = null, level = 'intermediate',
          depth = 'normal', maxConcepts = 6 } = opts || {};
  if (!fen) throw new Error('analyzeWithEducation: a fen is required');
  if (level && !LEVELS.includes(level)) throw new Error('unknown level: ' + level);
  if (depth && !DEPTHS.includes(depth)) throw new Error('unknown depth: ' + depth);

  const { concepts, warnings } = knowledge();
  const notes = [];

  const features = FEAT.features(fen);
  let moveInfo = null, lineInfo = null;
  if (line && line.length) {
    // A combination's motifs are spread across its line. Measured on the shipped
    // corpus, reading only the first move finds 77% of what the puzzle
    // generator independently tagged; reading the line finds 96.5%.
    lineInfo = FEAT.motifsOfLine(fen, line);
    if (!lineInfo.legal) {
      notes.push(`the line becomes illegal at move ${(lineInfo.illegalAt || 0) + 1}; ` +
                 'only the legal prefix was read');
    }
    moveInfo = {
      legal: lineInfo.plies.length > 0,
      san: lineInfo.sanLine[0] || null,
      motifs: lineInfo.motifs,
      fenAfter: lineInfo.fenAfter,
      isLine: true,
      sanLine: lineInfo.sanLine,
    };
  } else if (move) {
    moveInfo = FEAT.motifsOfMove(fen, move);
    if (!moveInfo.legal) notes.push(`the move ${move} is not legal in this position; it was ignored`);
  }

  // Features of the position the move REACHES, so move-based concepts can ask
  // what the move achieved rather than only what was there before it.
  let featuresAfter = null;
  if (moveInfo && moveInfo.legal && moveInfo.fenAfter) {
    try { featuresAfter = FEAT.features(moveInfo.fenAfter); } catch (e) { featuresAfter = null; }
  }
  // Everything licensed, and separately the subset worth showing. The corpus
  // stress test found worst-placed-piece being MATCHED and then sliced off by
  // the display limit, because low-confidence entries sort last — so the system
  // knew the annotated concept applied and the caller could not tell. A display
  // cap must not double as a claim that nothing else was found.
  const matchedAll = MATCH.matchAll(features, moveInfo, concepts, featuresAfter);
  const matched = matchedAll.slice(0, maxConcepts);

  const out = matched.map(m => {
    const rec = concepts[m.concept];
    const cautions = cautionsFor(m.concept, warnings);
    const w = wordFor(rec, level, depth, m.slots);
    const wLevel = levelWording(rec, level, m.slots);
    return {
      id: m.concept,
      name: rec.canonical_name,
      knowledge_type: rec.knowledge_type,
      confidence: m.confidence,
      confidence_capped_from: m.raw_confidence !== m.confidence ? m.raw_confidence : null,
      detected_by: m.source,
      detector_text: m.detector_text || null,
      implements: m.implements,
      because: m.because,
      subjects: m.subjects,
      hedge: SOFT.has(rec.knowledge_type) ? (rec.explanations || {}).hedge || null : null,
      lesson: (rec.explanations || {}).lesson || null,
      cautions: cautions.slice(0, 3),
      wording: w.text,
      wording_specific: w.specific,
      wording_level: wLevel,
      wording_is_templated: SLOT.test(
        ((rec.explanations || {}).by_depth || {})[depth] ||
        ((rec.explanations || {}).by_level || {})[level] || ''),
    };
  });

  if (!out.length) {
    notes.push('no researched concept is licensed by the features of this position — ' +
               'this system says nothing rather than reaching for the nearest label');
  }

  // Refusal 2. The engine is the only thing entitled to say a move is good.
  let assessment = null;
  if (move && engine && typeof engine.eval_cp === 'number') {
    assessment = {
      eval_cp: engine.eval_cp,
      best_move: engine.best_move || null,
      is_best: engine.best_move ? engine.best_move === move : null,
      depth: engine.depth || null,
      engine_id: engine.engine_id || null,
    };
  } else if (move) {
    notes.push('no engine result was supplied, so this analysis makes NO claim about ' +
               'whether the move is good — only about what is on the board');
  }

  const text = compose(features, moveInfo, out, assessment, level, depth);
  if (SLOT.test(text)) {
    notes.push('TEMPLATE BUG: generated text still contains an unfilled slot; ' +
               'this is a bug in the concept wording or in slot filling');
  }
  const phrasing = auditPhrasing(text, out.map(c => c.id), concepts);
  if (phrasing.length) {
    notes.push('PHRASING BUG: generated text matched a banned phrase — ' +
               phrasing.map(h => `${h.concept}: "${h.phrase}"`).join('; '));
  }

  return {
    fen,
    // Every concept the position licensed, in rank order, whether or not it fit
    // the display limit. Callers wanting completeness should read this.
    concepts_all: matchedAll.map(m => ({ id: m.concept, confidence: m.confidence,
                                         detected_by: m.source })),
    side_to_move: features.sideToMove,
    phase: features.phase,
    move: moveInfo && moveInfo.legal
      ? { uci: move, san: moveInfo.san, motifs: moveInfo.motifs, fen_after: moveInfo.fenAfter,
          line: moveInfo.isLine ? moveInfo.sanLine : null,
          plies: lineInfo ? lineInfo.plies.map(p => ({ ply: p.ply, san: p.san,
                    motifs: (p.motifs || []).map(m => m.tag) })) : null }
      : null,
    features,
    concepts: out,
    assessment,
    explanation: { text, level, depth },
    phrasing_violations: phrasing,
    notes,
    provenance: {
      concepts_available: Object.keys(concepts).length,
      warnings_indexed: (warnings.entries || []).length,
      chess_rules: 'blind-chess.html via tools/page_chess.js',
      motif_detector: 'findMotifs() in blind-chess.html',
    },
  };
}

/* ---------------------------------------------------------------------------
 * LAYER 5 — WORDING
 *
 * The rule this file follows is that an explanation is about THIS POSITION.
 * Everything else is subordinate to that, and three habits were removed to
 * enforce it.
 *
 * NO DICTIONARY DEFINITIONS. An earlier version printed the concept's full
 * definition after the position-specific observation, so a reader who had just
 * been told "White's knight on b6 cannot be driven off by a pawn" was then told
 * what an outpost is in general. The teaching sentence now has to add something
 * the observation did not, and the concept's `lesson` - which is short and
 * actionable - is preferred over its definition.
 *
 * NO META-REMARKS. Concept records carry sentences about the literature and
 * about this base's own testing, because a knowledge base should. They must not
 * reach a player. "Sources disagree on whether an open file behind it is part
 * of the definition" is true, useful to a maintainer, and noise in a comment on
 * a chess position.
 *
 * SECONDARY OBSERVATIONS EARN THEIR PLACE. Listing everything detected is how a
 * six-item feature dump gets mistaken for an explanation.
 * ------------------------------------------------------------------------ */

// Sentences that talk about the knowledge rather than the position.
const META = /(sources? (disagree|differ|are split)|this base|recorded here|measured here|tools\/|\bthis system\b|not verified|unverified|attribut|coinage|is disputed|no controlled evidence|this record)/i;

function sentences(text) {
  if (!text) return [];
  return String(text).split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);
}

/* The first sentence that says something about chess rather than about the
 * literature. Returns null if the whole passage is meta. */
function teachingSentence(text) {
  // Two passes, and the first one exists because the level-specific texts
  // front-load a LABEL. The advanced wording for `outpost` opens with "Outpost
  // in the modern sense." and the master wording with "Note which sense is
  // meant." — both over the old twelve-character bar, both useless to a reader,
  // and both were what a caller asking for advanced or master got as the whole
  // teaching half. So prefer a sentence long enough to be teaching something,
  // and fall back to the old rule only when the text has nothing longer.
  const list = sentences(text).filter(x => !META.test(x));
  for (const s of list) if (s.length >= 45) return s;
  for (const s of list) if (s.length >= 12) return s;
  return null;
}

/* Does this sentence merely restate the observation? Cheap overlap test on the
 * content words, which is enough to catch "The d-file is open" following "the
 * d-file is open, and White's rook stands on it". */
function restates(a, b) {
  if (!a || !b) return false;
  const words = t => new Set(String(t).toLowerCase().match(/[a-z]{4,}/g) || []);
  const A = words(a), B = words(b);
  if (!B.size) return false;
  let shared = 0;
  for (const w of B) if (A.has(w)) shared++;
  return shared / B.size > 0.6;
}

function compose(features, moveInfo, concepts, assessment, level, depth) {
  const bits = [];

  if (moveInfo && moveInfo.legal) {
    if (assessment) {
      bits.push(assessment.is_best === true
        ? `${moveInfo.san} is the engine's first choice.`
        : `${moveInfo.san} evaluates at ${(assessment.eval_cp / 100).toFixed(2)}` +
          (assessment.best_move ? `, against the engine's ${assessment.best_move}.` : '.'));
    } else {
      bits.push(`${moveInfo.san}.`);
    }
  }

  if (!concepts.length) {
    bits.push('Nothing in this position matches a researched concept in this knowledge base.');
    return bits.join(' ');
  }

  const lead = concepts[0];
  const observation = lead.wording_specific && lead.wording ? lead.wording : cap1(lead.because[0]) + '.';
  bits.push(observation.endsWith('.') ? observation : observation + '.');

  // The teaching half, only where it adds to the observation.
  if (depth !== 'short') {
    // Level first: this is the sentence written for THIS reader, and it is the
    // only place the `level` parameter has ever been able to reach a reader.
    let teach = null;
    if (lead.wording_level && !restates(observation, lead.wording_level)) {
      const t = teachingSentence(lead.wording_level) || lead.wording_level;
      if (t && !restates(observation, t)) teach = t;
    }
    if (!teach && lead.lesson && !restates(observation, lead.lesson)) teach = lead.lesson;
    if (!teach && lead.wording && !lead.wording_specific) {
      const t = teachingSentence(lead.wording);
      if (t && !restates(observation, t)) teach = t;
    }
    if (teach) bits.push(teach.endsWith('.') ? teach : teach + '.');
  }

  // Secondary observations. One at normal depth, two at deep, and only where
  // they are confident and are not saying the same thing again.
  const room = depth === 'deep' ? 2 : depth === 'normal' ? 1 : 0;
  if (room) {
    const said = [observation];
    const extra = [];
    for (const c of concepts.slice(1)) {
      if (extra.length >= room) break;
      if (c.confidence === 'low') continue;
      const line = c.because[0];
      if (said.some(x => restates(x, line))) continue;
      said.push(line); extra.push(lower1(line));
    }
    if (extra.length === 1) bits.push(`Also here: ${extra[0]}.`);
    else if (extra.length > 1) bits.push(`Also here: ${extra.join('; ')}.`);
  }

  // A hedge on soft knowledge, and at depth a caution — but never the meta ones.
  if (depth === 'deep') {
    if (lead.hedge && !META.test(lead.hedge)) bits.push(lead.hedge);
    const caution = (lead.cautions || []).find(c => !META.test(c.text));
    if (caution) bits.push(`Worth checking: ${lower1(caution.text)}`);
  } else if (lead.hedge && !META.test(lead.hedge) && depth === 'normal' && SOFT.has(lead.knowledge_type)) {
    bits.push(lead.hedge);
  }

  return bits.join(' ');
}
const cap1 = s => (s ? s[0].toUpperCase() + s.slice(1) : s);
// These clauses are spliced mid-sentence after a semicolon, so a leading capital
// reads as a typo — except where the capital belongs to the word, which for
// chess prose means a colour or a piece in algebraic notation.
const lower1 = s => (!s ? s
  : /^(White|Black|[KQRBN][a-h1-8x]|O-O)/.test(s) ? s
  : s[0].toLowerCase() + s.slice(1));

module.exports = { analyzeWithEducation, knowledge, cautionsFor, auditPhrasing, LEVELS, DEPTHS };

/* CLI: node lib/analyze.js "<fen>" [uci] [--level L] [--depth D] [--json] */
if (require.main === module) {
  const args = process.argv.slice(2);
  const flags = {};
  const pos = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const k = args[i].slice(2);
      if (k === 'json') flags.json = true;
      else { flags[k] = args[i + 1]; i++; }
    } else pos.push(args[i]);
  }
  if (!pos.length) {
    console.error('usage: node lib/analyze.js "<fen>" [uci-move] [--level beginner|intermediate|advanced|master] [--depth short|normal|deep] [--json]');
    process.exit(2);
  }
  const r = analyzeWithEducation({
    fen: pos[0], move: pos[1] || null,
    level: flags.level || 'intermediate', depth: flags.depth || 'normal',
  });
  if (flags.json) { console.log(JSON.stringify(r, null, 2)); process.exit(0); }
  console.log(`\n${r.fen}`);
  console.log(`${r.side_to_move === 'w' ? 'White' : 'Black'} to move · ${r.phase}`);
  if (r.move) console.log(`move: ${r.move.san}${r.move.motifs.length ? '  motifs: ' + r.move.motifs.join(', ') : ''}`);
  console.log(`\n${r.explanation.text}\n`);
  if (r.concepts.length) {
    console.log('concepts licensed by the position:');
    for (const c of r.concepts) {
      console.log(`  ${c.id} [${c.confidence}${c.confidence_capped_from ? ', capped from ' + c.confidence_capped_from : ''}] (${c.knowledge_type})`);
      for (const b of c.because) console.log(`      because ${b}`);
      if (c.cautions.length) console.log(`      caution (${c.cautions[0].evidence}): ${c.cautions[0].text}`);
    }
  }
  if (r.notes.length) { console.log('\nnotes:'); for (const n of r.notes) console.log('  · ' + n); }
}
