'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const fill = read('feat_mls_opnote_fill.js');
const integrity = read('feat_mls_opnote_integrity.js');
const ease = read('feat_ease.js');
const prod = read('mls-connect.js');
const staging = read('mls-connect.staging.js');

assert(/if \(\/\\bnpi\\b\/\.test\(l\)\) return S\(prof\.npi\)\.trim\(\);/.test(fill),
  'blank NPI still falls through to the generic provider-name auto-fill rule');
assert(integrity.includes('generate.__opnpWrapped=true;') && integrity.includes('generate.__mlsopWrapped=true;'),
  'strict template generator does not block both legacy ownership heartbeats');
assert(integrity.includes('oneWrap.__opnpWrapped=true;'),
  'single-note strict wrapper can still be replaced by the legacy prep heartbeat');
assert(prod.includes('canonical template-driven op-note Fields workflow owns this feature') &&
  !prod.includes("s.src='feat_mls_opnote_fillblank.js"),
  'production still loads a competing legacy fill-in-the-blank op-note UI');

for (const [name, source] of [['production', prod], ['staging', staging]]) {
  const fillAt = source.indexOf('feat_mls_opnote_fill.js?v=20260727onf2111');
  const integrityAt = source.indexOf('feat_mls_opnote_integrity.js?v=20260726oni2160');
  assert(fillAt >= 0, `${name} does not load the corrected known-field filler`);
  assert(integrityAt > fillAt, `${name} does not load the strict template owner after the field filler`);
}

['#apName', '#apDob', '#apMrn', '#apSex', '#apPhone'].forEach(selector => {
  assert(ease.includes(selector), `patient-specific Add visit does not use the real ${selector} field`);
});
assert(ease.includes("data-mlsease-visitmode") && ease.includes("inp.readOnly = true") && ease.includes("Save visit"),
  'patient-specific Add visit can still look like or edit a second patient identity');

console.log('PASS live op-note findings: final generator ownership, NPI safety, production/staging order, and patient-specific visit UI');
