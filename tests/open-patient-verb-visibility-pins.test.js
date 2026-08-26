'use strict';
/* pv7-1.0.0 regression (owner defect #7, matrix 2026-08-26): with a patient
 * selected, the visits lane used to hide the toolbar's open-patient pull verb
 * (#ptPullAthenaBtn) BEFORE proving its per-patient replacement bar could
 * mount - renders without a visible profile card (the Patients view with
 * visits selected) were left with ZERO one-click pull verbs. The verb now
 * hides only at the end of a pass that actually mounted the bar in a visible
 * context, and every early return restores it. The REAL ensureBar +
 * syncOpenPatientPullVisibility are sliced from the shipped bytes and
 * executed against controllable DOM states. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(path.resolve(__dirname, '..'), 'feat_visits.js'), 'utf8');
const s1 = src.indexOf('  function historyHeader() {');
const e1 = src.indexOf('  function setContextLabel(bar, p) {', s1);
const s2 = src.indexOf('  function ensureBar() {', e1);
const e2 = src.indexOf('  function start() {', s2);
assert.ok(s1 > 0 && e1 > s1 && s2 > e1 && e2 > s2, 'the visits verb-visibility functions moved');

function element(tag) {
  const attrs = {}, styleProps = {}, kids = [];
  const el = {
    tagName: tag, id: '', className: '', hidden: false, textContent: '', offsetParent: {},
    parentNode: null, nextSibling: null,
    style: {
      getPropertyValue: k => styleProps[k] ? styleProps[k].v : '',
      getPropertyPriority: k => styleProps[k] ? styleProps[k].p : '',
      setProperty: (k, v, p) => { styleProps[k] = { v, p: p || '' }; },
      removeProperty: k => { delete styleProps[k]; }
    },
    setAttribute(k, v) { attrs[k] = String(v); },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(attrs, k) ? attrs[k] : null; },
    removeAttribute(k) { delete attrs[k]; },
    appendChild(c) { kids.push(c); c.parentNode = el; return c; },
    insertBefore(c, ref) { kids.splice(Math.max(0, kids.indexOf(ref)), 0, c); c.parentNode = el; return c; },
    remove() { el.removed = true; },
    addEventListener() {},
    querySelector(sel) {
      const classes = sel.split(',').map(x => x.trim().replace(/^\./, ''));
      const find = n => {
        for (const k of n.kids || []) {
          if (classes.some(c => String(k.className || '').includes(c))) return k;
          const deep = find(k); if (deep) return deep;
        }
        return null;
      };
      return find({ kids });
    },
    kids
  };
  return el;
}

function world(state) {
  /* state: { patient, cardVisible (null = no card), headPresent } */
  const btn = element('button'); btn.id = 'ptPullAthenaBtn';
  const card = state.cardVisible == null ? null : element('div');
  if (card) { card.id = 'profileCard'; card.offsetParent = state.cardVisible ? {} : null; }
  const head = state.headPresent ? element('div') : null;
  if (head) head.className = 'mlsxh-head';
  const byId = { ptPullAthenaBtn: btn };
  if (card) byId.profileCard = card;
  const doc = {
    getElementById: id => byId[id] || null,
    createElement: t => element(t),
    querySelector: sel => (sel.includes('mlsxh-head') || sel.includes('mlsvh-head')) ? head : null,
    head: element('head'), documentElement: element('html')
  };
  const win = { addEventListener() {} };
  const make = new Function('document', 'window', 'activeP', 'setContextLabel', 'isFn', 'S',
    src.slice(s1, e1) + '\n' + src.slice(s2, e2) +
    '\nreturn { ensureBar: ensureBar, sync: syncOpenPatientPullVisibility };');
  const api = make(doc, win, () => state.patient, () => {}, f => typeof f === 'function', v => String(v == null ? '' : v));
  return { api, btn, byId, doc };
}
const verbVisible = btn => btn.hidden === false && btn.style.getPropertyValue('display') !== 'none';

/* no patient: verb visible, no bar */
let w = world({ patient: null, cardVisible: true, headPresent: true });
w.api.ensureBar();
assert.ok(verbVisible(w.btn), 'the verb hid with no patient selected');

/* THE DEFECT: patient active but NO profile card in this render - the verb
   must stay visible (there is no replacement in this context) */
w = world({ patient: { id: 'p1' }, cardVisible: null, headPresent: false });
w.api.ensureBar();
assert.ok(verbVisible(w.btn), 'defect #7: patient selected with no profile card left zero pull verbs');

/* hidden profile card: same rule */
w = world({ patient: { id: 'p1' }, cardVisible: false, headPresent: true });
w.api.ensureBar();
assert.ok(verbVisible(w.btn), 'a hidden profile card still hid the toolbar verb');

/* card visible but the history header absent: same rule */
w = world({ patient: { id: 'p1' }, cardVisible: true, headPresent: false });
w.api.ensureBar();
assert.ok(verbVisible(w.btn), 'a missing history header still hid the toolbar verb');

/* the replacement mounts: NOW the verb stands down */
w = world({ patient: { id: 'p1' }, cardVisible: true, headPresent: true });
w.api.ensureBar();
assert.ok(!verbVisible(w.btn), 'the verb did not hide once the per-patient bar mounted');
assert.strictEqual(w.btn.getAttribute('data-mls-visits-selected-hide'), '1', 'the hide is not owner-marked');

/* flip to a card-less render on the next pass: the verb comes BACK */
w.byId.profileCard.offsetParent = null;
w.api.ensureBar();
assert.ok(verbVisible(w.btn), 'the verb did not restore when the context lost its per-patient bar');

/* byte pins: every early return restores; the hide runs only after the mount */
const ensureSlice = src.slice(s2, e2);
assert.strictEqual(ensureSlice.split('syncOpenPatientPullVisibility(false); return;').length - 1, 2,
  'the two early returns (hidden card / missing header) no longer restore the verb');
assert.ok(/if \(!p\) \{ syncOpenPatientPullVisibility\(false\);/.test(ensureSlice),
  'the no-patient path no longer restores the verb');
const hideIdx = ensureSlice.lastIndexOf('syncOpenPatientPullVisibility(true);');
const mountIdx = ensureSlice.indexOf('if (bar.parentNode !== head) {');
assert.ok(hideIdx > mountIdx && mountIdx > 0, 'the hide no longer waits for the bar mount');
assert.ok(!/^\s*syncOpenPatientPullVisibility\(!!p\);/m.test(ensureSlice), 'the unconditional pre-mount hide came back');

console.log('PASS open-patient verb visibility (pv7-1.0.0): the toolbar pull verb stays visible whenever the per-patient bar cannot mount (no/hidden card, missing header), hides only after the replacement is provably in the same context, and restores on the next pass when the context changes (real functions executed from shipped bytes)');
