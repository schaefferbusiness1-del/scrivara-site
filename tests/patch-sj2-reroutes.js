#!/usr/bin/env node
'use strict';
/* =============================================================================
 * patch-sj2-reroutes.js  (sj-2.0 phase-2, stage: REROUTES, rr-1.0)  2026-08-11
 *
 * Re-routes the ScribeFlow.html patient-store call sites onto
 * window.__mlsPtsStore per the primitive NOTES "Phase-2 integration sketch"
 * (handoff-2026-08-11/salvage/sj2/primitive/NOTES.md) under the authoritative
 * design tests/live-e2e-artifacts/2026-08-11-sj2-patients-idb-design.md.
 *
 * WHAT THIS PATCHER DOES (15 exact-byte splices, ScribeFlow.html only):
 *   - getPatients: idb-mode read serves __mlsPtsStore.getRoster() (memory);
 *   - savePatients sync tail: AFTER rowguard + proof guard (both unchanged),
 *     idb mode delegates to store.save(rows,{dirtyIds,allowRemovals}) and
 *     returns undefined - the whole-roster JSON.stringify/LZ-encode/setItem
 *     lane never runs on this path;
 *   - savePatients cooperative branch: idb mode delegates to store.saveAsync
 *     (one choke point, so satellite cooperative writers in OTHER files can
 *     never re-create the multi-MB localStorage blob through the legacy lane);
 *   - upsertPatient direct path: passes {dirtyIds:[String(p.id)]} via a
 *     one-shot hint variable - the qg-2.0 splice bytes stay UNTOUCHED;
 *   - batch flush sync: passes st.dirtyIds;
 *   - batch cooperative flush: gen fence + expectedGen from the store, and
 *     st.dirtyIds named on the call;
 *   - every in-file expectedRaw/lastRaw raw-identity fence gains a genRead()/
 *     catchUp() twin that takes over in idb mode (ls mode byte-identical).
 *
 * WHAT THIS PATCHER DOES NOT DO (other stages, named in NOTES.md):
 *   - does NOT splice the primitive itself (integration stage); it only
 *     ASSERTS the primitive BEGIN marker is already present and refuses
 *     to run without it;
 *   - does NOT touch wipes (clinical-state-purge.js, clearDeviceData) or the
 *     rogue readers (b121 _restoreSnapshot, visitfix direct read) - the
 *     wipes/rogues stages own those;
 *   - does NOT edit any registered suite. The two design-authorized pin
 *     MOVES (qg suite case C post-edit-bytes; sync-rollback MECHANISM pin)
 *     belong to the suites stage and are named in NOTES.md only.
 *
 * EOL SAFETY: files are read and written as latin1 (byte-preserving); every
 * edit is an exact byte splice with an occurrence==1 assertion on its anchor
 * at the moment it is applied (edits are sequential). No line-based rewrite,
 * no normalization, ever. ASCII-only replacement bytes (self-checked).
 * Already-applied detection judges the REPLACE text (several edits splice by
 * prefix, so the find SURVIVES a correct apply) - engine shape copied from
 * tests/patch-daynote-foldin.js.
 *
 * MODES:
 *   node patch-sj2-reroutes.js --root=<repo>            DRY-RUN: preconditions
 *       + every anchor occurrence==1 + apply in memory + POSTCHECKS (pinned-
 *       suite byte assertions, latch writer/reader scan, qg window, vm parse).
 *       Writes NOTHING.
 *   node patch-sj2-reroutes.js --root=<repo> --apply    apply splices after
 *       the same full gate; backups OUTSIDE the repo (os tmpdir), then write.
 *
 * The repo root is REQUIRED (env SJ2_REPO_ROOT / MLS_REPO_ROOT or --root=):
 * this file lives in the handoff tree, and a guessed default would silently
 * read the wrong checkout (the dispatch-clones-drift class).
 *
 * AFTER APPLY (release-train checklist, not done by this script):
 *   1. integration stage must already have spliced the primitive (this
 *      patcher refuses otherwise) and wired boot init()/ready barrier;
 *   2. suites stage: move the two authorized pins, add idb-mode coverage,
 *      register new suites in tests/run-all.js (EXISTING IS NOT RUNNING);
 *   3. full gate with the completeness line (GATE_PLAN/GATE_COMPLETE);
 *   4. /mls-build-ship (build bump at push time only).
 * ========================================================================== */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const rootArg = process.argv.find(a => a.indexOf('--root=') === 0);
const ROOT = (rootArg && rootArg.slice('--root='.length)) ||
  process.env.SJ2_REPO_ROOT || process.env.MLS_REPO_ROOT || '';

const SF = 'ScribeFlow.html';

/* ---------------------------------------------------------------------------
 * EDITS. Each: { file, id, why, find, replace }.
 * `find` must occur EXACTLY ONCE at the moment the edit is applied.
 * All replacement bytes ASCII-only (latin1 travel; mixed-EOL file).
 * ------------------------------------------------------------------------- */
const EDITS = [

  /* ==== 1. one-shot dirty-id hint declaration ============================ */
  {
    file: SF, id: 'rr-dirty-hint-decl',
    why: 'declares the one-shot hint upsertPatient direct path uses to pass {dirtyIds:[String(p.id)]} without touching the pinned qg-2.0 splice bytes (quota-guard-edit-survives pins the literal savePatients(arr) ordering token and the case-D revert token).',
    find: 'var __mlsPtsBatchByKey=Object.create(null),__mlsPtsBatchSeq=0,__mlsPtsPendingMirrorMemoryByKey=Object.create(null);\n',
    replace:
      'var __mlsPtsBatchByKey=Object.create(null),__mlsPtsBatchSeq=0,__mlsPtsPendingMirrorMemoryByKey=Object.create(null);\n' +
      '/* sj-2.0 rr-1.0: one-shot dirty-id hint. upsertPatient\'s direct path sets it\n' +
      '   immediately before its savePatients(arr) call (the qg 2.0 splice bytes stay\n' +
      '   untouched - that call\'s literal shape is suite-pinned, and so is the qg\n' +
      '   version token, which is why this comment spells it with a space); savePatients consumes\n' +
      '   it read-and-clear at the top of the sync tail on EVERY route, so a hint can\n' +
      '   never outlive the synchronous call it was set for. Nothing else may read it. */\n' +
      'var __mlsPtsDirtyHint=null;\n'
  },

  /* ==== 2. getPatients: idb-mode read via getRoster ======================= */
  {
    file: SF, id: 'rr-getpatients-idb-read',
    why: 'the speed fix: post-migration reads serve the in-memory authoritative roster (getRoster runs the tiny gen-stamp cross-tab catch-up); the multi-MB LZ decode leaves the hot path. Batch-open reads keep priority (unflushed tab-local state). Store refusal falls through to the legacy path, which post-migration holds no blob and yields [] - loud-empty, never stale PHI.',
    find:
      '    if(batch&&batch.depth>0&&Array.isArray(batch.arr))return __mlsPtsStampRead(batch.arr.slice());\n' +
      '    var raw=localStorage.getItem(key);',
    replace:
      '    if(batch&&batch.depth>0&&Array.isArray(batch.arr))return __mlsPtsStampRead(batch.arr.slice());\n' +
      '    /* sj-2.0 rr-1.0 (the ceiling fix and the speed fix): once the store is\n' +
      '       migrated + hydrated, reads serve the in-memory authoritative roster -\n' +
      '       same slice + generation stamp as the memo hit below. Any store refusal\n' +
      '       (account changed mid-tick) falls through to the legacy localStorage\n' +
      '       path, which post-migration holds no blob and parses to []. */\n' +
      '    var __psR=window.__mlsPtsStore;\n' +
      '    if(__psR&&__psR.isReady()){\n' +
      '      try{return __mlsPtsStampRead(__psR.getRoster().slice());}catch(ePsR){}\n' +
      '    }\n' +
      '    var raw=localStorage.getItem(key);'
  },

  /* ==== 3. savePatients cooperative branch: idb delegation (choke point) == */
  {
    file: SF, id: 'rr-save-coop-delegate',
    why: 'in idb mode EVERY cooperative caller (batch flush, hydration, and satellite writers in other files that route through this one base) must delegate to store.saveAsync - the raw-byte CAS + LZ encode + setItem lane below would RE-CREATE the multi-MB localStorage blob and with it the quota ceiling plus the both-copies boot anomaly. Managed-only stands: no new cooperative entry point; same base savePatients. rowguard + proof guard still run (synchronously - in idb mode their roster read is the in-memory slice, so the chunked prepare has nothing left to amortize).',
    find:
      "  var __cooperative=!!(__opts&&__opts.cooperative===true),__rawBefore='';\n" +
      '  if(__cooperative){\n' +
      '    try{\n' +
      '      var __actualRaw=localStorage.getItem(__key);',
    replace:
      "  var __cooperative=!!(__opts&&__opts.cooperative===true),__rawBefore='';\n" +
      '  /* sj-2.0 rr-1.0 COOPERATIVE RE-ROUTE (one choke point): in idb mode the\n' +
      '     store\'s confirm-awaiting async save replaces the raw-byte CAS + worker\n' +
      '     encode + setItem lane below. expectedGen is the caller\'s fence (the\n' +
      '     batch flush passes st.lastGen; the hydration pass passes its captured\n' +
      '     gen twin); callers still on the expectedRaw idiom get a same-tick\n' +
      '     genRead() CAS plus their own isCurrent() check, honored here BEFORE\n' +
      '     memory commits. Resolution mirrors the cooperative contract:\n' +
      '     {stale:true,external:true} on a lost CAS, {saved:false,identical:true}\n' +
      '     on an empty delta, else {saved:true,rows} after the IndexedDB confirm.\n' +
      '     A degraded store REJECTS (loud, batch stays dirty and re-arms). */\n' +
      '  if(__cooperative){\n' +
      '    var __psC=window.__mlsPtsStore;\n' +
      "    if(__psC&&__psC.isReady()&&uns('patients')===__key){\n" +
      '      try{\n' +
      "        if(__opts&&typeof __opts.isCurrent==='function'&&!__opts.isCurrent())return Promise.resolve({stale:true});\n" +
      '        arr=__mlsPtsRowGuard(__key,Array.isArray(arr)?arr:[],__opts);\n' +
      '        try{ __mlsAthenaProofGuard(__key,arr); }catch(ePsCp){}\n' +
      '        var __psCOpts={expectedGen:(__opts&&__opts.expectedGen!=null)?Number(__opts.expectedGen):__psC.genRead()};\n' +
      '        if(__opts&&__opts.allowRemovals===true)__psCOpts.allowRemovals=true;\n' +
      '        if(__opts&&Array.isArray(__opts.dirtyIds)&&__opts.dirtyIds.length)__psCOpts.dirtyIds=__opts.dirtyIds.slice();\n' +
      '        var __psCArr=arr;\n' +
      '        return __psC.saveAsync(__psCArr,__psCOpts).then(function(__psCRes){\n' +
      '          if(__psCRes&&__psCRes.stale)return __psCRes;\n' +
      '          if(__psCRes&&__psCRes.identical)return {saved:false,identical:true,rows:__psCArr};\n' +
      '          __mlsPtsGen++;\n' +
      '          try{\n' +
      '            var __psCGens=__mlsPtsRowGenByKey[__key]||(__mlsPtsRowGenByKey[__key]=Object.create(null));\n' +
      '            var __psCPresent=Object.create(null),__psCi,__psCr,__psCid;\n' +
      '            for(__psCi=0;__psCi<__psCArr.length;__psCi++){__psCr=__psCArr[__psCi];if(__psCr&&__psCr.id!=null){__psCid=String(__psCr.id);__psCPresent[__psCid]=1;if(__psCGens[__psCid]===undefined)__psCGens[__psCid]=__mlsPtsGen;}}\n' +
      '            for(__psCid in __psCGens){if(!__psCPresent[__psCid])delete __psCGens[__psCid];}\n' +
      '          }catch(ePsCg){}\n' +
      '          return {saved:true,packedBytes:0,rows:Array.isArray(__psCRes&&__psCRes.rows)?__psCRes.rows:__psCArr};\n' +
      '        });\n' +
      '      }catch(ePsCe){return Promise.reject(ePsCe);}\n' +
      '    }\n' +
      '  }\n' +
      '  if(__cooperative){\n' +
      '    try{\n' +
      '      var __actualRaw=localStorage.getItem(__key);'
  },

  /* ==== 4. savePatients sync tail: idb delegation ========================= */
  {
    file: SF, id: 'rr-save-sync-delegate',
    why: 'THE SYNC RE-ROUTE: rowguard + proof guard ran above, UNCHANGED. store.save() commits memory synchronously (read-after-write holds), writes the small dirty-only journal entry with a same-tick byte echo, and this function returns undefined - the pinned contract. Quota/journal-full still THROWS out of savePatients (the store toast carries the same could-NOT-be-saved phrase); the edit now survives in memory + the write-behind (the design-authorized qg case-C pin MOVE, suites stage). The whole-roster JSON.stringify below never runs on this path - the speed win.',
    find:
      '  arr=__mlsPtsRowGuard(__key,arr,__opts);\n' +
      '  try{ __mlsAthenaProofGuard(__key,arr); }catch(e){}\n' +
      '  var __json=JSON.stringify(arr);',
    replace:
      '  arr=__mlsPtsRowGuard(__key,arr,__opts);\n' +
      '  try{ __mlsAthenaProofGuard(__key,arr); }catch(e){}\n' +
      '  /* sj-2.0 rr-1.0 SYNC RE-ROUTE: guards above ran unchanged. dirtyIds:\n' +
      '     explicit opts win, then the upsert one-shot hint, else the store\'s\n' +
      '     reference/updated heuristic (primitive NOTES, DEVIATIONS 6). The hint\n' +
      '     is consumed on EVERY route so it cannot outlive this call. b392\'s\n' +
      '     identical-skip retires here: an empty delta is the store\'s no-op. */\n' +
      '  var __psHint=__mlsPtsDirtyHint;__mlsPtsDirtyHint=null;\n' +
      '  var __psS=window.__mlsPtsStore;\n' +
      "  if(__psS&&__psS.isReady()&&uns('patients')===__key){\n" +
      '    var __psSOpts={};\n' +
      '    if(__opts&&__opts.allowRemovals===true)__psSOpts.allowRemovals=true;\n' +
      '    if(__opts&&Array.isArray(__opts.dirtyIds)&&__opts.dirtyIds.length)__psSOpts.dirtyIds=__opts.dirtyIds.slice();\n' +
      '    else if(Array.isArray(__psHint)&&__psHint.length)__psSOpts.dirtyIds=__psHint;\n' +
      '    if(__mlsPtsMemo&&__mlsPtsMemo.key===__key)__mlsPtsMemo=null;\n' +
      "    __mlsPtsLastSavedKey='';__mlsPtsLastSaved=null;__mlsPtsLastPacked=null;\n" +
      '    __psS.save(arr,__psSOpts);\n' +
      '    __mlsPtsGen++;\n' +
      '    try{\n' +
      '      var __psGens=__mlsPtsRowGenByKey[__key]||(__mlsPtsRowGenByKey[__key]=Object.create(null));\n' +
      '      var __psPresent=Object.create(null),__psGi,__psGr,__psGid;\n' +
      '      for(__psGi=0;__psGi<arr.length;__psGi++){__psGr=arr[__psGi];if(__psGr&&__psGr.id!=null){__psGid=String(__psGr.id);__psPresent[__psGid]=1;if(__psGens[__psGid]===undefined)__psGens[__psGid]=__mlsPtsGen;}}\n' +
      '      for(__psGid in __psGens){if(!__psPresent[__psGid])delete __psGens[__psGid];}\n' +
      '    }catch(ePsG){}\n' +
      '    var __psAb=__mlsPtsBatchByKey[__key];\n' +
      '    if(__psAb&&__psAb.depth>0&&!__psAb.flushing){\n' +
      '      __psAb.arr=Array.isArray(arr)?arr.slice():[];\n' +
      '      __psAb.dirty=false;__psAb.changesSinceFlush=0;__psAb.uniqueSinceFlush=0;__psAb.dirtySince=0;__psAb.dirtyIds=Object.create(null);\n' +
      '      try{__psAb.lastRaw=localStorage.getItem(__key);}catch(ePsA){}\n' +
      '      try{__psAb.lastGen=__psS.genRead();}catch(ePsA2){}\n' +
      '      __psAb.externalWrites++;\n' +
      '    }\n' +
      '    return;\n' +
      '  }\n' +
      '  var __json=JSON.stringify(arr);'
  },

  /* ==== 5. cross-tab merge: store-aware external source =================== */
  {
    file: SF, id: 'rr-merge-external-idb',
    why: 'the design\'s :10544 re-route: in idb mode the other tab\'s committed state arrives via the store (gen-stamp catch-up + journal replay / async blob refresh already folded by catchUp), not a localStorage decode. The merge policy below is UNCHANGED: external is authoritative except for this pull\'s own dirty ids.',
    find:
      'function __mlsPtsMergeExternalBatch(st){\n' +
      '  var raw=null;try{raw=localStorage.getItem(st.key);}catch(e){return false;}\n' +
      "  var external=[];try{external=JSON.parse(_mlsPtsDecode(raw)||'[]');}catch(e){return false;}\n" +
      '  if(!Array.isArray(external))return false;',
    replace:
      'function __mlsPtsMergeExternalBatch(st){\n' +
      '  /* sj-2.0 rr-1.0: in idb mode the external truth is the store\'s view\n' +
      '     (catchUp folds foreign journal entries; a generation GAP schedules the\n' +
      '     async blob refresh inside the store). ls mode keeps the byte decode. */\n' +
      '  var raw=null,external=[],__psM=window.__mlsPtsStore,__psMGen=-1;\n' +
      "  if(__psM&&__psM.isReady()&&uns('patients')===st.key){\n" +
      '    try{__psM.catchUp();external=__psM.getRoster().slice();__psMGen=__psM.genRead();}catch(ePsM){return false;}\n' +
      '  }else{\n' +
      '    try{raw=localStorage.getItem(st.key);}catch(e){return false;}\n' +
      "    try{external=JSON.parse(_mlsPtsDecode(raw)||'[]');}catch(e){return false;}\n" +
      '  }\n' +
      '  if(!Array.isArray(external))return false;'
  },

  /* ==== 6. cross-tab merge: gen twin on the fence state =================== */
  {
    file: SF, id: 'rr-merge-external-lastgen',
    why: 'the merge must advance the gen fence twin exactly where it advances lastRaw, or the cooperative flush would loop on a permanently-stale gen compare.',
    find:
      '  st.arr=out;st.lastRaw=raw;st.externalWrites++;st.totalChanges++;st.changesSinceFlush++;st.flushEpoch++;\n' +
      '  return true;\n' +
      '}',
    replace:
      '  st.arr=out;st.lastRaw=raw;if(__psMGen>=0)st.lastGen=__psMGen;st.externalWrites++;st.totalChanges++;st.changesSinceFlush++;st.flushEpoch++;\n' +
      '  return true;\n' +
      '}'
  },

  /* ==== 7. batch flush sync: pass st.dirtyIds ============================= */
  {
    file: SF, id: 'rr-flush-sync-dirtyids',
    why: 'the flush names its dirty rows so the store journals ONLY them (KBs, not the roster). Inert on the ls path (rowguard reads only allowRemovals from opts). A wrapper in the public chain may drop the third argument; the store\'s reference/updated heuristic is the declared backstop (primitive NOTES, DEVIATIONS 6).',
    find:
      "    if(uns('patients')===st.key)window.savePatients(st.arr.slice(),st.key);\n" +
      '    else{st.boundaryDirectWrites++;__mlsPtsBaseSavePatients(st.arr.slice(),st.key);}',
    replace:
      '    /* sj-2.0 rr-1.0: name the dirty rows for the store\'s delta journal.\n' +
      '       NOTE the cross-account boundary write (else branch) deliberately\n' +
      '       stays on the legacy path when uns() no longer matches: the store\n' +
      '       binds ONE account, and a foreign-account write through it would be\n' +
      '       the account-bleed class. That boundary write re-creates the old\n' +
      '       account\'s blob; its next boot fails closed to ls and migrate()\n' +
      '       reconciles (the both-copies anomaly branch exists for exactly this). */\n' +
      '    var __psFd={dirtyIds:Object.keys(st.dirtyIds||{})};\n' +
      "    if(uns('patients')===st.key)window.savePatients(st.arr.slice(),st.key,__psFd);\n" +
      '    else{st.boundaryDirectWrites++;__mlsPtsBaseSavePatients(st.arr.slice(),st.key,__psFd);}'
  },

  /* ==== 8. batch flush sync: gen twin after success ======================= */
  {
    file: SF, id: 'rr-flush-sync-lastgen',
    why: 'the sync flush refreshes the gen fence twin exactly where it refreshes lastRaw.',
    find:
      '    st.dirty=false; st.changesSinceFlush=0; st.uniqueSinceFlush=0; st.dirtySince=0; st.dirtyIds=Object.create(null);\n' +
      '    try{st.lastRaw=localStorage.getItem(st.key);}catch(e){}\n' +
      '    st.committedIds=__mlsPtsIdSet(st.arr);',
    replace:
      '    st.dirty=false; st.changesSinceFlush=0; st.uniqueSinceFlush=0; st.dirtySince=0; st.dirtyIds=Object.create(null);\n' +
      '    try{st.lastRaw=localStorage.getItem(st.key);}catch(e){}\n' +
      "    try{var __psFsG=window.__mlsPtsStore;if(__psFsG&&__psFsG.isReady()&&uns('patients')===st.key)st.lastGen=__psFsG.genRead();}catch(ePsFs){}\n" +
      '    st.committedIds=__mlsPtsIdSet(st.arr);'
  },

  /* ==== 9. cooperative flush: gen fence + expectedGen + dirtyIds ========== */
  {
    file: SF, id: 'rr-flush-coop-fence',
    why: 'FENCE RE-POINT: in idb mode the raw-identity probe is meaningless (the blob key is gone; null===null forever, so foreign changes would go undetected). catchUp() first so a foreign tab\'s committed entries are visible, then the tiny gen compare. The ls path keeps the raw compare byte-for-byte. The call passes expectedGen (the store CAS) and names st.dirtyIds; expectedRaw stays for the ls path.',
    find:
      '    var rawNow=null;try{rawNow=localStorage.getItem(st.key);}catch(e){}\n' +
      "    if(rawNow!==st.lastRaw&&!__mlsPtsMergeExternalBatch(st))throw new Error('Patient persistence paused because another tab changed the roster.');\n" +
      '    var epoch=++st.flushEpoch,seq=st.totalChanges,snapshot=st.arr.slice();\n' +
      "    return Promise.resolve(window.savePatients(snapshot,st.key,{cooperative:true,expectedRaw:st.lastRaw,isCurrent:function(){return !st.invalidated&&st.flushEpoch===epoch&&st.totalChanges===seq&&uns('patients')===st.key;}})).then(function(result){",
    replace:
      '    /* sj-2.0 rr-1.0 FENCE RE-POINT: gen twin takes over in idb mode. */\n' +
      '    var __psFc=window.__mlsPtsStore,__psFcLive=!!(__psFc&&__psFc.isReady());\n' +
      '    var __psStale;\n' +
      '    if(__psFcLive){try{__psFc.catchUp();}catch(ePsCu){}__psStale=__psFc.genRead()!==st.lastGen;}\n' +
      '    else{var rawNow=null;try{rawNow=localStorage.getItem(st.key);}catch(e){}__psStale=rawNow!==st.lastRaw;}\n' +
      "    if(__psStale&&!__mlsPtsMergeExternalBatch(st))throw new Error('Patient persistence paused because another tab changed the roster.');\n" +
      '    var epoch=++st.flushEpoch,seq=st.totalChanges,snapshot=st.arr.slice();\n' +
      "    return Promise.resolve(window.savePatients(snapshot,st.key,{cooperative:true,expectedRaw:st.lastRaw,expectedGen:__psFcLive?st.lastGen:null,dirtyIds:Object.keys(st.dirtyIds||{}),isCurrent:function(){return !st.invalidated&&st.flushEpoch===epoch&&st.totalChanges===seq&&uns('patients')===st.key;}})).then(function(result){"
  },

  /* ==== 10. cooperative flush: gen twin after success ===================== */
  {
    file: SF, id: 'rr-flush-coop-lastgen',
    why: 'the cooperative flush refreshes the gen fence twin exactly where it refreshes lastRaw (closure over this run() invocation\'s store handle).',
    find:
      '      if(result&&Array.isArray(result.rows))st.arr=result.rows.slice();\n' +
      '      try{st.lastRaw=localStorage.getItem(st.key);}catch(e){}\n' +
      '      st.committedIds=__mlsPtsIdSet(st.arr);',
    replace:
      '      if(result&&Array.isArray(result.rows))st.arr=result.rows.slice();\n' +
      '      try{st.lastRaw=localStorage.getItem(st.key);}catch(e){}\n' +
      '      try{if(__psFcLive)st.lastGen=__psFc.genRead();}catch(ePsFcG){}\n' +
      '      st.committedIds=__mlsPtsIdSet(st.arr);',
  },

  /* ==== 11. batch begin: capture the gen twin ============================= */
  {
    file: SF, id: 'rr-batch-begin-lastgen',
    why: 'the gen twin of initialRaw - captured BEFORE the roster read (the conservative direction: a stale lastGen forces one harmless extra merge; a fresh one could skip a needed merge). -1 = store not live; every fence falls back to the raw compare.',
    find:
      '      var initialRaw=null;try{initialRaw=localStorage.getItem(key);}catch(e){}\n' +
      '      var initialRows=getPatients();',
    replace:
      '      var initialRaw=null;try{initialRaw=localStorage.getItem(key);}catch(e){}\n' +
      '      /* sj-2.0 rr-1.0: gen twin, captured before the roster read (conservative). */\n' +
      '      var initialGen=-1;try{var __psBg=window.__mlsPtsStore;if(__psBg&&__psBg.isReady())initialGen=__psBg.genRead();}catch(ePsBg){}\n' +
      '      var initialRows=getPatients();'
  },

  /* ==== 12. batch state literal: lastGen field ============================ */
  {
    file: SF, id: 'rr-batch-state-lastgen',
    why: 'the fence twin lives beside lastRaw in the batch state.',
    find: "st={key:key,pendingSyncKey:uns('pendingPtSync'),lastRaw:initialRaw,arr:initialRows,",
    replace: "st={key:key,pendingSyncKey:uns('pendingPtSync'),lastRaw:initialRaw,lastGen:initialGen,arr:initialRows,"
  },

  /* ==== 13. upsertPatient direct path: dirty-id hint ====================== */
  {
    file: SF, id: 'rr-upsert-dirty-hint',
    why: 'the direct path passes {dirtyIds:[String(p.id)]} to the store WITHOUT editing the qg-2.0 splice bytes: quota-guard-edit-survives pins the literal savePatients(arr) token (enqueue-precedes ordering + the case-D revert token savePatients(arr);\\n  }), so the id travels via the one-shot hint the sync tail consumes on the very next statement. Set AFTER the enqueue/latch lines - the splice\'s own ordering is untouched.',
    find:
      '    else { window.__mlsPtsEditAtRiskUnknown=true; }\n' +
      '    savePatients(arr);',
    replace:
      '    else { window.__mlsPtsEditAtRiskUnknown=true; }\n' +
      '    __mlsPtsDirtyHint=(p&&p.id!=null)?[String(p.id)]:null; /* sj-2.0 rr-1.0: consumed by the sync tail on the next statement */\n' +
      '    savePatients(arr);'
  },

  /* ==== 14. hydration: capture the gen twin of _hyRawBefore =============== */
  {
    file: SF, id: 'rr-hydration-genbefore',
    why: 'the hydration fence\'s gen twin, captured at the same moment as the raw twin (catchUp first so the fence covers foreign entries already committed; captured before the local roster read - conservative direction, a race aborts to stale exactly as the raw fence does today).',
    find:
      "    let _hyRawBefore=null;try{_hyRawBefore=localStorage.getItem(_hyStoreKey);}catch(e){_hyEnd(true,'');return false;}",
    replace:
      "    let _hyRawBefore=null;try{_hyRawBefore=localStorage.getItem(_hyStoreKey);}catch(e){_hyEnd(true,'');return false;}\n" +
      '    /* sj-2.0 rr-1.0: gen twin of _hyRawBefore. null = store not live. */\n' +
      "    let _hyGenBefore=null;try{const _hyPs=window.__mlsPtsStore;if(_hyPs&&_hyPs.isReady()&&uns('patients')===_hyStoreKey){_hyPs.catchUp();_hyGenBefore=_hyPs.genRead();}}catch(e){}"
  },

  /* ==== 15. hydration: expectedGen + gen-aware isCurrent ================== */
  {
    file: SF, id: 'rr-hydration-expectedgen',
    why: 'the hydration save carries expectedGen (the store CAS) beside expectedRaw, and its isCurrent fence gains the gen compare. The pinned substrings survive: the call still starts savePatients(_hyRows,_hyStoreKey,{cooperative:true and the startup/account/token conjunction is byte-identical inside the restructured check (startup-hydration-contract pins both).',
    find:
      '      const _hySaved=await savePatients(_hyRows,_hyStoreKey,{cooperative:true,expectedRaw:_hyRawBefore,isCurrent:function(){\n' +
      "        try{return sfStartupValid(opts)&&uns('patients')===_hyStoreKey&&bkToken()===_hyToken&&localStorage.getItem(_hyStoreKey)===_hyRawBefore;}catch(e){return false;}\n" +
      '      }});',
    replace:
      '      const _hySaved=await savePatients(_hyRows,_hyStoreKey,{cooperative:true,expectedRaw:_hyRawBefore,expectedGen:_hyGenBefore,isCurrent:function(){\n' +
      "        try{if(!(sfStartupValid(opts)&&uns('patients')===_hyStoreKey&&bkToken()===_hyToken&&localStorage.getItem(_hyStoreKey)===_hyRawBefore))return false;}catch(e){return false;}\n" +
      '        try{const _hyPs2=window.__mlsPtsStore;if(_hyGenBefore!=null&&_hyPs2&&_hyPs2.isReady()&&_hyPs2.genRead()!==_hyGenBefore)return false;}catch(e2){}\n' +
      '        return true;\n' +
      '      }});'
  }
];

/* ---------------------------------------------------------------------------
 * Engine: sequential exact-byte splices with occurrence==1 assertions.
 * ALREADY APPLIED is judged on the REPLACE text (several edits splice by
 * prefix, so the find SURVIVES a correct apply) - the patch-daynote-foldin
 * engine shape, copied.
 * ------------------------------------------------------------------------- */
function occurrences(hay, needle) {
  let n = 0, i = 0;
  for (;;) { i = hay.indexOf(needle, i); if (i < 0) return n; n++; i += needle.length; }
}

function applyToSources(sources, opts) {
  opts = opts || {};
  const out = Object.assign({}, sources);
  const log = [];
  for (const e of EDITS) {
    const src = out[e.file];
    if (typeof src !== 'string') throw new Error('missing source for ' + e.file);
    const nFind = occurrences(src, e.find);
    const nRepl = occurrences(src, e.replace);
    if (nRepl === 1) {
      if (opts.tolerateApplied) { log.push({ id: e.id, file: e.file, status: 'already-applied' }); continue; }
      throw new Error('[' + e.id + '] in ' + e.file + ': already applied - refusing to double-splice');
    }
    if (nFind !== 1) {
      throw new Error('ANCHOR FAILURE [' + e.id + '] in ' + e.file + ': expected occurrence==1, found ' + nFind +
        (nRepl ? ' (replacement text present ' + nRepl + 'x)' : ''));
    }
    if (nRepl !== 0 && e.replace.indexOf(e.find) !== 0 && occurrences(e.replace, e.find) === 0) {
      throw new Error('ANCHOR FAILURE [' + e.id + '] in ' + e.file + ': replacement already present alongside anchor');
    }
    const at = src.indexOf(e.find);
    out[e.file] = src.slice(0, at) + e.replace + src.slice(at + e.find.length);
    log.push({ id: e.id, file: e.file, status: 'ok', at });
  }
  return { sources: out, log };
}

/* ---------------------------------------------------------------------------
 * Static self-checks on the EDITS themselves (run before anything).
 * ------------------------------------------------------------------------- */
function staticChecks() {
  for (const e of EDITS) {
    for (let i = 0; i < e.replace.length; i++) {
      const c = e.replace.charCodeAt(i);
      if (!(c === 9 || c === 10 || (c >= 32 && c <= 126)))
        throw new Error('STATIC FAIL [' + e.id + ']: non-ASCII byte 0x' + c.toString(16) + ' at ' + i + ' (latin1 travel; ASCII apostrophes only)');
    }
    if (e.replace.indexOf('</script') >= 0) throw new Error('STATIC FAIL [' + e.id + ']: </script sequence in replacement');
    if (occurrences(e.find, '\nfunction ') !== occurrences(e.replace, '\nfunction '))
      throw new Error('STATIC FAIL [' + e.id + ']: edit changes the count of "\\nfunction " line starts (suite extraction windows end on that token)');
    for (const banned of ['.pending-v1', '.commit-v1', 'ptsJournalV1'])
      if (e.replace.indexOf(banned) >= 0) throw new Error('STATIC FAIL [' + e.id + ']: retired v1 journal name in replacement: ' + banned);
    /* the literal qg version token is the quota-guard suite's spliceAt anchor:
       an occurrence inserted BEFORE the real upsert splice hijacks the suite's
       window (the same collision the salvage primitive's comments carry -
       integration must neutralize those too; see NOTES.md). */
    if (e.replace.indexOf('qg-2' + '.0') >= 0)
      throw new Error('STATIC FAIL [' + e.id + ']: literal qg version token in replacement - spell it "qg 2.0" in comments');
  }
}

/* ---------------------------------------------------------------------------
 * PRECONDITIONS against the on-disk file (this patcher does NOT wire the
 * primitive; the integration stage must have spliced it first).
 * ------------------------------------------------------------------------- */
const BEGIN_MARK = '/* ===== BEGIN mls-pts-store (sj-2.0) ===== */';
const END_MARK = '/* ===== END mls-pts-store (sj-2.0) ===== */';
function preconditions(app) {
  const must = (cond, msg) => { if (!cond) throw new Error('PRECONDITION FAIL: ' + msg); };
  must(occurrences(app, BEGIN_MARK) === 1, 'primitive BEGIN marker must occur exactly once (integration stage splices mls-pts-store.js first; this patcher never wires it)');
  must(occurrences(app, END_MARK) === 1, 'primitive END marker must occur exactly once');
  must(occurrences(app, 'window.__mlsPtsStore={') === 1, 'primitive API assignment must be present exactly once');
  const memoAt = app.indexOf('var __mlsPtsMemo=null;');
  must(memoAt >= 0, 'b377 memo declaration missing (extraction-window landmark)');
  must(app.indexOf(BEGIN_MARK) > memoAt && app.indexOf(BEGIN_MARK) < app.indexOf('function getPatients(){'),
    'primitive block must sit after the memo declaration and before getPatients (the documented splice point)');
}

/* ---------------------------------------------------------------------------
 * POSTCHECKS on the patched bytes: every pinned-suite assertion this stage
 * is NOT authorized to move must still hold, plus parse sanity.
 * ------------------------------------------------------------------------- */
function postChecks(app) {
  const must = (cond, msg) => { if (!cond) throw new Error('POSTCHECK FAIL: ' + msg); };

  /* qg-2.0 pins (quota-guard-edit-survives.test.js). NOTE this mirrors the
     REAL suite's spliceAt = first indexOf('qg-2.0') inside the extraction
     block - so it also catches the primitive-comment token collision named
     in NOTES.md (the salvage primitive's header says 'qg-2.0' twice; spliced
     before upsertPatient that would hijack the suite's window. Integration
     must neutralize the literal token in the primitive comments). */
  const qgAt = app.indexOf('qg-2.0');
  must(qgAt > 0, 'qg-2.0 splice present');
  const region = app.slice(qgAt, qgAt + 1600);
  must(/if\(backendMode\(\) && bkToken\(\) && p && p\.id!=null\)\{ _pendingSyncAdd\(String\(p\.id\)\); \}/.test(region),
    'qg enqueue bytes intact (no try, unconditional)');
  const enqAt = region.indexOf('_pendingSyncAdd'), spAt = region.indexOf('savePatients(arr)');
  must(enqAt >= 0 && spAt > enqAt, 'enqueue still precedes savePatients(arr) inside the 1600-char qg window (enq=' + enqAt + ' sp=' + spAt + ')');
  must(app.indexOf('savePatients(arr);\n  }', qgAt) > qgAt, 'qg case-D revert token intact');

  /* qg latch guard (qg-latch-has-no-reader-yet.test.js): 1 writer, 0 readers */
  {
    const FLAG = '__mlsPtsEditAtRiskUnknown';
    let w = 0, r = 0, i = -1;
    while ((i = app.indexOf(FLAG, i + 1)) >= 0) {
      if (/^\s*=\s*true/.test(app.slice(i + FLAG.length, i + FLAG.length + 8))) w++; else r++;
    }
    must(w === 1 && r === 0, 'latch stays one-writer/zero-readers in ScribeFlow.html (got ' + w + '/' + r + ')');
  }

  /* patient-scale-perf-contract.test.js pins */
  for (const pin of [
    'var __mlsPtsMemo=null;',
    'if(__mlsPtsMemo&&__mlsPtsMemo.key===key&&__mlsPtsMemo.raw===raw)return __mlsPtsStampRead(__mlsPtsMemo.arr.slice());',
    'var arr=JSON.parse(_mlsPtsDecode(raw))||[];',
    'if(__mlsPtsMemo&&__mlsPtsMemo.key===__key)__mlsPtsMemo=null; /* never serve a pre-write parse after a write */'
  ]) must(app.indexOf(pin) >= 0, 'patient-scale pin lost: ' + pin.slice(0, 60));

  /* patient-store-sync-rollback-runtime.test.js structural pins */
  const blkStart = app.indexOf('var __mlsLZ=(function(){');
  const blkEnd = app.indexOf('function getActivePtId', blkStart);
  must(blkStart >= 0 && blkEnd > blkStart, 'patient-store extraction window intact');
  const blk = app.slice(blkStart, blkEnd);
  const saveStart = blk.indexOf('function savePatients(arr,__storageKey,__opts){');
  const saveEnd = blk.indexOf('var __mlsPtsBaseSavePatients=savePatients;', saveStart);
  must(saveStart >= 0 && saveEnd > saveStart, 'savePatients window intact');
  const sv = blk.slice(saveStart, saveEnd);
  const coopAt = sv.indexOf('if(__cooperative){');
  const enc = sv.indexOf('var packed=_mlsPtsEncode(__json);');
  must(coopAt >= 0 && enc > coopAt, 'cooperative branch precedes the sync encode');
  must(sv.slice(coopAt, enc).indexOf('__mlsPtsPrepareCooperative(') >= 0 &&
    sv.slice(coopAt, enc).indexOf('_mlsPtsEncodeRowsAsync(arr,function') >= 0,
    'ls cooperative lane (prepare + worker encode) intact between the branches');
  must(coopAt < sv.indexOf('var __json=JSON.stringify(arr);'), 'cooperative branch precedes the sync stringify');
  must(sv.slice(enc).indexOf('_mlsPtsEncodeRowsAsync(') < 0, 'no async encode after the sync encode');
  must((sv.match(/__mlsPtsMemo=\{key:__key,raw:packed,arr:Array\.from\(arr\)\}/g) || []).length >= 2, 'memo seeding intact');
  for (const retired of ['.pending-v1', '.commit-v1', '__mlsPtsAsync', '__mlsPtsStageAsync', '__mlsPtsSyncCommit',
    '__mlsPatientStoreHasPending', '__mlsReadPatientStore', 'patient-store worker + durable patch journal'])
    must(blk.indexOf(retired) < 0, 'retired journal name in block: ' + retired);
  must(blk.indexOf("version:'pts-batch-1.2.0'") >= 0 && blk.indexOf('st.cooperative?__mlsPtsFlushBatchCooperative') >= 0,
    'managed-only cooperative batch routing intact');

  /* startup-hydration-contract.test.js + commercial-hardening pins */
  const hyStart = app.indexOf('async function loadPatientsFromServer(opts)');
  const hyEnd = app.indexOf('/* ---------- HEAD-DOCTOR TEAM VIEW', hyStart);
  must(hyStart >= 0 && hyEnd > hyStart, 'hydration window intact');
  const hy = app.slice(hyStart, hyEnd);
  must(hy.indexOf('await savePatients(_hyRows,_hyStoreKey,{cooperative:true') >= 0, 'hydration cooperative call prefix intact');
  must(hy.indexOf("sfStartupValid(opts)&&uns('patients')===_hyStoreKey&&bkToken()===_hyToken") >= 0, 'hydration startup/account/token fence substring intact');
  must(hy.indexOf('if(_hySaved&&_hySaved.stale)') >= 0, 'hydration stale check intact');
  must(hy.indexOf("const _hyStoreKey=uns('patients'),_hyToken=bkToken()") >= 0, 'hydration key/token capture intact');

  /* upsert extraction window (upsert-* suites end on "\nfunction ") */
  const upStart = app.indexOf('function upsertPatient(p){');
  const upEnd = app.indexOf('\nfunction ', upStart + 10);
  must(upStart >= 0 && upEnd > upStart, 'upsertPatient window intact');
  must(app.slice(upStart, upEnd).indexOf('__mlsPtsDirtyHint=') >= 0, 'upsert dirty hint landed inside the upsert window');

  /* parse sanity: the two windows the registered suites vm-run must parse */
  new vm.Script(blk, { filename: 'sj2-postcheck-patient-store-block.js' });
  new vm.Script(hy, { filename: 'sj2-postcheck-hydration-window.js' });
}

/* ------------------------------------------------------------------------- */
function main() {
  const APPLY = process.argv.indexOf('--apply') >= 0;
  if (!ROOT) {
    console.error('REFUSED: repo root required (SJ2_REPO_ROOT / MLS_REPO_ROOT env, or --root=<path>).');
    console.error('This patcher lives outside the repo; guessing a root is the dispatch-clones-drift class.');
    process.exit(1);
  }
  staticChecks();
  const full = path.join(ROOT, SF);
  const original = fs.readFileSync(full, 'latin1');
  console.log('read  ' + SF + '  (' + original.length + ' bytes, latin1) from ' + ROOT);

  preconditions(original);
  console.log('preconditions: primitive BEGIN/END markers + API assignment present, before getPatients.');

  let result;
  try {
    result = applyToSources({ [SF]: original }, { tolerateApplied: !APPLY });
  } catch (err) {
    console.error('\nDRY-RUN: FAIL');
    console.error(String(err && err.message || err));
    process.exit(1);
  }
  const applied = result.log.filter(l => l.status === 'already-applied');
  if (applied.length === EDITS.length) {
    console.log('\nDRY-RUN: ALL ' + EDITS.length + ' EDITS ALREADY APPLIED - the repo carries rr-1.0; nothing to do.');
    return;
  }
  if (applied.length > 0) {
    console.error('\nDRY-RUN: FAIL - PARTIAL APPLY: ' + applied.length + '/' + EDITS.length +
      ' edits already present (' + applied.map(l => l.id).join(', ') + '). A half-applied repo needs a git restore of ' + SF + ' before this patcher may run.');
    process.exit(1);
  }
  for (const l of result.log) console.log('anchor ok  [' + l.id + ']  ' + l.file + ' @' + l.at);
  const patched = result.sources[SF];
  console.log('post-splice size: ' + original.length + ' -> ' + patched.length + ' (+' + (patched.length - original.length) + ' bytes)');

  try {
    postChecks(patched);
  } catch (err) {
    console.error('\nDRY-RUN: FAIL (postcheck)');
    console.error(String(err && err.message || err));
    process.exit(1);
  }
  console.log('postchecks: qg pins + latch 1/0 + perf pins + sync-rollback structure + hydration pins + vm parse: PASS');
  console.log('\nDRY-RUN: PASS - ' + result.log.length + '/' + EDITS.length + ' anchors verified (occurrence==1 each).');

  if (!APPLY) {
    console.log('No files written. Re-run with --apply to splice (backup outside the repo first).');
    console.log('REMINDER: the two authorized pin MOVES (qg case C; sync-rollback mechanism) are the SUITES stage, not this patcher.');
    return;
  }

  /* Backups go OUTSIDE the repo (a .bak in the repo root is publication
   * debris - git-add-A-publishes-your-debris). Git history is the durable
   * rollback; the tmp copy only covers an interrupted write. */
  const os = require('os');
  const bakDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sj2rr-bak-'));
  fs.writeFileSync(path.join(bakDir, SF + '.sj2rr.bak'), original, 'latin1');
  fs.writeFileSync(full, patched, 'latin1');
  console.log('APPLIED ' + SF + ' (backup: ' + path.join(bakDir, SF + '.sj2rr.bak') + ')');
}

if (require.main === module) main();
module.exports = { EDITS, applyToSources, occurrences, staticChecks, preconditions, postChecks, BEGIN_MARK, END_MARK };
