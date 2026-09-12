'use strict';

/* smpreload-1.0.0 (owner 2026-09-11, MEASURED live on b1237 at 13:5x):
 * window.__mlsStudioMerge was undefined and #analysisView was still outside
 * #studioView while the doctor was on the Visit view - neither the on-screen
 * trigger (Studio was not on screen) nor the old idle fallback
 * (sched(go,{timeout:4000}), routed through the shared __mlsDeferAsset queue)
 * had landed the module yet.
 *
 * Fix, in 1p-mls-connect.js's studiofast-1.0.0 IIFE: a dedicated
 * requestIdleCallback (real setTimeout fallback), scheduled once right after
 * boot, independent of __mlsDeferAsset's own priority queue. The existing
 * on-screen trigger (immediate load + mls:view-changed listener) is
 * untouched. Until the merge has actually mounted, #studioView shows one
 * plain line ("Loading the rest of AI Studio...") above the Copilot card
 * (1pScribeFlow.html); feat_mls_studio_merge.js removes it the moment
 * reconcile() (or teardown(), for ?ui=classic) actually runs.
 *
 * This lifts the REAL loader IIFE out of the production bundle (not a
 * reimplementation) and proves, in a real browser:
 *   1. the idle preload schedules exactly one load, even if asked twice;
 *   2. the on-screen trigger still fires immediately, untouched;
 *   3. the placeholder is present before the real merge module has mounted,
 *      and gone afterward - driven by the actual feat_mls_studio_merge.js.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const CONNECT_PATH = path.join(root, 'mls-connect.js');
const SHELL_PATH = path.join(root, 'ScribeFlow.html');
const MERGE_PATH = path.join(root, 'feat_mls_studio_merge.js');
const STUDY_PATH = path.join(root, 'feat_mls_study_request.js');

const connectSource = fs.readFileSync(CONNECT_PATH, 'utf8');
const shellSource = fs.readFileSync(SHELL_PATH, 'utf8');
const mergeSource = fs.readFileSync(MERGE_PATH, 'utf8');
const studySource = fs.readFileSync(STUDY_PATH, 'utf8');

const studyLoaderMarker = "var A='feat_mls_study_request.js',V='sr-2.4.2',LV='srl-1.0.2'";
const studyLoaderAt = connectSource.indexOf(studyLoaderMarker);
const studyLoaderStart = connectSource.lastIndexOf(';(function(){try{', studyLoaderAt);
const studyLoaderCloseMarker = '}catch(e){}})();';
const studyLoaderClose = connectSource.indexOf(studyLoaderCloseMarker, studyLoaderAt);
assert.ok(studyLoaderAt >= 0 && studyLoaderStart >= 0 && studyLoaderClose > studyLoaderAt,
  'could not lift the real Study first-use loader');
const STUDY_LOADER_IIFE = connectSource.slice(studyLoaderStart, studyLoaderClose + studyLoaderCloseMarker.length);
assert.ok(STUDY_LOADER_IIFE.includes('[data-mls-sm-tab="build"]') &&
  STUDY_LOADER_IIFE.includes("'mls:view-changed'") &&
  STUDY_LOADER_IIFE.includes("'mls:studio-section-changed'") &&
  STUDY_LOADER_IIFE.includes("window.__MLS_AV||Date.now()"),
  'Study loader lost first-use admission or build-following cache identity');

const tourMarker = 'MLS Scribe -- b39 Studio overhaul + ONE auto-start tour';
const tourMarkerAt = connectSource.indexOf(tourMarker);
const tourIifeStart = connectSource.indexOf('(function () {', tourMarkerAt);
const tourIifeClose = connectSource.indexOf('})();', tourIifeStart);
assert.ok(tourMarkerAt >= 0 && tourIifeStart > tourMarkerAt && tourIifeClose > tourIifeStart,
  'could not lift the real Studio advanced-wrapper reconciler');
const STUDIO_WRAPPER_IIFE = connectSource.slice(tourIifeStart, tourIifeClose + 5);

/* ---------- lift the real loader IIFE, do not retype it ---------- */
const startMarker = "var A='feat_mls_studio_merge.js';";
const start = connectSource.indexOf(startMarker);
assert.ok(start >= 0, 'the studio-merge loader was rewritten out of mls-connect.js');
const iifeStart = connectSource.lastIndexOf(';(function(){try{', start);
assert.ok(iifeStart >= 0, 'could not find the start of the studio-merge loader IIFE');
const closeMarker = '}catch(e){}})();';
const closeAt = connectSource.indexOf(closeMarker, start);
assert.ok(closeAt > start, 'could not find the end of the studio-merge loader IIFE');
const LOADER_IIFE = connectSource.slice(iifeStart, closeAt + closeMarker.length);
assert.ok(LOADER_IIFE.includes('function preloadIdle('), 'lifted block is missing the dedicated idle preloader');
assert.ok(LOADER_IIFE.includes('function studioOnScreen('), 'lifted block is missing the on-screen trigger');

/* ---------- lift the exact placeholder markup, do not retype it ---------- */
const phStart = shellSource.indexOf('<p id="mlsStudioMergeLoading"');
assert.ok(phStart >= 0, 'the "Loading the rest of AI Studio..." placeholder is missing from ScribeFlow.html');
const phEnd = shellSource.indexOf('</p>', phStart) + '</p>'.length;
const PLACEHOLDER_HTML = shellSource.slice(phStart, phEnd);
assert.ok(/Loading the rest of AI Studio/.test(PLACEHOLDER_HTML), 'lifted placeholder does not carry the promised sentence');

const SHELL_HTML = `<!doctype html><html><body>
  <div id="appWrap">
    <div id="studioView" style="display:none">
      ${PLACEHOLDER_HTML}
      <div class="card" id="copilotCard"></div>
    </div>
    <div id="analysisView"></div>
  </div>
</body></html>`;

(async function run() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    /* ================= 1: idle preload schedules exactly once ================= */
    {
      const page = await browser.newPage();
      await page.setContent(SHELL_HTML);
      await page.evaluate(() => {
        window.__ricCalls = [];
        window.__scriptsAppended = [];
        /* deliberately never fires - proves scheduling happened without
         * depending on the merge module actually loading in this page */
        window.requestIdleCallback = function (cb, opts) { window.__ricCalls.push(opts); return 1; };
        const realAppendChild = Node.prototype.appendChild;
        const origCreateElement = document.createElement.bind(document);
        document.createElement = function (tag) {
          const el = origCreateElement(tag);
          if (String(tag).toLowerCase() === 'script') {
            const origSetAttribute = el.setAttribute.bind(el);
            el.setAttribute = function (name, value) {
              if (name === 'data-mls-asset') window.__scriptsAppended.push(value);
              return origSetAttribute(name, value);
            };
          }
          return el;
        };
      });
      await page.addScriptTag({ content: LOADER_IIFE });

      const first = await page.evaluate(() => ({
        scheduled: window.__mlsStudioFastPreload.scheduled(),
        ricCalls: window.__ricCalls.length
      }));
      assert.strictEqual(first.scheduled, true, 'the idle preload never scheduled itself right after boot');
      assert.strictEqual(first.ricCalls, 1, 'the idle preload must call requestIdleCallback exactly once');

      const second = await page.evaluate(() => window.__mlsStudioFastPreload.preload());
      const after = await page.evaluate(() => window.__ricCalls.length);
      assert.strictEqual(second, false, 'a second preload() call must be a no-op, not a fresh schedule');
      assert.strictEqual(after, 1, 'a second call scheduled a SECOND idle callback - it must stay at exactly one');

      /* studioView is display:none here, so neither trigger has appended the
       * merge script yet - only the (never-firing, mocked) idle callback was
       * scheduled. */
      const scripts = await page.evaluate(() => window.__scriptsAppended.slice());
      assert.deepStrictEqual(scripts, [], 'the merge module was fetched before its idle callback ever ran');

      await page.close();
    }

    /* =============== 2: Study is a visible top-level Build surface ============ */
    {
      const page = await browser.newPage();
      await page.setContent(`<!doctype html><html><head><style>
        #studioView{display:grid;grid-template-columns:1fr;gap:12px}
        #mlsB39SgBody{display:none}
        #mlsB39SgWrap.open #mlsB39SgBody{display:block}
      </style></head><body>
        <div id="appWrap"><div id="studioView" class="sx-grid">
          <div class="sx-title">AI Studio</div>
          <div id="copilotCard">Ask</div>
          <div class="sx-right">Build a custom tool</div>
          <div id="studioResultCard"></div>
          <div id="mlsSgPro">Legacy cohort controls</div>
          <div id="mls-sg-root">Advanced cohort tools</div>
        </div><div id="analysisView"></div></div>
      </body></html>`);
      await page.evaluate(() => { window.__mlsManualToursOnly = true; });
      await page.addScriptTag({ content: STUDIO_WRAPPER_IIFE });
      await page.addScriptTag({ content: mergeSource });
      await page.waitForFunction(() => !!window.__mlsStudioMerge, null, { timeout: 5000 });
      await page.evaluate(() => window.__mlsStudioMerge.select('build'));
      await page.addScriptTag({ content: studySource });
      await page.waitForSelector('#mlsStudyRequest');

      const mounted = await page.evaluate(() => {
        const studio = document.getElementById('studioView');
        const builder = document.getElementById('mlsStudyRequest');
        const wrapper = document.getElementById('mlsB39SgWrap');
        const prompt = document.getElementById('mlsStudyPrompt');
        return {
          oneBuilder: document.querySelectorAll('#mlsStudyRequest').length,
          directChild: builder.parentElement === studio,
          outsideAdvanced: !wrapper.contains(builder),
          advancedClosed: !wrapper.classList.contains('open'),
          visible: getComputedStyle(builder).display !== 'none' && !!builder.getClientRects().length,
          gridRow: getComputedStyle(builder).gridRowStart,
          promptEnabled: !prompt.disabled && !prompt.readOnly,
          advancedOwnsLegacy: document.getElementById('mlsSgPro').closest('#mlsB39SgBody') === document.getElementById('mlsB39SgBody'),
          advancedOwnsGroups: document.getElementById('mls-sg-root').closest('#mlsB39SgBody') === document.getElementById('mlsB39SgBody')
        };
      });
      assert.strictEqual(mounted.oneBuilder, 1, 'Study mounted more than one primary builder');
      assert.strictEqual(mounted.directChild, true, 'Study is not a direct AI Studio panel');
      assert.strictEqual(mounted.outsideAdvanced, true, 'Study is still trapped in the collapsed advanced wrapper');
      assert.strictEqual(mounted.advancedClosed, true, 'revealing the primary Study tool opened unrelated advanced controls');
      assert.strictEqual(mounted.visible, true, 'the Build tab still paints the healthy Study tool as missing');
      assert.strictEqual(mounted.gridRow, '3', 'Study is not the first Build panel beneath the section switcher');
      assert.strictEqual(mounted.promptEnabled, true, 'the visible Study composer cannot accept input');
      assert.strictEqual(mounted.advancedOwnsLegacy, true, 'legacy cohort controls escaped the advanced wrapper');
      assert.strictEqual(mounted.advancedOwnsGroups, true, 'named Study Groups escaped the advanced wrapper');

      const prompt = page.locator('#mlsStudyPrompt');
      await prompt.fill('');
      await prompt.press('Enter');
      await page.locator('#mlsStudyStatus').waitFor({ state: 'visible', timeout: 3000 });
      assert.ok((await page.locator('#mlsStudyStatus').innerText()).trim().length > 10,
        'Enter reached no handler or produced no honest validation status');
      assert.strictEqual(await page.locator('#mlsStudySubmit').isEnabled(), true,
        'an invalid request left the Study composer stuck disabled');
      await page.close();
    }

    /* ============= 3: Study first use bypasses the optional backlog =========== */
    {
      const page = await browser.newPage();
      const firstUseHtml = `<!doctype html><html><body>
        <div id="appWrap"><div id="studioView" style="display:none">
          <div class="sx-title">AI Studio</div>
          <div id="copilotCard">Ask</div>
          <div class="sx-right">Build a custom tool</div>
        </div><div id="analysisView"></div></div>
      </body></html>`;
      await page.route('https://mls-study-first-use.test/**', route =>
        route.fulfill({ status: 200, contentType: 'text/html', body: firstUseHtml }));
      await page.route('https://mls-study-first-use.test/feat_mls_study_request.js**', route =>
        route.fulfill({ status: 200, contentType: 'application/javascript', body: studySource }));
      await page.goto('https://mls-study-first-use.test/');
      await page.evaluate(() => {
        window.__MLS_AV = 'first-use-test';
        window.__mlsDeferAsset = function (fn) {
          window.__deferredStudyCallback = fn;
          return 77;
        };
      });
      await page.addScriptTag({ content: STUDY_LOADER_IIFE });

      const before = await page.evaluate(() => ({
        queued: typeof window.__deferredStudyCallback === 'function',
        scripts: document.querySelectorAll('script[data-mls-asset="feat_mls_study_request.js"]').length
      }));
      assert.strictEqual(before.queued, true, 'Study lost its quiet background preload fallback');
      assert.strictEqual(before.scripts, 0, 'hidden Studio fetched Study before either idle time or first use');

      await page.evaluate(() => {
        window.__studioSectionEvents = [];
        window.addEventListener('mls:studio-section-changed', event =>
          window.__studioSectionEvents.push(event && event.detail && event.detail.section));
        window.localStorage.setItem('mlsStudioSection', 'build');
        document.getElementById('studioView').style.display = 'block';
      });
      await page.addScriptTag({ content: mergeSource });
      await page.waitForSelector('#mlsStudyRequest', { timeout: 5000 });
      const firstUse = await page.evaluate(() => {
        const tags = Array.from(document.querySelectorAll('script[data-mls-asset="feat_mls_study_request.js"]'));
        return {
          scripts: tags.length,
          src: tags[0] && tags[0].src,
          state: window.__mlsStudyRequestLoader && window.__mlsStudyRequestLoader.state,
          direct: document.getElementById('mlsStudyRequest').parentElement === document.getElementById('studioView'),
          directlyAfterTabs: document.getElementById('mlsStudyRequest').previousElementSibling === document.getElementById('mlsSmTabs'),
          sectionEvents: window.__studioSectionEvents.slice()
        };
      });
      assert.strictEqual(firstUse.scripts, 1, 'opening Build did not admit exactly one Study module');
      assert.ok(/feat_mls_study_request\.js\?v=first-use-test$/.test(firstUse.src),
        'Study first use did not follow the current app build token');
      assert.strictEqual(firstUse.state, 'ready', 'Study loader did not verify its mounted owner');
      assert.strictEqual(firstUse.direct, true, 'first-use loading mounted Study outside the Build surface');
      assert.strictEqual(firstUse.directlyAfterTabs, true,
        'first-use Study starts below other Build cards and jumps only after deferred grid layout');
      assert.deepStrictEqual(firstUse.sectionEvents, ['build'],
        'the remembered Build section did not publish one first-use admission signal');

      await page.evaluate(() => {
        const pro = document.createElement('div');
        pro.id = 'mlsSgPro';
        const late = document.createElement('button');
        late.id = 'lateLegacyStudyControl';
        late.textContent = 'Late legacy control';
        pro.appendChild(late);
        document.getElementById('studioView').appendChild(pro);
      });
      await page.waitForFunction(() => !!document.querySelector('#mlsStudyAdvancedBody #lateLegacyStudyControl'), null, { timeout: 5000 });
      assert.strictEqual(await page.locator('#studioView > #mlsStudyRequest').count(), 1,
        'late cohort-host adoption moved or duplicated the primary Study composer');

      await page.evaluate(() => window.__mlsStudioMerge.select('build'));
      await page.evaluate(() => window.__deferredStudyCallback());
      await page.waitForTimeout(50);
      assert.strictEqual(await page.locator('script[data-mls-asset="feat_mls_study_request.js"]').count(), 1,
        'a second Build click or later idle callback duplicated the Study module');
      await page.close();
    }

    /* ================= 4: the on-screen trigger still fires immediately ================= */
    {
      const page = await browser.newPage();
      await page.setContent(SHELL_HTML);
      await page.evaluate(() => {
        document.getElementById('studioView').style.display = 'block'; // AI Studio is already on screen
        window.__ricCalls = [];
        window.requestIdleCallback = function (cb, opts) { window.__ricCalls.push(opts); return 1; };
      });
      await page.addScriptTag({ content: LOADER_IIFE });
      const state = await page.evaluate(() => ({
        loaderTag: !!document.querySelector('script[data-mls-asset="feat_mls_studio_merge.js"]'),
        scheduled: window.__mlsStudioFastPreload.scheduled()
      }));
      assert.strictEqual(state.loaderTag, true,
        'the on-screen trigger regressed - the merge module must load immediately when Studio is already on screen');
      /* KEPT AS-IS means the idle path still runs too, unconditionally - it
       * hoists #analysisView, which must land for everyone, not only for
       * people who opened Studio. */
      assert.strictEqual(state.scheduled, true, 'the idle preload must still be scheduled even when the on-screen trigger already fired');
      await page.close();
    }

    /* ================= 5: placeholder present before the real mount, gone after ================= */
    {
      const page = await browser.newPage();
      /* Playwright runs routes in the OPPOSITE order of registration (the
       * most recently added wins), so the specific script route is added
       * AFTER the catch-all to make sure it is the one that answers. */
      await page.route('https://mls-studio-preload.test/**', route =>
        route.fulfill({ status: 200, contentType: 'text/html', body: SHELL_HTML }));
      await page.route('https://mls-studio-preload.test/feat_mls_studio_merge.js**', route =>
        route.fulfill({ status: 200, contentType: 'application/javascript', body: mergeSource }));
      await page.goto('https://mls-studio-preload.test/visit');
      await page.evaluate(() => {
        document.getElementById('studioView').style.display = 'block';
        /* fire "idle" immediately for a fast, deterministic test - the
         * scheduling contract itself (exactly once) is proven in part 1 */
        window.requestIdleCallback = function (cb) { setTimeout(cb, 0); return 1; };
      });

      assert.strictEqual(await page.locator('#mlsStudioMergeLoading').count(), 1,
        'the placeholder must be present before the merge module has run');

      await page.addScriptTag({ content: LOADER_IIFE });

      await page.waitForFunction(() => !!window.__mlsStudioMerge, null, { timeout: 5000 });
      await page.waitForFunction(() => !document.getElementById('mlsStudioMergeLoading'), null, { timeout: 5000 });

      const finalState = await page.evaluate(() => ({
        analysisInsideStudio: document.getElementById('analysisView').parentElement === document.getElementById('studioView'),
        placeholderGone: !document.getElementById('mlsStudioMergeLoading')
      }));
      assert.strictEqual(finalState.analysisInsideStudio, true, 'the real merge module did not actually hoist #analysisView');
      assert.strictEqual(finalState.placeholderGone, true, 'the placeholder must be removed once the real merge has mounted');

      await page.close();
    }
  } finally {
    await browser.close();
  }

  console.log('PASS studio-merge: idle preload remains exact, and the real Study composer is visible, first, unique, and live on Build while advanced cohorts stay closed');
})().catch(error => { console.error(error && error.stack || error); process.exit(1); });
