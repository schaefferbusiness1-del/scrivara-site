'use strict';

/* OP-NOTE ROOM REMAKE (opr-2.0.0 + onf-2.13.0) - 2026-07-28 owner order:
 * "I don't like the OpNotes UI - completely remake from scratch the OpNotes
 * UI" and "Use every time should be available under each one of these, and it
 * should actually work."
 *
 * Contract, proven by RUNNING the modules in a vm (source pins alone are not
 * proof):
 *  1. The room OWNS the presentation - skin, single-card (opr-solo) mode,
 *     Prev/Next pager, arrow-key navigation - and never re-implements the
 *     pipeline: no generation, no matching, no saving inside the room module.
 *  2. "Use every time" under EVERY reusable field: an EXPLICIT second tier of
 *     account defaults (same scoped uns() family as tier 1). A saved default
 *     PERSISTS, REAPPLIES on a later draft through the real fill pathway
 *     (resolveInitialField -> kind 'default' -> applyVals), applies into open
 *     drafts (applyDefaultToBoxes), and CLEARS in one click. Facts about one
 *     patient or one encounter (identity, dates, chart-bound facts, outcome
 *     attestations) can never be pinned; the tier-1 allowlist still gates
 *     every silent path (dropdown history / prior-value learning). */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const room = fs.readFileSync(path.join(root, 'feat_mls_opnote_room.js'), 'utf8');
const fill = fs.readFileSync(path.join(root, 'feat_mls_opnote_fill.js'), 'utf8');

/* ---------------- source pins: the room owns presentation only ----------- */
assert(room.includes("var VERSION = 'opr-2.0.0';"), 'room module is not the opr-2.0.0 remake');
assert(room.includes("SKIN_ID = 'oprSkin'"), 'the room skin (presentation owner) is missing');
assert(room.includes('opr-solo'), 'one-card-at-a-time presentation mode is missing');
assert(room.includes("pager.id = 'oprPager'"), 'the Prev/Next pager is missing');
assert(room.includes("'ArrowDown'") && room.includes("'ArrowUp'"), 'arrow-key patient navigation is missing');
assert(!room.includes('aiCallRaw') && !room.includes('_genOpNote') && !room.includes('opPrepSave('),
  'the room must never re-implement or call generation/saving directly - the pipeline owns those');
assert(!/getElementById\(['"]opPrepList['"]\)[^\n]*\.innerHTML\s*=/.test(room) && !/\$\('opPrepList'\)\.innerHTML\s*=/.test(room),
  'the room must never write into #opPrepList - those anchors belong to the base render and the satellites');

/* ------------- source pins: the explicit per-field default tier ---------- */
assert(fill.includes("var VERSION = 'onf-2.13.0';"), 'onf is not the 2.13.0 per-field-defaults build');
assert(fill.includes("USER_DEFAULTS_SUFFIX = 'opFieldDefaultsUserV1'"), 'explicit-tier store suffix is missing');
assert(fill.includes('reusableSurface && defaultOffered(label)'),
  'the "Use every time" control is no longer offered under every reusable field');
assert(fill.includes('applied from your defaults'), 'the applied-from-your-defaults chip is missing');
assert(fill.includes('if (val && defaultEligible(label) && scopedKey'),
  'the SILENT dropdown-history write lost its tier-1 allowlist gate');
assert(/function priorValues\(label\) \{[\s\S]{0,400}if \(!defaultEligible\(label\)\) return \[\];/.test(fill),
  'the SILENT prior-value read lost its tier-1 allowlist gate');

/* ================= vm 1: the real fill pathway (feat_mls_opnote_fill.js) = */
let account = '_';
const storage = new Map();
const fillCtx = {
  console, Promise, Date, Math, JSON, Object, String, Number, Array, RegExp, Error,
  document: { readyState: 'loading', addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; } },
  localStorage: {
    getItem(key) { return storage.has(key) ? storage.get(key) : null; },
    setItem(key, value) { storage.set(key, String(value)); },
    removeItem(key) { storage.delete(key); }
  },
  Event: function Event(type, init) { this.type = type; this.bubbles = !!(init && init.bubbles); },
  setTimeout() { return 1; }, clearTimeout() {}, setInterval() { return 1; }, clearInterval() {},
  getComputedStyle() { return { display: 'none' }; },
  uns(suffix) { return `sf_u::${account}::${suffix}`; },
  getPatients() { return []; }, getTemplates() { return []; }, getTemplateById() { return null; },
  getOpFieldVals() { return []; }, addOpFieldVal() {},
  _opPrep: []
};
fillCtx.window = fillCtx;
vm.runInNewContext(fill, fillCtx, { filename: 'feat_mls_opnote_fill.js' });
const api = fillCtx.__mlsOpNoteFill;
assert(api && api.installed && api.version === 'onf-2.13.0', 'onf did not install');

const freshRow = { patientId: '', tplId: '', proc: 'Right knee injection', appt: { name: 'Casey Example', dob: '01/02/1980' } };

/* unresolved account: the explicit tier refuses to write anywhere shared */
assert.strictEqual(api._setAnyDefault('needle gauge', '22-gauge, 3.5-inch'), false,
  'signed-out explicit default landed in the shared namespace');
assert.strictEqual(storage.size, 0);

/* signed in: a clinical field tier-1 refuses is OFFERED and SAVES explicitly */
account = 'doctor-a@example.test';
assert.strictEqual(api._defaultEligible('needle gauge'), false, 'tier-1 allowlist widened - silent paths are exposed');
assert.strictEqual(api._userDefaultEligible('needle gauge'), true, 'explicit tier does not cover a standard clinical field');
assert.strictEqual(api._defaultOffered('needle gauge'), true, 'the button would not be offered under this field');
assert.strictEqual(api._setAnyDefault('needle gauge', '22-gauge, 3.5-inch'), true, 'explicit default did not save');
assert.strictEqual(api._setAnyDefault('steroid dose', '10 mg'), true, 'explicit default did not save for a dose field');
assert.strictEqual(api._setDefault('steroid dose', '10 mg'), false, 'tier-1 setter accepted a clinical field - allowlist broken');

/* REAPPLIES on a later draft through the REAL pathway */
let resolved = api._resolveInitialField('needle gauge', freshRow, {});
assert.strictEqual(resolved.kind, 'default', 'saved default did not reapply through resolveInitialField');
assert.strictEqual(resolved.value, '22-gauge, 3.5-inch');
assert.strictEqual(api._applyVals('Needle: [FILL: needle gauge] / [[needle_gauge]] / [NEEDLE GAUGE]', { 'needle gauge': resolved.value }),
  'Needle: 22-gauge, 3.5-inch / 22-gauge, 3.5-inch / 22-gauge, 3.5-inch',
  'default did not fill every placeholder shape');

/* applies into an already-open draft via the one shared apply path */
const openRow = { _onfRaw: 'Needle: [[needle_gauge]]', _onfVals: {} };
const openBox = { id: 'opPrepNote_0', value: openRow._onfRaw, dispatchEvent() {} };
fillCtx._opPrep = [openRow];
assert.strictEqual(api._applyDefaultToBoxes('needle gauge', '22-gauge, 3.5-inch', [openBox], false), 1,
  'explicit default cannot reach an open draft');
assert.strictEqual(openBox.value, 'Needle: 22-gauge, 3.5-inch');
assert.strictEqual(openRow._onfDefaultKeys['needle gauge'], true, 'applied field is not marked as default-sourced');

/* patient-specific values still outrank a pinned default */
resolved = api._resolveInitialField('needle gauge', freshRow, { 'needle gauge': '25-gauge, 1.5-inch' });
assert.strictEqual(resolved.kind, 'saved', 'per-patient memory no longer outranks the account default');
assert.strictEqual(resolved.value, '25-gauge, 1.5-inch');

/* account isolation */
account = 'doctor-b@example.test';
assert.strictEqual(api._anyFieldDefault('needle gauge'), null, 'doctor A default leaked to doctor B');
account = 'doctor-a@example.test';
assert(api._anyFieldDefault('needle gauge'), 'doctor A default was not retained');

/* one-click clear, and no reapply after */
assert.strictEqual(api._clearAnyDefault('needle gauge'), true, 'clear failed');
assert.strictEqual(api._userFieldDefault('needle gauge'), null);
resolved = api._resolveInitialField('needle gauge', freshRow, {});
assert.notStrictEqual(resolved.kind, 'default', 'cleared default still reapplies');

/* facts about ONE patient / ONE encounter can NEVER be pinned - even explicitly */
['Patient name', 'DOB', 'MRN', 'Date of procedure', 'Diagnosis', 'History of present illness',
  'Medications', 'Allergies', 'BMI', 'Complications', 'Consent'].forEach(label => {
  assert.strictEqual(api._userDefaultEligible(label), false, `${label} was eligible for an explicit cross-chart default`);
  assert.strictEqual(api._setAnyDefault(label, 'unsafe'), false, `${label} was saved as an explicit cross-chart default`);
});

/* tier 1 still works and still routes through the one setter */
assert.strictEqual(api._setAnyDefault('equipment model', 'OEC Elite'), true);
assert.strictEqual(api.getDefault('equipment model'), 'OEC Elite');
assert.strictEqual(api._clearAnyDefault('equipment model'), true);

/* ================= vm 2: the room presentation (feat_mls_opnote_room.js) = */
const createdNodes = [];
function makeStub(id) {
  const kids = {};
  const n = {
    id: id || '', innerHTML: '', textContent: '', style: {}, _cls: {},
    parentNode: null, parentElement: null, children: [],
    onclick: null, disabled: false,
    setAttribute(k, v) { this['_attr_' + k] = String(v); },
    getAttribute(k) { const v = this['_attr_' + k]; return v == null ? null : v; },
    querySelectorAll() { return []; },
    querySelector(sel) {
      if (!kids[sel]) {
        kids[sel] = makeStub('');
        if (sel.indexOf('data-opr-nav') >= 0) kids[sel]['_attr_data-opr-nav'] = sel.indexOf('next') >= 0 ? 'next' : 'prev';
      }
      return kids[sel];
    },
    scrollIntoView() {},
    appendChild(child) { child.parentNode = n; child.parentElement = n; n.children.push(child); return child; },
    insertBefore(child) { child.parentNode = n; child.parentElement = n; n.children.push(child); return child; },
    removeChild(child) { child.parentNode = null; child.parentElement = null; n.children = n.children.filter(c => c !== child); return child; }
  };
  n.classList = {
    add(c) { n._cls[c] = 1; }, remove(c) { delete n._cls[c]; },
    contains(c) { return !!n._cls[c]; },
    toggle(c, on) { if (on === undefined) on = !n._cls[c]; if (on) n._cls[c] = 1; else delete n._cls[c]; return !!on; }
  };
  return n;
}
const ids = {};
['opPrepModal', 'templatesModal', 'oprRowNav', 'oprTplRail', 'oprReceipt', 'opPrepList',
  'oprPanelProcs', 'oprPanelTpls', 'oprTabProcs', 'oprTabTpls', 'oprEditor',
  'opPrepPrev_0', 'opPrepPrev_1'].forEach(id => { ids[id] = makeStub(id); });
ids.opPrepPrev_0.parentElement = makeStub('card0');
ids.opPrepPrev_1.parentElement = makeStub('card1');
ids.oprReceipt.parentElement = ids.oprEditor;
ids.opPrepList.parentElement = ids.oprEditor;

const listeners = [];
let origCalls = 0, tickCalls = 0;
const roomCtx = {
  document: {
    getElementById(id) { return ids[id] || createdNodes.find(n => n.id === id) || null; },
    createElement(tag) { const n = makeStub(''); n.tagName = String(tag).toUpperCase(); createdNodes.push(n); return n; },
    head: makeStub('head'),
    visibilityState: 'hidden'
  },
  console
};
roomCtx.window = roomCtx;
roomCtx.addEventListener = (type, fn, cap) => { listeners.push({ type, fn, cap }); };
roomCtx.removeEventListener = (type, fn) => {
  const at = listeners.findIndex(l => l.type === type && l.fn === fn);
  if (at >= 0) listeners.splice(at, 1);
};
roomCtx.opPrepRender = function () { origCalls++; };
const ORIG = roomCtx.opPrepRender;
roomCtx._opPrep = [
  { appt: { name: 'Pat One', dob: '01/02/1970' }, patientId: 'pid-1', gen: false, tplId: '', note: '', proc: 'SI injection' },
  { appt: { name: 'Pat Two', dob: '02/03/1980' }, patientId: 'pid-2', gen: true, tplId: 't1', note: 'no blanks here', proc: 'MBB' }
];
roomCtx.opNoteBlankTokens = () => [];
roomCtx.getTemplates = () => [{ id: 't1', name: 'SI joint template' }];
roomCtx.__mlsTplPrepFix = { healthOf() { return { cls: 'ok', label: 'healthy' }; } };
roomCtx._opResolvePatient = () => ({ id: 'pid-1', name: 'Pat One' });
roomCtx.__mlsOpNoteFill = { installed: true, tick() { tickCalls++; }, _verifiedHistoryVisits() { return [1]; } };

vm.createContext(roomCtx);
vm.runInContext(room, roomCtx, { filename: 'feat_mls_opnote_room.js' });
assert(roomCtx.__mlsOpNoteRoom && roomCtx.__mlsOpNoteRoom.installed, 'room did not install');
assert.strictEqual(roomCtx.__mlsOpNoteRoom.version, 'opr-2.0.0');

/* the skin landed as a real style node */
const skinNode = createdNodes.find(n => n.id === 'oprSkin');
assert(skinNode && skinNode.textContent.includes('opr-solo') && skinNode.textContent.includes('.onf-fillbox'),
  'the room skin did not restyle the solo mode and the Fields panel');

/* a render drives the pipeline THROUGH the wrap and rebuilds the room chrome */
roomCtx.opPrepRender();
assert.strictEqual(origCalls, 1, 'wrap lost the base-render callthrough');
assert.strictEqual(tickCalls, 1, 'wrap lost the synchronous onf kick');
assert(ids.opPrepList.classList.contains('opr-solo'), 'all-day mode did not enter one-card-at-a-time presentation');
assert(ids.oprRowNav.innerHTML.includes('Pat One') && ids.oprRowNav.innerHTML.includes('needs a template'),
  'nav rail lost the per-row status line');
const pager = createdNodes.find(n => n.id === 'oprPager');
assert(pager && pager.parentNode === ids.oprEditor, 'pager did not mount in the editor');
assert.strictEqual(pager.querySelector('.opr-pos').textContent, 'Patient 1 of 2', 'pager position is wrong');

/* pager Next selects the next patient - selection only, never the pipeline */
pager.onclick({ target: { closest() { return { getAttribute() { return 'next'; } }; } } });
assert.strictEqual(pager.querySelector('.opr-pos').textContent, 'Patient 2 of 2', 'pager Next did not advance selection');
assert(ids.opPrepPrev_1.parentElement.classList.contains('opr-cur'), 'selected card did not become current');
assert.strictEqual(origCalls, 1, 'selection triggered a pipeline re-render');

/* arrow keys move between patients when not typing */
ids.opPrepModal._cls.show = 1;
const keydowns = listeners.filter(l => l.type === 'keydown');
assert(keydowns.length >= 2, 'keyboard handlers are not attached');
keydowns.forEach(l => l.fn({ key: 'ArrowLeft', target: { tagName: 'BODY' }, preventDefault() {}, stopImmediatePropagation() {} }));
assert.strictEqual(pager.querySelector('.opr-pos').textContent, 'Patient 1 of 2', 'ArrowLeft did not select the previous patient');
keydowns.forEach(l => l.fn({ key: 'ArrowRight', target: { tagName: 'TEXTAREA' }, preventDefault() {}, stopImmediatePropagation() {} }));
assert.strictEqual(pager.querySelector('.opr-pos').textContent, 'Patient 1 of 2', 'arrow keys stole a keystroke from a field the doctor was typing in');

/* revert: base render restored, chrome removed, presentation classes gone */
roomCtx.__mlsOpNoteRoom.revert();
assert.strictEqual(roomCtx.opPrepRender, ORIG, 'revert did not restore opPrepRender');
assert.strictEqual(pager.parentNode, null, 'revert did not remove the pager');
assert(!ids.opPrepList.classList.contains('opr-solo'), 'revert did not leave solo mode');
assert.strictEqual(skinNode.parentNode, null, 'revert did not remove the skin');

console.log('PASS op-note room remake: room owns presentation (skin + solo card + pager + arrows, clean revert), pipeline reached only through the wrap, and the explicit per-field "Use every time" tier persists, reapplies through the real fill pathway, applies to open drafts, clears in one click, and refuses one-patient/one-encounter facts');
