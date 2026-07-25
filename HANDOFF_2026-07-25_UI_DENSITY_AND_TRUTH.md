# HANDOFF — 2026-07-25, overnight session (b563 → b581)

Written so a person or another AI can take this over cold. Everything below was
verified on the **running page**, not on the served file — for reasons that are
the single most important thing in this document (§2).

Live build at handoff: **b581**. Gate: **288/288**. Extension live channel:
**3.0.6** (3.0.13 built, committed, NOT released — see §6).

---

## 1. What the owner asked for, in their words

> "redesign and make it simpler and easy to use and more intuitive, every single
> page, popup, and everything in between"

then, after five builds:

> "im not impressed ecverythuing is still so messy … dont stop till evrythiung is
> easy to understand intuitive and not so amnyt buttons evrywhere. **I love the
> bottom bar btw**"

and specifically: the patient page ("I HATE THE ENTREUI UI … A TON"), the visit
page, the bottom-left bubbles ("COMBINE TO 1 Bubble"), and the Prep/Record/Review
rail being "COMPLETLY IN THE WRONG SPOT".

**The dock (bottom bar) is liked. Do not redesign it.** Use it as the reference
the rest of the UI copies.

---

## 2. READ THIS FIRST: six builds shipped and reached no browser

`feat_mls_calm_shell.js` — the module that *is* the redesign — loaded as
`?v=20260724calm116`, a frozen token. **The service worker serves versioned asset
URLs cache-first.** Every visitor kept the copy cached under that token, so
b565–b573 shipped correctly to the server and reached **no browser at all**.

Measured live: `app-version.json` said b573 while the page ran the **b564-era**
module, and the injected stylesheet contained none of five shipped changes.

The gate was green every time. `curl` of the asset showed the new code every
time. The URL was wrong and nothing looked at it — so the owner kept reporting
the same problems while we kept reporting them fixed.

**The rule: verify the RUNNING PAGE, never the served file.**

```js
// what a real verification looks like
document.getElementById('mlsCalmShellCss').textContent.indexOf('your-new-rule') > -1
document.querySelector('script[data-mls-asset="feat_mls_calm_shell.js"]').getAttribute('src')
```

Fixed in b574: the shell now loads `?v=' + (window.__MLS_AV || Date.now())`.
Guarded by `tests/calm-shell-cache-bust.test.js` (both arms negative-tested). A
frozen token is correct **only** for assets deliberately pinned by
`tests/immutable-satellite-loader-cache-contract.test.js`.

---

## 3. The instrument lied seven times. Check it before believing it.

Two of these nearly shipped as fixes for problems that did not exist; one nearly
caused a redesign of the dock, which is correct as-is.

| # | Looked like | Actually was |
|---|---|---|
| 1 | five builds of UI not working | frozen `?v=` token (§2) |
| 2 | patient card had **0** folds applied | rAF never fires in a non-compositing tab, so `schedule()` never ran. Call `__mlsCalmShell.render()` when probing |
| 3 | a hide that did not hide | rule parsed, matched, `!important` — and **out-specified** by `body.mls-redesign #ez3Wrap > .ez3-clockbar` at (1,2,1) |
| 4 | "463px saved" | my probe's click toggled the workspace and collapsed the block. Real saving: 0px |
| 5 | "16 controls in the Patients header" | 12 visible; the rest were already behind "⋯ More". `querySelectorAll` counts the invisible |
| 6 | "Tools" duplicated 3× | `renderRightNow()` **rebuilds** the bar per screen; scanning across renders collected rebuilt nodes. Single snapshot: 0 duplicates |
| 7 | "3 of 5 dock buttons go to the same screen" | `day` and `review` were `display:none` (targets not offered) and `go()` correctly early-returned. **A programmatic `.click()` fires on hidden buttons.** The dock shows 4 and each is distinct |

Also recurring: `?preview=1` must be **exact** — adding `&nc=` silently breaks the
preview gate and boots a shell-less page. `textContent` welds block children, so
`\b` word boundaries vanish ("…transcript0 words"). Shell heredocs eat backticks
and can turn `\b` into a literal 0x08 byte — write scripts to a **file**, not
through bash strings.

---

## 4. What shipped, and the numbers

All measured on the running page at b581.

| screen | before | now |
|---|---|---|
| Patient card | 4,005px | **1,664px** |
| Patients view (phone, patient open) | 4,930px | **2,008px** |
| Visit screen `#mlsEz3` | 1,307px | **~950px** |
| Day strip | 243px | **167px** |
| Visible controls off-dock | 12 | **6** |
| Duplicate visible labels | 3 pairs | **0** |
| Controls hidden with no route back | 3 | **0** |

**Public pages (b563–b567).** Three audits — correctness (17 findings),
usability (15), popups (29). The through-line: *only the server may declare
something dead*, and never state as fact what was never determined.

- `appointment.html` reported every 5xx / cold start / dropped connection as
  "We couldn't find that appointment" in a panel with **no control**.
- `patient-portal.html` told patients their own username, password and date of
  birth were wrong when the server had failed; the invite claim declared a
  one-time link spent on any non-404; the refill "Other / not listed" path was a
  **dead loop** (collect() blanked the value, then validation demanded it back);
  and the whole escape hatch pointed at a phone number that can never exist,
  because `office()` reads a key written only by a **retired** page.
- `booking.html` turned a failed slots request into "no openings that day" — a
  factual claim about the practice, produced by an error.
- `index.html` contradicted its own HIPAA answer, and the flagship note mock
  billed **CPT 72148** on a visit whose Plan says the MRI was only *considered*.
- Three patient pages blamed the link for the app's own URL scrubbing.

**The worst single defect, from the popup audit (b569).** `handOff()` toasted
"Opened Athena's review & confirm screen" **unconditionally**, while
`pushEntireVisitToAthena` has seven early-return-with-error branches that never
throw. Both toasts shared `bottom:26px;left:50%`, with the success toast at
z-index 2,147,481,500 against the error's 99,999 — so the green claim rendered
**on top of** the red refusal. A doctor pressed Send, read that it was filed, and
it was not. Fixed in all **five** duplicated copies; success is now asserted only
when a receipt exists, checked synchronously against **both** `#athenaReceipt`
and `#mlsAthenaUnifiedConfirm` (writeflow replaces the first with the second, so
polling one reports failure on successful sends).

**Density (b572–b581).** The patient card rendered its prep summary **twice** —
`prepRows()` builds compact labelled rows and the raw ~500px body rendered
underneath. The problem list is **capped** (340px, internal scroll) not folded,
because it is scanned mid-visit. An empty transcript panel spent 252px to say
"0 words captured". A 56px clock on a device that shows the time. Two settings
moved out of the day strip. Two controls called "Tools" doing different things →
"Visit shortcuts". Two doors labelled "Advanced visit workspace" (one literally
`.click()`s the other). On phones, opening a patient kept the whole directory
underneath → master-detail, list returns on `:focus-within` of search.

---

## 5. Non-negotiables (each has already bitten)

1. **Verify the running page, not the served file.** §2.
2. **"The rule is in the stylesheet" ≠ "the rule is winning."** Out-specify;
   another `!important` changes nothing. Diagnose by walking
   `document.styleSheets` + `el.matches(selectorText)` + `getPropertyPriority`.
3. **Hide by CSS class, never inline.** `available()` tests only *inline*
   `display`, so a class-hide keeps a control reachable in Tools; an inline hide
   silently removes the feature.
4. **Hidden ≠ removed.** Every hidden id needs a Tools entry or a documented
   exemption — `tests/shell-hidden-controls-keep-reach.test.js` enforces it.
5. **Never proxy a trusted-gesture control.** `isTrusted` cannot be forged;
   gated controls are spotlighted, never clicked.
6. **Never state a negative the system cannot back.** "None recorded" is
   indistinguishable from "never captured" — render `—`.
7. **`background.js` is byte-edit-via-node-latin1 ONLY.** The Edit tool
   LF-normalises it and breaks the core digest with a bare `ERR_ASSERTION` and no
   filename.
8. **Build bumps must use a boundary-anchored regex** — `bNNN` matches inside
   `#6b5518`. Guarded by `tests/hex-colour-integrity.test.js`.

---

## 6. Open work

**Needs the owner's session — do not guess at these.**

- **Boot speed.** Measured warm on `?preview=1` at b569: `domInteractive` 293ms,
  load 3,598ms, script phase **2,919ms**, 177 feature scripts (176 cached), total
  download **39ms**, aggregate queue **299,064ms**. The serialisation is real —
  180 sites use `s.async=false`, which forces strictly ordered execution — but
  the **26s figure came from a signed-in session** and could not be reproduced on
  preview. That gap is plausibly data hydration, not the loader. **Take one warm
  measurement on the signed-in tab before touching the boot path**; it is the
  highest blast-radius code in the product. If the script phase is still ~3s
  while load is 26s, the loader is a red herring. Note
  `tests/boot-script-budget.test.js` counts *names in mls-connect.js*, so it
  measures **bundling, not deferral** — a deferral win would read as no progress.
- **ON-mode (extension).** Root cause is frame **qualification**, not selection:
  12 frames answer enumerate, only the enterprise inbox returns ok, and the real
  chart frame (stable 40/40 samples, 22 rows of `li.encounter-list-item`) is
  judged not-ok *inside* the enumerate op. **ext 3.0.13** is committed on
  `agent/ext-3.0.10-on-mode` with an instrument that names which of the gates
  refuses. Four candidates, not three — `bestGroup()` may not select the
  encounter list at all, in which case none of the three gates runs. Install
  3.0.13, run one pull, read the `enum=` reason. Judge success by
  `coverageComplete` above zero on real patients, not by the frame being
  accepted.
- **privacy.html / terms.html.** SHA-256 pinned to the signup assent record by
  `tests/signup-assent-manifest-runtime.test.js`. Restyling silently invalidates
  what every existing user agreed to — a re-issue decision, not a design one.
  These are the only 2 of the 18 published pages not reworked.

**Ready to pick up without the owner.**

- `#mlsEz3` is ~950px. The `.ez3fl-quick` chips (Copilot Voice / MLS Assistant /
  Dictate) are **not** duplicates of the dock's Copilot — verified by reading the
  handlers — so do **not** fold them; they are the in-context route during a
  visit. Tools is now the everywhere route (b580).
- `tools/ui-control-inventory.js` walks `ScribeFlow.html` and `feat_*.js` but
  **not `mls-connect.js`**, so every control defined there is invisible to the
  "no features lost" receipt. That blind spot let a real regression through for
  twenty builds. Re-scoping it is task **S7**.
- `PT_KEEP_OPEN` still pins `mlsEpTopBox`, `mlsEpRisksBox`, `mlsEpSummaryBox` and
  the Problem list open. The prep rows (441px, six clinical facts) were
  deliberately **not** truncated — that is the pre-visit brief and the reason the
  page exists.

---

## 7. How to work here

Repo: `dispatch-work/claude-commercial-20260717`, push `origin HEAD:main`, Pages
deploys in ~40–90s. Certify in an isolated worktree when the shared clone carries
another session's WIP.

Ship loop: edit → `node --check` → bump with a **boundary-anchored** regex →
`node tests/run-all.js` (288 suites) → commit → push → poll
`app-version.json` → **verify on the running page**.

Companion docs: `UI_CHARTER_CALM_SHELL_2026-07-24.md` (design contract),
`HANDOFF_UI_REWORK_2026-07-24.md` (shell architecture and the b533→b563 arc),
`HANDOFF_ON_MODE_TAB_BINDING_2026-07-24.md` (the six ON-mode theories and what
killed each), `HANDOFF_COMMERCIAL_READINESS_2026-07-21.md`.

Two sessions shared this repo overnight. Coordination that worked: claim a file,
announce build numbers, and never deploy during a live pull.
