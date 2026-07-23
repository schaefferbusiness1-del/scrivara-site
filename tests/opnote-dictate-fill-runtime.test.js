'use strict';

/* onf-2.9.0 DICTATE & FILL — the physician dictates naturally; AI routes the
 * dictation into the note's fill fields. Pinned truths:
 *  1. The routing prompt lists every field with its ALREADY-SET/blank state,
 *     demands normalization of medical terminology/units, forbids guessing,
 *     and requires correction:true for any already-set field.
 *  2. parseRouteResult tolerates fenced/wrapped JSON and drops junk entries.
 *  3. planRoutedFills NEVER auto-applies over a clinician-set value: blanks
 *     apply, explicit corrections become tap-to-confirm offers, everything
 *     else is ignored (with the reason kept).
 *  4. Capture stays the pinned Dictate-Anywhere engine — this feature adds NO
 *     SpeechRecognition/MutationObserver of its own, and the fill-box mic
 *     buttons route through __mlsDictateAnywhere.toggleFor.
 *  5. A failed AI call keeps the transcript (routeDictation returns null and
 *     the pad is only cleared after a successful apply).
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const onfSource = fs.readFileSync(path.join(root, 'feat_mls_opnote_fill.js'), 'utf8');

function makeContext() {
  const timers = { set() { return 0; } };
  const context = {
    console, Promise, Date, Math, JSON, Object, String, Number, Array, RegExp, Error,
    setTimeout, clearTimeout, setInterval() { return 0; }, clearInterval() {},
    Event: function Event(type, opts) { this.type = type; this.bubbles = !!(opts && opts.bubbles); },
    document: {
      readyState: 'complete', addEventListener() {}, removeEventListener() {},
      getElementById() { return null; }, querySelector() { return null; }, querySelectorAll() { return []; },
      createElement() { return { style: {}, setAttribute() {}, appendChild() {}, addEventListener() {}, classList: { add() {}, toggle() {} } }; },
      head: { appendChild() {} }, documentElement: { appendChild() {} }, body: { appendChild() {} }
    },
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    getTemplates() { return []; }, getPatients() { return []; },
    uns(k) { return 'test::' + k; },
    toast() {}
  };
  context.window = context;
  vm.runInNewContext(onfSource, context, { filename: 'feat_mls_opnote_fill.js' });
  return context;
}

async function main() {
  const ctx = makeContext();
  const api = ctx.__mlsOpNoteFill;
  assert(api && api.installed && api.version === 'onf-2.9.0', 'onf did not install at 2.9.0');
  const d = api._dictation;
  assert(d && ['buildRoutePrompt', 'parseRouteResult', 'planRoutedFills', 'routeDictation', 'normalizeDictatedField'].every(k => typeof d[k] === 'function'),
    'dictation API surface incomplete');

  /* 1. routing prompt contract */
  const fields = [
    { label: 'needle gauge', value: '', touched: false },
    { label: 'injectate', value: '0.25% bupivacaine, 1 mL', touched: true }
  ];
  const p = d.buildRoutePrompt(fields, 'PROCEDURE: ...note text...', 'twenty two gauge three and a half');
  assert(p.sys.includes('ONLY fields the dictation clearly addresses'), 'prompt allows guessing');
  assert(p.sys.includes('"correction":true') || p.sys.includes('correction'), 'prompt lacks the correction contract');
  assert(p.sys.includes('22-gauge, 3.5-inch') || /normaliz/i.test(p.sys), 'prompt lacks normalization instruction');
  assert(p.user.includes('- needle gauge [blank]'), 'blank field state missing from prompt');
  assert(p.user.includes('- injectate [ALREADY-SET: 0.25% bupivacaine, 1 mL]'), 'already-set state missing from prompt');
  assert(p.user.includes('DICTATION:'), 'transcript missing from prompt');

  /* 2. tolerant parsing */
  const parsed = d.parseRouteResult('```json\n{"fills":[{"field":"needle gauge","value":"22-gauge, 3.5-inch"},{"field":"","value":"x"},{"junk":1},{"field":"injectate","value":"0.5% bupivacaine, 2 mL","correction":true}]}\n```');
  assert.strictEqual(parsed.length, 2, 'junk entries not dropped');
  assert.strictEqual(parsed[0].value, '22-gauge, 3.5-inch');
  assert.strictEqual(parsed[1].correction, true);

  /* 3. never-overwrite planning */
  const plan = d.planRoutedFills(parsed, fields);
  assert.strictEqual(plan.apply.length, 1, 'blank field did not plan to apply');
  assert.strictEqual(plan.apply[0].label, 'needle gauge');
  assert.strictEqual(plan.corrections.length, 1, 'explicit correction did not become a confirm offer');
  assert.strictEqual(plan.corrections[0].was, '0.25% bupivacaine, 1 mL');
  // a non-correction fill against a set field is IGNORED
  const plan2 = d.planRoutedFills([{ field: 'injectate', value: 'anything', correction: false }], fields);
  assert.strictEqual(plan2.apply.length, 0);
  assert.strictEqual(plan2.corrections.length, 0);
  assert.strictEqual(plan2.ignored.length, 1, 'silent overwrite was not ignored');
  assert.strictEqual(plan2.ignored[0].why, 'already-set');
  // unknown fields are ignored with a reason, never invented
  const plan3 = d.planRoutedFills([{ field: 'nonexistent thing', value: 'x', correction: false }], fields);
  assert.strictEqual(plan3.ignored[0].why, 'unknown-field');

  /* 4. capture stays the pinned engine; no home-grown recognizer/observer */
  assert(!/new\s+(webkit)?SpeechRecognition|SpeechRecognition\s*\(/.test(onfSource), 'onf must not own a SpeechRecognition');
  assert(!/MutationObserver/.test(onfSource), 'onf must not add a MutationObserver');
  assert(onfSource.includes('.toggleFor('), 'mic buttons do not route through Dictate Anywhere');
  assert(onfSource.includes("data-onf-mic"), 'per-field mic affordance missing');
  assert(onfSource.includes('mlsOnfDictPad_'), 'dictation pad missing');

  /* 5. failure keeps the transcript: routeDictation resolves null on AI error */
  ctx.aiCallRaw = async () => { throw new Error('Failed to fetch'); };
  ctx.window.aiCallRaw = ctx.aiCallRaw;
  const row = { _onfRaw: 'NEEDLE: [[needle_gauge]]', _onfVals: {}, _onfTouched: {} };
  const status = { textContent: '' };
  const res = await d.routeDictation(0, { value: 'NEEDLE: [[needle_gauge]]' }, row, 'twenty two gauge', status);
  assert.strictEqual(res, null, 'AI failure must resolve null (nothing applied)');
  assert(/kept below|Couldn’t reach/i.test(status.textContent), 'failure status not honest: ' + status.textContent);

  /* 6. successful route applies via the field-element path */
  ctx.window.aiCallRaw = async (sys, user) => JSON.stringify({ fills: [{ field: 'needle gauge', value: '22-gauge, 3.5-inch', correction: false }] });
  let setEl = { tagName: 'INPUT', value: '', dispatched: 0, dispatchEvent() { this.dispatched++; }, setAttribute() {}, getAttribute() { return null; } };
  ctx.document.getElementById = (id) => (id === d.fidFor(0, 'needle gauge') ? setEl : null);
  const res2 = await d.routeDictation(0, { value: 'NEEDLE: [[needle_gauge]]' }, row, 'twenty two gauge three and a half', status);
  assert(res2 && res2.apply.length === 1, 'successful route did not plan the fill');
  assert.strictEqual(setEl.value, '22-gauge, 3.5-inch', 'field element not populated');
  assert(setEl.dispatched >= 1, 'change event not dispatched (applyVal path skipped)');

  console.log('PASS op-note dictate & fill: prompt contract (states + normalization + no guessing), tolerant parsing, never-overwrite planning with explicit-confirm corrections, pinned capture engine reuse, honest AI-failure recovery, field-path apply');
}

main().catch(e => { console.error('FAIL', e && e.message || e); process.exit(1); });
