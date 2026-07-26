'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');
const staging = fs.readFileSync(path.join(root, 'mls-connect.staging.js'), 'utf8');

/* Every entry below changed after its previous immutable URL shipped. A
 * versioned service-worker request is cache-first, so reusing the old token
 * would deterministically replay stale code for an existing clinician. */
const assets = [
  ['feat_athena_doctor.js', '20260719ad104', '20260714ad103'],
  ['feat_athena_tooltip_dedupe.js', '20260725ui124', '20260724ui123'],
  ['feat_b18_qa.js', '20260719b18v9', '20260719b18v8'],
  ['feat_copilot_slim.js', '20260719csp211', '20260716csp210'],
  ['feat_mls_asst_fix.js', '20260723asst144', '20260719asst143'],
  ['feat_mls_b121_pack.js', '20260726p2c4', '20260719p2c3'],
  ['feat_mls_checker.js', '20260726chk3021r1', '20260725chk3020r1'],
  ['feat_mls_force_full_phone.js', '20260719ffp200', '20260630c1'],
  ['feat_mls_header_exact.js', '20260719hx302', '20260716hx301'],
  ['feat_mls_loading_calm.js', '20260719lb204', '20260719lb203'],
  ['feat_mls_provider_passthrough.js', '20260722pp1c5', '20260702pp1c1'],
  ['feat_mls_redesign.js', '20260726rd326', '20260725rd325'],
  ['feat_mls_simple_exact.js', '20260719simx142', '20260716simx141'],
  ['feat_mls_study_calm.js', '20260719sg2e', '20260713sg2d'],
  ['feat_mls_wb_console.js', '20260722wbc131', '20260630wbc1c1-B177'],
  ['feat_mls_widget_deck.js', '20260719wd110', '20260713wd2'],
  ['feat_mls_widgetinsert.js', '20260719wi3', '20260624wi2c1'],
  ['feat_mls_topbar_unify.js', '20260722tb111', '20260719tb109'],
  ['feat_mls_command_palette.js', '20260724cmd104', '20260719cmd103'],
  ['feat_mls_copilot_voice_v2.js', '20260726cv2130', '20260723cv2121'],
  ['feat_mls_voice_commands.js', '20260726vc110', '20260625vc1c1'],
  ['feat_mls_voice_ai_micbridge.js', '20260726mb110', '20260625mb1c1'],
  ['feat_mls_voice_ai.js', '20260719vaihot112', '20260719vai112'],
  ['feat_mls_dictate_anywhere.js', '20260719da111h1', "s.src='feat_mls_dictate_anywhere.js?v='+(window.__MLS_AV||Date.now())"],
  ['feat_mls_pervisit_unify.js', '20260725pvu1c2', '20260629pvu1c1'],
  ['feat_mls_progress_stages.js', '20260722ps131', "s.src='feat_mls_progress_stages.js?v='+(window.__MLS_AV||Date.now())"],
  ['feat_task3_frontsync.js', '20260723t3108', '20260719t3107'],
  ['feat_mls_upnow_realtime.js', '20260723unr110', '20260626unr1c1']
];

assert.strictEqual(new Set(assets.map(entry => entry[1])).size, assets.length,
  'changed immutable satellites must not share a release token');

for (const [asset, token, retired] of assets) {
  assert(connect.includes(asset), `${asset} production loader is missing`);
  assert.strictEqual(connect.split(token).length - 1, 1,
    `${asset} must have exactly one production loader using ${token}`);
  assert(!connect.includes(retired), `${asset} still exposes retired cache token ${retired}`);
}

assert(staging.includes('feat_mls_checker.js?v=20260726chk3021r1'),
  'staging checker loader must use the same corrected immutable URL');
assert(!staging.includes('feat_mls_checker.js?v=20260714chk2922r1'),
  'staging checker loader still exposes the retired immutable URL');
assert(staging.includes('feat_mls_command_palette.js?v=20260724cmd104'),
  'staging must load the same canonical Ctrl/Cmd+K owner as production');

console.log('PASS immutable satellite loaders: ' + assets.length + ' changed assets use fresh, unique cache URLs and retired URLs are unreachable');
