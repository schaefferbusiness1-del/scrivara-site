'use strict';
/* relay-full-notes-choice-travels — rl-2.0.2 N4 (2026-07-25)
 *
 * WHY THIS EXISTS
 * A relay pull is COMMANDED BY THE PHONE but EXECUTED on the office computer.
 * The importer decided how much of the patient's record to fetch by reading
 * `pullVisitBodies` from the EXECUTING device's localStorage
 * (feat_mls_schedimport_exact.js), so the office machine's checkbox silently
 * governed a pull the clinician started on the phone in their hand. The phone's
 * own "Full visit notes" control had no effect whatsoever on the result.
 *
 * This is a PHI-scope flag — it decides whether every encounter note comes back
 * — so each hop is asserted separately rather than trusting the chain:
 *   phone control -> job payload -> relay agent -> pull() -> importer read.
 *
 * The default must be UNCHANGED: a caller that says nothing leaves the
 * executing device's stored preference in charge, exactly as before.
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const connect = read('mls-connect.js');
const importer = read('feat_mls_schedimport_exact.js');

/* ---- hop 1: the phone puts its own control's value in the payload ---- */
/* Anchor on where the payload is BUILT, not on the fetch body — the frozen trio
   is a named object so the choice can be added without disturbing it. */
const queueIdx = connect.indexOf('var jobPayload = { date: date, provider: provider, requestId: requestId }');
assert(queueIdx > 0, 'the frozen pullDay payload could not be located');
const queueBlock = connect.slice(queueIdx, queueIdx + 2400);
assert(/getElementById\('mlsDsVisitBodies'\)/.test(queueBlock),
  'the queued job must read the phone\'s own "Full visit notes" control');
assert(/jobPayload\.pullVisitBodies\s*=\s*!!_bt\.checked/.test(queueBlock),
  'the control\'s value must be placed in the job payload');
assert(/if \(_bt && typeof _bt\.checked === 'boolean'\)/.test(queueBlock),
  'when the control is absent the payload must stay SILENT, so the executing device keeps deciding');
assert(/payload: jobPayload/.test(queueBlock), 'the queued job must send the frozen payload object');

/* ---- hop 1b: the choice is part of the request identity ----
 * Without this, asking for the same day with notes ON coalesces onto an earlier
 * OFF job and returns the smaller result as a success. */
assert(/dedupeKey:[\s\S]{0,400}mlsDsVisitBodies/.test(queueBlock),
  'the dedupe key must include the body-notes choice, or an ON request silently ' +
  'reuses an earlier OFF result and reports success');

/* ---- hop 2: the relay agent forwards it into the pull options ---- */
const agentIdx = connect.indexOf('if (pl.includeHistory === false)');
assert(agentIdx > 0, 'the relay agent pull-option mapping could not be located');
const agentBlock = connect.slice(agentIdx, agentIdx + 900);
assert(/typeof pl\.pullVisitBodies === 'boolean'/.test(agentBlock),
  'the agent must forward ONLY an explicit boolean — anything else must not override the device');
assert(/opts\.pullVisitBodies = pl\.pullVisitBodies/.test(agentBlock),
  'the agent must place the requested choice into the pull options');

/* ---- hop 3: pull() scopes it to exactly one pull ---- */
assert(/var _pullBodiesOverride = null;/.test(importer),
  'the importer needs a per-pull override slot');
const pullIdx = importer.indexOf('function pull(opts) {');
assert(pullIdx > 0, 'pull(opts) could not be located');
const pullBlock = importer.slice(pullIdx, pullIdx + 2600);
assert(/_pullBodiesOverride = \(typeof opts\.pullVisitBodies === "boolean"\) \? opts\.pullVisitBodies : null;/.test(pullBlock),
  'pull() must set the override from an explicit boolean and otherwise CLEAR it');
/* Cleared on BOTH settle paths, or one remote request leaks into the next pull —
   which could be a local pull by the doctor sitting at that desk. */
const settleTail = importer.slice(pullIdx, pullIdx + 3400);
/* Exactly two BARE clears inside pull(): one per settle path. The initial set
   ends `: null;` and deliberately does not match this literal, so counting it
   here would have made the assertion pass for the wrong reason. */
const clears = (settleTail.match(/_pullBodiesOverride = null;/g) || []).length;
assert.strictEqual(clears, 2,
  'the override must be cleared on exactly the two settle paths, success AND failure (found ' + clears +
  '); a leaked override would silently change the NEXT pull, which may be a local one at that desk');
assert(/}, function \(err\) \{[\s\S]{0,300}_pullBodiesOverride = null;[\s\S]{0,120}throw err;/.test(settleTail),
  'the failure path must clear the override and rethrow, not swallow the error');

/* ---- hop 4: the importer consults the override BEFORE the device preference ----
 * Order is the whole contract. If the localStorage read came first, the override
 * would be dead code and every assertion above would still pass. */
const readIdx = importer.indexOf('var pullVisitBodies = safe(function () {');
assert(readIdx > 0, 'the pullVisitBodies read could not be located');
const readBlock = importer.slice(readIdx, readIdx + 1800);
const overridePos = readBlock.indexOf('if (typeof _pullBodiesOverride === "boolean") return _pullBodiesOverride;');
const storagePos = readBlock.indexOf('localStorage.getItem(k)');
assert(overridePos > 0, 'the read must consult the per-pull override');
assert(storagePos > 0, 'the device preference read vanished');
assert(overridePos < storagePos,
  'the override must be consulted BEFORE this device\'s stored preference, or it is dead code');

/* ---- with no override, the shared tri-state governs (2026-07-28: default
   ON; a recorded human choice — the pullVisitBodiesSet marker — is respected;
   the legacy code-authored '0' is ignored). The per-pull override above still
   outranks everything, which is this suite's actual subject. ---- */
assert(/return chosen \? v !== "0" : true;/.test(readBlock),
  'with no override the shared tri-state preference must govern (default ON, human choice respected)');
assert(/pullVisitBodiesSet/.test(readBlock),
  'the no-override path must consult the human-choice marker');

console.log('PASS relay full-notes choice travels: phone control -> payload -> agent -> pull() -> importer, ' +
  'override consulted before the device preference, scoped to one pull, cleared on success and failure, ' +
  'and part of the dedupe identity');
