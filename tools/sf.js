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
const fs = require('fs');
const { fork, spawn, execSync } = require('child_process');
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

/* ------------------------------------------------------- two engines
 *
 * There are two Stockfishes in this repo now and the difference between them
 * is not a detail.
 *
 *   engine/stockfish.wasm  is what the *browser* runs. It is a pre-NNUE build
 *     with one thread and sixteen megabytes of hash, and it is what the bot
 *     ladder in LEVELS was tuned against. Anything imitating a rung — chiefly
 *     seedRating(), which asks "what can an 1800 see?" — has to keep using it,
 *     because a rating measured against a different engine is a rating of a
 *     player who does not exist in this game.
 *
 *   the native `stockfish` on PATH is what *judges*. Stockfish 18 with NNUE,
 *     as many threads and as much hash as the machine will give it. Nothing
 *     about a puzzle's correctness should be decided by a build chosen for
 *     fitting in a web page, and this one is several hundred Elo stronger and
 *     an order of magnitude faster at the same depth.
 *
 * Same ask() on both, so the callers do not care which they were handed —
 * except that the callers who *do* care ask for the one they need by name.
 */

/** Where a native Stockfish is, or null. */
function nativeBin(){
  if (process.env.NOX_SF && fs.existsSync(process.env.NOX_SF)) return process.env.NOX_SF;
  try {
    const found = execSync('command -v stockfish', { encoding:'utf8' }).trim();
    return found || null;
  } catch (e){ return null; }
}

/* A real Stockfish process, spoken to over stdin and stdout.
 *
 * Options are set once the engine has told us which it has, rather than fired
 * blind: this has to work against a build with Contempt (the old one) and one
 * without (every modern one), and an unknown setoption is silently ignored by
 * some builds and complained about by others. Asking first is cheap and means
 * the same code drives both. */
class NativeEngine {
  constructor(opt){
    opt = opt || {};
    this.bin = opt.bin || nativeBin();
    this.threads = opt.threads || 1;
    this.hash = opt.hash || 256;
    this.wdl = !!opt.wdl;
    this.names = new Set();
    this.id = '';
    this.proc = spawn(this.bin, [], { stdio: ['pipe', 'pipe', 'ignore'] });
    this.buf = '';
    this.pending = null;
    this.ready = new Promise(resolve => { this._ready = resolve; });
    this.proc.stdout.on('data', d => {
      this.buf += d;
      let i;
      while ((i = this.buf.indexOf('\n')) >= 0){
        const line = this.buf.slice(0, i).replace(/\r$/, '');
        this.buf = this.buf.slice(i + 1);
        this._line(line);
      }
    });
    this.send('uci');
  }

  send(cmd){ try { this.proc.stdin.write(cmd + '\n'); } catch (e){ /* gone */ } }

  set(name, value){ if (this.names.has(name)) this.send('setoption name ' + name + ' value ' + value); }

  _line(line){
    if (line.startsWith('id name ')) { this.id = line.slice(8); return; }
    if (line.startsWith('option name ')){
      this.names.add(line.slice(12).split(' type ')[0]);
      return;
    }
    if (line === 'uciok'){
      this.set('Threads', this.threads);
      this.set('Hash', this.hash);
      if (this.wdl) this.set('UCI_ShowWDL', 'true');
      this.send('isready');
      return;
    }
    if (line === 'readyok'){ this._ready(); return; }
    const job = this.pending;
    if (!job) return;
    if (line.startsWith('info ')){
      P.readInfoLine(line, job.lines, job.multipv);
      // win/draw/loss, in permille, for the side to move — the thing the old
      // build could not report and the reason evaluation bands had to stand in
      // for it. Parsed here rather than in the page's readInfoLine(), which is
      // shared with the browser and has no use for it.
      const w = line.match(/ wdl (\d+) (\d+) (\d+)/);
      if (w){
        const mp = line.match(/ multipv (\d+)/);
        const slot = job.lines[(mp ? +mp[1] : 1) - 1];
        if (slot) slot.wdl = { win:+w[1], draw:+w[2], loss:+w[3] };
      }
      const mp2 = line.match(/ multipv (\d+)/);
      if (!mp2 || mp2[1] === '1'){
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
        best: (best && best !== '(none)') ? best : one.best,
        cp: one.cp, mate: one.mate, pv: one.pv, wdl: one.wdl,
        second: lines[1] || null,
        lines
      });
    }
  }

  /* Abandon whatever this engine is doing and refuse further questions until
     it is released. `stop` makes Stockfish answer the search in flight
     immediately, which resolves the pending promise and leaves the process
     healthy and reusable — killing it would cost a fresh boot and the hash
     table. Used by the verifier's per-puzzle budget: a puzzle that runs away
     is abandoned, never accepted. */
  abandon(){ this.aborted = true; this.send('stop'); }
  release(){ this.aborted = false; }

  async ask(o){
    await this.ready;
    if (this.aborted) throw new Error('sf: abandoned');
    if (this.pending) throw new Error('sf: one question at a time per engine');
    const multipv = o.multipv || 1;
    const moves = (o.moves && o.moves.length) ? ' moves ' + o.moves.join(' ') : '';
    if (o.fresh){
      this.send('ucinewgame');
      await new Promise(resolve => { this._ready = resolve; this.send('isready'); });
    }
    this.set('Skill Level', o.skill === undefined ? 20 : o.skill);
    this.set('MultiPV', multipv);
    // only the old build has it; on a modern one this is a no-op by design
    this.set('Contempt', o.objective ? 0 : 24);
    this.send('position ' + (o.fen ? 'fen ' + o.fen : 'startpos') + moves);
    const p = new Promise(resolve => { this.pending = { lines: [], byDepth: [], multipv, resolve }; });
    this.send(o.depth ? 'go depth ' + o.depth
            : o.nodes ? 'go nodes ' + o.nodes
            : 'go movetime ' + (o.movetime || 200));
    return p;
  }

  quit(){ this.send('quit'); try { this.proc.kill(); } catch (e){ /* already gone */ } }
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

  /** ask({fen, moves, skill, multipv, depth, movetime, fresh, objective}) -> engineAsk's shape
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
    // Contempt is a thumb on the scale, and this build applies it from the
    // point of view of whoever is to move at the root ("Analysis Contempt:
    // Both", 24 by default). That is right for a bot, which should prefer a
    // fight to a draw, and ruinous for a tool that compares the score of a
    // position before a move with the score after it: those two searches have
    // opposite sides at the root, so the same position is worth ~50cp more
    // after any move than before it, and every move in every game looks like a
    // blunder by exactly that much. Anything measuring a position rather than
    // playing one asks for `objective`.
    this.send('setoption name Contempt value ' + (opt.objective ? 0 : 24));
    this.send('setoption name Analysis Contempt value ' + (opt.objective ? 'Off' : 'Both'));
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
  /** Pool(n) is the browser's engine, n of them. Pool(n, {native:true, …})
      is the judge. Callers that imitate a rung of the bot ladder must not
      pass native: see the note above the two classes. */
  constructor(n, opt){
    opt = opt || {};
    this.native = !!opt.native;
    this.engines = Array.from({ length: n },
      () => this.native ? new NativeEngine(opt) : new Engine());
    // each engine knows its own slot, so a caller can pair it with a second
    // pool — the judge is Stockfish 18, but anything imitating a rung of the
    // bot ladder has to keep asking the build the browser actually runs
    this.engines.forEach((e, i) => { e.slot = i; });
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

module.exports = { Engine, NativeEngine, Pool, settleDepth, nativeBin };
