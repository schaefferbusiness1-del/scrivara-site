'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const app = read('ScribeFlow.html');
const staging = read('ScribeFlow-staging.html');

function between(source, start, end) {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a + start.length);
  assert(a >= 0 && b > a, `missing source region: ${start}`);
  return source.slice(a, b);
}

// Shared safety pins for both clinician builds. (The onboarding CEREMONY was
// restored in production 2026-07-20 as commercial-paperwork-only; the stale
// staging snapshot still carries the retired state and is pinned as such.)
for (const [name, source] of [['production', app], ['staging', staging]]) {
  assert(source.includes('Clinical workspace not enabled'), `${name} lacks the hosted readiness block`);
  assert(source.includes('Clinical workspace access is checked separately'), `${name} does not distinguish sign-in from workspace access`);
  assert(!source.includes('MLS did not receive the immutable'), `${name} makes an unsupported claim about the owner's agreement records`);
  assert(source.includes('id="legalReturnBtn" disabled'), `${name} legal release control is executable`);
  assert.doesNotMatch(source, /Michael(?: L)? Schaeffer|HIPAA Security (?:&|&amp;) Privacy Officer|Treating Physician/, `${name} hardcodes a signer identity or generic signer fallback`);
  assert(!/onclick="(?:signLegalReport|signAndReturnLegal)\(/i.test(source), `${name} exposes a legal-report signing control`);

  const legalSign = between(source, 'function signAndReturnLegal()', '/* Resilient POST');
  assert(legalSign.indexOf('return false;') < legalSign.indexOf('returnLegalToAttorney()'), `${name} still collapses signing and sending`);
  const legalSend = between(source, 'async function returnLegalToAttorney()', '/* ============ Per-request');
  assert(legalSend.indexOf('return false;') < legalSend.indexOf('/fulfill'), `${name} legal-report release POST is reachable`);
  const legalPay = between(source, 'async function lawPayReport(id, feeCents)', 'function lawViewReport');
  assert(legalPay.indexOf('return false;') < legalPay.indexOf('/pay'), `${name} legal report checkout is reachable`);
  const legalRelease = between(source, 'async function releaseLegalReport(id)', 'function renderLegalDashboard');
  assert(legalRelease.indexOf('return false;') < legalRelease.indexOf('/unlock'), `${name} legal report override release is reachable`);
}

// Staging snapshot: the ceremony stays retired exactly as shipped.
assert(staging.includes('const MLS_AGREEMENTS=Object.freeze([]);'), 'staging must not activate embedded browser agreement templates');
assert(staging.includes('RETIRED_BROWSER_AGREEMENT_TEMPLATES'), 'staging does not label the rollback text inert');
{
  const submit = between(staging, 'async function agSubmitSign()', '/* ---- Admin:');
  assert(submit.indexOf('return false;') < submit.indexOf('/api/agreements/sign'), 'staging legacy agreement POST is reachable');
  const counter = between(staging, 'async function submitCountersign()', '/* Make any string safe');
  assert(counter.indexOf('return false;') < counter.indexOf('/countersign'), 'staging legacy countersign POST is reachable');
}

// Production: the RESTORED ceremony is commercial-paperwork-only and can never
// unlock or lock out clinical use on its own.
assert(app.includes("const AGREEMENTS_VERSION='2026-07-21';"), 'production agreement set must carry the restored version');
assert(app.includes('const MLS_AGREEMENTS=Object.freeze(BROWSER_AGREEMENT_TEMPLATES);'), 'production must activate the restored agreement set');
assert(!app.includes('Retired browser-authored template'), 'the BAA intro must be real agreement text again');
assert(!app.includes('Retired template text.'), 'the BAA flow-down clause must be real agreement text again');
{
  const need = between(app, 'function agCeremonyNeeded()', 'function showAgreementsCeremony(');
  assert(need.includes("classList.contains('mls-public-preview')"), 'the ceremony must never appear in the sample workspace');
  assert(need.includes('bkUser.isLawyer'), 'attorney accounts keep their own portal terms');
  const reveal = between(app, 'if(gated){ try{ showAgreementsGate(true); }catch(e){} }', 'document.documentElement.classList.add');
  assert(reveal.includes('agCeremonyNeeded()'), 'the ceremony shows only after the clinical gate has PASSED');
  const submit = between(app, 'async function agSubmitSign()', '/* ---- Admin:');
  assert(submit.includes("res.status===410||res.status===404"), 'a server without ceremony endpoints must be reported honestly');
  assert(submit.includes('nothing was recorded'), 'the transition message must say nothing was recorded');
  assert(!/legal-release|legal_release_grants|\/api\/admin\/legal-release/.test(submit), 'signing must never touch clinical grant endpoints');
}

// Compatibility contract: the exact current server-recorded legacy agreement is
// accepted, while bare/stale/mixed/contradictory legacy shapes are rejected. The
// newer immutable release plus matching server-recorded grant remains valid.
const predicateSource = between(app, "const LEGACY_SERVER_AGREEMENTS_VERSION='2026-06-10';", '/* Gate check');
const predicateContext = { Number, Date };
vm.createContext(predicateContext);
vm.runInContext(predicateSource, predicateContext, { filename: 'legal-release-predicate.js' });
const verifies = predicateContext.hasVerifiedServerLegalRelease;
assert.strictEqual(typeof verifies, 'function');

const valid = {
  legalRelease: {
    schemaVersion: 1,
    status: 'approved',
    serverOwned: true,
    immutable: true,
    counselApproved: true,
    releaseId: 'clinical-release-2026.07.18',
    documentSha256: 'a'.repeat(64),
    approvedAt: '2026-07-18T12:30:45.000Z'
  },
  userAccess: {
    status: 'granted',
    serverRecorded: true,
    releaseId: 'clinical-release-2026.07.18'
  }
};

assert.strictEqual(verifies(valid), true, 'complete server-owned legal evidence was rejected');
const validLegacy = { signed: true, version: '2026-06-10' };
assert.strictEqual(verifies(validLegacy), true, 'exact current server-recorded legacy agreement was rejected');
for (const bad of [
  null,
  { signed: true },
  { signed: true, version: '2026-06-09' },
  { signed: true, version: 20260610 },
  { signed: 'true', version: '2026-06-10' },
  { signed: false, version: '2026-06-10' },
  { signed: true, version: '2026-06-10', legalRelease: null },
  { signed: true, version: '2026-06-10', userAccess: null },
  { signed: true, version: '2026-06-10', revoked: true },
  { signed: true, version: '2026-06-10', readiness: { clinicalUse: false } },
  { signed: true, version: '2026-06-10', capabilities: { phiEnabled: false } },
  { signed: true, version: '2026-06-10', legal_release: { status: 'revoked' } },
  { capabilities: { phiEnabled: true }, readiness: { clinicalUse: 'ready' } },
  { ...valid, legalRelease: { ...valid.legalRelease, counselApproved: false } },
  { ...valid, legalRelease: { ...valid.legalRelease, immutable: false } },
  { ...valid, legalRelease: { ...valid.legalRelease, serverOwned: false } },
  { ...valid, legalRelease: { ...valid.legalRelease, documentSha256: 'not-a-digest' } },
  { ...valid, userAccess: { ...valid.userAccess, serverRecorded: false } },
  { ...valid, userAccess: { ...valid.userAccess, releaseId: 'different-release' } }
]) {
  assert.strictEqual(verifies(bad), false, 'incomplete or unrelated readiness evidence was accepted');
}

const stagingPredicate = between(staging, "const LEGACY_SERVER_AGREEMENTS_VERSION='2026-06-10';", 'async function checkAgreementsGate()');
assert.strictEqual(stagingPredicate.trim(), predicateSource.trim(), 'staging legal-release predicate drifted from production');

// Exercise the network gate itself. Every hosted error/missing-evidence route is
// gated; only demo/local mode or the exact verified response can return false.
const checkSource = between(app, 'async function checkAgreementsGate(opts)', 'async function retryLegalReadiness()');
async function runGate(options) {
  options = options || {};
  let handled401 = false;
  const context = {
    Number,
    Date,
    backendMode: () => options.hosted !== false,
    bkToken: () => options.token === undefined ? 'token' : options.token,
    bkBase: () => 'https://backend.example',
    sfStartupValid: () => options.startupValid !== false,
    handle401: () => { handled401 = true; },
    fetch: async () => {
      if (options.throwFetch) throw new Error('offline');
      return {
        status: options.status || 200,
        ok: options.ok === undefined ? true : options.ok,
        json: async () => options.payload
      };
    }
  };
  vm.createContext(context);
  vm.runInContext(predicateSource + '\n' + checkSource, context, { filename: 'hosted-legal-gate.js' });
  const gated = await context.checkAgreementsGate({});
  return { gated, handled401 };
}

(async function verifyRuntime() {
  assert.strictEqual((await runGate({ hosted: false })).gated, false, 'synthetic demo/local mode was blocked');
  assert.strictEqual((await runGate({ token: '' })).gated, true, 'hosted access without a token failed open');
  assert.strictEqual((await runGate({ throwFetch: true })).gated, true, 'fetch error failed open');
  assert.strictEqual((await runGate({ status: 503, ok: false })).gated, true, 'server error failed open');
  assert.strictEqual((await runGate({ status: 401, ok: false })).gated, true, 'unauthorized response failed open');
  assert.strictEqual((await runGate({ status: 401, ok: false })).handled401, true, '401 did not retire the session');
  assert.strictEqual((await runGate({ payload: { signed: true } })).gated, true, 'bare legacy signed boolean opened hosted clinical use');
  assert.strictEqual((await runGate({ payload: { signed: true, version: '2026-06-09' } })).gated, true, 'stale legacy agreement opened hosted clinical use');
  assert.strictEqual((await runGate({ payload: { signed: true, version: '2026-06-10', legalRelease: null } })).gated, true, 'mixed malformed response downgraded through legacy agreement fields');
  assert.strictEqual((await runGate({ payload: { signed: true, version: '2026-06-10', revoked: true } })).gated, true, 'contradictory extra legacy field opened hosted clinical use');
  assert.strictEqual((await runGate({ payload: { signed: true, version: '2026-06-10', readiness: { clinicalUse: false } } })).gated, true, 'readiness denial was bypassed by legacy agreement fields');
  assert.strictEqual((await runGate({ payload: valid, startupValid: false })).gated, true, 'late response opened a cancelled startup');
  assert.strictEqual((await runGate({ payload: validLegacy })).gated, false, 'exact current legacy agreement did not open the hosted gate');
  assert.strictEqual((await runGate({ payload: valid })).gated, false, 'exact verified server release did not open the hosted gate');

  const startup = between(app, 'function startSession(email)', 'function logout(force)');
  assert(startup.includes('const _gateMode = backendMode();'), 'hosted startSession can bypass readiness when its token is missing');
  assert(startup.includes('!bkToken()?Promise.resolve(true):_identityReady.then(()=>checkAgreementsGate(_startupOpts)).catch(()=>true)'), 'missing auth or identity/readiness rejection can reveal the hosted app');
  assert(startup.includes('resolve(true);') && startup.includes('resolve(_gateDecision===false?false:true);'), 'readiness or absolute timeout can reveal the hosted app');
  assert(startup.includes('sfHideGateLoading(true)'), 'startup rejection no longer hands off to the blocking gate');
  assert(app.includes('sfHideGateLoading(backendMode(),{force:true})'), 'loader force-release can reveal a hosted app without evidence');
  assert(app.includes("new URLSearchParams(location.search).get('demo') === '1'"), 'explicit synthetic demo routing was removed');

  const publicFiles = [
    'index.html', 'index-staging.html', 'ScribeFlow_Website.html', 'privacy.html',
    'assist-privacy.html', 'popup.html', 'expert.html', 'lawyers.html', 'feat_mls_simple_exact.js'
  ];
  const publicCopy = publicFiles.map(read).join('\n');
  assert.doesNotMatch(publicCopy, /fully\s+HIPAA|HIPAA[- ]compliant|HIPAA[- ]ready|BAAs?\s+in\s+place|Business Associate Agreements?\s+(?:are\s+)?signed|under\s+a\s+signed\s+BAA|signed Business Associate Agreements?/i, 'public/privacy/extension copy contains an unsupported affirmative compliance or BAA claim');

  const lawyers = read('lawyers.html');
  assert(!lawyers.includes('formsubmit.co'), 'public legal intake can still send case details to a generic email form');
  assert(lawyers.includes('<form class="req-form" action="#" method="get"'), 'public legal form does not fail locally');
  const intake = between(lawyers, 'async function submitRequest(e)', '/* ---------- init');
  const externalDelivery = intake.indexOf('fetch(REQUEST_ENDPOINT');
  assert(externalDelivery === -1 || intake.indexOf('return false;') < externalDelivery, 'public legal intake still reaches external delivery');

  console.log('PASS legal readiness safety: hosted failures gate closed, restored ceremony is commercial-only (staging keeps retirement), synthetic demo preserved, and public/vendor claims constrained');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
