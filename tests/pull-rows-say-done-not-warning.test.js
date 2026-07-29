'use strict';
/* =========================================================================
   A PATIENT BEING READ IS NOT A PATIENT THAT FAILED
   -------------------------------------------------------------------------
   OWNER, watching a live 18-patient Athena pull that worked perfectly: "now
   just make this wrok like where the names acatlly say done and not jsut stuck
   on this the wwhole time it pulls."

   His screenshot: "7 of 18 - Now reading: <patient>", and beneath it six names
   each reading "! finishing..." in warning amber. Nothing had failed. The pull
   went on to complete. The panel simply had no way to say "in progress".

   rowsHtml() had exactly TWO states:
       r.ok        -> check glyph + "saved"
       everything else -> WARNING glyph + r.reason
   A row that is still being read carries a progress reason, so it fell into the
   second branch and rendered as a warning - and stayed a warning until the row
   finished. For most of the pull, most of the panel was amber.

   This is the same defect class as the first-run checklist telling him to
   install an extension he already had: UNKNOWN or IN-PROGRESS presented as
   FAILED. It is worse here because it is the surface he watches to decide
   whether to trust the pull at all. A panel that cries wolf on every patient
   teaches him to ignore it on the one patient that really did fail.

   THE FIX (app-side only - the extension is frozen at 3.0.38 at his
   instruction, so nothing in the reason strings it sends can change): a THIRD
   state. A recognised progress reason renders calm, glyph-less and quiet, and
   flips to "saved" when the row completes. Only a genuine failure keeps the
   warning.

   WHAT THIS SUITE PINS - by EXECUTING the shipped renderer, not by grepping:
     1. the three states are distinguishable, and pending is not the failure one
     2. pending carries NO warning glyph and NOT the failure class
     3. a real failure still warns, and still says WHY in plain words
     4. the humane rewrites of the raw machine reasons survive
     5. patient names are still escaped (this HTML is built by concatenation)
   ========================================================================= */
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'mls-connect.js'), 'latin1');

let failures = 0;
function ok(cond, label, detail) {
  if (cond) { console.log('  pass  ' + label); return true; }
  failures++;
  console.log('  FAIL  ' + label + (detail ? '\n        ' + detail : ''));
  return false;
}

/* ---------- lift the SHIPPED renderer out and run it ---------------------
   Executing the real source is the whole point: a grep for the word "reading"
   would have passed on the broken file too, because "could not read" contains
   it. */
const startMark = 'var PP_PENDING =';
const start = SRC.indexOf(startMark);
ok(start > 0, 'the pending-state table is shipped in mls-connect.js');
if (start < 0) { console.log('\nFAIL  pull-rows-say-done-not-warning: renderer not found.'); process.exit(1); }

const fnMark = 'function rowsHtml(S) {';
const fnAt = SRC.indexOf(fnMark, start);
ok(fnAt > start, 'rowsHtml follows the pending-state table');

/* brace-match to the end of rowsHtml so the extract cannot silently truncate */
let depth = 0, end = -1;
for (let i = SRC.indexOf('{', fnAt); i < SRC.length; i++) {
  const ch = SRC[i];
  if (ch === '{') depth++;
  else if (ch === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
}
ok(end > fnAt, 'the renderer body brace-matches (extract is complete, not truncated)');

const region = SRC.slice(start, end);
ok(SRC.indexOf(startMark, start + 1) < 0,
  'exactly one pending-state table ships (no dormant second copy drifting)',
  'mls-connect.js carries a live engine and a dormant twin; a second copy here would rot');

let rowsHtml;
try {
  /* esc() is the app's own escaper; supply the same behaviour so the assertion
     about escaping is testing the renderer's USE of it, not a stub's leniency */
  const factory = new Function('esc',
    region + '\n; return rowsHtml;');
  rowsHtml = factory(function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  });
  ok(typeof rowsHtml === 'function', 'the shipped renderer evaluates and is callable');
} catch (e) {
  ok(false, 'the shipped renderer evaluates', String(e && e.message));
  console.log('\nFAIL  pull-rows-say-done-not-warning: could not execute the renderer.');
  process.exit(1);
}

function render(rows) { return rowsHtml({ rows: rows }); }

/* mls-connect.js is read as latin1 (it is mixed-EOL and must never be rewritten
   through a utf8 round-trip), so the glyphs come back as their raw UTF-8 bytes
   rather than as characters. Comparing a '⚠' literal from this utf8 test file
   against them silently never matches - which would have made the "a real
   failure still warns" assertion unfalsifiable in the quiet direction. Build the
   needles the same way the haystack was read. */
const WARN = Buffer.from('⚠', 'utf8').toString('latin1');
const CHECK = Buffer.from('✓', 'utf8').toString('latin1');
ok(render([{ name: 'Aaa Bbb', ok: true }]).indexOf(CHECK) >= 0,
  'instrument check: the check glyph is findable in the rendered output',
  'if this fails, every glyph assertion below is vacuous');

/* ---------- 1. the three states are distinct, and pending != failed ------ */
const SAVED = render([{ name: 'Aaa Bbb', ok: true }]);
const PENDING = render([{ name: 'Aaa Bbb', ok: false, reason: 'finishing…' }]);
const FAILED = render([{ name: 'Aaa Bbb', ok: false, reason: 'open-failed' }]);

ok(SAVED !== PENDING && PENDING !== FAILED && SAVED !== FAILED,
  'saved / in-progress / failed all render differently');

ok(/pp-ok/.test(SAVED) && /saved/.test(SAVED), 'a completed row reads as saved');

ok(!/pp-bad/.test(PENDING),
  'AN IN-PROGRESS ROW DOES NOT CARRY THE FAILURE CLASS',
  'this is the owner\'s complaint verbatim - it rendered as a warning for the whole pull\n        got: ' + PENDING);

ok(PENDING.indexOf(WARN) < 0,
  'an in-progress row carries no warning glyph',
  'got: ' + PENDING);

ok(/pp-wait/.test(PENDING),
  'an in-progress row has its own neutral state class');

ok(!/finishing/i.test(PENDING),
  'the machine word "finishing" is not what he reads',
  'got: ' + PENDING);

ok(/reading/i.test(PENDING),
  'an in-progress row says, in plain words, that it is being read',
  'got: ' + PENDING);

/* Every progress word the frozen extension can send must land in the pending
   state. The extension is at 3.0.38 and will not change, so this list is the
   contract with it - if a reason it sends is missing here, that patient goes
   back to rendering as a failure. */
['finishing', 'finishing…', 'reading', 'reading chart', 'pending', 'queued',
 'in-progress', 'in progress', 'working', 'started', 'starting', 'opening', 'waiting'
].forEach(function (reason) {
  const html = render([{ name: 'Aaa Bbb', ok: false, reason: reason }]);
  ok(/pp-wait/.test(html) && !/pp-bad/.test(html),
    'progress reason treated as in-progress: "' + reason + '"');
});

/* An explicit pending flag works too, so a future caller need not rely on
   matching prose at all. */
ok(/pp-wait/.test(render([{ name: 'Aaa Bbb', ok: false, pending: true, reason: 'anything at all' }])),
  'an explicit pending flag overrides the reason text');

/* ---------- 2. a real failure STILL warns, in plain words --------------- */
ok(/pp-bad/.test(FAILED) && FAILED.indexOf(WARN) >= 0,
  'A GENUINE FAILURE STILL WARNS',
  'the point of quieting progress is that the remaining amber MEANS something\n        got: ' + FAILED);

[['open-failed', /not on the athenaOne schedule/],
 ['read-failed', /chart read timed out/],
 ['identity-mismatch:someone-else', /chart identity could not be verified/]
].forEach(function (pair) {
  const html = render([{ name: 'Aaa Bbb', ok: false, reason: pair[0] }]);
  ok(pair[1].test(html), 'failure "' + pair[0] + '" is explained in plain words', 'got: ' + html);
  ok(/pp-bad/.test(html), 'failure "' + pair[0] + '" still carries the failure class');
});

ok(/could not read/.test(render([{ name: 'Aaa Bbb', ok: false }])),
  'a failure with no reason at all still says something honest rather than nothing');

/* An unrecognised failure reason must NOT be quietly demoted to pending - that
   would hide real failures, which is the opposite mistake and a worse one. */
const WEIRD = render([{ name: 'Aaa Bbb', ok: false, reason: 'some-new-backend-code-42' }]);
ok(/pp-bad/.test(WEIRD) && !/pp-wait/.test(WEIRD),
  'an UNRECOGNISED reason stays a failure (quieting must never hide a real one)',
  'got: ' + WEIRD);

/* ---------- 3. names are still escaped ---------------------------------- */
const XSS = render([{ name: '<img src=x onerror=alert(1)>', ok: true }]);
ok(XSS.indexOf('<img') < 0 && XSS.indexOf('&lt;img') >= 0,
  'patient names are still escaped (this HTML is built by concatenation)');

/* ---------- 4. the styling for the new state actually ships ------------- */
ok(/\.pp-wait\{[^}]*color/.test(SRC.replace(/\s+/g, '')) || /pp-wait\{color/.test(SRC),
  'a .pp-wait colour rule ships (an unstyled class would inherit the failure colour)');
ok(/theme-dark[^\n]*\.pp-wait/.test(SRC),
  'the new state is styled in dark theme too');

console.log(failures === 0
  ? '\nPASS  pull-rows-say-done-not-warning: in-progress reads as in-progress, done reads as done, and a real failure still warns.'
  : '\nFAIL  pull-rows-say-done-not-warning: ' + failures + ' assertion(s) failed.');
process.exit(failures === 0 ? 0 : 1);
