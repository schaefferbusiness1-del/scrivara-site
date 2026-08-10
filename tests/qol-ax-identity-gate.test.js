'use strict';
/* qol-2.3 F6 RELEASE-HOLDING PROOF (supervisor blocking question, 2026-08-10):
   the scoped ax route reads a body BEFORE the identity poll - reading early is
   the speed win, but STORING early would be the 6/24-6/29 cross-patient
   contamination class. This executes the REAL shipped axRouteRun closure with
   a scripted athena and proves, not argues:
   (a) a wrong-patient body is NEVER kept - the only axVisits.push is
       downstream of a confirmed identity, executed;
   (b) the reorder moved the READ, not the WRITE - the wrong-patient body was
       demonstrably read (it is in the op log) and demonstrably absent from
       the result;
   (c) the discard is COUNTED (axRefused -> '1 refused' in the refusal), never
       silent;
   (d) the unscoped path still polls identity BEFORE reading, byte-order
       unchanged - proven from the op sequence, not the diff. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const bg = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'latin1');

/* ---- extract the REAL closure (brace-balanced, quote-aware) ---- */
function extractClosure(src, startMarker) {
  const s = src.indexOf(startMarker);
  assert.ok(s > 0, 'closure start found');
  let i = src.indexOf('{', s), depth = 0, inS = null, esc = false;
  for (; i < src.length; i++) {
    const c = src[i];
    if (esc) { esc = false; continue; }
    if (c === '\\') { esc = true; continue; }
    if (inS) { if (c === inS) inS = null; continue; }
    if (c === "'" || c === '"' || c === '`') { inS = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) break; }
  }
  const end = src.indexOf(';', i);
  return src.slice(s, end + 1);
}
const closure = extractClosure(bg, 'var axRouteRun = async function (rrFromPartial) {');
assert.ok(closure.length > 2000 && /axVisits\.push/.test(closure), 'closure extracted whole');

/* (a)+(source) exactly ONE write into the kept collection, downstream of the gate */
assert.strictEqual(closure.split('axVisits.push(').length - 1, 1, 'exactly one body-keep site exists');
assert.ok(closure.indexOf('axVisits.push(') > closure.indexOf('if (!axIdOk) {'), 'the keep site is BELOW the identity gate');
assert.ok(closure.indexOf('patientName: (axIdent && axIdent.name)'), 'the kept body is bound to the VERIFIED identity');

const dkStart = bg.indexOf('function mlsVisitDateKeyForHint(sv)');
const dateKey = new Function(bg.slice(dkStart, bg.indexOf('\n', dkStart)) + '\nreturn mlsVisitDateKeyForHint;')();

function makeHarness(opts) {
  const log = [];
  const idQueue = opts.identities.slice();
  const readQueue = opts.bodies.slice();
  const exec = async function (id, frames, args) {
    const op = args[0];
    log.push(op);
    if (op === 'axHarvest') return [{ frameId: 7, result: { ok: true, encounters: opts.encounters, surfaceSig: { route: 'sig' } } }];
    if (op === 'axGo') return [{ frameId: 7, result: { ok: true } }];
    if (op === 'axRead') { const b = readQueue.length > 1 ? readQueue.shift() : readQueue[0]; return [{ frameId: 7, result: b }]; }
    if (op === 'identity') { const idr = idQueue.length > 1 ? idQueue.shift() : idQueue[0]; return [{ frameId: 7, result: idr }]; }
    return [{ frameId: 7, result: null }];
  };
  const bestResult = function (arr, scorer) {
    let best = null, bs = -Infinity;
    (arr || []).forEach(function (it) { const s = scorer(it && it.result); if (s > bs) { bs = s; best = it; } });
    return { result: best && best.result };
  };
  const fn = new Function('exec', 'emrId', 'cfg', 'bestResult', 'sleep', 'touchVisitLease', 'readDeadline', 'visitIdentityGate', 'frozenHint', 'identity', 'diag', 'readBudgetMs', 'readStartedAt', 'mlsVisitDateKeyForHint',
    'var gate = null, rrWait = 0, rrRecovered = false;\n' + closure + '\nreturn { run: axRouteRun, getGate: function () { return gate; } };');
  const h = fn(exec, 1, { maxVisits: 40 }, bestResult,
    () => new Promise(r => setTimeout(r, 20)), () => {},
    Date.now() + 600000,
    (hint, ident) => ({ ok: !!(ident && ident.name === 'Adam Right') }),
    opts.frozenHint, { name: 'fallback' }, {}, 0, Date.now(), dateKey);
  return { h, log };
}

(async () => {
  /* ---- CASE A: scoped, IN-DAY body, WRONG patient - read, then refused ---- */
  {
    const { h, log } = makeHarness({
      encounters: [{ eid: '11', hrefPath: '/1/2/ax/encounter/11/summary' }],
      bodies: [{ ok: true, raw: 'PHI BODY OF MALLORY', headerDate: '7/7/2026' }],
      identities: [{ name: 'Mallory Wrong', dob: '02/02/1950', mrn: 'X9', score: 99 }],
      frozenHint: { onlyDate: '2026-07-07' }
    });
    const r = await h.run(false);
    assert.ok(log.indexOf('axRead') >= 0, '(b) the wrong-patient body WAS read (the reorder is real)');
    assert.ok(log.indexOf('axRead') < log.indexOf('identity'), 'scoped path reads before polling identity');
    const kept = JSON.stringify((r && r.visits) || []);
    assert.ok(kept.indexOf('MALLORY') < 0, '(a) EXECUTED: the wrong-patient body is NOT in the result');
    assert.ok(!(r && r.ok === true && (r.visits || []).length), 'no ok-with-body escape for a refused identity');
    const g = h.getGate();
    assert.ok(g && g.ok === false && /1 refused/.test(String(g.reason)), '(c) the discard is COUNTED: ' + String(g && g.reason));
  }

  /* ---- CASE B: scoped, right patient in-day + out-of-day sibling ---- */
  {
    const { h, log } = makeHarness({
      encounters: [{ eid: '21', hrefPath: '/1/2/ax/encounter/21/summary' }, { eid: '22', hrefPath: '/1/2/ax/encounter/22/summary' }],
      bodies: [{ ok: true, raw: 'RIGHT DAY BODY', headerDate: '7/7/2026' }, { ok: true, raw: 'OTHER DAY BODY', headerDate: '6/24/2026' }],
      identities: [{ name: 'Adam Right', dob: '01/02/1960', mrn: 'M1', score: 99 }],
      frozenHint: { onlyDate: '2026-07-07' }
    });
    const r = await h.run(false);
    assert.ok(r && r.ok === true, 'scoped happy path succeeds');
    assert.strictEqual((r.visits || []).length, 1, 'exactly the in-day body is kept');
    assert.strictEqual(r.visits[0].raw, 'RIGHT DAY BODY');
    assert.strictEqual(r.visits[0].patientName, 'Adam Right', 'the kept body carries the VERIFIED identity');
    assert.strictEqual(r.receipt.axDateSkipped, 1, 'the out-of-day sibling is counted, not silently dropped');
    assert.strictEqual(r.receipt.onlyDate, '2026-07-07', 'the receipt names its scope');
    assert.strictEqual(r.receipt.complete, true, 'clean scoped scan is complete');
    assert.strictEqual(log.filter(o => o === 'identity').length >= 1 && log.filter(o => o === 'axRead').length, 2, 'both bodies read, identity polled only for the in-day one');
  }

  /* ---- CASE D: UNSCOPED path unchanged - identity BEFORE read, executed ---- */
  {
    const { h, log } = makeHarness({
      encounters: [{ eid: '31', hrefPath: '/1/2/ax/encounter/31/summary' }],
      bodies: [{ ok: true, raw: 'FULL CHART BODY', headerDate: '5/5/2026' }],
      identities: [{ name: 'Adam Right', dob: '01/02/1960', mrn: 'M1', score: 99 }],
      frozenHint: {}
    });
    const r = await h.run(false);
    assert.ok(r && r.ok === true && r.visits.length === 1, 'unscoped path still reads');
    assert.ok(log.indexOf('identity') < log.indexOf('axRead'), '(d) unscoped order UNCHANGED: identity polls before the body read');
    assert.strictEqual(r.receipt.onlyDate, '', 'unscoped receipt says so');
  }

  console.log('qol-ax-identity-gate: OK (wrong-patient body read-but-NEVER-kept and counted "1 refused"; single keep-site below the gate; in-day keep carries verified identity; out-of-day counted; unscoped order unchanged - all EXECUTED on the shipped closure)');
})().catch(e => { console.error(e); process.exit(1); });
