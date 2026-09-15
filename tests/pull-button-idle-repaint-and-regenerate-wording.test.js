'use strict';
/* pullbtn-1.0.0 (X2) + sheetregen-1.0.0 (X3) - two app-side defects the
 * extension session measured on 2026-09-15 and logged in
 * AUDIT_LEDGER_2026-09-15.md section C.
 *
 * X2  After a retry round ended, #mlsDsPullBtn still read "Pulling <day>..."
 *     with its spinner while DS.pulling and DS.retrying were both false. The
 *     label was painted by whichever path started the work and only some
 *     terminal paths restored it. Cure: dsPaintPullButtonFromState() repaints
 *     the idle verb from the STATE on every terminal transition (it is the
 *     first line of syncRetryControl, which every terminal path calls) and at
 *     the convergence lane's close; it never touches a busy button.
 * X3  After a rebind, the five-field sidecar answers canonical-source-changed
 *     until the note is regenerated; the sheet said "complete its five
 *     sections", which is not what the doctor has to do. Cure: for that exact
 *     issue both the capability line and the boundary line say "Regenerate the
 *     note for this visit, then send."; every other issue keeps its sentence.
 *
 * Part 1 pins the source. Part 2 EXECUTES the repaint helper, sliced out of
 * the shipped connect bundle, against a fake button and state in every
 * combination: idle+spinner repaints, idle+plain leaves alone, busy leaves
 * alone. Synthetic values only.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const connect = fs.readFileSync(path.join(root, '1p-mls-connect.js'), 'utf8');
const writeflow = fs.readFileSync(path.join(root, '1p-feat_mls_writeflow.js'), 'utf8');
let checks = 0;
const ok = (c, m) => { checks++; assert.ok(c, m); };
const eq = (a, b, m) => { checks++; assert.strictEqual(a, b, m + '\n   got: ' + JSON.stringify(a) + '\n   expected: ' + JSON.stringify(b)); };

/* ---- X2 source pins --------------------------------------------------- */
const helperStart = connect.indexOf('  function dsPaintPullButtonFromState() {');
ok(helperStart > 0, 'the repaint helper exists in the connect bundle');
const helperEnd = connect.indexOf('\n  }\n', helperStart) + '\n  }\n'.length;
const helper = connect.slice(helperStart, helperEnd);
ok(/if \(DS\.pulling \|\| DS\.retrying \|\| DS\.__autoRetrying\) return false;/.test(helper), 'a busy state is never repainted');
ok(/indexOf\('ds-spin'\) < 0\) return false;/.test(helper), 'a button without the spinner is left alone');
ok(connect.includes("  function syncRetryControl(source) {\n    var items = retryItems(source), retryBtn = $('mlsDsRetryHistoryBtn'), wakeBtn = $('mlsDsWakeRetryBtn');\n    dsPaintPullButtonFromState();\n"), 'syncRetryControl repaints from state first, on every terminal transition');
ok(connect.includes("      if (!cvOpts.keepBar) dsPaintPullButtonFromState(); /* pullbtn-1.0.0"), 'the convergence lane close repaints when it does not keep the bar');
eq(connect.split('dsPaintPullButtonFromState()').length - 1, 3, 'exactly one definition and two call sites');

/* ---- X2 executed ------------------------------------------------------- */
function runHelper(state, innerHTML) {
  const btn = innerHTML === null ? null : { innerHTML, disabled: true };
  const ctx = {
    DS: Object.assign({}, state),
    $: (id) => (id === 'mlsDsPullBtn' ? btn : null),
    esc: (s) => String(s),
    dsPullVerb: () => 'Pull today',
    String,
  };
  vm.runInNewContext(helper + '\nresult = dsPaintPullButtonFromState();', ctx, { filename: 'helper.js' });
  return { result: ctx.result, btn, repaints: ctx.DS.pullButtonRepaints || 0 };
}
const spinner = '<span class="ds-spin"></span> Pulling Mon Sep 14...';
{
  const r = runHelper({ pulling: false, retrying: false, __autoRetrying: false }, spinner);
  eq(r.result, true, 'idle state with a spinner on the button repaints');
  eq(r.btn.innerHTML, '📥 Pull today', 'to the idle verb');
  eq(r.btn.disabled, false, 'and re-enables the button');
  eq(r.repaints, 1, 'counted on the state, PHI-free');
}
{
  const r = runHelper({ pulling: true, retrying: false, __autoRetrying: false }, spinner);
  eq(r.result, false, 'a running pull is left alone');
  eq(r.btn.innerHTML, spinner, 'its label untouched');
}
{
  const r = runHelper({ pulling: false, retrying: true, __autoRetrying: false }, spinner);
  eq(r.result, false, 'a running retry is left alone');
}
{
  const r = runHelper({ pulling: false, retrying: false, __autoRetrying: true }, spinner);
  eq(r.result, false, 'an automatic retry chain is left alone');
}
{
  const r = runHelper({ pulling: false, retrying: false, __autoRetrying: false }, '📥 Pull today');
  eq(r.result, false, 'an idle button already showing the verb is not rewritten');
}
{
  const r = runHelper({ pulling: false, retrying: false, __autoRetrying: false }, null);
  eq(r.result, false, 'no button, no throw');
}

/* ---- X3 source pins --------------------------------------------------- */
ok(writeflow.includes("? 'The visit source changed since this note was generated. Regenerate the note for this visit, then send.'"), 'capability line names the regenerate step for canonical-source-changed');
ok(writeflow.includes("(/canonical-source-changed$/.test(generationIssue) ? 'Regenerate the note for this visit, then send. ' : 'Existing note retained; review the updated source or complete its five sections. ') + 'Nothing here checks an encounter, writes"), 'boundary line names the regenerate step for canonical-source-changed and keeps the old sentence otherwise');
eq(writeflow.split("/canonical-source-changed$/.test(generationIssue)").length - 1, 2, 'the issue test appears exactly twice (capability + boundary)');
ok(writeflow.includes(": 'Existing note retained; review the updated source or complete its five sections.')))"), 'every other generation issue keeps the original capability sentence');

/* the sidecar really does answer that reason after a rebind (shell) */
const shell = fs.readFileSync(path.join(root, '1pScribeFlow.html'), 'utf8');
ok(shell.includes("reason:'canonical-source-changed'"), 'the shell emits canonical-source-changed from the sidecar fingerprint check');

console.log('PASS pullbtn-1.0.0 + sheetregen-1.0.0: the pull button is repainted from state on every terminal transition and never while busy; the sheet tells the doctor to regenerate after a rebind (' + checks + ' checks)');
