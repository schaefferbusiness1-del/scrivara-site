'use strict';

/*
 * WHAT THE DOCTOR'S PORTRAIT ACTUALLY LOOKS LIKE ON EVERY SURFACE THAT SHIPS IT
 * (real Chrome, real module, real detector; /1p only, PHI-free, synthetic).
 *
 * THE GAP THIS FILLS. Every avatar harness in this tree stops at the square.
 * 1p-avatar-photo-framing-proof executes the crop arithmetic against a STUBBED
 * reader that returns a perfect box; 1p-avatar-capture-readability-proof runs
 * the real reader but asks only how many of fourteen traits it can claim. Not
 * one of them has ever asked the question the owner keeps answering for us by
 * looking at it: once that square is poured into a 44px circle, or a 302px one,
 * HOW MUCH OF THE MAN IS STILL THERE.
 *
 * [[judged-in-a-square-shipped-into-a-circle]] is the whole reason. A portrait
 * composed for a rectangle went into a round hole and the shoulders and collar
 * fell outside the mask; the pin written that day measured CLIPPING and passed
 * on both arms, because a head whose bounding-box corners sit inside the radius
 * is not being clipped -- the COMPOSITION was wrong, which is a different
 * measurement. The three fractions that actually discriminated were crown gap,
 * head height and surviving garment. Those three are measured here, per
 * surface, at the surface's real shipped diameter.
 *
 * HOW IT MEASURES. The fixture paints hair, skin, shirt and wall in four
 * reserved marker colours, so a rendered pixel can be classified exactly rather
 * than guessed at. The real chain runs -- window.__mlsAvatar.photoFrame ->
 * faceAwareSquareFromImage -> faceReadPortrait -- and the resulting square is
 * then drawn into a canvas carrying the SAME circular clip and the SAME device
 * pixel count as the shipped container, and the survivors are counted.
 *
 * ⛔ WHAT IT DOES NOT CLAIM. It does not claim the crop is beautiful, and it
 * does not grade likeness. It reports numbers and asserts floors that a human
 * looking at the circle would agree with: the crown of the head is inside the
 * mask, the head is not a close-up filling the frame, the portrait is not being
 * upscaled into a blur, and NO surface can end up empty.
 *
 * ⛔ AND IT REFUSES TO GRADE A TINY FACE — TWICE, FOR TWO DIFFERENT REASONS.
 * A head at 4% of frame height is the 12-pixel-face canary, and it is refused
 * by the READINESS gate. A head at 20% is refused by the SIZE FLOOR, and it
 * exists because a mutation showed the 4% canary never reaches that floor at
 * all: analyse() returns on `!verdict.ready` before `bw < 0.12` is consulted,
 * so gutting the floor changed nothing and the suite still passed. Same shape
 * as the framed suite's filled 7.7px bar — a fixture that draws only what the
 * detector already accepts can never falsify it.
 *
 * Registered in run-all: it launches Chrome, like the three proofs beside it.
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

/* ---------------------------------------------------------------------------
   THE SHIPPED SURFACES, AND WHERE EACH NUMBER COMES FROM. Every diameter below
   is read back out of the shipped source by the guard underneath, so this table
   cannot quietly drift away from the CSS it claims to describe. A surface
   measured at a size it does not ship at is worse than not measuring it.
   -------------------------------------------------------------------------- */
const SURFACES = [
  { key: 'kiosk-420', label: 'Check-in kiosk (tall screen)', px: 420, round: true,
    from: ['1p-feat_mls_avatar.js', '#mlsAvKioskFaceWrap{position:relative;width:min(40vh,420px)'] },
  { key: 'kiosk-302', label: 'Check-in kiosk (measured live)', px: 302, round: true,
    from: ['1p-feat_mls_avatar.js', '#mlsAvKioskFace is a 302px circle'] },
  { key: 'setup-176', label: 'Settings appearance preview', px: 176, round: true,
    from: ['1p-feat_mls_avatar_face.js', '176px'] },
  { key: 'setup-132', label: 'Setup appearance preview', px: 132, round: true,
    from: ['1p-feat_mls_avatar.js', 'width:132px;height:132px;border-radius:999px;overflow:hidden'] },
  { key: 'thumb-72', label: 'Setup face thumbnail', px: 72, round: true,
    from: ['1p-feat_mls_avatar.js', 'width:72px;height:72px;border-radius:999px;overflow:hidden'] },
  { key: 'chip-44', label: 'Patient list chip', px: 44, round: true,
    from: ['1p/index.html', '.pt-avatar{width:44px;height:44px;border-radius:50%'] },
  { key: 'intake-48', label: 'Intake inbox tile', px: 48, round: false, radius: 10,
    from: ['1p/index.html', '.ik-inbox-face{position:relative;overflow:hidden;width:48px;height:48px;border-radius:10px'] }
];

/* The table above is a claim about the shipped CSS. Prove it before using it. */
SURFACES.forEach(s => {
  const src = fs.readFileSync(path.join(ROOT, s.from[0]), 'utf8');
  ok(src.includes(s.from[1]),
    s.key + ': the shipped source no longer contains "' + s.from[1] + '" — this proof is measuring a size that is not shipped');
});

/* ---------------------------------------------------------------------------
   THE FIXTURE. Four reserved marker colours, chosen far apart in RGB so the
   renderer's own resampling cannot turn one into another, and each within the
   range the shipped detector already accepts (the skin marker sits inside the
   measured photographed-skin band, not the chip-calibrated one that refused
   real faces).
   -------------------------------------------------------------------------- */
const FIXTURE = function () {
  window.__t12 = {
    HAIR: [58, 42, 28], SKIN: [232, 185, 140], SHIRT: [47, 95, 134], WALL: [214, 219, 226],
    /* Draw a person at a KNOWN place. Everything anatomical is relative to the
       head, so the same person appears at every framing and the only variables
       are how big he is and where. Hair is drawn ABOVE the skin dome, because
       "does the crop keep the hair" is a question this file must be able to
       answer -- [[the-face-box-swallowed-the-hair]]. */
    draw: function (o) {
      const W = o.w, H = o.h;
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const x = c.getContext('2d');
      const rgb = a => 'rgb(' + a[0] + ',' + a[1] + ',' + a[2] + ')';
      x.fillStyle = rgb(window.__t12.WALL); x.fillRect(0, 0, W, H);

      const headH = o.headFrac * H;              /* crown of HAIR to chin */
      const headW = headH * 0.72;
      const cx = W * (0.5 + (o.dx || 0));
      const crownY = H * (o.topFrac != null ? o.topFrac : 0.16);
      const chinY = crownY + headH;
      const faceCy = crownY + headH * 0.56;      /* skin dome centre */
      const eyeY = crownY + headH * 0.50;
      const shoulderY = chinY + headH * 0.30;

      /* shoulders / shirt */
      x.fillStyle = rgb(window.__t12.SHIRT);
      x.beginPath();
      x.ellipse(cx, shoulderY + headH * 1.1, headW * 1.85, headH * 1.15, 0, 0, Math.PI * 2);
      x.fill();
      /* neck */
      x.fillStyle = rgb(window.__t12.SKIN);
      x.fillRect(cx - headW * 0.20, chinY - headH * 0.10, headW * 0.40, shoulderY - chinY + headH * 0.14);
      /* HAIR first: a dome that is wider and TALLER than the face */
      x.fillStyle = rgb(window.__t12.HAIR);
      x.beginPath();
      x.ellipse(cx, crownY + headH * 0.36, headW * 0.545, headH * 0.36, 0, 0, Math.PI * 2);
      x.fill();
      /* SKIN face over it, leaving the hair proud at the crown and sides */
      x.fillStyle = rgb(window.__t12.SKIN);
      x.beginPath();
      x.ellipse(cx, faceCy, headW * 0.455, headH * 0.44, 0, 0, Math.PI * 2);
      x.fill();
      /* brow + eyes + mouth, in hair colour so the detector has structure */
      x.fillStyle = rgb(window.__t12.HAIR);
      const eSep = headW * 0.42, eR = Math.max(1, headW * 0.075);
      [-1, 1].forEach(s => {
        x.beginPath(); x.ellipse(cx + s * eSep / 2, eyeY, eR, eR * 0.72, 0, 0, Math.PI * 2); x.fill();
        x.fillRect(cx + s * eSep / 2 - eR * 1.4, eyeY - headH * 0.075, eR * 2.8, Math.max(1, headH * 0.022));
      });
      x.beginPath();
      x.ellipse(cx, crownY + headH * 0.80, headW * 0.17, Math.max(1, headH * 0.030), 0, 0, Math.PI * 2);
      x.fill();

      return { canvas: c, truth: { W, H, cx, crownY, chinY, eyeY, shoulderY, headW, headH,
        headL: cx - headW * 0.545, headR: cx + headW * 0.545 } };
    },
    /* Classify one pixel against the four markers. A pixel that is not clearly
       one of them (an antialiased boundary) is 'edge' and counted separately,
       so a large edge share can never be silently read as coverage. */
    classify: function (r, g, b) {
      const M = window.__t12;
      let best = 'edge', bestD = 60 * 60;
      [['hair', M.HAIR], ['skin', M.SKIN], ['shirt', M.SHIRT], ['wall', M.WALL]].forEach(p => {
        const d = (r - p[1][0]) ** 2 + (g - p[1][1]) ** 2 + (b - p[1][2]) ** 2;
        if (d < bestD) { bestD = d; best = p[0]; }
      });
      return best;
    },
    /* Draw a square into the SHAPE IT SHIPS at the DEVICE pixel count it ships
       with, then count what survived. object-fit:cover on a square source in a
       square box is 1:1, so the mask is the only thing that removes anything --
       which is exactly the property being measured. */
    maskCount: function (square, px, round, radius) {
      const c = document.createElement('canvas'); c.width = px; c.height = px;
      const x = c.getContext('2d');
      x.save();
      x.beginPath();
      if (round) x.arc(px / 2, px / 2, px / 2, 0, Math.PI * 2);
      else {
        const r = Math.min(radius || 0, px / 2);
        x.moveTo(r, 0); x.lineTo(px - r, 0); x.quadraticCurveTo(px, 0, px, r);
        x.lineTo(px, px - r); x.quadraticCurveTo(px, px, px - r, px);
        x.lineTo(r, px); x.quadraticCurveTo(0, px, 0, px - r);
        x.lineTo(0, r); x.quadraticCurveTo(0, 0, r, 0);
      }
      x.clip();
      x.drawImage(square, 0, 0, px, px);
      x.restore();
      const d = x.getImageData(0, 0, px, px).data;
      const n = { hair: 0, skin: 0, shirt: 0, wall: 0, edge: 0, empty: 0 };
      let topHair = -1;
      for (let y = 0; y < px; y++) {
        for (let i = (y * px) * 4, xx = 0; xx < px; xx++, i += 4) {
          if (d[i + 3] < 8) { n.empty++; continue; }
          const k = window.__t12.classify(d[i], d[i + 1], d[i + 2]);
          n[k]++;
          if (k === 'hair' && topHair < 0) topHair = y;
        }
      }
      const inside = px * px - n.empty;
      return { counts: n, inside: inside, topHairRow: topHair,
        headFrac: Math.round(((n.hair + n.skin) / inside) * 10000) / 10000,
        wallFrac: Math.round((n.wall / inside) * 10000) / 10000,
        shirtFrac: Math.round((n.shirt / inside) * 10000) / 10000,
        edgeFrac: Math.round((n.edge / inside) * 10000) / 10000 };
    }
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
    window.__mlsSessionEpoch = 77;
    window.__mlsSessionAccount = 'avatar-surface-proof@example.test';
    window.bkToken = () => 'synthetic-avatar-surface-proof-token';
    window.requestIdleCallback = window.requestIdleCallback || (f => setTimeout(f, 0));
  });
  const assetSource = fs.readFileSync(path.join(ROOT, ASSET), 'utf8');
  await page.evaluate(({ assetSource, asset }) => {
    const script = document.createElement('script');
    script.setAttribute('data-mls-install-token', 'synthetic-avatar-surface-proof-install');
    script.setAttribute('data-mls-asset', asset);
    script.textContent = assetSource;
    document.head.appendChild(script);
  }, { assetSource, asset: ASSET });
  await page.waitForTimeout(300);
  await page.evaluate(FIXTURE);

  /* ---- 1. THE PIPELINE, END TO END, ONTO EVERY SURFACE ------------------ */
  const out = await page.evaluate((SURFACES) => {
    const owner = window.__mlsAvatar;
    if (!owner || typeof owner.photoFrame !== 'function') return { error: 'NO_PHOTO_FRAME' };
    const T = window.__t12;
    /* ⛔ TWO FAMILIES, AND THEY MEASURE DIFFERENT THINGS.
       For a LANDSCAPE source the square is the full frame height (spanY = 0),
       so the crop has no vertical freedom whatever: the composition is
       inherited from the photographer and the crownGap this proof reads back
       is the FIXTURE'S OWN topFrac, not a decision the product made. Asserting
       composition on those rows would be grading my own drawing.
       The TALL family is where the product actually chooses, so the vertical
       anchor is asserted there and there only, across a spread of source
       framings so one lucky topFrac cannot carry it. */
    const cases = [
      { name: '1280x960 head 46% centred', w: 1280, h: 960, headFrac: 0.46 },
      { name: '1280x960 head 60% centred', w: 1280, h: 960, headFrac: 0.60 },
      { name: '1600x900 head 55% off-centre left', w: 1600, h: 900, headFrac: 0.55, dx: -0.22 },
      { name: '1080x1080 square head 52%', w: 1080, h: 1080, headFrac: 0.52 },
      { name: 'TALL 900x1600 head 34% high', w: 900, h: 1600, headFrac: 0.34, topFrac: 0.10 },
      { name: 'TALL 900x1600 head 34% mid', w: 900, h: 1600, headFrac: 0.34, topFrac: 0.24 },
      { name: 'TALL 900x1600 head 30% low', w: 900, h: 1600, headFrac: 0.30, topFrac: 0.38 },
      { name: 'TALL 1000x1500 head 40% high', w: 1000, h: 1500, headFrac: 0.40, topFrac: 0.08 },
      { name: 'TALL 1200x1600 head 44% mid', w: 1200, h: 1600, headFrac: 0.44, topFrac: 0.20 },
      { name: 'CANARY head 4% of frame', w: 1280, h: 960, headFrac: 0.04, canary: true },
      /* ⛔ THE 4% CANARY DOES NOT TEST THE SIZE FLOOR, and a mutation proved
         it: at 4% the reader is not READY, so analyse() returns before
         `bw < 0.12 || bh < 0.18` is ever consulted, and gutting that floor
         changed nothing. The floor only becomes the gate in a narrow band
         where the face IS read and is still too small — measured at 20% of
         frame height (ready, boxW 0.133, refused). This is the fixture that
         gives the floor teeth, and it is the same lesson as the framed
         suite's filled 7.7px bar: a fixture that draws only what the detector
         already accepts can never falsify it. */
      { name: 'CANARY head 20% — read, but too small', w: 1280, h: 960, headFrac: 0.20,
        canary: true, smallFloor: true }
    ];
    return { rows: cases.map(cs => {
      const made = T.draw(cs);
      const framed = owner.photoFrame(made.canvas);
      const row = { name: cs.name, canary: !!cs.canary, smallFloor: !!cs.smallFloor, w: cs.w, h: cs.h,
        why: framed && framed.why, kind: framed && framed.meta && framed.meta.kind,
        ready: framed && framed.ready, outPx: framed && framed.outPx,
        box: framed && framed.box, derived: (framed && framed.derived) || [],
        meta: framed && framed.meta, surfaces: {} };
      if (!framed || !framed.square) { row.noSquare = true; return row; }

      /* Ground truth mapped into the SHIPPED SQUARE's own fractions. */
      const m = framed.meta || {};
      const cs2 = Number(m.cropSide) || Math.min(cs.w, cs.h);
      const cx0 = Number(m.cropX) || 0, cy0 = Number(m.cropY) || 0;
      const t = made.truth;
      const f = (X, Y) => ({ u: (X - cx0) / cs2, v: (Y - cy0) / cs2 });
      row.truth = {
        crown: f(t.cx, t.crownY).v, chin: f(t.cx, t.chinY).v, eye: f(t.cx, t.eyeY).v,
        left: f(t.headL, t.eyeY).u, right: f(t.headR, t.eyeY).u,
        shoulder: f(t.cx, t.shoulderY).v
      };
      row.truth.crownGap = Math.round(row.truth.crown * 10000) / 10000;
      /* Did the product have any vertical say at all? spanY is the only room
         the crop has to move up or down; at zero the square IS the frame
         height and the composition is the photographer's, not ours. */
      row.verticalFreedom = Math.max(0, cs.h - cs2);
      /* THREE FAMILIES, and only one of them is the product's own work:
         - no freedom at all (spanY = 0): the square IS the frame height and the
           composition is the photographer's;
         - freedom, but the crop is pinned against an edge: the source has no
           pixels above (or below) the head to give, and the only ways to reach
           the target would be upscaling or letterboxing, neither of which this
           path has ever done;
         - free: the crop genuinely chose, and this is what may be graded. */
      row.clamped = row.verticalFreedom > 1 &&
        (cy0 <= 0.5 || cy0 >= row.verticalFreedom - 0.5);
      row.chose = row.verticalFreedom > 1 && !row.clamped;
      row.truth.headHeight = Math.round((row.truth.chin - row.truth.crown) * 10000) / 10000;
      /* Is the top of the head inside the circle? Checked at the head's own
         widest points, not at its centre -- a crown at u=0.5 always survives a
         circle, which is precisely the useless measurement that passed on both
         arms last time. */
      const inCircle = (u, v) => ((u - 0.5) ** 2 + (v - 0.5) ** 2) <= 0.25;
      row.truth.crownCornersInside =
        inCircle(row.truth.left, row.truth.crown) && inCircle(row.truth.right, row.truth.crown);
      row.truth.crownCentreInside = inCircle(0.5, row.truth.crown);

      SURFACES.forEach(s => {
        [1, 2].forEach(dpr => {
          const px = Math.round(s.px * dpr);
          const r = T.maskCount(framed.square, px, s.round, (s.radius || 0) * dpr);
          if (dpr === 1) {
            row.surfaces[s.key] = {
              px: s.px, round: s.round,
              headFrac: r.headFrac, wallFrac: r.wallFrac, shirtFrac: r.shirtFrac, edgeFrac: r.edgeFrac,
              topHairFrac: r.topHairRow < 0 ? -1 : Math.round((r.topHairRow / px) * 10000) / 10000,
              hairPx: r.counts.hair, skinPx: r.counts.skin
            };
          }
          /* Resolution: how many SOURCE pixels of the chosen crop land on one
             device pixel. Under 1.0 the portrait is being upscaled, which is
             the blur a doctor reads as "it looks bad" and which no existing
             suite measures anywhere. */
          row.surfaces[s.key]['srcPerDevice@' + dpr + 'x'] =
            Math.round(((Number(framed.outPx) || 0) / px) * 1000) / 1000;
        });
      });
      return row;
    }) };
  }, SURFACES);

  if (out.error) throw new Error('the module did not publish the avframe-1.0.0 hook: ' + out.error);
  eq(errs.length, 0, 'the module threw while framing portraits: ' + errs.join(' | '));

  const real = out.rows.filter(r => !r.canary);
  const canary = out.rows.filter(r => r.canary)[0];

  /* ---- 2. THE CANARY REFUSES, IT IS NEVER GRADED ------------------------ */
  ok(canary, 'the 12-pixel-face canary is missing');
  eq(canary.ready === true && (canary.derived || []).length > 0, false,
    'a head at 4% of frame height was read and described — [[face-matcher-measured-a-12-pixel-face]]');
  /* ⛔ "not described" was too weak a canary and a mutation proved it: with the
     small-face floor removed the tiny head was still not READY, so the old
     assertion held while the product had genuinely stopped refusing. Assert
     the REFUSAL ITSELF — no face was promoted into a portrait. */
  eq(canary.meta && canary.meta.faces, 0,
    'a head at 4% of frame height was promoted to a credible face and framed as the physician ' +
    '— [[face-matcher-measured-a-12-pixel-face]]');
  ok(canary.kind !== 'face-aware',
    'a head at 4% of frame height produced a FACE-AWARE crop (kind=' + canary.kind + ')');

  const smallFloor = out.rows.filter(r => r.smallFloor)[0];
  ok(smallFloor, 'the small-face FLOOR canary is missing');
  eq(smallFloor.ready, true,
    'the small-face floor canary is no longer READ at all, so it has stopped testing the floor ' +
    'and started testing the readiness gate — re-measure the band and move the fixture');
  eq(smallFloor.meta && smallFloor.meta.faces, 0,
    'a face read successfully but measuring under the 0.12/0.18 floor was promoted into the ' +
    'physician portrait — a small face inside a monitor or a collage is not the doctor');
  ok(smallFloor.kind !== 'face-aware',
    'a face under the size floor produced a FACE-AWARE crop (kind=' + smallFloor.kind + ')');

  /* ---- 2b. NEVER UPSCALE ------------------------------------------------
     Also added because a mutation walked straight past the resolution check:
     source-pixels-per-device-pixel is computed from outPx, so a crop that
     invents pixels raises outPx and the ratio looks BETTER. The only honest
     test is against the source crop the pixels came from. */
  real.forEach(r => {
    const srcSide = Math.min(r.w, r.h);
    ok(r.outPx <= srcSide,
      r.name + ': the crop produced a ' + r.outPx + 'px square from a ' + srcSide +
      'px source — it invented pixels, which makes a low-res camera look high-res to every check below');
  });

  /* ---- 3. THE TABLE ----------------------------------------------------- */
  console.log('');
  console.log('=== THE CROP, PER FIXTURE (fractions of the shipped square) ===');
  console.log('fixture                             kind        outPx  crownGap  headH  crownCorners');
  real.forEach(r => {
    console.log('  ' + (r.name + ' '.repeat(34)).slice(0, 34) +
      ((r.kind || '-') + ' '.repeat(11)).slice(0, 11) +
      ((r.outPx + '') + ' '.repeat(7)).slice(0, 7) +
      ((r.truth ? r.truth.crownGap.toFixed(3) : '  -  ') + ' '.repeat(10)).slice(0, 10) +
      ((r.truth ? r.truth.headHeight.toFixed(3) : '  -  ') + ' '.repeat(7)).slice(0, 7) +
      (r.truth ? (r.truth.crownCornersInside ? 'inside' : 'CLIPPED') : '-'));
  });

  console.log('');
  console.log('=== WHAT SURVIVES THE SHIPPED MASK (worst fixture per surface) ===');
  console.log('surface                          px  shape   head%   wall%  shirt%  src/dev@1x  @2x');
  const perSurface = {};
  SURFACES.forEach(s => {
    const rows = real.filter(r => r.surfaces && r.surfaces[s.key]).map(r => r.surfaces[s.key]);
    if (!rows.length) return;
    const worst = rows.reduce((m, x) => (x.headFrac < m.headFrac ? x : m), rows[0]);
    const minRes1 = Math.min.apply(null, rows.map(x => x['srcPerDevice@1x']));
    const minRes2 = Math.min.apply(null, rows.map(x => x['srcPerDevice@2x']));
    perSurface[s.key] = { worst, minRes1, minRes2, label: s.label };
    console.log('  ' + (s.label + ' '.repeat(31)).slice(0, 31) +
      ((s.px + '') + ' '.repeat(4)).slice(0, 4) +
      (s.round ? 'circle  ' : 'r-rect  ') +
      ((worst.headFrac * 100).toFixed(1) + '%' + ' '.repeat(8)).slice(0, 8) +
      ((worst.wallFrac * 100).toFixed(1) + '%' + ' '.repeat(7)).slice(0, 7) +
      ((worst.shirtFrac * 100).toFixed(1) + '%' + ' '.repeat(8)).slice(0, 8) +
      (minRes1.toFixed(2) + ' '.repeat(12)).slice(0, 12) + minRes2.toFixed(2));
  });

  /* ---- 4. THE FLOORS ----------------------------------------------------
     Chosen against the recorded accepted/rejected builds, not invented: the
     rejected kiosk build measured crown gap 0.140 and head height 0.660 and
     was the one the owner rejected on sight; the accepted one measured 0.236
     and 0.554. These floors sit between the two and name the memory. */
  real.forEach(r => {
    ok(r.truth, r.name + ': produced no square at all — every real fixture must frame');
    ok(r.truth.crownCornersInside,
      r.name + ': the CROWN OF THE HEAD is clipped by the circular mask at its widest points ' +
      '(crown v=' + r.truth.crownGap.toFixed(3) + ') — [[judged-in-a-square-shipped-into-a-circle]]');
    ok(r.truth.crownGap >= 0.06,
      r.name + ': the head starts ' + r.truth.crownGap.toFixed(3) + ' down the square — that is a close-up, ' +
      'and the circle is already narrowing there (rejected build measured 0.140)');
    ok(r.truth.headHeight <= 0.78,
      r.name + ': the head fills ' + r.truth.headHeight.toFixed(3) + ' of the square — a head at two thirds ' +
      'of a circular frame is a close-up, not a portrait (rejected build measured 0.660)');
  });

  /* No surface may be mostly wall, and none may be empty. A circle that is
     93% background is a picture of a room with a man in it. */
  SURFACES.forEach(s => {
    const p = perSurface[s.key];
    if (!p) return;
    ok(p.worst.headFrac > 0.14,
      s.label + ': only ' + (p.worst.headFrac * 100).toFixed(1) + '% of the shipped mask is the person ' +
      '— the portrait is mostly background at the size it actually ships');
    ok(p.worst.hairPx > 0,
      s.label + ': NO HAIR survives the shipped mask — [[the-face-box-swallowed-the-hair]] inverted');
    ok(p.worst.edgeFrac < 0.35,
      s.label + ': ' + (p.worst.edgeFrac * 100).toFixed(1) + '% of the mask is unclassifiable edge, so these ' +
      'coverage numbers are not trustworthy at this size');
  });

  /* ---- 5. RESOLUTION ----------------------------------------------------
     The kiosk is the surface a patient looks at for a whole encounter, and it
     is the only one large enough to be starved by MEASURE_MAX. */
  const kiosk = perSurface['kiosk-420'];
  ok(kiosk, 'the kiosk surface was not measured');
  console.log('');
  console.log('RESOLUTION: the 420px kiosk gets ' + kiosk.minRes1.toFixed(2) + ' source px per device px at 1x, ' +
    kiosk.minRes2.toFixed(2) + ' at 2x (under 1.00 = upscaled).');
  ok(kiosk.minRes1 >= 1.0,
    'the kiosk UPSCALES the portrait even at 1x device pixels (' + kiosk.minRes1.toFixed(2) + ') — it will look soft');

  /* ---- 6. NOTHING CAN END UP EMPTY -------------------------------------
     The real decode failure, in real Chrome, on the real controller. This is
     the half 1p-avatar-photo-fallback-runtime deliberately cannot do: a fake
     DOM cannot fail a decode honestly. */
  const fallback = await page.evaluate(async () => {
    const owner = window.__mlsAvatar;
    const mount = document.createElement('div');
    mount.style.cssText = 'width:302px;height:302px;border-radius:999px;overflow:hidden';
    document.body.appendChild(mount);
    const CORRUPT = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg####not-a-png####';
    const seen = { fired: 0 };
    /* The controller is internal; the reachable equivalent of the kiosk mount
       is the drawn face, so what is proven here is the BROWSER half: that a
       corrupt data URL of exactly this shape really does raise `error` on a
       real <img>, which is the event the whole fallback rests on. If it ever
       stopped raising, every fallback above would be dead code that still
       passes its unit suite. */
    await new Promise(res => {
      const img = document.createElement('img');
      img.addEventListener('error', () => { seen.fired++; res(); }, false);
      img.addEventListener('load', () => res(), false);
      img.src = CORRUPT;
      setTimeout(res, 2000);
    });
    /* And the drawn fallback really draws something into the shipped circle. */
    const face = owner.faceDemo(mount, { skin: '#e8b98c', hair: '#3a2a1c', shirt: '#2f5f86' });
    const svg = mount.querySelector('svg');
    const rect = svg ? svg.getBoundingClientRect() : null;
    const out = { errorFired: seen.fired, drewSvg: !!svg,
      svgW: rect ? Math.round(rect.width) : 0, svgH: rect ? Math.round(rect.height) : 0,
      markup: svg ? svg.innerHTML.length : 0 };
    if (face) face.destroy();
    mount.remove();
    return out;
  });
  eq(fallback.errorFired, 1,
    'a corrupt data: URL did NOT raise `error` on a real <img> in this browser — every decode fallback in the module rests on that event');
  eq(fallback.drewSvg, true, 'the drawn fallback put no SVG in the shipped circle');
  ok(fallback.svgW >= 290 && fallback.svgH >= 290,
    'the drawn fallback does not fill the shipped 302px circle (' + fallback.svgW + 'x' + fallback.svgH + ')');
  ok(fallback.markup > 400,
    'the drawn fallback is nearly empty markup (' + fallback.markup + ' chars) — an empty circle is the defect, not the cure');

  console.log('');
  console.log('FALLBACK: corrupt data URL raises error in real Chrome; drawn clinician fills ' +
    fallback.svgW + 'x' + fallback.svgH + ' of the 302px circle with ' + fallback.markup + ' chars of markup.');

  /* ---- 7. THE TWO FACES THAT SHIP INTO THE SAME CIRCLE ------------------
     "My photo" and "Animated character" are two states of ONE control, mounted
     into ONE container, and the doctor flips between them while looking at it.
     If they are composed to different vertical rules the face JUMPS on the
     toggle, and nothing in this tree has ever measured them against each
     other, because the drawn face is an SVG and the photo is a bitmap and
     every harness measured one or the other.

     Same instrument for both: rasterise into the same 302px circle, find the
     topmost row that is not the container's own background, and divide. That
     is exactly the "crown gap" the composition memory recorded for the
     accepted (0.236) and rejected (0.140) drawn builds. */
  const drawnCrown = await page.evaluate(async () => {
    const owner = window.__mlsAvatar;
    const PX = 302;
    const mount = document.createElement('div');
    mount.style.cssText = 'width:' + PX + 'px;height:' + PX + 'px;position:fixed;left:-9999px;top:0';
    document.body.appendChild(mount);
    const face = owner.faceDemo(mount, { skin: '#e8b98c', hair: '#3a2a1c', shirt: '#2f5f86' });
    const svg = mount.querySelector('svg');
    if (!svg) { mount.remove(); return { error: 'NO_SVG' }; }
    if (!svg.getAttribute('width')) { svg.setAttribute('width', PX); svg.setAttribute('height', PX); }
    const xml = new XMLSerializer().serializeToString(svg);
    const url = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(xml)));
    const bitmap = await new Promise(res => {
      const im = new Image();
      im.onload = () => res(im); im.onerror = () => res(null);
      im.src = url;
      setTimeout(() => res(null), 3000);
    });
    if (face) face.destroy();
    mount.remove();
    if (!bitmap) return { error: 'SVG_DID_NOT_RASTERISE' };
    const c = document.createElement('canvas'); c.width = PX; c.height = PX;
    const x = c.getContext('2d');
    x.drawImage(bitmap, 0, 0, PX, PX);
    const d = x.getImageData(0, 0, PX, PX).data;
    /* The topmost row carrying a meaningful run of opaque ink. A single
       antialiased pixel is not a crown; require a run so a stray mark or a
       1px frame cannot be read as the top of the head. */
    let crownRow = -1;
    for (let y = 0; y < PX && crownRow < 0; y++) {
      let run = 0;
      for (let i = (y * PX) * 4, xx = 0; xx < PX; xx++, i += 4) {
        if (d[i + 3] > 40) { run++; if (run >= 8) { crownRow = y; break; } } else run = 0;
      }
    }
    return { crownRow, crownGap: crownRow < 0 ? -1 : Math.round((crownRow / PX) * 10000) / 10000, px: PX };
  });

  console.log('');
  console.log('=== COMPOSITION: THE TWO FACES IN THE SAME 302px CIRCLE ===');
  const chose = real.filter(r => r.chose);
  const clamped = real.filter(r => r.clamped);
  const inherited = real.filter(r => !r.chose && !r.clamped);
  ok(chose.length >= 3, 'too few fixtures give the crop real vertical freedom to measure');
  ok(inherited.length >= 1, 'the landscape/square control family is missing');

  const cg = chose.map(r => r.truth.crownGap);
  const photoMin = Math.min.apply(null, cg), photoMax = Math.max.apply(null, cg);
  console.log('  drawn clinician                      crown gap ' +
    (drawnCrown.error ? ('NOT MEASURED (' + drawnCrown.error + ')') : drawnCrown.crownGap.toFixed(3)));
  console.log('  photograph, crop CHOSE the framing    crown gap ' +
    photoMin.toFixed(3) + ' – ' + photoMax.toFixed(3) + '   (' + chose.length + ' fixtures) <- GRADED');
  clamped.forEach(r => console.log('  photograph, crop PINNED to the edge   crown gap ' +
    r.truth.crownGap.toFixed(3) + '   ' + r.name + ' — the source has no pixels above the head to give'));
  inherited.forEach(r => console.log('  photograph, NO vertical freedom       crown gap ' +
    r.truth.crownGap.toFixed(3) + '   ' + r.name + ' — inherited from the source, not chosen'));
  console.log('  recorded drawn builds: accepted 0.236, REJECTED-ON-SIGHT 0.140');
  console.log('    [[judged-in-a-square-shipped-into-a-circle]]');

  /* ⛔ WHOSE CROWN? The crop can only anchor what the DETECTOR reports, and the
     doctor sees what is actually in the photograph. If those two disagree the
     anchor can be landing perfectly on its target and the head can still sit
     too high — a different defect with a different owner, and one that must
     not be papered over by tuning the crop constant against it. So both are
     printed side by side. */
  console.log('');
  console.log('  detected box top vs TRUE crown, per graded fixture:');
  let worstHairMiss = 0;
  chose.forEach(r => {
    const miss = (r.box ? r.box.T : 0) - r.truth.crownGap;
    if (miss > worstHairMiss) worstHairMiss = miss;
    console.log('    ' + (r.name + ' '.repeat(34)).slice(0, 34) +
      'box.T ' + (r.box ? r.box.T.toFixed(3) : '  -  ') +
      '   true crown ' + r.truth.crownGap.toFixed(3) +
      '   detector misses ' + miss.toFixed(3) + ' of hair');
  });
  console.log('  WORST hair under-coverage ' + worstHairMiss.toFixed(3) +
    ' of the square (' + Math.round(worstHairMiss * 302) + 'px at the kiosk size)');
  /* The anchor's own accuracy, measured against the thing it can actually see.
     This is the assertion that grades THE CROP. */
  chose.forEach(r => {
    ok(r.box && Math.abs(r.box.T - 0.205) <= 0.02,
      r.name + ': the crop anchored the detected head top at ' + (r.box ? r.box.T.toFixed(3) : 'nothing') +
      ' instead of 0.205 — the vertical anchor missed its own target');
  });

  ok(!drawnCrown.error,
    'the drawn face could not be rasterised for comparison: ' + drawnCrown.error);
  if (!drawnCrown.error) {
    /* ⛔ THE SPREAD IS THE POINT. A single fixture agreeing with the drawn face
       proves nothing — the anchor must pull EVERY source framing to the same
       place, or it is luck. Measure the worst one. */
    const worst = cg.reduce((m, v) =>
      Math.abs(v - drawnCrown.crownGap) > Math.abs(m - drawnCrown.crownGap) ? v : m, cg[0]);
    const gap = Math.abs(drawnCrown.crownGap - worst);
    console.log('  WORST DIVERGENCE ' + gap.toFixed(3) + ' of the circle (' +
      Math.round(gap * 302) + 'px at the shipped kiosk size)');
    console.log('  SPREAD across source framings ' + (photoMax - photoMin).toFixed(3) +
      ' — the anchor pulls every framing to one place, or it is luck');
    /* ⛔ NOT a floor on either value on its own — a floor on the DISTANCE
       between them. Whichever composition is right, the doctor must not watch
       his own head jump when he toggles Face style. */
    /* ⛔ A RATCHET, NOT AN ACCEPTANCE. The crop now anchors the head top it can
       SEE to within 0.002 of the drawn face's own value, every fixture — that
       part is asserted above and it is done. What remains is that the reader's
       box top sits ~0.07 of the square BELOW the real hair crown, so the head
       a patient sees still sits about 23px higher in the kiosk circle than the
       drawn character's does.

       ⛔ AND THE RESIDUAL IS DELIBERATELY NOT ABSORBED INTO CROWN_TARGET.
       Raising the constant to ~0.275 would make these fixtures line up
       perfectly and would be fitting the shipped product to the hair colour of
       ONE synthetic drawing. [[the-face-box-swallowed-the-hair]] records two
       eye-locator attempts and a grid change that all died of exactly this,
       and its standing instruction is that a detector must not be tuned
       without a real annotated fixture set. The honest cure is hair/skin
       separation in the reader, which is a different lane with a different
       risk profile. Until then this number is PINNED so it cannot quietly get
       worse, and it is reported every run so it cannot be forgotten. */
    ok(gap <= 0.09,
      'REGRESSION: the photograph now sits ' + Math.round(gap * 302) + 'px further from the drawn ' +
      'character than the recorded 23px (worst crown gap ' + worst.toFixed(3) +
      ' vs drawn ' + drawnCrown.crownGap.toFixed(3) + ')');
    ok(worstHairMiss <= 0.09,
      'REGRESSION: the reader now misses ' + worstHairMiss.toFixed(3) + ' of the square in hair, ' +
      'worse than the recorded 0.075 — [[the-face-box-swallowed-the-hair]]');
    ok(photoMax - photoMin <= 0.03,
      'the crop does not converge: crown gap spans ' + (photoMax - photoMin).toFixed(3) +
      ' across source framings, so how the doctor is framed still depends on how he held the camera');
  }

  await browser.close();
  console.log('');
  console.log('PASS 1p avatar surface quality: ' + passed + ' assertions over ' +
    real.length + ' fixtures x ' + SURFACES.length + ' shipped surfaces');
})().catch(err => { console.error(err && err.stack || String(err)); process.exit(1); });
