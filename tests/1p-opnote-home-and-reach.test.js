'use strict';

/* /1p OP NOTES — A WAY HOME, AND A ROOM WHERE EVERY CONTROL IS REACHABLE
 * (opnote-home-1.0.0 + opnote-reach-1.0.0)
 *
 * Owner's rule for this pass, verbatim: "if it's on the program it should work
 * — if it's there and doesn't work, make it work."
 *
 * WHAT THIS SUITE PROVES, as properties a machine can check.
 *
 *  1. THE THIRD HIDING MECHANISM, PINNED SO IT IS NEVER RE-DERIVED. Two
 *     earlier attempts put a Home button in the app header and lost it. The
 *     cause is not the data-mlsrd-hid stamping (feat_mls_redesign.js:145) and
 *     not the #mlsRdTop mount: it is one computed property —
 *     #appHeader.mlsRdHdr carries `backdrop-filter`, which makes the header
 *     BOTH the containing block for every position:fixed descendant AND a
 *     stacking context at z-index 6000. #opPrepModal is fixed at z-index 9400
 *     at BODY level, so nothing inside the header can paint over the room,
 *     whatever z-index it bids. This suite measures the property, measures the
 *     ordering, and measures the CONSEQUENCE with two identical buttons: the
 *     header-mounted one never answers a click at its own centre while the
 *     room is open; #mlsOpHome always does.
 *
 *  2. THE HIT TEST. Three points — the button's own centre, the day title's
 *     first painted character past the reserved lane, and the previous-day
 *     arrow — in four room states (list / one note / empty day / templates) at
 *     five widths. The button must answer at point 1 and must cover neither of
 *     the other two.
 *
 *  3. QUIET, NEVER DISABLED. On the boot tab the button dims; it is still
 *     enabled, still hit-testable, and pressing it still closes the room and
 *     lands on that tab. A disabled primary is what opnote-day-4.0.0 exists to
 *     remove and this must not reintroduce one.
 *
 *  4. HOME IS THE BOOT TAB, CLICKED. Walk to another tab, open the room, press
 *     Home: the room closes and the BOOT tab is the one marked on — not the
 *     tab the doctor wandered to, and not showView('visit').
 *
 *  5. IT NEVER WRITES #mlsRdTitle. The header title has one owner
 *     (feat_mls_redesign's syncTitle) and this block is not a second one.
 *
 *  6. REACH. No visible control in the room is under 40x40 in any state at any
 *     width. ph-tap-1.0.0's floor is @media (max-width:760px), so seven
 *     controls on the fill surface were under every touch floor on the laptop
 *     the owner actually operates from.
 *
 *  7. THE GLOW NEVER LANDS ON A SUB-40 CONTROL. On the fill screen exactly one
 *     control is lit, it is labelled, enabled, and at least 40x40 — the rule
 *     that "a labelled >= 40px sibling that advances the step wins over a
 *     glyph", asserted at every width rather than at one.
 *
 * No login, no network, no PHI — synthetic names only.
 */

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const DAY = '2026-08-17';        /* 17 patients */
const DAY_NEXT = '2026-08-18';   /* 3 patients  */
const DAY_PREV = '2026-08-16';   /* none        */
const WIDTHS = [[1440, 900], [1280, 860], [1024, 800], [768, 1024], [390, 844]];
const FLOOR = 40;

let checks = 0;
function ok(value, message) { assert.ok(value, message); checks++; }
function eq(actual, expected, message) { assert.strictEqual(actual, expected, message); checks++; }

/* ===================================================== PART 1: static ===== */
{
  const read = (n) => fs.readFileSync(path.join(root, n), 'utf8');
  const a = read('1pScribeFlow.html');
  const b = read('1p/index.html');
  for (const [name, src] of [['1pScribeFlow.html', a], ['1p/index.html', b]]) {
    for (const block of ['opnote-home-1.0.0', 'opnote-reach-1.0.0']) {
      eq(src.split('<!-- ===== ' + block).length - 1, 1, `${name}: ${block} must open exactly once`);
      eq(src.split('<!-- ===== end ' + block).length - 1, 1, `${name}: ${block} must close exactly once`);
    }
    const span = src.slice(src.indexOf('<!-- ===== opnote-home-1.0.0'),
      src.indexOf('<!-- ===== end opnote-reach-1.0.0'));

    /* THE HEADER'S TITLE HAS ONE OWNER. */
    ok(!/mlsRdTitle['"]?\s*\)\s*\.\s*textContent\s*=/.test(span) && span.indexOf("getElementById('mlsRdTitle').textContent =") < 0,
      `${name}: the Home block writes #mlsRdTitle — feat_mls_redesign's syncTitle is its only owner`);

    /* HOME IS A CLICK ON THE BOOT TAB, and showView is only the last-resort
       fallback for a page with no nav at all. */
    ok(/\.click\(\)/.test(span), `${name}: the Home block never clicks the boot tab`);
    ok(span.indexOf(".mainnav .navtab.on") > 0,
      `${name}: the Home block no longer reads the boot tab off the nav`);

    /* IT MUST NOT MOUNT INTO THE HEADER. That is the measured trap (see the
       block's own comment and PART 2A below); a future edit that "tidies" the
       mount back into #mlsRdTop silently loses the button behind the room. */
    ok(span.indexOf("insertBefore(b, m.firstChild)") > 0,
      `${name}: the Home button is no longer mounted into #opPrepModal`);
    for (const host of ['mlsRdTop', 'appHeader']) {
      ok(!new RegExp("getElementById\\('" + host + "'\\)").test(span),
        `${name}: the Home block reaches for #${host} — a control inside the header can never paint over the room (backdrop-filter makes it a z-index 6000 stacking context)`);
    }

    /* the room's own controls are DRIVEN, never re-implemented */
    for (const forbidden of ['aiCallRaw', 'fetch(', 'saveNotes(', 'opPrepSave(']) {
      ok(span.indexOf(forbidden) < 0,
        `${name}: the Home/reach blocks call ${forbidden} — they must drive the app's own controls only`);
    }

    /* THE COMMENTS MUST CLOSE, in both directions: an HTML comment that never
       terminates swallows the <style> that follows it, and the rules simply
       never apply — silently. */
    for (const block of ['opnote-home-1.0.0', 'opnote-reach-1.0.0']) {
      const from = src.indexOf('<!-- ===== ' + block);
      const to = src.indexOf('<!-- ===== end ' + block);
      const s = src.slice(from, to);
      ok(s.indexOf('<style') > s.indexOf('-->'),
        `${name}: ${block}'s opening HTML comment is not closed before its <style> — the whole stylesheet is inside the comment`);
      const styleTxt = s.slice(s.indexOf('<style'), s.indexOf('</style>'));
      eq((styleTxt.match(/\/\*/g) || []).length, (styleTxt.match(/\*\//g) || []).length,
        `${name}: ${block}'s stylesheet has unbalanced comment markers`);
    }
  }
  /* the twins carry the same blocks, byte for byte */
  const sliceOf = (s) => s.slice(s.indexOf('<!-- ===== opnote-home-1.0.0'),
    s.indexOf('<!-- ===== end opnote-reach-1.0.0'));
  eq(sliceOf(a), sliceOf(b), 'the twins carry different opnote-home/opnote-reach blocks');
}

/* ==================================================== PART 2: runtime ===== */

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml'
};
function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/') p = '/1pScribeFlow.html';
      const file = path.resolve(root, '.' + p);
      if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
      fs.readFile(file, (err, buf) => {
        if (err) { res.writeHead(404); res.end('x'); return; }
        res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
        res.end(buf);
      });
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }));
  });
}

/* Injected into the page. Synthetic names only. */
function harness(days) {
  var DAY = days.DAY, DAY_NEXT = days.DAY_NEXT;
  var NAMES = ['Ada Sample', 'Bo Sample', 'Cy Sample', 'Dee Sample', 'Eli Sample', 'Fay Sample',
    'Gus Sample', 'Hal Sample', 'Ivy Sample', 'Jo Sample', 'Kit Sample', 'Lu Sample',
    'Max Sample', 'Nia Sample', 'Oz Sample', 'Pia Sample', 'Quin Sample'];
  var LATER = ['Yas Sample', 'Zed Sample', 'Ann Sample'];
  var PROCS = ['Lumbar medial branch block', 'Right L4-L5 transforaminal epidural steroid injection',
    'Radiofrequency ablation, lumbar facet', 'Sacroiliac joint injection'];
  function visible(el) {
    if (!el) return false;
    var r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    var cs = getComputedStyle(el);
    return !(cs.visibility === 'hidden' || cs.display === 'none' || cs.opacity === '0');
  }
  function pt(n, i) {
    return { id: 'syn-' + i, name: n, dob: '19' + (60 + (i % 30)) + '-01-0' + ((i % 9) + 1),
      mrn: 'MRN' + (100000 + i), athenaId: String(900000 + i), notes: [], visits: [] };
  }
  window.__hr = {
    visible: visible,
    seed: function () {
      var all = NAMES.concat(LATER), out = {};
      try {
        setTemplates(PROCS.map(function (p, i) {
          return { id: 'syn-t' + i, name: p, body: 'PROCEDURE: ' + p + '\nFINDINGS: [[findings]]', kind: 'op' };
        }));
        localStorage.setItem(uns('useTemplates'), '1');
      } catch (e) { out.tplErr = String(e && e.message); }
      try { savePatients(all.map(pt)); out.patients = getPatients().length; }
      catch (e2) { out.ptErr = String(e2 && e2.message); }
      var appts = NAMES.map(function (n, i) {
        return { id: 'appt-' + i, name: n, patientId: 'syn-' + i, patient_external_id: 'syn-' + i,
          appt_date: DAY, start_at: DAY + 'T' + (8 + (i % 9) < 10 ? '0' : '') + (8 + (i % 9)) + ':' + (i % 2 ? '30' : '00') + ':00',
          reason: PROCS[i % PROCS.length], providerName: 'Sample Provider, MD' };
      }).concat(LATER.map(function (n, k) {
        var i = NAMES.length + k;
        return { id: 'appt-' + i, name: n, patientId: 'syn-' + i, patient_external_id: 'syn-' + i,
          appt_date: DAY_NEXT, start_at: DAY_NEXT + 'T1' + k + ':00:00',
          reason: PROCS[k % PROCS.length], providerName: 'Sample Provider, MD' };
      }));
      window._calAppts = appts;
      out.appts = appts.length;
      try { renderPatients(); } catch (e4) {}
      return out;
    },
    open: function (day) { try { window.openOpPrep(day); } catch (e) {} },
    draft: function (i, blanks) {
      try {
        var r = window._opPrep[i];
        r.gen = true;
        r.note = 'PROCEDURE: ' + r.proc + '\nFINDINGS: ' + (blanks ? '[[findings]]\nNPI: [[npi]]' : 'normal') + '\n';
        if (typeof window.opPrepRender === 'function') window.opPrepRender();
        return true;
      } catch (e) { return String(e && e.message); }
    },
    /* ---- 2A: the measured trap ------------------------------------- */
    trap: function () {
      var hdr = document.getElementById('appHeader');
      var modal = document.getElementById('opPrepModal');
      var hc = hdr ? getComputedStyle(hdr) : null;
      var mc = modal ? getComputedStyle(modal) : null;
      /* a control mounted the way the two earlier attempts mounted it */
      var probe = document.getElementById('mlsOpHomeTrapProbe');
      if (!probe) {
        probe = document.createElement('button');
        probe.id = 'mlsOpHomeTrapProbe'; probe.type = 'button'; probe.textContent = 'x';
        probe.style.cssText = 'position:fixed;left:8px;top:8px;width:44px;height:44px;z-index:2147483000;box-sizing:border-box';
      }
      var host = document.getElementById('mlsRdTop') || hdr;
      if (host && probe.parentNode !== host) host.insertBefore(probe, host.firstChild);
      var pr = probe.getBoundingClientRect();
      var answersOwnCentre = function (el) {
        if (!el) return null;
        var r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return false;
        var n = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
        return n === el;
      };
      var home = document.getElementById('mlsOpHome');
      return {
        headerBackdrop: hc ? String(hc.backdropFilter || hc.webkitBackdropFilter || 'none') : '',
        headerZ: hc ? hc.zIndex : '', headerPos: hc ? hc.position : '',
        modalZ: mc ? mc.zIndex : '', modalPos: mc ? mc.position : '',
        /* left:8px honoured against the VIEWPORT would be x=8 */
        probeX: Math.round(pr.left), probeW: Math.round(pr.width), probeH: Math.round(pr.height),
        probeAnswers: answersOwnCentre(probe),
        homeAnswers: answersOwnCentre(home),
        hosted: host ? (host.id || host.tagName) : ''
      };
    },
    dropTrap: function () {
      var p = document.getElementById('mlsOpHomeTrapProbe');
      if (p && p.parentNode) p.parentNode.removeChild(p);
      return true;
    },
    /* ---- 2B: three points ------------------------------------------- */
    points: function () {
      function at(x, y) {
        var e = document.elementFromPoint(Math.round(x), Math.round(y));
        return e ? (e.id || String(e.className).slice(0, 24) || e.tagName) : '';
      }
      var b = document.getElementById('mlsOpHome');
      var t = document.getElementById('mlsOpDayTitle');
      var p = document.getElementById('mlsOpnPrevDay');
      var rb = b && b.getBoundingClientRect();
      var rt = t && t.getBoundingClientRect();
      var rp = p && p.getBoundingClientRect();
      return {
        w: rb ? Math.round(rb.width) : 0, h: rb ? Math.round(rb.height) : 0,
        p1: rb && rb.width ? at(rb.left + rb.width / 2, rb.top + rb.height / 2) : '',
        /* the title's first painted character sits one lane in */
        p2: rt && rt.width ? at(rt.left + 56, rt.top + rt.height / 2) : 'NO-TITLE',
        p3: rp && rp.width ? at(rp.left + rp.width / 2, rp.top + rp.height / 2) : 'NO-STEPPER',
        st: window.__mlsOpHome ? window.__mlsOpHome.status() : null
      };
    },
    /* ---- 2F: every control's reach ---------------------------------- */
    small: function () {
      var modal = document.getElementById('opPrepModal');
      if (!modal) return null;
      var CTRL = 'button,a[href],input:not([type=hidden]),select,[role=button],[role=tab]';
      return Array.prototype.slice.call(modal.querySelectorAll(CTRL))
        .filter(visible)
        /* the per-patient rows are a list, not a control strip, and the room's
           own suite already pins their height */
        .filter(function (e) { return !(e.closest && e.closest('.mlsOpDayCard')); })
        .map(function (e) {
          var r = e.getBoundingClientRect(), cs = getComputedStyle(e);
          /* WHERE it is, not just that it is small: a control that is short
             because it lives on a surface this block does not reach is a
             different finding from one whose floor did not apply, and a bare
             id cannot tell the two apart. */
          var chain = [], n = e, guard = 0;
          while (n && n !== document.body && guard++ < 8) {
            n = n.parentElement; if (!n) break;
            chain.push((n.id ? '#' + n.id : n.tagName) + (n.className ? '.' + String(n.className).split(' ')[0] : ''));
          }
          return { id: e.id || '', w: Math.round(r.width), h: Math.round(r.height),
            minH: cs.minHeight, pad: cs.paddingTop + '/' + cs.paddingBottom, fs: cs.fontSize,
            where: chain.slice(0, 4).join(' < '),
            t: String(e.getAttribute('aria-label') || e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 34) };
        })
        .filter(function (c) { return c.w < 40 || c.h < 40; });
    },
    /* ---- 2G: what the one glow is on -------------------------------- */
    glow: function () {
      return Array.prototype.slice.call(document.querySelectorAll('#opPrepModal [data-mls-next="1"]'))
        .map(function (e) {
          var r = e.getBoundingClientRect();
          return { id: e.id || '', w: Math.round(r.width), h: Math.round(r.height),
            dis: !!e.disabled, vis: visible(e),
            named: String(String(e.textContent || '').replace(/\s+/g, ' ').trim() || e.getAttribute('aria-label') || '').slice(0, 40) };
        });
    },
    tabOn: function () { var t = document.querySelector('.mainnav .navtab.on'); return t ? (t.id || '') : ''; },
    rdTitle: function () { var t = document.getElementById('mlsRdTitle'); return t ? String(t.textContent || '').trim() : ''; },
    roomOpen: function () { var m = document.getElementById('opPrepModal'); return !!(m && m.classList.contains('show')); }
  };
}

async function bootShell(page, url) {
  await page.goto(url, { waitUntil: 'load', timeout: 90000 });
  await page.waitForTimeout(2500);
  await page.evaluate(() => (typeof window.__mlsEnsureUiBundle === 'function' ? window.__mlsEnsureUiBundle() : null));
  await page.waitForFunction(() => !!window.__mlsSimpleLayer, null, { timeout: 60000 });
  await page.waitForTimeout(6000);
  await page.evaluate(() => {
    const a = document.getElementById('authScreen'); if (a) a.style.display = 'none';
    const s = document.getElementById('appScreen'); if (s) s.style.display = '';
    /* .modal sits at opacity 0 in a non-compositing tab */
    const st = document.createElement('style');
    st.textContent = '.modal-bg.show,.modal-bg.show .modal{opacity:1!important}';
    document.head.appendChild(st);
  });
  await page.evaluate(() => { window.__mlsHarnessAccountEmail = 'opnote-home@mlsscribe.test'; });
}

async function runtime() {
  const { srv, port } = await serve();
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e.message).slice(0, 160)));
  const measured = {};

  try {
    await bootShell(page, `http://127.0.0.1:${port}/1pScribeFlow.html`);
    await page.evaluate(harness, { DAY, DAY_NEXT });
    /* The store migration can land after boot; the seed is retried rather than
       asserted once, because a half-seeded roster measures the harness. */
    let seeded = await page.evaluate(() => window.__hr.seed());
    for (let k = 0; k < 5 && seeded.patients !== 20; k++) {
      await page.waitForTimeout(1500);
      seeded = await page.evaluate(() => window.__hr.seed());
    }
    eq(seeded.patients, 20, `the synthetic roster did not land: ${JSON.stringify(seeded)}`);
    eq(seeded.appts, 20, `the synthetic schedule did not land: ${JSON.stringify(seeded)}`);
    await page.evaluate(() => { try { window.__mlsAutoDraft.setEnabled(false); } catch (e) {} });
    await page.evaluate(() => window.__mlsSimpleLayer.set('calm'));

    const bootTab = await page.evaluate(() => window.__hr.tabOn());
    ok(!!bootTab, 'no tab is marked .on at boot, so "home" has nothing to mean');
    measured.bootTab = bootTab;

    async function setup(opts) {
      opts = opts || {};
      await page.evaluate((d) => window.__hr.open(d), opts.day || DAY);
      await page.waitForTimeout(1500);
      if (opts.draft != null) {
        await page.evaluate((a) => window.__hr.draft(a.i, a.b), { i: opts.draft, b: !!opts.blanks });
        await page.waitForTimeout(900);
      }
      if (opts.note != null) {
        await page.evaluate((i) => window.__mlsOpDay.openNote(i), opts.note);
        await page.waitForTimeout(1100);
      }
      if (opts.templates) {
        await page.evaluate(() => { const b = document.getElementById('mlsOpnRailTpl'); if (b) b.click(); });
        await page.waitForTimeout(1500);
      }
      await page.waitForTimeout(400);
    }

    /* ================================================================
     * 2A. THE THIRD MECHANISM — measured, and its consequence measured
     * ============================================================== */
    await setup({});
    const trap = await page.evaluate(() => window.__hr.trap());
    measured.trap = trap;
    ok(/blur|saturate/.test(trap.headerBackdrop),
      `#appHeader no longer carries a backdrop-filter (read "${trap.headerBackdrop}") — if feat_mls_redesign dropped it, re-measure before moving this button, but do NOT assume the header became safe`);
    ok(Number(trap.headerZ) > 0 && Number(trap.headerZ) < Number(trap.modalZ),
      `the header's stacking context (z-index ${trap.headerZ}) is no longer below the room (z-index ${trap.modalZ}) — re-measure`);
    eq(trap.probeAnswers, false,
      `a button mounted in ${trap.hosted} at z-index 2147483000 DID answer a click at its own centre while the room was open — the measured trap this block exists for has changed and the mount decision must be re-derived`);
    eq(trap.homeAnswers, true,
      '#mlsOpHome does not answer a click at its own centre while the room is open — it is covered');
    ok(trap.probeX !== 8,
      `the header-mounted probe honoured left:8px against the viewport (x=${trap.probeX}) — the backdrop-filter containing block is gone; re-measure the mount`);
    await page.evaluate(() => window.__hr.dropTrap());

    /* ================================================================
     * 2B. THE HIT TEST — three points, four states, five widths
     * ============================================================== */
    const STATES = [['list', {}], ['note', { draft: 3, note: 3 }], ['empty', { day: DAY_PREV }],
      ['templates', { templates: true }]];
    const hits = [];
    for (const [nm, opts] of STATES) {
      await setup(opts);
      for (const [w, h] of WIDTHS) {
        await page.setViewportSize({ width: w, height: h });
        await page.waitForTimeout(750);
        const p = await page.evaluate(() => window.__hr.points());
        hits.push({ nm, w, h, p });
        eq(p.w, 44, `${nm} @${w}: the Home button is ${p.w}px wide, not 44`);
        eq(p.h, 44, `${nm} @${w}: the Home button is ${p.h}px tall, not 44`);
        eq(p.p1, 'mlsOpHome',
          `${nm} @${w}: a click at the Home button's own centre reaches "${p.p1}" — it is covered`);
        if (p.p2 !== 'NO-TITLE') {
          eq(p.p2, 'mlsOpDayTitle',
            `${nm} @${w}: the day title's first painted character is under "${p.p2}" — the reserved lane is not reserved`);
        }
        if (p.p3 !== 'NO-STEPPER') {
          eq(p.p3, 'mlsOpnPrevDay',
            `${nm} @${w}: the previous-day arrow is under "${p.p3}" — the same collision the room's own ✕ note describes`);
        }
        eq(p.st.clearsStepper, true, `${nm} @${w}: the Home button overlaps the day switcher`);
        eq(p.st.disabled, false, `${nm} @${w}: the Home button is disabled — quiet, never disabled`);
        eq(p.st.mounted, true, `${nm} @${w}: the Home button is not a child of #opPrepModal`);
      }
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.waitForTimeout(400);
    }
    measured.hitPoints = hits.length * 3;

    /* ================================================================
     * 2C. QUIET, NEVER DISABLED — and it still works while quiet
     * ============================================================== */
    await setup({});
    const quiet = await page.evaluate(() => {
      const b = document.getElementById('mlsOpHome');
      const cs = getComputedStyle(b);
      return { quiet: window.__mlsOpHome.status().quiet, disabled: !!b.disabled,
        pointer: cs.pointerEvents, opacity: cs.opacity, onTab: window.__hr.tabOn() };
    });
    measured.quiet = quiet;
    eq(quiet.onTab, bootTab, 'the harness is not on the boot tab, so "already home" proves nothing');
    eq(quiet.quiet, true, 'the Home button is not quiet while the app is already on the boot tab');
    eq(quiet.disabled, false, 'the Home button is DISABLED while already home — it must be quiet, not dead');
    ok(quiet.pointer !== 'none', 'the quiet Home button is not hit-testable (pointer-events:none)');
    ok(Number(quiet.opacity) > 0.3, `the quiet Home button is ${quiet.opacity} opaque — quiet, not invisible`);
    await page.evaluate(() => document.getElementById('mlsOpHome').click());
    await page.waitForTimeout(1600);
    eq(await page.evaluate(() => window.__hr.roomOpen()), false,
      'pressing the quiet Home button did not close the room — a quiet control still works');
    eq(await page.evaluate(() => window.__hr.tabOn()), bootTab,
      'pressing the quiet Home button left a different tab on');

    /* ================================================================
     * 2D. HOME IS THE BOOT TAB — from anywhere
     * ============================================================== */
    const rdBefore = await page.evaluate(() => window.__hr.rdTitle());
    const walked = await page.evaluate(() => {
      const t = Array.prototype.slice.call(document.querySelectorAll('.mainnav .navtab'))
        .filter((b) => !b.classList.contains('on') && String(b.getAttribute('onclick') || '').indexOf('showView') === 0)[0];
      if (!t) return '';
      t.click();
      return t.id || '';
    });
    await page.waitForTimeout(1500);
    ok(!!walked, 'the harness could not walk to a second tab, so "home from anywhere" proves nothing');
    const nowOn = await page.evaluate(() => window.__hr.tabOn());
    ok(nowOn !== bootTab, `walking to ${walked} left ${nowOn} on — the walk did not happen`);
    await setup({ draft: 3, note: 3 });
    const away = await page.evaluate(() => window.__mlsOpHome.status());
    measured.away = { quiet: away.quiet, homeTab: away.homeTab, onTab: away.onTab };
    eq(away.quiet, false, `the Home button is still quiet while the app is on ${away.onTab}, not on ${away.homeTab}`);
    eq(away.homeTab, bootTab,
      `the Home button now believes home is ${away.homeTab} — it followed the doctor instead of staying on the boot tab`);
    await page.evaluate(() => document.getElementById('mlsOpHome').click());
    await page.waitForTimeout(1800);
    eq(await page.evaluate(() => window.__hr.roomOpen()), false, 'pressing Home did not close the room');
    eq(await page.evaluate(() => window.__hr.tabOn()), bootTab,
      'pressing Home did not land on the boot tab');

    /* ================================================================
     * 2E. IT NEVER WRITES #mlsRdTitle
     *
     * The header title is feat_mls_redesign's syncTitle(), which derives it
     * from the dock's active destination and the nav — so its value legitimately
     * changes across a navigation ("Patients" the tab, "Patient" the
     * destination). Pinning it to a constant would pin ANOTHER lane's wording
     * and fail the first time that lane rewords a destination.
     *
     * The property that actually belongs to this block is INDISTINGUISHABILITY:
     * arriving home through the Home button must leave the header title exactly
     * where arriving home by clicking the tab does. If this block wrote the
     * title, the two would differ. The static half of this suite proves the
     * block contains no writer at all; this proves the observable.
     * ============================================================== */
    const rdViaHome = await page.evaluate(() => window.__hr.rdTitle());
    await page.evaluate((away) => {
      const t = document.getElementById(away);
      if (t) t.click();
    }, walked);
    await page.waitForTimeout(1400);
    await page.evaluate((home) => {
      const t = document.getElementById(home);
      if (t) t.click();
    }, bootTab);
    await page.waitForTimeout(1400);
    const rdViaTab = await page.evaluate(() => window.__hr.rdTitle());
    measured.rdTitle = { atBoot: rdBefore, viaHome: rdViaHome, viaTab: rdViaTab };
    eq(await page.evaluate(() => window.__hr.tabOn()), bootTab,
      'the control walk did not end on the boot tab, so the title comparison proves nothing');
    eq(rdViaHome, rdViaTab,
      `arriving home through the Home button left #mlsRdTitle reading "${rdViaHome}" while clicking the tab leaves it "${rdViaTab}" — this block is writing the header title, which has one owner`);
    ok(rdViaHome.length > 0, 'the header title is empty after a Home press');
    ok(rdViaHome.toLowerCase().indexOf('home') < 0,
      `#mlsRdTitle reads "${rdViaHome}" — this block put its own word in the header title`);

    /* ================================================================
     * 2F. REACH — nothing in the room is under 40x40, anywhere
     * ============================================================== */
    const smalls = [];
    for (const [nm, opts] of [['list', {}], ['note', { draft: 3, note: 3 }],
      ['blanks', { draft: 4, blanks: true, note: 4 }], ['empty', { day: DAY_PREV }]]) {
      await setup(opts);
      for (const [w, h] of WIDTHS) {
        await page.setViewportSize({ width: w, height: h });
        await page.waitForTimeout(750);
        const s = await page.evaluate(() => window.__hr.small());
        smalls.push({ nm, w, n: (s || []).length });
        eq((s || []).length, 0,
          `${nm} @${w}x${h}: ${(s || []).length} control(s) in the room are under ${FLOOR}x${FLOOR}: ${JSON.stringify(s)}`);
      }
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.waitForTimeout(400);
    }
    measured.reachChecked = smalls.length;

    /* ================================================================
     * 2G. THE ONE GLOW, AND IT IS NEVER A GLYPH
     * ============================================================== */
    await setup({ draft: 4, blanks: true, note: 4 });
    for (const [w, h] of WIDTHS) {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(1100);
      const lit = await page.evaluate(() => window.__hr.glow());
      eq(lit.length, 1,
        `the fill screen @${w}x${h} lights ${lit.length} controls, not one: ${JSON.stringify(lit)}`);
      const g = lit[0];
      eq(g.dis, false, `the lit control @${w} is disabled: ${JSON.stringify(g)}`);
      eq(g.vis, true, `the lit control @${w} is not visible: ${JSON.stringify(g)}`);
      ok(g.w >= FLOOR && g.h >= FLOOR,
        `the glow @${w} is on a ${g.w}x${g.h} control ("${g.named}") — a labelled >= ${FLOOR}px sibling advances the same step`);
      ok(g.named.replace(/[^A-Za-z]/g, '').length >= 3,
        `the glow @${w} is on a control with no words on it ("${g.named}") — that is the glyph the owner photographed`);
      measured['glow@' + w] = g.id + ' ' + g.w + 'x' + g.h;
    }
    await page.setViewportSize({ width: 1440, height: 900 });

    eq(pageErrors.length, 0, `the room raised ${pageErrors.length} page errors: ${JSON.stringify(pageErrors.slice(0, 4))}`);
  } finally {
    await browser.close();
    srv.close();
  }
  return measured;
}

runtime().then((m) => {
  console.log('MEASURED ' + JSON.stringify(m, null, 1));
  console.log(`1p-opnote-home-and-reach: ${checks} checks passed`);
}).catch((e) => {
  console.error('1p-opnote-home-and-reach FAILED after ' + checks + ' checks');
  console.error(e && e.message ? e.message : e);
  process.exit(1);
});
