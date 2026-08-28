'use strict';

/* wopen-1.0.0 / studiofast-1.0.0 (2026-08-28) — two live AI Studio defects.
 *
 * 1. A built widget failed on the owner's screen with:
 *       "The widget hit an error while running: MLS.openChart is not a function."
 *    The model is never handed an API list - it infers method names from the
 *    request - and openChart is the obvious name for "open the chart", which is
 *    exactly the button a patient-grid widget wants. openPatient existed;
 *    openChart did not.
 *
 * 2. AI Studio rendered as Copilot + Build-a-tool + My creations, and only became
 *    Ask / Practice / Build with the study + cohort section after
 *    feat_mls_studio_merge.js arrived - which was scheduled on browser IDLE with a
 *    4000ms timeout. The owner saw the lesser Studio first and read it as an old
 *    version of the page.
 *
 * The bridge is built as a STRING and injected into a sandboxed iframe, so it is
 * executed here rather than grepped: a method that is only spelled correctly in
 * the source but throws at runtime is the exact failure being fixed.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let checks = 0;
function ok(v, m) { checks++; assert.ok(v, m); }
function eq(a, b, m) { checks++; assert.strictEqual(a, b, m); }

const root = path.resolve(__dirname, '..');
const SHELLS = ['1pScribeFlow.html', path.join('1p', 'index.html'), 'ScribeFlow.html', path.join('cloned', 'index.html')];
const LANES = ['1p-mls-connect.js', 'mls-connect.js', 'cloned-mls-connect.js'];

function lift(src, name) {
  const i = src.indexOf('function ' + name + '(');
  assert.ok(i >= 0, 'missing ' + name);
  const j = src.indexOf('{', i);
  let d = 0, e = -1;
  for (let k = j; k < src.length; k++) {
    const c = src[k];
    if (c === '{') d++;
    else if (c === '}') { d--; if (!d) { e = k + 1; break; } }
  }
  assert.ok(e > 0, 'unbalanced ' + name);
  return src.slice(i, e);
}

let shells = 0;
for (const shell of SHELLS) {
  const file = path.join(root, shell);
  if (!fs.existsSync(file)) continue;
  shells++;
  const src = fs.readFileSync(file, 'latin1');

  /* Build the bridge exactly as the app does, then EXECUTE it in a fake iframe
     window so we get the real object a widget would see. */
  const bridgeJs = new Function(lift(src, '_mlsWidgetBridgeJS') + '\nreturn _mlsWidgetBridgeJS;')()('test-nonce');
  const posted = [];
  const fakeWin = {
    MLS_DATA: { patients: [] },
    addEventListener: function () {},
    print: function () {}
  };
  const sandbox = {
    window: fakeWin,
    parent: { postMessage: (m) => posted.push(m) },
    setTimeout: () => 0,
    Promise: Promise,
    Object: Object,
    String: String,
    Date: Date
  };
  new Function('window', 'parent', 'setTimeout', bridgeJs)(fakeWin, sandbox.parent, sandbox.setTimeout);
  const MLS = fakeWin.MLS;
  ok(MLS && typeof MLS === 'object', shell + ': the widget bridge did not build an MLS object at all');

  /* THE REPORTED BUG */
  eq(typeof MLS.openChart, 'function',
    shell + ': MLS.openChart is not a function - a generated widget calling it dies with exactly ' +
    'the error the owner hit, and openChart is the name a model naturally picks for an ' +
    '"Open Chart" button');

  /* it must actually DO something, and the same thing openPatient does */
  posted.length = 0;
  MLS.openChart('Adam');
  eq(posted.length, 1, shell + ': MLS.openChart posted no action - it is a silent no-op');
  const a = posted[0] && posted[0].__mlsWidgetAction;
  ok(a, shell + ': MLS.openChart did not post a widget action');
  eq(a.type, 'openPatient',
    shell + ': MLS.openChart routes to "' + (a && a.type) + '" - it must route to the SAME app-side ' +
    'action as openPatient so there is one behaviour, not two');
  eq(a.query, 'Adam', shell + ': MLS.openChart dropped its argument');

  /* the original name must keep working - shipped starter widgets and saved
     creations in "My creations" already call it */
  posted.length = 0;
  MLS.openPatient('Adam');
  eq(posted.length, 1, shell + ': MLS.openPatient stopped working - saved widgets would break');
  eq(posted[0].__mlsWidgetAction.type, 'openPatient', shell + ': openPatient changed behaviour');

  /* the rest of the documented surface must survive this edit */
  for (const m of ['startVisit', 'navigate', 'toast', 'ai', 'getPatient', 'getSchedule', 'download', 'copy', 'save', 'load']) {
    eq(typeof MLS[m], 'function', shell + ': the widget bridge lost MLS.' + m);
  }
}

/* 2. the Studio upgrade must not wait for idle when Studio is on screen */
let lanes = 0;
for (const lane of LANES) {
  const file = path.join(root, lane);
  if (!fs.existsSync(file)) continue;
  lanes++;
  const src = fs.readFileSync(file, 'latin1');
  const at = src.indexOf("var A='feat_mls_studio_merge.js';");
  ok(at >= 0, lane + ': the studio-merge loader was rewritten - AI Studio may be back to idle-only');
  const block = src.slice(at, at + 1800);
  ok(/function studioOnScreen\(/.test(block),
    lane + ': nothing checks whether AI Studio is on screen, so the upgrade waits for idle again');
  /* The SAME call text appears twice - once standalone, once inside the
     view-changed listener - so a loose match cannot tell them apart and a canary
     that deleted the standalone call still passed. Require each one distinctly:
     the immediate call must be a statement of its own (line-anchored), and the
     listener must carry its own copy. */
  ok(/\n\s*if\(studioOnScreen\(\)\)go\(\);\s*\n/.test(block),
    lane + ': there is no STANDALONE immediate load - the upgrade is not fetched when Studio is ' +
    'already on screen at boot, so the doctor still waits for idle');
  ok(/addEventListener\('mls:view-changed',[^\n]*studioOnScreen\(\)\)go\(\)/.test(block),
    lane + ': opening AI Studio does not trigger the upgrade - navigating to it still waits for idle');
  /* the idle path MUST remain: this module also hoists #analysisView */
  ok(/sched\(go,\{timeout:4000\}\)/.test(block),
    lane + ': the idle fallback was removed - the module also hoists the analysis view, so it must ' +
    'still land for people who never open Studio');
  /* and it must stay idempotent, or the two paths double-load the module */
  ok(/data-mls-asset/.test(block),
    lane + ': the injection guard is gone - the immediate and idle paths would double-load');
}

ok(shells > 0 && lanes > 0, 'nothing was scanned - this suite tested nothing');
console.log('PASS studio-widget-bridge-contract: ' + checks + ' checks across ' + shells + ' shell(s) and ' +
  lanes + ' lane(s) - MLS.openChart exists, routes to the same action as openPatient, the rest of the ' +
  'bridge survives, and the AI Studio upgrade loads immediately when Studio is on screen');
