'use strict';
/*
 * THE CONSENT ATTESTATION RIDES WITH EVERY BLOCK OF WORDS (round-three finding)
 * -----------------------------------------------------------------------------
 * kioskAmbientBlock() builds the text that is appended to the visit transcript. Its own note
 * says why the consent line exists at all:
 *
 *   "A recording whose consent lives only in someone's memory is a recording nobody can
 *    defend later, so the confirmation and its clock time ride in the same block as the
 *    words it authorised."
 *
 * But when `kiosk.intakeFiled` was true — a SECOND capture on the same session, i.e. the
 * doctor pressed "keep listening" — the function returned early with a "visit, continued"
 * header and the body, and NO attestation. The suppression was written to stop the patient's
 * ANSWERS being pasted twice, which is right; the attestation was dropped with them, which is
 * not, because the two were in the same early return.
 *
 * ⛔ AND `intakeFiled` IS NOT EVIDENCE THAT THE LINE IS ALREADY IN THIS TRANSCRIPT. It is a
 * claim about a PREVIOUS write. A day flip re-binds the visit, crash recovery can resume into a
 * fresh session (the crash record carries consentAt and intakeFiled as separate fields for
 * exactly this reason), and the doctor can edit the box. In any of those the second capture's
 * words were filed with no consent record anywhere.
 *
 * The asymmetry settles it: repeating one bracketed line costs a duplicated line in a chart;
 * omitting it costs an undefendable recording. So the intake stays suppressed and the
 * attestation always rides.
 *
 * EXECUTED, both branches, against the shipped function.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const src = fs.readFileSync(process.env.AVATAR_SRC_OVERRIDE || path.join(root, 'feat_mls_avatar.js'), 'utf8');

const at = src.indexOf('  function kioskAmbientBlock(body) {');
assert.ok(at > 0, 'kioskAmbientBlock is gone');
const end = src.indexOf('\n  function ', at + 20);
const body = src.slice(at, end > at ? end : at + 4000);

const CONSENT_AT = Date.UTC(2026, 7, 9, 19, 30, 0);

function build(opts) {
  const make = new Function('opts', `
    var kiosk = {
      intakeFiled: opts.intakeFiled,
      consentAt: opts.consentAt,
      ambStart: opts.ambStart,
      ambBound: '7833832'
    };
    var AMBIENT_HEAD_CHECKIN = '=== AVATAR CHECK-IN ===';
    var AMBIENT_HEAD_VISIT = '=== VISIT (room capture) ===';
    var safe = function (fn, dflt) { try { var v = fn(); return v === undefined ? dflt : v; } catch (e) { return dflt; } };
    var clean = function (v) { return String(v == null ? '' : v).trim(); };
    var kioskIntakeText = function () { return 'Q: What brings you in?\\nA: my back hurts'; };
    var ordersBlock = function () { return opts.orders ? '[Confirmed: ibuprofen 400mg]' : ''; };
    var activePtIdSafe = function () { return '7833832'; };
    ${body}
    return kioskAmbientBlock(opts.body);
  `);
  return make(opts);
}

const ROOM = 'Doctor: how is the back today. Patient: better since the tablets.';

/* ---- 1. FIRST capture: the attestation is present (this always worked) ---- */
{
  const out = build({ intakeFiled: false, consentAt: CONSENT_AT, ambStart: Date.now() - 300000, body: ROOM });
  assert.ok(/Recording consent confirmed by practice staff/.test(out),
    'the FIRST block lost its consent attestation:\n' + out);
  assert.ok(/AVATAR CHECK-IN/.test(out), 'the first block should carry the intake header');
  assert.ok(out.indexOf(ROOM) >= 0, 'the room capture is missing from the first block');
}

/* ---- 2. THE DEFECT: a CONTINUED capture must still carry the attestation ---- */
{
  const out = build({ intakeFiled: true, consentAt: CONSENT_AT, ambStart: Date.now() - 300000, body: ROOM });
  assert.ok(/visit, continued/.test(out), 'the continued header is missing');
  assert.ok(out.indexOf(ROOM) >= 0, 'the room capture is missing from the continued block');
  assert.ok(/Recording consent confirmed by practice staff/.test(out),
    'A CONTINUED ROOM CAPTURE WAS FILED WITH NO CONSENT ATTESTATION. `intakeFiled` is a claim ' +
    'about a previous write, not proof the line is in THIS transcript — a day flip, crash ' +
    'recovery into a fresh session, or an edited box all leave these words undefendable:\n' + out);
  /* and the INTAKE must still be suppressed — that half of the original fix was correct */
  assert.ok(!/What brings you in/.test(out),
    'the patient\'s answers are being pasted a second time — the intake suppression was the ' +
    'point of this branch and must survive:\n' + out);
  assert.ok(!/AVATAR CHECK-IN/.test(out), 'the check-in header is repeated on a continued capture');
}

/* ---- 3. no consent recorded => no claim of consent, in EITHER branch.
   The line is written from kiosk.consentAt, the same flag that gates the microphone, so the
   transcript can never assert a consent the kiosk did not actually have. ---- */
for (const intakeFiled of [false, true]) {
  const out = build({ intakeFiled, consentAt: 0, ambStart: Date.now() - 60000, body: ROOM });
  assert.ok(!/Recording consent confirmed/.test(out),
    'the transcript CLAIMS a consent that was never given (intakeFiled=' + intakeFiled + '):\n' + out);
}

/* ---- 4. the clock time travels with it, not just the fact ---- */
{
  const out = build({ intakeFiled: true, consentAt: CONSENT_AT, ambStart: Date.now() - 120000, body: ROOM });
  const stamp = new Date(CONSENT_AT).toLocaleString();
  assert.ok(out.indexOf(stamp) >= 0,
    'the attestation lost its clock time — "consent was given" without WHEN is not defensible:\n' + out);
  assert.ok(/before any microphone was opened/.test(out),
    'the attestation no longer states that consent preceded the microphone');
}

console.log('PASS consent rides with every block: present on a first capture AND on a resumed ' +
  '"keep listening" capture, the intake stays suppressed on the resumed one, neither branch ever ' +
  'claims a consent that was not given, and the clock time travels with it');
