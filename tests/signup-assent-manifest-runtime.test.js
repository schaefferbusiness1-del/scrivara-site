const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { signupManifestSha256 } = require('../scripts/public-release-preflight.js');

const root = path.resolve(__dirname, '..');
const live = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');
const staging = fs.readFileSync(path.join(root, 'ScribeFlow-staging.html'), 'utf8');

function assertInlineSyntax(name, source) {
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let match, count = 0;
  while ((match = re.exec(source))) {
    if (/\bsrc\s*=/.test(match[1])) continue;
    const type = match[1].match(/\btype\s*=\s*["']([^"']+)["']/i);
    if (type && !/^(?:text|application)\/(?:java|ecma)script$|^module$/i.test(type[1].trim())) continue;
    const code = match[2].replace(/^\s*<!--/, '').replace(/-->\s*$/, '');
    if (!code.trim()) continue;
    assert.doesNotThrow(() => new vm.Script('(function(){\n' + code + '\n})', { filename: `${name}-inline-${++count}.js` }));
  }
  assert(count > 0, `${name}: no inline scripts were compiled`);
}
assertInlineSyntax('live', live);
assertInlineSyntax('staging', staging);

function sliceBetween(source, start, end) {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a + start.length);
  assert(a >= 0 && b > a, `missing source block: ${start} -> ${end}`);
  return source.slice(a, b);
}

const liveBlock = sliceBetween(live, "const SIGNUP_AGREEMENT_MANIFEST_PATH", '\nfunction switchAuth');
const stagingBlock = sliceBetween(staging, "const SIGNUP_AGREEMENT_MANIFEST_PATH", '\nfunction switchAuth');
assert.strictEqual(stagingBlock, liveBlock, 'staging signup-manifest runtime must exactly match live');

for (const [name, source] of [['live', live], ['staging', staging]]) {
  const markup = sliceBetween(source, '<section id="authSignupAssent"', '</section>');
  const termsInput = markup.match(/<input[^>]+id="authTermsAssent"[^>]*>/);
  const authorityInput = markup.match(/<input[^>]+id="authPracticeAuthority"[^>]*>/);
  assert(termsInput && /\brequired\b/.test(termsInput[0]), `${name}: Terms/Privacy assent is not required`);
  assert(authorityInput && /\brequired\b/.test(authorityInput[0]), `${name}: practice-authority attestation is not required`);
  assert(!/\bchecked(?:\s|=|>)/i.test(termsInput[0]), `${name}: Terms/Privacy assent is prechecked`);
  assert(!/\bchecked(?:\s|=|>)/i.test(authorityInput[0]), `${name}: practice-authority attestation is prechecked`);
  assert(markup.includes('id="authTermsLink"') && markup.includes('id="authPrivacyLink"'), `${name}: current Terms and Privacy links are not both visible`);
  assert(markup.includes('role="alert"') && markup.includes('aria-live="assertive"'), `${name}: assent errors are not announced accessibly`);
  assert(markup.includes('id="authPracticeAuthorityText"') && markup.includes('credentials may not be shared') && !/shared account holder|authorized shared account/i.test(markup), `${name}: authority copy makes an unsafe shared-account representation`);
  assert(!/continued use|by continuing|deemed accepted/i.test(markup), `${name}: signup uses continued-use acceptance language`);
  assert(markup.includes('does not authorize patient information') && markup.includes('does not') && markup.includes('BAA'), `${name}: synthetic/BAA hold is not explicit`);
  assert(source.includes("const AGREEMENTS_VERSION='';") && source.includes('const MLS_AGREEMENTS=Object.freeze([]);'), `${name}: synthetic-only agreement hold was replaced by client-authored legal content`);
  const auth = sliceBetween(source, 'async function doAuth()', '\n/* ---------- Two-factor login');
  assert(auth.indexOf('signupIntent=await prepareSignupAcceptance(email)') < auth.indexOf("'/api/auth/register'"), `${name}: register can run before current assent verification`);
  assert(auth.includes('body.signupAssent=signupIntent;'), `${name}: exact assent intent is not attached to registration`);
  assert(auth.indexOf('hasServerRecordedSignupAcceptance') < auth.indexOf('setBkToken(data.token)'), `${name}: token activation can precede the server-bound receipt check`);
  assert(auth.includes('accts[email]={ hash:await hashPass(email,pass), created:Date.now(), evaluationReceipt:receipt }'), `${name}: local evaluation receipt is not stored inside the exact account record`);
}

function makeElement(id) {
  const attrs = Object.create(null);
  return {
    id, checked: false, disabled: false, value: '', textContent: '', href: '', target: '', rel: '',
    classList: { toggle(name, on) { attrs[`class:${name}`] = !!on; } },
    setAttribute(name, value) { attrs[name] = String(value); },
    removeAttribute(name) { delete attrs[name]; if (name === 'href') this.href = ''; },
    getAttribute(name) { return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null; }
  };
}

function harness(options = {}) {
  const ids = ['authAssentErr', 'authEmail', 'authTermsAssent', 'authPracticeAuthority', 'authPracticeAuthorityText', 'authBtn', 'authSignupAssentFields', 'authSignupDocs', 'authTermsLink', 'authPrivacyLink'];
  const elements = Object.create(null);
  ids.forEach(id => { elements[id] = makeElement(id); });
  const queue = [];
  const context = {
    console, Date, URL, Object, JSON, Number, Array, String, RegExp, Error,
    location: { href: options.href || 'https://app.example.test/ScribeFlow.html' },
    document: { baseURI: options.href || 'https://app.example.test/ScribeFlow.html', getElementById(id) { return elements[id] || null; } },
    backendMode() { return options.backend !== false; },
    bkBase() { return 'https://api.example.test'; },
    fetch: async () => {
      const next = queue.shift();
      if (!next) throw new Error('unexpected fetch');
      if (next.throw) throw next.throw;
      return { ok: next.ok !== false, status: next.status || 200, async json() { return next.body; } };
    }
  };
  vm.createContext(context);
  vm.runInContext(
    "var authMode='signup';\n" + liveBlock +
    '\nglobalThis.__signupTest={validate:validateSignupAgreementManifest,intent:signupAcceptanceIntent,load:loadSignupAgreementManifest,prepare:prepareSignupAcceptance,changed:signupAssentChanged,receipt:localEvaluationReceipt,ack:hasServerRecordedSignupAcceptance};',
    context,
    { filename: 'signup-assent-manifest-runtime.js' }
  );
  return { api: context.__signupTest, elements, queue };
}

function iso(deltaMs) { return new Date(Date.now() + deltaMs).toISOString(); }
function validManifest(overrides = {}) {
  const base = {
    schemaVersion: 1,
    purpose: 'account-signup',
    releaseChannel: 'synthetic-evaluation',
    clinicalUseAuthorized: false,
    status: 'approved',
    current: true,
    serverOwned: true,
    immutable: true,
    counselApproved: true,
    counselApprovalRef: 'counsel-evidence-signup-2026-01',
    syntheticTestFixture: false,
    manifestId: 'signup-manifest-2026-01',
    version: '2026.01',
    manifestSha256: 'a'.repeat(64),
    approvedAt: iso(-86400000),
    validUntil: iso(86400000),
    documents: [
      { kind: 'terms', documentId: 'terms-2026-01', version: '2026.01', sha256: 'b'.repeat(64), effectiveAt: iso(-3600000), url: 'https://legal.example.test/terms/2026.01', required: true, status: 'approved' },
      { kind: 'privacy', documentId: 'privacy-2026-01', version: '2026.01', sha256: 'c'.repeat(64), effectiveAt: iso(-3600000), url: 'https://legal.example.test/privacy/2026.01', required: true, status: 'approved' }
    ],
    practiceAuthority: {
      status: 'approved', required: true, attestationId: 'practice-authority-2026-01', version: '2026.01', sha256: 'd'.repeat(64),
      effectiveAt: iso(-3600000), text: 'I attest that I am authorized to create and administer this MLS account for my practice.',
      individualAccountOnly: true, sharedCredentialsAuthorized: false
    }
  };
  return Object.assign(base, overrides);
}
function plain(value) { return JSON.parse(JSON.stringify(value)); }
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }

(async () => {
  const h = harness();
  const normalized = h.api.validate(validManifest());
  assert(normalized, 'complete approved manifest was rejected');
  assert.strictEqual(normalized.documents.length, 2);

  assert.strictEqual(h.api.validate(validManifest({ status: 'draft' })), null, 'unapproved manifest was accepted');
  assert.strictEqual(h.api.validate(validManifest({ current: false })), null, 'stale/superseded manifest was accepted');
  assert.strictEqual(h.api.validate(validManifest({ validUntil: iso(-1000) })), null, 'expired manifest was accepted');
  assert.strictEqual(h.api.validate(validManifest({ clinicalUseAuthorized: true })), null, 'signup manifest was allowed to enable clinical/PHI use');
  const incomplete = validManifest(); incomplete.documents[0].sha256 = '';
  assert.strictEqual(h.api.validate(incomplete), null, 'document with missing digest was accepted');
  const invented = validManifest(); invented.documents[1].documentId = 'x';
  assert.strictEqual(h.api.validate(invented), null, 'unstable document ID was accepted');

  const intent = plain(h.api.intent(normalized));
  assert.deepStrictEqual(intent, {
    schemaVersion: 1,
    manifestId: normalized.manifestId,
    manifestVersion: normalized.version,
    manifestSha256: normalized.manifestSha256,
    releaseChannel: 'synthetic-evaluation',
    documents: plain(normalized.documents.map(d => ({ kind: d.kind, documentId: d.documentId, version: d.version, sha256: d.sha256, effectiveAt: d.effectiveAt, intent: 'accept' }))),
    practiceAuthorityAttestation: {
      attestationId: normalized.practiceAuthority.attestationId,
      version: normalized.practiceAuthority.version,
      sha256: normalized.practiceAuthority.sha256,
      effectiveAt: normalized.practiceAuthority.effectiveAt,
      intent: 'attest'
    }
  }, 'registration payload is not the exact bindable intent/evidence contract');
  const intentJson = JSON.stringify(intent);
  assert(!/acceptedAt|clientRecordedAt|ipAddress|userAgent|signature/i.test(intentJson), 'client claimed authoritative time/IP/signature evidence in the registration payload');

  const rA = plain(h.api.receipt(normalized, 'doctor-a@example.test'));
  const rB = plain(h.api.receipt(normalized, 'doctor-b@example.test'));
  assert(rA && rB && rA.accountScope !== rB.accountScope, 'local evaluation receipts are not account isolated');
  assert.strictEqual(rA.authoritative, false, 'local receipt claims authoritative evidence');
  assert.strictEqual(rA.manifestSha256, normalized.manifestSha256);
  assert.strictEqual(h.api.receipt(null, 'doctor-a@example.test'), null, 'local signup can store a receipt without a complete current manifest');

  const ack = {
    schemaVersion: 1, status: 'recorded', serverRecorded: true,
    receiptId: 'signup-receipt-0001', acceptedAt: iso(0), accountId: 'acct-1001',
    manifestId: normalized.manifestId, manifestVersion: normalized.version, manifestSha256: normalized.manifestSha256,
    counselApprovalRef: normalized.counselApprovalRef,
    documents: plain(normalized.documents.map(d => ({ kind: d.kind, documentId: d.documentId, version: d.version, sha256: d.sha256, effectiveAt: d.effectiveAt, status: 'recorded' }))),
    practiceAuthorityAttestation: {
      status: 'recorded', attestationId: normalized.practiceAuthority.attestationId, version: normalized.practiceAuthority.version,
      sha256: normalized.practiceAuthority.sha256, effectiveAt: normalized.practiceAuthority.effectiveAt
    }
  };
  assert.strictEqual(h.api.ack(ack, normalized, { account_id: 'acct-1001' }), true, 'exact server account-bound receipt was rejected');
  assert.strictEqual(h.api.ack({ ...ack, accountId: 'acct-other' }, normalized, { account_id: 'acct-1001' }), false, 'receipt for another account was accepted');
  assert.strictEqual(h.api.ack({ ...ack, manifestSha256: 'd'.repeat(64) }, normalized, { account_id: 'acct-1001' }), false, 'receipt for another manifest digest was accepted');
  assert.strictEqual(h.api.ack({ ...ack, counselApprovalRef: 'counsel-evidence-other-2026-01' }, normalized, { account_id: 'acct-1001' }), false, 'receipt for another counsel evidence reference was accepted');
  assert.strictEqual(h.api.ack({ ...ack, acceptedAt: iso(3600000) }, normalized, { account_id: 'acct-1001' }), false, 'future authoritative receipt time was accepted');
  assert.strictEqual(h.api.ack({ ...ack, acceptedAt: iso(-172800000) }, normalized, { account_id: 'acct-1001' }), false, 'receipt predating the manifest/documents was accepted');
  const wrongAuthority = { ...ack, practiceAuthorityAttestation: { ...ack.practiceAuthorityAttestation, sha256: 'e'.repeat(64) } };
  assert.strictEqual(h.api.ack(wrongAuthority, normalized, { account_id: 'acct-1001' }), false, 'receipt for another authority-attestation digest was accepted');

  const syntheticFixture = validManifest({
    status: 'approved-for-synthetic-test', counselApproved: false, syntheticTestFixture: true,
    counselApprovalRef: 'synthetic-no-counsel-approval-2026-01', manifestId: 'synthetic-test-manifest-01', manifestSha256: 'f'.repeat(64)
  });
  assert.strictEqual(h.api.validate(syntheticFixture), null, 'synthetic test fixture was accepted by hosted mode');
  const localHarness = harness({ backend: false, href: 'http://127.0.0.1:8765/ScribeFlow.html?demo=1' });
  assert(localHarness.api.validate(syntheticFixture), 'explicit synthetic test-server fixture was rejected in loopback demo mode');

  const fixturePath = path.join(root, 'api', 'agreements', 'signup-manifest');
  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  assert.strictEqual(fixture.syntheticTestFixture, true);
  assert.strictEqual(fixture.counselApproved, false, 'synthetic fixture invents counsel approval');
  assert.strictEqual(fixture.clinicalUseAuthorized, false, 'synthetic fixture enables clinical/PHI use');
  const fixtureTerms = fixture.documents.find(d => d.kind === 'terms');
  const fixturePrivacy = fixture.documents.find(d => d.kind === 'privacy');
  assert.strictEqual(fixtureTerms.sha256, sha256(fs.readFileSync(path.join(root, 'terms.html'))), 'synthetic Terms fixture digest is stale');
  assert.strictEqual(fixturePrivacy.sha256, sha256(fs.readFileSync(path.join(root, 'privacy.html'))), 'synthetic Privacy fixture digest is stale');
  assert.strictEqual(fixture.practiceAuthority.sha256, sha256(Buffer.from(fixture.practiceAuthority.text, 'utf8')), 'authority attestation digest is stale');
  assert.strictEqual(fixture.manifestSha256, signupManifestSha256(fixture), 'synthetic manifest digest is stale');
  assert(localHarness.api.validate(fixture), 'checked-in synthetic test-server manifest is not valid for loopback demo mode');
  assert.strictEqual(h.api.validate(fixture), null, 'checked-in synthetic fixture was accepted by hosted mode');
  localHarness.queue.push({ body: fixture });
  assert(await localHarness.api.load(), 'checked-in loopback manifest did not load through the test-server contract');
  assert(/^Local synthetic-test documents:/.test(localHarness.elements.authSignupDocs.textContent), 'loopback fixture is mislabeled as server/counsel-approved documents');

  const missing = harness();
  missing.queue.push({ ok: false, status: 404, body: {} });
  assert.strictEqual(await missing.api.load(), null, 'missing manifest did not fail closed');
  assert.strictEqual(missing.elements.authSignupAssentFields.disabled, true, 'missing manifest left assent controls enabled');
  assert.strictEqual(missing.elements.authBtn.disabled, true, 'missing manifest left signup activation enabled');

  const unchecked = harness();
  unchecked.queue.push({ body: validManifest() });
  assert(await unchecked.api.load(), 'valid current manifest did not load');
  unchecked.elements.authEmail.value = 'doctor@example.test';
  assert.strictEqual(await unchecked.api.prepare('doctor@example.test'), null, 'unchecked confirmations allowed signup');
  assert(/both required confirmations/i.test(unchecked.elements.authAssentErr.textContent), 'unchecked confirmation error is not explicit');

  const changed = harness();
  changed.queue.push({ body: validManifest() });
  assert(await changed.api.load(), 'initial manifest did not load');
  changed.elements.authEmail.value = 'doctor@example.test';
  changed.elements.authTermsAssent.checked = true;
  changed.elements.authPracticeAuthority.checked = true;
  changed.api.changed();
  assert.strictEqual(changed.elements.authBtn.disabled, false, 'complete current confirmations did not enable submission');
  const materialChange = validManifest({ version: '2026.02', manifestSha256: 'd'.repeat(64) });
  materialChange.documents[0] = { ...materialChange.documents[0], version: '2026.02', sha256: 'e'.repeat(64) };
  changed.queue.push({ body: materialChange });
  assert.strictEqual(await changed.api.prepare('doctor@example.test'), null, 'material manifest change preserved prior assent');
  assert.strictEqual(changed.elements.authTermsAssent.checked, false, 'Terms assent survived a material manifest change');
  assert.strictEqual(changed.elements.authPracticeAuthority.checked, false, 'authority attestation survived a material manifest change');
  assert(/changed/i.test(changed.elements.authAssentErr.textContent), 'material change does not present an accessible review-again error');

  console.log('signup assent manifest runtime: PASS');
})().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
