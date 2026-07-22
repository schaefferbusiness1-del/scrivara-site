'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const prod = read('ScribeFlow.html');
const staging = read('ScribeFlow-staging.html');
const sw = read('sw.js');
const purgeSource = read('clinical-state-purge.js');
const backup = read('feat_mls_record_backup.js');
const connect = read('mls-connect.js');

function bootstrapSource(html, name) {
  const marker = '/* Capture one-time auth handoffs';
  const at = html.indexOf(marker);
  assert(at > 0, `${name}: early auth handoff bootstrap missing`);
  const open = html.lastIndexOf('<script>', at);
  const close = html.indexOf('</script>', at);
  assert(open >= 0 && close > at, `${name}: early auth handoff script is malformed`);
  assert(open < html.indexOf('clinical-state-purge.js'), `${name}: token scrubber must precede dependencies`);
  assert(open < html.indexOf('serviceWorker.register'), `${name}: token scrubber must precede worker registration`);
  return html.slice(open + '<script>'.length, close);
}

const prodBootstrap = bootstrapSource(prod, 'production');
const stagingBootstrap = bootstrapSource(staging, 'staging');
assert.strictEqual(prodBootstrap, stagingBootstrap, 'production/staging token scrubbers drifted');

function runBootstrap(href) {
  let current = new URL(href);
  const location = {};
  for (const key of ['search', 'hash', 'pathname', 'origin', 'href']) {
    Object.defineProperty(location, key, { configurable: true, get() { return current[key]; } });
  }
  const context = {
    location,
    document: { title: 'MLS' },
    history: {
      calls: [],
      replaceState(_state, _title, target) {
        this.calls.push(String(target));
        current = new URL(String(target), current);
      }
    },
    URL, decodeURIComponent
  };
  context.window = context;
  vm.runInNewContext(prodBootstrap, context, { filename: 'early-auth-handoff.js' });
  return { href: current.href, handoff: context.__mlsAuthHandoff, calls: context.history.calls };
}

{
  const out = runBootstrap('https://mlsscribe.com/ScribeFlow.html?reset=QUERY_RESET&safe=1#tab=security');
  assert.strictEqual(out.handoff.reset, 'QUERY_RESET');
  assert.strictEqual(out.href, 'https://mlsscribe.com/ScribeFlow.html?safe=1#tab=security');
  assert.strictEqual(out.calls.length, 1, 'query reset token was not scrubbed atomically');
}
{
  const out = runBootstrap('https://mlsscribe.com/ScribeFlow.html?invite=OLD&safe=1#invite=NEW&tab=legal');
  assert.strictEqual(out.handoff.invite, 'NEW', 'fragment invite must outrank a legacy query token');
  assert.strictEqual(out.href, 'https://mlsscribe.com/ScribeFlow.html?safe=1#tab=legal');
}
{
  const out = runBootstrap('https://mlsscribe.com/ScribeFlow.html?mic=RETIRED&safe=1#view=visit');
  assert.strictEqual(out.handoff.rejectedMic, true);
  assert.strictEqual(out.href, 'https://mlsscribe.com/ScribeFlow.html?safe=1#view=visit');
  assert(!Object.values(out.handoff).includes('RETIRED'), 'retired mic capability was captured for use');
}

for (const [name, html] of [['production', prod], ['staging', staging]]) {
  assert(/<meta http-equiv="Cache-Control" content="no-store, no-cache, must-revalidate, max-age=0">/.test(html), `${name}: app navigation lacks no-store hint`);
  assert(html.includes("const _resetTok=_authHandoff.reset||''"), `${name}: reset boot bypasses early capture`);
  assert(html.includes("const _inviteTok=_authHandoff.invite||''"), `${name}: invite boot bypasses early capture`);
  assert(html.includes("base+'#invite='+encodeURIComponent(creds.inviteToken)"), `${name}: generated attorney invite is not fragment-based`);
  assert(!html.includes("base+'?invite='+encodeURIComponent(creds.inviteToken)"), `${name}: generated attorney invite leaks through the HTTP query`);
  assert(!/id="phoneMicPage"|initPhoneMicPage|togglePhoneRec|uploadPhoneChunk|_params\.get\(['"]mic['"]\)|PHONE MICROPHONE\s+\(phone side/i.test(html), `${name}: retired in-app phone recorder still exists`);
  assert(/\/api\/auth\/reset'[\s\S]{0,240}?cache:'no-store'[\s\S]{0,120}?referrerPolicy:'no-referrer'/.test(html), `${name}: password reset request is cache/referrer unsafe`);
  assert(/\/api\/auth\/lawyer-invite'[\s\S]{0,220}?cache:'no-store'[\s\S]{0,100}?referrerPolicy:'no-referrer'/.test(html), `${name}: attorney invite exchange is cache/referrer unsafe`);
  const logoutAt = html.indexOf('function logout(force)');
  const logoutEnd = html.indexOf('/* =========================================================', logoutAt);
  const logout = html.slice(logoutAt, logoutEnd);
  assert(logout.includes('__mlsClinicalStatePurge.purge(_logoutEmail)'), `${name}: logout does not invoke complete account purge`);
  assert(logout.indexOf('const _logoutToken=') < logout.indexOf('__mlsClinicalStatePurge.purge'), `${name}: logout token is not captured before local purge`);
  assert(logout.includes("cache:'no-store'") && logout.includes("referrerPolicy:'no-referrer'"), `${name}: server logout is cache/referrer unsafe`);
}

async function runLogout(html, name) {
  /* 2026-07-22: production logout is async (its optional confirm became a
     non-blocking in-app dialog) — keep the async prefix when present so the
     extracted source still parses; staging remains sync. */
  let at = html.indexOf('async function logout(force)');
  if (at < 0) at = html.indexOf('function logout(force)');
  const end = html.indexOf('/* =========================================================', at);
  const source = html.slice(at, end);
  const calls = { fetch: [], purges: [], sessions: [], tokens: [], boundaries: [] };
  const appScreen = { style: {} };
  const firstCard = { style: {} };
  const authScreen = { style: {}, querySelectorAll() { return [firstCard]; } };
  const nodes = {
    appScreen, authScreen,
    twofaCard: { style: {} }, resetCard: { style: {} }, authPass: { value: 'secret' }
  };
  const context = {
    window: null,
    Promise,
    sfSessionStartupId: 0, sfActiveStartupController: null,
    sfCancelGateLoading() {},
    session: { email: 'doctor@example.test' },
    capturing: false,
    phoneMicCode: '',
    resetToken: 'RESET', regTwofaRecoveryCodes: ['RECOVERY'], regTwofaEmail: 'doctor@example.test',
    _lastLawyerCreds: { inviteToken: 'INVITE' }, currentLegalRequestId: 7, legalReqFilesText: 'case',
    bkUser: { email: 'doctor@example.test' },
    sfResetSessionBoundary(next, opts) {
      calls.boundaries.push({
        next,
        reason: opts && opts.reason,
        purgeCount: calls.purges.length,
        tokenClearCount: calls.tokens.length,
      });
    },
    getQolConfirmLogout() { return false; },
    stopIdle() {},
    _wipeVisitDraft() { calls.draftWiped = true; },
    getSessionEmail() { return 'doctor@example.test'; },
    backendMode() { return true; },
    bkToken() { return 'CAPTURED_TOKEN'; },
    bkBase() { return 'https://backend.invalid'; },
    fetch(url, options) { calls.fetch.push({ url, options }); return Promise.resolve({ ok: true }); },
    setSessionEmail(value) { calls.sessions.push(value); },
    setBkToken(value) { calls.tokens.push(value); },
    document: { getElementById(id) { return nodes[id] || null; } },
    switchAuth(mode) { calls.authMode = mode; }
  };
  context.window = context;
  context.__mlsClinicalStatePurge = {
    purge(email) { calls.purges.push(email); return { databases: Promise.resolve([true, true]) }; }
  };
  vm.runInNewContext(`${source}\nwindow.__runLogout=logout;`, context, { filename: `${name}-logout.js` });
  context.__runLogout(true);
  await context.__mlsLogoutPurge;
  assert.deepStrictEqual(calls.purges, ['doctor@example.test'], `${name}: runtime logout did not purge the exact account`);
  assert.deepStrictEqual(calls.boundaries, [{ next: '', reason: 'logout', purgeCount: 0, tokenClearCount: 0 }], `${name}: runtime logout did not synchronously reset the session UI before token purge`);
  assert.strictEqual(calls.fetch.length, 1, `${name}: runtime logout did not issue exactly one server invalidation`);
  assert.strictEqual(calls.fetch[0].options.headers.Authorization, 'Bearer CAPTURED_TOKEN', `${name}: server logout lost the pre-purge token`);
  assert.strictEqual(calls.fetch[0].options.cache, 'no-store', `${name}: server logout request may use HTTP cache`);
  assert.strictEqual(calls.fetch[0].options.referrerPolicy, 'no-referrer', `${name}: server logout may disclose its source URL`);
  assert.deepStrictEqual(calls.sessions, [''], `${name}: runtime logout retained the session seed`);
  assert.deepStrictEqual(calls.tokens, [''], `${name}: runtime logout retained the bearer token`);
  assert.strictEqual(context.resetToken, '', `${name}: reset token remained in memory after logout`);
  assert.strictEqual(context._lastLawyerCreds, null, `${name}: attorney invite credentials remained in memory after logout`);
  assert.strictEqual(context.currentLegalRequestId, null, `${name}: case request binding remained in memory after logout`);
}

assert(staging.includes("location.origin+'/phone.html#code='+encodeURIComponent(phoneMicCode)"), 'staging desktop phone handoff still uses a query');
assert(!connect.includes('phoneMicPage'), 'retired phone-recorder overlay repair still ships in the production bundle');

const shellAt = sw.indexOf('const SHELL = [');
const shellBlock = sw.slice(shellAt, sw.indexOf('];', shellAt) + 2);
assert(shellBlock.includes('/ScribeFlow.html'), 'reviewed token-free clinical shell lost offline resilience');
assert(shellBlock.includes('/clinical-state-purge.js?v=20260718csp1'), 'offline clinical shell lacks its logout purge boundary');
const networkAt = sw.indexOf('const NETWORK_ONLY_HTML_PATHS');
const networkBlock = sw.slice(networkAt, sw.indexOf(']);', networkAt) + 3);
assert(!networkBlock.includes('/scribeflow.html'), 'token-free ScribeFlow shell was incorrectly made network-only');
for (const route of ['/appointment.html', '/best-doctors-optout.html', '/booking.html', '/phone.html', '/patient-portal.html', '/intake.html']) {
  assert(sw.includes(`'${route}'`), `service worker network-only inventory misses ${route}`);
}
assert(!networkBlock.includes('/send-portal-invite.html'), 'retired portal sender must not remain in the public network-only inventory');
const publicAt = sw.indexOf('const PUBLIC_HTML_PATHS');
const publicBlock = sw.slice(publicAt, sw.indexOf(']);', publicAt) + 3);
assert(!publicBlock.includes('send-portal-invite.html'), 'retired portal sender remains in the service-worker public inventory');
assert(sw.includes('return !PUBLIC_HTML_PATHS.has(name);'), 'unreviewed/retired HTML no longer fails closed with 410 classification');
assert(sw.includes("cache: (isNetworkOnlyNavigation(url) || !!url.search) ? 'no-store' : 'reload'"), 'sensitive/query navigation does not force request cache:no-store');
assert(sw.includes("if (url.search) return false"), 'query-bearing ScribeFlow requests can enter Cache Storage');
assert(sw.includes("if (pathname === '/scribeflow.html') return '/ScribeFlow.html'"), 'exact token-free ScribeFlow path lacks offline fallback');

function storage(initial) {
  const values = new Map(Object.entries(initial || {}));
  return {
    get length() { return values.size; },
    key(index) { return [...values.keys()][index] ?? null; },
    getItem(key) { return values.has(String(key)) ? values.get(String(key)) : null; },
    setItem(key, value) { values.set(String(key), String(value)); },
    removeItem(key) { values.delete(String(key)); },
    clear() { values.clear(); this.clears = (this.clears || 0) + 1; },
    keys() { return [...values.keys()]; },
    clears: 0
  };
}

(async () => {
  await runLogout(prod, 'production');
  await runLogout(staging, 'staging');
  const current = 'doctor@example.test';
  const prefix = `sf_u::${current}::`;
  const localStorage = storage({
    [`${prefix}calApptsCacheV2`]: 'appointments',
    [`${prefix}copilotHist`]: 'history',
    [`${prefix}futureClinicalCacheNeverNamedInPurge`]: 'future',
    'sf_u::other@example.test::patients': 'other-account',
    sf_bk_token: 'bearer',
    sf_session: current,
    mlsSchedProviders: 'providers',
    mlsProviderRosterV2: 'roster',
    mls_patient_alias_v1: 'aliases',
    mls_recguard_status: 'audio',
    mls_studygroups_v1: 'study',
    mls_rail_collapsed: '1',
    'mls.easy.viewPref': 'simple'
  });
  const sessionStorage = storage({
    [`sf_visit_draft::${current}`]: 'draft',
    mlsRlActiveJob: 'appointment-job',
    providerSnapshot: 'provider',
    sf_bk_token: 'tab-token'
  });
  const deletedDbs = [];
  const indexedDB = {
    deleteDatabase(name) {
      deletedDbs.push(name);
      const request = {};
      setTimeout(() => { if (request.onsuccess) request.onsuccess(); }, 0);
      return request;
    }
  };
  const context = { localStorage, sessionStorage, indexedDB, setTimeout, clearTimeout, Promise, console };
  context.window = context;
  vm.runInNewContext(purgeSource, context, { filename: 'clinical-state-purge.js' });
  const api = context.__mlsClinicalStatePurge;
  assert(api && typeof api.purge === 'function', 'clinical purge API did not install');
  const result = api.purge(current);
  await result.databases;

  for (const key of [`${prefix}calApptsCacheV2`, `${prefix}copilotHist`, `${prefix}futureClinicalCacheNeverNamedInPurge`, 'sf_bk_token', 'sf_session', 'mlsSchedProviders', 'mlsProviderRosterV2', 'mls_patient_alias_v1', 'mls_recguard_status', 'mls_studygroups_v1']) {
    assert(!localStorage.keys().includes(key), `logout retained clinical key ${key}`);
  }
  assert(localStorage.keys().includes('sf_u::other@example.test::patients'), 'logout erased a different account namespace');
  assert(localStorage.keys().includes('mls_rail_collapsed'), 'logout erased safe device UI layout');
  assert(localStorage.keys().includes('mls.easy.viewPref'), 'logout erased safe device view preference');
  assert.strictEqual(sessionStorage.length, 0, 'logout did not clear all per-tab state');
  assert.strictEqual(sessionStorage.clears, 1, 'sessionStorage was not cleared atomically');
  assert.deepStrictEqual(deletedDbs.sort(), ['mls_rec_backup', 'mls_recguard'], 'logout did not delete both clinical audio databases');

  /* Independently derive literal global clinical storage keys from production
     writers. New matching writers must be classified without adding a logout
     one-off, while every uns(...) key is covered by the account prefix rule. */
  const productionFiles = fs.readdirSync(root)
    .filter(name => (name === 'ScribeFlow.html' || name === 'mls-connect.js' || /^feat_.*\.js$/.test(name)))
    .map(name => read(name));
  const literalKeys = new Set();
  const call = /(?:localStorage|sessionStorage)\.(?:getItem|setItem|removeItem)\(\s*(['"])([^'"]+)\1/g;
  for (const source of productionFiles) {
    let match;
    while ((match = call.exec(source))) literalKeys.add(match[2]);
  }
  const clinicalHint = /(?:patient|appt|appointment|calappt|provider|doctorid|copilot|draft|visit|note|record|recsegment|transcript|audio|athena|sched|intake|legal[_-]?visit|outcome|writeback|asstwb|(?:^|[_-])wb|pull|portal.*token|cache|history|studygroup|statuscenter|reviewreq|progress)/i;
  const derived = [...literalKeys].filter(key => clinicalHint.test(key));
  const missed = derived.filter(key => !api._test.shouldRemoveLocalKey(key, current));
  assert.deepStrictEqual(missed, [], `derived global clinical storage keys escape logout: ${missed.join(', ')}`);

  assert(backup.includes('purge: purge') && backup.includes('indexedDB.deleteDatabase(DB_NAME)'), 'record-backup database lacks a close/delete purge hook');
  assert(connect.includes('api.purgeClinicalStorage = purgeRecordingDb') && connect.includes('RG.purging = true'), 'record-guard database lacks a race-safe purge hook');

  console.log(`PASS sensitive session boundary: early URL scrub, fragment handoffs, retired mic path, network-only navigation, ${derived.length} derived storage keys, and both audio DB purges`);
})().catch(error => { console.error(error); process.exit(1); });
