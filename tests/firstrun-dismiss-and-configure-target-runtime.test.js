'use strict';

/* Owner 2026-09-11, from a screenshot of the "Get MLS working - 3 of 4 done"
 * checklist on the Visit page: "the Dismiss button and the Configure link...
 * do nothing."
 *
 * MEASURED, against the real production sources (no reimplementation):
 *
 *  1. Dismiss (onDismiss -> markDone() + removeCard() + closeTour(), all in
 *     feat_mls_firstrun.js) IS wired correctly: it persists per account
 *     through uns('firstRunDone') and removes the card. No defect found in
 *     this chain. Part 1 below drives a REAL click through a REAL browser
 *     and proves it end to end, including that a dismissed checklist never
 *     remounts on a later ensure() pass (e.g. the next view change).
 *
 *  2. Configure (focusAiFormats, feat_mls_firstrun.js) targeted the OLD
 *     #mlsDraftTuningSection ("AI output formats") instead of the NEW
 *     #mlsVisitNoteTemplatesSection card ("Visit note templates", b1237) -
 *     the exact card this checklist row promises ("Configure AI note
 *     formats"). Fixed by retargeting it.
 *
 *  3. THE REAL REASON CONFIGURE LOOKED DEAD: mountVisitTemplates()
 *     (1p-feat_mls_draft_tuning.js) used to write an INLINE
 *     sec.style.display='none' - in addition to the set-tab-hidden CLASS -
 *     the very first time Settings opened on any tab other than Notes & AI.
 *     Every "select Notes & AI" caller in the app, including
 *     mlsSelectSettingsTab() (1pScribeFlow.html) which every tab click runs
 *     through, only ever toggles the set-tab-hidden CLASS - it never clears
 *     an inline style. An inline style beats a class-driven CSS rule
 *     forever, so once that first mount happened on a non-Notes tab (the
 *     ordinary case - Settings does not default to Notes & AI), the card
 *     could never be shown again for the rest of the page's life: not from
 *     Configure, not from clicking the Notes & AI tab directly, no matter
 *     how many times. Fixed by dropping the inline write; the CSS rule
 *     (.set-section.set-tab-hidden{display:none}) already does the job, and
 *     it is the one mechanism every other caller actually clears.
 *
 * Part 2 below drives a REAL Configure click through a REAL browser, with
 * the REAL tab-switch mechanism installed exactly as the app installs it,
 * starting from the realistic case (Settings NOT already on the Notes & AI
 * tab) that triggers the bug - and proves the card ends up genuinely
 * visible, not just class-correct.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const FIRSTRUN_PATH = path.join(root, 'feat_mls_firstrun.js');
const TUNING_PATH = path.join(root, '1p-feat_mls_draft_tuning.js');
const SHELL_PATH = path.join(root, '1pScribeFlow.html');

const firstRunSource = fs.readFileSync(FIRSTRUN_PATH, 'utf8');
const tuningSource = fs.readFileSync(TUNING_PATH, 'utf8');
const shellSource = fs.readFileSync(SHELL_PATH, 'utf8');

/* ---------- static pins: the retarget really happened, the bug really is gone ---------- */

assert.ok(/function focusAiFormats\([\s\S]{0,1400}mlsVisitNoteTemplatesSection/.test(firstRunSource),
  'Configure no longer targets #mlsVisitNoteTemplatesSection - the retarget regressed');
assert.ok(firstRunSource.includes("byId('mlsVisitNoteTemplatesSection')"),
  'Configure does not read the new target by id');
assert.ok(!firstRunSource.includes("byId('mlsDraftTuningSection')"),
  'Configure (or something else in this module) still reads the retired #mlsDraftTuningSection target by id');

function lift(src, startMarker, endMarker, what) {
  const from = src.indexOf(startMarker);
  assert.ok(from >= 0, 'could not find ' + what);
  const to = src.indexOf(endMarker, from);
  assert.ok(to > from, 'could not find the end of ' + what);
  const text = src.slice(from, to).replace(/\s+$/, '');
  assert.ok(text.endsWith('}'), what + ' did not lift cleanly');
  return text;
}

const mountVisitTemplatesSlice = lift(tuningSource,
  'function mountVisitTemplates() {', '\n  /* The route the visit room\'s one-line link takes. */',
  'mountVisitTemplates');
const mountVisitTemplatesCode = mountVisitTemplatesSlice.replace(/\/\*[\s\S]*?\*\//g, ' ');
assert.ok(!/sec\.style\.display\s*=\s*['"]none['"]/.test(mountVisitTemplatesCode),
  'mountVisitTemplates() writes an inline display:none again - a class-only tab switch can never clear it, ' +
  'and #mlsVisitNoteTemplatesSection would be permanently unable to show once Settings first opened on ' +
  'any tab other than Notes & AI');
assert.ok(/sec\.classList\.add\(['"]set-tab-hidden['"]\)/.test(mountVisitTemplatesCode),
  'mountVisitTemplates() lost its pre-emptive hide for a card mounted on the wrong tab');

/* the real Settings tab switcher, lifted rather than reimplemented - this is
 * the exact mechanism every "select Notes & AI" caller in the app runs
 * through, and the exact mechanism the inline-style bug could defeat. */
const TAB_SOURCE = [
  lift(shellSource, 'function _setVisibleSections(){', '\nfunction mlsSelectSettingsTab', '_setVisibleSections'),
  lift(shellSource, 'function mlsSelectSettingsTab(idx){', '\nfunction mlsBuildSettingsTabs(){', 'mlsSelectSettingsTab')
].join('\n');

const SHELL_HTML = `<!doctype html><html><body>
<style>.set-section.set-tab-hidden{display:none}</style>
<main id="appScreen">
  <section id="visitView"><div id="visitHero"></div></section>
</main>
<div id="settingsModal">
  <div class="modal">
    <div class="set-section"><p class="set-head">Account &amp; security</p><input type="hidden" id="acctDummyField"></div>
    <div class="set-section"><p class="set-head">Note defaults</p><input type="hidden" id="noteFormatSel" value="soap"></div>
    <div class="row"><button onclick="saveSettings()">Save settings</button></div>
  </div>
  <div id="settingsTabBar">
    <button type="button" class="set-tab on" data-mls-settings-group="account" aria-selected="true">Account &amp; security</button>
    <button type="button" class="set-tab" data-mls-settings-group="notes" aria-selected="false">Notes &amp; AI</button>
  </div>
</div>
</body></html>`;

(async function run() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    /* ---------- 1: DISMISS, clicked for real, removes the card and persists per account ---------- */
    {
      const page = await browser.newPage();
      await page.route('https://mls-firstrun-dismiss.test/**', route =>
        route.fulfill({ status: 200, contentType: 'text/html', body: SHELL_HTML }));
      await page.goto('https://mls-firstrun-dismiss.test/visit');
      await page.evaluate(() => { window.uns = key => 'dismiss-account::' + key; });
      await page.addScriptTag({ path: FIRSTRUN_PATH });
      await page.evaluate(() => window.__mlsFirstRun.ensure());

      assert.strictEqual(await page.locator('#mlsFrCard').count(), 1,
        'the checklist never mounted for a signed-in, ungated account - Dismiss cannot be tested if the card never appears');
      assert.strictEqual(await page.locator('#mlsFrDismiss').count(), 1, 'Dismiss button never mounted');

      await page.click('#mlsFrDismiss');

      assert.strictEqual(await page.locator('#mlsFrCard').count(), 0, 'Dismiss did not remove the checklist card');
      const persisted = await page.evaluate(() => localStorage.getItem(window.uns('firstRunDone')));
      assert.strictEqual(persisted, '1', 'Dismiss did not persist the per-account firstRunDone flag');

      /* the next ensure() pass (a later view change, a later "mls:loader-ready")
       * must not bring a dismissed checklist back */
      await page.evaluate(() => window.__mlsFirstRun.ensure());
      assert.strictEqual(await page.locator('#mlsFrCard').count(), 0,
        'a dismissed checklist reappeared on the next ensure() pass');

      await page.close();
    }

    /* ---------- 2: CONFIGURE targets the new card, and the card is actually visible afterward ---------- */
    {
      const page = await browser.newPage();
      await page.route('https://mls-firstrun-configure.test/**', route =>
        route.fulfill({ status: 200, contentType: 'text/html', body: SHELL_HTML }));
      await page.goto('https://mls-firstrun-configure.test/visit');
      await page.evaluate(() => {
        window.uns = key => 'configure-account::' + key;
        window.saveSettings = function () {};
        window.getGenLength = () => 'standard';
        window.getGenInstr = () => '';
        window.toast = function () {};
        window.syncPrefsToServer = function () {};
        window.openSettings = function () { document.getElementById('settingsModal').classList.add('show'); };
      });
      /* the real tab switcher, wired onto the static test tabs exactly the
       * way mlsBuildSettingsTabs() wires its own generated tabs
       * (addEventListener('click', () => mlsSelectSettingsTab(i))). */
      await page.addScriptTag({ content: TAB_SOURCE + `
        Array.prototype.forEach.call(document.querySelectorAll('#settingsTabBar .set-tab'), function (btn, i) {
          btn.addEventListener('click', function () { mlsSelectSettingsTab(i); });
        });
      ` });
      /* the module the checklist lazy-loads via __mlsEnsureDraftTuning() -
       * loaded for real up front so that loader promise resolves to the
       * REAL, already-installed module, not a stand-in. */
      await page.addScriptTag({ path: TUNING_PATH });
      await page.evaluate(() => { window.__mlsEnsureDraftTuning = () => Promise.resolve(window.__mlsDraftTuning); });
      await page.addScriptTag({ path: FIRSTRUN_PATH });
      await page.evaluate(() => window.__mlsFirstRun.ensure());

      assert.strictEqual(await page.locator('#mlsFrAiBtn').count(), 1, 'Configure button never mounted');

      await page.click('#mlsFrAiBtn');

      /* wait for the settled outcome, not just the element's existence -
       * mounting and the tab-click/unhide can land on different macrotasks */
      await page.waitForFunction(() => {
        const sec = document.getElementById('mlsVisitNoteTemplatesSection');
        return !!sec && !sec.classList.contains('set-tab-hidden');
      }, null, { timeout: 5000 });

      const state = await page.evaluate(() => {
        const sec = document.getElementById('mlsVisitNoteTemplatesSection');
        const cs = getComputedStyle(sec);
        return {
          hiddenClass: sec.classList.contains('set-tab-hidden'),
          inlineDisplay: sec.style.display,
          computedDisplay: cs.display,
          modalShown: document.getElementById('settingsModal').classList.contains('show'),
          notesTabOn: document.querySelector('[data-mls-settings-group="notes"]').classList.contains('on'),
          oldSectionExists: !!document.getElementById('mlsDraftTuningSection')
        };
      });
      assert.strictEqual(state.modalShown, true, 'Configure did not open Settings');
      assert.strictEqual(state.notesTabOn, true, 'Configure did not select the Notes & AI tab');
      assert.strictEqual(state.hiddenClass, false, 'Configure left the new card marked set-tab-hidden');
      assert.strictEqual(state.inlineDisplay, '',
        'mountVisitTemplates left a stale inline display style behind - the exact defect that made ' +
        'Configure look dead, because a class-only tab switch can never clear it');
      assert.strictEqual(state.computedDisplay, 'block',
        'the Visit note templates card is not actually visible after Configure');
      assert.strictEqual(state.oldSectionExists, true,
        'the older AI output formats section (#mlsDraftTuningSection) should still exist alongside the new card');

      await page.close();
    }
  } finally {
    await browser.close();
  }

  console.log('PASS first-run Dismiss/Configure: Dismiss really removes the card and persists per account; ' +
    'Configure really opens Settings, selects Notes & AI, and reveals #mlsVisitNoteTemplatesSection - and the ' +
    'card survives the class-only tab switch that a leftover inline style used to defeat permanently');
})().catch(error => { console.error(error && error.stack || error); process.exit(1); });
