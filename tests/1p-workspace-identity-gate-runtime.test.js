'use strict';

/* P1 must distinguish a transient identity/readiness check from a genuine
 * server denial without weakening the clinical-access wall. Identity and the
 * immutable server grant are separately captured and both are bound to the
 * exact token, account, role fingerprint, and session epoch. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const shells = ['1p/index.html', '1pScribeFlow.html'];
let checks = 0;
function ok(value, message) { checks++; assert(value, message); }
function eq(actual, expected, message) { checks++; assert.strictEqual(actual, expected, message); }
function between(source, start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  assert(a >= 0 && b > a, `missing source region ${start}`);
  return source.slice(a, b);
}
function deferred() {
  let resolve;
  return { promise: new Promise(r => { resolve = r; }), resolve };
}
const validGrant = {
  legalRelease: {
    schemaVersion: 1, status: 'approved', serverOwned: true, immutable: true,
    counselApproved: true, releaseId: 'p1-release-2026.08.13',
    documentSha256: 'a'.repeat(64), approvedAt: '2026-08-01T12:00:00.000Z'
  },
  userAccess: { status: 'granted', serverRecorded: true, releaseId: 'p1-release-2026.08.13' }
};

(async () => {
for (const file of shells) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const helpers = between(source, 'function sfNormalizeSessionAccount(value)', 'function sfSessionPromptValid(');
  const gateHelpers = between(source, "const LEGACY_SERVER_AGREEMENTS_VERSION=", 'async function retryLegalReadiness()');
  const boundary = between(source, 'function sfResetSessionBoundary(nextEmail,opts)', 'window.__mlsResetSessionBoundary=sfResetSessionBoundary;');
  const refresh = between(source, 'function refreshMe(opts)', '/* 401 from the backend');
  const retry = between(source, 'async function retryLegalReadiness()', '/* Build a PDF receipt');

  const state = {
    token: 'token-A',
    bkUser: { email: 'doctor@example.test', role: 'user', hasAccess: true },
    session: { email: 'doctor@example.test' },
    reply: { ok: true, status: 200, json: async () => validGrant },
    requests: [], handled401: 0
  };
  const context = {
    console, Date, Math, JSON, Object, String, Number, Array, RegExp, Promise,
    window: { __mlsSessionEpoch: 7, __mlsSessionAccount: 'doctor@example.test' },
    session: state.session, bkUser: state.bkUser,
    bkToken: () => state.token, getSessionEmail: () => state.session && state.session.email,
    backendMode: () => true, bkBase: () => 'https://api.example.test',
    sfStartupValid: opts => !(opts && opts.cancelled),
    handle401: () => { state.handled401++; },
    fetch: async (url, init) => { state.requests.push({ url, init }); return state.reply; },
    sfP1WorkspaceIdentityEpoch: 0, sfP1WorkspaceIdentityToken: '', sfP1WorkspaceIdentityAccount: '',
    sfP1WorkspaceIdentityFingerprint: '', sfP1WorkspaceGrantFingerprint: '', sfP1WorkspaceGateReason: 'identity-unverified'
  };
  vm.createContext(context);
  vm.runInContext(helpers + '\n' + gateHelpers, context, { filename: file + ':workspace-access' });

  eq(context.sfP1ReleaseWorkspaceIdentity(state.bkUser, state.token), true,
    file + ' rejected a current authenticated identity');
  eq(context.sfP1WorkspaceIdentityCurrent(), true,
    file + ' did not bind the exact identity receipt');
  eq(await context.checkAgreementsGate({}), false,
    file + ' rejected an exact current server-recorded grant');
  eq(context.sfP1WorkspaceGateReason, 'verified',
    file + ' did not distinguish a verified grant');
  ok(context.sfP1WorkspaceGrantFingerprint.includes(validGrant.legalRelease.releaseId),
    file + ' did not bind the immutable grant identity');
  eq(state.requests[0].url, 'https://api.example.test/api/agreements/me',
    file + ' did not use the authoritative access endpoint');
  eq(state.requests[0].init.headers.Authorization, 'Bearer token-A',
    file + ' sent the access check with the wrong token');
  eq(state.requests[0].init.cache, 'no-store', file + ' access check can use a cached grant');
  eq(state.requests[0].init.referrerPolicy, 'no-referrer', file + ' access check can leak a referrer');

  state.reply = { ok: true, status: 200, json: async () => ({
    legalRelease: validGrant.legalRelease,
    userAccess: { status: 'denied', serverRecorded: false, releaseId: null }
  }) };
  eq(await context.checkAgreementsGate({}), true, file + ' revealed a server-denied account');
  eq(context.sfP1WorkspaceGateReason, 'access-denied', file + ' labels a genuine denial as a connection glitch');

  for (const payload of [null, {}, { legalRelease: validGrant.legalRelease }, {
    legalRelease: validGrant.legalRelease,
    userAccess: { status: 'granted', serverRecorded: false, releaseId: validGrant.legalRelease.releaseId }
  }]) {
    state.reply = { ok: true, status: 200, json: async () => payload };
    eq(await context.checkAgreementsGate({}), true, file + ' accepted malformed/revoked grant evidence');
  }

  state.reply = { ok: false, status: 503, json: async () => ({}) };
  eq(await context.checkAgreementsGate({}), true, file + ' revealed on readiness service failure');
  eq(context.sfP1WorkspaceGateReason, 'access-check-unavailable', file + ' service failure was mislabeled as account denial');
  state.reply = { ok: false, status: 401, json: async () => ({}) };
  eq(await context.checkAgreementsGate({}), true, file + ' revealed on 401');
  eq(state.handled401, 1, file + ' did not route a proven expired token to the session owner');

  state.reply = { ok: true, status: 200, json: async () => validGrant };
  const waiting = deferred();
  state.reply = { ok: true, status: 200, json: () => waiting.promise };
  const staleGate = context.checkAgreementsGate({});
  context.window.__mlsSessionEpoch = 8;
  waiting.resolve(validGrant);
  eq(await staleGate, true, file + ' accepted a grant response across a new session epoch');
  eq(context.sfP1WorkspaceGrantFingerprint, '', file + ' retained stale grant proof');
  context.window.__mlsSessionEpoch = 7;

  state.token = 'token-B';
  eq(context.sfP1WorkspaceIdentityCurrent(), false, file + ' accepted a different token');
  state.token = 'token-A';
  context.window.__mlsSessionAccount = 'other@example.test';
  eq(context.sfP1WorkspaceIdentityCurrent(), false, file + ' accepted a different account');
  context.window.__mlsSessionAccount = 'doctor@example.test';
  state.bkUser = context.bkUser = { email: 'doctor@example.test', role: 'receptionist', hasAccess: true };
  eq(context.sfP1WorkspaceIdentityCurrent(), false, file + ' retained a doctor receipt after same-email role change');
  state.bkUser = context.bkUser = { email: 'doctor@example.test', role: 'unknown', hasAccess: true };
  eq(context.sfP1ReleaseWorkspaceIdentity(state.bkUser, state.token), false, file + ' released an unknown role');

  ok(/IdentityFingerprint=''; sfP1WorkspaceGrantFingerprint='';[\s\S]*mls:session-boundary/.test(boundary),
    file + ' does not retire identity/grant proof before session listeners run');
  ok(/authorityChanged[\s\S]*force:authorityChanged/.test(refresh),
    file + ' same-email authorization changes do not force a session boundary');
  ok(/identity-invalid[\s\S]*force:true/.test(refresh),
    file + ' malformed identity does not synchronously close the old session');
  ok(/showAgreementsGate\(false\)/.test(refresh),
    file + ' invalid/changed authority can leave the patient workspace visible');
  ok(retry.indexOf('await refreshMe({});') < retry.indexOf('checkAgreementsGate({})'),
    file + ' Retry does not obtain a fresh identity before the grant check');
  ok(source.includes('agGateDetail') && source.includes("sfP1WorkspaceGateReason==='access-denied'"),
    file + ' does not visibly distinguish a true access denial from a temporary verification problem');
  ok(!source.includes('The clinical workspace is not enabled for this deployment or account.'),
    file + ' still presents the recurring vague deployment/account accusation');
}

const production = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');
ok(production.includes("fetch(bkBase()+'/api/agreements/me'"),
  'the preview-only gate correction changed the production legal gate');

console.log(`PASS P1 exact workspace identity + clinical grant gate (${checks} assertions)`);
})().catch(error => { console.error(error); process.exitCode = 1; });
