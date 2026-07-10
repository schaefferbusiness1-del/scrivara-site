/* ============================================================================
 * feat_mls_copilot_actions.js  ->  window.__mlsCopilotActions   (ca-1.0.0)
 * ---------------------------------------------------------------------------
 * MAKES THE MLS ASSISTANT / COPILOT MORE CAPABLE, WITHOUT TOUCHING THE BACKEND.
 *
 * server.js's POST /api/copilot ALREADY returns { ok, reply, actions[], followups[],
 * artifact } (actions: {label, kind:'openPatient'|'startVisit'|'navigate'|'build', arg},
 * followups: string[], artifact: {kind,title,content,to,subject}) -- but the live
 * frontend pipeline (feat_mls_asst_fix.js -> aiAsk()) only reads `d.reply` and
 * silently drops actions/followups/artifact. This module recovers them and turns
 * them into REAL, clickable affordances in the SAME assistant thread, without
 * modifying feat_mls_asst_fix.js or the chat pipeline it owns.
 *
 * HOW (non-invasive):
 *   1. Wrap window.fetch, narrowly: only requests whose URL ends with
 *      "/api/copilot" (not /api/copilot/edit or /api/copilot/email) are peeked
 *      at, via response.clone().json() -- the ORIGINAL Response is returned
 *      untouched to whatever called fetch (feat_mls_asst_fix.js's aiAsk), so
 *      that pipeline is completely unaffected. Every other fetch passes through
 *      with zero overhead.
 *   2. After the peeked reply lands, poll briefly for the assistant thread
 *      (#mlsAsstPanel .as-thread) to render the new AI bubble (aiAsk() appends
 *      it asynchronously), then append ONE "smart affordances" block right
 *      after it: followup chips + action buttons + an artifact/draft card.
 *
 * WHAT THE AFFORDANCES DO (all call REAL existing app functions; nothing new
 * is invented, nothing bypasses existing safety rails):
 *   - followup chip        -> window.__mlsAsstFix._handleSend(text)  (same as typing it)
 *   - action kind=navigate  -> window.showView(view)
 *   - action kind=openPatient -> matches a patient by name (getPatients()/Who's
 *     Next list) and opens their chart via window.__mlsPick.select / openPatient
 *   - action kind=startVisit  -> showView('visit'), fills the hero name/DOB,
 *     and STOPS THERE -- recording only starts if the user also clicks the
 *     visit tab's own Start-visit control. (No auto-start from a chat click.)
 *   - action kind=build     -> showView('studio') and PREFILLS (never auto-
 *     sends) the Studio Copilot's own input box with the arg text, so the user
 *     reviews and sends it themselves.
 *   - artifact (e.g. a drafted email) -> shown as a preview card with editable
 *     To/Subject; "Send email" POSTs to the EXISTING /api/copilot/email route
 *     ONLY when the user clicks Send. Nothing is ever auto-sent.
 *
 * HARD SAFETY: this module cannot write to athenaOne, sign, save, or submit
 * anything. It has no path to any Athena/order/sign function. The only network
 * call it can trigger itself is the existing, explicit, user-clicked "Send
 * email" (POST /api/copilot/email), which already exists and is audited server-
 * side. Everything else is local navigation/selection or delegates to the
 * assistant's own text pipeline (as if the user had typed it).
 *
 * Idempotent, additive, reversible: window.__mlsCopilotActions.revert()
 * ASCII-only. try/catch throughout. No PHI logged.
 *
 * v1.0.1 HOTFIX (2026-07-10): fixed a live bug where using AI Studio's OWN
 * inline Copilot chat (#copilotThread, the real everyday surface, hosted by
 * __mlsCopilotInline) appeared to "open a new sidebar." Root cause: this
 * module hardcoded the separate floating "MLS Assistant" panel (#mlsAsstPanel)
 * as the only place it would render into, even though both surfaces post to
 * the same /api/copilot endpoint. Now the target thread is resolved to
 * whichever Copilot surface is actually on-screen at request time (Studio's
 * inline thread preferred), and silently dropped if neither is visible --
 * see pickThread()/studioThread()/assistantThread() below.
 * ==========================================================================*/
(function () {
  'use strict';
  try { if (window.__mlsCopilotActions && window.__mlsCopilotActions.installed) return; } catch (e) { return; }

  var VERSION = 'ca-1.0.1';
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
      '.' + BLOCK_CLASS + '{margin:6px 4px 12px;padding:10px 12px;border-radius:12px;background:rgba(47,107,237,.07);border:1px solid rgba(47,107,237,.22)}',
      '.' + BLOCK_CLASS + ' .mlsca-fu{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px}',
      '.' + BLOCK_CLASS + ' .mlsca-chip{cursor:pointer;border:1px solid rgba(47,107,237,.4);background:#fff;color:#1456a8;border-radius:999px;padding:5px 11px;font:600 12px system-ui;}',
      '.' + BLOCK_CLASS + ' .mlsca-chip:hover{background:rgba(47,107,237,.12)}',
      '.' + BLOCK_CLASS + ' .mlsca-acts{display:flex;flex-wrap:wrap;gap:6px}',
      '.' + BLOCK_CLASS + ' .mlsca-act{cursor:pointer;border:0;border-radius:9px;padding:7px 12px;font:700 12.5px system-ui;color:#fff;background:linear-gradient(135deg,#2f6bed,#1456a8)}',
      '.' + BLOCK_CLASS + ' .mlsca-act:hover{filter:brightness(1.08)}',
      '.' + BLOCK_CLASS + ' .mlsca-art{margin-top:10px;padding:9px 11px;border-radius:10px;background:#fff;border:1px solid rgba(47,107,237,.25)}',
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
  function getPatients() { return safe(function () { return (window.getPatients && window.getPatients()) || []; }, []); }
  function findPatientByName(name) {
    name = String(name || '').trim().toLowerCase(); if (!name) return null;
    var list = safe(function () { return (window.__mlsWhosNext && window.__mlsWhosNext.activeList && window.__mlsWhosNext.activeList()) || []; }, []);
    for (var i = 0; i < list.length; i++) { if (String(list[i].name || '').toLowerCase().indexOf(name) >= 0) return list[i]; }
    var ps = getPatients();
    for (var j = 0; j < ps.length; j++) { if (String(ps[j].name || '').toLowerCase().indexOf(name) >= 0) return ps[j]; }
    return null;
  }
  var VIEW_ALIASES = {
    home: 'visit', visit: 'visit', record: 'visit', recording: 'visit',
    schedule: 'calendar', calendar: 'calendar',
    patients: 'patients', patient: 'patients',
    orders: 'orders', order: 'orders',
    recs: 'recs', recommendation: 'recs', recommendations: 'recs',
    history: 'history', notes: 'history',
    team: 'team',
    analysis: 'analysis', stats: 'analysis', statistics: 'analysis',
    studio: 'studio', ai: 'studio', widgets: 'studio'
  };
  function resolveView(arg) {
    var a = String(arg || '').trim().toLowerCase();
    return VIEW_ALIASES[a] || (a || 'visit');
  }

  /* ---------------- action execution ---------------- */
  function doNavigate(view) {
    safe(function () { if (isFn(window.showView)) window.showView(resolveView(view)); });
  }
  function doOpenPatient(name) {
    var p = findPatientByName(name);
    if (!p) { toast('Could not find "' + name + '" -- pull the schedule or open Patients to search.'); return; }
    safe(function () {
      if (window.__mlsPick && isFn(window.__mlsPick.select)) window.__mlsPick.select(p.id);
      else if (isFn(window.openPatient)) window.openPatient(p.id);
    });
    toast('Opened ' + (p.name || 'patient') + '’s chart.');
  }
  function doStartVisit(name) {
    safe(function () { if (isFn(window.showView)) window.showView('visit'); });
    var p = name ? findPatientByName(name) : null;
    if (p) {
      safe(function () {
        var nm = $('heroPtName'); if (nm) { nm.value = p.name || ''; nm.dispatchEvent(new Event('input', { bubbles: true })); }
        var db = $('heroPtDob'); if (db) { db.value = p.dob || ''; db.dispatchEvent(new Event('input', { bubbles: true })); }
        if (isFn(window._heroSyncName)) window._heroSyncName();
      });
      toast((p.name || 'Patient') + ' loaded on the Visit tab -- tap Start recording when ready.');
    } else {
      toast('Visit tab opened -- pick or pull a patient, then tap Start recording.');
    }
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
    if (!a) return;
    if (a.kind === 'navigate') doNavigate(a.arg);
    else if (a.kind === 'openPatient') doOpenPatient(a.arg);
    else if (a.kind === 'startVisit') doStartVisit(a.arg);
    else if (a.kind === 'build') doBuild(a.arg);
  }

  /* ---------------- rendering ---------------- */
  /* v1.0.1 FIX -- root cause of "clicking/typing in Copilot opens a NEW
     SIDEBAR (and misbehaving)": this module hardcoded #mlsAsstPanel (the
     separate, floating "MLS Assistant" panel + FAB from feat_mls_asst_fix.js)
     as THE Copilot thread. But the real, everyday Copilot surface users type
     into is AI Studio's OWN inline chat (#copilotThread inside #copilotCard,
     hosted by the live __mlsCopilotInline module -- see mls-connect.js's own
     comments: "copilot thread in AI Studio via __mlsCopilotInline"). Both
     surfaces POST to the same /api/copilot endpoint, so this module's
     fetch-peek caught replies from either one but always waited on, and
     rendered into, #mlsAsstPanel -- a panel the user never opened. That
     unrelated panel filling with content is what read as "a new sidebar
     opened." Fix: capture which thread is actually on-screen AT THE MOMENT
     the request fires (not later, when the response resolves -- the user
     could have navigated by then), preferring the real Studio inline thread
     whenever it's visible, and drop silently (never fall back to a hidden,
     unrelated panel) if neither is on-screen. */
  function studioThread() {
    return safe(function () {
      var sv = document.getElementById('studioView');
      var t = document.getElementById('copilotThread');
      if (sv && sv.offsetParent !== null && t && t.offsetParent !== null) return t;
      return null;
    }, null);
  }
  function assistantThread() {
    return safe(function () {
      var p = $('mlsAsstPanel');
      return (p && p.offsetParent !== null) ? p.querySelector('.as-thread') : null;
    }, null);
  }
  function pickThread() { return studioThread() || assistantThread(); }

  function sendEmail(btn, block, art) {
    var toEl = block.querySelector('.mlsca-to');
    var subjEl = block.querySelector('.mlsca-subj');
    var bodyEl = block.querySelector('.mlsca-body');
    var to = toEl ? String(toEl.value || '').trim() : '';
    var subject = subjEl ? String(subjEl.value || '').trim() : '';
    var body = bodyEl ? String(bodyEl.value || '') : '';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) { toast('Enter a valid recipient email first.'); return; }
    btn.disabled = true; btn.textContent = 'Sending…';
    var base = safe(function () { return window.bkBase(); }, '');
    var tok = safe(function () { return window.bkToken(); }, '');
    fetch(base + '/api/copilot/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok },
      body: JSON.stringify({ to: to, subject: subject, body: body })
    }).then(function (r) { return r.json().then(null, function () { return {}; }); })
      .then(function (d) {
        if (d && d.ok) { btn.textContent = 'Sent'; toast('Email sent to ' + to + '.'); }
        else { btn.disabled = false; btn.textContent = 'Send email'; toast((d && d.error) || 'Could not send -- try again.'); }
      })
      .then(null, function () { btn.disabled = false; btn.textContent = 'Send email'; toast('Network error -- could not send.'); });
  }

  function renderBlock(payload, t) {
    if (!t) return;
    var actions = Array.isArray(payload.actions) ? payload.actions : [];
    var followups = Array.isArray(payload.followups) ? payload.followups : [];
    var artifact = payload.artifact && typeof payload.artifact === 'object' ? payload.artifact : null;
    if (!actions.length && !followups.length && !artifact) return;

    var block = document.createElement('div');
    block.className = BLOCK_CLASS;

    if (followups.length) {
      var fu = document.createElement('div'); fu.className = 'mlsca-fu';
      followups.forEach(function (q) {
        var chip = document.createElement('button'); chip.type = 'button'; chip.className = 'mlsca-chip';
        chip.textContent = q;
        chip.onclick = function () { safe(function () { if (window.__mlsAsstFix && isFn(window.__mlsAsstFix._handleSend)) window.__mlsAsstFix._handleSend(q); }); };
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
        sendBtn.textContent = 'Send email';
        sendBtn.onclick = function () { sendEmail(sendBtn, art, artifact); };
        art.appendChild(sendBtn);
        var note = document.createElement('div'); note.className = 'mlsca-note';
        note.textContent = 'Nothing is sent until you click Send email. Edit the draft first if you want.';
        art.appendChild(note);
      } else {
        var note2 = document.createElement('div'); note2.className = 'mlsca-note';
        note2.textContent = 'Draft only -- copy what you need. This never writes to Athena.';
        art.appendChild(note2);
      }
      block.appendChild(art);
    }
    t.appendChild(block);
    safe(function () { block.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); });
  }

  /* pending payloads waiting for their AI bubble to render. Each entry
     remembers WHICH thread to render into (captured when the request fired,
     see installFetchPeek) and how many children that thread had then -- once
     the count grows (the reply rendered) or ~8s passes (safety timeout, in
     case a thread's own bubble markup doesn't simply append), the affordance
     block is rendered into that SAME thread. Generic child-count growth
     (rather than a hardcoded ".as-msg.ai" selector) works for both the
     Assistant panel's markup and Studio's own #copilotThread markup without
     needing to know either one's exact bubble class names. */
  var pending = [];
  function drainPending() {
    if (!pending.length) return;
    var still = [];
    for (var i = 0; i < pending.length; i++) {
      var item = pending[i];
      var t = item.target;
      if (!t || !document.body.contains(t)) continue; // thread gone (nav'd away) -- drop silently
      var grew = t.children.length > item.startCount;
      var stale = (Date.now() - item.queuedAt) > 8000;
      if (grew || stale) renderBlock(item.payload, t);
      else still.push(item);
    }
    pending = still;
  }
  var drainIv = setInterval(function () { safe(drainPending); }, 400);

  /* ---------------- fetch wrap: peek /api/copilot only ---------------- */
  var origFetch = null;
  function isCopilotAsk(url) {
    try { return /\/api\/copilot(\?|$)/.test(String(url || '').split('#')[0]); } catch (e) { return false; }
  }
  function installFetchPeek() {
    if (!isFn(window.fetch) || window.fetch.__mlsCaWrapped) return;
    origFetch = window.fetch.bind(window);
    var wrapped = function (input, init) {
      var url = (typeof input === 'string') ? input : (input && input.url) || '';
      var method = (init && init.method) || (typeof input === 'object' && input.method) || 'GET';
      var p = origFetch(input, init);
      if (String(method).toUpperCase() === 'POST' && isCopilotAsk(url)) {
        /* capture NOW, while we still know where the user actually is --
           by the time the response resolves they may have switched tabs */
        var target = pickThread();
        var startCount = target ? target.children.length : 0;
        safe(function () {
          p.then(function (resp) {
            safe(function () {
              resp.clone().json().then(function (d) {
                if (target && d && d.ok && (Array.isArray(d.actions) && d.actions.length || Array.isArray(d.followups) && d.followups.length || d.artifact)) {
                  pending.push({ payload: d, target: target, startCount: startCount, queuedAt: Date.now() });
                }
              }).then(null, function () {});
            });
          });
        });
      }
      return p;
    };
    wrapped.__mlsCaWrapped = true;
    window.fetch = wrapped;
  }
  function revertFetchPeek() {
    if (origFetch && window.fetch && window.fetch.__mlsCaWrapped) window.fetch = origFetch;
    origFetch = null;
  }

  /* ---------------- boot / revert ---------------- */
  function boot() {
    ensureCss();
    installFetchPeek();
  }
  function revert() {
    safe(function () { clearInterval(drainIv); });
    safe(revertFetchPeek);
    safe(function () { var s = $(STYLE_ID); if (s && s.parentNode) s.parentNode.removeChild(s); });
    safe(function () {
      var blocks = document.querySelectorAll('.' + BLOCK_CLASS);
      for (var i = 0; i < blocks.length; i++) if (blocks[i].parentNode) blocks[i].parentNode.removeChild(blocks[i]);
    });
    pending = [];
    try { window.__mlsCopilotActions.installed = false; } catch (e) {}
  }

  window.__mlsCopilotActions = {
    installed: true,
    version: VERSION,
    asset: ASSET,
    revert: revert
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else { boot(); }
})();
