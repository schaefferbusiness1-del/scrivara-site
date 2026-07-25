/* Boot cost must be visible in the gate, not just felt by the doctor.
 *
 * Measured live 2026-07-24 (b564) on the owner's tab:
 *   domInteractive 164ms, load 664ms  -- the PAGE is fast
 *   152 feat_mls_*.js, ALL through the service worker
 *   151 of 152 transferSize 0 (already cached), avg network wait 4ms
 *   all 152 requested inside the same 1-second window
 *   last resource finishes ~26s warm, ~80s cold
 *
 * So the wait is not network, server, cache, or auth. Every file is local and
 * arrives in 4ms; the time is 152 separate requests each round-tripping the
 * service worker and then being parsed and executed on the main thread. The
 * owner reports this as "it took way too long to login". It is not login.
 *
 * ScribeFlow.html carries only 4 script tags - the fan-out lives in
 * mls-connect.js, which names every feature file it loads. Nothing in the gate
 * watched that number, so boot cost could grow one feature at a time forever
 * and no test would notice.
 *
 * This pins it, and it is deliberately two-sided:
 *   - ABOVE the ceiling fails: a new unbundled feature adds main-thread time to
 *     every boot, and that should be a decision someone makes on purpose.
 *   - WELL BELOW the ceiling fails too: that means bundling or deferral landed,
 *     which is the fix we want - and the pin must be lowered so the win is
 *     locked in and cannot silently erode back.
 *
 * That second arm is the point. The boot fix was being held back because it was
 * unverifiable; this makes the improvement a number the gate can confirm.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '..');
const LOADER = 'mls-connect.js';
const CEILING = 164;   // measured at b564
const FLOOR = 140;     // drop below this and the pin is stale - see above

const src = fs.readFileSync(path.join(ROOT, LOADER), 'utf8');
const refs = new Set((src.match(/feat_mls_[a-z0-9_]+\.js/g) || []));
const n = refs.size;

let failed = false;

if (n > CEILING) {
  failed = true;
  console.error(
    '\nFAIL: ' + LOADER + ' now loads ' + n + ' feature scripts, up from ' + CEILING + '.\n' +
    'Every added file is another service-worker round trip and another parse on\n' +
    'the main thread at every boot - measured at ~26s warm for ' + CEILING + ' of them.\n' +
    'Either bundle it with an existing module, load it after first paint, or\n' +
    'raise CEILING deliberately and say why.\n'
  );
}

if (n < FLOOR) {
  failed = true;
  console.error(
    '\nFAIL (good news): ' + LOADER + ' now loads only ' + n + ' feature scripts,\n' +
    'below the floor of ' + FLOOR + '. Bundling or deferral has landed. Lower CEILING\n' +
    'and FLOOR to the new numbers so the improvement is locked in and cannot\n' +
    'erode back one feature at a time.\n'
  );
}

assert(n > 0, 'expected to find feature-script references in ' + LOADER);

if (failed) { process.exit(1); }

console.log('boot-script-budget: OK (' + n + ' feature scripts referenced by ' + LOADER + '; ceiling ' + CEILING + ')');
