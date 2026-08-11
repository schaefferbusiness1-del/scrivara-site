# Quota: the 5,078,593 broken down by key — inventory + durability answer + scope
**2026-08-11 ~04:40Z · read-only (zero writes to his store, all probes enumeration-only) · measured in his live tab post-acceptance-run.**

## 1. The inventory (first time this number has ever been decomposed)

| Family (namespace masked) | Bytes | Share | Rewritten by the app? |
|---|---|---|---|
| ACCT::patients | 3,557,696 | 70.0% | every pull / every edit (grew +34,306 tonight) |
| ACCT::calApptsCacheV2 | 844,673 | 16.6% | **±62d/1500 re-snapshot on EVERY loadCalendar (~840KB)** |
| ACCT::notes | 256,292 | 5.0% | on note edits |
| ACCT::templates | 128,094 | 2.5% | on template changes |
| **Backup debris (7 root keys, July one-shots)** | **103,063** | 2.0% | **never — static since 2026-07-01..11** |
| other-account::notes | 66,069 | 1.3% | unknown (second real account's namespace) |
| ACCT::schedImportIndexV1::&lt;old days, 7 pre-Aug&gt; | 35,966 | 0.7% | never (historical day ledgers) |
| UNDERSCORE::copilotHist(+ByPt) | 20,863 | 0.4% | only if used signed-out |
| everything else (~215 keys) | ~66,000 | 1.3% | mixed, all small |
| **Total** | **5,078,593** | | ceiling ≈ 5,120KB → **~41KB headroom** |

Backup keys by name: mls_todays_backup_20260706 (41,304) · mlsRepairBackup_20260701 (15,405) · __mlsSweepBackup_2026-07-11 (14,771) · mls_b49_contam_backup_20260706 (13,590) · __mlsCertBackup (9,109) · __mlsFriPhantomBackup_2026-07-10 (5,921) · mls_b49_stubs_backup_20260706 (2,963).
No 339KB face-image key exists in this store (the memory's face image is not present here).

## 2. The durability question, ANSWERED
**Can any prune survive a loadCalendar re-snapshot? YES — but only ~156KB of one.**
- Pruning `calApptsCacheV2` is THEATRE, confirmed by arithmetic: its 844,673 bytes ≈ exactly the ~840KB the next fetch rewrites. Any headroom taken from it evaporates on the next calendar load.
- The DURABLE prune set — keys no code path rewrites: backup debris 103,063 + pre-August day ledgers 35,966 + signed-out copilot histories 20,863 = **159,892 B ≈ 156KB**, none clinical, none patient records, none calendar. That moves headroom 41KB → ~197KB: several OFF-run days of oxygen (+34KB each), NOT a fix — `patients` is 70% and grows every run.
- `other-account::notes` (66KB) is NOT in the durable set without the owner ruling on the second account.

## 3. The real fix, SCOPED (not started)
- **A. calApptsCacheV2 → IndexedDB** (smallest surface, frees 16.6% durably): one writer/reader pair moves; risks = the sync-read boot path needs a memory warm layer over an async store; must inventory every direct reader of the key first (the fifth-reader lesson). Leaves patients growth unsolved (~4.2MB remains).
- **B. patients → server-side Render** (the owner's twice-made ask: "HAVE IT SEND RECORDS TO RENDER"; largest win, 70%): backend exists and is fully enabled; a sync layer inherits the OPEN `quota-write-loses-the-edit-silently` defect, so **rebuilding that guard is a hard PRECONDITION**; identity/merge + offline semantics + the suites pinning synchronous saves make this a multi-train project.
- **C. patients → IndexedDB locally** (solves quota permanently without a server dependency): changes crash-read/save semantics that registered suites pin ("normal saves remain synchronous"); multi-train.
- **Recommended order**: durable prune (§2's named set ONLY) → Option A → Option B as the owner-aligned project with the silent-loss guard rebuilt first.

## 4. Banked constraints for whenever the prune is written (supervisor, verbatim intent)
Loss column per patient per field · NEVER touches a clinical field · targets = the named debris keys only, never patient records · fails CLOSED (a prune that cannot prove what it deletes, deletes nothing) · exercised against a copy or a write-blocking proxy before it ever runs live · lands gated under GATE_PLAN/GATE_COMPLETE.
