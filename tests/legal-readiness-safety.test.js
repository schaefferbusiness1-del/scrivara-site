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

// The browser-owned contract/signature UI is gone from both clinician builds.
for (const [name, source] of [['production', app], ['staging', staging]]) {
  assert(source.includes('const MLS_AGREEMENTS=Object.freeze([]);'), `${name} still activates embedded browser agreement templates`);
  assert(source.includes('RETIRED_BROWSER_AGREEMENT_TEMPLATES'), `${name} does not label the rollback text inert`);
  assert(!/<input[^>]+id="(?:agSignName|csName)"/i.test(source), `${name} still renders a legal-name signing input`);
  assert(!/<canvas[^>]+id="(?:agSigPad|csSigPad)"/i.test(source), `${name} still renders a signature pad`);
  assert(!/onclick="(?:agSubmitSign|submitCountersign|signLegalReport|signAndReturnLegal)\(/i.test(source), `${name} still exposes a browser signing control`);
  assert(source.includes('Clinical workspace not released'), `${name} lacks the hosted readiness block`);
  assert(source.includes('Synthetic evaluation only'), `${name} does not identify the allowed data mode`);
  assert(source.includes('id="legalReturnBtn" disabled'), `${name} legal release control is executable`);
  assert.doesNotMatch(source, /Michael(?: L)? Schaeffer|HIPAA Security (?:&|&amp;) Privacy Officer|Treating Physician/, `${name} hardcodes a signer identity or generic signer fallback`);

  const submit = between(source, 'async function agSubmitSign()', '/* ---- Admin:');
  assert(submit.indexOf('return false;') < submit.indexOf('/api/agreements/sign'), `${name} legacy agreement POST is reachable`);
  const counter = between(source, 'async function submitCountersign()', '/* Make any string safe');
  assert(counter.indexOf('return false;') < counter.indexOf('/countersign'), `${name} legacy countersign POST is reachable`);
  const legalSign = between(source, 'function signAndReturnLegal()', '/* Resilient POST');
  assert(legalSign.indexOf('return false;') < legalSign.indexOf('returnLegalToAttorney()'), `${name} still collapses signing and sending`);
  const legalSend = between(source, 'async function returnLegalToAttorney()', '/* ============ Per-request');
  assert(legalSend.indexOf('return false;') < legalSend.indexOf('/fulfill'), `${name} legal-report release POST is reachable`);
  const legalPay = between(source, 'async function lawPayReport(id, feeCents)', 'function lawViewReport');
  assert(legalPay.indexOf('return false;') < legalPay.indexOf('/pay'), `${name} legal report checkout is reachable`);
  const legalRelease = between(source, 'async function releaseLegalReport(id)', 'function renderLegalDashboard');
  assert(legalRelease.indexOf('return false;') < legalRelease.indexOf('/unlock'), `${name} legal report override release is reachable`);
}

// Strict future server contract: operational PHI flags and legacy signed booleans
// are intentionally insufficient. The release needs immutable counsel evidence and
// a server-recorded grant tied to that exact release.
const predicateSource = between(app, 'function hasVerifiedServerLegalRelease(payload)', '/* Gate check');
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
for (const bad of [
  null,
  { signed: true },
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

const stagingPredicate = between(staging, 'function hasVerifiedServerLegalRelease(payload)', 'async function checkAgreementsGate()');
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
  assert.strictEqual((await runGate({ payload: { signed: true } })).gated, true, 'legacy signed boolean opened hosted clinical use');
  assert.strictEqual((await runGate({ payload: valid, startupValid: false })).gated, true, 'late response opened a cancelled startup');
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

  console.log('PASS legal readiness safety: hosted failures gate closed, browser ceremony retired, synthetic demo preserved, and public/vendor claims constrained');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
