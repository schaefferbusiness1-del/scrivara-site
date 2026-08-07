/* ============================================================================
 * feat_mls_copilot_power.js -> window.__mlsCopilotPower (cpw-1.0.0)
 * ---------------------------------------------------------------------------
 * The Copilot's app-wide senses and hands.
 *
 * SENSES — wraps copilotSnapshot() (after unify's wrapper) to append:
 *   - providerCoverage: the VERIFIED athenaOne roster (never guessed names),
 *     per-provider local-data counts, which providers have no local data, and
 *     the last pull outcome — so the model can say "I don't have Dr. X's data —
 *     want me to pull it?" instead of silently answering from a partial panel.
 *   - capabilities: the action kinds the app will actually execute, so the
 *     model never proposes what the app cannot do.
 *
 * WIRE BOUND — a fetch wrapper on /api/copilot enforces an ABSOLUTE body cap
 * with a deterministic shrink ladder RE-MEASURED after every rung (clamp fields
 * first, then shed rows; the active patient/visit shed last). A relative
 * "smaller than before" guard cannot enforce a ceiling; only measuring the
 * final artifact can. This keeps a 1,500-patient snapshot from hitting the
 * backend's 1MB 413 or being blind-sliced.
 *
 * HANDS — executors for the agentic action kinds the backend can propose:
 *   - pullProviders: the model OFFERS ("Pull the 2 missing providers"); the
 *     user's tap on that offer IS the confirmation. Providers resolve through
 *     window.__mlsProviderRoster.resolve() (fail-closed on ambiguity, never a
 *     display-string guess), then run SEQUENTIALLY through the one canonical
 *     engine window.__mlsSI.dayPull() with every existing gate intact. Honest
 *     per-provider receipts (created/repaired/failed/reason) are posted into
 *     the conversation; refusals are reported in the engine's own words.
 *   - draftNote: resolves the exact patient (same fail-closed resolver the
 *     actions module uses), selects the chart canonically, and opens the
 *     op-note drafting flow via window.openOpPrepForPatient(id). It never
 *     auto-generates or writes anything.
 *
 * HARD SAFETY: no path to any Athena write/sign/save function; the only
 * side effects are the app's own pull engine (read-side) and local navigation.
 * No new timers or observers; lifecycle events only. Idempotent, reversible:
 * window.__mlsCopilotPower.revert().
 * ==========================================================================*/
(function () {
  'use strict';
  try { if (window.__mlsCopilotPower && window.__mlsCopilotPower.installed) return; } catch (e) { return; }
  if (window.__MLS_PUBLIC_PREVIEW && window.__MLS_PUBLIC_PREVIEW.enabled === true) {
    window.__mlsCopilotPower = { installed: false, skipped: 'public-synthetic-preview', version: 'cpw-1.0.0' };
    return;
  }

  var VERSION = 'cpw-1.3.0';
  var ASSET = 'feat_mls_copilot_power.js';
  var WIRE_CAP = 120000; /* absolute cap on the /api/copilot request body (chars).
                            The server bounds context to 100K; anything larger is
                            waste that risks the 1MB body 413. */

  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }
  function isFn(f) { return typeof f === 'function'; }
  function isObj(v) { return v !== null && typeof v === 'object'; }
  function toast(m) { safe(function () { if (isFn(window.toast)) window.toast(m, ''); }); }

  /* ---------------- conversation reporting (honest receipts) --------------- */
  function say(text) {
    var t = String(text || '').trim();
    if (!t) return;
    var posted = safe(function () {
      var store = window.__mlsCopilotConvo;
      // The canonical store's signature is append(role, text, extra) — an
      // object-shaped call coerces to an EMPTY bubble (cpw-1.1.0 fix; the
      // receipts channel IS this feature). Verify the text truly landed.
      if (store && isFn(store.append)) {
        var m = store.append('ai', t, { requestId: 'cpw-' + Math.random().toString(36).slice(2) });
        return !!(m && m.text === t);
      }
      return false;
    }, false);
    if (!posted) {
      posted = safe(function () {
        if (Array.isArray(window._copilotHistory)) {
          window._copilotHistory.push({ role: 'ai', text: t });
          if (isFn(window._copilotRenderThread)) window._copilotRenderThread();
          return true;
        }
        return false;
      }, false);
    }
    if (!posted) toast(t);
  }

  /* ---------------- SENSES: providerCoverage + capabilities ---------------- */
  function normKey(s) { return String(s || '').trim().toLowerCase().replace(/\s+/g, ' '); }

  function providerCoverage() {
    var roster = window.__mlsProviderRoster;
    var entries = safe(function () { return (roster && isFn(roster.list)) ? (roster.list() || []) : []; }, []) || [];
    var receipt = safe(function () { return (roster && isFn(roster.getReceipt)) ? roster.getReceipt() : null; }, null);
    var appts = safe(function () { return Array.isArray(window._calAppts) ? window._calAppts : []; }, []) || [];

    /* cpw-1.1.0: local-data counts come from the SAME per-provider stats the
       Copilot's providerStats injection computes (appointment attribution +
       charts actually pulled into MLS). The 1.0.0 source — a patient.provider
       field — has NO writer anywhere in the app, so it reported the whole
       roster as "no local data": a false coverage claim, the exact lie this
       module exists to end. */
    var statProviders = safe(function () {
      var d = window.__mlsCopilotData;
      if (!d) return null;
      var stats = isFn(d.computeStats) ? d.computeStats() : d.lastStats;
      return stats && Array.isArray(stats.providers) ? stats.providers : null;
    }, null);
    var byName = {}, i;
    if (statProviders) {
      for (i = 0; i < statProviders.length; i++) {
        var s = statProviders[i]; if (!s || !s.provider) continue;
        byName[normKey(s.provider)] = { appts: Number(s.totalAppointments) || 0, pulled: Number(s.patientsWithPulledCharts) || 0 };
      }
    }
    var apptCounts = {};
    for (i = 0; i < appts.length && i < 6000; i++) {
      var ap = appts[i]; if (!ap) continue;
      var pk = normKey(ap.provider && ap.provider.name ? ap.provider.name : ap.provider);
      if (pk) apptCounts[pk] = (apptCounts[pk] || 0) + 1;
    }

    var rows = [], missing = [], countsKnown = !!statProviders;
    for (i = 0; i < entries.length && i < 40; i++) {
      var e = entries[i]; if (!e || !e.name) continue;
      var key = normKey(e.name);
      var st = byName[key];
      var row = {
        name: String(e.name).slice(0, 80),
        rosterVerified: e.rosterVerified !== false,
        pulledChartPatients: st ? st.pulled : 0,
        appointmentsKnown: st ? st.appts : (apptCounts[key] || 0)
      };
      row.hasLocalData = row.pulledChartPatients > 0;
      if (countsKnown && !row.hasLocalData) missing.push(row.name);
      rows.push(row);
    }
    var last = safe(function () { return window.__mlsPullLastOutcome || null; }, null);
    return {
      rosterComplete: !!(receipt && receipt.complete === true),
      countsKnown: countsKnown,
      note: countsKnown
        ? 'Names below are the VERIFIED athenaOne roster spellings — use them exactly in a pullProviders arg. hasLocalData means charts for that provider were actually pulled into MLS; providersWithNoLocalData have appointment volume at most.'
        : 'Names below are the VERIFIED athenaOne roster spellings — use them exactly in a pullProviders arg. Per-provider local-data counts are unavailable right now, so do NOT claim any provider\'s data is missing or present.',
      providers: rows,
      providersWithNoLocalData: missing.slice(0, 40),
      lastPull: last ? { ok: last.ok === true, at: last.at || 0, error: last.error ? String(last.error).slice(0, 120) : undefined } : null
    };
  }

  /* cpw-1.3.0: the WHITELISTED app-control registry — the Copilot's hands on
     the app's own safe controls. Every entry calls the app's REAL opener;
     there is no raw DOM clicking of arbitrary targets, and nothing here can
     sign, save, or write to Athena. Unknown names refuse honestly. */
  var APP_CONTROLS = {
    'templates': { what: 'Open the note Templates library', run: function () { if (isFn(window.openTemplates)) { window.openTemplates(); return true; } return false; } },
    'avatar-checkins': { what: 'Open Avatar check-ins (program the patient interviewer, read completed check-ins)', run: function () { var a = window.__mlsAvatar; if (a && a.installed && isFn(a.open)) { a.open(); return true; } return false; } },
    'portal-requests': { what: 'Open the patient portal requests inbox', run: function () { var p = window.__mlsPortalRequestInbox; if (p && isFn(p.open)) { p.open(); return true; } return false; } },
    'new-visit': { what: 'Open the Visit screen ready for a new visit (never starts recording)', run: function () { var any = false; if (isFn(window.showView)) { window.showView('visit'); any = true; } if (isFn(window.newVisit)) { window.newVisit(); any = true; } return any; } },
    'pull-today': { what: "Start the standard pull of today's schedule from athenaOne (same as the Pull today button)", run: function () { if (isFn(window.pullScheduleViaAssist)) { window.pullScheduleViaAssist(); return true; } return false; } },
    'after-visit-summary': { what: 'Open the after-visit summary tool for the active patient', run: function () { var b = safe(function () { return document.getElementById('mlsavsBtn'); }, null); if (b) { b.click(); return true; } return false; } }
  };
  function runAppControl(arg, btn) {
    var name = String(arg || '').trim().toLowerCase();
    var entry = APP_CONTROLS[name];
    if (!entry) {
      toast('That control ("' + name.slice(0, 40) + '") is not in the Copilot\'s registry — nothing was clicked.');
      return false;
    }
    var ok = safe(entry.run, false);
    if (ok) { if (btn && btn.classList) btn.classList.add('cact-done'); }
    else toast('That tool is not available on this screen right now — nothing was clicked.');
    return ok;
  }

  function capabilities() {
    var controls = {};
    for (var k in APP_CONTROLS) if (Object.prototype.hasOwnProperty.call(APP_CONTROLS, k)) controls[k] = APP_CONTROLS[k].what;
    return {
      actions: ['openPatient', 'startVisit', 'navigate', 'build', 'pullProviders', 'draftNote', 'appControl'],
      appControls: controls,
      pullEngineReady: !!(window.__mlsSI && isFn(window.__mlsSI.dayPull)),
      views: ['patients', 'visit', 'calendar', 'orders', 'recs', 'history', 'analysis', 'studio'],
      note: 'pullProviders arg must be strict JSON {"providers":["<exact roster spelling>"],"date":"YYYY-MM-DD"?}; appControl arg must be one appControls key exactly; the tap on your offer is the user’s confirmation.'
    };
  }

  /* cpw-1.2.0: surface the Avatar's READY check-ins to the model, from the
     avatar module's own event-driven cache — no new network path, and the
     staleness is DECLARED so the model never presents old counts as now. */
  function avatarCheckins() {
    var cache = safe(function () { return window.__mlsAvatar && window.__mlsAvatar.lastReady; }, null);
    if (!cache || !Array.isArray(cache.checkins)) return null;
    var ageMin = Math.max(0, Math.round((Date.now() - (Number(cache.at) || 0)) / 60000));
    if (ageMin > 120) return null; /* stale beyond usefulness — omit, prompt says to admit blindness */
    return {
      /* the TRUE count, not the sample length — an undisclosed cap presented
         as a count is exactly the lie this module exists to end */
      readyCount: Number(cache.total) || cache.checkins.length,
      asOfMinutesAgo: ageMin,
      ready: cache.checkins.slice(0, 10).map(function (c) {
        /* the SAME fail-closed resolver the inbox uses (exactly-one match) */
        var patient = safe(function () {
          return isFn(window.__mlsAvatar.exactPatient) ? window.__mlsAvatar.exactPatient(c.patient_external_id) : null;
        }, null);
        var flagged = (c.flags || []).indexOf('emergency-language') >= 0;
        return {
          patient: (patient && patient.name) || ('portal patient ' + String(c.patient_external_id || '').slice(0, 24)),
          /* the ⚠ bullet duplicates flagged:true — keep the substantive ones */
          bullets: (c.bullets || []).filter(function (b) { return !/^⚠/.test(String(b)); }).slice(0, 2),
          flagged: flagged || undefined
        };
      }),
      note: 'Completed pre-visit Avatar interviews awaiting the doctor. Full summaries live in Menu → Avatar check-ins.'
    };
  }

  var snapWrapped = null, snapPrev = null;
  function wrapSnapshot() {
    var prev = window.copilotSnapshot;
    if (!isFn(prev) || prev.__cpw) return isFn(prev) && !!prev.__cpw;
    snapPrev = prev;
    var wrapped = function () {
      var res = prev.apply(this, arguments);
      try {
        if (res && typeof res === 'object') {
          res.providerCoverage = providerCoverage();
          res.capabilities = capabilities();
          var av = avatarCheckins();
          if (av) res.avatarCheckins = av;
        }
      } catch (e) {}
      return res;
    };
    wrapped.__cpw = true;
    wrapped.__prev = prev;
    window.copilotSnapshot = wrapped;
    snapWrapped = wrapped;
    return true;
  }

  /* ---------------- WIRE BOUND: absolute /api/copilot body cap ------------- */
  function clampStrings(node, max, depth, skipRe) {
    if (depth > 10 || !isObj(node)) return;
    var keys = Array.isArray(node) ? null : Object.keys(node);
    var n = keys ? keys.length : node.length;
    for (var i = 0; i < n; i++) {
      var k = keys ? keys[i] : i;
      if (keys && skipRe && skipRe.test(k)) continue;
      var v = node[k];
      if (typeof v === 'string' && v.length > max) node[k] = v.slice(0, max) + '…';
      else if (isObj(v)) clampStrings(v, max, depth + 1, null);
    }
  }
  function boundBody(bodyString) {
    if (typeof bodyString !== 'string' || bodyString.length <= WIRE_CAP) return null;
    var payload = safe(function () { return JSON.parse(bodyString); }, null);
    if (!payload || !isObj(payload.context)) return null;
    var ctx = payload.context;
    var ACTIVE = /^(active|providerCoverage$|capabilities$|contextPacking$|providerStats$)/;
    var out = '';
    var fits = function () {
      out = safe(function () { return JSON.stringify(payload); }, '');
      return out && out.length <= WIRE_CAP;
    };
    var maxes = [1000, 400, 240, 120], m;
    for (m = 0; m < maxes.length; m++) {
      clampStrings(ctx, maxes[m], 0, ACTIVE);
      if (fits()) return out;
    }
    for (var pass = 0; pass < 40; pass++) {
      var best = null, bestLen = 1;
      for (var k in ctx) {
        if (!Object.prototype.hasOwnProperty.call(ctx, k) || ACTIVE.test(k)) continue;
        if (Array.isArray(ctx[k]) && ctx[k].length > bestLen) { best = ctx[k]; bestLen = ctx[k].length; }
      }
      if (!best) break;
      best.length = best.length - Math.max(1, Math.floor(best.length / 4));
      ctx.contextWireBound = { version: VERSION, note: 'rows shed to fit the wire cap' };
      if (fits()) return out;
    }
    /* Last resort: the active record and receipts alone. */
    var minimal = {};
    for (var mk in ctx) if (Object.prototype.hasOwnProperty.call(ctx, mk) && ACTIVE.test(mk)) minimal[mk] = ctx[mk];
    minimal.contextWireBound = { version: VERSION, note: 'minimal: original context exceeded every shrink rung' };
    payload.context = minimal;
    if (fits()) return out;
    clampStrings(minimal, 120, 0, null);
    return fits() ? out : null;
  }

  var origFetch = window.fetch, wrappedFetch = null;
  function installFetch() {
    if (!isFn(origFetch)) return false;
    wrappedFetch = function (input, init) {
      try {
        var url = typeof input === 'string' ? input : (input && input.url) || '';
        if (/\/api\/copilot(?:\?|$)/.test(String(url).split('#')[0]) && init && typeof init.body === 'string') {
          var bounded = boundBody(init.body);
          if (bounded) {
            var next = {};
            for (var key in init) if (Object.prototype.hasOwnProperty.call(init, key)) next[key] = init[key];
            next.body = bounded;
            return origFetch.call(this, input, next);
          }
        }
      } catch (e) {}
      return origFetch.apply(this, arguments);
    };
    wrappedFetch.__cpw = true;
    window.fetch = wrappedFetch;
    return true;
  }

  /* ---------------- HANDS: pullProviders / draftNote ----------------------- */
  function parseProvidersArg(arg) {
    var out = { providers: [], date: '' };
    var raw = String(arg == null ? '' : arg).trim();
    if (!raw) return out;
    var parsed = safe(function () { return JSON.parse(raw); }, null);
    if (parsed && isObj(parsed)) {
      var list = Array.isArray(parsed.providers) ? parsed.providers : (Array.isArray(parsed) ? parsed : []);
      for (var i = 0; i < list.length && out.providers.length < 12; i++) {
        var name = String(list[i] || '').trim();
        if (name) out.providers.push(name.slice(0, 80));
      }
      var d = String(parsed.date || '').trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(d)) out.date = d;
      return out;
    }
    /* Athena names are "Last, First" — a comma split would break them, so a
       non-JSON arg is either a semicolon list or ONE provider name. */
    var parts = raw.indexOf(';') >= 0 ? raw.split(';') : [raw];
    for (var j = 0; j < parts.length && out.providers.length < 12; j++) {
      var nm = String(parts[j] || '').trim();
      if (nm) out.providers.push(nm.slice(0, 80));
    }
    return out;
  }

  function engineBusy() {
    return safe(function () {
      var st = window.__mlsDayHistoryPull && window.__mlsDayHistoryPull.state;
      if (st && st.running === true) return true;
      var at = Number(window.__mlsPullBusyAt) || 0;
      return at > 0 && (Date.now() - at) < 6 * 60 * 1000;
    }, false);
  }

  var pullRunning = false;
  function runPullProviders(arg, btn) {
    if (pullRunning) { toast('A Copilot pull is already running — receipts will land in the conversation.'); return false; }
    var req = parseProvidersArg(arg);
    if (!req.providers.length) {
      say('That pull offer did not name any providers, so nothing was started. Ask again naming the providers you want pulled.');
      return false;
    }
    var si = window.__mlsSI;
    if (!si || !isFn(si.dayPull)) {
      say('The schedule pull engine is not available on this tab, so I could not start the pull. Use the MLS tab that has the MLS Assist extension connected, then tap the offer again.');
      return false;
    }
    if (engineBusy()) {
      say('A schedule pull is already in progress. Wait for it to finish (the progress bar shows it), then tap the offer again.');
      return false;
    }
    var roster = window.__mlsProviderRoster;
    var resolved = [], unresolved = [];
    for (var i = 0; i < req.providers.length; i++) {
      var name = req.providers[i];
      var entry = safe(function () { return roster && isFn(roster.resolve) ? roster.resolve(name) : null; }, null);
      if (entry && entry.name && entry.stableKey) resolved.push(entry); else unresolved.push(name);
    }
    var date = req.date || safe(function () { return isFn(window._acctTodayKey) ? window._acctTodayKey() : ''; }, '');
    if (!date) { say('I could not determine which day to pull. Ask again with a date (YYYY-MM-DD).'); return false; }
    if (!resolved.length) {
      say('None of these resolved in the verified athenaOne provider roster: ' + unresolved.join('; ') +
        '. MLS never guesses a provider by name. Pull the Day schedule once (so athenaOne paints the roster), then tap the offer again.');
      return false;
    }

    pullRunning = true;
    var origLabel = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; }
    var results = [];
    var idx = 0;

    function finish() {
      pullRunning = false;
      if (btn) { btn.disabled = false; btn.textContent = origLabel || 'Pull providers'; }
      var lines = [];
      for (var r = 0; r < results.length; r++) {
        var row = results[r], rec = row.receipt || {};
        if (rec.ok === true) {
          lines.push(row.name + ' (' + date + '): pulled — ' + (Number(rec.created) || 0) + ' added, ' +
            (Number(rec.repaired) || 0) + ' updated' + (Number(rec.failed) ? (', ' + rec.failed + ' failed') : '') + '.');
        } else {
          lines.push(row.name + ' (' + date + '): not pulled — ' + String(rec.reason || row.error || 'no receipt').slice(0, 140) + '.');
        }
      }
      if (results.length < resolved.length) {
        lines.push('Not attempted (an earlier pull was refused, so the queue stopped): ' +
          resolved.slice(results.length).map(function (e) { return e.name; }).join('; ') + ' — tap the offer again when the running pull finishes.');
      }
      if (unresolved.length) {
        lines.push('Skipped (not in the verified athenaOne roster, and MLS never guesses): ' + unresolved.join('; ') + '.');
      }
      say('Provider pull finished.\n' + lines.join('\n'));
    }

    function next() {
      if (idx >= resolved.length) { finish(); return; }
      var entry = resolved[idx];
      if (btn) btn.textContent = 'Pulling ' + (idx + 1) + '/' + resolved.length + ': ' + entry.name;
      var p = safe(function () { return si.dayPull({ date: date, provider: entry, includeHistory: true }); }, null);
      Promise.resolve(p).then(function (receipt) {
        results.push({ name: entry.name, receipt: receipt || { ok: false, reason: 'no receipt returned' } });
        idx++;
        if (receipt && receipt.ok !== true && receipt.reason === 'pull-in-flight') { finish(); return; }
        next();
      }, function (err) {
        results.push({ name: entry.name, receipt: null, error: String((err && err.message) || err || 'pull error').slice(0, 140) });
        idx++;
        next();
      });
    }

    say('Starting the provider pull for ' + date + ': ' + resolved.map(function (e) { return e.name; }).join('; ') +
      (unresolved.length ? (' (skipping unverified: ' + unresolved.join('; ') + ')') : '') +
      '. Each provider is one pass; receipts will follow here.');
    next();
    return true;
  }

  function runDraftNote(arg, btn) {
    var resolver = safe(function () {
      return window.__mlsCopilotActions && isFn(window.__mlsCopilotActions.resolvePatient) ? window.__mlsCopilotActions.resolvePatient : null;
    }, null);
    var result = resolver ? safe(function () { return resolver(arg); }, null) : null;
    var patient = result && result.patient ? result.patient : null;
    if (!patient) {
      /* Fail-closed fallback: exact primary-id equality only. */
      var list = safe(function () { return isFn(window.getPatients) ? (window.getPatients() || []) : []; }, []) || [];
      var raw = String(arg || '').trim();
      var hits = [];
      for (var i = 0; i < list.length; i++) if (String(list[i] && list[i].id) === raw) hits.push(list[i]);
      if (hits.length === 1) patient = hits[0];
    }
    if (!patient) {
      toast('Could not uniquely find that patient, so nothing was opened. Open Patients and choose the exact chart.');
      return false;
    }
    var selected = safe(function () {
      if (window.__mlsPick && isFn(window.__mlsPick.select)) return window.__mlsPick.select(patient.id) !== false;
      if (isFn(window.openPatient)) return window.openPatient(patient.id) !== false;
      if (isFn(window.selectPatient)) return window.selectPatient(patient.id) !== false;
      return false;
    }, false);
    if (!selected) {
      toast('The exact patient was found, but the chart could not be selected safely. Open Patients and choose it there.');
      return false;
    }
    if (isFn(window.openOpPrepForPatient)) {
      safe(function () { window.openOpPrepForPatient(patient.id); });
      toast('Op-note drafting opened for ' + (patient.name || 'patient') + ' — nothing is generated or sent until you choose to.');
      if (btn) btn.classList.add('cact-done');
      return true;
    }
    safe(function () { if (isFn(window.showView)) window.showView('visit'); });
    toast((patient.name || 'Patient') + ' is selected — the op-note prep tool is not loaded on this tab, so use Draft from the Visit screen.');
    return true;
  }

  /* ---------------- public surface ---------------- */
  function handles(kind) { return kind === 'pullProviders' || kind === 'draftNote' || kind === 'appControl'; }
  function run(kind, arg, btn) {
    if (kind === 'pullProviders') return runPullProviders(arg, btn);
    if (kind === 'draftNote') return runDraftNote(arg, btn);
    if (kind === 'appControl') return runAppControl(arg, btn);
    return false;
  }

  var lifecycleBound = [];
  function onLifecycle() { wrapSnapshot(); }
  function bindLifecycle() {
    if (wrapSnapshot()) return;
    ['mls:ui-ready', 'mls:copilot-ready'].forEach(function (name) {
      safe(function () { window.addEventListener(name, onLifecycle, false); lifecycleBound.push([name, onLifecycle]); });
    });
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', onLifecycle, { once: true });
    }
  }

  function revert() {
    safe(function () { if (snapWrapped && window.copilotSnapshot === snapWrapped && snapPrev) window.copilotSnapshot = snapPrev; });
    safe(function () { if (wrappedFetch && window.fetch === wrappedFetch) window.fetch = origFetch; });
    for (var i = 0; i < lifecycleBound.length; i++) {
      safe(function (row) { window.removeEventListener(row[0], row[1], false); }.bind(null, lifecycleBound[i]));
    }
    lifecycleBound = [];
    try { window.__mlsCopilotPower.installed = false; } catch (e) {}
  }

  installFetch();
  bindLifecycle();

  window.__mlsCopilotPower = {
    installed: true,
    version: VERSION,
    asset: ASSET,
    handles: handles,
    run: run,
    providerCoverage: providerCoverage,
    capabilities: capabilities,
    boundBody: boundBody,
    parseProvidersArg: parseProvidersArg,
    revert: revert
  };
})();
