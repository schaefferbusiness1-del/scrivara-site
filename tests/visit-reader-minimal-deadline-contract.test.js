'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
const lineageStart = background.indexOf('/* === MLS Assist visit-reader lineage (active: v2.9.22 r4)');
const lineageEnd = background.indexOf('\n})();', lineageStart);
assert(lineageStart >= 0 && lineageEnd > lineageStart, 'active visit reader IIFE missing');
const reader = background.slice(lineageStart, lineageEnd + '\n})();'.length);

const driverStart = reader.indexOf('function mlsVisitsDriverFn(op, cfg, idx, expectedBinding)');
const driverEnd = reader.indexOf('// ---- orchestrator (background scope', driverStart);
assert(driverStart >= 0 && driverEnd > driverStart, 'visit DOM driver missing');
const driverDecl = reader.slice(driverStart, driverEnd);

function detailFrame(raw, { ready = 'complete', busy = false, min = 8 } = {}) {
  const section = {
    innerText: raw,
    textContent: raw,
    getAttribute(name) { return name === 'aria-busy' && busy ? 'true' : null; }
  };
  const context = {
    Map, Math, Number, String, Array, Object, RegExp, Date,
    location: { href: 'https://athenanet.athenahealth.com/encounter/summary?FROMSTREAMLINED=1&CROSSFRAMEID=test' },
    document: {
      readyState: ready,
      getElementById(id) { return id === 'SECTIONCONTAINER' ? section : null; }
    }
  };
  const cfg = JSON.stringify({ allowMinimalBody: true, minMinimalBodyLen: min });
  vm.runInNewContext(
    driverDecl + `\nthis.__detail = mlsVisitsDriverFn('detailFrame', ${cfg}, 0, { index: 0, rowKey: 'enc:test', encounterId: 'test' });`,
    context,
    { filename: 'visit-minimal-body-driver.js', timeout: 1000 }
  );
  return context.__detail;
}

for (const sample of ['', '   ', 'tiny']) {
  const result = detailFrame(sample);
  assert.strictEqual(result.fullDetail, false, `empty/under-floor body was accepted: ${JSON.stringify(sample)}`);
  assert.strictEqual(result.sectionComplete, false);
  assert(Number.isFinite(result.observedLen) && result.observedLen >= 0, 'failure omitted honest observed length');
  assert.strictEqual(result.minAcceptedLen, 8, 'failure omitted the minimal-body floor');
}

for (const sample of ['Loading…', 'Please wait', 'Retrieving encounter data']) {
  const result = detailFrame(sample);
  assert.strictEqual(result.fullDetail, false, `loading placeholder was accepted: ${sample}`);
  assert.strictEqual(result.reason, 'encounter-section-loading');
}

assert.strictEqual(detailFrame('No acute changes.', { ready: 'interactive' }).fullDetail, false, 'unfinished document accepted a minimal body');
assert.strictEqual(detailFrame('No acute changes.', { busy: true }).fullDetail, false, 'aria-busy section accepted a minimal body');

const brief = detailFrame('No acute changes.');
assert.strictEqual(brief.fullDetail, true, 'complete bound brief body was rejected');
assert.strictEqual(brief.bodyMinimal, true);
assert.strictEqual(brief.sectionComplete, true);
assert.strictEqual(brief.observedLen, 'No acute changes.'.length);
assert.strictEqual(brief.minAcceptedLen, 8);

const runStart = reader.indexOf('function runAllVisits(appTabId, hint, cfg, requestId)');
const runEnd = reader.indexOf('// --- v1.40: publish the PROVEN read-all-visits engine', runStart);
assert(runStart >= 0 && runEnd > runStart, 'runAllVisits body missing');
const run = reader.slice(runStart, runEnd);

assert(run.includes('var readDeadline = readStartedAt + readBudgetMs'), 'absolute read deadline does not begin at reader entry');
assert(run.includes('var coldRetryReserveMs = coldRetryWaitMs + coldRetryPauseMs + 700'), 'admission budget omits the cold retry');
assert(run.includes('remainingReadBudgetMs - 15000 - coldRetryReserveMs'), 'maxByBudget does not subtract the cold retry reserve');
assert(run.includes('Math.min(readDeadline, Date.now() + rowWaitMs)'), 'per-phase attempt deadlines are not clamped to the absolute reader deadline');
assert((run.match(/waitForDetailSurface\([^\n]+readDeadline\)/g) || []).length >= 3, 'surface waits can outlive the absolute reader deadline');
assert(run.includes('sleepWithinReadDeadline'), 'poll/retry sleeps are not deadline bounded');
assert(run.includes("reason: 'read-deadline-exceeded'"), 'deadline exhaustion is not reported honestly');
assert(run.includes('attempted: attemptedCount'), 'deadline failure still claims every row was attempted');
assert(run.includes('if (Date.now() >= readDeadline)'), 'final completion can pass after the absolute deadline');
assert(!run.includes('var readDeadline = Date.now() + readBudgetMs'), 'reader still resets its budget after navigation');

console.log('PASS visit reader minimal-body completeness + absolute deadline contract');
