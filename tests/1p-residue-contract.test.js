'use strict';

/* /1p RESIDUE CONTRACT
 *
 * The four clunky-audit items that two lanes in a row closed with the same
 * sentence - "never rendered in this harness" - plus one performance residue
 * from the opnotes4 lane. Every one of them is here because the PROBE was
 * wrong, not because the defect was absent, so this suite's first job is to
 * build the state each defect needs and prove the state arrived. An assertion
 * that runs against a surface that never mounted passes vacuously and is worse
 * than no assertion at all.
 *
 *   item 1  Athena sheet, UNBOUND step strip     -> PART 2A
 *   item 10 Settings late stylesheet             -> PART 1B + PART 2E
 *   item 25 Sign & Save offered but always refuses -> PART 2B
 *   item 69 phone notice shelf                   -> PART 2C
 *   perf    .opr-tplmode title churn             -> PART 2D
 *
 * THE TRAP THIS SUITE SHARES WITH 1p-clunky-contract AND 1p-ui-shape-contract:
 * 1p-mls-connect.js and its feature modules are NOT loaded by the page on its
 * own, and the three modules this suite needs (the write-back walkthrough, the
 * op-note room, the settings rebuild) are each scheduled through
 * window.__mlsDeferAsset || requestIdleCallback, which never fires in a
 * non-compositing tab. All three are force-loaded below, the same way the calm
 * dock and the first-run card had to be.
 */

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const SHELLS = ['1pScribeFlow.html', '1p/index.html'];
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

let checks = 0;
const measured = {};
/* Phase markers. Two runs of this suite were lost to a silent stall while four
   other lanes drove headless Chrome on the same machine; a suite that prints
   nothing until the end cannot be told apart from one that is starved. */
const step = (name) => console.log('residue: ' + name);
function ok(value, message) { assert.ok(value, message); checks++; }
function eq(actual, expected, message) { assert.strictEqual(actual, expected, message); checks++; }

const BLOCKS = ['residue-athena-1.0.0', 'residue-oprperf-1.0.0', 'residue-notice-1.0.0', 'residue-settings-1.0.0'];

/* ========================================================= PART 1A: static */

for (const name of SHELLS) {
  const src = read(name);
  for (const block of BLOCKS) {
    const open = '<!-- ===== ' + block + ' ';
    const close = '<!-- ===== end ' + block;
    eq(src.split(open).length - 1, 1, `${name}: ${block} must open exactly once`);
    eq(src.split(close).length - 1, 1, `${name}: ${block} must close exactly once`);
    ok(src.indexOf(open) < src.indexOf(close), `${name}: ${block} closes before it opens`);

    /* LANE NEUTRALITY - a block that names this lane cannot be promoted to
       /cloned or production by copying it. Checked over the block's own span. */
    const span = src.slice(src.indexOf(open), src.indexOf(close));
    ok(!/__MLS_P1_PREVIEW/.test(span), `${name}: ${block} references __MLS_P1_PREVIEW and cannot be promoted`);
    ok(!/\b1p-[\w.-]*\.js\b/.test(span), `${name}: ${block} references a 1p-prefixed file and cannot be promoted`);
    ok(!/1pScribeFlow\.html/.test(span), `${name}: ${block} references the 1p shell by name`);
    ok(!/['"]\/1p\//.test(span), `${name}: ${block} references the /1p route`);

    /* THE BACKSLASH TRAP (shell-transport-eats-backslashes): a bare d{n}
       inside a regex literal is that defect's fingerprint. */
    const bare = span.match(/\/\^?[^/\n*][^/\n]*\/[gimsuy]*/g) || [];
    for (const lit of bare) {
      ok(!/[^\\[]d\{\d/.test(lit), `${name}: ${block} has a regex with a bare d{n} - a backslash was eaten in transport: ${lit}`);
    }

    /* Every block in this pack is reversible; that is the whole reason an
       overlay is allowed to touch a file this lane may not edit. */
    ok(/revert\s*:/.test(span), `${name}: ${block} ships no revert()`);
  }

  /* The two production files these overlays sit on top of must stay unedited
     by this lane; the overlays name them in prose only. */
  ok(/feat_mls_writeback_walkthrough\.js/.test(src), `${name}: the residue-athena block no longer names the module it overlays`);
  ok(/feat_mls_opnote_room\.js/.test(src), `${name}: the residue-oprperf block no longer names the module it overlays`);
}

/* ===== PART 1B: item 10 - the three facts two lanes got wrong =============
 *
 * The audit item is "a late stylesheet blanks the Settings dialog". The
 * stylesheet is #stxStyle, injected by feat_mls_settings_exact.js (stx-2.0.0).
 * Two lanes in a row closed the item on the ground that the module "self-skips
 * off staging". It does not: 1p-mls-connect.js deliberately appends a
 * type="text/plain" script whose src is the data: URL that isStaging() looks
 * for, so all fourteen *_exact modules activate off staging on purpose. These
 * assertions pin the three facts, so the wrong premise cannot come back.
 */
{
  const stx = read('feat_mls_settings_exact.js');
  ok(/function isStaging\(\)/.test(stx), 'feat_mls_settings_exact.js no longer has an isStaging() gate - item 10 must be re-derived');
  ok(/script\[src\*="mls-connect\.staging\.js"\]/.test(stx),
    'isStaging() no longer tests for a script whose src names the staging connect');

  /* FACT 1: the /1p connect bundle plants exactly that marker, on purpose. */
  const connect = read('1p-mls-connect.js');
  ok(/data:,mls-connect\.staging\.js/.test(connect),
    '1p-mls-connect.js no longer plants the prod-enable marker - re-derive whether stx activates on /1p');
  ok(/data-mls-exact-enable/.test(connect), 'the prod-enable marker lost its identifying attribute');
  ok(/type\s*=\s*'text\/plain'/.test(connect),
    'the prod-enable marker is no longer inert (type text/plain) - it may now execute the staging bundle');

  /* FACT 2: the clean workspace owns Settings on this lane, and its grid puts
     content in column 2 with NO !important - which is why stx's
     grid-column:1!important wins and moves the sections into the rail. */
  const clean = read('feat_athena_tooltip_dedupe.js');
  ok(/#settingsModal\.mls-settings-clean \.modal>\*\{grid-column:2;/.test(clean),
    'the clean Settings workspace no longer places content in column 2 without !important - re-derive the collision');
  ok(/#settingsModal\.mls-settings-clean #settingsTabBar\{grid-column:1!important;grid-row:1\/span 80!important/.test(clean),
    'the clean Settings rail no longer spans 80 rows of column 1 - re-derive the collision');
  ok(/grid-column:1!important/.test(stx), 'stx no longer forces sections into column 1 - re-derive item 10');

  /* FACT 3: the retirement already exists in cs-2.0.0, and this lane only
     moved WHEN it runs. If its own call ever leaves, this block is doing
     something the app no longer sanctions and must be re-argued. */
  ok(/__mlsStx\.revert\(\)/.test(clean),
    'feat_athena_tooltip_dedupe.js no longer retires stx itself - this lane\'s block would be inventing policy');
  ok(/stxGone/.test(read(path.join('tests', 'e2e', 'run-e2e.js'))),
    'the e2e suite no longer asserts the legacy stx skin is gone - re-argue the fix for item 10');
}

/* ============================================================ PART 2: runtime */

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml'
};
function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/') p = '/1pScribeFlow.html';
      const file = path.resolve(root, '.' + p);
      if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
      fs.readFile(file, (err, buf) => {
        if (err) { res.writeHead(404); res.end('x'); return; }
        res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
        res.end(buf);
      });
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }));
  });
}

const PATIENT = { id: 'syn-0', patientId: 'syn-0', name: 'Ada Sample', dob: '1980-01-02', mrn: 'MRN100000' };
const NOTE = 'PROCEDURE: Lumbar medial branch block.\nFINDINGS: synthetic fixture text.';
const BOUND = { visitDate: '2026-08-17', provider: 'Sample Provider, MD', appointmentId: '70000017', encounterId: '', encounterUrl: '' };

/* A STALL MUST NAME ITSELF. Opening a BOUND Athena review in this harness
   crashed the renderer twice - measured 8m41s and 8m21s from the open call to
   "Target crashed", once with this lane's own overlay reverted, so it is not
   caused by it. Without a deadline that shows up as a suite that prints
   nothing for fifteen minutes and gets killed, which is how two runs were
   lost. Every page step that can reach the write flow is wrapped. */
function withDeadline(promise, ms, label) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(
        `${label} did not finish within ${ms}ms - the renderer is stalled or crashed, not slow`)), ms);
    })
  ]);
}

/* THE BRIDGE HAS TO BE ANSWERED. bridge() short-circuits only the Athena
   verbs on a localhost host (syntheticLocalRuntime); mlsAppSearchOpenPatient,
   mlsAppGotoDate and mlsExtHealth still post a message and then wait out a
   150s timeout each. This answers them the way a real MLS Assist would, so the
   fixture measures the sheet rather than a stack of dead deadlines. It cannot
   change what is under test: no Athena request reaches it. */
function fakeExtension() {
  window.addEventListener('message', function (ev) {
    var m = ev && ev.data;
    if (!m || m.source !== 'mls-app') return;
    var reply = null;
    if (m.type === 'mlsAppSearchOpenPatient') reply = { type: 'mlsAppSearchOpenResult', resp: { ok: true, opened: true, via: 'appointment-id' } };
    else if (m.type === 'mlsAppGotoDate') reply = { type: 'mlsAppGotoDateResult', resp: { ok: true, supported: true, via: 'weekstrip', schedDate: m.date } };
    else if (m.type === 'mlsExtHealth') reply = { type: 'mlsExtHealthResult', resp: { ok: true, version: '3.0.62', versionName: '3.0.62+synthetic', athena: { tabs: 1, discarded: 0 } } };
    if (!reply) return;
    window.postMessage({ source: 'mls-ext', type: reply.type, requestId: m.requestId, resp: reply.resp }, '*');
  }, false);
  window.__mlsResidueFakeExt = true;
}

/* Force-load one idle-deferred module and WAIT for it. Returns the reason it
   is present, so a silently-absent module fails loudly instead of quietly. */
async function force(page, file, globalName) {
  return page.evaluate(([f, g]) => new Promise((res) => {
    if (window[g]) return res('already-installed');
    if (document.querySelector('script[data-mls-residue-force="' + f + '"]')) return res('already-requested');
    const s = document.createElement('script');
    s.src = f;
    s.setAttribute('data-mls-residue-force', f);
    s.onload = () => res(window[g] ? 'loaded' : 'loaded-but-absent');
    s.onerror = () => res('error');
    document.body.appendChild(s);
  }), [file, globalName]);
}

async function boot(page, port) {
  await page.goto(`http://127.0.0.1:${port}/1pScribeFlow.html`, { waitUntil: 'load', timeout: 90000 });
  await page.waitForTimeout(2500);
  await page.evaluate(() => (typeof window.__mlsEnsureUiBundle === 'function' ? window.__mlsEnsureUiBundle() : null));
  await page.waitForFunction(() => !!window.__mlsSimpleLayer, null, { timeout: 120000 });
  await page.waitForTimeout(6000);
  await page.evaluate(() => {
    const a = document.getElementById('authScreen'); if (a) a.style.display = 'none';
    const s = document.getElementById('appScreen'); if (s) s.style.display = '';
    const st = document.createElement('style');
    st.textContent = '.modal-bg.show,.modal-bg.show .modal{opacity:1!important}';
    document.head.appendChild(st);
    window.__mlsHarnessAccountEmail = 'ui-harness@mlsscribe.test';
    try { window.__mlsDeferAsset = function (fn) { return setTimeout(fn, 0); }; } catch (e) {}
  });
  await page.evaluate(fakeExtension);
  await page.waitForTimeout(600);
}

async function runtime() {
  const { srv, port } = await serve();
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const pageErrors = [];

  try {
    let page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
    page.on('pageerror', (e) => pageErrors.push(String(e.message).slice(0, 160)));
    await boot(page, port);

    step('2E settings');
    /* ===================================================== 2E: item 10 ====
     * The window is: Settings is ALREADY OPEN (so cs-2.0.0's reconcile pass,
     * which is the only thing that retires stx, has already run) and only then
     * does the idle-deferred stylesheet arrive. Measured with the watcher off,
     * then with it on, in one page. */
    const settings = await withDeadline(page.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      function vis(el) {
        const b = el.getBoundingClientRect();
        if (b.width <= 0 || b.height <= 0) return false;
        const c = getComputedStyle(el);
        return !(c.display === 'none' || c.visibility === 'hidden' || c.opacity === '0');
      }
      function snap() {
        const modal = document.querySelector('#settingsModal .modal');
        if (!modal) return { modal: false };
        const r = modal.getBoundingClientRect();
        const inBox = Array.prototype.slice.call(modal.querySelectorAll('*')).filter((e) => {
          if (!vis(e)) return false;
          const b = e.getBoundingClientRect();
          return b.bottom > r.top && b.top < r.bottom && b.right > r.left && b.left < r.right;
        });
        let chars = 0;
        inBox.forEach((e) => {
          let own = '';
          Array.prototype.slice.call(e.childNodes).forEach((n) => { if (n.nodeType === 3) own += n.nodeValue; });
          chars += own.trim().length;
        });
        const active = modal.querySelector('.set-section.on') ||
          Array.prototype.slice.call(modal.querySelectorAll('.set-section')).filter(vis)[0] || null;
        return { modal: true, chars: chars, nodes: inBox.length,
          activeTop: active ? Math.round(active.getBoundingClientRect().top) : null,
          cardBottom: Math.round(r.bottom), scrollH: modal.scrollHeight,
          stx: !!document.getElementById('stxStyle') };
      }
      function loadStx() {
        return new Promise((res) => {
          const s = document.createElement('script');
          s.src = 'feat_mls_settings_exact.js?probe=' + Date.now();
          s.onload = () => res('loaded'); s.onerror = () => res('error');
          document.body.appendChild(s);
        });
      }
      const out = {};
      try { if (typeof window.openSettings === 'function') window.openSettings(); } catch (e) { out.openErr = String(e && e.message); }
      await sleep(1500);
      out.cleanOwns = window.__mlsResidueSettings.cleanWorkspaceOwns();
      out.healthy = snap();

      /* THE DEFECT, with this block's watcher off. */
      window.__mlsResidueSettings.revert();
      out.load = await loadStx();
      out.stxInstalled = !!(window.__mlsStx && window.__mlsStx.installed);
      await sleep(1500);
      out.broken = snap();

      /* THE FIX. */
      window.__mlsResidueSettings.reapply();
      await sleep(600);
      out.fixed = snap();
      out.retired = window.__mlsResidueSettings.retired();
      try { if (typeof window.closeSettings === 'function') window.closeSettings(); } catch (e) {}
      return out;
    }), 120000, 'the Settings late-stylesheet measurement');
    measured.settings = settings;
    ok(settings.healthy && settings.healthy.modal, `the Settings dialog did not open (${settings.openErr || 'no error'})`);
    eq(settings.cleanOwns, true,
      'the clean Settings workspace does not own #settingsModal here, so stx is the sanctioned fallback and this block must stand down');
    eq(settings.stxInstalled, true,
      'feat_mls_settings_exact.js did NOT activate on /1p - the two earlier lanes were right after all and item 10 must be re-derived');
    ok(settings.healthy.chars > 800,
      `the dialog only had ${settings.healthy.chars} characters BEFORE the stylesheet, so there is no healthy baseline to compare against`);

    /* the defect, measured */
    eq(settings.broken.stx, true, 'with the watcher off #stxStyle did not land, so the defect was not reproduced');
    ok(settings.broken.chars < settings.healthy.chars / 3,
      `the late stylesheet left ${settings.broken.chars} characters of ${settings.healthy.chars} - expected the dialog to blank (RESIDUE 10 baseline)`);
    ok(settings.broken.activeTop > settings.broken.cardBottom,
      `the active section stayed at y=${settings.broken.activeTop} inside a card ending at ${settings.broken.cardBottom} - item 10 did not reproduce`);

    /* and the fix */
    eq(settings.fixed.stx, false,
      'the retired stylesheet is still in the document after the watcher ran (RESIDUE 10)');
    ok(settings.retired >= 1, `the watcher reported ${settings.retired} retirements`);
    ok(settings.fixed.chars >= settings.healthy.chars * 0.9,
      `after the fix the dialog holds ${settings.fixed.chars} characters, was ${settings.healthy.chars} before the stylesheet (RESIDUE 10)`);
    ok(settings.fixed.activeTop < settings.fixed.cardBottom,
      `after the fix the active section is still at y=${settings.fixed.activeTop}, below the card bottom ${settings.fixed.cardBottom} (RESIDUE 10)`);

    step('2A unbound strip');
    /* ===================================================== 2A: item 1 ===== */
    const wbw = await force(page, 'feat_mls_writeback_walkthrough.js', '__mlsWritebackWalkthrough');
    measured.wbwLoad = wbw;
    ok(wbw === 'loaded' || wbw === 'already-installed',
      `the write-back walkthrough module did not install (${wbw}), so #wbwSteps could not mount and item 1 could not be measured`);

    const unbound = await withDeadline(page.evaluate(async ([pt, note]) => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const out = {};
      window._calAppts = [];
      const manifest = window.__mlsWriteFlow.openUnifiedConfirmation({ patient: pt, sections: [{ key: 'note', text: note }] });
      await sleep(900);
      out.rows = (manifest && manifest.rows || []).map((r) => ({ id: r.id, capability: r.capability }));
      out.ready = out.rows.filter((r) => r.capability === 'ready').length;
      out.radios = document.querySelectorAll('#mlsAthenaUnifiedConfirm input[name="mlsAthenaUnifiedAction"]').length;
      const host = document.getElementById('wbwSteps');
      out.mounted = !!host;
      if (!host) return out;

      /* THE DEFECT, read off the module's own reader before the overlay is
         allowed to answer: evalSteps() is exported as _eval. */
      const raw = window.__mlsWritebackWalkthrough._eval();
      out.moduleCheck = raw.check;
      out.moduleConfirm = raw.confirm;
      out.ctxText = (document.getElementById('mlsAthenaUnifiedContext').textContent || '').replace(/\s+/g, ' ').trim();

      /* now the overlay's own reading of the same DOM */
      window.__mlsResidueAthena.pass();
      await sleep(120);
      const chips = Array.prototype.slice.call(host.querySelectorAll('[data-mls-residue-step]'));
      out.chips = chips.map((c) => ({ step: c.getAttribute('data-mls-residue-step'), state: c.getAttribute('data-mls-residue-state') }));
      out.hint = (host.querySelector('[data-mls-residue-hint="1"]').textContent || '').replace(/\s+/g, ' ').trim();
      out.states = window.__mlsResidueAthena.states();

      /* IDEMPOTENCE: a second and third pass over an unchanged sheet must not
         write the strip again - the whole point of residue item 5. */
      const before = window.__mlsResidueAthena.stripWrites();
      window.__mlsResidueAthena.pass();
      window.__mlsResidueAthena.pass();
      out.extraWrites = window.__mlsResidueAthena.stripWrites() - before;

      /* THE OTHER SIDE. Write the exact heading renderUnifiedContext writes
         when a read-only check comes back LOCKED, and the honest reader must
         report step 2 done - otherwise this fix is just "always say todo". */
      document.getElementById('mlsAthenaUnifiedContext').innerHTML =
        '<b>Exact Athena encounter verified read-only</b><div>Patient</div>';
      out.lockedStates = window.__mlsResidueAthena.states();
      try { window.__mlsWriteFlow.closeUnifiedConfirmation(); } catch (e) {}
      return out;
    }, [PATIENT, NOTE]), 90000, 'the UNBOUND review');

    measured.unbound = { ready: unbound.ready, radios: unbound.radios, moduleCheck: unbound.moduleCheck,
      chips: unbound.chips, extraWrites: unbound.extraWrites };

    ok(unbound.mounted, 'the walkthrough strip #wbwSteps did not mount even with the module loaded and the sheet open');
    eq(unbound.ready, 0, `the UNBOUND fixture produced ${unbound.ready} READY rows - it is not unbound and item 1 is not being measured`);
    eq(unbound.radios, 0, `the UNBOUND fixture rendered ${unbound.radios} selectable radios - a blocked row must have none`);
    ok(/being verified read-only now/i.test(unbound.ctxText),
      `the sheet's first paint of the context box changed to "${unbound.ctxText.slice(0, 60)}" - item 1's root cause must be re-derived`);

    /* the defect itself, still present in the module and now pinned */
    eq(unbound.moduleCheck, 'done',
      'feat_mls_writeback_walkthrough.js no longer reports "Athena checks it" DONE on an unbound sheet - the overlay may be removable, re-derive item 1');
    eq(unbound.moduleConfirm, 'now',
      'the module no longer points the doctor at Confirm on an unbound sheet - re-derive item 1');

    /* the overlay's answer */
    const byStep = {};
    (unbound.chips || []).forEach((c) => { byStep[c.step] = c.state; });
    measured.unboundChips = byStep;
    eq((unbound.chips || []).length, 4, 'the corrected strip does not carry four steps');
    eq(byStep.check, 'todo',
      `the corrected strip still shows "Athena checks it" as ${byStep.check} on a sheet that sent zero requests to Athena (RESIDUE 1)`);
    eq(byStep.confirm, 'todo',
      `the corrected strip still points at Confirm (${byStep.confirm}) on a permanently disabled Confirm (RESIDUE 1)`);
    eq(byStep.pick, 'blocked',
      `an UNBOUND sheet with no selectable row shows step 1 as ${byStep.pick} - it must say the step is not reachable (RESIDUE 1)`);
    ok(/nothing to pick|not/i.test(unbound.hint) && /Athena has not been contacted/.test(unbound.hint),
      `the hint under an unbound strip reads "${unbound.hint.slice(0, 80)}" (RESIDUE 1)`);
    ok(!/Athena confirmed the exact encounter/.test(unbound.hint),
      'the strip still claims Athena confirmed the encounter on an unbound sheet (RESIDUE 1)');
    eq(unbound.extraWrites, 0,
      `the corrected strip rewrote itself ${unbound.extraWrites} more times over an unchanged sheet`);

    /* two-sided: the honest reader is not a constant */
    eq(unbound.lockedStates && unbound.lockedStates.check, 'done',
      'with the sheet\'s own "verified read-only" heading present the corrected strip STILL says the check is not done - the reader is stuck, not honest');

    /* the pure renderer, over every state the sheet can reach */
    const rendered = await page.evaluate(() => {
      const r = window.__mlsResidueAthena;
      const all = r._render({ unbound: false, pick: 'done', check: 'done', confirm: 'done', verify: 'done' });
      const none = r._render({ unbound: false, pick: 'now', check: 'todo', confirm: 'todo', verify: 'todo' });
      return {
        allDone: (all.match(/data-mls-residue-state="done"/g) || []).length,
        noneDone: (none.match(/data-mls-residue-state="done"/g) || []).length,
        allHint: r.hint({ unbound: false, verify: 'done' }),
        unboundHint: r.hint({ unbound: true })
      };
    });
    measured.render = rendered;
    eq(rendered.allDone, 4, 'the renderer cannot show four completed steps');
    eq(rendered.noneDone, 0, 'the renderer marks a step done when no state says done');
    ok(/All four steps are done/.test(rendered.allHint), 'the completed hint was lost');
    ok(rendered.unboundHint !== rendered.allHint, 'the unbound hint is the same sentence as the completed one');

    step('2B sign and save');
    /* ===================================================== 2B: item 25 ==== */
    const sign = await withDeadline(page.evaluate(async ([pt, note, bound]) => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const out = {};
      /* a capable MLS Assist is what turns sign-encounter into a READY row */
      window.__mlsExtensionCapabilities = { athenaFinalActionsV1: true, supervisedOrderPlacementV2: true };
      const manifest = window.__mlsWriteFlow.openUnifiedConfirmation({
        patient: pt, sections: [{ key: 'note', text: note }], expectedContext: bound
      });
      await sleep(900);
      const rows = (manifest && manifest.rows || []);
      const signRow = rows.filter((r) => r.id === 'sign-encounter')[0] || null;
      out.signCapability = signRow ? signRow.capability : '(no sign row)';
      const card = document.getElementById('mlsAthenaUnifiedConfirm');
      out.opened = !!card;
      if (!card) return out;
      const section = card.querySelector('section[data-manifest-row="sign-encounter"]');
      out.sectionPresent = !!section;
      out.signRadio = !!(section && section.querySelector('input[name="mlsAthenaUnifiedAction"]'));

      /* THE DEFECT: selecting it refuses immediately, before any bridge call. */
      window.__mlsResidueAthena.pass();
      await sleep(150);
      out.lockedBefore = section ? section.getAttribute('data-mls-residue-locked') : null;
      out.lockChip = !!(section && section.querySelector('[data-mls-residue-lock="1"]'));
      out.lockWhy = section ? ((section.querySelector('.mls-residue-lockwhy') || {}).textContent || '') : '';
      out.verifiedBefore = window.__mlsResidueAthena.noteWriteVerified();

      const radio = section && section.querySelector('input[name="mlsAthenaUnifiedAction"]');
      if (radio) {
        radio.checked = true;
        radio.dispatchEvent(new Event('change', { bubbles: true }));
        await sleep(400);
      }
      out.refusal = (document.getElementById('mlsAthenaUnifiedProbe').textContent || '').replace(/\s+/g, ' ').trim();

      /* THE OTHER SIDE. Seed a verified note-write receipt into the write
         flow's OWN live state object - the same shape resultToUnifiedReceipt
         writes - because a real verified write cannot happen here: bridge()
         short-circuits every mlsAppAthenaAction on 127.0.0.1
         (syntheticLocalRuntime), by design. */
      const st = window.__mlsWriteFlow.diagnostics.state();
      out.stateLive = !!st;
      if (st) st.receipts['write-note'] = { status: 'verified', message: 'synthetic fixture receipt' };
      out.verifiedAfter = window.__mlsResidueAthena.noteWriteVerified();
      window.__mlsResidueAthena.pass();
      await sleep(150);
      out.lockedAfter = section ? section.getAttribute('data-mls-residue-locked') : null;
      out.lockChipAfter = !!(section && section.querySelector('[data-mls-residue-lock="1"]'));
      try { window.__mlsWriteFlow.closeUnifiedConfirmation(); } catch (e) {}
      window.__mlsExtensionCapabilities = null;
      return out;
    }, [PATIENT, NOTE, BOUND]), 120000, 'the BOUND review (item 25)');

    measured.sign = sign;
    ok(sign.opened, 'the bound review sheet did not open, so item 25 was not measured');
    eq(sign.signCapability, 'ready',
      `with a capable extension the sign row is "${sign.signCapability}" - item 25's premise (offered as ready) is gone`);
    ok(sign.sectionPresent, 'the sign-encounter row did not render in the sheet');
    eq(sign.signRadio, true, 'the sign-encounter row carries no radio - it is not being offered, so item 25 is not being measured');
    ok(/Write the reviewed note to this encounter first/.test(sign.refusal),
      `selecting Sign & Save did not produce the refusal item 25 is about; the status read "${sign.refusal.slice(0, 90)}"`);
    eq(sign.verifiedBefore, false, 'a fresh review already reports a verified note write - the lock predicate is broken');
    eq(sign.lockedBefore, '1',
      'Sign & Save is offered with no sign that it cannot run yet - the doctor can only find out by clicking (RESIDUE 25)');
    ok(sign.lockChip, 'the sign row carries no LOCKED marker (RESIDUE 25)');
    ok(/unlocks only after/.test(sign.lockWhy) && /Write the note first/.test(sign.lockWhy),
      `the lock does not say what unlocks it: "${sign.lockWhy.slice(0, 80)}" (RESIDUE 25)`);
    eq(sign.stateLive, true, 'the write flow exposed no live state object, so the unlock side could not be driven');
    eq(sign.verifiedAfter, true, 'the lock predicate ignores a verified note-write receipt in the write flow\'s own state');
    eq(sign.lockedAfter, null, 'the lock stayed on after a verified note write - it would outlive its own reason (RESIDUE 25)');
    eq(sign.lockChipAfter, false, 'the LOCKED chip stayed on after a verified note write (RESIDUE 25)');

    step('2D op-note rail');
    /* ============================================ 2D: the op-note rail ==== */
    const room = await force(page, 'feat_mls_opnote_room.js', '__mlsOpNoteRoom');
    measured.roomLoad = room;
    const perf = await withDeadline(page.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const out = {};
      const PROC = 'Lumbar medial branch block';
      const DAY = '2026-08-17';
      try {
        setTemplates([{ id: 'syn-t0', name: PROC, body: 'PROCEDURE: ' + PROC, kind: 'op' }]);
        savePatients([{ id: 'syn-0', name: 'Ada Sample', dob: '1980-01-02', mrn: 'MRN100000', notes: [], visits: [] }]);
      } catch (e) { out.seedErr = String(e && e.message); }
      try { if (typeof window.openOpPrep === 'function') window.openOpPrep(); } catch (e) { out.openErr = String(e && e.message); }
      await sleep(600);
      try {
        window._opPrep = [_opNewRow('Ada Sample', PROC, '1980-01-02', DAY, 'syn-0', { name: 'Ada Sample', reason: PROC }, DAY)];
        opPrepRender();
      } catch (e) { out.renderErr = String(e && e.message); }
      await sleep(600);

      const box = document.getElementById('oprTplMode');
      out.boxPresent = !!box;
      out.buttons = box ? box.querySelectorAll('.opr-tplmode').length : 0;
      out.titles = box ? Array.prototype.slice.call(box.querySelectorAll('.opr-tplmode')).filter((b) => !!b.getAttribute('title')).length : 0;
      if (!box) return out;

      /* Count the way the opnotes4 lane counted: every .opr-tplmode node that
         arrives carrying a title, plus the raw childList record count.
         THE DRIVER IS COUNTED, NOT TIMED. The field report is "234 title
         updates per 8 s", which is 78 re-renders of the room; driving that on
         a wall clock makes the BEFORE number depend on how many other lanes
         are running headless Chrome on this machine, and a starved BEFORE
         would make the AFTER look like a fix it had not earned. So the driver
         issues exactly 78 re-renders and the elapsed time is REPORTED rather
         than assumed. */
      async function measure(renders) {
        let records = 0, titled = 0;
        const mo = new MutationObserver((list) => {
          list.forEach((m) => {
            records++;
            Array.prototype.slice.call(m.addedNodes || []).forEach((n) => {
              if (n.nodeType !== 1) return;
              if (n.getAttribute && n.getAttribute('title')) titled++;
              if (n.querySelectorAll) titled += Array.prototype.slice.call(n.querySelectorAll('[title]')).length;
            });
          });
        });
        mo.observe(box, { childList: true, subtree: true, attributes: true, attributeFilter: ['title'] });
        const t0 = Date.now();
        for (let i = 0; i < renders; i++) {
          try { opPrepRender(); } catch (e) {}
          await new Promise((r) => setTimeout(r, 0));
        }
        const ms = Date.now() - t0;
        await new Promise((r) => setTimeout(r, 300));
        mo.disconnect();
        return { records, titled, renders, ms };
      }

      /* BEFORE: the guard off, 78 re-renders - the count the opnotes4 lane
         measured over 8 seconds of the room being used. */
      window.__mlsResidueOprPerf.revert();
      out.guardOffInstalled = window.__mlsResidueOprPerf.installed();
      out.before = await measure(78);

      /* AFTER: the same driver, same count, guard back on. */
      window.__mlsResidueOprPerf.check();
      out.guardOnInstalled = window.__mlsResidueOprPerf.installed();
      const skipped0 = window.__mlsResidueOprPerf.skipped();
      out.after = await measure(78);
      out.skippedDelta = window.__mlsResidueOprPerf.skipped() - skipped0;

      /* AND THE GUARD MUST NOT SWALLOW A REAL CHANGE. */
      const html0 = box.innerHTML;
      box.innerHTML = '<button type="button" class="opr-tplmode" title="synthetic">x</button>';
      out.realChangeLanded = box.querySelectorAll('.opr-tplmode').length === 1 && box.innerHTML !== html0;
      const wrote0 = window.__mlsResidueOprPerf.wrote();
      box.innerHTML = '<button type="button" class="opr-tplmode" title="synthetic">x</button>';
      out.identicalDropped = window.__mlsResidueOprPerf.wrote() === wrote0;
      try { opPrepRender(); } catch (e) {}
      out.restoredButtons = box.querySelectorAll('.opr-tplmode').length;
      try { if (typeof window.closeOpPrep === 'function') window.closeOpPrep(); } catch (e) {}
      return out;
    }), 180000, 'the op-note rail measurement');

    measured.perf = perf;
    ok(perf.boxPresent, `#oprTplMode never rendered (${perf.openErr || perf.renderErr || 'no error reported'}), so the churn could not be measured`);
    eq(perf.buttons, 3, `#oprTplMode holds ${perf.buttons} mode buttons, expected the module's three`);
    eq(perf.titles, 3, `${perf.titles} of the mode buttons carry a title attribute, expected 3`);
    eq(perf.guardOffInstalled, false, 'revert() left the guard on, so the BEFORE number is not a before');
    eq(perf.guardOnInstalled, true, 'the guard did not re-install, so the AFTER number is not an after');
    ok(perf.before.titled >= 200,
      `the unguarded room wrote only ${perf.before.titled} titles over 78 re-renders - the churn did not reproduce, so the AFTER number proves nothing`);
    eq(perf.after.titled, 0,
      `the guarded room still wrote ${perf.after.titled} identical titles over 78 re-renders (was ${perf.before.titled})`);
    eq(perf.after.records, 0,
      `the guarded rail still took ${perf.after.records} mutation records over 78 re-renders (was ${perf.before.records})`);
    ok(perf.skippedDelta >= 70,
      `the guard only dropped ${perf.skippedDelta} identical writes out of 78 re-renders`);
    eq(perf.realChangeLanded, true, 'the guard swallowed a DIFFERENT markup string - it is not a coalescer, it is a mute');
    eq(perf.identicalDropped, true, 'the guard passed an identical string through');
    eq(perf.restoredButtons, 3, 'the room could not rebuild its three buttons through the guard');

    await page.close();

    step('2C phone notice shelf');
    /* ============================================ 2C: item 69, 390x844 ==== */
    page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    page.on('pageerror', (e) => pageErrors.push(String(e.message).slice(0, 160)));
    await boot(page, port);

    const shelf = await withDeadline(page.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const out = {};
      /* The four preconditions mlsMobileNoticeShelf() demands, asserted rather
         than assumed - the previous lane measured a shelf that never existed. */
      out.mobile = !!(window.matchMedia && window.matchMedia('(max-width: 760px)').matches);
      out.appScreen = !!(document.getElementById('appScreen') && getComputedStyle(document.getElementById('appScreen')).display !== 'none');
      out.appWrap = !!document.getElementById('appWrap');
      out.redesign = document.body.classList.contains('mls-redesign');
      /* the fifth: quietnotify only lets an ACTION-NEEDED message reach the
         shell's own toast(), and only that path builds the shelf. */
      out.classify = window.__mlsQuietNotify ? window.__mlsQuietNotify.classify('Your session expired - sign in again to keep working.', 'err') : '(no quietnotify)';
      try { window.toast('Your session expired - sign in again to keep working.', 'err'); } catch (e) { out.toastErr = String(e && e.message); }
      await sleep(400);
      out.built = window.__mlsResidueNotice.probe();

      /* make the page tall enough to scroll, then scroll the way a doctor
         working down a chart does */
      const pad = document.createElement('div');
      pad.style.height = '2000px';
      document.getElementById('appWrap').appendChild(pad);
      window.scrollTo(0, 900);
      await sleep(300);
      out.scrolled = window.__mlsResidueNotice.probe();

      /* THE DIFFERENTIAL: the same scroll with this block's stylesheet off is
         the defect the audit described. */
      window.__mlsResidueNotice.revert();
      await sleep(200);
      out.reverted = window.__mlsResidueNotice.probe();
      try { document.getElementById('mlsResidueNoticeCss').disabled = false; } catch (e) {}
      await sleep(200);
      out.restored = window.__mlsResidueNotice.probe();
      pad.remove();
      window.scrollTo(0, 0);
      return out;
    }), 90000, 'the phone notice shelf');

    measured.shelf = shelf;
    eq(shelf.mobile, true, 'the phone viewport does not match the shell\'s own (max-width:760px) test');
    eq(shelf.appScreen, true, '#appScreen is display:none, so mlsMobileNoticeShelf() refuses and item 69 cannot mount');
    eq(shelf.appWrap, true, '#appWrap is missing');
    eq(shelf.redesign, true, 'body has no mls-redesign class, so mlsMobileNoticeShelf() refuses');
    eq(shelf.classify, 'action',
      `quietnotify classified the fixture message as "${shelf.classify}", so it never reached the shell's toast() and no shelf was built (this is why the previous lane found no shelf)`);
    ok(shelf.built && shelf.built.present,
      'the phone notice shelf still did not mount with all five preconditions satisfied - item 69 remains unreproducible');
    eq(shelf.built.active, true, 'the shelf mounted but never became active, so it has no box to measure');

    /* the defect, measured with this block's stylesheet OFF */
    ok(shelf.reverted && shelf.reverted.position === 'static',
      `with the fix off the shelf computes position:${shelf.reverted && shelf.reverted.position} - the differential has no baseline`);
    ok(shelf.reverted.top < 0,
      `with the fix off the shelf sits at y=${shelf.reverted.top} after a 900px scroll - it was expected to be above the viewport (RESIDUE 69 baseline)`);
    eq(shelf.reverted.inView, false, 'with the fix off the notice was still in view, so item 69 does not reproduce here');

    /* and with it on */
    eq(shelf.scrolled.position, 'sticky',
      `after the fix the shelf computes position:${shelf.scrolled.position} - sticky did not apply (an overflow ancestor would do this)`);
    eq(shelf.scrolled.inView, true,
      `after a 900px scroll the notice is at y=${shelf.scrolled.top}, off screen (RESIDUE 69)`);
    ok(shelf.scrolled.top >= 0 && shelf.scrolled.top < 844,
      `the sticky notice landed at y=${shelf.scrolled.top} on an 844px screen`);
    eq(shelf.restored.inView, true, 'the fix did not come back when its stylesheet was re-enabled');

    await page.close();
    ok(pageErrors.length === 0, 'the page threw: ' + pageErrors.slice(0, 3).join(' | '));
  } finally {
    await browser.close();
    srv.close();
  }
}

runtime().then(() => {
  console.log('MEASURED ' + JSON.stringify(measured));
  console.log(`1p-residue-contract: ${checks} checks passed`);
}).catch((e) => {
  console.error('1p-residue-contract FAILED: ' + (e && e.message));
  process.exit(1);
});
