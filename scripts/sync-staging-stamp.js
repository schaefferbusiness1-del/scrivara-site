#!/usr/bin/env node
'use strict';

/*
 * Force ScribeFlow-staging.html's asset stamp to match production's.
 *
 * WHY THIS EXISTS. The staging loader builds its bundle URL from its own
 * `window.__MLS_AV`, and three lanes ship from three different bump scripts.
 * Two of them force the staging stamp; one does not. The result has drifted at
 * b586, b587, b595, b598, b599, b601 and b607 — every time caught by
 * tests/staging-stamp-follows-production.test.js, and every time repaired by
 * hand, which is why it keeps coming back.
 *
 * The durable fix is not a better memory, it is a one-liner any lane can run:
 *
 *     node scripts/sync-staging-stamp.js
 *
 * Call it from your bump path, right after you bump production. It is
 * idempotent and prints "already in sync" when there is nothing to do, so it is
 * safe to run unconditionally.
 *
 * It FORCES rather than increments, deliberately: staging's current value is
 * usually behind by an unknown number of builds, so "increment what is there"
 * lands on a token that never existed.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PROD = path.join(ROOT, 'ScribeFlow.html');
const STAGING = path.join(ROOT, 'ScribeFlow-staging.html');

const STAMP = /__MLS_AV\s*=\s*'(b\d+)'/g;

function readStamp(file, label) {
  const src = fs.readFileSync(file, 'latin1');
  const hits = [...src.matchAll(STAMP)];
  if (hits.length !== 1) {
    console.error(label + ': expected exactly one __MLS_AV stamp, found ' + hits.length + '. Refusing to guess.');
    process.exit(1);
  }
  return { src: src, token: hits[0][1] };
}

const prod = readStamp(PROD, 'ScribeFlow.html');
const staging = readStamp(STAGING, 'ScribeFlow-staging.html');

if (prod.token === staging.token) {
  console.log('staging stamp already in sync (' + prod.token + ')');
  process.exit(0);
}

fs.writeFileSync(STAGING, staging.src.replace(STAMP, "__MLS_AV='" + prod.token + "'"), 'latin1');
console.log('staging stamp ' + staging.token + ' -> ' + prod.token + ' (forced to production)');
