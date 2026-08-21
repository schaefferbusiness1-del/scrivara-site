'use strict';

/* Executed cold-start/first-use contract for the b1036 promoted late surfaces.
 * The feature engines have their own deep suites; this test isolates the real
 * loader IIFEs so a promotion cannot quietly rejoin boot or miss its surface. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const connect = fs.readFileSync(path.join(root, '1p-mls-connect.js'), 'utf8');
let checks = 0;
function ok(value, message) { assert.ok(value, message); checks++; }
function eq(actual, expected, message) { assert.strictEqual(actual, expected, message); checks++; }

function oneLine(marker) {
  const at = connect.indexOf(marker);
  const start = connect.lastIndexOf(';(function(){try{', at);
  const end = connect.indexOf('\n', at);
  ok(at >= 0 && start >= 0 && end > at, marker + ' loader could not be isolated');
  return connect.slice(start, end);
}

function harness(source, options = {}) {
  const scripts = [], scheduled = [], timers = [], observers = [];
  const windowListeners = {}, documentListeners = {};
  const host = options.hostId ? {
    id: options.hostId,
    getAttribute(name) { return name === 'data-mls-easy-mode' ? String(options.easyMode || '') : null; },
    classList: { contains(name) { return name === 'show' && options.hostShown === true; } }
  } : null;
  function tag() {
    return { attrs: {}, parentNode: null, src: '', async: false, onload: null, onerror: null,
      setAttribute(name, value) { this.attrs[name] = String(value); },
      getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null; },
      removeAttribute(name) { delete this.attrs[name]; } };
  }
  const parent = {
    appendChild(node) { node.parentNode = this; scripts.push(node); return node; },
    removeChild(node) { const at = scripts.indexOf(node); if (at >= 0) scripts.splice(at, 1); node.parentNode = null; }
  };
  function matching(selector) {
    const match = String(selector || '').match(/data-mls-asset="([^"]+)"/);
    return match ? scripts.filter(node => node.getAttribute('data-mls-asset') === match[1]) : [];
  }
  const document = {
    head: parent, body: parent, documentElement: parent,
    createElement() { return tag(); },
    querySelector(selector) { return matching(selector)[0] || null; },
    querySelectorAll(selector) { return matching(selector); },
    getElementById(id) { return host && host.id === id ? host : null; },
    addEventListener(name, fn) { (documentListeners[name] ||= []).push(fn); },
    removeEventListener(name, fn) { documentListeners[name] = (documentListeners[name] || []).filter(item => item !== fn); }
  };
  const window = {
    __MLS_AV: 'admission-test',
    __MLS_P1_PREVIEW: { enabled: true },
    __mlsCurrentView: options.currentView || '',
    getActivePtId() { return options.activePatient || ''; },
    __mlsDeferAsset(fn, meta) { scheduled.push({ fn, meta: meta || {} }); return scheduled.length; },
    addEventListener(name, fn) { (windowListeners[name] ||= []).push(fn); },
    removeEventListener(name, fn) { windowListeners[name] = (windowListeners[name] || []).filter(item => item !== fn); }
  };
  window.MutationObserver = class {
    constructor(callback) { this.callback = callback; this.connected = false; observers.push(this); }
    observe(target, config) { this.target = target; this.config = config; this.connected = true; }
    disconnect() { this.connected = false; }
  };
  const context = vm.createContext({ window, document, Date, Math, URLSearchParams,
    location: { search: '' }, setTimeout(fn) { timers.push(fn); return timers.length; }, clearTimeout() {}, console });
  vm.runInContext(source, context, { filename: '1p-mls-connect.js#promoted-late-loader' });
  function dispatch(listeners, name, detail, target) {
    (listeners[name] || []).slice().forEach(fn => fn({ detail: detail || {}, target: target || null,
      preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} }));
  }
  return {
    window, document, host, scripts, scheduled, timers, observers,
    windowEvent(name, detail) { dispatch(windowListeners, name, detail); },
    documentClick(selector) { dispatch(documentListeners, 'click', {}, { closest(query) { return query.includes(selector) ? this : null; } }); },
    flushTimers() { const jobs = timers.splice(0); jobs.forEach(fn => fn()); }
  };
}

const range = oneLine("A='1p-feat_mls_rangejobs.js',V='p1-rangejobs-1.1.0'");
let h = harness(range);
eq(h.scripts.length, 0, 'Staff Prep range engine joined cold boot');
eq(h.scheduled.length, 1, 'Staff Prep range engine lost its idle fallback');
h.windowEvent('mls:menu-staff-prep-request');
eq(h.scripts.length, 1, 'Staff Prep request did not immediately admit the range engine');
eq(h.scripts[0].async, true, 'Staff Prep range engine re-serialized boot');

const mobile = oneLine("A='1p-feat_mls_mobile_encounter.js',V='p1-mobile-encounter-1.0.0',K='__mlsP1MobileEncounterLoader'");
h = harness(mobile);
eq(h.scripts.length, 0, 'mobile encounter coordinator joined cold boot');
eq(h.scheduled.length, 1, 'mobile encounter coordinator lost its deferred fallback');
eq(h.scheduled[0].meta.priority, 0, 'mobile encounter coordinator left the secure-gate lane');
h.windowEvent('mls:view-changed', { view: 'visit', previousView: 'patients' });
eq(h.scripts.length, 1, 'Visit navigation did not immediately admit the mobile encounter coordinator');
eq(h.scripts[0].async, true, 'mobile encounter coordinator re-serialized boot');

const provenance = oneLine("A='1p-feat_mls_study_provenance.js',V='p1sp-1.0.0'");
h = harness(provenance);
eq(h.scripts.length, 0, 'Study provenance joined cold boot');
eq(h.scheduled.length, 1, 'Study provenance lost its idle fallback');
h.windowEvent('mls:study-lifecycle', { reason: 'render' });
eq(h.scripts.length, 1, 'Study render did not immediately admit provenance');
eq(h.scripts[0].async, true, 'Study provenance re-serialized boot');

const templateModes = oneLine("A='1p-feat_mls_template_modes.js',V='p1-template-modes-1.0.0',K='__mlsP1TemplateModesLoader'");
h = harness(templateModes, { hostId: 'opPrepModal' });
eq(h.scripts.length, 0, 'template-mode adapter joined cold boot');
eq(h.scheduled.length, 1, 'template-mode adapter lost its idle fallback');
eq(h.observers.length, 1, 'template-mode adapter lost its host visibility trigger');
eq(h.observers[0].target, h.host, 'template-mode loader observer escaped #opPrepModal');
h.documentClick('#opPrepSmartBtn');
eq(h.scripts.length, 1, 'Op Prep first use did not immediately admit template modes');
eq(h.scripts[0].async, true, 'template-mode adapter re-serialized boot');

const visitHistory = oneLine('var A="feat_visit_history_ext.js"');
h = harness(visitHistory, { activePatient: 'pt-1', currentView: 'visit' });
eq(h.scripts.length, 0, 'existing-patient Visit boot eagerly loaded extended history');
eq(h.scheduled.length, 1, 'extended history lost its idle reliability fallback');
h.windowEvent('mls:active-patient-changed', { patientId: 'pt-1' });
eq(h.scripts.length, 0, 'patient event outside Patients/Profile eagerly loaded extended history');
h.windowEvent('mls:view-changed', { view: 'patients', previousView: 'visit', patientId: 'pt-1' });
eq(h.scripts.length, 1, 'Patients/Profile first use did not immediately admit extended history');
eq(h.scripts[0].async, true, 'extended history re-serialized boot');

h = harness(visitHistory, { activePatient: 'pt-1', currentView: 'patients' });
eq(h.scripts.length, 0, 'Patients/Profile admission ran synchronously inside bundle evaluation');
eq(h.timers.length, 1, 'cold Patients/Profile with an active patient lost its immediate admission');
h.flushTimers();
eq(h.scripts.length, 1, 'cold Patients/Profile immediate admission did not load extended history');

const faceMarker = connect.indexOf("var A='feat_mls_avatar_face.js',SRC='1p-feat_mls_avatar_face.js'");
const faceStart = connect.lastIndexOf(';(function(){try{', faceMarker);
const faceEnd = connect.indexOf('/* 1p Avatar face studio:', faceMarker);
ok(faceMarker > faceStart && faceEnd > faceMarker, 'Avatar face loader block could not be isolated');
const face = connect.slice(faceStart, faceEnd);
h = harness(face);
eq(h.scripts.length, 0, 'Avatar face studio joined cold boot');
eq(h.scheduled.length, 1, 'Avatar face studio lost its idle fallback');
h.windowEvent('mls:avatar-step', { step: 'look' });
eq(h.scripts.length, 1, 'Avatar look first use did not immediately admit the face studio');
eq(h.scripts[0].async, false, 'Avatar face loader changed its established ordered script semantics');

const avatarMarker = connect.indexOf("var A='feat_mls_avatar.js',SRC='1p-feat_mls_avatar.js'");
const avatarStart = connect.lastIndexOf(';(function(){try{', avatarMarker);
const avatarEnd = connect.indexOf("var A='1p-feat_mls_mobile_encounter.js'", avatarMarker);
const avatarLoader = connect.slice(avatarStart, avatarEnd);
ok(avatarMarker > avatarStart && avatarEnd > avatarMarker, 'Avatar loader block could not be isolated');
ok(avatarLoader.indexOf('var deferAsset=window.__mlsDeferAsset') < avatarLoader.indexOf("var A='feat_mls_avatar.js'"),
  'Avatar asset ref precedes its deferred scheduler marker');
ok(avatarLoader.includes('window[KEY]=ctl;ctl.deferEnsure();'), 'Avatar no longer enters through its deferred controller');

console.log(`PASS promoted late-loader admission runtime (${checks} assertions)`);
