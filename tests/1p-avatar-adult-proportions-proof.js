'use strict';
/*
 * /1p-only visual proof. No backend, PHI, camera, or patient data — synthetic looks.
 *
 * WHY THIS FILE EXISTS
 * ====================
 * Owner, 2026-08-17, §13: the avatar "must stop looking preschooly". That is not a
 * testable sentence, and this drawing has already been re-cut three times on verdicts
 * exactly like it — including once in the WRONG DIRECTION: p1-adult-art-1.0.0 lifted
 * the whole upper face 8 units to remove "an infant proportion", which moved the eye
 * line from 0.472 (the adult canon) to 0.410 (above any adult band). Nobody could tell,
 * because nothing measured it.
 *
 * So the art direction is now arithmetic. Eleven ratios, each with an adult range from
 * standard front-view anthropometry (palpebral fissure 30x10mm, iris 11.7mm, IPD 63mm,
 * zy-zy 140mm, pupil->subnasale 62mm, pupil->stomion 84mm, pupil->gnathion 130mm,
 * vertex->gnathion 232mm), measured on the REAL 302px kiosk circle.
 *
 * ⛔ AND THE INSTRUMENT IS CHECKED AGAINST THE DRAWING, NOT AGAINST ITSELF.
 * window.__mlsAvatar.lookProportions() derives its numbers from the same tables
 * faceSvg draws from, so on its own it would happily agree with a renderer that had
 * drifted away from it. Every ratio is therefore ALSO measured off the rendered SVG
 * with getBoundingClientRect (which composes every transform) and the two must match.
 * On the first run of this check the two disagreed on mouthWoverFaceW, because the
 * report described the `smile` span (78..122) while an idle face actually wears
 * `neutral` (79..121). That is precisely the class of drift this cross-check exists
 * to catch.
 *
 * It also pins the one animation fact that a transform-string comparison cannot see:
 * that a blink actually closes the eye. The shipped upper-lid shutter bowed the wrong
 * way and covered y83-86 down the middle of an aperture that started at 87.6, so a
 * "blink" closed the outer corners and left the pupil in plain sight — and the mood
 * harness passed throughout, because the transform STRINGS did differ.
 */
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const P1 = path.join(ROOT, '1p-feat_mls_avatar.js');
const MAIN = path.join(ROOT, 'feat_mls_avatar.js');

let checks = 0;
function ok(value, message, detail) {
  assert.ok(value, message + (detail === undefined ? '' : ' :: ' + JSON.stringify(detail)));
  checks++;
}

function sha(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function gitSha(file) {
  const cp = require('child_process');
  return cp.execFileSync('git', ['show', 'HEAD:' + path.basename(file)], { cwd: ROOT });
}

/* The ranges are pinned HERE as well as in the module. A future pass that cannot hit
   a band must move the drawing, not widen the ruler — and if it genuinely believes a
   band is wrong it has to change it in two files and say so. */
const ADULT = {
  eyeLine: [0.44, 0.52],
  cranialOverFacial: [0.78, 1.15],
  apertureAspect: [0.28, 0.44],
  irisOverAperture: [0.33, 0.44],
  eyeWoverFaceW: [0.17, 0.24],
  ipdOverFaceW: [0.40, 0.50],
  browToEye: [0.07, 0.13],
  mouthWoverFaceW: [0.30, 0.42],
  lowerFace: [0.44, 0.62],
  mouthLine: [0.24, 0.42]
};
/* headWoverH is REPORTED and deliberately NOT enforced: closing it means re-cutting
   FACE_SHAPE_PARTS (the matcher's own shape vocabulary) and with it the neck, collar
   and shirt line. That is a silhouette decision for the owner, written up in the lane
   report. It is asserted only to stay inside a sane envelope so a later change cannot
   make it worse unnoticed. */
const HEAD_ASPECT_CEILING = 1.05;

const LOOKS = [
  { name: 'default', look: {} },
  { name: 'round', look: { faceShape: 'round' } },
  { name: 'long', look: { faceShape: 'long' } },
  { name: 'square+beard+glasses', look: { faceShape: 'square', beard: 'beard', glasses: true, age: 'mature' } },
  { name: 'close-set', look: { eyeSet: 'close' } },
  { name: 'wide-set', look: { eyeSet: 'wide' } },
  { name: 'thick brows', look: { brows: 'thick' } },
  { name: 'wide nose', look: { nose: 'wide' } }
];

/* ⛔ THE BROWSER IS CLOSED IN A finally, ALWAYS. A failing assertion between launch
   and close leaves a live Chromium attached to this process, node never exits, and
   the runner reports a HANG instead of the assertion message - which is exactly what
   happened on the first run of this file. A test that cannot report its own failure
   is worse than no test. */
let browserRef = null;
(async () => {
  /* the /1p lane boundary: production must not have moved by one byte */
  assert.strictEqual(sha(MAIN), crypto.createHash('sha256').update(gitSha(MAIN)).digest('hex'),
    'the production avatar file changed; the /1p proof boundary failed');
  checks++;

  const browser = await chromium.launch({ channel: 'chrome' });
  browserRef = browser;
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e && e.message)));
  await page.setContent('<body style="margin:0;background:#eef2ef"><main id="gallery"></main></body>');
  await page.evaluate(() => {
    window.__mlsSessionAccount = 'synthetic-avatar-proof@example.test';
    window.__mlsSessionEpoch = 1;
    window.bkToken = () => 'synthetic-avatar-proof-token';
    window.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, config: {} }) });
    window.toast = () => {};
    window.requestIdleCallback = window.requestIdleCallback || (fn => setTimeout(fn, 0));
  });
  await page.evaluate(src => {
    const script = document.createElement('script');
    script.setAttribute('data-mls-install-token', 'synthetic-avatar-proof-install');
    script.textContent = src;
    document.head.appendChild(script);
  }, fs.readFileSync(P1, 'utf8'));
  await page.waitForTimeout(150);

  const out = await page.evaluate(looks => {
    const owner = window.__mlsAvatar;
    if (!owner || typeof owner.faceDemo !== 'function') return { owner: false };
    if (typeof owner.lookProportions !== 'function') return { owner: true, reporter: false };
    const root = document.getElementById('gallery');
    const r3 = v => Math.round(v * 1000) / 1000;
    const rows = looks.map(entry => {
      const card = document.createElement('section');
      card.style.cssText = 'display:inline-grid;gap:6px;margin:10px;vertical-align:top;width:302px';
      const title = document.createElement('strong');
      title.textContent = entry.name;
      title.style.cssText = 'font:600 13px system-ui;color:#204034';
      /* border-radius:999px, not a rounded square: the real kiosk (#mlsAvKioskFace)
         is a true circle with overflow:hidden, and judging this in a square has
         already misled one review. */
      const stage = document.createElement('div');
      stage.style.cssText = 'width:302px;height:302px;background:#fff;border-radius:999px;overflow:hidden';
      card.append(title, stage);
      root.appendChild(card);
      const ctl = owner.faceDemo(stage, entry.look);
      ctl.mood('idle', false, false);

      const svg = stage.querySelector('svg');
      const origin = svg.getBoundingClientRect();
      const unit = origin.width / 200;
      const cr = sel => {
        const n = stage.querySelector(sel);
        if (!n) return null;
        const b = n.getBoundingClientRect();
        return { x: (b.x - origin.x) / unit, y: (b.y - origin.y) / unit, w: b.width / unit, h: b.height / unit,
          cx: (b.x - origin.x + b.width / 2) / unit, cy: (b.y - origin.y + b.height / 2) / unit,
          bottom: (b.y - origin.y + b.height) / unit };
      };
      const bx = sel => {
        const n = stage.querySelector(sel);
        if (!n) return null;
        const b = n.getBBox();
        return { w: b.width, h: b.height };
      };

      const face = cr('.fFace');
      const jaw = cr('.fJaw');
      const faceBB = bx('.fFace');
      /* the eye clip path has no layout box, so its bbox is in NOMINAL units. Derive
         the .fFrame scale from a shape measured both ways rather than hard-coding it. */
      const frameScale = faceBB ? face.w / faceBB.w : 1;
      const ap0 = bx('clipPath[id^="mlsAvEyeApL"] path');
      const iris0 = bx('.fPupilL circle');
      const apertureW = ap0 ? ap0.w * frameScale : null;
      const apertureH = ap0 ? ap0.h * frameScale : null;
      const irisD = iris0 ? iris0.w * frameScale : null;

      const crownY = face.y;
      const chinY = jaw ? Math.max(face.y + face.h, jaw.y + jaw.h) : face.y + face.h;
      const headH = chinY - crownY;
      const headW = Math.max(face.w, jaw ? jaw.w : 0);
      const pupL = cr('.fPupilL circle');
      const pupR = cr('.fPupilR circle');
      const mouth = cr('.fMouth');
      const nostrilL = cr('.fNostrilL');
      const browL = cr('.fBrowL');
      const eyeCy = (pupL.cy + pupR.cy) / 2;
      const ipd = Math.abs(pupR.cx - pupL.cx);
      const noseBaseY = nostrilL.y + nostrilL.h;

      /* ---- THE BLINK. Drive the shutter by hand at both ends of its range and
         measure where the drawn lid actually lands against the drawn iris. */
      const lid = stage.querySelector('.fLidL');
      const restBottom = cr('.fLidL').bottom;
      lid.style.transform = 'scaleY(1)';
      const closedBottom = cr('.fLidL').bottom;
      lid.style.transform = '';
      const iris = cr('.fPupilL circle');

      return {
        name: entry.name,
        rendered: {
          headWoverH: r3(headW / headH),
          eyeLine: r3((eyeCy - crownY) / headH),
          cranialOverFacial: r3((eyeCy - crownY) / (chinY - eyeCy)),
          apertureAspect: r3(apertureH / apertureW),
          irisOverAperture: r3(irisD / apertureW),
          eyeWoverFaceW: r3(apertureW / headW),
          ipdOverFaceW: r3(ipd / headW),
          browToEye: r3((eyeCy - browL.cy) / headH),
          mouthWoverFaceW: r3(mouth.w / headW),
          lowerFace: r3((chinY - noseBaseY) / (chinY - eyeCy)),
          mouthLine: r3((mouth.cy - noseBaseY) / (chinY - noseBaseY))
        },
        reported: owner.lookProportions(entry.look),
        blink: { restBottom: r3(restBottom), closedBottom: r3(closedBottom),
          irisTop: r3(iris.y), irisBottom: r3(iris.bottom) },
        mouthD: stage.querySelector('.fMouth').getAttribute('d'),
        blush: stage.querySelector('.fBlush') && stage.querySelector('.fBlush').style.opacity,
        dimple: stage.querySelector('.fDimpleL') && stage.querySelector('.fDimpleL').style.opacity,
        hooks: ['fHead', 'fHeadRig', 'fBody', 'fMouth', 'fPupilL', 'fLidL', 'fLowL', 'fDimpleL', 'fUpperFace', 'fNoseSet', 'fMouthSet']
          .every(k => !!stage.querySelector('.' + k)),
        ids: Array.from(stage.querySelectorAll('[id]')).map(n => n.id)
      };
    });
    return { owner: true, reporter: true, rows,
      mouths: { neutral: null },
      speakingMouth: (() => {
        const stage = document.createElement('div');
        stage.style.cssText = 'width:302px;height:302px;position:absolute;left:-9999px';
        document.body.appendChild(stage);
        const ctl = owner.faceDemo(stage, {});
        const seen = {};
        ['idle', 'listening', 'thinking', 'speaking'].forEach(m => {
          ctl.mood(m, false, false);
          seen[m] = stage.querySelector('.fMouth').getAttribute('d');
        });
        ctl.mood('idle', false, true);
        seen.happy = stage.querySelector('.fMouth').getAttribute('d');
        ctl.destroy();
        stage.remove();
        return seen;
      })()
    };
  }, LOOKS);

  ok(out.owner, 'the /1p owner did not boot with synthetic credentials');
  ok(out.reporter, 'window.__mlsAvatar.lookProportions is missing — the proportions are unmeasurable again');

  const summary = {};
  out.rows.forEach(row => {
    summary[row.name] = row.rendered;
    ok(row.hooks, row.name + ': an animation hook or a feature group is missing from the drawing');
    ok(row.ids.length === new Set(row.ids).size, row.name + ': duplicate SVG ids — two faces on one page would cross-wire');

    /* 1. the instrument agrees with the drawing */
    Object.keys(ADULT).concat(['headWoverH']).forEach(key => {
      const a = row.rendered[key], b = row.reported.ratios[key];
      ok(typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= 0.006,
        row.name + ': lookProportions().' + key + ' disagrees with the RENDERED drawing — one of the two has drifted',
        { reported: b, rendered: a });
    });

    /* 2. the drawing is inside the adult bands */
    Object.keys(ADULT).forEach(key => {
      const [lo, hi] = ADULT[key];
      ok(row.rendered[key] >= lo && row.rendered[key] <= hi,
        row.name + ': ' + key + ' is outside the adult range [' + lo + ', ' + hi + '] — this is the "preschooly" complaint, measured',
        row.rendered[key]);
      /* and the module's own published band must not have been widened to suit */
      const band = row.reported.adult[key];
      ok(band && band[0] === lo && band[1] === hi,
        row.name + ': the module\'s published adult band for ' + key + ' no longer matches the one this proof pins — a band was widened instead of the drawing being changed',
        { module: band, proof: [lo, hi] });
    });
    ok(row.rendered.headWoverH <= HEAD_ASPECT_CEILING,
      row.name + ': headWoverH got worse. It is knowingly out of the adult band (see the lane report) but must not regress further',
      row.rendered.headWoverH);

    /* 3. THE BLINK CLOSES THE EYE. At rest the shutter must stop above the iris;
       at scaleY(1) it must cover past its bottom. The shipped version did neither. */
    ok(row.blink.restBottom <= row.blink.irisTop + 0.6,
      row.name + ': the upper lid hangs over the iris at rest — the face is permanently half asleep',
      row.blink);
    ok(row.blink.closedBottom >= row.blink.irisBottom,
      row.name + ': A BLINK DOES NOT CLOSE THE EYE. At scaleY(1) the drawn lid stops above the bottom of the iris, so the pupil stays visible through every blink. This is invisible to a harness that compares transform strings.',
      row.blink);

    /* 4. the resting face is not smiling */
    ok(/^M79 137/.test(row.mouthD),
      row.name + ': the idle mouth is not the neutral resting mouth — the face rests on a smile again',
      row.mouthD);
    ok(Number(row.blush) === 0, row.name + ': idle blush is back — painted cheeks are a child signal', row.blush);
    ok(row.dimple === '0', row.name + ': idle dimples are visible', row.dimple);
  });

  /* 5. the four conversational states are four different mouths, and NONE of the
     non-greeting ones is the warm smile */
  const m = out.speakingMouth;
  ok(m.idle !== m.listening && m.idle !== m.thinking && m.idle !== m.speaking && m.idle !== m.happy,
    'the idle mouth is shared with another state — the states are not distinguishable', m);
  ok(m.idle !== m.happy, 'the resting mouth and the greeting mouth are the same shape', m);
  ok(new Set([m.idle, m.listening, m.thinking, m.speaking, m.happy]).size === 5,
    'the five conversational mouths are not five distinct shapes', m);

  assert.strictEqual(errors.length, 0, 'the proof raised page errors: ' + errors.join('; '));
  console.log('PASS 1p avatar adult proportions proof — ' + checks + ' checks across ' + out.rows.length + ' synthetic looks');
  console.log(JSON.stringify(summary, null, 1));
})()
  .catch(err => { console.error(err.stack || err); process.exitCode = 1; })
  .then(async () => { if (browserRef) await browserRef.close().catch(() => {}); });
