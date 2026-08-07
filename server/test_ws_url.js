/* Tests for the WebSocket URL the browser builds.
 *
 * The function under test is read out of blind-chess.html rather than copied, so
 * these tests cannot quietly drift from the code that actually ships.
 *
 * Runs under any JS engine with a file reader:
 *   node   server/test_ws_url.js
 *   jsc    server/test_ws_url.js          (macOS, /System/Library/Frameworks/
 *                                          JavaScriptCore.framework/Versions/A/Helpers/jsc)
 */

var PAGE = 'blind-chess.html';

function slurp(path){
  if (typeof readFile === 'function') return readFile(path);          // jsc
  return require('fs').readFileSync(path, 'utf8');                    // node
}
function say(s){ (typeof print === 'function' ? print : console.log)(s); }

// pull `function wsURLFrom(loc){ ... }` straight out of the page
var src = slurp(PAGE);
var match = src.match(/function wsURLFrom\(loc\)\{[\s\S]*?\n\}/);
if (!match){
  say('FAIL  could not find wsURLFrom() in ' + PAGE);
  throw new Error('wsURLFrom not found');
}
eval(match[0]);

var passed = 0, failed = 0;
function check(label, got, want){
  if (got === want){ passed++; say('  PASS  ' + label + '  ->  ' + got); }
  else { failed++; say('  FAIL  ' + label + '\n        got  ' + got + '\n        want ' + want); }
}

say('\nWebSocket URL construction\n');

// the two cases named in the requirements
check('http://localhost:8787',
      wsURLFrom({ protocol:'http:',  host:'localhost:8787' }),
      'ws://localhost:8787/ws');
check('https://example.com',
      wsURLFrom({ protocol:'https:', host:'example.com' }),
      'wss://example.com/ws');

// a provider's generated hostname — no domain is baked in anywhere
check('https on a hosted subdomain',
      wsURLFrom({ protocol:'https:', host:'blind-chess-xyz.onrender.com' }),
      'wss://blind-chess-xyz.onrender.com/ws');

// ports must survive, including non-default ones on https
check('http on a LAN address',
      wsURLFrom({ protocol:'http:',  host:'192.168.0.28:8787' }),
      'ws://192.168.0.28:8787/ws');
check('https on a non-standard port',
      wsURLFrom({ protocol:'https:', host:'example.com:8443' }),
      'wss://example.com:8443/ws');
check('IPv6 literal host',
      wsURLFrom({ protocol:'http:',  host:'[::1]:8787' }),
      'ws://[::1]:8787/ws');

say('\nNo mixed content is possible from an https page\n');

var httpsHosts = ['example.com', 'a.b.example.com:8443', 'blind-chess.onrender.com', '[::1]:9000'];
var insecure = httpsHosts.filter(function(h){
  return wsURLFrom({ protocol:'https:', host:h }).indexOf('wss://') !== 0;
});
check('every https origin yields wss', insecure.length, 0);

// anything that is not https falls to ws — including odd schemes
['http:', 'file:', 'about:'].forEach(function(p){
  var url = wsURLFrom({ protocol:p, host:'localhost:8787' });
  check('scheme ' + p + ' yields ws', url.indexOf('ws://'), 0);
});

say('\nNothing is hard-coded\n');

var host = 'whatever.example:1234';
check('host comes only from location.host',
      wsURLFrom({ protocol:'http:', host:host }),
      'ws://' + host + '/ws');

var fn = String(wsURLFrom);
check('no localhost in the function', /localhost/.test(fn), false);
check('no 127.0.0.1 in the function', /127\.0\.0\.1/.test(fn), false);
check('no onrender.com in the function', /onrender/.test(fn), false);
check('path is always /ws', /\/ws/.test(fn), true);

say('\n' + passed + ' passed, ' + failed + ' failed\n');

if (typeof process !== 'undefined' && process.exit) process.exit(failed ? 1 : 0);
