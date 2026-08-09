# 018 — the rename is finished except for one address, and that one is an outage if you touch it

Lane: `claude/phone-ph2-fixpack-20260808` + `claude/rename-sweep-20260808`.
Shipped and **live**: b975, b978, b981, b983. Both branches are fully merged to
`main`; nothing of this lane is outstanding. Verified live at b990 after seven
other lanes shipped on top.

Extends 017. **Read this before you write the old brand name anywhere, and
before any sweep that "finishes the job".**

---

## 1. ⛔ THE ONE STRING THAT MUST NOT MOVE

```
scrivara-backend.onrender.com          (186 references, all deliberate)
```

**It is an address, not a brand, and it answers HTTP 200.** Renaming it in the
client does not rename the server — it points every login, every Athena pull,
every note save and every relay job at a hostname that returns 404. That is not
a rename, it is a total outage, and it looks exactly like a successful deploy
until the first doctor tries to sign in.

`tests/one-product-name.test.js` asserts that host is still **PRESENT**, in
`mls-connect.js`, `app.html` and `mobile/app.config.json`. That assertion is not
an oversight — it exists so a later sweep cannot go green while taking the
product down. **Do not delete it. Do not "fix" the host.**

`mlsscribe-backend.onrender.com` currently 404s, so the name is free.
`RENAME_THE_API_HOST.md` (repo root) is the two-option runbook. Option B —
attach `api.mlsscribe.com` as a custom domain FIRST — is the one to take:
installed Assist extensions carry the host in `host_permissions` and keep the
OLD manifest until they update, so a hard cutover breaks the office computer
that runs every relayed pull. Owner action; the client flip is one build after.

Also owner-only: the GitHub repo is still literally named `scrivara-site`, so
the ~15 source comments naming it are correct as written. Sweep them only after
the repo is renamed.

---

## 2. WHAT MOVED, INCLUDING THINGS THAT ARE NOT STRINGS

| | from | to |
|---|---|---|
| bundle id | `com.scrivara.app` | `com.mlsscribe.app` |
| Android Java package **directory** | `java/com/scrivara/app/` | `java/com/mlsscribe/app/` |
| store app localStorage | `scrivara.session.v1`, `.lastEmail.v1` | `mlsscribe.*` |
| gradle release marker | `// scrivara: release config` | `// mlsscribe: release config` |
| npm package | `scrivara-mobile` | `mlsscribe-mobile` |
| CI artifacts / signing profile | `scrivara-{ios,android,www}`, `Scrivara.mobileprovision` | `mlsscribe-*`, `MLSScribe.mobileprovision` |
| contact | `hello@scrivara.ai` | `hello@mlsscribe.com` |

**The bundle id was still free** — `mobile/store/RUNBOOK.md` describes the store
upload as a future step, and an id is permanent from the first upload onward.
If you are the lane that does that upload: it is `com.mlsscribe.app` now, and
after your first build it can never change again.

**Three of these needed more than a replace, and each is pinned:**

- **the storage keys carry a MIGRATION.** Renaming them bare signs every
  installed phone out on the next deploy — silently, on an app whose whole job
  is to be already signed in when it is picked up between rooms. It adopts only
  into an EMPTY key (a leftover must never overwrite a live session) and clears
  the old one. It is written LONGHAND, twice, because
  `tests/phone-app-boundaries.test.js` proves the app persists nothing but two
  keys by matching the IDENTIFIER at every `setItem` call site — a table-driven
  loop writes a computed key, which is unprovable. **The duplication is the
  proof; do not tidy it into a loop.**
- **the gradle marker and `configure-native.mjs` are ONE contract.** The script
  greps for the marker it writes. Rename either alone and it re-injects the
  whole release block on every run.
- **the Java package directory moved with the id.** A `package` declaration that
  does not match its path does not compile.

---

## 3. 🚨 THE BUILD BUMP REWRITES HEX COLOURS — MASK THEM

`#b9770a` is a real amber used 6× in the payments UI. At b976→b977 a plain
string replace turned all six into `#b9780a` — a silently different colour, in
a repo that already keeps a registry of this exact collision. A diff caught it;
nothing else would have.

**Mask `#[0-9a-fA-F]{6}` literals before replacing the build token.** And when a
*pre-existing* colour collides with the new number, register it in
`PREEXISTING` in `tests/hex-colour-integrity.test.js` with its count and why —
`main` went red on its own hex gate at b979 (`#8b9791`) and again at b986
(`#2fb986`) because the number caught up to a colour nobody had registered.

Two more, for whoever writes the next bump script:

- **`git grep -c` counts LINES, not occurrences.** Building an expected-count
  map from it makes the script bail part-way with some files already rewritten.
  Count per file with `s.split(tok).length-1`.
- **the file set drifts every few builds.** `sw.js` no longer carries `bNNN`;
  `tests/hex-colour-integrity.test.js` and a HANDOFF doc now do. Enumerate with
  `git grep`, never trust a template list — including the one in
  `.claude/skills/mls-build-ship`, which is stale on both counts.

---

## 4. 🚨 A `git checkout --` RECOVERY DISCARDS UNSTAGED WORK

Recovering the corrupting bump above, I ran `git checkout --` over the files it
had touched. That restores from the INDEX — and an unstaged comment sweep of
those same three files went with it. 24 occurrences shipped as b978 because of
it. **Check what a recovery is about to DISCARD, not only what it restores.**

And the gate that should have caught them could not: `one-product-name` stripped
comments from EVERY file so the files explaining the rename would not trip it.
That exemption covered the whole repo. It is now a **one-entry named list**.
If you add a file that legitimately must name the old brand, add it there
explicitly — do not widen the rule.

---

## 5. WHAT THIS LANE OWNS, FOR ANYONE TOUCHING IT

`feat_mls_phone_ui.js` (ph2-1.1.0) — the phone app. It calls, never
reimplements: `openSettings()`, `logout()` **with no argument** (`logout(true)`
skips the unsynced-note stop), `loadCalendar({fresh:true})`,
`__mlsDaySwitch.setDay()`, `__mlsEasyV32.remote.*`, and
`GET /api/avatar/checkins?status=ready`.

⚠️ **Avatar lane:** that endpoint now has TWO readers — `app.html` and this
module. If the row shape changes (`id, headline, bullets[], summary, askAbout[],
flags[], inProgress, patient_external_id, ready_at, turns, audited`), two
readers move. Nothing here writes, and nothing depends on your composition work.

⚠️ **Anyone holding a timer handle:** test it with `!== null`, not truthiness.
A handle of `0` is falsy, so "stop" silently skips the clear and "start" sees a
running timer as absent — two watchers, both re-arming, forever. Three sites in
this module had it.

Reversible: `window.__mlsPhoneUI.revert()` hands the screen back to
`__mlsPhoneHome` untouched.
