'use strict';
/* Contract + offline runtime harness for the obt-2.2.0 onboarding tour.
 * 1) The bundle carries exactly obt-2.2.0 (obt-1.0.0 module gone).
 * 2) The module installs under a stub DOM and exposes the stable API.
 * 3) Every id-based spotlight target that should come from the base app
 *    actually exists in ScribeFlow.html (the b324+ shell), so the tour
 *    highlights real elements instead of degrading to centered cards;
 *    satellite-provided targets exist in their owning feat files.
 * 4) The Help tab is no longer hijacked (openMlsHelp must stay reachable).
 * 5) obt-2.2.0 additions, each proven against the bytes:
 *    - the tour covers the dock, day strip, widget deck, avatar, orders and
 *      AI Studio, and ENDS on the 'questions' step;
 *    - finishing the last step opens MLS Copilot via window.openCopilotDock
 *      (looked up at call time), and ONLY the finish path does;
 *    - openTour REFUSES, loudly (#mlsObtNotice), while a pull is running or a
 *      recording is live — exercised in the runtime harness, not just grepped;
 *    - a pull starting mid-tour stands the tour down from the existing 1.5s
 *      tick (standDownIfBusy inside the boot interval).
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const bundle = fs.readFileSync(path.join(__dirname, '..', 'mls-connect.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'ScribeFlow.html'), 'utf8');

/* ---- 1. version presence ---- */
assert(bundle.includes("VERSION = 'obt-2.2.0'"), 'obt-2.2.0 module missing');
assert(!bundle.includes("VERSION = 'obt-1.0.0'"), 'stale obt-1.0.0 module still in bundle');
assert(!bundle.includes("VERSION = 'obt-2.1.0'"), 'stale obt-2.1.0 module still in bundle');

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
assert.strictEqual(api.version, 'obt-2.2.0');
assert(typeof api.open === 'function' && typeof api.reset === 'function' && typeof api.revert === 'function', 'stable API missing');
assert(win.__mlsGuidedTour === api, 'legacy __mlsGuidedTour alias missing');

const steps = api.__test.steps();
assert(steps.length >= 29, 'expected a comprehensive tour, got ' + steps.length + ' steps');
const keys = steps.map(s => s.key);
assert.strictEqual(new Set(keys).size, keys.length, 'duplicate step keys');
['welcome', 'chrome', 'extension', 'dock', 'find', 'newbtn', 'visit', 'daystrip', 'pull',
 'record', 'capture', 'review', 'send', 'opnote', 'widgets', 'avatar', 'payreport',
 'patients', 'calendar', 'history', 'orders', 'studio',
 'menu-ask', 'menu-templates', 'menu-staff', 'menu-athena', 'settings', 'finish', 'questions']
  .forEach(k => assert(keys.includes(k), 'missing step: ' + k));
assert(!keys.includes('menu-legal'), 'held Legal workspace remains in the released onboarding tour');
assert.strictEqual(keys[keys.length - 1], 'questions',
  'the tour must END on the "Any questions?" step — the Copilot handoff is the closer');

/* ---- 5a. the finale opens the Copilot, and only the finish path does ---- */
assert(/function\s+finishAndAsk\s*\(\)\s*\{[\s\S]{0,600}?window\.openCopilotDock\s*===\s*'function'[\s\S]{0,120}?window\.openCopilotDock\(\)/.test(src),
  'finishAndAsk must look openCopilotDock up on window AT CALL TIME and call it');
assert(/askCopilotHdrBtn/.test(src), 'finale lost its header-Ask fallback');
assert(/last\s*\?\s*'✦ Ask Copilot'\s*:\s*'Next →'/.test(src),
  'the last-step primary button must read "✦ Ask Copilot"');
assert(/last\s*\?\s*finishAndAsk\(\)\s*:\s*go\(1\)/.test(src),
  'the last-step primary button must run finishAndAsk');
assert(/n > STEPS\.length - 1\)\s*\{\s*finishAndAsk\(\);/.test(src),
  'advancing past the closer (Enter/ArrowRight) must also open the Copilot');
const skipWires = src.match(/on\(skip, 'click', function \(\) \{ ([^}]+) \}\);/);
assert(skipWires && /finish\(true\)/.test(skipWires[1]) && !/finishAndAsk/.test(skipWires[1]),
  'Skip/Close must never open the Copilot');

/* ---- 5b. launch gates, exercised in the harness ---- */
assert(typeof api.__test.launchBlocked === 'function' && typeof api.__test.pullBusy === 'function',
  'gate predicates not exposed for testing');
assert.strictEqual(api.__test.launchBlocked(), null, 'gates must be open in a quiet stub');
win.__mlsPullBusyAt = Date.now();                    // a pull is in flight
assert(/pull/i.test(String(api.__test.launchBlocked() || '')), 'launchBlocked must NAME the running pull');
doc.body.children.length = 0;
api.open();
assert(!doc.body.children.some(n => n.id === 'mlsObtCard'),
  'openTour built the tour card while a pull was running');
assert(doc.body.children.some(n => n.id === 'mlsObtNotice'),
  'openTour refused silently — the refusal must be loud (#mlsObtNotice)');
win.__mlsPullBusyAt = 0;                             // pull over
assert.strictEqual(api.__test.launchBlocked(), null, 'gate did not reopen after the pull ended');
doc.body.children.length = 0;
api.open();
assert(doc.body.children.some(n => n.id === 'mlsObtCard'),
  'openTour must open normally once nothing is in flight');
api.close();

/* ---- 5c. mid-tour stand-down rides the existing tick ---- */
assert(typeof api.__test.standDownIfBusy === 'function', 'standDownIfBusy not exposed');
assert(/setInterval\(function \(\) \{ ensureMenuRow\(\); standDownIfBusy\(\); \}, 1500\)/.test(src),
  'stand-down must ride the existing 1.5s menu tick — no second interval, no missing check');
const intervals = (src.match(/setInterval\s*\(/g) || []).length;
assert.strictEqual(intervals, 1, 'the tour module must keep exactly ONE interval, found ' + intervals);
assert(/function\s+standDownIfBusy[\s\S]{0,300}?closeTour\(\)/.test(src),
  'stand-down must close the tour (closeTour restores the entry view)');
assert(/returnView\)\s*gotoView\(state\.returnView\)/.test(src),
  'closeTour no longer restores the view the doctor was on');

/* browser detection sanity (pure fns) */
const det = api.__test.detectBrowser;
assert.strictEqual(det({ userAgent: 'Mozilla/5.0 Chrome/126.0 Safari/537.36', vendor: 'Google Inc.' }).isChrome, true);
assert.strictEqual(det({ userAgent: 'Mozilla/5.0 Firefox/128.0' }).name, 'Firefox');
assert.strictEqual(det({ userAgent: 'Mozilla/5.0 Chrome/126.0 Edg/126.0 Safari/537.36' }).name, 'Microsoft Edge');
assert.strictEqual(api.__test.doneKeyFor('A@B.com'), 'mls_onboard_tour_done::a@b.com', 'done-key must stay compatible with obt-1 finishers');

/* ---- 3. every base-app id target must exist in ScribeFlow.html ---- */
const BASE_APP_IDS = ['nav_visit', 'nav_patients', 'nav_calendar', 'nav_history', 'nav_orders', 'nav_studio', 'customWidgetsHost', 'askCopilotHdrBtn', 'captureBtn'];
const idTargets = (src.match(/'#([A-Za-z0-9_]+)'/g) || []).map(s => s.slice(2, -1));
for (const id of idTargets) {
  if (BASE_APP_IDS.includes(id)) {
    assert(html.includes('id="' + id + '"'), 'tour targets #' + id + ' but ScribeFlow.html has no such id');
  }
}
/* shell/module-provided ids referenced by scenes must at least be referenced in the bundle */
['mlsTbMenuPanel', 'mlsTbMenuBtn', 'mlsRdNewBtn', 'mlsRdSearchSlot', 'mlsAccountMenuBtn',
 'mlsDsPullBtn', 'mlsDsStrip', 'ez3Prep', 'ez3flDictate', 'mlsPayReportMenuItem']
  .forEach(id => assert(bundle.includes(id), 'shell id ' + id + ' not found anywhere in bundle'));
/* satellite-provided targets must exist in the file that owns them (read-only:
 * this suite never edits those files, it only proves the anchors are real) */
[['mlsDock', 'feat_mls_calm_shell.js'],
 ['mlsWdDeck', 'feat_mls_widget_deck.js'],
 ['mlsAvVisitCard', 'feat_mls_avatar.js']]
  .forEach(([id, file]) => {
    const sat = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    assert(sat.includes(id), 'tour targets #' + id + ' but ' + file + ' no longer defines it');
  });

console.log('PASS onboarding-tour-v2 contract: obt-2.2.0 installed, ' + steps.length + ' steps ending on the Copilot handoff, launch gates exercised (refused loud during a pull, reopened after), stand-down on the 1.5s tick, targets grounded, Help un-hijacked');
