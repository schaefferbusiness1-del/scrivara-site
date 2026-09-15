'use strict';
/* MLS Assist 3.0.140 — legacysettle-1.0.0: the classic day-grid lane waits until the rendered row count holds
 * across two looks before it reads, and its receipt carries the settle facts and a headings-only section
 * census. Executes the real settle block against a fake document whose list grows between looks. */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.join(__dirname, '..');
const bg = fs.readFileSync(path.join(root, 'background.js'), 'latin1');
let checks = 0;
const ok = (v, m) => { assert.ok(v, m); checks++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, m); checks++; };

const s = bg.indexOf("      /* legacysettle-1.0.0 (3.0.140): the classic day grid appends");
const eMark = "        out.diag.legacySections = _lsSections;\n      } catch (_eLs) {}";
const eMarkCrlf = eMark.replace(/\n/g, '\r\n');
let e = bg.indexOf(eMark, s); let endLen = eMark.length;
if (e < 0) { e = bg.indexOf(eMarkCrlf, s); endLen = eMarkCrlf.length; }
ok(s > 0 && e > s, 'settle block present before the legacy lane');
const block = bg.slice(s, e + endLen);
ok(bg.indexOf("var _legacyGridListsL=[].slice.call(doc.querySelectorAll('[class~=\"appointments-container\"]'));") > e, 'the settle runs before the legacy lane reads the lists');

function fakeDoc(counts, sections) {
  let look = 0;
  const rows = () => Array.from({ length: counts[Math.min(look, counts.length - 1)] }, () => ({ className: 'full filled-appointment-row' }));
  const list = { children: [] };
  (sections || []).forEach((sec) => { list.children.push({ className: 'appointment-header1', innerText: sec.h }); for (let i = 0; i < sec.n; i++) list.children.push({ className: 'full filled-appointment-row clickable' }); });
  return {
    doc: { querySelectorAll: (sel) => (/filled-appointment-row/.test(sel) ? rows() : []), querySelector: (sel) => (/appointments-container/.test(sel) ? list : null) },
    tick: () => { look++; }
  };
}
async function run(counts, sections, opts) {
  opts = opts || {};
  const fd = fakeDoc(counts, sections);
  const out = { diag: {} };
  let sleeps = 0;
  const sleep = async (ms) => { sleeps++; fd.tick(); if (opts.sleepFalseAt && sleeps >= opts.sleepFalseAt) return false; return true; };
  const fn = new Function('doc', 'out', '__scheduleActionAllowed', '__scheduleActionSleep', 'return (async () => {\n' + block + '\nreturn { diag: out.diag };\n})();');
  const res = await fn(fd.doc, out, () => opts.allowed !== false, sleep);
  return { diag: res.diag, sleeps };
}
(async () => {
  /* a list that grows 24 -> 44 -> 44: the read waits for the second stable look */
  let r = await run([24, 44, 44], [{ h: 'Provider A, PA-C', n: 12 }, { h: 'Clinic 1', n: 0 }, { h: 'Provider B, MD', n: 32 }]);
  eq(r.diag.legacyRowsFirst, 24, 'first look counted the partial list');
  eq(r.diag.legacyRowsFinal, 44, 'final count is the settled list');
  eq(r.diag.legacySettled, true, 'settled when two looks agree');
  eq(r.diag.legacySettleLooks, 2, 'two sleeps: one that saw growth, one that saw stability');
  eq(r.diag.legacySections.length, 3, 'three headings counted');
  eq(r.diag.legacySections[0].n, 12, 'rows under the first heading');
  eq(r.diag.legacySections[2].n, 32, 'rows under the last heading');
  ok(!JSON.stringify(r.diag.legacySections).match(/\d{2}\/\d{2}\/\d{4}/), 'the census carries headings and counts only');
  /* a list that is already complete costs one look */
  r = await run([44, 44], []);
  eq(r.diag.legacySettleLooks, 1, 'a stable list costs a single look');
  eq(r.diag.legacySettled, true, 'and is settled');
  /* a list that keeps growing is bounded to four looks and reported unsettled */
  r = await run([10, 20, 30, 40, 50, 60], []);
  eq(r.diag.legacySettleLooks, 4, 'at most four looks');
  eq(r.diag.legacySettled, false, 'still-growing is reported as not settled, never hidden');
  /* the action guard stops it at once */
  r = await run([10, 20, 30], [], { allowed: false });
  eq(r.diag.legacySettleLooks, 0, 'no look when the action guard refuses');
  /* a sleep refused by the deadline stops it */
  r = await run([10, 20, 30, 30], [], { sleepFalseAt: 1 });
  eq(r.diag.legacySettleLooks, 0, 'a refused sleep ends the wait without counting a look');
  /* receipt allowlist */
  ok(bg.includes("settleLooks: Number(__dd.legacySettleLooks || 0), rowsFirst: Number(__dd.legacyRowsFirst || 0), rowsFinal: Number(__dd.legacyRowsFinal || 0), settled: __dd.legacySettled !== false, sections: (Array.isArray(__dd.legacySections) ? __dd.legacySections : []).slice(0, 12).map(function (s) { return { h: String(s && s.h || '').slice(0, 30), n: Number(s && s.n || 0) }; })"), 'the reader receipt carries the settle facts and a bounded census');
  ok(block.includes('await __scheduleActionSleep(700)'), 'the wait uses the in-scope hidden-safe sleep');
  console.log('PASS legacysettle-30140-runtime: ' + checks + ' checks');
})().catch((err) => { console.error(err && err.stack || err); process.exit(1); });
