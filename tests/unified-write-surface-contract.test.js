'use strict';

/* ONE write surface: every user-facing Athena write entry point must open the
   unified review (read-only probe + one typed Confirm & write) when it is
   installed. Legacy direct lanes survive only as fallbacks when the unified
   module is absent. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const wb = fs.readFileSync(path.join(root, 'feat_athena_writeback.js'), 'utf8');
const con = fs.readFileSync(path.join(root, 'feat_mls_wb_console.js'), 'utf8');

// visit-completion "Write note to Athena chart" buttons
{
  const btn = wb.indexOf("b.textContent = '✍ Write note to Athena chart';");
  assert(btn >= 0, 'legacy write button must still exist for fallback');
  const handler = wb.slice(btn, btn + 900);
  assert(handler.includes('window.__mlsWriteFlow'), 'legacy write button must check for the unified review');
  assert(/wf && wf\.installed && unified.*unified\.click\(\)/s.test(handler), 'legacy write button must open the unified review when installed');
  assert(handler.indexOf('unified.click()') < handler.indexOf('writeNoteToChart({})'), 'the unified review must take precedence over the direct paste');
}

// Legacy chat/button "write + sign" requests may open the unified review, but
// must never retain an independent write/sign fallback.
{
  const flow = con.indexOf('function signSaveFlow()');
  assert(flow >= 0, 'signSaveFlow must exist');
  const end = con.indexOf('/* ================================================================\n   *  PART 4', flow);
  assert(end > flow, 'signSaveFlow end marker is missing');
  const signFlow = con.slice(flow, end);
  assert(signFlow.includes("getElementById('pushAllEmrBtn')"), 'chat Sign request must route to the unified review control');
  assert(signFlow.includes('unifiedBtn.click()'), 'chat write must open the unified review when installed');
  assert(/Complete Sign & Save (?:directly )?in Athena/i.test(signFlow), 'redirect reply must tell the clinician Sign remains manual');
  assert(!/Sign unlocks|unlock[^.\n]{0,100}Sign/i.test(signFlow), 'verified write still claims to unlock Sign');
  assert(!/mlsAppSignSave|mlsAppPasteNote|signRunning\s*=\s*true|Signed & saved in athenaOne/.test(signFlow), 'legacy independent write/sign fallback remains reachable');

  const injectAt = con.indexOf('function injectLaunchers()', end);
  const injectEnd = con.indexOf('var pending = null', injectAt);
  const inject = con.slice(injectAt, injectEnd);
  assert(!/makeSignBtn\(\)|data-mlswbc-sign/.test(inject), 'legacy Sign & Save launcher is still injected');
}

console.log('PASS unified write surface: note writes open one review; legacy Sign requests stay manual with no independent fallback or launcher');
