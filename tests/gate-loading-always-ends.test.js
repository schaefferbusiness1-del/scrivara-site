'use strict';

/* THE LOADING SCREEN MUST ALWAYS END.
 *
 * Reported 2026-07-26: "I CANT EVEN SIGN IN THE LOADING SCREEN HAS ME STUCK."
 *
 * #sfGateLoading is not just an overlay. Showing it puts `mls-secure-loading`
 * on <html>, and that class carries
 *     html.mls-secure-loading body>:not(#sfGateLoading){visibility:hidden!important}
 * so while it is set the ENTIRE application is invisible. Removing that class
 * is the only thing that can ever end the loading screen — and before b671,
 * every path that removed it was guarded by the sfGateHideToken bookkeeping,
 * which has interleavings with NO owner at all:
 *
 *   1. sfShowGateLoading() early-returns when the gate is already visible,
 *      BEFORE armGateForce() — a second show never re-armed the force release.
 *   2. sfHideGateLoading() clears sfGateForceTimer unconditionally at its top,
 *      so the moment a hide begins, that safety net is gone.
 *   3. sfWaitForStableFirstFrame() resolves false when the token moved, and
 *      the continuation returns WITHOUT removing the class.
 *   4. A superseded startSession never calls sfHideGateLoading at all.
 *
 * Compose 1+2+4 and nothing anywhere holds the responsibility to reveal:
 * <html> keeps the class, the body stays hidden, and the doctor watches the
 * branded loading screen forever. The b671 watchdog (sfArmGateWatchdog) is the
 * floor under all of that. This suite pins the properties that make it a
 * floor, because each one fails silently if lost.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');

function fnSource(name, src) {
  const at = src.indexOf('function ' + name + '(');
  assert.ok(at !== -1, name + '() is gone');
  /* functions in this block are flat (no nested `function ` declarations at
     column 0), so the next top-level `\nfunction ` is a safe terminator */
  const end = src.indexOf('\nfunction ', at + 1);
  return src.slice(at, end === -1 ? src.length : end);
}

const arm = fnSource('sfArmGateWatchdog', app);
const show = fnSource('sfShowGateLoading', app);
const cancel = fnSource('sfCancelGateLoading', app);
const hide = fnSource('sfHideGateLoading', app);

/* ---- 1. the watchdog exists, OUTSIDE the token bookkeeping ----
 * A `var` of its own, not a field of the token machinery: no token increment
 * may ever cancel it, because token increments are exactly what strand. */
assert.ok(/var sfGateWatchdog\s*=\s*0/.test(app),
  'sfGateWatchdog must be its own top-level handle, independent of sfGateHideToken');

/* ---- 2. the floor sits ABOVE every bound it backs up ----
 * Parsed numerically, not by eye: if someone lowers the watchdog below the 32s
 * force release or the 30.2s hydrate deadline, it starts firing during healthy
 * startups and the fail-closed branch yanks signed-in users to the login
 * screen. That would be a new defect shipped by a safety net. */
{
  const wd = /SF_GATE_WATCHDOG_MS\s*=\s*(\d+)/.exec(app);
  const max = /SF_GATE_MAX_MS\s*=\s*(\d+)/.exec(app);
  assert.ok(wd, 'SF_GATE_WATCHDOG_MS is gone');
  assert.ok(max, 'SF_GATE_MAX_MS is gone — the premise of the floor moved; re-derive the margin');
  assert.ok(Number(wd[1]) > Number(max[1]),
    'the watchdog (' + wd[1] + 'ms) must sit ABOVE the force release (' + max[1] + 'ms), ' +
    'or it fires while the normal machinery is still allowed to finish');
  assert.ok(Number(wd[1]) > 30200,
    'the watchdog must also clear startSession\'s 30.2s hydrate deadline');
}

/* ---- 3. armed on BOTH show paths, BEFORE the early return ----
 * The early return for an already-visible gate is interleaving #1 above: it
 * skips armGateForce, so it must NOT skip the watchdog. Position, not
 * presence, is the property. */
{
  const armAt = show.indexOf('sfArmGateWatchdog()');
  const earlyAt = show.indexOf('if(sfGateLoadingVisible');
  assert.ok(armAt !== -1, 'sfShowGateLoading no longer arms the watchdog');
  assert.ok(earlyAt !== -1,
    'the already-visible early return is gone from sfShowGateLoading — if a second ' +
    'show can no longer strand, update this suite deliberately rather than deleting it');
  assert.ok(armAt < earlyAt,
    'the watchdog is armed AFTER the early return — a second show while the gate ' +
    'is up (the exact stranding interleaving) never re-arms it');
}

/* ---- 4. NO document.hidden re-arm — this is the deliberate difference ----
 * Every other bound on this screen re-arms while hidden, and this product's
 * whole posture is MLS in one window with athenaOne IN FRONT — a fully
 * occluded window reports document.hidden===true on Windows. Five bounds that
 * all re-arm forever in the configuration the doctor actually works in is
 * precisely how the screen lasted forever. The floor must not be the sixth. */
/* Scan CODE only: the watchdog's own comment names `document.hidden` while
 * explaining why it must not test it, and a naive scan fails on the prose.
 * (It did, first run. The instrument lies first.) */
const armCode = arm.replace(/\/\*[\s\S]*?\*\//g, '');
assert.ok(!/document\.hidden/.test(armCode),
  'sfArmGateWatchdog re-arms on document.hidden — in an occluded window (the ' +
  'normal athenaOne-in-front posture) it would re-arm forever, which recreates ' +
  'the unbounded loading screen it exists to end');

/* ---- 5. cleared ONLY where the screen has genuinely ended ----
 * sfCancelGateLoading removes the class in the same breath, so clearing there
 * is safe. sfHideGateLoading must clear it ONLY inside the fade completion —
 * a hide that BEGINS is not a hide that FINISHES: three of its four exits
 * return early, and those are exactly the strandings the watchdog catches. */
assert.ok(/clearTimeout\(sfGateWatchdog\)/.test(cancel),
  'sfCancelGateLoading must stand the watchdog down — it removes the class itself');
{
  const clears = hide.split('clearTimeout(sfGateWatchdog)').length - 1;
  assert.strictEqual(clears, 1,
    'sfHideGateLoading must clear the watchdog in exactly one place (the fade ' +
    'completion); found ' + clears);
  const clearAt = hide.indexOf('clearTimeout(sfGateWatchdog)');
  const revealDoneAt = hide.indexOf("classList.remove('mls-app-revealing')");
  assert.ok(revealDoneAt !== -1, 'the reveal completion no longer removes mls-app-revealing');
  assert.ok(clearAt > revealDoneAt,
    'sfHideGateLoading clears the watchdog BEFORE the reveal completes — that is ' +
    'interleaving #2 all over again: the safety net dies the moment a hide begins, ' +
    'and an early-returning hide strands the screen with no floor under it');
}

/* ---- 6. it FAILS CLOSED, and never into a dead end ----
 * An unresolved hosted session must NOT have the clinical app revealed for it;
 * it goes to sign-in, which the doctor can act on. The locked agreements
 * screen is only kept when it is ALREADY up (it has a Retry control). */
assert.ok(/authScreen/.test(arm) && /switchAuth\('login'\)/.test(arm),
  'the fail-closed branch must land on the sign-in screen — the one actionable ' +
  'surface that still withholds the clinical app');
assert.ok(/appScreen'\)/.test(arm) && /app\.style\.display='none'/.test(arm),
  'the fail-closed branch must keep #appScreen hidden for an unresolved hosted ' +
  'session — revealing it would show clinical surfaces the gate exists to withhold');
assert.ok(/agreementsGate/.test(arm),
  'the watchdog must leave an already-visible agreements gate alone — it is an ' +
  'actionable screen (Retry), and replacing it with sign-in loses the context');
assert.ok(/legalState!=='verified'/.test(arm) && /showAgreementsGate\(false\)/.test(arm),
  'an authenticated identity can still be mistaken for verified legal release');

/* ---- 7. the last line of defence is unconditional ----
 * Whatever else throws, the body must not stay hidden. */
assert.ok(/catch\(e\)\{[\s\S]{0,200}?classList\.remove\('mls-secure-loading','mls-app-revealing'\)/.test(arm),
  'the watchdog\'s catch must still remove the hiding classes — it is the only ' +
  'path with no dependency on any app function resolving');

/* ---- 8. the premise still holds ----
 * All of this matters only while the class hides the world and show still
 * sets it. If either moves, re-derive rather than delete. */
assert.ok(app.indexOf('html.mls-secure-loading body>:not(#sfGateLoading){visibility:hidden!important}') !== -1,
  'the whole-body hiding rule is gone — the watchdog\'s reason to exist moved; ' +
  're-derive the stranding analysis before touching this suite');
assert.ok(/classList\.add\('mls-secure-loading'\)/.test(show),
  'sfShowGateLoading no longer sets mls-secure-loading');

/* ---- 9. STAGING: not affected, and this pins WHY ----
 * Staging\'s sfShowGateLoading is a plain overlay: no mls-secure-loading, no
 * token bookkeeping, nothing that can strand a hidden body. If it ever gains
 * the class machinery, the watchdog must be carried across deliberately. */
{
  const staging = fs.readFileSync(path.join(root, 'ScribeFlow-staging.html'), 'utf8');
  assert.ok(!/mls-secure-loading/.test(staging),
    'ScribeFlow-staging.html now uses mls-secure-loading. Its gate overlay was a ' +
    'plain display toggle with nothing to strand; with the class machinery it ' +
    'inherits the stranding interleavings WITHOUT the watchdog. Port sfArmGateWatchdog.');
}

/* ---- 10. the guard can fail ----
 * The position assertions in #3 and #5 are the load-bearing ones; prove each
 * detector actually distinguishes the broken shape from the shipped one. */
{
  const brokenShow = "function sfShowGateLoading(){\n  if(sfGateLoadingVisible&&el.style.display!=='none') return el;\n  sfArmGateWatchdog();\n}";
  assert.ok(brokenShow.indexOf('sfArmGateWatchdog()') > brokenShow.indexOf('if(sfGateLoadingVisible'),
    'detector #3 cannot tell arm-after-early-return from arm-before — it would pass on the regression');
  const brokenHide = "function sfHideGateLoading(){\n  clearTimeout(sfGateWatchdog);\n  x.classList.remove('mls-app-revealing');\n}";
  assert.ok(brokenHide.indexOf('clearTimeout(sfGateWatchdog)') < brokenHide.indexOf("classList.remove('mls-app-revealing')"),
    'detector #5 cannot tell clear-at-top from clear-at-completion — it would pass on the regression');
}

/* ---- 11. execute the legal-state branches, not just their vocabulary ----
 * bkUser proves identity only. A hung /api/agreements/me must land on the
 * locked Retry surface; only the explicit verified state may reveal the app. */
function runWatchdog(legalState, live) {
  let scheduled = null, locked = 0, login = 0;
  const classes = new Set(['mls-secure-loading']);
  const elements = {
    agreementsGate: { style: { display: 'none' } },
    appScreen: { style: { display: 'block' } },
    authScreen: { style: { display: 'none' } }
  };
  const context = {
    SF_GATE_WATCHDOG_MS: 40000,
    sfGateWatchdog: 0,
    sfSessionLegalState: legalState,
    bkUser: live ? { email: 'doctor@example.test' } : null,
    backendMode() { return true; },
    bkToken() { return live ? 'token' : ''; },
    clearTimeout() {},
    setTimeout(fn, ms) { scheduled = { fn, ms }; return 1; },
    document: {
      documentElement: { classList: {
        contains(name) { return classes.has(name); },
        remove(...names) { names.forEach(name => classes.delete(name)); }
      } },
      getElementById(id) { return elements[id] || null; }
    },
    sfCancelGateLoading() { classes.delete('mls-secure-loading'); classes.delete('mls-app-revealing'); },
    showAgreementsGate() {
      locked++;
      elements.appScreen.style.display = 'none';
      elements.authScreen.style.display = 'none';
      elements.agreementsGate.style.display = 'block';
    },
    switchAuth(mode) { if (mode === 'login') login++; }
  };
  vm.createContext(context);
  vm.runInContext(arm + '\nthis.arm=sfArmGateWatchdog;', context);
  context.arm();
  assert(scheduled && scheduled.ms === 40000, 'watchdog runtime did not arm at its declared deadline');
  scheduled.fn();
  return { elements, classes, locked, login };
}

{
  const unknownIdentity = runWatchdog('unknown', true);
  assert.strictEqual(unknownIdentity.locked, 1, 'unknown legal state with bkUser did not open the locked Retry surface');
  assert.strictEqual(unknownIdentity.elements.appScreen.style.display, 'none', 'unknown legal state exposed the clinical app');
  assert.strictEqual(unknownIdentity.elements.agreementsGate.style.display, 'block');

  const verifiedIdentity = runWatchdog('verified', true);
  assert.strictEqual(verifiedIdentity.locked, 0, 'verified legal state was incorrectly re-locked');
  assert.strictEqual(verifiedIdentity.elements.appScreen.style.display, 'block', 'verified legal state did not reach the app recovery path');

  const unknownIdentityAndAuth = runWatchdog('unknown', false);
  assert.strictEqual(unknownIdentityAndAuth.elements.appScreen.style.display, 'none');
  assert.strictEqual(unknownIdentityAndAuth.elements.authScreen.style.display, 'flex');
  assert.strictEqual(unknownIdentityAndAuth.login, 1, 'unresolved identity did not return to actionable sign-in');
}

console.log('PASS gate-loading-always-ends: the watchdog is armed on every show path, ' +
  'outlives every early-returning hide, ignores document.hidden, and executes a ' +
  'fail-closed legal-state recovery to a screen the doctor can act on');
