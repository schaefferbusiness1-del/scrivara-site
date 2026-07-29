'use strict';

const fs = require('fs');
const path = require('path');

function replaceOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(label + ': expected source text was not found');
  const second = source.indexOf(before, first + before.length);
  if (second >= 0) throw new Error(label + ': expected source text was ambiguous');
  return source.slice(0, first) + after + source.slice(first + before.length);
}

const root = path.join(__dirname, '..', '..');
const connectPath = path.join(root, 'mls-connect.js');
const testPath = path.join(root, 'tests', 'interaction-performance-contract.test.js');

let connect = fs.readFileSync(connectPath, 'latin1');
let test = fs.readFileSync(testPath, 'utf8');

connect = replaceOnce(
  connect,
  '   light poll and restores by calling the public showView() ',
  '   the existing mls:view-changed event and restores by calling the public showView() ',
  'describe the event-driven tab-memory owner'
);

connect = replaceOnce(
  connect,
  [
    '  // RECORD: light poll of which .navtab is active (catches clicks AND programmatic',
    "  // showView() calls alike). Started only AFTER restore so the default 'visit' on",
    "  // load can't clobber the saved tab.",
    "  var started = false, last = '';",
    '  function startRecording(){',
    '    if (started) return; started = true;',
    '    last = currentView();',
    '    setInterval(function(){ var v = currentView(); if (v && v !== last){ last = v; store(v); } }, 1000);',
    '  }'
  ].join('\n'),
  [
    '  // RECORD: showView emits mls:view-changed after every real route change.',
    '  // Listen only after restore so the default route cannot overwrite the saved route.',
    "  var started = false, last = '';",
    '  function recordView(ev){',
    "    var v = safe(function(){ return ev && ev.detail && ev.detail.view; }, '') || currentView();",
    '    if (v && v !== last){ last = v; store(v); }',
    '  }',
    '  function startRecording(){',
    '    if (started) return; started = true;',
    '    last = currentView();',
    "    window.addEventListener('mls:view-changed', recordView);",
    '  }'
  ].join('\n'),
  'replace the permanent tab-memory poll'
);

test = replaceOnce(
  test,
  "console.log('PASS interaction performance: native Settings scroll, loader-safe timers/calls, bounded agents, exact SW lifetime, deferred polish, and da-1.1.1');",
  [
    "/* 2026-07-29: route memory follows the existing showView acknowledgement",
    ' * instead of querying the active navigation tab once per second forever. */',
    "const tabMemoryMarker = connect.indexOf('if (window.__mlsTabMemory) return;');",
    "const tabMemoryStart = connect.lastIndexOf('(function(){', tabMemoryMarker);",
    "const tabMemoryEnd = connect.indexOf('/* ===== MLS premium-feature logo badges', tabMemoryMarker);",
    "assert(tabMemoryMarker >= 0 && tabMemoryStart >= 0 && tabMemoryEnd > tabMemoryMarker, 'tab-memory owner slice is missing');",
    'const tabMemorySource = connect.slice(tabMemoryStart, tabMemoryEnd);',
    "assert(!tabMemorySource.includes('setInterval('), 'tab memory still registers a permanent polling interval');",
    "assert(tabMemorySource.includes(\"window.addEventListener('mls:view-changed', recordView)\"), 'tab memory does not use the route acknowledgement');",
    "assert(app.includes(\"new CustomEvent('mls:view-changed',{detail:{previousView:previousView||'',view:v||''}})\"), 'showView no longer emits the route acknowledgement tab memory requires');",
    '',
    "let tabMemoryActive = 'visit';",
    'let tabMemoryQueries = 0;',
    'let tabMemoryIntervalCalls = 0;',
    'const tabMemoryTimeouts = [];',
    'const tabMemoryHandlers = {};',
    'const tabMemoryWrites = [];',
    'const tabMemoryStorage = {',
    "  getItem(key) { return key === 'mlsLastTab' ? 'history' : null; },",
    '  setItem(key, value) { tabMemoryWrites.push([key, value]); }',
    '};',
    'const tabMemoryDocument = {',
    "  readyState: 'complete',",
    '  querySelector(selector) {',
    "    assert.strictEqual(selector, '.navtab.on', 'tab memory queried an unexpected selector');",
    '    tabMemoryQueries++;',
    "    return { getAttribute(name) { return name === 'onclick' ? \"showView('\" + tabMemoryActive + \"')\" : ''; } };",
    '  }',
    '};',
    'const tabMemoryWindow = {',
    '  sessionStorage: tabMemoryStorage,',
    '  addEventListener(name, fn) { tabMemoryHandlers[name] = fn; },',
    '  showView(view) {',
    '    const previousView = tabMemoryActive;',
    '    tabMemoryActive = view;',
    "    const handler = tabMemoryHandlers['mls:view-changed'];",
    '    if (handler && previousView !== view) handler({ detail: { previousView, view } });',
    '  }',
    '};',
    'tabMemoryWindow.window = tabMemoryWindow;',
    'vm.runInNewContext(tabMemorySource, {',
    '  window: tabMemoryWindow,',
    '  document: tabMemoryDocument,',
    '  setTimeout(fn, delay) { tabMemoryTimeouts.push({ fn, delay }); return tabMemoryTimeouts.length; },',
    '  setInterval() { tabMemoryIntervalCalls++; return tabMemoryIntervalCalls; }',
    "}, { filename: 'event-driven-tab-memory.js' });",
    "const tabMemoryRestore = tabMemoryTimeouts.find(task => task.delay === 800);",
    "assert(tabMemoryRestore, 'tab memory did not retain its delayed restore');",
    'tabMemoryRestore.fn();',
    "assert.strictEqual(tabMemoryActive, 'history', 'saved route was not restored before recording');",
    "const tabMemoryStartTask = tabMemoryTimeouts.find(task => task.delay === 200);",
    "assert(tabMemoryStartTask, 'tab memory did not defer recording until restore settled');",
    'tabMemoryStartTask.fn();',
    "assert.strictEqual(typeof tabMemoryHandlers['mls:view-changed'], 'function', 'route acknowledgement listener was not installed');",
    "assert.strictEqual(tabMemoryIntervalCalls, 0, 'tab memory registered an idle interval at runtime');",
    'tabMemoryQueries = 0;',
    "tabMemoryWindow.showView('calendar');",
    "assert.deepStrictEqual(tabMemoryWrites, [['mlsLastTab', 'calendar']], 'route acknowledgement did not persist the changed route once');",
    "tabMemoryWindow.showView('calendar');",
    "assert.strictEqual(tabMemoryWrites.length, 1, 'same-route acknowledgement caused a duplicate storage write');",
    "tabMemoryHandlers['mls:view-changed']({ detail: { previousView: 'calendar', view: 'team' } });",
    "assert.strictEqual(tabMemoryWrites.length, 1, 'unsupported route was persisted');",
    "tabMemoryWindow.showView('visit');",
    "assert.deepStrictEqual(tabMemoryWrites[1], ['mlsLastTab', 'visit'], 'supported route after an unsupported route was not persisted');",
    "tabMemoryActive = 'orders';",
    "tabMemoryHandlers['mls:view-changed']({});",
    "assert.deepStrictEqual(tabMemoryWrites[2], ['mlsLastTab', 'orders'], 'missing event detail did not use the active-tab fallback');",
    "assert.strictEqual(tabMemoryQueries, 1, 'event details did not eliminate steady active-tab queries');",
    '',
    "console.log('PASS interaction performance: native Settings scroll, loader-safe timers/calls, bounded agents, exact SW lifetime, deferred polish, and da-1.1.1');"
  ].join('\n'),
  'add the event-driven tab-memory proof'
);

fs.writeFileSync(connectPath, connect, 'latin1');
fs.writeFileSync(testPath, test, 'utf8');
console.log('Patched ' + connectPath + ' and ' + testPath);
