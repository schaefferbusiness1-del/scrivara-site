/* 1p-autobind-encounter.test.js  (1p PREVIEW ONLY)
 *
 * Pins p1-autobind-1.0.0.
 *
 * Owner, on being told to run a day pull before the review would send:
 * "well this is unacceptable it should be able to figure it out".
 *
 * THE CHICKEN AND EGG being fixed: a row is executable only when the visit is bound
 * (appointmentId, or encounterId + encounterUrl), those come from a day pull, and
 * probeUnifiedRow() -- the one thing that reads the open encounter -- refuses to run
 * until the row is already ready. So the app locked itself out of the read that would
 * answer its own question.
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
 * Touches only 1p-feat_mls_writeflow.js.
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
ok(/p1-autobind-1\.[0-9]+\.[0-9]+/.test(src), 'the p1-autobind block is missing');
/* slice forward from the function itself - the block's header comment mentions
 * window.__mlsP1AutoBind earlier, so an indexOf on that name lands in the prose */
const bindStart = src.indexOf('function p1AutoBindEncounter');
ok(bindStart > -1, 'p1AutoBindEncounter must exist');
const bindCall = src.slice(bindStart, bindStart + 5000);
ok(/mode: 'probe'/.test(bindCall),
  'the auto-bind call MUST be mode:probe - read-only');
ok(!/mode: 'execute'/.test(bindCall),
  'the auto-bind path must NEVER use mode:execute - that writes to a real patient chart');

/* ---- 2. NO GUARD WEAKENED ---- */
/* the predicate is line-wrapped in the source, so match across whitespace */
ok(/visitReady = !!visit\.visitDate && !!visit\.provider &&\s*\(!!visit\.appointmentId \|\| \(!!visit\.encounterId && !!visit\.encounterUrl\)\)/.test(src),
  'the visitReady predicate must keep its original shape - auto-bind SATISFIES it, never relaxes it');
ok(/validatedUnifiedProbe\(state\.manifest\.patient, probe \|\| \{\}\)/.test(bindCall),
  'the adopted context must come through validatedUnifiedProbe, which checks name+DOB+MRN against the open chart');
ok(/if \(!lock \|\| !lock\.ok \|\| !lock\.context\) return;/.test(bindCall),
  'a probe that is not verified must bind nothing');
ok(/if \(!S\(c\.encounterId\)\.trim\(\) \|\| !S\(c\.encounterUrl\)\.trim\(\)\) return;/.test(bindCall),
  'both encounter fields must be present or nothing is adopted');
ok(/if \(!S\(p\.name\)\.trim\(\) \|\| !S\(p\.dob\)\.trim\(\) \|\| !S\(p\.mrn\)\.trim\(\)\) return false;/.test(bindCall),
  'auto-bind must refuse to run at all when the patient identity is incomplete');

/* ---- 3. REBUILD, NEVER MUTATE ---- */
ok(/var rebuilt = buildUnifiedManifest\(o1\);/.test(bindCall),
  'the enriched visit must go through buildUnifiedManifest for a fresh, correctly-hashed freeze');
ok(!/state\.manifest\.visit\.(encounterId|encounterUrl) =/.test(src),
  'the frozen manifest must never be mutated in place - the hashes would stop matching the payload');
ok(/state\.reopenOpts = reopenOptions\(o1, rebuilt\);/.test(bindCall),
  'reopen options must be rebuilt alongside the manifest or a reopen loses the binding');

/* ---- 4. FAILS CLOSED on every abandonment path ---- */
ok(/if \(p1AutoBindOff \|\| !state \|\| state\.closed \|\| state\.running \|\| state\.halted\) return false;/.test(bindCall),
  'auto-bind must not run while closed, running or halted');
ok(/if \(p1VisitBound\(m\.visit\)\) return false;/.test(bindCall),
  'auto-bind must not run when the visit is already bound');
ok(/state\.probeGeneration !== gen/.test(bindCall),
  'a superseded probe generation must be discarded - the user moved on');
ok(/if \(p1VisitBound\(state\.manifest && state\.manifest\.visit\)\) return;/.test(bindCall),
  'a binding that arrived while the probe was in flight must win over the late result');

/* ---- 5. house convention ---- */
ok(/window\.__mlsP1AutoBind = \{/.test(src), 'must expose window.__mlsP1AutoBind');
ok(/revert: function \(\) \{ p1AutoBindOff = true; return true; \}/.test(src), 'revert() must disable auto-bind');
ok(/state: function \(\)/.test(src), 'state() must report off/last for diagnosis');
ok(/try \{ p1AutoBindEncounter\(state\); \} catch \(eP1AB\) \{\}/.test(src),
  'the call site must be wrapped so a bind failure can never break opening the review');

console.log('PASS 1p-autobind-encounter (' + checks + ' assertions)');
