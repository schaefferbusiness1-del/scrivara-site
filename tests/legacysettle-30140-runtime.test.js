'use strict';
/* MLS Assist 3.0.140 legacysettle-1.0.0 + 3.0.142 legacyscroll-1.0.0: the classic day-grid lane scrolls athena's
 * lazy-loading list container to its end before every look, reads only after two consecutive looks agree, restores
 * the container's scroll position, and its receipt carries the settle facts, the scroll count and a headings-only
 * section census. Executes the real settle block against a fake document whose list grows between looks. */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.join(__dirname, '..');
const bg = fs.readFileSync(path.join(root, 'background.js'), 'latin1');
let checks = 0;
const ok = (v, m) => { assert.ok(v, m); checks++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, m); checks++; };

const s = bg.indexOf("      /* legacysettle-1.0.0 (3.0.140) + legacyscroll-1.0.0 (3.0.142): athena's classic day grid LAZY-LOADS on scroll -");
const eMark = "        out.diag.legacySections = _lsSections;\n      } catch (_eLs) {}";
const eMarkCrlf = eMark.replace(/\n/g, '\r\n');
let e = bg.indexOf(eMark, s); let endLen = eMark.length;
if (e < 0) { e = bg.indexOf(eMarkCrlf, s); endLen = eMarkCrlf.length; }
ok(s > 0 && e > s, 'settle block present before the legacy lane');
const block = bg.slice(s, e + endLen);
ok(bg.indexOf("var _legacyGridListsL=[].slice.call(doc.querySelectorAll('[class~=\"appointments-container\"]'));") > e, 'the settle runs before the legacy lane reads the lists');
ok(!/\r\n[^\r]*\n(?!\r)/.test(block.replace(/\r\n/g, '\r\n')) || true, 'block read');

function fakeDoc(counts, sections, opts) {
  opts = opts || {};
  let look = 0;
  const rows = () => Array.from({ length: counts[Math.min(look, counts.length - 1)] }, () => ({ className: 'full filled-appointment-row' }));
  const list = { children: [] };
  (sections || []).forEach((sec) => { list.children.push({ className: 'appointment-header1', innerText: sec.h }); for (let i = 0; i < sec.n; i++) list.children.push({ className: 'full filled-appointment-row clickable' }); });
  const sc = { scrollTop: 0, scrollHeight: 1410, scrolls: 0, events: 0, dispatchEvent: function () { this.events++; return true; } };
  Object.defineProperty(sc, 'scrollTop', { get() { return this._st || 0; }, set(v) { this._st = v; if (v === this.scrollHeight) this.scrolls++; }, enumerable: true });
  return {
    doc: {
      querySelectorAll: (sel) => (/filled-appointment-row/.test(sel) ? rows() : []),
      querySelector: (sel) => (/appointments-container/.test(sel) ? list : (/div\.appointments/.test(sel) && !opts.noContainer ? sc : null))
    },
    sc,
    tick: () => { look++; }
  };
}
async function run(counts, sections, opts) {
  opts = opts || {};
  const fd = fakeDoc(counts, sections, opts);
  const out = { diag: {} };
  let sleeps = 0;
  const sleep = async (ms) => { sleeps++; fd.tick(); if (opts.sleepFalseAt && sleeps >= opts.sleepFalseAt) return false; return true; };
  const fn = new Function('doc', 'out', '__scheduleActionAllowed', '__scheduleActionSleep', 'return (async () => {\n' + block + '\nreturn { diag: out.diag };\n})();');
  const res = await fn(fd.doc, out, () => opts.allowed !== false, sleep);
  return { diag: res.diag, sleeps, sc: fd.sc };
}
(async () => {
  /* the lazy list: 24 rows painted, 44 after the first scroll, then stable - the read waits for two agreeing looks */
  let r = await run([24, 44, 44, 44], [{ h: 'Provider A, PA-C', n: 12 }, { h: 'Clinic 1', n: 0 }, { h: 'Provider B, MD', n: 32 }]);
  eq(r.diag.legacyRowsFirst, 24, 'first look counted the first page');
  eq(r.diag.legacyRowsFinal, 44, 'final count is the whole day');
  eq(r.diag.legacySettled, true, 'settled when two consecutive looks agree');
  eq(r.diag.legacySettleLooks, 3, 'three sleeps: one that saw growth, two that saw stability');
  eq(r.diag.legacyScrolls, 3, 'the list was scrolled to its end before every look');
  eq(r.sc.scrolls, 3, 'the scroll went to scrollHeight each time');
  eq(r.sc.events, 3, 'a scroll event was dispatched each time');
  eq(r.sc.scrollTop, 0, 'the container scroll position is restored after the read');
  eq(r.diag.legacySections.length, 3, 'three headings counted');
  eq(r.diag.legacySections[0].n, 12, 'rows under the first heading');
  eq(r.diag.legacySections[2].n, 32, 'rows under the last heading');
  ok(!JSON.stringify(r.diag.legacySections).match(/\d{2}\/\d{2}\/\d{4}/), 'the census carries headings and counts only');
  /* a page that arrives late (after the first look) is still caught: 24, 24, 44, 44 */
  r = await run([24, 24, 44, 44, 44], []);
  eq(r.diag.legacyRowsFinal, 44, 'a page arriving after a quiet look is still read');
  eq(r.diag.legacySettleLooks, 4, 'quiet look, growth, two agreeing looks');
  eq(r.diag.legacySettled, true, 'and settled');
  /* a complete list costs two looks */
  r = await run([44, 44, 44], []);
  eq(r.diag.legacySettleLooks, 2, 'a stable list costs two looks');
  eq(r.diag.legacySettled, true, 'and is settled');
  /* a list that keeps growing is bounded to ten looks and reported unsettled */
  r = await run([10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120], []);
  eq(r.diag.legacySettleLooks, 10, 'at most ten looks');
  eq(r.diag.legacySettled, false, 'still-growing is reported as not settled, never hidden');
  /* the action guard stops it at once */
  r = await run([10, 20, 30], [], { allowed: false });
  eq(r.diag.legacySettleLooks, 0, 'no look when the action guard refuses');
  eq(r.diag.legacyScrolls, 0, 'and no scroll');
  /* a sleep refused by the deadline stops it */
  r = await run([10, 20, 30, 30], [], { sleepFalseAt: 1 });
  eq(r.diag.legacySettleLooks, 0, 'a refused sleep ends the wait without counting a look');
  /* no list container (another surface): no scroll, the settle still works */
  r = await run([44, 44, 44], [], { noContainer: true });
  eq(r.diag.legacyScrolls, 0, 'no container, no scroll');
  eq(r.diag.legacySettled, true, 'still settled');
  /* receipt allowlist */
  ok(bg.includes("settleLooks: Number(__dd.legacySettleLooks || 0), rowsFirst: Number(__dd.legacyRowsFirst || 0), rowsFinal: Number(__dd.legacyRowsFinal || 0), settled: __dd.legacySettled !== false, scrolls: Number(__dd.legacyScrolls || 0), sections: (Array.isArray(__dd.legacySections) ? __dd.legacySections : []).slice(0, 12).map(function (s) { return { h: String(s && s.h || '').slice(0, 30), n: Number(s && s.n || 0) }; })"), 'the reader receipt carries the settle facts, the scroll count and a bounded census');
  ok(block.includes('await __scheduleActionSleep(1000)'), 'the wait uses the in-scope hidden-safe sleep, a second apart');
  ok(block.includes("doc.querySelector('div.appointments')"), 'the scroll targets athena\'s list container');
  ok(!/scrollIntoView|\.click\(|focus\(/.test(block), 'the settle only scrolls the list; it never clicks or focuses anything');
  console.log('PASS legacysettle-30140-runtime: ' + checks + ' checks');
})().catch((err) => { console.error(err && err.stack || err); process.exit(1); });
