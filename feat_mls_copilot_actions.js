/* ============================================================================
 * feat_mls_copilot_actions.js -> window.__mlsCopilotActions (ca-2.0.3)
 * ---------------------------------------------------------------------------
 * The base Studio Copilot canonically persists and renders reply metadata
 * (actions, followups, artifact). This companion never intercepts /api/copilot,
 * never clones a response, and never adds a second block to #copilotThread.
 *
 * The floating Assistant uses the same canonical conversation but its simple
 * text renderer does not paint metadata. This module subscribes to that shared
 * persisted store and decorates only #mlsAsstPanel .as-thread, keyed by the
 * canonical message identity. Repeated notifications remain exactly-once.
 *
 * WHAT THE AFFORDANCES DO (all call REAL existing app functions; nothing new
 * is invented, nothing bypasses existing safety rails):
 *   - followup chip        -> window.__mlsAsstFix._handleSend(text)  (same as typing it)
 *   - action kind=navigate  -> window.showView(view)
 *   - action kind=openPatient -> resolves a same-namespace stable ID or one
 *     unique name match, then opens via the canonical patient-selection path;
 *     ambiguous names fail closed.
 *   - action kind=startVisit  -> canonically selects that exact patient, opens
 *     Visit, and STOPS -- recording only starts from the Visit control.
 *   - action kind=build     -> showView('studio') and PREFILLS (never auto-
 *     sends) the Studio Copilot's own input box with the arg text, so the user
 *     reviews and sends it themselves.
 *   - artifact (e.g. a drafted email) -> shown as an editable preview card;
 *     Copy email draft writes the reviewed draft to the clipboard. This held
 *     build never sends email or accepts an arbitrary network recipient.
 *
 * HARD SAFETY: this module cannot write to athenaOne, sign, save, or submit
 * anything. It has no path to any Athena/order/sign function. The only network
 * path in this module. Everything is local navigation/selection, local copy,
 * or delegates to the assistant's own text pipeline (as if the user typed it).
 *
 * Idempotent, additive, reversible: window.__mlsCopilotActions.revert()
 * ASCII-only. try/catch throughout. No PHI logged.
 *
 * ==========================================================================*/
(function () {
  'use strict';
  try { if (window.__mlsCopilotActions && window.__mlsCopilotActions.installed) return; } catch (e) { return; }

  var VERSION = 'ca-2.0.3';
  var ASSET = 'feat_mls_copilot_actions.js';
  var BLOCK_CLASS = 'mlsCaBlock';
  var STYLE_ID = 'mlsCoActStyle';

  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }
  function isFn(f) { return typeof f === 'function'; }
  function $(id) { return safe(function () { return document.getElementById(id); }, null); }
  function toast(m) { safe(function () { if (isFn(window.toast)) window.toast(m, ''); }); }

  /* ---------------- CSS ---------------- */
  function ensureCss() {
    if ($(STYLE_ID)) return;
    var st = document.createElement('style'); st.id = STYLE_ID;
    st.textContent = [
      '.' + BLOCK_CLASS + '{margin:6px 4px 12px;padding:10px 12px;border-radius:12px;background:rgba(32,64,52,.07);border:1px solid rgba(32,64,52,.22)}',
      '.' + BLOCK_CLASS + ' .mlsca-fu{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px}',
      '.' + BLOCK_CLASS + ' .mlsca-chip{cursor:pointer;border:1px solid rgba(32,64,52,.4);background:#fff;color:#204034;border-radius:999px;padding:5px 11px;font:600 12px system-ui;}',
      '.' + BLOCK_CLASS + ' .mlsca-chip:hover{background:rgba(32,64,52,.12)}',
      '.' + BLOCK_CLASS + ' .mlsca-acts{display:flex;flex-wrap:wrap;gap:6px}',
      '.' + BLOCK_CLASS + ' .mlsca-act{cursor:pointer;border:0;border-radius:9px;padding:7px 12px;font:700 12.5px system-ui;color:#fff;background:linear-gradient(135deg,#2E6A4B,#204034)}',
      '.' + BLOCK_CLASS + ' .mlsca-act:hover{filter:brightness(1.08)}',
      '.' + BLOCK_CLASS + ' .mlsca-art{margin-top:10px;padding:9px 11px;border-radius:10px;background:#fff;border:1px solid rgba(32,64,52,.25)}',
      '.' + BLOCK_CLASS + ' .mlsca-art h5{margin:0 0 6px;font:800 12.5px system-ui;color:#1f2d40}',
      '.' + BLOCK_CLASS + ' .mlsca-art textarea{width:100%;min-height:90px;box-sizing:border-box;font:13px system-ui;border:1px solid #cfd9ea;border-radius:8px;padding:7px}',
      '.' + BLOCK_CLASS + ' .mlsca-art input{width:100%;box-sizing:border-box;font:13px system-ui;border:1px solid #cfd9ea;border-radius:8px;padding:6px 8px;margin:4px 0}',
      '.' + BLOCK_CLASS + ' .mlsca-send{margin-top:6px;cursor:pointer;border:0;border-radius:8px;padding:6px 12px;font:700 12px system-ui;color:#fff;background:#137a3a}',
      '.' + BLOCK_CLASS + ' .mlsca-send[disabled]{opacity:.55;cursor:default}',
      '.' + BLOCK_CLASS + ' .mlsca-note{font:11px system-ui;color:#5b6b82;margin-top:5px}'
    ].join('\n');
    (document.head || document.documentElement).appendChild(st);
  }

  /* ---------------- data helpers (read-only, no PHI logged) ---------------- */
  var PATIENT_ID_KEYS = ['id', 'patientId', 'patient_id', 'pid', 'mrn', 'externalId', 'external_id', 'athenaId', 'athena_id', 'chartId', 'chart_id'];
  function getPatients() { return safe(function () { return (window.getPatients && window.getPatients()) || []; }, []); }
  function idValue(patient, key) {
    return patient && Object.prototype.hasOwnProperty.call(patient, key) && patient[key] != null ? String(patient[key]).trim() : '';
  }
  function normName(value) { return String(value || '').trim().toLowerCase().replace(/\s+/g, ' '); }
  function sameStablePatient(a, b) {
    var matched = 0;
    for (var i = 0; i < PATIENT_ID_KEYS.length; i++) {
      var av = idValue(a, PATIENT_ID_KEYS[i]), bv = idValue(b, PATIENT_ID_KEYS[i]);
      if (!av || !bv) continue;
      if (av !== bv) return false;
      matched++;
    }
    return matched > 0;
  }
  function patientPool() {
    var combined = [];
    var next = safe(function () { return (window.__mlsWhosNext && isFn(window.__mlsWhosNext.activeList)) ? window.__mlsWhosNext.activeList() : []; }, []) || [];
    var stored = getPatients();
    for (var i = 0; i < next.length; i++) combined.push(next[i]);
    for (var j = 0; j < stored.length; j++) combined.push(stored[j]);
    var out = [];
    for (var k = 0; k < combined.length; k++) {
      var patient = combined[k]; if (!patient || typeof patient !== 'object') continue;
      var duplicate = false;
      for (var oi = 0; oi < out.length; oi++) if (sameStablePatient(patient, out[oi])) { duplicate = true; break; }
      if (duplicate) continue;
      out.push(patient);
    }
    return out;
  }
  function explicitIdentity(target) {
    if (target && typeof target === 'object') {
      var ids = {};
      for (var i = 0; i < PATIENT_ID_KEYS.length; i++) {
        var value = idValue(target, PATIENT_ID_KEYS[i]); if (value) ids[PATIENT_ID_KEYS[i]] = value;
      }
      return Object.keys(ids).length ? ids : null;
    }
    var text = String(target || '').trim();
    var match = text.match(/^(id|patientId|patient_id|pid|mrn|externalId|external_id|athenaId|athena_id|chartId|chart_id)\s*:\s*(.+)$/i);
    if (match) {
      var canonical = null;
      for (var j = 0; j < PATIENT_ID_KEYS.length; j++) if (PATIENT_ID_KEYS[j].toLowerCase() === match[1].toLowerCase()) canonical = PATIENT_ID_KEYS[j];
      if (canonical) { var out = {}; out[canonical] = String(match[2] || '').trim(); return out; }
    }
    return null;
  }
  function resolvePatient(target) {
    var pool = patientPool(), ids = explicitIdentity(target), matches = [], i, key;
    if (ids) {
      for (i = 0; i < pool.length; i++) {
        var exact = true, compared = 0;
        for (key in ids) {
          compared++;
          if (!idValue(pool[i], key) || idValue(pool[i], key) !== ids[key]) { exact = false; break; }
        }
        if (exact && compared) matches.push(pool[i]);
      }
      return matches.length === 1 ? { patient: matches[0], reason: 'stable-id' } :
        { patient: null, reason: matches.length > 1 ? 'ambiguous-id' : 'not-found', count: matches.length };
    }

    var query = normName(target && typeof target === 'object' ? target.name : target);
    if (!query) return { patient: null, reason: 'missing-target', count: 0 };

    /* A raw string may be the app's primary `id`, but it is never compared to
       MRN or another identifier namespace. */
    var raw = String(target || '').trim(), idMatches = [];
    for (i = 0; i < pool.length; i++) if (idValue(pool[i], 'id') === raw) idMatches.push(pool[i]);
    if (idMatches.length === 1) return { patient: idMatches[0], reason: 'primary-id' };
    if (idMatches.length > 1) return { patient: null, reason: 'ambiguous-id', count: idMatches.length };

    var exactNames = [];
    for (i = 0; i < pool.length; i++) if (normName(pool[i].name) === query) exactNames.push(pool[i]);
    if (exactNames.length === 1) return { patient: exactNames[0], reason: 'exact-name' };
    if (exactNames.length > 1) return { patient: null, reason: 'ambiguous-name', count: exactNames.length };

    var partial = [];
    for (i = 0; i < pool.length; i++) if (normName(pool[i].name).indexOf(query) >= 0) partial.push(pool[i]);
    if (partial.length === 1) return { patient: partial[0], reason: 'unique-partial' };
    return { patient: null, reason: partial.length > 1 ? 'ambiguous-name' : 'not-found', count: partial.length };
  }
  var VIEW_ALIASES = {
    home: 'visit', visit: 'visit', record: 'visit', recording: 'visit',
    schedule: 'calendar', calendar: 'calendar',
    patients: 'patients', patient: 'patients',
    orders: 'orders', order: 'orders',
    recs: 'recs', recommendation: 'recs', recommendations: 'recs',
    history: 'history', notes: 'history',
    analysis: 'analysis', stats: 'analysis', statistics: 'analysis',
    studio: 'studio', ai: 'studio', widgets: 'studio'
  };
  function resolveView(arg) {
    var a = String(arg || '').trim().toLowerCase();
    if (VIEW_ALIASES[a]) return VIEW_ALIASES[a];
    /* ca-2.0.1: loose AI args ("analysis top problems", "today's schedule")
       used to pass through raw and silently no-op in showView. Keyword-match
       to a real view instead. */
    if (/analy|problem|diagnos|condition|stat|outcome/.test(a)) return 'analysis';
    if (/schedul|calendar|today/.test(a)) return 'calendar';
    if (/patient|panel|candidate/.test(a)) return 'patients';
    if (/histor|note/.test(a)) return 'history';
    if (/studio|widget|tool/.test(a)) return 'studio';
    if (/visit|record/.test(a)) return 'visit';
    return '';
  }

  /* ---------------- action execution ---------------- */
  function doNavigate(view, label) {
    var hint = String(view || '') + ' ' + String(label || '');
    var topPatients = /\btop\s+patients?\b|patients?.{0,24}visit count|visit count.{0,24}patients?/i.test(hint);
    var resolved = topPatients ? 'patients' : resolveView(view || label);
    if (!resolved || !isFn(window.showView)) return false;
    if (resolved === 'patients') {
      var sort = $('ptSort');
      if (sort) sort.value = topPatients ? 'visits' : 'name';
    }
    window.showView(resolved);
    if (resolved === 'patients' && isFn(window.renderPatients)) window.renderPatients();
    if (topPatients) toast('Patients are ranked by visit count.');
    return true;
  }
  function targetLabel(target) {
    if (target && typeof target === 'object') return String(target.name || target.id || target.patientId || target.mrn || 'that patient');
    return String(target || 'that patient');
  }
  function resolutionFailure(result, target) {
    if (result && /^ambiguous/.test(result.reason || '')) toast('More than one patient matches "' + targetLabel(target) + '". Open Patients and choose the exact chart.');
    else toast('Could not uniquely find "' + targetLabel(target) + '". Pull the schedule or open Patients to choose the exact chart.');
  }
  function selectResolvedPatient(patient) {
    if (!patient || patient.id == null || String(patient.id).trim() === '') return false;
    var id = patient.id;
    try {
      if (window.__mlsPick && isFn(window.__mlsPick.select)) return window.__mlsPick.select(id) !== false;
      if (isFn(window.openPatient)) return window.openPatient(id) !== false;
      if (isFn(window.selectPatient)) return window.selectPatient(id) !== false;
    } catch (e) { return false; }
    return false;
  }
  function doOpenPatient(target) {
    var result = resolvePatient(target);
    if (!result.patient) { resolutionFailure(result, target); return false; }
    if (!selectResolvedPatient(result.patient)) {
      toast('The exact patient was found, but the chart could not be selected safely. Open Patients and choose it there.');
      return false;
    }
    toast('Opened ' + (result.patient.name || 'patient') + '\'s chart.');
    return true;
  }
  function doStartVisit(target) {
    if (target == null || (typeof target !== 'object' && String(target).trim() === '')) {
      safe(function () { if (isFn(window.showView)) window.showView('visit'); });
      toast('Visit opened -- choose a patient, then tap Start recording when ready.');
      return true;
    }
    var result = resolvePatient(target);
    if (!result.patient) { resolutionFailure(result, target); return false; }
    if (!selectResolvedPatient(result.patient)) {
      toast('The exact patient was found, but MLS could not safely select that chart. Open Patients and choose it there.');
      return false;
    }
    safe(function () { if (isFn(window.showView)) window.showView('visit'); });
    toast((result.patient.name || 'Patient') + ' is selected on Visit -- tap Start recording when ready.');
    return true;
  }
  function doBuild(promptText) {
    safe(function () { if (isFn(window.showView)) window.showView('studio'); });
    var tries = 0, iv = setInterval(function () {
      tries++;
      var row = $('copilotInputRow');
      var input = row ? (row.querySelector('textarea') || row.querySelector('input')) : null;
      if (input) {
        clearInterval(iv);
        input.value = promptText || '';
        safe(function () { input.dispatchEvent(new Event('input', { bubbles: true })); });
        safe(function () { input.focus(); });
        toast('Drafted a prompt in Studio -- review and send it whenever you’re ready.');
      } else if (tries > 20) clearInterval(iv);
    }, 150);
  }
  function runAction(a) {
    if (!a) return false;
    if (a.kind === 'navigate') {
      if (doNavigate(a.arg, a.label)) return true;
      toast('That suggestion isn’t wired to a screen yet — ask me where you want to go and I’ll take you there.');
      return false;
    }
    if (a.kind === 'openPatient') return doOpenPatient(a.arg);
    if (a.kind === 'startVisit') return doStartVisit(a.arg);
    if (a.kind === 'build') { doBuild(a.arg); return true; }
    /* ca-2.0.1: unknown kind (model drift) — land on the closest REAL view by
       keyword from kind/arg/label, else say so; never a silent dead click and
       never a navigate to a garbage view name. */
    var guess = strictView(a.kind) || strictView(a.arg) || strictView(a.label);
    if (guess && doNavigate(guess, a.label)) return true;
    toast('That suggestion isn’t wired to a screen yet — ask me where you want to go and I’ll take you there.');
    return false;
  }
  function strictView(x) {
    var a = String(x || '').trim().toLowerCase();
    if (!a) return '';
    if (VIEW_ALIASES[a]) return VIEW_ALIASES[a];
    if (/analy|problem|diagnos|condition|stat|outcome/.test(a)) return 'analysis';
    if (/schedul|calendar|today/.test(a)) return 'calendar';
    if (/patient|panel|candidate/.test(a)) return 'patients';
    if (/histor|note/.test(a)) return 'history';
    if (/studio|widget|tool/.test(a)) return 'studio';
    if (/visit|record/.test(a)) return 'visit';
    return '';
  }

  /* ---------------- Assistant-only rendering ---------------- */
  function assistantThread() {
    return safe(function () {
      var p = $('mlsAsstPanel');
      return p ? p.querySelector('.as-thread') : null;
    }, null);
  }

  function submitFollowup(question) {
    var q = String(question || '').trim(); if (!q) return;
    safe(function () { if (window.__mlsAsstFix && isFn(window.__mlsAsstFix._handleSend)) window.__mlsAsstFix._handleSend(q); });
  }

  function uniquePayload(payload) {
    var seen = {}, actions = [], followups = [];
    var aa = payload && Array.isArray(payload.actions) ? payload.actions : [];
    for (var i = 0; i < aa.length; i++) {
      var a = aa[i]; if (!a || typeof a !== 'object') continue;
      var ak = [a.kind || '', a.arg || '', a.label || ''].join('|');
      if (seen['a:' + ak]) continue; seen['a:' + ak] = true; actions.push(a);
    }
    var ff = payload && Array.isArray(payload.followups) ? payload.followups : [];
    for (var j = 0; j < ff.length; j++) {
      var f = String(ff[j] || '').trim(); if (!f) continue;
      var fk = f.toLowerCase(); if (seen['f:' + fk]) continue; seen['f:' + fk] = true; followups.push(f);
    }
    return { actions: actions, followups: followups,
      artifact: payload && payload.artifact && typeof payload.artifact === 'object' ? payload.artifact : null };
  }

  function copyEmailDraft(btn, block) {
    var toEl = block.querySelector('.mlsca-to');
    var subjEl = block.querySelector('.mlsca-subj');
    var bodyEl = block.querySelector('.mlsca-body');
    var to = toEl ? String(toEl.value || '').trim() : '';
    var subject = subjEl ? String(subjEl.value || '').trim() : '';
    var body = bodyEl ? String(bodyEl.value || '') : '';
    var draft = (to ? 'To: ' + to + '\n' : '') + (subject ? 'Subject: ' + subject + '\n' : '') + '\n' + body;
    btn.disabled = true;
    Promise.resolve(safe(function () { return navigator.clipboard.writeText(draft); }, Promise.reject(new Error('clipboard unavailable'))))
      .then(function () { btn.textContent = 'Copied'; toast('Email draft copied. Review it in your approved email system before sending.'); })
      .then(null, function () { btn.disabled = false; btn.textContent = 'Copy email draft'; toast('Could not copy the email draft.'); });
  }

  function renderBlock(payload, t, messageKey, bubble) {
    if (!t) return;
    messageKey = String(messageKey || 'message').replace(/"/g, '');
    var already = safe(function () { return t.querySelector('[data-mlsca-message="' + messageKey + '"]'); }, null);
    if (already) return;
    var normalized = uniquePayload(payload);
    var actions = normalized.actions;
    var followups = normalized.followups;
    var artifact = normalized.artifact;
    if (!actions.length && !followups.length && !artifact) return;

    var block = document.createElement('div');
    block.className = BLOCK_CLASS;
    block.setAttribute('data-mlsca-message', messageKey);

    if (followups.length) {
      var fu = document.createElement('div'); fu.className = 'mlsca-fu';
      followups.forEach(function (q) {
        var chip = document.createElement('button'); chip.type = 'button'; chip.className = 'mlsca-chip';
        chip.textContent = q;
        chip.onclick = function () { submitFollowup(q); };
        fu.appendChild(chip);
      });
      block.appendChild(fu);
    }
    if (actions.length) {
      var ac = document.createElement('div'); ac.className = 'mlsca-acts';
      actions.forEach(function (a) {
        var btn = document.createElement('button'); btn.type = 'button'; btn.className = 'mlsca-act';
        btn.textContent = a.label || a.kind;
        btn.onclick = function () { runAction(a); };
        ac.appendChild(btn);
      });
      block.appendChild(ac);
    }
    if (artifact && String(artifact.content || '').trim()) {
      var art = document.createElement('div'); art.className = 'mlsca-art';
      var h = document.createElement('h5'); h.textContent = artifact.title || 'Draft'; art.appendChild(h);
      var isEmail = String(artifact.kind || '').toLowerCase() === 'email';
      if (isEmail) {
        var toI = document.createElement('input'); toI.className = 'mlsca-to'; toI.placeholder = 'Recipient email'; toI.value = artifact.to || '';
        var subjI = document.createElement('input'); subjI.className = 'mlsca-subj'; subjI.placeholder = 'Subject'; subjI.value = artifact.subject || '';
        art.appendChild(toI); art.appendChild(subjI);
      }
      var ta = document.createElement('textarea'); ta.className = 'mlsca-body'; ta.value = artifact.content || '';
      art.appendChild(ta);
      if (isEmail) {
        var sendBtn = document.createElement('button'); sendBtn.type = 'button'; sendBtn.className = 'mlsca-send';
        sendBtn.textContent = 'Copy email draft';
        sendBtn.onclick = function () { copyEmailDraft(sendBtn, art); };
        art.appendChild(sendBtn);
        var note = document.createElement('div'); note.className = 'mlsca-note';
        note.textContent = 'Draft only. Nothing is sent from MLS; review and send it from your approved email system.';
        art.appendChild(note);
      } else {
        var note2 = document.createElement('div'); note2.className = 'mlsca-note';
        note2.textContent = 'Draft only -- copy what you need. This never writes to Athena.';
        art.appendChild(note2);
      }
      block.appendChild(art);
    }
    if (bubble && bubble.parentNode === t) {
      try { t.insertBefore(block, bubble.nextSibling || null); } catch (e) { t.appendChild(block); }
    } else t.appendChild(block);
    safe(function () { block.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); });
  }

  /* ---------------- canonical metadata subscription ---------------- */
  var storeRef = null, storeUnsub = null, renderTimer = null, bootTimer = null, bootTries = 0, lifecycleEvents = [];
  function canonicalStore() {
    return safe(function () {
      var store = window.__mlsCopilotConvo;
      return store && isFn(store.all) && isFn(store.subscribe) ? store : null;
    }, null);
  }
  function canonicalMessages() {
    var store = canonicalStore();
    if (store) return safe(function () { return store.all(); }, []) || [];
    return safe(function () { return Array.isArray(window._copilotHistory) ? window._copilotHistory.slice() : []; }, []);
  }
  function hash(value) {
    var s = String(value || ''), h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24); }
    return (h >>> 0).toString(36);
  }
  function messageKey(message, index) {
    return 'ca-msg-' + index + '-' + String(message && message.requestId != null ? message.requestId : 'persisted') + '-' +
      hash(String(message && message.text || '') + JSON.stringify(uniquePayload(message || {})));
  }
  function renderAssistantAffordances() {
    renderTimer = null;
    var thread = assistantThread(); if (!thread) return false;
    var messages = canonicalMessages();
    var bubbles = safe(function () { return thread.querySelectorAll('.as-msg'); }, []) || [];
    var valid = {};
    for (var i = 0; i < messages.length; i++) {
      var message = messages[i];
      if (!message || message.role !== 'ai') continue;
      var normalized = uniquePayload(message);
      if (!normalized.actions.length && !normalized.followups.length && !normalized.artifact) continue;
      var key = messageKey(message, i); valid[key] = true;
      renderBlock(normalized, thread, key, bubbles[i] || null);
    }
    var existing = safe(function () { return thread.querySelectorAll('[data-mlsca-message]'); }, []) || [];
    for (var j = existing.length - 1; j >= 0; j--) {
      var existingKey = safe(function (node) { return node.getAttribute('data-mlsca-message'); }.bind(null, existing[j]), '');
      if (!valid[existingKey] && existing[j].parentNode) safe(function (node) { node.parentNode.removeChild(node); }.bind(null, existing[j]));
    }
    return true;
  }
  function scheduleSync() {
    if (renderTimer != null) return;
    renderTimer = setTimeout(renderAssistantAffordances, 0);
  }
  function attachStore() {
    var store = canonicalStore();
    if (!store) return false;
    if (store === storeRef) { scheduleSync(); return true; }
    if (storeUnsub) safe(function () { storeUnsub(); });
    storeRef = store;
    storeUnsub = safe(function () { return store.subscribe(scheduleSync); }, null);
    scheduleSync();
    return true;
  }
  function retryBoot() {
    bootTimer = null; bootTries++;
    var attached = attachStore(); scheduleSync();
    if ((!attached || !assistantThread()) && bootTries < 40) bootTimer = setTimeout(retryBoot, 250);
  }
  function onLifecycle() { attachStore(); scheduleSync(); }
  function bindLifecycle() {
    if (lifecycleEvents.length || !isFn(window.addEventListener)) return;
    ['mls:ui-ready', 'mls:copilot-ready', 'mls:view-changed', 'mls:panel-open'].forEach(function (name) {
      safe(function () { window.addEventListener(name, onLifecycle, false); lifecycleEvents.push([name, onLifecycle]); });
    });
  }
  function unbindLifecycle() {
    for (var i = 0; i < lifecycleEvents.length; i++) safe(function (row) { window.removeEventListener(row[0], row[1], false); }.bind(null, lifecycleEvents[i]));
    lifecycleEvents = [];
  }

  /* ---------------- boot / revert ---------------- */
  function boot() {
    ensureCss(); bindLifecycle(); retryBoot();
  }
  function revert() {
    if (storeUnsub) safe(function () { storeUnsub(); });
    storeUnsub = null; storeRef = null;
    if (renderTimer != null) { safe(function () { clearTimeout(renderTimer); }); renderTimer = null; }
    if (bootTimer != null) { safe(function () { clearTimeout(bootTimer); }); bootTimer = null; }
    unbindLifecycle();
    safe(function () { var s = $(STYLE_ID); if (s && s.parentNode) s.parentNode.removeChild(s); });
    safe(function () {
      var blocks = document.querySelectorAll('.' + BLOCK_CLASS);
      for (var i = 0; i < blocks.length; i++) if (blocks[i].parentNode) blocks[i].parentNode.removeChild(blocks[i]);
    });
    try { window.__mlsCopilotActions.installed = false; } catch (e) {}
  }

  window.__mlsCopilotActions = {
    installed: true,
    version: VERSION,
    asset: ASSET,
    sync: function () { attachStore(); return renderAssistantAffordances(); },
    resolvePatient: resolvePatient,
    runAction: runAction,
    revert: revert
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else { boot(); }
})();
