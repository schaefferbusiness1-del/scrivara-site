'use strict';

/* dsdiag-1.1.0 — THE COPYABLE PULL REPORT MUST BE ACTIONABLE.
 *
 * Readiness audit §11, measured against 1p-mls-connect.js: dsDiagReport had
 * ZERO hits for pullId, user, practice and storage. Consequences the audit
 * could name:
 *   - two reports from two doctors on the same day are indistinguishable;
 *   - a pull that read athenaOne perfectly and then lost every row to a full
 *     patient store reads exactly like a pull that read nothing;
 *   - "which extension?" and "which web build?" were unanswerable, and version
 *     skew is the single most common real cause of a broken pull.
 *
 * This suite EXECUTES the real report builder (sliced out of the shipped file
 * and run in a vm) against a seeded failure. It does not grep for field names.
 *
 * The second half is the safety half: the report is copied into email by the
 * doctor's own hand, so account identity is DELIBERATE and patient identity is
 * forbidden. Both are asserted, including that the patient store's own masked
 * namespace key and per-tab id do NOT cross into the report.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const connect = fs.readFileSync(path.join(root, '1p-mls-connect.js'), 'utf8');
const SHELLS = ['1pScribeFlow.html', '1p/index.html'];

let checks = 0;
const ok = (v, m) => { assert.ok(v, m); checks++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, m); checks++; };

function slice(src, start, end, label) {
  const a = src.indexOf(start);
  assert.ok(a >= 0, `could not find the start of ${label}: ${start}`);
  const b = src.indexOf(end, a + start.length);
  assert.ok(b > a, `could not find the end of ${label}: ${end}`);
  return src.slice(a, b);
}

/* ---------------------------------------------------------------- the block */
{
  eq(connect.split('/* ===== dsdiag-1.1.0').length - 1, 1, 'dsdiag-1.1.0 must open exactly once');
  eq(connect.split('/* ===== end dsdiag-1.1.0 ===== */').length - 1, 1, 'dsdiag-1.1.0 must close exactly once');
  ok(connect.indexOf('/* ===== dsdiag-1.1.0') < connect.indexOf('/* ===== end dsdiag-1.1.0 ===== */'),
    'dsdiag-1.1.0 closes before it opens');
}

/* --------------------------------------------- the shell accessor, in BOTH twins */
{
  const spans = SHELLS.map((name) => {
    const src = fs.readFileSync(path.join(root, name), 'utf8');
    eq(src.split('/* ===== diag-account-1.0.0').length - 1, 1, `${name}: diag-account-1.0.0 must open exactly once`);
    eq(src.split('/* ===== end diag-account-1.0.0 ===== */').length - 1, 1, `${name}: diag-account-1.0.0 must close exactly once`);
    return slice(src, '/* ===== diag-account-1.0.0', '/* ===== end diag-account-1.0.0 ===== */', `${name} accessor`);
  });
  eq(spans[0], spans[1], 'the twins carry different diag-account-1.0.0 blocks');

  /* EXECUTE it: bkUser is a top-level `let` in the shell, which is exactly why
     an additive asset cannot read it and why this accessor has to exist. */
  const ctx = {
    window: {},
    bkUser: { email: 'Dr.Sample@Example.Test', id: 91, role: 'Head', isHead: true, isAdmin: false, premium: true, hasAccess: true, name: 'Sample Doctor' },
    session: { email: 'dr.sample@example.test' },
    sfNormalizeSessionAccount: (v) => String(v || '').trim().toLowerCase(),
    getSessionEmail: () => 'dr.sample@example.test',
    backendMode: () => true,
    String, Number, Boolean, Object
  };
  vm.createContext(ctx);
  vm.runInContext(spans[0], ctx);
  const rec = ctx.window.__mlsDiagAccountReceipt();
  eq(rec.email, 'dr.sample@example.test', 'the account receipt lost the signed-in email');
  eq(rec.role, 'head', 'the account receipt lost the role');
  eq(rec.practice, 'head-of-practice', 'the account receipt does not state the doctor\'s position in the practice');
  eq(rec.plan, 'premium', 'the account receipt lost the plan');
  eq(rec.userId, '91', 'the account receipt lost the account id');
  eq(rec.backend, true, 'the account receipt lost hosted/local mode');
  ok(JSON.stringify(rec).indexOf('Sample Doctor') < 0,
    'the account receipt exports the doctor\'s NAME — account identity only, never a person\'s name');

  /* a signed-out shell must not throw and must not invent an account */
  const ctx2 = {
    window: {}, bkUser: null, session: null,
    sfNormalizeSessionAccount: (v) => String(v || '').trim().toLowerCase(),
    getSessionEmail: () => '', backendMode: () => false, String, Number, Boolean, Object
  };
  vm.createContext(ctx2);
  vm.runInContext(spans[0], ctx2);
  const rec2 = ctx2.window.__mlsDiagAccountReceipt();
  eq(rec2.email, '', 'a signed-out shell invented an account email');
  eq(rec2.plan, '', 'a signed-out shell invented a plan');
}

/* --------------------------------------------------- run the real report builder */
function buildReport(overrides) {
  const o = overrides || {};
  const source = [
    slice(connect, 'function dsPick(obj, keys) {', '/* p1-pac-1.0.0:', 'dsPick'),
    slice(connect, 'function dsSafeAttributionCoverage(raw) {', 'function dsFullyRowUnattributed(', 'dsSafeAttributionCoverage'),
    slice(connect, 'function dsReasonHistogram(list) {', 'var DS_SAFE_REASON_CODES = {', 'dsReasonHistogram'),
    slice(connect, 'var DS_SAFE_REASON_CODES = {', 'function dsDiagReport() {', 'reason codes + dsdiag-1.1.0'),
    slice(connect, 'function dsDiagReport() {', 'function dsCopyText(t) {', 'dsDiagReport')
  ].join('\n');

  const storeReceipt = Object.assign({
    version: 'sj-2.0.0', mode: 'ls', hydrated: false, key: 'sf_u::dr.s***@example.test::patients',
    tab: 'tab-7f3a', gen: 12, confirmedGen: 9, rows: 1402,
    journalUnits: 5386889, journalHardMax: 5242880, journalOverHighWater: true,
    wbInflight: false, wbQueued: false, wbFailures: 3,
    durable: { requested: true, persisted: false, why: 'denied', verdictAt: 1, estimate: null },
    degraded: true, degradedWhy: 'quota', lastError: 'QuotaExceededError'
  }, o.storeReceipt || {});

  const ctx = {
    DS: Object.assign({
      day: '2026-08-17', statusLog: ['Starting the Athena pull for 2026-08-17...', 'Reading the day grid...'],
      statusOmitted: 2, lastResult: null, pullId: '', pullStartedAt: 0, providerRosterRetryReceipt: null,
      providerAttributionCoverage: null
    }, o.DS || {}),
    window: {
      __MLS_AV: 'b1042',
      __mlsExtReportedVersion: '3.0.62',
      __mlsDiagAccountReceipt: o.noAccessor ? undefined : (() => ({
        email: 'dr.sample@example.test', userId: '91', role: 'head', isAdmin: false, isHead: true,
        practice: 'head-of-practice', plan: 'premium', hasAccess: true, backend: true
      })),
      __mlsPtsStore: o.noStore ? undefined : { receipt: () => storeReceipt },
      __mlsSI: { _lastPullResult: () => o.result || null }
    },
    navigator: {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      onLine: true
    },
    Intl, Date, Math, Number, String, Boolean, Object, Array, JSON, isFinite
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(source + '\n__out = dsDiagReport();', ctx);
  return { text: ctx.__out, report: JSON.parse(ctx.__out), ctx };
}

/* ---- the four new receipts are PRESENT and carry the seeded truth --------- */
{
  const { report } = buildReport({
    DS: { pullId: 'pull-abc123-xyz789', pullStartedAt: Date.UTC(2026, 7, 17, 13, 30, 0) },
    result: { ok: false, complete: false, reason: 'provider-roster-incomplete', target: 'day', error: '' }
  });

  eq(report.pullId, 'pull-abc123-xyz789', 'the report does not carry the pull id');
  eq(report.pullStartedAt, '2026-08-17T13:30:00.000Z', 'the report does not carry when the pull started');

  ok(report.user && report.user.available === true, 'the report carries no user receipt');
  eq(report.user.email, 'dr.sample@example.test', 'the report does not name the account that ran the pull');
  eq(report.user.practice, 'head-of-practice', 'the report does not carry the practice position');
  eq(report.user.plan, 'premium', 'the report does not carry the plan');
  eq(report.user.role, 'head', 'the report does not carry the role');

  ok(report.storage && report.storage.available === true, 'the report carries no storage receipt');
  eq(report.storage.mode, 'ls',
    'the report does not say WHICH store the roster landed in — "ls" is the measured ~1,400-patient ceiling and must be visible');
  eq(report.storage.rows, 1402, 'the report does not carry the roster size');
  eq(report.storage.durabilityPersisted, false, 'the report does not carry the durability verdict');
  eq(report.storage.durabilityWhy, 'denied', 'the report does not carry WHY durability failed');
  eq(report.storage.journalOverHighWater, true, 'the report does not carry the journal high-water state');
  eq(report.storage.degraded, true, 'the report does not carry the degraded flag');
  eq(report.storage.lastError, 'QuotaExceededError', 'the report does not carry the store\'s last error');

  eq(report.client.webBuild, 'b1042', 'the report does not carry the web build');
  eq(report.client.extVersion, '3.0.62', 'the report does not carry the extension version');
  eq(report.client.browser, 'chrome', 'the report did not resolve the browser');
  eq(report.client.browserMajor, '128', 'the report did not resolve the browser major version');
  eq(report.client.os, 'windows-10/11', 'the report did not resolve the OS');
  eq(report.client.online, true, 'the report did not record online state');

  /* everything that was already there is still there */
  ok(report.result && report.result.reason === 'provider-roster-incomplete', 'the report lost the pull result');
  ok(Array.isArray(report.statusEvents) && report.statusEvents.length === 2, 'the report lost its status log');
}

/* ---- NO patient identifiers, and no storage namespace / tab id ------------ */
{
  const { text, report } = buildReport({
    DS: { pullId: 'pull-safety-1' },
    result: { ok: false, complete: false, reason: 'provider-roster-incomplete', target: 'day', error: '' }
  });
  const sub = JSON.stringify({ user: report.user, storage: report.storage, client: report.client });

  for (const forbidden of ['sf_u::', 'tab-7f3a', 'mrn', 'MRN', 'dob', 'birth', 'patientName', 'patient_name']) {
    ok(sub.indexOf(forbidden) < 0,
      `the new report receipts leak "${forbidden}" — the storage namespace, the per-tab id and every patient field must stay out`);
  }
  ok(!/\bkey\b/.test(sub), 'the storage receipt copied the store key across');
  /* the report is still one JSON document a doctor can paste */
  ok(text.length > 200 && text.trim().charAt(0) === '{', 'the report is no longer a single JSON object');
}

/* ---- the report survives a shell with no accessor and no store ------------ */
{
  const { report } = buildReport({ noAccessor: true, noStore: true, DS: { pullId: 'pull-degraded-1' } });
  eq(report.user.available, false, 'a missing accessor must be reported, not faked');
  eq(report.user.why, 'accessor-missing', 'a missing accessor must say so');
  eq(report.storage.available, false, 'a missing store must be reported, not faked');
  eq(report.storage.why, 'store-missing', 'a missing store must say so');
  eq(report.pullId, 'pull-degraded-1', 'the pull id was lost on the degraded path');
}

/* ---- the pull id is minted per RUN and is unique -------------------------- */
{
  const source = slice(connect, '/* ===== dsdiag-1.1.0', '/* ===== end dsdiag-1.1.0 ===== */', 'dsdiag block');
  const ctx = { window: {}, navigator: { userAgent: '' }, Date, Math, Number, String, Object, Array, JSON };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(source + '\n__a = dsNewPullId(); __b = dsNewPullId();', ctx);
  ok(/^pull-[a-z0-9]+-[a-z0-9]+$/.test(ctx.__a), `dsNewPullId produced ${ctx.__a}`);
  ok(ctx.__a !== ctx.__b, 'two pulls in the same session were given the same id');

  /* it is minted at BOTH pull entries, not just the one the tester noticed */
  eq(connect.split('DS.pullId = dsNewPullId();').length - 1, 2,
    'the pull id must be minted at BOTH pull entry points (direct and phone-relay)');
}

/* ---- the storage reason codes survive the allowlist ----------------------- */
{
  const source = slice(connect, 'var DS_SAFE_REASON_CODES = {', 'function dsDiagReport() {', 'reason codes');
  const ctx = { window: {}, navigator: { userAgent: '' }, Date, Math, Number, String, Object, isFinite, JSON };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(source + '\n__out = dsSafeReasonCounts({"quota-exceeded":2,"store-not-migrated":1,"durability-denied":1,"Dr Ada Sample 1980-05-01":3});', ctx);
  eq(ctx.__out['quota-exceeded'], 2, 'quota-exceeded was collapsed to unverified');
  eq(ctx.__out['store-not-migrated'], 1, 'store-not-migrated was collapsed to unverified');
  eq(ctx.__out['durability-denied'], 1, 'durability-denied was collapsed to unverified');
  eq(ctx.__out.unverified, 3, 'an unknown reason string must collapse to "unverified", never pass through');
  ok(JSON.stringify(ctx.__out).indexOf('Ada Sample') < 0,
    'an unallowlisted reason key reached the report verbatim — that is the PHI leak the allowlist exists to stop');
}

console.log(`1p-diag-report-receipts: ${checks} checks passed`);
