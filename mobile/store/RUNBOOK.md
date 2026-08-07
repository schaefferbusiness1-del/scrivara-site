# Shipping Scrivara to the App Store and Google Play

Everything below is done except the parts that need a store account. `ACCOUNTS.md` is the list
of accounts and why I could not create them.

---

## What is already built

```
app.html                       the app. One file, no dependencies.
app-manifest.json              its PWA manifest (web install)
app-icon-1024.png              store icon, opaque, no alpha
app-icon-maskable-1024.png     Android adaptive foreground
mobile/
  app.config.json              THE identity: name, bundle id, version, API host
  capacitor.config.json        derived from the above — do not hand-edit
  scripts/build-www.mjs        app.html -> www/index.html, 7 values stamped
  scripts/make-icons.mjs       every store image, generated from source
  scripts/configure-native.mjs the settings `cap add` does not set
  android/                     the Android project (generated, committed)
  ios/                         the Xcode project (generated, committed)
  assets/                      icon + splash sources for @capacitor/assets
  store/                       this runbook, the listing copy, the answers
.github/workflows/
  mobile-android.yml           builds the .aab
  mobile-ios.yml               builds the .ipa, optionally to TestFlight
```

## Build it locally

```bash
cd mobile
npm install
npm run build          # app.html -> www/index.html
npx cap sync           # copies www/ into android/ and ios/
node scripts/configure-native.mjs
```

Then:

```bash
npx cap open android   # needs Android Studio
npx cap open ios       # needs Xcode, so needs a Mac
```

To rebuild the images after a brand change: `node scripts/make-icons.mjs && npm run assets`.

**One rule.** `app.html` is the app. Never edit `mobile/www/index.html`, and never edit
`android/app/src/main/assets/public/` or `ios/App/App/public/` — all three are generated copies,
and `tests/phone-app-www-build-is-faithful.test.js` fails the build if they stop matching.

---

## Android

### Create the upload key

Once, on a machine you trust:

```bash
keytool -genkey -v -keystore upload-keystore.jks \
  -keyalg RSA -keysize 2048 -validity 10000 -alias upload
```

> **Losing this file locks you out of your own listing.** Without it you cannot publish an
> update to an app already on Play — you would have to publish a *new* app, with a new package
> name, a new listing, zero installs, and no upgrade path for anyone who already had it.
> Put it in a password manager and in one offline backup. Do NOT put it in git; `mobile/.gitignore`
> already refuses it, but the habit matters more than the file.
>
> Enable **Play App Signing** when you create the app. Google then holds the real signing key
> and this one is only your *upload* key — which Google can reset if you lose it. That single
> setting turns the paragraph above from a disaster into a support ticket.

### Build

Either locally:

```bash
cd mobile/android
cat > keystore.properties <<EOF
storeFile=/absolute/path/upload-keystore.jks
storePassword=…
keyAlias=upload
keyPassword=…
EOF
./gradlew bundleRelease
# -> app/build/outputs/bundle/release/app-release.aab
```

or in CI: **Actions → Build Android app bundle → Run workflow**, after the four `ANDROID_*`
secrets are set.

### Upload

Play Console → your app → Testing → **Internal testing** → Create release → upload the `.aab`.
Start there, not with production. Internal testing goes live in minutes and needs no review, so
you find out on your own phone whether the pull works before a reviewer does.

Then fill in what Play requires before the production track will accept anything:
Store listing (copy in `LISTING.md`), Data safety (answers in `PRIVACY-ANSWERS.md`), Content
rating questionnaire, Target audience, App access (see below), Privacy policy URL.

**App access is the one that will bounce you.** Scrivara is entirely behind a clinician login,
and a reviewer who cannot sign in will reject it. Play Console → App content → **App access** →
"All or some functionality is restricted", and provide working demo credentials. Make a real
account on a synthetic-data practice for this; do not hand a reviewer a live clinician login.

---

## iOS

### Build

**Actions → Build iOS app → Run workflow**, after the four `IOS_*` secrets are set. Tick
`upload` to send it straight to TestFlight.

Locally, on a Mac: `cd mobile && npx cap open ios`, then Product → Archive.

### Submit

1. App Store Connect → Apps → **+** → New App, bundle id `com.scrivara.app`.
2. Wait for the TestFlight build to finish processing (10–30 minutes).
3. Install it on your own iPhone through TestFlight and actually pull a day. Do this before
   submitting, every time.
4. Fill in the listing (`LISTING.md`), the privacy questionnaire (`PRIVACY-ANSWERS.md`), and
   the review notes below.
5. Submit for review.

### The three things Apple will ask about

Written out because each one is a rejection if it is not answered up front. Paste these into
**App Review Information → Notes**.

**Demo account (Guideline 2.1).** Same as Play: the app is entirely behind a login. Give a
working account on a synthetic-data practice, plus the TOTP seed if that account has 2FA, and
say plainly: *"This app shows a clinician their own appointment schedule and their own patients'
visit history. Every screen requires sign-in. The demo account contains synthetic records only."*

**Minimum functionality (Guideline 4.2).** The app is bundled, not a webview of a website — its
HTML ships inside the binary and only the API is remote. Say so: *"The app's interface is
bundled in the binary; it contacts one HTTPS API for the signed-in clinician's own data. It is
not a wrapper around a website."*

**Health data (Guideline 1.4.1 / 5.1.3).** *"Scrivara is a clinical tool for licensed
clinicians, not a consumer health app. It does not provide medical advice, diagnosis, or dosage
information. It displays a clinician's own schedule and their own patients' visit history from
the practice's system of record."*

---

## The trade this design makes, stated once

The app is **bundled**, so a fix needs a store release rather than a git push. That is a real
cost — an Apple review is one to three days.

It is the right cost. A shell pointing at a website is a Guideline 4.2 rejection, and it means
an outage or a bad deploy bricks the app on every phone at once instead of degrading one screen.
A bundled app that cannot reach the API shows "No connection" and still launches.

If a fix is ever urgent enough to need same-day delivery, the same `app.html` is live at
<https://mlsscribe.com/app.html> and works in Safari and Chrome — including "Add to Home
Screen", which gives the same full-screen, no-browser-chrome experience. That is the escape
hatch, and it needs no store at all.

---

## Releasing an update

1. Edit `app.html`.
2. `cd mobile && npm run build && npx cap sync && node scripts/configure-native.mjs`
3. Bump `mobile/app.config.json`:
   - `version` — the human version, both stores show it
   - `androidVersionCode` — **must** be strictly greater than the last Play upload
   - `iosBuildNumber` — **must** be greater than the last upload for this `version`
4. `node tests/run-all.js` from the repo root. The three `phone-app-*` suites are the ones that
   matter here, and the third re-runs the build and diffs it against `app.html`.
5. Run both workflows. Upload.

Both stores reject an upload whose version number did not increase, and both do it after you
have waited for the build. Step 3 is the one worth double-checking.
