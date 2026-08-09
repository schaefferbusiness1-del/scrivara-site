/* mp-1.0 (3.0.55) - department-scope primitives (deptGet/deptSet).
 *
 * Census 2026-08-09: the Day-view widget has NO within-view provider filter;
 * the DEPARTMENTID select is the ONLY drivable scope control, so multi-provider
 * coverage = department switching. The extension ships PRIMITIVES ONLY: policy
 * (always-restore on every exit, never while the owner works, switch = day-flip)
 * lives si-side. These pins hold the primitives to that shape.
 */
'use strict';
const fs = require('fs');
const path = require('path');
let checks = 0;
function ok(cond, label) {
  checks++;
  if (!cond) { console.error('FAIL department-scope-primitives: ' + label); process.exit(1); }
}

const SRC = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'latin1');

ok(SRC.includes("if (op === 'deptGet') {"), 'deptGet op exists');
ok(SRC.includes("if (op === 'deptSet') {"), 'deptSet op exists');

const dgAt = SRC.indexOf("if (op === 'deptGet') {");
const dsAt = SRC.indexOf("if (op === 'deptSet') {");
const diagAt = SRC.indexOf("if (op === 'diagnose') { return diagnose(); }");
ok(dgAt > 0 && dsAt > dgAt && diagAt > dsAt, 'both ops sit in the injected op family (before diagnose)');

const deptBlock = SRC.slice(dgAt, diagAt);
ok(deptBlock.includes("return { ok: false, reason: 'dept-target-not-an-option' };"),
  'deptSet fails CLOSED on a value the select itself does not offer');
ok(deptBlock.includes('prev: dsPrev'),
  'deptSet returns prev so the si orchestration can restore on EVERY exit path');
ok(deptBlock.includes("return { ok: true, prev: dsPrev, now: dsPrev, changed: false };"),
  'a no-op set (already on target) reports changed:false without firing events');
ok(!/location\.(assign|href|replace)/.test(deptBlock),
  'CONTROL: the dept primitives never navigate - whatever navigation athena wires to the select is athena\'s own');
ok(deptBlock.includes('cfg.deptList === true'),
  'the 216-option census rides only when the caller asks (config-time read)');
ok(deptBlock.indexOf('patient') === -1 && deptBlock.indexOf('mrn') === -1 && deptBlock.indexOf('dob') === -1,
  'the dept ops touch no patient fields - department names are practice metadata, not PHI');

/* The primitive must NOT contain restore LOGIC - restore is policy and lives
   si-side where the pull lifecycle can guarantee it on success, failure, AND
   exception. A restore baked into the primitive would fire mid-sequence.
   (Comments may MENTION restore; code that sets the select back may not.) */
ok(!deptBlock.includes('dsSel.value = dsPrev') && !/deptRestore/.test(deptBlock),
  'no restore logic in the primitive (policy lives si-side)');

console.log('department-scope-primitives: PASS (' + checks + ' checks)');
