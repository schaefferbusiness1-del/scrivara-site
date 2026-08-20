'use strict';

/* BIDIRECTIONAL ATHENA<->MLS FOLLOW (af-1.0.0, ext >= 3.0.23) - owner-approved
 * "Automatic with context", made bidirectional by his follow-up.
 *
 * RUN in a vm (b718's law - the base function is not proof), driving both legs
 * through the real module against a stub page:
 *  - fail closed without a pong: nothing posted, ever;
 *  - a missed ping is NOT cached as a verdict (an extension asleep at boot
 *    must not kill follow for the page life);
 *  - Leg A: doctor-driven banner change (visible tab) posts the PROVEN
 *    search-open lane after debounce - and SKIPS when the open chart is
 *    already that person;
 *  - Leg B: tab arrival resolves the open chart EXACTLY (unique + DOB
 *    agreement) and follows it, stamping loop suppression so Leg A ignores
 *    the resulting change event;
 *  - guards: pull-busy and recording block both legs; ambiguity resolves to
 *    silence; revert unhooks everything.
 *
 * Bridge verb inventory pinned at the bottom: content.js must gate + handle
 * mlsAppChartIdentity (the v1.52 lesson - a handler without its allowlist key
 * is dead). The manifest/feed pins below track the CURRENT release and move
 * with each extension release sweep; MIN_EXT and the vm pong versions stay at
 * the verb-carrying minimum 3.0.23 to prove backward compatibility. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const mod = fs.readFileSync(path.join(root, 'feat_mls_athena_follow.js'), 'utf8');
const content = fs.readFileSync(path.join(root, 'content.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const feed = JSON.parse(fs.readFileSync(path.join(root, 'extension-version.json'), 'utf8'));
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');

/* ---- extension + wiring pins ------------------------------------------- */
assert(/MLS_BRIDGE_TYPES = \{[^}]*mlsAppChartIdentity: 1/.test(content),
  'mlsAppChartIdentity is missing from the bridge allowlist - the handler is dead (v1.52 class)');
assert(content.includes("if (d.type === 'mlsAppChartIdentity') {") &&
  content.includes("chrome.runtime.sendMessage({ type: 'mlsAssistChartIdentity' }"),
  'the chart-identity verb must forward to the proven write-safety identity handler');
assert.strictEqual(manifest.version, '3.0.76', 'extension manifest must be 3.0.76'); /* pin moved with the 3.0.76 release train (srr-1.0) */
/* qol-2.4b: SELF-DERIVED from manifest.version rather than a hand-carried
   literal — this line still said 3.0.56 while line 45 said 3.0.76, red since
   the version first moved and invisible behind every partial gate. A pin
   that must be hand-moved on every release eventually is not moved. */
assert(new RegExp('^' + manifest.version.replace(/\./g, '\\.') + '\\+core-sha256:[0-9a-f]{64}$').test(manifest.version_name),
  'manifest must carry the stamped core digest for its OWN version');
assert.strictEqual(feed.version, '3.0.76', 'release feed must announce 3.0.76');
assert(connect.includes('data-mls-asset="feat_mls_athena_follow.js"'), 'the follow module has no loader');
assert(app.includes('id="athenaFollowToggle"'), 'the off-switch is missing from Settings -> Integrations');
assert(mod.includes("var MIN_EXT = '3.0.23';"), 'the module must gate on the verb-carrying extension version');

/* ---- vm harness -------------------------------------------------------- */
function bus() {
  const map = {};
  return {
    add: function (t, fn) { (map[t] = map[t] || []).push(fn); },
    remove: function (t, fn) { const a = map[t] || []; const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); },
    fire: function (t, ev) { (map[t] || []).slice().forEach(function (fn) { try { fn(ev); } catch (e) {} }); },
    count: function (t) { return (map[t] || []).length; }
  };
}
const wbus = bus(), dbus = bus();
const store = {};
const posted = [];
const toasts = [];
let activeId = 'pb';
let responder = null;   /* function(body) -> reply object or null */

const ctx = {
  console: console, Date: Date, Math: Math, Promise: Promise,
  setTimeout: setTimeout, clearTimeout: clearTimeout,
  location: { origin: 'https://mlsscribe.com' },
  localStorage: {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem: function (k, v) { store[k] = String(v); },
    removeItem: function (k) { delete store[k]; }
  },
  uns: function (k) { return 't::' + k; },
  document: {
    visibilityState: 'hidden',
    getElementById: function () { return null; },
    addEventListener: function (t, fn) { dbus.add(t, fn); },
    removeEventListener: function (t, fn) { dbus.remove(t, fn); }
  },
  toast: function (m) { toasts.push(String(m)); },
  getPatients: function () {
    return [
      { id: 'pa', name: 'Adam J Schaeffer', dob: '01/02/1980' },
      { id: 'pb', name: 'Bee Person', dob: '02/03/1970' },
      { id: 'tw1', name: 'Twin Same', dob: '03/04/1960' },
      { id: 'tw2', name: 'Twin Same', dob: '03/04/1960' }
    ];
  },
  findPatient: function (id) { return ctx.getPatients().find(function (p) { return p.id === id; }) || null; },
  getActivePtId: function () { return activeId; },
  setActivePtId: function (id) {
    const prev = activeId; activeId = String(id);
    wbus.fire('mls:active-patient-changed', { detail: { previousId: prev, patientId: activeId } });
  }
};
ctx.window = ctx;
ctx.addEventListener = function (t, fn) { wbus.add(t, fn); };
ctx.removeEventListener = function (t, fn) { wbus.remove(t, fn); };
ctx.postMessage = function (body) {
  posted.push(body);
  if (!responder || !body || body.source !== 'mls-app') return;
  const reply = responder(body);
  if (reply) setTimeout(function () { wbus.fire('message', { data: reply }); }, 5);
};

vm.createContext(ctx);
vm.runInContext(mod, ctx, { filename: 'feat_mls_athena_follow.js' });
const api = ctx.__mlsAthenaFollow;
assert(api && api.installed && api.version === 'af-1.0.0', 'follow module did not install');

/* ---- pure identity math ------------------------------------------------- */
assert(api._samePerson('Adam J Schaeffer', '01/02/1980', 'SCHAEFFER, Adam J', '1980-01-02'),
  'name-order/format variants of the same person must match');
assert(!api._samePerson('Adam J Schaeffer', '01/02/1980', 'Adam J Schaeffer', '01/03/1980'),
  'a DOB disagreement must refuse');
assert(!api._samePerson('Adam J Schaeffer', '', 'Adam Other', ''), 'different names must refuse');
assert(api._resolveLocal({ name: 'Twin Same', dob: '03/04/1960' }) === null,
  'two identical local candidates must resolve to NOTHING (fail closed)');
assert(api._resolveLocal({ name: 'Adam J Schaeffer', dob: '' }) && api._resolveLocal({ name: 'Adam J Schaeffer', dob: '' }).id === 'pa',
  'a unique name resolves even when the chart shows no DOB');

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async function () {
  /* 1 - NO PONG: Leg A fires, nothing may be posted beyond the ping itself */
  ctx.document.visibilityState = 'visible';
  responder = function () { return null; };                     /* extension silent */
  ctx.setActivePtId('pa');
  await sleep(1700 + 2600);                                     /* debounce + ping timeout */
  assert(!posted.some(function (m) { return m.type === 'mlsAppSearchOpenPatient'; }),
    'no pong must mean NO navigation - fail closed');

  /* 2 - pong appears later: the missed ping must not have been cached */
  api._resetExtCache();                                          /* stands in for the 30s throttle */
  posted.length = 0;
  responder = function (body) {
    if (body.type === 'mlsPing') return { source: 'mls-ext', type: 'mlsPong', requestId: body.requestId, version: '3.0.23' };
    if (body.type === 'mlsAppChartIdentity') return { source: 'mls-ext', type: 'mlsAppChartIdentityResult', requestId: body.requestId, resp: { ok: true, identity: { name: 'Someone Else', dob: '05/05/1950' } } };
    return null;
  };
  ctx.setActivePtId('pb');
  await sleep(1700 + 400);
  const nav = posted.find(function (m) { return m.type === 'mlsAppSearchOpenPatient'; });
  assert(nav && nav.name === 'Bee Person' && nav.dob === '02/03/1970',
    'Leg A must post the proven search-open lane with name+dob after debounce');

  /* 3 - skip-if-already-open: same person on the open chart, no nav */
  posted.length = 0;
  responder = function (body) {
    if (body.type === 'mlsPing') return { source: 'mls-ext', type: 'mlsPong', requestId: body.requestId, version: '3.0.23' };
    if (body.type === 'mlsAppChartIdentity') return { source: 'mls-ext', type: 'mlsAppChartIdentityResult', requestId: body.requestId, resp: { ok: true, identity: { name: 'SCHAEFFER, Adam J', dob: '1980-01-02' } } };
    return null;
  };
  ctx.setActivePtId('pa');
  await sleep(1700 + 400);
  assert(!posted.some(function (m) { return m.type === 'mlsAppSearchOpenPatient'; }),
    'Leg A must skip when athena already shows that patient');

  /* 4 - Leg B: arrival follows the open chart and suppresses Leg A */
  posted.length = 0;
  activeId = 'pa';
  responder = function (body) {
    if (body.type === 'mlsPing') return { source: 'mls-ext', type: 'mlsPong', requestId: body.requestId, version: '3.0.23' };
    if (body.type === 'mlsAppChartIdentity') return { source: 'mls-ext', type: 'mlsAppChartIdentityResult', requestId: body.requestId, resp: { ok: true, identity: { name: 'Bee Person', dob: '02/03/1970' } } };
    return null;
  };
  dbus.fire('visibilitychange');
  await sleep(400);
  assert.strictEqual(activeId, 'pb', 'Leg B must follow the open athena chart');
  assert(toasts.some(function (t) { return /Following athenaOne: Bee Person/.test(t); }), 'Leg B must say what it did');
  await sleep(1800);                                             /* Leg A debounce window passes */
  assert(!posted.some(function (m) { return m.type === 'mlsAppSearchOpenPatient'; }),
    'the banner change Leg B caused must be SUPPRESSED - no echo navigation');

  /* 5 - pull-busy blocks Leg B */
  ctx.__mlsPullBusyAt = Date.now();
  activeId = 'pa';
  await sleep(900);                                              /* clear the arrival dedupe */
  dbus.fire('visibilitychange');
  await sleep(400);
  assert.strictEqual(activeId, 'pa', 'a running pull must block follow');
  delete ctx.__mlsPullBusyAt;

  /* 6 - revert unhooks */
  const before = wbus.count('mls:active-patient-changed');
  api.revert();
  assert(wbus.count('mls:active-patient-changed') === before - 1, 'revert must remove the Leg A listener');

  console.log('PASS athena follow bidirectional: fail-closed without pong, missed ping retries, Leg A debounced nav + skip-if-open, Leg B exact follow + loop suppression, pull guard, clean revert - all in vm; bridge verb gated + handled, 3.0.23 stamped and fed');
})().catch(function (e) { console.error(e); process.exit(1); });
