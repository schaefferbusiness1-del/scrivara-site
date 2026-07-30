# Lane claim 012 — the INTEGRATION lane (data flows between surfaces)

Opened 2026-07-30 ~19:30Z, base `0939b4b` (b802). Branch: `claude/app-data-integration-w92awk`.

**Read this before you edit `renderHome`, `PREF_SYNC_KEYS`, or any identity getter.**

## What this lane is

One owner instruction: *"if a provider sets their name in Settings then goes to do an op
note, it should fill in automatically."* Generalised: **a value the app already holds must
never be asked for a second time, and two surfaces describing the same thing must never
disagree.** So this lane is about the wiring between surfaces, not about any one surface.

It is deliberately NOT: UI redesign, perf, or the 39 findings in
`coordination/STANDING_REVIEW_2026-07-30.md` (finding 3 — `_cwLatest` surviving a patient
switch — is adjacent to my #1 below but is a different defect; I am not touching `_cwLatest`).

## Files + functions I am claiming

| file | region | why |
|---|---|---|
| `mls-connect.js` | canonical Easy owner (`VER = '3.7.3'`, from the `__mlsEasyV32` marker): `renderHome`, `homeSig`, and the `ez3ActiveGo` handler ONLY | the banner-patient / hero desync below |
| `ScribeFlow.html` | the identity getter cluster `:7856-7865`, `PREF_SYNC_KEYS` `:8392`, and the settings hydrate/save pair `:8253-8259` / `:8350-8356` | missing facility source of truth; sync allowlist gaps |
| new `tests/*.test.js` | additive only | pins for each of the above |

Everything else in those two files is yours. I will not touch: `feat_mls_opnote_fill.js`
internals, `feat_mls_opnote_room.js`, the Templates subtree, `feat_mls_store_cache.js`,
`feat_save_verify.js`, `feat_athena_actions.js`, any runtime skin, or `background.js`.

If you need `renderHome` mid-lane, say so in `coordination/inbox/` and I will hold and rebase.

## The first defect, because it is a wrong-patient risk and it is new since b802

Owner screenshot, 2026-07-30: the patient banner reads **Adam · 1y · DOB 05/20/2025 · MRN
7833832**, and the one record CTA on the same screen reads **"🎙 Start Recording — John F
Dulin · 7:30 AM · DOB 05/06/1945"**. Owner: *"Adam is selected but there is no way to start
recording him, and he is not connected to the visit screen below."*

Two causes, and the second one is ours from today:

1. `renderHome` (`mls-connect.js:19236`) follows the banner patient **only when the day has
   no rows**. That branch is the b710/b802 `ez3ActiveGo` hero. The moment `dayRows()` is
   non-empty, the hero renders from `timeContext()` / `nextPatient()` — the schedule — and
   the banner patient is not offered anywhere on the screen. The owner's own through-line law
   ("PATIENT TO CALENDAR TO VISIT should all be on top banner patient", quoted at
   `mls-connect.js:19232`) is enforced on the empty day and dropped on every working day.

2. **b802 removed the control that was covering for it.** `setLaneHidden(rb, !live &&
   !rbResumable)` (`mls-connect.js:6864`) hides the `ez3fl` record pill when idle — correctly,
   it was a duplicate offer — but that pill was the ONE control on the screen whose label came
   from `.mlsctx-name`, i.e. the banner patient (`:6862`, `:6889`). With it gone and the hero
   following the schedule, a day with rows now has **zero** record entry points for the
   selected patient. b802 is right that there should be one offer; the offer left standing is
   for the wrong person.

The b802 pill hiding stays. I am fixing the hero, which is the correct owner of the offer.

## The fix, stated so you can object to it

`renderHome`, rows-present branch: resolve the banner patient (`verifiedActivePatient() ||
activePatient()`), then find their row on the selected day using **the app's own equality
rule** — `nameMatch` plus non-conflicting DOB, exactly what `installScheduledVisitBinding`
(`:18850`) and `exactScheduledBindingMatches` (`:18863`) already use. Then:

* banner patient **has** a row today → they are the primary hero, and it binds through
  `lockAndStart(row, {record:true})` so the scheduled Athena binding installs. Using
  `lockAndStartPatient` here would have created an `_pt` ad-hoc visit with `id:null` and
  thrown the appointment id away — that is the "missing appointment ID" report, so the row
  path matters.
* banner patient has **no** row today, but was chosen in this browser session → primary,
  ad-hoc, and the sub-line says so.
* banner patient has no row and was **not** chosen this session (i.e. restored from
  `localStorage` `uns('activePt')`, which persists across days) → the schedule keeps the
  primary and the banner patient gets a clearly-labelled secondary offer.

That last case is the one I want reviewed. `activePt` persists, so on a fresh morning the
banner holds yesterday's last patient; promoting that to the primary record button would be a
wrong-patient regression strictly worse than the bug being fixed. Session-scoping is how I
avoid it. The marker is written where the selection already happens (`setActivePtId`,
`ScribeFlow.html:9636`) into `sessionStorage` under `uns()`, so it is per-account and dies
with the tab session.

Schedule NOW/NEXT are never dropped — when the banner patient owns the primary they demote to
the existing `➡ <name>` switch form (`record:false`), which is the same visual language
`ez3Nxt` already uses when `tc.cur` exists. Any schedule row that IS the banner patient's row
is skipped, so the screen never offers one person twice.

Pins kept green deliberately, not by luck:
`record-verb-names-the-patient-once` (the `id="ez3Now"` line keeps its `esc(`; `id="ez3Rec"`
is untouched), `home-hero-follows-the-banner-patient` (`ez3ActiveGo` stays, and now covers
both day shapes), `right-now-bar-never-duplicates-the-hero` (`feat_mls_calm_shell.js`
untouched).

One correction for the record, since a stale claim in a test comment cost me time:
`tests/record-verb-names-the-patient-once.test.js` justifies the home screen fusing the
patient name with *"the home screen has no bound-patient banner"*. It does now — the owner's
screenshot shows it directly above the stage rail. The assertion is still right, the reason
in the comment is not.

## Next in this lane after that

1. `getFacilityName()` / `getFacilityAddress()` are **called and never defined** —
   `ScribeFlow.html:15643`, `feat_mls_opnote_prep.js:187-188`, defined nowhere but a self-test
   stub at `feat_mls_opnote_prep.js:796`. Every op-note facility field resolves empty forever,
   so the doctor types the facility on every note. Needs a real Settings field, getter, and
   sync key. **This one lands in your op-note surface** — tell me if you would rather own it.
2. `PREF_SYNC_KEYS` gaps: `featIME` is in `FEATURE_DEFAULTS` (`:7792`) and absent from the
   allowlist (`:8392`); `noteModel` likewise. Those settings do not follow the account.
3. `getProviderName` has two live definitions with different semantics —
   `ScribeFlow.html:7857` (returns the stored value) and `mls-connect.js:33741` (returns `""`
   on roster ambiguity, and wins at runtime because the bundle loads later). Callers that run
   before the bundle see different behaviour than callers after. Reporting, not fixing yet.

— integration lane
