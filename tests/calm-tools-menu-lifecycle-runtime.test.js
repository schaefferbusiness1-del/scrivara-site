'use strict';

/* The footer Tools control owns the app-wide launcher.  Exercise the shipped
 * Calm shell itself so a fixture cannot accidentally hide a stale private
 * close handle.  The result is intentionally PHI-free: booleans, counts, and
 * the independent Visit-shortcuts expansion state only. */
const assert = require('assert');
const path = require('path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
    await page.setContent(`<!doctype html><html><head><style>
      #appScreen{display:block;width:900px;height:600px}
      #appHeader,#profileCard,#patientBar,#mlsCtxBar{display:block}
      .navtab{display:block;width:20px;height:20px}
      #ez3flToolsToggle{display:inline-flex}
    </style></head><body>
      <main id="appScreen"></main>
      <header id="appHeader"><button type="button">Settings</button><button type="button">Log out</button></header>
      <section id="profileCard"><button type="button">Schedule</button></section>
      <nav class="mainnav"><button class="navtab on" id="nav_visit">Visit</button><button class="navtab" id="nav_help">Help</button></nav>
      <button id="ez3flToolsToggle" type="button" aria-expanded="false">Visit shortcuts</button>
    </body></html>`);
    await page.addScriptTag({ path: path.join(root, 'feat_mls_calm_shell.js') });
    await page.waitForSelector('#mlsDock button[data-dest="tools"]');

    const clickAndRead = () => page.evaluate(() => {
      document.querySelector('#mlsDock button[data-dest="tools"]').click();
      const menu = document.getElementById('mlsToolsMenu');
      const shortcut = document.getElementById('ez3flToolsToggle');
      return {
        menuPresent: !!menu,
        menuRows: menu ? menu.querySelectorAll('[role="menuitem"]').length : 0,
        shortcutExpanded: shortcut ? shortcut.getAttribute('aria-expanded') : null
      };
    });

    let state = await clickAndRead();
    assert.strictEqual(state.menuPresent, true, 'footer Tools did not open the app-wide Tools menu');
    assert.ok(state.menuRows > 0, 'the app-wide Tools menu opened without any destinations');
    assert.strictEqual(state.shortcutExpanded, 'false', 'footer Tools changed the independent Visit-shortcuts disclosure');

    /* Reproduce an external owner detaching the overlay without access to the
       Calm shell's private close callback.  The very next press must open. */
    await page.evaluate(() => document.getElementById('mlsToolsMenu').remove());
    state = await clickAndRead();
    assert.strictEqual(state.menuPresent, true, 'one Tools press was swallowed by a stale detached-menu callback');
    assert.strictEqual(state.shortcutExpanded, 'false', 'detached-menu recovery changed Visit shortcuts');

    /* A normal shell teardown/reboot is the deployed warm-update lifecycle. */
    await page.evaluate(() => { window.__mlsCalmShell.revert(); window.__mlsCalmShell.boot(); });
    state = await clickAndRead();
    assert.strictEqual(state.menuPresent, true, 'one Tools press was swallowed after shell restart');
    assert.strictEqual(state.shortcutExpanded, 'false', 'shell restart coupled Tools to Visit shortcuts');

    console.log('calm tools menu lifecycle: 7 checks passed');
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
