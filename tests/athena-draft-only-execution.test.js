'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');
const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
const content = fs.readFileSync(path.join(root, 'content.js'), 'utf8');
const safetyContext = { console: { warn() {} } };
vm.runInNewContext(fs.readFileSync(path.join(root, 'write_safety_guard.js'), 'utf8'), safetyContext);
const safety = safetyContext.MLSWriteSafety;
function between(s, a, b) {
  const start = s.indexOf(a), end = s.indexOf(b, start + a.length);
  assert(start >= 0 && end > start, 'source boundary missing');
  return s.slice(start + a.length, end);
}
const driverContext = {};
vm.runInNewContext(between(background, '/* ATHENA_ACTION_V2_DRIVER_START */', '/* ATHENA_ACTION_V2_DRIVER_END */'), driverContext);
const driver = driverContext.mlsAthenaActionV2DriverFn;
assert.equal(typeof driver, 'function');
const denied = ['sign_encounter', 'stage_billing', 'place_order', 'prescribe', 'claim', 'check_in', 'close_encounter', 'finalize', '', 'constructor', '__proto__', 'toString', 'write_note_extra'];
let checks = 0;
(async () => {
  for (const action of denied) {
    const gate = safety.gateActionRequest({ mode: 'execute', action });
    assert(gate && gate.blocked, 'shared policy allowed ' + action); checks++;
    for (const mode of ['probe', 'execute']) {
      const result = await driver({ mode, action });
      assert.equal(result.reason, 'unknown-action', 'driver reached DOM for ' + action);
      assert.equal(result.blocked, true); checks += 2;
    }
  }
  for (const action of ['write_note', 'save_draft']) {
    assert.equal(safety.gateActionRequest({ mode: 'execute', action, noteText: 'Reviewed clinical narrative.' }), null); checks++;
    assert.equal(safety.gateActionRequest({ mode: 'execute', action, isTest: true }).reason, 'test-content-production-disabled'); checks++;
  }
  const bridgeGate = between(content, "var mutating = athMode === 'execute';", '/* MLS_WRITE_SAFETY_BRIDGE_GATE');
  const runBridge = new Function('athMode', 'athAction', 'reply', 'd', 'mlsStr', bridgeGate + '\nreturn true;');
  for (const action of denied) {
    let result;
    runBridge('execute', action, r => { result = r.resp; }, { requestId: 'synthetic' }, String);
    assert(result && result.blocked, 'bridge allowed ' + action); checks++;
  }
  for (const action of ['write_note', 'save_draft']) {
    assert.equal(runBridge('execute', action, () => { throw new Error('allowed draft action refused'); }, {}, String), true); checks++;
  }
  const handlerGate = between(background, "var mode = clean(msg.mode).toLowerCase(), action = clean(msg.action).toLowerCase();", '/* MLS_WRITE_SAFETY_GATE_START');
  const runHandler = new Function('msg', 'clean', 'var mode = clean(msg.mode).toLowerCase(), action = clean(msg.action).toLowerCase();' + handlerGate + '\nreturn true;');
  for (const action of denied) {
    const result = runHandler({ mode: 'execute', action }, String);
    assert(result && result.blocked, 'worker dispatch allowed ' + action); checks++;
  }
  assert(!background.includes("wsForbiddenControl(el) && !(action === 'sign_encounter'"), 'final-control exception remains'); checks++;
  console.log(JSON.stringify({ suite: 'athena-draft-only-execution', checks, passed: true }));
})().catch(error => { console.error(error.message); process.exitCode = 1; });
