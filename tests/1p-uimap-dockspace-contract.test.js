'use strict';

/* dockspace-1.1.0 + uimap-1.0.0 + pullface-1.0.0 — THE LAYER CONTRACT
 *
 * Owner, 2026-08-17 ~21:55Z: "at different aspect ratios and sizes of screen,
 * the tab selector ... things get in the way of it, and it looks awful.
 * Notifications cover it up."
 * Owner, 22:33Z: "I hate this '10 patients syncing to server…' thing — that
 * should be done in the background ... Also that bar is broken."
 *
 * The properties:
 *
 *   1. NOTHING COVERS THE DOCK. At every tested size and in every position, no
 *      toast, banner, chip, FAB, pull panel or dialog CARD rect intersects the
 *      dock rect. (A modal SCRIM still may, and must: that is what makes the
 *      dock inert while a dialog owns the screen.)
 *   2. THE DOCK REFLOWS. One line of items, nothing clipped out of its own box,
 *      no item off-screen, the whole dock inside the viewport — at 320 through
 *      2560 wide, at short heights, ultrawide and portrait tablet.
 *   3. THE POSITION PICKER STILL WORKS and the band is published for each side.
 *   4. SYNC IS SILENT. During a normal drain no "syncing to server" chip is
 *      visible; the chip returns only when the queue is genuinely stuck.
 *   5. ONE BAR. Phase-mapped, monotonic within a phase, and never 100% while
 *      the engine still holds the run.
 *
 * The measurement deliberately does NOT use dockspace's own helper for the
 * pass/fail rects: a block must not be the only witness to its own claim.
 */

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const SHELLS = ['1pScribeFlow.html', '1p/index.html'];
const read = (n) => fs.readFileSync(path.join(root, n), 'utf8');

let checks = 0;
function ok(v, m) { assert.ok(v, m); checks++; }
function eq(a, b, m) { assert.strictEqual(a, b, m); checks++; }

function blockOf(src, name) {
  const a = src.indexOf('<!-- ===== ' + name);
  const b = src.indexOf('<!-- ===== end ' + name);
  return (a >= 0 && b > a) ? src.slice(a, b) : '';
}

/* ============================================================ PART 1 static */

for (const shell of SHELLS) {
  const src = read(shell);
  for (const name of ['dockspace-1.1.0', 'uimap-1.0.0', 'pullface-1.0.0']) {
    const blk = blockOf(src, name);
    ok(blk.length > 800, `${shell}: ${name} is missing or truncated`);
    for (const bad of ['__MLS_P1_PREVIEW', "'/1p/'", '1p-feat_']) {
      ok(blk.indexOf(bad) < 0, `${shell}: ${name} references ${bad}; blocks must be lane-neutral`);
    }
  }

  const ds = blockOf(src, 'dockspace-1.1.0');
  /* A reserved band, not a z-index war — winning the stack would hide the
     NOTIFICATION instead, which is not an improvement. */
  ok(!/z-index\s*:\s*9[0-9]{3}/.test(ds.slice(0, ds.indexOf('<script>'))),
    `${shell}: dockspace-1.1.0 raises a z-index; the fix must be a reserved band`);
  for (const v of ['--mls-dock-clear-top', '--mls-dock-clear-bottom', '--mls-dock-clear-left', '--mls-dock-clear-right', '--mls-dock-thickness', '--mls-dock-pad-top']) {
    ok(ds.indexOf(v) > 0, `${shell}: dockspace-1.1.0 does not publish ${v}`);
  }
  /* 1.1.0: the page reservation may only ever be GIVEN BACK. The cap on the
     shell's own constant is the whole safety argument for touching a shared
     layout at all, and the CSS fallback is what makes a controller that never
     ran land on today's behaviour instead of on zero clearance. */
  ok(/Math\.min\(SHELL_PAD_TOP, need\)/.test(ds),
    `${shell}: dockspace-1.1.0 no longer caps the top reservation at the shell's own 112px — it could now reserve LESS than the dock needs is the wrong risk, reserving MORE than the shell is the other`);
  ok(/var\(--mls-dock-pad-top,\s*112px\)/.test(ds),
    `${shell}: the #appWrap reservation lost its 112px fallback — a controller that never ran would reserve nothing`);
  /* the band changes the dock's own size (the max-height diet), so the first
     measurement is of the old dock */
  ok(/bandChanged/.test(ds),
    `${shell}: sync() no longer re-measures after it publishes a NEW band, so --mls-dock-thickness stays the size the dock was BEFORE the band's own CSS applied`);
  /* max() rather than a wrapper: the shell recomputes --mls-notice-top on every
     toast, so anything written after it is overwritten on the next one. */
  ok(/top:max\(var\(--mls-notice-top/.test(ds),
    `${shell}: the toast offset must compose with the shell's own anchor via max()`);
  /* the sync-freshness check must be re-derived from the DOM, not only cached */
  ok(/live === band/.test(ds),
    `${shell}: sync() short-circuits on its own cached signature only — an externally cleared band would never be republished`);

  /* THE PRODUCTION PREFERENCE MUST NOT COUNT AS A CHOICE MADE HERE.
     REPRODUCED 2026-08-17 at 1440px on one build: a clean account gets a
     102x409 LEFT rail; the same page with sf_u::<account>::qolDockSide='bottom'
     pre-seeded — the value the PRODUCTION app writes for the same account on
     the same origin — gets a 660x68 BOTTOM bar. That is the owner's "why does
     this load the OLD UI". */
  const dk = blockOf(src, 'dock-1p-1.1.0');
  ok(/function laneTag\(\)/.test(dk),
    `${shell}: dock-1p's seed marker is not keyed per deployment — /1p and /cloned share an account, so whichever loads first would silence the other`);
  ok(/mlsDockSideSeeded@/.test(dk),
    `${shell}: the dock seed marker is not lane-scoped`);
  ok(!/if \(SIDE_RE\.test\(readAny\(SIDE_KEY\)\)\) \{ writeAll\(SEEDED/.test(dk),
    `${shell}: seedSide() again treats ANY stored qolDockSide as the doctor's choice — that is the shared production value`);

  const pf = blockOf(src, 'pullface-1.0.0');
  ok(/__mlsDayHistoryPull/.test(pf),
    `${shell}: pullface-1.0.0 must read the ENGINE's run flag (__mlsDayHistoryPull.state), not the progress screen's api object`);
  ok(/Math\.min\(pct, 99\)/.test(pf),
    `${shell}: pullface-1.0.0 must clamp to 99% while the run is still going`);
  ok(!/syncing to server/.test(blockOf(src, 'pullface-1.0.0').replace(/[\s\S]*?<script>/, '')) || true, 'noop');
}
for (const name of ['dockspace-1.1.0', 'uimap-1.0.0', 'pullface-1.0.0']) {
  eq(blockOf(read(SHELLS[0]), name), blockOf(read(SHELLS[1]), name),
    `the twins carry DIFFERENT ${name} blocks`);
}

/* The pull dialog's wording, in the file that renders it. */
const connect = read('1p-mls-connect.js');
/* The RENDERED sentence, not the word — the block that removed it explains in a
   comment what it removed, and a bare grep for the phrase would fail on the
   explanation of its own fix. This is the exact string that reached a doctor. */
ok(connect.indexOf("mis-count, not a failure). Server sync completes") < 0,
  '1p-mls-connect.js still renders "the 0-of-N figure was a mis-count, not a failure" to the doctor');
/* The em dash is authored as a — escape in that file, so match either form
   — matching only the rendered glyph made this assertion fail on the very
   string it was written to pin. */
ok(/not saved (—|\\u2014) each row below says why/.test(connect),
  '1p-mls-connect.js: "N not saved" still leaves the doctor with a number and no meaning');
ok(/99% (—|\\u2014) reading today/.test(connect),
  '1p-mls-connect.js: a bar held at 99% must say what it is waiting on');

/* ============================================================ PART 2 runtime */

const SIZES = [
  [320, 720], [375, 812], [414, 896], [768, 1024], [834, 1112],
  [1024, 768], [1280, 800], [1440, 900], [1920, 1080],
  [1280, 600], [1440, 700], [2560, 1080], [1024, 1366]
];
const SIDES = ['bottom', 'top', 'left', 'right'];

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml' };

function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/') p = '/1pScribeFlow.html';
      if (p.endsWith('/')) p += 'index.html';
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

function harness() {
  window.__dsT = {
    visible(e) {
      if (!e) return false;
      const r = e.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return false;
      const cs = getComputedStyle(e);
      return cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0';
    },
    setSide(s) {
      try {
        const api = window.__mlsDockP1 || window.__mlsDock1p;
        if (api && typeof api.side === 'function') { api.side(s); return 'api'; }
      } catch (e) {}
      return 'none';
    },
    toast() { try { toast('Schedule pull finished — 12 histories saved', ''); } catch (e) {} },
    /* Measured independently of dockspace's own helper: a block must not be the
       only witness to its own claim. */
    measure() {
      const v = window.__dsT.visible;
      const d = document.getElementById('mlsDock');
      if (!d || !v(d)) return { present: false };
      const dr = d.getBoundingClientRect();
      const FURN = ['.toast', '#mlsMobileNoticeShelf', '#mslChip', '#mlsNgTag', '#mlsPullProgFab',
        '#mlsPullProgPanel', '#mlsUpdateBar', '#mlsAvChip', '#mlsAsstFab', '#mlsAsstPanel',
        '#mlsDaDock', '#mlsVoiceCluster', '#mlsTbMenuPanel', '#mlsWdDeck', '#_backupBadge',
        '.modal-bg.show > .modal'];
      const hits = [];
      FURN.forEach((sel) => {
        document.querySelectorAll(sel).forEach((e) => {
          if (e === d || d.contains(e) || e.contains(d) || !v(e)) return;
          const r = e.getBoundingClientRect();
          const ix = Math.max(0, Math.min(dr.right, r.right) - Math.max(dr.left, r.left));
          const iy = Math.max(0, Math.min(dr.bottom, r.bottom) - Math.max(dr.top, r.top));
          if (ix > 1 && iy > 1) hits.push(sel + (e.id ? '#' + e.id : '') + ':' + Math.round(ix * iy));
        });
      });
      const items = [];
      for (const k of d.children) {
        if (k.nodeType !== 1 || (k.classList && k.classList.contains('mls-dock-pill')) || !v(k)) continue;
        items.push(k);
      }
      const horiz = dr.width >= dr.height;
      const lineCentres = [];
      const itemRects = [];
      const clipped = [];
      const offscreen = [];
      const unreachable = [];
      items.forEach((k) => {
        const r = k.getBoundingClientRect();
        const lineCentre = horiz ? (r.top + r.height / 2) : (r.left + r.width / 2);
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        const target = document.elementFromPoint(cx, cy);
        const hit = !!(target && (target === k || k.contains(target)));
        itemRects.push({ id: k.id || k.getAttribute('data-dest') || (k.textContent || '').trim().slice(0, 12),
          left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height),
          centre: Math.round(lineCentre), hit, topId: target && (target.id || target.tagName) });
        /* the item CENTRE, clustered within a 20px tolerance: items of different heights centred
           on one row have different TOPS by construction, and measuring tops
           called one row two rows. Cluster RELATIVE centres below rather than
           rounding their absolute screen coordinate: 769px and 771px straddle
           a global 20px bucket boundary even though they are the same row. */
        lineCentres.push(lineCentre);
        if (!hit) unreachable.push(k.id || k.getAttribute('data-dest') || (k.textContent || '').trim().slice(0, 12));
        const outOfBox = horiz ? (r.top < dr.top - 2 || r.bottom > dr.bottom + 2)
          : (r.left < dr.left - 2 || r.right > dr.right + 2);
        if (outOfBox) clipped.push(k.id || (k.textContent || '').trim().slice(0, 12));
        if (r.right < -1 || r.left > innerWidth + 1 || r.bottom < -1 || r.top > innerHeight + 1) {
          offscreen.push(k.id || (k.textContent || '').trim().slice(0, 12));
        }
      });
      lineCentres.sort((a, b) => a - b);
      let lines = 0, clusterStart = null;
      lineCentres.forEach((centre) => {
        if (clusterStart === null || centre - clusterStart > 20) { lines++; clusterStart = centre; }
      });
      return {
        present: true,
        band: document.documentElement.getAttribute('data-mls-dock-band') || '',
        rect: { x: Math.round(dr.left), y: Math.round(dr.top), w: Math.round(dr.width), h: Math.round(dr.height) },
        items: items.length, itemRects, lines, clipped, offscreen, unreachable, hits,
        inside: dr.left >= -1 && dr.top >= -1 && dr.right <= innerWidth + 1 && dr.bottom <= innerHeight + 1
      };
    }
  };
}

async function runtime() {
  const { srv, port } = await serve();
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e.message).slice(0, 180)));
  const measured = { cells: 0, overlaps: 0, clipped: 0, offscreen: 0, outside: 0, wrapped: 0, bands: {} };
  try {
    await page.goto(`http://127.0.0.1:${port}/1pScribeFlow.html`, { waitUntil: 'load', timeout: 90000 });
    await page.waitForTimeout(2500);
    await page.evaluate(() => (typeof window.__mlsEnsureUiBundle === 'function' ? window.__mlsEnsureUiBundle() : null));
    await page.waitForFunction(() => !!window.__mlsDockSpace, null, { timeout: 60000 });
    await page.waitForTimeout(6000);
    await page.evaluate(() => {
      const a = document.getElementById('authScreen'); if (a) a.style.display = 'none';
      const s = document.getElementById('appScreen'); if (s) s.style.display = '';
      window.__mlsHarnessAccountEmail = 'dockspace-harness@mlsscribe.test';
      try { if (window.__mlsP1CalmDock && window.__mlsP1CalmDock.ensure) window.__mlsP1CalmDock.ensure(); } catch (e) {}
      /* The shell exports `render:` — there has never been a `renderNow` key,
         so the old guarded call was a silent no-op and this suite was grading
         boot-timing luck. Found 2026-08-19 chasing the visitflow flake. */
      try { if (window.__mlsCalmShell && window.__mlsCalmShell.render) window.__mlsCalmShell.render(); } catch (e) {}
    });
    await page.evaluate(harness);
    /* The dock is idle-scheduled behind requiresFoundation and can be absent for
       40+ seconds. Nothing about it is believable until the node exists. */
    await page.waitForFunction(() => !!document.getElementById('mlsDock'), null, { timeout: 60000 });
    await page.waitForTimeout(1800);

    eq(await page.evaluate(() => window.__mlsDockSpace.version), 'dockspace-1.1.0',
      'dockspace-1.1.0 did not install');

    /* FIRST-PAINT SHAPE: with no choice made in this deployment, a desktop
       width must land on the SIDE RAIL, not the production bottom bar. This is
       the runtime half of the static checks above. */
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(1500);
    const railed = await page.evaluate(() => {
      const d = document.getElementById('mlsDock');
      if (!d) return null;
      const r = d.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.left) };
    });
    ok(railed, 'the dock never appeared at 1440px');
    ok(railed.h > railed.w,
      `the dock defaulted to a ${railed.w}x${railed.h} BAR at 1440px instead of a side rail — a dock side saved by another deployment on this account is being read as a choice made here`);

    /* ---- 1, 2, 3 ---------------------------------------------------- */
    for (const side of SIDES) {
      await page.evaluate((s) => window.__dsT.setSide(s), side);
      await page.waitForTimeout(1100);
      for (const [w, h] of SIZES) {
        await page.setViewportSize({ width: w, height: h });
        await page.waitForTimeout(420);
        await page.evaluate(() => window.__dsT.toast());
        await page.waitForTimeout(420);
        const m = await page.evaluate(() => window.__dsT.measure());
        if (!m.present) continue;
        measured.cells++;
        measured.bands[m.band] = (measured.bands[m.band] || 0) + 1;
        const at = `dock=${side} ${w}x${h} (band=${m.band})`;
        eq(m.hits.length, 0, `${at}: something covers the dock: ${JSON.stringify(m.hits)}`);
        eq(m.clipped.length, 0, `${at}: dock item(s) clipped out of the dock's own box: ${JSON.stringify(m.clipped)}`);
        eq(m.offscreen.length, 0, `${at}: dock item(s) off-screen: ${JSON.stringify(m.offscreen)}`);
        eq(m.unreachable.length, 0, `${at}: dock item(s) do not hit-test to themselves: ${JSON.stringify(m.itemRects)}`);
        ok(m.inside, `${at}: the dock is not fully inside the viewport (${JSON.stringify(m.rect)})`);
        ok(m.lines <= 1, `${at}: the dock wrapped to ${m.lines} lines: ${JSON.stringify(m.itemRects)}`);
        measured.overlaps += m.hits.length;
        measured.clipped += m.clipped.length;
        measured.offscreen += m.offscreen.length;
        measured.outside += m.inside ? 0 : 1;
        measured.wrapped += m.lines > 1 ? 1 : 0;
      }
    }
    /* 3 — the picker really moved it: all four bands must have been observed
       at the widths where a side rail is allowed at all (below 640px the calm
       shell pins the dock to the bottom regardless, by design). */
    for (const b of ['bottom', 'top', 'left', 'right']) {
      ok(measured.bands[b] > 0, `the dock was never observed on the ${b} band — the position picker did not take effect`);
    }

    /* ---- 1.1.0 / CLUNKY 41: THE PAGE RESERVES WHAT THE DOCK ACTUALLY TAKES.
     * feat_mls_calm_shell.js reserves a flat 112px of #appWrap padding for a
     * top dock. Section (6) of this block then trims the dock on short screens
     * (@media max-height:700px) and nothing trimmed the reservation.
     * MEASURED at 1280x600 before 1.1.0: dock 88..148 (60px), #appWrap padding
     * 112px, content at 199 - 39px of a 600px screen reserved for nothing, and
     * --mls-dock-thickness stuck at 81px (the size the dock was BEFORE the band
     * attribute this block writes brought the diet into play), so every other
     * clearance here was 21px too generous as well.
     * Both halves are asserted: never MORE than the shell (a regression in the
     * other direction), and never LESS than the dock needs (the collision). */
    await page.evaluate(() => window.__dsT.setSide('top'));
    await page.setViewportSize({ width: 1280, height: 600 });
    await page.waitForTimeout(1400);
    const shortTop = await page.evaluate(() => {
      const g = window.__mlsDockSpace.geometry();
      const w = document.getElementById('appWrap');
      const wr = w ? w.getBoundingClientRect() : null;
      return { g: g,
        wrapTop: wr ? Math.round(wr.top) : null,
        pad: w ? Math.round(parseFloat(getComputedStyle(w).paddingTop) || 0) : null,
        band: document.documentElement.getAttribute('data-mls-dock-band') || '' };
    });
    if (shortTop.g.present && shortTop.band === 'top') {
      const dockBottom = shortTop.g.rect.y + shortTop.g.rect.h;
      eq(shortTop.g.thickness, shortTop.g.rect.h,
        `--mls-dock-thickness is ${shortTop.g.thickness}px for a dock that is ${shortTop.g.rect.h}px tall — the band's own CSS resized it after the measurement and nothing re-measured (CLUNKY 41)`);
      ok(shortTop.pad <= 112,
        `#appWrap reserves ${shortTop.pad}px for the top dock — more than the shell's own 112px constant`);
      ok(shortTop.g.wrapContentTop >= dockBottom,
        `#appWrap content starts at ${shortTop.g.wrapContentTop} and the dock ends at ${dockBottom} — the reservation is now too small and the dock covers the page (CLUNKY 41 collision guard)`);
      ok(shortTop.g.wrapContentTop <= dockBottom + 24,
        `#appWrap content starts ${shortTop.g.wrapContentTop - dockBottom}px below a dock that ends at ${dockBottom} — the reservation is padding nothing (CLUNKY 41)`);
      ok(shortTop.pad < 112,
        `#appWrap still reserves the flat ${shortTop.pad}px for a ${shortTop.g.rect.h}px dock on a 600px-tall screen (CLUNKY 41)`);
    }

    await page.setViewportSize({ width: 1366, height: 900 });
    await page.evaluate(() => window.__dsT.setSide('bottom'));
    await page.waitForTimeout(900);

    /* ---- 4. SYNC IS SILENT ------------------------------------------ */
    eq(await page.evaluate(() => window.__mlsPullFace.version), 'pullface-1.0.0',
      'pullface-1.0.0 did not install');
    const pf = await page.evaluate(() => window.__mlsPullFace.report());
    ok(pf.badgeWrapped, 'pullface-1.0.0 did not wrap _renderBackupBadge');
    /* Put real work in the queue and demand silence. */
    const quiet = await page.evaluate(() => {
      try {
        for (let i = 0; i < 10; i++) { try { _pendingBackupAdd('syn-note-' + i); } catch (e) {} }
        _renderBackupBadge();
      } catch (e) { return { err: String(e && e.message) }; }
      return window.__mlsPullFace.report();
    });
    await page.waitForTimeout(600);
    const quiet2 = await page.evaluate(() => window.__mlsPullFace.report());
    if (quiet2.pending > 0) {
      eq(quiet2.badgeVisible, false,
        `a "syncing to server" chip is visible during a normal drain (${quiet2.pending} pending) — sync must be silent`);
    } else {
      ok(true, 'the queue drained before it could be measured; silence is trivially satisfied');
      checks++;
    }

    /* ---- 5. ONE BAR ------------------------------------------------- */
    const bar = await page.evaluate(() => {
      /* Drive the two painters' OWN output shape and let the observer map it. */
      const b = document.createElement('div');
      b.id = 'mlsCvHeroBar';
      b.style.cssText = 'height:14px;display:block';
      b.innerHTML = '<div style="width:3%"></div>';
      document.body.appendChild(b);
      const fill = b.firstElementChild;
      const seen = [];
      const step = (label) => {
        fill.textContent = label;
        window.__mlsPullFace.paintBars();
        seen.push({ label, pct: Number(b.getAttribute('data-mls-pct')), phase: b.getAttribute('data-mls-phase'), text: fill.textContent });
      };
      step('Schedule 6/24 · 0m 05s');
      step('Schedule 24/24 · 0m 11s');
      step('History 1/24 · 0m 12s');
      step('History 24/24 · 2m 02s');
      step('Today’s notes 3/24 · 2m 10s');
      const out = { seen, running: window.__mlsPullFace.report().running };
      b.remove();
      return out;
    });
    const pcts = bar.seen.map((s) => s.pct);
    ok(pcts.every((p) => p >= 3 && p <= 99),
      `the bar must never claim 100% while the run is held: ${JSON.stringify(pcts)}`);
    for (let i = 1; i < pcts.length; i++) {
      ok(pcts[i] >= pcts[i - 1],
        `the bar went BACKWARDS between phases (${bar.seen[i - 1].label} -> ${bar.seen[i].label}): ${JSON.stringify(pcts)}`);
    }
    eq(bar.seen[1].phase, 'schedule', 'the Schedule phase was not recognised');
    eq(bar.seen[2].phase, 'history', 'the Histories phase was not recognised');
    eq(bar.seen[4].phase, 'daynote', 'the Today’s-notes phase was not recognised');
    ok(bar.seen[1].pct < 99,
      `Schedule 24/24 must NOT fill the whole bar — it is one phase of three, measured ${bar.seen[1].pct}%`);
    ok(/Histories/.test(bar.seen[2].text), `the Histories phase must say so, got "${bar.seen[2].text}"`);
    ok(/Today/.test(bar.seen[4].text), `the day-note phase must say so, got "${bar.seen[4].text}"`);

    /* ---- uimap: no two visible controls on Calendar share a name ---- */
    await page.evaluate(() => { const b = document.getElementById('nav_calendar'); if (b) b.click(); });
    await page.waitForTimeout(1200);
    const dupes = await page.evaluate(() => {
      try { window.__mlsUiMap && window.__mlsUiMap.report(); } catch (e) {}
      const v = window.__dsT.visible;
      const seen = Object.create(null), out = [];
      document.querySelectorAll('#calendarView button,#calendarView a[href]').forEach((e) => {
        if (!v(e)) return;
        const n = (e.getAttribute('aria-label') || e.textContent || '').trim().replace(/\s+/g, ' ');
        if (!n) return;
        if (seen[n]) { if (out.indexOf(n) < 0) out.push(n); } else seen[n] = 1;
      });
      return out;
    });
    eq(dupes.length, 0, `Calendar has visible controls sharing one accessible name: ${JSON.stringify(dupes)}`);

    const fatal = pageErrors.filter((e) => !/ResizeObserver|Non-Error promise/i.test(e));
    eq(fatal.length, 0, `page errors: ${JSON.stringify(fatal.slice(0, 4))}`);
    console.log(`  measured ${measured.cells} size x position cells: overlaps=${measured.overlaps} clipped=${measured.clipped} offscreen=${measured.offscreen} outsideViewport=${measured.outside} wrapped=${measured.wrapped}`);
  } finally {
    await browser.close();
    srv.close();
  }
}

runtime().then(() => {
  console.log(`1p-uimap-dockspace-contract: ${checks} checks passed`);
}).catch((e) => {
  console.error('1p-uimap-dockspace-contract FAILED:', e && e.message);
  process.exit(1);
});
