'use strict';

/*
 * THE WARM WALL (drives the real 1p reader in real Chrome; /1p only, synthetic).
 *
 * Owner, 2026-08-17, over a screenshot of the capture step taken against his own
 * warm-toned room wall: "ALSO THIS FACE TO AVATAR IS STILL A NIGHTMARE AND NEEDS
 * A LOT OF WORK."
 *
 * He is right and his screenshot names the root cause: the face finder is a
 * SKIN-COLOUR blob segmentation. A magnolia wall, wood panelling or a tan door
 * falls inside the same YCbCr window as a face, merges with it into one
 * component, and the "face outline" becomes the room. Measured on the pre-fix
 * build with the fixtures below, head 25% of frame height at 1280x720:
 *
 *     plain COOL wall      6 of 14
 *     WARM wall            1 of 14   box L144..R255 T64..B255 — the wall
 *     WARM wall + wood     0 of 14   box touches every edge
 *     WARM wall, head 30%  0 of 14   "79% of this picture reads as skin-coloured"
 *
 * So on an ordinary indoor frame the number is not five of fourteen; it is zero
 * or one, and every trait downstream is measured from a wall.
 *
 * WHAT THIS FILE PROVES
 *   1. THE FIXTURES REALLY MERGE. Each warm fixture, read as a whole frame,
 *      still produces the collapse — otherwise the "after" column proves nothing.
 *   2. THE LOCATOR FINDS THE FACE WITHOUT ASKING ITS COLOUR, and the read
 *      recovers to at least six of fourteen on every warm fixture.
 *   3. ⛔ THE NEGATIVE CONTROLS REFUSE. A warm wall with NO face in it, a cool
 *      wall with no face, and a head at 4% of frame height must all locate
 *      nothing, crop nothing and claim nothing. A locator that fires on a wall
 *      would be the wall-becomes-your-face defect with a new mechanism.
 *   4. THE CROP CANNOT MAKE THINGS WORSE: every candidate is judged against the
 *      WHOLE FRAME, so a fixture may only gain claims, never lose them.
 *
 * ⛔ WHAT IS NOT PROVEN HERE: `window.FaceDetector`. It is undefined in the
 * Chrome this suite drives (asserted below, so the day it appears this file
 * says so and the claim can be re-made honestly). The detector path is
 * unit-tested against a fake in 1p-avatar-capture-fit.test.js and is UNVERIFIED
 * against a real browser detector.
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

const FIXTURE = function () {
  /* A ROOM WITH A WALL THAT PASSES THE SKIN WINDOW. The gradient is the point:
     a real wall is lit unevenly, so a single background reference cannot
     subtract it. `face:false` paints the room and nothing else. */
  window.__wallFrame = function (o) {
    const W = 1280, H = 720;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, o.wallA); g.addColorStop(1, o.wallB);
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    if (o.face !== false) {
      const ry = (H * o.headFrac) / 2, rx = ry * 0.72;
      const cx = W / 2 + W * (o.dx || 0), cy = H * 0.44;
      x.fillStyle = o.shirt || '#2f5f86';
      x.beginPath(); x.ellipse(cx, cy + ry * 2.5, rx * 3.0, ry * 1.5, 0, 0, 7); x.fill();
      x.fillStyle = o.skin;
      x.fillRect(cx - rx * 0.34, cy + ry * 0.80, rx * 0.68, ry * 0.85);
      x.beginPath(); x.ellipse(cx, cy, rx, ry, 0, 0, 7); x.fill();
      x.beginPath(); x.ellipse(cx - rx, cy + ry * 0.05, rx * 0.13, ry * 0.16, 0, 0, 7); x.fill();
      x.beginPath(); x.ellipse(cx + rx, cy + ry * 0.05, rx * 0.13, ry * 0.16, 0, 0, 7); x.fill();
      x.fillStyle = o.hair;
      x.beginPath(); x.ellipse(cx, cy - ry * 0.66, rx * 1.03, ry * 0.42, 0, 0, 7); x.fill();
      x.fillRect(cx - rx * 0.62, cy - ry * 0.26, rx * 0.34, ry * 0.065);
      x.fillRect(cx + rx * 0.28, cy - ry * 0.26, rx * 0.34, ry * 0.065);
      const eyeDx = rx * 0.44, eyeY = cy - ry * 0.10;
      [-1, 1].forEach(function (s) {
        x.fillStyle = 'rgb(250,248,245)';
        x.beginPath(); x.ellipse(cx + s * eyeDx, eyeY, rx * 0.20, ry * 0.085, 0, 0, 7); x.fill();
        x.fillStyle = o.eyes || '#4a3423';
        x.beginPath(); x.ellipse(cx + s * eyeDx, eyeY, rx * 0.095, ry * 0.080, 0, 0, 7); x.fill();
        x.fillStyle = 'rgb(20,16,14)';
        x.beginPath(); x.ellipse(cx + s * eyeDx, eyeY, rx * 0.045, ry * 0.040, 0, 0, 7); x.fill();
      });
      x.fillStyle = 'rgba(0,0,0,0.20)';
      x.beginPath(); x.ellipse(cx - rx * 0.10, cy + ry * 0.30, rx * 0.055, ry * 0.035, 0, 0, 7); x.fill();
      x.beginPath(); x.ellipse(cx + rx * 0.10, cy + ry * 0.30, rx * 0.055, ry * 0.035, 0, 0, 7); x.fill();
      x.fillStyle = 'rgba(0,0,0,0.10)';
      x.fillRect(cx + rx * 0.03, cy - ry * 0.02, rx * 0.09, ry * 0.32);
      x.fillStyle = o.lip || '#a95f47';
      x.beginPath(); x.ellipse(cx, cy + ry * 0.53, rx * 0.30, ry * 0.065, 0, 0, 7); x.fill();
    }
    const side = Math.min(W, H), px2 = Math.min(1024, side);
    const s2 = document.createElement('canvas'); s2.width = px2; s2.height = px2;
    const sx = s2.getContext('2d');
    sx.imageSmoothingEnabled = true; sx.imageSmoothingQuality = 'high';
    sx.drawImage(c, (W - side) / 2, (H - side) / 2, side, side, 0, 0, px2, px2);
    return s2;
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
    window.__mlsSessionAccount = 'avatar-wall-proof@example.test';
    window.bkToken = () => 'synthetic-wall-proof-token';
    window.requestIdleCallback = window.requestIdleCallback || (f => setTimeout(f, 0));
  });
  const assetSource = fs.readFileSync(path.join(ROOT, ASSET), 'utf8');
  await page.evaluate(({ assetSource, asset }) => {
    const script = document.createElement('script');
    script.setAttribute('data-mls-install-token', 'synthetic-wall-proof-install');
    script.setAttribute('data-mls-asset', asset);
    script.textContent = assetSource;
    document.head.appendChild(script);
  }, { assetSource, asset: ASSET });
  await page.waitForTimeout(300);
  await page.evaluate(FIXTURE);

  const out = await page.evaluate(() => {
    const owner = window.__mlsAvatar;
    if (!owner || typeof owner.captureFit !== 'function') return { error: 'NO_CAPTURE_FIT' };
    const WARM = { wallA: '#e8c9a6', wallB: '#d8b48c' };
    const WOOD = { wallA: '#e0bb92', wallB: '#c39a68' };
    const COOL = { wallA: '#c9cdd2', wallB: '#b9bec4' };
    const LAMP = { wallA: '#f2d8b8', wallB: '#e2c49c' };
    const base = { skin: '#f0c8a0', hair: '#3a2a1c', shirt: '#2f5f86', headFrac: 0.25 };
    const cases = [
      ['COOL wall h25', Object.assign({}, base, COOL), 'control'],
      ['WARM wall h25', Object.assign({}, base, WARM), 'merge'],
      ['WARM wall h30', Object.assign({}, base, WARM, { headFrac: 0.30 }), 'merge'],
      ['WARM+wood h25', Object.assign({}, base, WOOD), 'merge'],
      ['WARM wall h18', Object.assign({}, base, WARM, { headFrac: 0.18 }), 'merge'],
      ['WARM off-centre', Object.assign({}, base, WARM, { dx: -0.16 }), 'merge'],
      ['WARM lamp, dim face', Object.assign({}, base, LAMP, { skin: '#e0b892' }), 'merge'],
      ['NEG warm wall only', Object.assign({}, base, WARM, { face: false }), 'negative'],
      ['NEG cool wall only', Object.assign({}, base, COOL, { face: false }), 'negative'],
      ['NEG head 4%', Object.assign({}, base, WARM, { headFrac: 0.04 }), 'negative']
    ];
    return {
      hasFaceDetector: typeof window.FaceDetector,
      rows: cases.map(([name, o, kind]) => {
        const square = window.__wallFrame(o);
        return { name, kind, fit: owner.captureFit(square) };
      })
    };
  });

  await browser.close();
  if (errs.length) throw new Error('page errors: ' + errs.slice(0, 3).join(' | '));
  if (out.error) throw new Error(out.error);

  console.log('');
  console.log('THE WARM WALL — claimed of 14 on the whole frame, and after the face-aware crop');
  console.log('  fixture                    whole frame     after crop      locator');
  out.rows.forEach(r => {
    const b = r.fit.before, a = r.fit.after;
    console.log('  ' + r.name.padEnd(26) +
      (b.claimed + '/14 f=' + b.faceFrac.toFixed(2)).padEnd(16) +
      (a.claimed + '/14 f=' + a.faceFrac.toFixed(2)).padEnd(16) +
      (r.fit.located ? ('found, contrast ' + r.fit.locateContrast + (r.fit.fitted ? (' · ' + r.fit.planWhy) : ' · no crop kept'))
        : ('refused — ' + r.fit.locateWhy)));
  });
  console.log('');

  /* ---- 0. THE DETECTOR PATH IS NOT EXERCISED HERE, AND SAYS SO ---------- */
  eq(out.hasFaceDetector, 'undefined',
    'window.FaceDetector now EXISTS in this Chrome — the detector path is finally testable for real, and the ' +
    '"unverified" caveat in the module and in this header must be re-measured rather than repeated');

  /* ---- 1. THE FIXTURES REALLY MERGE ------------------------------------ */
  const control = out.rows.filter(r => r.kind === 'control')[0];
  ok(control.fit.before.claimed >= 5,
    'the COOL-wall control no longer reads normally, so the warm fixtures are not isolating the wall');
  const merges = out.rows.filter(r => r.kind === 'merge');
  eq(merges.length, 6, 'the warm-wall fixture set changed size');
  merges.forEach(r => {
    ok(r.fit.before.claimed <= 2,
      r.name + ' — the whole-frame read is ' + r.fit.before.claimed +
      ' of 14, so this fixture no longer reproduces the wall merge and its "after" proves nothing');
  });

  /* ---- 2. THE LOCATOR RECOVERS THEM ------------------------------------ */
  merges.forEach(r => {
    ok(r.fit.located, r.name + ' — the locator found nothing: ' + r.fit.locateWhy);
    ok(r.fit.fitted, r.name + ' — no candidate crop was kept: ' + r.fit.why);
    ok(r.fit.after.claimed >= 6,
      r.name + ' — after the crop it still reads only ' + r.fit.after.claimed + ' of 14 (' +
      r.fit.after.derived.join(', ') + ')');
    ok(r.fit.after.derived.indexOf('skin') >= 0,
      r.name + ' — skin is still unreadable after the crop, so partial application would refuse');
  });

  /* ---- 3. ⛔ THE NEGATIVE CONTROLS ------------------------------------- */
  out.rows.filter(r => r.kind === 'negative').forEach(r => {
    eq(r.fit.fitted, false, r.name + ' — a crop was kept on a frame with no face in it');
    eq(r.fit.after.claimed, 0,
      r.name + ' — traits were claimed from a frame with no face: ' + r.fit.after.derived.join(', '));
  });
  const wallOnly = out.rows.filter(r => /wall only/.test(r.name));
  eq(wallOnly.length, 2, 'the two wall-only negatives are missing');
  wallOnly.forEach(r => eq(r.fit.located, false,
    r.name + ' — the LOCATOR fired on a picture of a wall, which is the wall-becomes-your-face defect with a new mechanism'));

  /* ---- 4. THE CROP CANNOT MAKE THINGS WORSE ---------------------------- */
  out.rows.forEach(r => ok(r.fit.after.claimed >= r.fit.before.claimed,
    r.name + ' — the crop LOST claims (' + r.fit.before.claimed + ' -> ' + r.fit.after.claimed + ')'));

  console.log('PASS 1p avatar warm wall: ' + passed + ' assertions over ' + out.rows.length + ' fixtures');
})().catch(err => { console.error(err && err.stack || String(err)); process.exit(1); });
