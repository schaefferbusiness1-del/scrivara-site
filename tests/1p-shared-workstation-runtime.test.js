'use strict';

/* sharedws-1.0.0 — A SHARED WORKSTATION CANNOT CROSS DOCTORS.
 *
 * THE DEFECT (readiness P0 #9, measured in the shipped bytes): the 30-day
 * bearer token is written to localStorage by setBkToken(), and the boot handler
 * auto-enters from that seed with no re-authentication. On the exam-room
 * computer every practice actually has, Doctor A closes the tab without signing
 * out, Doctor B opens MLS, and B is inside A's account and A's charts.
 *
 * This suite EXECUTES the shipped shell code — the token helpers, the real
 * inactivity machinery, and the sharedws-1.0.0 block — in a vm with a fake DOM,
 * fake storage and a FAKE CLOCK, and drives the idle window to its end. It
 * proves both modes, because a security default that breaks the doctor's own
 * laptop gets turned off and protects nobody:
 *
 *   PRIVATE  — unchanged: the seed is written, the window is 30 minutes, and
 *              the idle end is the existing purging sign-out.
 *   SHARED   — the token never reaches localStorage, a seed-only entry is
 *              refused, the window is 15 minutes, and the idle end is a LOCK
 *              that keeps the unsaved visit and purges nothing.
 *
 * The lock assertions are the load-bearing ones: an idle logout runs
 * clinical-state-purge, which clears the whole account namespace AND all of
 * sessionStorage (clinical-state-purge.js:163) — which is where the unsaved
 * visit lives. So "does not lose unsaved work" is asserted as: the draft key
 * still holds the draft, logout() was never called, and purge() was never
 * called.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const SHELLS = ['1pScribeFlow.html', '1p/index.html'];

let checks = 0;
const ok = (v, m) => { assert.ok(v, m); checks++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, m); checks++; };

function slice(src, start, end, label) {
  const a = src.indexOf(start);
  assert.ok(a >= 0, `could not find start of ${label}`);
  const b = src.indexOf(end, a + start.length);
  assert.ok(b > a, `could not find end of ${label}`);
  return src.slice(a, b);
}

/* ---------------------------------------------------------- fake storage --- */
function makeStorage() {
  const map = new Map();
  return {
    get length() { return map.size; },
    key(i) { return Array.from(map.keys())[i]; },
    getItem(k) { return map.has(String(k)) ? map.get(String(k)) : null; },
    setItem(k, v) { map.set(String(k), String(v)); },
    removeItem(k) { map.delete(String(k)); },
    clear() { map.clear(); },
    _dump() { return Object.fromEntries(map); }
  };
}

/* ------------------------------------------------------------ fake clock --- */
function makeClock(start) {
  let now = start, seq = 1;
  const timers = [];
  const api = {
    now: () => now,
    setTimeout(fn, ms) { const id = seq++; timers.push({ id, at: now + (Number(ms) || 0), fn, every: 0 }); return id; },
    clearTimeout(id) { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); },
    setInterval(fn, ms) { const id = seq++; timers.push({ id, at: now + (Number(ms) || 0), fn, every: Number(ms) || 1 }); return id; },
    clearInterval(id) { api.clearTimeout(id); },
    advance(ms) {
      const end = now + ms;
      for (let guard = 0; guard < 5000; guard++) {
        const due = timers.filter((t) => t.at <= end).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        now = due.at;
        if (due.every) due.at = now + due.every; else api.clearTimeout(due.id);
        due.fn();
      }
      now = end;
    }
  };
  return api;
}

/* -------------------------------------------------------------- fake DOM --- */
function makeDom() {
  const nodes = new Map();
  function node(id) {
    const n = {
      id: id || '', style: {}, value: '', textContent: '', className: '', children: [],
      parentNode: null, _handlers: {},
      appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
      insertBefore(c) { this.children.push(c); c.parentNode = this; return c; },
      remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((x) => x !== this); },
      addEventListener(t, f) { this._handlers[t] = f; },
      fire(t, arg) { if (this._handlers[t]) this._handlers[t](arg); },
      setAttribute(k, v) { this['attr_' + k] = v; },
      getAttribute(k) { return this['attr_' + k] === undefined ? null : this['attr_' + k]; },
      querySelectorAll() { return []; },
      closest() { return null; }
    };
    return n;
  }
  /* the ids the code under test reaches for */
  for (const id of ['authScreen', 'appScreen', 'authEmail', 'authPass', 'authErr', 'twofaCard', 'resetCard', 'idleMins']) {
    nodes.set(id, node(id));
  }
  /* #idleMins must find a .field host with a parent, or the Settings switch has
     nowhere to go — and then this suite would silently test nothing. */
  const field = node('theField');
  const section = node('theSection');
  section.appendChild(field);
  nodes.get('idleMins').closest = () => field;

  const created = [];
  return {
    _nodes: nodes,
    _section: section,
    getElementById(id) {
      if (nodes.has(id)) return nodes.get(id);
      for (const n of created) if (n.id === id) return n;
      return null;
    },
    createElement(tag) { const n = node(''); n.tagName = String(tag).toUpperCase(); created.push(n); return n; },
    querySelectorAll() { return []; },
    addEventListener() {},
    removeEventListener() {},
    readyState: 'complete',
    _register(n) { if (n.id) nodes.set(n.id, n); return n; }
  };
}

/* --------------------------------------------------- build the sandbox ----- */
function boot(opts) {
  opts = opts || {};
  const shell = fs.readFileSync(path.join(root, opts.shell || '1pScribeFlow.html'), 'utf8');
  const source = [
    'var session=null, bkUser=null, _legalGenerating=false;',
    slice(shell, 'function bkToken(){', 'let bkUser=null;', 'token helpers'),
    slice(shell, 'function unsEmail(){', 'function unsResolved()', 'unsEmail'),
    "function uns(suffix){ return 'sf_u::'+(unsEmail()||'_')+'::'+suffix; }",
    'function backendMode(){ return true; }',
    slice(shell, 'let idleTimer=null;', '/* ---------- settings ---------- */', 'idle machinery + sharedws block')
  ].join('\n');

  const clock = makeClock(1700000000000);
  const document = makeDom();
  const localStorage = makeStorage();
  const sessionStorage = makeStorage();
  const calls = { logout: 0, purge: 0, saveDraft: 0, toast: [], confirm: [], switchAuth: 0 };

  const RealDate = Date;
  function FakeDate(...args) { return args.length ? new RealDate(...args) : new RealDate(clock.now()); }
  FakeDate.now = () => clock.now();
  FakeDate.prototype = RealDate.prototype;
  FakeDate.UTC = RealDate.UTC;
  FakeDate.parse = RealDate.parse;

  const ctx = {
    console,
    localStorage, sessionStorage, document,
    location: { hostname: 'mlsscribe.com', origin: 'https://mlsscribe.com' },
    navigator: { userAgent: 'test' },
    Date: FakeDate, Math, Number, String, Boolean, Object, Array, JSON, isFinite, parseInt, RegExp, Promise,
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
    setInterval: clock.setInterval, clearInterval: clock.clearInterval,
    /* stubs for everything the idle path can reach */
    toast(msg) { calls.toast.push(String(msg)); },
    switchAuth() { calls.switchAuth++; },
    logout() { calls.logout++; },
    mlsConfirm(msg, o) { calls.confirm.push({ msg: String(msg), opts: o || null }); return Promise.resolve(!!opts.confirmAnswer); },
    stopCapture() {},
    _saveVisitDraft() {
      calls.saveDraft++;
      try { sessionStorage.setItem(uns('visitDraft'), JSON.stringify({ t: 'synthetic transcript', ts: clock.now() })); } catch (e) {}
    },
    _wipeVisitDraft() { try { sessionStorage.removeItem(uns('visitDraft')); } catch (e) {} },
    fetch() { return Promise.resolve({ ok: false, json: () => Promise.resolve(null) }); },
    /* the window-level listeners the idle machinery attaches. postMessage is a
       no-op on purpose: _idleAthenaProbe then reaches its own 3s timeout and
       answers "no athenaOne activity", which is the real no-extension path. */
    addEventListener() {}, removeEventListener() {}, postMessage() {},
    _calls: calls, _clock: clock
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  ctx.window.__mlsClinicalStatePurge = { purge() { calls.purge++; return { databases: Promise.resolve([]), ptsStore: Promise.resolve(null) }; } };
  /* uns() is needed by the _saveVisitDraft stub before the script defines it */
  function uns(s) { return 'sf_u::' + ((ctx.session && ctx.session.email) || '_') + '::' + s; }

  vm.createContext(ctx);
  vm.runInContext(source, ctx);
  return ctx;
}

/* ============================================== 1. the block, in both twins */
{
  const spans = SHELLS.map((name) => {
    const src = fs.readFileSync(path.join(root, name), 'utf8');
    eq(src.split('/* ===== sharedws-1.0.0').length - 1, 1, `${name}: sharedws-1.0.0 must open exactly once`);
    eq(src.split('/* ===== end sharedws-1.0.0 ===== */').length - 1, 1, `${name}: sharedws-1.0.0 must close exactly once`);
    return slice(src, '/* ===== sharedws-1.0.0', '/* ===== end sharedws-1.0.0 ===== */', `${name} block`);
  });
  eq(spans[0], spans[1], 'the twins carry different sharedws-1.0.0 blocks');
  /* the block must never handle a credential itself */
  const code = spans[0].replace(/\/\*[\s\S]*?\*\//g, ' ');
  for (const forbidden of ['authPass2', '/api/auth/login', 'password:', 'totp', '2fa']) {
    ok(code.toLowerCase().indexOf(forbidden.toLowerCase()) < 0,
      `sharedws-1.0.0 touches "${forbidden}" — it may only DECLINE to skip the sign-in screen, never operate it`);
  }
  /* and it must not be the thing that purges */
  ok(code.indexOf('__mlsClinicalStatePurge') < 0, 'the lock must not purge; purging stays on the deliberate sign-out path');
}

/* ============================================== 2. the default on a device */
{
  const fresh = boot();
  eq(fresh.swEnabled(), true,
    'a computer that has never been signed in to MLS must start SHARED — a new practice is protected before anyone reads a setting');

  const used = boot();
  used.localStorage.setItem('sf_u::a@x.test::patients', '[]');
  eq(used.swEnabled(), false,
    'a computer that already carries a sign-in must keep today\'s behaviour rather than silently locking the doctor out of his own laptop');
  eq(used.swDeviceEverSignedIn(), true, 'an account-namespaced key is evidence of a prior sign-in');
}

/* ============================================== 3. PRIVATE mode is unchanged */
{
  const c = boot();
  c.localStorage.setItem('sf_shared_workstation', '0');
  c.setBkToken('TOKEN-PRIVATE');
  c.setSessionEmail('dr.a@example.test');
  eq(c.localStorage.getItem('sf_bk_token'), 'TOKEN-PRIVATE', 'private mode stopped seeding the token — that is today\'s stay-signed-in behaviour');
  eq(c.localStorage.getItem('sf_session'), 'dr.a@example.test', 'private mode stopped seeding the session email');
  eq(c.sessionStorage.getItem('sf_bk_token'), 'TOKEN-PRIVATE', 'private mode stopped writing the per-tab token');
  eq(c.getIdleMins(), 30, 'the private-computer default idle window moved');
}

/* ============================================== 4. SHARED mode: no seed ever */
{
  const c = boot();
  c.localStorage.setItem('sf_shared_workstation', '1');
  c.setBkToken('TOKEN-SHARED');
  c.setSessionEmail('dr.a@example.test');
  eq(c.localStorage.getItem('sf_bk_token'), null,
    'THE DEFECT: the 30-day token reached localStorage on a shared computer, which is exactly how Doctor B lands in Doctor A\'s charts');
  eq(c.localStorage.getItem('sf_session'), null, 'the session email seed reached localStorage on a shared computer');
  eq(c.sessionStorage.getItem('sf_bk_token'), 'TOKEN-SHARED', 'the shared-mode token must still live for the life of the tab');
  eq(c.bkToken(), 'TOKEN-SHARED', 'the tab lost its own token');
  eq(c.getIdleMins(), 15, 'the shared-computer default idle window is not 15 minutes');

  /* an explicit choice still wins over the default */
  c.session = { email: 'dr.a@example.test' };
  c.localStorage.setItem(c.uns('idleMins'), '30');
  eq(c.getIdleMins(), 30, 'the shared default overrode the doctor\'s own Settings choice');
  c.localStorage.setItem(c.uns('idleMins'), 'off');
  eq(c.getIdleMins(), 0, 'the shared default overrode "stay signed in"');
}

/* ============================================== 5. flipping the switch ----- */
{
  const c = boot();
  /* a private-mode seed already on the device is stripped the moment the
     doctor says the computer is shared */
  c.localStorage.setItem('sf_shared_workstation', '0');
  c.setBkToken('TOKEN-1'); c.setSessionEmail('dr.a@example.test');
  eq(c.localStorage.getItem('sf_bk_token'), 'TOKEN-1', 'setup failed');
  c.swSetEnabled(true);
  eq(c.localStorage.getItem('sf_bk_token'), null, 'turning shared mode ON left the old localStorage token seed behind');
  eq(c.localStorage.getItem('sf_session'), null, 'turning shared mode ON left the old session seed behind');
  eq(c.sessionStorage.getItem('sf_bk_token'), 'TOKEN-1', 'turning shared mode ON signed the doctor out of the tab he is using');

  /* and turning it back off actually keeps him signed in again */
  c.swSetEnabled(false);
  eq(c.localStorage.getItem('sf_bk_token'), 'TOKEN-1',
    'answering "this computer is mine" must restore the seed, or the doctor is still asked for a password in every new tab');
  eq(c.localStorage.getItem('sf_session'), 'dr.a@example.test', 'the seed pair was restored torn in half');
}

/* ============================================== 6. a seed-only entry re-auths */
{
  const c = boot();
  c.localStorage.setItem('sf_shared_workstation', '1');
  /* the state a fresh tab finds after Doctor A walked away: a localStorage
     seed, and nothing of its own */
  c.localStorage.setItem('sf_bk_token', 'A-TOKEN');
  c.localStorage.setItem('sf_session', 'dr.a@example.test');
  eq(c.swSeedOnlyEntry(), true, 'a tab with no session of its own and a live seed was not recognised as a seed entry');

  c.swRequireReauth('dr.a@example.test');
  eq(c.localStorage.getItem('sf_bk_token'), null, 'the seed survived the re-auth requirement, so the next boot walks straight in again');
  eq(c.bkToken(), '', 'bkToken() still answers, so the boot branch would still auto-enter');
  ok(/shared/i.test(c.document.getElementById('authErr').textContent), 'the sign-in screen does not say why it is asking');
  eq(c.document.getElementById('authEmail').value, 'dr.a@example.test', 'the re-auth screen did not prefill the email it already knows');

  /* a tab that owns its session is NOT a seed entry */
  const d = boot();
  d.localStorage.setItem('sf_shared_workstation', '1');
  d.sessionStorage.setItem('sf_bk_token', 'MINE');
  d.localStorage.setItem('sf_bk_token', 'SEED');
  eq(d.swSeedOnlyEntry(), false, 'a tab with its own session was told to re-authenticate');
}

/* ============================================== 7. the idle LOCK (fake timers) */
function signIn(c, email) {
  c.session = { email: email };
  c.setBkToken('LIVE-TOKEN');
  c.setSessionEmail(email);
  c.attachIdleListeners();
  c.resetIdle();
}

{
  const c = boot();
  c.localStorage.setItem('sf_shared_workstation', '1');
  signIn(c, 'dr.a@example.test');
  const draftKey = 'sf_u::dr.a@example.test::visitDraft';
  /* the doctor is mid-visit when he is called away */
  c._saveVisitDraft();
  ok(c.sessionStorage.getItem(draftKey), 'the synthetic draft did not land');

  eq(c.getIdleMins(), 15, 'the shared window is not 15 minutes');

  /* 14 minutes of silence is not idle */
  c._clock.advance(14 * 60000);
  eq(c.swIsLocked(), false, 'the screen locked before the window elapsed');
  eq(c._calls.logout, 0, 'something signed the doctor out at 14 minutes');

  /* past 15, plus the 3s athenaOne "is he working over there?" probe */
  c._clock.advance(2 * 60000 + 4000);
  eq(c.swIsLocked(), true, 'the shared computer did not lock after its idle window');

  /* THE POINT: locked, not signed out. */
  eq(c._calls.logout, 0, 'the idle window ran the purging sign-out on a shared computer instead of locking');
  eq(c._calls.purge, 0, 'the lock purged clinical state — an unattended screen must lose reachability, not work');
  ok(c._calls.saveDraft >= 2, 'the lock did not flush the in-progress visit before taking the screen away');
  ok(c.sessionStorage.getItem(draftKey), 'THE UNSAVED VISIT WAS LOST — the lock must keep it under the account namespace');
  eq(c.session, null, 'the session object survived the lock, so a 401 elsewhere can still trigger the purging logout');
  eq(c.bkToken(), '', 'the lock left a usable token on an unattended computer');
  eq(c.localStorage.getItem('sf_bk_token'), null, 'the lock left a token seed on disk');

  const rec = c.swLockRecord();
  eq(rec.email, 'dr.a@example.test', 'the lock record does not name the account it is holding work for');
  eq(rec.reason, 'idle', 'the lock record does not say why it locked');
  eq(rec.mins, 15, 'the lock record does not carry the window it waited');

  /* the screen the doctor sees */
  eq(c.document.getElementById('appScreen').style.display, 'none', 'the app is still on screen behind the lock');
  eq(c.document.getElementById('authScreen').style.display, 'flex', 'the sign-in screen was not shown');
  eq(c.document.getElementById('authPass').value, '', 'the password field was not cleared on lock');
  ok(/Locked after 15 quiet minutes/.test(c.document.getElementById('authErr').textContent),
    `the lock screen does not explain itself: ${JSON.stringify(c.document.getElementById('authErr').textContent)}`);
  ok(/discards it/.test(c.document.getElementById('authErr').textContent),
    'the lock screen does not warn that another clinician signing in discards the held work');

  /* unlocking as the SAME doctor keeps the work */
  c.swOnSessionStart('dr.a@example.test');
  eq(c.swIsLocked(), false, 'signing back in did not clear the lock');
  ok(c.sessionStorage.getItem(draftKey), 'signing back in as the same doctor threw his own unsaved visit away');
}

/* ============================================== 8. a different clinician ---- */
{
  const c = boot();
  c.localStorage.setItem('sf_shared_workstation', '1');
  signIn(c, 'dr.a@example.test');
  c._saveVisitDraft();
  const draftKey = 'sf_u::dr.a@example.test::visitDraft';
  c.swLock('idle');
  ok(c.sessionStorage.getItem(draftKey), 'setup: the draft should be held');

  c.swOnSessionStart('dr.b@example.test');
  eq(c.sessionStorage.getItem(draftKey), null,
    'Doctor B unlocked the computer and Doctor A\'s unsaved visit was still sitting in this tab');
  eq(c.swIsLocked(), false, 'the lock record survived a different clinician signing in');
}

/* ============================================== 9. activity re-arms the window */
{
  const c = boot();
  c.localStorage.setItem('sf_shared_workstation', '1');
  signIn(c, 'dr.a@example.test');
  c._clock.advance(14 * 60000);
  c._onUserActivity();
  c._clock.advance(14 * 60000);
  eq(c.swIsLocked(), false, 'a doctor who was working 14 minutes ago was locked out anyway');
  c._clock.advance(2 * 60000 + 4000);
  eq(c.swIsLocked(), true, 'the window never re-armed, so the screen would stay open forever');
}

/* ============================================== 10. PRIVATE mode still signs out */
{
  const c = boot();
  c.localStorage.setItem('sf_shared_workstation', '0');
  signIn(c, 'dr.a@example.test');
  eq(c.getIdleMins(), 30, 'the private window is not 30 minutes');
  c._clock.advance(30 * 60000 + 4000);
  eq(c.swIsLocked(), false, 'a private computer locked instead of signing out — that changes existing behaviour');
  eq(c._calls.logout, 1, 'the existing inactivity sign-out no longer fires on a private computer');
  ok(c.localStorage.getItem('sf_last_signout'), 'the sign-out reason stamp was lost');
}

/* ============================================== 11. the Settings switch ----- */
{
  const c = boot();
  c.localStorage.setItem('sf_shared_workstation', '0');
  eq(c.swEnsureSettingsField(), true, 'the block did not build its own Settings switch');
  const toggle = c.document.getElementById('swSharedToggle');
  ok(toggle, 'there is no "this computer is shared" control in Settings');
  eq(toggle.checked, false, 'the switch does not reflect the stored mode');
  /* it is ONE switch, next to the auto-logoff control it changes */
  eq(c.swEnsureSettingsField(), true, 'calling it twice must be a no-op');
  eq(c.document._section.children.filter((n) => n.getAttribute('data-sharedws-own')).length, 1,
    'the Settings switch was injected more than once');

  /* flipping it drives the real setter */
  toggle.checked = true;
  toggle.fire('change');
  eq(c.swEnabled(), true, 'the Settings switch does not actually change the mode');
  eq(c.document.getElementById('idleMins').value, '15',
    'the auto-logoff control still shows 30 while the code would use 15 — one of them is lying to the doctor');
}

/* ============================================== 12. the first-run prompt ---- */
{
  const c = boot({ confirmAnswer: true });
  eq(c.swMaybeFirstRunPrompt(), true, 'the first-run question was never asked');
  eq(c._calls.confirm.length, 1, 'the first-run question was not a question');
  ok(/shared with other clinicians/i.test(c._calls.confirm[0].msg), 'the first-run question does not ask what it needs to know');
  ok(c._calls.confirm[0].opts && /shared/i.test(c._calls.confirm[0].opts.okLabel),
    'the first-run question makes OK/Cancel carry the meaning instead of naming the two answers');
  /* asked once per device */
  c.localStorage.setItem('sf_shared_workstation_asked', '1');
  eq(c.swMaybeFirstRunPrompt(), false, 'the first-run question asks again every session');
}

console.log(`1p-shared-workstation-runtime: ${checks} checks passed`);
