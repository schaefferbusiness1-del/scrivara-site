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

const BLOCKS = ['residue-athena-1.0.0', 'residue-oprperf-1.0.0', 'residue-notice-1.0.0', 'residue-settings-1.0.0', 'tools-tips-1.0.0'];

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

/* ===== PART 1C: item 25 - the two halves PART 2B cannot open a sheet for ===
 *
 * PART 2B measures the lock on a sign row it injects into a real (unbound)
 * card, because opening a BOUND review stalls this harness's renderer. Two
 * things therefore have to be pinned against the write-flow's own source
 * instead, or the fixture could drift into measuring nothing:
 *
 *   1. the MARKUP a ready row really emits - every selector the overlay and
 *      the fixture depend on;
 *   2. the REFUSAL itself - that selecting Sign & Save with no verified note
 *      write is turned away, before any bridge call.
 */
{
  const flow = read('1p-feat_mls_writeflow.js');

  /* 1: the ready-row markup the overlay hooks into */
  ok(/function unifiedReadyRowHtml\(/.test(flow), 'unifiedReadyRowHtml is gone - the ready-row shape moved');
  const readyRow = flow.slice(flow.indexOf('function unifiedReadyRowHtml('), flow.indexOf('function unifiedManualRowHtml('));
  ok(/data-manifest-row="/.test(readyRow), 'a ready row no longer carries data-manifest-row - the overlay cannot find the sign row');
  ok(/<input type="radio" name="mlsAthenaUnifiedAction"/.test(readyRow),
    'a ready row no longer carries the mlsAthenaUnifiedAction radio - "offered as selectable" would be untrue');
  ok(/data-mls-ready-tick="/.test(readyRow), 'the ready tick the lock chip anchors beside is gone');
  ok(/<label /.test(readyRow) && /<b style=/.test(readyRow),
    'the ready row no longer wraps its title in a label/<b> - the lock chip and reason line would land in the wrong place');
  /* a BLOCKED row must keep having no radio - that is what makes a historical
     review with no exact visit have zero selectable rows, which PART 2A
     depends on. A wholly unbound CURRENT review is intentionally different:
     its ready rows may start the safe read-only encounter-discovery probe. */
  const blockedRow = flow.slice(flow.indexOf('function unifiedBlockedRowHtml('), flow.indexOf('function unifiedBlockedRowHtml(') + 900);
  ok(!/name="mlsAthenaUnifiedAction"/.test(blockedRow),
    'a BLOCKED row now renders a radio - a historical unbound sheet would no longer have zero selectable rows and PART 2A is measuring something else');

  /* 2: the refusal item 25 is about, before any bridge call */
  ok(/row\.action === 'sign_encounter' && \(!priorWrite \|\| !priorWrite\.noteWriteProof\)/.test(flow),
    'the sign-encounter precondition is gone from probeUnifiedRow - item 25 must be re-derived');
  ok(/Write the reviewed note to this encounter first/.test(flow),
    'the refusal text item 25 names is gone from the write flow');
  /* and the precondition must still be checked BEFORE the bridge call, which
     is what makes it "always refuses" rather than "sometimes times out" */
  const probeFn = flow.slice(flow.indexOf('function probeUnifiedRow('));
  const refusalAt = probeFn.indexOf('Write the reviewed note to this encounter first');
  const bridgeAt = probeFn.indexOf("bridge('mlsAppAthenaActionV2'");
  ok(refusalAt > 0 && bridgeAt > 0 && refusalAt < bridgeAt,
    'the Sign & Save precondition is no longer checked before the Athena bridge call - the refusal is no longer immediate');
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

/* THE BRIDGE HAS TO BE ANSWERED, AND THE OPEN HAS TO BE ANSWERED "NO".
 *
 * bridge() short-circuits only the Athena verbs on a localhost host
 * (syntheticLocalRuntime); mlsAppSearchOpenPatient, mlsAppGotoDate and
 * mlsExtHealth still post a message and wait out a 150s timeout each. So the
 * bridge must be answered - but WHAT it is answered with decides whether this
 * fixture terminates, and the first version of it did not:
 *
 *   1p-feat_mls_writeflow.js:1801-1805 - when the read-only probe is refused,
 *   the flow auto-attempts to open the chart, and if that open SUCCEEDS it
 *   re-probes 1500ms later. There is no attempt counter on that path. On a
 *   localhost host the probe is refused instantly and unconditionally
 *   (synthetic-local-only), so answering the open with ok:true produces
 *   refuse -> open -> re-probe -> refuse, once every 1.5s, forever, appending
 *   a receipt each cycle. Answering it ok:true is what an extension would
 *   really say, and it is exactly wrong here.
 *
 * A synthetic host has no athenaOne tab, so the honest answer is the one the
 * VM harness in 1p-athena-write-readiness-and-probe-only.test.js already
 * uses: the exact appointment row could not be opened. The flow then shows
 * its recheck button and STOPS, which is the state item 25 is measured in.
 * No Athena request reaches this responder either way.
 *
 * This is a characterisation, not a fix: the unbounded re-probe belongs to
 * the write-flow module another session owns, and the ~8.5-minute renderer
 * crash on a bound review is being investigated there, not here. */
function fakeExtension() {
  window.addEventListener('message', function (ev) {
    var m = ev && ev.data;
    if (!m || m.source !== 'mls-app') return;
    var reply = null;
    if (m.type === 'mlsAppSearchOpenPatient') {
      reply = { type: 'mlsAppSearchOpenResult', resp: { ok: false, opened: false, reason: 'appointment-id-not-found',
        error: 'The exact Athena appointment row could not be opened. No name fallback was attempted.' } };
    } else if (m.type === 'mlsAppGotoDate') {
      reply = { type: 'mlsAppGotoDateResult', resp: { ok: false, supported: true, via: 'weekstrip',
        error: 'No athenaOne tab is open in this synthetic fixture.' } };
    } else if (m.type === 'mlsExtHealth') {
      reply = { type: 'mlsExtHealthResult', resp: { ok: true, version: '3.0.62', versionName: '3.0.62+synthetic', athena: { tabs: 0, discarded: 0 } } };
    }
    if (!reply) return;
    window.postMessage({ source: 'mls-ext', type: reply.type, requestId: m.requestId, resp: reply.resp }, '*');
  }, false);
  /* a counter, so a fixture that silently stops answering is visible */
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
  /* THE DOCK IS NOT THERE UNLESS THE CALM SHELL IS MADE TO LOAD. Its loader
     schedules feat_mls_calm_shell.js through __mlsDeferAsset ||
     requestIdleCallback, which never fires in a non-compositing tab, so
     #mlsDock and its Tools menu are simply absent and any assertion about
     them would pass vacuously. Same two steps 1p-clunky-contract uses. */
  await page.evaluate(() => {
    try { if (window.__mlsP1CalmDock && typeof window.__mlsP1CalmDock.ensure === 'function') window.__mlsP1CalmDock.ensure(); } catch (e) {}
  });
  await page.waitForTimeout(2000);
  await page.evaluate(() => {
    try { if (window.__mlsCalmShell && typeof window.__mlsCalmShell.boot === 'function') window.__mlsCalmShell.boot(); } catch (e) {}
  });
  await page.waitForTimeout(1200);
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
      /* Current reviews with a wholly empty locator intentionally expose the
         read-only discovery lane. Use the still-valid fail-closed case this
         residue is about: a historical review with no exact visit. */
      const manifest = window.__mlsWriteFlow.openUnifiedConfirmation({
        patient: pt, sections: [{ key: 'note', text: note }], requireExpectedVisit: true
      });
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
    eq(unbound.ready, 0, `the historical UNBOUND fixture produced ${unbound.ready} READY rows - it is not fail-closed and item 1 is not being measured`);
    eq(unbound.radios, 0, `the historical UNBOUND fixture rendered ${unbound.radios} selectable radios - a blocked row must have none`);
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
    /* ===================================================== 2B: item 25 ====
     * THE BOUND REVIEW CANNOT BE OPENED IN THIS HARNESS, and that is a
     * characterisation, not a workaround. Measured three times: opening a
     * review whose expectedContext IS bound stalls the renderer and ends in
     * "Target crashed" at ~8.5 minutes. It reproduced with this lane's own
     * overlay REVERTED and with NO capability flags set, so neither is the
     * cause. The mechanism, read out of the write-flow:
     *
     *   bridge() (1p-feat_mls_writeflow.js:118-121) short-circuits EVERY
     *   mlsAppAthenaAction on a localhost host, so the read-only probe is
     *   refused instantly and unconditionally; and on a refused probe the
     *   flow auto-opens the chart and, if that open succeeds, re-probes
     *   1500ms later (:1801-1805) with no attempt counter on that path.
     *
     * That file belongs to another session and the stall is the lead's
     * investigation, so this suite STOPS at naming it: it does not open a
     * bound review at all, and every write-flow page step carries a named
     * deadline so a future stall reports itself in 120s instead of eating a
     * 15-minute run.
     *
     * What is still measured here, and how:
     *   OFFERED  - buildUnifiedManifest() is pure: it builds the manifest and
     *              touches no DOM and no bridge, so it proves the sign row is
     *              handed out as capability 'ready' without opening anything.
     *   REFUSES  - pinned in PART 1 against the write-flow's own source.
     *   THE FIX  - measured on a REAL card with a REAL live state: the
     *              UNBOUND review opens safely (2A drove it), so the sign row
     *              markup is injected into that open card. The markup shape
     *              is not invented - PART 1 pins every selector this depends
     *              on against the write-flow source, so the fixture cannot
     *              quietly drift away from the real sheet. */
    const sign = await withDeadline(page.evaluate(async ([pt, note, bound]) => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const out = {};

      /* ---- OFFERED: the manifest, with no sheet and no bridge ---------- */
      window.__mlsExtensionCapabilities = { athenaFinalActionsV1: true, supervisedOrderPlacementV2: true };
      const capable = window.__mlsWriteFlow.buildUnifiedManifest({
        patient: pt, sections: [{ key: 'note', text: note }], expectedContext: bound
      });
      const capableSign = (capable && capable.rows || []).filter((r) => r.id === 'sign-encounter')[0] || null;
      out.signCapability = capableSign ? capableSign.capability : '(no sign row)';
      out.signAction = capableSign ? capableSign.action : '';
      out.noteCapability = ((capable && capable.rows || []).filter((r) => r.id === 'write-note')[0] || {}).capability || '';

      /* and without a capable extension it is not offered as ready at all */
      window.__mlsExtensionCapabilities = null;
      const older = window.__mlsWriteFlow.buildUnifiedManifest({
        patient: pt, sections: [{ key: 'note', text: note }], expectedContext: bound
      });
      const olderSign = (older && older.rows || []).filter((r) => r.id === 'sign-encounter')[0] || null;
      out.olderSignCapability = olderSign ? olderSign.capability : '(no sign row)';

      /* ---- THE FIX, on the UNBOUND card (safe to open) ------------------ */
      window._calAppts = [];
      window.__mlsWriteFlow.openUnifiedConfirmation({ patient: pt, sections: [{ key: 'note', text: note }] });
      await sleep(900);
      const card = document.getElementById('mlsAthenaUnifiedConfirm');
      out.opened = !!card;
      if (!card) return out;

      /* THE CARD ALREADY HAS A SIGN ROW, and it is the other kind. With no
         capable extension the manifest still adds sign-encounter, as
         capability 'manual' - rendered by unifiedManualRowHtml, which carries
         NO radio because there is nothing to select. The overlay must leave
         that one alone: a manual row already prints its own reason in the
         open, so a LOCKED chip on it would be a second voice saying the same
         thing. Measured here before it is removed, then removed so the card
         holds exactly one sign row, the way a bound sheet does. */
      const manual = card.querySelector('section[data-manifest-row="sign-encounter"]');
      out.manualRowPresent = !!manual;
      out.manualRowHasRadio = !!(manual && manual.querySelector('input[name="mlsAthenaUnifiedAction"]'));
      window.__mlsResidueAthena.pass();
      await sleep(200);
      out.manualRowLocked = manual ? manual.getAttribute('data-mls-residue-locked') : 'no-row';
      out.manualRowChip = !!(manual && manual.querySelector('[data-mls-residue-lock="1"]'));
      if (manual && manual.parentNode) manual.parentNode.removeChild(manual);

      /* the ready-row markup, in the shape unifiedReadyRowHtml emits */
      const host = document.createElement('div');
      host.setAttribute('role', 'radiogroup');
      host.innerHTML =
        '<section data-manifest-row="sign-encounter">' +
        '<label><input type="radio" name="mlsAthenaUnifiedAction" value="sign-encounter" aria-label="Select Sign and Save in Athena for Athena review">' +
        '<span><span><b>Sign &amp; Save in Athena</b>' +
        '<span data-mls-ready-tick="sign-encounter" style="display:none">&#10003; Athena verified</span></span>' +
        '<span>After MLS verifies this exact reviewed note was written to this exact encounter, your one-click confirm clicks that verified Sign &amp; Save control.</span>' +
        '</span></label></section>';
      card.appendChild(host);
      const section = card.querySelector('section[data-manifest-row="sign-encounter"]');
      out.sectionPresent = !!section;
      out.signRadio = !!(section && section.querySelector('input[name="mlsAthenaUnifiedAction"]'));

      out.verifiedBefore = window.__mlsResidueAthena.noteWriteVerified();
      window.__mlsResidueAthena.pass();
      await sleep(200);
      out.lockedBefore = section ? section.getAttribute('data-mls-residue-locked') : null;
      out.lockChip = !!(section && section.querySelector('[data-mls-residue-lock="1"]'));
      out.lockWhy = section ? ((section.querySelector('.mls-residue-lockwhy') || {}).textContent || '') : '';

      /* idempotence: an unchanged row must not grow a second chip per pass */
      window.__mlsResidueAthena.pass();
      window.__mlsResidueAthena.pass();
      await sleep(200);
      out.chipCount = section ? section.querySelectorAll('[data-mls-residue-lock="1"]').length : -1;
      out.whyCount = section ? section.querySelectorAll('.mls-residue-lockwhy').length : -1;

      /* ---- THE OTHER SIDE: a verified note write, in the flow's own state
         object. Seeded rather than performed, because bridge() refuses every
         Athena action on this host by design so no real write can happen -
         but the SHAPE is the flow's own (resultToUnifiedReceipt writes
         status:'verified' under the row id). */
      const st = window.__mlsWriteFlow.diagnostics.state();
      out.stateLive = !!st;
      if (st) st.receipts['write-note'] = { status: 'verified', message: 'synthetic fixture receipt' };
      out.verifiedAfter = window.__mlsResidueAthena.noteWriteVerified();
      window.__mlsResidueAthena.pass();
      await sleep(200);
      out.lockedAfter = section ? section.getAttribute('data-mls-residue-locked') : null;
      out.lockChipAfter = !!(section && section.querySelector('[data-mls-residue-lock="1"]'));

      try { host.remove(); } catch (e) {}
      try { window.__mlsWriteFlow.closeUnifiedConfirmation(); } catch (e) {}
      window.__mlsExtensionCapabilities = null;
      return out;
    }, [PATIENT, NOTE, BOUND]), 120000, 'the sign-and-save lock (item 25)');

    measured.sign = sign;
    /* OFFERED */
    eq(sign.signCapability, 'ready',
      `with a capable extension the sign row is "${sign.signCapability}" - item 25's premise (offered as ready) is gone`);
    eq(sign.signAction, 'sign_encounter', 'the ready sign row carries no sign_encounter action');
    eq(sign.noteCapability, 'ready',
      'the bound fixture did not produce a ready note row, so "offered beside the note write" is not being measured');
    ok(sign.olderSignCapability !== 'ready',
      `without a capable extension the sign row is still "${sign.olderSignCapability}" - the capability gate is not what makes it selectable`);
    /* THE FIX */
    ok(sign.opened, 'the unbound card did not open, so the lock could not be measured on a real card');
    /* the MANUAL sign row is left alone - the overlay speaks only where the
       doctor could otherwise click and be refused */
    eq(sign.manualRowPresent, true, 'the review no longer renders a sign row at all without a capable extension');
    eq(sign.manualRowHasRadio, false, 'the MANUAL sign row now carries a radio - it would be selectable and refusable');
    eq(sign.manualRowLocked, null, 'the overlay locked a MANUAL sign row, which already prints its own reason (RESIDUE 25)');
    eq(sign.manualRowChip, false, 'the overlay put a LOCKED chip on a MANUAL sign row - a second voice for the same fact');
    ok(sign.sectionPresent && sign.signRadio, 'the sign-row fixture did not mount with its radio');
    eq(sign.verifiedBefore, false, 'a fresh review already reports a verified note write - the lock predicate is broken');
    eq(sign.lockedBefore, '1',
      'Sign & Save is offered with no sign that it cannot run yet - the doctor can only find out by clicking (RESIDUE 25)');
    ok(sign.lockChip, 'the sign row carries no LOCKED marker (RESIDUE 25)');
    ok(/unlocks only after/.test(sign.lockWhy) && /Write the note first/.test(sign.lockWhy),
      `the lock does not say what unlocks it: "${sign.lockWhy.slice(0, 80)}" (RESIDUE 25)`);
    eq(sign.chipCount, 1, `three passes over an unchanged row left ${sign.chipCount} LOCKED chips`);
    eq(sign.whyCount, 1, `three passes over an unchanged row left ${sign.whyCount} reason lines`);
    eq(sign.stateLive, true, 'the write flow exposed no live state object, so the unlock side could not be driven');
    eq(sign.verifiedAfter, true, 'the lock predicate ignores a verified note-write receipt in the write flow own state');
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
        let records = 0, titled = 0, added = 0;
        const mo = new MutationObserver((list) => {
          list.forEach((m) => {
            records++;
            /* THE FIELD REPORT'S OWN UNIT. A title update on .opr-tplmode is
               an ATTRIBUTE mutation, and the writer is not the room: the room
               emits three buttons each carrying title="<label> - <hint>", and
               feat_athena_tooltip_dedupe.js then REMOVES all three, because
               that same text is already visible inside the button. So every
               unguarded rebuild costs three title mutations, and 78 rebuilds
               cost 234 - the number the opnotes4 lane reported, exactly. */
            if (m.type === 'attributes' && m.attributeName === 'title') titled++;
            added += Array.prototype.slice.call(m.addedNodes || []).filter((n) => n.nodeType === 1).length;
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
        return { records, titled, added, renders, ms };
      }

      /* BEFORE: the guard off, 78 re-renders - the count the opnotes4 lane
         measured over 8 seconds of the room being used. */
      window.__mlsResidueOprPerf.revert();
      out.guardOffInstalled = window.__mlsResidueOprPerf.installed();
      out.before = await measure(78);

      /* AFTER: the same driver, same count, guard back on.
         ONE PRIMING RENDER FIRST, and it is not a fudge. A freshly installed
         guard has no record of what the rail last held, so its first write
         must go through - that is the whole point of a guard that compares
         rather than mutes. Measuring from a cold guard would charge the
         steady state for the one write that re-installing it costs. The
         priming render is outside the window; the 78 measured after it are
         the state the doctor actually works in. */
      window.__mlsResidueOprPerf.check();
      out.guardOnInstalled = window.__mlsResidueOprPerf.installed();
      try { opPrepRender(); } catch (e) {}
      await sleep(300);
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
    /* AT REST THE TITLES ARE GONE, and that is the other half of the churn.
       The room writes title="<label> - <hint>" on all three buttons;
       feat_athena_tooltip_dedupe.js strips all three straight back off,
       because that text is already visible inside the button. Neither module
       is wrong on its own - together they mean every unguarded rebuild pays
       three title mutations. If titles ever survive at rest, the churn has a
       different shape and the numbers below must be re-derived. */
    eq(perf.titles, 0,
      `${perf.titles} titles survive on the mode buttons at rest - the tooltip dedupe no longer strips them and this measurement must be re-derived`);
    eq(perf.guardOffInstalled, false, 'revert() left the guard on, so the BEFORE number is not a before');
    eq(perf.guardOnInstalled, true, 'the guard did not re-install, so the AFTER number is not an after');
    ok(perf.before.titled >= 200,
      `the unguarded room took only ${perf.before.titled} title mutations over 78 re-renders - the churn the opnotes4 lane measured did not reproduce, so the AFTER number proves nothing`);
    ok(perf.before.added >= 200,
      `the unguarded rail re-created only ${perf.before.added} nodes over 78 re-renders - the rebuild did not reproduce`);
    eq(perf.after.titled, 0,
      `the guarded room still took ${perf.after.titled} title mutations over 78 re-renders (was ${perf.before.titled})`);
    eq(perf.after.records, 0,
      `the guarded rail still took ${perf.after.records} mutation records over 78 re-renders (was ${perf.before.records})`);
    eq(perf.after.added, 0,
      `the guarded rail still re-created ${perf.after.added} nodes over 78 re-renders (was ${perf.before.added})`);
    ok(perf.skippedDelta >= 70,
      `the guard only dropped ${perf.skippedDelta} identical writes out of 78 re-renders`);
    eq(perf.realChangeLanded, true, 'the guard swallowed a DIFFERENT markup string - it is not a coalescer, it is a mute');
    eq(perf.identicalDropped, true, 'the guard passed an identical string through');
    eq(perf.restoredButtons, 3, 'the room could not rebuild its three buttons through the guard');

    step('2F tools menu hover tips');
    /* ===================================== OWNER: Tools menu hover info ====
     * "if I hover over a button it should give more info about it."
     * The bubble is the app's own #mlsTip, driven by [data-tip]; a native
     * title is the wrong carrier because the browser would paint a SECOND
     * bubble over it, which is exactly why initTooltips converts titles away. */
    const tools = await withDeadline(page.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const out = {};
      /* THE TOOLS MENU IS THE DOCK'S, not the top bar's. #mlsToolsMenu is what
         the doctor calls Tools (1p-clunky-contract measures the same one);
         #mlsTbMenuPanel is the top-bar Menu. Open it the way the dock does -
         forcing a popup's display gives the panel a box but leaves its rows at
         zero height, which is how the first attempt measured nothing. */
      const opener = Array.prototype.slice.call(document.querySelectorAll('#mlsDock button'))
        .filter((b) => /tools/i.test(b.textContent || ''))[0];
      out.openerFound = !!opener;
      if (opener) { opener.click(); await sleep(800); }
      const panel = document.getElementById('mlsToolsMenu');
      out.panel = !!panel;
      if (!panel) return out;
      window.__mlsToolsTips.pass();
      await sleep(250);
      const items = Array.prototype.slice.call(panel.querySelectorAll('button, .mlsTbItem, a[href], [role="menuitem"]'));
      out.count = items.length;
      out.rows = items.map((e) => ({
        id: e.id || '', text: (e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40),
        tip: e.getAttribute('data-tip') || '', title: e.getAttribute('title') || ''
      }));
      out.missing = out.rows.filter((r) => !r.tip).map((r) => r.text || r.id);
      out.double = out.rows.filter((r) => r.tip && r.title).map((r) => r.text || r.id);
      out.added = window.__mlsToolsTips.added();

      /* the bubble itself, on the BOTTOM-MOST control - the one with the least
         room beneath it, and therefore the one whose tip can escape. */
      let bottom = null, bottomY = -1;
      items.forEach((e) => { const b = e.getBoundingClientRect(); if (b.height > 0 && b.bottom > bottomY) { bottomY = b.bottom; bottom = e; } });
      out.bottomText = bottom ? (bottom.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40) : '';
      if (bottom) {
        bottom.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        await sleep(900); /* the shell waits 550ms before showing a tip */
        const tip = document.getElementById('mlsTip');
        if (tip && getComputedStyle(tip).display !== 'none') {
          const t = tip.getBoundingClientRect();
          out.bubble = { text: (tip.textContent || '').trim().slice(0, 60), x: Math.round(t.x), y: Math.round(t.y),
            w: Math.round(t.width), h: Math.round(t.height),
            inViewport: t.left >= 0 && t.top >= 0 && t.right <= window.innerWidth && t.bottom <= window.innerHeight };
        } else { out.bubble = null; }
      }
      /* revert must put back exactly what it took, and nothing else */
      out.tipsBeforeRevert = out.rows.filter((r) => r.tip).length;
      window.__mlsToolsTips.revert();
      await sleep(150);
      out.tipsAfterRevert = items.filter((e) => !!e.getAttribute('data-tip')).length;
      return out;
    }), 90000, 'the Tools menu tips');

    measured.tools = { count: tools.count, added: tools.added, missing: tools.missing,
      double: tools.double, bottomText: tools.bottomText, bubble: tools.bubble };
    ok(tools.openerFound, 'no Tools button in the dock - the menu could not be opened the way a doctor opens it');
    ok(tools.panel, 'the Tools menu panel never mounted, so nothing about the hover tips was measured');
    ok(tools.count >= 5, `the Tools menu holds ${tools.count} controls - too few to be the real menu`);
    eq((tools.missing || []).length, 0,
      `${(tools.missing || []).length} Tools-menu controls still say nothing on hover: ${(tools.missing || []).join(', ')}`);
    eq((tools.double || []).length, 0,
      `${(tools.double || []).length} Tools-menu controls carry BOTH data-tip and title - two bubbles on one control: ${(tools.double || []).join(', ')}`);
    ok(tools.added >= 1, 'the block added no tips at all, so its table no longer matches the menu');
    ok(tools.bubble, `hovering the bottom-most control ("${tools.bottomText}") produced no #mlsTip bubble`);
    ok(tools.bubble.text.length > 0, 'the bubble rendered empty');
    eq(tools.bubble.inViewport, true,
      `the bubble for the bottom-most control renders outside the viewport: ${JSON.stringify(tools.bubble)}`);
    ok(tools.tipsAfterRevert < tools.tipsBeforeRevert, 'revert() removed none of the tips this block added');
    ok(tools.tipsAfterRevert >= tools.tipsBeforeRevert - tools.added,
      'revert() removed tips this block did not add - it is deleting another owner\'s words');

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

    /* and with it on.
       THE COMPUTED VALUE IS NOT THE ASSERTION. Sticky was tried first and
       measured dead here: html and body both compute overflow "hidden auto",
       so a sticky child binds to a box that never scrolls internally and
       travels with the content anyway - computed position read 'sticky' while
       the shelf sat at y=-741 after a 900px scroll. A suite that checked only
       the computed value would have called that a fix. So the position is
       checked AND where the box actually landed is checked. */
    eq(shelf.scrolled.position, 'fixed',
      `after the fix the shelf computes position:${shelf.scrolled.position} - the rule did not apply`);
    eq(shelf.scrolled.inView, true,
      `after a 900px scroll the notice is at y=${shelf.scrolled.top}, off screen (RESIDUE 69)`);
    ok(shelf.scrolled.top >= 0 && shelf.scrolled.top < 844,
      `the notice landed at y=${shelf.scrolled.top} on an 844px screen`);
    /* it must clear the header furniture rather than sit on top of it - the
       whole reason the shell publishes this anchor */
    ok(shelf.scrolled.top >= 40,
      `the notice landed at y=${shelf.scrolled.top}, on top of the header instead of below it (RESIDUE 69)`);
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
