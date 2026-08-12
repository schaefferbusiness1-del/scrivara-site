'use strict';
/*
 * A REFUSAL NEVER LEAVES A STALE LOOK SILENTLY RENDERING  (fx-1.0, 2026-08-11)
 * =============================================================================
 * Owner, twice on 2026-08-11, with a screenshot: he retook his photo, the
 * sampler refused ("I found your head but could not separate your skin from
 * your hair...") - and the avatar preview and controls kept rendering the STALE
 * poisoned saved look, with the refusal line pale enough to miss. The measured
 * root causes live in handoff-2026-08-11/face-rework/DIAGNOSIS.md; this suite
 * drives the REAL shipped code (extracted by anchor, executed under a canvas
 * stub - the diagnosis-harness pattern) and pins the contract this train ships:
 *
 *   C1  THE CONSUMER CONTRACT (Mechanism B): faceReadPortrait's `look` carries
 *       ONLY claimed knobs; refusals are machine-readable, counted, and name a
 *       control that exists; claimed + refused == examined on every fixture.
 *   C2  THE ILLUSTRATION YIELDS NO COLOUR AT ALL (P5): on a posterized copy no
 *       colour key survives in `look` - not merely stripped from `derived` -
 *       and no colour description contradicts the refusal (P10).
 *   C3  THE KIOSK APPLIES ONLY CLAIMED KNOBS (P6): the day-one branch goes
 *       through faceKioskDayOneLook; an illustration-only read applies NOTHING
 *       (byte-equal to the default look).
 *   C4  THE T8 DOOR CLASS ENDS IN REFUSAL (P4-lite, duplicate-surface veto):
 *       a white door behind a dark buzz-cut head must never again become
 *       claimed long white hair + a white top; the clean T1 head must still
 *       claim its true colours (the veto must not eat the working case).
 *   C5  QUARANTINE + UI TRUTH: the loud refusal note, the amber fourth badge
 *       state, the stale marking on a whole-read refusal, the saved-look
 *       quarantine gates, and the one-click derived-look reset (manual picks
 *       and cap/stethoscope/age preserved) - the pure helpers EXECUTED, the
 *       wiring pinned in the shipped bytes.
 *   C6  THE VISION OUTPUT GATE: model claims pass the same CIELAB/artifact
 *       gates as the pixels; `age` is never auto-applied; and the vision call
 *       site is lexically guarded off the illustration (P9-lite).
 *
 * CONTROLS, IN-SUITE (a guard and its test can agree and both be wrong): the
 * SAME extraction and the SAME fixtures run against the PRE-FIX bytes (commit
 * 64143c75, this train's base - read from local git objects, no network), and
 * the pre-fix code must EXHIBIT the defect each pin guards: the door claimed
 * as long white hair, the posterized gray riding `look`, the kiosk wholesale
 * apply. If the old code passes a pin, that pin is decoration and this suite
 * says so.
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

/* ── the PRE-FIX baseline for the controls ──────────────────────────────────
   The commit this train branched from (b1011). It is origin/main history, so
   it is in every clone's local object store - no fetch, no fixture file. */
const BASE_COMMIT = '64143c75244a6f6bf4c9b20e35cf861ba8edcf7e';
let BASE = null;
try {
  BASE = execFileSync('git', ['show', BASE_COMMIT + ':feat_mls_avatar.js'],
    { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
} catch (e) { /* asserted below */ }
ok(!!BASE && BASE.length > 100000,
  'the pre-fix baseline (' + BASE_COMMIT.slice(0, 8) + ':feat_mls_avatar.js) could not be read from ' +
  'local git objects. Without it every control below is vacuous and this suite could be green over ' +
  'a broken guard - the exact silent pass it exists to prevent.');

/* ═══ EXTRACTION: the real code, by anchor, executed under a canvas stub ═══ */
function extractFacePipeline(src, tag) {
  function sliceBetween(a, b, label) {
    const i = src.indexOf(a);
    ok(i >= 0, tag + ': start anchor "' + label + '" not found');
    ok(src.indexOf(a, i + 1) < 0, tag + ': start anchor "' + label + '" is not unique');
    const j = src.indexOf(b, i);
    ok(j > i, tag + ': end anchor for "' + label + '" not found after start');
    return src.slice(i, j);
  }
  const tables = sliceBetween('var FACE_LOOK = {', 'function faceShade', 'tables');
  const helpers = sliceBetween('function faceShade', 'var FACE_MOUTHS', 'helpers');
  const lab = sliceBetween('function faceIsSkinRgb', 'function faceReadPortrait', 'lab');
  const reader = sliceBetween('function faceReadPortrait', 'function faceTalkStop', 'reader');
  const hasFx = src.indexOf('function faceApplyDerived') >= 0;
  const exports_ = 'return { faceReadPortrait: faceReadPortrait, faceLookSafe: faceLookSafe, FACE_LOOK: FACE_LOOK' +
    (hasFx ? ', faceApplyDerived: faceApplyDerived, faceKioskDayOneLook: faceKioskDayOneLook' +
      ', faceHexSkinGate: faceHexSkinGate, faceHexIsPosterArtifact: faceHexIsPosterArtifact' +
      ', faceLookQuarantine: faceLookQuarantine, faceClearDerived: faceClearDerived' +
      ', faceVisionClaimGate: faceVisionClaimGate' : '') + ' };';
  const doc = {
    createElement: function () {
      return {
        width: 0, height: 0,
        getContext: function () {
          return {
            drawImage: function (img) { this._d = img.__rgba.slice(); },
            getImageData: function () { return { data: this._d } ; }
          };
        }
      };
    }
  };
  const mod = new Function('document',
    '"use strict";\n' + tables + '\n' + helpers + '\n' + lab + '\n' + reader + '\n' + exports_)(doc);
  mod.__hasFx = hasFx;
  return mod;
}
const NEW = extractFacePipeline(SRC, 'work');
const OLD = extractFacePipeline(BASE, 'base');
ok(NEW.__hasFx, 'the fx-1.0 helpers (faceApplyDerived and friends) are missing from the shipped bytes');
ok(!OLD.__hasFx, 'the pre-fix baseline already contains faceApplyDerived - the controls below would ' +
  'be comparing the fix against itself and could never fail');

/* ═══ FIXTURES (the diagnosis harness painters, 128x128) ═══════════════════ */
const M = 128;
function mkImg() { return { naturalWidth: M, naturalHeight: M, __rgba: new Uint8ClampedArray(M * M * 4) }; }
function hx(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function put(img, x, y, c) { if (x < 0 || y < 0 || x >= M || y >= M) return; const i = (y * M + x) * 4; img.__rgba[i] = c[0]; img.__rgba[i + 1] = c[1]; img.__rgba[i + 2] = c[2]; img.__rgba[i + 3] = 255; }
function rect(img, x0, y0, x1, y1, c) { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) put(img, x, y, c); }
function ell(img, cx, cy, rx, ry, c) { for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) { const dx = (x - cx) / rx, dy = (y - cy) / ry; if (dx * dx + dy * dy <= 1) put(img, x, y, c); } }
const HAIR = hx('#3a2a1b'), SKIN = hx('#c68e6f'), EYE = hx('#241a12'), LIP = hx('#9a5a4a'), SHIRT = hx('#4a6a8a');
const WALL = hx('#8a8880'), DOOR = hx('#e8e6e0');
function chD(a, b) { return (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2])) / 3; }
function hexRgb(h) { return hx(h); }

function paintHead(img) {
  const cx = 64, cy = 62;
  ell(img, cx, cy + 4, 20, 26, SKIN);
  rect(img, cx - 18, cy - 26, cx + 18, cy - 22, HAIR);
  ell(img, cx, cy - 21, 20, 6, HAIR);
  rect(img, cx - 7, cy + 28, cx + 7, cy + 40, SKIN);          /* neck */
  rect(img, cx - 13, cy - 6, cx - 5, cy - 5, EYE);
  rect(img, cx + 5, cy - 6, cx + 13, cy - 5, EYE);
  ell(img, cx - 9, cy, 2, 1.6, EYE); ell(img, cx + 9, cy, 2, 1.6, EYE);
  rect(img, cx - 6, cy + 16, cx + 6, cy + 18, LIP);
}
/* T1: the clean head - plain wall, contrasting shirt. The sampler is PROVEN on
   this input (diagnosis section 7) and must stay proven after the veto. */
const T1 = mkImg();
rect(T1, 0, 0, M - 1, M - 1, WALL);
rect(T1, 0, 112, M - 1, M - 1, SHIRT);
paintHead(T1);
/* T8: the measured killer - a white door / bright hallway behind the head. */
const T8 = mkImg();
rect(T8, 0, 0, M - 1, M - 1, WALL);
rect(T8, 34, 0, 94, 108, DOOR);
rect(T8, 0, 112, M - 1, M - 1, SHIRT);
paintHead(T8);
/* NOFACE: wall only. */
const NOFACE = mkImg();
rect(NOFACE, 0, 0, M - 1, M - 1, WALL);

/* POSTERIZED: T1 through the shipped stylize math, replicated EXACTLY and
   string-pinned against the shipped lines so a formula change breaks this
   suite loudly instead of silently un-posterizing the fixture. */
ok(SRC.indexOf('var levels = 6, step2 = 255 / (levels - 1);') >= 0 &&
   SRC.indexOf('d[i] = Math.round(Math.min(255, d[i] * 1.06) / step2) * step2;') >= 0 &&
   SRC.indexOf('d[i + 2] = Math.round((d[i + 2] * 0.97) / step2) * step2;') >= 0,
  'the stylizeCanvas posterize formula moved - the POSTERIZED fixture below no longer replicates ' +
  'the shipped math and every illustration pin would be measuring a fiction');
function posterize(img) {
  const out = mkImg();
  const step2 = 255 / 5;
  for (let i = 0; i < img.__rgba.length; i += 4) {
    out.__rgba[i] = Math.round(Math.min(255, img.__rgba[i] * 1.06) / step2) * step2;
    out.__rgba[i + 1] = Math.round(img.__rgba[i + 1] / step2) * step2;
    out.__rgba[i + 2] = Math.round((img.__rgba[i + 2] * 0.97) / step2) * step2;
    out.__rgba[i + 3] = 255;
  }
  return out;
}
const TPOST = posterize(T1);

const rNew = {
  t1: NEW.faceReadPortrait(T1),
  t8: NEW.faceReadPortrait(T8),
  post: NEW.faceReadPortrait(TPOST),
  noface: NEW.faceReadPortrait(NOFACE)
};
const rOld = {
  t8: OLD.faceReadPortrait(T8),
  post: OLD.faceReadPortrait(TPOST)
};

/* ═══ C1: the consumer contract, on every fixture that found a face ════════ */
const COLOUR_KNOBS = ['skin', 'hair', 'eyes', 'lip', 'shirt', 'browCol'];
const CLAIM_SENTENCES = {
  hair: ['dark hair', 'light hair', 'mid-tone hair'],
  hairStyle: ['very short hair', 'long hair', 'short hair'],
  shirt: ['top colour'],
  browCol: ['brows a different colour from the hair']
};
['t1', 't8', 'post'].forEach(function (name) {
  const r = rNew[name];
  ok(r && r.look, name + ': the reader found no face on a fixture that has one');
  const derived = r.derived || [];
  const refused = r.refused || [];
  const receipt = r.receipt || {};
  /* every knob in look is licensed by derived */
  Object.keys(r.look).forEach(function (k) {
    ok(derived.indexOf(k) >= 0,
      name + ': look.' + k + ' is present without a licence in derived - a refused or unclaimed ' +
      'value is riding the result again, which is exactly how the kiosk painted gray hair');
  });
  /* no knob is both claimed and refused; every refusal is machine-actionable */
  refused.forEach(function (rr) {
    ok(rr && rr.knob && rr.reason && rr.action,
      name + ': a refusal entry is missing knob/reason/action: ' + JSON.stringify(rr));
    ok(derived.indexOf(rr.knob) < 0,
      name + ': ' + rr.knob + ' is both claimed and refused - the two lists must be disjoint');
    ok(rr.action === 'mlsAvLook_' + rr.knob,
      name + ': refusal action for ' + rr.knob + ' does not name its control id');
    const rx = new RegExp("(?:colourControl|pickControl|toggleControl)\\('" + rr.knob + "'");
    ok(rx.test(SRC),
      name + ': refused knob ' + rr.knob + ' has no Setup control in the shipped bytes - the ' +
      'refusal points at a door that does not exist (P8)');
  });
  /* the receipt arithmetic */
  eq(receipt.claimed, derived.length, name + ': receipt.claimed disagrees with derived');
  eq(receipt.refused, refused.length, name + ': receipt.refused disagrees with refused[]');
  eq(receipt.claimed + receipt.refused, receipt.examined,
    name + ': claimed + refused != examined - a knob fell into the third state the contract bans');
  ok(receipt.examined >= 14, name + ': the examinable set shrank to ' + receipt.examined);
  /* ⛔ RE-EXAMINED DELIBERATELY, NOT DELETED (gx-1.0, 2026-08-12, A5 protocol).
     This pin used to mean "the analysis grid is 128, full stop". The grid is
     now ADAPTIVE - 256 when the source can fill it, 128 otherwise, never
     upscaled - and every fixture in THIS suite is a 128x128 image, so 128
     remains the TRUE grid for them and the pin stands with a narrower meaning:
     a 128 source is never upscale-read. The 256 side is pinned where 256
     sources exist: face-grid-and-skin-geometry.test.js G6 asserts a 256
     fixture reads grid=256 with the sampled face size ~2x its 128 reading. */
  eq(receipt.grid, 128, name + ': a 128-source fixture must stay on the 128 grid (adaptive grid never upscales; see face-grid-and-skin-geometry G6 for the 256 pin)');
  /* P10 - no claim sentence may coexist with a refusal of the same knob */
  Object.keys(CLAIM_SENTENCES).forEach(function (k) {
    if (refused.some(function (rr) { return rr.knob === k; })) {
      CLAIM_SENTENCES[k].forEach(function (s) {
        ok((r.found || []).indexOf(s) < 0,
          name + ': found[] still describes "' + s + '" while ' + k + ' is refused - the measured ' +
          'T2 self-contradiction (a refusal and a claim about the same sample, side by side)');
      });
    }
  });
});

/* ═══ C4: T1 keeps its true colours (the veto must not eat the clean case) ═ */
{
  const r = rNew.t1;
  ok(r.derived.indexOf('skin') >= 0, 'T1: skin is no longer claimed on the clean fixture');
  ok(chD(hexRgb(r.look.skin), SKIN) <= 12,
    'T1: claimed skin ' + r.look.skin + ' is more than chDist 12 from the true #c68e6f');
  ok(r.derived.indexOf('hair') >= 0, 'T1: hair is no longer claimed on the clean fixture - ' +
    'the duplicate-surface veto is firing on a case it must not touch');
  ok(chD(hexRgb(r.look.hair), HAIR) <= 12,
    'T1: claimed hair ' + r.look.hair + ' is more than chDist 12 from the true #3a2a1b');
  ok((r.found || []).indexOf('dark hair') >= 0, 'T1: the dark-hair description was lost');
}

/* ═══ C4: T8 - the door ends in refusal/manual, never long white hair ══════ */
{
  const r = rNew.t8;
  /* the door colour must never be claimed, as hair OR as the top */
  if (r.look.hair !== undefined) {
    ok(chD(hexRgb(r.look.hair), DOOR) > 30,
      'T8: the claimed hair ' + r.look.hair + ' is the DOOR (within chDist 30 of #e8e6e0) - the ' +
      'owner\'s screenshot verbatim');
  }
  if (r.look.shirt !== undefined) {
    ok(chD(hexRgb(r.look.shirt), DOOR) > 30,
      'T8: the claimed top ' + r.look.shirt + ' is the DOOR');
  }
  ok(r.look.hairStyle !== 'long',
    'T8: hairStyle "long" was claimed off the door beside the face');
  /* and the refusal is not silence: the backdrop is named with its cure */
  ok((r.refused || []).some(function (rr) {
    return (rr.knob === 'hair' || rr.knob === 'shirt') && /background/.test(rr.reason);
  }), 'T8: no machine-readable refusal names the background as the cause');
  ok((r.found || []).some(function (s) { return /Retake against a plainer background/.test(s); }),
    'T8: the human sentence does not hand the doctor the cure (plainer background / by hand)');

  /* CONTROL: the pre-fix bytes must exhibit the measured defect */
  const o = rOld.t8;
  ok(o && o.look && o.derived.indexOf('hair') >= 0 && chD(hexRgb(o.look.hair), DOOR) <= 30,
    'CONTROL FAILED: the pre-fix reader did not claim the door as hair on T8 (claimed ' +
    JSON.stringify(o && o.look && o.look.hair) + ') - the fixture no longer reproduces the ' +
    'measured Mechanism A and the T8 pins above are decoration');
  eq(o.look.hairStyle, 'long',
    'CONTROL FAILED: the pre-fix reader did not claim long hair off the door on T8');
}

/* ═══ C2: the illustration yields no colour AT ALL ═════════════════════════ */
{
  const r = rNew.post;
  ok(r.receipt && r.receipt.fromIllustration === true,
    'POSTERIZED: the illustration was not detected - posterFrac broke or the fixture drifted');
  eq(r.receipt.srcKind, 'illustration', 'POSTERIZED: receipt.srcKind does not say illustration');
  COLOUR_KNOBS.forEach(function (k) {
    ok(r.look[k] === undefined,
      'POSTERIZED: look.' + k + ' = ' + r.look[k] + ' survived the illustration - a manufactured ' +
      'colour is riding the result for any consumer to mis-apply (Mechanism B)');
  });
  ok((r.refused || []).some(function (rr) { return rr.knob === 'hair' && /manufactured|stylized/.test(rr.reason); }),
    'POSTERIZED: the hair refusal does not say the colours are manufactured');

  /* CONTROL: the pre-fix result carried the refused gray in look.hair */
  const o = rOld.post;
  ok(o && o.look && typeof o.look.hair === 'string' &&
     o.look.hair[1] === o.look.hair[3] && o.look.hair[3] === o.look.hair[5] &&
     o.derived.indexOf('hair') < 0,
    'CONTROL FAILED: the pre-fix reader did not exhibit Mechanism B on the posterized fixture ' +
    '(expected an achromatic look.hair present WITHOUT a derived licence; got ' +
    JSON.stringify(o && o.look && o.look.hair) + ' / derived ' + JSON.stringify(o && o.derived) + ')');
}

/* ═══ C3: the kiosk consumer ═══════════════════════════════════════════════ */
{
  /* EXECUTED: an illustration-only read applies NOTHING - byte-equal default */
  const def = JSON.stringify(NEW.faceLookSafe(NEW.FACE_LOOK));
  eq(JSON.stringify(NEW.faceKioskDayOneLook(rNew.post)), def,
    'KIOSK: an illustration-only read did not yield the byte-identical default look (P6)');
  eq(JSON.stringify(NEW.faceKioskDayOneLook(null)), def,
    'KIOSK: a failed read (null) did not yield the default look');
  /* a clean read applies exactly the claimed knobs over the default */
  const applied = NEW.faceKioskDayOneLook(rNew.t1);
  eq(applied.skin, rNew.t1.look.skin, 'KIOSK: a claimed skin did not reach the day-one look');
  eq(applied.cap, false, 'KIOSK: accessories moved without a licence');
  /* the applier itself refuses unlicensed values even if a future look carries them */
  const drift = NEW.faceApplyDerived(NEW.FACE_LOOK, { look: { skin: '#c68e6f', hair: '#999999' }, derived: ['skin'] });
  eq(drift.skin, '#c68e6f', 'APPLIER: a licensed knob was not applied');
  eq(drift.hair, NEW.FACE_LOOK.hair,
    'APPLIER: an UNLICENSED value in look was applied - the contract has a hole for future callers');

  /* WIRING, in the shipped bytes: the branch goes through the one door */
  const bNew = SRC.slice(SRC.indexOf('} else if (hasPhoto && !kiosk.tinted) {'), SRC.indexOf('} else if (hasPhoto && !kiosk.tinted) {') + 1600);
  ok(/faceKioskDayOneLook\(res\)/.test(bNew),
    'KIOSK WIRING: the day-one branch no longer routes through faceKioskDayOneLook');
  ok(bNew.indexOf('kiosk.look = look;') < 0,
    'KIOSK WIRING: the wholesale apply (kiosk.look = look) is back');
  /* CONTROL: the pre-fix branch applied res.look wholesale */
  const bOld = BASE.slice(BASE.indexOf('} else if (hasPhoto && !kiosk.tinted) {'), BASE.indexOf('} else if (hasPhoto && !kiosk.tinted) {') + 800);
  ok(bOld.indexOf('kiosk.look = look; kiosk.face.retint(look);') >= 0,
    'CONTROL FAILED: the pre-fix kiosk branch does not contain the wholesale apply this pin ' +
    'exists to ban - the ban is unproven');
}

/* ═══ P3: no-face stays a shaped refusal ═══════════════════════════════════ */
{
  const r = rNew.noface;
  ok(r && r.look === null, 'NOFACE: a wall was described as a person');
  ok(Array.isArray(r.found) && r.found.length > 0 && r.found[0].length > 20,
    'NOFACE: the refusal lost its named cause');
}

/* ═══ C5: quarantine, reset, badges, loud note ═════════════════════════════ */
{
  /* the saved-look gates, EXECUTED */
  const q0 = NEW.faceLookQuarantine(NEW.faceLookSafe(NEW.FACE_LOOK));
  eq(q0.length, 0, 'QUARANTINE: the default look is flagged - every doctor would see the banner');
  const q1 = NEW.faceLookQuarantine({ skin: '#ffcccc', hair: '#333333' });
  ok(q1.some(function (b) { return b.knob === 'skin'; }) && q1.some(function (b) { return b.knob === 'hair'; }),
    'QUARANTINE: the owner\'s poisoned save (#ffcccc skin, #333333 hair) is not flagged');
  const q2 = NEW.faceLookQuarantine({ skin: '#f6d5d0' });
  ok(q2.some(function (b) { return b.knob === 'skin'; }),
    'QUARANTINE: a pale-pink skin (hue 32, outside the 45+ band) is not flagged');
  const q3 = NEW.faceLookQuarantine({ skin: '#c68e6f', hair: '#3a2a1b' });
  eq(q3.length, 0, 'QUARANTINE: an ordinary real skin/hair pair is flagged - false alarms would ' +
    'teach the doctor to ignore the banner');

  /* the reset, EXECUTED: derived knobs return to default; manual picks and
     cap/stethoscope/age are preserved */
  const poisoned = NEW.faceLookSafe({ skin: '#ffcccc', hair: '#333333', cap: true, age: 'mature', shirt: '#101010' });
  const clr = NEW.faceClearDerived(poisoned, {});
  eq(clr.skin, NEW.FACE_LOOK.skin, 'RESET: the poisoned skin survived the reset');
  eq(clr.hair, NEW.FACE_LOOK.hair, 'RESET: the poisoned hair survived the reset');
  eq(clr.shirt, NEW.FACE_LOOK.shirt, 'RESET: the derived top survived the reset');
  eq(clr.cap, true, 'RESET: the cap was cleared - it is never derivable and must be preserved');
  eq(clr.age, 'mature', 'RESET: the face-lines choice was cleared - age is never derived');
  const clr2 = NEW.faceClearDerived(poisoned, { skin: true });
  eq(clr2.skin, '#ffcccc', 'RESET: a knob the doctor set BY HAND this session was not preserved');
  eq(clr2.hair, NEW.FACE_LOOK.hair, 'RESET: the non-manual knob was not reset alongside the manual one');

  /* the vision gate, EXECUTED */
  ok(NEW.faceVisionClaimGate('age', 'mature') !== '',
    'VISION GATE: a model age claim is applied without the doctor\'s click - guessing a doctor ' +
    'looks old is the one wrong answer this feature must never volunteer');
  ok(NEW.faceVisionClaimGate('skin', '#ffcccc') !== '', 'VISION GATE: the posterize artifact #ffcccc passes as skin');
  ok(NEW.faceVisionClaimGate('hair', '#333333') !== '', 'VISION GATE: the posterize artifact #333333 passes as hair');
  ok(NEW.faceVisionClaimGate('skin', '#f6d5d0') !== '', 'VISION GATE: a non-skin hue passes the skin gate');
  eq(NEW.faceVisionClaimGate('skin', '#c68e6f'), '', 'VISION GATE: a real skin tone is refused - the gate is a blanket refusal, which proves nothing');
  eq(NEW.faceVisionClaimGate('hair', '#2f2b28'), '', 'VISION GATE: an ordinary dark hair is refused');
  eq(NEW.faceVisionClaimGate('hairStyle', 'long'), '', 'VISION GATE: a shape claim is refused - only colours and age are gated');

  /* the badges, EXECUTED: lift setLookBadges + lookManualTouch and drive them */
  const sb0 = SRC.indexOf('function setLookBadges(measured, aiRead) {');
  ok(sb0 >= 0, 'setLookBadges is gone');
  const sbEnd = SRC.indexOf('function lookManualTouch', sb0);
  ok(sbEnd > sb0, 'lookManualTouch is gone - a hand edit can no longer clear its own mark');
  const mtEnd = SRC.indexOf('function colourControl', sbEnd);
  ok(mtEnd > sbEnd, 'the control builders moved - the badge lift lost its end anchor');
  const badgeSrc = SRC.slice(sb0, mtEnd);
  const mkBadge = function () { return { textContent: '', style: {} }; };
  const badges = { skin: mkBadge(), hair: mkBadge(), cap: mkBadge() };
  const env = new Function('lookBadges', 'lookMarks', 'manualNow',
    'var lastGot = [], lastAi = [];\n' + badgeSrc +
    '\nreturn { set: setLookBadges, touch: lookManualTouch };')(
    badges, { skin: 'from your last photo — retake or adjust' }, {});
  env.set([], []);
  eq(badges.skin.textContent, 'from your last photo — retake or adjust',
    'BADGES: the stale mark does not render - a refused read leaves the stale value unmarked, ' +
    'which is the owner\'s screenshot');
  eq(badges.skin.style.background, '#fdf1dc', 'BADGES: the stale mark is not amber');
  eq(badges.hair.textContent, 'your setting', 'BADGES: an unmarked knob lost its baseline state');
  env.set(['skin'], []);
  eq(badges.skin.textContent, 'from your photo',
    'BADGES: a fresh claim does not outrank the stale mark - a good match would still read stale');
  env.touch('skin');
  eq(badges.skin.textContent, 'your setting',
    'BADGES: a hand edit does not clear the mark and repaint - the doctor cannot dig out of amber');

  /* WIRING pins, in the shipped bytes */
  ok(SRC.indexOf("lookNote.id = 'mlsAvLookNote'") >= 0, 'the note lost its id');
  const say = SRC.slice(SRC.indexOf('function lookNoteSay'), SRC.indexOf('function lookNoteCalm'));
  ok(/font:700 13\.5px/.test(say) && /#7a1f1f/.test(say) && /#fdecec/.test(say),
    'LOUD: the refusal style is no longer measurably louder than the pale meta line (font:700, ' +
    'dark red on a red-tinted box) - the owner barely saw the pale one');
  ok(SRC.indexOf("lookMarks[sk] = 'from your last photo \\u2014 retake or adjust';") >= 0,
    'the whole-read refusal no longer marks the stale controls');
  ok(/setLookBadges\(\[\], \[\]\);\s*\n\s*lookNoteSay\(whyNoFace/.test(SRC),
    'the whole-read refusal no longer repaints the badges before speaking, or no longer routes ' +
    'through the loud note');
  ok(SRC.indexOf('lookNoteSay(whyNoFace') >= 0 && /lookNoteSay\(whyNoFace[^;]+, 2\);/.test(SRC),
    'the whole-read refusal is not at level 2 (LOUD)');
  ok(SRC.indexOf("make('button', 'mlsAvAction', 'Clear the derived look')") >= 0 &&
     SRC.indexOf("clearLookBtn.id = 'mlsAvClearDerived'") >= 0 &&
     SRC.indexOf('faceClearDerived(lookNow, manualNow)') >= 0 &&
     SRC.indexOf('lookActions.appendChild(matchBtn); lookActions.appendChild(clearLookBtn); lookActions.appendChild(moodBtn);') >= 0,
    'the one-click Clear-the-derived-look reset is missing, unwired, or unmounted');
  ok(SRC.indexOf('lookNow = faceApplyDerived(lookNow, res);') >= 0,
    'Setup no longer merges through the shared applier');
  ok(SRC.indexOf('merged[k] = (got.indexOf(k) >= 0') < 0,
    'the hand-rolled Setup merge is back beside the shared applier - two implementations drift');
  ok(BASE.indexOf('merged[k] = (got.indexOf(k) >= 0') >= 0,
    'CONTROL FAILED: the pre-fix bytes do not contain the hand-rolled merge this pin bans');
  ok(SRC.indexOf('makeFace(lookStage, lookQuarantine.length ? faceLookSafe(FACE_LOOK) : lookNow)') >= 0,
    'a quarantined saved look renders straight into the preview again (root cause 4)');
  ok(SRC.indexOf('quarantineShow(lookQuarantine)') >= 0 && SRC.indexOf("box.id = 'mlsAvLookQuarantine'") >= 0,
    'the quarantine banner is gone');
  ok(SRC.indexOf('window.__mlsAvatar.lastMatchReceipt = { at: Date.now(), usedHi: usedHi, wholeReadRefusal: true') >= 0 &&
     SRC.indexOf('window.__mlsAvatar.lastMatchReceipt = { at: Date.now(), usedHi: usedHi, wholeReadRefusal: false') >= 0,
    'the Match receipt is no longer published for diagnosis (refusal or success side missing)');
}

/* ═══ C6: the vision input guard (P9-lite) and output gate wiring ══════════ */
{
  ok(SRC.indexOf('faceVisionClaimGate(k, vl[k])') >= 0,
    'the vision output gate is not consulted where model claims are applied');
  const at = SRC.indexOf('if (rct && rct.fromIllustration) {');
  ok(at >= 0, 'the vision input guard (never show the model the illustration) is gone');
  const after = SRC.slice(at, at + 1400);
  ok(/} else \{[\s\S]{0,700}applyVision\(got, pixNote, pixLoud\);/.test(after),
    'applyVision is no longer lexically inside the non-illustration branch - the model can be ' +
    'shown the copy the pixel path just refused (Mechanism C)');
  ok(SRC.indexOf('applyVision(got, pixNote);') < 0,
    'an ungated applyVision call site is back');
  /* the count reaches the doctor */
  ok(/Matched ' \+ rct\.claimed \+ ' of ' \+ rct\.examined \+ ', refused ' \+ rct\.refused/.test(SRC),
    'the note no longer carries the counted receipt - "it did nothing" and "it refused 9 and ' +
    'told you" collapse back into one fact');
}

console.log('face-refusal-quarantines-the-stale-look: ' + pass + ' assertions passed ' +
  '(work + pre-fix control ' + BASE_COMMIT.slice(0, 8) + '; T1/T8/posterized/no-face executed on both)');
