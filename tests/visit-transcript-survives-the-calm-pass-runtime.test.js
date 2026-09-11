'use strict';

/* vanishbox-1.0.0 - THE DOCTOR ALWAYS HAS A BOX TO PUT THE VISIT IN
 *
 * OWNER-REPORTED, ROOT-CAUSED HEADLESS ON b1233: in the Doctor visit room the
 * flow lane's transcript block (.ez3fl-transcript - heading "Visit transcript
 * or doctor dictation", textarea #ez3flTranscript, "0 words captured")
 * DISAPPEARED roughly 0.7-8 s after opening a patient.
 *
 * The mechanism, measured, is two correct modules meeting badly:
 *   1. feat_mls_calm_shell.js visitCalm() toggles .mls-empty onto every
 *      .ez3fl-transcript whose text reads "0 words", and the shared sheet
 *      folds it:  body.mls-calm .ez3fl-transcript.mls-empty{display:none}
 *      That fold is driven from the calm dock's reconcile() -> renderNow on a
 *      250 ms settle retry, which is why it lands AFTER the room paints and
 *      reads to the doctor as the box vanishing on its own.
 *   2. Folding the empty flow box was harmless while the ENGINE's
 *      .ez3-transcript-card was the real box. But once the flow lane owns the
 *      top, 1p-mls-connect.js hides that card outright:
 *        #mlsEz3Body.ez3fl-top-owns .ez3-transcript-card{display:none!important}
 *      so both boxes are gone at once, and "Paste a transcript"
 *      (revealTranscript) - which only ever picks a box that is ALREADY on
 *      screen - has nothing left to reveal.
 *
 * THE FIX IS ONE CSS RULE in #mlsVisitFlowCss, narrowing the fold exactly
 * where it is unsafe: when the flow lane owns the top, the empty flow box is
 * the last box, so it stays.
 *
 * WHAT THIS SUITE PINS, and why each step is here:
 *   (1) six seconds after opening a patient - past every settle retry - the
 *       textarea is still laid out and has real height.
 *   (2) a DETERMINISTIC ARM: __mlsCalmShell.render() is the exact call
 *       reconcile() makes, run synchronously, so the measurement does not
 *       depend on catching a rAF in a headless tab. This step is the one that
 *       FAILS on the pre-fix bytes.
 *   (3) the doctor-visible invariant behind all of it: in every state at least
 *       one of the three transcript boxes is on screen, and pressing
 *       "Paste a transcript" leaves a visible box behind.
 *
 * FIVE synthetic scheduled rows, one of them deliberately UNLINKED to any
 * chart, because an unlinked row takes a different route into the room and the
 * fold is not allowed to depend on which one the doctor walked.
 *
 * No login, no network, no PHI - synthetic names only.
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
/* The rule must be in BOTH canonical shells, byte-identical. A fix that lands
   in one twin only ships half a cure. */
const RULE = 'html body.mls-calm #mlsEz3Body.ez3fl-top-owns .ez3fl-transcript.mls-empty{';
['1pScribeFlow.html', path.join('1p', 'index.html')].forEach((rel) => {
  const html = fs.readFileSync(path.join(root, rel), 'utf8');
  const at = html.indexOf(RULE);
  ok(at >= 0, `${rel} does not carry the vanishbox-1.0.0 rule "${RULE}" - the empty flow transcript is still folded away while the flow lane owns the top, leaving the doctor no box at all`);
  const css = html.indexOf('<style id="mlsVisitFlowCss">');
  const end = html.indexOf('</style>', css);
  ok(css >= 0 && at > css && at < end,
    `${rel}: the vanishbox rule is outside the #mlsVisitFlowCss overlay - it must live with the other rules that narrow this fold, or the next edit to that block will not see it`);
  ok(html.indexOf('vanishbox-1.0.0') >= 0 && html.indexOf('vanishbox-1.0.0') < at,
    `${rel}: the vanishbox rule is not introduced by the comment naming the measured defect`);
});
/* And the shared module stays untouched: the fold itself is still correct for
   every screen where the engine card is the real box. */
const calm = fs.readFileSync(path.join(root, 'feat_mls_calm_shell.js'), 'utf8');
ok(calm.indexOf("'body.mls-calm .ez3fl-transcript.mls-empty{display:none!important}'") >= 0,
  'feat_mls_calm_shell.js no longer folds the empty transcript at all - this fix narrows that fold in the shell overlay, it does not delete it');

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
  /* FIVE rows. Index 4 is UNLINKED: no chart is minted for it and it carries
     no patientId, which is the shape of a schedule row the day pull brought in
     before anything matched it to a chart. */
  const ROWS = [
    { key: 'linked-0', name: 'Ada Sample', chart: true },
    { key: 'linked-1', name: 'Bo Sample', chart: true },
    { key: 'linked-2', name: 'Cy Sample', chart: true },
    { key: 'linked-3', name: 'Dee Sample', chart: true },
    { key: 'loose-4', name: 'Eli Unlinked', chart: false }
  ];
  const local = new Date();
  const DAY = (typeof window._acctTodayKey === 'function' && /^\d{4}-\d{2}-\d{2}$/.test(String(window._acctTodayKey() || '')))
    ? String(window._acctTodayKey())
    : (local.getFullYear() + '-' + String(local.getMonth() + 1).padStart(2, '0') + '-' + String(local.getDate()).padStart(2, '0'));

  function vis(e) {
    if (!e) return { present: false, visible: false, h: 0, offsetParent: false };
    const r = e.getBoundingClientRect();
    const cs = getComputedStyle(e);
    return {
      present: true,
      offsetParent: e.offsetParent !== null,
      h: Math.round(r.height),
      w: Math.round(r.width),
      display: cs.display,
      visible: e.offsetParent !== null && r.height > 0 && r.width > 0 && cs.display !== 'none' && cs.visibility !== 'hidden'
    };
  }

  window.__vbT = {
    DAY,
    appToday() { try { return String(window._acctTodayKey()); } catch (e) { return ''; } },
    seed() {
      const out = {};
      try {
        savePatients(ROWS.filter((r) => r.chart).map((r, i) => ({
          id: 'vb-' + i, name: r.name, dob: '19' + (70 + i) + '-02-0' + (i + 1),
          mrn: 'MRN' + (700000 + i), athenaId: String(940000 + i), notes: [], visits: []
        })));
        out.patients = getPatients().length;
      } catch (e) { out.err = String(e && e.message); }
      let li = 0;
      window._calAppts = ROWS.map((r, i) => {
        const a = {
          id: 'vb-appt-' + i, name: r.name, appt_date: DAY,
          start_at: DAY + 'T0' + (8 + i) + ':00:00', reason: 'Follow-up visit',
          providerName: 'Sample Provider, MD', provider: 'Sample Provider, MD'
        };
        if (r.chart) a.patientId = 'vb-' + (li++);
        return a;
      });
      try { renderPatients(); } catch (e) {}
      out.rows = window._calAppts.length;
      out.unlinked = window._calAppts.filter((a) => !a.patientId).length;
      return out;
    },
    /* The doctor's own route: Visit -> Choose patient -> tap the row header.
       Never openPatient(): the row header is what a doctor actually presses,
       and it is the press that binds identity and opens the room. */
    openChoose() {
      const b = document.getElementById('ez3Choose');
      if (b) { b.click(); return 'button'; }
      /* Once a patient is bound, the Visit tab lands in the ROOM, not on Home,
         so there is no "Choose patient" button to press. The engine's own
         public route back to the day strip is the same one that button takes. */
      try {
        if (window.__mlsEasyV32 && typeof window.__mlsEasyV32.open === 'function') {
          window.__mlsEasyV32.open('choose');
          return 'api';
        }
      } catch (e) {}
      return '';
    },
    rowNames() {
      return Array.from(document.querySelectorAll('#mlsEz3 .ez3-prow .hd .nm')).map((n) => (n.textContent || '').trim());
    },
    clickRow(i) {
      const hd = document.querySelectorAll('#mlsEz3 .ez3-prow > .hd');
      const t = hd[i || 0];
      if (!t) return '';
      const nm = t.querySelector('.nm');
      t.click();
      return (nm && nm.textContent || '').trim();
    },
    /* THE DETERMINISTIC ARM. reconcile() in the calm dock calls exactly this
       (feat_mls_calm_shell.js renderNow), synchronously, bypassing the rAF
       that never fires in a non-compositing tab. Anything this leaves folded
       is what the doctor's screen looks like 250 ms after the room paints. */
    arm() {
      const cs = window.__mlsCalmShell;
      if (!cs || typeof cs.render !== 'function') return { ran: false, active: false };
      cs.render();
      return { ran: true, active: !!cs.active };
    },
    paste() {
      const c = document.getElementById('ez3flPaste');
      if (!c) return false;
      c.click();
      return true;
    },
    state() {
      const body = document.getElementById('mlsEz3Body');
      let emode = '', screen = '';
      try {
        const st = window.__mlsEasyV32 && window.__mlsEasyV32.state ? window.__mlsEasyV32.state() : null;
        if (st) { emode = st.mode; screen = st.screen; }
      } catch (e) {}
      const block = document.querySelector('.ez3fl-transcript');
      const flow = document.getElementById('ez3flTranscript');
      const engine = document.getElementById('ez3Transcript');
      const classic = document.getElementById('transcript');
      return {
        emode, screen,
        calm: document.body.classList.contains('mls-calm'),
        calmActive: !!(window.__mlsCalmShell && window.__mlsCalmShell.active),
        topOwns: !!(body && body.classList.contains('ez3fl-top-owns')),
        blockEmptyClass: !!(block && block.classList.contains('mls-empty')),
        blockText: ((block && block.textContent) || '').replace(/\s+/g, ' ').slice(0, 90),
        engineCard: (function () {
          const c = document.querySelector('.ez3-transcript-card');
          return c ? vis(c) : { present: false, visible: false };
        })(),
        block: vis(block),
        flow: vis(flow),
        engine: vis(engine),
        classic: vis(classic)
      };
    }
  };
}

function anyBox(s) { return !!(s.flow.visible || s.engine.visible || s.classic.visible); }

async function until(page, pred, ms) {
  const deadline = Date.now() + ms;
  let s = null;
  for (;;) {
    s = await page.evaluate(() => window.__vbT.state());
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
    await page.waitForFunction(() => !!window.__mlsEasyV32, null, { timeout: 60000 });
    await page.waitForTimeout(4000);
    await page.evaluate(() => {
      const a = document.getElementById('authScreen'); if (a) a.style.display = 'none';
      const s = document.getElementById('appScreen'); if (s) s.style.display = '';
      window.__mlsHarnessAccountEmail = 'vanishbox-harness@mlsscribe.test';
    });
    await page.evaluate(harness);
    const seeded = await page.evaluate(() => window.__vbT.seed());
    eq(seeded.rows, 5, `the five synthetic scheduled rows did not land (${JSON.stringify(seeded)})`);
    eq(seeded.unlinked, 1, 'the deliberately unlinked scheduled row was not seeded - this suite would only be measuring rows that already have a chart');
    eq(seeded.patients, 4, `the synthetic roster did not land (${JSON.stringify(seeded)})`);
    const pin = await page.evaluate(() => ({ seeded: window.__vbT.DAY, app: window.__vbT.appToday() }));
    eq(pin.seeded, pin.app,
      `the seeded day (${pin.seeded}) is not the app's own today (${pin.app}) - the Visit room would not consider these rows today's schedule`);

    /* THE CALM SHELL'S OWNER, LOADED DIRECTLY. 1p-mls-connect.js:54581 rides
       it on an idle schedule behind the dock controller, and it is measured
       never arriving inside a headless run - see the same step in
       tests/1p-ui-shape-contract.test.js. Without this the suite would measure
       an app with no calm pass at all and report that everything is fine.
       boot() is exactly what the controller's reconcile() calls. */
    const calmLoad = await page.evaluate(async () => {
      if (window.__mlsCalmShell && window.__mlsCalmShell.active) return 'already';
      if (!document.querySelector('script[data-mls-asset="feat_mls_calm_shell.js"]')) {
        const el = document.createElement('script');
        el.src = 'feat_mls_calm_shell.js?v=' + (window.__MLS_AV || Date.now());
        el.setAttribute('data-mls-asset', 'feat_mls_calm_shell.js');
        document.body.appendChild(el);
      }
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 200));
        if (window.__mlsCalmShell && typeof window.__mlsCalmShell.boot === 'function') {
          try { window.__mlsCalmShell.boot(); } catch (e) { return 'boot-threw:' + (e && e.message); }
          break;
        }
      }
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 200));
        if (window.__mlsCalmShell && window.__mlsCalmShell.active) return 'loaded';
      }
      return 'not-active';
    });
    ok(calmLoad === 'loaded' || calmLoad === 'already', `the calm shell owner did not come up headless (${calmLoad})`);

    /* The calm shell must really be running, or every measurement below is
       vacuous: the fold only exists under body.mls-calm. */
    let s = await until(page, (x) => x.calm && x.calmActive, 30000);
    ok(s.calm && s.calmActive,
      `the calm shell never booted (calm=${s.calm} active=${s.calmActive}) - the fold under test only applies under body.mls-calm, so this run would prove nothing`);

    await page.evaluate(() => { const b = document.getElementById('nav_visit'); if (b) b.click(); });
    await page.waitForTimeout(1200);
    ok(await page.evaluate(() => window.__vbT.openChoose()), 'the Visit screen has no "Choose patient" door (#ez3Choose)');
    await page.waitForTimeout(900);
    const names = await page.evaluate(() => window.__vbT.rowNames());
    ok(names.length >= 5, `the day strip shows ${names.length} rows, expected the 5 seeded ones: ${JSON.stringify(names)}`);
    ok(names.indexOf('Eli Unlinked') >= 0, `the unlinked scheduled row is not on the day strip: ${JSON.stringify(names)}`);

    /* Walk every row: linked charts first, the unlinked one last. */
    for (let i = 0; i < 5; i++) {
      if (i > 0) {
        await page.evaluate(() => { const b = document.getElementById('nav_visit'); if (b) b.click(); });
        await page.waitForTimeout(700);
        const back = await page.evaluate(() => window.__vbT.openChoose());
        ok(!!back, `could not get back to the day strip before row ${i}`);
        await until(page, (x) => x.screen === 'choose', 8000);
        await page.waitForTimeout(500);
      }
      const strip = await page.evaluate(() => window.__vbT.rowNames());
      const opened = await page.evaluate((n) => window.__vbT.clickRow(n), i);
      ok(!!opened, `row ${i} could not be opened from the day strip (.ez3-prow .hd). Rows on screen: ${JSON.stringify(strip)}`);
      s = await until(page, (x) => x.screen === 'doctor' && x.flow.present, 25000);
      eq(s.screen, 'doctor', `opening "${opened}" did not land in the visit room (screen=${s.screen})`);
      ok(s.flow.present, `the flow lane's transcript textarea #ez3flTranscript never mounted for "${opened}" (${JSON.stringify(s)})`);

      /* ---- (1) SIX SECONDS LATER, PAST EVERY SETTLE RETRY ---------------- */
      await page.waitForTimeout(6000);
      s = await page.evaluate(() => window.__vbT.state());
      ok(s.flow.offsetParent,
        `THE REPORTED DEFECT: six seconds after opening "${opened}" the visit transcript box is GONE (#ez3flTranscript.offsetParent is null). The calm pass folded .ez3fl-transcript.mls-empty and, with the flow lane owning the top, the engine's own .ez3-transcript-card is already CSS-hidden - so the doctor has nowhere to put the visit. Saw: ${JSON.stringify(s)}`);
      ok(s.flow.h > 0,
        `six seconds after opening "${opened}" the visit transcript box has collapsed to ${s.flow.h}px. Saw: ${JSON.stringify(s)}`);

      /* ---- (2) THE DETERMINISTIC ARM ------------------------------------- */
      const armed = await page.evaluate(() => window.__vbT.arm());
      ok(armed.ran && armed.active,
        `__mlsCalmShell.render() could not be armed for "${opened}" (${JSON.stringify(armed)}) - without it the fold is only measured if a rAF happened to fire, which it does not in a headless tab`);
      await page.waitForTimeout(250);
      s = await page.evaluate(() => window.__vbT.state());
      ok(s.flow.offsetParent && s.flow.h > 0,
        `THE ARM, on "${opened}": one synchronous __mlsCalmShell.render() - the exact call the calm dock's reconcile() makes on its 250 ms settle retry - folded the visit transcript box away and it did not come back. This is the doctor's screen 250 ms after the room paints. Saw: ${JSON.stringify(s)}`);
      /* The .mls-empty class is CORRECT here; it is the FOLD that must not
         apply. Pinning it keeps a future "fix" from muting the class instead,
         which would take the empty-state affordances with it. */
      if (s.topOwns) {
        ok(s.blockEmptyClass,
          `on "${opened}" the calm pass no longer marks the empty transcript .mls-empty. The cure is a narrowed FOLD, not a muted marker - the marker still drives the empty-state affordances. Saw: ${JSON.stringify(s)}`);
      }

      /* ---- (3) A BOX IN EVERY STATE, AND PASTE HAS ONE TO REVEAL --------- */
      ok(anyBox(s),
        `on "${opened}" none of #ez3flTranscript / #ez3Transcript / #transcript is visible - there is no box on screen to put the visit in at all. Saw: ${JSON.stringify(s)}`);
      const pasted = await page.evaluate(() => window.__vbT.paste());
      if (pasted) {
        await page.waitForTimeout(600);
        s = await page.evaluate(() => window.__vbT.state());
        ok(anyBox(s),
          `on "${opened}" pressing "Paste a transcript" (#ez3flPaste) left NO visible transcript box. revealTranscript() only ever picks a box that is already on screen, so a folded flow box plus the hidden engine card means the press is a dead end. Saw: ${JSON.stringify(s)}`);
      }
    }

    const fatal = pageErrors.filter((e) => !/ResizeObserver|Non-Error promise/i.test(e));
    eq(fatal.length, 0, `page errors during the visit transcript contract: ${JSON.stringify(fatal.slice(0, 4))}`);
  } finally {
    await browser.close();
    srv.close();
  }
}

runtime().then(() => {
  console.log(`visit-transcript-survives-the-calm-pass-runtime: ${checks} checks passed`);
}).catch((e) => {
  console.error('visit-transcript-survives-the-calm-pass-runtime FAILED:', e && e.message);
  process.exit(1);
});
