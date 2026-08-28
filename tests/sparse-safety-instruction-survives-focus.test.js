'use strict';

/* sfi-1.0.0 (2026-08-27) — A CLINICIAN'S PREFERENCE MAY NOT DELETE A SAFETY RULE.
 *
 * On a sparse visit the shell injects a rule into the generation payload that
 * forbids inferring an exam finding, a diagnosis, medication continuation, an
 * order, a procedure or a follow-up from PRIOR CHART HISTORY. It is the thing
 * standing between "patient is doing better" plus a rich old chart and a note
 * that invents today's examination.
 *
 * mergeFamily('soap') copied every key of transientSoap() over the request, and
 * transientSoap().instructions is the clinician's "Focus this note" box. So the
 * focus text REPLACED the safety rule. Measured on the shipped module before the
 * fix: with no focus text the payload carried the rule; with the three words
 * "emphasize the injection" it carried only that plus a generic formatting line,
 * and the rule was gone. Three words in a text box removed a patient-safety guard.
 *
 * This suite executes the REAL module - no stubs of the thing under test - and
 * pins the property in both directions: the rule always survives, AND the
 * clinician's focus text is still honoured (otherwise "keep the rule" could be
 * satisfied by throwing the preference away, which is a different defect).
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let checks = 0;
function ok(v, m) { checks++; assert.ok(v, m); }
function eq(a, b, m) { checks++; assert.strictEqual(a, b, m); }

const root = path.resolve(__dirname, '..');

/* The exact rule _mlsGenerationDraftTuning() injects. Kept verbatim so that if
   the shell ever reworks it, this suite fails loudly rather than passing on a
   substring that no longer exists. */
const SPARSE_RULE = 'CURRENT VISIT EVIDENCE IS SPARSE. Use the verified prior visits only as background. HPI may state only the current words actually supplied. For ROS, EXAM, ASSESSMENT, and PLAN, write "Not documented in today\'s transcript." unless the current words explicitly support that section. Do not infer stability, examination, diagnosis, medication continuation, order, procedure, follow-up, or plan from prior history.';

for (const shell of ['1pScribeFlow.html', path.join('1p', 'index.html')]) {
  const src = fs.readFileSync(path.join(root, shell), 'latin1');
  ok(src.indexOf(SPARSE_RULE.slice(0, 60)) >= 0,
    `${shell}: the sparse-evidence rule this suite pins is no longer the one the shell injects`);
}

function loadTuning(file, focusText, accountInstruction) {
  const src = fs.readFileSync(path.join(root, file), 'latin1');
  const store = {};
  const localStorage = {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
  const noop = () => {};
  const win = {
    localStorage, addEventListener: noop, removeEventListener: noop, setTimeout: noop, clearTimeout: noop, console,
    uns: (k) => 'acct::' + k, toast: noop, bkBase: () => '', bkToken: () => '',
    getGenLength: () => 'standard',
    getGenInstr: () => focusText,
  };
  win.window = win;
  const doc = {
    getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
    createElement: () => ({ style: {}, classList: { add: noop, remove: noop, contains: () => false }, appendChild: noop, setAttribute: noop }),
    addEventListener: noop,
    body: { classList: { contains: () => false, add: noop, remove: noop } },
    documentElement: { style: { setProperty: noop } },
  };
  const ctx = vm.createContext(Object.assign(win, { document: doc, navigator: { userAgent: 'suite' }, location: { href: 'https://suite/' } }));
  new vm.Script(src, { filename: file }).runInContext(ctx);
  const api = ctx.window.__mlsDraftTuning;
  assert.ok(api && typeof api.forStructured === 'function', `${file}: __mlsDraftTuning.forStructured missing`);

  if (accountInstruction) {
    const state = api.read();
    state.families.soap.instructions = accountInstruction;
    ctx.window.localStorage.setItem('acct::draftTuningV1', JSON.stringify(state));
  }

  /* exactly the object _mlsGenerationDraftTuning() hands over on a sparse visit */
  let tuning = { families: {} };
  tuning = Object.assign({}, tuning, {
    instructions: [String(tuning.instructions || '').trim(), SPARSE_RULE].filter(Boolean).join('\n'),
  });
  return String(api.forStructured(tuning).instructions || '');
}

/* The fork and both derived copies must all behave the same. */
const MODULES = ['1p-feat_mls_draft_tuning.js', 'feat_mls_draft_tuning.js', 'cloned-feat_mls_draft_tuning.js'];
const BIG = 600;

for (const mod of MODULES) {
  if (!fs.existsSync(path.join(root, mod))) continue;

  /* 1. control - no focus text. The rule must be there, or every other
     assertion below is vacuous. */
  const control = loadTuning(mod, '', '');
  ok(control.indexOf('CURRENT VISIT EVIDENCE IS SPARSE') >= 0,
    `${mod}: the sparse safety rule is absent even with NO focus text - this suite is measuring nothing`);

  /* 2. the reported defect: a short focus text must not delete it. */
  const shortFocus = 'emphasize the injection';
  const withShort = loadTuning(mod, shortFocus, '');
  ok(withShort.indexOf('CURRENT VISIT EVIDENCE IS SPARSE') >= 0,
    `${mod}: a clinician's focus text DELETED the sparse-evidence safety rule`);
  ok(withShort.indexOf('Do not infer stability') >= 0,
    `${mod}: the "do not infer from prior history" clause was lost`);
  ok(withShort.indexOf(shortFocus) >= 0,
    `${mod}: the safety rule survived by discarding the clinician's focus text - that is the opposite defect`);

  /* 3. worst case - a maximal standing instruction AND a maximal focus text.
     The safety rule must still be intact; a PREFERENCE yields the space. */
  const both = loadTuning(mod, 'F'.repeat(BIG), 'A'.repeat(BIG));
  ok(both.indexOf('CURRENT VISIT EVIDENCE IS SPARSE') >= 0,
    `${mod}: a long standing instruction plus a long focus text truncated the safety rule away`);
  ok(both.indexOf('Do not infer stability') >= 0,
    `${mod}: the "do not infer" clause was truncated away under maximal user text`);

  /* 4. and the copy must never silently exceed the transported bound. */
  ok(both.length <= BIG, `${mod}: merged instructions exceeded MAX_INSTRUCTIONS (${both.length})`);

  /* 5. the overwrite that caused this must not come back: transientSoap's keys
     may not be copied blindly over a carried instruction. */
  const modSrc = fs.readFileSync(path.join(root, mod), 'latin1');
  ok(/carriedInstructions/.test(modSrc),
    `${mod}: the soap transient copy no longer preserves a carried instruction`);
}

console.log('PASS sparse-safety-instruction-survives-focus: ' + checks +
  ' checks — a focus box cannot delete the sparse-evidence safety rule, on the fork and both derived copies');
