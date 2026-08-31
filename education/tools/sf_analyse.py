#!/usr/bin/env python3
"""Stockfish harness for the Education System.

Standard library only. The project keeps its Python near-stdlib (see
requirements.txt), and analysis here needs nothing more: a FEN goes in, UCI
comes back. `python-chess` is used only if it happens to be installed, and
only to turn UCI moves into SAN for human-readable notes.

Its single job is to answer "does this move actually work in this position".
It must never be used to decide what a concept is called.

    python3 tools/sf_analyse.py --probe
    python3 tools/sf_analyse.py --fen "<FEN>" --depth 30 --multipv 3
    python3 tools/sf_analyse.py --fen "<FEN>" --moves e2e4 d2d4 --depth 28
"""
import argparse, json, os, re, shutil, subprocess, sys

DEFAULT_DEPTH = 28


def find_engine():
    for cand in (os.environ.get("STOCKFISH"), "stockfish",
                 os.path.expanduser("~/.local/bin/stockfish"),
                 "/opt/homebrew/bin/stockfish", "/usr/local/bin/stockfish"):
        if cand and (shutil.which(cand) or os.path.isfile(cand)):
            return shutil.which(cand) or cand
    return None


def run_uci(engine, commands, timeout, until=None):
    """Send commands, collect stdout until `until` is seen (or the engine exits).

    Streaming matters: piping every command at once and closing stdin makes
    Stockfish read `quit` while the search is still running, so it exits before
    printing a single info line. The search has to be waited on.
    """
    p = subprocess.Popen([engine], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                         stderr=subprocess.DEVNULL, text=True, bufsize=1)
    lines = []
    try:
        for c in commands:
            p.stdin.write(c + "\n")
        p.stdin.flush()
        if until is None:
            p.stdin.write("quit\n"); p.stdin.flush()
            out, _ = p.communicate(timeout=timeout)
            return out.splitlines()
        for line in p.stdout:
            line = line.rstrip("\n")
            lines.append(line)
            if line.startswith(until):
                break
        p.stdin.write("quit\n"); p.stdin.flush()
    finally:
        try:
            p.stdin.close()
        except Exception:
            pass
        try:
            p.wait(timeout=10)
        except Exception:
            p.kill()
    return lines


def probe(engine):
    out = run_uci(engine, ["uci"], 30, until="uciok")
    name = next((l.split("id name ", 1)[1] for l in out if l.startswith("id name ")), "unknown")
    return name


def settle_depth(by_depth, best):
    """Shallowest depth from which the search never changed its mind again.

    Borrowed from tools/sf.js, which uses it to rate puzzle difficulty. It is a
    better confidence signal than raw depth: an answer held from depth 3 is firm,
    one that flipped until depth 25 is not, even though both were searched to 30.
    """
    if not best or not by_depth:
        return None
    settled = None
    for d, mv in reversed(by_depth):
        if mv != best:
            break
        settled = d
    return settled if settled is not None else (by_depth[-1][0] if by_depth else None)


def analyse(engine, fen, depth=DEFAULT_DEPTH, multipv=1, searchmoves=None,
            threads=None, hash_mb=2048, timeout=3600):
    """Return {'best': uci, 'lines': [...], 'settle_depth': int|None}."""
    if threads is None:
        threads = max(1, (os.cpu_count() or 2) - 2)
    go = "go depth %d" % depth
    if searchmoves:
        go += " searchmoves " + " ".join(searchmoves)
    cmds = ["uci",
            "setoption name Threads value %d" % threads,
            "setoption name Hash value %d" % hash_mb,
            "setoption name MultiPV value %d" % multipv,
            "isready", "position fen " + fen, go]
    out = run_uci(engine, cmds, timeout, until="bestmove")

    best, deepest, by_depth = None, {}, []
    info_re = re.compile(
        r"^info\b(?=.*\bdepth (\d+))(?=.*\bscore (cp|mate) (-?\d+))"
        r"(?:(?=.*\bmultipv (\d+)))?.*?\bpv (.+)$")
    for line in out:
        if line.startswith("bestmove"):
            parts = line.split()
            best = parts[1] if len(parts) > 1 and parts[1] != "(none)" else None
            continue
        m = info_re.match(line)
        if not m:
            continue
        d = int(m.group(1))
        kind, val = m.group(2), int(m.group(3))
        idx = int(m.group(4) or 1)
        pv = m.group(5).split()
        if idx == 1:
            by_depth.append((d, pv[0] if pv else None))
        prev = deepest.get(idx)
        if prev is None or d >= prev["depth"]:
            deepest[idx] = {"multipv": idx, "depth": d,
                            "cp": val if kind == "cp" else None,
                            "mate": val if kind == "mate" else None,
                            "pv": pv}
    return {"fen": fen, "best": best,
            "lines": [deepest[k] for k in sorted(deepest)],
            "settle_depth": settle_depth(by_depth, best),
            "threads": threads, "hash_mb": hash_mb, "multipv": multipv}


def to_san(fen, uci_moves):
    """SAN for readability, when python-chess is available. Never required."""
    try:
        import chess
    except ImportError:
        return None
    board = chess.Board(fen)
    out, tmp = [], chess.Board(fen)
    for u in uci_moves:
        try:
            mv = chess.Move.from_uci(u)
            if mv not in tmp.legal_moves:
                break
            out.append(tmp.san(mv))
            tmp.push(mv)
        except Exception:
            break
    return board.variation_san([chess.Move.from_uci(u) for u in uci_moves[:len(out)]]) if out else None


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--probe", action="store_true", help="print the engine id and exit")
    ap.add_argument("--fen")
    ap.add_argument("--depth", type=int, default=DEFAULT_DEPTH)
    ap.add_argument("--multipv", type=int, default=1)
    ap.add_argument("--threads", type=int, default=None,
                    help="engine threads; default cpu_count-2. Lower it when running jobs in parallel.")
    ap.add_argument("--moves", nargs="*", help="restrict the search to these UCI moves")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()

    engine = find_engine()
    if not engine:
        sys.exit("No Stockfish binary found. Set $STOCKFISH or put `stockfish` on PATH.")

    if a.probe:
        print(json.dumps({"engine_path": engine, "engine_id": probe(engine)}, indent=2))
        return
    if not a.fen:
        ap.error("--fen is required unless --probe is given")

    res = analyse(engine, a.fen, a.depth, a.multipv, a.moves, threads=a.threads)
    res["engine_id"] = probe(engine)
    if a.json:
        print(json.dumps(res, indent=2))
        return
    print(f"{res['engine_id']}   depth {a.depth}")
    print(f"FEN {a.fen}")
    for ln in res["lines"]:
        score = f"#{ln['mate']}" if ln["mate"] is not None else f"{ln['cp']/100:+.2f}"
        san = to_san(a.fen, ln["pv"][:10])
        print(f"  [{ln['multipv']}] d{ln['depth']:<3} {score:>8}  {san or ' '.join(ln['pv'][:10])}")
    print(f"  bestmove: {res['best']}   settled from depth {res['settle_depth']}")


if __name__ == "__main__":
    main()
