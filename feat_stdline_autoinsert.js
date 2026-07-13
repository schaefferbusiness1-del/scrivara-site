/* ============================================================================
 * feat_stdline_autoinsert.js  ->  window.__mlsStdLineAuto   (v1.0.0)
 * ---------------------------------------------------------------------------
 * UPGRADE to the Templates-tab line-inserter (§55 mls-template-stdline.js +
 * the §"DEPLOY 3" feat_stdline_insert.js / window.__mlsStdLineInsert).
 *
 * WHAT MICHAEL ASKED FOR
 *   1) AUTO-INSERT VIA AI. Applying a saved line should NOT require hunting for
 *      a separate button. Clicking/applying the line (the "I am the king of
 *      backpain" card and its "Carried by:" pills) should: (a) ask the note AI
 *      to UPDATE the current note so the selected line is incorporated in the
 *      single most appropriate place, woven in correctly (not dumped at the
 *      end), then (b) auto-insert that updated note.
 *   2) KEEP a manual "Insert into note" button as an optional fallback -- but
 *      when used it does the SAME good thing (AI places it well), not a crude
 *      paste.
 *   3) CONFIRM-ADDED CHECK (the §58 save-integrity discipline). After the
 *      update, RE-READ the resulting note and verify the line content is
 *      genuinely present. Show an honest "Added" only when it truly landed; if
 *      it did not land, say so and change nothing. Provide an optional
 *      on-demand "double-check".
 *
 * HOW IT STAYS HONEST / SAFE
 *   - The AI prompt instructs the model to INCORPORATE THE PROVIDED LINE
 *     VERBATIM in the best place and to change/remove NOTHING else and to
 *     invent NO new clinical content (no fabricated findings/codes). It only
 *     places the user's own selected text.
 *   - The AI output is GATED before it is ever written: it must (a) contain the
 *     line, and (b) preserve the pre-existing note (every non-trivial original
 *     line still present). If the AI drops/alters the note or omits the line,
 *     its output is REJECTED and we fall back to the §55 deterministic inserter
 *     (which places the line before the conclusion and can never delete the
 *     note). So a bad regeneration can never clobber the doctor's note.
 *   - After writing, we RE-READ the live note box and confirm the line is
 *     present. "Added" is shown ONLY on a real re-read pass (§58). If the
 *     re-read fails we restore the prior text and report honestly -- never a
 *     fabricated success.
 *
 * TRANSPORT: the app's own audited proxy window.aiCallRaw(sys,user,null,
 *   {freeform:true}) -> backend /api/complete (server holds the key) -- the SAME
 *   path note generation / visit summaries already use, so NO new network or
 *   exfiltration surface. If aiCallRaw is unavailable the feature degrades to
 *   the deterministic placement and says so. It NEVER logs note content.
 *
 * Note box, resolved live each action (same order the writeback uses):
 *   #procNoteBody -> #noteBox -> #viewBody. None present/visible => honest
 *   "Open a note first", nothing written.
 *
 * READ-ONLY on charts/Athena: only the in-app note textarea is touched (a
 * normal input event, so the §21 preview updates). No backend / Stripe /
 * extension / ScribeFlow.html changes. Own IIFE; every external call in
 * try/catch; idempotent; fully reversible: window.__mlsStdLineAuto.revert().
 * NUL-free. No PHI in any log or artifact.
 * ==========================================================================*/
(function () {
  'use strict';
  try { if (window.__mlsStdLineAuto && window.__mlsStdLineAuto.installed) return; } catch (e) {}

  var VERSION = '1.0.0';
  var SECTION_ID = 'mls-stdline-section';
  var STYLE_ID = 'mls-slai-style';
  var BTN_AI = 'mls-slai-ai';        // primary: AI weave-and-add
  var BTN_MANUAL = 'mls-slai-manual'; // optional manual fallback (also AI)
  var BTN_CHECK = 'mls-slai-check';   // optional double-check
  var MARK = '__mlsSlaiMarked';
  var OLD_BTN = 'mls-sli-insert';     // the §DEPLOY-3 crude button (neutralized)

  /* allow tuning / disabling AI from the console without a redeploy */
  function aiEnabled() {
    try { if (window.__MLS_SLAI_DISABLE_AI === true) return false; } catch (e) {}
    return true;
  }

  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }
  function isFn(f) { return typeof f === 'function'; }
  function gid(id) { return safe(function () { return document.getElementById(id); }, null); }
  function toastMsg(m) { safe(function () { if (isFn(window.toast)) window.toast(m); }); }

  /* ---------- resolve the current note box (live each call) --------------- */
  /* GENUINE visibility only. offsetParent is null when the element OR an
   * ancestor is display:none (not actually rendered). A textarea that is
   * display:inline-block but buried inside a hidden ancestor (e.g. the
   * operative-note body #procNoteBody, which is perpetually inline-block but
   * lives in a hidden card) reports display!=='none' yet is NOT on screen.
   * Counting it as visible made the AI weave write the line into that offscreen
   * box instead of the visit note the doctor is looking at (#noteBox). Require a
   * real layout box: offsetParent present, OR client rects (covers position:fixed
   * visible elements, whose offsetParent is null but which do have rects). */
  function isVisible(el) {
    if (!el) return false;
    return safe(function () {
      if (el.offsetParent !== null) return true;
      if (el.getClientRects && el.getClientRects().length > 0) return true;
      return false;
    }, true);
  }
  function noteBox() {
    var ids = ['procNoteBody', 'noteBox', 'viewBody'];
    var firstPresent = null, mainNote = null;
    for (var i = 0; i < ids.length; i++) {
      var el = gid(ids[i]);
      if (!el) continue;
      if (firstPresent == null) firstPresent = el;
      if (ids[i] === 'noteBox') mainNote = el;
      if (isVisible(el)) return el;
    }
    /* nothing genuinely visible: prefer the visit note box over the offscreen
     * operative-note body so we never silently write into a hidden textarea. */
    return mainNote || firstPresent;
  }
  function readBox(el) {
    if (!el) return '';
    if ('value' in el && typeof el.value === 'string') return el.value;
    return el.textContent || '';
  }
  function writeBox(el, val) {
    if (!el) return;
    if ('value' in el && typeof el.value === 'string') { el.value = val; }
    else { el.textContent = val; }
    safe(function () { el.dispatchEvent(new Event('input', { bubbles: true })); });
    safe(function () { el.dispatchEvent(new Event('change', { bubbles: true })); });
  }

  /* ---------- reuse the §55 engine for presence + deterministic placement -- */
  function norm(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().toLowerCase(); }
  function isPresent(text, line) {
    var SL = window.__mlsStdLine;
    if (SL && isFn(SL.isPresent)) { return !!safe(function () { return SL.isPresent(text, line); }, _isPresentFallback(text, line)); }
    return _isPresentFallback(text, line);
  }
  function _isPresentFallback(text, line) {
    var n = norm(line); if (!n) return true;
    return norm(text).indexOf(n) !== -1;
  }
  function deterministicInsert(text, line) {
    var SL = window.__mlsStdLine;
    if (SL && isFn(SL.insertLineIntoText)) {
      return safe(function () { return SL.insertLineIntoText(text, line); }, _detFallback(text, line));
    }
    return _detFallback(text, line);
  }
  function _detFallback(text, line) {
    text = (text == null) ? '' : String(text);
    line = (line == null) ? '' : String(line).trim();
    if (!line) return text;
    if (isPresent(text, line)) return text;
    var sep = /\n/.test(text) ? '\n' : (text.trim() ? '  ' : '');
    return text.replace(/\s+$/, '') + sep + line;
  }

  /* ---------- line text for a card (canonical store first, DOM fallback) -- */
  function lineTextFor(item) {
    var id = item && item.getAttribute ? item.getAttribute('data-id') : '';
    var SL = window.__mlsStdLine;
    if (id && SL && isFn(SL.getLines)) {
      var hit = safe(function () {
        return (SL.getLines() || []).filter(function (l) { return l.id === id; })[0];
      }, null);
      if (hit && typeof hit.text === 'string') return hit.text;
    }
    var txtEl = item && item.querySelector ? item.querySelector('.txt') : null;
    return txtEl ? (txtEl.textContent || '') : '';
  }

  /* ---------- AI weave: prompt, normalize, GATE the output ---------------- */
  var SYS = [
    'You are revising an existing clinical note for a physician.',
    'You will be given the CURRENT NOTE and ONE LINE the physician wants included.',
    'Return the COMPLETE updated note as plain text and nothing else.',
    'Rules you must follow exactly:',
    '1. Incorporate / insert the provided line VERBATIM (character-for-character)',
    '   in the single most clinically appropriate place in the note (for a',
    '   procedure/operative note this is the description/procedure body, before',
    '   the conclusion).',
    '2. Do NOT remove, shorten, reorder, or reword any existing content.',
    '3. Do NOT add, invent, or infer ANY other content -- no new findings, codes,',
    '   diagnoses, medications, or commentary. Only place the given line.',
    '4. Output plain text only: no markdown, no code fences, no explanation.'
  ].join('\n');

  function buildUser(noteText, line) {
    return 'CURRENT NOTE:\n' + String(noteText == null ? '' : noteText) +
      '\n\n----\nLINE TO INCORPORATE (verbatim, unchanged):\n' + String(line);
  }

  function normalizeAi(res) {
    var s = res;
    if (res && typeof res === 'object') {
      s = res.content || res.note || res.text || res.reply || res.message || res.output || '';
    }
    s = String(s == null ? '' : s);
    // strip a wrapping ```fence ... ``` if the model added one
    s = s.replace(/^\s*```[a-zA-Z]*\s*\n?/, '').replace(/\n?```\s*$/, '');
    return s;
  }

  /* every non-trivial original line must survive in the AI output */
  function preserves(before, after) {
    var src = String(before == null ? '' : before);
    var dst = norm(after);
    var lines = src.split(/\n/);
    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i].trim();
      if (ln.length < 4) continue;          // skip blanks / tiny separators
      if (dst.indexOf(norm(ln)) === -1) return false;
    }
    return true;
  }

  // returns {text} on an accepted weave, or null if rejected/unavailable
  function aiWeave(before, line) {
    if (!aiEnabled()) return Promise.resolve(null);
    var call = window.aiCallRaw;
    if (!isFn(call)) return Promise.resolve(null);
    var p;
    try { p = call(SYS, buildUser(before, line), null, { freeform: true }); }
    catch (e) { return Promise.resolve(null); }
    return Promise.resolve(p).then(function (res) {
      var out = normalizeAi(res);
      if (!out || !out.trim()) return null;             // empty -> reject
      if (!isPresent(out, line)) return null;           // line absent -> reject
      if (!preserves(before, out)) return null;         // note clobbered -> reject
      return { text: out };
    }).catch(function () { return null; });
  }

  /* ---------- feedback (no fabrication) ----------------------------------- */
  function flash(btn, msg, ok, hold) {
    if (!btn) { toastMsg(msg); return; }
    var prev = btn.__slaiPrev != null ? btn.__slaiPrev : btn.textContent;
    btn.__slaiPrev = prev;
    btn.textContent = msg;
    btn.classList.toggle('ok', ok === true);
    btn.classList.toggle('warn', ok === false);
    clearTimeout(btn.__slaiT);
    btn.__slaiT = setTimeout(function () {
      btn.textContent = btn.__slaiPrev != null ? btn.__slaiPrev : prev;
      btn.classList.remove('ok'); btn.classList.remove('warn');
      btn.__slaiPrev = null; btn.__slaiBusy = false;
    }, hold || (ok ? 1200 : 1800));
  }
  function setWorking(btn) {
    if (!btn) return;
    if (btn.__slaiPrev == null) btn.__slaiPrev = btn.textContent;
    btn.__slaiBusy = true;
    btn.textContent = '✨ Weaving in…'; // sparkle + ellipsis
    btn.classList.remove('ok'); btn.classList.remove('warn');
  }

  /* ---------- the core action: AI weave -> gate -> write -> RE-READ -------- */
  function coreAdd(item, btn) {
    var line = String(lineTextFor(item) || '').trim();
    if (!line) { flash(btn, 'No line text', false); return Promise.resolve({ ok: false, reason: 'no-line' }); }
    var box = noteBox();
    if (!box) { flash(btn, 'Open a note first', false); return Promise.resolve({ ok: false, reason: 'no-box' }); }
    var before = readBox(box);
    if (isPresent(before, line)) {
      markAdded(item, line);
      flash(btn, 'Already in note ✓', true);
      return Promise.resolve({ ok: true, reason: 'already', method: 'none' });
    }
    if (btn && btn.__slaiBusy) return Promise.resolve({ ok: false, reason: 'busy' });
    setWorking(btn);

    return aiWeave(before, line).then(function (weave) {
      var candidate = null, method = '';
      if (weave && weave.text) { candidate = weave.text; method = 'ai'; }
      if (candidate == null) {
        // fallback: deterministic §55 placement (never deletes the note)
        var det = deterministicInsert(before, line);
        if (det !== before && isPresent(det, line)) { candidate = det; method = 'offline'; }
      }
      if (candidate == null) {
        flash(btn, '⚠ Couldn’t add the line', false);
        return { ok: false, reason: 'no-candidate' };
      }
      // re-read the box just before writing in case it changed under us
      var nowBefore = readBox(box);
      if (isPresent(nowBefore, line)) { markAdded(item, line); flash(btn, 'Already in note ✓', true); return { ok: true, reason: 'already', method: method }; }
      writeBox(box, candidate);

      // CONFIRM-ADDED: re-read the LIVE note and verify presence (§58)
      var after = readBox(box);
      if (isPresent(after, line)) {
        markAdded(item, line);
        flash(btn, '✓ Added', true);
        toastMsg(method === 'ai'
          ? '✓ Added — AI placed it in the note'
          : '✓ Added — AI was unavailable, placed it in the note');
        return { ok: true, reason: 'added', method: method };
      }
      // re-read failed -> do not claim success; restore prior text
      writeBox(box, before);
      flash(btn, '⚠ Not added — try again', false);
      return { ok: false, reason: 'verify-failed', method: method };
    }).catch(function () {
      // last-resort deterministic attempt
      var det = deterministicInsert(before, line);
      if (det !== before) {
        writeBox(box, det);
        if (isPresent(readBox(box), line)) { markAdded(item, line); flash(btn, '✓ Added', true); return { ok: true, reason: 'added', method: 'offline' }; }
        writeBox(box, before);
      }
      flash(btn, '⚠ Couldn’t add the line', false);
      return { ok: false, reason: 'error' };
    });
  }

  /* ---------- confirm-added bookkeeping + on-demand double-check ----------- */
  function markAdded(item, line) {
    if (!item) return;
    safe(function () { item.setAttribute('data-slai-added', '1'); });
    safe(function () { item.__slaiLine = line; });
    var chk = item.querySelector ? item.querySelector('.' + BTN_CHECK) : null;
    if (chk) chk.style.display = '';
  }
  // re-reads the live note and reports honestly whether the line is present
  function verifyInNote(line) {
    var box = noteBox();
    if (!box) return { present: false, reason: 'no-box' };
    return { present: isPresent(readBox(box), line), reason: 'checked' };
  }
  function doDoubleCheck(item, btn) {
    var line = String((item && item.__slaiLine) || lineTextFor(item) || '').trim();
    if (!line) { flash(btn, 'No line', false); return; }
    var r = verifyInNote(line);
    if (r.reason === 'no-box') { flash(btn, 'Open a note first', false); return; }
    if (r.present) flash(btn, '✓ In note', true);
    else flash(btn, '⚠ Not in note', false);
  }

  /* ---------- decorate each saved-line card ------------------------------- */
  function mkBtn(cls, label, title) {
    var b = document.createElement('button');
    b.type = 'button'; b.className = cls; b.textContent = label; b.title = title;
    b.setAttribute('data-mls-slai', '1');
    return b;
  }
  function neutralizeOldButton(item) {
    // remove the §DEPLOY-3 crude button if it slipped in; our delegate owns clicks
    safe(function () {
      var olds = item.querySelectorAll('.' + OLD_BTN);
      for (var i = 0; i < olds.length; i++) { if (olds[i].parentNode) olds[i].parentNode.removeChild(olds[i]); }
    });
  }
  function decorateItem(item) {
    if (!item) return;
    var actions = item.querySelector('.mls-sl-actions');
    if (!actions) return;
    neutralizeOldButton(item);
    if (item[MARK] && actions.querySelector('.' + BTN_AI)) return;
    if (!actions.querySelector('.' + BTN_AI)) {
      var ai = mkBtn(BTN_AI, '✨ Add to note', 'Have the AI weave this line into the best place in the current note');
      var man = mkBtn(BTN_MANUAL, '➕ Insert into note', 'Insert this line into the current note (AI places it well)');
      var chk = mkBtn(BTN_CHECK, '🔍 Double-check', 'Re-read the note and confirm this line is present');
      chk.style.display = (item.getAttribute('data-slai-added') === '1') ? '' : 'none';
      // order: AI (primary) -> manual fallback -> double-check -> existing Edit/Remove
      actions.insertBefore(chk, actions.firstChild);
      actions.insertBefore(man, actions.firstChild);
      actions.insertBefore(ai, actions.firstChild);
    }
    var txt = item.querySelector('.txt');
    if (txt && !txt.__slaiClk) {
      txt.__slaiClk = true;
      txt.classList.add('mls-slai-clk');
      txt.title = 'Click to add this line to the current note (AI places it well)';
    }
    item[MARK] = true;
  }
  function sweep() {
    var sec = gid(SECTION_ID);
    if (!sec) return;
    var items = sec.querySelectorAll('.mls-sl-item');
    for (var i = 0; i < items.length; i++) decorateItem(items[i]);
  }

  /* ---------- one delegated click handler (survives re-renders) ----------- */
  var _onClick = null;
  function installDelegate() {
    if (_onClick) return;
    _onClick = function (ev) {
      try {
        var t = ev.target;
        if (!t || !t.closest) return;
        if (!t.closest('#' + SECTION_ID)) return;
        var item = t.closest('.mls-sl-item');
        if (!item) return;
        var check = t.closest('.' + BTN_CHECK);
        if (check) { ev.preventDefault(); ev.stopPropagation(); doDoubleCheck(item, check); return; }
        var ai = t.closest('.' + BTN_AI);
        var man = t.closest('.' + BTN_MANUAL);
        var oldBtn = t.closest('.' + OLD_BTN);
        var txt = (ai || man) ? null : t.closest('.txt');
        if (!ai && !man && !oldBtn && !txt) return;
        ev.preventDefault();
        ev.stopPropagation();
        var pressed = ai || man || oldBtn || item.querySelector('.' + BTN_AI);
        coreAdd(item, pressed);
      } catch (e) {}
    };
    // capture phase so we can supersede the old crude handler if present
    document.addEventListener('click', _onClick, true);
  }

  /* ---------- style ------------------------------------------------------- */
  function injectStyle() {
    if (gid(STYLE_ID)) return;
    var s = '#' + SECTION_ID + ' ';
    var css = [
      s + '.' + BTN_AI + ',' + s + '.' + BTN_MANUAL + ',' + s + '.' + BTN_CHECK +
        '{border:0;border-radius:6px;padding:4px 9px;font-size:12px;font-weight:700;cursor:pointer;color:#fff;}',
      s + '.' + BTN_AI + '{background:#1f6f3f;}',
      s + '.' + BTN_MANUAL + '{background:#204034;}',
      s + '.' + BTN_CHECK + '{background:#2E6A4B;}',
      s + '.' + BTN_AI + ':hover,' + s + '.' + BTN_MANUAL + ':hover,' + s + '.' + BTN_CHECK + ':hover{filter:brightness(1.08);}',
      s + '.' + BTN_AI + '.ok,' + s + '.' + BTN_MANUAL + '.ok,' + s + '.' + BTN_CHECK + '.ok{background:#15824a;}',
      s + '.' + BTN_AI + '.warn,' + s + '.' + BTN_MANUAL + '.warn,' + s + '.' + BTN_CHECK + '.warn{background:#9a3b16;}',
      s + '.txt.mls-slai-clk{cursor:pointer;}',
      s + '.txt.mls-slai-clk:hover{text-decoration:underline;text-underline-offset:2px;}'
    ].join('');
    var st = document.createElement('style');
    st.id = STYLE_ID; st.textContent = css;
    (document.head || document.documentElement).appendChild(st);
  }

  /* ---------- keep buttons present (observer + slow poll) ----------------- */
  var _obs = null, _deb = null, _pollT = null;
  function startObserver() {
    if (_obs) return;
    _obs = new MutationObserver(function () {
      clearTimeout(_deb);
      _deb = setTimeout(sweep, 40);
    });
    safe(function () { _obs.observe(document.documentElement, { childList: true, subtree: true }); });
    _pollT = setInterval(sweep, 1500);
  }

  /* ---------- neutralize the superseded §DEPLOY-3 inserter (if loaded) ----- */
  function supersedeOld() {
    var OLD = window.__mlsStdLineInsert;
    if (OLD && OLD.installed && isFn(OLD.revert) && !OLD.__slaiSuperseded) {
      OLD.__slaiSuperseded = true;
      safe(function () { OLD.revert(); });  // removes its crude button, .txt click + its delegate
    }
  }

  /* ---------- revert ------------------------------------------------------ */
  function revert() {
    safe(function () { if (_obs) { _obs.disconnect(); _obs = null; } });
    safe(function () { if (_pollT) { clearInterval(_pollT); _pollT = null; } });
    safe(function () { if (_onClick) { document.removeEventListener('click', _onClick, true); _onClick = null; } });
    safe(function () {
      var sec = gid(SECTION_ID);
      if (sec) {
        sec.querySelectorAll('.' + BTN_AI + ',.' + BTN_MANUAL + ',.' + BTN_CHECK).forEach(function (b) {
          if (b.parentNode) b.parentNode.removeChild(b);
        });
        sec.querySelectorAll('.txt.mls-slai-clk').forEach(function (x) {
          x.classList.remove('mls-slai-clk'); x.removeAttribute('title'); x.__slaiClk = false;
        });
        sec.querySelectorAll('.mls-sl-item').forEach(function (it) {
          it[MARK] = false; it.removeAttribute('data-slai-added'); it.__slaiLine = null;
        });
      }
    });
    safe(function () { var st = gid(STYLE_ID); if (st && st.parentNode) st.parentNode.removeChild(st); });
    safe(function () { window.__mlsStdLineAuto.installed = false; });
  }

  function boot() {
    supersedeOld();
    injectStyle();
    installDelegate();
    startObserver();
    sweep();
    // a couple of late passes in case the old asset boots a touch after us
    setTimeout(function () { supersedeOld(); sweep(); }, 400);
    setTimeout(function () { supersedeOld(); sweep(); }, 1500);
  }

  window.__mlsStdLineAuto = {
    installed: true,
    version: VERSION,
    // exposed for tests / manual use
    noteBox: noteBox,
    isPresent: isPresent,
    deterministicInsert: deterministicInsert,
    lineTextFor: lineTextFor,
    normalizeAi: normalizeAi,
    preserves: preserves,
    aiWeave: aiWeave,
    coreAdd: coreAdd,
    verifyInNote: verifyInNote,
    decorateItem: decorateItem,
    sweep: sweep,
    supersedeOld: supersedeOld,
    boot: boot,
    revert: revert,
    _sys: SYS,
    _buildUser: buildUser
  };

  try {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
    else boot();
  } catch (e) { safe(boot); }
})();
