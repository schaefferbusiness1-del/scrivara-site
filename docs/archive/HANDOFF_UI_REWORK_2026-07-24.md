# HANDOFF — the UI rework (Calm Shell), 2026-07-24

Written so another AI or person can take this over cold. Read this, then
`UI_CHARTER_CALM_SHELL_2026-07-24.md` for the design contract.

## The owner's goal, in their words

> "redesign and make it simpler and easy to use and more intuitive, every single
> page, popup, and everything in between — the entire UI, till it's perfect and
> live"

and, on the patient screen specifically:

> "this patient page is especially awful… so complicated and so many buttons. A
> lot of this info is important but needs to be done way better. This is an
> example of what should be done to everything."

and, decisively:

> "this is a complete UI fix from almost scratch."

Also standing: keep it fast, free the doctor from buttons, **make sure
everything works and don't break anything**.

## Where it lives

Everything is one module: **`feat_mls_calm_shell.js`** (`calm-1.0.0`), loaded as
a satellite from `mls-connect.js` with an immutable `?v=` token. It is
**presentation-only by design** — see the charter's architecture section. The
short version:

- The dock clicks the **real** rail tab. `showView()` is never wrapped; view
  state is read by observing which `.navtab` carries `.on`.
- The right-now bar, Tools menu and Ask click the **real** existing buttons via
  one `runControl()`.
- `.mainnav` and `#mlsRdNav` are hidden with **CSS, never removed**.
- Nothing in the shell reimplements clinical behaviour, so the app's gates,
  confirmations and writers stay the single owners of everything they own.

## Non-negotiables (these have already bitten; do not relearn them)

1. **Never proxy a trusted-gesture control.** `isTrusted` cannot be forged.
   `startPhoneMic` / `startPhoneMicFromEasy` refuse silently;
   `feat_mls_exact_encounter_verify.js:554` refuses audibly. Gated controls are
   spotlighted and explained, never clicked. `trustedGated()` + the four
   `runControl()` call sites are enforced by the coverage suite.
2. **Never state a negative the system cannot back.** "None recorded" and
   "meds: []" are indistinguishable from "never captured". Render `—` with
   "not captured — re-pull to check". This is the same defect class that
   hard-deleted 1,432 patient rows.
3. **Hidden ≠ removed.** Every control must keep a reach path, and
   `tests/ui-control-coverage.test.js` fails the build if one loses it. It also
   fails a control reachable *only* by typing in Ask.
4. **Gate the exact bytes you ship, then verify live.** Two defects (a doubled
   rail, a bar that could sit empty forever) passed a green 283-suite gate and
   were only caught in a real browser.
5. **Legal and safety surfaces are not cosmetic.** See "Reverted deliberately".
6. **VERIFY THE RUNNING PAGE, NEVER THE SERVED FILE.** This is the most
   expensive lesson of the whole rework. `feat_mls_calm_shell.js` loaded on a
   frozen `?v=20260724calm116`, and the service worker serves versioned asset
   URLs cache-first — so **six consecutive builds (b565–b573) shipped correctly
   to the server and reached no browser at all**. The owner kept reporting the
   same UI problems while we kept reporting them fixed. `curl` of the asset
   showed the new code every time; the URL was wrong and nothing looked at it.
   Read `document.getElementById('mlsCalmShellCss').textContent` and assert your
   change is *in it*, and check `script[data-mls-asset="…"]`'s real `src`.
   Fixed in b574: the shell now loads `?v=' + (window.__MLS_AV || Date.now())`,
   guarded by `tests/calm-shell-cache-bust.test.js`. A frozen token is correct
   ONLY for assets deliberately pinned by the immutable-loader contract.
7. **"The rule is in the stylesheet" ≠ "the rule is winning."** `mlsRdStyle`
   declares `body.mls-redesign #ez3Wrap > .ez3-clockbar{display:flex!important}`
   at (1,2,1); a shell rule at (0,2,1) is parsed, matches the element, carries
   `!important`, and still loses. Adding another `!important` changes nothing —
   **out-specify**. Diagnose by walking `document.styleSheets`, testing
   `el.matches(rule.selectorText)` and reading `getPropertyPriority`.
8. **Hide by CSS class, never inline.** `available()` in the shell tests only
   the control's *inline* `display`, so a class-hide keeps a control reachable
   in Tools while an inline hide silently removes the feature.
9. **rAF does not fire in a non-compositing tab.** `schedule()` coalesces to
   `requestAnimationFrame`, so in any headless or background pane the renderers
   never run and a healthy screen reads as completely inert. Call
   `__mlsCalmShell.render()` explicitly when probing, and never report
   "nothing applied" from such a tab as a product defect.

## Build ledger (all live)

b533 shell · b535 doubled rail + empty bar · b537 14 adversarial-review defects
· b539 trusted-gesture spotlight · b540 loading screen + emptied sidebar · b541
dock frozen on mobile · b542 public-site + extension truth · b543 patient-page
palette, Classic out of the dock · b544 prep summary rows · b548 lawyers
directory controls · b549 portal schema leak + cancel confirmation · b550
patient screen folds to four things · b551 one action per patient, list reads as
people · b552 honest signing promise + Templates on phones · b553 blank Settings
tab.

tab · b557 bump script was corrupting hex colours + prep parser never matched ·
b558 a fold that survives re-render · b559 prep rows stop spilling, Patient
portal returns to the bar · b560 three floating pills become one Copilot button
· b562 phone recorder stops losing the start of visits · b563 honest failure
states across the public pages (below).

b534/b538/b546/b547 belong to the Athena session. **b536 and b545 are retired,
never reuse them.** Always take the next free number and announce it.

### "Every page" is exactly 18 pages

`tests/public-publication-boundary.test.js` defines `PUBLIC_HTML` (18 published
pages) and `RETIRED_HTML` (~30 pages excluded from the Pages build). Four pages
that look neglected — `legal-connect.html`, `mls-best-doctors.html`,
`mls-doctor-awards.html`, `mls-widgets.html` — are **retired on purpose**, and
line 331 of that suite makes a link from any public page to a retired one a gate
failure. Do not "finish the job" by redesigning them, and never link them back.

Of the 18 published pages, 16 have been reworked. The two exceptions are
`privacy.html` and `terms.html`, which are SHA-256 pinned to the signup assent
record — restyling them silently invalidates what every existing user agreed to,
so it needs an owner decision and a re-issue, not a redesign. See "Reverted
deliberately".

### One defect class kept reappearing: a transient fault dressed as a verdict

Four separate public pages collapsed "we could not reach the server" into the
same message as "your link is invalid", then removed every control on the page.
The shape was always a promise chain like
`.then(r => r.ok ? r.json() : null, () => null)` — network failure, 5xx, and a
genuinely retired token all arrive as `null` and become one sentence.

It matters most on `best-doctors-optout.html`, where the page is a patient
withdrawing their visit from the aggregate rating: a dropped request told them
the link had expired and left nothing to press, so the visit kept counting. Same
shape fixed in `intake.html`, `expert.html`, and `phone.html`.

The rule now: **only the server may declare a link dead.** A parsed answer means
the server spoke (`ok:false` is a real "no"); a rejection, a 5xx, or an
unreadable body is transient and must stay retryable. Never imply an action
succeeded — or failed permanently — on a transport error.
`tests/optout-failure-recovery.test.js` executes the real page script against
scripted responses and enforces this; it is behavioural because the old copy
read fine in review and only driving the branches exposed the dead ends.

### The pin trap, concretely

Changing a satellite module means moving its immutable `?v=` token, and a token
can be pinned in **more than one test**. `feat_athena_tooltip_dedupe.js` was
pinned in THREE: `immutable-satellite-loader-cache` (which records the *retired*
token to assert the old URL is unreachable), `day-progress-responsive-layout`,
and `scoped-lifecycle-watchers`. Updating one turned the gate red on the second;
only a repo-wide grep for the old token found the third. **After any token move,
grep the whole repo for the retired token before gating.**

## Density campaign (b572-b577) - the numbers, measured on the running page

Owner, after five builds: "everything is still so messy... not so amnyt buttons
evrywhere". The method that finally worked: measure each screen (height AND
visible control count via computed style, never querySelectorAll - the Patients
header's 16 controls are already collapsed behind "More"), then cut the largest
blocks and verify on the running page.

    patient card    4005px -> 1664px
    patients view   4930px -> 2589px
    visit #mlsEz3   1307px -> ~1231px
    day strip        243px ->  167px
    visible off-dock controls  12 -> 7

What the cuts actually were, since "too busy" was never a taste problem:

- **The patient card rendered the same content twice.** prepRows() parses the
  prep summary into compact labelled rows AND the raw ~500px body rendered
  underneath. The body is now marked by prepRows() itself (it holds the exact
  node - a CSS sibling selector cannot reach it, they are not siblings).
- **Problem list capped, not folded** (689 -> 340px, internal scroll). It is the
  one block scanned mid-visit, so it stays visible.
- **An empty transcript panel spent 252px** to say "0 words captured". Folds
  until it has words. NB the emptiness test is `(?:^|\D)0\s*words`. A
  word-boundary form never matches, because textContent welds the block children
  into "…transcript0 words captured" and there is no boundary before the `0`;
  and a bare `/0 words/` would also match "10 words" and hide a transcript that
  HAS content. Both wrong forms were written before the right one — test any
  such rule against "10 words" and "100 words" before shipping it.
- **A 56px clock** on a device that shows the time (needed the specificity fix).
- **Two settings** ("Where pulls run", "Full visit notes") moved out of the day
  strip into Tools - configured once, they were sitting above every screenful.
- **Two controls both called "Tools"** doing different things: the dock opens the
  Tools MENU, the visit chip only shows/hides its own shortcut row. The chips
  are now "Visit shortcuts".

STILL TO CUT: #mlsEz3 is ~1231px; the .ez3fl-quick row still shows Copilot
Voice / Assistant / Dictate inline although the dock Copilot button now owns all
three (they are disabled in ?preview=1, so a fold cannot be verified there -
do it against a real session). PT_KEEP_OPEN still pins mlsEpTopBox,
mlsEpRisksBox, mlsEpSummaryBox and the Problem list open.

## Audit findings whose stated CAUSE was wrong

The read-only audit produced 29 confirmed findings and was extremely useful, but
four named a real symptom with a wrong cause. Verify before acting:

- The attorney intake form is a **test-pinned refusal surface**, not dead UI.
- `privacy.html`/`terms.html` are **assent-hashed**; restyling is not cosmetic.
- The signing ceremony **does** build a PDF (`agBuildReceiptPdf`) — it is
  uploaded as `receiptPdfBase64`, never downloaded, and is best-effort.
- The review-finder upsell card is **not** JS-hidden; the 1500ms timeout nearby
  clears a "Saved." message. Only its purple border was wrong.

## Reverted deliberately — do NOT retry these

- **The attorney intake form (`lawyers.html`).** Looks like a dead 5-field form;
  it is a test-pinned refusal surface. `lawyers-editorial-redesign.test.js`
  requires the inert `action="#"`, the onsubmit handler, the "Case intake is
  unavailable" heading, the sentence naming what may not be submitted, and every
  control carrying `disabled`. Removing it was rejected by the gate.
- **Restyling `privacy.html` / `terms.html`.** Their SHA-256 is pinned into the
  signup assent manifest (`signup-assent-manifest-runtime.test.js:216-217`) —
  users assent to a specific document hash. A colour-only change invalidates the
  digests and perturbs a legal audit trail. Ride the restyle along with the next
  genuine wording revision.

## Owner-gated — never do these unattended

- `MLS_SALES_RELEASED = false` (index.html) holds purchasing. The backend is
  live-ready (`mode: LIVE`, checkout ready, webhooks configured). Flipping it
  takes real money — owner's decision.
- **Twilio**: credentials are already in Render. The only remaining step is
  pointing the number's Voice webhook at
  `https://scrivara-backend.onrender.com/api/voice/<booking-token>` (the token is
  the practice's existing booking-link token, `schedule_tokens`). The AI front
  desk (`POST /api/voice/:token`) is already written and books real open slots.
- `privacy.html` claims HIPAA-compliant production use while telling users not to
  enter real patient data, and lists Twilio as "Planned" in the **subprocessor**
  table. Legal wording — owner + counsel.

## The screen redesign, and what "from scratch" means here

The patient profile stacks **fourteen fully-expanded blocks**. The rebuild rule,
which generalises to every screen:

> Four things above the fold — who this is, why they are here, what is dangerous,
> what is wrong with them — one primary action, and everything else as one quiet
> line that opens on demand.

In progress: `patientScreen()` folds the reference blocks (visit history,
insurance, documents, outside records, timeline, export, trend) to their own
heading, which becomes the click target. Kept open: visit context, key risks,
prep rows, problem list. Nothing is removed, so folded controls keep their
`panel` reach path.

Still to do on that screen: fold the **eight** competing header actions to one
primary (Start visit) + Tools; recolour the purple athenaOne control; thin the
patient list cards so names read first. **These need a signed-in session** —
`?preview=1` does not render the profile action buttons, and shipping blind
changes to buttons you cannot watch work is how the doubled rail got through.

## How to work here safely

- The shared tree usually carries another session's WIP. Build in an isolated
  worktree at HEAD (`git worktree add --detach <tmp> HEAD`), run the gate THERE,
  commit only your files.
- Bump pins by **scanning**, not from a list — the `/mls-build-ship` template is
  stale (sw.js carries only the cache version now). Bump scripts must touch
  pins only: a blanket replace rewrites prose and turns true statements false.
- A **changed** module needs a fresh `?v=` token or the service worker serves the
  old copy forever.
- Verify against `https://mlsscribe.com/ScribeFlow.html?preview=1` — real app,
  sample data, no PHI, and it does not touch the owner's signed-in tab.
- Probe `localStorage` for `mlsPullBusyXTabV1` before any deploy; never deploy
  during a live Athena pull.

## Open work

See the task list (S3, S5-S8, S13). Highest value next: teaching the coverage
suite that a control with a dead handler is not reachable (the Athena session's
phone chips are the fixture), and putting "who is next and why" in the right-now
bar from OFF-mode data.

S11 is closed and was **bigger than recorded**. The note said "gbp-setup reads a
storage key nothing writes any more". In fact `mls_reviews_scrape_app.js` v1.4.1
renamed its cache to `mlsRFScrapeCache2` and **five** surfaces were left on the
old name: `gbp-setup.html`, `feat_mls_review_request.js`,
`mls-best-doctors-admin.html`, `mls-marketing-console.html`, `mls-marketing.html`.

The rename was deliberate quarantine, not drift — v1.4.0 payloads can carry a
`verified:true` left behind by a confirm-then-undo, which would keep counting an
unconfirmed listing toward the headline. So readers were moved **to** the new
key with **no fallback**; a two-key fallback would re-admit exactly the payloads
the rename existed to abandon. `clinical-state-purge.js` is the one file that
must keep naming both, so a browser still holding the retired key gets it
cleared. Guarded at the end of `tests/review-finder-security-boundary.test.js`.

Watch the blanket-replace trap while doing this kind of rename: rewriting the
key everywhere also rewrote a code comment in `gbp-setup.html` that read
"Nothing currently writes mlsRFScrapeCache" into "…mlsRFScrapeCache2", turning a
true statement false. Read the prose in your own diff, not just the code.
