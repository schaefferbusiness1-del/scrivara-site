# scrivara-site

The MLS Scribe website, clinician app and MLS Assist Chrome extension, served
from GitHub Pages at mlsscribe.com.

## Where things live

- `1pScribeFlow.html`, `1p/index.html`, `1p-mls-connect.js`, `1p-feat_*.js`:
  the source lane for the clinician app. `1pScribeFlow.html` and
  `1p/index.html` are twins; edit both.
- `ScribeFlow.html`, `mls-connect.js`, `feat_*.js` (production) and
  `cloned/`, `cloned-*` are derived from the 1p lane. Do not edit them by
  hand:

  ```bash
  node scripts/derive-production-from-1p.js
  node scripts/derive-cloned-from-1p.js
  node scripts/derive-production-from-1p.js --check   # verify, no writes
  ```
- `index.html`, `booking.html`, `intake.html`, `appointment.html`,
  `patient-portal.html` and the other top-level pages: standalone public pages.
- `manifest.json`, `background.js`, `content.js`, `popup.html`/`popup.js` at
  the root: the MLS Assist extension source. `MLS_Assist_v*.zip` / `.bin` are
  built releases (`scripts/build-extension-zip.js`);
  `scripts/extension-core-digest.js --stamp` / `--verify` keep the core
  digest in step.
- `mobile/`: the Capacitor wrapper that ships `app.html` as the iOS and
  Android app (`cd mobile && npm run build`).
- `docs/archive/`: historical notes, prototypes and one-shot release scripts.
  Nothing there is published or run.

## Releasing a build

```bash
node scripts/bump-build.js "bNNNN: what changed"
```

Also bump `const CACHE = 'mls-vNNN'` in `sw.js` and the two tests that pin it.

## Tests

```bash
npm test                          # tests/run-all.js: every registered suite
node tests/run-all.js --plan      # print the suite count
node tests/<name>.test.js         # one suite
```

A new `*.test.js` must be registered in `tests/run-all.js`; the runner fails
on an unregistered suite. Browser suites use Playwright's Chromium.

## Deploying

Pushing to `main` runs `.github/workflows/pages-deploy.yml`: a Jekyll build
limited by `_config.yml` (HTML is published only from its allowlist), an audit
of the generated tree, and a guard that refuses to publish an older build over
a newer one.
