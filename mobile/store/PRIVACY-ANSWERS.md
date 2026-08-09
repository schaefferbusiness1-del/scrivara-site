# The privacy questionnaires, answered

Both stores make you declare, field by field, what the app collects. Both treat a wrong answer
as a policy violation rather than a mistake — Play will suspend an app whose Data safety form
does not match its behaviour.

Every answer below is derived from `app.html` and checked by
`tests/phone-app-boundaries.test.js`. Where an answer depends on something the app does, the
line of reasoning is written out, so a future reader can re-check it instead of trusting it.

---

## What the app actually does with data

Three facts decide every answer:

1. **It stores no patient data on the device.** All patient information lives in one in-memory
   object (`S`, in `app.html`) and dies with the process. The only two things written to
   storage are the session token and the last email typed at sign-in.
   *Checked by:* `phone-app-boundaries.test.js` § 3, which allowlists exactly those two keys and
   fails on any IndexedDB, Cache API or worker use.
2. **It talks to one host.** `connect-src` in the CSP names
   `https://scrivara-backend.onrender.com` and nothing else. There is no analytics SDK, no
   crash reporter, no ad network, no third-party library of any kind.
   *Checked by:* `phone-app-boundaries.test.js` § 1 and § 2.
3. **It transmits patient data, because that is its job.** Names, dates of birth, MRNs and
   visit history travel from the practice's own backend to the phone over HTTPS, to be
   displayed. Both stores count that as *collection* even though nothing is retained, and both
   forms must say so.

---

## Apple — App Privacy (App Store Connect → App Privacy)

> **Do you or your third-party partners collect data from this app?** → **Yes**

Apple's definition of "collect" includes transmitting off-device even transiently, so the
honest answer is Yes even though nothing is retained on the phone.

| Apple category | Collected | Linked to identity | Used for tracking | Purpose |
|---|---|---|---|---|
| **Health & Fitness → Health** | Yes | Yes | **No** | App Functionality |
| **Contact Info → Name** | Yes | Yes | **No** | App Functionality |
| **Contact Info → Email Address** | Yes | Yes | **No** | App Functionality |
| **Identifiers → User ID** | Yes | Yes | **No** | App Functionality |
| everything else | No | — | — | — |

Specifically **No** to: Location, Contacts, Search History, Browsing History, Purchases,
Financial Info, Usage Data, Diagnostics, Sensitive Info (Apple's "Sensitive Info" category is
race/religion/orientation/etc., not clinical data — clinical data is "Health").

> **Tracking** → **No.** The app has no advertising identifier, no third-party SDK, and shares
> nothing with a data broker. Do not tick tracking for anything.

Health & Fitness → Health is the patient's clinical information (visit history, procedure
types, codes). Name and Email cover the patient's name and the clinician's sign-in email. User
ID is the session token's account binding.

---

## Google Play — Data safety (Play Console → App content → Data safety)

> **Does your app collect or share any of the required user data types?** → **Yes**
> **Is all of the user data collected by your app encrypted in transit?** → **Yes** (HTTPS only;
> `usesCleartextTraffic="false"` in the manifest, `cleartext: false` in the Capacitor config)
> **Do you provide a way for users to request that their data is deleted?** → **Yes** —
> https://mlsscribe.com/privacy.html

| Play data type | Collected | Shared | Processed ephemerally | Required | Purpose |
|---|---|---|---|---|---|
| **Personal info → Name** | Yes | No | **Yes** | Required | App functionality |
| **Personal info → Email address** | Yes | No | No | Required | App functionality, Account management |
| **Personal info → User IDs** | Yes | No | No | Required | App functionality |
| **Health and fitness → Health info** | Yes | No | **Yes** | Required | App functionality |
| everything else | No | — | — | — | — |

"Processed ephemerally" is ticked for the two patient-data rows and it is a strong claim, so
here is the basis: patient names and clinical data are held only in memory for the duration of
the screen, are never written to any device store, and are gone when the app is closed or the
15-minute idle lock fires. Email is *not* ephemeral — it is remembered to pre-fill the sign-in
field — so that row is honestly left unticked.

**Sharing is No everywhere.** The app sends data to the practice's own backend, which is the
first party, not a third party. There is no other recipient.

---

## Health-app declarations

**Apple** asks, in the app's metadata, whether it uses HealthKit — **No**. MLS Scribe does not
touch HealthKit, Apple Health, or any device sensor. It reads a practice's own record system.

**Play** requires a **Health apps declaration** for anything in the Medical category.
Answer it as: *not* a COVID-19 app, *not* a clinical decision support tool, *not* a diagnostic
or treatment app. It is a records-viewing tool for licensed clinicians accessing their own
practice's data. If Play asks for evidence of a health-authority relationship, the answer is
that the app accesses only the practice's own system of record on behalf of that practice's own
clinicians — there is no third-party health data source.

---

## Permissions the app requests

**Android:** `INTERNET`. That is the complete list — check
`mobile/android/app/src/main/AndroidManifest.xml`.

**iOS:** none. No camera, no microphone, no location, no contacts, no notifications, no photo
library. Every one of those would need a purpose string in `Info.plist`, and there are none —
which is also the fastest way to verify this claim.

The phone recorder (`phone.html`) is a **different product** and does use the microphone. It is
not part of this app and is not in either binary.
