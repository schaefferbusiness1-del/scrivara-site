'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');
const staging = fs.readFileSync(path.join(root, 'mls-connect.staging.js'), 'utf8');

const expected = [
  ['feat_mls_copilot_unify.js', "'+(window.__MLS_AV||Date.now())"],
  ['feat_copilot_slim.js', '20260719csp211'],
  ['feat_mls_asst_fix.js', "'+(window.__MLS_AV||Date.now())"],
  /* 2026-08-05: ca-2.1.1 — agentic-kind delegation plus the still-loading
     guard (no keyword-guess navigation before the Power module lands). */
  ['feat_mls_copilot_actions.js', "'+(window.__MLS_AV||Date.now())"],
  /* 2026-08-05: cpw-1.2.0 — round 2: the snapshot also carries avatarCheckins
     from the avatar module's event-driven cache, staleness declared. */
  ['feat_mls_copilot_power.js', '20260805cpw130'],
  ['feat_mls_copilot_request_safety.js', "'+(window.__MLS_AV||Date.now())"],
  ['feat_mls_copilot_dock_fix.js', '20260726cdf210']
];

const positions = Object.create(null);
for (const [asset, version] of expected) {
  const marker = `${asset}?v=${version}`;
  positions[asset] = source.indexOf(marker);
  assert(positions[asset] >= 0, `${asset} is missing its release cache tag ${version}`);
  assert.strictEqual(source.indexOf(marker, positions[asset] + 1), -1, `${asset} has duplicate release loaders`);
}

assert(positions['feat_mls_copilot_unify.js'] < positions['feat_copilot_slim.js'], 'conversation ownership must install before context packing');
assert(positions['feat_copilot_slim.js'] < positions['feat_mls_asst_fix.js'], 'context packing must install before Assistant requests');
assert(positions['feat_copilot_slim.js'] < positions['feat_mls_copilot_actions.js'], 'context packing must install before Copilot actions');
assert(positions['feat_copilot_slim.js'] < positions['feat_mls_copilot_request_safety.js'], 'context packing must install before guarded Copilot requests');
assert(positions['feat_copilot_slim.js'] < positions['feat_mls_copilot_power.js'], 'the Power wire cap must wrap OUTSIDE slim (install after it) so slim still packs the bounded body');
assert(positions['feat_mls_copilot_actions.js'] < positions['feat_mls_copilot_power.js'], 'the actions renderer installs before the Power executors it delegates to');

for (const [label, text] of [['production', source], ['staging', staging]]) {
  assert(text.includes("feat_mls_copilot_unify.js?v='+(window.__MLS_AV||Date.now())"),
    `${label} Copilot conversation owner must follow the shared release token`);
  assert(!text.includes('20260716unify110'), `${label} still exposes the retired unify-1.1.0 URL`);
}
assert(staging.indexOf('feat_mls_copilot_unify.js') < staging.indexOf('feat_mls_asst_fix.js'),
  'staging conversation ownership must install before Assistant requests');

console.log('PASS Copilot release loaders: one cache-busted owner per asset and loss-aware context packing installs before requests');
