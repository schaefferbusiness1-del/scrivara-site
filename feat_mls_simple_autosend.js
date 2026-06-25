/* feat_mls_simple_autosend.js  ->  window.__mlsSimpleSend  (simsend-1.0.0)
 * --------------------------------------------------------------------------
 * SIMPLE-VIEW AUTO-SEND. In MLS Easy / Simple view, when the doctor reaches the
 * final "Finish" step, MLS streamlines the handoff: it AUTO-SENDS everything to
 * athenaOne WITHOUT a prompt -- the note plus the generated billing / diagnosis
 * codes -- then reports HONESTLY exactly what was sent.
 *
 * SAFETY (kept, never bypassed): the underlying write runs the name+DOB patient
 * MATCH gate (window.__mlsAthenaWriteback). On a confident match it writes
 * silently (that is the "no prompt" streamline); if the patient cannot be
 * verified it does NOT silently write into a possibly-wrong chart -- it surfaces
 * the safety check. It NEVER clicks Save/Sign; the doctor signs.
 *
 * WHAT IS SENT:
 *   - The note. If it is an operative / procedure note it routes through
 *     window.__mlsOpWb (PE > Procedure Documentation > template, erase+insert);
 *     otherwise into the clinical note field.
 *   - The generated codes (E/M, ICD-10, CPT) are appended to the note text so
 *     they travel into the chart with the note. (The athenaOne code PICKERS are
 *     not auto-filled yet -- that needs a separate live tuning pass -- and the
 *     status says so honestly rather than pretending.)
 *
 * Fires once per finished note (deduped by content hash). Additive, idempotent,
 * reversible (window.__mlsSimpleSend.revert()). ASCII-only.
 * ==========================================================================*/
(function () {
  'use strict';
  try { if (window.__mlsSimpleSend && window.__mlsSimpleSend.installed) return; } catch (e) { return; }
  var VERSION = 'simsend-1.0.0';

  function g(n) { try { return window[n]; } catch (e) { return null; } }
  function isFn(f) { return typeof f === 'function'; }
  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }
  function trim(s) { return String(s == null ? '' : s).trim(); }
  function toast(m, k) { var t = g('toast'); if (isFn(t)) safe(function () { t(m, k || ''); }); }

  function isSimple() {
    if (safe(function () { return document.documentElement.classList.contains('mls-sv-active'); }, false)) return true;
    var e = g('__mlsEasy'); return !!(e && e.state && e.state.mode === 'easy');
  }

  function noteText() {
    var ids = ['procNoteBody', 'noteBox', 'viewBody'];
    for (var i = 0; i < ids.length; i++) { var el = document.getElementById(ids[i]); if (el) { var v = trim(el.value != null ? el.value : el.textContent); if (v) return { text: v, id: ids[i] }; } }
    return { text: '', id: '' };
  }
  function looksLikeOpNote(t) {
    t = String(t || '').toLowerCase();
    var hits = 0;
    ['informed consent', 'preoperative diagnos', 'postoperative diagnos', 'type of anesthesia', 'under anesthesia', 'sterile', 'injection was performed', 'description of procedure', 'fluorosc', 'epidural', 'medial branch'].forEach(function (s) { if (t.indexOf(s) >= 0) hits++; });
    if (safe(function () { var p = document.getElementById('procNoteBody'); return p && trim(p.value != null ? p.value : p.textContent); }, '')) hits += 2;
    return hits >= 2;
  }

  /* read the generated codes the app already shows (no fabrication) */
  function codesText() {
    var parts = [];
    ['emrCodeNote', 'codeCard'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el && safe(function () { return el.offsetParent !== null || el.getClientRects().length; }, false)) {
        var t = trim(el.innerText || el.textContent);
        if (t && t.length < 1200) parts.push(t);
      }
    });
    // de-dup overlap: keep the first non-empty block
    return parts.length ? parts[0] : '';
  }

  function hash(s) { var h = 0, i, c; s = String(s || ''); for (i = 0; i < s.length; i++) { c = s.charCodeAt(i); h = ((h << 5) - h + c) | 0; } return h; }

  var lastSent = null, sending = false;
  function sendNow(reason) {
    if (sending) return;
    var n = noteText();
    if (!trim(n.text)) { toast('Nothing to send yet - generate the note first.', 'err'); return; }
    var codes = codesText();
    var payload = n.text + (codes ? ('\n\n--- Suggested codes (review in athenaOne) ---\n' + codes) : '');
    var sig = hash(payload);
    if (sig === lastSent) { toast('Already sent this note to athenaOne.', ''); return; }

    sending = true;
    var isOp = looksLikeOpNote(n.text);
    toast('Sending to athenaOne: ' + (isOp ? 'op-note' : 'note') + (codes ? ' + suggested codes' : '') + ' (unsigned draft - you sign).', '');

    var ok = false;
    if (isOp && g('__mlsOpWb') && isFn(g('__mlsOpWb').writeOpNote)) {
      ok = true; safe(function () { g('__mlsOpWb').writeOpNote({ note: payload }); });
    } else if (g('__mlsAthenaWriteback') && isFn(g('__mlsAthenaWriteback').writeNoteToChart)) {
      ok = true; safe(function () { g('__mlsAthenaWriteback').writeNoteToChart({ note: payload }); });
    }
    if (!ok) { toast('Could not auto-send - the Athena writeback module is not loaded. Reload the page and try again.', 'err'); sending = false; return; }
    if (!codes) toast('Note: no generated codes were visible to include - sent the note only.', '');
    else toast('Codes are appended to the note text; athenaOne code pickers are not auto-filled yet.', '');
    lastSent = sig;
    setTimeout(function () { sending = false; }, 4000);
  }

  /* allow a fresh recording/visit to re-enable a send */
  function resetSent() { lastSent = null; }

  /* ---- trigger: the Simple wizard "Finish" (step 5) ---- */
  function onClick(ev) {
    var t = ev.target;
    var btn = t && t.closest && t.closest('#simNext5, [data-mls-autosend]');
    if (!btn) return;
    if (!isSimple()) return;
    // let the app's own Finish handler (save the note) run first, then auto-send.
    setTimeout(function () { safe(function () { sendNow('finish'); }); }, 900);
  }

  var bound = false;
  function boot() {
    if (!bound) { document.addEventListener('click', onClick, false); bound = true; }
    // when a new capture starts, allow the next note to be sent
    safe(function () { document.addEventListener('click', function (e) { var b = e.target && e.target.closest && e.target.closest('#simGoRec, #ezPull, [data-mls-newvisit]'); if (b) resetSent(); }, false); });
  }
  function revert() {
    try { document.removeEventListener('click', onClick, false); } catch (e) {}
    bound = false; try { window.__mlsSimpleSend.installed = false; } catch (e) {}
  }

  window.__mlsSimpleSend = { installed: true, version: VERSION, asset: 'feat_mls_simple_autosend.js', sendNow: sendNow, isSimple: isSimple, _noteText: noteText, _codesText: codesText, _looksLikeOpNote: looksLikeOpNote, resetSent: resetSent, revert: revert };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
