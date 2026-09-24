'use strict';
/* Controls say what they do (uifix-1.0.0, 2026-09-24). Found by the real-Chrome
   audit of every screen outside Visit and Settings, on the signed-in 1p shell,
   desktop 1400x900 and phone 390x844:
   C1  the "Today" date wore the card, border, shadow and pill of the buttons
       beside it and did nothing when pressed;
   C7  "Recent" sat disabled at opacity .55 on every screen until a second
       chart had been opened;
   C20 Tools > Pre-visit intake forms hid every chart and started the
       password-locked patient kiosk at once, with no word of it;
   C31 Export everything for EMR said "Full chart exported - note, problems,
       meds, allergies & coding" for a patient with nothing recorded;
   C33 Add a visit, for a chart that exists, showed five demographic boxes and
       two submit buttons ("Add this visit" and "Save visit"); Save now takes a
       typed visit, and a form still holding only its automatic defaults
       (today's date, the last visit type) is refused as before, for Add a
       visit and for a new patient alike;
   C56 the phone menu's "This iPhone" opened Settings on Account & security and
       toasted a path to follow;
   C58 the "needs attention" chip drew over the phone app;
   C61 the Confirm password placeholder read "At least 8 characters";
   C62 the optional first-run step showed as a red error and counted in "of 4";
   C63 "Pull your first day" was ticked with no pull made;
   C64 the Tools label "Troubleshoot Athena" broke as "Troublesho / ot".
   Every failure is collected and reported by id. Real Chrome; nothing leaves
   127.0.0.1 (other hosts get a small JSON stub or a 503). */
const http = require('http'), fs = require('fs'), path = require('path');
const assert = require('assert');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const T = fs.readFileSync(path.join(__dirname, '1p-clunky-contract.test.js'), 'utf8');
const HARNESS = '(' + T.slice(T.indexOf('function harness() {'), T.indexOf('async function boot(page, port)')).trim() + ')()';
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' };
const DESK = { viewport: { width: 1400, height: 900 } };
const NOTE = 'HPI: Low back pain radiating to the right leg for 6 weeks.\nASSESSMENT: Right L5 radiculopathy (M54.16).\nPLAN: Home exercise. Follow up in 2 weeks.';
const USER = { id: 'harness', email: 'ui-harness@mlsscribe.test', role: 'doctor', name: 'Sample Provider, MD', premium: true, hasAccess: true, agreements: { required: false, signerComplete: true } };

/* A signed-in session needs a few backend answers to draw its screens. */
function backendAnswer(url) {
  const u = String(url);
  if (/\/api\/me(\?|$)/.test(u) || /\/api\/auth\/me\b/.test(u)) return { user: Object.assign({ access: 'premium', totp_enabled: false }, USER) };
  if (/\/api\/auth\/2fa\/status/.test(u)) return { enabled: false };
  if (/\/api\/keys\b/.test(u)) return { keys: [] };
  if (/\/api\/emr-sync\/settings/.test(u)) return { enabled: false, hour: 2, includeHistory: true, connected: false };
  if (/\/api\/avatar\/checkins/.test(u)) return { ok: true, checkins: [] };
  if (/\/api\/health\b/.test(u)) return { ok: true };
  if (/\/api\/agreements\/me(\?|$)/.test(u)) return { signed: true, version: '2026-06-10' };
  if (/\/api\/prefs(\?|$)/.test(u)) return { prefs: {} };
  return null;
}

const failures = [];
function check(id, ok, msg) { if (!ok) failures.push(id + ': ' + msg); }

const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'content-type': ({ '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json' })[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(f).pipe(r);
}).listen(0, '127.0.0.1', async () => {
  const b = await chromium.launch({ args: ['--no-sandbox'] });
  const errs = [];
  const boot = async (ctxOpts) => {
    const ctx = await b.newContext(ctxOpts);
    await ctx.addInitScript(() => { try { sessionStorage.setItem('sf_session', 'ui-harness@mlsscribe.test'); sessionStorage.setItem('sf_bk_token', 'harness-token'); } catch (e) {} });
    const pg = await ctx.newPage();
    pg.on('pageerror', (e) => errs.push(String(e.message).slice(0, 160)));
    await pg.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => {
      const ans = backendAnswer(r.request().url());
      return ans ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ans) }) : r.fulfill({ status: 503, body: 'x' });
    });
    await pg.goto('http://127.0.0.1:' + srv.address().port + '/1pScribeFlow.html', { waitUntil: 'load', timeout: 90000 });
    await pg.waitForTimeout(2500);
    await pg.evaluate(() => (typeof window.__mlsEnsureUiBundle === 'function' ? window.__mlsEnsureUiBundle() : null));
    await pg.waitForFunction(() => !!window.__mlsSimpleLayer, null, { timeout: 60000 });
    await pg.waitForTimeout(4000);
    await pg.evaluate((user) => {
      const a = document.getElementById('authScreen'); if (a) a.style.display = 'none';
      const s = document.getElementById('appScreen'); if (s) s.style.display = '';
      window.__mlsHarnessAccountEmail = 'ui-harness@mlsscribe.test';
      try { sessionStorage.setItem('sf_bk_token', 'harness-token'); } catch (e) {}
      try { bkUser = user; } catch (e) {}
      try { window.__mlsDeferAsset = function (fn) { return setTimeout(fn, 0); }; } catch (e) {}
      try { window.dispatchEvent(new Event('mls:loader-ready')); } catch (e) {}
      try { if (window.__mlsP1CalmDock && typeof window.__mlsP1CalmDock.ensure === 'function') window.__mlsP1CalmDock.ensure(); } catch (e) {}
    }, USER);
    await pg.waitForTimeout(2500);
    await pg.evaluate(() => { try { if (window.__mlsCalmShell && typeof window.__mlsCalmShell.boot === 'function') window.__mlsCalmShell.boot(); } catch (e) {} });
    await pg.evaluate(HARNESS);
    await pg.evaluate(() => window.__clunky.seed());
    await pg.evaluate((note) => {
      window.aiCallRaw = function () { return Promise.resolve(note); };
      window.__said = [];
      const t0 = window.toast;
      window.toast = function (m, k) { window.__said.push(String(m)); return t0 && t0.apply(this, arguments); };
    }, NOTE);
    await pg.evaluate(() => { try { window.__mlsPatientLock.switchAsDoctor('syn-0'); } catch (e) {} });
    await pg.waitForTimeout(800);
    /* A real session raises the first-run prompts over everything; answer them. */
    for (let i = 0; i < 40; i++) {
      const left = await pg.evaluate(() => {
        const vis = (x) => x && x.offsetParent;
        const btns = [...document.querySelectorAll('button')];
        const fast = btns.find((x) => /Use faster day-only pulls/.test(x.textContent) && vis(x)); if (fast) fast.click();
        const mine = btns.find((x) => /^No, it is mine$/.test(x.textContent.trim()) && vis(x)); if (mine) mine.click();
        const later = btns.find((x) => /^Later$/.test(x.textContent.trim()) && vis(x) && /MLS Assist is not installed/.test(((x.parentElement && x.parentElement.parentElement) || x).textContent)); if (later) later.click();
        return !!(fast || mine || later);
      });
      if (!left && i > 6) break;
      await pg.waitForTimeout(400);
    }
    return pg;
  };
  const center = (pg, sel) => pg.evaluate((s) => { const e = typeof s === 'string' ? document.querySelector(s) : null; if (!e) return null; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return r.width ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null; }, sel);
  const openTools = async (pg) => {
    for (let k = 0; k < 3; k++) {
      if (await pg.evaluate(() => !!document.querySelector('#mlsToolsMenu .r'))) return true;
      const c = await center(pg, '#mlsDock button[data-dest="tools"]');
      if (c) await pg.mouse.click(c.x, c.y);
      await pg.waitForTimeout(700);
    }
    return false;
  };
  const pressTool = async (pg, re) => {
    if (!(await openTools(pg))) return false;
    const c = await pg.evaluate((src) => {
      const x = [...document.querySelectorAll('#mlsToolsMenu .r')].find((r) => new RegExp(src).test(r.textContent));
      if (!x) return null; x.scrollIntoView({ block: 'center' }); const r = x.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, re.source);
    if (!c) return false;
    await pg.mouse.click(c.x, c.y);
    return true;
  };
  try {
    const pg = await boot(DESK);
    await pg.evaluate(() => { try { showView('visit'); } catch (e) {} });
    await pg.waitForTimeout(800);

    /* C1: the date is text, not a button-shaped pill */
    const today = await pg.evaluate(() => {
      const t = document.getElementById('mslToday'); if (!t) return null; const cs = getComputedStyle(t);
      return { text: t.textContent, bg: cs.backgroundColor, border: parseFloat(cs.borderTopWidth) || 0, shadow: cs.boxShadow };
    });
    check('C1', today && /Today/.test(today.text), 'the date label is on the header: ' + JSON.stringify(today));
    check('C1', today && /rgba\(0, 0, 0, 0\)|transparent/.test(today.bg) && today.border === 0 && today.shadow === 'none',
      'the date label has no card background, border or shadow, so it does not read as a button: ' + JSON.stringify(today));

    /* C7: Recent is not on screen until there is a chart to go back to */
    const recent0 = await pg.evaluate(() => { const w = document.getElementById('mlsRecentPts'); return { mounted: !!w, shown: !!(w && w.getClientRects().length && getComputedStyle(w).display !== 'none') }; });
    check('C7', !recent0.shown, 'Recent is not shown before a second chart has been opened: ' + JSON.stringify(recent0));
    await pg.evaluate(async () => { window.__mlsPatientLock.switchAsDoctor('syn-1'); await new Promise((r) => setTimeout(r, 500)); window.__mlsPatientLock.switchAsDoctor('syn-0'); });
    await pg.waitForTimeout(1200);
    const recent1 = await pg.evaluate(() => { const w = document.getElementById('mlsRecentPts'); const btn = w && w.querySelector('.mrp-btn'); return { shown: !!(w && w.getClientRects().length && getComputedStyle(w).display !== 'none'), text: btn ? btn.textContent : '', disabled: !!(btn && btn.disabled) }; });
    check('C7', recent1.shown && /Recent \(1\)/.test(recent1.text) && !recent1.disabled, 'Recent appears, enabled, once a second chart was opened: ' + JSON.stringify(recent1));

    /* C64: no Tools label breaks inside a word */
    const opened = await openTools(pg);
    check('C64', opened, 'the Tools menu opens');
    const split = await pg.evaluate(() => {
      const out = [];
      document.querySelectorAll('#mlsToolsMenu .r .rn').forEach((n) => {
        const node = [...n.childNodes].find((c) => c.nodeType === 3); if (!node) return;
        const re = /\S+/g; let m;
        while ((m = re.exec(node.nodeValue))) {
          const range = document.createRange(); range.setStart(node, m.index); range.setEnd(node, m.index + m[0].length);
          const tops = new Set([...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top)));
          if (tops.size > 1) out.push(m[0] + ' in "' + node.nodeValue + '"');
        }
      });
      return { out, n: document.querySelectorAll('#mlsToolsMenu .r .rn').length, has: [...document.querySelectorAll('#mlsToolsMenu .r .rn')].some((x) => /Troubleshoot Athena/.test(x.textContent)) };
    });
    check('C64', split.n > 5 && split.has, 'the Tools menu lists its rows, Troubleshoot Athena among them: ' + JSON.stringify(split));
    check('C64', split.out.length === 0, 'no Tools label is broken inside a word: ' + JSON.stringify(split.out));
    await pg.keyboard.press('Escape'); await pg.waitForTimeout(300);

    /* C31: the export says what the file holds */
    await pg.evaluate(() => {
      window.__dl = [];
      const o = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () { if (this.download) { window.__dl.push(this.download); return; } return o.apply(this, arguments); };
      window.__said = [];
    });
    const exp0 = await pressTool(pg, /Export everything/);
    await pg.waitForTimeout(700);
    const said0 = await pg.evaluate(() => ({ said: window.__said.slice(), dl: window.__dl.slice(), notes: patientNotes('syn-0').length }));
    check('C31', exp0 && said0.dl.length === 1, 'Export everything for EMR downloads one file: ' + JSON.stringify(said0));
    const line0 = said0.said.join(' | ');
    check('C31', said0.notes === 0 && !/Full chart exported|note, problems, meds/.test(line0) && /no visit notes, problems, medicines or allergies/.test(line0),
      'for a chart with nothing recorded, the export says so instead of "Full chart exported": ' + line0);
    await pg.evaluate(() => { const p = getPatients().find((x) => x.id === 'syn-0'); p.problems = 'Lumbar radiculopathy'; p.meds = 'Gabapentin 300 mg'; upsertPatient(p); window.__said = []; });
    await pressTool(pg, /Export everything/);
    await pg.waitForTimeout(700);
    const line1 = (await pg.evaluate(() => window.__said.slice())).join(' | ');
    check('C31', /problems and medicines/.test(line1) && /Not recorded yet: visit notes and allergies/.test(line1), 'the export names what it holds and what it does not: ' + line1);
    /* counted the way the file writes them: a draft with no note is exported as
       "[Transcript only - no note generated]", and the patient summary is exported */
    const line2 = await pg.evaluate(() => {
      const real = window.patientNotes;
      try {
        window.patientNotes = () => [{ isDraft: true, transcript: 'Doctor and patient talked.' }, { isDraft: false, soap: 'ASSESSMENT: Lumbar radiculopathy.' }];
        return _fullEmrExportSaid({ name: 'Ada Sample', problems: '', meds: '', allergies: '', summary: 'Lumbar radiculopathy, improving with therapy.' }, false);
      } finally { window.patientNotes = real; }
    });
    check('C31', /: 1 visit note, 1 transcript with no note written yet and the patient summary\./.test(line2) && /Not recorded yet: problems, medicines and allergies\./.test(line2),
      'transcript-only drafts are not counted as visit notes, and the summary is named: ' + line2);
    const line3 = await pg.evaluate(() => _fullEmrExportSaid({ name: 'Ada Sample', summary: 'Chronic low back pain.' }, false));
    check('C31', !/only the patient/.test(line3) && /the patient summary/.test(line3), 'a chart with only a summary is not called details-only: ' + line3);

    /* C33: Add a visit for an existing chart names the chart and has one Save.
       A visit type was used before, so the form opens with today's date and
       that type already filled in - defaults, not a visit the doctor typed. */
    await pg.evaluate(() => {
      window.__said = [];
      const k = typeof window.uns === 'function' ? window.uns('mlsEaseLastVisitType') : 'mls::mlsEaseLastVisitType';
      try { localStorage.setItem(k, 'Lumbar MBB'); } catch (e) {}
    });
    const addPressed = await pressTool(pg, /Add a visit/);
    await pg.waitForTimeout(1200);
    const av = await pg.evaluate(() => {
      const m = document.getElementById('mlsAddPtModal'); if (!m) return null;
      const vis = (e) => !!(e && e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden');
      return {
        title: ((m.querySelector('.ap-hd h3') || {}).textContent || ''),
        boxes: ['apName', 'apDob', 'apMrn', 'apSex', 'apPhone'].filter((id) => vis(document.getElementById(id))),
        who: ((m.querySelector('.mlsease-who') || {}).textContent || ''),
        buttons: [...m.querySelectorAll('button')].filter(vis).map((x) => x.textContent.trim())
      };
    });
    check('C33', addPressed && av && /Add visit/.test(av.title), 'Tools > Add a visit opens the add-visit window: ' + JSON.stringify(av));
    check('C33', av && av.boxes.length === 0 && /Ada Sample/.test(av.who), 'the existing chart is named in one line, with no demographic boxes to fill: ' + JSON.stringify(av));
    check('C33', av && !av.buttons.some((t) => /Add this visit/.test(t)) && av.buttons.filter((t) => /Save visit/.test(t)).length === 1, 'there is one Save, not "Add this visit" and "Save visit": ' + JSON.stringify(av && av.buttons));
    if (av) {
      const before = await pg.evaluate(() => { const p = getPatients().find((x) => x.id === 'syn-0'); return window.__mlsVisitModel.getVisits(p).length; });
      /* negative: Save on the untouched form adds nothing and says what is missing */
      const prefilled = await pg.evaluate(() => ({ date: (document.getElementById('apgDate') || {}).value || '', type: (document.getElementById('apgType') || {}).value || '' }));
      const save0 = await center(pg, '#apSave');
      if (save0) await pg.mouse.click(save0.x, save0.y);
      await pg.waitForTimeout(1500);
      const untouched = await pg.evaluate(() => { const p = getPatients().find((x) => x.id === 'syn-0'); const st = document.getElementById('apStatus'); return { n: window.__mlsVisitModel.getVisits(p).length, open: !!document.getElementById('mlsAddPtModal'), status: st ? st.textContent : '(closed)' }; });
      check('C33', !!prefilled.date && prefilled.type === 'Lumbar MBB', 'the add-visit form opens with its automatic defaults (today, the last visit type): ' + JSON.stringify(prefilled));
      check('C33', untouched.n === before && untouched.open && /Add at least one visit/.test(untouched.status),
        'Save visit on the untouched form writes no visit and keeps the "Add at least one visit" refusal: ' + JSON.stringify({ prefilled, before, untouched }));
      /* positive: a typed visit is saved by the one Save press (only reachable
         while the refusal kept the window open) */
      if (untouched.open) {
        await pg.fill('#apgType', 'Lumbar transforaminal ESI');
        const save = await center(pg, '#apSave');
        if (save) await pg.mouse.click(save.x, save.y);
        await pg.waitForTimeout(2500);
        const after = await pg.evaluate(() => { const p = getPatients().find((x) => x.id === 'syn-0'); const st = document.getElementById('apStatus'); return { n: window.__mlsVisitModel.getVisits(p).length, status: st ? st.textContent : '(closed)' }; });
        check('C33', after.n === before + 1 && !/Add at least one visit/.test(after.status), 'Save visit saves the typed visit into the chart in one press: ' + JSON.stringify({ before, after }));
      }
      await pg.evaluate(() => { const c = document.getElementById('apCancel'); if (c) c.click(); });
      await pg.waitForTimeout(300);
    }

    /* C33 negative, new patient: a name and date of birth with the visit
       fields left at their defaults creates no patient and no visit */
    await pg.evaluate(() => { const c = document.getElementById('apCancel'); if (c) c.click(); window.__mlsAddPatient.open(); });
    await pg.waitForTimeout(1200);
    const np0 = await pg.evaluate(() => ({ n: getPatients().length, open: !!document.getElementById('mlsAddPtModal'), date: (document.getElementById('apgDate') || {}).value || '' }));
    if (np0.open) {
      await pg.fill('#apName', 'Quinn Untouchedform');
      await pg.fill('#apDob', '01/02/1970');
      const save1 = await center(pg, '#apSave');
      if (save1) await pg.mouse.click(save1.x, save1.y);
      await pg.waitForTimeout(1500);
    }
    const np1 = await pg.evaluate(() => { const st = document.getElementById('apStatus'); return { n: getPatients().length, made: getPatients().some((p) => /Untouchedform/.test(p.name || '')), open: !!document.getElementById('mlsAddPtModal'), status: st ? st.textContent : '(closed)' }; });
    check('C33', np0.open && !!np0.date && np1.n === np0.n && !np1.made && np1.open && /Add at least one visit/.test(np1.status),
      'New patient with the visit form untouched is refused with "Add at least one visit" and creates nothing: ' + JSON.stringify({ np0, np1 }));
    await pg.evaluate(() => { const c = document.getElementById('apCancel'); if (c) c.click(); });
    await pg.waitForTimeout(300);

    /* C20: the patient kiosk asks first and says how to get back */
    await pressTool(pg, /Pre-visit intake/);
    await pg.waitForTimeout(700);
    const ask = await pg.evaluate(() => ({ kiosk: (document.getElementById('intakeView') || { style: {} }).style.display === 'block', app: getComputedStyle(document.getElementById('appScreen')).display !== 'none', msg: ((document.getElementById('_mlsAskMsg') || {}).textContent || '') }));
    check('C20', !ask.kiosk && ask.app, 'the press does not start the kiosk on its own: ' + JSON.stringify(ask));
    check('C20', /patient/i.test(ask.msg) && /Staff: exit/.test(ask.msg) && /password/.test(ask.msg), 'the confirm says what happens and how to get back: ' + JSON.stringify(ask.msg));
    const no = await center(pg, '#_mlsAskNo');
    if (no) { await pg.mouse.click(no.x, no.y); await pg.waitForTimeout(400); }
    check('C20', await pg.evaluate(() => (document.getElementById('intakeView') || { style: {} }).style.display !== 'block'), 'Cancel leaves the doctor in MLS');
    await pressTool(pg, /Pre-visit intake/);
    await pg.waitForTimeout(700);
    const yes = await center(pg, '#_mlsAskYes');
    if (yes) { await pg.mouse.click(yes.x, yes.y); await pg.waitForTimeout(500); }
    check('C20', await pg.evaluate(() => (document.getElementById('intakeView') || { style: {} }).style.display === 'block' && getComputedStyle(document.getElementById('appScreen')).display === 'none'),
      'confirming starts the patient intake');
    await pg.evaluate(() => { const v = document.getElementById('intakeView'); if (v) v.style.display = 'none'; document.getElementById('appScreen').style.display = ''; });

    /* C62 + C63: the first-run checklist counts what MLS needs and ticks only a real pull */
    const fr = await pg.evaluate(async () => {
      if (!window.__mlsFirstRun) {
        await new Promise((res) => { const s = document.createElement('script'); s.src = 'feat_mls_firstrun.js'; s.onload = res; s.onerror = res; document.body.appendChild(s); });
      }
      try { sessionStorage.removeItem('mls_fr_shown'); localStorage.removeItem(uns('firstRunDone')); } catch (e) {}
      try { showView('visit'); } catch (e) {}
      await new Promise((r) => setTimeout(r, 300));
      const ok = window.__mlsFirstRun && window.__mlsFirstRun.ensure();
      await new Promise((r) => setTimeout(r, 300));
      const row = (k) => { const x = document.getElementById('mlsFrRow_' + k); if (!x) return null; const mark = getComputedStyle(x.querySelector('.mlsfr-mark')); return { cls: x.className, text: x.innerText.replace(/\s+/g, ' '), markBorder: mark.borderTopColor }; };
      return { ok, calRows: (window._calAppts || []).length, title: ((document.getElementById('mlsFrTitle') || {}).textContent || ''), day: row('day'), tuning: row('tuning') };
    });
    check('C63', fr.ok && fr.day, 'the first-run checklist is on the Visit page: ' + JSON.stringify(fr));
    check('C63', fr.calRows > 0 && fr.day && !/\bok\b/.test(fr.day.cls), 'calendar rows alone do not tick "Pull your first day": ' + JSON.stringify(fr.day));
    check('C62', fr.tuning && !/\bbad\b/.test(fr.tuning.cls) && fr.tuning.markBorder !== 'rgb(180, 71, 46)' && /optional/i.test(fr.tuning.text), 'the optional step is labelled optional and not shown as an error: ' + JSON.stringify(fr.tuning));
    check('C62', /of 3 done/.test(fr.title), 'the count is of the steps MLS needs, not the optional one: ' + fr.title);

    /* C61: the confirm field asks for the same password again */
    const pw = await pg.evaluate(() => { const a = document.getElementById('authScreen'); a.style.display = ''; document.getElementById('appScreen').style.display = 'none'; switchAuth('signup'); const c = document.getElementById('authPass2'); return { ph: c.placeholder, shown: !!c.getClientRects().length }; });
    check('C61', pw.shown && !/At least 8/.test(pw.ph) && /same password/i.test(pw.ph), 'the Confirm password placeholder asks for the same password again: ' + JSON.stringify(pw));

    /* ---- phone ---- */
    const ph = await boot(PHONE);
    await ph.waitForTimeout(1500);
    const shell = await ph.evaluate(() => { const f = document.getElementById('mlsPh3'); return !!(f && f.getClientRects().length && document.body.classList.contains('mls-ph3')); });
    check('C56', shell, 'the phone app is on screen');

    /* C58: the desktop progress chip never draws over the phone app */
    await ph.waitForFunction(() => !!document.getElementById('mlsPsChip'), null, { timeout: 15000 }).catch(() => {});
    const chip = await ph.evaluate(() => {
      const c = document.getElementById('mlsPsChip'); if (!c) return null;
      c.classList.add('on');
      const cs = getComputedStyle(c);
      const hits = [];
      for (let y = 60; y < innerHeight; y += 40) for (let x = 20; x < innerWidth; x += 60) { const t = document.elementFromPoint(x, y); if (t && c.contains(t)) hits.push(x + ',' + y); }
      return { display: cs.display, hits: hits.length, text: c.textContent };
    });
    check('C58', chip && chip.display === 'none' && chip.hits === 0, 'the "needs attention" chip is not drawn over the phone app: ' + JSON.stringify(chip));

    /* C56: "This iPhone" lands on the device setting */
    const nav = await center(ph, '#mlsPh3Nav');
    if (nav) await ph.mouse.click(nav.x, nav.y);
    await ph.waitForTimeout(700);
    await ph.evaluate(() => { window.__said = []; });
    const item = await center(ph, '#mlsPh3Sheet .ph3-item[data-act="device"]');
    const sub = await ph.evaluate(() => { const i = document.querySelector('#mlsPh3Sheet .ph3-item[data-act="device"]'); return i ? i.textContent : ''; });
    check('C56', !/Settings →/.test(sub), 'the menu item does not print a path to follow: ' + sub);
    if (item) await ph.mouse.click(item.x, item.y);
    await ph.waitForFunction(() => { const c = document.getElementById('mlsDrCard'); return !!(c && c.getClientRects().length); }, null, { timeout: 12000 }).catch(() => {});
    await ph.waitForTimeout(800);
    const dev = await ph.evaluate(() => {
      const m = document.getElementById('settingsModal'), card = document.getElementById('mlsDrCard');
      const vis = !!(card && card.getClientRects().length && getComputedStyle(card).display !== 'none');
      let inView = false; if (vis) { const r = card.getBoundingClientRect(); inView = r.top >= 0 && r.top < innerHeight - 40; }
      return { open: !!(m && m.classList.contains('show')), vis, inView, group: ((document.querySelector('#settingsTabBar [aria-selected="true"]') || {}).textContent || '').trim(), said: window.__said.slice() };
    });
    check('C56', dev.open && dev.vis && dev.inView, '"This iPhone" opens Settings with the device card on screen: ' + JSON.stringify(dev));
    check('C56', !dev.said.some((s) => /Settings → Integrations → This device/.test(s)), 'it goes there instead of printing directions: ' + JSON.stringify(dev.said));

    check('errors', errs.length === 0, 'no page errors: ' + errs.join(' | '));
    assert.deepStrictEqual(failures, [], 'controls say what they do:\n  ' + failures.join('\n  '));
    console.log('PASS controls say what they do: the date is text, Recent waits for a chart, the kiosk asks first, the export names what it holds, Add visit has one Save for a named chart and refuses a form left at its defaults, This iPhone lands on its setting, no chip over the phone app, the confirm-password hint is right, first-run counts only needed steps and a real pull, and Tools labels break between words');
  } finally { await b.close(); srv.close(); }
});
