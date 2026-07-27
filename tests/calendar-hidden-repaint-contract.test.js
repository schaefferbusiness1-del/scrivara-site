'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const box = fs.readFileSync(path.join(root, 'feat_mls_calbox_uniform.js'), 'utf8');
const dedupe = fs.readFileSync(path.join(root, 'feat_mls_caldedupe_render.js'), 'utf8');

assert(box.includes("var VERSION = 'cb-1.1.0'"), 'Calendar box hidden-repaint version was not advanced');
assert(box.includes("window.__mlsCurrentView === 'calendar' && typeof window.renderCalendar === 'function'"),
  'Calendar box styling still repaints the hidden Calendar during Visit/login');

assert(dedupe.includes('var WRAPPED = ["renderCalendar", "calOpenDay"];'),
  'Calendar dedupe still scans appointments for provider-only check-in renders');
assert(!dedupe.includes('"renderCalCheckin"'), 'Calendar dedupe still wraps provider-only check-in rendering');
assert(dedupe.includes('if (window.__mlsCurrentView === "calendar") {') &&
  dedupe.includes('version: "caldedupe-1.1.0"'),
  'Calendar dedupe still performs its install repaint off-view');

console.log('PASS hidden Calendar repaint: styling/dedupe wait for Calendar and check-in skips appointment scans');
