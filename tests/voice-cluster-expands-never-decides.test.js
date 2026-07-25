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

/* ---- 5. the top lane wins ONLY when it is really on screen ----
 *
 * This assertion used to require the opposite: a CSS rule hiding the cluster
 * under body.mls-top-voice-tools, "exactly as the three originals do". It was
 * pinned on a belief that turned out to be false, and it pinned it hard enough
 * that removing the bug failed the suite.
 *
 * Measured on the owner's live signed-in tab at b653, with that class SET:
 *
 *   #mlsCopVoiceBtn / #mlsAsstFab / #mlsDaDock            display:none (the class)
 *   #ez3flCopilotVoice / #ez3flAssistant / #ez3flDictate  display:none, rect 0x0
 *   #mlsVoiceCluster                                      display:none (my rule)
 *
 * Three routes to the voice tools, all closed, because the class asserted the
 * top lane owned them while the top lane rendered nothing. A class is a claim;
 * geometry is a fact. The app already asks the real question in
 * topLaneIsVisible() (mls-connect.js ~:6447).
 *
 * So what is pinned now is the decision PROCEDURE, not a selector. */
assert.ok(
  /function standDown\(\)/.test(src),
  'the cluster must decide standing down at runtime, not with a CSS rule keyed ' +
  'on body.mls-top-voice-tools — that class can assert the top lane owns these ' +
  'controls while the top lane renders nothing, which left a doctor with none.'
);
assert.ok(
  !/body\.mls-top-voice-tools #' \+ ROOT_ID/.test(src),
  'the class-keyed hide is back. It is the exact defect: three closed doors and ' +
  'no voice tools at all.'
);
{
  const fn = /function standDown\(\)[\s\S]*?\n  \}/.exec(src);
  assert.ok(fn, 'standDown() is missing');
  assert.ok(
    /getBoundingClientRect\(\)/.test(fn[0]) && /r\.width > 0 && r\.height > 0/.test(fn[0]),
    'standDown() must decide on real twin GEOMETRY. Anything else is trusting a ' +
    'claim again. Found: ' + fn[0].slice(0, 200)
  );
  ['ez3flCopilotVoice', 'ez3flAssistant', 'ez3flDictate'].forEach((id) => {
    assert.ok(src.includes("'" + id + "'"), 'the twin ' + id + ' is not consulted');
  });
}
/* and the report must distinguish mounted from visible — conflating them is how
   a true verification became an irrelevant one */
assert.ok(
  /standDown: standDown\(\)/.test(src) && /visible: !!\(root/.test(src),
  'describe() must report standDown and visible, not just mounted. "mounted:true" ' +
  'was truthfully reported at b651 about a state the owner is never in.'
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

/* ---- 10. in the sample workspace the FACE opens; the three TOOLS stay blocked ----
 * Preview stamped the merged face data-mls-preview-blocked="1", classifying a
 * DISCLOSURE control as an action. Before the merge a prospect saw three
 * blocked-but-visible pills and knew the tools existed; after it they saw one
 * inert bubble and could not discover them at all. Merging the chrome hid the
 * feature on a sales surface. Fixed through public-preview-runtime's own
 * sanctioned shape (rewriteStaffCopy / rewriteDayPull), not by out-writing it. */
{
  const preview = fs.readFileSync(path.join(root, 'public-preview-runtime.js'), 'utf8');

  assert.ok(
    /function rewriteVoiceCluster\(\)/.test(preview),
    'public-preview-runtime must unblock the cluster FACE, or the sample workspace ' +
    'shows an inert bubble that hides the feature instead of disclosing it is read-only'
  );
  assert.ok(
    /rewriteVoiceCluster\(\);/.test(preview),
    'rewriteVoiceCluster() is defined but never called, so it runs on no harden pass'
  );
  assert.ok(
    /'voice-cluster'\) openVoiceCluster\(target\)/.test(preview),
    'the face must be dispatched through blockedClick like every other preview-safe ' +
    'action, not given a private escape hatch'
  );
  /* the face may open the menu; it must never gain the power the tools have */
  const fn = /function rewriteVoiceCluster\(\)[\s\S]*?\n  \}/.exec(preview)[0];
  ['mlsCopVoiceBtn', 'mlsAsstFab', 'mlsDaDock'].forEach((id) => {
    assert.ok(
      !fn.includes(id),
      'rewriteVoiceCluster unblocks ' + id + '. The three TOOLS must stay blocked in ' +
      'the sample workspace — they can record, send and contact Athena. Only the ' +
      'disclosure opens.'
    );
  });
  assert.ok(
    /api\.toggle\(\)/.test(preview) && /toggle: function \(\)/.test(src),
    'preview must call the cluster\'s own toggle(), not duplicate the open/close logic — ' +
    'two implementations of one behaviour is how they drift'
  );
}

/* ---- 11. the bubble must never sit on the phone's only navigation ----
 * On a phone #mlsDock spans the full width at bottom:8px and is the ONLY way to
 * reach Patients, Visit and Review. This cluster is z-index 2147482000 against
 * the dock's 920, so an overlap does not just look wrong — it eats the taps.
 *
 * Standing down does not save us: phone mode kills the ez3 twins
 * (mls-connect.js:44428), so no twin has layout and standDown() is correctly
 * false. The cluster is SUPPOSED to be up on a phone. It just has to clear the
 * dock, using the same calc ScribeFlow.html:1367 already uses for #mlsA2hsCard. */
{
  /* the phone block is built by concatenation, so match on its literal text
     rather than trying to reconstruct the selector */
  const phone = /max-width:760px[\s\S]{0,400}?left:12px;bottom:([^;}]*)/.exec(src);
  assert.ok(phone, 'the phone media block for the cluster is gone');
  assert.ok(
    phone[1].indexOf('calc(84px + env(safe-area-inset-bottom') > -1,
    'the cluster does not clear the dock on phones. At bottom:12px it overlaps ' +
    '#mlsDock (bottom:8px, full width) and wins pointer events (z 2147482000 vs ' +
    '920), so taps meant for Patients/Visit/Review hit the bubble instead. ' +
    'Found bottom: ' + phone[1]
  );
  assert.ok(
    !/^\s*\d+px/.test(phone[1]),
    'a static pixel offset is back in the phone block, which cannot clear a dock ' +
    'whose height varies with the safe-area inset and the keyboard: ' + phone[1]
  );
}

/* ---- 12. a CLOSED bubble must not swallow clicks, and must open UPWARD ----
 *
 * Both measured on the running page at b655 with the cluster mounted and closed:
 *
 *   elementFromPoint at the centre of the fan region -> DIV#mlsVoiceCluster
 *   faceBox top 605 / bottom 653, fanBox top 662 / bottom 810
 *
 * The first is a 196x148 invisible region eating clicks meant for the page
 * beneath. The fan ITEMS already had pointer-events:none; the container was the
 * aggressor, and its box is full height whether the fan is open or not. This is
 * the same defect shape as the phone-dock overlap — an element winning taps it
 * has no business winning — except invisible, so nobody would file it as
 * anything but "the page stopped responding down there".
 *
 * The second: with flex-direction:column-reverse and DOM order [fan, face], the
 * FACE rendered above the FAN, so a bottom-anchored bubble floated 157px off the
 * bottom and its items expanded downward toward the dock. */
{
  const rootRule = /'#' \+ ROOT_ID \+ '\{position:fixed[\s\S]{0,400}?\}',/.exec(src);
  assert.ok(rootRule, 'the cluster root rule is gone');

  assert.ok(
    /pointer-events:none/.test(rootRule[0]),
    'the cluster root must be pointer-events:none. Its box is ~196x205 whether ' +
    'the fan is open or closed, so without this a closed bubble swallows every ' +
    'click in the fan region — invisibly.'
  );
  assert.ok(
    /'#mlsVcFace\{pointer-events:auto/.test(src),
    'the face must opt back in to pointer events, or the one control that is ' +
    'always visible stops being clickable'
  );
  assert.ok(
    /\.open #mlsVcFan\{pointer-events:auto/.test(src),
    'the fan must regain pointer events when open, or the three tools cannot be clicked'
  );

  assert.ok(
    /flex-direction:column;/.test(rootRule[0]),
    'the root must be flex-direction:column. DOM order is [fan, face], so plain ' +
    'column puts the face at the BOTTOM and the fan above it — which is what a ' +
    'bottom:18px-anchored bubble has to be. column-reverse floated the face 157px ' +
    'off the bottom with the fan hanging below it.'
  );
  assert.ok(
    !/flex-direction:column-reverse[^']*}',\s*$/m.test(rootRule[0]),
    'column-reverse is back on the root: the face will render above the fan again'
  );
}

/* ---- 13. the guard can fail ---- */
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
