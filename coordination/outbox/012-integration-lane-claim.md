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

Everything else in those two files is yours. I will not touch: `feat_mls_opnote_room.js`, the
Templates subtree, `feat_mls_store_cache.js`, `feat_save_verify.js`, `feat_athena_actions.js`,
any runtime skin, or `background.js`.

**AMENDED after the audit — I have taken four named functions inside your op-note surface,
because the owner's instruction lands exactly there and nowhere else.** Named precisely so you
can object to any one of them:

| file | function | what changed |
|---|---|---|
| `feat_mls_opnote_fill.js` | `provProfile` | `facility: ''` → `canonicalSetting('getFacilityName')` |
| `feat_mls_opnote_fill.js` | `apptProvider` | reads `providerName`/`provider_name` too, appended LAST so existing precedence is byte-identical |
| `feat_mls_opnote_fill.js` | `apptFacility` | new, 4 lines |
| `feat_mls_opnote_fill.js` | `knownValue` | facility branch, MRN fallback, credential ownership, `isOtherRole` guard |
| `feat_mls_opnote_prep.js` | the facility line of the ctx builder | one `\|\| savedDefault('facility')` |
| `ScribeFlow.html` | `_opPatientCtx`, `_opNewRow` | provider fallback removed, `mrn` added |

Nothing structural: no DOM, no render path, no `buildFillBox`, no grip touched. The 102
structural dependencies in `coordination/OPNOTE_TEMPLATES_GRIP_INVENTORY.md` are untouched and
`opnote-templates-grips-survive-redesign` is green.

If you need `renderHome` or any of the above mid-lane, say so in `coordination/inbox/` and I
will hold and rebase.

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

## DONE — Settings identity now reaches the op note

`tests/settings-identity-reaches-the-op-note.test.js`, all six changes mutation-verified.

1. **`getFacilityName()` / `getFacilityAddress()` were called in three files and defined in
   none** — only as a stub inside `feat_mls_opnote_prep.js`'s own `selfTest`. Every call site
   wrapped them in `typeof x === 'function'`, which is what kept it silent for the whole life
   of the surface. There was no Settings field to answer them with either. Both now exist,
   with two new fields in Practice & provider, and both sync. Facility falls back to the
   practice name (a practice that operates where it sees patients should not say so twice) but
   a *named* separate site never inherits the clinic ADDRESS — that would print a real address
   for the wrong building.

2. **`provProfile()` hardcoded `facility: ''`.** The facility rule in `knownValue` — which
   matches facility/clinic/location/site/hospital/center/ASC — is guarded on
   `S(prof.facility).trim()`, so it could never fire. A correct rule, shipped, unreachable.
   This is the same class as your b795 runtime-skin finding: two files each correct, nothing
   connecting them.

3. **`apptProvider()` could not read the op-note room's own rows.** It covered
   `provider_raw|provider_key|provider`; `_opNewRow` writes `providerName`. So for every row
   the room built, the appointment's provider was invisible and the answer fell through to
   Settings and then `commonApptProvider()` — on an all-providers day, a colleague's case
   attributed to whoever is signed in.

### Two fabrications found while writing the suite, not by reading

Both are worth your attention as a class, because both wrote a *specific clinical claim* the
app had no basis for, into a note that gets signed:

4. **The account's credential was appended to another clinician's name.** The guard only
   prevented repeating the SAME credential, which says nothing about a different one. An
   appointment provider of `Kelly Carter, PA-C` with account credential `MD` produced
   **`Kelly Carter, PA-C, MD`** — an operative note asserting a physician assistant is a
   physician. Now only the account's own name is decorated with the account's own credential.

5. **The assistant line was filled with the primary surgeon.** `"Assistant surgeon"` contains
   `surgeon`, so the generic provider rule claimed it. The app has no assistant source
   anywhere, so it was attesting that a specific named clinician assisted a case that they may
   not have been in the room for. `isOtherRole` now excludes assistant / assisting / first
   assist / co-surgeon / resident / fellow / scrub / circulator / anesthesiologist /
   anesthetist / CRNA, checked BEFORE `isProv` so no provider synonym leaks through a role
   qualifier. Empty is the honest answer; the Fields box asks.

Also: `dictated by` is in the shipped template vocabulary and was absent from the provider
synonyms, so it was asked for on every note that used it.

6. **`_opPatientCtx` fell back to `getName()`** — `uns('docname')`, the account display name.
   That is exactly what `tests/provider-identity-separation-contract` exists to forbid, on a
   fourth surface it does not cover: with no Settings provider name, or an ambiguous roster
   (the runtime resolver returns `""` there deliberately so the UI asks), the person who filled
   in the signup form became the operating provider.

7. **`PREF_SYNC_KEYS`**: added `featIME` (in `FEATURE_DEFAULTS`, absent from the list — one of
   five toggles silently staying on the old laptop), `noteModel` (a Premium choice that rode
   nowhere), and `opFieldDefaultsUserV1`. That last one matters most: tier 1 is what the app
   OBSERVED, tier 2 is what the doctor INSTRUCTED via "☆ Use every time", and only tier 1
   followed the account. `feat_mls_opnote_fill.js:670` already called `syncPrefsToServer()` on
   every pin, so the push ran and carried nothing — which is what made it invisible.
   `tests/use-every-time-round-trip.test.js` had four assertions authored INVERTED with a note
   saying to flip them on the day the key was added; that flip is in this commit, and its
   printed MEASURED RESULT block no longer reports the defect as open.

8. **`savedDefault('facility_name')` vs `savedDefault('facility')`** — `fieldIdentity()` derives
   the pin key from the token's own label, so a blank reading "Facility" pins under `facility`
   and "Facility Name" under `facility_name`. Only the second was consulted.

## Still open, and NOT mine to decide

- `getLicense` / `getDea` / `getFacilityPhone` are called in `feat_mls_opnote_prep.js:182-189`
  and defined nowhere, same shape as the facility gap. I did not add fields for them: a DEA
  number is a controlled-substance credential and deciding to persist one in
  `localStorage` + an encrypted cloud blob is an owner call, not mine. Nothing warns on them
  today, so they read as `''` harmlessly.
- `getProviderName` has two live definitions with different semantics —
  `ScribeFlow.html:7857` returns the stored value, `mls-connect.js:33741` returns `""` on
  roster ambiguity and WINS at runtime because the bundle loads later. Anything running before
  the bundle sees different behaviour than anything after. Reporting only.
- **`bump-build` corrupts provenance comments, and it is now costing new work.** The bump
  rewrites every isolated occurrence of the CURRENT token across `mls-connect.js` and
  `ScribeFlow.html`, so `b803` landing rewrote 65 comment references that legitimately said
  "b802 did X" into "b803 did X". Every comment written during a build is falsified by that
  build's own bump. `HONEST_STATE_2026-07-28` lists this as measured (`b759` appeared 112×) and
  deliberately unfixed pending an owner decision. Flagging it because the fix is cheap — the
  bump only needs to skip `/* */` and `//` spans — and because citations are how this repo
  reasons.

---

## SHIPPED — b808 and b809, both live on main

Five commits in this repo, two in `scrivara-backend` (both merged to its main).
`npm test` → **450 local regression suites** here, **39** there.

| what | where |
|---|---|
| the visit home always offers the banner patient | `mls-connect.js` renderHome + the four handlers |
| Settings identity reaches the op note | `feat_mls_opnote_fill.js`, `feat_mls_opnote_prep.js`, `ScribeFlow.html` |
| every export carries the practice's identity | `mls-opnote-pro.js`, `mls-procedure-report.js`, `mls-rvu.js`, `ScribeFlow.html` |
| the three patient pages name their practice | `patient-portal.html`, `intake.html`, `appointment.html` |
| the marketing console is not a stale fork | `mls-marketing-console.html` |
| the practice's name reaches patients | backend: `server.js`, `patientPortal.js`, `patientPortalInvites.js`, `reviewRequests.js` |

**The loader tokens are the part worth your attention.** Five of the modules I
changed carry their own fixed `?v=` token rather than `?v=__MLS_AV`, so bumping
`app-version.json` alone would have published this whole lane as files nobody
loads — shipped, green, and invisible. Advanced together with every pin, live and
staging: `onf2130→onf2140`, `opnp170→opnp180`, `lib2→lib3`, `bc1→bc2`. If you
touch any of those five modules, move the token too.

`sw.js`'s `mls-v188` deliberately did NOT move: all three patient pages are in
`NETWORK_ONLY_HTML_PATHS`, so they never come from the SW cache.

### The verification boundary, stated plainly

This container's network policy blocks outbound to `mlsscribe.com` (the proxy
answers 403 to CONNECT), so I could not run the ship skill's step 5/6 live check.
What I *can* evidence: `2912f11` is on main, and its **`pages build and
deployment` run completed with conclusion `success`** at 21:54:30Z
(`actions/runs/30585214243`). What I have NOT done: read the served bytes, or
probe the owner's signed-in tab. Per the skill, that means nobody should be told
this "works live" until someone reloads that tab and checks `window.__MLS_AV`.

### Five findings I did not go looking for

Each was found by a suite while proving something else, and each wrote a specific
clinical or identity claim the app had no basis for:

1. The account's credential appended to **another clinician's** name —
   `Kelly Carter, PA-C` + account cred `MD` → **`Kelly Carter, PA-C, MD`**. An
   operative note asserting a physician assistant is a physician.
2. The **assistant line filled with the primary surgeon** ("Assistant surgeon"
   contains "surgeon"). There is no assistant source in this app at all.
3. The phone line reading **"Dr. \<last token of the login name\>'s office"**
   aloud to a patient — a surname guess plus an invented doctoral title.
4. The review-request snapshot storing an **empty** identity, which
   `patient-review.html` renders as "my doctor at this office" into a review the
   patient posts **publicly**.
5. `provProfile`'s hardcoded `facility: ''`, which made a correct, shipped
   facility rule permanently unreachable.

**2, 3 and 4 are one class**: the app inventing a specific claim where it had no
data, in text a human then signs or publishes. Worth a lane of its own — a sweep
for "what else do we fabricate rather than leave blank?" would likely find more.

### Instrument errors, because there were four and they all cost time

All four were probes that could not detect what they reported:

- `indexOf('});')` truncated a handler mid-body on `{ record: true });`.
- A comment naming the function it explains inverted three separate `indexOf`
  ORDER verdicts (`getName`, `lockAndStartPatient`, `renderPatient`).
- `indexOf('};')` truncated `serverProvider` on `|| {};` — producing a **false
  failure** on correct code, which is the worse direction.
- Cross-realm `deepStrictEqual`: arrays and objects built inside a `vm` realm are
  never deep-equal to ones built outside it, and the mismatch reads as a content
  difference.

Every order check in the new suites now strips comments first and carries a
control proving the strip removed prose and not code. `outbox/011` recorded the
first of these; this is the same trap four more times, so it is probably worth a
shared test helper rather than five independent rediscoveries.

### Still open, deliberately, and none of it is mine to decide

- `getLicense` / `getDea` / `getFacilityPhone` — called in
  `feat_mls_opnote_prep.js:182-189`, defined nowhere. A DEA number is a
  controlled-substance credential; deciding to persist one in `localStorage` plus
  an encrypted cloud blob is an owner call.
- `appMeta()` has no date of procedure, so a normalized header can print
  `Date of Procedure: [not dictated]`. Filling it with today's date would
  fabricate a clinical fact for any note about a past procedure, and nothing in
  that module's inputs carries the encounter date.
- Two live `getProviderName` definitions with different semantics —
  `ScribeFlow.html:7857` returns the stored value, `mls-connect.js:33741` returns
  `""` on roster ambiguity and wins at runtime because the bundle loads later.
- `AuthPilot.html:623` instructs the model to emit `[Practice Name]`,
  `[Provider Name, Credentials]` and `[NPI]` blanks. It is fully standalone with
  its own key and reads zero MLS settings, so wiring it is a real change.
- `mls-outcome-study.js:1088` asks the doctor to retype patient names and dates of
  service that `getPatients()` already holds. Needs a pick-from-charts builder.
- The marketing **listing audit** still takes identity from the client request
  body. Different shape from everything above — not a missing lookup but an absent
  authority.
- `bump-build` falsifies provenance comments (b803 rewrote 65 references that
  correctly said "b802 did X"). Measured and deliberately unfixed per
  `HONEST_STATE_2026-07-28`, but it is now corrupting newly written citations, and
  the fix is small: skip `/* */` and `//` spans.

---

## SELF-AUDIT AFTER SHIPPING — six regressions in my own work, five fixed

The owner asked, plainly: *"don't leave anything worse than what it was
originally, it should all still work."* So I audited this lane against its own
baseline (`0939b4b` here, `7c2ac58` in the backend) asking only one question —
*is any behaviour now worse, for any account state?* Six answers were yes. Every
one is now pinned by an assertion that fails if it returns.

**1. The facility getters were fabricating a site of service. (the worst of them)**
`getFacilityName()` shipped falling back to the practice name. Measured
consequence: `feat_mls_opnote_prep.js`'s attest block prints
`'Facility: ' + (pf.facility || '[[facility_name]]')`, so a surgeon who operates
at a hospital and had not yet filled the new field got their **clinic asserted as
the site of service on a signed operative note** — and the readiness strip's
`add('facility','Facility', !!(apptFac || pf.facility),'warn')` **stopped
firing**, removing the one thing that would have told them. Both attest lines
then read the same string, since it prints `Practice:` too.
This is the same fabrication class the lane exists to remove, introduced by the
lane. The getters now return only what was stored. The appointment's own
department still wins.

**2. `clinicalProviderName` was too strict, and regressed real accounts.**
Refusing `docname` outright looked like the safe reading of the
identity-separation rule. It is not: `suPersistIdentity` writes `uns('docname')`
**unconditionally** and writes `uns('providerName')` only when the typed name does
not contradict a verified roster — so "docname set, providerName empty" is a state
the app *deliberately produces*. For those accounts the prior-auth letter went
from the doctor's name to `[Provider name]`, the procedure note to `[Provider]`,
and the op-note PDF letterhead to the literal `Clinician`, while the field's own
label promises it "appears on signed notes".
The rule is now **the wizard's own rule**: explicit setting first, then the
account name unless a verified roster names other people and not this one. Four
states executed in `settings-identity-reaches-the-op-note` §7b.

**3. Portal sign-in became gated on the practice lookup.**
`checkSession` awaited `r.json()` before `enterApp()` so office() was populated
for the first paint. `api()` resolves to a real fetch Response, so a reply whose
headers arrive but whose **body never finishes streaming** left that promise
unsettled and the patient stranded on the login screen. Cold starts on this host
make that not hypothetical. Entry is back to synchronous on `r.ok`; the body is
read alongside it. Nothing is lost — `loadRecords()` reads the same practice
object and records it before `renderPatient`, which is the paint that uses it.

**4. A button's label could disagree with what it did.**
The demoted NOW/NEXT handlers recomputed `bannerLeads()` at click time while the
label was chosen at render. The poll re-renders only on a signature change, so for
up to one 700ms tick after the active patient changed elsewhere, a button still
reading the record verb would have decided `record:false` and silently opened the
visit without recording. `data-rec` is now emitted by the same ternary that picks
the label, and `recWanted` defaults to recording when the attribute is absent so
no other render path loses its one-tap behaviour.

**5. The reminder cron gained a decrypt per message.**
`practiceLabel` was a plain property read on a row already in hand; routing it
through `practiceProfile` made it a prefs-blob decrypt plus an availability read,
**twice per reminder**, inside a loop. Hoisted to once per practice. The
appointment page's two profile reads are now one. Pinned, including that
`practiceLabel` may not appear inside the per-appointment loop again.

**6. The phone line read a personal name as an office.**
Collapsing `officeName` onto the resolved name meant an unconfigured account
greeted callers with the account holder's own name where it used to say
"Dr. \<surname\>'s office". The old string was invented; a bare personal name reads
as a person answering. `officeName` is now the configured practice name when there
is one, else the generic — no invention either way.

### One trade-off accepted, not fixed

The assistant guard blocks a **combined** label like `"Surgeon/Assistant"`, which
previously filled with the primary surgeon. No shipped template uses such a label
(I enumerated every `[FILL:]` in the repo), it can only appear in a doctor's own
uploaded template, and the failure mode is a blank the Fields box asks for rather
than a wrong name in a signed note. Left as-is deliberately.

### How this was checked, since "tests pass" was not the question

A differential harness runs the **old and new `knownValue` side by side** — both
extracted from their real files, `git show 0939b4b:` for the baseline — over every
`[FILL:]` label shipped anywhere in the repo plus the full identity/role
vocabulary, across three appointment shapes. 44 outputs changed: 12 gained a value
(the facility family, and `dictated by`), 32 dropped either the borrowed
credential or an assistant fabrication. **Zero** changed on the Settings-only
path, which is the assertion that matters most — the account's own name and
credential still resolve exactly as they did.

Also confirmed clean rather than assumed: `getNoteModel()` validates on read and
the backend keeps its own allowlist, so a synced `noteModel` cannot smuggle in a
model; and `syncPrefsToServer`'s budget arithmetic sizes `studio_widgets` against
what is left, so new keys shrink that share rather than 413-ing the blob.

One finding was **refuted** and is worth recording so nobody re-files it: the
letterhead bridge does *not* cost the after-visit summary its title.
`feat_after_visit_summary.js` draws `lh.clinicName || 'After-Visit Summary'` as
the letterhead at 15pt and then its own `'After-Visit Summary'` heading at 13pt on
the next line — the PDF previously said it twice.

---

## CONTINUED — the connections still on the list

The audit was not the finish line. Four items from "still open" above, resolved.

### The doctor's own intake questions never reached a patient

The clearest instance of the whole lane's theme. Settings has *"📋 Patient intake —
your custom questions"*, `PREF_SYNC_KEYS` carries it, and the **in-app kiosk** has
rendered it since it shipped. `intake.html` — the link the doctor actually
**sends** — never received it. `GET /api/intake/public/:token` returned
`{ok:true}` and the page had no section for it.

So a doctor could type questions written specifically for that surface, watch them
save and sync to the account, and the patient would be asked nothing. **The
feature existed on every layer except the one facing the patient.**

Four hops now, and a break in any one of them looks identical to the doctor
(nothing happens), so all four are executed by
`tests/custom-intake-questions-round-trip.test.js`:

| hop | where | state before |
|---|---|---|
| Settings → encrypted prefs blob | — | already worked |
| blob → `GET /api/intake/public/:token` | backend | **missing** |
| response → rendered form | `intake.html` | **missing** |
| answers → the doctor's chart summary | `ScribeFlow.html` `_intakeSummary` | **missing** |

That last hop is the one worth naming: without it the answers arrive, get stored,
and never appear in the chart — the same defect one layer along, where the doctor
asks, the patient answers, and nobody reads it. Answers travel as `{q,a}` pairs so
they are labelled rather than orphaned; unanswered and question-less pairs are
dropped, because an empty answer is not an answer.

Clamped on both sides (20 questions, 300 chars, newlines stripped) because the
token endpoint is unauthenticated, and escaped in both the label and the `data-q`
attribute it rides back on, because a question is practice-authored free text
landing on a page a patient loads. Seven mutations verified, including one that
rendered the label unescaped and one that dropped the chart hop.

### The app had two normalizers for "is this the same clinician"

`clinicalProviderName` was answering the roster question itself with
`suProviderIdentityKey`, while `mls-connect.js`'s runtime resolver answers it with
`providerIdentityKey`. Two lists, two comparisons, two possible answers — the
literal shape of the app disagreeing with itself, introduced by the fix for the
app disagreeing with itself.

It now **delegates**: `getProviderName()` is replaced at runtime by the
roster-aware resolver, which already does stored → unique-roster-match → empty.
All that is left here is the one case that resolver declines to decide — *no
roster at all* — which is a list-length test, not an identity comparison, so no
normalizer can disagree with it. One comparison in the app, not two.

`§7b` now executes **both resolver generations**: the plain stored reader that
exists before the bundle loads (which fails safe — empty, so the UI asks) and the
real roster-aware resolver extracted from `mls-connect.js`, with a control proving
the extracted resolver is genuinely roster-aware in the harness.

### Two patient-facing fallbacks closed, two deliberately left

- **The after-visit summary email** said *"please contact the clinic"* with no
  number, in an email to a patient, while `getClinicPhone()` has always existed.
  It now names the practice and gives the number, and degrades to exactly the
  previous sentence when neither is known.
- **legal-connect** resolves the inviting physician through `practiceDisplayName`,
  so an account with a practice name but no user name stops rendering
  *"Connect to your physician's legal portal"*.

Left alone, with reasons, because changing them would be motion rather than
improvement:

- `patient-review.html`'s `'my doctor'` / `'this office'` are grammatical and
  **non-fabricating** — they name nobody rather than the wrong person — and the
  backend now defaults that identity at send time, so the fallback rarely fires.
  Editing text that lands in a review a patient posts publicly, for no correctness
  gain, is risk without benefit.
- `mls-rvu.js`'s `'This provider'` fires only when the provider is genuinely
  unknown on every source. Honest.
- `getFacilityPhone` stays undefined: it is collected into the prep context at
  `feat_mls_opnote_prep.js:194` and **rendered nowhere** (contrast
  `facilityAddress`, printed at `:298`). A Settings field feeding a value nothing
  displays is dead plumbing on an already-long section.

### AuthPilot: an incomplete finding of my own, corrected

I listed `AuthPilot.html:623` as a gap — it instructs the model to emit
`[Practice Name]` / `[Provider Name, Credentials]` / `[NPI]` blanks while all of
them sit in Settings. **The page is retired.** It is in `RETIRED_HTML`
(`tests/public-publication-boundary.test.js:110`), excluded from the published
site, purged from the service-worker cache on install, and refused on navigation.

Wiring it would connect a surface no user can reach, and would risk the
retirement boundary. I flagged it originally without checking whether the page
ships, which is the same mistake as trusting a source read: the code was right
about what it says and wrong about whether it runs.

— integration lane

---

## Update — b820 (integration lane)

Rebased onto `origin/main` at `15d8a00` before doing anything. The
`tree-contains-everything-published` guard caught that I was one commit behind
and it was right to: the other lane had taken **b819**, so this work is **b820**.
Conflict was a single line (the `feat_mls_dictate_letter.js` loader) and was
resolved by keeping origin/main's line byte-for-byte and applying only my token
change, asserted in the resolution script rather than eyeballed.

### 1. The outcome study stops asking for patients it already has

`mls-outcome-study.js` gained a `📁 Use my charts` button as the FIRST option in
Step 1. Every path into the study asked the doctor to supply names and dates of
service — its own paste placeholder reads `"Name, DOS / Jane Doe, 03/04/2026"` —
while `window.getPatients()` holds both, and this same module already called
`getPatients()` to write results BACK.

- the visit date uses the app's own ladder, `date || note_date || created_at`,
  most-recent-visit-wins, rather than a fresh guess
- rows are produced in the exact shape the paste box emits and handed to the
  SAME `ingestRows()`, so the study, mapper and aggregation are untouched
- patients with no date of service are left out **and counted**, and the count
  reaches the doctor. "No patients" and "patients but no dates" read differently.

Loader token `20260730lib3` → `20260731lib4`.

### 2. Five clinical artifacts stopped signing with the LOGIN name

This is the same separation rule as b810 (`clinicalProviderName`), four surfaces
further out. Each of these resolved provider identity itself and each ended at
`getName()` — the account/login name:

| module | what it stamped |
| --- | --- |
| `feat_mls_dictate_letter.js` | letterhead, signature block (which **appends the practice's credentials and NPI** to whatever name it is handed), fax cover sheet `FROM:` |
| `feat_fullhistory_pdf.js` | the full-history PDF header — read `getName()` and **nothing else**, so the configured provider identity never reached this export at all |
| `feat_mls_opnote_prep.js` | the op note's provider blank, credential appended |
| `feat_mls_writeflow.js` | the **rendering provider on an EHR write context** — the one place a wrong name does not merely misprint |
| `feat_mls_legalpack.js` | `"Prepared by:"` on a medical-legal narrative — **but see below** |

On a solo login the account name and the clinician are the same person, so
nothing looked wrong. On a staff or shared login they are different people and
every one of these went out attributing one person's work to another, over the
practice's real credentials.

All five now defer to `clinicalProviderName`, and where that resolver is absent
they stop at `getProviderName` rather than reaching for the account name — a
blank the physician completes, never somebody else's name over these credentials.
The wizard's own resting state (solo account, `docname` set, `providerName`
unset) is preserved: that account still gets its name, because the shared
resolver's account-name fallback is gated on there being no verified roster.

**`feat_mls_legalpack.js` is dormant, and is pinned as dormant.** `sw.js`
precaches it and nothing executes it — no script tag, no dynamic loader. The
repo's reachability walker calls it reachable only because it counts the
service-worker precache list. Its fix is therefore inert, and the test asserts
that fact so that wiring it up later fails loudly and asks for a loader token.

### Two instrument errors found by mutation, both recorded

1. The omission-report assertion in the study test grepped for `built.noDate` —
   which **also appears inside the branch it guards**, so `if (false) {...}`
   matched just as well. It survived the mutation. Replaced by executing the
   click handler and reading what lands in `#ocParseMsg`.
2. The identity test first executed the new `clinicalProvider()` *helper*, and
   **survived** a revert of `readLetterhead()`'s field to `g('getName')` — the
   helper sat there correct and uncalled. Now every module entry executes the
   ARTIFACT PRODUCER (`readLetterhead().providerName`,
   `providerIdentityBlock()`, the file's own `pick(...)` argument list lifted
   from source, `apptProvider({})`).

A third: a `±400`-char window around `indexOf(filename)` claimed to prove the
build-tied loaders bust their cache and survived stripping `__MLS_AV` off the
real loader, because it measured a different occurrence. Now line-anchored.

27 mutations applied across both suites; every one caught with the intended
assertion, and the clean tree re-verified after each.

### Notes for the other lane

- `bump-build.js` rewrote **67 `b819` provenance comments** to `b820`, including
  yours (`/* b819: deferred past first paint ... */` → `b820`). Mine got the same
  treatment from your bump (`b818` → `b819`). This is the known boundary-anchored
  global-replace behaviour, still an owner decision, still recorded rather than
  worked around.
- `send-portal-invite.html` is an **orphan page**: nothing in the app links to
  it. Its chart picker already fills every field, so the friction I went looking
  for is not there; the live invite path is `feat_mls_send_portal_invite.js`,
  which already reads the active patient and their email on file. No change made.
- The page also carries a dangling comment, `// deep link ?id=<chart id> → load
  that chart automatically`, with **no implementation** — no `URLSearchParams`,
  no `location.search` anywhere in the file. Left alone: the page is unreachable,
  so implementing it would connect nothing.

— integration lane

---

## Update — b821 (integration lane), and a deliberate REVERT

### The owner drew two boundaries mid-flight

> "Don't touch any of the pull stuff or extension stuff"

Everything below either respects that or was **backed out before it ever reached
`main`**. Recording the backed-out work here in full, because the next lane needs
to know these defects are still live and were not missed.

### BACKED OUT, never pushed — the provider-label unification

Four modules each guessed a family name out of a provider string, with three
different algorithms. Proved by executing all three:

| provider name | picker (longest token) | scope (last token) | narration (comma-strip) |
| --- | --- | --- | --- |
| `Schaeffer, Michael` | Dr. Schaeffer | **Dr. Michael** | **Dr. Michael** |
| `Christopher Ng` | **Dr. Christopher** | Dr. Ng | Dr. Ng |
| `SMITH, JOHN A` | Dr. Smith | **Dr. John** | **Dr. A** |
| `Jane Doe, PA-C` | **Dr. Jane** | Dr. Doe | **Dr. PA-C** |
| `O'Brien, Katherine` | **Dr. Katherine** | **Dr. Katherine** | **Dr. Katherine** |

`Dr. A` is a middle initial. `Dr. PA-C` is a credential. Addressing a physician
assistant as "Dr." asserts a licence they do not hold. athenaOne returns names in
`LAST, FIRST`, so the two last-token modules were wrong on their most common real
input, not on an edge case. `feat_athena_narration.js:220` carried a comment
claiming the comma form was "handled by comma-strip above" — stripping a comma
does not reorder a name, so it never was.

**Still live. Not fixed.** The fix (one owner in the shell, all four deferring to
it, 10 mutations verified) was reverted because all four consumers are pull
surfaces.

### BACKED OUT, never pushed — the pull note that said the opposite of the truth

`feat_mls_centerpiece.js` printed, in THREE places (under "Pull today's patients",
under "Pull this week's patients", and in the live progress line during the pull):

> "Pulls all providers for now (the per-doctor filter needs the next MLS Assist
> update)."

**In production that is false.** `feat_mls_schedpull_fix.js` ships; its
`chooseTarget()` resolves the doctor through `__mlsAthenaProviderScope` and
`scopeRows()` then keeps only that doctor's rows. A doctor who set their provider
name in Settings is told they are getting the whole schedule while the pull is
filtering to them alone — in the direction where a short day reads as the real day.

Root cause of the stale note: the only code that ever corrected it lives in
`feat_athena_provider_picker.js` ("gently update the centerpiece's hardcoded
note"), and that module is loaded by **`mls-connect.staging.js` and not by
production**. Same root cause disables `feat_mls_protocol.js`'s entire block headed
"PROVIDER-NAME-EVERYWHERE (one source of truth, live-updated)" — it opens with
`if (!window.__mlsProviderPicker) return;`, and that global is defined only by the
staging-only picker. So the caption that tells a doctor to "Set your provider name
in Settings" is never synchronised on the live site, even for a doctor who has.

**All still live. Not fixed.**

Also found and NOT fixed: `feat_athena_provider_scope.js detectProvider()` reads
`unsGet('docname')` — the raw login name, ungated — as its second rung, and that
value decides **which rows a schedule pull keeps**. On a staff or shared login it
scopes a clinician's day by the front-desk person's name.

### REVERTED after publication — the b820 write-context change

`feat_mls_writeflow.js` was returned to its exact pre-b820 ladder
(`getProviderName()` then `getName()`). It builds the Athena write context the MLS
Assist extension consumes, which puts it inside the extension boundary the owner
drew.

**What that leaves standing, as a decision and not an oversight:** on an account
with a verified roster and no `providerName` configured, `apptProvider()` falls
back to the LOGIN/account name and that becomes the **rendering provider on an EHR
write context**. `tests/clinical-artifacts-never-sign-with-the-account-name.test.js`
documents the exclusion in place of the coverage rather than quietly dropping it.

The shell's `providerDisplayLabel` was removed too: its only consumers were the
four pull modules, and shipping an unused formatter is just confusion.

### SHIPPED at b821 — neither pull nor extension

1. **`docspec` joins `PREF_SYNC_KEYS`** (both `ScribeFlow.html` and
   `ScribeFlow-staging.html`, for the staging parity contract). The SPECIALTY the
   doctor sets in Settings feeds the letterhead, the full-history PDF header and
   the op-note prep context, and it rode nowhere — set on the desktop, blank on the
   laptop, and never known to the server at all. Same class as `facilityName`,
   `featIME` and `noteModel`.

2. **The marketing listing audit stops trusting the request body** (backend). The
   tell was one line: `const ownerId = owner(req);` computed and never used. All
   three identity facts that reach the model — practice name, city, specialty — came
   from the client, and that model writes the description **published on the
   practice's Google listing**.
   - name: the server's, but only when `name_source === 'preference'` (a name the
     doctor CHOSE). A derived `"<provider> Practice"` is refused — publishing an
     invented practice name as fact is worse than using what the client read off
     the live listing.
   - specialty: new `practiceSpecialty(pid)` — Settings `docspec` first, then the
     `users.specialty` signup column. This is what surfaced gap 1.
   - city: **deliberately still the client's.** It is read off the live listing;
     the server stores a street address and no city field, and parsing one out is
     a guess this endpoint has no business making. Pinned, so nobody "finishes the
     job" later by guessing.

   Proved against a real running server with a real encrypted prefs blob across
   three identity states plus a positive control. 7 mutations, all caught.

### Instrument errors found by mutation this round

- A grep for `built.noDate` could not tell a live omission report from a disabled
  one, because the counter also sits INSIDE the branch it guards. Survived.
- The identity test executed the new `clinicalProvider()` HELPER and survived a
  revert of the field that CALLS it. Now every entry runs the artifact producer.
- A ±400-char window around `indexOf(filename)` claimed to prove two loaders bust
  their cache and survived stripping `__MLS_AV` off the real loader — it measured a
  different occurrence. Now line-anchored.
- An assertion that the stale pull note was gone matched my own comment quoting it.
  Fixed by asserting on comment-stripped source WITH a control proving the strip
  removed prose and not code.
- One "caught" mutation was a `ReferenceError`, not an assertion — a bypass that
  crashes proves nothing. Re-run self-contained.

— integration lane

---

## Update — b822 (integration lane)

### Every op-note PDF was filed under today

`mls-opnote-pro.js` named its file:

```js
'OpNote_' + slug(meta.patient) + '_' + dateForFile(meta.dop) + '.pdf'
```

`appMeta()` returns `{ patient, dob, mrn, provider, spec }` — **it never sets
`dop`**. The only source of a procedure date in that file is the dictated header
(`H.dop`), which `normalize()` reads and `appMeta()` does not. So `meta.dop` was
permanently `undefined`, `dateForFile` fell through to `new Date()`, and a note
written up two days after the case was filed as though the case happened today.

And the answer was already being handed in and discarded — the same shape as the
marketing listing audit's unused `ownerId`:

```js
feat_opnote_history_pdf.js:57   if (n && n.created) opts.date = new Date(n.created);
mls-opnote-pro.js exportPdf     if (opts.patient) meta.patient = opts.patient;
                                /* opts.date read nowhere */
```

The ladder, most authoritative first: the **dictated** Date of Procedure (the
doctor's own statement of when the case happened) → the note record's date, which
the caller already supplies → today, unchanged, when there is genuinely nothing.

### The half that was deliberately NOT changed

The note **body** is untouched. `Date of Procedure: [not dictated]` stays
`[not dictated]`.

A note's creation date is not a procedure date, and printing one as the other on a
signed operative note is a fabrication — the same class as appending one
clinician's credentials to another's name. A filename is a filing aid and may
carry the best available date; a clinical attestation may not. The test asserts
the body did **not** move, and asserts `appMeta()` still supplies no `dop`, because
that is the part that would be harmful if it changed.

Shared library loader token `20260731lib4` → `20260731lib5` (3 assets).

### Two instrument findings

1. The test's `filename()` helper **re-composed the three rungs itself**, and
   survived a mutation that reversed the product's precedence — while the comment
   above it claimed it could not. Now the date expression is LIFTED from source and
   evaluated, with a control asserting the lifted text mentions all three rungs.
2. A second precedence mutation (`meta.dop` promoted above the dictated date) also
   survived, because no case set both at once. Added one that does.

### One mutation is uncatchable, and that is recorded rather than hidden

Removing the explicit `v === NOT_DICTATED` guard from `dictatedDop()` changes no
behaviour: `new Date('[not dictated]')` is Invalid Date and the `isNaN` check below
it already returns `''`. The guard is defence-in-depth, not the deciding check, so
no test can catch its removal. Stating that beats claiming a clean sweep.

— integration lane

---

## Update — b823 (integration lane)

### The patient was told to call an office the handout could not name

`feat_after_visit_summary.js` ends every patient handout with, verbatim from its
own system prompt:

> "End with one short reassuring line telling the patient to contact the clinic
> with any questions."

And `buildSource()` — the file's own "EXACT, factual source packet handed to the
model" — carried the patient's first name, visit date, chief complaint, problem
list, medications, allergies and the full note. It carried **no practice name and
no phone number**. The patient went home with a document telling them to ring an
office it never named, on a number it never gave, while `getPracticeName()` and
`getClinicPhone()` sat in Settings and this module's own PDF path already read the
shared `MLS_OPNOTE_LETTERHEAD` built from both.

### Two precautions, because this is an LLM prompt and not a template

1. **Labelled NON-CLINICAL and placed OUTSIDE the verbatim clinical block.** This
   module's whole premise is that the note is the only source of findings. An
   administrative fact drifting into "What we found" is exactly the fabrication it
   exists to prevent. The test asserts both facts appear before the
   `FULL VISIT NOTE` marker and carry the non-clinical label.
2. **A missing fact says `NOT CONFIGURED` in words.** A blank field is something a
   model will helpfully fill in; a stated absence is not. The prompt additionally
   forbids inventing, guessing **or reformatting** a number — reformatting matters
   as much as inventing, because a model that "tidies" a number can change a digit.

Seven states executed (absent getters, empty strings, whitespace, one-of-two set,
throwing getters); none leaks `undefined` into the prompt and none throws, because
this runs on a click and an exception is a dead Patient-summary button.

### Instrument findings

- The prompt assertion **read SYS_PROMPT's SOURCE** and reported "the prompt does
  not forbid reformatting" about a prompt that forbids exactly that — one array
  element later. `SYS_PROMPT` is an array `.join('\n')`-ed at runtime, so a single
  instruction can span two elements. Now the array is EVALUATED and the assertions
  run against the joined string the model actually receives, with a control on its
  type and length.
- An unguarded-getter mutation crashed the suite with a bare `TypeError` instead of
  asserting. The loop now names it: "building the source packet THREW … a dead
  Patient-summary button."

9 mutations, all caught, including moving the two facts inside the clinical block
and replacing `NOT CONFIGURED` with a blank.

### Sweep result, for the record

The generic-fallback class is now **exhausted in production**. Remaining hits are
all legitimate last resorts or out of scope: `appointment.html`'s
`|| 'your care team'` (the backend supplies `practice` via `practiceDisplayName`;
this fires only when the server sends nothing), `mls-opnote-pro.js`'s
`|| 'Clinician'` (fires only when no identity exists at all),
`feat_mls_calendar_polish.js`'s `|| 'this provider'` (names nobody rather than the
wrong person, and is pull-adjacent), and `patient-review.html`'s `|| 'this office'`
(same reasoning). Every `||'Clinician'` hit in `ScribeFlow-staging.html` /
`ScribeFlow_test.html` is on the **not-published** list in
`tests/public-publication-boundary.test.js`.

Every `mlsPrompt` / `window.prompt` call site outside the pull path was also
checked: they ask for note CONTENT (assessment text, plan text, find/replace), not
for facts the app already holds.

— integration lane

---

## Update — b824, and the audit backlog

Four parallel audits with distinct lenses (Settings dead-ends, chart facts left
blank, server-vs-client duplicated asks, one fact computed two ways). Everything
below I re-verified myself by reading the code before acting or recording it.

### SHIPPED at b824

**1. A patient's AGE was computed two ways, and the wrong one gated cohort
inclusion.**

Seven surfaces adjust for the birthday (context bar, the op note's
"N-year-old", the FHIR R4 export, snapshot, Simple view, the age chip,
op-note fill). The Study Groups builder and its cohort-union satellite did
`new Date().getFullYear() - birthYear` — no birthday adjustment — so every
patient born later in the calendar year read **one year older**. On 31 July that
is roughly everyone born August–December.

It was not only a display error. That same `ageOf()` gates the **cohort inclusion
filter**, so a **17-year-old** whose birthday falls later in the year reported 18,
was silently enrolled into an "18 and over" cohort, and was written into the
de-identified CSV. The mirror error drops eligible patients from an upper bound.

Both now defer to `window.ageFromDob` — birthday-adjusted and already hardened by
`__mlsAgeDobFix` for the DOB shapes this store holds. **The year-only fallback is
kept deliberately**: a de-identified record may carry a birth year and no birthday,
and year subtraction is then the only age obtainable. It now fires only when the
canonical resolver cannot answer. Tested against a FIXED clock so the suite cannot
pass or fail because of the day it runs on; 4 mutations caught, including
"year path first".

**2. A correction to my own b822.** The op-note date fix was **incomplete**, and I
said more than was true in that commit. `feat_opnote_history_pdf.js` computes
`opts.date` from the note record and calls `window.__mlsOpNotePdf`, which rebuilt
`{ patient: patient }` from scratch — so the date reached `exportPdf` only via the
fallback branch that fires when `__mlsOpNotePdf` is *absent*, i.e. never. Rung 1
(the dictated Date of Procedure) did work, so the fix was incomplete rather than
inert. `__mlsOpNotePdf` now takes a third `opts` parameter and forwards the date;
the four existing two-argument callers are unaffected and that is asserted. 3
mutations caught.

### VERIFIED AND RECORDED, not yet fixed — ranked for whoever takes them next

I read each of these myself. They are real; I ran out of build cycles, not
certainty.

1. **`booking.html:184` publishes an INVENTED practice name to patients.**
   `GET /api/schedule/public/:token` returns `practiceProfile()` raw, and `name`
   is `"<login name> Practice"` when nothing is configured (`name_source: 'none'`).
   No published page checks `name_source` — zero occurrences outside `tests/`.
   Two sibling surfaces already guard it correctly and are the model:
   `server.js:2226` (appointment feed) and `_vPractice` (`server.js:4220`).
   Same root synthesizes `google_business_url` from that invented name, so the
   "Find us on Google" button always renders and searches for a practice that does
   not exist.

2. **Eight clinical/outbound documents still sign with the device-local login
   name.** `getName()` is `uns('docname')`, which is NOT in `PREF_SYNC_KEYS` — a
   per-device signup value. Sites: `signNote()` (`:21214`, the electronic-signature
   attestation saved into the chart), `buildPrintHTML` (`:21990`), `ordersAsText`
   (`:22767`), `buildOrdersPrintHTML` (`:22865`), **`buildPriorAuthPrintHTML`
   (`:23188`, goes to the payer)**, `printProcNote` (`:24601`), `printExtra`
   (`:25521`), `printCustomWidget` (`:30479`). The sharpest pair: the prior-auth
   letter BODY resolves correctly via `clinicalProviderName()` (`:23086`) while the
   LETTERHEAD of that same letter uses `getName()`. Four builders also hardcode
   `MLS / Physical Medicine & Rehabilitation` where `getPracticeName()` is in
   scope (`:22908`, `:23209`, `:24621`, `:25265`).

3. **The prior-auth letter never learns the payer or member ID**, though
   `p.insurance = {payer, planName, memberId}` is stored (`:15373-15377`) and the
   Superbill and Good Faith Estimate already print it (`:25388`, `:25470`). A payer
   cannot process a PA addressed to `[Insurance Plan]` with no member ID.

4. **`printExtra()` omits DOB and MRN on 12+ printed documents** (`:25518-25532`),
   while sibling builders `buildOrdersPrintHTML` (`:22864`) and
   `buildPriorAuthPrintHTML` (`:23187`) already print exactly that triple from
   `activePatient()`. Same asymmetry between `ordersAsText()` (name only) and the
   printed orders sheet.

5. **The printed handout says "Call the office"** and names neither practice nor
   number (`:25269`) — the same defect b823 fixed in the after-visit summary, on a
   different surface. My b823 test reads only `feat_after_visit_summary.js`, so it
   does not cover this one.

6. **`googleBusinessUrl` is a Settings field with no getter that nothing reads.**
   Its one consumer (`mls-connect.js:35352`) sits below a `return;` in a retired
   IIFE. The doctor pastes their Google link, sees "Settings saved", and it appears
   nowhere. `tests/portal-staff-booking-contract.test.js:22` asserts only that the
   string appears in `PREF_SYNC_KEYS`, which gives false comfort.

7. **Three preference keys promise account scope and deliver device scope**:
   `pullVisitBodies` (its own label says "every pull on this account, wherever you
   start it"), `opNoteTemplateMode` (the doctor's explicit instruction about how
   their validated templates must be honoured), `ez3PortalAskOff`, `qolGroupProc`,
   `navfeat_orders`. `navLayout`/`qolPtLayout` are a judgement call — plausibly
   per-device.

8. **`clinicLogo`**: the field's own hint promises "printed/PDF letterhead", and no
   jsPDF path draws it — only browser print does. The white-label half fails too
   (`mls-opnote-pro.js:611` prints "Generated with MLS" regardless of Premium).

9. **`getFacilityPhone` is called and does not exist** (`feat_mls_opnote_prep.js:200`)
   — no getter, no field, so `ctx.facilityPhone` is permanently `''`. And
   `uns('ez3AutoGenerate')` is read as an opt-out (`mls-connect.js:19875`) that
   nothing ever writes and no control can reach.

10. **`POST /api/reviews/request` takes review destinations from the request body**
    (`reviewRequests.js:242`) while the engine 50 lines below reads them from the
    server (`:293`). `marketing` is already in scope. Caveat: no published caller
    reaches this route today.

11. **`POST /api/frontdesk/:token`** tells patients the specialty from
    `users.specialty` rather than `practiceSpecialty(pid)`, which prefers the
    `docspec` correction the doctor made in Settings. `server.js` defines
    `practiceSpecialty` and never calls it.

### PROVEN UNSAFE TO AUTO-FILL — do not "finish" these

From the deterministic procedure-note builder (`ScribeFlow.html:24540-24577`):
pre-procedure pain level (last month's score is not today's), "allergies and
anticoagulation reviewed" (auto-asserting *reviewed* fabricates a clinical act —
though PRINTING `Allergies on file: <p.allergies>` beside it is safe), laterality,
indication from the problem list (the op-note room already classifies that as
*suggested*, not *known*), steroid dose, follow-up interval, and signature date.

Also **UNSAFE as currently structured**: the op-note PDF's `DOB: [not dictated]` /
`MRN: [not dictated]`. `appMeta()` reads `activePatient()`, and
`renderHistory()` lists every patient's notes when no chart is active — so
exporting a historical op note from the all-patients list would put whatever chart
happens to be open over another patient's note. Filling those is only safe if
resolved from the note's own `patientId`. Do not shortcut it.

### One latent, not a current defect
`dobConflict()` (`feat_mls_writeback_safety.js:89`) disagrees with `dobsMatch()`
(`feat_athena_autopull.js:88`) on unpadded DOBs — `"6-17-1965"` vs `"06/17/1965"`
gives a false `DOB_MISMATCH` hard block — but the only live caller passes
`chartDob: null`, so the branch is unreachable today.

— integration lane

---

## Update — b825

Cleared items 2 and 3 from the b824 backlog. Eight surfaces read `getName()` —
`uns('docname')`, the device-local signup name that is **not in `PREF_SYNC_KEYS`**
and that the server never receives — and four letterheads hardcoded the vendor's
identity onto documents the practice hands out.

### The two that are not cosmetic

**`signNote()`** built `"Electronically signed by <login name> on <date>"`, and
`saveCurrentNote()` writes that string **into the chart**. On a shared or
front-desk login it attested that whoever was signed in on that browser signed a
clinical note. That is a false attestation in a medical record.

**`buildPriorAuthPrintHTML()`** letterheaded a letter **sent to a payer** with the
login name — while the body of that same letter, two hundred lines earlier, already
resolved the provider correctly through `clinicalProviderName()`. One page
contradicting itself about who rendered the service.

The other six: `ordersAsText()` (pasted into a pharmacy/imaging portal),
`buildOrdersPrintHTML()`, `buildPrintHTML()`, `printProcNote()`, `printExtra()`
(the header shared by twelve generated documents), and `printCustomWidget()` —
where the server-sourced `bkUser.name` rung deliberately stays FIRST, because a
server identity outranks a local one.

### What was deliberately NOT changed

The `'Clinician'` fallback stays, and this is not an endorsement of it. When the
shared resolver declines, the app genuinely cannot identify the clinician, and
**whether an unidentifiable signer should be permitted to sign at all is an owner
decision**. What b825 fixes is a *different real person's* name appearing — the
part that is provably wrong. The test says so rather than implying the signature
is now fully sound.

The solo-account path is asserted intact: an account the setup wizard leaves with
`docname` and no `providerName`, and no roster to contradict it, still signs with
its own name. Blanking that would have regressed every solo user.

### The letterheads

Three printed `MLS / Physical Medicine & Rehabilitation`; a **patient handout**
printed the vendor's specialty. All four now read `getPracticeName()` / `getSpec()`,
which were already in scope — `buildPrintHTML()` has resolved its letterhead this
way since the b805 export fix, so this is the rest of the file catching up to a
pattern already present. Each keeps a last-resort literal so a wholly unconfigured
account still renders a letterhead instead of an empty box; a mutation removing
that literal is caught.

8 mutations, all caught, including an ungated `clinicalProviderName()||getName()`
fallback on the signature and the removal of the last-resort literal. All 460 site
suites pass.

### Backlog now standing at nine

Items 1 and 4–11 from the b824 list remain, unchanged and still verified. Ranked
first: `booking.html` publishing an invented `"<login name> Practice"` to patients
(no published page checks `name_source`, though `server.js:2226` and `_vPractice`
both model the guard); the prior-auth letter never learning the payer or member ID
though `p.insurance` holds them and the Superbill already prints them; and
`printExtra()` omitting DOB and MRN on twelve documents whose sibling builders
already print that exact triple.

— integration lane
