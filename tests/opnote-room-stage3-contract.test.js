'use strict';

/* WORKROOM STAGE 3 (opr-1.3.0) - Templates lives IN the room.
 *
 * #templatesModal reparents WHOLE into #oprPanelTpls on first open. Its id,
 * every inner id (tplName/tplText/tplSearch/tplList - the E2E drives the real
 * form by these), its own .show lifecycle, and every satellite that reaches
 * into it (tpf health panel, stdline section, onf upload wiring) all keep
 * working on the same node. openTemplates/closeTemplates are wrapped
 * OUTERMOST (this module loads idle-deferred, after every other wrapper):
 * opening embeds + opens the room when closed + fronts the Templates tab;
 * closing returns to Procedures. Proven by RUNNING the module in a vm -
 * source pins alone are not proof (b718's law). */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');
const room = fs.readFileSync(path.join(root, 'feat_mls_opnote_room.js'), 'utf8');
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');

/* ---- source pins ------------------------------------------------------- */
assert(/var VERSION = 'opr-\d+\.\d+\.\d+';/.test(room), 'room module lost its version line');
assert(room.includes('if (shown($(\'templatesModal\')) && safe(function () { return $(\'templatesModal\').parentElement !== $(\'oprPanelTpls\'); }, false)) {'),
  'the module must ADOPT a floating Templates modal that opened before it landed (the half-screen report)');
assert(app.includes('<section id="oprPanelTpls"></section>'), 'the Templates tab panel is missing from the room markup');
assert(app.includes('#oprPanelTpls #templatesModal{ position:static;'), 'embedded presentation must neutralize the floating-modal chrome');
assert(app.includes('#oprPanelTpls #templatesModal.show{ display:block; }'), "the modal's own .show lifecycle must stay the visibility gate when embedded");
assert(app.includes('#oprPanelTpls #templatesModal .modal-x{ display:none; }'), 'the embedded modal must not show a second close X inside the room');
assert(room.includes('w.__oprTplWrap = true; w.__oprTplOrig = o;'), 'openTemplates wrap is not marked idempotent/revertible');
assert(connect.includes('it opens as the Templates tab of the op-note room'), 'the feature directory must teach where Templates actually lives now');

/* ---- runtime: run the module against a stub page ----------------------- */
function stubNode(id) {
  var n = {
    id: id, innerHTML: '', textContent: '', style: {}, _cls: {},
    parentElement: null, nextSibling: null,
    querySelectorAll: function () { return []; },
    onclick: null,
    getAttribute: function () { return null; },
    setAttribute: function () {},
    scrollIntoView: function () {},
    appendChild: function (child) { child.parentElement = n; return child; },
    insertBefore: function (child) { child.parentElement = n; return child; }
  };
  n.classList = {
    add: function (c) { n._cls[c] = 1; },
    remove: function (c) { delete n._cls[c]; },
    contains: function (c) { return !!n._cls[c]; },
    toggle: function (c, on) { if (on === undefined) on = !n._cls[c]; if (on) n._cls[c] = 1; else delete n._cls[c]; return !!on; }
  };
  return n;
}
const ids = {};
['opPrepModal', 'templatesModal', 'oprRowNav', 'oprTplRail', 'oprReceipt', 'opPrepList',
  'oprPanelProcs', 'oprPanelTpls', 'oprTabProcs', 'oprTabTpls'].forEach(function (id) { ids[id] = stubNode(id); });
const BODY = stubNode('body');
BODY.appendChild(ids.templatesModal);

let baseOpen = 0, baseClose = 0, roomOpened = 0;
const ctx = { document: { getElementById: function (id) { return ids[id] || null; }, visibilityState: 'hidden' }, console: console };
ctx.window = ctx;
ctx.addEventListener = function () {}; ctx.removeEventListener = function () {};
ctx.opPrepRender = function () {};
ctx.openTemplates = function () { baseOpen++; ids.templatesModal.classList.add('show'); };
ctx.closeTemplates = function () { baseClose++; ids.templatesModal.classList.remove('show'); };
const OT = ctx.openTemplates, CT = ctx.closeTemplates;
ctx.openOpPrepSmart = function () { roomOpened++; ids.opPrepModal.classList.add('show'); };
ctx._opPrep = [];
ctx.getTemplates = function () { return []; };

vm.createContext(ctx);
vm.runInContext(room, ctx, { filename: 'feat_mls_opnote_room.js' });

assert(ctx.openTemplates !== OT && ctx.openTemplates.__oprTplWrap, 'openTemplates was not wrapped');
assert(ctx.closeTemplates !== CT && ctx.closeTemplates.__oprTplWrap, 'closeTemplates was not wrapped');

/* open from OUTSIDE the room: embeds, opens the room, calls base, fronts tab */
ctx.openTemplates();
assert.strictEqual(roomOpened, 1, 'opening Templates with the room closed must open the room');
assert.strictEqual(baseOpen, 1, 'the base opener must still run (checkboxes + list render + show)');
assert.strictEqual(ids.templatesModal.parentElement, ids.oprPanelTpls, '#templatesModal must reparent into the Templates panel');
assert(ids.oprPanelTpls.classList.contains('on'), 'Templates panel must front');
assert.strictEqual(ids.oprPanelProcs.style.display, 'none', 'Procedures panel must step back');
assert(ids.oprTabTpls.classList.contains('on') && !ids.oprTabProcs.classList.contains('on'), 'tab states must follow');

/* close: base runs, Procedures returns */
ctx.closeTemplates();
assert.strictEqual(baseClose, 1, 'the base closer must still run');
assert(!ids.oprPanelTpls.classList.contains('on'), 'Templates panel must step back on close');
assert.strictEqual(ids.oprPanelProcs.style.display, '', 'Procedures panel must return on close');

/* reopen with the room ALREADY open: no second room-open call */
ctx.openTemplates();
assert.strictEqual(roomOpened, 1, 'an open room must not be re-opened');
assert.strictEqual(baseOpen, 2, 'the base opener runs on every open');
ctx.closeTemplates();

/* opr-1.4.1: a PROCEDURE door always lands on Procedures - even if a prior
 * Back-exit left the Templates modal 'show' inside the closed room. */
ctx.openTemplates();                                     /* templates open in the room */
assert(ids.templatesModal.classList.contains('show'));
const OPS = ctx.openOpPrepSmart;
assert(OPS.__oprProcWrap, 'the procedure openers were not wrapped');
ctx.openOpPrepSmart();                                   /* the drafter door */
assert(!ids.templatesModal.classList.contains('show') && !ids.oprPanelTpls.classList.contains('on'),
  'openOpPrepSmart must land on Procedures, not on a leftover Templates tab');

/* revert: functions restored, modal back in its original slot */
ctx.__mlsOpNoteRoom.revert();
assert.strictEqual(ctx.openTemplates, OT, 'revert did not restore openTemplates');
assert.strictEqual(ctx.closeTemplates, CT, 'revert did not restore closeTemplates');
assert(!ctx.openOpPrepSmart.__oprProcWrap, 'revert did not restore the procedure openers');
assert.strictEqual(ids.templatesModal.parentElement, BODY, 'revert did not return #templatesModal to its original parent');

/* ---- b726: a floating Templates modal open BEFORE the module lands is
 * ADOPTED at boot - embedded, room opened, tab fronted (the owner's
 * "half the screen" report was the unwrapped 960px modal). Fresh context. */
const ids2 = {};
['opPrepModal', 'templatesModal', 'oprRowNav', 'oprTplRail', 'oprReceipt', 'opPrepList',
  'oprPanelProcs', 'oprPanelTpls', 'oprTabProcs', 'oprTabTpls'].forEach(function (id) { ids2[id] = stubNode(id); });
const BODY2 = stubNode('body');
BODY2.appendChild(ids2.templatesModal);
ids2.templatesModal.classList.add('show');            /* the doctor is IN the floating modal */
let roomOpened2 = 0;
const ctx2 = { document: { getElementById: function (id) { return ids2[id] || null; }, visibilityState: 'hidden' }, console: console };
ctx2.window = ctx2;
ctx2.addEventListener = function () {}; ctx2.removeEventListener = function () {};
ctx2.opPrepRender = function () {};
ctx2.openTemplates = function () { ids2.templatesModal.classList.add('show'); };
ctx2.closeTemplates = function () { ids2.templatesModal.classList.remove('show'); };
ctx2.openOpPrepSmart = function () { roomOpened2++; ids2.opPrepModal.classList.add('show'); };
ctx2._opPrep = []; ctx2.getTemplates = function () { return []; };
vm.createContext(ctx2);
vm.runInContext(room, ctx2, { filename: 'feat_mls_opnote_room.js' });
assert.strictEqual(ids2.templatesModal.parentElement, ids2.oprPanelTpls, 'boot must adopt (embed) an already-open floating Templates modal');
assert.strictEqual(roomOpened2, 1, 'boot adoption must open the room around the modal');
assert(ids2.oprPanelTpls.classList.contains('on'), 'boot adoption must front the Templates tab');

/* ---- opr-1.5.0: a posture where the room REFUSES to open (the read-only
 * preview workspace) must fall back to the classic floating modal - never a
 * shown-but-invisible modal inside a closed room (the owner's silent no-op). */
const ids3 = {};
['opPrepModal', 'templatesModal', 'oprRowNav', 'oprTplRail', 'oprReceipt', 'opPrepList',
  'oprPanelProcs', 'oprPanelTpls', 'oprTabProcs', 'oprTabTpls'].forEach(function (id) { ids3[id] = stubNode(id); });
const BODY3 = stubNode('body');
BODY3.appendChild(ids3.templatesModal);
const ctx3 = { document: { getElementById: function (id) { return ids3[id] || null; }, visibilityState: 'hidden' }, console: console };
ctx3.window = ctx3;
ctx3.addEventListener = function () {}; ctx3.removeEventListener = function () {};
ctx3.opPrepRender = function () {};
ctx3.openTemplates = function () { ids3.templatesModal.classList.add('show'); };
ctx3.closeTemplates = function () { ids3.templatesModal.classList.remove('show'); };
ctx3.openOpPrepSmart = function () { /* the preview posture: the room REFUSES */ };
ctx3._opPrep = []; ctx3.getTemplates = function () { return []; };
vm.createContext(ctx3);
vm.runInContext(room, ctx3, { filename: 'feat_mls_opnote_room.js' });
ctx3.openTemplates();
assert(ids3.templatesModal.classList.contains('show'), 'the modal must still SHOW when the room refuses');
assert.strictEqual(ids3.templatesModal.parentElement, BODY3,
  'a refusing room must hand the modal BACK to its floating home - shown-but-invisible is the silent no-op');
assert(!ids3.oprPanelTpls.classList.contains('on'), 'no tab may front on a closed room');

console.log('PASS op-note room stage 3: Templates joins the room - reparent on first open, room auto-opens, tabs follow open/close, floating modal adopted at boot, a refusing room falls back to the classic modal, satellites keep their node, clean revert - all proven in vm');
