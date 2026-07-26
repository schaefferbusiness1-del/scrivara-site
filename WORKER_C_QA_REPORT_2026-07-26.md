# WORKER C — QA / PERF / RELEASE report, 2026-07-26

Branch `worker-c-qa`, now on top of `47bef05` (**b673**). Clone was clean at start (377 commits
behind; branched from `origin/main`, nothing stashed or discarded). **`origin/main` moved twice
under me during the session** — b671 → b672 → b673 — and
`tree-contains-everything-published.test.js` caught both; I rebased each time.
**No pushes. No build bumps. No extension work. The user's Chrome, profile and Athena
session were never touched** — every browser instance below is a separate puppeteer-launched
Chrome with its own `user-data-dir`, verified from `browser.process().spawnargs`.

---

## 0. HEADLINE — the timer assignment rested on an instrument artifact

**The four "mls-connect.js intervals" in HANDOFF_QA_LANE §2.1 are not four intervals, and
most of them are not mls-connect.js.** They are period buckets aggregated across the whole
app, and the file label is wrong because the attribution stack frame landed on
mls-connect.js's own `setInterval` shim.

Detail and evidence in §2. This does not make the 484ms measurement wrong — I reproduce it
almost exactly — it makes the *targeting* wrong.

**And the prescribed fix cannot work.** I wrote it, gated it green, measured it, found it saved
nothing, and reverted it (§2.4). A body-subtree `MutationObserver` in this app was dirty every
**685ms** (median), so a dirty-flag guard on a 1200-2000ms poller can never skip a fire. I then
fixed the two writers responsible (§2.5) — element-inserting mutation batches **29 → 2** per 20s
idle — which is both a real churn fix and the prerequisite that makes the original approach
viable for whoever takes it next.

---

## 1. E2E SUITE, LIVE — 30/30 PASS at b671

```
MLS_E2E_PUPPETEER_DIR=<scratch>/pptr MLS_E2E_REQUIRED=1 node tests/e2e/run-e2e.js
-> 30 e2e steps, 0 failed        EXIT=0
```

**Profile-safety check performed BEFORE running** (the assignment's stop condition):
`tests/e2e/run-e2e.js:187` calls `puppeteer.launch()` with **no** `userDataDir` and never
`puppeteer.connect()`. Empirically confirmed the launch arg is a throwaway temp profile:

```
--user-data-dir=C:\Users\Micha\AppData\Local\Temp\puppeteer_dev_chrome_profile-1zHiml
```

It also serves the repo itself on `localhost:8873` and drives `ScribeFlow.html?demo=1` — no
backend, no Athena, no extension, no live site. **Safe to run; it cannot reach the owner's
session.** All 30 steps passed:

boot (2), identity (2), patient bar, orders, documents, generation, freeze, consent, op-note,
intake kiosk, settings, workday walkthrough, demo calendar, switching/isolation/resume,
responsive, phone instrument A/B ×2, phone overflow ×2, phone font-size ×2, phone tap-target
×2, long-press, keyboard/dock, safe-area, add-to-home-screen, offline.

**Re-run at the end of the session on the final tree** (b673 + my two commits): **30 steps, 0
failed** again. That is the end-to-end regression evidence for §2.5 — both changed modules paint
UI the walkthrough steps exercise.

Full logs: `scratchpad/e2e-run1.txt` (b671), `scratchpad/e2e-final.txt` (b673 + both commits).

---

## 2. TIMER FLEET — measured per call site, and the target moved

### 2.1 What the handoff table actually measured

HANDOFF §2.1 reports four rows, e.g. `mls-connect.js @2000ms fires=200 211.9ms noop=200`.

My first probe pass reproduced that table almost exactly:

| handoff (b667) | my naive pass (b671) |
|---|---|
| `mls-connect.js @2000ms` fires 200 | `mls-connect.js:11860 @2000ms` fires **177**, regs **18** |
| `mls-connect.js @1200ms` fires 400 | `mls-connect.js:11860 @1200ms` fires **357**, regs **23** |
| `mls-connect.js @1500ms` fires 587 | `mls-connect.js:11860 @1500ms` fires **549**, regs **44** |
| total ~484ms / 2.42% | total **451ms** / 2.26% |

Note the single line number on every row. **`mls-connect.js:11860` is not a timer — it is the
app's own `setInterval` shim:**

```js
// mls-connect.js:11855-11861
var wrapped = function (fn) {
  var args = Array.prototype.slice.call(arguments);
  if (typeof fn === 'function') {
    args[0] = function () { try { guard(); } catch (e) {} return fn.apply(this, arguments); };
  }
  return nativeSetInterval.apply(window, args);   // <- line 11860
};
window.setInterval = wrapped;
```

Every `setInterval` in the app — from **any** file — is funnelled through this shim (there are
three such re-wrappers: ~11855, ~16420, ~33530). A hook that attributes by "first stack frame
with a URL" therefore charges **every timer in the product to mls-connect.js**, and collapses
the real call sites into one row per period.

**Fix:** skip shim frames by V8's inferred function name (`wrapped` / `wrappedClear`) and walk
to the real registration frame. Result on the identical page and window:

```
naive attribution     68 "sites",  top row regs=18..44
correct attribution  260 sites,    every row regs=1
```

**So the assignment "find those four intervals in mls-connect.js" has no referent.** There are
10 / 25 / 43 / 15 static registration sites at 2000/1200/1500/500ms in mls-connect.js alone,
and the measured cost was never theirs specifically.

### 2.2 The real ranking (3 cold runs, 20s settled idle, foregrounded)

Witness: **28-29 page-owned writes to `#ez3Clock` per 20s** in every run; `visibilityState`
`visible` throughout. Runs with a dead witness are discarded (none were).

```
run1 | witness 29 | sites 260 | fires 2850 | mainThread 744.1ms
run2 | witness 28 | sites 259 | fires 2818 | mainThread 488.2ms
run3 | witness 28 | sites 259 | fires 2823 | mainThread 533.2ms

  run1    run2    run3   site
 313.2   180.9   203.7   feat_mls_assistant_exact.js:1240 @2000ms   <- #1, and NOT mls-connect.js
 130.7    85.8    97.7   mls-connect.js:34904 @1200ms               <- #2
  20.2    14.7    16.3   feat_mls_uxpack1.js:306 @1500ms
  17.3    12.5    12.0   mls-connect.js:31088 @2000ms
  16.9    13.6    14.4   feat_mls_pullflow.js:723 @500ms
  16.3     9.8    10.2   mls-connect.js:20174 @700ms
  15.5    11.7    11.9   mls-connect.js:31624 @1100ms
  12.8     7.5    10.7   mls-connect.js:10067 @1500ms
```

Rank order is stable across all three runs. **Two sites are ~60% of the entire fleet cost**,
and the distribution below them is flat (nothing else above ~20ms/20s).

### 2.3 Both top sites are BOUNDED — this is a boot-window cost, not a forever cost

This matters for what the fix is worth, and the handoff/brief framing does not cover it.

```js
// feat_mls_assistant_exact.js:1240   — capped at 20 fires (~40s)
var t = 0; _dupFullPoll = setInterval(function () {
  killDupFull(); if (++t > 20) { clearInterval(_dupFullPoll); _dupFullPoll = null; }
}, 2000);

// mls-connect.js:34904               — capped at 40 fires (~48s)
if(!addBtn()){ var n=0; var iv=setInterval(function(){ if(addBtn()||++n>40) clearInterval(iv); }, 1200); }
```

Neither is perpetual. But each fire is expensive because both do a **full-document scan**:

- `killDupFull()` runs `document.querySelectorAll("body *")` and, per element, concatenates
  child text nodes and regex-tests it (then `getComputedStyle` + `getBoundingClientRect` on
  matches). Measured **~18-31ms per fire** — every fire is a long task by itself.
- `addBtn()` runs `document.querySelectorAll('span,div')` and reads `textContent` on each,
  looking for the "Pull today's patients" card. **~5-8ms per fire**, 40 times, and it only
  stops early if that card exists — on any other view it burns the whole budget.

So the honest value of fixing these is **~600ms and ~300ms of main-thread time in the first
40-48 seconds of a session**, delivered in dropped-frame-sized chunks, **not** a steady-state
saving. Anyone expecting an idle-CPU improvement after the first minute will not find one.

*(Caveat retained from the handoff: "no DOM mutation" is not "no work". These fires do real
work — full-document scans — they just changed nothing the user could see while idle.)*

### 2.4 The obvious fix DOES NOT WORK, and I have the failed attempt to prove it

I wrote the assigned fix — an idempotence guard on the #1 site, skipping the scan when a
body-subtree `MutationObserver` reported no change since the last pass — gated it green (335
suites), committed it, and **measured it. It did nothing:**

```
feat_mls_assistant_exact.js:1240 @2000ms
BEFORE ms:  313.2  180.9  203.7     median 203.7
AFTER  ms:  252.2  222.2  210.2     median 222.2      = NO improvement
fires 10/10 both ways, witness 28-29 both ways, visible both ways
```

**The guard never skipped a single fire.** I reverted the commit rather than ship it.

**Why — and this is the finding that matters most for the whole timer lane:**

```
A body-subtree childList MutationObserver, 20s settled idle, witness live:
  childList batches                          58
  batches inserting an ELEMENT               29
  median gap between element insertions     685 ms
  longest gap between element insertions   1207 ms
```

**A body-subtree observer in this app is never clean for as long as one second.** So a
dirty-flag guard on a 2000ms timer can never skip, by construction — the flag is re-set
between every pair of fires by something else entirely. This is the same shape as the
"frame-local counter cannot measure stability" defect already in the memory index: the guard
is reset by the thing it is supposed to be gated on.

**Consequence for the assignment: "convert each to a MutationObserver on its container or an
idempotence-guarded cheap check" cannot work for any of these sites until the ambient churn is
gone.** Any such conversion will gate green, look correct in review, and save nothing. That is
worth knowing before a lane is spent on it.

### 2.5 What I fixed instead — the churn that blocks it (2 commits)

The probe named the writers. Both are byte-identical `innerHTML` rewrites on a timer:

**(a) `feat_mls_voice_commands.js` — `paintFab()`**, called from `setInterval(tick, 1200)`.
`fab.innerHTML = micSvg(on)` where `micSvg` returns a **constant string** per `on`. It destroyed
and rebuilt an `<svg>` subtree ~50×/minute, forever — on a FAB that `mls-connect.js:32399`
retires with `#mlsVoiceFab{display:none!important}`. **Nobody could see any of it.**

**(b) `feat_mls_provider_passthrough.js` — `paintChip()`**, called from
`setInterval(mountChip, 2000)`. Rewrote byte-identical markup, and in doing so formed **half of
a re-decoration war**: `feat_docselect_merge.js` folds a "find a doctor" control *into* that chip
and is already idempotent (`if(!chip.querySelector('#mlsFindInline'))`) — but this write
destroyed those children every 2s, so the other module re-appended them every 2s, forever.

Both now repaint only when their state actually changes, and both **self-heal**: if the subtree
is missing (`!fab.firstChild` / `!chip.querySelector('.pv-name')`) they repaint regardless, so a
wipe by any other module still recovers. Neither weakens a safety net.

**Measured effect** (identical probe, 20s settled idle, foregrounded, witness live both runs):

```
                                        BEFORE      AFTER
witness writes (#ez3Clock)                  29         28     <- both runs trustworthy
childList batches                           58         30
batches inserting an ELEMENT                29          2     -93%
median gap between element inserts        685 ms    8496 ms   12x
longest gap                              1207 ms    8496 ms
```

The residual 2 insertions are `DIV.sc-src` and `SPAN.b41-sync` — status-centre rows, which per
the handoff only populate with a connected extension and live backend, so they are not
measurable here and were not touched.

**This also unblocks §2.4:** with element insertions now ~8.5s apart, a dirty-flag guard on a
2000ms timer becomes capable of skipping. I did **not** re-attempt the killDupFull guard on top
— that should be re-measured and shipped as its own change, with the caveat in §2.3 that it is a
bounded 40s cost, not a steady-state one.

**Commits (local only — the lead ships):**

```
8d2dafd  perf: the retired floating mic stops rebuilding its icon 50 times a minute
ce0fafc  perf: end the re-decoration war over the "Pulling as:" provider chip
         on top of 47bef05 (b673)
```

**Gate: 335 suites green, exit 0**, on the rebased tree containing both. One earlier gate cycle
was lost to a self-inflicted trap worth recording: my first version of the (b) comment spelled
the poller call out in prose, and `boot-script-budget.test.js:205` counts `/setInterval\s*\(/`
over **raw source, comments included** — so the ceiling went 214 → 215 and the gate failed on a
comment. Same family as the build-bump regex matching inside a hex colour.

---

## 3. BOOT PERF PROFILE — live, `?preview=1`, 3 cold runs

Own Chrome, **fresh profile per run**, `setCacheEnabled(false)` + service-worker bypass.
Cache was defeated that way and **never with a URL cache-buster** — the preview gate must be
exactly `?preview=1`, and `&nc=` breaks it. Median of 3:

```
domInteractive        325 ms       (b569 baseline 293)      +32
load                 1720 ms       (b569 baseline 3598)   -1878   -52%
scriptWallSpan       1698 ms       (b569 "script" 2919)   -1221
domContentLoaded      533 ms
responseEnd           170 ms
scripts               216  (2471 KB)        resources 222
```

**Boot is materially faster than the b569 baseline** — `load` roughly halved. `domInteractive`
is flat within run-to-run noise (281 / 325 / 597 across the three runs; the 597 is the first,
coldest run).

**Methodology caveat, stated rather than glossed:** I could not find the b569 script that
produced "script 2919", so I do not know it measured the same thing as my `scriptWallSpan`
(first script start → last script `responseEnd`). Treat the `domInteractive` and `load`
comparisons as sound — they are plain navigation-timing fields — and the script line as
indicative only.

**The real finding is not in the baseline comparison. It is blocking time:**

```
long tasks               4
total long-task time  2059 ms
longest single task   1631 ms       <- one task blocks the main thread for 1.6s
Total Blocking Time   1859 ms
```

Four tasks, one of them **1.6 seconds**. `domInteractive` at 325ms says the document parsed
quickly; TBT at ~1.9s says the page is *unresponsive* well after that. This is consistent with
the existing memory entries ("login is slow" is not login — 177 cached scripts serialise; boot's
TBT is the patients screen, not the loader) and it is where any further boot work should go.

**I did not touch the boot path** — per instruction it is the highest-blast-radius code in the
product and needs lead approval. This section is measurement only.

---

## 4. RELEASE VERIFICATION — clean state, run at b671, b672 AND b673

Own Chrome, a **fresh** `user-data-dir` created and deleted per run
(`...\mls-qa-clean-*`), no extensions, service worker bypassed. Verified on the **running
page**, never a curl — six builds have shipped and never reached a browser behind a frozen
`?v=` and a cache-first service worker.

| check | b671 | b672 | b673 |
|---|---|---|---|
| `curl app-version.json` | b671 | b672 | b673 |
| `__MLS_AV` on the running page | **b671** | **b672** | **b673** |
| `sfArmGateWatchdog` in running document | 3 | 3 | 3 |
| sign-in screen renders (`#authScreen`) | flex 1280×850 | flex 1280×850 | flex 1280×850 |
| `#authEmail` + `#authPass` | 330×46 | 330×46 | 330×46 |
| loading gate stuck up | none | none | none |
| page errors / failed requests | 0 / 0 | 0 / 0 | 0 / 0 |
| HTTP / domcontentloaded | 200 / 524ms | 200 / 1000ms | 200 / 472ms |

**The b671 watchdog survived both subsequent ships** — `sfArmGateWatchdog` is still served at
b673. That is the thing most worth re-checking after each build, since its failure mode is a
loading screen that never ends.

`swControlled:false` and `mls-connect.js script tags: []` are **expected** on a first clean
load: the app's script bundle is behind the auth gate, and no service worker is registered yet
on a virgin profile. **No sign-in was attempted** — entering credentials on the live site is a
hard stop, so "the app works past auth" is NOT verified here and should not be read into it.

Logs: `scratchpad/live-b671.txt`, `live-b672.txt`, `live-b673.txt`.

---

## 5. E2E REGISTRATION IN run-all.js — proposal, NOT applied

**Why it is invisible today.** `tests/run-all.js:345` discovers with
`fs.readdirSync(__dirname).filter(n => n.endsWith('.test.js'))` — non-recursive, and only
`*.test.js`. `tests/e2e/run-e2e.js` matches neither, so it is invisible to *both* the runner and
the registry-completeness check. That is precisely how it stayed unrun for 30+ builds while the
registry gate reported success.

**Proposed shape** (append after the sequential loop, before the final `PASS all N` line):

```js
/* Browser-dependent, ~2-3 min, so it is opt-in. MLS_E2E_REQUIRED=1 is NOT optional
   here: run-e2e.js exits 0 when Chrome or puppeteer-core is missing, so opting IN and
   then silently skipping would reproduce the exact defect that hid it for 30+ builds. */
if (String(process.env.MLS_E2E || '') === '1') {
  const r = spawnSync(process.execPath, [path.join(__dirname, 'e2e', 'run-e2e.js')],
    { stdio: 'inherit', env: { ...process.env, MLS_E2E_REQUIRED: '1' } });
  if (r.status !== 0) process.exit(r.status || 1);
}
```

**Do NOT add it to the `tests` array** — that array is cross-checked against `*.test.js`
discovery, so a non-`.test.js` entry makes `stale` non-empty and takes the gate red.

**The ~10-green-builds criterion, honestly assessed: it is at 2, not 10.**

| green run | build | source |
|---|---|---|
| 1 | b670 | handoff §1 (previous lane) |
| 2 | b671 | this session, §1 above |

Two greens, on **one machine**, **one Chrome** (151.0.7922.48), **one OS**. That is not enough
to know whether it is flaky. **My recommendation is to NOT register it yet** and instead run it
manually on each of the next several builds until the count is real. Registering early risks
exactly the outcome the gate-authoring rule in the handoff warns about — a test that cries wolf
trains the next person to delete it.

One further cost worth naming: the runner hard-codes two Windows Chrome paths
(`run-e2e.js:49-52`). On any machine without Chrome there, `MLS_E2E=1` + `MLS_E2E_REQUIRED=1`
turns an environment gap into a red gate. The env-gated shape above contains that, but whoever
turns it on in CI owns provisioning Chrome.

---

## 6. OPEN RISKS

**Nothing here blocks release.** b671 and b672 both verified clean-state and green.

1. **`main` moved under me mid-session** (b671 → b672 while my first gate ran).
   `tree-contains-everything-published.test.js` caught it correctly and I rebased. My branch is
   `worker-c-qa` on top of `3c89638` (b672). **Re-check before the lead ships** — it may have
   moved again.
2. **The timer-fleet brief and handoff §2.1 should be corrected** so the next lane does not
   inherit the shim artifact (§2.1 here). As written they point at "four mls-connect.js
   intervals" that do not exist, and any lane that accepts that framing will spend itself on the
   wrong file. This is the same failure mode §0 of the handoff was written to prevent.
3. **The killDupFull guard is still unfixed** and is now *newly* worth attempting, since §2.5
   removed the churn that defeated it. It must be re-measured, not assumed — my first attempt
   gated green and did nothing.
4. **`feat_mls_assistant_exact.js`'s duplicate-badge safety net cannot be behaviourally verified
   without the extension installed** (the badge only exists with a connected extension). I
   therefore did not rewrite its scan algorithm, only investigated it. Anyone who does should
   verify with the extension present, not headlessly.
5. **`#mlsVoiceFab` is dead weight.** It is `display:none!important`
   (mls-connect.js:32399 — "floating mic retired, folded into the one chat") yet
   `feat_mls_voice_commands.js` still builds it, positions it on every resize, and ticks it every
   1200ms. §2.5 stops the churn, but the honest fix is to stop creating it. Out of scope here
   because it owns the speech-recognition lifecycle, which needs a real-microphone test.
6. **The poller ceiling counts prose.** `boot-script-budget.test.js:205` matches
   `/setInterval\s*\(/` over raw source, so *mentioning* the call in a comment fails the gate. It
   cost me one full gate cycle. Same family as the hex-colour build-bump defect already in the
   memory index. A word-boundary/comment-stripping pass would make it honest; I did not change
   it (out of scope, and it is doing its job).

---

## 7. WHAT I RAN, AND WHERE THE EVIDENCE IS

All under `<scratchpad>/`:

| file | what |
|---|---|
| `e2e-run1.txt` | 30/30 E2E, full output |
| `probe-timer-sites.js` | per-call-site timer attribution (shim-aware) |
| `timers-before.txt`, `timers-run2/3.txt` | 3 before runs |
| `timers-after1-run1/2/3.txt` | 3 runs proving the assigned fix did nothing |
| `probe-observer-dirty.js` | can a body-subtree observer ever be clean |
| `observer-dirty.txt` / `observer-dirty-after.txt` | 29 → 2 element-inserting batches |
| `probe-live-b671.js`, `live-b671.txt`, `live-b672.txt` | clean-state release verification |
| `probe-perf.js`, `perf-*.txt` | boot perf profile |
| `gate-baseline.txt`, `gate-fix1b.txt`, `gate-churn2.txt` | full gate output, never piped |

**Instrument traps I hit, for the next lane** (all cost real time today):

1. **A forward-slash `ROOT` vs `path.join` backslashes made every request 403**, and the page
   rendered Chrome's neterror — which looks *exactly* like "the app failed to boot". I nearly
   diagnosed the app. An A/B against a no-hook control found it in one run.
2. **`#ez3Clock` renders `fmtClock()` = `H:MM AM` — MINUTE granularity.** Checking *distinct
   rendered values* over a 20s window reports "1 distinct value" on a perfectly live page,
   identical to a throttled tab. **Count page-owned WRITES to the node, not its values.** The
   handoff's "clock 29 ticks" is a write count; read it that way.
3. **Every `setInterval` in the app is funnelled through mls-connect.js's own shim**, so
   stack-based attribution charges the whole product to one file and one line. Skip shim frames
   by inferred function name (§2.1).
4. **A textual gate can be failed by a comment** (§6.6).
