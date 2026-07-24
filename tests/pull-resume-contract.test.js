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
  assert.strictEqual(api.resumeGet().date, '2026-07-24', 'the intent round-trips');
  assert(Object.keys(mem).some(k => k === 'acct::pullResumeV1'),
    'the intent must live in the ACCOUNT namespace, so another account never inherits it');

  api.resumeClear();
  assert.strictEqual(api.resumeGet(), null, 'a completed pull clears its intent');

  // a corrupt intent must never throw on boot
  mem['acct::pullResumeV1'] = '{not json';
  assert.strictEqual(api.resumeGet(), null, 'a corrupt intent reads as absent, never throws');
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
  assert(/attempts: Number\(prev\.attempts \|\| 0\) \+ 1/.test(driver),
    'each automatic resume must increment the attempt counter');
  assert(/if \(!signedIn\) return;/.test(driver),
    'a resume must never run over the sign-in gate');
  assert(/mlsPullResumeNo/.test(driver) && /resumeDismiss\(true\)/.test(driver),
    'the doctor must be able to stop the resume, and that choice must clear the intent');
  assert(/Continue now/.test(driver), 'the doctor must be able to start it immediately');
  assert(/already-verified charts are skipped/.test(driver),
    'the card should say why resuming is cheap (si-2.0.0 carries)');
}

console.log('PASS pull resume: an interrupted pull is recorded and continued after a reload, bounded by a 2h expiry, a 2-attempt cap, cross-tab ownership, and the sign-in gate — and the doctor can always stop it');
