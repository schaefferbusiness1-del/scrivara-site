/* feat_mls_visit_timeline_detail.js -> window.__mlsVisitTimelineDetail (vtd-1.0.0)
 * ITEM 17: Make per-visit rows in the patient "Visit timeline" (#ptTimeline) open
 * the REAL detail for THAT specific visit instead of a generic "see patient
 * summary" scroll.
 *
 * Background: real saved-note rows already open the full note (openNoteFromHistory).
 * The summary-derived rows added by feat_mls_timeline_sync.js (.mls-tl-hist) only
 * scrolled to the patient summary -- generic, not the specific visit. This asset
 * upgrades ONLY those rows:
 *   1) If a saved visit NOTE exists for that visit's date, clicking opens that
 *      note via the app's own openNoteFromHistory -- exactly what happened.
 *   2) Otherwise it expands an inline detail panel built ONLY from the patient's
 *      own record: the exact summary block for that visit (its line + any
 *      sub-detail lines under it). Nothing is invented.
 *   3) If the record genuinely holds no detail beyond the one summary line, the
 *      panel says so honestly ("No detailed visit note is stored...") rather than
 *      fabricating content.
 *
 * Additive, idempotent, ASCII-only, reversible: window.__mlsVisitTimelineDetail.revert().
 */
(function () {
  "use strict";
  try { if (window.__mlsVisitTimelineDetail && window.__mlsVisitTimelineDetail.installed) return; } catch (e) { return; }

  var VERSION = "vtd-1.0.0";
  var WRAP_ID = "ptTimeline";
  var STYLE_ID = "mlsVtdCss";
  var FLAG = "__mlsVtdBound";

  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function norm(s) { return String(s == null ? "" : s).replace(/^[\s•●‣⁃\*\-]+/, "").trim(); }

  function parseDate(s) {
    var tl = safe(function () { return window.__mlsTl; });
    if (tl && typeof tl.parseDate === "function") { var r = safe(function () { return tl.parseDate(s); }); if (r) return r; }
    var m = String(s || "").match(/\b([01]?\d)[\/\-]([0-3]?\d)[\/\-]((?:19|20)?\d\d)\b/);
    if (m) {
      var yr = m[3].length === 2 ? (parseInt(m[3], 10) > 50 ? 1900 + +m[3] : 2000 + +m[3]) : +m[3];
      var d = new Date(yr, (+m[1]) - 1, +m[2]);
      if (!isNaN(d)) return { ms: d.getTime(), dayKey: yr + "-" + (+m[1]) + "-" + (+m[2]) };
    }
    return null;
  }

  function activePt() {
    return safe(function () { return typeof window.activePatient === "function" ? window.activePatient() : null; });
  }

  function matchingNote(p, dayKey) {
    if (!p || !dayKey) return null;
    return safe(function () {
      if (typeof window.patientNotes !== "function") return null;
      var found = null;
      window.patientNotes(p.id).forEach(function (n) {
        var d = new Date(n.updated || n.created || 0);
        if (isNaN(d)) return;
        var k = d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
        if (k === dayKey) found = n;
      });
      return found;
    }, null);
  }

  // Build the exact summary block for one visit line (line + its sub-detail).
  function visitBlock(p, label) {
    var sum = safe(function () { return String(p && p.summary || ""); }, "");
    if (!sum) return "";
    var lines = sum.split(/\r?\n/);
    var target = norm(label);
    if (!target) return "";
    var idx = -1;
    for (var i = 0; i < lines.length; i++) {
      var nl = norm(lines[i]);
      if (nl === target || (target.length > 6 && nl.indexOf(target) === 0)) { idx = i; break; }
    }
    if (idx < 0) return "";
    var block = [norm(lines[idx])];
    for (var j = idx + 1; j < lines.length; j++) {
      var t = lines[j]; var nt = norm(t);
      if (nt === "") break;
      if (/:$/.test(t.trim())) break;
      if (parseDate(nt)) break;
      block.push(nt);
    }
    return block.join("\n");
  }

  function injectCss() {
    if (safe(function () { return document.getElementById(STYLE_ID); })) return;
    var css = [
      ".mls-vtd-panel{margin:2px 0 8px;padding:11px 13px;border:1px solid var(--line,#e6e9ef);",
      "border-left:3px solid var(--brand,#2563c9);border-radius:10px;background:var(--card,#fff);",
      "font-size:13px;line-height:1.5;color:var(--ink,#15293f);white-space:pre-wrap;}",
      ".mls-vtd-panel .mls-vtd-h{font-weight:700;margin:0 0 4px;}",
      ".mls-vtd-panel .mls-vtd-note{color:var(--muted,#5b6b7c);font-style:italic;white-space:normal;}",
      ".mls-tl-hist{cursor:pointer;}"
    ].join("");
    var s = safe(function () { return document.createElement("style"); });
    if (!s) return;
    s.id = STYLE_ID; s.textContent = css;
    safe(function () { (document.head || document.documentElement).appendChild(s); });
  }

  function closePanel(row) {
    var pnl = row.__mlsVtdPanel;
    if (pnl && pnl.parentNode) pnl.parentNode.removeChild(pnl);
    row.__mlsVtdPanel = null;
  }

  function onRowClick(row) {
    if (row.__mlsVtdPanel) { closePanel(row); return; }   // toggle closed
    var p = activePt();
    var labelEl = safe(function () { return row.querySelector(".t"); });
    var label = labelEl ? labelEl.textContent : (row.textContent || "");
    var pd = parseDate(label);
    var note = matchingNote(p, pd && pd.dayKey);
    if (note && typeof window.openNoteFromHistory === "function") {
      safe(function () { window.openNoteFromHistory(note.id); });   // real, full visit note
      return;
    }
    // inline panel from the record's own summary block
    var block = visitBlock(p, label);
    var extra = "";
    if (block) {
      var bl = block.split(/\r?\n/);
      if (bl.length > 1) extra = bl.slice(1).join("\n").trim();
    }
    var inner = '<div class="mls-vtd-h">' + esc(norm(label)) + "</div>";
    if (extra) inner += esc(extra);
    else inner += '<div class="mls-vtd-note">No detailed visit note is stored for this visit. '
      + "The only record is this summary line; nothing further was documented.</div>";
    var pnl = safe(function () { return document.createElement("div"); });
    if (!pnl) return;
    pnl.className = "mls-vtd-panel";
    pnl.innerHTML = inner;
    safe(function () { row.parentNode.insertBefore(pnl, row.nextSibling); });
    row.__mlsVtdPanel = pnl;
  }

  // Replace a .mls-tl-hist row with a clone (strips item8's scroll listener),
  // then bind our click handler. Idempotent via FLAG on the live node.
  function enhance(row) {
    if (!row || row[FLAG]) return;
    var clone = safe(function () { return row.cloneNode(true); });
    if (!clone) { row[FLAG] = 1; return; }
    clone[FLAG] = 1;
    safe(function () { clone.addEventListener("click", function () { onRowClick(clone); }); });
    safe(function () { row.parentNode.replaceChild(clone, row); });
  }

  function scan() {
    var wrap = safe(function () { return document.getElementById(WRAP_ID); });
    if (!wrap) return;
    var rows = safe(function () { return wrap.querySelectorAll(".mls-tl-hist"); }, []);
    Array.prototype.forEach.call(rows, function (r) { if (!r[FLAG]) enhance(r); });
  }

  var _obs = null;
  function boot() {
    injectCss();
    _obs = safe(function () { return new MutationObserver(function () { scan(); }); }, null);
    safe(function () {
      var wrap = document.getElementById(WRAP_ID);
      if (_obs && wrap) _obs.observe(wrap, { childList: true });
    });
    scan();
    var n = 0, t = setInterval(function () {
      n++; scan();
      safe(function () { var w = document.getElementById(WRAP_ID); if (_obs && w) _obs.observe(w, { childList: true }); });
      if (n >= 25) clearInterval(t);
    }, 400);
  }

  function revert() {
    safe(function () { if (_obs) _obs.disconnect(); }); _obs = null;
    safe(function () {
      var wrap = document.getElementById(WRAP_ID);
      if (wrap) wrap.querySelectorAll(".mls-vtd-panel").forEach(function (el) { el.remove(); });
    });
    safe(function () { var s = document.getElementById(STYLE_ID); if (s) s.remove(); });
    safe(function () { window.__mlsVisitTimelineDetail.installed = false; });
    // Cloned rows keep our handler until the next renderPtTimeline rebuild, which
    // regenerates fresh rows (item8) -- harmless and self-healing.
  }

  window.__mlsVisitTimelineDetail = { installed: true, version: VERSION, scan: scan, revert: revert };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
