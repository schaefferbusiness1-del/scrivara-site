'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');

const expected = [
  ['feat_mls_copilot_unify.js', '20260716unify110'],
  ['feat_copilot_slim.js', '20260719csp211'],
  ['feat_mls_asst_fix.js', '20260802asst145'],
  /* 2026-08-05: ca-2.1.1 — agentic-kind delegation plus the still-loading
     guard (no keyword-guess navigation before the Power module lands). */
  ['feat_mls_copilot_actions.js', '20260805ca211'],
  /* 2026-08-05: cpw-1.2.0 — round 2: the snapshot also carries avatarCheckins
     from the avatar module's event-driven cache, staleness declared. */
  ['feat_mls_copilot_power.js', '20260805cpw130'],
  ['feat_mls_copilot_request_safety.js', '20260802crs121'],
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

console.log('PASS Copilot release loaders: one cache-busted owner per asset and loss-aware context packing installs before requests');
