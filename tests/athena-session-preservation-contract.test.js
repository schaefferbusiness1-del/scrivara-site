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

/* recover-1.1.0 (extension 3.0.107): the recovery grew a SECOND parameter -
   `async function mlsRecoverAthenaTab(tabId, ownerToken)`, the day-schedule
   lease holder asking for its own reload. The anchor here pinned the exact
   argument list `(tabId)`, so a signature change that touched none of this
   suite's guarantees made `between()` throw "missing async function
   mlsRecoverAthenaTab(tabId)" - the extractor never reached the subject and
   every assertion below stopped running (A RED SUITE MAY NEVER HAVE RUN).
   Re-aimed at the function's NAME, which is the property this suite is about;
   the parameter list is not. Every guarantee below was re-measured against the
   3.0.110 bytes and holds unchanged: 9 returns, 8 refusals, 4 declaring the tab
   untouched, 2 handing sign-in to the owner, no reload, and no call into the
   interstitial handler from the recovery path at all. */
const recovery = between('async function mlsRecoverAthenaTab(', '/* Session ownership stays with Athena.');
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
/* contfix-1.0.0 (extension 3.0.100, measured live 2026-09-01): this handler used
   to only REPORT athena's CSRF retry interstitial. Reporting without acting was
   the wedge - every goHome/gotoDate round re-detected the same page and did
   nothing, and a month pull burned whole days until a human clicked Continue
   (~10 wedges in one pull, each cured by exactly that click). The handler now
   presses athena's OWN Continue, which re-issues the SAME read-only navigation
   with a fresh CSRF token.

   The blanket `no .click( anywhere in this function` pin below could not tell
   that apart from clicking through a sign-out, so it read a fix as a violation.
   It is re-aimed at the rule this suite is actually about - MLS never disposes
   of the owner's session and never presses a transactional control - by pinning
   the four narrowing guards CLOSED instead of banning the verb:
     1. exactly ONE click exists in the whole handler;
     2. it is reachable only on the exact retry page;
     3. never on a page carrying sign/order/billing/payment/prescribing words;
     4. only a control whose whole label is "Continue"; and
     5. a session-EXPIRED variant still falls to the manual path.
   Order is pinned too, so a later edit cannot hoist the click above its guards.
   Anything broader than this - a second click, a looser label match, a lost ban
   token - reds this suite. Signing back in stays the owner's click, always. */
{
  const clicks = interstitial.match(/\.click\s*\(/g) || [];
  assert.strictEqual(clicks.length, 1,
    'the interstitial handler no longer presses exactly ONE control - a second click path is a new way ' +
    'to press something that is not athena\'s read-only Continue');
  const iRetryPage = interstitial.indexOf('var retryPage = /unable to complete the requested action/i.test(body);');
  assert(iRetryPage >= 0,
    'the click is no longer gated on the exact CSRF retry page - a session-expired screen could now be clicked through');
  /* The ban list IS the safety property here, so it is pinned as the exact
     guard expression rather than by loose word search - "sign" and "billing"
     both occur in this handler's own prose, so a substring scan would stay
     green after the real guard was deleted (a green canary that means
     UNREACHABLE, not untested). Verified by mutation: dropping any one token
     from the shipped guard reds this line. */
  const BAN_GUARD = "!/sign\\s*&?\\s*save|place order|billing|payment|prescri/i.test(body)";
  const iBan = interstitial.indexOf(BAN_GUARD, iRetryPage);
  assert(iBan > 0,
    'the transactional-vocabulary ban changed shape. The handler may now press Continue on a page that ' +
    'signs, orders, bills or prescribes. Re-read the guard, confirm every one of sign&save / place order / ' +
    'billing / payment / prescri is still refused, then move this pin deliberately. Expected: ' + BAN_GUARD);
  const iExact = interstitial.indexOf('/^continue$/i.test(v)', iBan);
  const iClick = interstitial.indexOf('.click(', iExact);
  assert(iExact > iBan && iBan > iRetryPage,
    'the retry-page gate and the transactional ban no longer precede the label match');
  assert(iClick > iExact,
    'the click no longer sits BEHIND the exact-label match - a hoisted click presses whatever the page offers first');
}
assert(/manualActionRequired:\s*true/.test(interstitial),
  'a session-expired interstitial no longer falls to the manual path - signing back in is the owner\'s click, never ours');

const keepAlive = between('function mlsKeepAlivePageFn()', 'async function mlsArmKeepAlive');
assert(!/MouseEvent|scrollBy|dispatchEvent|new\s+Worker/.test(keepAlive), 'MLS must not synthesize activity to defeat Athena session policy');
assert(/session-owned-by-athena/.test(keepAlive));

const backup = between('async function runNightlyBackup(trigger)', 'chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {');
assert(!/chrome\.tabs\.update\s*\([^)]*\{\s*url\s*:/.test(backup), 'backup must not navigate the user\'s Athena tab');
assert(!/roster\s*\[/.test(backup), 'backup must not walk chart links in the user\'s Athena tab');
assert(/navigationDisabled:\s*true/.test(backup));

console.log('PASS Athena session preservation: no automatic reload of the owner\'s tab, no background chart walking, ' +
  'and the ONE interstitial press is athena\'s own read-only Continue behind every narrowing guard (retry page, ' +
  'transactional-vocabulary ban, exact label, click ordered behind all of them, manual path for session-expired)');
