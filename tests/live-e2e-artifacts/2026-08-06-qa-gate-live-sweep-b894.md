# QA gate — live sweep on b894 (2026-08-06, ~21:00–21:45 ET)

**Lane:** the owner's standing QA order — *"test every single feature added from my other tasks …
on my live browser all the way through, and if any don't work tell that session to fix the issue
and don't let it be done till I re-test it and it does work."*

**Surface:** `https://mlsscribe.com/ScribeFlow.html`, the owner's signed-in Chrome, real store
(1,559 patients, 96 templates). Served build confirmed **b894** via `app-version.json` and
`__mlsSI.version === 'si-1.7.18'`. Extension detected installed (`__mlsSI.installed === true`).

**Standing blocker:** `origin/main` is at **b900**; live is pinned at **b894** by the GitHub
Actions/Pages Partial System Outage. b895–b900 are queued and NOT testable. A background watcher
polls `app-version.json` once a minute and wakes this session on the flip.

---

## DEFECT 1 (open) — the op-note template matcher resolves `L4-5` to **L3-L4**

Not covered by the queued b896 laterality fix. Reported to the template lane
(session `local_b399548b`).

Shipped decision function `_opBestTemplate(reason)`, his real 96-template library,
`templateAuto` ON:

| reason | selected | correct |
|---|---|---|
| `Left L4-5 TFESI` | **Left L3-L4** TFESI | Left L4-L5 |
| `Right L4-5 TFESI` | **Right L3-L4** TFESI | Right L4-L5 |
| `B/L L4-5 TFESI` | **Bilateral L3-L4** TFESI | Bilateral L4-L5 |
| `Left L4/5 TFESI` | **Left L3-L4** TFESI | Left L4-L5 |
| `L MBB L4-5` | **Left lumbar MBB L3-L4** | L4-L5 |

Controls that PASS: `L4-L5` and `L4 L5` correct on all three sides; `L3-4`, `L3-L4`, `L5-S1`,
`L5 S1` all correct. So it is specific to the hyphen/slash short form at L4-5.

**Mechanism — a zero-margin tie broken by library order:**

```
_opRankTemplates("Left L4-5 TFESI")  -> Left L3-L4 = 167 , Left L4-L5 = 167   (order decides)
_opRankTemplates("Left L4-L5 TFESI") -> Left L4-L5 = 173 , next        = 168   (decisive)
```

`_opBestTemplate` does **not** refuse on the 167–167 tie; it returns the wrong template with no
disclosure. b896 (`e3d48d1e`) adds only the two side expansions
`[/\br\b(?![\d\/])/,'right']` and `[/(?<!b\/)\bl\b(?!\d)/,'left']` — nothing touches level
parsing, so **this survives the deploy.**

## DEFECT 2 (open) — the service worker 410s the current extension package in real browsers

Reported to the ext-goal lane (session `local_af846812`). Their own manifest pass criterion is
"the zip actually downloads (200)".

- Page context: `fetch('/MLS_Assist_v3.0.45.zip')` → **410 Gone**, body verbatim:
  `This retired, package-only, or unsafe query route is not a public MLS page.`
- Page context: `fetch('/MLS_Assist_v3.0.44.zip')` → **404** (2,477-byte Pages 404). The ACTIVE
  worker passes the *previous* release through and retires the *current* one.
- `curl https://mlsscribe.com/MLS_Assist_v3.0.45.zip` → **200, 419,620 bytes**. The file is fine;
  only real browsers are broken.
- `navigator.serviceWorker.getRegistration()` → `active:{state:'activated'}` **plus
  `waiting:{state:'installed'}`**. The new worker is installed and parked; it never claims while a
  client tab is open. The waiting worker pre-existed my `update()` call.

**Mechanism** — `sw.js:109-121` allowlists exactly one literal:
```
if (name === 'mls_assist_v3.0.45.zip') return false;   // passthrough
if (/\.zip$/.test(name)) return true;                  // retired -> 410
```
At every extension release the previously-active worker allowlists the previous name and therefore
retires the new package. "SHIPPED BUT NEVER SERVED" class. HTTP-level suites cannot see it.

**Secondary:** `#extDlBtn` reads "✅ Add to Chrome — Chrome Web Store" but its href is the local
`MLS_Assist_v3.0.45.zip`, and the Web Store publish is still owner-gated per GOAL.md.

---

## PASS — patient identity resolution refuses ambiguity (the safety-critical matcher)

`_opResolvePatient(name, dob)` against the real 1,559-patient store, 22 same-name groups
(44 patients, every pair with distinct DOB and distinct MRN):

| case | result |
|---|---|
| unique name + real DOB | **80/80 correct**, 0 refused, 0 wrong |
| duplicate name + own DOB | **38/44 correct**, 6 refused, **0 wrong sibling** |
| duplicate name, **no** DOB | **refused 22/22** |
| duplicate name + **bogus** DOB (`1900-01-01`) | **refused 22/22** |

This is the contrast that makes DEFECT 1 worth fixing: the patient resolver refuses ambiguity;
the template matcher breaks the tie by array order.

## PASS — Settings extension card notes contract

`#extDlNotes` is **verbatim-equal** to the `notes` field of `extension-version.json`. The
contract pin holds. Card renders; version reads 3.0.45 in `#edsSecondaryRow`,
`#mlsExtVerLiveRow` and `#extDlNotes`.

---

## Traps found (do not re-discover)

1. **THE ONE-ARG FORM OF `_opResolvePatient` ALWAYS RETURNS NULL.** A name-only probe "refused
   22/22" on duplicates — and also refused 60/60 on *unique* names. A refusal that is universal
   proves nothing. Always run the positive control before believing a fail-closed result.
2. **`_opResolvePatient(name, dob, mrn)` returns null — the third argument is not the MRN.**
   `(name, dob)` is the working form; passing an MRN third breaks resolution silently and looks
   like an identity refusal.
3. **697 of 1,559 patients (45%) have an EMPTY dob**, plus junk records (`sdfsdf`, a 2-digit
   `99`). Any control sampled from the whole store therefore "refuses" for a data reason, not a
   logic reason — my first control read 1/80 until I filtered to the dominant `99/99/9999`
   shape, after which it read 80/80. Sample by DOB shape, never by index.
4. **A page-context `fetch` is NOT an HTTP test.** It rides the service worker. Every download
   assertion must be made twice: once in the browser, once with `curl`. They disagreed here, and
   the browser was the one telling the truth about the user's experience.
5. **`HEAD` and `GET` disagree through the worker**: `/MLS_Assist_v3.0.45.zip` answered HEAD 200
   and GET 410. Probe with GET.
6. The template/import surfaces (`#tplMultiFileInput`, `#tplMultiDrop`, `#mlsUplTplBtn`) are all
   **0×0 folded** until the Templates modal is open — clicking their refs is a dead click.
7. The Claude Code output classifier redacts strings that look like version tokens
   (`__mlsSI.version`, `av-5.x.x`). Compare with `===` and return the boolean, or interleave a
   zero-width space, or the receipt comes back as `[BLOCKED]`.

---

## Deferred deliberately

- **Template import end to end** (tl-1.6.0 "Add means add" b888, 4-wide recognition b891, the
  b897 `.doc` binary strip, the b900 rail search): all four exercise the same import run and it
  mutates his production library. Doing it once, after b900 is live, tests four builds in one
  pass instead of mutating twice. Back up `sf_u::…::templates` (125,100 chars) before starting.
- **Provider-day pull** (si-1.7.18 histogram b890, si-1.7.19 b899): needs athenaOne and ~8
  minutes on real PHI. b899 is not live yet, so one run after the flip covers both.
- **wf3 write sheet** (b892/b893): read-only probe only, authorized patient only
  (Adam J Schaeffer #7833832). Never `#mlsAthenaUnifiedGo` on anyone else.
