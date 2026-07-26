'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const redesign = fs.readFileSync(path.join(root, 'feat_mls_redesign.js'), 'utf8');
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');
const topbar = fs.readFileSync(path.join(root, 'feat_mls_topbar_unify.js'), 'utf8');

function between(source, start, end) {
  const at = source.indexOf(start);
  assert(at >= 0, `missing ${start}`);
  const stop = source.indexOf(end, at + start.length);
  assert(stop > at, `missing ${end}`);
  return source.slice(at, stop);
}

const navigation = between(
  redesign,
  "  /* Keep the clinician's repeat-every-visit destinations together",
  '  function syncTitle(){'
);

/* Pin updated 2026-07-24 (owner /goal UI rework): History leaves the rail —
   nav_history is FOLDED (hidden, still routable) and its list stays reachable
   via Today's "View completed notes", patient charts, and the command palette.

   PIN UPDATED AGAIN 2026-07-26, deliberately. Owner's order, verbatim:
   "add the analysis tab to the ai studio tab smartly".

   Analysis is no longer a destination. feat_mls_studio_merge.js (sm-1.0.0)
   makes it AI Studio's "Practice" section and redirects showView('analysis')
   there, so a rail tab labelled "Practice" beside one labelled "Tools", both
   landing on the same screen, is two routes to one place — the duplication the
   whole rebuild exists to remove. FOUR lead routes now; nav_analysis joins
   nav_history in FOLDED_NAV.

   It is folded, NOT dropped, and three routes to it survive and are asserted
   further down and in tests/studio-merge-keeps-every-route.test.js:
     - showView('analysis') from anywhere (rail tab, command palette, the
       Copilot's action router, voice, a custom tool's navigate action)
     - the Calm Shell's Tools menu, as "Practice trends (AI Studio)"
     - the AI Studio section switcher itself */
assert(/PRIMARY_NAV\s*=\s*\[\s*\{id:'nav_visit',label:'Today'\},\s*\{id:'nav_patients',label:'Patients'\},\s*\{id:'nav_calendar',label:'Calendar'\},\s*\{id:'nav_studio',label:'Tools'\}/.test(navigation),
  'clinician lead routes lost their exact order or labels');
assert(/FOLDED_NAV=\['nav_history','nav_analysis'\]/.test(navigation),
  'History and Analysis must be deliberately folded, not accidentally dropped');
assert(/data-mlsrd-folded/.test(redesign),
  'folded rail tabs must be marked so the fold is inspectable');
assert(!/id:'nav_orders',label:'Tasks'|label:'Tasks'/.test(navigation),
  'Orders was relabelled as a task inbox even though no real Tasks route exists');
assert(/SECONDARY_NAV=\['nav_staffpull','mlsPtab_reviews','mlsPtab_send','nav_help'\]/.test(navigation),
  'secondary duplicate list is incomplete');
assert(/body\.mls-redesign #mlsRdNav \.mainnav > \.navtab\[data-mlsrd-primary-hidden='1'\]\{ display:none !important; \}/.test(redesign),
  'a legacy force-visible rail rule can override hidden secondary routes');

/* The rail only hides a duplicate after its alternate real surface exists. */
assert(topbar.includes('Staff prep & Athena month pull') &&
  topbar.includes('data-mls-action", "staff-prep') &&
  topbar.includes('mls:menu-staff-prep-request'),
  'Staff prep and Athena month pulls do not remain reachable through the single Menu entry');
assert(!/<p[^>]*>[^<]*Doctors (?:don’t|don't) see this screen/i.test(connect),
  'Staff Prep contradicts the Menu workflow by telling doctors they cannot see it');
assert(!connect.includes("mi.id = 'ez3flMenuStaff'") &&
  !connect.includes("a.className = 'ez3fl-staffLink'"),
  'a competing Staff prep entry is still created outside Menu');
assert(/ez3fl-back[\s\S]{0,900}window\.__mlsEasyV3[\s\S]{0,260}easy\.open\('home'\)/.test(connect),
  'Staff prep Back still depends only on the hidden legacy mode button and can strand the clinician after a reload');
assert(/id="ez3StaffBack"[\s\S]{0,9000}on\('ez3StaffBack', function \(\) \{ setEasyMode\('doctor', 'home', 'staff-back', false\); \}\)/.test(connect),
  'the active Staff prep renderer does not own a synchronous Back control');
assert(connect.includes("btn.className='mlsTbItem mls-menu-reviews'") && connect.includes("openContext('reviews',{source:'menu'"),
  'Reviews does not remain reachable through Menu');
assert(connect.includes("route:'reach:send'") && connect.includes("if (route.indexOf('reach:') === 0)"),
  'Send does not remain reachable through the Help/Find feature directory');
assert(connect.includes("row.id = 'mlsObtMenuRow'") && /mlsObtMenuRow[\s\S]{0,420}openTour\(\)/.test(connect),
  'Help/tour does not remain reachable through Menu');

class TextNode {
  constructor(data) { this.nodeType = 3; this.data = data; this.parentElement = null; }
  remove() {
    if (!this.parentElement) return;
    const at = this.parentElement.childNodes.indexOf(this);
    if (at >= 0) this.parentElement.childNodes.splice(at, 1);
    this.parentElement = null;
  }
}

function tab(id, label, active) {
  const text = new TextNode(label);
  const attrs = Object.create(null);
  const listeners = Object.create(null);
  const node = {
    id, nodeType: 1, childNodes: [text], parentElement: null, hidden: false, clicks: 0,
    classList: { contains(name) { return name === 'on' && !!active; } },
    get firstChild() { return this.childNodes[0] || null; },
    hasAttribute(name) { return Object.prototype.hasOwnProperty.call(attrs, name); },
    getAttribute(name) { return this.hasAttribute(name) ? attrs[name] : null; },
    setAttribute(name, value) { attrs[name] = String(value); },
    removeAttribute(name) { delete attrs[name]; },
    addEventListener(type, fn) { listeners[type] = fn; },
    removeEventListener(type, fn) { if (listeners[type] === fn) delete listeners[type]; },
    insertBefore(child, before) {
      const old = this.childNodes.indexOf(child);
      if (old >= 0) this.childNodes.splice(old, 1);
      const at = before ? this.childNodes.indexOf(before) : this.childNodes.length;
      this.childNodes.splice(at < 0 ? this.childNodes.length : at, 0, child);
      child.parentElement = this;
    },
    click() { this.clicks += 1; },
    key(key) {
      let prevented = false;
      if (listeners.keydown) listeners.keydown({
        key,
        preventDefault() { prevented = true; },
        stopPropagation() {}
      });
      return prevented;
    }
  };
  text.parentElement = node;
  return node;
}

const initial = [
  tab('nav_calendar', '📅 Calendar '),
  tab('nav_patients', '👥 Patients '),
  tab('nav_visit', '🎙️ Visit ', true),
  tab('nav_staffpull', 'Staff pulls '),
  tab('nav_orders', 'Orders '),
  tab('nav_recs', 'Recommendations '),
  tab('nav_history', '📚 History '),
  tab('nav_analysis', '📊 Analysis '),
  tab('nav_studio', '✨ AI Studio '),
  tab('mlsPtab_reviews', 'Reviews '),
  tab('mlsPtab_send', 'Send to patient '),
  tab('nav_help', 'Help ')
];
const nodes = Object.fromEntries(initial.map(node => [node.id, node]));
nodes.mlsObtMenuRow = { id: 'mlsObtMenuRow' };
let staffMenu = { id: 'staff-menu' };
let reviewsMenu = { id: 'reviews-menu' };
let moves = 0;
const nav = {
  nodeType: 1, children: initial.slice(), attrs: Object.create(null),
  setAttribute(name, value) { this.attrs[name] = String(value); },
  getAttribute(name) { return this.attrs[name] || null; },
  querySelectorAll(selector) { return selector === '.navtab' ? this.children.slice() : []; },
  insertBefore(node, before) {
    const old = this.children.indexOf(node);
    if (old >= 0) this.children.splice(old, 1);
    const at = before ? this.children.indexOf(before) : this.children.length;
    this.children.splice(at < 0 ? this.children.length : at, 0, node);
    node.parentElement = this;
    moves += 1;
  }
};
initial.forEach(node => { node.parentElement = nav; });

const document = {
  getElementById(id) { return nodes[id] || null; },
  querySelector(selector) {
    if (selector === '.mainnav') return nav;
    if (selector === '#mlsTbMenuPanel .mlsTbItem[data-mls-action="staff-prep"]') return staffMenu;
    if (selector === '#mlsTbMenuPanel .mls-menu-reviews') return reviewsMenu;
    return null;
  },
  createTextNode(data) { return new TextNode(data); }
};
const window = {
  __mlsFeatureDirectory: [{ route: 'reach:reviews' }, { route: 'reach:send' }]
};
const context = { document, window };
context.$ = id => document.getElementById(id);
vm.createContext(context);
vm.runInContext(`${navigation}\nthis.organizePrimaryNavigation=organizePrimaryNavigation;`, context,
  { filename: 'clinician-navigation-runtime.js' });

assert.strictEqual(context.organizePrimaryNavigation(), true);
/* 2026-07-24 UI rework: History is folded (attribute-marked, hidden when a real
   style object exists) but never removed from the DOM.
   2026-07-26 studio merge: FOUR lead routes; nav_analysis is folded the same
   way, for the reason recorded at the PRIMARY_NAV pin above. */
assert.deepStrictEqual(nav.children.slice(0, 4).map(node => node.id), [
  'nav_visit', 'nav_patients', 'nav_calendar', 'nav_studio'
]);
assert.deepStrictEqual(nav.children.slice(0, 4).map(node => node.childNodes[0].data.trim()), [
  '🎙️ Today', '👥 Patients', '📅 Calendar', '✨ Tools'
]);
assert.strictEqual(nodes.nav_history.getAttribute('data-mlsrd-folded'), '1',
  'History must be folded deliberately (marked), not dropped');
assert.strictEqual(nodes.nav_analysis.getAttribute('data-mlsrd-folded'), '1',
  'Analysis must be folded deliberately (marked), not dropped — its content is AI Studio\'s Practice section');
assert.strictEqual(nodes.nav_orders.childNodes[0].data.trim(), 'Orders', 'real Orders route was renamed');
assert.strictEqual(nav.attrs.role, 'navigation');
assert.strictEqual(nav.attrs['aria-label'], 'Primary navigation');
assert.strictEqual(nodes.nav_visit.getAttribute('role'), 'button');
assert.strictEqual(nodes.nav_visit.getAttribute('tabindex'), '0');
assert.strictEqual(nodes.nav_visit.getAttribute('aria-label'), 'Today');
assert.strictEqual(nodes.nav_visit.getAttribute('aria-current'), 'page');
assert.strictEqual(nodes.nav_patients.getAttribute('aria-current'), null);
assert.strictEqual(nodes.nav_visit.key('Enter'), true, 'Enter did not activate the preserved Visit route');
assert.strictEqual(nodes.nav_visit.clicks, 1, 'keyboard activation bypassed the real route node');

for (const id of ['nav_staffpull', 'mlsPtab_reviews', 'mlsPtab_send', 'nav_help']) {
  assert.strictEqual(nodes[id].hidden, true, `${id} remained painted in the primary rail`);
  assert.strictEqual(nodes[id].getAttribute('aria-hidden'), 'true', `${id} remained in the accessibility tree`);
  assert.strictEqual(nodes[id].getAttribute('tabindex'), '-1', `${id} remained keyboard-focusable while hidden`);
}

const firstPassMoves = moves;
context.organizePrimaryNavigation();
assert.strictEqual(moves, firstPassMoves, 'idempotent navigation sync moved the same nodes again');

/* If an alternate surface is unavailable, the real route fails open instead
 * of becoming inaccessible. */
staffMenu = null;
delete nodes.mlsObtMenuRow;
reviewsMenu = null;
window.__mlsFeatureDirectory = [];
context.organizePrimaryNavigation();
for (const id of ['nav_staffpull', 'mlsPtab_reviews', 'mlsPtab_send', 'nav_help']) {
  assert.strictEqual(nodes[id].hidden, false, `${id} stayed hidden after its alternate disappeared`);
  assert.strictEqual(nodes[id].getAttribute('aria-hidden'), null, `${id} stayed aria-hidden after fail-open`);
  assert.strictEqual(nodes[id].getAttribute('tabindex'), '0', `${id} did not return to keyboard navigation`);
}

console.log('PASS clinician navigation: real routes, lead order, secondary reachability, and keyboard semantics');
