/* 1p-autobind-encounter.test.js  (1p PREVIEW ONLY)
 *
 * Pins p1-autobind-2.0.0.
 *
 * Owner, on being told to run a day pull before the review would send:
 * "well this is unacceptable it should be able to figure it out".
 *
 * The frozen 3.0.61 extension rejects a null expectedContext before reading
 * Athena. Auto-bind must use the exact imported appointment/date and only
 * request-bound same-day provider-header candidates.
 *
 * THE THREE THINGS THAT MUST NEVER DRIFT, in priority order:
 *   1. READ-ONLY. The bind probe must be mode:'probe'. mode:'execute' on this verb
 *      WRITES TO A REAL PATIENT CHART. This is the single most dangerous line in the
 *      preview and it gets the first assertion.
 *   2. NO GUARD WEAKENED. visitReady keeps its original shape; identity is still
 *      verified inside validatedUnifiedProbe before any context is adopted.
 *   3. REBUILD, NEVER MUTATE. The manifest is deep-frozen and hash-pinned, so the
 *      enriched visit must go back through buildUnifiedManifest().
 *
 * Touches only isolated 1p assets.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '..');
const WF = path.join(ROOT, '1p-feat_mls_writeflow.js');
const src = fs.readFileSync(WF, 'latin1');

let checks = 0;
function ok(cond, msg) { assert.ok(cond, msg); checks++; }

/* ---- 1. THE SAFETY ASSERTION: the bind probe is READ-ONLY ---- */
ok(/p1-autobind-2\.[0-9]+\.[0-9]+/.test(src), 'the p1-autobind v2 block is missing');
/* slice forward from the function itself - the block's header comment mentions
 * window.__mlsP1AutoBind earlier, so an indexOf on that name lands in the prose */
const bindStart = src.indexOf('function p1AutoBindEncounter');
ok(bindStart > -1, 'p1AutoBindEncounter must exist');
const bindCall = src.slice(bindStart, bindStart + 12000);
ok(/mode: 'probe'/.test(bindCall),
  'the auto-bind call MUST be mode:probe - read-only');
ok(!/mode: 'execute'/.test(bindCall),
  'the auto-bind path must NEVER use mode:execute - that writes to a real patient chart');

/* ---- 2. NO GUARD WEAKENED ---- */
/* the predicate is line-wrapped in the source, so match across whitespace */
ok(/visitReady = !!visit\.visitDate && !!visit\.provider &&\s*\(!!visit\.appointmentId \|\| \(!!visit\.encounterId && !!visit\.encounterUrl\)\)/.test(src),
  'the visitReady predicate must keep its original shape - auto-bind SATISFIES it, never relaxes it');
ok(/p1ValidateAutoBindProbe\(patientAtStart, candidate, probe\)/.test(bindCall),
  'every adopted context must pass the exact patient+appointment+date+provider validator');
ok(/if \(successes\.length !== 1\) return;/.test(bindCall),
  'zero or multiple validated provider probes must bind nothing');
ok(/if \(!v1\.appointmentId \|\| !v1\.encounterId \|\| !v1\.encounterUrl \|\| !v1\.visitDate \|\| !v1\.provider\) return;/.test(bindCall),
  'the exact appointment plus all encounter fields must be present before adoption');
ok(/if \(!S\(p\.name\)\.trim\(\) \|\| !S\(p\.dob\)\.trim\(\) \|\| !S\(p\.mrn\)\.trim\(\)\) return false;/.test(bindCall),
  'auto-bind must refuse to run at all when the patient identity is incomplete');

/* ---- 3. REBUILD, NEVER MUTATE ---- */
ok(/o1\.expectedContext = stableClone\(v1\);/.test(bindCall),
  'the detached exact context must use the field buildUnifiedManifest reads');
ok(/var rebuilt = buildUnifiedManifest\(o1\);/.test(bindCall),
  'the enriched visit must go through buildUnifiedManifest for a fresh, correctly-hashed freeze');
ok(!/state\.manifest\.visit\.(encounterId|encounterUrl) =/.test(src),
  'the frozen manifest must never be mutated in place - the hashes would stop matching the payload');
ok(/state\.reopenOpts = reopenOptions\(o1, rebuilt\);/.test(bindCall),
  'reopen options must be rebuilt alongside the manifest or a reopen loses the binding');

/* ---- 4. FAILS CLOSED on every abandonment path ---- */
ok(/if \(p1AutoBindOff \|\| !state \|\| state\.closed \|\| state\.running \|\| state\.halted\) return false;/.test(bindCall),
  'auto-bind must not run while closed, running or halted');
/* 2026-08-17 (wfdx lane): the "already bound" guard used to be
 * p1VisitBound(m.visit) - an appointment id alone. That is NOT the manifest's
 * own send predicate (which also needs the provider), so an encounter carrying
 * an exact imported appointment id but no provider was stuck forever: auto-bind
 * refused to run and the row stayed blocked. The guard is now the row's real
 * capability, which is strictly tighter for the case it used to cover AND opens
 * the case it used to strand. The appointment identity is frozen in exchange:
 * a candidate set resolving a different id than the manifest already names is
 * refused before any probe is sent. */
ok(/if \(row\.capability === 'ready'\) return false;/.test(bindCall),
  'auto-bind must not run when the review can already send - that is the row capability, not merely an appointment id');
ok(/var priorAppointmentId = nrmId\(m\.visit && m\.visit\.appointmentId\);/.test(bindCall),
  'the appointment identity already on the manifest must be captured before probing');
ok(/if \(priorAppointmentId && nrmId\(set\.appointmentId\) !== priorAppointmentId\) return false;/.test(bindCall),
  'a candidate set naming a DIFFERENT appointment than the manifest must be refused before any probe');
ok(/state\.probeGeneration !== gen/.test(bindCall),
  'a superseded probe generation must be discarded - the user moved on');
ok(/if \(!liveRow \|\| liveRow\.capability === 'ready' \|\| liveRow\.rowHash !== row\.rowHash\) return;/.test(bindCall),
  'a binding (or any row rebuild) that arrived while the probe was in flight must win over the late result');
ok(/if \(nrmId\(state\.manifest\.visit && state\.manifest\.visit\.appointmentId\) !== priorAppointmentId\) return;/.test(bindCall),
  'a late result must never be adopted onto a manifest whose appointment identity moved');
ok(/p1SamePatient\(patientAtStart, actionPatient\(\{ patient: activePt\(\) \}\)\)/.test(bindCall),
  'a patient switch while probes run must discard every result');
ok(/currentSource !== source \|\| currentPullResult !== pullResult/.test(bindCall),
  'a newer schedule response while probes run must discard the stale result');

/* ---- 5. house convention ---- */
ok(/window\.__mlsP1AutoBind = \{/.test(src), 'must expose window.__mlsP1AutoBind');
ok(/revert: function \(\) \{ p1AutoBindOff = true; return true; \}/.test(src), 'revert() must disable auto-bind');
ok(/state: function \(\)/.test(src), 'state() must report off/last for diagnosis');
ok(/try \{ p1AutoBindEncounter\(state\); \} catch \(eP1AB\) \{\}/.test(src),
  'the call site must be wrapped so a bind failure can never break opening the review');

console.log('PASS 1p-autobind-encounter (' + checks + ' assertions)');
