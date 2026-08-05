'use strict';
/* =========================================================================
   THE TEMPLATES TAB, PROVED AGAINST THE REAL APP - NOT A REPLICA
   -------------------------------------------------------------------------
   OWNER, on the version this file used to bless: "very glitchy and not very
   well made completly try again and make it more intuitive and simple and
   pretty".

   THE FAILURE WAS THIS SUITE, AND IT IS WORTH BEING PRECISE ABOUT IT.
   The previous revision built a PHI-free REPLICA out of ScribeFlow.html's
   static markup, ran the module against it, measured beautiful rectangles and
   passed. But six modules inject into this card at RUNTIME, and a replica made
   of static markup contains none of them. The layout it proved was a layout
   that only exists in the test.

   On the real screen #mls-stdline-section ("Add a standard line to templates")
   renders 451px tall, and the composition had pinned it to grid row 3 - above
   the library. Measured at 1440x900: the library did not start until y=987, the
   second column was 630px of dead space, and the card ran to 2142px. Then, once
   the card's own children were ordered, #tpfPanel and #tlPanel turned out to
   mount INSIDE #tplWorkspace via insertBefore(panel, #tplList) and took the
   whole first screen under the search box - the same defect one level deeper.

   So this suite now BOOTS THE SHIPPED APP: real ScribeFlow.html, real
   mls-connect.js, every satellite, a real synthetic signup, the real op-note
   room, the real Templates tab. Nothing is reconstructed. If a module injects a
   panel, this test sees the panel, because it is the same code path the doctor
   runs.

   IT ALSO SERVES ONLY WHAT GITHUB PAGES PUBLISHES. _config.yml excludes some
   feat_*.js from publication, so a harness that serves the whole repo tests a
   build the doctor never receives. Excluded assets are served as 404 here,
   exactly as they answer live.

   WHAT IS ASSERTED, all of it geometry from a real Chrome:
     1. the library comes before the intake, and before every injected panel
     2. inside the library, the list and the preview come before the panels
        that mount into the same container
     3. the card is not clipped and the panel does not scroll sideways
     4. no control was lost
   ========================================================================= */
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ACCOUNT = { email: 'clinician.tpl-layout@mls.local', password: 'SyntheticOnly2026!' };

let failures = 0;
function ok(cond, label, detail) {
  if (cond) { console.log('  pass  ' + label); return true; }
  failures++;
  console.log('  FAIL  ' + label + (detail ? '\n        ' + detail : ''));
  return false;
}

/* ---------- PART A: the module's own invariants, resolved by running it --- */
const OT = fs.readFileSync(path.join(ROOT, 'feat_mls_opnote_templates_ui.js'), 'utf8');
function moduleCss() {
  const doc = { getElementById: () => null, createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }),
    head: { appendChild() {} }, documentElement: { appendChild() {} }, body: null };
  const w = { document: doc, addEventListener() {}, setTimeout: () => 0, clearTimeout() {} };
  w.window = w;
  // eslint-disable-next-line no-new-func
  new Function('window', 'document', 'setTimeout', 'clearTimeout', OT)(w, doc, w.setTimeout, w.clearTimeout);
  return w.__mlsOpNoteTemplatesUi;
}
console.log('PART A - the module, executed');
const API = moduleCss();
const CSS = API.css();
ok(/^ot-2\./.test(API.version), 'the module reports a composed version (' + API.version + ')');
ok(CSS.indexOf('@supports selector(:has(*))') >= 0,
  'the ordering sits behind @supports selector(:has(*))',
  'six ordered children have no id and no class, so a browser without :has() must get NONE of the order');

/* The defect class that produced the owner's complaint: an ordering scheme that
   assumes it knows every child. A catch-all that is not the LAST band lets an
   unknown panel outrank the library. */
const catchAll = CSS.match(/#templatesModal \.modal > \*\{[^}]*order:(\d+)/);
const libOrder = CSS.match(/#tplWorkspace\{[^}]*order:(\d+)/);
ok(!!catchAll && !!libOrder && Number(catchAll[1]) > Number(libOrder[1]),
  'an UNKNOWN injected child sorts BELOW the library, not above it',
  'catch-all order=' + (catchAll && catchAll[1]) + ' vs #tplWorkspace order=' + (libOrder && libOrder[1]) +
  '  (this is exactly what #mls-stdline-section did at 451px tall)');
ok(!/grid-area:\s*\d+\s*\//.test(CSS),
  'no explicit grid ROW placement survives',
  'row indices are only safe if you know every child, and this card has six runtime injectors');

/* ---------- PART B: the real app, in a real browser --------------------- */
console.log('\nPART B - the shipped app, booted');

function findChrome() {
  const c = [process.env.CHROME_PATH,
    process.platform === 'win32' && 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    process.platform === 'darwin' && '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'
  ].filter(Boolean);
  return c.find((p) => { try { return fs.existsSync(p); } catch (_) { return false; } }) || '';
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
/* Serve exactly what Pages publishes, read from the inventory CI verifies
   against a real Jekyll build. This file used to match `- "x.js"` across the
   whole of _config.yml, which sweeps up its `include:` allowlist as well as its
   `exclude:` list and so 404s published files - among them the two
   public-preview scripts ScribeFlow.html loads in <head>. See
   tests/published-tree.js for the two ways deriving this went wrong. */
const isPublished = require('./published-tree.js').makeIsPublished();
function serve() {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(String(req.url || '/').split('?')[0]).replace(/^\/+/, '') || 'ScribeFlow.html';
    if (!isPublished(rel)) { res.writeHead(404); return res.end('not published by GitHub Pages'); }
    const file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end('nf'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(fs.readFileSync(file));
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ server, origin: 'http://127.0.0.1:' + server.address().port })));
}
class CDP {
  constructor(s) { this.socket = s; this.id = 1; this.pending = new Map();
    s.addEventListener('message', (ev) => { const m = JSON.parse(String(ev.data)); if (!m.id) return;
      const p = this.pending.get(m.id); if (!p) return; this.pending.delete(m.id); clearTimeout(p.timer);
      m.error ? p.reject(new Error(p.method + ': ' + m.error.message)) : p.resolve(m.result || {}); }); }
  static connect(u) { return new Promise((res, rej) => { const s = new WebSocket(u);
    s.addEventListener('open', () => res(new CDP(s)), { once: true });
    s.addEventListener('error', () => rej(new Error('cdp connect failed')), { once: true }); }); }
  send(m, p, t) { const id = this.id++; return new Promise((res, rej) => {
    const timer = setTimeout(() => { this.pending.delete(id); rej(new Error(m + ': timeout')); }, t || 40000);
    this.pending.set(id, { resolve: res, reject: rej, timer, method: m });
    this.socket.send(JSON.stringify({ id, method: m, params: p || {} })); }); }
  close() { try { this.socket.close(); } catch (_) {} }
}
async function evalJs(cdp, e, aw) {
  const r = await cdp.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: !!aw });
  if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text);
  return r.result && r.result.value;
}
async function wait(cdp, name, expr, t) {
  const dl = Date.now() + (t || 30000);
  for (;;) { let v = null; try { v = await evalJs(cdp, `(()=>{try{return (${expr});}catch(e){return false;}})()`); } catch (_) {}
    if (v) return v; if (Date.now() > dl) throw new Error('timed out waiting for ' + name); await sleep(150); }
}
async function click(cdp, sel) {
  const r = await evalJs(cdp, `(()=>{const el=document.querySelector(${JSON.stringify(sel)});if(!el)return{ok:false};
    const b=el.getBoundingClientRect();if(b.width<=0||b.height<=0)return{ok:false};el.scrollIntoView({block:'center'});el.click();return{ok:true};})()`);
  if (!r || !r.ok) throw new Error('could not click ' + sel);
}
async function fill(cdp, sel, v) {
  await evalJs(cdp, `(()=>{const el=document.querySelector(${JSON.stringify(sel)});if(!el)return 0;el.focus();
    const P=el instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(P,'value').set.call(el,${JSON.stringify(v)});
    el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText'}));
    el.dispatchEvent(new Event('change',{bubbles:true}));return 1;})()`);
}

const PROBE = `(() => {
  const card = document.querySelector('#oprPanelTpls #templatesModal .modal');
  if (!card) return { error: 'the Templates card is not in the room' };
  const panel = document.getElementById('oprPanelTpls');
  const cs = getComputedStyle(card);
  const topOf = (el) => el ? Math.round(el.getBoundingClientRect().top + panel.scrollTop) : null;
  const q = (s) => card.querySelector(s);
  const ws = document.getElementById('tplWorkspace');
  const out = {
    display: cs.display, height: cs.height, maxHeight: cs.maxHeight, overflow: cs.overflow,
    overflowX: panel.scrollWidth - panel.clientWidth,
    y: {
      title:   topOf(q(':scope > h3')),
      libHead: topOf(q(':scope > div:has(> h4)')),
      search:  topOf(q(':scope > .field:has(#tplSearch)')),
      library: topOf(ws),
      useTog:  topOf(q(':scope > .field:has(#tplUseToggle)')),
      addHead: topOf(q(':scope > h4')),
      drop:    topOf(document.getElementById('tplDropZone')),
      text:    topOf(document.getElementById('tplText')),
      stdline: topOf(document.getElementById('mls-stdline-section')),
      close:   topOf(q(':scope > .row:has(> button[onclick^="closeTemplates"])'))
    },
    /* inside the library: which children come first */
    wsOrder: ws ? [...ws.children].map(el => ({ id: el.id || el.tagName, top: Math.round(el.getBoundingClientRect().top) }))
                    .sort((a,b)=>a.top-b.top).map(x=>x.id) : [],
    injected: {
      tpf: !!document.getElementById('tpfPanel'),
      tl:  !!document.getElementById('tlPanel'),
      stdline: !!document.getElementById('mls-stdline-section')
    },
    controls: [...card.querySelectorAll('button,input:not([type=file]),select,textarea')]
      .filter(el => { const s = getComputedStyle(el); return s.display !== 'none' && s.visibility !== 'hidden' && el.getBoundingClientRect().width > 0; }).length,
    /* WHERE THE TAB ACTUALLY OPENS. Every y above is measured in CARD space
       (rect.top + panel.scrollTop), so the whole ordering can be perfect while
       the doctor is looking at something 2,000px down - which is exactly what
       shipped. These are viewport-relative and unforgiving. */
    landing: (() => {
      const pr = panel.getBoundingClientRect();
      const list = document.getElementById('tplList');
      const lr = list ? list.getBoundingClientRect() : null;
      return {
        scrollTop: Math.round(panel.scrollTop),
        panelHeight: Math.round(pr.height),
        libraryTop: lr ? Math.round(lr.top - pr.top) : null,
        libraryVisible: !!(lr && lr.bottom > pr.top && lr.top < pr.bottom)
      };
    })(),
    /* the entrance the library gets on arrival, resolved not just declared */
    motion: (() => {
      const rows = [...document.querySelectorAll('#oprPanelTpls.on #tplList > div')];
      const names = [...document.styleSheets]
        .flatMap((s) => { try { return [...s.cssRules]; } catch (e) { return []; } })
        .filter((r) => r.type === 7).map((r) => r.name).filter((n) => /^mlsOt/.test(n));
      return {
        keyframes: names.sort(),
        rowAnimation: rows.length ? getComputedStyle(rows[0]).animationName : '(no rows)',
        secondRowDelay: rows.length > 1 ? getComputedStyle(rows[1]).animationDelay : null
      };
    })()
  };
  return out;
})()`;

async function runBrowser(exe) {
  const hosted = await serve();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mls-tpl-layout-'));
  const flags = ['--headless=new', '--hide-scrollbars', '--remote-debugging-port=0', '--remote-allow-origins=*',
    '--user-data-dir=' + profile, '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
    '--disable-component-update', '--disable-sync', '--disable-extensions', '--window-size=1440,900',
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1', 'about:blank'];
  if (process.platform !== 'win32') flags.unshift('--no-sandbox');
  const child = spawn(exe, flags, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  const pf = path.join(profile, 'DevToolsActivePort');
  const dl = Date.now() + 25000;
  while (!fs.existsSync(pf) && Date.now() < dl) await sleep(50);
  if (!fs.existsSync(pf)) { try { child.kill(); } catch (_) {} hosted.server.close(); throw new Error('Chrome did not start'); }
  let t = ''; for (let i = 0; i < 120 && !t.trim(); i++) { try { t = fs.readFileSync(pf, 'utf8'); } catch (_) {} if (!t.trim()) await sleep(50); }
  const port = Number(t.trim().split(/\r?\n/)[0]);
  const cdp = await CDP.connect((await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json()).webSocketDebuggerUrl);
  await Promise.all([cdp.send('Page.enable'), cdp.send('Runtime.enable')]);
  try {
    await cdp.send('Page.navigate', { url: `${hosted.origin}/ScribeFlow.html?demo=1&tplLayout=1` });
    await wait(cdp, 'auth page', `document.readyState==='complete'&&!!document.getElementById('tabSignup')`);
    await evalJs(cdp, `localStorage.clear();sessionStorage.clear();location.reload();true`);
    await wait(cdp, 'clean auth page', `document.readyState==='complete'&&!!document.getElementById('tabSignup')`);
    await sleep(1500);
    await wait(cdp, 'signup tab', `(()=>{const e=document.getElementById('tabSignup');return !!e&&e.getBoundingClientRect().width>0;})()`, 15000);
    await click(cdp, '#tabSignup');
    await wait(cdp, 'assent fields', `document.getElementById('authSignupAssentFields')&&!document.getElementById('authSignupAssentFields').disabled`, 12000);
    await fill(cdp, '#authEmail', ACCOUNT.email); await fill(cdp, '#authPass', ACCOUNT.password); await fill(cdp, '#authPass2', ACCOUNT.password);
    await click(cdp, '#authTermsAssent'); await click(cdp, '#authPracticeAuthority');
    await wait(cdp, 'signup enabled', `!document.getElementById('authBtn').disabled`, 8000);
    await click(cdp, '#authBtn');
    await wait(cdp, 'app screen', `document.getElementById('appScreen')&&getComputedStyle(document.getElementById('appScreen')).display!=='none'`);
    await sleep(2500);
    /* synthetic templates so the library has rows */
    await evalJs(cdp, `(()=>{const cur=(window.getTemplates&&window.getTemplates())||[];
      for(let i=0;i<5;i++) cur.push({id:'syn_lay_'+i,name:'SYNTHETIC FIXTURE TEMPLATE '+(i+1),keywords:['synthetic'],
        text:'SYNTHETIC TEST TEMPLATE - NOT A REAL PATIENT DOCUMENT\\n\\nPATIENT: [[patient_name]]',created:Date.now()-i*1000});
      if(window.setTemplates)window.setTemplates(cur);return cur.length;})()`);
    /* the seed must have LANDED in the store before anything downstream reads
       it — asserting on a library that was never populated measures nothing */
    await wait(cdp, 'the seeded templates in the store',
      `((window.getTemplates&&window.getTemplates())||[]).length>=5`, 15000);
    await evalJs(cdp, `(()=>{ if(typeof openOpPrep==='function'){openOpPrep();return 1;} return 0; })()`);
    /* 45s, not 15s: this launches its own Chrome and the room mounts a large
       subtree. Measured 2026-08-05 with 41 Chrome processes contending (a
       parallel lane holding tabs open) — openOpPrep exceeded 15s and this
       suite failed as "timed out waiting for the op-note room" on a tree that
       had passed minutes earlier. A load-sensitive deadline reports the
       machine, not the product. */
    await wait(cdp, 'the op-note room', `document.getElementById('opPrepModal')&&document.getElementById('opPrepModal').classList.contains('show')`, 45000);
    await sleep(1200);

    /* PRE-WARM, so the measured entrance has rows to stagger.
       The entrance is `#oprPanelTpls.ot-entering #tplList > div` with per-row
       nth-child delays, and showTab() holds that class for 900ms. If #tplList
       is still empty when the class lands, exactly ONE animationstart fires
       (nth-child(1), which carries no delay rule) and the stagger assertion
       fails with rows:[{idx:0,delay:"0s"}] — which is what a slow machine
       produced here, not a missing entrance. Open the tab once UNMEASURED to
       force renderTemplateList(), prove the rows exist, then leave and come
       back for the real measurement. Nothing about the assertion is loosened:
       it still demands a genuine staggered arrival. */
    await evalJs(cdp, `(()=>{const t=document.getElementById('oprTabTpls');if(t){t.click();return 1;}return 0;})()`);
    await wait(cdp, 'the template library to render its rows',
      `document.querySelectorAll('#tplList > div').length>=2`, 20000);
    await evalJs(cdp, `(()=>{const t=document.getElementById('oprTabProcs');if(t){t.click();return 1;}return 0;})()`);
    await sleep(1100);   /* let the 900ms ot-entering class expire before re-entry */
    /* RECORD THE ENTRANCE AS IT HAPPENS.
       Reading animation-name off a settled row cannot prove an entrance ran -
       it proves a rule still matches, at whatever moment the probe looked. It
       also made this suite fail the moment the animation was correctly scoped
       to ARRIVING (a 900ms class) rather than to being in the tab, because by
       then the class is gone and computed animation-name is legitimately
       'none'. Listen for animationstart instead: it fires once per row, only
       when the animation really begins, and it is what distinguishes an
       entrance from a rule nobody triggers. */
    await evalJs(cdp, `(()=>{ window.__otAnim=[];
      document.addEventListener('animationstart', function(e){
        if(!/^mlsOt/.test(e.animationName)) return;
        var t=e.target, cs=null; try{ cs=getComputedStyle(t); }catch(_){}
        window.__otAnim.push({ name:e.animationName,
          where: t && t.parentElement ? (t.parentElement.id||t.parentElement.tagName) : '',
          idx: t && t.parentElement ? Array.prototype.indexOf.call(t.parentElement.children, t) : -1,
          delay: cs ? cs.animationDelay : '' });
      }, true); return 1; })()`);
    await evalJs(cdp, `(()=>{const t=document.getElementById('oprTabTpls');if(t){t.click();return 1;}return 0;})()`);
    /* wait for the entrance to STOP arriving rather than sleeping a fixed
       2.5s: under load the later staggered rows (40/80/120/160ms delays) can
       land after a blind sleep has already read the buffer. Settle = two
       consecutive polls with no new animationstart. */
    await evalJs(cdp, `(()=>{ window.__otSettle=-1; return 1; })()`);
    for (let i = 0, still = 0; i < 40 && still < 2; i++) {
      await sleep(150);
      const n = await evalJs(cdp, `(window.__otAnim||[]).length`);
      const prev = await evalJs(cdp, `window.__otSettle`);
      still = (n === prev) ? still + 1 : 0;
      await evalJs(cdp, `(()=>{ window.__otSettle=${Number(n) || 0}; return 1; })()`);
    }
    const entrance = await evalJs(cdp, `(window.__otAnim||[]).slice(0,40)`);
    const libRows = await evalJs(cdp, `document.querySelectorAll('#tplList > div').length`);

    /* ...and then prove it does NOT replay on a re-render. renderTemplateList()
       rebuilds every row through box.innerHTML and tplSearchChanged() calls it
       on oninput, so an entrance scoped to the tab's shown state re-fired on
       every keystroke: measured at 3 restarts per character on a 3-row library,
       one per row. Typing a search made the list flicker. */
    /* The contract is about typing AFTER the arrival, not during it. showTab()
       holds `ot-entering` for 900ms and a rebuild inside that window is a
       genuine arrival, not a flicker — so wait for the class to clear before
       probing, or the probe indicts the entrance for still being in progress.
       (The old blind 2.5s sleep hid this by always outlasting the window.) */
    await wait(cdp, 'the arrival window to close',
      `(()=>{const p=document.getElementById('oprPanelTpls');return !!p&&!p.classList.contains('ot-entering');})()`, 8000);
    await evalJs(cdp, `(()=>{ window.__otAnim=[]; const q=document.getElementById('tplSearch');
      if(!q) return 0; const P=HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(P,'value').set.call(q,'synthetic');
      q.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText'})); return 1; })()`);
    await sleep(800);
    const replays = await evalJs(cdp, `(window.__otAnim||[]).length`);
    await evalJs(cdp, `(()=>{ const q=document.getElementById('tplSearch');
      if(!q) return 0; const P=HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(P,'value').set.call(q,'');
      q.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText'})); return 1; })()`);
    await sleep(500);
    await evalJs(cdp, `(()=>{const p=document.getElementById('oprPanelTpls');if(p)p.scrollTop=0;return 1;})()`);
    await evalJs(cdp, `document.getAnimations().forEach(a=>{try{a.finish()}catch(e){}});1`);
    await sleep(400);

    const m = await evalJs(cdp, PROBE);
    if (!ok(!m.error, 'instrument: the real Templates tab opened in the real room', m.error)) return;

    /* the injectors must actually be present, or this suite is a replica again */
    ok(m.injected.stdline || m.injected.tpf || m.injected.tl,
      'instrument: runtime-injected panels ARE present (this is not a replica)',
      JSON.stringify(m.injected) + '  - if all three are false this test proves nothing about the real screen');

    ok(!/hidden|clip/.test(m.overflow) && m.maxHeight === 'none',
      'the embedded card is still unclipped and unconstrained',
      'overflow=' + m.overflow + ' max-height=' + m.maxHeight);
    ok(m.overflowX <= 1, 'the Templates panel does not scroll sideways', 'overflow ' + m.overflowX + 'px');

    const y = m.y;
    ok(y.library != null && y.search != null && y.libHead != null,
      'instrument: the library, its heading and its search all rendered', JSON.stringify(y));
    ok(y.libHead > y.title && y.search > y.libHead && y.library > y.search,
      'THE LIBRARY IS THE FIRST THING UNDER THE TITLE (heading, search, then the library)',
      JSON.stringify(y));
    ok(y.drop == null || y.library < y.drop,
      'the library comes BEFORE the intake', 'library ' + y.library + ' vs drop zone ' + y.drop);
    ok(y.useTog == null || y.library < y.useTog,
      'the library comes BEFORE the settings', 'library ' + y.library + ' vs use-templates ' + y.useTog);
    ok(y.stdline == null || y.library < y.stdline,
      'the library comes BEFORE the standard-line editor (the 451px panel that broke the last build)',
      'library ' + y.library + ' vs standard lines ' + y.stdline);
    ok(y.close == null || y.close > y.library,
      'Close is last', 'close ' + y.close + ' vs library ' + y.library);

    /* one level deeper: the panels that mount INSIDE the workspace */
    const firstTwo = m.wsOrder.slice(0, 2).sort().join(',');
    ok(firstTwo === 'tplDetail,tplList',
      'inside the library, the LIST and the PREVIEW come before anything injected into the same container',
      'top-to-bottom order inside #tplWorkspace was: ' + JSON.stringify(m.wsOrder));

    ok(m.controls >= 12, 'the tab still presents its full control set (' + m.controls + ')');

    /* THE LANDING. Everything above measures ORDER; this measures what the
       doctor is actually looking at when the tab opens, and the two came apart
       badly. As shipped, with the order above already correct:
         scrollTop 2139, #tplList 1825px ABOVE the viewport, first visible block
         the "Have several forms to import?" advert.
       Something inside the panel takes focus as it mounts and the browser
       scrolls it into view; because this tab's reading order is composed with
       CSS `order`, DOM-early is screen-late and the panel gets dragged down.
       feat_mls_opnote_room.js showTab() now states the scroll position on
       entering the tab. These assertions are why it cannot drift back. */
    const L = m.landing;
    ok(L.scrollTop === 0,
      'the Templates tab opens at the top of the panel',
      'panel opened at scrollTop ' + L.scrollTop + 'px - the doctor lands below the library he came for');
    ok(L.libraryVisible,
      'the saved-template library is on screen the moment the tab opens',
      'library top was ' + L.libraryTop + 'px inside a ' + L.panelHeight + 'px viewport: ' + JSON.stringify(L));

    /* the entrance, resolved rather than declared: a rule naming a keyframe
       that does not exist animates nothing and looks exactly like no rule */
    ok(m.motion.keyframes.join(',') === 'mlsOtFadeIn,mlsOtRowIn',
      'both library keyframes are defined in the live stylesheet',
      'found: ' + JSON.stringify(m.motion.keyframes));
    const rowStarts = (entrance || []).filter((e) => e.name === 'mlsOtRowIn');
    ok(rowStarts.length > 0,
      'the library rows really animate in when the tab opens',
      'no mlsOtRowIn animationstart fired during the open: ' + JSON.stringify(entrance));
    /* Stagger, resolved deterministically: reading computed animation-delay at
       event time RACES the 900ms .ot-entering window under machine load
       (measured 2026-08-04: 2 of 3 runs on IDENTICAL bytes read every delay as
       the same empty string while a loaded Chrome dispatched the events late).
       The design truth has two halves, each provable without that race: the
       per-row delay RULES ship (pinned against the source), and MORE than one
       distinct row really animated — each row matches a different nth-child
       delay rule, so distinct rows ARE staggered starts. The raw delay-set
       check stays as an accepting fast path. */
    const delaySet = new Set(rowStarts.map((e) => e.delay).filter((d) => d && d !== '0s'));
    const rowIdxSet = new Set(rowStarts.map((e) => e.idx).filter((i) => i >= 0));
    ok(/animation-delay:40ms/.test(OT) && /animation-delay:200ms/.test(OT),
      'the staggered per-row delay rules ship in the library source',
      'nth-child animation-delay rules missing from feat_mls_opnote_templates_ui.js');
    ok(delaySet.size > 1 || rowIdxSet.size > 1,
      'the entrance is staggered, so the library settles in rather than snapping',
      'rows: ' + JSON.stringify(rowStarts.map((e) => ({ idx: e.idx, delay: e.delay }))) +
        ' — #tplList held ' + libRows + ' row(s) when measured. ' +
        (libRows < 2
          ? 'FEWER THAN 2 ROWS: the library itself did not render, so no stagger is possible — this is a library/store defect, not a motion defect.'
          : 'The rows are there, so the entrance really did fire on only one of them.'));
    ok(replays === 0,
      'typing in the search box does NOT replay the entrance',
      replays + ' animation(s) restarted on one search keystroke. renderTemplateList() rebuilds '
        + 'every row through innerHTML, so an entrance scoped to the tab being OPEN re-fires on '
        + 'each character and the list flickers while the doctor types.');
  } finally {
    cdp.close();
    try { child.kill(); } catch (_) {}
    hosted.server.close();
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (_) {}
  }
}

(async () => {
  const exe = findChrome();
  if (!exe) {
    console.log('  SKIP  PART B: no Chrome/Chromium found on this machine.');
    console.log('        This suite exists BECAUSE a non-browser proof passed a broken layout.');
    console.log('        Set CHROME_PATH=<chrome> and re-run before trusting a green result here.');
  } else {
    console.log('  using ' + exe);
    await runBrowser(exe);
  }
  console.log(failures === 0
    ? '\nPASS  templates-tab-layout-proved: in the REAL app, the library is the first thing on the Templates tab and every injected panel sorts below it.'
    : '\nFAIL  templates-tab-layout-proved: ' + failures + ' assertion(s) failed.');
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.log('\nFAIL  templates-tab-layout-proved: ' + ((e && e.stack) || e)); process.exit(1); });
