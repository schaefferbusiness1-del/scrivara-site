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
 * legboffer-1.0.0 (2026-09-11) adds the defect measured live on b1231: the note
 * step's "Next: Review & send to Athena" opens the unified Send sheet, whose
 * read-only probe DRIVES athenaOne onto a scheduled chart, and Leg B then
 * followed our own navigation - aborting the generation, resetting the outputs
 * and dropping the engine to Home under another patient's name. Pinned below:
 *  - with a chart up and a transcript on screen, Leg B OFFERS (the schedule
 *    anchor's own painter, window.__mlsPtAnchor.offer) and switches NOTHING -
 *    getActivePtId() is unchanged and mls:active-patient-changed never fires;
 *  - an arrival MLS itself caused (capsel-1.0.0's predicate, or the write
 *    lane's own wfnav-1.0.0 stamp) is ignored outright - not even an offer;
 *  - the CONTROL: no chart active and the editors empty, and Leg B still
 *    follows athenaOne exactly as it always did.
 * The cross-file wiring is pinned too, because a flag nothing reads is dead
 * (the v1.52 lesson this file already carries for the bridge verb):
 * 1p-feat_mls_writeflow.js must SET state.athenaBusy and
 * 1p-feat_mls_schedimport_exact.js's dnote-1.1.0 write-lane claim must READ it.
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
const writeflow = fs.readFileSync(path.join(root, '1p-feat_mls_writeflow.js'), 'utf8');
const importer = fs.readFileSync(path.join(root, '1p-feat_mls_schedimport_exact.js'), 'utf8');

/* ---- extension + wiring pins ------------------------------------------- */
assert(/MLS_BRIDGE_TYPES = \{[^}]*mlsAppChartIdentity: 1/.test(content),
  'mlsAppChartIdentity is missing from the bridge allowlist - the handler is dead (v1.52 class)');
assert(content.includes("if (d.type === 'mlsAppChartIdentity') {") &&
  content.includes("mlsRelayRetry({ type: 'mlsAssistChartIdentity' }"),
  /* rr-3076 wraps the forward in the dead-worker retry; mlsRelayRetry itself calls chrome.runtime.sendMessage */
  'the chart-identity verb must forward to the proven write-safety identity handler');
/* qol-2.4b taught this file the lesson once already (see the comment below,
   which still hand-carried a SECOND literal that drifted the same way): a pin
   that must be hand-moved on every release eventually is not moved. Assert
   the SHAPE of the version, then derive every other pin from manifest.version
   itself so the release sweep never has to touch this file again. */
assert(/^3\.0\.\d+$/.test(manifest.version), 'extension manifest version must be a 3.0.x release, got ' + manifest.version);
/* qol-2.4b: SELF-DERIVED from manifest.version rather than a hand-carried
   literal — this line still said 3.0.56 while line 45 said 3.0.77, red since
   the version first moved and invisible behind every partial gate. A pin
   that must be hand-moved on every release eventually is not moved. */
assert(new RegExp('^' + manifest.version.replace(/\./g, '\\.') + '\\+core-sha256:[0-9a-f]{64}$').test(manifest.version_name),
  'manifest must carry the stamped core digest for its OWN version');
assert.strictEqual(feed.version, manifest.version, 'release feed must announce the manifest version');
assert(connect.includes('data-mls-asset="feat_mls_athena_follow.js"'), 'the follow module has no loader');
assert(app.includes('id="athenaFollowToggle"'), 'the off-switch is missing from Settings -> Integrations');
assert(mod.includes("var MIN_EXT = '3.0.23';"), 'the module must gate on the verb-carrying extension version');

/* ---- legboffer-1.0.0: the write lane's stamp and its ONE reader ---------- */
/* A flag nothing reads is dead, and a reader with no writer is worse - it is
   what shipped: dnoteAthenaDriver has claimed "write-lane" off
   state.running/.busy/.athenaBusy since b1184, and the write flow's STATE
   carried none of those three names, so the claim never fired once and the
   whole shipped follow guard was never consulted for this lane. Pin BOTH ends
   of the wire, in the canonical 1p sources. */
assert(/claim\("write-lane",[^\n]*s\.athenaBusy === true/.test(importer),
  "dnote-1.1.0's write-lane claim must read state.athenaBusy - without it the follow guard is blind to the Send sheet");
assert(/STATE\.athenaBusy = true;/.test(writeflow) && /STATE\.athenaBusy = false;/.test(writeflow),
  'the write flow must hold state.athenaBusy while it drives athenaOne (wfnav-1.0.0)');
assert(writeflow.includes('function searchOpenTarget(patient, expectedContext) {') &&
  /wfNavBegin\(\);\s*\n\s*function fin\(v\)/.test(writeflow) && /function fin\(v\) \{ if \(done\) return; done = true; wfNavEnd\(\);/.test(writeflow),
  'the one chart-opening door in the write flow must declare and release the hop');
assert(/var WF_NAV_VERBS = \{ mlsAppGotoDate: 1, mlsAppAthenaActionV2: 1 \};/.test(writeflow),
  'the day-strip drive and every action-v2 hop are the verbs that move athenaOne');
assert(mod.includes("window._mlsCaptureKeepsSelection('athena-follow-legb', false)"),
  'Leg B must consult capsel-1.0.0 so the sheet\'s own auto-open is not mistaken for the doctor navigating Athena');
assert(mod.includes('window.__mlsPtAnchor') && !/createElement\('button'\)/.test(mod),
  'the offer must be the schedule anchor\'s own painter - this module may not grow a second copy of that markup');

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
/* legboffer-1.0.0: a page the module can actually read - the doctor's own
   surfaces (#transcript, #noteBox, the Send sheet, the body step classes) and
   the schedule anchor's offer painter, recorded rather than rendered. */
const els = {};
const bodyClasses = {};
const offers = [];

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
    getElementById: function (id) { return Object.prototype.hasOwnProperty.call(els, id) ? els[id] : null; },
    body: { classList: { contains: function (c) { return bodyClasses[c] === true; } } },
    addEventListener: function (t, fn) { dbus.add(t, fn); },
    removeEventListener: function (t, fn) { dbus.remove(t, fn); }
  },
  __mlsPtAnchor: {
    installed: true,
    offer: function (name, id) { offers.push({ name: String(name), id: String(id) }); return true; }
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
assert(api && api.installed && api.version === 'af-1.1.0', 'follow module did not install');
assert(api.offerVersion === 'legboffer-1.0.0', 'the offer-never-switch rule must be stamped on the module');

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

  /* ===================================================================== */
  /* legboffer-1.0.0 - THE b1231 DEFECT, and the two sides of its cure.     */
  /* ===================================================================== */
  const beeOpen = function (body) {
    if (body.type === 'mlsPing') return { source: 'mls-ext', type: 'mlsPong', requestId: body.requestId, version: '3.0.23' };
    if (body.type === 'mlsAppChartIdentity') return { source: 'mls-ext', type: 'mlsAppChartIdentityResult', requestId: body.requestId, resp: { ok: true, identity: { name: 'Bee Person', dob: '02/03/1970' } } };
    return null;
  };
  let switches = 0;
  const countSwitch = function () { switches++; };
  wbus.add('mls:active-patient-changed', countSwitch);

  /* 6 - MEASURED DEFECT: the Send sheet's probe parked athenaOne on somebody
     else while the doctor had a transcript open. Leg B must OFFER, not take
     him off the chart he is writing about. */
  posted.length = 0; toasts.length = 0; offers.length = 0;
  activeId = 'pa';
  switches = 0;
  els.transcript = { value: 'synthetic test transcript - three lines of dictation' };
  responder = beeOpen;
  await sleep(900);                                              /* clear the arrival dedupe */
  dbus.fire('visibilitychange');
  await sleep(400);
  wbus.fire('focus');                                            /* the other arrival trigger */
  await sleep(900);
  assert.strictEqual(activeId, 'pa', 'Leg B must NOT switch the doctor off the chart he is working in');
  assert.strictEqual(switches, 0, 'no mls:active-patient-changed may be dispatched by an automatic follow');
  assert(offers.length >= 1 && offers[0].id === 'pb' && offers[0].name === 'Bee Person',
    "the schedule anchor's own offer must be rendered instead of a switch");
  assert(toasts.some(function (t) { return /Nothing was switched/.test(t); }),
    'the doctor must be told in plain words that nothing moved');
  assert.strictEqual(api.receipt().follows, 1, 'the only follow so far is section 4\'s');

  /* 7 - AN ARRIVAL MLS ITSELF CAUSED: not even an offer. Both shipped
     predicates, one at a time. */
  offers.length = 0; toasts.length = 0;
  delete els.transcript;                                         /* the editors are empty now */
  activeId = 'pa';
  ctx.__mlsWriteFlow = { state: { athenaBusy: true } };           /* wfnav-1.0.0, mid-hop */
  await sleep(900);
  dbus.fire('visibilitychange');
  await sleep(400);
  assert.strictEqual(activeId, 'pa', "the write lane's own navigation is not the doctor navigating Athena");
  assert.strictEqual(offers.length, 0, 'MLS must not offer to switch to a chart MLS itself opened');
  ctx.__mlsWriteFlow = { state: { athenaBusy: false, athenaBusyAt: Date.now() } };  /* the grace seconds after */
  await sleep(900);
  dbus.fire('visibilitychange');
  await sleep(400);
  assert.strictEqual(activeId, 'pa', 'the seconds AFTER the hop are the seconds the doctor spends arriving back');
  delete ctx.__mlsWriteFlow;
  ctx._mlsCaptureKeepsSelection = function (lane, scopedOnly) { return lane === 'athena-follow-legb' && scopedOnly === false; };
  await sleep(900);
  dbus.fire('visibilitychange');
  await sleep(400);
  assert.strictEqual(activeId, 'pa', "capsel-1.0.0's predicate must block the follow on its own");
  assert.strictEqual(offers.length, 0, 'still nothing offered');
  delete ctx._mlsCaptureKeepsSelection;
  assert(api.receipt().drivenIgnored >= 3, 'each ignored arrival is counted, PHI-free');

  /* 8 - THE CONTROL. Nothing driving, no chart active, the editors empty:
     Leg B still does exactly what it was built to do. */
  offers.length = 0; toasts.length = 0;
  activeId = '';
  bodyClasses['mls-review-step'] = false; bodyClasses.ez3adv = false;
  await sleep(900);
  dbus.fire('visibilitychange');
  await sleep(400);
  assert.strictEqual(activeId, 'pb', 'with no work open and nothing driving, Leg B must still follow athenaOne');
  assert.strictEqual(offers.length, 0, 'a plain follow renders no offer');
  assert.strictEqual(api.receipt().follows, 2, 'the follow was counted');
  wbus.remove('mls:active-patient-changed', countSwitch);

  /* 9 - the review step alone is enough: no transcript, no note, but the
     doctor is standing on Review & send with a chart up. And the standing
     offer is not RE-SPOKEN at a doctor who flips tabs - it is already there. */
  offers.length = 0; toasts.length = 0;
  activeId = 'pa';
  bodyClasses['mls-review-step'] = true;
  await sleep(900);
  dbus.fire('visibilitychange');
  await sleep(400);
  assert.strictEqual(activeId, 'pa', 'the review step is visit work in flight');
  assert(offers.length === 1 && offers[0].id === 'pb', 'and it gets the offer');
  assert.strictEqual(toasts.length, 0, 'the same offer inside a minute must not be spoken twice');
  bodyClasses['mls-review-step'] = false;

  /* 10 - the open Send sheet alone is enough, by its own element id */
  offers.length = 0;
  activeId = 'pa';
  els.mlsAthenaUnifiedConfirm = { id: 'mlsAthenaUnifiedConfirm' };
  await sleep(900);
  dbus.fire('visibilitychange');
  await sleep(400);
  assert.strictEqual(activeId, 'pa', 'an open Send sheet is visit work in flight');
  assert(offers.length === 1, 'and it gets the offer');
  delete els.mlsAthenaUnifiedConfirm;

  /* 11 - revert unhooks */
  const before = wbus.count('mls:active-patient-changed');
  api.revert();
  assert(wbus.count('mls:active-patient-changed') === before - 1, 'revert must remove the Leg A listener');

  console.log('PASS athena follow bidirectional: fail-closed without pong, missed ping retries, Leg A debounced nav + skip-if-open, Leg B exact follow + loop suppression, pull guard, clean revert - all in vm; bridge verb gated + handled, 3.0.23 stamped and fed; legboffer-1.0.0: with a chart up and visit work on screen Leg B renders the schedule anchor offer and switches NOTHING (no active-patient event), an arrival MLS itself caused is ignored outright by both shipped predicates, and the empty-editor control still follows');
})().catch(function (e) { console.error(e); process.exit(1); });
