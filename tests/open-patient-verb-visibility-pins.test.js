'use strict';
/* pv7 reconciliation: the toolbar's open-patient verb and the selected-
 * patient history refresh are different actions. The former must never
 * disappear merely because the latter mounted; its scoped visibility owner
 * may hide it only for a real connection/recording/pull/identity refusal.
 * Every render state below therefore keeps the safe toolbar verb. The REAL ensureBar +
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
  /* state: { patient, cardVisible (null = no card), headPresent, headVisible (default true) } */
  const btn = element('button'); btn.id = 'ptPullAthenaBtn';
  btn.setAttribute('data-mls-open-patient-owner', 'feat-visits-v2');
  const card = state.cardVisible == null ? null : element('div');
  if (card) { card.id = 'profileCard'; card.offsetParent = state.cardVisible ? {} : null; }
  const head = state.headPresent ? element('div') : null;
  if (head) { head.className = 'mlsxh-head'; head.offsetParent = state.headVisible === false ? null : {}; }
  const byId = { ptPullAthenaBtn: btn };
  if (card) byId.profileCard = card;
  const doc = {
    getElementById: id => byId[id] || null,
    createElement: t => element(t),
    querySelector: sel => (sel.includes('mlsxh-head') || sel.includes('mlsvh-head')) ? head : null,
    head: element('head'), documentElement: element('html')
  };
  const win = { addEventListener() {}, pullPatientFromAthenaPrompt() {} };
  const make = new Function('document', 'window', 'activeP', 'setContextLabel', 'isFn', 'S', 'selectedHistoryRunning',
    src.slice(s1, e1) + '\n' + src.slice(s2, e2) +
    '\nreturn { ensureBar: ensureBar, sync: syncOpenPatientPullVisibility };');
  const api = make(doc, win, () => state.patient, () => {}, f => typeof f === 'function', v => String(v == null ? '' : v), () => false);
  return { api, btn, byId, doc };
}
/* The reconciled visibility owner deliberately never mutates inline display,
   hidden, or aria-hidden: it owns only this scoped attribute and its CSS. */
const verbVisible = btn => btn.hidden === false &&
  btn.style.getPropertyValue('display') !== 'none' &&
  btn.getAttribute('data-mls-open-patient-hidden') !== '1';

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

/* pv7-1.1.0 (Codex reply 39): a PRESENT but HIDDEN header is not a mounted
   replacement - the verb stays visible */
w = world({ patient: { id: 'p1' }, cardVisible: true, headPresent: true, headVisible: false });
w.api.ensureBar();
assert.ok(verbVisible(w.btn), 'reply-39 branch: a hidden enhanced header still hid the toolbar verb (zero-verb state)');
/* transition: the header becomes visible and mounts the selected-patient
   refresh, but the distinct open-patient verb remains available */
w.doc.querySelector('.mlsxh-head').offsetParent = {};
w.api.ensureBar();
assert.ok(verbVisible(w.btn), 'the distinct open-patient verb disappeared when the history header became visible');
/* and back: hidden again -> the verb restores */
w.doc.querySelector('.mlsxh-head').offsetParent = null;
w.api.ensureBar();
assert.ok(verbVisible(w.btn), 'the verb did not restore when the header hid again');

/* the selected-patient history action mounts without replacing the distinct
   "whoever is open in Athena" action */
w = world({ patient: { id: 'p1' }, cardVisible: true, headPresent: true });
w.api.ensureBar();
assert.ok(verbVisible(w.btn), 'the open-patient verb disappeared once the per-patient bar mounted');
assert.strictEqual(w.btn.getAttribute('data-mls-open-patient-hidden'), null, 'a safe selected-patient render received a false hide marker');

/* flip to a card-less render on the next pass: the verb comes BACK */
w.byId.profileCard.offsetParent = null;
w.api.ensureBar();
assert.ok(verbVisible(w.btn), 'the verb did not restore when the context lost its per-patient bar');

/* byte pins: every early return restores. The selected flag labels the safe
   state; it is not itself a reason to hide the distinct verb. */
const ensureSlice = src.slice(s2, e2);
assert.strictEqual(ensureSlice.split('syncOpenPatientPullVisibility(false); return;').length - 1, 2,
  'the two early returns (hidden card / missing header) no longer restore the verb');
assert.ok(/if \(!p\) \{ syncOpenPatientPullVisibility\(false\);/.test(ensureSlice),
  'the no-patient path no longer restores the verb');
assert.ok(ensureSlice.includes('if (!head || head.offsetParent === null) { syncOpenPatientPullVisibility(false); return; }'),
  'the pv7-1.1.0 header-visibility proof is gone (a hidden header would count as a mounted replacement again)');
const mountIdx = ensureSlice.indexOf('if (bar.parentNode !== head) {');
const syncIdx = ensureSlice.lastIndexOf('syncOpenPatientPullVisibility(true);');
assert.ok(syncIdx > mountIdx && mountIdx > 0, 'the post-mount visibility reconciliation moved before the bar mount');
assert.ok(!/^\s*syncOpenPatientPullVisibility\(!!p\);/m.test(ensureSlice), 'the unconditional pre-mount hide came back');

console.log('PASS open-patient verb visibility (reconciled): the toolbar open-patient action stays visible across missing/hidden/visible selected-profile states, including when the distinct per-patient history action mounts; only the scoped safety owner may hide it for a real refusal (real functions executed from shipped bytes)');
