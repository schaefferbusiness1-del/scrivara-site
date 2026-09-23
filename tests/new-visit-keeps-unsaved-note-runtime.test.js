'use strict';
/* "New visit" keeps the unsaved note (visitfix-1.0.0, 2026-09-23). Found by
   the Visit-flow hunt on the signed-in 1p shell: generate a note (288 chars),
   edit it, then History > Chart tools > New visit (desktop) or the phone
   header "+" > New visit: note 288 -> 0, transcript 233 -> 0, History still
   0 rows, no confirm, no message, no Restore offer. A patient switch saves
   the same work as a draft first; New visit did not.
   Pinned here, on the real booted shell:
   - desktop Chart tools door and phone "+" door: the edited note and its
     transcript land in the patient's History, the editor is empty, and the
     doctor is told on screen where the note went;
   - nothing unsaved (an empty editor, or Next patient right after Save to
     history) adds no row and says nothing;
   - a save the app refuses still clears the editor but keeps the text in the
     tab's recovery slot, offers it back, and says so.
   visitfix-1.1.0 (2026-09-23), from the review of 1.0.0 - also pinned:
   - Next patient right after Save to history with a visit comment (a saved
     default comment, or one typed in) rewrites nothing and claims nothing;
   - the offer a refused save points to is ON SCREEN (laid out, no hidden
     ancestor, above the workspace) on desktop and phone, and the next
     visit's typing does not lose the kept note: it is kept aside and offered
     again after the next New visit;
   - a full device (the local write fails while the server write starts) is
     never reported as "Saved ... to History": the text stays in the tab and
     the doctor is told it was not saved;
   - orders that could not be saved (an incomplete order) are kept and come
     back with Restore instead of being cleared;
   - the message survives a door that toasts right after starting the visit
     (the calendar) and the stopped generation's own message;
   - with the owner gate refusing (the previous patient's text still on screen
     under a new patient), the kept draft stays that previous patient's.
   Real Chrome; the AI is stubbed through window.aiCallRaw; nothing leaves
   127.0.0.1. */
const http = require('http'), fs = require('fs'), path = require('path');
const assert = require('assert');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const T = fs.readFileSync(path.join(__dirname, '1p-clunky-contract.test.js'), 'utf8');
const HARNESS = '(' + T.slice(T.indexOf('function harness() {'), T.indexOf('async function boot(page, port)')).trim() + ')()';
const TRANSCRIPT = 'Doctor: What brings you in today? Patient: I have had low back pain for three weeks and it goes down my left leg. Doctor: On exam straight leg raise is positive on the left. We will start physical therapy and follow up in four weeks.';
const NOTE = 'HPI:\nPatient reports low back pain for three weeks radiating to the left leg.\nROS:\nNot documented in today\'s transcript.\nEXAM:\nStraight leg raise positive on the left.\nASSESSMENT:\nLumbar radiculopathy with left leg radiation.\nPLAN:\nStart physical therapy. Follow up in four weeks.';
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' };

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
  const boot = async (ctxOpts) => {
    const pg = await (await b.newContext(ctxOpts)).newPage();
    pg.on('pageerror', (e) => errs.push(String(e.message).slice(0, 160)));
    await pg.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.fulfill({ status: 503, body: 'x' }));
    await pg.goto('http://127.0.0.1:' + srv.address().port + '/1pScribeFlow.html', { waitUntil: 'load', timeout: 90000 });
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
    await pg.evaluate(() => window.__clunky.seed());
    await pg.waitForTimeout(800);
    /* the model, stubbed: one canned structured answer; window.__aiDelay slows it */
    await pg.evaluate((note) => {
      const obj = { note: note, athena_note: note, insurance_note: 'MEDICAL NECESSITY:\nPhysical therapy is indicated.', chief_complaint: 'Low back pain',
        diagnoses: 'Lumbar radiculopathy', medications: 'None', orders: 'None', follow_up: '4 weeks', em_level: '99213', em_justification: 'Low MDM',
        em_evidence_quote: 'low back pain', icd10: [{ code: 'M54.16', desc: 'Radiculopathy, lumbar', evidence_quote: 'low back pain' }], cpt: [],
        red_flags: [], suggested_orders: [], differentials: [], opioids: [], recommendations: [] };
      window.__aiDelay = 60;
      window.aiCallRaw = function (sys, user, key, opts) {
        return new Promise((resolve, reject) => {
          const t = setTimeout(() => resolve((opts && opts.freeform) ? 'Freeform answer' : JSON.stringify(obj)), window.__aiDelay);
          const sig = opts && opts.signal;
          if (sig) sig.addEventListener('abort', () => { clearTimeout(t); const e = new Error('aborted'); e.name = 'AbortError'; reject(e); }, { once: true });
        });
      };
      /* every toast, in order, even the ones a later toast replaces */
      window.__toasts = [];
      const orig = window.toast;
      window.toast = function (m, k) { window.__toasts.push([String(m), String(k || '')]); return orig.apply(this, arguments); };
    }, NOTE);
    return pg;
  };
  /* a generated, then doctor-edited, unsaved note for Ada Sample (syn-0) */
  const toEditedNote = (pg, edit) => pg.evaluate(async (a) => {
    window.__mlsPatientLock.switchAsDoctor('syn-0'); await new Promise((r) => setTimeout(r, 400));
    showView('visit'); await new Promise((r) => setTimeout(r, 400));
    const tr = document.getElementById('transcript');
    tr.value = a.transcript; tr.dispatchEvent(new Event('input', { bubbles: true }));
    await generateNote();
    await new Promise((r) => setTimeout(r, 400));
    const nb = document.getElementById('noteBox');
    nb.value += '\n' + a.edit; nb.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 300));
    return { note: String(currentSoap || '').length, transcript: tr.value.length, edited: nb.value.indexOf(a.edit) >= 0 };
  }, { transcript: TRANSCRIPT, edit: edit });
  const state = (pg, edit) => pg.evaluate((ed) => {
    const t = document.getElementById('toast');
    const shown = !!(t && t.classList.contains('show') && t.getClientRects().length && getComputedStyle(t).opacity !== '0');
    const rows = getNotes().filter((n) => n.patientId === 'syn-0');
    const raw = sessionStorage.getItem(uns('visitDraft'));
    return {
      note: String(currentSoap || '').length, box: document.getElementById('noteBox').value.length,
      transcript: document.getElementById('transcript').value.length,
      rows: rows.length, withEdit: getNotes().filter((n) => String(n.soap || '').indexOf(ed) >= 0 && String(n.transcript || '').length > 200).length,
      toast: shown ? t.textContent : '', slot: !!raw, slotHasEdit: !!(raw && raw.indexOf(ed) >= 0),
      bar: !!document.getElementById('_visitRestoreBar')
    };
  }, edit);
  /* The restore offer is ON SCREEN: laid out, no display:none ancestor, above
     the workspace the doctor uses, its first button reachable. */
  const offer = (pg) => pg.evaluate(() => {
    window.scrollTo(0, 0);
    const bars = document.querySelectorAll('#_visitRestoreBar'), bar = bars[0]; if (!bar) return { inDom: false };
    let hiddenBy = null;
    for (let e = bar; e && e !== document.body; e = e.parentElement) if (getComputedStyle(e).display === 'none') { hiddenBy = '#' + e.id; break; }
    const r = bar.getBoundingClientRect(), ez = document.getElementById('mlsEz3'), btn = bar.querySelector('button');
    return { inDom: true, count: bars.length, text: bar.textContent.replace(/\s+/g, ' ').trim(), hiddenBy, laidOut: r.width > 0 && r.height > 0,
      aboveWorkspace: !!(ez && (bar.compareDocumentPosition(ez) & Node.DOCUMENT_POSITION_FOLLOWING)),
      button: btn ? btn.textContent.trim() : '', buttonShown: !!(btn && btn.getClientRects().length && btn.getBoundingClientRect().width > 0) };
  });
  const onScreen = (o) => o.inDom && o.count === 1 && o.hiddenBy === null && o.laidOut && o.aboveWorkspace && o.buttonShown;
  const clearToast = (pg) => pg.evaluate(() => { window.__toasts = []; const t = document.getElementById('toast'); if (t) { t.className = 'toast'; t.textContent = ''; } });
  const lastToast = (pg) => pg.evaluate(() => (window.__toasts[window.__toasts.length - 1] || ['', ''])[0]);
  const record = (pg, edit) => pg.evaluate((ed) => { const n = getNotes().find((x) => String(x.soap || '').indexOf(ed) >= 0); return n ? { id: n.id, updated: n.updated, soap: n.soap } : null; }, edit);
  const pressNextPatient = (pg) => pg.evaluate(() => {
    const btn = [...document.querySelectorAll('#nextActionsBar button')].find((x) => /Next patient/.test(x.textContent));
    if (!btn) return false; btn.click(); return true;
  });
  try {
    /* ---- desktop: History > Chart tools > New visit ---------------------- */
    const pg = await boot({ viewport: { width: 1400, height: 900 } });
    const before = await toEditedNote(pg, 'DOCTOR EDIT ONE');
    assert.ok(before.note > 200 && before.transcript > 200 && before.edited, 'a generated, edited note is on screen: ' + JSON.stringify(before));
    assert.strictEqual((await state(pg, 'DOCTOR EDIT ONE')).rows, 0, 'the note is not in History yet');
    await pg.evaluate(() => showView('history')); await pg.waitForTimeout(1000);
    await pg.click('#histPaneTabTools'); await pg.waitForTimeout(600);
    await pg.click('#histNewVisitBtn'); await pg.waitForTimeout(700);
    const desk = await state(pg, 'DOCTOR EDIT ONE');
    assert.strictEqual(desk.withEdit, 1, 'New visit saved the edited note and its transcript to the patient\'s History: ' + JSON.stringify(desk));
    assert.deepStrictEqual([desk.note, desk.box, desk.transcript], [0, 0, 0], 'and then started an empty visit');
    assert.match(desk.toast, /^Saved the unfinished note to Ada Sample.s history\./, 'the doctor is told on screen where the note went: ' + JSON.stringify(desk));
    assert.ok(!desk.slot && !desk.bar, 'a note that reached History leaves no stale Restore offer behind');

    /* nothing unsaved: New visit on an empty editor adds nothing and says nothing */
    await clearToast(pg);
    await pg.evaluate(() => goNewVisitForPatient()); await pg.waitForTimeout(500);
    const empty = await state(pg, 'DOCTOR EDIT ONE');
    assert.strictEqual(empty.rows, 1, 'an empty editor saves no row');
    assert.ok(!/unfinished/.test(empty.toast), 'and claims no save: ' + empty.toast);

    /* Next patient right after Save to history: already saved, no second row */
    await toEditedNote(pg, 'DOCTOR EDIT TWO');
    const saved = await pg.evaluate(() => saveCurrentNote(true));
    assert.strictEqual(saved, true, 'Save to history saved');
    await pg.waitForTimeout(300);
    const afterSave = await state(pg, 'DOCTOR EDIT TWO');
    assert.strictEqual(afterSave.rows, 2, 'Save to history wrote one row');
    await clearToast(pg);
    assert.ok(await pressNextPatient(pg), 'the Next patient button is offered after Save to history');
    await pg.waitForTimeout(500);
    const next = await state(pg, 'DOCTOR EDIT TWO');
    assert.strictEqual(next.rows, 2, 'Next patient after a save adds no duplicate row: ' + JSON.stringify(next));
    assert.ok(!/unfinished/.test(next.toast), 'and does not claim to have saved anything: ' + next.toast);
    assert.strictEqual(next.transcript + next.box, 0, 'Next patient still starts an empty visit');

    /* visitfix-1.1.0: the same, with a visit comment - a saved default comment
       (newVisit fills it in) and then one the doctor types for this visit. The
       save folds a COMMENT block into the note; that is not unsaved work. */
    await pg.evaluate(() => setDefaultComment('Patient seen with a chaperone present.'));
    await pg.evaluate(() => goNewVisitForPatient()); await pg.waitForTimeout(400);
    assert.strictEqual(await pg.evaluate(() => getVisitComment()), 'Patient seen with a chaperone present.', 'New visit filled in the default comment');
    for (const [edit, typed] of [['DOCTOR EDIT DEFAULT COMMENT', ''], ['DOCTOR EDIT TYPED COMMENT', 'Discussed imaging options at length.']]) {
      if (typed) {
        await pg.evaluate(() => setDefaultComment(''));
        await pg.evaluate(() => goNewVisitForPatient()); await pg.waitForTimeout(400);
      }
      await toEditedNote(pg, edit);
      if (typed) await pg.evaluate((c) => { const vc = document.getElementById('visitComment'); vc.value = c; vc.dispatchEvent(new Event('input', { bubbles: true })); }, typed);
      assert.strictEqual(await pg.evaluate(() => saveCurrentNote(true)), true, 'Save to history saved (' + edit + ')');
      await pg.waitForTimeout(300);
      const rec = await record(pg, edit);
      assert.ok(rec, 'the saved row exists (' + edit + ')');
      assert.ok(await pg.evaluate(() => /\nCOMMENT:\n/.test(String(currentSoap || ''))), 'the save folded the visit comment into the note (' + edit + ')');
      await clearToast(pg);
      assert.ok(await pressNextPatient(pg), 'Next patient is offered (' + edit + ')');
      await pg.waitForTimeout(600);
      const again = await record(pg, edit);
      const said = await pg.evaluate(() => window.__toasts.map((x) => x[0]).join(' | '));
      assert.strictEqual(again.updated, rec.updated, 'Next patient right after Save to history did not rewrite the saved row (' + edit + ')');
      assert.ok(!/unfinished|Draft saved/.test(said), 'and said nothing about an unfinished note (' + edit + '): ' + said);
      assert.strictEqual(await pg.evaluate(() => document.getElementById('transcript').value.length), 0, 'and started an empty visit (' + edit + ')');
    }
    await pg.evaluate(() => setDefaultComment(''));

    /* a refused save: the editor is cleared, but the text is kept and offered
       back - on screen, where the doctor works */
    await toEditedNote(pg, 'DOCTOR EDIT THREE');
    await pg.evaluate(() => {
      _athenaSetVisitBinding(_athenaFreezeVisitBinding({ name: 'Recovered unassigned draft' }, { source: 'legacy-restored-draft', historical: false, routeBlocked: true }), true);
    });
    await clearToast(pg);
    await pg.evaluate(() => goNewVisitForPatient()); await pg.waitForTimeout(600);
    const refused = await state(pg, 'DOCTOR EDIT THREE');
    assert.strictEqual(refused.withEdit, 0, 'a refused save writes nothing');
    assert.strictEqual(refused.transcript + refused.box, 0, 'New visit still gets the doctor out of the refused editor');
    assert.ok(refused.slot && refused.slotHasEdit && refused.bar, 'the text, with the latest edit, is kept in the tab and offered back: ' + JSON.stringify(refused));
    assert.match(refused.toast, /^MLS could not save the unfinished note to History\. It is kept in this tab\. Go to the top of the Visit screen to restore it\./, 'and the doctor is told plainly, on screen: ' + refused.toast);
    const rOffer = await offer(pg);
    assert.ok(onScreen(rOffer) && rOffer.button === 'Restore it', 'desktop: the offer the message points to is on screen above the workspace: ' + JSON.stringify(rOffer));
    /* the doctor ignores it and starts the next visit: the kept note is not lost */
    await pg.evaluate((t) => { const tr = document.getElementById('transcript'); tr.value = t; tr.dispatchEvent(new Event('input', { bubbles: true })); },
      'Doctor: Next patient, right shoulder pain after a fall. Patient: it hurts to lift my arm.');
    await pg.waitForTimeout(1300);
    const aside = await pg.evaluate(() => ({ bar: !!document.getElementById('_visitRestoreBar'), dirty: _visitDirty,
      aside: sessionStorage.getItem(uns('visitDraftAside')) || '', slot: sessionStorage.getItem(uns('visitDraft')) || '' }));
    assert.ok(!aside.bar, 'new work retires the offer, so its buttons cannot act on the new text');
    assert.ok(aside.aside.indexOf('DOCTOR EDIT THREE') >= 0, 'the kept note moved aside instead of being overwritten by the next visit\'s autosave');
    assert.ok(aside.dirty && /right shoulder pain/.test(aside.slot), 'and the next visit is protected by its own autosave');
    await clearToast(pg);
    await pg.evaluate(() => goNewVisitForPatient()); await pg.waitForTimeout(700);
    const reOffer = await offer(pg);
    assert.ok(onScreen(reOffer) && /unsaved visit for Ada Sample/.test(reOffer.text), 'after the next New visit the kept note is offered again, on screen: ' + JSON.stringify(reOffer));
    await pg.locator('#_visitRestoreBar button', { hasText: 'Restore it' }).click(); await pg.waitForTimeout(600);
    assert.ok(await pg.evaluate(() => document.getElementById('noteBox').value.indexOf('DOCTOR EDIT THREE') >= 0 && /straight leg raise/.test(document.getElementById('transcript').value)),
      'and Restore brings back the note that could not be saved');
    await pg.evaluate(() => { _athenaSetVisitBinding(null, true); newVisit({ patientSwitchReset: true }); });

    /* a full device: the local write fails while the server write starts, so
       saveDraft() says true with nothing in History */
    await toEditedNote(pg, 'DOCTOR EDIT FULL');
    await pg.evaluate(() => {
      window.__realSetItem = Storage.prototype.setItem; window.__realBackend = window.saveNoteToBackend;
      Storage.prototype.setItem = function (k, v) { if (this === localStorage && k === uns('notes')) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError'); return window.__realSetItem.call(this, k, v); };
      window.saveNoteToBackend = function () { return new Promise(function () {}); };   /* started, no answer yet */
    });
    await clearToast(pg);
    await pg.evaluate(() => goNewVisitForPatient()); await pg.waitForTimeout(700);
    const full = await state(pg, 'DOCTOR EDIT FULL');
    const fullSaid = await pg.evaluate(() => window.__toasts.map((x) => x[0]).join(' | '));
    await pg.evaluate(() => { Storage.prototype.setItem = window.__realSetItem; window.saveNoteToBackend = window.__realBackend; });
    assert.strictEqual(full.withEdit, 0, 'full device: the note is not in History');
    assert.ok(!/Saved the unfinished/.test(fullSaid), 'full device: no "Saved ... to History" claim: ' + fullSaid);
    assert.match(full.toast, /^The unfinished note was not saved to History on this device\. It is kept in this tab\. Go to the top of the Visit screen to restore it\./, 'full device: the doctor is told plainly: ' + full.toast);
    assert.ok(full.slot && full.slotHasEdit && onScreen(await offer(pg)), 'full device: the text is kept in the tab and offered on screen: ' + JSON.stringify(full));
    await pg.locator('#_visitRestoreBar button', { hasText: 'Discard' }).click(); await pg.waitForTimeout(400);

    /* orders alone that cannot be saved (an imaging order with no Indication)
       are kept, not cleared */
    await pg.evaluate(() => goNewVisitForPatient()); await pg.waitForTimeout(400);
    await pg.evaluate(() => { currentOrders.push({ id: 'o-syn-1', type: 'imaging', fields: { study: 'MRI', region: 'Lumbar spine' }, _source: 'provider-entered', _reviewStatus: 'accepted' }); renderVisitOrders(); });
    await clearToast(pg);
    const rowsBefore = await pg.evaluate(() => getNotes().length);
    await pg.evaluate(() => goNewVisitForPatient()); await pg.waitForTimeout(700);
    const ord = await pg.evaluate(() => ({ rows: getNotes().length, now: currentOrders.length, slot: (JSON.parse(sessionStorage.getItem(uns('visitDraft')) || '{}').orders || []).length,
      toast: (window.__toasts[window.__toasts.length - 1] || [''])[0] }));
    assert.strictEqual(ord.rows, rowsBefore, 'the incomplete order was not saved to History');
    assert.strictEqual(ord.now, 0, 'New visit started with no orders');
    assert.strictEqual(ord.slot, 1, 'the order is kept in the tab: ' + JSON.stringify(ord));
    assert.match(ord.toast, /^MLS could not save these orders to History\. They are kept in this tab\. Go to the top of the Visit screen to restore them\./, 'and the doctor is told: ' + ord.toast);
    const oOffer = await offer(pg);
    assert.ok(onScreen(oOffer) && /unsaved orders for Ada Sample/.test(oOffer.text), 'the kept orders are offered on screen: ' + JSON.stringify(oOffer));
    await pg.locator('#_visitRestoreBar button', { hasText: 'Restore it' }).click(); await pg.waitForTimeout(500);
    assert.deepStrictEqual(await pg.evaluate(() => currentOrders.map((o) => o.type + ':' + o.fields.study)), ['imaging:MRI'], 'Restore brings the order back to finish it');
    await pg.evaluate(() => { currentOrders = []; renderVisitOrders(); newVisit({ patientSwitchReset: true }); });

    /* a door that toasts right after starting the visit: the calendar's start
       for the patient already on screen */
    await toEditedNote(pg, 'DOCTOR EDIT CALENDAR');
    await clearToast(pg);
    /* the appointment carries the chart's MRN, so it resolves to Ada Sample, who is already open */
    const cal = await pg.evaluate(() => { const p = findPatient('syn-0'); Object.assign(window._calAppts[0], { dob: p.dob, mrn: p.mrn }); return calStartVisit('appt-0'); });
    await pg.waitForTimeout(500);
    const calState = await state(pg, 'DOCTOR EDIT CALENDAR');
    assert.ok(cal && cal.ok && cal.reason === 'exact-patient' && calState.withEdit === 1, 'the calendar start for the patient on screen saved the unfinished note: ' + JSON.stringify({ cal, calState }));
    assert.match(calState.toast, /^Started a visit for Ada Sample\. Saved the unfinished note to Ada Sample.s history\. Go to History to finish it\./,
      'the calendar\'s own message keeps what happened to the unfinished note: ' + calState.toast);

    /* New visit while the note is still being generated: the stopped
       generation's message keeps it too */
    await pg.evaluate(async (t) => {
      window.__aiDelay = 4000;
      const tr = document.getElementById('transcript'); tr.value = t; tr.dispatchEvent(new Event('input', { bubbles: true }));
      window.__genRun = generateNote().catch(() => null);
      await new Promise((r) => setTimeout(r, 500));
    }, 'Doctor: Neck pain for two weeks after lifting. Patient: it is worse turning my head to the right. Exam shows paraspinal tenderness.');
    await clearToast(pg);
    await pg.evaluate(() => goNewVisitForPatient());
    await pg.waitForTimeout(1500);
    const gen = await pg.evaluate(() => ({ said: window.__toasts.map((x) => x[0]), rows: getNotes().filter((n) => /Neck pain for two weeks/.test(n.transcript || '')).length }));
    await pg.evaluate(() => { window.__aiDelay = 60; });
    assert.strictEqual(gen.rows, 1, 'the transcript of the visit being generated was saved: ' + JSON.stringify(gen));
    const genLast = gen.said[gen.said.length - 1] || '';
    assert.ok(gen.said.some((m) => /^You started a new visit, so MLS stopped writing the note it was generating\. Saved the unfinished transcript to Ada Sample.s history\. Go to History to finish it\./.test(m)),
      'the stopped generation says so and keeps where the transcript went: ' + JSON.stringify(gen.said));
    assert.match(genLast, /Saved the unfinished transcript to Ada Sample.s history\. Go to History to finish it\./, 'the last message still says where the transcript went: ' + JSON.stringify(gen.said));

    /* the owner gate refuses (the previous patient's text is still on screen
       under a newly active patient, no binding): the kept draft stays theirs */
    await toEditedNote(pg, 'DOCTOR EDIT OWNER');
    await pg.evaluate(() => { _athenaSetVisitBinding(null, true); window.__mlsVisitEditorOwnerId = 'syn-0'; });
    await pg.waitForTimeout(1200);
    await pg.evaluate(() => { localStorage.setItem(uns('activePt'), 'syn-1'); });
    await clearToast(pg);
    await pg.evaluate(() => newVisit()); await pg.waitForTimeout(600);
    const own = await pg.evaluate(() => { const d = JSON.parse(sessionStorage.getItem(uns('visitDraft')) || '{}');
      return { ptId: d.ptId, pt: d.pt, hasEdit: String(d.soap || '').indexOf('DOCTOR EDIT OWNER') >= 0, foreignRows: getNotes().filter((n) => n.patientId === 'syn-1').length }; });
    const oBar = await offer(pg);
    assert.strictEqual(own.foreignRows, 0, 'nothing was saved onto the newly active chart');
    assert.ok(own.hasEdit && own.ptId === 'syn-0' && own.pt === 'Ada Sample', 'the kept draft still belongs to the previous patient: ' + JSON.stringify(own));
    assert.ok(onScreen(oBar) && /different patient/.test(oBar.text) && oBar.button === 'Open Ada Sample', 'and the offer says whose it is, instead of restoring it here: ' + JSON.stringify(oBar));
    await pg.locator('#_visitRestoreBar button', { hasText: 'Discard' }).click(); await pg.waitForTimeout(300);
    await pg.context().close();

    /* ---- phone: header "+" > New visit ----------------------------------- */
    const ph = await boot(PHONE);
    const pBefore = await toEditedNote(ph, 'PHONE EDIT');
    assert.ok(pBefore.note > 200 && pBefore.edited, 'phone: a generated, edited note is on screen');
    const phoneNew = async () => {
      await ph.evaluate(() => window.scrollTo(0, 0)); await ph.waitForTimeout(300);
      await ph.tap('#mlsRdNewBtn'); await ph.waitForTimeout(500);
      await ph.tap('#mlsRdNewMenu button:has-text("New visit")'); await ph.waitForTimeout(700);
    };
    await phoneNew();
    const phone = await state(ph, 'PHONE EDIT');
    assert.strictEqual(phone.withEdit, 1, 'phone: New visit saved the edited note to the patient\'s History: ' + JSON.stringify(phone));
    assert.deepStrictEqual([phone.note, phone.transcript], [0, 0], 'phone: and then started an empty visit');
    assert.match(phone.toast, /^Saved the unfinished note to Ada Sample.s history\./, 'phone: the doctor is told on screen: ' + JSON.stringify(phone));
    /* phone, refused save: the offer is on screen too */
    await toEditedNote(ph, 'PHONE EDIT REFUSED');
    await ph.evaluate(() => {
      _athenaSetVisitBinding(_athenaFreezeVisitBinding({ name: 'Recovered unassigned draft' }, { source: 'legacy-restored-draft', historical: false, routeBlocked: true }), true);
    });
    await phoneNew();
    const pRef = await state(ph, 'PHONE EDIT REFUSED');
    const pOffer = await offer(ph);
    assert.ok(pRef.slotHasEdit && /^MLS could not save the unfinished note to History\. It is kept in this tab/.test(pRef.toast), 'phone: a refused save is kept and said on screen: ' + JSON.stringify(pRef));
    assert.ok(onScreen(pOffer) && pOffer.button === 'Restore it', 'phone: the offer is on screen above the workspace: ' + JSON.stringify(pOffer));
    await ph.locator('#_visitRestoreBar button', { hasText: 'Restore it' }).tap(); await ph.waitForTimeout(600);
    assert.ok(await ph.evaluate(() => document.getElementById('noteBox').value.indexOf('PHONE EDIT REFUSED') >= 0), 'phone: Restore brings the note back');

    assert.deepStrictEqual(errs, [], 'no page errors: ' + errs.join(' | '));
    console.log('PASS new visit keeps the unsaved note: every door saves it to the patient\'s History and says so (also through the calendar\'s and a stopped generation\'s own messages), an empty editor or a just-saved note (with or without a visit comment) adds nothing, and work that cannot be saved (refused, a full device, incomplete orders, another patient\'s editor) is kept in the tab and offered back on screen on desktop and phone, surviving the next visit\'s typing');
  } finally { await b.close(); srv.close(); }
});
