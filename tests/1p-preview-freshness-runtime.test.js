/*
 * RED/GREEN CONTRACT — stale 1p tabs discover a newer /1p/ deployment.
 *
 * This deliberately exercises the real version-check IIFE.  Production's
 * app-version.json describes the normal site, so the 1p lane must use a
 * same-origin, no-store HEAD of /1p/ and compare Last-Modified.  Discovery is
 * passive: it may show the existing #mlsVerBanner, but may not navigate until
 * the user presses Refresh and may not make any request while a pull is live.
 *
 * The isolated implementation lives only in the 1p connector.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, '1p-mls-connect.js'), 'utf8');
const importerSource = fs.readFileSync(path.join(root, '1p-feat_mls_schedimport_exact.js'), 'utf8');

/* The version-check harness below supplies these APIs as doubles. Pin their
   real 1p-only owners too, otherwise a later refactor could leave the test
   green while reopening the retry-gap/month-gap reload race in production. */
assert(source.includes('api.isBusy = function () { return !!(DS.pulling || DS.retrying || DS.__autoRetrying); };'),
  'the real 1p Day strip no longer exposes its pull/retry busy state');
assert(importerSource.includes('isBusy: function () { return !!(pullRunning || monthPullRunning || historyBatchRunning); },'),
  'the real 1p importer no longer exposes day/month/history busy state');

function versionIife() {
  const anchor = source.indexOf('if(window.__mlsVersionCheck) return;');
  assert(anchor >= 0, '1p version-check owner is missing');
  const start = source.lastIndexOf('(function(){', anchor);
  const end = source.indexOf('\n(function(){', anchor);
  assert(start >= 0 && end > anchor, 'could not isolate the 1p version-check IIFE');
  return source.slice(start, end);
}

class FakeElement {
  constructor(tag, document) {
    this.tagName = String(tag || 'div').toUpperCase();
    this.ownerDocument = document;
    this.children = [];
    this.parentNode = null;
    this.style = { cssText: '' };
    this.textContent = '';
    this.disabled = false;
    this.onclick = null;
    this._id = '';
  }
  set id(value) { this._id = String(value || ''); }
  get id() { return this._id; }
  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
  remove() {
    if (!this.parentNode) return;
    const at = this.parentNode.children.indexOf(this);
    if (at >= 0) this.parentNode.children.splice(at, 1);
    this.parentNode = null;
  }
  querySelector(selector) {
    if (selector[0] === '#') return find(this, (node) => node.id === selector.slice(1));
    return find(this, (node) => node.tagName === selector.toUpperCase());
  }
}

function find(rootEl, predicate) {
  for (const child of rootEl.children || []) {
    if (predicate(child)) return child;
    const nested = find(child, predicate);
    if (nested) return nested;
  }
  return null;
}

function harness() {
  let now = Date.parse('2026-08-12T22:00:00Z');
  const requests = [];
  const timeouts = [];
  const intervals = [];
  const windowEvents = Object.create(null);
  const documentEvents = Object.create(null);
  const storage = new Map();
  let reloads = 0;
  let daySwitchBusy = false;
  let importerBusy = false;

  const document = {
    visibilityState: 'visible',
    hidden: false,
    lastModified: new Date(now - 60_000).toUTCString(),
    createElement(tag) { return new FakeElement(tag, document); },
    getElementById(id) {
      return find(document.documentElement, (node) => node.id === id) ||
        (document.documentElement.id === id ? document.documentElement : null);
    },
    addEventListener(type, fn) { (documentEvents[type] || (documentEvents[type] = [])).push(fn); }
  };
  document.documentElement = new FakeElement('html', document);
  document.head = new FakeElement('head', document);
  document.body = new FakeElement('body', document);
  document.body.classList = { contains() { return false; } };
  document.documentElement.appendChild(document.head);
  document.documentElement.appendChild(document.body);

  const location = {
    pathname: '/1p/',
    origin: 'https://mlsscribe.com',
    href: 'https://mlsscribe.com/1p/',
    reload() { reloads += 1; }
  };
  class FakeDate extends Date { static now() { return now; } }
  const window = {
    __MLS_P1_PREVIEW: Object.freeze({ enabled: true, route: '/1p/', build: 'p1-old' }),
    __MLS_AV: 'p1-old',
    __mlsDaySwitch: { isBusy() { return daySwitchBusy; } },
    __mlsSI: { isBusy() { return importerBusy; } },
    backendMode() { return true; },
    addEventListener(type, fn) { (windowEvents[type] || (windowEvents[type] = [])).push(fn); },
    removeEventListener() {},
    uns(key) { return 'acct:' + key; }
  };
  const localStorage = {
    getItem(key) { return storage.has(key) ? storage.get(key) : null; },
    setItem(key, value) { storage.set(key, String(value)); }
  };
  const fetch = (url, options) => {
    requests.push({ url: String(url), options: options || {} });
    return Promise.resolve({
      ok: true,
      headers: { get(name) { return /last-modified/i.test(name) ? new Date(now + 120_000).toUTCString() : null; } },
      json() { return Promise.resolve({ ok: true, build: 'production-must-not-be-read' }); }
    });
  };
  const setTimeout = (fn, delay) => { timeouts.push({ fn, delay: Number(delay) || 0 }); return timeouts.length; };
  const setInterval = (fn, delay) => { intervals.push({ fn, delay: Number(delay) || 0 }); return intervals.length; };
  const context = { window, document, location, localStorage, fetch, setTimeout, setInterval, clearInterval() {}, Date: FakeDate, Promise, encodeURIComponent };
  window.window = window;
  window.document = document;
  window.location = location;
  window.localStorage = localStorage;
  window.fetch = fetch;
  window.setTimeout = setTimeout;
  window.setInterval = setInterval;
  window.Date = FakeDate;
  window.Promise = Promise;

  async function flush() {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  }
  async function runTimeouts() {
    while (timeouts.length) {
      const batch = timeouts.splice(0);
      for (const timer of batch) timer.fn();
      await flush();
    }
  }
  async function runIntervalsOnce() {
    const batch = intervals.slice();
    for (const timer of batch) timer.fn();
    await flush();
  }
  async function emit(target, type) {
    const table = target === 'window' ? windowEvents : documentEvents;
    for (const fn of (table[type] || []).slice()) fn({ type });
    await runTimeouts();
    await flush();
  }

  return {
    context: vm.createContext(context), window, document, location, localStorage,
    requests, timeouts, intervals,
    now(value) { if (value === undefined) return now; now = value; },
    advance(ms) { now += ms; },
    setDaySwitchBusy(value) { daySwitchBusy = !!value; },
    setImporterBusy(value) { importerBusy = !!value; },
    reloads() { return reloads; },
    runTimeouts, runIntervalsOnce, emit
  };
}

(async function main() {
  const h = harness();
  vm.runInContext(versionIife(), h.context, { filename: '1p-version-check.iife.js' });

  assert((h.timeouts.length || h.intervals.length),
    '1p freshness has no boot schedule; an already-open tab can remain stale forever');
  assert((h.window.__mlsVersionCheck === true), 'the existing version-check owner no longer installed');

  await h.runTimeouts();
  assert.strictEqual(h.requests.length, 1, '1p boot must make exactly one freshness request');
  const boot = h.requests[0];
  assert(/^\/1p\/\?nc=\d+$/.test(boot.url), `1p freshness must HEAD /1p/ itself, got ${boot.url}`);
  assert.strictEqual(String(boot.options.method || '').toUpperCase(), 'HEAD', '1p freshness must use a metadata-only HEAD request');
  assert.strictEqual(boot.options.cache, 'no-store', '1p freshness request can be satisfied by a stale browser cache');
  assert(!h.requests.some((r) => /app-version\.json|api\/versions|extension/i.test(r.url)),
    '1p freshness contacted a production/extension version surface');

  const banner = h.document.getElementById('mlsVerBanner');
  assert(banner, 'a newer /1p/ Last-Modified did not use the existing #mlsVerBanner refresh surface');
  assert.strictEqual(h.location.href, 'https://mlsscribe.com/1p/', 'freshness discovery navigated without the user pressing Refresh');
  assert.strictEqual(h.reloads(), 0, 'freshness discovery auto-reloaded the preview');

  const refresh = find(banner, (node) => node.tagName === 'BUTTON' && /^Refresh$/.test(node.textContent));
  assert(refresh && typeof refresh.onclick === 'function', 'existing Refresh action was not preserved on the stale-preview banner');

  /* Discovery is allowed during idle time, but navigation remains a fresh,
     explicit user decision.  In particular, a click made while busy must not
     arm the old "reload as soon as the pull stamp clears" interval. */
  const initialHref = h.location.href;
  const timersBeforeBusyClick = h.timeouts.length;
  const intervalsBeforeBusyClick = h.intervals.length;
  h.window.__mlsPullBusyAt = h.now();
  refresh.onclick();
  assert.strictEqual(h.location.href, initialHref, 'Refresh navigated while the current tab had an active pull stamp');
  assert.strictEqual(h.reloads(), 0, 'Refresh reloaded while the current tab had an active pull stamp');
  assert.strictEqual(h.timeouts.length, timersBeforeBusyClick, 'busy Refresh armed a delayed auto-reload timeout');
  assert.strictEqual(h.intervals.length, intervalsBeforeBusyClick, 'busy Refresh armed a delayed auto-reload interval');
  assert.strictEqual(refresh.disabled, false, 'busy Refresh was disabled instead of requiring a later explicit click');
  delete h.window.__mlsPullBusyAt;
  await h.runIntervalsOnce();
  assert.strictEqual(h.location.href, initialHref, 'clearing the pull stamp triggered an automatic refresh');
  assert.strictEqual(h.reloads(), 0, 'clearing the pull stamp triggered an automatic reload');

  /* A Day pull deliberately releases its coarse timestamp between automatic
     settle retries.  The 1p owner and importer therefore expose read-only busy
     predicates; those in-memory states must veto Refresh too. */
  h.setDaySwitchBusy(true);
  refresh.onclick();
  assert.strictEqual(h.location.href, initialHref, 'Refresh killed the Day pull automatic-retry gap');
  h.setDaySwitchBusy(false);
  h.setImporterBusy(true);
  refresh.onclick();
  assert.strictEqual(h.location.href, initialHref, 'Refresh killed an importer/month/history operation between heartbeat stamps');
  h.setImporterBusy(false);

  h.requests.length = 0;
  await h.emit('window', 'focus');
  await h.emit('document', 'visibilitychange');
  assert.strictEqual(h.requests.length, 0, 'focus/visibility bypassed the freshness rate limit');

  h.advance(61_000);
  h.window.__mlsDaySwitch.isBusy = () => true;
  await h.emit('window', 'focus');
  assert.strictEqual(h.requests.length, 0, '1p freshness ignored the Day strip retry/busy state');
  h.window.__mlsDaySwitch.isBusy = () => false;

  h.advance(61_000);
  h.window.__mlsSI.isBusy = () => true;
  await h.emit('window', 'focus');
  assert.strictEqual(h.requests.length, 0, '1p freshness ignored the importer/month/history busy state');
  h.window.__mlsSI.isBusy = () => false;

  h.advance(61_000);
  h.window.__mlsPullBusyAt = h.now();
  await h.emit('window', 'focus');
  assert.strictEqual(h.requests.length, 0, '1p freshness made a network request during an active pull');

  h.localStorage.setItem('acct:mlsPullBusyXTabV1', String(h.now()));
  h.advance(61_000);
  await h.emit('window', 'focus');
  assert.strictEqual(h.requests.length, 0, '1p freshness ignored another tab\'s active pull stamp');

  h.localStorage.setItem('acct:mlsPullBusyXTabV1', '0');
  h.advance(61_000);
  h.document.visibilityState = 'hidden'; h.document.hidden = true;
  await h.emit('document', 'visibilitychange');
  assert.strictEqual(h.requests.length, 0, 'a hidden visibilitychange triggered a freshness request');

  h.document.visibilityState = 'visible'; h.document.hidden = false;
  await h.emit('document', 'visibilitychange');
  assert.strictEqual(h.requests.length, 1, 'a safe visible-tab return did not recheck /1p/ after the rate limit');
  assert(/^\/1p\/\?nc=\d+$/.test(h.requests[0].url), 'visible-tab recheck escaped the isolated /1p/ route');

  const intervalCount = h.intervals.length;
  h.window.__mlsDaySwitch.isBusy = () => true;
  refresh.onclick();
  assert.strictEqual(h.location.href, 'https://mlsscribe.com/1p/',
    'clicking Refresh during a retry/busy gap navigated the preview');
  assert.strictEqual(h.reloads(), 0, 'clicking Refresh during a pull reloaded the preview');
  assert.strictEqual(h.intervals.length, intervalCount,
    'a busy Refresh click armed a delayed automatic reload');
  h.window.__mlsDaySwitch.isBusy = () => false;
  assert.strictEqual(h.location.href, 'https://mlsscribe.com/1p/',
    'the preview auto-navigated when the pull later became idle');

  refresh.onclick();
  assert(h.location.href !== 'https://mlsscribe.com/1p/' || h.reloads() === 1,
    'the existing banner Refresh button stopped working after freshness discovery');

  console.log('PASS 1p preview freshness: /1p/ HEAD on boot/focus/visible return, no-store + rate-limited, pull-safe, banner-only until Refresh, no production/extension calls');
})().catch((err) => { console.error(err && err.stack || err); process.exitCode = 1; });
