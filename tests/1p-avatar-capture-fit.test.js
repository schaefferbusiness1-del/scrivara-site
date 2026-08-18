'use strict';

/*
 * /1p/ preview only — avfit-1.0.0: THE CAPTURE, THE PARTIAL APPLICATION,
 * THE FACE STYLE AND THE STEP AFTER IT.
 *
 * Owner, 2026-08-17, holding the avatar Set up screen with the mode select
 * reading "My photo — closest likeness…" and the result reading "No animated
 * traits changed · 5 of 14 details were readable; the match was incomplete, so
 * all character settings stayed unchanged":
 *
 *   "for the avatar this is unacceptable and always happens. And also when you
 *    take a picture it goes to 'My photo' — that's not ok, it should stay on
 *    avatar. And also once you're done, these things don't stop — just keep
 *    doing everything else."
 *
 * WHAT WAS MEASURED BEFORE ANY OF THIS WAS WRITTEN
 * (tests/1p-avatar-capture-readability-proof.js drives the real reader in real
 * Chrome; the numbers below are its output, and it is the file to re-run):
 *
 *   - His number reproduces exactly. Synthetic webcam frames at 640x480 and
 *     1280x720 with the head at 15-35% of frame height read 5-8 of 14, and
 *     exactly 5 on mid-brown and deep skin.
 *   - At head 15% of frame height — a doctor sitting back from a laptop lid —
 *     the reader finds NO face at all: 0 of 14, at both frame sizes.
 *   - Sweeping the SAME face from 20% to 80% of the analysed square moves the
 *     count 6,7,7,7,7,6,7. So the ceiling is NOT resolution, and "make the face
 *     bigger" alone could never have fixed it.
 *   - Five of the fourteen ledger entries are claimable only in the minority
 *     case (beard/glasses/hairline/browCol are pushed ONLY when the feature is
 *     PRESENT) or never (faceShape is measured and deliberately excluded). A
 *     clean-shaven doctor with no glasses, a full hairline and brows the colour
 *     of his hair cannot score above nine out of fourteen, and the documented
 *     whole-read bar is six.
 *   - An ideal face-aware crop of a 3-pixel head produced a 64px square that
 *     the reader UPSCALED to its 128 grid and then confidently described: 5 of
 *     14 on a face that is not there. That is [[face-matcher-measured-a-12-
 *     pixel-face]] recreated by the fix, and it is why faceFitPlan refuses to
 *     crop below the analysis grid.
 *
 * SO THE CHANGE IS IN THREE PARTS AND THIS FILE PINS ALL THREE:
 *   1. CAPTURE — the shutter re-crops to the face it found, with hair and
 *      forehead margin, under three refusals: never upscale, the crop must pay
 *      for itself in claims, and no unlit surface reaches the matcher.
 *   2. APPLICATION — an incomplete read applies the traits it really measured,
 *      labelled, and is never called a match. The gate above it is untouched.
 *   3. THE FLOW — the Face style select is never written implicitly again, and
 *      Setup publishes its state and its next control instead of stopping on a
 *      paragraph.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, '1p-feat_mls_avatar.js'), 'utf8');
const studio = fs.readFileSync(path.join(root, '1p-feat_mls_avatar_face.js'), 'utf8');
let passed = 0;
function ok(value, message) { assert.ok(value, message); passed++; }
function eq(actual, expected, message) { assert.strictEqual(actual, expected, message); passed++; }
function between(src, first, last) {
  const a = src.indexOf(first), b = src.indexOf(last, a);
  if (a < 0 || b <= a) throw new Error('missing source boundary: ' + first);
  return src.slice(a, b);
}
function safe(fn, fallback) { try { return fn(); } catch (e) { return fallback; } }

/* ---- 0. THE SAFETY LINE THIS CHANGE MAY NOT CROSS ---------------------- */

ok(/examined >= 10 && claimed >= 6 && hasIdentityPalette/.test(source),
  'the avatar match gate is no longer `examined >= 10 && claimed >= 6` plus the identity palette');
ok(/examined: FACE_MATCH_FIELDS\.length/.test(source),
  'the evidence denominator stopped being the full fourteen-control ledger');

/* ---- 1. THE CAPTURE FIT ------------------------------------------------- */

/* One fake canvas that RECORDS the crop rectangle drawImage was given, so the
   plan is read off the real call rather than off the planner's own return. */
function makeEnv(options) {
  const opts = options || {};
  const drawn = [];
  const document = { createElement(tag) {
    assert.strictEqual(tag, 'canvas');
    const canvas = { width: 0, height: 0, __drawn: drawn };
    canvas.getContext = () => ({
      imageSmoothingEnabled: false, imageSmoothingQuality: '',
      drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh) {
        drawn.push({ sx, sy, sw, sh, dw, dh, from: img });
      }
    });
    return canvas;
  } };
  const api = new Function('MEASURE_MAX', 'document', 'safe', 'frameQuality',
    'avcamFrameLooksLive', 'faceReadPortrait', 'faceCaptureVerdict',
    between(source, 'var FACE_FIT_TARGET', '/* ===== end avfit-1.0.0 =====') +
    '\nreturn { report: faceFitReport, plan: faceFitPlan, better: faceFitBetter, apply: faceFitApply,' +
    '  TARGET: FACE_FIT_TARGET, MIN_SRC: FACE_FIT_MIN_SRC };')(
      1024, document, safe,
      () => opts.quality || { sharp: 5, exposure: 130 },
      () => opts.lit !== false,
      () => opts.cropRead === undefined
        ? { look: {}, derived: ['skin'], receipt: { claimed: 9, grid: 256, faceW: 108 },
            box: { grid: 256, L: 74, R: 182, T: 60, B: 190, w: 108, cx: 128 } }
        : opts.cropRead,
      (res, q) => ({ ready: opts.cropReady !== false, why: '', score: 1 })
    );
  api.drawn = drawn;
  return api;
}

const fit = makeEnv();
eq(fit.TARGET, 0.34, 'the framing target drifted from faceCaptureVerdict\'s matchLimited bound');
ok(/faceRatio < 0\.34/.test(between(source, 'function faceCaptureVerdict', '/* BEST OF SEVERAL FRAMES')),
  'faceCaptureVerdict\'s own 0.34 bound moved, so the guide now promises a frame the shutter grades differently');
/* ⛔ 128, AND THAT NUMBER IS LOAD-BEARING. faceReadPortrait picks its grid as
   `M = min(iw,ih) >= 256 ? 256 : 128` and then draws the source into M, so a
   crop of 128-255 source pixels is DOWNSCALED into the 128 grid and a crop
   below 128 is UPSCALED — which is the 12-pixel-face defect. Measured with the
   floor at 256, the ordinary 640x480 head-22% laptop framing was refused a crop
   it benefits from (face 0.18 -> 0.42 of the grid, no claim lost, canary still
   refused); measured at 128, it gets it. Anything below 128 must never be
   accepted whatever else changes. */
eq(fit.MIN_SRC, 128, 'the never-upscale floor is no longer the smaller analysis grid');
ok(/M = Math\.min\(iw, ih\) >= 256 \? 256 : 128/.test(source),
  'the reader\'s grid rule moved, so FACE_FIT_MIN_SRC is no longer the point below which a crop is upscaled');

/* A face 20% of the analysed square, in a 720px capture — the ordinary laptop
   framing measured above. It must be cropped, and the crop must contain the
   hair: the box top is the top of the SKIN, so the crop has to reach above it. */
const wide = { grid: 256, L: 96, R: 159, T: 96, B: 151, w: 64, cx: 128 };
const plan = fit.plan({ width: 720 }, { box: wide });
ok(plan, 'an ordinary webcam framing is left uncropped, so every reader keeps measuring 4-6px features');
ok(plan.side >= 256, 'the plan crops below the analysis grid and would be upscaled');
ok(plan.side < 720, 'the plan is not actually a crop');
{
  const scale = 720 / 256;
  const faceFrac = (wide.w * scale) / plan.side;
  ok(faceFrac > 0.34 && faceFrac < 0.55,
    'the crop leaves the face at ' + faceFrac.toFixed(3) + ' of the frame — outside the readable band it exists to reach');
  const skinTop = wide.T * scale;
  ok(plan.sy < skinTop - 40,
    'the crop starts at or below the forehead: it would cut the hair off, which is [[the-face-box-swallowed-the-hair]] from the other side');
  const chin = wide.B * scale;
  ok(plan.sy + plan.side > chin + 10, 'the crop stops at or above the chin');
}

/* ⛔ THE CANARY. A face too small to crop without upscaling is not cropped. */
eq(fit.plan({ width: 720 }, { box: { grid: 256, L: 120, R: 136, T: 118, B: 134, w: 16, cx: 128 } }), null,
  'a tiny face is cropped and upscaled — the 12-pixel-face defect, recreated by its own fix');
eq(fit.plan({ width: 128 }, { box: { grid: 128, L: 40, R: 60, T: 40, B: 66, w: 20, cx: 50 } }), null,
  'a small capture is cropped below the grid');
/* …and a face that already fills the frame is left alone. */
eq(fit.plan({ width: 720 }, { box: { grid: 256, L: 60, R: 196, T: 50, B: 200, w: 136, cx: 128 } }), null,
  'a well-framed face is re-cropped for no reason');
eq(fit.plan({ width: 720 }, null), null, 'a frame with no face box produces a crop plan');
eq(fit.plan({ width: 0 }, { box: wide }), null, 'a zero-width capture produces a crop plan');

/* THE CROP MUST PAY FOR ITSELF. */
function q(claimed, faceW, ready) {
  return { faceVerdict: { ready: ready !== false },
    faceResult: { receipt: { claimed: claimed, faceW: faceW, grid: 256 } } };
}
eq(fit.better(q(7, 64), q(9, 108)), true, 'a crop that reads MORE controls at a bigger face size is rejected');
eq(fit.better(q(7, 64), q(5, 108)), false, 'a crop that reads FEWER controls is kept');
eq(fit.better(q(7, 64), q(9, 60)), false, 'a crop that did not enlarge the face is kept');
eq(fit.better(q(7, 64), q(9, 108, false)), false, 'a crop the capture verdict refuses is kept');
eq(fit.better(q(7, 64), null), false, 'a failed crop is treated as an improvement');

/* END TO END: a plan is executed and the returned square is the cropped one.
   avfit-1.1.0 tries a LADDER of candidates, so the count of draws is the number
   tried rather than one; every draw must still be square, from the captured
   frame, and never upscaled. */
{
  const env = makeEnv();
  const before = { width: 720, __id: 'wide' };
  const out = env.apply(before, Object.assign({ faceResult: { box: wide, receipt: { claimed: 7, faceW: 64, grid: 256 } } },
    { sharp: 5, exposure: 130 }), null);
  eq(out.fitted, true, 'the shutter did not adopt a crop that reads better');
  ok(out.square !== before, 'the shutter kept the wide frame after accepting the crop');
  /* the locator draws its own 160px analysis copy with the 4-argument form;
     the CROPS are the 9-argument draws */
  const crops = env.drawn.filter(d => d.dw !== undefined);
  ok(crops.length >= 1, 'no crop was drawn at all');
  ok(out.tried >= 1, 'the shutter did not report how many candidates it tried');
  crops.forEach((d, i) => {
    eq(d.from, before, 'candidate ' + i + ' was taken from something other than the captured frame');
    eq(d.sw, d.sh, 'candidate ' + i + ' is not square, so it would stretch the face');
    ok(d.dw <= d.sw, 'candidate ' + i + ' is UPSCALED on its way into the analysis surface');
  });
}
/* ⛔ EVERY CANDIDATE IS JUDGED AGAINST THE WHOLE FRAME, never against the
   previous one — a ladder that compared each rung to the last could walk
   downhill one accepted step at a time. */
ok(/EVERY candidate is judged against the WIDE frame, never against the/.test(source),
  'the ladder lost the rule that keeps it from walking downhill');
ok(/if \(!faceFitBetter\(q, attempt\.q\)\) continue;/.test(source),
  'a candidate is accepted without beating the whole frame');
/* ⛔ AN UNLIT CROP NEVER REACHES THE MATCHER. */
{
  let reads = 0;
  const document = { createElement: () => ({ width: 0, height: 0,
    getContext: () => ({ imageSmoothingEnabled: false, imageSmoothingQuality: '', drawImage() {} }) }) };
  const api = new Function('MEASURE_MAX', 'document', 'safe', 'frameQuality',
    'avcamFrameLooksLive', 'faceReadPortrait', 'faceCaptureVerdict',
    between(source, 'var FACE_FIT_TARGET', '/* ===== end avfit-1.0.0 =====') +
    '\nreturn faceFitApply;')(
      1024, document, safe, () => ({ sharp: 0, exposure: 0 }), () => false,
      () => { reads++; return null; }, () => ({ ready: false }));
  const out = api({ width: 720 }, { faceResult: { box: wide, receipt: { claimed: 7, faceW: 64, grid: 256 } } });
  eq(reads, 0, 'a zero-luminance crop was handed to faceReadPortrait — the exact frame avcam-1.0.0 exists to stop');
  eq(out.fitted, false, 'an unlit crop was adopted');
}

/* ---- 1b. THE BROWSER'S OWN FACE DETECTOR ------------------------------
   ⛔ UNVERIFIED AGAINST A REAL BROWSER: window.FaceDetector is undefined in the
   Chrome these suites drive (1p-avatar-warm-wall-proof asserts that, so the day
   it appears the claim gets re-measured instead of repeated). What IS provable
   here is the contract around it: absent detector -> synchronous fall-through,
   which is what keeps the shutter's single-turn behaviour; one face -> its box
   leads the ladder; zero or several faces -> fall back rather than guess which
   person is the physician; a throwing or never-answering detector -> the same
   answer as no detector at all. */
function resolveEnv(detectorFactory) {
  const seen = { calls: 0, options: null };
  const timers = [];
  const win = {};
  if (detectorFactory) {
    win.FaceDetector = function (options) {
      seen.calls++; seen.options = options;
      this.detect = detectorFactory;
    };
  }
  const api = new Function('MEASURE_MAX', 'document', 'window', 'safe', 'setTimeout',
    'frameQuality', 'avcamFrameLooksLive', 'faceReadPortrait', 'faceCaptureVerdict',
    between(source, 'var FACE_FIT_TARGET', '/* ===== end avfit-1.0.0 =====') +
    '\nreturn { resolve: faceFitResolve, apply: faceFitApply, planFrom: faceFitPlanFrom };')(
      1024,
      { createElement: () => ({ width: 0, height: 0, getContext: () => ({
        imageSmoothingEnabled: false, imageSmoothingQuality: '', drawImage() {} }) }) },
      win, safe, (fn) => { timers.push(fn); return timers.length; },
      () => ({ sharp: 5, exposure: 130 }), () => true,
      () => ({ look: {}, derived: ['skin'], receipt: { claimed: 9, grid: 256, faceW: 108 },
        box: { grid: 256, L: 74, R: 182, T: 60, B: 190, w: 108, cx: 128 } }),
      () => ({ ready: true, why: '', score: 1 }));
  return { api, seen, timers, win };
}
{
  /* no detector: `then` must fire SYNCHRONOUSLY */
  const env = resolveEnv(null);
  let sync = false, got = null;
  env.api.resolve({ width: 720 }, { faceResult: { box: { grid: 256, L: 96, R: 159, T: 96, B: 151, w: 64, cx: 128 },
    receipt: { claimed: 7, faceW: 64, grid: 256 } } }, (r) => { sync = true; got = r; });
  eq(sync, true, 'with no FaceDetector the shutter no longer resolves in one turn — the camera path is now async for everyone');
  ok(got, 'the synchronous fall-through produced no result');
}
{
  /* exactly one face: its box leads */
  const face = { boundingBox: { x: 300, y: 200, width: 180, height: 230 } };
  const env = resolveEnv(() => Promise.resolve([face]));
  let got = null;
  env.api.resolve({ width: 720 }, { faceResult: null }, (r) => { got = r; });
  eq(env.seen.calls, 1, 'the browser detector was not constructed');
  ok(env.seen.options && env.seen.options.maxDetectedFaces > 1,
    'the detector is asked for one face, so a second person could never be noticed and refused');
}
{
  /* several faces: refuse to guess which is the physician */
  const two = [{ boundingBox: { x: 10, y: 10, width: 80, height: 100 } },
    { boundingBox: { x: 300, y: 200, width: 180, height: 230 } }];
  const env = resolveEnv(() => Promise.resolve(two));
  env.api.resolve({ width: 720 }, { faceResult: null }, () => {});
  ok(true, 'multi-face fall-back path executed');   /* asserted on source below */
}
ok(/if \(list\.length !== 1\) \{ settle\(null\); return; \}/.test(source),
  'the camera detector picks one of several faces instead of falling back — the upload path refuses exactly this');
ok(/var FACE_DETECT_MS = 1200;/.test(source), 'the browser detector has no deadline');
ok(/typeof Detector !== 'function'/.test(source),
  'the detector path is not guarded on the browser actually having one');
ok(/UNVERIFIED IN A REAL BROWSER/.test(source),
  'the module stopped saying that the FaceDetector path has never been proven in a real browser');

/* ---- 1c. THE STRUCTURE LOCATOR ---------------------------------------- */
ok(/FACE_LOCATE_MIN_SKIN = 0\.45/.test(source), 'the locator lost its skin-coverage term, so a bookshelf can win');
ok(/FACE_LOCATE_ABS_FLOOR = 1\.6/.test(source), 'the locator lost its absolute structure floor, so a flat wall can win');
ok(/FACE_LOCATE_REL_FLOOR/.test(source), 'the locator lost its per-frame relative floor');
ok(/faceIsSkinRgb\(d\[i\], d\[i \+ 1\], d\[i \+ 2\]\)/.test(source),
  'the locator built its own skin test instead of the one the reader uses');
ok(/var contrast = inner - \(outerN > 0 \? outerSum \/ outerN : 0\);/.test(source),
  'the locator scores absolute energy rather than energy against its own surround, so a busy room wins');

/* THE THREE READINESS FACTS the guide shows and the shutter is graded on. */
{
  const good = fit.report({ box: { grid: 256, L: 60, R: 196, T: 50, B: 200, w: 136, cx: 128,
    eL: { n: 40 }, eR: { n: 38 } } }, { exposure: 130 });
  eq(good.sizeOk, true, 'a face filling 53% of the grid is reported too small');
  eq(good.eyesOk, true, 'two solid eye masses are reported as not found');
  eq(good.lightOk, true, 'ordinary room light is reported out of band');
  eq(good.ready, true, 'a frame passing all three facts is not reported ready');
  const small = fit.report({ box: { grid: 256, L: 96, R: 159, T: 96, B: 151, w: 64, cx: 128,
    eL: { n: 40 }, eR: { n: 38 } } }, { exposure: 130 });
  eq(small.sizeOk, false, 'a face at 25% of the grid is reported big enough');
  ok(/closer/i.test(small.say), 'a too-small face is not told to move closer');
  const oneEye = fit.report({ box: { grid: 256, L: 60, R: 196, T: 50, B: 200, w: 136, cx: 128,
    eL: { n: 40 }, eR: { n: 2 } } }, { exposure: 130 });
  eq(oneEye.eyesOk, false, 'a 2-pixel stray counts as the second eye');
  const dark = fit.report({ box: { grid: 256, L: 60, R: 196, T: 50, B: 200, w: 136, cx: 128,
    eL: { n: 40 }, eR: { n: 38 } } }, { exposure: 20 });
  eq(dark.lightOk, false, 'a dark room is reported lit');
  ok(/light/i.test(dark.say), 'a dark room is not told about light');
  const none = fit.report(null, { exposure: 130 });
  eq(none.faceFound, false, 'a frame with no face reports one');
  eq(none.ready, false, 'a frame with no face is reported ready');
  ok(/oval/i.test(none.say), 'the no-face guide does not name the target the overlay draws');
}
/* THE OVAL THE DOCTOR AIMS AT IS THE TARGET THE MATCHER NEEDS — one constant. */
ok(/ctx\.ellipse\(w \/ 2, h \* 0\.46, w \* FACE_FIT_TARGET \* 0\.62/.test(source),
  'the framing oval is drawn from a literal instead of the readable-face target');

/* ---- 2. THE PARTIAL APPLICATION ---------------------------------------- */

const lookApi = new Function(
  between(source, 'var FACE_LOOK = {', 'var FACE_MOUTHS') +
  between(source, 'function faceLab(rgb)', 'function faceReadPortrait(img)') +
  '\nreturn { decide: faceMatchDecision, partial: facePartialDecision, apply: faceApplyDerived,' +
  '  safe: faceLookSafe, FACE_LOOK: FACE_LOOK, MIN: FACE_PARTIAL_MIN, FIELDS: FACE_MATCH_FIELDS };'
)();

function read(claimed, extra) {
  const knobs = lookApi.FIELDS.slice(0, claimed);
  const look = {};
  knobs.forEach(k => { look[k] = k === 'skin' ? '#c68642' : (k === 'hair' ? '#241a11' : 'x'); });
  return Object.assign({
    look, derived: knobs,
    receipt: Object.assign({ claimed, refused: 14 - claimed, examined: 14, faceW: 108,
      grid: 256, srcKind: 'photo', fromIllustration: false }, (extra || {}).receipt || {})
  }, (extra || {}).top || {});
}
function partialOf(res) { return lookApi.partial(res, lookApi.decide(res)); }

eq(lookApi.MIN, 2, 'the partial-application floor is not the documented two claims');

/* THE OWNER'S CASE, EXECUTED: 5 of 14 must now APPLY those five. */
const five = read(5);
eq(lookApi.decide(five).applies, false, 'a five-control read became a whole match');
eq(partialOf(five).partial, true, 'the owner\'s 5-of-14 read still applies nothing at all');
eq(partialOf(five).derived.join(','), 'skin,hair,hairStyle,beard,glasses',
  'the partial application changed which controls it applies');
eq(partialOf(five).skipped.length, 9, 'the nine unreadable controls are not counted for the doctor');

/* …and the applied VALUES really reach the character, through the ONE applier. */
{
  const applied = partialOf(five);
  const out = lookApi.apply(lookApi.FACE_LOOK, { derived: applied.derived, look: five.look });
  eq(out.skin, '#c68642', 'a claimed mid-brown skin tone did not reach the character');
  eq(out.hair, '#241a11', 'a claimed hair colour did not reach the character');
  eq(out.nose, lookApi.safe(lookApi.FACE_LOOK).nose,
    'an UNCLAIMED control was changed by the partial application');
  eq(out.shirt, lookApi.safe(lookApi.FACE_LOOK).shirt,
    'an unclaimed top colour was changed by the partial application');
}
/* it never extends the ledger — no absence is ever claimed */
partialOf(five).derived.forEach(k =>
  ok(five.derived.indexOf(k) >= 0, k + ' was applied without having been claimed by any reader'));
/* the two states are exclusive */
eq(partialOf(read(7)).partial, false, 'a passing whole read is reported as partial as well');
eq(partialOf(read(7)).derived.length, 0, 'a passing whole read hands the partial path an apply list too');

/* ⛔ THE FIVE REFUSALS THAT MAKE PARTIAL APPLICATION SAFE. */
const noSkin = read(8); noSkin.derived = noSkin.derived.filter(k => k !== 'skin');
eq(partialOf(noSkin).partial, false,
  'traits are applied without a proven skin sample — the one measurement that proves a face and not a wall');
ok(/skin tone could not be read/.test(partialOf(noSkin).why), 'the no-skin refusal does not say why');
eq(partialOf(read(9, { receipt: { fromIllustration: true } })).partial, false,
  'a stylized copy\'s manufactured colours are applied partially');
eq(partialOf(read(9, { receipt: { srcKind: 'unknown' } })).partial, false,
  'an image never proved to be a photograph is applied partially');
eq(partialOf(read(5, { receipt: { examined: 8, refused: 3 } })).partial, false,
  'a truncated ledger qualifies by having little left to refuse');
eq(partialOf(read(1)).partial, false,
  'one claimed field over thirteen defaults is applied — the 1-of-14 case p1-photo-truth-1.0.0 was written against');
eq(partialOf(read(2)).partial, true, 'the two-claim floor is not the floor actually enforced');
eq(partialOf({ look: null, derived: [], receipt: {} }).partial, false, 'an empty read applies something');
eq(partialOf(null).partial, false, 'a null read applies something');

/* THE DOCTOR IS TOLD, IN THE SHAPE HE ASKED FOR. */
const refusalBranch = between(source, 'if (!decision.applies) {', '/* The exact photo/edit revision is still current');
ok(/'Applied ' \+ applied\.length \+ ' of ' \+/.test(refusalBranch),
  'the partial result does not say how many of how many were applied');
ok(/applied\.map\(faceKnobLabel\)\.join\(', '\)/.test(refusalBranch),
  'the partial result does not NAME the traits it applied');
ok(/could not be read — retake in better light to refine/.test(refusalBranch),
  'the partial result does not tell the doctor what to do about the rest');
ok(/partial read, not a match/.test(refusalBranch),
  'a partial application is presented without saying it is not a match');
ok(!/match complete|Matched \d/.test(refusalBranch), 'the refusal branch claims a completed match');
/* the source writes the dash as a — escape; accept either spelling so this
   pin cannot be defeated by a byte-level change of mind about the character */
ok(/left at the default (—|\\u2014) not readable from this photo/.test(refusalBranch),
  'the unread controls are still described as merely "unchanged"');
ok(/mlsAvRetakePhoto/.test(source), 'there is no one-tap Retake beside the partial result');
/* every one of the fourteen is named, once, in the ledger */
ok(/FACE_MATCH_FIELDS\.forEach\(function \(k\) \{\s*\n\s*var on = got\.indexOf\(k\) >= 0;/.test(source),
  'the result ledger is not built from the same fourteen-control list the receipt counts');
lookApi.FIELDS.forEach(k => ok(new RegExp('\\b' + k + ':').test(between(source, 'var FACE_KNOB_SAID = {', 'function faceKnobLabel')),
  k + ' has no English name, so the applied list would print a code name'));

/* ---- 3. THE FACE STYLE IS NEVER WRITTEN IMPLICITLY --------------------- */

const modeApi = new Function(
  between(source, 'function faceModeOnLoad(savedMode, savedImage)', 'function makePhotoFace') +
  '\nreturn { onLoad: faceModeOnLoad, after: faceModeAfterCapture };')();
eq(modeApi.onLoad('', 'data:image/png;base64,x'), 'drawn', 'merely having a portrait selects photo mode on load');
eq(modeApi.onLoad('photo', ''), 'photo', 'a deliberate saved photo choice is discarded on load');
eq(modeApi.after('drawn', false), 'drawn', 'taking a picture switches an untouched select to My photo');
eq(modeApi.after('drawn', true), 'drawn', 'taking a picture overrides a deliberate Animated choice');
eq(modeApi.after('photo', true), 'photo', 'taking a picture undoes a deliberate My photo choice');
/* ASSIGNMENT, not comparison: `\s*=` alone also matches `===`, and the refusal
   branch legitimately READS the select to name the face that is selected. */
ok(!/faceModeSelect\.value\s*=(?!=)/.test(refusalBranch),
  'an incomplete match still writes the Face style select — the owner\'s "it goes to My photo"');
ok(/faceModeSelect\.value === 'photo'\s*\n?\s*\?/.test(refusalBranch) ||
   /faceModeSelect && faceModeSelect\.value === 'photo'/.test(refusalBranch),
  'the refusal no longer reads the select to name the face that is really selected');
{
  /* the ONLY assignments to the select anywhere are the capture rule (which
     preserves whatever is selected) and the doctor's own change handler */
  const writes = source.match(/faceModeSelect\.value = [^;]+;/g) || [];
  eq(writes.length, 1, 'the Face style select is written from ' + writes.length +
    ' places; exactly one (faceModeAfterCapture, which preserves the selection) is allowed');
  ok(/faceModeAfterCapture/.test(writes[0]), 'the one Face style write is not the capture-preserving rule');
}
/* and the list leads with the animated character */
ok(/\['drawn', 'Animated character[^']*'[^\]]*\], \['photo', 'My photo/.test(source),
  'the Face style list still offers My photo first, against "avatar is the primary"');
ok(/Animated character[\s\S]{0,200}\(recommended\)/.test(source),
  'the recommendation still sits on My photo');

/* ---- 4. AND THEN IT KEEPS GOING ---------------------------------------- */

const stepApi = new Function('safe', 'qValues',
  between(source, 'function avatarSetupNextId(state)', 'function avatarSetupStep(state)') +
  '\nreturn avatarSetupNextId;');
const withQuestions = stepApi(safe, () => ['Why are you here today?']);
const withNone = stepApi(safe, () => []);
eq(withQuestions('matched'), 'mlsAvSaveBtn', 'a complete match does not send the doctor to Save');
eq(withQuestions('matched-partial'), 'mlsAvSaveBtn', 'a partial match stops on its result text');
eq(withQuestions('match-refused'), 'mlsAvSaveBtn', 'a refusal stops on its result text');
eq(withNone('matched'), 'mlsAvAddQuestion',
  'a match with no questions sends the doctor to Save, where saving leaves the check-in OFF for patients');
eq(withNone('matched-partial'), 'mlsAvAddQuestion', 'a partial match with no questions skips the questions');
eq(withQuestions('captured'), 'mlsAvMatchBtn', 'a captured portrait does not point at the match');
eq(withQuestions('capturing'), 'mlsAvMatchBtn', 'an open camera does not point at the match');
eq(withQuestions('matching'), '', 'a match in flight names a next control the doctor should not press');
eq(withQuestions('nonsense-state'), '', 'an unknown state invents a next control');

/* the three ids the step machine addresses must actually exist on the controls */
['mlsAvMatchBtn', 'mlsAvAddQuestion', 'mlsAvSaveBtn'].forEach(id =>
  ok(new RegExp("\\.id = '" + id + "'").test(source), id + ' is addressed by the step machine but never assigned'));
/* the state and the next control are published for the glow lane */
ok(/form\.setAttribute\('data-mls-avatar-state', setupState\)/.test(source),
  'the setup state is not published on the form');
ok(/form\.setAttribute\('data-mls-avatar-next', setupNextId\)/.test(source),
  'the next control id is not published on the form');
ok(/next\.setAttribute\('data-mls-next-step', '1'\)/.test(source),
  'the next control is not marked, so the glow lane has nothing to light');
ok(/removeAttribute\('data-mls-next-step'\)/.test(source),
  'an earlier next-step marker is never cleared, so two controls claim to be next');
ok(/new CustomEvent\('mls:avatar-step'/.test(source), 'no event announces a step change');
/* every state the machine can publish is reached from somewhere */
['captured', 'matching', 'matched', 'capturing'].forEach(state =>
  ok(new RegExp("avatarSetupStep\\('" + state + "'\\)").test(source), 'no code path ever publishes state ' + state));
ok(/avatarSetupStep\(partial\.partial \? 'matched-partial' : 'match-refused'\)/.test(source),
  'the two incomplete-read outcomes are not published as distinct states, so the glow lane cannot tell them apart');
/* ⛔ it must not fire rAF: this panel is measured in non-compositing tabs */
ok(!/requestAnimationFrame/.test(between(source, 'function avatarSetupStep(state)', 'matchBtn.addEventListener')),
  'the step machine uses requestAnimationFrame, which never fires in a hidden tab');

/* ---- 5. THE METER AGREES WITH THE ENGINE ------------------------------- */

const summarize = new Function('receipt', 'wholeReadRefusal', 'partialApplied',
  between(studio, 'function summarizeReceipt(receipt, wholeReadRefusal, partialApplied)', 'function style()') +
  '\nreturn summarizeReceipt(receipt, wholeReadRefusal, partialApplied);');
{
  const partialMeter = summarize({ claimed: 5, refused: 9, examined: 14, faceW: 108, grid: 256 }, true, 5);
  eq(partialMeter.applied, false, 'the meter calls a partial application a whole match');
  eq(partialMeter.partial, true, 'the meter does not report the partial application at all');
  ok(/Applied 5 of 14/.test(partialMeter.detail), 'the partial meter hides how much was applied');
  ok(/not a match/.test(partialMeter.detail), 'the partial meter does not say it is not a match');
  ok(!/^No animated traits changed/.test(partialMeter.heading),
    'the meter says nothing changed while five controls change beside it');
  const nothing = summarize({ claimed: 5, refused: 9, examined: 14, faceW: 108, grid: 256 }, true, 0);
  eq(nothing.partial, false, 'a read that applied nothing is dressed up as a partial application');
  ok(/No animated traits changed/.test(nothing.heading), 'a read that applied nothing lost its honest heading');
  const whole = summarize({ claimed: 12, refused: 2, examined: 14, faceW: 154, grid: 256 }, false, 0);
  eq(whole.applied, true, 'a whole match stopped being reported as applied');
  eq(whole.level, 'strong', 'a well-framed 12-of-14 match stopped being strong');
}

console.log('PASS 1p avatar capture fit: ' + passed + ' assertions');
