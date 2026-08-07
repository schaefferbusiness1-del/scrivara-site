---
name: mls-qa-watch
description: Test new code that landed on GitHub for the MLS site/backend and route every defect back to the lane that caused it. Use when acting as the standing QA watcher, when checking whether a commit or PR is safe, or when asked "is what just shipped actually working".
---

# QA watch — test what LANDED, not what was proposed

This lane's job: every commit and PR reaching `schaefferbusiness1-del/scrivara-site`
and `schaefferbusiness1-del/scrivara-backend` gets gated, and every defect goes back
to the lane that caused it with the measurement and the build attached.

Inherit the QA rule this project already earned (`HANDOFF_QA_LANE_2026-07-26.md` §0):
**an assignment must carry the measurement that justifies it AND the build it was
taken on**, and **re-derive state from the tip before acting** — a defect fixed 20
minutes ago still reads as live in a stale worktree.

## 0. Container setup — two traps that fake a result

**UNSHALLOW FIRST.** The web session clones shallow (150 commits). Two registry
suites are history-aware and *fail on the clone, not on the code*:
`cache-token-cannot-go-stale.test.js` refuses on a missing seed commit, and
`build-bump-names-its-build.test.js` prints "THIS SUITE CHECKED NOTHING" — a green
tick standing in for an unrun gate. This is the same trap `pages-publication-audit.yml`
documents with `fetch-depth: 0`.

```bash
git fetch --unshallow origin      # ~2640 commits; do this in BOTH repos
```

**Chrome lives at `/opt/pw-browsers/chromium`,** not `/usr/bin/chromium`. The live
harnesses probe only the `/usr/bin` names and will report "Chrome was not found":

```bash
export CHROME_PATH=/opt/pw-browsers/chromium
```

They already pass `--no-sandbox` and `--headless=new` on Linux, so no other flag is needed.

## 1. Gate a candidate

```bash
git fetch origin <ref> && git checkout -q FETCH_HEAD   # test the exact bytes that landed
node tests/qa-complete-run.js                          # EVERY suite, EVERY failure
```

Use `qa-complete-run.js`, not `npm test`, when diagnosing. `run-all.js` is fail-fast:
on b940 a red suite at registry position 90 stopped the run and the 411 behind it
never executed. Fail-fast is the right *ship* gate; it is the wrong *diagnostic*.
Report `npm test`'s verdict, but hunt with the complete run.

Then the publication boundary, which is what GitHub Pages will actually serve:

```bash
bundle exec jekyll build && node scripts/audit-pages-build.js --site-dir=_site
```

Live browser suites (real Chrome, local server, `?demo=1`, synthetic fixtures only —
they never touch a real Athena page or production backend):

```bash
CHROME_PATH=/opt/pw-browsers/chromium npm run test:live-synthetic -- --runs=3
CHROME_PATH=/opt/pw-browsers/chromium npm run test:live-visible-controls
CHROME_PATH=/opt/pw-browsers/chromium npm run test:live-a11y-responsive
```

Backend: `cd ../scrivara-backend && npm ci && npm test`.

## 2. Verify what actually deployed

**`mlsscribe.com` and `scrivara-backend.onrender.com` are BLOCKED by this
environment's egress policy** — the proxy answers 403 to CONNECT, and the README
is explicit that policy denials must be reported, not routed around. So a web
session **cannot** curl `app-version.json` the way `mls-build-ship` step 5 does.

What you can do instead — the authoritative deploy record, via the GitHub API:

- `actions_list` / `list_workflow_runs` on `pages-deploy.yml` → conclusion + `head_sha`
- a `success` conclusion means the artifact passed `audit-pages-build.js` AND the
  `assert-forward-deploy.js` inversion guard, then published

Note the deploy history is itself evidence: on 2026-08-06 thirteen deploys produced
three publication inversions (23%), which is why the forward-deploy guard exists in
the deploy job rather than the build job.

**Say which one you did.** "The deploy workflow reports success for b940" is true;
"b940 is live and working" is not something a blocked session can claim. To get real
origin verification, the environment's network policy has to allow those two hosts.

## 3. Cache tokens — the defect class this project keeps re-growing

`mls-connect.js` lazily loads `feat_*.js` modules with a hand-typed token:
`feat_mls_avatar.js?v=20260807av550`. If the file changes and the token does not,
the service worker (cache-first, `mls-vNNN`) serves a returning browser the OLD
module forever — the change ships and never reaches the doctor.

`cache-token-cannot-go-stale.test.js` catches it, **but only after the commit
exists**: it compares the token's commit against the file's last-changed commit. Run
pre-commit, the change is still in the working tree and the suite passes. That is
why this lane tests the tip *after* it lands — b940 shipped green under its own
pre-commit gate and turned the tip red.

The durable fix the suite itself recommends: `?v=' + (window.__MLS_AV || Date.now())`,
which follows the build number and cannot go stale.

## 4. Route the defect

- **Landed in a PR** → comment on that PR. That wakes the lane holding it.
- **Pushed straight to `main`** (the owner's normal path — `git push origin HEAD:main`)
  → open an issue; there is no PR to wake.
- Include: the failing suite, its verbatim assertion, the commit that introduced it,
  and the exact repro command. Never a paraphrase — this project has burned lanes on
  assignments whose evidence had already gone stale.
- State production impact separately from gate status, and do not inflate either.
  A red gate with no live consequence is still red and still blocks the next lane;
  a token that never deployed independently has not yet reached a single browser.

## 5. Watch

Direct pushes to `main` produce no PR event, so polling is not optional — an
hourly trigger firing into the QA session is what covers the owner's actual
shipping path. `subscribe_pr_activity` covers the PR lanes on top of that.
Checkpoint the last-gated SHA per repo so a quiet hour is distinguishable from a
missed one.
