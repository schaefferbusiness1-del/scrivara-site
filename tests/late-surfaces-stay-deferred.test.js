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
  'feat_mls_lastseen_unify.js',
  /* 2026-07-29 boot-deferral batch: 36 more single-line eager loaders moved to
   * the idle pattern (requestIdleCallback + 2500ms timeout + s.async=true).
   * Listed here are the 17 whose loader line carries the literal
   * data-mls-asset="name" this check greps for; the other 19 use the
   * var A="name" / forEach / id-guard forms and are policed by the
   * boot-script-budget eager ceiling instead. */
  'feat_mls_history_exact.js',
  'feat_mls_orders_exact.js',
  'feat_mls_recs_exact.js',
  'feat_mls_analysis_exact.js',
  'feat_mls_studio_exact.js',
  'feat_mls_help_exact.js',
  'feat_mls_settings_exact.js',
  'feat_mls_widgetinsert.js',
  'feat_mls_datalink_exact.js',
  'feat_mls_patient_reach_v2.js',
  'feat_mls_code_table.js',
  'feat_mls_contrast_fix.js',
  'feat_mls_uifix_20260624.js',
  'feat_mls_clinicaltools_scroll.js',
  'feat_mls_glitch_sweep.js',
  'feat_mls_ptcard_contain.js',
  'feat_mls_caption_entityfix.js',
  'feat_mls_outcome_pdf.js',
  'feat_comp_report.js',
  'feat_mls_study_request.js'
];

for (const name of TRANCHE) {
  const positions = [
    connect.indexOf('data-mls-asset="' + name + '"'),
    connect.indexOf('var A="' + name + '"'),
    connect.indexOf("var A='" + name + "'")
  ].filter((position) => position >= 0);
  assert.strictEqual(positions.length, 1, name + ' loader locator is missing or ambiguous');
  const i = positions[0];
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

console.log('PASS late surfaces stay deferred: ' + TRANCHE.length + ' tranche modules load idle+async and the retired row observer remains absent');
