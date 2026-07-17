/* v2.9.37: the absolute-deadline blob Worker was constructed EAGERLY on every
 * page the content script touches. Strict-CSP sites (Gmail, accounts.google)
 * block blob workers and log a console violation for every page load - the
 * doctor sees a wall of extension errors on their mail. The worker is now
 * created LAZILY on first arm() and ONLY on hosts whose pages actually use
 * the managed-read deadline relay (mlsscribe + athena); every other host uses
 * the existing window-timer fallback, and a CSP-blocked construction is
 * remembered so it is never retried on that page. content.js is pure LF. */
'use strict';
const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, '..', 'content.js');
let src = fs.readFileSync(FILE, 'utf8');
function replaceOnce(oldStr, newStr, label) {
  const i = src.indexOf(oldStr);
  if (i < 0) throw new Error('anchor missing: ' + label);
  if (src.indexOf(oldStr, i + 1) >= 0) throw new Error('anchor not unique: ' + label);
  src = src.slice(0, i) + newStr + src.slice(i + oldStr.length);
}

replaceOnce(
"    try {\n" +
"      if (typeof Worker === 'function' && typeof Blob === 'function' && typeof URL !== 'undefined' && URL.createObjectURL) {\n" +
"        workerUrl = URL.createObjectURL(new Blob([\n" +
"          \"var t={};onmessage=function(e){var d=e.data||{},id=String(d.id||'');\" +\n" +
"          \"if(d.action==='cancel'){if(t[id]){clearTimeout(t[id]);delete t[id];}return;}\" +\n" +
"          \"if(d.action!=='arm'||!id)return;if(t[id])clearTimeout(t[id]);\" +\n" +
"          \"t[id]=setTimeout(function(){delete t[id];postMessage({id:id});},Math.max(0,Number(d.deadlineAt||0)-Date.now()));};\"\n" +
"        ], { type: 'text/javascript' }));\n" +
"        worker = new Worker(workerUrl);\n" +
"        worker.onmessage = function (event) {\n" +
"          var id = String(event && event.data && event.data.id || ''), entry = callbacks[id];\n" +
"          if (!entry) return;\n" +
"          entry.fire();\n" +
"        };\n" +
"        worker.onerror = failWorker;\n" +
"      }\n" +
"    } catch (e) { worker = null; }",
"    /* v2.9.37: LAZY, host-gated construction. Eagerly creating a blob Worker\n" +
"       on every page made strict-CSP sites (Gmail, accounts.google) log a\n" +
"       CSP violation per load. Only mlsscribe/athena pages ever run the\n" +
"       managed-read deadline relay; every other host keeps the window-timer\n" +
"       fallback, and one blocked attempt is terminal for the page. */\n" +
"    var workerBlocked = false;\n" +
"    function workerHostAllowed() {\n" +
"      try { return /(^|\\.)mlsscribe\\.com$|(^|\\.)athenahealth\\.com$|athenanet/i.test(String(location.hostname || '')); } catch (e) { return false; }\n" +
"    }\n" +
"    function ensureWorker() {\n" +
"      if (worker || workerBlocked) return worker;\n" +
"      if (!workerHostAllowed()) { workerBlocked = true; return null; }\n" +
"      try {\n" +
"        if (typeof Worker === 'function' && typeof Blob === 'function' && typeof URL !== 'undefined' && URL.createObjectURL) {\n" +
"          workerUrl = URL.createObjectURL(new Blob([\n" +
"            \"var t={};onmessage=function(e){var d=e.data||{},id=String(d.id||'');\" +\n" +
"            \"if(d.action==='cancel'){if(t[id]){clearTimeout(t[id]);delete t[id];}return;}\" +\n" +
"            \"if(d.action!=='arm'||!id)return;if(t[id])clearTimeout(t[id]);\" +\n" +
"            \"t[id]=setTimeout(function(){delete t[id];postMessage({id:id});},Math.max(0,Number(d.deadlineAt||0)-Date.now()));};\"\n" +
"          ], { type: 'text/javascript' }));\n" +
"          worker = new Worker(workerUrl);\n" +
"          worker.onmessage = function (event) {\n" +
"            var id = String(event && event.data && event.data.id || ''), entry = callbacks[id];\n" +
"            if (!entry) return;\n" +
"            entry.fire();\n" +
"          };\n" +
"          worker.onerror = failWorker;\n" +
"        }\n" +
"      } catch (e) { worker = null; workerBlocked = true; }\n" +
"      return worker;\n" +
"    }",
'lazy worker');

replaceOnce(
"        if (at <= Date.now()) {\n          fire();\n        } else if (worker) {",
"        if (at <= Date.now()) {\n          fire();\n        } else if (ensureWorker()) {",
'arm uses ensureWorker');

fs.writeFileSync(FILE, src);
console.log('OK lazy worker applied');
