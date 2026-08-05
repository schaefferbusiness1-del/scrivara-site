'use strict';
/*
 * COPILOT POWER — SENSES + THE ABSOLUTE WIRE CAP (cpw-1.0.0)
 * -----------------------------------------------------------------------------
 * Two claims, both executed rather than grepped:
 *
 * 1. copilotSnapshot() gains providerCoverage (verified roster spellings,
 *    per-provider local-data counts, who has NO local data) and capabilities
 *    (the action kinds the app really executes) — the data the model needs to
 *    say "I don't have Dr. X — want me to pull them?" instead of guessing.
 *
 * 2. The /api/copilot request body is bounded ABSOLUTELY, through the actual
 *    loaded fetch wrapper on the whole request (not a helper on a fixture —
 *    the relative-guard lesson): oversized bodies come back under the cap as
 *    VALID JSON with the active patient kept; small bodies pass byte-identical;
 *    unparseable bodies pass through untouched rather than crashing the send.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'feat_mls_copilot_power.js'), 'utf8');

assert(source.includes("var VERSION = 'cpw-1.1.0'"), 'version token moved without updating this contract');
assert(!source.includes('setInterval('), 'no permanent polling in the Power module');
assert(!source.includes('MutationObserver'), 'no document-wide observers in the Power module');

function freshContext() {
  const fetchCalls = [];
  const window = {
    addEventListener() {}, removeEventListener() {},
    fetch: function (input, init) { fetchCalls.push({ input, init }); return Promise.resolve({ ok: true }); },
    copilotSnapshot: function () { return { today: '2026-08-05', patients: [{ id: 'p1' }] }; },
    __mlsProviderRoster: {
      list: () => [
        { name: 'Smith, Adam', stableKey: 'athena:smith, adam', rosterVerified: true },
        { name: 'Jones, Beth', stableKey: 'athena:jones, beth', rosterVerified: true }
      ],
      getReceipt: () => ({ complete: true })
    },
    _calAppts: [{ provider: 'Smith, Adam' }, { provider: 'Smith, Adam' }],
    /* cpw-1.1.0: coverage comes from the providerStats computer — the only
       source with real pulled-chart attribution (patient.provider has NO
       writer in the app and reported the whole roster as data-less). */
    __mlsCopilotData: {
      computeStats: () => ({ providers: [
        { provider: 'Smith, Adam', totalAppointments: 34, patientsWithPulledCharts: 12 },
        { provider: 'Jones, Beth', totalAppointments: 9, patientsWithPulledCharts: 0 }
      ] })
    },
    getPatients: () => [{ id: 'p1', visits: [{}, {}] }],
    __mlsPullLastOutcome: { ok: true, at: 1754400000000 }
  };
  const context = { window, document: { readyState: 'complete', addEventListener() {} }, console };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'feat_mls_copilot_power.js' });
  return { window, fetchCalls };
}

/* ---- 1. snapshot senses ---- */
{
  const { window } = freshContext();
  assert.strictEqual(window.__mlsCopilotPower.version, 'cpw-1.1.0');
  const snap = window.copilotSnapshot();
  assert(snap.providerCoverage, 'snapshot gained no providerCoverage');
  assert.strictEqual(snap.providerCoverage.rosterComplete, true);
  assert.strictEqual(snap.providerCoverage.countsKnown, true);
  /* JSON round-trip: VM-realm arrays fail deepStrictEqual prototype identity. */
  const names = JSON.parse(JSON.stringify(snap.providerCoverage.providers.map(p => p.name)));
  assert.deepStrictEqual(names, ['Smith, Adam', 'Jones, Beth'], 'roster spellings must pass through exactly');
  const smith = snap.providerCoverage.providers[0];
  assert.strictEqual(smith.pulledChartPatients, 12, 'pulled-chart counts come from the providerStats computer');
  assert.strictEqual(smith.appointmentsKnown, 34);
  assert.strictEqual(smith.hasLocalData, true);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(snap.providerCoverage.providersWithNoLocalData)), ['Jones, Beth'],
    'the provider with no pulled charts must be named — that is the gap-offer trigger');
  assert(snap.capabilities && snap.capabilities.actions.includes('pullProviders') && snap.capabilities.actions.includes('draftNote'));
  assert(snap.patients && snap.patients.length === 1, 'the base snapshot must survive the wrapper');
}

/* ---- 1b. NO stats source -> coverage refuses to accuse anyone of missing
   data. The 1.0.0 defect was exactly this lie: a count keyed off a field no
   writer sets called the WHOLE roster data-less. ---- */
{
  const { window } = freshContext();
  delete window.__mlsCopilotData;
  const snap = window.copilotSnapshot();
  assert.strictEqual(snap.providerCoverage.countsKnown, false);
  assert.strictEqual(snap.providerCoverage.providersWithNoLocalData.length, 0,
    'without real counts, NO provider may be reported as missing data');
  assert.match(snap.providerCoverage.note, /do NOT claim/i, 'the note must tell the model counts are unavailable');
}

/* ---- 2. absolute wire cap through the loaded wrapper ---- */
{
  const { window, fetchCalls } = freshContext();
  const patients = [];
  for (let i = 0; i < 1500; i++) {
    patients.push({ id: 'p-' + i, name: 'Patient ' + i, summary: 'clinical detail '.repeat(40) });
  }
  const payload = {
    question: 'make me a monthly pay schedule',
    context: {
      activePatient: { id: 'p-900', name: 'Patient 900' },
      activeVisit: { patient: { id: 'p-900' } },
      patients,
      appointments: Array.from({ length: 300 }, (_, i) => ({ id: 'a' + i, provider: 'Smith, Adam' }))
    },
    history: []
  };
  const body = JSON.stringify(payload);
  assert(body.length > 120000, 'fixture must exceed the wire cap, or this test proves nothing');
  window.fetch('/api/copilot', { method: 'POST', body });
  assert.strictEqual(fetchCalls.length, 1);
  const sent = fetchCalls[0].init.body;
  assert(sent.length <= 120000, 'the wire cap is absolute; sent ' + sent.length);
  const parsed = JSON.parse(sent); /* throws = malformed JSON reached the wire */
  assert.strictEqual(parsed.context.activePatient.id, 'p-900', 'the active patient must survive every shrink rung');
  assert.strictEqual(parsed.question, 'make me a monthly pay schedule');
  assert(parsed.context.contextWireBound, 'a shrunk body must carry its receipt');

  /* small body: byte-identical pass-through */
  const small = JSON.stringify({ question: 'hi', context: { activePatient: { id: 'p1' } } });
  window.fetch('/api/copilot', { method: 'POST', body: small });
  assert.strictEqual(fetchCalls[1].init.body, small, 'small bodies must pass byte-identical');

  /* unparseable body: untouched, not crashed */
  const junk = 'x'.repeat(130001);
  window.fetch('/api/copilot', { method: 'POST', body: junk });
  assert.strictEqual(fetchCalls[2].init.body, junk, 'an unparseable body passes through untouched');

  /* non-copilot URL: untouched even when huge */
  window.fetch('/api/appointments', { method: 'POST', body });
  assert.strictEqual(fetchCalls[3].init.body, body, 'other endpoints are never rewritten');
}

/* ---- 3. revert restores the previous owners ---- */
{
  const { window } = freshContext();
  const wrappedSnap = window.copilotSnapshot, wrappedFetch = window.fetch;
  assert(wrappedSnap.__cpw && wrappedFetch.__cpw);
  window.__mlsCopilotPower.revert();
  assert(!window.copilotSnapshot.__cpw, 'revert must restore the previous snapshot owner');
  assert(!window.fetch.__cpw, 'revert must restore the previous fetch owner');
}

console.log('PASS Copilot Power: snapshot senses are honest and the /api/copilot wire cap is absolute');
