/* ============================================================================
 * feat_opnote_onscreen.js  ->  window.__mlsOpNoteOnscreen   (v1.1.0)
 * ----------------------------------------------------------------------------
 * Makes OPERATIVE / PROCEDURE notes look as clean ON SCREEN as they do in the
 * exported PDF, without rebuilding the PDF or the op-note format engine.
 *
 * It REUSES the existing section-53 engine (window.__mlsOpNotePro: normalize /
 * parseNote / isNormalized). It NEVER invents sections; undictated sections keep
 * the engine's "[not dictated]" placeholder. It is purely additive, own-scope,
 * idempotent, all work in try/catch, and fully reversible via
 * window.__mlsOpNoteOnscreen.revert().
 *
 * Two surfaces are upgraded:
 *
 *  1) RENDERED HTML view - the section-45 per-visit detail card read view and
 *     the section-47 note-detail modal. Both render a ".mlsvd-body.mlsvd-read"
 *     whose operative note appeared only as a flat run-on blob inside the
 *     collapsed "Full captured visit data" <pre>. We DO NOT wrap buildRead
 *     (another module already wraps it with a shared-original pattern, so a
 *     second wrapper there can recurse). Instead a MutationObserver watches for
 *     a freshly rendered read view and, when its raw text is an op note, parses
 *     it with the engine and injects a structured block: bold section headings,
 *     bulleted lists for codes / medications / specimens, clear spacing - the
 *     same heading structure the PDF uses. Idempotent (skips bodies already
 *     processed), so it never duplicates and never interferes with other wraps.
 *
 *  2) PLAIN editable TEXT box - the history raw-note editor (#viewBody), which
 *     cannot host rich HTML. When it holds an op note we normalise the TEXT
 *     itself (lossless, via the engine) so even as plain text it reads with
 *     clear heading lines, blank-line separation between sections and dash
 *     bullets. Editing is never broken (it stays a normal <textarea>).
 *
 * The main visit-page op-note box (#procNoteBody) and #noteBox already receive
 * the section-21 __mlsFormat styled preview over normalised text, so they are
 * left to those modules (no double-handling / no conflict).
 * ==========================================================================*/
(function () {
  "use strict";
  var NS = "__mlsOpNoteOnscreen";
  if (window[NS] && window[NS].installed) return; // idempotent

  var VERSION = "1.1.0";

  /* ---------- tiny helpers ------------------------------------------------ */
  function eng() { return window.__mlsOpNotePro || null; }
  function S(x) { return x == null ? "" : String(x); }
  function mk(tag, cls) { var e = document.createElement(tag); if (cls) e.className = cls; return e; }

  var LIST_HEADINGS = /\b(CODES|MEDICATIONS|SPECIMENS)\b/i;

  /* ---------- is this an operative / procedure note? ---------------------- */
  function looksOp(text) {
    var t = S(text);
    if (!t.trim()) return false;
    var E = eng();
    try { if (E && E.isNormalized(t)) return true; } catch (e) {}
    return /\b(pre[\s-]?operative diagnosis|post[\s-]?operative diagnosis|operative note|procedure note|description of procedure|procedure performed|operation performed|anesthesia|epidural|injection|arthro|tfesi|esi)\b/i.test(t);
  }

  /* ---------- normalise text through the engine (lossless) ---------------- */
  function normalized(text) {
    var t = S(text);
    var E = eng();
    if (!E) return t;
    try { if (E.isNormalized(t)) return t; } catch (e) {}
    try { var n = E.normalize(t); if (n && n.length) return n; } catch (e2) {}
    return t;
  }

  /* ---------- decide bullets vs prose for one section -------------------- */
  function isBulletyLine(l) {
    return /^\s*[-\u2022*]\s+/.test(l) || /^\s*\d+[.)]\s+/.test(l);
  }
  function stripBullet(l) {
    return l.replace(/^\s*[-\u2022*]\s+/, "").replace(/^\s*\d+[.)]\s+/, "").trim();
  }

  /* ---------- render structured op-note HTML from text ------------------- */
  function renderOpNoteHtml(rawText) {
    var wrap = mk("div", "mls-opx");
    var E = eng();
    var t = normalized(rawText);

    var parsed = null;
    try { parsed = E && E.parseNote ? E.parseNote(t) : null; } catch (e) {}

    if (!parsed || !parsed.order) {
      var lines0 = t.split(/\n/);
      lines0.forEach(function (ln) {
        if (!ln.trim()) { wrap.appendChild(mk("div", "mls-opx-gap")); return; }
        if (/^[A-Z0-9 ()\/.,'+-]{3,}:?\s*$/.test(ln) && /[A-Z]/.test(ln)) {
          var h0 = mk("div", "mls-opx-h"); h0.textContent = ln.replace(/:\s*$/, ""); wrap.appendChild(h0);
        } else {
          var p0 = mk("div", "mls-opx-p"); p0.textContent = ln; wrap.appendChild(p0);
        }
      });
      return wrap;
    }

    var hdr = parsed.header || {};
    var hdrLines = [];
    if (hdr.patient) hdrLines.push(S(hdr.patient));
    if (hdr.dop) hdrLines.push("Date of Procedure: " + S(hdr.dop));
    if (hdrLines.length) {
      var hb = mk("div", "mls-opx-hdr");
      hdrLines.forEach(function (l) { var d = mk("div"); d.textContent = l; hb.appendChild(d); });
      wrap.appendChild(hb);
    }

    var order = parsed.order || [];
    var sec = parsed.sec || {};

    order.forEach(function (heading) {
      var block = mk("div", "mls-opx-sec");
      var h = mk("div", "mls-opx-h"); h.textContent = heading; block.appendChild(h);

      var body = (sec[heading] || []).map(S).filter(function (l) { return l != null; });

      var allNa = body.length > 0 && body.every(function (l) {
        return /^\s*\[not dictated\]\s*$/i.test(l) || !l.trim();
      });
      var bullety = !allNa && (LIST_HEADINGS.test(heading) ||
        (body.length > 1 && body.filter(isBulletyLine).length >= Math.max(1, body.length - 1)));

      if (!body.length || allNa) {
        var na = mk("div", "mls-opx-na"); na.textContent = "[not dictated]"; block.appendChild(na);
      } else if (bullety) {
        var ul = mk("ul", "mls-opx-ul");
        body.forEach(function (l) {
          if (!l.trim()) return;
          var li = mk("li"); li.textContent = stripBullet(l); ul.appendChild(li);
        });
        block.appendChild(ul.children.length ? ul : naDiv());
      } else {
        body.forEach(function (l) {
          var cls = /^\s*\[not dictated\]\s*$/i.test(l) ? "mls-opx-na" : "mls-opx-p";
          var p = mk("div", cls); p.textContent = l; block.appendChild(p);
        });
      }
      wrap.appendChild(block);
    });

    var unm = (parsed.unmatched || []).map(S).filter(function (l) { return l && l.trim(); });
    if (unm.length) {
      var ub = mk("div", "mls-opx-sec");
      var uh = mk("div", "mls-opx-h"); uh.textContent = "ADDITIONAL DOCUMENTATION"; ub.appendChild(uh);
      unm.forEach(function (l) { var p = mk("div", "mls-opx-p"); p.textContent = l; ub.appendChild(p); });
      wrap.appendChild(ub);
    }
    return wrap;
    function naDiv() { var d = mk("div", "mls-opx-na"); d.textContent = "[not dictated]"; return d; }
  }

  /* ---------- 1) enhance a rendered read view (NO function wrapping) ------ */
  // Reads the op-note text straight out of the rendered "Full captured visit
  // data" <pre>, so it is independent of how buildRead is wrapped by others.
  function enhanceReadView(body) {
    try {
      if (!body || body.querySelector(".mls-opx-host")) return; // idempotent
      var det = body.querySelector("details.mlsvd-raw");
      if (!det) return;
      var pre = det.querySelector("pre");
      var raw = pre ? S(pre.textContent) : "";
      if (!raw || !looksOp(raw)) return;

      var section = mk("div", "mlsvd-sec mls-opx-host");
      var lbl = mk("div", "mlsvd-lbl"); lbl.textContent = "Operative note";
      section.appendChild(lbl);
      section.appendChild(renderOpNoteHtml(raw));
      det.parentNode.insertBefore(section, det);
      // keep the raw text available but collapsed & relabelled
      det.classList.add("mls-opx-rawmoved");
      det.removeAttribute("open");
      var sum = det.querySelector("summary");
      if (sum) sum.textContent = "Raw captured text";
    } catch (e) {}
  }

  function sweep() {
    try {
      var views = document.querySelectorAll(".mlsvd-body.mlsvd-read, .mlsvd-read");
      for (var i = 0; i < views.length; i++) enhanceReadView(views[i]);
    } catch (e) {}
  }

  var _obs = null, _deb = null;
  function startObserver() {
    if (_obs) return;
    _obs = new MutationObserver(function (muts) {
      // cheap relevance gate: only react when element nodes were added
      var relevant = false;
      for (var i = 0; i < muts.length; i++) {
        if (muts[i].addedNodes && muts[i].addedNodes.length) { relevant = true; break; }
      }
      if (!relevant) return;
      clearTimeout(_deb);
      _deb = setTimeout(sweep, 40);
    });
    _obs.observe(document.documentElement, { childList: true, subtree: true });
    sweep(); // initial pass for anything already on screen
  }

  /* ---------- 2) normalise the plain #viewBody op-note editor ------------- */
  function normalizeViewBody() {
    var ta = document.getElementById("viewBody");
    if (!ta) return;
    var v = ta.value || "";
    if (!v.trim() || !looksOp(v)) return;
    var E = eng();
    if (!E) return;
    try {
      if (E.isNormalized(v)) return;     // already structured - leave it
      var nv = E.normalize(v);           // lossless restructure
      if (nv && nv.length && nv !== v) {
        ta.value = nv;                   // display-only; persisted only if the user saves
      }
    } catch (e) {}
  }

  var _viewObs = null;
  function watchViewModal() {
    var modal = document.getElementById("viewModal");
    if (!modal || _viewObs) return;
    var deb = null;
    var run = function () {
      var shown = modal.style.display !== "none" &&
        getComputedStyle(modal).display !== "none";
      if (shown) { clearTimeout(deb); deb = setTimeout(normalizeViewBody, 60); }
    };
    _viewObs = new MutationObserver(run);
    _viewObs.observe(modal, { attributes: true, attributeFilter: ["style", "class"] });
    run();
  }

  /* ---------- styles ------------------------------------------------------ */
  var STYLE_ID = "mls-opx-style";
  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var css =
      ".mls-opx{color:var(--ink,#15293f);font-size:13px;line-height:1.5;}" +
      ".mls-opx-hdr{color:var(--ink,#15293f);opacity:.85;font-size:12px;margin:2px 0 10px;padding-bottom:8px;border-bottom:1px solid var(--line,#e3e8ef);}" +
      ".mls-opx-hdr div{margin:1px 0;}" +
      ".mls-opx-sec{margin:0 0 11px;}" +
      ".mls-opx-h{font-weight:700;color:var(--brand,#2563c9);letter-spacing:.04em;font-size:11.5px;text-transform:uppercase;margin:0 0 3px;}" +
      ".mls-opx-p{color:var(--ink,#15293f);margin:0 0 3px;white-space:pre-wrap;}" +
      ".mls-opx-na{color:var(--ink,#15293f);opacity:.5;font-style:italic;margin:0 0 3px;}" +
      ".mls-opx-ul{margin:2px 0 4px;padding-left:18px;}" +
      ".mls-opx-ul li{color:var(--ink,#15293f);margin:1px 0;}" +
      ".mls-opx-gap{height:5px;}" +
      "details.mls-opx-rawmoved>summary{opacity:.6;font-size:12px;}";
    var st = document.createElement("style");
    st.id = STYLE_ID; st.textContent = css;
    (document.head || document.documentElement).appendChild(st);
  }

  /* ---------- boot -------------------------------------------------------- */
  function boot() {
    injectStyle();
    startObserver();
    watchViewModal();
  }

  /* ---------- public API -------------------------------------------------- */
  window[NS] = {
    installed: true,
    version: VERSION,
    looksOp: looksOp,
    renderOpNoteHtml: renderOpNoteHtml,
    enhanceReadView: enhanceReadView,
    sweep: sweep,
    normalizeViewBody: normalizeViewBody,
    revert: function () {
      try { if (_obs) { _obs.disconnect(); _obs = null; } } catch (e1) {}
      try { if (_viewObs) { _viewObs.disconnect(); _viewObs = null; } } catch (e2) {}
      try { var s = document.getElementById(STYLE_ID); if (s) s.remove(); } catch (e3) {}
      try {
        document.querySelectorAll("details.mls-opx-rawmoved").forEach(function (d) {
          d.classList.remove("mls-opx-rawmoved");
          var sum = d.querySelector("summary"); if (sum) sum.textContent = "Full captured visit data";
        });
        document.querySelectorAll(".mls-opx-host").forEach(function (h) { h.remove(); });
      } catch (e4) {}
      try { window[NS].installed = false; } catch (e5) {}
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
