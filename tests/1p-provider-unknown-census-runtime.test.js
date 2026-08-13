'use strict';

/* p1 APPOINTMENT-CENSUS-ONLY CONTRACT
 *
 * The live athenaOne shape behind provider-roster-incomplete is unusually
 * specific: the schedule receipt proves every appointment row, every row has
 * a unique Athena appointment id, and the raw reader explicitly says all rows
 * are unattributed.  That is enough to reconcile the APPOINTMENTS while
 * leaving provider identity blank.  It is not enough to claim a provider
 * roster, provider attribution, practice coverage, or an authoritative
 * provider/day snapshot.
 *
 * This executes the real p1 importer.  The exception is deliberately narrow:
 * one exact all-provider DAY pull may use it.  A selected-provider pull, a
 * month pull, a public direct import, or any near miss stays fail-closed. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const importerPath = path.join(root, '1p-feat_mls_schedimport_exact.js');
assert(fs.existsSync(importerPath), 'the p1-only exact-importer fork is missing');
const importer = fs.readFileSync(importerPath, 'utf8');

const DAY = '2026-08-17';
const MONTH_DAY = '2026-08-11';
const ROWS = 24;

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function makeRows(day) {
  return Array.from({ length: ROWS }, (_, i) => {
    const n = i + 1;
    const hour = 8 + Math.floor(i / 6);
    const minute = (i % 6) * 10;
    return {
      name: `Census Patient ${String(n).padStart(2, '0')}`,
      dob: `01/${String(n).padStart(2, '0')}/1970`,
      mrn: `CENSUS-MRN-${String(n).padStart(2, '0')}`,
      athenaPatientId: `athena-patient-${n}`,
      patient_external_id: `patient-${n}`,
      athenaAppointmentId: `athena-appointment-${day}-${n}`,
      appointmentId: `athena-appointment-${day}-${n}`,
      date: day,
      start_local: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
      time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
      reason: 'Appointment census test',
      /* Every provider-bearing alias is intentionally present and blank. */
      provider: '',
      providerName: '',
      provider_name: '',
      providerId: '',
      provider_id: '',
      athenaProviderId: '',
      athena_provider_id: '',
      renderingProviderId: '',
      rendering_provider_id: ''
    };
  });
}

function makeHarness(options) {
  options = options || {};
  const listeners = new Set();
  const store = new Map();
  const authorityKey = 'p1-census-test::schedAuthoritativeDaysV1';
  const displayKey = 'p1-census-test::p1SchedAppointmentCensusDaysV1';
  if (Object.prototype.hasOwnProperty.call(options, 'initialAuthoritativeRaw')) {
    store.set(authorityKey, String(options.initialAuthoritativeRaw));
  }
  if (options.accountProviderInitial) {
    store.set('p1-census-test::pullProvider', String(options.accountProviderInitial));
  }
  const elements = new Map();
  const statuses = [];
  const posted = [];
  const savedBodies = [];
  const backendRows = [];
  const events = [];
  const rows = makeRows(options.day || DAY);
  if (options.demographicsInsufficient) rows.forEach(row => {
    row.dob = '';
    row.mrn = '';
    row.athenaPatientId = '';
    row.patient_external_id = '';
  });
  const patients = options.noLocalPatients ? [] : rows.map((row, i) => ({
    id: `patient-${i + 1}`,
    name: row.name,
    dob: row.dob,
    mrn: row.mrn,
    athenaId: row.mrn,
    visits: []
  }));
  let currentDay = options.day || DAY;
  let createSeq = 0;
  let armedOperation = null;
  let latestRosterReceipt = null;
  let authoritativeWriteAttempts = 0;
  let scheduleResponseCount = 0;
  const armedOperations = [];

  const headerRoster = [
    { stableKey: 'header:1', id: '101', raw: 'Header_One_MD', name: 'Header One, MD', rosterVerified: false },
    { stableKey: 'header:2', id: '202', raw: 'Header_Two_MD', name: 'Header Two, MD', rosterVerified: false }
  ];

  function responseFor(day, requestId) {
    scheduleResponseCount++;
    const responseRows = clone(rows).map(row => {
      row.date = day;
      row.athenaAppointmentId = row.athenaAppointmentId.replace(options.day || DAY, day);
      row.appointmentId = row.athenaAppointmentId;
      return row;
    });
    let response = {
      id: requestId,
      ok: true,
      scheduleVerified: true,
      schedDate: day,
      text: `Verified Day schedule ${day}`,
      appts: responseRows,
      /* Headers are evidence only.  They are not associated with any row. */
      providers: headerRoster.map(p => p.name),
      providerRoster: clone(headerRoster),
      providerDiag: {
        providerNames: headerRoster.map(p => p.name),
        attributionCoverage: {
          verdict: 'row-unattributed', rows: ROWS, headerCount: headerRoster.length,
          unattributedRows: ROWS, foreignRows: 0
        }
      },
      receipt: {
        complete: true,
        authoritativeEmpty: false,
        requestId,
        expectedCount: ROWS,
        parsedCount: ROWS,
        candidateCount: ROWS
      },
      providerRosterReceipt: {
        complete: false,
        partial: true,
        reason: 'legacy-unverified',
        observedCount: headerRoster.length,
        targetDate: day,
        requestId,
        requestedProviderId: '',
        requestedProviderStableKey: '',
        attributionCoverage: {
          verdict: 'row-unattributed', rows: ROWS, headerCount: headerRoster.length,
          unattributedRows: ROWS, foreignRows: 0
        }
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
    queueMicrotask,
    setTimeout, clearTimeout, setInterval: () => 1, clearInterval: () => {},
    CustomEvent: function CustomEvent(type, init) {
      this.type = type;
      this.detail = init && init.detail;
    },
    location: { pathname: '/1pScribeFlow.html' },
    localStorage: {
      getItem: key => {
        if (options.failAuthoritativeReads && String(key) === authorityKey) {
          throw new Error('simulated authoritative-store read failure');
        }
        return store.has(key) ? store.get(key) : null;
      },
      setItem: (key, value) => {
        if (String(key) === authorityKey) {
          authoritativeWriteAttempts++;
          if (options.failAuthoritativeWrites) {
            throw new Error('simulated authoritative-store persistence failure');
          }
        }
        if (options.failDisplayWrites && String(key) === displayKey) {
          throw new Error('simulated appointment-census display persistence failure');
        }
        store.set(key, String(value));
      },
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
    _calMode: 'day', _calRefDate: DAY, _calSelDay: '', _calProviders: clone(headerRoster), _calMe: null,
    __mlsProviderRoster: {
      list: () => clone(headerRoster),
      resolve: ref => {
        if (options.unresolvableProvider === true) return null;
        const raw = String(ref && typeof ref === 'object'
          ? (ref.stableKey || ref.id || ref.name || '') : (ref || '')).toLowerCase();
        const hit = headerRoster.find(p => [p.stableKey, p.id, p.name].some(v => String(v).toLowerCase() === raw));
        return hit ? clone(hit) : null;
      },
      beginOperation: op => {
        armedOperation = clone(op);
        armedOperations.push(clone(armedOperation));
        return clone(armedOperation);
      },
      ingestResp: response => {
        latestRosterReceipt = clone(response && response.providerRosterReceipt);
      },
      getReceipt: () => {
        const receipt = latestRosterReceipt || {
          complete: false, partial: true, reason: 'legacy-unverified', providerMode: 'all',
          targetDate: currentDay, attributionCoverage: {
            verdict: 'row-unattributed', rows: ROWS, headerCount: 2,
            unattributedRows: ROWS, foreignRows: 0
          }
        };
        return Object.assign(clone(receipt), armedOperation || {});
      },
      getScope: () => ({
        scopeComplete: false,
        scope: 'painted-day-grid',
        knownCount: headerRoster.length,
        gridSweptCount: headerRoster.length,
        rosterVerifiedCount: 0,
        athenaListEnumerated: false,
        sources: { dayGrid: true },
        statement: 'Only painted headers were observed.'
      })
    },
    backendMode: () => true,
    bkToken: () => 'p1-census-test-token',
    bkBase: () => 'https://local.invalid',
    uns: key => `p1-census-test::${key}`,
    _normDate: value => String(value || '').slice(0, 10),
    _normTime: normTime,
    _apptKey: (name, day, time) => `${String(name || '').trim().toLowerCase()}|${day}|${time}`,
    _acctWallToUtcIso: (day, time) => `${day}T${time}:00.000Z`,
    getPatients: () => patients,
    upsertPatient: patient => {
      const at = patients.findIndex(p => String(p.id) === String(patient.id));
      if (at >= 0) patients[at] = patient;
      else patients.push(patient);
    },
    loadCalendar: () => {
      rt._calAppts = backendRows.map(clone);
      return Promise.resolve();
    },
    renderTodayPicker: () => {}, renderHistory: () => {}, renderProfile: () => {}, loadPatients: () => {},
    dispatchEvent: event => events.push({ type: String(event && event.type || ''), detail: clone(event && event.detail) }),
    __mlsBgSleep: () => Promise.resolve(),
    fetch: async (url, init) => {
      if (/\/api\/me(?:$|\?)/.test(String(url))) {
        return { ok: true, status: 200, json: async () => ({ id: 'account-1' }) };
      }
      if (/version\.json/.test(String(url))) {
        return { ok: true, status: 200, json: async () => ({ version: '3.0.61' }) };
      }
      if (!init || !init.method) {
        return { ok: true, status: 200, json: async () => ({ appointments: backendRows.map(clone) }) };
      }
      const body = JSON.parse(init.body || '{}');
      const update = String(url).match(/\/api\/appointments\/([^/]+)\/update$/);
      if (update) {
        const id = decodeURIComponent(update[1]);
        const row = backendRows.find(item => String(item.id) === id);
        if (row) Object.assign(row, clone(body));
        return { ok: true, status: 200, json: async () => ({ ok: true }) };
      }
      const id = `p1-census-backend-${++createSeq}`;
      savedBodies.push(clone(body));
      backendRows.push(Object.assign({ id }, clone(body)));
      return { ok: true, status: 200, json: async () => ({ ok: true, id }) };
    }
  };
  rt.window = rt;
  rt.addEventListener = (_type, fn) => listeners.add(fn);
  rt.removeEventListener = (_type, fn) => listeners.delete(fn);
  rt.postMessage = msg => {
    posted.push(clone(msg));
    if (msg.type === 'mlsPing') queueMicrotask(() => emit('mlsPong', { ok: true, version: '3.0.61' }, ''));
    if (msg.type === 'mlsAppGotoDate') queueMicrotask(() => {
      currentDay = msg.date;
      emit('mlsAppGotoDateResult', { id: msg.id, ok: true, schedDate: msg.date }, msg.id);
    });
    if (msg.type === 'mlsAppPullSchedule') queueMicrotask(() => {
      emit('mlsAppScheduleResult', responseFor(currentDay, msg.id), msg.id);
      if (options.clearAccountProviderAfterWarm === true && scheduleResponseCount === 1) {
        store.delete('p1-census-test::pullProvider');
      }
    });
    if (options.chartHydrationUnavailable && msg.type === 'mlsAppReadChart') queueMicrotask(() => {
      emit('mlsAppChartResult', {
        id: msg.id, requestId: msg.requestId, ok: false, complete: false,
        reason: 'chart-hydration-unavailable', identityBootstrapReceipt: {
          complete: false, appointmentIdBound: false, navigationProven: false,
          bannerIdentity: false, dobVerified: false, exactNameMatched: false
        }
      }, msg.id);
    });
    if (options.chartHydrationUnavailable && msg.type === 'mlsAppReadAllVisits') queueMicrotask(() => {
      emit('mlsAppAllVisitsResult', {
        id: msg.id, requestId: msg.requestId, ok: false, complete: false,
        reason: 'history-unavailable', visits: []
      }, msg.id);
    });
  };

  vm.runInNewContext(importer, rt, { filename: '1p-feat_mls_schedimport_exact.js', timeout: 3000 });
  return {
    rt, api: rt.__mlsSI, rows, statuses, posted, savedBodies, backendRows, events,
    responseFor, store, authorityKey, displayKey, armedOperations,
    scheduleResponseCount: () => scheduleResponseCount,
    authoritativeWriteAttempts: () => authoritativeWriteAttempts,
    onStatus: message => statuses.push(String(message || ''))
  };
}

async function waitFor(predicate, label) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.fail(`timed out waiting for ${label}`);
}

function assertResumeProviderScope(rec, expected, label) {
  assert(rec && rec.providerScope && typeof rec.providerScope === 'object',
    `${label}: resume intent omitted its provider scope`);
  assert.deepStrictEqual(clone(rec.providerScope), expected,
    `${label}: resume intent did not preserve the exact bounded provider scope`);
  assert(!Object.prototype.hasOwnProperty.call(rec.providerScope, 'name') &&
    !Object.prototype.hasOwnProperty.call(rec.providerScope, 'raw'),
  `${label}: resume intent persisted provider display text instead of stable identity only`);
  assert(!/[\u0000-\u001f\u007f]/.test(JSON.stringify(rec.providerScope)),
    `${label}: resume provider scope retained control characters`);
}

async function assertIneligibleResumeRefuses(h, label, expectedScope) {
  const key = 'p1-census-test::pullResumeV1';
  const rec = JSON.parse(h.store.get(key) || 'null');
  assert(rec && rec.date === DAY, `${label}: the incomplete pull did not persist its resume intent`);
  assertResumeProviderScope(rec, expectedScope, label);
  assert.strictEqual(rec.p1CensusEligible, false,
    `${label}: an ineligible pull persisted appointment-census authority`);
  const readsBefore = h.posted.filter(message => message.type === 'mlsAppPullSchedule').length;
  const priorOutcome = h.api._lastPullResult();
  h.api._maybeResumePull();
  const go = h.rt.document.getElementById('mlsPullResumeGo');
  assert(go && typeof go.onclick === 'function', `${label}: the persisted resume could not be exercised`);
  go.onclick();
  await waitFor(() => h.posted.filter(message => message.type === 'mlsAppPullSchedule').length > readsBefore,
    `${label} resumed schedule read`);
  await waitFor(() => {
    const outcome = h.api._lastPullResult();
    return outcome && outcome !== priorOutcome && outcome.ok === false;
  }, `${label} fail-closed resume outcome`);
  const outcome = h.api._lastPullResult();
  assert.strictEqual(outcome.complete, false, `${label}: ineligible resume reported complete`);
  assert(!receiptComplete(outcome.appointmentCensusReceipt),
    `${label}: ineligible resume minted a complete appointment census`);
  assert.strictEqual(h.savedBodies.length, 0, `${label}: ineligible resume wrote provider-unknown rows`);
  if (expectedScope.mode === 'selected') {
    assert(outcome.providerReceipt && outcome.providerReceipt.mode === 'selected',
      `${label}: resumed selected intent widened to an all-provider receipt`);
    assert.strictEqual(String(outcome.providerReceipt.requestedId || ''), String(expectedScope.id || ''),
      `${label}: resumed selected intent changed provider id`);
    assert.strictEqual(String(outcome.providerReceipt.requestedStableKey || ''), String(expectedScope.stableKey || ''),
      `${label}: resumed selected intent changed provider stable key`);
  }
}

async function assertChangedResumeScopeRefuses(h, label, mutateRecord) {
  const key = 'p1-census-test::pullResumeV1';
  const captured = JSON.parse(h.store.get(key) || 'null');
  assert(captured && captured.providerScope, `${label}: selected resume scope was not persisted`);
  h.api._maybeResumePull();
  const go = h.rt.document.getElementById('mlsPullResumeGo');
  assert(go && typeof go.onclick === 'function', `${label}: persisted resume offer was not mounted`);
  const changed = mutateRecord(clone(captured));
  if (changed === undefined) h.store.delete(key);
  else h.store.set(key, JSON.stringify(changed));
  const readsBefore = h.posted.filter(message => message.type === 'mlsAppPullSchedule').length;
  const writesBefore = h.savedBodies.length;
  const priorOutcome = h.api._lastPullResult();
  go.onclick();
  await waitFor(() => {
    const outcome = h.api._lastPullResult();
    return outcome && outcome !== priorOutcome && outcome.reason === 'resume-scope-changed';
  }, `${label} scope-change refusal`);
  const outcome = h.api._lastPullResult();
  assert.strictEqual(outcome.ok, false, `${label}: changed scope reported success`);
  assert.strictEqual(outcome.complete, false, `${label}: changed scope reported complete`);
  assert.strictEqual(outcome.gate, 'resume-provider-scope',
    `${label}: changed scope refusal did not name the resume provider-scope gate`);
  assert.strictEqual(h.posted.filter(message => message.type === 'mlsAppPullSchedule').length, readsBefore,
    `${label}: changed resume scope started an Athena schedule read`);
  assert.strictEqual(h.savedBodies.length, writesBefore,
    `${label}: changed resume scope wrote calendar rows`);
  assert.strictEqual(h.store.has(key), false,
    `${label}: changed resume scope was not cleared after refusal`);
}

async function assertAuthorityReadRefuses(options, label, expectedReason) {
  const h = makeHarness(options);
  const before = h.store.get(h.authorityKey);
  const result = await h.api.dayPull({
    date: DAY, provider: 'all', includeHistory: false, onStatus: h.onStatus
  });
  assert.strictEqual(result.ok, false, `${label}: census reported success over unreadable authority state`);
  assert.strictEqual(result.complete, false, `${label}: census reported complete over unreadable authority state`);
  assert.strictEqual(result.reason, 'calendar-partial',
    `${label}: unreadable authority state did not produce calendar-partial`);
  assert(result.calendarReceipt && result.calendarReceipt.complete === false,
    `${label}: unreadable authority state left the calendar receipt complete`);
  assert.strictEqual(result.calendarReceipt.authorityInvalidationComplete, false,
    `${label}: unreadable authority state claimed invalidation complete`);
  assert.strictEqual(result.calendarReceipt.authorityInvalidationReason, expectedReason,
    `${label}: wrong authority invalidation refusal`);
  assert.strictEqual(h.authoritativeWriteAttempts(), 0,
    `${label}: importer rewrote authority storage after failing to read/validate it`);
  assert.strictEqual(h.store.get(h.authorityKey), before,
    `${label}: unreadable/corrupt authority bytes were not preserved`);
}

function seedAuthoritativeDay(h) {
  const providerKey = h.api._providerKey('Header One, MD');
  assert(providerKey, 'test could not derive the stale provider snapshot key');
  const snap = mode => ({
    v: 1, date: DAY, mode, providerKey: mode === 'selected' ? providerKey : '',
    backendIds: [], sourceCount: 0, updated: Date.now() - 60000
  });
  h.store.set('p1-census-test::schedAuthoritativeDaysV1', JSON.stringify({
    v: 1,
    days: {
      [DAY]: {
        all: snap('all'),
        providers: { [providerKey]: snap('selected') },
        active: { mode: 'all', key: '' }
      }
    }
  }));
  return providerKey;
}

function receiptComplete(receipt) {
  return !!(receipt && receipt.complete === true);
}

function makeCompleteAttributedAll(response) {
  response.appts.forEach((row, i) => {
    const header = i % 2 === 0
      ? { name: 'Header One, MD', id: '101' }
      : { name: 'Header Two, MD', id: '202' };
    row.provider = header.name;
    row.providerName = header.name;
    row.provider_name = header.name;
    row.providerId = header.id;
    row.provider_id = header.id;
    row.athenaProviderId = header.id;
    row.athena_provider_id = header.id;
    row.renderingProviderId = header.id;
    row.rendering_provider_id = header.id;
  });
  response.providerRoster.forEach(provider => { provider.rosterVerified = true; });
  response.providerDiag.attributionCoverage = {
    verdict: 'row-attributed', rows: ROWS, headerCount: 2,
    unattributedRows: 0, foreignRows: 0
  };
  Object.assign(response.providerRosterReceipt, {
    complete: true,
    partial: false,
    reason: 'complete',
    expectedCount: 2,
    observedCount: 2,
    providerMode: 'all',
    requestedProviderId: '',
    requestedProviderStableKey: '',
    attributionCoverage: clone(response.providerDiag.attributionCoverage)
  });
  return response;
}

function makeCompleteRosterUnattributed(response) {
  /* The provider roster itself is complete enough to resolve the selected
   * clinician, but the schedule rows still carry no row-to-provider link.
   * This reaches the selected pull engine (and its resume persistence) without
   * relying on the forbidden selected-to-all preflight fallback. */
  response.providerRoster.forEach(provider => { provider.rosterVerified = true; });
  Object.assign(response.providerRosterReceipt, {
    complete: true,
    partial: false,
    reason: 'complete',
    expectedCount: 2,
    observedCount: 2
  });
  return response;
}

function seedSelectedResumeIntent(h) {
  const rec = {
    date: DAY,
    startedAt: Date.now(),
    attempts: 0,
    includeHistory: false,
    bodies: null,
    p1CensusEligible: false,
    providerScope: {
      v: 1, mode: 'selected', source: 'day-caller',
      id: '101', stableKey: 'header:1'
    }
  };
  h.store.set('p1-census-test::pullResumeV1', JSON.stringify(rec));
  return rec;
}

function assertNoProviderGuess(h, label) {
  h.savedBodies.forEach((body, i) => {
    const values = [
      body.provider, body.providerName, body.provider_name,
      body.providerId, body.provider_id,
      body.athenaProviderId, body.athena_provider_id,
      body.renderingProviderId, body.rendering_provider_id
    ].filter(value => value != null);
    assert(values.every(value => String(value).trim() === ''),
      `${label}: stored row ${i + 1} guessed a provider: ${JSON.stringify(values)}`);
  });
}

async function assertRefuses(label, mutateResponse) {
  const h = makeHarness({ mutateResponse });
  const result = await h.api.dayPull({ date: DAY, provider: 'all', includeHistory: false, onStatus: h.onStatus });
  assert.strictEqual(result && result.ok, false, `${label}: near miss was reported ok`);
  assert.strictEqual(result && result.complete, false, `${label}: near miss was reported complete`);
  assert.strictEqual(h.savedBodies.length, 0, `${label}: near miss wrote appointment rows`);
  assert.strictEqual(h.backendRows.length, 0, `${label}: near miss changed the calendar`);
  assert(!receiptComplete(result && result.appointmentCensusReceipt),
    `${label}: near miss published a complete appointment-census receipt`);
  assert(!receiptComplete(result && result.providerReceipt),
    `${label}: near miss published a complete provider receipt`);
  assert(!receiptComplete(result && result.providerAttributionReceipt),
    `${label}: near miss published complete provider attribution`);
  const auth = h.api.authoritativeStatusForDay(DAY, 'all');
  assert(auth.available !== true && auth.exact !== true,
    `${label}: near miss published an authoritative provider/day snapshot`);
}

async function main() {
  const exact = makeHarness();
  assert.strictEqual(exact.api.asset, '1p-feat_mls_schedimport_exact.js',
    'p1 diagnostics identify the main-site importer instead of the isolated p1 fork');
  const staleProviderKey = seedAuthoritativeDay(exact);
  assert.strictEqual(exact.api.authoritativeStatusForDay(DAY, 'all').exact, true,
    'the stale all-provider snapshot was not seeded');
  assert.strictEqual(exact.api.authoritativeStatusForDay(DAY, {
    id: '101', stableKey: 'header:1', name: 'Header One, MD', rosterVerified: true
  }).exact, true, 'the stale selected-provider snapshot was not seeded');
  const result = await exact.api.dayPull({
    date: DAY, provider: 'all', includeHistory: false, onStatus: exact.onStatus
  });

  assert.strictEqual(result.ok, true,
    `the exact 24/24 appointment census must complete: ${JSON.stringify({ reason: result.reason, error: result.error })}`);
  assert.strictEqual(result.complete, true, 'the exact appointment census was not terminally complete');
  assert.strictEqual(result.reason, 'complete-appointment-census-only',
    'provider-unknown success must remain distinguishable from provider-verified success');
  assert.strictEqual(result.created, ROWS, 'the exact appointment census did not import all 24 rows');
  assert.strictEqual(exact.savedBodies.length, ROWS, 'not every census row reached the calendar backend');
  assert.strictEqual(new Set(exact.savedBodies.map(body => String(
    body.athena_appointment_id || body.athenaAppointmentId || body.appointment_id || body.appointmentId || ''
  ))).size, ROWS, 'the saved census did not retain 24 unique Athena appointment identities');
  assertNoProviderGuess(exact, 'exact census');

  assert(result.appointmentCensusReceipt && result.appointmentCensusReceipt.complete === true,
    'the success did not disclose a complete appointmentCensusReceipt');
  assert.strictEqual(Number(result.appointmentCensusReceipt.rowCount), ROWS,
    'the census receipt did not count all 24 source rows');
  assert.strictEqual(Number(result.appointmentCensusReceipt.uniqueAppointmentIds), ROWS,
    'the census receipt did not prove 24 unique appointment ids');
  assert.strictEqual(Number(result.appointmentCensusReceipt.unattributedRows), ROWS,
    'the census receipt did not disclose that every provider is unknown');
  assert.strictEqual(result.providerAttributionComplete, false,
    'provider attribution was not explicitly left incomplete');
  assert(result.providerReceipt && result.providerReceipt.complete === false,
    'the incomplete provider-attribution receipt is missing');
  assert.strictEqual(Number(result.providerReceipt.unattributedRows), ROWS,
    'the attribution receipt did not count all provider-unknown rows');
  assert(!receiptComplete(result.providerReceipt),
    'appointment-census success was falsely promoted to providerReceipt.complete');
  assert(!receiptComplete(result.providerRosterReceipt),
    'appointment-census success was falsely promoted to a complete provider roster');

  assert(result.calendarReceipt && result.calendarReceipt.complete === true,
    'the 24 reconciled appointments need a complete calendar receipt');
  assert.strictEqual(result.calendarReceipt.snapshotPublished, false,
    'provider-unknown census published an authoritative provider/day snapshot');
  assert(result.authoritativeSnapshot && result.authoritativeSnapshot.published === false,
    'provider-unknown census falsely claimed an authoritative snapshot');
  assert(result.calendarReceipt.providerScope && result.calendarReceipt.providerScope.coversPractice === false,
    'provider-unknown census claimed practice coverage');
  const auth = exact.api.authoritativeStatusForDay(DAY, 'all');
  assert(auth.available !== true && auth.exact !== true,
    'provider-unknown census became authoritative provider/day state');
  const authoritativeRows = exact.api.authoritativeRowsForDay(DAY, 'all');
  assert(!authoritativeRows || authoritativeRows.length === 0,
    'provider-unknown census leaked rows through the authoritative provider/day reader');
  const authorityStore = JSON.parse(exact.store.get('p1-census-test::schedAuthoritativeDaysV1') || '{"v":1,"days":{}}');
  assert(!authorityStore.days || !authorityStore.days[DAY],
    'provider-unknown census left a stale all/provider authoritative day in durable storage');
  assert.strictEqual(exact.api.authoritativeStatusForDay(DAY, {
    id: '101', stableKey: 'header:1', name: 'Header One, MD', rosterVerified: true
  }).exact, false, `provider-unknown census left stale provider authority (${staleProviderKey}) available`);
  const exactStatus = exact.statuses.join(' ');
  assert(/appointments? (?:were |was )?(?:imported|added|accounted)|added \d+ appointments?/i.test(exactStatus) &&
    /provider (?:grouping|identity|attribution).*(?:unverified|unknown|not being reported as complete)|(?:unverified|unknown).*provider (?:grouping|identity|attribution)/i.test(exactStatus),
  'the terminal status did not say appointments imported while provider grouping stayed unverified');

  /* This is the real visible-button shape: includeHistory is omitted, so the
     guarded day lane defaults it to true.  Provider-unknown census rows may
     lack DOB/MRN/local patient bindings entirely.  That must not turn an
     exact appointment import into 24 chart probes or a false history claim. */
  const button = makeHarness({
    demographicsInsufficient: true,
    noLocalPatients: true,
    chartHydrationUnavailable: true
  });
  const buttonResult = await button.api.dayPull({ date: DAY, onStatus: button.onStatus });
  assert.strictEqual(buttonResult.includeHistory, true,
    'the real day button no longer defaults includeHistory to true');
  assert.strictEqual(buttonResult.ok, true,
    `the real day button failed the exact appointment census: ${JSON.stringify({ reason: buttonResult.reason, error: buttonResult.error })}`);
  assert.strictEqual(buttonResult.complete, true,
    'the real day button did not complete its exact appointment census');
  assert.strictEqual(buttonResult.reason, 'complete-appointment-census-only',
    'the real day button blurred appointment-census completion into provider-verified completion');
  assert.strictEqual(buttonResult.created, ROWS,
    'demographics-free appointment census did not import all 24 appointments');
  assert.strictEqual(button.savedBodies.length, ROWS,
    'demographics-free appointment census did not reach durable calendar storage');
  assertNoProviderGuess(button, 'real-button demographics-free census');
  assert(buttonResult.appointmentCensusReceipt && buttonResult.appointmentCensusReceipt.complete === true,
    'the real day button did not return a complete appointment-census receipt');
  assert(buttonResult.identityBootstrapReceipt && buttonResult.identityBootstrapReceipt.skipped === true,
    'provider-unknown census did not explicitly skip demographics/chart hydration');
  assert.strictEqual(buttonResult.identityBootstrapReceipt.reason, 'provider-attribution-unavailable',
    'demographics/chart hydration skip did not name unavailable provider attribution');
  assert(buttonResult.historyReceipt && buttonResult.historyReceipt.complete === true &&
    buttonResult.historyReceipt.skipped === true,
  'provider-unknown census did not return an explicit completed history-skip receipt');
  assert.strictEqual(buttonResult.historyReceipt.reason, 'provider-attribution-unavailable',
    'history skip did not name unavailable provider attribution');
  assert.strictEqual(Number(buttonResult.historyReceipt.requested || 0), 0,
    'provider-unknown census claimed history rows were requested');
  assert.strictEqual(Number(buttonResult.historyReceipt.processed || 0), 0,
    'provider-unknown census claimed history rows were processed');
  assert(!button.posted.some(message => message.type === 'mlsAppReadChart'),
    'provider-unknown census attempted chart hydration despite its explicit skip');
  assert(!button.posted.some(message => message.type === 'mlsAppReadAllVisits'),
    'provider-unknown census attempted history bridge work despite its explicit skip');

  /* Replaying the same exact Athena ids is an idempotent reconciliation.  A
     provider entered elsewhere is stronger than this provider-unknown source
     and must survive untouched. */
  exact.backendRows[0].provider = 'Existing Clinician, MD';
  exact.backendRows[0].provider_id = 'existing-provider-777';
  const repeat = await exact.api.dayPull({
    date: DAY, provider: 'all', includeHistory: false, onStatus: exact.onStatus
  });
  assert.strictEqual(repeat.ok, true, 'an idempotent census replay did not complete');
  assert.strictEqual(repeat.complete, true, 'an idempotent census replay was reported partial');
  assert.strictEqual(repeat.created, 0, 'an idempotent census replay created duplicates');
  assert.strictEqual(repeat.skipped, ROWS, 'an idempotent census replay did not reconcile/skip all 24 rows');
  assert.strictEqual(exact.backendRows.length, ROWS, 'an idempotent census replay changed the appointment count');
  assert.strictEqual(exact.savedBodies.length, ROWS, 'an idempotent census replay issued new creates');
  assert.strictEqual(exact.backendRows[0].provider, 'Existing Clinician, MD',
    'provider-unknown census cleared an existing provider name');
  assert.strictEqual(exact.backendRows[0].provider_id, 'existing-provider-777',
    'provider-unknown census cleared an existing provider id');
  assert(repeat.appointmentCensusReceipt && repeat.appointmentCensusReceipt.complete === true,
    'the idempotent replay lost its appointment-census receipt');
  assert(!receiptComplete(repeat.providerReceipt) && repeat.providerAttributionComplete === false,
    'the idempotent replay promoted provider-unknown rows to provider-complete');
  assert(repeat.authoritativeSnapshot && repeat.authoritativeSnapshot.published === false,
    'the idempotent replay published an authoritative provider/day snapshot');

  const authorityFailure = makeHarness({ failAuthoritativeWrites: true });
  seedAuthoritativeDay(authorityFailure);
  const authorityFailureResult = await authorityFailure.api.dayPull({
    date: DAY, provider: 'all', includeHistory: false, onStatus: authorityFailure.onStatus
  });
  assert.strictEqual(authorityFailureResult.ok, false,
    'census reported success when stale authority could not be cleared durably');
  assert.strictEqual(authorityFailureResult.complete, false,
    'census reported complete when stale authority could not be cleared durably');
  assert(authorityFailureResult.calendarReceipt && authorityFailureResult.calendarReceipt.complete === false,
    'authority-clear persistence failure was not reflected as a partial calendar receipt');
  assert.strictEqual(authorityFailureResult.reason, 'calendar-partial',
    'authority-clear persistence failure did not produce an honest calendar-partial result');
  assert.strictEqual(authorityFailure.api.authoritativeStatusForDay(DAY, 'all').exact, true,
    'the persistence-failure harness did not retain the stale snapshot it failed to clear');

  const displayFailure = makeHarness({ failDisplayWrites: true });
  const displayFailureResult = await displayFailure.api.dayPull({
    date: DAY, provider: 'all', includeHistory: false, onStatus: displayFailure.onStatus
  });
  assert.strictEqual(displayFailureResult.ok, false,
    'real census pull reported success when exact display snapshot persistence failed');
  assert.strictEqual(displayFailureResult.complete, false,
    'real census pull reported complete when exact display snapshot persistence failed');
  assert.strictEqual(displayFailureResult.reason, 'calendar-partial',
    'display snapshot persistence failure did not produce calendar-partial');
  assert(displayFailureResult.calendarReceipt && displayFailureResult.calendarReceipt.complete === false,
    'display snapshot persistence failure left the calendar receipt complete');
  assert.strictEqual(displayFailureResult.calendarReceipt.appointmentCensusDisplayPublished, false,
    'display snapshot persistence failure claimed publication');
  assert.strictEqual(displayFailureResult.calendarReceipt.appointmentCensusDisplayReason, 'snapshot-persist-failed',
    'display snapshot persistence failure lost its exact reason');
  assert.strictEqual(displayFailure.store.has(displayFailure.displayKey), false,
    'failed display persistence left a plausible durable census snapshot');

  await assertAuthorityReadRefuses({
    failAuthoritativeReads: true,
    initialAuthoritativeRaw: JSON.stringify({ v: 1, days: { sentinel: { all: null, providers: {} } } })
  }, 'authority getItem exception', 'authority-invalidation-read-failed');
  await assertAuthorityReadRefuses({
    initialAuthoritativeRaw: '{"v":1,"days":'
  }, 'corrupt authority JSON', 'authority-invalidation-read-failed');
  await assertAuthorityReadRefuses({
    initialAuthoritativeRaw: JSON.stringify({ v: 1, days: [] })
  }, 'invalid authority schema', 'authority-invalidation-store-invalid');

  /* Every proof term is conjunctive.  One changed fact closes the exception. */
  await assertRefuses('expected-count mismatch', response => {
    response.receipt.expectedCount = ROWS + 1; return response;
  });
  await assertRefuses('schedule verification absent', response => {
    response.scheduleVerified = false; return response;
  });
  await assertRefuses('parsed-count mismatch', response => {
    response.receipt.parsedCount = ROWS - 1; return response;
  });
  await assertRefuses('candidate-count mismatch', response => {
    response.receipt.candidateCount = ROWS - 1; return response;
  });
  await assertRefuses('returned-row mismatch', response => {
    response.appts.pop(); return response;
  });
  await assertRefuses('duplicate appointment identity', response => {
    response.appts[1].athenaAppointmentId = response.appts[0].athenaAppointmentId;
    response.appts[1].appointmentId = response.appts[0].appointmentId;
    return response;
  });
  await assertRefuses('missing appointment identity', response => {
    response.appts[0].athenaAppointmentId = '';
    response.appts[0].appointmentId = '';
    return response;
  });
  await assertRefuses('missing appointment time', response => {
    response.appts[0].time = '';
    response.appts[0].start_local = '';
    return response;
  });
  await assertRefuses('invalid appointment time', response => {
    response.appts[0].time = 'not-a-time';
    response.appts[0].start_local = 'not-a-time';
    return response;
  });
  await assertRefuses('one provider name present', response => {
    response.appts[0].provider = 'Header One, MD'; return response;
  });
  await assertRefuses('one provider id present', response => {
    response.appts[0].athenaProviderId = '101'; return response;
  });
  await assertRefuses('wrong attribution verdict', response => {
    response.providerRosterReceipt.attributionCoverage.verdict = 'mixed'; return response;
  });
  await assertRefuses('foreign attributed row reported', response => {
    response.providerRosterReceipt.attributionCoverage.foreignRows = 1; return response;
  });
  await assertRefuses('provider header count absent', response => {
    response.providerRosterReceipt.attributionCoverage.headerCount = 0;
    response.providerRosterReceipt.observedCount = 0;
    return response;
  });
  await assertRefuses('header count disagrees with observed roster', response => {
    response.providerRosterReceipt.observedCount = 1; return response;
  });
  await assertRefuses('coverage row-count mismatch', response => {
    response.providerRosterReceipt.attributionCoverage.rows = ROWS - 1; return response;
  });
  await assertRefuses('coverage unattributed-count mismatch', response => {
    response.providerRosterReceipt.attributionCoverage.unattributedRows = ROWS - 1; return response;
  });
  await assertRefuses('missing raw attribution evidence', response => {
    delete response.providerRosterReceipt.attributionCoverage; return response;
  });
  await assertRefuses('wrong legacy receipt reason', response => {
    response.providerRosterReceipt.reason = 'some-other-reason'; return response;
  });
  await assertRefuses('raw roster falsely complete', response => {
    response.providerRosterReceipt.complete = true; return response;
  });
  await assertRefuses('raw roster not marked partial', response => {
    response.providerRosterReceipt.partial = false; return response;
  });
  await assertRefuses('wrong provider mode', response => {
    response.providerRosterReceipt.providerMode = 'selected'; return response;
  });
  await assertRefuses('wrong roster target day', response => {
    response.providerRosterReceipt.targetDate = '2026-08-18'; return response;
  });
  await assertRefuses('wrong raw roster request id', response => {
    response.providerRosterReceipt.requestId = 'foreign-request'; return response;
  });
  await assertRefuses('raw selected provider identity present', response => {
    response.providerRosterReceipt.requestedProviderId = '101'; return response;
  });
  await assertRefuses('foreign dated row', response => {
    response.appts[0].date = '2026-08-18'; return response;
  });

  const selected = makeHarness({ mutateResponse: makeCompleteRosterUnattributed });
  const selectedResult = await selected.api.dayPull({
    date: DAY,
    provider: { id: '101', stableKey: 'header:1', name: 'Header One, MD', rosterVerified: true },
    includeHistory: false,
    onStatus: selected.onStatus
  });
  assert.strictEqual(selectedResult.ok, false, 'selected-provider route used the census exception');
  assert.strictEqual(selected.savedBodies.length, 0, 'selected-provider census exception wrote rows');
  assert(!receiptComplete(selectedResult.appointmentCensusReceipt),
    'selected-provider route published a complete appointment census');
  await assertIneligibleResumeRefuses(selected, 'selected-provider resume', {
    v: 1, mode: 'selected', source: 'day-caller', id: '101', stableKey: 'header:1'
  });

  /* A selected provider that cannot be resolved after the warm-up must not be
     silently widened to `all`.  Use a response that is otherwise a perfectly
     importable, completely attributed all-provider day: zero writes here prove
     the ORIGINAL selected scope remains authoritative, rather than merely
     proving the provider-unknown census token was withheld. */
  const unresolvedSelected = makeHarness({
    unresolvableProvider: true,
    mutateResponse: makeCompleteAttributedAll
  });
  const unresolvedSelectedResult = await unresolvedSelected.api.dayPull({
    date: DAY,
    provider: {
      id: '999', stableKey: 'missing:999', name: 'Unresolvable Selected, MD',
      rosterVerified: true
    },
    includeHistory: false,
    onStatus: unresolvedSelected.onStatus
  });
  assert.strictEqual(unresolvedSelectedResult.ok, false,
    'an unresolvable selected-provider pull widened to an attributed all-provider success');
  assert.strictEqual(unresolvedSelectedResult.complete, false,
    'an unresolvable selected-provider pull reported complete after widening to all');
  assert.strictEqual(unresolvedSelected.savedBodies.length, 0,
    'an unresolvable selected-provider pull imported the otherwise-valid all-provider response');
  assert.strictEqual(unresolvedSelected.backendRows.length, 0,
    'an unresolvable selected-provider pull changed the calendar through an all-provider fallback');
  assert(!receiptComplete(unresolvedSelectedResult.appointmentCensusReceipt),
    'an unresolvable selected-provider pull minted an appointment-census receipt');
  assert(!receiptComplete(unresolvedSelectedResult.providerReceipt),
    'an unresolvable selected-provider pull minted a complete provider receipt after widening');

  /* Account-default scope is frozen before warm-up just like an explicit
   * provider. Simulate the account mapping disappearing while the advisory
   * read runs; the real read must remain selected instead of becoming all. */
  const accountFrozen = makeHarness({
    accountProviderInitial: 'Header One, MD',
    clearAccountProviderAfterWarm: true,
    mutateResponse: makeCompleteRosterUnattributed
  });
  const accountFrozenResult = await accountFrozen.api.dayPull({
    date: DAY, includeHistory: false, onStatus: accountFrozen.onStatus
  });
  assert.strictEqual(accountFrozenResult.ok, false,
    'an account-selected pull became all-provider after its warm-up mapping changed');
  assert.strictEqual(accountFrozen.savedBodies.length, 0,
    'an account-selected pull imported rows after widening during warm-up');
  const accountRealRead = accountFrozen.armedOperations[accountFrozen.armedOperations.length - 1];
  assert(accountRealRead && accountRealRead.providerMode === 'selected',
    'the real read did not retain the account-selected provider mode frozen before warm-up');
  assert.strictEqual(accountRealRead.requestedProviderId, '101',
    'the real read changed the account-selected provider id during warm-up');
  assert.strictEqual(accountRealRead.requestedProviderStableKey, 'header:1',
    'the real read changed the account-selected stable key during warm-up');
  const accountResume = JSON.parse(accountFrozen.store.get('p1-census-test::pullResumeV1') || 'null');
  assertResumeProviderScope(accountResume, {
    v: 1, mode: 'selected', source: 'day-account', id: '101', stableKey: 'header:1'
  }, 'account-selected resume');

  /* An untampered selected resume reconstructs its canonical provider from
   * stable identity. Even when Athena returns a fully attributed all-provider
   * grid, only the selected clinician's rows may be reconciled. */
  const selectedResume = makeHarness({
    mutateResponse: (response, call) => call >= 3
      ? makeCompleteAttributedAll(response)
      : makeCompleteRosterUnattributed(response)
  });
  const selectedResumeFirst = await selectedResume.api.dayPull({
    date: DAY,
    provider: { id: '101', stableKey: 'header:1', name: 'Header One, MD', rosterVerified: true },
    includeHistory: false,
    onStatus: selectedResume.onStatus
  });
  assert.strictEqual(selectedResumeFirst.ok, false,
    'selected-resume fixture did not begin with an incomplete selected pull');
  const selectedResumeRec = JSON.parse(selectedResume.store.get('p1-census-test::pullResumeV1') || 'null');
  assertResumeProviderScope(selectedResumeRec, {
    v: 1, mode: 'selected', source: 'day-caller', id: '101', stableKey: 'header:1'
  }, 'untampered selected resume');
  assert.strictEqual(selectedResumeRec.p1CensusEligible, false,
    'selected resume persisted all-provider census authority');
  selectedResume.api._maybeResumePull();
  const selectedResumeGo = selectedResume.rt.document.getElementById('mlsPullResumeGo');
  assert(selectedResumeGo && typeof selectedResumeGo.onclick === 'function',
    'untampered selected resume offer was not mounted');
  const selectedReadsBefore = selectedResume.scheduleResponseCount();
  selectedResumeGo.onclick();
  await waitFor(() => selectedResume.scheduleResponseCount() > selectedReadsBefore,
    'untampered selected resume schedule read');
  await waitFor(() => {
    const outcome = selectedResume.api._lastPullResult();
    return outcome && outcome.complete === true;
  }, 'untampered selected resume completion');
  const selectedResumeResult = selectedResume.api._lastPullResult();
  assert.strictEqual(selectedResumeResult.ok, true,
    'untampered selected resume did not reconcile its selected provider');
  assert.strictEqual(selectedResume.savedBodies.length, ROWS / 2,
    'untampered selected resume imported the whole attributed grid instead of one provider');
  assert(selectedResume.savedBodies.every(body =>
    String(body.provider_id || body.providerId || body.athena_provider_id || body.athenaProviderId || '') === '101'),
  'untampered selected resume imported a row attributed to another provider');
  const selectedResumeRead = selectedResume.armedOperations[selectedResume.armedOperations.length - 1];
  assert(selectedResumeRead && selectedResumeRead.providerMode === 'selected' &&
    selectedResumeRead.requestedProviderId === '101' &&
    selectedResumeRead.requestedProviderStableKey === 'header:1',
  'untampered resume did not pass the reconstructed canonical selected provider to pull');

  /* The offer captures one exact scope. Any change in durable state before the
   * click is a TOCTOU refusal before Athena is read, including malformed scope
   * records and an attempted selected -> all+census privilege escalation. */
  const changedResumeCases = [
    ['durable resume key deleted after offer', () => undefined],
    ['selected-to-all+census', rec => {
      rec.providerScope = { v: 1, mode: 'all', source: 'day-caller' };
      rec.p1CensusEligible = true;
      return rec;
    }],
    ['missing provider scope', rec => { delete rec.providerScope; return rec; }],
    ['missing provider-scope version', rec => { delete rec.providerScope.v; return rec; }],
    ['selected scope missing id and stable key', rec => {
      delete rec.providerScope.id; delete rec.providerScope.stableKey; return rec;
    }],
    ['provider scope with control characters', rec => {
      rec.providerScope.stableKey = 'header:1\nforged'; return rec;
    }],
    ['oversize provider scope identity', rec => {
      rec.providerScope.id = 'x'.repeat(500); delete rec.providerScope.stableKey; return rec;
    }],
    ['resume date changed after offer', rec => { rec.date = '2026-08-18'; return rec; }]
  ];
  for (const [label, mutate] of changedResumeCases) {
    const changed = makeHarness();
    seedSelectedResumeIntent(changed);
    await assertChangedResumeScopeRefuses(changed, label, mutate);
  }

  /* Positive control: the private all-Day census grant survives an honest
   * same-scope resume. The first real read is intentionally one count short;
   * the resumed exact read may then import all 24 provider-unknown rows. */
  const allResume = makeHarness({
    mutateResponse: (response, call) => {
      if (call === 2) response.receipt.parsedCount = ROWS - 1;
      return response;
    }
  });
  const allResumeFirst = await allResume.api.dayPull({
    date: DAY, provider: 'all', includeHistory: false, onStatus: allResume.onStatus
  });
  assert.strictEqual(allResumeFirst.ok, false,
    'all-resume fixture did not begin with an incomplete guarded Day pull');
  const allResumeRec = JSON.parse(allResume.store.get('p1-census-test::pullResumeV1') || 'null');
  assertResumeProviderScope(allResumeRec, {
    v: 1, mode: 'all', source: 'day-caller'
  }, 'guarded all census resume');
  assert.strictEqual(allResumeRec.p1CensusEligible, true,
    'guarded all-Day pull did not persist its private census eligibility provenance');
  allResume.api._maybeResumePull();
  const allResumeGo = allResume.rt.document.getElementById('mlsPullResumeGo');
  assert(allResumeGo && typeof allResumeGo.onclick === 'function',
    'guarded all census resume offer was not mounted');
  const allReadsBefore = allResume.scheduleResponseCount();
  allResumeGo.onclick();
  await waitFor(() => allResume.scheduleResponseCount() > allReadsBefore,
    'guarded all census resume schedule read');
  await waitFor(() => {
    const outcome = allResume.api._lastPullResult();
    return outcome && outcome.complete === true;
  }, 'guarded all census resume completion');
  const allResumeResult = allResume.api._lastPullResult();
  assert.strictEqual(allResumeResult.ok, true,
    'guarded same-scope all resume failed');
  assert.strictEqual(allResumeResult.reason, 'complete-appointment-census-only',
    'guarded same-scope all resume lost its appointment-census authority');
  assert.strictEqual(allResume.savedBodies.length, ROWS,
    'guarded all census resume did not reconcile all exact appointments');
  assertNoProviderGuess(allResume, 'guarded all census resume');

  const month = makeHarness({ day: MONTH_DAY });
  const monthResult = await month.api.pullMonth({
    month: '2026-08', dates: [MONTH_DAY], provider: 'all', includeHistory: false, onStatus: month.onStatus
  });
  assert.strictEqual(monthResult.ok, false, 'month route used the day-only census exception');
  assert.strictEqual(month.savedBodies.length, 0, 'month route wrote provider-unknown census rows');
  assert(!receiptComplete(monthResult.appointmentCensusReceipt),
    'month route published a complete appointment census');

  const directPull = makeHarness();
  const directPullResult = await directPull.api.pull({
    date: DAY, provider: 'all', includeHistory: false, onStatus: directPull.onStatus
  });
  assert.strictEqual(directPullResult.ok, false,
    'direct public pull used the guarded day-only census exception');
  assert.strictEqual(directPull.savedBodies.length, 0,
    'direct public pull wrote provider-unknown census rows');
  assert(!receiptComplete(directPullResult.appointmentCensusReceipt),
    'direct public pull published a complete appointment census');
  await assertIneligibleResumeRefuses(directPull, 'direct-pull resume', {
    v: 1, mode: 'all', source: 'direct'
  });

  const direct = makeHarness();
  const directResponse = direct.responseFor(DAY, 'direct-request');
  const directResult = await direct.api.importAppts(clone(directResponse.appts), {
    date: DAY,
    scopeDate: DAY,
    provider: 'all',
    providerResponse: directResponse,
    requireProviderCoverage: false,
    includeHistory: false
  });
  assert.strictEqual(direct.savedBodies.length, 0,
    'public direct import bypassed the day-pull census proof gate');
  assert(!receiptComplete(directResult && directResult.providerReceipt),
    'public direct import minted a complete provider receipt for unattributed rows');
  assert(!receiptComplete(directResult && directResult.appointmentCensusReceipt),
    'public direct import minted a complete appointment census');

  console.log('PASS p1 appointment-census-only runtime: exact 24/24 all-day row-unattributed imports idempotently without provider guesses; default history skips chart work; selected scope never widens across warm/resume, resume scope is bounded and TOCTOU-safe, guarded all census resume works; near misses and selected/month/direct routes refuse; stale authority is cleared durably and unreadable authority fails closed');
}

main().catch(error => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
