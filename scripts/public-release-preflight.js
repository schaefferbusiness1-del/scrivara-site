'use strict';

/*
 * Read-only public release preflight.
 *
 * The script performs only unauthenticated GET requests. It never accepts an
 * authorization header, cookie, API key, or mutation endpoint. The approved
 * backend revision must be supplied explicitly so a stale backend can never be
 * treated as current merely because it is reachable.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DEFAULT_SITE_ORIGIN = 'https://mlsscribe.com';
const DEFAULT_BACKEND_ORIGIN = 'https://scrivara-backend.onrender.com';
const DEFAULT_TIMEOUT_MS = 15000;
const MAX_JSON_BYTES = 1024 * 1024;

const PUBLIC_ARTIFACTS = Object.freeze([
  Object.freeze({ file: 'index.html', route: '/index.html', kind: 'html', maxBytes: 2 * 1024 * 1024 }),
  Object.freeze({ file: 'terms.html', route: '/terms.html', kind: 'html', maxBytes: 1024 * 1024 }),
  Object.freeze({ file: 'privacy.html', route: '/privacy.html', kind: 'html', maxBytes: 1024 * 1024 }),
  Object.freeze({ file: 'ScribeFlow.html', route: '/ScribeFlow.html', kind: 'html', maxBytes: 8 * 1024 * 1024 }),
  Object.freeze({ file: 'app-version.json', route: '/app-version.json', kind: 'json', maxBytes: 64 * 1024 }),
]);

/* 2026-07-21 (owner directive): MLS Scribe is confirmed HIPAA compliant. The
   required markers move from the synthetic-era posture to the accurate one:
   the pages must STATE the confirmed HIPAA posture, must NOT imply an
   independent certification/audit, and every purchasing/BAA/commercial/
   outcome honesty rule stays in force. */
const REQUIRED_PUBLIC_MARKERS = Object.freeze({
  'index.html': Object.freeze([
    Object.freeze({ label: 'confirmed HIPAA posture', re: /MLS Scribe is HIPAA compliant/i }),
    Object.freeze({ label: 'no certification/audit claim', re: /No independent certification/i }),
    Object.freeze({ label: 'checkout hold', re: /checkout and subscriptions are disabled/i }),
  ]),
  'terms.html': Object.freeze([
    Object.freeze({ label: 'current Terms title', re: /Evaluation & Site Terms/i }),
    Object.freeze({ label: 'PHI scoped to authorized accounts', re: /Enter PHI only through an authorized, signed-in account/i }),
    Object.freeze({ label: 'BAA non-execution boundary', re: /No BAA is executed by these terms/i }),
  ]),
  'privacy.html': Object.freeze([
    Object.freeze({ label: 'confirmed HIPAA posture', re: /MLS Scribe is HIPAA compliant/i }),
    Object.freeze({ label: 'clinical gate requirement', re: /Hosted clinical access must remain locked/i }),
    Object.freeze({ label: 'no certification/audit claim', re: /makes no claim of independent certification/i }),
  ]),
});

const FORBIDDEN_PUBLIC_CLAIMS = Object.freeze([
  Object.freeze({ code: 'unsupported_certification_claim', label: 'independent HIPAA certification/audit claim', re: /\bHIPAA[-\s]+(?:certified|audited)\b/i }),
  Object.freeze({ code: 'unsupported_baa_claim', label: 'affirmative BAA-in-place claim', re: /\bBAAs?\s+in\s+place\b/i }),
  Object.freeze({ code: 'unsupported_baa_claim', label: 'affirmative signed Business Associate Agreement claim', re: /\bBusiness Associate Agreements?\s+(?:are\s+)?signed\b/i }),
  Object.freeze({ code: 'unsupported_baa_claim', label: 'affirmative signed BAA claim', re: /\bsigned\s+(?:vendor\s+)?BAAs?\b/i }),
  Object.freeze({ code: 'unsupported_baa_claim', label: 'affirmative practice BAA promise', re: /\b(?:will\s+)?enter(?:s)?\s+into\s+a\s+Business Associate Agreement\b/i }),
  Object.freeze({ code: 'unsupported_baa_claim', label: 'automatic practice BAA execution claim', re: /\bexecute\s+one\s+with\s+every\s+practice\b/i }),
  Object.freeze({ code: 'unsupported_commercial_claim', label: 'automatic subscription renewal claim', re: /\bSubscriptions?\s+renew(?:s)?\s+automatically\b/i }),
  Object.freeze({ code: 'unsupported_commercial_claim', label: 'active paid-plan billing claim', re: /\bPaid plans?\s+(?:are|is)\s+billed\b/i }),
  Object.freeze({ code: 'unsupported_commercial_claim', label: 'active monthly/annual purchase claim', re: /\bPay\s+monthly\s+or\s+annually\b/i }),
  Object.freeze({ code: 'unsupported_commercial_claim', label: 'active founder-reward claim', re: /\bFounder rewards?[^.]{0,120}\bhonored\b/i }),
  Object.freeze({ code: 'unsupported_commercial_claim', label: 'active legal-platform fee claim', re: /(?:\bcurrently\s+5%\b|\b5%\s+platform fee\b)/i }),
  Object.freeze({ code: 'unsupported_athena_claim', label: 'Athena live-and-proven claim', re: /\bathena(?:health|One)?[^.]{0,100}\blive\s*(?:&|and)\s*proven\b/i }),
  Object.freeze({ code: 'unsupported_athena_claim', label: 'perfect Athena integration claim', re: /\bworks?\s+perfectly\s+with\s+athena(?:health|One)?\b/i }),
  Object.freeze({ code: 'unsupported_athena_claim', label: 'Athena live-today claim', re: /\bathena(?:health|One)?[^.]{0,100}\blive\s+today\b/i }),
  Object.freeze({ code: 'unsupported_athena_claim', label: 'unsupported end-to-end integration verification claim', re: /\bverified\s+the\s+deep\s+integration\s+end\s+to\s+end\b/i }),
  Object.freeze({ code: 'unsupported_outcome_claim', label: 'unsupported time-savings claim', re: /\b3\s+hours?\s+saved\s+a\s+day\b/i }),
]);

class PreflightConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PreflightConfigError';
  }
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function exactKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

/* Keep this byte-for-byte compatible with the backend's
 * src/signupAgreement.js::signupManifestSha256(). Release preflight must
 * validate the exact server pin, not a second, weaker digest recipe. The
 * manifestSha256 field deliberately does not bind itself. */
function signupManifestMaterial(manifest) {
  return {
    schemaVersion: manifest.schemaVersion,
    purpose: manifest.purpose,
    releaseChannel: manifest.releaseChannel,
    clinicalUseAuthorized: manifest.clinicalUseAuthorized,
    status: manifest.status,
    current: manifest.current,
    serverOwned: manifest.serverOwned,
    immutable: manifest.immutable,
    counselApproved: manifest.counselApproved,
    counselApprovalRef: manifest.counselApprovalRef,
    syntheticTestFixture: manifest.syntheticTestFixture,
    manifestId: manifest.manifestId,
    version: manifest.version,
    approvedAt: manifest.approvedAt,
    validUntil: manifest.validUntil,
    documents: [...manifest.documents]
      .sort((a, b) => a.kind.localeCompare(b.kind))
      .map((document) => ({
        kind: document.kind,
        documentId: document.documentId,
        version: document.version,
        sha256: document.sha256,
        effectiveAt: document.effectiveAt,
        url: document.url,
        required: document.required,
        status: document.status,
      })),
    practiceAuthority: {
      status: manifest.practiceAuthority.status,
      required: manifest.practiceAuthority.required,
      attestationId: manifest.practiceAuthority.attestationId,
      version: manifest.practiceAuthority.version,
      sha256: manifest.practiceAuthority.sha256,
      effectiveAt: manifest.practiceAuthority.effectiveAt,
      text: manifest.practiceAuthority.text,
      individualAccountOnly: manifest.practiceAuthority.individualAccountOnly,
      sharedCredentialsAuthorized: manifest.practiceAuthority.sharedCredentialsAuthorized,
    },
  };
}

function signupManifestSha256(manifest) {
  return sha256(Buffer.from(JSON.stringify(signupManifestMaterial(manifest)), 'utf8'));
}

function safeJsonParse(bytes, label) {
  try {
    return JSON.parse(Buffer.from(bytes).toString('utf8'));
  } catch {
    throw new Error(`${label} did not return valid JSON`);
  }
}

function htmlVisibleText(source) {
  return String(source || '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&ndash;|&#8211;/gi, '-')
    .replace(/&mdash;|&#8212;/gi, '-')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeOrigin(value, label) {
  let parsed;
  try {
    parsed = new URL(String(value || ''));
  } catch {
    throw new PreflightConfigError(`${label} must be an absolute URL origin`);
  }
  const loopback = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost' || parsed.hostname === '[::1]';
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopback)) {
    throw new PreflightConfigError(`${label} must use HTTPS (HTTP is allowed only for loopback tests)`);
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new PreflightConfigError(`${label} must not contain credentials, a query, or a fragment`);
  }
  if (parsed.pathname !== '/' && parsed.pathname !== '') {
    throw new PreflightConfigError(`${label} must be an origin without a path`);
  }
  return parsed.origin;
}

function validateRevision(value) {
  const revision = typeof value === 'string' ? value : '';
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{3,127}$/.test(revision)) {
    throw new PreflightConfigError('An explicit approved backend revision is required (--expected-backend-revision or MLS_PREFLIGHT_EXPECTED_BACKEND_REVISION)');
  }
  return revision;
}

function parseTimeout(value) {
  const timeout = value === undefined || value === '' ? DEFAULT_TIMEOUT_MS : Number(value);
  if (!Number.isInteger(timeout) || timeout < 100 || timeout > 60000) {
    throw new PreflightConfigError('timeout must be an integer from 100 through 60000 milliseconds');
  }
  return timeout;
}

function parseArgs(argv, env = process.env) {
  const out = {
    siteOrigin: env.MLS_PREFLIGHT_SITE_ORIGIN || DEFAULT_SITE_ORIGIN,
    backendOrigin: env.MLS_PREFLIGHT_BACKEND_ORIGIN || DEFAULT_BACKEND_ORIGIN,
    expectedBackendRevision: env.MLS_PREFLIGHT_EXPECTED_BACKEND_REVISION || '',
    rootDir: path.resolve(__dirname, '..'),
    timeoutMs: env.MLS_PREFLIGHT_TIMEOUT_MS || DEFAULT_TIMEOUT_MS,
    json: false,
    help: false,
  };

  for (const arg of argv) {
    if (arg === '--json') out.json = true;
    else if (arg === '--help' || arg === '-h') out.help = true;
    else if (arg.startsWith('--site-origin=')) out.siteOrigin = arg.slice('--site-origin='.length);
    else if (arg.startsWith('--backend-origin=')) out.backendOrigin = arg.slice('--backend-origin='.length);
    else if (arg.startsWith('--expected-backend-revision=')) out.expectedBackendRevision = arg.slice('--expected-backend-revision='.length);
    else if (arg.startsWith('--root=')) out.rootDir = arg.slice('--root='.length);
    else if (arg.startsWith('--timeout-ms=')) out.timeoutMs = arg.slice('--timeout-ms='.length);
    else throw new PreflightConfigError(`Unknown argument: ${arg}`);
  }

  if (out.help) return out;
  out.siteOrigin = normalizeOrigin(out.siteOrigin, 'site origin');
  out.backendOrigin = normalizeOrigin(out.backendOrigin, 'backend origin');
  out.expectedBackendRevision = validateRevision(out.expectedBackendRevision);
  out.rootDir = path.resolve(out.rootDir);
  out.timeoutMs = parseTimeout(out.timeoutMs);
  return out;
}

function usage() {
  return [
    'Usage: node scripts/public-release-preflight.js --expected-backend-revision=REVISION [options]',
    '',
    'Read-only checks:',
    '  - exact public/local SHA-256 equality for index, Terms, Privacy, ScribeFlow, and app-version',
    '  - forbidden unsupported HIPAA, BAA, commercial, outcome, and Athena-live claims',
    '  - exact backend health revision and a present, safely closed/auth-protected readiness route',
    '  - a current public signup manifest bound to the exact local Terms/Privacy bytes',
    '',
    'Options:',
    `  --site-origin=URL                 Default: ${DEFAULT_SITE_ORIGIN}`,
    `  --backend-origin=URL              Default: ${DEFAULT_BACKEND_ORIGIN}`,
    '  --expected-backend-revision=REV  Required; may use MLS_PREFLIGHT_EXPECTED_BACKEND_REVISION',
    '  --root=PATH                       Local reviewed web root (default: repository root)',
    `  --timeout-ms=N                    100-60000 (default: ${DEFAULT_TIMEOUT_MS})`,
    '  --json                            Emit the deterministic JSON report',
    '',
    'No authentication value is accepted. Every network request is an unauthenticated GET.',
  ].join('\n');
}

function loadLocalSnapshot(rootDir) {
  const artifacts = PUBLIC_ARTIFACTS.map((spec) => {
    const filePath = path.join(rootDir, spec.file);
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      throw new PreflightConfigError(`Required local artifact is missing: ${spec.file}`);
    }
    const bytes = fs.readFileSync(filePath);
    return Object.freeze({ ...spec, bytes, sha256: sha256(bytes) });
  });
  const appVersionArtifact = artifacts.find((item) => item.file === 'app-version.json');
  const appVersion = safeJsonParse(appVersionArtifact.bytes, 'local app-version.json');
  if (!appVersion || typeof appVersion.build !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{3,127}$/.test(appVersion.build)) {
    throw new PreflightConfigError('Local app-version.json does not contain a valid build');
  }
  return Object.freeze({ build: appVersion.build, artifacts: Object.freeze(artifacts) });
}

async function readBodyLimited(response, maxBytes) {
  const declared = Number(response.headers && response.headers.get && response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error(`response exceeds ${maxBytes} bytes`);
  if (!response.body || typeof response.body.getReader !== 'function') {
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > maxBytes) throw new Error(`response exceeds ${maxBytes} bytes`);
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    length += part.value.byteLength;
    if (length > maxBytes) {
      try { await reader.cancel(); } catch { /* best effort */ }
      throw new Error(`response exceeds ${maxBytes} bytes`);
    }
    chunks.push(Buffer.from(part.value));
  }
  return Buffer.concat(chunks, length);
}

async function fetchResource(fetchImpl, url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      redirect: 'manual',
      signal: controller.signal,
      headers: {
        Accept: options.accept,
        'Cache-Control': 'no-cache',
      },
    });
    if (!response || typeof response.status !== 'number') throw new Error('invalid HTTP response');
    if (response.status >= 300 && response.status < 400) throw new Error(`redirects are not accepted (HTTP ${response.status})`);
    const bytes = await readBodyLimited(response, options.maxBytes);
    return {
      url,
      status: response.status,
      contentType: String(response.headers && response.headers.get ? response.headers.get('content-type') || '' : ''),
      bytes,
      sha256: sha256(bytes),
    };
  } catch (error) {
    if (error && error.name === 'AbortError') throw new Error(`request timed out after ${options.timeoutMs}ms`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function addFailure(failures, code, target, message) {
  failures.push({ code, target, message });
}

function requireContentType(observation, expected, failures, target) {
  const okay = expected === 'json'
    ? /(?:application|text)\/(?:[\w.+-]*\+)?json\b/i.test(observation.contentType)
    : /text\/html\b/i.test(observation.contentType);
  if (!okay) addFailure(failures, 'unexpected_content_type', target, `Expected ${expected}, received ${observation.contentType || 'no content type'}`);
}

function inspectPublicCopy(file, source, failures) {
  const visible = htmlVisibleText(source);
  const required = REQUIRED_PUBLIC_MARKERS[file] || [];
  for (const marker of required) {
    if (!marker.re.test(visible)) addFailure(failures, 'required_release_marker_missing', file, `Missing ${marker.label}`);
  }
  if (file === 'index.html' || file === 'terms.html' || file === 'privacy.html') {
    for (const claim of FORBIDDEN_PUBLIC_CLAIMS) {
      if (claim.re.test(visible)) addFailure(failures, claim.code, file, `Found ${claim.label}`);
    }
  }
}

function inspectScribeFlow(source, failures) {
  /* Ceremony restored 2026-07-20: the onboarding signature ceremony is present
     BY DESIGN and is commercial-paperwork-only. The release boundary now pins
     (a) the restored agreement set, (b) the untouched server-owned clinical
     gate, and (c) the safety guards that keep the ceremony out of the sample
     workspace and off the clinical grant surface. */
  for (const marker of [
    "const AGREEMENTS_VERSION='2026-07-21';",
    'const MLS_AGREEMENTS=Object.freeze(BROWSER_AGREEMENT_TEMPLATES);',
    'id="agreementsGate"',
    'id="agGateErr"',
    'Synthetic evaluation only',
    'const MLS_LEGAL_WORKSPACE_RELEASED=false;',
    'function hasVerifiedServerLegalRelease(payload)',
    'function agCeremonyNeeded()',
  ]) {
    if (!source.includes(marker)) addFailure(failures, 'scribeflow_release_boundary_missing', 'ScribeFlow.html', `Missing marker: ${marker}`);
  }
  const need = source.slice(source.indexOf('function agCeremonyNeeded()'), source.indexOf('function showAgreementsCeremony('));
  if (!need.includes("classList.contains('mls-public-preview')")) {
    addFailure(failures, 'ceremony_guard_missing', 'ScribeFlow.html', 'Ceremony is not excluded from the sample workspace');
  }
  const submit = source.slice(source.indexOf('async function agSubmitSign()'), source.indexOf('/* ---- Admin:'));
  if (/\/api\/admin\/legal-release/.test(submit)) {
    addFailure(failures, 'ceremony_touches_clinical_grants', 'ScribeFlow.html', 'Signing flow references clinical grant endpoints');
  }
}

function isStableId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(value);
}

function isVersion(value) {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:+-]{0,63}$/.test(value);
}

function isSha(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function isUtcInstant(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) && Number.isFinite(Date.parse(value));
}

function isHttpsDocumentUrl(value) {
  if (typeof value !== 'string' || !value) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.hash;
  } catch {
    return false;
  }
}

function validateSignupManifest(manifest, snapshot, siteOrigin, nowMs) {
  const errors = [];
  if (!manifest || typeof manifest !== 'object') return ['manifest is not an object'];
  const topKeys = [
    'schemaVersion', 'purpose', 'releaseChannel', 'clinicalUseAuthorized',
    'status', 'current', 'serverOwned', 'immutable', 'counselApproved',
    'counselApprovalRef', 'syntheticTestFixture', 'manifestId', 'version', 'manifestSha256',
    'approvedAt', 'validUntil', 'documents', 'practiceAuthority',
  ];
  if (!exactKeys(manifest, topKeys)) errors.push('manifest shape does not match the backend canonical schema');
  if (manifest.schemaVersion !== 1 || manifest.purpose !== 'account-signup') errors.push('schema/purpose mismatch');
  if (manifest.releaseChannel !== 'synthetic-evaluation' || manifest.clinicalUseAuthorized !== false) errors.push('manifest must authorize synthetic evaluation only');
  if (manifest.status !== 'approved' || manifest.current !== true || manifest.serverOwned !== true || manifest.immutable !== true || manifest.counselApproved !== true || manifest.syntheticTestFixture !== false) {
    errors.push('manifest is not a current immutable server-owned counsel-approved hosted release');
  }
  if (!isStableId(manifest.manifestId) || !isVersion(manifest.version) || !isSha(manifest.manifestSha256)) errors.push('manifest identity/version/digest is invalid');
  if (!isStableId(manifest.counselApprovalRef)) errors.push('manifest counsel approval evidence reference is invalid');
  if (!isUtcInstant(manifest.approvedAt) || Date.parse(manifest.approvedAt) > nowMs) errors.push('manifest approval time is invalid or in the future');
  if (!isUtcInstant(manifest.validUntil) || Date.parse(manifest.validUntil) <= nowMs) errors.push('manifest is expired or lacks a validUntil time');
  if (isUtcInstant(manifest.approvedAt) && isUtcInstant(manifest.validUntil) && Date.parse(manifest.validUntil) <= Date.parse(manifest.approvedAt)) errors.push('manifest validity window is invalid');

  const expectedFiles = { terms: 'terms.html', privacy: 'privacy.html' };
  const docs = Array.isArray(manifest.documents) ? manifest.documents : [];
  if (docs.length !== 2) errors.push('manifest must contain exactly Terms and Privacy documents');
  const documentKeys = ['kind', 'documentId', 'version', 'sha256', 'effectiveAt', 'url', 'required', 'status'];
  const normalized = Object.create(null);
  for (const doc of docs) {
    const kind = doc && doc.kind;
    if (!Object.prototype.hasOwnProperty.call(expectedFiles, kind) || normalized[kind]) {
      errors.push('manifest contains a duplicate or unsupported document kind');
      continue;
    }
    const local = snapshot.artifacts.find((item) => item.file === expectedFiles[kind]);
    if (!exactKeys(doc, documentKeys) || doc.required !== true || doc.status !== 'approved' || !isStableId(doc.documentId) || !isVersion(doc.version) || !isSha(doc.sha256) || !isUtcInstant(doc.effectiveAt) || Date.parse(doc.effectiveAt) > nowMs || !isHttpsDocumentUrl(doc.url)) {
      errors.push(`${kind} document metadata is invalid`);
    }
    if (doc.sha256 !== local.sha256) errors.push(`${kind} document digest does not match the reviewed local bytes`);
    let documentUrl = null;
    try { documentUrl = new URL(doc.url, siteOrigin); } catch { /* reported below */ }
    const expectedUrl = new URL(`/${expectedFiles[kind]}`, siteOrigin);
    if (!documentUrl || documentUrl.username || documentUrl.password || documentUrl.search || documentUrl.hash || documentUrl.href !== expectedUrl.href) {
      errors.push(`${kind} document URL is not the exact reviewed public route`);
    }
    normalized[kind] = doc;
  }

  const authority = manifest.practiceAuthority;
  const authorityKeys = [
    'status', 'required', 'attestationId', 'version', 'sha256', 'effectiveAt',
    'text', 'individualAccountOnly', 'sharedCredentialsAuthorized',
  ];
  if (!exactKeys(authority, authorityKeys) || authority.status !== 'approved' || authority.required !== true || !isStableId(authority.attestationId) || !isVersion(authority.version) || !isSha(authority.sha256) || !isUtcInstant(authority.effectiveAt) || Date.parse(authority.effectiveAt) > nowMs) {
    errors.push('practice-authority attestation metadata is invalid');
  } else {
    if (typeof authority.text !== 'string' || authority.text !== authority.text.trim() || authority.text.length < 24 || authority.text.length > 600 || authority.individualAccountOnly !== true || authority.sharedCredentialsAuthorized !== false) {
      errors.push('practice-authority attestation policy is invalid');
    } else if (sha256(Buffer.from(authority.text, 'utf8')) !== authority.sha256) {
      errors.push('practice-authority attestation digest does not match its text');
    }
  }

  if (normalized.terms && normalized.privacy && authority && isSha(authority.sha256)) {
    if (signupManifestSha256(manifest) !== manifest.manifestSha256) errors.push('manifest digest does not match the backend canonical signup-manifest pin');
  }
  return errors;
}

async function runPreflight(options, dependencies = {}) {
  const fetchImpl = dependencies.fetch || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new PreflightConfigError('This Node runtime does not provide fetch');
  const nowMs = dependencies.nowMs === undefined ? Date.now() : Number(dependencies.nowMs);
  if (!Number.isFinite(nowMs)) throw new PreflightConfigError('nowMs must be a finite timestamp');

  const siteOrigin = normalizeOrigin(options.siteOrigin, 'site origin');
  const backendOrigin = normalizeOrigin(options.backendOrigin, 'backend origin');
  const expectedBackendRevision = validateRevision(options.expectedBackendRevision);
  const timeoutMs = parseTimeout(options.timeoutMs);
  const snapshot = loadLocalSnapshot(path.resolve(options.rootDir));
  const failures = [];
  const publicResults = [];

  const publicFetches = await Promise.all(snapshot.artifacts.map(async (artifact) => {
    const url = new URL(artifact.route, siteOrigin).href;
    try {
      const observation = await fetchResource(fetchImpl, url, {
        timeoutMs,
        maxBytes: artifact.maxBytes,
        accept: artifact.kind === 'json' ? 'application/json' : 'text/html',
      });
      return { artifact, observation };
    } catch (error) {
      return { artifact, error };
    }
  }));

  for (const item of publicFetches) {
    const artifact = item.artifact;
    if (item.error) {
      addFailure(failures, 'public_artifact_unavailable', artifact.file, item.error.message || 'request failed');
      publicResults.push({ file: artifact.file, url: new URL(artifact.route, siteOrigin).href, status: null, expectedSha256: artifact.sha256, observedSha256: null, match: false });
      continue;
    }
    const observation = item.observation;
    publicResults.push({ file: artifact.file, url: observation.url, status: observation.status, expectedSha256: artifact.sha256, observedSha256: observation.sha256, match: observation.status === 200 && observation.sha256 === artifact.sha256 });
    if (observation.status !== 200) addFailure(failures, 'public_artifact_unavailable', artifact.file, `Expected HTTP 200, received ${observation.status}`);
    requireContentType(observation, artifact.kind, failures, artifact.file);
    if (observation.sha256 !== artifact.sha256) addFailure(failures, 'public_hash_mismatch', artifact.file, `Observed ${observation.sha256}; expected ${artifact.sha256}`);
    if (artifact.kind === 'html') {
      const source = Buffer.from(observation.bytes).toString('utf8');
      inspectPublicCopy(artifact.file, source, failures);
      if (artifact.file === 'ScribeFlow.html') inspectScribeFlow(source, failures);
    } else if (artifact.file === 'app-version.json') {
      try {
        const remoteVersion = safeJsonParse(observation.bytes, 'public app-version.json');
        if (!remoteVersion || remoteVersion.build !== snapshot.build) addFailure(failures, 'public_build_mismatch', artifact.file, `Observed build ${remoteVersion && remoteVersion.build ? remoteVersion.build : '(missing)'}; expected ${snapshot.build}`);
      } catch (error) {
        addFailure(failures, 'public_build_invalid', artifact.file, error.message);
      }
    }
  }

  const backendSpecs = [
    { key: 'health', route: '/api/health' },
    { key: 'readiness', route: '/api/readiness' },
    { key: 'signupManifest', route: '/api/agreements/signup-manifest' },
  ];
  const backendObservations = Object.create(null);
  const backendFetches = await Promise.all(backendSpecs.map(async (spec) => {
    const url = new URL(spec.route, backendOrigin).href;
    try {
      return { spec, observation: await fetchResource(fetchImpl, url, { timeoutMs, maxBytes: MAX_JSON_BYTES, accept: 'application/json' }) };
    } catch (error) {
      return { spec, error };
    }
  }));
  for (const item of backendFetches) {
    if (item.error) {
      addFailure(failures, `backend_${item.spec.key}_unavailable`, item.spec.route, item.error.message || 'request failed');
      backendObservations[item.spec.key] = { status: null, url: new URL(item.spec.route, backendOrigin).href };
    } else {
      backendObservations[item.spec.key] = item.observation;
    }
  }

  let observedRevision = null;
  let healthClinicalMode = null;
  const health = backendObservations.health;
  if (health && health.status !== null) {
    if (health.status !== 200) addFailure(failures, 'backend_health_unavailable', '/api/health', `Expected HTTP 200, received ${health.status}`);
    requireContentType(health, 'json', failures, '/api/health');
    try {
      const body = safeJsonParse(health.bytes, 'backend health');
      observedRevision = body && body.revision;
      if (!body || body.ok !== true) addFailure(failures, 'backend_health_invalid', '/api/health', 'Health response did not report ok=true');
      if (observedRevision !== expectedBackendRevision) addFailure(failures, 'backend_revision_mismatch', '/api/health', `Observed ${observedRevision || '(missing)'}; expected ${expectedBackendRevision}`);
      const clinicalCapabilityKeys = ['phiEnabled', 'clinicalApi', 'patientData', 'schedule', 'noteAi', 'storage', 'extensionRelay', 'communications'];
      const healthClinicalEnabled = body && body.readiness && body.readiness.clinicalUse === true
        && body.capabilities
        && clinicalCapabilityKeys.every((key) => body.capabilities[key] === true);
      if (!healthClinicalEnabled) {
        addFailure(failures, 'backend_health_clinical_state_unverified', '/api/health', 'Production release requires the public health response to explicitly report clinicalUse=true and every PHI/clinical capability=true');
      } else healthClinicalMode = 'public-health-enabled';
    } catch (error) {
      addFailure(failures, 'backend_health_invalid', '/api/health', error.message);
    }
  }

  let readinessMode = null;
  const readiness = backendObservations.readiness;
  if (readiness && readiness.status !== null) {
    requireContentType(readiness, 'json', failures, '/api/readiness');
    if (readiness.status === 200) {
      try {
        const body = safeJsonParse(readiness.bytes, 'backend readiness');
        if (!body || body.ok !== true || !body.readiness || body.readiness.clinicalUse !== false) {
          addFailure(failures, 'backend_readiness_open', '/api/readiness', 'Public readiness must explicitly report clinicalUse=false');
        } else readinessMode = 'public-closed';
      } catch (error) {
        addFailure(failures, 'backend_readiness_invalid', '/api/readiness', error.message);
      }
    } else if (readiness.status === 401 || readiness.status === 403) {
      try {
        const body = safeJsonParse(readiness.bytes, 'backend readiness denial');
        if (!body || typeof body.error !== 'string' || !body.error.trim()) addFailure(failures, 'backend_readiness_invalid', '/api/readiness', 'Auth-protected readiness denial lacks a JSON error');
        else readinessMode = 'auth-protected';
      } catch (error) {
        addFailure(failures, 'backend_readiness_invalid', '/api/readiness', error.message);
      }
    } else {
      addFailure(failures, 'backend_readiness_unavailable', '/api/readiness', `Expected a safe HTTP 200/401/403 response, received ${readiness.status}`);
    }
  }

  let manifestId = null;
  const signupManifest = backendObservations.signupManifest;
  if (signupManifest && signupManifest.status !== null) {
    requireContentType(signupManifest, 'json', failures, '/api/agreements/signup-manifest');
    if (signupManifest.status !== 200) {
      addFailure(failures, 'backend_signup_manifest_unavailable', '/api/agreements/signup-manifest', `Expected HTTP 200, received ${signupManifest.status}`);
    } else {
      try {
        const body = safeJsonParse(signupManifest.bytes, 'signup manifest');
        manifestId = body && body.manifestId;
        for (const message of validateSignupManifest(body, snapshot, siteOrigin, nowMs)) {
          addFailure(failures, 'backend_signup_manifest_invalid', '/api/agreements/signup-manifest', message);
        }
      } catch (error) {
        addFailure(failures, 'backend_signup_manifest_invalid', '/api/agreements/signup-manifest', error.message);
      }
    }
  }

  const report = {
    schemaVersion: 1,
    ok: failures.length === 0,
    expected: {
      siteOrigin,
      backendOrigin,
      build: snapshot.build,
      backendRevision: expectedBackendRevision,
      artifacts: snapshot.artifacts.map((item) => ({ file: item.file, sha256: item.sha256 })),
    },
    public: { artifacts: publicResults },
    backend: {
      observedRevision,
      healthClinicalMode,
      readinessMode,
      manifestId,
      endpoints: backendSpecs.map((spec) => ({ key: spec.key, route: spec.route, status: backendObservations[spec.key] ? backendObservations[spec.key].status : null })),
    },
    failures,
  };
  return report;
}

function formatHuman(report) {
  const lines = [];
  lines.push(report.ok ? 'PASS public release preflight' : `FAIL public release preflight (${report.failures.length} issue${report.failures.length === 1 ? '' : 's'})`);
  lines.push(`Build: ${report.expected.build}`);
  lines.push(`Expected backend revision: ${report.expected.backendRevision}`);
  for (const artifact of report.public.artifacts) {
    lines.push(`${artifact.match ? 'OK' : 'NO'} ${artifact.file} HTTP ${artifact.status === null ? 'unavailable' : artifact.status} SHA-256 ${artifact.observedSha256 || 'unavailable'}`);
  }
  lines.push(`Backend revision: ${report.backend.observedRevision || 'unavailable'}`);
  lines.push(`Health clinical mode: ${report.backend.healthClinicalMode || 'unavailable'}`);
  lines.push(`Readiness: ${report.backend.readinessMode || 'unavailable'}`);
  lines.push(`Signup manifest: ${report.backend.manifestId || 'unavailable'}`);
  for (const failure of report.failures) lines.push(`- [${failure.code}] ${failure.target}: ${failure.message}`);
  return lines.join('\n');
}

async function main(argv = process.argv.slice(2), env = process.env) {
  let options;
  try {
    options = parseArgs(argv, env);
    if (options.help) {
      process.stdout.write(`${usage()}\n`);
      return 0;
    }
  } catch (error) {
    process.stderr.write(`CONFIG ERROR: ${error.message}\n\n${usage()}\n`);
    return 2;
  }
  try {
    const report = await runPreflight(options);
    process.stdout.write(`${options.json ? JSON.stringify(report, null, 2) : formatHuman(report)}\n`);
    return report.ok ? 0 : 1;
  } catch (error) {
    process.stderr.write(`PREFLIGHT ERROR: ${error.message}\n`);
    return 2;
  }
}

module.exports = {
  DEFAULT_BACKEND_ORIGIN,
  DEFAULT_SITE_ORIGIN,
  FORBIDDEN_PUBLIC_CLAIMS,
  PUBLIC_ARTIFACTS,
  PreflightConfigError,
  formatHuman,
  htmlVisibleText,
  loadLocalSnapshot,
  main,
  normalizeOrigin,
  parseArgs,
  runPreflight,
  sha256,
  signupManifestMaterial,
  signupManifestSha256,
  usage,
  validateSignupManifest,
};

if (require.main === module) {
  main().then((code) => { process.exitCode = code; });
}
