# Lane claim 014 — the PHONE APP lane (a separate, small native app)

Opened 2026-07-31, rebased onto `7e3846d` (b823). Branch:
`claude/phone-app-redesign-publish-nqjfpb` (same branch name in **both** repos:
`scrivara-site` and `scrivara-backend`).

**Read this if you are about to edit `mls-connect.js`, `ScribeFlow.html`, `phone.html`, or the
backend CORS block.** Short version: I am touching NONE of the first three.

## First, the boundary 013 recorded

`013-pull-surface-defects-handoff.md` quotes the owner: *"Don't touch any of the pull stuff or
extension stuff."* This lane honours that literally. **It changes zero pull files and zero
extension files** — not `feat_mls_centerpiece.js`, not `feat_mls_schedpull_fix.js`, not
`feat_mls_schedimport_exact.js`, not `mls-connect.js`, not `content.js`, not any candidate
build. The app *calls* the relay that already exists (`POST /api/relay/jobs`, kinds `pullDay`
and `pullChart`) exactly the way `__mlsRelayLink` already calls it, and the office computer
executes it through the pull engine that already ships, unmodified.

The three defects in 013 are therefore all still open and all still mine to avoid, not to fix.
One of them touches this app indirectly and is worth stating: **defect 1 (the pull note that
claims all-providers while the pull filters to one doctor) has no counterpart here**, because
this app's pull sends `provider: null` and prints no claim about scope at all. It reports only
what it can then count on the phone.

## What this lane is

Owner instruction: *"make the phone app perfect with very little buttons and just pull and can
see a patient, and publish it on the App Store and Android store."*

The thing called "the phone app" today is `ScribeFlow.html?phone=1` — the 2.2 MB desktop SPA
with a 28-line static CSS hide-list (`__mlsPhoneHome` ph-1.1.0, `mls-connect.js` ~46373-46600).
`PHONE_AUDIT_2026-07-27.md` is the standing verdict on it: seven breakages (B1-B7), of which
B2/B3 mean a doctor on a phone today can see **no transcript** and has **no way out of a
finished recording**, plus a dock that overflows 375px by 48px. That audit's own status line
reads "B-fixes not started as of b728."

I am not fixing that hide-list. **This lane builds a separate, small app** whose whole job is
the two verbs the owner named — *pull*, and *see a patient* — and ships it to the two stores.
The phone-shell layer over ScribeFlow stays exactly as it is, still owned by whoever wants it.

Explicitly NOT this lane: the 39 findings in `coordination/STANDING_REVIEW_2026-07-30.md`, the
identity wiring in lane 012, the op-note/Templates subtree, perf, or the extension.

## Files I am claiming

### `scrivara-site`

| file | region | why |
|---|---|---|
| `app.html` | **new file** | the app. Self-contained, no ScribeFlow, no `mls-connect.js`. |
| `app-manifest.json` | **new file** | its PWA manifest |
| `app-icon-1024.png`, `app-icon-maskable-1024.png` | **new files** | store-size icons (the existing `icon-512.png` is below Apple's 1024 floor, and is still blue while the app is green) |
| `mobile/**` | **new subtree** | Capacitor project, store metadata, submission runbook |
| `tests/phone-app-*.test.js` | **new files** | pins |
| `.github/workflows/mobile-*.yml` | **new files** | store-artifact CI |
| `_config.yml` | `include:` list — **appended lines only** | Jekyll fails closed on `*.html`; a new page that is not on the allowlist is not published |
| `sw.js` | `PUBLIC_HTML_PATHS` + `NETWORK_ONLY_HTML_PATHS` — **appended lines only** | same boundary, second enforcement point; the app is network-only so a launch never serves a stale shell |
| `tests/run-all.js` | test list — **appended lines only** | |
| `tests/public-publication-boundary.test.js` | `PUBLIC_HTML` + `PUBLIC_ASSETS` — **appended entries only** | this suite enumerates the reviewed public surface and fails closed; registering a new page here is how the boundary is meant to move |
| `tests/static-site.test.js` | the directory walker — **one added skip list** | Capacitor copies `mobile/www` into both native projects on every `cap sync`; walking those generated duplicates makes an unrelated suite fail on a stale local sync and reports one defect three times |

I will not touch: `mls-connect.js`, `ScribeFlow.html`, `phone.html`, `phone-manifest.json`,
any `feat_mls_*.js`, `sw.js`'s `CACHE` version or `SHELL` array, or the *assertions* of any
existing test.

**Amended after rebase, so it is on the record rather than in a diff.** I said "no existing
test" when I opened this; two existing suites had to be told the new page exists. Both edits are
registrations, not weakenings — `public-publication-boundary` gains four allowlist entries so a
published page is a reviewed one, and `static-site` gains a skip for two generated directories.
Neither removes an assertion. If you would rather the skip lived somewhere else, say so.

`phone.html` (the MLS Recorder) is a **different product** — it pairs to a desktop visit with a
6-character code and uploads audio clips. It keeps its name, its route, and its manifest. The
new app does not record and does not touch `/api/mic/*`.

### `scrivara-backend`

| file | region | why |
|---|---|---|
| `src/server.js` | `CANONICAL_NATIVE_APP_ORIGINS` + `configuredCorsOrigins` **only** | see below |
| `src/server.js` | `GET /api/records` — the query-filter lines **only** | see below |
| `tests/native-app-origins.test.js`, `tests/records-patient-filter.test.js` | **new files** | pins |
| `package.json` | `test` script — **appended entries only** | |

Two backend changes, both small, both load-bearing:

1. **CORS rejects native apps.** `configuredCorsOrigins` (`src/server.js:497`) drops any origin
   whose protocol is not `https:` outside local dev. A Capacitor app's origin is
   `capacitor://localhost` on iOS and `https://localhost` on Android — the first is refused on
   protocol, the second would be refused on hostname outside dev. With no
   `Access-Control-Allow-Origin` header the app's every `fetch` fails as a bare "Failed to
   fetch", which is exactly the failure mode the `X-Request-ID` comment two blocks down was
   written about. I add these two exact origins the same way the Chrome-extension origins are
   already handled: a canonical constant, validated exactly, never a wildcard.

2. **`GET /api/records` has no per-patient filter** (`src/server.js:3745`). It decrypts and
   returns *every* record in the practice. On a desktop that is merely wasteful; on a phone
   over cellular it is megabytes of PHI to render one chart. I add optional
   `patient_external_id` / `client_id` query filters, applied **inside** the existing role
   scope so they can only ever narrow, never widen, what a caller may see.

If you need either region mid-lane, drop a note in `coordination/inbox/` and I will hold.

## What the app actually is

Three screens, and past sign-in the whole app is **two taps deep**:

1. **Sign in** — email, password, TOTP if the account has it. Two fields, one button.
2. **Today** — the day's patients, newest activity first. One primary button: **Pull today**.
   Pull-to-refresh works, so the button is the only chrome.
3. **Patient** — name, age, DOB, MRN, then the visit list. One primary button: **Pull chart**.

Both pull buttons go through the existing relay (`POST /api/relay/jobs`, kinds `pullDay` and
`pullChart`) — the same queue `__mlsRelayLink` already drives, executed by the same office
computer, through the same extension. **No new pull engine, no second source of truth.** The
app checks `/api/relay/presence` first and refuses honestly when the office computer is not
reachable, rather than queuing into a void; that fail-fast rule is copied from `rl-2.0.0`
because it was learned the expensive way.

Nine interactive controls exist in the whole app. That is the budget, and
`tests/phone-app-control-budget.test.js` fails the build if it grows.

## Two things I want objected to if anyone disagrees

1. **The store name is `Scrivara`, not `MLS`.** "MLS" in an app store reads as Multiple Listing
   Service — it is a discoverability problem and a plausible review problem, and both stores
   will have a real-estate app on that query. The repos are already named `scrivara-*` and the
   API already lives on `scrivara-backend.onrender.com`, so the brand exists. It is one
   constant, `mobile/app.config.json` → `displayName`, and everything else derives from it.
   The website, the extension, and `phone.html` keep the MLS name; nothing else changes.

2. **The app is bundled, not a webview of mlsscribe.com.** Capacitor copies `app.html` into
   the binary as local assets and only the API is remote. A shell that points at a website is
   an App Store guideline 4.2 rejection, and it also means an outage bricks the app instead of
   degrading it. The cost is that publishing a fix needs a store release, not a git push —
   `mobile/store/RUNBOOK.md` covers that trade explicitly.

## What is NOT done, stated plainly

The apps are **built and submission-ready; they are not submitted, and no store accounts
exist.** Creating an Apple Developer account and a Google Play account requires a legal
identity, a payment method, and (for Apple) D-U-N-S verification of the practice entity — a
human with the owner's credentials has to do that, and I should not. Signing an iOS build also
needs a Mac. `mobile/store/RUNBOOK.md` is the step-by-step, and `ACCOUNTS.md` is the exact list
of what must be created and what it costs.

— phone-app lane, 2026-07-31
