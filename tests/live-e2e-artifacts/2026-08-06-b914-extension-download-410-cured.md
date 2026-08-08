# 2026-08-06 — b914 → b919: the extension download 410 cured, and the Settings card stops lying

## ⚠️ ADDENDUM — b914 WAS NOT ENOUGH. The real cure is **b919 `f58c0382`** (gate PASS all 492).

b914 published the `.bin` mirror correctly and it was reachable — **and the download still failed on
every browser.** The mdx refresher in `mls-connect.js` rewrote `#extDlBtn`'s href to
`MLS_Assist_v<ver>.zip` **UNCONDITIONALLY on every load**, so the baked `.bin` never survived to the
DOM. Not a caching problem: **fresh browsers and returning ones alike.**

The diagnosis took two passes and both were instructive. QA measured the owner's browser three times
and read it as a **stale shell** — a sound inference from `.bin` being absent from his DOM. The code
said otherwise, and they then independently confirmed the correction: served `ScribeFlow.html`
contains `.bin`, his `__MLS_AV` is current, and his served `mls-connect.js` is byte-identical to the
origin while carrying the offending line. **An absence produced by a rewrite is indistinguishable
from an absence produced by staleness, at the end state.**

**b919 normalises instead of clobbering:** href → the `.bin` mirror, `download` kept as the `.zip`
filename so the doctor still saves a zip, any `target` stripped (a navigation is exactly what a stale
worker answers with 410). Inert where already correct — which is the second defect it repairs, since
the old line overwrote the baked `.bin` on fresh browsers too. My card pin never caught it because it
read baked HTML and never executed the refresher.

**Test:** the SHIPPED normalisation executed against three anchor states (the owner's stale-href
markup, the hijacker's Web-Store + `target=_blank` shape, an already-correct anchor that must survive
untouched) plus a **negative control** running b914's unconditional rewrite and asserting it cannot
produce the mirror.

**Live verification on b919:** mirror 200 / 419,620 bytes / sha256 identical to the released zip;
baked `#extDlBtn` `.bin` + `download="…zip"` + no `target`; old unconditional rewrite gone.

**🚨 A VERIFICATION TRAP I CREATED — do not repeat it.** I asked QA to confirm the fix by searching
the served `mls-connect.js` for the literal `MLS_Assist_v3.0.45.bin`. **That returns ZERO while the
fix is present**, because the filename is concatenated at runtime (`'MLS_Assist_v' + v + '.bin'`).
A literal search cannot see a value that is built — the concatenated-CSS rule, one substrate over.
**When the value is assembled, verify BEHAVIOUR (the DOM href, the fetched byte count), never source
strings.**

**Also carried in b919:** b916 shipped `.cw-live-card{border-radius:12px}`, off the 10/16/22/999
scale, which took main RED for every lane (verified on a clean checkout of origin/main with zero
changes of mine). Snapped to `var(--r-card)` — the semantic token for a card whose inner `.cw-sum`
strip is 10px. The widget lane may prefer `--r-ctl`; that is one token and their call.

---

## (original b914 record follows)

**Shipped:** b914 `02f33b75d46b02bcf33c559ecd4f980fe4d75a46`, gate **PASS all 490**, live-verified on
the origin (measured, not inferred):

```
app-version.json           : 2026-07-25-b914
MLS_Assist_v3.0.45.bin     : 200, 419,620 bytes
  sha256                   : cdd6d083902a0fc583a6f723b415cc1cdb6a01540840c677a4eddb2c32806273
  identical to the .zip    : TRUE          (404 before the deploy, 200 after — a real before/after)
sw.js                      : RELEASED_PACKAGE_FLOOR present; zip branch is
                             `if (/\.zip$/.test(name)) return !isPublicReleasePackage(pathname);`
#extDlBtn                  : href=".bin" download="MLS_Assist_v3.0.45.zip", NO target=
served HTML "Add to Chrome": 0
```

## The defect, as measured by the QA lane (not theorised)

`curl` returned **200**; a page-context GET in the owner's real browser returned **410** with the
body *"This retired, package-only, or unsafe query route is not a public MLS page."* The split is
the whole diagnosis: the refusal came from the service worker, not the server.

`sw.js isRetiredPath()` allowlisted **one hardcoded filename** and retired every other `.zip`. A
worker keeps controlling a page until every tab closes, and this worker **deliberately declines
`skipWaiting()`** ("taking over an active clinical tab can trigger controllerchange reload
behavior"). So at EVERY release the worker already installed in a doctor's browser carried the
PREVIOUS release's literal and 410'd the new package. Confirmed by the fingerprint:

```
/MLS_Assist_v3.0.45.zip -> 410   (current release, blocked)
/MLS_Assist_v3.0.44.zip -> 404   (passthrough — the stale worker's literal)
getRegistration()       -> active + waiting; the worker did NOT roll across THREE production deploys
```

**That last line is the load-bearing measurement.** It proves shipping new `sw.js` bytes cannot fix
an already-broken browser, which is why a mirror was necessary and why "just fix the worker" was
never sufficient.

## The fix — three parts, each with an executed negative control

1. **Version FLOOR + root-only check** replaces the literal, so no per-release edit exists to forget
   and no future worker generation can retire the current package. Verified fail-closed by
   execution: historical archives, unrelated zips, and a released-looking name under
   `extension-candidates/` all still refuse. **Control:** the old rule, reconstructed as a
   one-release-behind worker, blocks today's package — reproducing the live 410.
   *Rejected designs, deliberately:* a bare family regex (re-opens 60+ historical archives and every
   candidate) and a runtime `extension-version.json` fetch (puts a network call inside the fetch
   decision and must then pick a failure direction).
2. **`MLS_Assist_v3.0.45.bin`** — byte-identical mirror, digest-asserted EQUAL to the zip in the
   boundary suite, linked `download="MLS_Assist_v3.0.45.zip"` so the doctor still saves a zip.
   **Control:** the mirror passes an OLD one-literal worker where the current zip does not — that is
   the entire reason it exists. `.bin` not `.pkg` (macOS installer type; the URL extension feeds
   Chrome/Safe-Browsing classification even when the saved name is `.zip`).
3. **The card stops lying.** FIVE writers contend for that one Settings card. `__mlsExtDownloadSync`
   had captured the baked card by TEXT match — it was written for a different anchor further down the
   page, and the new card landed ABOVE it — then rewrote it into three falsehoods: an
   "Add to Chrome — Chrome Web Store" label over a local href (that publish is owner-gated and NOT
   done), `removeAttribute('download')` + `target="_blank"` turning the click into a NAVIGATION in a
   new tab (precisely the request the stale worker 410s, so the doctor met a refusal page in a tab
   they never opened), and deletion of `#extDlVersion`. It now stands down wherever
   `#extensionDownloadSettings` exists. **Control:** all three card assertions fail against the
   pre-fix markup.

Bridge-vs-echo question settled while in there: `#mlsExtVerLiveRow` is a REAL bridge read —
`content.js:155` answers `mlsPing` with `chrome.runtime.getManifest().version` from inside the
extension's own process, compared against a separately fetched manifest, with three falsifying
branches. It is the one honest element on that card and must not be deleted.

## Also shipped: the forward-deploy guard

QA measured every successful Pages run that day: **13 deploys, 3 inversions (23%)**. `app-version.json`
went BACKWARDS twice; one inversion reverted another lane's `appControl` fix **51 seconds** after it
landed; every run reported success.

`scripts/assert-forward-deploy.js` runs in the **DEPLOY job before `actions/deploy-pages`** — the
placement matters and QA's original proposal (the build job) would not have caught any of the three,
because an inversion is a queued OLDER run reaching deploy after a newer one published. Only
inversions are blocked; an EQUAL number passes so the empty-commit retrigger recovery still works;
it fails OPEN with a loud note on an unreadable version, and it fetches from the runner because a
service worker can serve a stale `app-version.json` to a browser. Tests replay all three real pairs.

## Traps recorded

- **A comment describing a defect trips a grep hunting that defect.** My served-bytes check for the
  old one-literal rule returned 1 match against my own explanatory comment. The suite's regex
  required a real version and correctly did not match. Check context before reporting a regression.
- **Run `build-bump-names-its-build` AFTER the bump commit exists, before pushing.** Another lane
  discovered that gating BEFORE the bump moves the bump commit outside that suite's range, so it
  passes vacuously — that is how b911 shipped labelled b910. Mine reported "12 commits, 3 bumps",
  i.e. it actually looked. Subject taken from `scripts/.last-bump-subject` by machine, never retyped.
- **PowerShell has no heredoc**; `git commit -F -` with `<<'EOF'` is a parser error. Read the subject
  file into a variable and pass `-m`.
- Deploys were racing all evening: origin moved 5 times during one ship and 7 during the next.
  Commit BEFORE gating — an uncommitted fix is one `git checkout` away from never having existed.

## Still open after b914

1. `tests/cache-token-cannot-go-stale.test.js` compares DATES, so a file changed the SAME DAY its
   token was bumped is invisible — that hid a missing `|| a.kind === 'appControl'` guard on the
   owner's machine. Cure: commit-precise, base = later of (commit that introduced the token literal)
   and SEED `ffca4c9f`; **the naive form reports 25 false positives** because the b844 parentless
   squash re-added every file. 150 loaders still ride hand-maintained literals — QA and the copilot
   lane both judge this wants ONE dedicated lane with the others warned.
2. `providerKey("Anh Do")` returns `""` (both tokens stripped as credential noise, fewer than two
   survive), so a two-token credential-surname clinician fails at `provider-unverified` and never
   could pull. Pre-existing, consumed by every matching surface — own change, own review.
3. `b912` was pushed on top of a RED main: at least one ship path is not running run-all.
4. **Matt's provider cure is live in b908 but UNPROVEN on his machine.** Only his own pull receipt
   settles it; it now names the arm via `canonicalNameFallbackBasis` / `rosterSameNameCount` /
   `sameNameConflictKinds`.
