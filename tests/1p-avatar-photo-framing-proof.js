'use strict';
/* /p1-only, PHI-free upload-framing proof. This deliberately stays outside
   the regular/main test registry so the production site and its gate remain
   byte-identical. */
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const P1_PATH = path.join(ROOT, '1p-feat_mls_avatar.js');
const MAIN_PATH = path.join(ROOT, 'feat_mls_avatar.js');
const source = fs.readFileSync(P1_PATH, 'utf8');
function between(src, first, last) {
  const a = src.indexOf(first), b = src.indexOf(last, a);
  if (a < 0 || b <= a) throw new Error('missing source boundary: ' + first);
  return src.slice(a, b);
}
function sha(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function originFile(name) {
  return cp.execFileSync('git', ['show', 'origin/main:' + name], { cwd: ROOT });
}

/* Strong boundary: the regular avatar bytes and the p1 camera hot path both
   remain exactly as they were at origin/main. This change may only affect the
   decoded-upload lane. */
assert.strictEqual(sha(fs.readFileSync(MAIN_PATH)), sha(originFile('feat_mls_avatar.js')),
  'regular/main avatar bytes changed');
const originP1 = originFile('1p-feat_mls_avatar.js').toString('utf8');
assert.strictEqual(
  sha(between(source, 'function captureSquare(video, out, into)', '/* p1-photo-upload-1.0.0')),
  sha(between(originP1, 'function captureSquare(video, out, into)', '/* p1-photo-upload-1.0.0')),
  'live camera capture path changed while fixing upload framing'
);

/* Canvas fixture: drawImage records the exact source crop. The analyzer below
   returns deterministic face geometry in that crop, which drives the real
   production candidate/cluster/reframe algorithm without pretending a skin
   segmentation fixture is identity recognition. */
const document = { createElement(tag) {
  assert.strictEqual(tag, 'canvas');
  const canvas = { width: 0, height: 0, __draw: null };
  canvas.getContext = () => ({
    imageSmoothingEnabled: false, imageSmoothingQuality: '',
    drawImage(img, sx, sy, sideW, sideH) {
      canvas.__draw = { img, sx, sy, side: Math.min(sideW, sideH) };
    }
  });
  return canvas;
} };
function faceReadPortrait(canvas) {
  const d = canvas.__draw;
  if (!d) return null;
  const faces = (d.img.faces || []).filter(face =>
    face.cx >= d.sx && face.cx <= d.sx + d.side &&
    face.cy >= d.sy && face.cy <= d.sy + d.side);
  if (!faces.length) return null;
  faces.sort((a, b) => (b.w * b.h) - (a.w * a.h));
  const f = faces[0], grid = 256;
  const cx = (f.cx - d.sx) / d.side * grid;
  const cy = (f.cy - d.sy) / d.side * grid;
  const w = f.w / d.side * grid, h = f.h / d.side * grid;
  return {
    look: { skin: '#b97858', hair: '#2b211b' }, derived: ['skin', 'hair'],
    receipt: { faceW: w, grid, claimed: 8 },
    box: { grid, cx, w, L: cx - w / 2, R: cx + w / 2,
      T: cy - h / 2, B: cy + h / 2 }
  };
}
function frameQuality() { return { exposure: 132, sharp: 5 }; }
function faceCaptureVerdict(res) {
  if (!res || !res.box) return { ready: false, why: 'No face found.', score: 0 };
  return { ready: true, why: '', score: 100000 + Math.round(res.box.w * 20) };
}
function safe(fn, fallback) { try { return fn(); } catch (_) { return fallback; } }
const api = new Function('document', 'frameQuality', 'faceReadPortrait', 'faceCaptureVerdict', 'safe',
  between(source, 'function squareFromImageAt(img, out, sx, sy, side)',
    '/* "MAKE SURE IT TAKES A GOOD PICTURE"') +
  '\nreturn { centre:squareFromImage, aware:faceAwareSquareFromImage };'
)(document, frameQuality, faceReadPortrait, faceCaptureVerdict, safe);

function image(w, h, faces) { return { naturalWidth: w, naturalHeight: h, faces: faces || [] }; }
function face(cx, cy, w, h) { return { cx, cy, w, h }; }
function chosen(img) { return api.aware(img, 1024); }

/* Left/right physician portraits survive the old 16:9 centre-crop failure. */
let r = chosen(image(1600, 900, [face(260, 400, 300, 460)]));
assert.strictEqual(r.why, '');
assert.strictEqual(r.meta.faces, 1);
assert.ok(r.meta.cropX <= 10, 'left physician was not kept in frame');
r = chosen(image(1600, 900, [face(1340, 400, 300, 460)]));
assert.strictEqual(r.why, '');
assert.ok(r.meta.cropX >= 690, 'right physician was not kept in frame');

/* Tall uploads get the same bounded top/bottom treatment. */
r = chosen(image(900, 1600, [face(450, 260, 300, 420)]));
assert.strictEqual(r.why, '');
assert.ok(r.meta.cropY <= 10, 'top physician was not kept in frame');
r = chosen(image(900, 1600, [face(450, 1340, 300, 420)]));
assert.strictEqual(r.why, '');
assert.ok(r.meta.cropY >= 690, 'bottom physician was not kept in frame');

/* A normal centered portrait remains the exact old center geometry. */
const centered = image(1600, 900, [face(800, 400, 300, 460)]);
r = chosen(centered);
assert.strictEqual(r.why, '');
assert.strictEqual(r.meta.cropX, 350, 'centered portrait moved away from the compatibility crop');
const old = api.centre(centered, 1024);
assert.strictEqual(old.__draw.sx, 350, 'compatibility center crop changed');

/* Never guess between people. A clearly tiny screen/background face is
   ignored; a second credible face turns the whole upload into a refusal. */
r = chosen(image(1600, 900, [face(250, 420, 310, 450), face(1380, 330, 70, 100)]));
assert.strictEqual(r.why, '');
assert.strictEqual(r.meta.faces, 1, 'tiny background face displaced the dominant portrait');
r = chosen(image(1600, 900, [face(250, 420, 310, 450), face(1320, 420, 250, 380)]));
assert.ok(/more than one possible face/.test(r.why), 'two credible faces were silently disambiguated');
assert.strictEqual(r.square, null, 'ambiguous upload retained a publishable portrait');

/* Walls, tiny faces and source-edge clipping fail without manufacturing a
   portrait. The no-face case keeps the shared verdict so acceptPortrait can
   speak its existing exposure/face guidance. */
r = chosen(image(1600, 900, []));
assert.strictEqual(r.why, '');
assert.ok(r.q && r.q.faceVerdict && !r.q.faceVerdict.ready, 'no-face fallback bypassed the shared refusal');
r = chosen(image(1600, 900, [face(1200, 400, 70, 100)]));
assert.ok(/too small/.test(r.why), 'tiny screen face was promoted into a portrait');
r = chosen(image(1600, 900, [face(25, 400, 160, 360)]));
assert.ok(/cut off at the edge/.test(r.why), 'source-edge half-face was accepted');

assert.ok(source.includes('var picked = faceAwareSquareFromImage(img, MEASURE_MAX)'),
  'upload UI does not use the face-aware result');
assert.ok(/more than one possible face/.test(source) && /face-aware crop at/.test(source),
  'calm ambiguity refusal or honest crop provenance is missing');
/* The boundary is the function NAME, not its signature: this slice broke on
   p1-photo-fallback-1.0.0 when the helper gained an opt-in fallback argument,
   which is not a change this proof has any opinion about. */
const photoMotion = between(source, 'function makePhotoFace(', '/* =========================================================================');
assert.ok(photoMotion.includes('pulse * 0.007') && photoMotion.includes('190 + Math.random() * 80'),
  'exact-photo voice motion is no longer deliberately subtle');
assert.ok(!photoMotion.includes('pulse * 0.018') && !photoMotion.includes("rotate(-.7deg)"),
  'the old game-token pulse or exaggerated photo tilt returned');
console.log('PASS p1 avatar photo framing: off-centre, centred, ambiguous, tiny, clipped, no-face, camera and main boundaries');
