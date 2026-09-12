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
assert(directory.includes("where:'Left navigation -> Send to patient (or Patient portal in the active-patient bar)'") && directory.includes("route:'reach:send'"), 'Send-to-patient location is stale or missing');
assert(directory.includes("where:'AI Studio -> natural-language study builder at the top'") && directory.includes("route:'study'"), 'natural-language study location is stale or missing');
assert(directory.includes('limited-data draft') && directory.includes('clinician and privacy review are still required'), 'Help/Search overstates study privacy or readiness');
assert(directory.includes("name:'Ask MLS Copilot'") && directory.includes("route:'copilot'"), 'MLS Copilot location is stale or missing');
assert(directory.includes("name:'Manage note and op-note templates'") && directory.includes("where:'Menu -> Templates'"), 'Templates still teaches a retired top-bar location');
assert(directory.includes("name:'Ask MLS Copilot'") && directory.includes("where:'Menu -> Ask'"), 'Ask still teaches a retired top-bar location');
assert(directory.includes("name:'Build a custom widget'") && directory.includes("where:'Menu -> Custom widget (also at the top of AI Studio)'"), 'Custom widget still teaches a retired top-bar location');
assert(!directory.includes("where:'Top bar -> Templates'") && !directory.includes("where:'Top bar -> Ask'") && !directory.includes("where:'Top bar -> Custom widget"), 'canonical directory still contains retired top-bar locations');
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

console.log('PASS Help/Search locations: the canonical directory routes natural-language studies into a visible Build surface, including late and cached mounts');
