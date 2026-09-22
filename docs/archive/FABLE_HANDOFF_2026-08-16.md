# For Fable — the one thing only Fable can do

Owner's rule: this file contains **only** work that cannot be done on the site.
Everything else is the /1p lane's job. Two items were in an earlier draft of
this file and have been removed because they turned out to be site-side; they
are listed at the bottom so nobody re-assigns them by mistake.

---

## THE ONLY ITEM: lift the extension's execute-block for `stage_billing` and `sign_encounter`

**Status: owner-authorized, site side already shipped, extension side is the
last remaining step.**

The owner's instruction of 2026-08-12 stands: *"remove all the blockers and
ungray the confirm and send to athena button… dont touch the extension all of
the writes work they just need to be unblocked."* He was right that the writes
work — the extension already contains complete, working execution code for all
five actions.

**The site side is done.** `1p-feat_mls_writeflow.js:151` already reads:

```js
var ATHENA_EXECUTABLE_ACTIONS = { write_note: true, save_draft: true, stage_billing: true, sign_encounter: true };
```

and the `/1p` shell carries the capability handshake (`athenaFinalActionsV1`,
three sites in `1pScribeFlow.html`). Rows go READY only when the installed
extension advertises that capability in `mlsPong`.

**What still blocks execution is four layers, all inside the extension. No
site change can lift any of them:**

1. `content.js` — click-gate arm list
2. `content.js` — `MLS_WRITE_SAFETY_BRIDGE_GATE`
3. `background.js` — `MLS_WRITE_SAFETY_GATE`
4. `background.js` — driver guard `wsg-1.0.0` (~:232) plus the forbidden-label
   `clickOnce` list

**The task:** an extension release that lifts `wsg-1.0.0` for `stage_billing`
and `sign_encounter` specifically, and advertises `athenaFinalActionsV1` in
the handshake. Follow the `mls-extension-release` train — it has 12+ pins that
must move together.

**Keep blocked:** `place_order`. That is autonomous clinical ordering and the
owner's own brief says orders must stay behind clinician authorization.

**Do NOT touch the correctness gates** — they are not policy and they are not
what the owner asked to remove: identity lock, encounter binding, exact CPT
format, sign-requires-a-verified-note-write, one confirm per action, no
auto-chain.

**One thing to know before anyone celebrates this unblocking the button.** On
the owner's real store, measured 2026-08-16: of 1,672 patients, **1,252 (75%)
have no MRN**. Writes require three-factor identity (name + DOB + MRN),
enforced at both ends including `background.js:766` which hard-refuses with
`patient-mismatch`. So even after this extension release, the button stays
gray for three of four patients until the MRN data is restored. That data
problem is the site lane's job, not Fable's — but shipping the extension
release and then finding the button still gray would look like the release
failed, and it would not have.

---

## Removed from this file — these are the /1p lane's, not Fable's

- **`_assistReadChart` could not receive a lease token from the today-note
  path.** Already fixed site-side (commit `fed96564`) with a lease loan. The
  frozen file in the call path was `feat_visits.js` — a *site* production
  file, not an extension file.
- **The provider roster "never verifies."** Traced to site code: the preflight
  initialises `rosterComplete:false` (`1p-feat_mls_schedimport_exact.js:6406`)
  and samples the roster before it settles, then `rosterVerified` inherits
  that stale value via `detectedOnly` (:469, :479). The owner's own report
  shows `providerRosterReceipt {complete:true, partial:false}` — the roster
  did complete; the preflight read it too early. A timing race in our code.

**A note for whoever reads this next.** `feat_visits.js`,
`feat_mls_calm_shell.js`, and the `feat_mls_opnote_*` files are **site**
production files, not extension files. They are frozen because they are shared
byte-for-byte with the live site, not because they ship in the extension. The
correct move there is an overlay from the two `/1p` shells — never an edit,
and never a Fable ticket.
