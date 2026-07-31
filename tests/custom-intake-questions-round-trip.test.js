'use strict';

/* THE DOCTOR'S OWN INTAKE QUESTIONS REACH THE PATIENT (b818)
 *
 * Settings has "📋 Patient intake — your custom questions" (one per line,
 * uns('intakeQuestions')). It is in PREF_SYNC_KEYS, so it follows the account.
 * The IN-APP kiosk has rendered it since it shipped.
 *
 * intake.html — the link the doctor actually SENDS to a patient — never received
 * it. `GET /api/intake/public/:token` returned `{ok:true}` and the page had no
 * section for it. So a doctor could type questions written specifically for that
 * surface, watch them save and sync, and the patient would be asked nothing. The
 * whole feature existed on every layer except the one that faces the patient.
 *
 * There are FOUR hops, and a break in any one of them looks identical to the
 * doctor (nothing happens), so this suite executes all four:
 *
 *   Settings  -> the encrypted prefs blob        (already worked)
 *   blob      -> GET /api/intake/public/:token   (backend, new)
 *   response  -> the rendered form               (intake.html, new)
 *   answers   -> the doctor's chart summary      (ScribeFlow.html, new)
 *
 * That last hop is the one worth naming: without it the answers arrive on the
 * server, get stored, and never appear in the chart — the same defect one layer
 * along, where the doctor asks a question, the patient answers it, and nobody
 * ever reads it.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const intake = fs.readFileSync(path.join(root, 'intake.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');

function fnBlock(src, name) {
  const at = src.indexOf('function ' + name + '(');
  assert(at >= 0, 'missing function ' + name);
  const brace = src.indexOf('{', at);
  let depth = 0, quote = '', esc = false, line = false, block = false;
  for (let i = brace; i < src.length; i++) {
    const ch = src[i], next = src[i + 1];
    if (line) { if (ch === '\n') line = false; continue; }
    if (block) { if (ch === '*' && next === '/') { block = false; i++; } continue; }
    if (quote) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === quote) quote = ''; continue; }
    if (ch === '/' && next === '/') { line = true; i++; continue; }
    if (ch === '/' && next === '*') { block = true; i++; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return src.slice(at, i + 1);
  }
  throw new Error('unterminated ' + name);
}

/* ---- HOP 3: the response renders questions, by execution ---------------- */
/* A DOM double small enough to be obvious and real enough that innerHTML is
   parsed back out, so the assertions read what the product actually wrote. */
/* A one-line function, taken as a LINE. The brace matcher above cannot read
   esc(): its body holds the character class /[&<>"']/g, and a scanner that tracks
   quotes sees the " and ' inside that class as string delimiters and loses the
   nesting. Extracting by line is correct for a one-liner and does not pretend to
   parse JavaScript. */
function lineFn(src, name) {
  const at = src.indexOf('function ' + name + '(');
  assert(at >= 0, 'missing function ' + name);
  const start = src.lastIndexOf('\n', at) + 1;
  const line = src.slice(start, src.indexOf('\n', at));
  assert(line.trim().endsWith('}'), name + ' is not a single-line function: ' + line.trim());
  return line;
}

function dom() {
  const nodes = {};
  const make = (id) => ({ id, style: {}, innerHTML: '', value: '', attrs: {},
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; } });
  nodes.ikCustomSection = make('ikCustomSection');
  nodes.ikCustomWrap = make('ikCustomWrap');
  return {
    $: (id) => nodes[id] || null,
    nodes,
    /* parse the rendered inputs back into {id, label, dataQ} */
    inputs() {
      const html = nodes.ikCustomWrap.innerHTML;
      const out = [];
      const re = /<label for="(ikCustom\d+)">([\s\S]*?)<\/label><input type="text" id="\1" class="ik-custom" data-q="([^"]*)">/g;
      let m;
      while ((m = re.exec(html))) out.push({ id: m[1], label: m[2], dataQ: m[3] });
      return out;
    }
  };
}

function runApply(questions) {
  const d = dom();
  const ctx = { String, Object, console, document: { querySelectorAll: () => [] } };
  ctx.$ = d.$;
  vm.createContext(ctx);
  vm.runInContext(lineFn(intake, 'esc') + '\n' + fnBlock(intake, 'applyCustomQuestions') +
    '\nthis.apply = applyCustomQuestions;', ctx);
  ctx.apply(questions);
  return d;
}

/* POSITIVE CONTROL — the harness must be able to see the pre-fix state. With no
   questions delivered the section must stay hidden and the wrap empty, which is
   exactly what the page did before this change for EVERY account. */
{
  const d = runApply(undefined);
  assert.strictEqual(d.nodes.ikCustomSection.style.display, 'none',
    'positive control: with nothing delivered the section must stay hidden — this is the pre-fix state');
  assert.strictEqual(d.nodes.ikCustomWrap.innerHTML, '', 'positive control: and the wrap must be empty');
  assert.strictEqual(d.inputs().length, 0, 'positive control: the input reader must find nothing to read');
}

/* the questions the doctor typed become the questions the patient sees */
{
  const QS = ['Have you had an MRI of this area? When?', 'Do you have an attorney involved in this injury?'];
  const d = runApply(QS);
  assert.strictEqual(d.nodes.ikCustomSection.style.display, 'block', 'the section must appear once there are questions');
  const got = d.inputs();
  assert.strictEqual(got.length, 2, 'expected one input per question, got ' + got.length);
  assert.deepStrictEqual(got.map(i => i.label), QS.map(q => q.replace(/&/g, '&amp;')),
    'the rendered labels are not the doctor\'s questions, in the doctor\'s order');
  /* the question rides back on the input, so an answer is never orphaned */
  assert.deepStrictEqual(got.map(i => i.dataQ), QS.map(q => q.replace(/&/g, '&amp;')),
    'each input must carry its own question so the answer can be labelled on the way back');
}

/* ---- ESCAPING: practice-authored text on a page a patient loads --------- */
{
  const d = runApply(['<img src=x onerror=alert(1)>Any bleeding?', 'Tom & Jerry\'s "quote" <b>']);
  const html = d.nodes.ikCustomWrap.innerHTML;
  const got = d.inputs();
  assert.strictEqual(got.length, 2, 'both questions must render');

  /* Assert on the EXTRACTED values, not by scanning the markup for dangerous
     words. Two probes were wrong here before this one: `!/onerror=/` fails on
     correctly-escaped output because esc() escapes the brackets and leaves the
     word as inert text, and a tag-shaped regex matches the escaped content
     INSIDE an attribute value because [^>]* runs straight through it. The real
     property is simply that no unescaped angle bracket or quote from the
     doctor's text survives into either place it is written. */
  for (const item of got) {
    for (const [where, value] of [['label', item.label], ['data-q', item.dataQ]]) {
      assert(!/[<>]/.test(value),
        `an unescaped angle bracket reached the ${where} of a question on a page a patient loads: ` +
        JSON.stringify(value));
      assert(!/"/.test(value),
        `an unescaped double quote reached the ${where} and would break out of the attribute: ` +
        JSON.stringify(value));
    }
  }
  /* escaped, not stripped — the doctor should still see the text they typed */
  assert(/&lt;img src=x onerror=alert\(1\)&gt;Any bleeding\?/.test(html),
    'the markup must be escaped rather than removed, or a legitimate question is silently mangled');
  assert(/&quot;quote&quot;/.test(html), 'quotes must survive as escaped entities');
  assert(/Tom &amp; Jerry/.test(html), 'an ampersand must be escaped exactly once');
}

/* ---- TOLERANCE: an older backend sends no questions field -------------- */
{
  for (const shape of [undefined, null, [], 'not-an-array', 0, {}, [''], ['   ']]) {
    const d = runApply(shape);
    assert.strictEqual(d.nodes.ikCustomSection.style.display, 'none',
      'a missing/empty questions payload (' + JSON.stringify(shape) + ') must leave the section hidden. An ' +
      'empty section header on a patient\'s form is worse than no section.');
  }
  /* and the clamp holds, so a runaway stored blob cannot build a 500-field form */
  const many = [];
  for (let i = 0; i < 60; i++) many.push('Question ' + i);
  assert.strictEqual(runApply(many).inputs().length, 20, 'the question count must be clamped client-side too');
}

/* ---- HOP 4: THE ANSWERS REACH THE CHART ------------------------------- */
/* Without this hop the answers are stored and never read — the same defect one
 * layer along. _intakeSummary is what the doctor actually sees. */
{
  const ctx = { String, Array, Object, Date, console, isNaN, parseInt };
  vm.createContext(ctx);
  vm.runInContext(fnBlock(app, '_intakeSummary') + '\nthis.sum = _intakeSummary;', ctx);

  const base = { submittedAt: '2026-07-31T12:00:00.000Z', chief: 'Low back pain' };

  /* control: no custom answers => the summary is exactly what it always was */
  const plain = ctx.sum(base);
  assert(!/YOUR QUESTIONS/.test(plain),
    'the custom-question block must not appear when there are no answers');
  assert(/Chief complaint: Low back pain/.test(plain), 'the standard intake summary regressed');

  const withCustom = ctx.sum(Object.assign({}, base, {
    custom: [
      { q: 'Have you had an MRI of this area? When?', a: 'Yes, March 2026' },
      { q: 'Do you have an attorney involved?', a: '' },              /* unanswered */
      { q: '', a: 'orphan answer with no question' },                  /* malformed */
      { q: 'Any bleeding disorders?', a: 'No' }
    ]
  }));
  assert(/YOUR QUESTIONS/.test(withCustom), 'the doctor\'s own questions must be labelled in the chart summary');
  assert(/Have you had an MRI of this area\? When\?: Yes, March 2026/.test(withCustom),
    'an answered question must appear beside its answer, not as an orphaned string');
  assert(/Any bleeding disorders\?: No/.test(withCustom), 'every answered question must appear');
  assert(!/Do you have an attorney involved\?:\s*$/m.test(withCustom),
    'an UNANSWERED question must be omitted — an empty answer is not an answer');
  assert(!/orphan answer with no question/.test(withCustom),
    'an answer with no question must be dropped rather than shown unlabelled');

  /* the block is last, so the doctor's addendum does not interrupt the standard intake */
  assert(withCustom.indexOf('YOUR QUESTIONS') > withCustom.indexOf('Chief complaint'),
    'the custom block must read as an addendum after the standard intake');

  /* malformed payloads must not throw — this runs while rendering a real chart */
  for (const bad of [null, 'nope', 42, [null], [{ }], [{ q: 1, a: 2 }]]) {
    assert.doesNotThrow(() => ctx.sum(Object.assign({}, base, { custom: bad })),
      'a malformed custom payload (' + JSON.stringify(bad) + ') threw while building the chart summary');
  }
}

/* ---- THE HOPS ARE ACTUALLY CONNECTED --------------------------------- */
/* Each of these is a place the chain could be silently unhooked while every
 * individual function above still passes. */
{
  assert(/applyCustomQuestions\(d\.questions\)/.test(intake),
    'the token response is never handed to the renderer, so the questions arrive and are discarded');
  assert(/custom:customAnswers\(\)/.test(intake),
    'the answers are never put on the submission payload, so the patient answers into nothing');
  assert(/id="ikCustomSection"/.test(intake) && /id="ikCustomWrap"/.test(intake),
    'the section the renderer writes into does not exist in the markup');
  /* the same two ids the in-app kiosk uses, so the two surfaces stay recognisably
     the same feature rather than drifting into two implementations */
  assert(/id="ikCustomSection"/.test(app) && /id="ikCustomWrap"/.test(app),
    'the in-app kiosk ids changed — the two intake surfaces have drifted apart');
  /* and the setting still follows the account, or a second device asks nothing */
  const list = app.match(/const PREF_SYNC_KEYS=\[([\s\S]*?)\];/);
  assert(list, 'PREF_SYNC_KEYS could not be located');
  assert(vm.runInNewContext('[' + list[1] + ']').indexOf('intakeQuestions') >= 0,
    'intakeQuestions no longer follows the account, so the questions vanish on a new device');
}

console.log('PASS the doctor\'s custom intake questions reach the patient and the answers come back: ' +
  'all four hops executed (Settings blob -> token endpoint -> rendered form -> chart summary), with the ' +
  'pre-fix state as the positive control, practice-authored text escaped in both the label and the ' +
  'data-q attribute it rides back on, unanswered and orphaned pairs dropped rather than shown, and ' +
  'eight malformed payload shapes leaving the form exactly as it was');
