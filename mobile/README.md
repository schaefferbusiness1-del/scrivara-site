# mobile/ — MLS Scribe on the App Store and Google Play

This directory turns `../app.html` into a native iOS and Android app. It adds no code to the
app itself; Capacitor puts the same HTML inside a native shell and the app talks to the same
API it always did.

## Start here

| you want to | read |
|---|---|
| build and submit | `store/RUNBOOK.md` |
| know which accounts to create and what they cost | `store/ACCOUNTS.md` |
| fill in a store listing | `store/LISTING.md` |
| answer the privacy questionnaires | `store/PRIVACY-ANSWERS.md` |
| understand why the app looks like this | `store/DESIGN.md` |

## Quick build

```bash
npm install
npm run build          # ../app.html -> www/index.html
npx cap sync
node scripts/configure-native.mjs
npx cap open android   # or: npx cap open ios   (needs a Mac)
```

## The one rule

`../app.html` is the app. Everything under `www/`, `android/app/src/main/assets/public/` and
`ios/App/App/public/` is a generated copy — edit any of them and your change is silently
overwritten by the next `cap sync`, or worse, ships to one store and not the other.

`../tests/phone-app-www-build-is-faithful.test.js` re-runs the build and diffs the result
against `app.html` byte for byte, so this rule is enforced rather than merely written down.

## Identity lives in one file

`app.config.json` holds the app name, bundle id, version, and API host. `capacitor.config.json`
is derived from it by the build; the Android `versionCode`/`versionName` and the iOS
`MARKETING_VERSION`/`CURRENT_PROJECT_VERSION` are written from it by
`scripts/configure-native.mjs`. Change the one file and re-run the build.

`appId` (`com.mlsscribe.app`) is **permanent** once a build is uploaded. Neither store lets you
change it; a different id is a different app with a different listing and no upgrade path for
anyone who installed the first one.

## What is committed and what is not

Committed: `android/` and `ios/` (the generated native projects — committed so a build is
reproducible without network access to the Capacitor templates), `assets/` (icon and splash
sources), `store/`, `scripts/`, and the two config files.

Not committed, and refused by `.gitignore`: `www/`, `node_modules/`, both native `public/`
copies, every build output, and **all signing material** — keystores, `.p12`s, provisioning
profiles, App Store Connect `.p8` keys. An upload key in git is an app hijack: anyone holding it
can publish an update to the owner's listing.
