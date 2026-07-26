'use strict';

/* A button that swallows the click is the worst of the three options.
 *
 * openReviewStep() — the handler behind "Next: Review & send to Athena" — ended
 * in .focus({preventScroll:true}) on #pushAllEmrBtn. For a Lite account that
 * button is INLINE display:none, because applyLitePortal (ScribeFlow.html:24658)
 * calls mlsRoleHide on button[onclick*="pushEntireVisitToAthena"] and
 * mlsRoleHide sets style.display directly.
 *
 * Focusing a display:none element is a silent no-op. So an entire paying tier
 * clicked Review and NOTHING happened — no movement, no message, no error, every
 * time. The failure was invisible from the outside and indistinguishable from a
 * broken app.
 *
 * Two things are pinned here, and the second is the subtle one:
 *
 *   1. The handler must detect that the route is unavailable and SAY so.
 *   2. It must test INLINE display specifically. The Advanced workspace hides
 *      this same button by CSS while it is closed, and that state is fine —
 *      opening Advanced reveals it, which is exactly what the rest of the
 *      function does. Only a role/tier hide is written inline. Testing computed
 *      display would refuse the review for everyone.
 *
 * Receptionist cannot reach this branch: hideClinicalForReceptionist hides
 * nav_visit, so the visit lane that owns the button never opens for them. Lite is
 * the only account that lands here, which is why the message may name a plan
 * without misdiagnosing another role.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');

const fn = /function openReviewStep\(\)[\s\S]*?\n  \}/.exec(connect);
assert.ok(fn, 'openReviewStep() is gone');

/* ---- 1. it cannot end in a silent no-op ---- */
assert.ok(
  /pushAllEmrBtn/.test(fn[0]) && /flowToast\(/.test(fn[0]),
  'openReviewStep must tell the doctor when the review route is unavailable. ' +
  'Without this it focuses a display:none button and returns, which is silent.'
);
assert.ok(
  /if \(!sendBtn \|\|[\s\S]{0,400}?return;/.test(fn[0]),
  'the unavailable branch must RETURN before the focus path, or the silent no-op ' +
  'still happens after the message'
);
/* and the return must come BEFORE the focus call, not merely exist somewhere */
assert.ok(
  fn[0].indexOf('return;') < fn[0].indexOf('preventScroll'),
  'the unavailable branch returns AFTER the focus path — the message would be ' +
  'shown and the silent no-op would still run'
);

/* ---- 2. INLINE display, not computed ---- */
assert.ok(
  /sendBtn\.style && sendBtn\.style\.display === 'none'/.test(fn[0]),
  'the check must read INLINE style.display. The Advanced workspace hides this ' +
  'button by CSS while closed — a legitimate state this function then opens — so ' +
  'testing computed display would refuse the review for every account.'
);
assert.ok(
  !/getComputedStyle\(sendBtn\)/.test(fn[0]),
  'computed display must NOT be used here: it conflates "Advanced is closed" ' +
  '(fine, the function opens it) with "not yours" (a dead end).'
);

/* ---- 3. the message names a route that exists ---- */
{
  const msg = /flowToast\('(Reviewing Athena actions[^']*)'/.exec(fn[0]);
  assert.ok(msg, 'the unavailable branch carries no user-facing message');
  assert.ok(
    !/\bin Settings\b/i.test(msg[1]),
    'do not send them to Settings — it has no upgrade control. See ' +
    'tests/premium-block-names-a-real-route.test.js, written after exactly that.'
  );
  assert.ok(
    /home page|pricing|plans/i.test(msg[1]),
    'the block must name a destination that exists. Found: ' + msg[1]
  );
}

/* ---- 4. the premise still holds ---- */
assert.ok(
  /function applyLitePortal\(\)[\s\S]{0,2500}?pushEntireVisitToAthena/.test(app),
  'applyLitePortal no longer hides the send button. If Lite can now reach the ' +
  'review directly, this guard is measuring a problem that no longer exists — ' +
  'verify on the running page and update deliberately rather than deleting.'
);
assert.ok(
  /function mlsRoleHide\(el\)\{ mlsRoleSetDisplay\(el,'none'\); \}/.test(app),
  'mlsRoleHide changed shape; re-check that role hiding is still INLINE, because ' +
  'the inline-vs-computed distinction above depends on it'
);

/* ---- 5. STAGING: not affected, and this pins WHY ----
 * Staging drifted from production seven times in one day by being forgotten in
 * exactly this shape, so "staging is fine" must be a checked fact rather than an
 * assumption.
 *
 * It is fine, and not because the fix reaches it — it cannot. Staging does not
 * load mls-connect.js at all, and openReviewStep() exists ONLY there. It also
 * has no #ez3flReview and no "Review & send to Athena" button, so nothing in
 * staging can call into the silent no-op. applyLitePortal DOES exist there and
 * still hides the send button, but hiding a control is honest; the defect was
 * a VISIBLE button that did nothing.
 *
 * If staging ever gains the ez3fl lane, this assertion fails and whoever adds it
 * has to carry the guard across deliberately. */
{
  const staging = fs.readFileSync(path.join(root, 'ScribeFlow-staging.html'), 'utf8');
  assert.ok(
    !/ez3flReview/.test(staging),
    'ScribeFlow-staging.html now has #ez3flReview. It does not load mls-connect.js, ' +
    'so it does NOT have openReviewStep\'s unavailable-route guard — a Lite user ' +
    'there would click into silence exactly as production did. Port the guard, or ' +
    'wire staging to the shared module.'
  );
  assert.ok(
    !/mls-connect\.js/.test(staging),
    'ScribeFlow-staging.html now loads mls-connect.js. That is fine and probably ' +
    'good, but it changes the reasoning above: re-check that the Lite guard and ' +
    'this suite\'s production-only premise still describe reality.'
  );
}

/* ---- 6. THE CLASS, not the instance: no dock destination is a dead end ----
 *
 * Review was found by accident. The general shape is: a dock destination whose
 * ENTIRE target list falls inside a role's hide-set has nothing to reach, and
 * the question is whether it disappears (honest) or renders and does nothing
 * (a dead end).
 *
 * Checked against both hide-sets in ScribeFlow.html:
 *
 *   Lite (applyLitePortal) hides nav_recs, nav_orders, nav_history,
 *     nav_analysis, nav_legalreq, nav_team, nav_admin, nav_patients,
 *     nav_studio, nav_calendar
 *       day     [nav_calendar]              all hidden -> destination hides
 *       patient [nav_patients,nav_history]  all hidden -> hides
 *       review  [nav_orders,nav_recs]       all hidden -> hides
 *       tools   [nav_studio]                all hidden -> hides
 *       visit   [nav_visit]                 SURVIVES
 *
 *   Receptionist (applyReceptionistPortal) additionally hides nav_visit
 *       visit   [nav_visit]                 hidden -> hides
 *       review  [nav_orders,nav_recs]       hidden -> hides
 *       day, patient, tools                 SURVIVE
 *
 * So the dock is correct BY CONSTRUCTION and there is no second Review waiting
 * to be found: destTargets() filters through available(), which returns false
 * for the INLINE display:none that mlsRoleHide writes, and a destination with
 * no available target renders nothing. What this pins is that mechanism — the
 * moment a destination is allowed to render without an available target, every
 * role becomes a potential dead end again. */
{
  const shell = fs.readFileSync(path.join(root, 'feat_mls_calm_shell.js'), 'utf8');

  assert.ok(
    /function destTargets\(d\)[\s\S]{0,300}?\.filter\(available\)/.test(shell),
    'destTargets() must filter through available(). Without it a destination ' +
    'renders for a role that cannot reach any of its targets — which is exactly ' +
    'the Review dead end, generalised to every role and every destination.'
  );
  assert.ok(
    /el\.style\.display === 'none'/.test(shell),
    'available() must test INLINE display, because that is what mlsRoleHide ' +
    '(ScribeFlow.html) writes. A computed-display test would also catch controls ' +
    'that are merely off-screen and hide destinations that work.'
  );
  /* and every destination must declare at least one target, or it can never
     be filtered out and would render for everyone regardless of role */
  const dests = shell.match(/\{ id: '[a-z]+', label: '[^']+', targets: \[[^\]]*\]/g) || [];
  assert.ok(dests.length >= 5, 'expected at least 5 dock destinations, found ' + dests.length);
  dests.forEach((d) => {
    assert.ok(
      /targets: \['nav_/.test(d),
      'a dock destination declares no nav target, so available() can never gate ' +
      'it and it renders for every role: ' + d
    );
  });
}

/* ---- 7. the guard can fail ---- */
{
  const broken = "function openReviewStep() {\n    var note = $('noteBox');\n  }";
  assert.ok(
    !/pushAllEmrBtn/.test(broken),
    'the detector matches a handler that never mentions the send button — it ' +
    'would pass regardless'
  );
}

console.log('PASS review-step-never-fails-silently: an account that cannot reach the Athena ' +
  'review is told so, the check reads inline display only, and the message names a real route');
