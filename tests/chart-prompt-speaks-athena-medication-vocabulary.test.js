'use strict';

/* THE EXTRACTION PROMPT ASKED THE WRONG QUESTION ABOUT MEDICATIONS (b756).
 *
 * MEASURED on the owner account, Wed 2026-07-29, 19 appointments, across four
 * instrumented pulls:
 *     medication text reaches the extractor for 19 of 19 patients
 *     "Historical Meds" heading present in 19 of 19 inputs
 *     "(0 new)" present in 10 of 19
 *     medications extracted: 0 of 19
 *     coverage.meds = not_documented: 19 of 19
 *
 * THE CAUSE IS A VOCABULARY MISMATCH, NOT A BUG. _parsePatientChart is not a
 * parser - it is an LLM call - and its system prompt asked for "current
 * medications". athenaOne titles that card "Medications (N new)", where N counts
 * only items added at THIS visit, and renders the patient ongoing list under a
 * separate "Historical Meds" heading. A model told to extract CURRENT
 * medications, shown "(0 new)", correctly concludes there are none and marks
 * not_documented. It was obeying the instruction faithfully. The instruction did
 * not speak athena vocabulary.
 *
 * WHAT THIS SUITE CAN AND CANNOT PROVE - this matters more than usual here.
 * This is the first change in this codebase whose outcome depends on a MODEL
 * rather than on deterministic code. A fixture-driven test that fed chart text
 * through _parsePatientChart would make a live, non-deterministic, network-
 * dependent AI call - a green test proving nothing, which is the exact failure
 * mode this repo has spent a long night removing. So this suite tests the
 * CONTRACT: that the prompt names athena vocabulary and instructs the model
 * correctly. It is NECESSARY BUT NOT SUFFICIENT. The only real evidence is the
 * live before/after extraction rate across the same 19 patients, with the store
 * census as scoreboard. A prompt that says the right thing is not proof the
 * model now returns medications.
 *
 * The vitals half of the original hypothesis was WITHDRAWN and is deliberately
 * not pinned here: the "BP present in 17 of 19" measurement used
 * /\d{2,3}\s*\/\s*\d{2,3}/, which matches DATES (7/29, 10/15). The briefing
 * Vitals section measured a body length of 0, so vitals are genuinely absent on
 * that surface and not_documented is the CORRECT answer. There is no vitals gap.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const files = ['ScribeFlow.html', 'ScribeFlow-staging.html'];

files.forEach(function (file) {
  const src = fs.readFileSync(path.join(root, file), 'utf8');
  const at = src.indexOf('async function _parsePatientChart');
  assert(at > 0, file + ': _parsePatientChart must still exist');
  /* the system prompt is built immediately inside the function */
  const region = src.slice(at, at + 6000);
  const sysAt = region.indexOf("var sys='");
  assert(sysAt >= 0, file + ': the chart extraction system prompt must still be there');
  const sys = region.slice(sysAt, region.indexOf("';", sysAt));

  /* the schema must still request meds - the fix corrects vocabulary, not shape */
  assert(/"meds":/.test(sys), file + ': the JSON schema must still request a meds field');
  assert(/coverage/.test(sys) && /not_documented/.test(sys),
    file + ': the per-field coverage contract must survive');

  /* the vocabulary fix itself */
  assert(/Historical Meds/i.test(sys),
    file + ': the prompt must name athena "Historical Meds" heading. Without it the model is ' +
    'asked only for "current medications", sees "Medications (0 new)", and returns nothing - ' +
    'measured as meds 0 of 19 with coverage.meds not_documented 19 of 19');
  assert(/\(0 new\)|N new/i.test(sys),
    file + ': the prompt must explain the "(N new)" counter, because that is the label that ' +
    'misleads the model into reporting no medications');
  assert(/only items added at this visit|ONLY items added at this visit/i.test(sys),
    file + ': the prompt must state that the new-count covers only items added at this visit');

  /* it must tell the model what to DO with them, not merely describe the label */
  assert(/extract them into meds|Treat those entries as this patient current medications/i.test(sys),
    file + ': the prompt must instruct that historical entries ARE the current medication list, ' +
    'not merely describe athena layout');
  assert(/set coverage\.meds to found/i.test(sys),
    file + ': the prompt must say coverage.meds becomes found when such entries exist, or the ' +
    'model can extract medications and still mark the field not_documented');

  /* and the honest-empty path must remain reachable */
  assert(/Only use not_documented for meds when NEITHER/i.test(sys),
    file + ': a genuinely medication-free patient must still be reportable as not_documented - ' +
    'the fix must not make "found" unconditional');
});

/* both copies must carry it: the parity suite pins _savePatientChart, not this
   prompt, so a one-file edit would drift silently */
{
  const a = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');
  const b = fs.readFileSync(path.join(root, 'ScribeFlow-staging.html'), 'utf8');
  const grab = (s) => {
    const at = s.indexOf('async function _parsePatientChart');
    const region = s.slice(at, at + 6000);
    const sysAt = region.indexOf("var sys='");
    return region.slice(sysAt, region.indexOf("';", sysAt));
  };
  assert.strictEqual(grab(a), grab(b),
    'the chart extraction prompt must be identical in ScribeFlow.html and ScribeFlow-staging.html - ' +
    'the staging-parity suite only pins _savePatientChart, so a prompt edit to one file drifts silently');
}

console.log('PASS the chart prompt speaks athena medication vocabulary: it explains that "(N new)" ' +
  'counts only items added at this visit, names the Historical Meds heading, instructs that those ' +
  'entries ARE the current medication list and that coverage.meds becomes found, keeps a reachable ' +
  'honest-empty path, and is identical across both shells. NOTE: this pins the CONTRACT only - the ' +
  'efficacy evidence is the live before/after extraction rate, not this suite');
