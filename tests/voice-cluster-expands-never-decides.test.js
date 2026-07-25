'use strict';

/* One bubble that EXPANDS — never one that DECIDES.
 *
 * The owner asked for three bottom-left bubbles to become one. The way that
 * ships pretty and breaks a clinical path is a single button that infers which
 * tool you meant, because:
 *
 *   - Copilot Voice (#mlsCopVoiceBtn) and Dictate (#mlsDaDock) are DIFFERENT
 *     recognizers under an explicit one-recognizer truce (mls-connect.js F11).
 *     Silently starting the wrong one mid-visit is a real harm, not a glitch.
 *   - The app ships a help entry solely to explain that MLS Assistant, Copilot
 *     Voice and MLS Assist are three DIFFERENT things. One button that guesses
 *     erases a distinction the product documents.
 *
 * So this suite pins the properties that keep the merge honest. It is not a
 * style test — every assertion here is a safety property.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'feat_mls_voice_cluster.js'), 'utf8');

/* ---- 1. all three peers survive, by name ---- */
const CANON = ['mlsCopVoiceBtn', 'mlsAsstFab', 'mlsDaDock'];
CANON.forEach((id) => {
  assert.ok(
    src.includes("'" + id + "'"),
    id + ' is not in the cluster. Merging the chrome must not drop a tool — ' +
    'all three stay reachable as their own named affordance.'
  );
});
['Copilot Voice', 'MLS Assistant', 'Dictate'].forEach((label) => {
  assert.ok(
    src.includes(label),
    'the label "' + label + '" is gone. The app documents these as three ' +
    'different things; the fan must keep them distinguishable by name.'
  );
});

/* ---- 2. it owns no recognizer behaviour ---- */
const FORBIDDEN = [
  ['SpeechRecognition', 'the cluster must never construct a recognizer — the truce owns that'],
  ['webkitSpeechRecognition', 'the cluster must never construct a recognizer — the truce owns that'],
  ['getUserMedia', 'the cluster must never request the mic itself'],
  ['MediaRecorder', 'the cluster must never record'],
  ['.start()', 'the cluster must never start a recognizer; it clicks the real control']
];
FORBIDDEN.forEach(([needle, why]) => {
  assert.ok(!src.includes(needle), why + ' (found: ' + needle + ')');
});

/* the ONLY way it may act is by clicking the canonical control */
assert.ok(
  /var target = \$\(it\.def\.id\);\s*\n\s*if \(target\) safe\(function \(\) \{ target\.click\(\); \}\);/.test(src),
  'a fan item must act by clicking its canonical control and nothing else — ' +
  'that is what keeps the truce, mic permissions and failure messages where they live'
);

/* ---- 3. a closed bubble may never hide a hot mic ---- */
assert.ok(
  /root\.classList\.toggle\('live', live\)/.test(src),
  'the face must carry a live state. Collapsing three chips into one is exactly ' +
  'where "is my mic hot?" gets lost.'
);
assert.ok(
  /liveNames\.push\(def\.label\)/.test(src) && /faceName\.textContent !== name/.test(src),
  'the face must NAME what is running. A generic "listening" dot cannot tell ' +
  'Copilot Voice from Dictate, which are different recognizers.'
);
assert.ok(
  /function isOn\(el\)[\s\S]{0,400}?aria-pressed/.test(src),
  'live state must be READ off the real control (aria-pressed / .on), never ' +
  'tracked in a private flag that could disagree with the truce'
);

/* ---- 4. the originals are hidden by CLASS, never inline ---- */
assert.ok(
  /html body\.' \+ BODY_ON \+ ' #mlsCopVoiceBtn/.test(src),
  'the originals must be hidden by an ancestor CLASS rule'
);
CANON.forEach((id) => {
  const inline = new RegExp("\\$\\('" + id + "'\\)[^\\n]*\\.style\\.display\\s*=");
  assert.ok(
    !inline.test(src),
    id + ' is inline-hidden. available() tests INLINE display, so an inline hide ' +
    'silently removes the feature from the Calm Shell Tools menu; a class-hide keeps it reachable.'
  );
});

/* ---- 5. the top lane still wins, so the two surfaces cannot drift ---- */
assert.ok(
  /html body\.mls-top-voice-tools #' \+ ROOT_ID \+ '\{display:none!important;\}/.test(src),
  'the cluster must hide under body.mls-top-voice-tools exactly as the three ' +
  'originals do — otherwise the bottom-left and the visit lane both claim these tools'
);

/* ---- 6. an empty bubble is chrome pretending to be a feature ---- */
assert.ok(
  /if \(items\.length < 2\) \{ unmount\(\); return false; \}/.test(src),
  'with fewer than two tools available the cluster must not render — a bubble ' +
  'that gathers up nothing is the accumulation this change exists to remove'
);

/* ---- 7. motion is decoration: reduced-motion, and compositor-only ---- */
assert.ok(
  /@media \(prefers-reduced-motion: reduce\)/.test(src),
  'every animation must be switchable off — motion here is decoration and the ' +
  'control must work identically without it'
);
/* animating anything that triggers layout would cost a reflow on a surface that
   already has a documented idle-churn problem */
const LAYOUT_PROPS = /transition:[^;']*\b(width|height|top|left|right|bottom|margin|padding)\b/;
assert.ok(
  !LAYOUT_PROPS.test(src),
  'a transition animates a layout-triggering property. Only transform and ' +
  'opacity may animate here.'
);

/* ---- 8. no new tick on a surface with a known churn problem ---- */
assert.ok(
  !/setInterval/.test(src),
  'the cluster must not poll. Three chips becoming one has to REDUCE idle ' +
  'churn; a timer would make the merge a net loss.'
);
assert.ok(
  /MutationObserver/.test(src) && /requestAnimationFrame/.test(src),
  'state must be mirrored from an observer coalesced into a frame, not a timer'
);
assert.ok(
  /if \(on !== was\) b\.setAttribute\('aria-pressed'/.test(src),
  'attribute writes must be guarded by a change check — a no-op write still ' +
  'invalidates style, which is the exact churn defect this surface already had'
);

/* ---- 9. it is fully reversible ---- */
assert.ok(
  /revert: function \(\)/.test(src) && /describe: function \(\)/.test(src),
  'the module must expose revert() and describe(), matching the satellite ' +
  'pattern feat_mls_copilot_voice_v2.js established for this slot'
);

/* ---- 10. the guard can fail ---- */
{
  const broken = "var target = $(it.def.id);\n        if (target) target.focus();";
  assert.ok(
    !/if \(target\) safe\(function \(\) \{ target\.click\(\); \}\);/.test(broken),
    'the click-through detector matches source that never clicks — it would pass regardless'
  );
}

console.log('PASS voice-cluster-expands-never-decides: three tools keep their names, the ' +
  'cluster owns no recognizer, a closed bubble cannot hide a hot mic, originals are ' +
  'class-hidden, the top lane still wins, and no tick was added');
