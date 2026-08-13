'use strict';

/* Production has one supported navigation owner. A stale Classic preference
 * must heal automatically because that retired rail can render off-screen. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const shell = fs.readFileSync(path.join(root, 'feat_mls_calm_shell.js'), 'utf8');

assert(/function\s+enabled\s*\(\)[\s\S]*?localStorage\.setItem\(STORE_KEY,\s*'1'\)[\s\S]*?return\s+true/.test(shell),
  'a stale Classic preference is not healed automatically');
assert(!/\n\s*classicSwitch\(\);/.test(shell),
  'boot still exposes the retired Classic navigation choice');
assert(!/if\s*\(!enabled\(\)\)\s*return\s+mountReturn\(\)/.test(shell),
  'boot can still strand production in the retired Classic shell');

console.log('PASS production Calm navigation is automatic and cannot persist Classic mode');
