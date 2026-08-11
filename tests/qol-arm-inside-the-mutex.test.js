'use strict';
/* THE ARM-GUARD LAW, AS A FAILING-WHEN-VIOLATED TEST (supervisor order,
   2026-08-10): "ARM INSIDE THE MUTEX, OWN YOUR DISARM." The shape fired
   THREE times in one train — _pullBodiesOverride armed at pull() entry,
   __historyRetryForeground armed before dayPull's advisory check, and four
   settle-path mlsAppFocusMlsTab senders firing without lock ownership
   (authored while quoting the rule). A law that lives only in prose gets
   re-broken; this is the law as an assertion, same shape as the
   fifth-reader guard. A NEW per-operation flag near a single-flight guard
   belongs in the TABLE below. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const si = fs.readFileSync(path.join(__dirname, '..', 'feat_mls_schedimport_exact.js'), 'latin1');

/* ---- the scanner: arm-sites must sit inside their owner regions, and every
       disarm must be ownership-guarded. Exercised on the real tree AND on a
       synthetic violation so green proves the instrument fires. ---- */
function scan(src, rules) {
  const violations = [];
  for (const rule of rules) {
    let idx = 0;
    const armRe = new RegExp(rule.arm.source, 'g');
    let m;
    while ((m = armRe.exec(src)) !== null) {
      const inside = rule.ownerRegions.some(([b, e]) => m.index > b && m.index < e);
      if (!inside) violations.push(rule.name + ': armed at offset ' + m.index + ' OUTSIDE every owner region');
    }
    for (const dis of rule.disarms) {
      const n = (src.match(new RegExp(dis.re.source, 'g')) || []).length;
      if (n !== dis.count) violations.push(rule.name + ': expected ' + dis.count + ' guarded disarm(s) [' + dis.why + '], found ' + n);
    }
    for (const banned of rule.bannedDisarms || []) {
      if (new RegExp(banned.source).test(src)) violations.push(rule.name + ': UNGUARDED disarm present (' + banned.source + ')');
    }
  }
  return violations;
}

function region(src, startMarker, endMarker, label) {
  const b = src.indexOf(startMarker);
  assert.ok(b > 0, label + ' start found');
  const e = src.indexOf(endMarker, b);
  assert.ok(e > b, label + ' end found');
  return [b, e];
}

/* owner regions on the real tree */
const runRegion = region(si, 'var run = function () {', 'return runManagedAthenaOperation(run', 'pull() run closure');
const retryArmRegion = region(si, 'function retryFailedHistory', 'function dayPull(opts)', 'retry lane');
const armPresenceRegion = region(si, 'var __armPresence = function () {', '};', '__armPresence definition');
/* __armPresence may only be INVOKED after the advisory gate or at the
   no-date engine handoff — both inside __dayPullInner */
const innerRegion = region(si, 'function __dayPullInner(opts, __armPresence)', 'var explicit =', '__dayPullInner head');

const RULES = [
  {
    name: '_pullBodiesOverride',
    arm: /_pullBodiesOverride = \(typeof opts\.pullVisitBodies === "boolean"\) \? opts\.pullVisitBodies : null;/,
    ownerRegions: [runRegion],
    disarms: [{ re: /if \(__ownedPull\) _pullBodiesOverride = null;/, count: 2, why: 'both settle paths clear only when this call owned the pull' }],
    bannedDisarms: [/\n\s*_pullBodiesOverride = null;/]
  },
  {
    name: '__historyRetryForeground',
    arm: /__historyRetryForeground = true;/,
    ownerRegions: [retryArmRegion, armPresenceRegion],
    disarms: [{ re: /if \(__armedHere\) __historyRetryForeground = false;/, count: 2, why: 'dayPull settle paths disarm only if this call armed' }]
  }
];

const real = scan(si, RULES);
assert.deepStrictEqual(real, [], 'arm-guard violations on the live tree:\n' + real.join('\n'));

/* the arm callback itself is invoked only past the ownership decision */
const callSites = [];
let ci = innerRegion[0];
while ((ci = si.indexOf('__armPresence();', ci + 1)) > 0 && ci < innerRegion[1] + 4000) callSites.push(ci);
assert.strictEqual(callSites.length, 2, 'exactly two arm invocations (no-date engine handoff + post-advisory)');
const advisoryIdx = si.indexOf('if (pullRunning || foreignPullLease()) {', innerRegion[0]);
assert.ok(callSites[1] > advisoryIdx, 'the batch arm invocation sits AFTER the advisory in-flight check');

/* the third instance stays dead: release signals belong to the lock owner.
   Exactly one managed-release sender, zero settle-path duplicates. */
assert.strictEqual((si.match(/type: "mlsAppFocusMlsTab", from: "mls-managed-pull"/g) || []).length, 1, 'one ownership-gated release sender');
assert.strictEqual((si.match(/__fgEndOfOp/g) || []).length, 0, 'no settle-path release sender may return');

/* ---- EXECUTED NON-VACUITY: the OLD shapes fail this scanner by name ---- */
const oldEntryArm = 'function pull(opts) {\n    _pullBodiesOverride = (typeof opts.pullVisitBodies === "boolean") ? opts.pullVisitBodies : null;\n    var run = function () {\n      return runManagedAthenaOperation(run\n';
const v1 = scan(oldEntryArm, [{ name: '_pullBodiesOverride', arm: RULES[0].arm, ownerRegions: [region(oldEntryArm, 'var run = function () {', 'return runManagedAthenaOperation(run', 'synthetic run')], disarms: [] }]);
assert.ok(v1.length === 1 && /OUTSIDE every owner region/.test(v1[0]), 'non-vacuity: the pre-fix entry-arm shape is flagged by name');

const oldUnguardedClear = '\n      _pullBodiesOverride = null;\n';
const v2 = scan(oldUnguardedClear, [{ name: '_pullBodiesOverride', arm: /never-matches-x9/, ownerRegions: [], disarms: [], bannedDisarms: RULES[0].bannedDisarms }]);
assert.ok(v2.length === 1 && /UNGUARDED disarm/.test(v2[0]), 'non-vacuity: the pre-fix unconditional settle-clear is flagged by name');

console.log('qol-arm-inside-the-mutex: OK (both flags arm only inside their owners, disarms ownership-guarded, arm-callback invoked past the advisory, one release sender zero duplicates; both OLD shapes fail the scanner by name)');
