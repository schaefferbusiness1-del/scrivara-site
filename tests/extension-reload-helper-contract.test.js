'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const checker = fs.readFileSync(path.join(root, 'feat_mls_checker.js'), 'utf8');
const liveLoader = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');
const stagingLoader = fs.readFileSync(path.join(root, 'mls-connect.staging.js'), 'utf8');

assert(checker.includes("params.get('mlsExtensionReload') !== '1'"), 'reload control must be absent unless the explicit support query flag is present');
assert(checker.includes("button.addEventListener('click'"), 'reload must require a visible user click');
assert(checker.includes("type: 'mlsDevReload'"), 'reload control must use the trusted MLS extension bridge');
assert(checker.includes("data.type !== 'mlsDevReloadResult'"), 'reload control must wait for the exact acknowledgement type');
assert(checker.includes('No automatic retry was attempted.'), 'reload failure must stay one-shot and honest');
assert(!checker.includes('setInterval(function () { window.postMessage'), 'reload must never run from an interval');
/* token moved 20260806chk3045 -> 20260807chk3046 deliberately with the 3.0.46
   release: feat_mls_checker.js carries SERVER_EXT_VERSION, so its immutable
   loader URL must change whenever the published version does or a returning
   browser keeps announcing the old one. The reload-control behavior this suite
   pins is unchanged. */
assert(liveLoader.includes('feat_mls_checker.js?v=20260807chk3046'), 'live checker loader must cache-bust the reload control');
assert(stagingLoader.includes('feat_mls_checker.js?v=20260807chk3046'), 'staging checker loader must match live');
assert(checker.includes("panel.className = 'mls-login-keep'"), 'reload control must remain visible on the MLS login gate');

console.log('PASS extension reload helper: query-gated, one-click, exact acknowledgement, no retry loop');
