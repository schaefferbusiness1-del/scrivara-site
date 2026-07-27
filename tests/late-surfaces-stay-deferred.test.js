'use strict';

/* LATE SURFACES STAY DEFERRED (b738, owner escalation: "login is STILL taking
 * way too long"). Sixteen self-contained late-surface modules moved from the
 * eager async=false boot chain to idle-deferred loading - none of them has a
 * claim on the sign-in seconds. This suite keeps them there: a module quietly
 * moved back to the eager chain re-slows every boot. Layered chains (opnote,
 * copilot, writeback, pull) were deliberately NOT moved. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');

const TRANCHE = [
  'feat_opnote_pdf_anyview.js',
  'feat_after_visit_summary.js',
  'mls-template-stdline.js',
  'feat_stdline_insert.js',
  'feat_mls_dictate_letter.js',
  'feat_mls_study_calm.js',
  'feat_mls_template_library.js',
  'feat_mls_history_avs.js',
  'feat_mls_visit_timeline.js',
  'feat_mls_visit_timeline_detail.js',
  'feat_mls_timeline_sync.js',
  'feat_mls_patient_merge.js',
  'feat_mls_calbox_uniform.js',
  'feat_mls_avs_label_unify.js',
  'feat_mls_lastseen_unify.js'
];

for (const name of TRANCHE) {
  const i = connect.indexOf('data-mls-asset="' + name + '"');
  assert(i > 0, name + ' has no loader at all');
  const lineStart = connect.lastIndexOf('\n', i) + 1;
  const line = connect.slice(lineStart, connect.indexOf('\n', i));
  assert(line.indexOf('requestIdleCallback') >= 0,
    name + ' is EAGER again - a late surface re-entered the sign-in path and every boot pays for it');
  assert(line.indexOf("s.async=true") >= 0,
    name + ' loads with async=false - it re-serializes the main thread it was moved off of');
}

/* Patient rows now emit the exact final last-seen label themselves. Keeping
 * the old observer out of the loader is stronger than merely deferring it:
 * no whole-document observer or detached-row retention can return. */
assert(!connect.includes('data-mls-asset="feat_mls_lastseen_rows.js"'),
  'retired last-seen row observer returned to the production loader');

console.log('PASS late surfaces stay deferred: 15 tranche modules load idle+async and the retired row observer remains absent');
