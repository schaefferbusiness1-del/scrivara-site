/* feat_mls_assistant_exact.js  ->  window.__mlsAsst  (asst-1.0.0)
 *
 *  ONE honest MLS Assistant panel. STAGING-FIRST, then prod via the data: staging
 *  marker (self-gated exactly like the other *_exact modules), so it activates on BOTH.
 *
 *  WHAT IT REPLACES (honesty mandate)
 *  ----------------------------------
 *  Two older surfaces showed scripted / duplicated status:
 *    1) feat_athena_selfheal.js auto-ran a 4-attempt "MLS Assistant - fixing Athena"
 *       recovery timeline ("Checking that MLS Assist is awake...", "Re-checking
 *       everything...", "I couldn't fix this automatically after N tries"). It fired
 *       AUTOMATICALLY on a failed read and, via the sign-in prompt's recovery path,
 *       could open athenaOne without the user asking. We NEUTRALIZE it (revert +
 *       no-op attemptRecovery/narrate) so no scripted retry panel ever renders and
 *       nothing auto-opens athenaOne.
 *    2) feat_athena_ux_unify.js floated its own "MLS - Athena status" mirror panel
 *       (#mlsuxPanel) plus duplicate chips. We hide those floating duplicates; this
 *       panel becomes the single status surface. (We do NOT touch the .mlsaa-tl
 *       timeline, which the real write-back flow uses for genuine confirmations.)
 *
 *  WHAT THIS PANEL SHOWS (only true things)
 *  ----------------------------------------
 *   - LIVE connection status read straight from window.__mlsConnTruth, the single
 *     honest probe (extension pong + a host-verified, signed-in athenaOne tab). No
 *     invented counts, no scripted "fixed it" lines. States: checking / connected /
 *     no extension / no signed-in athenaOne tab / disconnected.
 *   - A "Connect athenaOne" button shown ONLY when genuinely disconnected. It opens
 *     athenaOne ONLY on the user's click (synchronous window.open inside the gesture,
 *     reusing the sign-in prompt opener) - never automatically.
 *   - A real AI chat wired to the SAME backend the in-app Copilot uses
 *     (POST {bkBase}/api/copilot with {question, context, history}, Bearer bkToken).
 *     Replies are the model's real text. If the account is not signed in, it says so
 *     honestly instead of faking an answer.
 *
 *  SAFETY: additive, idempotent (built once; status updates via subscribe only, so no
 *  re-render flicker), reversible (window.__mlsAsst.revert()). Sends NOTHING to the
 *  athenaOne extension. Never writes/saves/signs a chart. Reads no PHI beyond what the
 *  app's own copilotSnapshot() already sends to its own backend. ASCII-only.
 */
;(function () {
  "use strict";
  var VERSION = "asst-1.0.0";
  try { if (window.__mlsAsst && window.__mlsAsst.installed) return; } catch (e) { return; }

  /* ---------- self-gate: staging page OR prod staging-marker (active on both) ---------- */
  function gateOn() {
    try {
      if (/staging/i.test(location.pathname)) return true;
      if (document.querySelector('script[src*="mls-connect.staging.js"]')) return true;
    } catch (e) {}
    return false;
  }
  if (!gateOn()) { try { window.__mlsAsst = { installed: false, skipped: "gate" }; } catch (e) {} return; }

  /* ---------- tiny helpers ---------- */
  function safe(fn, dflt) { try { return fn(); } catch (e) { return dflt; } }
  function isFn(f) { return typeof f === "function"; }
  function $(id) { try { return document.getElementById(id); } catch (e) { return null; } }
  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function ct() { return safe(function () { return window.__mlsConnTruth || null; }, null); }

  /* =====================================================================
   *  PART A - neutralize the scripted self-heal retry panel + auto-open
   * ===================================================================== */
  var _healPoll = null, _healTries = 0;
  function neutralizeSelfHeal() {
    var sh = safe(function () { return window.__mlsAthenaSelfHeal; }, null);
    if (!sh) return false;
    // Stop its auto-recovery message listener (removes the scripted timeline trigger
    // and the downstream auto-open of athenaOne).
    safe(function () { if (sh.installed && isFn(sh.revert)) sh.revert(); });
    // Defense in depth: any other caller that invokes the recovery brain gets a
    // no-op (no scripted "fixing Athena" panel, no canned step lines).
    safe(function () {
      sh.attemptRecovery = function () { return Promise.resolve({ fixed: false, neutralized: true }); };
      sh.narrate = function () {};
    });
    return true;
  }
  function startHealWatch() {
    // self-heal boots on DOMContentLoaded; if it installs after us, neutralize it then.
    neutralizeSelfHeal();
    _healPoll = setInterval(function () {
      _healTries++;
      var ok = neutralizeSelfHeal();
      if (ok || _healTries > 20) { clearInterval(_healPoll); _healPoll = null; }
    }, 1000);
  }

  /* ---------- hide the duplicate floating status surfaces (NOT the writeback timeline) ---------- */
  var SUPPRESS_ID = "mlsAsstSuppress";
  function injectSuppress() {
    if ($(SUPPRESS_ID)) return;
    var s = el("style"); s.id = SUPPRESS_ID;
    s.textContent =
      "#mlsuxPanel,.mlssh-toast{display:none !important;}";
    (document.head || document.documentElement).appendChild(s);
  }

  /* =====================================================================
   *  PART B - the one honest panel (status + connect-on-click + AI chat)
   * ===================================================================== */
  var PANEL_ID = "mlsAsstPanel", FAB_ID = "mlsAsstFab", STYLE_ID = "mlsAsstStyle";
  var history = [];           // {role:'user'|'ai'|'pending', text:string}
  var busy = false;
  var unsub = null;

  function injectStyle() {
    if ($(STYLE_ID)) return;
    var s = el("style"); s.id = STYLE_ID;
    s.textContent = [
      "#" + FAB_ID + "{position:fixed;left:18px;bottom:18px;z-index:2147483600;",
      "background:#1f4fd1;color:#fff;border:none;border-radius:999px;padding:11px 16px;",
      "font:600 13px/1 system-ui,Arial,sans-serif;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.28);}",
      "#" + FAB_ID + " .dot{display:inline-block;width:8px;height:8px;border-radius:50%;",
      "margin-right:7px;vertical-align:middle;background:#9aa0a6;}",
      "#" + PANEL_ID + "{position:fixed;left:18px;bottom:18px;z-index:2147483601;width:360px;",
      "max-width:calc(100vw - 24px);max-height:calc(100vh - 36px);display:none;flex-direction:column;",
      "background:#0f2440;color:#e8eef7;border:1px solid rgba(255,255,255,.16);border-radius:14px;",
      "box-shadow:0 14px 40px rgba(0,0,0,.40);font:13px/1.45 system-ui,Arial,sans-serif;overflow:hidden;}",
      "#" + PANEL_ID + ".open{display:flex;}",
      "#" + PANEL_ID + " .as-head{display:flex;align-items:center;justify-content:space-between;",
      "padding:12px 14px;border-bottom:1px solid rgba(255,255,255,.12);}",
      "#" + PANEL_ID + " .as-title{font-weight:700;font-size:14px;}",
      "#" + PANEL_ID + " .as-x{background:none;border:none;color:#cdd8ea;font-size:18px;cursor:pointer;padding:2px 6px;line-height:1;}",
      "#" + PANEL_ID + " .as-status{display:flex;align-items:flex-start;gap:8px;padding:10px 14px;",
      "border-bottom:1px solid rgba(255,255,255,.10);background:rgba(255,255,255,.03);}",
      "#" + PANEL_ID + " .as-sdot{width:9px;height:9px;border-radius:50%;margin-top:4px;flex:0 0 auto;background:#9aa0a6;}",
      "#" + PANEL_ID + " .as-stext{flex:1 1 auto;min-width:0;}",
      "#" + PANEL_ID + " .as-slabel{font-weight:600;}",
      "#" + PANEL_ID + " .as-sdetail{font-size:11.5px;opacity:.82;margin-top:2px;}",
      "#" + PANEL_ID + " .as-connect{margin-top:8px;display:inline-block;background:#2f6df0;color:#fff;",
      "border:none;border-radius:8px;padding:7px 12px;font:600 12px/1 system-ui;cursor:pointer;}",
      "#" + PANEL_ID + " .as-thread{flex:1 1 auto;overflow-y:auto;padding:12px 14px;min-height:120px;}",
      "#" + PANEL_ID + " .as-msg{margin:0 0 10px;display:flex;}",
      "#" + PANEL_ID + " .as-msg.user{justify-content:flex-end;}",
      "#" + PANEL_ID + " .as-bub{max-width:84%;padding:8px 11px;border-radius:12px;white-space:pre-wrap;word-wrap:break-word;}",
      "#" + PANEL_ID + " .as-msg.user .as-bub{background:#2f6df0;color:#fff;border-bottom-right-radius:4px;}",
      "#" + PANEL_ID + " .as-msg.ai .as-bub{background:rgba(255,255,255,.10);color:#eaf1fb;border-bottom-left-radius:4px;}",
      "#" + PANEL_ID + " .as-msg.pending .as-bub{opacity:.7;font-style:italic;}",
      "#" + PANEL_ID + " .as-hint{opacity:.7;font-size:11.5px;padding:0 14px 8px;}",
      "#" + PANEL_ID + " .as-input{display:flex;gap:8px;padding:10px 12px;border-top:1px solid rgba(255,255,255,.12);}",
      "#" + PANEL_ID + " .as-input textarea{flex:1 1 auto;resize:none;height:38px;max-height:120px;",
      "background:rgba(255,255,255,.08);color:#fff;border:1px solid rgba(255,255,255,.18);border-radius:9px;",
      "padding:9px 10px;font:13px/1.35 system-ui;outline:none;}",
      "#" + PANEL_ID + " .as-send{flex:0 0 auto;background:#1f4fd1;color:#fff;border:none;border-radius:9px;",
      "padding:0 14px;font:600 13px/1 system-ui;cursor:pointer;}",
      "#" + PANEL_ID + " .as-send:disabled{opacity:.5;cursor:default;}"
    ].join("");
    (document.head || document.documentElement).appendChild(s);
  }

  /* ---------- status colors map __mlsConnTruth.describe().color ---------- */
  var COLOR = { green: "#16a34a", red: "#dc2626", grey: "#9aa0a6" };
  function describeNow() {
    var c = ct();
    if (c && isFn(c.describe)) return safe(function () { return c.describe(); }, null);
    return null;
  }
  function isConnected() {
    var c = ct();
    return !!(c && isFn(c.isConnected) && safe(function () { return c.isConnected(); }, false));
  }

  function renderStatus() {
    var p = $(PANEL_ID); if (!p) return;
    var d = describeNow() || { status: "checking", color: "grey", label: "Checking athenaOne connection...", detail: "" };
    var col = COLOR[d.color] || COLOR.grey;
    var sdot = p.querySelector(".as-sdot"); if (sdot) sdot.style.background = col;
    var fdot = document.querySelector("#" + FAB_ID + " .dot"); if (fdot) fdot.style.background = col;
    var lab = p.querySelector(".as-slabel"); if (lab) lab.textContent = d.label || "";
    var det = p.querySelector(".as-sdetail"); if (det) det.textContent = d.detail || "";
    // Connect button: only when genuinely disconnected (not while checking / connected).
    var disc = (d.status === "no-extension" || d.status === "no-tab" || d.status === "error");
    var slot = p.querySelector(".as-connect-slot");
    if (slot) {
      if (disc && !slot.firstChild) {
        var b = el("button", "as-connect", "Connect athenaOne");
        b.type = "button";
        b.addEventListener("click", onConnectClick);
        slot.appendChild(b);
      } else if (!disc && slot.firstChild) {
        slot.innerHTML = "";
      }
    }
  }

  /* ---------- connect ONLY on this user click (never automatic) ---------- */
  function onConnectClick() {
    // Reuse the deployed sign-in prompt opener (synchronous window.open inside the
    // gesture so it is not popup-blocked). Fall back to a direct open.
    var sp = safe(function () { return window.__mlsAthenaSignInPrompt; }, null);
    if (sp && isFn(sp._openAthena)) { safe(function () { sp._openAthena(true); }); }
    else {
      var url = (sp && isFn(sp._athenaUrl)) ? safe(function () { return sp._athenaUrl(); }, null) : null;
      safe(function () { window.open(url || "https://athenanet.athenahealth.com/", "mlsAthenaSignIn"); });
    }
    addMsg("ai", "Opening athenaOne in a new tab. Please sign in there, then come back - the status above will update on its own once a signed-in tab is detected.");
    // Nudge a fresh probe so the status flips promptly after sign-in.
    var c = ct(); if (c && isFn(c.check)) safe(function () { c.check(); });
  }

  /* ---------- chat thread ---------- */
  function renderThread() {
    var t = $(PANEL_ID) && $(PANEL_ID).querySelector(".as-thread");
    if (!t) return;
    var html = "";
    for (var i = 0; i < history.length; i++) {
      var m = history[i];
      var role = m.role === "user" ? "user" : (m.role === "pending" ? "ai pending" : "ai");
      html += '<div class="as-msg ' + role + '"><div class="as-bub">' + esc(m.text) + "</div></div>";
    }
    t.innerHTML = html;
    t.scrollTop = t.scrollHeight;
  }
  function addMsg(role, text) { history.push({ role: role, text: text }); renderThread(); }

  function backendReady() {
    var bm = safe(function () { return isFn(window.backendMode) && window.backendMode(); }, false);
    var tok = safe(function () { return isFn(window.bkToken) && window.bkToken(); }, "");
    return !!(bm && tok);
  }

  function ask(q) {
    q = String(q || "").trim();
    if (!q || busy) return;
    addMsg("user", q);
    if (!backendReady()) {
      addMsg("ai", "Sign in to your MLS account to chat with the assistant - it needs your account to read your practice data.");
      return;
    }
    busy = true; setSendEnabled(false);
    history.push({ role: "pending", text: "Thinking..." }); renderThread();
    var base = safe(function () { return window.bkBase(); }, "");
    var tok = safe(function () { return window.bkToken(); }, "");
    var ctx = safe(function () { return isFn(window.copilotSnapshot) ? window.copilotSnapshot() : null; }, null);
    var hist = history.filter(function (m) { return m.role === "user" || m.role === "ai"; })
                      .map(function (m) { return { role: m.role === "user" ? "user" : "ai", text: m.text }; });
    hist = hist.slice(0, -1); // exclude the question we just added
    var body = { question: q, history: hist };
    if (ctx) body.context = ctx;
    fetch(base + "/api/copilot", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + tok },
      body: JSON.stringify(body)
    }).then(function (r) { return r.json().catch(function () { return {}; }); })
      .then(function (d) {
        dropPending();
        var reply = (d && (d.reply || d.text || d.answer)) || "";
        reply = String(reply).trim();
        if (!reply) reply = "The assistant did not return a response. Please try again.";
        addMsg("ai", reply);
      })
      .catch(function () {
        dropPending();
        addMsg("ai", "Couldn't reach the assistant just now (network or backend). Please try again in a moment.");
      })
      .then(function () { busy = false; setSendEnabled(true); });
  }
  function dropPending() { history = history.filter(function (m) { return m.role !== "pending"; }); renderThread(); }
  function setSendEnabled(on) { var b = $(PANEL_ID) && $(PANEL_ID).querySelector(".as-send"); if (b) b.disabled = !on; }

  /* ---------- build panel + FAB (once) ---------- */
  function buildPanel() {
    if ($(PANEL_ID)) return;
    injectStyle();

    var fab = el("button", null, '<span class="dot"></span>MLS Assistant');
    fab.id = FAB_ID; fab.type = "button";
    fab.addEventListener("click", function () { toggle(true); });
    document.body.appendChild(fab);

    var p = el("div");
    p.id = PANEL_ID;
    p.innerHTML =
      '<div class="as-head"><span class="as-title">MLS Assistant</span>' +
      '<button type="button" class="as-x" aria-label="Close">&times;</button></div>' +
      '<div class="as-status"><span class="as-sdot"></span>' +
      '<div class="as-stext"><div class="as-slabel">Checking athenaOne connection...</div>' +
      '<div class="as-sdetail"></div><span class="as-connect-slot"></span></div></div>' +
      '<div class="as-thread"></div>' +
      '<div class="as-hint">Ask about your schedule, patients, or how to use MLS. Replies come from the MLS backend AI.</div>' +
      '<div class="as-input"><textarea placeholder="Message the assistant..." rows="1"></textarea>' +
      '<button type="button" class="as-send">Send</button></div>';
    document.body.appendChild(p);

    p.querySelector(".as-x").addEventListener("click", function () { toggle(false); });
    var ta = p.querySelector("textarea"), send = p.querySelector(".as-send");
    send.addEventListener("click", function () { var v = ta.value; ta.value = ""; ask(v); });
    ta.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); var v = ta.value; ta.value = ""; ask(v); }
    });

    // Greeting (honest, not a fake status claim).
    if (!history.length) addMsg("ai", "Hi - I'm the MLS Assistant. Ask me anything about your day, your patients, or how to do something in MLS. The status above shows your real athenaOne connection.");

    renderStatus();
    bindTruth();
  }

  function toggle(open) {
    var p = $(PANEL_ID), f = $(FAB_ID); if (!p) return;
    var willOpen = open == null ? !p.classList.contains("open") : !!open;
    p.classList.toggle("open", willOpen);
    if (f) f.style.display = willOpen ? "none" : "";
    if (willOpen) {
      renderStatus();
      var c = ct(); if (c && isFn(c.check)) safe(function () { c.check(); });
      var ta = p.querySelector("textarea"); if (ta) safe(function () { ta.focus(); });
    }
  }

  function bindTruth() {
    var c = ct();
    if (c && isFn(c.subscribe)) { unsub = safe(function () { return c.subscribe(function () { renderStatus(); }); }, null); }
    else {
      // Truth source not present yet - poll briefly until it is, then subscribe.
      var tries = 0, iv = setInterval(function () {
        tries++; var cc = ct();
        if (cc && isFn(cc.subscribe)) { clearInterval(iv); unsub = safe(function () { return cc.subscribe(function () { renderStatus(); }); }, null); renderStatus(); }
        else if (tries > 20) { clearInterval(iv); }
      }, 1000);
    }
  }

  /* ---------- boot / revert ---------- */
  function boot() {
    startHealWatch();
    injectSuppress();
    buildPanel();
  }
  function revert() {
    safe(function () { if (_healPoll) clearInterval(_healPoll); });
    safe(function () { if (isFn(unsub)) unsub(); });
    safe(function () { var p = $(PANEL_ID); if (p) p.remove(); });
    safe(function () { var f = $(FAB_ID); if (f) f.remove(); });
    safe(function () { var s = $(STYLE_ID); if (s) s.remove(); });
    safe(function () { var s = $(SUPPRESS_ID); if (s) s.remove(); });
    try { window.__mlsAsst.installed = false; } catch (e) {}
  }

  window.__mlsAsst = {
    installed: true,
    version: VERSION,
    asset: "feat_mls_assistant_exact.js",
    open: function () { toggle(true); },
    close: function () { toggle(false); },
    ask: ask,
    _renderStatus: renderStatus,
    _neutralizeSelfHeal: neutralizeSelfHeal,
    _history: function () { return history.slice(); },
    revert: revert
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { safe(boot); }, { once: true });
  } else {
    safe(boot);
  }
})();
