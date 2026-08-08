'use strict';

/* A ROLE THE DEVICE CANNOT HONOUR IS NOT A ROLE  (dr-1.3.0, 2026-08-07)
 * =============================================================================
 * FROM THE OWNER'S OWN PHONE. He sent a screenshot of mlsscribe.com in Safari
 * on his iPhone saying "it's not updated". The screenshot showed the FULL
 * DESKTOP APP — the 7-item dock, the Prep/Record/Review/Sign/Send stage rail,
 * the whole workspace — on a 390px screen. No phone layer at all, old or new.
 *
 * The cause was one stored string. His iPhone had `mls_device_role = 'office'`,
 * and three separate failures fall out of that single value. All three were
 * visible in the one screenshot:
 *
 *   1. wantPhone() returns `r === 'phone'` the moment ANY role is stored, so
 *      'office' is a hard NO to every phone layer. That is the desktop app in
 *      the screenshot.
 *   2. setRole() writes sessionStorage mls_phone_mode='0' alongside the role,
 *      and wantPhone() checks that flag BEFORE it reads the role — so the
 *      refusal was locked twice over, and even ?phone=1 could not lift it
 *      within the session.
 *   3. The relay aimed every Athena pull at an iPhone. The amber line in the
 *      same screenshot reads: '"iOS · Safari" (iOS) is set as your office
 *      computer, but MLS Assist is a [Chrome extension and iOS cannot install
 *      one]'. The pull could not have worked on any day.
 *
 * AND THE APP ALREADY KNEW. canHostExtension() has returned false for
 * iOS/iPadOS/Android since dr-1.2.0, which was itself written after observing
 * THIS PHONE at b853. What that fix changed was the wording of the complaint.
 * The value stayed, the pull stayed dead, and the phone UI stayed unreachable.
 * A diagnosis the app repeats in amber for days while continuing to act on the
 * thing it just diagnosed is not a fix.
 *
 * So the check moved to the read. This suite executes the real code.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');

const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const MAC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

/* ---------------------------------------------------------------------------
 * 1. THE REAL role() / setRole() LOGIC, EXECUTED
 * -------------------------------------------------------------------------*/
const drAt = connect.indexOf('__mlsDeviceRole dr-1');
assert(drAt > 0, 'the device-role module could not be located');
const roleSrc = (() => {
  const from = connect.indexOf('function roleUnhonourable(r)', drAt);
  const to = connect.indexOf("lsSet('mls_device_role', r);", from);
  assert(from > 0 && to > from, 'the role read/write region could not be sliced');
  /* The slice deliberately starts ABOVE the install-time repair, so running it
     executes that repair exactly as a page load would. If the repair were ever
     moved back inside role(), this slice would still run it — but the
     ordering assertion at the end of section 2 would fail, which is the one
     that actually reproduces the screenshot. */
  return connect.slice(from, to) + "lsSet('mls_device_role', r); return true; };";
})();
assert(/removeItem\('mls_phone_mode'\)/.test(roleSrc),
  'the install-time stale-flag repair must live inside the sliced region, or this suite grades nothing');

function makeRole(opts) {
  const store = Object.assign({}, opts.stored);
  const session = Object.assign({}, opts.session);
  const toasts = [];
  const api = {};
  const ctx = {
    api,
    ls: (k) => (store[k] == null ? null : store[k]),
    lsSet: (k, v) => { store[k] = String(v); },
    sessionStorage: {
      getItem: (k) => (session[k] == null ? null : session[k]),
      setItem: (k, v) => { session[k] = String(v); },
      removeItem: (k) => { delete session[k]; }
    },
    validRole: (r) => r === 'office' || r === 'secondary' || r === 'phone',
    canHostExtension: () => !!opts.canHostExtension,
    deviceNoun: () => opts.noun || 'iPhone',
    OS: opts.os || 'iOS',
    toast: (m, k) => { toasts.push({ m: String(m), k }); }
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(roleSrc, ctx, { filename: 'device-role.js' });
  return { api, store, session, toasts };
}

/* The exact state on the owner's phone. */
{
  const r = makeRole({ canHostExtension: false, os: 'iOS', noun: 'iPhone',
    stored: { mls_device_role: 'office' }, session: { mls_phone_mode: '0' } });

  assert.strictEqual(r.api.role(), null,
    "THE ONE FROM THE SCREENSHOT: an iPhone storing 'office' must read as no role at all. " +
    'While it read as a role, wantPhone() answered `office === phone` = false and the phone ' +
    'got the full desktop workspace.');
  assert.strictEqual(r.api.roleRefused(), 'office',
    'the refusal must be reportable, or the Settings panel shows a role the app is ignoring');
  assert.strictEqual(r.session.mls_phone_mode, undefined,
    "the mls_phone_mode='0' that setRole wrote beside the role must be refused WITH it — " +
    'wantPhone() reads that flag first, so leaving it keeps the refusal locked');

  /* The repair is an INSTALL-TIME one-shot, and that is load-bearing rather
     than tidy: wantPhone() short-circuits on the flag before it ever calls
     role(), so a clear that waited for the first role() call would never run.
     role() itself must stay a pure read — it is on a 1600ms pass. */
  r.session.mls_phone_mode = '0';
  r.api.role();
  assert.strictEqual(r.session.mls_phone_mode, '0',
    'role() must not write: it runs on a repeating pass, and the repair already happened at install');
}

/* It cannot be re-created by the same tap that created it. */
{
  const r = makeRole({ canHostExtension: false, os: 'iOS', noun: 'iPhone', stored: {}, session: {} });
  assert.strictEqual(r.api.setRole('office'), false, 'an iOS device must refuse the office role outright');
  assert.strictEqual(r.store.mls_device_role, undefined, 'and must not store it');
  assert.strictEqual(r.toasts.length, 1, 'a refusal the user cannot see is a control that silently does nothing');
  assert(/cannot be the office computer/.test(r.toasts[0].m) && /Chrome desktop/.test(r.toasts[0].m),
    'the refusal must say WHY: ' + (r.toasts[0] || {}).m);
  assert(/Windows or Mac computer that has MLS Assist/.test(r.toasts[0].m),
    'and must name the device that CAN do it — a refusal with no route is a dead end');
}

/* The roles a phone can genuinely hold are untouched. */
{
  const r = makeRole({ canHostExtension: false, os: 'iOS', stored: {}, session: {} });
  assert.strictEqual(r.api.setRole('phone'), true, 'a phone may still be a phone');
  assert.strictEqual(r.api.role(), 'phone', 'and that role reads back');
  const s = makeRole({ canHostExtension: false, os: 'iOS', stored: { mls_device_role: 'secondary' }, session: {} });
  assert.strictEqual(s.api.role(), 'secondary',
    'ONLY the capability role is refused. "secondary" is a preference a phone can honour, and ' +
    'refusing it would be a second guess at what the user meant.');
}

/* A real office computer is completely unaffected. */
{
  const r = makeRole({ canHostExtension: true, os: 'Windows', noun: 'Windows PC', stored: {}, session: {} });
  assert.strictEqual(r.api.setRole('office'), true, 'a Windows PC must still be settable as the office computer');
  assert.strictEqual(r.api.role(), 'office', 'and must read back as one');
  assert.strictEqual(r.api.roleRefused(), null, 'nothing is refused on a device that can host the extension');
  assert.strictEqual(r.toasts.length, 0, 'and the doctor is not warned about a state that is fine');
}

/* ---------------------------------------------------------------------------
 * 2. THE CONSEQUENCE, through the REAL wantPhone()
 * This is the assertion that maps to the screenshot: same stored state, and the
 * phone layer must now be reachable.
 * -------------------------------------------------------------------------*/
const phStart = connect.indexOf('__mlsPhoneHome ph-1');
const wpStart = connect.indexOf('function wantPhone()', phStart);
const wantPhoneSrc = connect.slice(wpStart, connect.indexOf('\n  }', wpStart) + 4);

function wantPhone(opts) {
  const roleApi = makeRole({
    canHostExtension: !!opts.canHostExtension, os: opts.os || 'iOS',
    stored: { mls_device_role: opts.storedRole }, session: Object.assign({}, opts.session)
  });
  /* The layout preference lives on the same module, so the sim exposes it the
     same way the page does — one owner for the value. */
  roleApi.api.layoutPref = () => opts.layout || 'auto';
  const session = roleApi.session;
  const sandbox = {
    sessionStorage: { getItem: (k) => (session[k] == null ? null : session[k]) },
    window: { __mlsDeviceRole: roleApi.api },
    navigator: { userAgent: opts.ua, maxTouchPoints: opts.touch === false ? 0 : 5 },
    extPresent: () => !!opts.ext
  };
  if (opts.touch !== false) sandbox.window.ontouchstart = null;
  const fn = new Function('sessionStorage', 'window', 'navigator', 'extPresent',
    'return (' + wantPhoneSrc.replace('function wantPhone()', 'function ()') + ')();');
  return fn(sandbox.sessionStorage, sandbox.window, sandbox.navigator, sandbox.extPresent);
}

assert.strictEqual(
  wantPhone({ ua: IPHONE_UA, canHostExtension: false, storedRole: 'office', session: { mls_phone_mode: '0' } }),
  true,
  'THE SCREENSHOT, END TO END: an iPhone carrying the unhonourable office role must reach the phone ' +
  'UI. Before this fix it returned false twice over — once on the stale session flag, once on the ' +
  'role — and the owner got the desktop workspace on a 390px screen.');

assert.strictEqual(
  wantPhone({ ua: MAC_UA, touch: false, canHostExtension: true, storedRole: 'office' }),
  false,
  'and the fix must not leak: a real office computer still never gets the phone UI');
assert.strictEqual(
  wantPhone({ ua: IPHONE_UA, canHostExtension: false, storedRole: 'secondary' }),
  false,
  'an explicit, honourable non-phone role still wins on a handheld — dr-1.0.0 is not weakened');

/* ---------------------------------------------------------------------------
 * 2b. AND THE QUESTION IS NEVER ASKED  (dr-1.4.0)
 * Owner, after the fix above: "my phone should auto be detected as a phone."
 * Correct — and it is the defect UNDER the one above. b948 stopped a wrong
 * answer from sticking; this stops a doctor being offered the wrong answer.
 * roleBanner() put "What is this device?" with THREE buttons in front of every
 * signed-in device, an iPhone included, and one tap on the wrong one of three
 * is how his phone became the office computer.
 * -------------------------------------------------------------------------*/
const adoptSrc = (() => {
  const from = connect.indexOf('function adoptObviousRole()', drAt);
  const to = connect.indexOf('api.adoptObviousRole = adoptObviousRole;', from);
  assert(from > 0 && to > from, 'the adoption region could not be sliced');
  return connect.slice(from, to);
})();

function adopt(opts) {
  const store = Object.assign({}, opts.stored);
  const session = Object.assign({}, opts.session);
  const ctx = {
    ls: (k) => (store[k] == null ? null : store[k]),
    lsSet: (k, v) => { store[k] = String(v); },
    sessionStorage: { setItem: (k, v) => { session[k] = String(v); } },
    validRole: (r) => r === 'office' || r === 'secondary' || r === 'phone',
    roleUnhonourable: (r) => r === 'office' && !opts.canHostExtension,
    handheldEvidence: () => !!opts.handheld
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(adoptSrc + '\nthis.run = adoptObviousRole;', ctx, { filename: 'adopt.js' });
  return { adopted: ctx.run(), store, session };
}

{
  /* A fresh iPhone answers itself. */
  const r = adopt({ handheld: true, canHostExtension: false, stored: {}, session: {} });
  assert.strictEqual(r.adopted, true, 'a handheld with no role stored must adopt one from evidence');
  assert.strictEqual(r.store.mls_device_role, 'phone', 'and that role is phone');
  assert.strictEqual(r.session.mls_phone_mode, '1', 'and the UI flag follows, so the phone layer mounts on this very load');
}
{
  /* HIS phone: the unhonourable office value is repaired, not merely ignored. */
  const r = adopt({ handheld: true, canHostExtension: false,
    stored: { mls_device_role: 'office' }, session: { mls_phone_mode: '0' } });
  assert.strictEqual(r.store.mls_device_role, 'phone',
    "the owner's stored 'office' must be REPAIRED on the next load, not just read as null — otherwise " +
    'the Settings panel keeps showing a role the app is ignoring, and the heartbeat keeps reporting it');
  assert.strictEqual(r.session.mls_phone_mode, '1',
    "the '0' written beside the old role must be overwritten, or wantPhone() short-circuits before the role");
}
{
  /* An honourable explicit choice is still the user's. dr-1.0.0 intact. */
  const r = adopt({ handheld: true, canHostExtension: false,
    stored: { mls_device_role: 'secondary' }, session: {} });
  assert.strictEqual(r.adopted, false, 'adoption must never overrule a role the doctor chose and the device can honour');
  assert.strictEqual(r.store.mls_device_role, 'secondary', 'the stored choice stands');
}
{
  /* THE ONE THAT MUST NOT REGRESS: a laptop is never adopted. This is the
     whole reason dr-1.0.0 demanded an explicit choice in the first place. */
  for (const stored of [{}, { mls_device_role: 'office' }]) {
    const r = adopt({ handheld: false, canHostExtension: true, stored: Object.assign({}, stored), session: {} });
    assert.strictEqual(r.adopted, false, 'a non-handheld must never self-adopt — office vs secondary is a real choice');
    assert.strictEqual(r.store.mls_device_role, stored.mls_device_role,
      'and nothing about a desktop\'s stored role may be rewritten');
  }
  /* An iPad reports as Macintosh and is deliberately NOT handheld evidence, so
     it keeps the card: it might genuinely be a secondary machine. */
  const pad = adopt({ handheld: false, canHostExtension: false, stored: {}, session: {} });
  assert.strictEqual(pad.adopted, false, 'a tablet that is not handheld evidence must still be asked');
}

/* ---------------------------------------------------------------------------
 * 2c. THE LAYOUT IS A SEPARATE QUESTION, AND SETTINGS ASKS IT  (dr-1.5.0)
 * Owner: "Make a place in settings to change from desktop to mobile or laptop."
 * Before this there was no place. Layout was welded to the relay role, so
 * wanting the simple layout on a laptop meant lying to the relay about which
 * machine reads Athena — and the only two ways to change it at all were a URL
 * parameter and a text link at the bottom of the phone screen, which wrote a
 * SESSION flag that evaporated on the next launch.
 * -------------------------------------------------------------------------*/
{
  /* The preference is read FIRST, and it overrides in both directions. */
  const simple = wantPhone({ ua: MAC_UA, touch: false, canHostExtension: true, storedRole: 'office', layout: 'simple' });
  assert.strictEqual(simple, true,
    'a desktop whose owner chose the simple layout must get it — previewing the phone screens from a ' +
    'desk must not require lying to the relay about which machine runs the pulls');
  const full = wantPhone({ ua: IPHONE_UA, canHostExtension: false, storedRole: undefined, layout: 'full' });
  assert.strictEqual(full, false, 'and a phone whose owner chose the full app must get the full app');
  const auto = wantPhone({ ua: IPHONE_UA, canHostExtension: false, storedRole: undefined, layout: 'auto' });
  assert.strictEqual(auto, true, "'auto' must be inert — it is the default and must change nothing");
}
{
  /* It beats the URL parameter, which is the older channel for the same
     intent. A stored choice a person made in Settings must not be outvoted by
     a leftover from earlier in the session. */
  const pinned = wantPhone({ ua: MAC_UA, touch: false, canHostExtension: true, layout: 'full', session: { mls_phone_mode: '1' } });
  assert.strictEqual(pinned, false,
    'the Settings preference must outrank a stale ?phone=1 session flag, or the control in Settings ' +
    'appears not to work for the rest of the session');
}
/* The two controls are genuinely separate in the panel, in the owner's words. */
const cardSrc = connect.slice(connect.indexOf("card.id = 'mlsDrCard'"), connect.indexOf('var cardIv', connect.indexOf("card.id = 'mlsDrCard'")));
assert(/What kind of device is this\?/.test(cardSrc) && /Which layout should this device open\?/.test(cardSrc),
  'Settings must ask the two questions separately — role drives the relay, layout drives the screen');
for (const label of ['🖥 Desktop', '💻 Laptop', '📱 Phone']) {
  assert(cardSrc.indexOf(label) > 0,
    'the device buttons must use the words a person uses (' + label + '), not relay role names');
}
for (const layout of ['data-layout="auto"', 'data-layout="full"', 'data-layout="simple"']) {
  assert(cardSrc.indexOf(layout) > 0, 'the layout switch is missing an option: ' + layout);
}
assert(!/Office computer<\/button>|Secondary computer<\/button>/.test(cardSrc),
  'the old relay-jargon button labels are back — a doctor holding a laptop should not have to work ' +
  'out which of them he is');
assert(/setLayoutPref\(this\.getAttribute\('data-layout'\)\)/.test(cardSrc),
  'the layout buttons must be wired to the preference, not merely rendered');
/* The phone's own escape hatch writes the same durable preference. */
const phoneUi = fs.readFileSync(path.join(root, 'feat_mls_phone_ui.js'), 'utf8');
assert(/dr2\.setLayoutPref\('full'\)/.test(phoneUi),
  '"Show the full app" must store the preference, not a session flag that evaporates on next launch');
assert(/Settings → Integrations → This device/.test(phoneUi),
  'and it must name where to switch back — a one-way door is why this control needed replacing');

/* ---------------------------------------------------------------------------
 * 3. AND THE PULL STOPS AIMING AT IT
 * effectiveRole() feeds the heartbeat, which is what makes a device advertise
 * itself as the office computer to every other device on the account.
 * -------------------------------------------------------------------------*/
{
  const r = makeRole({ canHostExtension: false, os: 'iOS', stored: { mls_device_role: 'office' }, session: {} });
  /* suggestRole/effectiveRole live below the sliced region; assert the input
     they consume, which is role() returning null = "not chosen". */
  assert.strictEqual(r.api.role(), null,
    'effectiveRole() is role() || suggestRole(); with the office role refused, an iPhone falls ' +
    'through to the handheld suggestion and stops beaconing itself as the machine that reads Athena');
}
assert(/api\.effectiveRole = function \(\) \{ return api\.role\(\) \|\| api\.suggestRole\(\); \};/.test(connect),
  'effectiveRole must still derive from role() — that is the seam that carries this fix into the heartbeat');
assert(/if \(handheldEvidence\(\)\) return 'phone';/.test(connect),
  'the handheld suggestion must remain, or a refused office role falls through to nothing');

console.log('PASS device and layout are two questions, asked in plain words: a handheld ADOPTS the phone role and is never shown the three-button card; the exact stored state from the owner\'s screenshot is REPAIRED and reaches the phone UI; setRole refuses the office role on iOS with a reason and a route; the new Settings LAYOUT preference overrides in both directions and outranks a stale ?phone=1, while auto stays inert; the panel says Desktop/Laptop/Phone instead of relay role names; and a laptop is never self-adopted');
