'use strict';
/* ============================================================================
   THE SITE-WIDE BUSY-STATE CONTRACT

   Owner, 2026-08-19: "u added the loading thing to that button - all buttons
   should have a loading." And, watching a long read run: "if Maria's chart is
   running and this is no indicator that is so bad" - a control sat with a
   STATIC label for more than six minutes.

   THE CONTRACT. Every control that starts async work must, within 150ms of the
   press and AT ITS OWN SURFACE: say it is busy (aria-busy, plus a spinner and
   an ellipsis on its own label when the handler paints nothing itself), refuse
   to fire twice, and be restored exactly as it was when the work settles. Work
   that runs past ten seconds must additionally show a moving elapsed stamp,
   because a label that has not changed in six minutes is the defect above.

   WHAT PART 1 PROVES (static, both shell twins, no browser)
     - the busyall-1.0.0 block opens and closes exactly once in each twin, and
       the two twins are still byte-twins modulo the three lane substitutions
     - the block is lane-neutral in code, so it can be promoted unchanged
     - every regex literal in the block still has its backslashes AND executes
       (a shell-transport edit silently eats them; four shipped regexes were
       lost that way before)

   WHAT PART 2 PROVES (real headless Chrome, no login, no network, no PHI)
     A0. THE BEFORE MEASUREMENT. The shell is booted, the block is reverted
        BEFORE a single control is pressed, and the identical probe is run. It
        records, on a measure that knows nothing about this block - did the
        aria state, the disabled flag, the spinner count or the label change
        at all - how many of the reachable controls say NOTHING while a silent
        400ms job runs under them. That is the number PART A has to drive to
        zero, and it is measured on the same controls, in the same boot, by
        the same code. Two runs of one probe is the only reason PART A's zero
        can be attributed to the block at all.
     A. EVERY async control surface in the booted shell, with the block live.
        Each control's handler is replaced by a controlled 400ms async stub and
        the REAL element is pressed, so the assertion is about the control, not
        about anyone's network. Controls whose click never reaches a handler
        (disabled at rest, or in an inert container) are counted separately and
        excluded - a control that cannot be pressed has nothing to report. The
        two runs are then PAIRED per control, and the controls that were silent
        before and carry OUR marker after are counted: that set, not the bare
        zero, is what the block can claim.
     B. The contract itself, on a synthetic control, at the precision the prose
        claims: busy inside 150ms, a real double-fire guard, exact restore,
        the elapsed stamp appearing and MOVING, a Stop that appears only when
        the work registered a real canceller, and the safety cap.
     C. THE AFTER CONTROL. The block is reverted mid-run and the same synthetic
        control pressed again; it must go silent. A0 proves the block is what
        painted the shell's controls; C proves the revert really uninstalls.

   WHY THE PROBE STUBS THE HANDLER, AND WHAT A0 THEREFORE MEANS. The probe
   replaces each handler with a job that paints nothing, so what A0 measures is
   not "these controls are broken in production" - the static counts in the
   block's own header make that claim separately, from the shipped handlers.
   A0's claim is narrower and is the one PART A needs: with the block gone,
   nothing else in this shell paints a busy state for async work, so every
   busy state PART A sees is this block's doing.

   THE TRAP THIS SUITE SHARES WITH EVERY OTHER SHELL SUITE: the bundle and its
   feature modules ride a gate that only a login opens. Without the explicit
   window.__mlsEnsureUiBundle() call in boot() you measure a bare shell and
   every assertion below passes vacuously.
   ========================================================================== */

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const SHELLS = ['1pScribeFlow.html', path.join('1p', 'index.html')];
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

let checks = 0;
const measured = {};
function ok(v, m) { assert.ok(v, m); checks++; }
function eq(a, b, m) { assert.strictEqual(a, b, m); checks++; }

const OPEN = '<!-- ===== busyall-1.0.0';
const CLOSE = '<!-- ===== end busyall-1.0.0';

/* The 150ms bar is the owner's rule, not a jitter budget. It is generous
   against what was measured (the busy state lands in the same task as the
   press, i.e. ~0ms); this catches a regression that stops painting at all. */
const BUSY_WITHIN_MS = 150;

/* ---------------------------------------------------------------- PART 1 */
function part1() {
  const blocks = {};
  for (const shell of SHELLS) {
    const src = read(shell);
    const opens = src.split(OPEN).length - 1;
    const closes = src.split(CLOSE).length - 1;
    eq(opens, 1, `${shell}: the busyall block opens ${opens} times, expected once`);
    eq(closes, 1, `${shell}: the busyall block closes ${closes} times, expected once`);
    const a = src.indexOf(OPEN);
    const c = src.indexOf(CLOSE);
    ok(c > a, `${shell}: the busyall block closes before it opens`);
    const block = src.slice(a, c);
    blocks[shell] = block;

    /* Lane neutrality, over CODE only - the prose header may name the lane's
       own contract test, as every other block in this shell does. */
    const code = block.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    ok(code.indexOf('__MLS_P1_PREVIEW') < 0, `${shell}: the block names the preview global and could never be promoted`);
    ok(code.indexOf('1pScribeFlow.html') < 0, `${shell}: the block hard-codes a lane shell filename`);
    ok(!/['"]\/1p\//.test(code), `${shell}: the block hard-codes the lane route`);
    ok(!/1p-[A-Za-z0-9_]+\.js/.test(code), `${shell}: the block hard-codes a lane bundle filename`);

    /* The shipped identity of the block. */
    ok(block.indexOf("VERSION = 'busyall-1.0.0'") > 0, `${shell}: the block lost its version constant`);
    ok(block.indexOf('mls-bspin') > 0, `${shell}: the block lost its spinner class`);
    ok(block.indexOf('animation:rot') > 0, `${shell}: the spinner stopped reusing the shipped @keyframes rot`);
    ok(/prefers-reduced-motion/.test(block), `${shell}: the busy indicator has no reduced-motion rule`);
    ok(/animation-duration:2s/.test(block), `${shell}: reduced motion REMOVES the indicator instead of slowing it`);
    ok(block.indexOf('data-busy-label') > 0, `${shell}: the block stopped using the shipped restore attribute`);
    ok(block.indexOf('requestAnimationFrame') < 0, `${shell}: the block uses rAF, which never fires in a backgrounded tab`);

    /* The backslash trap: a regex that lost its escapes still LOOKS fine. */
    const res = code.match(/\/(?:[^/\\\n\[]|\\.|\[[^\]\n]*\])+\/[gimsuy]*/g) || [];
    ok(res.length >= 3, `${shell}: expected the block's regex literals to be found, saw ${res.length}`);
    let executed = 0;
    for (const lit of res) {
      const m = /^\/(.*)\/([gimsuy]*)$/.exec(lit);
      if (!m) continue;
      let re;
      try { re = new RegExp(m[1], m[2]); } catch (e) { throw new Error(`${shell}: block regex ${lit} does not compile: ${e.message}`); }
      re.test('a b\tc1_$ .');
      executed++;
    }
    ok(executed === res.length, `${shell}: ${res.length - executed} block regex literals did not execute`);
    ok(/\\s\+/.test(block) && /\\w\$/.test(block), `${shell}: the block's regexes lost their backslashes in transport`);

    /* Only one non-ASCII character is intended in this block: the ellipsis. */
    const exotic = [...new Set((block.match(/[^\x00-\x7F]/g) || []))];
    assert.deepStrictEqual(exotic, ['…'], `${shell}: the block carries unexpected non-ASCII bytes: ${JSON.stringify(exotic)}`);
    checks++;
  }

  eq(blocks[SHELLS[0]], blocks[SHELLS[1]], 'the busyall block is not byte-identical in the two shell twins');

  /* The twins themselves, modulo the three known lane substitutions. */
  const canon = (v) => String(v)
    .replace("base-uri 'self'", "base-uri 'none'")
    .replace(/<!-- p1-live-1\.0\.0:[\s\S]*?<base href="\/1p">\r?\n/, '')
    .replace("route:'/1p/'", "route:'/1pScribeFlow.html'");
  eq(canon(read(path.join('1p', 'index.html'))), read('1pScribeFlow.html'), 'the two shells are no longer twins');

  measured.blockLines = blocks[SHELLS[0]].split('\n').length;
}

/* ---------------------------------------------------------------- PART 2 */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2'
};
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
        res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-store' });
        res.end(buf);
      });
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }));
  });
}

async function boot(page, port) {
  await page.goto(`http://127.0.0.1:${port}/1pScribeFlow.html`, { waitUntil: 'load', timeout: 90000 });
  await page.waitForTimeout(2500);
  /* Without this the feature bundles never load and everything below is vacuous. */
  await page.evaluate(() => (typeof window.__mlsEnsureUiBundle === 'function' ? window.__mlsEnsureUiBundle() : null));
  await page.waitForFunction(() => !!window.__mlsSimpleLayer, null, { timeout: 60000 });
  await page.waitForTimeout(6000);
  await page.evaluate(() => {
    const a = document.getElementById('authScreen'); if (a) a.style.display = 'none';
    const s = document.getElementById('appScreen'); if (s) s.style.display = '';
    const st = document.createElement('style');
    st.textContent = '.modal-bg.show,.modal-bg.show .modal{opacity:1!important}';
    document.head.appendChild(st);
    /* rIC and rAF never fire in a non-compositing tab. */
    try { window.__mlsDeferAsset = (fn) => setTimeout(fn, 0); } catch (e) {}
    window.confirm = () => false; window.alert = () => {}; window.prompt = () => null; window.open = () => null;
  });
  await page.waitForTimeout(2000);
}

/* THE PROBE, DEFINED ONCE AND RUN TWICE. A before-measurement is only a
   control if both runs execute literally the same code; a second, "equivalent"
   copy of this walker would be a different instrument, and the difference
   between the two numbers would be unattributable. */
const SWEEP = async (BAR) => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const nameOf = (a) => { const m = /(^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/.exec(a || ''); return m ? m[2] : ''; };
  const SPINS = '.mls-bspin,.spin,.ds-spin';
  const spinCount = (el) => (el.querySelectorAll ? el.querySelectorAll(SPINS).length : 0);
  const targets = [];
  document.querySelectorAll('[onclick]').forEach((el) => {
    const n = nameOf(el.getAttribute('onclick'));
    if (!n) return;
    const f = window[n];
    if (typeof f !== 'function') return;
    const inner = f.__mlsBusyAllOrig || f;
    if (inner.constructor && inner.constructor.name === 'AsyncFunction') targets.push({ el, n });
  });
  const seen = {};
  const out = [];
  for (const t of targets) {
    const el = t.el;
    if (!document.documentElement.contains(el)) continue;
    let ran = 0;
    window[t.n] = async function () { ran++; await sleep(400); };
    const before = {
      aria: el.getAttribute('aria-busy'), dis: !!el.disabled,
      txt: (el.textContent || '').trim(), spins: spinCount(el)
    };
    try { el.click(); } catch (e) { continue; }
    await sleep(BAR);
    const at = {
      aria: el.getAttribute('aria-busy'),
      mine: el.getAttribute('data-mls-busy') === 'busyall-1.0.0',
      dis: !!el.disabled, txt: (el.textContent || '').trim(), spins: spinCount(el)
    };
    await sleep(500);
    const after = { aria: el.getAttribute('aria-busy'), dis: !!el.disabled, txt: (el.textContent || '').trim(), spin: !!(el.querySelector && el.querySelector('.mls-bspin')) };
    const base = (el.id || '(anon)') + '|' + t.n;
    seen[base] = (seen[base] || 0) + 1;
    out.push({
      key: base + '#' + seen[base],
      n: t.n, id: el.id || '', ran,
      /* OURS: the busy state is present AND carries this block's marker. */
      busy: at.aria === 'true' && at.mine,
      /* BLOCK-AGNOSTIC: did ANYTHING at this control change to say it is
         working, whoever painted it - aria, the disabled flag, a spinner, the
         label. The before-measurement is read on THIS, never on the marker
         above, or the contrast would just be our own attribute proving itself. */
      speaks: at.aria === 'true' || (at.dis && !before.dis)
        || at.spins > before.spins || at.txt !== before.txt,
      restored: after.aria !== 'true' && after.dis === before.dis && after.txt === before.txt && !after.spin
    });
  }
  return out;
};

async function runtime() {
  const { srv, port } = await serve();
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e.message).slice(0, 160)));
  try {
    /* ---- A0. THE BEFORE MEASUREMENT ------------------------------------- */
    /* Same shell, same boot, same probe. One difference: the block is reverted
       before a single control is pressed. */
    await boot(page, port);
    const rev0 = await page.evaluate(() => {
      if (!window.__mlsBusyAll) return { had: false };
      window.__mlsBusyAll.revert();
      return { had: true, gone: !window.__mlsBusyAll, css: !!document.getElementById('busyallCss') };
    });
    ok(rev0.had, 'the before-measurement could not revert the block: it was never installed');
    eq(rev0.gone, true, 'revert() at boot left the block installed, so the before-measurement is not a control');
    eq(rev0.css, false, 'revert() at boot left the block stylesheet behind');

    const A0 = await page.evaluate(SWEEP, BUSY_WITHIN_MS);
    const reached0 = A0.filter((x) => x.ran > 0);
    const silent0 = reached0.filter((x) => !x.speaks);
    measured.reachedBeforeBlock = reached0.length;
    measured.silentBeforeBlock = silent0.length;
    measured.spokeBeforeBlock = reached0.length - silent0.length;
    ok(reached0.length >= 60, `the before-measurement pressed only ${reached0.length} controls; it is not the same population as PART A`);

    /* ---- A. every async control surface, block live ---------------------- */
    /* A fresh document: revert() is one-way, so the block re-installs only on
       a new load. This is also a second, independent boot of the shell. */
    await boot(page, port);

    const installed = await page.evaluate(() => !!(window.__mlsBusyAll && window.__mlsBusyAll.installed
      && window.__mlsBusyAll.version === 'busyall-1.0.0'));
    ok(installed, 'busyall-1.0.0 did not install in the booted shell');

    const A = await page.evaluate(SWEEP, BUSY_WITHIN_MS);

    const reached = A.filter((x) => x.ran > 0);
    const inert = A.filter((x) => x.ran === 0);
    const silent = reached.filter((x) => !x.busy);
    const notRestored = A.filter((x) => !x.restored);
    measured.asyncControlSurfaces = A.length;
    measured.reached = reached.length;
    measured.inertUnpressable = inert.length;
    measured.silentAt150ms = silent.length;
    measured.notRestored = notRestored.length;

    ok(reached.length >= 60, `only ${reached.length} async controls could be pressed; the harness is not exercising the shell`);
    eq(silent.length, 0, `${silent.length} async controls showed NOTHING at their own surface within ${BUSY_WITHIN_MS}ms: ${silent.slice(0, 8).map((s) => (s.id || '(anon)') + '->' + s.n).join(', ')}`);
    eq(notRestored.length, 0, `${notRestored.length} controls were not restored after their work settled: ${notRestored.slice(0, 8).map((s) => (s.id || '(anon)') + '->' + s.n).join(', ')}`);

    /* The same block-agnostic measure the before-run was read on. Both numbers
       have to come off the same instrument or they cannot be subtracted. */
    const mute = reached.filter((x) => !x.speaks);
    measured.silentAtBarAgnostic = mute.length;
    eq(mute.length, 0, `${mute.length} async controls changed NOTHING observable at their own surface within ${BUSY_WITHIN_MS}ms: ${mute.slice(0, 8).map((s) => (s.id || '(anon)') + '->' + s.n).join(', ')}`);

    /* ---- the paired causal claim ---------------------------------------- */
    /* Per control, not in aggregate: a control that was silent before and
       carries OUR marker after is one this block actually fixed. The bare zero
       above proves nothing on its own - it is also what a shell that already
       painted every control would score. */
    const before0 = {};
    A0.forEach((x) => { if (x.ran > 0) before0[x.key] = x; });
    const paired = reached.filter((x) => before0[x.key]);
    const fixed = paired.filter((x) => !before0[x.key].speaks && x.busy);
    const regressed = paired.filter((x) => before0[x.key].speaks && !x.speaks);
    measured.pairedControls = paired.length;
    measured.fixedByBlock = fixed.length;
    measured.regressedByBlock = regressed.length;

    ok(paired.length >= 60, `only ${paired.length} controls appeared in BOTH runs; the two boots did not reach the same shell and nothing can be subtracted`);
    ok(silent0.length >= 40, `THE BEFORE MEASUREMENT IS NOT A CONTROL: with the block reverted only ${silent0.length} of ${reached0.length} reachable controls were silent, so PART A's zero is mostly not this block's doing`);
    ok(fixed.length >= 40, `only ${fixed.length} controls were silent before the block and busy-with-our-marker after it; the block is not the cause of the zero above`);
    eq(regressed.length, 0, `${regressed.length} controls said something before the block and nothing after it - the block SILENCED them: ${regressed.slice(0, 8).map((s) => (s.id || '(anon)') + '->' + s.n).join(', ')}`);

    /* ---- B. the contract itself, at precision ---------------------------- */
    const B = await page.evaluate(async (BAR) => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const host = document.createElement('div');
      host.innerHTML = '<button id="t11a" onclick="t11slow()">Refresh</button>'
        + '<button id="t11b" onclick="t11own()">Save</button>'
        + '<button id="t11c" onclick="t11long()">Read</button>';
      document.body.appendChild(host);
      const a = document.getElementById('t11a');
      const b = document.getElementById('t11b');
      const c = document.getElementById('t11c');
      const snap = (el) => ({
        aria: el.getAttribute('aria-busy'), dis: !!el.disabled,
        txt: (el.textContent || '').trim(),
        spin: !!el.querySelector('.mls-bspin'),
        label: el.getAttribute('data-busy-label'),
        paint: el.hasAttribute('data-mls-busy-paint')
      });
      const R = {};

      /* B1 full mode: silent handler, timing measured from the press */
      let calls = 0;
      window.t11slow = async function () { calls++; await sleep(700); };
      R.before = snap(a);
      const t0 = performance.now();
      a.click();
      R.sync = snap(a); R.syncMs = Math.round(performance.now() - t0);
      await sleep(BAR);
      R.at = snap(a); R.atMs = Math.round(performance.now() - t0);
      /* B2 double fire, while it is busy */
      a.click(); a.click();
      R.callsAfterRefire = calls;
      await sleep(900);
      R.after = snap(a);
      R.calls = calls;

      /* B3 lite mode: the handler paints its own busy state first */
      window.t11own = async function () {
        b.disabled = true; b.innerHTML = '<span class="spin"></span> Saving';
        await sleep(700);
        b.disabled = false; b.innerHTML = 'Save';
      };
      b.click();
      await sleep(BAR);
      R.liteAt = snap(b);
      R.liteSpinCount = b.querySelectorAll('.spin,.mls-bspin').length;
      await sleep(900);
      R.liteAfter = snap(b);

      /* B4 elapsed stamp + Stop, on shortened thresholds */
      const API = window.__mlsBusyAll;
      const oldE = API.elapsedAfterMs, oldS = API.stopAfterMs;
      API.elapsedAfterMs = 250; API.stopAfterMs = 700;
      let cancelled = 0;
      window.t11long = async function () {
        API.offerStop(function () { cancelled++; });
        await sleep(2600);
      };
      c.click();
      await sleep(600);
      const s1 = c.querySelector('.mls-belapsed');
      R.stampAppeared = !!s1;
      R.stamp1 = s1 ? s1.textContent.trim() : '';
      R.stopBeforeThreshold = !!document.querySelector('.mls-bstop');
      await sleep(1400);
      const s2 = c.querySelector('.mls-belapsed');
      R.stamp2 = s2 ? s2.textContent.trim() : '';
      const stopBtn = document.querySelector('.mls-bstop');
      R.stopAppeared = !!stopBtn;
      if (stopBtn) stopBtn.click();
      R.cancelled = cancelled;
      await sleep(1400);
      R.longAfter = snap(c);
      R.stampGone = !c.querySelector('.mls-belapsed');
      R.stopGone = !document.querySelector('.mls-bstop');
      API.elapsedAfterMs = oldE; API.stopAfterMs = oldS;

      /* B5 a control with no canceller is never offered a Stop */
      window.t11long = async function () { await sleep(1200); };
      API.elapsedAfterMs = 200; API.stopAfterMs = 400;
      c.click();
      await sleep(900);
      R.stopWithoutCanceller = !!document.querySelector('.mls-bstop');
      await sleep(700);

      /* B6 THE REPORTED DEFECT ITSELF. The control that sat static for six
         minutes was one whose handler DOES paint its own busy state - it swaps
         one word in and then never changes again. The elapsed stamp has to
         reach those too, and survive the handler repainting its own label. */
      API.elapsedAfterMs = 250; API.stopAfterMs = 999999;
      window.t11own = async function () {
        b.disabled = true; b.innerHTML = '<span class="spin"></span> Reading';
        await sleep(900);
        b.innerHTML = '<span class="spin"></span> Reading';   /* repaint mid-work */
        await sleep(1200);
        b.disabled = false; b.innerHTML = 'Save';
      };
      b.click();
      await sleep(700);
      const l1 = b.querySelector('.mls-belapsed');
      R.liteStamp1 = l1 ? l1.textContent.trim() : '';
      await sleep(1300);
      const l2 = b.querySelector('.mls-belapsed');
      R.liteStamp2 = l2 ? l2.textContent.trim() : '';
      R.liteStampSurvivesRepaint = !!l2;
      R.liteLabelKept = (b.textContent || '').indexOf('Reading') >= 0;
      await sleep(1200);
      R.liteStampGone = !b.querySelector('.mls-belapsed');
      R.liteFinal = (b.textContent || '').trim();
      API.elapsedAfterMs = oldE; API.stopAfterMs = oldS;
      return R;
    }, BUSY_WITHIN_MS);

    measured.busyAtMs = B.syncMs;
    measured.sampledAtMs = B.atMs;

    ok(B.before.aria !== 'true', 'the control claimed to be busy before it was pressed');
    eq(B.sync.aria, 'true', 'the control was not busy in the same task as the press');
    eq(B.sync.spin, true, 'no spinner was painted into the control');
    eq(B.sync.dis, true, 'the control was not disabled against a double fire');
    eq(B.sync.label, 'Refresh', 'the original label was not recorded for restore');
    eq(B.sync.txt, 'Refresh…', 'the control label did not change while it worked');
    ok(B.atMs <= 400, `the busy state was still absent ${B.atMs}ms after the press`);
    eq(B.at.aria, 'true', `the control was not busy at the ${BUSY_WITHIN_MS}ms bar`);
    eq(B.callsAfterRefire, 1, `the handler fired ${B.callsAfterRefire} times: the double-fire guard does not hold`);
    eq(B.calls, 1, 'the handler ran more than once across the whole press');
    eq(B.after.aria, null, 'the busy state was never released');
    eq(B.after.dis, false, 'the control was left disabled after its work settled');
    eq(B.after.txt, 'Refresh', 'the label was not restored after the work finished');
    eq(B.after.spin, false, 'the spinner outlived the work');
    eq(B.after.label, null, 'the restore attribute was left behind');

    eq(B.liteAt.aria, 'true', 'a handler that paints its own busy state still gets no aria-busy');
    eq(B.liteSpinCount, 1, `a handler-owned control showed ${B.liteSpinCount} spinners: the wrapper is fighting it`);
    eq(B.liteAt.paint, false, 'the wrapper repainted a control whose handler already owns it');
    eq(B.liteAt.txt, 'Saving', 'the wrapper overwrote the handler\'s own busy label');
    eq(B.liteAfter.aria, null, 'the lite busy state was never released');
    eq(B.liteAfter.txt, 'Save', 'the handler\'s own label was not left intact');

    eq(B.stampAppeared, true, 'work past the elapsed threshold showed no moving stamp - the six-minute static line is back');
    ok(/\d+s/.test(B.stamp1), `the elapsed stamp is not a time: ${JSON.stringify(B.stamp1)}`);
    ok(B.stamp2 !== B.stamp1, `the elapsed stamp is frozen at ${JSON.stringify(B.stamp1)} - it is a decoration, not progress`);
    eq(B.stopBeforeThreshold, false, 'a Stop was offered before the work had run long enough to want one');
    eq(B.stopAppeared, true, 'long work that registered a canceller was never offered a Stop');
    eq(B.cancelled, 1, 'pressing Stop did not call the work\'s own canceller');
    eq(B.stampGone, true, 'the elapsed stamp outlived the work');
    eq(B.stopGone, true, 'the Stop control outlived the work');
    eq(B.longAfter.aria, null, 'the long control was never released');
    eq(B.stopWithoutCanceller, false, 'a Stop was rendered for work that cannot be stopped');

    /* The reported defect: a handler-owned control that never changes again. */
    ok(/\d+s/.test(B.liteStamp1), `a handler-owned control showed no elapsed stamp past the threshold: ${JSON.stringify(B.liteStamp1)}`);
    eq(B.liteStampSurvivesRepaint, true, 'the elapsed stamp did not survive the handler repainting its own label');
    ok(B.liteStamp2 !== B.liteStamp1, `the handler-owned elapsed stamp is frozen at ${JSON.stringify(B.liteStamp1)} - the six-minute static label is back`);
    eq(B.liteLabelKept, true, 'the elapsed stamp replaced the handler\'s own busy label instead of joining it');
    eq(B.liteStampGone, true, 'the elapsed stamp outlived the handler-owned work');
    eq(B.liteFinal, 'Save', 'the handler-owned control did not return to its own label');

    /* ---- C. the AFTER control: revert really uninstalls ------------------ */
    const C = await page.evaluate(async (BAR) => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const a = document.getElementById('t11a');
      window.__mlsBusyAll.revert();
      const stillThere = !!window.__mlsBusyAll;
      window.t11slow = async function () { await sleep(600); };
      a.click();
      await sleep(BAR);
      const at = { aria: a.getAttribute('aria-busy'), dis: !!a.disabled, spin: !!a.querySelector('.mls-bspin') };
      await sleep(700);
      return { stillThere, at, css: !!document.getElementById('busyallCss') };
    }, BUSY_WITHIN_MS);

    eq(C.stillThere, false, 'revert() left the block installed');
    eq(C.css, false, 'revert() left the block stylesheet behind');
    eq(C.at.aria, null, 'THE CAUSAL CONTROL FAILED: the control is busy with the block reverted, so nothing above was measured');
    eq(C.at.spin, false, 'a spinner survived revert(): it is not ours');
    eq(C.at.dis, false, 'the control was disabled with the block reverted');

    eq(pageErrors.length, 0, `the shell raised ${pageErrors.length} page errors: ${pageErrors.slice(0, 3).join(' | ')}`);
  } finally {
    await browser.close();
    srv.close();
  }
}

part1();
runtime().then(() => {
  console.log('MEASURED ' + JSON.stringify(measured));
  console.log(`1p-busy-contract-runtime: ${checks} checks passed`);
}).catch((e) => {
  console.error('1p-busy-contract-runtime FAILED: ' + (e && e.message));
  process.exit(1);
});
