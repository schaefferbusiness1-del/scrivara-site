'use strict';
/* The Visit layout shows the doctor what is really there (visitfix-1.0.0,
   2026-09-23). Found by the Visit-flow hunt on the signed-in 1p shell:
   - after a reload the "You have an unsaved visit ... Restore it" bar was
     built beside #transcript, inside #captureCard, which the guided workspace
     hides with display:none!important - the offer existed and nobody saw it;
   - desktop: the generated note sat in column 1 of the three-column visit
     grid (383px wide, 819px empty beside it) because its column-mates are
     hidden;
   - phone: the transcript card's heading, hint and counters kept the old dark
     panel's colours (1.0-1.3:1 on today's light card);
   - desktop: the top progress rail stayed on "Record" after the note was
     generated and after it was signed, while the flow strip below said
     Review & Sign / Send, because it read only VISIBLE note textareas and the
     note is shown in its formatted view with the textarea hidden.
   visitfix-1.1.0 (2026-09-23), from the review of 1.0.0 - the restore offer
   is checked after a REAL signed-in reload (sf_bk_token + sf_session, /api/me
   and /api/agreements/me answered by page routes, then page.reload()), where
   startSession() shows the visit about 0.8 s in, before 1p-mls-connect.js has
   hidden #captureCard. The 1.0.0 placement still put the bar inside that
   card there. Also pinned: the offer is re-checked on the next Visit tab
   press, and it is retired when the doctor ignores it and starts new work, so
   its Restore/Discard can never act on the new text: the current visit's
   autosave and the leave-page warning survive even a leftover Discard, the
   next reload offers the current visit, and the ignored visit is kept aside
   and offered again after the next New visit.
   Real Chrome, desktop and phone; the AI is stubbed through window.aiCallRaw
   and nothing leaves 127.0.0.1. */
const http = require('http'), fs = require('fs'), path = require('path');
const assert = require('assert');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const T = fs.readFileSync(path.join(__dirname, '1p-clunky-contract.test.js'), 'utf8');
const HARNESS = '(' + T.slice(T.indexOf('function harness() {'), T.indexOf('async function boot(page, port)')).trim() + ')()';
const DESK = { viewport: { width: 1400, height: 900 } };
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' };
const TRANSCRIPT = 'Doctor: What brings you in today? Patient: I have had low back pain for three weeks and it goes down my left leg. ' +
  'Doctor: On exam straight leg raise is positive on the left. We will start physical therapy and follow up in four weeks.';
const NOTE = 'HPI:\nPatient reports low back pain for three weeks radiating to the left leg.\nROS:\nNot documented in today\'s transcript.\n' +
  'EXAM:\nStraight leg raise positive on the left.\nASSESSMENT:\nLumbar radiculopathy with left leg radiation.\nPLAN:\nStart physical therapy. Follow up in four weeks.';

const TB = 'Doctor: Follow-up for right knee pain. Patient: it still aches on the stairs. Doctor: mild effusion on exam; continue the home exercises.';
const API = 'https://scrivara-backend.onrender.com';
const EM = 'dr.synthetic@example.test';

const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'content-type': ({ '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json' })[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(f).pipe(r);
}).listen(0, '127.0.0.1', async () => {
  /* host-resolver-rules: not even a preconnect can leave 127.0.0.1 */
  const b = await chromium.launch({ args: ['--no-sandbox', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'] });
  const errs = [];
  const port = srv.address().port;
  const newPage = async (ctxOpts) => {
    const pg = await (await b.newContext(ctxOpts)).newPage();
    pg.on('pageerror', (e) => errs.push(String(e.message).slice(0, 160)));
    await pg.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.fulfill({ status: 503, body: 'x' }));
    return pg;
  };
  /* The signed-in shell, booted exactly like errors-reach-the-doctor. A
     reload is the same boot again in the same tab (sessionStorage survives),
     without re-seeding. */
  const boot = async (pg, seed) => {
    await pg.goto('http://127.0.0.1:' + port + '/1pScribeFlow.html', { waitUntil: 'load', timeout: 90000 });
    await pg.waitForTimeout(2500);
    await pg.evaluate(() => (typeof window.__mlsEnsureUiBundle === 'function' ? window.__mlsEnsureUiBundle() : null));
    await pg.waitForFunction(() => !!window.__mlsSimpleLayer, null, { timeout: 60000 });
    await pg.waitForTimeout(4000);
    await pg.evaluate(() => {
      const a = document.getElementById('authScreen'); if (a) a.style.display = 'none';
      const s = document.getElementById('appScreen'); if (s) s.style.display = '';
      window.__mlsHarnessAccountEmail = 'ui-harness@mlsscribe.test';
      try { window.__mlsDeferAsset = function (fn) { return setTimeout(fn, 0); }; } catch (e) {}
      try { window.dispatchEvent(new Event('mls:loader-ready')); } catch (e) {}
      try { if (window.__mlsP1CalmDock && typeof window.__mlsP1CalmDock.ensure === 'function') window.__mlsP1CalmDock.ensure(); } catch (e) {}
    });
    await pg.waitForTimeout(2500);
    await pg.evaluate(() => { try { if (window.__mlsCalmShell && typeof window.__mlsCalmShell.boot === 'function') window.__mlsCalmShell.boot(); } catch (e) {} });
    await pg.evaluate(HARNESS);
    if (seed) await pg.evaluate(() => window.__clunky.seed());
    await pg.waitForTimeout(800);
  };
  const stubAI = (pg) => pg.evaluate((note) => {
    window.aiCallRaw = function (sys, user, key, opts) {
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => resolve((opts && opts.freeform) ? 'Freeform answer' : JSON.stringify({
          note, athena_note: note, insurance_note: note, chief_complaint: 'Low back pain', diagnoses: 'Lumbar radiculopathy',
          medications: 'None', orders: 'None', follow_up: '4 weeks', em_level: '99213', em_justification: 'Low MDM',
          em_evidence_quote: 'low back pain', icd10: [{ code: 'M54.16', desc: 'Radiculopathy, lumbar', evidence_quote: 'low back pain' }],
          cpt: [], red_flags: [], suggested_orders: [], differentials: [], opioids: [], recommendations: [] })), 200);
        const sig = opts && opts.signal;
        if (sig) sig.addEventListener('abort', () => { clearTimeout(t); const e = new Error('aborted'); e.name = 'AbortError'; reject(e); }, { once: true });
      });
    };
  }, NOTE);
  const openVisit = (pg) => pg.evaluate(async () => {
    if (getActivePtId() !== 'syn-0') window.__mlsPatientLock.switchAsDoctor('syn-0');
    await new Promise((r) => setTimeout(r, 600)); showView('visit');
  });
  /* Type-or-paste the visit notes through the real Home door and modal. */
  const pasteVisit = async (pg, phone, text) => {
    await openVisit(pg); await pg.waitForTimeout(1200);
    await pg.evaluate(() => window.scrollTo(0, 0));
    if (phone) await pg.tap('#ez3ActiveNotes'); else await pg.click('#ez3ActiveNotes');
    await pg.waitForTimeout(800);
    await pg.fill('.mls-qtp-textarea', text || TRANSCRIPT);
    const use = pg.locator('text=Use these visit notes');
    if (phone) await use.tap(); else await use.click();
    await pg.waitForTimeout(800);
  };
  /* A REAL signed-in session: the page's own startSession() runs on every
     load and reload, with the backend answered by routes. */
  const user = { email: EM, name: 'Dr Synthetic', role: 'doctor', hasAccess: true, agreements: { required: false }, readiness: { state: 'ready', reasons: [] } };
  const hostedPage = async (ctxOpts) => {
    const ctx = await b.newContext(ctxOpts);
    await ctx.addInitScript((em) => { try { if (!localStorage.getItem('__seededOnce')) { localStorage.setItem('__seededOnce', '1');
      localStorage.setItem('sf_bk_token', 'synthetic.test.token'); localStorage.setItem('sf_session', em);
      localStorage.setItem('sf_shared_workstation', '0'); localStorage.setItem('sf_shared_workstation_asked', '1'); } } catch (e) {} }, EM);
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => {
      const req = route.request(), p = new URL(req.url()).pathname, m = req.method();
      if (!req.url().startsWith(API)) return route.fulfill({ status: 503, body: 'x' });
      const J = (o, st) => route.fulfill({ status: st || 200, headers: { 'access-control-allow-origin': '*' }, contentType: 'application/json', body: JSON.stringify(o) });
      if (p === '/api/me') return J({ user, practice: { name: 'Synthetic Clinic' }, calendarEnabled: true });
      if (p === '/api/agreements/me') return J({ signed: true, version: '2026-06-10' });
      if (p === '/api/records' && m === 'POST') return J({ ok: true });
      if (p === '/api/records') return J({ records: [] });
      if (p === '/api/patients') return J({ patients: [] });
      if (p === '/api/appointments') return J({ appointments: [] });
      if (p === '/api/providers') return J({ providers: [] });
      if (p === '/api/prefs') return J({ prefs: {} });
      if (p === '/api/health') return J({ ok: true });
      return J({ error: 'not found' }, 404);
    });
    const pg = await ctx.newPage();
    pg.on('pageerror', (e) => errs.push(String(e.message).slice(0, 160)));
    await pg.goto('http://127.0.0.1:' + port + '/1pScribeFlow.html', { waitUntil: 'domcontentloaded' });
    await settleSignedIn(pg);
    return pg;
  };
  const dismissFirstRun = async (pg) => { for (let k = 0; k < 3; k++) { for (const t of ['Choose later', 'No, it is mine', 'Got it', 'Not now', 'Maybe later']) {
    const l = pg.getByText(t, { exact: false }); if (await l.first().isVisible().catch(() => false)) { await l.first().click({ timeout: 2000 }).catch(() => {}); await pg.waitForTimeout(400); } } } };
  const settleSignedIn = async (pg) => {
    await pg.waitForFunction(() => document.documentElement.dataset.mlsStartupBundle === 'ready' && typeof session !== 'undefined' && session && getComputedStyle(document.getElementById('appScreen')).display !== 'none', null, { timeout: 90000 });
    await pg.waitForTimeout(7000);
    await dismissFirstRun(pg);
    await pg.evaluate(HARNESS);
    await stubAI(pg);
  };
  /* The doctor's real reload: no harness boot, no navigation afterwards. */
  const reload = async (pg) => { await pg.reload({ waitUntil: 'domcontentloaded' }); await settleSignedIn(pg); };
  /* The offer is on screen: laid out, no display:none ancestor, above the
     workspace the doctor uses, with its Restore button reachable. */
  const offer = (pg) => pg.evaluate(() => {
    window.scrollTo(0, 0);
    const bars = document.querySelectorAll('#_visitRestoreBar'), bar = bars[0]; if (!bar) return { inDom: false };
    let hiddenBy = null;
    for (let e = bar; e && e !== document.body; e = e.parentElement) if (getComputedStyle(e).display === 'none') { hiddenBy = '#' + e.id; break; }
    const r = bar.getBoundingClientRect(), ez = document.getElementById('mlsEz3');
    const btn = Array.from(bar.querySelectorAll('button')).find((x) => /Restore it/.test(x.textContent));
    return { inDom: true, count: bars.length, text: bar.textContent.replace(/\s+/g, ' ').trim(), hiddenBy, laidOut: r.width > 0 && r.height > 0,
      aboveWorkspace: !!(ez && (bar.compareDocumentPosition(ez) & Node.DOCUMENT_POSITION_FOLLOWING)),
      restoreBtn: !!(btn && btn.getClientRects().length) };
  });
  const rail = (pg) => pg.evaluate(() => {
    const st = Array.from(document.querySelectorAll('#mlsStages .st'));
    const on = document.querySelector('.ez3-flow .ez3-fstep.on');
    return { now: st.findIndex((s) => s.classList.contains('now')), label: (document.getElementById('mlsStages') || { getAttribute: () => '' }).getAttribute('aria-label'),
      strip: on ? on.textContent.trim() : '' };
  });
  const contrast = (pg) => pg.evaluate(() => {
    function parse(c) { const m = String(c).match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(',').map(parseFloat); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; }
    function lum(c) { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); }
    /* The surface under the text, painted top-down: each box's gradient
       (its first stop - #mlsEz3's white paper is a gradient) above its
       background-color, stopping at the first opaque layer. */
    function bgOf(el) { const stack = []; outer: for (let e = el; e; e = e.parentElement) { const cs = getComputedStyle(e);
        for (const c of [/gradient/.test(cs.backgroundImage) ? parse(cs.backgroundImage) : null, parse(cs.backgroundColor)]) { if (c && c.a > 0) { stack.push(c); if (c.a >= 1) break outer; } } }
      let out = { r: 255, g: 255, b: 255 }; for (let i = stack.length - 1; i >= 0; i--) { const c = stack[i]; out = { r: c.r * c.a + out.r * (1 - c.a), g: c.g * c.a + out.g * (1 - c.a), b: c.b * c.a + out.b * (1 - c.a) }; } return out; }
    const sels = ['.ez3-transcript-card .ez3-transcript-head label', '.ez3-transcript-card .ez3-transcript-head span', '#ez3TranscriptCount',
      '.ez3-transcript-card .ez3-transcript-meta strong', '.ez3-transcript-card .ez3-transcript-meta span:last-child'];
    return sels.map((s) => {
      const el = document.querySelector(s); if (!el || !el.getClientRects().length) return { s, shown: false };
      const fg = parse(getComputedStyle(el).color), bg = bgOf(el);
      const fgc = { r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a) };
      const L1 = lum(fgc), L2 = lum(bg);
      return { s, shown: true, text: el.textContent.trim().slice(0, 40), ratio: +((Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05)).toFixed(2) };
    });
  });
  try {
    /* ---------- desktop: the note card's width and the progress rail ---------- */
    const dk = await newPage(DESK);
    await boot(dk, true); await stubAI(dk);
    await dk.evaluate(() => localStorage.setItem(uns('providerName'), 'Dr. Sample Provider'));
    await pasteVisit(dk, false);
    await dk.click('#ez3flGen');
    await dk.waitForFunction(() => String(currentSoap || '').length > 100, null, { timeout: 30000 });
    await dk.waitForTimeout(2500);
    const grid = await dk.evaluate(() => {
      const g = document.querySelector('#visitView > .mlsRdVisitGrid'), nc = document.getElementById('noteCard');
      const gr = g.getBoundingClientRect(), r = nc.getBoundingClientRect();
      return { grid: Math.round(gr.width), note: Math.round(r.width), emptyRight: Math.round(gr.right - r.right), shown: r.height > 0 };
    });
    assert.ok(grid.shown, 'the generated note card is on screen: ' + JSON.stringify(grid));
    assert.ok(grid.note >= grid.grid - 2 && grid.emptyRight <= 2,
      'the generated note spans the visit grid instead of one 383px column beside empty hidden-card columns: ' + JSON.stringify(grid));
    const gen = await rail(dk);
    assert.strictEqual(gen.now, 2, 'with a generated note the top rail reads Review (the flow strip says "' + gen.strip + '"): ' + JSON.stringify(gen));
    assert.match(gen.strip, /Review/, 'the flow strip agrees: ' + JSON.stringify(gen));
    await dk.click('#ez3Sign');
    await dk.waitForFunction(() => typeof signed !== 'undefined' && signed === true, null, { timeout: 15000 });
    await dk.waitForTimeout(2500);
    const sg = await rail(dk);
    assert.strictEqual(sg.now, 4, 'once signed the top rail reads Send, like the flow strip ("' + sg.strip + '"): ' + JSON.stringify(sg));
    assert.match(sg.strip, /Send/, 'the flow strip agrees: ' + JSON.stringify(sg));
    assert.strictEqual(sg.label, 'Visit progress: Send', 'the rail names the stage it shows');
    await dk.context().close();

    /* ---------- desktop: a REAL signed-in reload with an unsaved generated note ---------- */
    const dr = await hostedPage(DESK);
    assert.ok(await dr.evaluate(() => session && session.email), 'desktop: a real signed-in session is running');
    await dr.evaluate(() => window.__clunky.seed());
    await pasteVisit(dr, false);
    await dr.click('#ez3flGen');
    await dr.waitForFunction(() => String(currentSoap || '').length > 100, null, { timeout: 30000 });
    await dr.waitForTimeout(2500);
    assert.ok(await dr.evaluate(() => !!sessionStorage.getItem(uns('visitDraft'))), 'the unsaved visit was autosaved to this tab');
    const before = await dr.evaluate(() => String(currentSoap || '').trim());
    await reload(dr);
    const od = await offer(dr);
    assert.ok(od.inDom && /unsaved visit for Ada Sample/.test(od.text), 'after a real reload the restore offer names the patient: ' + JSON.stringify(od));
    assert.strictEqual(od.hiddenBy, null, 'the restore offer is not inside a display:none card: ' + JSON.stringify(od));
    assert.ok(od.count === 1 && od.laidOut && od.restoreBtn && od.aboveWorkspace, 'desktop: the restore offer and its Restore button are on screen above the workspace, with no navigation: ' + JSON.stringify(od));
    await dr.evaluate(() => showView('patients')); await dr.waitForTimeout(400);
    await dr.evaluate(() => showView('visit')); await dr.waitForTimeout(1200);
    const od2 = await offer(dr);
    assert.ok(od2.count === 1 && od2.hiddenBy === null && od2.laidOut && od2.restoreBtn && od2.aboveWorkspace, 'desktop: still on screen, once, after the Visit tab is pressed again: ' + JSON.stringify(od2));
    /* the doctor ignores the offer and enters new notes through Type or paste */
    await pasteVisit(dr, false, TB);
    await dr.waitForTimeout(1200);
    const ign = await dr.evaluate(() => ({ bar: !!document.getElementById('_visitRestoreBar'), dirty: _visitDirty,
      slot: (JSON.parse(sessionStorage.getItem(uns('visitDraft')) || '{}').t || ''), aside: sessionStorage.getItem(uns('visitDraftAside')) || '' }));
    assert.ok(!ign.bar, 'new work retires the offer, so its Restore / Discard cannot act on the new text: ' + JSON.stringify(ign));
    assert.ok(ign.dirty && /right knee pain/.test(ign.slot), 'the new visit is autosaved and the leave-page warning is armed: ' + JSON.stringify(ign));
    assert.ok(/Lumbar radiculopathy/.test(ign.aside), 'the ignored visit is kept aside, not overwritten');
    /* even a leftover Discard press cannot delete the current visit's autosave or disarm the warning */
    await dr.evaluate(() => _dismissVisitRestore()); await dr.waitForTimeout(300);
    const kept = await dr.evaluate(() => ({ dirty: _visitDirty, slot: (JSON.parse(sessionStorage.getItem(uns('visitDraft')) || '{}').t || '') }));
    assert.ok(kept.dirty && /right knee pain/.test(kept.slot), 'Discard never deletes the current visit\'s autosave: ' + JSON.stringify(kept));
    await reload(dr);
    const od3 = await offer(dr);
    assert.ok(od3.count === 1 && od3.hiddenBy === null && od3.laidOut && od3.restoreBtn && od3.aboveWorkspace, 'the next reload offers the current visit on screen: ' + JSON.stringify(od3));
    await dr.locator('#_visitRestoreBar button', { hasText: 'Restore it' }).click();
    await dr.waitForTimeout(800);
    assert.ok(/right knee pain/.test(await dr.evaluate(() => document.getElementById('transcript').value)), 'and Restore brings back the notes the doctor was working on');
    /* the next New visit saves them and offers the ignored visit again */
    await dr.evaluate(() => { window.__said = []; const o = window.toast; window.toast = function (m, k) { window.__said.push(String(m)); return o.apply(this, arguments); }; goNewVisitForPatient(); });
    await dr.waitForTimeout(1000);
    const nv = await dr.evaluate(() => ({ said: window.__said.join(' | '), rows: getNotes().filter((n) => /right knee pain/.test(n.transcript || '')).length }));
    assert.ok(nv.rows === 1 && /Saved the unfinished transcript to Ada Sample.s history/.test(nv.said), 'New visit saved the current notes to History: ' + JSON.stringify(nv));
    const od4 = await offer(dr);
    assert.ok(od4.count === 1 && od4.hiddenBy === null && od4.laidOut && od4.restoreBtn && od4.aboveWorkspace && /unsaved visit for Ada Sample/.test(od4.text), 'the ignored visit is offered again, on screen: ' + JSON.stringify(od4));
    await dr.locator('#_visitRestoreBar button', { hasText: 'Restore it' }).click();
    await dr.waitForTimeout(800);
    const back = await dr.evaluate(() => ({ soap: String(currentSoap || '').trim(), box: document.getElementById('noteBox').value.trim(), bar: !!document.getElementById('_visitRestoreBar') }));
    assert.ok(back.soap === before && back.box === before && /Lumbar radiculopathy/.test(back.soap) && !back.bar, 'Restore brings the generated note back and clears the offer: ' + JSON.stringify({ chars: back.soap.length, bar: back.bar }));
    await dr.context().close();

    /* ---------- phone: transcript card contrast, and the restore offer ---------- */
    const ph = await newPage(PHONE);
    await boot(ph, true); await stubAI(ph);
    await pasteVisit(ph, true);
    await ph.evaluate(() => { const e = document.querySelector('.ez3-transcript-card'); if (e) e.scrollIntoView({ block: 'center' }); });
    await ph.waitForTimeout(400);
    for (const theme of ['light', 'dark']) {
      if (theme === 'dark') {
        /* The dark theme as the app paints it: the token swap plus the
           theme-parity sheet (tp-1.0.0) it builds once body.theme-dark exists. */
        await ph.evaluate(() => document.body.classList.add('theme-dark'));
        await ph.waitForFunction(() => { const s = document.getElementById('mlsThemeParity'); return !!(s && /theme-dark\) [#.]/.test(s.textContent)); }, null, { timeout: 15000 });
        await ph.waitForTimeout(500);
      }
      const c = await contrast(ph);
      assert.ok(c.filter((x) => x.shown).length === 5, 'phone: the transcript card shows its heading, hint and counters (' + theme + '): ' + JSON.stringify(c));
      c.forEach((x) => assert.ok(x.ratio >= 4.5, 'phone ' + theme + ' theme: "' + x.text + '" reads ' + x.ratio + ':1 (needs 4.5:1)'));
    }
    await ph.context().close();

    /* ---------- phone: a REAL signed-in reload with unsaved visit notes ---------- */
    /* 390x844 touch, as the review measured it. No handheld user agent: that
       loads the separate phone app (feat_mls_phone_ui.js), a full-screen layer
       over #visitView that has no restore offer of its own at all. */
    const pr = await hostedPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await pr.evaluate(() => window.__clunky.seed());
    await pasteVisit(pr, true);
    await pr.waitForTimeout(1500);
    assert.ok(await pr.evaluate(() => !!sessionStorage.getItem(uns('visitDraft'))), 'phone: the pasted visit was autosaved to this tab');
    const pbefore = await pr.evaluate(() => document.getElementById('transcript').value.trim());
    await reload(pr);
    const op = await offer(pr);
    assert.ok(op.inDom && op.count === 1 && op.hiddenBy === null && op.laidOut && op.restoreBtn && op.aboveWorkspace,
      'phone: after a real reload the restore offer is on screen above the workspace: ' + JSON.stringify(op));
    await pr.locator('#_visitRestoreBar button', { hasText: 'Restore it' }).tap();
    await pr.waitForTimeout(800);
    const pback = await pr.evaluate(() => ({ tx: document.getElementById('transcript').value.trim(), bar: !!document.getElementById('_visitRestoreBar') }));
    assert.ok(pback.tx === pbefore && /straight leg raise/.test(pback.tx) && !pback.bar, 'phone: Restore it brings the visit text back: ' + JSON.stringify({ chars: pback.tx.length, bar: pback.bar }));
    await pr.context().close();

    assert.deepStrictEqual(errs, [], 'no page errors: ' + errs.join(' | '));
    console.log('PASS visit layout: after a real signed-in reload the restore offer is on screen above the workspace (desktop and phone, also after the Visit tab is pressed again) and restores the visit; new work retires it with the ignored visit kept aside and offered again after the next New visit, and no Discard can delete the current visit\'s autosave; the generated note spans the visit grid, the phone transcript card reads >= 4.5:1 in both themes, and the top rail follows the note (Review) and the signature (Send) like the flow strip');
  } finally { await b.close(); srv.close(); }
});
