'use strict';
/* =========================================================================
   THE GET-STARTED CHECKLIST MAY NOT ACCUSE WHEN IT DOES NOT KNOW
   -------------------------------------------------------------------------
   OWNER, on a screenshot of "Get MLS working — 0 of 3 done":  "also make sure
   this is accaurate cause likle I do have everyhting here doen and it says I
   dont".

   He was right and the card was wrong. At that moment the MLS Assist extension
   was installed and answering `mlsPing` with version 3.0.38, and athenaOne was
   open, signed in, showing the dashboard. The card rendered BOTH rows red:
   install the extension, and sign in to athenaOne.

   Why it could be so confident and so wrong: `connTruth()` consulted three
   INDIRECT signals — a `__mlsConnTruth` state object, `__mlsUxUnify`, and a
   status dot — and never used the app's own extension bridge, the same
   handshake every other feature runs on. A stale `no-extension` verdict from any
   of them produced a red row telling a doctor to install software he was
   already running.

   TWO FIXES, both in the direction this codebase already holds elsewhere
   ("never state what the system cannot back"):

     1. ASK THE EXTENSION DIRECTLY. A returned `mlsPong` IS ground truth for
        "installed and answering". It now pins the connection row to ok and no
        indirect probe can outvote it.
     2. AN UNCERTAIN PROBE MAY NOT ACCUSE. While the bridge is answering, the
        app has no standing to claim athenaOne is signed out on the word of a
        probe already observed to be wrong — it shows "checking", not a red
        accusation the doctor can see is false.

   This is the same defect class as the pull panel rendering every in-flight
   patient as a warning: UNKNOWN presented as FAILED. See
   tests/pull-rows-say-done-not-warning.test.js.

   WHAT THIS SUITE PINS. The module is a browser IIFE with no seam to import, so
   these are structural assertions on the shipped source — but each one names a
   specific mechanism, and the last two are the ones that actually caused the
   false accusation.
   ========================================================================= */
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'feat_mls_firstrun.js'), 'utf8');

let failures = 0;
function ok(cond, label, detail) {
  if (cond) { console.log('  pass  ' + label); return true; }
  failures++;
  console.log('  FAIL  ' + label + (detail ? '\n        ' + detail : ''));
  return false;
}

/* ---------- 1. it actually asks the bridge ---------------------------- */
ok(/postMessage\(\s*\{[^}]*source:\s*'mls-app'[^}]*type:\s*'mlsPing'/.test(SRC),
  'the checklist sends a real mlsPing over the app bridge',
  'without `source:\'mls-app\'` the extension ignores the message entirely and every verb looks dead');

ok(/d\.source\s*!==\s*'mls-ext'|source\s*===\s*'mls-ext'/.test(SRC),
  'it only accepts a reply that identifies itself as coming from the extension');

ok(/'mlsPong'/.test(SRC),
  'it listens for mlsPong specifically');

/* ---------- 2. a pong outranks the indirect probes -------------------- */
const connFn = SRC.slice(SRC.indexOf('function connTruth()'),
                         SRC.indexOf('function connTruth()') + 900);
ok(connFn.length > 40, 'connTruth() is present');
ok(/if\s*\(\s*pongTruth\(\)\s*\)\s*return\s*'ok'/.test(connFn),
  'A PONG PINS THE CONNECTION ROW TO OK BEFORE ANY INDIRECT PROBE IS CONSULTED',
  'this ordering is the fix - placed after the probes, a stale verdict still wins');

/* The pong check must come BEFORE the no-extension branch textually, or the
   early return never happens. Order is the whole mechanism here. */
const pongAt = SRC.indexOf("if (pongTruth()) return 'ok'");
const noExtAt = SRC.indexOf("st === 'no-extension'");
ok(pongAt > 0 && noExtAt > 0 && pongAt < noExtAt,
  'the pong short-circuit precedes the no-extension branch',
  'pongTruth at ' + pongAt + ', no-extension at ' + noExtAt);

/* ---------- 3. belt and braces: even that branch cannot accuse -------- */
ok(/st\s*===\s*'no-extension'\s*\)\s*return\s*pongTruth\(\)\s*\?\s*'ok'\s*:\s*'bad'/.test(SRC),
  'the no-extension branch itself defers to the bridge',
  'so reordering the function later cannot silently reopen the false accusation');

/* ---------- 4. an uncertain Athena probe degrades to "checking" ------- */
ok(/athShown\s*=\s*\(\s*athState\s*===\s*'bad'\s*&&\s*pongTruth\(\)\s*\)\s*\?\s*'wait'\s*:\s*athState/.test(SRC),
  'AN ATHENA FAILURE VERDICT BECOMES "CHECKING" WHILE THE BRIDGE IS ANSWERING',
  'the probe reported open:false/certain:true with athenaOne open and signed in');

ok(/states\s*=\s*\{[^}]*ath:\s*athShown/.test(SRC),
  'the rendered state uses the downgraded value, not the raw one',
  'computing athShown and then rendering athState would be a dead fix - this app has shipped that mistake before');

/* ---------- 5. the probe is actually kicked --------------------------- */
ok(/kickPong\(\)/.test(SRC) && /kickConnCheck\(\)/.test(SRC),
  'the bridge probe is kicked alongside the existing probes',
  'a truth source that is never asked is not a truth source');

/* ---------- 6. it stays cheap and cannot leak ------------------------- */
ok(/removeEventListener\('message'/.test(SRC),
  'the pong listener is removed once it fires (and on timeout)');
/* Match a CALL, not the word: this file's own header and a user-facing string
   both contain the prose "No setInterval", so /setInterval/ matched the
   documentation promising the opposite of what it was flagging. */
ok(!/setInterval\s*\(/.test(SRC),
  'no polling interval was introduced',
  'hidden-tab timers are FROZEN in this app, so an interval here would be both wasteful and unreliable');
ok(/Date\.now\(\)\s*-\s*pongAt\)\s*<\s*\d+/.test(SRC),
  'the pong verdict is time-bounded rather than cached forever',
  'a permanent "ok" would be the mirror-image lie');

console.log(failures === 0
  ? '\nPASS  checklist-cannot-accuse-on-uncertainty: the bridge is the truth, and an uncertain probe shows "checking" instead of blaming the doctor.'
  : '\nFAIL  checklist-cannot-accuse-on-uncertainty: ' + failures + ' assertion(s) failed.');
process.exit(failures === 0 ? 0 : 1);
