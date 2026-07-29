'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.resolve(__dirname, '..', '..');
const planned = [];

function read(relativePath, encoding) {
  return fs.readFileSync(path.join(root, relativePath), encoding);
}

function eolOf(source) {
  return source.includes('\r\n') ? '\r\n' : '\n';
}

function countOccurrences(source, needle) {
  if (!needle) throw new Error('empty replacement needle');
  let count = 0;
  let offset = 0;
  while (true) {
    const index = source.indexOf(needle, offset);
    if (index < 0) return count;
    count++;
    offset = index + needle.length;
  }
}

function replaceOnce(source, needle, replacement, label) {
  const count = countOccurrences(source, needle);
  if (count !== 1) {
    throw new Error(label + ': expected exactly one source occurrence, found ' + count);
  }
  return source.replace(needle, replacement);
}

function requireAbsent(source, marker, label) {
  if (source.includes(marker)) throw new Error(label + ': proposal appears to be already applied');
}

function plan(relativePath, encoding, transform) {
  const before = read(relativePath, encoding);
  const after = transform(before);
  if (after === before) throw new Error(relativePath + ': transform made no change');
  planned.push({ relativePath, encoding, before, after });
}

function digest(value, encoding) {
  return crypto.createHash('sha256').update(Buffer.from(value, encoding)).digest('hex');
}

plan('feat_mls_active_patient_sync.js', 'utf8', source => {
  const nl = eolOf(source);
  requireAbsent(source, 'var EVENT_NAME =', 'active-patient satellite');

  source = replaceOnce(
    source,
    [
      '   Fix: poll activePatient() (the single source of truth that the context',
      '   bar already follows) and, whenever it changes, push the new de-identified',
      '   patient label into #heroPtName and #patientLabel — so every switch path',
      '   converges on one consistent active patient.'
    ].join(nl),
    [
      '   Fix: follow the canonical active-patient event immediately, follow the',
      '   exact namespaced storage key across tabs, and retain a slow compatibility',
      '   backstop for name-only refreshes. Push the de-identified patient label into',
      '   #heroPtName and #patientLabel so every switch path converges consistently.'
    ].join(nl),
    'active-patient satellite description'
  );

  source = replaceOnce(
    source,
    [
      "  var FIELDS = ['heroPtName', 'patientLabel'];",
      '  var lastName = null;',
      '  var timer = null;',
      '  var stopped = false;'
    ].join(nl),
    [
      "  var FIELDS = ['heroPtName', 'patientLabel'];",
      "  var EVENT_NAME = 'mls:active-patient-changed';",
      "  var SESSION_EVENT = 'mls:session-boundary';",
      '  var lastName = null;',
      '  var timer = null;',
      '  var pendingTimer = null;',
      '  var stopped = false;',
      '  var onPatientChanged = null;',
      '  var onSessionBoundary = null;',
      '  var onStorage = null;',
      '  var onFocusOut = null;',
      '  var pendingFields = Object.create(null);'
    ].join(nl),
    'active-patient satellite state'
  );

  source = replaceOnce(
    source,
    [
      '  function setField(id, name) {',
      '    var el = document.getElementById(id);'
    ].join(nl),
    [
      '  function activeKey() {',
      '    try {',
      "      return (typeof window.uns === 'function') ? window.uns('activePt') : null;",
      '    } catch (e) { return null; }',
      '  }',
      '',
      '  function setField(id, name) {',
      '    var el = document.getElementById(id);'
    ].join(nl),
    'active-patient exact storage key helper'
  );

  source = replaceOnce(
    source,
    [
      '  function setField(id, name) {',
      '    var el = document.getElementById(id);',
      '    if (!el) return;',
      '    if (document.activeElement === el) return; // never clobber active typing',
      '    if (el.value === name) return;             // already correct -> no-op',
      '    el.value = name;',
      "    try { el.dispatchEvent(new Event('input',  { bubbles: true })); } catch (e) {}",
      "    try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {}",
      '  }',
      '',
      '  function sync() {',
      '    var name = activeName();',
      '    if (!name) return;',
      '    if (name === lastName) return; // only act on an actual patient switch',
      '    lastName = name;',
      '    for (var i = 0; i < FIELDS.length; i++) setField(FIELDS[i], name);',
      '  }'
    ].join(nl),
    [
      '  function setField(id, name) {',
      '    var el = document.getElementById(id);',
      '    if (!el) { delete pendingFields[id]; return true; }',
      '    if (document.activeElement === el) { pendingFields[id] = true; return false; }',
      '    delete pendingFields[id];',
      '    if (el.value === name) return true;',
      '    el.value = name;',
      "    try { el.dispatchEvent(new Event('input',  { bubbles: true })); } catch (e) {}",
      "    try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {}",
      '    return true;',
      '  }',
      '',
      '  function sync() {',
      '    var name = activeName();',
      '    if (!name) { lastName = null; return; }',
      '    if (name === lastName) return;',
      '    var complete = true;',
      '    for (var i = 0; i < FIELDS.length; i++) {',
      '      if (!setField(FIELDS[i], name)) complete = false;',
      '    }',
      '    lastName = complete ? name : null;',
      '  }',
      '',
      '  function queueSync() {',
      '    if (stopped || pendingTimer) return;',
      '    pendingTimer = setTimeout(function () {',
      '      pendingTimer = null;',
      '      if (stopped) return;',
      '      lastName = null;',
      '      tick();',
      '    }, 0);',
      '  }'
    ].join(nl),
    'active-patient post-lifecycle reconciliation'
  );

  source = replaceOnce(
    source,
    [
      '  // Seed without writing: on load the app already initialises these fields to',
      '  // the active patient, so we only intervene on subsequent switches.',
      '  lastName = activeName();',
      '  timer = setInterval(tick, 400);',
      '',
      '  window.__mlsActivePtSync = {',
      '    revert: function () {',
      '      stopped = true;',
      '      if (timer) { clearInterval(timer); timer = null; }',
      '      try { delete window.__mlsActivePtSync; } catch (e) { window.__mlsActivePtSync = undefined; }',
      '    },',
      '    syncNow: function () { lastName = null; tick(); },',
      '    _activeName: activeName',
      '  };'
    ].join(nl),
    [
      '  // 2026-07-29: seed without writing, then reconcile after the switching',
      '  // call stack so downstream newVisit resets cannot erase the event result.',
      '  // The slow backstop retains name-only refresh and noncanonical support.',
      '  lastName = activeName();',
      '  onPatientChanged = queueSync;',
      '  onSessionBoundary = queueSync;',
      '  onStorage = function (ev) {',
      '    var key = activeKey();',
      '    if (!key || !ev || ev.key !== key) return;',
      '    queueSync();',
      '  };',
      '  onFocusOut = function (ev) {',
      '    var id = ev && ev.target && ev.target.id;',
      '    if (!id || !pendingFields[id]) return;',
      '    queueSync();',
      '  };',
      '  try { window.addEventListener(EVENT_NAME, onPatientChanged); } catch (e) {}',
      '  try { window.addEventListener(SESSION_EVENT, onSessionBoundary); } catch (e) {}',
      "  try { window.addEventListener('storage', onStorage); } catch (e) {}",
      "  try { document.addEventListener('focusout', onFocusOut, true); } catch (e) {}",
      '  timer = setInterval(tick, 15000);',
      '',
      '  window.__mlsActivePtSync = {',
      '    revert: function () {',
      '      stopped = true;',
      '      if (timer) { clearInterval(timer); timer = null; }',
      '      if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }',
      '      try { window.removeEventListener(EVENT_NAME, onPatientChanged); } catch (e) {}',
      '      try { window.removeEventListener(SESSION_EVENT, onSessionBoundary); } catch (e) {}',
      "      try { window.removeEventListener('storage', onStorage); } catch (e) {}",
      "      try { document.removeEventListener('focusout', onFocusOut, true); } catch (e) {}",
      '      onPatientChanged = null;',
      '      onSessionBoundary = null;',
      '      onStorage = null;',
      '      onFocusOut = null;',
      '      pendingFields = Object.create(null);',
      '      try { delete window.__mlsActivePtSync; } catch (e) { window.__mlsActivePtSync = undefined; }',
      '    },',
      '    syncNow: function () { lastName = null; tick(); },',
      '    _activeName: activeName',
      '  };'
    ].join(nl),
    'active-patient event wiring and backstop'
  );
  return source;
});

plan('ScribeFlow-staging.html', 'utf8', source => {
  const nl = eolOf(source);
  requireAbsent(source, 'staging emits the same changed-only active-patient event', 'staging setter');
  return replaceOnce(
    source,
    "function setActivePtId(id){ if(id) localStorage.setItem(uns('activePt'),id); else localStorage.removeItem(uns('activePt')); }",
    [
      '// 2026-07-29: staging emits the same changed-only active-patient event as production.',
      'function setActivePtId(id){',
      "  var previous=''; try{previous=getActivePtId();}catch(e){}",
      "  var next=String(id||'');",
      "  var changed=String(previous||'')!==next;",
      "  if(id) localStorage.setItem(uns('activePt'),id); else localStorage.removeItem(uns('activePt'));",
      '  if(changed){',
      "    try{ window.dispatchEvent(new CustomEvent('mls:active-patient-changed',{detail:{previousId:String(previous||''),patientId:next}})); }",
      "    catch(e2){ try{ var ev=new Event('mls:active-patient-changed'); ev.detail={previousId:String(previous||''),patientId:next}; window.dispatchEvent(ev); }catch(e3){} }",
      '  }',
      '}'
    ].join(nl),
    'staging active-patient setter'
  );
});

plan('mls-connect.js', 'latin1', source => {
  requireAbsent(source, '20260729aps2', 'production active-patient loader');
  return replaceOnce(
    source,
    '20260625aps1c1',
    '20260729aps2',
    'production active-patient immutable loader token'
  );
});

plan('mls-connect.staging.js', 'latin1', source => {
  requireAbsent(source, '20260729aps2', 'staging active-patient loader');
  return replaceOnce(
    source,
    '20260625aps1',
    '20260729aps2',
    'staging active-patient immutable loader token'
  );
});

plan('tests/immutable-satellite-loader-cache-contract.test.js', 'utf8', source => {
  const nl = eolOf(source);
  requireAbsent(source, "['feat_mls_active_patient_sync.js', '20260729aps2'", 'immutable loader contract');
  source = replaceOnce(
    source,
    "  ['feat_mls_asst_fix.js', '20260723asst144', '20260719asst143'],",
    [
      "  ['feat_mls_asst_fix.js', '20260723asst144', '20260719asst143'],",
      "  ['feat_mls_active_patient_sync.js', '20260729aps2', '20260625aps1c1'],"
    ].join(nl),
    'immutable production active-patient loader pin'
  );
  return replaceOnce(
    source,
    [
      "assert(staging.includes('feat_mls_checker.js?v=20260728chk3031'),",
      "  'staging checker loader must use the same corrected immutable URL');"
    ].join(nl),
    [
      "assert(staging.includes(\"A='feat_mls_active_patient_sync.js'\") &&",
      "  staging.includes(\"s.src=A+'?v=20260729aps2'\"),",
      "  'staging active-patient loader must use the reviewed immutable URL');",
      "assert.strictEqual(staging.split('20260729aps2').length - 1, 1,",
      "  'staging active-patient loader must expose the reviewed token exactly once');",
      "assert(!staging.includes('20260625aps1'),",
      "  'staging active-patient loader still exposes its retired immutable URL');",
      "assert(staging.includes('feat_mls_checker.js?v=20260728chk3031'),",
      "  'staging checker loader must use the same corrected immutable URL');"
    ].join(nl),
    'immutable staging active-patient loader pins'
  );
});

plan('tests/interaction-performance-contract.test.js', 'utf8', source => {
  const nl = eolOf(source);
  const marker = '/* 2026-07-29: active-patient field sync follows canonical lifecycle events';
  requireAbsent(source, marker, 'active-patient interaction performance contract');
  const consoleLine = "console.log('PASS interaction performance: native Settings scroll, loader-safe timers/calls, bounded agents, exact SW lifetime, deferred polish, and da-1.1.1');";
  const block = [
    '/* 2026-07-29: active-patient field sync follows canonical lifecycle events',
    ' * after the caller lifecycle, with exact-key/session bridges and a slow backstop. */',
    "const activeSyncSource = read('feat_mls_active_patient_sync.js');",
    "assert(activeSyncSource.includes(\"window.addEventListener(EVENT_NAME, onPatientChanged)\"),",
    "  'active-patient sync is not wired to the canonical same-tab event');",
    "assert(activeSyncSource.includes('window.addEventListener(SESSION_EVENT, onSessionBoundary)'),",
    "  'active-patient sync is not wired to account-session changes');",
    "assert(activeSyncSource.includes(\"window.addEventListener('storage', onStorage)\"),",
    "  'active-patient sync is missing the cross-tab storage bridge');",
    "assert(activeSyncSource.includes(\"document.addEventListener('focusout', onFocusOut, true)\"),",
    "  'active-patient sync is missing deferred typing reconciliation');",
    "assert(activeSyncSource.includes('pendingTimer = setTimeout(function () {'),",
    "  'active-patient switches are not deferred past downstream newVisit resets');",
    "assert(activeSyncSource.includes('timer = setInterval(tick, 15000)'),",
    "  'active-patient sync must retain only the 15-second compatibility backstop');",
    "assert(!activeSyncSource.includes('setInterval(tick, 400)'),",
    "  'active-patient sync restored the high-frequency roster scan');",
    '',
    'const activeSyncWindowListeners = Object.create(null);',
    'const activeSyncDocumentListeners = Object.create(null);',
    'const activeSyncIntervals = [];',
    'const activeSyncTimeouts = [];',
    "let activeSyncAccount = 'acct-a';",
    "let currentPatient = { id: 'SYNTH-A', name: 'Synthetic A' };",
    'function activeSyncField(initial, id) {',
    '  let value = initial;',
    '  const field = {',
    '    id, writes: 0, events: [],',
    '    dispatchEvent(event) { this.events.push(event.type); },',
    '    setRaw(next) { value = next; }',
    '  };',
    "  Object.defineProperty(field, 'value', {",
    '    configurable: true,',
    '    get() { return value; },',
    '    set(next) { field.writes++; value = next; }',
    '  });',
    '  return field;',
    '}',
    "const heroPatientField = activeSyncField('Synthetic A', 'heroPtName');",
    "const labelPatientField = activeSyncField('Synthetic A', 'patientLabel');",
    'const activeSyncDocument = {',
    '  activeElement: null,',
    '  getElementById(id) {',
    "    return id === 'heroPtName' ? heroPatientField : (id === 'patientLabel' ? labelPatientField : null);",
    '  },',
    '  addEventListener(type, handler, capture) {',
    '    (activeSyncDocumentListeners[type] || (activeSyncDocumentListeners[type] = [])).push({ handler, capture: !!capture });',
    '  },',
    '  removeEventListener(type, handler, capture) {',
    '    const list = activeSyncDocumentListeners[type] || [];',
    '    const index = list.findIndex(entry => entry.handler === handler && entry.capture === !!capture);',
    '    if (index >= 0) list.splice(index, 1);',
    '  }',
    '};',
    'const activeSyncWindow = {',
    '  activePatient() { return currentPatient; },',
    "  uns(key) { return activeSyncAccount + '::' + key; },",
    '  addEventListener(type, handler) {',
    '    (activeSyncWindowListeners[type] || (activeSyncWindowListeners[type] = [])).push(handler);',
    '  },',
    '  removeEventListener(type, handler) {',
    '    const list = activeSyncWindowListeners[type] || [];',
    '    const index = list.indexOf(handler);',
    '    if (index >= 0) list.splice(index, 1);',
    '  }',
    '};',
    'function fireActiveSyncWindow(type, event) {',
    '  (activeSyncWindowListeners[type] || []).slice().forEach(handler => handler(event || { type }));',
    '}',
    'function fireActiveSyncDocument(type, event) {',
    '  (activeSyncDocumentListeners[type] || []).slice().forEach(entry => entry.handler(event || { type }));',
    '}',
    'function pendingActiveSyncTimeouts() {',
    '  return activeSyncTimeouts.filter(entry => !entry.cleared && !entry.ran).length;',
    '}',
    'function drainActiveSyncTimeouts() {',
    '  for (;;) {',
    '    const entry = activeSyncTimeouts.find(item => !item.cleared && !item.ran);',
    '    if (!entry) return;',
    '    entry.ran = true;',
    '    entry.fn();',
    '  }',
    '}',
    'function SyntheticEvent(type, options) { this.type = type; this.bubbles = !!(options && options.bubbles); }',
    'const activeSyncCtx = {',
    '  window: activeSyncWindow,',
    '  document: activeSyncDocument,',
    '  Event: SyntheticEvent,',
    '  setInterval(fn, delay) {',
    '    activeSyncIntervals.push({ fn, delay, cleared: false });',
    '    return activeSyncIntervals.length;',
    '  },',
    '  clearInterval(id) { if (activeSyncIntervals[id - 1]) activeSyncIntervals[id - 1].cleared = true; },',
    '  setTimeout(fn, delay) {',
    '    activeSyncTimeouts.push({ fn, delay, cleared: false, ran: false });',
    '    return activeSyncTimeouts.length;',
    '  },',
    '  clearTimeout(id) { if (activeSyncTimeouts[id - 1]) activeSyncTimeouts[id - 1].cleared = true; }',
    '};',
    "vm.runInNewContext(activeSyncSource, activeSyncCtx, { filename: 'active-patient-sync-runtime.js' });",
    "vm.runInNewContext(activeSyncSource, activeSyncCtx, { filename: 'active-patient-sync-runtime-rerun.js' });",
    "assert.strictEqual((activeSyncWindowListeners['mls:active-patient-changed'] || []).length, 1,",
    "  'active-patient sync installed duplicate canonical listeners');",
    "assert.strictEqual((activeSyncWindowListeners['mls:session-boundary'] || []).length, 1,",
    "  'active-patient sync installed duplicate session listeners');",
    "assert.strictEqual((activeSyncWindowListeners.storage || []).length, 1,",
    "  'active-patient sync installed duplicate storage listeners');",
    "assert.strictEqual((activeSyncDocumentListeners.focusout || []).length, 1,",
    "  'active-patient sync installed duplicate focusout listeners');",
    "assert.strictEqual(activeSyncIntervals.length, 1, 'active-patient sync installed more than one interval');",
    "assert.strictEqual(activeSyncIntervals[0].delay, 15000, 'active-patient backstop delay changed');",
    "assert.strictEqual(heroPatientField.writes + labelPatientField.writes, 0, 'initial seed wrote visit fields');",
    '',
    "fireActiveSyncWindow('mls:active-patient-changed');",
    "assert.strictEqual(pendingActiveSyncTimeouts(), 1, 'same-patient event did not use the deferred owner');",
    'drainActiveSyncTimeouts();',
    "assert.strictEqual(heroPatientField.writes + labelPatientField.writes, 0, 'same patient rewrote visit fields');",
    '',
    '/* Exact caller order: setter event first, then open-switch/newVisit clears in the same stack. */',
    "currentPatient = { id: 'SYNTH-B', name: 'Synthetic B' };",
    "fireActiveSyncWindow('mls:active-patient-changed');",
    'heroPatientField.setRaw("");',
    'labelPatientField.setRaw("");',
    "assert.strictEqual(heroPatientField.value, '', 'patient event wrote before downstream newVisit');",
    'drainActiveSyncTimeouts();',
    "assert.strictEqual(heroPatientField.value, 'Synthetic B', 'post-newVisit sync missed the hero patient field');",
    "assert.strictEqual(labelPatientField.value, 'Synthetic B', 'post-newVisit sync missed the label patient field');",
    "assert.deepStrictEqual(heroPatientField.events, ['input', 'change'], 'hero patient event sequence changed');",
    "assert.deepStrictEqual(labelPatientField.events, ['input', 'change'], 'label patient event sequence changed');",
    '',
    '/* Rapid switch signals coalesce and read the final active patient after the stack. */',
    "currentPatient = { id: 'SYNTH-C', name: 'Synthetic C' };",
    "fireActiveSyncWindow('mls:active-patient-changed');",
    "currentPatient = { id: 'SYNTH-D', name: 'Synthetic D' };",
    "fireActiveSyncWindow('mls:active-patient-changed');",
    "currentPatient = { id: 'SYNTH-E', name: 'Synthetic E' };",
    "fireActiveSyncWindow('mls:active-patient-changed');",
    "assert.strictEqual(pendingActiveSyncTimeouts(), 1, 'rapid patient switches scheduled duplicate pending work');",
    'heroPatientField.setRaw("");',
    'labelPatientField.setRaw("");',
    'drainActiveSyncTimeouts();',
    "assert.strictEqual(heroPatientField.value, 'Synthetic E', 'rapid switches did not converge on the final patient');",
    "assert.strictEqual(labelPatientField.value, 'Synthetic E', 'rapid label switches did not converge');",
    '',
    '/* Session reset dispatches before startSession newVisit; the deferred task must land after it. */',
    "activeSyncAccount = 'acct-b';",
    "currentPatient = { id: 'SYNTH-F', name: 'Synthetic F' };",
    "fireActiveSyncWindow('mls:session-boundary');",
    'heroPatientField.setRaw("");',
    'labelPatientField.setRaw("");',
    'drainActiveSyncTimeouts();',
    "assert.strictEqual(heroPatientField.value, 'Synthetic F', 'session-boundary sync ran before the reset stack finished');",
    "assert.strictEqual(labelPatientField.value, 'Synthetic F', 'session-boundary label did not converge');",
    '',
    '/* Cross-tab handling computes the current namespace at event time. */',
    "currentPatient = { id: 'SYNTH-G', name: 'Synthetic G' };",
    "fireActiveSyncWindow('storage', { key: 'acct-a::activePt' });",
    "assert.strictEqual(pendingActiveSyncTimeouts(), 0, 'old-account storage scheduled a patient sync');",
    "assert.strictEqual(heroPatientField.value, 'Synthetic F', 'old-account storage changed the active field');",
    "fireActiveSyncWindow('storage', { key: 'acct-b::activePt' });",
    'drainActiveSyncTimeouts();',
    "assert.strictEqual(heroPatientField.value, 'Synthetic G', 'current-account storage event was ignored');",
    '',
    '/* A field being typed in is deferred until its real focusout, never a fabricated storage event. */',
    "currentPatient = { id: 'SYNTH-H', name: 'Synthetic H' };",
    'activeSyncDocument.activeElement = labelPatientField;',
    "fireActiveSyncWindow('mls:active-patient-changed');",
    'drainActiveSyncTimeouts();',
    "assert.strictEqual(heroPatientField.value, 'Synthetic H', 'active typing blocked the other patient field');",
    "assert.strictEqual(labelPatientField.value, 'Synthetic G', 'active patient typing was overwritten');",
    'activeSyncDocument.activeElement = null;',
    "fireActiveSyncDocument('focusout', { target: labelPatientField });",
    'drainActiveSyncTimeouts();',
    "assert.strictEqual(labelPatientField.value, 'Synthetic H', 'focusout did not reconcile the deferred patient field');",
    '',
    "currentPatient.name = 'Synthetic H Renamed';",
    'activeSyncIntervals[0].fn();',
    "assert.strictEqual(heroPatientField.value, 'Synthetic H Renamed', 'backstop missed a same-ID name refresh');",
    "assert.strictEqual(labelPatientField.value, 'Synthetic H Renamed', 'backstop missed the renamed label');",
    '',
    'currentPatient = null;',
    "fireActiveSyncWindow('mls:active-patient-changed');",
    'drainActiveSyncTimeouts();',
    "assert.strictEqual(heroPatientField.value, 'Synthetic H Renamed', 'clear patient unexpectedly blanked the hero field');",
    "assert.strictEqual(labelPatientField.value, 'Synthetic H Renamed', 'clear patient unexpectedly blanked the label field');",
    'const activeSyncApi = activeSyncWindow.__mlsActivePtSync;',
    "currentPatient = { id: 'SYNTH-I', name: 'Synthetic I' };",
    "fireActiveSyncWindow('mls:active-patient-changed');",
    "assert.strictEqual(pendingActiveSyncTimeouts(), 1, 'revert probe did not own pending work');",
    'activeSyncApi.revert();',
    "assert.strictEqual((activeSyncWindowListeners['mls:active-patient-changed'] || []).length, 0,",
    "  'active-patient revert left the canonical listener installed');",
    "assert.strictEqual((activeSyncWindowListeners['mls:session-boundary'] || []).length, 0,",
    "  'active-patient revert left the session listener installed');",
    "assert.strictEqual((activeSyncWindowListeners.storage || []).length, 0,",
    "  'active-patient revert left the storage listener installed');",
    "assert.strictEqual((activeSyncDocumentListeners.focusout || []).length, 0,",
    "  'active-patient revert left the focusout listener installed');",
    "assert(activeSyncIntervals[0].cleared, 'active-patient revert left the interval installed');",
    "assert.strictEqual(pendingActiveSyncTimeouts(), 0, 'active-patient revert left deferred work armed');",
    'drainActiveSyncTimeouts();',
    'activeSyncIntervals[0].fn();',
    "assert.strictEqual(heroPatientField.value, 'Synthetic H Renamed', 'reverted active-patient sync still wrote fields');",
    '',
    'function extractActiveSetter(sourceText, label) {',
    "  const start = sourceText.indexOf('function setActivePtId(id){');",
    "  const end = sourceText.indexOf('\\nfunction activePatient()', start);",
    "  assert(start >= 0 && end > start, label + ' active setter is missing');",
    '  return sourceText.slice(start, end);',
    '}',
    'function checkActiveSetter(setterSource, label) {',
    "  let stored = 'SYNTH-A';",
    '  const events = [];',
    '  let depth = 0;',
    '  let maxDepth = 0;',
    '  const setterCtx = {',
    '    getActivePtId() { return stored; },',
    "    uns(key) { return 'acct::' + key; },",
    '    localStorage: {',
    "      setItem(key, value) { assert.strictEqual(key, 'acct::activePt'); stored = String(value); },",
    "      removeItem(key) { assert.strictEqual(key, 'acct::activePt'); stored = ''; }",
    '    },',
    '    CustomEvent: function CustomEvent(type, init) { this.type = type; this.detail = init.detail; },',
    '    Event: function Event(type) { this.type = type; },',
    '    window: null',
    '  };',
    '  setterCtx.window = {',
    '    dispatchEvent(event) {',
    '      depth++; maxDepth = Math.max(maxDepth, depth);',
    '      events.push({ event, storedAtDispatch: stored });',
    '      setterCtx.setActivePtId(event.detail.patientId);',
    '      depth--;',
    '    }',
    '  };',
    "  vm.runInNewContext(setterSource + ';this.setActivePtId=setActivePtId;', setterCtx,",
    "    { filename: label + '-active-patient-setter.js' });",
    "  setterCtx.setActivePtId('SYNTH-A');",
    "  assert.strictEqual(events.length, 0, label + ' setter emitted for the same patient ID');",
    "  setterCtx.setActivePtId('SYNTH-B');",
    "  assert.strictEqual(events.length, 1, label + ' setter missed a patient switch event');",
    "  assert.strictEqual(events[0].event.detail.previousId, 'SYNTH-A', label + ' event previous ID changed');",
    "  assert.strictEqual(events[0].event.detail.patientId, 'SYNTH-B', label + ' event patient ID changed');",
    "  assert.strictEqual(events[0].storedAtDispatch, 'SYNTH-B', label + ' dispatched before storage adopted the patient');",
    "  setterCtx.setActivePtId('');",
    "  assert.strictEqual(events.length, 2, label + ' setter missed clear-patient event');",
    "  assert.strictEqual(events[1].storedAtDispatch, '', label + ' clear event dispatched before storage cleared');",
    "  assert.strictEqual(maxDepth, 1, label + ' setter event dispatch recursed');",
    '}',
    "checkActiveSetter(extractActiveSetter(app, 'production'), 'production');",
    "checkActiveSetter(extractActiveSetter(stagingApp, 'staging'), 'staging');",
    ''
  ].join(nl);
  return replaceOnce(
    source,
    consoleLine,
    block + consoleLine,
    'active-patient interaction performance test insertion'
  );
});

for (const change of planned) {
  fs.writeFileSync(path.join(root, change.relativePath), change.after, change.encoding);
}

for (const change of planned) {
  console.log(
    change.relativePath + ' ' +
    digest(change.before, change.encoding).slice(0, 12) + ' -> ' +
    digest(change.after, change.encoding).slice(0, 12)
  );
}
console.log('Applied 042-event-driven-active-patient-sync to ' + planned.length + ' files');
