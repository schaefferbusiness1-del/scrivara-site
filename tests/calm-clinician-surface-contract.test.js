'use strict';

/* b420 calm-clinician surface regression contract.
 *
 * This suite intentionally exercises only the small state machines whose
 * regressions can move or invent clinical UI. The rest stays source-based:
 * these owners are large browser bundles and a full DOM runtime would add far
 * more harness than signal.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const app = read('ScribeFlow.html');
const stagingApp = read('ScribeFlow-staging.html');
const connect = read('mls-connect.js');
const redesign = read('feat_mls_redesign.js');
const tooltipDedupe = read('feat_athena_tooltip_dedupe.js');
const progressSource = read('feat_mls_progress_stages.js');
const loadingSource = read('feat_mls_loading_calm.js');
const writeflowSource = read('feat_mls_writeflow.js');

function between(source, startMarker, endMarker, label) {
  const start = source.indexOf(startMarker);
  assert(start >= 0, `missing ${label || startMarker} start marker`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert(end > start, `missing ${label || startMarker} end marker`);
  return source.slice(start, end);
}

/* -------------------------------------------------------------------------
 * 1. Authentication owns the whole pre-login surface. The legacy movable +
 *    button must be guarded before its node is created.
 * ---------------------------------------------------------------------- */
const legacyFab = between(
  app,
  '/* ===== Movable floating "+" quick-action button.',
  '/* The retired Staff-pulls rail marker is inert.',
  'legacy quick-action FAB'
);
const authGuardAt = legacyFab.indexOf("document.getElementById('authScreen')");
const fabCreateAt = legacyFab.indexOf("fab.id='mlsFab'");
assert(authGuardAt >= 0 && authGuardAt < fabCreateAt, 'legacy #mlsFab is created before the auth-screen guard');
assert(/authStyle\.display\s*!==\s*['"]none['"][\s\S]{0,180}\breturn\b/.test(legacyFab.slice(authGuardAt, fabCreateAt)),
  'visible auth/login does not stop #mlsFab creation');
assert(redesign.includes('#mlsFab, #mlsFabMenu{ display:none !important; }'),
  'Editorial Calm lost its fallback suppression for the legacy + button and menu');

/* Execute the real dormant creator at the login surface. This catches a guard
 * that merely looks plausible in source but still appends before auth settles. */
{
  const nodes = Object.create(null);
  const auth = {
    id: 'authScreen',
    style: {},
    getBoundingClientRect() { return { width: 520, height: 640, left: 0, top: 0, right: 520, bottom: 640 }; }
  };
  nodes.authScreen = auth;
  const body = {
    appended: [],
    appendChild(node) { this.appended.push(node); if (node.id) nodes[node.id] = node; return node; }
  };
  const document = {
    body,
    getElementById(id) { return nodes[id] || null; },
    createElement(tag) { return { tagName: tag, style: {}, addEventListener() {}, appendChild() {} }; },
    addEventListener() {}
  };
  const window = { document, innerWidth: 1280, innerHeight: 800, addEventListener() {} };
  window.window = window;
  vm.runInNewContext(legacyFab, {
    window, document,
    localStorage: { getItem() { return null; }, setItem() {} },
    getComputedStyle(el) {
      return el === auth
        ? { display: 'flex', visibility: 'visible' }
        : { display: 'block', visibility: 'visible' };
    },
    JSON, Math, parseInt, setTimeout() { return 1; }
  }, { filename: 'ScribeFlow-legacy-fab.js' });
  assert(!nodes.mlsFab && !nodes.mlsFabMenu && body.appended.length === 0,
    'legacy quick-action creator appended floating UI over auth/login');
}

/* -------------------------------------------------------------------------
 * 2. Onboarding remains available by an explicit Menu/API action, but none of
 *    the four historical tour engines may launch from boot, a heartbeat, or
 *    the window load event.
 * ---------------------------------------------------------------------- */
const canonicalTour = between(
  connect,
  'feat_mls_onboarding_tour.module.js',
  '__mlsWidgetClarity v1.0.0',
  'canonical onboarding tour'
);
assert(/open:\s*openTour/.test(canonicalTour), 'canonical onboarding no longer exposes a manual open action');
assert(/mlsObtMenuRow[\s\S]*?['"]click['"][\s\S]*?openTour\(\)/.test(canonicalTour),
  'Guided tour / How-to is no longer manually available from Menu');
const canonicalBoot = between(canonicalTour, 'function boot() {', 'function revert()', 'canonical tour boot');
assert(canonicalBoot.includes('ensureMenuRow()'), 'canonical onboarding no longer maintains its manual Menu entry');

const legacyGuided = between(
  connect,
  '__mlsGuidedTour v1.0.0',
  'MLS Scribe - PULLED-CHART STRUCTURING',
  'legacy guided tour'
);
const legacyTick = between(legacyGuided, 'function tick() {', '\n  tick();', 'legacy guided-tour tick');
assert(legacyTick.includes('ensureMenuRow'), 'legacy guided-tour compatibility lost its manual Menu entry');

const studioTour = between(
  connect,
  '(R2-1) THE tour',
  'MLS Scribe -- b36 dock-left enforcement',
  'legacy Studio tour'
);
const studioTick = between(studioTour, 'function tick() {', '\n  tick();', 'legacy Studio-tour tick');
assert(studioTick.includes('menuItem'), 'legacy Studio-tour compatibility lost its manual entry point');

const manualPolicyAt = connect.indexOf('window.__mlsManualToursOnly = true');
assert(manualPolicyAt >= 0 && manualPolicyAt < connect.indexOf('feat_mls_onboarding_tour.module.js'),
  'manual-only onboarding policy is not installed before the historical tour engines');
const autoDefinitions = [];
const autoDefinitionRe = /function\s+(maybeAutoLaunch|scheduleAuto|autoStart)\s*\([^)]*\)\s*\{/g;
let autoMatch;
while ((autoMatch = autoDefinitionRe.exec(connect))) {
  autoDefinitions.push({ name: autoMatch[1], source: connect.slice(autoMatch.index, autoMatch.index + 420) });
}
assert(autoDefinitions.length >= 6, 'expected every historical onboarding auto-entry to remain auditable');
for (const auto of autoDefinitions) {
  const guardAt = auto.source.indexOf('__mlsManualToursOnly');
  assert(guardAt >= 0 && guardAt < 180 && /\breturn\b/.test(auto.source.slice(guardAt, guardAt + 100)),
    `${auto.name} does not honor the manual-only onboarding policy`);
}

/* -------------------------------------------------------------------------
 * 3. One persistent owner per Visit quick action. Hidden real controls remain
 *    callable proxies, but must not paint beside their inline counterparts.
 * ---------------------------------------------------------------------- */
const quickAt = connect.indexOf("q.className = 'ez3fl-quick'");
const quickEnd = connect.indexOf('rec.appendChild(q);', quickAt);
assert(quickAt >= 0 && quickEnd > quickAt, 'Visit inline QUICK TOOLS owner is missing');
const quickTools = connect.slice(quickAt, quickEnd);
[
  ['ez3flCopilotVoice', 'mlsCopVoiceBtn'],
  ['ez3flAssistant', 'mlsAsstFab'],
  ['ez3flDictate', 'mlsDaDock']
].forEach(([inlineId, legacyId]) => {
  assert(quickTools.includes(inlineId) && quickTools.includes(legacyId),
    `inline #${inlineId} no longer proxies #${legacyId}`);
});

for (const id of ['mlsCopVoiceBtn', 'mlsAsstFab', 'mlsDaDock']) {
  assert(redesign.includes(`#${id}`), `Editorial Calm does not suppress persistent #${id}`);
}
assert(!connect.includes('No patients loaded yet — one tap gets today’s schedule'),
  'an empty schedule still falsely says no patient is loaded even when an active patient exists');
assert(connect.includes('No appointments imported for ') &&
       connect.includes('Use <b>Pull this day</b> above to load the schedule and chart history from Athena.'),
  'the empty-day guidance no longer distinguishes schedule state or points to the canonical pull action');
for (const [label, source] of [['production', app], ['staging', stagingApp]]) {
  const calendarLoader = between(source, 'async function loadCalendar(options){', 'function _calFilterVal', `${label} calendar loader`);
  assert(/typeof _SF_DEMO[^\n]+_SF_DEMO[\s\S]{0,100}\? ''/.test(calendarLoader),
    `${label} demo calendar can still paint a false sign-in prompt beneath an active synthetic session`);
  assert(!source.includes('Encrypted and synced to your MLS account — your visit history follows you'),
    `${label} history still makes an unconditional sync/backup claim`);
  assert(source.includes('Local demo: synthetic visit history stays in this browser on this device. It is not synced or backed up.'),
    `${label} history does not disclose local demo storage truth`);
  assert(source.includes('only after the server confirms a successful save'),
    `${label} hosted history does not condition its storage claim on server confirmation`);
}
assert(/#mlsAsstFab[^\n]*#mlsDaDock[\s\S]{0,180}display:none\s*!important/.test(redesign),
  'persistent Assistant/Dictate duplicates are not hidden by Editorial Calm');
assert(/#mlsCopVoiceBtn:not\(\.mls-bl42-on\)[\s\S]{0,100}display:none\s*!important/.test(redesign),
  'idle persistent Copilot Voice duplicate is not hidden');

/* The old tooltip-continuity asset used a higher-specificity !important rule
 * to force all three fixed controls visible. If that compatibility rule stays,
 * Editorial Calm needs a stronger suppressor so the actual cascade is calm. */
const staleVisibleDockRule = /html body\.mls-top-voice-tools #mlsCopVoiceBtn,[\s\S]{0,260}display:inline-flex!important/.test(tooltipDedupe);
const strongerCalmDockRule = redesign.match(/html body\.mls-redesign\.mls-top-voice-tools[\s\S]{0,360}display:none\s*!important/);
assert(!staleVisibleDockRule || (strongerCalmDockRule &&
  ['#mlsCopVoiceBtn', '#mlsAsstFab', '#mlsDaDock'].every(id => strongerCalmDockRule[0].includes(id))),
  'a higher-specificity legacy rule can still repaint all three fixed Visit controls');

/* -------------------------------------------------------------------------
 * 4. Pay Reports retain their durable homes; the short-lived Visit floater is
 *    retired at the creator, not merely hidden after it flashes.
 * ---------------------------------------------------------------------- */
assert(!/\.id\s*=\s*["']mlsPrvbBtn["']/.test(connect),
  'the floating Visit #mlsPrvbBtn still has a live DOM creator');
assert(/studioView[\s\S]{0,900}calendarView|calendarView[\s\S]{0,900}studioView/.test(connect) &&
       /__mlsComp[\s\S]{0,80}\.open/.test(connect),
  'Pay Reports no longer have the shared AI Studio + Calendar route');
assert(/mlsPayReportMenu(?:Item|Btn|Row)/.test(connect),
  'Pay Reports need one stable Menu entry after retiring the Visit floater');

/* -------------------------------------------------------------------------
 * 5. The misplaced legacy one-click shortcut is retired. The canonical Visit
 *    review control owns the UI; oneClick retains its programmatic safety guard.
 * ---------------------------------------------------------------------- */
assert(!/\.id\s*=\s*['"]wf2OneClick['"]/.test(writeflowSource),
  '#wf2OneClick still has a live DOM creator');
assert(/__mlsLegacyAthenaShortcutRetired/.test(writeflowSource),
  'legacy Athena shortcut retirement marker is missing');
const surfaceSync = between(redesign, 'function syncClinicalSurfaceState(){', 'function installClinicalSurfaceState(){', 'clinical surface state sync');
assert(/window\.activePatient/.test(surfaceSync), 'clinical surface state does not use the canonical activePatient owner');
assert(!/wf2OneClick/.test(surfaceSync), 'redesign still owns state for the retired shortcut');

function runWriteflowSafety() {
  const byId = Object.create(null);
  const note = {
    nodeType: 1,
    value: '',
    textContent: '',
    dispatchEvent() {}
  };
  byId['mls-note'] = note;
  byId.noteBox = note;
  byId.ez3flNote = note;
  const emr = { clicks: 0, click() { this.clicks += 1; } };
  byId.emrBtn = emr;
  let patient = null;
  const sent = [];
  const alerts = [];
  const document = {
    readyState: 'loading',
    body: {},
    addEventListener() {},
    getElementById(id) { return byId[id] || null; },
    querySelectorAll() { return []; },
    createElement() { return {}; },
    createTextNode(text) { return { textContent: String(text) }; }
  };
  const window = {
    document,
    location: { origin: 'https://mlsscribe.com' },
    activePatient() { return patient; },
    addEventListener() {},
    removeEventListener() {},
    postMessage(message) { sent.push(message); },
    toast() {}
  };
  window.window = window;
  function MutationObserver() { this.observe = () => {}; this.disconnect = () => {}; }
  const context = {
    window, document, MutationObserver,
    alert(message) { alerts.push(String(message)); },
    console,
    setTimeout() { return 1; }, clearTimeout() {},
    Date, Math, Promise, Object, Array, String, Number, RegExp, JSON, Uint32Array,
    Event: function Event(type, init) { this.type = type; this.bubbles = !!(init && init.bubbles); }
  };
  vm.createContext(context);
  vm.runInContext(writeflowSource, context, { filename: 'feat_mls_writeflow.js' });
  const wf = window.__mlsWriteFlow;
  assert(wf && typeof wf.oneClick === 'function', 'writeflow oneClick API missing');

  wf.oneClick();
  assert.strictEqual(sent.length, 0, 'no-patient oneClick crossed the Athena bridge');
  assert.strictEqual(wf.state.oneClicks, 0, 'no-patient oneClick counted as a real attempt');

  patient = {
    id: 'pt-b420', name: 'Example Patient', dob: '01/02/1980',
    summary: 'Old history summary that must never become a new note.',
    problems: 'Historical problem list',
    visits: [{ aiSummary: 'Historical encounter text' }]
  };
  note.value = '';
  note.textContent = '';
  wf.oneClick();
  assert.strictEqual(sent.length, 0, 'empty-note oneClick opened/searched Athena');
  assert.strictEqual(note.value, '', 'empty-note oneClick synthesized a note from patient history');
  assert.strictEqual(wf.state.oneClicks, 0, 'empty-note oneClick counted as a real attempt');

  note.value = 'Current encounter note authored and reviewed by the clinician.';
  wf.oneClick();
  assert.strictEqual(sent.length, 1, 'ready oneClick did not open the exact patient in Athena');
  assert.strictEqual(sent[0].type, 'mlsAppSearchOpenPatient');
  assert.strictEqual(emr.clicks, 1, 'ready oneClick did not open the review surface');
  assert.strictEqual(wf.state.oneClicks, 1, 'ready oneClick attempt was not counted exactly once');
}
runWriteflowSafety();

/* -------------------------------------------------------------------------
 * 6. Progress is quiet at rest, visible while active or after a failure, and
 *    a demo/local page does not turn a passive extension ping into work.
 * ---------------------------------------------------------------------- */
assert(/#mlsPsChip\.idle\{\s*display:none\s*!important/.test(redesign),
  'Editorial Calm does not visually remove the idle Progress chip');
function makeProgressHarness(options) {
  options = options || {};
  const nodes = Object.create(null);
  let timerId = 0;
  let uuid = 0;
  const listeners = Object.create(null);

  class Element {
    constructor(tag) {
      this.tagName = String(tag || 'div').toUpperCase();
      this.children = [];
      this.parentNode = null;
      this.style = {};
      this.attributes = {};
      this.listeners = {};
      this.textContent = '';
      this._id = '';
      this._classes = new Set();
      this.classList = {
        add: (...names) => names.forEach(name => this._classes.add(name)),
        remove: (...names) => names.forEach(name => this._classes.delete(name)),
        contains: name => this._classes.has(name),
        toggle: (name, force) => {
          const on = typeof force === 'boolean' ? force : !this._classes.has(name);
          if (on) this._classes.add(name); else this._classes.delete(name);
          return on;
        }
      };
    }
    set id(value) { this._id = String(value || ''); if (this._id) nodes[this._id] = this; }
    get id() { return this._id; }
    set className(value) { this._classes = new Set(String(value || '').split(/\s+/).filter(Boolean)); }
    get className() { return Array.from(this._classes).join(' '); }
    set innerHTML(value) {
      this._html = String(value || '');
      this.children = [];
      for (const match of this._html.matchAll(/class=["']([^"']+)["']/g)) {
        const child = new Element('span');
        child.className = match[1];
        this.appendChild(child);
      }
    }
    get innerHTML() { return this._html || ''; }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    getAttribute(name) { return this.attributes[name] || ''; }
    addEventListener(type, fn) { (this.listeners[type] || (this.listeners[type] = [])).push(fn); }
    appendChild(child) { this.children.push(child); child.parentNode = this; return child; }
    querySelector(selector) {
      const match = node => selector.charAt(0) === '#'
        ? node.id === selector.slice(1)
        : (selector.charAt(0) === '.' && node.classList && node.classList.contains(selector.slice(1)));
      const stack = this.children.slice();
      while (stack.length) {
        const node = stack.shift();
        if (match(node)) return node;
        if (node.children) stack.push(...node.children);
      }
      return null;
    }
    remove() {
      if (this.id && nodes[this.id] === this) delete nodes[this.id];
      if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this);
    }
  }

  const document = {
    readyState: 'complete',
    documentElement: new Element('html'),
    head: new Element('head'),
    body: new Element('body'),
    getElementById(id) { return nodes[id] || null; },
    createElement(tag) { return new Element(tag); },
    createTextNode(text) { return { textContent: String(text), children: [] }; },
    createEvent() { return { initCustomEvent(type, bubbles, cancelable, detail) { this.type = type; this.detail = detail; } }; }
  };
  const stored = Object.create(null);
  const context = {
    console,
    document,
    location: { protocol: options.local ? 'file:' : 'https:', search: options.local ? '?demo=1' : '' },
    navigator: { userAgent: 'Chrome' },
    backendMode() { return !options.local; },
    _SF_DEMO: !!options.local,
    sessionStorage: {
      getItem(key) { return Object.prototype.hasOwnProperty.call(stored, key) ? stored[key] : null; },
      setItem(key, value) { stored[key] = String(value); },
      removeItem(key) { delete stored[key]; }
    },
    crypto: { randomUUID() { return `00000000-0000-4000-8000-${String(++uuid).padStart(12, '0')}`; } },
    CustomEvent: function CustomEvent(type, init) { this.type = type; this.detail = init && init.detail; },
    Event: function Event(type) { this.type = type; },
    setTimeout() { return ++timerId; },
    clearTimeout() {},
    setInterval() { return ++timerId; },
    clearInterval() {},
    getComputedStyle() { return { display: 'block', visibility: 'visible' }; },
    addEventListener(type, fn) { (listeners[type] || (listeners[type] = [])).push(fn); },
    removeEventListener(type, fn) { listeners[type] = (listeners[type] || []).filter(item => item !== fn); },
    dispatchEvent(event) { (listeners[event.type] || []).slice().forEach(fn => fn(event)); },
    postMessage() {},
    Date, Math, Promise, Object, Array, String, Number, RegExp, JSON
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(loadingSource, context, { filename: 'feat_mls_loading_calm.js' });
  vm.runInContext(progressSource, context, { filename: 'feat_mls_progress_stages.js' });
  return {
    context,
    post(data) { context.__mlsProgressStages._observe({ data }); },
    chip() { return document.getElementById('mlsPsChip'); },
    jobs() { return context.__mlsLoadingCalm.snapshot(); }
  };
}

const hosted = makeProgressHarness({ local: false });
assert(hosted.chip() && !hosted.chip().classList.contains('on'), 'empty progress store paints an idle chip');
hosted.post({ source: 'mls-app', type: 'mlsPing' });
assert(hosted.chip().classList.contains('on') && !hosted.chip().classList.contains('idle'),
  'active Athena connection progress is unavailable');
hosted.post({ source: 'mls-ext', type: 'mlsPong', version: '2.9.42' });
assert(!hosted.chip().classList.contains('on') || hosted.chip().classList.contains('idle'),
  'completed connection progress is neither removed nor classified for the idle-hide rule');

hosted.post({ source: 'mls-app', type: 'mlsAppPullSchedule', requestId: 'req-b420-schedule' });
hosted.post({
  source: 'mls-ext', type: 'mlsAppScheduleResult', requestId: 'req-b420-schedule',
  resp: { ok: false, reason: 'no-athena-tab' }
});
const failedSchedule = hosted.jobs().find(job => job.key === 'schedule:pull' && job.status === 'failed');
assert(failedSchedule, 'failed schedule operation did not remain available in progress history');
assert(hosted.chip().classList.contains('on') && !hosted.chip().classList.contains('idle'),
  'failed progress is hidden with idle/completed progress');

const local = makeProgressHarness({ local: true });
local.post({ source: 'mls-app', type: 'mlsPing' });
assert(!local.jobs().some(job => job.key === 'athena:connect' || job.key === 'athena:reconnect'),
  'demo/local mode turned a passive extension ping into connection progress');
assert(!local.chip().classList.contains('on'), 'demo/local passive ping painted a Progress chip');

console.log('PASS b420 calm clinician surface: quiet auth/onboarding/idle state, one Visit owner per action, safe note gate, actionable failures preserved');
