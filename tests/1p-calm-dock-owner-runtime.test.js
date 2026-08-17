'use strict';

/* P1 CALM DOCK OWNER
 *
 * Real Chrome executes the exact /p1 guard against a deliberately small Calm
 * owner. The fixture owns only the shared shell contract; positioning,
 * preference, compact-mode, and fallback assertions belong to the /p1 guard.
 * Production/shared assets are never loaded or modified by this suite.
 */
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const connect = fs.readFileSync(path.join(root, '1p-mls-connect.js'), 'utf8');
const marker = connect.search(/\/\* p1-calm-dock-\d+\.\d+\.\d+:/);
const start = connect.indexOf(';(function(){try{', marker);
const endMark = '}catch(e){}})();';
const end = connect.indexOf(endMark, start);
assert(marker >= 0 && start > marker && end > start, 'could not isolate the P1 Calm dock owner');
const guard = connect.slice(start, end + endMark.length);

let checks = 0;
function ok(value, message) { assert.ok(value, message); checks++; }
function eq(actual, expected, message) { assert.strictEqual(actual, expected, message); checks++; }
function noOverlap(a, b) {
  return !a || !b || a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom;
}
function withinViewport(rect, viewport, label) {
  ok(rect.left >= -1 && rect.top >= -1 && rect.right <= viewport.width + 1 && rect.bottom <= viewport.height + 1,
    `${label} escaped ${viewport.width}x${viewport.height}: ${JSON.stringify(rect)}`);
}
/* defect-4: the four widgets' own base (untransformed) fixed position, exactly
   as declared in the fixture's <style> (mirroring 1pScribeFlow.html). Used to
   compute the offset the guard's CSS is expected to add, so the assertion
   proves the mechanism fired rather than relying on incidental overlap at
   whatever size the fixture happens to be. */
const WIDGET_BASE = {
  patientFace: { left: 18, bottom: 18, width: 50, height: 50 },
  backupBadge: { left: 16, bottom: 84, width: 140, height: 34 },
  getPhoneCard: { right: 16, bottom: 16, width: 200, height: 80 },
  fab: { right: 24, bottom: 96, width: 54, height: 54 }
};
function baseRect(name, viewport) {
  const b = WIDGET_BASE[name];
  const left = b.left != null ? b.left : viewport.width - b.right - b.width;
  const top = viewport.height - b.bottom - b.height;
  return { left, top, right: left + b.width, bottom: top + b.height };
}
function approx(actual, expected, tol, label) {
  ok(Math.abs(actual - expected) <= tol, `${label}: expected ~${expected}, got ${actual}`);
}

ok(!/1p-feat_mls_classic_bridge/.test(connect), 'preview still references the retired Classic bridge');
ok(/mls-p1-dock-ready/.test(guard) && /failed-render-timeout/.test(guard),
  'dock owner lost its ready-only geometry gate or honest render timeout');
ok(/mlsP1DockHandle/.test(guard) && /p1DockPinnedV1/.test(guard),
  'P1 compact handle or persisted pin contract is absent');

const calmAsset = String.raw`(function(){
  if(window.__mlsCalmShell)return;
  var mode=window.__calmMode||'ready',active=false,dock=null;
  var SIDES={bottom:1,top:1,left:1,right:1};
  function key(){try{return window.uns('qolDockSide');}catch(e){return 'mls::qolDockSide';}}
  function side(){var v='';try{v=localStorage.getItem(key())||'';}catch(e){}return SIDES[v]?v:'bottom';}
  function rectStyle(el,css){el.style.cssText=css;}
  function buildDock(){
    dock=document.getElementById('mlsDock');if(dock)return dock;
    dock=document.createElement('nav');dock.id='mlsDock';dock.setAttribute('aria-label','Primary navigation');
    dock.innerHTML='<button data-dest="day">Today</button><button data-dest="visit">Visit</button><button data-dest="tools">Tools</button>'+
      '<div id="mlsDockAskWrap"><input id="mlsDockAsk" aria-label="Ask or find anything"><div id="mlsAskResults" role="listbox"><div>Result</div></div></div>';
    document.body.appendChild(dock);
    var tools=dock.querySelector('[data-dest="tools"]');
    tools.addEventListener('click',function(){
      if(window.__fixtureToolsClose){window.__fixtureToolsClose();return;}
      var menu=document.createElement('div');menu.id='mlsToolsMenu';menu.setAttribute('role','menu');
      menu.innerHTML='<div class="grp" role="group" aria-label="App"><div class="gh">App</div><div class="r" role="menuitem">Settings</div></div>';
      rectStyle(menu,'position:fixed;width:300px;height:230px;box-sizing:border-box;display:block;left:10px;bottom:'+(innerHeight-tools.getBoundingClientRect().top+10)+'px;background:white');
      document.body.appendChild(menu);
      function close(){if(menu.parentNode)menu.remove();document.removeEventListener('click',away,true);window.__fixtureToolsClose=null;}
      function away(event){if(!menu.contains(event.target)&&!tools.contains(event.target))close();}
      window.__fixtureToolsClose=close;setTimeout(function(){document.addEventListener('click',away,true);},0);
      menu.addEventListener('keydown',function(event){if(event.key==='Escape')close();});
    });
    var ask=dock.querySelector('#mlsDockAsk'),results=dock.querySelector('#mlsAskResults');
    ask.addEventListener('focus',function(){results.style.display='block';});
    ask.addEventListener('blur',function(){setTimeout(function(){results.style.display='none';},20);});
    return dock;
  }
  function apply(sideValue){
    var saved=SIDES[sideValue]?sideValue:side();
    if(saved==='bottom')document.body.removeAttribute('data-mls-dock');else document.body.setAttribute('data-mls-dock',saved);
    if(!dock)return saved;
    /* Mirrors feat_mls_calm_shell.js's own unconditional-of-attribute
       @media(max-width:760px) rule (not 640) -- the guard's narrowDock() must
       agree with this exact threshold or defect-3's 641-760 band reopens. */
    var actual=innerWidth<=760?'bottom':saved,w=Math.max(120,Math.min(520,innerWidth-16)),h=64;
    var base='position:fixed;display:flex;align-items:center;gap:4px;visibility:visible;opacity:1;box-sizing:border-box;z-index:920;padding:6px;';
    if(actual==='bottom')rectStyle(dock,base+'left:50%;right:auto;top:auto;bottom:18px;width:'+w+'px;height:'+h+'px;transform:translateX(-50%);flex-direction:row');
    else if(actual==='top')rectStyle(dock,base+'left:50%;right:auto;top:124px;bottom:auto;width:'+w+'px;height:'+h+'px;transform:translateX(-50%);flex-direction:row');
    else if(actual==='left')rectStyle(dock,base+'left:18px;right:auto;top:50%;bottom:auto;width:104px;height:'+Math.min(440,innerHeight-150)+'px;transform:translateY(-50%);flex-direction:column');
    else rectStyle(dock,base+'left:auto;right:18px;top:50%;bottom:auto;width:104px;height:'+Math.min(440,innerHeight-150)+'px;transform:translateY(-50%);flex-direction:column');
    return saved;
  }
  function renderDock(){
    if(mode==='delayed'&&window.__allowDock!==true)return;
    if(mode==='blank')return;
    buildDock();apply(side());
  }
  window.applyDockSidePreview=function(next){if(!SIDES[next])next='bottom';try{localStorage.setItem(key(),next);}catch(e){}apply(next);return next;};
  window.mlsDockSide=side;
  window.addEventListener('resize',function(){if(dock)apply(side());});
  var api={installed:true,version:'calm-1.0.0',active:false,go:function(){},render:function(){if(active)renderDock();},
    boot:function(){if(mode==='boot-fail')return false;active=true;api.active=true;document.body.classList.add('mls-calm');renderDock();return true;},
    revert:function(){active=false;api.active=false;document.body.classList.remove('mls-calm');if(window.__fixtureToolsClose)window.__fixtureToolsClose();['mlsDock','mlsToolsMenu'].forEach(function(id){var n=document.getElementById(id);if(n)n.remove();});dock=null;return true;}};
  window.__mlsCalmShell=api;
})();`;

function html(params) {
  const p1 = params.get('p1') !== '0';
  const side = params.get('side') || 'bottom';
  const device = params.get('device') || (side === 'left' ? 'top' : 'left');
  const pin = params.get('pin') == null ? '1' : params.get('pin');
  const mode = params.get('mode') || 'ready';
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    *{box-sizing:border-box}html,body{width:100%;min-height:100%;margin:0}body{padding-left:236px;font-family:system-ui,sans-serif}
    #mlsRdNav{display:block;position:fixed;left:0;top:0;width:236px;height:100vh;background:#eee;z-index:50}
    #appHeader{display:block;position:fixed;left:0;right:0;top:0;height:64px;background:#f7faf8;z-index:6000}
    #mlsCtxBar{display:block;position:fixed;left:0;right:0;top:64px;height:48px;background:#eef5f0;z-index:5900}
    #appWrap{position:relative;margin-top:120px;min-height:650px;padding:28px;background:#fff}
    body[data-mls-dock="left"] #appWrap{padding-left:148px!important}body[data-mls-dock="right"] #appWrap{padding-right:148px!important}
    body[data-mls-dock="top"] #appWrap{padding-top:110px!important}
    /* defect-2 fixture parity: production reserves this unconditionally once
       .mls-calm is active (feat_mls_calm_shell.js line 221), regardless of side. */
    body.mls-calm{padding-bottom:96px}
    #primaryAction{display:block;width:240px;height:64px}
    #mlsDock button{min-width:64px;height:44px}#mlsDockAskWrap{position:relative;width:92px;height:36px}
    #mlsDockAsk{width:92px;height:36px}#mlsAskResults{display:none;position:absolute;right:0;bottom:46px;width:250px;height:120px;background:#fff;border:1px solid #bbb}
    #mlsToolsMenu .grp{display:block}#mlsToolsMenu .r{min-height:44px;padding:8px}
    /* defect-4 fixture parity: the four fixed corner widgets, at their real
       production base position/z-index (see 1pScribeFlow.html). */
    #_patientFace{position:fixed;left:18px;bottom:18px;z-index:9500;width:50px;height:50px;background:#2E6A4B}
    #_backupBadge{position:fixed;left:16px;bottom:84px;z-index:9000;width:140px;height:34px;background:#fff7e6}
    #mlsGetPhoneCard{position:fixed;right:16px;bottom:16px;z-index:99996;width:200px;height:80px;background:#F6FBF8}
    #mlsFab{position:fixed;right:24px;bottom:96px;z-index:99980;width:54px;height:54px;background:#1F63C9}
  </style><script>
    ${p1 ? "window.__MLS_P1_PREVIEW={enabled:true,route:'/1p/'};" : ''}
    window.__MLS_AV='${mode}';window.__calmMode='${mode}';window.__acct='a';
    window.__jobs=[];window.__mlsDeferAsset=function(fn){window.__jobs.push(fn);setTimeout(fn,0);return window.__jobs.length;};
    window.uns=function(k){return 'account-'+window.__acct+':'+k;};
    try{localStorage.setItem('mlsCalmShell','0');localStorage.setItem('mls::qolDockSide','${device}');localStorage.setItem('account-a:qolDockSide','${side}');localStorage.setItem('account-a:p1DockPinnedV1','${pin}');}catch(e){}
  </script></head><body><header id="appHeader">Header</header><div id="mlsCtxBar">Patient context</div>
  <nav id="mlsRdNav">Old left rail</nav>
  <div id="_patientFace"></div><div id="_backupBadge"></div><div id="mlsGetPhoneCard"></div><button id="mlsFab" type="button"></button>
  <main id="appWrap"><section id="appScreen"><button id="primaryAction">Primary action</button>
  <label for="qolDockSide">Navigation bar</label><select id="qolDockSide" onchange="applyDockSidePreview(this.value)">
  <option value="bottom">Bottom</option><option value="top">Top</option><option value="left">Left</option><option value="right">Right</option></select>
  <label for="qolDockAutoHide">Auto-hide</label><input type="checkbox" id="qolDockAutoHide" onchange="if(typeof applyDockAutoHidePreview==='function')applyDockAutoHidePreview(this.checked)">
  </section></main><script src="/guard.js"></script></body></html>`;
}

function serve() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      res.setHeader('Cache-Control', 'no-store');
      if (url.pathname === '/guard.js') { res.setHeader('Content-Type', 'text/javascript'); return res.end(guard); }
      if (url.pathname === '/feat_mls_calm_shell.js') {
        if (url.searchParams.get('v') === 'network-error') { res.statusCode = 404; return res.end('not found'); }
        res.setHeader('Content-Type', 'text/javascript'); return res.end(calmAsset);
      }
      res.setHeader('Content-Type', 'text/html'); res.end(html(url.searchParams));
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function open(browser, base, options = {}) {
  const viewport = options.viewport || { width: 1280, height: 800 };
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(String(error && error.message || error)));
  const query = new URLSearchParams({
    mode: options.mode || 'ready', side: options.side || 'bottom',
    device: options.device || (options.side === 'left' ? 'top' : 'left'),
    pin: options.pin == null ? '1' : String(options.pin), p1: options.p1 === false ? '0' : '1'
  });
  if (options.classic) query.set('ui', 'classic');
  await page.goto(`${base}/?${query}`, { waitUntil: 'load' });
  return { context, page, errors, viewport };
}

async function ready(page) {
  await page.waitForFunction(() => window.__mlsP1CalmDock && window.__mlsP1CalmDock.state === 'ready');
}

async function snapshot(page) {
  return page.evaluate(() => {
    function rect(id) { const n = document.getElementById(id); if (!n) return null; const r = n.getBoundingClientRect(); return { left:r.left, top:r.top, right:r.right, bottom:r.bottom, width:r.width, height:r.height }; }
    const dock = document.getElementById('mlsDock'), handle = document.getElementById('mlsP1DockHandle');
    return {
      state: window.__mlsP1CalmDock && window.__mlsP1CalmDock.state,
      calm: localStorage.getItem('mlsCalmShell'),
      deviceSide: localStorage.getItem('mls::qolDockSide'),
      accountSide: localStorage.getItem('account-'+window.__acct+':qolDockSide'),
      pin: localStorage.getItem('account-'+window.__acct+':p1DockPinnedV1'),
      attr: document.body.getAttribute('data-mls-dock') || 'bottom',
      query: location.search,
      rail: getComputedStyle(document.getElementById('mlsRdNav')).display,
      padding: getComputedStyle(document.body).paddingLeft,
      ready: document.body.classList.contains('mls-p1-dock-ready'),
      collapsed: document.body.classList.contains('mls-p1-dock-collapsed'),
      dockVisibility: dock ? getComputedStyle(dock).visibility : 'absent',
      handleDisplay: handle ? getComputedStyle(handle).display : 'absent',
      dock: rect('mlsDock'), handle: rect('mlsP1DockHandle'), header: rect('appHeader'),
      context: rect('mlsCtxBar'), primary: rect('primaryAction'), menu: rect('mlsToolsMenu'), results: rect('mlsAskResults'),
      /* defect-2 */
      clearanceReleased: document.body.classList.contains('mls-p1-dock-clearance-released'),
      wrapPaddingLeft: (() => { const w = document.getElementById('appWrap'); return w ? getComputedStyle(w).paddingLeft : null; })(),
      wrapPaddingRight: (() => { const w = document.getElementById('appWrap'); return w ? getComputedStyle(w).paddingRight : null; })(),
      bodyPaddingBottom: getComputedStyle(document.body).paddingBottom,
      /* defect-4 */
      patientFace: rect('_patientFace'), backupBadge: rect('_backupBadge'),
      getPhoneCard: rect('mlsGetPhoneCard'), fab: rect('mlsFab'),
      /* defect-1 */
      autoHideChecked: (() => { const c = document.getElementById('qolDockAutoHide'); return c ? c.checked : null; })(),
      autoHideGetter: (typeof window.mlsDockAutoHide === 'function') ? window.mlsDockAutoHide() : null
    };
  });
}

function assertGeometry(result, side, viewport, label) {
  withinViewport(result.dock, viewport, `${label} dock`);
  ok(noOverlap(result.dock, result.header), `${label} dock obstructed the header`);
  ok(noOverlap(result.dock, result.context), `${label} dock obstructed patient context`);
  ok(noOverlap(result.dock, result.primary), `${label} dock obstructed the primary action`);
  if (side === 'bottom') ok(viewport.height - result.dock.bottom >= -1 && viewport.height - result.dock.bottom <= 80, `${label} did not render at bottom`);
  if (side === 'top') ok(result.dock.top >= result.context.bottom && result.dock.bottom < viewport.height * .55, `${label} did not render below top chrome`);
  if (side === 'left') ok(result.dock.left >= -1 && result.dock.left <= 50, `${label} did not render at left`);
  if (side === 'right') ok(viewport.width - result.dock.right >= -1 && viewport.width - result.dock.right <= 50, `${label} did not render at right`);
}

(async () => {
  const server = await serve(), base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  let failure = null;
  try {
    /* The same bytes are inert without the exact preview marker. */
    {
      const { context, page, errors } = await open(browser, base, { p1: false, side: 'left', pin: 0 });
      await page.waitForTimeout(80);
      const result = await page.evaluate(() => ({ controller: !!window.__mlsP1CalmDock, dock: !!document.getElementById('mlsDock'),
        rail: getComputedStyle(document.getElementById('mlsRdNav')).display, account: localStorage.getItem('account-a:qolDockSide'),
        pin: localStorage.getItem('account-a:p1DockPinnedV1') }));
      eq(result.controller, false, 'dock guard installed outside /p1');
      eq(result.dock, false, 'shared dock asset loaded outside /p1');
      eq(result.rail, 'block', 'non-P1 page lost its existing navigation');
      eq(result.account, 'left', 'non-P1 page changed its saved side');
      eq(result.pin, '0', 'non-P1 page changed its pin preference');
      eq(errors.length, 0, 'non-P1 early exit raised page errors: ' + errors.join(' | '));
      await context.close();
    }

    /* Every supported desktop side survives boot and proves non-obstructing geometry. */
    for (const side of ['bottom', 'top', 'left', 'right']) {
      const device = side === 'left' ? 'top' : 'left';
      const opened = await open(browser, base, { side, device, pin: 1, classic: true });
      await ready(opened.page);
      const result = await snapshot(opened.page);
      eq(result.state, 'ready', `${side}: owner did not report ready`);
      eq(result.calm, '1', `${side}: stale Classic preference survived`);
      eq(result.accountSide, side, `${side}: account preference was overwritten`);
      eq(result.deviceSide, device, `${side}: unrelated device fallback was overwritten`);
      eq(result.attr, side, `${side}: rendered side attribute was normalized away`);
      ok(!/ui=classic/i.test(result.query), `${side}: Classic query survived`);
      eq(result.rail, 'none', `${side}: old rail survived ready dock`);
      eq(result.padding, '0px', `${side}: old rail body gutter survived`);
      eq(result.ready, true, `${side}: ready marker absent`);
      assertGeometry(result, side, opened.viewport, side);
      eq(opened.errors.length, 0, `${side}: page errors: ${opened.errors.join(' | ')}`);

      /* defect-4: verify the offset MECHANISM fired (widget rect moved off its
         own declared base by the expected amount), not just that this
         fixture's incidental dimensions happen not to collide -- at this
         viewport a vertical left/right rail never reaches these corners even
         with no offset at all, so a plain noOverlap check here would pass
         whether or not the fix exists. */
      {
        const vp = opened.viewport;
        const base = { patientFace: baseRect('patientFace', vp), backupBadge: baseRect('backupBadge', vp),
          getPhoneCard: baseRect('getPhoneCard', vp), fab: baseRect('fab', vp) };
        if (side === 'bottom') {
          ['patientFace', 'backupBadge', 'getPhoneCard', 'fab'].forEach((w) => {
            approx(result[w].top, base[w].top - 96, 1.5, `${side}: ${w} top did not shift clear of the bottom dock`);
          });
        } else if (side === 'top') {
          ['patientFace', 'backupBadge', 'getPhoneCard', 'fab'].forEach((w) => {
            approx(result[w].top, base[w].top, 1.5, `${side}: ${w} moved even though the top dock never reaches these corners`);
          });
        } else if (side === 'left') {
          approx(result.patientFace.left, base.patientFace.left + 140, 1.5, `${side}: patient face chip did not clear the left rail`);
          approx(result.backupBadge.left, base.backupBadge.left + 140, 1.5, `${side}: backup badge did not clear the left rail`);
          approx(result.getPhoneCard.left, base.getPhoneCard.left, 1.5, `${side}: phone card moved though the left rail cannot reach it`);
          approx(result.fab.left, base.fab.left, 1.5, `${side}: FAB moved though the left rail cannot reach it`);
        } else if (side === 'right') {
          approx(result.getPhoneCard.left, base.getPhoneCard.left - 140, 1.5, `${side}: phone card did not clear the right rail`);
          approx(result.fab.left, base.fab.left - 140, 1.5, `${side}: FAB did not clear the right rail`);
          approx(result.patientFace.left, base.patientFace.left, 1.5, `${side}: patient face chip moved though the right rail cannot reach it`);
          approx(result.backupBadge.left, base.backupBadge.left, 1.5, `${side}: backup badge moved though the right rail cannot reach it`);
        }
        /* Whatever the mechanism did, the end state must still be a real,
           non-overlapping layout -- belt-and-suspenders over the precise
           per-side deltas above. */
        ok(noOverlap(result.dock, result.patientFace), `${side}: dock overlapped the patient face chip`);
        ok(noOverlap(result.dock, result.backupBadge), `${side}: dock overlapped the backup retry badge`);
        ok(noOverlap(result.dock, result.getPhoneCard), `${side}: dock overlapped the phone-app card`);
        ok(noOverlap(result.dock, result.fab), `${side}: dock overlapped the quick-action FAB`);
      }

      /* Tools and Ask must stay in the viewport for every orientation. */
      await opened.page.click('#mlsDock button[data-dest="tools"]');
      await opened.page.waitForSelector('#mlsToolsMenu #mlsP1DockMode');
      await opened.page.waitForTimeout(60);
      let overlays = await snapshot(opened.page);
      withinViewport(overlays.menu, opened.viewport, `${side} Tools menu`);
      await opened.page.click('#mlsDockAsk');
      await opened.page.waitForFunction(() => getComputedStyle(document.getElementById('mlsAskResults')).display !== 'none');
      await opened.page.waitForTimeout(60);
      overlays = await snapshot(opened.page);
      withinViewport(overlays.results, opened.viewport, `${side} Ask results`);
      await opened.context.close();
    }

    /* Auto-hide is opt-in, persists per account, and keeps a 44x44 reveal target. */
    {
      const opened = await open(browser, base, { side: 'left', pin: 1 });
      await ready(opened.page);
      await opened.page.click('#mlsDock button[data-dest="tools"]');
      await opened.page.waitForSelector('#mlsP1DockMode');
      await opened.page.click('#mlsP1DockMode');
      await opened.page.mouse.click(opened.viewport.width - 4, opened.viewport.height / 2);
      await opened.page.waitForSelector('#mlsToolsMenu', { state: 'detached' }); /* open menu correctly holds auto-hide open */
      await opened.page.waitForFunction(() => document.body.classList.contains('mls-p1-dock-collapsed'), null, { timeout: 3500 });
      let result = await snapshot(opened.page);
      eq(result.pin, '0', 'Auto-hide choice was not persisted to the account');
      eq(result.collapsed, true, 'unpinned dock did not collapse');
      eq(result.dockVisibility, 'hidden', 'collapsed dock remained interactive/visible');
      eq(result.handleDisplay, 'flex', 'collapsed reveal handle is not visible');
      ok(result.handle.width >= 44 && result.handle.height >= 44, 'collapsed reveal target is below 44x44');
      withinViewport(result.handle, opened.viewport, 'collapsed reveal handle');
      ok(noOverlap(result.handle, result.header) && noOverlap(result.handle, result.context) && noOverlap(result.handle, result.primary),
        'collapsed handle obstructs header, patient context, or primary action');
      /* defect-2 trap (a): a mere collapse -- the moment the compact class
         lands -- must NOT yet release the reserved clearance. Release is
         debounced (650ms) precisely so a hover peek never reflows the page. */
      eq(result.clearanceReleased, false, 'clearance released the instant the dock collapsed, before any settle debounce');
      eq(result.wrapPaddingLeft, '148px', 'reserved clearance dropped before a genuine settled collapse');

      /* The reveal target intentionally disappears as pointerenter reveals the
         dock. Move a real pointer to its measured centre instead of asking
         Playwright's locator hover to keep that target visible afterward. */
      await opened.page.mouse.move(result.handle.left + result.handle.width / 2, result.handle.top + result.handle.height / 2);
      await opened.page.waitForFunction(() => !document.body.classList.contains('mls-p1-dock-collapsed'), null, { timeout: 1200 });
      /* defect-2: restoring clearance on reveal is synchronous -- no debounce --
         so this quick peek (well under the 650ms release debounce) never even
         had clearance to restore, and the reserved padding never moved at all. */
      result = await snapshot(opened.page);
      eq(result.clearanceReleased, false, 'a transient peek released clearance it should never have had');
      eq(result.wrapPaddingLeft, '148px', 'a transient peek disturbed the reserved clearance');
      await opened.page.hover('#primaryAction');
      await opened.page.waitForFunction(() => document.body.classList.contains('mls-p1-dock-collapsed'), null, { timeout: 2200 });
      /* Now let the collapse genuinely settle past the release debounce, still
         untouched. This is the one deliberate reflow the doctor pays for. */
      await opened.page.waitForTimeout(750);
      result = await snapshot(opened.page);
      eq(result.clearanceReleased, true, 'clearance was never released for a genuinely settled, untouched collapse');
      eq(result.wrapPaddingLeft, '0px', 'reserved left clearance was not given back while the dock sat collapsed');
      /* defect-2 trap (b): with clearance genuinely released, a reconcile pass
         (any lifecycle event re-runs markReady()) must not read the missing
         padding as broken geometry and fail back to the legacy rail. */
      await opened.page.evaluate(() => window.dispatchEvent(new Event('resize')));
      await opened.page.waitForTimeout(150);
      result = await snapshot(opened.page);
      eq(result.rail, 'none', 'a reconcile pass while clearance was released fell back to the legacy rail');
      eq(result.collapsed, true, 'a reconcile pass while clearance was released disturbed the collapsed state');

      await opened.page.focus('#mlsP1DockHandle');
      await opened.page.waitForFunction(() => !document.body.classList.contains('mls-p1-dock-collapsed'));
      /* defect-2: restore is synchronous with reveal -- no waiting beyond the
         collapsed-class removal above -- so clearance must already be back. */
      result = await snapshot(opened.page);
      eq(result.clearanceReleased, false, 'clearance stayed released after the dock was revealed');
      eq(result.wrapPaddingLeft, '148px', 'reserved clearance was not restored when the dock was revealed');
      await opened.page.focus('#primaryAction');
      await opened.page.waitForFunction(() => document.body.classList.contains('mls-p1-dock-collapsed'), null, { timeout: 2200 });

      await opened.page.click('#mlsP1DockHandle');
      await opened.page.waitForFunction(() => !document.body.classList.contains('mls-p1-dock-collapsed'));
      result = await snapshot(opened.page);
      eq(result.collapsed, false, 'tap/click did not reveal navigation');

      await opened.page.click('#mlsDock button[data-dest="tools"]');
      await opened.page.waitForSelector('#mlsP1DockMode');
      await opened.page.click('#mlsP1DockMode');
      await opened.page.mouse.click(opened.viewport.width - 4, opened.viewport.height / 2);
      await opened.page.waitForSelector('#mlsToolsMenu', { state: 'detached' });
      await opened.page.waitForTimeout(1300);
      result = await snapshot(opened.page);
      eq(result.pin, '1', 'Pin-open choice was not persisted');
      eq(result.collapsed, false, 'pinned dock auto-hid');
      await opened.context.close();
    }

    /* A session boundary applies B's side/pin without mutating either account. */
    {
      const opened = await open(browser, base, { side: 'left', pin: 1 });
      await ready(opened.page);
      await opened.page.evaluate(() => {
        localStorage.setItem('account-b:qolDockSide', 'top');
        localStorage.setItem('account-b:p1DockPinnedV1', '0');
        window.__acct = 'b';
        window.dispatchEvent(new CustomEvent('mls:session-boundary', { detail: { nextAccount: 'b', epoch: 2 } }));
      });
      await opened.page.waitForFunction(() => document.body.getAttribute('data-mls-dock') === 'top');
      await opened.page.waitForFunction(() => document.body.classList.contains('mls-p1-dock-collapsed'), null, { timeout: 3500 });
      const result = await snapshot(opened.page);
      eq(result.accountSide, 'top', 'account B side was not applied on the session boundary');
      eq(result.pin, '0', 'account B pin preference was not applied');
      const retained = await opened.page.evaluate(() => ({ aSide: localStorage.getItem('account-a:qolDockSide'), aPin: localStorage.getItem('account-a:p1DockPinnedV1'),
        bSide: localStorage.getItem('account-b:qolDockSide'), bPin: localStorage.getItem('account-b:p1DockPinnedV1') }));
      assert.deepStrictEqual(retained, { aSide:'left', aPin:'1', bSide:'top', bPin:'0' }, 'account switch mutated a saved preference'); checks++;
      assertGeometry(result, 'top', opened.viewport, 'account B top');
      await opened.context.close();
    }

    /* The one existing setting applies immediately and survives later reconciliation. */
    {
      const opened = await open(browser, base, { side: 'bottom', pin: 1 });
      await ready(opened.page);
      await opened.page.selectOption('#qolDockSide', 'left');
      await opened.page.click('#primaryAction');
      await opened.page.setViewportSize({ width: 1270, height: 790 });
      await opened.page.waitForTimeout(100);
      const result = await snapshot(opened.page);
      eq(result.accountSide, 'left', 'position setting did not persist to the account key');
      eq(result.attr, 'left', 'position setting was reverted by click/resize reconciliation');
      assertGeometry(result, 'left', { width:1270, height:790 }, 'changed left');
      await opened.context.close();
    }

    /* A saved desktop side remains saved on a phone; actual geometry is bottom. */
    {
      const viewport = { width: 390, height: 844 };
      const opened = await open(browser, base, { side: 'left', device: 'top', pin: 0, viewport });
      await ready(opened.page);
      await opened.page.waitForTimeout(1200);
      const result = await snapshot(opened.page);
      eq(result.accountSide, 'left', 'phone overwrote the saved desktop side');
      eq(result.deviceSide, 'top', 'phone overwrote the unrelated device fallback');
      eq(result.attr, 'left', 'phone discarded the saved side attribute instead of rendering a responsive fallback');
      eq(result.collapsed, false, 'phone hid its primary navigation behind auto-hide');
      eq(result.dockVisibility, 'visible', 'phone primary navigation is not visible');
      assertGeometry(result, 'bottom', viewport, 'phone responsive fallback');
      ok(result.dock.width <= viewport.width + 1, 'phone dock overflows the viewport');
      eq(opened.errors.length, 0, 'phone layout raised page errors: ' + opened.errors.join(' | '));
      await opened.context.close();
    }

    /* defect-3: the 641-760 band. Below 641 the old threshold already forced
       bottom; at/above 760 the shell's own phone media query forces bottom on
       its own. In between, a non-bottom saved preference used to make the
       guard believe the dock was still a left/right/top rail while the shell
       had already unconditionally pinned it to the bottom -- dockGeometry()
       then measured a short, wide bar against a tall/narrow belief, failed its
       own size check forever, and the dock never reached ready. */
    for (const width of [700, 760]) {
      const viewport = { width, height: 800 };
      const opened = await open(browser, base, { side: 'left', device: 'top', pin: 0, viewport });
      await ready(opened.page);
      await opened.page.waitForTimeout(400);
      const result = await snapshot(opened.page);
      eq(result.state, 'ready', `${width}px: dock never reached ready in the 641-760 band`);
      eq(result.rail, 'none', `${width}px: fell back to the legacy rail in the 641-760 band`);
      eq(result.accountSide, 'left', `${width}px: band fallback overwrote the saved desktop side`);
      eq(result.attr, 'left', `${width}px: band fallback discarded the saved side attribute`);
      eq(result.collapsed, false, `${width}px: band width hid navigation behind auto-hide`);
      assertGeometry(result, 'bottom', viewport, `${width}px band fallback`);
      eq(opened.errors.length, 0, `${width}px: band layout raised page errors: ${opened.errors.join(' | ')}`);
      await opened.context.close();
    }

    /* defect-1: one Settings control group governs auto-hide, and the
       Tools-menu row survives as a shortcut into the exact same stored
       preference/setter -- never a second, independently-tracked truth. */
    {
      const opened = await open(browser, base, { side: 'bottom', pin: 1 });
      await ready(opened.page);
      let result = await snapshot(opened.page);
      eq(result.pin, '1', 'fixture did not start pinned open');
      eq(result.autoHideChecked, false, 'Settings auto-hide checkbox did not reflect the pinned-open starting state');
      eq(result.autoHideGetter, false, 'public mlsDockAutoHide() getter disagreed with the pinned-open starting state');

      /* Settings entry point: check the box, exactly as saveSettings()/the
         onchange handler does in 1pScribeFlow.html and 1p/index.html. */
      await opened.page.check('#qolDockAutoHide');
      await opened.page.waitForFunction(() => document.body.classList.contains('mls-p1-dock-collapsed'), null, { timeout: 3500 });
      result = await snapshot(opened.page);
      eq(result.pin, '0', 'Settings auto-hide checkbox did not persist the same p1DockPinnedV1 key the Tools-menu row uses');
      eq(result.autoHideGetter, true, 'public getter disagreed with the Settings checkbox after it was checked');
      eq(result.collapsed, true, 'checking Settings auto-hide did not actually engage auto-hide');

      /* Tools-menu shortcut entry point: flip it back off. Reveal first --
         the dock is collapsed and its own Tools button is what un-pins it. */
      await opened.page.mouse.move(result.handle.left + result.handle.width / 2, result.handle.top + result.handle.height / 2);
      await opened.page.waitForFunction(() => !document.body.classList.contains('mls-p1-dock-collapsed'), null, { timeout: 1200 });
      await opened.page.click('#mlsDock button[data-dest="tools"]');
      await opened.page.waitForSelector('#mlsP1DockMode');
      await opened.page.click('#mlsP1DockMode');
      await opened.page.mouse.click(opened.viewport.width - 4, opened.viewport.height / 2);
      await opened.page.waitForSelector('#mlsToolsMenu', { state: 'detached' });
      result = await snapshot(opened.page);
      eq(result.pin, '1', 'Tools-menu shortcut did not write the same key the Settings checkbox reads');
      eq(result.autoHideGetter, false, 'public getter disagreed with the Tools-menu shortcut after it re-pinned open');
      eq(result.collapsed, false, 'Tools-menu shortcut did not actually cancel auto-hide');
      await opened.context.close();
    }

    /* Delayed/failing owners preserve the old rail until replacement is proven. */
    {
      const opened = await open(browser, base, { side: 'top', mode: 'delayed' });
      await opened.page.waitForFunction(() => window.__mlsP1CalmDock && window.__mlsP1CalmDock.state === 'waiting-render');
      let result = await snapshot(opened.page);
      eq(result.rail, 'block', 'delayed dock hid the only working navigation');
      eq(result.padding, '236px', 'delayed dock cleared the old navigation gutter');
      eq(result.ready, false, 'delayed dock claimed ready without geometry');
      await opened.page.evaluate(() => { window.__allowDock = true; window.__mlsP1CalmDock.reconcile(); });
      await ready(opened.page);
      result = await snapshot(opened.page);
      eq(result.attr, 'top', 'delayed dock lost its saved top side');
      assertGeometry(result, 'top', opened.viewport, 'delayed top');
      await opened.context.close();
    }
    {
      const opened = await open(browser, base, { mode: 'network-error' });
      await opened.page.waitForFunction(() => window.__mlsP1CalmDock && window.__mlsP1CalmDock.state === 'failed-network');
      const result = await opened.page.evaluate(() => ({ alert: document.getElementById('mlsP1CalmDockStatus') && document.getElementById('mlsP1CalmDockStatus').textContent,
        rail: getComputedStyle(document.getElementById('mlsRdNav')).display, padding: getComputedStyle(document.body).paddingLeft,
        ready: document.body.classList.contains('mls-p1-dock-ready') }));
      ok(/navigation bar could not load/i.test(result.alert), 'failed dock load was not surfaced honestly');
      eq(result.rail, 'block', 'failed dock load hid the only working navigation');
      eq(result.padding, '236px', 'failed dock load cleared the old navigation gutter');
      eq(result.ready, false, 'failed dock load retained the ready marker');
      await opened.context.close();
    }

    /* Exact revert removes only P1 presentation and never rewrites preferences. */
    {
      const opened = await open(browser, base, { side: 'right', pin: 0 });
      await ready(opened.page);
      const result = await opened.page.evaluate(() => {
        const old=window.__mlsP1CalmDock,before={side:localStorage.getItem('account-a:qolDockSide'),pin:localStorage.getItem('account-a:p1DockPinnedV1')};
        const value=old.revert(),staleEnsure=old.ensure(),staleRevert=old.revert();
        return {value,staleEnsure,staleRevert,before,after:{side:localStorage.getItem('account-a:qolDockSide'),pin:localStorage.getItem('account-a:p1DockPinnedV1')},
          controller:!!window.__mlsP1CalmDock,guardStyle:!!document.getElementById('mlsP1CalmDockGuardCss'),handle:!!document.getElementById('mlsP1DockHandle'),
          collapsed:document.body.classList.contains('mls-p1-dock-collapsed'),ready:document.body.classList.contains('mls-p1-dock-ready'),dock:!!document.getElementById('mlsDock')};
      });
      eq(result.value, true, 'exact dock guard did not revert');
      eq(result.staleEnsure, false, 'stale dock guard ensure re-entered');
      eq(result.staleRevert, false, 'stale dock guard reverted twice');
      eq(result.controller, false, 'revert left the controller global');
      eq(result.guardStyle, false, 'revert left its stylesheet');
      eq(result.handle, false, 'revert left the compact handle');
      eq(result.collapsed, false, 'revert left compact body state');
      eq(result.ready, false, 'revert left ready body state');
      eq(result.dock, false, 'revert left the canonical dock active');
      assert.deepStrictEqual(result.after, result.before, 'revert mutated saved side/pin'); checks++;
      await opened.context.close();
    }
  } catch (error) { failure = error; }
  await browser.close();
  await new Promise(resolve => server.close(resolve));
  if (failure) throw failure;
  console.log('PASS P1 Calm dock owner runtime: ' + checks + ' assertions');
})().catch(error => { console.error(error && error.stack || error); process.exit(1); });
