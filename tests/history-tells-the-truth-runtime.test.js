'use strict';
/* History tells the truth (histfix-1.0.0, b1313). Measured on the signed-in
   1p shell with a seeded chart (signed, unsigned, draft and op notes, four
   Athena chart-import receipts, pulled encounters across six months):
   - chart-import receipts were counted as visits, listed under Unsigned, and
     offered "Review Athena actions" (a route that writes INTO an Athena note);
   - the After-visit summary read a receipt, or said a patient with a signed
     note had none (it only read `text`; saved SOAP notes keep `soap`);
   - Visits & encounters printed bare month headings over hidden cards;
   - "Continue this draft" did nothing, silently, for an op note or receipt;
   - a single visit's Copy confirmed a screen or more below the button;
   - a transcript draft's detail title read "... · —";
   - on a phone a row with "Review Athena actions" squeezed its title to 0px.
   Real Chrome; nothing leaves 127.0.0.1. */
const http = require('http'), fs = require('fs'), path = require('path');
const assert = require('assert');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const T = fs.readFileSync(path.join(__dirname, '1p-clunky-contract.test.js'), 'utf8');
const HARNESS = '(' + T.slice(T.indexOf('function harness() {'), T.indexOf('async function boot(page, port)')).trim() + ')()';
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'content-type': ({ '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json' })[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(f).pipe(r);
}).listen(0, '127.0.0.1', async () => {
  const b = await chromium.launch({ args: ['--no-sandbox'] });
  const errs = [];
  const base = 'http://127.0.0.1:' + srv.address().port;
  const boot = async (ctxOpts) => {
    const ctx = await b.newContext(Object.assign({ permissions: ['clipboard-read', 'clipboard-write'] }, ctxOpts));
    const pg = await ctx.newPage();
    pg.on('pageerror', (e) => errs.push(String(e.message).slice(0, 160)));
    await pg.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.fulfill({ status: 503, body: 'x' }));
    await pg.goto(base + '/1pScribeFlow.html', { waitUntil: 'load', timeout: 90000 });
    await pg.waitForTimeout(2500);
    await pg.evaluate(() => (typeof window.__mlsEnsureUiBundle === 'function' ? window.__mlsEnsureUiBundle() : null));
    await pg.waitForFunction(() => !!window.__mlsSimpleLayer, null, { timeout: 60000 });
    await pg.waitForTimeout(4000);
    await pg.evaluate(() => {
      const a = document.getElementById('authScreen'); if (a) a.style.display = 'none';
      const s = document.getElementById('appScreen'); if (s) s.style.display = '';
      window.__mlsHarnessAccountEmail = 'ui-harness@mlsscribe.test';
      try { window.__mlsDeferAsset = function (fn) { return setTimeout(fn, 0); }; } catch (e) {}
    });
    await pg.evaluate(HARNESS);
    await pg.evaluate(() => window.__clunky.seed());
    await pg.evaluate(() => {
      const D = (s) => new Date(s).getTime();
      const pts = getPatients(), ada = pts.find((p) => p.id === 'syn-0');
      ada.visits = ['2026-09-01', '2026-09-08', '2026-08-03', '2026-08-17', '2026-08-24', '2026-07-10', '2026-06-12', '2026-05-02', '2026-04-01'].map((d, i) =>
        ({ id: 'v' + i, date: d, type: 'Office Visit', source: 'athena', encounterId: 'E10' + i, raw: d + ', M Sample, MD\nASSESSMENT: Low back pain.\nPLAN: Continue HEP.' }));
      savePatients(pts);
      saveNotes([
        { id: 'hn1', patientId: 'syn-0', patient: 'Ada Sample', cc: 'Low back pain follow-up', soap: 'Subjective: Better.\nAssessment: Radiculopathy improving.\nPlan: HEP.', signed: true, isDraft: false, created: D('2026-09-01T15:00:00Z'), updated: D('2026-09-01T15:20:00Z'), noteProvenance: 'generated_soap' },
        { id: 'hn2', patientId: 'syn-0', patient: 'Ada Sample', cc: 'Unsigned consult note', soap: 'Subjective: Neck pain.\nPlan: X-ray.', signed: false, isDraft: false, created: D('2026-09-15T14:00:00Z'), updated: D('2026-09-15T14:05:00Z'), noteProvenance: 'typed' },
        { id: 'hn3', patientId: 'syn-0', patient: 'Ada Sample', cc: '—', transcript: 'Doctor: how are you. Patient: my back hurts.', isDraft: true, signed: false, created: D('2026-09-20T13:00:00Z'), updated: D('2026-09-20T13:01:00Z') },
        { id: 'hn4', patientId: 'syn-0', patient: 'Ada Sample', cc: 'Ada Sample — 2026-08-17 — Right L4-L5 TFESI (op-note draft)', text: 'OPERATIVE NOTE\nPROCEDURE: Right L4-L5 TFESI.', kind: 'opnote', signed: false, isDraft: true, created: D('2026-08-17T16:00:00Z'), updated: D('2026-08-17T16:10:00Z') },
        { id: 'hn6', patientId: 'syn-0', patient: 'Ada Sample', cc: 'Athena chart import', text: 'Chart import receipt 1', created: D('2026-09-02T10:00:00Z'), updated: D('2026-09-02T10:00:00Z') },
        { id: 'hn7', patientId: 'syn-0', patient: 'Ada Sample', cc: 'Athena chart import', text: 'Chart import receipt 2', created: D('2026-09-05T10:00:00Z'), updated: D('2026-09-05T10:00:00Z') },
        { id: 'hn11', patientId: 'syn-1', patient: 'Bo Sample', cc: 'Neck pain visit', soap: 'Subjective: Neck pain.\nPlan: PT.', signed: true, isDraft: false, created: D('2026-09-12T12:00:00Z'), updated: D('2026-09-12T12:00:00Z'), noteProvenance: 'typed' }
      ]);
      setActivePtId('syn-0');
      showView('history');
    });
    await pg.waitForTimeout(1500);
    return pg;
  };
  try {
    const pg = await boot({ viewport: { width: 1400, height: 900 } });
    const view = (fv) => pg.evaluate((fv) => {
      const f = document.getElementById('histFilter'); if (f) f.value = fv; renderHistory();
      const rows = [...document.querySelectorAll('#histList .hist-item')];
      return { count: (document.getElementById('histCount') || {}).textContent || '', rows: rows.map((r) => r.textContent.replace(/\s+/g, ' ').trim()),
        push: rows.filter((r) => /Chart import|chart-import/i.test(r.textContent) && /Review Athena actions/.test(r.textContent)).length };
    }, fv);

    /* 1. receipts are not visits */
    const all = await view('');
    assert.strictEqual(all.count, '4 visits', 'the count leaves the two receipts out: ' + JSON.stringify(all));
    assert.ok(all.rows.some((t) => /2 Athena chart-import receipts/.test(t)), 'two receipts collapse into the summary row: ' + JSON.stringify(all.rows));
    const uns = await view('unsigned');
    assert.ok(!uns.rows.some((t) => /Athena chart import/.test(t)), 'the Unsigned chip lists no receipt: ' + JSON.stringify(uns.rows));
    assert.match(uns.count, /^1 of 4 match$/, 'Unsigned counts against real visits only: ' + uns.count);
    const imp = await view('imports');
    assert.strictEqual(imp.rows.length, 2, 'the Chart imports chip still shows both receipts');
    assert.strictEqual(imp.push, 0, 'no receipt row offers Review Athena actions');
    assert.ok(imp.rows.every((t) => /Chart import/.test(t) && !/Unsigned/.test(t)), 'a receipt is labelled a chart import, not Unsigned: ' + JSON.stringify(imp.rows));
    const refused = await pg.evaluate(async () => { pushHistoryNoteToAthena('hn6'); await new Promise((r) => setTimeout(r, 400)); const d = document.getElementById('mlsAthenaUnifiedConfirm'); return !(d && d.offsetParent !== null); });
    assert.ok(refused, 'a receipt never opens the Send-to-Athena dialog');
    await view('');

    /* the AVS and the visit-detail modules load lazily; load them the way the
       app would once their surface is used */
    await pg.evaluate(async () => {
      const load = (src) => new Promise((r) => { const s = document.createElement('script'); s.src = src; s.onload = r; s.onerror = r; document.head.appendChild(s); });
      if (!window.__mlsAfterVisitSummary) await load('/feat_after_visit_summary.js');
      if (!window.__mlsVisitNoteDetail) await load('/feat_visit_note_detail.js');
    });

    /* 2. the After-visit summary reads the latest REAL note, by id */
    const avs = await pg.evaluate(() => {
      const A = window.__mlsAfterVisitSummary; if (!A) return null;
      const pick = (id) => { const n = A._latestNoteFor(findPatient(id)); return n ? n.id : null; };
      return { ada: pick('syn-0'), bo: pick('syn-1') };
    });
    assert.ok(avs, 'the After-visit summary module is installed');
    assert.deepStrictEqual(avs, { ada: 'hn2', bo: 'hn11' }, 'AVS uses the newest real saved note for each patient (not a receipt, a draft or nothing)');

    /* 3. no month heading over hidden cards */
    const months = await pg.evaluate(() => {
      const sec = document.getElementById('mlsHxSection'); if (!sec) return null;
      const groups = [...sec.querySelectorAll('.hx-group')];
      return { groups: groups.length, hidden: groups.filter((g) => g.hidden).length,
        bare: groups.filter((g) => g.offsetParent !== null).filter((g) => ![...g.children].some((c) => !c.classList.contains('hx-gh') && c.offsetParent !== null)).map((g) => g.textContent.trim().slice(0, 20)) };
    });
    assert.ok(months && months.groups >= 6 && months.hidden > 0, 'the seeded chart has month groups past the collapsed cut: ' + JSON.stringify(months));
    assert.deepStrictEqual(months.bare, [], 'no visible month heading has every card hidden');

    /* 4. Continue is offered only where it works */
    const cont = await pg.evaluate(() => {
      /* the raw viewer ("Edit raw note") is the original opener under the
         visit-detail wrapper */
      const raw = (window.openNoteFromHistory && window.openNoteFromHistory.__mlsOrig) || window.openNoteFromHistory;
      const shown = (id) => { raw(id); const b = document.getElementById('viewContinueBtn'); const v = !!(b && getComputedStyle(b).display !== 'none'); closeView(); return v; };
      return { op: shown('hn4'), receipt: shown('hn6'), soap: shown('hn1') };
    });
    assert.deepStrictEqual(cont, { op: false, receipt: false, soap: true }, 'Continue this draft appears only for a record that can be continued');

    /* 5. a single visit's Copy confirms on the button */
    const copied = await pg.evaluate(async () => {
      const btn = document.querySelector('#mlsHxSection [data-hx-copy]'); if (!btn) return null;
      btn.click(); await new Promise((r) => setTimeout(r, 400)); return btn.textContent;
    });
    assert.ok(copied !== null, 'an encounter card has a Copy button');
    assert.match(copied, /Copied/, 'the Copy button itself says it copied: ' + copied);

    /* 6. a transcript draft's detail title has no bare dash */
    const title = await pg.evaluate(() => {
      const D = window.__mlsVisitNoteDetail; if (!D || typeof D.visitFromNote !== 'function') return null;
      const m = D.visitFromNote(findPatient('syn-0'), getNotes().find((n) => n.id === 'hn3'));
      return m && m.visit ? String(m.visit.type || '') : null;
    });
    assert.ok(title !== null, 'the visit-detail module maps a saved note');
    assert.strictEqual(title, 'Transcript draft', 'a draft saved with cc "—" is titled Transcript draft');

    /* 7. phone: a row with Review Athena actions keeps its title readable */
    const ph = await boot({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' });
    const rows = await ph.evaluate(() => {
      renderHistory();
      return [...document.querySelectorAll('#histList .hist-item')].filter((r) => /Review Athena actions/.test(r.textContent))
        .map((r) => { const t = r.querySelector('.hist-main .t'); return t ? Math.round(t.getBoundingClientRect().width) : -1; });
    });
    assert.ok(rows.length > 0, 'the phone list has rows with Review Athena actions');
    assert.ok(rows.every((w) => w >= 120), 'every such row keeps a readable title width on a phone: ' + JSON.stringify(rows));

    assert.deepStrictEqual(errs, [], 'no page errors: ' + errs.join(' | '));
    console.log('PASS history tells the truth: receipts are not visits and are never written back, the AVS reads the latest real note, no empty month headings, Continue only where it works, Copy confirms on its button, drafts are titled, and phone rows stay readable');
  } finally { await b.close(); srv.close(); }
});
