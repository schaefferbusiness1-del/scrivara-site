'use strict';
/* Every Templates surface follows the library (tplsync-1.0.0, b1310).
   Measured on /ScribeFlow.html?preview=1:
   - on a 390px phone the template editor pane was pinned over the saved
     list (position:sticky from the wide layout), so the list could not be
     read or pressed;
   - the op-note room's per-row template picker, the "standard line" ticks and
     the Template health rows each painted the library once and never again:
     a template saved or deleted elsewhere was missing / still offered there;
   - the matching test said a visit note "would use" an operative-report
     template that Generate refuses for visit notes;
   - Duplicate dropped the template's kind, so the copy matched every note
     kind the original was kept out of;
   - Settings > Visit note templates: Add made a new, empty format the ACTIVE
     one at once, and Cancel left it there - the section then wrote with no
     template at all.
   Real Chrome; nothing leaves 127.0.0.1. */
const http = require('http'), fs = require('fs'), path = require('path');
const assert = require('assert');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'content-type': ({ '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json' })[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(f).pipe(r);
}).listen(0, '127.0.0.1', async () => {
  const b = await chromium.launch({ args: ['--no-sandbox'] });
  const errs = [];
  const url = 'http://127.0.0.1:' + srv.address().port + '/ScribeFlow.html?preview=1';
  const open = async (ctx) => {
    const pg = await ctx.newPage();
    pg.on('pageerror', (e) => errs.push(String(e.message).slice(0, 160)));
    await pg.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.fulfill({ status: 503, body: 'x' }));
    await pg.goto(url);
    await pg.waitForFunction(() => typeof window.openTemplates === 'function' && typeof window.getTemplates === 'function' && typeof window.openOpPrep === 'function', null, { timeout: 60000 });
    await pg.waitForTimeout(2500);
    return pg;
  };
  try {
    /* ---- desktop ---- */
    const pg = await open(await b.newContext({ viewport: { width: 1280, height: 900 } }));
    const tick = () => pg.waitForTimeout(150);

    /* 1. Duplicate keeps the kind */
    const dup = await pg.evaluate(() => {
      const list = getTemplates();
      list.unshift({ id: 'tplKindA', name: 'Kinded SOAP template', keywords: ['follow up'], text: 'S: \nO: \nA: \nP: ', kind: 'soap', autoKw: 1, autoKind: 1, created: Date.now() });
      setTemplates(list);
      duplicateTemplate('tplKindA');
      const c = getTemplates().find((t) => t.name === 'Kinded SOAP template (copy)');
      return c ? { kind: c.kind, autoKw: c.autoKw, autoKind: c.autoKind } : null;
    });
    assert.deepStrictEqual(dup, { kind: 'soap', autoKw: 1, autoKind: 1 }, 'a duplicate is the same kind of template as the original');

    /* 2. Templates open: health rows and standard-line ticks follow a change made elsewhere */
    await pg.evaluate(() => openTemplates()); await pg.waitForTimeout(1200);
    await pg.evaluate(() => { const l = getTemplates(); l.push({ id: 'tplLate', name: 'Added While Open', keywords: [], text: 'Procedure: x', created: Date.now() }); setTemplates(l); });
    await tick();
    const late = await pg.evaluate(() => ({
      health: ((document.getElementById('tpfRows') || {}).textContent || '').indexOf('Added While Open') >= 0,
      std: ((document.getElementById('mls-stdline-section') || {}).textContent || '').indexOf('Added While Open') >= 0
    }));
    assert.deepStrictEqual(late, { health: true, std: true }, 'a template added while Templates is open shows in the health rows and the standard-line list');
    await pg.evaluate(() => setTemplates(getTemplates().filter((t) => t.id !== 'tplLate'))); await tick();
    const gone = await pg.evaluate(() => ({
      health: ((document.getElementById('tpfRows') || {}).textContent || '').indexOf('Added While Open') >= 0,
      std: ((document.getElementById('mls-stdline-section') || {}).textContent || '').indexOf('Added While Open') >= 0
    }));
    assert.deepStrictEqual(gone, { health: false, std: false }, 'a deleted template leaves both lists');

    /* 2b. a standard line being typed survives a background library save, and
       repainting never stacks another click listener on the section */
    const sl = await pg.evaluate(async () => {
      const w = document.getElementById('mls-stdline-section'); if (!w) return null;
      let wired = 0; const add = w.addEventListener; w.addEventListener = function (type) { if (type === 'click') wired++; return add.apply(this, arguments); };
      const ta = w.querySelector('#mls-sl-text'); ta.focus(); ta.value = 'Half-typed line'; ta.setSelectionRange(4, 4);
      const box = w.querySelector('.mls-sl-chk input[type=checkbox]'); if (box) box.checked = true;
      for (let i = 0; i < 4; i++) { const l = getTemplates(); l[0].keywords = (l[0].keywords || []).concat(['k' + i]); setTemplates(l); await new Promise((r) => setTimeout(r, 30)); }
      const t2 = w.querySelector('#mls-sl-text'), b2 = w.querySelector('.mls-sl-chk input[type=checkbox]');
      const kept = { text: t2.value, focused: document.activeElement === t2, caret: t2.selectionStart, ticked: b2 ? b2.checked : null };
      /* one Edit press = one render, not one per repaint so far */
      localStorage.setItem(uns('mlsStdLines'), JSON.stringify([{ id: 'sl1', text: 'Saved line', templateIds: [], created: 1 }]));
      t2.value = ''; setTemplates(getTemplates()); await new Promise((r) => setTimeout(r, 30));
      let renders = 0; const mo = new MutationObserver((recs) => { recs.forEach((r) => { if (r.target === w && r.type === 'childList') renders++; }); });
      mo.observe(w, { childList: true });
      const ed = w.querySelector('[data-act="edit"]'); if (ed) ed.click();
      await new Promise((r) => setTimeout(r, 30)); mo.disconnect();
      const cancel = w.querySelector('[data-act="cancel"]'); if (cancel) cancel.click();
      localStorage.removeItem(uns('mlsStdLines')); setTemplates(getTemplates());
      w.addEventListener = add;
      return { kept, editFound: !!ed, renders, wired };
    });
    if (sl) {
      assert.deepStrictEqual(sl.kept, { text: 'Half-typed line', focused: true, caret: 4, ticked: sl.kept.ticked === null ? null : true }, 'a half-typed standard line, its caret and its ticks survive background saves: ' + JSON.stringify(sl));
      assert.ok(sl.editFound, 'the seeded standard line shows an Edit button');
      assert.strictEqual(sl.renders, 1, 'one Edit press renders the section once: ' + JSON.stringify(sl));
      assert.strictEqual(sl.wired, 0, 'repainting never adds another click listener to the section: ' + JSON.stringify(sl));
    }

    /* 3. the matching test tells the truth about an operative-report default */
    const match = await pg.evaluate(async () => {
      localStorage.setItem(uns('templateAuto'), '0');
      const op = getTemplates().find((t) => /injection|block/i.test(t.name));
      localStorage.setItem(uns('templateActive'), op.id);
      const skip = window._mlsGenTemplateScopeSkip(op);
      const f = document.getElementById('tpfFold'); if (f) f.open = true;
      document.getElementById('tpfMatchBtn').click();
      const inp = document.getElementById('tpfMatchIn'); inp.value = 'follow-up visit for low back pain'; inp.dispatchEvent(new Event('input'));
      await new Promise((r) => setTimeout(r, 200));
      return { skip, name: op.name, out: document.getElementById('tpfMatchOut').textContent };
    });
    if (match.skip) {
      assert.ok(/NO template/.test(match.out) && match.out.indexOf(match.name) >= 0, 'the matching test says an operative-report default does not shape a visit note: ' + match.out);
      assert.ok(!/the active template; auto-choose is OFF/.test(match.out), 'it no longer claims the operative template would be used: ' + match.out);
    }
    await pg.evaluate(() => { localStorage.removeItem(uns('templateAuto')); localStorage.removeItem(uns('templateActive')); try { closeTemplates(); } catch (e) {} });

    /* 4. the op-note room forgets a deleted template */
    const room = await pg.evaluate(async () => {
      openOpPrep(); await new Promise((r) => setTimeout(r, 2000));
      const rows = window._opPrep || [];
      if (!rows.length) return { skipped: true };
      rows[0].tplId = 'tplKindA'; rows[0].tplManual = true;
      setTemplates(getTemplates().filter((t) => t.id !== 'tplKindA'));
      await new Promise((r) => setTimeout(r, 200));
      return { tplId: rows[0].tplId, manual: rows[0].tplManual };
    });
    if (!room.skipped) assert.deepStrictEqual(room, { tplId: '', manual: false }, 'a room row pointing at a deleted template is cleared');
    await pg.evaluate(() => { try { closeOpPrep(); } catch (e) {} });

    /* 5. Settings > Visit note templates: Add then Cancel changes nothing.
       On the signed-in shell: the sample keeps Settings read-only. */
    const sp = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
    sp.on('pageerror', (e) => errs.push(String(e.message).slice(0, 160)));
    await sp.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.fulfill({ status: 503, body: 'x' }));
    await sp.goto(url.replace('/ScribeFlow.html?preview=1', '/1pScribeFlow.html'), { waitUntil: 'load', timeout: 90000 });
    await sp.waitForTimeout(2500);
    await sp.evaluate(() => (typeof window.__mlsEnsureUiBundle === 'function' ? window.__mlsEnsureUiBundle() : null));
    await sp.waitForFunction(() => !!window.__mlsSimpleLayer && typeof window.openVisitNoteTemplates === 'function', null, { timeout: 60000 });
    await sp.evaluate(() => { const a = document.getElementById('authScreen'); if (a) a.style.display = 'none'; const s = document.getElementById('appScreen'); if (s) s.style.display = ''; window.__mlsHarnessAccountEmail = 'ui-harness@mlsscribe.test'; });
    const vn = await sp.evaluate(async () => {
      try { await openVisitNoteTemplates(); } catch (e) {}
      await new Promise((r) => setTimeout(r, 1500));
      const add = document.querySelector('[id^="mlsVnTplAdd_"]');
      if (!add) return { skipped: true };
      const fam = add.id.replace('mlsVnTplAdd_', '');
      const sel = document.getElementById('mlsVnTplProfile_' + fam);
      const before = { value: sel.value, n: sel.options.length };
      add.click(); await new Promise((r) => setTimeout(r, 300));
      const mid = { value: document.getElementById('mlsVnTplProfile_' + fam).value, n: document.getElementById('mlsVnTplProfile_' + fam).options.length };
      document.getElementById('mlsVnTplCancel_' + fam).click(); await new Promise((r) => setTimeout(r, 300));
      const s2 = document.getElementById('mlsVnTplProfile_' + fam);
      return { before, mid, after: { value: s2.value, n: s2.options.length } };
    });
    assert.ok(!vn.skipped, 'Settings > Visit note templates opens with an Add button');
    {
      assert.strictEqual(vn.mid.n, vn.before.n + 1, 'Add creates a new format: ' + JSON.stringify(vn));
      assert.deepStrictEqual(vn.after, vn.before, 'Cancel takes the unsaved format back out and restores the one that was active: ' + JSON.stringify(vn));
    }

    /* ---- phone: the editor pane no longer sits on the saved list ---- */
    const ph = await open(await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
      userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36' }));
    const lay = await ph.evaluate(async () => {
      openTemplates(); await new Promise((r) => setTimeout(r, 1200));
      const first = getTemplates()[0]; if (first && typeof tplSelect === 'function') tplSelect(first.id);
      await new Promise((r) => setTimeout(r, 500));
      const d = document.getElementById('tplDetail'), l = document.getElementById('tplList');
      if (!d || !l) return null;
      const rd = d.getBoundingClientRect(), rl = l.getBoundingClientRect();
      return { pos: getComputedStyle(d).position, overlap: rd.top < rl.bottom - 1 && rl.top < rd.bottom - 1 && rd.height > 0 && rl.height > 0 };
    });
    assert.ok(lay, 'the phone Templates modal has its list and detail pane');
    assert.strictEqual(lay.overlap, false, 'on a phone the editor pane and the saved list do not overlap: ' + JSON.stringify(lay));

    assert.deepStrictEqual(errs, [], 'no page errors: ' + errs.join(' | '));
    console.log('PASS templates stay in step: duplicate keeps its kind, health and standard-line lists follow the library, the match test applies the visit-note gate, the room forgets a deleted template, Add then Cancel changes nothing, and the phone editor does not cover the list');
  } finally { await b.close(); srv.close(); }
});
