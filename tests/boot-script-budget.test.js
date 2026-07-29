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
const CEILING = 245;
const FLOOR = 200;

/* arm B - deferral. 234 of the 242 are eager; the voice cluster was the first
   deferred one, the calm views the second, vf-1.0.0 / vo-1.0.0 the third and
   fourth, and the studio merge and the voice router the fifth and sixth, so
   EAGER_CEILING deliberately does
   NOT move with CEILING. */
/* 234 -> 195 on 2026-07-29: the boot-deferral batch wrapped 36 single-line
 * eager loaders (Groups A/B/C of the deferral audit - report exporters, note
 * conveniences, one-shot cosmetic fixers) in the idle pattern
 * (requestIdleCallback with a 2500ms timeout, setTimeout(900) fallback,
 * s.async=true). Counted by THIS file's own detector after the change:
 * 195 eager / 50 deferred. The numbers are read from the run, never
 * hand-predicted, because the 400-char lookbehind classifies each name at its
 * FIRST occurrence in the file, which for several assets is a comment far
 * above the loader. Floor set 20 below the ceiling per the failure message's
 * own instruction, so the win is locked in and cannot erode back one feature
 * at a time. */
const EAGER_CEILING = 195;
const EAGER_FLOOR = 175;

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
const INTERVAL_CEILING = 214;

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
