/* =============================================================================
 * MLS Scribe - PROVIDER <-> PATIENT LINKAGE  (plv-1.0.0)
 *
 * Owner, 2026-09-01: "the providers needs to be linked to there patients".
 *
 * A patient's provider is DERIVED, never invented. The only evidence this
 * module will accept is an ATTRIBUTED APPOINTMENT ROW: a schedule row that
 * already carries a provider name because a provider-scoped import stamped it
 * (feat_mls_schedimport_exact.js importAppts / stampProviders - a row from a
 * one-column Athena day grid inherits the SELECTED provider, an 'all'-scope
 * pull with no provider column stays honestly empty). Rows with a blank
 * provider contribute NOTHING, and a patient with zero attributed rows gets
 * NO provider field at all. An empty chip is the honest answer; a guess is not.
 *
 * IDENTITY (the whole reason this is fail-closed):
 *   - STRONG: the row's own patient pointer, patient_external_id /
 *     _mlsTargetPatientId / patientId, equals the patient id. This is the
 *     shell's own idiom (openOpPrepForPatient), and it is the only link an
 *     import actually writes.
 *   - WEAK, and only when the roster makes it unambiguous: normalized name
 *     PLUS a canonical YYYY-MM-DD date of birth (_opDobKey, the same
 *     normalizer the op-note resolver matches appointments to charts with),
 *     and ONLY when exactly one patient in the roster answers to that pair.
 *     Name alone is never enough - that is the rule that keeps exact-name
 *     matching from stitching two humans together, and a COUNT is not worth a
 *     wrong attribution any more than a merge is.
 *   This module NEVER merges, renames, creates or removes a patient. It writes
 *   one additive field onto records that already exist.
 *
 * WHAT IS STORED (one additive key, so there is one thing to grep, one thing
 * to carry forward, and one thing to clear):
 *   p.providerLink = {
 *     v: 1,
 *     primaryProvider: 'Matthew Schaeffer, MD',   // most attributed days
 *     primaryProviderKey: 'matthew schaeffer',    // _calProvKey form
 *     providersSeen: [ { name, key, count, last, days:[...] } ],
 *     at: <ms>
 *   }
 * PHI discipline: provider display name, day keys and counts. Nothing else -
 * no reason, no note text, no patient field is copied in.
 *
 * COUNTS ARE DISTINCT VISIT DAYS, and each entry keeps the day keys it counted
 * (most recent DAYS_MAX). That is what makes re-derivation idempotent AND
 * cumulative: _calAppts only ever holds the LOADED calendar window, so a
 * derivation that recomputed a bare integer from whatever happened to be in
 * memory would report 12 in August and 2 after paging to September. Merging
 * day keys into a bounded set cannot double-count and cannot flap. `capped`
 * says so out loud when the window is full.
 *
 * WHEN IT RUNS: 14s after boot, 5s after a completed/partial schedule pull
 * (one second behind feat_mls_patient_merge so a merge survivor is derived,
 * never the loser), and on demand. It DEFERS while an explicit pull is busy
 * (__mlsPullBusyAt fresh) or another tab holds the pull shield - the same
 * rule, and the same reason, as the auto-merge: rewriting the patient store
 * mid-history-batch makes every patientById proof miss.
 *
 * THE SAVE IS A FIELD UPDATE, NEVER A REMOVAL. The id set going in equals the
 * id set coming out, so __mlsPtsRowGuard has nothing to carry and this must
 * NOT pass {allowRemovals:true} - that flag exists to let a save DROP rows and
 * has no business on a stamp. Rows are replaced with copies (own-key copy) so
 * the store's computeDelta sees a real change; mutating the shared row objects
 * in place would compare equal to itself and journal nothing.
 *
 * LOCAL FIRST, SYNCED OPPORTUNISTICALLY. The stamp lands through savePatients,
 * which does not call syncPatientToServer - a month pull can change 400+
 * records at once and 400 POSTs to say "this is still Dr Schaeffer's patient"
 * is a storm nobody asked for. The field rides to the server on the next
 * ordinary upsertPatient for that record (a chart save, a demographics edit, a
 * pull writing the chart), and the shell's upsertPatient carry-forward is what
 * makes that safe: a caller who never saw the field cannot erase it. The server
 * stores the patient as an opaque JSON blob and returns it verbatim, so the
 * field survives the round trip with no backend change.
 *
 * ES5 only (var/function, no arrows), matches house feature-module shape.
 * Additive + reversible: __mlsProviderLink_revert.
 * ========================================================================== */
(function () {
  'use strict';
  if (window.__mlsProviderLink && window.__mlsProviderLink.installed) return;

  var VERSION = 'plv-1.0.0';
  var DAYS_MAX = 12;          /* day keys kept per provider entry */
  var PROV_MAX = 4;           /* provider entries kept per patient */
  var NAME_MAX = 80;          /* stored provider display name cap */
  var FILTER_KEY = 'mls_provider_link_filter_v1';
  /* the "No provider recorded" filter value. A provider key is built from
     [a-z' -] only, so this sentinel can never collide with a real one. */
  var NONE = '__no_provider__';

  var stopped = false;
  var deferT = null, bootT = null, jobHandler = null, updHandler = null, calHandler = null;
  var lastRun = null;

  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }
  function S(v) { return v == null ? '' : String(v); }
  function normName(s) { return S(s).toLowerCase().replace(/[^a-z0-9]/g, ''); }

  /* A CHART'S DOB AND AN APPOINTMENT'S DOB ARE NOT THE SAME STRING. Athena
     rows arrive MM/DD/YYYY and charts store YYYY-MM-DD, so comparing raw
     digits ("02111980" vs "19800211") silently refuses every weak link it was
     written to allow. This is the shell's own _opDobKey, which is what the
     op-note resolver already matches appointments to charts with; it is
     preferred at runtime and reimplemented here so the module stays testable
     and boot-order independent. Only a canonical YYYY-MM-DD survives as a key
     - a free-text DOB is not an identity. */
  function localDobKey(v) {
    var s = S(v).trim(); if (!s) return '';
    var m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/);
    if (m) return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
    m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})/);
    if (m) return m[3] + '-' + ('0' + m[1]).slice(-2) + '-' + ('0' + m[2]).slice(-2);
    return s.toLowerCase();
  }
  function dobKey(v) {
    var f = window._opDobKey, out = null;
    if (typeof f === 'function') out = safe(function () { return f(v); }, null);
    if (typeof out !== 'string') out = localDobKey(v);
    return /^\d{4}-\d{2}-\d{2}$/.test(out) ? out : '';
  }

  /* The calendar's own provider key, so a provider grouped here is the same
     provider the calendar filter groups. The shell's copy wins whenever it is
     loaded; this fallback exists so the module is testable and boot-order
     independent, and the suite pins the two against each other. */
  var CRED = ['md', 'do', 'pa', 'pac', 'pa-c', 'np', 'crna', 'aprn', 'dpm', 'dds', 'dmd', 'crnp', 'dr'];
  function localProvKey(v) {
    return S(v).toLowerCase().replace(/[_,.\/]+/g, ' ').replace(/[^a-z' -]/g, ' ')
      .split(/\s+/).filter(function (t) { return t && CRED.indexOf(t) < 0; }).sort().join(' ');
  }
  function provKey(v) {
    var f = window._calProvKey;
    if (typeof f === 'function') { var out = safe(function () { return f(v); }, null); if (typeof out === 'string') return out; }
    return localProvKey(v);
  }

  /* The row's day, by the shell's own rule (_calDateOf). */
  function rowDay(r) { return S(r && (r.appt_date || S(r.start_at).slice(0, 10))).slice(0, 10); }
  /* The row's provider DISPLAY name. provider_key is a normalized key, not a
     name, so it can group a row but can never label one: a row that carries
     only a key is attributed-but-unnameable and is counted as blank. */
  function rowProvider(r) { return S(r && r.provider).trim(); }
  /* The row's patient pointer - the shell's idiom, verbatim. */
  function rowPtId(r) { return S(r && (r.patient_external_id || r._mlsTargetPatientId || r.patientId)); }

  function calRows() {
    return safe(function () { var a = window._calAppts; return Array.isArray(a) ? a : []; }, []);
  }
  function patients() {
    return safe(function () { var g = window.getPatients; return typeof g === 'function' ? (g() || []) : []; }, []);
  }

  /* ---------------------------------------------------------------- derive */

  /* Build id -> patient and the UNAMBIGUOUS name+dob index. A name+dob pair
     claimed by two records is dropped from the index rather than resolved:
     duplicate charts of one person are a known live condition, and the right
     answer to an ambiguous pair is no attribution, not a coin flip. */
  function indexRoster(pts) {
    var byId = Object.create(null), byNameDob = Object.create(null), i, p, k;
    for (i = 0; i < pts.length; i++) {
      p = pts[i]; if (!p || p.id == null) continue;
      byId[String(p.id)] = p;
      var nn = normName(p.name), dd = dobKey(p.dob);
      if (!nn || !dd) continue;
      k = nn + '|' + dd;
      if (byNameDob[k] === undefined) byNameDob[k] = p;
      else byNameDob[k] = null;                 /* ambiguous - claimed by nobody */
    }
    return { byId: byId, byNameDob: byNameDob };
  }

  /* Fold this row-set into per-patient provider evidence. Pure: it reads rows
     and the roster index and returns evidence, touching no record. */
  function collect(rows, idx) {
    var out = Object.create(null);
    var stat = { total: rows.length, attributed: 0, blank: 0, linked: 0, unlinked: 0 };
    var i, r, name, day, p, key, bucket, ent;
    for (i = 0; i < rows.length; i++) {
      r = rows[i]; if (!r) continue;
      name = rowProvider(r);
      if (!name) { stat.blank++; continue; }    /* a blank provider proves nothing */
      stat.attributed++;
      day = rowDay(r);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) { stat.unlinked++; continue; }
      p = null;
      var pid = rowPtId(r);
      if (pid && idx.byId[pid]) p = idx.byId[pid];
      if (!p) {
        var nn = normName(r.name), dd = dobKey(r.dob);
        if (nn && dd) p = idx.byNameDob[nn + '|' + dd] || null;
      }
      if (!p) { stat.unlinked++; continue; }
      key = provKey(name);
      if (!key) { stat.unlinked++; continue; }
      stat.linked++;
      bucket = out[String(p.id)] || (out[String(p.id)] = Object.create(null));
      ent = bucket[key] || (bucket[key] = { name: name.slice(0, NAME_MAX), key: key, days: Object.create(null), newest: '' });
      /* the newest spelling of a name wins, so a later "Matthew Schaeffer, MD"
         replaces an earlier bare "Schaeffer" without changing the key */
      if (day >= ent.newest) { ent.newest = day; ent.name = name.slice(0, NAME_MAX); }
      ent.days[day] = 1;
    }
    return { evidence: out, stat: stat };
  }

  function dayList(map) {
    var out = [], d;
    for (d in map) if (Object.prototype.hasOwnProperty.call(map, d)) out.push(d);
    out.sort(); out.reverse();
    return out;
  }

  /* Merge new evidence for ONE patient over whatever is already stored, then
     rank. Prior day keys are kept, so a derivation run against September does
     not forget August. */
  function buildLink(prior, bucket) {
    var byKey = Object.create(null), k, e, i, j, d, prev;
    prev = (prior && prior.v === 1 && Array.isArray(prior.providersSeen)) ? prior.providersSeen : [];
    for (i = 0; i < prev.length; i++) {
      e = prev[i]; if (!e || !e.key) continue;
      var days = Object.create(null), dl = Array.isArray(e.days) ? e.days : [];
      for (j = 0; j < dl.length; j++) if (/^\d{4}-\d{2}-\d{2}$/.test(S(dl[j]))) days[S(dl[j])] = 1;
      byKey[S(e.key)] = { name: S(e.name).slice(0, NAME_MAX), key: S(e.key), days: days, newest: '' };
    }
    for (k in bucket) {
      if (!Object.prototype.hasOwnProperty.call(bucket, k)) continue;
      e = bucket[k];
      var tgt = byKey[k];
      if (!tgt) tgt = byKey[k] = { name: e.name, key: k, days: Object.create(null), newest: '' };
      for (d in e.days) if (Object.prototype.hasOwnProperty.call(e.days, d)) tgt.days[d] = 1;
      if (S(e.newest) >= S(tgt.newest)) { tgt.newest = S(e.newest); tgt.name = e.name; }
    }
    var seen = [];
    for (k in byKey) {
      if (!Object.prototype.hasOwnProperty.call(byKey, k)) continue;
      var all = dayList(byKey[k].days);
      if (!all.length) continue;
      var kept = all.slice(0, DAYS_MAX);
      var row = { name: byKey[k].name, key: k, count: kept.length, last: kept[0], days: kept };
      if (all.length > DAYS_MAX) row.capped = true;
      seen.push(row);
    }
    if (!seen.length) return null;
    /* most days wins; a tie goes to the most recent; a tie there is broken by
       name so two runs on the same evidence can never disagree */
    seen.sort(function (a, b) {
      return (b.count - a.count) ||
        (a.last < b.last ? 1 : a.last > b.last ? -1 : 0) ||
        (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    });
    seen = seen.slice(0, PROV_MAX);
    return { v: 1, primaryProvider: seen[0].name, primaryProviderKey: seen[0].key, providersSeen: seen };
  }

  function sameLink(a, b) {
    return safe(function () { return JSON.stringify(a || null) === JSON.stringify(b || null); }, false);
  }
  /* the stored shape minus its timestamp - `at` moves on every run and must
     never be the reason a save happens */
  function bodyOf(l) {
    if (!l) return null;
    return { v: l.v, primaryProvider: l.primaryProvider, primaryProviderKey: l.primaryProviderKey, providersSeen: l.providersSeen };
  }

  /* deriveAll: the whole derivation, as a value. It writes nothing. */
  function deriveAll(opts) {
    opts = opts || {};
    var rows = Array.isArray(opts.rows) ? opts.rows : calRows();
    var pts = Array.isArray(opts.patients) ? opts.patients : patients();
    var idx = indexRoster(pts);
    var got = collect(rows, idx);
    var now = Number(opts.now) || Date.now();
    var changed = [], next = Object.create(null), i, p, id, prior, link;
    for (i = 0; i < pts.length; i++) {
      p = pts[i]; if (!p || p.id == null) continue;
      id = String(p.id);
      prior = (p.providerLink && p.providerLink.v === 1) ? p.providerLink : null;
      var bucket = got.evidence[id];
      /* NOTHING NEW AND NOTHING STORED = no field. _calAppts holds only the
         loaded window, so absence of evidence here is not evidence of absence
         and must never delete a prior derivation. */
      if (!bucket && !prior) continue;
      link = buildLink(prior, bucket || Object.create(null));
      if (!link) continue;
      next[id] = link;
      if (!sameLink(bodyOf(prior), bodyOf(link))) changed.push(id);
    }
    return {
      at: now, links: next, changed: changed,
      rows: got.stat, patients: pts.length, providers: rollup(next)
    };
  }

  /* Roster-wide provider list for the filter: distinct providers with how many
     PATIENTS carry them and the most recent day seen. */
  function rollup(links) {
    var by = Object.create(null), id, l, i, e, k;
    for (id in links) {
      if (!Object.prototype.hasOwnProperty.call(links, id)) continue;
      l = links[id]; if (!l || !Array.isArray(l.providersSeen)) continue;
      for (i = 0; i < l.providersSeen.length; i++) {
        e = l.providersSeen[i]; if (!e || !e.key) continue;
        var t = by[e.key] || (by[e.key] = { name: S(e.name), key: S(e.key), patients: 0, last: '' });
        t.patients++;
        if (S(e.last) > t.last) { t.last = S(e.last); t.name = S(e.name); }
      }
    }
    var out = [];
    for (k in by) if (Object.prototype.hasOwnProperty.call(by, k)) out.push(by[k]);
    out.sort(function (a, b) { return (b.patients - a.patients) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0); });
    return out;
  }

  /* ------------------------------------------------------------------- run */

  /* A pull owns the patient store while it runs. Same rule as the auto-merge:
     a stamp written mid-history-batch makes the batch's own proofs miss. */
  function pullBusy() {
    return safe(function () {
      var t = Number(window.__mlsPullBusyAt || 0);
      if (t > 0 && (Date.now() - t) < 90000) return true;
      return typeof window.__mlsPullShieldForeign === 'function' ? !!window.__mlsPullShieldForeign() : false;
    }, false);
  }

  function run(opts) {
    opts = opts || {};
    if (stopped) return { saved: 0, reason: 'stopped' };
    if (pullBusy()) {
      if (!deferT) deferT = setTimeout(function () { deferT = null; safe(function () { run(opts); }); }, 20000);
      return { saved: 0, reason: 'deferred-pull-busy' };
    }
    var getP = window.getPatients, saveP = window.savePatients;
    if (typeof getP !== 'function' || typeof saveP !== 'function') return { saved: 0, reason: 'store-unavailable' };
    var pts = safe(function () { return getP() || []; }, []);
    if (!pts.length) { lastRun = { at: Date.now(), saved: 0, reason: 'empty-roster', rows: null, patients: 0, providers: [] }; return lastRun; }
    var res = deriveAll({ patients: pts, rows: opts.rows });
    if (!res.changed.length) {
      lastRun = { at: res.at, saved: 0, reason: 'no-change', rows: res.rows, patients: res.patients, providers: res.providers };
      return lastRun;
    }
    /* Replace only the rows that changed, with COPIES: the store's delta is a
       reference comparison, so an in-place edit of a shared row object is
       invisible to it and would journal nothing. */
    var dirty = Object.create(null), i, k;
    for (i = 0; i < res.changed.length; i++) dirty[res.changed[i]] = 1;
    var out = new Array(pts.length);
    for (i = 0; i < pts.length; i++) {
      var p = pts[i];
      if (!p || p.id == null || !dirty[String(p.id)]) { out[i] = p; continue; }
      var copy = {};
      for (k in p) if (Object.prototype.hasOwnProperty.call(p, k)) copy[k] = p[k];
      var link = res.links[String(p.id)];
      link.at = res.at;
      copy.providerLink = link;
      out[i] = copy;
    }
    /* The read generation belongs to this exact read; a plain array literal
       would drop it and fall back to the 12-second clock rule. */
    safe(function () {
      var g = pts.__mlsReadGen;
      if (typeof g === 'number') Object.defineProperty(out, '__mlsReadGen', { value: g, configurable: true });
    });
    /* NO allowRemovals: the id set is unchanged, so the row guard has nothing
       to carry, and this save must never be able to drop a chart. */
    var ok = true;
    try { saveP(out, undefined, { dirtyIds: res.changed.slice() }); } catch (eSave) { ok = false; }
    lastRun = {
      at: res.at, saved: ok ? res.changed.length : 0, reason: ok ? 'saved' : 'save-failed',
      rows: res.rows, patients: res.patients, providers: res.providers
    };
    if (ok) {
      safe(function () { window.dispatchEvent(new CustomEvent('mls:provider-link-updated', { detail: { changed: res.changed.length, providers: res.providers.length } })); });
      safe(function () { syncFilterOptions(); });
      repaintList();
    }
    return lastRun;
  }

  function forPatient(id) {
    var want = S(id), pts = patients(), i;
    for (i = 0; i < pts.length; i++) if (pts[i] && String(pts[i].id) === want) {
      var l = pts[i].providerLink;
      return (l && l.v === 1) ? l : null;
    }
    return null;
  }
  function status() {
    return { version: VERSION, installed: true, stopped: stopped, last: lastRun, filter: readFilter(), pullBusy: pullBusy() };
  }

  /* -------------------------------------------------------------------- UI */

  function esc(s) {
    var f = window.esc;
    if (typeof f === 'function') { var o = safe(function () { return f(s); }, null); if (typeof o === 'string') return o; }
    return S(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* The row chip. An unknown provider renders NOTHING - a chip reading "No
     provider" on 1400 rows would be noise, and the honest empty is the absence
     of the chip. The Patients list caches on the joined row HTML, so a chip
     that appears or changes moves that signature by construction. */
  function chip(p) {
    var l = p && p.providerLink;
    if (!l || l.v !== 1 || !S(l.primaryProvider).trim()) return '';
    var seen = Array.isArray(l.providersSeen) ? l.providersSeen : [];
    var top = seen[0] || null;
    var days = top ? Number(top.count || 0) : 0;
    var tip = S(l.primaryProvider) +
      (days ? (' - ' + days + (top && top.capped ? '+' : '') + ' visit day' + (days === 1 ? '' : 's') + ' recorded') : '') +
      (seen.length > 1 ? (' - also ' + seen.slice(1).map(function (e) { return S(e.name); }).join(', ')) : '') +
      ' - derived from attributed appointments';
    return '<span class="mls-plv-chip" data-mls-plv-key="' + esc(l.primaryProviderKey) + '" title="' + esc(tip) + '"' +
      ' style="font-size:11px;color:#204034;background:#EAF1EC;border:1px solid #cfe0d6;border-radius:999px;padding:2px 9px;font-weight:700;white-space:nowrap">' +
      '🩺 ' + esc(l.primaryProvider) + (seen.length > 1 ? (' +' + (seen.length - 1)) : '') + '</span>';
  }

  function readFilter() { return safe(function () { return localStorage.getItem(FILTER_KEY) || ''; }, ''); }
  function writeFilter(v) { safe(function () { if (v) localStorage.setItem(FILTER_KEY, v); else localStorage.removeItem(FILTER_KEY); }); }

  function matches(p, val) {
    if (!val) return true;
    var l = p && p.providerLink;
    var has = !!(l && l.v === 1 && Array.isArray(l.providersSeen) && l.providersSeen.length);
    if (val === NONE) return !has;
    if (!has) return false;
    for (var i = 0; i < l.providersSeen.length; i++) if (S(l.providersSeen[i].key) === val) return true;
    return false;
  }

  /* renderPatients hands this the ranked roster rows BEFORE its 150-row cap,
     so the filter is roster-wide and the count it prints is the real one. */
  function filterRows(rows) {
    var val = readFilter();
    if (!val || !Array.isArray(rows)) return rows;
    return rows.filter(function (r) { return matches(r && r.patient, val); });
  }

  function selectEl() { return safe(function () { return document.getElementById('mlsPlvSel'); }, null); }

  /* renderPatients keeps a memo (list._mlsRoster / list._mlsSig) that returns
     EARLY when the roster object, query, sort and group mode are all
     unchanged - and arming this filter changes none of them, so the repaint
     would be a no-op and the doctor would see the filter do nothing. Clearing
     the memo is what turns a filter change into an actual repaint.
     After a DERIVATION the memo is left alone on purpose: the save advanced
     the store generation, so __mlsPtRosterData already returns a fresh roster
     and the memo misses by itself. Clearing it there would only force extra
     work on a Patients view nobody is looking at. */
  function repaintList(clearMemo) {
    if (clearMemo) {
      safe(function () {
        var list = document.getElementById('ptList');
        if (list) { list._mlsRoster = null; list._mlsNotesVer = null; list._mlsSig = ''; }
      });
    }
    safe(function () { if (typeof window.renderPatients === 'function') window.renderPatients(); });
  }

  function mountFilter() {
    return safe(function () {
      if (document.getElementById('mlsPlvSel')) { syncFilterOptions(); return true; }
      var row = document.getElementById('ptSearchRow');
      if (!row) return false;
      var sel = document.createElement('select');
      sel.id = 'mlsPlvSel';
      sel.setAttribute('aria-label', 'Filter patients by provider');
      sel.title = 'Show only patients whose appointments were attributed to one provider';
      sel.style.cssText = 'min-width:170px;border:1px solid var(--line);border-radius:10px;background:#fff;padding:9px 10px;color:var(--ink);font:inherit';
      sel.onchange = function () {
        writeFilter(sel.value);
        repaintList(true);   /* nothing in the store changed - clear the memo */
      };
      var anchor = document.getElementById('ptSort');
      if (anchor && anchor.parentNode === row) row.insertBefore(sel, anchor.nextSibling);
      else row.appendChild(sel);
      syncFilterOptions();
      return true;
    }, false);
  }

  function syncFilterOptions() {
    safe(function () {
      var sel = selectEl(); if (!sel) return;
      var pts = patients(), links = Object.create(null), i, none = 0;
      for (i = 0; i < pts.length; i++) {
        var p = pts[i]; if (!p || p.id == null) continue;
        var l = p.providerLink;
        if (l && l.v === 1 && Array.isArray(l.providersSeen) && l.providersSeen.length) links[String(p.id)] = l;
        else none++;
      }
      var provs = rollup(links);
      var want = provs.map(function (e) { return e.key + '|' + e.name + '|' + e.patients; }).join('~') + '#' + none;
      if (sel._mlsPlvSig === want) return;
      var cur = readFilter();
      var html = '<option value="">All providers</option>';
      for (i = 0; i < provs.length; i++) {
        html += '<option value="' + esc(provs[i].key) + '">' + esc(provs[i].name) + ' (' + provs[i].patients + ')</option>';
      }
      if (none) html += '<option value="' + esc(NONE) + '">No provider recorded (' + none + ')</option>';
      sel.innerHTML = html;
      /* an armed provider that no longer exists must disarm, not silently
         filter the list down to nothing */
      var ok = !cur;
      for (i = 0; i < sel.options.length; i++) if (sel.options[i].value === cur) ok = true;
      if (!ok) { cur = ''; writeFilter(''); }
      sel.value = cur;
      sel._mlsPlvSig = want;
      /* nothing derived yet = nothing to filter by; the control stays out of
         the way rather than offering one empty choice */
      sel.style.display = provs.length ? '' : 'none';
    });
  }

  /* -------------------------------------------------------------- lifecycle */

  function boot() {
    /* One second behind the auto-merge's post-pull sweep so a derivation lands
       on the merge SURVIVOR, never on a record that is about to be absorbed. */
    bootT = setTimeout(function () {
      bootT = null;
      safe(function () { mountFilter(); });
      safe(function () { run({}); });
    }, 14000);
    jobHandler = function (ev) {
      var j = ev && ev.detail;
      if (!j || j.kind !== 'schedule_pull') return;
      if (j.status === 'completed' || j.status === 'partial') setTimeout(function () { safe(function () { mountFilter(); run({}); }); }, 5000);
    };
    safe(function () { window.addEventListener('mls:job-progress', jobHandler, false); });
    /* upsertPatient replaces a record wholesale (arr[i]=p), so the shell
       carries providerLink forward for a caller holding a stale copy. This
       listener only re-labels the filter; it never saves, so it can never
       loop with the derivation (which writes through savePatients and
       dispatches no record-updated event of its own). */
    updHandler = function () { safe(function () { syncFilterOptions(); }); };
    safe(function () { window.addEventListener('mls:patient-record-updated', updHandler, false); });
    calHandler = function () { safe(function () { mountFilter(); }); };
    safe(function () { window.addEventListener('mls:calendar-hydrated', calHandler, false); });
  }

  window.__mlsProviderLink = {
    installed: true, version: VERSION,
    deriveAll: deriveAll, forPatient: forPatient, status: status, run: run,
    rollup: rollup, provKey: provKey, matches: matches, chip: chip,
    mountFilter: mountFilter, syncFilterOptions: syncFilterOptions
  };
  /* the two hooks the Patients view calls - installed as globals so each side
     of the shell stays a single optional call */
  window.__mlsPlvChip = chip;
  window.__mlsPlvFilter = filterRows;

  window.__mlsProviderLink_revert = function () {
    stopped = true;
    if (bootT) { safe(function () { clearTimeout(bootT); }); bootT = null; }
    if (deferT) { safe(function () { clearTimeout(deferT); }); deferT = null; }
    if (jobHandler) safe(function () { window.removeEventListener('mls:job-progress', jobHandler, false); });
    if (updHandler) safe(function () { window.removeEventListener('mls:patient-record-updated', updHandler, false); });
    if (calHandler) safe(function () { window.removeEventListener('mls:calendar-hydrated', calHandler, false); });
    safe(function () { var s = selectEl(); if (s && s.parentNode) s.parentNode.removeChild(s); });
    safe(function () { delete window.__mlsPlvChip; delete window.__mlsPlvFilter; delete window.__mlsProviderLink; });
  };
  boot();
})();
