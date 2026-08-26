/* Asking Stockfish things, offline.
 *
 * The browser's engineAsk() queues onto one worker and caches by position; a
 * generator wants the opposite — several engines at once, nothing cached,
 * because the same position asked twice at a weak rung is meant to be able to
 * answer differently. What is shared is the part that matters: info lines are
 * parsed by the page's own readInfoLine(), so a puzzle is chosen by the same
 * numbers the review screen reads.
 */

'use strict';

const path = require('path');
const { fork } = require('child_process');
const P = require('./page_chess.js');

const ENGINE_DIR = path.join(__dirname, '..', 'engine');
const ENGINE_JS = path.join(ENGINE_DIR, 'stockfish.wasm.js');

/* The shallowest depth from which the search never changed its mind again.
   Answering at depth 3 and holding it is an easy move; flipping until depth 15
   is not. Falls back to the deepest depth seen when the final answer never
   appears in the first line at all. */
function settleDepth(byDepth, best){
  if (!best || !byDepth.length) return null;
  let settled = null;
  for (let i = byDepth.length - 1; i >= 0; i--){
    if (byDepth[i][1] !== best) break;
    settled = byDepth[i][0];
  }
  return settled === null ? byDepth[byDepth.length - 1][0] : settled;
}

class Engine {
  constructor(){
    this.child = fork(path.join(__dirname, 'sf_child.js'), [ENGINE_JS], {
      cwd: ENGINE_DIR,
      stdio: ['ignore', 'ignore', 'pipe', 'ipc']
    });
    this.pending = null;
    this.ready = new Promise(resolve => { this._ready = resolve; });
    this.child.on('message', m => this._line(m.line));
    this.send('uci');
  }

  send(cmd){ this.child.send({ cmd }); }

  _line(line){
    if (line === 'uciok'){ this.send('isready'); return; }
    if (line === 'readyok'){ this._ready(); return; }
    const job = this.pending;
    if (!job) return;
    if (line.startsWith('info ')){
      P.readInfoLine(line, job.lines, job.multipv);
      // How deep the search had to go before it settled on its answer, which is
      // the closest thing to "how hard is this to see" that a search can report.
      // Iterative deepening announces a first line at every depth; the move a
      // depth-4 search already likes is a move a club player finds.
      const mp = line.match(/ multipv (\d+)/);
      if (!mp || mp[1] === '1'){
        const d = line.match(/ depth (\d+)/);
        const pv = line.match(/ pv ([a-h][1-8][a-h][1-8][qrbn]?)/);
        if (d && pv) job.byDepth.push([+d[1], pv[1]]);
      }
      return;
    }
    if (line.startsWith('bestmove')){
      const best = line.split(/\s+/)[1];
      const lines = job.lines.filter(Boolean);
      const one = lines[0] || { cp:null, mate:null, best:null, pv:null };
      this.pending = null;
      job.resolve({
        settleDepth: settleDepth(job.byDepth, (best && best !== '(none)') ? best : one.best),
        // below Skill 20 the engine's own pick is deliberately not its top
        // line, exactly as in the browser, and that pick is what the rung plays
        best: (best && best !== '(none)') ? best : one.best,
        cp: one.cp, mate: one.mate, pv: one.pv,
        second: lines[1] || null,
        lines
      });
    }
  }

  /** ask({fen, moves, skill, multipv, depth, movetime, fresh}) -> engineAsk's shape
   *
   * `fresh` empties the transposition table first. An engine kept alive across
   * many questions is faster because it remembers, and that memory is exactly
   * what a checking tool must not have: the same position asked after two
   * different games can otherwise come back with two different answers at the
   * same depth. Generating wants the speed; verifying wants the isolation. */
  async ask(opt){
    await this.ready;
    if (this.pending) throw new Error('sf: one question at a time per engine');
    const multipv = opt.multipv || 1;
    const skill = opt.skill === undefined ? 20 : opt.skill;
    const moves = (opt.moves && opt.moves.length) ? ' moves ' + opt.moves.join(' ') : '';
    // One engine answers many unrelated questions, and the transposition table
    // it fills answering one of them changes how it searches the next: the same
    // position at the same depth can come back with a different move depending
    // on what this process happened to look at before it. The generator can
    // live with that — it is choosing among positions it is seeing for the
    // first time either way — but a verifier cannot, because a verdict that
    // depends on which engine of the pool drew the puzzle is not a verdict.
    // `fresh` empties the table first, at the cost of the search starting cold.
    // The wait for readyok is the point: ucinewgame is only honoured once the
    // engine acts on it, and a `position` sent before that would be searched
    // against the table this was meant to throw away.
    if (opt.fresh){
      this.send('ucinewgame');
      await new Promise(resolve => { this._ready = resolve; this.send('isready'); });
    }
    this.send('setoption name Skill Level value ' + skill);
    this.send('setoption name MultiPV value ' + multipv);
    this.send('position ' + (opt.fen ? 'fen ' + opt.fen : 'startpos') + moves);
    const p = new Promise(resolve => { this.pending = { lines: [], byDepth: [], multipv, resolve }; });
    // depth first: a search bounded by depth answers the same way on any
    // machine, which is what makes a generated set reproducible
    this.send(opt.depth ? 'go depth ' + opt.depth : 'go movetime ' + (opt.movetime || 200));
    return p;
  }

  quit(){ this.child.kill(); }
}

/** A pool of engines, handed out one job at a time. */
class Pool {
  constructor(n){
    this.engines = Array.from({ length: n }, () => new Engine());
  }
  /** Run fn(engine) for every item, `n` at a time, preserving input order. */
  async map(items, fn){
    const out = new Array(items.length);
    let next = 0;
    await Promise.all(this.engines.map(async engine => {
      for (;;){
        const i = next++;
        if (i >= items.length) return;
        out[i] = await fn(items[i], engine, i);
      }
    }));
    return out;
  }
  quit(){ this.engines.forEach(e => e.quit()); }
}

module.exports = { Engine, Pool, settleDepth };
