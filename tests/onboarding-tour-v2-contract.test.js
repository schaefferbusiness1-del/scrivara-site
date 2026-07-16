'use strict';
/* Contract + offline runtime harness for the obt-2.0.0 onboarding tour.
 * 1) The bundle carries exactly obt-2.0.0 (obt-1.0.0 module gone).
 * 2) The module installs under a stub DOM and exposes the stable API.
 * 3) Every id-based spotlight target that should come from the base app
 *    actually exists in ScribeFlow.html (the b324+ shell), so the tour
 *    highlights real elements instead of degrading to centered cards.
 * 4) The Help tab is no longer hijacked (openMlsHelp must stay reachable).
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const bundle = fs.readFileSync(path.join(__dirname, '..', 'mls-connect.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'ScribeFlow.html'), 'utf8');

/* ---- 1. version presence ---- */
assert(bundle.includes("VERSION = 'obt-2.0.0'"), 'obt-2.0.0 module missing');
assert(!bundle.includes("VERSION = 'obt-1.0.0'"), 'stale obt-1.0.0 module still in bundle');

/* ---- extract the module IIFE ---- */
const nameIdx = bundle.indexOf('feat_mls_onboarding_tour.module.js');
assert(nameIdx > 0, 'module banner missing');
const start = bundle.lastIndexOf('/* ===', nameIdx);
const endBanner = bundle.indexOf('__mlsWidgetClarity v1.0.0');
const end = bundle.lastIndexOf('/* ===', endBanner);
const src = bundle.slice(start, end);
assert(src.trimEnd().endsWith('})();'), 'module extraction did not end at IIFE close');

/* ---- 4. no Help hijack in the tour module ---- */
assert(!/byId\(\s*['"]nav_help/.test(src) && !/getElementById\(\s*['"]nav_help/.test(src) && !/querySelector\(\s*['"]#nav_help/.test(src),
  'tour must not touch #nav_help (Help = AI help assistant)');
assert(/onclick="openMlsHelp\(\)"/.test(html), 'base Help tab must still call openMlsHelp');

/* ---- 2. runtime harness: stub window/document, execute the module ---- */
function stubNode() {
  return {
    style: { cssText: '' }, className: '', textContent: '', id: '',
    children: [], parentNode: null,
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
    removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); return c; },
    addEventListener() {}, removeEventListener() {},
    querySelector() { return null; }, querySelectorAll() { return []; },
    getBoundingClientRect() { return { width: 10, height: 10, left: 0, top: 0, bottom: 10, right: 10 }; },
    classList: { add() {}, remove() {}, contains() { return false; } },
    click() {}
  };
}
const doc = Object.assign(stubNode(), {
  readyState: 'complete',
  head: stubNode(),
  body: stubNode(),
  documentElement: stubNode(),
  createElement() { return stubNode(); },
  getElementById() { return null; }
});
const win = {
  document: doc,
  navigator: { userAgent: 'Mozilla/5.0 Chrome/126.0 Safari/537.36', vendor: 'Google Inc.' },
  localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
  sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
  getComputedStyle() { return { display: 'block', visibility: 'visible', opacity: '1' }; },
  addEventListener() {}, removeEventListener() {}, postMessage() {},
  innerWidth: 1280, innerHeight: 800,
  setTimeout() { return 0; }, clearTimeout() {}, setInterval() { return 0; }, clearInterval() {}
};
new Function(
  'window', 'document', 'navigator', 'localStorage', 'sessionStorage',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'getComputedStyle',
  src
)(win, doc, win.navigator, win.localStorage, win.sessionStorage,
  win.setTimeout, win.clearTimeout, win.setInterval, win.clearInterval, win.getComputedStyle);

const api = win.__mlsOnboardingTour;
assert(api && api.installed === true, 'tour did not install');
assert.strictEqual(api.version, 'obt-2.0.0');
assert(typeof api.open === 'function' && typeof api.reset === 'function' && typeof api.revert === 'function', 'stable API missing');
assert(win.__mlsGuidedTour === api, 'legacy __mlsGuidedTour alias missing');

const steps = api.__test.steps();
assert(steps.length >= 20, 'expected a comprehensive tour, got ' + steps.length + ' steps');
const keys = steps.map(s => s.key);
assert.strictEqual(new Set(keys).size, keys.length, 'duplicate step keys');
['welcome', 'chrome', 'extension', 'find', 'newbtn', 'visit', 'pull', 'record', 'capture',
 'review', 'send', 'opnote', 'payreport', 'patients', 'calendar', 'history',
 'menu-ask', 'menu-templates', 'menu-staff', 'menu-legal', 'menu-athena', 'settings', 'finish']
  .forEach(k => assert(keys.includes(k), 'missing step: ' + k));

/* browser detection sanity (pure fns) */
const det = api.__test.detectBrowser;
assert.strictEqual(det({ userAgent: 'Mozilla/5.0 Chrome/126.0 Safari/537.36', vendor: 'Google Inc.' }).isChrome, true);
assert.strictEqual(det({ userAgent: 'Mozilla/5.0 Firefox/128.0' }).name, 'Firefox');
assert.strictEqual(det({ userAgent: 'Mozilla/5.0 Chrome/126.0 Edg/126.0 Safari/537.36' }).name, 'Microsoft Edge');
assert.strictEqual(api.__test.doneKeyFor('A@B.com'), 'mls_onboard_tour_done::a@b.com', 'done-key must stay compatible with obt-1 finishers');

/* ---- 3. every base-app id target must exist in ScribeFlow.html ---- */
const BASE_APP_IDS = ['nav_visit', 'nav_patients', 'nav_calendar', 'nav_history', 'nav_orders'];
const idTargets = (src.match(/'#([A-Za-z0-9_]+)'/g) || []).map(s => s.slice(2, -1));
for (const id of idTargets) {
  if (BASE_APP_IDS.includes(id)) {
    assert(html.includes('id="' + id + '"'), 'tour targets #' + id + ' but ScribeFlow.html has no such id');
  }
}
/* shell/module-provided ids referenced by scenes must at least be referenced in the bundle */
['mlsTbMenuPanel', 'mlsTbMenuBtn', 'mlsRdNewBtn', 'mlsRdSearchSlot', 'mlsRdUserChip',
 'ez3PullNow', 'ez3Prep', 'ez3flDictate', 'mlsPrvbBtn']
  .forEach(id => assert(bundle.includes(id), 'shell id ' + id + ' not found anywhere in bundle'));

console.log('PASS onboarding-tour-v2 contract: obt-2.0.0 installed, ' + steps.length + ' steps, targets grounded, Help un-hijacked');
