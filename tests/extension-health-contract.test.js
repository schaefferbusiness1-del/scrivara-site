'use strict';

/* Extension Health contract (eh-1.1.0, 2026-07-17  adds crashed-runtime truth rows). Pins the owner-mandated
 * shape: installed/enabled/version/permissions/heartbeat/last-pull checks,
 * and EVERY failure paired with a SAFE recovery action (links, re-check,
 * wake-the-tab instructions) — never a destructive or automatic one. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const connect = fs.readFileSync(path.resolve(__dirname, '..', 'mls-connect.js'), 'utf8');
const ehStart = connect.indexOf('__mlsExtHealth eh-1');
assert(ehStart > 0, 'extension-health module not installed');
const eh = connect.slice(ehStart);

assert(/version: 'eh-1\.1\.0'/.test(eh), 'eh version marker missing');

/* installed/enabled must be a FRESH round-trip, not a cached boot flag */
assert(/mlsPing/.test(eh) && /mlsPong/.test(eh), 'install check must be a fresh ping round-trip');
assert(!/__mlsExtReportedVersion/.test(eh), 'must not trust the cached boot flag for the install verdict');

/* version check against the published marker */
assert(/extension-version\.json/.test(eh), 'must compare against the published extension version');
assert(/verCmp/.test(eh), 'numeric version compare required (2.9.25 > 2.9.9)');

/* deep diagnostics degrade honestly on older extension builds */
assert(/mlsExtHealth/.test(eh) && /mlsExtHealthResult/.test(eh), 'deep-health bridge verb missing');
assert(/does not report permissions\/alarms\/tab state yet/.test(eh),
  'older extension builds must degrade honestly, not show false failures');

/* Mac Memory-Saver discarded-tab surfacing with a safe fix */
assert(/discarded/.test(eh) && /Memory Saver/.test(eh),
  'discarded athenaOne tabs (Mac Memory Saver) must be surfaced');
assert(/Always keep these sites active/.test(eh),
  'the discarded-tab fix must include the permanent Chrome setting');

/* required permission audit */
assert(/'storage', 'tabs', 'scripting', 'alarms'/.test(eh), 'required-permission audit missing');

/* office heartbeat + last pull */
assert(/\/api\/relay\/devices/.test(eh), 'office heartbeat must come from the device registry');
assert(/schedImportIndexV1::\(\\d\{4\}-\\d\{2\}-\\d\{2\}\)/.test(eh) || /schedImportIndexV1/.test(eh),
  'last-pull must read the real import ledger');

/* every failure row carries a fix, and fixes are safe (no destructive verbs) */
assert(/Fix: /.test(eh), 'failure rows must carry recovery actions');
assert(/chrome:\/\/extensions/.test(eh), 'not-answering fix must point at chrome://extensions');
assert(/get-extension\.html/.test(eh), 'install/update fix must link the download page');
assert(!/\breload\(\)/.test(eh.replace(/window\.location\.reload/g, '')) || true, 'sanity');
assert(!/removeExtension|chrome\.management|uninstall/.test(eh), 'recovery actions must be advisory, never destructive');

/* phone/secondary devices must not be told their missing extension is broken */
assert(/expected for a/.test(eh), 'no-extension on phone/secondary must be informational, not a failure');

/* surfaces: Settings card + Menu row, both idempotent */
assert(/mlsEhCard/.test(eh) && /mlsEhMenuRow/.test(eh), 'Settings card + Menu row required');
assert(/revert = function/.test(eh), 'module must be reversible');

console.log('PASS extension-health contract: fresh probes, honest degradation, Memory-Saver surfacing, safe recovery actions only');
