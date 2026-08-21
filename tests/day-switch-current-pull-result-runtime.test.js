'use strict';

/* The Visit DaySwitch owns the result of the pull started by the current
 * click. A background/resumed engine operation may update the importer's
 * global "last result" for a different date while this click is settling.
 * The visible message and copied report must still describe this click.
 *
 * This executes the real production DaySwitch module with the exact race that
 * produced the b1025 report: current day returns pull-in-flight while the
 * engine-wide last result still points at another day's provider refusal. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');
const start = source.indexOf('/* ===== __mlsDaySwitch');
const end = source.indexOf('/* ===== __mlsStorageJanitor', start);
assert(start >= 0 && end > start, 'production DaySwitch module markers are missing');
const moduleSource = source.slice(start, end);

const DAY = '2026-08-18';
const OTHER_DAY = '2026-08-24';
const clipboardWrites = [];
const toastMessages = [];
const nodes = Object.create(null);
const windowListeners = Object.create(null);

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function makeNode(tag) {
  const attrs = Object.create(null);
  const node = {
    tagName: String(tag || 'div').toUpperCase(),
    style: { removeProperty(name) { delete this[name]; } },
    children: [],
    parentNode: null,
    disabled: false,
    checked: false,
    textContent: '',
    value: '',
    onclick: null,
    onchange: null,
    firstChild: null,
    firstElementChild: null,
    classList: { contains() { return false; }, remove() {}, add() {} },
    appendChild(child) {
      if (!child) return child;
      child.parentNode = this;
      this.children.push(child);
      this.firstChild = this.children[0] || null;
      this.firstElementChild = this.firstChild;
      return child;
    },
    insertBefore(child, before) {
      if (!child) return child;
      child.parentNode = this;
      const index = before ? this.children.indexOf(before) : -1;
      if (index >= 0) this.children.splice(index, 0, child);
      else this.children.push(child);
      this.firstChild = this.children[0] || null;
      this.firstElementChild = this.firstChild;
      return child;
    },
    removeChild(child) {
      const index = this.children.indexOf(child);
      if (index >= 0) this.children.splice(index, 1);
      if (child) child.parentNode = null;
      this.firstChild = this.children[0] || null;
      this.firstElementChild = this.firstChild;
      return child;
    },
    remove() {
      if (this.parentNode) this.parentNode.removeChild(this);
      if (this._id) delete nodes[this._id];
    },
    setAttribute(name, value) { attrs[String(name)] = String(value); },
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(attrs, String(name))
        ? attrs[String(name)] : null;
    },
    removeAttribute(name) { delete attrs[String(name)]; },
    querySelector(selector) {
      return selector && selector.charAt(0) === '#' ? (nodes[selector.slice(1)] || null) : null;
    },
    select() {}
  };
  Object.defineProperty(node, 'id', {
    get() { return this._id || ''; },
    set(value) {
      if (this._id) delete nodes[this._id];
      this._id = String(value || '');
      if (this._id) nodes[this._id] = this;
    }
  });
  Object.defineProperty(node, 'innerHTML', {
    get() { return this._innerHTML || ''; },
    set(value) {
      this._innerHTML = String(value || '');
      const re = /<([a-z][\w-]*)\b[^>]*\bid="([^"]+)"[^>]*>/gi;
      let match;
      while ((match = re.exec(this._innerHTML))) {
        const child = makeNode(match[1]);
        child.id = match[2];
        this.appendChild(child);
      }
      if (!this.firstElementChild && /^\s*<div\b/i.test(this._innerHTML)) {
        this.appendChild(makeNode('div'));
      }
    }
  });
  return node;
}

const head = makeNode('head');
const appBody = makeNode('div');
appBody.id = 'mlsEz3Body';
const document = {
  readyState: 'complete', visibilityState: 'visible',
  head, body: appBody, documentElement: head, activeElement: null,
  getElementById(id) { return nodes[String(id)] || null; },
  createElement(tag) { return makeNode(tag); },
  querySelector() { return null; },
  querySelectorAll() { return []; },
  addEventListener() {}, removeEventListener() {},
  execCommand() { return false; }
};

const priorEngineResult = {
  ok: false, complete: false,
  reason: 'provider-roster-incomplete', target: OTHER_DAY,
  error: '', retry: { providerRoster: true },
  scheduleReceipt: {
    complete: true, expectedCount: 14, parsedCount: 14,
    candidateCount: 14, authoritativeEmpty: false
  },
  providerRosterReceipt: {
    complete: false, partial: true, reason: 'legacy-unverified',
    providerMode: 'all', targetDate: OTHER_DAY
  }
};
const busyClickResult = {
  ok: false, complete: false,
  reason: 'pull-in-flight', target: DAY,
  error: 'Another Athena pull is already running. Nothing else was started.',
  retry: {}
};
let nextClickResult = clone(busyClickResult);
let dayPullCalls = 0;

const context = {
  console, Date, Math, JSON, Object, String, Number, Array, RegExp,
  Promise, Error, Boolean, Intl, encodeURIComponent, decodeURIComponent,
  document,
  navigator: {
    userAgent: 'synthetic-day-switch-result-owner',
    clipboard: {
      writeText(value) {
        clipboardWrites.push(String(value));
        return Promise.resolve();
      }
    }
  },
  location: { pathname: '/ScribeFlow.html' },
  setTimeout, clearTimeout,
  setInterval: () => 1,
  clearInterval: () => {},
  CustomEvent: function CustomEvent(type, init) {
    this.type = type; this.detail = init && init.detail;
  },
  Event: function Event(type, init) {
    this.type = type; this.detail = init && init.detail;
  },
  addEventListener(type, fn) {
    (windowListeners[type] = windowListeners[type] || []).push(fn);
  },
  removeEventListener(type, fn) {
    const list = windowListeners[type] || [];
    const index = list.indexOf(fn);
    if (index >= 0) list.splice(index, 1);
  },
  dispatchEvent(event) {
    (windowListeners[event && event.type] || []).slice().forEach(fn => fn(event));
    return true;
  },
  _acctTodayKey: () => DAY,
  _calAppts: [],
  __MLS_AV: 'synthetic-build',
  __mlsExtReportedVersion: '3.0.synthetic',
  toast(message, kind) { toastMessages.push({ message: String(message || ''), kind: String(kind || '') }); },
  __mlsEasyV32: {
    state() { return { mode: 'doctor', screen: 'home' }; },
    remote: { setVisitDay() { return true; } }
  },
  __mlsVisitNotesPref: {
    read() { return { state: 'on', on: true, settled: true }; },
    write() { return true; },
    isPrefKey() { return false; }
  },
  __mlsPullShieldForeign: () => false,
  __mlsPullShieldTick() {},
  __mlsSI: {
    pull() { return Promise.resolve(clone(nextClickResult)); },
    dayPull() {
      dayPullCalls++;
      /* Deliberately do not replace the engine-global result. This models a
         concurrent/resumed operation retaining or publishing its other-day
         receipt while the current click receives an advisory busy refusal. */
      return Promise.resolve(clone(nextClickResult));
    },
    _lastPullResult() { return clone(priorEngineResult); }
  }
};
context.window = context;

vm.runInNewContext(moduleSource, context, {
  filename: 'production-day-switch-current-result.js', timeout: 2000
});

async function flush() {
  await Promise.resolve();
  await new Promise(resolve => setImmediate(resolve));
  await Promise.resolve();
}

(async () => {
  const api = context.__mlsDaySwitch;
  assert(api && typeof api.pullDay === 'function', 'production DaySwitch pull action is unavailable');
  const pullButton = document.getElementById('mlsDsPullBtn');
  const status = document.getElementById('mlsDsStatus');
  const diagnosticButton = document.getElementById('mlsDsDiagBtn');
  assert(pullButton && status && diagnosticButton, 'the production day strip did not render its pull diagnostics');

  api.pullDay();
  await flush();

  const visibleBusyExplanation = String(status.textContent || '');
  assert.strictEqual(pullButton.disabled, false, 'the busy refusal left the current click stuck in a loading state');
  assert(/another pull|already running|pull is already running/i.test(visibleBusyExplanation),
    'pull-in-flight did not explain that another pull is running: ' + JSON.stringify(status.textContent));
  assert(!/verified completion receipt/i.test(visibleBusyExplanation),
    'pull-in-flight was mislabeled as a missing verified-completion receipt');
  assert.strictEqual(diagnosticButton.style.display, 'inline-block',
    'the current failed click did not expose its copyable report');

  diagnosticButton.onclick();
  await flush();
  assert(clipboardWrites.length > 0, 'the current failed click produced no copyable report');
  const report = JSON.parse(clipboardWrites[clipboardWrites.length - 1]);

  assert.strictEqual(report.day, DAY, 'the report lost the current DaySwitch date');
  assert(report.result, 'the report omitted the current click result');
  assert.strictEqual(report.result.reason, 'pull-in-flight',
    'an engine-global result from another date overwrote the current click result: ' +
    JSON.stringify({ reportDay: report.day, result: report.result }));
  assert.strictEqual(report.result.target, DAY,
    'the copied report combined the current selected day with another operation\'s target');
  assert.strictEqual(report.result.ok, false);
  assert.strictEqual(report.result.complete, false);
  assert(!JSON.stringify(report).includes(OTHER_DAY),
    'the current-click report leaked the unrelated engine operation date');
  assert.strictEqual(report.result.error, visibleBusyExplanation,
    'the report omitted the explicit busy explanation shown for this click');
  assert(/another pull|already running/i.test(String(report.result.error || '')),
    'the current-click result did not retain an explicit busy explanation');
  assert.strictEqual(Object.prototype.hasOwnProperty.call(report, 'lastStatuses'), false,
    'the copied report restored the retired raw-status channel');
  assert(Number.isInteger(report.statusEventsOmitted) && report.statusEventsOmitted > 0,
    'the copied report did not record that the raw busy status was intentionally omitted');
  assert.strictEqual(dayPullCalls, 1,
    'the current busy refusal was automatically pulled a second time');

  /* A provider proof failure is deterministic for this receipt. It must
   * surface once, not run the generic grid-settle retry loop three times. */
  nextClickResult = {
    ok: false, complete: false, reason: 'provider-roster-incomplete', target: DAY,
    error: 'The provider roster did not prove row attribution.',
    retry: { providerRoster: true },
    scheduleReceipt: {
      complete: true, expectedCount: 1, parsedCount: 1,
      candidateCount: 1, authoritativeEmpty: false
    },
    providerRosterReceipt: {
      complete: false, partial: true, reason: 'legacy-unverified',
      providerMode: 'all', targetDate: DAY, observedCount: 1,
      attributionCoverage: {
        verdict: 'row-unattributed', rows: 1, headerCount: 1,
        unattributedRows: 1, foreignRows: 0
      }
    }
  };
  api.pullDay();
  await flush();
  assert.strictEqual(dayPullCalls, 2,
    'the provider refusal did not execute exactly one new explicit attempt');
  assert(!/grid was still settling|attempt 2 of 3/i.test(String(status.textContent || '')),
    'a deterministic provider refusal entered the automatic grid-settle retry loop');

  console.log('PASS production DaySwitch: busy messaging is explicit and the current click owns its copied result/report');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
