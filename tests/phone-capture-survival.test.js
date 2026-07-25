'use strict';
/* phone-capture-survival — ph-wake-1.0.0 / ph-mic-1.0.0 (2026-07-25)
 *
 * WHY THIS EXISTS
 * At b621 the signed-in app could not survive a screen sleep on a phone.
 * Measured across ScribeFlow.html and mls-connect.js: `wakeLock` appeared 0
 * times and `visibilitychange` appeared 0 times. The visit recorder is Web
 * Speech only, so when a phone screen sleeps the recognizer is torn down and
 * dictation stops SILENTLY while the UI still reads "recording". For a
 * dictation-first product used at the bedside that is the difference between a
 * phone that can take a visit and one that cannot.
 *
 * phone.html had solved this already (screen wake lock + a visibilitychange
 * re-arm) but is a separate, account-less accessory that cannot be started
 * without a computer. The fix ports that proven pattern into the app's own
 * recording path.
 *
 * These are SOURCE assertions on purpose. A wake lock cannot be exercised in
 * headless Chrome (it needs a visible, focused, secure-context page), so a
 * runtime test would either be skipped or, worse, pass vacuously — the exact
 * failure this lane already hit three times with the phone geometry probes.
 * Asserting the wiring is honest about what it proves: that the code is present
 * and correctly shaped, not that the OS granted a lock.
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const backup = read('feat_mls_record_backup.js');
const shell = read('ScribeFlow.html');

/* ---- 1. the wake lock exists and is requested for the screen ---- */
assert(/navigator\.wakeLock\s*&&\s*navigator\.wakeLock\.request/.test(backup),
  'recording path must feature-detect navigator.wakeLock before using it');
assert(/navigator\.wakeLock\.request\(\s*["']screen["']\s*\)/.test(backup),
  'recording path must request a SCREEN wake lock while a visit is being recorded');

/* ---- 2. it is re-acquired on return to visibility ----
   A wake lock is released automatically whenever the page is hidden. Holding a
   reference is not enough; coming back to the foreground must re-request it, or
   the second half of every interrupted visit records without protection. */
assert(/addEventListener\(\s*["']visibilitychange["']/.test(backup),
  'recording path must listen for visibilitychange — a wake lock is auto-released while hidden');
/* Anchor on the CALL, not the first textual occurrence — the prose above the
   code also contains the word "visibilitychange", and matching that would have
   this test grade a comment. */
const visIdx = backup.search(/addEventListener\(\s*["']visibilitychange["']/);
assert(visIdx > 0, 'could not locate the visibilitychange listener call');
const visHandler = backup.slice(visIdx);
assert(/visibilityState\s*!==\s*["']visible["']/.test(visHandler.slice(0, 600)),
  'visibilitychange handler must act on the return to VISIBLE, not on every transition');
assert(/grabWake\(\)/.test(visHandler.slice(0, 800)),
  'returning to visible must RE-REQUEST the wake lock, not assume the old one survived');

/* ---- 3. it is released when not recording ----
   A wake lock held after recording stops drains the battery of a device the
   clinician carries all day. */
assert(/if\s*\(\s*!capturingNow\(\)\s*\)\s*\{\s*dropWake\(\)\s*;\s*return\s*;\s*\}/.test(backup),
  'the sentinel must release the wake lock as soon as capture is no longer running');

/* ---- 4. no new timer was introduced ----
   tests/boot-script-budget.test.js caps setInterval occurrences across every
   root feat_*.js and counts files whether or not the loader pulls them in. The
   wake lock therefore rides the sentinel tick that already exists. */
const intervals = (backup.match(/setInterval\s*\(/g) || []).length;
assert.strictEqual(intervals, 1,
  'feat_mls_record_backup.js must keep exactly its one pre-existing setInterval (found ' +
  intervals + '); the wake lock must ride the existing sentinel tick, not add a timer');

/* ---- 5. the observable API, so behaviour can be checked live ---- */
assert(/wakeHeld\s*:/.test(backup) && /wakeSupported\s*:/.test(backup),
  'wake state must be observable on window.__mlsRecBackup for live verification');

/* ---- 6. the iOS instruction must name a route that EXISTS ----
   Telling an iPhone user to "try Chrome or Edge" is impossible advice: every
   iOS browser is required to use WebKit and none exposes SpeechRecognition.
   The app must detect iOS and point at the keyboard dictation key, which does
   work in the transcript box. Assert the MESSAGE STRING, not merely that some
   iOS branch exists somewhere in the file. */
const warnIdx = shell.indexOf('showMicWarn(_mlsIsIOS');
assert(warnIdx > 0, 'the mic-unsupported warning must branch on iOS');
const warnBlock = shell.slice(warnIdx, warnIdx + 900);
assert(/Chrome and Edge on iOS use the same engine as Safari/.test(warnBlock),
  'the iOS branch must explain WHY switching browsers cannot help');
assert(/🎤/.test(warnBlock) && /keyboard/i.test(warnBlock),
  'the iOS branch must name the keyboard dictation key — a route that actually exists on the device');

const iosMessage = (warnBlock.match(/\?\s*'([^']*)'/) || [, ''])[1];
assert(iosMessage.length > 40, 'could not extract the iOS message for inspection');
assert(!/Try Chrome or Edge/.test(iosMessage),
  'the iOS message must NOT tell an iPhone user to try Chrome or Edge — on iOS they are the same WebKit engine');

console.log('PASS phone capture survival: screen wake lock held while recording, re-armed on return to visibility, released when idle, no new timer, and the iOS mic instruction names a route that exists');
