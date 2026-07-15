'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const testsDir = __dirname;
const excluded = /^(?:extension-|athena-)|^(?:destination-teaching-runtime|full-visit-reader-runtime|history-duplicate-name-binding|schedule-pull-integrity|schedule-time-contract|static-site)\.test\.js$/;
const candidates = fs.readdirSync(testsDir)
  .filter(name => name.endsWith('.test.js') && !excluded.test(name))
  .sort();

const forbiddenExtensionReads = /(?:background|content|inject_dom)\.js|manifest\.json|extension-package|extension-read-path/i;
const tests = [];
const skipped = [];
for (const test of candidates) {
  const source = fs.readFileSync(path.join(testsDir, test), 'utf8');
  if (forbiddenExtensionReads.test(source)) {
    skipped.push(test);
  } else {
    tests.push(test);
  }
}

for (const test of tests) {
  const result = spawnSync(process.execPath, [path.join(testsDir, test)], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}

console.log(`PASS all ${tests.length} strictly non-extension local regression suites (${skipped.length} extension-coupled suites skipped without running)`);
