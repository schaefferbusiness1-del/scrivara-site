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
/* setfix-1.0.0 (b1169, n=39/60/73): the hand-maintained token this comment
   used to describe bumping (...chk3080 -> ...chk3081) is exactly what froze
   at 20260827chk3084 for five releases (3.0.84 through 3.0.101) while nobody
   bumped it by hand — the frozen-token failure this suite's neighbor,
   tests/immutable-satellite-loader-cache-contract.test.js, now retires. The
   live loader follows the shared __MLS_AV build token instead, so it cannot
   freeze behind a stale literal again. Staging is not migrated in this pass
   (mls-connect.staging.js is off the clinician path) and keeps its last
   hand-maintained token. The reload-control behavior this suite pins is
   unchanged either way. */
assert(liveLoader.includes("feat_mls_checker.js?v='+(window.__MLS_AV||Date.now())"), 'live checker loader must follow the build token so it can never freeze behind a stale literal');
assert(stagingLoader.includes('feat_mls_checker.js?v=20260827chk3084'), 'staging checker loader still carries its last hand-maintained token (not migrated in this pass)');
assert(checker.includes("panel.className = 'mls-login-keep'"), 'reload control must remain visible on the MLS login gate');

console.log('PASS extension reload helper: query-gated, one-click, exact acknowledgement, no retry loop');
