'use strict';

/* WORKROOM STAGE 2b (opr-1.2.0) - the rails come alive.
 *
 * The room wraps opPrepRender: after every list rebuild it synchronously kicks
 * the onf Fields tick (b715 occluded-tab law - this tab's real posture is
 * hidden behind athenaOne, where intervals beat ~1/minute; a timer would leave
 * every Fields box dead for up to a minute after a mid-draft re-render) and
 * rebuilds #oprRowNav / #oprTplRail / #oprReceipt. Writes land ONLY in
 * room-owned nodes plus the .opr-cur presentation class; the injection anchors
 * inside #opPrepList are never touched.
 *
 * b718's lesson is applied here from day one: the base function is not the
 * running function - so this suite RUNS the module in a vm and proves the
 * wrap, the kick, the rails and the revert, instead of trusting source pins
 * alone. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');
const room = fs.readFileSync(path.join(root, 'feat_mls_opnote_room.js'), 'utf8');
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');

/* ---- source pins ------------------------------------------------------- */
assert(/var VERSION = 'opr-1\.\d+\.\d+';/.test(room), 'room module lost its version line');
assert(room.includes("behavior: (document.visibilityState === 'visible' ? 'smooth' : 'auto')"),
  "nav scroll must fall back to instant when occluded - smooth is rAF-driven and never moves in a hidden tab (proven live at b719)");
assert(room.includes('w.__oprWrap = true; w.__oprOrig = orig;'), 'render wrap is not marked idempotent/revertible');
assert(/var onf = window\.__mlsOpNoteFill; if \(onf && onf\.installed && isFn\(onf\.tick\)\) onf\.tick\(\);/.test(room),
  'the wrap must kick the onf Fields tick synchronously');
assert(!/getElementById\(['"]opPrepList['"]\)[^\n]*\.innerHTML\s*=/.test(room) && !/\$\('opPrepList'\)\.innerHTML\s*=/.test(room),
  'the room must never write into #opPrepList - those anchors belong to the base render and the satellites');
assert(app.includes('<nav id="oprRowNav"'), 'day rail is missing the patient nav node');
assert(app.includes('<div id="oprTplRail"'), 'day rail is missing the template rail node');
assert(app.includes('<div id="oprReceipt"'), 'editor is missing the context receipt node');
assert(app.includes('#opPrepList .opr-cur{ box-shadow:0 0 0 1.5px var(--green-dk) inset; }'),
  'the selected-row highlight must be box-shadow only (never a border the inline styles fight)');
assert(connect.includes('API.healthOf = healthOf;'),
  'tpf must export healthOf - the rail reads health through the owner, never a drifting copy');

/* ---- runtime: run the module against a stub page ----------------------- */
function stubNode(id) {
  return {
    id: id, innerHTML: '', textContent: '', style: {},
    _cls: {},
    classList: {
      add: function (c) { this._parent._cls[c] = 1; },
      remove: function (c) { delete this._parent._cls[c]; },
      contains: function (c) { return !!this._parent._cls[c]; }
    },
    querySelectorAll: function () { return []; },
    onclick: null,
    getAttribute: function () { return null; },
    scrollIntoView: function () {},
    parentElement: null
  };
}
const ids = {};
['opPrepModal', 'templatesModal', 'oprRowNav', 'oprTplRail', 'oprReceipt', 'opPrepList', 'opPrepPrev_0', 'opPrepPrev_1'].forEach(function (id) {
  ids[id] = stubNode(id);
  ids[id].classList._parent = ids[id];
});
ids.opPrepPrev_0.parentElement = stubNode('card0'); ids.opPrepPrev_0.parentElement.classList._parent = ids.opPrepPrev_0.parentElement;
ids.opPrepPrev_1.parentElement = stubNode('card1'); ids.opPrepPrev_1.parentElement.classList._parent = ids.opPrepPrev_1.parentElement;

let origCalls = 0, tickCalls = 0;
const ctx = {
  document: { getElementById: function (id) { return ids[id] || null; } },
  console: console
};
ctx.window = ctx;
ctx.addEventListener = function () {}; ctx.removeEventListener = function () {};
ctx.opPrepRender = function () { origCalls++; };
const ORIG = ctx.opPrepRender;
ctx._opPrep = [
  { appt: { name: 'Pat One', dob: '01/02/1970' }, patientId: 'pid-1', gen: false, note: '', proc: 'SI injection' },
  { appt: { name: 'Pat Two', dob: '02/03/1980' }, patientId: 'pid-2', gen: true, note: 'no blanks here', proc: 'MBB' }
];
ctx.opNoteBlankTokens = function () { return []; };
ctx.getTemplates = function () { return [{ id: 't1', name: 'SI joint template' }]; };
ctx.__mlsTplPrepFix = { healthOf: function () { return { cls: 'legacy', label: 'processed by an earlier AI pass' }; } };
ctx._opResolvePatient = function () { return { id: 'pid-1', name: 'Pat One' }; };
ctx.__mlsOpNoteFill = {
  installed: true,
  tick: function () { tickCalls++; },
  _verifiedHistoryVisits: function () { return [1, 2, 3]; }
};

vm.createContext(ctx);
vm.runInContext(room, ctx, { filename: 'feat_mls_opnote_room.js' });

assert(ctx.__mlsOpNoteRoom && ctx.__mlsOpNoteRoom.installed, 'room api did not install');
assert(/^opr-1\.\d+\.\d+$/.test(String(ctx.__mlsOpNoteRoom.version)), 'wrong room version installed');
assert(ctx.opPrepRender !== ORIG && ctx.opPrepRender.__oprWrap, 'opPrepRender was not wrapped');

ctx.opPrepRender();
assert.strictEqual(origCalls, 1, 'the wrap must call the base render through');
assert.strictEqual(tickCalls, 1, 'the wrap must kick the onf tick synchronously on every render');
assert(ids.oprRowNav.innerHTML.indexOf('Pat One') >= 0 && ids.oprRowNav.innerHTML.indexOf('Pat Two') >= 0,
  'patient nav did not build from the live rows');
assert(ids.oprTplRail.innerHTML.indexOf('SI joint template') >= 0 && ids.oprTplRail.innerHTML.indexOf('legacy') >= 0,
  'template rail did not build with owner-sourced health');
assert(ids.oprReceipt.textContent.indexOf('3 verified visits') >= 0,
  'context receipt must state the verified-visit count honestly');

/* second render is idempotent (no re-wrap, counts advance in lockstep) */
ctx.opPrepRender();
assert.strictEqual(origCalls, 2, 'second render lost the callthrough');
assert.strictEqual(tickCalls, 2, 'second render lost the kick');

/* revert restores the base render exactly */
ctx.__mlsOpNoteRoom.revert();
assert.strictEqual(ctx.opPrepRender, ORIG, 'revert did not restore the original opPrepRender');
assert.strictEqual(ids.oprRowNav.innerHTML, '', 'revert did not clear the nav rail');

console.log('PASS op-note room stage 2b: render wrap proven in vm (callthrough + synchronous onf kick + rails + honest receipt + clean revert), room writes stay in room-owned nodes, healthOf read through its owner');
