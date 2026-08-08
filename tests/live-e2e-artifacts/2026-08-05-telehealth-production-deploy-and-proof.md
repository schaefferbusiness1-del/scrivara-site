# Telehealth post-op lane — production deploy + what is and is not proven

**Date:** 2026-08-05 evening ET
**Backend deploy:** `3c50ab4` "merge origin/main (avatar rounds 2-4) under the telehealth lane",
Render service `srv-d8gt7s3eo5us73d34adg`, green, 35.1s, 6:41:02 PM EDT.
**Site:** b878 (portal card tv-1.0.0 + `feat_mls_tele_doctor.js` td-1.0.0), live since earlier.

---

## THE FINDING THAT MATTERS MOST: auto-deploy is OFF on scrivara-backend

Every deploy in the service's history since 2026-07-19 reads `TRIGGER: Manual`. The last
`Auto-Deploy` entries are 2026-07-18/19. **Nothing pushed to `scrivara-backend` main deploys
itself.** My commit sat on `origin/main` untouched until I opened the dashboard and clicked
Manual Deploy → Deploy latest commit.

Anyone who pushes backend work and then verifies against production will see their change
missing and conclude the code is broken. It is not; it was never deployed. **Check the deploy
list before diagnosing a "backend didn't work" report.**

## PROVEN on production

Route surface, unauthenticated — all fail closed, which is correct:

    GET /api/tele/ice                    401
    GET /api/tele/requests               401
    GET /api/patient/tele/eligibility    401
    GET /api/patient/tele/ice            401
    GET /api/tele/room/:room/signal      401

Authenticated as the OWNER'S REAL CLINICIAN ACCOUNT (read-only, zero writes):

    GET /api/tele/requests   ->  200  {"requests": []}
    GET /api/tele/ice        ->  200  {turn:false, degraded:"no-turn-credentials", iceServers:1}

The 200 on `/api/tele/requests` is the load-bearing one: it means the doctor half authenticates,
clears the legal-release grant AND the entitlement gate, and returns a well-formed list on
production with real credentials. Not just "mounted" — working.

Server boot receipt (local real-server run, same code): `[telehealth] mounted: post-op video
request/accept/signal`.

Unaffected by the deploy: `/api/patient/me` 401, `/api/agreements/signup-manifest` 200.

## PROVEN: the post-op gate refuses a real ineligible patient

Evaluated the server's own rule against **Adam J Schaeffer, MRN 7833832** (the one authorized
test patient) read-only on production:

    totalVisits: 7      procedureShapedVisits: 0      WOULD_BE_ELIGIBLE: false

Adam has **no procedure or surgery anywhere in his chart**. The gate correctly refuses him. This
is a genuine production proof of the guard — and it means **Adam cannot be used to test the happy
path** without fabricating a surgical history in a real person's chart, which was refused (see
below).

## NOT PROVEN: the patient half on production

The patient side needs an authenticated portal session. Reaching one requires either creating a
portal login or authenticating with a password; both were declined as a standing rule, and no
session token was ever supplied. So on production:

- eligibility -> request -> accept -> signalling -> end has **not** been exercised end to end.
- It IS proven 28/28 against a real local server (see
  `2026-08-05-telehealth-postop-e2e.md`), including the two defects that E2E caught.

**Do not report the production lane as fully proven.** The doctor half is; the patient half is
proven only locally.

## TURN IS NOT CONFIGURED — the real blocker for a phone on cellular

`/api/tele/ice` returns `turn:false, degraded:"no-turn-credentials"` from production, and the
service's env list (alphabetical, ends at `TEXT_MODEL`) contains **no `TWILIO_*` variable at all**.
The SMS-2FA Twilio work seen in the backend clone is on an undeployed branch; its credentials were
never added to this service.

STUN alone connects most home wifi and **fails behind carrier-grade NAT** — exactly a patient lying
at home on a phone after surgery. Add `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN` to the service;
the code then issues TURN through Twilio Network Traversal with no code change and no new vendor.

## Refused, deliberately

1. **Fabricating a procedure in Adam's chart** to make him eligible. He is a real person; that
   record mirrors to the server, feeds Copilot context and note generation, and can reach athena.
   Note writes to Adam are authorized; inventing surgical history is a different act.
2. **Creating a patient-portal login / signing in with a password.** Standing rule, and it holds
   even when directed.

## Test data: created and REMOVED

    created  zz-tele-test-1785973188672  "ZZ TEST PostOp (delete me)"  id 394847
             dob 1970-01-01, one visit "Lumbar discectomy surgery" 4 days ago
             verified SHOULD_BE_ELIGIBLE: true
    deleted  DELETE /api/patients/394847 -> 200 {"ok":true}
    roster   1556 -> 1557 (created) -> 1556 (deleted), syntheticRemaining: 0

Trap for the next session: `DELETE /api/patients/:id` takes the **numeric server id**, not the
external_id — the external_id returns 400. And the delete archives before removing
(restorable), so it is not destructive.

## Other live observations

- **Render workspace shows "Payment failed — update your credit card to avoid losing access to
  your workspace's services."** It did not block this deploy but threatens the whole backend.
- Reading the owner's clinician token WITHOUT booting the app: open a static same-origin page
  (`/privacy.html`) and read `sf_bk_token` from storage. Verified `appBooted:false`. This is the
  safe way to use his session while another lane holds an armed probe in the app — booting the app
  in a second tab would disturb the active-patient/visit binding it depends on.

## To finish

1. Add the two `TWILIO_*` vars.
2. Provide a patient portal session token for an eligible chart (or a real post-op patient who
   already has a portal login), then run: eligibility -> request -> accept -> signal -> end, and
   delete every artifact.
