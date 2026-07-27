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
assert(room.includes("var VERSION = 'opr-1.3.0';"), 'room module is not opr-1.3.0');
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

/* revert: functions restored, modal back in its original slot */
ctx.__mlsOpNoteRoom.revert();
assert.strictEqual(ctx.openTemplates, OT, 'revert did not restore openTemplates');
assert.strictEqual(ctx.closeTemplates, CT, 'revert did not restore closeTemplates');
assert.strictEqual(ids.templatesModal.parentElement, BODY, 'revert did not return #templatesModal to its original parent');

console.log('PASS op-note room stage 3: Templates joins the room - reparent on first open, room auto-opens, tabs follow open/close, satellites keep their node, clean revert - all proven in vm');
