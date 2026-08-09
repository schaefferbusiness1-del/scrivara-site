/* =========================================================================
 * MLS -- Widget Deck  (feat_mls_widget_deck.js -> window.__mlsWidgetDeck, wd-1.2.0)
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
 * Read-only + delegating; write-if-changed mirroring driven by canonical view /
 * patient events and observers scoped to the base widget and builder roots.
 * Reversible: window.__mlsWidgetDeck.revert().
 * ==========================================================================*/
(function () {
  'use strict';
  try { if (window.__mlsWidgetDeck && window.__mlsWidgetDeck.installed) return; } catch (e) { return; }

  /* wd-1.2.0: semantic identity, one visible owner, and event-driven repair. */
  var VERSION = 'wd-1.2.0';
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
      '#' + DECK_ID + ' .wd-body:empty:before{content:"Fills when you generate a note.";color:var(--muted,#69736d);font-weight:600}',
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

  /* Memoize the widget list by the raw stored string (same discipline as the
     b132 store-cache fix) so repeated real lifecycle signals never re-parse
     unchanged JSON. */
  var _wMemoRaw = {}, _wMemoVal = [];
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
  function visitViewVisible() {
    var vv = $('visitView');
    return !!(vv && (!vv.style || vv.style.display !== 'none'));
  }
  function sync() {
    if (!visitViewVisible()) return;
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

  /* Instant mirroring: the moment the base renders a widget's output (on
     Generate or Refresh), sync the deck too. */
  var renderWrapped = false;
  function wrapRenderOutput() {
    if (!isFn(window.cwRenderOutput)) { renderWrapped = false; return; }
    if (window.cwRenderOutput.__wdWrapped) { renderWrapped = true; return; }
    var orig = window.cwRenderOutput;
    var w = function () {
      var r;
      try { r = orig.apply(this, arguments); } catch (e) {}
      scheduleSync();
      return r;
    };
    w.__wdWrapped = true; w.__wdOrig = orig;
    window.cwRenderOutput = w;
    renderWrapped = true;
  }

  var lifecycleActive = false, lifecycleGeneration = 0, syncScheduled = false,
      listenersAttached = false, hostObserver = null, builderObserver = null,
      hostObserverRoot = null, builderObserverRoot = null,
      renderCustomWidgetsWrapped = false, setCustomWidgetsWrapped = false,
      domReadyWaiting = false;

  function scheduleSync() {
    if (!lifecycleActive || syncScheduled || !visitViewVisible()) return;
    try { if (document.hidden) return; } catch (e) {}
    syncScheduled = true;
    var generation = lifecycleGeneration;
    var request = isFn(window.requestAnimationFrame)
      ? window.requestAnimationFrame
      : function (fn) { return setTimeout(fn, 0); };
    request(function () {
      syncScheduled = false;
      if (!lifecycleActive || generation !== lifecycleGeneration) return;
      safe(sync);
    });
  }

  function widgetsChanged() {
    _wMemoRaw = {};
    _wMemoVal = [];
    lastKey = '';
    scheduleSync();
  }

  function wrapRenderCustomWidgets() {
    if (!isFn(window.renderCustomWidgets)) { renderCustomWidgetsWrapped = false; return; }
    if (window.renderCustomWidgets.__wdDeckWrapped) { renderCustomWidgetsWrapped = true; return; }
    var orig = window.renderCustomWidgets;
    var wrapped = function () {
      var result = orig.apply(this, arguments);
      scheduleSync();
      return result;
    };
    wrapped.__wdDeckWrapped = true;
    wrapped.__wdDeckOrig = orig;
    window.renderCustomWidgets = wrapped;
    renderCustomWidgetsWrapped = true;
  }

  function wrapSetCustomWidgets() {
    if (!isFn(window.setCustomWidgets)) { setCustomWidgetsWrapped = false; return; }
    if (window.setCustomWidgets.__wdDeckWrapped) { setCustomWidgetsWrapped = true; return; }
    var orig = window.setCustomWidgets;
    var wrapped = function () {
      var result = orig.apply(this, arguments);
      widgetsChanged();
      return result;
    };
    wrapped.__wdDeckWrapped = true;
    wrapped.__wdDeckOrig = orig;
    window.setCustomWidgets = wrapped;
    setCustomWidgetsWrapped = true;
  }

  function startScopedObservers() {
    if (typeof MutationObserver === 'undefined') return;
    var host = $('customWidgetsHost');
    if (host !== hostObserverRoot) {
      try { if (hostObserver) hostObserver.disconnect(); } catch (e) {}
      hostObserver = null;
      hostObserverRoot = host || null;
      if (host) {
        hostObserver = new MutationObserver(function () { scheduleSync(); });
        hostObserver.observe(host, { childList: true, subtree: true, characterData: true });
      }
    }
    var builder = $('widgetBuilderModal');
    if (builder !== builderObserverRoot) {
      try { if (builderObserver) builderObserver.disconnect(); } catch (e) {}
      builderObserver = null;
      builderObserverRoot = builder || null;
      if (builder) {
        builderObserver = new MutationObserver(function () {
          if (!$(CHIPS_ID)) safe(ensureChips);
        });
        builderObserver.observe(builder, { childList: true, subtree: true });
      }
    }
  }

  function onViewChanged(ev) {
    var view = ev && ev.detail && ev.detail.view;
    if (view ? view === 'visit' : visitViewVisible()) repair();
  }
  function onPatientChanged() { lastKey = ''; if (visitViewVisible()) repair(); }
  function onSessionBoundary() { widgetsChanged(); if (visitViewVisible()) repair(); }
  function onVisibilityChanged() { try { if (!document.hidden && visitViewVisible()) repair(); } catch (e) {} }
  function onStorage(ev) {
    var expected = safe(function () { return isFn(window.uns) ? window.uns('customWidgets') : ''; }, '');
    var activeKey = safe(function () { return isFn(window.uns) ? window.uns('activePt') : ''; }, '');
    if (ev && ev.key && activeKey && ev.key === activeKey) { onPatientChanged(); return; }
    if (!ev || !ev.key || !expected || ev.key === expected) widgetsChanged();
  }

  function attachLifecycle() {
    if (listenersAttached || typeof window.addEventListener !== 'function') return;
    window.addEventListener('mls:view-changed', onViewChanged);
    window.addEventListener('mls:active-patient-changed', onPatientChanged);
    window.addEventListener('mls:session-boundary', onSessionBoundary);
    window.addEventListener('storage', onStorage);
    if (document && typeof document.addEventListener === 'function') document.addEventListener('visibilitychange', onVisibilityChanged);
    listenersAttached = true;
  }

  function detachLifecycle() {
    if (!listenersAttached) return;
    if (typeof window.removeEventListener === 'function') {
      window.removeEventListener('mls:view-changed', onViewChanged);
      window.removeEventListener('mls:active-patient-changed', onPatientChanged);
      window.removeEventListener('mls:session-boundary', onSessionBoundary);
      window.removeEventListener('storage', onStorage);
    }
    if (document && typeof document.removeEventListener === 'function') document.removeEventListener('visibilitychange', onVisibilityChanged);
    listenersAttached = false;
  }

  function repair() {
    if (!lifecycleActive) return false;
    wrapRenderOutput();
    wrapRenderCustomWidgets();
    wrapSetCustomWidgets();
    startScopedObservers();
    ensureChips();
    scheduleSync();
    return true;
  }

  function boot() {
    domReadyWaiting = false;
    lifecycleActive = true;
    lifecycleGeneration++;
    css();
    safe(function () { if (document.body) document.body.classList.add('mls-widget-deck-owner'); });
    ensureChips();
    wrapRenderOutput();
    wrapRenderCustomWidgets();
    wrapSetCustomWidgets();
    startScopedObservers();
    attachLifecycle();
    sync();
  }
  function revert() {
    lifecycleActive = false;
    lifecycleGeneration++;
    syncScheduled = false;
    detachLifecycle();
    if (domReadyWaiting && document && typeof document.removeEventListener === 'function') {
      document.removeEventListener('DOMContentLoaded', boot);
      domReadyWaiting = false;
    }
    try { if (hostObserver) hostObserver.disconnect(); } catch (e) {}
    try { if (builderObserver) builderObserver.disconnect(); } catch (e) {}
    hostObserver = null; builderObserver = null;
    hostObserverRoot = null; builderObserverRoot = null;
    try { if (window.cwRenderOutput && window.cwRenderOutput.__wdWrapped && window.cwRenderOutput.__wdOrig) window.cwRenderOutput = window.cwRenderOutput.__wdOrig; } catch (e) {}
    try { if (window.renderCustomWidgets && window.renderCustomWidgets.__wdDeckWrapped && window.renderCustomWidgets.__wdDeckOrig) window.renderCustomWidgets = window.renderCustomWidgets.__wdDeckOrig; } catch (e) {}
    try { if (window.setCustomWidgets && window.setCustomWidgets.__wdDeckWrapped && window.setCustomWidgets.__wdDeckOrig) window.setCustomWidgets = window.setCustomWidgets.__wdDeckOrig; } catch (e) {}
    [DECK_ID, STYLE_ID, CHIPS_ID].forEach(function (id) { var n = $(id); if (n && n.parentNode) n.parentNode.removeChild(n); });
    safe(function () { if (document.body) document.body.classList.remove('mls-widget-deck-owner'); });
    try { window.__mlsWidgetDeck.installed = false; } catch (e) {}
    return 'widget deck reverted';
  }

  window.__mlsWidgetDeck = { installed: true, version: VERSION, asset: 'feat_mls_widget_deck.js', sync: sync, repair: repair, revert: revert };

  if (document.readyState === 'loading') { domReadyWaiting = true; document.addEventListener('DOMContentLoaded', boot, { once: true }); }
  else boot();
})();
