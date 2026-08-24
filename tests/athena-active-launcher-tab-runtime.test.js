'use strict';

/* Synthetic routing proof for the read-only Patients/Easy launcher. It never
 * injects a script, opens a tab, reads chart text, or reaches Save/Sign/order
 * actions. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8');
const centerpiece = fs.readFileSync(path.join(__dirname, '..', 'feat_mls_centerpiece.js'), 'utf8');
const autopull = fs.readFileSync(path.join(__dirname, '..', 'feat_athena_autopull.js'), 'utf8');
const content = fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8');
assert(/id="mlscpSelected"[^>]*>[^<]*Pull the patient open in athenaOne/.test(centerpiece), 'the audited launcher label is missing');
assert(/function startSelectedPull\(\)[\s\S]*pullPatientFromAthenaPrompt/.test(centerpiece), 'the audited launcher does not call the shared open-patient pull');
assert(/bridgeOnce\('mlsAppCapture',[\s\S]*explicitUserPull: true, foregroundOk: true/.test(autopull), 'the launcher does not mark its capture as an explicit foreground user pull');
assert(/d\.type === 'mlsAppCapture'[\s\S]*explicitUserPull: d\.explicitUserPull === true, foregroundOk: d\.foregroundOk === true/.test(content), 'the content relay drops the explicit-capture flags');
assert(/mlsPickExplicitUserCaptureTab/.test(source) && /const capturePick = await mlsPickExplicitUserCaptureTab/.test(source), 'capture routing does not use the explicit active-tab picker');

function functionSource(name) {
  const start = source.indexOf(`async function ${name}(`);
  assert(start >= 0, `missing ${name}`);
  const brace = source.indexOf('{', start);
  let depth = 0, quote = '', escaped = false;
  for (let i = brace; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`unterminated ${name}`);
}

const pickerSource = functionSource('mlsPickExplicitUserCaptureTab');
const calls = [];
let forceNull = false;
const picker = async (tabs) => { calls.push(tabs.map(tab => tab.id)); return forceNull ? null : (tabs[0] || null); };
const host = tab => tab && tab.host;
let focusedTabs = [
  { id: 1, active: false, host: 'athenanet.athenahealth.com', windowId: 8 },
  { id: 2, active: true, host: 'athenanet.athenahealth.com', windowId: 8 }
];
const chrome = { windows: { getLastFocused: async () => ({ id: 8, tabs: focusedTabs }) } };
const self = { __mlsQp: { active: false }, __mlsAthPin: { tabId: null } };
const pick = Function('mlsPickAthenaTab', 'mlsAthTabHost', 'chrome', 'self', `return (${pickerSource});`)(picker, host, chrome, self);

(async () => {
  let result = await pick([
    { id: 1, active: false, host: 'athenanet.athenahealth.com' },
    { id: 2, active: true, host: 'athenanet.athenahealth.com' }
  ], { explicitUserPull: true, foregroundOk: true });
  assert.strictEqual(result.activeAthena, true, 'explicit launcher did not recognize the focused active Athena tab');
  assert.deepStrictEqual(calls.pop(), [2], 'explicit launcher still passed every Athena tab to the heuristic picker');
  assert.strictEqual(result.tab.id, 2, 'explicit launcher selected a different signed-in Athena tab');

  forceNull = true;
  result = await pick([
    { id: 1, active: false, host: 'athenanet.athenahealth.com' },
    { id: 2, active: true, host: 'athenanet.athenahealth.com' }
  ], { explicitUserPull: true, foregroundOk: true });
  assert.strictEqual(result.activeAthena, true, 'active-Athena refusal lost its exact-tab marker');
  assert.strictEqual(result.tab, null, 'active-Athena refusal silently selected a fallback tab');
  assert.deepStrictEqual(calls.pop(), [2], 'active-Athena refusal retried with all tabs');
  forceNull = false;

  focusedTabs = [{ id: 9, active: true, host: 'mlsscribe.com', windowId: 8 }];
  result = await pick([{ id: 9, active: true, host: 'mlsscribe.com' }], { explicitUserPull: true, foregroundOk: true });
  assert.strictEqual(result.activeAthena, false, 'non-Athena active tab was treated as an active Athena chart');
  assert.deepStrictEqual(calls.pop(), [9], 'no-active-Athena fallback changed its normal candidate set');

  self.__mlsAthPin.tabId = 1;
  focusedTabs = [{ id: 1, active: false, host: 'athenanet.athenahealth.com', windowId: 8 }, { id: 2, active: true, host: 'athenanet.athenahealth.com', windowId: 8 }];
  result = await pick([{ id: 1, active: false, host: 'athenanet.athenahealth.com' }, { id: 2, active: true, host: 'athenanet.athenahealth.com' }], { explicitUserPull: true, foregroundOk: true });
  assert.strictEqual(result.activeAthena, false, 'explicit tab pin was not allowed to remain authoritative');
  assert.deepStrictEqual(calls.pop(), [1, 2], 'pinned capture did not preserve the normal picker candidate set');
  console.log('PASS active-patient launcher routing: explicit capture follows the focused active Athena tab, preserves pins, and never silently falls through from that tab');
})().catch(error => { console.error(error); process.exitCode = 1; });
