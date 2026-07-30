'use strict';
/* =========================================================================
   THE TEMPLATES TAB IS A COMPOSITION, NOT A STACK — PROVED BY EXECUTION
   -------------------------------------------------------------------------
   OWNER: "make a completely working new UI the templates tab only of op notes
   as I love the other tabs but just hate the templates UI."

   Three previous passes at this screen (b795, b799, ot-1.0.0) were paint. Each
   fixed something real and each left the owner saying the same sentence, because
   the complaint was never the paint — it was that the screen is a stack of
   twenty blocks with the doctor's own template library dead last, behind a
   checkbox, a select, a bulk-import advert, two text fields, two buttons, a drop
   zone and a textarea.

   ot-2.0.0 answers that by PLACING the children instead of repainting them: the
   library first and, from 1100px up, in its own column with setup and intake
   beside it. No node is created, moved, renamed or removed — the 102 structural
   grips in this subtree forbid it and
   tests/opnote-templates-grips-survive-redesign.test.js is the fence for that.

   WHY THIS SUITE EXISTS SEPARATELY FROM THE FENCE. The fence proves the redesign
   did not COST anything. It cannot prove the redesign DID anything: every rule
   here could be dead — beaten by an inline style, dropped for an unsupported
   selector, or scoped to an element that is not on the screen — and the fence
   would still be green. That is not hypothetical on this exact surface. b795
   shipped nine rules that lost to inline styles and rendered byte-identical to
   b794. So every claim below is a RESOLVED VALUE or a MEASURED RECTANGLE from a
   real Chrome, never the presence of a string.

   PART A  the invariants that make the composition safe, read off this file.
   PART B  the composition itself, measured at 1440x900 and 390x844.

   PART B needs a browser. When there is no Chrome on the machine it is SKIPPED
   AND SAYS SO LOUDLY, because a silent skip is how a Chrome-only assertion in
   this very repo went on passing while it was failing (opnote-room-does-not-trap
   fails four assertions the moment a Chrome is actually present).
   ========================================================================= */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'ScribeFlow.html'), 'utf8');
const OT = fs.readFileSync(path.join(ROOT, 'feat_mls_opnote_templates_ui.js'), 'utf8');

let failures = 0;
function ok(cond, label, detail) {
  if (cond) { console.log('  pass  ' + label); return true; }
  failures++;
  console.log('  FAIL  ' + label + (detail ? '\n        ' + detail : ''));
  return false;
}
function head(t) { console.log('\n' + t); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- the module's own stylesheet, built by running it -------------
   Not read as text: EXECUTED, so what is asserted is the string the browser
   would actually receive. */
function moduleCss() {
  const doc = {
    getElementById: () => null,
    createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }),
    head: { appendChild() {} }, documentElement: { appendChild() {} }, body: null
  };
  const w = { document: doc, addEventListener() {}, setTimeout: () => 0, clearTimeout() {} };
  w.window = w;
  // eslint-disable-next-line no-new-func
  new Function('window', 'document', 'setTimeout', 'clearTimeout', OT)(w, doc, w.setTimeout, w.clearTimeout);
  if (!w.__mlsOpNoteTemplatesUi || typeof w.__mlsOpNoteTemplatesUi.css !== 'function') {
    throw new Error('the op-note/templates UI module did not install a css() builder');
  }
  return { css: w.__mlsOpNoteTemplatesUi.css(), version: w.__mlsOpNoteTemplatesUi.version };
}

head('PART A - the invariants, resolved from the module itself');

const M = moduleCss();
const CSS = M.css;
ok(/^ot-2\./.test(M.version),
  'the module reports the composed version (' + M.version + ')',
  'PART B measures a composition; if the module is an earlier line this suite is testing something else');

/* A1 - the composition exists, and is gated so a browser without :has() gets
   the old single stack rather than half a layout. */
const supportsBlocks = CSS.match(/@supports selector\(:has\(\*\)\)\{/g) || [];
ok(supportsBlocks.length >= 2,
  'every placement rule sits behind @supports selector(:has(*))',
  'found ' + supportsBlocks.length + ' gate(s); six of the placed children have no id and no class,'
  + ' so a browser without :has() must get NONE of the composition, not some of it');

/* Non-vacuity: the gate must actually contain the placements. A gate around an
   empty block would pass the count above and prove nothing. */
function blockAfter(text, marker) {
  const at = text.indexOf(marker);
  if (at < 0) return '';
  let depth = 0, i = at + marker.length - 1;
  for (; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') { depth--; if (depth === 0) break; }
  }
  return text.slice(at, i + 1);
}
const gated = blockAfter(CSS, '@supports selector(:has(*)){')
  + blockAfter(CSS, '@media (min-width:1100px){');
/* Shape, not literal row numbers - those are free to move as the sidebar grows.
   What must hold is that the library is placed in COLUMN 1 and SPANS the
   sidebar's rows, because that span is what makes it a column instead of a
   block sitting above the intake. */
const wsPlace = (gated.match(/#tplWorkspace\{[^}]*grid-area:\s*(\d+)\s*\/\s*(\d+)\s*\/\s*(\d+)\s*\/\s*(\d+)/) || []);
ok(wsPlace.length === 5 && wsPlace[2] === '1' && wsPlace[4] === '2' && (+wsPlace[3] - +wsPlace[1]) >= 6,
  'the library workspace is PLACED inside the gate (column 1, spanning the sidebar)',
  'read grid-area as ' + (wsPlace.slice(1).join(' / ') || '(absent)') +
  ' - the gate must contain the placement, not merely exist');
ok(/order:8/.test(gated) && /order:2[0-9]/.test(gated),
  'the one-column order hoists the library above the intake inside the gate');

/* A2 - THE CLIPPING DEFECT CANNOT RETURN WITH display:grid.
   tests/templates-panel-scrolls.test.js fails a flex/grid display on this card
   because the owner reported "STILL CANT SCROLL DOWN IN TEMPLATES" twice. That
   suite reads ScribeFlow.html's <style> blocks only and therefore cannot see
   this module. What clipped was the HEIGHT CONSTRAINT, not the formatting
   context, so the invariant is restated here against the file that now sets
   display:grid - the guarantee moves with the change instead of being dodged. */
const cardRules = (CSS.match(/[^{}\n]*#oprPanelTpls[^{}\n]*\.modal\s*\{[^}]*\}/g) || []);
ok(cardRules.length > 0,
  'the embedded card rules are locatable for inspection (' + cardRules.length + ')');
const clipping = cardRules.filter(r => {
  const decls = r.slice(r.indexOf('{') + 1);
  return /(^|;)\s*height\s*:\s*(?!auto)/.test(decls)
      || /(^|;)\s*max-height\s*:\s*(?!none)/.test(decls)
      || /(^|;)\s*overflow(-y)?\s*:\s*(hidden|clip|auto|scroll)/.test(decls);
});
ok(clipping.length === 0,
  'no rule in this module height-constrains or clips the embedded Templates card',
  'a height constraint plus a formatting context is the exact defect the owner hit twice:\n        '
  + clipping.join('\n        '));

/* A3 - SCOPE. The owner said "the templates tab ONLY". Every placement rule
   must be under #oprPanelTpls, so neither the floating Templates dialog nor the
   Procedures tab he likes can be reached by any of it. */
function rulesOf(text) {
  const out = [];
  text.replace(/([^{}]+)\{([^{}]*)\}/g, function (_, sel, decls) { out.push({ sel: sel.trim(), decls: decls }); return ''; });
  return out;
}
const placement = rulesOf(gated).filter(r => /(grid-area|grid-column|grid-template-columns|order\s*:|display\s*:\s*grid)/.test(r.decls));
ok(placement.length >= 18,
  'the composition is made of ' + placement.length + ' placement rules (enough to be a layout)');
const unscoped = placement.filter(r => r.sel.split(',').some(s => s.indexOf('#oprPanelTpls') < 0));
ok(unscoped.length === 0,
  'EVERY placement rule is scoped to #oprPanelTpls - the op-note Templates TAB only',
  'these could reach the floating dialog or another tab:\n        '
  + unscoped.map(r => r.sel).join('\n        '));
const opnoteLeak = placement.filter(r => /#oprPanelProcs|#opPrepList|#oprEditor|#oprDayRail|#oprRowNav|opPrepNote_|opPrepTpl_/.test(r.sel));
ok(opnoteLeak.length === 0,
  'no placement rule reaches the op-notes surfaces the owner said he LIKES',
  opnoteLeak.map(r => r.sel).join('\n        '));

/* A4 - still presentation-only: a composition that started building nodes would
   have walked straight into the 102 grips. */
const CODE = OT.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '));
ok(!/(innerHTML|insertAdjacentHTML|appendChild|insertBefore|replaceChild)\s*[({]/.test(
  CODE.replace(/\(document\.head \|\| document\.documentElement\)\.appendChild\(st\)/g, '')),
  'the composition still creates no markup beyond its own <style> element');

/* ========================================================================
   PART B - measured in real Chrome
   ==================================================================== */
head('PART B - the composition, measured at 1440x900 and 390x844');

function chromePath() {
  const c = [
    process.env.CHROME_PATH,
    process.platform === 'win32' && 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    process.platform === 'win32' && 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.platform === 'win32' && process.env.LOCALAPPDATA &&
      path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    process.platform === 'darwin' && '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium',
    '/usr/bin/chromium-browser'
  ].filter(Boolean);
  return c.find(p => { try { return fs.existsSync(p); } catch (_) { return false; } }) || '';
}

/* ---------- the replica: real markup, real stylesheets, real module ------ */
function balancedDiv(html, startMarker) {
  const start = html.indexOf(startMarker);
  if (start < 0) return '';
  let depth = 0, end = start;
  const re = /<\/?div\b[^>]*>/g; re.lastIndex = start;
  let m;
  while ((m = re.exec(html))) {
    if (m[0].charAt(1) === '/') { depth--; if (depth === 0) { end = m.index + m[0].length; break; } }
    else if (!/\/>$/.test(m[0])) depth++;
  }
  return html.slice(start, end);
}

/* Rows shaped exactly the way renderTemplateList writes them (ScribeFlow.html
   :16238) - same inline styles, same role/aria, same nesting - because those
   inline styles are what previous passes lost to. Obviously synthetic. */
function tplRows(n) {
  let out = '';
  for (let i = 0; i < n; i++) {
    out += '<div role="option" aria-selected="' + (i === 1 ? 'true' : 'false') + '" tabindex="0"' +
      ' style="border:1px solid ' + (i === 1 ? '#2E6A4B' : 'var(--line)') + ';border-radius:10px;padding:8px 10px;' +
      'margin-bottom:6px;background:' + (i === 1 ? '#f2f8f4' : 'transparent') + ';cursor:pointer">' +
      '<div style="display:flex;align-items:center;gap:6px">' +
      '<strong style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
      'SYNTHETIC FIXTURE TEMPLATE ' + (i + 1) + ' - not a patient document</strong>' +
      (i === 0 ? '<span style="font-size:10px;color:#127a55;font-weight:700;white-space:nowrap">\u25CF DEFAULT</span>' : '') +
      '</div><div style="font-size:11.5px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">synthetic, fixture, no phi</div>' +
      '<div style="font-size:11px;color:var(--muted)">1234 chars</div></div>';
  }
  return out;
}
const DETAIL_HTML =
  '<div class="field" style="margin:0 0 8px"><label for="tplDetName">Name</label>' +
  '<input type="text" id="tplDetName" value="SYNTHETIC FIXTURE TEMPLATE 2"></div>' +
  '<div class="field" style="margin:0 0 8px"><label for="tplDetKw">Keywords</label>' +
  '<input type="text" id="tplDetKw" value="synthetic, fixture"></div>' +
  '<textarea id="tplDetText" aria-label="Template content" style="min-height:220px;width:100%;' +
  'font:12.5px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace">SYNTHETIC FIXTURE TEXT - no patient data.</textarea>' +
  '<div id="tplDetStatus" role="status" style="font-size:12px;color:var(--muted);margin:6px 0">No unsaved changes</div>' +
  '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
  '<button class="btn-green" style="font-size:12.5px;padding:7px 12px">\uD83D\uDCBE Save changes</button>' +
  '<button class="btn-ghost" style="font-size:12.5px;padding:7px 12px">\u26A1 Use on current note</button>' +
  '<button class="btn-ghost" style="font-size:12.5px;padding:7px 12px">Set default</button>' +
  '<button class="btn-ghost" style="font-size:12.5px;padding:7px 12px">\u29C9 Duplicate</button>' +
  '<button class="btn-ghost" style="font-size:12.5px;padding:7px 12px;color:#a12c2c">\uD83D\uDDD1 Delete\u2026</button>' +
  '</div>';

function buildPage() {
  const styles = [];
  HTML.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, function (_, b) { styles.push('<style>' + b + '</style>'); return ''; });
  let room = balancedDiv(HTML, '<div class="modal-bg opr-room" id="opPrepModal"');
  let tpl = balancedDiv(HTML, '<div class="modal-bg" id="templatesModal"');
  tpl = tpl.replace('<div id="tplList" role="listbox" aria-label="Saved templates" style="max-height:420px;overflow-y:auto"></div>',
    '<div id="tplList" role="listbox" aria-label="Saved templates" style="max-height:420px;overflow-y:auto">' + tplRows(9) + '</div>');
  tpl = tpl.replace(/(<div id="tplDetail"[^>]*>)[\s\S]*?(<\/div>\s*<\/div>)/, '$1' + DETAIL_HTML + '$2');
  room = room.replace('<section id="oprPanelTpls"></section>', '<section id="oprPanelTpls">' + tpl + '</section>');
  if (room.indexOf('id="oprPanelTpls"') < 0) throw new Error('replica: the room markup has no #oprPanelTpls to fill');
  if (room.indexOf('id="tplWorkspace"') < 0) throw new Error('replica: the Templates card did not land inside the room');
  return [
    '<!doctype html><html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<title>Templates tab replica (PHI-free, synthetic fixtures only)</title>',
    styles.join('\n'), '</head><body>',
    '<div id="appWrap" style="padding:12px">synthetic app body</div>',
    room,
    '<script>' + OT + '<\/script>',
    '<script>document.getElementById("opPrepModal").classList.add("show");',
    'document.getElementById("templatesModal").classList.add("show");',
    'document.getElementById("oprPanelTpls").classList.add("on");',
    'document.getElementById("oprPanelProcs").style.display="none";',
    'if(window.__mlsOpNoteTemplatesUi) window.__mlsOpNoteTemplatesUi.install();<\/script>',
    '</body></html>'
  ].join('\n');
}

/* What the probe reads. Rectangles and resolved values only. */
const PROBE = `(() => {
  const $ = id => document.getElementById(id);
  const box = el => { if(!el) return null; const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
    return { w:+r.width.toFixed(1), h:+r.height.toFixed(1), top:+r.top.toFixed(1), bottom:+r.bottom.toFixed(1),
             left:+r.left.toFixed(1), right:+r.right.toFixed(1), display:s.display, maxH:s.maxHeight }; };
  /* The card is taller than one viewport and #oprPanelTpls owns the scrolling,
     so hit-testing a control where it happens to sit at scrollTop 0 measures the
     SCROLL POSITION, not the layout. Each control is brought into view first -
     which is also what a doctor does - and only then asked whether the point at
     its centre belongs to it. Anything still unreachable after being scrolled to
     is genuinely covered or collapsed. */
  const hit = el => { if(!el) return { hit:false, why:'absent' };
    try { el.scrollIntoView({ block:'center', inline:'nearest' }); } catch(e) {}
    const r = el.getBoundingClientRect();
    if (r.width<=0||r.height<=0) return { hit:false, why:'zero-rect' };
    const cx = Math.round(r.left+r.width/2), cy = Math.round(r.top+r.height/2);
    if (cx<0||cy<0||cx>=innerWidth||cy>=innerHeight)
      return { hit:false, why:'off-viewport even after scrolling to it' };
    const t = document.elementFromPoint(cx, cy);
    return { hit: !!(t && (t===el || el.contains(t) || t.contains(el))), topId: t ? (t.id||t.tagName) : null }; };
  const panel = $('oprPanelTpls');
  const card  = document.querySelector('#oprPanelTpls #templatesModal .modal');
  const cs    = getComputedStyle(card);
  const out = {
    viewport: { w: innerWidth, h: innerHeight },
    card: { display: cs.display, height: cs.height, maxHeight: cs.maxHeight, overflow: cs.overflow,
            cols: cs.gridTemplateColumns, w: +card.getBoundingClientRect().width.toFixed(1) },
    panel: { travel: panel.scrollHeight - panel.clientHeight, clientW: panel.clientWidth,
             scrollW: panel.scrollWidth, overflowY: getComputedStyle(panel).overflowY },
    workspace: box($('tplWorkspace')), list: box($('tplList')), detail: box($('tplDetail')),
    search: box($('tplSearch')), drop: box($('tplDropZone')), text: box($('tplText')),
    active: box($('tplActiveWrap')), stdline: box($('mls-stdline-section')),
    gradient: box(card.querySelector(':scope > div[style*="linear-gradient"]')),
    libHead: box(card.querySelector(':scope > div:has(> h4)')),
    addHead: box(card.querySelector(':scope > h4')),
    useField: box(card.querySelector(':scope > .field:has(#tplUseToggle)')),
    nameField: box(card.querySelector(':scope > .field:has(#tplName)')),
    kwField: box(card.querySelector(':scope > .field:has(#tplKeywords)')),
    tightRow: box(card.querySelector(':scope > .row.tight')),
    saveRow: box(card.querySelector(':scope > .row:has(> button[onclick^="saveTemplateFromForm"])')),
    closeRow: box(card.querySelector(':scope > .row:has(> button[onclick^="closeTemplates"])')),
    hrs: [...card.querySelectorAll(':scope > hr')].map(h => getComputedStyle(h).display)
  };
  /* every interactive control of the card must still be reachable */
  out.controls = [...card.querySelectorAll('button,input:not([type=file]),select,textarea,[role=option]')]
    .filter(el => getComputedStyle(el).display !== 'none' && el.offsetParent !== null)
    .map(el => Object.assign({ id: el.id || el.className || el.tagName,
                               text: (el.textContent||'').trim().slice(0,20) }, hit(el)));
  /* the sidebar must not be blown apart by row distribution: the vertical gap
     between consecutive intake controls */
  /* the SIDEBAR only. The master switch, the library heading and the search span
     both columns by design, so they are not part of this stack. */
  const seq = ['active','addHead','nameField','kwField','tightRow','drop','text','saveRow','gradient']
    .map(k => out[k]).filter(Boolean);
  out.sidebarGaps = seq.slice(1).map((b,i) => +(b.top - seq[i].bottom).toFixed(1));
  /* the LEFT edge. #tplActiveWrap spans these three rows from the other column;
     if it ever grows taller than all three together it starts stretching them
     and the gaps below reopen on the side the owner actually reads. */
  const lseq = ['useField','libHead','search','workspace'].map(k => out[k]).filter(Boolean);
  out.libraryGaps = lseq.slice(1).map((b,i) => +(b.top - lseq[i].bottom).toFixed(1));
  return out;
})()`;

class CDP {
  constructor(socket) {
    this.socket = socket; this.id = 1; this.pending = new Map();
    socket.addEventListener('message', ev => {
      const msg = JSON.parse(String(ev.data));
      if (!msg.id) return;
      const p = this.pending.get(msg.id); if (!p) return;
      this.pending.delete(msg.id); clearTimeout(p.timer);
      msg.error ? p.reject(new Error(p.method + ': ' + msg.error.message)) : p.resolve(msg.result || {});
    });
  }
  static connect(url) {
    return new Promise((resolve, reject) => {
      const s = new WebSocket(url);
      s.addEventListener('open', () => resolve(new CDP(s)), { once: true });
      s.addEventListener('error', () => reject(new Error('cdp connect failed')), { once: true });
    });
  }
  send(method, params) {
    const id = this.id++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(method + ': timeout')); }, 40000);
      this.pending.set(id, { resolve, reject, timer, method });
      this.socket.send(JSON.stringify({ id, method, params: params || {} }));
    });
  }
  close() { try { this.socket.close(); } catch (_) {} }
}

async function runBrowser(exe) {
  const page = buildPage();
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(page);
  });
  const origin = await new Promise(r => server.listen(0, '127.0.0.1',
    () => r('http://127.0.0.1:' + server.address().port)));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mls-tpltab-'));
  const flags = ['--headless=new', '--remote-debugging-port=0', '--remote-allow-origins=*',
    '--user-data-dir=' + profile, '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--disable-component-update', '--disable-default-apps',
    '--disable-sync', '--disable-extensions', '--window-size=1440,900',
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1', 'about:blank'];
  if (process.platform !== 'win32') flags.unshift('--no-sandbox');
  const child = spawn(exe, flags, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  let stderr = ''; child.stderr.on('data', c => { stderr += String(c); });
  const portFile = path.join(profile, 'DevToolsActivePort');
  const deadline = Date.now() + 25000;
  while (!fs.existsSync(portFile) && Date.now() < deadline) await sleep(50);
  if (!fs.existsSync(portFile)) { child.kill(); server.close(); throw new Error('Chrome did not start\n' + stderr.slice(-1500)); }
  let content = '';
  for (let i = 0; i < 120 && !content.trim(); i++) { try { content = fs.readFileSync(portFile, 'utf8'); } catch (_) {} if (!content.trim()) await sleep(50); }
  const port = Number(content.trim().split(/\r?\n/)[0]);
  const target = await (await fetch('http://127.0.0.1:' + port + '/json/new?about:blank', { method: 'PUT' })).json();
  const cdp = await CDP.connect(target.webSocketDebuggerUrl);
  await Promise.all([cdp.send('Page.enable'), cdp.send('Runtime.enable')]);
  const evalJs = async expr => {
    const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text);
    return r.result && r.result.value;
  };

  try {
    for (const vp of [{ n: '1440x900', w: 1440, h: 900 }, { n: '390x844', w: 390, h: 844 }]) {
      await cdp.send('Emulation.setDeviceMetricsOverride',
        { width: vp.w, height: vp.h, deviceScaleFactor: 1, mobile: false, screenWidth: vp.w, screenHeight: vp.h });
      await cdp.send('Page.navigate', { url: origin + '/' });
      await sleep(500);
      await evalJs('document.getAnimations().forEach(a=>a.finish()); 1');
      await sleep(120);
      const m = await evalJs(PROBE);
      const L = vp.n + ': ';

      /* --- the instrument first. If the replica did not build the screen,
         every rectangle below is meaningless. --- */
      if (!ok(!!(m.workspace && m.list && m.detail && m.drop && m.text && m.closeRow),
        L + 'instrument: the Templates tab replica rendered every element under test',
        JSON.stringify({ workspace: !!m.workspace, list: !!m.list, detail: !!m.detail,
                         drop: !!m.drop, text: !!m.text, closeRow: !!m.closeRow }))) continue;
      ok(m.list.h > 0 && m.workspace.h > 0,
        L + 'instrument: the library has real height (rows rendered)',
        'workspace ' + m.workspace.h + 'px, list ' + m.list.h + 'px');

      /* --- THE DEFECT THAT MUST NOT COME BACK --- */
      ok(/^(auto|.*px)$/.test(m.card.height) && m.card.maxHeight === 'none',
        L + 'the embedded card is still unconstrained in height (the panel owns scrolling)',
        'height=' + m.card.height + '  max-height=' + m.card.maxHeight);
      ok(!/hidden|clip/.test(m.card.overflow),
        L + 'the embedded card still does not clip', 'overflow=' + m.card.overflow);
      ok(m.panel.scrollW <= m.panel.clientW + 1,
        L + 'the Templates panel does not scroll SIDEWAYS',
        'scrollWidth ' + m.panel.scrollW + ' vs clientWidth ' + m.panel.clientW);

      /* --- THE COMPOSITION --- */
      ok(m.card.display === 'grid',
        L + 'the card is a grid (the placements have something to place into)', m.card.display);
      ok(m.hrs.length === 0 || m.hrs.every(d => d === 'none'),
        L + 'the two band-separator rules are gone', JSON.stringify(m.hrs));

      /* THE ONE THE OWNER ACTUALLY ASKED FOR: his library is not last any more.
         Measured against the intake controls that used to sit above it. */
      ok(m.workspace.top < m.text.top && m.workspace.top < m.drop.top,
        L + 'THE LIBRARY COMES BEFORE THE INTAKE (it used to be dead last)',
        'workspace top ' + m.workspace.top + ' vs drop zone ' + m.drop.top + ', text area ' + m.text.top);
      ok(m.search.top < m.workspace.top && m.libHead && m.libHead.top < m.search.top,
        L + 'the library heading and its search sit directly above the library',
        JSON.stringify({ head: m.libHead && m.libHead.top, search: m.search.top, workspace: m.workspace.top }));

      if (vp.w >= 1100) {
        /* two real columns, proved by geometry rather than by the declaration */
        ok(m.workspace.right <= m.drop.left + 1,
          L + 'TWO COLUMNS: the library sits entirely LEFT of the intake sidebar',
          'workspace right ' + m.workspace.right + ' vs drop-zone left ' + m.drop.left);
        ok(m.drop.left > m.card.w * 0.5,
          L + 'the sidebar is the narrower column, not half the card',
          'sidebar starts at ' + m.drop.left + ' of ' + m.card.w);
        ok(m.workspace.w > m.drop.w,
          L + 'the library is the wider of the two columns (it is the hero)',
          'library ' + m.workspace.w + ' vs sidebar ' + m.drop.w);
        ok(m.list.right <= m.detail.left + 1 && m.detail.w > 0,
          L + 'inside the library the list and the preview are still two panes',
          'list right ' + m.list.right + ' vs detail left ' + m.detail.left);
        /* the row-distribution hazard this layout is designed around */
        const worst = Math.max(...m.sidebarGaps);
        ok(worst < 120,
          L + 'the sidebar stays tight - the workspace span does not blow gaps into it',
          'gaps between consecutive intake controls: ' + JSON.stringify(m.sidebarGaps) +
          '  (a grid distributing a spanning item across auto rows is what this would look like)');
        const worstLeft = Math.max(...m.libraryGaps);
        ok(worstLeft < 90,
          L + 'the library column stays tight - the spanning setup card does not stretch it',
          'gaps down the left edge: ' + JSON.stringify(m.libraryGaps) +
          '  (#tplActiveWrap spans these three rows from column 2)');
        ok(m.active && m.active.left > m.card.w * 0.5 && m.active.top < m.workspace.top,
          L + 'the setup card fills the space beside the library header instead of leaving it dead',
          JSON.stringify(m.active));
        ok(m.closeRow.top >= m.workspace.bottom - 1,
          L + 'Close is under BOTH columns, not floating beside one',
          'close top ' + m.closeRow.top + ' vs workspace bottom ' + m.workspace.bottom);
      } else {
        ok(Math.abs(m.workspace.left - m.drop.left) < 24,
          L + 'ONE COLUMN on a narrow screen: the sidebar does not survive as a sliver',
          'workspace left ' + m.workspace.left + ' vs drop-zone left ' + m.drop.left);
        ok(m.drop.top > m.workspace.top,
          L + 'and the intake follows the library rather than preceding it',
          'drop top ' + m.drop.top + ' vs workspace top ' + m.workspace.top);
      }

      /* --- NO CONTROL WAS LOST OR BURIED --- */
      const dead = m.controls.filter(c => !c.hit);
      ok(m.controls.length >= 14,
        L + 'the card still presents its full control set (' + m.controls.length + ')');
      ok(dead.length === 0,
        L + 'every visible control of the Templates tab hit-tests to itself',
        dead.map(c => c.id + ' -> ' + (c.topId || c.why)).join(', '));
    }
  } finally {
    cdp.close();
    try { child.kill(); } catch (_) {}
    server.close();
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (_) {}
  }
}

(async () => {
  const exe = chromePath();
  if (!exe) {
    console.log('  SKIP  PART B: no Chrome/Chromium found on this machine.');
    console.log('        This suite\'s whole point is measurement, so a skip is a HOLE, not a pass.');
    console.log('        Set CHROME_PATH=<chrome> and re-run before trusting a green result here.');
  } else {
    console.log('  using ' + exe);
    await runBrowser(exe);
  }
  console.log(failures === 0
    ? '\nPASS  templates-tab-layout-proved: the Templates tab is a placed composition - library first, two columns wide, one column narrow, nothing clipped and no control lost.'
    : '\nFAIL  templates-tab-layout-proved: ' + failures + ' assertion(s) failed.');
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => {
  console.log('\nFAIL  templates-tab-layout-proved: ' + (e && e.stack || e));
  process.exit(1);
});
