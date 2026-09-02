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
const vm = require('vm');

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

/* ---- 7. the SUCCESS path must have a visible effect too ----
 *
 * Section 1 fixed the case where the route is unavailable. This is the case
 * where everything WORKS and the doctor still cannot tell.
 *
 * openReviewStep opened the Advanced workspace and called
 * .focus({preventScroll:true}) on #pushAllEmrBtn — deliberately, per an owner
 * decision on 2026-07-16 that jumping the page down to "Advanced tools" was
 * disorienting. That decision was right and is preserved. But its effect was
 * that pressing "Next: Review & send to Athena" moved focus to a control the
 * doctor could not see and did nothing else — indistinguishable from a broken
 * button, on the last human gate before Athena.
 *
 * The distinction being pinned: do not JUMP, but do not be INVISIBLE either. */
{
  /* visitpage-1.0.0 (2026-09-02) — THE PROPERTY IS KEPT; THE SPELLING MOVED,
     because the thing the old sentence INSTRUCTED is now DONE.
     Owner, 2026-09-02: "the top one does nothing. You click the button, it
     just takes to the bottom one." That is the fourth report of this control
     reading as dead, and the previous three fixes (b666 scroll, b669 clearance,
     b940 focus + this sentence) all tried to make a FOCUS MOVE feel like an
     action. It no longer is one: openReviewStep now presses the engine's own
     review door (#ez3Send -> requestSend(), which carries the name/DOB confirm),
     so the review actually opens.
     The pin that mattered — "the success path must give feedback, focus alone
     is not feedback" — is asserted exactly as before, and is now stronger: the
     feedback must say the review OPENED, not that the doctor should go and open
     it. Requiring the old 'press Enter, or use "Review Athena actions"' string
     would require the app to instruct a press the doctor no longer has to make,
     which is the "instruction points nowhere" defect class this block cites,
     pointed the other way. The failure branch still names that control, because
     there it really is what is left to do. */
  assert.ok(
    /flowToast\(/.test(fn[0]),
    'the success path must give feedback. Focus alone is not feedback — a doctor ' +
    'who did not happen to see the focus ring move has no way to know the click ' +
    'registered at all.'
  );
  assert.ok(
    /Athena review opened — nothing is sent until you confirm it there\./.test(fn[0]),
    'the feedback must say what actually happened AND that nothing has been sent. ' +
    'This is the last human gate before Athena; "opened" without "nothing is sent ' +
    'until you confirm" would be the more dangerous half of the sentence.'
  );
  assert.ok(
    /Use "Review Athena actions" on the note card\./.test(fn[0]),
    'when the door could NOT be opened the feedback must still name the REAL next ' +
    'control. "the instruction points nowhere" is a documented defect class in this repo.'
  );
  assert.ok(
    /reviewDoor\.click\(\);/.test(fn[0]),
    'the success path stopped PRESSING the review door and went back to focusing ' +
    'a control thousands of pixels below the fold — the shape the owner has now ' +
    'reported dead four times (b666, b669, b940, 2026-09-02).'
  );

  /* the 2026-07-16 decision survives: never move the page unless we must.
   *
   * PIN WIDENED AT b669, DELIBERATELY. It used to require the exact source text
   * `if (offscreen && send.scrollIntoView)`. The intent it was protecting is
   * "conditional, never unconditional" — and that intent is untouched here. What
   * changed is that off-screen turned out not to be the only way this control can
   * be unpressable.
   *
   * Measured at b668 in real Chrome, 1400x900, after pressing Review:
   * #pushAllEmrBtn landed at top=860 bottom=900 with 0px below it, because
   * block:'nearest' is BY DEFINITION the minimum scroll — so a control below the
   * fold comes to rest flush with the bottom edge, which is exactly where the
   * fixed Copilot bubble sits. 7 of 9 sample points across the button were owned
   * by #mlsCopVoiceBtn, and a real trusted click at its centre was received by
   * the bubble. On screen, focused, and unreachable by mouse.
   *
   * So `covered` earns the same scroll as `offscreen`: to a doctor they are the
   * same failure. The pin now requires BOTH conditions and still forbids an
   * unconditional scroll — it is strictly stronger than what it replaced.
   * See tests/review-control-clears-fixed-furniture.test.js. */
  assert.ok(
    /var offscreen = r\.bottom <= 0 \|\| r\.top >= vh;/.test(fn[0]),
    'the off-screen test must survive — since b749 it is what decides whether ' +
    'the doctor is TOLD the control sits further down the page (reviewReachNote).'
  );
  assert.ok(
    /var covered = /.test(fn[0]),
    'the COVERED test must survive. A control that is on screen but underneath ' +
    'the floating bubble is unpressable by mouse (measured b668: focused, ' +
    'visible, 7 of 9 sample points owned by #mlsCopVoiceBtn), so the doctor has ' +
    'to be told about it in the same words as one below the fold.'
  );
  /* PIN REPLACED AT b749, DELIBERATELY, on an owner ruling: "when I click review
   * and sign it should not scroll me down."
   *
   * b666 scrolled because the click had no visible consequence, and b669 kept
   * that scroll clear of the fixed bubble. Both were fixes for a real defect.
   * The owner has now ruled the viewport move out entirely, so the scroll is
   * gone and the VISIBLE EFFECT is carried by the message instead — which is
   * why the flowToast assertions above are the load-bearing half of this
   * section now, and why offscreen/covered must still be computed: they decide
   * whether the doctor is told the control sits further down the page.
   *
   * The old pin REQUIRED the conditional scroll to exist, which would have made
   * the owner instruction unshippable. What replaces it is stronger in the one
   * direction that still matters: no viewport movement may return to this
   * handler by accident, and if a scroll is ever reinstated by an owner
  * decision it must not be block:'nearest' — that parks the control flush
  * with the viewport bottom, which is the b668 defect. */
  const executableReviewStep = fn[0]
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
  assert.ok(
    !/scrollIntoView/.test(executableReviewStep),
    'openReviewStep moves the viewport again. The owner ruled on 2026-07-27 that ' +
    'pressing Review must not scroll the page: the visible effect is the message ' +
    'plus the focus move, never a jump. A scroll here needs a fresh owner ' +
    'decision, and it must NOT use block:\'nearest\' — measured b668, 7 of 9 ' +
    'points across #pushAllEmrBtn were owned by #mlsCopVoiceBtn when it came to ' +
    'rest flush with the viewport bottom.'
  );
  assert.ok(
    !/block: 'nearest'/.test(executableReviewStep) && !/block: 'center'/.test(executableReviewStep),
    'a scroll block position is back in openReviewStep. Nothing in this handler ' +
    'may position the viewport.'
  );
  assert.ok(
    /reviewReachNote/.test(fn[0]),
    'offscreen/covered no longer feed the message. Without that the two tests ' +
    'above are computed and discarded, and a doctor whose control is below the ' +
    'fold is back to a click with no visible consequence — the b666 defect, ' +
    'reintroduced by deleting the scroll without replacing what it communicated.'
  );
  assert.ok(
    /focus\(\{ preventScroll: true \}\)/.test(fn[0]),
    'focus must keep preventScroll:true. Since b749 NOTHING in this handler may ' +
    'move the page, and focus is the one remaining call that could.'
  );
}

/* ---- 8. the guard can fail ---- */
{
  const broken = "function openReviewStep() {\n    var note = $('noteBox');\n  }";
  assert.ok(
    !/pushAllEmrBtn/.test(broken),
    'the detector matches a handler that never mentions the send button — it ' +
    'would pass regardless'
  );
}

/* ---- 9. a refusal is refused at the DOOR, not only in the paint ----
 *
 * MEASURED 2026-09-02 10:xx on the shipped bytes. syncTopLane() already tested
 * the note text for a model refusal and, on a match, wrote aria-disabled=true,
 * the .dim class and the tooltip "The AI answered with a refusal instead of a
 * note - generate again before reviewing." onto #ez3flReview.
 *
 * Per the gcx doctrine that control is deliberately NOT `disabled` — a
 * swallowed click is the exact defect that doctrine exists to prevent — so the
 * dim is advisory and the click still arrives at openReviewStep(). And
 * openReviewStep checked only _genRun.active, then the empty note, then the
 * plan/tier route. It never re-tested the refusal. The dim was decoration with
 * nothing behind it: a doctor who pressed the dimmed button anyway (the dim
 * invites a press, because nothing else on the screen offers a way forward)
 * opened the Athena review with "I'm sorry, I can't help with that." standing
 * as the visit's clinical note.
 *
 * The cure is ONE predicate — noteLooksLikeRefusal + NEXTGATE_REFUSAL_WHY —
 * shared by the paint and the door, so the tooltip and the toast can never
 * drift apart. This section EXECUTES the shipped handler; it does not read it.
 */
{
  const refusalPredicate =
    /var NEXTGATE_REFUSAL_WHY = '[^']+';\s*\n\s*function noteLooksLikeRefusal\(text\) \{[\s\S]*?\n  \}/.exec(connect);
  assert.ok(refusalPredicate,
    'the shared refusal predicate (NEXTGATE_REFUSAL_WHY + noteLooksLikeRefusal) is gone from ' +
    'mls-connect.js. The dim on #ez3flReview is not `disabled`, so without it the click ' +
    'reaches openReviewStep with nothing to stop it.');

  /* The static one-predicate checks are deliberately at the END of this block:
     the BEHAVIOUR is what matters, so a suite run against bytes with the door
     guard removed must report POSITIVE 1 (the review opened on a refusal)
     rather than a text-shaped complaint about a missing identifier. */

  function driveReviewStep(noteBoxValue, flowValue, genActive) {
    const toasts = [];
    const nodes = {
      noteBox: { value: noteBoxValue, dispatchEvent() { return true; } },
      ez3flNote: { value: flowValue },
      pushAllEmrBtn: {
        style: {}, disabled: false, focus() {}, scrollIntoView() {},
        getBoundingClientRect: () => ({ top: 40, bottom: 90, left: 0, right: 100, height: 50 })
      },
      ez3Adv: { click() { nodes.__advClicks = (nodes.__advClicks || 0) + 1; } }
    };
    const sandbox = {
      $: (id) => nodes[id] || null,
      flowToast: (message, kind) => { toasts.push({ message, kind }); },
      _genRun: { id: 1, active: !!genActive, settled: null },
      document: { body: { classList: { contains: () => false } } },
      window: { innerHeight: 900, __mlsAdvQuietOpen: false },
      getComputedStyle: () => ({ display: 'block', position: 'fixed', visibility: 'visible' }),
      /* the deferred half re-reads the DOM; this section owns the synchronous
         guard, so the timer is captured rather than run */
      setTimeout: () => 0,
      Event: function (type, init) { this.type = type; this.bubbles = !!(init && init.bubbles); }
    };
    vm.createContext(sandbox);
    /* the SHIPPED predicate and the SHIPPED handler, both lifted verbatim */
    vm.runInContext(refusalPredicate[0] + '\n' + fn[0] + '\nopenReviewStep();', sandbox,
      { filename: 'openReviewStep.lifted.js' });
    return { toasts, noteBox: nodes.noteBox.value, advClicks: nodes.__advClicks || 0 };
  }

  const REFUSAL = "I'm sorry, I can't help with that.";
  const WHY = /var NEXTGATE_REFUSAL_WHY = '([^']+)';/.exec(connect)[1];

  /* POSITIVE 1 — the refusal is already in the canonical editor */
  const inNoteBox = driveReviewStep(REFUSAL, REFUSAL, false);
  assert.strictEqual(inNoteBox.toasts.length, 1,
    'a model refusal opened the Athena review with no message: ' + JSON.stringify(inNoteBox.toasts));
  assert.strictEqual(inNoteBox.toasts[0].message, WHY,
    'the door must answer with the SAME sentence the tooltip carries, or the doctor is told two ' +
    'different things by the same control. Got: ' + inNoteBox.toasts[0].message);
  assert.strictEqual(inNoteBox.advClicks, 0,
    'the review workspace opened on a refusal — that sentence is now the visit note in the ' +
    'Athena review');

  /* POSITIVE 2 — the placement's OWN negative control.
     The refusal exists only in the flow copy #ez3flNote, which openReviewStep
     adopts into #noteBox a few lines above the guard. If a later refactor moves
     the guard EARLIER (for example up next to the _genRun check, which is where
     the original finding proposed putting it) this assertion is the one that
     goes red: a note that was generated and never typed into still has an empty
     #noteBox at that point, so the refusal would slip straight through. */
  const fromFlowOnly = driveReviewStep('', REFUSAL, false);
  assert.strictEqual(fromFlowOnly.toasts.length, 1,
    'a refusal that lives only in the flow copy walked past the guard — the guard is running ' +
    'BEFORE the #ez3flNote -> #noteBox adoption. It must sit after it.');
  assert.strictEqual(fromFlowOnly.toasts[0].message, WHY,
    'the flow-copy refusal produced a different message: ' + fromFlowOnly.toasts[0].message);
  assert.strictEqual(fromFlowOnly.advClicks, 0,
    'the review opened on a refusal held in the flow copy');

  /* NEGATIVE CONTROL 1 — a real note must still open the review */
  const realNote = 'SUBJECTIVE:\nChief Complaint: knee pain.\nASSESSMENT:\nOA.\nPLAN:\nInjection.';
  const good = driveReviewStep(realNote, realNote, false);
  assert.strictEqual(good.toasts.length, 0,
    'a real generated note was refused at the review door: ' + JSON.stringify(good.toasts));
  assert.strictEqual(good.advClicks, 1,
    'the review workspace no longer opens for a real note — this guard has become the b668 ' +
    'class of defect it was written to avoid');

  /* NEGATIVE CONTROL 2 — the empty-note refusal keeps its own wording */
  const empty = driveReviewStep('', '', false);
  assert.strictEqual(empty.toasts.length, 1, 'an empty visit no longer refuses review');
  assert.ok(/Generate the note first/.test(empty.toasts[0].message),
    'the empty-note refusal was replaced by the refusal-text message. They are different ' +
    'problems and must read differently. Got: ' + empty.toasts[0].message);
  assert.notStrictEqual(empty.toasts[0].message, WHY, 'the empty case now says the refusal sentence');

  /* NEGATIVE CONTROL 3 — the in-flight refusal keeps its own wording */
  const running = driveReviewStep(realNote, realNote, true);
  assert.strictEqual(running.toasts.length, 1, 'the in-flight guard stopped answering');
  assert.ok(/still generating/.test(running.toasts[0].message),
    'the in-flight refusal lost its wording. Got: ' + running.toasts[0].message);
  assert.notStrictEqual(running.toasts[0].message, WHY, 'the in-flight case now says the refusal sentence');

  /* NEGATIVE CONTROL 4 — the false-positive class.
     The anchor stays ^: a real note that QUOTES the patient apologising is a
     real note. If the anchor is ever dropped, this is what breaks first, and it
     breaks by refusing to review a finished note. */
  const quotedApology = 'SUBJECTIVE:\nChief Complaint: knee pain.\nHPI: The patient said "I\'m sorry, ' +
    'I cannot remember when it started."\nASSESSMENT:\nOA.\nPLAN:\nInjection.';
  const quoted = driveReviewStep(quotedApology, quotedApology, false);
  assert.strictEqual(quoted.toasts.length, 0,
    'a real note that quotes the patient apologising was refused as a model refusal. The ^ anchor ' +
    'is load-bearing: ' + JSON.stringify(quoted.toasts));
  assert.strictEqual(quoted.advClicks, 1, 'the review did not open for a real note with a quoted apology');

  /* ONE PREDICATE — the drift this section exists to prevent */
  assert.ok(/noteLooksLikeRefusal/.test(fn[0]),
    'openReviewStep does not consult noteLooksLikeRefusal. The refusal reason is painted onto ' +
    'the Next button and then not enforced when it is pressed.');

  const REFUSAL_REGEX_LITERAL =
    "/^\\s*(?:i['\\u2019]?m sorry|i am sorry|i cannot|i can['\\u2019]?t|unable to)/i";
  let regexCount = 0;
  for (let at = 0; (at = connect.indexOf(REFUSAL_REGEX_LITERAL, at)) >= 0; at += 1) regexCount += 1;
  assert.strictEqual(regexCount, 1,
    'the refusal regex literal appears ' + regexCount + ' times in mls-connect.js. It must appear ' +
    'exactly ONCE, inside noteLooksLikeRefusal — a second copy is the paint/door drift this ' +
    'section exists to prevent. (The op-note refusal check carries its own, WIDER literal with ' +
    '"|as an ai" and is deliberately not this one.)');

  /* the paint still reads the same predicate, so tooltip and toast cannot drift */
  const paint = /var rvRefusal = ([^;]+);/.exec(connect);
  assert.ok(paint && /noteLooksLikeRefusal\(noteText\)/.test(paint[1]),
    'syncTopLane no longer paints the dim from noteLooksLikeRefusal — the button and the door ' +
    'are judging the note by two different rules again. Found: ' + (paint && paint[1]));
  assert.ok(connect.indexOf('(rvRefusal ? NEXTGATE_REFUSAL_WHY : ') >= 0,
    'the dimmed button no longer carries NEXTGATE_REFUSAL_WHY, so the tooltip and the toast can ' +
    'say different things about the same note');
}

console.log('PASS review-step-never-fails-silently: an account that cannot reach the Athena ' +
  'review is told so, the check reads inline display only, the message names a real route, and ' +
  'a model refusal is stopped at the door with the same sentence the dimmed button already carried');
