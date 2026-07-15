'use strict';

/* Live 2026-07-15: window.MLSStatus is owned by Task-3 and exposes only
 * set/on/running. The F7 save wrapper called ms.note() (and other paths
 * called ms.step/ms.stepFail/ms.finish) without method guards; the missing
 * method threw AFTER the successful base save and converted EVERY managed
 * history save into chart-identity-save-refused — the entire 16-patient
 * live batch failed on this one line. A status notifier may never void a
 * completed save: every optional-notifier method call must be type-guarded. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'mls-connect.js'), 'utf8');

for (const banned of [
  'if (ms) ms.note(',
  'if (ms) ms.step(',
  'if (ms) ms.stepFail(',
  'if (ms) ms.finish('
]) {
  assert(!source.includes(banned), `unguarded MLSStatus notifier call: ${JSON.stringify(banned)}`);
}
assert(source.includes("ms && typeof ms.note === 'function'"),
  'the save-path status note must verify the method exists and stay non-fatal');
assert(source.includes('A status note may never void a completed save'),
  'the save-path notifier hardening rationale must stay documented at the call site');

/* The one save-path note call must be wrapped so ANY notifier exception is
   swallowed after the base save returned true. */
const noteAt = source.indexOf("ms.note('Chart history saved.')");
assert(noteAt > 0, 'save-path note call missing');
const context = source.slice(Math.max(0, noteAt - 220), noteAt);
assert(/safe\(function \(\) \{[^}]*$/.test(context), 'save-path note call must run inside safe()');

console.log('PASS status notifier guard: optional MLSStatus methods are type-guarded and can never void a completed history save');
