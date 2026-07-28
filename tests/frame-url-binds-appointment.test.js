'use strict';

/* THE THIRD DOOR: a frame whose OWN URL carries the requested appointment id
 * is bound to that patient by athenaOne itself (b755).
 *
 * WHY IT EXISTS - measured, not inferred. The frame carrying Active Problems is
 * /ax/appointment/<apptId>/briefing, and frameBoundToTarget had exactly two
 * doors, both unsatisfiable there:
 *   Door 1  identityMatchesTarget(frameIdentity[f.frameId]) - needs an identity
 *           READ in that frame. The briefing has no patient banner (v1.59: it
 *           shows only "Example Clinician, MD"), so there is nothing to read.
 *   Door 2  strictNameMatch(f.t, want) AND (DOB or MRN in that frame's OWN text)
 *           - measured live on the real frame, hash-compared so no PHI was
 *             handled: 2,844 chars, Active Problems present, 10 date-like
 *             strings of which NONE is the expected DOB, and 1 digit-run which
 *             is NOT the expected MRN. The second conjunct cannot be satisfied.
 * So the frame was discarded by `unboundClinicalFrames++; return;` BEFORE the
 * merge - which is exactly the observed textLen:0 while identity was proven
 * elsewhere via shadow-labels. It also explains why b753's briefing capture
 * could never have worked: capturing that text is pointless while the gate
 * throws the frame away regardless of how the text arrives.
 *
 * WHY THIS IS NOT THE SYNTHETIC FRAME THAT WAS REJECTED EARLIER: that design
 * required either special-casing a fabricated URL inside the binding gate, or
 * stamping a pseudo-frame with a real frame's frameId - special-casing a lie, or
 * forging attribution. This binds a REAL frame using an identifier athenaOne
 * itself placed in that frame's URL, compared against the appointment id the
 * caller supplied and the schedule row already proved.
 *
 * THE SAFETY PROPERTIES THIS SUITE PINS, because they are what make it legitimate:
 *   - it cannot fire without a caller-supplied appointment id, so an ordinary
 *     name-scan open (which supplies none) can never reach it
 *   - the id must match on a NON-ALPHANUMERIC BOUNDARY, so a prefix such as
 *     4079509 cannot satisfy a request for 40795090
 *   - a different id refuses
 *   - Doors 1 and 2 are byte-identical to before
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const bg = fs.readFileSync(path.join(root, 'background.js'), 'latin1');

/* ---- structural: three doors, in order, with the first two unchanged ---- */
{
  const at = bg.indexOf('const frameBoundToTarget = (f) => {');
  assert(at > 0, 'frameBoundToTarget must still exist');
  const body = bg.slice(at, at + 900);

  assert(/if \(identityMatchesTarget\(frameIdentity\[f\.frameId\]\)\) return true;/.test(body),
    'DOOR 1 must be untouched - an identity read in the frame still binds it');
  assert(/if \(!strictNameMatch\(f\.t, want\)\) return false;/.test(body),
    'DOOR 2 must still require the expected NAME in the frame own text');
  assert(/wantDob && textHasDobStrict\(f\.t, wantDob\)/.test(body) &&
         /wantMrn && textHasMrnStrict\(f\.t, wantMrn\)/.test(body),
    'DOOR 2 must still require a DOB or MRN in the frame own text');
  assert(/if \(frameUrlBindsAppointment\(f\.u\)\) return true;/.test(body),
    'DOOR 3 must consult the frame URL');

  /* the guard that keeps the whole gate meaningful must stay first */
  assert(/if \(!want \|\| \(!wantDob && !wantMrn\)\) return false;/.test(body),
    'the gate must still refuse outright when the caller supplied no name and no DOB/MRN - ' +
    'door 3 must not become a way to bind frames on an unidentified request');
  const d3 = body.indexOf('frameUrlBindsAppointment(f.u)');
  const pre = body.indexOf('if (!want || (!wantDob && !wantMrn)) return false;');
  assert(pre >= 0 && pre < d3, 'the no-identity refusal must precede door 3');
}

/* ---- behavioural: run the real predicate ---- */
{
  const start = bg.indexOf('const frameUrlBindsAppointment = (u) => {');
  assert(start > 0, 'frameUrlBindsAppointment must exist');
  const end = bg.indexOf('};', start);
  assert(end > start, 'frameUrlBindsAppointment must be sliceable');
  const src = bg.slice(start, end + 2);

  function build(expectedAppointmentId) {
    const ctx = { expectedAppointmentId };
    vm.createContext(ctx);
    vm.runInContext(src + '\nthis.__f = frameUrlBindsAppointment;', ctx, { filename: 'door3.js' });
    return ctx.__f;
  }

  /* the real measured URL binds when the id matches */
  const f = build('40795090');
  assert.strictEqual(f('https://athenanet.athenahealth.com/22724/6/ax/appointment/40795090/briefing'), true,
    'the measured Active-Problems frame URL must bind when the appointment id matches');
  assert.strictEqual(f('/22724/6/ax/appointment/40795090/briefing'), true,
    'a path-only URL must bind too - frames report varying URL forms');

  /* a DIFFERENT appointment refuses - this is the whole safety of the door */
  assert.strictEqual(f('https://athenanet.athenahealth.com/22724/6/ax/appointment/40795079/briefing'), false,
    'a DIFFERENT appointment id must NOT bind - otherwise one patient chart could be attributed ' +
    'to another, which is the worst possible failure here');

  /* prefix / suffix must not satisfy: boundary matching, not substring */
  assert.strictEqual(f('/ax/appointment/407950901/briefing'), false,
    'a LONGER id containing the wanted one as a prefix must not bind');
  const fShort = build('4079509');
  assert.strictEqual(fShort('/ax/appointment/40795090/briefing'), false,
    'a SHORTER wanted id must not be satisfied by a longer id in the URL');

  /* non-appointment surfaces must not bind even with the id present */
  assert.strictEqual(f('/22724/6/ax/briefing/40795090'), false,
    'only an /appointment/ style path may bind - the patient-level briefing route must not, ' +
    'because the number there is a patient id and not an appointment id');

  /* and with NO caller-supplied id the door is closed entirely */
  const fNone = build('');
  assert.strictEqual(fNone('/ax/appointment/40795090/briefing'), false,
    'with no caller-supplied appointment id the door must be shut - an ordinary name-scan open ' +
    'supplies none, so it can never reach this branch');
}

console.log('PASS the frame URL binds the appointment: a real frame whose own athena-issued URL ' +
  'carries the requested appointment id is bound to that patient, while a different id, a prefix, ' +
  'a longer id, a patient-level briefing route and a request with no supplied id all still refuse - ' +
  'and doors 1 and 2 are unchanged');
