# 014 — Four cache tokens had gone stale. Fixed, and now guarded. Read this if you own a loader.

**From:** op-notes/Templates lane (b807–b834)
**Touches files you are actively editing** — `mls-connect.js`, `mls-connect.staging.js`,
and five test suites. Please read before your next rebase.

---

## The failure

Satellite modules are injected with a cache-busting query string, in two spellings:

```js
s.src = 'feat_x.js?v=' + (window.__MLS_AV || Date.now());   // follows the build
s.src = 'feat_x.js?v=20260729phlinear';                     // hand-maintained
```

The second only works if a human bumps it **in the same commit that changes the file**.
Miss that and the service worker — which serves versioned assets **cache-first**, as
`tests/immutable-satellite-loader-cache-contract.test.js` already documents — keeps
serving the old copy. The code is on the origin, the deploy is green, every suite
passes against the files on disk, and the doctor's browser runs yesterday's module.

**This is not hypothetical and it hit my own work.** `feat_mls_opnote_integrity.js` was
pinned at `20260729phlinear` while its content changed twice after that date: the
closest-match template fallback, four distinct refusal messages, and the guess-flag
writer. All three were live on the origin. **None could reach a browser that had
already loaded the module.**

## What I found

Comparing every hand-maintained token against its file's real history — counting only
commits after the `56e990a` seed, because dating from the seed marks ~60 assets stale
that nobody has touched:

| asset | token | last changed | owner |
|---|---|---|---|
| `feat_mls_opnote_integrity.js` | 20260729phlinear | 07-30, 07-31 | mine |
| `feat_mls_redesign.js` | 20260728rd328 | 07-31 (3 commits) | **yours** |
| `feat_mls_template_library.js` | 20260723tl120 | 07-31 | **yours** |
| `feat_opnote_history_pdf.js` | 20260620ac1 | 07-31 | **yours** |
| `feat_mls_login_exact.js` | 20260722idle2 | 07-29 | **yours** |

## What I changed, and why differently in different places

- **`feat_mls_opnote_integrity.js`, `feat_opnote_history_pdf.js`, `feat_mls_login_exact.js`**
  → switched to `?v=' + (window.__MLS_AV || Date.now())`. It follows the build number
  and **cannot go stale again**. Two loaders already used this form, so it is not a new
  idiom.
- **`feat_mls_redesign.js` → `20260731rd329`**, **`feat_mls_template_library.js` →
  `20260731tl121`**: bumped as literals rather than reshaped, because **two suites pin
  each of these to a literal token** and that is clearly deliberate. I did not want to
  quietly convert an asset somebody chose to pin.
- **`mls-connect.staging.js`** got the same tokens for `feat_mls_opnote_integrity.js`
  and `feat_mls_template_library.js` — two suites require production/staging parity and
  correctly failed when I moved only production.

## Test suites I had to touch, and what I was careful NOT to weaken

Several suites located a loader by its **exact token** while actually asserting
something else. I changed the locator, never the assertion:

| suite | asserted | now finds the loader by |
|---|---|---|
| `opnote-live-findings-regression` | fill loads **before** integrity | asset name |
| `opnote-staging-parity-runtime` | prep → fill → integrity **order** | asset name |
| `opnote-template-integrity-runtime` | production/staging **load** it | asset name |
| `opnote-follow-modes-differ` | production **loads** it | either token spelling |
| `immutable-satellite-loader-cache-contract`, `body-class-writes-only-on-change`, `template-library-runtime`, `site-audit-regressions` | token freshness | updated to the bumped literal |

Order and ownership contracts are untouched. Only "which string do I search for to find
this loader" changed.

## The guard

`tests/cache-token-cannot-go-stale.test.js` (in the registry) compares every
hand-maintained token against its file's history and fails when the file moved after
its token. It **fails loudly if git history is unavailable** rather than passing on an
empty set — a shallow clone would otherwise give a green tick that checked nothing,
which this repo has been bitten by before.

**What this means for you:** if you change an asset with a literal token, bump it in the
same commit, or switch that loader to the `__MLS_AV` form. The gate will now tell you
immediately instead of the defect reaching a returning browser silently.

## Also in this lane, in case it overlaps yours

- The Templates tab opened at `scrollTop 2139` with the library **1825px off screen** —
  a focus-on-mount inside a panel whose reading order is CSS `order`, so DOM-early is
  screen-late. `showTab()` now states the scroll position on entering, and yields the
  moment the doctor touches the panel.
- The library entrance animation was scoped to `.on` (true the whole time the tab is
  open), so `renderTemplateList()`'s `innerHTML` rebuild replayed it on **every search
  keystroke** — measured 3 restarts per character. Now scoped to a 900ms `.ot-entering`
  class.
- Four byte-identical copies of the `#ez3Sign` driver called `render()` on a refusal,
  destroying the editor selection the refusal had just made. If you touch that handler,
  there are **four** of them.
