'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const connectPath = path.join(root, 'mls-connect.js');
const deferredTestPath = path.join(root, 'tests', 'late-surfaces-stay-deferred.test.js');
const helpTestPath = path.join(root, 'tests', 'help-search-location-contract.test.js');

function replaceExactlyOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(label + ': expected source text was not found');
  const second = source.indexOf(before, first + before.length);
  if (second >= 0) throw new Error(label + ': expected source text is ambiguous');
  return source.slice(0, first) + after + source.slice(first + before.length);
}

let connect = fs.readFileSync(connectPath, 'latin1');
let deferredTest = fs.readFileSync(deferredTestPath, 'utf8');
let helpTest = fs.readFileSync(helpTestPath, 'utf8');

const loaderReplacements = [
  {
    label: 'Outcome Study export loader',
    before: ';(function(){try{var A="feat_mls_outcome_pdf.js";if(document.querySelector(\'script[data-mls-asset="\'+A+\'"]\'))return;var s=document.createElement("script");s.src=A+"?v=20260722lib2";s.setAttribute("data-mls-asset",A);s.async=false;(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* item69 (STAGING): Outcome Study report exports -- multi-page PDF report + standalone SVG chart download added to the existing Outcome Study results panel (sources live rendered cohort data; athenaOne untouched; never writes/deletes records) -- additive, reversible: window.__mlsOutcomePdf.revert() */',
    after: ';(function(){try{var sched=window.requestIdleCallback||function(f){return setTimeout(f,900);};sched(function(){try{var A="feat_mls_outcome_pdf.js";if(document.querySelector(\'script[data-mls-asset="\'+A+\'"]\'))return;var s=document.createElement("script");s.src=A+"?v=20260722lib2";s.setAttribute("data-mls-asset",A);s.async=true;(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}},{timeout:2500});}catch(e){}})(); /* 2026-07-29: deferred past first paint; the base Outcome Study engine remains eager. item69: multi-page PDF report and standalone SVG chart download remain additive and reversible via window.__mlsOutcomePdf.revert(). */'
  },
  {
    label: 'Monthly Pay Report loader',
    before: ';(function(){try{var A="feat_comp_report.js";if(document.querySelector(\'script[data-mls-asset="\'+A+\'"]\'))return;var s=document.createElement("script");s.src=A+"?v=20260718pr5";s.setAttribute("data-mls-asset",A);s.async=false;(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* Monthly Pay Report v2.0.0 -- Editorial Calm UI (summary cards, provider chips, month stepper, collapsible per-provider tables, print), auto-build, credential-only PA/NP rate default, unmatched-estimate disclosure, incomplete-total flagging. Same honest data model: grounded estimates + manual overrides. Read-only. Revert: remove this loader. */',
    after: ';(function(){try{var sched=window.requestIdleCallback||function(f){return setTimeout(f,900);};sched(function(){try{var A="feat_comp_report.js";if(document.querySelector(\'script[data-mls-asset="\'+A+\'"]\'))return;var s=document.createElement("script");s.src=A+"?v=20260718pr5";s.setAttribute("data-mls-asset",A);s.async=true;(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}},{timeout:2500});}catch(e){}})(); /* 2026-07-29: deferred past first paint; Pay Report is a late surface and active callers already expose a loading state. Read-only; revert by removing this loader. */'
  },
  {
    label: 'natural-language Study Request loader',
    before: ';(function(){try{var A="feat_mls_study_request.js";if(document.querySelector(\'script[data-mls-asset="\'+A+\'"]\'))return;var s=document.createElement("script");s.src=A+"?v=20260723sr233";s.setAttribute("data-mls-asset",A);s.async=false;(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* sr-2.0.0 natural-language StudySpec -> academic-paper limited-data draft from ALL stores (patients/demographics/meds, notes, calendar, harvester, code table) with stats+tables+figures and number-verified optional AI narrative (up to 60 evidence-supported pages, never padded) */',
    after: ';(function(){try{var sched=window.requestIdleCallback||function(f){return setTimeout(f,900);};sched(function(){try{var A="feat_mls_study_request.js";if(document.querySelector(\'script[data-mls-asset="\'+A+\'"]\'))return;var s=document.createElement("script");s.src=A+"?v=20260723sr233";s.setAttribute("data-mls-asset",A);s.async=true;(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}},{timeout:2500});}catch(e){}})(); /* 2026-07-29: deferred past first paint; this AI Studio report builder waits for the already eager Study Groups engine. */'
  }
];

for (const replacement of loaderReplacements) {
  connect = replaceExactlyOnce(
    connect,
    replacement.before,
    replacement.after,
    replacement.label
  );
}

connect = replaceExactlyOnce(
  connect,
  "        setTimeout(function(){ var q=document.getElementById('mlsStudyPrompt'); if(q){ try{q.scrollIntoView({block:'center',behavior:'auto'});q.focus();}catch(e){} } },80);",
  "        (function focusStudyPrompt(tries){setTimeout(function(){var q=document.getElementById('mlsStudyPrompt');if(q){try{q.scrollIntoView({block:'center',behavior:'auto'});q.focus();}catch(e){}return;}if(tries<16)focusStudyPrompt(tries+1);},tries?200:80);})(0);",
  'Help and Find Study focus recovery'
);

deferredTest = replaceExactlyOnce(
  deferredTest,
  "  'feat_mls_avs_label_unify.js',\n  'feat_mls_lastseen_unify.js'\n];",
  "  'feat_mls_avs_label_unify.js',\n  'feat_mls_lastseen_unify.js',\n  'feat_mls_outcome_pdf.js',\n  'feat_comp_report.js',\n  'feat_mls_study_request.js'\n];",
  'late-surface tranche entries'
);

deferredTest = replaceExactlyOnce(
  deferredTest,
  "  const i = connect.indexOf('data-mls-asset=\"' + name + '\"');\n  assert(i > 0, name + ' has no loader at all');",
  "  const positions = [\n    connect.indexOf('data-mls-asset=\"' + name + '\"'),\n    connect.indexOf('var A=\"' + name + '\"'),\n    connect.indexOf(\"var A='\" + name + \"'\")\n  ].filter((position) => position >= 0);\n  assert.strictEqual(positions.length, 1, name + ' loader locator is missing or ambiguous');\n  const i = positions[0];",
  'late-surface loader locator'
);

deferredTest = replaceExactlyOnce(
  deferredTest,
  "console.log('PASS late surfaces stay deferred: 15 tranche modules load idle+async and the retired row observer remains absent');",
  "console.log('PASS late surfaces stay deferred: ' + TRANCHE.length + ' tranche modules load idle+async and the retired row observer remains absent');",
  'late-surface test summary'
);

helpTest = replaceExactlyOnce(
  helpTest,
  "assert(directory.includes(\"if(typeof window.showView==='function') window.showView('studio')\") && directory.includes(\"document.getElementById('mlsStudyPrompt')\"), 'Help/Find cannot navigate to and focus the natural-language study builder');",
  "assert(directory.includes(\"if(typeof window.showView==='function') window.showView('studio')\") &&\n  directory.includes('function focusStudyPrompt(tries)') &&\n  directory.includes('if(tries<16)focusStudyPrompt(tries+1)') &&\n  directory.includes(\"document.getElementById('mlsStudyPrompt')\"),\n  'Help/Find cannot navigate to and recover focus when the natural-language study builder mounts late');",
  'Help and Find bounded focus contract'
);

for (const name of ['feat_mls_outcome_pdf.js', 'feat_comp_report.js', 'feat_mls_study_request.js']) {
  const loaderLine = connect.split(/\r?\n/).find((line) => line.includes('var A="' + name + '"'));
  if (!loaderLine || !loaderLine.includes('requestIdleCallback') || !loaderLine.includes('s.async=true')) {
    throw new Error(name + ': deferred loader postcondition failed');
  }
}

fs.writeFileSync(connectPath, connect, 'latin1');
fs.writeFileSync(deferredTestPath, deferredTest, 'utf8');
fs.writeFileSync(helpTestPath, helpTest, 'utf8');

console.log('Applied idle deferral for 3 late report satellites plus bounded Study focus recovery.');
