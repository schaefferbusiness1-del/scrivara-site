/* =====================================================================
 * feat_athena_narration.js  ->  window.__mlsAthenaNarration  (v1.0.0)
 * ---------------------------------------------------------------------
 * Screen-aware, plain-language narration for what MLS Assist ACTUALLY
 * observed and did on the athenaOne screen — driven ONLY by the real
 * data the extension/app already returns, never by guesses.
 *
 * WHY THIS EXISTS
 *   The Athena flows already work, but the live status was thin ("Reading
 *   your visits…"). Michael asked for narration that genuinely understands
 *   the screen: "Saw 3 providers on the schedule — selected Dr. Schaeffer",
 *   "Found 24 patients on today's schedule; loading them…", "Read 5 real
 *   visits from the chart and saved them." This layer composes those
 *   sentences from the REAL event stream and routes them through the ONE
 *   existing status surface (the §61 .mlsaa-tl timeline + §66 ux-unify
 *   mirror) — it does NOT create a competing surface.
 *
 * THE NON-NEGOTIABLE HONESTY RULES (audit §39/§40/§50, Verification Protocol)
 *   1. A NUMBER is shown ONLY when it was extracted from a real RESULT
 *      payload (a PHI-safe array length / resultMeta count). Progress
 *      events ("mlsAppVisitsProgress" etc.) carry an OPTIMISTIC, pre-
 *      enumerated "N of M" that the §50 counter-guard already proved is
 *      NOT backed by real reads — so this module NEVER derives a count
 *      from progress text. During a read it shows a count-FREE line; the
 *      real number appears only after the real result lands.
 *   2. Every emitted number is cross-checked against window.__mlsConnTruth
 *      (the single source of truth). If athenaOne is disconnected, NO count
 *      is shown — only the honest "not connected" line. A count can never
 *      appear while logged out (the exact §40/§50 burn).
 *   3. The internal evidence ledger records, for every narrated number,
 *      the event type + field + value + the live connection verdict at
 *      emit time. A number that cannot be traced to a real event field is
 *      suppressed. This is the __mlsFabricationSentinel cross-check, reused.
 *   4. On any failure (ok:false / no chart / no appts) it surfaces the
 *      honest reason and shows NOTHING fabricated — "couldn't read X".
 *
 * PHI SAFETY
 *   Reads ONLY booleans, array LENGTHS, event types, and provider
 *   (clinician) names — which are not patient PHI and already appear on
 *   the user's own schedule. It NEVER reads, stores, or logs resp.text /
 *   resp.url / resp.title / identity.name / any patient text. The on-screen
 *   patient reference is generic ("the chart you have open in athenaOne",
 *   "this patient"), so our own strings carry no PHI. The ledger and any
 *   console output are PHI-free by construction.
 *
 * SHAPE
 *   Additive, own-scope IIFE. Read-only: it installs a single passive
 *   window 'message' listener and NEVER posts anything to the extension,
 *   never clicks Save/Sign/attest, never writes a chart. Idempotent boot.
 *   Fully reversible via window.__mlsAthenaNarration.revert(). Worst case
 *   (any error) it no-ops and the page is byte-identical to not loading it.
 *
 * PUBLIC API (window.__mlsAthenaNarration)
 *   .installed / .version
 *   .ledger          -> PHI-free ring buffer of {evType,field,value,conn,ts}
 *   .lastLine        -> the last narration string emitted (may name a
 *                       provider; never a patient)
 *   .onNarrate(fn)   -> subscribe to narration lines; returns unsubscribe
 *   ._composeSchedule(resp) / ._composeVisitsResult(resp) / ._composeProgress(d)
 *                    -> pure, testable composers (return {text,state,count}
 *                       or null when there is nothing real to say)
 *   ._backed(n,evType,field) -> the guard: true only if n is real-backed
 *   .scan()          -> no-op hook for parity with sibling assets
 *   .revert()        -> remove listener/subscription/panel; installed=false
 * ===================================================================== */
(function () {
  'use strict';

  var NS = '__mlsAthenaNarration';
  var VERSION = '1.0.0';

  if (typeof window !== 'undefined' && window[NS] && window[NS].installed) {
    return;
  }
  var win = (typeof window !== 'undefined') ? window : this;
  var doc = (typeof document !== 'undefined') ? document : null;

  // ---- tiny helpers -------------------------------------------------------
  function isFn(f) { return typeof f === 'function'; }
  function g(name) { try { return win[name]; } catch (e) { return null; } }
  function S(x) { return (x == null) ? '' : String(x); }
  function esc(s) {
    return S(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function safe(fn) { try { return fn(); } catch (e) { return undefined; } }

  // ---- state --------------------------------------------------------------
  var ledger = [];            // PHI-free evidence ring buffer (most recent last)
  var LEDGER_MAX = 60;
  var subs = [];              // narration subscribers
  var lastLine = '';
  var lastLineKey = '';       // for de-dupe
  var messageHandler = null;
  var connUnsub = null;
  var ownPanel = null;        // fallback surface (only if §61/§66 absent)
  var lastConnStatus = null;  // for honest disconnected transitions

  // ===================================================================== //
  //  CONNECTION TRUTH cross-check (single source of truth, §2B)           //
  // ===================================================================== //
  function connState() {
    var ct = g('__mlsConnTruth');
    if (!ct) return null;
    var st = ct.state || (ct.installed && ct.state);
    return st || null;
  }
  // Disconnected = anything that is NOT a genuine 'connected'. 'checking' is
  // treated as not-yet-known: we do not assert a count under 'checking' either.
  function isConnectedTruth() {
    var ct = g('__mlsConnTruth');
    if (ct && isFn(ct.isConnected)) { return !!safe(function () { return ct.isConnected(); }); }
    var st = connState();
    return !!(st && st.status === 'connected');
  }
  function connStatusStr() {
    var st = connState();
    return st ? S(st.status) : 'unknown';
  }
  function honestDisconnectLine() {
    var ct = g('__mlsConnTruth');
    var st = connState();
    var reason = (st && st.reason) || '';
    if (ct && isFn(ct.describe) && st) {
      var d = safe(function () { return ct.describe(st); });
      if (d && d.label) {
        if (st.status === 'no-extension') return 'MLS Assist isn’t responding — the extension may be off. ' + (reason || 'Open athenaOne in a signed-in tab and reload.');
        if (st.status === 'no-tab') return 'athenaOne not connected — open a signed-in athenaOne tab, then try again.';
        return S(d.label) + (reason ? ' — ' + reason : '');
      }
    }
    if (st && st.status === 'no-extension') return 'MLS Assist isn’t responding — open athenaOne in a signed-in tab and reload.';
    if (st && st.status === 'no-tab') return 'athenaOne not connected — open a signed-in athenaOne tab, then try again.';
    return 'athenaOne not connected — open a signed-in athenaOne tab.';
  }

  // ===================================================================== //
  //  THE GUARD — a number may be narrated ONLY if it is real-backed.      //
  //  Reused __mlsFabricationSentinel philosophy: cite event+field+conn.   //
  // ===================================================================== //
  function recordEvidence(evType, field, value) {
    var rec = { evType: S(evType), field: S(field), value: (typeof value === 'number' ? value : null), conn: connStatusStr(), ts: Date.now() };
    ledger.push(rec);
    if (ledger.length > LEDGER_MAX) ledger.shift();
    // Optional: let a present fabrication-sentinel observe (PHI-free, no dependency).
    var fs = g('__mlsFabricationSentinel');
    if (fs && isFn(fs.onFinding)) { /* sentinel scans the DOM independently; nothing to push */ }
    return rec;
  }
  // A count is "backed" iff it is a finite number that we extracted from a real
  // RESULT field (caller passes that provenance) AND connection-truth is not in
  // a hard-disconnected state. Under disconnected/checking we refuse to show it.
  function _backed(n, evType, field) {
    if (typeof n !== 'number' || !isFinite(n)) return false;
    recordEvidence(evType, field, n);
    // contradiction guard: a count while the truth says disconnected is the
    // §40/§50 fabrication signature -> suppress.
    var stt = connStatusStr();
    if (stt === 'no-extension' || stt === 'no-tab' || stt === 'error') return false;
    // 'checking'/'unknown' with no conn-truth present: allow ONLY because the
    // result itself is proof the channel answered (caller only passes real
    // result-derived numbers here). If conn-truth IS present and not connected,
    // the branch above already returned false.
    return true;
  }

  // ===================================================================== //
  //  PHI-safe count extraction (mirrors §59 resultMeta — ok + length only) //
  // ===================================================================== //
  function resultMeta(d) {
    var dr = g('__mlsAthenaDoctor');
    if (dr && isFn(dr.resultMeta)) {
      var m = safe(function () { return dr.resultMeta(d); });
      if (m) return m;
    }
    // local fallback, identical PHI-safe logic: read ok + array LENGTH only
    var r = (d && (d.resp || d)) || {};
    var ok = (typeof r.ok === 'boolean') ? r.ok : (d && typeof d.ok === 'boolean' ? d.ok : null);
    var count = null;
    if (Array.isArray(r.visits)) count = r.visits.length;
    else if (Array.isArray(r.results)) count = r.results.length;
    else if (Array.isArray(r.rows)) count = r.rows.length;
    else if (typeof r.count === 'number') count = r.count;
    return { ok: ok, count: count, stage: r.stage || null, raw: r };
  }

  // distinct providers (clinician names = not patient PHI), PHI-safe
  function providersOf(resp) {
    var r = (resp && (resp.resp || resp)) || {};
    var provs = Array.isArray(r.providers) ? r.providers.filter(Boolean).map(S) : [];
    if (!provs.length && Array.isArray(r.appts)) {
      var seen = {}, out = [];
      r.appts.forEach(function (a) {
        var p = a && a.provider ? S(a.provider).trim() : '';
        if (p && !seen[p.toLowerCase()]) { seen[p.toLowerCase()] = 1; out.push(p); }
      });
      provs = out;
    }
    return provs;
  }
  function apptCountOf(resp) {
    var r = (resp && (resp.resp || resp)) || {};
    if (Array.isArray(r.appts)) return r.appts.length;
    var m = resultMeta(resp);
    return (typeof m.count === 'number') ? m.count : null;
  }
  function pickedProviderLabel(providers) {
    var pp = g('__mlsProviderPicker');
    var pick = (pp && isFn(pp.getPick)) ? safe(function () { return pp.getPick(); }) : null;
    if (!pick || pick === 'mine') {
      var ps = g('__mlsAthenaProviderScope');
      var me = (ps && isFn(ps.detectProvider)) ? safe(function () { return ps.detectProvider(); }) : null;
      return me ? ('Dr. ' + lastName(me)) : 'your patients';
    }
    if (pick === 'all') return 'all doctors';
    return S(pick);
  }
  function lastName(full) {
    var t = S(full).replace(/,/g, ' ').trim().split(/\s+/).filter(Boolean);
    if (!t.length) return S(full);
    // "Michael Schaeffer" -> Schaeffer ; "Schaeffer, Michael" handled by comma-strip above
    return t[t.length - 1];
  }
  function shortProviders(list) {
    // honest, compact, PHI-free join of clinician names already on screen
    return list.map(function (p) { return S(p); }).join(', ');
  }

  // ===================================================================== //
  //  COMPOSERS — pure, testable. Return {text,state,count} or null.       //
  //  state in {run,note,warn,fail,ok} to match §61 _step.                 //
  // ===================================================================== //

  // schedule result -> "Saw N providers… / Found M patients on the schedule…"
  function composeSchedule(d) {
    var meta = resultMeta(d);
    var ok = meta.ok;
    var n = apptCountOf(d);
    var provs = providersOf(d);

    // honest failure / empty: NO count.
    if (ok === false) {
      return { text: 'Couldn’t read the schedule — ' + (honestReason(d) || 'nothing was loaded. Open athenaOne’s day schedule, then pull again.'), state: 'warn', count: null };
    }
    if (n === 0) {
      return { text: 'Read the schedule page but found no appointments — open athenaOne’s DAY schedule grid, then pull again.', state: 'warn', count: null };
    }

    var parts = [];
    // providers first (clinician names are not patient PHI)
    if (provs.length && _backed(provs.length, 'mlsAppScheduleResult', 'providers.length')) {
      var who = pickedProviderLabel(provs);
      if (provs.length === 1) {
        parts.push('Saw 1 provider on the schedule — ' + esc(shortProviders(provs)) + '.');
      } else {
        parts.push('Saw ' + provs.length + ' providers on the schedule — ' + esc(shortProviders(provs)) + ' — using ' + esc(who) + '.');
      }
    }
    // patient count from REAL appts length
    if (typeof n === 'number' && _backed(n, 'mlsAppScheduleResult', 'appts.length')) {
      parts.push('Found ' + n + ' patient' + (n === 1 ? '' : 's') + ' on the schedule; loading them onto the calendar.');
      return { text: parts.join(' '), state: 'run', count: n };
    }
    // we had providers but no trustworthy patient count
    if (parts.length) return { text: parts.join(' '), state: 'run', count: null };

    // ok:true but no structured appts/providers (e.g. pre-v1.37 extension)
    return { text: 'Read the schedule, but athenaOne didn’t return per-appointment details on this view.', state: 'note', count: null };
  }

  // all-visits result -> the ONLY honest per-patient visit count
  function composeVisitsResult(d) {
    var meta = resultMeta(d);
    var ok = meta.ok;
    var n = meta.count;
    if (ok === false) {
      return { text: 'Couldn’t read this chart — ' + (honestReason(d) || 'nothing was saved.'), state: 'fail', count: null };
    }
    if (typeof n === 'number' && n === 0) {
      return { text: 'athenaOne returned no past visits for this patient — nothing was added.', state: 'warn', count: 0 };
    }
    if (typeof n === 'number' && _backed(n, 'mlsAppAllVisitsResult', 'visits.length')) {
      return { text: 'Read ' + n + ' real visit' + (n === 1 ? '' : 's') + ' from the chart and saved ' + (n === 1 ? 'it' : 'them') + ' into MLS.', state: 'ok', count: n };
    }
    // ok:true but no array we can count honestly
    if (ok === true) return { text: 'Finished reading the chart and saved what athenaOne returned.', state: 'ok', count: null };
    return null;
  }

  // search-open result -> opened / no match (no fabricated count)
  function composeSearchResult(d) {
    var meta = resultMeta(d);
    var ok = meta.ok;
    if (ok === true) return { text: 'Opened the patient’s chart in athenaOne.', state: 'ok', count: null };
    if (ok === false) return { text: 'athenaOne found no patient matching that name — nothing was opened.', state: 'warn', count: null };
    return null;
  }

  // chart result (single open chart) -> identity/visits, count only if real array
  function composeChartResult(d) {
    var meta = resultMeta(d);
    var ok = meta.ok;
    var n = meta.count;
    if (ok === false) return { text: 'Couldn’t read the open chart — ' + (honestReason(d) || 'nothing was added.'), state: 'fail', count: null };
    if (typeof n === 'number' && _backed(n, 'mlsAppChartResult', 'visits.length')) {
      if (n === 0) return { text: 'Read the open chart — athenaOne returned no past visits, so nothing was added.', state: 'warn', count: 0 };
      return { text: 'Read the open chart and saved ' + n + ' visit' + (n === 1 ? '' : 's') + ' into MLS.', state: 'ok', count: n };
    }
    if (ok === true) return { text: 'Read the open chart in athenaOne.', state: 'ok', count: null };
    return null;
  }

  // progress -> ALWAYS count-free (the §50 fabricated-counter lesson).
  // A numbered per-visit line is emitted ONLY if a progress event carries a
  // genuinely content-bearing visit object (realContent) AND we are connected.
  function composeProgress(d) {
    var ty = S(d && d.type);
    var content = realVisitContent(d);
    if (content && isConnectedTruth() && typeof d.index === 'number' && typeof d.total === 'number'
        && _backed(d.index, ty, 'index(content-backed)')) {
      // future-proof: only fires if the extension ever streams real content per visit
      return { text: 'Read visit ' + d.index + ' of ' + d.total + ' from the chart…', state: 'run', count: d.index };
    }
    if (/Schedule/.test(ty)) return { text: 'Reading today’s schedule open in athenaOne…', state: 'run', count: null };
    if (/Search/.test(ty)) return { text: 'Asking athenaOne to find that patient…', state: 'run', count: null };
    if (/Visits|Chart|Read|Pull/.test(ty)) return { text: 'Reading the chart you have open in athenaOne (name, DOB and past visits)…', state: 'run', count: null };
    return { text: 'Working with athenaOne…', state: 'run', count: null };
  }

  // realContent test mirrors §48 realContent(v): a streamed visit only counts as
  // real if it carries actual clinical fields — NOT a bare enumerated index.
  function realVisitContent(d) {
    var v = d && (d.visit || d.detail);
    if (!v || typeof v !== 'object') return false;
    return !!(v.raw || (Array.isArray(v.cpt) && v.cpt.length) || (Array.isArray(v.icd10) && v.icd10.length) || v.meds || v.findings || v.plan);
  }

  function honestReason(d) {
    var r = (d && (d.resp || d)) || {};
    var s = r.reason || r.error || r.code || (r.resp && (r.resp.reason || r.resp.error));
    if (typeof s !== 'string') return '';
    s = s.replace(/\s+/g, ' ').trim();
    if (s.length > 80) s = s.slice(0, 80) + '…';
    return s;
  }

  // ===================================================================== //
  //  OUTPUT — route through the ONE existing surface (§61 + §66).         //
  // ===================================================================== //
  function timelineVisible() {
    if (!doc) return false;
    var tl = doc.querySelector('.mlsaa-tl');
    return !!(tl && !tl.hasAttribute('hidden'));
  }
  function emit(line) {
    if (!line || !line.text) return;
    var key = line.state + '|' + line.text;
    if (key === lastLineKey) return; // de-dupe identical consecutive lines
    lastLineKey = key;
    lastLine = line.text;

    // 1) primary channel: §66 unified mirror (single deduped status line).
    var ux = g('__mlsUxUnify');
    var routed = false;
    if (ux && isFn(ux.mirror)) { safe(function () { ux.mirror(line.text); }); routed = true; }

    // 2) when an Athena action timeline is already open, append a rich step too.
    var aa = g('__mlsAthenaActions');
    if (aa && isFn(aa._step) && timelineVisible()) {
      safe(function () { aa._step(line.text, line.state || 'run'); });
      routed = true;
    }

    // 3) fallback ONLY if neither surface exists — never a competing 2nd panel
    //    when §61/§66 are present.
    if (!routed) renderOwnPanel(line.text);

    // notify subscribers (PHI-free: provider names only, never patient text)
    for (var i = 0; i < subs.length; i++) { try { subs[i](line.text, line.state, line.count); } catch (e) {} }
  }

  function renderOwnPanel(text) {
    if (!doc || !doc.body) return;
    if (!ownPanel) {
      ownPanel = doc.createElement('div');
      ownPanel.setAttribute('data-mls-asset-ui', 'feat_athena_narration.js');
      ownPanel.style.cssText = 'position:fixed;left:16px;bottom:16px;max-width:360px;z-index:2147483000;' +
        'background:#1E2B24;color:#eaf2fb;font:13px/1.45 system-ui,Segoe UI,Arial,sans-serif;' +
        'padding:10px 12px;border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.28);';
      ownPanel.innerHTML = '<div style="font-weight:600;margin-bottom:4px;opacity:.85;">MLS · Athena narration</div><div class="mlsnar-line"></div>';
      doc.body.appendChild(ownPanel);
    }
    var slot = ownPanel.querySelector('.mlsnar-line');
    if (slot) slot.innerHTML = esc(text);
  }

  // ===================================================================== //
  //  THE READ-ONLY EVENT LISTENER (posts NOTHING to the extension).       //
  // ===================================================================== //
  function onMessage(ev) {
    var d = ev && ev.data;
    if (!d || typeof d !== 'object') return;
    if (d.source && d.source !== 'mls-ext') return; // extension-origin only
    var ty = S(d.type);
    if (!ty) return;
    var line = null;
    if (ty === 'mlsAppScheduleResult') line = composeSchedule(d);
    else if (ty === 'mlsAppAllVisitsResult') line = composeVisitsResult(d);
    else if (ty === 'mlsAppSearchOpenResult' || ty === 'mlsAppSearchResult') line = composeSearchResult(d);
    else if (ty === 'mlsAppChartResult') line = composeChartResult(d);
    else if (/Progress$/.test(ty)) line = composeProgress(d);
    else return; // ignore unrelated traffic
    if (line) emit(line);
  }

  // ===================================================================== //
  //  HONEST DISCONNECTED transitions (subscribe to conn-truth).           //
  // ===================================================================== //
  function onConnChange(st) {
    var status = st ? S(st.status) : 'unknown';
    if (status === lastConnStatus) return;
    var prev = lastConnStatus;
    lastConnStatus = status;
    // Only narrate a disconnect transition (don't spam on first 'checking').
    if ((status === 'no-extension' || status === 'no-tab' || status === 'error') && prev && prev !== status) {
      emit({ text: honestDisconnectLine(), state: 'warn', count: null });
    }
  }

  // ===================================================================== //
  //  BOOT / REVERT                                                        //
  // ===================================================================== //
  function boot() {
    messageHandler = onMessage;
    win.addEventListener('message', messageHandler, false);
    var ct = g('__mlsConnTruth');
    if (ct && isFn(ct.subscribe)) {
      connUnsub = safe(function () { return ct.subscribe(onConnChange); });
      lastConnStatus = connStatusStr();
    }
  }

  function revert() {
    safe(function () { if (messageHandler) win.removeEventListener('message', messageHandler, false); });
    messageHandler = null;
    safe(function () { if (isFn(connUnsub)) connUnsub(); });
    connUnsub = null;
    if (ownPanel && ownPanel.parentNode) { safe(function () { ownPanel.parentNode.removeChild(ownPanel); }); }
    ownPanel = null;
    subs = [];
    ledger = [];
    if (win[NS]) win[NS].installed = false;
  }

  // ---- public API ---------------------------------------------------------
  win[NS] = {
    installed: true,
    version: VERSION,
    asset: 'feat_athena_narration.js',
    get ledger() { return ledger.slice(); },
    get lastLine() { return lastLine; },
    onNarrate: function (fn) {
      if (!isFn(fn)) return function () {};
      subs.push(fn);
      return function () { var i = subs.indexOf(fn); if (i >= 0) subs.splice(i, 1); };
    },
    // expose pure composers + guard for tests and reuse
    _composeSchedule: composeSchedule,
    _composeVisitsResult: composeVisitsResult,
    _composeSearchResult: composeSearchResult,
    _composeChartResult: composeChartResult,
    _composeProgress: composeProgress,
    _backed: _backed,
    _resultMeta: resultMeta,
    _honestDisconnectLine: honestDisconnectLine,
    _emit: emit,
    _onMessage: onMessage,
    _onConnChange: onConnChange,
    scan: function () { return ledger.slice(); },
    revert: revert
  };

  // attach the listener immediately so a result can never arrive before we
  // are listening (independent of DOM readiness).
  try { boot(); } catch (e) { /* worst case: no-op, page unchanged */ }
})();
