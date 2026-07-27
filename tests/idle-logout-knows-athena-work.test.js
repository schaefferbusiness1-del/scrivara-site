'use strict';

/* IDLE LOGOUT LEARNS WHAT ATHENA KNOWS (lgn-1.2.0) - root cause of the
 * 2026-07-27 ~10:30 live eviction: the doctor worked athenaOne charts for 30
 * minutes, MLS saw zero events, idleLogout fired in a HIDDEN tab (toast
 * unseen), and the backend logout's session_version bump evicted every tab.
 * lgn-1.0.0's own comment NAMED "active ... in Athena" as the class to
 * protect - the signal just never existed until ext 3.0.23's read-only
 * chart-identity verb.
 *
 * Pins:
 *  1. idleLogout consults _idleAthenaProbe before the irreversible step; a
 *     CHANGED open chart re-arms instead of logging out.
 *  2. The probe fails CLOSED to the old behavior (no extension / no identity /
 *     timeout -> logout proceeds).
 *  3. Both sign-out paths stamp WHY (outside the account namespace - it must
 *     survive the namespace flip) and the gate shows it once, never
 *     clobbering a real auth error.
 * All driven in a vm on the sliced production functions. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');

function between(src, a, b) {
  const i = src.indexOf(a); assert(i >= 0, 'missing marker: ' + a);
  const j = src.indexOf(b, i); assert(j > i, 'missing end marker: ' + b);
  return src.slice(i, j);
}

/* ---- source pins ------------------------------------------------------- */
const idleTail = between(app, 'function idleLogout()', 'function resetIdle()');
assert(idleTail.includes('_idleAthenaProbe(function(athenaActive){'), 'idleLogout must consult the Athena probe before logging out');
assert(idleTail.includes('if(athenaActive){ resetIdle(); return; }'), 'a changed open chart must re-arm, not log out');
assert(idleTail.includes("_stampSignoutReason('idle'"), 'the idle path must stamp WHY');
const h401 = between(app, 'function handle401()', 'function applyAccessUI()');
assert((h401.match(/_stampSignoutReason\('expired'\)/g) || []).length >= 2, 'both 401 evict paths must stamp WHY');
assert(app.includes("localStorage.setItem('sf_last_signout'"), 'the reason stamp must live OUTSIDE the account namespace');

/* ---- runtime ----------------------------------------------------------- */
const lgn = between(app, 'function _idleAthenaProbe(cb){', 'try{ if(document.readyState');
const store = {};
let authErr = { textContent: '', style: {} };
const msgHandlers = [];
let posted = [];
let responder = null;
const ctx = {
  console: console, Date: Date, JSON: JSON, Object: Object,
  setTimeout: setTimeout, clearTimeout: clearTimeout,
  session: null,
  location: { origin: 'https://mlsscribe.com' },
  localStorage: {
    getItem: k => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; }
  },
  document: { getElementById: id => (id === 'authErr' ? authErr : null), addEventListener: function () {} }
};
ctx.window = ctx;
ctx.addEventListener = (t, fn) => { if (t === 'message') msgHandlers.push(fn); };
ctx.removeEventListener = (t, fn) => { const i = msgHandlers.indexOf(fn); if (i >= 0) msgHandlers.splice(i, 1); };
ctx.postMessage = function (body) {
  posted.push(body);
  if (!responder) return;
  const reply = responder(body);
  if (reply) setTimeout(() => { msgHandlers.slice().forEach(fn => { try { fn({ data: reply }); } catch (e) {} }); }, 5);
};
vm.createContext(ctx);
vm.runInContext(lgn, ctx, { filename: 'lgn-1.2.0.js' });

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async function () {
  /* changed chart -> ACTIVE */
  responder = b => (b.type === 'mlsAppChartIdentity'
    ? { source: 'mls-ext', type: 'mlsAppChartIdentityResult', requestId: b.requestId, resp: { ok: true, identity: { name: 'Bernard P Brooks', dob: '06/13/1951' } } }
    : null);
  let verdict = await new Promise(res => ctx._idleAthenaProbe(res));
  assert.strictEqual(verdict, true, 'first sighting of an open chart must count as work');
  /* same chart again -> NOT active (a parked chart is not work) */
  verdict = await new Promise(res => ctx._idleAthenaProbe(res));
  assert.strictEqual(verdict, false, 'an UNCHANGED chart must not block the logout');
  /* new patient opened -> ACTIVE again */
  responder = b => (b.type === 'mlsAppChartIdentity'
    ? { source: 'mls-ext', type: 'mlsAppChartIdentityResult', requestId: b.requestId, resp: { ok: true, identity: { name: 'Lisa A March', dob: '04/04/1970' } } }
    : null);
  verdict = await new Promise(res => ctx._idleAthenaProbe(res));
  assert.strictEqual(verdict, true, 'a different open chart is real clinical work');
  /* silence -> fail CLOSED to the old behavior */
  responder = null;
  const t0 = Date.now();
  verdict = await new Promise(res => ctx._idleAthenaProbe(res));
  assert.strictEqual(verdict, false, 'no extension response must let the logout proceed');
  assert(Date.now() - t0 < 4500, 'the probe must not hang the logout');

  /* stamps + gate line */
  ctx._stampSignoutReason('idle', { mins: 30 });
  assert(store.sf_last_signout && /"idle"/.test(store.sf_last_signout), 'stamp must persist');
  ctx._showSignoutReasonOnGate();
  assert(/quiet minutes/.test(authErr.textContent) && /Your work is saved/.test(authErr.textContent),
    'the gate must say WHY in plain words');
  assert(!store.sf_last_signout, 'the reason shows ONCE and is consumed');
  /* never clobber a real error */
  ctx._stampSignoutReason('expired');
  authErr.textContent = 'Wrong password.';
  ctx._showSignoutReasonOnGate();
  assert.strictEqual(authErr.textContent, 'Wrong password.', 'a real auth error must never be overwritten');

  console.log('PASS idle logout knows athena work: changed chart re-arms, parked chart and silence fail closed to the old logout, both paths stamp WHY, the gate says it once in plain words');
})().catch(e => { console.error(e); process.exit(1); });
