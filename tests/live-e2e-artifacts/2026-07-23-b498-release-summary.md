# b498 release summary — portal / check-in / booking / op-note completion + Copilot Voice fix

Date: 2026-07-23 · Lane: QA session (shared clone) · Backend commit: scrivara-backend 52ce634 (owner Render manual deploy pending)

## Op-note workflow (oni-2.9.0)
- **Fixed the owner-screenshotted 9/10 failure** ("Draft stopped … omitted requested clinical facts (levels, levelCount)"): `procedureEvidence` recognized only a narrow set of section headings, so notes that stated levels under "LEVELS TREATED:", "Laterality and levels:", slash notation ("L4/5"), or only in prose were judged as having *no* levels and failed the consistency check.
- Broadened heading evidence, added slash-range parsing, and a full-note containment fallback (`levelsVia='full-note'`): if every requested level appears anywhere in the note, levels/levelCount errors are dropped. Genuine mismatches (wrong levels, total omission) still fail closed, now with actionable messages ("requested: L4, L5; found none in the procedure section").
- 5 new scenarios in opnote-clinical-consistency-runtime; all 6 op-note suites green.

## Check-in screen/editor (ck-1.1.0, ScribeFlow.html)
- Board refresh failure now shows a visible stale-data banner with a Refresh button instead of silently showing old rows; cleared on the next good load.
- Status buttons (checked-in/completed/cancelled) lock while in flight, surface expired-token errors, and resync the board after any failure.
- Add-from-board and both calendar creates send `dedupe:true`; a deduped response says "already exists — no duplicate was added."
- Cancel only reports success on a 2xx; failures say the appointment is still active.
- Waiting-room bar keeps last-good data through transient fetch failures instead of blanking.
- Intake attach is re-attach-guarded (retries resolve instead of double-merging); dismiss/attach failures toast honestly; kiosk submit save errors are shown to the patient ("tell the front desk") with the form preserved.

## Booking (backend + public pages)
- **Double-book race closed**: slot-open/taken check + INSERT now run in one better-sqlite3 transaction; the loser gets 409 "That time was just booked."
- Confirm of a cancelled appointment → 409 honest message; cancel is idempotent (no repeat office emails on double-tap/retry).
- booking.html now shows the server's actual reason (and refreshes slots on a slot-conflict) instead of a generic failure line.
- appointment.html: native `confirm()` replaced with a non-blocking two-tap cancel + in-flight lock.
- New backend contract suite `public-booking-lifecycle.test.js` (transaction shape, idempotency ordering, DOB persistence) registered in npm test — 34 suites green.

## Patient portal
- Invited accounts now persist the DOB verification factor (was always null → DOB check could never pass); invite sender falls back to the chart's decrypted DOB.
- App-side invite sender refuses charts with no stable patient id (pre-flight guard with clear message) instead of sending a broken invite.
- Documented limitations (not fixed, degrade honestly): `/auth/claim` orphan page 404s cleanly; duplicate unwired sender files left in place; orphan `/admin/invite` route left.

## MLS Copilot Voice (cv2-1.2.0)
- **Fixed the "says it started recording but nothing happens" defect**: deterministic commands (open/record/stop/generate/navigate/chains) now run locally and never enter the assistant chat, so the panel no longer pops open on every spoken command and the Copilot LLM can no longer *claim* "started recording" without acting.
- Record/start-visit claims are now verified: the success line only speaks after capture is actually running; if the consent gate opened instead, voice says to confirm consent on screen; otherwise it admits recording did not start.
- Loader cv2-1.2.0 / token 20260723cv2120; readiness suite extended (local-first + honest-verification scenarios).

## Verification
- Backend: 34/34 suites PASS (including the new booking-lifecycle contract).
- Site pre-bump: full regression gate 272/272 PASS; offline E2E 17/17 steps PASS.
- Site post-bump (b498/mls-v85): gate + E2E re-run green on the exact shipping bytes.
- Coordination: b498 claimed in the shared-lane file; xtab pull stamp probed on the
  doctor's three mlsscribe tabs before push (stamp ~16 min stale, __mlsPullBusyAt
  0/absent everywhere — no pull in flight; re-probed again immediately before push).

## Owner actions needed
- **Render manual deploy** of scrivara-backend (branch agent/provider-identity-source-20260721, commit 52ce634) to activate the booking transaction/idempotency + portal DOB fixes live. Frontend degrades safely without it.
