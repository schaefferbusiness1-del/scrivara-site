# Standing rule: every promotion to the main site sends an update email

Owner instruction, 2026-08-16: *"whenever we add new features to main site I want an
email sent out of all the updates that were done. Also the email should be auto sent
to all the people with email addresses with mlsscribe.com."*

## When this fires

On every promotion **into the main site** — that is, any change that reaches
`ScribeFlow.html` / `mls-connect.js` / the production `feat_*.js` set, or the
moment `/cloned` is promoted to become main.

It does **not** fire for `/1p` work. `/1p` is the testing ground; it changes
constantly and an email per `/1p` train would train everyone to ignore the mail.

## Who it goes to

Every `@mlsscribe.com` address. That list is not hardcoded here on purpose — it
must be read at send time from the current account/staff roster, or a departed
person keeps receiving release mail and a new hire never does.

## What the email must contain

1. **What changed, in one line each, in the doctor's language.** "Prep Op Notes
   now opens one patient at a time" — not "msl-1.0.0 selector registry".
2. **What a doctor has to do differently.** Usually nothing. Say "nothing" when
   it is nothing; that is the most useful sentence in the mail.
3. **Anything that needs an extension update.** Almost always "no". If yes, say
   the version and that it will prompt.
4. **What was fixed** — name the symptom the doctor actually reported, so the
   person who reported it recognises their own bug.
5. **The build stamp and the date**, so a support conversation can start from a
   known version.
6. **Who to reply to.** A release mail with no reply path is an announcement,
   not support.

## What it must NOT contain

- **No PHI.** Ever. Not in an example, not in a screenshot, not in a bug
  description. "A patient's chart" — never a name, DOB, MRN, or appointment.
- No internal build tokens, file names, commit SHAs, or test counts. Those
  belong in the diagnostics report, not in a doctor's inbox.
- No unverified claims. If something is fixed but not yet proven on a real
  account, say "improved" and say what is still being watched.

## The approval step — deliberately not automatic

The email is **drafted automatically and sent only after the owner approves it.**

This is a deliberate constraint, not an oversight. Sending mail to every
clinician at a practice is an outward-facing action with no undo, and a release
note that is wrong or that leaks a patient detail cannot be recalled. The draft
is the automation; the send is a decision.

Practically: the release process generates the draft and surfaces it. The owner
reads it and says send. If the owner wants a specific release sent without
reading it, that is his call to make per release — it is not a default.

## Where this sits in the release sequence

1. Gate green (`node tests/run-all.js`, all suites).
2. Land the change; bump the frozen baselines in their own commit.
3. Push and confirm the live site serves the new build.
4. **Verify the change on a real account** — not just that it deployed.
5. Draft the release email from what was actually verified in step 4.
6. Owner approves.
7. Send.

Step 5 depends on step 4 on purpose. The email describes what was *proven*, not
what was *intended*.
