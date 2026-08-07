'use strict';

/*
 * QA complete run — every suite in the registry, every failure reported.
 *
 * WHY THIS EXISTS, measured on origin/main 9a397938 (b940) 2026-08-07:
 * run-all.js is fail-fast — `if (r.status !== 0) process.exit(...)`. When
 * `cache-token-cannot-go-stale.test.js` (registry position 90 of 501) went red
 * on the tip, the 411 suites behind it did not run at all. The gate reported
 * exactly one defect and could not have reported a second. A lane reading that
 * output would fix the one and ship, still blind to anything after position 90.
 *
 * This runner executes the SAME registry, in the SAME order, with the SAME
 * node — it only removes the early exit, so one red suite can no longer hide
 * the ones behind it. It is a diagnostic companion to run-all.js, not a
 * replacement: run-all.js stays the ship gate (fail-fast is correct when the
 * answer you need is go/no-go), and this is what you run to learn the full
 * shape of a red tree.
 *
 * The registry is PARSED from run-all.js rather than copied. A second
 * hand-maintained list of 501 suites would drift from the first, and a QA
 * runner that silently checks fewer suites than the gate is worse than none.
 *
 *   node tests/qa-complete-run.js                 # this repo
 *   QA_REPORT=/tmp/qa.json node tests/qa-complete-run.js
 *
 * Exits 0 only when every suite in the registry passed.
 */

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PER_SUITE_TIMEOUT_MS = 300000;

function readRegistry() {
  const source = fs.readFileSync(path.join(ROOT, 'tests', 'run-all.js'), 'utf8');
  const start = source.indexOf('const tests = [');
  if (start === -1) throw new Error('run-all.js no longer declares `const tests = [` — update this parser deliberately.');
  const block = source.slice(start);
  const end = block.indexOf('\n];');
  if (end === -1) throw new Error('run-all.js registry array is not terminated by `\\n];` — update this parser deliberately.');
  const names = [...block.slice(0, end).matchAll(/'([^']+\.js)'/g)].map((m) => m[1]);
  /* A registry that parses to a suspiciously small set means the parser broke,
   * not that the project deleted 400 suites. Refuse rather than report green
   * on a handful — the failure mode this whole file exists to prevent. */
  if (names.length < 100) throw new Error(`parsed only ${names.length} suites from the registry; the parser is broken`);
  return names;
}

const tests = readRegistry();
const failures = [];
let passed = 0;

process.stdout.write(`QA complete run — ${tests.length} suites from the run-all.js registry\n\n`);

for (const test of tests) {
  const file = path.join(ROOT, 'tests', test);
  if (!fs.existsSync(file)) {
    failures.push({ test, reason: 'MISSING FILE', output: 'listed in the registry but not present on disk' });
    process.stdout.write(`FAIL ${test} (missing file)\n`);
    continue;
  }
  const r = spawnSync(process.execPath, [file], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: PER_SUITE_TIMEOUT_MS
  });
  if (r.status === 0) {
    passed++;
    continue;
  }
  const reason = r.error && r.error.code === 'ETIMEDOUT'
    ? `TIMEOUT after ${PER_SUITE_TIMEOUT_MS / 1000}s`
    : `exit ${r.status}`;
  /* Keep the TAIL: node prints the assertion and its message last, and that is
   * the part that names the defect. */
  const output = `${r.stdout || ''}\n${r.stderr || ''}`.trim().slice(-4000);
  failures.push({ test, reason, output });
  process.stdout.write(`FAIL ${test} (${reason})\n`);
}

process.stdout.write(`\n===== QA COMPLETE RUN =====\npassed: ${passed}/${tests.length}\nfailed: ${failures.length}\n`);
for (const f of failures) {
  process.stdout.write(`\n----- ${f.test} (${f.reason}) -----\n${f.output}\n`);
}

if (process.env.QA_REPORT) {
  fs.writeFileSync(process.env.QA_REPORT, JSON.stringify({ total: tests.length, passed, failures }, null, 2));
  process.stdout.write(`\nreport: ${process.env.QA_REPORT}\n`);
}

process.exit(failures.length ? 1 : 0);
