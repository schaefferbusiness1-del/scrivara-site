'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');
const pack = fs.readFileSync(path.join(root, 'feat_mls_b121_pack.js'), 'utf8');

assert(connect.includes('feat_canon_provider retired (2026-07-18)'),
  'legacy product-wide provider override was not explicitly retired');
assert(!/var CANON\s*=\s*["']Matthew Schaeffer, MD/.test(connect),
  'shared clinician bundle still hard-codes one provider identity');
assert(!/setInterval\(apply,\s*4000\)/.test(connect),
  'retired provider override still reasserts itself on an interval');
assert(!/return hits\[0\]/.test(connect),
  'data-driven provider resolver still guesses the first same-surname clinician');
assert(/var stored = unsGet\("providerName"\)/.test(connect) && /providerIdentityKey\(p\) === key/.test(connect),
  'provider resolver must use an explicit Practice value or one exact roster identity');
assert(/ambiguity returns empty/.test(connect),
  'ambiguous roster identity does not document its fail-closed behavior');

function body(name) {
  const start = pack.indexOf(`function ${name}()`);
  assert(start >= 0, `${name} fixture moved`);
  const next = pack.indexOf('\n  function ', start + 12);
  return pack.slice(start, next > start ? next : start + 1600);
}

for (const name of ['gateProvider', 'selfProvider']) {
  const source = body(name);
  assert(!/return\s+["']Matthew Schaeffer, MD["']/.test(source),
    `${name} still guesses an account-specific provider`);
  assert(/return\s+["']["']/.test(source),
    `${name} must fail closed when no roster/account provider is available`);
}

assert(/if \(prov === 'all' && !self\)[\s\S]{0,500}could not verify the signed-in clinician/.test(pack),
  'all-provider chart pull does not stop clearly when clinician identity is unknown');
assert(/Schedule rows were imported, but chart histories were not opened/.test(pack),
  'identity stop does not preserve and explain the completed schedule import');

console.log('PASS provider identity: no account-specific override or fallback; unknown clinician stops chart scope explicitly');
