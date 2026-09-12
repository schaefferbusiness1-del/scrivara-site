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

    /* The two real producers mount after the Calm shell on a normal cold load.
       Opening Tools during that window must not freeze an incomplete menu until
       the doctor notices, closes it, and tries again. */
    await page.evaluate(() => {
      const menu = document.getElementById('mlsToolsMenu');
      menu.dataset.lateProducerProof = 'same-open-menu';
      const helpRow = Array.from(menu.querySelectorAll('.r')).find((node) => node.querySelector('.rn').textContent.trim() === 'Help');
      helpRow.focus();
      window.__lateToolHits = { pull: 0, doctor: 0 };
      const pull = document.createElement('button');
      pull.id = 'mlsPdpSel';
      pull.type = 'button';
      pull.textContent = 'Where pulls run';
      pull.addEventListener('click', () => { window.__lateToolHits.pull += 1; });
      document.body.appendChild(pull);
      const doctor = document.createElement('button');
      doctor.id = 'mlsAthenaDoctorBtn';
      doctor.type = 'button';
      doctor.textContent = 'Athena connection doctor';
      doctor.addEventListener('click', () => { window.__lateToolHits.doctor += 1; });
      document.body.appendChild(doctor);
    });
    await page.waitForFunction(() => {
      const labels = Array.from(document.querySelectorAll('#mlsToolsMenu .rn')).map((node) => node.textContent.trim());
      return labels.includes('Pull activity') && labels.includes('Troubleshoot Athena');
    });
    const late = await page.evaluate(() => {
      const menu = document.getElementById('mlsToolsMenu');
      const labels = Array.from(menu.querySelectorAll('.rn')).map((node) => node.textContent.trim());
      return {
        sameMenu: menu.dataset.lateProducerProof === 'same-open-menu',
        pullRows: labels.filter((label) => label === 'Pull activity').length,
        doctorRows: labels.filter((label) => label === 'Troubleshoot Athena').length,
        focusedLabel: document.activeElement && document.activeElement.querySelector('.rn') ? document.activeElement.querySelector('.rn').textContent.trim() : ''
      };
    });
    assert.strictEqual(late.sameMenu, true, 'late tools replaced or closed the menu instead of refreshing it in place');
    assert.strictEqual(late.pullRows, 1, 'Pull activity did not appear exactly once after its producer mounted');
    assert.strictEqual(late.doctorRows, 1, 'Troubleshoot Athena did not appear exactly once after its producer mounted');
    assert.strictEqual(late.focusedLabel, 'Help', 'late tool insertion moved keyboard focus to a different capability');

    await page.evaluate(() => { document.getElementById('mlsAthenaDoctorBtn').hidden = true; });
    await page.waitForFunction(() => !Array.from(document.querySelectorAll('#mlsToolsMenu .rn')).some((node) => node.textContent.trim() === 'Troubleshoot Athena'));
    assert.strictEqual(await page.evaluate(() => Array.from(document.querySelectorAll('#mlsToolsMenu .rn')).filter((node) => node.textContent.trim() === 'Troubleshoot Athena').length), 0,
      'a newly unavailable late tool stayed advertised in the open menu');
    await page.evaluate(() => { document.getElementById('mlsAthenaDoctorBtn').hidden = false; });
    await page.waitForFunction(() => Array.from(document.querySelectorAll('#mlsToolsMenu .rn')).some((node) => node.textContent.trim() === 'Troubleshoot Athena'));
    assert.strictEqual(await page.evaluate(() => Array.from(document.querySelectorAll('#mlsToolsMenu .rn')).filter((node) => node.textContent.trim() === 'Troubleshoot Athena').length), 1,
      'a late tool did not return exactly once when it became available again');

    await page.evaluate(() => {
      const row = Array.from(document.querySelectorAll('#mlsToolsMenu .r')).find((node) => node.querySelector('.rn').textContent.trim() === 'Pull activity');
      row.click();
    });
    assert.strictEqual(await page.evaluate(() => window.__lateToolHits.pull), 1, 'the refreshed Pull activity row did not drive its real producer');
    assert.strictEqual(await page.evaluate(() => !!document.getElementById('mlsToolsMenu')), false, 'running a refreshed tool did not close Tools');

    state = await clickAndRead();
    assert.strictEqual(state.menuPresent, true, 'Tools did not reopen after running a refreshed row');
    await page.evaluate(() => {
      const row = Array.from(document.querySelectorAll('#mlsToolsMenu .r')).find((node) => node.querySelector('.rn').textContent.trim() === 'Troubleshoot Athena');
      row.click();
    });
    assert.strictEqual(await page.evaluate(() => window.__lateToolHits.doctor), 1, 'the refreshed Troubleshoot Athena row did not drive its real producer');
    assert.strictEqual(await page.evaluate(() => !!document.getElementById('mlsToolsMenu')), false, 'running the second refreshed tool did not close Tools');

    /* Reproduce an external owner detaching the overlay without access to the
       Calm shell's private close callback.  The very next press must open. */
    await clickAndRead();
    await page.evaluate(() => document.getElementById('mlsToolsMenu').remove());
    state = await clickAndRead();
    assert.strictEqual(state.menuPresent, true, 'one Tools press was swallowed by a stale detached-menu callback');
    assert.strictEqual(state.shortcutExpanded, 'false', 'detached-menu recovery changed Visit shortcuts');

    /* A normal shell teardown/reboot is the deployed warm-update lifecycle. */
    await page.evaluate(() => { window.__mlsCalmShell.revert(); window.__mlsCalmShell.boot(); });
    state = await clickAndRead();
    assert.strictEqual(state.menuPresent, true, 'one Tools press was swallowed after shell restart');
    assert.strictEqual(state.shortcutExpanded, 'false', 'shell restart coupled Tools to Visit shortcuts');

    console.log('calm tools menu lifecycle: 18 checks passed');
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
