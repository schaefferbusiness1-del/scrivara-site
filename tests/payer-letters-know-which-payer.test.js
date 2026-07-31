'use strict';

/* THE PAYER LETTER NEVER LEARNED WHICH PAYER (b827)
 *
 * generatePriorAuth() drafts a prior-authorisation or appeal letter addressed to a
 * health plan's utilization-management department. Its own system prompt orders the
 * blank:
 *
 *     "a 'To: [Insurance Plan / Utilization Management]' line (leave the plan name
 *      bracketed if not given)"
 *
 * and nothing ever gave it. `_readPriorAuthSources()` — the packet the model is
 * handed — read activePatient() for name, DOB and sex and never touched
 * `.insurance`. Meanwhile `p.insurance = {payer, planName, memberId, ...}` is
 * stored on the patient, persisted through the same upsert as every other field,
 * and ALREADY PRINTED on the Superbill and the Good Faith Estimate.
 *
 * A payer cannot process a prior authorisation addressed to "[Insurance Plan]" with
 * no member ID. So every letter came out needing the doctor to hand-type two facts
 * the app was already holding for that patient.
 *
 * ON DISCLOSURE, asserted rather than assumed: this packet ALREADY sends the
 * patient's name, DOB and the full clinical note to the same model endpoint for
 * this same document. The payer and member ID are therefore not a new category of
 * disclosure — they are the remaining fields that make the document function. This
 * test pins that the packet was not otherwise widened.
 *
 * AND THE ABSENT CASE IS THE INTERESTING ONE. A missing payer is reported IN WORDS
 * ("not on file"), never as a blank, because the prompt's own "do not invent patient
 * PHI (full name, DOB, member ID)" rule needs something to hold onto — and a member
 * ID is the single field where a helpful guess is indistinguishable from a real one
 * and would be sent to an insurer.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const APP = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

/* ---- the payerLine expression, lifted from source and executed --------- */
const EXPR = (() => {
  const at = APP.indexOf('payerLine:(function(){');
  assert(at > 0, 'the payerLine field is not in the prior-auth packet');
  /* brace-match the IIFE so a nested object literal cannot truncate it */
  let depth = 0, quote = '', esc = false, line = false, comment = false, start = APP.indexOf('{', at);
  for (let i = start; i < APP.length; i++) {
    const ch = APP[i], next = APP[i + 1];
    if (line) { if (ch === '\n') line = false; continue; }
    if (comment) { if (ch === '*' && next === '/') { comment = false; i++; } continue; }
    if (quote) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === quote) quote = ''; continue; }
    if (ch === '/' && next === '/') { line = true; i++; continue; }
    if (ch === '/' && next === '*') { comment = true; i++; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return APP.slice(at + 'payerLine:'.length, i + 1) + ')()';
  }
  throw new Error('unterminated payerLine IIFE');
})();

function payerLine(insurance) {
  const ctx = { String, console };
  ctx.apNow = insurance === undefined ? null : { name: 'Doe, Jane', insurance: insurance };
  vm.createContext(ctx);
  return vm.runInContext('(' + EXPR.replace(/\)\(\)$/, ')') + ')()', ctx);
}

const FULL = { payer: 'Aetna', planName: 'Choice POS II', memberId: 'W1234567801' };

/* ---- 1. THE PAYER, PLAN AND MEMBER ID REACH THE PACKET ---------------- */
{
  const l = payerLine(FULL);
  for (const [what, v] of [['payer', 'Aetna'], ['plan name', 'Choice POS II'], ['member ID', 'W1234567801']]) {
    assert(l.includes(v),
      'the ' + what + ' does not reach the letter, so the payer-facing document still has to be hand-edited ' +
      'before it can be submitted. Line: ' + l);
  }
  assert(/Member ID: W1234567801/.test(l), 'the member ID is not labelled, so the model cannot place it. Line: ' + l);
}

/* ---- 2. AN ABSENT FACT IS STATED, NEVER BLANK ------------------------- */
/* The member ID is the one field where a plausible guess is indistinguishable from
   a real one AND gets sent to an insurer. A blank invites the model to supply it. */
{
  const CASES = [
    ['nothing on file', {}],
    ['no insurance object at all', undefined],
    ['null insurance', null],
    ['payer only', { payer: 'Aetna' }],
    ['member ID only', { memberId: 'W1234567801' }],
    ['empty strings', { payer: '', planName: '', memberId: '' }],
    ['whitespace only', { payer: '  ', planName: ' ', memberId: '   ' }]
  ];
  for (const [why, ins] of CASES) {
    let l;
    try { l = payerLine(ins); }
    catch (e) { assert.fail(why + ': building the payer line THREW (' + (e && e.message) + '). This runs while ' +
      'the doctor is generating a letter; an exception is a dead button.'); }
    assert(typeof l === 'string' && l.length > 0, why + ': the payer line vanished entirely');
    assert(!/undefined|null|NaN|\[object/.test(l), why + ': a raw undefined/null leaked into the prompt: ' + l);

    const havePayer = ins && String(ins.payer || '').trim();
    const haveMember = ins && String(ins.memberId || '').trim();
    if (!havePayer && !haveMember) {
      assert(/not on file/.test(l), why + ': a missing plan is not stated in words, so the prompt gets a ' +
        'blank a model will fill. Line: ' + l);
      assert(/leave the plan name and member ID bracketed/.test(l),
        why + ': the line does not tell the model to leave a bracketed blank for the physician. Line: ' + l);
    }
    if (havePayer && !haveMember) {
      assert(/Member ID: not on file/.test(l),
        why + ': a missing member ID is silently omitted rather than declared. That is the one field where an ' +
        'invented value would be sent to an insurer indistinguishable from a real one. Line: ' + l);
    }
    if (!havePayer && haveMember) {
      assert(/not on file/.test(l), why + ': a missing payer is not declared. Line: ' + l);
      assert(l.includes('W1234567801'), why + ': a member ID on file was dropped. Line: ' + l);
    }
  }
}

/* ---- 3. IT REACHES BOTH LETTER TYPES --------------------------------- */
/* A prior authorisation and an appeal are two different prompts. Adding a fact to
   the packet and wiring it into one branch is the "computed and never used" shape
   this whole effort keeps finding. */
{
  const code = stripComments(APP);
  assert(/const payerLine=priorAuthSources\.payerLine\|\|'';/.test(code),
    'the packet carries payerLine but the prompt builder never reads it out — a fact added and never used');
  const wired = (code.match(/\+ptLine\+\(payerLine\?\('\\n'\+payerLine\):''\)\+'\\nRequesting provider: '/g) || []).length;
  assert.strictEqual(wired, 2,
    'expected the payer line in BOTH the prior-authorisation and the appeal prompts, found ' + wired +
    '. An appeal is addressed to the same payer and needs it just as much.');
}

/* ---- 4. THE PACKET WAS NOT OTHERWISE WIDENED ------------------------- */
/* The disclosure argument above rests on this: nothing new is sent except the two
   fields the document cannot function without. */
{
  const at = APP.indexOf('const _readPriorAuthSources=');
  assert(at > 0, '_readPriorAuthSources was not found');
  const end = APP.indexOf('currentNoteText();', at);
  const packet = stripComments(APP.slice(at, end));
  const keys = (packet.match(/^\s{6}([a-zA-Z]+):/gm) || []).map((k) => k.trim().replace(':', ''));
  const EXPECTED = ['service', 'isAppeal', 'ptLine', 'payerLine', 'provider', 'spec',
    'dxLine', 'note', 'noteFormat', 'pctx', 'denialReason', 'denialText', 'key'];
  for (const k of keys) {
    assert(EXPECTED.includes(k),
      'the prior-auth packet gained an unexpected field "' + k + '". This packet is sent to a third-party ' +
      'model; every field in it is a disclosure decision and must be a deliberate one.');
  }
  assert(keys.includes('payerLine'), 'payerLine is not among the packet fields: ' + keys.join(', '));

  /* the honesty rules that make this prompt trustworthy must all survive */
  for (const rule of [
    'NEVER invent symptoms, exam findings, durations, prior treatments, or test results',
    'Do not invent patient PHI (full name, DOB, member ID)'
  ]) {
    assert(APP.includes(rule), 'an honesty rule was lost while adding the payer: "' + rule + '"');
  }
}

console.log('PASS payer letters know which payer: the prior-authorisation and appeal letters were ' +
  'addressed to a health plan the packet never named, because it read activePatient() for name, DOB and ' +
  'sex and never touched .insurance — while p.insurance holds the payer, plan and member ID and the ' +
  'Superbill already prints them. Both prompts now receive them, seven absent/empty/throwing states ' +
  'declare "not on file" IN WORDS rather than leaving a blank a model would fill (the member ID being ' +
  'the one field where an invented value would reach an insurer looking real), and the packet is ' +
  'asserted not to have widened beyond those two facts because every field in it is a disclosure decision');
