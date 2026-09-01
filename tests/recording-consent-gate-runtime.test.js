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
 *   - quota retries evict only allowlisted caches, then a verified per-account
 *     IndexedDB fallback allows capture without weakening fail-closed consent
 *   - a failed audit write in BOTH stores refuses an untracked recording
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
function fakeIndexedDb() {
  const dbs = new Map();
  const state = { failOpen: false, failPut: false, mismatchRead: false, hold: false, pending: [], puts: 0, opens: [], deleted: [] };
  function defer(fn) { if (state.hold) state.pending.push(fn); else Promise.resolve().then(fn); }
  function database(name) {
    let meta = dbs.get(name);
    if (!meta) { meta = { created: false, rows: new Map() }; dbs.set(name, meta); }
    const db = {
      objectStoreNames: { contains() { return meta.created; } },
      createObjectStore() { meta.created = true; return {}; },
      transaction(_store, mode) {
        const tx = { mode, oncomplete: null, onerror: null, onabort: null };
        tx.objectStore = function () {
          return {
            put(row) {
              const req = {};
              state.puts += 1;
              defer(() => {
                if (state.failPut) { if (req.onerror) req.onerror(); if (tx.onerror) tx.onerror(); return; }
                meta.rows.set(String(row.auditId), JSON.parse(JSON.stringify(row)));
                if (req.onsuccess) req.onsuccess();
                if (tx.oncomplete) tx.oncomplete();
              });
              return req;
            },
            get(id) {
              const req = {};
              defer(() => {
                const row = meta.rows.get(String(id));
                req.result = row ? JSON.parse(JSON.stringify(row)) : undefined;
                if (req.result && state.mismatchRead) req.result.patientId = 'mismatched-readback';
                if (req.onsuccess) req.onsuccess();
              });
              return req;
            }
          };
        };
        return tx;
      },
      close() {}
    };
    return db;
  }
  const api = {
    open(name) {
      state.opens.push(String(name));
      const request = {};
      defer(() => {
        if (state.failOpen) { if (request.onerror) request.onerror(); return; }
        const db = database(String(name)); request.result = db;
        const meta = dbs.get(String(name));
        if (!meta.created && request.onupgradeneeded) request.onupgradeneeded();
        if (request.onsuccess) request.onsuccess();
      });
      return request;
    },
    deleteDatabase(name) {
      const request = {};
      defer(() => { state.deleted.push(String(name)); dbs.delete(String(name)); if (request.onsuccess) request.onsuccess(); });
      return request;
    }
  };
  state.release = function () {
    state.hold = false;
    const jobs = state.pending.splice(0);
    jobs.forEach(fn => Promise.resolve().then(fn));
  };
  state.rows = function (name) { const db = dbs.get(String(name)); return db ? [...db.rows.values()] : []; };
  state.has = function (name) { return dbs.has(String(name)); };
  return { api, state };
}

function harness() {
  const toasts = [];
  const store = {};
  let writeMode = 'ok';
  let account = 'doctor@example.test';
  const idb = fakeIndexedDb();
  const ctx = {
    console, Promise, Object, Array, String, JSON, Date, Math,
    setTimeout, clearTimeout,
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
      get length() { return Object.keys(store).length; },
      key(i) { return Object.keys(store)[i] == null ? null : Object.keys(store)[i]; },
      getItem(k) { return store[k] == null ? null : store[k]; },
      setItem(k, v) {
        if (writeMode === 'always' || (writeMode === 'until-cache-evicted' && store['test::calApptsCacheV2'] != null)) {
          const error = new Error('QuotaExceededError'); error.name = 'QuotaExceededError'; throw error;
        }
        store[k] = String(v);
      },
      removeItem(k) { delete store[k]; }
    },
    indexedDB: idb.api,
    uns: s => 'test::' + s,
    esc: s => String(s == null ? '' : s),
    toast(m, t) { toasts.push({ m: String(m), t }); },
    getName() { return 'Matthew Schaeffer, MD'; },
    getSessionEmail() { return account; },
    _acctTodayKey() { return '2026-07-22'; },
    activePatient() { return ctx.__pt; },
    __pt: { id: 'pt1', name: 'Alice Alpha', dob: '01/02/1970' },
    currentVisitAthenaBinding: { visitContext: { appointmentId: 'appt-1', visitDate: '2026-07-22' } },
    addEventListener() {}, removeEventListener() {}
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(consentSrc + '\nthis.__setFailWrites=v=>{};', ctx, { filename: 'consent-module.js' });
  // expose write-failure toggle via closure emulation: re-wire localStorage
  ctx.__failWrites = v => { writeMode = v ? 'always' : 'ok'; };
  ctx.__writeMode = v => { writeMode = v; };
  ctx.__setAccount = v => { account = String(v); };
  ctx.__toasts = toasts;
  ctx.__store = store;
  ctx.__idb = idb.state;
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
      let open = true;
      function finish(value) { if (!open) return; open = false; resolve(value); }
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
      const api = build(card, finish, () => open);
      controls = { card, api, els, close: finish, isOpen: () => open };
      ctx.__dialogControls = controls;
      if (opts.deferDecision) return;
      if (opts.escape) { finish(api.cancelValue); return; }
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
  assert(/^consent-/.test(rec.auditId), 'unique consent audit id missing');
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

  /* Quota recovery evicts ONLY the allowlisted current-account calendar cache,
     then keeps the established local audit format. */
  ctx = harness();
  ctx.__store['test::calApptsCacheV2'] = 'regenerable schedule snapshot';
  ctx.__store['test::patients'] = 'protected patient bytes';
  ctx.__store['test::notes'] = 'protected note bytes';
  ctx.__store['test::preference'] = 'protected setting';
  ctx.__store.mls_studygroups_v1 = 'protected user-created study cohorts';
  ctx.__writeMode('until-cache-evicted');
  drive(ctx, 'patient-verbal');
  assert.strictEqual(await ctx._mlsRequestEncounterConsent('recording'), true, 'safe cache eviction did not recover the local consent audit');
  assert(!ctx.__store['test::calApptsCacheV2'], 'regenerable calendar cache was not evicted after quota');
  assert.strictEqual(ctx.__store['test::patients'], 'protected patient bytes', 'quota recovery deleted patient records');
  assert.strictEqual(ctx.__store['test::notes'], 'protected note bytes', 'quota recovery deleted notes');
  assert.strictEqual(ctx.__store['test::preference'], 'protected setting', 'quota recovery deleted settings');
  assert.strictEqual(ctx.__store.mls_studygroups_v1, 'protected user-created study cohorts', 'quota recovery deleted user-created study cohorts');
  assert.strictEqual(ctx.__idb.puts, 0, 'IndexedDB ran even though the safe local retry succeeded');

  /* A full localStorage bucket falls back to a separate per-account database.
     The write transaction and a separate readonly readback both have to agree. */
  ctx = harness();
  ctx.__failWrites(true);
  drive(ctx, 'patient-verbal');
  assert.strictEqual(await ctx._mlsRequestEncounterConsent('recording'), true, 'verified IndexedDB fallback did not allow capture');
  assert.strictEqual(ctx._mlsHasEncounterConsent(), true, 'verified fallback consent was not remembered');
  assert.strictEqual(ctx.__idb.puts, 1, 'fallback wrote more than one consent record');
  const fallbackDb = ctx.__idb.opens[0];
  const fallbackRows = ctx.__idb.rows(fallbackDb);
  assert.strictEqual(fallbackRows.length, 1, 'fallback audit record was not durable');
  assert.strictEqual(fallbackRows[0].patientId, 'pt1');
  assert.strictEqual(fallbackRows[0].accountId, 'doctor@example.test');

  /* A malformed historical audit is preserved for recovery; it is neither
     overwritten nor used as an excuse to evict unrelated caches. */
  ctx = harness();
  ctx.__store['test::consentLog'] = '{malformed historical audit';
  ctx.__store['test::calApptsCacheV2'] = 'still-valid schedule cache';
  drive(ctx, 'patient-verbal');
  assert.strictEqual(await ctx._mlsRequestEncounterConsent('recording'), true, 'malformed local audit did not use verified fallback');
  assert.strictEqual(ctx.__store['test::consentLog'], '{malformed historical audit', 'malformed prior consent evidence was overwritten');
  assert.strictEqual(ctx.__store['test::calApptsCacheV2'], 'still-valid schedule cache', 'non-quota failure evicted a schedule cache');
  assert.strictEqual(ctx.__idb.puts, 1, 'malformed local audit did not write exactly one verified fallback record');

  /* A mismatching readback is not durability and must stay fail closed. */
  ctx = harness();
  ctx.__failWrites(true); ctx.__idb.mismatchRead = true;
  drive(ctx, 'patient-verbal');
  assert.strictEqual(await ctx._mlsRequestEncounterConsent('recording'), false, 'mismatching IndexedDB readback still allowed capture');
  assert.strictEqual(ctx._mlsHasEncounterConsent(), false, 'mismatched audit record was remembered');

  /* Both durable stores failing still refuses an untracked recording. */
  ctx = harness();
  ctx.__failWrites(true); ctx.__idb.failOpen = true;
  drive(ctx, 'patient-verbal');
  assert.strictEqual(await ctx._mlsRequestEncounterConsent('recording'), false, 'failure in both consent stores still allowed capture');
  assert.strictEqual(ctx._mlsHasEncounterConsent(), false, 'unlogged consent was remembered');
  assert(ctx.__toasts.some(t => t.t === 'err' && /could not be saved/i.test(t.m)), 'failed logging was silent');

  /* The async fallback is single-flight: repeated click/Enter attempts create
     one audit write, and closing the dialog or changing identity before its
     readback can never arm the microphone consent state. */
  ctx = harness();
  ctx.__failWrites(true); ctx.__idb.hold = true;
  drive(ctx, 'patient-verbal', { deferDecision: true });
  let pending = ctx._mlsRequestEncounterConsent('recording');
  ctx.__dialogControls.els._mlsAskYes.onclick();
  ctx.__dialogControls.els._mlsAskYes.onclick();
  ctx.__idb.release();
  assert.strictEqual(await pending, true, 'held verified fallback did not settle true');
  assert.strictEqual(ctx.__idb.puts, 1, 'double consent action created duplicate audit writes');

  ctx = harness();
  ctx.__failWrites(true); ctx.__idb.hold = true;
  drive(ctx, 'patient-verbal', { deferDecision: true });
  pending = ctx._mlsRequestEncounterConsent('recording');
  ctx.__dialogControls.els._mlsAskYes.onclick();
  ctx.__dialogControls.close(false); /* Escape/backdrop/replacement */
  ctx.__idb.release();
  assert.strictEqual(await pending, false, 'closed dialog later armed consent');
  await Promise.resolve(); await Promise.resolve();
  assert.strictEqual(ctx._mlsHasEncounterConsent(), false, 'late durable write from a closed dialog was remembered');

  ctx = harness();
  ctx.__failWrites(true); ctx.__idb.hold = true;
  drive(ctx, 'patient-verbal', { deferDecision: true });
  pending = ctx._mlsRequestEncounterConsent('recording');
  ctx.__dialogControls.els._mlsAskYes.onclick();
  ctx.mlsReconfirmConsent(); /* same identity, but a new consent/session epoch */
  ctx.__idb.release();
  assert.strictEqual(await pending, false, 'invalidated held consent left its dialog promise unsettled');
  assert.strictEqual(ctx.__dialogControls.isOpen(), false, 'invalidated held consent left disabled controls open');
  assert.strictEqual(ctx._mlsHasEncounterConsent(), false, 'invalidated held consent was remembered');

  ctx = harness();
  ctx.__failWrites(true); ctx.__idb.hold = true;
  drive(ctx, 'patient-verbal', { deferDecision: true });
  pending = ctx._mlsRequestEncounterConsent('recording');
  ctx.__dialogControls.els._mlsAskYes.onclick();
  ctx.__pt = { id: 'pt2', name: 'Bob Beta' };
  ctx.__idb.release();
  assert.strictEqual(await pending, false, 'patient switch during consent persistence allowed capture');
  assert.strictEqual(ctx._mlsHasEncounterConsent(), false, 'old-patient consent armed the new patient');

  ctx = harness();
  ctx.__failWrites(true); ctx.__idb.hold = true;
  drive(ctx, 'patient-verbal', { deferDecision: true });
  pending = ctx._mlsRequestEncounterConsent('recording');
  ctx.__dialogControls.els._mlsAskYes.onclick();
  ctx.__setAccount('other-doctor@example.test');
  ctx.__idb.release();
  assert.strictEqual(await pending, false, 'account switch during consent persistence allowed capture');
  assert.strictEqual(ctx._mlsHasEncounterConsent(), false, 'old-account consent armed the new account');

  /* Fallback databases are account-scoped; purging A leaves B intact. */
  ctx = harness();
  ctx.__failWrites(true);
  drive(ctx, 'patient-verbal');
  assert.strictEqual(await ctx._mlsRequestEncounterConsent('recording'), true);
  ctx.mlsReconfirmConsent();
  ctx.__setAccount('other-doctor@example.test');
  drive(ctx, 'representative');
  assert.strictEqual(await ctx._mlsRequestEncounterConsent('recording'), true);
  const accountDbs = [...new Set(ctx.__idb.opens)];
  assert.strictEqual(accountDbs.length, 2, 'different accounts shared one consent database');
  assert.strictEqual(await ctx._mlsPurgeConsentAuditDb('doctor@example.test'), true, 'account-A consent purge failed');
  assert.strictEqual(ctx.__idb.has(accountDbs[0]), false, 'account-A consent database survived purge');
  assert.strictEqual(ctx.__idb.has(accountDbs[1]), true, 'account-A purge erased account-B consent records');

  /* no active patient: refused with guidance */
  ctx = harness();
  ctx.__pt = null;
  assert.strictEqual(await ctx._mlsRequestEncounterConsent('recording'), false, 'consent dialog opened with no patient');

  /* 2026-07-22 hardening pins, re-aimed at recfence-1.0.0 (b1130): the
     single _mlsConsentKey()!==key recheck this suite used to pin was
     replaced by a stronger pair inside decide() - an identity check plus
     _mlsConsentEncounterCompatible() - so a placeholder label resolving
     into its own appointment no longer false-refuses, while an actual
     patient switch still does. Drive the property live instead of pinning
     the new spelling: switch the patient WHILE the dialog is open, before
     it is confirmed, and prove decide() refuses AND writes nothing to the
     audit trail (the audit must never claim consent for an encounter that
     will not record). */
  ctx = harness();
  drive(ctx, 'patient-verbal', { deferDecision: true });
  pending = ctx._mlsRequestEncounterConsent('recording');
  ctx.__pt = { id: 'pt2', name: 'Bob Beta' };
  ctx.__dialogControls.els._mlsAskYes.onclick();
  assert.strictEqual(await pending, false, 'a mid-dialog patient switch (before confirm) allowed capture');
  assert.strictEqual(ctx._mlsHasEncounterConsent(), false, 'mid-dialog patient switch armed consent for the new patient');
  assert(!ctx.__store['test::consentLog'], 'mid-dialog patient switch wrote an audit record for an encounter that will not record');
  assert.strictEqual(ctx.__idb.puts, 0, 'mid-dialog patient switch fell through to a durable write instead of refusing outright');
  assert(ctx.__toasts.some(t => /selected patient changed/i.test(t.m)), 'mid-dialog patient switch lost its explanation toast');
  /* every NEW encounter re-asks — newVisit clears the consent memory */
  const nvAt = app.indexOf('function newVisit(opts){');
  assert(nvAt >= 0, 'newVisit missing');
  assert(app.slice(nvAt, nvAt + 1200).includes('_mlsConsentCurrent=null'), 'newVisit no longer clears encounter consent (same-day walk-in reuse bug)');
  assert(app.slice(nvAt, nvAt + 1200).includes('_mlsConsentEpoch++'), 'newVisit does not invalidate an in-flight consent write');
  const logoutAt = app.indexOf('async function logout(force)');
  const logoutBody = app.slice(logoutAt, app.indexOf('/* =========================================================', logoutAt));
  assert(logoutBody.includes('_mlsPurgeConsentAuditDb(_logoutEmail)'), 'logout does not purge the exact account consent database');
  const clearAt = app.indexOf('async function clearDeviceData(){');
  assert(app.slice(clearAt, clearAt + 1200).includes('await _mlsPurgeConsentAuditDb(consentAccount)'), 'Clear saved data leaves the consent database behind');
  /* the request entry is exported for the satellite dictation gates */
  assert(app.includes('window._mlsRequestEncounterConsent=_mlsRequestEncounterConsent;'), 'consent request is not exported for satellites');
  assert(!app.includes('window._mlsRequestEncounterConsent=function'), 'self-referential export wrapper is back (infinite recursion)');
  /* dictation surfaces are gated: note-editor always, dictate-anywhere for visit fields */
  const ne = fs.readFileSync(path.join(root, 'feat_mls_note_editor.js'), 'utf8');
  const da = fs.readFileSync(path.join(root, 'feat_mls_dictate_anywhere.js'), 'utf8');
  const neStart = ne.indexOf('function startDictation(key) {');
  const neBody = ne.slice(neStart, neStart + 2400);
  const neGate = neBody.indexOf('_mlsHasEncounterConsent');
  assert(neGate >= 0 && neGate < neBody.indexOf('claimNoteSpeech()'), 'note dictation reaches the mic without the consent gate');
  const daGate = da.indexOf('_mlsHasEncounterConsent');
  assert(daGate >= 0 && daGate < da.indexOf("h.claim('dictate')"), 'dictate-anywhere reaches the mic without the consent gate on visit fields');
  assert(da.includes('isVisitField(target) && typeof window._mlsHasEncounterConsent'), 'dictate-anywhere gate must scope to visit fields');

  console.log('PASS recording consent gate: both mic paths stay gated; verbal/representative consent survives local quota through safe eviction or verified per-account IndexedDB, async identity races fail closed, account purge is exact, and no audio is stored');
})().catch(e => { console.error(e); process.exit(1); });
