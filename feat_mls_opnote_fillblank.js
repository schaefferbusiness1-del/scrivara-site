/* feat_mls_opnote_fillblank.js  ->  window.__mlsOpFill   (of-1.0.0)
 *
 * item14 (additive, reversible) -- RESTORE the FILL-IN-THE-BLANK op note.
 *
 * The deterministic injection / procedure-note builder (#procNoteCard, driven
 * by window.generateProcNote -> #procNoteBody) produces a structured operative
 * note with "[... provider to complete]" fill-in-the-blank fields. That builder
 * still works, but the 2026 Visit redesign relocated it into the collapsed
 * "Clinical tools" group (#visitToolsGroup) inside a collapsed card, so doctors
 * could no longer find it ("the fill-in-the-blank op note went away").
 *
 * This asset brings it back to ONE CLICK: it adds a "Fill-in-the-blank op note"
 * quick-action on the Visit hero (next to "Prep op note"), cloned from the
 * existing quick-action button so styling is identical. Clicking it reveals
 * #visitToolsGroup (via the app\u0027s own toggleVisitTools), opens the
 * collapsible #procNoteCard, scrolls to it and focuses the Procedure picker.
 *
 * It does NOT change op-note logic, call the AI, or touch athenaOne. Purely
 * additive, own-scope, idempotent, guarded, reversible: window.__mlsOpFill.revert().
 */
(function () {
  "use strict";
  try { if (window.__mlsOpFill && window.__mlsOpFill.installed) return; } catch (e) { return; }

  var BTN_ID = "mlsOpFillBtn";
  var STATE = { installed: true, obs: null, pending: false };

  function revealBuilder() {
    try {
      var g = document.getElementById("visitToolsGroup");
      if (g) {
        var disp = (g.style.display || getComputedStyle(g).display);
        if (disp === "none") {
          if (typeof window.toggleVisitTools === "function") {
            try { window.toggleVisitTools(); } catch (e) { g.style.display = "block"; }
          } else { g.style.display = "block"; }
        }
      }
      var card = document.getElementById("procNoteCard");
      if (card) {
        if (card.classList.contains("collapsible")) card.classList.add("open");
        var cb = card.querySelector(".collapse-body");
        if (cb && getComputedStyle(cb).display === "none") cb.style.display = "block";
        var ct = card.querySelector(".collapse-caret");
        if (ct) ct.textContent = "\u25BE";
        try { card.scrollIntoView({ behavior: "smooth", block: "center" }); } catch (e) {}
        var sel = document.getElementById("procType");
        if (sel) setTimeout(function () { try { sel.focus({ preventScroll: true }); } catch (e) {} }, 350);
      }
    } catch (e) {}
  }

  function findPrepBtn() {
    try {
      var b = document.querySelectorAll(".vx-qbtn");
      for (var i = 0; i < b.length; i++) {
        if (/prep op ?note/i.test(b[i].textContent || "")) return b[i];
      }
    } catch (e) {}
    return null;
  }

  function setLabels(btn) {
    try {
      var icon = btn.children[0];
      if (icon) icon.textContent = "\uD83D\uDCDD";
      var t = btn.children[1];
      if (t && t.children.length >= 2) {
        t.children[0].textContent = "Fill-in-the-blank op note";
        t.children[1].textContent = "Structured note with blanks to complete";
      }
    } catch (e) {}
  }

  function inject() {
    try {
      if (document.getElementById(BTN_ID)) return true;
      var prep = findPrepBtn();
      if (!prep) return false;
      if (!document.getElementById("procNoteCard") && typeof window.generateProcNote !== "function") return false;
      var clone = prep.cloneNode(true);
      clone.id = BTN_ID;
      clone.removeAttribute("onclick");
      clone.onclick = null;
      setLabels(clone);
      clone.addEventListener("click", function (ev) {
        try { ev.preventDefault(); ev.stopPropagation(); } catch (e) {}
        revealBuilder();
      });
      if (prep.nextSibling) prep.parentNode.insertBefore(clone, prep.nextSibling);
      else prep.parentNode.appendChild(clone);
      return true;
    } catch (e) { return false; }
  }

  function schedule() {
    if (STATE.pending) return;
    STATE.pending = true;
    setTimeout(function () { STATE.pending = false; inject(); }, 150);
  }

  function start() {
    inject();
    try {
      STATE.obs = new MutationObserver(function () {
        if (!document.getElementById(BTN_ID)) schedule();
      });
      STATE.obs.observe(document.documentElement, { childList: true, subtree: true });
    } catch (e) {}
  }

  window.__mlsOpFill = {
    installed: true,
    version: "of-1.0.0",
    open: revealBuilder,
    revert: function () {
      try { var b = document.getElementById(BTN_ID); if (b && b.parentNode) b.parentNode.removeChild(b); } catch (e) {}
      try { if (STATE.obs) { STATE.obs.disconnect(); STATE.obs = null; } } catch (e) {}
      try { window.__mlsOpFill.installed = false; } catch (e) {}
      return true;
    }
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
