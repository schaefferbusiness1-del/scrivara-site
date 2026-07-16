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

// chat-driven write+sign lane
{
  const flow = con.indexOf('function signSaveFlow()');
  assert(flow >= 0, 'signSaveFlow must exist');
  const head = con.slice(flow, flow + 1100);
  assert(head.includes('window.__mlsWriteFlow'), 'chat write must check for the unified review');
  assert(head.includes('unifiedBtn.click()'), 'chat write must open the unified review when installed');
  assert(head.indexOf('unifiedBtn.click()') < head.indexOf('signRunning = true'), 'the unified redirect must run BEFORE the legacy write+sign lane arms');
  assert(head.includes('Sign unlocks only after the verified write'), 'the redirect reply must state the Sign gating honestly');
}

console.log('PASS unified write surface: legacy visit-completion and chat write lanes open the one unified Athena review');
