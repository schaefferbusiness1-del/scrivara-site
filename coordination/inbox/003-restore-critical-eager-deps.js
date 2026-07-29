'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const connectPath = path.join(root, 'mls-connect.js');
const lateTestPath = path.join(root, 'tests', 'late-surfaces-stay-deferred.test.js');
const budgetTestPath = path.join(root, 'tests', 'boot-script-budget.test.js');

function replaceExactlyOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(label + ': expected source text was not found');
  const second = source.indexOf(before, first + before.length);
  if (second >= 0) throw new Error(label + ': expected source text is ambiguous');
  return source.slice(0, first) + after + source.slice(first + before.length);
}

let connect = fs.readFileSync(connectPath, 'latin1');
let lateTest = fs.readFileSync(lateTestPath, 'utf8');
let budgetTest = fs.readFileSync(budgetTestPath, 'utf8');

connect = replaceExactlyOnce(
  connect,
  ";(function(){try{var sched=window.requestIdleCallback||function(f){return setTimeout(f,900);};sched(function(){if(document.querySelector('script[data-mls-asset=\"feat_mls_patient_reach_v2.js\"]'))return;var s=document.createElement('script');s.src='feat_mls_patient_reach_v2.js?v=20260727pr205';s.async=true;s.setAttribute('data-mls-asset','feat_mls_patient_reach_v2.js');(document.body||document.head||document.documentElement).appendChild(s);},{timeout:2500});}catch(e){}})(); /* one Reviews/secure-portal owner: real rail workspaces + compact context dialogs + frozen-patient portal delegation */",
  ";(function(){try{if(document.querySelector('script[data-mls-asset=\"feat_mls_patient_reach_v2.js\"]'))return;var s=document.createElement('script');s.src='feat_mls_patient_reach_v2.js?v=20260727pr205';s.async=false;s.setAttribute('data-mls-asset','feat_mls_patient_reach_v2.js');(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* one Reviews/secure-portal owner: real rail workspaces + compact context dialogs + frozen-patient portal delegation */",
  'Patient Reach eager dependency restore'
);

connect = replaceExactlyOnce(
  connect,
  ";(function(){try{var sched=window.requestIdleCallback||function(f){return setTimeout(f,900);};sched(function(){if(document.querySelector('script[data-mls-asset=\"feat_mls_code_table.js\"]'))return;var s=document.createElement('script');s.src='feat_mls_code_table.js?v=20260716ct110';s.setAttribute('data-mls-asset','feat_mls_code_table.js');s.async=true;(document.body||document.head||document.documentElement).appendChild(s);},{timeout:2500});}catch(e){}})(); /* b173: practice billing/ICD-CPT code-table upload + AI-best fallback (window.__mlsCodeTable ct-1.0.0; revert()) */",
  ";(function(){try{if(document.querySelector('script[data-mls-asset=\"feat_mls_code_table.js\"]'))return;var s=document.createElement('script');s.src='feat_mls_code_table.js?v=20260716ct110';s.setAttribute('data-mls-asset','feat_mls_code_table.js');s.async=false;(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* 2026-07-29: practice billing/ICD-CPT code-table upload + AI-best fallback (window.__mlsCodeTable ct-1.0.0; revert()) */",
  'Code Table eager dependency restore'
);

lateTest = replaceExactlyOnce(
  lateTest,
  "  'feat_mls_patient_reach_v2.js',\n  'feat_mls_code_table.js',\n",
  '',
  'remove unsafe dependencies from deferred tranche'
);

lateTest = replaceExactlyOnce(
  lateTest,
  "  /* 2026-07-29 boot-deferral batch: 36 more single-line eager loaders moved to\n   * the idle pattern (requestIdleCallback + 2500ms timeout + s.async=true).\n   * Listed here are the 17 whose loader line carries the literal\n   * data-mls-asset=\"name\" this check greps for; the other 19 use the\n   * var A=\"name\" / forEach / id-guard forms and are policed by the\n   * boot-script-budget eager ceiling instead. */",
  "  /* 2026-07-29 boot-deferral batch: 34 safe single-line loaders remain on\n   * the idle pattern (requestIdleCallback + 2500ms timeout + s.async=true).\n   * Listed here are the 18 whose loader line carries the literal\n   * data-mls-asset=\"name\" this check greps for; the other 16 use the\n   * var A=\"name\" / forEach / id-guard forms and are policed by the\n   * boot-script-budget eager ceiling instead. */",
  'deferred tranche accounting'
);

budgetTest = replaceExactlyOnce(
  budgetTest,
  "/* 234 -> 195 on 2026-07-29: the boot-deferral batch wrapped 36 single-line\n * eager loaders (Groups A/B/C of the deferral audit - report exporters, note\n * conveniences, one-shot cosmetic fixers) in the idle pattern\n * (requestIdleCallback with a 2500ms timeout, setTimeout(900) fallback,\n * s.async=true). Counted by THIS file's own detector after the change:\n * 195 eager / 50 deferred. The numbers are read from the run, never\n * hand-predicted, because the 400-char lookbehind classifies each name at its\n * FIRST occurrence in the file, which for several assets is a comment far\n * above the loader. Floor set 20 below the ceiling per the failure message's\n * own instruction, so the win is locked in and cannot erode back one feature\n * at a time. */\nconst EAGER_CEILING = 195;\nconst EAGER_FLOOR = 175;",
  "/* 234 -> 196 on 2026-07-29: the boot-deferral batch leaves 34 safe\n * single-line loaders in the idle pattern. Patient Reach and Code Table were\n * restored to the ordered eager tail after measured first-use dependency\n * failures. Counted by THIS file's detector after the correction:\n * 196 eager / 49 deferred. Patient Reach is already classified eager because\n * its first textual reference precedes its loader; the exact loader contract\n * is therefore enforced in late-surfaces-stay-deferred.test.js. Floor remains\n * 20 below the ceiling per the failure message's own instruction, so the\n * remaining win cannot erode back one feature at a time. */\nconst EAGER_CEILING = 196;\nconst EAGER_FLOOR = 176;",
  'eager/deferred budget accounting'
);

function loaderLine(asset) {
  return connect.split(/\r?\n/).find((line) => line.includes("s.src='" + asset));
}

const reachLine = loaderLine('feat_mls_patient_reach_v2.js?v=20260727pr205');
const codeLine = loaderLine('feat_mls_code_table.js?v=20260716ct110');
if (!reachLine || reachLine.includes('requestIdleCallback') || !reachLine.includes('s.async=false')) {
  throw new Error('Patient Reach eager-loader postcondition failed');
}
if (!codeLine || codeLine.includes('requestIdleCallback') || !codeLine.includes('s.async=false')) {
  throw new Error('Code Table eager-loader postcondition failed');
}
if ((connect.match(/feat_mls_patient_reach_v2\.js\?v=20260727pr205/g) || []).length !== 1) {
  throw new Error('Patient Reach immutable-token count postcondition failed');
}
if ((connect.match(/feat_mls_code_table\.js\?v=20260716ct110/g) || []).length !== 1) {
  throw new Error('Code Table immutable-token count postcondition failed');
}
if (lateTest.includes("  'feat_mls_patient_reach_v2.js',") ||
    lateTest.includes("  'feat_mls_code_table.js',")) {
  throw new Error('unsafe dependency remains pinned as deferred');
}

fs.writeFileSync(connectPath, connect, 'latin1');
fs.writeFileSync(lateTestPath, lateTest, 'utf8');
fs.writeFileSync(budgetTestPath, budgetTest, 'utf8');

console.log('Restored Patient Reach and Code Table to the ordered eager tail.');
