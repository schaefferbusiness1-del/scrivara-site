/* =============================================================================
 * MLS Scribe — EXACT-DUPLICATE PATIENT AUTO-MERGE  (pm-1.0.0)
 *
 * Owner report 2026-07-17 (verified live: 12 duplicate pairs in 1427 records):
 * pulls + manual adds can leave TWO records for the same human. This module
 * merges duplicates automatically — and ONLY exact-identity duplicates:
 *
 *   - same MRN digits (5+ digits), OR
 *   - same normalized name AND same DOB digits (6+ digits).
 *
 * Near-matches (name-only, fuzzy names, missing DOB) are NEVER merged; a wrong
 * merge is clinically worse than a duplicate, so this stays fail-closed.
 *
 * Merge semantics (data can only grow, never be lost):
 *   - WINNER = the record with the strongest PROVENANCE (a landed Athena
 *     chart, then an Athena-scheduled origin, then anything, then an
 *     explicitly hand-typed manual-add row), else the one with more visits,
 *     else the longer summary, else the first seen.  (ptfix-1.0.0 (b1169):
 *     this used to read "a verified-import id ('mr…' prefix)", which no
 *     minter in the tree produces - see provRank.)
 *   - Identity values the winner ALREADY holds are never overwritten; when
 *     the two disagree on dob/mrn/athenaId/sex the discarded value is kept on
 *     the survivor as mergedConflicts rather than dropped.
 *   - The local save is fail-closed, and the absorbed row is deleted on the
 *     SERVER as well; the alias is written only for ids whose server delete
 *     was confirmed, because an unconfirmed row is coming back.
 *   - Scalar fields: winner's EMPTY fields are filled from the loser; a
 *     non-empty winner field is never overwritten.
 *   - Visits: loser visits move to the winner unless already present (matched
 *     by encounterId / sourceVisitKey / rowKey, else date + trimmed body).
 *     Moved visits keep every flag and are stamped mergedFrom for audit.
 *   - The loser record is then removed and an alias loserId -> winnerId is
 *     stored in localStorage (mls_patient_alias_v1) so later lookups can
 *     resolve stale references.
 *
 * Runs at boot (delayed), after each completed schedule job, and on demand via
 * window.__mlsPatientMerge.run(). Additive + reversible: __mlsPatientMerge_revert
 * (stops future runs; performed merges persist — data was only combined).
 * ES5 only (var/function, no arrows), matches house feature-module shape.
 * ========================================================================== */
(function () {
  'use strict';
  if (window.__mlsPatientMerge && window.__mlsPatientMerge.installed) return;

  var ALIAS_KEY = 'mls_patient_alias_v1';
  var stopped = false;
  var deferT = null;

  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }
  function S(v) { return v == null ? '' : String(v); }
  function normName(s) { return S(s).toLowerCase().replace(/[^a-z0-9]/g, ''); }
  function digits(s) { return S(s).replace(/\D/g, ''); }
  function visitBody(v) { return S(v && (v.raw || v.text || v.note || v.detail)).replace(/\s+/g, ' ').trim(); }
  function visitKey(v) {
    var eid = S(v && (v.encounterId || v.encounterID)).trim().toLowerCase();
    if (eid) return 'e|' + eid;
    var src = S(v && (v.sourceVisitKey || v.rowKey)).trim().toLowerCase();
    if (src) return 's|' + src;
    return 'd|' + S(v && v.date) + '|' + visitBody(v).toLowerCase().slice(0, 300);
  }
  function loadAliases() { return safe(function () { return JSON.parse(localStorage.getItem(ALIAS_KEY) || '{}') || {}; }, {}); }
  function saveAliases(map) { safe(function () { localStorage.setItem(ALIAS_KEY, JSON.stringify(map)); }); }

  /* ptfix-1.0.0 (b1169): PROVENANCE RANKS THE WINNER, NOT AN ID SPELLING.
     The old first test was /^mr/ on the id, documented in the header as "the
     record with a verified-import id ('mr...' prefix)". NO minter in the
     shipped tree produces a semantic 'mr' prefix - the four that exist emit
     'p_sched_<hash>', 'p<base36 ms><rand>', 'p<ms><rand>' and a bare base36
     timestamp - so the only rows that ever satisfied it were HAND-TYPED
     manual-add records whose Date.now().toString(36) happened to begin "mr",
     which is true only for 2026-06-30 -> 2026-07-25. That is the exact
     INVERSE of the advertised rule: a DOB typed by hand beat the one Athena
     supplied. From 26 July 2026 onward no record can satisfy it at all, so
     the advertised rule is simply not in force.
     Rank on proof the records already carry instead: a landed Athena chart
     (athenaChartImportedAt - the shell's own _athenaChartLanded test, which
     is set only by a real import write), then an Athena-scheduled origin,
     then anything, then an explicitly hand-typed row. */
  function provRank(p) {
    if (!p) return 0;
    if (S(p.athenaChartImportedAt).trim()) return 3;
    if (p.athenaProfileCoverage && typeof p.athenaProfileCoverage === 'object') return 3;
    var src = S(p.source).toLowerCase();
    if (src === 'athena-schedule' || /^p_sched_/.test(S(p.id))) return 2;
    if (src === 'manual-add') return 0;
    return 1;
  }
  function winnerOf(a, b) {
    var ar = provRank(a), br = provRank(b);
    if (ar !== br) return ar > br ? [a, b] : [b, a];
    var av = (a.visits || []).length, bv = (b.visits || []).length;
    if (av !== bv) return av > bv ? [a, b] : [b, a];
    if (S(a.summary).length !== S(b.summary).length) return S(a.summary).length > S(b.summary).length ? [a, b] : [b, a];
    return [a, b];
  }

  /* Fields that may be copied INTO an empty winner slot. Never overwrites. */
  var FILL_FIELDS = ['dob', 'mrn', 'athenaId', 'phone', 'email', 'summary', 'meds', 'problems', 'allergies', 'vitals', 'provider', 'insurance', 'address'];

  /* ptfix-1.0.0 (b1169): A DISCARDED IDENTITY VALUE IS RECORDED, NOT DROPPED.
     FILL_FIELDS only writes into an EMPTY winner slot, so when the two charts
     each carry a DIFFERENT non-empty dob / mrn / athenaId / sex the loser's
     value used to vanish with no trace. The merge criterion itself guarantees
     the pair agrees on ONE identity key (same MRN, or same name+DOB) and says
     nothing about the others, so this is the ordinary case, not the rare one.
     The survivor keeps what was thrown away so a human can adjudicate. */
  var CONFLICT_FIELDS = ['dob', 'mrn', 'athenaId', 'sex'];

  /* tn-1.0.0: the team-note revision stamp and union. The shell owns the
     canonical copy (__mlsTeamNotesUnion, beside upsertPatient) and it wins
     whenever it is loaded; this fallback exists so the module stays testable
     and boot-order independent, and the suite pins the two against each
     other - the same arrangement plv uses for provKey/dobKey. */
  function noteRev(n) {
    if (!n || typeof n !== 'object') return 0;
    var a = Number(n.at) || 0, e = Number(n.ed) || 0, d = Number(n.delAt) || 0;
    return Math.max(a, e, d);
  }
  function localNoteUnion(a, b) {
    var lists = [Array.isArray(a) ? a : [], Array.isArray(b) ? b : []], out = [], slot = {}, li, i, n, id, at;
    for (li = 0; li < lists.length; li++) {
      for (i = 0; i < lists[li].length; i++) {
        n = lists[li][i];
        if (!n || typeof n !== 'object') continue;
        id = String(n.id || '');
        if (!id) continue;
        at = slot[id];
        if (at === undefined) { slot[id] = out.length; out.push(n); }
        else if (noteRev(n) > noteRev(out[at])) out[at] = n;
      }
    }
    out.sort(function (x, y) {
      var d = (Number(y.at) || 0) - (Number(x.at) || 0);
      if (d) return d;
      var xi = String(x.id || ''), yi = String(y.id || '');
      return xi < yi ? 1 : xi > yi ? -1 : 0;
    });
    return out;
  }
  function unionNotes(a, b) {
    var f = window.__mlsTeamNotesUnion;
    if (typeof f === 'function') { var o = safe(function () { return f(a, b); }, null); if (Array.isArray(o)) return o; }
    return localNoteUnion(a, b);
  }

  function mergePair(winner, loser) {
    var moved = 0, fi, f;
    /* ptfix-1.0.0 (b1169): record the conflicts BEFORE the fill loop runs, so
       a slot the fill legitimately populates from an EMPTY winner is never
       mistaken for a disagreement. */
    var conflicts = null, cw, cl;
    for (fi = 0; fi < CONFLICT_FIELDS.length; fi++) {
      f = CONFLICT_FIELDS[fi];
      cw = S(winner[f]).trim(); cl = S(loser[f]).trim();
      if (cw && cl && cw !== cl) {
        (conflicts || (conflicts = [])).push({ field: f, kept: cw, discarded: cl, fromId: S(loser.id), at: Date.now() });
      }
    }
    if (conflicts) {
      winner.mergedConflicts = (Array.isArray(winner.mergedConflicts) ? winner.mergedConflicts : []).concat(conflicts);
    }
    for (fi = 0; fi < FILL_FIELDS.length; fi++) {
      f = FILL_FIELDS[fi];
      if (!S(winner[f]).trim() && S(loser[f]).trim()) winner[f] = loser[f];
    }
    /* tn-1.0.0: TEAM NOTES UNION - and it CANNOT ride in FILL_FIELDS above.
       That loop is a scalar fill: it copies only into an EMPTY winner slot, so
       a winner that already carried a single team note would silently discard
       the loser's entire thread, and S(array).trim() is meaningless on an
       array anyway. These two records are the SAME human by this module's own
       exact-identity criterion, so both threads are about that human and both
       have to survive - a merge that loses one doctor's message to another is
       the "our merge deletes chart facts" class landing on a communication
       surface, where the loss is a conversation nobody knows is missing.
       Union by id with the highest revision stamp winning is the identical
       rule the shell's upsertPatient carry uses, so a merge and a stale
       write-back can never disagree about which copy of a note is current, and
       a note deleted before the merge stays deleted after it. */
    var notesMoved = 0;
    var lNotes = Array.isArray(loser.teamNotes) ? loser.teamNotes : [];
    if (lNotes.length) {
      var had = {}, wNotes = Array.isArray(winner.teamNotes) ? winner.teamNotes : [], ni;
      for (ni = 0; ni < wNotes.length; ni++) if (wNotes[ni] && wNotes[ni].id != null) had[String(wNotes[ni].id)] = 1;
      for (ni = 0; ni < lNotes.length; ni++) {
        if (lNotes[ni] && lNotes[ni].id != null && !had[String(lNotes[ni].id)] && !lNotes[ni].del) notesMoved++;
      }
      winner.teamNotes = unionNotes(wNotes, lNotes);
    }
    var have = {}, wi;
    var wv = winner.visits = winner.visits || [];
    for (wi = 0; wi < wv.length; wi++) have[visitKey(wv[wi])] = 1;
    var lv = loser.visits || [];
    for (wi = 0; wi < lv.length; wi++) {
      var key = visitKey(lv[wi]);
      if (have[key]) continue;
      have[key] = 1;
      var mv = lv[wi];
      /* identity equality is the merge criterion, so rebinding is truthful;
         the original binding is preserved for audit.
         ptfix-1.0.0 (b1169): the moved visit is stamped on a COPY. Stamping
         the stored object in place made the merge partly irreversible BEFORE
         the save that commits it: a refused save (quota, stale generation,
         account switch) left the loser's visits carrying mergedFrom and a
         rewritten identityBinding on a chart that was never merged, and the
         retry then overwrote mergedFromBinding with the already-rewritten
         value, destroying the audit trail this stamp exists to keep. */
      if (mv && typeof mv === 'object') {
        var mvc = {}, mk;
        for (mk in mv) if (Object.prototype.hasOwnProperty.call(mv, mk)) mvc[mk] = mv[mk];
        if (mvc.identityBinding != null) { mvc.mergedFromBinding = mvc.identityBinding; mvc.identityBinding = String(winner.id); }
        mvc.mergedFrom = String(loser.id);
        mv = mvc;
      }
      wv.push(mv);
      moved++;
    }
    return { visits: moved, notes: notesMoved };
  }

  /* pm-1.0.1: an explicit pull keeps __mlsPullBusyAt fresh (stamped at start,
     lease-touched every 25s, zeroed on finish). Merging while it is fresh
     rewrites the patient store MID-history-batch: the batch's patientById
     proofs then miss (the merged loser id vanishes) and every merged patient
     lands in history-partial — the live 2026-07-18 "history was not saved"
     verdict on a pull whose saves all verified. Defer until the pull is idle. */
  function pullBusy() {
    return safe(function () {
      var t = Number(window.__mlsPullBusyAt || 0);
      return t > 0 && (Date.now() - t) < 90000;
    }, false);
  }
  function run(opts) {
    if (stopped) return { merged: 0 };
    if (pullBusy()) {
      if (!deferT) deferT = setTimeout(function () { deferT = null; safe(function () { run(opts); }); }, 20000);
      return { merged: 0, reason: 'deferred-pull-busy' };
    }
    var getP = window.getPatients, saveP = window.savePatients;
    if (typeof getP !== 'function' || typeof saveP !== 'function') return { merged: 0, reason: 'store-unavailable' };
    var pts = safe(function () { return getP() || []; }, []);
    if (!pts.length) return { merged: 0 };
    var byKey = {}, i, p, keys, ki;
    for (i = 0; i < pts.length; i++) {
      p = pts[i]; if (!p || !p.id) continue;
      keys = [];
      var mrn = digits(p.mrn || p.athenaId);
      if (mrn.length >= 5) keys.push('m|' + mrn);
      var nn = normName(p.name), dd = digits(p.dob);
      if (nn && dd.length >= 6) keys.push('n|' + nn + '|' + dd);
      for (ki = 0; ki < keys.length; ki++) (byKey[keys[ki]] = byKey[keys[ki]] || []).push(p);
    }
    var seenPair = {}, removedIds = {}, merged = 0, movedVisits = 0, movedNotes = 0, k;
    /* ptfix-1.0.0 (b1169): THE SURVIVOR IS BUILT AS AN OWN-KEY COPY.
       mergePair used to mutate the winner IN PLACE, and `pts` is getPatients()
       - the live row objects - so the object handed to savePatients was the
       identical reference the store already held. The store's dirty test is
       `dirtySet[id] || prev===undefined || prev!==r || r.updated>=lastSaveWall`
       (see computeDelta): with no dirtyIds, prev===r and an un-bumped
       `updated`, the survivor landed in NEITHER delta.put NOR the journal
       entry. So the absorbed visits and the absorbed doctor-to-doctor team
       notes existed on this device only - not queued to the account, not
       replayed to a second tab - while the toast said "nothing was lost".
       A copy makes the row reference-different (so the delta sees it), an
       explicit dirtyIds makes it unambiguous, and `updated` is stamped. The
       copy owns its visits/teamNotes arrays too, so a REFUSED save leaves the
       stored rows exactly as they were and the next run retries cleanly. */
    var copyOf = Object.create(null);
    function liveRow(p) { return (p && p.id != null && copyOf[String(p.id)]) || p; }
    function ownCopy(p) {
      var id = String(p.id), c = copyOf[id], ck;
      if (c) return c;
      c = {};
      for (ck in p) if (Object.prototype.hasOwnProperty.call(p, ck)) c[ck] = p[ck];
      if (Array.isArray(c.visits)) c.visits = c.visits.slice();
      if (Array.isArray(c.teamNotes)) c.teamNotes = c.teamNotes.slice();
      if (Array.isArray(c.mergedConflicts)) c.mergedConflicts = c.mergedConflicts.slice();
      copyOf[id] = c;
      return c;
    }
    for (k in byKey) {
      if (!Object.prototype.hasOwnProperty.call(byKey, k)) continue;
      var group = byKey[k].filter(function (x) { return !removedIds[x.id]; });
      /* unique by id inside the group */
      var uniq = [], seenIds = {};
      for (i = 0; i < group.length; i++) if (!seenIds[group[i].id]) { seenIds[group[i].id] = 1; uniq.push(liveRow(group[i])); }
      while (uniq.length > 1) {
        var pairKey = uniq[0].id + '|' + uniq[1].id;
        if (seenPair[pairKey]) break;
        seenPair[pairKey] = 1;
        var wl = winnerOf(uniq[0], uniq[1]), w = wl[0], l = wl[1];
        /* extra guard: if BOTH records carry an MRN and they disagree, never merge */
        var wm = digits(w.mrn || w.athenaId), lm = digits(l.mrn || l.athenaId);
        if (wm.length >= 5 && lm.length >= 5 && wm !== lm) break;
        w = ownCopy(w);
        var pairRes = mergePair(w, l);
        w.updated = Date.now();
        movedVisits += pairRes.visits;
        movedNotes += pairRes.notes;
        removedIds[l.id] = String(w.id);
        merged++;
        uniq = [w].concat(uniq.slice(2)).filter(function (x) { return !removedIds[x.id]; });
      }
    }
    if (!merged) return { merged: 0 };
    var kept = [], dirtyIds = [];
    for (i = 0; i < pts.length; i++) {
      var _row = pts[i];
      if (_row && removedIds[_row.id]) continue;
      kept.push((_row && _row.id != null && copyOf[String(_row.id)]) || _row);
    }
    for (k in copyOf) if (Object.prototype.hasOwnProperty.call(copyOf, k) && !removedIds[k]) dirtyIds.push(k);
    /* pm-1.0.3 (2026-08-31): {allowRemovals:true} IS REQUIRED FOR A SAVE THAT
       DROPS ROWS, and this one dropped rows for a year without it. The patient
       row guard reads an unflagged shrink as an accidental truncation and
       carries every absent row straight back - and `kept` is a .filter()
       product, so it carries no read-generation stamp either and falls to the
       12-second clock rule, which a just-merged loser always passes. So the
       merge announced "nothing was lost" and then undid its own removal, while
       the alias map was written unconditionally: the duplicate survived AND
       every later lookup was told it had been absorbed. The identical defect
       was found and fixed for the console dedup (feat_mls_b121_pack.js,
       dedupsrv-1.0.0) and never back-ported here. */
    /* ptfix-1.0.0 (b1169): A FAILED SAVE MUST NOT TOAST SUCCESS.
       safe() discards the exception and returns undefined - and savePatients
       returns undefined on success too, so the caller could not tell the two
       apart. savePatients genuinely throws: MLS_PATIENT_BATCH_ACCOUNT_CHANGED
       on an account switch, MLS_PTS_STORE_STALE_GEN on a generation race, and
       the journal/quota failure saveSync rethrows after toasting "Local
       storage is full". Execution then fell straight through to the alias
       write and the unconditional "nothing was lost" toast: on a quota-full
       device the doctor was told two charts had merged while both were still
       on screen, and every later lookup of the absorbed id resolved to a
       chart that had never actually been merged. Fail closed and say so. */
    var saveOk = true, saveWhy = '';
    try {
      saveP(kept, undefined, { allowRemovals: true, dirtyIds: dirtyIds });
    } catch (eSave) {
      saveOk = false;
      saveWhy = S(eSave && (eSave.code || eSave.message)).slice(0, 120) || 'the save was refused';
    }
    if (!saveOk) {
      /* removedIds and the alias map are deliberately LEFT UNTOUCHED so the
         next run retries from a clean state. */
      if (!opts || opts.silent !== true) {
        safe(function () {
          if (typeof window.toast === 'function') {
            window.toast('Could NOT merge ' + merged + ' duplicate patient record' + (merged === 1 ? '' : 's') +
              ' - the save was refused (' + saveWhy + '). Nothing was changed: both charts are still here, and MLS will try again.', 'err');
          }
        });
      }
      return { merged: 0, reason: 'save-failed', why: saveWhy };
    }
    /* ptfix-1.0.0 (b1169): and the survivor must reach the ACCOUNT. savePatients
       never feeds the server queue (_pendingSyncAdd is called from
       upsertPatient), so without this the absorbed visits and team notes lived
       on this device only. One upsert per surviving row that this run actually
       changed - one POST per merged pair, not a roster-wide storm. */
    safe(function () {
      if (typeof window.upsertPatient !== 'function') return;
      for (var ui = 0; ui < kept.length; ui++) {
        var kr = kept[ui];
        if (kr && kr.id != null && copyOf[String(kr.id)] === kr) safe(function () { window.upsertPatient(kr); });
      }
    });
    /* THE SELECTION FOLLOWS THE SURVIVOR (owner, 2026-08-31: "did u fix the
       patient selected"). This module ran 12s after boot and 4s after every
       completed pull - exactly when a pull has just minted the duplicates -
       removed the absorbed chart out from under whoever had it open, and never
       touched the active-patient pointer. The doctor was then selected on a
       chart that no longer existed: the banner blanked, every getActivePtId()
       caller kept the dead id, and none of the ~30 mls:active-patient-changed
       listeners heard anything, because nothing dispatched it.
       The chain is followed over removedIds, which is THIS run's own
       loser -> winner map, and setActivePtId is the canonical writer - it
       bumps the epoch and fires the app's own announcement.
       ptfix-1.0.0 (b1169): it used to read resolveAlias(), i.e. the PERSISTED
       alias map. That map is now written only for ids the server delete
       actually confirmed (below), and that verdict arrives one fetch later -
       so a follow that waited on it would strand the doctor on a dead id in
       exactly the window it exists to cover. removedIds needs no round trip. */
    safe(function () {
      if (typeof window.getActivePtId !== 'function' || typeof window.setActivePtId !== 'function') return;
      var a = S(window.getActivePtId());
      if (!a || !removedIds[a]) return;
      var win = a, hops = 0;
      while (removedIds[win] && hops++ < 5) win = S(removedIds[win]);
      if (!win || win === a) return;
      window.setActivePtId(win);
    });
    repaintRoster();
    /* ptfix-1.0.0 (b1169): AN ABSORBED CHART MUST DIE ON THE SERVER TOO.
       This was the ONLY persistence the merge did, and the local save is only
       half of it: /api/patients still holds the absorbed row, and hydration
       re-adds any server row the local index does not have
       (loadPatientsFromServer, unconditionally). So the doctor was told
       "nothing was lost", signed in the next morning to find the duplicate
       back, watched it vanish again 12 seconds later, and got the same toast
       after the next pull - forever. In the window where both charts exist a
       note can be written into the wrong one, which is the exact condition
       that makes the resolvers refuse a write as ambiguous.
       The console dedup already learned this (feat_mls_b121_pack.js,
       dedupsrv-1.0.0) and it was never back-ported here. deletePatientOnServer
       resolves an unknown server id from the server list, treats 404 as gone,
       and returns a VERDICT - so the alias for an id whose delete FAILED is
       refused: that row is coming back, and an alias would send every later
       lookup of a chart that still exists off to the survivor. */
    var loserIds = [];
    for (k in removedIds) if (Object.prototype.hasOwnProperty.call(removedIds, k)) loserIds.push(k);

    function commitAliases(ids) {
      if (!ids || !ids.length) return 0;
      var map = loadAliases(), ai;
      for (ai = 0; ai < ids.length; ai++) map[ids[ai]] = removedIds[ids[ai]];
      saveAliases(map);
      return ids.length;
    }
    function announce(badIds, why) {
      if (opts && opts.silent === true) return;
      var head = 'Merged ' + merged + ' duplicate patient record' + (merged === 1 ? '' : 's') +
        ' (' + movedVisits + ' visit' + (movedVisits === 1 ? '' : 's') + ' combined' +
        (movedNotes ? (', ' + movedNotes + ' team note' + (movedNotes === 1 ? '' : 's') + ' kept') : '');
      if (badIds && badIds.length) {
        var reason = why ? S(why[badIds[0]]) : '';
        var msg = head + ') on this device, but ' + badIds.length + ' absorbed chart' +
          (badIds.length === 1 ? ' was' : 's were') + ' NOT removed from your account' +
          (reason ? ' (' + reason + ')' : '') + ' - ' + (badIds.length === 1 ? 'it' : 'they') +
          ' will come back on the next sync. Nothing was lost here; MLS will try again.';
        safe(function () { if (typeof window.toast === 'function') window.toast(msg, 'err'); });
        return;
      }
      safe(function () { if (typeof window.toast === 'function') window.toast(head + ' - nothing was lost).', 'ok'); });
    }

    var delFn = window.deletePatientOnServer;
    if (typeof delFn !== 'function') {
      /* No server-delete helper in this build at all: there is no account copy
         this merge could have left behind, so the local removal is the whole
         truth and the alias is safe to write. Reported, never silent. */
      commitAliases(loserIds);
      announce(null, null);
      return { merged: merged, movedVisits: movedVisits, movedNotes: movedNotes, serverDeletes: 'helper-missing' };
    }
    var pending = safe(function () {
      return Promise.all(loserIds.map(function (lid) {
        return Promise.resolve(delFn(lid)).then(
          function (v) { return { id: lid, ok: !!(v && v.ok), reason: S(v && v.reason) || 'unknown' }; },
          function () { return { id: lid, ok: false, reason: 'threw' }; }
        );
      })).then(function (verdicts) {
        var okIds = [], badIds = [], why = {}, vi;
        for (vi = 0; vi < verdicts.length; vi++) {
          if (verdicts[vi].ok) okIds.push(verdicts[vi].id);
          else { badIds.push(verdicts[vi].id); why[verdicts[vi].id] = verdicts[vi].reason; }
        }
        commitAliases(okIds);
        announce(badIds, why);
        return verdicts;
      });
    }, null);
    safe(function () { window.__mlsPatientMergeLastServerDeletes = pending; });
    return { merged: merged, movedVisits: movedVisits, movedNotes: movedNotes, serverDeletes: 'pending' };
  }

  /* ptfix-1.0.0 (b1169): window.loadPatients HAS NO DEFINITION anywhere in the
     shipped tree - ScribeFlow.html, mls-connect.js and every feat_*.js carry
     only `typeof loadPatients === 'function'` CALL sites - so the merge's one
     post-merge repaint was a guaranteed no-op behind a feature-detect guard.
     The absorbed row kept painting in the Patients list until something else
     happened to re-render, and clicking it took the doctor to a dead id while
     the toast said the merge was done. These are the three repaints
     deletePatient actually uses, plus the roster-memo clear renderPatients
     needs in order to notice that the row SET changed (its memo returns early
     when roster/query/sort/group are unchanged, which they are here). */
  function repaintRoster() {
    safe(function () {
      var list = document.getElementById('ptList');
      if (list) { list._mlsRoster = null; list._mlsNotesVer = null; list._mlsSig = ''; }
    });
    safe(function () { if (typeof window.renderPatients === 'function') window.renderPatients(); });
    safe(function () { if (typeof window.renderProfile === 'function') window.renderProfile(); });
    safe(function () { if (typeof window.renderPatientBar === 'function') window.renderPatientBar(); });
  }

  /* alias resolver for stale references */
  function resolveAlias(id) {
    var map = loadAliases(), cur = S(id), hops = 0;
    while (map[cur] && hops++ < 5) cur = map[cur];
    return cur;
  }

  var bootT = null, jobHandler = null;
  function boot() {
    /* pm-1.0.2 (owner 2026-07-23): the boot-time sweep merges QUIETLY — dupes
       that regenerate between boots made this toast fire on every launch.
       Post-pull and on-demand merges still announce their result. */
    bootT = setTimeout(function () { bootT = null; safe(function () { run({ silent: true }); }); }, 12000);
    jobHandler = function (ev) {
      var j = ev && ev.detail;
      if (!j || j.kind !== 'schedule_pull') return;
      if (j.status === 'completed' || j.status === 'partial') setTimeout(function () { safe(function () { run({ silent: false }); }); }, 4000);
    };
    safe(function () { window.addEventListener('mls:job-progress', jobHandler, false); });
  }

  window.__mlsPatientMerge = { installed: true, version: 'pm-1.0.5', run: run, resolveAlias: resolveAlias, unionNotes: unionNotes, winnerOf: winnerOf, provRank: provRank };
  window.__mlsPatientMerge_revert = function () {
    stopped = true;
    if (bootT) { safe(function () { clearTimeout(bootT); }); bootT = null; }
    if (deferT) { safe(function () { clearTimeout(deferT); }); deferT = null; }
    if (jobHandler) safe(function () { window.removeEventListener('mls:job-progress', jobHandler, false); });
    safe(function () { delete window.__mlsPatientMerge; });
  };
  boot();
})();
