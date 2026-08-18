'use strict';

/*
 * HOW MANY OF THE FOURTEEN A REAL WEBCAM FRAME CAN ACTUALLY SUPPLY
 * (drives the real 1p reader in real Chrome; /1p only, PHI-free, synthetic).
 *
 * Owner, 2026-08-17: "No animated traits changed · 5 of 14 details were
 * readable ... this is unacceptable and always happens."
 *
 * WHY THE EXISTING PROOFS COULD NOT ANSWER HIM. Every photo-match harness in
 * this tree hands faceReadPortrait a SQUARE with the head already filling it —
 * avatar-photo-match-proof draws rx 0.29/ry 0.33 centred, and even the
 * "framed" proof draws its camera transform into a 256 square. The real camera
 * path does something neither of them models: captureSquare centre-crops the
 * WHOLE 16:9 webcam frame and measures that. So the one variable that decides
 * whether a doctor sees "5 of 14" — how much of his own camera frame his head
 * occupies at ordinary sitting distance — had never been a variable in any
 * harness.
 *
 * This file makes it the variable. It draws a room, a person and a laptop lid
 * at 640x480 and 1280x720 with the head at 15/22/30/35% of FRAME HEIGHT, runs
 * the exact sequence the shutter runs (frameQuality -> faceReadPortrait ->
 * faceCaptureVerdict -> faceFitApply, through window.__mlsAvatar.captureFit),
 * and prints the before/after readability table.
 *
 * WHAT IT ASSERTS, and nothing more:
 *   1. THE TOTAL REFUSALS ARE GONE. Head at 15% of frame height read 0 of 14
 *      at both frame sizes before the fit — no face found at all. After it,
 *      they are readable.
 *   2. NOTHING GOT WORSE. No fixture may lose a claim to the re-crop; that is
 *      the acceptance rule faceFitBetter enforces, measured end to end.
 *   3. ⛔ THE CANARY STILL REFUSES. A head at 4% of frame height — the
 *      12-pixel-face class — must not be cropped, upscaled and then described.
 *
 * ⛔ WHAT IT DELIBERATELY DOES NOT ASSERT: a floor of ten claimed controls.
 * Measured here, five of the fourteen ledger entries are claimable only when
 * the feature is PRESENT (beard, glasses, hairline, browCol) or never
 * (faceShape is measured and deliberately excluded from `derived`). A
 * clean-shaven doctor with no glasses, a full hairline and brows the colour of
 * his hair cannot reach ten without the matcher claiming ABSENCES, which is
 * the one thing [[avatar-lane-absorbed-2026-08-11]] forbids. The table below
 * reports the real ceiling instead of asserting a reachable-looking one.
 *
 * Registered in run-all: it launches Chrome, like the two proofs beside it.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const ROOT = process.env.MLS_AVATAR_DIR || path.resolve(__dirname, '..');
const ASSET = process.env.MLS_AVATAR_ASSET || '1p-feat_mls_avatar.js';
let passed = 0;
function ok(value, message) { assert.ok(value, message); passed++; }
function eq(actual, expected, message) { assert.strictEqual(actual, expected, message); passed++; }

/* The fixture is defined as a STRING and evaluated in the page, so the drawing
   code and the reader share one canvas implementation — a fixture built in
   node and shipped as pixels would not exercise the same downscale filter. */
const FIXTURE = function () {
  /* A ROOM, A PERSON AND A LAPTOP LID. Everything anatomical is drawn relative
     to the head, so the same person is drawn at every distance and the only
     variable is how much of the frame he occupies. */
  window.__fitFrame = function (o) {
    const W = o.w, H = o.h;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d');
    const dim = o.dim || 1;
    function tint(hex) {
      const n = parseInt(hex.slice(1), 16);
      return 'rgb(' + Math.round(((n >> 16) & 255) * dim) + ',' +
        Math.round(((n >> 8) & 255) * dim) + ',' + Math.round((n & 255) * dim) + ')';
    }
    x.fillStyle = tint(o.bg || '#d8d5cd'); x.fillRect(0, 0, W, H);
    x.fillStyle = tint(o.ceiling || '#e9e7e1'); x.fillRect(0, 0, W, H * 0.16);
    const headH = H * o.headFrac, ry = headH / 2, rx = ry * 0.72;
    const cx = W / 2 + W * (o.dx || 0), cy = H * (o.cyFrac == null ? 0.44 : o.cyFrac);
    x.fillStyle = tint(o.shirt || '#2f5f86');
    x.beginPath(); x.ellipse(cx, cy + ry * 2.5, rx * 3.0, ry * 1.5, 0, 0, 7); x.fill();
    x.fillStyle = tint(o.skin);
    x.fillRect(cx - rx * 0.34, cy + ry * 0.80, rx * 0.68, ry * 0.85);
    x.beginPath(); x.ellipse(cx, cy, rx, ry, 0, 0, 7); x.fill();
    x.beginPath(); x.ellipse(cx - rx, cy + ry * 0.05, rx * 0.13, ry * 0.16, 0, 0, 7); x.fill();
    x.beginPath(); x.ellipse(cx + rx, cy + ry * 0.05, rx * 0.13, ry * 0.16, 0, 0, 7); x.fill();
    if (o.hair) {
      x.fillStyle = tint(o.hair);
      x.beginPath(); x.ellipse(cx, cy - ry * 0.66, rx * 1.03, ry * 0.42, 0, 0, 7); x.fill();
      if (o.longHair) {
        x.fillRect(cx - rx * 1.12, cy - ry * 0.5, rx * 0.24, ry * 1.7);
        x.fillRect(cx + rx * 0.88, cy - ry * 0.5, rx * 0.24, ry * 1.7);
      }
    }
    x.fillStyle = tint(o.browCol || o.hair || '#3a2a1c');
    x.fillRect(cx - rx * 0.62, cy - ry * 0.26, rx * 0.34, ry * 0.065);
    x.fillRect(cx + rx * 0.28, cy - ry * 0.26, rx * 0.34, ry * 0.065);
    const eyeDx = rx * 0.44, eyeY = cy - ry * 0.10;
    [-1, 1].forEach(function (s) {
      x.fillStyle = 'rgb(250,248,245)';
      x.beginPath(); x.ellipse(cx + s * eyeDx, eyeY, rx * 0.20, ry * 0.085, 0, 0, 7); x.fill();
      x.fillStyle = tint(o.eyes || '#4a3423');
      x.beginPath(); x.ellipse(cx + s * eyeDx, eyeY, rx * 0.095, ry * 0.080, 0, 0, 7); x.fill();
      x.fillStyle = 'rgb(20,16,14)';
      x.beginPath(); x.ellipse(cx + s * eyeDx, eyeY, rx * 0.045, ry * 0.040, 0, 0, 7); x.fill();
    });
    x.fillStyle = 'rgba(0,0,0,0.20)';
    x.beginPath(); x.ellipse(cx - rx * 0.10, cy + ry * 0.30, rx * 0.055, ry * 0.035, 0, 0, 7); x.fill();
    x.beginPath(); x.ellipse(cx + rx * 0.10, cy + ry * 0.30, rx * 0.055, ry * 0.035, 0, 0, 7); x.fill();
    x.fillStyle = 'rgba(0,0,0,0.10)';
    x.fillRect(cx + rx * 0.03, cy - ry * 0.02, rx * 0.09, ry * 0.32);
    x.fillStyle = tint(o.lip || '#a95f47');
    x.beginPath(); x.ellipse(cx, cy + ry * 0.53, rx * 0.30, ry * 0.065, 0, 0, 7); x.fill();
    if (o.beard) {
      x.fillStyle = tint(o.beard);
      x.beginPath(); x.ellipse(cx, cy + ry * 0.62, rx * 0.72, ry * 0.36, 0, 0, 7); x.fill();
      x.fillStyle = tint(o.lip || '#a95f47');
      x.beginPath(); x.ellipse(cx, cy + ry * 0.53, rx * 0.30, ry * 0.065, 0, 0, 7); x.fill();
    }
    if (o.glasses) {
      x.strokeStyle = 'rgb(30,28,26)'; x.lineWidth = Math.max(1, rx * 0.045);
      [-1, 1].forEach(function (s) {
        x.beginPath(); x.ellipse(cx + s * eyeDx, eyeY, rx * 0.26, ry * 0.15, 0, 0, 7); x.stroke();
      });
      x.beginPath(); x.moveTo(cx - eyeDx + rx * 0.26, eyeY); x.lineTo(cx + eyeDx - rx * 0.26, eyeY); x.stroke();
    }
    return c;
  };
  /* captureSquare's own rule, so the "before" column is the frame the shutter
     really measured: centre square, never upscaled, MEASURE_MAX 1024. */
  window.__fitCaptureSquare = function (canvas) {
    const side = Math.min(canvas.width, canvas.height);
    const px2 = Math.max(64, Math.min(1024, side));
    const c = document.createElement('canvas'); c.width = px2; c.height = px2;
    const x = c.getContext('2d');
    x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
    x.drawImage(canvas, (canvas.width - side) / 2, (canvas.height - side) / 2, side, side, 0, 0, px2, px2);
    return c;
  };
};

(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e && e.message)));
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, r => r.abort());
  await page.setContent('<div id="visitView"></div>');
  await page.evaluate(() => {
    window.toast = () => {}; window.getPatients = () => []; window.getActivePtId = () => '';
    window.__mlsSessionEpoch = 91;
    window.__mlsSessionAccount = 'avatar-capture-proof@example.test';
    window.bkToken = () => 'synthetic-avatar-capture-proof-token';
    window.requestIdleCallback = window.requestIdleCallback || (f => setTimeout(f, 0));
  });
  const assetSource = fs.readFileSync(path.join(ROOT, ASSET), 'utf8');
  await page.evaluate(({ assetSource, asset }) => {
    const script = document.createElement('script');
    script.setAttribute('data-mls-install-token', 'synthetic-avatar-capture-proof-install');
    script.setAttribute('data-mls-asset', asset);
    script.textContent = assetSource;
    document.head.appendChild(script);
  }, { assetSource, asset: ASSET });
  await page.waitForTimeout(300);
  await page.evaluate(FIXTURE);

  const out = await page.evaluate(() => {
    const owner = window.__mlsAvatar;
    if (!owner || typeof owner.captureFit !== 'function') return { error: 'NO_CAPTURE_FIT' };
    const SKIN = { fair: '#f0c8a0', tan: '#e8b98c', midbrown: '#c68642', deep: '#8d5524' };
    const base = { skin: SKIN.fair, hair: '#3a2a1c', lip: '#a95f47', eyes: '#4a3423', shirt: '#2f5f86' };
    const cases = [];
    [[640, 480], [1280, 720]].forEach(wh => [0.15, 0.22, 0.30, 0.35].forEach(hf =>
      cases.push(Object.assign({ name: wh[0] + 'x' + wh[1] + ' head ' + Math.round(hf * 100) + '%',
        w: wh[0], h: wh[1], headFrac: hf }, base))));
    cases.push(Object.assign({ name: '1280x720 head 30% beard', w: 1280, h: 720, headFrac: 0.30,
      hair: '#241a12', beard: '#241a12' }, base));
    cases.push(Object.assign({ name: '1280x720 head 30% glasses', w: 1280, h: 720, headFrac: 0.30,
      glasses: true }, base));
    cases.push(Object.assign({ name: '1280x720 head 30% mid-brown skin', w: 1280, h: 720, headFrac: 0.30 },
      base, { skin: SKIN.midbrown, hair: '#1c1410', lip: '#8a4a3a' }));
    cases.push(Object.assign({ name: '1280x720 head 30% deep skin', w: 1280, h: 720, headFrac: 0.30 },
      base, { skin: SKIN.deep, hair: '#120d0a', lip: '#6d3a2e' }));
    cases.push(Object.assign({ name: '1280x720 head 30% dim room', w: 1280, h: 720, headFrac: 0.30, dim: 0.62 }, base));
    cases.push(Object.assign({ name: '1280x720 head 30% long hair', w: 1280, h: 720, headFrac: 0.30,
      longHair: true, hair: '#5a3a20' }, base));
    cases.push(Object.assign({ name: '1280x720 head 30% off-centre', w: 1280, h: 720, headFrac: 0.30, dx: -0.14 }, base));
    cases.push(Object.assign({ name: 'CANARY 1280x720 head 4%', w: 1280, h: 720, headFrac: 0.04, canary: true }, base));
    cases.push(Object.assign({ name: 'CANARY beige wall, no face', w: 1280, h: 720, headFrac: 0.30,
      canary: true, wall: true, bg: '#f5e6d3', ceiling: '#f5e6d3' }, base));
    return { rows: cases.map(cs => {
      const square = window.__fitCaptureSquare(
        cs.wall ? (function () {
          /* ⛔ THE CONFIDENTLY-WRONG CASE. #f5e6d3 is the beige WALL this
             project has measured walking through the skin mask twice — it
             passes the YCbCr window and the hue band, and on one real
             photograph the detector chose a wall instead of the face. Nothing
             here is a face: no crop may be planned and no trait may be
             claimed. */
          const c = document.createElement('canvas'); c.width = cs.w; c.height = cs.h;
          const x = c.getContext('2d');
          x.fillStyle = '#f5e6d3'; x.fillRect(0, 0, cs.w, cs.h);
          x.fillStyle = '#efdfc9'; x.fillRect(0, cs.h * 0.55, cs.w, cs.h * 0.45);
          x.fillStyle = '#c8b49a'; x.fillRect(cs.w * 0.62, 0, cs.w * 0.06, cs.h);
          return c;
        }()) : window.__fitFrame(cs));
      const fit = owner.captureFit(square);
      return { name: cs.name, canary: cs.canary === true, fit: fit };
    }) };
  });

  await browser.close();
  if (errs.length) throw new Error('page errors: ' + errs.slice(0, 3).join(' | '));
  if (out.error) throw new Error(out.error + ' — the capture-fit surface is not published');

  /* ---- THE TABLE (this is the deliverable; the assertions follow) -------- */
  console.log('');
  console.log('READABILITY AT REAL WEBCAM FRAMING — claimed of 14, and the face width the reader had');
  console.log('  fixture                              before        after         crop');
  out.rows.forEach(r => {
    const b = r.fit.before, a = r.fit.after;
    console.log('  ' + r.name.padEnd(36) +
      (b.claimed + '/14 f=' + b.faceFrac.toFixed(2)).padEnd(14) +
      (a.claimed + '/14 f=' + a.faceFrac.toFixed(2)).padEnd(14) +
      (r.fit.fitted ? (r.fit.srcPx + '→' + r.fit.outPx + 'px') : ('not cropped — ' + r.fit.why)));
  });
  console.log('');

  /* ---- 1. THE FAR FRAMINGS ---------------------------------------------
     At head 15% of frame height — a doctor sitting back from the laptop lid —
     the whole-frame reader finds NO FACE AT ALL: 0 of 14 at both frame sizes.
     ⛔ THE FIRST VERSION OF THIS SECTION ASSERTED THAT NOTHING COULD BE DONE
     ABOUT IT, and it was right about the mechanism it had: a crop derived from
     the READER'S box cannot run when the reader has no box. avfit-1.1.0 locates
     the face by STRUCTURE instead, which needs no box and no colour, so these
     two are now rescued — and the record of the earlier limit stays here
     because it is the reason the locator exists. */
  const far = out.rows.filter(r => /head 15%/.test(r.name));
  eq(far.length, 2, 'the two far-framing fixtures are missing from the sweep');
  far.forEach(r => {
    eq(r.fit.before.claimed, 0,
      r.name + ' — the fixture no longer reproduces the total refusal, so nothing below proves anything');
    ok(r.fit.located, r.name + ' — the structure locator found nothing: ' + r.fit.locateWhy);
    ok(r.fit.fitted, r.name + ' — no candidate crop was kept: ' + r.fit.why);
    ok(r.fit.after.claimed >= 5,
      r.name + ' — after the crop it reads only ' + r.fit.after.claimed + ' of 14; a doctor sitting back still gets nothing');
    ok(r.fit.after.faceFrac >= 0.30,
      r.name + ' — the crop left the face at ' + r.fit.after.faceFrac + ' of the grid');
  });
  /* …and the guide still tells him to move closer, because a crop is a repair
     and a well-framed shot is better than a repaired one. */
  const guide = out.rows.filter(r => /head 15%/.test(r.name))[0];
  eq(guide.fit.before.fit.ready, false, 'the framing guide calls an unreadable whole frame ready');
  ok(/oval/i.test(guide.fit.before.fit.say),
    'the guide does not point the doctor at the oval it draws; it said "' + guide.fit.before.fit.say + '"');
  ok(/closer|fill/i.test(guide.fit.before.fit.say),
    'the guide never tells the doctor to move closer');

  /* THE FRAMINGS THE CROP DOES RESCUE — the ordinary 22% laptop distance. */
  const midRange = out.rows.filter(r => /head 22%/.test(r.name));
  eq(midRange.length, 2, 'the 22% fixtures are missing from the sweep');
  midRange.forEach(r => {
    ok(r.fit.fitted, r.name + ' — an ordinary laptop framing was left uncropped: ' + r.fit.why);
    ok(r.fit.after.faceFrac >= 0.34,
      r.name + ' — the crop left the face at ' + r.fit.after.faceFrac + ' of the grid, under the readable target');
    ok(r.fit.after.faceFrac > r.fit.before.faceFrac * 1.5,
      r.name + ' — the crop barely moved the face size it exists to move');
  });

  /* ---- 2. NOTHING GOT WORSE --------------------------------------------- */
  out.rows.filter(r => !r.canary).forEach(r => {
    ok(r.fit.after.claimed >= r.fit.before.claimed,
      r.name + ' — the re-crop LOST claims (' + r.fit.before.claimed + ' -> ' + r.fit.after.claimed +
      '), which faceFitBetter is supposed to make impossible');
    if (r.fit.fitted) ok(r.fit.after.faceFrac > r.fit.before.faceFrac,
      r.name + ' — a crop was adopted that did not enlarge the face');
  });
  const ordinary = out.rows.filter(r => /head 30%/.test(r.name) && !r.canary);
  ok(ordinary.length >= 6, 'the ordinary-distance variants are missing from the sweep');
  ok(ordinary.every(r => r.fit.after.claimed >= 5),
    'an ordinary laptop framing reads fewer than five of fourteen after the fit');

  /* ---- 3. ⛔ THE TWO CANARIES ------------------------------------------- */
  const tiny = out.rows.filter(r => /head 4%/.test(r.name))[0];
  ok(tiny, 'the 12-pixel-face canary is missing');
  eq(tiny.fit.fitted, false,
    'a head at 4% of frame height WAS cropped and upscaled — [[face-matcher-measured-a-12-pixel-face]], recreated by its own fix');
  eq(tiny.fit.after.claimed, 0,
    'a head at 4% of frame height is described anyway: ' + tiny.fit.after.derived.join(', '));
  const wall = out.rows.filter(r => /beige wall/.test(r.name))[0];
  ok(wall, 'the confidently-wrong wall canary is missing');
  eq(wall.fit.fitted, false, 'a picture of a wall was cropped as though it contained a face');
  eq(wall.fit.located && wall.fit.after.claimed > 0, false,
    'the structure locator turned a beige wall into a face');
  eq(wall.fit.after.claimed, 0,
    'a beige wall was described as a person: ' + wall.fit.after.derived.join(', '));
  eq(wall.fit.before.claimed, 0,
    'a beige wall was described as a person BEFORE the fit too: ' + wall.fit.before.derived.join(', '));
  eq(wall.fit.after.fit.ready, false, 'the framing guide calls a wall a ready portrait');

  /* ---- 4. THE MEASURED CEILING, RECORDED RATHER THAN ASSERTED ----------- */
  const best = out.rows.reduce((m, r) => Math.max(m, r.fit.after.claimed), 0);
  console.log('MEASURED CEILING at these framings: ' + best + ' of 14 claimed.');
  console.log('  Structurally unclaimable for a clean-shaven, unbespectacled, full-hairline face:');
  console.log('  faceShape (measured, deliberately never claimed), beard/glasses/hairline/browCol');
  console.log('  (claimed only when the feature is PRESENT). See the header of this file.');
  ok(best >= 6, 'the best framing in the sweep reads under six of fourteen');

  console.log('');
  console.log('PASS 1p avatar capture readability: ' + passed + ' assertions over ' + out.rows.length + ' fixtures');
})().catch(err => { console.error(err && err.stack || String(err)); process.exit(1); });
