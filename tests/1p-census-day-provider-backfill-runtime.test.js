'use strict';

/* pbf-1.0.0 - CENSUS DAY-HEADER PROVIDER ATTRIBUTION + BACKFILL
 *
 * Measured on the owner's real store 2026-08-27: of the 438 appointments since
 * 2026-08-01, 438 carry appt_date and 438 carry athena_appointment_id, but only
 * 232 carry a provider. 206 rows are therefore blocked from the Athena write
 * for that ONE missing field and nothing else - the write sheet's bind gate is
 * visitDate && provider && (appointmentId || bound encounter), so a row that
 * knows its exact day AND its exact Athena appointment id still cannot bind.
 *
 * ROOT CAUSE this suite pins: the appointment-census lane imports rows in "all"
 * scope with a deliberately blank provider, and BOTH provider fills in the
 * importer (the create body and the enrich/repair path) were gated on
 * requestedProvider.mode === "selected". The day's own painted provider header
 * was in the very same response and was never persisted per row.
 *
 * THE BAR, and this suite exists to hold the line at it:
 *   - a census day that painted EXACTLY ONE provider header, with no second
 *     clinician named anywhere in that read, attributes every row to that one
 *     clinician - on create AND as a repair of rows already stored blank;
 *   - a MIXED-header census day attributes NOTHING and stays honestly
 *     unbindable. A wrong provider on a clinical write is worse than a blocked
 *     row.
 *
 * This executes the real p1 importer in a vm sandbox. No PHI. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const importerPath = path.join(root, '1p-feat_mls_schedimport_exact.js');
assert(fs.existsSync(importerPath), 'the p1-only exact-importer fork is missing');
const importer = fs.readFileSync(importerPath, 'utf8');

const DAY = '2026-08-24';
const ROWS = 12;
const ONE = { stableKey: 'header:1', id: '101', raw: 'Header_One_MD', name: 'Header One, MD', rosterVerified: false };
const TWO = { stableKey: 'header:2', id: '202', raw: 'Header_Two_MD', name: 'Header Two, MD', rosterVerified: false };

let checks = 0;
function ok(condition, message) {
  checks++;
  assert(condition, message);
}
function eq(actual, expected, message) {
  checks++;
  assert.strictEqual(actual, expected, `${message} (got ${JSON.stringify(actual)}, wanted ${JSON.stringify(expected)})`);
}
function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }

function makeRows(day) {
  return Array.from({ length: ROWS }, (_, i) => {
    const n = i + 1;
    const hour = 8 + Math.floor(i / 6);
    const minute = (i % 6) * 10;
    const stamp = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    return {
      name: `Census Patient ${String(n).padStart(2, '0')}`,
      dob: `01/${String(n).padStart(2, '0')}/1970`,
      mrn: `PBF-MRN-${String(n).padStart(2, '0')}`,
      athenaPatientId: `athena-patient-${n}`,
      patient_external_id: `patient-${n}`,
      athenaAppointmentId: `athena-appointment-${day}-${n}`,
      appointmentId: `athena-appointment-${day}-${n}`,
      date: day,
      start_local: stamp,
      time: stamp,
      reason: 'Provider backfill test',
      /* Every provider-bearing alias present and blank: this is the columnless
         one-column Day grid the census lane exists for. */
      provider: '', providerName: '', provider_name: '',
      providerId: '', provider_id: '',
      athenaProviderId: '', athena_provider_id: '',
      renderingProviderId: '', rendering_provider_id: ''
    };
  });
}

/* headersFor(pullNumber) -> array of roster entries painted on that read. */
function makeHarness(headersFor, options) {
  options = options || {};
  const listeners = new Set();
  const store = new Map();
  const elements = new Map();
  const statuses = [];
  const posted = [];
  const savedBodies = [];
  const updateBodies = [];
  const backendRows = (options.seedBackendRows || []).map(clone);
  const rows = makeRows(DAY);
  const patients = rows.map((row, i) => ({
    id: `patient-${i + 1}`, name: row.name, dob: row.dob, mrn: row.mrn, athenaId: row.mrn, visits: []
  }));
  let currentDay = DAY;
  let createSeq = 0;
  let armedOperation = null;
  let latestRosterReceipt = null;
  let scheduleResponseCount = 0;

  function responseFor(day, requestId) {
    scheduleResponseCount++;
    const headers = headersFor(scheduleResponseCount).map(clone);
    const coverage = {
      verdict: 'row-unattributed', rows: ROWS, headerCount: headers.length,
      unattributedRows: ROWS, foreignRows: 0
    };
    let response = {
      id: requestId, ok: true, scheduleVerified: true, schedDate: day,
      text: `Verified Day schedule ${day}`,
      appts: clone(rows),
      providers: headers.map(p => p.name),
      providerRoster: headers,
      providerDiag: { providerNames: headers.map(p => p.name), attributionCoverage: clone(coverage) },
      receipt: {
        complete: true, authoritativeEmpty: false, requestId,
        expectedCount: ROWS, parsedCount: ROWS, candidateCount: ROWS
      },
      providerRosterReceipt: {
        complete: false, partial: true, reason: 'legacy-unverified',
        observedCount: headers.length, targetDate: day, requestId,
        requestedProviderId: '', requestedProviderStableKey: '',
        attributionCoverage: clone(coverage)
      }
    };
    if (typeof options.mutateResponse === 'function') {
      response = options.mutateResponse(response, scheduleResponseCount) || response;
    }
    latestRosterReceipt = clone(response.providerRosterReceipt);
    return response;
  }

  function emit(type, resp, id) {
    const ev = { data: { source: 'mls-ext', type, id: id || '', resp } };
    Array.from(listeners).forEach(fn => fn(ev));
  }

  function normTime(value) {
    const m = String(value || '').trim().match(/^(\d{1,2}):(\d{2})\s*([AP]M)?$/i);
    if (!m) return '';
    let hour = Number(m[1]);
    if (m[3] && /PM/i.test(m[3]) && hour < 12) hour += 12;
    if (m[3] && /AM/i.test(m[3]) && hour === 12) hour = 0;
    return `${String(hour).padStart(2, '0')}:${m[2]}`;
  }

  function fakeElement(tag, id) {
    const node = {
      tagName: String(tag || 'div').toUpperCase(), id: id || '', style: {}, children: [],
      parentNode: null, onclick: null, textContent: '',
      setAttribute(name, value) {
        this[name] = String(value);
        if (name === 'id') { this.id = String(value); elements.set(this.id, this); }
      },
      appendChild(child) {
        if (child) { child.parentNode = this; this.children.push(child); if (child.id) elements.set(child.id, child); }
        return child;
      },
      remove() {
        if (this.id) elements.delete(this.id);
        if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this);
      }
    };
    Object.defineProperty(node, 'innerHTML', {
      get() { return this._innerHTML || ''; },
      set(value) {
        this._innerHTML = String(value || '');
        const ids = this._innerHTML.matchAll(/\bid="([^"]+)"/g);
        for (const match of ids) this.appendChild(fakeElement('button', match[1]));
      }
    });
    if (node.id) elements.set(node.id, node);
    return node;
  }
  const body = fakeElement('body');
  const head = fakeElement('head');

  const rt = {
    console, Promise, Date, Math, JSON, Intl, Object, Array, String, Number,
    Boolean, RegExp, Error, TypeError, encodeURIComponent, decodeURIComponent,
    queueMicrotask, setTimeout, clearTimeout, setInterval: () => 1, clearInterval: () => {},
    CustomEvent: function CustomEvent(type, init) { this.type = type; this.detail = init && init.detail; },
    location: { pathname: '/1pScribeFlow.html' },
    localStorage: {
      getItem: key => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => { store.set(key, String(value)); },
      removeItem: key => store.delete(key)
    },
    document: {
      readyState: 'complete',
      querySelectorAll: () => [], querySelector: () => null,
      getElementById: id => elements.get(String(id)) || null,
      createElement: tag => fakeElement(tag),
      addEventListener: () => {}, removeEventListener: () => {},
      body, head, documentElement: head
    },
    _calMode: 'day', _calRefDate: DAY, _calSelDay: '', _calProviders: [clone(ONE), clone(TWO)], _calMe: null,
    __mlsProviderRoster: {
      list: () => [clone(ONE), clone(TWO)],
      resolve: () => null,
      beginOperation: op => { armedOperation = clone(op); return clone(armedOperation); },
      ingestResp: response => { latestRosterReceipt = clone(response && response.providerRosterReceipt); },
      getReceipt: () => {
        const receipt = latestRosterReceipt || {
          complete: false, partial: true, reason: 'legacy-unverified', providerMode: 'all', targetDate: currentDay
        };
        return Object.assign(clone(receipt), armedOperation || {});
      },
      getScope: () => ({
        scopeComplete: false, scope: 'painted-day-grid', knownCount: 1, gridSweptCount: 1,
        rosterVerifiedCount: 0, athenaListEnumerated: false, sources: { dayGrid: true },
        statement: 'Only painted headers were observed.'
      })
    },
    backendMode: () => true,
    bkToken: () => 'pbf-test-token',
    bkBase: () => 'https://local.invalid',
    uns: key => `pbf-test::${key}`,
    _normDate: value => String(value || '').slice(0, 10),
    _normTime: normTime,
    _apptKey: (name, day, time) => `${String(name || '').trim().toLowerCase()}|${day}|${time}`,
    _acctWallToUtcIso: (day, time) => `${day}T${time}:00.000Z`,
    getPatients: () => patients,
    upsertPatient: patient => {
      const at = patients.findIndex(p => String(p.id) === String(patient.id));
      if (at >= 0) patients[at] = patient; else patients.push(patient);
    },
    loadCalendar: () => { rt._calAppts = backendRows.map(clone); return Promise.resolve(); },
    renderTodayPicker: () => {}, renderHistory: () => {}, renderProfile: () => {}, loadPatients: () => {},
    dispatchEvent: () => {},
    __mlsBgSleep: () => Promise.resolve(),
    fetch: async (url, init) => {
      if (/\/api\/me(?:$|\?)/.test(String(url))) return { ok: true, status: 200, json: async () => ({ id: 'account-1' }) };
      if (/version\.json/.test(String(url))) return { ok: true, status: 200, json: async () => ({ version: '3.0.84' }) };
      if (!init || !init.method) {
        return { ok: true, status: 200, json: async () => ({ appointments: backendRows.map(clone) }) };
      }
      const payload = JSON.parse(init.body || '{}');
      const update = String(url).match(/\/api\/appointments\/([^/]+)\/update$/);
      if (update) {
        const id = decodeURIComponent(update[1]);
        const row = backendRows.find(item => String(item.id) === id);
        updateBodies.push({ id, body: clone(payload) });
        if (row) Object.assign(row, clone(payload));
        return { ok: true, status: 200, json: async () => ({ ok: true }) };
      }
      const id = `pbf-backend-${++createSeq}`;
      savedBodies.push(clone(payload));
      backendRows.push(Object.assign({ id }, clone(payload)));
      return { ok: true, status: 200, json: async () => ({ ok: true, id }) };
    }
  };
  rt.window = rt;
  rt.addEventListener = (_type, fn) => listeners.add(fn);
  rt.removeEventListener = (_type, fn) => listeners.delete(fn);
  rt.postMessage = msg => {
    posted.push(clone(msg));
    if (msg.type === 'mlsPing') queueMicrotask(() => emit('mlsPong', { ok: true, version: '3.0.84' }, ''));
    if (msg.type === 'mlsAppGotoDate') queueMicrotask(() => {
      currentDay = msg.date;
      emit('mlsAppGotoDateResult', { id: msg.id, ok: true, schedDate: msg.date }, msg.id);
    });
    if (msg.type === 'mlsAppPullSchedule') queueMicrotask(() => {
      emit('mlsAppScheduleResult', responseFor(currentDay, msg.id), msg.id);
    });
  };

  vm.runInNewContext(importer, rt, { filename: '1p-feat_mls_schedimport_exact.js', timeout: 5000 });
  return {
    rt, api: rt.__mlsSI, savedBodies, updateBodies, backendRows, store,
    onStatus: message => statuses.push(String(message || '')),
    pull: () => rt.__mlsSI.dayPull({
      date: DAY, provider: 'all', includeHistory: false, pullVisitBodies: false,
      onStatus: message => statuses.push(String(message || ''))
    })
  };
}

function providerValues(body) {
  return [
    body.provider, body.providerName, body.provider_name,
    body.providerId, body.provider_id,
    body.athenaProviderId, body.athena_provider_id,
    body.renderingProviderId, body.rendering_provider_id
  ].filter(value => value != null).map(value => String(value).trim());
}

async function main() {
  /* ---- 1. the pure day-header predicate ------------------------------- */
  const probe = makeHarness(() => [clone(ONE)]);
  const dayProviderName = probe.api._censusDayProviderName;
  ok(typeof dayProviderName === 'function', 'the census day-header predicate is not exported');
  const oneHeaderReceipt = { kind: 'athena-appointment-census', providerHeaderCount: 1 };
  eq(dayProviderName({ providers: ['Header One, MD'], providerRoster: [clone(ONE)] }, oneHeaderReceipt),
    'Header One, MD', 'one painted header naming one clinician was not accepted');
  eq(dayProviderName({
    providers: ['Header One, MD'], providerRoster: [clone(ONE)],
    providerDiag: { providerNames: ['Header Two, MD'] }
  }, oneHeaderReceipt), '',
  'a second clinician named anywhere in the read did not refuse the day-header attribution');
  eq(dayProviderName({ providers: [ONE.name, TWO.name], providerRoster: [clone(ONE), clone(TWO)] },
    { kind: 'athena-appointment-census', providerHeaderCount: 2 }), '',
  'a two-header census day was attributed to one clinician');
  eq(dayProviderName({ providers: ['Header One, MD'] }, { kind: 'something-else', providerHeaderCount: 1 }), '',
    'a non-census receipt was accepted as census day-header evidence');
  eq(dayProviderName({ providers: ['MD'] }, oneHeaderReceipt), '',
    'a credential-only label was accepted as a clinician identity');

  /* ---- 2. one painted header: every created row carries it ------------- */
  const single = makeHarness(() => [clone(ONE)]);
  const singleResult = await single.pull();
  eq(singleResult.ok, true, `a one-header census day did not complete: ${JSON.stringify(singleResult.reason)}`);
  eq(singleResult.complete, true, 'a one-header census day was reported partial');
  eq(singleResult.created, ROWS, 'a one-header census day did not import every row');
  eq(single.savedBodies.length, ROWS, 'not every one-header census row reached the backend');
  ok(single.savedBodies.every(saved => String(saved.provider || '') === ONE.name),
    'a one-header census day stored rows without its own provider header');
  ok(single.savedBodies.every(saved => String(saved.appt_date || '') === DAY &&
    String(saved.athena_appointment_id || '').length > 0),
  'the day-header fill cost a row its date or its exact Athena appointment id');
  const singleReceipt = singleResult.providerReceipt || {};
  eq(singleReceipt.censusDayProviderKnown, true, 'the receipt did not disclose the known day provider');
  eq(Number(singleReceipt.censusDayProviderFilledRows), ROWS,
    'the receipt did not count the rows MLS attributed from the day header');
  eq(Number(singleReceipt.providerTaggedRows), 0,
    'MLS re-counted its own day-header inference as athena row attribution');
  eq(singleReceipt.providerAttributionComplete, false,
    'a day-header inference was promoted to proven per-row provider attribution');
  eq(singleReceipt.appointmentCensusComplete, true, 'the day-header fill lost the appointment-census receipt');
  ok(singleResult.appointmentCensusReceipt && singleResult.appointmentCensusReceipt.complete === true &&
     singleResult.appointmentCensusReceipt.providerFieldsBlank === true,
  'the frozen census decision receipt no longer states what athena itself supplied');

  /* ---- 3. two painted headers: nothing is guessed ---------------------- */
  const mixed = makeHarness(() => [clone(ONE), clone(TWO)]);
  const mixedResult = await mixed.pull();
  eq(mixedResult.ok, true, `a two-header census day did not complete: ${JSON.stringify(mixedResult.reason)}`);
  eq(mixedResult.created, ROWS, 'a two-header census day did not import every row');
  mixed.savedBodies.forEach((saved, i) => {
    ok(providerValues(saved).every(value => value === ''),
      `mixed census day guessed a provider on row ${i + 1}: ${JSON.stringify(providerValues(saved))}`);
  });
  eq((mixedResult.providerReceipt || {}).censusDayProviderKnown, false,
    'a mixed census day claimed a known day provider');
  eq(Number((mixedResult.providerReceipt || {}).censusDayProviderFilledRows), 0,
    'a mixed census day attributed rows anyway');

  /* ---- 4. one header, a second clinician named in the read: refuse ----- */
  const contaminated = makeHarness(() => [clone(ONE)], {
    mutateResponse: response => {
      response.providerDiag.providerNames = [ONE.name, TWO.name];
      return response;
    }
  });
  const contaminatedResult = await contaminated.pull();
  eq(contaminatedResult.ok, true, 'the contaminated one-header day did not complete');
  contaminated.savedBodies.forEach((saved, i) => {
    ok(providerValues(saved).every(value => value === ''),
      `a read naming two clinicians still attributed row ${i + 1}`);
  });

  /* ---- 5. THE BACKFILL: rows already stored blank get repaired --------- */
  /* Pull 1 paints two headers, so all 12 rows land provider-less - exactly the
     206 rows measured on the owner's store. Pull 2 of the SAME day paints one
     header, so every stored blank row is now honestly knowable and must be
     repaired through the existing enrichment POST. */
  const phase = { headers: [clone(ONE), clone(TWO)] };
  const backfill = makeHarness(() => phase.headers.map(clone));
  const firstPull = await backfill.pull();
  eq(firstPull.created, ROWS, 'the blank-provider seeding pull did not create every row');
  ok(backfill.backendRows.every(row => String(row.provider || '') === ''),
    'the seeding pull did not leave the stored rows provider-less');
  const createsAfterSeed = backfill.savedBodies.length;

  phase.headers = [clone(ONE)];
  const repairPull = await backfill.pull();
  eq(repairPull.ok, true, `the repair re-pull did not complete: ${JSON.stringify(repairPull.reason)}`);
  eq(repairPull.created, 0, 'the repair re-pull created duplicate appointments');
  eq(backfill.savedBodies.length, createsAfterSeed, 'the repair re-pull issued new creates');
  eq(repairPull.repaired, ROWS, 'the repair re-pull did not repair every provider-less row');
  eq(backfill.updateBodies.length, ROWS, 'the repair did not go through the existing enrichment POST path');
  ok(backfill.updateBodies.every(entry => String(entry.body.provider || '') === ONE.name),
    'an enrichment POST carried something other than the day header provider');
  ok(backfill.backendRows.every(row => String(row.provider || '') === ONE.name),
    'stored rows were not actually repaired');
  eq(Number(repairPull.calendarReceipt && repairPull.calendarReceipt.providerBackfilled), ROWS,
    'the providerBackfilled receipt did not count the repairs honestly');
  eq(backfill.backendRows.length, ROWS, 'the repair changed the appointment count');

  /* ---- 6. fill-only: a stored provider is never overwritten ------------ */
  const updatesBeforeReplay = backfill.updateBodies.length;
  const replay = await backfill.pull();
  eq(replay.ok, true, 'the idempotent replay after a repair did not complete');
  eq(replay.repaired, 0, 'a repaired day was repaired again');
  eq(backfill.updateBodies.length, updatesBeforeReplay, 'an idempotent replay issued enrichment POSTs');
  eq(Number(replay.calendarReceipt && replay.calendarReceipt.providerBackfilled), 0,
    'an idempotent replay inflated the providerBackfilled receipt');

  const overwrite = makeHarness(() => [clone(ONE)]);
  await overwrite.pull();
  overwrite.backendRows.forEach(row => { row.provider = 'Existing Clinician, MD'; });
  const overwriteUpdates = overwrite.updateBodies.length;
  const overwriteReplay = await overwrite.pull();
  eq(overwriteReplay.ok, true, 'the non-overwrite replay did not complete');
  ok(overwrite.backendRows.every(row => String(row.provider || '') === 'Existing Clinician, MD'),
    'the day-header fill overwrote a provider entered elsewhere');
  ok(overwrite.updateBodies.slice(overwriteUpdates).every(entry =>
    !Object.prototype.hasOwnProperty.call(entry.body, 'provider')),
  'an enrichment POST tried to rewrite a non-empty stored provider');

  /* ---- 7. a mixed day stays blocked forever, on purpose ---------------- */
  const stubborn = makeHarness(() => [clone(ONE), clone(TWO)]);
  await stubborn.pull();
  const stubbornUpdates = stubborn.updateBodies.length;
  const stubbornReplay = await stubborn.pull();
  eq(stubbornReplay.ok, true, 'the mixed-day replay did not complete');
  eq(stubbornReplay.repaired, 0, 'a genuinely unknown-provider census row was "repaired" with a guess');
  eq(stubborn.updateBodies.length, stubbornUpdates, 'a mixed census day issued provider enrichment POSTs');
  ok(stubborn.backendRows.every(row => String(row.provider || '') === ''),
    'a genuinely unknown-provider census row was given an invented attribution');
  eq(Number(stubbornReplay.calendarReceipt && stubbornReplay.calendarReceipt.providerBackfilled), 0,
    'a mixed census day reported provider backfills it did not and must not perform');

  console.log(`census day-header provider backfill: ${checks} checks passed`);
}

main().then(() => process.exit(0)).catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
