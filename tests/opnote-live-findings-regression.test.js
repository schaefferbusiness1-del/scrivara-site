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

/* What this pins is LOAD ORDER - the strict template owner must be injected
   after the field filler, because it wraps what the filler installs. It located
   both by their exact cache tokens, which made it a token pin as well, and it
   broke the moment feat_mls_opnote_integrity.js moved to the build-following
   `?v=' + (window.__MLS_AV || Date.now())` form. That move was itself a fix: the
   literal token was two days older than the file's content, so a returning
   browser kept a cached module and none of the recent changes reached it
   (tests/cache-token-cannot-go-stale.test.js is the general guard).
   Find the loaders by ASSET NAME, which is what the ordering is about, and let
   either token spelling satisfy it. */
const loaderAt = (source, asset) => source.indexOf(asset + '?v=');
for (const [name, source] of [['production', prod], ['staging', staging]]) {
  const fillAt = loaderAt(source, 'feat_mls_opnote_fill.js');
  const integrityAt = loaderAt(source, 'feat_mls_opnote_integrity.js');
  assert(fillAt >= 0, `${name} does not load the corrected known-field filler`);
  assert(integrityAt >= 0, `${name} does not load the strict template owner at all`);
  assert(integrityAt > fillAt, `${name} does not load the strict template owner after the field filler`);
}

['#apName', '#apDob', '#apMrn', '#apSex', '#apPhone'].forEach(selector => {
  assert(ease.includes(selector), `patient-specific Add visit does not use the real ${selector} field`);
});
assert(ease.includes("data-mlsease-visitmode") && ease.includes("inp.readOnly = true") && ease.includes("Save visit"),
  'patient-specific Add visit can still look like or edit a second patient identity');

console.log('PASS live op-note findings: final generator ownership, NPI safety, production/staging order, and patient-specific visit UI');
