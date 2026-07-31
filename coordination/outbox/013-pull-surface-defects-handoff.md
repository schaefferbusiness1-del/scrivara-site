# 013 — Three pull-surface defects, found and NOT fixed. For whoever owns the pull.

**From:** integration lane (b820–b823)
**Status:** all three are LIVE on `main` right now. I proved each by execution, wrote
the fixes, and **reverted them unshipped** because the owner drew a boundary:

> "Don't touch any of the pull stuff or extension stuff"

I am handing them over rather than leaving them in my 49KB claim file where nobody
will find them. Each has a one-command reproduction. Nothing here is speculative.

---

## 1. The pull tells the doctor the OPPOSITE of what it does

`feat_mls_centerpiece.js` prints this in **three** places — under "Pull today's
patients", under "Pull this week's patients", and in the live progress line while
the pull is running:

> "Pulls all providers for now (the per-doctor filter needs the next MLS Assist
> update)."

**In production that is false.** `feat_mls_schedpull_fix.js` ships. Its
`chooseTarget()` resolves the doctor through `__mlsAthenaProviderScope`, and
`scopeRows()` then keeps only that doctor's rows. So a doctor who has set their
provider name in Settings is told they are getting the whole schedule while the
pull is filtering to them alone — in the direction where **a short day reads as the
real day**. That is the failure mode most likely to make someone distrust the app.

**Root cause of the staleness.** The only code that ever corrected that note is in
`feat_athena_provider_picker.js` — its own comment says "gently update the
centerpiece's hardcoded note" — and that module is loaded by
`mls-connect.staging.js` and **not by production**.

```
grep -n "ALL_PROV_NOTE" feat_mls_centerpiece.js          # 3 emitting sites
grep -c "feat_athena_provider_picker.js" mls-connect.js  # 1 = a comment, no loader
grep -n "feat_athena_provider_picker" mls-connect.staging.js
```

## 2. The same root cause disables an entire "one source of truth" block

`feat_mls_protocol.js` has a section headed
**"PROVIDER-NAME-EVERYWHERE (one source of truth, live-updated)"**. It opens:

```js
function syncProviderName(force) {
  if (!window.__mlsProviderPicker) return;
```

`__mlsProviderPicker` is defined **only** in `feat_athena_provider_picker.js:401`,
the staging-only module. So on the live site this synchroniser never runs, and its
caption keeps telling a doctor to *"Set your provider name in Settings"* — including
doctors who already have.

Second, smaller bug in the same function: the dedupe key is the *pick*
(`if (!force && pick === _provLastPick) return;`). In production the pick is
permanently `'mine'`, so even if the early return were removed, the caption would be
written once and never corrected when the doctor changes their name. Key it on the
resolved caption instead.

```
grep -rn "window.__mlsProviderPicker *=" --include="*.js" . | grep -v tests
grep -n "if (!window.__mlsProviderPicker) return" feat_mls_protocol.js
```

**The provider IS resolvable in production** without the picker:
`__mlsAthenaProviderScope.detectProvider()` ships and is the same ladder
`chooseTarget()` walks. Reading that makes the caption and the behaviour agree by
construction.

## 3. Four modules address one doctor three different ways

Each guesses a family name out of a provider string with its own algorithm.
**Executed**, not reasoned about:

| provider name | picker (longest token) | scope (last token) | narration (comma-strip) |
| --- | --- | --- | --- |
| `Schaeffer, Michael` | Dr. Schaeffer | **Dr. Michael** | **Dr. Michael** |
| `Christopher Ng` | **Dr. Christopher** | Dr. Ng | Dr. Ng |
| `SMITH, JOHN A` | Dr. Smith | **Dr. John** | **Dr. A** |
| `Jane Doe, PA-C` | **Dr. Jane** | Dr. Doe | **Dr. PA-C** |
| `O'Brien, Katherine` | **Dr. Katherine** | **Dr. Katherine** | **Dr. Katherine** |

- `Dr. A` is a **middle initial**.
- `Dr. PA-C` is a **credential**.
- Addressing a physician assistant as "Dr." **asserts a licence they do not hold** —
  the only one of these that misrepresents a credential rather than merely reading
  wrong.
- athenaOne returns provider names in **`LAST, FIRST`**, so the two last-token
  modules are wrong on their *commonest real input*, not on an edge case.

Sites: `feat_athena_provider_picker.js:67`, `feat_athena_provider_scope.js:183`,
`feat_athena_narration.js:208/219`, `feat_mls_schedpull_fix.js:154`.

`feat_athena_narration.js:220` also carries a comment claiming the comma form is
*"handled by comma-strip above"*. **Stripping a comma does not reorder a name**, so
it never was.

## 4. Bonus, same area: the schedule scope takes the LOGIN name

`feat_athena_provider_scope.js detectProvider()` reads
`unsGet('docname')` — the raw login/account name, **ungated** — as its second rung.
That value decides **which rows a pull keeps**. On a staff or shared login it scopes
a clinician's day by the front-desk person's name.

The shell already has the right primitive: `clinicalProviderName()` owns the single
account-name fallback and gates it on there being no verified roster. Routing this
rung through it makes the failure mode "pull everyone" (safe, and `scopeRows()`
already reports `reason: 'all'`) instead of "narrow to the wrong person".

---

## What I would do, if it were mine

1. One shared display formatter, in the shell beside `clinicalProviderName()`. Rules
   that are defensible rather than another guess: a trailing comma segment made only
   of credential tokens is a credential, not a name; a surviving comma is
   `LAST, FIRST`; otherwise last token; "Dr." only when nothing contradicts it, and
   **never** over a non-doctoral credential. Re-case only when the whole name is
   uniformly cased, so `van der Berg` and `McDonald` survive.
   *(Deciding case per TOKEN rewrote `van der Berg, Pieter` to `Dr. Van Der Berg` —
   that trap cost me a round.)*
2. All four modules defer to it; where it is absent, show the name **as given** —
   never a second local algorithm, which is how these four drifted apart.
3. **Leave `surname()` alone.** It is the MATCHING primitive `provMatch()` depends on
   to decide whether an appointment belongs to the picked doctor. Matching and
   addressing are different jobs, and routing a matcher through a formatter that
   title-cases and adds honorifics will break scoping.
4. Make the note resolve through the same ladder the pull walks, so the note and the
   behaviour cannot disagree. Test it by feeding both one resolver and asserting they
   name the same clinician.

I had all of this working with 10 mutations verified before reverting it. If you want
the reverted diff rather than re-deriving it, it is in this session's history — ask
and I will hand it over as a patch instead of prose.

— integration lane
