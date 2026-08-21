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

function extractBraced(src, token) {
  const at = src.indexOf(token);
  assert(at >= 0, 'extractor found ' + token);
  const open = src.indexOf('{', at);
  let depth = 0, quote = null, lineComment = false, blockComment = false;
  for (let i = open; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (lineComment) { if (c === '\n') lineComment = false; continue; }
    if (blockComment) { if (c === '*' && n === '/') { blockComment = false; i++; } continue; }
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = null; continue; }
    if (c === '/' && n === '/') { lineComment = true; i++; continue; }
    if (c === '/' && n === '*') { blockComment = true; i++; continue; }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return src.slice(at, i + 1);
  }
  throw new Error('unbalanced braces after ' + token);
}

/* ---- hop 1: the phone puts its own control's value in the payload ---- */
/* Anchor on where the payload is BUILT, not on the fetch body — the frozen trio
   is a named object so the choice can be added without disturbing it. */
const queueIdx = connect.indexOf('var jobPayload = { date: date, provider: provider, requestId: requestId }');
assert(queueIdx > 0, 'the frozen pullDay payload could not be located');
const queueBlock = connect.slice(queueIdx, queueIdx + 3400);
assert(/getElementById\('mlsDsVisitBodies'\)/.test(queueBlock),
  'the queued job must still know the phone\'s own "Full visit notes" control (fallback for unchosen accounts)');
/* qol-1.1a/qol-2.0: the stored choice (via the ONE resolver) outranks the DOM
   view; the DOM is only the unchosen-account fallback. Executed with the real
   resolver in qol-setting-reaches-the-pull. */
assert(/__mlsVisitNotesPref/.test(queueBlock),
  'the queued job must resolve the clinician\'s STORED choice through the resolver');
assert(/_vr\.state !== 'unset'/.test(queueBlock),
  'only a real recorded choice may outrank the visible control');
assert(/jobPayload\.pullVisitBodies\s*=\s*_bv/.test(queueBlock),
  'the resolved value must be placed in the job payload');
assert(/if \(_bt && typeof _bt\.checked === 'boolean'\)/.test(queueBlock),
  'when nothing is chosen and the control is absent the payload must stay SILENT, so the executing device keeps deciding');
assert(/payload: jobPayload/.test(queueBlock), 'the queued job must send the frozen payload object');

/* ---- hop 1b: the choice is part of the request identity ----
 * Without this, asking for the same day with notes ON coalesces onto an earlier
 * OFF job and returns the smaller result as a success. */
assert(/dedupeKey:[\s\S]{0,700}mlsDsVisitBodies/.test(queueBlock) && /dedupeKey:[\s\S]{0,700}__mlsVisitNotesPref/.test(queueBlock),
  'the dedupe key must include the body-notes choice (resolved, DOM fallback), or an ON ' +
  'request silently reuses an earlier OFF result and reports success');

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
const pullBlock = extractBraced(importer, 'function pull(opts) {');
assert(/_pullBodiesOverride = \(typeof opts\.pullVisitBodies === "boolean"\) \? opts\.pullVisitBodies : null;/.test(pullBlock),
  'pull() must set the override from an explicit boolean and otherwise CLEAR it');
/* Cleared on BOTH settle paths, or one remote request leaks into the next pull —
   which could be a local pull by the doctor sitting at that desk. */
const settleTail = pullBlock;
/* Exactly two ownership-guarded clears inside pull(): one per settle path. A
   busy click does not own the active pull and must not clear its override. */
const clears = (settleTail.match(/if \(__ownedPull\) _pullBodiesOverride = null;/g) || []).length;
assert.strictEqual(clears, 2,
  'the override must be cleared on exactly the two settle paths, success AND failure (found ' + clears +
  '); a leaked override would silently change the NEXT pull, which may be a local one at that desk');
assert(/}, function \(err\) \{[\s\S]{0,500}if \(__ownedPull\) _pullBodiesOverride = null;[\s\S]{0,120}throw err;/.test(settleTail),
  'the failure path must clear the override and rethrow, not swallow the error');

/* ---- hop 4: the importer consults the override BEFORE the device preference ----
 * Order is the whole contract. If the localStorage read came first, the override
 * would be dead code and every assertion above would still pass. */
const readIdx = importer.indexOf('var pullVisitBodies = safe(function () {');
assert(readIdx > 0, 'the pullVisitBodies read could not be located');
const readBlock = importer.slice(readIdx, readIdx + 1800);
const overridePos = readBlock.indexOf('if (typeof _pullBodiesOverride === "boolean") return _pullBodiesOverride;');
const resolverPos = readBlock.indexOf('__mlsVisitNotesPref');
assert(overridePos > 0, 'the read must consult the per-pull override');
assert(resolverPos > 0, 'the device preference resolution vanished');
assert(overridePos < resolverPos,
  'the override must be consulted BEFORE this device\'s resolved preference, or it is dead code');

/* ---- with no override, the ONE resolver governs (2026-07-28: default ON;
   a recorded human choice is respected; the legacy code-authored '0' is
   ignored — all execution-proven on the shipped resolver in
   pull-visit-bodies-default-on). The per-pull override above still outranks
   everything, which is this suite's actual subject. ---- */
assert(/return vnp\.read\(\)\.on === true/.test(readBlock),
  'with no override the resolved tri-state must govern (default ON, human choice respected)');

console.log('PASS relay full-notes choice travels: phone control -> payload -> agent -> pull() -> importer, ' +
  'override consulted before the device preference, scoped to one pull, cleared on success and failure, ' +
  'and part of the dedupe identity');
