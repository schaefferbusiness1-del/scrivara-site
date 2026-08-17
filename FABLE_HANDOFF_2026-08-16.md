# For Fable — extension work only

Everything else from the 2026-08-16 launch train was fixed **site-side**, on
`/1p`, with **no extension change**. That was the owner's constraint and it
held: the released **3.0.61** bytes are untouched, and
`tests/1p-preview-contract.test.js` byte-freezes them against
`a1903ff12128d36acaa615f43bb394f6b14c5e20` so a future train cannot move them
by accident.

**Do not ship an extension update for any of the UI work.** None of it needs one.

There are exactly two items that are genuinely extension territory.

---

## 1. The provider roster never reaches "verified" — HIGH

**The contradiction.** In the owner's 2026-08-21 pull report, one receipt says
the roster is complete and two say it was never verified:

```
providerRosterReceipt: { complete: true, expectedCount: 1, observedCount: 1, providerMode: "all" }
preflightReceipt:      { rosterComplete: FALSE, providerResolved: false, scopeSource: "caller" }
providerReceipt:       { rosterVerified: FALSE, complete: true, discoveredProviders: ["Matthew Schaeffer, MD"] }
```

Both cannot be true. Something observes 1 of 1 expected providers and still
reports the roster unverified.

**Why it matters beyond a cosmetic flag.** `#mlsCalProviderPull` — the
calendar's "Choose a provider to pull" — is **permanently disabled** on this
practice because it needs `__mlsProviderRoster.getReceipt().complete`. The
site-side path `pullCalendarSelection()` needs the same thing, so a
provider-scoped calendar pull is unreachable on this account today. The site
lane worked around it (the hero now freezes the chip scope and passes it into
`dayPull` explicitly, and the dead disabled button is hidden rather than left
sitting there), but the underlying roster verification is still broken and
that workaround is a workaround.

**What to determine:** why verification never completes when the observed
count already equals the expected count. Is the verifier waiting on a signal
that never arrives on a single-provider practice? Is `rosterComplete` reading
a different receipt than the one being populated? Is it a timing race where
preflight samples before the roster settles?

**Reproduce with:** owner's account, day `2026-08-21`, provider mode `all`,
extension `3.0.61`.

---

## 2. `_assistReadChart` cannot receive an owner token from the today-note path — MEDIUM

**Already worked around site-side; a cleaner extension-side fix may exist.**

`/1p` has a single-owner Athena read lease. The schedule pull claims it and
threads its token through its own five `_assistReadChart` calls. The
today-note leg does not use those — it goes
`__mlsVisitSavePref.runForPatient` → `feat_visits.js` →
`_assistReadChart(target, cb)` **with no options object at all**. With no
token the reader attempted a fresh `claim()`, lost to the lease the very same
pull was holding, and refused. That is the
`"pull-in-flight: another Athena read or schedule pull is active"` on all six
rows in the owner's report, with `todayNoteFailures: 6`.

**The site fix (shipped, commit `fed96564`).** The pull publishes its token as
a *loan*; a caller arriving with no token joins the live lease rather than
competing with it. It is a join, not a bypass: the loan is honoured only while
`leaseMgr.owns(loan)` is still true, and a borrowing read never releases a
lease it does not own.

**Whether Fable needs to do anything.** Probably not urgently — the site fix
removes the cause. But if the extension is going to grow more read paths, it
is worth deciding whether lease participation belongs in the extension bridge
rather than being reconstructed on the site side each time a frozen file sits
in the call path.

**Also still narrow, and site-side, so NOT Fable's:** the inline retry fuse in
`1p-feat_mls_schedimport_exact.js` does not recognise `pull-in-flight`, which
is why all six rows failed rather than one failing and the rest retrying. The
loan removes the cause; the fuse is still too narrow and should be widened by
whoever next touches that file.

---

## What is explicitly NOT Fable's

- Op Notes simplification, the taskbar/dock, the calendar, the avatar, the
  laptop layout — **all site-side, all shipped, no extension involvement.**
- `feat_visits.js`, `feat_mls_calm_shell.js`, `feat_mls_opnote_*.js` — these
  are *site* production files, not extension files. They are frozen for a
  different reason (they are shared with the live site), and the correct move
  there is an overlay from the two `/1p` shells, not an edit.
