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

/* the probe request carries the presence ask, guarded on recording state */
const probeIdx = wf.indexOf("mode: 'probe', action: row.action, patient: bridgeProbePatient");
assert(probeIdx > 0, 'the probe bridge call must exist');
const probeRegion = wf.slice(Math.max(0, probeIdx - 900), probeIdx + 200);
assert(probeRegion.includes('foregroundOk:'), 'the probe request must ask for presence');
assert(probeRegion.includes("__mlsDoctorMidVisit"), 'the presence ask must be guarded on the recording state - never front mid-visit');

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
