'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.resolve(__dirname, '..', '..');
const planned = [];

function read(relativePath, encoding) {
  return fs.readFileSync(path.join(root, relativePath), encoding);
}

function eolOf(source) {
  return source.includes('\r\n') ? '\r\n' : '\n';
}

function countOccurrences(source, needle) {
  if (!needle) throw new Error('empty replacement needle');
  let count = 0;
  let offset = 0;
  while (true) {
    const index = source.indexOf(needle, offset);
    if (index < 0) return count;
    count++;
    offset = index + needle.length;
  }
}

function replaceOnce(source, needle, replacement, label) {
  const count = countOccurrences(source, needle);
  if (count !== 1) {
    throw new Error(label + ': expected exactly one source occurrence, found ' + count);
  }
  return source.replace(needle, replacement);
}

function requireAbsent(source, marker, label) {
  if (source.includes(marker)) throw new Error(label + ': proposal appears to be already applied');
}

function plan(relativePath, encoding, transform) {
  const before = read(relativePath, encoding);
  const after = transform(before);
  if (after === before) throw new Error(relativePath + ': transform made no change');
  planned.push({ relativePath, encoding, before, after });
}

function digest(value, encoding) {
  return crypto.createHash('sha256').update(Buffer.from(value, encoding)).digest('hex');
}

function transformConnector(source, label) {
  const nl = eolOf(source);
  requireAbsent(source, 'mls:study-mode-b-rendered', label);

  source = replaceOnce(
    source,
    [
      '   Self-contained progressive enhancement: own IIFE, try/catch everywhere, observes the overlay,',
      '   reuses __mlsStudy internals, never monkey-patches. Degrades to a silent no-op if anything is missing. */'
    ].join(nl),
    [
      '   Self-contained progressive enhancement: own IIFE, try/catch everywhere, listens for the owned',
      '   Mode B render signal, reuses __mlsStudy internals, and never monkey-patches its opener.',
      '   Degrades to a silent no-op if anything is missing. */'
    ].join(nl),
    label + ' Study Grab ownership description'
  );

  source = replaceOnce(
    source,
    [
      "    if(TAB==='A') renderModeA(body);",
      "    else if(TAB==='B') renderModeB(body);",
      '    else renderCohorts(body);'
    ].join(nl),
    [
      "    if(TAB==='A') renderModeA(body);",
      "    else if(TAB==='B'){",
      '      renderModeB(body);',
      '      /* 2026-07-29: signal only after the complete Mode B DOM exists. */',
      "      try{ window.dispatchEvent(new Event('mls:study-mode-b-rendered')); }catch(e){}",
      '    }',
      '    else renderCohorts(body);'
    ].join(nl),
    label + ' Study Mode B render signal'
  );

  return replaceOnce(
    source,
    [
      '  // poll: the Study overlay is created/destroyed on demand; (re)inject whenever Mode B is shown',
      '  setInterval(inject, 700);',
      '',
      '  window.__mlsGrab={ _grabViaAssist:grabViaAssist, _ensureCalendarEntry:ensureCalendarEntry, _toIsoDate:toIsoDate, _isFutureOrToday:isFutureOrToday, _startIso:startIso, _rowTime:rowTime, _runGrab:runGrab };'
    ].join(nl),
    [
      "  var STUDY_RENDER_EVENT='mls:study-mode-b-rendered';",
      '  var stopped=false;',
      '  var onStudyRendered=function(){ if(!stopped) inject(); };',
      '  try{ window.addEventListener(STUDY_RENDER_EVENT,onStudyRendered); }catch(e){}',
      '  inject();',
      '',
      '  function revertGrab(){',
      '    stopped=true;',
      '    try{ window.removeEventListener(STUDY_RENDER_EVENT,onStudyRendered); }catch(e){}',
      '    try{ delete window.__mlsGrab; }catch(e2){ window.__mlsGrab=undefined; }',
      '  }',
      '',
      "  window.__mlsGrab={ version:'study-grab-event-1.0.0', _grabViaAssist:grabViaAssist, _ensureCalendarEntry:ensureCalendarEntry, _toIsoDate:toIsoDate, _isFutureOrToday:isFutureOrToday, _startIso:startIso, _rowTime:rowTime, _runGrab:runGrab, revert:revertGrab };"
    ].join(nl),
    label + ' Study Grab render-event installation'
  );
}

plan('mls-connect.js', 'latin1', source => transformConnector(source, 'production connector'));
plan('mls-connect.staging.js', 'latin1', source => transformConnector(source, 'staging connector'));

plan('tests/interaction-performance-contract.test.js', 'utf8', source => {
  const nl = eolOf(source);
  const marker = '/* 2026-07-29: Study Grab listens to the owned Mode B render event';
  requireAbsent(source, marker, 'Study Grab interaction performance contract');
  const consoleLine = "console.log('PASS interaction performance: native Settings scroll, loader-safe timers/calls, bounded agents, exact SW lifetime, deferred polish, and da-1.1.1');";
  const activeSyncMarker = '/* 2026-07-29: active-patient field sync follows canonical lifecycle events';
  const block = [
    '/* 2026-07-29: Study Grab listens to the owned Mode B render event',
    ' * instead of waking the main thread every 700 milliseconds. */',
    'function extractStudyGrabRuntime(sourceText, label) {',
    "  const guard = sourceText.indexOf('if (window.__mlsGrab) return;');",
    "  const start = sourceText.lastIndexOf('(function(){', guard);",
    "  const nextModule = sourceText.indexOf('/* ============================================================================', guard);",
    "  const end = sourceText.lastIndexOf('})();', nextModule);",
    "  assert(guard >= 0 && start >= 0 && nextModule > guard && end > guard, label + ' full Study Grab IIFE is missing');",
    '  const iife = sourceText.slice(start, end + 5);',
    "  assert(!iife.includes('setInterval(inject, 700)'), label + ' Study Grab retained the permanent poll');",
    "  assert(!iife.includes('__mlsGrabOpenWrapper') && !iife.includes('studyOwner.open='),",
    "    label + ' Study Grab still monkey-patches the public opener');",
    "  assert(iife.includes(\"window.addEventListener(STUDY_RENDER_EVENT,onStudyRendered)\"),",
    "    label + ' Study Grab is not listening to the render owner');",
    "  assert(iife.includes(\"window.removeEventListener(STUDY_RENDER_EVENT,onStudyRendered)\"),",
    "    label + ' Study Grab revert does not release the render listener');",
    '',
    "  const studyGuard = sourceText.lastIndexOf('if (window.__mlsStudy) return;', guard);",
    "  const renderStart = sourceText.indexOf('  function render(){', studyGuard);",
    "  const renderEnd = sourceText.indexOf('  /* ----- Mode A ----- */', renderStart);",
    "  assert(studyGuard >= 0 && renderStart > studyGuard && renderEnd > renderStart, label + ' Study render owner is missing');",
    '  const renderOwner = sourceText.slice(renderStart, renderEnd);',
    "  const renderB = renderOwner.indexOf('renderModeB(body);');",
    "  const signal = renderOwner.indexOf(\"window.dispatchEvent(new Event('mls:study-mode-b-rendered'))\");",
    "  assert(renderB >= 0 && signal > renderB, label + ' Mode B signal does not follow its synchronous render');",
    "  assert.strictEqual((renderOwner.match(/mls:study-mode-b-rendered/g) || []).length, 1,",
    "    label + ' Study render owner emits an ambiguous number of Mode B signals');",
    '  const signalLineEnd = renderOwner.indexOf("\\n", signal);',
    '  const branchExec = renderOwner.slice(renderB, signalLineEnd);',
    "  assert(sourceText.includes(\"b.addEventListener('click', function(){ open('A'); });\"),",
    "    label + ' toolbar launch route changed unexpectedly');",
    "  assert(sourceText.includes(\"b.addEventListener('click', function(){ TAB=b.getAttribute('data-t'); render(); });\"),",
    "    label + ' Study tab route changed unexpectedly');",
    '  return { iife, branchExec };',
    '}',
    '',
    'function makeStudyGrabDom(initialMode, throwOnLookup) {',
    "  let mode = initialMode || 'A';",
    '  let timerCalls = 0;',
    '  let findLookups = 0;',
    '  let buttonCreates = 0;',
    '  let optionCreates = 0;',
    '  let outputCreates = 0;',
    '  let badgeCreates = 0;',
    '  let styleCreates = 0;',
    '  let button = null;',
    '  let optionRow = null;',
    '  let output = null;',
    '  let badge = null;',
    '  let style = null;',
    '  const listeners = Object.create(null);',
    '  function node(tag) {',
    '    return {',
    "      tagName: String(tag || '').toUpperCase(), id: '', className: '', textContent: '', innerHTML: '',",
    '      parentElement: null, parentNode: null, nextSibling: null, handlers: Object.create(null),',
    '      addEventListener(type, handler) { this.handlers[type] = handler; }',
    '    };',
    '  }',
    '  const sectionHead = node("div");',
    "  sectionHead.querySelector = selector => selector === '.mls-grab-badge' ? badge : null;",
    '  sectionHead.appendChild = child => { badge = child; child.parentElement = sectionHead; badgeCreates++; return child; };',
    '  const sectionParent = node("div");',
    '  sectionParent.insertBefore = child => {',
    '    child.parentElement = sectionParent;',
    "    if (child.id === 'mlsGrabOut') { output = child; outputCreates++; }",
    "    else if (child.className === 'mls-grab-opts') { optionRow = child; optionCreates++; }",
    '    return child;',
    '  };',
    '  const actions = node("div"); actions.parentElement = sectionParent;',
    '  actions.appendChild = child => { button = child; child.parentElement = actions; buttonCreates++; return child; };',
    '  const findOut = node("div"); findOut.parentElement = sectionParent;',
    '  const section = node("section");',
    '  section.querySelector = selector => {',
    "    if (selector === '#mlsGrabAthenaBtn') return button;",
    "    if (selector === '.mls-study-sech') return sectionHead;",
    "    if (selector === '#mlsStudyBFindOut') return findOut;",
    '    return null;',
    '  };',
    '  const findButton = node("button"); findButton.parentElement = actions;',
    "  findButton.closest = selector => selector === '.mls-study-sec' ? section : null;",
    '  const documentHead = node("head");',
    '  documentHead.appendChild = child => { style = child; child.parentElement = documentHead; styleCreates++; return child; };',
    '  const documentObject = {',
    '    head: documentHead, documentElement: node("html"),',
    '    getElementById(id) {',
    '      if (throwOnLookup) throw new Error("synthetic Study DOM lookup failure");',
    "      if (id === 'mlsStudyBFind') { findLookups++; return mode === 'B' ? findButton : null; }",
    "      if (id === 'mlsGrabCss') return style;",
    '      return null;',
    '    },',
    '    createElement(tag) { return node(tag); }',
    '  };',
    '  const originalOpen = function originalStudyOpen(){ return "original-open"; };',
    '  const windowObject = {',
    '    __mlsStudy: { open: originalOpen },',
    '    addEventListener(type, handler) { (listeners[type] || (listeners[type] = [])).push(handler); },',
    '    removeEventListener(type, handler) {',
    '      const list = listeners[type] || []; const at = list.indexOf(handler); if (at >= 0) list.splice(at, 1);',
    '    },',
    '    dispatchEvent(event) { (listeners[event.type] || []).slice().forEach(handler => handler(event)); }',
    '  };',
    '  function resetMode(next) {',
    '    mode = next;',
    "    if (next === 'B') { button = null; optionRow = null; output = null; badge = null; }",
    "    else { button = null; optionRow = null; output = null; badge = null; }",
    '  }',
    '  function SyntheticStudyEvent(type) { this.type = type; }',
    '  const context = {',
    '    window: windowObject, document: documentObject, Event: SyntheticStudyEvent,',
    '    setInterval() { timerCalls++; return timerCalls; },',
    '    clearInterval() {}, setTimeout() { throw new Error("Study Grab scheduled a timeout"); }, clearTimeout() {}',
    '  };',
    '  return {',
    '    context, windowObject, originalOpen,',
    '    renderModeB() { resetMode("B"); },',
    '    setMode: resetMode,',
    '    fire(type) { windowObject.dispatchEvent(new SyntheticStudyEvent(type)); },',
    '    listenerCount(type) { return (listeners[type] || []).length; },',
    '    stats() { return { timerCalls, findLookups, buttonCreates, optionCreates, outputCreates, badgeCreates, styleCreates, button, optionRow, output, badge, style }; }',
    '  };',
    '}',
    '',
    'function runStudyModeBBranch(runtime, harness, label) {',
    '  vm.runInNewContext(runtime.branchExec, {',
    '    body: {}, renderModeB() { harness.renderModeB(); },',
    '    window: harness.windowObject, Event: harness.context.Event',
    "  }, { filename: label + '-study-mode-b-owner.js' });",
    '}',
    '',
    'function checkStudyGrabRuntime(sourceText, label) {',
    '  const runtime = extractStudyGrabRuntime(sourceText, label);',
    '  const harness = makeStudyGrabDom("A", false);',
    "  vm.runInNewContext(runtime.iife, harness.context, { filename: label + '-study-grab-full-iife.js' });",
    "  assert.strictEqual(harness.windowObject.__mlsStudy.open, harness.originalOpen, label + ' Study opener identity changed');",
    "  assert.strictEqual(harness.listenerCount('mls:study-mode-b-rendered'), 1, label + ' render listener missing');",
    "  assert.strictEqual(harness.stats().timerCalls, 0, label + ' Study Grab scheduled a timer');",
    "  assert.strictEqual(harness.stats().buttonCreates, 0, label + ' closed/A-mode install created a control');",
    '',
    '  const installLookups = harness.stats().findLookups;',
    "  vm.runInNewContext(runtime.iife, harness.context, { filename: label + '-study-grab-full-iife-rerun.js' });",
    "  assert.strictEqual(harness.listenerCount('mls:study-mode-b-rendered'), 1, label + ' duplicate install added a listener');",
    "  assert.strictEqual(harness.stats().findLookups, installLookups, label + ' duplicate guard did not short-circuit full IIFE');",
    '',
    '  runStudyModeBBranch(runtime, harness, label);',
    '  let stats = harness.stats();',
    "  assert(stats.button && stats.button.id === 'mlsGrabAthenaBtn', label + ' real Mode B signal did not create the action');",
    "  assert(stats.optionRow && stats.output && stats.badge && stats.style, label + ' real Mode B injection is incomplete');",
    "  assert.deepStrictEqual([stats.buttonCreates, stats.optionCreates, stats.outputCreates, stats.badgeCreates, stats.styleCreates], [1,1,1,1,1],",
    "    label + ' first Mode B render did not create exactly one owned UI set');",
    '',
    "  harness.fire('mls:study-mode-b-rendered');",
    '  stats = harness.stats();',
    "  assert.strictEqual(stats.buttonCreates, 1, label + ' repeated signal duplicated the current Mode B action');",
    '  runStudyModeBBranch(runtime, harness, label);',
    '  stats = harness.stats();',
    "  assert.strictEqual(stats.buttonCreates, 2, label + ' a fresh Mode B render was not enhanced');",
    "  assert.strictEqual(stats.styleCreates, 1, label + ' fresh Mode B render duplicated global style ownership');",
    '',
    '  harness.setMode("A");',
    "  harness.fire('mls:study-mode-b-rendered');",
    "  assert.strictEqual(harness.stats().button, null, label + ' signal created a control without a Mode B target');",
    '',
    '  harness.renderModeB();',
    "  harness.fire('mls:study-mode-b-rendered');",
    '  const beforeRevert = harness.stats().buttonCreates;',
    '  const api = harness.windowObject.__mlsGrab;',
    '  api.revert();',
    "  assert.strictEqual(harness.listenerCount('mls:study-mode-b-rendered'), 0, label + ' revert left the render listener installed');",
    "  assert.strictEqual(harness.windowObject.__mlsGrab, undefined, label + ' revert left the duplicate-install guard armed');",
    '  harness.renderModeB();',
    "  harness.fire('mls:study-mode-b-rendered');",
    "  assert.strictEqual(harness.stats().buttonCreates, beforeRevert, label + ' reverted handler still injected');",
    '',
    "  vm.runInNewContext(runtime.iife, harness.context, { filename: label + '-study-grab-full-iife-reinstall.js' });",
    "  assert.strictEqual(harness.listenerCount('mls:study-mode-b-rendered'), 1, label + ' reinstall did not restore exactly one listener');",
    "  assert.strictEqual(harness.stats().buttonCreates, beforeRevert + 1, label + ' reinstall missed an already-open Mode B overlay');",
    "  assert.strictEqual(harness.windowObject.__mlsStudy.open, harness.originalOpen, label + ' reinstall changed Study opener ownership');",
    "  assert.strictEqual(harness.stats().timerCalls, 0, label + ' reinstall scheduled a timer');",
    '',
    '  const failure = makeStudyGrabDom("A", true);',
    "  assert.doesNotThrow(() => vm.runInNewContext(runtime.iife, failure.context, { filename: label + '-study-grab-dom-failure.js' }),",
    "    label + ' install-time DOM failure escaped');",
    "  assert.doesNotThrow(() => failure.fire('mls:study-mode-b-rendered'), label + ' render-time DOM failure escaped');",
    "  assert.strictEqual(failure.windowObject.__mlsStudy.open, failure.originalOpen, label + ' DOM failure changed Study opener');",
    "  assert.strictEqual(failure.stats().timerCalls, 0, label + ' DOM failure path scheduled a timer');",
    '}',
    "checkStudyGrabRuntime(connect, 'production');",
    "checkStudyGrabRuntime(read('mls-connect.staging.js'), 'staging');",
    ''
  ].join(nl);
  const insertionAnchor = source.includes(activeSyncMarker) ? activeSyncMarker : consoleLine;
  return replaceOnce(
    source,
    insertionAnchor,
    block + insertionAnchor,
    'Study Grab interaction performance test insertion'
  );
});

for (const change of planned) {
  fs.writeFileSync(path.join(root, change.relativePath), change.after, change.encoding);
}

for (const change of planned) {
  console.log(
    change.relativePath + ' ' +
    digest(change.before, change.encoding).slice(0, 12) + ' -> ' +
    digest(change.after, change.encoding).slice(0, 12)
  );
}
console.log('Applied 043-event-driven-study-grab to ' + planned.length + ' files');
