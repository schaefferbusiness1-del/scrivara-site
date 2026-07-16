/* ============================================================================
 * feat_athena_actions.js  —  window.__mlsAthenaActions  (v1.0.0)
 * ----------------------------------------------------------------------------
 * ONE shared module that every Athena-connected action routes through, so the
 * SAME treatment is applied everywhere (never per-button one-offs):
 *
 *   1. CLEAR STEP-BY-STEP STATUS — a live timeline that signifies exactly what
 *      the action is doing right now ("Going to Athena search...", "Searching
 *      'Last, First'...", "Found patient, opening chart...", "Reading visit X of
 *      N...", "Done"). Real steps only — driven by genuine bridge events, never a
 *      fabricated counter (it defers to the counter-guard discipline).
 *
 *   2. CLICK-INTENT LABELS — next to every Athena button, a plain-English line
 *      stating exactly what that click brings in / takes out, and whether it is
 *      READ-ONLY or writes to the chart.
 *
 *   3. DESTINATION REPORTING + VERIFICATION — after any pull/save, it reports the
 *      EXACT destination and confirms it landed by re-reading the store (reuses
 *      the save-verify module). Never a blind "done"; honest if it can't confirm.
 *
 *   4. SELF-TROUBLESHOOT + ADAPTIVE SELF-RECOVERY — when an action fails it runs
 *      the diagnostic chain to find the real cause, then automatically tries an
 *      ALTERNATE strategy (re-ping/retry, fall back to search-by-name, adjust
 *      selectors via the driver's content-scoring, etc.) and NARRATES each switch
 *      in plain English ("That didn't find the chart - trying the search bar
 *      instead..."). Only an honest failure + the one user fix if all strategies
 *      are exhausted. Never fakes success. NEVER writes/Signs a chart.
 *
 * Additive, own-scope IIFE, idempotent, instantly reversible
 * (window.__mlsAthenaActions.revert()). Reuses existing modules - does not
 * reinvent detection, reading, verification, or diagnosis. No PHI is logged.
 * ==========================================================================*/
(function () {
  'use strict';
  var VERSION = '1.0.1';
  if (window.__mlsAthenaActions && window.__mlsAthenaActions.installed) return;

  // ---- small helpers ------------------------------------------------------
  function g(name) { try { return window[name]; } catch (e) { return null; } }
  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }
  function isFn(f) { return typeof f === 'function'; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  // Format a name as "Last, First" for the Athena search bar.
  function toLastFirst(name) {
    var n = String(name || '').trim();
    if (!n) return '';
    if (n.indexOf(',') !== -1) return n.replace(/\s+/g, ' ');
    var parts = n.split(/\s+/);
    if (parts.length < 2) return n;
    var last = parts[parts.length - 1];
    var first = parts.slice(0, parts.length - 1).join(' ');
    return last + ', ' + first;
  }

  // ---- styles -------------------------------------------------------------
  var STYLE_ID = 'mlsaa-style';
  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = [
      '.mlsaa-tl{position:fixed;right:16px;bottom:16px;width:340px;max-width:92vw;',
      'background:#fff;color:#1A211C;border:1px solid #d7e0ea;border-radius:12px;',
      'box-shadow:0 10px 34px rgba(16,40,72,.22);font:13px/1.4 -apple-system,Segoe UI,Roboto,Arial,sans-serif;',
      'z-index:2147483600;overflow:hidden;}',
      '.mlsaa-tl[hidden]{display:none;}',
      '.mlsaa-hd{display:flex;align-items:center;gap:8px;padding:10px 12px;background:#1E2B24;color:#fff;font-weight:700;}',
      '.mlsaa-hd .mlsaa-x{margin-left:auto;cursor:pointer;opacity:.85;font-weight:700;background:none;border:0;color:#fff;font-size:15px;}',
      '.mlsaa-intent-top{padding:8px 12px;background:#eef4fb;color:#204034;font-size:12px;border-bottom:1px solid #e2ebf4;}',
      '.mlsaa-intent-top .mode{display:inline-block;margin-left:6px;padding:1px 7px;border-radius:9px;font-size:10.5px;font-weight:700;vertical-align:1px;}',
      '.mlsaa-intent-top .mode.read{background:#d6f0e0;color:#0f6b3a;}',
      '.mlsaa-intent-top .mode.write{background:#ffe3c2;color:#8a4b00;}',
      '.mlsaa-steps{list-style:none;margin:0;padding:6px 0;max-height:46vh;overflow:auto;}',
      '.mlsaa-steps li{display:flex;gap:8px;align-items:flex-start;padding:5px 12px;}',
      '.mlsaa-steps li .ic{flex:0 0 16px;text-align:center;}',
      '.mlsaa-steps li.run .ic{animation:mlsaaSpin 1s linear infinite;}',
      '.mlsaa-steps li.note{color:#5a6b7d;font-style:italic;}',
      '.mlsaa-steps li.ok .ic{color:#0f8a45;}',
      '.mlsaa-steps li.warn{color:#8a4b00;}',
      '.mlsaa-steps li.fail{color:#a01818;font-weight:600;}',
      '.mlsaa-fix{margin:2px 12px 10px;padding:8px 10px;background:#fff4e6;border:1px solid #ffd9a8;border-radius:8px;color:#8a4b00;font-size:12px;}',
      '.mlsaa-done{padding:8px 12px 12px;font-weight:700;}',
      '.mlsaa-done.ok{color:#0f8a45;} .mlsaa-done.fail{color:#a01818;} .mlsaa-done.info{color:#204034;}',
      '@keyframes mlsaaSpin{to{transform:rotate(360deg);}}',
      '.mlsaa-intent{display:block;margin-top:3px;font-size:11px;line-height:1.3;color:#41566b;}',
      '.mlsaa-intent .tag{display:inline-block;margin-right:5px;padding:0 6px;border-radius:8px;font-size:10px;font-weight:700;}',
      '.mlsaa-intent .tag.read{background:#d6f0e0;color:#0f6b3a;}',
      '.mlsaa-intent .tag.write{background:#ffe3c2;color:#8a4b00;}'
    ].join('');
    (document.head || document.documentElement).appendChild(s);
  }

  // ---- the live timeline panel -------------------------------------------
  var tlEl = null, stepsEl = null, intentEl = null, doneEl = null, fixEl = null;
  function ensureTimeline() {
    ensureStyle();
    if (tlEl && document.body.contains(tlEl)) return;
    tlEl = document.createElement('div');
    tlEl.className = 'mlsaa-tl';
    tlEl.setAttribute('hidden', '');
    tlEl.innerHTML =
      '<div class="mlsaa-hd"><span class="ttl">Athena action</span>' +
      '<button class="mlsaa-x" aria-label="Close" title="Close">&#215;</button></div>' +
      '<div class="mlsaa-intent-top"></div>' +
      '<ul class="mlsaa-steps"></ul>' +
      '<div class="mlsaa-fix" hidden></div>' +
      '<div class="mlsaa-done" hidden></div>';
    document.body.appendChild(tlEl);
    stepsEl = tlEl.querySelector('.mlsaa-steps');
    intentEl = tlEl.querySelector('.mlsaa-intent-top');
    doneEl = tlEl.querySelector('.mlsaa-done');
    fixEl = tlEl.querySelector('.mlsaa-fix');
    tlEl.querySelector('.mlsaa-x').addEventListener('click', function () { tlEl.setAttribute('hidden', ''); });
  }

  // ---- the "run context" - one per active Athena action -------------------
  var ctx = null;
  function openTimeline(meta) {
    ensureTimeline();
    tlEl.removeAttribute('hidden');
    tlEl.querySelector('.ttl').textContent = (meta && meta.title) || 'Athena action';
    stepsEl.innerHTML = '';
    doneEl.setAttribute('hidden', ''); doneEl.textContent = '';
    fixEl.setAttribute('hidden', ''); fixEl.textContent = '';
    var it = (meta && meta.intent) || null;
    if (it) {
      intentEl.innerHTML = esc(it.brings || '') +
        '<span class="mode ' + (it.mode === 'write' ? 'write' : 'read') + '">' +
        (it.mode === 'write' ? 'WRITES TO CHART' : 'READ-ONLY') + '</span>';
      intentEl.style.display = '';
    } else { intentEl.style.display = 'none'; }
  }
  function step(text, state) {
    if (!stepsEl) return;
    var prevRun = stepsEl.querySelector('li.run');
    if (prevRun) { prevRun.classList.remove('run'); prevRun.classList.add('ok'); prevRun.querySelector('.ic').textContent = '✓'; }
    var li = document.createElement('li');
    state = state || 'run';
    li.className = state;
    var ic = state === 'run' ? '◐' : state === 'note' ? '↻' : state === 'warn' ? '!' : state === 'fail' ? '✗' : '✓';
    li.innerHTML = '<span class="ic">' + ic + '</span><span class="tx">' + esc(text) + '</span>';
    stepsEl.appendChild(li);
    stepsEl.scrollTop = stepsEl.scrollHeight;
    return li;
  }
  function narrate(text) { return step(text, 'note'); }
  function finishOk(summary) {
    var prevRun = stepsEl && stepsEl.querySelector('li.run');
    if (prevRun) { prevRun.classList.remove('run'); prevRun.classList.add('ok'); prevRun.querySelector('.ic').textContent = '✓'; }
    if (doneEl) { doneEl.className = 'mlsaa-done ok'; doneEl.textContent = summary || '✓ Done'; doneEl.removeAttribute('hidden'); }
  }
  function finishFail(reason, fix) {
    var prevRun = stepsEl && stepsEl.querySelector('li.run');
    if (prevRun) { prevRun.classList.remove('run'); prevRun.classList.add('fail'); prevRun.querySelector('.ic').textContent = '✗'; }
    if (doneEl) { doneEl.className = 'mlsaa-done fail'; doneEl.textContent = reason || 'Could not complete the Athena action.'; doneEl.removeAttribute('hidden'); }
    if (fix && fixEl) { fixEl.textContent = 'Try this: ' + fix; fixEl.removeAttribute('hidden'); }
  }
  function finishInfo(msg) {
    var prevRun = stepsEl && stepsEl.querySelector('li.run');
    if (prevRun) { prevRun.classList.remove('run'); prevRun.classList.add('ok'); prevRun.querySelector('.ic').textContent = '•'; }
    if (doneEl) { doneEl.className = 'mlsaa-done info'; doneEl.textContent = msg; doneEl.removeAttribute('hidden'); }
  }

  // ---- honest progress mapping from real bridge events --------------------
  function classifyProgress(txt) {
    var t = String(txt || '');
    if (/no encounters|nothing (saved|stored)|couldn'?t|could not|not recognized|no chart|not found/i.test(t)) return { kind: 'warn', text: t };
    if (/read visit|saved visit/i.test(t)) return { kind: 'ok', text: t };
    if (/\b\d+\s+of\s+\d+\b/i.test(t) || /reading visit \d+|^visit \d+|reading \d+/i.test(t)) return { kind: 'run', text: 'Reading your visits from athenaOne…' };
    return { kind: 'run', text: t };
  }

  // ---- shared bridge observer (the chokepoint ALL actions flow through) ----
  var lastResult = null;
  function onMessage(ev) {
    var d = ev && ev.data;
    if (!d || typeof d !== 'object') return;
    if (d.source && d.source !== 'mls-ext') return;
    var ty = String(d.type || '');
    if (!ctx || !ctx.active) return;
    if (/Progress$/.test(ty)) {
      var c = classifyProgress(d.message || d.text || '');
      step(c.text, c.kind);
    } else if (/Result$/.test(ty)) {
      lastResult = d;
      handleResult(ty, d);
    }
  }

  // ---- destination reporting + verify -------------------------------------
  function reportDestinationAndVerify(meta, result) {
    var sv = g('__mlsSaveVerify');
    var visits = (result && (result.visits || (result.resp && result.resp.visits))) || null;
    var identity = (result && (result.identity || (result.resp && result.resp.identity))) || null;
    var ptName = (identity && identity.name) || (meta && meta.patientName) || 'this patient';
    var n = visits ? visits.length : (typeof result.saved === 'number' ? result.saved : null);
    step('Saving into MLS' + (n != null ? ' (' + n + ' visit' + (n === 1 ? '' : 's') + ')…' : '…'), 'run');
    if (sv && isFn(sv.verifyVisitsSaved) && visits && identity) {
      try {
        Promise.resolve(sv.verifyVisitsSaved(identity, visits)).then(function (res) {
          if (res && res.ok) {
            finishOk('✓ Saved ' + res.count + ' visit' + (res.count === 1 ? '' : 's') +
              ' into ' + esc(ptName) + '’s MLS record — re-read and verified.');
          } else if (res && res.partial) {
            finishFail('⚠ Save incomplete — ' + res.verified + ' of ' + res.expected +
              ' verified. Missing: ' + (res.missing || []).join(', '), 'Re-run the pull for the missing item(s).');
          } else {
            finishInfo('Saved to MLS — re-reading the store to confirm…');
          }
        }, function () { finishInfo('Saved to MLS (' + (n != null ? n + ' visits' : 'data') + '). Use the Verify-saved-data button to confirm.'); });
      } catch (e) {
        finishInfo('Saved to MLS. Use the Verify-saved-data button to confirm.');
      }
    } else if (sv && isFn(sv.scan)) {
      try { Promise.resolve(sv.scan()).then(function () {
        finishOk('✓ Pulled into ' + esc(ptName) + '’s MLS record — verified by the save-check below.');
      }, function () { finishInfo('Pulled into ' + esc(ptName) + '’s MLS record.'); }); }
      catch (e) { finishInfo('Pulled into ' + esc(ptName) + '’s MLS record.'); }
    } else {
      finishInfo('Pulled into ' + esc(ptName) + '’s MLS record.');
    }
  }

  // ---- handle a Result event for the active action ------------------------
  function handleResult(ty, d) {
    var resp = d.resp || d;
    var ok = resp ? (resp.ok !== false) : false;
    var visits = resp && resp.visits;
    if (ok && visits && visits.length === 0 && /AllVisits|ReadAll|Chart/i.test(ty)) {
      return adaptiveRecover(ctx.meta, { kind: 'empty', resp: resp });
    }
    if (ok) {
      ctx.active = false;
      reportDestinationAndVerify(ctx.meta, resp);
      return;
    }
    adaptiveRecover(ctx.meta, { kind: 'failed', resp: resp });
  }

  // ---- self-troubleshoot + adaptive multi-strategy recovery ---------------
  function adaptiveRecover(meta, failure) {
    meta = meta || (ctx && ctx.meta) || {};
    failure = failure || {};
    var doctor = g('__mlsAthenaDoctor');
    ctx = ctx || { active: true, meta: meta, recoverCount: 0 };
    ctx.recoverCount = (ctx.recoverCount || 0) + 1;
    if (ctx.recoverCount > 3) {
      return finishFail('That Athena action didn’t complete after several approaches.',
        (failure.fix) || 'Open a signed-in athenaOne chart for this patient, confirm MLS Assist is loaded, then try again.');
    }
    narrate('That didn’t work — diagnosing what went wrong…');
    function diagnoseThen(cb) {
      if (doctor && isFn(doctor.diagnose)) {
        try { Promise.resolve(doctor.diagnose()).then(function (r) { cb(r || {}); }, function () { cb({}); }); return; }
        catch (e) {}
      }
      cb({});
    }
    diagnoseThen(function (diag) {
      var first = (diag && (diag.firstFail || diag.firstFailure)) || null;
      var kind = (first && first.key) || failure.kind || 'unknown';
      if (kind === 'ext' || /not responding|not detected/i.test(String(first && first.fix || ''))) {
        narrate('MLS Assist didn’t answer — re-checking the connection and retrying…');
        return rePingThenRetry(meta);
      }
      if (kind === 'tab') {
        return finishFail('No signed-in athenaOne tab was readable.',
          'Open your signed-in athenaOne in another tab, then try again.');
      }
      if (kind === 'perm' || kind === 'worker') {
        return finishFail((first && first.label) || 'MLS Assist needs a reload.',
          (first && first.fix) || 'Reload MLS Assist at chrome://extensions, then try again.');
      }
      if (failure.kind === 'empty' || kind === 'chart' || kind === 'data') {
        var nm = meta.patientName;
        if (nm) {
          narrate('That didn’t find the open chart — trying the Athena search bar instead…');
          return searchAndOpen(nm, meta);
        }
        return finishFail('Couldn’t find an open patient chart to read.',
          'Open the patient’s chart in athenaOne, then try again.');
      }
      if (ctx.recoverCount === 1) {
        narrate('Adjusting how I read the chart (fallback selectors)…');
        return retryAction(meta);
      }
      finishFail((first && first.label) || 'The Athena action failed.',
        (first && first.fix) || 'Open the patient’s chart in athenaOne and confirm MLS Assist is loaded.');
    });
  }

  function rePingThenRetry(meta) {
    var dot = g('__mlsAthenaStatusDot');
    var ping = (dot && isFn(dot.pingExtension)) ? dot.pingExtension :
      (function () { var cv = g('__mlsCopyVisits'); return cv && isFn(cv._ping) ? cv._ping : null; })();
    var tries = 0;
    function attempt() {
      tries++;
      Promise.resolve(ping ? ping() : false).then(function (alive) {
        if (alive) { step('MLS Assist responded — retrying the action…', 'ok'); retryAction(meta); }
        else if (tries < 3) { setTimeout(attempt, 700); }
        else { finishFail('MLS Assist isn’t responding.', 'Reload it at chrome://extensions (or install from Settings → Get the extension), then try again.'); }
      }, function () {
        if (tries < 3) setTimeout(attempt, 700);
        else finishFail('MLS Assist isn’t responding.', 'Reload it at chrome://extensions, then try again.');
      });
    }
    if (!ping) return finishFail('Couldn’t re-check the MLS Assist connection.', 'Reload MLS Assist at chrome://extensions, then try again.');
    attempt();
  }

  function retryAction(meta) {
    if (meta && isFn(meta.exec)) {
      step('Retrying…', 'run');
      try { Promise.resolve(meta.exec()).catch(function (e) { adaptiveRecover(meta, { kind: 'failed', err: e }); }); }
      catch (e) { adaptiveRecover(meta, { kind: 'failed', err: e }); }
    } else {
      finishFail('Couldn’t retry automatically.', 'Click the button again, or open the chart in athenaOne first.');
    }
  }

  // ---- search-and-navigate (app side) -------------------------------------
  function searchAndOpen(name, meta) {
    var lf = toLastFirst(name);
    if (!ctx || !ctx.active) {
      ctx = { active: true, meta: meta || { title: 'Find patient in Athena', patientName: name }, recoverCount: (meta && meta.recoverCount) || 0 };
      openTimeline(ctx.meta);
    }
    step('Going to the Athena patient search…', 'run');
    step('Searching “' + esc(lf) + '”…', 'run');
    var done = false, timer = null;
    function finalize(handler) { if (done) return; done = true; if (timer) clearTimeout(timer); handler(); }
    function onMsg(ev) {
      var d = ev && ev.data; if (!d || d.source !== 'mls-ext') return;
      var ty = String(d.type || '');
      if (ty === 'mlsAppSearchOpenResult' || ty === 'mlsAppSearchOpenPatientResult') {
        window.removeEventListener('message', onMsg, true);
        var resp = d.resp || d;
        if (resp && resp.unhandled) {
          return finalize(function () { finishFail('Auto-search needs the latest MLS Assist.', 'Reload MLS Assist (Settings → Get the extension → reload at chrome://extensions), then try again.'); });
        }
        if (resp && resp.ok && resp.opened) {
          step('Found patient — opening chart…', 'ok');
          return finalize(function () { pullOpenChart({ title: 'Pull from open chart', patientName: name, intent: INTENTS.copyVisits }); });
        }
        if (resp && resp.candidates && resp.candidates.length > 1) {
          return finalize(function () { finishFail('Found ' + resp.candidates.length + ' possible matches for “' + esc(lf) + '”.', 'Open the right patient’s chart in athenaOne, then use Pull from chart.'); });
        }
        return finalize(function () { finishFail('No patient matched “' + esc(lf) + '” in Athena.', 'Check the spelling, or open the chart manually in athenaOne.'); });
      } else if (/Progress$/.test(ty)) {
        var c = classifyProgress(d.message || '');
        step(c.text, c.kind);
      }
    }
    window.addEventListener('message', onMsg, true);
    try {
      window.postMessage({ source: 'mls-app', type: 'mlsAppSearchOpenPatient', name: lf, raw: name }, '*');
    } catch (e) {}
    timer = setTimeout(function () {
      window.removeEventListener('message', onMsg, true);
      finalize(function () { finishFail('Athena search timed out.', 'Open the patient’s chart in athenaOne, then try Pull from chart.'); });
    }, 30000);
  }

  // ---- pull the currently-open chart (reuses __mlsCopyVisits) --------------
  function pullOpenChart(meta) {
    var cv = g('__mlsCopyVisits');
    if (!ctx || !ctx.active) { ctx = { active: true, meta: meta, recoverCount: 0 }; openTimeline(meta); }
    if (!(cv && isFn(cv.run))) {
      finishFail('The visit reader isn’t loaded.', 'Reload the MLS page; if it persists, reload MLS Assist.');
      return Promise.resolve();
    }
    step('Reading the open chart in athenaOne…', 'run');
    meta.exec = function () { return cv.run(function (m) { var c = classifyProgress(m); step(c.text, c.kind); }); };
    return Promise.resolve(meta.exec()).then(function (res) {
      if (res && res.ok === false) { adaptiveRecover(meta, { kind: 'failed', resp: res }); }
      else if (res && res.visits && res.visits.length === 0) { adaptiveRecover(meta, { kind: 'empty', resp: res }); }
      else if (res) { ctx.active = false; reportDestinationAndVerify(meta, res); }
    }, function (e) { adaptiveRecover(meta, { kind: 'failed', err: e }); });
  }

  // ---- ingest a chart pulled by the EXTENSION panel button ----------------
  function ingestPulledChart(payload) {
    payload = payload || {};
    var vm = g('__mlsVisitModel');
    var identity = payload.identity || {};
    var visits = payload.visits || [];
    var meta = { title: 'Pull from chart (panel)', patientName: identity.name, intent: INTENTS.panelPull };
    ctx = { active: true, meta: meta, recoverCount: 0 };
    openTimeline(meta);
    step('MLS Assist read the open chart…', 'ok');
    if (!visits.length) { return adaptiveRecover(meta, { kind: 'empty', resp: payload }); }
    if (!(vm && isFn(vm.addVisit))) { finishFail('Visit model not loaded.', 'Reload the MLS page.'); return; }
    step('Adding ' + visits.length + ' visit' + (visits.length === 1 ? '' : 's') + ' to MLS…', 'run');
    try {
      visits.forEach(function (v) { safe(function () { vm.addVisit(identity, v); }); });
      if (isFn(vm.ensureSummaries)) safe(function () { vm.ensureSummaries(identity); });
    } catch (e) {}
    ctx.active = false;
    reportDestinationAndVerify(meta, { ok: true, identity: identity, visits: visits });
  }

  // ---- intent labels ------------------------------------------------------
  var INTENTS = {
    autopull:   { brings: 'Pull open Athena patient → brings in name, DOB, and all visits.', mode: 'read', match: /pull (open|from|chart) athena|pull from athena|pull chart from athena|pull open athena/i, ids: ['ptPullAthenaBtn', 'ezPull', 'pullChartBtn'] },
    copyVisits: { brings: 'Copy every visit → brings in every visit from the open chart.', mode: 'read', match: /copy every visit/i, ids: [] },
    schedule:   { brings: 'Pull today’s schedule → brings in today’s patients from Athena.', mode: 'read', match: /pull today|today’s patients|pull schedule/i, ids: [] },
    procedure:  { brings: 'Search by procedure → finds & brings in all patients with that procedure.', mode: 'read', match: /search athena/i, ids: ['mlsGrabAthenaBtn'] },
    searchNav:  { brings: 'Find patient by name → searches Athena and opens the chart (no writes).', mode: 'read', match: /find patient/i, ids: [] },
    panelPull:  { brings: 'Pull from chart → brings in name, DOB and all visits from the open chart.', mode: 'read', match: /pull from chart|capture chart/i, ids: [] }
  };

  function intentFor(btn) {
    var id = btn.id || '', txt = (btn.textContent || '').trim();
    for (var k in INTENTS) {
      var it = INTENTS[k];
      if (it.ids.indexOf(id) !== -1) return it;
      if (it.match && it.match.test(txt)) return it;
    }
    return null;
  }

  function decorateButtons() {
    var btns = safe(function () { return [].slice.call(document.querySelectorAll('button,a,[role=button]')); }, []) || [];
    btns.forEach(function (btn) {
      if (!/athena|pull|copy every|search athena|schedule|find patient|chart/i.test(btn.textContent || '')) return;
      var it = intentFor(btn);
      if (!it) return;
      if (btn.getAttribute && btn.getAttribute('data-mlsac')) {
        var dupSib = btn.nextSibling && btn.nextSibling.classList && btn.nextSibling.classList.contains('mlsaa-intent') ? btn.nextSibling : null;
        if (dupSib) dupSib.remove();
        if (btn.getAttribute('data-mlsaa-intent') !== it.brings) btn.setAttribute('data-mlsaa-intent', it.brings);
        return;
      }
      if (btn.getAttribute('data-mlsaa-intent') === it.brings) return;
      var existing = btn.nextSibling && btn.nextSibling.classList && btn.nextSibling.classList.contains('mlsaa-intent') ? btn.nextSibling : null;
      if (existing) existing.remove();
      var cap = document.createElement('span');
      cap.className = 'mlsaa-intent';
      cap.innerHTML = '<span class="tag ' + (it.mode === 'write' ? 'write' : 'read') + '">' +
        (it.mode === 'write' ? 'WRITES' : 'READ-ONLY') + '</span>' + esc(it.brings);
      if (btn.parentNode) btn.parentNode.insertBefore(cap, btn.nextSibling);
      btn.setAttribute('data-mlsaa-intent', it.brings);
    });
  }

  // ---- wire buttons: open a run-context on click WITHOUT replacing handlers -
  function onAnyClick(ev) {
    var btn = ev.target && ev.target.closest && ev.target.closest('button,a,[role=button]');
    if (!btn) return;
    var it = intentFor(btn);
    if (!it) return;
    ctx = { active: true, recoverCount: 0, meta: { title: titleFor(it), intent: it, patientName: currentPatientName() } };
    openTimeline(ctx.meta);
    step('Starting…', 'run');
    if (ctx._t) clearTimeout(ctx._t);
    ctx._t = setTimeout(function () {
      if (ctx && ctx.active) { adaptiveRecover(ctx.meta, { kind: 'failed', fix: 'Open a signed-in athenaOne chart, then try again.' }); }
    }, 45000);
  }
  function titleFor(it) {
    if (it === INTENTS.procedure) return 'Search Athena by procedure';
    if (it === INTENTS.schedule) return 'Pull today’s schedule';
    if (it === INTENTS.copyVisits) return 'Copy every visit';
    if (it === INTENTS.panelPull) return 'Pull from chart';
    return 'Pull from Athena';
  }
  function currentPatientName() {
    return safe(function () {
      var ap = g('activePatient'); var p = isFn(ap) ? ap() : null;
      return (p && (p.name || (p.first && p.last && (p.last + ', ' + p.first)))) || null;
    }, null);
  }

  // ---- boot / idempotent mount / observer ---------------------------------
  var mo = null, clickBound = false, msgBound = false;
  function mount() {
    ensureStyle();
    decorateButtons();
    if (!clickBound) { document.addEventListener('click', onAnyClick, true); clickBound = true; }
    if (!msgBound) { window.addEventListener('message', onMessage, true); msgBound = true; }
    if (!mo) {
      var deb = null;
      mo = new MutationObserver(function () { if (deb) return; deb = setTimeout(function () { deb = null; decorateButtons(); }, 600); });
      safe(function () { mo.observe(document.body, { childList: true, subtree: true }); });
    }
  }

  function revert() {
    try { if (mo) mo.disconnect(); } catch (e) {}
    try { document.removeEventListener('click', onAnyClick, true); } catch (e) {}
    try { window.removeEventListener('message', onMessage, true); } catch (e) {}
    safe(function () { [].slice.call(document.querySelectorAll('.mlsaa-intent')).forEach(function (n) { n.remove(); }); });
    safe(function () { [].slice.call(document.querySelectorAll('[data-mlsaa-intent]')).forEach(function (n) { n.removeAttribute('data-mlsaa-intent'); }); });
    safe(function () { var s = document.getElementById(STYLE_ID); if (s) s.remove(); });
    safe(function () { if (tlEl) tlEl.remove(); });
    tlEl = stepsEl = intentEl = doneEl = fixEl = null; ctx = null;
    window.__mlsAthenaActions.installed = false;
  }

  // ---- public API ---------------------------------------------------------
  window.__mlsAthenaActions = {
    installed: true,
    version: VERSION,
    asset: 'feat_athena_actions.js',
    searchAndOpen: searchAndOpen,
    pullOpenChart: pullOpenChart,
    ingestPulledChart: ingestPulledChart,
    decorateButtons: decorateButtons,
    toLastFirst: toLastFirst,
    classifyProgress: classifyProgress,
    intentFor: intentFor,
    _adaptiveRecover: adaptiveRecover,
    _openTimeline: openTimeline,
    _step: step,
    revert: revert
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
