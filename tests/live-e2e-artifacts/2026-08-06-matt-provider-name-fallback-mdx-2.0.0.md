# 2026-08-06 — Matt's Mac selected-mode pull ROOT-CAUSED and CURED site-side (mdx-2.0.0, si-1.7.19)

## The field report that decided it (b894, ext 3.0.45, owner-forwarded ~16:00 ET)

Exactly the report b881's diagnostics were built to produce. The deciding numbers:

- `scheduleReceipt {complete:true, expected:20, parsed:20}` — the grid read is PERFECT.
- `providerRosterReceipt {complete:true, providerMode:"selected"}` — roster verified at pull time.
- `providerReceipt`: `requested:"Matthew Schaeffer"` (NO credential — note this),
  `rosterVerified:true`, `requireStableId:true`, **`canonicalNameFallback:false`**,
  `matchingRows:0`, `unattributedRows:20`, **`nameMatchedIdMissingRows:20`**,
  `discoveredProviders:["Matthew Schaeffer, MD"]`, every detail row
  `{shape:"selected-name-no-structured-id", hasName:true, nameMatchesSelected:true, hasId:false}`.

So: his athenaOne skin renders the schedule with display names and **zero structured provider
ids anywhere** — shape 2 of the b881 diagnosis, definitively. Windows "works" because the owner
pulls in ALL-providers mode, which never enters the `requireStableId` branch; Matt is the only
selected-mode user. The extension is NOT the variable — owner directive stands that his Mac
never gets another extension build (3.0.45 is final there); the cure had to be site-side, and is.

## Why `canonicalNameFallback` was false — the elimination chain (code-read, current main)

`resolveProviderRequest` (feat_mls_schedimport_exact.js) runs BEFORE `scopeProviderRows` on every
selected pull and requires `roster.getReceipt().complete === true` plus a UNIQUE
`roster.resolve(selection)`; `req.id`/`req.stableKey`/`req.name` are copied from the resolved
roster entry seconds before the scope gate runs. Then, in the old fallback:

```js
canonicalNameFallback = canonicalSameName.length === 1 && (id agrees || stableKey agrees)
```

- `resolveProvider()` itself calls `listEntries()` — so if `list()` were empty/throwing, the pull
  would have refused UPSTREAM (`provider-roster-incomplete`), not with Matt's receipt. list() was
  alive and contained his entry.
- `listEntries()` returns full shallow copies (every key, id and stableKey included) — no shape
  drift between resolve() and list().
- Therefore the requested entry IS in `canonicalSameName` with agreeing id — the ONLY way the
  conjunction fails is **`canonicalSameName.length ≥ 2`**.

Mechanism of the duplicate: the roster's dedup/echo-collapse keys on `equivalentKey`
("base|credential|staff" — **credential-aware**), while the scope gate's `providerKey()`
**strips credentials** (PROVIDER_NOISE). A credential-less display string ("Matthew Schaeffer",
exactly what his skin renders and exactly what his receipt shows as `requested`) ingests as its
own `legacy-name:` entry that can NEVER collapse into "Matthew Schaeffer, MD" upstream (different
equivalentKey), yet counts as the same providerKey downstream → length 2 → fallback false →
20/20 name-matched rows unattributed → `provider-incomplete`, deterministically, forever.

## The cure (owner-ordered: "default to just name if it has to but make sure everything else still works")

`feat_mls_schedimport_exact.js` si-1.7.18 → **si-1.7.19 (mdx-2.0.0)**, scope-gate fallback only —
the row loop is untouched:

The name fallback engages iff the requested clinician is LISTED (id or stableKey agreement with
some same-name entry) AND every OTHER same-providerKey entry is provably a display echo of that
same clinician:
- no independent structured id (`entry.id` nonempty and ≠ requested ⇒ refuse, `independent-id`),
- no independent non-legacy stableKey (`athena:*`/`backend:*` foreign key ⇒ refuse,
  `independent-structured-key`),
- no conflicting credential (`credential-conflict`): credentials come from the roster's own
  `equivalentKey` segment when present, else a TRAILING-token parse of the name
  (`providerCredentialSignature`; titles like "Dr" never count; the parse prefers equivalentKey
  precisely so a surname like "Do" is not mistaken for the DO credential on live entries).
  ≥2 distinct nonempty signatures across the same-name set ⇒ possibly two humans ⇒ refuse.

Disclosure (receipt + emailed report via dsDiagReport): `canonicalNameFallbackBasis`
("roster-unique" | "roster-echo-collapsed" | "requested-name-not-listed" |
"requested-entry-not-listed" | "same-name-identity-conflict"), `rosterSameNameCount`,
`sameNameConflictKinds`. PHI-free: constants and counts. If Matt ever refuses again, the next
report names the arm instead of a bare `false`.

Refusal message: the name-matched arm now branches — a true same-name-identity-conflict says the
roster carries more than one distinct clinician under the name and routes to Choose a provider;
the generic arm names the basis token. Both keep the error-report routing sentence (pinned).

## Proofs (all local, per the owner's "no athena/browser needed")

`tests/provider-incomplete-diagnostics-contract.test.js` section 8 (new):
- **8a b894 replay**: real entry + credential-less `legacy-name:` echo, 20 name-only rows →
  `complete:true, provider-complete, rows 20, basis "roster-echo-collapsed", conflicts []`.
- **8b independent-id**: second "Matthew Schaeffer, MD" with its own backend id → refuses,
  `provider-incomplete`, basis `same-name-identity-conflict`, kinds include `independent-id`,
  `nameMatchedIdMissingRows 20`, rows 0.
- **8c MD vs DO** (id-less echoes, equivalentKey path) → refuses, `credential-conflict`.
- **8d no-equivalentKey entries** (trailing-token parse path) → same refusal.
- **8e unique-name regression** → still cures, basis `"roster-unique"`.
- Section 2 extended: Alex-Morgan not-in-roster pin now also asserts basis
  `"requested-name-not-listed"`. Section 6: the dsPick envelope pin carries the 3 new fields.

Version pins moved deliberately: ext-update-hint-contract (VERSION string) and
schedule-identity-adversarial-runtime (api.version) → si-1.7.19.

Suites green pre-gate: provider-incomplete-diagnostics, provider-day-pull-contract (UNTOUCHED —
its duplicate-name id-isolation pins and the id-less refusal pin at its Alex-Morgan fixture hold
as-is), ext-update-hint, schedule-identity-adversarial. Full run-all gate: launched (result in
the ship section below / coordination top).

## Traps (recurrences + new)

- **vm-realm deepStrictEqual**: `assert.deepStrictEqual(vmArray, [])` FAILS — "same structure but
  not reference-equal" — the receipt array's prototype belongs to the vm realm. Compare by
  length/includes. (Known class from the b891 concurrency work; second bite.)
- **Bump-collision race, live**: copilot round-11 posted an av-5.2.0 intent expecting b897
  ~simultaneously with this lane's intent. Protocol applied: both lanes bump post-fetch, the
  bumper adjudicates the number, second-lander merges --no-ff and re-bumps. Watch for it on push.
- **The truncated status line in the emailed report** (`lastStatuses` cuts ~160 chars) is capture
  truncation, not the app message — the full sentence lives in the UI and now names the basis.
- GitHub Actions outage (from ~16:07Z) pins live at b894; this ship QUEUES behind b895/b896 and
  serves automatically on recovery — verify `app-version.json` then, not on push.

## Ship state

- Worktree `dispatch-work/wt-ship-20260806-provfb`, branch `ship/provider-name-fallback-20260806`
  off origin/main `e3d48d1e` (b896). Files: feat_mls_schedimport_exact.js, mls-connect.js,
  3 test files. Commit/bump/push recorded at the coordination top when they happen.
- **What Matt does when live serves the new build: reload mlsscribe.com once, pull. Nothing to
  install.** Expected receipt on his machine: `canonicalNameFallback:true, basis
  "roster-echo-collapsed"` (or `"roster-unique"` if his roster meanwhile self-healed), 20/20
  imported. If it refuses again, the report now says exactly why.
