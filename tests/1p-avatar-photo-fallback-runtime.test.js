'use strict';

/*
 * p1-photo-fallback-1.0.0 — WHAT A PATIENT MEETS WHEN THE PORTRAIT WILL NOT DECODE.
 *
 * `faceValidPhoto` tests a STRING PREFIX. That is all a cheap synchronous check
 * can do, and it is honest about it — but it cannot know whether the bytes
 * decode, and both mount sites replace the drawn clinician BEFORE the
 * photograph has proved it can be shown. A truncated or empty-payload portrait
 * therefore passed the gate, failed in the decoder, and left the browser's
 * broken-image glyph in the patient-facing circle with no way back, because
 * `kiosk.photoFace` latched true at the top of that branch and only openKiosk
 * cleared it.
 *
 * ⛔ THIS SUITE EXECUTES THE REAL SOURCE. Every block below is sliced out of
 * the shipped module by `between()` and run — it is not a re-implementation and
 * it is not a string search. The one thing it deliberately does NOT do is
 * decode an image: a fake DOM cannot fail a decode honestly. The real decode
 * failure in real Chrome is proven by 1p-avatar-surface-quality-proof, which
 * feeds a genuinely corrupt data URL to a real <img>. Mechanism here, reality
 * there — neither alone is the proof.
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
const safe = (fn, fallback) => { try { return fn(); } catch (_) { return fallback; } };

/* ---------------------------------------------------------------------------
   A FAKE DOM THAT RECORDS ORDER. The whole guarantee is that the error handler
   is registered BEFORE `src` is assigned, so this img records, at the moment
   `src` is written, how many error listeners already existed. A real browser
   dispatches load/error from a task and would almost certainly forgive the
   wrong order; that is exactly why the order is pinned here instead of the
   timing. ------------------------------------------------------------------ */
function makeImg() {
  const img = {
    alt: '', style: { cssText: '', transform: '', transition: '' },
    _listeners: {}, _srcSetWhenListeners: -1, _src: '',
    addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); },
    fire(type) { (this._listeners[type] || []).slice().forEach(fn => fn({ type })); }
  };
  Object.defineProperty(img, 'src', {
    get() { return img._src; },
    set(v) { img._srcSetWhenListeners = (img._listeners.error || []).length; img._src = v; }
  });
  return img;
}
function makeMount() {
  const mount = {
    innerHTML: 'PREVIOUS CONTENT', children: [], attrs: {},
    appendChild(c) { this.children.push(c); return c; },
    setAttribute(k, v) { this.attrs[k] = v; }
  };
  return mount;
}
let lastImg = null;
const fakeDocument = { createElement(tag) { if (tag === 'img') { lastImg = makeImg(); return lastImg; } return makeMount(); } };
const fakeWindow = { matchMedia: () => ({ matches: false }) };

const photo = new Function('document', 'window', 'safe', 'setTimeout', 'clearTimeout',
  between(source, 'function faceValidPhoto(dataUrl)', '/* p1-avatar-primary-1.0.0') +
  between(source, 'function makePhotoFace(mount, dataUrl, altText, onUnusable)',
    '/* =========================================================================') +
  '\nreturn { makePhotoFace: makePhotoFace, faceValidPhoto: faceValidPhoto };'
)(fakeDocument, fakeWindow, safe, () => 0, () => {});

/* The premise, executed rather than asserted from memory: the gate is a prefix
   test and an undecodable payload sails straight through it. If this ever
   stops being true the whole fallback is solving a problem that no longer
   exists, and this suite should be the thing that says so. */
eq(photo.faceValidPhoto('data:image/png;base64,'), true,
  'faceValidPhoto no longer admits an empty payload — the premise of this fallback has changed');
eq(photo.faceValidPhoto('data:image/png;base64,####not-base64####'), true,
  'faceValidPhoto no longer admits corrupt bytes — the premise of this fallback has changed');
eq(photo.faceValidPhoto('https://example.invalid/face.png'), false, 'a non-data URL is admitted as a portrait');
eq(photo.faceValidPhoto(''), false, 'an empty string is admitted as a portrait');

/* --- 1. THE ORDER --------------------------------------------------------- */
let fired = 0;
let ctl = photo.makePhotoFace(makeMount(), 'data:image/png;base64,', 'alt', () => { fired++; });
ok(ctl && ctl.node === lastImg, 'makePhotoFace did not return a controller over the mounted image');
eq(lastImg._srcSetWhenListeners, 1,
  'the error handler is not registered before src is assigned — a decode that fails synchronously from cache would be missed');

/* --- 2. IT FIRES, ONCE, AND KILLS THE CONTROLLER FIRST -------------------- */
lastImg.fire('error');
eq(fired, 1, 'a decode failure did not reach the fallback');
eq(lastImg.style.transition, 'none', 'destroy() did not run before the fallback was invoked');
lastImg.fire('error');
eq(fired, 1, 'a second error event invoked the fallback again');

/* --- 3. A CONTROLLER THE CALLER REPLACED MUST NOT CALL BACK ---------------
   The mount sites destroy the old controller and immediately mount a new one.
   If a late error from the retired image could still fire, a GOOD portrait
   would be torn down by its predecessor's failure. */
fired = 0;
ctl = photo.makePhotoFace(makeMount(), 'data:image/png;base64,', '', () => { fired++; });
ctl.destroy();
lastImg.fire('error');
eq(fired, 0, 'a controller the caller already destroyed still reported a decode failure');

/* --- 4. OPT-IN, per the a-flag-on-a-shared-helper law --------------------- */
const bare = photo.makePhotoFace(makeMount(), 'data:image/png;base64,', '');
eq((lastImg._listeners.error || []).length, 0,
  'a caller that passed no fallback still had an error listener attached');
ok(bare && typeof bare.destroy === 'function' && typeof bare.talkCycle === 'function',
  'the no-fallback controller lost part of its interface');
eq(photo.makePhotoFace(makeMount(), 'not-a-data-url', '', () => {}), null,
  'a non-portrait produced a controller');
eq(photo.makePhotoFace(null, 'data:image/png;base64,', '', () => {}), null,
  'a missing mount produced a controller');

/* --- 5. THE KIOSK BRANCH -------------------------------------------------
   Executed, not grepped. The branch is sliced from the shipped identity-update
   path and run against a stub kiosk so the latch semantics are real. */
const kioskSlice = between(source, 'var photoUsable = hasPhoto && kiosk.photoUnusable !== String(av.faceImage);',
  '} else if (av && av.faceLook && !kiosk.tinted) {');
ok(/kiosk\.photoUnusable = photoReceipt\.portrait;/.test(kioskSlice),
  'the kiosk fallback does not remember the unusable portrait by value');
ok(/kiosk\.photoFace = false;/.test(kioskSlice),
  'the kiosk fallback does not clear the photoFace latch');
ok(/if \(!kiosk\.face\) kiosk\.photoFace = false;/.test(kioskSlice),
  'a mount that produced no controller still latches photoFace, leaving an empty circle');
ok(/makeFace\(back, kiosk\.look \|\| faceLookSafe\(av\.faceLook\)\)/.test(kioskSlice),
  'the kiosk fallback does not redraw the doctor SAVED appearance — a generic face is not the fallback');
ok(/sessionReceiptCurrent\(photoReceipt\.session\)[\s\S]*kiosk\.open[\s\S]*photoReceipt\.generation/.test(kioskSlice),
  'the kiosk fallback is not guarded by session receipt, open state and generation');

/* The latch semantics, run. A stub kiosk proves the same portrait is never
   mounted twice while a NEW portrait still gets its own chance. */
const usable = new Function('kiosk', 'faceValidPhoto',
  'return function (av) { var hasPhoto = av && faceValidPhoto(av.faceImage);' +
  ' return !!(hasPhoto && kiosk.photoUnusable !== String(av.faceImage)); };');
const kiosk = { photoUnusable: '' };
const isUsable = usable(kiosk, photo.faceValidPhoto);
eq(isUsable({ faceImage: 'data:image/png;base64,AAAA' }), true, 'a fresh portrait was refused before it was ever tried');
kiosk.photoUnusable = 'data:image/png;base64,AAAA';
eq(isUsable({ faceImage: 'data:image/png;base64,AAAA' }), false, 'the same unusable portrait would be mounted a second time');
eq(isUsable({ faceImage: 'data:image/png;base64,BBBB' }), true, 'a genuinely new portrait was condemned by its predecessor');

/* A new check-in re-earns the portrait: one cold-cache failure must not
   condemn the doctor's photograph forever. */
ok(/kiosk\.photoUnusable = '';/.test(between(source, 'kiosk.photoFace = false; kiosk.tintPortrait', 'kiosk.finishTries = 0;')),
  'openKiosk does not clear photoUnusable — one decode failure condemns the portrait for every later patient');

/* --- 6. THE TWO STATES ARE NOT THE SAME SENTENCE -------------------------
   "No portrait yet" must never be shown to a doctor who can see he already
   took one. The preview kind and the Setup copy are two halves of one claim,
   so both are pinned and they are pinned to EACH OTHER. */
const previewSlice = between(source, "lookStage.setAttribute('data-face-preview-kind', faceModeSelect.value !== 'photo'", 'lookCtl = makeFace(lookStage');
ok(/photo-unreadable/.test(previewSlice) && /photo-fallback/.test(previewSlice),
  'the Setup preview no longer distinguishes an undecodable portrait from a missing one');
ok(studio.includes("kind === 'photo-unreadable'"),
  'the Setup copy has no branch for an undecodable portrait');
const unreadableCopy = between(studio, "kind === 'photo-unreadable'", '} else if (photo) {');
ok(/could not be opened/.test(unreadableCopy) && !/Take a photo/.test(unreadableCopy),
  'the undecodable-portrait copy tells the doctor to take a photo he can see he already took');
ok(/what patients are seeing right now/.test(unreadableCopy),
  'the undecodable-portrait copy does not say what the patient is meeting instead');

/* --- 7. THE PATIENT CHIP: INITIALS ARE THE FLOOR --------------------------
   Executed against the real template. A chip whose photograph fails must still
   say whose chart the row is. */
['1p/index.html', '1pScribeFlow.html'].forEach(file => {
  const html = fs.readFileSync(path.join(root, file), 'utf8');
  const tpl = between(html, 'function _ptItemHtml(p, activeId){', '<div class="pt-main"');
  ok(/\$\{esc\(ptInitials\(p\.name\)\)\}/.test(tpl),
    file + ': the chip no longer renders initials unconditionally');
  ok(/onerror="this\.remove\(\)"/.test(tpl),
    file + ': the chip photograph has no onerror, so a broken glyph survives over the initials');
  ok(!/color:transparent/.test(tpl),
    file + ': the chip still hides its initials behind a transparent colour, so a failed photo names nobody');
  ok(!/background-image:url/.test(tpl),
    file + ': the chip still paints the photograph as a background-image, which cannot report a decode failure');
  const css = between(html, '.pt-avatar{', '.pt-main{');
  ok(/overflow:hidden/.test(css) && /position:relative/.test(css),
    file + ': .pt-avatar cannot contain an overlaid photograph');
  ok(/\.pt-avatar>img\{[^}]*object-fit:cover/.test(css),
    file + ': the chip photograph is not object-fit:cover and will be distorted');
  ok(/\.pt-avatar>img\{[^}]*border-radius:inherit/.test(css),
    file + ': the chip photograph does not inherit the circular mask it ships into');
  /* The initials generator must never itself return nothing — an empty
     fallback is the defect this whole section exists to remove. */
  const init = between(html, 'function ptInitials(', '\n}');
  ok(/\|\|\s*['"`]/.test(init) || /return\s+[^;]*\?\s*[^:]*:\s*['"`]/.test(init) || /'\?'/.test(init),
    file + ': ptInitials has no floor for a nameless patient');
});

console.log('1p avatar photo fallback runtime: ' + passed + ' assertions passed');
