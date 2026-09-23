'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'mls-connect.js'), 'utf8');
const start = source.indexOf('Canonical MLS feature directory');
const end = source.indexOf('MLS Scribe -- b44', start);
assert(start >= 0 && end > start, 'canonical Help/Find feature directory is missing');
const directory = source.slice(start, end);

assert(directory.includes('Shared by Find and Help'), 'Help and Find no longer share one location source');
assert(directory.includes("name:'Free Marketing workspace'") && directory.includes("where:'Tools -> Marketing'") && directory.includes("route:'reach:reviews'"),
  'Marketing location or its guarded legacy-route handoff is stale or missing');
assert(!directory.includes("where:'Left navigation -> Reviews'"), 'Help still teaches the retired Reviews navigation');
/* helpdir-1.0.0: the Calm shell has no left navigation, top navigation or Menu
   door (#mlsTbMenu is hidden). These pins are the locations measured in a
   signed-in clinician shell: taskbar, Tools menu, open visit, Settings tabs.
   Send to patient sits under the open visit's "Visit shortcuts" chip; the
   Tools menu has no Templates row (op-note templates are the op-note room's
   Templates button); AI Studio's builder is a custom TOOL, not the widget
   builder, so Custom widget names only its Tools row. */
assert(directory.includes("where:'In a visit: Visit shortcuts -> Send to patient'") && directory.includes("route:'reach:send'"), 'Send-to-patient location is stale or missing');
assert(directory.includes("where:'AI Studio -> Study & build -> natural-language study builder at the top'") && directory.includes("route:'study'"), 'natural-language study location is stale or missing');
assert(directory.includes('limited-data draft') && directory.includes('clinician and privacy review are still required'), 'Help/Search overstates study privacy or readiness');
assert(directory.includes("name:'Ask MLS Copilot'") && directory.includes("route:'copilot'"), 'MLS Copilot location is stale or missing');
assert(directory.includes("name:'Manage note and op-note templates'") && directory.includes("where:'Op-note: Tools -> Prep op notes -> Templates; visit-note: Settings -> Notes & AI'"), 'Templates location is stale or missing');
assert(directory.includes("name:'Ask MLS Copilot'") && directory.includes("where:'Copilot on the taskbar (also AI Studio -> Ask)'"), 'Ask still teaches a retired Menu location');
assert(directory.includes("name:'Build a custom widget'") && directory.includes("where:'Tools -> Custom widget'"), 'Custom widget still teaches a retired Menu location');
assert(!directory.includes("where:'Top bar -> Templates'") && !directory.includes("where:'Top bar -> Ask'") && !directory.includes("where:'Top bar -> Custom widget"), 'canonical directory still contains retired top-bar locations');
/* helpdir-1.0.0: none of the retired doors may come back as a location, nor the
   two wrong doors measured at b1304 (no Tools -> Templates row; AI Studio's
   builder is not the widget builder). */
for (const retired of ["where:'Menu -> ", "where:'Top navigation -> ", "where:'Left navigation -> ", "where:'Top bar -> ", "where:'Settings -> Display'", 'easy recorder', 'top workflow card', 'Connect to EMR',
  "where:'Op-note: Tools -> Templates", 'Custom widget (also AI Studio']) {
  assert(!directory.includes(retired), 'canonical directory still teaches a retired location: ' + retired);
}
assert(directory.includes("route.indexOf('reach:') === 0") && directory.includes("mode:'dialog',source:'feature-directory'"), 'Help/Find context actions must open compact Reach dialogs');
assert(directory.includes("if(typeof window.showView==='function') window.showView('studio')") &&
  directory.includes('function focusStudyPrompt(tries)') &&
  directory.includes('if(tries<100)focusStudyPrompt(tries+1)') &&
  directory.includes("document.getElementById('mlsStudyPrompt')"),
  'Help/Find cannot navigate to and recover focus when the natural-language study builder mounts late');
assert(directory.includes("window.__mlsStudioMerge.select('build')") &&
  directory.includes("wrap.contains(q)") && directory.includes("head.click()"),
  'Help/Find can still focus the study prompt while its Build section or cached advanced wrapper is hidden');
assert(directory.includes('window.__mlsFeatureDirectory = DIR') && directory.includes('window.mlsFeatureHelpAnswer = helpAnswer') && directory.includes('window.mlsOpenFeature = openFeature'), 'directory is not published to both answer and navigation owners');

/* Execute the shipped directory IIFE against the exact failure sequence: the
 * user opens Study while the merge surface and prompt are still mounting, and
 * the cached pre-sr-2.4 builder is inside a closed advanced wrapper.  A string
 * assertion alone passed while this route visibly did nothing. */
const iifeStart = source.indexOf('(function () {', start);
const iifeClose = source.lastIndexOf('})();', end);
assert(iifeStart >= 0 && iifeClose > iifeStart, 'could not lift the feature-directory runtime');
const runtime = source.slice(iifeStart, iifeClose + 5);
const timers = [];
const selected = [];
const views = [];
const loaderReasons = [];
let promptReady = false;
let opened = false;
let focused = false;
const prompt = {
  scrollIntoView() {},
  focus() { focused = true; }
};
const wrap = {
  classList: { contains(name) { return name === 'open' && opened; } },
  contains(node) { return node === prompt; }
};
const head = { click() { opened = true; } };
const sandbox = {
  console,
  setTimeout(fn) { timers.push(fn); return timers.length; },
  document: {
    querySelectorAll() { return []; },
    querySelector() { return null; },
    getElementById(id) {
      if (id === 'mlsStudyPrompt') return promptReady ? prompt : null;
      if (id === 'mlsB39SgWrap') return wrap;
      if (id === 'mlsB39SgHead') return head;
      return null;
    }
  },
  __mlsStudyRequestLoader: { ensure(reason) { loaderReasons.push(reason); } },
  showView(key) { views.push(key); }
};
sandbox.window = sandbox;
vm.runInNewContext(runtime, sandbox, { filename: 'mls-connect.js#feature-directory', timeout: 5000 });
const studyEntry = sandbox.__mlsFeatureDirectory.filter(entry => entry.route === 'study')[0];
assert(studyEntry, 'the runtime directory exported no Study route');
assert.strictEqual(sandbox.mlsOpenFeature(studyEntry), true, 'the Study route refused to open');
assert.deepStrictEqual(views, ['studio'], 'the Study route did not open AI Studio first');
assert.deepStrictEqual(loaderReasons, ['feature-directory'], 'Help/Find left Study waiting in the optional-asset backlog');
assert.strictEqual(timers.length, 1, 'the late-mount focus loop did not schedule its first attempt');
timers.shift()();
assert.strictEqual(selected.length, 0, 'a missing Studio merge was mistaken for a selected Build surface');
assert.strictEqual(timers.length, 1, 'a missing prompt was not retried');
promptReady = true;
timers.shift()();
assert.strictEqual(focused, true, 'the early Study prompt was not focused while the merge finished loading');
assert.strictEqual(timers.length, 1, 'the focus loop stopped before the late Studio merge could select Build');
sandbox.__mlsStudioMerge = { select(key) { selected.push(key); } };
timers.shift()();
assert.strictEqual(selected[selected.length - 1], 'build', 'the successful focus attempt did not keep Build selected');
assert.strictEqual(opened, true, 'a cached builder inside the closed advanced wrapper was not revealed');
assert.strictEqual(focused, true, 'the revealed Study prompt was not focused');

/* helpdir-1.0.1 (b1307): ONE "where is it" source. The MLS Assistant's
   "where is ..." intent and the search rows used a private July map (Copilot
   Voice "bottom-left", Help "in the top bar") that also appended a stale
   "What's new (July 6)" list to the Help guide; the guide itself named a
   "Who's Next grid", "Use current patient", "Notes & templates" and "EMR
   sections", none of which is on screen. */
assert(source.includes('var MAP = (window.__mlsFeatureDirectory && window.__mlsFeatureDirectory.length) ? window.__mlsFeatureDirectory : [];'),
  'the Assistant and search rows no longer read the canonical feature directory');
assert(!source.includes("name: '🎙️ MLS Copilot Voice', where: 'Bottom-left button'"), 'the retired private feature map is back');
assert(!source.includes("What\\'s new (July 6)") && !source.includes("What's new (July 6)"), 'the stale July What\'s-new list is appended to the Help guide again');
const guideAt = source.indexOf("aria-label=\"How to use MLS Scribe\">' +\n        '<div class=\"g33-top\">");
const guide = source.slice(source.lastIndexOf('var STEPS = [', guideAt), guideAt);
assert(guide.length > 1000, 'the Help guide steps could not be sliced');
['Who’s Next', 'Use current patient', 'Notes & templates', 'EMR sections', 'top-right of MLS Easy'].forEach((stale) =>
  assert(!guide.includes(stale), 'the Help guide names a control that is not on screen: ' + stale));
assert(source.includes('Tip: reopen this guide any time - press <b>/</b> and pick <b>Help and guided tour</b>.'), 'the Help guide still sends people to a top-bar Help button');

console.log('PASS Help/Search locations: the canonical directory routes natural-language studies into a visible Build surface, including late and cached mounts; the Assistant, search rows and Help guide share it and name only controls on screen');
