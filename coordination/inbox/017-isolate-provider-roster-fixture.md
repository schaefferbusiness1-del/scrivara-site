# 017 - Isolate provider-roster state in the account-boundary smoke fixture

## Measured problem

After proposal 016 lets the isolated browser smoke gate reach later checks, the
gate fails deterministically at `tests/live-synthetic-smoke.js:1366` on both the
clean `69713bb8` source and the post-015 preflight snapshot.

The account-boundary fixture expects its pre-boundary provider array to contain
only `Account A Provider`, but it also contains `Synthetic Provider, MD`.

This happens before the Account A to Account B switch, so it is not evidence of
a cross-account product leak:

- the preceding date-matrix fixture creates Account A appointments with
  `Synthetic Provider, MD` at `tests/live-synthetic-smoke.js:1006`;
- `feat_athena_provider_roster.js:552-566` intentionally discovers providers
  from current appointment rows;
- the canonical roster stores those entries in the account-scoped
  `mlsProviderRosterV2`, `mlsSchedProviders`, and
  `mlsProviderRosterReceiptV2` keys;
- `feat_athena_provider_roster.js:412-535` additively merges stored entries back
  into the calendar provider array; and
- the account-boundary fixture replaces only the transient array before opening
  the canonical Easy owner, so the same-account cached fixture provider returns
  before the pre-boundary snapshot.

The later assertions already require the provider array and visible choices to
be exactly empty at the synchronous Account B boundary and after the delayed
Account A response. Those are the actual isolation contracts.

## Change

Change only the synthetic browser fixture.

At the start of the date-matrix fixture that creates the synthetic provider,
snapshot and clear:

- `_calProviders`; and
- the three account-scoped provider-roster cache entries.

In that fixture's existing cleanup, restore the provider array and every cache
entry exactly, including each absent state.

The exact pre-boundary provider assertion remains unchanged. Production roster
discovery, persistence, and account-boundary behavior are unchanged.

## Expected effect

- The date-matrix fixture cannot contaminate the next test.
- The account-boundary fixture starts from the one provider it explicitly
  seeds.
- The exact pre-boundary assertion remains meaningful.
- The existing exact-empty boundary assertions continue to detect any
  same-tab Account A to Account B provider leak.
- The smoke gate can proceed to later workflow checks.
- The synthetic Account A session is restored byte-for-byte at fixture cleanup.

## Risks

Low and test-only.

The cache names are the three constants owned by the canonical provider-roster
module. Values and the provider array are restored before the date-matrix
fixture reopens Easy Home. A failed assertion still terminates an isolated
temporary browser profile, so no production or persistent user state is
involved. No live route, patient data, extension source, or runtime source
changes.
