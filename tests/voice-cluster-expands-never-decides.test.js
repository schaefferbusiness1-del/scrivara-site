'use strict';

/* vc-2.0.0 — THE BOTTOM-LEFT BUBBLES ARE RETIRED (owner, 2026-07-26:
 * "REMOVE THE BOTTOM LEFT BUBBLES").
 *
 * HISTORY OF THIS FILE, because its name still says "expands never decides":
 * vc-1.0.0 merged three floating pills into one expanding bubble, and this
 * suite pinned the properties that kept that merge honest (no recognizer
 * ownership, no guessing which tool was meant). The bubble then ate clicks in
 * its closed state (b658) and sat exactly where the review control comes to
 * rest, making the last human gate before Athena unreachable by mouse (b669).
 * The owner retired the whole floating layer. The suite now pins THAT — and
 * the same safety intent survives translated: the module must own no
 * recognizer behaviour and must not silently remove the three tools.
 *
 * What must stay true:
 *   1. The module BUILDS NOTHING — no cluster root, no face, no fan.
 *   2. The three pills are hidden BY CLASS, never inline. available() reads
 *      inline display, so a class-hide keeps all three reachable from the
 *      Calm Shell's Tools menu; an inline hide silently removes three
 *      features (the documented defect class).
 *   3. It still owns no recognizer behaviour (the one-recognizer truce in
 *      mls-connect.js F11 is not this module's to touch).
 *   4. revert() exists — one call restores the originals at runtime.
 *   5. The in-visit chips and the dock remain the canonical routes; the
 *      module documents them so the reach story is auditable.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'feat_mls_voice_cluster.js'), 'utf8');
const code = src.replace(/\/\*[\s\S]*?\*\//g, '');  /* prose names things code must not do */

/* ---- 1. it builds nothing ---- */
assert.ok(!/createElement\(\s*['"](?:button|div)['"]\s*\)[\s\S]{0,200}?(?:mlsVcFace|mlsVcFan)/.test(code) &&
          !/mlsVcFace|mlsVcFan/.test(code),
  'the cluster face/fan is being built again. The floating bubble was retired by ' +
  'the owner on 2026-07-26 after it ate clicks (b658) and covered the review ' +
  'control (b669). If it is coming back, that is an owner decision — and the ' +
  'b669 clearance list (REVIEW_FIXED_FURNITURE) must be re-armed with it.');
assert.ok(!/appendChild[\s\S]{0,80}?ROOT_ID|innerHTML\s*=/.test(code.replace(/s\.textContent/g, '')) ||
          !/position\s*:\s*fixed/.test(code),
  'the module positions something fixed on the page again — it must render nothing');

/* ---- 2. class-hide, never inline ---- */
['mlsCopVoiceBtn', 'mlsAsstFab', 'mlsDaDock'].forEach((id) => {
  assert.ok(src.includes('#' + id), 'the class-hide for #' + id + ' is gone — the pill would float again');
});
assert.ok(/body\.mls-voice-cluster #mlsCopVoiceBtn/.test(src.replace(/'\s*\+\s*/g, '').replace(/\s*\+\s*'/g, '').replace(/html body\./g, 'body.').replace(/' \+ BODY_ON \+ '/g, 'mls-voice-cluster')) ||
          /BODY_ON \+ ' #mlsCopVoiceBtn/.test(src),
  'the hide must be keyed on the body class, so removing the class restores everything');
assert.ok(!/\.style\.display\s*=/.test(code),
  'an inline display write appeared. available() tests inline display; an inline hide ' +
  'silently removes the three tools from the Tools menu — hide by class only.');

/* ---- 3. no recognizer behaviour, same as vc-1.0.0 ---- */
[['SpeechRecognition', 'must never construct a recognizer'],
 ['webkitSpeechRecognition', 'must never construct a recognizer'],
 ['getUserMedia', 'must never request the mic'],
 ['MediaRecorder', 'must never record'],
 ['.start()', 'must never start a recognizer'],
 ['.click()', 'a retired module must not click anything either']].forEach(([needle, why]) => {
  assert.ok(!code.includes(needle), 'feat_mls_voice_cluster.js ' + why + ' (found ' + needle + ')');
});

/* ---- 4. revert survives ---- */
assert.ok(/revert\s*:\s*function/.test(src) && /classList\.remove\(BODY_ON\)/.test(src),
  'revert() must restore the originals by removing the body class');
assert.ok(/retired\s*:\s*true/.test(src), 'the module must declare itself retired');

/* ---- 5. the reach story stays auditable ---- */
['ez3flCopilotVoice', 'ez3flAssistant', 'ez3flDictate', 'copilotMicBtn'].forEach((route) => {
  assert.ok(src.includes(route),
    'the module no longer documents route ' + route + '. The retirement is safe ONLY ' +
    'because every capability has a named surviving surface; keep the map current.');
});

/* ---- 6. the guard can fail ---- */
{
  const rebuilt = "var f=document.createElement('button');f.id='mlsVcFace';root.appendChild(f);";
  assert.ok(/mlsVcFace/.test(rebuilt), 'detector 1 cannot see a rebuilt face');
  const inlineHide = "document.getElementById('mlsAsstFab').style.display='none';";
  assert.ok(/\.style\.display\s*=/.test(inlineHide), 'detector 2 cannot see an inline hide');
}

console.log('PASS voice-cluster retired: builds nothing, class-hides three pills with routes preserved, owns no recognizer, revert() intact');
