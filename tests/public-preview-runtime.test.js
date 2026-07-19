'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'public-preview-runtime.js'), 'utf8');

class MemoryStorage {
  constructor() { this.data = new Map(); this.writes = 0; }
  get length() { return this.data.size; }
  key(index) { return [...this.data.keys()][index] || null; }
  getItem(key) { key = String(key); return this.data.has(key) ? this.data.get(key) : null; }
  setItem(key, value) { this.writes++; this.data.set(String(key), String(value)); }
  removeItem(key) { this.writes++; this.data.delete(String(key)); }
  clear() { this.writes++; this.data.clear(); }
}

function inactiveContext(config, backendValue) {
  const window = {
    __MLS_PUBLIC_PREVIEW: config,
    __MLS_SYNTHETIC_ONLY: config && config.enabled === true,
  };
  const document = new Proxy({}, {
    get() { throw new Error('inactive runtime touched document'); },
  });
  const localStorage = new MemoryStorage();
  const sessionStorage = new MemoryStorage();
  const context = vm.createContext({
    window, document, localStorage, sessionStorage,
    backendMode: () => backendValue,
  });
  vm.runInContext(source, context, { filename: 'public-preview-runtime.js' });
  return { window, localStorage, sessionStorage };
}

/* Normal mode must be an exact behavioral no-op: no DOM access, globals, or
   storage mutation. */
{
  const inactive = Object.freeze({
    enabled: false, mode: 'inactive', storageMode: 'native', memoryStorageReady: false,
  });
  const result = inactiveContext(inactive, true);
  assert.strictEqual(result.window.__MLS_PUBLIC_PREVIEW_RUNTIME, undefined);
  assert.strictEqual(result.localStorage.writes, 0);
  assert.strictEqual(result.sessionStorage.writes, 0);
}

/* Even a forged-looking active flag fails closed while hosted mode is on. */
{
  const unsafe = Object.freeze({
    enabled: true, mode: 'synthetic-read-only', storageMode: 'memory', memoryStorageReady: true,
  });
  const result = inactiveContext(unsafe, true);
  assert.strictEqual(result.window.__MLS_PUBLIC_PREVIEW_RUNTIME, undefined);
  assert.strictEqual(result.localStorage.writes, 0);
  assert.strictEqual(result.sessionStorage.writes, 0);
}

function makeElement(tag, document) {
  const attributes = new Map();
  return {
    nodeType: 1, tagName: String(tag || 'div').toUpperCase(), id: '', className: '', type: '',
    textContent: '', value: '', children: [], parentNode: null,
    classList: { add() {}, remove() {}, contains() { return false; } },
    style: {},
    setAttribute(name, value) { attributes.set(String(name), String(value)); },
    getAttribute(name) { return attributes.has(String(name)) ? attributes.get(String(name)) : null; },
    removeAttribute(name) { attributes.delete(String(name)); },
    appendChild(child) {
      child.parentNode = this; this.children.push(child);
      if (child.id) document.nodes.set(child.id, child);
      return child;
    },
    addEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    contains(node) { return node === this || this.children.includes(node); },
    closest() { return null; },
  };
}

function activeHarness() {
  const localStorage = new MemoryStorage();
  const sessionStorage = new MemoryStorage();
  const domListeners = {};
  const windowListeners = {};
  const chooserActions = [];
  const selected = { startSession: [], views: [], days: [], easy: [], events: [] };
  const document = {
    readyState: 'loading', nodes: new Map(),
    addEventListener(type, fn) { domListeners[type] = fn; },
    createElement(tag) { return makeElement(tag, document); },
    getElementById(id) { return this.nodes.get(id) || null; },
    querySelector() { return null; },
    querySelectorAll(selector) { return selector === '#ez3Wrap .ez3-exbtn' ? chooserActions : []; },
  };
  document.documentElement = makeElement('html', document);
  document.head = makeElement('head', document);
  document.body = makeElement('body', document);
  document.nodes.set('mlsEz3', makeElement('section', document));
  document.nodes.set('ez3Wrap', makeElement('section', document));

  const config = Object.freeze({
    enabled: true, mode: 'synthetic-read-only', storageMode: 'memory', memoryStorageReady: true,
    resetStorage() { localStorage.clear(); sessionStorage.clear(); },
    exitUrl: '/ScribeFlow.html',
  });
  const window = {
    __MLS_PUBLIC_PREVIEW: config, __MLS_SYNTHETIC_ONLY: true,
    location: {
      href: 'https://mlsscribe.com/ScribeFlow.html?preview=1', origin: 'https://mlsscribe.com',
      reload() {}, replace() {},
    },
    addEventListener(type, fn) { (windowListeners[type] || (windowListeners[type] = [])).push(fn); },
    dispatchEvent(event) { selected.events.push(event); },
    setTimeout(fn) { fn(); return 1; },
    __mlsDaySwitch: { setDay(day) { selected.days.push(day); return true; } },
    __mlsEasyV32: { open(screen) { selected.easy.push(screen); return true; }, remote: {} },
  };
  const context = vm.createContext({
    window, document, localStorage, sessionStorage,
    backendMode: () => false, _acctTodayKey: () => '2026-07-19',
    session: { email: 'preview@synthetic.invalid' }, bkUser: null, _calAppts: [], _calMe: {}, _calProviders: [],
    getSessionEmail: () => '',
    startSession(email) { selected.startSession.push(email); },
    showView(view) { selected.views.push(view); },
    MutationObserver: class { observe() {} },
    Event: class { constructor(type, options) { this.type = type; this.bubbles = !!(options && options.bubbles); } },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options && options.detail; } },
    URL, Object, JSON, Date, Intl, Promise, Map, Array, String, Number, RegExp, Math,
  });
  vm.runInContext(source, context, { filename: 'public-preview-runtime.js' });
  return { window, document, localStorage, sessionStorage, domListeners, windowListeners, selected, context, chooserActions };
}

function installPatientSafetySurface(h) {
  const view = makeElement('section', h.document); view.id = 'patientsView';
  const sub = makeElement('p', h.document); sub.className = 'sub';
  view.querySelector = selector => selector === '.card > p.sub' ? sub : null;

  const actionSpecs = [
    ['ptDeselectChip', 'Deselect', 'deselectPatient()'],
    ['ptNewBtn', 'New patient', 'newPatient()'],
    ['ptPullAthenaBtn', 'Pull from Athena', 'pullPatientFromAthenaPrompt(this)'],
    ['ptMoreBtn', 'More', 'togglePtMore()'],
    ['rowRecord', 'Record', "ptQuickVisit('preview-patient-001')"],
    ['rowDelete', 'Delete patient', "deletePatient('preview-patient-001')"],
    ['profileStart', 'Start visit', 'goNewVisitForPatient()'],
    ['profileSchedule', 'Schedule', 'calScheduleForPatient()'],
    ['profileDraft', 'Draft op note', 'openOpPrepForPatient()'],
    ['profileShare', 'Share / Export', 'openShareModal()'],
    ['profileExport', 'Export everything for EMR', 'downloadFullEMR()'],
    ['profileEdit', 'Edit', "editProfField('problems')"],
    ['profileUpload', 'Upload photo / file', "document.getElementById('docFileInput').click()"],
  ];
  const actions = actionSpecs.map(([id, label, onclick]) => {
    const button = makeElement('button', h.document); button.id = id; button.textContent = label;
    button.setAttribute('onclick', onclick); h.document.nodes.set(id, button); return button;
  });
  const file = makeElement('input', h.document); file.id = 'docFileInput'; file.type = 'file';
  h.document.nodes.set(file.id, file); actions.push(file);

  const groups = ['all', 'upcoming', 'procedure', 'type'].map(name => {
    const button = makeElement('button', h.document); button.id = 'ptgb_' + name;
    button.textContent = name; h.document.nodes.set(button.id, button); return button;
  });
  const patientRow = makeElement('div', h.document); patientRow.className = 'pt-item';
  const timelineRow = makeElement('div', h.document); timelineRow.className = 'doc-item';
  view.querySelectorAll = selector => selector.indexOf('button,a,[role="button"]') === 0 ? actions.concat(groups) : [];

  const search = makeElement('input', h.document); search.id = 'ptSearch'; search.type = 'text'; search.readOnly = true; search.disabled = true;
  search.setAttribute('data-mls-preview-readonly', '1'); search.setAttribute('aria-readonly', 'true');
  const sort = makeElement('select', h.document); sort.id = 'ptSort'; sort.disabled = true;
  sort.setAttribute('data-mls-preview-blocked', '1');
  h.document.nodes.set(search.id, search); h.document.nodes.set(sort.id, sort);

  const empty = makeElement('div', h.document); empty.id = 'ptEmpty'; h.document.nodes.set(empty.id, empty);
  const none = makeElement('div', h.document); none.id = 'profileNonePanel';
  const noneCopy = makeElement('div', h.document); noneCopy.className = 'empty'; none.querySelector = selector => selector === '.empty' ? noneCopy : null;
  h.document.nodes.set(none.id, none);

  const hiddenPanelIds = ['ptMore', 'previsitLinkRow', 'pendingIntakeBox', 'bookingLinkRow', 'recTabBar',
    'availBox', 'boardBox', 'receptionBox', 'lawyerBox', 'doctorBox', 'followupBox',
    'recMessages', 'recComms', 'recSettings'];
  const panels = hiddenPanelIds.map(id => { const node = makeElement('div', h.document); node.id = id; h.document.nodes.set(id, node); return node; });

  const patientModal = makeElement('div', h.document); patientModal.id = 'patientModal'; h.document.nodes.set(patientModal.id, patientModal);
  const shareModal = makeElement('div', h.document); shareModal.id = 'shareModal'; h.document.nodes.set(shareModal.id, shareModal);
  const docModal = makeElement('div', h.document); docModal.id = 'docModal'; h.document.nodes.set(docModal.id, docModal);
  function docButton(id, label, onclick) {
    const button = makeElement('button', h.document); button.id = id; button.textContent = label; button.setAttribute('onclick', onclick); return button;
  }
  const docClose = docButton('docClose', 'Close', 'closeDocModal()');
  const docAnalyze = docButton('docAnalyzeBtn', 'Analyze with AI', 'analyzeDoc()');
  const docMerge = docButton('docMergeBtn', 'Merge key items into profile', 'mergeDocIntoProfile()');
  const docCopy = docButton('docCopy', 'Copy summary', 'copyDocSummary()');
  const docActions = [docClose, docAnalyze, docMerge, docCopy];
  docModal.querySelectorAll = selector => selector === 'button,a,[role="button"]' ? docActions : [];

  h.document.nodes.set(view.id, view);
  const originalQueryAll = h.document.querySelectorAll.bind(h.document);
  h.document.querySelectorAll = selector => {
    if (selector === 'button,a,[role="button"],input[type="button"],input[type="submit"]') return actions.concat(groups, docActions);
    if (selector === 'input,textarea,select,[contenteditable="true"]') return [search, sort, file];
    return originalQueryAll(selector);
  };
  return { view, sub, actions, groups, search, sort, patientRow, timelineRow, empty, noneCopy, panels,
    patientModal, shareModal, docClose, docAnalyze, docMerge, docCopy };
}

{
  const h = activeHarness();
  const receipt = h.window.__MLS_PUBLIC_PREVIEW_RUNTIME;
  assert(receipt && receipt.installed === true);
  assert.strictEqual(receipt.account, 'preview@synthetic.invalid');
  assert.strictEqual(receipt.storageMode, 'memory');
  assert.deepStrictEqual({ ...receipt.sampleCounts() }, { patients: 8, notes: 3, appointments: 11 });

  assert.strictEqual(h.localStorage.getItem('sf_session'), 'preview@synthetic.invalid');
  assert.strictEqual(h.sessionStorage.getItem('sf_session'), 'preview@synthetic.invalid');
  assert.strictEqual(h.localStorage.getItem('sf_bk_token'), null);
  assert.strictEqual(h.sessionStorage.getItem('sf_bk_token'), null);
  const patients = JSON.parse(h.localStorage.getItem('sf_u::preview@synthetic.invalid::patients'));
  const notes = JSON.parse(h.localStorage.getItem('sf_u::preview@synthetic.invalid::notes'));
  assert.strictEqual(patients.length, 8);
  assert.strictEqual(notes.length, 3);
  assert(patients.every(patient => /^Sample Patient /.test(patient.name) && patient.source === 'mls-public-preview-synthetic'));
  assert(notes.every(note => /SAMPLE NOTE/.test(note.soap) && note.source === 'mls-public-preview-synthetic'));
  assert(!JSON.stringify({ patients, notes }).includes('Pulled from Athena'), 'preview fixtures falsely claim an Athena source');

  assert.strictEqual(typeof h.domListeners.DOMContentLoaded, 'function');
  h.domListeners.DOMContentLoaded();
  assert.deepStrictEqual(h.selected.startSession, ['preview@synthetic.invalid'], 'fallback boot did not enter startSession directly');
  assert(h.document.getElementById('mlsPublicPreviewStrip'), 'persistent sample strip was not mounted');
  assert.strictEqual(h.document.getElementById('mlsPublicPreviewStrip').getAttribute('data-mls-synthetic-boundary'), '1');
  assert((h.windowListeners.click || []).length > 0, 'dangerous-action click guard was not installed');
  assert((h.windowListeners.submit || []).length > 0, 'form submission guard was not installed');

  assert.strictEqual(receipt.canonicalToday(), true);
  assert(h.selected.views.includes('visit'), 'preview did not select the canonical Visit route');
  assert(h.selected.days.includes('2026-07-19'), 'preview did not select account-local Today');
  assert(h.selected.easy.includes('home'), 'preview did not render the canonical Easy home workspace');
  assert(Array.isArray(h.window._calAppts) && h.window._calAppts.length === 11);
  assert(h.window._calAppts.some(row => row.appt_date === '2026-07-20'));
  assert(h.window._calAppts.some(row => row.appt_date === '2026-07-21'));
  const firstAppointment = h.window._calAppts.find(row => row.id === 'preview-appt-01');
  assert(firstAppointment, 'first preview appointment is missing');
  assert.strictEqual(firstAppointment.start_local, '08:10');
  assert.strictEqual(firstAppointment.start_at, '2026-07-19T08:10:00-04:00',
    'preview start_at does not preserve the Eastern practice wall clock');
  assert.strictEqual(new Date(firstAppointment.start_at).toISOString(), '2026-07-19T12:10:00.000Z');
}

/* Patients/Profile is a browsing surface in public preview. Every action is
   hidden and natively disabled, including dynamically rendered row/profile
   buttons and auxiliary modals; search, sort, grouping, and row browsing stay
   available. */
{
  const h = activeHarness();
  const patient = installPatientSafetySurface(h);
  h.domListeners.DOMContentLoaded();

  for (const control of patient.actions) {
    assert.strictEqual(control.getAttribute('data-mls-preview-hidden'), '1', `${control.id}: patient action remained visible`);
    assert.strictEqual(control.getAttribute('data-mls-preview-blocked'), '1', `${control.id}: patient action was not guarded`);
    assert.strictEqual(control.getAttribute('aria-disabled'), 'true', `${control.id}: patient action is not announced disabled`);
    assert.strictEqual(control.disabled, true, `${control.id}: patient action is not natively disabled`);
  }
  for (const control of patient.groups) {
    assert.notStrictEqual(control.getAttribute('data-mls-preview-hidden'), '1', `${control.id}: safe grouping was hidden`);
    assert.notStrictEqual(control.getAttribute('data-mls-preview-blocked'), '1', `${control.id}: safe grouping was blocked`);
    assert.strictEqual(control.disabled, false, `${control.id}: safe grouping was disabled`);
  }
  assert.strictEqual(patient.search.readOnly, false, 'patient search remained read-only');
  assert.strictEqual(patient.search.disabled, false, 'patient search remained disabled');
  assert.strictEqual(patient.search.getAttribute('data-mls-preview-readonly'), null, 'patient search retained edit guard');
  assert.strictEqual(patient.sort.disabled, false, 'patient sort remained disabled');
  assert.strictEqual(patient.sort.getAttribute('data-mls-preview-blocked'), null, 'patient sort retained action guard');
  assert.strictEqual(patient.patientRow.getAttribute('data-mls-preview-hidden'), null, 'sample-patient browsing row was hidden');
  assert.strictEqual(patient.timelineRow.getAttribute('data-mls-preview-hidden'), null, 'sample timeline browsing row was hidden');

  for (const panel of patient.panels) assert.strictEqual(panel.getAttribute('data-mls-preview-hidden'), '1', `${panel.id}: stale action panel remained visible`);
  assert.strictEqual(patient.patientModal.getAttribute('data-mls-preview-hidden'), '1', 'new/edit patient modal remained reachable');
  assert.strictEqual(patient.shareModal.getAttribute('data-mls-preview-hidden'), '1', 'share/export modal remained reachable');
  assert.notStrictEqual(patient.docClose.getAttribute('data-mls-preview-hidden'), '1', 'safe document close was hidden');
  for (const control of [patient.docAnalyze, patient.docMerge, patient.docCopy]) {
    assert.strictEqual(control.getAttribute('data-mls-preview-hidden'), '1', `${control.id}: live document action remained visible`);
    assert.strictEqual(control.disabled, true, `${control.id}: live document action remained enabled`);
  }
  assert.strictEqual(patient.sub.textContent, 'Eight invented patients are loaded. Select one to explore a sample profile.');
  assert(/No patient information can be added/.test(patient.empty.textContent), 'empty-state still invites patient creation');
  assert.strictEqual(patient.noneCopy.textContent, 'Choose an invented patient above to explore their read-only sample chart.');
}

/* Every trusted synthetic appointment family produced by the day and month
   loaders must remain explorable without recording; unknown rows stay hidden. */
{
  const h = activeHarness();
  const trustedIds = ['preview-appt-01', 'preview-day-2026-07-22-01', 'preview-month-2026-08-03-01'];
  for (const id of [...trustedIds, 'untrusted-appointment-01']) {
    const button = makeElement('button', h.document);
    button.setAttribute('data-act', 'rec');
    button.setAttribute('data-k', id);
    button.textContent = 'Start Recording';
    h.chooserActions.push(button);
  }
  h.domListeners.DOMContentLoaded();
  for (let index = 0; index < trustedIds.length; index++) {
    const button = h.chooserActions[index];
    assert.strictEqual(button.getAttribute('data-mls-preview-action'), 'open-sample-appointment',
      `${trustedIds[index]} was not converted to a no-recording sample action`);
    assert.strictEqual(button.getAttribute('data-mls-preview-blocked'), null,
      `${trustedIds[index]} was mislabeled as a blocked recording action`);
    assert.strictEqual(button.getAttribute('aria-disabled'), 'false',
      `${trustedIds[index]} did not remain semantically enabled`);
    assert(/Open sample patient/.test(button.innerHTML), `${trustedIds[index]} kept its recording label`);
  }
  assert.strictEqual(h.chooserActions[3].getAttribute('data-mls-preview-hidden'), '1',
    'an untrusted appointment action remained visible');
}

for (const required of [
  'Load sample month', 'ez3PullStart', 'data-mls-preview-blocked',
  'Reload sample day', 'data-mls-preview-action', 'data-mls-synthetic-boundary',
  'mls-preview-menu-badge', "getAttribute('data-mls-action') === 'staff-prep'",
  "querySelector('#mlsTbMenuPanel #nav_orders')", 'Orders are unavailable in the read-only sample workspace.',
  'orders.parentNode.removeChild(orders)', "document.getElementById('nav_studio')", "document.getElementById('nav_analysis')",
  "document.getElementById('mlsPqsBox')", "document.getElementById('mlsPqsInput')",
  "document.getElementById('mlsQuickFindOv')", "key === '/'", "key === 'k'", 'Global commands are off in the read-only sample workspace.',
  'Only the sample Staff prep workspace is available in this read-only preview.',
  'Reset sample', 'Exit preview', 'Invented patients only · Not connected to Athena · Nothing sends or signs',
  'Sample schedule loaded - ', 'Sample visit - recording off', 'Recording off in preview',
  "['ez3Now', 'ez3Next', 'ez3Nxt']", 'No invented appointments in this sample range.',
  "['ez3Rec', 'ez3Rec2', 'ez3Stop', 'ez3Gen']", 'hidePreviewNode(visitRecord)', 'visitRecord.disabled = true',
  'Sample workspace only - recording, cloud sync, Athena, sending, and signing are off.',
  'Phone recording off', 'Athena off in preview', 'easternOffsetForDay',
  "#mlsEz3Body button", 'send to patient|phone mic', 'Use Choose patient to browse the invented schedule.',
  "document.getElementById('mlsStEzPanel')", 'ai & visit tools|your widgets',
  'selectSampleProvider', '^Dr\\. Sample Clinician$',
  'isSafePreviewNavigation', 'ez3Choose|ez3Hist|ez3Prep|ez3Adv',
  'mlsPullFlowPanel', 'Eight invented patients are loaded.', 'Temporary memory only - resets on reload.',
  'mlsRdNewBtn', 'mlsSyncPop', 'SAMPLE - READ-ONLY', 'No invented visits in this sample record.',
  "document.getElementById('ez3VRow')", "querySelector('#ez3Wrap .ez3-flow')", 'This action is off in the read-only sample workspace.',
  "['ez3Chart2', 'ez3Prep2', 'ez3Portal', 'mlsPortalInviteBtn']", 'No invented appointments are included for this sample date.',
  "document.getElementById('histSearch')", 'Read-only sample history cannot be reopened for editing.',
  'Read-only sample profile: this action is unavailable.', 'ptSearch', 'ptGroupBar',
  'Invented patient with no prior sample visits.', 'No invented visits are included for this sample patient.',
  'No invented documents are included in this sample record.', 'Invented sample history only',
  "'Sample agenda (0/' + selectedDayCount() + ')'",
  'patientModal', 'shareModal', 'Read-only sample document: analysis, merge, copy, and export are unavailable.',
  'Invented patients and notes stay in temporary memory', 'Staff prep · sample month',
  "['ez3cSaved', 'loaded']", "['ez3cDup', 'already loaded']", "['ez3cFail', 'not loaded']",
  'Sample scope', "'mlsMpoNote'",
  'Transcript paste off', 'Assistant off in preview', 'mlsCtxApptChip',
  'open-sample-appointment', 'Open sample patient', 'startVisitFor(appointmentId, { record: false })',
  '^preview-(?:appt|day|month)-',
]) {
  assert(source.includes(required), `runtime is missing required preview contract text: ${required}`);
}
assert(!/observer\.observe\(document\.documentElement,[^\n]*characterData/.test(source),
  'preview observer still reacts to every clock/status character repaint');

console.log('public-preview-runtime.test.js: all assertions passed');
