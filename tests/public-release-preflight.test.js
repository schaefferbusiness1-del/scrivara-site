'use strict';

const assert = require('assert');
const path = require('path');

const {
  PreflightConfigError,
  loadLocalSnapshot,
  normalizeOrigin,
  parseArgs,
  runPreflight,
  sha256,
  signupManifestSha256,
} = require('../scripts/public-release-preflight.js');

const root = path.resolve(__dirname, '..');
const snapshot = loadLocalSnapshot(root);
const SITE = 'https://site.example.test';
const BACKEND = 'https://backend.example.test';
const REVISION = 'approved-backend-revision-001';
const NOW = Date.parse('2026-07-19T12:00:00.000Z');

function json(value, status = 200) {
  return { status, body: Buffer.from(JSON.stringify(value)), contentType: 'application/json; charset=utf-8' };
}

function html(bytes, status = 200) {
  return { status, body: Buffer.from(bytes), contentType: 'text/html; charset=utf-8' };
}

function validManifest() {
  const terms = snapshot.artifacts.find((item) => item.file === 'terms.html');
  const privacy = snapshot.artifacts.find((item) => item.file === 'privacy.html');
  const authorityText = 'I attest that I am authorized to create and administer this MLS synthetic-evaluation account for my practice.';
  const authoritySha = sha256(Buffer.from(authorityText, 'utf8'));
  const manifestId = 'signup-manifest-2026-07-19';
  const version = '2026.07.19';
  const manifest = {
    schemaVersion: 1,
    purpose: 'account-signup',
    releaseChannel: 'synthetic-evaluation',
    clinicalUseAuthorized: false,
    status: 'approved',
    current: true,
    serverOwned: true,
    immutable: true,
    counselApproved: true,
    counselApprovalRef: 'counsel-evidence-signup-2026-07-19',
    syntheticTestFixture: false,
    manifestId,
    version,
    manifestSha256: '0'.repeat(64),
    approvedAt: '2026-07-18T00:00:00.000Z',
    validUntil: '2027-07-18T00:00:00.000Z',
    documents: [
      { kind: 'terms', documentId: 'terms-release-2026-07-19', version, sha256: terms.sha256, effectiveAt: '2026-07-18T00:00:00.000Z', url: `${SITE}/terms.html`, required: true, status: 'approved' },
      { kind: 'privacy', documentId: 'privacy-release-2026-07-19', version, sha256: privacy.sha256, effectiveAt: '2026-07-18T00:00:00.000Z', url: `${SITE}/privacy.html`, required: true, status: 'approved' },
    ],
    practiceAuthority: {
      status: 'approved', required: true, attestationId: 'practice-authority-2026-07-19', version,
      sha256: authoritySha, effectiveAt: '2026-07-18T00:00:00.000Z', text: authorityText,
      individualAccountOnly: true, sharedCredentialsAuthorized: false,
    },
  };
  manifest.manifestSha256 = signupManifestSha256(manifest);
  return manifest;
}

function successfulResponses() {
  const responses = new Map();
  for (const artifact of snapshot.artifacts) {
    responses.set(new URL(artifact.route, SITE).href, artifact.kind === 'json'
      ? { status: 200, body: Buffer.from(artifact.bytes), contentType: 'application/json; charset=utf-8' }
      : html(artifact.bytes));
  }
  responses.set(`${BACKEND}/api/health`, json({
    ok: true,
    revision: REVISION,
    capabilities: {
      phiEnabled: false,
      clinicalApi: false,
      patientData: false,
      schedule: false,
      noteAi: false,
      storage: false,
      extensionRelay: false,
      communications: false,
    },
    readiness: { clinicalUse: false, reason: 'phi_gate_not_enabled', configurationState: 'disabled' },
  }));
  responses.set(`${BACKEND}/api/readiness`, json({ error: 'Not authenticated' }, 401));
  responses.set(`${BACKEND}/api/agreements/signup-manifest`, json(validManifest()));
  return responses;
}

function fakeFetch(responses, calls) {
  return async (url, options) => {
    calls.push({ url: String(url), options });
    const entry = responses.get(String(url));
    if (!entry) throw new Error(`unexpected test URL: ${url}`);
    return new Response(entry.body, { status: entry.status, headers: { 'Content-Type': entry.contentType, 'Content-Length': String(entry.body.length) } });
  };
}

async function check(responses = successfulResponses()) {
  const calls = [];
  const report = await runPreflight({
    siteOrigin: SITE,
    backendOrigin: BACKEND,
    expectedBackendRevision: REVISION,
    rootDir: root,
    timeoutMs: 2000,
  }, { fetch: fakeFetch(responses, calls), nowMs: NOW });
  return { report, calls };
}

function codes(report) {
  return report.failures.map((failure) => failure.code);
}

(async () => {
  assert.throws(
    () => parseArgs([], {}),
    (error) => error instanceof PreflightConfigError && /explicit approved backend revision/i.test(error.message),
    'missing approved backend revision did not fail before network access'
  );
  assert.strictEqual(parseArgs(['--expected-backend-revision=rev-0001', '--json'], {}).json, true);
  assert.strictEqual(parseArgs([], { MLS_PREFLIGHT_EXPECTED_BACKEND_REVISION: 'env-revision-0001' }).expectedBackendRevision, 'env-revision-0001');
  assert.strictEqual(parseArgs(['--expected-backend-revision=arg-revision-0001'], { MLS_PREFLIGHT_EXPECTED_BACKEND_REVISION: 'env-revision-0001' }).expectedBackendRevision, 'arg-revision-0001');
  assert.throws(() => normalizeOrigin('https://token@example.test?secret=1', 'test origin'), /must not contain credentials/i);
  assert.throws(() => normalizeOrigin('http://example.test', 'test origin'), /must use HTTPS/i);

  const good = await check();
  assert.strictEqual(good.report.ok, true, JSON.stringify(good.report.failures));
  assert.strictEqual(good.report.expected.build, JSON.parse(snapshot.artifacts.find((item) => item.file === 'app-version.json').bytes).build);
  assert.strictEqual(good.report.backend.observedRevision, REVISION);
  assert.strictEqual(good.report.backend.healthClinicalMode, 'public-health-closed');
  assert.strictEqual(good.report.backend.readinessMode, 'auth-protected');
  assert.strictEqual(good.report.public.artifacts.length, 5);
  assert(good.report.public.artifacts.every((item) => item.match), 'exact public/local artifact equality was not recorded');
  assert.strictEqual(good.calls.length, 8, 'preflight did not fetch the exact five public and three backend resources');
  for (const call of good.calls) {
    assert.strictEqual(call.options.method, 'GET', `non-read-only method used for ${call.url}`);
    assert.strictEqual(call.options.redirect, 'manual', `redirect following enabled for ${call.url}`);
    const headers = Object.fromEntries(Object.entries(call.options.headers).map(([key, value]) => [key.toLowerCase(), value]));
    assert.strictEqual(headers.authorization, undefined, `authorization leaked into ${call.url}`);
    assert.strictEqual(headers.cookie, undefined, `cookie leaked into ${call.url}`);
  }

  /* The gate copy is allowed to become clearer; the structural fail-closed
     boundary is not. Prove the preflight rejects a shell that drops it rather
     than pinning the retired "Clinical workspace not enabled" heading. */
  const missingGate = successfulResponses();
  const localScribe = snapshot.artifacts.find((item) => item.file === 'ScribeFlow.html');
  const missingGateBytes = Buffer.from(localScribe.bytes.toString('utf8')
    .replace('id="agreementsGate"', 'id="agreementsGateRemoved"'));
  missingGate.set(`${SITE}/ScribeFlow.html`, html(missingGateBytes));
  const missingGateResult = await check(missingGate);
  assert.strictEqual(missingGateResult.report.ok, false);
  assert(codes(missingGateResult.report).includes('scribeflow_release_boundary_missing'),
    'removing the hosted readiness gate was not reported as a release-boundary failure');

  /* 2026-07-21: the confirmed-HIPAA posture makes "HIPAA compliant" a
     REQUIRED marker; the forbidden class is now unsupported CERTIFICATION /
     audit claims (plus the unchanged BAA/commercial/Athena/outcome rules). */
  const unsafe = successfulResponses();
  const unsafeIndex = Buffer.from(snapshot.artifacts.find((item) => item.file === 'index.html').bytes.toString('utf8').replace('MLS Scribe is HIPAA compliant', 'MLS Scribe is HIPAA certified — BAAs in place — athenahealth live & proven'));
  unsafe.set(`${SITE}/index.html`, html(unsafeIndex));
  const unsafeResult = await check(unsafe);
  assert.strictEqual(unsafeResult.report.ok, false);
  assert(codes(unsafeResult.report).includes('public_hash_mismatch'));
  assert(codes(unsafeResult.report).includes('unsupported_certification_claim'));
  assert(codes(unsafeResult.report).includes('unsupported_baa_claim'));
  assert(codes(unsafeResult.report).includes('unsupported_athena_claim'));

  const missingReadiness = successfulResponses();
  missingReadiness.set(`${BACKEND}/api/readiness`, html(Buffer.from('Cannot GET /api/readiness'), 404));
  const missingReadinessResult = await check(missingReadiness);
  assert.strictEqual(missingReadinessResult.report.ok, false);
  assert(codes(missingReadinessResult.report).includes('backend_readiness_unavailable'));

  const openReadiness = successfulResponses();
  openReadiness.set(`${BACKEND}/api/readiness`, json({ ok: true, readiness: { clinicalUse: true } }));
  const openReadinessResult = await check(openReadiness);
  assert.strictEqual(openReadinessResult.report.ok, false);
  assert(codes(openReadinessResult.report).includes('backend_readiness_open'));

  const openHealth = successfulResponses();
  openHealth.set(`${BACKEND}/api/health`, json({
    ok: true,
    revision: REVISION,
    capabilities: {
      phiEnabled: true,
      clinicalApi: true,
      patientData: true,
      schedule: true,
      noteAi: true,
      storage: true,
      extensionRelay: true,
      communications: true,
    },
    readiness: { clinicalUse: true, reason: 'ready', configurationState: 'enabled' },
  }));
  const openHealthResult = await check(openHealth);
  assert.strictEqual(openHealthResult.report.ok, false);
  assert(codes(openHealthResult.report).includes('backend_health_clinical_state_unverified'), 'PHI-open public health response was not rejected');

  const missingManifest = successfulResponses();
  missingManifest.set(`${BACKEND}/api/agreements/signup-manifest`, html(Buffer.from('Cannot GET /api/agreements/signup-manifest'), 404));
  const missingManifestResult = await check(missingManifest);
  assert.strictEqual(missingManifestResult.report.ok, false);
  assert(codes(missingManifestResult.report).includes('backend_signup_manifest_unavailable'));

  const wrongRevision = successfulResponses();
  const wrongRevisionHealth = JSON.parse(successfulResponses().get(`${BACKEND}/api/health`).body.toString('utf8'));
  wrongRevisionHealth.revision = 'stale-backend-revision';
  wrongRevision.set(`${BACKEND}/api/health`, json(wrongRevisionHealth));
  const wrongRevisionResult = await check(wrongRevision);
  assert.strictEqual(wrongRevisionResult.report.ok, false);
  assert(codes(wrongRevisionResult.report).includes('backend_revision_mismatch'));

  const wrongManifest = successfulResponses();
  const manifest = validManifest();
  manifest.documents[0].sha256 = 'f'.repeat(64);
  wrongManifest.set(`${BACKEND}/api/agreements/signup-manifest`, json(manifest));
  const wrongManifestResult = await check(wrongManifest);
  assert.strictEqual(wrongManifestResult.report.ok, false);
  assert(codes(wrongManifestResult.report).includes('backend_signup_manifest_invalid'));
  assert(wrongManifestResult.report.failures.some((failure) => /Terms document digest/i.test(failure.message)));

  const legacyShortcutManifest = successfulResponses();
  const shortcut = validManifest();
  shortcut.manifestSha256 = sha256(Buffer.from([
    shortcut.manifestId,
    shortcut.version,
    shortcut.documents.find((document) => document.kind === 'terms').sha256,
    shortcut.documents.find((document) => document.kind === 'privacy').sha256,
    shortcut.practiceAuthority.sha256,
  ].join('|'), 'utf8'));
  legacyShortcutManifest.set(`${BACKEND}/api/agreements/signup-manifest`, json(shortcut));
  const legacyShortcutResult = await check(legacyShortcutManifest);
  assert.strictEqual(legacyShortcutResult.report.ok, false);
  assert(legacyShortcutResult.report.failures.some((failure) => /backend canonical signup-manifest pin/i.test(failure.message)),
    'legacy concatenated manifest digest was not rejected');

  const malformedManifest = successfulResponses();
  const missingFixtureFlag = validManifest();
  delete missingFixtureFlag.syntheticTestFixture;
  missingFixtureFlag.manifestSha256 = signupManifestSha256(missingFixtureFlag);
  malformedManifest.set(`${BACKEND}/api/agreements/signup-manifest`, json(missingFixtureFlag));
  const malformedResult = await check(malformedManifest);
  assert.strictEqual(malformedResult.report.ok, false);
  assert(malformedResult.report.failures.some((failure) => /canonical schema|counsel-approved hosted release/i.test(failure.message)),
    'manifest missing an exact backend-required policy field was not rejected');

  const wrongBuild = successfulResponses();
  wrongBuild.set(`${SITE}/app-version.json`, json({ build: 'stale-public-build' }));
  const wrongBuildResult = await check(wrongBuild);
  assert.strictEqual(wrongBuildResult.report.ok, false);
  assert(codes(wrongBuildResult.report).includes('public_build_mismatch'));

  console.log('PASS public release preflight: exact bytes/build/revision, safe copy, GET-only network boundary, readiness and signup-manifest fail-closed checks');
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
