'use strict';

/* Synthetic, PHI-free regression for the owner-reported Avatar failure:
   a clear portrait found a 44/256 skin-mask width and only one of fourteen
   optional traits, then the UI displayed a default dark character as though
   it were the person. The portrait and matcher are separate contracts now:
   keep the real photo; apply zero traits from an incomplete read. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const corePath = path.join(root, '1p-feat_mls_avatar.js');
const studioPath = path.join(root, '1p-feat_mls_avatar_face.js');
const source = fs.readFileSync(corePath, 'utf8');
const studio = fs.readFileSync(studioPath, 'utf8');
let passed = 0;
function ok(value, message) { assert.ok(value, message); passed++; }
function eq(actual, expected, message) { assert.strictEqual(actual, expected, message); passed++; }
function between(src, first, last) {
  const a = src.indexOf(first), b = src.indexOf(last, a);
  if (a < 0 || b <= a) throw new Error('Missing source boundary: ' + first);
  return src.slice(a, b);
}

const lookApi = new Function(
  between(source, 'var FACE_LOOK = {', 'var FACE_MOUTHS') +
  between(source, 'function faceLab(rgb)', 'function faceReadPortrait(img)') +
  '\nreturn { FACE_LOOK:FACE_LOOK, safe:faceLookSafe, apply:faceApplyDerived, decide:faceMatchDecision, combine:faceCombineEvidence, dayOne:faceKioskDayOneLook };'
)();

const screenshotRead = {
  look: { hairStyle: 'long' },
  derived: ['hairStyle'],
  refused: Array.from({ length: 13 }, (_, i) => ({ knob: 'refused-' + i })),
  receipt: { claimed: 1, refused: 13, examined: 14, faceW: 44, grid: 256,
    srcKind: 'photo', fromIllustration: false }
};
const decision = lookApi.decide(screenshotRead);
eq(decision.applies, false, 'the screenshot-class 1-of-14 read is treated as an applied likeness');
eq(decision.derived.length, 0, 'an incomplete read retained an apply licence');
eq(decision.observed.length, 1, 'diagnostic evidence was erased instead of separated from application');
ok(/No animated traits were changed/.test(decision.why), 'the refusal does not say that zero traits changed');
eq(JSON.stringify(lookApi.dayOne(screenshotRead)), JSON.stringify(lookApi.safe(lookApi.FACE_LOOK)),
  'a partial day-one read changes the patient character');

const strongRead = {
  look: { skin: '#f0c8a0', hair: '#241a11', hairStyle: 'short', glasses: true,
    brows: 'normal', eyes: '#4a3423', eyeSet: 'normal', beard: 'none' },
  derived: ['skin', 'hair', 'hairStyle', 'glasses', 'brows', 'eyes', 'eyeSet', 'beard'],
  receipt: { claimed: 8, refused: 6, examined: 14, faceW: 112, grid: 256,
    srcKind: 'photo', fromIllustration: false }
};
eq(lookApi.decide(strongRead).applies, true, 'a majority, identity-palette photo read cannot apply');
eq(lookApi.dayOne(strongRead).skin, '#f0c8a0', 'a verified skin claim did not reach the character');
eq(lookApi.dayOne(strongRead).hair, '#241a11', 'a verified hair claim did not reach the character');

/* The screenshot-class local read is allowed to ask for a second opinion, but
   neither source may paint the character until their ONE combined receipt
   proves a coherent likeness. */
const strongModelLook = { skin: '#f0c8a0', hair: '#241a11', hairStyle: 'short',
  glasses: true, brows: 'normal', eyes: '#4a3423', eyeSet: 'normal', beard: 'none' };
const strongModelClaims = Object.keys(strongModelLook);
const rescued = lookApi.combine(screenshotRead, strongModelLook, strongModelClaims, true);
eq(rescued.receipt.claimed, 8, 'strong model evidence did not rescue a weak pixel read');
eq(rescued.receipt.refused, 6, 'the rescued combined receipt has the wrong denominator');
eq(lookApi.decide(rescued).applies, true, 'weak pixels plus a coherent strong second read cannot apply');
eq(rescued.look.skin, '#f0c8a0', 'the rescue lost the fair natural skin evidence');
eq(rescued.look.hair, '#241a11', 'the rescue lost the dark natural hair evidence');
eq(screenshotRead.derived.length, 1, 'combining evidence mutated the local diagnostic result');

const weakBoth = lookApi.combine(screenshotRead,
  { glasses: true, brows: 'normal' }, ['glasses', 'brows'], true);
eq(weakBoth.receipt.claimed, 3, 'weak evidence was counted incorrectly');
eq(lookApi.decide(weakBoth).applies, false, 'two weak reads were allowed to masquerade as a likeness');
eq(lookApi.decide(weakBoth).derived.length, 0, 'a weak combined read retained an apply licence');
eq(JSON.stringify(lookApi.dayOne(weakBoth)), JSON.stringify(lookApi.safe(lookApi.FACE_LOOK)),
  'weak combined evidence changed the day-one character');

const malformedModel = lookApi.combine(screenshotRead,
  { skin: '#333333', hair: '#241a11', hairStyle: 'anything', glasses: 'yes' },
  ['skin', 'hair', 'hairStyle', 'glasses'], true);
eq(malformedModel.visionClaimed.length, 1, 'unsafe or malformed model claims crossed the client gate');
ok(malformedModel.visionRefused.length === 3, 'unsafe model refusals were not counted');

const verdict = new Function(
  between(source, 'function faceCaptureVerdict', '/* BEST OF SEVERAL FRAMES') +
  '\nreturn faceCaptureVerdict;'
)();
const located = { look: { hairStyle: 'long' }, derived: ['hairStyle'],
  receipt: screenshotRead.receipt,
  box: { grid: 256, L: 92, R: 163, T: 31, B: 218 } };
const portraitVerdict = verdict(located, { exposure: 132, sharp: 4.8 });
eq(portraitVerdict.ready, true, '44/256 skin-mask width wrongly rejects a clear located portrait');
eq(portraitVerdict.matchLimited, true, 'the weak trait read is not disclosed as limited');
ok(/leave the character unchanged/.test(portraitVerdict.matchWhy), 'limited match guidance overclaims the character');
const backgroundVerdict = verdict(null, { exposure: 132, sharp: 20 });
eq(backgroundVerdict.ready, false, 'a sharp background with no face geometry is accepted as a portrait');
const unprovedLook = verdict({ look: { skin: '#f0c8a0' }, derived: ['skin'], receipt: strongRead.receipt },
  { exposure: 132, sharp: 20 });
eq(unprovedLook.ready, false, 'a look without the reader geometry is accepted as a portrait');

/* Execute the saved-portrait encoder with sentinel pixels. The preferred PNG
   must receive exactly the copied bytes; no channel quantization, filtering or
   posterization may run between the capture and the patient portrait. */
const sentPixels = new Uint8ClampedArray([247, 211, 184, 255, 35, 22, 17, 255]);
let encodedPixels = null, encodes = [];
const fakeDocument = { createElement(tag) {
  assert.strictEqual(tag, 'canvas');
  return {
    width: 0, height: 0,
    getContext() { return { drawImage(src) { encodedPixels = src.__rgba.slice(); } }; },
    toDataURL(type, quality) { encodes.push([type, quality]); return 'data:' + type + ';base64,NATURAL'; }
  };
} };
const safe = (fn, fallback) => { try { return fn(); } catch (_) { return fallback; } };
const valid = value => /^data:image\//.test(String(value || ''));
const stylize = new Function('document', 'safe', 'faceValidPhoto',
  between(source, 'function stylizeCanvas', 'function stylizePortrait') + '\nreturn stylizeCanvas;'
)(fakeDocument, safe, valid);
const natural = stylize({ __rgba: sentPixels });
eq(natural, 'data:image/png;base64,NATURAL', 'a fitting natural portrait is needlessly JPEG-compressed');
eq(JSON.stringify(Array.from(encodedPixels)), JSON.stringify(Array.from(sentPixels)),
  'the portrait encoder changed natural colour bytes before encoding');
eq(encodes.length, 1, 'a fitting lossless portrait was encoded repeatedly');
eq(encodes[0][0], 'image/png', 'lossless encoding is not preferred');

ok(!/getImageData|putImageData|poster|quantiz|levels\s*=/.test(
  between(source, 'function stylizeCanvas', 'function stylizePortrait').replace(/\/\*[\s\S]*?\*\//g, '')),
  'the patient portrait path contains pixel manipulation');
ok(/pendingFace = dataUrl;[\s\S]*faceModeSelect\.value = faceModeAfterCapture[\s\S]*renderPatientPreview\(\)/.test(source),
  'a successful capture does not switch its patient preview to the real photo');
/* avfit-1.0.0 (owner, 2026-08-17) — THIS PIN IS REVERSED, DELIBERATELY.
   It used to require that an incomplete match set the Face style select to
   'photo'. The owner countermanded exactly that: "when you take a picture it
   goes to 'My photo' — that's not ok, it should stay on avatar." The refusal
   branch must therefore never write faceModeSelect.value at all, and it must
   route through facePartialDecision instead of applying nothing. What the old
   pin protected — an incomplete read must not commit the whole combined look —
   is asserted by the executable decision checks above and by the two pins
   below. */
const refusalBranch = between(source, 'if (!decision.applies) {', '/* The exact photo/edit revision is still current');
ok(/facePartialDecision\(combined, decision\)/.test(refusalBranch),
  'an incomplete match no longer runs the partial-application decision');
ok(!/faceModeSelect\.value\s*=/.test(refusalBranch),
  'an incomplete match still changes the Face style the doctor chose');
ok(!/lookNow = faceApplyDerived\(lookNow, combined\)/.test(refusalBranch),
  'an incomplete match commits the WHOLE combined look instead of only the claimed subset');
ok(/lookNow = faceApplyDerived\(lookNow, \{ derived: applied,/.test(refusalBranch),
  'the partial branch does not restrict itself to the subset it just licensed');
ok(/faceCombineEvidence\(pixelRes, vr\.json\.look \|\| \{\}, vr\.json\.claimed \|\| \[\], trustedNaturalPhoto\)/.test(source),
  'pixel and model evidence are not merged before the apply decision');
ok(/faceMutated\(\);[\s\S]*lookNow = faceApplyDerived\(lookNow, combined\)/.test(source),
  'the combined likeness is not committed as one revision-fenced transaction');
ok(/if \(!faceMatchDecision\(res\)\.applies\) return faceLookSafe\(FACE_LOOK\)/.test(source),
  'the day-one kiosk can apply partial derived traits');

/* The presentation layer must not call a refusal a good starting match. */
ok(studio.includes('No animated traits changed'), 'the face meter still labels a refusal as a match');
ok(studio.includes('the match was incomplete, so all character settings stayed unchanged'),
  'the face meter hides zero-application truth');
ok(studio.includes('Evidence coverage'), 'the meter still presents partial coverage as likeness confidence');
/* avfit-1.0.0 — and a PARTIAL application is still not a match. `applied` is
   the whole-match flag and stays false; only `partial` moves. */
const summarize = new Function('receipt', 'wholeReadRefusal', 'partialApplied',
  between(studio, 'function summarizeReceipt(receipt, wholeReadRefusal, partialApplied)', 'function style()') +
  '\nreturn summarizeReceipt(receipt, wholeReadRefusal, partialApplied);');
const partialMeter = summarize({ claimed: 5, refused: 9, examined: 14, faceW: 108, grid: 256 }, true, 5);
eq(partialMeter.applied, false, 'a partial application is reported as a whole match');
eq(partialMeter.partial, true, 'a partial application is not reported at all');
ok(!/match/i.test(partialMeter.heading.replace(/not a match/i, '')) || /Partial read applied/.test(partialMeter.heading),
  'the partial heading calls itself a match');
ok(/Applied 5 of 14/.test(partialMeter.detail) && /could not be read/.test(partialMeter.detail),
  'the partial detail hides what was applied or what was not');
const zeroPartial = summarize({ claimed: 5, refused: 9, examined: 14, faceW: 108, grid: 256 }, true, 0);
eq(zeroPartial.partial, false, 'a read that applied nothing is dressed as a partial application');
ok(/all character settings stayed unchanged/.test(zeroPartial.detail),
  'a read that applied nothing lost its honest wording');

console.log('PASS 1p avatar photo truth: ' + passed + ' assertions');
