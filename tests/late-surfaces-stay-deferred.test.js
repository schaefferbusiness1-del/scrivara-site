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
  /* 2026-07-29 boot-deferral batch: 34 safe single-line loaders remain on
   * the idle pattern (requestIdleCallback + 2500ms timeout + s.async=true).
   * Listed here are the 18 whose loader line carries the literal
   * data-mls-asset="name" this check greps for; the other 16 use the
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
  'feat_mls_contrast_fix.js',
  'feat_mls_uifix_20260624.js',
  'feat_mls_clinicaltools_scroll.js',
  'feat_mls_glitch_sweep.js',
  'feat_mls_ptcard_contain.js',
  'feat_mls_caption_entityfix.js',
  'feat_mls_outcome_pdf.js',
  'feat_comp_report.js',
  'feat_mls_study_request.js',
  /* 2026-08-02 idle sweep: 28 more analyzed-safe satellite loaders moved in
   * place to the idle pattern (requestIdleCallback + 2500ms timeout +
   * s.async=true). Listed here are the 26 whose loader is the single-line
   * var A="name" form this check greps for; the two feat_athena_cardtips*
   * multi-line block loaders are policed by the boot-script-budget eager
   * ceiling instead. */
  'feat_mls_checker.js',
  'feat_mls_wb_console.js',
  'feat_mls_assistant_selffix.js',
  'feat_athena_narration.js',
  'feat_mls_show_assistant.js',
  'feat_mls_asst_provname.js',
  'feat_mls_settings_wb.js',
  'feat_visit_history_ext.js',
  'feat_visit_note_detail.js',
  'feat_mls_pervisit_unify.js',
  'feat_mls_hero_search.js',
  'feat_mls_whosnext.js',
  'feat_mls_find_doctors.js',
  'feat_mls_nextup_controls.js',
  'feat_mls_pick_smartscope.js',
  'feat_mls_visit_useactivept.js',
  'feat_mls_hero_glance.js',
  'feat_mls_whosnext_cleanfix.js',
  'feat_mls_portal_request_inbox.js',
  'feat_mls_widget_deck.js',
  'feat_mls_stop_confirm.js',
  'feat_mls_caldedupe_render.js',
  'feat_mls_apptabs_menu.js',
  'feat_mls_dob_format_unify.js',
  'feat_mls_ctxbar_age_dedupe.js',
  'feat_mls_ctxbar_dob_slash.js'
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

/* 2026-07-29: Procedure Report snapshots RVU values on first mount, so its
 * deferred loader must wait for the RVU script or reach a bounded fallback. */
const procedureLoaderLine = connect.split(/\r?\n/).find((line) => line.includes("s.src='mls-procedure-report.js?v=20260807lib7'"));
assert(procedureLoaderLine && procedureLoaderLine.includes('function waitForRvu(tries)') &&
  procedureLoaderLine.includes('window.__mlsRVU||tries>=30') &&
  procedureLoaderLine.includes('setTimeout(function(){waitForRvu(tries+1);},100)'),
  'Procedure Report can race RVU and freeze fallback totals into its first render');
assert.strictEqual((connect.match(/mls-procedure-report\.js\?v=20260807lib7/g) || []).length, 1,
  'Procedure Report must retain one bounded production loader');

/* Patient rows now emit the exact final last-seen label themselves. Keeping
 * the old observer out of the loader is stronger than merely deferring it:
 * no whole-document observer or detached-row retention can return. */
assert(!connect.includes('data-mls-asset="feat_mls_lastseen_rows.js"'),
  'retired last-seen row observer returned to the production loader');

console.log('PASS late surfaces stay deferred: ' + TRANCHE.length + ' tranche modules load idle+async and the retired row observer remains absent');
