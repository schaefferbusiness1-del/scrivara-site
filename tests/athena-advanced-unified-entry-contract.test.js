'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const flow = fs.readFileSync(path.join(root, 'feat_mls_writeflow.js'), 'utf8');
const content = fs.readFileSync(path.join(root, 'content.js'), 'utf8');
const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');

function between(source, begin, end) {
  const a = source.indexOf(begin);
  assert(a >= 0, `missing start marker: ${begin}`);
  const b = source.indexOf(end, a + begin.length);
  assert(b > a, `missing end marker: ${end}`);
  return source.slice(a, b);
}

const advanced = between(flow, 'function panelManifestPlan(panel, gathered)', '/* -------------------- panel takeover');
assert(advanced.includes('function openPanelUnifiedConfirmation(panel, preferredAction)'), 'advanced workspace needs one manifest-review adapter');
assert(advanced.includes('return openUnifiedConfirmation({'), 'advanced workspace must open the unified immutable manifest UI');
assert(advanced.includes("preferredAction: preferredAction || 'write_note'"), 'advanced button intent must select a row without executing it');
assert(advanced.includes('gathered.blocked'), 'unknown selected destinations must remain visible as blocked manifest rows');
assert(advanced.includes('gathered.held'), 'manual selected destinations must remain visible in the manifest');
assert(!/bridge\(\s*['"]mlsAppWriteV2['"]/.test(advanced), 'advanced workspace must never call the deprecated direct-write bridge');
assert(!/startAthenaAction\s*\(/.test(advanced), 'advanced workspace must not open a second per-action confirmation UI');
assert(!/mode\s*:\s*['"]execute['"]/.test(advanced), 'advanced entry must not execute while opening its review');

const takeover = between(flow, 'function enhancePanel(panel)', '/* ------------------------- suggested orders chips');
assert(/querySelector\(['"]#emrWbAthena['"]\)/.test(takeover), 'test did not locate #emrWbAthena');
assert(/btn\.onclick\s*=\s*function\s*\(\)\s*\{\s*runV2\(panel\)/.test(takeover), '#emrWbAthena must enter runV2');
assert(/b\.onclick\s*=\s*function\s*\(\)\s*\{\s*openPanelUnifiedConfirmation\(panel, action\)/.test(takeover), 'advanced action buttons must enter the same unified review');
assert(!/bridge\(\s*['"]mlsAppWriteV2['"]/.test(takeover), 'enhancePanel must not retain a direct-write bypass');
assert(!/startAthenaAction\s*\(/.test(takeover), 'enhancePanel must not retain an older confirmation bypass');

const deprecatedRelay = content.slice(content.indexOf("d.type !== 'mlsAppWriteV2'"));
assert(deprecatedRelay.includes('unified-confirmation-required'), 'stale pages need an explicit fail-closed receipt');
assert(!/chrome\.runtime\.sendMessage\s*\(/.test(deprecatedRelay), 'stale direct-write messages must never reach the service worker');
assert(!content.includes('__mlsAdvancedWriteArm'), 'obsolete direct-write gesture arm must be removed');

const handlerAt = background.indexOf("if (!msg || msg.type !== 'mlsAppWriteV2Request') return;");
assert(handlerAt >= 0, 'deprecated background message must still return a compatibility refusal');
const handler = background.slice(handlerAt, handlerAt + 7000);
const refusalAt = handler.indexOf('unified-confirmation-required');
const tabQueryAt = handler.indexOf('chrome.tabs.query');
const driverAt = handler.indexOf('mlsV205Driver');
assert(refusalAt >= 0, 'background direct-write handler is not disabled');
assert(tabQueryAt < 0 || refusalAt < tabQueryAt, 'background refusal must happen before Athena tab discovery');
assert(driverAt < 0 || refusalAt < driverAt, 'background refusal must happen before any legacy driver call');

const unified = between(flow, '/* ---------------- unified Athena manifest review', '/* ---- identity helpers');
assert(/mode:\s*'probe'/.test(unified), 'unified entry must perform its read-only probe');
assert.strictEqual((between(unified, 'function executeUnifiedSelection(state)', 'function reopenOptions').match(/mode:\s*'execute'/g) || []).length, 1, 'one Confirm & write path must contain exactly one typed execute');

console.log('PASS advanced Athena entry: #emrWbAthena and action buttons use one immutable review; direct writer is disabled end-to-end');
