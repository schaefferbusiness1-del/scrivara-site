'use strict';

/* THE OP-NOTE DRAFT IS GRADED AGAINST WHAT THE MODEL SAW (oni-2.16.0) -
 * reliability pack for the owner's 'must work 100% and follow the selected
 * template faithfully' directive (2026-07-26; template behavior stays
 * ALWAYS-ADAPTIVE per his same-day answer - crossAdapt untouched):
 *
 * 1. The prompt sliced the template to 12k chars but BOTH fidelity passes and
 *    reanchor graded against the FULL text - any longer template was
 *    structurally unsatisfiable: guaranteed MLS_OPNOTE_TEMPLATE_FIDELITY,
 *    a wasted repair round-trip, and no message naming truncation.
 * 2. maxTokens was never set on /api/complete (the only endpoint op notes
 *    use): a server-truncated JSON answer failed fidelity for a reason no
 *    message named.
 * 3. The template dropdown's own onchange set only tplId; tplManual came from
 *    a satellite capture listener - if integrity loaded late, the very next
 *    keystroke in Procedure silently re-matched over the doctor's pick. The
 *    control now sets tplManual itself, and its label stops claiming
 *    (auto-matched) for a hand-picked template.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const oni = fs.readFileSync(path.join(root, 'feat_mls_opnote_integrity.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');

/* 1 - one variable feeds prompt, both fidelity passes, reanchor, repair */
assert(oni.includes('var tplForModel=S(tplText).slice(0,12000);'),
  'the model-visible template slice must be computed once');
assert(oni.includes("COPY ITS STRUCTURE AND FIXED WORDING:\\n'+tplForModel"),
  'the prompt must use the single slice');
assert(oni.includes('fidelity(first.note,tplForModel)'),
  'first fidelity pass must grade against what the model saw');
assert(oni.includes('fidelity(repaired.note,tplForModel)'),
  'repair fidelity pass must grade against what the model saw');
assert(oni.includes('reanchor(repaired.note,tplForModel,facts)'),
  'reanchor must rebuild from what the model saw');
assert(!/fidelity\([^)]*,tplText\)/.test(oni),
  'no fidelity call may grade against the untruncated template');
assert(oni.includes('longer than the '),
  'a truncated-template failure must name truncation');
/* clinical consistency deliberately keeps the full text - facts, not structure */
assert(oni.includes('clinicalConsistency(first.note,procedure,selectedTpl||{text:tplText},ctx)'),
  'clinical consistency keeps the full template text');

/* 2 - explicit output budget */
assert(oni.includes('maxTokens:4096'),
  'op-note generation must set an explicit maxTokens');
assert(app.includes('maxTokens:opts.maxTokens||undefined'),
  'aiCallRaw must still pass maxTokens through to /api/complete');

/* 3 - the dropdown owns its own manual flag and tells the truth */
assert(app.includes(".tplId=this.value;window._opPrep['+i+'].tplManual=true"),
  'the template dropdown must set tplManual itself, not rely on a satellite listener');
assert(app.includes("row.tplManual?'(your pick)':'(auto-matched)'"),
  'the label must stop claiming (auto-matched) for a hand-picked template');
