'use strict';
/* navtruth-1.0.0 (2026-09-15) - the four small S3 items of workstream 3
 * (AUDIT_STATE_TRUTH_2026-09-15.md F6, F7, F8, F10), each verified by hand.
 *
 *  F6  nothing repainted the Patients / History badges after a day pull;
 *      the pull lane's own mls:pull-terminal event now schedules them.
 *  F7  an ACTIVE id the roster snapshot could not resolve painted the whole
 *      account's note total as if nothing were selected; now that id is
 *      counted from the notes index and only an empty selection shows total.
 *  F8  NOT taken: the badge task's requestIdleCallback deliberately has no
 *      timeout (route-patient-read-fastpath-contract pins that it may never
 *      run into the first-input window); F6's terminal repaint covers the
 *      post-pull case the audit cared about.
 *  F10 the attention re-read took DS.retrying without telling the retry
 *      controls, and its guard ignored the open full-visit-notes choice.
 *
 * Part 1 pins both 1p twins and the connect bundle. Part 2 EXECUTES the
 * shell's updateNavCounts / updateHistoryNavCount against a stubbed notes
 * index. Synthetic ids only.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const shell = read('1pScribeFlow.html'), twin = read('1p/index.html'), connect = read('1p-mls-connect.js');
let checks = 0;
const ok = (c, m) => { checks++; assert.ok(c, m); };
const eq = (a, b, m) => { checks++; assert.strictEqual(a, b, m + '\n   got: ' + JSON.stringify(a) + '\n   expected: ' + JSON.stringify(b)); };

/* ---- Part 1: pins, both twins ------------------------------------------ */
for (const [name, src] of [['1pScribeFlow.html', shell], ['1p/index.html', twin]]) {
  ok(src.includes("  window.addEventListener('mls:pull-terminal',function(){try{scheduleNavCounts();}catch(eNav){}},false);"), name + ': F6 the pull terminal schedules the badges');
  ok(src.includes("  updateHistoryNavCount(ap?ap.id:(activeId?String(activeId):''));"), name + ': F7 an unresolved active id is counted, not replaced by the total');
  ok(src.includes("      __mlsNavCountTask=window.requestIdleCallback(run);"), name + ': F8 left alone - the fastpath contract owns the no-timeout idle task');
  eq(src.split('navtruth-1.0.0').length - 1, 2, name + ': two navtruth hunks');
}
ok(connect.includes("    if (DS.pulling || DS.retrying || DS.__autoRetrying || DS.preferenceGatePending) { /* navtruth-1.0.0 (F10)"), 'F10: the attention re-read guard includes the open choice');
ok(connect.includes("    dsLeaseHold();\n    try { syncRetryControl(DS.lastResult); } catch (eRaSync0) {}"), 'F10: the retry controls are told on the way in');
ok(connect.includes("      DS.retrying = false;\n      dsLeaseRelease();\n      try { syncRetryControl(DS.lastResult); } catch (eRaSync1) {}"), 'F10: and on the way out');
eq(connect.split('navtruth-1.0.0').length - 1, 3, 'three navtruth hunks in the connect bundle');

/* ---- Part 2: the shell's badge functions, executed ---------------------- */
function fn(src, name) {
  const a = src.indexOf('function ' + name + '(');
  assert(a > 0, name + ' not found');
  const b = src.indexOf('\n}\n', a);
  return src.slice(a, b + 3);
}
const code = fn(shell, 'updateHistoryNavCount') + '\n' + fn(shell, 'updateNavCounts');
function run(activeId, patients) {
  const nodes = { navPtCount: { textContent: '' }, navHistCount: { textContent: '' }, navOrdCount: { textContent: '' } };
  const ctx = {
    document: { getElementById: (id) => nodes[id] || null },
    getPatients: () => patients,
    getActivePtId: () => activeId,
    currentOrders: [],
    String, Array, Number,
    /* the notes index: per-patient counts for two synthetic ids, a big total */
    __mlsNoteCounts: (id) => (id === 'syn-A' ? { patientCount: 3, orphanCount: 0, total: 412 } : id === 'syn-gone' ? { patientCount: 2, orphanCount: 1, total: 412 } : { patientCount: 0, orphanCount: 0, total: 412 }),
  };
  vm.runInNewContext(code + '\nupdateNavCounts();', ctx, { filename: 'nav-counts.js' });
  return { pt: nodes.navPtCount.textContent, hist: nodes.navHistCount.textContent };
}
const roster = [{ id: 'syn-A' }, { id: 'syn-B' }];
eq(String(run('syn-A', roster).hist), '3', 'a resolved active patient shows its own count');
eq(String(run('', roster).hist), '412', 'no active patient shows the total (documented contract)');
eq(String(run('syn-gone', roster).hist), '3', 'F7: an active id the roster cannot resolve is counted from the notes index (2 + 1 orphan), never the 412 total');
eq(String(run('syn-gone', roster).pt), '2', 'the patient badge still counts the roster');

console.log('PASS navtruth-1.0.0: badges repaint on the pull terminal, an unresolved active id is counted not totalled, the attention re-read tells the retry controls (' + checks + ' checks)');
