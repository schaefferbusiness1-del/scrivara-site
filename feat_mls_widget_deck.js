/* =========================================================================
 * MLS -- Widget Deck  (feat_mls_widget_deck.js -> window.__mlsWidgetDeck, wd-1.0.0)
 * 2026-07-12, final integration sweep (owner: widgets belong IN the main flow).
 * ----------------------------------------------------------------------------
 * Custom widgets previously lived only on the AI Studio view -- a doctor in the
 * Visit flow never saw them. This deck surfaces them natively on the VISIT view
 * (right after the note card, where their content actually lands on Generate):
 *   - a responsive card grid MIRRORING the app's own sanitized widget bodies
 *     (#cwBody_<id>, rendered by the base cwRenderOutput -- this module never
 *     renders model/user HTML itself, it clones what the app already vetted);
 *   - per-card actions delegate 100% to the base app: refreshCustomWidget(id),
 *     cwPushToNote(id); "+ New widget" opens the existing builder;
 *   - EMPTY STATE: three curated one-click picks from the app's own CW_LIBRARY
 *     (installLibraryWidget) so a new account discovers widgets naturally --
 *     installs stay user-initiated, nothing is auto-installed;
 *   - BUILDER POLISH: three example chips injected into the builder modal that
 *     fill the description box (the AI designer is easier to start when you
 *     can see what a good ask looks like).
 * Read-only + delegating; write-if-changed mirroring (no idle churn); polls only
 * while the Visit view is visible. Reversible: window.__mlsWidgetDeck.revert().
 * ==========================================================================*/
(function () {
  'use strict';
  try { if (window.__mlsWidgetDeck && window.__mlsWidgetDeck.installed) return; } catch (e) { return; }

  /* wd-1.1.0: semantic identity, review indicator and single visible owner. */
  var VERSION = 'wd-1.1.0';
  var DECK_ID = 'mlsWdDeck', STYLE_ID = 'mlsWdStyle', CHIPS_ID = 'mlsWdBuilderChips';

  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }
  function isFn(f) { return typeof f === 'function'; }
  function $(id) { return safe(function () { return document.getElementById(id); }, null); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  function css() {
    if ($(STYLE_ID)) return;
    var st = document.createElement('style'); st.id = STYLE_ID;
    st.textContent = [
      '#' + DECK_ID + '{margin:14px 0;padding:14px 16px;border:1px solid #E7E5DD;border-radius:16px;background:linear-gradient(180deg,#F6FBF8 0%,#EAF1EE 100%)}',
      '#' + DECK_ID + ' .wd-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px}',
      '#' + DECK_ID + ' .wd-title{font:800 14px/1.3 "Plus Jakarta Sans",system-ui,sans-serif;color:#204034}',
      '#' + DECK_ID + ' .wd-note{font:600 11px/1.3 system-ui;color:#2E6A4B;flex:1;min-width:140px}',
      '#' + DECK_ID + ' .wd-btn{border:1px solid #E7E5DD;background:#fff;color:#2E6A4B;border-radius:9px;padding:5px 12px;font:700 12px/1.2 system-ui;cursor:pointer;transition:transform .12s,box-shadow .12s}',
      '#' + DECK_ID + ' .wd-btn:hover{transform:translateY(-1px);box-shadow:0 4px 10px rgba(32,64,52,.16)}',
      '#' + DECK_ID + ' .wd-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:10px}',
      '#' + DECK_ID + ' .wd-card{background:#fff;border:1px solid #E7E5DD;border-radius:12px;padding:11px 13px;display:flex;flex-direction:column;gap:6px;box-shadow:0 2px 8px rgba(26,33,28,.06)}',
      '#' + DECK_ID + ' .wd-card h4{margin:0;font:800 13px/1.35 "Plus Jakarta Sans",system-ui,sans-serif;color:#1E2B24;display:flex;align-items:center;gap:6px}',
      '#' + DECK_ID + ' .wd-desc{font:500 11.5px/1.4 system-ui;color:#2E6A4B}',
      '#' + DECK_ID + ' .wd-body{font:500 12.5px/1.5 system-ui;color:#204034;max-height:220px;overflow-y:auto;border-top:1px dashed #E7E5DD;padding-top:6px}',
      '#' + DECK_ID + ' .wd-body:empty:before{content:"Fills when you generate a note.";color:#C9DCD2;font-weight:600}',
      '#' + DECK_ID + ' .wd-acts{display:flex;gap:6px;margin-top:auto;padding-top:4px}',
      '#' + DECK_ID + ' .wd-acts button{border:0;background:#EAF1EE;color:#2E6A4B;border-radius:8px;padding:4px 10px;font:700 11.5px/1.2 system-ui;cursor:pointer}',
      '#' + DECK_ID + ' .wd-acts button:hover{background:#DEEAE3}',
      'body.mls-widget-deck-owner #customWidgetsHost{display:none!important}',
      '#' + DECK_ID + ' .wd-starter{border:1px dashed #EAF1EE;border-radius:12px;background:#FCFBF8;padding:11px 13px}',
      '#' + DECK_ID + ' .wd-starter b{font:800 12.5px/1.4 system-ui;color:#204034}',
      '#' + DECK_ID + ' .wd-starter p{margin:3px 0 8px;font:500 11.5px/1.45 system-ui;color:#2E6A4B}',
      '#' + DECK_ID + ' .wd-starter button{width:100%}',
      '#' + CHIPS_ID + '{display:flex;gap:6px;flex-wrap:wrap;margin:6px 0 2px}',
      '#' + CHIPS_ID + ' button{border:1px solid #D6D2C6;background:#F6FBF8;color:#2E6A4B;border-radius:999px;padding:4px 11px;font:600 11.5px/1.3 system-ui;cursor:pointer}',
      '#' + CHIPS_ID + ' button:hover{background:#EAF1EE}',
      '@media (max-width:600px){#' + DECK_ID + ' .wd-grid{grid-template-columns:1fr}}'
    ].join('\n');
    (document.head || document.documentElement).appendChild(st);
  }

  /* wd-1.0.1: memoize the widget list by the raw stored string (same discipline
     as the b132 store-cache fix) so the 1.2 s poll never re-parses unchanged JSON. */
  var _wMemoRaw = null, _wMemoVal = [];
  function widgets() {
    return safe(function () {
      if (!isFn(window.getCustomWidgets)) return [];
      var raw = null;
      try { if (isFn(window.uns)) raw = localStorage.getItem(window.uns('customWidgets')); } catch (e) {}
      if (raw !== null && raw === _wMemoRaw) return _wMemoVal;
      _wMemoVal = isFn(window.getRenderableCustomWidgets)
        ? (window.getRenderableCustomWidgets() || [])
        : (window.getCustomWidgets() || []);
      _wMemoRaw = raw;
      return _wMemoVal;
    }, []);
  }

  /* three broad clinical starters from the app's own library, matched by title */
  var STARTER_TITLES = ['Injection tracker', 'Return-to-work status', 'Opioid risk & MME'];
  function starters() {
    var lib = safe(function () { return (typeof CW_LIBRARY !== 'undefined') ? CW_LIBRARY : []; }, []);
    var out = [];
    for (var i = 0; i < lib.length; i++) if (STARTER_TITLES.indexOf(lib[i].title) >= 0) out.push({ i: i, tpl: lib[i] });
    return out.slice(0, 3);
  }

  function reviewState() {
    return safe(function () {
      if (!isFn(window.getCustomWidgets) || !isFn(window.cwAnalyzeWidgetSpecs)) return { hiddenCount: 0, titleConflictCount: 0 };
      return window.cwAnalyzeWidgetSpecs(window.getCustomWidgets() || []);
    }, { hiddenCount: 0, titleConflictCount: 0 });
  }

  /* ---------------- deck render (write-if-changed) ---------------- */
  var lastKey = '';
  function ensureDeck() {
    var vv = $('visitView');
    if (!vv) return null;
    var deck = $(DECK_ID);
    if (!deck) {
      deck = document.createElement('div'); deck.id = DECK_ID;
      var anchor = $('noteCard');
      if (anchor && anchor.parentNode && anchor.parentNode.closest && anchor.parentNode.closest('#visitView')) {
        anchor.parentNode.insertBefore(deck, anchor.nextSibling);
      } else if (anchor && anchor.parentNode) {
        anchor.parentNode.insertBefore(deck, anchor.nextSibling);
      } else {
        vv.appendChild(deck);
      }
    }
    return deck;
  }
  function skeleton(list) {
    var review = reviewState();
    var h = '<div class="wd-head"><span class="wd-title">🧩 Smart widgets</span>' +
      '<span class="wd-note">fill from each generated note · analysis only — never writes to Athena</span>' +
      '<button type="button" class="wd-btn" id="mlsWdNew">＋ New widget</button>' +
      '<button type="button" class="wd-btn" id="mlsWdStudio" title="Manage widgets in AI Studio">Manage</button>' +
      (review.hiddenCount ? '<button type="button" class="wd-btn" id="mlsWdReview">Review ' + review.hiddenCount + ' saved duplicate' + (review.hiddenCount === 1 ? '' : 's') + '</button>' : '') +
      '</div>';
    if (!list.length) {
      var st = starters();
      h += '<div class="wd-grid">';
      for (var i = 0; i < st.length; i++) {
        var t = st[i].tpl;
        h += '<div class="wd-starter"><b>' + esc(t.emoji) + ' ' + esc(t.title) + '</b><p>' + esc(t.description || '') + '</p>' +
          '<button type="button" class="wd-btn" data-lib="' + st[i].i + '">＋ Add this widget</button></div>';
      }
      h += '</div>';
      if (!st.length) h += '<div class="wd-starter"><b>No widgets yet</b><p>Describe any card you want in plain English and MLS designs it.</p></div>';
      return h;
    }
    h += '<div class="wd-grid">';
    for (var j = 0; j < list.length; j++) {
      var w = list[j];
      h += '<div class="wd-card" data-wid="' + esc(w.id) + '"><h4>' + esc(w.emoji || '🧩') + ' ' + esc(w.title) + '</h4>' +
        (w.description ? '<div class="wd-desc">' + esc(w.description) + '</div>' : '') +
        '<div class="wd-body" data-body="' + esc(w.id) + '"></div>' +
        '<div class="wd-acts">' +
        '<button type="button" data-act="refresh" data-id="' + esc(w.id) + '" title="Generate this widget for the current visit">↻ Refresh</button>' +
        '<button type="button" data-act="note" data-id="' + esc(w.id) + '" title="Append to the current note">➕ Add to note</button>' +
        '</div></div>';
    }
    h += '</div>';
    return h;
  }
  function wire(deck) {
    var nb = $('mlsWdNew'); if (nb) nb.onclick = function () { safe(function () { window.openWidgetBuilder(); }); };
    /* b248: "Manage" used to click #nav_studio, dropping the doctor at the TOP of
       AI Studio (owner: "wrong place"). The REAL management surface is the widget
       builder modal's "My widgets" list (#cwList - Edit / Delete / Auto per
       widget). Open THAT; Studio nav stays only as a fallback. */
    var sb = $('mlsWdStudio'); if (sb) sb.onclick = function () {
      if (typeof window.openWidgetBuilder === 'function') {
        window.openWidgetBuilder();
        setTimeout(function () { try { var l = $('cwList'); if (l) l.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) {} }, 250);
        return;
      }
      var n = $('nav_studio'); if (n) n.click();
    };
    var rb = $('mlsWdReview'); if (rb) rb.onclick = function () {
      if (typeof window.openWidgetBuilder === 'function') {
        window.openWidgetBuilder();
        setTimeout(function () { try { var n = $('cwWidgetReviewNotice') || $('cwList'); if (n) n.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) {} }, 100);
      }
    };
    Array.prototype.slice.call(deck.querySelectorAll('[data-lib]')).forEach(function (b) {
      b.onclick = function () {
        var i = parseInt(b.getAttribute('data-lib'), 10);
        safe(function () { window.installLibraryWidget(i); });
        safe(function () { window.renderCustomWidgets(); });
        lastKey = ''; sync();
      };
    });
    Array.prototype.slice.call(deck.querySelectorAll('[data-act]')).forEach(function (b) {
      b.onclick = function () {
        var id = b.getAttribute('data-id');
        if (b.getAttribute('data-act') === 'refresh') safe(function () { window.refreshCustomWidget(id); });
        else safe(function () { window.cwPushToNote(id); });
      };
    });
  }
  function mirrorBodies(deck, list) {
    for (var i = 0; i < list.length; i++) {
      var src = $('cwBody_' + list[i].id);
      var dst = deck.querySelector('[data-body="' + list[i].id + '"]');
      if (!dst) continue;
      var html = src ? src.innerHTML : '';
      if (dst.__mirror === html) continue;
      if (dst.innerHTML !== html) dst.innerHTML = html;
      dst.__mirror = html;
    }
  }
  function sync() {
    var vv = $('visitView');
    if (!vv || !vv.offsetParent) return;      /* only work while the Visit view is visible */
    /* make sure the base cards exist so there is something to mirror */
    safe(function () { if ($('customWidgetsHost') && !$('customWidgetsHost').children.length && widgets().length && isFn(window.renderCustomWidgets)) window.renderCustomWidgets(); });
    var list = widgets();
    var deck = ensureDeck(); if (!deck) return;
    /* Same-id edits must rebuild the card heading/description/actions. The old
       id-only key left stale doctor-visible content until a reload. */
    var review = reviewState();
    var key = 'pt:' + (typeof window.getActivePtId === 'function' ? window.getActivePtId() : '') +
      '|review:' + review.hiddenCount + ':' + review.titleConflictCount + '|' + list.map(function (w) {
      var semantic = safe(function () { return isFn(window.cwSemanticFingerprint) ? window.cwSemanticFingerprint(w) : ''; }, '');
      return JSON.stringify([w.id, semantic, w.emoji || '', w.description || '', w.auto !== false, w.originKey || '']);
    }).join('|');
    if (key !== lastKey) {
      lastKey = key;
      deck.innerHTML = skeleton(list);
      wire(deck);
    }
    mirrorBodies(deck, list);
  }

  /* ---------------- builder example chips (additive, once) ---------------- */
  var EXAMPLES = [
    'Track every injection I do: procedure, level, laterality, and how the pain responded',
    'Summarize any imaging discussed this visit (MRI / X-ray / CT) with the key findings',
    'A follow-up plan card: what we ordered, what the patient must do, and when I see them next'
  ];
  function ensureChips() {
    var box = $('cwDescribe');
    if (!box || $(CHIPS_ID)) return;
    var wrap = box.parentNode; if (!wrap) return;
    var row = document.createElement('div'); row.id = CHIPS_ID;
    var lbl = document.createElement('span');
    lbl.style.cssText = 'font:600 11px/2 system-ui;color:#79837C;margin-right:2px';
    lbl.textContent = 'Try:';
    row.appendChild(lbl);
    EXAMPLES.forEach(function (ex) {
      var b = document.createElement('button'); b.type = 'button';
      b.textContent = ex.length > 46 ? ex.slice(0, 44) + '…' : ex;
      b.title = ex;
      b.addEventListener('click', function () { box.value = ex; box.focus(); });
      row.appendChild(b);
    });
    wrap.appendChild(row);
  }

  /* instant mirroring: the moment the base renders a widget's output (on
     Generate or Refresh), sync the deck too -- the poll is just a fallback. */
  var renderWrapped = false;
  function wrapRenderOutput() {
    if (renderWrapped) return;
    if (!isFn(window.cwRenderOutput) || window.cwRenderOutput.__wdWrapped) { renderWrapped = !!(window.cwRenderOutput && window.cwRenderOutput.__wdWrapped); return; }
    var orig = window.cwRenderOutput;
    var w = function () {
      var r;
      try { r = orig.apply(this, arguments); } catch (e) {}
      safe(function () { setTimeout(function () { safe(sync); }, 30); });
      return r;
    };
    w.__wdWrapped = true; w.__wdOrig = orig;
    window.cwRenderOutput = w;
    renderWrapped = true;
  }

  var iv = null;
  function boot() {
    css();
    safe(function () { if (document.body) document.body.classList.add('mls-widget-deck-owner'); });
    ensureChips();
    wrapRenderOutput();
    sync();
    iv = setInterval(function () { safe(sync); safe(ensureChips); safe(wrapRenderOutput); }, 1200);
  }
  function revert() {
    if (iv) { clearInterval(iv); iv = null; }
    try { if (window.cwRenderOutput && window.cwRenderOutput.__wdWrapped && window.cwRenderOutput.__wdOrig) window.cwRenderOutput = window.cwRenderOutput.__wdOrig; } catch (e) {}
    [DECK_ID, STYLE_ID, CHIPS_ID].forEach(function (id) { var n = $(id); if (n && n.parentNode) n.parentNode.removeChild(n); });
    safe(function () { if (document.body) document.body.classList.remove('mls-widget-deck-owner'); });
    try { window.__mlsWidgetDeck.installed = false; } catch (e) {}
    return 'widget deck reverted';
  }

  window.__mlsWidgetDeck = { installed: true, version: VERSION, asset: 'feat_mls_widget_deck.js', sync: sync, revert: revert };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
