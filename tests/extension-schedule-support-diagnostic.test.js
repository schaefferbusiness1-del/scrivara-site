'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'feat_mls_checker.js'), 'utf8');
const begin = source.indexOf('/* MLS_SCHEDULE_SUPPORT_DIAG_BEGIN');
const endMarker = '/* MLS_SCHEDULE_SUPPORT_DIAG_END */';
const end = source.indexOf(endMarker, begin);
assert(begin >= 0 && end > begin, 'query-gated schedule diagnostic block is missing');
const diagnostic = source.slice(begin, end + endMarker.length);

for (const forbidden of [
  /\blocalStorage\b/, /\bsessionStorage\b/, /chrome\.storage/,
  /\bfetch\s*\(/, /\bXMLHttpRequest\b/, /\bsendBeacon\b/,
  /\bconsole\s*\./, /\bclipboard\b/i,
  /\bsetTimeout\s*\(/, /\bsetInterval\s*\(/,
  /\bpostMessage\s*\(/,
  /\binnerHTML\b/, /\bouterHTML\b/, /insertAdjacentHTML/
]) assert(!forbidden.test(diagnostic), `schedule diagnostic contains forbidden operation: ${forbidden}`);

class FakeElement {
  constructor(tag, ownerDocument) {
    this.tagName = String(tag || '').toUpperCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.parentNode = null;
    this.style = { cssText: '' };
    this.attributes = Object.create(null);
    this.listeners = Object.create(null);
    this.textContent = '';
    this.type = '';
    this._id = '';
  }
  set id(value) {
    if (this._id) delete this.ownerDocument.byId[this._id];
    this._id = String(value || '');
    if (this._id) this.ownerDocument.byId[this._id] = this;
  }
  get id() { return this._id; }
  setAttribute(name, value) { this.attributes[String(name)] = String(value); }
  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    child.parentNode = null;
    if (child.id) delete this.ownerDocument.byId[child.id];
    return child;
  }
  addEventListener(type, handler) {
    const key = String(type);
    (this.listeners[key] || (this.listeners[key] = [])).push(handler);
  }
}

class FakeDocument {
  constructor() {
    this.readyState = 'complete';
    this.byId = Object.create(null);
    this.listeners = Object.create(null);
    this.documentElement = new FakeElement('html', this);
    this.body = new FakeElement('body', this);
    this.documentElement.appendChild(this.body);
  }
  createElement(tag) { return new FakeElement(tag, this); }
  getElementById(id) { return this.byId[String(id)] || null; }
  addEventListener(type, handler) {
    const key = String(type);
    (this.listeners[key] || (this.listeners[key] = [])).push(handler);
  }
  removeEventListener(type, handler) {
    const list = this.listeners[String(type)] || [];
    const index = list.indexOf(handler);
    if (index >= 0) list.splice(index, 1);
  }
}

function makeHarness(search) {
  const document = new FakeDocument();
  const listeners = Object.create(null);
  let outgoingMessages = 0;
  const location = { search, origin: 'https://mlsscribe.com' };
  const window = {
    document,
    location,
    addEventListener(type, handler) {
      const key = String(type);
      (listeners[key] || (listeners[key] = [])).push(handler);
    },
    removeEventListener(type, handler) {
      const list = listeners[String(type)] || [];
      const index = list.indexOf(handler);
      if (index >= 0) list.splice(index, 1);
    },
    postMessage() { outgoingMessages++; }
  };
  window.window = window;
  const context = vm.createContext({
    window, document, location, URLSearchParams, JSON, Object, Array, Math, isFinite
  });
  vm.runInContext(diagnostic, context, { filename: 'schedule-support-diagnostic.js' });
  return {
    window,
    document,
    outgoing: () => outgoingMessages,
    listenerCount: type => (listeners[type] || []).length,
    dispatch(data, overrides = {}) {
      const event = Object.assign({
        source: window,
        origin: location.origin,
        data
      }, overrides);
      for (const handler of (listeners.message || []).slice()) handler(event);
    }
  };
}

for (const query of ['', '?mlsScheduleDiag=true', '?mlsScheduleDiag=0']) {
  const gated = makeHarness(query);
  assert.strictEqual(gated.window.__mlsScheduleDiagSupport, undefined, `diagnostic mounted for non-exact query ${query || '(empty)'}`);
  assert.strictEqual(gated.listenerCount('message'), 0, 'diagnostic registered a listener without the exact support flag');
  assert.strictEqual(gated.document.getElementById('mlsScheduleDiagSupport'), null, 'diagnostic UI mounted without the exact support flag');
  assert.strictEqual(gated.outgoing(), 0, 'gated diagnostic sent a message');
}

const h = makeHarness('?release=test&mlsScheduleDiag=1');
const api = h.window.__mlsScheduleDiagSupport;
assert(api && api.installed === true, 'exact support query did not expose the QA API');
assert.strictEqual(typeof api.getSnapshot, 'function');
assert.strictEqual(typeof api.revert, 'function');
assert(h.document.getElementById('mlsScheduleDiagSupport'), 'support panel did not mount');
assert.strictEqual(h.listenerCount('message'), 1, 'support diagnostic did not install exactly one passive listener');
assert.strictEqual(h.outgoing(), 0, 'support diagnostic initiated an extension request');
assert.strictEqual(api.getSnapshot(), null, 'support diagnostic should start empty');

const PHI = 'PHI_SENTINEL_ADA_LOVELACE';
const response = {
  ok: false,
  reason: 'schedule-incomplete',
  scheduleVerified: true,
  frames: 7,
  id: `request-${PHI}`,
  text: `Patient ${PHI}, DOB 12/10/1815, MRN 123456`,
  url: `https://athena.example/patient/${PHI}`,
  title: `${PHI} chart`,
  schedDate: '2026-07-14',
  error: `${PHI} raw worker error`,
  appts: [
    { name: PHI, dob: '12/10/1815', time: '8:00 AM', appointmentId: `a-${PHI}` },
    { name: `Second ${PHI}`, mrn: '123456', provider: `Doctor ${PHI}` }
  ],
  providers: [`Doctor ${PHI}`],
  providerRoster: [{ name: `Doctor ${PHI}`, id: `provider-${PHI}` }],
  receipt: {
    scheduleVerified: true, complete: false, authoritativeEmpty: false,
    expectedCount: 4, candidateCount: 4, parsedCount: 2, declaredCount: 4,
    unnamedCount: 1, domValidRows: 2, textValidRows: 1, mergedRows: 2,
    invalidRowsRemoved: 3, viewportCoverageComplete: false,
    viewportCoverage: {
      complete: false, reason: 'sweep-budget', horizontalScrollable: true,
      horizontalMax: 1200, horizontalSteps: 5, verticalContainers: 2,
      verticalContainersSwept: 1, cellsPlanned: 10, cellsVisited: 6,
      positionsReached: 6, settleRetries: 3,
      axisCap: false, containerCap: false, budgetExpired: true,
      boundsStable: true, restored: true,
      raw: PHI
    }
  },
  providerRosterReceipt: {
    complete: false, partial: true, reason: 'scroll-budget', expectedCount: 5,
    observedCount: 3, horizontalScrollable: true, reachedEnd: false,
    capReached: false, budgetExpired: true, restored: true, boundsStable: true,
    steps: 4, providerName: PHI
  },
  providerDiag: {
    source: 'merged', primaryByCount: 'dom', domValidRows: 2, textValidRows: 1,
    mergedRows: 2, mergedFields: 3, dupRowsRemoved: 4, slotRowsRemoved: 5,
    domSlotRowsRemoved: 2, textSlotRowsRemoved: 3, emptyRowsRemoved: 1,
    invalidRowsRemoved: 3, domInvalidRowsRemoved: 2, textInvalidRowsRemoved: 1,
    soleProviderFilled: 0, providerCount: 3,
    providerNames: [`Doctor ${PHI}`], providerFillScope: `Doctor ${PHI}`,
    dom: {
      strategy: 'structure-id', via: 'structure-id', tables: 2, rowsScanned: 20,
      apptCount: 2, providerCount: 3, appointmentIdCount: 2, providerIdCount: 2,
      legacyContainers: 1, legacyFilledRows: 2, legacyScopeContainers: 1,
      candidateCount: 4, parsedCount: 2, unnamedCount: 1, bareTimes: 1,
      rawCandidateObservations: 38, confidentCandidateCount: 19, duplicateRowsRemoved: 1,
      singleProviderScope: false, scrolled: true, scheduleStructure: true,
      singleProviderName: `Doctor ${PHI}`, providerNames: [`Doctor ${PHI}`],
      credsSeen: [`MD-${PHI}`], err: `${PHI} parser error`,
      nameShadow: {
        checked: 10, differs: 2, canonicalRejected: 1, canonicalAdded: 1,
        samples: [{ oldName: PHI, newName: `New ${PHI}` }]
      },
      providerHeaderShapes: [{
        tag: 'div', parentTag: 'section',
        cls: `PatientAppointment_appointment-container ${PHI}`,
        parentCls: `ScheduleColumn_schedule-column ${PHI}`
      }],
      viewportCoverage: {
        complete: true, reason: 'complete', cellsPlanned: 8, cellsVisited: 8,
        raw: PHI
      },
      providerRosterReceipt: {
        complete: true, partial: false, reason: 'complete', expectedCount: 3,
        observedCount: 3, reachedEnd: true, restored: true, boundsStable: true,
        provider: PHI
      }
    },
    text: {
      strategy: 'text', via: 'grouped-dom', lineCount: 40, headerCount: 3,
      apptCount: 1, providerCount: 2, providerNames: [PHI], err: PHI
    }
  },
  surfaceDiag: {
    navAttempted: true, navClicked: false, homeClicked: true, verifiedFrames: 2,
    scrapeTimeout: false, error: PHI, scrapeError: PHI,
    via: ['schedule-structure'],
    probes: [{
      frameId: `frame-${PHI}`, verified: true, via: 'schedule-structure',
      dateHeader: 'Tuesday, July 14, 2026', timeCount: 8, table: false,
      structure: true, legacyHeading: false, appointmentNodes: 12,
      appointmentClasses: [`PatientAppointment_${PHI}`, `mystery-${PHI}`],
      urlHint: true, scheduleWords: true, empty: false, providerContext: true,
      error: PHI
    }]
  }
};

h.dispatch({ source: 'other', type: 'mlsAppScheduleResult', resp: response });
h.dispatch({ source: 'mls-ext', type: 'other', resp: response });
h.dispatch({ source: 'mls-ext', type: 'mlsAppScheduleResult', resp: response }, { origin: 'https://evil.example' });
h.dispatch({ source: 'mls-ext', type: 'mlsAppScheduleResult', resp: response }, { source: {} });
assert.strictEqual(api.getSnapshot(), null, 'untrusted/nonmatching event was accepted');

h.dispatch({ source: 'mls-ext', type: 'mlsAppScheduleResult', resp: response });
const snapshot = JSON.parse(JSON.stringify(api.getSnapshot()));
assert.strictEqual(snapshot.schema, 1);
assert.strictEqual(snapshot.captureSequence, 1);
assert.strictEqual(snapshot.outcome, 'schedule-incomplete');
assert.strictEqual(snapshot.ok, false);
assert.strictEqual(snapshot.scheduleVerified, true);
assert.deepStrictEqual(snapshot.counts, { frames: 7, rowsReturned: 2, providersReturned: 1 });
assert.strictEqual(snapshot.receipt.expectedCount, 4);
assert.strictEqual(snapshot.receipt.parsedCount, 2);
assert.strictEqual(snapshot.receipt.viewportCoverage.reason, 'sweep-budget');
assert.strictEqual(snapshot.providerRosterReceipt.reason, 'scroll-budget');
assert.strictEqual(snapshot.parser.source, 'merged');
assert.strictEqual(snapshot.parser.domLane.strategy, 'structure-id');
assert.strictEqual(snapshot.parser.domLane.rawCandidateObservations, 38);
assert.strictEqual(snapshot.parser.domLane.confidentCandidateCount, 19);
assert.strictEqual(snapshot.parser.domLane.duplicateRowsRemoved, 1);
assert.strictEqual(snapshot.receipt.viewportCoverage.positionsReached, 6);
assert.strictEqual(snapshot.receipt.viewportCoverage.settleRetries, 3);
assert.strictEqual(snapshot.parser.domLane.nameShadow.checked, 10);
assert.strictEqual(snapshot.parser.domLane.nameShadow.differs, 2);
assert.strictEqual(snapshot.parser.domLane.providerHeaderShapeCategories['react-schedule'], 1);
assert.strictEqual(snapshot.surface.viaCategoryCounts['schedule-structure'], 2);
assert.strictEqual(snapshot.surface.probeCounts.total, 1);
assert.strictEqual(snapshot.surface.probeCounts.timeCount, 8);
assert.strictEqual(snapshot.surface.appointmentShapeCategoryCounts['react-schedule'], 1);
assert.strictEqual(snapshot.surface.appointmentShapeCategoryCounts.other, 1);

const serialized = JSON.stringify(snapshot);
for (const secret of [PHI, '12/10/1815', '123456', '8:00 AM', '2026-07-14', 'Doctor', 'athena.example', 'Tuesday, July 14']) {
  assert(!serialized.includes(secret), `redacted snapshot leaked raw value: ${secret}`);
}
const forbiddenKeys = new Set([
  'appts', 'providers', 'providerNames', 'providerFillScope', 'singleProviderName',
  'credsSeen', 'samples', 'text', 'url', 'title', 'schedDate', 'id', 'error',
  'dateHeader', 'appointmentClasses', 'frameId'
]);
(function assertNoForbiddenKeys(value, trail) {
  if (!value || typeof value !== 'object') return;
  for (const key of Object.keys(value)) {
    assert(!forbiddenKeys.has(key), `redacted snapshot retained forbidden field ${trail}${key}`);
    assertNoForbiddenKeys(value[key], `${trail}${key}.`);
  }
})(snapshot, '');

const firstCopy = api.getSnapshot();
firstCopy.receipt.parsedCount = 999;
assert.strictEqual(api.getSnapshot().receipt.parsedCount, 2, 'getSnapshot exposed mutable internal state');
assert.strictEqual(h.outgoing(), 0, 'passive diagnostic sent an outgoing message after capture');

h.dispatch({
  source: 'mls-ext', type: 'mlsAppScheduleResult',
  resp: { ok: false, reason: PHI, providerDiag: { source: PHI, dom: { strategy: PHI } }, surfaceDiag: { via: [PHI] } }
});
const unknown = api.getSnapshot();
assert.strictEqual(unknown.captureSequence, 2);
assert.strictEqual(unknown.outcome, 'unclassified');
assert.strictEqual(unknown.parser.source, 'other');
assert.strictEqual(unknown.parser.domLane.strategy, 'other');
assert.strictEqual(unknown.surface.viaCategoryCounts.other, 1);
assert(!JSON.stringify(unknown).includes(PHI), 'unknown enum value leaked instead of mapping to a fixed category');

api.revert();
assert.strictEqual(api.installed, false);
assert.strictEqual(api.getSnapshot(), null);
assert.strictEqual(h.listenerCount('message'), 0, 'revert did not remove the passive message listener');
assert.strictEqual(h.document.getElementById('mlsScheduleDiagSupport'), null, 'revert did not remove the support panel');
h.dispatch({ source: 'mls-ext', type: 'mlsAppScheduleResult', resp: response });
assert.strictEqual(api.getSnapshot(), null, 'reverted diagnostic captured another response');
assert.strictEqual(h.outgoing(), 0, 'diagnostic sent an outgoing message during lifecycle cleanup');

console.log('PASS schedule support diagnostic: exact query gate, passive receipt capture, strict PHI redaction, safe lifecycle');
