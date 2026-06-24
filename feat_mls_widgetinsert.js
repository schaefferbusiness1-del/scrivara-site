/* ============================================================================
 * feat_mls_widgetinsert.js  ->  window.__mlsWi   (wi-1.0.0)
 * ---------------------------------------------------------------------------
 * FIX 2 of the note+tools mandate: AI-generated custom-widget output -> note.
 *
 * TWO confirmed live defects this addresses (both observed on prod):
 *
 *  (A) "Add to note" inserts NOTHING for layout widgets when the model returns
 *      prose instead of the JSON the layout asks for. cwPushToNote() serializes
 *      a layout widget from _cwState (live block state) or by JSON-parsing the
 *      latest reply (_cwLatest via cwParseLayoutContent). If the reply is prose,
 *      cwParseLayoutContent returns null, _cwState is never set, the serialized
 *      string is empty, and cwPushToNote bails with "Nothing to add yet" --
 *      EVEN THOUGH the widget card visibly shows the generated text. The doctor
 *      clicks "Add to note" and the note never changes.
 *      FIX: override cwPushToNote with a version that, when the structured
 *      serialization is empty, FALLS BACK to the widget's own VISIBLE rendered
 *      text (the hidden mirror #cwText_<id>, else the body #cwBody_<id>, else the
 *      cleaned raw reply _cwLatest[id]) so the block ALWAYS lands in the note.
 *      Insertion target and placement are UNCHANGED from the app's original:
 *      the block is inserted into currentSoap / currentInsurance just before the
 *      signature, and the visible #noteBox buffer is refreshed.
 *
 *  (B) Generated custom widgets are BURIED. The custom-widget cards render in
 *      #customWidgetsHost, which lives inside #visitToolsGroup (display:none by
 *      default). So after a note generates and the widgets auto-fill, their
 *      output -- and the "Add to note" button -- are hidden behind the
 *      "Clinical tools" reveal; the doctor never sees them.
 *      FIX: when a custom widget gains content, surface it -- reveal the tools
 *      group ONCE (event-driven, on the app's own cwRenderOutput), open that
 *      specific card, and badge the Clinical tools button. Idempotent and gentle:
 *      auto-reveals the group only once per page; after that it only opens the
 *      content-bearing card (never fights a manual collapse). No polling append
 *      loop, no MutationObserver on the note -> cannot reintroduce vx flicker.
 *
 * SAFETY: touches only the in-app note text (currentSoap/currentInsurance +
 * #noteBox) and the tools-group UI. No athenaOne, no network, no credentials,
 * no fabrication (it inserts only the widget's already-generated, doctor-visible
 * content). Every external call guarded. ASCII-only. NUL-free.
 * Reversible: window.__mlsWi.revert().
 * ==========================================================================*/
(function () {
  'use strict';
  try { if (window.__mlsWi && window.__mlsWi.installed) return; } catch (e) {}

  var VERSION = 'wi-1.0.0';
  var _origPush = null;
  var _origRender = null;
  var _autoRevealedOnce = false;
  var _lastSig = {};      // per-widget content signature, to act only on changes

  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }
  function isFn(f) { return typeof f === 'function'; }
  function gid(id) { return safe(function () { return document.getElementById(id); }, null); }
  function gv(name) { return safe(function () { return window[name]; }, undefined); }
  function toastMsg(m, k) { safe(function () { if (isFn(window.toast)) window.toast(m, k || ''); }); }

  /* ---------- read the widget's own VISIBLE / raw text (fallback source) --- */
  var PLACEHOLDER_RE = /^(Fills automatically|Manual widget|Generating|Could.?n.?t generate|Nothing documented)/i;

  function mirrorText(id) {
    var m = gid('cwText_' + id);
    return m ? String(m.textContent || '').trim() : '';
  }
  function bodyText(id) {
    var b = gid('cwBody_' + id);
    if (!b) return '';
    var t = String(b.innerText || b.textContent || '').trim();
    if (!t || PLACEHOLDER_RE.test(t)) return '';
    return t;
  }
  function rawReply(id) {
    var L = gv('_cwLatest');
    var r = (L && L[id]) ? String(L[id]) : '';
    return r.replace(/^```\w*\s*/, '').replace(/```\s*$/, '').trim();
  }

  /* ---------- structured serialization (the app's own path) --------------- */
  function structuredSerialized(w) {
    var s = '';
    safe(function () {
      var _cwState = gv('_cwState') || {};
      var _cwLatest = gv('_cwLatest') || {};
      if (Array.isArray(w.layout) && w.layout.length) {
        var content = (_cwState[w.id] && _cwState[w.id].length === w.layout.length) ? _cwState[w.id] : null;
        if (!content && _cwLatest[w.id] && isFn(window.cwParseLayoutContent)) {
          content = window.cwParseLayoutContent(w.layout, _cwLatest[w.id]);
        }
        if (content && isFn(window.cwSerializeLayout)) s = window.cwSerializeLayout(w, content) || '';
      } else {
        s = mirrorText(w.id);
      }
    });
    return String(s || '').trim();
  }

  /* ---------- best available text for a widget (structured -> visible) ----- */
  function widgetText(w) {
    var s = structuredSerialized(w);
    if (s) return s;
    s = mirrorText(w.id); if (s && !PLACEHOLDER_RE.test(s)) return s;
    s = bodyText(w.id);   if (s) return s;
    s = rawReply(w.id);   if (s) return s;
    return '';
  }

  function widgetList() {
    return safe(function () { return isFn(window.getCustomWidgets) ? (window.getCustomWidgets() || []) : []; }, []);
  }
  function widgetById(id) {
    var l = widgetList();
    for (var i = 0; i < l.length; i++) { if (l[i] && l[i].id === id) return l[i]; }
    return null;
  }

  /* ---------- robust Add-to-note (override) -------------------------------- */
  function robustPush(id) {
    var w = widgetById(id);
    if (!w) return;
    var serialized = widgetText(w);
    if (!serialized) { toastMsg('Nothing to add yet -- generate or refresh this widget first.', 'err'); return; }

    var currentSoap = gv('currentSoap');
    var currentInsurance = gv('currentInsurance');
    if (!currentSoap && !currentInsurance) { toastMsg('Generate a note first.', 'err'); return; }

    var currentFormat = gv('currentFormat');
    var isInsurance = (currentFormat === 'insurance');
    var base = isInsurance ? (currentInsurance || '') : (currentSoap || '');

    var header = '-- ' + w.title + ' --';   // ASCII title wrapper (plain-text note block)
    var block = header + '\n' + serialized;
    if (base.indexOf(block) >= 0) { toastMsg('"' + w.title + '" is already in the note.', ''); return; }

    // insert before the signature block (keep signature last) -- app helpers if present
    var next;
    if (isFn(window.stripSignatureBlock)) {
      var sigStr = window.stripSignatureBlock(base);
      var hadSig = (sigStr.length !== base.replace(/\s+$/, '').length);
      next = sigStr.replace(/\s+$/, '') + '\n\n' + block;
      if (hadSig && isFn(window.withSignatureBlock)) next = window.withSignatureBlock(next);
    } else {
      next = base.replace(/\s+$/, '') + '\n\n' + block;
    }

    safe(function () {
      if (isInsurance) window.currentInsurance = next; else window.currentSoap = next;
    });

    // refresh the visible note buffer if it is the one showing
    var nb = gid('noteBox');
    if (nb && nb.style.display !== 'none') {
      if ((isInsurance && currentFormat === 'insurance') || (!isInsurance && currentFormat === 'soap')) {
        nb.value = next;
        safe(function () { nb.dispatchEvent(new Event('input', { bubbles: true })); });
      }
    }
    toastMsg('Added "' + w.title + '" to the visit note.', 'ok');
  }

  /* ---------- surface a content-bearing custom widget --------------------- */
  function openCard(cid) {
    var card = gid(cid);
    if (!card) return;
    safe(function () {
      if (!card.classList.contains('open')) {
        card.classList.add('open');   // CSS drives the expand; caret glyph left to the app's own collapsible logic
      }
    });
  }

  function revealToolsGroupOnce() {
    if (_autoRevealedOnce) return;
    var g = gid('visitToolsGroup');
    if (!g) return;
    // only on the Visit view, and only if currently hidden
    var onVisit = safe(function () { var v = gid('visitView'); return v && v.offsetParent !== null; }, true);
    if (!onVisit) return;
    if (g.style.display === 'none' || !g.style.display) {
      safe(function () { g.style.display = 'block'; });
      _autoRevealedOnce = true;
      safe(function () { if (isFn(window._reflectVisitTools)) window._reflectVisitTools(); });
    } else {
      _autoRevealedOnce = true;
    }
  }

  function surfaceWidget(w) {
    if (!w) return;
    var txt = widgetText(w);
    if (!txt) return;                       // nothing generated -> do not surface
    var sig = w.id + ':' + txt.length + ':' + txt.slice(0, 24);
    if (_lastSig[w.id] === sig) {           // already surfaced THIS content
      // still make sure its card is open + badge refreshed (cheap, idempotent)
      openCard('cw_' + w.id);
      safe(function () { if (isFn(window._reflectVisitTools)) window._reflectVisitTools(); });
      return;
    }
    _lastSig[w.id] = sig;
    revealToolsGroupOnce();
    openCard('cw_' + w.id);
    safe(function () { if (isFn(window._reflectVisitTools)) window._reflectVisitTools(); });
  }

  /* ---------- wrap cwRenderOutput so surfacing is event-driven ------------- */
  function installRenderWrap() {
    var orig = window.cwRenderOutput;
    if (!isFn(orig)) return false;
    if (orig.__mlsWiWrapped) return true;
    var wrapped = function (w, raw) {
      var r = orig.apply(this, arguments);
      safe(function () { surfaceWidget(w); });
      return r;
    };
    wrapped.__mlsWiWrapped = true;
    wrapped.__mlsWiOrig = orig;
    _origRender = orig;
    window.cwRenderOutput = wrapped;
    return true;
  }

  function installPushOverride() {
    var orig = window.cwPushToNote;
    if (isFn(orig) && orig.__mlsWiOverride) return true;
    if (isFn(orig)) _origPush = orig;
    var fn = function (id) { return robustPush(id); };
    fn.__mlsWiOverride = true;
    fn.__mlsWiOrig = _origPush;
    window.cwPushToNote = fn;
    return true;
  }

  /* ---------- boot / retry until the app globals exist -------------------- */
  function install() {
    var a = installPushOverride();
    var b = installRenderWrap();
    // surface any widget that ALREADY has content at boot (e.g. restored session)
    safe(function () {
      widgetList().forEach(function (w) { surfaceWidget(w); });
    });
    return a && b;
  }

  function installWithRetry() {
    if (install()) return;
    var tries = 0;
    var t = setInterval(function () {
      tries++;
      if (install() || tries >= 40) clearInterval(t);
    }, 250);
  }

  function revert() {
    safe(function () {
      if (window.cwPushToNote && window.cwPushToNote.__mlsWiOverride && _origPush) window.cwPushToNote = _origPush;
    });
    safe(function () {
      if (window.cwRenderOutput && window.cwRenderOutput.__mlsWiWrapped && _origRender) window.cwRenderOutput = _origRender;
    });
    safe(function () { window.__mlsWi.installed = false; });
  }

  window.__mlsWi = {
    installed: true,
    version: VERSION,
    robustPush: robustPush,
    widgetText: widgetText,
    surfaceWidget: surfaceWidget,
    install: install,
    revert: revert
  };

  try {
    installWithRetry();
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  } catch (e) { safe(install); }
})();
