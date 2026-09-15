'use strict';
/* MLS Assist 3.0.148 — legsdiag-1.0.0: every refused chart-open answer names both legs' outcomes (legFind,
 * legSched, legOrder) as closed codes; content.js copies exactly those three keys through a closed sanitizer.
 * Executes the real response wrapper with fake leg results. */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.join(__dirname, '..');
const bg = fs.readFileSync(path.join(root, 'background.js'), 'latin1');
const ct = fs.readFileSync(path.join(root, 'content.js'), 'utf8');
let checks = 0;
const ok = (v, m) => { assert.ok(v, m); checks++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, m); checks++; };

const s = bg.indexOf('        sendResponse = function (payload) {');
ok(s > 0, 'wrapper located');
const e = bg.indexOf('        };', s);
const wrapper = bg.slice(s, e + '        };'.length);
ok(wrapper.includes("legFind: __fr ? (__fr.opened ? 'opened' : String(__fr.reason || 'refused')) : 'not-run'"), 'the wrapper names the Find leg');
ok(wrapper.includes("legSched: __sr ? (__sr.opened ? 'opened' : String(__sr.reason || 'refused')) : 'not-run'"), 'the wrapper names the schedule leg');
ok(wrapper.includes("rawSendResponse(__p);"), 'and still answers once through rawSendResponse');
eq(bg.split('legsdiag-1.0.0').length - 1, 1, 'attached in one place');

function run(payload, legs) {
  const sent = [];
  const fn = new Function('rawSendResponse', 'openGuard', 'findRes', 'sched', 'order', 'var responseSent = false; var sendResponse;\n' + wrapper + '\nreturn sendResponse;');
  const send = fn((p) => sent.push(p), { token: 't1', deadline: 123 }, legs.findRes, legs.sched, legs.order);
  send(payload);
  return sent[0];
}
let r = run({ ok: false, reason: 'schedule-date-restore-failed', diag: { stage: 'x' } }, { findRes: { opened: false, reason: 'no-results' }, sched: { opened: false, reason: 'appointment-id-not-found' }, order: ['find', 'sched'] });
eq(r.diag.legFind, 'no-results', 'the Find leg\'s own reason travels'); eq(r.diag.legSched, 'appointment-id-not-found', 'the schedule leg\'s own reason travels');
eq(r.diag.legOrder, 'find-sched', 'the order travels'); eq(r.diag.stage, 'x', 'existing diag kept'); eq(r.requestId, 't1', 'request id kept');
r = run({ ok: false, reason: 'x' }, { findRes: null, sched: null, order: ['sched'] });
eq(r.diag.legFind, 'not-run', 'a leg that never ran says so'); eq(r.diag.legSched, 'not-run', 'both'); eq(r.diag.legOrder, 'sched', 'order still known');
r = run({ ok: true, opened: true, chartName: 'X' }, { findRes: { opened: true }, sched: null, order: ['find'] });
ok(!r.diag, 'a success answer is untouched');
r = run({ ok: false, reason: 'y' }, { findRes: { opened: true }, sched: { opened: false }, order: ['find', 'sched'] });
eq(r.diag.legFind, 'opened', 'an opened leg says opened'); eq(r.diag.legSched, 'refused', 'a refusal without a reason says refused');

/* content.js: the closed sanitizer, exactly those keys */
ok(ct.includes("['legFind', 'legSched', 'legOrder', 'findByDobReason' /* findbydob-1.0.0 (3.0.153) */, 'findByDobShape' /* findbydob-1.1.0 (3.0.154) */].forEach(function (key) { var v = String(openedDiag[key] == null ? '' : openedDiag[key]).toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40); if (v) safeDiag[key] = v; });"), 'content.js copies the leg codes (and the 3.0.153 DOB-search code) through a closed sanitizer');
const sani = (v) => String(v == null ? '' : v).toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40);
eq(sani('No-Results'), 'no-results', 'lowercased'); eq(sani('Jane Doe 01/02/1950 #123'), 'janedoe01021950123', 'letters and digits only survive, no separators');
eq(sani('a'.repeat(60)).length, 40, 'bounded');
console.log('PASS legsdiag-30148-runtime: ' + checks + ' checks');
