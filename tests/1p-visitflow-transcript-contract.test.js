'use strict';

/* visitflow-1.0.0 — THE VISIT ROOM TELLS THE TRUTH WHILE RECORDING
 *
 * Owner, 2026-08-17 21:35Z, from his own screenshot: the transcript box
 * disappears once recording starts, and a huge dark "Start Recording" sits on
 * screen below the live "● Pause recording" strip.
 *
 * The two properties, and the ONE way to prove each:
 *
 *   1. THE TRANSCRIPT IS PRESENT AND VISIBLE WHILE RECORDING.
 *      Proved CAUSALLY, not by a happy sample: the same page, the same state,
 *      measured with this block's stylesheet disabled and then enabled. The
 *      shared rule that hides it — feat_mls_calm_shell.js:405,
 *      `body.mls-calm .ez3fl-transcript.mls-empty{display:none!important}`,
 *      driven off the WORD COUNT at :3472 — must actually be active for the
 *      measurement to mean anything, so the suite forces the calm shell to run
 *      a pass and ASSERTS that .mls-empty is on the element. Measuring in a
 *      window where the shared rule had not applied yet would prove nothing.
 *
 *   2. EXACTLY ONE RECORD CONTROL WHILE RECORDING, and its label says
 *      "recording". Plus the invariant that makes the fix safe rather than
 *      merely tidy: NEVER ZERO in the states that have one. A yield that hides
 *      the last way to stop a recorder would be far worse than the defect.
 *
 * No microphone exists in a headless browser, so recording is driven through
 * the app's OWN signal: recordingNow() reads #captureBtn's .recording class and
 * its label. Driving that is driving the state machine.
 *
 * SETTLING IS NOT OPTIONAL. The ez3 engine rebuilds #ez3Wrap from an HTML
 * string on its own cadence, so a single sample can land in a repaint gap where
 * a control genuinely does not exist for ~100ms. Measured: one such sample read
 * zero record controls, and the identical instant with this block fully
 * reverted read zero too.
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

/* ============================================================ PART 1 static */

function blockOf(src, name) {
  const a = src.indexOf('<!-- ===== ' + name);
  const b = src.indexOf('<!-- ===== end ' + name);
  return (a >= 0 && b > a) ? src.slice(a, b) : '';
}

for (const shell of SHELLS) {
  const blk = blockOf(read(shell), 'visitflow-1.0.0');
  ok(blk.length > 1500, `${shell}: visitflow-1.0.0 is missing or truncated`);

  /* The override must OUT-SPECIFY the shared rule, not merely repeat it. The
     shared sheet is injected at runtime AFTER this one, so equal specificity
     loses on source order — `html body.mls-calm ...` is (0,3,2) vs (0,3,1). */
  ok(/html body\.mls-recording \.ez3fl-transcript\.mls-empty/.test(blk),
    `${shell}: the transcript override is missing or does not lead with html (it would lose on source order)`);

  /* The yield must cover the engine's BIG heroes, which the shipped rule at
     1p-mls-connect.js:6762 does not. */
  for (const id of ['#ez3Rec', '#ez3Next', '#ez3Nxt', '#ez3Now']) {
    ok(blk.indexOf(id) > 0, `${shell}: visitflow-1.0.0 does not yield the engine hero ${id}`);
  }
  /* ...and it must stay gated on the lane pill really being offered, or it
     could hide the last record control. */
  ok(/\.ez3fl-recbtn:not\(\[hidden\]\)/.test(blk),
    `${shell}: the hero yield is not gated on the lane pill being offered — it could hide the LAST record control`);
  ok(/body:not\(\.mls-phone\)/.test(blk),
    `${shell}: the hero yield does not exclude phones, where the lane is CSS-hidden`);

  /* the self-healing invariant, in the code and not only in the comment */
  ok(/if \(!recordControls\(\)\.length\)/.test(blk),
    `${shell}: hideStaleStops() does not restore a control when nothing is left — the invariant must be continuous`);

  /* lane neutrality */
  for (const bad of ['__MLS_P1_PREVIEW', "'/1p/'", '1p-feat_']) {
    ok(blk.indexOf(bad) < 0, `${shell}: visitflow-1.0.0 references ${bad}`);
  }
}
eq(blockOf(read(SHELLS[0]), 'visitflow-1.0.0'), blockOf(read(SHELLS[1]), 'visitflow-1.0.0'),
  'the twins carry DIFFERENT visitflow-1.0.0 blocks');

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
  const NAMES = ['Ada Sample', 'Bo Sample', 'Cy Sample', 'Dee Sample', 'Eli Sample', 'Fay Sample'];
  const PROCS = ['Lumbar medial branch block', 'Sacroiliac joint injection'];
  const d = new Date();
  const DAY = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  window.__vfT = {
    seed() {
      try {
        savePatients(NAMES.map((n, i) => ({ id: 'syn-' + i, name: n, dob: '1970-01-0' + ((i % 9) + 1),
          mrn: 'MRN' + (100000 + i), athenaId: String(900000 + i), notes: [], visits: [] })));
      } catch (e) {}
      window._calAppts = NAMES.map((n, i) => ({ id: 'a' + i, name: n, patientId: 'syn-' + i, appt_date: DAY,
        start_at: DAY + 'T0' + (8 + i) + ':00:00', reason: PROCS[i % 2], providerName: 'Sample Provider, MD' }));
      try { renderPatients(); } catch (e) {}
      return (function () { try { return getPatients().length; } catch (e) { return 0; } })();
    },
    pick() { try { const p = getPatients(); if (p.length) { openPatient(p[0].id); return p[0].name; } } catch (e) {} return ''; },
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
    /* Force the SHARED rule this fix narrows to actually run its pass. The
       shell's synchronous pass is exported as `render:` (rAF never fires in a
       non-compositing tab, which is why it exists) — there has NEVER been a
       `renderNow` key, so this suite's original guarded call was a silent
       no-op and the A/B graded boot-timing luck: it passed only when one of
       the shell's own boot timers happened to run a pass after the transcript
       count line rendered. The r23 merge shifted that phase and the "flake"
       surfaced. Measured 2026-08-19: on a failing run the class was absent,
       raw and normalized text both matched, DOM static for 4s with zero
       mutations, and calling the REAL export marked it instantly. */
    calmPass() {
      try { if (window.__mlsCalmShell && window.__mlsCalmShell.render) window.__mlsCalmShell.render(); } catch (e) {}
      const w = document.querySelector('.ez3fl-transcript');
      const box = document.getElementById('ez3flTranscript');
      const cs = w ? getComputedStyle(w) : null;
      return {
        markedEmpty: !!(w && w.classList.contains('mls-empty')),
        display: cs ? cs.display : '-',
        height: w ? Math.round(w.getBoundingClientRect().height) : -1,
        boxVisible: !!(box && box.getBoundingClientRect().height > 0)
      };
    },
    cssOff(off) { const s = document.getElementById('mlsVisitFlowCss'); if (s) s.disabled = !!off; return !!(s && s.disabled); }
  };
}

async function settle(page, tries = 12) {
  let prev = '', r = null;
  for (let i = 0; i < tries; i++) {
    r = await page.evaluate(() => window.__mlsVisitFlow.report());
    const sig = r.recordCount + '|' + r.recordControls.map((c) => c.id + c.text).join(',') + '|' + r.transcriptVisible;
    if (sig === prev) return r;
    prev = sig;
    await page.waitForTimeout(420);
  }
  return r;
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
    await page.waitForFunction(() => !!window.__mlsVisitFlow, null, { timeout: 60000 });
    await page.waitForTimeout(6000);
    await page.evaluate(() => {
      const a = document.getElementById('authScreen'); if (a) a.style.display = 'none';
      const s = document.getElementById('appScreen'); if (s) s.style.display = '';
      window.__mlsHarnessAccountEmail = 'visitflow-harness@mlsscribe.test';
    });
    await page.evaluate(harness);
    ok(await page.evaluate(() => window.__vfT.seed()) >= 6, 'the synthetic roster did not land');
    await page.evaluate(() => { const b = document.getElementById('nav_visit'); if (b) b.click(); });
    await page.waitForTimeout(1600);

    eq(await page.evaluate(() => window.__mlsVisitFlow.version), 'visitflow-1.0.0',
      'visitflow-1.0.0 did not install on the running page');

    await page.evaluate(() => window.__vfT.pick());
    await page.waitForTimeout(1200);
    await page.evaluate(() => window.__vfT.rec(true));
    await page.waitForTimeout(1600);

    /* ---- 1. THE CAUSAL A/B ---------------------------------------- */
    await page.evaluate(() => window.__vfT.cssOff(true));
    await page.waitForTimeout(400);
    /* PRECONDITION, polled: the A/B below is meaningful only once the
       transcript's count line ("0 words captured") exists — a transcript with
       no count text is one the calm shell deliberately does NOT hide (it
       cannot confirm emptiness). Poll for the precondition with a REAL render
       each iteration and refuse to grade if it never arrives. (Two wrong
       diagnoses are recorded here on purpose: "mid-rebuild frame" — impossible
       single-threaded — and "engine tick raced the fixed waits" — the actual
       cause was that this suite's render call named a key the shell never
       exported, see calmPass above.) */
    let cntReady = false;
    for (let ci = 0; ci < 20 && !cntReady; ci++) {
      cntReady = await page.evaluate(() => {
        try { if (window.__mlsCalmShell && window.__mlsCalmShell.render) window.__mlsCalmShell.render(); } catch (e) {}
        const w = document.querySelector('.ez3fl-transcript');
        return /(?:^|\D)0\s*words/i.test(String((w && w.textContent) || ''));
      });
      if (!cntReady) await page.waitForTimeout(250);
    }
    ok(cntReady, 'INSTRUMENT NOT READY: the transcript count line never rendered within 5s - the A/B below would prove nothing');
    const base = await page.evaluate(() => window.__vfT.calmPass());
    await page.evaluate(() => window.__vfT.cssOff(false));
    await page.waitForTimeout(500);
    const after = await page.evaluate(() => window.__vfT.calmPass());

    /* the shared rule must really be armed, or the A/B is measuring nothing */
    ok(base.markedEmpty,
      'the calm shell did not mark the transcript .mls-empty — the A/B below would prove nothing. ' +
      `measured: ${JSON.stringify(base)}`);
    eq(base.display, 'none',
      `BASELINE: the transcript should be display:none while recording with no words yet, measured ${base.display}`);
    eq(base.boxVisible, false, 'BASELINE: the transcript box should be hidden — this is the owner-reported defect');

    ok(after.markedEmpty, 'the class must still be present with the block on — the fix narrows the rule, it does not remove the class');
    eq(after.display, 'block',
      `WITH visitflow-1.0.0: the transcript must be display:block while recording, measured ${after.display}`);
    eq(after.boxVisible, true, 'WITH visitflow-1.0.0: the transcript box must be VISIBLE while recording');
    ok(after.height > 40, `WITH visitflow-1.0.0: the transcript is ${after.height}px tall; it must be a real box`);

    /* ---- 2. ONE RECORD CONTROL ------------------------------------- */
    let r = await settle(page);
    eq(r.recording, true, 'the app does not consider itself recording');
    eq(r.recordCount, 1,
      `while recording there must be exactly ONE record control, measured ${r.recordCount}: ${JSON.stringify(r.recordControls)}`);
    eq(r.startLabels, 0,
      `a "Start" control is visible while recording — the owner's two-controls defect: ${JSON.stringify(r.recordControls)}`);
    ok(/pause|stop/i.test(r.recordControls[0].text),
      `the one record control must say what pressing it does while live, got "${r.recordControls[0].text}"`);
    eq(r.transcriptVisible, true, 'the transcript is not visible while recording');

    /* ---- NEVER ZERO in the states that have one --------------------
       Give it real captured text first: "paused" means paused WITH a
       transcript. Pausing an empty session is the idle state, where the calm
       shell folding an empty box away is correct and deliberate — asserting
       visibility there would be asserting the opposite of the design. */
    await page.evaluate(() => window.__vfT.set('transcript', 'Doctor: hello. Patient: my back hurts.'));
    await page.waitForTimeout(600);
    await page.evaluate(() => window.__vfT.rec(false));
    r = await settle(page);
    ok(r.recordCount >= 1, `paused with a transcript: no record control at all (${JSON.stringify(r.recordControls)})`);
    ok(/resume|start|record/i.test(r.recordControls[0].text),
      `paused: the control must offer to resume, got "${r.recordControls[0].text}"`);
    eq(r.transcriptVisible, true, 'the transcript is not visible when paused');

    const fatal = pageErrors.filter((e) => !/ResizeObserver|Non-Error promise/i.test(e));
    eq(fatal.length, 0, `page errors: ${JSON.stringify(fatal.slice(0, 4))}`);
  } finally {
    await browser.close();
    srv.close();
  }
}

runtime().then(() => {
  console.log(`1p-visitflow-transcript-contract: ${checks} checks passed`);
}).catch((e) => {
  console.error('1p-visitflow-transcript-contract FAILED:', e && e.message);
  process.exit(1);
});
