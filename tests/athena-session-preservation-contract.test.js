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
  /* recovervocab-1.0.1 (2026-08-28): `some` where the comment promised EVERY.
     A completeness review measured it: 8 declining returns, 4 carrying
     tabUntouched - so three of those four could lose it and this stayed green.
     But "every refusal declares tabUntouched" is not the honest rule either,
     because two of the eight have no tab to touch at all and two hand the
     session to the owner. The real rule is a PARTITION: every refusal either
     declares the tab untouched, or says why it could not have touched one.
     Pinned closed, with the counts, so a refusal cannot quietly drift out of
     its category. */
  const NO_TAB_TO_TOUCH = /skipped:\s*'(?:tab-missing|non-athena-tab)'/;
  const HANDED_TO_OWNER = /manualSignIn:\s*true/;
  const uncategorised = declines.filter((r) =>
    !/tabUntouched:\s*true/.test(r) && !NO_TAB_TO_TOUCH.test(r) && !HANDED_TO_OWNER.test(r));
  assert.deepStrictEqual(uncategorised.map((r) => r.replace(/\s+/g, ' ')), [],
    'a recovery refusal neither declares the tab untouched, nor says there was no tab to touch, nor hands ' +
    'the session to the owner. It is a refusal that MIGHT have touched a live Athena session and does not say.');
  assert.strictEqual(declines.filter((r) => /tabUntouched:\s*true/.test(r)).length, 4,
    'the number of refusals declaring the tab untouched changed. Audit the new one and move this pin ' +
    'deliberately - the whole point is that a refusal cannot slip out of the untouched set unnoticed.');
  assert.strictEqual(declines.filter((r) => HANDED_TO_OWNER.test(r)).length, 2,
    'the signed-out refusals that hand the session to the owner changed in number - signing in is his click, never ours');
  /* The shallow `return {...}` scan cannot see a NESTED object literal, so a
     refusal that grew one would silently drop out of every check above. Compare
     against a raw count of return-object openings. */
  assert.strictEqual((recovery.match(/return \{/g) || []).length, returns.length,
    'a recovery return carries a NESTED object, so the shallow scan above no longer sees every exit - ' +
    'the categorisation is incomplete and would pass by omission');
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
