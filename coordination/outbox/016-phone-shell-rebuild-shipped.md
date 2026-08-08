# 016 — the ScribeFlow phone shell was rebuilt, and three device-role rules changed under it

Shipped at **b964** (PR #19), owner-authorised merge to `main` / live.
Branch: `claude/phone-app-ui-redesign-0kp2qz`. Reverts: see the bottom.

**Read this if you touch `mls-connect.js`, `ScribeFlow.html`, the relay, the
device-role module, or anything that reads `mls_device_role` /
`mls_phone_mode`.** Four things moved that are not local to a new feat file.

## What this lane did NOT touch

Lane 014's `app.html` ("Scrivara", the small store app) and `phone.html` (the
MLS Recorder) are both untouched — no byte, no route, no manifest. 014's claim
said it was "not fixing that hide-list" and left ScribeFlow's phone shell
"still owned by whoever wants it". This is that shell, and only that shell.
The two surfaces are now presented as a choice rather than as rivals: the
phone UI's Setup screen links to Scrivara, and `phone-setup.html` installs
Scrivara with the workspace offered as the quieter second route.

No pull file and no extension file changed. `__mlsSI`, the pull engine, the
import ledger, `content.js` and every candidate build are as they were.

## 1. `body.mls-phone` is no longer the phone experience

`feat_mls_phone_ui.js` (`ph2-1.0.0`, `window.__mlsPhoneUI`) renders an opaque
full-screen frame at **z-index 7000** and owns the phone. `__mlsPhoneHome`
stays installed and its 28-rule CSS layer is untouched — it simply stands down
(`newUiOwns()`) while the new UI is mounted, and resumes the moment
`__mlsPhoneUI.revert()` is called or the device stops qualifying.

**If your module renders phone chrome, check its z-index.** 7000 sits above
every app view (5000/6000) and the dock (920) and BELOW every modal, overlay
and toast (9000+) — deliberately, so confirm cards and toasts still reach the
doctor. Anything you add in the 7000–8999 band on a phone will be covered.

The new UI performs no clinical work of its own. Record / stop / generate /
send / open-a-patient all route through `__mlsEasyV32.remote`, and the pull
through `__mlsDaySwitch.pullDay()`. If you change those signatures, this
module follows them rather than duplicating them — which is the point.

## 2. `__mlsEasyV32.remote.snapshot()` gained a field

`warn: S.lastWarn || ''`. Read-only, additive; the desktop still renders
`lastWarn` exactly as before. It exists because a remote surface that cannot
read it paints a refused button with no reason beside it. **Do not remove it
without giving remote callers another route to the refusal sentence.**

## 3. Three device-role rules changed (`dr-1.3.0` → `dr-1.5.0`)

This is the part most likely to surprise another lane, because it changes what
stored values MEAN.

- **`role()` refuses an unhonourable role.** `office` on a device where
  `canHostExtension()` is false (iOS / iPadOS / Android) now reads as `null` —
  "not chosen" — instead of `'office'`. `setRole('office')` refuses there
  outright with a toast. `roleRefused()` reports it for display.
  *Why:* the owner's iPhone had `office` stored. `wantPhone()` answers
  `r === 'phone'`, so that one value was a hard NO to every phone layer that
  has ever existed, AND it aimed every relayed Athena pull at a device that
  cannot run the extension. `canHostExtension()` has known this since
  `dr-1.2.0` (written after observing that same phone at b853); all that fixed
  was the wording of the complaint.
- **A handheld self-adopts.** `adoptObviousRole()` stores `phone` at install
  from mobile UA + touch, and the "What is this device?" card no longer
  appears on handhelds. Ambiguous devices — every desktop, and iPads, which
  report as Macintosh — still get the card, because office vs secondary is
  real judgement the app cannot infer. **`dr-1.0.0`'s rule is intact and
  pinned: geometry never classifies.**
- **Layout is now separate from role.** New key `mls_layout_pref` =
  `auto` | `full` | `simple`, exposed as `layoutPref()` / `setLayoutPref()`,
  and **read FIRST in `wantPhone()`** — above the `mls_phone_mode` session
  flag and above the role. `auto` is the default and inert.
  *If you read `mls_phone_mode` directly, stop.* It is now the older of two
  channels for the same intent, and `setLayoutPref()` clears it on write.
  Ask `__mlsPhoneHome.wantPhone()` or `__mlsPhoneUI.owns()`.

Settings → Integrations → **This device** asks both questions in plain words
(🖥 Desktop / 💻 Laptop / 📱 Phone, and Automatic / Full app / Simple phone
app). The old buttons said "Office computer / Secondary computer / Phone /
remote" — relay role names a doctor holding a laptop had to translate.

## 4. Device wording has one owner

`__mlsDeviceRole.deviceNoun()`. The relay bar read `📱 Phone mode` on every
relaying device including MacBooks, and four pull-outcome messages in
`pollJob()` said "this phone" the same way. They now name the device.
**Any new sentence about the current device should ask `deviceNoun()`** —
`tests/an-iphone-cannot-be-the-office-computer.test.js` and
`tests/phone-app-is-its-own-app.test.js` both assert against the hard-coded
forms coming back.

## Also changed, and worth knowing

- The Settings → Integrations QR now encodes **`phone-setup.html`**, not
  `ScribeFlow.html?phone=1`. The setup email carries the same link. New public
  page, registered in `_config.yml`, `sw.js`, the boundary suite and
  `pages-publication-inventory.json`.
- `tests/device-role-contract.test.js`'s width ban now grades
  **comment-stripped** source (and covers `outerWidth` / `clientWidth` /
  `max-width` media queries). The rule is about what the code reads, not what
  the file may discuss — the comment naming the banned signal was failing the
  rule it described. Same correction as the `__mlsKbd` assertion in
  `phone-install-contract`.
- `#f5b942` is pinned in `hex-colour-integrity`: the build number reached a
  real colour, and two of its three occurrences live in a file this bump
  edited.
- `CEILING` 257 → 258 and `EAGER_CEILING` 168 → 169 in
  `boot-script-budget`. The eager arm moves for this module ALONE, on purpose:
  its loader is device-gated, so a desktop never requests the file, and
  deferring it would flash the desktop chrome before replacing it. The
  reasoning is written above `CEILING`.

## Known gaps, stated rather than buried

- **Nothing here has been verified on a real handheld.** Every claim is from
  the 518 local suites and from reading the code. The July audit's own bar is
  375×812 and 390×844 on a device. That has not happened.
- `tests/background-all-visits-cleanup-serialization.test.js` is **flaky under
  CPU load** and it is not this lane's. Verified by checking out clean `main`,
  running four copies concurrently, and watching one exit 1. It will
  intermittently redden CI for everyone until someone owns it.
- The owner's phone also shows `⚠️ Local storage … patient changes could NOT
  be saved`. Untouched here, unrelated, and it means writes are failing on
  that device. Whoever picks it up: it is visible in his 2026-08-07
  screenshot.

## Reverting

`window.__mlsPhoneUI.revert()` hands the phone screen straight back to
`__mlsPhoneHome`, which is still installed and still correct. The device-role
changes are in `mls-connect.js` and revert with the commit. The layout
preference is inert when absent, so removing the Settings control strands
nothing.
