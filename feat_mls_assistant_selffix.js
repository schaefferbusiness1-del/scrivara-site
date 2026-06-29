/* feat_mls_assistant_selffix.js  ->  window.__mlsAssistantSelfFix  (asf-1.0.0)
 *
 * PHASE 1: give the in-app MLS Assistant a real, read-only view of the app's
 * current state, let it DIAGNOSE the known breakage patterns in plain language,
 * and let it take only SAFE, REVERSIBLE actions (revert / re-apply / re-run a
 * feature module's own render) -- always confirmation-gated in the chat.
 *
 * HARD BLOCKS (never crossed by this module):
 *   - never deletes/modifies/clears any patient record, roster, note, appointment
 *   - never writes to athenaOne (read-only) and never calls any writeback path
 *   - never writes to the repo and never deploys
 *   - never evals arbitrary code; actions are restricted to {revert, reapply,
 *     rerender} on window.__mls* feature handles only
 *
 * Integration seam: the Assistant's ask() consults window.__mlsWbRouter.parseCommand
 * first and, on a match, renders the reply through its normal chat history path.
 * We wrap that parseCommand so diagnostic intents route to us and reply in-chat.
 *
 * Additive, idempotent, reversible (window.__mlsAssistantSelfFix.revert()). ASCII only.
 * No PHI/secrets are persisted, logged off-page, or committed.
 */
(function () {
  "use strict";
  try { if (window.__mlsAssistantSelfFix && window.__mlsAssistantSelfFix.installed) return; } catch (e) { return; }

  var VERSION = "1.0.1", ASSET = "feat_mls_assistant_selffix.js";

  /* ---------------- tiny utils ---------------- */
  function S(v) { return v == null ? "" : String(v); }
  function isFn(f) { return typeof f === "function"; }
  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }
  function $(id) { try { return document.getElementById(id); } catch (e) { return null; } }
  function qs(sel) { try { return document.querySelector(sel); } catch (e) { return null; } }
  function qsa(sel) { try { return Array.prototype.slice.call(document.querySelectorAll(sel)); } catch (e) { return []; } }

  /* ---------------- curated handle <-> source file map ----------------
     Used only to describe modules and (where present) re-load by file. We
     prefer a module's own .reapply()/.render() over re-injecting a script. */
  var FILE_BY_HANDLE = {
    __mlsWhosNext: "feat_mls_whosnext.js",
    __mlsHeroToday: "feat_mls_herotoday_fix.js",
    __mlsPickSmartScope: "feat_mls_pick_smartscope.js",
    __mlsPick: "feat_mls_patientpick.js",
    __mlsCtxAppt: "feat_mls_ctx_appt.js",
    __mlsHeroSearch: "feat_mls_hero_search.js",
    __mlsHeroGlance: "feat_mls_hero_glance.js",
    __mlsCalendar: "feat_mls_calendar_exact.js"
  };

  /* ---------------- console / error ring buffer (read-only capture) ---------------- */
  var ERRBUF = [], ERRCAP = 50, _origErr = null, _onErr = null, _onRej = null;
  function pushErr(kind, msg) {
    try {
      msg = S(msg); if (msg.length > 500) msg = msg.slice(0, 500) + "...";
      ERRBUF.push({ t: Date.now(), kind: kind, msg: msg });
      if (ERRBUF.length > ERRCAP) ERRBUF.shift();
    } catch (e) {}
  }
  function hookErrors() {
    try {
      if (!_origErr && window.console && isFn(console.error)) {
        _origErr = console.error;
        console.error = function () {
          try {
            pushErr("console.error", Array.prototype.map.call(arguments, function (a) {
              try { return (a && a.stack) ? a.stack : String(a); } catch (_) { return ""; }
            }).join(" "));
          } catch (_) {}
          try { return _origErr.apply(console, arguments); } catch (_) {}
        };
      }
      _onErr = function (ev) { try { pushErr("window.error", (ev && (ev.message || (ev.error && ev.error.message))) || ""); } catch (_) {} };
      window.addEventListener("error", _onErr, true);
      _onRej = function (ev) { try { var r = ev && ev.reason; pushErr("unhandledrejection", (r && (r.message || r)) || ""); } catch (_) {} };
      window.addEventListener("unhandledrejection", _onRej, true);
    } catch (e) {}
  }
  function unhookErrors() {
    try { if (_origErr) { console.error = _origErr; _origErr = null; } } catch (e) {}
    try { if (_onErr) { window.removeEventListener("error", _onErr, true); _onErr = null; } } catch (e) {}
    try { if (_onRej) { window.removeEventListener("unhandledrejection", _onRej, true); _onRej = null; } } catch (e) {}
  }
  function recentErrors() { return ERRBUF.slice(); }

  /* ---------------- introspection layer (read-only) ---------------- */
  function looksLikeFeature(v) {
    return !!(v && typeof v === "object" && (isFn(v.revert) || ("installed" in v) || ("__live" in v) || ("__reverted" in v)));
  }
  function moduleInstalled(v) {
    if (!v || typeof v !== "object") return undefined;
    if ("installed" in v) return !!v.installed;
    if ("__reverted" in v) return !v.__reverted;
    if ("__live" in v) return !!v.__live;
    if (isFn(v.revert)) return true;
    return undefined;
  }
  function enumModules() {
    var out = [];
    try {
      var keys = []; for (var k in window) { if (k.indexOf("__mls") === 0) keys.push(k); }
      keys.forEach(function (key) {
        var v = safe(function () { return window[key]; }, null);
        if (!looksLikeFeature(v)) return;
        out.push({
          handle: key,
          installed: moduleInstalled(v),
          hasRevert: isFn(v.revert),
          hasReapply: isFn(v.reapply),
          renderFn: pickRenderName(v),
          skipped: (v && v.skipped) || null,
          file: FILE_BY_HANDLE[key] || null
        });
      });
    } catch (e) {}
    out.sort(function (a, b) { return a.handle < b.handle ? -1 : 1; });
    return out;
  }
  function pickRenderName(v) {
    var cands = ["render", "paint", "renderGrid", "refresh", "rerender", "draw", "apply", "restoreRender"];
    for (var i = 0; i < cands.length; i++) if (isFn(v[cands[i]])) return cands[i];
    return null;
  }
  function gArrLen(name) { var a = safe(function () { return window[name]; }, null); return Array.isArray(a) ? a.length : null; }
  function snapshotGlobals() {
    var ap = safe(function () { return isFn(window.activePatient) ? window.activePatient() : null; }, null);
    return {
      view: safe(function () { return S(window.currentView) || "(unknown)"; }, "(unknown)"),
      calAppts: gArrLen("_calAppts"),
      calProviders: gArrLen("_calProviders"),
      totalPatients: safe(function () { return isFn(window.getPatients) ? (window.getPatients() || []).length : null; }, null),
      activePatient: ap ? { name: S(ap.name), hasId: !!ap.id } : null,
      backendReady: safe(function () { return !!(isFn(window.backendMode) && window.backendMode() && isFn(window.bkToken) && window.bkToken()); }, false)
    };
  }
  function snapshotDom() {
    function info(sel) { var n = qsa(sel); return { count: n.length, present: n.length > 0 }; }
    return {
      assistantPanel: info("#mlsAsstPanel"),
      heroToday: info("#heroToday"),
      whosNextHost: info("#heroToday"),
      wnGrid: info("#heroToday .wn-grid"),
      wnChips: info("#heroToday .wn-chip"),
      wnCount: info("#heroToday .wn-count"),
      wnEmpty: info("#heroToday .wn-empty"),
      ctxBar: info("#mlsCtxBar")
    };
  }
  function introspect() {
    return { ts: Date.now(), version: VERSION, globals: snapshotGlobals(), modules: enumModules(), dom: snapshotDom(), errors: recentErrors() };
  }

  /* ---------------- detectors for known breakage patterns ---------------- */
  function diagnose() {
    var snap = introspect(), f = [], g = snap.globals, dom = snap.dom, errs = snap.errors;

    /* A. a feature module that should be on but reports not-installed (reverted/failed) */
    snap.modules.forEach(function (m) {
      if (m.installed === false && !m.skipped) {
        f.push({ sev: "info", handle: m.handle,
          title: "Module inactive: " + m.handle,
          detail: "Its handle reports installed=false. This may be intentional (a later module can supersede an earlier one) or it failed/was reverted. If you expected it on, I can re-apply it." });
      }
    });

    /* B. recent runtime errors -- recursion / a feature file throwing */
    var recursion = errs.filter(function (e) { return /maximum call stack|too much recursion/i.test(e.msg); });
    if (recursion.length) {
      var last = recursion[recursion.length - 1];
      f.push({ sev: "error", handle: guessHandle(last.msg),
        title: "Infinite recursion in a recent error",
        detail: "Captured: \"" + last.msg.slice(0, 140) + "\". A feature render loop likely crashed a pull/render. Reverting the implicated module usually clears it." });
    }
    var fileErrs = {};
    errs.forEach(function (e) { var m = e.msg.match(/feat_[a-z0-9_]+\.js/i); if (m) fileErrs[m[0]] = (fileErrs[m[0]] || 0) + 1; });
    Object.keys(fileErrs).forEach(function (file) {
      if (recursion.length && file === FILE_BY_HANDLE[guessHandle(recursion[recursion.length - 1].msg)]) return;
      f.push({ sev: "warn", handle: handleForFile(file),
        title: "Errors traced to " + file,
        detail: fileErrs[file] + " recent error(s) mention " + file + ". That module may be misbehaving; I can revert or re-apply it." });
    });

    /* C/D/E. Who's Next picker detectors -- live structure:
       #heroToday > .wn-hd (.wn-count) + .wn-grid (.wn-chip). */
    var hero = $("heroToday");
    var grid = hero ? hero.querySelector(".wn-grid") : qs(".wn-grid");
    var countEl = hero ? hero.querySelector(".wn-count") : qs(".wn-count");
    var emptyEl = hero ? hero.querySelector(".wn-empty") : qs(".wn-empty");
    var chips = hero ? hero.querySelectorAll(".wn-chip").length : qsa(".wn-chip").length;
    var num = countEl ? parseInt((S(countEl.textContent).match(/\d+/) || [])[0], 10) : NaN;

    /* C. count-vs-rendered-boxes mismatch (the "N seen / 0 shown" class of bug) */
    if (!isNaN(num) && num > 0 && chips === 0) {
      f.push({ sev: "error", handle: "__mlsWhosNext",
        title: "Picker count/box mismatch",
        detail: "The Who's Next picker reports ~" + num + " but renders 0 selectable boxes (.wn-chip) -- data present, not drawn. Re-running its render usually fixes this." });
    }

    /* D. picker host present but the grid itself is not rendered */
    if (hero && !grid && !emptyEl) {
      f.push({ sev: "error", handle: "__mlsWhosNext",
        title: "Who's Next picker missing",
        detail: "The visit hero (#heroToday) is present but the picker grid (.wn-grid) is not mounted. Re-applying the picker module should restore it." });
    }

    /* E. data present in memory but the picker shows an empty state */
    if (g.calAppts && g.calAppts > 0 && chips === 0 && emptyEl) {
      f.push({ sev: "warn", handle: "__mlsWhosNext",
        title: "Schedule in memory but picker empty",
        detail: g.calAppts + " appointment(s) are in memory (_calAppts) but the picker shows none for the current scope. Often a doctor/day filter rather than a crash -- I can re-run the render or you can clear the doctor filter." });
    }

    /* F. duplicate / competing inserts */
    if (qsa(".wn-grid").length > 1) f.push({ sev: "warn", handle: "__mlsWhosNext", title: "Duplicate Who's Next grids", detail: qsa(".wn-grid").length + " .wn-grid pickers in the DOM (competing inserts). Reverting the duplicate-producing module clears it." });
    ["mlsAsstPanel", "mlsCtxBar", "heroToday"].forEach(function (id) {
      var n = qsa("#" + id).length;
      if (n > 1) f.push({ sev: "warn", handle: null,
        title: "Duplicate element #" + id,
        detail: n + " copies of #" + id + " in the DOM (competing inserts). Reverting the module that re-inserts it clears the duplicate." });
    });
    var assetCount = {};
    qsa("script[data-mls-asset]").forEach(function (s) { var a = s.getAttribute("data-mls-asset"); assetCount[a] = (assetCount[a] || 0) + 1; });
    Object.keys(assetCount).forEach(function (a) {
      if (assetCount[a] > 1) f.push({ sev: "warn", handle: handleForFile(a), title: "Duplicate module load: " + a, detail: "Loaded " + assetCount[a] + " times." });
    });

    return { findings: f, snapshot: snap };
  }
  function handleForFile(file) { for (var h in FILE_BY_HANDLE) if (FILE_BY_HANDLE[h] === file) return h; return null; }
  function guessHandle(msg) {
    var m = S(msg).match(/feat_[a-z0-9_]+\.js/i);
    if (m && handleForFile(m[0])) return handleForFile(m[0]);
    /* the known recursion was upnow_realtime<->upnow_sync feeding the picker; the
       supported repair surface is the picker module that superseded it. */
    if (/upnow|renderTodayPatients|_renderToday/i.test(S(msg))) return "__mlsWhosNext";
    return null;
  }

  /* ---------------- safe, reversible action executor ---------------- */
  var ACTION_LOG = [];
  function logAction(rec) { try { rec.t = Date.now(); ACTION_LOG.push(rec); if (ACTION_LOG.length > 100) ACTION_LOG.shift(); } catch (e) {} }
  function getHandleObj(handle) { return safe(function () { return window[handle]; }, null); }

  /* Allowed action kinds ONLY. Anything else is refused. */
  function execAction(kind, handle) {
    if (["revert", "reapply", "rerender"].indexOf(kind) < 0) return { ok: false, msg: "Refused: '" + kind + "' is not a permitted Phase-1 action." };
    if (!handle || S(handle).indexOf("__mls") !== 0) return { ok: false, msg: "Refused: actions are limited to window.__mls* feature handles." };
    var obj = getHandleObj(handle);
    if (!obj || typeof obj !== "object") return { ok: false, msg: "I can't find a live handle named " + handle + "." };
    var res;
    if (kind === "revert") {
      if (!isFn(obj.revert)) return { ok: false, msg: handle + " has no revert(); leaving it untouched." };
      res = safe(function () { obj.revert(); return true; }, false);
      logAction({ kind: kind, handle: handle, ok: !!res });
      return res ? { ok: true, msg: "Reverted " + handle + ". Undo: ask me to re-apply " + handle + "." }
                 : { ok: false, msg: "revert() threw on " + handle + "; nothing changed on my side." };
    }
    if (kind === "reapply") {
      if (isFn(obj.reapply)) {
        res = safe(function () { obj.reapply(); return true; }, false);
        logAction({ kind: kind, handle: handle, ok: !!res, via: "reapply" });
        return res ? { ok: true, msg: "Re-applied " + handle + " via its own reapply(). Undo: ask me to revert " + handle + "." }
                   : { ok: false, msg: "reapply() threw on " + handle + "." };
      }
      var rn = pickRenderName(obj);
      if (rn) {
        res = safe(function () { obj[rn](); return true; }, false);
        logAction({ kind: kind, handle: handle, ok: !!res, via: rn });
        return res ? { ok: true, msg: handle + " has no reapply(); I re-ran its " + rn + "() instead. Undo: ask me to revert " + handle + "." }
                   : { ok: false, msg: rn + "() threw on " + handle + "." };
      }
      return { ok: false, msg: handle + " exposes neither reapply() nor a render method, so I can't safely re-apply it this phase. I can still revert it." };
    }
    if (kind === "rerender") {
      var name = pickRenderName(obj);
      if (!name) return { ok: false, msg: handle + " exposes no render/refresh method to re-run." };
      res = safe(function () { obj[name](); return true; }, false);
      logAction({ kind: kind, handle: handle, ok: !!res, via: name });
      return res ? { ok: true, msg: "Re-ran " + handle + "." + name + "(). If it didn't help, ask me to revert + re-apply " + handle + "." }
                 : { ok: false, msg: name + "() threw on " + handle + "." };
    }
    return { ok: false, msg: "Unknown action." };
  }

  /* ---------------- conversational layer (in-chat) ---------------- */
  var pending = null; /* { kind, handle, label } awaiting "confirm" */

  function sevTag(s) { return s === "error" ? "[!]" : s === "warn" ? "[~]" : "[i]"; }
  function fmtDiagnosis(d) {
    var g = d.snapshot.globals, lines = [];
    lines.push("App self-check (read-only):");
    lines.push("- View: " + g.view + "  |  account signed in: " + (g.backendReady ? "yes" : "no"));
    lines.push("- In memory: " + (g.calAppts == null ? "?" : g.calAppts) + " appts, " +
               (g.calProviders == null ? "?" : g.calProviders) + " providers, " +
               (g.totalPatients == null ? "?" : g.totalPatients) + " patients" +
               (g.activePatient ? "  |  active: " + g.activePatient.name : ""));
    lines.push("- Feature modules loaded: " + d.snapshot.modules.length +
               " (" + d.snapshot.modules.filter(function (m) { return m.installed === false; }).length + " inactive)");
    lines.push("");
    if (!d.findings.length) {
      lines.push("I don't see any of the known breakage patterns right now (picker mismatch, missing strip, recursion, duplicates, or data-in-memory-not-rendered).");
      lines.push("If something still looks wrong, tell me the surface (e.g. \"the Who's Next picker\" or \"the calendar\") and I'll look closer.");
      return lines.join("\n");
    }
    var probs = d.findings.filter(function (x) { return x.sev === "error" || x.sev === "warn"; }).length;
    lines.push(probs > 0 ? ("I found " + probs + " potential problem(s)" + (d.findings.length > probs ? " plus " + (d.findings.length - probs) + " note(s)" : "") + ":")
                         : "Nothing looks broken; a couple of notes:");
    d.findings.forEach(function (x, i) {
      lines.push((i + 1) + ". " + sevTag(x.sev) + " " + x.title);
      lines.push("   " + x.detail + (x.handle ? "  (module: " + x.handle + ")" : ""));
    });
    var fixable = d.findings.filter(function (x) { return x.handle; });
    if (fixable.length) {
      lines.push("");
      lines.push("I can take a safe, reversible action on: " + uniq(fixable.map(function (x) { return x.handle; })).join(", ") + ".");
      lines.push("Say e.g. \"fix " + fixable[0].handle + "\" (or \"fix the picker\") and I'll propose the exact step and wait for your confirmation.");
    }
    return lines.join("\n");
  }
  function uniq(a) { var s = {}, o = []; a.forEach(function (x) { if (x && !s[x]) { s[x] = 1; o.push(x); } }); return o; }

  function fmtModules() {
    var m = enumModules(), lines = ["Loaded MLS feature modules (" + m.length + "):"];
    m.forEach(function (x) {
      lines.push("- " + x.handle + "  " + (x.installed === false ? "(inactive)" : "(active)") +
        (x.hasRevert ? " revert" : "") + (x.hasReapply ? " +reapply" : "") + (x.renderFn ? " +" + x.renderFn : ""));
    });
    lines.push("");
    lines.push("Ask me to \"diagnose\" / \"what's broken\", or \"fix <handle>\" for a safe reversible action.");
    return lines.join("\n");
  }

  /* map a free-text surface to a target handle for "fix the X" */
  function targetForText(t) {
    if (/who'?s ?next|next ?up|patient ?picker|the picker|pick(er)?\b/.test(t)) return "__mlsWhosNext";
    if (/hero|today/.test(t)) return "__mlsHeroToday";
    if (/context ?bar|ctx ?bar|appt chip/.test(t)) return "__mlsCtxAppt";
    if (/search/.test(t)) return "__mlsHeroSearch";
    if (/glance|day at a glance/.test(t)) return "__mlsHeroGlance";
    if (/calendar/.test(t)) return "__mlsCalendar";
    var m = t.match(/__mls[a-z0-9]+/i);
    if (m) { var mods = enumModules(); for (var i = 0; i < mods.length; i++) if (mods[i].handle.toLowerCase() === m[0].toLowerCase()) return mods[i].handle; }
    return null;
  }

  function proposeFix(handle) {
    var obj = getHandleObj(handle);
    if (!obj) return "I couldn't find a live module called " + handle + ". Try \"list modules\" to see what's loaded.";
    /* Prefer the most informative safe step: if it can revert AND re-apply, the
       canonical repair is revert+re-apply; if only render, re-run render. */
    var kind, label;
    if (isFn(obj.reapply) || pickRenderName(obj)) {
      kind = "reapply";
      label = "revert is available too, but the safest single repair is to re-apply " + handle +
              " (re-runs its setup/render). This is fully reversible -- I can revert it right after if it doesn't help.";
    } else if (isFn(obj.revert)) {
      kind = "revert"; label = "turn " + handle + " off (revert). Reversible by re-applying it.";
    } else {
      return handle + " doesn't expose a safe action I can take this phase. I can still describe what it is.";
    }
    pending = { kind: kind, handle: handle, label: label };
    return "Proposed fix for " + handle + ":\n- Action: " + kind + " " + handle + "\n- Why it's safe: " + label +
      "\n\nThis touches only the UI module -- no patient data, no athenaOne, no repo changes.\nReply \"confirm\" to apply, or \"cancel\" to skip.";
  }

  function doConfirm() {
    if (!pending) return null;
    var p = pending; pending = null;
    var r = execAction(p.kind, p.handle);
    return (r.ok ? "Done. " : "Couldn't complete that. ") + r.msg;
  }

  /* Main intent router. Returns {matched:true, reply} or null. */
  function handleSelfFix(text) {
    var t = S(text).trim(); if (!t) return null;
    var low = t.toLowerCase();

    /* confirm / cancel only when an action is pending (don't hijack normal chat) */
    if (pending) {
      if (/^(confirm|yes,? do it|do it|go ahead|apply|proceed|yes)\b/.test(low)) return { matched: true, reply: doConfirm() };
      if (/^(cancel|no|stop|abort|nevermind|never mind)\b/.test(low)) { pending = null; return { matched: true, reply: "Cancelled -- I didn't change anything." }; }
      /* otherwise fall through; a new diagnostic intent below can replace it */
    }

    var asksDiagnose = /\b(diagnose|what'?s broken|whats broken|what is broken|is anything broken|self[- ]?check|self[- ]?test|app ?state|introspect|health check|why is .* (broken|empty|missing|gone))\b/.test(low);
    var asksModules = /\b(list|which|what) (modules|features)\b/.test(low) || /\bmodules loaded\b/.test(low) || /\bself[- ]?fix help\b/.test(low);
    var asksCapab = /\bwhat can you (do|fix)\b/.test(low) && /\b(fix|broken|diagnos|module|app)\b/.test(low);
    var fixVerb = /\b(fix|repair|restore|reapply|re-?apply|revert|turn (on|off)|re-?run|rerender|re-?render|reload)\b/.test(low);

    if (asksModules) return { matched: true, reply: fmtModules() };
    if (asksDiagnose) return { matched: true, reply: fmtDiagnosis(diagnose()) };
    if (asksCapab) return { matched: true, reply: capabilities() };

    if (fixVerb) {
      var explicit = targetForText(low);
      /* explicit revert/reapply on a named handle -> propose that exact kind */
      if (explicit) {
        if (/\brevert|turn off\b/.test(low)) {
          var o = getHandleObj(explicit);
          if (o && isFn(o.revert)) {
            pending = { kind: "revert", handle: explicit, label: "turn " + explicit + " off (revert)" };
            return { matched: true, reply: "Proposed: revert " + explicit + " (reversible -- re-apply restores it).\nThis touches only the UI module; no patient data, athenaOne, or repo changes.\nReply \"confirm\" to apply, or \"cancel\"." };
          }
        }
        return { matched: true, reply: proposeFix(explicit) };
      }
      /* "fix it" with no clear target -> diagnose, then point at the top fixable finding */
      var d = diagnose();
      var top = d.findings.filter(function (x) { return x.handle; })[0];
      if (top) return { matched: true, reply: fmtDiagnosis(d) + "\n\nTip: say \"fix " + top.handle + "\" to act on the most likely culprit." };
      return { matched: true, reply: fmtDiagnosis(d) };
    }
    return null;
  }

  function capabilities() {
    return [
      "I'm the MLS Assistant's Phase-1 self-fix layer. I can:",
      "1. Read the live app state (loaded modules, key data in memory, the current screen, and recent runtime errors) -- read-only.",
      "2. Diagnose the known breakage patterns and explain, in plain language, what I actually see -- and say so honestly when I can't tell.",
      "3. Take a SAFE, REVERSIBLE action on a UI module when you confirm it: revert it, re-apply it, or re-run its render.",
      "",
      "What I will NOT do this phase: touch patient data, write to athenaOne, change code, or deploy -- those are hard-blocked. Autonomous code-fixes + deploys are deferred to a later phase.",
      "",
      "Try: \"diagnose\", \"what's broken?\", \"list modules\", or \"fix the picker\"."
    ].join("\n");
  }

  /* ---------------- wrap the assistant's command seam ---------------- */
  function ensureWrap() {
    var wbr = safe(function () { return window.__mlsWbRouter; }, null);
    if (!wbr) {
      /* if the writeback router isn't present, provide a minimal stub so ask()
         still routes user text through parseCommand to us. */
      wbr = { __asfStub: true, installed: true, all: function () { return null; }, parseCommand: function () { return { matched: false }; } };
      try { window.__mlsWbRouter = wbr; } catch (e) { return false; }
    }
    if (wbr.__asfWrapped) return true;
    var orig = isFn(wbr.parseCommand) ? wbr.parseCommand.bind(wbr) : function () { return { matched: false }; };
    wbr.__asfOrigParse = orig;
    wbr.parseCommand = function (text) {
      try { var r = handleSelfFix(text); if (r && r.matched) return r; } catch (e) { /* never break the assistant */ }
      try { return orig(text); } catch (e2) { return { matched: false }; }
    };
    wbr.__asfWrapped = true;
    return true;
  }
  var _iv = null;
  function startGuard() { try { ensureWrap(); _iv = setInterval(ensureWrap, 3000); } catch (e) {} }
  function stopGuard() { try { if (_iv) { clearInterval(_iv); _iv = null; } } catch (e) {} }
  function unwrap() {
    var wbr = safe(function () { return window.__mlsWbRouter; }, null);
    if (!wbr) return;
    try {
      if (wbr.__asfStub && wbr.__asfWrapped) { try { delete window.__mlsWbRouter; } catch (e) { window.__mlsWbRouter = undefined; } return; }
      if (wbr.__asfWrapped && wbr.__asfOrigParse) { wbr.parseCommand = wbr.__asfOrigParse; }
      try { delete wbr.__asfWrapped; delete wbr.__asfOrigParse; } catch (e3) {}
    } catch (e2) {}
  }

  /* ---------------- boot / revert ---------------- */
  function boot() { hookErrors(); startGuard(); }
  function revert() {
    try { stopGuard(); } catch (e) {}
    try { unwrap(); } catch (e) {}
    try { unhookErrors(); } catch (e) {}
    pending = null;
    try { window.__mlsAssistantSelfFix.installed = false; } catch (e) {}
  }

  window.__mlsAssistantSelfFix = {
    installed: true, version: VERSION, asset: ASSET,
    /* public, read-only introspection + diagnosis (also usable from console) */
    introspect: introspect,
    diagnose: diagnose,
    modules: enumModules,
    recentErrors: recentErrors,
    actionLog: function () { return ACTION_LOG.slice(); },
    /* the in-chat intent handler (exposed for testing) */
    handle: handleSelfFix,
    revert: revert,
    reapply: boot
  };

  try { boot(); } catch (e) { /* never throw at load */ }
})();
