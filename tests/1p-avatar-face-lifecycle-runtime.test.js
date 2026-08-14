'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, '1p-feat_mls_avatar.js'), 'utf8');
const studioSource = fs.readFileSync(path.join(root, '1p-feat_mls_avatar_face.js'), 'utf8');
let passed = 0;
function ok(value, message) { assert.ok(value, message); passed++; }
function eq(actual, expected, message) { assert.strictEqual(actual, expected, message); passed++; }
function between(src, first, last) {
  const a = src.indexOf(first), b = src.indexOf(last, a);
  if (a < 0 || b <= a) throw new Error('missing source boundary: ' + first);
  return src.slice(a, b);
}
const safe = (fn, fallback) => { try { return fn(); } catch (_) { return fallback; } };

/* Camera cancellation is executable: cancel stops the adopted stream, makes
   its generation stale, and a permission grant from that old generation is
   stopped instead of becoming the new owner. */
const camera = new Function('safe', between(source, 'var cameraStream = null', '/* ---- THE PHOTO') +
  '\nreturn {begin:beginFaceCapture,cancel:cancelFaceCapture,current:faceCaptureIsCurrent,adopt:faceCaptureAdopt};')(safe);
const host = { isConnected: true };
let stopped = 0;
const stream = { getTracks() { return [{ stop() { stopped++; } }]; } };
const gen = camera.begin();
eq(camera.current(gen, host), true, 'new camera generation is not current');
eq(camera.adopt(stream, gen, host), true, 'current camera grant was refused');
camera.cancel();
eq(stopped, 1, 'cancel did not synchronously stop the adopted camera');
eq(camera.current(gen, host), false, 'cancelled generation remains current');
let lateStopped = 0;
const lateStream = { getTracks() { return [{ stop() { lateStopped++; } }]; } };
eq(camera.adopt(lateStream, gen, host), false, 'late permission grant became camera owner');
eq(lateStopped, 1, 'late permission grant tracks were not immediately stopped');

/* A best-of-six timer must go inert after cancellation and never invoke the
   persistence callback. The same extracted implementation also proves the
   ordinary active path still completes once. */
const queued = [];
let captures = 0;
const grab = new Function('captureSquare', 'frameQuality', 'faceReadPortrait', 'faceCaptureVerdict', 'safe', 'setTimeout',
  'var MEASURE_MAX=1024;\n' + between(source, 'function grabBestFrame', '/* ---- LIVE CAPTURE VIEW') + '\nreturn grabBestFrame;')(
    () => { captures++; return {}; },
    () => ({ sharp: 4, exposure: 130 }),
    () => ({ look: { skin: '#f0c8a0' }, derived: ['skin'], receipt: { faceW: 100, grid: 256, claimed: 5 } }),
    () => ({ ready: true, why: '', score: 100 }), safe,
    fn => { queued.push(fn); return queued.length; });
let active = true, delivered = 0;
grab({}, 3, () => active, () => { delivered++; });
eq(captures, 1, 'best-of-six did not take its first active frame');
active = false;
queued.shift()();
eq(captures, 1, 'cancelled best-of-six captured another frame');
eq(delivered, 0, 'cancelled best-of-six invoked late persistence callback');
active = true; queued.length = 0; captures = 0;
grab({}, 2, () => active, () => { delivered++; });
while (queued.length) queued.shift()();
eq(captures, 2, 'active best-of-six no longer takes the requested frames');
eq(delivered, 1, 'active best-of-six does not complete exactly once');

/* The full-resolution cache is associated with one exact accepted portrait. */
const store = new Map();
const localStorage = {
  setItem(k, v) { store.set(k, String(v)); },
  getItem(k) { return store.has(k) ? store.get(k) : null; },
  removeItem(k) { store.delete(k); }
};
const cache = new Function('safe', 'window', 'localStorage', 'isFn', 'faceValidPhoto',
  between(source, 'var FACE_HI_KEY', 'function facePreviewNode') +
  '\nreturn {commit:faceHiCommit,read:faceHiRead,clear:faceHiClear,forShown:faceHiForShown,matches:facePhotoMatches};')(
    safe, { uns(k) { return 'acct:' + k; } }, localStorage, v => typeof v === 'function',
    v => !!(v && String(v).indexOf('data:image/') === 0));
const portraitA = 'data:image/jpeg;base64,PORTRAIT-A';
const portraitB = 'data:image/jpeg;base64,PORTRAIT-B';
const hiA = 'data:image/jpeg;base64,FULL-RES-A';
eq(cache.commit(hiA, portraitA), true, 'accepted portrait/full-resolution transaction did not commit');
eq(cache.read(portraitA), hiA, 'matching accepted portrait cannot read its full-resolution copy');
eq(cache.read(portraitB), '', 'different portrait can read stale full-resolution bytes');
eq(store.size, 0, 'mismatched saved portrait did not discard abandoned full-resolution bytes');
eq(cache.forShown(hiA, portraitA, portraitB), '', 'pending bytes can be measured against a different shown portrait');
eq(cache.forShown(hiA, portraitA, portraitA), hiA, 'matching pending capture is unavailable before Save');
cache.clear();
eq(store.size, 0, 'Remove did not clear the committed portrait cache');
store.set('acct:mlsAvFaceMeasureV1', hiA);
eq(cache.read(portraitA), '', 'legacy unassociated cache is still trusted');
eq(store.size, 0, 'legacy unassociated cache was not retired');

/* The exact production ownership guard executes both late-Save races. A
   server may already have accepted A, but its callback cannot resurrect A
   after Remove or clobber a newer captured B in the still-open form. */
const saveApply = new Function(
  between(source, 'function faceSaveApplyIfCurrent', '/* ---- setup tab') +
  '\nreturn faceSaveApplyIfCurrent;')();
const saveHost = { isConnected: true, __mlsAvatarSetupEpoch: 41 };
let faceGeneration = 1, pendingFace = portraitA, pendingHi = hiA, patientPreview = portraitA;
const saveAGeneration = faceGeneration;
cache.commit(hiA, portraitA);                  // the previously accepted state
faceGeneration++;                             // Remove while Save A is pending
pendingFace = ''; pendingHi = ''; patientPreview = 'removed'; cache.clear();
let lateApplied = 0;
eq(saveApply(saveAGeneration, faceGeneration, saveHost, 41, () => {
  lateApplied++; cache.commit(hiA, portraitA);
  pendingFace = undefined; pendingHi = ''; patientPreview = portraitA;
}), false, 'late Save A still owns the form after Remove');
eq(lateApplied, 0, 'late Save A ran its local commit after Remove');
eq(store.size, 0, 'late Save A resurrected cache bytes after Remove');
eq(pendingFace, '', 'late Save A erased the pending removal intent');
eq(patientPreview, 'removed', 'late Save A repainted the removed portrait');

const portraitBNew = 'data:image/jpeg;base64,PORTRAIT-B-NEW';
const hiB = 'data:image/jpeg;base64,FULL-RES-B';
faceGeneration = 7; pendingFace = portraitA; pendingHi = hiA; patientPreview = portraitA;
const saveAThenBGeneration = faceGeneration;
faceGeneration++;                             // Capture B completes while A is pending
pendingFace = portraitBNew; pendingHi = hiB; patientPreview = portraitBNew;
eq(saveApply(saveAThenBGeneration, faceGeneration, saveHost, 41, () => {
  lateApplied++; cache.commit(hiA, portraitA);
  pendingFace = undefined; pendingHi = ''; patientPreview = portraitA;
}), false, 'late Save A still owns the form after capture B');
eq(pendingFace, portraitBNew, 'late Save A erased pending capture B');
eq(pendingHi, hiB, 'late Save A erased capture B full-resolution bytes');
eq(patientPreview, portraitBNew, 'late Save A repainted over capture B');
eq(store.size, 0, 'late Save A committed cache behind capture B');

let currentApplied = 0;
eq(saveApply(faceGeneration, faceGeneration, saveHost, 41, () => { currentApplied++; }), true,
  'current Save cannot apply its authoritative response');
eq(currentApplied, 1, 'current Save did not apply exactly once');

const removeSlice = between(source, "removeFaceBtn.addEventListener('click'", "camBtn.addEventListener('click'");
ok(/faceMutated\(\)[\s\S]*cancelFaceCapture\(\)[\s\S]*pendingHiUrl = ''[\s\S]*faceHiClear\(\)/.test(removeSlice), 'Remove does not supersede Save, cancel capture, and clear pending/committed bytes');
/* p1-photo-upload-1.0.0 moved the shared half of the shutter into
   acceptPortrait, which the camera and the file picker both call. The
   fencing rules below did not change and are pinned where they now live:
   the camera slice must still open and hand its OWN generation fence in,
   and the accept path must re-prove that fence on both sides of the encode
   before it touches pendingFace. */
const captureSlice = between(source, "camBtn.addEventListener('click'", 'faceRow.appendChild(facePreview)');
const acceptSlice = between(source, 'function acceptPortrait(opts)', "camBtn.addEventListener('click'");
ok(captureSlice.includes('faceCaptureAdopt(stream, captureGeneration, camHost)'), 'late permission grant is not generation-gated');
ok(/grabBestFrame\(video, 6,[\s\S]*acceptPortrait\(\{[\s\S]*source: 'camera'[\s\S]*faceCaptureIsCurrent\(captureGeneration, camHost\)/.test(captureSlice),
  'the shutter no longer hands the accept path its own capture generation');
ok(/if \(!still\(\)\) return;[\s\S]*faceMutated\(\);\n\s*pendingFace = dataUrl;/.test(acceptSlice),
  'late best-of-six callback can persist after cancellation');
ok(!/faceHiCommit|localStorage\.setItem/.test(captureSlice + acceptSlice), 'shutter click writes full-resolution bytes before Save');
ok(/still\(\) && matchBtn && matchBtn\.isConnected/.test(acceptSlice), 'detached auto-match button can run after close');
ok(/faceMutated\(\)[\s\S]*pendingFace = dataUrl/.test(acceptSlice), 'completed capture does not supersede an older Save');
/* Every portrait source goes through the one accept path — a second copy of
   it is how the auto-match went missing for eleven builds. */
const uploadSlice = between(source, "uploadInput.addEventListener('change'", 'faceRow.appendChild(facePreview)');
ok(/beginFaceCapture\(\)/.test(uploadSlice) && /faceCaptureIsCurrent\(uploadGeneration, camHost\)/.test(uploadSlice),
  'an uploaded portrait is not fenced by a capture generation');
ok(/acceptPortrait\(\{[\s\S]*source: 'upload'/.test(uploadSlice), 'the upload path does not use the shared accept contract');
ok(!/pendingFace = /.test(uploadSlice), 'the upload path writes the pending portrait behind the shared accept path');
ok(/pendingHiKind === 'upload'/.test(source) && /trustedNaturalPhoto = usedHi === true &&/.test(source),
  'an uploaded image inherits the camera copy’s licence to be trusted as a natural photograph');
const saveSlice = between(source, "saveBtn.addEventListener('click'", '/* av-5.3.0 — the typed rehearsal log');
ok(/r2\.ok && r2\.json && r2\.json\.ok[\s\S]*facePhotoMatches\(saved\.faceImage, sentPhoto\)[\s\S]*faceHiCommit/.test(saveSlice), 'full-resolution cache is not committed behind authoritative exact-photo Save');
const saveGuardAt = saveSlice.indexOf('faceSaveApplyIfCurrent(sentFaceGeneration');
const saveCommitAt = saveSlice.indexOf('faceHiCommit(sentHi', saveGuardAt);
const saveResetAt = saveSlice.indexOf('pendingFace = undefined', saveCommitAt);
const staleReturnAt = saveSlice.indexOf('if (!faceSaveCurrent)', saveResetAt);
ok(saveSlice.includes('sentFaceGeneration = faceMutationGeneration') && saveGuardAt >= 0 &&
  saveCommitAt > saveGuardAt && saveResetAt > saveCommitAt && staleReturnAt > saveResetAt,
  'late Save is not generation-gated around cache and pending-state commit');
ok(/if \(saveBtn\.disabled\) return/.test(saveSlice), 'Save handler permits request reentry');
const modeSlice = between(source, "faceModeSelect.addEventListener('change'", 'var lookBadges');
ok(modeSlice.includes('faceMutated()'), 'face mode change does not supersede an older Save');
const manualSlice = between(source, 'function lookManualTouch', 'function colourControl');
ok(manualSlice.includes('faceMutated()'), 'manual appearance edit does not supersede an older Save');

/* Form cleanup itself is executable, then lifecycle call sites are pinned. */
let cleanups = 0;
const setupLifecycle = new Function('safe', between(source, 'var avatarSetupEpoch', '/* ---- setup tab') +
  '\nreturn {discard:discardAvatarSetup,discardAll:discardAvatarSetups};')(safe);
const formHost = { innerHTML: 'form', attrs: { setup: true }, __mlsAvatarSetupCleanup() { cleanups++; },
  removeAttribute(k) { delete this.attrs[k]; } };
setupLifecycle.discard(formHost, true);
eq(cleanups, 1, 'Setup close did not invoke its timer/memory cleanup owner');
eq(formHost.innerHTML, '', 'Setup close retained the hidden form');
eq(formHost.__mlsAvatarSetupCleanup, null, 'Setup cleanup closure remains retained');
const settingsClose = between(source, 'function onSettingsReconciled', '/* ---- mount (event-driven');
ok(/if \(!open\)[\s\S]*cancelFaceCapture\(\)[\s\S]*pvStopVoice\(\)[\s\S]*mountAvatarSettings\(open\)/.test(settingsClose), 'Settings close does not synchronously release camera and voice');
const panelClose = between(source, 'function close()', 'function onKey');
ok(/pvStopVoice\(\)[\s\S]*cancelFaceCapture\(\)[\s\S]*discardAvatarSetups/.test(panelClose), 'panel close does not release voice, camera, and form closure');

/* Detached cosmetic forms must release listeners, rows and polling closures. */
const cleared = [];
const prune = new Function('clearTimeout',
  'var removed=0,timers=[11,12],enhanced=[{stage:{isConnected:false}},{stage:{isConnected:true}}],' +
  'eventRows=[[{isConnected:false,removeEventListener:function(){removed++;}},"x",function(){}],' +
  '[{isConnected:true,removeEventListener:function(){removed++;}},"y",function(){}]];\n' +
  between(studioSource, 'function clearPollTimers', 'function summarizeReceipt') +
  '\npruneDetached();return {timers:timers.length,enhanced:enhanced.length,events:eventRows.length,removed:removed};')(
    id => cleared.push(id));
eq(prune.enhanced, 1, 'studio retains detached Setup rows');
eq(prune.events, 1, 'studio retains detached Setup listeners');
eq(prune.removed, 1, 'studio did not unbind detached listener');
eq(prune.timers, 0, 'studio retains a detached receipt poll');
eq(cleared.length, 2, 'studio did not cancel every bounded detached poll timer');

console.log('PASS 1p avatar face lifecycle: ' + passed + ' assertions');
