'use strict';

/* The active-patient banner carries the PATIENT and nothing else.
 *
 * Owner, 2026-07-27, looking at the live bar: "I hate this banner... way too
 * complicated. I want it completely reworked with almost no buttons. Just
 * clicking on the patient's name takes you to the chart, and that's it. Every
 * feature there is almost completely useless except the recent feature."
 *
 * This is the SECOND time that bar has been trimmed. The 2026-07-23 pass cut it
 * to Chart + Switch patient, and by today it had re-grown After-visit summary,
 * Patient portal, "Not a patient?", the Athena status chip, a seen/remaining
 * counter, a next-appointment line, an appointment line inside the identity
 * block and a Today's-agenda chip — because roughly a dozen independent feature
 * modules mount themselves there by querying #mlsCtxBar and appending. Trimming
 * the markup alone does not hold; it only restarts the clock. So this test
 * guards the two things that make the rework permanent:
 *
 *   1. the bar renders ONE control (the identity block, which opens the chart);
 *   2. the CSS allowlist that renders any OTHER child — including one written
 *      next month by someone who never reads this file — invisible.
 *
 * Cascade note: those rules are asserted here as source, because this repo's
 * runtime tests use a hand-rolled DOM with no style engine. That they actually
 * WIN the cascade was verified in a real browser at 1280x800 against the 19
 * competing #mlsCtxBar rules extracted from feat_mls_redesign.js,
 * mls-connect.js, feat_mls_baricon.js and feat_mls_recentpts.js (8 of which set
 * `display`), loaded AFTER the banner's own sheet: 12 intruder chips hidden,
 * name + meta + Recent visible, 24/24.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');

/* ---------------------------------------------------------------- 1. markup */

const cardStart = html.indexOf('MLS Unified Patient Card');
assert(cardStart > 0, 'unified patient card module missing');
const cardEnd = html.indexOf('window.__mlsCtxBar = window.__mlsCard', cardStart);
assert(cardEnd > cardStart, 'unified patient card module end marker missing');
const card = html.slice(cardStart, cardEnd);

assert(!/class="mlsctx-actions"/.test(card), 'the banner action row is back — the bar must carry no button row');
assert(!/querySelector(All)?\(['"]\.mlsctx-actions/.test(card), 'the banner is looking for an action row again');
assert(!/data-act="switch"/.test(card), '"Switch patient" is back in the banner');
assert(!/>Chart</.test(card), 'a "Chart" button is back in the banner — the NAME is the chart link');
assert(/data-act="chart"/.test(card) && /class="mlsctx-id"/.test(card),
  'the identity block must still be the chart link');
assert(/role="button"/.test(card) && /tabindex="0"/.test(card),
  'the identity block must stay keyboard-reachable');

/* The meta line is identity only. A visit count / last-visit date meant reading
   the whole note store on every refresh to print something the chart holds. */
assert(!/visitStats/.test(card), 'the banner reads the note store again on every refresh');
assert(!/no visits/.test(card), 'visit-count text is back in the banner meta line');

/* The b439 self-heal watched for "fewer than five [data-act] controls" — a
   condition a two-control base could never satisfy, so every unrelated
   mutation of this bar bought a full whole-patient-store refresh() that then
   changed nothing. It must not come back with the action row gone. */
assert(!/new MutationObserver\(/.test(card), 'the banner arms a MutationObserver again');
assert(!/setInterval\(/.test(card), 'the banner arms a polling interval again');

/* The chart link must resolve the patient AT CLICK TIME. A quick-pick can
   change the active patient without re-rendering this bar; a captured id then
   opens the PREVIOUS patient's chart, which is the bug feat_mls_upnow_sync was
   written to intercept. */
assert(/function chartTarget\(\)\{ return activeId\(\) \|\| id; \}/.test(card),
  'the banner captured the patient id at render time again');
const upnow = fs.readFileSync(path.join(root, 'feat_mls_upnow_sync.js'), 'utf8');
assert(upnow.includes("t.closest('#mlsCtxBar [data-act=\"chart\"]')"),
  'the stale-closure interceptor still matches the deleted action row, so it guards nothing');

/* ------------------------------------------------------- 2. the allowlist */

const ALLOWLIST = [
  "body #'+BAR_ID+' > *:not(.mlsctx-id):not(#mlsRecentPts):not(.mlsctx-slot){display:none!important;}",
  "body #'+BAR_ID+' .mlsctx-id > *:not(.mlsctx-av):not(.mlsctx-idtext){display:none!important;}",
  "body #'+BAR_ID+' .mlsctx-idtext > *:not(.mlsctx-name):not(.mlsctx-meta){display:none!important;}"
];
for (const rule of ALLOWLIST) {
  assert(card.includes(rule),
    'banner allowlist rule missing — a later module can re-accrete into the bar:\n  ' + rule);
}

/* The eyebrow labelled the only thing in the bar. */
assert(card.includes(".mlsctx-idtext::before{content:none!important"),
  'the "ACTIVE PATIENT" eyebrow override is missing');

/* Athena: silent when healthy, LOUD when broken. A permanent green "extension
   ready" is the noise; a real failure is the difference between "the pull did
   nothing" and "I know why". */
assert(/\.mlsctx-slot\{display:none!important/.test(card),
  'the healthy Athena chip must be silent in the banner');
assert(/\.mlsctx-slot:has\(\.mls-sync-err\)\{display:flex!important/.test(card),
  'a FAILING Athena chip must still show in the banner');

/* Recent — the one feature the owner kept — must stay allowed AND placed. */
assert(card.includes("#mlsRecentPts{flex:0 0 auto;margin-left:auto;}"),
  'the Recent chip lost its place in the bar');

/* ------------------------------- 3. the modules stop mounting into the bar */

const EVICTED = {
  'feat_mls_dayprogress.js':       'seen/remaining + next-appointment meter',
  'feat_mls_agenda_popover.js':    "Today's agenda chip",
  'feat_mls_ptsnapshot.js':        'patient snapshot popover',
  'feat_mls_allergy_alert.js':     'allergy chip',
  'feat_mls_send_portal_invite.js':'patient portal button'
};
for (const [file, what] of Object.entries(EVICTED)) {
  const src = fs.readFileSync(path.join(root, file), 'utf8');
  assert(!/getElementById\((['"])mlsCtxBar\1\)/.test(src),
    file + ' mounts the ' + what + ' into the active-patient banner again');
  /* the legacy no-active-patient bar is deliberately UNCHANGED — that is where
     these chips still belong, and where the day still starts */
  assert(/getElementById\((['"])patientBar\1\)/.test(src),
    file + ' lost its legacy #patientBar mount — the chip is now homeless');
}

/* Two modules existed only to furnish the banner; they are off, not deleted,
   so re-enabling is one flag. Each was also burning a timer or observers
   forever to render something that is no longer there. */
const apptSrc = fs.readFileSync(path.join(root, 'feat_mls_ctx_appt.js'), 'utf8');
assert(/function start\(\) \{ if \(!window\.__MLS_CTX_APPT_ENABLED\) return;/.test(apptSrc),
  'the in-banner appointment line (and its 1200ms interval) is running again');
assert(/revert:/.test(apptSrc), 'feat_mls_ctx_appt lost its revert API');

const iconSrc = fs.readFileSync(path.join(root, 'feat_mls_baricon.js'), 'utf8');
assert(/if \(!window\.__MLS_BARICON_ENABLED\) return;/.test(iconSrc),
  'the action-row icon module boots again — it decorates buttons that no longer exist');

/* The settings panel must not describe a banner link that is gone. */
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');
assert(!/the patient banner shows a quiet/.test(connect),
  'Settings still tells the doctor to use a "Not a patient?" link the banner no longer shows');

/* ------------------------------------------------- 4. runtime: the one click */

let opened = null, view = null, noteReads = 0;

function makeEl(tag) {
  const el = {
    tagName: String(tag || 'div').toUpperCase(),
    id: '', className: '', style: {}, children: [], parentNode: null,
    _attrs: {}, _html: '', onclick: null, onkeydown: null,
    setAttribute(n, v) { this._attrs[n] = String(v); },
    getAttribute(n) { return this._attrs[n] == null ? null : this._attrs[n]; },
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
    insertBefore(c, ref) {
      c.parentNode = this;
      const i = this.children.indexOf(ref);
      if (i < 0) this.children.push(c); else this.children.splice(i, 0, c);
      return c;
    },
    remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(x => x !== this); },
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = String(v); this.children = parseHtml(String(v), this); },
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; },
    querySelectorAll(sel) {
      const out = [];
      (function walk(n) {
        for (const c of n.children) { if (matches(c, sel)) out.push(c); walk(c); }
      })(this);
      return out;
    },
    addEventListener() {}, removeEventListener() {},
    get parentElement() { return this.parentNode; },
    get nextSibling() {
      if (!this.parentNode) return null;
      const i = this.parentNode.children.indexOf(this);
      return (i >= 0 && i + 1 < this.parentNode.children.length) ? this.parentNode.children[i + 1] : null;
    }
  };
  return el;
}

/* Only rich enough for the selectors this module actually uses. */
function matches(el, sel) {
  return String(sel).split(',').map(s => s.trim()).some(one => {
    const attr = one.match(/^(\S*?)\[([^\]]+)\]$/);
    if (attr) {
      const [, head, cond] = attr;
      const kv = cond.match(/^([\w-]+)="?([^"]*)"?$/);
      if (kv && el.getAttribute(kv[1]) !== kv[2]) return false;
      return head ? matches(el, head) : true;
    }
    if (one.startsWith('#')) return el.id === one.slice(1);
    if (one.startsWith('.')) return String(el.className).split(/\s+/).includes(one.slice(1));
    return el.tagName === one.toUpperCase();
  });
}

/* The module writes its subtree as an HTML string; parse just enough of it. */
function parseHtml(str, parent) {
  const out = [];
  const stack = [];
  const re = /<(\/?)(\w+)([^>]*)>|([^<]+)/g;
  let m;
  while ((m = re.exec(str))) {
    if (m[4] != null) { const t = stack[stack.length - 1]; if (t) t.textContent = (t.textContent || '') + m[4]; continue; }
    if (m[1]) { stack.pop(); continue; }
    const el = makeEl(m[2]);
    el.textContent = '';
    const attrs = m[3] || '';
    let a; const are = /([\w-]+)="([^"]*)"/g;
    while ((a = are.exec(attrs))) {
      if (a[1] === 'id') el.id = a[2];
      else if (a[1] === 'class') el.className = a[2];
      else el.setAttribute(a[1], a[2]);
    }
    const top = stack[stack.length - 1];
    if (top) { el.parentNode = top; top.children.push(el); } else { el.parentNode = parent; out.push(el); }
    if (!/\/>$/.test(m[0])) stack.push(el);
  }
  return out;
}

const byId = {};
const nav = makeEl('div'); nav.className = 'mainnav';
const navParent = makeEl('div'); navParent.appendChild(nav);

global.window = {
  activePatient: () => ({ id: 'p1', name: 'Bernard P Brooks', dob: '1951-06-13', sex: 'M', mrn: '8292441' }),
  getActivePtId: () => 'p1',
  findPatient: () => global.window.activePatient(),
  patientNotes: () => { noteReads++; return []; },
  openPatient: (id) => { opened = id; },
  showView: (v) => { view = v; },
  addEventListener() {}, setTimeout, clearTimeout, setInterval, clearInterval
};
global.document = {
  readyState: 'complete',
  head: makeEl('head'),
  documentElement: makeEl('html'),
  body: { classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); } } },
  getElementById: (id) => byId[id] || null,
  querySelector: (sel) => (sel === '.mainnav' ? nav : null),
  createElement: (t) => {
    const el = makeEl(t);
    Object.defineProperty(el, 'id', {
      get() { return this._id || ''; },
      set(v) { this._id = v; byId[v] = this; }
    });
    return el;
  },
  addEventListener() {}
};

const iifeStart = html.indexOf('(function(){', cardStart);
assert(iifeStart > cardStart && iifeStart < cardEnd, 'could not locate the card IIFE');
new Function(html.slice(iifeStart, cardEnd) + 'window.__mlsCtxBar = window.__mlsCard;\n})();')();

const bar = byId['mlsCtxBar'];
assert(bar, 'the banner did not mount');

const idBlock = bar.querySelector('.mlsctx-id');
assert(idBlock, 'identity block missing');
assert.strictEqual(bar.querySelector('.mlsctx-actions'), null, 'an action row rendered');
assert.strictEqual(bar.querySelectorAll('button').length, 0, 'the banner rendered a button');

assert.strictEqual(bar.querySelector('.mlsctx-name').textContent, 'Bernard P Brooks');
assert(/^\d{1,3}y M {2}· {2}DOB 06-13-1951 {2}· {2}MRN 8292441$/
  .test(bar.querySelector('.mlsctx-meta').textContent),
  'meta line must be identity only — age/sex, DOB, MRN — got: ' +
  JSON.stringify(bar.querySelector('.mlsctx-meta').textContent));

idBlock.onclick();
assert.strictEqual(opened, 'p1', 'clicking the patient name must open their chart');
assert.strictEqual(view, 'patients', 'opening the chart must land on the chart view');

opened = null;
idBlock.onkeydown({ key: 'Enter', preventDefault() {} });
assert.strictEqual(opened, 'p1', 'Enter on the patient name must open their chart');

/* A quick-pick changes the active patient WITHOUT re-rendering this bar. The
   name must follow the app's source of truth, not the id it was drawn with. */
opened = null;
global.window.getActivePtId = () => 'p2';
idBlock.onclick();
assert.strictEqual(opened, 'p2',
  'the patient name opened a stale chart after the active patient changed');
global.window.getActivePtId = () => 'p1';

/* A foreign chip (this is how Recent lives here) must survive a refresh: the
   rebuild is memoised on the rendered FACTS, never on a control count. */
const foreign = document.createElement('span');
foreign.id = 'mlsRecentPts';
bar.appendChild(foreign);
const readsBefore = noteReads;
global.window.__mlsCard.refresh();
global.window.__mlsCard.refresh();
assert(bar.children.indexOf(foreign) >= 0, 'refresh tore the Recent chip out of the banner');
assert.strictEqual(noteReads, readsBefore, 'the banner read the note store on refresh');

console.log('PASS patient banner: one control (the name opens the chart), a three-level allowlist that hides every other chip however it mounts, Athena silent unless failing, and five evicted modules keeping only their legacy bar');
