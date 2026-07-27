'use strict';

/* THE VISIT HOME FOLLOWS THE BANNER PATIENT (b710) - measured live at b709 in
 * BOTH directions: calendar Details -> "Open patient" made Adam the banner
 * patient while the hero kept offering "Start Recording - Bernard P Brooks";
 * switching back via Recent left the hero on Adam. The empty-day hero renders
 * from activePatient() (the owner's through-line law, b693), but homeSig() -
 * the change-signature the 700ms poll re-renders on - never tracked the
 * active patient, so an outside switch moved nothing and the stale hero
 * persisted until an unrelated change.
 *
 * Contract: the CANONICAL owner's homeSig() includes the active-patient
 * identity. Scoped to the canonical Easy block - the retired lineages are
 * fail-closed and never run (easy-canonical-action-owner-runtime pins that).
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'mls-connect.js'), 'utf8');
const canonicalMarker = source.indexOf('the effortless Visit tab  (__mlsEasyV32)');
const canonicalStart = source.indexOf('(function () {', canonicalMarker);
const canonicalEnd = source.indexOf('\n})();', canonicalStart);
assert(canonicalMarker >= 0 && canonicalStart >= 0 && canonicalEnd > canonicalStart,
  'canonical Easy owner could not be bounded');
const canonical = source.slice(canonicalStart, canonicalEnd);

const sigAt = canonical.indexOf('function homeSig()');
assert(sigAt >= 0, 'canonical homeSig must exist');
const sigEnd = canonical.indexOf('\n  }', sigAt);
const sig = canonical.slice(sigAt, sigEnd);

assert(/verifiedActivePatient|activePatient/.test(sig),
  'homeSig must include the banner patient - the empty-day hero renders from it');
assert(sig.includes("+ '|' + apk"),
  'the active-patient key must be part of the returned signature, not just read');

/* the hero itself still reads the live active patient at render */
assert(canonical.includes("id=\"ez3ActiveGo\""),
  'the empty-day banner-patient hero must exist');
