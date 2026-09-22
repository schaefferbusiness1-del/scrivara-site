'use strict';
/* The op-note room says one thing at a time (opui-1.0.0). Found by the
   ScribeFlow.html UI critique and measured on /ScribeFlow.html:
   - While Draft all ran, its button still read "Draft all op notes" and a
     press answered "already running - use Stop first"; the only Stop was a
     small button in the log, and it stayed up after the run.
   - "This patient" put one date in the header (the day the room last showed)
     and another on the note.
   - The Templates tab called op-note templates "optional output formatting"
     beside visit-note switches that do not touch op notes, and on a phone it
     opened 1,946px down inside a second scroller.
   - Settings named the op-note follow modes Strict / Follow template / Guide
     only, and said "add a template first" with templates loaded, while the
     room says Closely / Balanced / Adapt to case.
   - History's Op notes filter with nothing typed said "No visits match your
     search".
   Real Chrome against the production shell. */
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
function serve() {
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const f = path.resolve(ROOT, '.' + p);
    if (!f.startsWith(ROOT + path.sep) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function boot(browser, base, viewport, mobile) {
  const ctx = await browser.newContext(Object.assign({ viewport }, mobile ? { isMobile: true, hasTouch: true } : {}));
  const page = await ctx.newPage();
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.fulfill({ status: 503, body: 'offline' }));
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e && e.message || e)));
  await page.goto(base + '/ScribeFlow.html?preview=1', { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.openOpPrep === 'function' && !!window.__mlsOpDay && (window._calAppts || []).length > 0, null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  return { ctx, page, errors };
}

(async () => {
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  try {
    /* ---- desktop ---- */
    const { ctx, page, errors } = await boot(browser, base, { width: 1400, height: 900 }, false);

    /* 1. "This patient" shows the patient's own visit date */
    const pm = await page.evaluate(async () => {
      const appts = (window._calAppts || []).filter((a) => a && a.patientId && a.appt_date);
      const days = Array.from(new Set(appts.map((a) => a.appt_date))).sort();
      if (days.length < 2) return { skip: 'sample has one day' };
      const other = appts.find((a) => a.appt_date !== days[0]);
      window.openOpPrep(days[0]);
      await new Promise((r) => setTimeout(r, 600));
      window.closeOpPrep();
      window.openOpPrepForPatient(other.patientId);
      const md = new Date(other.appt_date + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      const head = () => (document.getElementById('mlsOpDayTitle') || {}).textContent || '';
      for (let k = 0; k < 50 && head().indexOf(md) < 0; k++) await new Promise((r) => setTimeout(r, 200));
      const row = (window._opPrep || [])[0] || {};
      return { want: other.appt_date, rowDay: row.dateKey, head: head() };
    });
    if (!pm.skip) {
      const d = new Date(pm.want + 'T12:00:00');
      const md = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      assert.strictEqual(pm.rowDay, pm.want, 'the single-patient room holds that patient\'s visit: ' + JSON.stringify(pm));
      assert.ok(pm.head.indexOf(md) >= 0, 'the header shows the note\'s date (' + md + '), not the day the room last showed: ' + pm.head);
    }
    await page.evaluate(() => { try { window.closeOpPrep(); } catch (e) {} });

    /* 2. Draft all while it runs: one Stop, where the Draft-all button was */
    await page.evaluate(() => window.openOpPrep());
    await page.waitForTimeout(800);
    const seeded = await page.evaluate(() => {
      const DAY = window._opPrepDay;
      const NAMES = ['Ada Synthetic', 'Bo Synthetic'];
      const PROCS = ['Caudal epidural steroid injection', 'Lumbar medial branch block'];
      try { window.savePatients((window.getPatients() || []).concat(NAMES.map((n, i) => ({ id: 'opui-syn-' + i, name: n, dob: '1960-01-0' + (i + 1), notes: [], visits: [] })))); } catch (e) {}
      window._calAppts = NAMES.map((n, i) => ({ id: 'opui-appt-' + i, name: n, patientId: 'opui-syn-' + i, appt_date: DAY, start_at: DAY + 'T0' + (8 + i) + ':00:00', reason: PROCS[i] }));
      window._opPrep = NAMES.map((n, i) => window._opNewRow(n, PROCS[i], '1960-01-0' + (i + 1), DAY, 'opui-syn-' + i, { name: n, reason: PROCS[i], start_at: DAY + 'T0' + (8 + i) + ':00:00' }, DAY));
      window.opPrepRender();
      /* hold every draft open long enough to see the running room */
      const orig = window.opPrepGenerateOne;
      window.opPrepGenerateOne = function () { const self = this, args = arguments; return new Promise((r) => setTimeout(r, 2500)).then(() => orig.apply(self, args)); };
      return { gen: !!orig, tri: window.__mlsOpNoteDayBrain.triageAll().map((t) => t.verdict) };
    });
    assert.ok(seeded.gen, 'opPrepGenerateOne exists');
    await page.evaluate(() => { window.__opuiRun = window.__mlsTplPrepFix.draftAll(); });
    await page.waitForFunction(() => window.__mlsOpDay.dayState() === 'stop', null, { timeout: 20000 });
    /* the room repaints on its own coalesced tick; wait for the painted Stop */
    await page.waitForFunction(() => { const g = document.getElementById('mlsOpDayGo'); return window.__mlsOpDay.dayState() === 'stop' && g && !g.hidden && /Stop drafting/.test(g.textContent); }, null, { timeout: 15000 }).catch(() => {});
    const running = await page.evaluate(() => {
      const gen = document.getElementById('opPrepGenAllBtn'), go = document.getElementById('mlsOpDayGo');
      return { genShown: !!(gen && gen.offsetParent && getComputedStyle(gen).display !== 'none'), goHidden: go ? go.hidden : null, goText: go ? go.textContent : '' };
    });
    assert.strictEqual(running.genShown, false, 'Draft all steps aside while a run is on: ' + JSON.stringify(running));
    assert.strictEqual(running.goHidden, false, 'the day button is shown while drafting');
    assert.match(running.goText, /Stop drafting/, 'the day button is the Stop: ' + running.goText);
    await page.evaluate(() => document.getElementById('mlsOpDayGo').click());
    await page.waitForFunction(() => window.__opuiRun && window.__mlsOpDay.dayState() !== 'stop', null, { timeout: 60000 });
    const stopped = await page.evaluate(async () => { const r = await window.__opuiRun; return { r, status: (document.getElementById('opPrepStatus') || {}).textContent || '' }; });
    assert.match(stopped.status, /Stopped/, 'pressing the day button stops the run: ' + stopped.status);
    const stopHidden = await page.evaluate(() => {
      const m = document.getElementById('opPrepModal'), s = document.getElementById('tpfStop');
      if (!m || !s) return null;
      const had = m.getAttribute('data-mlsopn-run'); m.setAttribute('data-mlsopn-run', 'done');
      const d = getComputedStyle(s).display; if (had == null) m.removeAttribute('data-mlsopn-run'); else m.setAttribute('data-mlsopn-run', had);
      return d;
    });
    if (stopHidden !== null) assert.strictEqual(stopHidden, 'none', 'a finished run keeps its ledger but not its Stop');

    /* 3. the Templates tab speaks about op notes */
    await page.evaluate(() => { const t = document.getElementById('oprTabTpls'); if (t) t.click(); });
    await page.waitForTimeout(700);
    const tplDesk = await page.evaluate(() => {
      const m = document.getElementById('templatesModal');
      const vis = (sel) => Array.from(m.querySelectorAll(sel)).filter((e) => e.offsetParent !== null).map((e) => e.textContent.replace(/\s+/g, ' ').trim());
      return { inRoom: !!m.closest('#oprPanelTpls'), h3: Array.from(m.querySelectorAll('h3 > span')).filter((e) => e.offsetParent !== null).map((e) => e.textContent).join(' '), op: vis('.tpl-ctx-op'), visit: vis('.tpl-ctx-visit') };
    });
    assert.ok(tplDesk.inRoom, 'the Templates tab hosts the templates card');
    assert.match(tplDesk.h3, /Op-note templates/, 'the tab is titled for op notes: ' + tplDesk.h3);
    assert.doesNotMatch(tplDesk.h3, /optional output formatting/, 'op-note templates are not "optional output formatting"');
    assert.deepStrictEqual(tplDesk.visit, [], 'the visit-note wording is hidden in the room');
    assert.ok(tplDesk.op.some((t) => /do not change op notes/.test(t)), 'the visit-note switches say they do not change op notes: ' + JSON.stringify(tplDesk.op));
    await page.evaluate(() => { try { window.closeOpPrep(); } catch (e) {} });

    /* 4. History's Op notes filter names the filter, not a search */
    const hist = await page.evaluate(async () => {
      try { window.showView && window.showView('history'); } catch (e) {}
      await new Promise((r) => setTimeout(r, 500));
      const s = document.getElementById('histSearch'); if (s) s.value = '';
      const f = document.getElementById('histFilter'); if (!f) return null;
      f.value = 'opnote'; window.renderHistory();
      const e = document.getElementById('histEmpty');
      const out = { shown: !!e && getComputedStyle(e).display !== 'none', text: e ? e.textContent.replace(/\s+/g, ' ').trim() : '' };
      f.value = ''; window.renderHistory();
      return out;
    });
    if (hist && hist.shown) {
      assert.doesNotMatch(hist.text, /match your search/, 'no search was typed: ' + hist.text);
      assert.match(hist.text, /No op notes/, 'the empty state names the filter: ' + hist.text);
      assert.match(hist.text, /Show all visits/, 'and offers the way back: ' + hist.text);
    }
    assert.deepStrictEqual(errors, [], 'no page errors: ' + errors.join(' | '));
    await ctx.close();

    /* ---- phone: the Templates tab opens at its top, one scroller ---- */
    const ph = await boot(browser, base, { width: 390, height: 844 }, true);
    await ph.page.evaluate(() => window.openOpPrep());
    await ph.page.waitForTimeout(900);
    await ph.page.evaluate(() => { const t = document.getElementById('oprTabTpls'); if (t) t.click(); });
    await ph.page.waitForFunction(() => { const m = document.getElementById('templatesModal'), p = document.getElementById('oprPanelTpls'); return m && p && m.parentElement === p && p.classList.contains('on'); }, null, { timeout: 15000 });
    await ph.page.waitForTimeout(600);
    const tplPhone = await ph.page.evaluate(() => {
      const card = document.querySelector('#templatesModal .modal'), panel = document.getElementById('oprPanelTpls'), room = document.querySelector('#opPrepModal.opr-room > .modal');
      const cs = card ? getComputedStyle(card) : null;
      return { cardOverflow: cs && cs.overflowY, cardMax: cs && cs.maxHeight, nested: card ? card.scrollHeight > card.clientHeight + 2 && cs.overflowY !== 'visible' : null,
        panelTop: panel ? panel.scrollTop : null, roomW: room ? Math.round(room.getBoundingClientRect().width) : null, roomX: room ? Math.round(room.getBoundingClientRect().left) : null };
    });
    assert.strictEqual(tplPhone.cardOverflow, 'visible', 'the embedded card is not a second scroller on a phone: ' + JSON.stringify(tplPhone));
    assert.strictEqual(tplPhone.cardMax, 'none', 'the embedded card is not capped at 92vh: ' + JSON.stringify(tplPhone));
    assert.ok(tplPhone.panelTop < 60, 'the tab opens at its top, not 1,946px down: ' + JSON.stringify(tplPhone));
    assert.strictEqual(tplPhone.roomX, 0, 'the room is not inset on a phone: ' + JSON.stringify(tplPhone));
    assert.strictEqual(tplPhone.roomW, 390, 'the room is the full phone width: ' + JSON.stringify(tplPhone));
    assert.deepStrictEqual(ph.errors, [], 'no page errors on the phone: ' + ph.errors.join(' | '));
    await ph.ctx.close();

    /* ---- Settings: the op-note mode has the room's names ---- */
    const sctx = await browser.newContext();
    const sp = await sctx.newPage();
    await sp.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.fulfill({ status: 503, body: 'offline' }));
    await sp.route(base + '/opui-settings-shell', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html><body><div id="settingsModal" class="show"><div class="modal"><div class="row"><button type="button" onclick="saveSettings()">Save settings</button></div></div></div></body></html>' }));
    await sp.goto(base + '/opui-settings-shell');
    await sp.evaluate(() => {
      window.uns = (k) => 'opui-account::' + k;
      window.saveSettings = function () {};
      window.getGenLength = () => 'standard'; window.getGenInstr = () => '';
      window.bkBase = () => ''; window.bkToken = () => '';
      window.openTemplates = function () {};
      window.getTemplates = () => [{ id: 't1', name: 'Caudal ESI' }, { id: 't2', name: 'MBB' }, { id: 't3', name: 'RFA' }];
    });
    await sp.addScriptTag({ path: path.join(ROOT, 'feat_mls_draft_tuning.js') });
    await sp.selectOption('#mlsDtFamily', 'opnote');
    await sp.waitForTimeout(300);
    const set = await sp.evaluate(() => {
      const sel = document.getElementById('mlsDtSectionTemplate');
      return { opts: sel ? Array.from(sel.options).map((o) => o.value + '=' + o.textContent) : [], disabled: sel ? sel.disabled : null, help: (document.getElementById('mlsDtTemplateModeHelp') || {}).textContent || '' };
    });
    assert.ok(set.opts.some((o) => /^strict=Closely/.test(o)) && set.opts.some((o) => /^adapt=Balanced/.test(o)) && set.opts.some((o) => /^guide=Adapt to case/.test(o)), 'Settings uses the room\'s names: ' + JSON.stringify(set.opts));
    assert.ok(!set.opts.some((o) => /Guide only|headings and layout may change/.test(o)), 'no "headings may change" for op notes: ' + JSON.stringify(set.opts));
    assert.strictEqual(set.disabled, false, 'with op-note templates loaded the mode can be chosen');
    assert.doesNotMatch(set.help, /Add or import a template/, 'no "add a template first" with templates loaded: ' + set.help);
    await sp.selectOption('#mlsDtFamily', 'general_draft').catch(() => {});
    await sp.waitForTimeout(200);
    const visitOpts = await sp.evaluate(() => Array.from((document.getElementById('mlsDtSectionTemplate') || { options: [] }).options).map((o) => o.textContent));
    if (visitOpts.length) assert.ok(visitOpts.some((t) => /Follow template \(recommended\)/.test(t)), 'visit notes keep their own names: ' + JSON.stringify(visitOpts));
    await sctx.close();

    console.log('PASS op-note room says one thing: Stop replaces Draft all while it runs, "This patient" shows one date, the Templates tab is about op notes and opens at its top on a phone, Settings uses the room\'s mode names, and History names its filter');
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
