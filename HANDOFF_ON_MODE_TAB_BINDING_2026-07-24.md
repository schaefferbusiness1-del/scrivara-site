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
