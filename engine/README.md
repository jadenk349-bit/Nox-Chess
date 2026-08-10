# Vendored chess engine

Stockfish, compiled to WebAssembly. Used for post-game analysis: the review
screen asks it for the best move in each position the game passed through.

Nothing here is our code. It is checked in rather than fetched at runtime so
that players' browsers never talk to a third party, and so a CDN going down
cannot break the game.

## What this is

| | |
|---|---|
| Package | [`stockfish.js`](https://github.com/niklasf/stockfish.js) 10.0.2, by Niklas Fiekas |
| Source | `https://registry.npmjs.org/stockfish.js/-/stockfish.js-10.0.2.tgz` |
| Upstream | [Stockfish](https://github.com/official-stockfish/Stockfish) 10 |
| Licence | **GPL-3.0** — see `Copying.txt` |

The npm tarball's published sha512 was checked against the download before
these files were taken from it. `CHECKSUMS.txt` holds sha256 of the two files
actually served, so a change here is visible in review.

## Why this build

The threaded build (`stockfish.wasm`) is roughly twice as fast, but needs
`SharedArrayBuffer`, which needs `Cross-Origin-Embedder-Policy` and
`Cross-Origin-Opener-Policy` on every response — and its own README lists
Safari and mobile browsers as unsupported. This single-threaded build has no
such requirement and runs everywhere WebAssembly does, which for a game people
open on a phone matters more than the speed.

Only the WebAssembly pair is vendored. The package also ships a 1.5 MB asm.js
fallback for browsers without WebAssembly; every browser has had it since 2017,
so the review screen says so plainly instead.

## Licence, and a caution

Stockfish is GPL-3.0. Serving it to a browser is distribution. Where the GPL's
reach stops for WebAssembly loaded beside proprietary code is genuinely
unsettled, and this project has paid features planned — worth getting a real
answer before charging money, rather than after.

`Copying.txt` is the full licence text and must stay alongside these files.
