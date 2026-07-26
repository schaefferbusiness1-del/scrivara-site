# WORKER J — extension truth pass (ext 3.0.22 prep), 2026-07-26

**Branch `worker-j-ext322`, worktree `dispatch-work/worker-j-ext322`, rebased onto `origin/main`.**
Nothing pushed, no version bumped, no digest stamped, no zip built — the lead's release train
owns all four. No browser and no live Athena session were touched; every claim below is read out
of the source at the tip or measured by the local harness, and where something is unverified it
says so.

```
base            8bff6a3   b689
7cc8f48         ext wrt-1.0.0   no success claim without a per-destination receipt
0dae608         ext prs-1.0.0   the provider roster states its SCOPE
(+ 1 pending)   month-pull coverage notice + gate arm
gate            351/351 PASS    (with the core digest TEMPORARILY stamped — see §6)
new suites      tests/write-claims-need-a-receipt.test.js        10/10 mutations caught
                tests/all-providers-means-all-providers.test.js   9/9 mutations caught
```

---

## 0. Line numbers drifted. Everything below is re-derived from the tip.

Worker B's §4 file:line list does not resolve at `origin/main`. `overlayPasteNote` is at
**11443**, not 11814; `doWriteBack` at **11922**, not 11348; `feat_save_verify.js` at **526**, not
525. The offsets are not even consistent with each other, so they cannot be corrected by a single
delta — each site was re-found by content. **Two of B's claims were already false at the tip and
are recorded here rather than "fixed":**

- B#5's *"`:11816-11819` fabricates a fallback section object without the `written` key"* — the
  two `sections.push()` sites inside `overlayPasteNote` both carried `written` already. The
  key-less fallback is real, but it is in **`doWriteBack`**, not the paster.
- B's *"`mls-popup.js` … Live: the entry button is `✍ Write to chart` in a real content script"*
  — `mountDOM()` returns `null` unless `window.__mlsPopupShowOnAthena === true`
  (`mls-popup.js:305`, the owner's 2026-07-24 "just remove this mls thing" decision). **The
  overlay does not mount on athenaOne today.** The defects were still real and still worth
  fixing — the core is exported, the transport is live, and the flag is one line — but the blast
  radius B assigned to them was measured against a surface that is currently off. I fixed them at
  the same severity anyway, because the root fix had to land in `doWriteBack` regardless and a
  two-state renderer over a three-state receipt is a landmine the moment that flag flips.

---

## 1. THE SIX FALSE-SUCCESS DEFECTS — root first, then each surface

### The mechanism, in one paragraph

`overlayPasteNote` (`background.js:11443`) only ever set `.error` for **environmental** failures:
no athenaOne tab, no scanner, empty note. When the **paste itself** failed — no matching field in
the open encounter, or text typed into a field athenaOne never echoed back — it returned
`{sections:[…]}` with every entry `written:false, confirmed:false` and **no `.error` at all**.
`doWriteBack` never inspected the sections. So the reply a caller received over a write that
provably did not happen was **byte-for-byte the success shape**, and every consumer downstream did
the only thing it could with that.

### What changed, with before/after

| # | site (tip) | before | after |
|---|---|---|---|
| **5 ROOT** | `background.js:11443` `overlayPasteNote` | `return { sections: sections };` — sections carried no `notfound` | `return mlsPasteVerdict(sections);` — every section carries `notfound`; the verdict carries `ok`, `sectionCount`, `confirmedCount`, `writtenCount`, `notFoundCount` |
| **5 ROOT** | `background.js:11922` `doWriteBack` | fallback section `{section, confirmed}` — **no `written`, no `notfound`**; sections never inspected; returned `{note:{sections}, codes}` | one `mlsWriteTally()`; `confirmedCount === 0` returns `{ok:false, error:'nothing-confirmed', notConfirmed:true, wrote:0, message:<names what refused>}`; success returns `{ok:true, partial, wrote, note:<full receipt>}` |
| **5 ROOT** | same, patient gate | `return { blocked: true, mlsIdentity, chartIdentity };` — no `error`, no `message` | `{ok:false, blocked:true, error:'patient-gate-failed', signed:false, wrote:0, message:'Patient gate failed (name + DOB) — refusing to write to this chart. Nothing was written.'}` |
| **1** | `mls-popup.js:236` | `narrate('Draft written (unsigned)…'); setState('written');` reached **unconditionally** after the loop | reached only when `__confirmed >= 1`; otherwise `st.written = null`, the failure is narrated, state returns to `review` |
| **1** | `mls-popup.js:684` `summaryLine()` | `w.sections.map(x => x.section)` — **no filter on `confirmed`**; empty fallback was `'Draft written (unsigned).'` | confirmed and unwritten are separate clauses (`Confirmed in athenaOne → …` / `NOT written: …`); empty fallback is `'Nothing was confirmed in athenaOne.'` |
| **1** | `mls-popup.js:536` | headline always `✓ Draft written` | `⚠ Partly written` when `st.written.partial` |
| **2** | `mls-popup.js:218` | two states over a three-state receipt: a destination never written rendered `⚠ Wrote to X but couldn't confirm` | three: confirmed / `Typed into X but athenaOne did not confirm it` / `Nothing written to X — no matching field was found in the open encounter` |
| **3** | `feat_mls_status_center.js:817` | `var okW = resp && !resp.error;` → `'Write-back reported success'` | `writeVerdict(resp, isSign)` — an explicit allowlist whose **default is never success**; `blocked`, `ok:false` and (on a sign) `signed !== true` are each independently disqualifying |
| **4** | `mls-connect.js` ×5 `handOff` | `try { fn(); } catch (e) {} if (msg) toast(msg);` | the throw is captured; on a throw the toast becomes *"That didn't open — nothing happened. Try again."* |
| **4** | `mls-connect.js` ×10 toasts | `'Chart context pulled (read-only) for X.'` / `'Chart opened (read-only) for X.'` over `calPullChartFor(id)` that is fired and never awaited | `'Pulling chart context (read-only) for X…'` / `'Opening the chart (read-only) for X…'` |
| **6** | `feat_save_verify.js:526` | `var ok = (d.ok != null) ? !!d.ok : (d.result ? !!d.result.ok : true);` — fail-open default on a receipt field | `… : (arr(visits).length > 0));` — with no receipt field, the only evidence the message carries decides it |
| **latent** | `background.js:7978` | `sendResponse({ok:true, …, wrote})` over a `wrote[]` that could be entirely `notfound` | derives from the receipt it already builds. **Unreachable today** (the `legacy-segment-writer-disabled` kill switch returns above it) — defused so it does not come back with the switch |

### Receipt-trace for every remaining success claim on this lane

| surface | green only when | source of truth |
|---|---|---|
| `doWriteBack` reply | `tally.confirmedCount > 0` | `mlsNotePaster`'s per-section `confirmed`, which is athenaOne's own echo of the typed text |
| `mls-popup` `written` state | `__confirmed >= 1` **and** `!r.error` **and** `r.ok !== false` | `r.note.confirmedCount`, falling back to counting `s.confirmed` |
| `mls-popup` headline `✓ Draft written` | `confirmedCount === sectionCount` | same |
| `mls-popup` summary positive clause | per section `x.confirmed === true` | same |
| status centre `emr` row `ok` | `signed === true` (sign route) **or** a confirmed-destination count `> 0` | `resp.note.confirmedCount` / `resp.sections[].confirmed` / `resp.wrote[].confirmed` |
| `feat_athena_writeback.js:251` | `resp.ok && resp.confirmed` | **already correct — untouched.** This is the reference implementation |
| `mls-connect` `handOff` toast | the handler did not throw | the try/catch, which previously discarded exactly this |

### Two latent sites, deliberately NOT "fixed"

- `background.js` `MLS_OVL_SIGNSAVE` would click Sign & Save over a failed paste — dead behind the
  `sign-route-disabled` refusal, which requires `probe === true && note == null && codes == null`,
  so `msg.note` can never reach the paste. **Left alone: touching the sign boundary is a hard stop.**
- `background.js:7904` `mlsVerifiedWrite` is disabled by an unconditional `return` before its own
  async body. The `ok:true` inside it is defused (above) but the switch is untouched.

---

## 2. THE TWO LYING STRINGS (Worker B §5)

**The phantom keep-alive.** `mlsKeepAlivePageFn` installs
`{armed:false, disabled:'athena-session-policy', stop(){}}` — a documented no-op — and
`mlsArmKeepAlive` then returned `{armed:true}` over it, on both the deduped and the normal path.
Four callers read that value. The pin comment claimed *"the same 55s Worker keep-alive"* holds the
session open. **Nothing in this extension prevents an inactivity logout** — which is precisely why
sfp-1.0.0 had to exist. Both returns now report the marker that was actually installed
(`{armed:false, disabled:'athena-session-policy'}`), and the pin comment says
`AUTOMATIC KEEP-ALIVE IS DISABLED BY POLICY` and points at the staleness receipt. **Behaviourally
inert:** every caller (`:3444`, `:4090`, `:4381`, `:5651`) discards the return, and the diagnostic
at `:4362` reads the *page's* `__mlsKeepAlive.armed`, which was always honestly `false`.

**The phantom reload.** There is no `chrome.tabs.reload` and no `location.reload` anywhere in
`background.js` — deliberately: `mlsRecoverAthenaTab`'s own header explains that automatic reloads
invalidated Athena's CSRF state and could discard unsaved chart work, and it returns
`{skipped:'automatic-reload-disabled', tabUntouched:true}`. **The rationale is sound; four strings
describing it were not.** The clinician-visible one is now
*"Pausing on athenaOne to let it catch up — your tab is left untouched…"*, the find-patient retry
says *"waiting for it to recover and retrying"*, and three comments naming
`reload-recover` / `(reload + Continue-clear)` now say `session-safe recovery, NO reload`. The
gate asserts `chrome.tabs.reload` stays absent, so if reloads are ever re-enabled these strings
must be re-decided rather than silently re-becoming true.

---

## 3. THE WRITE LANE — exact current shape

For the lead's live Adam J Schaeffer proof. **The write MECHANICS are untouched by this lane.**

```
mls-popup core.writeBack()                     (mls-popup.js:198)
  └─ chrome.runtime  MLS_OVL_WRITEBACK
      └─ doWriteBack(tabId, msg)               (background.js:11922)
          ├─ 1  ext.findTab()  -> mlsPickAthenaTab({athenaOnly:true})
          │        re-probes the session; a signed-out tab returns null (fails closed)
          ├─ 2  ext.readIdentity(tab.id) -> overlayReadIdentity -> mlsReadChartIdentity
          │        banner-preferred, junk-frame guard, shadow-DOM banner fallback
          ├─ 3  HARD GATE  identitiesMatch(lockedIdentity, chartIdentity)
          │        REFUSE-BY-DEFAULT. no locked identity  => blocked.
          │        no chart identity     => blocked.  no override exists on this route.
          │        -> {ok:false, blocked:true, error:'patient-gate-failed', message:…}   [NEW]
          ├─ 4  ext.pasteNote({note})  -> overlayPasteNote   (background.js:11443)
          │        mlsSegmentNote(text)                       (background.js:2702)
          │          op/procedure note stays ONE document -> 'procedure'
          │          else header map -> insurance | diagnoses | orders | procedure |
          │                             assessment_plan | hpi | physical_exam | ros
          │          <=1 recognised header  => whole note as ONE routed segment
          │        per segment, up to 2 attempts:
          │          mlsFieldScanner  allFrames  -> highest-scoring frame wins
          │            no frame has the field -> {ok:false, notfound:true, targetLabel}
          │          mlsNotePaster    that frame only
          │            types, then RE-READS the field and compares -> confirmed
          │        push {section, confirmed, written, notfound}                          [notfound NEW]
          │        return mlsPasteVerdict(sections)                                      [NEW]
          ├─ 5  mlsWriteTally(sections)                                                  [NEW]
          │        confirmedCount === 0  -> {ok:false, error:'nothing-confirmed', …}     [NEW]
          └─ 6  writeCodes(tabId, codes)   FLAGS.codesDriver is OFF -> {deferred:true}
                 -> {ok:true, partial, wrote, note:{…receipt…}, codes}                   [NEW]
```

**Hard blocks confirmed present and untouched.** `doWriteBack` never signs (asserted by the gate).
`writeCodes` is flag-gated OFF and returns `{deferred:true}` — **the ORDERS block holds**;
`mlsSegmentNote` can route a segment to `'orders'`, but nothing writes it. `MLS_OVL_SIGNSAVE`
refuses anything that is not a read-only probe (`sign-route-disabled`), and the legacy
`mlsAppPushVisit` and `mlsVerifiedWrite` writers are both disabled by unconditional refusals.
`write_safety_guard.js` is unchanged.

**One asymmetry the lead should know about:** step 3 matches against
`sessions[tabId].lockedIdentity` only. The `MLS_OVL_SIGNSAVE` route additionally falls back to
`msg.mlsIdentity` and then to a live read of the MLS tab's active patient; `doWriteBack` does not.
That is *more* conservative, not less, so it is left alone.

---

## 4. THE PULL MATRIX

### 4.1 The all-provider day pull — a real false-success, now disclosed (prs-1.0.0)

The coordinator's measurement on the owner's tab:

```
mlsProviderRosterReceiptV2 = {complete:true, expectedCount:1, observedCount:1,
                              providerMode:"all", targetDate:"2026-07-28"}
mlsProviderRosterV2        = ["Matthew Schaeffer, MD"]          <- ONE
the app's own calendar      = 18 providers with appointment counts
```

**Both** producers of that receipt in `background.js` derive completeness from the athenaOne Day
grid that happened to be **painted**:

```js
// background.js:6538 (structure-id strategy)
_provCompleteS = _provObservedS > 0 && _hMetaS.reachedEnd && _hMetaS.restored &&
                 _hMetaS.boundsStable && !_hMetaS.capReached && !_hMetaS.budgetExpired &&
                 (!_declProvS || _provObservedS >= _declProvS)
// background.js:6384 (legacy day-grid strategy)
_legacyRosterCompleteL = _legacyHeaderProofL && _legacyAllBoundL && out.providers.length > 0
```

Every clause is a true statement about **the sweep**. Not one is about **the practice**. His Day
view paints one provider column, so a sweep that correctly reads every column reads one provider
— and then declares the roster complete. `resolveProviderRequest(..., {requireRosterForAll:true})`
believes it, and an "all providers" day *and month* pull is silently bounded to whatever athenaOne
chose to paint.

**The recorded design note is superseded, and I have said why in the code.** The memory entry
*"an ALL-provider day pull needs no roster and BUILDS it"* is correct only if the grid paints
everyone. In this practice it paints one.

**What shipped — a disclosure, not a gate.** Same rule sfp-1.0.0 accepted: a signal that can fail
a pull working today is a regression traded for a disclosure.

- `feat_athena_provider_roster.js` **v2.3.0**: the receipt carries `scope:'painted-day-grid'`,
  `athenaListEnumerated` (**honestly `false` — nothing in this codebase reads athenaOne's own
  provider control**) and `scopeComplete`, which is the only field a "we covered everyone" claim
  may be built on. `complete` is **unchanged**, so every working pull keeps working.
- `__mlsProviderRoster.getScope()` states both numbers and the gap, e.g. *"18 providers known to
  MLS, but athenaOne's Day view painted only 1 of them and athenaOne's own provider list has never
  been enumerated. An "all providers" pull covers the 1 painted column, not the practice."*
  It travels with `getReceipt()` as `rosterScope`, so a consumer reading only the receipt cannot
  miss it.
- **The roster now LEARNS.** Providers observed on appointments MLS has already pulled
  (`window._calAppts[].provider`) are merged with provenance `observed-appointments`, alongside
  the existing `backend-calendar` and `athena-schedule-header` sources. This is what makes the
  other clinicians *reachable*: `resolveProviderRequest` resolves against this roster, so before
  the change every one of the other 17 failed `provider-unverified`.
  **Candidates are pre-filtered through `makeEntry` before the merge** — `mergeEntries` sets
  `_cacheSanitized` when an incoming semantic row is rejected, and a sanitized cache **downgrades
  a complete receipt**, so an unfiltered seed would have silently broken every selected-provider
  pull. That mutation is in the gate.
- The day pull's terminal verdicts (`Verified complete`, `Schedule-only complete`, the
  authoritative-empty message) and the month pull's `Verified month complete` carry a coverage
  sentence naming a real next step, and both results record `providerScope`. **An absent roster
  module produces silence, never "all"** — silence plus a clean receipt is how *unknown* gets
  upgraded to *all*, which is the original defect in a new place.

**Still open, and honestly so: nothing enumerates athenaOne's own provider selector.** Doing it
properly needs the live DOM of that control, which I cannot see from here, and a speculative
selector list would be a guess dressed as a source. `athenaListEnumerated` is the seam it plugs
into: when someone can read that control on a real tab, set it and `scopeComplete` becomes true on
its own. **I did not build the iterate-the-roster day sweep**, for the same reason — driving
per-provider navigation for N providers without ever seeing the provider control is how the
3.0.19 inert guard was written. What I did instead is make the gap loud, and make every known
provider individually pullable today via the existing selected-provider day and month lanes.

### 4.2 Month pull (`pullMonth` / `__mlsProvMonthPull`) — verify-only, honest

Per-day receipts, an explicit `retry.dates[]`, and a systemic circuit breaker that stops after 3
consecutive identical systemic failures and names the one real cause (the 2026-07-18 "thirty
identical failures in five seconds" fix). `result.complete` requires
`completeDays === dates.length && retry.dates.length === 0`. **No false success found.** It
inherits the §4.1 coverage limit in `all` mode, now disclosed.

### 4.3 Individual patient pull — verify-only

`pullPatientChartViaAssist` (`ScribeFlow.html:16356`) is **receipt-true**: it refuses unless
`_athenaChartProfileCoverage(chart).complete === true`, refuses unless
`_savePatientChart(saveRef, null, chart) === true`, and the ✅ toast fires only after that. Its
in-progress lines are present tense. **No false success found.**

`captureFromEMR` (`ScribeFlow.html:25591`) gates on `r.ok` from the backend
`/api/assist/extract` reply, which `background.js:7997` passes through with
`Object.assign({fromTab}, res)`. **Fails closed** — but note it fails closed on a field the
backend may not set, so a *successful* extract could report failure. **Unverified; flagged, not
changed**, because I have no evidence the backend omits `ok` and inventing a fallback here would
be exactly the fail-open default I just removed from `feat_save_verify.js`.

### 4.4 The lead's live-test script

**Arm 1 — all-provider day pull (the coordinator's finding).** Owner signed into athenaOne, Day
view on a clinic day, pull with "All providers".
- Terminal verdict must now end with the coverage sentence, e.g. *"Note on coverage: athenaOne's
  Day view showed 1 provider and that is who this pull covered, but MLS knows of 18 providers in
  this practice…"*
- From the MLS tab console:
  `__mlsProviderRoster.getScope()` → expect `{scope:'painted-day-grid', gridSweptCount:1,
  knownCount:>=18, athenaListEnumerated:false, scopeComplete:false}` and a `sources` map naming
  `athena-schedule-header`, `backend-calendar` and (once a day is pulled) `observed-appointments`.
- `__mlsProviderRoster.getReceipt().complete` must still be **`true`**. **If it is `false`, the
  seeding filter has failed and selected-provider pulls are broken — that is the one outcome that
  invalidates this change.**
- The pull result's `calendarReceipt.providerScope.coversPractice` must be `false`.

**Arm 2 — every known provider is now reachable.** In Calendar, pick a provider chip that is NOT
the one athenaOne painted, and press *Pull …*.
- Before: `provider-unverified` / *"That provider is not uniquely present in the verified Athena
  roster."*
- Expected now: the gate resolves and the pull runs. **If it still refuses, read
  `__mlsProviderRoster.resolve('<name>')` — `null` means either the name is ambiguous (two
  clinicians, fails closed by design) or that provider has never appeared on a pulled appointment
  or in `_calProviders`.**

**Arm 3 — month pull per provider.** Same provider, `pullMonth`. Expect per-day progress, and on
success `Verified month complete: N/N days…` **followed by the coverage sentence only when the
provider was "all"** — a selected-provider month pull must carry **no** coverage caveat.

**Arm 4 — individual patient pull.** Any patient with a matching DOB/MRN. Expect
`✅ Saved <name>'s Athena history…`. A partial chart must produce *"all six patient-history
sections were not verified. Nothing was saved as a complete pull"* — and nothing in the MLS chart.

**Arm 5 — the Adam J Schaeffer write proof.** The overlay does not mount on athenaOne unless
`window.__mlsPopupShowOnAthena = true` is set before load (§0), so drive `doWriteBack` from the
MLS app's write path, or set that flag first.
- **Happy path:** encounter open with the note field visible → per-destination lines, each either
  *"athenaOne confirmed it"* or an honest failure; headline `✓ Draft written` only if every
  destination confirmed, `⚠ Partly written` otherwise; summary separates
  `Confirmed in athenaOne → …` from `NOT written: …`.
- **The defect arm — this is the one that matters.** Write with the encounter **closed** (or on a
  chart with no note field). Expect: *"Nothing written to progress — no matching field was found
  in the open encounter"*, then *"Nothing was written. MLS could not confirm a single destination
  in athenaOne (progress). Open the encounter in athenaOne with the note field visible, then write
  again."*, and the screen **stays on Review**. **Before this change that run ended on a green
  "✓ Draft written" naming `progress` as a destination it never reached.**
- **The wrong-patient arm:** with a different chart open, the write must be refused with
  *"Patient gate failed (name + DOB) — refusing to write to this chart. Nothing was written."*,
  and the status-centre EMR row must be **red**, not green. That row was green before.
- **Never:** MLS must not click Save or Sign in any arm.

---

## 5. RISKS AND WHAT I DID NOT DO

- **No live verification of anything.** No browser, no Chrome tab, no Athena session. Every claim
  is source-read or harness-measured.
- **`feat_save_verify.js`'s new default can produce a failure card where none appeared before** —
  for a `mlsAppAllVisitsResult` that carries neither `ok` nor `result.ok` **and** no visits. I
  checked every real emitter (`content.js` ×7, every `_driveRequest` lane) and all of them set
  `ok`, so this branch should be unreachable in practice. If a card appears in the wild, the
  message is honest but the emitter is the thing to fix.
- **`handOff` now toasts a failure where it previously toasted success on a throw.** 67 call
  sites, five copies. Behaviour changes **only** in the path where the toast was previously a lie,
  but it is the widest-reach change in this branch.
- **The roster seeding runs inside `syncCalendarProviders()`, which `getReceipt()` calls**, and
  `resolveProviderRequest` calls `getReceipt()` on every provider gate. It is guarded to merge
  only genuinely new candidates, so the steady state is zero extra writes — but it is worth one
  glance on the owner's tab given this codebase's idle-churn history.
- **`receiptSnapshot()` copies `lastReceipt` BEFORE it calls `listEntries()`**, so a downgrade
  triggered by that sync is visible only on the *next* call. Pre-existing, not introduced here,
  and it cost me a mutation-test debugging pass — the gate now calls `list()` first. Changing the
  ordering could downgrade receipts that pass today, so I left it and am recording it instead.
- **No athenaOne provider-selector enumerator and no iterate-the-roster day sweep** — §4.1 says
  exactly why, and `athenaListEnumerated` is the seam left for it.
- **Two things I would put in front of the next lane:** an ALL-provider *month* pull repeats the
  painted-grid limit thirty times under the strongest coverage claim this product makes; and
  `enumDiag` is still discarded by the app, so the richest diagnostic the extension produces never
  reaches a page.

---

## 6. WHAT THE LEAD MUST DO

### 6.1 The branch is deliberately RED on exactly one suite

`manifest.json` is **untouched**, so `extension-package.test.js` fails on the core digest:

```
manifest.version_name  3.0.21+core-sha256:736284f1…db6f32     (the PUBLISHED 3.0.21)
computed               3.0.21+core-sha256:<new>               (my bytes)
```

**That is the gate working.** Stamping at 3.0.21 would mint a manifest claiming 3.0.21 with bytes
that are not the published 3.0.21, and anyone building a zip from it would ship a counterfeit.
Bumping to 3.0.22 alone would desynchronise it from `extension-version.json`, `get-extension.html`,
`sw.js`, the zip name and the pin tests, which move together or not at all.

**Everything else is verified green** by temporarily stamping, running `node tests/run-all.js`
(**351/351 PASS**, including both new suites), then `git checkout -- manifest.json`. The tree is
clean.

To ship, run the `mls-extension-release` train for **3.0.22** — and remember the **escaped-regex**
zip forms (`MLS_Assist_v3\.0\.21\.zip`) in `extension-package`,
`public-publication-boundary` and `public-release-truth-boundary`; a plain `3.0.21` grep does not
find them.

### 6.2 Pins moved deliberately

- `tests/provider-roster-machine-echo-collapse.test.js` — roster satellite version `2.2.2` →
  `2.3.0`. Sole pin; nothing else in the tree references that number.
- `tests/run-all.js` — two new suites registered.

### 6.3 Both new gates were proven in both directions

Per the b669 rule (*prove a new gate FAILS on the real regression AND PASSES on the real tree*),
each mutation restores the **pre-fix expression verbatim** and is run against the real tree:

```
write-claims-need-a-receipt          10/10 CAUGHT, clean tree PASS
  root gate removed · wrong-patient refusal loses its message · keep-alive claims armed:true ·
  the phantom reload string returns · popup enters "written" unconditionally · summaryLine lists
  every section again · the wrong-patient refusal stops disqualifying · the fail-open receipt
  default returns · the past-tense claim returns · handOff toasts over a throw

all-providers-means-all-providers     9/9 CAUGHT, clean tree PASS
  receipt stops declaring its scope · scopeComplete drops the athenaListEnumerated requirement ·
  the roster stops learning from observed appointments · seeding stops pre-filtering (junk
  sanitizes the cache and REVOKES a complete receipt) · the scope stops travelling with the
  receipt · the terminal verdict drops the caveat · an absent roster module gets upgraded to a
  coverage claim · the coverage receipt stops being recorded · the disclosure becomes a GATE
```

**Three arms were wrong first, and all three are recorded in the suites**, because each is the
same trap in a new place:

1. **The b669 circularity, twice.** An arm searched `feat_mls_status_center.js` for
   `"Write-back reported success"`, then for `var okW = resp && !resp.error` — and **failed on the
   fixed tree**, because the comment explaining each removal quotes the thing it removed. A
   haystack containing the record of a change cannot decide whether the change happened. Comments
   are stripped before those assertions now.
2. **An arm that banned vocabulary instead of a claim.** It forbade the phrase *"all providers"* in
   the scope statement — which the statement uses in scare quotes precisely to correct it. It now
   requires the statement to END on the limitation.
3. **A source-shaped arm that passed on its own regression.** Restoring the unfiltered
   `w.sections.map(x => x.section)` left the words `NOT written` and `x.confirmed` elsewhere in
   `summaryLine`, so the arm passed. It now lifts the real `summaryLine` with `vm` and runs it.

**And one fixture trap worth inheriting:** `canonicalProviderName` rejects any provider string
containing a **digit** — correctly, since "Provider 2" is a placeholder, not a clinician. A
fixture of `Provider0 … Provider17` therefore measures *nothing* while looking like eighteen
providers. Use real-shaped names.
