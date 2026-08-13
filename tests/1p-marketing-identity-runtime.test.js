'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');
const shellA = fs.readFileSync(path.join(root, '1p', 'index.html'), 'utf8');
const shellB = fs.readFileSync(path.join(root, '1pScribeFlow.html'), 'utf8');
let checks = 0;
function eq(a, b, m) { assert.strictEqual(a, b, m); checks++; }
function ok(v, m) { assert.ok(v, m); checks++; }
function extract(src) {
  const start = src.indexOf('window.__mlsP1MarketingIdentity=function(){');
  assert(start >= 0, 'identity accessor missing');
  const end = src.indexOf('\n};', start);
  assert(end > start, 'identity accessor terminator missing');
  return src.slice(start, end + 3);
}
function extractFunction(src, name, nextMarker) {
  const start = src.indexOf(`function ${name}(`); assert(start >= 0, `${name} missing`);
  const end = src.indexOf(nextMarker, start); assert(end > start, `${name} terminator missing`);
  return src.slice(start, end);
}
const accessorA = extract(shellA), accessorB = extract(shellB);
eq(accessorA, accessorB, '1p shells do not expose identical bounded identity receipts');

function receipt({ account = 'doctor@example.invalid', sessionEmail = account, userEmail = account, role = 'user', epoch = 1, readyEpoch = epoch, isAdmin = false, isHead = false, isLawyer = false } = {}) {
  const context = {
    window: { __mlsSessionAccount: account, __mlsSessionEpoch: epoch },
    session: sessionEmail == null ? null : { email: sessionEmail },
    bkUser: userEmail == null ? null : { email: userEmail, role, isAdmin, isHead, isLawyer },
    sfNormalizeSessionAccount: value => String(value || '').trim().toLowerCase(),
    getSessionEmail: () => sessionEmail || '', Object, Number, String
  };
  vm.createContext(context); vm.runInContext(`let sfP1MarketingIdentityReadyEpoch=${Number(readyEpoch) || 0};\n${accessorA}`, context);
  return context.window.__mlsP1MarketingIdentity();
}

eq(receipt().resolved, true, 'matched clinician identity did not resolve');
eq(receipt({ role: 'owner' }).resolved, true, 'matched owner identity did not resolve');
eq(receipt({ role: '', isAdmin: true }).role, 'admin', 'server admin flag did not canonicalize');
eq(receipt({ role: '', isHead: true }).role, 'head', 'server head flag did not canonicalize');
eq(receipt({ account: '' }).resolved, false, 'logout receipt resolved from stale lexical identity');
eq(receipt({ account: 'b@example.invalid', sessionEmail: 'a@example.invalid', userEmail: 'a@example.invalid' }).resolved, false, 'transition account mismatch resolved');
eq(receipt({ sessionEmail: 'a@example.invalid', userEmail: 'b@example.invalid' }).resolved, false, 'session/bkUser mismatch resolved');
eq(receipt({ role: '' }).resolved, false, 'missing role defaulted to clinician');
eq(receipt({ epoch: 2, readyEpoch: 1 }).resolved, false, 'stale role receipt resolved before current identity-ready epoch');
eq(receipt({ epoch: 2, readyEpoch: 0 }).resolved, false, 'boundary-cleared identity latch resolved');
eq(receipt({ epoch: 77 }).epoch, 77, 'receipt omitted session epoch');
const bounded = receipt();
eq(Object.keys(bounded).sort().join(','), 'email,epoch,isAdmin,isHead,isLawyer,resolved,role', 'receipt leaks account object fields');
ok(Object.isFrozen(bounded), 'identity receipt is mutable');
for (const shell of [shellA, shellB]) {
  ok(/window\.__mlsSessionAccount\|\|''/.test(extract(shell)), 'accessor does not require authoritative boundary account');
  ok(/readyEpoch===epoch/.test(extract(shell)), 'accessor does not require exact identity-ready epoch');
  ok(/let sfP1MarketingIdentityReadyEpoch=0;/.test(shell), 'identity-ready latch is not lexical');
  ok(/sfP1MarketingIdentityReadyEpoch=0;[\s\S]*?mls:session-boundary/.test(shell), 'boundary does not clear Marketing identity readiness before dispatch');
  ok(!/window\.__mlsP1MarketingIdentityReadyEpoch/.test(shell), 'identity-ready latch is publicly writable');
  ok(/mls:p1-marketing-identity-ready/.test(shell), 'shell never reconciles Marketing after /api/me role resolution');
  ok(/window\.__mlsSessionEpoch/.test(shell), 'shell receipt omits same-email reauth epoch');
  const release = extractFunction(shell, 'sfP1ReleaseMarketingIdentity', '\n/* Special marker');
  ok(/email!==account\|\|!allowed/.test(release), 'identity release does not validate fresh server email/role');
  ok(/\?0:\(Number\(window\.__mlsSessionEpoch\)\|\|0\)/.test(release), 'malformed/unknown identity does not keep latch closed');
  ok(/dispatchEvent[\s\S]*?return sfP1MarketingIdentityReadyEpoch>0/.test(release), 'denied identity does not synchronously reconcile Marketing');
  const apply = extractFunction(shell, 'applyAccessUI', '\nasync function redeemCode');
  ok(!/sfP1MarketingIdentityReadyEpoch|mls:p1-marketing-identity-ready/.test(apply), 'generic applyAccessUI can certify stale identity');
  ok(/if\(!d\.user\|\|typeof d\.user!==['"]object['"]\)\{ sfP1ReleaseMarketingIdentity\(null\)/.test(shell), '/api/me malformed user retains stale Marketing role');
  ok(/const requestEpoch=Number\(window\.__mlsSessionEpoch\)\|\|0/.test(shell) && /requestStillOwned/.test(shell), '/api/me response is not bound to its starting session epoch');
  ok(/bkUser=d\.user;[\s\S]*?applyAccessUI\(\);[\s\S]*?sfP1ReleaseMarketingIdentity\(d\.user\);/.test(shell), 'fresh authoritative identity is not the sole Marketing release site');
}

async function verifyDeferredSameEmailResponseCannotCrossEpoch() {
  const start = shellA.indexOf("var _refreshMeInFlight=null");
  const end = shellA.indexOf('\n/* 401 from the backend', start);
  assert(start >= 0 && end > start, 'refreshMe extraction failed');
  const refreshSource = shellA.slice(start, end);
  let resolveFetch, releases = 0;
  const context = {
    window: { __mlsSessionEpoch: 1 }, Promise, Number,
    backendMode: () => true, bkToken: () => 'same-token', bkBase: () => 'https://example.invalid',
    sfStartupValid: () => true, setTimeout: fn => { fn(); return 1; },
    fetch: () => new Promise(resolve => { resolveFetch = resolve; }),
    sfP1ReleaseMarketingIdentity: () => { releases++; return true; },
    console
  };
  vm.createContext(context);
  vm.runInContext(`var bkUser={email:'doctor@example.invalid',role:'receptionist'};\n${refreshSource}`, context);
  const pending = context.refreshMe({});
  context.window.__mlsSessionEpoch = 2;
  resolveFetch({ ok: true, status: 200, json: () => Promise.resolve({ user: { email: 'doctor@example.invalid', role: 'doctor' } }) });
  eq(await pending, false, 'old same-token /api/me response crossed a new session epoch');
  eq(releases, 0, 'old same-token /api/me response released stale clinician authority');
  eq(context.bkUser.role, 'receptionist', 'old same-token /api/me response replaced fresh demoted identity');
}

verifyDeferredSameEmailResponseCannotCrossEpoch().then(function () {
  console.log(`PASS 1p Marketing identity runtime (${checks} assertions)`);
}, function (error) {
  console.error(error && error.stack || error); process.exitCode = 1;
});
