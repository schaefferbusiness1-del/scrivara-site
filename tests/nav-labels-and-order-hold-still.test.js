'use strict';
/*
 * The primary nav must hold still.
 *
 * MEASURED on a signed-in, completely idle app (headless Chrome, 20s window,
 * sampled 5x/sec) BEFORE this fix:
 *
 *   nav_visit     26 flips   "Today"      <-> "🎙️ Today"
 *   nav_patients  26 flips   "Patients 0" <-> "👥 Patients 0"
 *   nav_calendar  26 flips   "Calendar"   <-> "📅 Calendar"
 *   nav_studio    26 flips   "✦ Tools"    <-> "✨ Tools"
 *   child order   22 flips   between exactly two orders
 *
 * ~1.3Hz, forever, with nobody touching the machine. The emoji changes each
 * label's width, so the whole nav row re-laid out on every flip — visible
 * jitter, and a tab that can move out from under the cursor between aiming and
 * pressing. Node moves additionally kill :hover, drop keyboard focus inside the
 * rail, and restart every tab's CSS transition. AFTER: 0 and 0.
 *
 * Two owners, opposite goals, each watching a document-wide subtree the other
 * writes into. Neither had a fixpoint, and each module's own "did it change?"
 * guard was useless — the value genuinely differed every pass, because the
 * other module had just changed it. That is why the executable half of this
 * suite checks CONVERGENCE rather than any single label value: a guard cannot
 * detect this class of bug, only a fixpoint can.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const header = fs.readFileSync(path.join(root, 'feat_mls_header_exact.js'), 'utf8');
const redesign = fs.readFileSync(path.join(root, 'feat_mls_redesign.js'), 'utf8');
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');

const PRIMARY = ['nav_visit', 'nav_patients', 'nav_calendar', 'nav_studio'];

/* ---------- 1. Ownership: one module writes the four lead labels ---------- */

assert(/var PRIMARY_NAV\s*=\s*\[/.test(redesign),
  'feat_mls_redesign.js lost PRIMARY_NAV — the label authority this suite depends on');
for (const id of PRIMARY) {
  assert(new RegExp("id:'" + id + "'").test(redesign),
    `feat_mls_redesign.js no longer claims ${id} in PRIMARY_NAV`);
}

const ownedDecl = /REDESIGN_OWNED_LABELS\s*=\s*\{([^}]*)\}/.exec(header);
assert(ownedDecl,
  'feat_mls_header_exact.js lost REDESIGN_OWNED_LABELS: it can relabel the tabs redesign owns again');
for (const id of PRIMARY) {
  assert(new RegExp('\\b' + id + '\\s*:').test(ownedDecl[1]),
    `feat_mls_header_exact.js does not yield ${id} to feat_mls_redesign.js — the relabel war is back`);
}
assert(/if \(REDESIGN_OWNED_LABELS\[id\]\) return;/.test(header),
  'feat_mls_header_exact.js declares the owned set but no longer skips it in relabelAll()');

/* ---------- 2. Order: one module decides where the tabs sit -------------- */

assert(!/getElementById\('nav_analysis'\);[\s\S]{0,240}?insertBefore\(a, s\)/.test(connect),
  "mls-connect.js reorders nav_analysis before nav_studio again — that fights feat_mls_redesign's PRIMARY_NAV ordering on a permanent 900ms interval");
assert(/FOLDED_NAV=\[[^\]]*'nav_analysis'/.test(redesign),
  'nav_analysis left FOLDED_NAV, so the argument this fix rests on (it is display:none, so the reorder moved nothing visible) no longer holds — re-derive it before deleting the assertion above');

/* ---------- 3. Convergence, by execution --------------------------------- */
/* A minimal DOM carrying only what the two label writers actually touch, and
   both REAL function bodies lifted out of the shipped sources. */

function braceMatched(source, signature, label) {
  const at = source.indexOf(signature);
  assert(at >= 0, `could not find ${label} in its source — this suite is checking something that moved`);
  let depth = 0, end = -1;
  for (let j = source.indexOf('{', at); j < source.length; j++) {
    if (source[j] === '{') depth++;
    else if (source[j] === '}') { depth--; if (depth === 0) { end = j + 1; break; } }
  }
  assert(end > 0, `could not brace-match ${label}`);
  return source.slice(at, end);
}

function makeTab(id, initialText) {
  const node = {
    nodeType: 3, data: initialText,
    get textContent() { return this.data; },
    set textContent(v) { this.data = v; },
  };
  return {
    id, childNodes: [node], attrs: {},
    get firstChild() { return this.childNodes[0]; },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    hasAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k); },
    insertBefore(n, ref) { this.childNodes.splice(this.childNodes.indexOf(ref), 0, n); return n; },
    text() { return this.childNodes.filter((n) => n.nodeType === 3).map((n) => n.data).join(''); },
  };
}

/* The shipped starting labels, emoji and all. nav_help is the control: it is
   NOT in PRIMARY_NAV, so header_exact must still normalise it. */
const START = {
  nav_visit: '🎙️ Today ',
  nav_patients: '👥 Patients ',
  nav_calendar: '📅 Calendar ',
  nav_studio: '✨ Tools ',
  nav_help: '❓ Help ',
};
const REDESIGN_LABELS = { nav_visit: 'Today', nav_patients: 'Patients', nav_calendar: 'Calendar', nav_studio: 'Tools' };
const OWNED = new Set(PRIMARY);

const tabs = {};
for (const [id, text] of Object.entries(START)) tabs[id] = makeTab(id, text);

const sandbox = {
  document: {
    getElementById: (id) => tabs[id] || null,
    createTextNode: (d) => ({ nodeType: 3, data: d, get textContent() { return this.data; }, set textContent(v) { this.data = v; } }),
  },
  $: (id) => tabs[id] || null,
  console,
};
vm.createContext(sandbox);
vm.runInContext([
  braceMatched(header, 'function relabel(id, studioStar)', 'feat_mls_header_exact relabel()'),
  braceMatched(redesign, 'function navDirectText(tab)', 'feat_mls_redesign navDirectText()'),
  braceMatched(redesign, 'function setClinicianNavLabel(tab,label)', 'feat_mls_redesign setClinicianNavLabel()'),
].join('\n'), sandbox, { filename: 'nav-label-writers.js' });

/* Redesign's pass, then header_exact's pass — the order they really run in,
   with header_exact skipping the owned ids exactly as relabelAll() now does. */
function onePass() {
  for (const [id, label] of Object.entries(REDESIGN_LABELS)) sandbox.setClinicianNavLabel(tabs[id], label);
  for (const id of Object.keys(START)) { if (!OWNED.has(id)) sandbox.relabel(id, false); }
}

onePass();
const settled = Object.fromEntries(Object.keys(START).map((id) => [id, tabs[id].text()]));
for (let pass = 2; pass <= 9; pass++) {
  onePass();
  for (const id of Object.keys(START)) {
    assert.strictEqual(tabs[id].text(), settled[id],
      `${id} did not reach a fixpoint: pass ${pass} produced ${JSON.stringify(tabs[id].text())} where pass 1 produced ${JSON.stringify(settled[id])}. Two owners are writing this label again — that is the ~1.3Hz flicker this suite exists to prevent.`);
  }
}

/* The surviving value must be the authority's, not a stripped one — otherwise
   the loser of the old war has quietly become the permanent winner. */
for (const id of PRIMARY) {
  assert(/[^\x00-\x7F]/.test(settled[id]),
    `${id} settled on ${JSON.stringify(settled[id])} — the icon prefix feat_mls_redesign restores was stripped`);
}
assert.strictEqual(settled.nav_help, 'Help ',
  `nav_help should still be de-emojified by feat_mls_header_exact, got ${JSON.stringify(settled.nav_help)}`);

/* ---------- 4. The detector must be able to see the bug ------------------ */
/* A convergence check that cannot fail proves nothing. Reproduce the ORIGINAL
   configuration in the sandbox — both writers on the same label — and require
   that it diverges. If this ever stops diverging, the harness above has gone
   blind and its green tick is worthless. */
const control = { nav_visit: makeTab('nav_visit', '🎙️ Today ') };
const controlSandbox = {
  document: {
    getElementById: (id) => control[id] || null,
    createTextNode: (d) => ({ nodeType: 3, data: d, get textContent() { return this.data; }, set textContent(v) { this.data = v; } }),
  },
  $: (id) => control[id] || null,
  console,
};
vm.createContext(controlSandbox);
vm.runInContext([
  braceMatched(header, 'function relabel(id, studioStar)', 'relabel (control)'),
  braceMatched(redesign, 'function navDirectText(tab)', 'navDirectText (control)'),
  braceMatched(redesign, 'function setClinicianNavLabel(tab,label)', 'setClinicianNavLabel (control)'),
].join('\n'), controlSandbox, { filename: 'nav-label-writers-control.js' });

const controlSeen = new Set();
for (let i = 0; i < 6; i++) {
  controlSandbox.setClinicianNavLabel(control.nav_visit, 'Today');
  controlSeen.add(control.nav_visit.text());
  controlSandbox.relabel('nav_visit', false);      // the pass this fix removed
  controlSeen.add(control.nav_visit.text());
}
assert(controlSeen.size > 1,
  `the control did NOT diverge (${JSON.stringify([...controlSeen])}), so the convergence check above can no longer detect two writers fighting over a label — fix the harness before trusting it`);

console.log(`PASS nav holds still: the 4 lead labels have one owner, the order has one owner, 9 alternating passes of both real label writers reach a fixpoint, and the control configuration still oscillates across ${controlSeen.size} forms so the detector is proven awake (was 26 label flips + 22 order flips per 20 idle seconds)`);
