# sj-2.0 design: patients off localStorage — the ceiling fix and the speed fix
**2026-08-11, from the 5-agent walked inventory (wf_1e026653-1a9; 116+ enumerated sites). Architecture per
the ruling: IndexedDB = working store, Render = system of record (NOT the primary read path). Build now;
the Render cutover is gated separately (BAA).**

## What the walk found that changes the design
1. **The concurrency model IS a synchronous raw-byte CAS**: every cooperative writer (savePatients :10386,
   batch flush :10595, saveshield :124, visitfix :331, maintenance-persist mc:8111, b121 DOB :4820,
   hydration :11569) proves currency by a same-tick localStorage re-read. IDB has no sync read.
2. **Contracts pinned by suites (preserve)**: savePatients returns undefined with the save DURABLE and
   cold-reload-visible (sync-rollback :159-166); quota THROWS out of savePatients (:193); getPatients is
   sync and read-after-write in the same tick (rowguard reads INSIDE savePatients; qv-1.0 echo-reads
   after EVERY save; wipe guard counts before permitting); one save reaches the base exactly once across
   24 load orders; cooperative stays managed-only (exactly 3 entry points); retired journal NAMES are
   banned ('.pending-v1'/'.commit-v1').
3. **Write-visibility riders**: Storage.prototype version clocks (store_cache KEY_VER/verFor + task7 wrap)
   and cross-tab 'storage' listeners in four modules see patients writes only because they hit
   localStorage.
4. **Two rogue bypasses** (fifth-reader class, found by walking): b121 _restoreSnapshot setItem :2090;
   visitfix direct read+decode :237. Both would silently operate on a dead copy post-move.
5. **PHI wipes are localStorage-only**: clinical-state-purge.js:91 + clearDeviceData :8831 must gain the
   IDB deletion or PHI survives logout (the athena-retains-PHI class).
6. **The open silent-loss defect's exact anatomy**: upsertPatient :10900 `else savePatients(arr)` UNGUARDED
   → quota throw skips the :10910 mirror → _pendingSyncAdd (only reachable inside syncPatientToServer
   :11444) never runs → memo already nulled :10449 → the edit exists NOWHERE. deletePatient :16666 same
   shape. _pendingSyncAdd itself already falls back to an in-memory map at quota (:11375) — the enqueue
   works AT quota; it just never runs.

## The architecture (one new primitive, everything re-routed through it)
**`__mlsPtsStore` (sj-2.0)**: in-memory authoritative roster + sync localStorage DELTA JOURNAL + async
IDB blob, with a localStorage GENERATION stamp as the shared fence.
- **Read**: getPatients serves the in-memory roster synchronously (the existing memo, promoted to
  authoritative). Boot: hydrate memory from IDB blob + journal replay BEFORE the first roster-dependent
  paint (the boot read is the bite — an explicit ready-barrier, not a race). **Speed win realized here:
  the ~3.5MB LZ decode leaves the hot path entirely** (today it re-runs on every raw-identity miss).
- **Write**: savePatients updates memory → writes the small sync journal entry (dirty patients only,
  bounded, NEW name `ptsJournalV2`) → bumps the sync generation key (tiny; still fires cross-tab
  'storage' events; version clocks re-point here) → queues the async IDB blob write → returns undefined
  same-tick. **Durable-before-return holds via the journal** (sync, small); cold reload = IDB blob +
  journal replay (the sync-rollback CONTRACT holds; its MECHANISM pin moves deliberately).
- **Quota semantics**: the 3.5MB blob leaves localStorage → the ceiling is gone; the journal is KBs. The
  guard rebuild (inside this train, per ruling): **enqueue _pendingSyncAdd BEFORE the local write** at
  :10900 and :16666, no catch around the enqueue, unknown-latch takes the LOUD branch, Array.isArray not
  duck-typed length, paired 200-row/1-edit assertions. Journal-write failure still throws out of
  savePatients (contract preserved), but the edit now lives in the pending queue + memory.
- **Fence**: expectedRaw/lastRaw/CAS sites re-route to expectedGen/gen compare (sync, cheap). Cross-tab
  merge (:10544) reads the other tab's committed state via async IDB on gen-mismatch (already a
  cooperative/batch path). qv-1.0 re-points: gen moved + journal echo, not byte movement.
- **Wipes**: clinical-state-purge + clearDeviceData delete the IDB store + journal + gen.
- **Rogues**: b121 :2090 and visitfix :237 re-routed through the primitive; the localStorage blob is
  DELETED at migration so any missed reader fails loudly instead of reading stale PHI.
- **Migration (the cutover)**: one-shot, fail-closed: read blob → write IDB → byte-identical echo verify
  → journal live → only then remove the blob. Anything short of a verified echo keeps localStorage
  authoritative and reports. Own acceptance run (before/after per-patient snapshot, loss column) before
  the default lands — same instrument as the resolver acceptance.
- **calApptsCacheV2 follows** (second mover): single writer :12924 / single boot reader :12879; capture
  the namespace at call entry and re-run _calDiscardReason at settle (the account-switch race the
  inventory named); consent quota-reclaim :9529 and the sandbox seed move with it.
- 📊 **Measurements**: BEFORE (boot-to-interactive, one savePatients wall-clock, main-thread block of one
  decode) captured on the live tab pre-flip; same AFTER; the commercial number (max panel size
  before/after) computed from the byte-per-patient distribution, not one division.

## Honest scale call
This is a staged train with its own acceptance gate — the fence re-route touches 20+ sites and 6+ pinned
suites whose pins move deliberately. Not a single-evening ship. Order within the train: primitive +
journal + guard rebuild → fence re-routes → wipes + rogues → migration behind the fail-closed echo →
acceptance → cutover. Render sync (system of record) builds on the SAME pending-queue machinery after.
