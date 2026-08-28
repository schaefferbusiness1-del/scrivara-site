'use strict';

/* dedupsrv-1.0.0 (2026-08-28) — a patient merge that undid itself.
 *
 * __mlsDedupById.runOnce({confirm:'EXECUTE'}) is the only real patient merge in
 * the app. It was broken in two ways that both ended the same: the duplicate
 * came back.
 *
 *   1. It wrote the survivor list with `window.savePatients(out)` - WITHOUT
 *      {allowRemovals:true}. The patient row-guard treats a save that drops rows
 *      as an accidental truncation unless explicitly told otherwise, so it
 *      carried every merged-away duplicate straight back.
 *   2. It never deleted the absorbed row on the SERVER, so the next hydration
 *      re-created every row the merge had just collapsed - the same resurrection
 *      defect fixed for single-row deletes in b1107.
 *
 * The server-delete stage is EXECUTED here against stubs, so this measures
 * behaviour: one delete per absorbed id, verdicts journalled, and failures
 * LOGGED rather than swallowed. A silent half-merge is what makes duplicates
 * reappear with no explanation.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let checks = 0;
function ok(v, m) { checks++; assert.ok(v, m); }
function eq(a, b, m) { checks++; assert.strictEqual(a, b, m); }

const root = path.resolve(__dirname, '..');
const LANES = ['1p-feat_mls_b121_pack.js', 'feat_mls_b121_pack.js', 'cloned-feat_mls_b121_pack.js'];

let lanesChecked = 0;

(async function main() {
for (const lane of LANES) {
  const file = path.join(root, lane);
  if (!fs.existsSync(file)) continue;
  lanesChecked++;
  const src = fs.readFileSync(file, 'latin1');

  /* ---- 1. the merge save must honour removals ---- */
  const saveIdx = src.indexOf('window.savePatients(out');
  ok(saveIdx >= 0, lane + ': the merge no longer saves a survivor list - has runOnce been rewritten?');
  /* parse the actual call rather than pinning a fixed spelling */
  const callEnd = src.indexOf(';', saveIdx);
  const call = src.slice(saveIdx, callEnd);
  ok(/allowRemovals\s*:\s*true/.test(call),
    lane + ': the merge saves the survivor list WITHOUT {allowRemovals:true} - the row-guard will ' +
    'carry every merged-away duplicate back and the merge silently undoes itself');

  /* ---- 2. the absorbed rows must be deleted on the server, EXECUTED ---- */
  const start = src.indexOf('entry.serverDeletes = [];');
  ok(start >= 0, lane + ': the merge performs no server delete - absorbed duplicates rehydrate');
  const endMark = "} catch (eSrvDel) {";
  const end = src.indexOf(endMark, start);
  ok(end > start, lane + ': the server-delete stage is not bounded as expected');
  const block = src.slice(start, src.indexOf('\n', end));

  function runStage(dropIds, deleteImpl) {
    const logs = [];
    const entry = {};
    const win = { deletePatientOnServer: deleteImpl };
    const fn = new Function('entry', 'dropIds', 'window', 'log', block + '\n return window.__mlsDedupLastServerDeletes || null;');
    const p = fn(entry, dropIds, win, m => logs.push(String(m)));
    return { entry, logs, promise: p };
  }

  /* every absorbed id gets exactly one delete */
  {
    const seen = [];
    const r = runStage({ a: 1, b: 1 }, id => { seen.push(id); return Promise.resolve({ ok: true, reason: 'deleted' }); });
    eq(seen.length, 2, lane + ': the merge did not issue one server delete per absorbed row');
    ok(seen.indexOf('a') >= 0 && seen.indexOf('b') >= 0, lane + ': the wrong ids were deleted');
  }

  /* a FAILED server delete must be journalled AND logged, never swallowed */
  {
    const r = runStage({ a: 1 }, () => Promise.resolve({ ok: false, reason: 'http-500' }));
    await r.promise;
    eq(r.entry.serverDeletes.length, 1, lane + ': a failed server delete was not journalled');
    eq(r.entry.serverDeletes[0].ok, false, lane + ': a failed server delete was journalled as success');
    ok(r.logs.some(m => /SERVER delete failed/.test(m) && /return on the next hydration/.test(m)),
      lane + ': a failed server delete was SWALLOWED - the duplicate returns with no explanation');
  }

  /* a THROWING helper must not take the merge down, and must still be reported */
  {
    const r = runStage({ a: 1 }, () => Promise.reject(new Error('boom')));
    await r.promise;
    eq(r.entry.serverDeletes[0].ok, false, lane + ': a throwing server delete was journalled as success');
    ok(r.logs.some(m => /threw/.test(m)), lane + ': a throwing server delete was not reported');
  }

  /* the helper being absent must be reported, not silently skipped */
  {
    const r = runStage({ a: 1 }, undefined);
    ok(r.logs.some(m => /UNAVAILABLE/.test(m)),
      lane + ': a missing deletePatientOnServer silently skipped the server delete - the classic ' +
      'feature-detect guard hiding a no-op');
    eq(r.entry.serverDeletes[0].reason, 'helper-missing', lane + ': the missing helper was not journalled');
  }
}

ok(lanesChecked > 0, 'no lane files were found at all - this suite tested nothing');
console.log('PASS patient-merge-is-durable: ' + checks + ' checks across ' + lanesChecked + ' lane(s) - ' +
  'the merge honours removals locally and deletes every absorbed row on the server, journalling each ' +
  'verdict and logging failures instead of swallowing them');
})().catch(e => { console.error(e && e.message || e); process.exit(1); });
