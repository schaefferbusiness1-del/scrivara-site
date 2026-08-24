/* wv-1.x (3.0.40) WRITE VERIFICATION CONTRACT.
 *
 * The 2026-08-02 adversarial audit CONFIRMED (high confidence) four write-path
 * defects, all replayed or pinned here:
 *   1. landed()'s 40-char-prefix early-return ran BEFORE the v3.0.31
 *      unchanged-field guard, so a field already holding note v1 confirmed a
 *      failed re-paste of v2 whenever the two shared an opening line - the
 *      doctor was told the UPDATED note landed while the OLD note stayed;
 *   2. a 3000-char note truncated at ~100 chars by a detached input handler
 *      verified off its first 40 chars, and the bare >=15-changed-chars
 *      fallback confirmed FOREIGN text as a verified write;
 *   3. pickSuggestion's last resort clicked the first item of ANY visible
 *      <=25-item list (athena's left nav qualifies) after every type/paste;
 *   4. the autopilot pastenote branch typed into the LARGEST visible free-text
 *      box on athenaOne with no patient-identity gate, no note scope and no
 *      review screen; and the V2 contenteditable writer set textContent (so
 *      innerText readback lost every newline) and left the mangled note on
 *      screen when verification failed.
 * Synthetic text only. */

'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const candidateChain = ['3.0.45', '3.0.44', '3.0.43', '3.0.42', '3.0.41', '3.0.40'].map(v => path.join(root, 'extension-candidates', v, 'background.js'));
const bgPath = candidateChain.find(p => fs.existsSync(p)) || path.join(root, 'background.js');
const background = fs.readFileSync(bgPath, 'utf8');
const activeBackgroundPath = path.join(root, 'background.js');
const activeBackground = fs.readFileSync(activeBackgroundPath, 'utf8');

let n = 0;
function ok(name) { n++; console.log('ok ' + n + ' - ' + name); }

/* ---- 1. landed() functional replay (all three copies must be identical) ---- */
{
  const marker = 'function landed() { var cur = rd();';
  let count = 0, idx = 0;
  const copies = [];
  while ((idx = background.indexOf(marker, idx)) !== -1) {
    const end = background.indexOf('function setNative', idx);
    const endAlt = background.indexOf('return false; }', idx);
    const stop = background.indexOf('}', background.indexOf('return false; }', idx)) + 1;
    copies.push(background.slice(idx, background.indexOf('return false; }', idx) + 'return false; }'.length));
    count++; idx += marker.length;
  }
  assert.strictEqual(count, 3, 'exactly three landed() copies');
  assert.ok(copies.every(c => c === copies[0]), 'all three landed() copies byte-identical');

  const norm = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const digits = s => String(s || '').replace(/\D+/g, '');
  function makeLanded(fieldValue, intended, preWrite, maskedFlag) {
    const fn = new Function('rd', 'norm', 'txt', 'masked', 'digits', '__mlsWrote0N',
      'return (' + copies[0] + ')');
    return fn(() => fieldValue, norm, intended, !!maskedFlag, digits, norm(preWrite));
  }
  const V1 = 'CHIEF COMPLAINT: low back pain radiating to the left leg. HPI: symptoms began three weeks ago after lifting.';
  const V2 = 'CHIEF COMPLAINT: low back pain radiating to the left leg. HPI: symptoms improved with therapy; new exam findings documented today.';

  /* the audit's exact stale-note shape: field still holds v1 after a failed re-paste of v2 */
  assert.strictEqual(makeLanded(V1, V2, V1)(), false,
    'an UNCHANGED pre-filled field must never confirm (shared opening line)');
  ok('stale-note false-confirm closed (unchanged-field refusal runs first)');

  /* truncation: 3000-char note, field holds the first 100 chars */
  const LONG = Array.from({ length: 60 }, (_, i) => 'Paragraph ' + i + ' of the operative note with substantive clinical content.').join(' ');
  assert.strictEqual(makeLanded(LONG.slice(0, 100), LONG, '')(), false,
    'a truncated landing must not verify off its 40-char prefix');
  ok('truncated-note false-confirm closed');

  /* foreign text: changed field holding entirely different >=15-char content */
  assert.strictEqual(makeLanded('SOMETHING ENTIRELY DIFFERENT LANDED HERE', LONG, '')(), false,
    'foreign text must never confirm (length fallback retired)');
  ok('foreign-text false-confirm closed (length fallback retired)');

  /* genuine landings still confirm */
  assert.strictEqual(makeLanded(LONG, LONG, '')(), true, 'exact landing confirms');
  assert.strictEqual(makeLanded('PREFIX ' + LONG + ' SUFFIX', LONG, '')(), true, 'containment confirms');
  assert.strictEqual(makeLanded(V1, V1, V1)(), true, 'intended text already present confirms');
  assert.strictEqual(makeLanded(LONG.replace(/\s+/g, '  ') + ' ', LONG, '')(), true, 'whitespace-normalizing editor confirms via prefix + ~full length');
  assert.strictEqual(makeLanded('(555) 123-4567', '5551234567', '', true)(), true, 'masked digits containment kept');
  ok('genuine landings all still confirm (exact, containment, prefilled-equal, normalized, masked)');
}

/* ---- 2. pickSuggestion: generic scan retired, non-matching never clicked ---- */
{
  const pickCount = (background.match(/async function pickSuggestion\(\)/g) || []).length;
  assert.strictEqual(pickCount, 3, 'three pickSuggestion copies');
  assert.strictEqual((background.match(/querySelectorAll\('ul,ol,\[role=listbox\],\[role=menu\]'\)/g) || []).length, 0,
    'the generic ul/ol/menu list scan is gone from every copy');
  assert.strictEqual((background.match(/if \(!pick\) pick = opts\[0\];/g) || []).length, 0,
    'the non-matching opts[0] fallback is gone from every copy');
  assert.strictEqual((background.match(/a NON-MATCHING first item is never clicked/g) || []).length, 3,
    'all three copies carry the wv-1.1 refusal');
  ok('pickSuggestion: generic-list scan retired, non-matching first item never clicked (x3)');
}

/* ---- 3. autopilot free-typing refused on athenaOne ---- */
{
  const gateIdx = background.indexOf("/^(type|pastenote)$/.test(String(action.type || ''))");
  assert.ok(gateIdx > 0, 'athena type/pastenote gate present');
  const execIdx = background.indexOf("const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });");
  const frameRouteIdx = background.indexOf('let _execTarget = { tabId: tab.id };');
  assert.ok(execIdx > 0 && gateIdx > execIdx && gateIdx < frameRouteIdx,
    'the gate sits between tab resolution and frame routing (nothing executes before it)');
  /* the pastenote branch itself is untouched for non-athena EMRs */
  assert.ok(background.indexOf("if (a.type === 'pastenote') {") !== -1, 'generic-EMR pastenote branch preserved');
  ok('autopilot type/pastenote refused on athenaOne before any execution');
}

/* ---- 4. CE note write round-trips newlines and rolls back on failure ---- */
{
  assert.ok(activeBackground.indexOf("_ceDoc.createElement('br')") !== -1, 'active CE write builds text+<br> nodes');
  assert.ok(activeBackground.indexOf('while (el.firstChild) el.removeChild(el.firstChild);') !== -1, 'active CE write clears prior children');
  assert.ok(activeBackground.indexOf('rolledBack: rolledBack,') !== -1, 'active failed verification reports rolledBack');
  const rbIdx = activeBackground.indexOf('The empty-editor precheck above means rollback == clearing back to empty');
  assert.ok(rbIdx > 0, 'rollback rationale present');
  /* rollback must be gated on noteAttempted && !alreadyExact so a pre-existing
     exact note is never cleared */
  assert.ok(activeBackground.indexOf('if (noteAttempted && !alreadyExact) {') !== -1,
    'rollback never clears a note that was already present');
  const activeDriverStart = activeBackground.indexOf('async function mlsAthenaActionV2DriverFn(');
  const activeDriverEnd = activeBackground.indexOf('/* ATHENA_ACTION_V2_DRIVER_END */', activeDriverStart);
  assert.ok(activeDriverStart >= 0 && activeDriverEnd > activeDriverStart, 'active ActionV2 driver source is available');
  const activeDriver = activeBackground.slice(activeDriverStart, activeDriverEnd);
  assert.ok(activeDriver.indexOf("reason: 'exact-note-editor-verified-unsaved'") !== -1,
    'active named write receipt has an explicit unsaved reason');
  assert.ok(activeDriver.indexOf('saved: false, persisted: false, signed: false') !== -1,
    'active named write receipt does not claim save or persistence');
  ok('active CE rollback + named write: newline round-trip, fail-closed rollback, and explicit unsaved receipt');
}

console.log('# athena-write-verification-contract: ' + n + ' checks passed');
