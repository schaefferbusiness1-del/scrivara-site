# Post-pull live acceptance runbook (Athena read-only)

Date: 2026-07-14  
Gate: run only after the first managed pull of the selected day has returned an exact 18/18 complete receipt.  
Scope: production app plus the currently enabled unpacked extension. Nothing below may create, change, sign, bill, order, or delete anything in Athena.

## Non-negotiable safety boundary

- Stop immediately and tell the user if Athena is signed out. Do not retry blindly.
- Athena activity in this runbook is navigation/read-only. Day/provider/month imports do update MLS's own appointment/history store; that is expected and is not an Athena write.
- Never click or call Place Athena draft, Send to Athena, Review & Send, Sign, Bill, Orders placement, Save/sign/bill, `__mlsAthenaWriteback`, `__mlsAthenaActions`, `#pushAllEmrBtn`, `#ez3flReview`, `#ez3Send`, or any similarly named write control/API.
- Never generate an op note in this acceptance. Inspect the verified-context payload seam only.
- Use only synthetic, non-PHI sentinel text for voice/recording checks, then discard the unsaved local visit. Do not generate, save, or send it.
- Console/output must contain only booleans, counts, reasons, and enum values. Never print names, DOBs, MRNs, patient IDs, raw visit bodies, transcripts, generated prompts, or Athena page text.
- Start each managed pull from a clean notification state. A pre-existing unrelated manual warning is not evidence about the managed pull and must not be cleared automatically.

## Receipt helper (PHI-free)

Use this only to summarize a returned day/provider result. It deliberately omits patient identity and content.

```js
function safePullReceipt(r) {
  const c = r?.calendarReceipt || {};
  const h = r?.historyReceipt || {};
  const patients = Array.isArray(h.patients) ? h.patients : [];
  return {
    ok: r?.ok === true,
    complete: r?.complete === true,
    reason: r?.reason || null,
    scheduleComplete: r?.scheduleReceipt?.complete === true,
    providerComplete: r?.providerReceipt?.complete === true,
    attempted: c.attempted ?? null,
    accounted: c.accounted ?? null,
    mapped: c.mapped ?? null,
    uniqueSources: c.uniqueSources ?? null,
    uniqueBackend: c.uniqueBackend ?? null,
    mappingComplete: c.mappingComplete === true,
    snapshotPublished: c.snapshotPublished === true,
    created: c.created ?? r?.created ?? null,
    repaired: c.repaired ?? r?.repaired ?? null,
    skipped: c.skipped ?? r?.skipped ?? null,
    failed: c.failed ?? r?.failed ?? null,
    wrongDay: c.wrongDay ?? null,
    invalidDate: c.invalidDate ?? null,
    unresolvedMappings: c.unresolvedMappings ?? null,
    historyRequested: h.requested ?? null,
    historyProcessed: h.processed ?? null,
    historyComplete: h.complete === true,
    exactIdentityVerified: h.exactIdentityVerified === true,
    historyPatients: patients.length,
    everyPatientComplete: patients.every(p =>
      p?.complete === true &&
      p?.identityVerified === true &&
      p?.organizationComplete === true &&
      p?.visitsComplete === true
    ),
    historyRetries: Array.isArray(h.retry) ? h.retry.length : (h.retry?.length ?? 0),
    historyFailures: Array.isArray(h.failures) ? h.failures.length : (h.failures?.length ?? 0)
  };
}
```

## 1. Repeat the exact same day: idempotency and enrichment

Action: use the same explicit Pull this day action/API used for the successful 18/18 run, with history enabled. Do not reload between the first and repeat run.

Public seam: `window.__mlsSI.pull({ date: "YYYY-MM-DD", includeHistory: true, onStatus })`.

Pass:

- `ok === true`, `complete === true`, `reason === "complete"`.
- `scheduleReceipt.complete`, `providerReceipt.complete`, `calendarReceipt.mappingComplete`, and `calendarReceipt.snapshotPublished` are all true.
- `attempted === accounted === mapped === uniqueSources === uniqueBackend === 18`.
- `created === 0`, `repaired === 0`, `skipped === 18`.
- `failed === wrongDay === invalidDate === unresolvedMappings === 0`.
- History is exact and complete: `requested === processed === 18`, `exactIdentityVerified === true`, all patient receipts complete, and zero history retry/failure entries.
- `__mlsSI.authoritativeRowsForDay("YYYY-MM-DD").length === 18`.
- `__mlsSI.authoritativeStatusForDay("YYYY-MM-DD").complete === true`.

Note: do not require the raw backend to contain only 18 rows; old/manual rows may be preserved. The pass condition is that the published authoritative snapshot exposes the exact 18 and the repeat creates no duplicate. A repeat is also allowed to enrich an existing row when Athena supplies genuinely new verified information; if so, `repaired` may be nonzero only with an explicit repaired-row receipt and no duplicate identity.

## 2. Selected-provider day route

DOM contract:

- roster: `#mlsCalRoster`
- provider chips: `.mlsRosChip[data-prov]`
- include-history checkbox: `#mlsCalProviderPullHistoryCheck` (must be checked)
- pull button: `#mlsCalProviderPull`
- status owner: `#mlsCalProviderPullStatus[data-kind]`
- underlying filter/day: `#calProvFilter`, `#calDayPanel`

Before pulling, capture only receipt booleans/counts:

```js
const roster = {
  installed: window.__mlsProviderRoster?.installed === true,
  count: window.__mlsProviderRoster?.list?.().length || 0,
  complete: window.__mlsProviderRoster?.getReceipt?.().complete === true,
  partial: window.__mlsProviderRoster?.getReceipt?.().partial === true
};
const selection = window.__mlsSI?.calendarSelection?.();
({ roster, selectionOk: selection?.ok === true, selectionComplete: selection?.complete === true,
   sourceCalendar: selection?.source === "calendar", rosterReceiptComplete: selection?.providerRosterReceipt?.complete === true });
```

Action: select exactly one provider chip and one day, leave history checked, then call the visible button or `__mlsSI.pullCalendarSelection({ includeHistory: true, onStatus })` once.

Pass:

- Canonical roster receipt is complete and not partial; `__mlsProviderRoster.resolve(...)` resolves the frozen selection.
- The result remains scoped to that exact provider/day; its requested-provider stable key matches the frozen selection. It must never widen to all providers.
- Day result, provider receipt, calendar mapping, and exact history receipt are all complete.
- `attempted/accounted/mapped/uniqueSources/uniqueBackend` equal that provider's authoritative row count (not the all-provider 18 unless that is genuinely their count).
- Retry/failure/unresolved/wrong-day/invalid-date counts are zero.
- Button/status text remains owned by `#mlsCalProviderPull` / `#mlsCalProviderPullStatus`; no unrelated toast claims success or failure.

## 3. All-provider month route (explicit final read-only Athena sweep)

This is intentionally never a startup action. It can perform many Athena reads and MLS imports, so run it once in a deliberately chosen bounded month and only while the user expects the activity.

Public seam:

```js
const monthResult = await window.__mlsSI.pullMonth({
  month: "YYYY-MM",
  provider: "all",
  includeHistory: true,
  onStatus: () => {}
});
({
  ok: monthResult?.ok === true,
  complete: monthResult?.complete === true,
  reason: monthResult?.reason || null,
  allProviders: monthResult?.provider === "all",
  rosterComplete: monthResult?.providerRosterReceipt?.complete === true,
  rosterPartial: monthResult?.providerRosterReceipt?.partial === true,
  days: monthResult?.totals?.days ?? null,
  completeDays: monthResult?.totals?.completeDays ?? null,
  attempted: monthResult?.totals?.scheduleAttempted ?? null,
  accounted: monthResult?.totals?.scheduleAccounted ?? null,
  historiesRequested: monthResult?.totals?.historiesRequested ?? null,
  historiesProcessed: monthResult?.totals?.historiesProcessed ?? null,
  failures: monthResult?.totals?.failures ?? null,
  retryDates: monthResult?.retry?.dates?.length ?? null,
  everyDayComplete: Array.isArray(monthResult?.days) && monthResult.days.every(d =>
    d?.complete === true && d?.receipt?.complete === true &&
    d?.receipt?.providerReceipt?.complete === true
  )
});
```

Pass: complete non-partial roster, `ok/complete` true, `reason === "complete"`, every day complete, `completeDays === days`, accounted equals attempted, histories processed equals requested, and failures/retry dates are zero. Any unattributed row or incomplete provider roster must fail closed, not silently pass. Do not use legacy month/provider pull APIs.

## 4. Six-card patient-history classification

For several patients in the imported day (including one with known history and one with genuinely absent data), switch patient normally and inspect these exact containers:

- Problems: `#profProblems`
- Medications: `#profMeds`
- Allergies: `#profAllergies`
- Summary: `#profSummary`
- Vitals: `#mlsEpVitalsBox`
- History/background: `#mlsEpHistoryBox`

Contract source: the active patient's `athenaProfileCoverage` receipt. For keys `problems`, `meds`, `allergies`, `summary`, `vitals`, `history`:

- receipt is complete and exact-identity-verified;
- its patient binding equals the active patient internally (compare booleans only; never print IDs);
- every card status is exactly `found` or `not_documented`;
- `found` implies `populated === true`; `not_documented` implies `populated === false`;
- invalid list is empty;
- changing patient changes all six cards together and never leaves content from the prior patient;
- revisiting/re-pulling enriches in place and does not duplicate visits or card content.

Blank or generic text without a valid `not_documented` classification is a failure. Never infer "none" from a parse failure.

## 5. Collapsible organized visit timeline

Public seam: `window.__mlsVisitHistoryExt` (`installed`, `rebuild`, `_state`).

DOM:

- root `#mlsVisitHistoryExt`
- main toggle `.mlsxh-collapse`
- content `.mlsxh-content`
- year accordions `details.mlsxh-yeargroup > summary.mlsxh-year`
- visit list `.mlsxh-list`
- count/status `.mlsxh-count`, `.mlsxh-status`

Pass:

1. Root renders for the active patient and count agrees with the usable organized visit model.
2. Main toggle changes `aria-expanded` and `.mlsxh-content.hidden` in opposite directions, then restores both on the second click.
3. Each year is a real `<details>` element and can close/reopen without losing rows or changing the active patient.
4. Switching patients rebuilds the timeline with no prior-patient row leakage.

Do not click Summarize all in this acceptance; it can invoke AI and mutate MLS profile content.

## 6. Verified-history-only op-note payload inspection (no generation)

Use the pure builder first. Keep the returned text in memory and output only the sanitized receipt:

```js
const p = activePatient();
const built = window.__mlsOpNoteHistory._internal.buildHistoryContext(
  p.name,
  { patientId: p.id, dob: p.dob, procedure: "" }
);
const usableCount = window.__mlsVisitModel.usableVisits(p).length;
({
  ok: built?.ok === true,
  reason: built?.reason || null,
  activeBinding: built?.patientId === p.id,
  visitCountMatches: built?.visitCount === usableCount,
  visitCount: built?.visitCount ?? null,
  profileSections: built?.profileSections ?? null,
  snapshotIncluded: built?.snapshotIncluded === true,
  bounded: typeof built?.text === "string" && built.text.length > 100 && built.text.length <= 12000,
  beginMarker: built?.text?.includes("=== MLS VERIFIED EXACT-PATIENT CONTEXT BEGIN ===") === true,
  endMarker: built?.text?.includes("=== MLS VERIFIED EXACT-PATIENT CONTEXT END ===") === true
});
```

Optional injection inspection (still no AI call): construct an in-memory inspection-only op-note prompt from the active patient internally and call `__mlsOpNoteHistory.injectIfOpNote("Draft an OPERATIVE / PROCEDURE NOTE", prompt, opts)`. Never output the returned prompt. Pass only if `lastInjectionReceipt()` reports `included`, `identityVerified`, `phase === "initial"`, the same usable visit count, a nonempty context token, bounded history characters, and `opts.mlsVerifiedHistoryBinding.patientId === p.id` internally.

Never call `_genOpNote`, `opPrepGenerateOne`, `opPrepGenerateAll`, `generateNote`, `aiCallRaw`, or any Athena write/send API. A wrong/missing binding, mixed-patient history, unverified visit, or over-12,000-character payload must fail closed.

## 7. MLS Assistant readiness and one exact safe command

Readiness:

```js
({
  core: window.__mlsAsst?.installed === true,
  bridge: window.__mlsAsstFix?.installed === true,
  sendHandler: typeof window.__mlsAsstFix?._handleSend === "function",
  intentRegistry: typeof window.__mlsAsstFix?.registerIntent === "function",
  fab: !!document.getElementById("mlsAsstFab"),
  panel: !!document.getElementById("mlsAsstPanel"),
  status: window.__mlsAsstFix?._state?.().status || null
});
```

Open the Assistant once and send exactly one command: `are we connected?`

Pass: exactly one user turn and one assistant reply are added, the reply is a connection/readiness answer, status is connected, and no schedule pull, history pull, patient change, or EMR action occurs. If it reports signed out/loading, fail and fix readiness; do not repeat-command spam.

## 8. Dictate is distinct from Copilot Voice

APIs/DOM:

- Dictate: `__mlsDictateAnywhere.installed`, `.supported`, `.isListening()`, `.stop()`; top `#ez3flDictate`; dock `#mlsDaDock` / `#mlsDaChip`.
- Copilot Voice: `__mlsCopilotVoiceV2.installed`, `.isListening()`, `.start()`, `.stop()`; top `#ez3flCopilotVoice`; fixed `#mlsCopVoiceBtn`.

Pass: both top controls exist, their IDs and labels differ, and mic ownership is exclusive. In a disposable non-PHI text field, start Dictate and verify Dictate true/Copilot false, then stop; start Copilot Voice and verify Copilot true/Dictate false, then stop. Do not issue any actionable voice command. A click on Dictate must never open or route through Copilot Voice, and vice versa.

## 9. Recording stop/resume preserves one combined transcript

Top-lane DOM:

- visible recording button `.ez3fl-recbtn`
- visible editable transcript `#ez3flTranscript`
- canonical transcript `#transcript`
- generate button (must not be clicked) `#ez3flGen`
- advanced workspace link `.ez3fl-openws` (not needed)

API: `__mlsRecSegments.startSegment`, `.stopSegment`, `.isArmed`, `._forCurrent()`, `._buildCombined()`.

In a disposable unsaved local visit only:

1. Put synthetic sentinel A into `#ez3flTranscript`, dispatch `input`, and confirm `#transcript` matches.
2. Click `.ez3fl-recbtn`; pass if label becomes Stop, `aria-pressed` is true, and `__mlsRecSegments.isArmed()` is true.
3. Append sentinel B, dispatch input, click Stop. Pass if A+B remain, label becomes Resume, and armed is false.
4. Click Resume, append sentinel C, dispatch input, then Stop again.
5. Pass if A+B+C remain in visible and canonical transcript, two new segments belong to the same current chart, and `_buildCombined()` returns `ok === true`, `used >= 2`, containing all three sentinels internally.
6. Discard the unsaved local test visit/transcript.

Never click Generate, `#ez3flGen`, `#genBtn`, `#rsGoBtn`, Review, Save, or Send.

## 10. No auto-pull on startup

Use a genuinely fresh page load/tab before any pull button is clicked, then wait at least 10 seconds.

Pass:

```js
({
  importerReady: window.__mlsSI?.installed === true,
  noResponse: window.__mlsSI?._lastResp?.() == null,
  noRawSchedule: window.__schedRaw == null,
  notBusy: window.__mlsPullBusyAt == null,
  flowNotRunning: window.__mlsPullFlow?.state?.().phase !== "running",
  pullButtonReady: !!document.getElementById("mlsDsPullBtn") && !document.getElementById("mlsDsPullBtn").disabled
});
```

All booleans must be true and appointment/history counts must remain unchanged. A readiness ping or notification is allowed; any schedule/history import before explicit user action is not.

## 11. Diagnostic support panel is absent by default

On the normal production URL (which must not contain exact query `mlsScheduleDiag=1`):

```js
({
  queryOff: new URL(location.href).searchParams.get("mlsScheduleDiag") !== "1",
  apiAbsent: window.__mlsScheduleDiagSupport === undefined,
  panelAbsent: document.getElementById("mlsScheduleDiagSupport") === null
});
```

All three must be true. The redacted Schedule diagnostic panel is support-only and must never mount by default.

## 12. Calm notification ownership

After each successful managed day/provider/month action, check:

```js
({
  correlatedFailureSurfaces: document.querySelectorAll('[data-mls-athena-pull-failure="1"]').length,
  athenaDoctorToast: document.querySelectorAll('#mlsAthenaDoctorToast').length,
  legacyToasts: document.querySelectorAll('.mlsac-toast').length,
  saveVerifyCards: document.querySelectorAll('.mls-sv-card').length,
  dayStatusOwner: document.querySelectorAll('#mlsDsStatus').length,
  providerStatusOwner: document.querySelectorAll('#mlsCalProviderPullStatus').length
});
```

Pass: all four standalone failure/toast/card counts are zero for the successful managed batch; only the relevant aggregate status owner presents progress/result. A managed `mlssi-*` batch must suppress per-patient popup spam. On genuine failure, there may be one actionable aggregate owner, never repeated contradictory popups. Existing unrelated/manual warnings are outside this batch and must not be silently erased.

## Final acceptance decision

Call the post-pull workflow accepted only when every section above passes on the same production app/extension build, with the exact version recorded separately and no Athena write event observed. Record only the PHI-free receipt fields in this runbook. Any partial roster, missing appointment, incomplete history, identity mismatch, six-card ambiguity, duplicate repeat import, hidden auto-pull, or conflicting notification is a fail-to-fix condition—not a warning to ignore.

Local contract verification on 2026-07-14: 15/15 focused suites passed for explicit startup, authoritative repeat reconciliation, provider day/month routing, six-card history, organized timeline, verified op-note context, Assistant core/readiness, Dictate binding, voice layout, primary recording workflow, notification ownership/lifecycle, and diagnostic gating. This validates the test seams above; it does not replace the live acceptance run.
