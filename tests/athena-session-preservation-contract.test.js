'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8');

function between(begin, end) {
  const a = source.indexOf(begin);
  assert(a >= 0, `missing ${begin}`);
  const b = source.indexOf(end, a + begin.length);
  assert(b > a, `missing ${end}`);
  return source.slice(a, b);
}

const recovery = between('async function mlsRecoverAthenaTab(tabId)', '/* Session ownership stays with Athena.');
assert(!/chrome\.tabs\.reload\s*\(/.test(recovery), 'read recovery must never reload the Athena tab');
assert(!/mlsAthenaContinueFn\s*\(/.test(recovery), 'read recovery must not click through a session interstitial');
assert(/automatic-reload-disabled/.test(recovery));
assert(/tabUntouched:\s*true/.test(recovery));

const interstitial = between('function mlsAthenaContinueFn()', '/* Worker-scope: session-safe recovery');
assert(!/\.click\s*\(/.test(interstitial), 'the extension must not click through Athena session/CSRF screens');
assert(/manualActionRequired:\s*true/.test(interstitial));

const keepAlive = between('function mlsKeepAlivePageFn()', 'async function mlsArmKeepAlive');
assert(!/MouseEvent|scrollBy|dispatchEvent|new\s+Worker/.test(keepAlive), 'MLS must not synthesize activity to defeat Athena session policy');
assert(/session-owned-by-athena/.test(keepAlive));

const backup = between('async function runNightlyBackup(trigger)', 'chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {');
assert(!/chrome\.tabs\.update\s*\([^)]*\{\s*url\s*:/.test(backup), 'backup must not navigate the user\'s Athena tab');
assert(!/roster\s*\[/.test(backup), 'backup must not walk chart links in the user\'s Athena tab');
assert(/navigationDisabled:\s*true/.test(backup));

console.log('PASS Athena session preservation: no automatic reload, interstitial click-through, or background chart walking');
