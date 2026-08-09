# 017 — the phone menu, the intake summary, and "Scrivara" is now "MLS Scribe" everywhere

Lane: `claude/phone-ph2-fixpack-20260808`, three commits, shipping to `main`.
Supersedes nothing; **extends 016** (the ph2 phone shell) and **renames 014's app**.

**Read this if you touch:** `feat_mls_phone_ui.js`, `app.html`,
`phone-setup.html`, any manifest or native identity file under `mobile/`, or
the Settings phone card in `mls-connect.js`. Everything else is untouched.

---

## 1. THE RENAME IS THE PART THAT CROSSES LANES

Owner, 2026-08-08, having opened `phone-setup.html` on his own iPhone and read
"Put Scrivara on your iPhone" above an MLS logo and the mlsscribe.com address
bar: *"No this should save mlsscribe everywhere fix everywhere what it says the
wrong thing to."*

52 strings across 13 files. **Lane 014's app is now "MLS Scribe"** — its title,
its `apple-mobile-web-app-title`, both `<h1>`s, `app-manifest.json`
`name`/`short_name`, the iOS `CFBundleDisplayName`, the Android `app_name`, the
Capacitor `appName`, `mobile/app.config.json` `displayName`, and the three store
documents. `phone-setup.html` — 014's install guide — is rewritten in the same
name throughout, including the load-bearing "Do this on the … screen, not on
this one" sentence.

Not bare "MLS": the workspace already installs under that
(`manifest.webmanifest` `short_name: "MLS"`), and two icons reading "MLS" on one
Home Screen are indistinguishable. `mobile/app.config.json`'s `_comment` now
records the owner's override instead of the old store rationale.

### ⛔ THREE LOWERCASE NAMES ARE DELIBERATELY UNCHANGED

`tests/one-product-name.test.js` asserts each is still **PRESENT**, not merely
that the old name is absent — a ban-only test would go green if a later sweep
"fixed" these too:

| name | why it must not move |
|---|---|
| `scrivara-backend.onrender.com` | the LIVE API host. An address, not a brand. Renaming it in the client points the whole product at a hostname that does not resolve. |
| `com.scrivara.app` | the bundle id / applicationId. **PERMANENT** once a store build is uploaded — a different id is a different app, a different listing, and no upgrade path for anyone already installed. Decide before the first upload. |
| `scrivara.session.v1`, `scrivara.lastEmail.v1` | the store app's own localStorage keys. Renaming them signs every installed phone out, silently, on one deploy. |

Remaining occurrences anywhere are source **comments** (`ScribeFlow.html`'s
"Teach Scrivara", beside a control already labelled "Teach MLS"). Nothing
renders them, and `ScribeFlow.html` is byte-pinned — leave them.

The gate sweeps the **reviewed publication inventory** (298 shipped + native
files), not a hand-list, so a new file carrying the old name fails on arrival.

---

## 2. `feat_mls_phone_ui.js` → ph2-1.1.0 (this lane owns this file)

Owner: *"the top right 3 lined button doesn't work."* It was
`go('setup')` — a menu glyph that re-selected a tab already in the tab bar, and
from the Setup tab it changed nothing observable. It is a real bottom sheet now.

The menu carries the six things this app could reach from **no** control:
Refresh · Jump to today · Settings · This device (lands on Integrations) ·
Setup and help · Sign out. `body.mls-ph2` hides `#appHeader`, which is where the
desktop keeps Sign out and Settings — so a phone could not sign out of a PHI
workspace, while the Setup screen printed "Go to Settings → Integrations" twice.

**Calls, never reimplements:** `openSettings()`, `logout()`, `loadCalendar()`,
`loadPatientsFromServer()`, `__mlsDaySwitch.setDay()`.
🔑 **`logout()` is called with NO argument.** `logout(true)` is the idle-timeout
path and SKIPS the "N notes on this device have not been backed up" stop.

Also fixed, all executed in tests: a tab press did nothing while the transcript
had focus (the caret guard returned `S.lastSig`, which every forced repaint had
just cleared); `copy-note` toasted success before the clipboard promise settled;
the day arrows were enabled mid-pull; a double-tap started two pulls; `stop`
swallowed the engine's refusal.

### 🚨 A falsy timer id, in three places

`stopCheckinWatch` / `stopTicking` / `startTicking` tested a timer handle for
**truthiness**. A handle of `0` is falsy, so "stop" skipped the clear and
"start" saw a running timer as absent — two watches, both polling, both
re-arming. Browsers rarely hand out 0, which is exactly why it ships. **If your
module holds a timer handle, use `!== null` / `=== null`.**

---

## 3. THE AVATAR INTAKE BRIEF — a second READER, not a second pipeline

⚠️ **Avatar lane, this is the part that touches you.** Owner: *"the patient
enters the room, the avatar starts recording them and asking them questions,
then their convo ends and the doctor should get a notification that the patient
intake convo is done and then give the doctor the important summary on the phone
app we have here."*

`GET /api/avatar/checkins?status=ready` already existed and `app.html` has
consumed it since av-5.7.3. This lane adds a **second reader of that same
endpoint** inside the workspace phone app. **No new interview, no new summary,
no new endpoint, no writes** — nothing in the avatar lane changed, and nothing
here depends on b973's composition work.

Consumed fields: `id, headline, bullets[], summary, askAbout[], flags[],
inProgress, patient_external_id, ready_at, turns, audited` (including
`audited: 'rejected'`, which gets its own wrapping warning line rather than the
truncated meta line). **If the row shape changes, two readers move, not one.**

Behaviour deliberately copied from `app.html` rather than reinvented:
- keyed by `id` **AND** state — the endpoint returns a flagged interview that is
  still running alongside the finished ones, so keyed by id alone the FINISH
  (the event carrying the summary) never announces. app.html shipped that and
  fixed it in review round three;
- the first load after sign-in never buzzes;
- a failed poll says so and does **not** withdraw the brief already on screen;
- **nothing promises a notification that can reach a sleeping phone.** There is
  no APNs/FCM credential and no server holding device tokens. The suite bans
  "we will notify you", "push notification", "even when the app is closed" and
  "in the background". If anyone builds real push, that ban is the first thing
  to revisit — deliberately, not by accident.

Attribution is on the **portal id** via the schedule row, never the name. No id
on either side ⇒ no brief shown at all.

---

## 4. QUICK HISTORY (read-only, three globals)

Reads `window.activePatient()`, `window.patientNotes(id)`,
`window._athenaChartLanded(p)`. **Writes nothing.** ⛔ It does NOT reuse
`_patientQuickHistory()` — that builder is styled for a dark `#13283d` popover
and is invisible on the phone's light card. Same data, phone styling.

It distinguishes *none recorded* / *never read from athenaOne* / *no chart
record bound* in words, in every box — b967's rule, arriving on the phone.

⚠️ Chart fields arrive as **text OR as an array** depending on which importer
wrote them. `String(array).split(/\n|;/)` yields ONE line reading "a,b,c" and a
count of 1, so a four-drug med list printed with no "+N more" and looked
complete. If you read `p.meds` / `p.allergies` / `p.problems` anywhere, handle
both shapes.

---

## 5. ONE SHARED TEST CONTRACT CHANGED

`tests/phone-app-is-its-own-app.test.js` — the idle timer budget went from
**"0 timers"** to **"exactly one, and it must be the 45s check-in watch"**.
That is stricter, not weaker: "0" would also have been satisfied by a module
that stopped ticking a live recording. The hidden case is unchanged and now
genuinely enforced — the watch refuses to **arm** while hidden rather than
arming and checking visibility on fire, because a hidden tab's timers are
frozen, not throttled. **A pocketed phone still holds zero timers.**

---

## Proof

540/540 local suites. Three new suites, each **proven to fail against the
shipped file first**: `phone-menu-and-controls`, `phone-checkin-and-quick-history`,
`one-product-name`. Measured eyes-on in a real browser at 375×812 and 360×740
against a PHI-free fixture: zero horizontal overflow on all three screens, zero
tap targets under 44px, the sheet's last item fully on screen, Escape closes it.

Reversible: `window.__mlsPhoneUI.revert()` hands the screen back to
`__mlsPhoneHome` untouched. The rename is a pure string change with no storage,
route or id consequences.
