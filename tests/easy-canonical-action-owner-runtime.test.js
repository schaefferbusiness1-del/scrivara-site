'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'mls-connect.js'), 'utf8');
const canonicalMarker = source.indexOf('the effortless Visit tab  (__mlsEasyV32)');
const canonicalStart = source.indexOf('(function () {', canonicalMarker);
const canonicalEnd = source.indexOf('\n})();', canonicalStart);
assert(canonicalMarker >= 0 && canonicalStart >= 0 && canonicalEnd > canonicalStart, 'canonical Easy owner could not be bounded');
const canonical = source.slice(canonicalStart, canonicalEnd);
assert(canonical.includes("var VER = '3.7.2'"), 'unexpected canonical Easy version');
assert(canonical.includes('installScheduledVisitBinding(a) && exactScheduledBindingMatches(a)'), 'canonical owner lacks exact scheduled binding read-back');
assert(canonical.includes('if (!exactBindingReady) { render(); return; }'), 'canonical owner can action after binding failure');
assert(canonical.includes("window.addEventListener('mls:session-boundary', resetEasySession)"), 'canonical owner lacks synchronous account reset');
assert(canonical.includes('window.__mlsEasyV32 = api;'), 'canonical API is not claimed by its synchronous IIFE');

const retired = [
  { version: "var VER = '3.4.1'", label: 'Easy 3.4.1' },
  { version: "var VER = '3.2.1'", label: 'Easy 3.2.1' },
  { version: "var VER = '3.1.1'", label: 'Easy 3.1.1' },
  { version: "var VER = '3.0.0'", label: 'Easy 3.0' },
  { version: "var VERSION = '1.1.0'", label: 'in-place Easy' }
];

for (const item of retired) {
  const versionAt = source.indexOf(item.version, canonicalEnd);
  assert(versionAt > canonicalEnd, `${item.label}: historical owner marker missing`);
  const start = source.lastIndexOf('(function () {', versionAt);
  assert(start > canonicalEnd, `${item.label}: historical IIFE start missing`);
  const prefix = source.slice(start, versionAt);
  const returnAt = prefix.indexOf('\n  return;');
  assert(returnAt >= 0, `${item.label}: historical owner is still activatable`);
  const firstGuard = Math.min(...[
    prefix.indexOf('window.__mlsEasyV32'), prefix.indexOf('window.__mlsEasyV31'),
    prefix.indexOf('window.__mlsEasyV3'), prefix.indexOf('window.__mlsEasyInplace'),
    prefix.indexOf('document.'), prefix.indexOf('location.')
  ].filter(index => index >= 0));
  assert(firstGuard === Infinity || returnAt < firstGuard, `${item.label}: touches runtime state before failing closed`);

  // Execute exactly the initial IIFE path against hostile globals. Any guard,
  // DOM, storage, or timer access before the unconditional return throws.
  const executablePrefix = source.slice(start, start + returnAt + '\n  return;'.length) + '\n})();';
  const hostile = new Proxy({}, { get() { throw new Error(`${item.label} touched window`); } });
  assert.doesNotThrow(() => vm.runInNewContext(executablePrefix, {
    window: hostile,
    document: new Proxy({}, { get() { throw new Error(`${item.label} touched document`); } }),
    location: new Proxy({}, { get() { throw new Error(`${item.label} touched location`); } })
  }), `${item.label}: unusual load timing activated historical code`);
}

const lockStarts = [];
let cursor = -1;
while ((cursor = source.indexOf('function lockAndStart(a, opts)', cursor + 1)) >= 0) lockStarts.push(cursor);
assert(lockStarts.length >= 5, 'expected historical lockAndStart lineages were not found');
assert(lockStarts[0] > canonicalStart && lockStarts[0] < canonicalEnd, 'first action owner is not canonical Easy');
for (const position of lockStarts.slice(1)) {
  const enclosingRetired = retired.some(item => {
    const versionAt = source.indexOf(item.version, canonicalEnd);
    const start = source.lastIndexOf('(function () {', versionAt);
    const end = source.indexOf('\n})();', versionAt);
    return start >= 0 && end > start && position > start && position < end;
  });
  assert(enclosingRetired, `later lockAndStart at offset ${position} is not inside a fail-closed retired owner`);
}

console.log('PASS canonical Easy action ownership: the 3.7.2 owner is first and exact-gated; every later record/generate lineage returns before runtime/DOM access');
