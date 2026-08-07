/* Boot cost must be visible in the gate, not just felt by the doctor.
 *
 * Measured live 2026-07-25 (b581) on the owner's SIGNED-IN tab, warm, and this
 * time in the FOREGROUND, which is what finally reproduced it:
 *
 *   FCP 148ms, load 373ms                    -- the PAGE is fast
 *   Total Blocking Time 10,929ms             -- the app is NOT
 *   16 long tasks, last one ending at 24,568ms
 *   205 asset requests, 204 served from cache, response 0.7ms each
 *   median per-script QUEUE time (startTime -> fetchStart): 6,477ms
 *   aggregate queue 1,274,056ms over a 9,592ms wall span
 *
 * The SAME load in a BACKGROUND tab finishes its script phase in 1.4s with zero
 * long tasks, because a hidden tab skips the rendering work. That is why three
 * previous sessions could not reproduce "26 seconds" and concluded the loader
 * was a red herring. Measure boot in a tab that is actually in front.
 *
 * Theories killed by measurement - do not re-open:
 *   - network            204/205 from cache, 0.7ms response
 *   - parse/exec cost    all 212 scripts execute in 1,728ms total when isolated
 *   - one hot script     three runs blamed three DIFFERENT files; the blob floats
 *   - stylesheet count   196 <style> els, but one insert + forced layout = 1ms
 *   - the SW cache-write 1.7ms per put, ~350ms total (real waste, not the cause)
 *
 * AND THE REQUEST COUNT IS NOT THE CAUSE EITHER. This is the correction that
 * matters most, because both the 2026-07-24 handoff and my own first conclusion
 * said "bundle the feature scripts" and they were wrong.
 *
 * Re-fetched the SAME 205 cached assets through the SAME service worker on the
 * SAME page, with the main thread IDLE:
 *
 *   150 in parallel   124ms total, 0.83ms per request
 *   sequential        3.11ms per request
 *   projected for 205 ~170ms
 *
 * At boot those identical requests span 9,543ms with a 5,659ms median queue.
 * Same URLs, same worker, same cache: 56x. So fetching all 205 costs ~170ms and
 * the other ~9.4s is main-thread contention that the requests are merely QUEUED
 * BEHIND. The 6,477ms queue is a SYMPTOM, not the cause.
 *
 * Bundling 205 -> 1 therefore buys ~170ms of ~9,500ms. It is the highest-blast-
 * radius refactor in the product for a ~2% win, and a bundle still has to
 * execute the same code on the same thread. Do not do it on this evidence.
 *
 * What is actually left is the WORK each module does at boot over a real store:
 * 1,481 patients, 2,166 visits, 471KB, 1.74MB localStorage, 8,154 DOM nodes.
 * getPatients() is memoized (0.1ms first call, 0ms after), so it is not repeated
 * store parsing - it is what 234 modules each DO with it. That is where the next
 * measurement belongs: attribute main-thread time per module with the tab in
 * FRONT, and note that load-event-gap attribution does not work here (three runs
 * blamed three different files).
 *
 * The feature scripts also do not load until AFTER authentication - the login
 * screen is 5 resources - which is exactly why the owner reports this as
 * "it took way too long to login". It is not login.
 *
 * TWO measurements, because the two candidate fixes move different numbers and
 * the previous single measurement was blind to one of them:
 *
 *   A. HOW MANY distinct feature scripts the loader names.
 *      Moves when BUNDLING lands. Was the only arm before.
 *
 *   B. HOW MANY of them are inserted EAGERLY, i.e. during the loader's own
 *      evaluation rather than behind a deferral gate.
 *      Moves when DEFERRAL lands. A deferral fix leaves every name in place, so
 *      arm A would report zero progress on a change that could halve boot time.
 *      That blind spot was called out in the 2026-07-24 handoff; this is it.
 *
 * To earn deferral credit, route the insertion through window.__mlsDeferAsset()
 * or requestIdleCallback. That is deliberately a named, greppable primitive so
 * "deferred" is a fact about the code and not a guess about intent.
 *
 * Both arms are two-sided:
 *   - ABOVE the ceiling fails: boot got more expensive, on purpose or not.
 *   - BELOW the floor fails too: the fix landed, and the pin must be lowered so
 *     the win is locked in and cannot erode back one feature at a time.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '..');
const LOADER = 'mls-connect.js';

/* arm A - request count */
/* 234 -> 235 at b659, deliberately, for feat_mls_voice_cluster.js.
 *
 * Raised rather than dodged, and here is the why this file asks for:
 *   - It is the FIRST module in this loader that is NOT eager. It loads on
 *     requestIdleCallback with a 4s timeout, so it costs nothing at first paint
 *     — which is the cost this ceiling actually guards (the post-login burst on
 *     a main thread 234 modules already compete for), not the ~0.83ms download.
 *   - It REMOVES interface rather than adding it: three bottom-left controls
 *     (Copilot Voice, MLS Assistant, Dictate) become one bubble that expands.
 *     Net chrome goes down; net boot work goes down.
 *   - It could have been folded into an existing feat file to keep the count
 *     flat. That would have been the dishonest version: this slot's established
 *     pattern (feat_mls_copilot_voice_v2.js) is a separately revertible
 *     satellite, and merging three voice controls is exactly the change you
 *     want to be able to back out on its own. */
/* 235 -> 236 at the 2026-07-26 button-liberation rebuild, for
 * feat_mls_calm_views.js. Same three questions as the entry above, answered:
 *   - It is DEFERRED (requestIdleCallback, 4s timeout), so it is not in the
 *     post-login burst this ceiling guards. EAGER_CEILING does not move.
 *   - It REMOVES interface. Measured on a running page: Calendar 58 visible
 *     controls -> 20, AI Studio 33 -> 17. Net chrome goes down.
 *   - It could have been folded into feat_mls_calm_shell.js to keep the count
 *     flat, and that would have been the dishonest version: the shell owns
 *     cross-screen navigation and is the one module you must never have to
 *     revert to undo a per-view layout opinion. These are separately
 *     revertible on purpose (window.__mlsCalmViews.revert()). */
/* 236 -> 238 at b679 (merge of Workers D and E), for feat_mls_visit_focus.js
 * (vf-1.0.0) and feat_mls_visit_voice_one.js (vo-1.0.0). Both are DEFERRED,
 * so EAGER_CEILING below does not move — the cost this ceiling actually
 * guards (the post-login burst) is unchanged, and arm B proves it rather
 * than asserting it.
 *
 * Why they were not folded into an existing feat file to keep the count flat:
 * that is the dishonest version, for the same reason recorded above the voice
 * cluster. Both are presentation-only satellites with their own revert(), and
 * both change what a doctor sees on the two clinical screens — which is exactly
 * the kind of change you want to be able to back out on its own, at 2am, from
 * one call, without disturbing anything else in the file it was hiding in.
 *
 * What they buy, measured on the running page (isolated Chrome, 1280x800,
 * animations finished before every sample), visible interactive controls:
 *   patients, patient open   36 -> 22   and the PRIMARY went 2,405px^2 -> 42,656
 *   visit, visit locked      28 ->  9
 *   visit, note ready        43 ->  8
 * Net interface goes down hard; net boot work does not go up. */
/* 238 -> 239 at the 2026-07-26 studio merge, for feat_mls_studio_merge.js
 * (sm-1.0.0). Owner's order, verbatim: "add the analysis tab to the ai studio
 * tab smartly".
 *
 * The three questions this pin exists to force, answered:
 *   - DEFERRED (requestIdleCallback, 4s timeout), so EAGER_CEILING does not
 *     move and the post-login burst this ceiling actually guards is unchanged.
 *     AI Studio is never the first surface a doctor sees.
 *   - It REMOVES a destination. Analysis stops being a separate tab and
 *     becomes one of three sections of AI Studio; measured on the running
 *     page, the merged surface shows 8 controls at rest where the two
 *     separate tabs showed 18 and 15.
 *   - It could have been folded into feat_mls_calm_views.js to keep the count
 *     flat, and that would have been the dishonest version. This module
 *     re-parents #analysisView and wraps showView — two things you want to be
 *     able to back out on their own, at 2am, from one call, without also
 *     reverting the calendar and history layouts that live in that file. */
/* 238 -> 239 at the 2026-07-26 voice lane, for feat_mls_voice_copilot.js
 * (vcp-1.0.0). The three questions, answered:
 *   - It is DEFERRED (requestIdleCallback, 4s timeout). Nobody can speak to the
 *     app before it is interactive, so a voice router has no business in the
 *     post-login burst. EAGER_CEILING below does not move.
 *   - It carries NO setInterval. It has two one-shot jobs and uses a bounded
 *     setTimeout ladder (25 tries, then inert), so INTERVAL_CEILING does not
 *     move either — deliberately, given what the interval pin below records.
 *   - It could have been folded into feat_mls_copilot_voice_v2.js to keep the
 *     count flat, and that would have been the dishonest version. This module
 *     is the thing that has to be revertible ON ITS OWN: it is the seam between
 *     four microphone surfaces and the Copilot thread, and if the routing is
 *     ever wrong at 2am the fix is one revert() that puts every surface back on
 *     its old path without touching any recognizer. Folding it into a
 *     recognizer-owning module would make backing out the routing mean backing
 *     out a microphone owner. */
/* 240 -> 241 at the same 2026-07-26 voice lane, for feat_mls_audio_capture.js
 * (ac-1.0.0). The three questions again:
 *   - DEFERRED (requestIdleCallback). Its first caller is a microphone the
 *     doctor opens by hand, minutes after boot. EAGER_CEILING does not move.
 *   - No setInterval, no observer, no DOM. It is a pure policy object: it opens
 *     nothing on its own and is called only by code that already had a reason to
 *     open the microphone.
 *   - Not folded into a caller, because it has TWO callers with nothing else in
 *     common (feat_mls_record_backup.js and the recording guard inside
 *     mls-connect.js) and the whole point is that they stop disagreeing about
 *     what the microphone should be doing. Putting the policy inside one of them
 *     recreates the split it exists to close. */
/* 241 -> 242 at the same 2026-07-26 voice lane, for feat_mls_turn_labels.js
 * (tn-1.0.0), the who-said-what engine. Answered:
 *   - DEFERRED (requestIdleCallback). It cannot matter until a recording is
 *     running, which is minutes after boot. EAGER_CEILING does not move.
 *   - No setInterval. Its one observer is scoped to a SINGLE element
 *     (#captureBtn, attributeFilter class), not a document subtree, so it does
 *     not join the multiplicative population the observer ceiling guards. It
 *     repaints only on a real change signature.
 *   - Not folded into the visit lane, deliberately and by instruction: the visit
 *     workspace is being rebuilt by another lane in this same rebuild, and a
 *     turn engine welded into a layout file could not be reverted without
 *     reverting that layout. It is a headless engine with a clean API plus one
 *     inline row, and revert() removes both. */
/* 242 -> 243 at the 2026-07-26 op-note workstream, for feat_mls_opnote_room.js
 * (opr-1.0.0, Stage 0 of OPNOTE_WORKROOM_PLAN_2026-07-26.md — the owner-approved
 * full-screen room). The three questions this pin exists to force, answered:
 *   - DEFERRED (requestIdleCallback, 4s timeout). Op notes are minutes-after-
 *     boot work a doctor opens by hand; the room has no business in the
 *     post-login burst. EAGER_CEILING does not move.
 *   - Stage 0 is HEADLESS AND INERT: no setInterval, no observer, no DOM.
 *     INTERVAL_CEILING and OBSERVER_CEILING do not move, and the later stages
 *     inherit that rule in the module header.
 *   - It could have been folded into feat_mls_calm_views.js or the drafter
 *     satellites to keep the count flat, and that would have been the
 *     dishonest version. The room is the one thing that must be revertible at
 *     2am ON ITS OWN — without reverting the calendar/history/studio layouts
 *     (calm_views) and without touching the drafter machinery (oni/onf/opnp)
 *     that three other modules gate the Fields box on. One revert() puts both
 *     old modals back exactly as they were. */
/* 243 -> 244 at b723, for feat_mls_athena_follow.js (af-1.0.0) — the
 * owner-approved bidirectional Athena<->MLS patient follow. The three
 * questions, answered:
 *   - DEFERRED (requestIdleCallback, 4s timeout): EAGER_CEILING does not move
 *     and the post-login burst this ceiling guards is unchanged. Its
 *     steady-state cost is exactly three event listeners — no setInterval,
 *     no observers; both legs fire on human moments (a patient pick, a tab
 *     arrival), never on a clock.
 *   - It is the ONLY module allowed to auto-drive the athenaOne tab, and that
 *     is precisely why it is not folded into an existing file to keep the
 *     count flat: its off-switch and its 2am revert() must map 1:1 to that
 *     single behavior. Killing follow must not revert the version checker,
 *     the calm shell, or any drafter machinery.
 *   - Net interface change: one Settings checkbox. The feature REMOVES the
 *     manual find-the-patient-again step on both sides of the tab boundary. */
/* 244 -> 245 at b724, for feat_mls_writeback_walkthrough.js (wbw-1.0.0) — the
 * owner's op-note v2 item 5 (better write-back walkthrough). The three
 * questions, answered:
 *   - DEFERRED (requestIdleCallback, 4s timeout): EAGER_CEILING does not move.
 *     Zero timers; two ELEMENT-scoped observers that exist only while the
 *     review overlay is open (the document-wide count below is untouched).
 *   - Not folded into feat_mls_writeflow.js because that file IS the write
 *     lane — the strip is presentation over it, must never be able to change
 *     what sends, and must be revertible on its own without touching a
 *     safety-critical module (the same separation the room keeps from the
 *     drafter machinery).
 *   - It ADDS no controls at all — four status chips and one hint line. */
/* 245 -> 246 at the 2026-07-28 motion request, for feat_mls_motion.js
 * (mo-1.0.0). Owner, verbatim: "I want some awesome animations aple like added
 * to everything ... when copilot comes up have it have like a moving ranbow
 * boarder like apple siri stuff" — and, in the same breath, "make sure not to
 * break anything". The three questions this pin exists to force, answered:
 *   - DEFERRED (requestIdleCallback, 4s timeout): EAGER_CEILING does not move.
 *     It is pure decoration and must never be anywhere near first paint —
 *     the surfaces it touches (the Copilot dock, AI Studio, modals, the
 *     settings tabs) are all minutes-in.
 *     It registers ZERO timers and ZERO observers of any kind, so
 *     INTERVAL_CEILING and OBSERVER_CEILING below — both currently AT their
 *     limit — do not move either. That is not luck: every surface it animates
 *     is revealed by a class the app already toggles (#copilotDock.open,
 *     .modal-bg.show, .set-tab-hidden, body.mls-sm-*), which CSS sees for
 *     free, so there was nothing for a watcher to do.
 *   - Not folded into feat_mls_calm_shell.js or feat_mls_theme_polish.js to
 *     keep the count flat, and that would have been the dishonest version for
 *     the reason recorded above the calm views: the shell owns cross-screen
 *     navigation and is the one module you must never have to revert to undo
 *     a decoration. Motion is the FIRST thing to switch off when a doctor
 *     says the screen feels busy, and switching it off must cost nothing else
 *     — window.__mlsMotion.revert() removes one stylesheet and one body class
 *     and the app is exactly as it was.
 *   - It adds no interface at all: no control, no node, no markup. One
 *     <style> element and one class on <body> is its entire DOM footprint. */
/* 247 (2026-07-29): feat_mls_note_click_to_edit.js (nce-1.0.0).
 *   WHY IT EXISTS: the owner reported that clicking in the middle of the note
 *     did nothing useful. __mlsFormat renders a formatted PREVIEW and sets the
 *     real editor (#noteBox) to display:none whenever the note has content, and
 *     the only control that switched back was the Edit button inside .mlsf-bar
 *     - which the b779 visit-focus fold hides. The note was therefore a dead
 *     surface: the doctor could read it and not edit it. Clicking it now
 *     reveals the editor and places the caret at the character he clicked.
 *   WHY NOT FOLDED INTO AN EXISTING MODULE: the two candidates are the ones it
 *     must not depend on. __mlsFormat is the module that HID the editor, and
 *     feat_mls_visit_focus.js is the fold that hid the Edit control; putting the
 *     recovery inside either means reverting the decoration also removes the
 *     doctor's ability to edit his note. It stays separate so
 *     window.__mlsNoteClickToEdit.revert() undoes exactly this and nothing more.
 *   WHAT IT COSTS: idle-deferred, async, ~4KB, and it adds NO interface - no
 *     control, no node, no markup, no stylesheet. One capture-phase click
 *     listener is its entire footprint, and it never writes the note's text
 *     (display/focus/selection only), so it cannot corrupt a note. */
/* 248 (2026-07-29): feat_mls_polish_everywhere.js (pe-1.0.0).
 *   WHY IT EXISTS: the owner said it plainly - "you have not added beaturifl
 *     animation anywhere but to copiloit". He was right. mo-1.0.0 targeted the
 *     Copilot/AI surfaces and a few narrow selectors, so the surfaces he spends
 *     the day in - .card (42 instances), .ez3-card, the .ez3-row2 schedule rows
 *     he taps to start a visit, .pt-item, and the 380+ btn-* controls - stayed
 *     completely static. This applies the SAME token vocabulary to those.
 *   WHY NOT FOLDED INTO mo-1.0.0: motion is the first thing to switch off when
 *     a doctor says the screen feels busy, and the two layers have different
 *     blast radii - mo-1.0.0 decorates the AI surfaces, this one touches every
 *     card and row in the product. Keeping them separate means
 *     window.__mlsPolishEverywhere.revert() can calm the whole app without
 *     also removing the Siri ring he explicitly likes, and vice versa.
 *   WHAT IT COSTS: idle-deferred, async, ~5KB, ONE <style> element and nothing
 *     else - no control, no node, no markup, no timer, no observer. Entrances
 *     key off the .view-enter class showView already sets, and every rule is
 *     transform/opacity only, excluded from clinical text, and stood down under
 *     prefers-reduced-motion by a block generated from the rule table. */
/* 249 (2026-07-29): feat_mls_magic.js (mg-1.0.0).
 *   WHY IT EXISTS: the owner asked to "really just make the site feel majical".
 *     Magic is not more motion - mo-1.0.0 owns the Copilot ring and pe-1.0.0 owns
 *     everyday entrances. This owns the five MOMENTS that carry meaning: a note
 *     arriving, a completion drawing its own check, a stage advancing, waiting,
 *     and the banner patient changing.
 *   WHY NOT FOLDED IN: the three layers have different blast radii and different
 *     reasons to be switched off. A doctor who finds celebration wrong for a
 *     medical record should be able to remove the MOMENTS without losing the
 *     press feedback on 380 buttons (pe) or the AI ring he likes (mo).
 *     window.__mlsMagic.revert() does exactly that and nothing else.
 *   WHAT IT COSTS: idle-deferred, async, ~5KB, ONE <style> element - no control,
 *     no node, no markup, no timer, no observer, no rAF. Only transform/opacity/
 *     stroke-dashoffset animate; clinical text is excluded outright; every moment
 *     stands down while recording; and the reduced-motion block is generated from
 *     the MOMENTS table so a rule cannot ship without its off-switch. */
/* 249 -> 250 at the 2026-07-29 op-note/Templates rebuild, for
 * feat_mls_opnote_templates_ui.js (ot-1.0.0). The three questions:
 *   WHY IT EXISTS: the owner asked for both screens redone from scratch, and a
 *     generated inventory of those two subtrees found 23 ids referenced across
 *     20 modules, 47 writes, and 102 STRUCTURAL dependencies (parent/sibling
 *     walks and dynamically-built ids) that break SILENTLY on a nesting change.
 *     Four of them carry real features: the Prev/Next pager needs #opPrepList to
 *     stay a direct child of #oprEditor; the Fields box is found as the previous
 *     sibling of textarea#opPrepNote_<i>; the template-health badge is written
 *     through select#opPrepTpl_<i>.parentElement; the template-health panel
 *     mounts as a sibling of #tplList. So the redo HAD to be a pure stylesheet,
 *     and a stylesheet that replaces another module's stylesheet is exactly the
 *     kind of thing that must be one file you can point at and switch off.
 *   WHY NOT FOLDED IN: the obvious home is feat_mls_opnote_room.js, which owned
 *     the old #oprSkin. Folding was seriously considered and rejected for one
 *     reason: that module also owns the ESC handler, the Templates reparenting,
 *     the opPrepRender wrapper and the Fields-box synchronous kick. If the new
 *     look is wrong at 2am, the fix must not require reverting the reparenting
 *     that puts Templates in the room. One revert() returns the pixels and
 *     touches no behaviour. Folding would have made "I don't like the spacing"
 *     and "Templates went missing" the same rollback.
 *   WHAT IT COSTS: idle-deferred (requestIdleCallback, 1800ms timeout), async,
 *     ONE <style> element and ONE body class. It builds no node, moves no node,
 *     renames nothing, runs no timer, no rAF and no observer - the grip fence
 *     tests/opnote-templates-grips-survive-redesign.test.js fails if it ever
 *     mutates a gripped subtree. EAGER_CEILING does not move; INTERVAL_CEILING
 *     does not move. Wide-only rules are gated behind @media (min-width:901px)
 *     so they cannot repeat the append-order defect that killed this room's
 *     responsive layout, and the reduced-motion block is generated from the
 *     MOVING table. */
/* 250 -> 252 at the same 2026-07-29 lane, for feat_mls_ui_clinical.js (uc-1.0.0)
 * and feat_mls_ui_shell.js (uish-1.0.0). Answered together because the answers
 * are the same, and with a caveat recorded honestly at the end.
 *   WHY THEY EXIST: the owner's standing complaint was that only Copilot looked
 *     finished. These two carry the rest, split by surface: uc owns the clinical
 *     column, uish owns the shell and dialogs. uc exists because a measured
 *     audit found four READ-ME states that the white-card equalizer at
 *     mls-connect.js:6139 silently flattened - a COMPLETED visit-flow step was
 *     pixel-identical to one not started (same colour, same background, same
 *     border), the day row's hover was white-at-5% on a white card, "already
 *     seen" was carried by opacity alone, and the amber chip family disagreed
 *     with itself. Every one of those is state a doctor is meant to read.
 *   WHY NOT FOLDED IN: they were written against separate contracts and each
 *     ships its own gate (ui-clinical-pass, ui-shell-pass). More to the point
 *     they have different blast radii: the clinical column is where a visit is
 *     conducted, the shell is where settings and dialogs live, and "the dialogs
 *     look wrong" must not require reverting the visit surface. Folding them
 *     into each other, or into the op-note module above, would make one bad
 *     judgement call cost all three.
 *   WHAT THEY COST: both idle-deferred (2200ms / 2400ms timeouts), async, ONE
 *     <style> and ONE body class each, no node built or moved, no timer, no rAF,
 *     no observer, no listener but DOMContentLoaded. uish carries no animation
 *     at all. EAGER_CEILING and INTERVAL_CEILING do not move.
 *   THE CAVEAT, stated plainly: this lane added THREE scripts, and the standing
 *     finding on this app is that slow login is not login - it is ~177 cached
 *     scripts serialising, and the fix is FEWER REQUESTS. Three more idle
 *     stylesheet fetches is the wrong direction even though each is individually
 *     cheap. The right move is a single concatenated presentation bundle for the
 *     whole look-and-feel layer (mo, pe, mg, ot, uc, uish - six modules, six
 *     requests, zero behaviour between them). That needs a build step this repo
 *     does not have, so it is recorded here as owed rather than pretended away.
 *     Do not raise this ceiling again for a stylesheet module; bundle instead. */
/* 2026-08-05 cpw-1.0.0 (owner-ordered Copilot Power): +1 loader,
 *   feat_mls_copilot_power.js — the Copilot's app-wide senses and its
 *   confirm-by-tap agentic executors (pullProviders/draftNote).
 *   - DEFERRED (requestIdleCallback, 2.5s timeout): the Copilot cannot be
 *     asked anything before sign-in completes, so EAGER_CEILING does not move.
 *     No timers, no observers; lifecycle events only.
 * 2026-08-05 av-1.0.0 (owner-ordered AVATAR): +1 loader, feat_mls_avatar.js —
 *   the doctor side of the patient-facing check-in interviewer (program the
 *   questions, ready badge, bullet inbox, one-tap chart import).
 *   - DEFERRED (requestIdleCallback, 2.5s timeout): check-ins are read
 *     minutes-to-hours after boot, so EAGER_CEILING does not move. Badge
 *     refresh is event-driven (app-ready + tab refocus, 2-min floor) — no
 *     permanent polling; the bounded mount ladder mirrors the request inbox.
 *
 * 2026-08-05 td-1.0.0 (owner-ordered POST-OP VIDEO VISIT): +1 loader,
 *   feat_mls_tele_doctor.js — the doctor's accept-and-call surface for a
 *   patient asking to talk after a procedure.
 *   - DEFERRED (requestIdleCallback, 3s timeout): a request that arrives is
 *     minutes old by definition, so EAGER_CEILING does not move.
 *   - NO STANDING INTERVAL, which is why this is +1 script and +0 pollers.
 *     It makes ONE request per session and then STANDS DOWN PERMANENTLY if the
 *     route is absent (404/501/unreachable) — the telehealth backend is on a
 *     branch, so on today's production this module costs exactly one fetch and
 *     then nothing, forever. When the backend does deploy it re-arms on a
 *     bounded setTimeout chain that never schedules while the tab is hidden and
 *     resumes on visibilitychange.
 *   - Renders nothing at all unless a real pending request comes back, so its
 *     boot work over a 1,481-patient store is a single conditional. */
/* 2026-08-07 opdb-1.0.0 (owner-ordered OP-NOTE DAY BRAIN): +1 loader,
 *   feat_mls_opnote_daybrain.js — AI-assisted template matching layered over
 *   the deterministic ranker, and the procedure-aware day triage that stops
 *   "Draft all op notes" writing an operative note for a patient who never had
 *   a procedure.
 *   - DEFERRED (requestIdleCallback, 2.5s timeout), so EAGER_CEILING does not
 *     move and the post-login burst this ceiling guards is unchanged. Op notes
 *     are minutes-after-boot work by definition — the surface does not exist
 *     until the doctor opens the op-note room by hand.
 *   - NO INTERVAL and NO OBSERVER, so INTERVAL_CEILING and OBSERVER_CEILING do
 *     not move either. It waits for feat_mls_opnote_integrity.js on a BOUNDED
 *     setTimeout ladder (25 tries at 400ms, then inert), which is the same
 *     pattern the request inbox uses, and one delegated document click
 *     listener — not a listener per row.
 *   - Its boot work over a 1,481-patient store is ZERO: every entry point is a
 *     wrapper that only does work once window._opPrep exists, which requires
 *     openOpPrep() to have run. Nothing is read, parsed or rendered at install.
 *   - The AI hop is strictly on demand, sequential (never a burst), and only
 *     for rows the deterministic matcher itself declined to call confident.
 *     With no key and no session it never fires at all and the surface falls
 *     back to exactly today's deterministic behaviour. */
const CEILING = 256;
const FLOOR = 200;

/* arm B - deferral. 234 of the 242 are eager; the voice cluster was the first
   deferred one, the calm views the second, vf-1.0.0 / vo-1.0.0 the third and
   fourth, and the studio merge and the voice router the fifth and sixth, so
   EAGER_CEILING deliberately does
   NOT move with CEILING. */
/* 234 -> 196 on 2026-07-29: the boot-deferral batch leaves 34 safe
 * single-line loaders in the idle pattern. Patient Reach and Code Table were
 * restored to the ordered eager tail after measured first-use dependency
 * failures. Counted by THIS file's detector after the correction:
 * 196 eager / 49 deferred. Patient Reach is already classified eager because
 * its first textual reference precedes its loader; the exact loader contract
 * is therefore enforced in late-surfaces-stay-deferred.test.js. Floor remains
 * 20 below the ceiling per the failure message's own instruction, so the
 * remaining win cannot erode back one feature at a time. */
/* 196 -> 168 on 2026-08-02: the 28-loader idle sweep — analyzed-safe satellite loaders moved in place to the requestIdleCallback pattern (168 eager / 84 deferred). Floor stays 20 below per the failure message's own instruction. */
const EAGER_CEILING = 168;
const EAGER_FLOOR = 148;

/* A window of source before the reference is enough to tell how the insertion
 * is scheduled: these loader lines are single self-contained IIFEs. */
const LOOKBEHIND = 400;
const DEFER_MARKER = /requestIdleCallback|__mlsDeferAsset\(/;

const src = fs.readFileSync(path.join(ROOT, LOADER), 'utf8');
/* feat_ and NOT feat_mls_. The narrower form watched 164 of the 234 scripts the
 * loader actually names and missed 70 - the whole feat_athena_* family (24),
 * feat_visit*, feat_opnote_*, feat_autosave, feat_save_verify, feat_task3_*.
 * A ceiling with a 30% blind spot cannot do the job this file's header claims:
 * anyone could add feat_athena_anything.js forever and never trip it. */
const refs = new Set(src.match(/feat_[a-z0-9_]+\.js/g) || []);
const n = refs.size;

let eager = 0;
let deferred = 0;
const seen = new Set();
const re = /feat_[a-z0-9_]+\.js/g;
let m;
while ((m = re.exec(src))) {
  if (seen.has(m[0])) continue;
  seen.add(m[0]);
  const window_ = src.slice(Math.max(0, m.index - LOOKBEHIND), m.index);
  if (DEFER_MARKER.test(window_)) deferred++; else eager++;
}

let failed = false;

if (n > CEILING) {
  failed = true;
  console.error(
    '\nFAIL: ' + LOADER + ' now loads ' + n + ' feature scripts, up from ' + CEILING + '.\n' +
    'The cost of an added module is the WORK IT DOES at boot over a 1,481-patient\n' +
    'store on a main thread 234 other modules are already competing for - NOT its\n' +
    'download, which is ~0.83ms. Give it real work to do only when the screen that\n' +
    'needs it opens, defer it past first paint, or raise CEILING and say why.\n'
  );
}

if (n < FLOOR) {
  failed = true;
  console.error(
    '\nFAIL (good news): ' + LOADER + ' now names only ' + n + ' feature scripts,\n' +
    'below the floor of ' + FLOOR + '. Fewer modules run at boot. Lower CEILING and\n' +
    'FLOOR to the new numbers so the improvement is locked in.\n' +
    'NOTE: if this dropped because of BUNDLING, re-measure before celebrating -\n' +
    'fetching all 205 assets costs ~170ms, so a bundle alone moves almost nothing.\n'
  );
}

if (eager > EAGER_CEILING) {
  failed = true;
  console.error(
    '\nFAIL: ' + eager + ' feature scripts are inserted eagerly, up from ' + EAGER_CEILING + '.\n' +
    'Eager insertions all compete for dispatch during the same post-login burst.\n' +
    'Route it through window.__mlsDeferAsset() or requestIdleCallback, or raise\n' +
    'EAGER_CEILING deliberately and say why.\n'
  );
}

if (eager < EAGER_FLOOR) {
  failed = true;
  console.error(
    '\nFAIL (good news): only ' + eager + ' feature scripts are still eager, below the\n' +
    'floor of ' + EAGER_FLOOR + ' (' + deferred + ' deferred). Deferral has landed. Lower\n' +
    'EAGER_CEILING and EAGER_FLOOR so the win cannot erode back.\n'
  );
}

/* ---- arm C: what the modules DO, which is where the time actually goes ----
 *
 * Arms A and B count files. This one counts the two constructs that make 234
 * cheap modules expensive together, and it is the arm the measurements point at:
 *
 *   - a document-wide subtree MutationObserver reacts to EVERY DOM change made
 *     by every other module. During boot all 234 are mutating, so the cost is
 *     mutations x observers, not per-module.
 *   - a setInterval never stops. 200+ of them are a permanent background load,
 *     which is also why a long task shows up ~22s after load with nothing left
 *     to boot.
 *
 * This also explains the two things single-module attribution could not: why no
 * single script ever owns the blob (the work belongs to the observers reacting
 * to everyone else), and why a BACKGROUND tab reads 1.4s (observers still fire,
 * but the style and layout they dirty is never computed).
 *
 * tests/interaction-performance-contract.test.js already polices named modules
 * for exactly these two constructs. This is the population-level pin so the
 * total cannot grow while each individual addition looks reasonable. */
const featFiles = fs.readdirSync(ROOT).filter((f) => /^feat_.*\.js$/.test(f));
let docObservers = 0;
let intervals = 0;
for (const f of featFiles) {
  const s = fs.readFileSync(path.join(ROOT, f), 'utf8');
  docObservers += (s.match(/observe\(\s*document(?:\.documentElement|\.body)?\s*,\s*\{[^}]*subtree\s*:\s*true/g) || []).length;
  intervals += (s.match(/setInterval\s*\(/g) || []).length;
}

const OBSERVER_CEILING = 59;   // 60 at b596; one retired when the caption double-escape was fixed at source
/* 215 (2026-08-02): +1 for the copilot stale-request watchdog (standing
 * review #10) — it exists only while a request is in flight and is cleared
 * in the settle/finally/revert paths, so it is a bounded guard, not a
 * forever-poller. The same change DELETED two permanent whole-document
 * constructs elsewhere (the zero-hit legacy-sign observer and the fixpack
 * prefill wrappers), so the app's steady-state timer load went DOWN. */
const INTERVAL_CEILING = 215;

if (docObservers > OBSERVER_CEILING) {
  failed = true;
  console.error(
    '\nFAIL: ' + docObservers + ' document-wide subtree MutationObservers, up from ' +
    OBSERVER_CEILING + '.\nEach one runs on every DOM change every other module makes, so this is\n' +
    'multiplicative during boot. Scope the observer to the subtree it cares about\n' +
    '(see feat_mls_centerpiece.js, which is scoped to #visitView), or raise the\n' +
    'ceiling deliberately and say why.\n'
  );
}
if (intervals > INTERVAL_CEILING) {
  failed = true;
  console.error(
    '\nFAIL: ' + intervals + ' setInterval pollers across feature modules, up from ' +
    INTERVAL_CEILING + '.\nAn interval never stops. Prefer an event, a MutationObserver scoped to the\n' +
    'subtree, or a bounded set of timeouts, or raise the ceiling and say why.\n'
  );
}

assert(n > 0, 'expected to find feature-script references in ' + LOADER);
assert.strictEqual(eager + deferred, n, 'every referenced script must be classified eager or deferred');
assert(docObservers > 0 && intervals > 0, 'arm C found nothing - the detectors are broken, not the code');

if (failed) { process.exit(1); }

console.log(
  'boot-script-budget: OK (' + n + ' feature scripts, ceiling ' + CEILING + '; ' +
  eager + ' eager / ' + deferred + ' deferred, eager ceiling ' + EAGER_CEILING + '; ' +
  docObservers + ' document-wide observers, ' + intervals + ' intervals)'
);
