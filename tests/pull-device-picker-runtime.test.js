'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'feat_mls_pull_device_picker.js'), 'utf8');
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'latin1');
new Function(source); // syntax gate

// --- wiring: satellite injected + relay module consults the picker -------
assert(connect.includes("feat_mls_pull_device_picker.js';"), 'pdp satellite is not injected by mls-connect.js');
assert(connect.includes('?v=20260729pdp110'), 'pdp satellite injection is not cache-busted');

// shouldRelay honors an explicit non-self target (desktop can delegate)
assert(/shouldRelay = function \(\) \{[\s\S]{0,600}__mlsPullTarget[\s\S]{0,300}!api\.extPresent\(\)/.test(connect),
  'shouldRelay does not consult the pull-target picker');

// agent: office OR secondary eligible; secondary polls targetedOnly=1 and never without a deviceId
assert(/r === 'office' \|\| r === 'secondary'/.test(connect), 'secondary computers are not agent-eligible');
assert(/sec \? '&targetedOnly=1' : ''/.test(connect), 'secondary agent does not poll targetedOnly');
assert(/if \(sec && !did\) \{ agentBusy = false; return; \}/.test(connect), 'secondary agent may poll without a device id');

// pullDay: picked device wins the job target and bypasses office fail-fast
assert(/var targetDeviceId = \(pick && pick\.id\) \|\| \(presence && presence\.officeId\) \|\| '';/.test(connect),
  'job target does not honor the picked device');
assert(/if \(!pick && p && p\.ok && !\(p\.online && p\.ext\)\)/.test(connect),
  'office-offline fail-fast not bypassed for a picked device');

// --- runtime: picker api behavior ---------------------------------------
const storage = {};
const listeners = {};
const document = {
  readyState: 'complete',
  addEventListener(type, fn) { listeners['d:' + type] = fn; },
  removeEventListener() {},
  getElementById() { return null; },
  createElement() { return { style: {}, remove() {}, appendChild() {}, insertBefore() {} }; },
  head: { appendChild() {} }, documentElement: { appendChild() {} }
};
const window = {
  __mlsDeviceRole: { deviceId: 'dev-THIS' },
  bkToken: () => '', backendMode: () => false, bkBase: () => '',
  addEventListener() {}, removeEventListener() {}
};
window.window = window;
const context = {
  window, document, Date, String, Math, JSON, console,
  localStorage: {
    getItem: (k) => (k in storage ? storage[k] : null),
    setItem: (k, v) => { storage[k] = String(v); },
    removeItem: (k) => { delete storage[k]; }
  },
  setInterval: () => 0, clearInterval() {}, setTimeout: () => 0, clearTimeout() {},
  fetch: () => Promise.resolve({ ok: false })
};
vm.createContext(context);
vm.runInContext(source, context, { filename: 'feat_mls_pull_device_picker.js' });

const api = window.__mlsPullTarget;
assert(api && api.installed && api.version === 'pdp-1.0.0', 'pull-device picker did not install');

// default = Auto (null): relay keeps office-computer behavior
assert.strictEqual(api.get(), null, 'default must be Auto');

// choose another computer -> targeted, not self
api.set('dev-LAPTOP', 'Front desk laptop');
let g = api.get();
assert(g && g.id === 'dev-LAPTOP' && g.name === 'Front desk laptop' && g.self === false, 'picked other computer wrong');

// choose THIS device -> self=true (relay treats as local/auto)
api.set('dev-THIS', 'This machine');
g = api.get();
assert(g && g.self === true, 'self pick not flagged');

// back to auto clears storage
api.set('auto');
assert.strictEqual(api.get(), null, 'auto did not clear the choice');
assert(!('mls_pull_target_device' in storage), 'auto left stale storage');

// labels are honest about role + liveness
const lbl = api._test.optionLabel({ id: 'x', name: 'Exam room PC', role: 'secondary', online: true, ext: false });
assert(/laptop\/secondary/.test(lbl) && /extension off/.test(lbl), 'option label not honest: ' + lbl);

// --- backend contract note: /jobs/next?targetedOnly=1 must skip untargeted
// jobs (enforced server-side in scrivara-backend relay.js; probed live).

console.log('pull-device-picker-runtime: all assertions passed');
