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
/* recovervocab-1.0.0 (2026-08-28): this pinned ONE skip token,
   'automatic-reload-disabled', which the worker replaced with a vocabulary that
   says which refusal applied and what the tab's state is:
     tab-missing / non-athena-tab            nothing to act on
     athena-signed-out        + manualSignIn the OWNER signs in, never us
     recovery-throttled       + manualRefresh + tabUntouched
     quiet-probe-active                      + tabUntouched
     practice-segment-unknown + manualRefresh + tabUntouched
     recovery-failed          + manualRefresh + tabUntouched
   That is strictly more protective than the single token: it separates "signed
   out, a human must act" from "declined for now, and the tab was not touched",
   which is the distinction the session-preservation rule is actually about.
   background.js is frozen at 3.0.84 by owner order, so the test was the only
   thing that could move here - and it was also the thing that was wrong.
   The two assertions above are the real guarantees and both still hold: this
   recovery never reloads the tab and never clicks through an interstitial.
   Pinned below: every refusal names itself, a signed-out session is handed to
   the owner rather than automated, and any refusal that could have touched the
   tab declares that it did not. */
{
  const returns = recovery.match(/return \{[^}]*\}/g) || [];
  assert(returns.length >= 4, 'the recovery collapsed to fewer exits than it has refusal reasons');
  const declines = returns.filter((r) => /ok:\s*false/.test(r));
  assert(declines.length >= 4, 'the recovery no longer distinguishes its refusal reasons');
  for (const r of declines) {
    assert(/skipped:\s*'[a-z-]+'/.test(r),
      'a recovery refusal carries no reason, so a surface cannot tell the doctor what to do: ' + r.replace(/\s+/g, ' '));
  }
  assert(declines.some((r) => /skipped:\s*'athena-signed-out'/.test(r) && /manualSignIn:\s*true/.test(r)),
    'a signed-out Athena session is no longer handed to the owner as a MANUAL sign-in - signing in is his click, never ours');
  assert(declines.some((r) => /tabUntouched:\s*true/.test(r)),
    'no refusal declares the tab untouched any more, so nothing records that a declined recovery left the session alone');
  assert(!/chrome\.tabs\.update\([^)]*url:\s*[^)]*login/i.test(recovery),
    'the recovery navigates the Athena tab toward a login URL - that is how a live session gets thrown away');
}
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
