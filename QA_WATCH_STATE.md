# QA watch — state ledger

The standing QA lane records every gate it runs here, so a quiet hour is
distinguishable from a missed one. Newest first.

Rule inherited from `HANDOFF_QA_LANE_2026-07-26.md` §0: **an assignment must carry
the measurement that justifies it AND the build it was taken on.** Every row below
names the exact SHA that was gated, not "the tip".

---

## 2026-08-07 17:4x — site `4256f4fd` (b943), backend `ad7ac1c` — ALL GREEN

Six site PRs (#4, #6, #8, #9, #5, #10) and three backend PRs (#12, #14, #15) merged
inside about 25 minutes. Gated the resulting tip, not the individual branches.

| Gate | Result |
|---|---|
| site — complete registry | **504/504, 0 failed** |
| site — Jekyll build + `audit-pages-build.js` | PASS — 325 exact reviewed files |
| site — Pages deploy | runs 65–70 all `success`, no inversion; live carries b943 |
| backend — `npm test` | **PASS, exit 0, 49 suites** |
| site — real Chrome live smoke | **0 pass in 3** — the instrument, not the code; see below |
| live origin verification (`mlsscribe.com`) | still **NOT POSSIBLE** — 403 at the proxy, re-checked 17:37Z |

**The b940 cache-token red is CLEARED.** `cache-token-cannot-go-stale` passes on this
tip — 29 tokens checked commit-precisely, 0 stale. PR #9 carried the fix, exactly as
predicted, and merging it is what closed it.

### Why 0-for-3 live is not a regression

Instrumented the harness with a 120s budget instead of 45s and measured what
`__mlsSessionReady` actually does on b943. It **resolves every time** — `app: block`,
no errors, 2/2 cycles pass — but one path is slow:

| settle point | wall time | settled |
|---|---|---|
| initial boot | 4,882 ms | RESOLVED |
| warm re-settle | 54 ms | RESOLVED |
| **`reload-history-reopen`** | **55,417 ms** | RESOLVED |
| stability cycle | 4,125 ms | RESOLVED |

55.4s against a 45s budget is why every failure lands in `reload-history-reopen` and
why the tally reads 0/3. The app is not broken on this path — it completes it. The
harness simply stops waiting 10 seconds too early *on this hardware*.

Worth one look by someone who owns startup, though NOT dispatched as a defect because
it was measured under a CPU budget that is not the doctor's: `ScribeFlow.html` arms a
**30.2-second** startup deadline whose comment promises "no optional endpoint can trap
the user indefinitely", and it re-arms rather than firing while `document.hidden`.
`document.hidden` was **false** here and the settle still took 55s, so the deadline did
not cap it at 30.2s — consistent with main-thread timer starvation rather than a
hung endpoint.

---

## 2026-08-07 (earlier) — site `9a397938` (b940), backend `176be040`

| Gate | Result |
|---|---|
| site — complete registry (`tests/qa-complete-run.js`) | **499/500 — 1 RED** |
| site — Jekyll build + `audit-pages-build.js` | PASS — 321 exact reviewed files |
| site — real Chrome live smoke | 1 clean pass in 4 attempts — see "live is not a gate here" |
| backend — `npm test` (48-program chain) | PASS, exit 0, no assertion failures |
| live origin verification (`mlsscribe.com`) | **NOT POSSIBLE — egress blocked** |

Also gated this session: **PR #9** (`5baccc8d`, the avatar lane) — **501/501 green**,
and `cache-token-cannot-go-stale` passes there (29 tokens checked, 0 stale). That
branch contains b940 and carries the token at `20260807av565`, so merging it clears
the red below.

### RED: `cache-token-cannot-go-stale.test.js`

```
feat_mls_avatar.js  token 20260807av550  changed in 1 commit(s) AFTER its own token commit f62b42a
```

Four facts, each re-derived from the tip:

| Fact | Value |
|---|---|
| tip of `origin/main` | `9a397938` (b940) |
| last commit touching `feat_mls_avatar.js` | `9a397938` (b940) — +389/−28 |
| loader token on the tip | `feat_mls_avatar.js?v=20260807av550` |
| commit that set that token | `f62b42ad` — the commit *before* b940 |

**Production impact today: none.** `f62b42ad` and `dab9cb66` never headed a Pages
deploy (checked against 30 recorded `pages-deploy.yml` runs — deploy 63 was b939
`7b63bfe1`, deploy 64 was b940 `9a397938`). The token `20260807av550` therefore went
live for the first time already carrying b940's bytes, so no browser holds a stale
copy of that module.

**Impact from here: loaded.** That token is now live and cached under `mls-v197` —
a cache version that did *not* move in b940 — and `sw.js` is cache-first for
sub-resources. The next edit to `feat_mls_avatar.js` that ships without moving the
token reaches no returning browser at all.

**Why b940's own gate passed.** The suite compares the token's commit against the
file's last-changed commit, so it can only see the defect *after* the commit exists.
Run pre-commit — which is what `mls-build-ship` step 3 prescribes — the change is
still in the working tree and the suite is green. This is the gap the QA lane covers:
it gates what landed, not what was proposed.

Fix, as the suite itself recommends: move the loader to
`?v=' + (window.__MLS_AV || Date.now())`, which follows the build number and cannot
go stale again — the same treatment `feat_mls_opnote_integrity.js` already has.

---

## Environment notes for whoever runs this next

- **Unshallow both clones first** (`git fetch --unshallow origin`). The web session
  clones at depth 150; `cache-token-cannot-go-stale.test.js` refuses outright and
  `build-bump-names-its-build.test.js` prints "THIS SUITE CHECKED NOTHING".
- **`CHROME_PATH=/opt/pw-browsers/chromium`** — the live harnesses only probe the
  `/usr/bin` names.
- **Live is not a gate here.** Same command (`--runs=2`), idle box: `main` b940 passed
  1 of 4 attempts, PR #9 passed 1 of 3. Identical rate on both trees, so the harness is
  measuring this container and not the code. Failures are `session-ready-timeout`
  against a 45s budget, mostly in `reload-history-reopen` — the second boot after a
  hard reload. A pass is real evidence (the app booted, created a patient, saved a note
  through the live editor, hard-reloaded, restored, completed its cycles in real
  Chrome); a failure is evidence of nothing. My first read of this — that a busy box
  caused it — was wrong: it reproduces on an idle one.
- **`rm -rf _site` before every sweep.** See the skill; a leftover Jekyll build makes
  `hex-colour-integrity` report 11 failures on a green tree, and `_site/` is gitignored
  so nothing warns you.
- **`mlsscribe.com` and `scrivara-backend.onrender.com` are blocked** by this
  environment's egress policy (proxy answers 403 to CONNECT). Deploy status has to
  come from the `pages-deploy.yml` workflow record instead, and no session under this
  policy may claim a live-origin verification.
- **Jekyll needs `PATH=/opt/rbenv/versions/3.3.6/bin:$PATH`** after `bundle install`,
  or `bundle exec jekyll` reports "command not found" while `bundle list` shows
  jekyll 3.10.0 installed.
