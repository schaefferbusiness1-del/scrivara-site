'use strict';

/*
 * /1p/ preview only — the face-to-photo defects the owner reported on
 * 2026-08-13, with his own screenshot as the control case.
 *
 *   "THE AVATAR IS REALLY GOOD BUT NEEDS A FIX FOR FACE TO PHOTO. THIS NEVER
 *    LOADS AND IF U RTAKE TOO LOPNG TO TAKE THE PICUTRE IT BLACKS OUT ...
 *    ALSO IF i CLICK ANIMATION IT SOHUDL KEEP IT NOT CHANGE IT. ALSO U
 *    SHOPULD BE ABLE TO UPLAOD A PHOTO IF U WANT"
 *
 * Five separate mechanisms, each pinned here:
 *
 *  1. THE MATCH REFUSED ITS OWN DOCUMENTED BAR. faceMatchDecision required
 *     `claimed > refused` on top of the four conditions its comment states.
 *     Against the fixed 14-control ledger that is a bar of EIGHT, not six, and
 *     it fails a tie — the screenshot read 7 of 14 with both skin and hair and
 *     was refused. Executable below, with the refusals that must survive.
 *  2. THE METER STOPPED LOOKING. The studio polled for 4.5s and gave up
 *     silently, leaving "Matching your photo…" on screen forever.
 *  3. THE MATCH HAD NO DEADLINE. api() wraps fetch with no timeout, so a
 *     backend that never answers froze the note with no result and no refusal.
 *  4. A REFUSAL OVERRULED THE DOCTOR'S FACE STYLE. An incomplete match forced
 *     the select back to 'photo' even when he had just chosen Animated.
 *  5. THE CAMERA WENT BLACK. The live view allocated three canvases per tick
 *     at 8Hz and had no witness for a dead feed.
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

/* ---- 1. THE OWNER'S SCREENSHOT, EXECUTED ------------------------------- */

const decide = new Function(
  between(source, 'var FACE_LOOK = {', 'var FACE_MOUTHS') +
  between(source, 'function faceLab(rgb)', 'function faceReadPortrait(img)') +
  '\nreturn faceMatchDecision;'
)();

function read(claimed, extra) {
  /* skin and hair first, so `claimed` counts the identity palette in */
  const knobs = ['skin', 'hair', 'hairStyle', 'beard', 'glasses', 'eyes', 'brows',
    'browCol', 'lips', 'nose', 'eyeSet', 'hairline', 'faceShape', 'shirt'].slice(0, claimed);
  const look = {};
  knobs.forEach(k => { look[k] = k === 'skin' ? '#f0c8a0' : (k === 'hair' ? '#241a11' : 'x'); });
  return Object.assign({
    look, derived: knobs,
    receipt: Object.assign({ claimed, refused: 14 - claimed, examined: 14, faceW: 112,
      grid: 256, srcKind: 'photo', fromIllustration: false }, (extra || {}).receipt || {})
  }, extra && extra.top || {});
}

const screenshot = decide(read(7));
eq(screenshot.applies, true,
  'the owner\'s 7-of-14 read with skin AND hair is still refused — the documented bar is six');
eq(screenshot.derived.length, 7, 'a passing whole-read did not hand back its apply licence');
eq(screenshot.why, '', 'a passing match still carries a refusal reason');

/* …and everything the bar is actually for still refuses. */
eq(decide(read(5)).applies, false, 'a five-control minority read now applies');
eq(decide(read(6)).applies, true, 'six identified controls including skin and hair does not apply');
const noIdentity = read(8);
noIdentity.derived = noIdentity.derived.filter(k => k !== 'skin');
eq(decide(noIdentity).applies, false, 'a read with no skin claim applies without the identity palette');
const noHair = read(8);
noHair.derived = noHair.derived.filter(k => k !== 'hair');
eq(decide(noHair).applies, false, 'a read with no hair claim applies without the identity palette');
const illustrated = read(9, { receipt: { fromIllustration: true } });
eq(decide(illustrated).applies, false, 'a stylized copy\'s manufactured colours reach the character');
const unproved = read(9, { receipt: { srcKind: 'unknown' } });
eq(decide(unproved).applies, false, 'an image never proved to be a photograph reaches the character');
const thin = read(7, { receipt: { examined: 8, refused: 1 } });
eq(decide(thin).applies, false, 'a ledger that examined fewer than ten controls applies');
ok(/No animated traits were changed/.test(decide(read(5)).why), 'a refusal no longer says zero traits changed');

/* ⛔ The claim gate itself is untouched: this change removed a threshold
   contradiction, not a guard. A wall-coloured "skin" is still refused. */
const gate = new Function(
  between(source, 'var FACE_LOOK = {', 'var FACE_MOUTHS') +
  between(source, 'function faceLab(rgb)', 'function faceReadPortrait(img)') +
  '\nreturn faceVisionClaimGate;'
)();
ok(gate('skin', '#333333') !== '', 'the posterize-artifact refusal was weakened');
ok(gate('age', 'mature') !== '', 'a face-lines guess became applicable without a click');
ok(gate('hairStyle', 'mullet') !== '', 'an unsupported hair style became applicable');
ok(gate('glasses', 'yes') !== '', 'a non-boolean glasses answer became applicable');

/* THE GATE ACCEPTED EVERY GREY, INCLUDING PURE WHITE (p1-photo-truth-1.2.0).
   h_ab is atan2 of two numbers that are floating-point dust at zero chroma, so
   a neutral sample drew a meaningless hue that happened to clear the band. The
   wall this gate exists to refuse walked straight through it. */
['#ffffff', '#fafafa', '#f2f2f2', '#808080', '#303030', '#000000'].forEach(hex => {
  ok(gate('skin', hex) !== '', hex + ' — a neutral grey is accepted as real skin');
});
/* …and no real skin tone was refused to get there. */
['#f0c8a0', '#f7e0d0', '#f5d5c8', '#3b2219', '#2b1a12'].forEach(hex => {
  eq(gate('skin', hex), '', hex + ' — a real skin tone is refused');
});

/* ---- 2. THE ENGINE AND THE METER MUST AGREE ---------------------------- */

const studioApi = new Function('receipt', 'wholeReadRefusal',
  between(studio, 'function summarizeReceipt(receipt, wholeReadRefusal, partialApplied)', 'function style()') +
  '\nreturn summarizeReceipt(receipt, wholeReadRefusal);'
);
const meter = studioApi({ claimed: 7, refused: 7, examined: 14, faceW: 112, grid: 256 }, false);
eq(meter.applied, true,
  'the meter calls the owner\'s 7-of-14 match "no animated traits changed" while the engine applies it');
ok(!/No animated traits changed/.test(meter.heading), 'the meter contradicts the engine it describes');
eq(studioApi({ claimed: 5, refused: 9, examined: 14, faceW: 108, grid: 256 }, false).applied, false,
  'the meter presents a minority read as applied');
eq(studioApi({ claimed: 7, refused: 7, examined: 14, faceW: 112, grid: 256 }, true).applied, false,
  'the meter overrides the engine\'s own whole-read refusal');

/* The meter must keep looking for longer than the engine's own deadline, and
   must say so when it stops. A spinner that gives up silently is the defect. */
ok(!/pollCount < 30/.test(studio), 'the meter still gives up after 4.5 seconds');
ok(/POLL_DEADLINE_MS = 45000/.test(studio), 'the meter deadline no longer outlasts the engine read');
ok(/The match did not finish/.test(studio), 'an expired poll still looks like a running one');
ok(/timers\.indexOf\(timer\)/.test(studio) && /clearPollTimers\(\)/.test(studio),
  'the longer poll is no longer torn down with the form');

/* ---- 3. THE MATCH HAS A DEADLINE --------------------------------------- */

/* avml-1.0.0 moved this boundary DELIBERATELY: requestVision now takes a second
   argument, the plain-words line saying whether the on-device landmark model was
   part of the read (`function requestVision(pixelRes, lmStatusLine)`). The four
   properties this slice exists to pin — one settle, a bounded wait, a late reply
   discarded, and a slow read that still reads as progress — are unchanged and
   still asserted below. The boundary is matched on the function NAME so it
   survives a further argument without silently slicing nothing. */
const visionSlice = between(source, 'function requestVision(pixelRes', 'faceTintFromPortrait(src,');
ok(/VISION_WAIT_MS = 30000/.test(source), 'the vision read has no bounded wait');
ok(/var settled = false;[\s\S]*function settle\(fn\) \{ if \(settled\) return; settled = true;/.test(visionSlice),
  'the vision read can settle twice and mutate the character behind the doctor');
ok(/if \(settled\) return;\s*\n\s*finishLocally\(' The second read did not answer in time/.test(visionSlice),
  'the deadline does not fall back to the finished on-device read');
ok(/request\.then\(function \(vr\) \{\s*\n\s*if \(settled \|\|/.test(visionSlice),
  'a reply arriving after the deadline is still applied');
ok(/taking longer than usual/.test(visionSlice), 'a slow read is indistinguishable from a frozen panel');

/* ---- 4. A REFUSAL MAY NOT TOUCH THE FACE STYLE AT ALL ------------------ */

/* ⛔ THIS SECTION IS REVERSED FROM ITS ORIGINAL FORM, BY OWNER ORDER
   (2026-08-17): "when you take a picture it goes to 'My photo' — that's not ok,
   it should stay on avatar ... If the doctor wants 'My photo' they pick it
   themselves."
   The 2026-08-13 rule kept a DELIBERATE Animated choice and still forced an
   UNTOUCHED select to 'photo'. Untouched is the ordinary case — a doctor opens
   Setup, takes a picture, the auto-match reads 5 of 14, and the product silently
   moves his patients' face to the photograph. Both halves of that distinction
   are now gone: the refusal branch writes faceModeSelect.value never, so
   `faceModeTouched` no longer gates anything here. */
const refusalSlice = between(source, 'if (!decision.applies) {', '/* The exact photo/edit revision is still current');
/* assignment, not comparison. The branch READS the select — deliberately, to
   name whichever face is really selected when it says nothing moved it. */
ok(!/faceModeSelect\.value\s*=(?!=)/.test(refusalSlice),
  'an incomplete match still writes the Face style select');
ok(!/faceValidPhoto\(shown\) && !keepAnimated/.test(refusalSlice),
  'the photo fallback branch is back');
ok(/Your Animated character stays the patient-facing face/.test(refusalSlice),
  'the doctor is not told that the animated character is still what patients see');
ok(/facePartialDecision\(combined, decision\)/.test(refusalSlice),
  'an incomplete match applies nothing again instead of applying what it read');
/* …and the capture path, which never switched, still never switches. */
const afterCapture = new Function(
  between(source, 'function faceModeOnLoad(savedMode, savedImage)', 'function makePhotoFace') +
  '\nreturn faceModeAfterCapture;')();
eq(afterCapture('drawn', false), 'drawn', 'a capture switches an untouched select to the photograph');
eq(afterCapture('drawn', true), 'drawn', 'a capture overrides a deliberate Animated choice');
eq(afterCapture('photo', true), 'photo', 'a capture undoes a deliberate My photo choice');

/* ---- 4b. THE PARTIAL APPLICATION, EXECUTED ----------------------------- */

/* The owner's own case: 5 of 14, skin among them. It must APPLY those five and
   it must not be called a match. */
const partialApi = new Function(
  between(source, 'var FACE_LOOK = {', 'var FACE_MOUTHS') +
  between(source, 'function faceLab(rgb)', 'function faceReadPortrait(img)') +
  '\nreturn { decide: faceMatchDecision, partial: facePartialDecision };'
)();
function partialOf(res) { return partialApi.partial(res, partialApi.decide(res)); }
const fiveOfFourteen = read(5);
eq(partialApi.decide(fiveOfFourteen).applies, false, 'the five-control read became a match');
eq(partialOf(fiveOfFourteen).partial, true, 'the owner\'s 5-of-14 read still applies nothing');
eq(partialOf(fiveOfFourteen).derived.length, 5, 'the partial application changed the claim count');
eq(partialOf(fiveOfFourteen).skipped.length, 9, 'the unread controls are not counted for the doctor');
/* it never extends the ledger: every applied knob was already claimed */
partialOf(fiveOfFourteen).derived.forEach(k =>
  ok(fiveOfFourteen.derived.indexOf(k) >= 0, k + ' was applied without ever having been claimed'));
/* a whole match is NOT a partial one — the two states are exclusive */
eq(partialOf(read(7)).partial, false, 'a passing whole read is also reported as partial');

/* avfit-2.0.0 deliberately narrowed the skin anchor to the evidence it can
   actually prove: COLOUR. A proven, fully examined photograph may contribute
   claimed geometry without a skin read, but every unanchored colour must be
   held and no field may be invented. */
const noSkin = read(8); noSkin.derived = noSkin.derived.filter(k => k !== 'skin');
const noSkinPartial = partialOf(noSkin);
eq(noSkinPartial.partial, true,
  'a proven photo loses its readable geometry merely because skin colour was unreadable');
eq(noSkinPartial.derived.join(','), 'hairStyle,beard,glasses,brows',
  'an unanchored colour crossed the no-skin filter, or readable geometry was dropped');
noSkinPartial.derived.forEach(k =>
  ok(noSkin.derived.indexOf(k) >= 0, k + ' was invented by the no-skin geometry path'));
['skin', 'hair', 'eyes', 'browCol', 'shirt'].forEach(k =>
  ok(noSkinPartial.derived.indexOf(k) < 0 && noSkinPartial.skipped.indexOf(k) >= 0,
    k + ' was not held when there was no skin anchor'));
ok(/Colour settings stayed unchanged/.test(noSkinPartial.why) && /skin tone could not be read/.test(noSkinPartial.why),
  'the no-skin partial does not disclose that its colour settings were held');

const colorsOnly = read(4);
colorsOnly.derived = ['hair', 'eyes', 'browCol', 'shirt'];
colorsOnly.look = { hair: '#241a11', eyes: '#4a3423', browCol: '#362820', shirt: '#2E6A4B' };
colorsOnly.receipt.claimed = 4; colorsOnly.receipt.refused = 10;
eq(partialOf(colorsOnly).partial, false,
  'unanchored colours alone qualify as a partial application');
eq(partialOf(colorsOnly).derived.length, 0,
  'an unanchored colour receives an apply licence when no geometry survives');

/* ⛔ The remaining source, completeness and minimum-count guards stay hard. */
const posterized = read(9, { receipt: { fromIllustration: true } });
eq(partialOf(posterized).partial, false, 'a stylized copy\'s manufactured colours are applied partially');
const neverProved = read(9, { receipt: { srcKind: 'unknown' } });
eq(partialOf(neverProved).partial, false, 'an image never proved to be a photograph is applied partially');
const truncated = read(5, { receipt: { examined: 8, refused: 3 } });
eq(partialOf(truncated).partial, false, 'a truncated ledger qualifies by having little to refuse');
const lonely = read(1);
eq(partialOf(lonely).partial, false,
  'a single claimed field over thirteen untouched defaults is applied — the exact 1-of-14 case truth-1.0.0 was written against');
const two = read(2);
eq(partialOf(two).partial, true, 'the documented two-claim floor is not the floor actually enforced');

/* ---- 5. THE CAMERA MUST SURVIVE A SLOW SHOT ---------------------------- */

/* THE MEASUREMENT SURFACE IS NOT SHARED, and that is a deliberate refusal.
   Sharing one canvas per purpose is the obvious cure for the live view's
   allocation churn, and it was written and then withdrawn: driven in real
   Chrome, a reused analysis surface returned skin #f4d3b3 on the first read of
   a face and #f4d2b6 on every read after it, while a fresh canvas returns one
   answer across forty. Whoever reaches for that optimisation next has to beat
   tests/1p-avatar-camera-endurance-runtime.test.js first. */
const readerSlice = between(source, 'function faceReadPortrait(img)', 'function faceTalkStop');
ok(/var c = document\.createElement\('canvas'\); c\.width = M; c\.height = M;/.test(readerSlice),
  'the portrait reader shares an analysis canvas, so its answer depends on the previous frame');
const qualitySlice = between(source, 'function frameQuality(canvas)', 'function faceCaptureVerdict');
ok(/var g = document\.createElement\('canvas'\); g\.width = G; g\.height = G;/.test(qualitySlice),
  'the quality pass shares a canvas, so exposure and sharpness depend on the previous frame');
ok(!/faceScratch/.test(source), 'a shared measurement canvas came back without beating the endurance proof');
ok(/never measured that churn causes the blackout/.test(source),
  'the withdrawn optimisation lost the record of why it was withdrawn');

/* The dark-feed witness, and the two things it is allowed to do. */
const liveSlice = between(source, 'function faceLiveLoopStart(video, overlay, ui)', '/* ---- end live capture view');
ok(/DARK_TICKS = 12, DARK_EXPOSURE = 0\.8/.test(liveSlice), 'the live loop has no witness for a dead feed');
ok(/darkRun = 0;\s*\n\s*darkReports\+\+;/.test(liveSlice),
  'the dark report fires once, so a silent re-attach cannot be told from a real blackout');
ok(/\} else \{ darkRun = 0; darkReports = 0; \}/.test(liveSlice), 'the witness never re-arms when the picture comes back');
const camSlice = between(source, "camBtn.addEventListener('click'", 'faceRow.appendChild(facePreview)');
ok(/function playVideo\(\)/.test(camSlice) && /video\.play\(\)/.test(camSlice),
  'playback is assumed rather than asked for, so a paused element shows nothing');
ok(/if \(nth === 1\) \{ safe\(function \(\) \{ video\.srcObject = stream; \}\); playVideo\(\); return; \}/.test(camSlice),
  'a recoverable dark flicker is reported instead of being repaired');
ok(/track\.addEventListener\('ended'/.test(camSlice), 'a camera taken by another app is never reported');
ok(/Restart camera/.test(camSlice), 'a dead camera offers no way back');
ok(/camHost\.__mlsCamTrouble/.test(camSlice), 'the trouble notice can stack on every dark report');

/* ---- 6. UPLOAD IS A SOURCE, NOT A SECOND IMPLEMENTATION ---------------- */

const squareFromImage = new Function('document',
  between(source, 'function squareFromImage(img, out)', '/* "MAKE SURE IT TAKES A GOOD PICTURE"') +
  '\nreturn squareFromImage;'
)({ createElement() {
  const drawn = [];
  return { width: 0, height: 0, __drawn: drawn,
    getContext() { return { imageSmoothingEnabled: false, imageSmoothingQuality: '',
      drawImage() { drawn.push(Array.prototype.slice.call(arguments, 1)); } }; } };
} });
const wide = squareFromImage({ naturalWidth: 4000, naturalHeight: 3000 }, 1024);
eq(wide.width, 1024, 'a large upload is not cropped to the measurement size');
eq(JSON.stringify(wide.__drawn[0]), JSON.stringify([500, 0, 3000, 3000, 0, 0, 1024, 1024]),
  'the upload is stretched instead of centre-cropped');
const small = squareFromImage({ naturalWidth: 300, naturalHeight: 400 }, 1024);
eq(small.width, 300, 'a small upload is upscaled, dressing a thumbnail up as a portrait');
eq(squareFromImage({ naturalWidth: 0, naturalHeight: 0 }, 1024), null, 'an undecodable image returns a canvas');

ok(/uploadInput\.accept = 'image\/png,image\/jpeg,image\/webp,image\/gif,image\/bmp'/.test(source),
  'the picker offers SVG (a script surface) or HEIC (undecodable) and refuses them after the choice');
ok(/safe\(function \(\) \{ uploadInput\.value = ''; \}\);/.test(source),
  're-choosing the same file after a refusal fires nothing');
ok(/HEIC photos from an iPhone/.test(source), 'an undecodable iPhone photo fails without saying why');
ok(!/fetch\(|XMLHttpRequest/.test(between(source, "uploadInput.addEventListener('change'", 'faceRow.appendChild(facePreview)')),
  'the uploaded file leaves the device before Save');

console.log('1p avatar face-to-photo: ' + passed + ' checks passed');
