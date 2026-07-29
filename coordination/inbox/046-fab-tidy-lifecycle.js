'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');

function replaceOnce(text, before, after, label) {
  const first = text.indexOf(before);
  if (first < 0) throw new Error(label + ': expected source text was not found');
  if (text.indexOf(before, first + before.length) >= 0) {
    throw new Error(label + ': expected source text was ambiguous');
  }
  return text.slice(0, first) + after + text.slice(first + before.length);
}

function prepare(relative, encoding, edits) {
  const file = path.join(root, relative);
  const original = fs.readFileSync(file, encoding);
  let next = original;
  edits.forEach(function (edit, index) {
    next = replaceOnce(next, edit[0], edit[1], relative + ' replacement ' + (index + 1));
  });
  if (next === original) throw new Error(relative + ': proposal produced no change');
  return { file, encoding, original, next };
}

const oldLifecycle = [
  "  document.addEventListener('click', function (ev) {",
  "    if (ev.target && ev.target.closest && ev.target.closest('#mlsFab')) setTimeout(augment, 90);",
  '  }, true);',
  '  api.revert = function () { try { st.remove(); } catch (e) {} api.installed = false; delete window.__mlsFabTidy; };'
].join('\n');

const newLifecycle = [
  '  function onFabTidyClick(ev) {',
  "    if (ev.target && ev.target.closest && ev.target.closest('#mlsFab')) setTimeout(augment, 90);",
  '  }',
  "  document.addEventListener('click', onFabTidyClick, true);",
  '  api.revert = function () {',
  '    /* 2026-07-29: retire both recurring owners before allowing reinstall. */',
  '    try { clearInterval(fhT); } catch (e) {}',
  "    try { document.removeEventListener('click', onFabTidyClick, true); } catch (e2) {}",
  '    try { st.remove(); } catch (e3) {}',
  '    api.installed = false; delete window.__mlsFabTidy;',
  '  };'
].join('\n');

const connectPlan = prepare('mls-connect.js', 'latin1', [
  [oldLifecycle, newLifecycle]
]);

const testAnchor = "console.log('PASS voice pill persistence: legacy settings cannot erase another owner\\'s display, and nothing force-shows the retired bottom-left pills over the dock');";

const lifecycleTest = [
  '/* 2026-07-29: run the real Fab Tidy IIFE through install, revert, and',
  '   reinstall. The timer and delegated click owner must not survive revert. */',
  "const fabMarker = connect.indexOf('* __mlsFabTidy  ft-1.0.0');",
  "assert(fabMarker >= 0, 'Fab Tidy module marker is missing');",
  "const fabIifeStart = connect.indexOf('(function () {', fabMarker);",
  "const fabIifeEnd = connect.indexOf('\\n})();', fabIifeStart);",
  "assert(fabIifeStart > fabMarker && fabIifeEnd > fabIifeStart, 'Fab Tidy IIFE boundary is missing');",
  'const fabIife = connect.slice(fabIifeStart, fabIifeEnd + 6);',
  "assert(fabIife.includes('function onFabTidyClick(ev)'), 'Fab Tidy click owner is anonymous');",
  "assert(fabIife.includes('clearInterval(fhT)'), 'Fab Tidy revert does not clear its interval');",
  "assert(fabIife.includes(\"document.removeEventListener('click', onFabTidyClick, true)\"),",
  "  'Fab Tidy revert does not remove the exact capture listener');",
  '',
  'const fabTimers = [], fabListeners = [], fabTimeouts = [], fabStyles = [];',
  'let fabGets = 0;',
  'const fabDocument = {',
  '  head: { appendChild(node) { fabStyles.push(node); node.parentNode = this; } },',
  '  documentElement: { appendChild(node) { fabStyles.push(node); node.parentNode = this; } },',
  '  createElement(tag) {',
  '    return {',
  "      tagName: String(tag || '').toUpperCase(), id: '', textContent: '', removed: false,",
  '      remove() { this.removed = true; },',
  '      addEventListener() {}',
  '    };',
  '  },',
  '  getElementById() { fabGets += 1; return null; },',
  '  addEventListener(type, fn, capture) { fabListeners.push({ type, fn, capture, active: true }); },',
  '  removeEventListener(type, fn, capture) {',
  '    const found = fabListeners.find(item => item.active && item.type === type && item.fn === fn && item.capture === capture);',
  '    if (found) found.active = false;',
  '  }',
  '};',
  'const fabWindow = { innerWidth: 1200 };',
  'const fabContext = vm.createContext({',
  '  window: fabWindow, document: fabDocument,',
  '  setInterval(fn, ms) { const timer = { fn, ms, active: true }; fabTimers.push(timer); return timer; },',
  '  clearInterval(timer) { if (timer) timer.active = false; },',
  '  setTimeout(fn, ms) { const timer = { fn, ms }; fabTimeouts.push(timer); return timer; }',
  '});',
  'const liveFabTimers = () => fabTimers.filter(timer => timer.active);',
  'const liveFabListeners = () => fabListeners.filter(listener => listener.active && listener.type === "click");',
  '',
  'vm.runInContext(fabIife, fabContext);',
  "assert(fabWindow.__mlsFabTidy && fabWindow.__mlsFabTidy.installed, 'Fab Tidy did not install');",
  "assert.strictEqual(liveFabTimers().length, 1, 'Fab Tidy boot did not own exactly one interval');",
  "assert.strictEqual(liveFabTimers()[0].ms, 1500, 'Fab Tidy interval cadence changed');",
  "assert.strictEqual(liveFabListeners().length, 1, 'Fab Tidy boot did not own exactly one click listener');",
  "assert.strictEqual(liveFabListeners()[0].capture, true, 'Fab Tidy click listener lost capture ordering');",
  'fabGets = 0;',
  'liveFabTimers()[0].fn();',
  "assert.strictEqual(fabGets, 7, 'Fab Tidy force-hide pass changed its installed desktop lookup behavior');",
  "liveFabListeners()[0].fn({ target: { closest(selector) { return selector === '#mlsFab' ? {} : null; } } });",
  "assert.strictEqual(fabTimeouts.length, 1, 'Fab Tidy click no longer schedules one menu augmentation');",
  "assert.strictEqual(fabTimeouts[0].ms, 90, 'Fab Tidy click delay changed');",
  '',
  'const firstFabApi = fabWindow.__mlsFabTidy;',
  'firstFabApi.revert();',
  "assert.strictEqual(liveFabTimers().length, 0, 'Fab Tidy revert leaked its interval');",
  "assert.strictEqual(liveFabListeners().length, 0, 'Fab Tidy revert leaked its click listener');",
  "assert.strictEqual(fabStyles[0].removed, true, 'Fab Tidy revert did not remove its stylesheet');",
  "assert.strictEqual(fabWindow.__mlsFabTidy, undefined, 'Fab Tidy revert retained its global owner');",
  '',
  'vm.runInContext(fabIife, fabContext);',
  "assert(fabWindow.__mlsFabTidy && fabWindow.__mlsFabTidy !== firstFabApi, 'Fab Tidy did not reinstall with a fresh owner');",
  "assert.strictEqual(liveFabTimers().length, 1, 'Fab Tidy reinstall doubled or lost its interval');",
  "assert.strictEqual(liveFabListeners().length, 1, 'Fab Tidy reinstall doubled or lost its click listener');",
  'fabWindow.__mlsFabTidy.revert();',
  "assert.strictEqual(liveFabTimers().length, 0, 'second Fab Tidy revert leaked its interval');",
  "assert.strictEqual(liveFabListeners().length, 0, 'second Fab Tidy revert leaked its click listener');",
  '',
  testAnchor
].join('\n');

const testPlan = prepare('tests/voice-pill-persistence-runtime.test.js', 'utf8', [
  [testAnchor, lifecycleTest]
]);

const plans = [connectPlan, testPlan];

/* Every target and every unique anchor is validated above before the first write. */
plans.forEach(function (plan) {
  fs.writeFileSync(plan.file, plan.next, plan.encoding);
});

console.log('Applied proposal 046: Fab Tidy interval and click owners retire on revert.');
