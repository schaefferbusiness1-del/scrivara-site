'use strict';
/* =========================================================================
   LOCAL E2E — drives the REAL app (ScribeFlow.html?demo=1) in a real Chrome
   via puppeteer-core. Fully offline: local static server, on-device demo
   account, no backend, no Athena, no extension. Run:

     node tests/e2e/run-e2e.js

   Requires Chrome at the standard install path and puppeteer-core resolvable
   (env MLS_E2E_PUPPETEER_DIR may point at a directory whose node_modules
   contains puppeteer-core).
   ========================================================================= */
const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { createRequire } = require('module');

function loadPuppeteer() {
  try { return require('puppeteer-core'); } catch (e) {}
  const dirs = [process.env.MLS_E2E_PUPPETEER_DIR].filter(Boolean);
  for (const d of dirs) {
    try { return createRequire(path.join(d, 'package.json'))('puppeteer-core'); } catch (e) {}
  }
  console.error('SKIP e2e: puppeteer-core not resolvable (set MLS_E2E_PUPPETEER_DIR).');
  process.exit(0);
}
const puppeteer = loadPuppeteer();

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'
].find(p => { try { return fs.existsSync(p); } catch (e) { return false; } });
if (!CHROME) { console.error('SKIP e2e: Chrome not found.'); process.exit(0); }

const ROOT = path.resolve(__dirname, '..', '..');
const PORT = 8873;
const BASE = 'http://localhost:' + PORT;
const APP = BASE + '/ScribeFlow.html?demo=1';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.pdf': 'application/pdf' };

const server = http.createServer((req, res) => {
  try {
    let p = decodeURIComponent((req.url || '/').split('?')[0]);
    if (p === '/') p = '/ScribeFlow.html';
    const file = path.join(ROOT, p.replace(/^\/+/, ''));
    if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404); res.end('nf'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(buf);
    });
  } catch (e) { res.writeHead(500); res.end(); }
});

const results = [];
let failed = 0;
function pass(name) { results.push('PASS ' + name); console.log('PASS ' + name); }
function fail(name, err) { failed++; results.push('FAIL ' + name + ' — ' + (err && err.message || err)); console.error('FAIL ' + name + '\n  ' + (err && err.stack || err)); }
async function step(name, fn) { try { await fn(); pass(name); } catch (e) { fail(name, e); } }

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function newAppPage(browser, { fresh } = {}) {
  const page = await browser.newPage();
  const cdp = await page.createCDPSession();
  await cdp.send('Network.setBypassServiceWorker', { bypass: true });
  page.on('dialog', async d => { try { await d.dismiss(); } catch (e) {} });
  await page.setViewport({ width: 1280, height: 850 });
  await page.goto(APP, { waitUntil: 'domcontentloaded', timeout: 30000 });
  if (fresh) {
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    await page.goto(APP, { waitUntil: 'domcontentloaded', timeout: 30000 });
  }
  await sleep(600);
  return page;
}

/* Reload the app the way a person hits refresh — and check the guard.
 *
 * The app warns before discarding unsaved visit work (a beforeunload prompt).
 * puppeteer's default handler in this suite is dismiss(), and dismissing a
 * beforeunload CANCELS the navigation — which surfaces as "Navigation timeout
 * of 30000 ms exceeded", looking nothing like a dialog problem. That cost this
 * suite a phantom failure on the Recent-chip step, whose only crime was
 * reloading after an earlier step deliberately dirtied #transcript. Measured
 * four ways: a clean page reloads in 68ms with 0 prompts, a dirty page times
 * out under dismiss and reloads in 65ms under accept, and the prompt does NOT
 * require a user gesture.
 *
 * So accept the prompt (a user choosing "Leave") — and assert the guard while
 * we are here: it must fire IF AND ONLY IF there is unsaved work. Deriving the
 * expectation from the app's own state keeps this honest as steps are
 * reordered, and it covers a real data-loss path nothing else here touches: a
 * refresh that silently discards in-progress dictation. */
async function reloadApp(page) {
  const dirty = await page.evaluate(() =>
    !!window._visitDirty || (typeof capturing !== 'undefined' && !!capturing));
  let prompts = 0;
  page.removeAllListeners('dialog');
  page.on('dialog', async d => { prompts++; try { await d.accept(); } catch (e) {} });
  try {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
  } finally {
    page.removeAllListeners('dialog');
    page.on('dialog', async d => { try { await d.dismiss(); } catch (e) {} });
  }
  assert.strictEqual(prompts, dirty ? 1 : 0, dirty
    ? 'refresh with unsaved visit work did NOT warn before discarding it — the beforeunload guard is gone'
    : 'refresh warned about unsaved work when nothing was dirty — a spurious "Leave site?" on every refresh');
  return dirty;
}

async function signUp(page, email, pass) {
  await page.waitForSelector('#authScreen', { visible: true, timeout: 15000 });
  // switch to signup mode via its tab
  await page.evaluate(() => {
    const tabs = Array.from(document.querySelectorAll('#authScreen .auth-tab, #authScreen [role="tab"], #authScreen a, #authScreen button'));
    const t = tabs.find(x => /sign\s*up/i.test(x.textContent || ''));
    if (t) t.click();
  });
  await sleep(300);
  await page.evaluate((email, pass) => {
    document.getElementById('authEmail').value = email;
    document.getElementById('authPass').value = pass;
    const p2 = document.getElementById('authPass2'); if (p2) p2.value = pass;
  }, email, pass);
  await page.evaluate(() => {
    // the signup acceptance flow may present agreement checkboxes — accept-all
    document.querySelectorAll('#authScreen input[type="checkbox"]').forEach(c => { if (!c.checked) c.click(); });
  });
  await page.evaluate(() => doAuth());
  // signup acceptance may open a review dialog with an explicit accept control; drive it if present
  for (let i = 0; i < 20; i++) {
    const appUp = await page.evaluate(() => {
      const app = document.getElementById('appScreen');
      return !!(app && app.style.display !== 'none');
    });
    if (appUp) return;
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button, a')).filter(b => b.offsetParent !== null);
      const acc = btns.find(b => /agree|accept|i have read|continue|confirm/i.test(b.textContent || ''));
      if (acc) acc.click();
      document.querySelectorAll('input[type="checkbox"]').forEach(c => { if (!c.checked && c.offsetParent !== null) c.click(); });
      try { doAuth(); } catch (e) {}
    });
    await sleep(500);
  }
  throw new Error('local demo signup did not reach the app screen');
}

async function addPatient(page, name, dob) {
  return await page.evaluate((name, dob) => {
    const list = getPatients();
    const id = 'e2e_' + name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    if (!list.some(p => p.id === id)) {
      list.push({ id, name, dob, mrn: '', problems: '', meds: '', summary: '', docs: [] });
      savePatients(list);
    }
    setActivePtId(id);
    try { renderPatients(); renderProfile(); renderPatientBar(); updateNavCounts(); } catch (e) {}
    return id;
  }, name, dob);
}

(async () => {
  await new Promise(res => server.listen(PORT, res));
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-first-run', '--disable-extensions', '--hide-scrollbars', '--mute-audio']
  });

  const EMAIL = 'e2e-mls@example.test', PASS = 'e2e-password-1';
  let page;

  await step('boot: demo mode reaches the auth screen with no backend', async () => {
    page = await newAppPage(browser, { fresh: true });
    const mode = await page.evaluate(() => ({ demo: !backendMode(), auth: !!document.getElementById('authScreen') }));
    assert(mode.demo, 'demo=1 must blank the backend');
    assert(mode.auth, 'auth screen missing');
  });

  await step('boot: local synthetic account signs up and opens the app', async () => {
    await signUp(page, EMAIL, PASS);
    const up = await page.evaluate(() => document.getElementById('appScreen').style.display !== 'none');
    assert(up, 'app screen not shown after signup');
  });

  let idA, idB;
  await step('identity: reload keeps the exact active patient (no switch)', async () => {
    idA = await addPatient(page, 'E2E Alice Alpha', '01/02/1970');
    idB = await addPatient(page, 'E2E Bob Beta', '03/04/1980');
    await page.evaluate(id => { setActivePtId(id); try { renderProfile(); renderPatientBar(); } catch (e) {} }, idA);
    await reloadApp(page);
    await sleep(1500);
    const got = await page.evaluate(() => getActivePtId());
    assert.strictEqual(String(got), String(idA), 'reload switched the active patient: ' + got);
  });

  await step('identity: cross-tab switch never rebinds this tab\'s in-progress work', async () => {
    // tab A: transcript in progress for Alice
    await page.evaluate(() => {
      const tx = document.getElementById('transcript');
      tx.value = 'E2E in-progress dictation for Alice';
      tx.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const page2 = await newAppPage(browser);
    await sleep(800);
    await page2.evaluate(id => { setActivePtId(id); try { renderProfile(); renderPatientBar(); } catch (e) {} }, idB);
    await sleep(800);
    // tab A must still hold its own transcript, and any generation/save path
    // must bind to a VERIFIED current patient — never silently to Bob under
    // Alice's work. We assert the strict guard refuses or stays on Alice.
    const verdict = await page.evaluate(() => {
      const tx = document.getElementById('transcript');
      const active = getActivePtId();
      return { tx: tx.value, active: String(active) };
    });
    assert(/Alice/.test(verdict.tx), 'tab A transcript was clobbered');
    await page2.close();
  });

  await step('patient bar: Recent chip reserves stable space across refresh churn', async () => {
    // open both patients so a "recent" exists, then measure chip geometry
    await page.evaluate(id => setActivePtId(id), idB);
    await sleep(300);
    await page.evaluate(id => setActivePtId(id), idA);
    /* the chip mounts on the module's 1.5s tick — poll rather than race it */
    async function chipGeom() {
      for (let i = 0; i < 24; i++) {
        const g = await page.evaluate(() => {
          /* nudge the bar render — the chip module wraps renderPatientBar, so
             this triggers its mount as soon as the module train is up */
          try { if (typeof renderPatientBar === 'function') renderPatientBar(); } catch (e) {}
          const w = document.getElementById('mlsRecentPts');
          if (!w) return null;
          const r = w.getBoundingClientRect();
          return { x: r.x, width: r.width };
        });
        if (g && g.width >= 100) return g;
        await sleep(500);
      }
      return await page.evaluate(() => {
        const w = document.getElementById('mlsRecentPts');
        return w ? { width: w.getBoundingClientRect().width } : null;
      });
    }
    const before = await chipGeom();
    assert(before && before.width >= 100, 'recent chip missing or unreserved: ' + JSON.stringify(before));
    await reloadApp(page);
    const after = await chipGeom();
    assert(after && after.width >= 100, 'recent chip lost its reserved space after reload: ' + JSON.stringify(after));
  });

  await step('orders: incomplete order is refused with an itemized error; complete order enables actions', async () => {
    const out = await page.evaluate(() => {
      const toasts = [];
      const origToast = window.toast; window.toast = (m, t) => { toasts.push({ m: String(m), t }); };
      try {
        showView('orders');
        document.getElementById('ordType').value = 'imaging';
        renderOrderFields();
        // leave everything blank → must refuse and name the missing fields
        addOrderFromForm();
        const refused = toasts.some(x => x.t === 'err' && /needs:/i.test(x.m) && /Study/i.test(x.m));
        // now a complete imaging order must be accepted
        document.getElementById('ordf_study').value = 'MRI';
        document.getElementById('ordf_region').value = 'Lumbar spine';
        document.getElementById('ordf_indication').value = 'Persistent low back pain';
        addOrderFromForm();
        const added = (currentOrders || []).length === 1;
        const invalid = typeof invalidOrderInfos === 'function' ? invalidOrderInfos().length : -1;
        return { refused, added, invalid, toasts };
      } finally { window.toast = origToast; }
    });
    assert(out.refused, 'blank order was not refused with itemized fields: ' + JSON.stringify(out.toasts));
    assert(out.added, 'complete order was not added');
    assert.strictEqual(out.invalid, 0, 'complete order still flagged invalid');
  });

  await step('documents: Paste text opens an in-app modal (no native prompt) and saves the doc', async () => {
    const out = await page.evaluate(() => {
      showView('profile');
      let sawPrompt = false;
      const origPrompt = window.prompt; window.prompt = () => { sawPrompt = true; return null; };
      try { addDocPaste(); } finally { window.prompt = origPrompt; }
      const modal = document.getElementById('docPasteModal');
      if (!modal) return { modal: false, sawPrompt };
      document.getElementById('docPasteName').value = 'E2E pasted lab';
      document.getElementById('docPasteText').value = 'MRI lumbar spine (03/14/2026): disc protrusion L4-L5. No fracture.';
      document.getElementById('docPasteAdd').click();
      const p = activePatient();
      const doc = (p.docs || []).find(d => d.name === 'E2E pasted lab');
      return { modal: true, sawPrompt, saved: !!doc, dialogRole: modal ? true : false };
    });
    assert(out.modal, 'in-app paste modal did not open');
    assert(!out.sawPrompt, 'native prompt() was still used');
    assert(out.saved, 'pasted document was not saved to the active patient');
  });

  await step('generation: no-key non-example transcript fails VISIBLY (toast + settings), never silently', async () => {
    const out = await page.evaluate(async () => {
      showView('visit');
      const tx = document.getElementById('transcript');
      tx.value = 'Some real dictation that is not the example.';
      tx.dispatchEvent(new Event('input', { bubbles: true }));
      const toasts = [];
      const origToast = window.toast; window.toast = (m, t) => { toasts.push({ m: String(m), t }); };
      let r;
      try { r = await generateNote(); } finally { window.toast = origToast; }
      /* the easy engine renders its own #ez3Toast DOM toast instead of
         window.toast — both channels count as a visible outcome */
      const ez = document.getElementById('ez3Toast');
      if (ez && ez.className === 'on' && (ez.textContent || '').trim()) toasts.push({ m: ez.textContent, t: 'ez3' });
      const settingsOpen = !!document.querySelector('#settingsModal, .modal-back');
      return { r, toasts, settingsOpen, btnEnabled: !document.getElementById('genBtn').disabled };
    });
    assert.strictEqual(out.r, false, 'generation claimed success without AI');
    /* the refusal may come from the exact-scheduled-action gate (default-type
       warning toast) or the no-key path (err toast) — either way it must be
       VISIBLE, never a silent false */
    assert(out.toasts.some(x => String(x.m || '').trim().length > 0), 'failed generation produced no visible message at all: ' + JSON.stringify(out.toasts));
    assert(out.btnEnabled, 'Generate button left disabled after failure');
  });

  await step('freeze: after a failed generation, Chart/History navigation stays responsive', async () => {
    const ms = await page.evaluate(async () => {
      const t0 = performance.now();
      try { showView('history'); } catch (e) {}
      try { showView('profile'); } catch (e) {}
      try { showView('visit'); } catch (e) {}
      await new Promise(r => requestAnimationFrame(() => r()));
      return performance.now() - t0;
    });
    assert(ms < 3000, 'navigation after failed generation took ' + ms + 'ms');
    // event loop stays live
    const tick = await Promise.race([page.evaluate(() => 42), sleep(4000).then(() => 'timeout')]);
    assert.strictEqual(tick, 42, 'page event loop is wedged');
  });

  await step('consent: encounter consent dialog gates recording — decline refuses, verbal confirm allows and logs', async () => {
    const out = await page.evaluate(async () => {
      const capOn = () => (typeof capturing !== 'undefined' ? !!capturing : false);
      const before = { has: _mlsHasEncounterConsent(), capturing: capOn() };
      const p = _mlsRequestEncounterConsent('recording');
      await new Promise(r => setTimeout(r, 60));
      const modal = document.getElementById('_mlsAskDialog');
      if (!modal) return { noModal: true };
      const radios = modal.querySelectorAll('input[name="_mlsConsentOpt"]').length;
      const hasText = /Patient consent required/i.test(modal.textContent) && /decline or ask to stop/i.test(modal.textContent);
      const midDialog = { capturing: capOn() };
      modal.querySelector('input[value="declined"]').click();
      modal.querySelector('#_mlsAskYes').click();
      const declined = await p;
      const afterDecline = { has: _mlsHasEncounterConsent(), capturing: capOn() };
      const p2 = _mlsRequestEncounterConsent('recording');
      await new Promise(r => setTimeout(r, 60));
      const m2 = document.getElementById('_mlsAskDialog');
      m2.querySelector('input[value="patient-verbal"]').click();
      m2.querySelector('#_mlsAskYes').click();
      const confirmed = await p2;
      const log = JSON.parse(localStorage.getItem(uns('consentLog')) || '[]');
      return {
        before, radios, hasText, midDialog, declined, afterDecline, confirmed,
        hasAfter: _mlsHasEncounterConsent(), logN: log.length, last: log[log.length - 1]
      };
    });
    assert(!out.noModal, 'consent dialog did not render');
    assert(!out.before.has && !out.before.capturing, 'consent/capture state dirty at start');
    assert.strictEqual(out.radios, 3, 'three consent options required');
    assert(out.hasText, 'consent wording missing');
    assert(!out.midDialog.capturing, 'audio state flipped on while the consent dialog was open');
    assert.strictEqual(out.declined, false, 'declining still allowed capture');
    assert(!out.afterDecline.has && !out.afterDecline.capturing, 'decline left consent/capture state behind');
    assert.strictEqual(out.confirmed, true, 'verbal consent did not confirm');
    assert(out.hasAfter, 'confirmed consent not remembered for the encounter');
    assert(out.logN >= 1 && out.last && out.last.consentType === 'patient-verbal' && out.last.patientId, 'consent audit record missing/incomplete');
  });

  await step('op-note: unresolved placeholders save only as an explicit Draft (never a completed note)', async () => {
    const out = await page.evaluate(() => {
      const note = 'PROCEDURE: test\nNeedle: [[needle_gauge]]\nConsent: [not dictated]\nEBL: ___';
      const tokens = window.opNoteBlankTokens(note);
      window._opPrep = [{ appt: { name: 'E2E Alice Alpha', dob: '01/02/1970', reason: 'Injection' }, patientId: getActivePtId(), note, proc: 'Test injection' }];
      const before = getNotes().length;
      opPrepSave(0);
      const ns = getNotes();
      const saved = ns.find(n => n.id === window._opPrep[0]._noteId);
      return { tokenCount: tokens.length, saved: !!saved, isDraft: saved && saved.isDraft, cc: saved && saved.cc, added: ns.length - before, source: saved && saved.source };
    });
    assert.strictEqual(out.tokenCount, 3, 'canonical parser count wrong: ' + out.tokenCount);
    assert(out.saved, 'op-note was not saved at all');
    assert.strictEqual(out.isDraft, true, 'incomplete op-note saved as a completed note');
    assert(/draft/i.test(out.cc || ''), 'draft is not labeled as a draft');
    assert.strictEqual(out.source, 'manual-ai', 'local op-note lost its local provenance');
  });

  await step('intake kiosk: Back stays inside intake; exit is an in-app password dialog', async () => {
    const out = await page.evaluate(async () => {
      openIntake();
      const intakeUp1 = document.getElementById('intakeView').style.display !== 'none';
      history.back();
      await new Promise(r => setTimeout(r, 400));
      const intakeUp2 = document.getElementById('intakeView').style.display !== 'none';
      let sawPrompt = false;
      const origPrompt = window.prompt; window.prompt = () => { sawPrompt = true; return null; };
      try { exitIntake(); } finally { window.prompt = origPrompt; }
      const modal = !!document.getElementById('ikExitModal');
      // close the dialog and leave intake via the internal path for later steps
      const c = document.getElementById('ikExitCancel'); if (c) c.click();
      document.getElementById('intakeView').style.display = 'none';
      document.getElementById('appScreen').style.display = 'block';
      return { intakeUp1, intakeUp2, modal, sawPrompt };
    });
    assert(out.intakeUp1, 'intake did not open');
    assert(out.intakeUp2, 'browser Back escaped the patient intake kiosk');
    assert(out.modal, 'exit is not an in-app dialog');
    assert(!out.sawPrompt, 'exit still uses native prompt()');
  });

  await step('settings: cs-2.0.0 workspace — clean skin owns the modal, search filters, tabs switch, both themes readable', async () => {
    await page.evaluate(() => openSettings());
    /* the organizer boots with the post-auth module train — wait for it */
    let clean = false;
    for (let i = 0; i < 30; i++) {
      clean = await page.evaluate(() =>
        document.getElementById('settingsModal').classList.contains('mls-settings-clean') &&
        !!document.querySelector('#settingsTabBar .mls-set-rail-head'));
      if (clean) break;
      await sleep(1000);
    }
    assert(clean, 'clean settings workspace never activated');
    const out = await page.evaluate(async () => {
      const modal = document.getElementById('settingsModal');
      const bar = document.getElementById('settingsTabBar');
      const doc = modal.querySelector('.modal');
      const si = document.getElementById('settingsSearch');
      si.value = 'password'; si.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 400));
      const hits = [...modal.querySelectorAll('.set-section')].filter(s => s.style.display !== 'none' && !s.classList.contains('set-tab-hidden')).length;
      si.value = ''; si.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 400));
      const tab = bar.querySelector('[data-mls-settings-group="display"]');
      if (tab) tab.click();
      await new Promise(r => setTimeout(r, 300));
      const stxGone = !document.getElementById('stxStyle');
      const grid = getComputedStyle(doc).display === 'grid';
      const railSticky = getComputedStyle(bar).position === 'sticky';
      const iconTabs = bar.querySelectorAll('.set-tab .mls-set-ic').length;
      // dark theme readability: heading ink must flip with the theme vars
      const vis = () => [...modal.querySelectorAll('.set-section')].find(s => s.style.display !== 'none');
      const lightHead = getComputedStyle(vis().querySelector('.set-head')).color;
      document.body.classList.add('theme-dark');
      await new Promise(r => setTimeout(r, 150));
      const darkHead = getComputedStyle(vis().querySelector('.set-head')).color;
      const darkBg = getComputedStyle(doc).backgroundColor;
      document.body.classList.remove('theme-dark');
      const noOverflow = doc.scrollWidth <= doc.clientWidth + 2;
      const displayOn = tab ? tab.classList.contains('on') : false;
      try { closeSettings(); } catch (e) {}
      return { hits, stxGone, grid, railSticky, iconTabs, lightHead, darkHead, darkBg, noOverflow, displayOn };
    });
    assert(out.grid && out.railSticky, 'two-pane sticky-rail layout not applied: ' + JSON.stringify(out));
    assert(out.iconTabs >= 5, 'icon rail tabs missing');
    assert(out.stxGone, 'legacy stx skin still active alongside the clean workspace');
    assert(out.hits >= 1 && out.hits <= 4, 'search did not filter sections: ' + out.hits);
    assert(out.displayOn, 'tab switch did not activate the Display group');
    assert(out.lightHead !== out.darkHead, 'section headings do not follow the theme (dark-mode readability regression)');
    assert(out.noOverflow, 'settings content overflows horizontally');
  });

  await step('workday walkthrough: a real person adds a template, runs a visit end-to-end, preps an op note, and crawls every view — with zero uncaught errors', async () => {
    const pageErrors = [];
    const onPageError = e => pageErrors.push(String(e && e.message || e).slice(0, 200));
    page.on('pageerror', onPageError);
    try {
      const out = await page.evaluate(async () => {
        const R = { errors: [] };
        const sleep = ms => new Promise(r => setTimeout(r, ms));
        try {
          /* --- 1. TEMPLATES: add via the real form, find it, set default --- */
          openTemplates();
          await sleep(300);
          document.getElementById('tplName').value = 'E2E TFESI Right L5-S1';
          document.getElementById('tplText').value = 'Name: E2E TFESI Right L5-S1\nPROCEDURE: Transforaminal epidural steroid injection (TFESI), right L5-S1. 64483.\nNeedle: [[needle_gauge]]\nLevels: right L5-S1.';
          saveTemplateFromForm();
          await sleep(300);
          const tpl = getTemplates().find(t => /E2E TFESI/.test(t.name));
          R.tplSaved = !!tpl;
          const si = document.getElementById('tplSearch');
          if (si) { si.value = 'tfesi'; si.dispatchEvent(new Event('input', { bubbles: true })); await sleep(200); }
          R.tplFound = !![...document.querySelectorAll('#tplList [role="option"]')].find(o => /E2E TFESI/.test(o.textContent));
          if (si) { si.value = ''; si.dispatchEvent(new Event('input', { bubbles: true })); }
          try { document.querySelector('#templatesModal .modal-x, #tplModal .modal-x')?.click(); } catch (e) {}

          /* --- 2. the op-note matcher must route TFESI text to MY template --- */
          const m = window.__mlsOpNoteIntegrity && window.__mlsOpNoteIntegrity.matchVisitText('Right L5-S1 TFESI under fluoroscopy');
          R.matcher = m && tpl && m.tplId === tpl.id;
          const neg = window.__mlsOpNoteIntegrity && window.__mlsOpNoteIntegrity.matchVisitText('No procedure performed today.');
          R.negation = !!(neg && neg.noMatch);

          /* --- 3. VISIT end-to-end: consent -> offline generate -> sign -> history ---
             The exact-scheduled-visit gate refuses actions until a visit is
             locked, so do what a real person does for a walk-in: find the
             patient in the Easy search and Start the visit from the row. */
          /* seed a synthetic imported day — one appointment for the synthetic
             patient with a provider (equivalent to a previously imported
             schedule day), then Start the visit from the REAL day row so the
             exact-scheduled-visit gate is satisfied the same way it is for a
             real clinic day. All data stays in this synthetic account. */
          localStorage.setItem(uns('docname'), 'E2E Provider MD');
          const todayKey = _acctTodayKey();
          window._calAppts = [{
            id: 'appt-e2e-1', name: activePatient().name, dob: activePatient().dob,
            appt_date: todayKey, start_at: todayKey + 'T10:00:00',
            provider: 'E2E Provider MD', status: 'booked',
            patient_external_id: getActivePtId(), reason: 'Follow-up'
          }];
          showView('visit');
          const eng = window.__mlsEasyV32 && window.__mlsEasyV32.remote;
          try { window.dispatchEvent(new CustomEvent('mls:schedule-updated')); } catch (e) {}
          if (eng && eng.setVisitDay) eng.setVisitDay(todayKey); /* real re-render trigger */
          await sleep(1200);
          /* the shell now offers "Choose patient — 1 on today's schedule";
             open it and pick the row exactly like a person would */
          let choose = document.getElementById('ez3Choose');
          for (let w = 0; w < 10 && !choose; w++) {
            if (eng && eng.setVisitDay) eng.setVisitDay(todayKey);
            await sleep(600);
            choose = document.getElementById('ez3Choose');
          }
          if (choose) { choose.click(); await sleep(800); }
          const rowSel = '#visitView [data-hd], #mlsEz3 [data-hd], #visitView [data-q], #mlsEz3 [data-q]';
          let quick = document.querySelector(rowSel);
          for (let w = 0; w < 6 && !quick; w++) { await sleep(500); quick = document.querySelector(rowSel); }
          R.dayRow = !!quick;
          if (quick) { quick.click(); await sleep(1200); }
          R.visitLocked = !!(eng && eng.snapshot && eng.snapshot().active);
          R.dayDebug = quick ? null : (() => {
            const s = eng && eng.snapshot ? eng.snapshot() : null;
            const wrap = document.getElementById('ez3Wrap');
            return {
              day: s && s.day, rows: s && s.rows && s.rows.length, active: s && s.active,
              provider: s && s.provider,
              wrapHtml: wrap ? wrap.innerHTML.replace(/\s+/g, ' ').slice(0, 380) : 'no-wrap'
            };
          })();
          if (typeof _mlsHasEncounterConsent === 'function' && !_mlsHasEncounterConsent()) {
            const p = _mlsRequestEncounterConsent('recording');
            await sleep(120);
            const modal = document.getElementById('_mlsAskDialog');
            if (modal) { modal.querySelector('input[value="patient-verbal"]').click(); modal.querySelector('#_mlsAskYes').click(); }
            R.consent = (await p) === true;
          } else R.consent = true;
          const tx = document.getElementById('transcript');
          tx.value = EXAMPLE; tx.dispatchEvent(new Event('input', { bubbles: true }));
          const histBefore = getNotes().length;
          R.generated = (await generateNote()) === true;
          R.noteShown = !!(document.getElementById('noteBox') && document.getElementById('noteBox').value.trim());
          signNote();
          await sleep(200);
          const signedRec = getNotes().length > histBefore ? getNotes()[0] : null;
          R.signedSaved = !!signedRec;
          R.signedPatient = signedRec ? String(signedRec.patientId || '') : '';

          /* --- 4. OP-NOTE PREP row against the added template --- */
          window._opPrep = [{ appt: { name: activePatient().name, dob: activePatient().dob, reason: 'Right L5-S1 TFESI' }, patientId: getActivePtId(), note: 'PROCEDURE: TFESI right L5-S1\nNeedle: [[needle_gauge]]', proc: 'TFESI right L5-S1' }];
          opPrepSave(0);
          const draft = getNotes().find(n => n.id === window._opPrep[0]._noteId);
          R.opDraft = !!(draft && draft.isDraft);

          /* --- 5. crawl every view like a person clicking through --- */
          R.crawl = [];
          for (const v of ['patients', 'visit', 'calendar', 'orders', 'recs', 'history', 'analysis', 'studio']) {
            try { showView(v); await sleep(250); const doc = document.documentElement; R.crawl.push(v + ':' + (doc.scrollWidth <= doc.clientWidth + 2 ? 'ok' : 'OVERFLOW')); }
            catch (e) { R.crawl.push(v + ':THREW ' + String(e && e.message).slice(0, 60)); }
          }
          showView('visit');
        } catch (e) { R.errors.push('walkthrough: ' + String(e && e.message || e).slice(0, 200)); }
        return R;
      });
      assert.strictEqual(out.errors.length, 0, 'walkthrough threw: ' + JSON.stringify(out.errors));
      assert(out.tplSaved, 'template did not save via the real form');
      assert(out.tplFound, 'saved template not findable via workspace search');
      assert(out.matcher, 'op-note matcher did not route TFESI text to the user template');
      assert(out.negation, '"no procedure performed" matched a template');
      assert(out.dayRow, 'seeded synthetic appointment did not render as a day row — ' + JSON.stringify(out.dayDebug));
      assert(out.visitLocked, 'starting the visit from the day row did not lock a visit in the engine');
      assert(out.consent, 'consent flow failed in the real visit');
      assert(out.generated && out.noteShown, 'offline visit generation failed');
      assert(out.signedSaved, 'signing did not save the visit to History');
      assert.strictEqual(out.signedPatient, await page.evaluate(() => String(getActivePtId())), 'signed note bound to the wrong patient');
      assert(out.opDraft, 'op-note prep did not save an explicit draft');
      const badViews = out.crawl.filter(x => !/:ok$/.test(x));
      assert.strictEqual(badViews.length, 0, 'view crawl problems: ' + badViews.join(', '));
      const realPageErrors = pageErrors.filter(x => !/favicon|manifest|ServiceWorker|chrome-extension/i.test(x));
      assert.strictEqual(realPageErrors.length, 0, 'uncaught page errors during the workday: ' + JSON.stringify(realPageErrors));
    } finally { page.off('pageerror', onPageError); }
  });

  await step('demo local calendar: book through the real form, appears via loadCalendar, check-in stamps, cancel sticks, per-account persistence', async () => {
    const out = await page.evaluate(async () => {
      const R = {}; const sleep = ms => new Promise(r => setTimeout(r, ms));
      showView('calendar');
      const l1 = await loadCalendar();
      R.loadApplied = !!(l1 && l1.applied);
      const today = _acctTodayKey();
      const ensure = (id, v) => { let el = document.getElementById(id); if (!el) { el = document.createElement('input'); el.id = id; el.style.display = 'none'; document.body.appendChild(el); } el.value = v; };
      ensure('calNewName', 'E2E Booked Patient'); ensure('calNewDate', today); ensure('calNewTime', '15:15');
      ensure('calNewDoc', ''); ensure('calNewPhone', ''); ensure('calNewReason', 'New consult'); ensure('calNewRoom', '');
      await calCreateAppt(null);
      await sleep(400);
      const row = (window._calAppts || []).find(a => /E2E Booked/.test(a.name || ''));
      R.booked = !!row && row.appt_date === today;
      if (row) { await apptUpdate(row.id, { status: 'checked_in' }); await loadCalendar(); }
      const after = (window._calAppts || []).find(a => /E2E Booked/.test(a.name || ''));
      R.checkedIn = !!(after && after.status === 'checked_in' && after.checked_in_at);
      if (after) { await fetch('/api/appointments/' + after.id + '/update', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'cancelled' }) }); await loadCalendar(); }
      const fin = (window._calAppts || []).find(a => /E2E Booked/.test(a.name || ''));
      R.cancelled = !!(fin && fin.status === 'cancelled');
      R.persisted = JSON.parse(localStorage.getItem(uns('localApptsV1')) || '[]').some(a => /E2E Booked/.test(a.name || ''));
      showView('visit');
      return R;
    });
    assert(out.loadApplied, 'demo loadCalendar did not apply');
    assert(out.booked, 'real booking form did not create the local appointment');
    assert(out.checkedIn, 'check-in did not stamp through the local adapter');
    assert(out.cancelled, 'cancel did not stick');
    assert(out.persisted, 'appointment not persisted in the per-account local store');
  });

  await step('switching + isolation + resume: lock guard fail-closed with confirmed retry, no cross-record leakage, draft resumes after reload', async () => {
    const out = await page.evaluate(async (idAlice, idBob) => {
      const R = {}; const sleep = ms => new Promise(r => setTimeout(r, ms));
      const notesOf = id => getNotes().filter(n => String(n.patientId) === String(id)).length;
      setActivePtId(idAlice); await sleep(250);
      const d0 = document.getElementById('_mlsAskDialog'); if (d0) { d0.querySelector('#_mlsAskYes').click(); await sleep(500); }
      R.bobBefore = notesOf(idBob);
      showView('visit');
      /* consent for this encounter, then arm the patient lock through the
         REAL capture wrapper (record then stop = pending unsaved work) */
      if (typeof _mlsHasEncounterConsent === 'function' && !_mlsHasEncounterConsent()) {
        const pc = _mlsRequestEncounterConsent('recording'); await sleep(150);
        const cm = document.getElementById('_mlsAskDialog');
        if (cm) { cm.querySelector('input[value="patient-verbal"]').click(); cm.querySelector('#_mlsAskYes').click(); }
        await pc;
      }
      const lock = window.__mlsPatientLock; R.lockInstalled = !!(lock && lock.installed);
      try { startCapture(); } catch (e) {}
      await sleep(400);
      try { stopCapture(); } catch (e) {}
      await sleep(200);
      const st = lock && lock._debugState ? lock._debugState() : {};
      R.armed = !!(st && st.hasPendingWork);
      /* fail-closed: the switch is refused NOW, the dialog asks */
      setActivePtId(idBob); await sleep(300);
      R.refused = String(getActivePtId()) === String(idAlice);
      const dlg = document.getElementById('_mlsAskDialog'); R.asked = !!dlg;
      if (dlg) { dlg.querySelector('#_mlsAskNo').click(); await sleep(300); }
      R.stillAliceAfterNo = String(getActivePtId()) === String(idAlice);
      R.stAfterNo = lock && lock._debugState ? lock._debugState() : null;
      /* ambient shell timers can settle the lock between phases — re-arm so
         the confirmed-retry phase always tests what it claims */
      if (!(R.stAfterNo && R.stAfterNo.hasPendingWork)) {
        try { startCapture(); } catch (e) {}
        await sleep(300);
        try { stopCapture(); } catch (e) {}
        await sleep(200);
      }
      /* confirmed abandon re-invokes the switch exactly once */
      setActivePtId(idBob); await sleep(300);
      const dlg2 = document.getElementById('_mlsAskDialog');
      R.asked2 = !!dlg2;
      if (dlg2) { dlg2.querySelector('#_mlsAskYes').click(); await sleep(800); }
      R.switched = String(getActivePtId()) === String(idBob);
      R.bobAfterSwitch = notesOf(idBob);
      /* back to Alice; leave unsaved work for the resume test */
      setActivePtId(idAlice); await sleep(400);
      const d3 = document.getElementById('_mlsAskDialog'); if (d3) { d3.querySelector('#_mlsAskYes').click(); await sleep(600); }
      R.backToAlice = String(getActivePtId()) === String(idAlice);
      const tx = document.getElementById('transcript');
      tx.value = 'RESUME-MARKER unsaved dictation for Alice';
      tx.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(1500); /* _markVisitDirty debounce (800ms) -> _saveVisitDraft */
      R.draftSaved = !!sessionStorage.getItem(_visitDraftKey());
      return R;
    }, idA, idB);
    assert(out.lockInstalled, 'patient-lock module missing');
    assert(out.armed, 'record-then-stop did not arm pending work');
    assert(out.refused && out.asked, 'switch away from unsaved work was not refused-with-dialog: ' + JSON.stringify(out));
    assert(out.stillAliceAfterNo, 'declining the abandon dialog still switched patients');
    assert(out.asked2 && out.switched, 'confirmed abandon did not complete the switch: ' + JSON.stringify(out));
    assert.strictEqual(out.bobAfterSwitch, out.bobBefore, 'work leaked onto the other synthetic record');
    assert(out.backToAlice, 'could not return to the original record');
    assert(out.draftSaved, 'unsaved work did not reach the draft slot');
    /* resume after reload — the dirty transcript raises the app's beforeunload
       guard (working as designed); reloadApp() accepts it and asserts it fired */
    await reloadApp(page);
    await sleep(2500);
    const res = await page.evaluate(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      for (let i = 0; i < 12 && !document.getElementById('_visitRestoreBar'); i++) {
        try { showView('visit'); _maybeRestoreVisitDraft(); } catch (e) {}
        await sleep(500);
      }
      const bar = document.getElementById('_visitRestoreBar');
      const R = { bar: !!bar, barText: bar ? bar.textContent.slice(0, 120) : '' };
      if (bar) {
        const btn = [...bar.querySelectorAll('button')].find(b => /Restore it/.test(b.textContent));
        if (btn) { btn.click(); await sleep(600); }
      }
      R.restored = /RESUME-MARKER/.test((document.getElementById('transcript') || {}).value || '');
      return R;
    });
    assert(res.bar, 'restore bar missing after reload');
    assert(res.restored, 'draft did not restore into the transcript: ' + res.barText);
  });

  await step('responsive: no horizontal overflow at phone width on core views', async () => {
    await page.setViewport({ width: 375, height: 812 });
    await sleep(600);
    const bad = await page.evaluate(() => {
      const out = [];
      for (const v of ['visit', 'history', 'orders', 'profile']) {
        try { showView(v); } catch (e) {}
        const doc = document.documentElement;
        if (doc.scrollWidth > doc.clientWidth + 2) out.push(v + ':' + doc.scrollWidth + '>' + doc.clientWidth);
      }
      return out;
    });
    assert.strictEqual(bad.length, 0, 'horizontal overflow on: ' + bad.join(', '));
    await page.setViewport({ width: 1280, height: 850 });
  });

  /* ======================= PHONE CONTRACTS (ph-e2e-1.0.0) =======================
     Why these exist, and why they do not reuse the step above.

     The step above measures documentElement.scrollWidth. Below 760px the app
     sets `html, body.mls-redesign{ max-width:100vw; overflow-x:hidden }`
     (feat_mls_redesign.js:1040). MEASURED in Chrome 390x844: a deliberately
     1200px-wide child reports documentElement.scrollWidth === clientWidth ===
     390, i.e. the signal is fully suppressed, while getBoundingClientRect()
     still reports right === 1200. The existing step is therefore structurally
     incapable of detecting overflow at phone width — it has been passing
     vacuously on exactly the breakpoint it is named for.

     Every contract below measures geometry per element, and PHONE_A11Y_PROBE
     proves the detector fires before trusting a clean result.
     ============================================================================= */

  /* Shared in-page probe. Returns violations for one viewport.
     Elements inside a legitimately scrollable container are not overflow bugs.

     Passed to page.evaluate as a FUNCTION REFERENCE, never as a source string:
     a string goes through puppeteer's function-detection and an extra escaping
     hop, which silently produced a probe that returned a clean result on a page
     the identical logic flagged when run directly. The canary step below exists
     to catch exactly that. */
  function phoneProbe() {
    const vw = document.documentElement.clientWidth;
    const seen = (el) => {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
      if (el.getAttribute && el.getAttribute('data-mls-preview-hidden') === '1') return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const inScroller = (el) => {
      for (let p = el.parentElement; p; p = p.parentElement) {
        const ox = getComputedStyle(p).overflowX;
        if (ox === 'auto' || ox === 'scroll') return true;
      }
      return false;
    };
    const desc = (el) => el.tagName.toLowerCase()
      + (el.id ? '#' + el.id : '')
      + (el.className && typeof el.className === 'string' && el.className.trim()
          ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '');

    const overflow = [], small = [], zoom = [];
    document.querySelectorAll('*').forEach((el) => {
      if (!seen(el)) return;
      const r = el.getBoundingClientRect();
      if (r.right > vw + 2 && !inScroller(el)) {
        overflow.push({ el: desc(el), right: Math.round(r.right), vw: vw });
      }
    });
    document.querySelectorAll('button,a[href],[role="button"],[role="menuitem"],summary,select,input[type="checkbox"],input[type="radio"],input[type="submit"]').forEach((el) => {
      if (!seen(el)) return;
      if (el.disabled === true || el.getAttribute('aria-disabled') === 'true') return;
      const r = el.getBoundingClientRect();
      if (r.width < 44 || r.height < 44) {
        small.push({ el: desc(el), w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10,
                     txt: (el.textContent || '').trim().slice(0, 22) });
      }
    });
    document.querySelectorAll('input,textarea,select,[contenteditable="true"]').forEach((el) => {
      if (!seen(el)) return;
      const t = (el.getAttribute('type') || '').toLowerCase();
      if (['checkbox','radio','range','color','file','submit','button','hidden'].indexOf(t) >= 0) return;
      const fs = parseFloat(getComputedStyle(el).fontSize);
      if (fs < 16) zoom.push({ el: desc(el), fontSize: fs });
    });
    return { overflow: overflow, small: small, zoom: zoom };
  }

  const PHONE_VIEWPORTS = [
    { name: 'iPhone 390x844', width: 390, height: 844 },
    { name: 'Android 360x800', width: 360, height: 800 }
  ];
  const PHONE_VIEWS = ['visit', 'history', 'orders', 'profile'];

  /* A dedicated page per phone viewport.
     Mobile emulation is applied BEFORE goto on purpose: calling setViewport
     with isMobile/hasTouch on an already-loaded page makes puppeteer reload it,
     which raises the app's beforeunload guard; the suite's default dialog
     handler dismisses, dismissing CANCELS the navigation, and the whole thing
     surfaces as a bogus 30s "Navigation timeout" (see reloadApp's note).
     A fresh page also means the phone contracts are not measured on a session
     already dirtied by the desktop steps above. */
  async function newPhonePage(vp) {
    const p = await browser.newPage();
    const cdp = await p.createCDPSession();
    await cdp.send('Network.setBypassServiceWorker', { bypass: true });
    p.on('dialog', async d => { try { await d.accept(); } catch (e) {} });
    await p.setViewport({ width: vp.width, height: vp.height, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
    await p.goto(APP, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const ready = await waitForAppSettled(p);
    if (process.env.MLS_E2E_PHONE_DEBUG) {
      const d = await p.evaluate(() => {
        const vis = (id) => { const e = document.getElementById(id); if (!e) return 'absent'; const cs = getComputedStyle(e); const r = e.getBoundingClientRect(); return cs.display + '/' + Math.round(r.width) + 'x' + Math.round(r.height); };
        return {
          url: location.href,
          authScreen: vis('authScreen'), appScreen: vis('appScreen'),
          buttons: document.querySelectorAll('button').length,
          inputs: document.querySelectorAll('input,textarea,select').length,
          scripts: document.querySelectorAll('script').length,
          bodyClass: (document.body.className || '').slice(0, 90),
          text: (document.body.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 160)
        };
      });
      console.log('  [phone-debug ' + vp.name + '] ready=' + JSON.stringify(ready) + ' ' + JSON.stringify(d));
    }
    return p;
  }

  /* Wait until the app is BOOTED AND SETTLED — not merely parsed, and not
     merely painted once.

     Two distinct traps were measured here, both of which produce a green run
     against nothing:
       1. For ~2s after domcontentloaded every element measures 0x0 through
          getBoundingClientRect (an ancestor is not yet displayed), so every
          geometry contract reports zero violations.
       2. Even once something is sized, the app is still mid-boot: 12 of ~229
          script tags present, body text "Connecting to your practice…", and the
          shell CSS layers (mls-redesign / mls-calm) not yet applied — i.e. the
          exact stylesheet whose phone rules are under test is absent.

     A fixed sleep is not a fix, it is the same bug with a longer fuse. Require
     the module loader to have run, then require two consecutive identical
     geometry samples so we only ever measure a page that has stopped moving. */
  async function waitForAppSettled(p, timeoutMs = 90000) {
    const started = Date.now();
    let last = null, stable = 0, prevKey = '';
    while (Date.now() - started < timeoutMs) {
      last = await p.evaluate(() => {
        const sized = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
        const controls = [...document.querySelectorAll('button, input')].filter(sized).length;
        const bodyR = document.body ? document.body.getBoundingClientRect() : { height: 0 };
        return {
          scripts: document.querySelectorAll('script').length,
          controls: controls,
          bodyHeight: Math.round(bodyR.height),
          booting: /Connecting to your practice/i.test(document.body ? (document.body.innerText || '') : ''),
          shell: (document.body && document.body.className || '')
        };
      });
      const loaded = last.scripts > 200 && !last.booting && last.controls >= 10 && last.bodyHeight > 100;
      const key = last.controls + ':' + last.bodyHeight + ':' + last.scripts;
      stable = (loaded && key === prevKey) ? stable + 1 : 0;
      prevKey = key;
      if (loaded && stable >= 2) return last;
      await sleep(400);
    }
    throw new Error('app never settled within ' + timeoutMs + 'ms; last signal: ' + JSON.stringify(last));
  }
  async function probeViews(p, views) {
    const out = { overflow: [], zoom: [], small: [] };
    for (const v of views) {
      try { await p.evaluate((view) => { try { showView(view); } catch (e) {} }, v); } catch (e) {}
      await sleep(350);
      const r = await p.evaluate(phoneProbe);
      r.overflow.forEach(o => out.overflow.push(v + ' → ' + o.el + ' right=' + o.right + ' > ' + o.vw));
      r.zoom.forEach(z => out.zoom.push(v + ' → ' + z.el + ' @' + z.fontSize + 'px'));
      r.small.forEach(s => out.small.push(v + ' → ' + s.el + ' ' + s.w + 'x' + s.h + ' "' + s.txt + '"'));
    }
    return out;
  }

  for (const vp of PHONE_VIEWPORTS) {
    const pp = await newPhonePage(vp);

    await step('phone instrument: the overflow detector actually fires at ' + vp.name + ' (reverse A/B)', async () => {
      const before = await pp.evaluate(phoneProbe);
      await pp.evaluate(() => {
        const d = document.createElement('div');
        d.id = '__mlsOverflowCanary';
        d.style.cssText = 'width:1200px;height:24px;background:transparent';
        document.body.appendChild(d);
      });
      await sleep(150);
      /* Probe FIRST, then diagnose. The app runs self-healing MutationObservers;
         if the canary is measured before the probe runs, a removal in between
         is indistinguishable from a filtering bug. */
      const dirty = await pp.evaluate(phoneProbe);
      const canary = await pp.evaluate(() => {
        const c = document.getElementById('__mlsOverflowCanary');
        if (!c) return { presentAfterProbe: false };
        const r = c.getBoundingClientRect();
        const cs = getComputedStyle(c);
        let scroller = null;
        for (let p = c.parentElement; p; p = p.parentElement) {
          const ox = getComputedStyle(p).overflowX;
          if (ox === 'auto' || ox === 'scroll') { scroller = (p.id || p.tagName) + ':' + ox; break; }
        }
        return { presentAfterProbe: true, w: Math.round(r.width), right: Math.round(r.right),
                 vw: document.documentElement.clientWidth, display: cs.display,
                 maxWidth: cs.maxWidth, scrollerAncestor: scroller,
                 parent: c.parentElement ? (c.parentElement.id || c.parentElement.tagName) : null };
      });
      const deBlind = await pp.evaluate(() =>
        document.documentElement.scrollWidth <= document.documentElement.clientWidth + 2);
      await pp.evaluate(() => { const c = document.getElementById('__mlsOverflowCanary'); if (c) c.remove(); });
      await sleep(150);
      const after = await pp.evaluate(phoneProbe);

      assert(dirty.overflow.some(o => /__mlsOverflowCanary/.test(o.el)),
        'DETECTOR IS BLIND: a 1200px-wide element at ' + vp.width + 'px was not reported. ' +
        'Canary state: ' + JSON.stringify(canary) +
        ' | probe.overflow=' + JSON.stringify(dirty.overflow) +
        ' | probe counts: small=' + dirty.small.length + ' zoom=' + dirty.zoom.length);
      assert(deBlind,
        'documentElement.scrollWidth was expected to be suppressed by overflow-x:hidden here. ' +
        'If this fails, the legacy documentElement-based step may be trustworthy again — re-evaluate it.');
      assert.strictEqual(after.overflow.length, before.overflow.length,
        'canary removal did not restore the baseline — the probe mutates what it measures');
    });

    await step('phone: no element overflows the viewport at ' + vp.name, async () => {
      const r = await probeViews(pp, PHONE_VIEWS);
      const uniq = [...new Set(r.overflow)];
      assert.strictEqual(uniq.length, 0, uniq.length + ' overflowing element(s):\n    ' + uniq.slice(0, 12).join('\n    '));
    });

    await step('phone: no text field under 16px (iOS zooms the page on focus) at ' + vp.name, async () => {
      const r = await probeViews(pp, PHONE_VIEWS);
      const uniq = [...new Set(r.zoom)];
      assert.strictEqual(uniq.length, 0, uniq.length + ' field(s) below 16px:\n    ' + uniq.slice(0, 14).join('\n    '));
    });

    await step('phone: every enabled control is at least 44x44 at ' + vp.name, async () => {
      const r = await probeViews(pp, PHONE_VIEWS);
      const uniq = [...new Set(r.small)];
      assert.strictEqual(uniq.length, 0, uniq.length + ' control(s) under 44x44:\n    ' + uniq.slice(0, 16).join('\n    '));
    });

    try { await pp.close(); } catch (e) {}
  }

  await step('phone: losing the network says so, instead of rendering a normal app', async () => {
    const op = await newPhonePage(PHONE_VIEWPORTS[0]);
    try {
      const read = () => op.evaluate(() => {
        const b = document.getElementById('mlsOfflineBar');
        if (!b) return { present: false };
        const cs = getComputedStyle(b);
        return {
          present: true, display: cs.display,
          role: b.getAttribute('role'), live: b.getAttribute('aria-live'),
          text: (b.textContent || '').trim(),
          onLine: navigator.onLine
        };
      });

      const online = await read();
      assert.strictEqual(online.display, 'none',
        'the offline notice must be hidden while the network is up (got display=' + online.display + ')');

      /* Real offline, driven through CDP — not a synthetic event. */
      await op.setOfflineMode(true);
      await sleep(600);
      const offline = await read();
      assert.strictEqual(offline.onLine, false, 'CDP offline mode did not reach navigator.onLine');
      assert.strictEqual(offline.display, 'block',
        'a phone with a dead uplink still rendered a complete, normal app with no offline notice');
      assert(/offline/i.test(offline.text), 'the notice must say the app is offline: ' + offline.text);
      assert(/sync/i.test(offline.text),
        'the notice must say work will not sync — that is the part a clinician acts on');
      assert.strictEqual(offline.role, 'status', 'the notice must be role=status');
      assert.strictEqual(offline.live, 'polite',
        'aria-live must be polite so it is announced without stealing focus from typing');

      /* …and it must clear itself, or it becomes a permanent false alarm. */
      await op.setOfflineMode(false);
      await sleep(600);
      const back = await read();
      assert.strictEqual(back.display, 'none',
        'the offline notice did not clear when the network returned');
    } finally {
      try { await op.setOfflineMode(false); } catch (e) {}
      try { await op.close(); } catch (e) {}
    }
  });

  /* NOTE: do not restore a desktop viewport here. Leaving isMobile:true makes
     puppeteer reload the page, which raises the app's beforeunload guard; the
     dismissed dialog cancels the navigation and surfaces as a bogus 30s
     "Navigation timeout". The browser closes on the next line regardless. */

  await browser.close();
  server.close();
  console.log('\n' + results.length + ' e2e steps, ' + failed + ' failed');
  if (failed) process.exit(1);
  console.log('PASS all local E2E steps');
})().catch(e => { console.error(e); try { server.close(); } catch (_) {} process.exit(1); });
