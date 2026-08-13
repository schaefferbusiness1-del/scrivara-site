'use strict';

/* Owner 2026-07-24: "this needs to be robust — it should keep pulling and
 * working even if I refresh or go to a different page."
 *
 * The pull engine lives in the page, so a reload killed it silently and threw
 * away 15-45 minutes of work with no trace. pr-1.0.0 records a resume intent
 * before the pull starts and clears it only when the day is genuinely complete;
 * the next load continues. si-2.0.0 carries make a resume cheap — verified
 * charts are skipped in seconds.
 *
 * Bounds that must hold, or an "always resume" feature becomes an infinite
 * Athena-driving loop: stale intents expire, automatic attempts are capped, a
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

function harness() {
  const mem = Object.create(null);
  const ctx = {
    console, Date, JSON, Number, String, Object,
    safe(f, d) { try { return f(); } catch (e) { return d; } },
    isFn(f) { return typeof f === 'function'; },
    window: {
      uns: k => 'acct::' + k,
      localStorage: {
        getItem(k) { return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; },
        setItem(k, v) { mem[k] = String(v); },
        removeItem(k) { delete mem[k]; }
      }
    }
  };
  vm.createContext(ctx);
  vm.runInContext(helpers + '\nthis.api={resumeGet:resumeGet,resumeSave:resumeSave,resumeClear:resumeClear,' +
    'resumeBusyElsewhere:resumeBusyElsewhere,MAXAGE:RESUME_MAX_AGE_MS,MAXTRIES:RESUME_MAX_ATTEMPTS};', ctx,
    { filename: 'schedimport:resume' });
  return { api: ctx.api, mem, ctx };
}

{
  const { api, mem } = harness();
  assert.strictEqual(api.resumeGet(), null, 'no intent by default');

  api.resumeSave({ date: '2026-07-24', startedAt: Date.now(), attempts: 0, includeHistory: true });
  const saved = api.resumeGet();
  assert.strictEqual(saved.date, '2026-07-24', 'the intent round-trips');
  assert.strictEqual(saved.surface, 'production', 'a production intent must name its owning surface');
  assert(/^[A-Za-z0-9._:-]{1,128}$/.test(String(saved.intentId || '')),
    'a production intent must carry an exact ownership id');
  assert(Object.keys(mem).some(k => k === 'acct::prodPullResumeV1'),
    'the production intent must live in its own ACCOUNT namespace, so P1 and another account never inherit it');

  api.resumeClear();
  assert.strictEqual(api.resumeGet(), null, 'a completed pull clears its intent');

  // a corrupt intent must never throw on boot
  mem['acct::prodPullResumeV1'] = '{not json';
  assert.strictEqual(api.resumeGet(), null, 'a corrupt intent reads as absent, never throws');
  assert(!Object.prototype.hasOwnProperty.call(mem, 'acct::prodPullResumeV1'),
    'a corrupt intent is cleared instead of being reconsidered on every boot');

  // Old plain production records remain compatible and are upgraded in place.
  mem['acct::pullResumeV1'] = JSON.stringify({
    date: '2026-07-25', startedAt: Date.now(), attempts: 0, includeHistory: true
  });
  const legacy = api.resumeGet();
  assert(legacy && legacy.date === '2026-07-25' && legacy.surface === 'production' && legacy.intentId,
    'a legacy plain production intent was not upgraded safely');
  assert(Object.prototype.hasOwnProperty.call(mem, 'acct::prodPullResumeV1') &&
    !Object.prototype.hasOwnProperty.call(mem, 'acct::pullResumeV1'),
    'a plain legacy production intent was not moved out of P1\'s old key');

  // P1 used this key before the surfaces were split; production must never run it.
  api.resumeClear();
  mem['acct::pullResumeV1'] = JSON.stringify({
    surface: 'p1', date: '2026-07-26', providerScope: { v: 1, mode: 'all', source: 'day-caller' }
  });
  assert.strictEqual(api.resumeGet(), null, 'a marked P1 intent crossed into production');
  assert(Object.prototype.hasOwnProperty.call(mem, 'acct::pullResumeV1'),
    'production damaged a marked P1 intent while refusing it');
  api.resumeClear();
  mem['acct::pullResumeV1'] = JSON.stringify({
    date: '2026-07-27', providerScope: { v: 1, mode: 'selected', source: 'day-caller', id: 'synthetic' }
  });
  assert.strictEqual(api.resumeGet(), null, 'an old unmarked P1-shaped intent crossed into production');
  assert(Object.prototype.hasOwnProperty.call(mem, 'acct::pullResumeV1'),
    'production damaged an old P1-shaped intent while refusing it');
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
  assert.strictEqual(api.MAXTRIES, 2, 'automatic resumes must be capped so a failing day cannot loop');
  assert.strictEqual(api.MAXAGE, 2 * 60 * 60 * 1000, 'intents older than 2h are abandoned, not resumed');
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
  Object.assign(ctx, {
    Promise,
    lastPullResult: null,
    pull(opts) { pullCalls.push(JSON.parse(JSON.stringify(opts))); return Promise.resolve({ ok: true, complete: true }); },
    toast() {},
    clearInterval() {},
    document: { getElementById() { return null; } }
  });
  ctx.window.__mlsDsStatus = function () {};
  vm.runInContext(src.slice(driverStart, driverEnd) + '\nthis.resumeStartRuntime=resumeStart;', ctx,
    { filename: 'schedimport:resume-start' });

  api.resumeSave({ date: '2026-07-28', startedAt: Date.now(), attempts: 0, includeHistory: true });
  const captured = JSON.parse(JSON.stringify(api.resumeGet()));
  api.resumeSave({ date: '2026-07-29', startedAt: Date.now(), attempts: 0, includeHistory: true });
  const replacement = JSON.parse(JSON.stringify(api.resumeGet()));
  resumeRuntimePromise = Promise.resolve(ctx.resumeStartRuntime(captured)).then(result => {
    assert(result && result.reason === 'resume-intent-stale',
      'a replaced queued resume did not return its explicit stale-intent refusal');
    assert.strictEqual(pullCalls.length, 0,
      'a stale queued resume started Athena navigation');
    assert.strictEqual(JSON.parse(mem['acct::prodPullResumeV1']).intentId, replacement.intentId,
      'a stale queued resume damaged the newer durable intent');

    api.resumeClear();
    api.resumeSave({ date: '2026-07-30', startedAt: Date.now(), attempts: 0, includeHistory: false, bodies: true });
    const exact = JSON.parse(JSON.stringify(api.resumeGet()));
    return Promise.resolve(ctx.resumeStartRuntime(exact)).then(() => {
      assert.strictEqual(pullCalls.length, 1, 'an exact durable resume did not start once');
      assert.strictEqual(pullCalls[0].date, '2026-07-30');
      assert.strictEqual(pullCalls[0].__resumeIntentId, exact.intentId,
        'the exact durable resume did not carry its ownership id into pull');
      assert.strictEqual(pullCalls[0].includeHistory, false);
      assert.strictEqual(pullCalls[0].pullVisitBodies, true);
    });
  }).then(() => {
    console.log('PASS pull resume runtime: stale queued intent refuses before pull; exact durable intent starts once');
  });
}

// ---------------------------------------------------------------------------
// SOURCE CONTRACT: where the intent is written, cleared, and acted on
// ---------------------------------------------------------------------------
{
  const pullFn = block('function pull(opts) {', 'var monthPullRunning', 'pull');
  assert(/resumeSave\(\{\s*date: __resumeDate/.test(pullFn),
    'the intent must be recorded when the pull starts, not after it succeeds');
  assert(/if \(__resumeDate && value && value\.complete === true\) resumeClear\(\);/.test(pullFn),
    'ONLY a genuinely complete day may clear the intent — an honest partial must stay resumable');
  assert(!/value\.ok === true\) resumeClear/.test(pullFn),
    'ok is not completeness; clearing on ok would forget partial days');

  const driver = block('var resumeTimer = null, resumeCard = null;', 'window.__mlsSI = {', 'resume driver');
  assert(/if \(Number\(rec\.attempts \|\| 0\) >= RESUME_MAX_ATTEMPTS\) return;/.test(driver),
    'the attempt cap must be enforced before offering a resume');
  assert(/if \(pullRunning \|\| resumeBusyElsewhere\(\)\) return;/.test(driver),
    'a pull already running here or in another tab must never be duplicated');
  assert(/resumeClear\(\); return;/.test(driver), 'a stale intent must be dropped, not resumed');
  assert(/next\.attempts = Number\(prev\.attempts \|\| 0\) \+ 1/.test(driver),
    'each automatic resume must increment the attempt counter');
  assert(/resumeIntentSignature\(rec\) !== resumeIntentSignature\(prev\)/.test(driver),
    'a queued resume must re-read and match the exact durable intent before starting');
  assert(/reason: "resume-intent-stale"/.test(driver),
    'a stale resume timer must refuse explicitly instead of navigating Athena');
  assert(/__resumeIntentId: next\.intentId/.test(driver),
    'an accepted resume must carry its exact durable ownership id into pull');
  assert(/if \(!signedIn\) return;/.test(driver),
    'a resume must never run over the sign-in gate');
  assert(/mlsPullResumeNo/.test(driver) && /resumeDismiss\(true\)/.test(driver),
    'the doctor must be able to stop the resume, and that choice must clear the intent');
  assert(/Continue now/.test(driver), 'the doctor must be able to start it immediately');
  assert(/already-verified charts are skipped/.test(driver),
    'the card should say why resuming is cheap (si-2.0.0 carries)');
}

resumeRuntimePromise.then(() => {
  console.log('PASS pull resume: an interrupted pull is recorded and continued after a reload, bounded by a 2h expiry, a 2-attempt cap, cross-tab ownership, and the sign-in gate — and the doctor can always stop it');
}).catch(error => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
