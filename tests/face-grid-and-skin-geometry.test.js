'use strict';
/*
 * THE GRID FOLLOWS THE SOURCE, AND THE BOX NEVER LIES ABOUT WHERE IT SAMPLED
 * (gx-1.0, 2026-08-12)
 * =============================================================================
 * Owner's standing complaint: Match refused his skin (#836668, "hue 16") and
 * told him to buy a better camera. The adjudication (this train's scratchpad
 * harness, run against the SHIPPED origin/main bytes) settled the mechanism:
 *
 *   MEASURED (a): a taupe/greige wall inside the YCbCr skin window merges with
 *   the head into ONE component that pickFace accepts (63% of frame), the
 *   widest row runs wall-to-wall, and all five skin patches sample the wall
 *   through the mask+component test LEGITIMATELY - 25/25 wall pixels per
 *   patch, the wall hex returned verbatim. The greige control (#837568,
 *   hue 71, C* 9.7) was even CLAIMED as skin, with 'nose' and 'lips' verdicts
 *   measured off the wall.
 *   MEASURED (b, placement half): when the lopsided clamp fires, faceW and
 *   cxMid are replaced but faceRun.L was not, and atX() mixed the un-clamped
 *   edge with the clamped width - atX(0.20) landed at x=36 on a face whose own
 *   0.20 line is x=53. And the two eye-line patches sat on the outer canthus /
 *   temple, where rims and socket shadow live: three of five patches poisoned
 *   flips the across-patch median to a muddy rose around hue 30-34 (the p1
 *   #9d6c64 signature).
 *   MEASURED (chroma): the C*<32 bound was calibrated on matte MST chips
 *   (max 27.9) and refuses photographed skin (#af6228 C* 52.1, #c68642 49.0,
 *   #8d5524 41.8, #e0ac69 43.0) - while the message quoted only the HUE,
 *   which had passed.
 *
 * WHAT THIS SUITE PINS (each with a pre-fix control where the stub can honestly
 * run the old bytes):
 *   G1  wall-to-wall outline -> WHOLE-READ refusal naming the merge (old code
 *       claimed the wall hex + nose/lips off the wall).
 *   G2  photographed skin (#e0ac69, C* 43) is CLAIMED (old code refused it
 *       while quoting "hue 75, needs 45+" - a term that had passed).
 *   G3  a refused sample's message names the term that actually failed.
 *   G4  rims/shadow at the canthus + forehead no longer poison the reported
 *       swatch (patches moved off the eye line; old code returned muddy rose).
 *   G5  after the lopsided clamp, every skin patch sits inside the face's own
 *       clamped span (old spots computed from the old box land OUTSIDE it).
 *   G6  THE SAMPLED-FACE-SIZE GATE: a 256-capable source reads on a 256 grid
 *       and the sampled face is ~2x its 128 reading; a 128 source stays 128
 *       (never upscaled). No such gate existed before this train.
 *   G7  no-regression identity: the clean 128 fixture reads byte-identically
 *       to the pre-fix code (same derived set, same claimed skin).
 *   G8  the resolution win is real: claims at 256 are a superset of 128.
 *   G9  the nose saturation refusal names light, not the camera; the old
 *       "runs past what this photo can measure" string is GONE from the module.
 *   G10 the eyes claim announces itself (old code pushed to `derived` but not
 *       `found` - told 4, credited 5).
 *   G11 the box carries grid/skinSpots/patchR so the live view can draw the
 *       EXACT windows the read used.
 *
 * The 256 branch cannot be driven through the OLD bytes under this stub (the
 * stub copies pixels 1:1, and old code always sizes its canvas at 128, so a
 * 256 fixture would be read as garbage rows - a stub artifact, not the old
 * behaviour). The old-code control for G6 is therefore lexical: the pre-fix
 * reader hard-pins `var M = 128;`, asserted below.
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

/* ── pre-fix baseline: b1018, the commit this train branched from ── */
const BASE_COMMIT = 'c0ce69e46f60fd01262a260ddf60502851a7c139';
let BASE = null;
try {
  BASE = execFileSync('git', ['show', BASE_COMMIT + ':feat_mls_avatar.js'],
    { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
} catch (e) { /* asserted below */ }
ok(!!BASE && BASE.length > 100000,
  'the pre-fix baseline (' + BASE_COMMIT.slice(0, 8) + ':feat_mls_avatar.js) could not be read from local ' +
  'git objects - every control below would be vacuous.');

function extract(src, tag) {
  function sliceBetween(a, b, label) {
    const i = src.indexOf(a);
    ok(i >= 0, tag + ': start anchor "' + label + '" not found');
    const j = src.indexOf(b, i);
    ok(j > i, tag + ': end anchor for "' + label + '" not found');
    return src.slice(i, j);
  }
  const tables = sliceBetween('var FACE_LOOK = {', 'function faceShade', 'tables');
  const helpers = sliceBetween('function faceShade', 'var FACE_MOUTHS', 'helpers');
  const lab = sliceBetween('function faceIsSkinRgb', 'function faceReadPortrait', 'lab');
  const reader = sliceBetween('function faceReadPortrait', 'function faceTalkStop', 'reader');
  const doc = {
    createElement: function () {
      return { width: 0, height: 0, getContext: function () {
        const ctx = {
          drawImage: function (img) { ctx._d = img.__rgba.slice(); },
          getImageData: function () { return { data: ctx._d }; }
        };
        return ctx;
      } };
    }
  };
  const mod = new Function('document',
    '"use strict";\n' + tables + '\n' + helpers + '\n' + lab + '\n' + reader +
    '\nreturn { read: faceReadPortrait, faceLab: faceLab, faceHueAb: faceHueAb, faceChroma: faceChroma };')(doc);
  mod.__reader = reader;
  return mod;
}
const NEW = extract(SRC, 'work');
const OLD = extract(BASE, 'base');

/* ── fixture painters. S=1 paints in 128-space, S=2 the same geometry at 256 ── */
function painter(S) {
  const N = 128 * S;
  const img = { naturalWidth: N, naturalHeight: N, __rgba: new Uint8ClampedArray(N * N * 4) };
  const put = (x, y, c) => { if (x < 0 || y < 0 || x >= N || y >= N) return; const i = (y * N + x) * 4; img.__rgba[i] = c[0]; img.__rgba[i + 1] = c[1]; img.__rgba[i + 2] = c[2]; img.__rgba[i + 3] = 255; };
  const rect = (x0, y0, x1, y1, c) => { for (let y = y0 * S; y <= y1 * S + (S - 1); y++) for (let x = x0 * S; x <= x1 * S + (S - 1); x++) put(x, y, c); };
  const ell = (cx, cy, rx, ry, c) => { for (let y = Math.floor((cy - ry) * S); y <= Math.ceil((cy + ry) * S); y++) for (let x = Math.floor((cx - rx) * S); x <= Math.ceil((cx + rx) * S); x++) { const dx = (x / S - cx) / rx, dy = (y / S - cy) / ry; if (dx * dx + dy * dy <= 1) put(x, y, c); } };
  return { img, put, rect, ell, N, S };
}
const hx = h => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const HAIR = hx('#3a2a1b'), EYE = hx('#241a12'), LIP = hx('#9a5a4a'), SHIRT = hx('#4a6a8a'), SKIN = hx('#c68e6f');
const WALL = hx('#b9c0c4');
function head(p, skin) {
  p.ell(64, 66, 20, 26, skin);
  p.rect(46, 36, 82, 40, HAIR);
  p.ell(64, 41, 20, 6, HAIR);
  p.rect(57, 90, 71, 102, skin);
  p.rect(51, 56, 59, 57, EYE);
  p.rect(69, 56, 77, 57, EYE);
  p.ell(55, 62, 2, 1.6, EYE); p.ell(73, 62, 2, 1.6, EYE);
  p.rect(58, 78, 70, 80, LIP);
}
/* ground truth for this geometry: the head ellipse spans x 44..84, so the
   widest row is 41px wide at 128 and ~82 at 256 */
const FACE_L = 44, FACE_R = 84;

/* ═══ G1 — wall-to-wall merge refuses the WHOLE read ═══ */
{
  const p = painter(1);
  p.rect(0, 0, 127, 127, hx('#2c2c30'));
  p.rect(0, 0, 127, 78, hx('#837568'));   /* taupe wall passing the YCbCr skin window */
  head(p, SKIN);
  p.rect(40, 108, 88, 127, SHIRT);
  const rNew = NEW.read(p.img);
  ok(rNew && rNew.look === null,
    'G1: the wall-merged frame must refuse the whole read - a box from one edge to the other is not a face outline');
  ok((rNew.found || []).some(s => /one edge of the picture to the other/.test(s)),
    'G1: the refusal must NAME the wall-to-wall outline so the doctor changes the background, not the camera');
  /* control: the pre-fix code CLAIMS the wall */
  const rOld = OLD.read(p.img);
  ok(rOld && rOld.look && rOld.look.skin === '#837568',
    'G1-control: the pre-fix code was expected to claim the wall hex verbatim (adjudication A); if it no longer does, this pin is decoration');
  ok(rOld.derived.indexOf('nose') >= 0,
    'G1-control: the pre-fix code was expected to derive a nose from the wall - the whole-read kill exists because single-knob gates missed these');
}

/* ═══ G2/G3 — the chroma bound is re-derived against photographed skin ═══ */
{
  const p = painter(1);
  p.rect(0, 0, 127, 127, WALL); head(p, hx('#e0ac69')); p.rect(40, 108, 88, 127, SHIRT);
  const rNew = NEW.read(p.img);
  ok(rNew.derived.indexOf('skin') >= 0 && rNew.look.skin === '#e0ac69',
    'G2: photographed skin #e0ac69 (C* 43.0) must be CLAIMED - the C*<32 bound was chip-calibrated, and real lit faces measure 41-52');
  const rOld = OLD.read(p.img);
  const oldLine = (rOld.found || []).find(s => /skin sample came back/.test(s)) || '';
  ok(rOld.derived.indexOf('skin') < 0 && /hue 75/.test(oldLine) && /needs 45/.test(oldLine),
    'G2-control: the pre-fix code was expected to refuse #e0ac69 on CHROMA while quoting "hue 75, needs 45+" - a hue that PASSED. That absurdity is the reason the message now names its term');
  /* G3: pink still refused, and the message names the failing bound */
  const q = painter(1);
  q.rect(0, 0, 127, 127, hx('#4a5a4a')); head(q, hx('#f6d5d0')); q.rect(40, 108, 88, 127, SHIRT);
  const rPink = NEW.read(q.img);
  const pinkLine = (rPink.found || []).find(s => /skin sample came back/.test(s)) || '';
  ok(rPink.derived.indexOf('skin') < 0,
    'G3: pink (#f6d5d0, hue 32) must STAY refused - widening the chroma bound must not readmit the pale-pink class the gate was built against');
  ok(/hue 32/.test(pinkLine) && /45°-95°/.test(pinkLine),
    'G3: the refusal must name the term that failed with its bound (got: ' + pinkLine.slice(0, 120) + ')');
}

/* ═══ G4 — canthus/forehead contamination no longer poisons the swatch ═══ */
{
  function poisoned() {
    const p = painter(1);
    p.rect(0, 0, 127, 127, WALL); head(p, SKIN); p.rect(40, 108, 88, 127, SHIRT);
    /* rose #a1665e sits INSIDE the mask tolerance (chDist ~31 < 56, bright
       enough), painted over the old eye-line patch sites and the forehead
       site - socket shadow, rim shadow and a fringe shadow, respectively */
    const rose = hx('#a1665e');
    for (let y = 63; y <= 69; y++) for (let x = 49; x <= 56; x++) p.put(x, y, rose);
    for (let y = 63; y <= 69; y++) for (let x = 72; x <= 79; x++) p.put(x, y, rose);
    for (let y = 53; y <= 59; y++) for (let x = 60; x <= 68; x++) p.put(x, y, rose);
    return p.img;
  }
  const rNew = NEW.read(poisoned());
  ok(rNew.derived.indexOf('skin') >= 0 && rNew.look.skin === '#c68e6f',
    'G4: with rims/shadow on the eye line and forehead, the reported swatch must still be the cheek (patches moved off the eye line)');
  const rOld = OLD.read(poisoned());
  ok(rOld.derived.indexOf('skin') < 0,
    'G4-control: the pre-fix spots were expected to return the muddy rose and refuse (the owner\'s p1 #9d6c64 signature); if the old code now passes, this pin proves nothing');
}

/* ═══ G5 — after the clamp, the patches sit inside the face's own span ═══ */
{
  function clamped() {
    const p = painter(1);
    p.rect(0, 0, 127, 127, WALL); head(p, SKIN); p.rect(40, 108, 88, 127, SHIRT);
    p.ell(38, 76, 11, 14, SKIN);   /* a hand at cheek level, below the centre-vote band */
    return p.img;
  }
  const rNew = NEW.read(clamped());
  ok(rNew.box && rNew.box.lopsided === true,
    'G5: the hand fixture must fire the lopsided clamp, or this pin tests nothing (asym measured 1.89 on these bytes)');
  const spots = rNew.box.skinSpots || [];
  eq(spots.length, 5, 'G5: the box must carry all five skin-patch centres');
  spots.forEach(function (sp, i) {
    ok(sp[0] >= FACE_L && sp[0] <= FACE_R,
      'G5: patch ' + i + ' at x=' + sp[0] + ' sits outside the true face span [' + FACE_L + ',' + FACE_R + '] - the box did not follow the clamp');
  });
  /* control: the pre-fix box mixes the un-clamped L with the clamped w, so its
     own atX(0.20) lands OUTSIDE the face */
  const rOld = OLD.read(clamped());
  ok(rOld.box && rOld.box.lopsided === true, 'G5-control: the clamp must fire on the old bytes too');
  const oldSpot0 = rOld.box.L + Math.round(0.20 * rOld.box.w);
  ok(oldSpot0 < FACE_L,
    'G5-control: the pre-fix atX(0.20) (=' + oldSpot0 + ') was expected OUTSIDE the face span - the measured centre-line bug. If it lands inside, this pin is decoration');
}

/* ═══ G6/G7/G8 — the adaptive grid and THE SAMPLED-FACE-SIZE GATE ═══ */
{
  const p128 = painter(1);
  p128.rect(0, 0, 127, 127, WALL); head(p128, SKIN); p128.rect(40, 108, 88, 127, SHIRT);
  const p256 = painter(2);
  p256.rect(0, 0, 127, 127, WALL); head(p256, SKIN); p256.rect(40, 108, 88, 127, SHIRT);
  const r128 = NEW.read(p128.img);
  const r256 = NEW.read(p256.img);
  eq(r128.receipt.grid, 128,
    'G6: a 128 source must stay on the 128 grid - upscaling would invent pixels');
  eq(r256.receipt.grid, 256,
    'G6: a 256-capable source must be read on the 256 grid - a fixed 128 grid is invariant to the camera, which is the root cause this train exists to fix');
  /* THE SAMPLED-FACE-SIZE GATE: the same head, drawn 2x, must MEASURE 2x.
     Ground truth: the ellipse is 41px wide at 128, ~82 at 256. */
  ok(r128.receipt.faceW >= 38 && r128.receipt.faceW <= 44,
    'G6: sampled face size at 128 off ground truth (got ' + r128.receipt.faceW + ', truth 41)');
  ok(r256.receipt.faceW >= 76 && r256.receipt.faceW <= 88,
    'G6: SAMPLED FACE SIZE at 256 off ground truth (got ' + r256.receipt.faceW + ', truth ~82) - the doubled grid is not reaching the estimators');
  ok(r256.receipt.faceW >= 1.8 * r128.receipt.faceW,
    'G6: the 256 read must sample ~2x the face pixels of the 128 read (got ' + r256.receipt.faceW + ' vs ' + r128.receipt.faceW + ')');
  /* lexical control - the stub cannot honestly drive the OLD bytes at 256 (it
     copies pixels 1:1 and old code always sizes its canvas at 128) */
  ok(/var M = 128;/.test(OLD.__reader),
    'G6-control: the pre-fix reader was expected to hard-pin var M = 128 - if that moved, the baseline is not the baseline');
  ok(!/var M = 128;/.test(NEW.__reader),
    'G6: the shipped reader still hard-pins var M = 128 - the adaptive grid did not land');
  /* G7 identity: on the clean 128 fixture the fix changes NOTHING */
  const rOld128 = OLD.read(p128.img);
  eq(JSON.stringify(r128.derived.slice().sort()), JSON.stringify(rOld128.derived.slice().sort()),
    'G7: the clean 128 fixture must claim exactly what the pre-fix code claimed - the fix must not move the ordinary case');
  eq(r128.look.skin, rOld128.look.skin, 'G7: same claimed skin hex on the clean 128 fixture');
  /* G8 the win, measured: 256 claims a superset (brows + eyeSet become
     measurable at the finer grid on this geometry) */
  r128.derived.forEach(function (k) {
    ok(r256.derived.indexOf(k) >= 0, 'G8: claim "' + k + '" was lost when the grid doubled - a resolution increase must never cost a verdict');
  });
  /* eyeSet is deliberately NOT asserted here: this painter's brow bars sit
     inside the eye band, so the compactness gate refuses eye spacing at BOTH
     grids (correctly - a bar is not an iris). Eye spacing at 256 is proven by
     the playwright photo proof's close/wide-set cases, which draw irises with
     no bars. */
  ok(r128.derived.indexOf('brows') < 0,
    'G8-control: brows were expected UNREADABLE at 128 on this geometry (browMed 2 < the 3-row blend floor) - if they read at 128, the win below proves nothing');
  ok(r256.derived.indexOf('brows') >= 0,
    'G8: brows were the measured resolution win on this geometry (browMed 2 -> 4, clearing the 3-row blend floor at 256) - if absent, the budget increase is not reaching the resolution-limited estimators');
}

/* ═══ G9 — the nose saturation refusal names light, not the camera ═══ */
{
  const p = painter(1);
  p.rect(0, 0, 127, 127, WALL); head(p, SKIN); p.rect(40, 108, 88, 127, SHIRT);
  const dark = hx('#a67a5c'); /* inside the mask, below both nose cuts */
  for (let y = 70; y <= 77; y++) for (let x = 47; x <= 81; x++) p.put(x, y, dark);
  const rNew = NEW.read(p.img);
  const noseNew = (rNew.found || []).find(s => /nose/.test(s)) || '';
  ok(/not a camera limit/.test(noseNew),
    'G9: the saturated-scan refusal must say it is LIGHT, not the camera (got: ' + noseNew.slice(0, 120) + ')');
  const rOld = OLD.read(p.img);
  const noseOld = (rOld.found || []).find(s => /nose/.test(s)) || '';
  ok(/runs past what this photo can measure/.test(noseOld),
    'G9-control: the pre-fix code was expected to print the camera-blaming line on this fixture');
  ok(SRC.indexOf('runs past what this photo can measure') < 0,
    'G9: the misleading line must be GONE from the shipped module - it sent the owner shopping for a camera that could not change one pixel of the verdict');
}

/* ═══ G10 — the eyes claim announces itself ═══ */
{
  function irised() {
    const p = painter(1);
    p.rect(0, 0, 127, 127, WALL); head(p, SKIN); p.rect(40, 108, 88, 127, SHIRT);
    const IRIS = hx('#5a4632');
    /* the eye sample reads atX(0.30)=56 and atX(0.70)=73 on this geometry */
    for (let y = 65; y <= 67; y++) { for (let x = 55; x <= 57; x++) p.put(x, y, IRIS); for (let x = 72; x <= 74; x++) p.put(x, y, IRIS); }
    return p.img;
  }
  const rNew = NEW.read(irised());
  ok(rNew.derived.indexOf('eyes') >= 0, 'G10: the iris fixture must claim eye colour, or this pin tests nothing');
  ok((rNew.found || []).indexOf('eye colour') >= 0,
    'G10: an eyes claim must announce itself in `found` - the receipt counted a claim the announcement never named (told 4, credited 5)');
  const rOld = OLD.read(irised());
  ok(rOld.derived.indexOf('eyes') >= 0 && (rOld.found || []).indexOf('eye colour') < 0,
    'G10-control: the pre-fix code was expected to claim eyes silently; if it announces now, this pin is decoration');
}

/* ═══ G12 — THE EYES SIZE THE BOX (gx-1.2, the partial-merge hole) ═══
   The gx-1.0 chroma widening (C* to 60, re-derived on photographed skin)
   uncovered a case the wall-to-wall veto cannot reach: a warm wooden door
   (#a97843, hue 69.8, C* 38.7 - inside the YCbCr window AND the widened
   gate) merging into the component from one side. MEASURED on this train's
   intermediate bytes: box L=44 R=110 on a 41px face, asym exactly 1.2 (a
   hair under the clamp), and the door hex CLAIMED as skin. The pre-fix
   baseline refused that door - on chroma, quoting a hue that passed, the
   wrong reason - but it refused; the widening must not readmit it. The cure
   is corroboration by the face's own eyes (separation 0.44-0.56 of a real
   face's width; a box the eyes call too wide, or an eye window with no eye
   in it, refuses the skin claim with the merge named).
   THE FULL LEDGER, measured on all three builds so the trade is explicit:
     one-sided door:  b1018 claimed the FACE colour - 2-of-5 patch-median
                      LUCK (its eye-line pair put only two patches on the
                      door); gx-1.0/1.1 claimed the DOOR hex (moved patches
                      ride the inflated box, widened gate admits C* 38.7);
                      gx-1.2 REFUSES, naming the merge. Cost vs b1018: one
                      lucky claim traded for an honest refusal + a live-view
                      nudge; the doctor is told to step aside, not lied to.
     both-sided:      b1018 refused (chroma, wrong reason, quoting a hue
                      that passed); gx-1.2 refuses naming the merge.
   GLASSES (this owner wears them - monitor follow-up, measured): the gate
   SURVIVES glasses at both grids, because a rim is a dark mass AT the eye
   positions - clean bespectacled faces corroborate at separation ~0.46 and
   never fire, glare on a lens does not defeat it (the rim ring supplies the
   mass), and glasses+door still refuses. "Found" means n >= 6 on BOTH arms:
   a 2px stray in the door-aimed window is a non-null mass and the first
   version's !eR arm let it defeat both branches - the 128 door was claimed
   again until the floor was applied symmetrically.
   THE COUPLING, stated plainly: this corroboration rides the same dark-mass
   detector as eyeSet, which is resolution-limited. On a source whose eye
   masses are entirely undetectable (closed eyes, heavy blur, extreme
   low-res) the gate cannot fire and the partial-merge residual stands -
   protection is weakest on the worst inputs. The owner's own camera path
   (1024 capture -> 256 grid) is where it is strongest. */
{
  const DOOR = hx('#a97843');
  function withDoor(both) {
    const p = painter(1);
    p.rect(0, 0, 127, 127, WALL); head(p, SKIN); p.rect(40, 108, 88, 127, SHIRT);
    if (both) { p.rect(20, 40, 45, 110, DOOR); p.rect(83, 40, 108, 110, DOOR); }
    else p.rect(83, 40, 110, 110, DOOR);
    return p.img;
  }
  const one = NEW.read(withDoor(false));
  ok(one.derived.indexOf('skin') < 0 && one.look.skin === undefined,
    'G12: the one-sided warm-door merge must NOT claim skin - the widened chroma gate would otherwise admit the door the old bound refused (for the wrong reason)');
  ok((one.found || []).some(s => /wider than your eye spacing/.test(s)),
    'G12: the one-sided merge refusal must name the outline/merge, not a colour bound');
  const two = NEW.read(withDoor(true));
  ok(two.derived.indexOf('skin') < 0,
    'G12: the both-sided warm merge must NOT claim skin (eye separation 0.21 of the merged width vs 0.44+ on a real face)');
  const oldOne = OLD.read(withDoor(false));
  ok(oldOne.derived.indexOf('skin') >= 0 && oldOne.look.skin === '#c68e6f',
    'G12-control: the pre-fix baseline was measured CLAIMING the face colour on the one-sided door (2-of-5 patch-median luck) - if that moved, the ledger above is stale and the trade must be re-sized');
  const oldTwo = OLD.read(withDoor(true));
  ok(oldTwo.derived.indexOf('skin') < 0,
    'G12-control: the pre-fix baseline was measured REFUSING the both-sided merge (chroma, its wrong reason) - if it claims now, the ledger above is stale');
  /* and the corroboration must not overtighten: the clean face has both eyes
     at sane spacing and still claims */
  const clean = painter(1);
  clean.rect(0, 0, 127, 127, WALL); head(clean, SKIN); clean.rect(40, 108, 88, 127, SHIRT);
  const rc = NEW.read(clean.img);
  ok(rc.derived.indexOf('skin') >= 0,
    'G12: the clean face must still claim skin - the eye-corroboration gate must not fire on sane geometry');
  /* glasses: rims are dark masses AT the eye positions, so a bespectacled
     face corroborates - the gate must neither false-fire clean nor go blind
     with the door. Glare on one lens must not defeat either direction. */
  const RIMC = hx('#2a2226'), GLARE = hx('#e8ecef');
  function bespectacled(door, glare) {
    const p = painter(1);
    p.rect(0, 0, 127, 127, WALL); head(p, SKIN); p.rect(40, 108, 88, 127, SHIRT);
    [[55, 62], [73, 62]].forEach(([ex, ey], i) => {
      for (let t = 0; t < 360; t += 2) {
        const a = t * Math.PI / 180;
        p.put(Math.round(ex + 6.5 * Math.cos(a)), Math.round(ey + 5 * Math.sin(a)), RIMC);
      }
      if (glare && i === 0) p.ell(ex, ey, 4.5, 3.5, GLARE);
    });
    p.rect(61, 61, 67, 62, RIMC); p.rect(44, 61, 48, 62, RIMC); p.rect(80, 61, 84, 62, RIMC);
    if (door) p.rect(83, 40, 110, 110, DOOR);
    return p.img;
  }
  ok(NEW.read(bespectacled(false, false)).derived.indexOf('skin') >= 0,
    'G12: a clean bespectacled face must still claim skin - the rims corroborate at sane separation, they must never fire the gate');
  ok(NEW.read(bespectacled(false, true)).derived.indexOf('skin') >= 0,
    'G12: glare on one lens must not fire the gate on a clean face - the rim ring still supplies the mass');
  const bd = NEW.read(bespectacled(true, false));
  ok(bd.derived.indexOf('skin') < 0 && (bd.found || []).some(s => /wider than your eye spacing/.test(s)),
    'G12: glasses + door must STILL refuse with the merge named - this owner wears glasses, and a gate his glasses defeat protects everyone but him');
  ok(NEW.read(bespectacled(true, true)).derived.indexOf('skin') < 0,
    'G12: glare + glasses + door must still refuse - a washed lens must not blind the corroboration');
  /* the n>=6 floor is symmetric: a sub-floor stray in the door-aimed window is
     NOT an eye, and must not defeat the one-sided arm (it did - the 128 door
     was claimed again until the floor was applied to both branches) */
  ok((one.found || []).some(s => /wider than your eye spacing/.test(s)),
    'G12: the 128-grid one-sided door must refuse via the one-sided arm - a 2px stray mass in the merged window must not count as a found eye');
}

/* ═══ G11 — the box carries what the live view needs to draw the truth ═══ */
{
  const p = painter(1);
  p.rect(0, 0, 127, 127, WALL); head(p, SKIN); p.rect(40, 108, 88, 127, SHIRT);
  const r = NEW.read(p.img);
  eq(r.box.grid, r.receipt.grid, 'G11: box.grid must equal receipt.grid - two grids would let the overlay scale by the wrong one');
  eq((r.box.skinSpots || []).length, 5, 'G11: box.skinSpots must carry all five patch centres');
  eq(r.box.patchR, 2, 'G11: box.patchR must carry the patch radius in grid pixels (2 at PR=1)');
  ok(typeof r.box.cx === 'number', 'G11: box.cx must carry the centre line the estimators used');
}

console.log('face-grid-and-skin-geometry: PASS (' + pass + ' assertions)');
