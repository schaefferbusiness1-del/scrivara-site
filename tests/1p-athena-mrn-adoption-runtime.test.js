'use strict';

/* 1p PREVIEW ONLY. Drives the real isolated 1p-feat_mls_writeflow.js in a VM
 * against a FAKE MLS Assist and a FAKE local patient store. No browser, no
 * athenaOne, no PHI (every name/DOB/MRN below is synthetic).
 *
 * mrnadopt-1.0.0 (owner 2026-08-27: "I hate how much is greyed out... it
 * should be seamless and always work", under the 2026-08-19 ruling that
 * name+DOB is enough to write).
 *
 * The defect: a local patient row with no MRN painted EVERY row of the Athena
 * review "BLOCKED - NOTHING SENT" with the generic three-factor sentence, and
 * nothing on the sheet could clear it. Softening the gate would have been
 * worse than the gray - the installed extension itself refuses a staged
 * section write unless the app supplies name + DOB + MRN, so a READY row with
 * no MRN could only ever be refused at check time. The cure is ADOPTION.
 *
 * What this suite proves, causally, against the shipped functions:
 *   1. ADOPT ON EXACT MATCH: an open chart whose name AND DOB both match the
 *      local row hands over its MRN, the MRN is persisted through
 *      upsertPatient (a clone - the stored object is never mutated in place),
 *      the review rebuilds itself, and the previously blocked note row is
 *      READY.  Exactly one bridge verb is used and it is the read-only
 *      identity verb: NO mlsAppAthenaActionV2 execute, ever.
 *   2. MISMATCH KEEPS THE BLOCK: a chart that matches on name only, or on DOB
 *      only, adopts nothing, writes nothing to the store, and the row stays
 *      blocked.
 *   3. EXISTING DIFFERENT MRN IS A CONFLICT: the stored MRN is never
 *      overwritten and the refusal says so.
 *   4. UNCERTAIN PROBE KEEPS THE BLOCK: a timed-out / refused / MRN-less /
 *      DOB-unreadable chart read changes nothing and names the reason.
 *   5. THE BLOCK SENTENCE IS ACTIONABLE: an MRN-only block names the one next
 *      step; a genuinely incomplete identity keeps the original refusal.
 *   6. THE ADOPTED MRN SURVIVES A RELOAD: a FRESH module instance over the
 *      same persisted store builds a READY row with no Athena read at all.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const FLOW = fs.readFileSync(path.join(ROOT, '1p-feat_mls_writeflow.js'), 'utf8');

const DAY = '2026-08-27';
const ATHENA_DAY = '8/27/2026';
const APPOINTMENT = '70000027';
const ENCOUNTER = '55527';
const ENCOUNTER_URL = 'https://athena.example/encounter/55527';
const PROVIDER = 'Synthetic Clinician One, MD';
const PT_ID = 'syn-mrn-a';
const PT_NAME = 'Synthetic Patient Mrnless';
const PT_DOB = '03/04/1971';
const CHART_MRN = '4488221';
const OTHER_MRN = '9911777';
const NOTE = 'HPI: synthetic reviewed narrative for the adoption suite.';
const BOUND_CONTEXT = { visitDate: ATHENA_DAY, provider: PROVIDER, appointmentId: APPOINTMENT, encounterId: ENCOUNTER, encounterUrl: ENCOUNTER_URL };

let checks = 0;
function ok(value, message) { checks++; assert.ok(value, message); }
function eq(actual, expected, message) { checks++; assert.strictEqual(actual, expected, message); }

/* ------------------------------------------------------------------ DOM shim
 * Same shape as the write-readiness suite: ids resolve to ONE shared stub so
 * the renderer and the pass wire the same nodes. innerHTML is stored as text. */
function makeDom() {
  const byId = new Map();
  function node(tag) {
    const el = {
      tagName: String(tag || 'div').toUpperCase(), style: {}, dataset: {}, attrs: {}, children: [],
      handlers: {}, textContent: '', value: '', disabled: false, type: '', id: '',
      isConnected: true, className: '', parentNode: null,
      classList: { add() {}, remove() {}, contains() { return false; } },
      setAttribute(k, v) { el.attrs[k] = String(v); if (k === 'id') el.id = String(v); },
      getAttribute(k) { return Object.prototype.hasOwnProperty.call(el.attrs, k) ? el.attrs[k] : null; },
      removeAttribute(k) { delete el.attrs[k]; },
      addEventListener(type, fn) { (el.handlers[type] = el.handlers[type] || []).push(fn); },
      removeEventListener(type, fn) { const l = el.handlers[type] || []; const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); },
      appendChild(child) { el.children.push(child); child.parentNode = el; return child; },
      insertBefore(child) { el.children.push(child); return child; },
      remove() {}, select() {}, focus() {},
      querySelector(sel) {
        const s = String(sel || '');
        if (s.charAt(0) === '#') return resolve(s);
        const m = /^\[([a-z0-9-]+)(?:="([^"]*)")?\]$/i.exec(s.trim());
        if (!m) return null;
        return el.children.filter(c => (m[2] === undefined ? c.getAttribute(m[1]) !== null : c.getAttribute(m[1]) === m[2]))[0] || null;
      },
      querySelectorAll() { return []; },
      closest() { return null; },
      click() { (el.handlers.click || []).forEach(fn => fn({ target: el })); }
    };
    let html = '';
    Object.defineProperty(el, 'innerHTML', {
      get() { return html; },
      set(v) { html = String(v); if (html === '') el.children.length = 0; }
    });
    return el;
  }
  function resolve(sel) {
    const key = String(sel || '').replace(/^#/, '');
    if (!byId.has(key)) { const el = node('div'); el.id = key; byId.set(key, el); }
    return byId.get(key);
  }
  const document = {
    readyState: 'complete', activeElement: null,
    body: node('body'), head: node('head'), documentElement: node('html'),
    addEventListener() {}, removeEventListener() {},
    querySelector(sel) { return resolve(sel); },
    querySelectorAll() { return []; },
    getElementById(id) { return resolve(id); },
    createElement(tag) { return node(tag); },
    execCommand() { return false; }
  };
  return { document, byId, resolve };
}

/* ---------------------------------------- fake MLS Assist + fake patient store
 * `store.rows` is the durable local patient record and is SHARED across
 * harnesses on purpose, so "survives a reload" can be proven with a fresh
 * module instance over the same rows. upsertPatient records every object it
 * is handed, which is how the "never mutate in place" claim is measured. */
function makeStore(seedRow) {
  const rows = [Object.assign({ id: PT_ID, name: PT_NAME, dob: PT_DOB, source: 'athena-schedule', created: 1 }, seedRow || {})];
  const upserts = [];
  return {
    rows, upserts,
    getPatients() { return rows; },
    upsertPatient(p) {
      upserts.push(p);
      const i = rows.findIndex(r => String(r.id) === String(p.id));
      p.updated = 2;
      if (i >= 0) rows[i] = p; else rows.unshift(p);
    }
  };
}

function makeHarness(options) {
  options = options || {};
  const store = options.store || makeStore();
  const dom = makeDom();
  const listeners = [];
  const posted = [];
  const kv = new Map();
  kv.set('acct:schedImportIndexV1::' + DAY, JSON.stringify({ v: 1, rows: {
    ['appointment-id:' + APPOINTMENT]: { state: 'done', patientId: PT_ID, backendAppointmentId: 'cal-row-27', appt_date: DAY }
  } }));
  const localStorage = {
    getItem: k => (kv.has(k) ? kv.get(k) : null),
    setItem: (k, v) => kv.set(k, String(v)),
    removeItem: k => kv.delete(k)
  };
  const window = {
    document: dom.document, localStorage,
    _calAppts: [{ id: 'cal-row-27', patient_external_id: PT_ID, name: PT_NAME, dob: PT_DOB,
      provider: PROVIDER, providerName: PROVIDER, appt_date: DAY, day_local: DAY, start_at: DAY + 'T14:00:00.000Z' }],
    uns: k => 'acct:' + k,
    activePatient: () => store.rows.filter(r => String(r.id) === PT_ID)[0] || null,
    getPatients: () => store.getPatients(),
    upsertPatient: p => {
      if (options.upsertThrows) throw new Error('synthetic store refusal');
      return store.upsertPatient(p);
    },
    location: { hostname: 'mlsscribe.com', origin: 'https://mlsscribe.com' },
    __mlsExtensionCapabilities: { athenaFinalActionsV1: true, supervisedOrderPlacementV2: true },
    addEventListener(type, fn) { if (type === 'message') listeners.push(fn); },
    removeEventListener(type, fn) { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); },
    postMessage(message) { posted.push(message); route(message); }
  };
  window.window = window;

  function deliver(type, requestId, resp) {
    Promise.resolve().then(() => listeners.slice().forEach(fn => fn({ data: { source: 'mls-ext', type, requestId, resp } })));
  }
  function route(m) {
    if (!m || m.source !== 'mls-app') return;
    if (m.type === 'mlsAppChartIdentity') {
      if (options.identity === 'silent') return;
      return deliver('mlsAppChartIdentityResult', m.requestId,
        options.identity === undefined
          ? { ok: true, identity: { name: PT_NAME, dob: PT_DOB, mrn: CHART_MRN } }
          : options.identity);
    }
    if (m.type === 'mlsAppAthenaActionV2') return deliver('mlsAppAthenaActionV2Result', m.requestId, probeOk(m));
    if (m.type === 'mlsAppSearchOpenPatient') return deliver('mlsAppSearchOpenResult', m.requestId, { ok: true, opened: true, via: 'appointment-id' });
    if (m.type === 'mlsAppGotoDate') return deliver('mlsAppGotoDateResult', m.requestId, { ok: true, supported: true, schedDate: m.date });
    if (m.type === 'mlsExtHealth') return deliver('mlsExtHealthResult', m.requestId, { ok: true, version: '3.0.82', athena: { tabs: 1, discarded: 0 } });
  }
  function probeOk(m) {
    return { ok: true, mode: 'probe', readOnly: true, action: m.action, actionToken: 'one-use-token', rowHash: m.rowHash,
      clientOrderId: m.clientOrderId || '', reason: 'context-verified', context: {
        patientName: PT_NAME, dob: PT_DOB, mrn: CHART_MRN, appointmentId: APPOINTMENT,
        encounterId: ENCOUNTER, encounterUrl: ENCOUNTER_URL, visitDate: ATHENA_DAY, provider: PROVIDER,
        control: 'Save', framePath: '0', encounterRootFingerprint: 'er', controlFingerprint: 'c',
        noteScopeFingerprint: 'n', editorFingerprint: 'e', contextHash: 'h' } };
  }

  const context = vm.createContext({
    window, document: dom.document, localStorage, location: window.location, console,
    navigator: { userAgent: 'synthetic-test-agent', clipboard: null },
    Intl, Date, Math, JSON, Promise, Object, Array, String, Number, RegExp, isFinite, parseInt, parseFloat,
    setTimeout: (fn, ms) => { if (Number(ms || 0) <= 2000) Promise.resolve().then(fn); return 1; },
    clearTimeout() {}, setInterval: () => 1, clearInterval() {},
    MutationObserver: function () { this.observe = () => {}; this.disconnect = () => {}; }
  });
  vm.runInContext(FLOW, context, { filename: '1p-feat_mls_writeflow.js' });
  return {
    window, store, document: dom.document, el: dom.resolve, posted, context,
    wf: window.__mlsWriteFlow,
    identityReads: () => posted.filter(m => m.type === 'mlsAppChartIdentity'),
    athenaRequests: () => posted.filter(m => m.type === 'mlsAppAthenaActionV2'),
    noteRow: () => {
      const st = window.__mlsWriteFlow.diagnostics.state();
      const rows = (st && st.manifest && st.manifest.rows) || [];
      return rows.filter(r => r.id.indexOf('write-note-hpi') === 0 || r.id === 'write-note')[0] || null;
    },
    statusText: () => dom.resolve('mlsAthenaUnifiedProbe').textContent,
    /* The overlay assigns .id directly (never setAttribute), so it is not in
       the id registry - walk the real tree instead of trusting a lookup. */
    sheetHtml: () => {
      let out = '';
      (function walk(el) {
        if (!el) return;
        out += String(el.innerHTML || '');
        (el.children || []).forEach(walk);
      })(dom.document.body);
      return out;
    }
  };
}
async function settle(n) { for (let i = 0; i < (n || 40); i++) await new Promise(r => setImmediate(r)); }
function noExecuteEverLeft(h) {
  const bad = h.athenaRequests().filter(m => m.mode === 'execute');
  eq(bad.length, 0, 'an execute request left the page during MRN adoption: ' + JSON.stringify(bad.map(m => m.action)));
}
function openReview(h) {
  return h.wf.openUnifiedConfirmation({ sections: [{ key: 'hpi', text: NOTE }], expectedContext: BOUND_CONTEXT });
}

(async function () {
  /* ------------------------------------- 1. adopt on exact match -> READY --- */
  {
    const h = makeHarness({});
    const before = openReview(h);
    const blockedRow = before.rows.filter(r => r.id.indexOf('write-note-hpi') === 0)[0];
    ok(blockedRow, 'the review did not build a named HPI row');
    eq(blockedRow.capability, 'blocked', 'a row with no MRN was painted sendable before adoption');
    ok(/Athena MRN yet/.test(blockedRow.reason), 'the MRN-only block did not name the missing MRN: ' + blockedRow.reason);

    await settle();

    eq(h.identityReads().length, 1, 'the adoption pass did not run exactly one read-only identity read');
    const stored = h.store.rows.filter(r => String(r.id) === PT_ID)[0];
    eq(String(stored.mrn), CHART_MRN, 'the adopted MRN was not persisted to the local patient row');
    eq(String(stored.athenaId), CHART_MRN, 'the adopted MRN was not persisted as the athena id');
    eq(String(stored.mrnSource), 'athena-chart-identity', 'the persisted MRN carries no provenance');
    eq(String(stored.name), PT_NAME, 'the enrichment lost a field of the stored patient row');
    eq(h.store.upserts.length, 1, 'the adoption wrote to the patient store more than once');

    const after = h.noteRow();
    ok(after, 'the review did not rebuild a named HPI row after adoption');
    eq(after.capability, 'ready', 'the rebuilt row is still blocked after a proven MRN adoption: ' + after.reason);
    eq(after.reason, '', 'a READY row carried a refusal reason');
    /* The transient status line is repainted by the read-only check that
       follows the rebuild; the adoption fact must survive that repaint. */
    const sheet = h.sheetHtml();
    ok(/data-mls-mrn-adopted="1"/.test(sheet), 'the rebuilt sheet carries no durable note that the MRN was adopted');
    ok(/saved it to the MLS patient record/.test(sheet), 'the durable note does not say the MRN was saved: ' + sheet.slice(0, 200));
    ok(sheet.indexOf(PT_NAME) >= 0, 'the durable note does not name whose MRN was adopted');
    const last = h.wf.mrnAdopt.last();
    ok(last && last.adopted === true, 'the adoption receipt did not record an adoption');
    /* The copyable error report must be able to name this outcome; an
       unlisted code would flatten every adoption result to "unlisted". */
    const receipt = h.wf.diagnostics.receipts().filter(r => r.stage === 'mrn-adopt')[0];
    ok(receipt, 'the adoption recorded no PHI-free diagnostic receipt');
    eq(receipt.reason, 'mrn-adopted', 'the adoption receipt reason was flattened: ' + receipt.reason);
    const serialized = JSON.stringify(h.wf.diagnostics.receipts());
    [PT_NAME, PT_DOB, CHART_MRN].forEach((secret) => {
      eq(serialized.indexOf(secret), -1, 'the PHI-free adoption receipts leaked ' + secret);
    });
    noExecuteEverLeft(h);
  }

  /* ------------------------- 1b. the stored row is replaced, not mutated ----- */
  {
    const h = makeHarness({});
    const original = h.store.rows[0];
    openReview(h);
    await settle();
    ok(h.store.upserts.length === 1, 'expected exactly one upsert');
    ok(h.store.upserts[0] !== original, 'the adoption mutated the stored patient object in place instead of upserting a clone');
    eq(String(original.mrn || ''), '', 'the pre-adoption object was mutated in place');
    noExecuteEverLeft(h);
  }

  /* --------------------------------- 2. mismatch keeps the block ------------ */
  {
    /* name matches, DOB does not */
    const h = makeHarness({ identity: { ok: true, identity: { name: PT_NAME, dob: '11/12/1955', mrn: CHART_MRN } } });
    openReview(h);
    await settle();
    eq(h.store.upserts.length, 0, 'a DOB mismatch still wrote an MRN to the patient store');
    eq(String(h.store.rows[0].mrn || ''), '', 'a DOB mismatch adopted an MRN');
    eq(h.noteRow().capability, 'blocked', 'a DOB mismatch produced a sendable row');
    ok(/not this patient/.test(h.statusText()), 'the DOB mismatch refusal did not say the chart is a different patient: ' + h.statusText());
    noExecuteEverLeft(h);
  }
  {
    /* DOB matches, name does not */
    const h = makeHarness({ identity: { ok: true, identity: { name: 'Different Human Entirely', dob: PT_DOB, mrn: CHART_MRN } } });
    openReview(h);
    await settle();
    eq(h.store.upserts.length, 0, 'a name mismatch still wrote an MRN to the patient store');
    eq(h.noteRow().capability, 'blocked', 'a name mismatch produced a sendable row');
    ok(/not this patient/.test(h.statusText()), 'the name mismatch refusal was not named: ' + h.statusText());
    noExecuteEverLeft(h);
  }

  /* ------------------- 3. an existing DIFFERENT MRN is a conflict ----------- */
  {
    /* The pass persists only what it probed; the conflict guard is the one
       that must refuse when the stored row gained a different MRN. */
    const store = makeStore({ mrn: OTHER_MRN, athenaId: OTHER_MRN });
    const h = makeHarness({ store });
    const verdict = h.wf.mrnAdopt.persist(PT_ID, CHART_MRN);
    eq(verdict.ok, false, 'a different stored MRN was silently overwritten');
    eq(verdict.code, 'mrn-conflict', 'the conflict was not classified as a conflict');
    eq(store.upserts.length, 0, 'the conflict path still wrote to the patient store');
    eq(String(store.rows[0].mrn), OTHER_MRN, 'the stored MRN was overwritten by a conflicting chart MRN');
    ok(/will not overwrite a stored MRN/.test(h.wf.mrnAdopt.refusal('mrn-conflict')),
      'the conflict refusal does not say the stored MRN is never overwritten');
    /* The same MRN already on file is an enrichment no-op, not a conflict. */
    const same = h.wf.mrnAdopt.persist(PT_ID, OTHER_MRN);
    eq(same.ok, true, 'an identical stored MRN was treated as a conflict');
    eq(same.code, 'already-on-file', 'an identical stored MRN was re-written instead of accepted');
    eq(store.upserts.length, 0, 'an identical stored MRN still wrote to the store');
    noExecuteEverLeft(h);
  }

  /* --------------------------- 4. an uncertain probe keeps the block -------- */
  {
    const cases = [
      { label: 'timed-out identity read', identity: { ok: false, timedOut: true, error: 'identity read timed out' }, says: /did not settle/ },
      { label: 'no athena tab', identity: { ok: false, error: 'no athena tab' }, says: /No athenaOne chart is open/ },
      { label: 'chart with no identity', identity: { ok: true, identity: null }, says: /No athenaOne chart is open/ },
      { label: 'chart with no readable DOB', identity: { ok: true, identity: { name: PT_NAME, dob: '', mrn: CHART_MRN } }, says: /could not read a date of birth/ },
      { label: 'chart with no MRN', identity: { ok: true, identity: { name: PT_NAME, dob: PT_DOB, mrn: '' } }, says: /shows no patient ID/ }
    ];
    for (const c of cases) {
      const h = makeHarness({ identity: c.identity });
      openReview(h);
      await settle();
      eq(h.store.upserts.length, 0, c.label + ': an uncertain read still wrote to the patient store');
      eq(String(h.store.rows[0].mrn || ''), '', c.label + ': an uncertain read adopted an MRN');
      eq(h.noteRow().capability, 'blocked', c.label + ': an uncertain read produced a sendable row');
      ok(c.says.test(h.statusText()), c.label + ': the refusal did not name its reason: ' + h.statusText());
      const last = h.wf.mrnAdopt.last();
      ok(last && last.adopted === false, c.label + ': the receipt claimed an adoption');
      const receipt = h.wf.diagnostics.receipts().filter(r => r.stage === 'mrn-adopt')[0];
      ok(receipt && receipt.ok === false, c.label + ': no PHI-free refusal receipt was recorded');
      eq(receipt.reason, last.code, c.label + ': the refusal receipt reason was flattened to ' + receipt.reason);
      noExecuteEverLeft(h);
    }
  }
  {
    /* A store that refuses the write is never reported as adopted. */
    const h = makeHarness({ upsertThrows: true });
    openReview(h);
    await settle();
    eq(String(h.store.rows[0].mrn || ''), '', 'a refused store write still recorded an MRN');
    eq(h.noteRow().capability, 'blocked', 'a refused store write produced a sendable row');
    ok(/refused the MRN save/.test(h.statusText()), 'the store refusal was not named: ' + h.statusText());
    noExecuteEverLeft(h);
  }

  /* -------------------- 5. the block sentence names one next step ----------- */
  {
    const h = makeHarness({ identity: { ok: false, error: 'no athena tab' } });
    const mrnOnly = h.wf.buildUnifiedManifest({ patient: { id: PT_ID, patientId: PT_ID, name: PT_NAME, dob: PT_DOB },
      sections: [{ key: 'hpi', text: NOTE }], expectedContext: BOUND_CONTEXT });
    const mrnOnlyRow = mrnOnly.rows.filter(r => r.id.indexOf('write-note-hpi') === 0)[0];
    ok(/Check Athena again/.test(mrnOnlyRow.reason), 'the MRN-only block does not name the control that fixes it');
    ok(/chart in athenaOne/.test(mrnOnlyRow.reason), 'the MRN-only block does not say to open the chart');
    ok(mrnOnlyRow.reason.indexOf(PT_NAME) >= 0, 'the MRN-only block does not name the patient whose chart to open');
    ok(!/An immutable local patient ID/.test(mrnOnlyRow.reason), 'an MRN-only block reused the generic three-factor refusal');

    /* A genuinely incomplete identity keeps the original fail-closed sentence. */
    const noDob = h.wf.buildUnifiedManifest({ patient: { id: PT_ID, patientId: PT_ID, name: PT_NAME },
      sections: [{ key: 'hpi', text: NOTE }], expectedContext: BOUND_CONTEXT });
    const noDobRow = noDob.rows.filter(r => r.id.indexOf('write-note-hpi') === 0)[0];
    eq(noDobRow.capability, 'blocked', 'a patient with no DOB produced a sendable row');
    eq(noDobRow.reason, 'An immutable local patient ID plus the exact Athena name, DOB, and MRN are required. Nothing can be written.',
      'a multi-field identity gap lost the original fail-closed sentence');

    eq(h.wf.mrnAdopt.curable({ patientId: PT_ID, name: PT_NAME, dob: PT_DOB, mrn: '' }), true, 'the MRN-only predicate rejects its own case');
    eq(h.wf.mrnAdopt.curable({ patientId: PT_ID, name: PT_NAME, dob: '', mrn: '' }), false, 'the predicate accepted a missing DOB');
    eq(h.wf.mrnAdopt.curable({ patientId: '', name: PT_NAME, dob: PT_DOB, mrn: '' }), false, 'the predicate accepted a missing local id');
    eq(h.wf.mrnAdopt.curable({ patientId: PT_ID, name: PT_NAME, dob: PT_DOB, mrn: CHART_MRN }), false, 'the predicate fired on a row that already has an MRN');
  }

  /* ------------------ 6. the adopted MRN survives a module reload ----------- */
  {
    const store = makeStore();
    const first = makeHarness({ store });
    openReview(first);
    await settle();
    eq(String(store.rows[0].mrn), CHART_MRN, 'the adoption did not persist before the reload');

    /* A FRESH module instance over the SAME persisted store - the reload. */
    const reloaded = makeHarness({ store, identity: 'silent' });
    const manifest = reloaded.wf.buildUnifiedManifest({ sections: [{ key: 'hpi', text: NOTE }], expectedContext: BOUND_CONTEXT });
    eq(manifest.patient.mrn, CHART_MRN, 'the reloaded review did not read the persisted MRN off the patient record');
    const row = manifest.rows.filter(r => r.id.indexOf('write-note-hpi') === 0)[0];
    eq(row.capability, 'ready', 'the persisted MRN did not survive the reload: ' + row.reason);
    await settle();
    eq(reloaded.identityReads().length, 0, 'a patient that already has an MRN still triggered an Athena identity read');
    eq(store.upserts.length, 1, 'the reload wrote to the patient store again');
    noExecuteEverLeft(reloaded);
  }

  /* ------------------------- 7. classification is exact, not fuzzy ---------- */
  {
    const h = makeHarness({ identity: 'silent' });
    const frozen = { patientId: PT_ID, name: PT_NAME, dob: PT_DOB };
    eq(h.wf.mrnAdopt.classify({ ok: true, identity: { name: PT_NAME, dob: PT_DOB, mrn: CHART_MRN } }, frozen).code, 'exact-chart-match', 'an exact chart was not accepted');
    eq(h.wf.mrnAdopt.classify({ ok: true, identity: { name: PT_NAME, dob: PT_DOB, mrn: 'not-a-number' } }, frozen).code, 'chart-mrn-absent', 'a non-numeric MRN was adopted');
    eq(h.wf.mrnAdopt.classify({ __timeout: true }, frozen).code, 'chart-read-uncertain', 'a bridge timeout was not treated as uncertain');
    eq(h.wf.mrnAdopt.classify({ ok: true, identity: [] }, frozen).code, 'no-chart-open', 'a malformed identity shape was accepted');
    eq(h.wf.mrnAdopt.classify({ ok: true, identity: { name: PT_NAME, dob: PT_DOB, mrn: CHART_MRN } }, { patientId: PT_ID, name: PT_NAME, dob: '' }).code,
      'chart-identity-mismatch', 'a local row with no DOB adopted an MRN off an open chart');
  }

  /* ------- 8. a stale patient snapshot rebuilds from the record, no read ---- */
  {
    /* The review was opened with a patient object captured BEFORE the store
       learned the MRN. There is nothing to ask athenaOne: rebuild from the
       record instead of sending the doctor to open a chart. */
    const store = makeStore({ mrn: CHART_MRN, athenaId: CHART_MRN });
    const h = makeHarness({ store, identity: 'silent' });
    const stale = { id: PT_ID, patientId: PT_ID, name: PT_NAME, dob: PT_DOB };
    const before = h.wf.openUnifiedConfirmation({ patient: stale, sections: [{ key: 'hpi', text: NOTE }], expectedContext: BOUND_CONTEXT });
    eq(before.rows.filter(r => r.id.indexOf('write-note-hpi') === 0)[0].capability, 'blocked', 'the stale snapshot did not reproduce the block');
    await settle();
    eq(h.identityReads().length, 0, 'a stale snapshot over a store that already had the MRN still read athenaOne');
    eq(store.upserts.length, 0, 'a stale snapshot rebuild wrote to the patient store');
    eq(h.noteRow().capability, 'ready', 'the stale snapshot was not rebuilt from the patient record: ' + h.noteRow().reason);
    ok(/already had/.test(h.sheetHtml()), 'the rebuilt sheet does not say the MRN was already on file');
    noExecuteEverLeft(h);
  }

  /* ---------------------------- 9. reversibility ---------------------------- */
  {
    const h = makeHarness({});
    eq(h.wf.mrnAdopt.revert(), true, 'the adoption lane is not revertible');
    openReview(h);
    await settle();
    eq(h.identityReads().length, 0, 'a reverted adoption lane still read the chart');
    eq(h.store.upserts.length, 0, 'a reverted adoption lane still wrote to the patient store');
    eq(h.noteRow().capability, 'blocked', 'a reverted lane painted a sendable row');
    noExecuteEverLeft(h);
  }

  console.log('PASS 1p athena MRN adoption (mrnadopt-1.0.0): ' + checks +
    ' checks - an exact name+DOB chart match adopts its MRN through one read-only identity verb, persists a CLONE, rebuilds the review to READY and survives a reload; every mismatch, conflict, uncertain read and store refusal keeps the block and names why; no execute ever leaves the page');
})().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
