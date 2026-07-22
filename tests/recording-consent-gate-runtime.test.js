'use strict';
/* cg-1.0.0 (2026-07-22): encounter-specific patient consent BEFORE any visit
 * audio capture. This suite pins:
 *   - source order: consent gate sits before recognizer prep / mic / hub claim
 *     in startCapture, and before /api/mic/start in startPhoneMic
 *   - verbal + representative consent allow capture; declined prevents it
 *   - the mic entry is refused (fail closed) while the dialog is open
 *   - patient change and encounter change require fresh consent
 *   - stop/restart inside the same encounter does NOT re-prompt
 *   - audit record carries the exact patient/encounter/provider/type/time/
 *     user/text-version/audio-retention fields; no audio is stored
 *   - a failed audit write refuses to start an untracked recording
 *   - the reconfirm action forces one re-ask
 *   - no native confirm()/prompt() anywhere in the consent path
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');

/* ---------- 1. source-order contracts ---------- */
const cap = app.slice(app.indexOf('function startCapture(){'), app.indexOf('function stopCapture(){'));
const capConsent = cap.indexOf('_mlsHasEncounterConsent');
assert(capConsent >= 0, 'startCapture lost its consent gate');
assert(capConsent < cap.indexOf('initRecog()'), 'consent gate must run before the recognizer is even prepared');
assert(capConsent < cap.indexOf("hub.register('visit'"), 'consent gate must run before the speech-hub claim');
assert(capConsent < cap.indexOf('capturing=true'), 'consent gate must run before capture state flips on');
assert(cap.indexOf('return false;', capConsent) < cap.indexOf('initRecog()'), 'unconsented start does not fail closed');
assert(/if\(ok&&!capturing\) startCapture\(\)/.test(cap), 'confirmed consent does not re-invoke the canonical entry exactly once');

const phone = app.slice(app.indexOf('async function startPhoneMic(clickEvent){'), app.indexOf('async function pollPhoneMic()'));
const phoneConsent = phone.indexOf('_mlsHasEncounterConsent');
assert(phoneConsent >= 0, 'startPhoneMic lost its consent gate');
assert(phoneConsent < phone.indexOf('/api/mic/start'), 'phone consent gate must run before the server mic session is requested');
assert(phone.indexOf('await _mlsRequestEncounterConsent', phoneConsent) > 0, 'phone gate is not awaited');

const consentSrc = app.slice(app.indexOf('const MLS_CONSENT_TEXT_VERSION'), app.indexOf('/* =========================================================\n   PATIENTS'));
assert(consentSrc.includes('Patient verbally consented') && consentSrc.includes('Authorized representative consented') && consentSrc.includes('Patient declined'), 'the three consent options are missing');
assert(consentSrc.includes('Confirm consent and start capture'), 'main action label missing');
assert(!/window\.confirm\(|window\.prompt\(|[^.\w]confirm\(|[^.\w]prompt\(/.test(consentSrc.replace(/confirm consent/gi, '')), 'consent path uses a native blocking dialog');
assert(consentSrc.includes('audioRetentionDisabled'), 'audit record lost the audio-retention field');
assert(!/MediaRecorder|getUserMedia|new Audio|SpeechRecognition/.test(consentSrc), 'the consent module itself must never touch audio APIs');

/* ---------- 2. runtime behavior ---------- */
function harness() {
  const toasts = [];
  const store = {};
  let failWrites = false;
  const ctx = {
    console, Promise, Object, Array, String, JSON, Date, Math,
    window: {},
    document: {
      body: { appendChild() {}, children: [] },
      getElementById() { return null; },
      createElement() {
        return {
          style: {}, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, appendChild() {},
          addEventListener() {}, remove() {}, querySelector() { return null; }, querySelectorAll() { return []; }
        };
      },
      addEventListener() {}, removeEventListener() {}, activeElement: null
    },
    localStorage: {
      getItem(k) { return store[k] == null ? null : store[k]; },
      setItem(k, v) { if (failWrites) throw new Error('quota'); store[k] = String(v); }
    },
    uns: s => 'test::' + s,
    esc: s => String(s == null ? '' : s),
    toast(m, t) { toasts.push({ m: String(m), t }); },
    getName() { return 'Matthew Schaeffer, MD'; },
    getSessionEmail() { return 'doctor@example.test'; },
    _acctTodayKey() { return '2026-07-22'; },
    activePatient() { return ctx.__pt; },
    __pt: { id: 'pt1', name: 'Alice Alpha', dob: '01/02/1970' },
    currentVisitAthenaBinding: { visitContext: { appointmentId: 'appt-1', visitDate: '2026-07-22' } }
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(consentSrc + '\nthis.__setFailWrites=v=>{};', ctx, { filename: 'consent-module.js' });
  // expose write-failure toggle via closure emulation: re-wire localStorage
  ctx.__failWrites = v => { failWrites = v; };
  ctx.__toasts = toasts;
  ctx.__store = store;
  return ctx;
}

/* drive the dialog: the DOM is stubbed, so resolve decisions by calling the
   build() handlers captured through _mlsDialogBase — emulate by re-implementing
   _mlsDialogBase's contract: capture the build call. */
function drive(ctx, choice, opts) {
  opts = opts || {};
  let controls = null;
  ctx._mlsDialogBase = function (build) {
    return new Promise(resolve => {
      const stubEl = id => ({ id, value: '', style: {}, onclick: null, addEventListener() {}, textContent: '' });
      const els = {};
      const card = {
        _html: '', set innerHTML(v) { this._html = v; }, get innerHTML() { return this._html; },
        querySelector(sel) {
          const id = String(sel).replace('#', '');
          if (/_mlsConsentOpt/.test(sel)) return { value: choice };
          if (!els[id]) els[id] = stubEl(id);
          return els[id];
        },
        querySelectorAll() { return []; },
        setAttribute() {}
      };
      const api = build(card, resolve);
      controls = { card, api, els };
      if (opts.escape) { resolve(api.cancelValue); return; }
      if (opts.cancel) { els._mlsAskNo.onclick(); return; }
      els._mlsAskYes.onclick();
    });
  };
  return controls;
}

(async () => {
  /* verbal consent allows capture and writes an exact audit record */
  let ctx = harness();
  drive(ctx, 'patient-verbal');
  assert.strictEqual(ctx._mlsHasEncounterConsent(), false, 'consent must start absent');
  assert.strictEqual(await ctx._mlsRequestEncounterConsent('recording'), true, 'verbal consent did not allow capture');
  assert.strictEqual(ctx._mlsHasEncounterConsent(), true, 'confirmed consent not remembered for the encounter');
  let log = JSON.parse(ctx.__store['test::consentLog']);
  assert.strictEqual(log.length, 1);
  const rec = log[0];
  assert.strictEqual(rec.patientId, 'pt1');
  assert.strictEqual(rec.encounterId, 'appt:appt-1');
  assert.strictEqual(rec.provider, 'Matthew Schaeffer, MD');
  assert.strictEqual(rec.consentType, 'patient-verbal');
  assert.strictEqual(rec.confirmedBy, 'doctor@example.test');
  const declaredVersion = (consentSrc.match(/MLS_CONSENT_TEXT_VERSION='([^']+)'/) || [])[1];
  assert(declaredVersion, 'consent-text version constant missing');
  assert.strictEqual(rec.textVersion, declaredVersion);
  assert(typeof rec.audioRetentionDisabled === 'boolean', 'audio retention flag missing');
  assert(rec.at && !Number.isNaN(Date.parse(rec.at)), 'timestamp missing/invalid');
  assert(!('audio' in rec) && !('blob' in rec) && !('transcript' in rec), 'consent record must never carry audio/transcript payloads');

  /* same-encounter restart: no re-prompt needed (hasEncounterConsent true) */
  assert.strictEqual(ctx._mlsHasEncounterConsent(), true, 'stop/restart in the same encounter must not re-ask');

  /* reconfirm action forces one re-ask */
  ctx.mlsReconfirmConsent();
  assert.strictEqual(ctx._mlsHasEncounterConsent(), false, 'reconfirm did not clear the encounter consent');

  /* representative consent allows capture */
  ctx = harness();
  drive(ctx, 'representative');
  assert.strictEqual(await ctx._mlsRequestEncounterConsent('recording'), true, 'representative consent did not allow capture');
  assert.strictEqual(JSON.parse(ctx.__store['test::consentLog'])[0].consentType, 'representative');

  /* declined prevents capture and stores no consent */
  ctx = harness();
  drive(ctx, 'declined');
  assert.strictEqual(await ctx._mlsRequestEncounterConsent('recording'), false, 'declined consent still allowed capture');
  assert.strictEqual(ctx._mlsHasEncounterConsent(), false, 'declined consent was remembered as consent');
  assert(!ctx.__store['test::consentLog'], 'declining must not write a consent record');
  assert(ctx.__toasts.some(t => /patient declined/i.test(t.m) && /continues normally/i.test(t.m)), 'declining lost its calm non-blocking explanation');

  /* cancel / Escape also prevent capture */
  ctx = harness();
  drive(ctx, 'patient-verbal', { cancel: true });
  assert.strictEqual(await ctx._mlsRequestEncounterConsent('recording'), false, 'cancel still allowed capture');
  ctx = harness();
  drive(ctx, 'patient-verbal', { escape: true });
  assert.strictEqual(await ctx._mlsRequestEncounterConsent('recording'), false, 'Escape still allowed capture');

  /* patient change requires new consent */
  ctx = harness();
  drive(ctx, 'patient-verbal');
  await ctx._mlsRequestEncounterConsent('recording');
  ctx.__pt = { id: 'pt2', name: 'Bob Beta' };
  assert.strictEqual(ctx._mlsHasEncounterConsent(), false, 'a different patient reused the prior consent');

  /* encounter change (same patient) requires new consent */
  ctx = harness();
  drive(ctx, 'patient-verbal');
  await ctx._mlsRequestEncounterConsent('recording');
  ctx.currentVisitAthenaBinding = { visitContext: { appointmentId: 'appt-2', visitDate: '2026-07-22' } };
  assert.strictEqual(ctx._mlsHasEncounterConsent(), false, 'a different encounter reused the prior consent');

  /* failed audit logging refuses to start an untracked recording */
  ctx = harness();
  drive(ctx, 'patient-verbal');
  ctx.__failWrites(true);
  assert.strictEqual(await ctx._mlsRequestEncounterConsent('recording'), false, 'a failed consent write still allowed capture');
  assert.strictEqual(ctx._mlsHasEncounterConsent(), false, 'unlogged consent was remembered');
  assert(ctx.__toasts.some(t => t.t === 'err' && /could not be logged/i.test(t.m)), 'failed logging was silent');

  /* no active patient: refused with guidance */
  ctx = harness();
  ctx.__pt = null;
  assert.strictEqual(await ctx._mlsRequestEncounterConsent('recording'), false, 'consent dialog opened with no patient');

  console.log('PASS recording consent gate: capture blocked before consent on both mic paths, verbal/representative allow, declined/cancel/Escape refuse, per-encounter memory with patient+encounter invalidation and reconfirm, exact audit record, fail-closed logging, no audio stored');
})().catch(e => { console.error(e); process.exit(1); });
