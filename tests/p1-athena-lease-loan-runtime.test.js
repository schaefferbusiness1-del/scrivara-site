'use strict';

/* p1-lease-loan-1.0.0 — the schedule pull's Athena read lease, LOANED to the
   today-note leg that cannot carry a token of its own.

   Owner report 2026-08-16: schedule read 6/6, mapped 6/6, zero failures —
   then all six today-note reads failed "pull-in-flight: another Athena read
   or schedule pull is active. Nothing started." The pull threads
   siAthenaOwnerToken into its own five _assistReadChart calls, but the
   today-note leg reaches the reader through the FROZEN feat_visits.js, which
   calls _assistReadChart(target, cb) with no options object at all. With no
   token the reader attempted a fresh claim(), lost to the lease the pull was
   already holding, and refused every row.

   The fix (already shipped, not touched by this suite):
     - 1p-feat_mls_schedimport_exact.js: the pull publishes its own token as
       window.__mlsP1AthenaLeaseLoan when it claims the lease, and withdraws
       it on every exit path — but ONLY if the loan is still its own token.
     - 1pScribeFlow.html / 1p/index.html (byte-identical twins), inside
       _assistReadChart: a caller with NO token of its own may join the loan,
       but only while leaseMgr.owns(loan) still says it is the live owner.

   This suite proves six safety properties, in order:
     1. The bug is fixed — a no-token caller joins a live loaned lease.
     2. A stale loan (owns() now false) grants nothing; same refusal as before.
     3. A forged loan (a token the manager never issued) grants nothing.
     4. A borrowing read NEVER releases a lease it does not own — the most
        important property, because the alternative is a today-note read
        freeing the schedule pull's lease out from under it mid-pull.
     5. An explicit-but-stale token does not silently fall back to a loan.
     6. The publisher withdraws only ITS OWN loan, never a later one.

   For properties 1, 2 and 4, the exact same assertion is re-run against a
   deliberately broken scratch copy of the sliced source (string-mutated in
   memory; the real files on disk are never touched) to prove each assertion
   is load-bearing rather than vacuously true. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
let passed = 0;
function ok(v, m) { assert.ok(v, m); passed++; }
function eq(a, b, m) { assert.strictEqual(a, b, m); passed++; }
function tick(n) { let p = Promise.resolve(); for (let i = 0; i < (n || 1); i++) p = p.then(() => Promise.resolve()); return p; }

function sliceBetween(text, start, end) {
  const a = text.indexOf(start), b = text.indexOf(end, a + start.length);
  assert(a >= 0 && b > a, 'missing executable slice: ' + start);
  return text.slice(a, b);
}

const HELPER_START = 'function _athenaHistoryDigits(v)';
const HELPER_END = '/* Like _assistReadAthenaTab';
const ASSIST_START = 'function _assistReadChart(patientRef, onStatus)';
const ASSIST_END = '/* The appointment BRIEFING';

/* The exact loan-join block the fix introduced. Used both as a live sanity
   check that the shipped source still contains it verbatim, and as the
   anchor for building mutated "broken" copies below. If either literal ever
   stops matching, this suite fails loudly at the sanity check rather than
   silently testing nothing. */
const LOAN_BLOCK =
"      if(!ownerToken&&leaseMgr&&typeof leaseMgr.owns==='function'){\n" +
"        var loanToken=String(window.__mlsP1AthenaLeaseLoan||'');\n" +
"        if(loanToken&&leaseMgr.owns(loanToken)){ownerToken=loanToken;leaseReady=true;}\n" +
"      }\n";
const LOAN_CONDITION = "if(loanToken&&leaseMgr.owns(loanToken)){ownerToken=loanToken;leaseReady=true;}";
const LOAN_GRANT = "ownerToken=loanToken;leaseReady=true;";
const LOAN_GUARD = "if(!ownerToken&&leaseMgr&&typeof leaseMgr.owns==='function'){";

/* A lease-manager stub shaped like the real window.__mlsP1AthenaReadLease:
   owns/claim/touch/release, every call recorded so a test can assert not
   just outcomes but WHICH manager methods a caller invoked. */
function makeManager() {
  const calls = { claim: [], owns: [], touch: [], release: [] };
  let active = '';
  let seq = 0;
  return {
    calls: calls,
    get active() { return active; },
    claim(kind) { calls.claim.push(kind); if (active) return null; active = 'lease-' + (++seq); return active; },
    owns(t) { calls.owns.push(t); return !!t && active === t; },
    touch(t) { calls.touch.push(t); return true; },
    release(t) { calls.release.push(t); if (t !== active) return false; active = ''; return true; }
  };
}

function buildAssistContext(assistSource, helperSource, manager, patients) {
  const handlers = [], posted = [];
  const c = {
    Promise: Promise, Date: Date, Math: Math, Object: Object, String: String, Number: Number, Array: Array, RegExp: RegExp,
    setTimeout: setTimeout, clearTimeout: clearTimeout, setInterval: setInterval, clearInterval: clearInterval,
    getPatients() { return patients; }, upsertPatient() {},
    __mlsP1AthenaReadLease: manager,
    __mlsP1AthenaLeaseLoan: '',
    addEventListener(t, f) { if (t === 'message') handlers.push(f); },
    removeEventListener(t, f) { const i = handlers.indexOf(f); if (i >= 0) handlers.splice(i, 1); },
    postMessage(m) { posted.push(m); },
    location: { origin: 'https://mlsscribe.com' }
  };
  c.window = c;
  vm.runInNewContext(helperSource + '\n' + assistSource, c, { filename: 'p1-lease-loan-assist.js' });
  return { c: c, handlers: handlers, posted: posted };
}

function goodReceiptFor(requestId, text) {
  return {
    kind: 'athena-chart-coverage', requestId: requestId, complete: true, readerVersion: '2.9.19-chart-r3',
    capturedAt: Date.now(), expectedClinicalFrames: 1, readClinicalFrames: 1, boundClinicalFrames: 1,
    unboundClinicalFrames: 0, oversizeClinicalFrames: 0, unreadFrames: 0, omittedForCap: 0,
    consideredFrames: 1, textChars: text.length, truncated: false, identityObserved: true, identityVia: 'banner'
  };
}

const patients = [{ id: 'p1', name: 'Exact Person', dob: '01/02/1980', mrn: 'A100' }];
const validTarget = { patientId: 'p1', name: 'Exact Person', dob: '01/02/1980', mrn: 'A100' };

/* ---------------------------------------------------------------------- */
/* Property 1: the fix works — a live lease held elsewhere + a published   */
/* loan lets a no-token caller past the gate instead of being refused.     */
/* ---------------------------------------------------------------------- */
async function propertyOneGetsPastTheGate(assistSource, helperSource, label) {
  const mgr = makeManager();
  const pullToken = mgr.claim('p1-si-managed');
  ok(pullToken, label + ': test setup could not claim the initial owning lease');
  const built = buildAssistContext(assistSource, helperSource, mgr, patients);
  built.c.__mlsP1AthenaLeaseLoan = pullToken;
  const pending = built.c._assistReadChart(validTarget, function () {});
  pending.catch(function () {}); /* swallow so a broken-source rejection doesn't crash the process */
  await tick(3);
  ok(built.posted.some(function (m) { return m.type === 'mlsPing'; }),
    label + ': a loaned no-token read did not get past the Athena lease gate (property 1)');
  eq(mgr.calls.claim.length, 1,
    label + ': a loaned no-token read attempted its own fresh claim instead of joining the published loan (property 1)');
  return built;
}

/* Full round trip on top of property 1, doubling as the success-path half
   of property 4 (see below): a borrowed read must resolve normally AND
   never call leaseMgr.release. */
async function propertyOneAndFourFullRoundTrip(assistSource, helperSource, label) {
  const mgr = makeManager();
  const pullToken = mgr.claim('p1-si-managed');
  const built = buildAssistContext(assistSource, helperSource, mgr, patients);
  built.c.__mlsP1AthenaLeaseLoan = pullToken;
  const pending = built.c._assistReadChart(validTarget, function () {});
  await tick(3);
  built.handlers.slice().forEach(function (f) { f({ data: { source: 'mls-ext', type: 'mlsPong' } }); });
  await tick(2);
  const req = built.posted.filter(function (x) { return x.type === 'mlsAppReadChart'; }).pop();
  ok(req && req.patientId === 'p1', label + ': loaned read never dispatched the owned chart read');
  const text = 'verified-loan-read';
  const receipt = goodReceiptFor(req.requestId, text);
  built.handlers.slice().forEach(function (f) {
    f({ data: { source: 'mls-ext', type: 'mlsAppChartResult', requestId: req.requestId, deadlineAt: req.deadlineAt,
      resp: { ok: true, requestId: req.requestId, text: text, chartName: 'Exact Person', chartDob: '01/02/1980', chartMrn: 'A100', receipt: receipt } } });
  });
  const result = await pending;
  ok(result && result.text === text, label + ': loaned read did not resolve with the chart text');
  eq(mgr.calls.release.length, 0,
    label + ': a borrowing read released a lease it never owned after a successful round trip (property 4)');
  eq(mgr.active, pullToken,
    label + ': a borrowing read tore down the pull\'s still-live central lease (property 4)');
}

/* The early-rejection half of property 4: a loaned read that fails BEFORE
   ever pinging the extension must also never release. */
async function propertyFourEarlyRejection(assistSource, helperSource, label) {
  const mgr = makeManager();
  const pullToken = mgr.claim('p1-si-managed');
  const built = buildAssistContext(assistSource, helperSource, mgr, patients);
  built.c.__mlsP1AthenaLeaseLoan = pullToken;
  await assert.rejects(
    built.c._assistReadChart({ name: 'No Dob Or Mrn' }, function () {}),
    /verified DOB or MRN/,
    label + ': invalid-target rejection changed shape on the loan path'
  );
  eq(mgr.calls.release.length, 0, label + ': an early-rejected loaned read released a lease it never owned (property 4)');
  eq(mgr.active, pullToken, label + ': early rejection on the loan path tore down the live central lease (property 4)');
}

/* ---------------------------------------------------------------------- */
/* Property 2: a stale loan — the token WAS the live owner, then the       */
/* underlying lease moved on — grants nothing. Same refusal as before.     */
/* ---------------------------------------------------------------------- */
async function propertyTwoStaleLoanGrantsNothing(assistSource, helperSource, label) {
  const mgr = makeManager();
  const legitToken = mgr.claim('p1-si-managed');
  const staleLoan = legitToken;
  mgr.release(legitToken);
  mgr.claim('p1-other-owner'); /* an unrelated read now legitimately holds the lease */
  const built = buildAssistContext(assistSource, helperSource, mgr, patients);
  built.c.__mlsP1AthenaLeaseLoan = staleLoan;
  await assert.rejects(
    built.c._assistReadChart(validTarget, function () {}),
    /pull-in-flight/,
    label + ': a stale loan granted access past the gate (property 2)'
  );
  ok(mgr.calls.owns.indexOf(staleLoan) >= 0, label + ': stale-loan control never asked the manager whether it still owned the token');
}

/* ---------------------------------------------------------------------- */
/* Property 3: a forged loan — a token the manager never issued at all —   */
/* grants nothing.                                                         */
/* ---------------------------------------------------------------------- */
async function propertyThreeForgedLoanGrantsNothing(assistSource, helperSource, label) {
  const mgr = makeManager();
  mgr.claim('p1-si-managed'); /* someone legitimately holds the real lease */
  const built = buildAssistContext(assistSource, helperSource, mgr, patients);
  built.c.__mlsP1AthenaLeaseLoan = 'forged-token-never-issued-by-the-manager';
  await assert.rejects(
    built.c._assistReadChart(validTarget, function () {}),
    /pull-in-flight/,
    label + ': a forged loan token granted access past the gate (property 3)'
  );
}

/* ---------------------------------------------------------------------- */
/* Property 5: an explicit-but-stale caller token must NOT silently fall   */
/* back to a valid loan. It must go to the claim path and be refused       */
/* exactly like it was before loans existed.                               */
/* ---------------------------------------------------------------------- */
async function propertyFiveExplicitStaleNeverBorrows(assistSource, helperSource, label) {
  const mgr = makeManager();
  const loanOwner = mgr.claim('p1-si-managed'); /* the loan is genuinely LIVE */
  const built = buildAssistContext(assistSource, helperSource, mgr, patients);
  built.c.__mlsP1AthenaLeaseLoan = loanOwner;
  await assert.rejects(
    built.c._assistReadChart(validTarget, function () {}, { athenaOwnerToken: 'explicit-stale-caller-token' }),
    /pull-in-flight/,
    label + ': an explicit stale token silently fell back to the live loan (property 5)'
  );
  ok(mgr.calls.claim.length >= 2,
    label + ': an explicit-token caller with a rejected token never attempted its own claim (property 5)');
}

/* ---------------------------------------------------------------------- */
/* Run properties 1-5 against BOTH real shells (byte-identical twins).     */
/* ---------------------------------------------------------------------- */
async function realShellMatrix() {
  for (const rel of ['1p/index.html', '1pScribeFlow.html']) {
    const html = fs.readFileSync(path.join(root, rel), 'utf8');
    const helperSource = sliceBetween(html, HELPER_START, HELPER_END);
    const assistSource = sliceBetween(html, ASSIST_START, ASSIST_END);
    ok(assistSource.includes(LOAN_BLOCK), rel + ': p1-lease-loan-1.0.0 fix block not found verbatim (mutation anchors are stale)');

    await propertyOneGetsPastTheGate(assistSource, helperSource, rel);
    await propertyOneAndFourFullRoundTrip(assistSource, helperSource, rel);
    await propertyFourEarlyRejection(assistSource, helperSource, rel);
    await propertyTwoStaleLoanGrantsNothing(assistSource, helperSource, rel);
    await propertyThreeForgedLoanGrantsNothing(assistSource, helperSource, rel);
    await propertyFiveExplicitStaleNeverBorrows(assistSource, helperSource, rel);
  }
}

/* ---------------------------------------------------------------------- */
/* Property 6: the publisher withdraws only ITS OWN loan. Runs the REAL    */
/* runManagedAthenaOperation/releaseAthenaOwner from                       */
/* 1p-feat_mls_schedimport_exact.js (the pull side of the fix). A pull's   */
/* task callback simulates a second, independent pull publishing its own   */
/* loan on the shared window while the first pull's operation is still     */
/* settling; the first pull's teardown must not touch it.                  */
/* ---------------------------------------------------------------------- */
async function propertySixPublisherWithdrawsOnlyItsOwn() {
  const si = fs.readFileSync(path.join(root, '1p-feat_mls_schedimport_exact.js'), 'utf8');
  const block = sliceBetween(si, 'var SI_LEASE_ID =', 'function retryFailedHistory(source, onStatus)');
  ok(block.includes('window.__mlsP1AthenaLeaseLoan = athenaToken;'), 'schedimport publish line not found verbatim (mutation anchor stale)');
  ok(block.includes('if(window.__mlsP1AthenaLeaseLoan===athenaToken) window.__mlsP1AthenaLeaseLoan=""'), 'schedimport withdrawal guard not found verbatim (mutation anchor stale)');

  let active = '', seq = 0;
  const mgr = {
    claim() { if (active) return null; active = 'si-owner-' + (++seq); return active; },
    ready(t) { return t === active; },
    touch() { return true; },
    release(t) { if (t !== active) return false; active = ''; return true; }
  };
  const store = new Map();
  const c = {
    Promise: Promise, Date: Date, Math: Math, Object: Object, String: String, Number: Number, Array: Array, RegExp: RegExp, isFinite: isFinite,
    setTimeout: setTimeout, clearTimeout: clearTimeout, setInterval() { return 1; }, clearInterval() {},
    safe(fn, fallback) { try { const v = fn(); return v === undefined ? fallback : v; } catch (e) { return fallback; } },
    isFn(v) { return typeof v === 'function'; },
    pullRunning: false,
    releaseManagedAthenaWorkspace() {},
    __mlsP1AthenaReadLease: mgr,
    __mlsSchedulePullLease: null,
    __mlsPullBusyAt: 0,
    __mlsP1AthenaLeaseLoan: '',
    localStorage: { setItem(k, v) { store.set(k, v); }, removeItem(k) { store.delete(k); } },
    navigator: { locks: { request() { throw new Error('nested Web Lock must not run'); } } },
    uns(v) { return v; }
  };
  c.window = c;
  vm.runInNewContext(block + '\nwindow.__testManaged=runManagedAthenaOperation;', c, { filename: 'p1-si-lease-loan.js' });

  let tokenAAtPublishTime = '';
  const resultA = await c.window.__testManaged(function () {
    tokenAAtPublishTime = c.window.__mlsP1AthenaLeaseLoan;
    /* Simulate pull B: a later, independent Athena owner claims and
       publishes its OWN loan on the shared window while pull A's operation
       is still settling. */
    c.window.__mlsP1AthenaLeaseLoan = 'pull-B-loan-token';
    return { ok: true, complete: true };
  }, function () { return { ok: false, complete: false }; });

  ok(tokenAAtPublishTime, 'pull A did not publish its own loan before its task ran');
  ok(resultA && resultA.ok === true, 'pull A did not complete its managed operation');
  eq(c.window.__mlsP1AthenaLeaseLoan, 'pull-B-loan-token',
    'pull A\'s teardown withdrew a loan it never published — the publisher must only withdraw its own (property 6)');

  /* Negative control in the same context: an ordinary single-owner exit
     (nobody overwrote the loan mid-flight) DOES withdraw its own loan. */
  const resultB = await c.window.__testManaged(function () { return { ok: true, complete: true }; }, function () { return { ok: false, complete: false }; });
  ok(resultB && resultB.ok === true, 'pull B (second managed op, same context) did not complete');
  eq(c.window.__mlsP1AthenaLeaseLoan, '', 'a normal single-owner teardown did not withdraw its own loan');
}

/* ---------------------------------------------------------------------- */
/* Adversarial controls: properties 1, 2 and 4, re-run against deliberately */
/* broken SCRATCH COPIES of the sliced source (string-mutated in memory —   */
/* the real files on disk are never touched). Each must fail the SAME       */
/* assertion used above, proving the assertion is load-bearing.             */
/* ---------------------------------------------------------------------- */
async function expectAssertionFailure(label, fn) {
  try {
    await fn();
  } catch (e) {
    if (e instanceof assert.AssertionError) {
      console.log('  [adversarial control correctly FAILED against broken source] ' + label + ' -> ' + e.message);
      passed++;
      return;
    }
    throw e;
  }
  throw new Error('ADVERSARIAL CONTROL DID NOT FAIL against broken source (assertion is not load-bearing): ' + label);
}

async function adversarialControlsProveTheAssertionsBite() {
  const html = fs.readFileSync(path.join(root, '1pScribeFlow.html'), 'utf8');
  const helperSource = sliceBetween(html, HELPER_START, HELPER_END);
  const assistSource = sliceBetween(html, ASSIST_START, ASSIST_END);
  ok(assistSource.includes(LOAN_BLOCK), 'mutation anchor LOAN_BLOCK not found verbatim in the shipped source');
  ok(assistSource.includes(LOAN_CONDITION), 'mutation anchor LOAN_CONDITION not found verbatim in the shipped source');
  ok(assistSource.includes(LOAN_GRANT), 'mutation anchor LOAN_GRANT not found verbatim in the shipped source');
  ok(assistSource.split(LOAN_GRANT).length - 1 === 1, 'LOAN_GRANT literal is not unique in the shipped source');

  /* --- Property 1 control: pre-fix bytes (the whole loan-join block gone). */
  const preFixSource = assistSource.replace(LOAN_BLOCK, '');
  ok(preFixSource.length < assistSource.length, 'pre-fix mutation removed no bytes');
  await expectAssertionFailure(
    'property 1 against pre-fix bytes (no loan-join block at all)',
    function () { return propertyOneGetsPastTheGate(preFixSource, helperSource, 'pre-fix-scratch-copy'); }
  );

  /* --- Property 2 control: a "fix" that accepts ANY loan without checking
     leaseMgr.owns() first — a plausible careless implementation of "join the
     loan" that forgets the one check that keeps it fail-closed. */
  const blindAcceptSource = assistSource.replace(LOAN_CONDITION, "if(loanToken){ownerToken=loanToken;leaseReady=true;}");
  ok(blindAcceptSource !== assistSource, 'blind-accept mutation did not change the source');
  await expectAssertionFailure(
    'property 2 against a blind-accept mutation (owns() check removed)',
    function () { return propertyTwoStaleLoanGrantsNothing(blindAcceptSource, helperSource, 'blind-accept-scratch-copy'); }
  );

  /* --- Property 4 control: a "fix" that marks the borrowed token as OWNED
     (ownedToken=loanToken), so cleanup()'s releaseLease() calls
     leaseMgr.release() on a lease this read never actually owned. */
  const releaseOnLoanSource = assistSource.replace(LOAN_GRANT, "ownerToken=loanToken;ownedToken=loanToken;leaseReady=true;");
  ok(releaseOnLoanSource !== assistSource, 'release-on-loan mutation did not change the source');
  await expectAssertionFailure(
    'property 4 against a release-on-loan mutation (ownedToken wrongly set on the loan path)',
    function () { return propertyOneAndFourFullRoundTrip(releaseOnLoanSource, helperSource, 'release-on-loan-scratch-copy'); }
  );

  /* --- Bonus control for property 5: removing the "!ownerToken" guard so an
     explicit (stale) caller token is ignored and the live loan is used
     anyway. Not required by the brief but cheap and directly adversarial. */
  ok(assistSource.includes(LOAN_GUARD), 'mutation anchor LOAN_GUARD not found verbatim in the shipped source');
  const ignoresExplicitTokenSource = assistSource.replace(LOAN_GUARD, "if(leaseMgr&&typeof leaseMgr.owns==='function'){");
  ok(ignoresExplicitTokenSource !== assistSource, 'ignore-explicit-token mutation did not change the source');
  await expectAssertionFailure(
    'property 5 against an ignore-explicit-token mutation (!ownerToken guard removed)',
    function () { return propertyFiveExplicitStaleNeverBorrows(ignoresExplicitTokenSource, helperSource, 'ignore-explicit-token-scratch-copy'); }
  );
}

Promise.resolve()
  .then(realShellMatrix)
  .then(propertySixPublisherWithdrawsOnlyItsOwn)
  .then(adversarialControlsProveTheAssertionsBite)
  .then(function () {
    console.log('PASS p1 Athena lease loan: ' + passed + ' assertions');
  })
  .catch(function (err) {
    console.error(err && err.stack || err);
    process.exitCode = 1;
  });
