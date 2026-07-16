'use strict';

/* Monthly Pay Report v2.0.0 contract:
 *  - aggregation: cancelled/no-show excluded, AM/PM split in practice TZ,
 *    untimed visits count once (AM), half-day credits correct
 *  - PA/NP rate default matches credential tokens only, not name substrings
 *  - public API surface (open/close) intact for the mls-connect launch buttons
 *  - honesty strings: estimate labeling and the no-writes note stay present
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'feat_comp_report.js'), 'utf8');

function stubEl() {
  return {
    style: {}, dataset: {}, children: [],
    setAttribute() {}, getAttribute() { return null; },
    appendChild() {}, remove() {}, addEventListener() {},
    querySelectorAll() { return []; }, querySelector() { return null; }
  };
}
const windowStub = {};
const documentStub = {
  getElementById() { return null; },
  createElement() { return stubEl(); },
  head: stubEl(), body: stubEl(),
  addEventListener() {}, removeEventListener() {}
};
const ctx = {
  window: windowStub, document: documentStub,
  localStorage: { getItem() { return null; }, setItem() {} },
  fetch() { return Promise.reject(new Error('no network in tests')); },
  setInterval() { return 0; }, clearInterval() {}, setTimeout(fn) { return 0; }, clearTimeout() {},
  console
};
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(src, ctx);

const comp = windowStub.__mlsComp;
assert.ok(comp && typeof comp.open === 'function' && typeof comp.close === 'function',
  'mls-connect launch buttons depend on window.__mlsComp.open/close');
assert.strictEqual(comp.version, '2.1.0');
const t = comp._test;

/* basis -> billing codes translation (v2.1.0 transparency) */
const feesStub = {
  bundles: { ESI_LUMBAR: ['62323'], FOLLOWUP: ['99213', '99214'] },
  byCode: {
    '62323': { code: '62323', description: 'Lumbar/sacral interlaminar ESI', expected: 273.6 },
    '99213': { code: '99213', description: 'Office visit, est, low', expected: 103.7 },
    '99214': { code: '99214', description: 'Office visit, est, moderate', expected: 145.9 }
  }
};
const kw = t.basisInfo('keyword:ESI_LUMBAR', feesStub);
assert.match(kw.label, /Keyword match/);
assert.strictEqual(kw.codes[0].code, '62323');
assert.match(t.codesText(kw), /62323 Lumbar\/sacral interlaminar ESI/);
const real = t.basisInfo('visit_record_codes', feesStub);
assert.match(real.label, /Real billing codes/);
assert.match(t.codesText(real), /actual chart codes/);
const dflt = t.basisInfo('default:FOLLOWUP', feesStub);
assert.strictEqual(dflt.codes.length, 2, 'follow-up default lists both E/M codes');
assert.strictEqual(t.basisInfo('ai_map:ESI_LUMBAR', null).codes.length, 0, 'missing fee schedule degrades gracefully');

/* rate heuristic: credentials only, never name substrings */
assert.strictEqual(t.midlevel('Jane Smith, PA-C'), true);
assert.strictEqual(t.midlevel('John Roe NP'), true);
assert.strictEqual(t.midlevel('Sarah Jones, CRNP'), true);
assert.strictEqual(t.midlevel('Dr. Napoli'), false, '"Napoli" must not read as an NP');
assert.strictEqual(t.midlevel('Dr. Pace'), false);

/* month helpers */
assert.deepStrictEqual(t.monthRange('2026-06').from, '2026-06-01');
assert.deepStrictEqual(t.monthRange('2026-06').to, '2026-06-30');
assert.strictEqual(t.stepMonth('2026-01', -1), '2025-12');
assert.strictEqual(t.stepMonth('2026-12', 1), '2027-01');

/* aggregation: statuses, TZ split, untimed, half-day credits */
const resp = {
  doctors: [{ id: 7, name: 'Dr. Backup Name' }],
  appointments: [
    { provider_name: 'Dr. A', appt_date: '2026-06-01', start_at: '2026-06-01T13:00:00Z' },   // 09:00 NY -> AM
    { provider_name: 'Dr. A', appt_date: '2026-06-01', start_at: '2026-06-01T18:30:00Z' },   // 14:30 NY -> PM
    { provider_name: 'Dr. A', appt_date: '2026-06-01' },                                      // untimed -> AM once
    { provider_name: 'Dr. A', appt_date: '2026-06-02', start_at: '2026-06-02T14:00:00Z' },   // 10:00 NY -> AM only day
    { provider_name: 'Dr. A', appt_date: '2026-06-03', start_at: '2026-06-03T13:00:00Z', status: 'cancelled' },
    { provider_name: 'Dr. A', appt_date: '2026-06-03', start_at: '2026-06-03T13:00:00Z', status: 'no_show' },
    { doctor_user_id: 7, appt_date: '2026-06-05', start_at: '2026-06-05T19:00:00Z' }          // falls back to doctors[] name
  ]
};
const provs = t.aggregate(resp);
const J = (v) => JSON.parse(JSON.stringify(v)); // vm objects are cross-realm; normalize prototypes
assert.deepStrictEqual(J(Object.keys(provs).sort()), ['Dr. A', 'Dr. Backup Name']);
const a = t.providerRows(provs['Dr. A']);
assert.deepStrictEqual(J(a.rows), [['2026-06-01', 2, 1, 3], ['2026-06-02', 1, 0, 1]],
  'cancelled/no-show excluded; untimed counts once in AM');
assert.deepStrictEqual(J(a.totals), [3, 1, 4]);
assert.deepStrictEqual(J(a.halves), [['2026-06-01', 0.5, 0.5, 1], ['2026-06-02', 0.5, 0, 0.5]]);
assert.strictEqual(a.days, 1.5);

/* honesty strings must survive any future UI change */
assert.match(src, /Collections are an <b>estimate<\/b>/);
assert.match(src, /Nothing here writes to athena\./);
assert.match(src, /never invents a dollar figure/);
assert.match(src, /Unmatched providers/, 'server estimate dollars for unmatched names must be disclosed, not dropped');
assert.match(src, /INCOMPLETE/, 'Excel must flag incomplete collection totals');
assert.match(src, /byProv\[p\] = pr \? pr\.total : null/, 'an unpriced provider must stay pending, never a silent \\$0 estimate');
assert.match(src, /Estimate detail/, 'Excel must carry the per-code estimate detail sheet');
assert.match(src, /Fee schedule/, 'Excel must carry the full fee-schedule sheet');

console.log('comp-report-contract: ok');
