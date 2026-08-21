'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const live = read('ScribeFlow.html');
const staging = read('ScribeFlow-staging.html');

assert(!live.includes(".auth-wrap::after{ content:'Synthetic evaluation only"), 'hosted login first paint still labels every account synthetic-only');
assert(live.includes(".auth-wrap::after{ content:'Secure account sign-in'"), 'production login footer lacks neutral hosted sign-in copy');
assert(live.includes('<b>Clinician review required.</b>') && staging.includes('<b>Clinician review required.</b>'), 'hosted clinician footer still claims the unlocked workspace is synthetic-only');

function between(source, start, end) {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a + start.length);
  assert(a >= 0 && b > a, `missing source region: ${start} -> ${end}`);
  return source.slice(a, b);
}

const helperStart = "const LAST_HOSTED_LOGIN_EMAIL_KEY='sf_last_hosted_login_email';";
const liveHelpers = between(live, helperStart, '\nlet bkUser=null;');
const stagingHelpers = between(staging, helperStart, '\nlet bkUser=null;');
assert.strictEqual(stagingHelpers, liveHelpers, 'staging hosted-email helpers drifted from production');
assert(!/getElementById\(['"]authPass|sessionStorage\.|password\s*[:=]/.test(liveHelpers), 'hosted email memory reads password/session credential state');

for (const [name, source] of [['production', live], ['staging', staging]]) {
  const initialAuthNote = name === 'production'
    ? between(source, '<div class="local-note" id="authNote">', '</div>')
    : between(source, '<p class="local-note" id="authNote">', '</p>');
  const authNote = between(source, "const _an=document.getElementById('authNote');", '// One-time token was captured');
  const secureLabel = name === 'production' ? '<b>Secure sign-in.</b>' : '<b>Secure account sign-in.</b>';
  assert(initialAuthNote.includes(secureLabel) && initialAuthNote.includes('checked separately for this deployment and account'), `${name} first-paint login copy does not distinguish account sign-in from clinical access`);
  assert(authNote.includes(secureLabel), `${name} hosted login is not described as secure sign-in`);
  assert(authNote.includes('Clinical workspace access is checked separately for this deployment and account.'), `${name} login copy conflates authentication and clinical readiness`);
  assert(!/Hosted evaluation account|signed BAA|BAA.*(?:missing|required|unsigned)/i.test(authNote), `${name} hosted login makes an inaccurate evaluation/BAA claim`);

  const gate = between(source, '<!-- Hosted clinical-readiness gate.', '<!-- ============ MAIN APP');
  const readinessPhrases = name === 'production'
    ? ['Your practice has not been switched on for patient work yet.', 'MLS administrator', 'PHI deployment readiness', 'release configuration', 'account grant']
    : ['Clinical workspace not enabled', 'not enabled for this deployment or account', 'PHI deployment readiness', 'release configuration', 'account grant'];
  for (const phrase of readinessPhrases) {
    assert(gate.includes(phrase), `${name} clinical gate omits: ${phrase}`);
  }
  /* The LOCKED-mode copy must never guess at legal/BAA status. In production
     the same gate container also hosts the restored signing CEREMONY (a
     separate mode that legitimately names the BAA/signature) — the no-guessing
     rule applies to the locked wrap; staging predates the ceremony restore. */
  const lockedCopy = name === 'production' ? between(gate, '<div id="agLockedWrap">', '</div>') : gate;
  assert(!/BAA|counsel|contract|signature|synthetic evaluation/i.test(lockedCopy), `${name} clinical gate guesses at legal/BAA status`);
  assert(gate.includes('Access remains locked.'), `${name} clinical gate no longer states its fail-closed result`);

  const auth = between(source, 'async function doAuth()', '\n/* ---------- Two-factor login');
  const rememberAt = auth.indexOf("if(authMode==='login') rememberHostedLoginEmail(email);");
  assert(rememberAt > auth.indexOf('if(!res.ok)'), `${name} remembers an email before password validation succeeds`);
  assert(rememberAt < auth.indexOf('if(data && data.twofa_required)'), `${name} does not remember the validated email when 2FA is required`);
  assert(auth.includes('email registered to your MLS account') && auth.includes('Forgot password'), `${name} invalid-login copy does not guide email confirmation/password reset`);

  const switchAuth = between(source, 'function switchAuth(mode)', 'function showAuthErr');
  assert(switchAuth.includes('prefillHostedLoginEmail();'), `${name} later login screens do not prefill the remembered hosted email`);
  const logout = between(source, 'function logout(force)', 'HOSTED BACKEND:');
  assert(logout.includes("setSessionEmail('');") && logout.includes("switchAuth('login');"), `${name} logout does not clear the session and return through remembered-email prefill`);
  const expired = between(source, 'function handle401()', 'function applyAccessUI');
  assert(expired.includes('logout(true);'), `${name} session expiry bypasses the remembered-email login path`);
}

function helperHarness({ hosted = true, initial = {}, storageThrows = false } = {}) {
  const values = new Map(Object.entries(initial));
  const writes = [];
  const elements = { authEmail: { value: '' } };
  const context = {
    String, RegExp,
    backendMode: () => hosted,
    localStorage: {
      getItem(key) { if(storageThrows) throw new Error('storage unavailable'); return values.has(key) ? values.get(key) : null; },
      setItem(key, value) { if(storageThrows) throw new Error('storage unavailable'); writes.push({ key, value }); values.set(key, String(value)); }
    },
    document: { getElementById(id) { return elements[id] || null; } }
  };
  vm.createContext(context);
  vm.runInContext(liveHelpers, context, { filename: 'hosted-email-helpers.js' });
  return { context, elements, writes, values };
}

{
  const h = helperHarness({ initial: { sf_last_hosted_login_email: ' Doctor@Example.TEST ' } });
  assert.strictEqual(h.context.prefillHostedLoginEmail(), 'doctor@example.test');
  assert.strictEqual(h.elements.authEmail.value, 'doctor@example.test', 'remembered hosted email was not normalized and prefilled');
  assert.strictEqual(h.context.rememberHostedLoginEmail(' Next.Doctor@Example.TEST '), 'next.doctor@example.test');
  assert.deepStrictEqual(h.writes, [{ key: 'sf_last_hosted_login_email', value: 'next.doctor@example.test' }], 'email memory wrote anything beyond its dedicated key/value');
}

{
  const h = helperHarness({ hosted: false, initial: { sf_last_hosted_login_email: 'doctor@example.test' } });
  assert.strictEqual(h.context.prefillHostedLoginEmail(), '', 'local/demo mode consumed hosted account memory');
  assert.strictEqual(h.context.rememberHostedLoginEmail('doctor@example.test'), '', 'local/demo mode wrote hosted account memory');
  assert.deepStrictEqual(h.writes, []);
}

{
  const h = helperHarness({ storageThrows: true });
  assert.doesNotThrow(() => h.context.prefillHostedLoginEmail(), 'unavailable localStorage broke the login screen');
  assert.doesNotThrow(() => h.context.rememberHostedLoginEmail('doctor@example.test'), 'unavailable localStorage broke successful login');
  assert.deepStrictEqual(h.writes, []);
}

const liveAuth = between(live, 'async function doAuth()', '\n/* ---------- Two-factor login');
function authHarness(response) {
  const passwordSentinel = 'PASSWORD-MUST-NEVER-BE-STORED';
  const elements = {
    authEmail: { value: ' Doctor@Example.TEST ' },
    authPass: { value: passwordSentinel },
    authBtn: { disabled: false, textContent: 'Log in' }
  };
  const writes = [];
  let error = '', twofa = null, started = '', token = '';
  const context = {
    console, String, RegExp, JSON, Promise,
    document: { getElementById(id) { return elements[id] || null; } },
    localStorage: {
      getItem() { return null; },
      setItem(key, value) { writes.push({ key, value: String(value) }); }
    },
    backendMode: () => true,
    hideAuthErr() { error = ''; },
    showAuthErr(message) { error = String(message); },
    bkBase: () => 'https://backend.example.test',
    fetch: async () => ({
      ok: response.ok,
      status: response.status || (response.ok ? 200 : 401),
      json: async () => response.body
    }),
    prepareSignupAcceptance: async () => null,
    getName: () => '', getSpec: () => '',
    hasServerRecordedSignupAcceptance: () => true,
    signupAssentError() {},
    showTwofaScreen(pending, email) { twofa = { pending, email }; },
    setBkToken(value) { token = value; },
    showRegTwofaGate() {},
    startSession(email) { started = email; },
    toast() {},
    getAccounts: () => ({}),
    localEvaluationReceipt: () => null,
    hashPass: async () => '',
    saveAccounts() {},
    authMode: 'login',
    bkUser: null,
    _signupAgreementManifest: null
  };
  vm.createContext(context);
  vm.runInContext(liveHelpers + '\n' + liveAuth, context, { filename: 'hosted-login-runtime.js' });
  return {
    passwordSentinel,
    writes,
    run: () => context.doAuth(),
    result: () => ({ error, twofa, started, token })
  };
}

(async function verifyHostedLoginRuntime() {
  const direct = authHarness({ ok: true, body: { token: 'token-1', user: { email: 'doctor@example.test' } } });
  await direct.run();
  assert.deepStrictEqual(direct.writes, [{ key: 'sf_last_hosted_login_email', value: 'doctor@example.test' }]);
  assert(!JSON.stringify(direct.writes).includes(direct.passwordSentinel), 'password entered hosted email memory');
  assert.strictEqual(direct.result().started, 'doctor@example.test', 'direct hosted login did not start');

  const challenged = authHarness({ ok: true, body: { twofa_required: true, pending: 'pending-1' } });
  await challenged.run();
  assert.deepStrictEqual(challenged.writes, [{ key: 'sf_last_hosted_login_email', value: 'doctor@example.test' }], '2FA challenge did not remember the password-validated email');
  assert.deepStrictEqual(challenged.result().twofa, { pending: 'pending-1', email: 'doctor@example.test' });
  assert(!JSON.stringify(challenged.writes).includes(challenged.passwordSentinel), '2FA path stored a password');

  const rejected = authHarness({ ok: false, status: 401, body: { error: 'No account exists for this address' } });
  await rejected.run();
  assert.deepStrictEqual(rejected.writes, [], 'rejected credentials changed remembered email');
  assert(rejected.result().error.includes('email registered to your MLS account') && rejected.result().error.includes('Forgot password'), 'rejected credential guidance is incomplete');
  assert(!rejected.result().error.includes('No account exists'), 'server account-enumeration detail reached the login UI');

  console.log('PASS hosted login usability: email-only success memory, 2FA coverage, neutral credential help, accurate gate copy, and fail-closed handoff');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
