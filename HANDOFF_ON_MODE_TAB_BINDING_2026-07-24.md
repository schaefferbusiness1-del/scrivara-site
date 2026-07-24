# HANDOFF — the ONE blocker left for commercial acceptance (2026-07-24)

**Everything else the owner asked for tonight is done and proven live.** This file exists so the next
session can execute the remaining fix without re-deriving any of it.

## The blocker

ON-mode day pulls (Full visit notes ON) have **never** reached coverage-complete. OFF mode is
**verified complete at ~9.8 s/patient** (owner's stated target was ≤10 s), so the doctor's default
experience is good; ON mode is the exception that still fails.

Signature, identical on every run including on extension 3.0.5:

```
Incomplete: schedule 5/5; history 5/5; failures 5
  same-frame-name-mismatch  x3
  visit-bodies-incomplete   x2
```

## What has been RULED OUT (do not re-investigate)

1. **"The opener is a no-op."** Wrong — I published this then corrected it. The history loop DOES
   open each chart per patient: `feat_mls_schedimport_exact.js:2259` calls
   `window._assistReadChart(target, …)` with its own requestId/deadline, immediately before the
   visits read at `:2375`, and there is a bounded in-batch retry around it (si-1.7.2).
2. **"The identity reads are broken on athena v26.7."** Wrong — a single-patient lane pull refused
   with *"athenaOne has a DIFFERENT patient open"*, which is the identity gate working correctly.
3. **"Settle-polling will fix it."** Wrong — that is exactly what 3.0.5's swap-settle pre-gate does.
   Same-day A/B on the identical 5-patient day: 3.0.4 = 909 s with 5/5 bodies failed;
   3.0.5 = 682 s (**-25 %**, a real speed win) but still 0/5 complete, with the failure mix merely
   MOVING (2 charts now clear the identity gate and fail later). Waiting longer cannot help.

## The live hypothesis (highest confidence, not yet proven)

**The visits read is not bound to the tab the chart was proven in.**

- `background.js:9448 runAllVisits()` calls `pickEmrTab(frozenHint)` and reads whatever chart is open
  in whatever Athena tab it picks. The tabId that `_assistReadChart` just proved is **never passed to
  it** — the bridge payload at `feat_mls_schedimport_exact.js:2375` carries only
  `{requestId, deadlineAt, managed, background, silent, initiator, hint:{patient,name,dob,athenaId}}`.
- **At least two Athena tabs exist in the owner's Chrome**: a goto diagnostic reported the extension
  driving `tabId 256594014` while this session's tab group held Athena tab `256594376`.
- If the chart opens in tab A and the reader picks tab B, tab B legitimately shows a different
  patient and the identity gate **correctly** refuses with `same-frame-name-mismatch`. That is a
  safety feature doing its job, not a reader bug — which is why every attempt to "fix the reader"
  has failed.
- Project memory already carries this hazard class: *"athenaTabs must be 1"* (write-test encounter gate).

## Do this first — it is cheap and decisive

1. **Owner-side, zero code:** close every athenaOne tab except one, then run an ON-mode day pull.
   If it completes, the hypothesis is proven and the permanent fix below is the real work.
2. **Instrumented:** during a pull, capture the tabId in the chart-open receipt and compare it with
   `vr.diag.tabId` from the visits read. Different ⇒ hypothesis confirmed.
   (Note: `mlsAppChartResult` / `mlsAppAllVisitsResult` do **not** currently surface `diag.tabId` to
   the page — only `mlsAppGotoDateResult` does. Adding it to both receipts is a 2-line change and is
   worth doing regardless, because it makes this class of failure self-diagnosing.)

## The permanent fix (ships as extension 3.0.6)

Thread the proven tabId end to end:

- `feat_mls_schedimport_exact.js` — capture the tabId from the `_assistReadChart` receipt for this
  patient and include it in the `mlsAppReadAllVisits` payload (e.g. `tabId: <proven>`).
- `background.js runAllVisits()` — when the caller supplies a tabId, **use that tab** instead of
  `pickEmrTab()`. If that exact tab is gone or no longer shows the expected patient, refuse honestly
  with a distinct reason (`chart-tab-lost`), never silently fall back to another tab.
- Keep every identity gate exactly as it is. This change removes the *cause* of the wrong-chart
  refusals; it must not relax the refusals themselves.

Release via the `mls-extension-release` skill (full pin train — and remember the **escaped-regex zip
forms** `MLS_Assist_v3\.0\.5\.zip` in `extension-package`, `public-publication-boundary` and
`public-release-truth-boundary`; a plain `3.0.5` grep does not find them).

Also still open for 3.0.6: the **full provider roster read** (the dropdown shows only the one provider
in the current department; the practice has 216 departments).

## Only after a bodies-ON day reaches coverage-complete

Then, and only then, run ON ×2 and month ×2 for acceptance. Task #3 must not be closed on OFF-mode
evidence alone.

## Shared-tree rules that kept four sessions from clobbering each other

- Build each blob from `git show HEAD:<file>` + only your edits, write it with `git hash-object -w`,
  stage with `git update-index --cacheinfo`, then certify by
  `git checkout-index -a --prefix=<tmp>` and running the gate **there**. The working tree keeps other
  sessions' WIP; your commit contains only yours.
- **Announce a build number here/by session message BEFORE staging.** Two collisions happened tonight
  and were caught only by messaging (b534, then b536→b538).
- The `/mls-build-ship` pin list is **stale**: `sw.js` carries only the cache version now, and
  `oldbrowser-compat-runtime` / `public-preview-integration-contract` no longer pin `bNNN`. Scan for
  the pins; never trust the list. Never scan-and-replace a build number across prose — it rewrites
  history in comments and charters.

---

## LATE CORRECTION (same night) — the tab binding ALREADY EXISTS. Do not build it.

I was about to specify "thread the tabId through" as new work. Reading `pickEmrTab` proves that
machinery is already there, and the real defect is narrower and cheaper to fix.

**`background.js:9222 pickEmrTab(hint)`** already honours a lease:

```js
var lease = self.__mlsVerifiedReadTarget || null, h = hint || {};
var leaseMatches = lease && (Date.now() - Number(lease.at||0)) < 180000
  && nk(lease.name) === nk(wantName)
  && (!wantDob || dk(lease.dob) === dk(wantDob))
  && (!wantMrn || nk(lease.mrn) === nk(wantMrn));
if (leaseMatches) { var exact = cand.find(t => Number(t.id) === Number(lease.tabId)); resolve(exact || null); return; }
```

with the comment *"Keep AllVisits in the exact Athena tab proven by the immediately preceding chart
receipt."* So the intent — and the wiring — is already correct.

**The lease is written at `background.js:7497`, but ONLY under a condition:**

```js
if (chartReceiptStrict.complete || exactGlobalIdentity) {
  self.__mlsVerifiedReadTarget = { tabId: tab.id, name: want, dob: wantDob, mrn: wantMrn, at: Date.now(), requestId: chartReceiptStrict.requestId };
}
```

### So there are exactly two ways ON mode can fail, and they are testable

1. **The lease is never written** — `chartReceiptStrict.complete` is false AND `exactGlobalIdentity`
   is false. The comment immediately above 7497 says this was already loosened once because athenaOne
   *"keeps cached previous-patient encounter iframes alive, which fail coverage binding on every
   consecutive pull and silently starved the lease, collapsing batch bodies to no-athena-tab refusals."*
   That is the exact failure we are seeing again on v26.7. With no lease, `pickEmrTab` falls through to
   the generic candidate sort (active tab first, then highest id) — which can be a different tab or a
   drifted chart, and the identity gate then correctly refuses.
2. **The lease is written but does not match** — `nk(lease.name) === nk(wantName)` is an EXACT
   normalized-string compare, while the identity gate itself (`visitIdentityGate`, 9375) deliberately
   tolerates abbreviated banner names via prefix/initial matching (*"athena shows Cubbage-Reilly A"*).
   If the identity phase and the visits phase are handed even slightly different name strings, the
   lease is silently discarded and we fall through to the same generic pick.

### The fix (small, and it must stay honest)

- Make the lease match use the SAME tolerant comparison the identity gate uses, or better, match on
  `lease.requestId` / the patient binding rather than on a name string.
- Record WHY a lease was not used, and surface it: `leaseMissing` vs `leaseStale` vs `leaseMismatch`.
  Today the fall-through is completely silent, which is why this took a full day to find.
- Strongly consider REFUSING rather than falling through to the generic pick when a batch read
  (`initiator: 'schedule-batch'`) has no lease: reading "whatever tab looks right" is exactly how a
  wrong-chart read would happen. A refusal with `reason:'chart-tab-unproven'` is safer and instantly
  diagnostic. The batch already re-opens and retries.

### First diagnostic to run (cheap, no release needed)

Add nothing; just observe. During an ON pull, log `self.__mlsVerifiedReadTarget` at the moment each
visits read starts. If it is null → cause 1. If it is present but `leaseMatches` is false → cause 2.
Both are one-line fixes at 7496/9245 respectively, and neither requires new plumbing.

---

## DECISIVE EXPERIMENT (same night) — it is NOT the name compare. The tab shows a DIFFERENT PATIENT.

Run with no code change, using the identical name string for both calls so the lease compare at
`:9245` could not possibly fail:

1. `mlsAppReadChart {patient:'Joan Holliday', dob:'05/27/1946', mrn:'7821966'}`
   → **`{ok:true, chartName:"Joan Holliday", chartDob:"05/27/1946", receipt.complete:true}`**
   `receipt.complete === true`, so the lease at `background.js:7497` **WAS written**, with
   `name:'Joan Holliday'` and the tabId it just proved.
2. Immediately after, `mlsAppReadAllVisits` with `hint:{name:'Joan Holliday', dob:'05/27/1946', athenaId:'7821966'}`
   — byte-identical name, so `nk(lease.name) === nk(wantName)` is TRUE and `leaseMatches` holds.
   → **`{ok:false, reason:'same-frame-name-mismatch', visits:0, identity.name:"Monterosso, ROSEMARY"}`**

### What this rules IN and OUT

- **RULED OUT — cause 2 (name-normalization mismatch).** The names were identical strings. The lease
  matched. This is not an abbreviated-banner problem.
- **RULED OUT — cause 1 (lease never written).** `receipt.complete` was true.
- **RULED IN:** the reader resolved a tab and that tab was displaying **a different patient entirely**
  (`Monterosso, ROSEMARY` — banner "Last, FIRST" format, so it IS an Athena chart banner, just the
  wrong chart). The identity gate then refused **correctly**. The gate is not the bug; it is the only
  reason a wrong-patient read did not happen.

So the remaining question is narrow and concrete: **why is the tab the reader reads showing a stale
patient?** Two candidates, and they are distinguishable:

- **(A) Multiple Athena tabs.** `lease.tabId` points at tab A (where Joan was proven), but
  `cand.find(t => t.id === lease.tabId)` fails — tab A is not in the filtered candidate list — so the
  code falls to `resolve(exact || null)` → **null** → and the caller's re-pick loop then chooses a
  DIFFERENT tab (tab B), which is parked on Rosemary Monterosso from an earlier operation.
  Note `resolve(exact || null)` silently degrades here; nothing reports "the proven tab was not a
  candidate".
- **(B) The proven tab navigated away** between the chart proof and the visits read (a background
  yank, an idle redirect, or another automation touching the same tab).

**Next step, still no release needed:** log/emit `{leaseTabId, candidateTabIds, chosenTabId}` from
`pickEmrTab` into the visits receipt `diag`. One object tells you A vs B immediately. Today that whole
decision is invisible, which is exactly why this took so long.

**Whichever it is, the fix rule is the same:** for `initiator:'schedule-batch'`, if the proven tab is
not available or no longer shows the expected patient, **refuse with `chart-tab-unproven` and let the
batch re-open** — never silently resolve to another tab. Reading "whatever tab looks right" is the
only path by which a wrong-chart body could ever be attributed to a patient.

**Owner-side workaround to try first (10 seconds, no code):** close every athenaOne tab except one,
then run an ON-mode pull. If candidate (A) is correct, that alone should make ON mode complete.

---

## CONFIRMED: THERE ARE MULTIPLE ATHENA TABS. Candidate (A) is the cause.

Final discriminator, no code change:

1. `mlsAppReadChart{Joan Holliday}` → `{ok:true, chartName:"Joan Holliday"}` — the extension proved
   Joan's chart and wrote the lease.
2. Immediately read the DOM of the Athena tab this session can see (`tabId 256594376`) → its banner
   shows **"RTKR, Dr"**, NOT Joan Holliday.

So the chart the extension proved is **not in the Athena tab visible to this session**. The extension
is driving a DIFFERENT athenaOne tab. Combined with the earlier goto diagnostic reporting
`tabId 256594014` while this session's group held `256594376`, and with the visits read returning
`identity.name:"Monterosso, ROSEMARY"`, the picture is consistent and complete:

**≥3 athenaOne tab states are in play. The chart is proven in one tab, and the visits read resolves a
different one, which is parked on a stale patient. The identity gate then refuses — correctly.**

This is candidate (A) from the previous section, and it explains every observation of the day:
- why ON mode fails on most patients but not all (it depends which tab happens to be picked);
- why OFF mode is unaffected (it never does the second, separate visits read — the six-card chart data
  comes back with the chart read itself);
- why 3.0.5's settle-polling improved wall-clock but fixed nothing (waiting cannot change which tab);
- why the single-patient lane refused with *"athenaOne has a DIFFERENT patient open"*.

### Actions, in order

1. **OWNER, ZERO CODE, DO THIS FIRST:** close every athenaOne tab except one, then run an ON-mode pull.
   On this evidence that alone should let ON mode complete.
2. **Extension 3.0.6 — make it impossible to hit again.** For `initiator:'schedule-batch'`, if the
   lease tab is not among the candidates, or the resolved tab's identity does not match the expected
   patient, **refuse with `chart-tab-unproven`** and let the batch re-open. Never fall through to a
   generic tab pick. `pickEmrTab`'s `resolve(exact || null)` currently degrades silently and the
   caller's re-pick loop then chooses another tab — that silent degrade is the defect.
3. **Tell the doctor.** The app should detect >1 athenaOne tab and say so before a pull starts
   ("MLS found 3 athenaOne tabs — keep one open so charts cannot be mixed"). Project memory already
   carries "athenaTabs must be 1" for the write lane; the read lane needs the same honesty.

### Note on the experiment's own limits (do not over-read it)

These probes were raw bridge calls, so they did NOT hold the pull lease or the cross-tab busy stamp
that a real `pull()` holds. That does not weaken the conclusion — the tab the extension proved was
already not the tab this session can see — but a real batch run holds those leases, so reproduce
inside a real pull before declaring 3.0.6 fixed.

---

## ⛔ RETRACTION — THERE IS ONLY ONE ATHENA TAB. The multi-tab conclusion above is WRONG.

I tested my own conclusion instead of shipping it, and it failed. Navigating this session's athenaOne
tab (`256594376`) away from athenanet and immediately starting an ON pull produced:

```
"No athenaOne tab open."   → nav-failed in 16s
```

If a second athenaOne tab existed, the pull would have used it. **My tab was the only one.** So:

- The earlier "the extension drives tabId 256594014 while my group holds 256594376" observation is not
  evidence of two live tabs — tab ids change across the session (Chrome reassigns them; my own group
  was recreated at least twice tonight after the extension host blipped).
- The "the visible tab shows RTKR, Dr, not Joan" observation was a **BAD PROBE**: my regex
  `([A-Z][a-zA-Z'-]+,\s*[A-Z][a-zA-Z'-]+)` matched a procedure/provider string somewhere in the frame
  tree, NOT the patient banner. It never proved which chart was displayed.

**b540's tabhint-1.0.0 message is therefore mis-worded** and should be corrected: it tells the doctor
to close extra athenaOne tabs, which is not the cause. It is harmless (the advice is safe, and the
"nothing was saved to the wrong patient" half is true and valuable) but it points at the wrong thing.
Fix the wording when the real cause lands.

### What the evidence actually supports now

The visits read returned `identity.name:"Monterosso, ROSEMARY"` — a genuine Athena banner in
"Last, FIRST" form — from the SAME tab in which "Joan Holliday" had just been proven. Within one tab,
that means the reader resolved a **stale frame belonging to a previous patient**. The codebase already
documents exactly this, at `background.js` above line 7490:

> *"athenaCollector keeps a CACHED encounter iframe from the PREVIOUS patient alive on the chart, and
> it can outscore the still-hydrating fresh list … silently starved the lease, collapsing batch bodies
> to no-athena-tab refusals."*

That is the live hypothesis now: **the frame-scoring picks a cached previous-patient iframe over the
freshly-hydrating one**, and the identity gate then refuses — correctly. 3.0.2 added a same-frame
identity walk for exactly this; v26.7 appears to have changed the shape enough that the walk picks
wrong again.

### Next step (unchanged in spirit, corrected in target)

Emit, from the visits read, WHICH frame was chosen and what identity each candidate frame reported.
The decision is invisible today. Then make the batch lane refuse (`chart-frame-unproven`) and re-open
rather than reading a frame whose identity does not match — never widen the identity gate to make a
read succeed.

**Lesson worth keeping:** two of my three conclusions tonight were wrong, and each was caught only by
running the experiment that could disprove it. Do not ship a diagnosis that has not survived an
attempt to break it.

---

## ✅ THE ACTUAL BUG (highest confidence yet) — the identity walk gives up after 4 frames

`background.js:9608`:

```js
for (var ecI = 0; ecI < enumCandidates.length && ecI < 4; ecI++) {
```

This is the 3.0.2 same-frame identity walk: score every enumerate-capable frame, then walk them
best-first and take the FIRST whose own frame identity matches the frozen patient. It is the right
design. But it **stops after 4 candidates**.

Athena keeps cached encounter iframes from PREVIOUS patients alive (documented in this same file above
line 7490). Those cached frames enumerate successfully, so they land in `enumCandidates` and are
scored. As a batch progresses, more of them accumulate. The moment **five or more** stale frames
outrank the still-hydrating fresh one, the fresh frame is never identity-checked at all — the walk
exits having only examined stale frames, `gate` holds the best stale frame's failure, and the read is
refused with `same-frame-name-mismatch`.

### Why this explains EVERY observation, where the earlier theories did not

- **Refusals rise as the batch progresses** — cached frames accumulate per patient opened.
- **OFF mode is completely unaffected** — it never runs the enumerate/visits walk at all.
- **Settle-polling (3.0.5) changed timing but not outcome** — waiting does not reorder the candidates.
- **The single-patient lane behaved differently** — a fresh tab has few cached frames.
- **It worked on v26.3 and regressed on v26.7** — the newer UI renders more frames per chart, so the
  fresh frame slips past position 4 far more often.
- **The identity gate was always right** — it never saw the correct frame to accept.

### The fix

1. Raise or remove the cap: walk **all** enum-capable candidates (they are already sorted best-first,
   and each check is one cheap `identity` exec). Bound it by `readDeadline`, which the loop already
   checks (`if (Date.now() >= readDeadline) break;`), not by an arbitrary count.
2. Record `candidatesExamined`, `candidatesTotal` and each candidate's identity verdict in the
   receipt `diag`. The whole decision is invisible today, which is why this took a full day.
3. Keep the refusal semantics exactly as they are. This change lets the gate SEE the right frame; it
   must never be allowed to accept a wrong one.

**Risk: very low.** One loop bound, no identity logic touched, no new plumbing, no page-side change.
Ships as ext 3.0.6 via the normal pin train, then re-run a bodies-ON day and expect coverage-complete.

**Verify before believing it:** instrument first (step 2), run one ON pull, and confirm from the diag
that the fresh frame really was beyond index 3. If `candidatesTotal` is ≤4 on a failing patient, this
theory is wrong too — and it should be retracted as loudly as the previous two.

---

## ⛔ RETRACTION #3 — the 4-candidate cap was NOT the cause either. 3.0.6 is live and ON still fails.

Tested rather than assumed. ext 3.0.6 (frame walk 4 -> 16) hand-loaded and pong-verified running
(`3.0.6+core-sha256:eabb1221…`), then a bodies-ON pull of the same 5-patient day:

```
schedule 5/5 · history 5/5 · coverageComplete 0 · same-frame-name-mismatch x5 · 836s
```

Identical to 3.0.4 and 3.0.5. Raising the cap changed nothing, so the fresh frame was never the
problem: **with up to 16 candidates examined, NOT ONE frame in the chart reported an identity matching
the expected patient.**

(The 3.0.6 change is harmless and worth keeping — a count bound of 4 was arbitrary and the walk is now
time-bounded too — but it is not the fix.)

### What that leaves — and it is now well constrained

The chart reader and the visits reader use DIFFERENT identity paths, and only one of them works:

- `mlsAppReadChart` on the same patient minutes earlier returned
  `{ok:true, chartName:"Joan Holliday", chartDob:"05/27/1946", receipt.complete:true}` — **identity
  extraction succeeds** in the chart reader.
- The visits reader probes each candidate frame with `exec(emrId, [frameId], ['identity', cfg])` and
  feeds that into `visitIdentityGate`. Across 5 patients x up to 16 frames, it never produced a match,
  and when it did report a name it was a DIFFERENT patient ("Monterosso, ROSEMARY").

**Next hypothesis (untested): the per-frame `identity` extractor used by the visits reader is stale on
athena v26.7** — it reads a banner/selector that has moved, so it returns either nothing or whatever
the outer/previous chrome still shows, and the gate refuses correctly. The chart reader's identity path
was evidently updated for v26.7 (or never depended on that selector) and still works.

### The next step is instrumentation, not another guess

Three theories have now died in a row (broken opener; multiple tabs; candidate cap), each killed by the
experiment that could disprove it. Stop guessing and make the reader show its work:

- emit, per candidate frame: `frameId`, the raw identity object returned, and the gate's reason;
- run ONE bodies-ON patient and read that list.

If every frame returns an empty/garbage identity → the extractor is stale; port the chart reader's
working identity path into the visits reader. If one frame returns the RIGHT identity but the gate
still refuses → the bug is in `visitIdentityGate` normalization, not the extractor.

**Do not ship a fourth theory without that data.**

---

## 🔎 NEW HARD DATUM — the visits reader is 2.9.22-era code

A diag probe against ext **3.0.6** returned:

```json
{ "ok": false, "reason": "no-athena-tab",
  "receipt": { "readerVersion": "2.9.22-visits-r4-two-stage" } }
```

**The extension is 3.0.6; the visits reader inside it still identifies as `2.9.22-visits-r4-two-stage`.**
Every 3.0.x release since has updated the chart reader, the schedule reader, the identity bootstrap and
the write lane — but this component has not moved since 2.9.22, which predates BOTH athena UI changes
(the 2026-07-21 v26.3 flip that made the Visits panel collapsible/progressive, and the v26.7 upgrade).

That is exactly consistent with the constrained remainder:
- `mlsAppReadChart` (updated path) extracts identity correctly — proven live, right name AND DOB.
- the visits reader's per-frame identity probe (2.9.22 path) never matches, across 5 patients x up to
  16 frames, and once reported a completely different patient.

**This is now the prime suspect and it is a component-level answer, not another one-line guess:** the
two-stage visits reader's frame/identity selectors are two athena UI generations out of date.

### Also learned from the same probe (useful, non-obvious)

`no-athena-tab` is returned when there is **no fresh verified-read lease AND no open chart matching the
hint** — the reader refuses rather than reading an arbitrary tab. That is correct and is why a bare
visits probe (without a preceding chart read) cannot be used as a test harness: always do
`mlsAppReadChart` immediately before, exactly as the batch does.

### Recommended next step (unchanged discipline: instrument, then fix)

1. Find the 2.9.22 two-stage visits reader in `background.js` (search `2.9.22-visits-r4-two-stage`) and
   diff its frame-selection/identity extraction against the CHART reader's, which demonstrably works on
   v26.7.
2. Emit per-candidate `frameId` + raw identity + gate reason (one patient is enough).
3. Port the chart reader's proven identity extraction into the visits reader rather than patching
   selectors blind. Keep `visitIdentityGate` exactly as it is — it has been correct at every step and is
   the only reason no wrong-patient body was ever stored.

---

## ✅✅ THE BUG, FOUND AND VISIBLE — the identity extractor cannot read athena's banner format

`background.js`, the per-frame `op === 'identity'` extractor used by the visits reader (~line 8575):

```js
var nm = body.match(/\bPatient\D{0,4}([A-Z][a-z]+(?:\s+[A-Z]\.?)?\s+[A-Z][a-z]+)/); if (nm) name = nm[1];
if (!name) { var h = document.querySelector('h1,h2,[data-patient-name],.patient-name,[class*="patientname" i]'); if (h) name = txt(h).slice(0, 60); }
```

It matches ONLY `Firstname Lastname` in **title case**, preceded by the literal word "Patient".

**athena renders the banner as `Last, FIRST`** — surname first, comma, given name in CAPITALS. That is
exactly what we captured live: `identity.name: "Monterosso, ROSEMARY"`. The regex cannot match
`Holliday, JOAN`:
- `[A-Z][a-z]+` requires title case, but `JOAN` is all-caps;
- there is a comma between the tokens;
- the literal "Patient" prefix is not adjacent in the v26.7 banner.

So `nm` fails, and the code falls through to a **generic `h1,h2` grab**, which returns whatever heading
happens to exist in that frame — including a heading left over from a previously-opened chart. That is
precisely the observed behaviour: a name is returned, it belongs to a different patient, and
`visitIdentityGate` refuses. **The gate was right every single time.**

### Why this is the answer and the earlier three were not

- The chart reader uses a DIFFERENT, updated identity path — which is why `mlsAppReadChart` returns the
  correct name AND DOB for the same patient, seconds apart.
- Raising the candidate cap (3.0.6) could not help: every frame was being read by the same broken
  extractor, so no frame could ever match.
- It is unrelated to tabs or to the opener, both of which were tested and retracted.
- It predates v26.7 in principle but only became total when athena moved fully to the `Last, FIRST`
  caps banner.

### The fix (small, and the gate needs NO change)

Teach the extractor athena's banner shape, e.g. accept `LAST, FIRST [M]` / `Last, FIRST` and normalise
to tokens. **`visitIdentityGate` already tokenises, lowercases and matches order-independently** — feed
it `"Holliday, JOAN"` for wanted `"Joan Holliday"` and it produces `['holliday','joan']` vs
`['joan','holliday']`: both tokens present, first and last both satisfied, `nameOk === true`. So simply
extracting the banner correctly makes the gate pass, with **zero loosening of the identity contract**.

Recommended shape:
1. add a `Last, FIRST` branch to the name match (allow all-caps given names, optional middle initial);
2. prefer an explicit banner container over the generic `h1,h2` fallback, and if only the fallback
   matched, mark the identity `weak:true` so the gate can refuse rather than trust a stray heading;
3. keep DOB/MRN extraction as-is (they already work — the chart reader proves the data is present).

Ship as 3.0.7, hand-load, then run a bodies-ON day and expect coverage-complete. **Verify before
believing it** — three theories died tonight; this one is the best-evidenced but is not proven until a
day completes.

---

## STATE AS OF 3.0.7 (keep this section current — owner asked that any AI can take over cold)

**Extension versions tonight:** 3.0.5 (swap-settle; -25% wall clock, did not fix reads) -> 3.0.6
(frame-walk cap 4->16; did NOT fix reads, retained because the bound is now time-based too) -> **3.0.7
(banner-aware identity extractor — the fix aimed at the bug I could actually see in the code).**

**3.0.7 contents:** in `background.js` `op === 'identity'`, the name match now also accepts athena's real
banner shape `Last, FIRST [M]` (all-caps given names, comma separator), tries explicit patient-name
containers before any generic heading, and when a name came ONLY from a bare `h1,h2` it returns
`weakName: true` so a stray heading can never be trusted as identity proof. `visitIdentityGate` is
untouched — it tokenises and lowercases, so "Holliday, JOAN" satisfies wanted "Joan Holliday" without
any loosening.
- built from a CLEAN worktree at origin/main (NEVER the shared clone — its background.js carries ~254
  insertions of another session's WIP)
- digest `3.0.7+core-sha256:b52623dfd2cc9b0478f83f7e2309df6ee479e67ae0b49d2dcb476fab1ffe9b63`
- zip sha `3463e1b07d85d082e82b8ed2740b5a8e113d1dabfa5867f9e6da4896f79a0377`
- hand-loaded into `C:\Users\Micha\Downloads\MLS_Assist_v1.65` and **pong-verified running 3.0.7**
- **NOT yet published** (no pin train run for 3.0.7) and **NOT yet proven** — a bodies-ON day must reach
  coverage-complete first. If it does: run the pin train, publish, then ON x2. If it does NOT: retract
  as loudly as the previous three and go to per-frame instrumentation.

**Scripts to reuse (scratchpad, this session):** `fix-identity-banner.js` (the 3.0.7 edit, latin1 +
CR-census guarded), `bump307.js`, `stage-306b.js` (full pin train + build bump, mine-only from HEAD),
`stage-next.js` (generic bump stager that SCANS for pins instead of trusting the stale build-ship list).

**Build ledger (neither session may reuse a number):** UI session b533/535/537/539/540/541/542/543/544/
548/549; me b534/538/546/547. **b536 and b545 are RETIRED** (abandoned mid-flight). Live is b549; the UI
session takes b550 next.

**Backend facts I was handed and have NOT independently verified — ask the backend, not the repo files:**
- `/api/health` reports every capability true including communications; `/api/billing/health` reports
  mode LIVE with checkout ready and webhooks configured. The old "live keys but TEST webhook secret"
  note is STALE.
- Twilio credentials are already in Render. The ONLY remaining action is pointing the number's Voice
  webhook at `https://scrivara-backend.onrender.com/api/voice/<booking-token>` where the token is the
  practice's existing booking-link token from `schedule_tokens`. `POST /api/voice/:token` is written and
  books real open slots (weekdays 9-5, 30-min, next ~3 weeks, minus booked).
- Repo files claiming things are unconfigured (e.g. privacy.html listing Twilio as "Planned") are stale.

**Files that will refuse edits, by design:** the attorney intake form is a test-pinned refusal surface,
not dead UI; `privacy.html` / `terms.html` have their SHA-256 pinned into the signup assent manifest, so
even a colour change perturbs a legal audit trail. Expect those suites to stop you.

**Owner asks still open:** remove the MLS popup that appears on the athenaOne page (content-script
change, next extension build); per-card capture receipts (read | empty-confirmed | not-found) so an
empty Medications card cannot be confused with an unread one; Adam writeback x2 (BLOCKED — only the
owner can create the encounter); ON x2 + month x2 acceptance.

## 3.0.7 RESULT — PARTIAL. The identity fix works for 3 of 5; the failure moved downstream.

Same 5-patient day, bodies ON, ext 3.0.7 pong-verified running:

```
schedule 5/5 · history 5/5 · coverageComplete 0 · 933s
fails: visit-bodies-incomplete x3 · same-frame-name-mismatch x2
```

**The failure mix changed for the first time in four builds** (3.0.4/3.0.5/3.0.6 were all
same-frame-name-mismatch x5). Three patients now CLEAR the identity gate and fail later at
`visit-bodies-incomplete`. So the banner-aware extractor is doing real work — the "Last, FIRST" branch
resolves identity where the title-case-only regex never could — but it is not sufficient.

**Interpretation, stated carefully:** identity extraction was A cause, not THE only cause. Two patients
still mismatch (their banners presumably differ again — possibly hyphenated or single-token surnames,
or a frame whose banner is genuinely absent so the weakName fallback fires and is correctly distrusted).
Three now get far enough to attempt bodies and cannot finish them, which is a DIFFERENT problem in the
two-stage reader's body-collection phase.

### Next, in order

1. **Instrument, do not guess** (this is now the fourth iteration): emit per candidate frame the raw
   identity object + gate reason, AND for `visit-bodies-incomplete` emit expected vs parsed counts and
   which encounter rows failed. One patient of each failure class is enough.
2. For the 2 remaining mismatches: log the actual banner text seen. The fix is likely one more branch
   (hyphenated/single-token surnames) — but confirm from the string, do not infer.
3. For the 3 bodies-incomplete: that is the 2.9.22-era two-stage body reader, which has never been
   updated for the v26.3 progressive/collapsible Visits panel. Expect the row-expansion step to be the
   next thing to have gone stale.

**Keep 3.0.7.** It is a strict improvement (3 patients further along, no regressions, no loosened gate)
and it is hand-loaded and pong-verified. It is NOT published — run the pin train only once a day
actually completes.
