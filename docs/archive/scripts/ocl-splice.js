#!/usr/bin/env node
'use strict';
/* ocl-1.0.0 latin1 index-splice for background.js. Codex red contract
 * same-day-reader-owner-cleanup: a terminal read failure must release BOTH
 * ownerships - the quiet-work lease AND any open Athena encounter surface.
 * The next scheduled row starts from a clean chart, never inheriting the
 * refused patient's drawer. The after-response cleanup gains a bounded
 * best-effort closeDetailFrame across the read tab's frames, sequenced
 * BEFORE the lease release so the existing waitForVisitCleanup barrier
 * makes the next read see a closed surface. EOL-aware; unique targets. */
const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '..', 'background.js');
let t = fs.readFileSync(file, 'latin1');

function splice(label, oldStr, newStr) {
  for (const eol of ['\n', '\r\n']) {
    const o = oldStr.replace(/\n/g, eol);
    const first = t.indexOf(o);
    if (first < 0) continue;
    if (t.indexOf(o, first + 1) >= 0) throw new Error(label + ': target not unique');
    t = t.slice(0, first) + newStr.replace(/\n/g, eol) + t.slice(first + o.length);
    console.log('spliced', label, eol === '\n' ? '(LF)' : '(CRLF)');
    return;
  }
  throw new Error(label + ': target not found in either EOL form');
}

/* ---- 1. fireVisitCleanup accepts an optional surface closer ---- */
splice('cleanup signature + closer-first chain',
`  function fireVisitCleanup(reason, immediate) {`,
`  function fireVisitCleanup(reason, immediate, surfaceCloser) {`);

splice('closer runs before the lease release',
`        function startCleanup() {
          try {
            if (!self.__mlsQpRelease) { resolve({ ok: true, skipped: true }); return; }
            Promise.resolve(self.__mlsQpRelease(reason)).then(function () {`,
`        function startCleanup() {
          /* ocl-1.0.0: close whatever encounter surface this read may have
             left open BEFORE releasing the lease - the barrier then hands
             the next row a clean chart, never a refused patient's drawer.
             Best-effort and bounded: a closer failure never blocks release. */
          var surfDone = Promise.resolve();
          if (typeof surfaceCloser === 'function') {
            try { surfDone = Promise.resolve(surfaceCloser()).catch(function () {}); } catch (eSurf) {}
          }
          surfDone.then(function () { startRelease(); }, function () { startRelease(); });
          function startRelease() {
          try {
            if (!self.__mlsQpRelease) { resolve({ ok: true, skipped: true }); return; }
            Promise.resolve(self.__mlsQpRelease(reason)).then(function () {`);

/* close startRelease's brace: the original function body ends after the
   catch - extend the same block terminator */
splice('closer scope terminator',
`            });
          } catch (e) { resolve({ ok: false }); }
        }
        /* qpEnsure can move a tab synchronously and then never settle. In that
           failure mode start restoration now; ordinary after-response cleanup
           stays deferred so it cannot extend the response path. */`,
`            });
          } catch (e) { resolve({ ok: false }); }
          }
        }
        /* qpEnsure can move a tab synchronously and then never settle. In that
           failure mode start restoration now; ordinary after-response cleanup
           stays deferred so it cannot extend the response path. */`);

/* ---- 2. the after-response cleanup passes the closer ---- */
splice('after-response closer',
`      if (qpOwnedByThisRead) fireVisitCleanup('all-visits-after-response');`,
`      if (qpOwnedByThisRead) fireVisitCleanup('all-visits-after-response', false, function () {
        /* the same all-frames exec shape the pre-gate identity probe uses;
           closeDetailFrame is a no-op on an already-clean chart */
        try { return exec(readTabId, null, ['closeDetailFrame', cfg]); } catch (eOclExec) { return Promise.resolve(); }
      });`);

fs.writeFileSync(file, t, 'latin1');
console.log('background.js spliced; bytes now', t.length);
