'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const file = path.join(root, '1p-feat_mls_avatar.js');
const source = fs.readFileSync(file, 'utf8');
let passed = 0;
function ok(value, message) { assert.ok(value, message); passed++; }
function eq(actual, expected, message) { assert.strictEqual(actual, expected, message); passed++; }

function between(src, first, last) {
  const a = src.indexOf(first);
  const b = src.indexOf(last, a);
  if (a < 0 || b <= a) throw new Error('Missing source boundary: ' + first);
  return src.slice(a, b);
}

function portraitReader(src) {
  const code = between(src, 'var FACE_LOOK = {', 'function faceShade') + '\n' +
    between(src, 'function faceShade', 'var FACE_MOUTHS') + '\n' +
    between(src, 'function faceIsSkinRgb', 'function faceReadPortrait') + '\n' +
    between(src, 'function faceReadPortrait', 'function faceTalkStop') + '\n' +
    'return faceReadPortrait;';
  const document = { createElement() { return { width: 0, height: 0, getContext() {
    return { drawImage(img) { this.data = img.__rgba.slice(); }, getImageData() { return { data: this.data }; } };
  } }; } };
  return new Function('document', code)(document);
}
function withoutAdaptiveRecovery(src) {
  const start = src.indexOf('    /* p1-likeness-1.0.0');
  const end = src.indexOf('    /* NO FALLBACK TO THE UNREFINED HEAD.', start);
  if (start < 0 || end <= start) throw new Error('adaptive recovery boundary missing');
  return src.slice(0, start) + '    var adaptiveSegmentation = false;\n' + src.slice(end);
}

const M = 128;
function rgb(hex) { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function put(img, x, y, col) {
  if (x < 0 || y < 0 || x >= M || y >= M) return;
  const i = (y * M + x) * 4;
  img.__rgba[i] = col[0]; img.__rgba[i + 1] = col[1]; img.__rgba[i + 2] = col[2]; img.__rgba[i + 3] = 255;
}
function rect(img, x0, y0, x1, y1, col) { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) put(img, x, y, col); }
function ellipse(img, cx, cy, rx, ry, col) {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const dx = (x - cx) / rx, dy = (y - cy) / ry;
      if (dx * dx + dy * dy <= 1) put(img, x, y, col);
    }
  }
}
function fixture(o) {
  const img = { naturalWidth: M, naturalHeight: M, __rgba: new Uint8ClampedArray(M * M * 4) };
  const skin = rgb(o.skin), hair = rgb(o.hair), ink = rgb('#251a16');
  rect(img, 0, 0, M - 1, M - 1, rgb(o.bg));
  rect(img, 0, 110, 127, 127, rgb(o.shirt || '#3d7665'));
  ellipse(img, 64, 42, 29, 29, hair);
  ellipse(img, 64, 66, 24, 32, skin);
  rect(img, 42, 39, 86, 52, hair);
  rect(img, 55, 95, 73, 112, skin);
  rect(img, 48, 61, 58, 63, ink); rect(img, 70, 61, 80, 63, ink);
  ellipse(img, 53, 68, 3, 2, ink); ellipse(img, 75, 68, 3, 2, ink);
  rect(img, 58, 85, 70, 87, rgb('#75443b'));
  if (o.glasses) {
    const rim = rgb('#20242a');
    rect(img, 43, 61, 84, 63, rim); rect(img, 43, 57, 59, 72, rim); rect(img, 69, 57, 85, 72, rim);
    rect(img, 45, 59, 57, 70, skin); rect(img, 71, 59, 83, 70, skin);
  }
  return img;
}

const read = portraitReader(source);
const hard = fixture({ skin: '#f0c8a0', hair: '#18120f', bg: '#c9b7a2', glasses: true });
const got = read(hard);
ok(got && got.look, 'dark hair + glasses + warm background still produces a whole-read refusal');
eq(got.receipt.adaptiveSegmentation, true, 'difficult-boundary recovery is not disclosed in its receipt');
eq(got.look.skin.toLowerCase(), '#f0c8a0', 'recovered skin came from hair or the warm wall');
eq(got.look.hair.toLowerCase(), '#18120f', 'dark hair was not preserved');
eq(got.look.hairStyle, 'short', 'short dark hair became the old long-hair fallback');
eq(got.look.glasses, true, 'spectacle bridge was lost during recovery');
ok(got.derived.includes('skin') && got.derived.includes('hair') && got.derived.includes('glasses'), 'recovered evidence is not licensed as derived');
eq(got.receipt.claimed + got.receipt.refused, got.receipt.examined, 'claim receipt does not reconcile');
ok(got.found.some(v => /difficult hair, glasses, or warm-background boundary/.test(v)), 'recovery is hidden from the user');

/* The same reader with only the new recovery block removed is executable
   evidence that this fixture represents the reported defect, not a test
   invented around unrelated behavior or repository history. */
const oldRead = portraitReader(withoutAdaptiveRecovery(source));
const oldGot = oldRead(hard);
ok(oldGot && !oldGot.look, 'control build unexpectedly accepts the reproduced failure fixture');
ok(/could not separate your skin from your hair/.test(oldGot.found[0]), 'control fixture does not reproduce the owner-visible failure');

/* Mutation-sensitive sweep: 300 combinations of six skin tones, five dark
   hair tones, five neutral/warm backgrounds, with and without glasses. The
   retry must recover the known hard class without losing any frame the old
   reader could already use. */
const skinSweep = ['#f0c8a0', '#d2a080', '#b7795a', '#8b5b43', '#6b4436', '#4b3027'];
const hairSweep = ['#18120f', '#2b211b', '#3a2a1b', '#4b3027', '#5b3c2c'];
const bgSweep = ['#f4f1ec', '#c9b7a2', '#97745e', '#5d4a42', '#3d3532'];
let oldAccepted = 0, newAccepted = 0, recovered = 0, lost = 0;
for (const skin of skinSweep) for (const hair of hairSweep) for (const bg of bgSweep) for (const glasses of [false, true]) {
  const frame = fixture({ skin, hair, bg, glasses });
  const before = oldRead(frame), after = read(frame);
  if (before && before.look) oldAccepted++;
  if (after && after.look) {
    newAccepted++;
    eq(after.receipt.claimed + after.receipt.refused, after.receipt.examined, 'sweep receipt does not reconcile');
  } else {
    eq((after && after.derived || []).length, 0, 'refused sweep portrait leaked derived values');
  }
  if ((!before || !before.look) && after && after.look) recovered++;
  if (before && before.look && (!after || !after.look)) lost++;
}
eq(lost, 0, 'adaptive recovery regressed a portrait accepted by the control reader');
ok(recovered >= 18, 'varied portrait sweep no longer recovers the dark-hair/glasses class');
ok(newAccepted >= oldAccepted + 18, 'varied portrait acceptance did not improve over the control reader');

const clean = read(fixture({ skin: '#b7795a', hair: '#18120f', bg: '#e7edf0', glasses: false }));
ok(clean && clean.look, 'ordinary cool-background portrait regressed');
eq(clean.receipt.adaptiveSegmentation, false, 'adaptive retry changed an already-working portrait');
eq(clean.look.skin.toLowerCase(), '#b7795a', 'ordinary medium skin changed');

const ambiguous = read(fixture({ skin: '#f0c8a0', hair: '#18120f', bg: '#f0c8a0', glasses: false }));
ok(ambiguous && !ambiguous.look, 'indistinguishable skin/background is guessed instead of refused');
ok(/cannot tell your face from the room/.test(ambiguous.found[0]), 'ambiguous refusal has no effective retake explanation');

const verdictSource = between(source, 'function faceCaptureVerdict', '/* BEST OF SEVERAL FRAMES');
const verdict = new Function(verdictSource + '\nreturn faceCaptureVerdict;')();
const ready = verdict({ look: { skin: '#f0c8a0' }, derived: ['skin'],
  receipt: { faceW: 112, grid: 256, claimed: 8 }, box: { grid: 256, L: 72, R: 183, T: 28, B: 225 } },
  { exposure: 130, sharp: 4 });
eq(ready.ready, true, 'usable face cannot pass the capture gate');
const wall = verdict(null, { exposure: 130, sharp: 20 });
eq(wall.ready, false, 'sharp wall can pass the capture gate');
ok(ready.score > wall.score, 'best-of-six still prefers a sharp wall over a readable face');
ok(source.includes('q.faceVerdict.score > bestQ.faceVerdict.score'), 'best-of-six does not use face evidence');
/* The refusal wording moved into the shared accept path (p1-photo-upload-1.0.0)
   and each source supplies its own prefix; the rule is unchanged — a picture
   that fails the readiness verdict is refused WITH ITS REASON and nothing is
   saved, and that now has to hold for the file picker too. */
ok(source.includes('opts.refusePrefix + verdict.why') &&
  source.includes('Nothing was saved, so your current photo is untouched'), 'failed capture overwrites the current portrait or lacks guidance');
ok(source.includes("refusePrefix: 'Not captured. '"), 'the camera lost its refusal wording');
ok(source.includes("refusePrefix: 'Not used. '"), 'an uploaded picture is accepted without the readiness verdict speaking');

const helpers = new Function(between(source, 'function faceValidPhoto', 'function makePhotoFace') +
  '\nreturn {valid:faceValidPhoto,onLoad:faceModeOnLoad,after:faceModeAfterCapture};')();
const photo = 'data:image/jpeg;base64,AAAA';
/* p1-avatar-primary-1.0.0 (owner, 2026-08-16): "WHY DOES IT AUTO SWITCH TO
   FACE STYLE MY PHOTO ONCE I TAKE A PICTURE ... ONLY HAVE IT IN SETTINGS
   AVATAR IS THE PRIMARY". The animated character is the patient-facing face.
   A portrait is an INPUT to it, never a silent replacement for it, so neither
   saving a portrait nor merely owning one may change what patients see. The
   photograph appears only when the doctor picks it in Settings — and that
   explicit choice must still survive both a reload and a new capture. */
eq(helpers.onLoad(undefined, photo), 'drawn', 'merely owning a portrait silently switched the patient-facing face to the photo');
eq(helpers.onLoad('photo', photo), 'photo', 'an explicit Settings choice of the photo was lost on reload');
eq(helpers.onLoad('drawn', photo), 'drawn', 'a deliberate saved Animated choice was overwritten on reload');
eq(helpers.after('drawn', false), 'drawn', 'taking a picture silently switched the patient-facing face to the photo');
eq(helpers.after('photo', false), 'photo', 'taking a picture threw away an explicit photo choice');
eq(helpers.after('drawn', true), 'drawn', 'a deliberate in-session Animated choice was ignored');

let nextTimer = 0;
const clearedTimers = [];
const fakeDocument = { createElement(tag) { return { tagName: tag, style: {}, src: '', alt: '' }; } };
const fakeWindow = { matchMedia() { return { matches: false }; } };
const safe = (fn, fallback) => { try { return fn(); } catch (_) { return fallback; } };
const photoFactory = new Function('document', 'window', 'setTimeout', 'clearTimeout', 'safe',
  between(source, 'function faceValidPhoto', '/* =========================================================================') + '\nreturn makePhotoFace;')(
    fakeDocument, fakeWindow, () => ++nextTimer, id => clearedTimers.push(id), safe);
const mount = { innerHTML: 'old', child: null, attributes: {},
  appendChild(node) { this.child = node; }, setAttribute(k, v) { this.attributes[k] = v; } };
const photoCtl = photoFactory(mount, photo, 'patient portrait');
ok(photoCtl && mount.child && mount.child.src === photo, 'photo controller does not mount the exact capture');
ok(['mood', 'talk', 'talkCycle', 'destroy'].every(k => typeof photoCtl[k] === 'function'), 'photo controller cannot join the face lifecycle');
photoCtl.mood('listening');
eq(mount.attributes['data-photo-mood'], 'listening', 'photo controller drops listening state');
photoCtl.talk(0.8);
ok(/scale\(1\.0/.test(mount.child.style.transform), 'photo controller does not respond subtly to voice amplitude');
photoCtl.talkCycle(true);
ok(nextTimer > 0, 'browser-speech cycle is not connected to photo mode');
photoCtl.destroy();
ok(clearedTimers.length > 0 && mount.child.style.transition === 'none', 'photo controller leaves motion timers alive after teardown');

const captureSlice = source.slice(source.indexOf('pendingFace = dataUrl;'), source.indexOf('status.textContent = \'Portrait captured', source.indexOf('pendingFace = dataUrl;')));
ok(/pendingFace = dataUrl;[\s\S]*faceModeSelect\.value = faceModeAfterCapture[\s\S]*renderPatientPreview\(\)/.test(captureSlice), 'capture does not immediately switch and repaint the patient preview');
/* ⛔ THESE TWO PIN THE CLAIM, NOT THE ARGUMENT COUNT. They were written as
   exact-string includes and both broke on p1-photo-fallback-1.0.0 — a change
   that STRENGTHENED what they guard, by giving each call site a decode-failure
   fallback. That is the recorded failure mode of a literal pin, so the trailing
   `[,)]` deliberately admits further arguments while still requiring that both
   surfaces mount the SAME controller with the SAME portrait. */
ok(/lookCtl = makePhotoFace\(lookStage, portrait, 'Your patient-facing portrait'\s*[,)]/.test(source),
  'Setup photo mode does not show the exact selected portrait');
ok(/kiosk\.face = makePhotoFace\(mount, av\.faceImage, ''\s*[,)]/.test(source),
  'kiosk does not use the same photo controller as Setup');
ok(source.includes('My photo — closest likeness, moves gently while speaking'), 'photo mode is not presented as the closest likeness');
ok(source.includes('Animated character — expressions, matched from your photo'), 'Animated alternative is missing');

const stylizeBlock = between(source, 'function stylizeCanvas', 'function stylizePortrait');
ok(!/getImageData|putImageData|levels\s*=|step2/.test(stylizeBlock), 'patient portrait is still recoloured/posterized');
ok(/toDataURL\('image\/png'\)/.test(stylizeBlock) && /\[0\.98, 0\.96, 0\.94, 0\.92\]/.test(stylizeBlock),
  'natural portrait does not prefer lossless pixels with a high-quality bounded fallback');
/* avlook-1.0.0 (2026-08-17): the lens was pinned at 31x25 when the eye aperture was
   24x13 - a near-round frame around a near-round eye. The aperture is now 24x9 and the
   brows sit 5 units lower, so a 25-tall lens runs into the brow at the top and hangs
   into the cheek at the bottom. 31x17 is both the modern adult frame and the one that
   fits this eye; the pin moves with the drawing, and the intent it guards (a lens that
   is not oversized) is unchanged. Proven by measurement in
   tests/1p-avatar-adult-proportions-proof.js, which renders the glasses look. */
ok(source.includes('class="fHairTexture"') && source.includes('width="31" height="17"'), 'optional animated face still has flat helmet hair or oversized glasses');

console.log('PASS 1p avatar face likeness: ' + passed + ' assertions');
