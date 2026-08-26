'use strict';

/* Owner 2026-07-24: "this needs to be robust — it should keep pulling and
 * working even if I refresh or go to a different page."
 *
 * The pull engine lives in the page, so a reload killed it silently and threw
 * away 15-45 minutes of work with no trace. pr-1.0.0 records a resume intent
 * before the pull starts and clears it only when the day is genuinely complete;
 * the next load offers that exact day/provider scope for confirmation. si-2.0.0
 * carries make a resume cheap — verified charts are skipped in seconds.
 *
 * Bounds that must hold, or a resume feature becomes an infinite Athena-driving
 * loop: stale intents expire, attempts are capped, a
 * pull owned by another tab is never disturbed, the sign-in gate is respected,
 * and the doctor can always stop it.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'feat_mls_schedimport_exact.js'), 'utf8');

function block(startMarker, endMarker, label) {
  const a = src.indexOf(startMarker);
  assert(a >= 0, label + ': start marker missing: ' + startMarker);
  const b = src.indexOf(endMarker, a + startMarker.length);
  assert(b > a, label + ': end marker missing: ' + endMarker);
  return src.slice(a, b);
}

// ---------------------------------------------------------------------------
// RUNTIME: the intent store + the "is another tab pulling" check
// ---------------------------------------------------------------------------
const helpers = block('var RESUME_MAX_AGE_MS', 'function pull(opts)', 'resume helpers');
const verifiedMetadataHelpers = block('var p1MetadataFailureSerial = 0, p1MetadataFailures = [];',
  'function p1MetadataRefusal', 'verified metadata helpers');

function harness() {
  const mem = Object.create(null);
  const session = Object.create(null);
  const ctx = {
    console, Date, JSON, Number, String, Object, Math, Promise,
    safe(f, d) { try { return f(); } catch (e) { return d; } },
    isFn(f) { return typeof f === 'function'; },
    normDate(value) {
      const m = String(value || '').match(/\b(\d{4}-\d{2}-\d{2})\b/);
      return m ? m[1] : '';
    },
    estTodayKey() { return '2026-07-24'; },
    honestPullOutcome(value) { return value; },
    window: {
      uns: k => 'acct::' + k,
      localStorage: {
        getItem(k) { return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; },
        setItem(k, v) { mem[k] = String(v); },
        removeItem(k) { delete mem[k]; }
      },
      sessionStorage: {
        getItem(k) { return Object.prototype.hasOwnProperty.call(session, k) ? session[k] : null; },
        setItem(k, v) { session[k] = String(v); },
        removeItem(k) { delete session[k]; }
      }
    }
  };
  /* The resume helpers now use the canonical verified metadata writer. Keep
     the real read-after-write/read-after-remove implementation in this VM. */
  ctx.localStorage = ctx.window.localStorage;
  vm.createContext(ctx);
  vm.runInContext(verifiedMetadataHelpers + '\n' + helpers + '\nthis.api={resumeGet:resumeGet,resumeSave:resumeSave,resumeClear:resumeClear,' +
    'resumeBusyElsewhere:resumeBusyElsewhere,sanitizeScope:p1SanitizeResumeScope,scopeSignature:p1ResumeScopeSignature,' +
    'MAXAGE:RESUME_MAX_AGE_MS,MAXTRIES:RESUME_MAX_ATTEMPTS};', ctx,
    { filename: 'schedimport:resume' });
  return { api: ctx.api, mem, ctx };
}

{
  const { api, mem } = harness();
  assert.strictEqual(api.resumeGet(), null, 'no intent by default');

  const intent = {
    date: '2026-07-24', startedAt: Date.now(), attempts: 0, includeHistory: true, bodies: false,
    providerScope: { v: 1, mode: 'all', source: 'day-caller' },
    p1CensusEligible: false, tabId: 'tab-test'
  };
  assert.deepStrictEqual(JSON.parse(JSON.stringify(api.resumeSave(intent))), { ok: true },
    'the durable intent writer did not return a verified write receipt');
  const saved = api.resumeGet();
  assert.strictEqual(saved.date, '2026-07-24', 'the intent round-trips');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(saved.providerScope)), intent.providerScope,
    'the exact all-provider scope did not round-trip');
  assert.strictEqual(saved.tabId, 'tab-test', 'the writing tab identity did not round-trip');
  assert.strictEqual(saved.p1CensusEligible, false, 'the census exception widened while persisted');
  assert(Object.keys(mem).some(k => k === 'acct::pullResumeV1'),
    'the intent must live in the account namespace so another account never inherits it');

  assert.deepStrictEqual(JSON.parse(JSON.stringify(api.resumeClear())), { ok: true },
    'the durable intent remover did not return a verified removal receipt');
  assert.strictEqual(api.resumeGet(), null, 'a completed pull clears its intent');

  assert.deepStrictEqual(JSON.parse(JSON.stringify(api.sanitizeScope({ v: 1, mode: 'all', source: 'day-caller' }))),
    { v: 1, mode: 'all', source: 'day-caller' }, 'a valid exact all-provider scope was rejected');
  assert.strictEqual(api.sanitizeScope({ v: 1, mode: 'all', source: 'day-caller', id: 'must-not-widen' }), null,
    'an all-provider scope carrying a selected identity was accepted');
  assert.strictEqual(api.sanitizeScope({ v: 1, mode: 'selected', source: 'day-caller' }), null,
    'a selected-provider scope without a stable identity was accepted');
  const selected = api.sanitizeScope({ v: 1, mode: 'selected', source: 'day-caller', stableKey: 'athena:provider-7' });
  assert(selected && selected.stableKey === 'athena:provider-7', 'a valid stable selected-provider scope was rejected');
  assert.strictEqual(api.sanitizeScope({ v: 1, mode: 'selected', source: 'day-caller', stableKey: 'x'.repeat(161) }), null,
    'an oversized provider identity entered the resume record');
  assert.strictEqual(api.sanitizeScope({ v: 1, mode: 'selected', source: 'day-caller', stableKey: 'provider\n7' }), null,
    'a provider identity with control characters entered the resume record');
  assert.notStrictEqual(api.scopeSignature(selected), api.scopeSignature({ v: 1, mode: 'all', source: 'day-caller' }),
    'selected and all-provider scopes collapsed to one durable identity');
}

{
  // Corrupt bytes fail closed and publish a PHI-free metadata receipt. They are
  // not silently deleted by a read path that cannot prove what they contain.
  const { api, mem, ctx } = harness();
  mem['acct::pullResumeV1'] = '{not json';
  assert.strictEqual(api.resumeGet(), null, 'a corrupt intent reads as absent, never throws');
  assert.strictEqual(mem['acct::pullResumeV1'], '{not json', 'a failed read silently destroyed durable bytes');
  assert(ctx.window.__mlsP1MetadataWriteFailed &&
    ctx.window.__mlsP1MetadataWriteFailed.reason === 'metadata-persist-failed',
  'a corrupt intent did not publish the bounded metadata refusal receipt');
}

{
  // another tab mid-pull must be left alone (fresh stamp), but a dead tab must not block forever
  const { api, mem } = harness();
  assert.strictEqual(api.resumeBusyElsewhere(), false, 'no stamp = nobody pulling');
  mem['acct::mlsPullBusyXTabV1'] = String(Date.now());
  assert.strictEqual(api.resumeBusyElsewhere(), true, 'a fresh cross-tab stamp must suppress the resume');
  mem['acct::mlsPullBusyXTabV1'] = String(Date.now() - 120000);
  assert.strictEqual(api.resumeBusyElsewhere(), false, 'a stale stamp (dead tab) must not block the resume forever');
}

{
  const { api } = harness();
  assert.strictEqual(api.MAXTRIES, 2, 'resume attempts must be capped so a failing day cannot loop');
  assert.strictEqual(api.MAXAGE, 6 * 60 * 60 * 1000, 'intents older than 6h are abandoned, not offered');
}

// ---------------------------------------------------------------------------
// RUNTIME: a queued card may start only the exact record it originally offered
// ---------------------------------------------------------------------------
let resumeRuntimePromise = Promise.resolve();
{
  const { api, mem, ctx } = harness();
  const driverStart = src.indexOf('var resumeTimer = null, resumeCard = null;');
  const driverEnd = src.indexOf('function resumeOffer(rec)', driverStart);
  assert(driverStart >= 0 && driverEnd > driverStart, 'resumeStart runtime block is missing');
  const pullCalls = [];
  let selectedDay = '2026-07-28';
  Object.assign(ctx, {
    Promise,
    lastPullResult: null,
    pull(opts) { pullCalls.push(opts); return Promise.resolve({ ok: true, complete: true }); },
    toast() {},
    clearInterval() {},
    document: { getElementById() { return null; } },
    P1_DAY_CENSUS_TOKEN: { privateLane: true },
    /* rsk-1.0.0: pass-through stub so the refusal's real instrument call site
       executes in this harness; the assertion below reads what flowed through. */
    honestPullOutcome(r) { return r; }
  });
  ctx.window.__mlsDsStatus = function () {};
  ctx.window.__mlsDaySwitch = { currentDay() { return selectedDay; } };
  vm.runInContext(src.slice(driverStart, driverEnd) + '\nthis.resumeStartRuntime=resumeStart;', ctx,
    { filename: 'schedimport:resume-start' });

  const allScope = { v: 1, mode: 'all', source: 'day-caller' };
  const selectedScope = { v: 1, mode: 'selected', source: 'day-caller', stableKey: 'athena:provider-7' };
  api.resumeSave({ date: '2026-07-28', startedAt: Date.now(), attempts: 0, includeHistory: true,
    bodies: false, providerScope: allScope, p1CensusEligible: false });
  const captured = JSON.parse(JSON.stringify(api.resumeGet()));
  api.resumeSave({ date: '2026-07-28', startedAt: Date.now(), attempts: 0, includeHistory: true,
    bodies: false, providerScope: selectedScope, p1CensusEligible: false });
  const changed = ctx.resumeStartRuntime(captured);
  assert(changed && changed.reason === 'resume-scope-changed',
    'a changed durable provider scope did not return its explicit refusal');
  assert.strictEqual(pullCalls.length, 0, 'a changed provider scope started Athena navigation');
  assert(!Object.prototype.hasOwnProperty.call(mem, 'acct::pullResumeV1'),
    'a contradictory captured/durable scope was left eligible for a later resume');

  api.resumeSave({ date: '2026-07-29', startedAt: Date.now(), attempts: 0, includeHistory: true,
    bodies: false, providerScope: allScope, p1CensusEligible: false });
  const wrongDayRecord = JSON.parse(JSON.stringify(api.resumeGet()));
  const wrongDay = ctx.resumeStartRuntime(wrongDayRecord);
  assert(wrongDay && wrongDay.reason === 'resume-day-not-selected' &&
    wrongDay.target === '2026-07-29' && wrongDay.selectedDay === '2026-07-28',
  'a resume for a different selected day did not fail closed with exact day evidence');
  assert.strictEqual(pullCalls.length, 0, 'a different-day resume started Athena navigation');
  assert(Object.prototype.hasOwnProperty.call(mem, 'acct::pullResumeV1'),
    'the day-selection refusal silently destroyed the unfinished day record');
  /* rsk-1.0.0 (owner 2026-08-26, "make sure this resume pull button works",
     measured live): a wrong-day click used to dismiss the chip BEFORE the
     gate and write no outcome - the click looked eaten. The refusal must now
     reach the pull outcome instrument, tell the doctor the offer survives,
     and the dismiss must sit AFTER the day gate in resumeStart. */
  assert(ctx.window.__mlsPullLastOutcome && ctx.window.__mlsPullLastOutcome.reason === 'resume-day-not-selected',
    'rsk-1.0.0: the wrong-day refusal must reach window.__mlsPullLastOutcome');
  assert(/the offer stays/.test(wrongDay.error),
    'rsk-1.0.0: the refusal copy must say the Resume offer survives');
  {
    const driverSrc = src.slice(driverStart, driverEnd);
    const startBody = driverSrc.slice(driverSrc.indexOf('function resumeStart'));
    const gateAt = startBody.indexOf('resume-day-not-selected');
    const dismissAt = startBody.indexOf('resumeDismiss(false);');
    assert(gateAt >= 0 && dismissAt > gateAt,
      'rsk-1.0.0: resumeStart must gate the day BEFORE dismissing the chip - a wrong-day click must not eat the Resume offer');
  }

  api.resumeClear();
  selectedDay = '2026-07-30';
  api.resumeSave({ date: selectedDay, startedAt: Date.now(), attempts: 0, includeHistory: true,
    bodies: false, providerScope: selectedScope, p1CensusEligible: false });
  const unverifiedSelected = JSON.parse(JSON.stringify(api.resumeGet()));
  const unverified = ctx.resumeStartRuntime(unverifiedSelected);
  assert(unverified && unverified.reason === 'resume-provider-scope-unverified',
    'a selected provider absent from the verified roster was widened or started');
  assert.strictEqual(pullCalls.length, 0, 'an unverified selected provider started Athena navigation');
  assert.strictEqual(JSON.parse(mem['acct::pullResumeV1']).attempts, 1,
    'an unverified selected-provider attempt was not counted toward the bounded cap');

  api.resumeClear();
  selectedDay = '2026-07-31';
  api.resumeSave({ date: selectedDay, startedAt: Date.now(), attempts: 0, includeHistory: false,
    bodies: true, providerScope: allScope, p1CensusEligible: false });
  const exact = JSON.parse(JSON.stringify(api.resumeGet()));
  ctx.resumeStartRuntime(exact);
  assert.strictEqual(pullCalls.length, 1, 'an exact durable all-provider resume did not start once');
  assert.strictEqual(pullCalls[0].date, selectedDay);
  assert.strictEqual(pullCalls[0].provider, 'all', 'an exact all-provider resume changed provider scope');
  assert.strictEqual(pullCalls[0].__p1ResumeScopeSource, 'day-caller', 'the frozen scope source was dropped');
  assert.strictEqual(pullCalls[0].includeHistory, false);
  assert.strictEqual(pullCalls[0].pullVisitBodies, true);
  assert(!Object.prototype.hasOwnProperty.call(pullCalls[0], '__p1DayCensusToken'),
    'an ordinary all-provider record invented the private census exception');

  api.resumeClear();
  selectedDay = '2026-08-01';
  api.resumeSave({ date: selectedDay, startedAt: Date.now(), attempts: 0, includeHistory: true,
    bodies: null, providerScope: allScope, p1CensusEligible: true });
  const censusExact = JSON.parse(JSON.stringify(api.resumeGet()));
  ctx.resumeStartRuntime(censusExact);
  assert.strictEqual(pullCalls.length, 2, 'a verified exact census resume did not start once');
  assert.strictEqual(pullCalls[1].__p1DayCensusToken, ctx.P1_DAY_CENSUS_TOKEN,
    'the guarded all-day census record did not retain its private capability');

  resumeRuntimePromise = Promise.resolve().then(() => {
    console.log('PASS pull resume runtime: exact day/scope required, unverified identity refuses, and census capability never widens');
  });
}

// ---------------------------------------------------------------------------
// SOURCE CONTRACT: where the intent is written, cleared, and acted on
// ---------------------------------------------------------------------------
{
  const pullFn = block('function pull(opts) {', 'var monthPullRunning', 'pull');
  const persistAt = pullFn.indexOf('var __resumeIntent = p1PersistResumeIntent(__resumeDate, opts, opts.provider,');
  const persistReceiptAt = pullFn.indexOf('if (!(__resumeIntent.persistence && __resumeIntent.persistence.ok === true))');
  const batchAt = pullFn.indexOf('return withPatientBatch("schedule-pull"');
  assert(persistAt >= 0 && persistReceiptAt > persistAt && batchAt > persistReceiptAt,
    'the intent must be recorded when the pull starts, not after it succeeds');
  assert(pullFn.includes('if (__resumeDate && __ownedPull && value && value.complete !== true && p1ResumeVerdictIsTerminal(value))'),
    'only the acquired pull may clear a terminal non-partial verdict');
  assert(pullFn.includes('if (__resumeDate && value && value.complete === true) {') &&
    pullFn.includes('if (!(__resumeClear && __resumeClear.ok === true))'),
  'a genuinely complete day must clear through a verified removal receipt');
  assert(!/value\.ok === true\) resumeClear/.test(pullFn),
    'ok is not completeness; clearing on ok would forget partial days');

  const driver = block('var resumeTimer = null, resumeCard = null;', '  /* ======================================================================', 'resume driver');
  assert(driver.includes('if (Number(rec.attempts || 0) >= RESUME_MAX_ATTEMPTS) { decline("attempts-exhausted"); return; }'),
    'the attempt cap must be enforced before offering a resume');
  assert(driver.includes('if (pullRunning || resumeBusyElsewhere()) { decline("pull-in-flight"); return; }'),
    'a pull already running here or in another tab must never be duplicated');
  assert(driver.includes('if (!(Date.now() - Number(rec.startedAt || 0) < RESUME_MAX_AGE_MS)) { resumeClear(); decline("expired"); return; }'),
    'an expired intent must be cleared before it can be offered');
  assert(driver.includes('if (rec.tabId && String(rec.tabId) !== p1TabId()) { decline("foreign-tab"); return; }'),
    'another tab must not adopt the writing tab\'s interrupted pull');
  assert(driver.includes('if (selectedDay && normDate(rec.date) !== selectedDay) { decline("other-day"); return; }'),
    'a resume offer must remain bound to the day currently selected by the doctor');
  assert(driver.includes('p1SanitizeResumeScope(rec && rec.providerScope)') &&
    driver.includes('p1SanitizeResumeScope(prev && prev.providerScope)') &&
    driver.includes('p1ResumeScopeSignature(capturedScope) !== p1ResumeScopeSignature(durableScope)'),
  'a queued resume must re-read and match the exact sanitized durable provider scope');
  assert(driver.includes('refuseResume("resume-scope-changed"') &&
    driver.includes('refuseResume("resume-provider-scope-unverified"') &&
    driver.includes('var resumeProvider = p1ResolveResumeProvider(capturedScope);'),
  'changed or unverified provider identity must refuse instead of widening');
  assert(driver.includes('rec && rec.p1CensusEligible === true && prev && prev.p1CensusEligible === true') &&
    driver.includes('if (p1ResumeCensusEligible) resumeOpts.__p1DayCensusToken = P1_DAY_CENSUS_TOKEN;'),
  'the private census exception must require matching eligibility in captured and durable all-provider records');
  assert(/if \(!signedIn\) return;/.test(driver),
    'a resume must never run over the sign-in gate');
  assert(driver.includes('resumeOffer(rec);') &&
    !/(?:setTimeout|setInterval)\s*\(\s*function[\s\S]{0,250}\bresumeStart\s*\(/.test(driver),
  'resume must be offered for confirmation, never started by a countdown or timer');
  assert(driver.includes('mlsPullResumeGo') && driver.includes('resumeStart(rec);'),
    'the doctor must have an explicit Resume action');
  assert(driver.includes('mlsPullResumeFresh') && driver.includes('resumeDismiss(true);'),
    'Start over must clear the unfinished intent');
  assert(driver.includes('mlsPullResumeNo') && driver.includes('resumeDismiss(false);'),
    'Not now must dismiss without destroying the unfinished intent');
  assert(driver.includes('Resume skips charts already verified today; nothing runs until you choose.'),
    'the offer must explain both cheap convergence and the doctor-confirmation gate');
}

resumeRuntimePromise.then(() => {
  console.log('PASS pull resume: an interrupted exact day/provider scope is offered after reload, bounded by a 6h expiry, 2-attempt cap, tab ownership, census capability, sign-in, and explicit doctor confirmation');
}).catch(error => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
