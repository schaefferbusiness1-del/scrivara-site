'use strict';

/* extowner-1.0.0 — the Settings download owner is one stable surface.
 *
 * The extension card owns the Chrome Web Store and pinned package actions.
 * Integrations owns connection health and pull preferences; it may point back
 * to the extension card, but must not grow a second installer. This suite
 * checks both authoritative 1p shells and runs the shipped Settings cleanup
 * pass in a real DOM to pin the semantic boundary and its idempotence.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const SHELLS = ['1pScribeFlow.html', '1p/index.html'];
const sources = SHELLS.map(name => ({ name, source: fs.readFileSync(path.join(root, name), 'utf8') }));

function count(source, needle) {
  return source.split(needle).length - 1;
}

function sliceBetween(source, open, close, label) {
  const start = source.indexOf(open);
  assert.ok(start >= 0, `${label}: opening marker is missing`);
  const end = source.indexOf(close, start + open.length);
  assert.ok(end > start, `${label}: closing marker is missing`);
  return source.slice(start, end);
}

const ownerOpen = '<div class="set-section" id="extensionDownloadSettings">';
const ownerClose = '\n    <div class="set-section">';
const integrationsOpen = '<!-- ============ SECTION: Integrations';
const integrationsClose = '<div id="emrPullBox"';
const ownerBlocks = [];
const setupRouteFunctions = [];

for (const { name, source } of sources) {
  const owner = sliceBetween(source, ownerOpen, ownerClose, `${name} extension owner`);
  const integrations = sliceBetween(source, integrationsOpen, integrationsClose, `${name} Integrations card`);
  ownerBlocks.push(owner);
  assert.strictEqual(count(source, 'function mlsOpenExtensionSetup(){'), 1,
    `${name}: canonical setup-section activator must be defined exactly once`);
  const routeStart = source.indexOf('function mlsOpenExtensionSetup(){');
  const routeEnd = source.indexOf('\n}\n/* vntpl-1.0.0', routeStart);
  assert.ok(routeStart >= 0 && routeEnd > routeStart,
    `${name}: canonical setup-section activator boundary is missing`);
  setupRouteFunctions.push(source.slice(routeStart, routeEnd + '\n}'.length));

  assert.strictEqual(count(owner, 'id="extStoreBtn"'), 1,
    `${name}: Chrome Web Store action must exist exactly once in the canonical owner`);
  assert.strictEqual(count(owner, 'id="extDlBtn"'), 1,
    `${name}: pinned package action must exist exactly once in the canonical owner`);
  assert.strictEqual(count(source, 'id="extStoreBtn"'), 1,
    `${name}: Chrome Web Store action is duplicated elsewhere in the shell`);
  assert.strictEqual(count(source, 'id="extDlBtn"'), 1,
    `${name}: pinned package action is duplicated elsewhere in the shell`);

  assert.strictEqual(count(integrations, 'id="mlsExtensionSetupLink"'), 1,
    `${name}: Integrations must have one route back to the canonical setup panel`);
  assert.ok(/data-mls-setup-link="1"/.test(integrations),
    `${name}: Integrations setup route is missing its semantic owner marker`);
  assert.ok(/data-mls-setup-target="extensionDownloadSettings"/.test(integrations),
    `${name}: setup route is missing its canonical section target`);
  assert.ok(/onclick="mlsOpenExtensionSetup\(\);/.test(integrations),
    `${name}: setup route does not activate the canonical Settings group before scrolling`);
  assert.ok(/extensionDownloadSettings/.test(integrations),
    `${name}: setup route does not target #extensionDownloadSettings`);
  assert.ok(!/data-eds-primary|Direct package|Download MLS Assist \(latest\)|get-extension\.html/i.test(integrations),
    `${name}: Integrations still carries a direct duplicate installer action`);

  /* Connection health and pull controls remain Integrations-owned. */
  assert.ok(/id="athStatus"/.test(integrations), `${name}: Athena connection status disappeared`);
  assert.ok(/id="athApiRefreshBtn"/.test(integrations), `${name}: connection status refresh disappeared`);
  assert.ok(/id="athenaFollowToggle"/.test(integrations), `${name}: extension connection preference disappeared`);
}

assert.strictEqual(ownerBlocks[0], ownerBlocks[1],
  'the authoritative 1p shells disagree on the extension download owner');
assert.strictEqual(setupRouteFunctions[0], setupRouteFunctions[1],
  'the authoritative 1p shells disagree on setup-section activation');

/* Lift the real cleanup function from the shell; this is not a reimplementation
 * of its owner logic. It proves the markup survives the pass that runs after
 * Settings opens and after late Settings rerenders. */
const source = sources[0].source;
const setupFnStart = source.indexOf('function mlsOpenExtensionSetup(){');
const setupFnEnd = source.indexOf('\n}\n/* vntpl-1.0.0', setupFnStart);
assert.ok(setupFnStart >= 0 && setupFnEnd > setupFnStart,
  'could not lift the shipped Settings setup-section activator');
const setupFunction = source.slice(setupFnStart, setupFnEnd + '\n}'.length);
const fnStart = source.indexOf('function downloads() {');
const fnEnd = source.indexOf('\n  }\n\n  /* ---- 134', fnStart);
assert.ok(fnStart >= 0 && fnEnd > fnStart, 'could not lift the shipped Settings download cleanup');
const downloadsFunction = source.slice(fnStart, fnEnd + '\n  }'.length);

const ownerMarkup = ownerBlocks[0];
const integrationsMarkup = sliceBetween(source, integrationsOpen, integrationsClose, 'runtime Integrations card');
const fixture = `<!doctype html><html><body>
  <div id="settingsModal" class="show"><div class="modal">
    <div id="settingsTabBar" role="tablist"></div>
    ${ownerMarkup}
    <div class="set-section"><p class="set-head">🔗 Integrations</p>${integrationsMarkup}</div>
  </div></div>
</body></html>`;

(async function run() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(fixture);
    await page.evaluate((fnSource) => {
      const el = id => document.getElementById(id);
      const qa = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel));
      const txt = node => String(node && (node.textContent || '')).replace(/\s+/g, ' ').trim();
      window.__runSettingsDownloads = new Function('el', 'qa', 'txt', `return (${fnSource});`)(el, qa, txt);
    }, downloadsFunction);
    await page.evaluate((fnSource) => {
      window.mlsOpenExtensionSetup = new Function(`${fnSource}; return mlsOpenExtensionSetup;`)();
      window.__runExtensionSetup = window.mlsOpenExtensionSetup;
    }, setupFunction);

    const first = await page.evaluate(() => {
      window.__runSettingsDownloads();
      return {
        dom: document.getElementById('settingsModal').innerHTML,
        storeDisplay: getComputedStyle(document.getElementById('extStoreBtn')).display,
        packageDisplay: getComputedStyle(document.getElementById('extDlBtn')).display,
        setupDisplay: getComputedStyle(document.getElementById('mlsExtensionSetupLink')).display,
        status: document.getElementById('athStatus').textContent,
        notes: document.querySelectorAll('#mlsClunkyPhoneNote').length
      };
    });
    const second = await page.evaluate(() => {
      window.__runSettingsDownloads();
      return {
        dom: document.getElementById('settingsModal').innerHTML,
        storeDisplay: getComputedStyle(document.getElementById('extStoreBtn')).display,
        packageDisplay: getComputedStyle(document.getElementById('extDlBtn')).display,
        setupDisplay: getComputedStyle(document.getElementById('mlsExtensionSetupLink')).display,
        status: document.getElementById('athStatus').textContent,
        notes: document.querySelectorAll('#mlsClunkyPhoneNote').length
      };
    });

    assert.notStrictEqual(first.storeDisplay, 'none', 'runtime cleanup hid the canonical Chrome Web Store action');
    assert.notStrictEqual(first.packageDisplay, 'none', 'runtime cleanup hid the canonical pinned package action');
    assert.notStrictEqual(first.setupDisplay, 'none', 'runtime cleanup hid the Integrations setup route');
    assert.strictEqual(first.status, 'Not checked yet.', 'connection status changed during the cleanup pass');
    assert.strictEqual(first.notes, 1, 'the phone note was not added exactly once');
    assert.deepStrictEqual(second, first, 'a repeated Settings cleanup pass changed the DOM or status');

    const navigation = await page.evaluate(() => {
      const setup = document.getElementById('extensionDownloadSettings');
      const store = document.getElementById('extStoreBtn');
      setup.scrollIntoView = () => { window.__setupScrolled = true; };
      document.getElementById('mlsExtensionSetupLink').click();
      return { scrolled: !!window.__setupScrolled, focused: document.activeElement === store };
    });
    assert.deepStrictEqual(navigation, { scrolled: true, focused: true },
      'Integrations setup route did not land on the canonical extension owner');

    /* The production button is reachable from Integrations while its owner is
     * hidden behind another Settings tab. Verify the route activates the
     * modern semantic group before scroll/focus, then the legacy index fallback
     * when the organized rail is absent. */
    const activation = await page.evaluate(() => {
      const modal = document.getElementById('settingsModal');
      const body = modal.querySelector('.modal');
      const setup = document.getElementById('extensionDownloadSettings');
      const store = document.getElementById('extStoreBtn');
      const bar = document.getElementById('settingsTabBar');
      const link = document.getElementById('mlsExtensionSetupLink');
      const events = [];
      const reset = () => {
        events.length = 0;
        setup.style.display = 'none';
        setup.classList.add('set-tab-hidden');
        setup.scrollIntoView = () => events.push('scroll');
        store.focus = () => events.push('focus');
      };

      bar.innerHTML = '<button type="button" data-mls-settings-group="account">Account</button>' +
        '<button type="button" data-mls-settings-group="integrations">Integrations</button>';
      const modern = bar.querySelector('[data-mls-settings-group="integrations"]');
      modern.addEventListener('click', () => {
        events.push('modern-tab');
        setup.style.display = '';
        setup.classList.remove('set-tab-hidden');
      });
      window.__mlsUiUnification = {
        installed: true,
        reconcileSettings: () => events.push('reconcile')
      };
      reset();
      link.click();
      const modernResult = {
        events: events.slice(),
        visible: getComputedStyle(setup).display !== 'none' && !setup.classList.contains('set-tab-hidden')
      };

      bar.innerHTML = '<button type="button" class="set-tab">Account</button>' +
        '<button type="button" class="set-tab">Integrations</button>';
      window.__mlsUiUnification = null;
      window._setVisibleSections = () => modal.querySelectorAll('.modal > .set-section');
      window.mlsSelectSettingsTab = idx => {
        events.push(`legacy-tab:${idx}`);
        setup.style.display = '';
        setup.classList.remove('set-tab-hidden');
      };
      reset();
      link.click();
      const legacyResult = {
        events: events.slice(),
        visible: getComputedStyle(setup).display !== 'none' && !setup.classList.contains('set-tab-hidden')
      };
      return { modernResult, legacyResult, bodyPresent: !!body };
    });
    assert.deepStrictEqual(activation.modernResult, {
      events: ['reconcile', 'modern-tab', 'scroll', 'focus'],
      visible: true
    }, 'modern Settings rail did not activate Integrations before scroll/focus');
    assert.deepStrictEqual(activation.legacyResult, {
      events: ['legacy-tab:0', 'scroll', 'focus'],
      visible: true
    }, 'legacy index-based Settings fallback did not activate the owner before scroll/focus');
    assert.strictEqual(activation.bodyPresent, true, 'Settings fixture lost its modal body');
    await page.close();
  } finally {
    await browser.close();
  }
  console.log('PASS 1p Settings extension owner: one store/package owner, idempotent rerender, connection status retained');
})().catch(err => {
  console.error(err && err.stack || err);
  process.exitCode = 1;
});
