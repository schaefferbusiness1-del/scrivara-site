'use strict';

/* P1 BOTTOM-DOCK OWNER
 * Real Chrome executes the exact preview guard. A small synthetic Calm owner
 * supplies the canonical API and rendered geometry, without modifying the
 * shared Calm asset or loading the app/backend.
 */
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const connect = fs.readFileSync(path.join(root, '1p-mls-connect.js'), 'utf8');
const marker = connect.indexOf('/* p1-calm-dock-1.0.0:');
const start = connect.indexOf(';(function(){try{', marker);
const endMark = '}catch(e){}})();';
const end = connect.indexOf(endMark, start);
assert(marker >= 0 && start > marker && end > start, 'could not isolate the P1 Calm dock owner');
const guard = connect.slice(start, end + endMark.length);

let checks = 0;
function ok(value, message) { assert.ok(value, message); checks++; }
function eq(actual, expected, message) { assert.strictEqual(actual, expected, message); checks++; }
ok(!/1p-feat_mls_classic_bridge/.test(connect), 'preview still references the retired Classic bridge');
ok(/mls-p1-dock-ready/.test(guard) && /failed-render-timeout/.test(guard),
  'dock owner lost its ready-only geometry gate or honest render timeout');

const calmAsset = String.raw`(function(){
  if(window.__mlsCalmShell)return;
  var mode=window.__calmMode||'ready',active=false;
  function renderDock(){
    if(mode==='delayed'&&!(window.__allowDock===true))return;
    if(mode==='blank')return;
    var dock=document.getElementById('mlsDock');if(!dock){dock=document.createElement('nav');dock.id='mlsDock';dock.setAttribute('aria-label','Primary navigation');
      dock.innerHTML='<button data-dest="day">Today</button><button data-dest="visit">Visit</button><button data-dest="tools">Tools</button>';document.body.appendChild(dock);}
    dock.style.cssText='position:fixed;left:50%;bottom:18px;transform:translateX(-50%);display:flex;width:520px;height:64px;visibility:visible';
  }
  var api={installed:true,version:'calm-1.0.0',active:false,go:function(){},render:function(){if(active)renderDock();},
    boot:function(){if(mode==='boot-fail')return false;active=true;api.active=true;document.body.classList.add('mls-calm');renderDock();return true;},
    revert:function(){active=false;api.active=false;document.body.classList.remove('mls-calm');var dock=document.getElementById('mlsDock');if(dock)dock.remove();return true;}};
  window.__mlsCalmShell=api;
})();`;

function html(mode) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body{margin:0;padding-left:236px;min-height:100vh}#mlsRdNav{display:block;position:fixed;left:0;top:0;width:236px;height:100vh;background:#eee}
  </style><script>
    window.__MLS_P1_PREVIEW={enabled:true,route:'/1p/'};window.__MLS_AV='${mode}';window.__calmMode='${mode}';
    window.__jobs=[];window.__mlsDeferAsset=function(fn){window.__jobs.push(fn);setTimeout(fn,0);return window.__jobs.length;};
    window.uns=function(k){return 'account-preview:'+k;};
    try{localStorage.setItem('mlsCalmShell','0');localStorage.setItem('mls::qolDockSide','left');localStorage.setItem('account-preview:qolDockSide','right');}catch(e){}
  </script></head><body><nav id="mlsRdNav">Old left rail</nav><main id="appScreen">Preview</main><script src="/guard.js"></script></body></html>`;
}

function serve() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1'); res.setHeader('Cache-Control', 'no-store');
      if (url.pathname === '/guard.js') { res.setHeader('Content-Type', 'text/javascript'); return res.end(guard); }
      if (url.pathname === '/feat_mls_calm_shell.js') {
        if (url.searchParams.get('v') === 'network-error') { res.statusCode = 404; return res.end('not found'); }
        res.setHeader('Content-Type', 'text/javascript'); return res.end(calmAsset);
      }
      res.setHeader('Content-Type', 'text/html'); res.end(html(url.searchParams.get('mode') || 'ready'));
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function open(browser, base, mode, query) {
  const page = await browser.newPage(); const errors = []; page.on('pageerror', e => errors.push(String(e && e.message || e)));
  await page.goto(base + '/?mode=' + mode + (query || ''), { waitUntil: 'load' }); return { page, errors };
}

(async () => {
  const server = await serve(), base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ channel: 'chrome', headless: true }); let failure = null;
  try {
    /* Stale Classic/device/account preferences are normalized and the old rail
       disappears only after the fixed bottom dock has real geometry. */
    {
      const { page, errors } = await open(browser, base, 'ready', '&ui=classic');
      await page.waitForFunction(() => window.__mlsP1CalmDock && window.__mlsP1CalmDock.state === 'ready');
      const result = await page.evaluate(() => {
        const dock = document.getElementById('mlsDock'), rect = dock.getBoundingClientRect();
        return { state: window.__mlsP1CalmDock.state, calm: localStorage.getItem('mlsCalmShell'),
          deviceSide: localStorage.getItem('mls::qolDockSide'), accountSide: localStorage.getItem('account-preview:qolDockSide'),
          query: location.search, bodyPadding: getComputedStyle(document.body).paddingLeft,
          rail: getComputedStyle(document.getElementById('mlsRdNav')).display, dockPosition: getComputedStyle(dock).position,
          dockBottomGap: innerHeight - rect.bottom, dockTop: rect.top, readyClass: document.body.classList.contains('mls-p1-dock-ready') };
      });
      eq(result.state, 'ready', 'healthy dock owner did not report ready');
      eq(result.calm, '1', 'stale Classic preference survived normal preview boot');
      eq(result.deviceSide, 'bottom', 'device dock placement was not forced to bottom');
      eq(result.accountSide, 'bottom', 'account dock placement was not forced to bottom');
      ok(!/ui=classic/i.test(result.query), 'diagnostic Classic query survived and can poison later navigation');
      eq(result.bodyPadding, '0px', 'ready bottom dock retained left-rail body padding');
      eq(result.rail, 'none', 'ready bottom dock retained the old left rail');
      eq(result.dockPosition, 'fixed', 'bottom dock is not fixed to the viewport');
      ok(result.dockBottomGap >= -2 && result.dockBottomGap <= 120 && result.dockTop > 300,
        'rendered dock geometry is not at the viewport bottom');
      eq(result.readyClass, true, 'ready-only presentation class was not applied');
      eq(errors.length, 0, 'healthy dock runtime raised page errors: ' + errors.join(' | '));

      /* A click aimed at the shared Classic control is captured by the preview
         owner and cannot persist the old layout. */
      const click = await page.evaluate(() => {
        const b = document.createElement('button'); b.id = 'mlsClassicBtn'; b.textContent = 'Classic layout';
        b.addEventListener('click', () => localStorage.setItem('mlsCalmShell', '0')); document.body.appendChild(b); b.click();
        return { calm: localStorage.getItem('mlsCalmShell'), exists: !!document.getElementById('mlsClassicBtn'), state: window.__mlsP1CalmDock.state };
      });
      eq(click.calm, '1', 'Classic control poisoned the persistent preference');
      eq(click.exists, false, 'Classic control survived preview reconciliation');
      eq(click.state, 'ready', 'Classic control disrupted the ready dock');
      await page.close();
    }

    /* Delayed render keeps the old rail usable while it waits, then atomically
       switches only after bottom geometry becomes provable. */
    {
      const { page } = await open(browser, base, 'delayed');
      await page.waitForFunction(() => window.__mlsP1CalmDock && window.__mlsP1CalmDock.state === 'waiting-render');
      const waiting = await page.evaluate(() => ({ rail: getComputedStyle(document.getElementById('mlsRdNav')).display,
        padding: getComputedStyle(document.body).paddingLeft, ready: document.body.classList.contains('mls-p1-dock-ready') }));
      eq(waiting.rail, 'block', 'old rail was hidden before delayed dock geometry existed');
      eq(waiting.padding, '236px', 'left padding was cleared before delayed dock geometry existed');
      eq(waiting.ready, false, 'delayed dock claimed ready without geometry');
      await page.evaluate(() => { window.__allowDock = true; window.__mlsP1CalmDock.reconcile(); });
      await page.waitForFunction(() => window.__mlsP1CalmDock.state === 'ready');
      const ready = await page.evaluate(() => ({ rail: getComputedStyle(document.getElementById('mlsRdNav')).display,
        padding: getComputedStyle(document.body).paddingLeft, dock: !!document.getElementById('mlsDock') }));
      eq(ready.rail, 'none', 'old rail survived after delayed dock became ready');
      eq(ready.padding, '0px', 'left padding survived after delayed dock became ready');
      eq(ready.dock, true, 'delayed canonical owner never rendered its dock');
      await page.close();
    }

    /* Network failure is visible and leaves the proven existing navigation. */
    {
      const { page } = await open(browser, base, 'network-error');
      await page.waitForFunction(() => window.__mlsP1CalmDock && window.__mlsP1CalmDock.state === 'failed-network');
      const result = await page.evaluate(() => ({ alert: document.getElementById('mlsP1CalmDockStatus') && document.getElementById('mlsP1CalmDockStatus').textContent,
        rail: getComputedStyle(document.getElementById('mlsRdNav')).display, padding: getComputedStyle(document.body).paddingLeft,
        ready: document.body.classList.contains('mls-p1-dock-ready') }));
      ok(/could not load/i.test(result.alert), 'failed dock load was not surfaced honestly');
      eq(result.rail, 'block', 'failed dock load hid the only working navigation');
      eq(result.padding, '236px', 'failed dock load cleared the old navigation gutter');
      eq(result.ready, false, 'failed dock load retained the ready marker');
      await page.close();
    }

    /* Exact revert removes only this guard's presentation and restores the
       canonical owner's normal teardown. Saved stale owner cannot re-enter. */
    {
      const { page } = await open(browser, base, 'ready');
      await page.waitForFunction(() => window.__mlsP1CalmDock && window.__mlsP1CalmDock.state === 'ready');
      const result = await page.evaluate(() => {
        const old = window.__mlsP1CalmDock, value = old.revert(), staleEnsure = old.ensure(), staleRevert = old.revert();
        return { value, staleEnsure, staleRevert, controller: !!window.__mlsP1CalmDock,
          guardStyle: !!document.getElementById('mlsP1CalmDockGuardCss'), ready: document.body.classList.contains('mls-p1-dock-ready'),
          dock: !!document.getElementById('mlsDock') };
      });
      eq(result.value, true, 'exact dock guard did not revert');
      eq(result.staleEnsure, false, 'stale dock guard ensure re-entered');
      eq(result.staleRevert, false, 'stale dock guard reverted twice');
      eq(result.controller, false, 'revert left the canonical guard global');
      eq(result.guardStyle, false, 'revert left the ready-only guard stylesheet');
      eq(result.ready, false, 'revert left the ready-only body class');
      eq(result.dock, false, 'revert left the canonical dock active');
      await page.close();
    }
  } catch (error) { failure = error; }
  await browser.close(); await new Promise(resolve => server.close(resolve));
  if (failure) throw failure;
  console.log('PASS P1 Calm bottom-dock owner runtime: ' + checks + ' assertions');
})().catch(error => { console.error(error && error.stack || error); process.exit(1); });
