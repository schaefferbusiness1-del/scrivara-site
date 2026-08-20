'use strict';

/* /1p — A PULL CONTROL SAYS WHICH PULL IT DOES  (pullverb-1.0.0, 2026-08-19)
 *
 * Owner, 2026-08-19, from his screenshot of the Patients screen: "this pull
 * from athena button thats going to pull the patient is messed up and doesnt
 * say what it really is fix that and also put that same button in better
 * places to."
 *
 * There are TWO different verbs on this screen and they wore one name:
 *
 *   VERB A  #ptPullAthenaBtn        reads WHOEVER IS OPEN in the athenaOne tab
 *                                   and can create an MLS patient from it
 *                                   (feat_athena_autopull.js:237-242 replaces
 *                                   pullPatientFromAthenaPrompt with run(null))
 *   VERB B  #pullChartBtn,          reads the patient SELECTED HERE
 *           #profUnpulledPull,      (pullPatientChartViaAssist)
 *           #pvrPullOne
 *
 * ...and verb A's own tooltip described verb B ("Opens THIS PATIENT'S chart
 * ... and pulls THEIR name, DOB and past visits into MLS").
 *
 * The properties this suite pins, each with a control that fails when the fix
 * is doing nothing:
 *
 *   1. TWO VERBS, TWO NAMES. Neither name contains the other. CONTROL: the
 *      pre-fix strings ("Pull from Athena" / "Pull chart from Athena") must be
 *      GONE from the shells, or the rename renamed nothing.
 *   2. THE NAME IS A NAME, NOT AN ESSAY. Measured before: 268 characters, with
 *      READ-ONLY welded into the middle. CONTROL: __mlsPullVerb.revert()
 *      restores the long welded name - if it does not, this suite is measuring
 *      a page that was already clean.
 *   3. READ-ONLY SURVIVES AS AN AFFORDANCE. The chip stays visible; it is
 *      aria-hidden so it is not part of the name.
 *   4. THE EXPLANATION IS VISIBLE WHERE IT IS ANNOUNCED. Measured before:
 *      0x0 at 768/1024/1280/1440 while still inside the accessible name.
 *   5. THE BUBBLE NEVER SITS ON THE SEARCH BOX. Rect intersection AND
 *      elementFromPoint, five widths, several scroll states. CONTROL: with
 *      __mlsTipAvoid removed the sweep MUST find a real collision somewhere,
 *      or the helper is being credited for a problem that is not there.
 *   6. ONE PULL CONTROL PER SURFACE PER VERB, 40px tap floor. This block adds
 *      no control anywhere; the count must not have grown.
 *   7. A BUSY STATE AT THE CONTROL. Verb A's engine discards the button it is
 *      handed, so before this it never disabled and never changed.
 *   8. LANE NEUTRALITY. Not one byte reaches production or /cloned.
 *
 * PART 1 is static. PART 2 drives the real shell in real Chrome - no login, no
 * network, no PHI, synthetic names only.
 *
 * THE TRAP THIS SUITE AVOIDS: 1p-mls-connect.js and its feature modules are not
 * loaded by the page on its own - they ride a gate a login normally opens. A
 * measurement taken without window.__mlsEnsureUiBundle() measures a bare shell
 * and reports that everything is fine.
 */

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const SHELLS = ['1pScribeFlow.html', '1p/index.html'];
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

let checks = 0;
const measured = {};
function ok(value, message) { assert.ok(value, message); checks++; }
function eq(a, b, message) { assert.strictEqual(a, b, `${message} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); checks++; }

const NAME_A = 'Pull the patient open in athena';
const NAME_B = "Pull this patient's chart";

/* ------------------------------------------------------------------ PART 1 */
function statics() {
  const blocks = [];
  for (const shell of SHELLS) {
    const src = read(shell);

    ok(src.indexOf('<!-- ===== pullverb-1.0.0') > 0, `${shell}: pullverb-1.0.0 is not in a delimited block`);
    ok(src.indexOf('<!-- ===== end pullverb-1.0.0') > 0, `${shell}: pullverb-1.0.0 block is not closed`);
    eq(src.split('<!-- ===== pullverb-1.0.0').length - 1, 1, `${shell}: the block is present more than once`);

    /* 1. the two names are there, and the old shared wording is gone */
    ok(src.indexOf(NAME_A) > 0, `${shell}: verb A's name is missing`);
    ok(src.indexOf(NAME_B) > 0, `${shell}: verb B's name is missing`);

    /* CONTROL for property 1: the pre-fix labels must not survive as button
       text anywhere in the shells. They may still be quoted inside the block's
       own rationale prose, so only >MARKUP< occurrences count. */
    for (const dead of ['>📥 Pull from Athena<', '>📥 Pull chart from Athena<', '>📥 Pull chart<', '>Pull chart<']) {
      eq(src.indexOf(dead), -1, `${shell}: the pre-fix label ${dead} is still rendered - the rename renamed nothing`);
    }
    /* the tooltip that described the WRONG verb */
    eq(src.indexOf('title="Opens this patient’s chart in your signed-in Athena tab (read-only) and pulls their'), -1,
      `${shell}: verb A still carries the tooltip that describes verb B`);

    /* neither name may contain the other, in either direction */
    eq(NAME_A.toLowerCase().indexOf(NAME_B.toLowerCase()), -1, 'verb A\'s name contains verb B\'s');
    eq(NAME_B.toLowerCase().indexOf(NAME_A.toLowerCase()), -1, 'verb B\'s name contains verb A\'s');

    /* the place() hook is wired, or the layering fix is dead code */
    ok(src.indexOf('window.__mlsTipAvoid') > 0, `${shell}: place() never calls __mlsTipAvoid`);

    const a = src.indexOf('<!-- ===== pullverb-1.0.0');
    const b = src.indexOf('<!-- ===== end pullverb-1.0.0');
    blocks.push(src.slice(a, b));
  }
  /* the twin rule: the block is byte-identical in both shells */
  eq(blocks[0] === blocks[1], true, 'the pullverb-1.0.0 block differs between the two twins');

  /* The two controls 1p-mls-connect.js builds itself: #pvrPullOne (profile
     strip) and #ez3HistPull (the Visit room's verify row). Both are verb B.
     #ez3HistPull only renders with a live appointment bound, so it is pinned
     statically rather than left unmeasured. */
  const connect = read('1p-mls-connect.js');
  eq(connect.indexOf('Pull chart from Athena'), -1,
    '1p-mls-connect.js still builds a control with the old shared label');
  eq(connect.indexOf('>Pull chart</button>'), -1,
    '1p-mls-connect.js: the Visit room control still reads "Pull chart"');
  for (const id of ['pvrPullOne', 'ez3HistPull']) {
    const at = connect.indexOf(id);
    ok(at > 0, `1p-mls-connect.js no longer builds ${id}`);
  }
  ok(connect.split(NAME_B).length - 1 >= 2,
    `1p-mls-connect.js should name both verb-B controls it builds; found ${connect.split(NAME_B).length - 1}`);
  ok(connect.indexOf('data-mls-pullverb="this-patient"') > 0,
    '1p-mls-connect.js: the Visit room control is not tagged with its verb');

  /* 8. LANE NEUTRALITY */
  const forbidden = ['ScribeFlow.html', 'mls-connect.js', 'ScribeFlow-staging.html', 'mls-connect.staging.js'];
  for (const f of forbidden) {
    const p = path.join(root, f);
    if (!fs.existsSync(p)) continue;
    const src = fs.readFileSync(p, 'utf8');
    eq(src.indexOf('pullverb-1.0.0'), -1, `${f}: a /1p lane block reached production`);
    eq(src.indexOf(NAME_A), -1, `${f}: a /1p lane label reached production`);
  }
  const clonedDir = path.join(root, 'cloned');
  if (fs.existsSync(clonedDir)) {
    for (const f of fs.readdirSync(clonedDir)) {
      const p = path.join(clonedDir, f);
      if (!fs.statSync(p).isFile()) continue;
      if (!/\.(html|js)$/.test(f)) continue;
      /* /cloned is DERIVED from /1p by scripts/derive-cloned-from-1p.js. The
         lane-era form of this guard required the block to be ABSENT, which was
         true exactly until the r24 derive ran — a correct integration PROMOTES
         it (the same inversion pull-one's guard hit at r23). Shell files must
         now carry the block; non-shell derived files still must not. */
      const clonedSrc = fs.readFileSync(p, 'utf8');
      if (f === 'index.html' || f === 'cloned-mls-connect.js') {
        ok(clonedSrc.indexOf('pullverb-1.0.0') >= 0,
          `cloned/${f}: the derive did not promote pullverb-1.0.0`);
      } else {
        eq(clonedSrc.indexOf('pullverb-1.0.0'), -1,
          `cloned/${f}: pullverb-1.0.0 leaked into a file the derive should not touch`);
      }
    }
  }
}

/* ------------------------------------------------------------------ PART 2 */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.bin': 'application/octet-stream' };

function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let rel = decodeURIComponent(String(req.url).split('?')[0]);
      if (rel === '/') rel = '/1pScribeFlow.html';
      const file = path.resolve(root, '.' + rel);
      if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
      fs.readFile(file, (err, buf) => {
        if (err) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('nf'); return; }
        res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
        res.end(buf);
      });
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }));
  });
}

/* Injected. Synthetic names only, no PHI, no network. */
function harness() {
  function vis(el) {
    if (!el) return false;
    var r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    var cs = getComputedStyle(el);
    return !(cs.visibility === 'hidden' || cs.display === 'none' || cs.opacity === '0');
  }
  function rect(el) {
    if (!el) return null;
    var r = el.getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height),
             r: Math.round(r.right), b: Math.round(r.bottom) };
  }
  /* The accessible NAME as a browser computes it: an aria-label wins over all
     descendant text. Without this rule the welded essay IS the name. */
  function accName(el) {
    if (!el) return '';
    var al = el.getAttribute && el.getAttribute('aria-label');
    if (al && al.trim()) return al.trim();
    return String(el.textContent || '').replace(/\s+/g, ' ').trim();
  }
  function overlapArea(a, b) {
    if (!a || !b) return 0;
    var ix = Math.max(0, Math.min(a.r, b.r) - Math.max(a.x, b.x));
    var iy = Math.max(0, Math.min(a.b, b.b) - Math.max(a.y, b.y));
    return ix * iy;
  }

  window.__t9 = {
    vis: vis, rect: rect,
    seedMany: function (n) {
      var arr = [];
      for (var i = 0; i < n; i++) {
        arr.push({ id: 'syn-' + i, name: 'Sample' + i + ', Case', dob: '1970-01-0' + ((i % 9) + 1),
                   mrn: String(900000 + i), athenaId: String(900000 + i),
                   problems: '', meds: '', allergies: '', visits: [] });
      }
      try { savePatients(arr); } catch (e) { return 'ERR ' + e.message; }
      try { saveNotes([]); } catch (e) {}
      try { setActivePtId('syn-0'); } catch (e) {}
      try { showView('patients'); renderProfile(); renderPatients(); } catch (e) {}
      return (getPatients() || []).length;
    },
    installed: function () {
      return { pullverb: !!(window.__mlsPullVerb && window.__mlsPullVerb.installed),
               version: window.__mlsPullVerb && window.__mlsPullVerb.version,
               tipAvoid: typeof window.__mlsTipAvoid };
    },
    /* every renamed control, with the pieces that make up its name */
    control: function (id) {
      var b = document.getElementById(id);
      if (!b) return { present: false, id: id };
      var sub = b.querySelector('.mlsac-sub');
      var tag = b.querySelector('.mlsac-tag');
      var cs = getComputedStyle(b);
      return { present: true, id: id, visible: vis(b),
        accName: accName(b),
        aria: b.getAttribute('aria-label') || '',
        verb: b.getAttribute('data-mls-pullverb') || '',
        flatText: String(b.textContent || '').replace(/\s+/g, ' ').trim(),
        tip: b.getAttribute('data-tip') || b.getAttribute('title') || '',
        subText: sub ? String(sub.textContent || '').replace(/\s+/g, ' ').trim() : '',
        subVisible: vis(sub), subRect: rect(sub),
        tagText: tag ? String(tag.textContent || '').trim() : '',
        tagVisible: vis(tag), tagAriaHidden: tag ? tag.getAttribute('aria-hidden') : null,
        height: Math.round(b.getBoundingClientRect().height),
        minHeight: cs.minHeight, rect: rect(b) };
    },
    /* pull controls actually VISIBLE on a given view, grouped by verb */
    countOn: function (viewId) {
      var v = document.getElementById(viewId);
      if (!v) return { view: false, id: viewId };
      var all = [].slice.call(v.querySelectorAll('button,a,[role=button]'));
      var hits = [];
      for (var i = 0; i < all.length; i++) {
        var b = all[i];
        if (!vis(b)) continue;
        var nm = accName(b);
        var flat = String(b.textContent || '').replace(/\s+/g, ' ').trim();
        /* a control counts as a pull control when its NAME claims a pull of a
           chart or a patient - day/schedule pulls are a different verb again */
        if (!/^\s*(?:📥\s*)?pull\b/i.test(nm) && !/^\s*(?:📥\s*)?pull\b/i.test(flat)) continue;
        hits.push({ id: b.id || '(none)', name: nm.slice(0, 60),
                    verb: b.getAttribute('data-mls-pullverb') || '(untagged)',
                    h: Math.round(b.getBoundingClientRect().height) });
      }
      return { view: true, id: viewId, count: hits.length, hits: hits };
    },
    /* ---- the layering measurement ---- */
    scrollTo: function (y) { window.scrollTo(0, y); return Math.round(window.scrollY); },
    scrollStates: function () {
      var b = document.getElementById('ptPullAthenaBtn');
      var out = [0];
      if (b) {
        var hdr = document.getElementById('appHeader');
        var hh = hdr ? Math.round(hdr.getBoundingClientRect().height) : 0;
        b.scrollIntoView({ block: 'start' });
        out.push(Math.round(window.scrollY));
        out.push(Math.max(0, Math.round(window.scrollY) - hh - 24));
        out.push(Math.max(0, Math.round(window.scrollY) - 40));
      }
      window.scrollTo(0, 0);
      /* unique, ascending */
      var seen = {}, uniq = [];
      for (var i = 0; i < out.length; i++) { if (!seen[out[i]]) { seen[out[i]] = 1; uniq.push(out[i]); } }
      return uniq;
    },
    /* Show the bubble WITHOUT depending on a real mouse: the engine's own
       listener is a mouseover handler, so dispatch one and let its 550ms
       intent timer run. pv-tips-1.1 re-anchored this sweep from the pull
       button (now deliberately TIPLESS - its words live in the inline sub) to
       #ptNewBtn, the nearest control that legitimately owns a seeded data-tip
       beside the search box, so the layering claim stays measurable. */
    /* pv-tips-1.1: the layering sweep's anchor is a SYNTHETIC probe pinned
       just under the search box - the exact geometry the (now tipless) pull
       button used to supply. A product control's position can drift with any
       layout change; the probe pins the collision case deterministically, so
       both arms of the tipAvoid measurement stay meaningful forever. */
    ensureProbe: function () {
      var inp = document.getElementById('ptSearch');
      if (!inp) return 'NO-SEARCH';
      var b = document.getElementById('t9TipProbe');
      if (!b) {
        b = document.createElement('button');
        b.id = 't9TipProbe'; b.type = 'button'; b.textContent = 'probe';
        b.setAttribute('data-tip', 'Reads whoever is open in your signed-in athenaOne tab right now and brings that chart into MLS. It can add a patient you do not have yet. Nothing is written to athena. (layering probe - sized like the real sentence)');
        b.style.cssText = 'position:fixed;width:180px;height:36px;opacity:.01;z-index:1;';
        document.body.appendChild(b);
      }
      /* reposition EVERY call - the search box moves with viewport and scroll.
         Mirror the real pull button's stacking: 90px BELOW the box on roomy
         layouts (place()'s above-the-anchor bubble then reaches the box - the
         control arm's collision), but ABOVE it when the box rides the viewport
         bottom (mobile stacking), where an off-screen anchor would clamp every
         candidate onto the box and assert an impossibility. */
      var r = inp.getBoundingClientRect();
      var below = r.bottom + 90;
      var top = (below + 46 <= window.innerHeight - 8) ? below : Math.max(8, r.top - 126);
      b.style.left = Math.round(r.left) + 'px';
      b.style.top = Math.round(top) + 'px';
      return 'ok';
    },
    removeProbe: function () { var b = document.getElementById('t9TipProbe'); if (b) b.remove(); return true; },
    hoverChip: function () {
      if (window.__t9.ensureProbe() !== 'ok') return 'NO-PROBE';
      var b = document.getElementById('t9TipProbe');
      var r = b.getBoundingClientRect();
      b.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true,
        clientX: Math.round(r.left + r.width / 2), clientY: Math.round(r.top + r.height / 2) }));
      return 'ok';
    },
    unhover: function () {
      var b = document.getElementById('t9TipProbe');
      if (b) b.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, cancelable: true }));
      var t = document.getElementById('mlsTip');
      if (t) t.style.display = 'none';
      return true;
    },
    /* pv-tips-1.1: the anti-triple probe. Hover the pull button, give the
       550ms intent timer room, and report every surface that could repeat
       the sentence: the universal bubble, the below-button pop, the carriers. */
    tripleProbe: function () {
      var b = document.getElementById('ptPullAthenaBtn');
      if (!b) return { missing: true };
      var r = b.getBoundingClientRect();
      b.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true,
        clientX: Math.round(r.left + r.width / 2), clientY: Math.round(r.top + r.height / 2) }));
      return new Promise(function (res) { setTimeout(function () {
        var t = document.getElementById('mlsTip');
        var tShown = !!(t && t.style.display !== 'none' && t.getBoundingClientRect().width > 0);
        var pop = b.querySelector('.mlsactip-pop');
        var popDisplay = pop ? getComputedStyle(pop).display : 'absent';
        var sub = b.querySelector('.mlsac-sub');
        var subShown = !!(sub && sub.getBoundingClientRect().height > 0);
        b.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, cancelable: true }));
        if (t) t.style.display = 'none';
        res({ tipShown: tShown, popDisplay: popDisplay, subShown: subShown,
          dataTip: b.getAttribute('data-tip') || '', title: b.getAttribute('title') || '' });
      }, 850); });
    },
    tipVsSearch: function () {
      var t = document.getElementById('mlsTip');
      var inp = document.getElementById('ptSearch');
      var rt = rect(t), ri = rect(inp);
      var shown = vis(t);
      var atInput = null;
      if (ri) {
        var e = document.elementFromPoint(Math.round(ri.x + ri.w / 2), Math.round(ri.y + ri.h / 2));
        atInput = e ? (e.id || e.className || e.tagName) : 'none';
      }
      /* Also check the input's TOP edge - the measured pre-fix collision only
         covered its top 16px, which a centre-only probe would call clean. */
      var atInputTop = null;
      if (ri) {
        var e2 = document.elementFromPoint(Math.round(ri.x + ri.w / 2), Math.round(ri.y + 4));
        atInputTop = e2 ? (e2.id || e2.className || e2.tagName) : 'none';
      }
      return { tipShown: shown, tipRect: rt, inpRect: ri, inpVisible: vis(inp),
               overlap: shown ? overlapArea(rt, ri) : 0,
               atInputCentre: atInput, atInputTop: atInputTop };
    },
    setAvoid: function (on) {
      if (on) { window.__mlsTipAvoid = window.__mlsPullVerb && window.__mlsPullVerb.tipAvoid; }
      else { try { delete window.__mlsTipAvoid; } catch (e) { window.__mlsTipAvoid = null; } }
      return typeof window.__mlsTipAvoid;
    },
    /* ---- busy state at the control ---- */
    pressA: function () {
      /* Stub the engine: this asserts the CONTROL's own busy state, not the
         athena read. Nothing reaches the network or the extension. */
      window.pullPatientFromAthenaPrompt = function () { return undefined; };
      var b = document.getElementById('ptPullAthenaBtn');
      if (!b) return 'MISSING';
      b.click();
      return 'clicked';
    },
    busyState: function () {
      var b = document.getElementById('ptPullAthenaBtn');
      if (!b) return { present: false };
      var txt = '';
      for (var i = 0; i < b.childNodes.length; i++) {
        var n = b.childNodes[i];
        if (n.nodeType === 3 && String(n.nodeValue).replace(/\s+/g, ' ').trim()) { txt = String(n.nodeValue).trim(); break; }
      }
      return { present: true, ariaBusy: b.getAttribute('aria-busy'), label: txt, disabled: !!b.disabled };
    },
    show: function (v) { try { showView(v); renderPatients(); renderProfile(); } catch (e) {} try { renderHistory(); } catch (e) {} return true; },
    clearBusy: function () { try { window.__mlsPullVerb.clearBusy(); } catch (e) {} return true; },
    revert: function () { try { return window.__mlsPullVerb.revert(); } catch (e) { return 'ERR ' + e.message; } }
  };
}

const WIDTHS = [360, 768, 1024, 1280, 1440];

async function boot(page, port) {
  await page.goto(`http://127.0.0.1:${port}/1pScribeFlow.html`, { waitUntil: 'load', timeout: 90000 });
  await page.waitForTimeout(2500);
  /* THE STEP WITHOUT WHICH THIS SUITE MEASURES A BARE SHELL. */
  await page.evaluate(() => (typeof window.__mlsEnsureUiBundle === 'function' ? window.__mlsEnsureUiBundle() : null));
  await page.waitForFunction(() => !!window.__mlsSimpleLayer, null, { timeout: 60000 });
  await page.waitForTimeout(7000);
  await page.evaluate(() => {
    const a = document.getElementById('authScreen'); if (a) a.style.display = 'none';
    const s = document.getElementById('appScreen'); if (s) s.style.display = '';
  });
  await page.evaluate(() => { window.__mlsHarnessAccountEmail = 'pullverb-harness@mlsscribe.test'; });
  await page.evaluate(harness);
}

async function sweepLayering(page, avoidOn) {
  const rows = [];
  for (const w of WIDTHS) {
    await page.setViewportSize({ width: w, height: 820 });
    await page.waitForTimeout(700);
    await page.evaluate(() => { try { showView('patients'); renderPatients(); renderProfile(); } catch (e) {} });
    await page.waitForTimeout(900);
    await page.evaluate((on) => window.__t9.setAvoid(on), avoidOn);
    const states = await page.evaluate(() => window.__t9.scrollStates());
    for (const y of states) {
      await page.evaluate((yy) => window.__t9.scrollTo(yy), y);
      await page.waitForTimeout(250);
      await page.evaluate(() => window.__t9.unhover());
      await page.evaluate(() => window.__t9.hoverChip());
      await page.waitForTimeout(800); /* the tip's own 550ms intent delay */
      const m = await page.evaluate(() => window.__t9.tipVsSearch());
      rows.push({ w, y, ...m });
      await page.evaluate(() => window.__t9.unhover());
    }
  }
  return rows;
}

async function runtime() {
  const { srv, port } = await serve();
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e.message).slice(0, 180)));
  page.on('dialog', (d) => d.dismiss().catch(() => {}));

  try {
    await boot(page, port);

    const inst = await page.evaluate(() => window.__t9.installed());
    measured.installed = inst;
    eq(inst.pullverb, true, `pullverb-1.0.0 did not install: ${JSON.stringify(inst)}`);
    eq(inst.version, 'pullverb-1.0.0', 'wrong block version installed');
    eq(inst.tipAvoid, 'function', 'the tooltip placement helper is not exposed');

    const seeded = await page.evaluate(() => window.__t9.seedMany(28));
    eq(seeded, 28, `the synthetic patients did not land in the store: ${JSON.stringify(seeded)}`);
    await page.waitForTimeout(2200);

    /* -- 1 + 2 + 3. THE NAMES ------------------------------------------- */
    const A = await page.evaluate(() => window.__t9.control('ptPullAthenaBtn'));
    measured.A = A;
    eq(A.present, true, '#ptPullAthenaBtn is missing');
    eq(A.accName, NAME_A, 'verb A does not state its real verb');
    eq(A.verb, 'open-in-athena', 'verb A is not tagged with the verb it performs');
    ok(/open in athena/i.test(A.accName), 'verb A\'s name does not say the patient is the one open in athena');
    eq(/READ-?ONLY/i.test(A.accName), false, 'READ-ONLY is still part of verb A\'s name');
    ok(A.accName.length <= 40, `verb A's name is still an essay (${A.accName.length} chars)`);
    /* the essay is still ON the button, just not AS the name */
    ok(A.flatText.length > A.accName.length, 'the explanation was deleted rather than moved out of the name');
    /* 3. the affordance survives */
    eq(A.tagText, 'READ-ONLY', 'the READ-ONLY chip was removed');
    eq(A.tagVisible, true, 'the READ-ONLY chip is no longer visible to the doctor');
    eq(A.tagAriaHidden, 'true', 'the READ-ONLY chip is still inside the accessible name');
    /* the explanation now describes verb A, not verb B */
    ok(/whoever is open/i.test(A.subText), `verb A's explanation still describes the wrong verb: ${JSON.stringify(A.subText.slice(0, 90))}`);
    eq(/opens this patient/i.test(A.tip), false, 'verb A\'s tooltip still describes verb B');

    /* Each control is measured ON THE VIEW THAT OWNS IT. Measured while writing
       this suite: #pullChartBtn lives inside the hidden #historyView, so a
       naive pass read its height as 0 and reported a tap-target defect that
       does not exist. A hidden control has no rect - switch to its room first. */
    const OWNER_VIEW = { pullChartBtn: 'history', profUnpulledPull: 'patients', pvrPullOne: 'patients' };
    const bIds = ['pullChartBtn', 'profUnpulledPull', 'pvrPullOne'];
    measured.B = {};
    let bSeen = 0, bTapMeasured = 0;
    for (const id of bIds) {
      await page.evaluate((v) => window.__t9.show(v), OWNER_VIEW[id]);
      await page.waitForTimeout(900);
      const c = await page.evaluate((i) => window.__t9.control(i), id);
      measured.B[id] = c;
      if (!c.present) continue;
      bSeen++;
      eq(c.accName, NAME_B, `${id} does not state its real verb`);
      eq(c.verb, 'this-patient', `${id} is not tagged with the verb it performs`);
      ok(/this patient/i.test(c.accName), `${id}'s name does not say it is the selected patient`);
      eq(/READ-?ONLY/i.test(c.accName), false, `${id}: READ-ONLY is part of its name`);
      /* 1. THE TWO VERBS NEVER SHARE A NAME */
      ok(c.accName !== A.accName, `${id} shares verb A's name`);
      ok(c.accName.toLowerCase().indexOf(A.accName.toLowerCase()) < 0 &&
         A.accName.toLowerCase().indexOf(c.accName.toLowerCase()) < 0,
         `${id}'s name and verb A's name contain one another`);
      /* 6. 40px tap floor - only meaningful on a control that is on screen */
      if (c.visible) { ok(c.height >= 40, `${id} is ${c.height}px tall - under the 40px tap floor`); bTapMeasured++; }
    }
    ok(bSeen >= 2, `only ${bSeen} verb-B controls were reachable; expected at least 2`);
    /* the tap floor must not be silently skipped for every control */
    ok(bTapMeasured >= 1, 'no verb-B control was ever visible, so the 40px tap floor was never actually measured');
    measured.bTapMeasured = bTapMeasured;
    await page.evaluate(() => window.__t9.show('patients'));
    await page.waitForTimeout(800);
    ok(A.height >= 40, `verb A is ${A.height}px tall - under the 40px tap floor`);

    /* -- 6. ONE PULL CONTROL PER SURFACE PER VERB ------------------------ */
    const counts = {};
    for (const v of ['patientsView', 'historyView', 'visitView', 'calendarView']) {
      counts[v] = await page.evaluate((id) => window.__t9.countOn(id), v);
    }
    measured.counts = counts;
    for (const v of Object.keys(counts)) {
      const c = counts[v];
      if (!c.view || !c.count) continue;
      const byVerb = {};
      for (const h of c.hits) byVerb[h.verb] = (byVerb[h.verb] || 0) + 1;
      for (const verb of ['open-in-athena', 'this-patient']) {
        ok((byVerb[verb] || 0) <= 1,
          `${v} shows ${byVerb[verb]} controls for verb "${verb}" - the duplicate-button disease is back: ${JSON.stringify(c.hits)}`);
      }
    }

    /* -- 5. THE BUBBLE NEVER SITS ON THE SEARCH BOX ---------------------- */
    const withFix = await sweepLayering(page, true);
    measured.layeringWithFix = withFix;
    let sampled = 0, shownCount = 0;
    for (const r of withFix) {
      sampled++;
      if (!r.tipShown || !r.inpVisible) continue;
      shownCount++;
      eq(r.overlap, 0, `${r.w}px @scroll ${r.y}: the tooltip covers ${r.overlap}px of the search box`);
      /* The claim under test is about THESE TWO SURFACES. The sticky patient
         banner (#mlsCtxBar, z 5900) also passes over the search row at some
         scroll offsets - that is ordinary sticky-header behaviour that predates
         this block and is not the tooltip's collision, so it is recorded rather
         than asserted. What must never be true is that the BUBBLE is the thing
         sitting on the box. */
      ok(r.atInputCentre !== 'mlsTip', `${r.w}px @scroll ${r.y}: the tooltip is sitting on the search box centre`);
      ok(r.atInputTop !== 'mlsTip', `${r.w}px @scroll ${r.y}: the tooltip is sitting on the search box's top edge`);
      if (r.atInputCentre !== 'ptSearch') {
        (measured.searchCoveredByOther = measured.searchCoveredByOther || []).push(
          { w: r.w, scroll: r.y, by: r.atInputCentre });
      }
    }
    measured.layeringSampled = { sampled, shownCount };
    ok(shownCount >= 5, `the bubble was only measurable in ${shownCount} of ${sampled} states - this proves nothing`);

    /* CONTROL: without the helper the sweep MUST find a real collision. */
    const withoutFix = await sweepLayering(page, false);
    measured.layeringWithoutFix = withoutFix.filter((r) => r.overlap > 0);
    const worst = withoutFix.reduce((m, r) => (r.overlap > m ? r.overlap : m), 0);
    measured.worstUnfixedOverlap = worst;
    ok(worst > 0,
      'CONTROL BROKEN: with __mlsTipAvoid removed the bubble never collided with the search box in any sampled state, ' +
      'so this suite cannot show the helper does anything');
    /* put it back */
    await page.evaluate(() => window.__t9.setAvoid(true));
    eq(await page.evaluate(() => window.__t9.setAvoid(true)), 'function', 'the helper was not restored');
    await page.evaluate(() => window.__t9.removeProbe());

    /* -- 5b. pv-tips-1.1: ONE SURFACE OWNS THE WORDS --------------------- */
    /* Owner screenshot 2026-08-20: the same sentence painted three times -
       the inline sub plus TWO hover bubbles (#mlsTip above, .mlsactip-pop
       below). The contract: the sub stays visible; hovering the button
       renders NO bubble; the carriers that feed the universal bubble stay
       clear even against clarity's re-weld and the converter observer. */
    const triple = await page.evaluate(() => window.__t9.tripleProbe());
    measured.tripleProbe = triple;
    eq(triple.missing, undefined, 'anti-triple probe: the pull button is missing');
    eq(triple.subShown, true, 'anti-triple: the inline explanation vanished - the words must stay on screen');
    eq(triple.tipShown, false, 'anti-triple: the universal #mlsTip bubble still repeats the sentence on hover');
    ok(triple.popDisplay === 'none' || triple.popDisplay === 'absent',
      `anti-triple: the below-button pop still renders (display: ${triple.popDisplay})`);
    eq(triple.dataTip, '', `anti-triple: data-tip re-grew on the pull button: ${JSON.stringify(triple.dataTip.slice(0, 60))}`);
    eq(triple.title, '', `anti-triple: title re-grew on the pull button: ${JSON.stringify(triple.title.slice(0, 60))}`);

    /* -- 4. THE EXPLANATION IS VISIBLE WHERE IT IS ANNOUNCED ------------- */
    const subs = {};
    for (const w of WIDTHS) {
      await page.setViewportSize({ width: w, height: 820 });
      await page.waitForTimeout(600);
      await page.evaluate(() => { try { showView('patients'); renderPatients(); renderProfile(); } catch (e) {} });
      await page.waitForTimeout(900);
      await page.evaluate(() => window.__t9.scrollTo(0));
      subs[w] = await page.evaluate(() => window.__t9.control('ptPullAthenaBtn'));
    }
    measured.subsByWidth = Object.keys(subs).reduce((o, w) => {
      o[w] = { visible: subs[w].subVisible, rect: subs[w].subRect, name: subs[w].accName }; return o;
    }, {});
    for (const w of WIDTHS) {
      eq(subs[w].accName, NAME_A, `${w}px: verb A's name changed with the viewport`);
      eq(subs[w].subVisible, true,
        `${w}px: the explanation is announced as part of the control but renders ${JSON.stringify(subs[w].subRect)}`);
    }

    /* -- 7. A BUSY STATE AT THE CONTROL ---------------------------------- */
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForTimeout(600);
    await page.evaluate(() => { try { showView('patients'); renderPatients(); renderProfile(); } catch (e) {} });
    await page.waitForTimeout(800);
    const before = await page.evaluate(() => window.__t9.busyState());
    await page.evaluate(() => window.__t9.pressA());
    await page.waitForTimeout(500);
    const during = await page.evaluate(() => window.__t9.busyState());
    measured.busy = { before, during };
    eq(before.ariaBusy, null, 'the control claims to be busy before it was pressed');
    eq(during.ariaBusy, 'true', 'pressing verb A shows no busy state AT the control');
    ok(during.label !== before.label, `the control's label did not change while it worked (${JSON.stringify(during.label)})`);
    await page.evaluate(() => window.__t9.clearBusy());
    await page.waitForTimeout(300);
    const after = await page.evaluate(() => window.__t9.busyState());
    measured.busy.after = after;
    eq(after.ariaBusy, null, 'the busy state is never released');
    eq(after.label, before.label, 'the label was not restored after the work finished');

    /* -- 2. THE CAUSAL CONTROL: revert restores the welded essay ---------- */
    const reverted = await page.evaluate(() => window.__t9.revert());
    eq(reverted, true, 'revert() did not run');
    await page.evaluate(() => { try { renderProfile(); renderPatients(); } catch (e) {} });
    await page.waitForTimeout(2500);
    const afterRevert = await page.evaluate(() => window.__t9.control('ptPullAthenaBtn'));
    measured.afterRevert = { accName: afterRevert.accName, len: afterRevert.accName.length,
                             flatLen: afterRevert.flatText.length, tagAriaHidden: afterRevert.tagAriaHidden };
    /* Reverted, the READ-ONLY chip is back inside the announced name and the
       flattened label is an essay again. If this does not happen, the page was
       already clean and every assertion above proved nothing. */
    ok(afterRevert.flatText.length > 150,
      `CONTROL BROKEN: reverted, the control's flattened label is only ${afterRevert.flatText.length} chars - ` +
      'the welding this block undoes is not present, so nothing above was measured');
    ok(/READ-?ONLY/i.test(afterRevert.flatText),
      'CONTROL BROKEN: the READ-ONLY weld is absent even with the block reverted');

    eq(pageErrors.length, 0, `the page threw: ${JSON.stringify(pageErrors.slice(0, 3))}`);
  } finally {
    await browser.close();
    srv.close();
  }
}

(async () => {
  statics();
  await runtime();
  console.log(JSON.stringify(measured, null, 2).slice(0, 4000));
  console.log(`\n1p-pull-verb-truth-contract: PASS (${checks} checks)`);
})().catch((e) => {
  console.error('1p-pull-verb-truth-contract FAILED');
  console.error(e && e.stack || e);
  console.error('measured:', JSON.stringify(measured, null, 2).slice(0, 6000));
  process.exit(1);
});
