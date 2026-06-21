/* feat_athena_selfheal.js  —  window.__mlsAthenaSelfHeal  (v1.0.0)
 *
 * AI-driven ACTIVE self-recovery with plain-English narration.
 *
 * When an Athena READ/pull action fails, MLS Assistant doesn't just show an
 * error — it actively tries to fix the problem itself and TELLS the user what
 * it is doing, step by step:
 *     "🤖 Trying to fix this myself…"
 *     "Looking for a signed-in athenaOne tab…"
 *     "Searching Athena for the patient and opening the chart…"
 *     "Re-checking everything…"
 *     "✅ Fixed it — athenaOne is responding again."   (real success only)
 * On exhausting safe attempts it states an HONEST failure + the single user fix.
 *
 * It reuses the backend autopilot reasoning brain (POST /api/copilot, the same
 * endpoint the in-app Copilot uses) to DECIDE the next recovery action, and the
 * §59 doctor (window.__mlsAthenaDoctor) + §61 shared module
 * (window.__mlsAthenaActions) to DIAGNOSE, narrate, and execute.
 *
 * HARD SAFETY: every executed action is validated against a fixed read-only /
 * navigation allow-list (reping, reprobe, searchOpen, repull, recheck). It can
 * NEVER write, paste, save, sign, push or attest a chart — those words are an
 * explicit deny-list, and recovery is NEVER auto-triggered on a write/paste
 * result. It never fabricates a fix: success is declared only when a previously
 * failing real probe actually passes.
 *
 * Additive, own IIFE, all in try/catch, idempotent, reversible via revert().
 * Reads only non-PHI result metadata (ok/count); never reads chart/visit text.
 */
(function () {
  'use strict';
  var VERSION = '1.0.0';
  if (window.__mlsAthenaSelfHeal && window.__mlsAthenaSelfHeal.installed) return;

  var MAX_ATTEMPTS = 4;
  var ACTION_TIMEOUT = 12000;
  var listeners = [];
  var running = false;
  var lastTrigger = 0;

  function safe(fn) { try { return fn(); } catch (e) { return undefined; } }
  function isFn(f) { return typeof f === 'function'; }
  function A() { return window.__mlsAthenaActions; }
  function D() { return window.__mlsAthenaDoctor; }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function withTimeout(p, ms) {
    return Promise.race([
      Promise.resolve().then(function () { return p; }),
      new Promise(function (_, rej) { setTimeout(function () { rej(new Error('timeout')); }, ms); })
    ]);
  }

  /* ---------- the SAFE recovery action allow-list (read-only / navigation) ---------- */
  // Each: say (plain-English narration) + run() -> Promise. NOTHING here writes a chart.
  var SAFE_ACTIONS = {
    reping: {
      say: 'Checking that MLS Assist is awake…',
      run: function () { var d = D(); return (d && isFn(d.pingExtension)) ? d.pingExtension() : Promise.resolve(false); }
    },
    reprobe: {
      say: 'Looking for a signed-in athenaOne tab…',
      run: function () { var d = D(); return (d && isFn(d.scheduleProbe)) ? d.scheduleProbe() : Promise.resolve(null); }
    },
    searchOpen: {
      say: 'Searching Athena for the patient and opening the chart…',
      run: function () {
        var a = A(); var name = patientName();
        if (a && isFn(a.searchAndOpen) && name) return a.searchAndOpen(name);
        return Promise.resolve(null);
      }
    },
    repull: {
      say: 'Re-reading the open chart…',
      run: function () {
        var a = A();
        if (a && isFn(a.pullOpenChart)) return a.pullOpenChart();
        var cv = window.__mlsCopyVisits;
        if (cv && isFn(cv.run)) return cv.run();
        return Promise.resolve(null);
      }
    },
    recheck: {
      say: 'Re-checking everything…',
      run: function () { var d = D(); return (d && isFn(d.diagnose)) ? d.diagnose() : Promise.resolve(null); }
    },
    done: { say: '', run: function () { return Promise.resolve(true); } }
  };
  // Anything that could change a chart is explicitly forbidden, even if the AI asks for it.
  var DENY = /write|paste|save|sign|push|attest|submit|delete|purge|finalize/i;

  function patientName() {
    return safe(function () {
      if (window.__mlsAthenaClarity && isFn(window.__mlsAthenaClarity.currentPatientName)) {
        return window.__mlsAthenaClarity.currentPatientName();
      }
      var ap = (typeof activePatient === 'function') ? activePatient() : null;
      if (!ap) return null;
      return ap.name || ap.fullName || ((ap.first || '') + ' ' + (ap.last || '')).trim() || null;
    }) || null;
  }

  /* ---------- narration: prefer the §61 timeline, fall back to a toast ---------- */
  function narrate(text, state) {
    var a = A();
    if (a && isFn(a._openTimeline) && isFn(a._step)) {
      safe(function () {
        if (!narrate._opened) {
          a._openTimeline({ title: '🤖 MLS Assistant — fixing Athena', intent: { brings: 'Read-only recovery — never writes or signs', mode: 'read' } });
          narrate._opened = true;
        }
        a._step(text, state || 'run');
      });
      return;
    }
    toast(text, state);
  }
  function toast(text, state) {
    safe(function () {
      ensureStyle();
      var el = document.querySelector('.mlssh-toast') || document.createElement('div');
      el.className = 'mlssh-toast' + (state === 'fail' ? ' fail' : state === 'done' ? ' done' : '');
      el.textContent = text;
      if (!el.parentNode) document.body.appendChild(el);
    });
  }
  function ensureStyle() {
    if (document.getElementById('mlssh-style')) return;
    var s = document.createElement('style'); s.id = 'mlssh-style';
    s.textContent = '.mlssh-toast{position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:2147483601;' +
      'max-width:560px;padding:11px 16px;border-radius:10px;font-size:13px;font-weight:600;background:#0f2233;' +
      'color:#fff;box-shadow:0 8px 24px rgba(0,0,0,.22);} .mlssh-toast.done{background:#14532d;}' +
      '.mlssh-toast.fail{background:#7c2d12;}';
    (document.head || document.documentElement).appendChild(s);
  }
  function clearNarration() { narrate._opened = false; safe(function () { var t = document.querySelector('.mlssh-toast'); if (t) t.remove(); }); }

  /* ---------- diagnosis (non-PHI text only) ---------- */
  function getDiagnosis() {
    var d = D();
    if (!d || !isFn(d.diagnose)) return Promise.resolve({ failedStep: null, fix: null, extOk: null, athenaOk: null });
    return Promise.resolve(safe(function () { return d.diagnose(); })).then(function (res) {
      return summarizeDiag(res);
    }).catch(function () { return { failedStep: null, fix: null, extOk: null, athenaOk: null }; });
  }
  function summarizeDiag(res) {
    // diagnose() returns a chain summary; extract only non-PHI step/fix text.
    var out = { failedStep: null, fix: null, extOk: null, athenaOk: null, raw: null };
    safe(function () {
      var steps = (res && (res.steps || res.chain)) || [];
      for (var i = 0; i < steps.length; i++) {
        var st = steps[i];
        var label = String(st.label || st.name || st.id || '').toLowerCase();
        var ok = (st.state === 'pass' || st.ok === true);
        if (/extension|assist|responding/.test(label)) out.extOk = ok;
        if (/athena|tab|signed/.test(label)) out.athenaOk = ok;
        if (!ok && !out.failedStep && (st.state === 'fail' || st.ok === false)) {
          out.failedStep = String(st.label || st.name || st.id || 'a step');
          out.fix = String(st.fix || st.advice || '');
        }
      }
      out.fix = out.fix || (res && (res.fix || res.advice)) || '';
      out.failedStep = out.failedStep || (res && res.firstFail) || null;
    });
    return out;
  }

  /* ---------- the AI brain picks the next safe action ---------- */
  function deterministicPick(diag) {
    if (diag.extOk === false) return 'reping';
    if (diag.athenaOk === false) return 'reprobe';
    if (patientName()) return 'searchOpen';
    return 'repull';
  }
  function aiPick(diag) {
    var base = safe(function () { return (typeof bkBase === 'function') ? bkBase() : null; });
    var tok = safe(function () { return localStorage.getItem('sf_bk_token'); });
    var det = deterministicPick(diag);
    if (!base || !tok) return Promise.resolve(det);
    var q = 'You are MLS Assistant recovering a failed athenaOne READ. ' +
      'Diagnosis: failedStep="' + (diag.failedStep || 'unknown') + '", extensionResponding=' + diag.extOk +
      ', athenaTabOpen=' + diag.athenaOk + ', patientActive=' + !!patientName() + '. ' +
      'Choose the SINGLE best next SAFE step. Reply with ONLY one word from this list and nothing else: ' +
      'reping, reprobe, searchOpen, repull, recheck, done. ' +
      'Never choose anything that writes/saves/signs a chart (not allowed).';
    return withTimeout(fetch(base + '/api/copilot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tok },
      body: JSON.stringify({ question: q, strong: true })
    }).then(function (r) { return r.json(); }).then(function (j) {
      var reply = String((j && j.reply) || '').toLowerCase();
      var m = reply.match(/reping|reprobe|searchopen|search open|repull|recheck|done/);
      var word = m ? m[0].replace(' ', '') : null;
      if (word === 'searchopen') word = 'searchOpen';
      // validate against allow-list + deny-list (defense in depth)
      if (!word || DENY.test(reply) || !SAFE_ACTIONS[word]) return det;
      return word;
    }), 9000).catch(function () { return det; });
  }

  /* ---------- health check: did the previously-failing probe now pass? ---------- */
  function checkHealth() {
    var d = D();
    if (!d) return Promise.resolve({ extOk: null, athenaOk: null, healthy: false });
    var pExt = (isFn(d.pingExtension)) ? Promise.resolve(safe(function () { return d.pingExtension(); })).catch(function () { return false; }) : Promise.resolve(null);
    var pAth = (isFn(d.scheduleProbe)) ? Promise.resolve(safe(function () { return d.scheduleProbe(); })).catch(function () { return null; }) : Promise.resolve(null);
    return Promise.all([pExt, pAth]).then(function (r) {
      var extOk = !!r[0];
      var athResp = r[1];
      var athenaOk = !!(athResp && (athResp.ok === true || athResp === true));
      return { extOk: extOk, athenaOk: athenaOk, healthy: extOk && athenaOk };
    });
  }

  function executeAction(name) {
    var spec = SAFE_ACTIONS[name];
    if (!spec || DENY.test(name)) return Promise.resolve({ ran: false });   // never run a forbidden action
    return withTimeout(Promise.resolve(safe(function () { return spec.run(); })), ACTION_TIMEOUT)
      .then(function (v) { return { ran: true, value: v }; })
      .catch(function () { return { ran: true, value: null, timedOut: true }; });
  }

  /* ---------- the active-recovery loop ---------- */
  function attemptRecovery(opts) {
    opts = opts || {};
    if (running) return Promise.resolve({ fixed: false, busy: true });
    running = true;
    clearNarration();
    narrate('🤖 Something went wrong with Athena. Trying to fix it myself…', 'run');
    var attempts = [];
    var i = 0;
    function loop() {
      if (i >= MAX_ATTEMPTS) return finishFail();
      i++;
      return getDiagnosis().then(function (diag) {
        return aiPick(diag).then(function (action) {
          attempts.push(action);
          if (action === 'done') return finishCheck(true);
          narrate(SAFE_ACTIONS[action] ? SAFE_ACTIONS[action].say : ('Trying ' + action + '…'), 'note');
          return executeAction(action).then(function (r) {
            return sleep(600).then(checkHealth).then(function (h) {
              if (h.healthy) {
                narrate('✅ Fixed it — athenaOne is responding again. You can run that action now.', 'done');
                running = false;
                return { fixed: true, attempts: attempts, action: action };
              }
              return loop();
            });
          });
        });
      }).catch(function () { return loop(); });
    }
    function finishCheck(viaDone) {
      return checkHealth().then(function (h) {
        if (h.healthy) {
          narrate('✅ Fixed it — athenaOne is responding again.', 'done');
          running = false;
          return { fixed: true, attempts: attempts };
        }
        return finishFail();
      });
    }
    function finishFail() {
      return getDiagnosis().then(function (diag) {
        var fix = (diag && diag.fix) ? diag.fix
          : (diag && diag.athenaOk === false) ? 'Open a signed-in athenaOne tab in this browser, then try again.'
          : (diag && diag.extOk === false) ? 'Reload MLS Assist at chrome://extensions, then try again.'
          : 'Open the patient’s chart in a signed-in athenaOne tab, then try again.';
        narrate('⚠ I couldn’t fix this automatically after ' + i + ' tries. One fix should do it: ' + fix, 'fail');
        running = false;
        return { fixed: false, attempts: attempts, fix: fix };
      });
    }
    return loop().catch(function (e) { running = false; return { fixed: false, error: String(e) }; });
  }

  /* ---------- auto-trigger on a failed READ result (never on a write/paste) ---------- */
  function onMessage(ev) {
    safe(function () {
      var d = ev && ev.data;
      if (!d || d.source !== 'mls-ext') return;
      var type = String(d.type || '');
      if (!/Result$/.test(type)) return;
      if (/Paste|Push|Sign|Write|Save/i.test(type)) return;   // NEVER auto-recover a chart write
      var doc = D();
      var meta = (doc && isFn(doc.resultMeta)) ? safe(function () { return doc.resultMeta(d.resp || d); }) : null;
      if (!meta || meta.ok !== false) return;                 // only act on a genuine failure
      if (running) return;
      if (Date.now() - lastTrigger < 8000) return;            // debounce bursts
      lastTrigger = Date.now();
      setTimeout(function () { safe(function () { attemptRecovery({ trigger: type }); }); }, 400);
    });
  }

  function mount() {
    window.addEventListener('message', onMessage, false);
    listeners.push(['message', onMessage]);
  }
  function revert() {
    listeners.forEach(function (l) { safe(function () { window.removeEventListener(l[0], l[1], false); }); });
    listeners = [];
    running = false;
    clearNarration();
    safe(function () { var s = document.getElementById('mlssh-style'); if (s) s.remove(); });
    window.__mlsAthenaSelfHeal.installed = false;
  }

  window.__mlsAthenaSelfHeal = {
    installed: true,
    version: VERSION,
    asset: 'feat_athena_selfheal.js',
    SAFE_ACTIONS: SAFE_ACTIONS,
    DENY: DENY,
    attemptRecovery: attemptRecovery,
    _aiPick: aiPick,
    _deterministicPick: deterministicPick,
    _executeAction: executeAction,
    _summarizeDiag: summarizeDiag,
    _checkHealth: checkHealth,
    _onMessage: onMessage,
    narrate: narrate,
    revert: revert
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { safe(mount); }, { once: true });
  } else {
    safe(mount);
  }
})();
