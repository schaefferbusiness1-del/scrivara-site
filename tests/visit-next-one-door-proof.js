'use strict';

/* visitpage-1.0.0 — ONE NEXT DOOR ON THE VISIT PAGE, AND A CHIP THAT TELLS
 * THE TRUTH ABOUT WHERE IT IS.
 *
 * OWNER, 2026-09-02, with a screenshot of the Visit page mid-generation for a
 * real patient:
 *   "the time for [Next: Review & send to Athena] shows up twice on a certain
 *    page, and it's very annoying. You have to fix that on the visit page. The
 *    bottom one's correct, the top one does nothing. You click the button, it
 *    just takes to the bottom one."
 * and, in the same screenshot, a green chip reading
 *   "NEXT  Record or paste some visit text first"
 * painted OVER the transcript card's header while the card itself said
 * "280 words captured" and a generation was in flight.
 *
 * WHAT WAS MEASURED BEFORE THE FIX (Chrome, 1366x900, this shell, synthetic
 * patients only — no login, no network, no PHI):
 *
 *   A. THE DRAFTED STATE HAD THREE DOORS TO ONE JOB
 *        #ez3flReview   "Next: Review & send to Athena"  720x62  @y670
 *        #ez3Send       "Review Athena actions"          720x82  @y1680
 *        #pushAllEmrBtn "Review Athena actions"          192x37  @y3367
 *      Two identical accessible names, 1,687 px apart, and #ez3Send's whole
 *      handler is requestSend() -> p.click() on #pushAllEmrBtn: the upper one's
 *      job is to press the lower one.
 *   B. PRESSING THE TOP ONE DID NOTHING VISIBLE WHERE IT WAS PRESSED
 *      window.scrollY 0 -> 0, document.activeElement -> #pushAllEmrBtn (2,697
 *      px below the fold), #ez3flNoteWrap hidden. That is the fourth report of
 *      this control being "dead"; b666, b669, b940 and rvack-1.0.0 all tried to
 *      make a FOCUS MOVE feel like an action.
 *   C. THE CHIP LIED IN TWO WAYS AT ONCE
 *      With 280 words captured and a run in flight, #ez3flGen is disabled, the
 *      `paused` row's unblock hop fired, and #mlsNgTag painted
 *      "NEXT — Record or paste some visit text first" at 240x22 @y485 over
 *      .ez3fl-txhead at 690x28 @y478 — 5,057 px^2 of overlap.
 *
 * THIS SUITE PINS THE CURE, NOT THE WORDING: one visible Next per state, a
 * press that OPENS the review, and a chip that is either true or absent and
 * never on top of another element's text.
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

const connect = fs.readFileSync(path.join(root, '1p-mls-connect.js'), 'utf8');

/* The lane's Next presses a real door. The property is "not focus-only": the
   handler must name a control to press. */
ok(/var reviewDoor = \$\('ez3Send'\) \|\| send;/.test(connect),
  "1p-mls-connect.js: openReviewStep() no longer resolves a door to press — the lane's Next is back to being focus-only, which is the exact shape the owner has now reported dead four times");
ok(/reviewDoor\.click\(\);/.test(connect),
  '1p-mls-connect.js: openReviewStep() resolves a door and never presses it');
/* Through the engine's own gated control, never around it: #ez3Send is
   requestSend(), which carries the name/DOB mismatch confirm. */
ok(connect.indexOf("$('ez3Send') || send") > 0,
  '1p-mls-connect.js: the review door no longer prefers #ez3Send, so the name/DOB mismatch confirm in requestSend() is being skipped');

/* One door per state: the engine's identically-named #ez3Send yields while the
   lane's Next is really on screen, by CSS class, never by node removal. */
ok(connect.indexOf("#mlsEz3Body:has(.ez3fl-record:not([hidden]) #ez3flNoteWrap:not([hidden]) #ez3flReview) #ez3Send{display:none!important}") > 0,
  '1p-mls-connect.js: the :has() yield that hides the duplicate #ez3Send while the lane owns the Next is gone');
ok(connect.indexOf("body:not(.mls-phone).ez3fl-top-next-owns #ez3Send{display:none!important}") > 0,
  '1p-mls-connect.js: the JS-class fallback for browsers without :has() is gone');
ok(/function syncTopNextOwnership\(rec, noteWrap, rvBtn\)/.test(connect),
  '1p-mls-connect.js: syncTopNextOwnership() — the single writer of the ez3fl-top-next-owns claim — is gone');
/* The claim must be derived from the same visible node the CSS reads, or it can
   hide the LAST review control on the screen. */
ok(/owns = !!\(rec && noteWrap && rvBtn && !noteWrap\.hidden && !rvBtn\.hidden && topLaneIsVisible\(rec\)\);/.test(connect),
  '1p-mls-connect.js: the top-next claim is no longer derived from the visible lane + visible Next, so it can hide the engine control when the lane has none');
/* Never a removal. */
ok(connect.indexOf("document.body.classList.remove('ez3fl-top-next-owns')") > 0,
  '1p-mls-connect.js: revert() no longer releases the top-next claim, so a reverted lane leaves #ez3Send hidden forever');

/* The twins are non-identical by construction; the nextglow hunks live in BOTH
   by hand, and a hunk that reaches only one of them ships half a fix. */
const twins = ['1p/index.html', '1pScribeFlow.html'];
const twinText = {};
twins.forEach(function (name) {
  const s = fs.readFileSync(path.join(root, name), 'utf8');
  twinText[name] = s;
  ok(/function generating\(\)/.test(s),
    name + ': nextglow has no generating() state reader — the ladder cannot tell "a note is being written" from "nothing has been recorded"');
  ok(s.indexOf('{ when: generating, steps: [], halt: true },') > 0,
    name + ': the visit row has no generating state, so a run in flight falls through to a less specific state and invents a next step');
  ok(/if \(st\.halt\) return \{ room: row\.id, state: s, el: null, why: '' \};/.test(s),
    name + ': the resolve loops no longer honour halt — a state that says "there is nothing to press" is ignored');
  ok(/unblockWhen: function \(\) \{ return !hasTranscript\(\); \}/.test(s),
    name + ': the Generate unblock hop is ungated again, so any refusal it cannot explain still says "Record or paste some visit text first" over a full transcript');
  ok(/function freeRow\(top, left, w, h, target\)/.test(s),
    name + ': paintTag has no free-row test, so the NEXT pill can land on another element\'s text again');
  ok(s.indexOf('#mlsNgTag[data-blocked="1"]{ display:none !important; }') > 0,
    name + ': the blocked-pill rule is gone; a pill with nowhere to stand will paint over something');
  ok(/function onReveal\(\) \{ setReveal\(true\); paintTag\(_marked, _last\.why\); \}/.test(s),
    name + ': onReveal paints before it reveals again — paintTag then measures a 0x0 rect and cannot tell whether the row it is about to use is free');
});
ok(twinText['1p/index.html'] !== twinText['1pScribeFlow.html'],
  'the twins are byte-identical, which means one of them was copied over the other rather than edited by hand');

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
  const NAMES = ['Ada Sample', 'Bo Sample', 'Cy Sample'];
  const local = new Date();
  const DAY = (typeof window._acctTodayKey === 'function' && /^\d{4}-\d{2}-\d{2}$/.test(String(window._acctTodayKey() || '')))
    ? String(window._acctTodayKey())
    : (local.getFullYear() + '-' + String(local.getMonth() + 1).padStart(2, '0') + '-' + String(local.getDate()).padStart(2, '0'));

  window.__ndT = {
    DAY,
    seed() {
      try {
        savePatients(NAMES.map((n, i) => ({
          id: 'syn-' + i, name: n, dob: '196' + i + '-01-0' + (i + 1),
          mrn: 'MRN' + (200000 + i), athenaId: String(910000 + i), notes: [], visits: []
        })));
      } catch (e) { return -1; }
      window._calAppts = NAMES.map((n, i) => ({
        id: 'nd-' + i, name: n, patientId: 'syn-' + i, appt_date: DAY,
        start_at: DAY + 'T0' + (8 + i) + ':00:00', reason: 'Lumbar medial branch block',
        providerName: 'Sample Provider, MD'
      }));
      try { renderPatients(); } catch (e) {}
      try { return getPatients().length; } catch (e) { return -1; }
    },
    pick() { try { const p = getPatients(); if (p[0]) { openPatient(p[0].id); return p[0].name; } } catch (e) {} return ''; },
    set(id, v) {
      const e = document.getElementById(id);
      if (!e) return false;
      e.value = v;
      try { e.dispatchEvent(new Event('input', { bubbles: true })); } catch (x) {}
      return true;
    },
    vis(e) {
      if (!e) return false;
      const r = e.getBoundingClientRect();
      const cs = getComputedStyle(e);
      return r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden' && +cs.opacity > 0.05;
    },
    /* Every VISIBLE clickable whose accessible name matches, top to bottom.
       aria-label wins, exactly as a screen reader would read it — and exactly
       where two controls with one name are a defect. */
    controls(re) {
      const rx = new RegExp(re, 'i');
      const out = [];
      document.querySelectorAll('button,a,[role="button"],input[type="button"],input[type="submit"]').forEach((e) => {
        const name = String(e.getAttribute('aria-label') || e.textContent || e.value || '').replace(/\s+/g, ' ').trim();
        if (!rx.test(name)) return;
        if (!window.__ndT.vis(e)) return;
        const r = e.getBoundingClientRect();
        out.push({ id: e.id || '', name: name.slice(0, 80), top: Math.round(r.top + window.scrollY), w: Math.round(r.width), h: Math.round(r.height) });
      });
      return out.sort((a, b) => a.top - b.top);
    },
    /* The chip, and whether it is standing on anybody. */
    chip() {
      const g = window.__mlsNextGlow ? window.__mlsNextGlow.report() : null;
      const tag = document.getElementById('mlsNgTag');
      const head = document.querySelector('.ez3fl-txhead');
      const tr = tag ? tag.getBoundingClientRect() : null;
      const hr = head ? head.getBoundingClientRect() : null;
      let overlap = 0;
      const painted = !!(tag && tag.getAttribute('data-shown') === '1'
        && tag.getAttribute('data-reveal') === '1' && tag.getAttribute('data-blocked') !== '1');
      if (painted && tr && hr) {
        const w = Math.max(0, Math.min(tr.right, hr.right) - Math.max(tr.left, hr.left));
        const h = Math.max(0, Math.min(tr.bottom, hr.bottom) - Math.max(tr.top, hr.top));
        overlap = Math.round(w * h);
      }
      return {
        painted,
        why: g ? g.why : '',
        expectedId: g ? g.expectedId : '',
        count: g ? g.count : -1,
        blocked: g ? !!g.tagBlocked : false,
        headOverlapPx: overlap,
        visitState: window.__mlsNextGlow ? window.__mlsNextGlow.visitState() : ''
      };
    },
    genStart() { try { window.dispatchEvent(new CustomEvent('mls:generation-started', { detail: { runId: 7, evidence: 'today' } })); } catch (e) {} return true; },
    genSettle() { try { window.dispatchEvent(new CustomEvent('mls:generation-settled', { detail: { runId: 7, status: 'ok' } })); } catch (e) {} return true; },
    dialogsOpen() {
      let n = 0;
      document.querySelectorAll('.modal-bg, [role="dialog"], #mlsAthenaUnifiedFix').forEach((m) => { if (window.__ndT.vis(m)) n++; });
      return n;
    },
    closeSheet() {
      try {
        const wf = window.__mlsWriteFlow;
        if (wf && typeof wf.closeUnifiedConfirmation === 'function') wf.closeUnifiedConfirmation();
      } catch (e) {}
      return true;
    }
  };
}

async function until(page, fn, pred, ms) {
  const deadline = Date.now() + ms;
  let s = null;
  for (;;) {
    s = await page.evaluate(fn);
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
      window.__mlsHarnessAccountEmail = 'visit-next-one-door@mlsscribe.test';
    });
    await page.evaluate(harness);
    eq(await page.evaluate(() => window.__ndT.seed()), 3, 'the synthetic roster did not land');
    await page.evaluate(() => { const b = document.getElementById('nav_visit'); if (b) b.click(); });
    await page.waitForTimeout(1200);
    ok(!!(await page.evaluate(() => window.__ndT.pick())), 'no patient could be opened');
    await page.waitForTimeout(4000);

    /* ---- 1. THE CHIP: an empty transcript is the ONE case the hop is for -- */
    let chip = await until(page, () => window.__ndT.chip(), (x) => !!x.expectedId, 8000);
    ok(chip.headOverlapPx === 0,
      `the NEXT pill is standing on the transcript card header with nothing recorded yet (${chip.headOverlapPx} px^2)`);

    const TX = 'Patient reports ongoing lower back pain radiating to the left leg. '.repeat(24);
    await page.evaluate((t) => window.__ndT.set('ez3flTranscript', t), TX);
    await page.waitForTimeout(1500);
    const wordCount = await page.evaluate(() => {
      const t = document.getElementById('ez3flTranscript');
      const v = String((t && t.value) || '').trim();
      return v ? v.split(/\s+/).length : 0;
    });
    ok(wordCount > 200, `the harness did not fill the transcript (${wordCount} words) — the rest of this suite would prove nothing`);

    /* ---- 2. THE MEASURED DEFECT: a run in flight over a full transcript --- */
    await page.evaluate(() => window.__ndT.genStart());
    await page.evaluate(() => { const g = document.getElementById('genBtn'); if (g) g.disabled = true; });
    await page.waitForTimeout(1500);
    /* Focus the transcript, which is what the doctor's caret was doing in the
       owner's screenshot and the only thing that reveals the pill at all. */
    await page.evaluate(() => { const t = document.getElementById('ez3flTranscript'); if (t) t.focus(); });
    await page.waitForTimeout(1200);
    chip = await page.evaluate(() => window.__ndT.chip());
    ok(!/record or paste/i.test(chip.why),
      `THE OWNER'S SCREENSHOT, REPRODUCED: with ${wordCount} words captured and a generation in flight the next-step chip still says "${chip.why}"`);
    eq(chip.headOverlapPx, 0,
      `the NEXT pill is painted on top of the transcript card's own header (${chip.headOverlapPx} px^2 of overlap) — it is position:fixed, so it can only cover`);
    eq(chip.count, 0,
      `a note is being written and ${chip.count} controls are glowing as the next step; while the app is between steps there is nothing to press`);

    /* ---- 3. ...and it comes back the moment the run settles -------------- */
    await page.evaluate(() => { window.__ndT.genSettle(); const g = document.getElementById('genBtn'); if (g) g.disabled = false; });
    chip = await until(page, () => window.__ndT.chip(), (x) => x.count === 1, 8000);
    eq(chip.count, 1, 'the glow did not come back when the generation settled — a halt must be for the length of the run, not forever');

    /* ---- 4. ONE VISIBLE NEXT DOOR IN THE DRAFTED STATE ------------------- */
    const NOTE = 'SUBJECTIVE: lower back pain.\nOBJECTIVE: exam unremarkable.\nASSESSMENT: lumbar facet syndrome.\nPLAN: medial branch block.';
    await page.evaluate((n) => { window.__ndT.set('noteBox', n); window.__ndT.set('ez3flNote', n); }, NOTE);
    let doors = await until(page, () => window.__ndT.controls('review|next'),
      (x) => x.some((c) => c.id === 'ez3flReview'), 10000);
    const nexts = doors.filter((c) => /^next:/i.test(c.name));
    eq(nexts.length, 1,
      `the Visit page shows ${nexts.length} controls whose name begins "Next:" — ${JSON.stringify(nexts)}`);
    const athenaActions = doors.filter((c) => /^review athena actions/i.test(c.name));
    ok(athenaActions.length <= 1,
      `"Review Athena actions" is on screen ${athenaActions.length} times at once — ${JSON.stringify(athenaActions)}; that identical pair 1,687 px apart is the duplicate the owner photographed`);
    ok(!doors.some((c) => c.id === 'ez3Send'),
      'the engine duplicate #ez3Send is still visible while the lane owns the Next door');

    /* ---- 5. THE PRESS REACHES THE REAL DOOR ----------------------------- */
    /* THE PROPERTY, stated exactly: the lane's Next must DO what the control
       the owner calls "the bottom one" does. Not scroll to it, not focus it —
       press it. So the door is instrumented rather than the outcome: the
       downstream review can legitimately end in the sheet OR in the write
       lane's own refusal (this harness's synthetic visit has no proven Athena
       binding and is refused by name), and a suite that demanded a dialog
       would be pinning which of those two happened rather than that the door
       was opened at all.
       #ez3Send, not #pushAllEmrBtn: that is requestSend(), which carries the
       name/DOB mismatch confirm before it presses the destination. Reaching
       past it would be a real safety regression and this is what would catch
       it. */
    const before = await page.evaluate(() => {
      window.scrollTo(0, 0);
      window.__ndPress = { ez3Send: 0, pushAll: 0 };
      /* Document-level and capture-phase, so the count survives the engine
         rebuilding #ez3Wrap from an HTML string between now and the press. */
      document.addEventListener('click', function (ev) {
        const t = ev && ev.target && ev.target.closest ? ev.target.closest('#ez3Send,#pushAllEmrBtn') : null;
        if (!t) return;
        if (t.id === 'ez3Send') window.__ndPress.ez3Send++;
        else window.__ndPress.pushAll++;
      }, true);
      return { y: window.scrollY, dialogs: window.__ndT.dialogsOpen(), send: !!document.getElementById('ez3Send') };
    });
    eq(before.dialogs, 0, 'a dialog was already open before the Next door was pressed — this step would prove nothing');
    await page.evaluate(() => { const b = document.getElementById('ez3flReview'); if (b) b.click(); });
    const after = await until(page, () => ({
      y: window.scrollY,
      press: window.__ndPress,
      reviewStep: document.body.classList.contains('mls-review-step'),
      topNext: window.__ndT.vis(document.getElementById('ez3flReview'))
    }), (x) => x.press.pushAll > 0, 8000);
    ok(after.press.ez3Send + after.press.pushAll > 0,
      'THE OWNER\'S COMPLAINT, REPRODUCED: pressing "Next: Review & send to Athena" never reached the review door at all. Its whole visible effect was moving focus to a control thousands of pixels below the fold — indistinguishable from a dead button, and reported as one four times');
    ok(!before.send || after.press.ez3Send > 0,
      'the engine door #ez3Send was mounted and the press went round it — requestSend() carries the name/DOB mismatch confirm, and reaching past it is a real safety regression, not a shortcut');
    ok(after.press.pushAll > 0,
      'the press reached the lane\'s door but the review destination (#pushAllEmrBtn) was never opened, so "Next: Review & send to Athena" still ends in nothing');
    ok(after.reviewStep, 'the review step marker was not set by the press');
    ok(!after.topNext, 'the lane kept its Next door on screen after the review opened, so the job has two doors again');
    /* b940 stands: the door opens, the page does not move. */
    ok(Math.abs(after.y - before.y) <= 2,
      `pressing the Next door moved the viewport (${before.y} -> ${after.y}); the owner ruled that out and opening the review is not a reason to reopen it`);

    /* ...and the engine's door is back the moment the lane gives up the claim. */
    await page.evaluate(() => window.__ndT.closeSheet());
    await page.waitForTimeout(800);
    const owns = await page.evaluate(() => document.body.classList.contains('ez3fl-top-next-owns'));
    eq(owns, false,
      'the lane still claims the Next door while its own Next is hidden — the engine control would stay hidden with nothing to replace it');

    const fatal = pageErrors.filter((e) => !/ResizeObserver|Non-Error promise/i.test(e));
    eq(fatal.length, 0, `page errors during the one-door proof: ${JSON.stringify(fatal.slice(0, 4))}`);
  } finally {
    await browser.close();
    srv.close();
  }
}

runtime().then(() => {
  console.log(`visit-next-one-door-proof: ${checks} checks passed`);
}).catch((e) => {
  console.error('visit-next-one-door-proof FAILED:', e && e.message);
  process.exit(1);
});
