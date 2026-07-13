/* feat_mls_protocol.js  ->  window.__mlsProtocol  (v1.0.0)
 *
 * The "MLS Easy protocol" — the full ordered visit flow, built additively on top
 * of the existing MLS Easy wizard (feat_mls_easy.js / __mlsEasy), the day-driven
 * centerpiece (feat_mls_centerpiece.js / __mlsCenterpiece), and the provider
 * picker (feat_athena_provider_picker.js / __mlsProviderPicker). It REUSES the
 * app's own pieces and never reimplements them:
 *
 *   Slide 1  Pull today's / this week's patients   (the centerpiece pull buttons)
 *      |     -- auto-advances the moment a pull finishes (no tiny button) --
 *   Slide 2  NEXT UP picker  (the existing #heroToday card grid, cloned in place):
 *            tap whoever you're seeing -> sets the active patient (_heroPickPatient)
 *      |     -- tapping a card advances to the recording step --
 *   Slide 3  Start recording  (__mlsEasy step 2 / startCapture) + a small scratch
 *            textbox to type/paste alongside the recording (feeds #transcript)
 *   ...      Generate (step 3)  ->  Review (step 4)  ->  Save / Write-to-chart
 *            (step 5: saveCurrentNote + the existing __mlsAthenaWriteback button)
 *            ->  After-visit summary (the existing generateAVS panel)
 *
 * Also in this asset (additive, independently reversible sub-modules):
 *   - Provider-name-everywhere: one source of truth (__mlsProviderPicker pick) that
 *     live-updates the doctor name shown in the pull captions whenever the "Whose
 *     patients?" dropdown changes (fixes the stale hardcoded "Dr. Schaeffer" that
 *     stuck even on "All doctors").
 *   - Sizing + readability: a global stylesheet that bumps the too-small / low-
 *     contrast text and tap targets across MLS Easy and the pull/centerpiece area,
 *     including at mobile width.
 *
 * SAFETY: own IIFE; every external call wrapped in try/catch; sends NOTHING to the
 * MLS Assist extension; never clicks Save/Sign/attest/submit on its own and never
 * writes a chart (the Write-to-chart button just routes to the EXISTING, guarded
 * __mlsAthenaWriteback path, which itself never signs). Idempotent; wraps nothing
 * destructively except the one outermost _importPulledSchedule hook (restored on
 * revert). window.__mlsProtocol.revert() removes all UI / styles / wraps / timers.
 * Uses a few emoji / typographic chars in UI strings (to match the app); NUL-free.
 * No PHI in any log.
 */
(function () {
  'use strict';
  try { if (window.__mlsProtocol && window.__mlsProtocol.installed) return; } catch (e) {}

  var VERSION = '1.0.0';
  var ASSET = 'feat_mls_protocol.js';

  // ---------------- tiny safe helpers ----------------
  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }
  function isFn(f) { return typeof f === 'function'; }
  function gid(id) { return safe(function () { return document.getElementById(id); }, null); }
  function q(sel, root) { return safe(function () { return (root || document).querySelector(sel); }, null); }
  function ce(tag, cls) { var el = document.createElement(tag); if (cls) el.className = cls; return el; }
  function esc(s) {
    try { if (window.esc) return window.esc(s); } catch (e) {}
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function toast(m) { safe(function () { window.toast && window.toast(m); }); }
  function tlStep(text, state) {
    var ok = false;
    safe(function () { if (window.__mlsAthenaActions && window.__mlsAthenaActions._step) { window.__mlsAthenaActions._step(text, state || 'note'); ok = true; } });
    safe(function () { if (window.__mlsUxUnify && window.__mlsUxUnify.mirror) window.__mlsUxUnify.mirror(text); });
    if (!ok) toast(text);
  }
  function panel() { return gid('mlsEasyPanel'); }
  function body() { var p = panel(); return p ? (p.querySelector('.ez-body') || p) : null; }
  function easyState() { return safe(function () { return window.__mlsEasy && window.__mlsEasy.state; }, null) || {}; }
  function curStep() { var s = easyState(); return s && s.step ? s.step : 0; }
  function inEasy() { var s = easyState(); return !s || s.mode !== 'full'; }

  var _timers = [];
  function later(fn, ms) { var t = setTimeout(function () { safe(fn); }, ms || 0); _timers.push(t); return t; }

  // ============================================================
  //  STYLES  (Slide 2 overlay + record textbox + finish tail +
  //           the global sizing / readability pass)
  // ============================================================
  var STYLE_ID = 'mlsProtocolStyle';
  function injectStyle() {
    if (gid(STYLE_ID)) return;
    var st = ce('style'); st.id = STYLE_ID;
    st.textContent = [
      /* ---- Slide 2 overlay: while active, hide step-1 working content, show NEXT UP ---- */
      '#mlsEasyPanel.mlsproto-s2 .ez-actions,',
      '#mlsEasyPanel.mlsproto-s2 .mlscp-actions-host,',
      '#mlsEasyPanel.mlsproto-s2 #mlscpWalk,',
      '#mlsEasyPanel.mlsproto-s2 #mlsppWrap,',
      '#mlsEasyPanel.mlsproto-s2 .ez-title,',
      '#mlsEasyPanel.mlsproto-s2 .ez-sub,',
      '#mlsEasyPanel.mlsproto-s2 .ez-hint{display:none !important;}',
      '#mlsEasyPanel.mlsproto-s2 #mlscpPulls{display:none !important;}',
      '#mlsProtoSlide2{display:none;}',
      '#mlsEasyPanel.mlsproto-s2 #mlsProtoSlide2{display:block;}',
      '#mlsEasyPanel.mlsproto-s2 #mlsProtoGrid{display:grid !important;grid-template-columns:repeat(auto-fill,minmax(180px,1fr)) !important;}',
      '.mlsproto-s2head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:2px 0 10px;}',
      '.mlsproto-s2head h3{margin:0;font-size:17px;font-weight:800;color:#fff;line-height:1.25;}',
      '.mlsproto-upnow{display:inline-flex;align-items:center;gap:7px;margin:0 0 11px;padding:8px 13px;border-radius:999px;',
      'background:#ffffff;color:#0b3d91;font-size:14px;font-weight:800;box-shadow:0 2px 8px rgba(8,20,36,.18);}',
      '.mlsproto-upnow .dot{width:9px;height:9px;border-radius:50%;background:#2E6A4B;box-shadow:0 0 0 3px rgba(22,163,74,.25);}',
      /* the cloned NEXT UP card grid -- reuse the look of #heroToday cards, sized up */
      '#mlsProtoGrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px;margin:2px 0 4px;}',
      '#mlsProtoGrid > div{display:contents;}',
      '#mlsProtoGrid button{display:flex;flex-direction:column;align-items:flex-start;gap:3px;text-align:left;width:100%;',
      'box-sizing:border-box;min-height:62px;padding:11px 13px;border-radius:13px;cursor:pointer;',
      'background:#ffffff;border:2px solid rgba(255,255,255,.65);color:#0e2438;box-shadow:0 2px 8px rgba(8,20,36,.16);',
      'font-family:inherit;transition:transform .06s ease,box-shadow .12s ease;}',
      '#mlsProtoGrid button:hover{transform:translateY(-1px);box-shadow:0 5px 16px rgba(8,20,36,.26);border-color:#fff;}',
      '#mlsProtoGrid button:focus-visible{outline:3px solid #ffd34d;outline-offset:2px;}',
      '#mlsProtoGrid button > span:first-child{font-size:15px;font-weight:800;color:#0b1f33;line-height:1.2;}',
      '#mlsProtoGrid button > span{font-size:13px;font-weight:600;color:#33506e;line-height:1.3;}',
      '#mlsProtoGrid button .mlsproto-cardnow,',
      '#mlsProtoGrid button > span.upnowtag{align-self:flex-start;font-size:11px;font-weight:900;letter-spacing:.04em;',
      'color:#0a7a33;text-transform:uppercase;}',
      '#mlsProtoGrid button.is-upnow{border-color:#2E6A4B;box-shadow:0 0 0 3px rgba(22,163,74,.22),0 3px 10px rgba(8,20,36,.2);}',
      '.mlsproto-s2foot{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-top:13px;}',
      '.mlsproto-s2foot .mlsproto-start{flex:1 1 auto;min-width:180px;}',
      '.mlsproto-back{background:rgba(255,255,255,.18);border:1px solid rgba(255,255,255,.4);color:#fff;',
      'border-radius:10px;padding:11px 15px;font-size:14px;font-weight:700;cursor:pointer;min-height:46px;}',
      '.mlsproto-empty{color:#fff;opacity:.92;font-size:14px;line-height:1.45;padding:8px 2px;}',
      /* ---- Slide 3: scratch textbox alongside the recorder ---- */
      '#mlsProtoScratchWrap{margin:12px 0 2px;}',
      '#mlsProtoScratchWrap label{display:block;font-size:13.5px;font-weight:700;color:#fff;margin:0 0 5px;}',
      '#mlsProtoScratch{width:100%;box-sizing:border-box;min-height:74px;resize:vertical;padding:10px 12px;border-radius:11px;',
      'border:2px solid rgba(255,255,255,.55);background:#fff;color:#13243a;font:14px/1.45 inherit;}',
      '#mlsProtoScratch:focus{outline:3px solid #ffd34d;outline-offset:1px;border-color:#fff;}',
      '#mlsProtoScratchWrap .mlsproto-scratchhint{font-size:12.5px;color:#EAF1EC;opacity:.95;margin:5px 1px 0;line-height:1.4;}',
      /* ---- Slide 5 finish tail: write-to-chart + after-visit summary ---- */
      '.mlsproto-tail{display:flex;flex-direction:column;gap:9px;margin-top:10px;}',
      '.mlsproto-tail .ez-btn{width:100%;box-sizing:border-box;}',
      /* ====================================================================
         SIZING + READABILITY PASS (global, !important so it wins over the
         pre-existing small/low-contrast rules across MLS Easy + centerpiece)
         ==================================================================== */
      '#mlsEasyPanel .ez-btn{min-height:50px !important;font-size:15.5px !important;line-height:1.25 !important;}',
      '#mlsEasyPanel .ez-btn.ez-primary{font-weight:800 !important;}',
      '.mlscp-sub{font-size:13px !important;opacity:1 !important;color:#EAF1EE !important;line-height:1.4 !important;font-weight:500 !important;}',
      '.mlscp-note{font-size:12.5px !important;opacity:.97 !important;color:#EAF1EE !important;line-height:1.42 !important;}',
      '.mlscp-or{font-size:12.5px !important;opacity:.95 !important;color:#EAF1EC !important;}',
      '.mlscp-acting{font-size:13.5px !important;}',
      '.mlscp-mini{font-size:13px !important;min-height:42px !important;}',
      '.mlscp-walk h4{font-size:14px !important;}',
      '.mlscp-walk-now{font-size:15px !important;}',
      '.mlspp-wrap label{font-size:13px !important;}',
      '.mlspp-wrap select{font-size:14px !important;min-height:44px !important;}',
      '.mlspp-hint{font-size:12.5px !important;opacity:1 !important;color:#EAF1EE !important;line-height:1.42 !important;}',
      '#mlsEasyPanel .ez-sub{font-size:14.5px !important;opacity:1 !important;line-height:1.4 !important;}',
      '#mlsEasyPanel .ez-hint{font-size:12.8px !important;opacity:.95 !important;}',
      '#mlsEasyPanel .ez-title{font-size:18px !important;line-height:1.25 !important;}',
      '#mlsEasyPanel .ez-link{font-size:13px !important;}',
      '@media(max-width:560px){',
      '  #mlsProtoGrid{grid-template-columns:1fr;}',
      '  .mlsproto-s2foot .mlsproto-start{min-width:0;}',
      '  #mlsEasyPanel .ez-btn{font-size:15px !important;}',
      '}'
    ].join('');
    (document.head || document.documentElement).appendChild(st);
  }

  // ============================================================
  //  SLIDE 2  -- the NEXT UP picker (reuse the #heroToday card grid)
  // ============================================================
  var S2 = { active: false };

  // The live NEXT UP cards rendered by the app inside #heroToday (child index 1).
  function heroCardsGrid() {
    var ht = gid('heroToday');
    if (!ht) return null;
    var kids = [].slice.call(ht.children);
    for (var i = 0; i < kids.length; i++) {
      var k = kids[i];
      if (k && k.querySelector && k.querySelector('button[onclick*="_heroPickPatient"]')) return k;
    }
    return null;
  }
  function todayCardButtons() {
    var g = heroCardsGrid();
    if (!g) return [];
    return [].slice.call(g.querySelectorAll('button[onclick*="_heroPickPatient"]'));
  }

  // make sure the app has rendered today's NEXT UP list (it normally has)
  function ensureToday() {
    if (todayCardButtons().length) return;
    safe(function () { if (window.__mlsNextUp && isFn(window.__mlsNextUp.reload)) window.__mlsNextUp.reload(); });
    safe(function () {
      if (!todayCardButtons().length && isFn(window._renderTodayPatients)) {
        var list = (window.__mlsNextUp && isFn(window.__mlsNextUp._buildToday)) ? window.__mlsNextUp._buildToday() : (window._heroTodayList || []);
        window._renderTodayPatients(list || []);
      }
    });
  }

  function upNowName(cards) {
    for (var i = 0; i < cards.length; i++) {
      if (/up\s*now/i.test(cards[i].textContent || '')) {
        var spans = [].slice.call(cards[i].querySelectorAll('span'));
        for (var j = 0; j < spans.length; j++) { if (!/up\s*now/i.test(spans[j].textContent) && !/\d{1,2}:\d{2}/.test(spans[j].textContent)) return (spans[j].textContent || '').trim(); }
      }
    }
    if (cards[0]) { var first = cards[0].querySelector('span'); if (first) return (first.textContent || '').trim(); }
    return '';
  }

  function buildSlide2() {
    var b = body(); if (!b) return;
    var host = gid('mlsProtoSlide2');
    if (!host) { host = ce('div'); host.id = 'mlsProtoSlide2'; b.appendChild(host); }
    var cards = todayCardButtons();
    if (!cards.length) {
      host.innerHTML = '<div class="mlsproto-empty">No scheduled patients showed up from the pull yet. Open today\'s schedule grid in athenaOne and pull again, or use <b>Enter manually</b>.</div>' +
        '<div class="mlsproto-s2foot"><button type="button" class="mlsproto-back" id="mlsProtoBack">&larr; Back</button></div>';
      bindOnce('mlsProtoBack', exitSlide2);
      return;
    }
    var upName = upNowName(cards);
    var head = '<div class="mlsproto-s2head"><h3>📋 NEXT UP — tap whoever you’re seeing</h3></div>' +
      (upName ? '<div class="mlsproto-upnow"><span class="dot"></span> Up now: ' + esc(upName) + '</div>' : '');
    // clone the live grid (preserves each card's inline onclick="_heroPickPatient(N)")
    var clone = heroCardsGrid().cloneNode(true);
    clone.id = 'mlsProtoGrid';
    clone.removeAttribute('class');
    [].slice.call(clone.querySelectorAll('button')).forEach(function (btn) {
      if (/up\s*now/i.test(btn.textContent || '')) btn.classList.add('is-upnow');
    });
    var foot = '<div class="mlsproto-s2foot">' +
      '<button type="button" class="ez-btn ez-primary mlsproto-start" id="mlsProtoStart">🎙️ Start recording' + (upName ? ' — ' + esc(upName) : '') + '</button>' +
      '<button type="button" class="mlsproto-back" id="mlsProtoBack">&larr; Back</button>' +
      '</div>';
    host.innerHTML = head + '<div id="mlsProtoGridHost"></div>' + foot;
    gid('mlsProtoGridHost').appendChild(clone);

    clone.addEventListener('click', function (ev) {
      var btn = ev.target && ev.target.closest ? ev.target.closest('button') : null;
      if (!btn) return;
      later(function () { goRecord(true); }, 70);
    });
    bindOnce('mlsProtoStart', function () {
      var first = clone.querySelector('button.is-upnow') || clone.querySelector('button');
      if (first) { safe(function () { first.click(); }); }
      later(function () { goRecord(true); }, 90);
    });
    bindOnce('mlsProtoBack', exitSlide2);
  }

  function enterSlide2() {
    var p = panel(); if (!p) return;
    if (curStep() !== 1 || !inEasy()) return;
    ensureToday();
    if (!todayCardButtons().length) return;
    injectStyle();
    S2.active = true;
    buildSlide2();
    p.classList.add('mlsproto-s2');
    tlStep('Pulled the day’s patients. Pick whoever you’re seeing from NEXT UP.', 'done');
    safe(function () { p.scrollIntoView({ block: 'nearest' }); });
  }

  function exitSlide2() {
    S2.active = false;
    var p = panel(); if (p) p.classList.remove('mlsproto-s2');
  }

  function goRecord(fromCard) {
    exitSlide2();
    var ez = window.__mlsEasy;
    if (ez && isFn(ez.goto)) { safe(function () { ez.goto(2); }); }
    else { var go = gid('ezGoRec'); if (go) safe(function () { go.click(); }); }
    if (fromCard) {
      var nm = safe(function () { var p = window.activePatient && window.activePatient(); return p && p.name; }, '') || '';
      tlStep('Recording step ready' + (nm ? ' for ' + esc(nm) : '') + '. Tap Start recording, or type/paste in the box.', 'note');
    }
  }

  function bindOnce(id, fn) {
    var el = gid(id);
    if (el && !el.__mlsprotoBound) { el.__mlsprotoBound = true; el.addEventListener('click', function (ev) { safe(function () { ev.preventDefault(); }); fn(); }); }
  }

  // ---- auto-advance: wrap _importPulledSchedule (outermost) ----
  var _origImport = null, _wrapImport = null, _didWrap = false, _reverted = false;
  function wrapImport() {
    if (_didWrap) return;
    if (!isFn(window._importPulledSchedule)) return;
    if (window._importPulledSchedule.__mlsprotoWrapped) { _didWrap = true; return; }
    _origImport = window._importPulledSchedule;
    _wrapImport = function () {
      var r;
      try { r = _origImport.apply(this, arguments); } catch (e) { r = undefined; }
      if (!_reverted) {
        later(function () { if (!S2.active && curStep() === 1 && inEasy()) enterSlide2(); }, 1100);
        later(function () { if (!S2.active && curStep() === 1 && inEasy()) enterSlide2(); }, 2200);
      }
      return r;
    };
    _wrapImport.__mlsprotoWrapped = true;
    window._importPulledSchedule = _wrapImport;
    _didWrap = true;
  }

  // ============================================================
  //  SLIDE 3  -- a small scratch textbox alongside the recorder
  // ============================================================
  var SCRATCH_MARK = '\n\n[Typed notes]\n';
  var _lastScratchBlock = '';
  function injectScratch() {
    if (curStep() !== 2 || !inEasy()) return;
    if (gid('mlsProtoScratchWrap')) return;
    var b = body(); if (!b) return;
    var wrap = ce('div'); wrap.id = 'mlsProtoScratchWrap';
    wrap.innerHTML = '<label for="mlsProtoScratch">✍️ Type or paste notes (added to the recording)</label>' +
      '<textarea id="mlsProtoScratch" placeholder="e.g. paste dictation, prior note text, or quick notes — these are merged into the transcript before you Generate."></textarea>' +
      '<div class="mlsproto-scratchhint">Your typed text is added to the recording transcript, so Generate uses both.</div>';
    var acts = b.querySelector('.ez-actions');
    if (acts && acts.parentNode) acts.parentNode.insertBefore(wrap, acts.nextSibling);
    else b.appendChild(wrap);
    var ta = gid('mlsProtoScratch');
    if (ta && !ta.__mlsprotoBound) {
      ta.__mlsprotoBound = true;
      ta.addEventListener('input', syncScratch);
      if (window.__mlsProtoScratchText) ta.value = window.__mlsProtoScratchText;
    }
  }
  function syncScratch() {
    var ta = gid('mlsProtoScratch'); if (!ta) return;
    var txt = ta.value || '';
    window.__mlsProtoScratchText = txt;
    var tr = gid('transcript');
    if (!tr) return;
    var cur = tr.value || '';
    if (_lastScratchBlock && cur.indexOf(_lastScratchBlock) >= 0) cur = cur.replace(_lastScratchBlock, '');
    var block = txt.trim() ? (SCRATCH_MARK + txt.trim()) : '';
    tr.value = cur + block;
    _lastScratchBlock = block;
    safe(function () { tr.dispatchEvent(new Event('input', { bubbles: true })); });
  }

  // ============================================================
  //  SLIDE 5  -- finish tail: Write-to-chart + After-visit summary
  // ============================================================
  function clickWriteToChart() {
    var wb = window.__mlsAthenaWriteback;
    if (wb) {
      var m = ['start', 'run', 'writeNote', 'write', 'open', 'begin'].filter(function (k) { return isFn(wb[k]); })[0];
      if (m) { safe(function () { wb[m](); }); return; }
    }
    var btn = null;
    [].slice.call(document.querySelectorAll('button,a')).some(function (el) {
      if (/write\s+note\s+to\s+athena|write\s+to\s+chart/i.test(el.textContent || '')) { btn = el; return true; }
      return false;
    });
    if (btn) safe(function () { btn.click(); });
    else toast('Write-to-chart is unavailable right now.');
  }
  function injectFinishTail() {
    if (curStep() !== 5 || !inEasy()) return;
    if (gid('mlsProtoTail')) return;
    var b = body(); if (!b) return;
    var acts = b.querySelector('.ez-actions') || b;
    var tail = ce('div', 'mlsproto-tail'); tail.id = 'mlsProtoTail';
    var bits = ['<button type="button" class="ez-btn ez-secondary" id="mlsProtoWrite">✍️ Write note to Athena chart<span class="mlscp-sub">Pastes the finished note into the chart you have open in athenaOne. It never signs — you review and sign in Athena.</span></button>'];
    if (isFn(window.generateAVS)) bits.push('<button type="button" class="ez-btn ez-secondary" id="mlsProtoAvs">🧾 After-visit summary<span class="mlscp-sub">Generate a plain-language summary for the patient (you review before anything is sent).</span></button>');
    tail.innerHTML = bits.join('');
    acts.parentNode ? acts.parentNode.insertBefore(tail, acts.nextSibling) : b.appendChild(tail);
    bindOnce('mlsProtoWrite', clickWriteToChart);
    bindOnce('mlsProtoAvs', function () { safe(function () { window.generateAVS(); }); });
  }

  // ============================================================
  //  PROVIDER-NAME-EVERYWHERE  (one source of truth, live-updated)
  // ============================================================
  var _provLastPick = null;
  function provPick() { return safe(function () { return window.__mlsProviderPicker && window.__mlsProviderPicker.getPick(); }, 'mine') || 'mine'; }
  function provLabel() {
    var pp = window.__mlsProviderPicker;
    var pick = provPick();
    if (pick === 'all') return 'All doctors';
    var who = pick === 'mine' ? safe(function () { return pp && pp.detectProvider(); }, '') : pick;
    if (!who) return 'your patients';
    return safe(function () { return pp.providerLabel(who); }, who) || who;
  }
  function provCaption() {
    var pick = provPick();
    if (pick === 'all') return 'Pulls every doctor’s patients on the schedule open in athenaOne.';
    var label = provLabel();
    if (label === 'your patients') return 'Set your provider name in Settings to pull only your patients.';
    return 'Pulls only ' + label + '’s patients (falls back to all + tells you if the schedule has no per-doctor data).';
  }
  function syncProviderName(force) {
    if (!window.__mlsProviderPicker) return;
    var pick = provPick();
    if (!force && pick === _provLastPick) return;
    _provLastPick = pick;
    var cap = provCaption();
    safe(function () {
      var nodes = [].slice.call(document.querySelectorAll('#mlscpPulls .mlscp-note, #mlscpPulls .mlscp-sub'));
      nodes.forEach(function (n) {
        var t = n.textContent || '';
        if (/provider|doctor|Dr\.|Whose patients|filters to|Pulls (all|only|every)/i.test(t)) {
          if (!n.getAttribute('data-mlsproto-cap')) n.setAttribute('data-mlsproto-cap', '1');
          n.textContent = cap;
        }
      });
    });
  }

  // ============================================================
  //  keep injections present (observer + slow poll), idempotent
  // ============================================================
  var _obs = null, _pollT = null, _raf = 0;
  function tick() {
    safe(function () {
      injectStyle();
      wrapImport();
      if (S2.active) { if (curStep() !== 1 || !inEasy()) exitSlide2(); }
      injectScratch();
      injectFinishTail();
      syncProviderName(false);
    });
  }
  function scheduleTick() {
    if (_raf) return;
    _raf = (window.requestAnimationFrame || function (f) { return setTimeout(f, 16); })(function () { _raf = 0; tick(); });
  }
  function startObserver() {
    safe(function () { _obs = new MutationObserver(function () { scheduleTick(); }); _obs.observe(document.body, { childList: true, subtree: true }); });
    _pollT = setInterval(tick, 1500);
  }

  // ============================================================
  //  revert
  // ============================================================
  function revert() {
    _reverted = true;
    safe(function () { if (_obs) _obs.disconnect(); });
    safe(function () { if (_pollT) clearInterval(_pollT); });
    safe(function () { _timers.forEach(function (t) { clearTimeout(t); }); });
    safe(function () { if (_wrapImport && window._importPulledSchedule === _wrapImport && _origImport) window._importPulledSchedule = _origImport; });
    safe(function () { exitSlide2(); var h = gid('mlsProtoSlide2'); if (h) h.remove(); });
    safe(function () { var s = gid('mlsProtoScratchWrap'); if (s) s.remove(); });
    safe(function () { var t = gid('mlsProtoTail'); if (t) t.remove(); });
    safe(function () { var st = gid(STYLE_ID); if (st) st.remove(); });
    safe(function () { window.__mlsProtocol.installed = false; });
  }

  // ============================================================
  //  boot
  // ============================================================
  function boot() {
    injectStyle();
    wrapImport();
    startObserver();
    scheduleTick();
  }

  window.__mlsProtocol = {
    installed: true,
    version: VERSION,
    asset: ASSET,
    enterSlide2: enterSlide2,
    exitSlide2: exitSlide2,
    goRecord: goRecord,
    syncProviderName: function () { syncProviderName(true); },
    provLabel: provLabel,
    _s2: S2,
    revert: revert
  };

  try { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot(); }
  catch (e) { safe(boot); }
})();
