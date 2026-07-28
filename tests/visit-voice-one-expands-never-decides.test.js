'use strict';

/* ONE in-visit voice control that EXPANDS — never one that DECIDES.
 *
 * Owner, 2026-07-26: "combine these 3 things gradually into 1 amazing thing"
 * (Copilot Voice / MLS Assistant / Dictate, the visit lane's chip row).
 *
 * This is the SECOND time these three have been merged. The first attempt
 * (feat_mls_voice_cluster.js vc-1.0.0, b651) was retired at b676, and its own
 * suite is the reason this one exists: every assertion below is a safety
 * property that was learned the expensive way, not a style preference.
 *
 *   - Copilot Voice (#mlsCopVoiceBtn) and Dictate (#mlsDaDock) are DIFFERENT
 *     recognizers under an explicit one-recognizer truce (mls-connect.js F11).
 *     Silently starting the wrong one mid-encounter is a clinical harm: one
 *     writes into the visit transcript and one does not. The app ships a help
 *     entry whose only job is to say these are three different things. A single
 *     button that GUESSES erases a distinction the product documents.
 *   - The first merge FLOATED. Its closed state ate clicks meant for the page
 *     beneath (b658), and it came to rest exactly where
 *     scrollIntoView({block:'nearest'}) parks the review control — the last
 *     human gate before anything reaches Athena measured 78% unclickable by
 *     mouse at b669. Contract law 5: nothing floats, ever.
 *   - A collapsed control is precisely where "is my mic hot?" gets lost.
 *
 * NEGATIVE-TESTED IN BOTH DIRECTIONS before being trusted (the b669 rule):
 *   - position:fixed added to the root -> FAILS (verified)
 *   - a setInterval added              -> FAILS (verified)
 *   - the tree as shipped              -> PASSES (verified)
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'feat_mls_visit_voice_one.js'), 'utf8');

/* ---- 1. the surviving peers, by name and by canonical id -----------------
 * PREMISE INVERTED 2026-07-26, on the owner's order (relayed verbatim):
 * remove MLS Assistant from this menu — "overlapping too much with Copilot"
 * and "does not work with dictation." The menu is now a DUO. The assistant's
 * capability lives in the dock's Copilot (the b690 unification reads the
 * active visit); its underlying controls keep their class-hide + Tools reach
 * elsewhere. This section now pins BOTH halves: the duo's routes survive,
 * and the assistant does not quietly return as a third option. */

const LANE = ['ez3flCopilotVoice', 'ez3flDictate'];
const ENGINE = ['ez3QVoice', 'ez3QDictate'];
/* 2026-07-28 owner order retired Copilot Voice (#mlsCopVoiceBtn); Dictate
   remains the one canonical voice route the merged chrome must keep. */
const CANON = ['mlsDaDock'];

[].concat(LANE, ENGINE, CANON).forEach((id) => {
  assert.ok(src.includes("'" + id + "'"),
    id + ' is not in the module. Merging the chrome must not drop a route — ' +
    'the lane chip, the engine chip and the canonical pill are three different ' +
    'renderings of the same tool and any of them may be the one on screen.');
});
/* 2026-07-28: 'Copilot Voice' left this list with the feature - the owner
   retired it entirely, so a fan option named for it would be a dead control. */
['Dictate'].forEach((label) => {
  assert.ok(src.includes("label: '" + label + "'"),
    'the option "' + label + '" is gone. The app documents these as ' +
    'different things; the fan must keep them distinguishable BY NAME.');
});
assert.ok(!src.includes("label: 'Copilot Voice'"),
  'a Copilot Voice fan option is back. The owner retired the feature on ' +
  '2026-07-28 ("completely broken"); its creators are stood down, so this ' +
  'option could only click a button that never mounts.');
assert.ok(!/key:\s*'assistant'/.test(src),
  'MLS Assistant is back in the voice menu. The owner removed it on ' +
  '2026-07-26 ("overlapping too much with Copilot"); if it is returning, ' +
  'that is an owner decision to record here — not a drive-by re-add.');

/* ---- 2. it owns no recognizer behaviour --------------------------------- */

/* Scan the CODE, not the prose. The module's own header explains that it
 * constructs no SpeechRecognition and requests no getUserMedia — and the first
 * version of this suite failed on that sentence. A gate that fires on the
 * comment describing the property it enforces is a gate people delete. */
const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

[
  ['SpeechRecognition', 'never construct a recognizer — the one-recognizer truce owns that'],
  ['webkitSpeechRecognition', 'never construct a recognizer — the truce owns that'],
  ['getUserMedia', 'never request the microphone itself'],
  ['MediaRecorder', 'never record'],
  ['.start()', 'never start a recognizer; click the real control instead']
].forEach(([needle, why]) => {
  assert.ok(!code.includes(needle),
    'feat_mls_visit_voice_one.js must ' + why + ' (found: ' + needle + ')');
});

/* The ONLY way it may act is by clicking the resolved canonical control. */
assert.ok(
  /var target = resolve\(def\);/.test(src) && /safe\(function \(\) \{ target\.click\(\); \}\);/.test(src),
  'an option must act by clicking its real control and nothing else — that is ' +
  'what keeps the truce, the mic permission prompt and every failure message ' +
  'where they already live and already work'
);

/* ---- 3. it EXPANDS; it never decides ------------------------------------ */

assert.ok(/function toggle\(\)/.test(src) && /aria-expanded/.test(src),
  'the face must be a disclosure with aria-expanded, not an action');
assert.ok(!/pickBest|bestGuess|inferTool|chooseTool/i.test(code),
  'the module appears to choose a tool for the doctor. It must not: Copilot ' +
  'Voice and Dictate are different recognizers writing to different places.');
{
  /* one named option remains: three became two on the 2026-07-26 owner order
     (assistant retired), and two became one on 2026-07-28 (Copilot Voice
     retired entirely - "completely broken"). Dictate is the survivor. */
  const items = src.match(/key:\s*'(voice|assistant|dictate)'/g) || [];
  assert.strictEqual(items.length, 1,
    'expected exactly one named option (dictate), found ' + items.length);
  assert.ok(/key:\s*'dictate'/.test(src), 'the surviving option must be dictate');
}

/* ---- 4. a closed control may NEVER hide a hot mic ----------------------- */

assert.ok(/face\.classList\.toggle\('live', anyLive\)/.test(src),
  'the face must carry a live state. Collapsing three chips into one is ' +
  'exactly where "is my mic hot?" gets lost.');
assert.ok(/liveNames\.push\(it\.def\.label\)/.test(src) && /faceName\.textContent !== name/.test(src),
  'the face must NAME what is running. A generic "listening" dot cannot tell ' +
  'Copilot Voice from Dictate.');
assert.ok(/function chipOn\(id\)[\s\S]{0,400}?aria-pressed/.test(src),
  'live state must be READ off the real control (aria-pressed / .on), never ' +
  'tracked in a private flag that could disagree with the truce');
assert.ok(/isListening/.test(src),
  "the DOM alone is not enough: setTopVoiceChip only writes aria-pressed on the " +
  'LANE chips, so on the engine renderer a live recognizer would be invisible. ' +
  "The recognizers' own isListening() must be read too. (The assistant panel's " +
  '.open read left with the assistant option, 2026-07-26 owner order.)');
/* the phone lane drops the whole chip row; a live mic must bring it back */
assert.ok(/body\.mls-phone \.ez3fl-quick:has\(#' \+ ROOT_ID \+ '\.live\)/.test(src),
  'mls-connect.js hides .ez3fl-quick entirely under body.mls-phone. Without an ' +
  'override keyed on .live, a doctor on a handheld would have a recognizer ' +
  'running and nothing on screen saying so.');

/* ---- 5. NOTHING FLOATS -------------------------------------------------- */

{
  const cssBlock = /s\.textContent = \[([\s\S]*?)\]\.join\(''\);/.exec(src);
  assert.ok(cssBlock, 'the stylesheet is not where this suite expects it');
  const css = cssBlock[1];
  assert.ok(!/position\s*:\s*fixed/.test(css) && !/position\s*:\s*sticky/.test(css),
    'the control is fixed or sticky. The floating version of exactly this merge ' +
    'ate clicks (b658) and covered the review control (b669) and was retired ' +
    'at b676. It lives IN FLOW, inside the row it replaces.');
  assert.ok(!/position\s*:\s*absolute/.test(css),
    'the fan is absolutely positioned, i.e. it covers whatever is beneath it. ' +
    'It must push the page, not overlay it.');
  assert.ok(/#' \+ ROOT_ID \+ '\{display:inline-flex/.test(css),
    'the root must be an in-flow inline-flex box inside the chip row');
  /* only transform and opacity may animate: this surface has a documented
     idle-churn problem and a layout transition would cost a reflow */
  const LAYOUT_PROPS = /transition:[^;']*\b(width|height|top|left|right|bottom|margin|padding)\b/;
  assert.ok(!LAYOUT_PROPS.test(css),
    'a transition animates a layout-triggering property. Only transform and ' +
    'opacity may animate here.');
  assert.ok(/@media \(prefers-reduced-motion: reduce\)/.test(css),
    'every animation must be switchable off — the motion here is decoration ' +
    'and the control must work identically without it');
  /* 44px: measured at 390x844 the first build was 38px, under the touch floor */
  assert.ok(/min-height:44px/.test(css),
    'the face is under the 44px touch target. Measured at 390x844 the first ' +
    'build was 38px — this is the control a doctor taps one-handed mid-visit.');
}

/* ---- 6. the originals are hidden by CLASS, never inline ----------------- */

assert.ok(/html body\.' \+ BODY_ON \+ ' #ez3flCopilotVoice/.test(src),
  'the originals must be hidden by an ancestor CLASS rule');
[].concat(LANE, ENGINE).forEach((id) => {
  const inline = new RegExp("\\$\\('" + id + "'\\)[^\\n]*\\.style\\.display\\s*=");
  assert.ok(!inline.test(src),
    id + ' is inline-hidden. available() tests INLINE display, so an inline ' +
    'hide silently removes the feature from the Calm Shell Tools menu.');
});
/* and the canonical peers must stay in the shell's Tools menu, because that is
   the reach story for every screen that is not the Visit screen */
{
  const shell = fs.readFileSync(path.join(root, 'feat_mls_calm_shell.js'), 'utf8');
  CANON.forEach((id) => {
    assert.ok(shell.includes("{ id: '" + id + "'"),
      id + ' lost its Calm Shell Tools entry. Off the Visit screen that menu ' +
      'is the only route to it.');
  });
}

/* ---- 7. an empty disclosure is chrome pretending to be a feature -------- */

assert.ok(/if \(items\.length < 2\) \{ unmount\(\); return false; \}/.test(src),
  'with fewer than two tools available the control must not render — a ' +
  'disclosure that gathers up nothing is the accumulation this change removes');

/* ---- 8. no new tick, and no rebuild storm ------------------------------- */

assert.ok(!/setInterval/.test(code),
  'the module must not poll. Three chips becoming one has to REDUCE idle ' +
  'churn; a timer would make the merge a net loss.');
assert.ok(/MutationObserver/.test(src) && /requestAnimationFrame/.test(src),
  'state must be mirrored from an observer coalesced into a frame, not a timer');
assert.ok(/function fanSig\(\)/.test(src) && /if \(sig === lastFanSig/.test(src),
  'the fan must rebuild only when the AVAILABLE SET changes. The observer fires ' +
  'on every mutation inside #visitView, and a transcript streaming in mutates ' +
  'it continuously — rewriting innerHTML on each would be a worse churn defect ' +
  'than the one this merge removes.');
[
  [/if \(on !== was\) it\.btn\.setAttribute\('aria-pressed'/, 'aria-pressed'],
  [/if \(face\.classList\.contains\('live'\) !== anyLive\)/, 'the live class'],
  [/if \(faceName\.textContent !== name\)/, 'the face label']
].forEach(([re, what]) => {
  assert.ok(re.test(src),
    'the write to ' + what + ' is unguarded. A no-op write still invalidates ' +
    'style, and this surface has a measured history of exactly that (86 no-op ' +
    'body-class writes in 44s).');
});

/* ---- 9. gesture-gated controls are SHOWN, never faked ------------------- */

assert.ok(/GESTURE_GATED/.test(src) && /toast\(def\.label \+ ' needs a direct tap/.test(src),
  'a gesture-gated target must be shown and named, never driven with a ' +
  'synthetic click — startPhoneMic and its siblings refuse untrusted callers ' +
  'SILENTLY, which reads as a dead button forever (b634 / phn-1.0.1).');
assert.ok(/if \(!ev \|\| ev\.isTrusted !== true\)/.test(src),
  "the module must require the doctor's OWN trusted event before it clicks " +
  'anything. Acting on a synthesized event is how a proxy defeats a gate.');

/* ---- 10. reversible, and honest about its own state -------------------- */

assert.ok(/revert: function \(\)/.test(src) && /describe: function \(\)/.test(src),
  'the module must expose revert() and describe(), matching the satellite ' +
  'pattern this slot established');
assert.ok(/mounted: !!\(root && root\.isConnected\)/.test(src) && /visible: !!\(r && r\.width > 0/.test(src),
  'describe() must report mounted and visible SEPARATELY. "mounted:true" was ' +
  'once reported, truthfully, about a state the owner is never in.');

/* ---- 11. the sample workspace opens the FACE and blocks the TOOLS ------- */

{
  const preview = fs.readFileSync(path.join(root, 'public-preview-runtime.js'), 'utf8');
  assert.ok(/'mlsVoiceOneFace'/.test(preview),
    'public-preview-runtime.js does not know about the merged face. Left ' +
    'blocked, a prospect sees one inert chip and cannot discover that the ' +
    'three tools exist — merging the chrome would HIDE the feature on a sales ' +
    'surface. Handled through rewriteVoiceCluster(), the sanctioned shape.');
  assert.ok(/window\.__mlsVisitVoiceOne \|\| window\.__mlsVoiceCluster/.test(preview),
    'openVoiceCluster() must drive the merged control; it still names the ' +
    'retired cluster as a fallback so an older session keeps working.');
}

/* ---- 12. it is actually loaded ----------------------------------------- */

{
  const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');
  assert.ok(connect.includes("data-mls-asset=\"feat_mls_visit_voice_one.js\""),
    'the module has no loader bootstrap in mls-connect.js. A module nothing ' +
    'loads is a file, not a feature — and it would read exactly like a ' +
    'shipped fix.');
}

console.log('PASS visit voice one expands never decides: 3 named options, 9 real ' +
  'controls behind them, 0 recognizers owned, 0 floating, 0 timers, class-hide only');
