'use strict';

/* Settings redesign (2026-07-20): searchable settings across every section,
 * per-section scope chips, main-nav keyboard/ARIA accessibility, a left/top
 * navigation-layout setting with a collapsed icon rail that reserves its own
 * grid column (never overlays work), and honest cloud-sync reporting on the
 * explicit Save button. All storage keys and save paths are unchanged.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');

// 1. settings search: wired input, searches ALL sections, respects role gating,
//    and restores the exact tab view when cleared
assert(html.includes('id="settingsSearch"') && html.includes('oninput="settingsSearchChanged()"'),
  'settings search input missing or unwired');
const searchFn = html.slice(html.indexOf('function settingsSearchChanged()'), html.indexOf('var _SET_SCOPES'));
assert(searchFn.includes("sec.getAttribute('data-set-hidden')==='1'"),
  'search must never surface role-gated (e.g. lawyer-hidden clinical) sections');
assert(searchFn.includes('mlsSelectSettingsTab('), 'clearing the search must restore the tab view');
assert(searchFn.includes("classList.toggle('set-tab-hidden',!any)"),
  'search must reveal matches via the same class the tab system uses');

// 2. scope chips: every settings group is labeled with who it belongs to
assert(html.includes('function decorateSettingsScopes()'), 'scope-chip decorator missing');
for (const scope of ["'This device'", "'Your account'", "'Practice'"]) {
  assert(html.includes(scope), 'scope label ' + scope + ' missing from _SET_SCOPES');
}

// 3. main-nav accessibility: keyboard activation + ARIA on the .navtab divs
const a11yFn = html.slice(html.indexOf('function enhanceMainNavA11y()'), html.indexOf('function setNavLayout('));
assert(a11yFn.includes("setAttribute('role','button')") && a11yFn.includes("setAttribute('tabindex','0')"),
  'nav tabs must be focusable buttons');
assert(/ev\.key==='Enter'\|\|ev\.key===' '/.test(a11yFn), 'nav tabs must activate on Enter/Space');
assert(a11yFn.includes("hasAttribute('hidden')"), 'retired hidden tabs must not join the tab order');
assert(a11yFn.includes("'aria-current'"), 'the active tab must be announced via aria-current');

// 4. navigation layout setting: persisted per device, truthful Saved state,
//    left-sidebar + collapsed rail via reserved grid column (never an overlay)
assert(html.includes('id="navLayoutSel"') && html.includes('onchange="setNavLayout(this.value)"'),
  'navigation layout selector missing or unwired');
const setFn = html.slice(html.indexOf('function setNavLayout('), html.indexOf('function applyNavLayout()'));
assert(setFn.includes("localStorage.setItem(uns('navLayout'),mode)"), 'nav layout must persist per device');
assert(setFn.includes("'Saved ✓ — '"), 'nav layout change must report a truthful Saved state');
const applyFn = html.slice(html.indexOf('function applyNavLayout()'), html.indexOf('function installNavLayoutCss'));
assert(applyFn.includes("'Collapse or expand the sidebar'"), 'collapse button must carry an accessible label');
assert(applyFn.includes("uns('navCollapsed')"), 'collapsed state must persist per device');
const cssBlock = html.slice(html.indexOf("st.textContent="), html.indexOf("document.head.appendChild(st)"));
assert(cssBlock.includes('grid-template-columns:190px 1fr'), 'left sidebar must reserve its own grid column');
assert(cssBlock.includes('grid-template-columns:52px 1fr'), 'collapsed rail must keep a reserved 52px column');
assert(cssBlock.includes('position:sticky'), 'the rail must stay reachable while scrolling');
assert(/max-width:900px[^}]*\{[^}]*display:block/.test(cssBlock), 'narrow screens must fall back to the stacked layout');

// 5. honest cloud-sync reporting: the explicit Save button surfaces sync misses
//    while the device save still holds (background syncs stay quiet)
const syncFn = html.slice(html.indexOf('function syncPrefsToServer('), html.indexOf('async function loadPrefsFromServer'));
assert(syncFn.includes('opts.notify'), 'sync outcome reporting must be opt-in per call site');
assert(syncFn.includes('cloud sync failed') && syncFn.includes('cloud sync unreachable'),
  'explicit saves must report cloud-sync misses honestly');
assert(html.includes('syncPrefsToServer({notify:true})'), 'the Settings Save button must opt into sync reporting');

console.log('PASS settings workspace: gated search across sections, scope chips, keyboard-accessible nav, per-device left/top layout with reserved-column collapse rail, honest cloud-sync reporting');
