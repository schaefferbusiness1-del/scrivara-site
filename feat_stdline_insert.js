/* ============================================================================
 * feat_stdline_insert.js  ->  window.__mlsStdLineInsert   (v1.0.0)
 * ---------------------------------------------------------------------------
 * FIX 1 — "template line-inserter doesn't work".
 *
 * The §55 "standard line" feature (mls-template-stdline.js / window.__mlsStdLine)
 * renders, at the top of the Templates tab, a managed list of saved lines — each
 * shown as a card with its text, "Carried by:" template pills, and Edit / Remove.
 *
 * Michael's report (screenshot: the "I am the king of backpain" card with
 * "Carried by:" procedure pills + Edit / Remove): clicking a saved line does
 * NOTHING. Root cause: the §55 list items only expose Edit / Remove. The ONLY
 * way a standard line ever reaches a note is the passive apply-wrap that fires
 * when a *template* later builds a note (applyTemplateToNote). There is no UI to
 * insert a line into the CURRENT note on demand — so a click on the card is a
 * no-op.
 *
 * This asset adds that missing action, additively and reversibly. For every
 * saved-line card it injects a clear "➕ Insert into note" button (and makes the
 * line text itself clickable), wired to insert that exact line into the current
 * note box at the correct place. It REUSES the §55 engine's own pure inserter
 * (window.__mlsStdLine.insertLineIntoText) so a hand-inserted line lands in the
 * same spot (end of the Description / Procedure body, before the conclusion) and
 * is never duplicated — identical behaviour to the auto-apply path, just on
 * demand. It does NOT rebuild that logic and does NOT touch the stored template.
 *
 * Current note box, resolved live each click (same order __mlsAthenaWriteback
 * uses): #procNoteBody  ->  #noteBox  ->  #viewBody. If none is present/visible
 * it reports honestly ("Open a note first") and inserts nothing — never a fake
 * success.
 *
 * SAFETY: own IIFE; every external call in try/catch; idempotent; sends NOTHING
 * to the extension; writes only into the on-screen note box (a normal input
 * event, so the §21 preview updates) — no backend / Stripe / extension /
 * ScribeFlow.html changes. Fully reversible: window.__mlsStdLineInsert.revert().
 * NUL-free. No PHI in any log.
 * ==========================================================================*/
(function () {
  'use strict';
  try { if (window.__mlsStdLineInsert && window.__mlsStdLineInsert.installed) return; } catch (e) {}

  var VERSION = '1.0.0';
  var SECTION_ID = 'mls-stdline-section';
  var STYLE_ID = 'mls-sli-style';
  var BTN_CLASS = 'mls-sli-insert';
  var HOST_CLASS = 'mls-sli-host';
  var MARK = '__mlsSliMarked';

  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }
  function isFn(f) { return typeof f === 'function'; }
  function gid(id) { return safe(function () { return document.getElementById(id); }, null); }

  /* ---------- resolve the current note box (live each call) --------------- */
  function isVisible(el) {
    if (!el) return false;
    return safe(function () {
      if (el.offsetParent !== null) return true;
      var cs = window.getComputedStyle ? getComputedStyle(el) : null;
      return !!(cs && cs.display !== 'none' && cs.visibility !== 'hidden');
    }, true);
  }
  function noteBox() {
    var ids = ['procNoteBody', 'noteBox', 'viewBody'];
    var firstPresent = null;
    for (var i = 0; i < ids.length; i++) {
      var el = gid(ids[i]);
      if (!el) continue;
      if (firstPresent == null) firstPresent = el;
      if (isVisible(el)) return el;
    }
    return firstPresent; // present but maybe hidden (e.g. behind the Templates modal) — still writable
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

  /* ---------- pure insert: REUSE the §55 engine; minimal safe fallback ---- */
  function insertLine(text, line) {
    var SL = window.__mlsStdLine;
    if (SL && isFn(SL.insertLineIntoText)) {
      return safe(function () { return SL.insertLineIntoText(text, line); }, fallbackInsert(text, line));
    }
    return fallbackInsert(text, line);
  }
  function isPresent(text, line) {
    var SL = window.__mlsStdLine;
    if (SL && isFn(SL.isPresent)) { return !!safe(function () { return SL.isPresent(text, line); }, false); }
    var n = function (s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().toLowerCase(); };
    return n(text).indexOf(n(line)) !== -1;
  }
  function fallbackInsert(text, line) {
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

  /* ---------- feedback (no fabrication) ----------------------------------- */
  function flash(btn, msg, ok) {
    if (!btn) return;
    if (btn.__sliBusy) return;
    btn.__sliBusy = true;
    var prev = btn.textContent;
    btn.textContent = msg;
    btn.classList.toggle('ok', !!ok);
    btn.classList.toggle('warn', !ok);
    setTimeout(function () {
      btn.textContent = prev;
      btn.classList.remove('ok'); btn.classList.remove('warn');
      btn.__sliBusy = false;
    }, ok ? 1100 : 1700);
    safe(function () { if (isFn(window.toast)) window.toast(msg); });
  }

  /* ---------- the action ------------------------------------------------- */
  function doInsert(item, btn) {
    var line = String(lineTextFor(item) || '').trim();
    if (!line) { flash(btn, 'No line text', false); return; }
    var box = noteBox();
    if (!box) { flash(btn, 'Open a note first', false); return; }
    var before = readBox(box);
    if (isPresent(before, line)) { flash(btn, 'Already in note ✓', true); return; }
    var after = insertLine(before, line);
    if (after === before) { flash(btn, 'Already in note ✓', true); return; }
    writeBox(box, after);
    flash(btn, 'Inserted ✓', true);
  }

  /* ---------- inject the button into each saved-line card ----------------- */
  function decorateItem(item) {
    if (!item || item[MARK]) return;
    var actions = item.querySelector('.mls-sl-actions');
    if (!actions) return;
    if (actions.querySelector('.' + BTN_CLASS)) { item[MARK] = true; return; }
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = BTN_CLASS;
    btn.setAttribute(HOST_CLASS, '1');
    btn.textContent = '➕ Insert into note';
    btn.title = 'Insert this line into the current note';
    // place it FIRST so it reads: Insert · Edit · Remove
    actions.insertBefore(btn, actions.firstChild);
    // make the line text itself clickable too (Michael: "clicking the line")
    var txt = item.querySelector('.txt');
    if (txt && !txt.__sliClickable) {
      txt.__sliClickable = true;
      txt.classList.add('mls-sli-clk');
      txt.title = 'Click to insert this line into the current note';
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
        var sec = t.closest('#' + SECTION_ID);
        if (!sec) return;
        var btn = t.closest('.' + BTN_CLASS);
        var txt = btn ? null : t.closest('.txt');
        if (!btn && !txt) return;
        var item = t.closest('.mls-sl-item');
        if (!item) return;
        ev.preventDefault();
        ev.stopPropagation();
        doInsert(item, btn || item.querySelector('.' + BTN_CLASS));
      } catch (e) {}
    };
    document.addEventListener('click', _onClick, true);
  }

  /* ---------- style ------------------------------------------------------- */
  function injectStyle() {
    if (gid(STYLE_ID)) return;
    var css = [
      '#' + SECTION_ID + ' .' + BTN_CLASS + '{border:0;border-radius:6px;padding:4px 9px;font-size:12px;',
      'font-weight:700;cursor:pointer;background:#1f6f3f;color:#fff;}',
      '#' + SECTION_ID + ' .' + BTN_CLASS + ':hover{filter:brightness(1.07);}',
      '#' + SECTION_ID + ' .' + BTN_CLASS + '.ok{background:#15824a;}',
      '#' + SECTION_ID + ' .' + BTN_CLASS + '.warn{background:#9a6a16;}',
      '#' + SECTION_ID + ' .txt.mls-sli-clk{cursor:pointer;}',
      '#' + SECTION_ID + ' .txt.mls-sli-clk:hover{text-decoration:underline;text-underline-offset:2px;}'
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

  /* ---------- revert ------------------------------------------------------ */
  function revert() {
    safe(function () { if (_obs) { _obs.disconnect(); _obs = null; } });
    safe(function () { if (_pollT) { clearInterval(_pollT); _pollT = null; } });
    safe(function () { if (_onClick) { document.removeEventListener('click', _onClick, true); _onClick = null; } });
    safe(function () {
      var sec = gid(SECTION_ID);
      if (sec) {
        sec.querySelectorAll('.' + BTN_CLASS).forEach(function (b) { if (b.parentNode) b.parentNode.removeChild(b); });
        sec.querySelectorAll('.txt.mls-sli-clk').forEach(function (x) {
          x.classList.remove('mls-sli-clk'); x.removeAttribute('title'); x.__sliClickable = false;
        });
        sec.querySelectorAll('.mls-sl-item').forEach(function (it) { it[MARK] = false; });
      }
    });
    safe(function () { var st = gid(STYLE_ID); if (st && st.parentNode) st.parentNode.removeChild(st); });
    safe(function () { window.__mlsStdLineInsert.installed = false; });
  }

  function boot() {
    injectStyle();
    installDelegate();
    startObserver();
    sweep();
  }

  window.__mlsStdLineInsert = {
    installed: true,
    version: VERSION,
    // exposed for tests / manual use
    noteBox: noteBox,
    insertLine: insertLine,
    isPresent: isPresent,
    lineTextFor: lineTextFor,
    doInsert: doInsert,
    decorateItem: decorateItem,
    sweep: sweep,
    revert: revert
  };

  try {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
    else boot();
  } catch (e) { safe(boot); }
})();
