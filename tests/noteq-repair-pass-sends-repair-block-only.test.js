'use strict';
/* =============================================================================
 * noteq-repair-pass-sends-repair-block-only.test.js  (gen-1.1.0, 2026-09-24)
 *
 * __mlsNoteQualityOnce takes the ONE repair pass for the freeform sites (op
 * note, template re-format, after-visit summary). Each site re-sends its own
 * system text - which already ends with the note type's contract - and appends
 * what the pass hands it. The pass used to hand it the WHOLE contract again
 * with the findings under it, so every repair request carried two copies.
 * Measured on the wire by the backend builders: the fallback op-note generator
 * sent 17,260 then 33,969 characters, the template re-format 9,712 then 18,132,
 * and the backend - which now delivers caller text within a per-family budget
 * - left out the middle of the second copy and reports it on /api/complete as
 * callerSystemTruncated.
 *
 * Proven here against the shipped bytes (feat_mls_note_quality.js and the
 * derived ScribeFlow.html, executed):
 *   1. contractFor(type, {findings, regenOnly:true}) is the repair block alone
 *      (REGENERATION PASS / FAILURES TO REPAIR / RULES FOR THIS PASS);
 *   2. the shipped one-shot pass hands every site that block and nothing else,
 *      so each repair request carries the contract exactly once - even when an
 *      older module ignores regenOnly;
 *   3. aiCallRaw reads callerSystemTruncated when the backend sends it, and a
 *      backend from before the field reads as false;
 *   4. end to end through the real aiCallRaw: a first response that reports
 *      callerSystemTruncated is followed by a repair request that still
 *      carries exactly one contract.
 * ============================================================================= */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const Q = require(path.join(ROOT, 'feat_mls_note_quality.js'));
const SHIP = fs.readFileSync(path.join(ROOT, 'ScribeFlow.html'), 'utf8');

let checks = 0;
const failures = [];
function ok(cond, msg) { checks++; if (!cond) failures.push(msg); }
function eq(a, b, msg) { checks++; if (a !== b) failures.push(msg + ` (got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)})`); }
function sliceBetween(src, a, b, label) {
  const i = src.indexOf(a);
  if (i < 0) throw new Error('could not find the start of ' + label);
  const j = src.indexOf(b, i + a.length);
  if (j < 0) throw new Error('could not find the end of ' + label);
  return src.slice(i, j);
}
function extractFn(src, sig) {
  const s = src.indexOf(sig);
  if (s < 0) throw new Error('could not find ' + sig);
  let i = src.indexOf('{', s + sig.length - 1), d = 0;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '{') d++;
    else if (c === '}') { d--; if (d === 0) return src.slice(s, i + 1); }
  }
  throw new Error('unbalanced ' + sig);
}
function count(hay, needle) { return String(hay).split(needle).length - 1; }

const HEADER = '=== MLS PROFESSIONAL NOTE CONTRACT';
const TPL = 'PROCEDURE PERFORMED:\nINDICATION:\nCOMPLICATIONS: None.\nThe patient tolerated the procedure well without complications.';
const BAD_OP = 'Here is the operative note based on the transcript provided.\nPROCEDURE PERFORMED: [TBD]';
const BAD_TPL = 'PROCEDURE PERFORMED: injection';
const BAD_AVS = 'Why you came in today\nYou came in for back pain.\n\nWhat we found\nYour back is tender.';

/* ---------------------------------------------------------------------------
 * 1. THE MODULE: regenOnly IS THE REPAIR BLOCK ALONE
 * ------------------------------------------------------------------------- */
const findings = Q.grade(BAD_OP, 'op note', {});
ok(!findings.pass, 'the fixture op note unexpectedly passed');
Q.noteTypes.forEach((t) => {
  const block = Q.contractFor(t, { findings, template: TPL, regenOnly: true });
  ok(/^REGENERATION PASS 1 of 1\./.test(block), `${t}: regenOnly does not start at the repair block`);
  ok(/\n\nFAILURES TO REPAIR:\n/.test(block) && /\n\nRULES FOR THIS PASS:\n/.test(block), `${t}: regenOnly lost a part of the repair block`);
  eq(count(block, HEADER), 0, `${t}: regenOnly still carries the contract`);
  ok(!/PRECEDENCE/.test(block) && !/TEMPLATE STRUCTURE WINS/.test(block) && !/^NEVER EMIT:/m.test(block),
    `${t}: regenOnly still carries a contract clause`);
  const full = Q.contractFor(t, { findings, template: TPL });
  ok(full.endsWith(block), `${t}: the repair block alone differs from the tail of the full repair contract`);
  eq(Q.contractFor(t, { regenOnly: true }), '', `${t}: regenOnly with nothing to repair is not empty`);
});

/* ---------------------------------------------------------------------------
 * 2. THE SHIPPED ONE-SHOT PASS, EXECUTED AT EVERY FREEFORM SITE
 * ------------------------------------------------------------------------- */
const NOTEQ_SRC = sliceBetween(SHIP, 'var NOTEQ_MAX_REGEN = 1;', 'async function aiCallRaw(sys,user,key,opts){', 'the note-quality wrappers');
function noteqHost(module) {
  const host = {
    console: { warn() {}, log() {}, error() {} }, setTimeout, clearTimeout, Promise, Date,
    document: { readyState: 'complete', addEventListener() {}, getElementById: () => null, querySelector: () => null }
  };
  host.window = host;
  host.__mlsNoteQuality = module;
  vm.runInContext(NOTEQ_SRC, vm.createContext(host), { filename: 'ScribeFlow.html#noteq' });
  return host;
}
/* The sites, as the shipped code composes them: sys + contract + retry. */
const SITES = [
  ['op note', /aiCallRaw\(sys\+noteqOp\+retry,/, 'operative-procedure-note', BAD_OP, { template: TPL, procedureClass: '' }],
  ['template re-format', /aiCallRaw\(sys\+noteqTpl\+retry,/, 'template-fidelity', BAD_TPL, { template: TPL, templateName: 'T' }],
  ['after-visit summary', /aiCallRaw\(sys\+noteqAvs\+retry,/, 'after-visit-summary', BAD_AVS, { avs: true, template: '' }]
];
/* An older module that ignores regenOnly - the shell must still send one copy. */
const OLD_MODULE = Object.assign({}, Q, { contractFor: (t, o) => Q.contractFor(t, Object.assign({}, o, { regenOnly: false })) });

async function sites() {
  for (const [name, pin, type, bad, ctx] of SITES) {
    ok(pin.test(SHIP), `the ${name} site no longer appends the pass's text to its own system text`);
    for (const [label, module] of [['current module', Q], ['module without regenOnly', OLD_MODULE]]) {
      const host = noteqHost(module);
      const SYS = 'SITE SYSTEM TEXT.';
      const contract = host.__mlsNoteQualityContract(type, ctx);
      eq(count(contract, HEADER), 1, `${name}: the first-pass contract is not built exactly once`);
      const sent = [];
      const res = await host.__mlsNoteQualityOnce(bad, type, ctx, async (retry) => {
        sent.push({ retry, sys: SYS + contract + retry });
        return bad;
      });
      eq(sent.length, 1, `${name} (${label}): the repair pass did not run exactly once`);
      const r = sent[0] || { retry: '', sys: '' };
      ok(/^\n\nREGENERATION PASS 1 of 1\./.test(r.retry), `${name} (${label}): the pass hands the site something other than the repair block`);
      eq(count(r.retry, HEADER), 0, `${name} (${label}): the pass hands the site a second contract`);
      eq(count(r.sys, HEADER), 1, `${name} (${label}): the repair request carries the contract ${count(r.sys, HEADER)} times`);
      ok(r.sys.endsWith(r.retry), `${name} (${label}): the repair block is not the closing text of the repair request`);
      ok(res && res.regenerated === true, `${name} (${label}): the pass did not report its regeneration`);
      console.log(`measured: ${name} (${label}) repair request ${r.sys.length} chars, contract ${contract.length}, repair block ${r.retry.length}`);
    }
  }
}

/* ---------------------------------------------------------------------------
 * 3. aiCallRaw READS callerSystemTruncated - AND A BACKEND WITHOUT IT
 * ------------------------------------------------------------------------- */
const AICALL_SRC = extractFn(SHIP, 'async function aiCallRaw(sys,user,key,opts){');
const PRE_AICALL = sliceBetween(SHIP, 'function _mlsTemplateRoutingSource(', 'async function aiCallRaw(sys,user,key,opts){', 'the aiCallRaw helpers');
function transportHost(responses) {
  const bodies = [];
  const host = {
    console: { warn() {}, log() {}, error() {} }, setTimeout, clearTimeout, Promise, Date, JSON, Math, String, Number, Object, Array, RegExp, Error,
    backendMode: () => true, bkBase: () => 'https://backend.example', bkToken: () => 't', handle401() {},
    fetch(url, init) {
      bodies.push({ url, body: JSON.parse(init.body) });
      const payload = responses[Math.min(bodies.length - 1, responses.length - 1)];
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(payload) });
    }
  };
  host.window = host;
  vm.runInContext(PRE_AICALL + '\n' + AICALL_SRC, vm.createContext(host), { filename: 'ScribeFlow.html#aiCallRaw' });
  return { host, bodies };
}

async function transport() {
  {
    const { host } = transportHost([{ content: 'Draft A', callerSystemTruncated: true }]);
    const receipt = {};
    const out = await host.aiCallRaw('SYS', 'USER', 'k', { freeform: true, family: 'avs', receipt });
    eq(out, 'Draft A', 'the transport stopped answering with the content string');
    eq(receipt.callerSystemTruncated, true, 'callerSystemTruncated from the backend did not reach the caller');
    ok(host.__mlsLastCompleteReceipt && host.__mlsLastCompleteReceipt.callerSystemTruncated === true &&
      host.__mlsLastCompleteReceipt.family === 'avs', 'the PHI-free transport receipt does not record the truncation');
  }
  {
    /* the CURRENT backend: no field at all */
    const { host } = transportHost([{ content: 'Draft B', model: 'm' }]);
    const receipt = {};
    const out = await host.aiCallRaw('SYS', 'USER', 'k', { freeform: true, family: 'opnote', receipt });
    eq(out, 'Draft B', 'a backend without callerSystemTruncated no longer works');
    eq(receipt.callerSystemTruncated, false, 'a backend without the field did not read as not truncated');
  }
  {
    /* no receipt: nothing to fill, nothing thrown */
    const { host } = transportHost([{ content: 'Draft C', callerSystemTruncated: true }]);
    eq(await host.aiCallRaw('SYS', 'USER', 'k', { freeform: true, family: 'soap' }), 'Draft C', 'a request made without a receipt changed');
  }
}

/* ---------------------------------------------------------------------------
 * 4. END TO END: generateAVS -> real aiCallRaw -> /api/complete (stubbed)
 * ------------------------------------------------------------------------- */
const AVS_SRC = sliceBetween(SHIP, 'async function generateAVS()', '/* =========================================================\n   REFERRAL LETTER', 'generateAVS');
const GOOD_AVS = 'Why you came in today\nYou came in for lower back pain.\n\nWhat we found\nYour lower back is tender on the right side.\n\nWhat to do at home\nUse ice for 20 minutes at a time and keep walking each day.';
async function endToEnd() {
  const { host, bodies } = transportHost([
    { content: BAD_AVS, callerSystemTruncated: true },
    { content: GOOD_AVS, callerSystemTruncated: false }
  ]);
  const els = {};
  const el = (id) => (els[id] = els[id] || { style: { display: id === 'noteBox' ? 'none' : '' }, value: '', textContent: '', innerHTML: '' });
  Object.assign(host, {
    currentSoap: 'SUBJECTIVE: low back pain.', currentInsurance: '', currentFormat: 'soap', currentAVS: '',
    currentVisitAthenaBinding: { id: 'v' }, currentVisitAthenaEpoch: 1,
    document: { readyState: 'complete', addEventListener() {}, getElementById: el, querySelector: () => null },
    toast() {}, hasAI: () => true, getKey: () => 'k', offlineAVS: () => '', buildPatientContext: () => '', docPrefsBlock: () => '',
    currentNoteText: () => host.currentSoap, _athenaGuardBoundEditor: () => true, _athenaAsyncBindingStillSafe: () => true,
    friendlyError: (e) => String(e), showExtra(card, body, text) { el(body).textContent = text; },
    __mlsNoteQuality: Q
  });
  vm.runInContext(NOTEQ_SRC + '\n' + AVS_SRC, vm.createContext(host), { filename: 'ScribeFlow.html#generateAVS' });
  await host.generateAVS();
  eq(bodies.length, 2, 'the summary did not make exactly one first request and one repair request');
  const first = bodies[0] ? bodies[0].body.system : '';
  const second = bodies[1] ? bodies[1].body.system : '';
  eq(count(first, HEADER), 1, 'the first summary request does not carry the contract exactly once');
  eq(count(second, HEADER), 1, `after the backend reported callerSystemTruncated, the repair request carried the contract ${count(second, HEADER)} times`);
  ok(second.startsWith(first) && /\n\nREGENERATION PASS 1 of 1\./.test(second.slice(first.length)),
    'the repair request is not the first request plus the repair block');
  ok(host.__mlsLastAvsQualityPass && host.__mlsLastAvsQualityPass.callerSystemTruncated === true &&
    host.__mlsLastAvsQualityPass.retryCallerSystemTruncated === false, 'the summary receipt does not record what the backend reported');
  eq(host.currentAVS, GOOD_AVS, 'the repaired summary was not the one shown');
  console.log(`measured: summary first request ${first.length} chars, repair request ${second.length} chars (contract once in each)`);
}

(async () => {
  await sites();
  await transport();
  await endToEnd();
})().then(() => {
  if (failures.length) {
    console.error(`FAIL noteq-repair-pass-sends-repair-block-only: ${failures.length} of ${checks} checks failed`);
    failures.forEach((f) => console.error('  - ' + f));
    process.exit(1);
  }
  console.log(`PASS noteq-repair-pass-sends-repair-block-only: ${checks} checks`);
}, (err) => {
  console.error('FAIL noteq-repair-pass-sends-repair-block-only: threw - ' + (err && err.stack ? err.stack : err));
  process.exit(1);
});
