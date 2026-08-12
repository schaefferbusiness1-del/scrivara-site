#!/usr/bin/env node
'use strict';
/* =============================================================================
 * patch-sj2-wipes.js  (sj-2.0 WIPES stage)  2026-08-11  -- DRAFT, not applied
 *
 * Design Q2 (BLOCKING acceptance criterion, adopted verbatim in
 * tests/live-e2e-artifacts/2026-08-11-sj2-patients-idb-design.md): sign-out
 * and clearDeviceData must leave ZERO patient bytes in IndexedDB - the
 * enumerated object stores, the journal key and the generation key all empty,
 * PROVEN by read-back. "Shipping without it is a PHI retention regression
 * larger than the one on record."
 *
 * WHAT THIS PATCHES (4 exact-byte splices, 2 files):
 *   CSP-1  clinical-state-purge.js: new purgePatientStore(email) helper -
 *          calls window.__mlsPtsStore.wipe(), HARD-requires
 *          verifiedEmpty===true, adds an INDEPENDENT email-prefix read-back,
 *          escalates LOUDLY on anything less (no proof, no green), publishes
 *          the receipt on window.__mlsPtsWipeLast.
 *   CSP-2  clinical-state-purge.js: purge() invokes the helper and returns
 *          the receipt promise as field `ptsStore`.
 *   SF-1   ScribeFlow.html logout(): folds _purge.ptsStore into
 *          window.__mlsLogoutPurge so the logout barrier waits for the proof.
 *   SF-2   ScribeFlow.html clearDeviceData(): awaits __mlsPtsStore.wipe()
 *          AFTER the consent-audit purge (the consent call must stay within
 *          1200 bytes of the function head - a registered pin in
 *          tests/recording-consent-gate-runtime.test.js:427), requires
 *          verifiedEmpty + independent read-back, and the SUCCESS toast fires
 *          ONLY on a proven wipe; failure = err toast + console.error + a
 *          slower reload so the escalation is actually seen.
 *
 * SEMANTICS PRESERVED (the clinical-state-purge law):
 *   - own-prefix-only: __mlsPtsStore.wipe() deletes ONLY the current
 *     account's IndexedDB record; foreign namespaces and other accounts'
 *     records are untouched BY DESIGN (this patcher never calls
 *     indexedDB.deleteDatabase on the patient store).
 *   - ::undefined:: / ::_:: refusal: a wipe aimed at an unresolved namespace
 *     would return a TRUE verifiedEmpty for the WRONG namespace while the
 *     real account's bytes survive - both call sites refuse it up front and
 *     escalate instead (the sf_u::undefined stranded-notes class).
 *   - qg-2.0 splice byte-intact: nothing here touches upsertPatient, and the
 *     write-only at-risk latch identifier appears NOWHERE in these edits
 *     (one writer, zero readers - the contract test proves the count did not
 *     move).
 *
 * EOL SAFETY: files are read and written as latin1 (byte-preserving); every
 * edit is an exact byte splice with an occurrence==1 assertion on its anchor
 * (engine shape copied from tests/patch-daynote-foldin.js, which additionally
 * REFUSES double-splices by judging the REPLACE text). ScribeFlow.html is
 * historically mixed-EOL; the anchor regions were byte-probed pure-LF on
 * 2026-08-11 and the splices carry their own \n only. The one non-ASCII
 * sequence (the ellipsis in the existing success toast) is built with
 * String.fromCharCode(0xe2,0x80,0xa6) so this source file stays pure ASCII
 * while the produced bytes are identical to the bytes already in the file.
 *
 * MODES:
 *   node patch-sj2-wipes.js           -> DRY-RUN: verify every anchor
 *                                        (occurrence==1) + report. Writes NOTHING.
 *   node patch-sj2-wipes.js --apply   -> apply splices, write .sj2w.bak first.
 *
 * REPO ROOT: set MLS_REPO_ROOT. When this file has been moved into tests/,
 * it falls back to ".."; from the drafts directory it REFUSES to guess
 * (dispatch-clones-drift: an absolute default silently reads the wrong repo).
 *
 * AFTER APPLY (release-train checklist, not done by this script):
 *   1. move/copy wipes-contract.test.js into tests/ and REGISTER it in
 *      tests/run-all.js (EXISTING IS NOT RUNNING);
 *   2. full suite gate with the completeness line (GATE_PLAN/GATE_COMPLETE);
 *   3. the live criterion run: real sign-out + logout-wipe-zero-idb-bytes
 *      .check.js PASS, and the same for clearDeviceData - BLOCKING before
 *      the sj-2.0 cutover regardless of every other pass.
 * ========================================================================== */

const fs = require('fs');
const path = require('path');

const ROOT = (function () {
  if (process.env.MLS_REPO_ROOT) return process.env.MLS_REPO_ROOT;
  if (path.basename(__dirname) === 'tests') return path.resolve(__dirname, '..');
  return null; /* refuse to guess from a drafts checkout */
})();

const CSP = 'clinical-state-purge.js';
const SF = 'ScribeFlow.html';

/* the existing success-toast ellipsis, as latin1 bytes (UTF-8 e2 80 a6 read
 * as latin1): preserved byte-for-byte, never re-encoded */
const ELL = String.fromCharCode(0xe2, 0x80, 0xa6); /* the latin1 bytes of the existing toast ellipsis - built from codes so this file stays pure ASCII */

/* ---------------------------------------------------------------------------
 * EDITS. Each: { file, id, why, find, replace }. `find` must occur EXACTLY
 * ONCE in the file's current bytes when the edit is applied (edits are
 * sequential; later anchors are checked against earlier results).
 * ------------------------------------------------------------------------- */
const EDITS = [

  /* ==== CSP-1: the wipe helper (module-side, escalation lives here) ======= */
  {
    file: CSP, id: 'csp-purge-pts-helper',
    why: 'design walk finding 5: PHI wipes are localStorage-only; the sj-2.0 IndexedDB record must leave at logout, PROVEN (Q2 blocking). The helper owns the verdict + escalation so EVERY purge caller inherits it.',
    find: '  function purge(email) {\n    var removedLocal = [];',
    replace:
      '  function purgePatientStore(email) {\n' +
      '    /* sj-2.0 wipes (design Q2, BLOCKING): the sj-2.0 patient store keeps this\n' +
      '       account\'s roster as one IndexedDB record (db mlsPtsStoreV2 / store\n' +
      '       ptsBlobs, key sf_u::<email>::patients) plus two small localStorage keys\n' +
      '       (ptsJournalV2 / ptsGenV2). Logout must remove all three and PROVE the\n' +
      '       removal: __mlsPtsStore.wipe() deletes ONLY the current account\'s record\n' +
      '       and answers with a read-back-verified receipt - verifiedEmpty===true is\n' +
      '       the ONLY green. Own-prefix-only by design: other accounts\' records and\n' +
      '       foreign namespaces stay untouched, exactly like the localStorage rules\n' +
      '       above (this module never deletes the shared database).\n' +
      '       Fail-closed: a missing store, an unresolved (::undefined::/::_::)\n' +
      '       namespace, a namespace that does not match the email being purged, or\n' +
      '       an unproven wipe all resolve {verifiedEmpty:false} and ESCALATE - the\n' +
      '       caller may not treat this sign-out as clean (no proof, no green). */\n' +
      '    var prefix = accountPrefix(email);\n' +
      '    var rec = { site: \'clinical-state-purge\', at: Date.now(), attempted: false, verifiedEmpty: false, escalated: false, error: \'\' };\n' +
      '    function settle() {\n' +
      '      if (rec.verifiedEmpty !== true) {\n' +
      '        rec.escalated = true;\n' +
      '        /* LOUD wherever it matters: any real page (document present) and any\n' +
      '           context where a wipe actually ran and failed. Bare vm harnesses\n' +
      '           without a document stay quiet - the receipt still refuses green. */\n' +
      '        if (rec.attempted || root.document != null) {\n' +
      '          try { if (root.console && root.console.error) root.console.error(\'[clinical-state-purge] PATIENT-STORE WIPE UNPROVEN - IndexedDB patient bytes may remain on this device\', rec); } catch (_) {}\n' +
      '          try { if (typeof root.toast === \'function\') root.toast(\'Sign-out could not PROVE patient data was removed from this device. Tell MLS support before anyone else uses this computer.\', \'err\'); } catch (_) {}\n' +
      '        }\n' +
      '      }\n' +
      '      try { root.__mlsPtsWipeLast = rec; } catch (_) {}\n' +
      '      return rec;\n' +
      '    }\n' +
      '    if (!email) { rec.error = \'no-account-email\'; return Promise.resolve(settle()); }\n' +
      '    if (prefix.indexOf(\'::undefined::\') >= 0 || prefix.indexOf(\'::_::\') >= 0) { rec.error = \'unresolved-account-namespace\'; return Promise.resolve(settle()); }\n' +
      '    if (!root.__mlsPtsStore || typeof root.__mlsPtsStore.wipe !== \'function\') { rec.error = \'pts-store-missing\'; return Promise.resolve(settle()); }\n' +
      '    if (typeof root.uns === \'function\') {\n' +
      '      /* the store wipes uns()\'s CURRENT namespace; purge() is told an email.\n' +
      '         If they disagree the wipe would hit the wrong account - refuse and\n' +
      '         escalate instead of accepting a green for the wrong namespace. */\n' +
      '      var liveKey = null;\n' +
      '      try { liveKey = root.uns(\'patients\'); } catch (_) {}\n' +
      '      if (liveKey !== prefix + \'patients\') { rec.error = \'namespace-mismatch: the live session namespace is not the account being purged\'; return Promise.resolve(settle()); }\n' +
      '    }\n' +
      '    rec.attempted = true;\n' +
      '    var wiped;\n' +
      '    try { wiped = Promise.resolve(root.__mlsPtsStore.wipe()); }\n' +
      '    catch (e) { rec.error = \'wipe-call: \' + String((e && e.message) || e).slice(0, 160); return Promise.resolve(settle()); }\n' +
      '    return wiped.then(function (w) {\n' +
      '      rec.store = (w && typeof w === \'object\') ? w : null;\n' +
      '      var ok = !!(w && w.verifiedEmpty === true);\n' +
      '      if (ok) {\n' +
      '        /* INDEPENDENT read-back keyed on the EMAIL prefix, not on uns():\n' +
      '           the logout flow tears the session down right after purge() is\n' +
      '           called, so a verify routed through uns() could re-resolve to the\n' +
      '           ::_:: namespace and pass vacuously. These three reads cannot. */\n' +
      '        var left = [];\n' +
      '        [\'patients\', \'ptsJournalV2\', \'ptsGenV2\'].forEach(function (s) {\n' +
      '          try { if (root.localStorage.getItem(prefix + s) !== null) left.push(s); }\n' +
      '          catch (_) { left.push(s + \'?\'); }\n' +
      '        });\n' +
      '        if (left.length) { ok = false; rec.error = \'localStorage-keys-remain: \' + left.join(\',\'); }\n' +
      '      } else if (!rec.error) rec.error = (w && w.error) ? String(w.error).slice(0, 160) : \'store-wipe-unverified\';\n' +
      '      rec.verifiedEmpty = ok;\n' +
      '      return settle();\n' +
      '    }, function (e) {\n' +
      '      rec.error = \'wipe-rejected: \' + String((e && e.message) || e).slice(0, 160);\n' +
      '      return settle();\n' +
      '    });\n' +
      '  }\n' +
      '  function purge(email) {\n    var removedLocal = [];'
  },

  /* ==== CSP-2: purge() runs the helper and returns the receipt promise ==== */
  {
    file: CSP, id: 'csp-purge-wire',
    why: 'the wipe runs AFTER the prefix removal loop (so the independent read-back sees the final state) and its promise rides the purge() return as `ptsStore` for the logout barrier.',
    find:
      '    clearVolatileClinicalGlobals();\n' +
      '    var databases = purgeAudioDatabases();\n' +
      '    return { removedLocal: removedLocal, sessionCleared: true, databases: databases };',
    replace:
      '    clearVolatileClinicalGlobals();\n' +
      '    var databases = purgeAudioDatabases();\n' +
      '    var ptsStore = purgePatientStore(email); /* sj-2.0 Q2: resolves the wipe receipt; never rejects */\n' +
      '    return { removedLocal: removedLocal, sessionCleared: true, databases: databases, ptsStore: ptsStore };'
  },

  /* ==== SF-1: logout barrier waits for the proof ========================== */
  {
    file: SF, id: 'sf-logout-pts-barrier',
    why: 'the purge caller must be able to await the verdict: __mlsLogoutPurge (the existing logout barrier, awaited by the sensitive-session-boundary suite) now includes the wipe receipt. Escalation itself is module-side in clinical-state-purge, so every caller inherits it.',
    find:
      '    const _clinicalPurge=_purge&&_purge.databases?_purge.databases:Promise.resolve([]);\n' +
      '    const _consentPurge=typeof _mlsPurgeConsentAuditDb===\'function\'?_mlsPurgeConsentAuditDb(_logoutEmail):Promise.resolve(false);\n' +
      '    window.__mlsLogoutPurge=Promise.all([_clinicalPurge,_consentPurge]);',
    replace:
      '    const _clinicalPurge=_purge&&_purge.databases?_purge.databases:Promise.resolve([]);\n' +
      '    const _consentPurge=typeof _mlsPurgeConsentAuditDb===\'function\'?_mlsPurgeConsentAuditDb(_logoutEmail):Promise.resolve(false);\n' +
      '    /* sj-2.0 wipes (design Q2, BLOCKING): the patient-store wipe receipt rides\n' +
      '       the logout barrier, so anything awaiting __mlsLogoutPurge also waits for\n' +
      '       the IndexedDB proof. verifiedEmpty:false escalates inside\n' +
      '       clinical-state-purge (the module owns the verdict; every caller\n' +
      '       inherits it). Resolves null when the purge module predates sj-2.0. */\n' +
      '    const _ptsWipe=_purge&&_purge.ptsStore?_purge.ptsStore:Promise.resolve(null);\n' +
      '    window.__mlsLogoutPurge=Promise.all([_clinicalPurge,_consentPurge,_ptsWipe]);'
  },

  /* ==== SF-2: clearDeviceData - proof gates the success toast ============= */
  {
    file: SF, id: 'sf-cleardevicedata-wipe',
    why: 'clearDeviceData is the second PHI wipe surface (design finding 5). The wipe lands AFTER the consent-audit purge (its call must stay within 1200 bytes of the function head - recording-consent-gate-runtime.test.js:427 pin, offset today: 698). Success toast fires ONLY on proven-empty; failure keeps the reload but slows it and says so.',
    find:
      '  try{ if(typeof _mlsPurgeConsentAuditDb===\'function\') await _mlsPurgeConsentAuditDb(consentAccount); }catch(e){}\n' +
      '  try{ toast(\'Cleared saved data on this device. Reloading' + ELL + '\',\'ok\'); }catch(e){}\n' +
      '  setTimeout(()=>{ try{ location.reload(); }catch(e){ location.href=location.href; } },400);',
    replace:
      '  try{ if(typeof _mlsPurgeConsentAuditDb===\'function\') await _mlsPurgeConsentAuditDb(consentAccount); }catch(e){}\n' +
      '  /* sj-2.0 wipes (design Q2, BLOCKING): the patient store\'s IndexedDB copy is\n' +
      '     part of "saved data on this device". Wipe it through __mlsPtsStore.wipe()\n' +
      '     and REQUIRE the proof: verifiedEmpty===true (own record read back null,\n' +
      '     journal + generation keys read back null) is the ONLY green - anything\n' +
      '     less keeps the success toast OFF, escalates loudly, and slows the reload\n' +
      '     so the escalation is seen. Own-prefix-only: only this account\'s record is\n' +
      '     deleted. The ::undefined::/::_:: namespace class is refused here exactly\n' +
      '     as the store\'s own init() refuses it - a wipe aimed at an unresolved\n' +
      '     namespace greens the WRONG namespace while the real bytes survive. */\n' +
      '  let _pwRec=null,_pwOk=false;\n' +
      '  try{\n' +
      '    if(!(window.__mlsPtsStore&&typeof window.__mlsPtsStore.wipe===\'function\')) _pwRec={verifiedEmpty:false,error:\'pts-store-missing\'};\n' +
      '    else if(prefix.indexOf(\'::undefined::\')>=0||prefix.indexOf(\'::_::\')>=0) _pwRec={verifiedEmpty:false,error:\'unresolved-account-namespace\'};\n' +
      '    else _pwRec=await window.__mlsPtsStore.wipe();\n' +
      '  }catch(e){ _pwRec={verifiedEmpty:false,error:\'wipe-rejected: \'+String((e&&e.message)||e).slice(0,160)}; }\n' +
      '  try{\n' +
      '    if(!_pwRec||typeof _pwRec!==\'object\') _pwRec={verifiedEmpty:false,error:\'no-receipt\'};\n' +
      '    _pwOk=_pwRec.verifiedEmpty===true;\n' +
      '    if(_pwOk){\n' +
      '      /* independent read-back on the ENTRY-TIME prefix - immune to any uns()\n' +
      '         drift across the awaits above */\n' +
      '      const _pwLeft=[prefix+\'patients\',prefix+\'ptsJournalV2\',prefix+\'ptsGenV2\'].filter(k=>{ try{ return localStorage.getItem(k)!==null; }catch(e){ return true; } });\n' +
      '      if(_pwLeft.length){ _pwOk=false; _pwRec.verifiedEmpty=false; _pwRec.error=\'localStorage-keys-remain: \'+_pwLeft.join(\',\'); }\n' +
      '    }\n' +
      '    _pwRec.site=\'clearDeviceData\'; _pwRec.at=Date.now(); window.__mlsPtsWipeLast=_pwRec;\n' +
      '  }catch(e){ _pwOk=false; }\n' +
      '  if(_pwOk){ try{ toast(\'Cleared saved data on this device. Reloading' + ELL + '\',\'ok\'); }catch(e){} }\n' +
      '  else{\n' +
      '    try{ console.error(\'[clearDeviceData] PATIENT-STORE WIPE UNPROVEN (design Q2: no proof, no green)\',_pwRec); }catch(e){}\n' +
      '    try{ toast(\'Saved data was cleared, but patient-data removal from this device could NOT be proven complete. Tell MLS support before anyone else uses this computer.\',\'err\'); }catch(e){}\n' +
      '  }\n' +
      '  setTimeout(()=>{ try{ location.reload(); }catch(e){ location.href=location.href; } },_pwOk?400:4200);'
  }
];

/* ---------------------------------------------------------------------------
 * Engine: sequential exact-byte splices with occurrence==1 assertions.
 * Copied shape: tests/patch-daynote-foldin.js (ALREADY APPLIED is judged on
 * the REPLACE text FIRST, because several edits splice by prefix/suffix and
 * their find survives a correct apply; a second --apply must never
 * double-splice).
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

/* post-splice invariants (checked on the in-memory result, dry-run and apply):
 * the qg-2.0 write-only latch count must NOT move, and the consent-audit call
 * must stay inside its 1200-byte pin window. */
function assertInvariants(raw, patched) {
  const latch = '__mlsPtsEdit' + 'AtRiskUnknown'; /* constructed: this file must never carry the literal (one writer, zero readers - a grep-counted guard) */
  const before = occurrences(raw[SF], latch);
  const after = occurrences(patched[SF], latch);
  if (before !== after) throw new Error('INVARIANT: qg-2.0 latch identifier count moved ' + before + ' -> ' + after);
  const cAt = patched[SF].indexOf('async function clearDeviceData(){');
  if (cAt < 0) throw new Error('INVARIANT: clearDeviceData head lost');
  if (!patched[SF].slice(cAt, cAt + 1200).includes('await _mlsPurgeConsentAuditDb(consentAccount)'))
    throw new Error('INVARIANT: consent-audit call left the 1200-byte pin window (recording-consent-gate-runtime.test.js:427)');
  if (occurrences(patched[SF], 'Promise.all([_clinicalPurge,_consentPurge,_ptsWipe]);') !== 1)
    throw new Error('INVARIANT: logout barrier fold-in not present exactly once');
  /* every byte this patcher ADDS must be ASCII (latin1 travel); the only
   * non-ASCII in any replace is the preserved pre-existing ellipsis */
  for (const e of EDITS) {
    const added = e.replace.split(ELL).join('');
    for (let i = 0; i < added.length; i++) {
      if (added.charCodeAt(i) > 126) throw new Error('INVARIANT: non-ASCII byte in replace of [' + e.id + '] at ' + i);
    }
  }
}

function main() {
  if (!ROOT) {
    console.error('REFUSING: set MLS_REPO_ROOT to the repo checkout to patch (this draft will not guess a repo).');
    process.exit(1);
  }
  const APPLY = process.argv.indexOf('--apply') >= 0;
  const files = Array.from(new Set(EDITS.map(e => e.file)));
  const sources = {};
  for (const f of files) {
    const full = path.join(ROOT, f);
    sources[f] = fs.readFileSync(full, 'latin1');
    console.log('read  ' + f + '  (' + sources[f].length + ' bytes, latin1)');
  }

  let result;
  try {
    result = applyToSources(sources, { tolerateApplied: !APPLY });
    assertInvariants(sources, result.sources);
  } catch (err) {
    console.error('\nDRY-RUN: FAIL');
    console.error(String(err && err.message || err));
    process.exit(1);
  }
  const applied = result.log.filter(l => l.status === 'already-applied');
  if (applied.length === EDITS.length) {
    console.log('\nDRY-RUN: ALL ' + EDITS.length + ' EDITS ALREADY APPLIED - the repo carries the sj-2.0 wipes stage; nothing to do.');
    return;
  }
  if (applied.length > 0) {
    console.error('\nDRY-RUN: FAIL - PARTIAL APPLY: ' + applied.length + '/' + EDITS.length +
      ' edits already present (' + applied.map(l => l.id).join(', ') + '). Restore the .sj2w.bak before this patcher may run.');
    process.exit(1);
  }
  for (const l of result.log) console.log('anchor ok  [' + l.id + ']  ' + l.file + ' @' + l.at);
  for (const f of files) {
    console.log('post-splice size ' + f + ': ' + sources[f].length + ' -> ' + result.sources[f].length +
      ' (+' + (result.sources[f].length - sources[f].length) + ' bytes)');
  }
  console.log('\nDRY-RUN: PASS - ' + result.log.length + '/' + EDITS.length + ' anchors verified (occurrence==1 each), invariants held (latch count unmoved, consent pin window intact, added bytes ASCII).');

  if (!APPLY) {
    console.log('No files written. Re-run with --apply to splice (writes .sj2w.bak first).');
    console.log('REMINDER after apply: register wipes-contract.test.js in tests/run-all.js (EXISTING IS NOT RUNNING), run the gated suite, then the LIVE logout-wipe-zero-idb-bytes check.');
    return;
  }

  for (const f of files) {
    const full = path.join(ROOT, f);
    fs.writeFileSync(full + '.sj2w.bak', sources[f], 'latin1');
    fs.writeFileSync(full, result.sources[f], 'latin1');
    console.log('APPLIED ' + f + ' (backup: ' + f + '.sj2w.bak)');
  }
}

if (require.main === module) main();
module.exports = { EDITS, applyToSources, occurrences, assertInvariants, ROOT, CSP, SF };
