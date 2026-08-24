'use strict';

/* visitlane-1.0.0 — THE DOCTOR'S VISIT LANE IS A FIXTURE OF THE DOCTOR SCREEN
 *
 * .ez3fl-record is the doctor's working surface: the visit transcript, the
 * record/pause pill, "✨ Generate one note", the editable note copy, and
 * "Next: Review & send to Athena". It has exactly one legitimate reason to
 * leave the screen — a REAL Staff-prep workspace — and it must come back the
 * moment the doctor does.
 *
 * WRITTEN AFTER THE 2026-08-18 BLOCKER, which was none of the things it looked
 * like. It looked like a clock/time-of-day effect (it appeared overnight and
 * moved between two different symptoms). It was two plain, independent DOM
 * defects, both measured in real Chrome on this shell:
 *
 *   1. THE LANE'S MOUNT THREW IN THE `note` PHASE. It anchored itself with
 *        wrap.insertBefore(rec, wrap.querySelector('.ez3-row2'))
 *      and querySelector searches the whole SUBTREE while insertBefore demands
 *      a DIRECT CHILD. In every phase anyone had measured, the first
 *      .ez3-row2 happened to be a top-level row. In the `note` phase — the
 *      exact moment a doctor has a generated note on screen — the engine emits
 *      its note card <div class="ez3-card">…<div class="ez3-row2"> FIRST, so
 *      the reference node is nested, insertBefore throws NotFoundError, the
 *      caller's catch swallows it, and the whole lane is gone for as long as
 *      the phase lasts. No transcript, no Generate, no Review & send.
 *   2. THE LANE LEARNED THE RECORDER HAD STOPPED ONLY BY POLLING. Every state
 *      it paints comes from #captureBtn, and it only re-read that control
 *      after a click it had handled itself or on a 2.5 s sweep. A stop from
 *      anywhere else (the phone engine, dictation, an error path, the engine's
 *      own stopCapture) left "⏸ Pause recording" and body.mls-recording up for
 *      up to two and a half seconds after capture had ended.
 *
 * And the reason a heading was never a safe way to answer "is this the staff
 * screen": the answer decides whether the lane is DELETED, and the engine
 * stamps the authoritative mode on #mlsEz3Body BEFORE it writes any HTML.
 *
 * No login, no network, no PHI — synthetic names only.
 */

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');

let checks = 0;
function ok(v, m) { assert.ok(v, m); checks++; }
function eq(a, b, m) { assert.strictEqual(a, b, m); checks++; }

/* ---------------------------------------------------------------- static -- */
/* The mount anchor must never again be a subtree match used as a sibling. */
const connect = fs.readFileSync(path.join(root, '1p-mls-connect.js'), 'utf8');
ok(connect.indexOf('wrap.insertBefore(rec, row2);') < 0,
  '1p-mls-connect.js still calls wrap.insertBefore(rec, row2) with a SUBTREE match as the reference node — that throws NotFoundError the moment the first .ez3-row2 is nested, and takes the whole visit lane with it');
ok(/while \(anchor && anchor\.parentNode !== wrap\) anchor = anchor\.parentNode;/.test(connect),
  '1p-mls-connect.js: the visit lane mount no longer walks up to a DIRECT CHILD of #ez3Wrap before insertBefore');
ok(/function onStaffScreen\(body\)[\s\S]{0,900}data-mls-easy-mode/.test(connect),
  'onStaffScreen() no longer reads the engine mode (state().mode / data-mls-easy-mode); a heading regex decides whether the doctor keeps their visit lane');

/* --------------------------------------------------------------- runtime -- */

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
  const NAMES = ['Ada Sample', 'Bo Sample', 'Cy Sample', 'Dee Sample', 'Eli Sample', 'Fay Sample'];
  const PROCS = ['Lumbar medial branch block', 'Sacroiliac joint injection'];
  /* the APP's own account-local today, never the runner's machine date */
  const local = new Date();
  const DAY = (typeof window._acctTodayKey === 'function' && /^\d{4}-\d{2}-\d{2}$/.test(String(window._acctTodayKey() || '')))
    ? String(window._acctTodayKey())
    : (local.getFullYear() + '-' + String(local.getMonth() + 1).padStart(2, '0') + '-' + String(local.getDate()).padStart(2, '0'));

  window.__vlT = {
    DAY,
    appToday() { try { return String(window._acctTodayKey()); } catch (e) { return ''; } },
    seed() {
      const out = {};
      try {
        savePatients(NAMES.map((n, i) => ({
          id: 'syn-' + i, name: n, dob: '19' + (60 + i) + '-01-0' + (i + 1),
          mrn: 'MRN' + (200000 + i), athenaId: String(910000 + i), notes: [], visits: []
        })));
        out.patients = getPatients().length;
      } catch (e) { out.err = String(e && e.message); }
      window._calAppts = NAMES.map((n, i) => ({
        id: 'vl-' + i, name: n, patientId: 'syn-' + i, appt_date: DAY,
        start_at: DAY + 'T0' + (8 + i) + ':00:00', reason: PROCS[i % PROCS.length],
        providerName: 'Sample Provider, MD'
      }));
      try { renderPatients(); } catch (e) {}
      return out;
    },
    /* A DIFFERENT patient each time: re-opening the one that is already active
       is not a change, fires nothing, and leaves the engine on the day list. */
    pick(i) { try { const p = getPatients(); const t = p[(i || 0) % p.length]; if (t) { openPatient(t.id); return t.name; } } catch (e) {} return ''; },
    set(id, v) {
      const e = document.getElementById(id);
      if (!e) return false;
      e.value = v;
      try { e.dispatchEvent(new Event('input', { bubbles: true })); } catch (x) {}
      return true;
    },
    /* Touch ONLY #captureBtn — no click, no event anywhere near the lane.
       This is the shape of every stop the lane does not handle itself. */
    capture(on) {
      const cb = document.getElementById('captureBtn');
      if (!cb) return false;
      cb.classList.toggle('recording', !!on);
      cb.textContent = on ? '⏹ Stop recording' : '▶ Start Visit';
      return true;
    },
    /* The engine's own route into Staff prep, event and all. */
    openStaff() {
      window.dispatchEvent(new CustomEvent('mls:menu-staff-prep-request',
        { detail: { source: 'mls-topbar-menu', requestId: 'vl-' + Date.now() } }));
      return true;
    },
    backToDoctor() {
      try { return !!(window.__mlsEasyV32 && window.__mlsEasyV32.open && window.__mlsEasyV32.open('home')); } catch (e) { return false; }
    },
    /* A heading that SAYS "Staff prep" on a doctor screen. This is exactly the
       shape the retired reader was fooled by: querySelector('.ez3-h1') takes
       whatever is first in DOM order. */
    fakeHeading(on) {
      const body = document.getElementById('mlsEz3Body');
      if (!body) return false;
      const old = document.getElementById('vlFakeH1');
      if (old) old.remove();
      if (!on) return true;
      const d = document.createElement('div');
      d.id = 'vlFakeH1'; d.className = 'ez3-h1'; d.textContent = 'Staff prep';
      body.insertBefore(d, body.firstChild);
      return true;
    },
    /* Exactly what the engine's render does to the lane, and nothing else:
       no click, no input, no view change. */
    razeLane() {
      const all = document.querySelectorAll('.ez3fl-record');
      all.forEach((n) => n.remove());
      return all.length;
    },
    /* THE HOSTILE ANCHOR, BUILT ON PURPOSE. The blocker needed the first
       .ez3-row2 inside #ez3Wrap to be NESTED, which the engine's note card
       produces — but not always first, because other modules inject their own
       top-level rows. Waiting for the engine to hand us that shape made this
       suite depend on which modules had painted yet. So build the shape: a
       .ez3-row2 inside a wrapper at the very top of #ez3Wrap, then raze the
       lane exactly as a render does. Returns whether the shape really is
       hostile — if it is not, this step proves nothing and says so. */
    hostileRaze() {
      const wrap = document.getElementById('ez3Wrap');
      if (!wrap) return { built: false };
      const old = document.getElementById('vlHostileBox');
      if (old) old.remove();
      const box = document.createElement('div');
      box.id = 'vlHostileBox';
      box.innerHTML = '<div class="ez3-row2"></div>';
      wrap.insertBefore(box, wrap.firstChild);
      const razed = document.querySelectorAll('.ez3fl-record');
      razed.forEach((n) => n.remove());
      const first = wrap.querySelector('.ez3-row2');
      return { built: true, razed: razed.length, nested: !!(first && first.parentNode !== wrap) };
    },
    clearHostile() {
      const old = document.getElementById('vlHostileBox');
      if (old) old.remove();
      return true;
    },
    state() {
      const wrap = document.getElementById('ez3Wrap');
      const first = wrap ? wrap.querySelector('.ez3-row2') : null;
      const lane = document.querySelector('.ez3fl-record');
      const vis = (e) => {
        if (!e) return false;
        const r = e.getBoundingClientRect();
        const cs = getComputedStyle(e);
        return r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden';
      };
      const fmt = Array.from(document.querySelectorAll('.mls-fp-fmt')).map((w) => {
        const ta = w.nextElementSibling;
        const cs = getComputedStyle(w);
        const r = w.getBoundingClientRect();
        const body = w.querySelector('.fmt-body');
        return {
          owner: ta && ta.id || '',
          display: cs.display,
          visible: r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden',
          actionable: !!(w.querySelector('.fmt-edit') && body && getComputedStyle(body).display !== 'none')
        };
      });
      const noteFmt = fmt.filter((x) => x.owner === 'ez3flNote' || x.owner === 'noteBox');
      let phase = '', emode = '', screen = '';
      try {
        const st = window.__mlsEasyV32 && window.__mlsEasyV32.state ? window.__mlsEasyV32.state() : null;
        if (st) { phase = st.phase; emode = st.mode; screen = st.screen; }
      } catch (e) {}
      const g = window.__mlsNextGlow ? window.__mlsNextGlow.report() : { count: 0, lit: [] };
      return {
        lane: !!lane,
        laneVisible: vis(lane),
        back: !!document.querySelector('.ez3fl-back,#ez3StaffBack'),
        review: vis(document.getElementById('ez3flReview')),
        gen: vis(document.getElementById('ez3flGen')),
        transcript: vis(document.getElementById('ez3flTranscript')),
        firstRow2Nested: !!(first && first.parentNode !== wrap),
        bodyMode: (document.getElementById('mlsEz3Body') || {}).getAttribute
          ? document.getElementById('mlsEz3Body').getAttribute('data-mls-easy-mode') : '',
        recordingClass: document.body.classList.contains('mls-recording'),
        phase, emode, screen,
        glowId: (g.lit[0] || {}).id || '',
        glowText: ((g.lit[0] || {}).text || '').slice(0, 40),
        glowVisible: !!(g.lit[0] || {}).visible,
        glowCount: g.count,
        reviewMarker: document.body.classList.contains('mls-review-step'),
        advanced: document.body.classList.contains('ez3adv'),
        formatted: {
          total: noteFmt.length,
          visibleOwners: noteFmt.filter((x) => x.visible).map((x) => x.owner),
          actionableOwners: noteFmt.filter((x) => x.visible && x.actionable).map((x) => x.owner),
          top: noteFmt.find((x) => x.owner === 'ez3flNote') || null,
          lower: noteFmt.find((x) => x.owner === 'noteBox') || null
        },
        noteWrapVisible: vis(document.getElementById('ez3flNoteWrap'))
      };
    }
  };
}

/* Poll a predicate over the app's own state report. Returns the last state. */
async function until(page, pred, ms, label) {
  const deadline = Date.now() + ms;
  let s = null;
  for (;;) {
    s = await page.evaluate(() => window.__vlT.state());
    if (pred(s)) return s;
    if (Date.now() > deadline) return s;
    await page.waitForTimeout(150);
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
      window.__mlsHarnessAccountEmail = 'visitlane-harness@mlsscribe.test';
    });
    await page.evaluate(harness);
    const seeded = await page.evaluate(() => window.__vlT.seed());
    eq(seeded.patients, 6, 'the synthetic roster did not land');
    const pin = await page.evaluate(() => ({ seeded: window.__vlT.DAY, app: window.__vlT.appToday() }));
    eq(pin.seeded, pin.app,
      `the seeded day (${pin.seeded}) is not the app's own today (${pin.app}) — this suite would be measuring a day the Visit room does not consider today`);

    await page.evaluate(() => { const b = document.getElementById('nav_visit'); if (b) b.click(); });
    await page.waitForTimeout(1200);
    await page.evaluate(() => window.__vlT.pick());
    /* The VISIT ROOM, not the day list: the engine's `doctor` SCREEN is where
       the note phase renders, and it is the only screen the blocker lived on.
       Waiting on the mode alone would measure the home screen and prove
       nothing. */
    let s = await until(page, (x) => x.emode === 'doctor' && x.screen === 'doctor' && x.lane && x.laneVisible, 25000);
    eq(s.emode, 'doctor', 'the engine is not in doctor mode after choosing a patient');
    eq(s.screen, 'doctor', `the engine never opened the visit room for the chosen patient (screen=${s.screen})`);
    ok(s.lane && s.laneVisible, `the visit lane is not on the doctor screen at all (${JSON.stringify(s)})`);

    /* ---- 1. A HEADING IS NOT THE MODE ------------------------------------ */
    await page.evaluate(() => window.__vlT.fakeHeading(true));
    await page.waitForTimeout(1800);
    s = await page.evaluate(() => window.__vlT.state());
    ok(s.lane && s.laneVisible,
      'a doctor screen whose FIRST .ez3-h1 reads "Staff prep" lost its visit lane — the mode must come from the engine (state().mode / data-mls-easy-mode), never from a heading');
    ok(!s.back,
      'the "Back to doctor view" button was injected onto a DOCTOR screen because a heading said "Staff prep"');
    await page.evaluate(() => window.__vlT.fakeHeading(false));
    await page.waitForTimeout(600);

    /* ---- 2. A REAL STAFF SCREEN STILL PARKS IT --------------------------- */
    await page.evaluate(() => window.__vlT.openStaff());
    s = await until(page, (x) => x.emode === 'staff' && !x.lane, 8000);
    eq(s.emode, 'staff', 'the engine did not enter staff mode on its own menu event');
    eq(s.bodyMode, 'staff', '#mlsEz3Body does not carry data-mls-easy-mode="staff" on the staff screen');
    ok(!s.lane, 'the visit lane is still mounted on a REAL Staff-prep screen — that is the one place it must leave');
    ok(s.back, 'the staff screen has no "Back to doctor view" control');

    await page.evaluate(() => window.__vlT.backToDoctor());
    await page.waitForTimeout(600);
    await page.evaluate(() => window.__vlT.pick(1));
    s = await until(page, (x) => x.emode === 'doctor' && x.screen === 'doctor' && x.lane && x.laneVisible, 25000);
    eq(s.screen, 'doctor', `after Back to doctor view the visit room did not reopen (screen=${s.screen})`);
    ok(s.lane && s.laneVisible, `the visit lane did not come back when the doctor returned (${JSON.stringify(s)})`);

    /* ---- 3. THE RECORDER STOPS SOMEWHERE ELSE --------------------------- */
    await page.evaluate(() => window.__vlT.capture(true));
    await page.evaluate(() => window.__vlT.set('transcript', 'Doctor: hello. Patient: my back hurts.'));
    /* The lane and the independent glow owner observe the same capture-button
       mutation in separate microtasks. Wait for the user-visible invariant,
       not the intermediate frame where the body class has landed but the
       glow's zero-delay refresh has not painted yet. */
    s = await until(page, (x) => x.recordingClass && /pause|stop/i.test(x.glowText), 6000);
    ok(s.recordingClass, 'body.mls-recording was never set while capture was live');
    ok(/pause|stop/i.test(s.glowText),
      `while recording, the glow is on "${s.glowText}" — it must be the pause/stop control`);

    /* ONLY #captureBtn is touched: no click, no input, nothing inside the lane.
       Both the lane and the glow must follow the recorder within one second. */
    await page.evaluate(() => window.__vlT.capture(false));
    s = await until(page, (x) => !x.recordingClass && !/pause/i.test(x.glowText), 1500);
    ok(!s.recordingClass,
      'the recorder stopped and body.mls-recording is STILL set a second later — the lane is polling for a state it can observe, and three modules stand down on that class');
    ok(!/pause/i.test(s.glowText),
      `the recorder stopped and the next step still reads "${s.glowText}"`);
    s = await until(page, (x) => x.gen && x.glowId === 'ez3flGen', 6000);
    eq(s.glowId, 'ez3flGen', `paused with a transcript, the next step is ${s.glowId || '(nothing)'}, expected ez3flGen`);

    /* ---- 4. THE `note` PHASE — THE 2026-08-18 BLOCKER ------------------- */
    const generatedNote = [
      'SUBJECTIVE:',
      'Patient reports persistent low back pain after prolonged standing and walking.',
      'HISTORY:',
      'Symptoms have continued despite home exercise and prior conservative care.',
      'OBJECTIVE:',
      'Gait is steady; lumbar range of motion is limited by pain; no acute distress is observed.',
      'ASSESSMENT:',
      'Mechanical low back pain remains documented for today\'s visit.',
      'PLAN:',
      'Continue the documented conservative plan, review precautions, and reassess response at follow-up.'
    ].join('\n\n');
    await page.evaluate((note) => window.__vlT.set('noteBox', note), generatedNote);
    s = await until(page, (x) => x.phase === 'note' && x.screen === 'doctor' && x.lane, 15000);
    eq(s.phase, 'note', 'the engine never reached the note phase, so this suite did not measure the state the blocker lived in');
    eq(s.screen, 'doctor', 'the note phase was reached on a screen other than the visit room');
    ok(s.lane && s.laneVisible,
      'THE BLOCKER: with a generated note on screen the doctor has NO visit lane — no transcript, no Generate, no "Next: Review & send to Athena". Saw: ' + JSON.stringify(s));
    ok(s.review, 'the note is drafted and "Next: Review & send to Athena" is not on screen');
    s = await until(page, (x) => x.glowId === 'ez3flReview', 8000);
    eq(s.glowId, 'ez3flReview', `with a drafted note the next step is ${s.glowId || '(nothing)'}, expected ez3flReview`);

    /* ---- 4a. REVIEW TRANSITION: ONE ACTIONABLE FORMATTED NOTE ------------ */
    /* The upper lane keeps only the compact Next action. The complete editable
       formatted note has one owner: lower #noteBox. */
    await page.evaluate((note) => window.__vlT.set('ez3flNote', note), generatedNote);
    s = await until(page, (x) => x.formatted && x.formatted.top && !x.formatted.top.visible && x.noteWrapVisible, 10000, 'compact Next action');
    ok(s.formatted.total >= 2,
      `the generated note did not mount both expected formatter owners before review (${JSON.stringify(s.formatted)})`);
    ok(!s.formatted.visibleOwners.includes('ez3flNote'),
      `the non-working upper formatted-note duplicate is still visible (${JSON.stringify(s.formatted)})`);
    ok(s.noteWrapVisible, 'the compact prior-step Next action is not visible before review');
    const reviewStart = await page.evaluate(() => {
      window.scrollTo(0, Math.min(180, Math.max(0, document.documentElement.scrollHeight - window.innerHeight)));
      const before = window.scrollY;
      window.__vlScrollProbe = { calls: 0, original: Element.prototype.scrollIntoView };
      Element.prototype.scrollIntoView = function () { window.__vlScrollProbe.calls++; };
      const button = document.getElementById('ez3flReview');
      if (!button) throw new Error('missing #ez3flReview before transition');
      button.click();
      return before;
    });
    s = await until(page, (x) => x.advanced && x.reviewMarker, 5000, 'review transition');
    await page.waitForTimeout(1200);
    const reviewEnd = await page.evaluate(() => {
      const probe = window.__vlScrollProbe || {};
      if (probe.original) Element.prototype.scrollIntoView = probe.original;
      delete window.__vlScrollProbe;
      return { scrollY: window.scrollY, scrollCalls: probe.calls || 0, state: window.__vlT.state() };
    });
    ok(Math.abs(reviewEnd.scrollY - reviewStart) <= 2,
      `Review & send moved the page (${reviewStart} -> ${reviewEnd.scrollY}, scrollIntoView calls=${reviewEnd.scrollCalls}, state=${JSON.stringify(reviewEnd.state)}); it must leave the viewport where the doctor is`);
    eq(reviewEnd.scrollCalls, 0,
      'Review & send called scrollIntoView; the quiet transition must not walk the doctor to the lower note');
    eq(reviewEnd.state.formatted.visibleOwners.length, 1,
      `review/send has ${reviewEnd.state.formatted.visibleOwners.length} visible formatted-note mounts (${JSON.stringify(reviewEnd.state.formatted)}), expected one`);
    eq(reviewEnd.state.formatted.visibleOwners[0], 'noteBox',
      `the visible review/send formatted mount is ${reviewEnd.state.formatted.visibleOwners[0] || '(none)'}, expected the actionable lower #noteBox`);
    ok(reviewEnd.state.formatted.actionableOwners.includes('noteBox'),
      `the lower #noteBox formatted mount is not actionable on review/send (${JSON.stringify(reviewEnd.state.formatted)})`);
    ok(reviewEnd.state.formatted.top && !reviewEnd.state.formatted.top.visible,
      `the upper #ez3flNote formatted duplicate remained visible on review/send (${JSON.stringify(reviewEnd.state.formatted.top)})`);
    ok(!reviewEnd.state.noteWrapVisible,
      'the upper #ez3flNoteWrap prior-step card remained visible on review/send');

    await page.evaluate(() => { const b = document.getElementById('ez3Adv'); if (b) b.click(); });
    s = await until(page, (x) => !x.advanced && !x.reviewMarker && x.formatted &&
      x.formatted.top && !x.formatted.top.visible && x.noteWrapVisible, 10000, 'Back restores compact Next action');
    ok(!s.reviewMarker, 'Back left the review-step marker set');
    ok(s.formatted.top && !s.formatted.top.visible,
      `Back restored the retired upper formatted duplicate (${JSON.stringify(s.formatted)})`);
    ok(s.noteWrapVisible, 'Back did not restore the required compact Next action');

    /* ---- 5. IT REBUILDS ITSELF, WITH NO USER INPUT AT ALL ---------------- */
    const razed = await page.evaluate(() => window.__vlT.razeLane());
    ok(razed >= 1, 'nothing was there to raze — the lane was already gone');
    s = await until(page, (x) => x.lane && x.laneVisible && x.review, 4000);
    ok(s.lane && s.laneVisible,
      'the lane was removed exactly as the engine render removes it, and it did not come back — the doctor is left with no working surface until they click something');
    s = await until(page, (x) => x.glowId === 'ez3flReview', 4000);
    eq(s.glowId, 'ez3flReview',
      `after the lane was rebuilt the next step is ${s.glowId || '(nothing)'} — the glow must follow the room, not hold a detached node`);
    eq(s.glowCount, 1, `after the rebuild ${s.glowCount} controls glow, expected exactly 1`);
    ok(s.glowVisible, 'after the rebuild the glowing control is not visible');

    /* ---- 6. THE HOSTILE ANCHOR, ON PURPOSE ------------------------------ */
    const hostile = await page.evaluate(() => window.__vlT.hostileRaze());
    ok(hostile.built && hostile.razed >= 1, `the hostile anchor could not be built (${JSON.stringify(hostile)})`);
    ok(hostile.nested,
      'the constructed shape is not hostile — the first .ez3-row2 in #ez3Wrap is still a direct child, so this step is not exercising the insertBefore defect');
    s = await until(page, (x) => x.lane && x.laneVisible, 5000);
    ok(s.lane && s.laneVisible,
      'THE BLOCKER, REPRODUCED DELIBERATELY: with the first .ez3-row2 in #ez3Wrap NESTED, the lane never remounts. wrap.insertBefore(rec, <a descendant>) throws NotFoundError, the caller swallows it, and the doctor loses the transcript, Generate and Review & send for as long as that shape lasts. Saw: ' + JSON.stringify(s));
    await page.evaluate(() => window.__vlT.clearHostile());
    await page.waitForTimeout(600);

    const fatal = pageErrors.filter((e) => !/ResizeObserver|Non-Error promise/i.test(e));
    eq(fatal.length, 0, `page errors during the visit lane contract: ${JSON.stringify(fatal.slice(0, 4))}`);
  } finally {
    await browser.close();
    srv.close();
  }
}

runtime().then(() => {
  console.log(`1p-visit-lane-survives-contract: ${checks} checks passed`);
}).catch((e) => {
  console.error('1p-visit-lane-survives-contract FAILED:', e && e.message);
  process.exit(1);
});
