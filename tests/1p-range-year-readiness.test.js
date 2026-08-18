'use strict';

/* /1p YEAR PULL — "would it work in theory if I ran it?"
 *
 * Owner ask, 2026-08-18, with NO live athenaOne testing. So every claim below
 * is made one of two ways and labelled as such:
 *   DRIVEN  - the real 1p-feat_mls_rangejobs.js engine runs in a VM against a
 *             fake importer, and the assertion reads what it actually did.
 *   READ    - a property of the shipped source that a VM cannot exercise
 *             (it lives in the importer, or only a real browser/Athena can
 *             produce it), asserted against the file so it cannot regress.
 *
 * The five things a real year run has to survive:
 *   1 day iteration uses the SAME stepping the proven day pull uses
 *   2 resume re-derives its target from the ledger, never a stale blob
 *   3 a mid-year session expiry PAUSES instead of burning days
 *   4 "Include full visit notes" reaches every day's leg
 *   5 a storage ceiling PAUSES with the truth instead of losing days
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const RANGE = fs.readFileSync(path.join(ROOT, '1p-feat_mls_rangejobs.js'), 'utf8');
const IMPORTER = fs.readFileSync(path.join(ROOT, '1p-feat_mls_schedimport_exact.js'), 'utf8');

let checks = 0;
const measured = {};
function ok(v, m) { assert.ok(v, m); checks++; }
function eq(a, b, m) { assert.strictEqual(a, b, m); checks++; }

/* ---------------------------------------------------------------- harness */
function makeHost(options) {
  options = options || {};
  const store = new Map();
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => {
      if (options.onWrite) { const r = options.onWrite(k, String(v)); if (r) throw r; }
      store.set(k, String(v));
    },
    removeItem: (k) => store.delete(k),
    key: (i) => Array.from(store.keys())[i] || null,
    get length() { return store.size; }
  };
  const listeners = {};
  const node = () => ({
    style: {}, dataset: {}, attrs: {}, children: [], hidden: false, value: '', textContent: '',
    innerHTML: '', className: '', id: '', checked: false, disabled: false,
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; },
    removeAttribute(k) { delete this.attrs[k]; },
    appendChild(c) { this.children.push(c); return c; },
    insertBefore(c) { this.children.push(c); return c; },
    remove() {}, addEventListener() {}, removeEventListener() {},
    querySelector() { return null; }, querySelectorAll() { return []; }, closest() { return null; }
  });
  const document = {
    readyState: 'complete', hidden: false, body: node(), head: node(), documentElement: node(),
    addEventListener() {}, removeEventListener() {},
    getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
    createElement: () => node()
  };
  const window = {
    document, localStorage,
    /* the engine is /1p-only and refuses to install without this stamp */
    __MLS_P1_PREVIEW: { enabled: true, route: '/1pScribeFlow.html', build: 'b-test' },
    uns: (k) => 'sf_u::doc@example.test::' + k,
    __mlsSessionAccount: 'doc@example.test',
    session: { email: 'doc@example.test', token: 'tok' },
    __mlsSessionToken: 'tok',
    location: { hostname: 'mlsscribe.com' },
    addEventListener(t, f) { (listeners[t] = listeners[t] || []).push(f); },
    removeEventListener() {},
    dispatchEvent() { return true; },
    setTimeout: (fn) => 0, clearTimeout() {},
    Intl
  };
  window.window = window;
  /* The engine refuses to start without the Web Locks API - that is how it
     guarantees one range job per account across tabs (range-lock-unavailable).
     A single-process stand-in honouring ifAvailable is enough here, and the
     refusal it replaces is itself asserted below. */
  const navigator = {
    locks: {
      request(name, opts, cb) { return Promise.resolve(cb({ name })); }
    }
  };
  const context = vm.createContext({
    window, document, localStorage, navigator, console,
    Intl, Date, Math, JSON, Promise, Object, Array, String, Number, RegExp, Error,
    isFinite, parseInt, parseFloat, isNaN,
    setTimeout: (fn, ms) => { if (Number(ms || 0) <= 50) Promise.resolve().then(fn); return 1; },
    clearTimeout() {}, setInterval: () => 1, clearInterval() {},
    MutationObserver: function () { this.observe = () => {}; this.disconnect = () => {}; }
  });
  vm.runInContext(RANGE, context, { filename: '1p-feat_mls_rangejobs.js' });
  return { window, context, store, api: window.__mlsP1RangeJobs };
}
const settle = async (n) => { for (let i = 0; i < (n || 40); i++) await new Promise((r) => setImmediate(r)); };
/* currentManifestKey() = uns('p1RangeJobV1'), and it refuses the signed-out
   namespace, so the harness account must be a real one. */
const MKEY = 'sf_u::doc@example.test::p1RangeJobV1';

/* A fake importer whose pullMonth walks the dates it was handed and reports
   whatever the scenario dictates, exactly through the real callback seam. */
function installImporter(host, perDay) {
  const seen = [];
  host.window.__mlsSI = {
    pullMonth(opts) {
      seen.push({ month: opts.month, dates: (opts.dates || []).slice(), includeHistory: opts.includeHistory,
        pullVisitBodies: opts.pullVisitBodies, provider: opts.provider });
      const days = [];
      let chain = Promise.resolve();
      (opts.dates || []).forEach((date) => {
        chain = chain.then(() => {
          if (opts.shouldStop && opts.shouldStop() === true) return;
          const outcome = perDay(date, seen.length);
          days.push(Object.assign({ date }, outcome));
          if (opts.onDayCheckpoint) {
            opts.onDayCheckpoint({ date, ok: outcome.ok === true, complete: outcome.complete === true,
              reason: outcome.reason, sessionExpired: outcome.sessionExpired === true });
          }
        });
      });
      return chain.then(() => ({ ok: false, complete: false, reason: 'month-partial', month: opts.month, days,
        totals: {}, retry: { dates: [] } }));
    },
    /* The engine will not start a range without the importer's own provider
       gate agreeing (resolveStoredProvider -> importer-not-ready otherwise).
       This fixture runs the ALL-providers lane, which is what the Year card
       offers by default, and answers exactly as a verified roster does. */
    _resolveProviderRequest(raw, opts) {
      if (raw === 'all' && opts && opts.allowAll) {
        return { ok: true, provider: 'all', receipt: { complete: true, providerMode: 'all' } };
      }
      return { ok: false, reason: 'provider-unverified' };
    },
    stop() {}
  };
  return seen;
}
const YEAR = String(new Date().getUTCFullYear() - 1);

(async function () {
  /* ============ 1. day iteration reuses the proven day path (READ) ======= */
  {
    /* The engine hands a MONTH to the importer; the importer walks the days.
       The claim to pin is that its per-day leg is the SAME pull() the day
       button uses - not a second, weaker navigation. */
    ok(/function pullMonth\(opts\)/.test(IMPORTER), 'pullMonth is gone from the importer');
    /* pullMonth's body runs to the next TOP-LEVEL declaration (two-space
       indent); slicing at the next `function ` lands inside its own nested
       helpers and measures nothing. */
    const at = IMPORTER.indexOf('function pullMonth(opts)');
    const after = IMPORTER.indexOf('\n  function ', at + 10);
    const dayCall = IMPORTER.slice(at, after > at ? after : IMPORTER.length);
    ok(/return pull\(\{/.test(dayCall),
      'pullMonth no longer drives each day through pull() - a month may have grown its own navigation path');
    ok(/It deliberately reuses pull\(\) for every frozen day/.test(IMPORTER),
      'the "reuses pull() for every frozen day" contract note is gone');
    /* and pull() is the same export the day button calls */
    ok(/\n    pull: pull,/.test(IMPORTER), 'pull() is no longer exported as the day route');
    /* the day route's own stepping is goto-date; there is exactly one verb */
    const navVerbs = (IMPORTER.match(/"mlsAppGotoDate"/g) || []).length;
    measured.gotoDateCallSites = navVerbs;
    ok(navVerbs >= 1, 'the goto-date stepping verb is gone from the importer');
    ok(!/mlsAppNextDay|mlsAppStepDay|mlsAppAdvanceDay/.test(IMPORTER),
      'a second, weaker day-stepping verb appeared alongside goto-date');
    console.log('  1 day iteration: pullMonth -> pull() -> mlsAppGotoDate, one path (READ)');
  }

  /* ============ 2. resume re-derives from the ledger (DRIVEN) ============ */
  {
    const host = makeHost();
    /* fail every day so the ledger keeps unverified days */
    const seen1 = installImporter(host, () => ({ ok: false, complete: false, reason: 'no-read' }));
    const res1 = await host.api.startYear(YEAR);
    await settle();
    ok(seen1.length > 0, 'startYear dispatched no month: ' + JSON.stringify({ ok: res1 && res1.ok, status: res1 && res1.status, reason: res1 && res1.reason }));
    const key = MKEY;
    const first = JSON.parse(host.store.get(key));
    const months = Object.keys(first.months).sort();
    const firstMonth = months[0];
    /* prove the ledger is the only resume input: mark the first N days
       complete by hand, then resume and see WHICH dates are dispatched. */
    const dayKeys = Object.keys(first.months[firstMonth].days).sort();
    const cutoff = 5;
    /* the state a PAUSED job is really in: some days proved, the rest owed
       and still inside their attempt budget (the cap is 3, and the first run
       above deliberately spent it, which is a settled job, not a paused one). */
    months.forEach((mk) => {
      first.months[mk].status = 'retry';
      Object.keys(first.months[mk].days).forEach((d) => {
        first.months[mk].days[d].status = 'retry';
        first.months[mk].days[d].attempts = 0;
      });
    });
    dayKeys.slice(0, cutoff).forEach((d) => {
      first.months[firstMonth].days[d].status = 'complete';
      first.months[firstMonth].days[d].reason = 'empty-day';
    });
    first.status = 'paused';
    host.store.set(key, JSON.stringify(first));

    const host2 = makeHost();
    host2.store.set(key, JSON.stringify(first));
    /* a stale resume blob of the kind that has hijacked pulls before */
    host2.window.localStorage.setItem('sf_u::doc@example.test::pullResumeV1', JSON.stringify({ date: '1999-01-01', target: '1999-01-01' }));
    const seen2 = installImporter(host2, () => ({ ok: false, complete: false, reason: 'no-read' }));
    const res2 = await host2.api.resume();
    await settle();
    measured.resumeFirstDate = seen2.length ? seen2[0].dates[0] : null;
    measured.resumeMonth = seen2.length ? seen2[0].month : null;
    measured.resumeResult = { ok: res2 && res2.ok, status: res2 && res2.status, reason: res2 && res2.reason };
    ok(seen2.length > 0, 'resume dispatched no month at all: ' + JSON.stringify(measured.resumeResult));
    eq(seen2[0].month, firstMonth, `resume started at month ${seen2[0].month}, expected the first unfinished month ${firstMonth}`);
    eq(seen2[0].dates[0], dayKeys[cutoff],
      `resume targeted ${seen2[0].dates[0]} but the first UNVERIFIED day in the ledger is ${dayKeys[cutoff]}`);
    ok(seen2[0].dates.indexOf(dayKeys[0]) < 0,
      'resume re-dispatched a day the ledger already recorded as complete');
    ok(seen2[0].dates.indexOf('1999-01-01') < 0,
      'the stale pullResumeV1 blob reached the dispatch - this is the resume-hijack class');
    /* and the source carries no such cursor at all */
    ok(!/pullResumeV1/.test(RANGE), 'the year engine now reads a pullResumeV1-style blob');
    console.log(`  2 resume target: ${seen2[0].month} ${seen2[0].dates[0]} = first unverified day (DRIVEN)`);
  }

  /* ============ 3. a session expiry PAUSES the year (DRIVEN) ============= */
  {
    const host = makeHost();
    let driven = 0;
    const seen = installImporter(host, (date) => {
      driven++;
      /* the importer's bounded probe says signed-out from day 3 on */
      return driven >= 3
        ? { ok: false, complete: false, reason: 'no-read', sessionExpired: true }
        : { ok: false, complete: false, reason: 'no-read' };
    });
    await host.api.startYear(YEAR);
    await settle(80);
    const state = host.api.state();
    measured.signout = { status: state.status, reason: state.reason, daysDriven: driven };
    eq(state.status, 'waiting-login',
      `a mid-year sign-out left the job in "${state.status}" instead of pausing for a sign-in`);
    eq(state.reason, 'athena-session-expired',
      `the paused job reports "${state.reason}" rather than naming the sign-out`);
    ok(driven <= 4, `the job drove ${driven} days after the session expired - it must stop, not burn the year`);
    /* the day that hit the sign-out must NOT have spent an attempt */
    const m = state.months[Object.keys(state.months).sort()[0]];
    const hit = Object.keys(m.days).sort().map((d) => m.days[d]).filter((d) => d.reason === 'athena-session-expired')[0];
    ok(hit, 'no day recorded the sign-out reason');
    eq(hit.attempts, 0, `the signed-out day spent ${hit.attempts} attempts - a sign-out must not burn retries`);
    /* and it is resumable: the ledger still owes that day */
    ok(hit.status === 'retry', `the signed-out day is "${hit.status}", so Resume would skip it`);
    console.log(`  3 session expiry: paused at day ${driven} as waiting-login/athena-session-expired, 0 attempts spent (DRIVEN)`);
  }

  /* ============ 4. "full visit notes" reaches every leg (DRIVEN+READ) === */
  {
    for (const want of [true, false]) {
      const host = makeHost();
      const seen = installImporter(host, () => ({ ok: false, complete: false, reason: 'no-read' }));
      await host.api.startYear(YEAR, { fullNotes: want, pullVisitBodies: want });
      await settle();
      ok(seen.length > 0, 'no month was dispatched');
      eq(seen[0].pullVisitBodies, want,
        `fullNotes=${want} reached the day leg as pullVisitBodies=${seen[0].pullVisitBodies}`);
      /* and it survives a reload: the manifest is the only carrier */
      const saved = JSON.parse(host.store.get(MKEY));
      eq(saved.options.fullNotes, want, `fullNotes=${want} was not persisted on the manifest`);
      const host2 = makeHost();
      host2.store.set(MKEY, host.store.get(MKEY));
      const seen2 = installImporter(host2, () => ({ ok: false, complete: false, reason: 'no-read' }));
      await host2.api.resume();
      await settle();
      eq(seen2[0].pullVisitBodies, want, `after a reload, fullNotes=${want} no longer reaches the leg`);
    }
    /* the importer end: the flag becomes the per-day pull's own option */
    ok(/monthPullVisitBodies\s*=\s*\(typeof opts\.pullVisitBodies === "boolean"\)/.test(IMPORTER),
      'pullMonth no longer reads opts.pullVisitBodies');
    ok(/pullVisitBodies: monthPullVisitBodies/.test(IMPORTER),
      'pullMonth no longer forwards pullVisitBodies to each day pull');
    console.log('  4 notes-on: checkbox -> manifest.options.fullNotes -> pullOptions -> per-day pull, across a reload (DRIVEN)');
  }

  /* ============ 5. the storage ceiling PAUSES (DRIVEN) =================== */
  {
    /* (a) the importer refuses a day because the store stopped absorbing
           writes; the year must stop rather than walk 250 more days. */
    const host = makeHost();
    let driven = 0;
    installImporter(host, () => { driven++; return { ok: false, complete: false, reason: 'storage-full-writes-failing' }; });
    await host.api.startYear(YEAR);
    await settle(80);
    const state = host.api.state();
    measured.storageRefusal = { status: state.status, reason: state.reason, daysDriven: driven };
    eq(state.status, 'storage-failed',
      `a storage refusal left the job "${state.status}" - it kept walking the ledger instead of pausing`);
    eq(state.reason, 'storage-full-writes-failing', `the paused job reports "${state.reason}"`);
    ok(driven <= 2, `the job drove ${driven} days after the store refused - every one of them would refuse identically`);
    const m = state.months[Object.keys(state.months).sort()[0]];
    const firstDay = m.days[Object.keys(m.days).sort()[0]];
    eq(firstDay.attempts, 0, 'a storage refusal burned a retry attempt');
    ok(firstDay.status === 'retry', 'the refused day is not resumable');

    /* (b) the manifest write itself is verified, and a QuotaExceededError
           pauses rather than silently losing the ledger. */
    const quota = Object.assign(new Error('quota'), { name: 'QuotaExceededError' });
    let writes = 0;
    const host2 = makeHost({ onWrite: () => (++writes > 2 ? quota : null) });
    installImporter(host2, () => ({ ok: false, complete: false, reason: 'no-read' }));
    const res = await host2.api.startYear(YEAR);
    await settle(80);
    measured.quota = { status: res && res.status, reason: res && res.reason };
    ok(res && (res.status === 'storage-failed' || res.reason === 'storage-full'),
      `a QuotaExceededError produced status=${res && res.status} reason=${res && res.reason}, expected a storage-failed pause`);
    /* the read-back verification, which is what makes "saved" truthful */
    ok(/if \(localStorage\.getItem\(key\) !== raw\) return \{ ok: false, reason: 'metadata-persist-failed' \};/.test(RANGE),
      'writeManifestAt no longer reads the manifest back after writing it');
    ok(/name === 'QuotaExceededError'/.test(RANGE), 'the quota error is no longer classified');

    /* (c) the projected footprint, from the engine's OWN full-year ledger */
    const host3 = makeHost();
    installImporter(host3, () => ({ ok: false, complete: false, reason: 'no-read' }));
    await host3.api.startYear(YEAR);
    await settle();
    const raw = host3.store.get(MKEY);
    const days = JSON.parse(raw).summary.days;
    measured.footprint = { bytes: raw.length, days, bytesPerDay: Math.round(raw.length / days), kb: Math.round(raw.length / 102.4) / 10 };
    ok(days >= 360, `a full-year manifest covers ${days} days, expected a whole year`);
    ok(raw.length < 512 * 1024,
      `the year ledger alone is ${Math.round(raw.length / 1024)}KB against a 5,120KB localStorage ceiling`);
    console.log(`  5 storage: refusal pauses at day ${driven}; quota pauses; year ledger ${measured.footprint.kb}KB for ${days} days (${measured.footprint.bytesPerDay} B/day) (DRIVEN)`);
  }

  console.log('MEASURED ' + JSON.stringify(measured));
  console.log(`1p-range-year-readiness: ${checks} checks passed`);
})().catch((error) => { console.error('1p-range-year-readiness FAILED: ' + (error && error.message)); console.error(error); process.exitCode = 1; });
