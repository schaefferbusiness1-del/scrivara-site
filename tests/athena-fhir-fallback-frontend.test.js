'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(ROOT, 'ScribeFlow.html'), 'utf8');
const connect = fs.readFileSync(path.join(ROOT, 'mls-connect.js'), 'utf8');

function between(source, start, end) {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a + start.length);
  assert(a >= 0 && b > a, `Could not locate ${start}`);
  return source.slice(a, b);
}

const apiSource = between(app, 'const ATHENA_API_WRITEBACK_REASON=', 'function pushToAthena()');
const settingsCard = between(app, 'id="athApiSettingsCard"', '<!-- Developer API key + MLS Assist');
const activeEasy = between(connect, 'EASY tuning pass: the effortless Visit tab', 'PULL PIPELINE TRUTH PACK');
const staffSource = between(activeEasy, 'var athenaApiPrepNote', 'function seg(r, label)');

const cleanupSource = between(connect, 'function declutterAthenaScaffold()', 'function promoteExtensionCard()');
assert(cleanupSource.indexOf("$('athApiSettingsCard')") < cleanupSource.indexOf("$('athStatus')"), 'Settings cleanup does not recognize the released API card before the legacy #athStatus scaffold');
assert(/releasedCard\.hidden = false/.test(cleanupSource) && /releasedCard\.style\.removeProperty\('display'\)/.test(cleanupSource), 'Settings cleanup can leave the released API card hidden');
assert(/releasedCard[\s\S]*return false;[\s\S]*var status = \$\('athStatus'\)/.test(cleanupSource), 'Settings cleanup still replaces the released API card with legacy future-partnership copy');

for (const id of [
  'athStatus', 'athApiRedirectUri', 'athApiWritebackReason', 'athApiRefreshBtn',
  'athApiConnectBtn', 'athApiDisconnectBtn', 'athApiAuthorizeLink', 'athApiActionNote'
]) assert(settingsCard.includes(`id="${id}"`), `Settings Athena API card is missing #${id}`);
assert(/Preview \/ read-only/.test(settingsCard), 'Settings must label the Athena API as Preview/read-only');
assert(/secondary schedule-read path/.test(settingsCard) && /MLS Assist Today, Calendar, day, and month pulls remain available/.test(settingsCard), 'Settings does not preserve the extension schedule path');
assert(/Write-back disabled/.test(settingsCard), 'Settings does not state that write-back is disabled');
assert(!/write-back enabled|write notes? through|send notes? through|automatically write/i.test(settingsCard), 'Settings promises an Athena write capability');

for (const legacyId of ['ez3PullStart', 'ez3sPullToday', 'ez3PullRetry', 'ez3PullCancel', 'ez3sProv', 'ez3sPrep']) {
  assert(activeEasy.includes(legacyId), `Staff Prep lost existing extension control ${legacyId}`);
}
for (const label of ['Today', 'Tomorrow', 'This month', 'Last month', 'Custom range']) {
  assert(activeEasy.includes(`seg('${label === 'This month' ? 'month' : label === 'Last month' ? 'lastmonth' : label === 'Custom range' ? 'custom' : label.toLowerCase()}', '${label}')`), `Staff Prep lost ${label}`);
}
assert(staffSource.includes("state.verified && state.configured && state.connected && state.scheduleReadReady === true && state.connectionStatus === 'connected'"), 'API pull is not gated on verified Appointment schedule-read readiness');
assert(staffSource.includes('id="ez3sAthenaApiPull"') && staffSource.includes('id="ez3sAthenaApiCheck"'), 'Staff Prep secondary API controls are missing');
assert(staffSource.includes('mlsAthenaApiPullSchedule(opts)'), 'Staff Prep does not use the strict shared API schedule helper');
assert(staffSource.includes('fhirPractitionerVerified !== true') && staffSource.includes('/^Practitioner\\/[A-Za-z0-9.-]{1,128}$/'), 'Staff Prep guesses a practitioner instead of requiring a verified FHIR reference');
assert(staffSource.includes("S.providerFilter === '' && selected === 'all'") && staffSource.includes('providerGate.ok !== true'), 'Staff Prep does not distinguish explicit All providers from an unmapped specific doctor');
assert(staffSource.includes('id="ez3sAthenaApiProviderBlocked" disabled'), 'Staff Prep does not explain that a specific provider mapping is required');
assert(!/opts\.(?:patient|patientId|patient_id)|patient_external_id/.test(staffSource), 'Staff Prep passes a browser patient identifier into the API schedule pull');
assert(/failed closed\. MLS Assist was not started as a fallback/.test(staffSource), 'Staff Prep does not explicitly refuse a silent extension fallback');
assert(/Athena returned no appointments in the selected range/.test(staffSource), 'Staff Prep lacks honest zero-result API copy');

function element(id) {
  return {
    id, textContent: '', hidden: false, disabled: false, style: {}, href: '',
    setAttribute(name, value) { this[name] = String(value); },
    removeAttribute(name) { delete this[name]; }
  };
}

function response(status, json) {
  return { ok: status >= 200 && status < 300, status, async json() { return json; } };
}

function validStatus(overrides = {}) {
  return Object.assign({
    configured: true,
    scheduleReadReady: false,
    configurationIssue: null,
    vendor: 'athena',
    redirectUri: 'https://mls.example.test/smart/callback',
    connection: null,
    writeBack: { enabled: false, reason: 'No authoritative visit-to-EMR encounter binding.' },
    harmlessExtra: 'ignored'
  }, overrides);
}

function authorizeUrl(scope = 'openid user/Appointment.rs') {
  const u = new URL('https://ap25sandbox.fhirapi.athenahealth.com/demoAPIServer/oauth2/authorize');
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', 'preview-client');
  u.searchParams.set('redirect_uri', 'https://mls.example.test/smart/callback');
  u.searchParams.set('scope', scope);
  u.searchParams.set('state', 'exact-state');
  u.searchParams.set('aud', 'https://ap25sandbox.fhirapi.athenahealth.com/demoAPIServer');
  u.searchParams.set('code_challenge', 'challenge');
  u.searchParams.set('code_challenge_method', 'S256');
  return u.href;
}

function harness() {
  const elements = {};
  for (const id of [
    'athStatus', 'athApiRedirectUri', 'athApiWritebackReason', 'athApiRefreshBtn',
    'athApiConnectBtn', 'athApiDisconnectBtn', 'athApiAuthorizeLink', 'athApiActionNote'
  ]) elements[id] = element(id);
  const calls = [];
  const opens = [];
  const events = [];
  const queue = [];
  const calendarSnapshots = [];
  const timerActions = [];
  let confirmResult = false;
  let calendarOwner = 'user:calApptsCacheV2';
  const context = {
    console, URL, Date, Promise, CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
    setTimeout(fn) { const action = timerActions.shift(); if (typeof action === 'function') action(); fn(); return 1; },
    requestAnimationFrame(fn) { fn(Date.now()); return 1; },
    document: { getElementById: id => elements[id] || null },
    localStorage: { removeItem() {} },
    uns: value => value === 'calApptsCacheV2' ? calendarOwner : `user:${value}`,
    __hosted: false,
    backendMode: () => context.__hosted,
    bkToken: () => context.__hosted ? 'session-token' : '',
    bkBase: () => 'https://mls.example.test',
    async fetch(url, opts = {}) {
      calls.push({ url: String(url), opts });
      assert(queue.length, `Unexpected fetch ${url}`);
      return queue.shift();
    },
    dispatchEvent: ev => { events.push(ev); return true; },
    open(url, target, features) { opens.push({ url, target, features }); return {}; },
    confirm: () => confirmResult,
    /* 2026-07-22: disconnect now uses the non-blocking in-app dialog */
    mlsConfirm: () => Promise.resolve(confirmResult),
    loadCalendarCalls: 0,
    loadCalendarActive: 0,
    loadCalendarMaxActive: 0,
    _calAppts: [],
    async loadCalendar() {
      context.loadCalendarCalls += 1;
      context.loadCalendarActive += 1;
      context.loadCalendarMaxActive = Math.max(context.loadCalendarMaxActive, context.loadCalendarActive);
      try {
        if (calendarSnapshots.length) {
          const next = calendarSnapshots.shift();
          if (next instanceof Error) throw next;
          context._calAppts = typeof next === 'function' ? next(context) : next;
        }
        return { applied: true, authoritative: true, count: context._calAppts.length };
      } finally {
        context.loadCalendarActive -= 1;
      }
    },
    renderCalendar() {},
    updateNavCounts() {}
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(apiSource, context, { filename: 'athena-api-frontend.js' });
  return {
    context, elements, calls, opens, events, queue, calendarSnapshots, timerActions,
    setConfirm(value) { confirmResult = value; },
    setCalendarOwner(value) { calendarOwner = value; }
  };
}

async function run() {
  let selectedProvider = { name: 'Specific Doctor', fhirPractitionerVerified: false };
  const staffPulls = [];
  const staffContext = {
    Promise, String,
    S: { providerFilter: 'Specific Doctor' },
    activeProviderRequest: () => selectedProvider,
    staffRangeBounds: () => ({ from: '2026-07-18', to: '2026-07-18', label: 'Today' }),
    safe(fn, fallback) { try { return fn(); } catch (error) { return fallback; } },
    isFn: value => typeof value === 'function',
    mlsAthenaApiValidateRange: (from, to) => ({ ok: true, from, to }),
    mlsAthenaApiPullSchedule: opts => { staffPulls.push(opts); return Promise.resolve({ ok: false, error: 'synthetic_stop' }); },
    render() {},
    $() { return null; }
  };
  staffContext.window = staffContext;
  vm.createContext(staffContext);
  vm.runInContext(staffSource, staffContext, { filename: 'athena-api-staff-prep.js' });
  staffContext.pullStaffScheduleThroughAthenaApi();
  assert.strictEqual(staffPulls.length, 0, 'an unmapped specific doctor silently reached an all-provider API pull');
  selectedProvider = { name: 'Specific Doctor', fhirPractitionerVerified: true, fhirPractitioner: 'Practitioner/fhir-123' };
  staffContext.pullStaffScheduleThroughAthenaApi();
  assert.deepStrictEqual(JSON.parse(JSON.stringify(staffPulls[0])), { from: '2026-07-18', to: '2026-07-18', practitioner: 'Practitioner/fhir-123' });
  staffContext.S.providerFilter = '';
  selectedProvider = 'all';
  staffContext.pullStaffScheduleThroughAthenaApi();
  assert.deepStrictEqual(JSON.parse(JSON.stringify(staffPulls[1])), { from: '2026-07-18', to: '2026-07-18' }, 'explicit All providers did not omit practitioner cleanly');

  const h = harness();
  assert.strictEqual(h.calls.length, 0, 'Athena status fetched at script load');
  assert.strictEqual(h.opens.length, 0, 'Athena authorization opened at script load');

  await h.context.loadAthenaSettings();
  assert.strictEqual(h.calls.length, 0, 'demo/no-backend Settings visit made a network request');
  assert.strictEqual(h.context.mlsAthenaApiGetState().connected, false);
  assert(/Unavailable in demo mode/.test(h.elements.athStatus.textContent), 'demo UI implied an Athena connection');

  h.context.__hosted = true;
  h.queue.push(response(200, validStatus()));
  await h.context.loadAthenaSettings();
  assert.strictEqual(h.calls.length, 1);
  assert.strictEqual(h.calls[0].url, 'https://mls.example.test/smart/status');
  assert.strictEqual(h.calls[0].opts.method, 'GET');
  assert.strictEqual(h.calls[0].opts.headers.Authorization, 'Bearer session-token');
  assert.strictEqual(h.context.mlsAthenaApiGetState().verified, true);
  assert.strictEqual(h.context.mlsAthenaApiGetState().connected, false);
  assert.strictEqual(h.elements.athApiConnectBtn.hidden, false);
  assert.strictEqual(h.elements.athApiRedirectUri.textContent, 'https://mls.example.test/smart/callback');

  h.queue.push(response(200, { authorizeUrl: authorizeUrl(), ignored: true }));
  assert.strictEqual(await h.context.connectAthenaApi(), true);
  assert.strictEqual(h.calls.at(-1).url, 'https://mls.example.test/smart/connect');
  assert.strictEqual(h.opens.length, 1, 'explicit Connect did not open exactly one authorize URL');
  assert.strictEqual(h.opens[0].url, authorizeUrl());
  assert.strictEqual(h.opens[0].target, '_blank');

  h.queue.push(response(200, { authorizeUrl: authorizeUrl().replace('ap25sandbox.fhirapi.athenahealth.com', 'evil.example.test') }));
  assert.strictEqual(await h.context.connectAthenaApi(), false, 'non-Athena authorize host was accepted');
  assert.strictEqual(h.opens.length, 1, 'unsafe authorize URL opened a window');

  const allowedSystemScopeUrl = authorizeUrl('openid fhirUser offline_access launch launch/encounter system/*.s');
  assert.strictEqual(h.context._athenaApiAuthorizeUrl(allowedSystemScopeUrl), allowedSystemScopeUrl, 'read-only system wildcard search with allowed context scopes was refused');
  const unsafeScopes = [
    ['write-capable scope', 'openid user/Appointment.rs user/Patient.cruds'],
    ['legacy write scope', 'openid user/Appointment.write'],
    ['patient-only clinical scope', 'openid patient/Appointment.rs'],
    ['patient-launch context', 'openid launch/patient user/Appointment.rs'],
    ['missing Appointment permission', 'openid user/Patient.rs'],
    ['Appointment read without search', 'openid user/Appointment.r']
  ];
  for (const [label, scope] of unsafeScopes) {
    h.queue.push(response(200, { authorizeUrl: authorizeUrl(scope) }));
    assert.strictEqual(await h.context.connectAthenaApi(), false, `${label} was accepted`);
    assert.strictEqual(h.opens.length, 1, `${label} opened an authorization window`);
    assert.strictEqual(h.elements.athApiAuthorizeLink.hidden, true, `${label} exposed an authorization fallback link`);
  }

  h.queue.push(response(200, validStatus({ connection: { status: 'connected' }, scheduleReadReady: true })));
  await h.context.updateAthenaStatus('clinician-click');
  assert.strictEqual(h.context.mlsAthenaApiGetState().connected, true);
  assert.strictEqual(h.elements.athApiDisconnectBtn.hidden, false);
  assert(/verified read-only/.test(h.elements.athStatus.textContent));

  h.queue.push(response(200, validStatus({ connection: { status: 'connected' }, scheduleReadReady: false })));
  await h.context.updateAthenaStatus('clinician-click');
  assert.strictEqual(h.context.mlsAthenaApiGetState().oauthConnected, true, 'OAuth connection truth was lost');
  assert.strictEqual(h.context.mlsAthenaApiGetState().connected, false, 'OAuth-only connection implied usable schedule access');
  assert.strictEqual(h.context.mlsAthenaApiGetState().scheduleReadReady, false);
  assert.strictEqual(h.context.mlsAthenaApiGetState().connectionStatus, 'permission_required');
  assert(/Permission needed/.test(h.elements.athStatus.textContent), 'missing schedule scope did not render a permission-needed state');
  assert.strictEqual(h.elements.athApiConnectBtn.hidden, false, 'permission-needed state did not offer reconnect');
  assert.strictEqual(h.elements.athApiDisconnectBtn.hidden, false, 'OAuth-only connection could not be disconnected');
  const beforeInsufficientScopePull = h.calls.length;
  const insufficientScopePull = await h.context.mlsAthenaApiPullSchedule({ from: '2026-07-18', to: '2026-07-18' });
  assert.strictEqual(insufficientScopePull.ok, false);
  assert.strictEqual(insufficientScopePull.error, 'smart_not_connected');
  assert.strictEqual(h.calls.length, beforeInsufficientScopePull, 'OAuth-only connection reached the schedule endpoint without verified Appointment scope');

  h.queue.push(response(200, validStatus({ connection: { status: 'connected' }, scheduleReadReady: true })));
  await h.context.updateAthenaStatus('clinician-click');

  const beforeCancel = h.calls.length;
  h.setConfirm(false);
  assert.strictEqual(await h.context.disconnectAthenaApi(), false);
  assert.strictEqual(h.calls.length, beforeCancel, 'Disconnect called the server before local confirmation');
  h.setConfirm(true);
  h.queue.push(response(200, { ok: true, disconnected: true, deletedConnections: 1, deletedOauthStates: 0, ignored: true }));
  assert.strictEqual(await h.context.disconnectAthenaApi(), true);
  assert.strictEqual(h.calls.at(-1).opts.method, 'DELETE');
  assert.strictEqual(h.calls.at(-1).url, 'https://mls.example.test/smart/connection');
  assert.strictEqual(h.context.mlsAthenaApiGetState().connected, false);

  h.queue.push(response(200, Object.assign({}, validStatus(), { writeBack: undefined })));
  await h.context.updateAthenaStatus('clinician-click');
  assert.strictEqual(h.context.mlsAthenaApiGetState().verified, false, 'missing writeBack proof did not fail closed');
  assert.strictEqual(h.context.mlsAthenaApiGetState().connected, false);
  h.queue.push(response(200, Object.assign({}, validStatus(), { scheduleReadReady: undefined })));
  await h.context.updateAthenaStatus('clinician-click');
  assert.strictEqual(h.context.mlsAthenaApiGetState().verified, false, 'missing scheduleReadReady proof did not fail closed');
  assert.strictEqual(h.context.mlsAthenaApiGetState().connected, false);
  h.queue.push(response(200, validStatus({ connection: null, scheduleReadReady: true })));
  await h.context.updateAthenaStatus('clinician-click');
  assert.strictEqual(h.context.mlsAthenaApiGetState().verified, false, 'contradictory schedule-read readiness did not fail closed');
  assert.strictEqual(h.context.mlsAthenaApiGetState().connected, false);
  h.queue.push(response(200, validStatus({ connection: { status: 7 } })));
  await h.context.updateAthenaStatus('clinician-click');
  assert.strictEqual(h.context.mlsAthenaApiGetState().verified, false, 'malformed connection status did not fail closed');

  for (const redirectUri of [
    'https://attacker.example.test/smart/callback',
    'https://mls.example.test/not-smart/callback',
    'https://mls.example.test/smart/callback?forward=attacker'
  ]) {
    h.queue.push(response(200, validStatus({ redirectUri })));
    await h.context.updateAthenaStatus('clinician-click');
    assert.strictEqual(h.context.mlsAthenaApiGetState().verified, false, `unsafe redirect URI was trusted: ${redirectUri}`);
    assert.strictEqual(h.context.mlsAthenaApiGetState().connected, false, `unsafe redirect URI implied a connection: ${redirectUri}`);
    assert(/Unavailable/.test(h.elements.athStatus.textContent) && /exact MLS HTTPS \/smart\/callback redirect URI/.test(h.elements.athStatus.textContent), `unsafe redirect failure was hidden from the clinician: ${redirectUri}`);
  }

  h.queue.push(response(200, validStatus({ connection: { status: 'connected' }, scheduleReadReady: true })));
  await h.context.updateAthenaStatus('clinician-click');
  assert.strictEqual(h.context.mlsAthenaApiValidateRange('2026-02-30', '2026-02-30').ok, false);
  assert.strictEqual(h.context.mlsAthenaApiValidateRange('2026-07-18', '2026-07-17').ok, false);
  assert.strictEqual(h.context.mlsAthenaApiValidateRange('2026-07-01', '2026-07-31').ok, true);
  assert.strictEqual(h.context.mlsAthenaApiValidateRange('2026-07-01', '2026-08-01').ok, false);

  const scheduleReceipt = {
    ok: true, from: '2026-07-01', to: '2026-07-31', practitioner: null,
    appointments: 12, created: 8, updated: 4, pages: 2, includesSupported: true,
    harmlessExtra: { ignored: true }
  };
  h.calendarSnapshots.push([{ id: 'calendar-row-1', appt_date: '2026-07-18' }]);
  h.queue.push(response(200, scheduleReceipt));
  const pulled = await h.context.mlsAthenaApiPullSchedule({
    from: '2026-07-01', to: '2026-07-31', patientId: 'must-not-send', patient: { id: 'must-not-send' }
  });
  assert.strictEqual(pulled.ok, true);
  const scheduleCall = h.calls.at(-1);
  assert.strictEqual(scheduleCall.url, 'https://mls.example.test/api/emr-sync/schedule');
  assert.strictEqual(scheduleCall.opts.method, 'POST');
  assert.deepStrictEqual(JSON.parse(scheduleCall.opts.body), { from: '2026-07-01', to: '2026-07-31' });
  assert.strictEqual(h.context.loadCalendarCalls, 1, 'successful API pull did not refresh the normal calendar');
  assert.strictEqual(pulled.serverImported, true);
  assert.strictEqual(pulled.calendarVisible, true);
  assert.strictEqual(pulled.refreshAttempts, 1);
  assert.strictEqual(pulled.harmlessExtra, undefined, 'untrusted schedule receipt fields escaped the safe projection');

  h.context._calAppts = [];
  h.calendarSnapshots.push([], [{ id: 'eventual-row', day_local: '2026-08-02' }]);
  h.queue.push(response(200, {
    ok: true, from: '2026-08-01', to: '2026-08-03', practitioner: null,
    appointments: 1, created: 1, updated: 0, pages: 1, includesSupported: false
  }));
  const loadsBeforeStaleRecovery = h.context.loadCalendarCalls;
  const staleRecovered = await h.context.mlsAthenaApiPullSchedule({ from: '2026-08-01', to: '2026-08-03' });
  assert.strictEqual(staleRecovered.ok, true, 'a bounded fresh retry did not recover a stale first calendar read');
  assert.strictEqual(staleRecovered.refreshAttempts, 2);
  assert.strictEqual(h.context.loadCalendarCalls - loadsBeforeStaleRecovery, 2);
  assert.strictEqual(h.context.loadCalendarMaxActive, 1, 'calendar refresh retries overlapped');

  h.context._calAppts = [];
  h.calendarSnapshots.push(
    [{ id: 'vanishing-row', start_at: '2026-08-05T14:00:00.000Z' }],
    [{ id: 'stable-row', appt_date: '2026-08-05' }]
  );
  h.timerActions.push(() => { h.context._calAppts = []; });
  h.queue.push(response(200, {
    ok: true, from: '2026-08-05', to: '2026-08-05', practitioner: null,
    appointments: 1, created: 1, updated: 0, pages: 1, includesSupported: true
  }));
  const vanishedThenRecovered = await h.context.mlsAthenaApiPullSchedule({ from: '2026-08-05', to: '2026-08-05' });
  assert.strictEqual(vanishedThenRecovered.ok, true, 'a row that vanished during the stability check was accepted or never retried');
  assert.strictEqual(vanishedThenRecovered.refreshAttempts, 2);

  h.context._calAppts = [];
  h.calendarSnapshots.push(
    [{ id: 'outside-range', appt_date: '2026-09-01' }],
    new Error('synthetic calendar read failure'),
    []
  );
  h.queue.push(response(200, {
    ok: true, from: '2026-08-10', to: '2026-08-10', practitioner: null,
    appointments: 1, created: 1, updated: 0, pages: 1, includesSupported: false
  }));
  const unverified = await h.context.mlsAthenaApiPullSchedule({ from: '2026-08-10', to: '2026-08-10' });
  assert.strictEqual(unverified.ok, false);
  assert.strictEqual(unverified.serverImported, true);
  assert.strictEqual(unverified.calendarVisible, false);
  assert.strictEqual(unverified.refreshAttempts, 3);
  assert.strictEqual(unverified.error, 'athena_api_calendar_refresh_unverified');
  assert(/server import completed/.test(unverified.message) && /Do not pull again/.test(unverified.message), 'partial server success was described dishonestly');

  h.context._calAppts = [];
  h.calendarSnapshots.push([{ id: 'manual-row', appt_date: '2026-08-12' }]);
  h.queue.push(response(200, {
    ok: true, from: '2026-08-12', to: '2026-08-12', practitioner: null,
    appointments: 0, created: 0, updated: 0, pages: 1, includesSupported: false
  }));
  const zeroResult = await h.context.mlsAthenaApiPullSchedule({ from: '2026-08-12', to: '2026-08-12' });
  assert.strictEqual(zeroResult.ok, true, 'an authoritative zero-result receipt was treated as a failure');
  assert.strictEqual(zeroResult.calendarVisible, null);
  assert.strictEqual(zeroResult.refreshAttempts, 1);
  assert.strictEqual(h.context._calAppts[0].id, 'manual-row', 'zero-result pull deleted an existing MLS appointment');

  h.context._calAppts = [];
  h.calendarSnapshots.push(() => { h.setCalendarOwner('other-user:calApptsCacheV2'); return []; });
  h.queue.push(response(200, {
    ok: true, from: '2026-08-14', to: '2026-08-14', practitioner: null,
    appointments: 1, created: 1, updated: 0, pages: 1, includesSupported: false
  }));
  const ownerChanged = await h.context.mlsAthenaApiPullSchedule({ from: '2026-08-14', to: '2026-08-14' });
  assert.strictEqual(ownerChanged.ok, false);
  assert.strictEqual(ownerChanged.refreshAttempts, 1);
  assert(/account or server changed/.test(ownerChanged.message));
  h.setCalendarOwner('user:calApptsCacheV2');

  h.context._calAppts = [];
  h.calendarSnapshots.push([{ id: 'guarded-row', appt_date: '2026-08-16' }]);
  let releaseSchedule;
  h.queue.push(new Promise(resolve => { releaseSchedule = resolve; }));
  const callsBeforeConcurrent = h.calls.length;
  const firstConcurrent = h.context.mlsAthenaApiPullSchedule({ from: '2026-08-16', to: '2026-08-16' });
  await Promise.resolve();
  const secondConcurrent = await h.context.mlsAthenaApiPullSchedule({ from: '2026-08-16', to: '2026-08-16' });
  assert.strictEqual(secondConcurrent.error, 'athena_api_pull_running');
  releaseSchedule(response(200, {
    ok: true, from: '2026-08-16', to: '2026-08-16', practitioner: null,
    appointments: 1, created: 1, updated: 0, pages: 1, includesSupported: false
  }));
  assert.strictEqual((await firstConcurrent).ok, true);
  assert.strictEqual(h.calls.length - callsBeforeConcurrent, 1, 'concurrent pull guard allowed a second schedule POST');

  assert.strictEqual(h.context._athenaApiCalendarRowDate({ appt_date: '2026-08-17', day_local: '2026-08-18', start_at: '2026-08-19T23:00:00Z' }), '2026-08-17');
  assert.strictEqual(h.context._athenaApiCalendarRowDate({ day_local: '2026-08-18', start_at: '2026-08-19T23:00:00Z' }), '2026-08-18');
  assert.strictEqual(h.context._athenaApiCalendarRowDate({ start_at: '2026-08-19T23:00:00Z' }), '2026-08-19');

  const beforeInvalidPractitioner = h.calls.length;
  const badPractitioner = await h.context.mlsAthenaApiPullSchedule({ from: '2026-07-18', to: '2026-07-18', practitioner: '123' });
  assert.strictEqual(badPractitioner.ok, false);
  assert.strictEqual(h.calls.length, beforeInvalidPractitioner, 'invalid practitioner reached the server');

  h.queue.push(response(200, { ok: true, from: '2026-07-18', to: '2026-07-18', practitioner: null, appointments: 1, created: 1, updated: 0, includesSupported: false }));
  const malformed = await h.context.mlsAthenaApiPullSchedule({ from: '2026-07-18', to: '2026-07-18' });
  assert.strictEqual(malformed.ok, false, 'missing schedule receipt fields were accepted');
  assert.strictEqual(malformed.error, 'athena_api_schedule_invalid_response');

  h.queue.push(response(200, { ok: true, from: '2026-07-18', to: '2026-07-18', practitioner: null, appointments: 1, created: 0, updated: 0, pages: 1, includesSupported: false }));
  const inconsistentCounts = await h.context.mlsAthenaApiPullSchedule({ from: '2026-07-18', to: '2026-07-18' });
  assert.strictEqual(inconsistentCounts.error, 'athena_api_schedule_invalid_response', 'appointments !== created + updated was accepted');

  h.queue.push(response(200, { ok: true, from: '2026-07-18', to: '2026-07-18', practitioner: null, appointments: 1, created: 1, updated: 0, pages: 1, includesSupported: false }));
  const practitionerMismatch = await h.context.mlsAthenaApiPullSchedule({ from: '2026-07-18', to: '2026-07-18', practitioner: 'Practitioner/fhir-123' });
  assert.strictEqual(practitionerMismatch.error, 'athena_api_schedule_invalid_response', 'provider-scoped pull accepted an all-provider receipt');

  assert(!/pullScheduleViaAssist|mlsAppPull|postMessage/.test(apiSource), 'API helper silently falls back to the extension');
  assert(!/setInterval|DOMContentLoaded|addEventListener\(['"]load/.test(apiSource), 'Athena API status/pull installed passive startup work');
  console.log('PASS Athena FHIR frontend fallback: click-only status/connect, exact URL, confirmed disconnect, strict schedule range/body/receipt, and Staff Prep coexistence');
}

run().catch(error => { console.error(error); process.exit(1); });
