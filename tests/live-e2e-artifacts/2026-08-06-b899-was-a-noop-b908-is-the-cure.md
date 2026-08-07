# 2026-08-06 — b899 was a NO-OP in production; b908 (si-1.7.20) is the real cure

**Shipped:** b908 `6289d2f7dd5f462c98ce945e359412a28adec24a`, gate PASS all 487, live-byte verified
on the origin (live served b909, which carries it).

## The report that started it

Matt's b894 error report named the arm for the first time: `scheduleReceipt {complete:true, 20/20}`,
`providerReceipt {requireStableId:true, canonicalNameFallback:FALSE, matchingRows:0,
unattributedRows:20, nameMatchedIdMissingRows:20}`, every detail row
`selected-name-no-structured-id`. His athenaOne skin exposes NO structured provider id on any row.

## Why the first fix (b899 / si-1.7.19 / mdx-2.0.0) DID NOTHING

It exempted the roster's same-name display echo only when its stableKey began `legacy-name:`.
**Ext 3.0.45 stamps every id-less schedule-header provider as `athena:<display text>`**
(`extension-candidates/3.0.45/background.js:6790` and `:6971`), and the roster preserves a supplied
stableKey verbatim (`feat_athena_provider_roster.js:315`, `:340`). So his real echo is
`athena:matthew schaeffer, md` with an empty id → b899 pushed `independent-structured-key` →
refused identically to b894, plus a new sentence blaming a same-name clinician who does not exist.

**The gate passed because the fixture was mine, not the producer's.** I hand-wrote
`legacy-name:matthew schaeffer|md` — the ONE shape my own exemption accepted. A fixture looser than
the real producer cannot distinguish a working fix from a dead one.

### The control that would have caught it in 60 seconds, now mandatory

Run the OLD code against the NEW fixture. If the old code also passes, the reproduction is fiction.

```
b899 (shipped) : {"complete":false,"reason":"provider-incomplete","rows":0,"kinds":"independent-structured-key"}
2.0.1 (fixed)  : {"complete":true,"reason":"provider-complete","rows":20,"basis":"roster-echo-collapsed"}
```

## The real cure — mdx-2.0.1

Mirror the rule the roster module already owns (`stringEchoEquivalent`,
`feat_athena_provider_roster.js:394-410`): an id-less entry is a display echo only when its
`legacy-name:`/`athena:` key body canonicalizes to the REQUESTED clinician's own token set. This
also TIGHTENS the legacy arm, which previously exempted any `legacy-name:` key regardless of whose
name was in its body. Opaque keys (`athena:prov-88217`) and any entry with an independent id still
refuse — each with an executed control.

## mdx-2.0.2 — the second axis (QA lane)

A one-axis fix left the other axis broken. A clinician whose SURNAME spells a credential —
"Anh Thi Do", also Ot/Od/Rn/Pa — produced credential signatures `{do,md}` across her OWN two roster
entries, tripped the new `credential-conflict` arm, and was blocked from **100%** of her
selected-provider imports. Measured before the fix, both roster shapes:
`{"complete":false,"kinds":["credential-conflict"]}`.

Cure: assert a credential only when **comma- or underscore-delimited**, and stop consulting the
roster's `equivalentKey` credential segment (that parse is what reads Do-as-credential). The
underscore is load-bearing — a comma-only rule would let two REAL clinicians through in athena's
machine-username form (`Schaeffer_Matthew_MD` beside `Schaeffer_Matthew_DO`). Both forms have
executed controls; after the fix her day imports 8/8 with `kinds: []`.

**⚠️ STILL OPEN, deliberately not patched:** `providerKey("Anh Do")` returns `""` — both tokens are
stripped as credential noise, leaving fewer than two — so a TWO-token credential-surname clinician
fails even earlier at `provider-unverified` and never could pull at all. Pre-existing in
`PROVIDER_NOISE`, consumed by every matching surface in the app. Needs its own change and its own
blast-radius review.

## Also carried: the template-library cache-token cure

`feat_mls_template_library.js` changed in b903/b904 while its hand-maintained loader token stayed
`20260805tl160`, so **origin/main was RED** (verified on a clean detached b904 checkout) and a
RETURNING browser kept serving the cached copy. QA measured the drift live: served 54,176 vs origin
54,214, **delta exactly 38 bytes** = `,created:Number(t.created)||Date.now()` added to `importBody`
by `fea4afb8`. Effect: cloud-imported templates saved with no `created` stamp. NOT the "Add means
add" path (that predates the token seed) and not the op-note matcher (`_opRankTemplates` lives in
ScribeFlow.html, which carries no hand-maintained token — QA's 48/48 stands; my first claim
overstated it and was retracted).

Cure: both loaders now use `?v='+(window.__MLS_AV||Date.now())`. A competing lane fixed the same
red suite by advancing the literal to `20260806tl161`; that works exactly ONCE and re-arms the trap,
while the suite still passes against any fresh literal. b907 then adopted the durable form AND added
a negative assert that a hand-maintained token cannot return — stronger than mine, so I took theirs.

## Suite gap found (open, not yet fixed)

`tests/cache-token-cannot-go-stale.test.js` compares `%cs` (a DATE) against the token's 8 digits with
strict `>`, so **a file changed the SAME DAY its token was bumped is invisible**. That is how
`feat_mls_copilot_actions.js` (`20260805ca211`) hid a missing `|| a.kind === 'appControl'` guard —
27 bytes — on the owner's browser, letting an appControl action skip its honest "still loading" wait
and navigate to the wrong screen. Coverage is NOT the problem (133 pins found; 103 correctly skipped
as untouched since the seed). Fix = commit-precise: base = later of (commit that last introduced the
token literal) and SEED `ffca4c9f`; flag any asset with a commit after that base. **Without the seed
guard the naive rule reports 25 false positives**, because the b844 parentless squash re-added every
file — do not ship the naive form.

## Process traps hit tonight (all recurrences)

- **Another lane reset my branch and destroyed uncommitted work.** `wt-ship-20260806-provfb` was
  taken over by the "athena-toast lane"; clean tree, no stash, full rebuild. **Commit before
  gating** — an uncommitted fix is one `git checkout` away from never having existed.
- **PowerShell `Set-Content` rewrote all 6,160 lines** of mls-connect.js for a one-line comment
  change. Caught in `git diff --stat`, reverted. Use the Edit tool or a node latin1 splice.
- **Origin moved five times mid-work** (b897→b909). Merge `--no-ff`, re-gate, bump ONCE, and never
  hand-claim a build number — the bumper adjudicates.
- **Merge resolution must be per-BLOCK, not `--ours`/`--theirs` per file.** `--ours` on
  mls-connect.js would have silently dropped another lane's legitimate changes. I used guarded
  latin1 splices that refuse unless both sides match what I expect.
- **vm-realm arrays fail `deepStrictEqual([])`** — compare by `.length`.

## Still open after b908

1. Extension download 410 — `sw.js` allowlists ONE literal, so every stale worker retires the
   current package. QA proved the worker does NOT roll across production deploys (three of them), so
   shipping sw.js bytes alone cannot reach an already-broken browser. Verified design: version FLOOR
   + root-only check, plus a same-origin `.bin` mirror with `download="…zip"`. No skipWaiting —
   sw.js refuses it deliberately for clinical-tab safety.
2. The false "✅ Add to Chrome — Chrome Web Store" label over a local .zip href, from
   `mls-connect.js:10277`; it also strips `download` and sets `target="_blank"`, so the click opens a
   NEW TAB onto the 410 refusal page. FIVE writers contend for that one card.
3. `providerKey` blanking two-token credential surnames (above).
4. The cache-token suite's date granularity (above).
5. Unowned, raised to the athena-notification lane: after the b901 removal a FAILED athena read shows
   **no indicator at all**, making `#mlsAthenaDoctorBtn` the only discovery path.

## The verdict that is NOT in hand

Nothing here proves the cure on the reporting clinician's Mac. His next pull receipt is the only
instrument that can, and it now names the deciding arm either way
(`canonicalNameFallbackBasis` / `rosterSameNameCount` / `sameNameConflictKinds`).
