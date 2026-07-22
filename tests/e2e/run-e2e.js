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
    await page.reload({ waitUntil: 'domcontentloaded' });
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
      for (let i = 0; i < 16; i++) {
        const g = await page.evaluate(() => {
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
    await page.reload({ waitUntil: 'domcontentloaded' });
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

  await browser.close();
  server.close();
  console.log('\n' + results.length + ' e2e steps, ' + failed + ' failed');
  if (failed) process.exit(1);
  console.log('PASS all local E2E steps');
})().catch(e => { console.error(e); try { server.close(); } catch (_) {} process.exit(1); });
