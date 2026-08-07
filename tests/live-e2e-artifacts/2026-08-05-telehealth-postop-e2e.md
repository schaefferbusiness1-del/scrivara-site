# Post-op video visit — end-to-end evidence, 2026-08-05

## Result

**28/28 checks PASS against a real running server** (not stubs, not mocks).
Harness: `scrivara-backend/tests/telehealth-live-e2e.js`. Re-run after merging
`origin/main` (avatar rounds 2–4) on a fresh database: still 28/28.

Full path exercised, the way the two browsers do it:

    clinician registers -> admin grants the legal release -> admin activates
    account access -> clinician seeds a post-op patient and a non-post-op
    control -> portal accounts provisioned -> patient signs in -> eligibility
    -> asks to talk -> doctor lists and accepts -> WebRTC signalling both
    directions -> doctor ends -> mailbox wiped

Every refusal asserted too: ineligible patient blocked at the REQUEST route
(not just hidden in the UI), a second clinician cannot accept another
practice's visit, a VALID session for a DIFFERENT patient can neither read nor
inject into the room, no session at all is refused first, oversized signal
refused, signalling into an ended visit refused.

## Two real bugs it found. Neither was reachable by unit tests.

**1. `decrypt` called positionally.** `src/crypto.js:23` exports
`decrypt({ ciphertext, iv, auth_tag })` — one object. `telehealth.js` called it
as `decrypt(a, b, c)`. It throws, the `catch` turns it into `null`, and
eligibility answers a confident `reason: "no-chart"`. **Every post-op patient
would have been told they have no procedure on file while their chart sat right
there.**

**2. Clinician id read as `req.user.id`.** `requireClinician` puts it on
`req.user.uid`; `req.user.id` is `undefined`, so `WHERE owner_user_id = ?`
matched nothing and **the doctor's request list came back EMPTY while the
patient sat in the waiting state.** Now resolved the way
`patientPortal.js`'s invite route does it, so a request is LISTED under the same
owner it was FILED under.

## Why bug #1 survived review — the transferable lesson

The unit test's stub was `const decrypt = (ct) => ct;` — **a looser signature
than the real function**, so it accepted the positional call happily and the
suite stayed green. A stub that is more permissive than the thing it stands in
for does not test the call, it hides it. The stub now takes the real shape and
throws otherwise; the unit suite went red the instant the production code was
corrected, which is what it should have done days earlier.

The live harness also caught a weakness in **itself**: it asserted
`eligible === false` without checking the reason, so "correctly refused" and
"everything is broken" were indistinguishable and it stayed green straight
through bug #1. It now asserts the reason.

## Four gates refused it on the way. All satisfied, none weakened.

1. `SIGNUP_MANIFEST_UNAVAILABLE` — account creation refused until the signup
   documents are published. Satisfied with the repo's own CI fixture
   (`tests/signup-agreement-test-fixture.js`, synthetic-evaluation channel,
   `clinicalUseAuthorized:false`), sending the same assent a browser sends.
2. `LEGAL_RELEASE_REQUIRED` — `/api/patients` needs a counsel-approved release
   granted per user, and **the admin surface needs one too**.
3. `no_access` (402) — patient data also needs active account entitlement.
4. **Separation of duties**: the admin who grants is then *barred* from patient
   data ("The owner account cannot access patient data"), so the harness
   provisions TWO accounts. This is a control, not an obstacle.

The harness's local bootstrap **refuses to run against any non-localhost
target** — a harness that can quietly promote roles on a deployed server is a
worse problem than the gate it is satisfying.

## Live status — the honest part

- **Site (b878) is LIVE and verified dark**: the portal module loads
  (`tv-1.0.0`), renders **zero** nodes and makes **zero** tele requests until a
  backend answers. No broken button for a patient in pain.
- **Backend code is ON `origin/main`** of `scrivara-backend` (`3c50ab4`;
  `src/telehealth.js` present, `registerTelehealth` mounted in `server.js`).
- **Production has NOT picked it up.** `/api/tele/ice` returned **404 for ~15
  minutes** across 38 polls. Not a gating problem: `/api/patient/me` returns
  401, so `phiReadiness.clinicalUse` is true and the portal IS mounted — the new
  code simply is not deployed. Either auto-deploy is off for this service or the
  build failed. **Checking or triggering the Render deploy needs the owner's
  dashboard; it is not something to work around.**
- **TURN is unset.** ICE reports `degraded: 'no-turn-credentials'`. STUN alone
  does not connect a patient on carrier-grade NAT — exactly someone lying at
  home on a phone. Twilio Network Traversal issues TURN from the SMS-2FA
  `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN` already in the environment; the code
  uses them automatically once present in the backend's env.

## To finish

1. Deploy `scrivara-backend` `3c50ab4` (owner's Render dashboard).
2. Confirm `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` are set on the backend
   service, then `GET /api/tele/ice` should report `turn: true`.
3. Re-run `node tests/telehealth-live-e2e.js https://scrivara-backend.onrender.com`
   — it skips the local bootstrap and assumes an already-granted clinician.
4. One real call on a real phone, owner-gated.
