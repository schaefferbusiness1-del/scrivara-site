'use strict';
/*
 * THE LIVE CAPTURE VIEW REPORTS THE NUMBERS THE SNAP WILL USE  (lv-1.0, 2026-08-12)
 * =============================================================================
 * The camera used to be a 200px mirror with no feedback: the doctor framed
 * blind and learned what the matcher thought from a refusal list after the
 * fact. The live view runs the SAME measurement the snap runs, 8 times a
 * second, and draws the face box, the five skin patches where they actually
 * land, the sampled face width, and the per-control claim/refusal list.
 *
 * AN OVERLAY THAT LIES IS WORSE THAN NO OVERLAY, so the headline pin here is
 * PARITY: faceLiveMeasure must return byte-identical receipts/boxes/claims to
 * the direct captureSquare -> faceReadPortrait path the snap takes. The rest
 * pins the seven traps, each verified against the shipped bytes before this
 * train:
 *   L1  PARITY - live numbers === snap numbers on the same frame.
 *   L2  the loop feeds captureSquare's canvas, NEVER the <video> (a video has
 *       no naturalWidth; the reader would measure the top-left corner).
 *   L3  rAF only, throttled to 125ms; no setInterval (module-wide ban), and
 *       the loop SELF-TERMINATES on !video.isConnected AND stops the camera -
 *       the tab-switch leak (video destroyed without Cancel, LED stays lit)
 *       is fixed at the tab handler too, and the pre-fix bytes are the RED.
 *   L4  the overlay canvas is CSS-mirrored exactly like the video (estimator
 *       coordinates are unmirrored image space) and carries GEOMETRY ONLY -
 *       text on a mirrored canvas renders backwards.
 *   L5  the wrapper is position:relative inside camHost (.mlsAvPanel has no
 *       position - an unwrapped absolute overlay escapes to the fixed
 *       backdrop and lands on the viewport).
 *   L6  ADOPTION - no new getUserMedia (the consent proof counts calls), no
 *       network calls, no faceApplyDerived, in the live block's CODE.
 *   L7  the object-fit:cover coincidence is PINNED: the square preview shows
 *       the same centre crop captureSquare takes, so the overlay mapping is a
 *       pure scale with no offset - if either side changes, this fails.
 *   L8  canvas reuse is opt-IN on captureSquare (flag-on-a-shared-helper law)
 *       and the live loop uses it; the snap path still gets fresh canvases.
 *   L9  FACE_LIVE_ORDER === EXAMINABLE, lexically - the list the doctor
 *       watches live is the list the receipt counts.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(root, 'feat_mls_avatar.js'), 'utf8');

let pass = 0;
function ok(cond, msg) { assert.ok(cond, msg); pass++; }
function eq(a, b, msg) { assert.strictEqual(a, b, msg); pass++; }

const BASE_COMMIT = 'c0ce69e46f60fd01262a260ddf60502851a7c139';
let BASE = null;
try {
  BASE = execFileSync('git', ['show', BASE_COMMIT + ':feat_mls_avatar.js'],
    { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
} catch (e) { /* asserted below */ }
ok(!!BASE && BASE.length > 100000, 'pre-fix baseline unreadable - the leak control below would be vacuous');

/* ── the live block, lexically ── */
const liveStart = SRC.indexOf('/* ---- LIVE CAPTURE VIEW (lv-1.0)');
const liveEnd = SRC.indexOf('/* ---- end live capture view ---- */');
ok(liveStart > 0 && liveEnd > liveStart, 'the live capture block anchors are missing');
const LIVE = SRC.slice(liveStart, liveEnd);
const LIVE_CODE = LIVE.replace(/\/\*[\s\S]*?\*\//g, ' ');

/* ═══ L6 — adoption and purity, on comment-stripped CODE ═══ */
ok(!/getUserMedia/.test(LIVE_CODE), 'L6: the live block requests the camera itself - the consent proof counts getUserMedia calls and this would break it');
ok(!/fetch\s*\(|\bapi\s*\(/.test(LIVE_CODE), 'L6: the live block makes a network call - the measurement copy is deliberately device-local, and 8 posts/second would ship the doctor\'s face to the backend');
ok(!/faceApplyDerived/.test(LIVE_CODE), 'L6: the live loop applies the derived look - repainting 8x/sec destroys the staleness signal fx-1.0 exists for');
ok(!/setInterval\s*\(/.test(LIVE_CODE), 'L6: the live loop uses a timer - the contract suite bans setInterval module-wide');
ok(/requestAnimationFrame\(tick\)/.test(LIVE_CODE), 'L3: the loop is not an rAF loop');
ok(/LIVE_MS = 125/.test(LIVE_CODE), 'L3: the 125ms cadence moved - it matches grabBestFrame\'s own 120ms step so the doctor watches at the rate the shot is averaged over');
ok(/!video\.isConnected/.test(LIVE_CODE) && /stopCamera\(\)/.test(LIVE_CODE),
  'L3: the loop no longer self-terminates when the video leaves the DOM (and stops the camera as it dies)');

/* ═══ L2 — the reader is fed captureSquare's canvas, never the video ═══ */
ok(/captureSquare\(video, MEASURE_MAX, faceLiveCanvas\)/.test(LIVE_CODE),
  'L2: faceLiveMeasure does not capture through captureSquare at MEASURE_MAX with the reused canvas');
ok(!/faceReadPortrait\(video\)/.test(LIVE_CODE),
  'L2: the <video> is passed to faceReadPortrait - it has no naturalWidth, so the reader would measure the top-left 128px corner of the frame while looking perfectly correct');

/* ═══ L3b — the tab-switch camera leak is fixed, with the pre-fix RED ═══ */
function tabHandler(src) {
  const i = src.indexOf('defs.forEach(function (def, index)');
  const j = src.indexOf('panel.appendChild(tabs)', i);
  return src.slice(i, j);
}
ok(/stopCamera\(\)/.test(tabHandler(SRC)),
  'L3b: switching tabs no longer stops the camera - the video is destroyed without Cancel and the LED stays lit');
ok(!/stopCamera\(\)/.test(tabHandler(BASE)),
  'L3b-control: the pre-fix tab handler was expected to LACK stopCamera (the measured leak); if it has it, this pin is decoration');

/* ═══ L4/L5 — mount and mirroring ═══ */
const camWrapBlock = (function () {
  const i = SRC.indexOf('var camWrap = make(');
  ok(i > 0, 'L5: the camWrap wrapper is missing');
  return SRC.slice(i, SRC.indexOf('faceLiveLoopStart(', i));
})();
ok(/position:relative/.test(camWrapBlock), 'L5: the wrapper is not position:relative - the absolute overlay would escape to the fixed backdrop and land on the viewport');
ok(!/position:fixed/.test(camWrapBlock), 'L5: something in the camera mount is position:fixed - the panel is a scroller');
ok(/overlay\.style\.cssText = '[^']*transform:scaleX\(-1\)/.test(SRC),
  'L4: the overlay canvas is not CSS-mirrored - drawn straight on, the box points at the wrong cheek');
ok(/video\.style\.cssText = '[^']*transform:scaleX\(-1\)/.test(SRC),
  'L4: the video preview lost its mirror - the overlay mirroring is calibrated against it');
ok(!/fillText|strokeText/.test(LIVE_CODE),
  'L4: text is drawn on the mirrored canvas - it renders backwards; words belong in the DOM lines');

/* ═══ L7 — the centre-crop coincidence is pinned on both sides ═══ */
ok(/video\.style\.cssText = '[^']*object-fit:cover/.test(SRC),
  'L7: the preview lost object-fit:cover - the on-screen crop would no longer be the crop captureSquare measures, and the overlay mapping gains an offset nothing here computes');
ok(/\(vw - side\) \/ 2, \(vh - side\) \/ 2, side, side/.test(SRC),
  'L7: captureSquare no longer takes the centred square crop the preview shows');

/* ═══ L9 — the live list is the receipt's list ═══ */
function litArray(src, name) {
  const m = new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "\\s*=\\s*\\[([^\\]]+)\\]").exec(src);
  return m ? m[1].replace(/\s|'/g, '') : null;
}
eq(litArray(SRC, 'var FACE_LIVE_ORDER'), litArray(SRC, 'var EXAMINABLE'),
  'L9: FACE_LIVE_ORDER and EXAMINABLE disagree - the list the doctor watches live must be the list the receipt counts');

/* ═══ EXECUTION: extraction of the live block + reader under stubs ═══ */
function element() {
  const el = {
    width: 0, height: 0, textContent: '', className: '', disabled: false,
    children: [], style: {},
    appendChild(c) { el.children.push(c); return c; },
    getContext() {
      if (!el.__ctx) {
        const ops = [];
        el.__ctx = {
          __ops: ops, lineWidth: 0, strokeStyle: '',
          drawImage(img) {
            /* video -> canvas (from __rgba) AND canvas -> canvas (from the
               source canvas's own stored pixels). When the destination is a
               different size (frameQuality's 96px copy), box-average like a
               real canvas would - a passthrough there inflated the exposure
               mean 7x and every quality verdict with it. Crop offsets are 0
               for every square fixture here. */
            const src = img.__rgba || (img.__ctx && img.__ctx._d);
            if (!src) { el.__ctx._d = null; ops.push(['drawImage']); return; }
            const srcN = Math.round(Math.sqrt(src.length / 4));
            const dstN = el.width || srcN;
            if (dstN === srcN) { el.__ctx._d = src.slice(); ops.push(['drawImage']); return; }
            const out = new Uint8ClampedArray(dstN * dstN * 4);
            const k = srcN / dstN;
            for (let y = 0; y < dstN; y++) {
              for (let x = 0; x < dstN; x++) {
                let r = 0, g = 0, b = 0, n = 0;
                const y1 = Math.min(srcN, Math.ceil((y + 1) * k)), x1 = Math.min(srcN, Math.ceil((x + 1) * k));
                for (let yy = Math.floor(y * k); yy < y1; yy++) {
                  for (let xx = Math.floor(x * k); xx < x1; xx++) {
                    const i = (yy * srcN + xx) * 4; r += src[i]; g += src[i + 1]; b += src[i + 2]; n++;
                  }
                }
                const o = (y * dstN + x) * 4;
                out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = 255;
              }
            }
            el.__ctx._d = out;
            ops.push(['drawImage']);
          },
          getImageData() { return { data: el.__ctx._d }; },
          clearRect(...a) { ops.push(['clearRect', ...a]); },
          strokeRect(...a) { ops.push(['strokeRect', ...a, el.__ctx.strokeStyle]); },
          beginPath() { ops.push(['beginPath']); },
          moveTo(...a) { ops.push(['moveTo', ...a]); },
          lineTo(...a) { ops.push(['lineTo', ...a]); },
          stroke() { ops.push(['stroke']); }
        };
      }
      return el.__ctx;
    }
  };
  return el;
}
const rafQ = [];
function extractLive(src, tag) {
  function sliceBetween(a, b, label) {
    const i = src.indexOf(a);
    ok(i >= 0, tag + ': anchor "' + label + '" not found');
    const j = src.indexOf(b, i);
    ok(j > i, tag + ': end anchor "' + label + '" not found');
    return src.slice(i, j);
  }
  const tables = sliceBetween('var FACE_LOOK = {', 'function faceShade', 'tables');
  const helpers = sliceBetween('function faceShade', 'var FACE_MOUTHS', 'helpers');
  const lab = sliceBetween('function faceIsSkinRgb', 'function faceReadPortrait', 'lab');
  const reader = sliceBetween('function faceReadPortrait', 'function faceTalkStop', 'reader');
  const cam = sliceBetween('var cameraStream = null;', 'function stylizeCanvas', 'camera+live');
  const doc = { createElement: () => element() };
  const raf = f => { rafQ.push(f); return rafQ.length; };
  const mod = new Function('document', 'requestAnimationFrame',
    '"use strict";\n' +
    /* the module's own safe(): try/catch with a default - frameQuality rides it */
    'function safe(f, d) { try { return f(); } catch (e) { return d; } }\n' +
    tables + '\n' + helpers + '\n' + lab + '\n' + reader + '\n' + cam +
    '\nreturn { read: faceReadPortrait, captureSquare: captureSquare, frameQuality: frameQuality,' +
    ' MEASURE_MAX: MEASURE_MAX, faceLiveMeasure: faceLiveMeasure, faceLiveReady: faceLiveReady,' +
    ' faceLiveNudge: faceLiveNudge, faceLiveOverlayPaint: faceLiveOverlayPaint,' +
    ' faceLiveStatusRender: faceLiveStatusRender, faceLiveLoopStart: faceLiveLoopStart,' +
    ' __camSet: function (s) { cameraStream = s; }, __camGet: function () { return cameraStream; } };')(doc, raf);
  return mod;
}
const MOD = extractLive(SRC, 'live');

/* ── fixture: a 256 head as a fake <video> (square stream) ── */
function fakeVideo(S, big) {
  const N = 128 * S;
  const v = { videoWidth: N, videoHeight: N, isConnected: true, __rgba: new Uint8ClampedArray(N * N * 4), __reads: 0 };
  const put = (x, y, c) => { if (x < 0 || y < 0 || x >= N || y >= N) return; const i = (y * N + x) * 4; v.__rgba[i] = c[0]; v.__rgba[i + 1] = c[1]; v.__rgba[i + 2] = c[2]; v.__rgba[i + 3] = 255; };
  const rect = (x0, y0, x1, y1, c) => { for (let y = y0 * S; y <= y1 * S + (S - 1); y++) for (let x = x0 * S; x <= x1 * S + (S - 1); x++) put(x, y, c); };
  const ell = (cx, cy, rx, ry, c) => { for (let y = Math.floor((cy - ry) * S); y <= Math.ceil((cy + ry) * S); y++) for (let x = Math.floor((cx - rx) * S); x <= Math.ceil((cx + rx) * S); x++) { const dx = (x / S - cx) / rx, dy = (y / S - cy) / ry; if (dx * dx + dy * dy <= 1) put(x, y, c); } };
  const hx = h => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const HAIR = hx('#3a2a1b'), SKIN = hx('#c68e6f');
  const rx = big ? 26 : 20, ry = big ? 30 : 26;
  rect(0, 0, 127, 127, hx('#b9c0c4'));
  ell(64, 66, rx, ry, SKIN);
  rect(64 - rx + 2, 36, 64 + rx - 2, 40, HAIR);
  ell(64, 41, rx, 6, HAIR);
  rect(57, 66 + ry - 2, 71, 112, SKIN);
  rect(51, 56, 59, 57, hx('#241a12')); rect(69, 56, 77, 57, hx('#241a12'));
  rect(40, 116, 88, 127, hx('#4a6a8a'));
  /* deterministic sensor grain (LCG, no Math.random): a flat synthetic has
     ~zero gradient energy and frameQuality would call every frame blurred -
     real camera frames carry noise, and ±6 is well under any colour gate's
     tolerance while lifting mean |gradient| far past the 2.2 sharpness floor */
  let seed = 12345;
  for (let i = 0; i < v.__rgba.length; i += 4) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const n = (seed % 13) - 6;
    v.__rgba[i] += n; v.__rgba[i + 1] += n; v.__rgba[i + 2] += n;
  }
  return v;
}

/* ═══ L1 — PARITY: the live read IS the snap read ═══ */
{
  const v = fakeVideo(2, false);
  const m = MOD.faceLiveMeasure(v);
  ok(m && m.res && m.res.receipt, 'L1: faceLiveMeasure returned nothing on a readable frame');
  const direct = MOD.read(MOD.captureSquare(v, MOD.MEASURE_MAX));
  eq(JSON.stringify(m.res.receipt), JSON.stringify(direct.receipt),
    'L1: the live receipt differs from the snap-path receipt on the same frame - the overlay is lying');
  eq(JSON.stringify(m.res.box), JSON.stringify(direct.box),
    'L1: the live box differs from the snap-path box on the same frame');
  eq(JSON.stringify(m.res.derived), JSON.stringify(direct.derived),
    'L1: the live claims differ from the snap-path claims on the same frame');
  eq(m.res.receipt.grid, 256, 'L1: a 256 stream must be measured on the 256 grid live');
}

/* ═══ L8 — canvas reuse is opt-in and the default stays fresh ═══ */
{
  const v = fakeVideo(2, false);
  const shared = element();
  const c1 = MOD.captureSquare(v, 1024, shared);
  const c2 = MOD.captureSquare(v, 1024, shared);
  ok(c1 === shared && c2 === shared, 'L8: the into parameter is not reused');
  const f1 = MOD.captureSquare(v, 1024);
  const f2 = MOD.captureSquare(v, 1024);
  ok(f1 !== f2, 'L8: captureSquare without `into` no longer allocates fresh - the snap path silently shares state');
}

/* ═══ ready/nudge behaviour ═══ */
{
  const small = MOD.faceLiveMeasure(fakeVideo(2, false));
  const big = MOD.faceLiveMeasure(fakeVideo(2, true));
  ok(!MOD.faceLiveReady(small.res, small.q),
    'ready: a face under 34% of the grid must NOT read as good - the brow floor needs faceW >= 0.34*grid');
  ok(MOD.faceLiveReady(big.res, big.q),
    'ready: the well-framed fixture (faceW ' + big.res.receipt.faceW + ' of ' + big.res.receipt.grid + ') must read as good');
  const nsmall = MOD.faceLiveNudge(small.res, small.q);
  ok(/Move closer/.test(nsmall) && nsmall.indexOf('of 256') > 0,
    'nudge: a small face must say Move closer with the measured numbers (got: ' + nsmall + ')');
  eq(MOD.faceLiveNudge(big.res, big.q), '', 'nudge: a good frame must not nag');
  ok(/Too dark/.test(MOD.faceLiveNudge(big.res, { sharp: 5, exposure: 20 })),
    'nudge: a dark frame must name the light');
}

/* ═══ L4b — the overlay draws the box and all five patches, geometry only ═══ */
{
  const m = MOD.faceLiveMeasure(fakeVideo(2, true));
  const overlay = element(); overlay.width = 200; overlay.height = 200;
  MOD.faceLiveOverlayPaint(overlay, m.res, true);
  const ops = overlay.getContext('2d').__ops;
  eq(ops[0][0], 'clearRect', 'overlay: every tick must start from a clean canvas');
  const rects = ops.filter(o => o[0] === 'strokeRect');
  eq(rects.length, 6, 'overlay: expected the face box + 5 patch squares, got ' + rects.length + ' rects');
  const s = 200 / m.res.box.grid;
  const b = m.res.box;
  ok(Math.abs(rects[0][1] - b.L * s) < 0.01 && Math.abs(rects[0][2] - b.T * s) < 0.01,
    'overlay: the face box is not drawn at the scaled box position');
  const pr = b.patchR;
  m.res.box.skinSpots.forEach((sp, i) => {
    const r = rects[i + 1];
    ok(Math.abs(r[1] - (sp[0] - pr) * s) < 0.01 && Math.abs(r[2] - (sp[1] - pr) * s) < 0.01,
      'overlay: patch ' + i + ' is not drawn where the reader sampled it - the diagnostic instrument would lie');
  });
}

/* ═══ status/list rendering ═══ */
{
  const m = MOD.faceLiveMeasure(fakeVideo(2, true));
  const ui = { status: element(), list: element(), snapBtn: element() };
  ui.snapBtn.textContent = 'Snap photo';
  MOD.faceLiveStatusRender(ui, m.res, m.q, true);
  ok(ui.status.textContent.indexOf('Face width: ' + m.res.receipt.faceW + ' of ' + m.res.receipt.grid) === 0,
    'status: the face-width line must lead with the measured numbers (got: ' + ui.status.textContent + ')');
  eq(ui.list.children.length, 14, 'list: all 14 controls must be rendered');
  const claimedRows = ui.list.children.filter(c => c.className === 'on');
  eq(claimedRows.length, m.res.receipt.claimed, 'list: the highlighted rows must equal the receipt\'s claimed count');
  ok(/frame looks good/.test(ui.snapBtn.textContent), 'shutter: the snap button must say the frame is good when ready');
  MOD.faceLiveStatusRender(ui, m.res, m.q, false);
  ok(!/frame looks good/.test(ui.snapBtn.textContent), 'shutter: the good marking must clear when the frame stops being good');
}

/* ═══ L3c — the loop throttles, self-terminates, and kills the camera ═══ */
{
  rafQ.length = 0;
  const v = fakeVideo(2, true);
  let stopped = 0;
  MOD.__camSet({ getTracks: () => [{ stop() { stopped++; } }] });
  const overlay = element(); overlay.width = 200; overlay.height = 200;
  const ui = { status: element(), list: element(), snapBtn: element() };
  MOD.faceLiveLoopStart(v, overlay, ui);
  eq(rafQ.length, 1, 'loop: faceLiveLoopStart must arm exactly one rAF');
  const baselineOps = overlay.getContext('2d').__ops.length;
  rafQ.shift()(0);                       /* first tick: measures */
  const afterFirst = overlay.getContext('2d').__ops.length;
  ok(afterFirst > baselineOps, 'loop: the first tick must paint');
  rafQ.shift()(50);                      /* 50ms later: throttled, no paint */
  eq(overlay.getContext('2d').__ops.length, afterFirst, 'loop: a tick inside the 125ms window must not re-measure - 60Hz would burn a core');
  rafQ.shift()(200);                     /* past the window: paints again */
  ok(overlay.getContext('2d').__ops.length > afterFirst, 'loop: a tick past the window must measure');
  v.isConnected = false;
  rafQ.shift()(400);
  eq(rafQ.length, 0, 'loop: the loop must NOT re-arm after the video leaves the DOM');
  ok(stopped > 0 && MOD.__camGet() === null,
    'loop: the dying loop must stop the camera - the tab-switch teardown leaked the stream and kept the LED lit');
}

console.log('avatar-live-capture-overlay: PASS (' + pass + ' assertions)');
