# Standing code review — 2026-07-30, build b800

Four reviewers, one defect class each. 39 findings: 3 blocker, 9 high, 14 medium, 13 low.

Every finding carries a file:line citation. Ranked by whether a DOCTOR is misled or harmed.

## 1. [BLOCKER] The chart-pull's save verification reads FOUR field names that the verifier never returns (`count`, `partial`, `verified`, `expected`), so a verification that PROVED visits are missing from the store reports the reassuring "Saved to MLS — re-reading the store to confirm…", and the "Save incomplete" warning is unreachable code. Truthful message: "⚠ Only 4 of 11 visits reached this patient's record — 7 are missing. Re-run the pull."

**What the doctor sees:** On a fully successful pull: a green terminal line reading "✓ Saved undefined visits into <name>'s MLS record — re-read and verified." On a pull whose visits did NOT land: the step turns to a resolved dot and the panel ends on the neutral "Saved to MLS — re-reading the store to confirm…" — a sentence that reads as done and never resolves. The doctor moves to the next patient believing history was captured; feat_athena_actions.js has already proven it was not.

**Evidence:**

feat_athena_actions.js:202-210 (prod-loaded, mls-connect.js `data-mls-asset="feat_athena_actions.js"`):
```
Promise.resolve(sv.verifyVisitsSaved(identity, visits)).then(function (res) {
  if (res && res.ok) {
    finishOk('✓ Saved ' + res.count + ' visit' + (res.count === 1 ? '' : 's') +
      ' into ' + esc(ptName) + '’s MLS record — re-read and verified.');
  } else if (res && res.partial) {
    finishFail('⚠ Save incomplete — ' + res.verified + ' of ' + res.expected +
      ' verified. Missing: ' + (res.missing || []).join(', '), 'Re-run the pull for the missing item(s).');
  } else {
    finishInfo('Saved to MLS — re-reading the store to confirm…');
  }
```
The verifier's actual shape, feat_save_verify.js:171-194:
```
var result = {
  type: 'visits', ok: false, patientFound: false,
  expectedCount: expected.length, savedCount: 0,
  missing: [], mismatches: [], layer: 'local', ts: new Date().toISOString()
};
...
result.ok = (result.expectedCount > 0) && (result.savedCount === result.expectedCount) && (result.mismatches.length === 0);
```
Grep of feat_save_verify.js for `count:` / `.count =` returns zero hits — there is no `count`, no `partial`, no `verified`, no `expected` anywhere in the file. `res.partial` is therefore permanently `undefined`, so every non-ok verdict (patient not found in store, visits missing, field mismatches) falls to the `else`.
Same function, feat_athena_actions.js:217-218, discards the scan report entirely and claims it as proof:
```
try { Promise.resolve(sv.scan()).then(function () {
  finishOk('✓ Pulled into ' + esc(ptName) + '’s MLS record — verified by the save-check below.');
```

---

## 2. [BLOCKER] feat_mls_store_cache.js replaces window.getPatients with a wrapper that NEVER calls the original, so it silently strips the rowguard's `__mlsReadGen` generation stamp and bypasses the open-batch branch. Rowguard 2.0's precise generation rule is dead code, and during a managed pull every reader sees a stale roster.

**What the doctor sees:** A day pull that reports success but silently loses chart facts, and "N saves not confirmed" returning even though rowguard 2.0 was supposedly shipped to stop it. The generation-stamp fix he paid for never fires in production — every save falls back to the older wall-clock heuristic — and mid-pull, patient rows re-upserted inside the same 15-second batch are merged against a roster that predates them, which is precisely how coverage/snapshot fields got rolled back before.

**Evidence:**

feat_mls_store_cache.js:146 `wrapPair('getPatients', 'patients');` and :131 `window[getName] = wrapped;`. The wrapper returns only `cache.val.slice()` (:103, :116) or `v.slice()` (:126) — `orig()` is called ONLY on `!api.enabled` (:95), missing key (:99) or a thrown error (:106). The file contains ZERO references to `__mlsReadGen`, `__mlsPtsStampRead`, or `__mlsPtsBatchByKey` (verified by grep: count 0).

What that discards, in ScribeFlow.html:
(1) :9446 `function __mlsPtsStampRead(a){ try{Object.defineProperty(a,'__mlsReadGen',{value:__mlsPtsGen,configurable:true});}catch(e){} return a; }` is the ONLY writer of `__mlsReadGen` (grep: only 9447 writes, only 9466 reads), and it is called only from the base getPatients at :9309/:9311/:9314. With the wrapper installed no caller array carries it, so at :9466 `var callerGen=(typeof arr.__mlsReadGen==='number')?arr.__mlsReadGen:-1;` callerGen is ALWAYS -1, and the branch at :9476 `}else if(typeof g==='number'&&callerGen>=0){ keep=callerGen<g; /* precise: the caller's snapshot predates this row */` can never be taken. Every removal decision falls through to the 1.0 clock rule at :9480 `keep=(at>0)&&(now-at)<=__MLS_PTS_ROWGUARD_MS;`.
(2) Base getPatients at :9308-9309 `var key=uns('patients'),batch=__mlsPtsBatchByKey[key]; if(batch&&batch.depth>0&&Array.isArray(batch.arr))return __mlsPtsStampRead(batch.arr.slice());`. The wrapper never consults the batch. feat_mls_schedimport_exact.js:224 opens one for every managed pull: `return api ? api.begin({ label: String(label || "managed-pull"), maxChanges: 12, maxDelayMs: 15000 }) : null;` — so the batch stays unflushed for up to 12 changes or 15 s.
(3) During that window ScribeFlow.html:9651 `const arr=getPatients(); const i=arr.findIndex(x=>x.id===p.id);` inside `upsertPatient` reads 

---

## 3. [BLOCKER] AI-generated custom-widget clinical text survives a patient switch. `_cwLatest` is keyed by widget id only, neither openPatient nor newVisit clears it, and cwPushToNote has no patient/binding guard — so patient A's generated text can be appended to patient B's note.

**What the doctor sees:** Generate widgets on patient A, switch to patient B, generate B's note, click "➕ Add to note" on a custom widget — patient A's AI-generated clinical text is appended to patient B's note under a titled header, and the app toasts success. Wrong-patient content in a signed note.

**Evidence:**

ScribeFlow.html:28847 `const _cwLatest={};             // widgetId -> latest RAW model reply (this session)` — keyed by widget, scoped to the session, not the patient.

Nothing clears it on a patient switch. ScribeFlow.html:14940 `function openPatient(id){ if(!id) return; _athenaResetSuperbill(true); setActivePtId(id); renderPatients(); renderProfile(); renderPatientBar(); }` — the superbill is reset, the widgets are not. `newVisit()` (:17067-17118) clears ~40 clinical variables explicitly (`currentSoap=''; currentInsurance=''; currentCoding=null;` at :17083, `currentAVS=''; currentReferral='';` at :17085 …) and calls `_resetAiVisitOutputs()` at :17076 — but that function only touches two elements: :19445 `['revToolsOut','dsOut'].forEach(function(id){`. `newVisit` merely COLLAPSES the widget cards, leaving the content inside: :17099 `if(typeof COLLAPSIBLE_EXTRA_IDS!=='undefined'){ COLLAPSIBLE_EXTRA_IDS.forEach(id=>{const c=document.getElementById(id); if(c){ c.classList.remove('open');`.

Worse, the renderer actively RESTORES it: :29713 `if(_cwLatest[w.id]) cwRenderOutput(w,_cwLatest[w.id]);`.

And the insert path has no patient check: :30238 `function cwPushToNote(id){` … :30245 `if(!content && _cwLatest[w.id]) content=cwParseLayoutContent(w.layout,_cwLatest[w.id]);` … with a DOM fallback that reads the stale mirror :30248-30249 `const mirror=document.getElementById('cwText_'+w.id); serialized=(mirror&&mirror.textContent||'').trim();`. The only gate is :30253 `if(!currentSoap && !currentInsurance){ toast('Generate a note first.','err'); return; }` — it asks whether A note exists, never whose. Contrast the sibling AI path at :19461, which does check: `if(!currentVisitAthenaBinding){toast('Generate or open this note inside the correct patient visit before running this to

---

## 4. [HIGH] The Status Center treats ANY DOM mutation inside a container as proof the pulled data landed there, then writes four positive claims about work it never checked — and separately paints a step saying it "Compared the pulled day against your calendar" when no comparison code exists. Truthful message: "Calendar re-rendered — MLS did not verify the pulled visits are in it. Open the Calendar day to check."

**What the doctor sees:** In the Status Center dock: green ✓ step lines "Calendar updated with the pulled visits", "Patient selector updated", "MLS Easy updated", "Who's Next updated", and "✓ Checking for missing visits — Compared the pulled day against your calendar", plus green source dots. Every one of these can appear over a pull that delivered nothing, because the only thing measured was that some node changed. The surface built to tell him whether the pull landed cannot tell him.

**Evidence:**

feat_mls_status_center.js:980-999 (prod-loaded, mls-connect.js:42901):
```
function watchArea(key, selectors, workingLabel, okLabel, warnLabel) {
...
  var mo = observeSession(node, function () {
    if (fired) return; fired = true;
    srcSet(key, 'ok', okLabel);
    stepUpsert('upd_' + key, okLabel, 'done', '');
    safe(function () { mo.disconnect(); });
  }, { childList: true, subtree: true });
```
The labels supplied at feat_mls_status_center.js:926-929 are positive assertions about the pull's effect:
```
watchArea('calendar', ['#calDayPanel', '#calendarView', '[id*="calendar" i]'], 'Updating MLS calendar', 'Calendar updated with the pulled visits', ...);
watchArea('selector', ['#patientSelect', ...], 'Updating patient selector', 'Patient selector updated', ...);
watchArea('easy', ['#mlsEasy', ...], 'Updating MLS Easy', 'MLS Easy updated', ...);
```
plus feat_mls_status_center.js:1017 `srcSet('matching', 'ok', 'Who’s Next updated');` on the same any-mutation trigger. A `childList`+`subtree` observer fires on a spinner insert, a tooltip, a re-render that produced nothing — the repo has already measured 86 no-op class writes in 44s on this app. The header comment at line 925 asserts the opposite of what the code does: `// watch DOM areas so "updated" is EVIDENCE, not hope`.
Separately, feat_mls_status_center.js:961 fabricates a step for work no code performs:
```
stepUpsert('missing', 'Checking for missing visits', 'done', 'Compared the pulled day against your calendar.');
```
It is emitted purely because the hero status text matched `/✅|Finished|already on your calendar|No new appointments found/i` at line 954. There is no comparison anywhere in the mirrorHero path.

---

## 5. [HIGH] The pull progress chip declares "Pull finished." with a green Done label purely from the DISAPPEARANCE of the busy heartbeat stamp — and the pull engine clears that stamp identically on its success path and its rejection path. A pull that threw renders as a completed pull. Truthful message: "The pull stopped. MLS could not confirm it finished — check the pull receipt before relying on today's schedule."

**What the doctor sees:** The progress chip flips from a spinner to a green "Done — Pull finished." A pull that crashed, was refused by the cross-tab shield, or is still walking charts in a background tab is indistinguishable from one that completed. He closes athenaOne and starts his day on a schedule that was never imported.

**Evidence:**

feat_mls_progress_stages.js:665-686 (prod-loaded, mls-connect.js:46869):
```
var fresh = freshest > 0 && (now() - freshest) < 90000;
var aged = freshest > 0 && !fresh && (now() - freshest) < 360000;
if (fresh || aged) {
  ...
} else if (cur) {
  finish('pull', 'complete', 'Pull finished.');
  pullWatch.lastStamp = 0; pullWatch.lastNote = '';
}
```
`finish(...,'complete',...)` routes to `cur.handle.complete(message)` (feat_mls_progress_stages.js:163-169) and the terminal chip label is `completed: 'Done'` (line 528) on the green `.ps-chipst.completed{background:#DCFCE7;color:#166534}` (line 488). No receipt, count, or store census is consulted.
The stamp it reads is cleared the same way on both outcomes — feat_mls_schedimport_exact.js:3498-3513:
```
return Promise.resolve(operation).then(function (value) {
  pullRunning = false;
  ...
  safe(function () { window.__mlsPullBusyAt = 0; });
  if (operationStarted) xtabBusyClear();
  ...
  return value;
}, function (error) {
  pullRunning = false;
  ...
  safe(function () { window.__mlsPullBusyAt = 0; });
  if (operationStarted) xtabBusyClear();
  ...
  throw error;
});
```
The rejection handler is byte-for-byte the success handler plus `throw`. Additionally the 6-minute `aged` ceiling is measured with `setInterval` (line 689 `pullWatch.iv = setInterval(pullTick, 3000)`), which this repo has measured ticking 0 times in 30,058ms in a hidden tab — so a still-running cross-tab pull can also cross the ceiling and be declared finished.

---

## 6. [HIGH] The one-click "Pull from Athena" reports the patient's TOTAL number of stored visits as the number this pull captured, discarding the honest saved-count that is sitting in a variable two lines above. A pull that saved nothing reports the whole pre-existing chart as pulled. Truthful message: "Done — 0 new visits captured for <name> (37 already on file)."

**What the doctor sees:** The chip's final line: "✓ Done — 37 visits pulled for <name>." when this run captured zero (every row refused by the identity veto, or all duplicates). The number is large and green, so it reads as the strongest possible confirmation. The transient honest "Saved 0 visits" flashes past under an AI-summary message.

**Evidence:**

feat_athena_autopull.js:181-191 (prod-loaded):
```
var saved = 0;
try { saved = cv._saveVisits(patient, identity, visits, function (msg) { if (msg) status(onStatus, msg); }); }
catch (e) { status(onStatus, '⚠ ' + (e && e.message || 'Save failed') + '.', true); hideChipLater(); return; }
status(onStatus, 'Saved ' + saved + ' visit' + (saved === 1 ? '' : 's') + '. Generating AI summaries…');
...
var n = saved; try { n = M.getVisits(patient).length; } catch (e) {}
status(onStatus, '✓ Done — ' + n + ' visit' + (n === 1 ? '' : 's') + ' pulled for ' + identity.name + '.', true);
hideChipLater(12000);
return { ok: true, saved: saved, total: n, created: r.created };
```
`M` is `window.__mlsVisitModel` (line 141) and `getVisits` returns the entire stored array — feat_visits.js:322-331:
```
function getVisits(p) {
  if (!p) return [];
  var vs = Array.isArray(p.visits) ? p.visits.slice() : [];
  ...
  return vs;
}
```
So `n` is every visit already on the record from any prior pull or manual entry. The honest `saved` value is computed, shown for one frame, then overwritten in the terminal line and reported as "pulled". The return value is `ok: true` even when `saved === 0`.

---

## 7. [HIGH] The Visit-view widget deck's rebuild cache key contains no patient identity, so after a patient switch it keeps mirroring the previous patient's widget bodies into the visit room every 1200 ms.

**What the doctor sees:** He opens patient B's visit room and sees the previous patient's AI-generated widget content already sitting there, refreshed onto the screen once a second, with a live "Add to note" button next to it. This is the surface that makes the blocker above easy to trigger by accident.

**Evidence:**

feat_mls_widget_deck.js:208-211 builds the key from widget DEFINITIONS only — `var key = 'review:' + review.hiddenCount + ':' + review.titleConflictCount + '|' + list.map(function (w) { var semantic = ...; return JSON.stringify([w.id, semantic, w.emoji || '', w.description || '', w.auto !== false, w.originKey || '']); }).join('|');` — no patient id, no visit id. :212-216 `if (key !== lastKey) { lastKey = key; deck.innerHTML = skeleton(list); wire(deck); } mirrorBodies(deck, list);` — a patient switch does not change the key, so the deck is never rebuilt and `mirrorBodies` runs unconditionally: :189-196 `var src = $('cwBody_' + list[i].id); … var html = src ? src.innerHTML : ''; if (dst.__mirror !== html) { dst.innerHTML = html; dst.__mirror = html; }`. Driven forever by :270 `iv = setInterval(function () { safe(sync); safe(ensureChips); safe(wrapRenderOutput); }, 1200);` and its own button routes straight into the unguarded inserter at :185 `else safe(function () { window.cwPushToNote(id); });`. The module installs unconditionally — the only guard is idempotence (:24 `try { if (window.__mlsWidgetDeck && window.__mlsWidgetDeck.installed) return; } catch (e) { return; }`).

---

## 8. [HIGH] 78 whole-document `subtree:true` MutationObservers are armed simultaneously; the worst one runs matches + closest + a full-subtree querySelector for every mutated node, on an observer that also fires for every inline-style and class write anywhere in the app.

**What the doctor sees:** The "it freezes when I click around" and "typing lags" reports. Cost is proportional to total DOM churn, so it is worst exactly when the app is busiest — during a day-pull render or while an AI note streams in — and it is invisible in any single-feature profile because the work is attributed to whatever code caused the mutation.

**Evidence:**

Measured across ScribeFlow.html + mls-connect.js + the 127 dynamically loaded feat assets: 151 total `.observe(` calls, 78 of them targeting `document.body`/`document.documentElement` with `subtree:true`, 5 of those also `attributes:true`.

The worst is feat_mls_easy.js:606-619 `_bootObs.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'style', 'aria-pressed'] });` — the `style` filter means every `el.style.x = …` write anywhere queues it, and `characterData` means every keystroke of a streaming note does too.

Its callback does no cheap pre-filter. :596-604 `function relevantMutations(records) { for (var i = 0; i < records.length; i++) { var r = records[i]; if (relevantNode(r.target)) { return true; } for (var j = 0; j < r.addedNodes.length; j++) { if (relevantNode(r.addedNodes[j])) { return true; } } for (var k = 0; k < r.removedNodes.length; k++) { if (relevantNode(r.removedNodes[k])) { return true; } } } return false; }` and :588-593 `function relevantNode(node) { … var sel = '#visitView, #visitHero, #' + PANEL_ID + ', #transcript, #noteBox, #heroPtName, #captureBtn'; try { return !!(node.matches(sel) || node.closest(sel) || node.querySelector(sel)); } catch (e) { return false; } }`.

`node.querySelector(sel)` walks the node's ENTIRE subtree against 7 selectors. The early `return true` only helps once a relevant node is found — for the common case (an irrelevant mutation) every node pays the full ancestor walk AND the full subtree scan before the function returns false. Installed unconditionally at :677 `startObserver();` behind only an idempotence guard (:24).

---

## 9. [HIGH] 138 unbounded setIntervals fire ~117 ticks/second steady-state; 27 of them capture no handle at all and can never be cleared. All of them are FROZEN, not throttled, while athenaOne is foregrounded — the app's own code records the measurement.

**What the doctor sees:** Two symptoms with one cause. While he works in athenaOne, anything these timers BUILD is simply absent when he tabs back — it reads as a dead feature, not a delayed one. And when the tab regains focus, the frozen ticks land as a burst of catch-up work on the main thread, which is the "it hangs for a second when I switch back" complaint.

**Evidence:**

Scan over ScribeFlow.html + mls-connect.js + the 127 loaded feat assets: 243 setInterval sites, 148 with no clearInterval inside the callback; 138 of those have a literal numeric period, summing to 117.4 ticks/s. Highest-frequency permanent timer: feat_mls_glitch_sweep.js:246-251 `_qfTimer = setInterval(function () { safe(injectCSS); safe(wireCopilot); safe(wrapClose); safe(qfSweep); }, 200);` — 5 Hz forever, and `qfSweep` forces style resolution when the Find overlay exists (:197-200 `var d = safe(function () { return o.style && o.style.display; }, ""); if (d) return d; return safe(function () { return getComputedStyle(o).display; }, "");`). Its header states it is ungated: :5 `Loaded by BOTH connect bundles (prod + staging). No gate.`

Conservative floor: 27 setIntervals whose return value is never assigned to anything and which contain no inline clear — 15.4 ticks/s that are structurally uncancellable (e.g. mls-connect.js:39037, :34731, :34792, :34849, :37071, :41693, :36365, :36413).

117.4 is an UPPER bound: some interval-installing modules sit behind release flags that are never set — e.g. mls-connect.js:38634 `if (window.__MLS_TEAM_WORKSPACE_RELEASED !== true) return;`, and grep shows that flag is read in 10 places and assigned in none, so that module's `setInterval(function(){ badgeHistory(); injectCardChip(); injectVisitChip(); }, 1500)` at :39037 never installs.

The freeze is measured in-repo: mls-connect.js:3676-3679 `/* CAPTURE-PHASE interception, not a timer. * Measured live 2026-07-10: a plain setInterval(fn, 200) in this tab fired * ZERO times in 900ms - Chrome intensive-throttles the MLS tab whenever * athenaOne is foregrounded`.

---

## 10. [HIGH] The Copilot/assistant stale-request abort binds to six event names; four of them are never dispatched anywhere in production, including a near-miss typo of the real name.

**What the doctor sees:** He asks Copilot a question, then switches patient or visit by any route that does not emit those two live events. The in-flight request is never aborted. `window._copilotBusy = true` and `send.disabled = true` (feat_mls_copilot_request_safety.js:155-157) stay set, and `guardedCopilotAsk` opens with `if (window._copilotBusy) return false;` — so Copilot is silently unresponsive to the NEXT question for up to the full 45s REQUEST_TIMEOUT_MS, then pops "The patient or visit changed, so that Copilot answer was discarded." Honest caveat: the answer itself does not leak into the wrong chart — the post-fetch `if (!stillCurrent(token)) { aborted = true; return false; }` at line 190 is live, and the `finally` block cleans up the pending row. The cost is a dead Copilot, not a cross-patient answer.

**Evidence:**

feat_mls_copilot_request_safety.js:116 — `["mls:patient-changed", "mls:active-patient-change", "mls:active-patient-changed", "mls:visit-changed", "mls:view-changed", "mls:context-changed"].forEach(function (name) { safe(function () { window.addEventListener(name, abortIfStale, false); ownerEvents.push([name, abortIfStale]); }); });`
The identical array is duplicated at feat_mls_asst_fix.js:473 binding `abortCurrentIfStale`.
Of the six, only `mls:active-patient-changed` and `mls:view-changed` have production dispatchers. `mls:patient-changed`, `mls:visit-changed` and `mls:context-changed` appear ONLY inside these two arrays — grep across all *.js/*.html excluding tests/coordination/extension-candidates returns zero dispatchEvent/initCustomEvent for each. `mls:active-patient-change` is the real name minus its trailing 'd'.
The abort itself is real: feat_mls_copilot_request_safety.js:108-113 `function abortIfStale() { var token = activeRequest; if (!token || stillCurrent(token)) return; token.stale = true; safe(function () { if (token.controller) token.controller.abort(); }); }`

---

## 11. [HIGH] In the history pull's per-patient path, `row.ok` is set to true and then immediately tested with `if (!row.ok)`, so the 'thin-after-ingest' failure reason can never be recorded.

**What the doctor sees:** Every patient row that reaches the end of `pullOne` is reported `ok: true` with an empty reason, regardless of how little clinical substance actually landed. The only substance check in the function is upstream (`r.text.length < 400` → `read-failed`); once the ingest call returns, nothing can downgrade the row. This is the same family as the previously measured "19/19, failures 0" pull that changed zero characters in the store — the receipt has no vocabulary left for "ingested, but thin", so a hollow pull renders fully green.

**Evidence:**

mls-connect.js:11863-11864 —
```
      row.ok = true;
      if (!row.ok) row.reason = 'thin-after-ingest';
```
These are consecutive lines inside `pullOne(name, dayHint)` (mls-connect.js:11835). `row.ok` is a plain boolean literal assigned on the line above with no intervening call, so `!row.ok` is unconditionally false. An automated sweep of all shipped JS for the assign-true-then-negate-check pair returns this as the only instance.

---

## 12. [HIGH] The extension's Athena account and practice-id verification gate is structurally unreachable: it only blocks when the app supplies `expectedAccount`/`expectedPracticeId`, and the app never supplies either.

**What the doctor sees:** The three refusal messages "A different Athena account is signed in than expected", "The expected signed-in Athena account could not be verified" and "The open Athena tab is not the expected practice" can never fire. If he is signed into the wrong athenaOne account or the wrong practice, that specific gate stays silent. Partial mitigation, stated honestly: the unconditional tab-vs-locked-encounter check at write_safety_guard.js:303 (`if (tabPractice && lockedPractice && tabPractice !== lockedPractice)`) IS live and still catches a cross-practice tab. It is the account identity check that has no reachable path — and signed-out/wrong-session Athena is a repeatedly measured failure mode in this product.

**Evidence:**

write_safety_guard.js:395 — `if (!nameKey(opts.expectedAccount)) return null;` returns before the observed account is ever read.
write_safety_guard.js:317 — `var expected = nameKey(opts.expectedAccount); if (!expected) return null;`
write_safety_guard.js:306-307 — `var expected = digits(opts.expectedPracticeId); if (expected) {` guards the whole expected-practice branch.
The forwarding hop exists and is even commented as load-bearing — content.js:725-728: `/* wsg-1.0.0: optional app-supplied expectations — when present the background verifies them fail-closed before any mutation. */ ... expectedAccount: mlsStr(d.expectedAccount, 120), expectedPracticeId: mlsStr(d.expectedPracticeId, 20),`
But the app never populates them: `grep -c "expectedAccount" mls-connect.js ScribeFlow.html` returns `mls-connect.js:0` and `ScribeFlow.html:0`. Repo-wide, the only occurrences are background.js:2343, content.js:727-728, write_safety_guard.js, and _ws_tools/apply_background_edits.js — all plumbing, no producer.

---

## 13. [MEDIUM] Stale rows for today outrank a terminal pull failure: the moment any of today's patients are loaded and the pull is no longer in flight, the pull-progress panel deletes its own failure card — diagnosis, cause and Retry button — from the DOM. Truthful behaviour: keep the failure card and say "This pull failed; the schedule below is from an earlier import and may be incomplete."

**What the doctor sees:** He clicks Pull, it fails, a card appears saying (e.g.) "Sign in to athenaOne" with a Retry button — and then the card silently vanishes because three patients from yesterday's import are still on today's list. He is left with a partial schedule and no indication anything went wrong, and the fix he was one click away from is gone.

**Evidence:**

feat_mls_pullflow.js:586-596 (prod-loaded):
```
/* HIGHEST PRIORITY: if today's patients are loaded and no pull is in
   flight, we are DONE — never leave a spinner or an error card sitting on
   top of a schedule that actually arrived ... */
var tc = todayCount();
if (tc != null && tc > 0 && !active) {
  if (ST.phase !== 'done') { ST.phase = 'done'; ST.stepKey = 'ready'; ST.lastGoodKey = 'prepare'; removeSpinnerHide(); persist(); }
  render(); return;
}
```
This branch runs BEFORE the `ST.phase === 'terminal'` check at line 600, so it overwrites a terminal state that was just set. `render()` then erases the panel — feat_mls_pullflow.js:514-519:
```
if (ST.phase === 'idle' || ST.phase === 'cancelled' || ST.phase === 'done') {
  p.style.display = 'none';
  p.innerHTML = '';
  removeSpinnerHide();
  return;
}
```
`todayCount()` (feat_mls_pullflow.js:231-238) proves nothing about THIS pull — it reads whatever is already loaded:
```
var s = window.__mlsEasyV32 && window.__mlsEasyV32.remote && window.__mlsEasyV32.remote.snapshot && window.__mlsEasyV32.remote.snapshot();
if (s && s.today) return s.today.length;
```
The terminal card being destroyed is the one carrying the real diagnosis and fix — `signed-out`, `ext-missing`, `ext-outdated`, `parse-fail`, `wrong-page` (feat_mls_pullflow.js:262-270) — together with the `#mpfRetry` / `#mpfRestart` buttons wired at line 567.

---

## 14. [MEDIUM] The Write-back readiness row's "no active patient" guard can never fire: it tests `window.activePatient.name`, and `activePatient` is a top-level FUNCTION declaration, so `.name` is the string 'activePatient' — permanently truthy. The row reports green "Ready" with no patient selected at all. Truthful message: "Not ready — no patient is open; a write would be refused."

**What the doctor sees:** The Status Center's Write-back source shows a green dot and "Ready — every write still needs your explicit approval" while no patient is open. If he acts on that and triggers a write, the write-back panel immediately refuses with "No active patient is selected in MLS — nothing was written." Two surfaces on screen, one green and one red, about the same operation.

**Evidence:**

feat_mls_status_center.js:1063-1071:
```
function refreshWritebackReadiness() {
  var connected = conn.verdict === 'connected';
  var wb = safe(function () { return W.__mlsAthenaWriteback; }, null);
  var hasPatient = !!(lastPatientShown || safe(function () { return (W.activePatient && (W.activePatient.name || W.activePatient.display)) || document.querySelector('[data-active-patient]'); }, null));
  if (!connected) { srcSet('writeback', 'warn', 'Not ready — MLS Assist readiness is ' + ... ); return; }
  if (!wb) { srcSet('writeback', 'idle', 'Write-back module not on this screen.'); return; }
  if (!hasPatient) { srcSet('writeback', 'warn', 'Not ready — no active patient loaded.'); return; }
  srcSet('writeback', 'ok', 'Ready — every write still needs your explicit approval.');
}
```
ScribeFlow.html:9646 defines it as a function declaration, which puts it on `window` with a `.name`:
```
function activePatient(){ const id=getActivePtId(); return getPatients().find(p=>p.id===id)||null; }
```
`window.activePatient.name === 'activePatient'`, so `hasPatient` is always `true` and line 1069 is dead code. Every other reader in the tree calls it — e.g. feat_athena_writeback.js:315 `isFn(g('activePatient')) ? (g('activePatient')() || {}) : {}` — and refuses on an empty name at line 317: `if (!trim(mlsPt.name)) { finishFail('No active patient is selected in MLS — nothing was written.', ...) }`.
SCOPE, stated honestly: `window.__mlsAthenaWriteback` is defined only in feat_athena_writeback.js:438, and mls-connect.js:41877 stands that file down in production (`feat_athena_writeback.js intentionally not loaded`), so on mlsscribe.com the `!wb` branch returns first and the row reads 'idle'. The false "Ready" is live today on ScribeFlow-staging.html (mls-connect.staging.js:4387 loads the

---

## 15. [MEDIUM] Simple-view auto-send sets its success flag BEFORE the fire-and-forget async write, swallows any throw, never reads the write result, then emits sent-shaped messages and latches the content hash — so a refused write is reported as sent AND the doctor cannot retry, because the second press answers "Already sent this note to athenaOne." Truthful message: "Handed the note to the guarded write-back — watch its panel for the confirmed or refused result."

**What the doctor sees:** On the Simple wizard's Finish step: "Sending to athenaOne: note (unsigned draft - you sign)." followed by "Codes are appended to the note text…" — both consistent with success — while the write-back's own patient-mismatch refusal sits on a different toast anchor. Pressing Finish again answers "Already sent this note to athenaOne." and refuses to retry a note that never reached the chart.

**Evidence:**

feat_mls_simple_autosend.js:83-99:
```
if (sig === lastSent) { toast('Already sent this note to athenaOne.', ''); return; }
...
var ok = false;
if (isOp && g('__mlsOpWb') && isFn(g('__mlsOpWb').writeOpNote)) {
  ok = true; safe(function () { g('__mlsOpWb').writeOpNote({ note: payload }); });
} else if (g('__mlsAthenaWriteback') && isFn(g('__mlsAthenaWriteback').writeNoteToChart)) {
  ok = true; safe(function () { g('__mlsAthenaWriteback').writeNoteToChart({ note: payload }); });
}
if (!ok) { toast('Could not auto-send - the Athena writeback module is not loaded. ...', 'err'); sending = false; return; }
if (!codes) toast('Note: no generated codes were visible to include - sent the note only.', '');
else toast('Codes are appended to the note text; athenaOne code pickers are not auto-filled yet.', '');
lastSent = sig;
```
`ok = true` means only "the function exists". `safe` is `function safe(fn, d) { try { return fn(); } catch (e) { return d; } }` (line 33) — it eats every throw. `writeNoteToChart` (feat_athena_writeback.js:304) returns undefined and resolves asynchronously; its real outcomes are `finishOk` / `finishFail` on a separate panel, and it has at least four refusal paths that write nothing: an in-flight latch (line 309), no note text (line 317), no active patient (line 318), and a name+DOB patient mismatch (line 335 `offerOverride(... 'Patient mismatch — nothing was written. ' ...)`).
The honest implementation of exactly this handoff already exists in the same tree — feat_mls_submit_checklist.js:126-136 listens for the real `mlsAppPasteResult` and returns `ok: null` when nothing arrives:
```
if (resp.ok && resp.confirmed) settle({ ok: true, msg: 'Wrote the note into the open chart — confirmed ...' });
else if (resp.ok && !resp.confirmed) settle({ ok: false, msg: 

---

## 16. [MEDIUM] A second, older agenda-chip owner in mls-connect.js never stands down to the module that superseded it, still contains the exact provider-matching bug its successor documents as fixed, and guards its popup rebuild with a one-shot element expando — so its 2000 ms interval does nothing but burn ticks forever.

**What the doctor sees:** Nothing visibly wrong today — which is the danger. Two modules own the same chip with two different definitions of "seen" (:31031 `var seen = p.appts.filter(isSeen).length;` where isSeen also consults `window._seenToday`, vs :31176 `var seen = p.appts.filter(function (a) { return !!a.checked_in_at; }).length;`). The moment anyone "fixes" the dead provider match, the older definition wakes up and the agenda counter starts flipping between two numbers every 1.5–2 seconds.

**Evidence:**

The superseding module explicitly stands down; this one does not. mls-connect.js:30608 (inside the b49 pull-truth module) `var chip = window.__mlsAgendaBtnB49 ? null : $('mlsAgendaChip');`. The module at :31118 has only `if (window.__mlsR46B46) return;` (:31120) — grep across its whole body (31118-31320) finds zero references to `__mlsAgendaBtnB49`.

It reintroduces the documented bug. Its provider resolver compares the RAW chip text: :31140-31143 `var el = $('mlsProvChip'); var t = el ? (el.textContent || '').trim() : ''; if (!t || /^all\b/i.test(t)) return null; return t;` and :31148-31152 `var mine = A.filter(function (a) { return (a.day_local || a.appt_date) === td && (a.provider || '') === prov; });`. That is precisely what :30505-30508 records as broken: `A) PROVIDER PARSE FIX: b46's activeProvider() compared the RAW #mlsProvChip text ("🩺 Pulling as: Matthew Schaeffer, MD ▾·🔍 find a doctor") against appt.provider ("Matthew Schaeffer, MD") -> never matched -> agenda chip stayed un-scoped (0/132).` Exact equality against decorated chip text yields zero rows, so `provAppts()` returns null and both consumers early-return.

Its popup rebuild is additionally a one-shot: :31182-31184 `function fixPop() { try { var pop = $('mlsAgendaPop'); var p = provAppts(); if (!pop || !p || pop.__r46done) return; pop.__r46done = 1;` — innerHTML writes replace `pop`'s children but not `pop` itself, so `__r46done` survives every rebuild and the function is permanently inert after one pass.

All of it is driven by :31293 `var iv = setInterval(function () { fixChip(); fixPop(); if (!verState.latest && Date.now() - _vLast > 30000) { _vLast = Date.now(); checkVersions(); } keepControlsRow(); }, 2000);`. Its `fixChip` also writes :31179 `chip.title = 'Appointments today for ' + p.prov;` un

---

## 17. [MEDIUM] feat_mls_widgetinsert.js reads `window._cwLatest`, but `_cwLatest` is a top-level `const` in a classic script and is therefore never on window — the fallback is permanently undefined. Its `_lastSig` guard is also keyed by widget id and never cleared on a patient switch.

**What the doctor sees:** A widget whose content came only from the model reply (no layout, no rendered mirror) reports "Nothing to add yet — generate or refresh this widget first." even though content exists — the honest-sounding message at :136 is produced by a read that can never succeed. And because `_lastSig` outlives the patient, a widget whose new content happens to share the previous patient's length and first 24 characters is silently not surfaced.

**Evidence:**

The reader: feat_mls_widgetinsert.js:55 `function gv(name) { return safe(function () { return window[name]; }, undefined); }` and :72-76 `function rawReply(id) { var L = gv('_cwLatest'); var r = (L && L[id]) ? String(L[id]) : ''; return r.replace(/^```\w*\s*/, '').replace(/```\s*$/, '').trim(); }`. The declaration: ScribeFlow.html:28847 `const _cwLatest={};` — a top-level `const` creates a lexical binding, not a global-object property, so `window._cwLatest` is `undefined` forever and `rawReply` always returns ''. Same for `structuredSerialized` at :82-83 `var _cwState = gv('_cwState') || {}; var _cwLatest = gv('_cwLatest') || {};`.

The module documents this exact defect class for a different global at :117-124 (`the prior external robustPush … read window.currentSoap / window._cwState / window._cwLatest -- but those are the app's LEXICALLY-SCOPED globals, NOT window properties, so they read as undefined and the function bailed`) and fixed it by delegating for the push path — but left the same broken reads in `widgetText`'s fallback chain (:98-105).

Separately, the surfacing guard is a module-level map keyed by widget id with no patient component and no clear on patient switch: :50 `var _lastSig = {};      // per-widget content signature, to act only on changes`, :178-185 `var sig = w.id + ':' + txt.length + ':' + txt.slice(0, 24); if (_lastSig[w.id] === sig) { … return; } _lastSig[w.id] = sig;`.

---

## 18. [MEDIUM] Two permanent repeating passes take a forced synchronous layout on every tick and then write style/innerHTML unconditionally: the profile-card organizer at 1400 ms and the widget deck at 1200 ms.

**What the doctor sees:** Two guaranteed forced layouts per second whenever the app is open, plus a full text serialization of the profile card's sections. On its own it is a background tax; combined with the 78 whole-document observers it is why the profile and visit views feel heavier than the rest of the app. Note both are frozen behind athenaOne, so the profile sections can also read as un-organized on tab-back until the first tick lands.

**Evidence:**

mls-connect.js:45385-45387 `function ensure() { try { var pc = $('profileCard'); if (!pc || pc.offsetParent === null) return;` — `offsetParent` forces layout, and it is the FIRST thing every tick does, so the "skip when hidden" guard costs a forced layout to decide it can skip. Then per tick it walks all children (:45402 `var kids = Array.prototype.slice.call(pc.children);`), and for every section reads the full subtree text and writes display unconditionally: :45415-45419 `var bb = s.querySelector('.pf2-b'); var hasContent = bb && bb.children.length > 0 && (bb.textContent || '').trim().length > 0; s.style.display = hasContent ? '' : 'none';`. Driven by :45421 `var iv = setInterval(function () { try { ensure(); } catch (e) {} }, 1400);`.

Same shape in feat_mls_widget_deck.js:199-200 `var vv = $('visitView'); if (!vv || !vv.offsetParent) return;` — forced layout first, then per tick a `JSON.stringify` plus a `cwSemanticFingerprint` call per widget to build the comparison key (:208-211), then an innerHTML compare per widget (:195). Driven by :270 `iv = setInterval(function () { safe(sync); safe(ensureChips); safe(wrapRenderOutput); }, 1200);`.

Both install unconditionally (mls-connect.js:45206 `if (window.__mlsProfCalm) return;` and feat_mls_widget_deck.js:24 are idempotence guards, not feature gates).

---

## 19. [MEDIUM] The synthetic-click interceptor — the last backstop stopping the extension from clicking Sign / Submit / Prescribe — declines to arm in exactly the frames the manifest was specially configured to reach.

**What the doctor sees:** Nothing, until it matters. The file header claims "Content script on athenanet (document_start, all frames) — a capture-phase interceptor that CONSUMES every synthetic activation aimed at a final/irrevocable control" and "Extension code paths physically cannot click Sign / Sign off / Submit / Send / Approve / Finalize / Place order / Prescribe / Transmit, no matter which lane fired the click." In any non-http frame the manifest deliberately reaches, that sentence is false. Stated honestly: I did not open athenanet to confirm it renders such frames — PHI rule. The defect is provable from the code alone (the manifest opts into non-http frames; the arm condition excludes precisely those), and the background policy gate at background.js:2207 remains live as an independent layer.

**Evidence:**

manifest.json:56-66 injects the guard at document_start with `"all_frames": true` AND `"match_origin_as_fallback": true`. That second option exists for one purpose: to reach about:blank / about:srcdoc / blob: subframes, which are not matched by a normal URL pattern.
write_safety_guard.js:539-543 — the sole arming path:
```
    if (typeof window !== 'undefined' && window.location &&
        String(window.location.hostname || '').toLowerCase() === 'athenanet.athenahealth.com') {
      installSyntheticClickInterceptor(window);
    }
```
In an about:blank, about:srcdoc or blob: frame, `location.hostname` is the empty string, so the strict equality is false and `installSyntheticClickInterceptor` is never called. There is no other caller: grep for `installSyntheticClickInterceptor` across content.js, background.js, review_screen.js and mls-popup.js returns nothing.
The same file uses a LOOSE suffix test for the same host family elsewhere — write_safety_guard.js:292 `if (!/(^|\.)athenahealth\.com$/i.test(u.hostname)) return '';` — so the strict form at :541 is an inconsistency, not a house style.

---

## 20. [MEDIUM] `fillProcInputs` reads an `onchange` attribute while the renderer emits `oninput`, so it has never filled a single op-prep procedure input.

**What the doctor sees:** He matches a template to a procedure and the visible "Procedure" box on the op-prep card stays blank, so the readiness checklist keeps showing Procedure as unfilled and he retypes what the template already knows. The fix is cheap and safe — the renderer already emits a stable `id="opPrepProc_'+i+'"` on the same element, so the index can be read from the id instead of the handler attribute.

**Evidence:**

Reader — feat_mls_opnote_fill.js:212: `var inp = inputs[i], m = S(inp.getAttribute('onchange')).match(/_opProcChanged\((\d+)/); if (!m) continue;`
Renderer — ScribeFlow.html:15858: `h+='<div style="display:flex;gap:6px;flex-wrap:wrap"><input id="opPrepProc_'+i+'" value="'+esc(row.proc||'')+'" oninput="_opProcChanged('+i+',this.value)" ...`
The helper makes the miss total rather than throwing — feat_mls_opnote_fill.js:38: `function S(x) { return x == null ? '' : String(x); }`. So `getAttribute('onchange')` returns null, `S(null)` returns `''`, `''.match(...)` returns null, and every iteration hits `continue`. The loop body below it is unreachable.
The module's own header at feat_mls_opnote_fill.js:205 states the wrong contract: `blank. The input carries onchange="_opProcChanged(N,this.value)", so N maps`. It is called unconditionally at feat_mls_opnote_fill.js:1512 `safe(fillProcInputs);`.

---

## 21. [MEDIUM] The fixpack's op-prep row auto-prefill is dead twice over — its element selector matches nothing, and the global it would call is never defined.

**What the doctor sees:** Op-prep rows never auto-populate with the visit reason pulled from the schedule, so he types each procedure by hand. Worse for review: the module sets `FP.fixes.opPrepAuto = true` unconditionally, so the fixpack's own self-report claims the feature is installed and working.

**Evidence:**

feat_mls_fixpack_0701.js:352 — `var inputs = list.querySelectorAll('input[onchange*="opProcChanged"], textarea[onchange*="opProcChanged"]');`
The renderer writes `oninput`, not `onchange` (ScribeFlow.html:15858), so this NodeList is always empty and the `forEach` body never executes. (The `*=` substring would have tolerated the leading underscore; the attribute NAME is what kills it.)
feat_mls_fixpack_0701.js:369 — `if (mIdx && typeof window.opProcChanged === 'function') window.opProcChanged(+mIdx[1], det);`
The real global is `_opProcChanged` with a leading underscore (ScribeFlow.html:15786 `function _opProcChanged(i,v){`, and feat_mls_opnote_integrity.js:1259-1260 wraps `window._opProcChanged`). A repo-wide grep for a bare `opProcChanged` definition returns only this call site — it is defined nowhere.
The dead function is armed on three entry points at feat_mls_fixpack_0701.js:374-386, which wrap `openOpPrep`/`openOpPrepForPatient`/`opPrepSetMode` with `setTimeout(prefillOpPrepRows, 300); setTimeout(prefillOpPrepRows, 900);`, and then reports `FP.fixes.opPrepAuto = true;` at :387.

---

## 22. [MEDIUM] The code sheet's "Insert into note" resolves its target through a four-selector chain in which not one selector can match any element in the app.

**What the doctor sees:** He selects ICD-10/CPT codes in the code sheet, clicks Insert, and the codes never enter the note — every single time he gets "No note field open — copied instead" and has to paste manually. The toast is at least honest about what happened, which is why this has survived: it reads as a situational fallback rather than the only reachable branch.

**Evidence:**

mls-connect.js:39610 — `var field=safe(function(){ return document.getElementById('noteText')||document.getElementById('clinicalNote')||document.querySelector('textarea[data-note-body], textarea.note, #visitNote'); }, null);`
Measured against ScribeFlow.html: `id="noteText"` → 0 occurrences; `id="clinicalNote"` → 0; `data-note-body` → 0; `id="visitNote"` → 0. `textarea.note` requires the exact class token `note`; enumerating every textarea's class attribute gives `transcript`, `note-box`, `xbody`, `c-art-text`, `c-mail-in`, `inline-edit-area` — none is `note`. Every `class="note"` in the shell is on a `<p>` or `<div>` (lines 2583, 2588, 2592, 2602, 3969, 4274, 4308, 4462). None of the four ids is created dynamically either — grep for `id = 'noteText'|'clinicalNote'` and `'data-note-body'` across shipped JS returns nothing.
The actual editor is ScribeFlow.html:3212 `<textarea id="noteBox" aria-label="Generated note" class="note-box" ...>`, which the chain does not name.
So `field` is always null and control always reaches the else at mls-connect.js:39615: `} else { copyTxt(block); toast('No note field open — copied instead'); }`

---

## 23. [MEDIUM] In the same file, the code-validation guardrail's "prefer the live editor" branch uses the same unmatchable selector chain, so it always validates the last SAVED note instead of what is on screen.

**What the doctor sees:** He edits or dictates into the open note, runs "🛡️ Code check", and gets a verdict computed from the previously saved version of the note. Codes he just added are reported missing; codes he just removed are still flagged. The badge count at :38457 (`bad.length`) is driven by the same stale text, so the warning dot disagrees with the note in front of him — and the comment on line 38367 says the opposite of what the code does.

**Evidence:**

mls-connect.js:38365-38369 —
```
  function latestNoteText(id){
    return safe(function(){
      // prefer a live visit editor if it has content
      var live=document.getElementById('noteText')||document.getElementById('clinicalNote')||document.querySelector('[data-note-body]');
      if(live && (live.value||live.textContent||'').trim().length>120) return (live.value||live.textContent);
```
All three resolve to null in this app (same measurement as the finding above: zero occurrences of `noteText`, `clinicalNote`, `data-note-body` in ScribeFlow.html and no dynamic creation). `live` is always null, the `if` never opens, and execution always falls through to the saved-notes list sorted by `updated||created`.
Its consumers are the code guardrail: mls-connect.js:38443 `var recs=extract(latestNoteText(id));`, :38454 and :38461 `window.__mlsCodeSheet.showValidation(latestNoteText(id), activeName())`, and :38457 `var res=window.__mlsCodeSheet.validate(latestNoteText(id))||[];`

---

## 24. [MEDIUM] Eleven custom event names have listeners but no production dispatcher — and one of them is emitted only by the test fixture that validates it.

**What the doctor sees:** Mostly nothing, because every one of these listeners is paired with a live sibling (`mls:ui-ready`, `mls:view-changed`, `mls:active-patient-changed`) that carries the load — which is exactly why the dead names survived review. The real damage is to the safety net's credibility: the fixpack list reads as seven independent refresh triggers and is four, and `mls:note-updated` is worse than dead — the synthetic smoke suite manufactures the event itself, so that binding will report green forever while never firing in a browser.

**Evidence:**

Full production-dispatcher count (excluding tests/, coordination/, extension-candidates/) is 0 for all eleven: `mls:nav-ready`, `mls:route-change`, `mls:note-updated`, `mls:schedule-updated`, `mls:patient-changed`, `mls:note-generated`, `mls:calendar-updated`, `mls:active-patient-change`, `mls:visit-changed`, `mls:context-changed`, `sf:ready`.
The self-validating one: feat_mls_redesign.js:1257 `try{ window.addEventListener('mls:note-updated',_surfacePatientHandler); }catch(e3){}` — the ONLY emitter in the entire repo is tests/live-synthetic-smoke.js:1586 `window.dispatchEvent(new CustomEvent('mls:note-updated',{detail:{source:'live-synthetic-fixture'}}));`
A four-dead-name refresh list: feat_mls_fixpack_0701.js:1100-1102 —
```
    ['mls:ui-ready', 'mls:view-changed', 'mls:patient-changed', 'mls:note-generated',
      'mls:generation-complete', 'mls:schedule-updated', 'mls:calendar-updated'].forEach(function (name) {
      listen(window, name, function () { queueRefresh(document, name, 40); }, false);
```
Others: feat_mls_studygroups.js:545 `window.addEventListener('mls:route-change', boot);`; mls-connect.js:34825 `window.addEventListener('mls:nav-ready',tick);`; feat_mls_patient_reach_v2.js:555 `['mls:ui-ready', 'mls:nav-ready', 'sf:ready'].forEach(function (name) { W.addEventListener(name, init); });`

---

## 25. [MEDIUM] Under prefers-reduced-motion the boot progress bar can never advance: the rule that sets it to 55% is a normal declaration and loses to the element's own inline transform, which is written twice.

**What the doctor sees:** With Reduce Motion on (a common accessibility setting, and the default on many managed clinic machines), the login/boot bar sits at 8% and does not move for the entire boot, then snaps to full and disappears. On the slow boots this product has already had, that reads as a hung app — the doctor reloads or force-quits mid-session rather than waiting.

**Evidence:**

ScribeFlow.html:26279 (inside the #sfGateLoadingCss stylesheet): `@media(prefers-reduced-motion:reduce){#sfGateLoading.mls-gate-progress #mlsBLbar{animation:none;transform:scaleX(.55)}}` — no !important. The element carries an inline transform from birth, ScribeFlow.html:26285: `<div id="mlsBLbar" style="height:100%;width:100%;transform:scaleX(.08);border-radius:999px;...">`, and ScribeFlow.html:26290 re-writes it on every gate show: `if(bootBar){ bootBar.classList.remove('done'); bootBar.style.width='100%'; bootBar.style.transform='scaleX(.08)'; }`. Inline author declarations outrank any non-important author rule, so the computed transform stays scaleX(.08). The proof the author knew this is two declarations away in the same stylesheet: `#sfGateLoading #mlsBLbar.done{animation:none;transform:scaleX(1)!important}` — the completion rule carries !important, the reduced-motion rule does not. Completion still works because of ScribeFlow.html:26346 `if(bar){ bar.classList.add('done'); bar.style.width='100%'; bar.style.transform='scaleX(1)'; }`.

---

## 26. [MEDIUM] The app's entire documented loading-state vocabulary is dead: .mls-busy, .mlsRdSkel and .mlsRdSpinner are styled in two modules and described in a module header as the shared primitives, but no code anywhere adds them to an element.

**What the doctor sees:** Nothing. That is the problem — every button and panel that was supposed to show "working" shows no spinner and no shimmer while a pull, a draft or a save is in flight. The doctor cannot tell a slow operation from a dead click, which is the same failure mode as the pull rows that sat on a stale state during a pull that was actually working.

**Evidence:**

feat_mls_theme_polish.js:12-14 states the contract: `*  3. LOADING STATES: any element carrying .mls-busy shows a calm inline` / `*     spinner; .mlsRdSkel shimmer (defined in the redesign layer) is the` / `*     shared skeleton primitive.` The rules: feat_mls_theme_polish.js:64 `'.mls-busy{position:relative;pointer-events:none;opacity:.75}',`; :65 `'.mls-busy::after{content:"";position:absolute;right:10px;top:50%;width:13px;height:13px;margin-top:-7px;border:2px solid rgba(46,106,75,.25);border-top-color:#2E6A4B;border-radius:50%;animation:mlsThmSpin .7s linear infinite}',`; :70 the reduced-motion variant. And feat_mls_redesign.js:290 `".mlsRdSkel{ background:linear-gradient(90deg,#F0EEE7 25%,#F7F5EF 45%,#F0EEE7 65%); background-size:640px 100%; animation:mlsRdShimmer 1.3s linear infinite; border-radius:8px; color:transparent !important; }",`; :292 `".mlsRdSpinner{ ... animation:mlsRdSpin .7s linear infinite; }",`; :293 the reduced-motion variant. A repo-wide grep for these three tokens outside tests and .md returns exactly 8 lines: the 7 CSS/keyframe lines above plus the header comment. No classList.add, no classList.toggle, no className write, no class= attribute, and no concatenated builder (checked both halves: no `'mlsRdSk'+` prefix and no `+'el'` suffix form).

---

## 27. [LOW] The doctor-facing self-diagnostic marks "Backend / AI reachable" as PASS on HTTP 401, 403 and 404, and files the caveat under a heading labelled "Fix:" beneath a green tick. A dead auth token — which breaks every AI draft — renders as a passing check. Truthful verdict: fail or unknown, "The AI backend answered 401 — your session is not authorised, so AI drafting will fail. Sign out and back in."

**What the doctor sees:** He runs the self-check because AI drafting is failing. The panel says "9 passed · 0 failed · 0 unverifiable" with "✓ Backend / AI reachable AI-007", and under it a line labelled "Fix: Reachable but returned HTTP 401 for the health probe (not a quota issue)." The one check that could have named his problem reports green.

**Evidence:**

feat_mls_checker.js:238-246 (prod-loaded):
```
var st = res.status;
if (st === 429) return R('fail', 'AI-007', 'The AI backend returned HTTP 429 ...');
if (st >= 500) return R('fail', 'AI-007', 'The AI backend returned a server error (HTTP ' + st + ').', ...);
// 200/400/401/403/404 all prove the service is reachable and NOT quota-limited.
return R('pass', 'AI-007', '', (res.ok ? '' : 'Reachable but returned HTTP ' + st + ' for the health probe (not a quota issue).'),
  'Backend reachable, HTTP ' + st + (st === 429 ? '' : ' (no 429 quota error).'));
```
The third argument of `R` is `cause` and the fourth is `fix`, so the caveat is rendered in the "Fix:" row of a passing item — feat_mls_checker.js:380-388:
```
var cls = r.status === 'pass' ? 'mc-pass' : (r.status === 'fail' ? 'mc-fail' : 'mc-unknown');
var ic = r.status === 'pass' ? '&#10003;' : (r.status === 'fail' ? '&#10007;' : '?');
...
(r.fix ? '<div class="mc-fix"><b>Fix:</b> ' + esc(r.fix) + '</div>' : '') +
```
and it is counted in the headline tally at line 377-378 as a pass: `rows.forEach(function (r) { if (r.status === 'pass') pass++; ... }); var html = '<div class="mc-summary">' + pass + ' passed ...`. The module has a genuine third state (`'unknown'`, used correctly at lines 151, 271, 281) that is not used here.

---

## 28. [LOW] A pull-to-cloud toast fabricates the word "all" whenever the server's record count is zero or absent, and pairs it with an instruction to close athenaOne. Truthful message: report the number the server actually returned, and say nothing about closing athenaOne unless the count was received.

**What the doctor sees:** Nothing today. If the import endpoint is ever connected: a green "✓ Pull saved to MLS cloud (all records) — safe to close athenaOne" over a response that stored none of them, followed by him closing the only tab that still held the data.

**Evidence:**

mls-connect.js:31982, inside the r44 fetch wrapper (the enclosing IIFE at mls-connect.js:31632 runs unless `window.__mlsRound4B44` is set):
```
if (r && r.ok) { try { r.clone().json().then(function (j) { toast('✓ Pull saved to MLS cloud (' + (j.stored || j.count || 'all') + ' records) — safe to close athenaOne.', 5000); }); } catch (e) { toast('✓ Pull saved to MLS cloud — safe to close athenaOne.', 5000); } }
```
`j.stored === 0` is falsy, so a response reporting zero stored records renders "(all records)". A response carrying neither key renders "(all records)" unconditionally — a completeness claim with no evidence behind it — and the inner `catch` toasts the success sentence again when the JSON body cannot be parsed at all.
CALIBRATION, stated honestly: I could find no caller. A repo-wide search for `appointments/import` returns zero matches outside this line, so the URL test `/\/api\/appointments\/import/` never fires today and this is currently an unreachable toast, not a live lie. It becomes one on the day that endpoint is wired.

---

## 29. [LOW] A patient-name fallback in the legal-request linkage calls `window.getActivePatient`, a global that does not exist; the real global is `activePatient`.

**What the doctor sees:** On the legal view with no visit open, attorney-request cards do not get their patient chip — `activePatientName()` returns empty, so `nameIn(cardText, name)` at mls-connect.js:32548 short-circuits on `if (!name) return false;` and no card is tied to a patient. It degrades to a cosmetic gap in a non-clinical view, which is why it rates low, but the guard reads as a robust two-source lookup and is a one-source lookup.

**Evidence:**

mls-connect.js:32538 — `try { if (typeof window.getActivePatient === "function") { var p = window.getActivePatient(); if (p && p.name) return S(p.name); } } catch (e) {}`
This is the only occurrence of `getActivePatient` anywhere in the repo — no definition, no other caller. The real accessor is a top-level declaration in the shell (therefore genuinely on `window`): ScribeFlow.html:9646 `function activePatient(){ const id=getActivePtId(); return getPatients().find(p=>p.id===id)||null; }`
It is the second and last arm of a two-step chain (mls-connect.js:32536-32539); the first arm reads the visit hero input `$("heroPtName")`, and with the second dead the function returns `""` whenever that input is blank.

---

## 30. [LOW] ScribeFlow.html ships a second, separate loading-bar primitive — .mls-load-bar / .mls-load-fill / .mls-load-dots plus two @keyframes — that no markup ever uses.

**What the doctor sees:** Nothing renders. Combined with finding 2 this means the product ships two complete, mutually redundant progress-indicator systems and uses neither, which is why long operations look silent.

**Evidence:**

ScribeFlow.html:392 `.mls-load-bar{ height:8px; border-radius:999px; background:var(--soft); overflow:hidden; border:1px solid var(--line); }`; :393 `.mls-load-fill{ height:100%; border-radius:999px; background:linear-gradient(90deg,var(--green-dk),var(--green)); transition:width var(--mls-dur-2) ...}`; :394 `.mls-load-fill::after{ content:""; ... animation:mlsLoadShine ...}`; :395 `.mls-load-dots::after{ content:"…"; ... animation:mlsLoadDots 1.4s steps(4,end) infinite; }`; :399 `@media (prefers-reduced-motion: reduce){ .mls-load-fill::after,.mls-load-dots::after{ animation:none; } }`. Repo-wide grep for `mls-load-` returns only these 5 CSS lines plus one design-doc mention in COORDINATION_GOAL_LANE_2026-07-26.md:743. No writer, and no concatenated builder (`mls-load` is never followed by a closing quote and a `+`).

---

## 31. [LOW] .btn-blue is styled by 8 rules across two modules but no element in the application ever carries that class.

**What the doctor sees:** Nothing today. The trap is forward-looking: the codebase reads as though a blue button variant is supported and themed for dark mode, focus rings and reduced motion, so the next author who writes class="btn-blue" will ship an unstyled control and the review will not catch it.

**Evidence:**

feat_mls_redesign.js:214 `"body.mls-redesign .btn-primary, body.mls-redesign .btn-blue{ background:var(--brand-dk) !important; color:#fff !important; ... }",`, plus :215 (:hover) and :216 (:active). feat_mls_theme_polish.js:45 (transition list), :50 `'html body .btn-blue.btn-blue:hover{transform:translateY(-1px)}',`, :51 (:active), :54 (:focus-visible list), :70 (reduced-motion list). Repo-wide grep for `btn-blue` outside tests and .md returns exactly those 8 CSS lines. For contrast, `btn-green` appears 53 times in ScribeFlow.html markup. No concatenated builder produces it (no `+'-blue'` anywhere).

---

## 32. [LOW] Two rules still style the Classic-layout controls that were removed by owner order on 2026-07-28 — the dock button id is never created and the tools-menu row class is never set.

**What the doctor sees:** Nothing renders. The risk is to the next reader: the stylesheet asserts a Classic escape hatch exists in the dock and in the Tools menu, when the only remaining recovery path is the un-advertised ?ui=classic URL.

**Evidence:**

feat_mls_calm_shell.js:673 `'#mlsDock #mlsDockClassic{padding:7px 8px;font-size:10.5px}',` — but the same file says at :918 `/* No Classic control in the dock: this is the UI now, not a preview sitting` and the dock's buttons are built only from `var CONTRACT = { MLS_DOCK_DEST: ['day', 'patient', 'review', 'studio', 'tools', 'visit'] };` (:33), with the only literal id writes being `nav.id = 'mlsDock';` (:875), `cop.id = 'mlsDockCopilot';` (:899) and `askWrap.id = 'mlsDockAskWrap';` (:909). Repo-wide grep for `mlsDockClassic` returns one line — the CSS rule. Separately feat_mls_calm_shell.js:439 `'#mlsToolsMenu .r.classic{color:#68736B}',` while :1276 records `/* 2026-07-28 owner order: the Classic layout row is gone - it was a one-way door. ?ui=classic stays as the un-advertised recovery path. */` and :1321 `/* 2026-07-28: data-classic rows no longer render; recovery stays at ?ui=classic. */`; no element anywhere is given class `classic`.

---

## 33. [LOW] Six rules across three files style .ez3fl-staffLink, a control that is only ever removed and never created.

**What the doctor sees:** Nothing renders. Same class of defect as the sibling .ez3fl-daypop at feat_mls_redesign.js:1115 `"  #mlsEz3 .ez3fl-daypop, .onf-fillbox select, .onf-fillbox input{ transition:border-color .15s ease, box-shadow .15s ease; }",` whose only other reference is the removal at mls-connect.js:7189 `[].slice.call(body.querySelectorAll('.ez3fl-daychip,.ez3fl-daypop')).forEach(function (n) { n.remove(); });`.

**Evidence:**

mls-connect.js:6196 `'#mlsEz3 .ez3fl-staffLink{background:#fff !important;border:1px solid #E7E5DD !important;...}',` plus :6197 (:hover) and :6198 (b); mls-connect.js:6222 a second base rule `'#mlsEz3 .ez3fl-staffLink{display:inline-flex;align-items:center;gap:7px;...}',` plus :6223; feat_mls_redesign.js:97 includes `body.mls-redesign #mlsEz3 .ez3fl-staffLink` in a colour list; mls-connect.js:46159 `'body.mls-phone .ez3fl-quick, body.mls-phone .ez3fl-staffLink, body.mls-phone .ez3fl-steps,',`; ScribeFlow.html:1171 `#nav_staffpull,#mlsEz3 .ez3fl-staffLink{display:none !important}`. The only non-CSS references are removals: mls-connect.js:7186 `body.querySelectorAll('.ez3fl-staffLink').forEach(function (n) { n.remove(); });`, :7288 a second removal sweep, and :6961 `var kill = staff ? '.ez3fl-staffLink,.ez3fl-record' : '.ez3fl-back,.ez3fl-staffbadge';`. No add, no class= attribute, no concatenated builder.

---

## 34. [LOW] The wb-console 'sign' button was removed but left two dead CSS rules and a retirement guard that can never fire, because the module only ever builds a 'launch' button with a different attribute.

**What the doctor sees:** Nothing renders, and a retirement routine reads in review as actively suppressing a legacy sign control when it is a no-op. If the sign button is ever re-introduced under its old markup this guard will look like it is already handling it.

**Evidence:**

feat_mls_wb_console.js:102 `'.mlswbc-sign{cursor:pointer;font-weight:700;font-size:12px;padding:8px 13px;border-radius:9px;border:1px solid #204034;background:#204034;color:#fff;margin-top:8px;margin-left:8px;box-shadow:0 8px 20px -8px rgba(32,64,52,.6)}' +` and :103 `'.mlswbc-signcap{display:block;font-size:11px;color:#55605A;margin-top:5px;max-width:340px;line-height:1.35}';`. Every element this module creates uses the wbc- prefix (`row.className = 'wbc-row'` :117, `grp.className = 'wbc-grp'` :134, ... `done.className = 'wbc-done'` :226) and the only launcher is :310 `b.type = 'button'; b.className = 'mlswbc-launch'; b.setAttribute('data-mlswbc', '1');`. Nothing sets class mlswbc-sign or mlswbc-signcap. The matching dead guard: mls-connect.js:43541 `var buttons = document.querySelectorAll('[data-mlswbc-sign]');` inside the `__mlsLegacySignRetired` retirement block — `data-mlswbc-sign` is set nowhere in the repo (the only setAttribute calls are `'data-mlswbc', '1'` at feat_mls_wb_console.js:204 and :310), so that loop always iterates zero elements.

---

## 35. [LOW] In the op-note prep room's narrow-screen layout, two margin declarations are beaten by inline margins on the same elements — and the sibling declarations in the very same blocks carry !important, showing the author knew inline was in play.

**What the doctor sees:** On a phone, the op-note prep mode row and day row sit 2px tighter above and 2px looser below than the design specifies. Invisible in isolation; the reason to fix it is that the !important/no-!important split inside one declaration block is exactly how the nine-rules-beaten-by-inline build happened.

**Evidence:**

feat_mls_opnote_templates_ui.js:158 `B + '#opPrepModeRow{ flex-direction:column; gap:6px !important; margin:2px 0 12px; }',` versus the markup at ScribeFlow.html:5258 `<div id="opPrepModeRow" style="display:flex;gap:8px;flex-wrap:wrap;margin:4px 0 10px">` — `gap` is protected with !important and wins, `margin` is not and loses. Same pattern at feat_mls_opnote_templates_ui.js:173 `B + '#opPrepDayRow{ flex-direction:column; align-items:stretch !important;' + ... margin:0 0 12px ...` versus ScribeFlow.html:5262 `<div id="opPrepDayRow" style="display:none;align-items:center;gap:8px;flex-wrap:wrap;margin:0 0 10px">`. A third, harmless case: feat_mls_opnote_templates_ui.js:338 `B + '#opPrepStatus{ font-size:12.5px; color:var(--muted); }'` — the `color` is dead against ScribeFlow.html:5276 `<span id="opPrepStatus" class="mini" style="color:var(--muted);align-self:center">` but the inline value is identical so nothing changes.

---

## 36. [LOW] In the split patients layout the sticky profile card cannot get its margin-top:0 — the inline margin-top:20px on the element wins, and the narrow-screen rule three lines later re-asserts 20px, proving the wide case was meant to be 0.

**What the doctor sees:** In the split patients view the patient card starts 20px lower than the list beside it and its sticky offset is 20px off, so the two columns never line up at the top. Cosmetic, but it is the patients screen the doctor uses all day.

**Evidence:**

ScribeFlow.html:1419 `body.pt-split.pt-has-active #profileCard{ margin-top:0; position:sticky; top:66px; max-height:calc(100vh - 84px); overflow:auto; }` and :1420 `body.pt-split.pt-has-active #profileNonePanel{ margin-top:0; }` — neither margin-top carries !important. The elements: ScribeFlow.html:2984 `<div class="card" id="profileCard" style="margin-top:20px;display:none">` and :3043 `<div class="card" id="profileNonePanel" style="margin-top:20px;display:none">`. The intent is pinned by the next line, :1421 `@media(max-width:980px){ ... body.pt-split.pt-has-active #profileCard{ position:static; max-height:none; margin-top:20px; } }` — the narrow case deliberately restores 20px, which is only meaningful if the wide case had removed it. Everything else in the rule (position:sticky, top:66px, max-height, overflow) does apply.

---

## 37. [LOW] Fourteen single-rule orphans: selectors whose class or id has no writer anywhere in the repo. Each was confirmed by repo-wide grep and by checking both halves of any possible string concatenation.

**What the doctor sees:** Nothing renders differently. These are stranded rules from retired or never-built controls; the cost is review noise — each one reads as a styled, supported surface.

**Evidence:**

feat_mls_theme_polish.js:69 `.mls-modal-title` (in `'html body .modal>h2:first-child,html body .modal>h3:first-child,html body .modal .mls-modal-title{font-family:Newsreader,...}'`) — 1 reference in the whole repo. feat_mls_redesign.js:285 `.mls-toast` (in the toast rule with #mlsTip and .toast) — the only other `mls-toast` hits are the unrelated CSS variable `--mls-toast-lift`. feat_mls_redesign.js:1174 `"  #mlsScDock, #mlsPayReportFab, .mls-askreview-chip{ display:none !important; }",` — both `#mlsPayReportFab` and `.mls-askreview-chip` are 1-reference tokens, so this hide list hides two things that do not exist. feat_mls_opnote_fill.js:63 `'.onf-fillbox .onf-done{border-color:#8fce9e;background:#f2fbf4;}',` — the live sibling is `.onf-has`, written at :1403 `var lbl = el.closest('label'); if (lbl) lbl.classList.toggle('onf-has', !!val);`; `onf-done` is never written. feat_mls_note_editor.js:556 `"#" + BAR_ID + " .ne-lockicon{font-size:12px}",`. feat_mls_recording_segments.js:322 `"#" + HOST_ID + " .rs-row .rs-lbl{font:700 12px system-ui;color:#1f2d40;flex:0 0 auto}",`. feat_mls_studygroups.js:356 `.mls-sg-warn`. feat_mls_study_calm.js:42 `.sgp-build` (in `'#mlsSgPro button[style*="7c3aed"],#mlsSgPro button[style*="8b5cf6"],#mlsSgPro .sgp-build{background:#204034 !important;...}'`). ScribeFlow.html:448 `body.theme-dark .opt-section .h-warn,`. ScribeFlow.html:1155 `.save-row{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:6px}`. One partial: feat_mls_calm_shell.js:382 `'body.mls-calm #ptList .pt-row.on button,body.mls-calm #ptList li.on button{opacity:1}',` — the `.pt-row` half is dead (no writer; the only `pt-row`-looking token in markup is the unrelated `.genopt-row`) but the paired `li` half is live, so the rule still functions.

---

## 38. [LOW] Ten [style*=] attribute-substring probes can never match, because CSS attribute selectors test the literal attribute text and no element writes those values in that form.

**What the doctor sees:** Nothing, because the matching hex-form selector in each list does the work. Worth knowing only so nobody deletes the hex half believing the rgb half is a live fallback — it is not.

**Evidence:**

Five rgb()-form duplicates in feat_mls_opnote_templates_ui.js that sit beside working hex forms: :845 `body.theme-dark.mls-ot3 #tplDropZone[style*="250, 252, 255"]` and `[style*="251, 251, 255"]`; :850 `[style*="234, 241, 238"]` and `[style*="238, 240, 255"]`; :855 `[style*="207, 224, 245"]`. No style attribute or cssText assignment anywhere in the repo contains those rgb triples — the markup writes hex, and the hex siblings in the same selector lists do match. Also feat_mls_study_calm.js:42 `#mlsSgPro button[style*="8b5cf6"]` — `8b5cf6` appears only in unrelated marketing pages, never in a style attribute in the app. And three dark-theme colour variants in ScribeFlow.html's inline stylesheet that no element uses: `[style*="background:#eef4fb"]`, `[style*="background:#fdeced"]`, `[style*="background:#eefbf4"]`.

---

## 39. [LOW] Fourteen feat_mls_*.js modules are not referenced by any loader, so every rule they contain is unreachable — they are staging leftovers still listed as publishable assets.

**What the doctor sees:** Nothing — the modules never execute, so they never install their stylesheets. They inflate the deployed asset list and make grep results for any shared selector ambiguous, which is how a live rule gets attributed to a dead file during triage.

**Evidence:**

No script tag, no dynamic injection and no manifest outside pages-publication-inventory.json references these files: feat_mls_cal_athena_sync.js, feat_mls_cal_fullwidth_providers.js, feat_mls_cal_provider_roster.js, feat_mls_day_agenda.js, feat_mls_day_pace.js, feat_mls_herotoday_fix.js, feat_mls_lastseen_rows.js, feat_mls_month_pull.js, feat_mls_next_patient.js, feat_mls_patientlock_b52.js, feat_mls_problem_strip.js, feat_mls_problem_strip_hide.js, feat_mls_selected_day_sync.js, feat_mls_send_portal_invite.js. Three of them say so in their own first line: feat_mls_day_agenda.js:1 `/* feat_mls_day_agenda.js — item69 (STAGING)`, feat_mls_next_patient.js:1 `/* feat_mls_next_patient.js — item68 (STAGING)`. They are nonetheless listed for publication at pages-publication-inventory.json:103, :135, :166, :167. Together they account for roughly 60 harvested rules (#mlsDayAgendaPanel 10, #mlsPickSmartWrap 11, #mlsNextPatient 5, #mlsDayPace 7, #mlsProblemStrip 5, #mlsSendPortalInviteBtn 5, and others).

---

