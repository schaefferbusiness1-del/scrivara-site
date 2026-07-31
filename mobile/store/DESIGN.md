# Why the app looks like this

The owner's brief, in full: *"make the phone app perfect with very little buttons and just pull
and can see a patient."*

Two verbs — **pull**, and **see a patient** — and a constraint on the number of controls. This
file records what that produced and, more usefully, what it excluded and why. It exists because
the next person to work on this app will want to add something, and the argument for the cut is
harder to reconstruct than the code.

---

## What "the phone app" was before

`ScribeFlow.html?phone=1`: the 2.2 MB desktop application, in a phone-sized window, with a
28-line static CSS hide-list (`__mlsPhoneHome` ph-1.1.0, `mls-connect.js` ~46373–46600) written
at b261 and never revised against the three UI layers that landed after it.

`PHONE_AUDIT_2026-07-27.md` is the standing verdict. Seven breakages, B1–B7. Two of them are
the reason this app exists rather than a patch:

- **B2 — no visible transcript anywhere on phone.** `#transcript` killed with `#captureCard`;
  `#ez3flTranscript` killed by the phone hide list; `#ez3Transcript` killed twice over.
- **B3 — post-stop dead end.** Every recovery control lives in `.ez3-row2`, which the phone
  hides — including the `#ez3Edit` that is the only unlock for a readonly note.

The audit's own status line reads *"B-fixes not started as of b728."* Those defects are not
oversights; they are what happens when a phone experience is defined by subtraction from a
desktop one. Each new desktop feature lands outside the hide-list and has to be re-hidden by
hand, forever, and the list is invisible until a doctor is standing in a room with a dead
button.

**This app is not that.** It is a separate page with its own markup, whose every control was
put there on purpose. The old phone shell is untouched and still works exactly as it did.

---

## The three screens

```
Sign in            email, password, TOTP if the account has it.        [Sign in]
   ↓
Today              office-computer status · find a patient
                   the day's patients, in time order                   [Pull today]
   ↓ tap a row
A patient          name · age · DOB · MRN
                   visit history                                       [Pull chart]
```

Past sign-in the whole app is **two taps deep**. There is no tab bar, no drawer, no overflow
menu, no settings screen, and no home screen — because there is nothing a fourth screen would
hold that is not already on one of these three.

## The control budget

Ten, and `tests/phone-app-control-budget.test.js` fails the build if it grows:

| | control | serves |
|---|---|---|
| 1–3 | email, password, TOTP | sign in |
| 4 | the dock button | **the** action — its label is this screen's verb |
| 5 | back | leave a patient |
| 6 | sign out | leave |
| 7 | find a patient | *see a patient* |
| 8 | a patient row | *see a patient* |
| — | pull-to-refresh | *pull*, with no button at all |
| — | scroll | — |

The property that actually makes the screen feel empty is not the count; it is that **the dock
shows exactly one button, always**. There is never a choice of primary action, so there is never
a decision to make before acting.

## What was left out, and why

**No recording.** The obvious next feature, and the one this app must not grow. `phone.html` —
the MLS Recorder — already does it, pairs to a specific desktop visit with a 6-character code,
and has a hard-won volatile-audio lifecycle (`__mlsPhoneGuard` b421) that took real work to get
right. Duplicating it here would produce two ways to record, one of them worse.

**No note editing, no signing.** A signed clinical note is the most consequential thing this
product produces. Composing one on a phone, one thumb at a time, between rooms, is how a wrong
patient's text ends up in a signed note — a failure this codebase has already had once
(`STANDING_REVIEW_2026-07-30.md` finding 3). The desktop is where notes get written.

**No orders.** The relay's own header says it: *"ORDERS will NEVER be a relay kind."* Not
declined for this version — declined.

**No settings.** Every setting the app would offer is already an account-level setting that the
desktop owns. A second place to change one is a second place for the two to disagree.

**No date picker.** "Today" is the day a doctor is standing in. A phone app that opens on a
date you have to choose has already asked a question before doing anything.

## Search: the one addition that was argued for

A strict reading of the brief excludes it. It went in anyway, because *"can see a patient"*
fails without it for anyone not on today's list — and a doctor being asked about a patient in a
hallway is exactly the moment a phone is the right device.

The cost was kept to one control: an input, not a button, above a list that already exists.
Typing replaces the day list with matches; clearing it brings the day back. No results screen,
no filters, no history.

## Design decisions worth keeping

**System fonts.** `-apple-system` resolves to SF on iOS and Roboto on Android, so the app is set
in the reader's own system face at their own accessibility size, and it costs zero bytes. A web
font here would be a network dependency in a bundled binary and a stranger's letterforms in a
clinical context.

**Dark mode from the same tokens.** One `@media (prefers-color-scheme: dark)` block redefines
eleven custom properties; nothing else in the stylesheet knows the theme exists.

**Safe areas on all four sides.** Including left and right — a landscape-locked app still gets
notch insets on a rotated device, and `viewport-fit=cover` without them puts a patient's name
under the sensor housing.

**Every status is a sentence.** The office-computer line says *"Ready to pull on Front desk
PC"* or *"athenaOne is signed out on Front desk PC"*, not a green dot alone. A colour tells a
doctor something is wrong; a sentence tells them what to do about it.

**The pull reports what this phone can see.** After a successful pull the app re-reads the day
and counts the appointments that actually arrived, then says that number. It does not repeat
the office computer's claim of success. That rule is inherited from `rl-2.0.3` in
`mls-connect.js`, which learned it the expensive way, and it is the single most important
sentence in this file.

---

## One decision the owner should make knowingly

**The 15-minute idle lock.** `IDLE_MS` in `app.html`. After fifteen minutes with no touch, the
app drops the session token, wipes patient data from memory, and returns to sign-in.

Fifteen minutes is the conservative default and it is what a HIPAA automatic-logoff control
usually means in practice. It is also real friction: gaps between rooms are often longer than
that, so a doctor may retype a password several times a day on a phone keyboard — and an app
that is annoying to open is one that stops getting opened, which protects nothing.

The counter-argument is worth stating rather than assuming: the handset already locks itself in
under a minute behind a passcode or Face ID, and the app stores no patient data on the device,
so the marginal exposure this timer removes is narrower than it first appears — a phone left
unlocked, awake, and unattended with the app in the foreground.

It was left at fifteen minutes because that is the defensible choice to make on someone else's
behalf, not because it is obviously right. It is one constant. If the owner wants thirty or
sixty minutes, that is a reasonable call and a one-line change — but it should be their call,
made with the above in front of them, and it should be written down when it changes.
