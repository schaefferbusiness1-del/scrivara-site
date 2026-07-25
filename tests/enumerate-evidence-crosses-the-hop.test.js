'use strict';

/*
 * Diagnostic evidence must be RETURNED, not attached to a local.
 *
 * HANDOFF_THREE_OPEN_DEFECTS_2026-07-24, method note 3, is the most-cited rule
 * in this codebase's ON-mode work:
 *
 *   "A diagnostic that doesn't reach the receipt isn't a diagnostic. Only the
 *    `reason` STRING survives the extension->page hop. An object attached to
 *    the gate is silently dropped. Encode evidence into the string."
 *
 * The observation was real. The diagnosis was wrong, and it has shaped four
 * builds.
 *
 * WHAT ACTUALLY HAPPENED. 3.0.11 attached the frame table to `gate.frames` and
 * never saw it on the page. But `gate` is a LOCAL variable. Nothing returns it
 * — there is no `gate: gate` anywhere in background.js — so `gate.frames` could
 * not have arrived regardless of what the boundary does. A code-path bug read
 * as a platform limit.
 *
 * OBJECTS CROSS FINE, and the proof is in the shipped code:
 *
 *   content.js    var out = {}; for (var k in res) out[k] = res[k];
 *                 window.postMessage(out, origin)   <- structured clone
 *   mls-connect.js  reads `r.identity.name` off that very message — a NESTED
 *                 object property, on the same response, working in production
 *                 today. If objects were dropped, chart-identity display could
 *                 never have worked, and the handoff itself reports reading a
 *                 patient banner out of exactly that field.
 *
 * WHAT THE MISDIAGNOSIS COST. Evidence crammed into truncated strings: four
 * frames out of twelve, URLs cut to 26 characters, reasons to 22 — on a defect
 * whose entire remaining question is which gate refused and with what numbers,
 * and where the owner's live pull is a scarce resource. One pull should not
 * come back abbreviated.
 *
 * This suite pins the correction, and pins it in a way that catches the
 * original mistake rather than its symptom: evidence must be reachable from a
 * RETURNED object.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const bg = fs.readFileSync(path.join(ROOT, 'background.js'), 'latin1');
const content = fs.readFileSync(path.join(ROOT, 'content.js'), 'latin1');

/* 1. The bridge really does forward every key, and really does structured-clone.
 *    If this ever narrows to a whitelist, the field below stops arriving and
 *    the string encoding becomes load-bearing again — so it is pinned here,
 *    next to the reason it matters. */
/* Scoped to the all-visits bridge, not the file. That copy-every-key line
   appears twice in content.js; an unscoped regex passed while the visits one
   had been replaced by a two-field whitelist — caught by negative-testing this
   very assertion, which is the whole argument for doing it. */
const visitsBridge = (function () {
  const start = content.indexOf("d.type !== 'mlsAppReadAllVisits'");
  assert(start > -1, 'the all-visits bridge could not be located in content.js');
  /* End AFTER the response relay. 'mlsAppVisitsProgress' looked like a natural
     terminator and is not — it first occurs before the relay, so the slice
     stopped short and the assertion failed against correct code. */
  const end = content.indexOf("if (msg && msg.type === 'mlsAppVisitsProgress')", start);
  assert(end > start, 'the all-visits bridge end marker moved');
  return content.slice(start, end);
})();
assert(/mlsAppAllVisitsResult/.test(visitsBridge), 'sanity: the slice must contain the result relay');
assert(/var out = \{\}; for \(var k in res\) out\[k\] = res\[k\];/.test(visitsBridge),
  'the VISITS bridge must forward every key of the response; a whitelist here silently drops diagnostics');
assert(/post\(target\.origin, 'mlsAppAllVisitsResult', pendingMeta\(target, out\)\)/.test(visitsBridge),
  'the forwarded object must be the one posted to the page');

/* 2. Both refusals carry the evidence as a real field. */
const gateRefusal = bg.slice(bg.indexOf('      if (!gate.ok) {'), bg.indexOf('      var detailWaitMs'));
assert(/enumDiag: \{ frames: ecSeen, answered: enrSeen, noiseDropped: enNoiseDropped/.test(gateRefusal),
  'the chart-frame refusal must RETURN the frame table, not only a truncated summary of it');

const indexRefusal = bg.slice(bg.indexOf("reason: 'encounter-index-incomplete'"), bg.indexOf("reason: 'encounter-index-incomplete'") + 900);
assert(/enumDiag: \{ frames: ecSeen, answered: enrSeen, noiseDropped: enNoiseDropped/.test(indexRefusal),
  'the index-incomplete refusal must RETURN the frame table too — it is the refusal the owner is most likely to hit');

/* 3. The string summary STAYS. It is proven to arrive, it costs nothing, and
 *    betting a scarce live pull on my being right about the boundary would be
 *    the same mistake pointing the other way. */
assert(/no-chart-frame-candidate\[/.test(bg),
  'the string encoding must remain as a belt-and-braces summary');
assert(/gate\.reason \+= '\|enum=' \+ enrSeen\.join\(','\)/.test(bg),
  'now that the full table is returned, the enum= summary must stop truncating to 12 frames');

/* 4. THE ORIGINAL MISTAKE, pinned directly: evidence attached to `gate` and
 *    never returned. `gate` is local; if a future build hangs a new field on it
 *    expecting it to arrive, that field goes nowhere — exactly as gate.frames
 *    did. Only `reason` and `ok` are read off `gate` by the code that returns. */
const gateAssignments = (bg.match(/\bgate\.[A-Za-z_$][\w$]*\s*=/g) || [])
  .map((m) => m.replace(/\s*=$/, '').trim());
const allowed = new Set(['gate.reason', 'gate.frames']);
for (const a of gateAssignments) {
  assert(allowed.has(a),
    'new field ' + a + ' is being attached to the LOCAL `gate`, which is never returned — ' +
    'that is precisely the bug that produced "objects do not survive the hop". Put it on the ' +
    'returned object (enumDiag) instead.');
}
assert(!/\bgate: gate\b/.test(bg),
  'sanity: `gate` is still not returned anywhere, which is why fields on it cannot arrive');

/* 5. The evidence must be structured-cloneable. Anything the frame table holds
 *    has to survive postMessage: no functions, no DOM nodes, no Error objects.
 *    ecSeen is built once; pin its shape at the source. */
const ecPush = bg.slice(bg.indexOf('if (!ecRelaxed) ecSeen.push('), bg.indexOf('if (!ecRelaxed) ecSeen.push(') + 260);
assert(/url: ecUrl\.slice\(0, 110\)/.test(ecPush) && /score: ecScoreN/.test(ecPush),
  'the frame table must hold plain strings and numbers so it survives structured clone');
assert(!/node:|element:|err:|error: e\b/.test(ecPush),
  'a DOM node or Error in the frame table would make the whole message unclonable and drop it entirely');

console.log('PASS enumerate evidence crosses the hop: the frame table is returned as a real field (objects DO survive; gate.frames never did because gate is never returned), the string summary is kept as belt-and-braces, and new fields cannot be hung on the local gate again');
