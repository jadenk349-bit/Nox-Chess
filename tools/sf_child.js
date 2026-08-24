/* One Stockfish, in a process of its own.
 *
 * engine/stockfish.wasm.js is a browser worker build: it talks by assigning a
 * global onmessage and calling a global postMessage. Node has neither, so this
 * shim supplies both and forwards them over the fork's IPC channel. Two
 * details are load-bearing:
 *
 *   - the module's locateFile() hands back a bare "stockfish.wasm", which Node
 *     resolves against the working directory, so tools/sf.js forks this with
 *     cwd set to engine/;
 *   - Node 18+ has a global fetch, which sends Emscripten down its browser
 *     path and makes it try to parse "stockfish.wasm" as a URL. Removing it
 *     puts the module back on the path where it reads the file.
 */

'use strict';

delete global.fetch;
global.postMessage = line => process.send({ line: String(line) });
process.on('message', m => { if (global.onmessage) global.onmessage({ data: m.cmd }); });

require(process.argv[2]);
