'use strict';

/* The real ax fallback and the real terminal hop must agree about coverage.
 * 3.0.117 returned complete:false for 4 ax encounters against 6 known index
 * rows, then the shared finalizer promoted that answer to complete:true by
 * comparing the smaller ax count with itself. These fixtures execute both
 * shipped blocks. Every browser operation is mocked with synthetic data.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'latin1');
const begin = source.indexOf('var axRouteRun = async function (rrFromPartial) {');
const end = source.indexOf('\n      if (!gate.ok && /^no-chart-frame-candidate/', begin);
assert(begin >= 0 && end > begin, 'ax fallback source seam missing');
const terminalStart = source.indexOf('      var proven = res.ok === true &&');
const terminalEnd = source.indexOf('      res.receipt.readerVersion =', terminalStart);
assert(terminalStart >= 0 && terminalEnd > terminalStart, 'visit receipt finalizer source seam missing');
const route = source.slice(begin, end);
const finalizer = source.slice(terminalStart, terminalEnd);

function finish(result) {
  vm.runInNewContext(finalizer, { res: result, Number });
  return result;
}

async function run(options) {
  let now = 10000, current = '';
  const identity = { name: 'Synthetic Patient', dob: '01/02/1960', mrn: '700777' };
  const encountered = [], read = [];
  const context = {
    Date: { now: () => now }, Number, String, Math, Array, Object, Promise,
    emrId: 77, cfg: { maxVisits: options.cap || 40 }, total: options.known,
    readDeadline: options.deadline || 200000, readStartedAt: 10000, readBudgetMs: 165000,
    frozenHint: { ...identity, onlyDate: '' }, identity, diag: {},
    gate: { ok: false, reason: 'no-chart-frame-candidate' }, rrWait: 0, rrRecovered: false,
    sleep: async ms => { now += ms; }, touchVisitLease() {},
    visitIdentityGate: () => ({ ok: current !== options.wrongIdentity }),
    bestResult(results, score) {
      let best = null;
      for (const item of results) if (!best || score(item.result) > score(best.result)) best = item;
      return best || { result: null };
    },
    exec: async (_tab, _frames, args) => {
      const op = args[0];
      let result;
      if (op === 'axHarvest') result = { ok: true, surfaceSig: {}, encounters: options.ids.map(eid => ({ eid, hrefPath: '/1/2/ax/encounter/' + eid + '/summary' })) };
      else if (op === 'axGo') {
        current = args[2].match(/encounter\/(\d+)/)[1]; encountered.push(current);
        result = { ok: current !== options.failedNavigation };
      } else if (op === 'identity') result = identity;
      else if (op === 'axRead') {
        read.push(current);
        result = { ok: true, headerDate: '08/01/2026', raw: 'Synthetic encounter ' + current + ': history, examination and plan.' };
      } else throw new Error('Unexpected operation: ' + op);
      return [{ frameId: 5, result }];
    }
  };
  const result = await vm.runInNewContext('(async function(){' + route + '\nreturn await axRouteRun(false);})()', context);
  assert(result && result.receipt, 'fallback failed to return its partial or complete receipt');
  const before = JSON.parse(JSON.stringify(result.receipt));
  finish(result);
  return { result, before, encountered, read };
}

(async () => {
  const ids = ['101', '102', '103', '104'];
  const healthy = await run({ known: 4, ids });
  assert.strictEqual(healthy.result.receipt.complete, true, 'complete fallback no longer succeeds');
  assert.deepStrictEqual(healthy.read, ids, 'every harvested encounter must actually be read');
  assert.deepStrictEqual(Array.from(healthy.result.visits, v => v.binding.encounterId), ids, 'returned visit IDs diverge from the actual reads');

  const shorter = await run({ known: 6, ids });
  assert.strictEqual(shorter.before.complete, false, 'fallback ignored the larger known encounter index');
  assert.strictEqual(shorter.result.ok, false, 'an incomplete fallback bypassed the existing reader retry path');
  assert.strictEqual(shorter.result.reason, 'visit-bodies-incomplete', 'partial fallback lost its retryable cause');
  assert.strictEqual(shorter.result.receipt.complete, false, 'terminal hop promoted a 4-of-6 history to complete');
  assert.strictEqual(shorter.result.receipt.fullDetail, false, 'partial history was called full detail');
  assert.strictEqual(shorter.result.receipt.bodyComplete, false, 'missing known bodies were called complete');
  assert.strictEqual(shorter.result.receipt.expected, 6, 'expected count shrank to the fallback subset');
  assert.strictEqual(shorter.result.receipt.parsed, 4);
  assert.strictEqual(shorter.result.receipt.indexRowsKnown, 6, 'known index count was lost');
  assert.strictEqual(shorter.result.receipt.notAttempted, 2, 'known encounters absent from the harvest were not accounted for');

  for (const variation of [{ cap: 2 }, { failedNavigation: '102' }, { wrongIdentity: '103' }, { deadline: 19000 }]) {
    const partial = await run({ known: 4, ids, ...variation });
    assert.strictEqual(partial.result.receipt.complete, false, JSON.stringify(variation) + ' became complete');
    assert.strictEqual(partial.result.receipt.fullDetail, false);
    assert.strictEqual(partial.result.ok, false, 'partial fallback bypassed retry');
    assert.strictEqual(partial.result.reason, 'visit-bodies-incomplete');
    assert.strictEqual(partial.result.receipt.expected, 4, 'a cap, failure or deadline shrank expected coverage');
    assert.strictEqual(partial.result.receipt.attempted, partial.encountered.length, 'planned reads were reported as attempted');
    assert.strictEqual(partial.result.receipt.expected, partial.result.receipt.parsed + partial.result.receipt.failures + partial.result.receipt.notAttempted, 'encounter outcome arithmetic did not close');
    assert(partial.result.receipt.parsed < 4, 'fixture did not reach a real partial-read path');
  }

  const explicitlyPartial = finish({ ok: true, receipt: { complete: false, indexComplete: true, bodyComplete: true, expected: 4, parsed: 4 } });
  assert.strictEqual(explicitlyPartial.receipt.complete, false, 'the finalizer overrode an independent completeness refusal');
  for (const zeroProof of ['authoritativeEmpty', 'administrativeRows', 'notYetAvailable', 'absenceProven']) {
    const zero = finish({ ok: true, receipt: { complete: true, indexComplete: true, bodyComplete: true, expected: 0, parsed: 0, [zeroProof]: zeroProof === 'administrativeRows' ? 2 : true } });
    assert.strictEqual(zero.receipt.complete, true, 'legitimate zero-body completion regressed: ' + zeroProof);
  }
  const unknownZero = finish({ ok: true, receipt: { complete: true, indexComplete: true, bodyComplete: true, expected: 0, parsed: 0 } });
  assert.strictEqual(unknownZero.receipt.complete, false, 'unproven empty history became complete');
  console.log('PASS ax history census through terminal receipt: complete, shorter index, cap, navigation failure, identity refusal, deadline, explicit refusal and proven empty cases');
})().catch(error => { console.error(error); process.exitCode = 1; });
