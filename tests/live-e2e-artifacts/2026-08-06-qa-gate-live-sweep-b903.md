# QA gate — live sweep on b903 (2026-08-06, ~22:40 ET)

Companion to `2026-08-06-qa-gate-live-sweep-b894.md`. The Pages approval cleared (Actions runs
#22/#23 succeeded, 22:06Z and 22:36Z) and live moved b894 → **b903**, carrying b895–b903 at once.

**Surface:** `https://mlsscribe.com/ScribeFlow.html`, the owner's signed-in Chrome, real store
(1,559 patients, 96 templates). Every result is a live receipt.

## Version gates (check these FIRST — a stale string makes everything after it noise)

| global | reads | meaning |
|---|---|---|
| `app-version.json` | `2026-07-25-b903` | the deploy landed |
| `__mlsSI.version` | `si-1.7.19` | b899 bytes served (but see the retraction — the fix is a no-op) |
| `__mlsAvatar.version` | `av-5.3.0` | the fail-open repair is served |
| `__mlsAthenaDoctor.version` | `1.0.4` | b901 notification removal served |
| `getTemplates().length` | `96` | library intact across the deploy |

---

## ✅ CURED — the op-note template matcher, 48/48

Full 6-side × 8-level-spelling matrix through `_opBestTemplate`, plus targeted extras.
**Zero wrong, zero refusals needed.** Both defects opened on b894 are closed:

| reason | b894 | b903 |
|---|---|---|
| `Left L4-5 TFESI` | Left **L3-L4** (167 vs 167 tie) | Left **L4-L5** (**173** vs 168) |
| `R L5-S1 TFESI` | **Left** L5-S1 (168/168/168) | **Right** L5-S1 (**173** vs 168) |
| `R L4-5 TFESI` | **Left L3-L4** (both axes wrong) | **Right L4-L5** |
| `R MBB L4-5` | Left MBB L3-L4 | **Right** MBB L4-L5 |
| `R SI joint injection` | **Left** sacroiliac | **Right** sacroiliac |
| `R genicular RFA` / `R lumbar RFA` | Left | **Right** |
| `LESI` | scored 0 across the library | Starter — Lumbar epidural steroid injection |

Controls unregressed: `L4-L5`, `L4 L5`, `L3-4`, `L3-L4`, `L5-S1`, `L5 S1` correct on all three
sides; `B/L` and `Bilateral` still outrank Left and Right.

Still refusing (fail-closed, recorded as honest unless the lane says otherwise): `TPI`, `CESI`,
`SIJ inj left` — note the last one has a matching template in the library, so it is an
over-refusal, which is the safe direction.

## ✅ PASS — b901 Athena failure-notification removal

Fresh load, pristine module, success first / failure last (removing the toast node poisons the
module — see the b894 artifact's trap list):

| probe | b894 | b903 |
|---|---|---|
| pristine | 0 bars, no toast | 0 bars, no toast |
| success search `ok:true, results:[{},{}]` | toast `ok` "✓ Athena search returned 2 results." | **identical** |
| search failure `no-form` | toast `warn` + **1 bar** | **0 bars, no new toast** |
| pull failure `no-tab` | toast `warn` + **1 bar** | **0 bars, toast null** |

`#mlsAthenaDoctorBtn` survives; `ownsPullNotices` true. `#mlsAthenaStatusDot` is still absent —
pre-existing on b894, unchanged, referred back to that lane.

## ✅ PASS — av-5.3.0 structure, in the SERVED bytes

`kiosk.pinSet = null` (tri-state seed) present; both reads are `=== false`; the `unset` probe
present; `mlsAvKioskDone` / `mlsAvKioskRepeat` / `mlsAvKioskType` **all absent** — the buttonless
kiosk shipped. End button and PIN pad present; face customization present.

## ✅ PASS — the provider-pull honest refusal (no athenaOne needed)

`#mlsCalProviderPull` is `disabled`, label **"Choose a provider to pull"**, and
`__mlsSI.calendarSelection()` returns
`{ok:false, complete:false, reason:"provider-required", error:"Choose one provider in Calendar first."}`.
Bridge alive: `mlsPing` → `mlsPong`, `__mlsSI.installed === true`.

---

## ❌ STILL LIVE

**b897 draft regression — a Word-junk template cannot draft at all.** Both halves proved on b903:
- `_tplTextForDraft(dirty)` → **918 → 851 chars, bytes differ**; `_tplTextForDraft(clean) === clean`
- the served integrity gate is still literal byte equality:
  `if(S(t.text)!==S(tplText))return {tpl:null,error:'The selected template changed before drafting. Re-select it and retry.',code:'MLS_OPNOTE_TEMPLATE_STALE'`

  Mitigation: **0 of his 96 templates carry the signature today**, so it bites on the next legacy
  `.doc` import — the feature's own use case. Draft-all never retries this code.

**The service-worker 410, unchanged by the deploy.** Page context: `v3.0.45` → **410**, `v3.0.43` →
410, `v3.0.44` → 404; `active: activated` **plus `waiting: installed`**. A production deploy went
out and the active worker did not roll — the strongest evidence that shipping new `sw.js` bytes
cannot reach an already-broken browser.

**The false Web Store claim.** `#extDlBtn` = "✅ Add to Chrome — Chrome Web Store" over
`href="MLS_Assist_v3.0.45.zip"`; `#extDlVersion` absent at runtime (the `mls-connect.js` rewrite
beats the baked HTML). `#extDlNotes` still verbatim-equal to the feed.

**b900 caret jump — confirmed on the real element.** `#oprTplSearch`: caret set to 4 after a
mid-string keystroke, after `input` → `selectionStart 7` of a 7-char value, and the node was
replaced by the `innerHTML` rebuild. (Caveat: the panel measured 0×0 when driven, so layout was
not fully live; the handler still ran and the caret still moved.)

**Open, code-confirmed, not yet live-exercised:** b898 avatar self-ending on three axes
(typed mode never self-ends; the `heardAnything` guard permanently disarms the counter and nothing
re-arms it; no client-side bound, so it can re-fire every 9s forever), and b899
surname-as-credential (a clinician whose surname is a credential token gets a phantom roster twin).

---

## NOT TESTABLE BY AN AGENT — needs the owner's foreground tab

Agent tabs run `visibilityState === 'hidden'` and cannot be fronted. Running these anyway would
manufacture the documented occlusion failures and make the result uninterpretable:

1. **mdx-1.1.0 history histogram** — a hidden-tab day pull poisons its own sample.
2. **wf3 read-only write probe** — the athenaOne briefing SPA is rAF-starved when occluded; a prior
   session held it flat at 1,938 chars for hours.
3. **av-5.3.0 kiosk behaviour** — needs a mic grant, fullscreen, and someone speaking.

The ask is small: front the athena tab and run one provider-day pull while it stays visible, and
spend about five minutes on one kiosk interview.

## Retraction recorded

The ext-goal lane withdrew its own b899 sign-off: si-1.7.19 is live and is a **no-op** for the
second clinician — his echo key is `athena:<display text>`, not `legacy-name:`, so the exemption
never fires. Their fixture was hand-written in the one shape the exemption accepted. Real fix is
mdx-2.0.1 / si-1.7.20. This QA lane never claimed the cure; a regression datapoint on the owner's
machine is not evidence about Matt's.
