/* ============================================================================
 * feat_opnote_onscreen.js  ->  window.__mlsOpNoteOnscreen   (v1.0.1)
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
 *     the section-47 note-detail modal (both produced by
 *     __mlsVisitDetail.buildRead). The op note previously appeared only as a
 *     flat run-on blob inside the collapsed "Full captured visit data" <pre>.
 *     We parse that text with the engine and render it with real structure:
 *     bold section headings, bulleted lists for codes / medications / specimens,
 *     and clear spacing - the same heading structure the PDF uses.
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
 *
 * v1.0.1: buildRead wrap now captures the original in a CLOSURE (never a shared
 * module variable) and the injection is idempotent (skips if a formatted block
 * is already present), so re-wrapping by other modules can never recurse or
 * duplicate the UI.
 * ==========================================================================*/
(function () {
  "use strict";
  var NS = "__mlsOpNoteOnscreen";
  if (window[NS] && window[NS].installed) return; // idempotent

  var VERSION = "1.0.1";

  /* ---------- tiny helpers ------------------------------------------------ */
  function eng() { return window.__mlsOpNotePro || null; }
  function S(x) { return x == null ? "" : String(x); }
  function mk(tag, cls) { var e = document.createElement(tag); if (cls) e.className = cls; return e; }

  // Heading set that always reads as a bulleted list (codes / meds / specimens).
  var LIST_HEADINGS = /\b(CODES|MEDICATIONS|SPECIMENS)\b/i;

  /* ---------- is this an operative / procedure note? ---------------------- */
  function looksOp(text, visit) {
    var t = S(text);
    if (!t.trim()) return false;
    var type = visit ? S(visit.type).toLowerCase() : "";
    if (/operative|procedure|injection|op[\s-]?note/.test(type)) return true;
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
  // Returns a DOM node (".mls-opx") whose structure mirrors the PDF.
  function renderOpNoteHtml(rawText) {
    var wrap = mk("div", "mls-opx");
    var E = eng();
    var t = normalized(rawText);

    var parsed = null;
    try { parsed = E && E.parseNote ? E.parseNote(t) : null; } catch (e) {}

    // Fallback: if the engine can't parse, do a light line-based structuring
    // (bold ALL-CAPS heading lines, paragraphs otherwise) so we still degrade
    // to something readable rather than a blob.
    if (!parsed || !parsed.order) {
      var lines = t.split(/\n/);
      lines.forEach(function (ln) {
        if (!ln.trim()) { wrap.appendChild(mk("div", "mls-opx-gap")); return; }
        if (/^[A-Z0-9 ()\/.,'+-]{3,}:?\s*$/.test(ln) && /[A-Z]/.test(ln)) {
          var h = mk("div", "mls-opx-h"); h.textContent = ln.replace(/:\s*$/, ""); wrap.appendChild(h);
        } else {
          var p = mk("div", "mls-opx-p"); p.textContent = ln; wrap.appendChild(p);
        }
      });
      return wrap;
    }

    // Header block (patient / DOP lines), shown muted at the top.
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

      var lines = (sec[heading] || []).map(S);
      var body = lines.filter(function (l) { return l != null; });

      // a section whose only content is the placeholder reads as "[not dictated]"
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

    // Anything the engine could not map is preserved under ADDITIONAL DOCUMENTATION.
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

  /* ---------- 1) wrap __mlsVisitDetail.buildRead (detail card + modal) ----
   * The original is captured in a CLOSURE (orig) - never a shared variable -
   * so layering with other modules' wrappers can never recurse. Injection is
   * idempotent: if the produced body already contains a formatted block, we
   * leave it alone (no duplicate sections even if wrapped more than once).      */
  function wrapBuildRead() {
    var VD = window.__mlsVisitDetail;
    if (!VD || typeof VD.buildRead !== "function") return false;
    if (VD.buildRead.__mlsOpxWrapped) return true;
    var orig = VD.buildRead;
    var wrapped = function (visit) {
      var r = orig.apply(this, arguments);
      try {
        if (r && r.body && visit && !r.body.querySelector(".mls-opx-host")) {
          var raw = S(visit.raw);
          if (raw && looksOp(raw, visit)) {
            var det = r.body.querySelector("details.mlsvd-raw");
            var formatted = renderOpNoteHtml(raw);
            var section = mk("div", "mlsvd-sec mls-opx-host");
            var lbl = mk("div", "mlsvd-lbl"); lbl.textContent = "Operative note";
            section.appendChild(lbl);
            section.appendChild(formatted);
            if (det && det.parentNode) {
              det.parentNode.insertBefore(section, det);
              // Keep the original raw text available but collapsed & relabelled.
              det.classList.add("mls-opx-rawmoved");
              det.removeAttribute("open");
              var sum = det.querySelector("summary");
              if (sum) sum.textContent = "Raw captured text";
            } else {
              r.body.appendChild(section);
            }
          }
        }
      } catch (e) {}
      return r;
    };
    wrapped.__mlsOpxWrapped = true;
    wrapped.__mlsOpxOrig = orig;
    VD.buildRead = wrapped;
    return true;
  }

  /* ---------- 2) normalise the plain #viewBody op-note editor ------------- */
  function normalizeViewBody() {
    var ta = document.getElementById("viewBody");
    if (!ta) return;
    var v = ta.value || "";
    if (!v.trim() || !looksOp(v, null)) return;
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

  /* ---------- boot (idempotent, no idle polling) -------------------------- */
  var _boot = null, _tries = 0;
  function boot() {
    injectStyle();
    var okBR = wrapBuildRead();
    watchViewModal();
    // Retry only until the modules exist, then stop (no idle loop).
    if ((!okBR || !document.getElementById("viewModal")) && _tries < 40) {
      _tries++;
      _boot = setTimeout(boot, 250);
    }
  }

  /* ---------- public API -------------------------------------------------- */
  window[NS] = {
    installed: true,
    version: VERSION,
    looksOp: looksOp,
    renderOpNoteHtml: renderOpNoteHtml,
    normalizeViewBody: normalizeViewBody,
    rewrap: function () { try { return wrapBuildRead(); } catch (e) { return false; } },
    revert: function () {
      try {
        var VD = window.__mlsVisitDetail;
        if (VD && VD.buildRead && VD.buildRead.__mlsOpxWrapped && VD.buildRead.__mlsOpxOrig) {
          VD.buildRead = VD.buildRead.__mlsOpxOrig;
        }
      } catch (e) {}
      try { if (_viewObs) { _viewObs.disconnect(); _viewObs = null; } } catch (e2) {}
      try { if (_boot) clearTimeout(_boot); } catch (e3) {}
      try { var s = document.getElementById(STYLE_ID); if (s) s.remove(); } catch (e4) {}
      try {
        document.querySelectorAll("details.mls-opx-rawmoved").forEach(function (d) {
          d.classList.remove("mls-opx-rawmoved");
          var sum = d.querySelector("summary"); if (sum) sum.textContent = "Full captured visit data";
        });
        document.querySelectorAll(".mls-opx-host").forEach(function (h) { h.remove(); });
      } catch (e5) {}
      try { window[NS].installed = false; } catch (e6) {}
    }
  };

  // boot() is idempotent: run now AND on DOMContentLoaded, robust whether the
  // loader injects this before or after the DOM is ready.
  boot();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  }
})();
