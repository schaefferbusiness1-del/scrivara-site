'use strict';
/* ===== provider-day pull contract ========================================
   CONTRACT CHANGE: dayfacts-1.0.0 — the superseding owner DAY contract of
   2026-08-25 (Codex-accepted). Read this before wondering why the old pins
   moved.

   Until 2026-08-25 the "Full visit notes" checkbox decided WHETHER any chart
   opened at all: OFF meant a schedule-only pull, and this suite pinned that
   ("Schedule-only complete", historyReceipt.skipped === true, reason
   "full-notes-off", zero Athena chart reads). The owner revoked that meaning.
   The checkbox now decides only HOW MUCH history a bulk pull traverses:

     ON      visitNotesMode "full"      — the mandatory floor PLUS every other
                                          dated historical encounter body.
     OFF     visitNotesMode "day-facts" — the mandatory floor ONLY: the
             (settled)                    per-patient batch RUNS, every exact
                                          scheduled row gets its identity-
                                          verified chart open + chart-facts
                                          save, historical bodies are skipped
                                          (one.visitsSkipped === true), and the
                                          tn/onlyDate tail pass attempts
                                          exactly the pulled-day encounter
                                          note. Receipt carries
                                          chartFactsRequired:true,
                                          allVisitBodiesRequested:false and the
                                          honest insurance placeholders
                                          (insuranceAttempted 0, reason
                                          "reader-not-shipped").
     UNSET   visitNotesMode              — fail-closed. The batch returns a
             (unsettled) "blocked-unchosen"  blocked receipt, reason
                                          "visit-notes-unchosen", ZERO reads.

   pullUnlocked's includeHistory now means "run the batch at all" and is
   decoupled from the checkbox; only the census phase-1 caller passes false.
   The old "visit-notes-off" schedule-only no-op is REMOVED and must not be
   reasserted. No user-facing message may claim that OFF opens no charts.

   Every assertion below that used to prove "OFF reads nothing" has been
   replaced by its new-contract equivalent, never deleted. Two adversarial
   halves survive intact and must keep failing when broken:
     (a) OFF still performs NO historical visit-body traversal, and
     (b) an unchosen account still gets NOTHING read on its behalf.

   dayfacts-1.0.1 (2026-08-25, same day): the two pulled-day-note lanes that
   1.0.0 left fused OFF are now ENABLED, so the third mandatory element of the
   OFF contract is no longer a documented gap - it is MEASURED here. This
   round replaced the round-1 forward-compatible subset with positive proof:
     - the inline fold-in and the tn/onlyDate tail pass both run, so a
       day-facts row really issues vp.runForPatient({onlyDate: <pulled day>});
       scopedNoteCalls is counted, not merely shape-checked;
     - the receipt's own chart-open ledger must show BOTH doors (history 1 +
       dayNote 1 = 2 for one row) - the old total===1 pin was written when the
       day-note door never opened;
     - tnAggregate's checkbox short-circuit is gone, so an OFF receipt must
       report todayNoteRead 1 / todayNoteNotRequested 0, never "not requested";
     - pullCalendarSelection no longer ANDs the bodies checkbox into its own
       includeHistory, so even an EXPLICIT pullVisitBodies:false through that
       door runs the mandatory day-facts batch (section 2b, adversarial);
     - retryFailedHistory admits an OFF receipt's retry rows in day-facts mode
       instead of discarding them as "full-notes-off" (section 4b).
   One element of the 1.0.1 delta is NOT in these bytes and is reported as an
   engine finding rather than pinned - see the TODO at section 4b's tail.
   ========================================================================= */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const siSource = fs.readFileSync(path.join(root, 'feat_mls_schedimport_exact.js'), 'utf8');
const calSource = fs.readFileSync(path.join(root, 'feat_mls_calendar_polish.js'), 'utf8');
const loaderSource = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');
const stagingLoaderSource = fs.readFileSync(path.join(root, 'mls-connect.staging.js'), 'utf8');
const providerLabelSource = fs.readFileSync(path.join(root, 'feat_mls_provider_label.js'), 'utf8');
const findDoctorsSource = fs.readFileSync(path.join(root, 'feat_mls_find_doctors.js'), 'utf8');

for (const marker of [
  'function scopeProviderRows',
  'receipt.unattributedRows > 0',
  'providerReason === "provider-incomplete"',
  'pullCalendarSelection',
  'var frozenProvider =',
  'var frozenDate =',
  'provider: frozenProvider',
  'opts.includeHistory !== false',
  'exactIdentityVerified',
  'historyReceipt.complete && historyReceipt.exactIdentityVerified === true'
]) assert(siSource.includes(marker), `missing fail-closed provider-day invariant: ${marker}`);

/* dayfacts-1.0.0 invariants, in the engine bytes. These are the pins that
   replaced the schedule-only ones; a revert to the old coupling deletes them. */
for (const marker of [
  'visitNotesMode: visitNotesRequested ? "full" : "day-facts"',
  'chartFactsRequired: chartFactsRequired, allVisitBodiesRequested: allVisitBodiesRequested',
  'insuranceAttempted: 0, insuranceComplete: false, benefitsComplete: false, insuranceReason: "reader-not-shipped"',
  'receipt.reason = "visit-notes-unchosen";',
  'receipt.visitNotesMode = "blocked-unchosen";',
  'choice.settled === true && (choice.state === "on" || choice.state === "off")',
  'var includeHistory = opts.includeHistory !== false;'
]) assert(siSource.includes(marker), `dayfacts-1.0.0: missing day-facts/fail-closed invariant: ${marker}`);

/* dayfacts-1.0.1 invariants: the pulled-day-note lanes are ENABLED, the
   Calendar door is decoupled from the checkbox, and the retired vocabulary is
   gone from the engine bytes. Re-fusing either lane, or restoring either AND,
   is a silent revert of the third mandatory element of the OFF contract, so
   each of these is pinned in BOTH directions. */
for (const marker of [
  'var pulledDayNoteLaneEnabled = true;',
  'var pulledDayNoteTailEnabled = true;',
  'receipt.todayNoteNotRequested = 0;',
  'p.todayNoteReason = "stopped-by-user";'
]) assert(siSource.includes(marker), `dayfacts-1.0.1: missing enabled-day-note-lane invariant: ${marker}`);
for (const revoked of [
  'var pulledDayNoteLaneEnabled = false;',
  'var pulledDayNoteTailEnabled = false;',
  'opts.includeHistory !== false && calendarPullVisitBodies !== false',
  'full-notes-off'
]) assert(!siSource.includes(revoked), `dayfacts-1.0.1: revoked byte reasserted in the engine: ${revoked}`);

assert(!siSource.includes('receipt.reason = "visit-notes-off";'),
  'dayfacts-1.0.0: the schedule-only "visit-notes-off" batch no-op is revoked and must not be reasserted');
assert(!siSource.includes('no patient charts or visit notes were opened'),
  'dayfacts-1.0.0: no user-facing message may claim that Full-notes-OFF opens no charts');
assert(siSource.includes('each day saved chart facts and attempted only its own pulled-day note'),
  'dayfacts-1.0.0: the month-complete OFF message must state chart facts + own-day note only');

assert(!siSource.includes('want.split(/[ ,]/)[0]'), 'provider scope must not use first-token substring matching');
assert(!siSource.includes('if (scoped.length) appts = scoped'), 'explicit provider scope must never fall back to all rows');
assert(calSource.includes('id="\' + PULL_ID + \'"'), 'calendar roster must render a selected-provider pull action');
assert(calSource.includes('api.pullCalendarSelection'), 'calendar action must route through the verified provider-day pipeline');
assert(!calSource.includes('Also pull &amp;amp; verify full history/visits'), '2026-07-28: the calendar history checkbox is retired - a provider-day pull always verifies history');
assert(calSource.includes('the calendar checkbox for this preference is') && /function includeHistory\(\) \{[\s\S]{0,700}?return true;\s*\}/.test(calSource), '2026-07-28: includeHistory is hard-true and must IGNORE the legacy stored 0 (honoring it would strand opted-out accounts in schedule-only mode with no control left)');
assert(calSource.includes('includeHistory: withHistory'), 'calendar UI must freeze and route the checkbox value into the exact pull');
/* dayfacts-1.0.0 replaces the old "unchecked mode must report an honest
   schedule-only result" pin. There is no schedule-only mode to report any
   more: the calendar Pull button must hand the exact pull NO bodies boolean
   at all, so the engine's admission gate freezes the clinician's settled
   choice and the mandatory day-facts floor runs either way. A regression that
   re-derives an opt-out from the checkbox here reintroduces the revoked
   schedule-only pull and trips this. */
assert(!calSource.includes('pullVisitBodies'),
  'dayfacts-1.0.0: the calendar pull must never hand the engine a checkbox-derived bodies opt-out');

/* mls-connect: the pulled-day encounter note is admitted in BOTH settled
   modes, scoped to one well-formed YYYY-MM-DD; unscoped reads still require
   ON, and an UNCHOSEN account is skipped with its own honest reason. */
for (const marker of [
  'var dayScoped = !!(runOpts &&',
  'if (!enabled() && !(dayScoped && choiceSettled))',
  "skipped: choiceSettled ? 'preference-off' : 'preference-unchosen'"
]) assert(loaderSource.includes(marker), `dayfacts-1.0.0: mls-connect runForPatient tri-state marker missing: ${marker}`);

/* dayfacts-1.0.1, host half: the legacy _pullAllHistories wrapper is the ONE
   place in the loader that still refuses on an OFF preference, and its refusal
   must be scoped to HISTORICAL bodies - it may never tell the clinician that
   OFF opens no charts, because the guarded engine's day-facts pull opens every
   one of them. */
assert(loaderSource.includes("reason: 'historical-bodies-not-requested'"),
  'dayfacts-1.0.1: the legacy history wrapper must name its refusal after HISTORICAL bodies, not the checkbox');
assert(!loaderSource.includes("reason: 'visit-notes-off', visitNotesRequested: false, historiesRequested: 0"),
  'dayfacts-1.0.1: the retired "visit-notes-off" wrapper refusal must not come back');
assert(!/no patient charts or visit notes were opened/i.test(loaderSource),
  'dayfacts-1.0.1: no loader message may claim that Full-notes-OFF opens no charts');
assert(loaderSource.includes('Historical visit notes were skipped by choice'),
  'dayfacts-1.0.1: the OFF day-completion message must say historical notes only were skipped');
/* ASCII-only halves on purpose: the shipped string carries a curly-apostrophe escape in
   the source bytes, and a smart quote in a test constant is how a latin1
   writer turns a pin into a control byte. */
assert(loaderSource.includes('chart facts and each day') && loaderSource.includes('own note were read'),
  'dayfacts-1.0.1: the OFF day-completion message must credit the chart facts and the own-day note it really read');

assert(loaderSource.includes("var A='feat_mls_schedimport_exact.js',V='si-1.7.22-p1-census1'") &&
  loaderSource.includes("s.src='feat_mls_schedimport_exact.js?v='+(window.__MLS_AV||'p1-preview')"),
  'production loader must own the promoted exact importer version and use the shared build cache-buster with a deterministic pre-build fallback');
assert(stagingLoaderSource.includes("feat_mls_schedimport_exact.js?v='+(window.__MLS_AV||Date.now())"), 'staging loader must use the shared cache-buster for the exact provider/day/month history importer');
assert(loaderSource.includes('A+"?v="+(window.__MLS_AV||Date.now())'), 'production loader must use the shared cache-buster for the canonical calendar provider pull UI');

// Every roster normalizer runs before a provider-day pull. None may erase a
// stable identity merely because two clinicians share the same display name.
function assertStableRosterNormalization(source, apiName, includeRawEcho) {
  const roster = [
    { id: '7', name: 'Matthew Schaeffer, MD' },
    { id: '10', name: 'Matthew Schaeffer, MD' }
  ];
  if (includeRawEcho) roster.push('Matthew Schaeffer, MD');
  const ctx = {
    console, _calProviders: roster,
    document: { readyState: 'loading', addEventListener: () => {}, querySelectorAll: () => [], querySelector: () => null },
    setTimeout: () => 1, clearTimeout: () => {}, setInterval: () => 1, clearInterval: () => {},
    MutationObserver: function () { this.observe = () => {}; this.disconnect = () => {}; }
  };
  ctx.window = ctx;
  vm.runInNewContext(source, ctx, { filename: apiName + '.js', timeout: 1000 });
  ctx[apiName].normalize();
  assert.deepStrictEqual(Array.from(ctx._calProviders.filter(p => p && p.id != null), p => String(p.id)), ['7', '10']);
  if (includeRawEcho) assert.strictEqual(ctx._calProviders.length, 2, 'id-less roster echo should collapse into the stable API entries');
}
assertStableRosterNormalization(providerLabelSource, '__mlsProviderLabel', false);
assertStableRosterNormalization(findDoctorsSource, '__mlsFindDoctors', true);

const nodes = {
  calProvFilter: { value: '7' },
  calDayPanel: { style: { display: 'block' } }
};
const context = {
  console,
  Promise,
  Date,
  Math,
  JSON,
  Intl,
  Object,
  Array,
  String,
  Number,
  RegExp,
  setTimeout,
  clearTimeout,
  setInterval: () => 1,
  clearInterval: () => {},
  location: { pathname: '/ScribeFlow-staging.html' },
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  document: {
    readyState: 'complete',
    querySelectorAll: () => [],
    querySelector: () => null,
    getElementById: id => nodes[id] || null,
    addEventListener: () => {},
    body: {}, head: {}, documentElement: {}
  },
  _calMode: 'day',
  _calRefDate: '2026-07-15',
  _calSelDay: '2026-07-16',
  _calProviders: [
    { id: 7, name: 'Matthew Schaeffer, MD' },
    { id: 8, name: 'Michael Schaeffer, MD' }
  ],
  addEventListener: () => {},
  removeEventListener: () => {},
  postMessage: () => {}
};
context.window = context;
context.__mlsProviderRoster = {
  list: () => context._calProviders.map(p => Object.assign({ stableKey: `backend:${p.id}`, rosterVerified: true }, p)),
  getReceipt: () => ({ complete: true, partial: false, reason: 'complete' }),
  resolve: ref => {
    let raw = ref && typeof ref === 'object' ? (ref.stableKey || ref.id || ref.name || '') : String(ref || '');
    if (String(raw).startsWith('pv:')) raw = decodeURIComponent(String(raw).slice(3));
    const hits = context._calProviders.filter(p => String(p.id) === String(raw) || `backend:${p.id}` === String(raw) || String(p.name).toLowerCase() === String(raw).toLowerCase());
    return hits.length === 1 ? Object.assign({ stableKey: `backend:${hits[0].id}`, rosterVerified: true }, hits[0]) : null;
  }
};
vm.runInNewContext(siSource, context, { filename: 'feat_mls_schedimport_exact.js', timeout: 1000 });

const api = context.__mlsSI;
assert(api && typeof api._providerKey === 'function');
assert.strictEqual(api._providerKey('Schaeffer_Matthew_MD'), api._providerKey('Matthew Schaeffer, MD'));
assert.strictEqual(api._providerKey('Schaeffer, Matthew'), api._providerKey('Dr. Matthew Schaeffer DO'));
assert.notStrictEqual(api._providerKey('Matthew Schaeffer, MD'), api._providerKey('Michael Schaeffer, MD'));
assert.strictEqual(api._providerKey('Schaeffer'), '', 'single-token provider labels are ambiguous');

const fullResponse = {
  receipt: { complete: true, authoritativeEmpty: false },
  providers: ['Matthew Schaeffer, MD', 'Michael Schaeffer, MD'],
  providerDiag: { providerNames: ['Matthew Schaeffer, MD', 'Michael Schaeffer, MD'] }
};
const mixedRows = [
  { name: 'Patient One', provider: 'Schaeffer_Matthew_MD' },
  { name: 'Patient Two', provider: 'Michael Schaeffer, MD' },
  { name: 'Patient Three', provider: 'Matthew Schaeffer, DO' }
];
const exact = api._scopeProviderRows(mixedRows, { id: '7', name: 'Matthew Schaeffer, MD' }, fullResponse);
assert.strictEqual(exact.complete, true);
assert.strictEqual(exact.rows.length, 2);
assert(exact.rows.every(r => /Matthew|Schaeffer_Matthew/.test(r.provider)));
assert.strictEqual(exact.receipt.sourceRows, 3);
assert.strictEqual(exact.receipt.providerTaggedRows, 3);
assert.strictEqual(exact.receipt.matchingRows, 2);
assert.strictEqual(exact.receipt.mismatchedRows, 1);
assert.strictEqual(exact.receipt.unattributedRows, 0);

const partial = api._scopeProviderRows(
  mixedRows.concat([{ name: 'Patient Four', provider: '' }]),
  { id: '7', name: 'Matthew Schaeffer, MD' },
  fullResponse
);
assert.strictEqual(partial.complete, false);
assert.strictEqual(partial.reason, 'provider-incomplete');
assert.strictEqual(partial.rows.length, 0, 'partial provider attribution must import nothing');
assert.strictEqual(partial.receipt.unattributedRows, 1);

const absent = api._scopeProviderRows(
  [{ name: 'Patient Two', provider: 'Michael Schaeffer, MD' }],
  { id: '9', name: 'Amanda Carter, MD' },
  { receipt: { complete: true }, providers: ['Michael Schaeffer, MD'] }
);
assert.strictEqual(absent.complete, false);
assert.strictEqual(absent.reason, 'provider-not-found');
assert.strictEqual(absent.rows.length, 0, 'zero matches must never widen to every provider');

const provenEmpty = api._scopeProviderRows(
  [{ name: 'Patient Two', provider: 'Michael Schaeffer, MD' }],
  { id: '7', name: 'Matthew Schaeffer, MD' },
  { receipt: { complete: true }, providers: ['Matthew Schaeffer, MD', 'Michael Schaeffer, MD'] }
);
assert.strictEqual(provenEmpty.complete, true);
assert.strictEqual(provenEmpty.reason, 'provider-empty');
assert.strictEqual(provenEmpty.rows.length, 0);

const rosterProvenEmpty = api._scopeProviderRows(
  [{ name: 'Patient Two', provider: 'Michael Schaeffer, MD' }],
  { id: '7', name: 'Matthew Schaeffer, MD', rosterVerified: true },
  { receipt: { complete: true }, providers: ['Michael Schaeffer, MD'] }
);
assert.strictEqual(rosterProvenEmpty.complete, true, 'an exact calendar roster ID plus a fully attributed day proves a selected-provider empty day');
assert.strictEqual(rosterProvenEmpty.reason, 'provider-empty');
assert.strictEqual(rosterProvenEmpty.receipt.rosterVerified, true);

const noReceipt = api._scopeProviderRows(mixedRows, 'Matthew Schaeffer, MD', { providers: ['Matthew Schaeffer, MD'] });
assert.strictEqual(noReceipt.complete, false);
assert.strictEqual(noReceipt.reason, 'provider-unverified');

const all = api._scopeProviderRows(mixedRows, 'all', { receipt: { complete: true }, providers: fullResponse.providers });
assert.strictEqual(all.complete, true);
assert.strictEqual(all.rows.length, mixedRows.length);
assert.strictEqual(all.rows[0].provider, 'Schaeffer_Matthew_MD');
assert.strictEqual(all.rows[1].provider, 'Michael Schaeffer, MD');
const allUnverified = api._scopeProviderRows(mixedRows, 'all', null);
assert.strictEqual(allUnverified.complete, false, 'all-provider day scope requires a complete schedule receipt');

// Stable provider ids must remain authoritative even when two clinicians have
// the exact same display name. A name-token match may never widen one selected
// provider into the other provider's patients.
const duplicateNameProvider = { id: '7', stableKey: 'backend:7', name: 'Alex Morgan, MD', raw: 'Morgan_Alex_MD', rosterVerified: true };
const duplicateNameRows = [
  { name: 'Provider Seven Patient', provider: 'Alex Morgan, MD', providerId: '7' },
  { name: 'Provider Eight Patient', provider: 'Alex Morgan, MD', providerId: '8' }
];
const duplicateNameScoped = api._scopeProviderRows(duplicateNameRows, duplicateNameProvider, { receipt: { complete: true }, providers: ['Alex Morgan, MD'] });
assert.strictEqual(duplicateNameScoped.complete, true);
assert.deepStrictEqual(Array.from(duplicateNameScoped.rows, row => row.name), ['Provider Seven Patient'], 'same-name provider id isolation widened to the wrong clinician');
const duplicateNameMissingId = api._scopeProviderRows([{ name: 'Unproven Patient', provider: 'Alex Morgan, MD' }], duplicateNameProvider, { receipt: { complete: true }, providers: ['Alex Morgan, MD'] });
assert.strictEqual(duplicateNameMissingId.complete, false, 'id-less same-name row was guessed into a stable-id provider pull');
assert.strictEqual(duplicateNameMissingId.reason, 'provider-incomplete');

let selection = api.calendarSelection();
assert.strictEqual(selection.ok, true);
assert.strictEqual(selection.date, '2026-07-15');
assert.strictEqual(selection.provider.id, '7');
assert.strictEqual(selection.provider.name, 'Matthew Schaeffer, MD');

nodes.calProvFilter.value = '';
selection = api.calendarSelection();
assert.strictEqual(selection.ok, false);
assert.strictEqual(selection.reason, 'provider-required');

nodes.calProvFilter.value = '7';
context._calMode = 'month';
nodes.calDayPanel.style.display = 'none';
selection = api.calendarSelection();
assert.strictEqual(selection.ok, false);
assert.strictEqual(selection.reason, 'date-required');

nodes.calDayPanel.style.display = 'block';
selection = api.calendarSelection();
assert.strictEqual(selection.ok, true);
assert.strictEqual(selection.date, '2026-07-16');

context._calProviders.push({ id: 10, name: 'Schaeffer_Matthew_DO' });
selection = api.calendarSelection();
assert.strictEqual(selection.ok, false);
assert.strictEqual(selection.reason, 'provider-ambiguous');

(async () => {
  const listeners = new Set();
  const store = new Map();
  const posted = [];
  const savedBodies = [];
  /* dayfacts-1.0.0: every Athena read the day-facts contract talks about is
     counted here, so "the chart DID open" and "no historical body was read"
     are measurements, not inferences. */
  const chartReadCalls = [];
  const chartSaveCalls = [];
  const scopedNoteCalls = [];
  function withWatchdog(promise, label, ms = 15000) {
    let timer = null;
    return Promise.race([
      Promise.resolve(promise),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} did not settle within ${ms}ms`)), ms); })
    ]).finally(() => { if (timer != null) clearTimeout(timer); });
  }
  const patient = { id: 'p-provider-1', name: 'Exact Patient', dob: '01/02/1960', visits: [] };
  /* The ON (full) day and the OFF (day-facts) day are deliberately DIFFERENT
     days. rsk-1.0.0 completes a row without a second Athena read when this
     same account day already proved and stored it, so reusing one day would
     have let the day-facts pull "pass" while opening nothing. */
  const FULL_DAY = '2026-07-15';
  const DAY_FACTS_DAY = '2026-07-16';
  const CENSUS_DAY = '2026-07-17';
  /* NOT 2026-07-14: that is the stale-request date the bridge fixture emits to
     prove correlation ids are honoured, and reusing it would let a mis-routed
     reply masquerade as this day's schedule. */
  const EXPLICIT_OFF_DAY = '2026-07-13'; /* dayfacts-1.0.1 section 2b */
  const apptTimeByDay = { [FULL_DAY]: '9:20 AM', [DAY_FACTS_DAY]: '10:40 AM', [CENSUS_DAY]: '8:05 AM', [EXPLICIT_OFF_DAY]: '11:15 AM' };
  let bridgeDay = FULL_DAY;
  const runtimeNodes = {
    calProvFilter: { value: '7' },
    calDayPanel: { style: { display: 'block' } }
  };
  const rt = {
    console, Promise, Date, Math, JSON, Intl, Object, Array, String, Number, RegExp,
    encodeURIComponent, queueMicrotask, setTimeout, clearTimeout,
    setInterval: () => 1, clearInterval: () => {},
    location: { pathname: '/ScribeFlow-staging.html' },
    localStorage: {
      getItem: k => store.has(k) ? store.get(k) : null,
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: k => store.delete(k)
    },
    document: {
      readyState: 'complete', querySelectorAll: () => [], querySelector: () => null,
      getElementById: id => runtimeNodes[id] || null, addEventListener: () => {},
      body: {}, head: {}, documentElement: {}
    },
    _calMode: 'day', _calRefDate: FULL_DAY, _calSelDay: '',
    _calProviders: [{ id: 7, name: 'Matthew Schaeffer, MD' }, { id: 8, name: 'Michael Schaeffer, MD' }],
    backendMode: () => true, bkToken: () => 'test-token', bkBase: () => 'https://local.invalid',
    uns: k => `test::${k}`,
    _normDate: d => String(d || '').slice(0, 10),
    _normTime: t => {
      const s = String(t || '').trim();
      let m = s.match(/^(\d{1,2}):(\d{2})\s*([AP]M)?$/i);
      if (!m) return '';
      let h = Number(m[1]);
      if (m[3]) { if (/PM/i.test(m[3]) && h < 12) h += 12; if (/AM/i.test(m[3]) && h === 12) h = 0; }
      return `${String(h).padStart(2, '0')}:${m[2]}`;
    },
    _apptKey: (n, d, t) => `${String(n).trim().toLowerCase()}|${d}|${t}`,
    _acctWallToUtcIso: (d, t) => `${d}T${t}:00.000Z`,
    getPatients: () => [patient], upsertPatient: () => {},
    loadCalendar: () => Promise.resolve(), renderTodayPicker: () => {}, renderHistory: () => {}, loadPatients: () => {},
    _athenaHistoryTargetSnapshot: ref => ref && ref.patientId === patient.id
      ? { patientId: patient.id, name: patient.name, dob: patient.dob, mrn: '' } : null,
    _hasImportedHistory: target => !!(target && target.patientId === patient.id),
    _athenaHistoryProofMatches: (target, observed) => target.patientId === patient.id && observed.chartName === patient.name && observed.chartDob === patient.dob,
    _assistReadChart: () => {
      const requestId = 'chart-provider-day-' + (chartReadCalls.length + 1);
      const text = 'Verified chart problems medications allergies and clinical history';
      chartReadCalls.push(requestId);
      return Promise.resolve({
        text, requestId, chartName: patient.name, chartDob: patient.dob, chartMrn: '',
        coverageReceipt: {
          kind: 'athena-chart-coverage', complete: true, readerVersion: '2.9.19-chart-r3', identityObserved: true, truncated: false,
          requestId, capturedAt: Date.now(), expectedClinicalFrames: 1, readClinicalFrames: 1, boundClinicalFrames: 1,
          unboundClinicalFrames: 0, oversizeClinicalFrames: 0, unreadFrames: 0, omittedForCap: 0, textChars: text.length
        }
      });
    },
    _parsePatientChart: () => Promise.resolve({
      problems: 'Verified problem', meds: 'Verified med', allergies: 'Verified allergy', summary: 'Verified summary',
      vitals: { bp: '120/80' }, history: { pmh: 'Verified PMH' },
      coverage: { problems: 'found', meds: 'found', allergies: 'found', summary: 'found', vitals: 'found', history: 'found' }
    }),
    _athenaChartProfileCoverage: () => ({ complete: true }),
    _athenaChartSnapshotFromChart: chart => ({ problems: String(chart.problems || ''), meds: String(chart.meds || ''), allergies: String(chart.allergies || ''), summary: String(chart.summary || ''), vitals: Object.assign({}, chart.vitals || {}), history: Object.assign({}, chart.history || {}), visits: [] }),
    _athenaChartSnapshotProof: snapshot => JSON.stringify(snapshot || {}),
    _athenaHistoryVerifiedRef: target => Object.freeze({ patientId: target.patientId, name: target.name, dob: target.dob, verifiedName: target.name, verifiedDob: target.dob }),
    /* Mirrors the shipped ScribeFlow _savePatientChart: the six merged cards
       land on the PATIENT RECORD (p.problems / p.meds / ...), not only on the
       Athena-owned snapshot. The store census that decides a pull's verdict
       reads those record fields, so a mock that wrote the snapshot alone made
       a day-facts pull (which stores no visits) look like a day that landed
       nothing. */
    _savePatientChart: (ref, _row, chart) => {
      chartSaveCalls.push(String(ref && ref.requestId || ''));
      patient.problems = String(chart.problems || '');
      patient.meds = String(chart.meds || '');
      patient.allergies = String(chart.allergies || '');
      patient.summary = String(chart.summary || '');
      patient.vitals = Object.assign({}, chart.vitals || {});
      patient.history = Object.assign({}, chart.history || {});
      patient.athenaChartSnapshot = { problems: String(chart.problems || ''), meds: String(chart.meds || ''), allergies: String(chart.allergies || ''), summary: String(chart.summary || ''), vitals: Object.assign({}, chart.vitals || {}), history: Object.assign({}, chart.history || {}), visits: [] };
      patient.athenaProfileCoverage = { complete: true, exactIdentityVerified: true, patientId: patient.id, capturedAt: new Date().toISOString(), saveRequestId: String(ref.requestId || ''), cards: {
        problems: { populated: true }, meds: { populated: true }, allergies: { populated: true }, summary: { populated: true }, vitals: { populated: true }, history: { populated: true }
      } };
      return true;
    },
    _patientHistoryCardCoverage: () => patient.athenaProfileCoverage,
    __mlsVisitModel: null,
    __mlsCopyVisits: null,
    fetch: async (_url, init) => {
      if (!init || !init.method) return { ok: true, json: async () => ({ appointments: [] }) };
      savedBodies.push(JSON.parse(init.body));
      return { ok: true, status: 200, json: async () => ({ ok: true, id: `provider-day-backend-${savedBodies.length}` }) };
    }
  };
  function storeVerifiedVisit(_id, raw, opts) {
    opts = opts || {};
    const stored = Object.assign({}, raw, {
      source: opts.source || 'athena-copy', identityVerified: opts.identityVerified === true,
      identityBinding: opts.identityBinding || patient.id,
      bodyComplete: opts.bodyComplete === true && raw.fullDetail === true
    });
    const key = stored.encounterId || stored.sourceVisitKey;
    const prior = patient.visits.findIndex(v => (v.encounterId || v.sourceVisitKey) === key);
    if (prior >= 0) patient.visits[prior] = stored; else patient.visits.push(stored);
    return stored;
  }
  rt.__mlsVisitModel = {
    addVisit: storeVerifiedVisit,
    getVisits: () => patient.visits,
    reconcileVerifiedAthenaVisits: () => ({ complete: true, removed: 0, kept: patient.visits.length }),
    organizePatientHistory: () => ({ ok: true, verifiedVisits: patient.visits.length })
  };
  rt.__mlsCopyVisits = {
    _saveVisits: (_p, _identity, visits) => {
      visits.forEach(v => storeVerifiedVisit(patient.id, v, { source: 'athena-copy', identityVerified: true, identityBinding: patient.id, bodyComplete: true }));
      return visits.length;
    },
    _visitIdentityAgrees: () => true
  };
  /* The pulled-day encounter-note reader. Present and observable so the suite
     can measure WHAT the engine asks it for - in particular that no bulk pull
     may ever ask it for an UNSCOPED read. */
  rt.__mlsVisitSavePref = {
    runForPatient: (p, _onStatus, runOpts) => {
      scopedNoteCalls.push({ patientId: p && p.id, onlyDate: (runOpts && runOpts.onlyDate) || '', singlePull: !!(runOpts && runOpts.singlePull) });
      return Promise.resolve({ ok: true, saved: 1 });
    }
  };
  rt.window = rt;
  rt.__mlsVisitNotesPref = require('./lib-visit-notes-resolver.js').makeResolver(rt.uns, rt.localStorage);
  let armedRosterOperation = null;
  rt.__mlsProviderRoster = {
    list: () => rt._calProviders.map(p => Object.assign({ stableKey: `backend:${p.id}`, rosterVerified: true }, p)),
    beginOperation: op => { armedRosterOperation = Object.assign({}, op); return armedRosterOperation; },
    getReceipt: () => Object.assign(
      { complete: true, partial: false, reason: 'complete' },
      armedRosterOperation ? {
        targetDate: armedRosterOperation.targetDate, requestId: armedRosterOperation.requestId,
        providerMode: armedRosterOperation.providerMode,
        requestedProviderId: armedRosterOperation.requestedProviderId,
        requestedProviderStableKey: armedRosterOperation.requestedProviderStableKey
      } : {}
    ),
    resolve: ref => {
      let raw = ref && typeof ref === 'object' ? (ref.stableKey || ref.id || ref.name || '') : String(ref || '');
      if (String(raw).startsWith('pv:')) raw = decodeURIComponent(String(raw).slice(3));
      const hits = rt._calProviders.filter(p => String(p.id) === String(raw) || `backend:${p.id}` === String(raw) || String(p.name).toLowerCase() === String(raw).toLowerCase());
      return hits.length === 1 ? Object.assign({ stableKey: `backend:${hits[0].id}`, rosterVerified: true }, hits[0]) : null;
    }
  };
  rt.addEventListener = (_type, fn) => listeners.add(fn);
  rt.removeEventListener = (_type, fn) => listeners.delete(fn);
  const emit = (type, resp, id) => {
    const event = { data: { source: 'mls-ext', type, id: id || '', resp } };
    Array.from(listeners).forEach(fn => fn(event));
  };
  rt.postMessage = msg => {
    posted.push(msg);
    if (msg.type === 'mlsPing') queueMicrotask(() => emit('mlsPong', { ok: true, version: '3.0.84' }, ''));
    if (msg.type === 'mlsAppGotoDate') queueMicrotask(() => {
      const want = String(msg.date || bridgeDay).slice(0, 10);
      bridgeDay = want;
      emit('mlsAppGotoDateResult', { id: 'stale-request', ok: true, schedDate: '2026-07-14' }, 'stale-request');
      emit('mlsAppGotoDateResult', { id: msg.id, ok: true, schedDate: want }, msg.id);
    });
    if (msg.type === 'mlsAppPullSchedule') queueMicrotask(() => {
      const day = String(msg.date || bridgeDay).slice(0, 10);
      emit('mlsAppScheduleResult', { id: 'stale-request', ok: true, schedDate: day, receipt: { complete: true }, appts: [{ name: 'Wrong Patient', time: '8:00 AM', provider: 'Michael Schaeffer, MD' }], providers: ['Michael Schaeffer, MD'] }, 'stale-request');
      emit('mlsAppScheduleResult', {
        id: msg.id, requestId: msg.requestId || msg.id, ok: true, scheduleVerified: true, schedDate: day, text: 'Scheduled day ' + day,
        receipt: { complete: true, authoritativeEmpty: false, parsedCount: 1, expectedCount: 1, requestId: msg.requestId || msg.id },
        appts: [{ name: patient.name, dob: patient.dob, date: day, time: apptTimeByDay[day] || '9:20 AM', provider: 'Schaeffer_Matthew_MD' }],
        providers: ['Matthew Schaeffer, MD'], providerDiag: { providerNames: ['Matthew Schaeffer, MD'] }
      }, msg.id);
    });
    if (msg.type === 'mlsAppReadAllVisits') queueMicrotask(() => {
      const event = { data: {
        source: 'mls-ext', type: 'mlsAppAllVisitsResult', id: msg.id, requestId: msg.id, ok: true,
        visits: [{ date: '2026-01-01', type: 'Office visit', raw: 'Verified old visit with substantive clinical detail for the regression.', fullDetail: true, sourceVisitKey: 'row:provider-day-1' }],
        receipt: { complete: true, indexComplete: true, bodyComplete: true, fullDetail: true, stableKeysComplete: true, expected: 1, parsed: 1, cap: 500, readerVersion: '2.9.22-visits-r4-two-stage' },
        readerVersion: '2.9.22-visits-r4-two-stage', identity: { name: patient.name, dob: patient.dob, mrn: '' }
      } };
      Array.from(listeners).forEach(fn => fn(event));
    });
  };

  vm.runInNewContext(siSource, rt, { filename: 'feat_mls_schedimport_exact.js', timeout: 1000 });

  const countVisitReads = () => posted.filter(m => m.type === 'mlsAppReadAllVisits').length;

  /* ============ 1. Full visit notes ON = the mandatory floor + every
     historical body. Unchanged by dayfacts-1.0.0 except that the receipt now
     also declares the floor explicitly. ============ */
  assert.strictEqual(rt.__mlsVisitNotesPref.write(true), true, 'provider-day harness could not persist explicit Full Notes ON');
  const promise = rt.__mlsSI.pullCalendarSelection({ includeHistory: true, pullVisitBodies: true, onStatus: () => {} });
  // Mutate the live calendar immediately; the in-flight request must retain its snapshot.
  runtimeNodes.calProvFilter.value = '8';
  rt._calRefDate = '2026-07-20';
  const result = await withWatchdog(promise, 'provider-day history pull');
  assert.strictEqual(result.ok, true, JSON.stringify({ reason: result.reason, error: result.error, historyReceipt: result.historyReceipt }));
  assert.strictEqual(result.complete, true);
  assert.strictEqual(result.scheduleVerified, true, 'verified schedule provenance was not retained on the final pull receipt');
  assert.strictEqual(result.target, FULL_DAY);
  assert.strictEqual(result.requestedProvider.id, '7');
  assert.strictEqual(result.requestedProvider.name, 'Matthew Schaeffer, MD');
  assert.strictEqual(result.providerReceipt.matchingRows, 1);
  assert.strictEqual(result.providerReceipt.unattributedRows, 0);
  assert.strictEqual(result.historyReceipt.complete, true);
  assert.strictEqual(result.historyReceipt.exactIdentityVerified, true);
  assert.strictEqual(result.historyReceipt.failures, 0);
  assert.strictEqual(result.historyReceipt.visitNotesMode, 'full', 'an explicit ON pull is the full-history mode');
  assert.strictEqual(result.visitNotesMode, 'full', 'dayfacts-1.0.1: one vocabulary at every level - the day RESULT envelope names the mode as well as the receipt');
  assert.strictEqual(result.historyReceipt.chartFactsRequired, true, 'the chart-facts floor is mandatory in BOTH modes');
  assert.strictEqual(result.historyReceipt.allVisitBodiesRequested, true, 'ON must request every historical visit body');
  assert(countVisitReads() >= 1, 'ON mode must actually traverse historical visit bodies');
  assert(patient.visits.length >= 1, 'ON mode must store the verified historical visit bodies it read');
  assert.strictEqual(savedBodies.length, 1);
  assert.strictEqual(savedBodies[0].provider, 'Schaeffer_Matthew_MD');
  assert.strictEqual(savedBodies[0].appt_date, FULL_DAY);
  assert(posted.filter(m => m.type === 'mlsAppGotoDate' || m.type === 'mlsAppPullSchedule').every(m => /^mlssi-/.test(m.id)), 'provider-day bridge requests must carry correlation ids');

  /* ============ 2. dayfacts-1.0.0: Full visit notes OFF (settled) is NOT a
     schedule-only pull any more. This block replaces the retired
     "complete-schedule-only / historyReceipt.skipped / full-notes-off" pins.
     Shape is the REAL calendar Pull button: includeHistory true, no bodies
     boolean, so the engine's admission gate freezes the settled OFF choice. */
  const visitReadsBeforeDayFacts = countVisitReads();
  const chartReadsBeforeDayFacts = chartReadCalls.length;
  const chartSavesBeforeDayFacts = chartSaveCalls.length;
  const visitsStoredBeforeDayFacts = patient.visits.length;
  assert.strictEqual(rt.__mlsVisitNotesPref.write(false), true, 'provider-day harness could not persist explicit Full Notes OFF');
  assert.strictEqual(rt.__mlsVisitNotesPref.read().state, 'off');
  assert.strictEqual(rt.__mlsVisitNotesPref.read().settled, true, 'OFF only means day-facts once the choice is SETTLED');
  runtimeNodes.calProvFilter.value = '7';
  rt._calMode = 'day'; rt._calRefDate = DAY_FACTS_DAY; runtimeNodes.calDayPanel.style.display = 'block';
  const scopedNotesBeforeDayFacts = scopedNoteCalls.length;
  const dayFactsStatus = [];
  /* dayfacts-1.0.1: the round-1 TODO here (pullCalendarSelection ANDing the
     bodies boolean into its own includeHistory) is CLOSED - the engine byte is
     now `var includeHistory = opts.includeHistory !== false;` and the revoked
     AND is pinned absent above. Section 2b proves the behaviour end to end by
     driving this same door with an EXPLICIT pullVisitBodies:false. */
  const dayFacts = await withWatchdog(
    rt.__mlsSI.pullCalendarSelection({ includeHistory: true, onStatus: (m, k) => dayFactsStatus.push(String(m || '') + '|' + String(k || '')) }),
    'provider-day day-facts pull');
  const dfr = dayFacts.historyReceipt || {};
  assert.strictEqual(dayFacts.ok, true, JSON.stringify({ reason: dayFacts.reason, error: dayFacts.error, historyReceipt: dfr }));
  assert.strictEqual(dayFacts.complete, true);
  assert.strictEqual(dayFacts.target, DAY_FACTS_DAY);
  assert.strictEqual(dayFacts.includeHistory, true, 'dayfacts-1.0.0: includeHistory is decoupled from the checkbox - an OFF day pull still runs the batch');
  assert.strictEqual(dayFacts.reason, 'complete', 'dayfacts-1.0.0: an OFF day is a complete pull, never "complete-schedule-only"');
  assert.notStrictEqual(dfr.skipped, true, 'dayfacts-1.0.0: the per-patient batch MUST run with Full visit notes off');
  assert.notStrictEqual(dfr.reason, 'full-notes-off', 'dayfacts-1.0.0: the revoked schedule-only skip reason must not come back');
  assert.notStrictEqual(dfr.reason, 'visit-notes-off', 'dayfacts-1.0.0: the revoked schedule-only skip reason must not come back');
  assert.strictEqual(dfr.reason, 'complete');
  assert.strictEqual(dfr.visitNotesMode, 'day-facts');
  assert.strictEqual(dfr.visitNotesRequested, false);
  assert.strictEqual(dfr.chartFactsRequired, true, 'the chart-facts floor is mandatory with the checkbox off');
  assert.strictEqual(dfr.allVisitBodiesRequested, false, 'OFF must not request the historical bodies');
  assert.strictEqual(dfr.requested, 1);
  assert.strictEqual(dfr.processed, 1);
  assert.strictEqual(dfr.failures, 0);
  assert.strictEqual(dfr.complete, true);
  assert.strictEqual(dfr.exactIdentityVerified, true);
  /* honest insurance placeholders - a reader that does not ship may never be
     reported as "verified none". */
  assert.strictEqual(dfr.insuranceAttempted, 0);
  assert.strictEqual(dfr.insuranceComplete, false);
  assert.strictEqual(dfr.benefitsComplete, false);
  assert.strictEqual(dfr.insuranceReason, 'reader-not-shipped');
  /* the chart really opened, and the facts really saved, on THIS pull */
  assert.strictEqual(chartReadCalls.length, chartReadsBeforeDayFacts + 1, 'dayfacts-1.0.0: every exact scheduled row gets an identity-verified chart OPEN with the checkbox off');
  assert.strictEqual(chartSaveCalls.length, chartSavesBeforeDayFacts + 1, 'dayfacts-1.0.0: every exact scheduled row gets its chart-facts SAVE with the checkbox off');
  /* dayfacts-1.0.1: the receipt's own chart-open ledger counts BOTH doors -
     dnReadChart (the history/facts leg) and tnBoundedRead (the day-note leg).
     One scheduled row in day-facts mode therefore costs exactly one of each.
     Round 1 pinned total===1 because the day-note door never opened; a revert
     that re-fuses the lane drops dayNote back to 0 and trips this. */
  const dfOpens = dfr.chartOpens || {};
  assert.strictEqual(Number(dfOpens.history || 0), 1, 'the history/chart-facts leg must open exactly one chart for the one scheduled row');
  assert.strictEqual(Number(dfOpens.dayNote || 0), 1, 'dayfacts-1.0.1: the pulled-day note leg must open its chart - a 0 here means the lane is fused off again');
  assert.strictEqual(Number(dfOpens.total || 0), 2, 'the receipt must report BOTH chart opens it performed');
  assert.strictEqual(Number(dfOpens.rows || 0), 1);
  assert.strictEqual(Number(dfOpens.perRow || 0), 2, 'chart opens per row is the number the owner reads to judge a change - it must be measured, not guessed');
  assert.strictEqual(Number(dfr.chartsSkippedVerifiedToday || 0), 0, 'this day was never read before - nothing may be skipped as already-verified');
  const dayFactsPatient = (dfr.patients || [])[0] || {};
  assert.strictEqual(dayFactsPatient.complete, true);
  assert.strictEqual(dayFactsPatient.dayNoteChartOpen, true, 'the chart open that the pulled-day note lane depends on must be recorded');
  /* ADVERSARIAL HALF THAT SURVIVES: OFF still traverses NO historical body. */
  assert.strictEqual(dayFactsPatient.visitsSkipped, true, 'dayfacts-1.0.0: historical visit traversal is skipped with the checkbox off');
  assert.strictEqual(countVisitReads(), visitReadsBeforeDayFacts, 'day-facts mode must not read Athena historical visit bodies');
  assert.strictEqual(patient.visits.length, visitsStoredBeforeDayFacts, 'day-facts mode must not store new historical visit bodies');
  /* ===== dayfacts-1.0.1: the THIRD mandatory element, now MEASURED =========
     Round 1 could only assert the forward-compatible subset (scoping,
     at-most-once, no false failures) because both day-note gates were fused
     false and scopedNoteCalls was empty. The lanes ship enabled, so the
     attempt itself is now the assertion: a day-facts row must really call
     vp.runForPatient scoped to the pulled day, exactly once. */
  const dayFactsNoteCalls = scopedNoteCalls.slice(scopedNotesBeforeDayFacts);
  assert.strictEqual(dayFactsNoteCalls.length, 1,
    'dayfacts-1.0.1: the day-facts row must ATTEMPT its pulled-day encounter note - 0 here means the inline fold-in and the tail pass are both fused off again');
  assert.strictEqual(dayFactsNoteCalls.length, Number(dfr.requested || 0),
    'dayfacts-1.0.1: exactly one pulled-day note attempt per scheduled row - no row may be silently skipped and none may be read twice');
  assert.strictEqual(dayFactsNoteCalls[0].patientId, patient.id,
    'the pulled-day note must be read for the patient whose chart this row verified');
  /* the pulled-day encounter note may only ever be asked for SCOPED to the
     day this pull read - never as an unscoped "give me every body" read. */
  assert(scopedNoteCalls.every(c => /^\d{4}-\d{2}-\d{2}$/.test(c.onlyDate)),
    'dayfacts-1.0.0: a bulk pull may never issue an UNSCOPED visit-notes read');
  assert(scopedNoteCalls.every(c => c.onlyDate === DAY_FACTS_DAY),
    'dayfacts-1.0.0: the day-facts note attempt is scoped to the PULLED day, never another date');
  assert(scopedNoteCalls.every(c => c.singlePull !== true),
    'dayfacts-1.0.1: a batch row is not a single-patient pull - the unscoped singlePull door must stay shut inside a bulk pull');
  /* the receipt must ACCOUNT for the note it read. tnAggregate's checkbox
     short-circuit is gone, so an OFF receipt reports a real per-row tally and
     may never call a mandatory note "not requested". */
  assert.strictEqual(Number(dfr.todayNoteRead || 0), 1, 'dayfacts-1.0.1: the receipt must report the pulled-day note it actually read');
  assert.strictEqual(Number(dfr.todayNoteFailures || 0), 0, 'no pulled-day note may be reported as failed on this fixture');
  assert.strictEqual(Number(dfr.todayNoteNotRequested || 0), 0,
    'dayfacts-1.0.1: the pulled-day note is MANDATORY with the checkbox off - tnAggregate may not report it as not-requested');
  assert.strictEqual(dayFactsPatient.todayNote, true, 'the row must record that its pulled-day note landed');
  assert.strictEqual(Number(dayFactsPatient.todayNoteAttempts || 0), 1, 'the row must record exactly one pulled-day note attempt');
  assert.notStrictEqual(dayFactsPatient.todayNoteReason, 'visit-notes-off', 'dayfacts-1.0.1: the revoked stamp vocabulary must not come back on a row');
  /* no user-facing message may claim that OFF opened no charts */
  assert(dayFactsStatus.every(s => !/no patient charts or visit notes were opened/i.test(s)),
    'dayfacts-1.0.0: an OFF pull may not tell the clinician that no charts were opened');
  assert(dayFactsStatus.every(s => !/^Schedule-only complete:/.test(s)),
    'dayfacts-1.0.0: an OFF day pull is not a schedule-only pull and must not report itself as one');
  assert(dayFactsStatus.some(s => /^Verified complete: schedule/.test(s)),
    'a landed day-facts pull reports itself verified complete');
  assert.strictEqual(dayFacts.visitNotesMode, 'day-facts',
    'dayfacts-1.0.1: one vocabulary at every level - the day RESULT envelope names the mode too, never "not-requested"');

  /* ============ 2b. dayfacts-1.0.1, adversarial: the Calendar door itself is
     decoupled from the checkbox. Round 1 could only assert the absence of
     `pullVisitBodies` from the calendar UI bytes, because pullCalendarSelection
     still ANDed an explicit bodies:false into its own includeHistory and would
     have handed back the REVOKED schedule-only pull. Drive that exact shape on
     purpose now: an explicit OFF through this door must still run the
     mandatory day-facts batch - chart open, facts save, pulled-day note - and
     must still skip the historical bodies. ============ */
  const visitReadsBeforeExplicitOff = countVisitReads();
  const chartReadsBeforeExplicitOff = chartReadCalls.length;
  const chartSavesBeforeExplicitOff = chartSaveCalls.length;
  const scopedNotesBeforeExplicitOff = scopedNoteCalls.length;
  const visitsStoredBeforeExplicitOff = patient.visits.length;
  rt._calMode = 'day'; rt._calRefDate = EXPLICIT_OFF_DAY; runtimeNodes.calDayPanel.style.display = 'block';
  runtimeNodes.calProvFilter.value = '7';
  const explicitOffStatus = [];
  const explicitOff = await withWatchdog(
    rt.__mlsSI.pullCalendarSelection({ includeHistory: true, pullVisitBodies: false, onStatus: (m, k) => explicitOffStatus.push(String(m || '') + '|' + String(k || '')) }),
    'provider-day explicit bodies-off calendar pull');
  const eofr = explicitOff.historyReceipt || {};
  assert.strictEqual(explicitOff.ok, true, JSON.stringify({ reason: explicitOff.reason, error: explicitOff.error, historyReceipt: eofr }));
  assert.strictEqual(explicitOff.target, EXPLICIT_OFF_DAY);
  assert.strictEqual(explicitOff.includeHistory, true,
    'dayfacts-1.0.1: an explicit bodies:false may no longer be re-derived into a batch opt-out by the Calendar door');
  assert.strictEqual(explicitOff.reason, 'complete', 'dayfacts-1.0.1: an explicit-OFF calendar pull is a complete pull, never "complete-schedule-only"');
  assert.notStrictEqual(eofr.skipped, true, 'dayfacts-1.0.1: the mandatory batch must run even for an explicit bodies:false caller');
  assert.strictEqual(eofr.visitNotesMode, 'day-facts');
  assert.strictEqual(eofr.chartFactsRequired, true);
  assert.strictEqual(eofr.allVisitBodiesRequested, false);
  assert.strictEqual(eofr.processed, 1);
  assert.strictEqual(eofr.failures, 0);
  assert.strictEqual(chartReadCalls.length, chartReadsBeforeExplicitOff + 1, 'dayfacts-1.0.1: an explicit bodies:false row still gets its identity-verified chart OPEN');
  assert.strictEqual(chartSaveCalls.length, chartSavesBeforeExplicitOff + 1, 'dayfacts-1.0.1: an explicit bodies:false row still gets its chart-facts SAVE');
  assert.strictEqual(Number((eofr.chartOpens || {}).dayNote || 0), 1, 'dayfacts-1.0.1: an explicit bodies:false row still opens its pulled-day note chart');
  const explicitOffNoteCalls = scopedNoteCalls.slice(scopedNotesBeforeExplicitOff);
  assert.strictEqual(explicitOffNoteCalls.length, 1, 'dayfacts-1.0.1: an explicit bodies:false row still attempts exactly its pulled-day note');
  assert.strictEqual(explicitOffNoteCalls[0].onlyDate, EXPLICIT_OFF_DAY, 'the note attempt follows THIS pull\'s day, not the previous pull\'s');
  assert.strictEqual(Number(eofr.todayNoteRead || 0), 1);
  assert.strictEqual(Number(eofr.todayNoteNotRequested || 0), 0);
  /* ADVERSARIAL HALF THAT SURVIVES: still no historical body traversal. */
  assert.strictEqual(((eofr.patients || [])[0] || {}).visitsSkipped, true, 'an explicit bodies:false pull must still skip the historical traversal');
  assert.strictEqual(countVisitReads(), visitReadsBeforeExplicitOff, 'an explicit bodies:false pull must read no Athena historical visit bodies');
  assert.strictEqual(patient.visits.length, visitsStoredBeforeExplicitOff, 'an explicit bodies:false pull must store no new historical visit bodies');
  assert(explicitOffStatus.every(s => !/no patient charts or visit notes were opened/i.test(s) && !/^Schedule-only complete:/.test(s)),
    'dayfacts-1.0.1: an explicit bodies:false pull may not report itself as the revoked schedule-only no-op');

  /* ============ 3. The ONE surviving includeHistory opt-out: the census
     phase-1 caller. It still skips the batch, but its receipt must name the
     CALLER, never the checkbox - "full-notes-off" was retired with the
     schedule-only mode. ============ */
  const visitReadsBeforeCensus = countVisitReads();
  const chartReadsBeforeCensus = chartReadCalls.length;
  const censusStatus = [];
  const censusSkip = await withWatchdog(rt.__mlsSI.pull({
    date: CENSUS_DAY,
    provider: { id: '7', stableKey: 'backend:7', name: 'Matthew Schaeffer, MD', rosterVerified: true },
    includeHistory: false, pullVisitBodies: false,
    onStatus: (m, k) => censusStatus.push(String(m || '') + '|' + String(k || ''))
  }), 'census phase-1 caller opt-out');
  assert.strictEqual(censusSkip.ok, true, JSON.stringify({ reason: censusSkip.reason, error: censusSkip.error }));
  assert.strictEqual(censusSkip.complete, true);
  assert.strictEqual(censusSkip.includeHistory, false, 'an explicit caller opt-out is the only thing that may still skip the batch');
  assert.strictEqual(censusSkip.reason, 'complete-schedule-only');
  assert.strictEqual(censusSkip.historyReceipt.skipped, true);
  assert.strictEqual(censusSkip.historyReceipt.reason, 'not-requested', 'dayfacts-1.0.0: a caller skip is named honestly and is never blamed on the checkbox');
  assert.notStrictEqual(censusSkip.historyReceipt.reason, 'full-notes-off');
  /* dayfacts-1.0.1: even the ONE legitimate skip speaks the new vocabulary -
     "not-requested" is the caller's REASON, never a visitNotesMode an OFF pull
     is allowed to report. */
  assert.strictEqual(censusSkip.historyReceipt.visitNotesMode, 'day-facts');
  assert.strictEqual(censusSkip.visitNotesMode, 'day-facts');
  assert.notStrictEqual(censusSkip.visitNotesMode, 'not-requested',
    'dayfacts-1.0.1: "not-requested" is no longer a MODE an OFF pull may report at any level');
  assert.strictEqual(chartReadCalls.length, chartReadsBeforeCensus, 'a caller that opted out of the batch must open no chart');
  assert.strictEqual(countVisitReads(), visitReadsBeforeCensus, 'a caller that opted out of the batch must read no visit bodies');
  assert(censusStatus.every(s => !/no patient charts or visit notes were opened/i.test(s)),
    'dayfacts-1.0.0: a caller-driven skip may not be reported as a Full-notes-OFF consequence');

  /* ============ 4. Identity floor is unchanged in day-facts mode: a
     name-only history target is still refused. ============ */
  const blockedNameOnly = await withWatchdog(rt.__mlsSI._runHistoryBatch([{ name: patient.name }], [], () => {}), 'provider-day name-only rejection');
  assert.strictEqual(blockedNameOnly.complete, false);
  assert.strictEqual(blockedNameOnly.exactIdentityVerified, false);
  assert.strictEqual(blockedNameOnly.visitNotesMode, 'day-facts', 'the settled-OFF seam runs in day-facts mode, not blocked and not full');
  assert.strictEqual(blockedNameOnly.retry[0].reason, 'identity-target-unresolved', 'name-only history targets remain blocked');
  /* ============ 4b. dayfacts-1.0.1: Retry failed histories is ADMITTED in
     day-facts mode. Round 1 could only report this as an engine gap -
     retryFailedHistory refused every retry row of an OFF receipt with the
     revoked reason "full-notes-off", so a day-facts day that failed to read
     three charts had its retry rows silently discarded even though the
     chart-facts save is mandatory in OFF. The refusal is gone; here is the
     positive pin round 1 promised, with its adversarial half attached: the
     retry re-runs the MANDATORY work and must NOT widen into a full-history
     read merely because it was retried. ============ */
  const RETRY_DAY = '2026-07-19';
  const chartReadsBeforeRetry = chartReadCalls.length;
  const chartSavesBeforeRetry = chartSaveCalls.length;
  const visitReadsBeforeRetry = countVisitReads();
  const visitsStoredBeforeRetry = patient.visits.length;
  const offRetrySource = {
    target: RETRY_DAY,
    historyReceipt: {
      requestId: 'history-batch-dayfacts-retry-fixture',
      day: RETRY_DAY, visitNotesRequested: false, visitNotesMode: 'day-facts',
      chartFactsRequired: true, allVisitBodiesRequested: false,
      requested: 1, processed: 1, complete: false, exactIdentityVerified: false, failures: 1,
      patients: [],
      retry: [{ patientId: patient.id, reason: 'chart-read-failed', frozenDob: '19600102', frozenMrn: '', day: RETRY_DAY }]
    }
  };
  const offRetry = await withWatchdog(rt.__mlsSI.retryFailedHistory(offRetrySource, () => {}), 'day-facts retry admission');
  assert.notStrictEqual(offRetry.reason, 'full-notes-off',
    'dayfacts-1.0.1: Retry failed histories must not discard an OFF receipt\'s rows as a checkbox consequence');
  assert.notStrictEqual(offRetry.reason, 'visit-notes-off', 'dayfacts-1.0.1: the revoked skip vocabulary must not come back on the retry seam');
  assert.strictEqual(offRetry.requested, 1, 'dayfacts-1.0.1: an OFF receipt\'s retry row is actionable work and must be requested');
  assert.strictEqual(offRetry.processed, 1, 'dayfacts-1.0.1: the retry must actually re-run the mandatory day-facts work');
  assert.strictEqual(offRetry.complete, true, JSON.stringify({ reason: offRetry.reason, failures: offRetry.failures, retry: offRetry.retry }));
  assert.strictEqual(offRetry.failures, 0);
  assert.strictEqual(offRetry.visitNotesRequested, false);
  assert.strictEqual(offRetry.visitNotesMode, 'day-facts', 'the frozen override must keep the retry in the SOURCE receipt\'s mode');
  assert.strictEqual(offRetry.retryOf, 'history-batch-dayfacts-retry-fixture');
  assert.strictEqual(chartReadCalls.length, chartReadsBeforeRetry + 1, 'the retry must reopen the chart it is retrying');
  assert.strictEqual(chartSaveCalls.length, chartSavesBeforeRetry + 1, 'the retry must re-save the chart facts it is retrying');
  /* ADVERSARIAL HALF: retrying an OFF day may never widen into a full crawl. */
  assert.strictEqual(((offRetry.patients || [])[0] || {}).visitsSkipped, true, 'a day-facts retry still skips the historical bodies');
  assert.strictEqual(countVisitReads(), visitReadsBeforeRetry, 'a day-facts retry must read no Athena historical visit bodies');
  assert.strictEqual(patient.visits.length, visitsStoredBeforeRetry, 'a day-facts retry must store no new historical visit bodies');

  /* TODO(dayfacts-1.0.1, engine gap - reported as a finding, deliberately NOT
     asserted, because the honest assertion here would pin the defect and the
     dishonest one would forge it green): the 1.0.1 delta says "tnDeferRow and
     niSyncFromReceipt no longer refuse day-facts rows", but both gates are
     still keyed on the ON checkbox in these bytes:
        feat_mls_schedimport_exact.js:5873  (tnDeferRow)
          if (!entry || !day || sweepDepth || receipt.visitNotesRequested !== true) return false;
        feat_mls_schedimport_exact.js:7064  (niSyncFromReceipt)
          if (receipt.visitNotesRequested !== true) return 0;
     niGate/niReadOnce WERE converted (they now refuse only an unchosen
     preference, reason "visit-notes-unchosen"), so the idle backfill is
     willing to drain a day-facts row that never reaches it: the two feeds that
     would enqueue it both return early on an OFF receipt. Consequence under
     the superseding contract: a pulled-day note that fails on a day-facts day
     is neither deferred to the immediate round nor queued for the idle
     backfill - it is dropped, while the same failure on an ON day is retried.
     This fixture cannot see it because every note here succeeds; add the
     positive pin (a failed day-facts note appears in the deferred queue /
     niSyncFromReceipt returns > 0) the moment the two gates learn the settled
     tri-state the rest of the engine already speaks. */

  /* ============ 5. dayfacts-1.0.0 fail-closed: an UNCHOSEN account gets
     nothing read on its behalf. This replaces the old "visit-notes-off"
     no-op, which used to be the only early return here. ============ */
  const postedBeforeUnchosen = posted.length;
  const chartReadsBeforeUnchosen = chartReadCalls.length;
  const visitReadsBeforeUnchosen = countVisitReads();
  const scopedNotesBeforeUnchosen = scopedNoteCalls.length;
  ['test::visitNotesModeV2', 'test::pullVisitBodies', 'test::pullVisitBodiesSet', 'mls_save_every_athena_visit']
    .forEach(k => store.delete(k));
  assert.strictEqual(rt.__mlsVisitNotesPref.read().state, 'unset', 'the harness must actually reach the first-use tri-state');
  const unchosen = await withWatchdog(rt.__mlsSI._runHistoryBatch([{
    name: patient.name, dob: patient.dob, date: DAY_FACTS_DAY,
    patient_external_id: patient.id, _mlsTargetPatientId: patient.id
  }], [], () => {}), 'unchosen fail-closed batch');
  assert.strictEqual(unchosen.reason, 'visit-notes-unchosen');
  assert.strictEqual(unchosen.visitNotesMode, 'blocked-unchosen');
  assert.strictEqual(unchosen.complete, true, 'a refusal is a clean, complete no-op - never a half-read day');
  assert.strictEqual(unchosen.historyRequested, false);
  assert.strictEqual(unchosen.requested, 0);
  assert.strictEqual(unchosen.processed, 0);
  assert.strictEqual(unchosen.failures, 0);
  assert.strictEqual(unchosen.notRequestedRows, 1);
  assert.strictEqual(Number(unchosen.todayNoteRead || 0), 0);
  assert.strictEqual((unchosen.patients || []).length, 0, 'a blocked batch reports no per-patient rows');
  assert.strictEqual((unchosen.retry || []).length, 0, 'a blocked batch queues nothing for retry');
  assert.strictEqual(chartReadCalls.length, chartReadsBeforeUnchosen, 'an unchosen account must have ZERO charts opened on its behalf');
  assert.strictEqual(countVisitReads(), visitReadsBeforeUnchosen, 'an unchosen account must have ZERO visit bodies read on its behalf');
  assert.strictEqual(scopedNoteCalls.length, scopedNotesBeforeUnchosen, 'an unchosen account must have ZERO pulled-day notes read on its behalf');
  assert.strictEqual(posted.length, postedBeforeUnchosen, 'an unchosen account must put ZERO requests on the Athena bridge');

  console.log('PASS provider-day pull: full-history ON, dayfacts-1.0.1 day-facts OFF (chart opens 1 history + 1 day-note, pulled-day note attempted and read, bodies skipped), explicit bodies:false through the Calendar door, census-caller opt-out, OFF-receipt retry admitted without widening, unchosen fail-closed, frozen runtime route');
})().catch(err => { console.error(err); process.exit(1); });
