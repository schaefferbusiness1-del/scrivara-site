'use strict';
/* =========================================================================
   THE OP-NOTE ROOM MAY NOT TRAP THE DOCTOR
   -------------------------------------------------------------------------
   OWNER, live 2026-07-30: "the op bnotes is this full thing screen thats hard
   toi get out odf nothe bottom menu button should still be there."

   b794 answered the FIRST report of this by adding exits inside the room - a
   real "‹ Back" button and a 44px ✕ where there had been a 14x23px glyph. This
   report says that was the wrong shape of answer. He is not asking for a third
   door out of one room; he is asking for the app's own navigation to still be
   there while the room is open.

   THE MECHANISM, MEASURED, not guessed. In a PHI-free replica built from
   ScribeFlow.html's own <style> blocks + feat_mls_calm_shell.js's own CSS string
   table + feat_mls_opnote_templates_ui.js EXECUTED (the same construction this
   suite runs below), with the room open and BEFORE the fix:

       1440x900  #mlsDock  position:fixed  z-index:920  display:flex
                           visibility:visible  opacity:1  rect 356.3,791 712.5x91
                 document.elementFromPoint(713,837) -> textarea#opPrepNote_2
                 7 of 7 dock buttons hit-test FALSE
       390x844   #mlsDock  rect 8,757 359x79
                 document.elementFromPoint(188,797) -> textarea#opPrepNote_1
                 7 of 7 dock buttons hit-test FALSE

   NOTHING HID THE DOCK. It was display:flex, opacity 1, fully on screen, with a
   non-zero rect - it passes every "is it visible" check this repo has ever
   written. `.modal-bg{position:fixed;inset:0;z-index:9400}` plus the room's own
   opaque `width:100vw;height:100dvh` card paint an unbroken sheet over it in the
   SAME root stacking context, and 9400 beats 920 at every pixel. VISIBLE AND
   CLICKABLE ARE DIFFERENT THINGS, and this repo has shipped that confusion
   before - which is why every assertion below that says "reachable" is an
   elementFromPoint hit test at the control's centre, never a rect.

   AFTER the fix, same replica, same construction:

       1440x900  dock z-index 9401, hit TRUE, 7 of 7 buttons hit TRUE
                 last editor button 697.3-739.3 vs dock top 791   (51.7 clear)
                 Templates Close    709.7-751.7 vs dock top 791   (39.3 clear)
       390x844   dock z-index 9401, hit TRUE, 7 of 7 buttons hit TRUE
                 last editor button 667.4-711.4 vs dock top 757   (45.6 clear)
                 Templates Close    673.8-715.8 vs dock top 757   (41.2 clear)

   WHAT THIS SUITE PINS, in two parts.

   PART A resolves the cascade from source, so the LAW survives a machine with
   no browser: the lift is keyed on the room being open, it out-specifies the
   calm shell's own `#mlsDock{z-index:920}` on rank rather than on which async
   module appended last, the clearance is responsive, the wide-only rail rule is
   gated, and NOTHING writes display - feat_mls_redesign.js just had to stop
   hiding nav items with inline display:none because the Calm Shell reads that
   as "the app gated this feature off".

   PART B EXECUTES it in real Chrome at both viewports and both tabs, hit-tests
   every control, and dispatches a REAL mouse event at the Visit button's centre
   to prove the room actually stands down - because a dock button that switches
   the view behind a room still covering the whole screen is the same trap with
   an extra step. Part B needs a Chrome binary; if there is none it says so in
   the final line, in those words, so a skipped hit-test can never read as a
   passed one.

   NON-VACUITY. The lift rule was deleted from ScribeFlow.html and this suite
   was watched to fail - Part A on the missing rule, Part B on 7 of 7 dock
   buttons hit-testing false at both viewports. Both outputs are in the report.
   ========================================================================= */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'ScribeFlow.html'), 'utf8');
const CALM = fs.readFileSync(path.join(ROOT, 'feat_mls_calm_shell.js'), 'utf8');
const OT3 = fs.readFileSync(path.join(ROOT, 'feat_mls_opnote_templates_ui.js'), 'utf8');

let failures = 0;
function ok(cond, label, detail) {
  if (cond) { console.log('  pass  ' + label); return true; }
  failures++;
  console.log('  FAIL  ' + label + (detail ? '\n        ' + detail : ''));
  return false;
}
function head(t) { console.log('\n' + t); }

/* ========================================================================
   PART A - the cascade, resolved from source
   ==================================================================== */
head('PART A - the stacking law, resolved from the shipped stylesheets');

/* every <style> block of the app, comments stripped */
let css = '';
HTML.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, function (_, b) { css += b + '\n'; return ''; });
ok(css.length > 0, 'ScribeFlow.html ships at least one <style> block');
const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, '');

/* CSS specificity, the same (id, class, type) triple a browser ranks by.
   :has() contributes the specificity of its most specific argument, which is
   the whole reason the lift below beats a bare #mlsDock without !important. */
function specificity(sel) {
  let s = sel;
  let ids = 0, cls = 0, typ = 0;
  s = s.replace(/:has\(([^()]*)\)/g, function (_, inner) {
    const t = specificity(inner);
    ids += t[0]; cls += t[1]; typ += t[2];
    return ' ';
  });
  ids += (s.match(/#[\w-]+/g) || []).length;
  cls += (s.match(/\.[\w-]+/g) || []).length + (s.match(/\[[^\]]*\]/g) || []).length
       + (s.match(/:(?!:)[a-z-]+/g) || []).length;
  typ += (s.match(/(^|[\s>+~])[a-zA-Z][\w-]*/g) || []).length;
  return [ids, cls, typ];
}
function rank(sel) { const t = specificity(sel); return t[0] * 10000 + t[1] * 100 + t[2]; }

/* the instrument is checked before it is believed */
ok(rank('#mlsDock') === 10000, 'specificity self-test: #mlsDock is (1,0,0)', String(rank('#mlsDock')));
ok(rank('html:has(#opPrepModal.opr-room.show) #mlsDock') > rank('#mlsDock'),
  'specificity self-test: an :has()-scoped rule outranks a bare id rule',
  'has=' + rank('html:has(#opPrepModal.opr-room.show) #mlsDock') + ' bare=' + rank('#mlsDock'));
ok(rank('body.mls-ot3 #oprEditor') < rank('html:has(#opPrepModal.opr-room.show) #oprEditor'),
  'specificity self-test: the room clearance outranks the ot3 skin that sets the same padding');
if (failures) {
  console.log('\nFAIL  opnote-room-does-not-trap: the specificity instrument is wrong, so nothing below can be trusted.');
  process.exit(1);
}

/* --- the mechanism is still real (this suite must not pass by accident) --- */
const backdrop = cssNoComments.match(/\.modal-bg\s*\{[^}]*z-index:\s*(\d+)/);
ok(!!backdrop, 'the .modal-bg backdrop still declares a z-index (suite is not testing a deleted feature)');
const dockZ = CALM.match(/#mlsDock\{[^']*z-index:(\d+)/);
ok(!!dockZ, 'feat_mls_calm_shell.js still declares the dock z-index');
if (backdrop && dockZ) {
  ok(Number(backdrop[1]) > Number(dockZ[1]),
    'the defect is still structurally possible: the modal layer (' + backdrop[1] +
    ') outranks the dock (' + dockZ[1] + '), so the lift below is doing real work',
    'if this ever flips, delete the lift rather than leave a rule nobody needs');
}

/* --- collect every rule that sets z-index on #mlsDock ------------------- */
function rulesFor(text, idSel, prop) {
  const out = [];
  text.replace(/([^{}]+)\{([^{}]*)\}/g, function (_, selList, decls) {
    if (!new RegExp(prop + '\\s*:').test(decls)) return '';
    selList.split(',').forEach(function (sel) {
      const s = sel.trim().replace(/\s+/g, ' ');
      if (!s || s.charAt(0) === '@') return;
      if (s.indexOf(idSel) < 0) return;
      const m = decls.match(new RegExp(prop + '\\s*:\\s*([^;]+)'));
      out.push({ sel: s, value: m ? m[1].trim() : '', rank: rank(s) });
    });
    return '';
  });
  return out;
}
const lifts = rulesFor(cssNoComments, '#mlsDock', 'z-index');
ok(lifts.length >= 1, 'ScribeFlow.html declares a z-index for #mlsDock',
  'the room is a full-screen takeover; without this the dock is painted under it');
const roomScoped = lifts.filter(r => /#opPrepModal\.opr-room\.show/.test(r.sel));
ok(roomScoped.length >= 1,
  'the dock lift is SCOPED to the op-note room being open',
  'an unscoped lift would float the dock over every centred dialog in the app; ' +
  'found: ' + lifts.map(r => r.sel).join(' | '));
roomScoped.forEach(function (r) {
  ok(r.rank > rank('#mlsDock'),
    'the lift out-specifies the calm shell rule on RANK, not on append order: ' + r.sel,
    'rank ' + r.rank + ' vs #mlsDock ' + rank('#mlsDock'));
  ok(!/!important/i.test(r.value),
    'the lift wins without !important: ' + r.sel + ' -> ' + r.value);
  ok(Number(String(r.value).replace(/\D+/g, '')) > Number(backdrop ? backdrop[1] : 0),
    'the lifted dock sits ABOVE the modal layer: ' + r.value + ' > ' + (backdrop && backdrop[1]));
});

/* nothing in the lift may reach for display - that is the pattern
   feat_mls_redesign.js had to stop using, because the Calm Shell reads an
   inline display:none on a nav control as "the app gated this feature off". */
const liftBlock = cssNoComments.match(/html:has\(#opPrepModal\.opr-room\.show\)[\s\S]{0,900}?@media \(min-width:901px\)\{[\s\S]*?\n  \}/);
ok(!!liftBlock, 'the room-does-not-trap block is present in the stylesheet');
if (liftBlock) {
  ok(!/display\s*:/.test(liftBlock[0]),
    'the fix never writes display - it is stacking and spacing only',
    liftBlock[0].slice(0, 200));
}

/* the two panels the dock itself opens must come up with it */
['#mlsToolsMenu', '#copilotDock'].forEach(function (id) {
  const rows = rulesFor(cssNoComments, id, 'z-index').filter(r => /#opPrepModal\.opr-room\.show/.test(r.sel));
  ok(rows.length >= 1,
    id + ' is lifted with the dock (a button that opens a panel BEHIND the room is the same trap)');
});

/* --- clearance: responsive value, gated wide-only rail ------------------ */
head('PART A - the room gives the dock its space');
const clears = rulesFor(cssNoComments, '#oprEditor', 'padding-bottom')
  .concat(rulesFor(cssNoComments, '#oprPanelTpls', 'padding-bottom'))
  .filter(r => /#opPrepModal\.opr-room\.show/.test(r.sel));
ok(clears.length >= 2,
  'both scrolling regions of the room reserve room for the dock',
  'found: ' + clears.map(r => r.sel).join(' | '));
clears.forEach(function (r) {
  ok(r.rank > rank('body.mls-ot3 #oprEditor'),
    'the clearance outranks the ot3 skin that owns this padding: ' + r.sel);
});
const declBase = cssNoComments.match(/#opPrepModal\.opr-room\{[^}]*--opr-dock-clear:\s*([^;}]+)/);
ok(!!declBase, '--opr-dock-clear has a NARROW default on the room itself');
/* 761, not 901: the value tracks the DOCK's breakpoint, because it is the dock's
   height it is reserving. Measured at 761x900 the dock is still 91px tall and
   occupies 109px - the room has already collapsed to one column there, so a
   clearance keyed to the room's 900px gate would leave the whole 761-900 band
   short of the surface it exists to clear. */
const wideBlock = cssNoComments.match(/@media \(min-width:761px\)\{[\s\S]*?--opr-dock-clear:\s*([^;}]+)[\s\S]*?\n  \}/);
ok(!!wideBlock, '--opr-dock-clear is overridden above the DOCK breakpoint, @media (min-width:761px)',
  'a single unconditioned value would give a phone the desktop dock height and a ' +
  'desktop the phone one - the class of bug runtime-skin-cannot-outrank-responsive pins');
if (declBase && wideBlock) {
  const n = s => Number(String(s).match(/(\d+)px/)[1]);
  ok(n(wideBlock[1]) > n(declBase[1]),
    'the wide clearance is larger than the narrow one (the dock is taller there): ' +
    declBase[1].trim() + ' -> ' + wideBlock[1].trim());
}
/* both halves of the dock's own bottom formula are honoured, or the clearance
   is wrong on exactly the devices that need it most */
if (declBase) {
  ok(/safe-area-inset-bottom/.test(declBase[1]) && /--mls-kbd/.test(declBase[1]),
    'the clearance follows the dock over a home indicator AND an iOS keyboard',
    declBase[1].trim());
}
const railClear = rulesFor(cssNoComments, '#oprDayRail', 'padding-bottom')
  .filter(r => /#opPrepModal\.opr-room\.show/.test(r.sel));
ok(railClear.length >= 1, 'the day rail reserves room for the dock too');
const railWide = cssNoComments.match(/@media \(min-width:901px\)\{[\s\S]*?#oprDayRail\{[^}]*padding-bottom/);
ok(!!railWide,
  'the day rail clearance is GATED to @media (min-width:901px) - the ROOM breakpoint',
  'below it the rail is the TOP row of the grid and nowhere near the dock; ' +
  'padding there is dead space inside a ~229px box');

/* --- the room stands down when a dock DESTINATION is chosen ------------- */
head('PART A - a dock destination actually leaves the room');
const leaveIdx = HTML.indexOf('THE ROOM MUST NOT TRAP, part two');
ok(leaveIdx > 0, 'the dock-leave handler is present and named');
const leaveSrc = leaveIdx > 0 ? HTML.slice(leaveIdx, HTML.indexOf('},true);', leaveIdx) + 8) : '';
ok(/document\.addEventListener\('click'[\s\S]*\},true\);\s*$/.test(leaveSrc),
  'it is a CAPTURE-phase click listener, so it runs before the calm shell own handler',
  leaveSrc.slice(-80));
ok(/#mlsDock button\[data-dest\]/.test(leaveSrc),
  'it is keyed on a dock DESTINATION button, not on the whole dock');
ok(/data-dest'\)\s*===\s*'tools'/.test(leaveSrc.replace(/getAttribute\('/g, "getAttribute('")),
  'Tools is exempt: it opens a menu and navigates nowhere, so the room stays open under it');
ok(/closeOpPrep\(\)/.test(leaveSrc),
  'it closes through the room own closeOpPrep(), not by writing a style');
ok(!/style\s*\./.test(leaveSrc) && !/display\s*=/.test(leaveSrc),
  'the handler writes no inline style at all');

/* ========================================================================
   PART B - executed in real Chrome
   ==================================================================== */
head('PART B - executed at 1440x900 and 390x844, in a PHI-free replica');

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

/* ---------- the replica: real markup, real stylesheets, real module ----- */
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
function calmCss() {
  const s = CALM.indexOf('  var CSS = [');
  const e = CALM.indexOf("].join('');", s);
  if (s < 0 || e < 0) return '';
  // eslint-disable-next-line no-new-func
  return new Function('return [' + CALM.slice(s + '  var CSS = ['.length, e) + '];')().join('');
}
/* the dock, built exactly as feat_mls_calm_shell.js buildDock() builds it */
const DOCK_HTML = '<nav id="mlsDock" aria-label="Main"><div class="mls-dock-pill"></div>' +
  ['day:Day', 'patient:Patient', 'visit:Visit', 'review:Review', 'studio:AI Studio', 'tools:Tools']
    .map(function (d) {
      const p = d.split(':');
      return '<button type="button" data-dest="' + p[0] + '" aria-label="' + p[1] + '">' +
        '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="6"/></svg>' +
        '<span>' + p[1] + '</span></button>';
    }).join('') +
  '<button id="mlsDockCopilot" type="button" title="Copilot">' +
  '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="6"/></svg><span>Copilot</span></button>' +
  '<div id="mlsDockAskWrap"><input id="mlsDockAsk" type="text" aria-label="Ask or find anything">' +
  '<div id="mlsAskResults" role="listbox" aria-label="Results"></div></div></nav>';

function procCards(n) {
  let out = '';
  for (let i = 0; i < n; i++) {
    out += '<div style="border:1px solid #ddd;border-radius:12px;padding:14px;margin:0 0 12px">' +
      '<div><b>Synthetic Case ' + (i + 1) + '</b>' +
      '<select id="opPrepTpl_' + i + '"><option>Template A</option></select></div>' +
      '<textarea id="opPrepNote_' + i + '" style="width:100%;min-height:120px">Synthetic fixture text, no patient data.</textarea>' +
      '<div class="row"><button class="btn-primary">Generate</button><button class="btn-ghost">Copy</button></div></div>';
  }
  return out;
}
/* the SHIPPED close path + the SHIPPED dock-leave handler, lifted verbatim */
const CLOSE_FN = (HTML.match(/^function closeOpPrep\(\)\{[^\n]*\}$/m) || [''])[0];
const LEAVE_FN = leaveSrc.slice(leaveSrc.indexOf("document.addEventListener('click'"));

function buildPage(templatesTab) {
  const styles = [];
  HTML.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, function (_, b) { styles.push('<style>' + b + '</style>'); return ''; });
  let room = balancedDiv(HTML, '<div class="modal-bg opr-room" id="opPrepModal"');
  room = room.replace('<div id="opPrepList"></div>', '<div id="opPrepList">' + procCards(9) + '</div>');
  room = room.replace('<section id="oprPanelTpls"></section>',
    '<section id="oprPanelTpls">' + balancedDiv(HTML, '<div class="modal-bg" id="templatesModal"') + '</section>');
  return [
    '<!doctype html><html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<title>op-note room replica (PHI-free)</title>',
    styles.join('\n'),
    '<style id="mlsCalmShellCss">' + calmCss() + '</style>',
    '</head><body class="mls-calm mls-redesign mls-rd-shell">',
    '<div id="appWrap" style="min-height:200vh;padding:20px">synthetic app body</div>',
    DOCK_HTML,
    /* visibility:hidden - in the app these are BUILT on open, so a permanently
       open stub would be the INSTRUMENT covering the room, not the product.
       Computed z-index still resolves, which is all Part B reads from them. */
    '<div id="mlsToolsMenu" role="menu" style="left:20px;bottom:120px;visibility:hidden"><button class="r">Settings</button></div>',
    '<div id="copilotDockScrim" style="visibility:hidden"></div>',
    '<div id="copilotDock" style="visibility:hidden"><p>synthetic</p></div>',
    room,
    '<script>' + OT3 + '<\/script>',
    '<script>' + CLOSE_FN + '\n' + LEAVE_FN + '<\/script>',
    '<script>document.getElementById("opPrepModal").classList.add("show");',
    templatesTab
      ? 'var _t=document.getElementById("templatesModal"); if(_t)_t.classList.add("show");' +
        'document.getElementById("oprPanelTpls").classList.add("on");' +
        'document.getElementById("oprPanelProcs").classList.add("opr-hidden-for-tpls");'
      : '',
    '<\/script>',
    templatesTab ? '<style>.opr-hidden-for-tpls{display:none}<\/style>' : '',
    '</body></html>'
  ].join('\n');
}

const PROBE = `(() => {
  const out = {};
  const rectOf = el => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
    return { w:+r.width.toFixed(1), h:+r.height.toFixed(1), top:+r.top.toFixed(1), bottom:+r.bottom.toFixed(1),
             left:+r.left.toFixed(1), display:s.display, visibility:s.visibility, opacity:s.opacity,
             zIndex:s.zIndex, position:s.position }; };
  /* HIT TEST, not a rect. "visible" and "clickable" are different things. */
  const hit = el => { if(!el) return { hit:false, why:'absent' };
    const r = el.getBoundingClientRect();
    if (r.width<=0||r.height<=0) return { hit:false, why:'zero-rect' };
    const cx = Math.round(r.left+r.width/2), cy = Math.round(r.top+r.height/2);
    if (cx<0||cy<0||cx>=innerWidth||cy>=innerHeight) return { hit:false, why:'off-viewport', cx, cy };
    const t = document.elementFromPoint(cx, cy);
    return { hit: !!(t && (t===el || el.contains(t))), cx, cy,
             topId: t ? (t.id || t.tagName) : null };
  };
  const dock = document.getElementById('mlsDock');
  out.viewport = { w: innerWidth, h: innerHeight };
  out.dock = dock ? rectOf(dock) : null;
  out.dockHit = hit(dock);
  out.buttons = [...document.querySelectorAll('#mlsDock button')].map(b => Object.assign(
    { dest: b.getAttribute('data-dest') || b.id }, hit(b),
    { w:+b.getBoundingClientRect().width.toFixed(1), h:+b.getBoundingClientRect().height.toFixed(1) }));
  out.toolsZ = (document.getElementById('mlsToolsMenu')||{}) && getComputedStyle(document.getElementById('mlsToolsMenu')).zIndex;
  out.copilotZ = getComputedStyle(document.getElementById('copilotDock')).zIndex;
  const back = document.getElementById('oprBack');
  out.back = back ? Object.assign(rectOf(back), hit(back)) : null;
  const x = document.querySelector('#opPrepModal > .modal > .modal-x');
  out.modalX = x ? Object.assign(rectOf(x), hit(x)) : null;
  /* the LAST control of whichever region is scrolling, after scrolling to the
     very bottom: it must end up clear of the dock band and hit-test to itself */
  const region = document.getElementById('oprPanelTpls').classList.contains('on')
    ? document.getElementById('oprPanelTpls') : document.getElementById('oprEditor');
  out.regionId = region.id;
  out.regionTravel = region.scrollHeight - region.clientHeight;
  out.regionPadBottom = getComputedStyle(region).paddingBottom;
  const buttons = [...region.querySelectorAll('button')];
  const last = region.id === 'oprPanelTpls'
    ? (buttons.filter(b => /^close$/i.test((b.textContent||'').trim())).pop() || buttons.pop())
    : buttons.pop();
  region.scrollTop = region.scrollHeight;
  out.lastControl = last ? Object.assign(
    { text: (last.textContent||'').trim().slice(0,18) }, rectOf(last), hit(last)) : null;
  region.scrollTop = 0;
  out.railPadBottom = getComputedStyle(document.getElementById('oprDayRail')).paddingBottom;
  return out;
})()`;

/* ---------- a very small CDP client ------------------------------------ */
const sleep = ms => new Promise(r => setTimeout(r, ms));
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
  const pages = { procedures: buildPage(false), templates: buildPage(true) };
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(/tpls/.test(req.url) ? pages.templates : pages.procedures);
  });
  const origin = await new Promise(r => server.listen(0, '127.0.0.1',
    () => r('http://127.0.0.1:' + server.address().port)));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mls-notrap-'));
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
      for (const tab of ['procedures', 'templates']) {
        const label = vp.n + ' ' + tab;
        await cdp.send('Emulation.setDeviceMetricsOverride',
          { width: vp.w, height: vp.h, deviceScaleFactor: 1, mobile: false, screenWidth: vp.w, screenHeight: vp.h });
        await cdp.send('Page.navigate', { url: origin + (tab === 'templates' ? '/tpls' : '/') });
        await sleep(450);
        /* frozen entrance animations report the wrong geometry - settle them */
        await evalJs('document.getAnimations().forEach(a=>a.finish()); 1');
        await sleep(100);
        const m = await evalJs(PROBE);

        ok(m.dock && m.dock.display !== 'none' && m.dock.visibility === 'visible' && Number(m.dock.opacity) > 0
          && m.dock.w > 0 && m.dock.h > 0,
          label + ': the dock is rendered', JSON.stringify(m.dock));
        ok(m.dockHit.hit, label + ': the dock is HIT-TESTABLE at its centre',
          'elementFromPoint(' + m.dockHit.cx + ',' + m.dockHit.cy + ') -> ' + m.dockHit.topId +
          '  (this is the exact assertion the pre-fix run failed, 0 of 7)');
        const missed = m.buttons.filter(b => !b.hit);
        ok(missed.length === 0,
          label + ': all ' + m.buttons.length + ' dock buttons hit-test to themselves',
          missed.map(b => b.dest + ' -> ' + (b.topId || b.why)).join(', '));
        ok(Number(m.dock.zIndex) > 9400, label + ': the dock is stacked above the modal layer',
          'z-index ' + m.dock.zIndex);
        ok(Number(m.toolsZ) > 9400 && Number(m.copilotZ) > 9400,
          label + ': the panels the dock opens come up with it',
          'tools ' + m.toolsZ + ', copilot ' + m.copilotZ);

        ok(m.back && m.back.w >= 44 && m.back.h >= 44 && m.back.hit,
          label + ': the room ‹ Back button is >=44px and hit-testable',
          JSON.stringify(m.back));
        ok(m.modalX && m.modalX.w >= 44 && m.modalX.h >= 44 && m.modalX.hit,
          label + ': the room close ✕ is >=44px and hit-testable', JSON.stringify(m.modalX));

        ok(m.regionTravel > 0, label + ': ' + m.regionId + ' still scrolls',
          'travel ' + m.regionTravel + 'px');
        ok(!!m.lastControl && m.lastControl.bottom <= m.dock.top,
          label + ': after scrolling to the bottom, "' + (m.lastControl && m.lastControl.text) +
          '" clears the dock',
          'control bottom ' + (m.lastControl && m.lastControl.bottom) + ' vs dock top ' + m.dock.top +
          ' (padding-bottom ' + m.regionPadBottom + ')');
        ok(!!m.lastControl && m.lastControl.hit,
          label + ': ...and it hit-tests to itself, not to the dock',
          JSON.stringify(m.lastControl));
        if (vp.w >= 901) {
          ok(parseFloat(m.railPadBottom) > 40, label + ': the day rail reserves dock clearance (wide)',
            m.railPadBottom);
        } else {
          ok(parseFloat(m.railPadBottom) < 40, label + ': the day rail does NOT waste a phone on clearance',
            'the rail is the top row here; ' + m.railPadBottom);
        }
      }
    }

    /* --- REAL mouse events: does the room actually stand down? -----------
       Not el.click(). A synthetic dispatch proves a handler exists; only a
       dispatched Input event proves the pixel the doctor presses reaches it,
       which is the whole point of a control that was covered a moment ago. */
    head('PART B - a real click on a dock destination leaves the room');
    for (const vp of [{ n: '1440x900', w: 1440, h: 900 }, { n: '390x844', w: 390, h: 844 }]) {
      for (const probe of [{ dest: 'visit', leaves: true }, { dest: 'tools', leaves: false }]) {
        await cdp.send('Emulation.setDeviceMetricsOverride',
          { width: vp.w, height: vp.h, deviceScaleFactor: 1, mobile: false, screenWidth: vp.w, screenHeight: vp.h });
        await cdp.send('Page.navigate', { url: origin + '/' });
        await sleep(400);
        await evalJs('document.getAnimations().forEach(a=>a.finish()); 1');
        const pt = await evalJs(`(() => { const b=document.querySelector('#mlsDock button[data-dest="${probe.dest}"]');
          if(!b) return null; const r=b.getBoundingClientRect();
          return { x: Math.round(r.left+r.width/2), y: Math.round(r.top+r.height/2),
                   open: document.getElementById('opPrepModal').classList.contains('show') }; })()`);
        ok(!!pt && pt.open, vp.n + ' ' + probe.dest + ': the room is open before the click');
        if (!pt) continue;
        for (const type of ['mousePressed', 'mouseReleased']) {
          await cdp.send('Input.dispatchMouseEvent',
            { type, x: pt.x, y: pt.y, button: 'left', clickCount: 1, buttons: type === 'mousePressed' ? 1 : 0 });
        }
        await sleep(120);
        const stillOpen = await evalJs("document.getElementById('opPrepModal').classList.contains('show')");
        ok(stillOpen === !probe.leaves,
          vp.n + ': a real click at (' + pt.x + ',' + pt.y + ') on "' + probe.dest + '" ' +
          (probe.leaves ? 'CLOSES the room' : 'leaves the room open (it opens a menu, it does not navigate)'),
          'room still open = ' + stillOpen);
      }
    }
  } finally {
    cdp.close(); server.close(); child.kill();
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (_) {}
  }
}

/* ======================================================================== */
(async function main() {
  const exe = chromePath();
  let browserRan = false;
  if (!exe) {
    console.log('  ----  NO CHROME BINARY FOUND: the hit-tests below did NOT run.');
  } else {
    try { await runBrowser(exe); browserRan = true; }
    catch (e) { failures++; console.log('  FAIL  Part B could not execute\n        ' + (e && e.message || e)); }
  }
  const suffix = browserRan
    ? 'the dock is reachable over the room and the room still works.'
    : 'PART B DID NOT RUN (no Chrome binary) - the stacking law is proved from source, ' +
      'the hit-tests are NOT.';
  console.log(failures
    ? '\nFAIL  opnote-room-does-not-trap: ' + failures + ' assertion(s) failed.'
    : '\nPASS  opnote-room-does-not-trap: ' + suffix);
  process.exit(failures ? 1 : 0);
})();
