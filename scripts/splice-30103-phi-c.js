/* splice-30103-phi-c.js - phi-1.0.2: chrome.storage.session.set returns a
 * promise in MV3; a rejected write from the diag ring must never surface as
 * an unhandled rejection (tests/athena-action-token-session-runtime simulates
 * exactly that failure). Exact-count anchor, latin1 index-splice. */
'use strict';
var fs = require('fs');
var s = fs.readFileSync('background.js', 'latin1');
var find = "try { chrome.storage.session.set({ mlsTokDiagV1: self.__mlsTokDiag }); } catch (e2) {}";
var repl = "try { var __tdp = chrome.storage.session.set({ mlsTokDiagV1: self.__mlsTokDiag }); if (__tdp && typeof __tdp.catch === 'function') __tdp.catch(function () {}); } catch (e2) {}";
var n = s.split(find).length - 1;
if (n !== 1) { console.error('ABORT: anchor hits=' + n); process.exit(1); }
fs.writeFileSync('background.js', s.split(find).join(repl), 'latin1');
console.log('OK phi-1.0.2');
