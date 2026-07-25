# Handoff — the three open defects

**As of live build b569, extension 3.0.6, gate 286/286.**
Everything below was measured, not inferred. Where a claim is unverified it says so.

Green at handoff time, so you know what NOT to re-investigate:

| check | result |
|---|---|
| site | HTTP 200 on `/`, `ScribeFlow.html`, `index.html`, `get-extension.html` |
| build | `2026-07-24-b569` |
| gate | **286/286** local regression suites |
| extension | 3.0.6 published; installed = published, **8/8 core files byte-identical**, digest verified, pong-confirmed |
| backend | `scrivara-backend.onrender.com/api/health` → 200, `ok:true`, all capabilities true, `clinicalUse: ready` |
| save row-loss | FIXED and proven live (pts-rowguard + sv-1.1.0) |
| OFF-mode pull | 5/5 schedule, 5/5 history, 0 failures, **~9.8s/patient** vs the 10s target |

> ⚠️ **Backend host trap.** `mlsscribe.com/api/health` and `mls-backend-3rrq.onrender.com` are both dead and mean nothing. The real host is **`scrivara-backend.onrender.com`**. I nearly filed a false outage on this.

---

## Defect 1 — ON mode: the reader rejects the correct chart frame

**Symptom.** With Full visit notes ON, patients come back `no-chart-frame-candidate` or `visit-bodies-incomplete`. `coverageComplete: 0`. Nothing saved. Burns 93–160s per patient first.

**Root cause (confirmed).** The visits reader does **not** fail at frame *selection*. It fails at frame *qualification*: the `enumerate` op runs inside the correct chart frame and returns not-ok.

Receipt from ext 3.0.12, per failing patient:

```
enum=0-,532-,535-,530-,526-,527-,531-,538-,534-,528+,529-,536-
```

Twelve frames answer `enumerate`. Injection reaches all of them, nested included. **Exactly one returns ok — `528`, which is `coordinator/enterprise/stm.esp`, the doctor's inbox.**

Meanwhile the real chart frame is sitting there fully loaded:

```
/1/2/2  name=frMain  .../ax/briefing/7772864#chart?section=visits/qualityPane?isCollapsed=
        li.encounter-list-item  ->  22 rows
        ul.encounter-list.accordion-container  present
```

A page-side sampler at 1.5s cadence caught it **40/40 ticks over 70 seconds during a live pull** — present every tick, same index, same URL, 22 rows throughout.

**Ruled out by measurement, do not re-open:**

| theory | killed by |
|---|---|
| broken chart opener | experiment |
| multiple Athena tabs | experiment |
| 4-candidate cap | raised to 16, no change |
| noise-frame ranking vs exclusion | only ONE candidate is ever offered — nothing to rank |
| charts in use by the live clinic | DOM shows the chart open with 22 rows |
| frame rebuild/teardown race | 40/40 stable samples |
| sandboxing / host permissions | frame is same-origin and scriptable from the top |

**Lead (untested).** frMain's URL carries `?section=visits/qualityPane?isCollapsed=`. A 3.0.2-era guard inside the enumerate op exists to reject the chart *landing* pane (1–2 encounters, same row markup, hydrates first). The 2026-07-21 athenaOne flip made the Visits panel collapsible/progressive, so that guard may now be rejecting the genuine 22-row panel because completeness is declared differently when collapsed. Would also explain why 2 of 5 patients succeed each run — pane state, not luck.

**Where the fix goes.** `background.js`, the `enumerate` op (`if (op === 'enumerate')`, ~line 8586). NOT the candidate walk — that part is now correct.

**How to verify.** `coverageComplete` **above zero on real patients**. Accepting the frame is necessary, not sufficient. This distinction is the one I got wrong; do not repeat it.

**Also do, independent of this bug (safety item).** A noise surface can currently satisfy `ok && count && indexComplete`, which is how stm.esp gets believed. That means the reader can hold what it thinks is a complete index of a patient's encounters while looking at the doctor's inbox. Exclude noise surfaces when *building* enumerate candidates, not only in the walk. Write it so nobody deletes it as redundant once the enumerate fix lands — it stands on its own terms.

**Branch.** `agent/ext-3.0.10-on-mode` carries 3.0.6→3.0.12 with the full arc. **Not published, deliberately** — root extension bytes are byte-verified against the published zip by the extension-package gate, so unproven source cannot land on main.

---

## Defect 2 — Boot: 26s before the app is usable

**Symptom.** Owner: *"IT TOOK WEAY TO LONG TO LOGUIN LIKE HAST SHOULD BE FAST"*.

**It is not login.** The page is interactive in **164ms**. The delay is everything after.

**Measured three ways:**

```
152 feature scripts (feat_mls_*.js)
ALL 152 served through the service worker
151 of 152 from cache (transferSize 0)
average network wait: 4ms
all 152 requested inside the same 1-second window
cold ~80s · warm ~26s
```

**Root cause.** Not the network, not the server, not the cache, not auth — every file is already local and arrives in 4ms. The cost is 152 separate cached scripts requested at once, each round-tripping the service worker, then parsed and executed **serially on the main thread**. The browser is queued behind itself.

**Where the fix goes.** ~~Bundle the feature scripts, or defer everything the first screen doesn't need.~~ Highest blast radius in the product — full gate plus live-tab verification, no blind change.

> 🛑 **SUPERSEDED AT b596 — DO NOT BUNDLE. Read `HANDOFF_2026-07-25_THREE_DEFECTS_RESULT.md` before touching the boot path.**
>
> The recommendation above is wrong, and it was measured wrong rather than argued wrong. Re-fetching the SAME 205 cached assets through the SAME service worker on the SAME running page with the main thread **idle**: 150 in parallel = 124ms total (0.83ms/request); sequential = 3.11ms/request; projected for 205 ≈ **170ms**. At boot those identical requests span 9,543ms with a 5,659ms median queue — **56×**.
>
> So the transfer is ~170ms of ~9,500ms. **Bundling 205 → 1 buys ~2%**, and the bundle still executes the same code on the same thread. The queue time is a *symptom* of main-thread contention, not a cause, and the 0-byte/2-second signature that reads as serialization is scripts waiting on a busy thread, not paying for transfer.
>
> What is actually left is the **work each of 234 modules does at boot over a real store** — 1,481 patients, 2,166 visits, 471KB, 1.74MB localStorage, 8,154 DOM nodes. `getPatients()` is memoized (0.1ms first call, 0ms after), so it is not repeated store parsing.

> ⚠️ **The boot budget test I added measures BUNDLING ONLY.** It counts unique `feat_mls_*.js` names in `mls-connect.js`. If you defer instead of bundling, every name stays, the count stays 164, and it reports zero progress on a change that could halve boot time. The floor would never trip either. Extend it with a second measurement — *scripts requested before first paint* — which is what deferral actually moves.
>
> **Also corrected at b596:** that regex matched **164 of 234** scripts — it missed the entire `feat_athena_*` family (24), plus `feat_visit*`, `feat_opnote_*`, `feat_autosave`, `feat_save_verify`, `feat_task3_*`. A ceiling with a 30% blind spot could not do the job the file claimed. Now widened, with a second arm counting eagerly-inserted scripts.

---

## Defect 3 — The right-now bar welds labels together

**Symptom.** Owner: *"i ahte this patient banner like wtf is this its aweful"* — the bar rendered `Start Recording — Atoussa Salimi7:30 AM · DOB 11/05/1968`. Surname collided with the time. It reads as a typo **in the patient's name**, which on a clinical screen is the worst possible place for one.

**Status: half fixed at b569.** The identity collision is gone (idc-1.0.0 moved identity out of the button). **The underlying mechanism is not fixed**, and a sibling button still ships mangled — verified on the rendered page at b569:

```
"Pull from AthenaOpens this patient's chart in your signed-in Athena tab"
```

**Root cause.** Not CSS. The bar builds a **new** button and assigns a flat string:

```js
var b = D.createElement('button');
b.textContent = p.as || textOf(p.el);   // textContent, not innerHTML
```

`textOf(el)` returns `el.textContent`, which **concatenates across child boundaries** — a `<small>`, a description, a tooltip — and that already-collided string becomes the label.

> ⚠️ **Do NOT "fix" the shared label string by adding a separator.** It omits one *on purpose*: `mls-connect.js:17236` declares `.ez3-big small{display:block}`, so in the ez3 shell the patient sits on its own line and reads correctly. Editing the string repairs one shell and breaks the other.
>
> ⚠️ **Do NOT fix it in CSS.** I shipped `#mlsRightNow button small{display:block}` (f044967) and it was **dead code** — that bar contains zero `<small>` elements, because the label was already flattened to text before CSS could apply. It has been removed. Don't restore it.

**Where the fix goes.** Insert the separator in **`textOf` at label-derivation time**, centrally. Per-shape fixes don't hold: idc-1.0.0 fixed the identity shape and the "Pull from Athena" button kept shipping broken. Every control the bar borrows is exposed.

**Still open beyond the string.** There is **no patient header element at all** (`banner: false`). Patient identity exists only as a button label, which is *why* this bug was possible, and is the structural half of the owner's complaint: *"if Im on a paietn the patient banner sohuld be up there"*. That needs a component, not a rule.

**Why the coverage test can't catch either half.** The control is present and reachable, so it passes. It just renders the patient's name wrong. Worth a contract that patient identity renders in a header region rather than only as a control label.

---

## Method notes — these cost the most to learn

1. **Verify behaviour, never deployment.** I fetched a file from the live server, found my CSS rule in it, and told the owner the bug was fixed. The rule could never fire. Confirming bytes shipped is not confirming the bug is gone — check the rendered result on the live page.
2. **Never quote a progress line as a result.** "3 of 5 charts finished" counts *attempts*; that same run's receipt said `coverageComplete: 0`. Quote receipts only.
3. **A diagnostic that doesn't reach the receipt isn't a diagnostic.** Only the `reason` **string** survives the extension→page hop. An object attached to the gate is silently dropped. Encode evidence into the string.
4. **Probe the surface the user is on.** Two sessions each measured a different screen and each drew a confident wrong conclusion about the same bug. The same string is correct in one shell and wrong in another.
5. **Six theories died tonight, every one to an experiment and none to argument.** What finally worked was one line of receipt output. Measure first.

---

## Landed and safe (don't undo)

- **`tests/hex-colour-integrity.test.js`** (063f10d) — a build bump replaced `b551` with `b557` inside `#6b5518` and shipped a corrupted colour LIVE. One invariant: *no hex literal may contain the current build token*, since a plain replace always leaves the new token inside the hex. Nine forward-dated colours (`#4B564F` b564, `#d8b574` b574, `#b58105` b581, `#5b7186` b718, `#6b7280` b728, `#6B756E` b756, `#B07636` b763, `#6b7684` b768, `#b9770a` b977) are pinned by occurrence count so they stay protected on the one build where the invariant must stay quiet. Both arms negative-tested. **If it goes red, restore the colour — never update a pin to make it green.**
- **pts-rowguard + sv-1.1.0** — the save row-loss fix. Proven against the four named patients.

## Byte-safety traps

- `background.js` is **mixed-EOL**: node latin1 edits only, never the Edit tool. Verify CR count unchanged, ASCII-only insertions.
- **PS 5.1 `Set-Content -Encoding utf8` writes a BOM.** Round-tripping a file through PowerShell does not restore it. Breaks the extension core digest with a bare `ERR_ASSERTION` and two sha256 strings and *no filename* — it reads exactly like the repo tip is red. Restore with `git checkout -- <file>`. Diagnose with `(Get-Content $f -Encoding Byte -TotalCount 3) -join ","` → `239,187,191` means BOM.
- Run byte experiments in an **isolated worktree**, never the shared clone.
