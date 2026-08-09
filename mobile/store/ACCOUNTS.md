# The accounts — what exists, what does not, and who has to create what

Last updated 2026-07-31, when the app was built.

## Read this part first

**No store account exists for this app, and I could not create one.** The apps are built and
submission-ready; they are not submitted. That is not a step I skipped — it is a step that
cannot be automated:

- Enrolling in the **Apple Developer Program** requires a legal entity, a payment method, and
  Apple's identity verification of a named human who has authority to bind that entity. For an
  organization it also requires a **D-U-N-S number** for the practice. Apple verifies this by
  phone and by document review.
- A **Google Play Developer** account requires identity verification with a government ID and,
  for an organization, a D-U-N-S number plus a verified phone and address.
- Both are contracts. Signing them on the owner's behalf would be signing a contract on the
  owner's behalf.

So this file is the exact list of what to create, in order, with what it costs and what it
needs. Everything downstream of these accounts — icons, bundle, metadata, CI, the builds
themselves — is already done and waiting.

There is one more hard requirement worth knowing before you start: **an iOS build has to be
signed on a Mac.** `mobile-ios.yml` runs on a GitHub-hosted macOS runner, so you do not need to
own one — but there is no path to the App Store that avoids macOS entirely.

---

## What to create, in order

### 1. Apple Developer Program — $99/year

- Sign up: <https://developer.apple.com/programs/enroll/>
- Enroll as the **practice entity** (an Organization), not as an individual, unless the
  practice is a sole proprietorship trading under the owner's own name. An app that handles
  patient data and is listed under a personal name looks exactly as odd to a reviewer as it
  sounds.
- An Organization enrollment needs a **D-U-N-S number** for the entity. It is free from
  Dun & Bradstreet and takes up to 5 business days: <https://developer.apple.com/enroll/duns-lookup/>
  Start this first — it is the long pole.
- Expect 1–2 days for Apple's verification call after the D-U-N-S is in hand.

Once enrolled you will create, inside App Store Connect:

| thing | where | used by |
|---|---|---|
| An **App Record** with bundle id `com.mlsscribe.app` | App Store Connect → Apps → + | the listing |
| An **Apple Distribution certificate** (.p12) | Certificates, IDs & Profiles | `IOS_CERTIFICATE_P12_BASE64` |
| An **App Store provisioning profile** for that bundle id | Certificates, IDs & Profiles | `IOS_PROVISIONING_PROFILE_BASE64` |
| An **App Store Connect API key** (.p8, Developer role or higher) | Users and Access → Integrations → App Store Connect API | `APPSTORE_API_*` |
| Your **Team ID** (10 characters) | Membership details | `IOS_TEAM_ID` |

### 2. Google Play Console — $25, one time

- Sign up: <https://play.google.com/console/signup>
- Same guidance: register the **practice entity**, not a person. An organization account needs
  a D-U-N-S number too (the same one from step 1 — get it once, use it twice).
- Identity verification takes a few days.

Then, inside Play Console:

| thing | where | used by |
|---|---|---|
| An **app** with package name `com.mlsscribe.app` | Play Console → Create app | the listing |
| An **upload keystore** | you generate it — see RUNBOOK.md § "Create the upload key" | `ANDROID_KEYSTORE_*` |
| **Play App Signing** enabled | Release → Setup → App signing | lets Google hold the real signing key |

### 3. GitHub Actions secrets

Once you have the material above, put it in
`Settings → Secrets and variables → Actions` on `schaefferbusiness1-del/scrivara-site`:

```
ANDROID_KEYSTORE_BASE64          base64 -w0 upload-keystore.jks
ANDROID_KEYSTORE_PASSWORD
ANDROID_KEY_ALIAS
ANDROID_KEY_PASSWORD

IOS_CERTIFICATE_P12_BASE64       base64 -i dist.p12
IOS_CERTIFICATE_PASSWORD
IOS_PROVISIONING_PROFILE_BASE64  base64 -i MLSScribe.mobileprovision
IOS_TEAM_ID

APPSTORE_API_KEY_ID
APPSTORE_API_ISSUER_ID
APPSTORE_API_PRIVATE_KEY         the whole .p8 file, including the BEGIN/END lines
```

With those set, `Actions → Build Android app bundle` and `Actions → Build iOS app` produce
upload-ready artifacts. Without them both workflows still run and produce *unsigned* builds,
which is a useful check that the projects compile and is useless for uploading — each workflow
says which of the two it produced.

---

## Accounts this app already depends on, which DO exist

These are the ones the app talks to. Nothing new is needed for any of them.

| account | what it is | where it shows up |
|---|---|---|
| **Render** — `scrivara-backend.onrender.com` | the API the app calls | `mobile/app.config.json` → `apiBase`, and the CSP `connect-src` in `app.html` |
| **GitHub Pages** — `mlsscribe.com` | serves `app.html`, `privacy.html`, `terms.html` | the store listings' privacy-policy URL |
| the doctor's **own MLS Scribe login** | email + password (+ TOTP if enabled) | the app's sign-in screen |

The app creates no account of its own, has no separate password, and has no admin console. A
clinician signs in with the same credentials they use on the desktop, and the server decides
what they may see — `requireClinician`, then `patientAccessGate`, then the clinical-release
grant. The phone is a client, not a second source of authority.

---

## What the app can and cannot be given

**It needs no new API key, and it is not given one.** The relay is scoped server-side to the
signed-in account (`requireClinician`, jobs keyed to `req.dbUser`), so the phone's only
credential is the same JWT the web app gets. There is no device key to issue, rotate or leak.

**There is one new server-side allowance**, and it is in the other repo on the same branch: the
CORS allowlist now admits `capacitor://localhost` and `https://localhost`, the two origins a
bundled Capacitor app runs from. Neither can be sent by a web page, and neither is
env-configurable. See `scrivara-backend/tests/native-app-origins.test.js` for the fence.
