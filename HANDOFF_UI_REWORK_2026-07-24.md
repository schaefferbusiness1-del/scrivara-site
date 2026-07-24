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

## Build ledger (all live)

b533 shell · b535 doubled rail + empty bar · b537 14 adversarial-review defects
· b539 trusted-gesture spotlight · b540 loading screen + emptied sidebar · b541
dock frozen on mobile · b542 public-site + extension truth · b543 patient-page
palette, Classic out of the dock · b544 prep summary rows · b548 lawyers
directory controls · b549 portal schema leak + cancel confirmation.

b534/b538/b546/b547 belong to the Athena session. **b536 and b545 are retired,
never reuse them.** Always take the next free number and announce it.

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

See the task list (S3, S5-S13). Highest value next: the patient header actions,
the blank "Legal profile" Settings tab, the signing ceremony that promises a PDF
it never generates, the Templates modal collapsing on phones, and teaching the
coverage suite that a control with a dead handler is not reachable (the Athena
session's phone chips are the fixture).
