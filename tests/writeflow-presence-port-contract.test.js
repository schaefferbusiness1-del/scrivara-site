'use strict';
/* mdx-2.0.0 — the wf3 write-probe presence port, app side.
 * Live 2026-08-05: a fully staged review sheet starved for hours because the
 * read-only probe drives athena's briefing SPA, which renders on paused rAF
 * while the tab is occluded — and the write lane never got the pulls' fg-1.x
 * presence assist. The sheet is always doctor-initiated, so the probe request
 * now asks the extension to bring athenaOne forward (foregroundOk), guarded by
 * the same never-while-recording rule the pulls use; the extension's own focus
 * guards (never front when Chrome is unfocused, doctor-moved latch) do the
 * rest. A probe TIMEOUT now names tab visibility as the cure instead of a bare
 * "could not be verified". */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const wf = fs.readFileSync(path.join(root, 'feat_mls_writeflow.js'), 'utf8');
const content = fs.readFileSync(path.join(root, 'content.js'), 'utf8');
const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');

function between(source, start, end) {
  const a = source.indexOf(start);
  assert(a >= 0, `missing start marker: ${start}`);
  const b = source.indexOf(end, a + start.length);
  assert(b > a, `missing end marker: ${end}`);
  return source.slice(a, b);
}

/* the probe request carries the presence ask, guarded on recording state */
const probeIdx = wf.indexOf("mode: 'probe', action: row.action, patient: bridgeProbePatient");
assert(probeIdx > 0, 'the probe bridge call must exist');
const probeRegion = wf.slice(Math.max(0, probeIdx - 900), probeIdx + 200);
assert(probeRegion.includes('foregroundOk:'), 'the probe request must ask for presence');
assert(probeRegion.includes("__mlsDoctorMidVisit"), 'the presence ask must be guarded on the recording state - never front mid-visit');

/* The live path crosses three layers. Pin the relay itself: the prior test
   covered only the site's request and the background consumer, so content.js
   could silently drop foregroundOk and every assertion still passed. */
const relay = between(content, "if (d.type === 'mlsAppAthenaActionV2')", '/* ATHENA_ACTION_V2_BRIDGE_END */');
assert(relay.includes("foregroundOk: athMode === 'probe' && d.foregroundOk === true"),
  'the content-script relay drops the guarded write-probe presence request');
const handler = between(background, '/* ATHENA_ACTION_V2_HANDLER_START */', '/* ATHENA_ACTION_V2_HANDLER_END */');
assert(handler.includes("mode === 'probe' && msg.foregroundOk === true"),
  'the background no longer consumes the forwarded presence request on probe only');
assert(!handler.includes("mode === 'execute' && msg.foregroundOk === true"),
  'the execute path must never use the presence lane');

/* the timeout refusal names the occlusion cure */
assert(wf.includes('If athenaOne is open but behind other windows, click its tab once so it can paint'),
  'a probe timeout must name tab visibility as the cure');
assert(wf.includes('if (!probe) probeErr +='), 'the cure text must attach on the TIMEOUT (null probe) path specifically');

/* the version marker moved with the behavior */
assert(wf.includes("var VERSION = 'wf3-1.1.0'"), 'wf3-1.1.0 marker missing');

/* fail-closed unchanged: the execute path must NOT gain any presence machinery
   (fronting is a read-probe assist; the write itself needs no focus theft) */
const execIdx = wf.indexOf("mode: 'execute', action: row.action, actionToken: probe.token");
assert(execIdx > 0, 'the execute bridge call must exist');
const execRegion = wf.slice(Math.max(0, execIdx - 400), execIdx + 200);
assert(!execRegion.includes('foregroundOk'), 'the execute path must not carry the presence ask');

console.log('writeflow-presence-port-contract: PASS');
