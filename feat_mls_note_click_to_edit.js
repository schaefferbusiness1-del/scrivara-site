/* =========================================================================
 * MLS Scribe — CLICK THE NOTE, EDIT THE NOTE  (__mlsNoteClickToEdit) nce-1.0.0
 * 2026-07-29
 *
 * OWNER REPORT: "when i click in the middle of the note it should break
 * everything" — clicking mid-text in the note does not do the one thing a
 * doctor expects: put the caret there so he can type.
 *
 * WHY it could not: __mlsFormat renders a FORMATTED PREVIEW (.mlsf-note) and
 * sets the real editor (#noteBox) to display:none whenever the note has
 * content. The only control that switched back to the editor was the "Edit"
 * button inside .mlsf-bar — and the b779 visit-focus fold hides .mlsf-bar
 * inside #noteCard. So the preview was the only thing on screen, it is not
 * editable, and every click on it did nothing. (The 2026-07-29 QA sweep
 * recorded the same root cause from the other direction: the whole ne-1.1.0
 * editor feature set became unreachable once .mlsf-bar was folded.)
 *
 * WHAT THIS DOES: a click on the formatted preview reveals the editor, focuses
 * it, and places the caret at the character the doctor actually clicked —
 * mapped through caretRangeFromPoint/caretPositionFromPoint and translated
 * into an offset in the editor's plain text. If the mapping is not available
 * or the click was not on text, it still reveals + focuses the editor rather
 * than swallowing the click, so the note is never a dead surface.
 *
 * DELIBERATELY NARROW:
 *  - It never writes the note's TEXT. It only changes display/focus/selection,
 *    so it cannot corrupt or reorder a note.
 *  - It refuses while a selection is being dragged (a real text selection in
 *    the preview is a copy gesture, not an edit gesture).
 *  - It refuses on interactive descendants (buttons/links/inputs) so existing
 *    controls inside the note keep their behaviour.
 *  - It does nothing while recording is active.
 *  - One capture-phase document listener, no timers, no observers.
 *
 * Idempotent; additive. Revert: window.__mlsNoteClickToEdit.revert()
 * ------------------------------------------------------------------------- */
(function () {
  'use strict';
  try { if (window.__mlsNoteClickToEdit) return; } catch (e) { return; }

  var D = document;
  function safe(fn, dflt) { try { return fn(); } catch (e) { return dflt; } }

  var api = { version: 'nce-1.0.0', installed: true, opened: 0, caretPlaced: 0 };
  window.__mlsNoteClickToEdit = api;

  function editor() { return safe(function () { return D.getElementById('noteBox'); }, null); }

  function recording() {
    return safe(function () {
      if (typeof window.isRecording === 'function' && window.isRecording()) return true;
      var t = D.getElementById('transcript');
      return !!(t && t.getAttribute && t.getAttribute('data-recording') === '1');
    }, false);
  }

  /* A real drag-selection in the preview is a COPY gesture. Only a plain
     caret-placing click means "let me edit". */
  function hasSelectionText() {
    return safe(function () {
      var s = window.getSelection && window.getSelection();
      return !!(s && String(s.toString() || '').length > 0);
    }, false);
  }

  function interactive(el) {
    return safe(function () {
      return !!(el && el.closest && el.closest('button,a,input,textarea,select,[contenteditable="true"],[role="button"]'));
    }, false);
  }

  /* Map the clicked point to a character offset in the PREVIEW's text, then use
     that same offset in the editor. The preview is a rendering of the same
     text, so offsets line up closely enough to land the caret in the right
     sentence; being a line or two out is still hugely better than no caret at
     all, and we never touch the text itself. */
  function offsetAt(previewEl, x, y) {
    return safe(function () {
      var node = null, off = 0;
      if (D.caretRangeFromPoint) {
        var r = D.caretRangeFromPoint(x, y);
        if (r) { node = r.startContainer; off = r.startOffset; }
      } else if (D.caretPositionFromPoint) {
        var p = D.caretPositionFromPoint(x, y);
        if (p) { node = p.offsetNode; off = p.offset; }
      }
      if (!node) return -1;
      /* walk the preview's text nodes, summing lengths until we reach the hit
         node, so the offset is relative to the whole preview */
      var total = 0, found = -1;
      var walker = D.createTreeWalker(previewEl, NodeFilter.SHOW_TEXT, null);
      var n;
      while ((n = walker.nextNode())) {
        if (n === node) { found = total + Math.max(0, Math.min(off, (n.nodeValue || '').length)); break; }
        total += (n.nodeValue || '').length;
      }
      return found;
    }, -1);
  }

  function onClick(e) {
    if (!e || e.defaultPrevented) return;
    var preview = safe(function () {
      return e.target && e.target.closest ? e.target.closest('.mlsf-note') : null;
    }, null);
    if (!preview) return;
    if (interactive(e.target)) return;       /* let real controls work */
    if (hasSelectionText()) return;          /* copying, not editing */
    if (recording()) return;                 /* never move focus mid-capture */

    var nb = editor();
    if (!nb) return;

    var off = offsetAt(preview, e.clientX, e.clientY);

    /* Reveal the editor. __mlsFormat hid it with an INLINE style, so an inline
       write is what un-hides it. */
    safe(function () { if (nb.style.display === 'none') { nb.style.display = 'block'; api.opened++; } });
    safe(function () { nb.focus(); });
    if (off >= 0) {
      safe(function () {
        var max = String(nb.value || '').length;
        var at = Math.max(0, Math.min(off, max));
        nb.setSelectionRange(at, at);
        api.caretPlaced++;
      });
    }
    /* The click has been consumed as an edit gesture. Stop it here so a parent
       handler cannot immediately re-render the card and undo the focus. */
    safe(function () { e.stopPropagation(); });
  }

  safe(function () { D.addEventListener('click', onClick, true); });

  window.__mlsNoteClickToEdit.revert = function () {
    safe(function () { D.removeEventListener('click', onClick, true); });
    safe(function () { delete window.__mlsNoteClickToEdit; });
  };
})();
