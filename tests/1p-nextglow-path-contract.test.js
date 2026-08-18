'use strict';

/* nextglow-1.0.0 — THE WHERE-TO-GO-NEXT CONTRACT
 *
 * Owner, 2026-08-17: "FOR EVERY SINGLE SYSTEM THE MOST LIKELY NEXT BUTTON TO
 * MOVE ALONG THE PATH SHOULD BE GLOWING."
 *
 * The properties, expressed so they cannot silently come back:
 *
 *   1. EXACTLY ONE control carries [data-mls-next="1"] — in every room, every
 *      enumerated state, every dialog, and in ALL THREE modes (the ring this
 *      replaces lit only in "guided", which is not the default).
 *   2. That control is VISIBLE and ENABLED. Never a disabled control, never a
 *      hidden one. If the natural next step is disabled the glow moves to the
 *      control that unblocks it and the tag carries a reason.
 *   3. It is the EXPECTED control for that state, by id — a per-room, per-state
 *      table, checked against the running page.
 *   4. THE CANARY. Hiding the expected control must make assertion 3 FAIL.
 *      Without this, a test that only asserts "one thing glows" passes on a
 *      page where the glow has quietly moved somewhere useless.
 *   5. There is exactly ONE OWNER of the glow: .msl-next never appears on any
 *      element, and the msl-1.0.0 stylesheet that used to draw it is gone.
 *   6. The block is lane-neutral (no __MLS_P1_PREVIEW, no 1p-*.js, no /1p
 *      route), so promoting it to another lane is a copy.
 *
 * PART 1 is static over both twins. PART 2 drives the real shell in real
 * Chrome with a synthetic day — no login, no network, no PHI.
 *
 * THE TRAP THIS SUITE EXISTS TO AVOID: 1p-mls-connect.js — and with it all 219
 * feature modules and the whole visit room — is NOT loaded by the page on its
 * own. It rides a gate a login normally opens. A measurement taken without
 * window.__mlsEnsureUiBundle() measures a bare shell and reports that
 * everything is fine.
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
function ok(v, m) { assert.ok(v, m); checks++; }
function eq(a, b, m) { assert.strictEqual(a, b, m); checks++; }

/* ============================================================ PART 1 static */

function blockOf(src, name) {
  const a = src.indexOf('<!-- ===== ' + name);
  const b = src.indexOf('<!-- ===== end ' + name);
  return (a >= 0 && b > a) ? src.slice(a, b) : '';
}

for (const shell of SHELLS) {
  const src = read(shell);
  const blk = blockOf(src, 'nextglow-1.1.0');
  ok(blk.length > 2000, `${shell}: nextglow-1.0.0 block is missing or truncated`);

  /* 6 — lane neutrality: promoting the block must not carry the lane with it */
  for (const bad of ['__MLS_P1_PREVIEW', "'/1p/'", '1p-mls-connect.js', '1p-feat_']) {
    ok(blk.indexOf(bad) < 0, `${shell}: nextglow-1.0.0 references ${bad}; it must be lane-neutral`);
  }

  /* 5 — one owner: the msl ring stylesheet is GONE, not merely unused */
  ok(src.indexOf('.msl-next::after') < 0,
    `${shell}: the retired msl-1.0.0 ring stylesheet (.msl-next::after) is still present — two owners of one glow is the defect this replaced`);
  ok(src.indexOf('@keyframes mslNextRing') < 0,
    `${shell}: @keyframes mslNextRing survives the msl ring retirement`);
  ok(/function markNext\(mode\) \{[\s\S]{0,400}__mlsNextGlow/.test(src),
    `${shell}: msl-1.0.0 markNext() no longer delegates to __mlsNextGlow`);

  /* the pulse and the reduced-motion still-state both exist */
  ok(/\[data-mls-next="1"\]::after\{/.test(blk), `${shell}: the halo rule is missing`);
  ok(/@keyframes mlsNgPulse/.test(blk), `${shell}: the pulse keyframes are missing`);
  ok(/prefers-reduced-motion: reduce/.test(blk) && /animation:none !important/.test(blk),
    `${shell}: prefers-reduced-motion must still the pulse at FULL strength, not hide it`);

  /* the tag must not be a pseudo-element on the control and must not be a
     child node of it — both were rejected for measured reasons */
  ok(blk.indexOf('#mlsNgTag') > 0, `${shell}: the Next tag element is missing`);
  ok(!/\[data-mls-next="1"\]::before/.test(blk),
    `${shell}: the tag must not use ::before on the control — several candidates own ::before already`);

  /* every regex in the block really carries its backslashes: an escape lost in
     transport still parses and silently never matches */
  const scriptOnly = blk.slice(blk.indexOf('<script>'));
  ok(!/[^\\\[]\bd\+\)/.test(scriptOnly.replace(/\\d/g, '\\d')),
    `${shell}: a bare d+ (a \\d that lost its backslash) appears in nextglow-1.0.0`);
  ok(/\\d/.test(scriptOnly) || scriptOnly.indexOf('match(') < 0,
    `${shell}: nextglow-1.0.0 uses a match() with no escaped class`);
}

/* the two shells must carry byte-identical blocks */
eq(blockOf(read(SHELLS[0]), 'nextglow-1.1.0'), blockOf(read(SHELLS[1]), 'nextglow-1.1.0'),
  'the twins carry DIFFERENT nextglow-1.0.0 blocks');

/* ============================================================ PART 2 runtime */

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
  const NAMES = ['Ada Sample', 'Bo Sample', 'Cy Sample', 'Dee Sample', 'Eli Sample', 'Fay Sample',
    'Gus Sample', 'Hal Sample', 'Ivy Sample', 'Jo Sample', 'Kit Sample', 'Lu Sample'];
  const PROCS = ['Lumbar medial branch block', 'Right L4-L5 transforaminal epidural steroid injection',
    'Radiofrequency ablation, lumbar facet', 'Sacroiliac joint injection'];
  /* THE DAY THIS SUITE SEEDS IS THE APP'S OWN TODAY, NOT THE MACHINE'S.
     2026-08-18: the synthetic schedule was dated from `new Date()` in the test
     process, while every surface under test asks _acctTodayKey() — which
     resolves the date in the PRACTICE time zone (America/New_York by default),
     not the runner's. On any machine whose local date differs from the
     account's — and on this one for the hour on either side of midnight — the
     roster lands on a day the Visit room does not consider today, which
     silently changes which screen is being measured. Reading the app's own
     answer removes the whole class: the suite and the app cannot disagree
     about what day it is, at any hour. The local fallback is only for a shell
     that has not defined it, and DAY is asserted against the app below. */
  const local = new Date();
  const DAY = (typeof window._acctTodayKey === 'function' && /^\d{4}-\d{2}-\d{2}$/.test(String(window._acctTodayKey() || '')))
    ? String(window._acctTodayKey())
    : (local.getFullYear() + '-' + String(local.getMonth() + 1).padStart(2, '0') + '-' + String(local.getDate()).padStart(2, '0'));

  window.__ngT = {
    DAY,
    appToday() { try { return String(window._acctTodayKey()); } catch (e) { return ''; } },
    seed() {
      const out = {};
      try {
        setTemplates(PROCS.map((p, i) => ({ id: 'syn-t' + i, name: p, body: 'PROCEDURE: ' + p, kind: 'op' })));
        localStorage.setItem(uns('useTemplates'), '1');
      } catch (e) { out.tplErr = String(e && e.message); }
      try {
        savePatients(NAMES.map((n, i) => ({
          id: 'syn-' + i, name: n, dob: '19' + (60 + (i % 30)) + '-01-0' + ((i % 9) + 1),
          mrn: 'MRN' + (100000 + i), athenaId: String(900000 + i), notes: [], visits: []
        })));
        out.patients = getPatients().length;
      } catch (e) { out.ptErr = String(e && e.message); }
      window._calAppts = NAMES.map((n, i) => ({
        id: 'appt-' + i, name: n, patientId: 'syn-' + i, appt_date: DAY,
        start_at: DAY + 'T0' + (8 + (i % 8)) + ':00:00', reason: PROCS[i % PROCS.length],
        providerName: 'Sample Provider, MD'
      }));
      out.appts = window._calAppts.length;
      try { renderPatients(); } catch (e) {}
      return out;
    },
    pick() { try { const p = getPatients(); if (p.length) { openPatient(p[0].id); return p[0].name; } } catch (e) {} return ''; },
    /* The app's OWN recording signal — recordingNow() reads #captureBtn's class
       and label — so driving it is driving the state machine, not faking one.
       No microphone exists in a headless browser. */
    rec(on) {
      const cb = document.getElementById('captureBtn');
      if (!cb) return false;
      cb.classList.toggle('recording', !!on);
      cb.textContent = on ? '⏹ Stop recording' : '▶ Start Visit';
      document.dispatchEvent(new Event('click', { bubbles: true }));
      return true;
    },
    set(id, v) {
      const e = document.getElementById(id);
      if (!e) return false;
      e.value = v;
      try { e.dispatchEvent(new Event('input', { bubbles: true })); } catch (x) {}
      return true;
    },
    signed(on) { const b = document.getElementById('statusBadge'); if (b) b.textContent = on ? '● Signed' : '● Draft'; },
    /* THE CANARY: hide whatever is glowing, so the next resolve must move. */
    hideGlowing() {
      const e = document.querySelector('[data-mls-next="1"]');
      if (!e) return '';
      const id = e.id || '(unnamed)';
      e.setAttribute('data-ng-canary', '1');
      e.style.setProperty('display', 'none', 'important');
      return id;
    },
    unhideCanary() {
      document.querySelectorAll('[data-ng-canary="1"]').forEach((e) => {
        e.removeAttribute('data-ng-canary');
        e.style.removeProperty('display');
      });
    }
  };
}

/* room -> the id the glow must land on, per state. '' means "no id, assert
   only that one visible+enabled control glows" (a patient row has no id). */
const EXPECT = {
  visit_nopatient: 'ez3Choose',
  visit_recording: '',
  visit_paused: 'ez3flGen',
  visit_drafted: 'ez3flReview',
  calendar: 'mlsCvNxt_calendar',
  history: 'mlsCvNxt_history',
  recs: 'genRecsBtn',
  studio: 'copilotInput',
  opnotes: 'opPrepGenAllBtn'
};

async function settle(page, tries = 15) {
  /* Wait for the glow to REACH one lit control and hold it for two samples.
     (2026-08-18: the old rule returned on the first stable pair, so a slow
     machine that had not yet revealed the drafted-note row reported a stable
     0 twice and the suite failed on timing, not on the invariant. The state
     transitions here — recorder flips, note reveal — are driven by the app's
     own sync cadence and can take >400 ms under load; the invariant is
     unchanged: exactly one lit control, and it must be the expected one.) */
  let prev = '', r = null;
  for (let i = 0; i < tries; i++) {
    r = await page.evaluate(() => window.__mlsNextGlow.report());
    const sig = r.count + '|' + r.lit.map((l) => l.id + l.text).join(',') + '|' + r.room;
    if (sig === prev && r.count === 1) return r;
    prev = sig;
    await page.waitForTimeout(400);
  }
  return r;
}

/* the invariant every state must satisfy */
function assertOne(r, where) {
  eq(r.count, 1, `${where}: expected exactly ONE glowing control, got ${r.count} (${JSON.stringify(r.lit)})`);
  ok(r.lit[0] && r.lit[0].visible, `${where}: the glowing control is NOT VISIBLE (${JSON.stringify(r.lit[0])})`);
  ok(r.lit[0] && r.lit[0].enabled, `${where}: the glowing control is DISABLED (${JSON.stringify(r.lit[0])})`);
  eq(r.stale, 0, `${where}: ${r.stale} stale .msl-next element(s) — there must be exactly one owner of the glow`);
  /* PIN INVERTED 2026-08-18 (nextglow-1.1.0). Owner order, from his own
     screenshot of the op-note fill screen where the "NEXT — The one detail this
     note still needs" pill sat on top of the field beside the lit control:
     "text gone or out of the way".

     The tag is position:fixed, so it can never push layout — it can only
     COVER, and on a dense form there is nowhere to put a 300px pill that does
     not cover something. So it is ARMED on every state (positioned, ready, and
     that is still asserted) and REVEALED only on focus of the control it
     describes. What the property was really protecting — that the reason is
     reachable and not invented — is asserted more strictly than before: the
     reason must be on the control itself, where a hover bubble and a screen
     reader both reach it, rather than only in a pill nobody asked for. */
  eq(r.tagShown, false,
    `${where}: the "Next" pill is painted by default — the owner asked for it out of the way (2026-08-18)`);
  ok(r.tagArmed, `${where}: the "Next" tag was never positioned, so focus could not reveal it`);
  if (r.why) {
    ok(r.litTip.indexOf(r.why) >= 0,
      `${where}: the reason "${r.why}" is not on the lit control as data-tip (got "${r.litTip}") — with the pill hidden this is the only way a doctor reads it`);
    ok(r.litLabel.indexOf(r.why) >= 0,
      `${where}: the reason is not in the lit control's accessible name (got "${r.litLabel}")`);
  }
}

async function runtime() {
  const { srv, port } = await serve();
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e.message).slice(0, 180)));
  try {
    await page.goto(`http://127.0.0.1:${port}/1pScribeFlow.html`, { waitUntil: 'load', timeout: 90000 });
    await page.waitForTimeout(2500);
    await page.evaluate(() => (typeof window.__mlsEnsureUiBundle === 'function' ? window.__mlsEnsureUiBundle() : null));
    await page.waitForFunction(() => !!window.__mlsNextGlow, null, { timeout: 60000 });
    await page.waitForTimeout(6000);
    await page.evaluate(() => {
      const a = document.getElementById('authScreen'); if (a) a.style.display = 'none';
      const s = document.getElementById('appScreen'); if (s) s.style.display = '';
      const st = document.createElement('style');
      st.textContent = '.modal-bg.show,.modal-bg.show .modal{opacity:1!important}';
      document.head.appendChild(st);
      window.__mlsHarnessAccountEmail = 'nextglow-harness@mlsscribe.test';
    });
    await page.evaluate(harness);
    const seeded = await page.evaluate(() => window.__ngT.seed());
    eq(seeded.patients, 12, 'the synthetic roster did not land');
    /* The day is PINNED to the app's own account-local today. If these ever
       disagree the suite is measuring a room that thinks the schedule is for
       another day, and every "the glow is on the wrong control" failure below
       would be a lie about the glow. Fail here instead, saying so. */
    const dayPin = await page.evaluate(() => ({ seeded: window.__ngT.DAY, app: window.__ngT.appToday() }));
    eq(dayPin.seeded, dayPin.app,
      `the seeded day (${dayPin.seeded}) is not the app's own today (${dayPin.app}) — the Visit room is being measured on a day it does not consider today`);

    eq(await page.evaluate(() => window.__mlsNextGlow.version), 'nextglow-1.1.0',
      'nextglow-1.0.0 did not install on the running page');

    /* ---- 1,2,3: every room ---------------------------------------- */
    const ROOMS = [['calendar', 'nav_calendar'], ['history', 'nav_history'],
      ['recs', 'nav_recs'], ['studio', 'nav_studio'], ['patients', 'nav_patients']];
    for (const [name, nav] of ROOMS) {
      await page.evaluate((n) => { const b = document.getElementById(n); if (b) b.click(); }, nav);
      await page.waitForTimeout(900);
      /* A view container's display flips BEFORE the module that fills it has
         painted, so the expected control can be genuinely absent for a second
         or two. Wait for the NODE, then settle on the glow — otherwise this
         suite measures a half-painted room and blames the path table. */
      if (EXPECT[name]) {
        await page.waitForFunction((id) => !!document.getElementById(id), EXPECT[name], { timeout: 20000 })
          .catch(() => {});
      }
      const r = await settle(page);
      assertOne(r, `room ${name}`);
      if (EXPECT[name]) {
        eq(r.lit[0].id, EXPECT[name], `room ${name}: the glow is on ${r.lit[0].id}, expected ${EXPECT[name]}`);
      }
    }

    /* ---- 1,2,3: the Visit state machine ---------------------------- */
    await page.evaluate(() => { const b = document.getElementById('nav_visit'); if (b) b.click(); });
    await page.waitForTimeout(1400);

    let r = await settle(page);
    assertOne(r, 'visit / no patient');
    eq(r.lit[0].id, EXPECT.visit_nopatient,
      `visit with NO patient must glow "Choose patient", not a pre-armed recorder — got ${r.lit[0].id}`);
    ok(/pick the patient/i.test(r.why), `visit / no patient: the tag gives no reason (why="${r.why}")`);

    /* ---- 1.1.0: CONTAINMENT, MEASURED ON THE PAGE -------------------
       Owner, 2026-08-18: the ring must render INSIDE the lit control's border
       box — no outset halo, no overlap with a neighbour, ever. 1.0.0 drew it at
       inset:-5px with a `0 0 26px 5px` bloom on top, i.e. up to 31px of paint
       outside the control in every direction. Read off computed style rather
       than off the stylesheet text, so a later rule that re-adds an outset
       shadow fails here. */
    const ring = await page.evaluate(() => {
      const e = document.querySelector('[data-mls-next="1"]');
      if (!e) return null;
      const a = getComputedStyle(e, '::after');
      const parts = String(a.boxShadow || 'none')
        .split(/,(?![^(]*\))/).map((s) => s.trim()).filter(Boolean);
      return {
        id: e.id || e.tagName,
        offsets: [a.top, a.right, a.bottom, a.left].join(' '),
        outset: parts.filter((p) => p !== 'none' && p.indexOf('inset') < 0),
        shadow: parts.join(' | ').slice(0, 160)
      };
    });
    ok(ring, 'nothing is lit, so containment could not be measured');
    assert.deepStrictEqual(ring.outset, [],
      `the halo on ${ring.id} paints OUTSIDE its border box: ${JSON.stringify(ring.outset)} — owner 2026-08-18, no outset halo, ever`);
    checks++;
    eq(ring.offsets, '0px 0px 0px 0px',
      `the halo overlay on ${ring.id} is offset from the control's box (${ring.offsets}) — it must be inset:0`);

    /* ---- 1.1.0: THE PILL OPENS ON FOCUS AND ON NOTHING ELSE ---------- */
    const reveal = await page.evaluate(async () => {
      const e = document.querySelector('[data-mls-next="1"]');
      const t = document.getElementById('mlsNgTag');
      if (!e || !t) return null;
      const before = getComputedStyle(t).display;
      e.focus();
      await new Promise((r2) => setTimeout(r2, 260));
      const during = getComputedStyle(t).display;
      e.blur();
      await new Promise((r2) => setTimeout(r2, 260));
      return { before, during, after: getComputedStyle(t).display };
    });
    ok(reveal, 'the Next tag element is absent, so the reveal could not be measured');
    eq(reveal.before, 'none', `the "Next" pill is painted before anyone asked for it (display:${reveal.before})`);
    ok(reveal.during !== 'none',
      `focusing the lit control did not reveal the "Next" pill (display:${reveal.during}) — a fold that cannot open is a deletion`);
    eq(reveal.after, 'none', `the "Next" pill stayed open after the control lost focus (display:${reveal.after})`);

    /* THE CANARY (4). Hide the expected control: the glow MUST move, and the
       expectation above MUST now fail. A suite that cannot fail proves nothing. */
    const hidden = await page.evaluate(() => window.__ngT.hideGlowing());
    eq(hidden, EXPECT.visit_nopatient, 'the canary did not hide the control the glow was on');
    await page.waitForTimeout(900);
    const canary = await settle(page);
    ok(canary.count === 0 || (canary.lit[0] && canary.lit[0].id !== EXPECT.visit_nopatient),
      'THE CANARY DID NOT BITE: the expected control is hidden and the suite still reports it glowing');
    if (canary.count === 1) {
      ok(canary.lit[0].visible && canary.lit[0].enabled,
        'after the canary the glow moved to a control that is hidden or disabled');
    }
    await page.evaluate(() => window.__ngT.unhideCanary());
    await page.waitForTimeout(900);

    await page.evaluate(() => window.__ngT.pick());
    await page.waitForTimeout(1100);
    r = await settle(page);
    assertOne(r, 'visit / patient chosen');

    await page.evaluate(() => window.__ngT.rec(true));
    await page.evaluate(() => window.__ngT.set('transcript', 'Doctor: hello. Patient: my back hurts.'));
    r = await settle(page);
    assertOne(r, 'visit / recording');
    ok(/pause|stop/i.test(r.lit[0].text),
      `visit / recording: the glow must be on the pause/stop control, got "${r.lit[0].text}"`);

    await page.evaluate(() => window.__ngT.rec(false));
    r = await settle(page);
    assertOne(r, 'visit / paused');
    eq(r.lit[0].id, EXPECT.visit_paused, `visit / paused: glow on ${r.lit[0].id}, expected ${EXPECT.visit_paused}`);

    await page.evaluate(() => window.__ngT.set('noteBox', 'SUBJECTIVE: back pain.\nPLAN: injection.'));
    r = await settle(page);
    assertOne(r, 'visit / note drafted');
    eq(r.lit[0].id, EXPECT.visit_drafted, `visit / drafted: glow on ${r.lit[0].id}, expected ${EXPECT.visit_drafted}`);

    await page.evaluate(() => { window.__ngT.set('noteBox', ''); window.__ngT.set('transcript', ''); });
    await page.waitForTimeout(700);

    /* ---- dialogs --------------------------------------------------- */
    await page.evaluate(() => {
      try { openSettings(); } catch (e) { const m = document.getElementById('settingsModal'); if (m) m.classList.add('show'); }
    });
    await page.waitForTimeout(1000);
    r = await settle(page);
    assertOne(r, 'dialog / settings');
    eq(r.room, 'settings', `settings dialog: the glow believes it is in "${r.room}"`);
    await page.evaluate(() => { const m = document.getElementById('settingsModal'); if (m) m.classList.remove('show'); });
    await page.waitForTimeout(700);

    /* A CLOSED dialog must give the glow back. This is the exact defect the
       .show requirement in hostOf() fixes: a .modal-bg without .show still has
       a box, so `visible` alone kept the op-note room owning six later
       screens. */
    await page.evaluate(() => {
      try { openOpPrep(window.__ngT.DAY); } catch (e) {}
      const m = document.getElementById('opPrepModal'); if (m) m.classList.add('show');
    });
    await page.waitForTimeout(1800);
    r = await settle(page);
    assertOne(r, 'dialog / op-note room');
    eq(r.room, 'opnotes', `op-note room: the glow believes it is in "${r.room}"`);
    await page.evaluate(() => { const m = document.getElementById('opPrepModal'); if (m) m.classList.remove('show'); });
    await page.waitForTimeout(1200);
    r = await settle(page);
    ok(r.room !== 'opnotes',
      'a CLOSED op-note room still owns the glow — hostOf() must require .show on a .modal-bg');

    /* ---- 1: ALL THREE MODES, not only guided ----------------------- */
    await page.evaluate(() => { const b = document.getElementById('nav_patients'); if (b) b.click(); });
    await page.waitForTimeout(900);
    for (const mode of ['calm', 'full', 'guided']) {
      await page.evaluate((m) => window.__mlsSimpleLayer.set(m), mode);
      await page.waitForTimeout(800);
      r = await settle(page);
      assertOne(r, `patients / mode=${mode}`);
    }
    await page.evaluate(() => window.__mlsSimpleLayer.set('calm'));

    const fatal = pageErrors.filter((e) => !/ResizeObserver|Non-Error promise/i.test(e));
    eq(fatal.length, 0, `page errors during the glow contract: ${JSON.stringify(fatal.slice(0, 4))}`);
  } finally {
    await browser.close();
    srv.close();
  }
}

runtime().then(() => {
  console.log(`1p-nextglow-path-contract: ${checks} checks passed`);
}).catch((e) => {
  console.error('1p-nextglow-path-contract FAILED:', e && e.message);
  process.exit(1);
});
